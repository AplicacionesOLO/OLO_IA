# Contrato del API Spatial · y qué falta para apagar `DevSpatialRepository`

Estado: **backend publicado y probado contra datos reales, con RLS activa.**
29 pruebas de integración verdes sobre el catálogo importado (suite completa:
211 passed, 1 skipped, 0 failures). El frontend **no**
puede activar `VITE_SPATIAL_BACKEND=true` todavía, y este documento dice
exactamente por qué, campo por campo.

No es una lista de deseos: cada fila marcada «no existe» se comprobó contra la
base con el catálogo real importado (347 racks, 2.701 cuerpos, 29.310
ubicaciones, `sha256 1622d4167fea…`).

---

## 1 · Las nueve rutas, tal como están publicadas

Todas son `GET`. Todas devuelven la envoltura estándar (`{ "data": … }`, y
`{ "data": [...], "pagination": {…} }` cuando paginan), que `apiClient.get()` ya
desenvuelve.

| # | Ruta | Permiso | Paginada |
|---|------|---------|----------|
| 1 | `/v1/spatial/warehouses` | `areas:read` | no |
| 2 | `/v1/spatial/warehouses/{warehouse_id}/summary` | `areas:read` | no |
| 3 | `/v1/spatial/warehouses/{warehouse_id}/tree?depth=&parent_id=` | `areas:read` | no (acotada por `depth`) |
| 4 | `/v1/spatial/warehouses/{warehouse_id}/floor-plan` | `areas:read` | cursor |
| 5 | `/v1/spatial/nodes/{node_id}` | `areas:read` | no |
| 6 | `/v1/spatial/nodes/{node_id}/children` | `areas:read` | cursor |
| 7 | `/v1/spatial/racks/{rack_id}/front-view` | `areas:read` | no (a propósito) |
| 8 | `/v1/spatial/locations` | `locations:read` | cursor **y** `page` |
| 9 | `/v1/spatial/locations/{location_id}` | `locations:read` | no |

No hay `POST`, `PATCH` ni `DELETE`, y una prueba lo comprueba
(`test_las_nueve_rutas_estan_publicadas`). El catálogo se escribe por importador
transaccional y auditado, no por API: 29.310 ubicaciones creadas de una en una
por HTTP no serían idempotentes ni auditables.

---

## 2 · Tres rutas que `ApiSpatialRepository.ts` llama y no existen

`src/modules/spatial/repositories/ApiSpatialRepository.ts` se escribió antes de
que el backend existiera («NO ACTIVADO TODAVIA»), y adivinó tres rutas:

| Llama a | Existe | Cambio necesario en el frontend |
|---------|--------|-------------------------------|
| `GET /spatial/racks/{rack_code}/front?warehouse_id=` | `GET /spatial/racks/{rack_id}/front-view` | ruta y **el parámetro es el UUID del nodo, no el código**. El código no es identificador: es único por almacén, no globalmente. |
| `GET /spatial/warehouses/{id}/locations` | `GET /spatial/locations?warehouse_id={id}` | el almacén es un filtro, no un segmento: el buscador global de ubicaciones tiene que poder no filtrar por almacén. |
| `getFloorPlan` espera un objeto `{racks, zones, plan_width, plan_height}` | devuelve `{data: [...], pagination: {...}}` | ver §4: el objeto que espera no se puede construir con los datos que hay. |

---

## 3 · La forma de la paginación

`PaginatedDto<T>` espera `{items, page, page_size, total, total_pages, next_cursor}`.
Lo publicado es:

```json
{
  "data": [ … ],
  "pagination": {
    "next_cursor": "TVowMS1DMDAxLU4wMS0x…",
    "page_size": 50,
    "page": null,
    "total": null,
    "total_pages": null
  }
}
```

Dos diferencias con consecuencias:

* **`items` se llama `data`**, y vive en la envoltura, no dentro de `pagination`.
* **`total` y `total_pages` valen `null` salvo que se pida `with_total=true`.**
  No es un olvido: el `count` exacto es una consulta más, y contar 29.310 filas
  en cada página de una navegación por cursor es trabajo que nadie pidió.
  `null` significa «no se contó»; un `0` significaría «no hay nada», y confundir
  las dos cosas produce una tabla que dice «0 resultados» sobre 29.310 filas.

Las **dos** formas de paginar están disponibles en `/spatial/locations`, y no se
pueden mezclar (`cursor` + `page` juntos → `422`):

* `cursor` — el coste no crece con la profundidad: **166 ms en la página 1 y
  166 ms en la 200**, medidos en el servidor.
* `page` — para una tabla que necesita «página 7 de 294». Usa `OFFSET`, se
  degrada (**245 ms en `OFFSET 20000`**) y está topada en `page=10000` para que
  nadie provoque un `OFFSET` de doscientos millones.

---

## 4 · Lo que el frontend pide y **la base no tiene**

Aquí está el motivo real de que `DevSpatialRepository` no se pueda apagar todavía.
Los datos simulados contienen campos que el catálogo del WMS **no trae**.

### 4.1 · Ocupación — no existe, y es una decisión de arquitectura

`SpatialSummaryDto` pide `occupied`, `occupancy_percent`; `FloorPlanRackDto` pide
`occupancy_percent`; `RackPositionDto` y `SpatialLocationDto` piden `occupied`.

**No se publican, y no por falta de trabajo.** La ocupación no es una propiedad
del espacio: un estante no sabe lo que tiene encima. Vive en el inventario
(invariantes SPA-11 y SPA-12, y regla R3 del ADR-009: `spatial` no referencia
`wms`).

La migración 0057 sí expuso un `occupied_count` derivado de la columna
`Situación` del WMS. La migración **0059 lo eliminó** al comprobar tres cosas
sobre los datos reales:

1. **No particiona.** `available_count` (18.075) + `blocked_count` (11.237) =
   29.312 exacto. `occupied_count` salía de otra columna y solapaba con las dos:
   15.862. Los tres sumaban **45.174 sobre 29.312**. Un gráfico apilado con esos
   tres números es imposible de dibujar, y los nombres invitaban a intentarlo.
2. **Las dos columnas del origen se contradicen** en 2.365 filas: `DISP` con
   estado bloqueado 1.973 veces, `BLOQ` con estado disponible 389. El WMS las
   tiene así.
3. **Es una foto**, del 25/06/2026, no un estado.

**Qué se publica en su lugar**, y es más útil:

| Campo | Qué es |
|-------|--------|
| `available_count`, `blocked_count` | particionan `location_count`, siempre. Verificado por la propia migración y por `test_disponibles_mas_bloqueadas_es_el_total`. |
| `wms_situation_counts` | el histograma **completo** del vocabulario del WMS: `{"OCUP": 15862, "BLOQ": 5500, "BLOQES": 2777, "DISP": 4031, …}`. 9 claves, y suman el total. El prefijo `wms_` dice que viene del origen y que no es una propiedad del espacio. |
| `status_situation_conflicts` | 2.365. El dato que hay que mirar **antes** de fiarse de cualquiera de las dos columnas. |

La ocupación real llegará como su propio modelo de lectura cuando exista el
snapshot de inventario (`ReporteInventario.xlsx`, 41.055 filas), y entonces se
llamará ocupación con todo derecho.

### 4.2 · Coordenadas del plano — no existen todavía

`FloorPlanRackDto` pide `x`, `y`, `rotation`; `FloorPlanDto` pide `plan_width`,
`plan_height`.

**`world_position`, `world_footprint` y `world_bbox` están al 100 % NULL**, y el
resumen lo expone como `with_world_geometry: 0`. El catálogo del WMS no trae
geometría métrica; llegará con el importador CAD.

Lo que sí hay son **índices lógicos**, y se publican con ese nombre:
`min_logical_x`, `max_logical_x`, `min_logical_y`, `max_logical_y`, `max_level`.
No son metros (invariante TWN-07: son índices, y una coordenada sin marco es un
número sin unidad). Con ellos se puede dibujar una **rejilla topológica** —qué
rack está al lado de cuál— pero **no un plano a escala**, y llamar `x` a un
índice es exactamente cómo se acaba dibujando un plano falso que parece correcto.

`rotation` no existe en ninguna forma. No hay dato de orientación en el
catálogo.

### 4.3 · Campos que no existen en el modelo

| Campo que pide el frontend | Estado |
|---|---|
| `capacity` (numérico único) | hay `max_weight_kg` (kg) y `max_units` (piezas). No son lo mismo y colapsarlos pierde la unidad. **Solo 2.341 de 29.310 ubicaciones tienen capacidad real**; ver §4.4. |
| `last_verified_at` | no existe. El catálogo no dice cuándo se verificó una ubicación. |
| `dimensions {width, depth, height}` | no existe. Sin geometría métrica no hay dimensiones. |
| `level_count` por rack | se publica `max_level`. El número de niveles distintos no es el máximo si faltan niveles intermedios, y en este catálogo faltan. |
| `dominant_status` | no existe. Se puede derivar en el cliente de `available_count`/`blocked_count`; hacerlo en el servidor obligaría a elegir un criterio de «dominante» que nadie ha decidido. |
| `zones` en el plano | los nodos con función especial (`DESAPA`, `BUFFER`, `CHEQ09`, `PISO1`…) salen en `floor-plan` como racks con `node_function` distinto de `storage`. No hay una entidad «zona» separada: sería un tipo de nodo, y el ADR-010 no lo creó porque el dato no lo justifica. |
| `status: 'occupied' \| 'reserved' \| 'invalid'` | el vocabulario cerrado de `location_status` es **`available` \| `blocked`**. `occupied` y `reserved` se retiraron en 0052 por lo dicho en §4.1; `invalid` nunca existió. `VALID_STATUSES` en `mappers.ts` tiene seis valores y cuatro no se pueden dar. |

### 4.4 · Capacidad: dos clases de «sin dato» que ahora se distinguen

Un hallazgo de la importación que el frontend puede aprovechar. De 29.310
ubicaciones:

* **2.341** tienen capacidad real (300, 1.300, 1.800 o 2.000 kg);
* **26.244** tienen `max_weight_kg = null` **porque el WMS declaró «sin
  límite»** — con ocho grafías distintas del mismo centinela: `1e5`, `1e6`,
  `9999999`, `1e7`, `99999999`, `1e8`, `999999999`, `1e9`;
* **727** tienen `max_weight_kg = null` **porque el WMS no dijo nada**.

Los dos últimos casos eran el mismo `null` indistinguible hasta la migración
0058. Operativamente no son lo mismo: una ubicación sin límite declarado se
puede usar; una sin dato hay que ir a medirla. El API los separa:

* en cada ubicación: `capacity_declared_unlimited: boolean`;
* en el resumen: `capacity_unlimited_count` (26.244) y `capacity_unknown_count`
  (727).

---

## 5 · Lo que el frontend **no** necesita hacer nunca

`full_code` **no se parsea**. Cada componente de la dirección viaja como campo
propio (ADR-013):

```json
{
  "full_code": "RCL07-C018-N05-2",
  "rack_code": "RCL07",  "rack_id": "…",
  "bay_code": "C018",    "bay_id": "…",  "bay_index": 18,
  "level": 5,
  "position": 2,
  "code_form": "structured"
}
```

Y el valor original del WMS se conserva **exacto**, con eñes y espacios, en
`external_code`: `DAÑADO-C001-N01-1`, `PHA LO-C001-N01-1` (el `full_code`
normalizado de esos dos es `DANADO-…` y `PHA_LO-…`). La búsqueda por prefijo
encuentra por los dos, y hay una prueba para ello: el operario que lee la
etiqueta del estante busca lo que ve escrito.

`code_form` dice si la dirección está descompuesta (`structured`) o si el código
es opaco (`opaque`, 2 ubicaciones del seed). **Al `opaque` no se le aplica el
parser estructurado**, y por eso `level`/`position` pueden ser `null`: un cliente
que asuma que siempre vienen se rompe con la primera ubicación especial.

---

## 6 · Rendimiento medido — y por qué la primera medición no valía

**Toda esta sección se rehízo.** La primera versión se midió como `postgres`, que
tiene `rolbypassrls`: las políticas RLS no se evalúan y **el plan es otro**. No era
un margen optimista, era un factor de 8.800, y con RLS activa
`/v1/spatial/warehouses` devolvía **500 DATABASE_ERROR** por
`canceling statement due to statement timeout`.

La causa está en la cabecera de la migración **0060**, en una frase: una política
que llama a `core.can_access_warehouse(warehouse_id)` le pasa una **columna**, así
que la función se evalúa **una vez por fila** —29.312 veces— y como lleva
`SET search_path` el planificador no puede integrarla. Envolver la parte que no
depende de la fila en `(SELECT …)` la convierte en un `InitPlan`: una sola
evaluación por consulta.

| Consulta | Como propietario (mentira) | Con RLS, antes de 0060 | Con RLS, ahora | Objetivo | |
|---|---|---|---|---|---|
| `warehouse_summary` (todos) | 90 ms | **> 45.000 ms** ✗ | **88 ms** | <300 | ✔ |
| `warehouse_summary` (uno) | — | **> 45.000 ms** ✗ | **88 ms** | <300 | ✔ |
| `floor_plan` de un almacén | 317 ms | **> 45.000 ms** ✗ | **387 ms** | <500 | ✔ |
| `rack_front_view` | 1,1 ms | 13,5 ms | **5,6 ms** | <300 | ✔ |
| `locations_resolved` pág. 1 | 165 ms | **76.271 ms** ✗ | **155 ms** | <300 | ✔ |
| `count` exacto de 29.310 | 6,7 ms | **59.048 ms** ✗ | **8,9 ms** | — | opt-in |
| árbol de 3.048 nodos | 4,7 ms | 6.465 ms | **3,4 ms** | <500 | ✔ |

Las cifras de la última columna son **con RLS activa, como `olo_app`, con los GUC
de un usuario real**. Son las únicas que describen lo que hará el endpoint.

### Reloj de pared: los objetivos NO se cumplen, y la consulta no es la culpable

**La latencia al pooler de AWS es de 259 ms** (`SELECT 1`, mediana de 9): Costa
Rica → `us-west-2`. Pero el endpoint no paga UN viaje, paga uno por sentencia, y
las sentencias son secuenciales. Medido con un espía sobre el motor:

    una peticion a GET /v1/spatial/warehouses
      7 sentencias x 260 ms = 1.820 ms de red   sobre 2.806 ms de reloj
      de las 7, UNA era la consulta de negocio

Las otras seis son la resolución de contexto y permisos que hace **todo** endpoint
de la aplicación, no solo los espaciales:

| # | Sentencia | Por qué |
|---|-----------|---------|
| 1 | `set_config(...)` x5 en una | los GUC de RLS. Ya estaba agrupada |
| 2 | `core.has_active_membership()` | en `get_session`, la única puerta a la base |
| 3 | `core.tenants.status` | ¿el tenant está operativo? |
| 4 | `core.has_active_membership()` **otra vez** | **duplicada**: `require_permission` la repetía |
| 5 | `core.permissions.scope` | ¿el permiso es de tenant o de plataforma? |
| 6 | CTE recursivo de roles | ¿tiene el permiso? |
| 7 | la consulta del endpoint | el trabajo real |

**Corregido en esta entrega:** las sentencias 3, 4 y 5 eran tres idas y vueltas
seguidas que ahora son **una** (`_PERMISSION_PRECHECKS`), con el mismo orden de
comprobación y los mismos tres errores distinguibles. Resultado medido:
**7 → 5 sentencias, 2.806 ms → 2.454 ms** en todos los endpoints de la aplicación.

**Lo que queda, y no se ha tocado porque afecta a la autenticación compartida:**
la sentencia 2 podría fusionarse con la 1 (`SELECT set_config(...), core.has_active_membership()`),
lo que dejaría 4 sentencias y ~1.040 ms de red. No se ha hecho porque mezcla una
comprobación de seguridad con la fijación del contexto y hace menos evidente el
orden; es una decisión que merece aprobación explícita, no un efecto colateral de
una entrega del bloque espacial.

**Conclusión honesta sobre los objetivos:** <300 ms de reloj **no es alcanzable**
con la base en otra región. El suelo es ~1.300 ms hoy (5 sentencias) y ~1.040 ms
con la última fusión. Bajar de ahí requiere una de tres cosas, y ninguna es una
consulta más rápida:

1. **Acercar la base** — una región con la aplicación, o la aplicación en la
   región de la base. Es lo único que ataca los 260 ms.
2. **Cachear el contexto y los permisos** por token con un TTL corto (30-60 s),
   que elimina las sentencias 2-6. Coste: revocar un permiso tarda hasta el TTL
   en surtir efecto, y eso contradice `RF-RBAC-007` explícitamente. Es un
   intercambio real, no una optimización gratis.
3. **Canalizar** (pipeline) las sentencias independientes. Las 2-6 no son
   independientes entre sí en el código actual.

Los objetivos **sí** se cumplen medidos en el servidor, que es donde una consulta
se puede juzgar. Decirlo de otra forma sería declarar cumplido algo que no lo
está.

Dos notas sobre `floor_plan`, que sigue siendo la más cara:

* Los 387 ms incluyen una pasada extra sobre `locations` para el histograma de
  situaciones. La versión sin histograma corría en 137 ms: es el precio de
  exponer el vocabulario completo en lugar de un `occupied_count` engañoso.
* En el camino hubo **dos formulaciones que se midieron y se descartaron**: un
  `LEFT JOIN LATERAL` que multiplicaba filas (98.334 en lugar de 29.312, factor
  3,35) y una subconsulta escalar correlacionada, correcta pero de **5.408 ms**.
  La primera la detuvo la verificación de la propia migración, no una revisión.

**Paginación, con los números que importan:** `cursor` cuesta lo mismo en la
página 1 que en la 200 (166 ms server-side las dos); `page` usa `OFFSET` y se
degrada (245 ms en `OFFSET 20000`), por eso está topada en 10.000.

---

## 7 · Veredicto: ¿se puede apagar `DevSpatialRepository`?

**No todavía, y el bloqueo no está en el backend.** Los nueve endpoints
funcionan sobre datos reales y están probados. Lo que falta es una decisión de
producto sobre tres cosas que los datos simulados inventaban:

1. **La ocupación.** Las pantallas que muestran «% ocupado» no tienen fuente
   hasta que se importe el inventario. Opciones: (a) ocultar esos indicadores
   hasta entonces; (b) mostrar el histograma `wms_situation_counts` etiquetado
   como «según el WMS, al 25/06/2026», que es honesto; (c) esperar al snapshot.
   **Recomiendo (b)**: el dato existe, es real, y etiquetado con su fecha no
   engaña a nadie.
2. **El plano a escala.** Sin `world_*` no hay `x`/`y` en metros. Opciones:
   (a) rejilla topológica con los índices lógicos; (b) esperar al importador CAD.
   **Recomiendo (a)**, siempre que la UI no prometa escala.
3. **Los tres campos inexistentes** (`last_verified_at`, `dimensions`,
   `rotation`): quitarlos de los DTO, o dejarlos opcionales y no renderizarlos.

Cuando esas tres decisiones estén tomadas, el trabajo en el frontend es: ajustar
las tres rutas de §2, la forma de paginación de §3, y los DTO de §4. El backend
no necesita cambios para eso.

Lo que **sí** se puede activar ya sin esperar nada, porque tiene datos reales
completos: el **selector de almacén**, el **árbol de nodos**, el **alzado de un
rack** y el **buscador de ubicaciones** con sus filtros.
