# Cierre del bloque Spatial · migraciones 0056–0060, importador y 9 endpoints

Fecha: 2026-07-30 · Base: `lbfdvabxkgzrxvgnzrbj` (DESARROLLO) · `schema_migrations = 0060`

---

## 1 · Qué hay en la base, medido

| | |
|---|---|
| Migraciones | 60 aplicadas, la última `0060_rls_predicate_performance` |
| Esquema `spatial` | 9 tablas (**todas** con `ENABLE` + `FORCE ROW LEVEL SECURITY`) y 4 vistas (**todas** con `security_invoker = true`) |
| Catálogo importado | **347** racks · **2.701** cuerpos · **29.310** ubicaciones |
| Ubicaciones totales | 29.312 = 29.310 importadas + 2 del seed (`opaque`, colgadas del `storage_area`) |
| Pasillos | **0** — no se inventan (ADR-013) |
| `world_*` | **0** con valor — el gemelo métrico llega con el importador CAD |
| `origin = 'inferred'` | **0** — todo viene del catálogo |
| Filas rechazadas | **0** de 29.310 |
| Archivo | `ReporteUbicaciones.xlsx`, `sha256 1622d4167fea523cdd1c75740ee92f9cab523b05c562bb07f56d288ca854271b` |

---

## 2 · Las cinco migraciones

### 0056 · `spatial.import_batches` + `spatial.import_row_errors`

Trazabilidad del importador. `import_row_errors` es **solo-añadir por política Y
por privilegio** (`REVOKE UPDATE, DELETE`): un registro de errores editable no es
un registro de errores. Índice único **parcial** sobre `file_sha256` donde
`status='completed'`, para que un lote fallido no bloquee el reintento del mismo
archivo — que es justo lo que hay que poder hacer.

**Rollback:** exige `SET LOCAL olo.confirm_destructive = '0056'` si hay lotes
registrados, porque destruye auditoría. Y aborta nombrando la dependencia si 0057
sigue aplicada (`warehouse_summary` lee `import_batches`). Ciclo completo probado:
revertir 0057 → revertir 0056 → reaplicar ambas. Se perdieron 3 filas de
auditoría, avisadas por el `WARNING`, y se reconstruyeron reimportando.

### 0058 · Techo de plausibilidad en lugar de lista de centinelas

0052 prohibía `999999999` y `1000000000` por su valor exacto. La importación real
demostró que el catálogo usa **ocho** grafías del mismo «sin límite»:

| valor | ubicaciones | | valor | ubicaciones |
|---|---|---|---|---|
| 100.000 | 9 | | 100.000.000 | 3 |
| 1.000.000 | 3 | | 999.999.999 | 25.806 |
| 9.999.999 | 16 | | 1.000.000.000 | 388 |
| 10.000.000 | 2 | | 99.999.999 | 17 |

0052 cazaba las dos últimas; **las otras seis entraron enteras**, incluidas 3
ubicaciones con 100.000 toneladas de capacidad declarada. Enumerar centinelas es
un juego de topos. Lo que separa los dos grupos no es un valor: es un orden de
magnitud, y el techo se pone en **50.000 kg** porque cae en el **hueco medido**
entre 2.000 (máximo real) y 100.000, así que no puede reclasificar ningún dato
real presente. La frontera se elige sobre un vacío, no sobre un valor.

**Efecto secundario que vale más que la corrección:** al conservar el crudo en
`raw_source.peso_max_crudo`, «el WMS declaró ilimitado» (**26.244**) y «el WMS no
dijo nada» (**727**) dejan de ser el mismo `NULL`. Son estados operativos
distintos: la primera se puede usar, la segunda hay que ir a medirla.

**Reversibilidad:** demostrada con huellas `md5` en 4 puntos, dos veces —antes y
después de que existieran los 26.244 crudos, que es el caso difícil—:

```
aplicada        2ed98eaeadec9b32ed8c6adb2d4a26b1   crudo=26244  implausibles=0
tras rollback   52ed46cdd8437db51bb73da077e3b0d8   crudo=26194  implausibles=50
reaplicada      2ed98eaeadec9b32ed8c6adb2d4a26b1   crudo=26244  implausibles=0
```

El rollback restituye 50 valores y **retiene** 26.194 en `raw_source` porque el
CHECK de 0052 los prohíbe. No pierde ninguno, y lo dice en un `NOTICE`. La
asimetría está documentada en la cabecera del propio rollback, no en la memoria de
nadie.

### 0059 · `occupied_count` fuera de las vistas

0057 exponía `occupied_count` y `occupancy_percentage` derivados de
`location_situation = 'OCUP'`. Con datos reales resultó ser tres errores:

1. **No particiona.** `available` (18.075) + `blocked` (11.237) = 29.312 exacto.
   `occupied_count` (15.862) sale de otra columna y solapa: los tres suman
   **45.174 sobre 29.312**. Un gráfico apilado imposible que los nombres invitan
   a dibujar.
2. **El origen se contradice** en **2.365** filas (`DISP` con estado bloqueado
   1.973 veces; `BLOQ` con disponible 389). El WMS las tiene así.
3. **Es una foto** del 25/06/2026, y la ocupación no vive en `spatial` (SPA-11,
   R3 del ADR-009).

En su lugar: `wms_situation_counts` (histograma completo, 9 claves, suma el total)
y `status_situation_conflicts` (2.365). Un dato incómodo medido es mejor que uno
cómodo inventado.

**Dos formulaciones se midieron y se descartaron durante esta migración:**
un `LEFT JOIN LATERAL` que multiplicaba filas (**98.334** en lugar de 29.312) —lo
detuvo la verificación de la propia migración, no una revisión— y una subconsulta
escalar correlacionada, correcta pero de **5.408 ms**. La versión final agrega una
vez y une por `(warehouse_id, rack_id)` para que el filtro por almacén baje al
subplan.

### 0060 · El defecto más caro de la sesión

**El bloque espacial se midió como `postgres`, que tiene `rolbypassrls`.** Con un
usuario real y RLS activa:

| | como propietario | con RLS | factor |
|---|---|---|---|
| `count(1)` sobre 29.312 | 6,7 ms | **59.048 ms** | 8.800x |
| `locations_resolved` pág. 1 | 165 ms | **76.271 ms** | 460x |
| `warehouse_summary` | 90 ms | **> 45.000 ms** | cancelada |

`/v1/spatial/warehouses` devolvía **500 DATABASE_ERROR** con
`canceling statement due to statement timeout`. Lo detectó una **prueba de
integración**, no una revisión, y el mensaje traducido —«Database error»— ocultó
la causa hasta que se quitó el traductor para leer el SQLSTATE.

**La causa:** una política que llama a `core.can_access_warehouse(warehouse_id)`
le pasa una **columna**. `STABLE` no significa «se llama una vez» —solo promete no
cambiar dentro de la consulta— así que se llama **por fila**: 29.312 veces. Y como
la función lleva `SET search_path`, el planificador **no puede integrarla**: cada
llamada es una invocación real con dos consultas dentro.

**El arreglo:** envolver la parte que no depende de la fila en `(SELECT …)`, que el
planificador evalúa una vez como `InitPlan`. **60.778 ms → 13,4 ms.** Seis
políticas reescritas (`core.warehouses` y 5 de `spatial`).

La verificación **demuestra la equivalencia fila a fila** con `IS DISTINCT FROM`
sobre las 29.312 ubicaciones, los 3.049 nodos y los 21 almacenes, y comprueba que
sin contexto sigue negando. Un predicado más rápido que decide distinto no es una
optimización, es un agujero.

---

## 3 · El importador

`backend/tools/import_spatial_catalog.py`

**Primera versión: 3.048 `INSERT` individuales = 275 ms por fila contra el pooler,
14 minutos sin terminar.** Reescrito con `INSERT … SELECT FROM unnest(...)`: dos
sentencias para nodos y cuerpos, 15 lotes de 2.000 para ubicaciones.
**31 segundos** para 32.358 filas.

**Idempotencia en dos niveles, los dos demostrados:**

* **Nivel 1 · `sha256`.** Segunda ejecución: `Este archivo ya se importó. Nada que
  hacer.` en 5 s, sin tocar la base. Pero eso demuestra que no duplica *no
  haciendo nada*.
* **Nivel 2 · `ON CONFLICT`.** Se añadió `--force` para poder ejercitar los
  upserts sobre datos ya presentes. Tras reejecutar los 32.358: mismos conteos
  exactos, misma huella `2ed98eae…`. Esa es la demostración real.

**Coherencia de umbrales:** el importador **consulta**
`core.capacity_ceiling('weight_kg')` y aborta si no coincide con su constante. Dos
umbrales copiados divergen en cuanto uno se toca.

**Códigos especiales:** el valor externo se conserva **exacto**.
`DAÑADO-C001-N01-1` y `PHA LO-C001-N01-1` mantienen la eñe y el espacio en
`external_code`; el `code` normalizado es `DANADO-…` y `PHA_LO-…`. Hay una prueba
que busca por los dos, porque el operario que lee la etiqueta del estante busca lo
que ve escrito.

**Sobre RETIRA / LAYOUT / SOBRA:** **no están en este archivo.** El único de los
cuatro presente es `PISO1`. Aparecían en el análisis del *inventario*
(`ReporteInventario.xlsx`), no del catálogo. Es un hallazgo relevante para la
importación del inventario: habrá ubicaciones con existencias que el catálogo no
declara, y la decisión de crearlas como `origin='inferred'` sigue pendiente y
ahora tiene un dato concreto detrás.

---

## 4 · Los nueve endpoints

Todos `GET`, todos con RLS del invocante, ninguno devuelve el catálogo crudo.
Contrato completo y delta con el frontend en **`docs/SPATIAL_API_CONTRACT.md`**.

Rendimiento **con RLS activa, como `olo_app`, con los GUC de un usuario real** —la
única medición que describe lo que hará el endpoint:

| Consulta | Servidor | Objetivo | |
|---|---|---|---|
| `warehouse_summary` | 88 ms | <300 | ✔ |
| `floor_plan` (348 filas) | 387 ms | <500 | ✔ |
| `rack_front_view` | 5,6 ms | <300 | ✔ |
| `locations` pág. 1 y pág. 200 | 155 / 166 ms | <300 | ✔ |
| búsqueda por prefijo | 22 ms | <300 | ✔ |
| árbol de 3.048 nodos | 3,4 ms | <500 | ✔ |
| `count` exacto | 8,9 ms | — | opt-in |

**Los objetivos se cumplen en el servidor. En reloj de pared NO, y hay que
decirlo:** la latencia al pooler es de **259 ms** y el endpoint paga una ida y
vuelta **por sentencia**. Medido con un espía sobre el motor: `GET
/v1/spatial/warehouses` enviaba **7 sentencias, 1.820 ms de red sobre 2.806 ms de
reloj**, y solo UNA era la consulta de negocio.

Corregido en esta entrega: tres comprobaciones de autorización que eran tres idas
y vueltas seguidas —una de ellas **duplicada**, `has_active_membership()` se
ejecutaba dos veces por petición en **toda** la aplicación— ahora son una sola
sentencia. **7 → 5 sentencias, 2.806 → 2.454 ms**, en todos los endpoints del
proyecto. El orden de comprobación y los tres errores distinguibles se conservan.

Queda una fusión más (la membresía con el `set_config`) que bajaría a 4 sentencias
y ~1.040 ms. **No se ha hecho**: mezcla una comprobación de seguridad con la
fijación del contexto y merece decisión explícita, no un efecto colateral.

---

## 5 · Deuda declarada, con nombre

### 5.1 · Los rollbacks de 0047–0055 no existían · **RESUELTO en esta entrega**

Al auditar la cobertura se encontró que **ninguna migración del proyecto
(0001–0055) tenía archivo de rollback en `supabase/migrations/`**. La
reversibilidad de 0047–0055 se demostró en su momento, pero los scripts se
ejecutaron desde el scratchpad y no quedaron versionados: la demostración **no era
reproducible por nadie más**, y eso contradice la regla de que toda modificación
exista como archivo versionado.

Escritos y **probados** los nueve: 0047 a 0055. Con la cadena completa
0060 → 0047 ejecutada en orden inverso.

**Cómo se probaron sin destruir el catálogo.** No hay entorno desechable, y
aplicar la cadena de verdad habría borrado las 29.310 ubicaciones. El DDL de
PostgreSQL es transaccional, así que la cadena entera se ejecutó **dentro de una
transacción que se aborta al final**: los rollbacks corren de verdad —se validan
su sintaxis, su orden de dependencias y sus propios bloques de verificación— y
después nada persiste. Comprobado tras el abort: 29.312 ubicaciones, migración
0060, PostGIS instalada, esquema `spatial` presente.

**La prueba encontró dos defectos** que una revisión no habría visto:

* 0055 y 0050 hacían `DROP TRIGGER trg_spatial_location_guard` /
  `trg_spatial_node_guard`. Los triggers se llaman **sin el prefijo**, así que el
  `DROP` no borraba nada y el `DROP FUNCTION` siguiente fallaba por dependencia.
* 0048 usaba `%%` en un `RAISE NOTICE` con dos argumentos. En PL/pgSQL `%%` es un
  porcentaje **literal** y no consume argumento: `too many parameters for RAISE`.

**Tres no son limpiamente reversibles con datos presentes, y lo dicen abortando**
en lugar de improvisar:

| Migración | Exige | Por qué |
|---|---|---|
| **0051** | catálogo vacío | `spatial.areas` se eliminó. Convertir 347 racks y 2.701 cuerpos en áreas inventaría 3.048 áreas que nunca existieron |
| **0053** | ningún nodo `bay` | 2.701 cuerpos con 29.310 ubicaciones colgando. Borrarlos, reasignarlos o dejarlos huérfanos son tres decisiones de producto |
| **0052**, **0054** | `SET LOCAL olo.confirm_destructive` | destruyen `raw_source` y `external_code`, que no se reconstruyen: la normalización de códigos **no es inyectiva** (el espacio y el `_` colapsan) |

Un rollback que eligiera por su cuenta entre esas opciones sería peor que uno que
se niega y explica por qué.

**Lo que sigue pendiente:** los rollbacks de 0001–0046 (fuera del bloque
espacial). El patrón y la técnica de prueba quedan establecidos.

### 5.2 · `backend/tests/architecture/` no existe

41 de las 80 invariantes de `ARCHITECTURAL_INVARIANTS.md` nombran una prueba que
aún no está escrita. Ese documento lo dice ahora explícitamente: su recuento
anterior (58/42/16) estaba mal en las tres cifras, y contaba como «automatizada»
una invariante cuya prueba la propia sección 8 declaraba no implementada.

### 5.3 · Otras políticas RLS pueden tener el mismo patrón que 0060

La verificación de 0060 comprueba que ninguna política llama a
`can_access_warehouse(columna)`. **No** comprueba otros patrones equivalentes
—cualquier función con `SET` y argumento de columna— en esquemas que hoy tienen
pocas filas (`ai.images`, `ai.annotations`). Cuando crezcan, aparecerá el mismo
defecto. Es la primera candidata para `test_rls_coverage`.

### 5.4 · `/spatial` sigue con `DevSpatialRepository`

Y el bloqueo **no está en el backend**. Tres decisiones de producto lo desbloquean;
están en §7 de `docs/SPATIAL_API_CONTRACT.md` con una recomendación para cada una.
Lo que se puede activar hoy sin esperar nada: selector de almacén, árbol de nodos,
alzado de rack y buscador de ubicaciones con filtros.

---

## 6 · Pruebas ejecutadas

```
suite unitaria       91 passed                              (6,8 s)
suite integración   211 passed, 1 skipped, 0 failures       (18 min 45 s)
   de las cuales      29 son del bloque espacial, todas verdes
ruff                 limpio en los 4 módulos nuevos y en el importador
                     ningún archivo peor que en el commit; schemas.py mejoró 3→2
mypy --strict        Success en repositories/services/api spatial y authorization
OpenAPI               9 rutas /v1/spatial de 36 totales, todas GET
```

El único `skipped` es preexistente y con motivo documentado
(`test_almacen_no_accesible_da_404_no_403`: «`olo_app` no puede leer WH-002 sin
contexto: es el comportamiento esperado»).

**Las cuatro pruebas espaciales que no se pueden aprobar por accidente:**

| Prueba | Qué haría fallar |
|---|---|
| `test_solo_ve_su_almacen` | comprueba que se ven **1** de 2 almacenes. Un fallo de RLS mostraría 2 |
| `test_disponibles_mas_bloqueadas_es_el_total` | la partición exacta, y que `occupied_count` **no** existe |
| `test_los_filtros_se_combinan_y_el_total_los_respeta` | recorre todas las páginas por cursor y compara con el `count`, que va contra **otra relación**. Si divergieran, «página 3 de 2» |
| `test_la_busqueda_encuentra_por_codigo_externo_exacto` | busca `DAÑADO` y `PHA LO` con su grafía original, no la normalizada |

**Reversibilidad de 0060, aplicada de verdad** (no en transacción abortada) tras
terminar la suite: rollback → medición → reaplicación. El rollback reintrodujo el
problema de forma **medible** —`count` de 8,9 ms a **54.381 ms**, árbol de 3,5 ms a
5.250 ms— lo que confirma que su `WARNING` no era teórico. La reaplicación volvió a
demostrar la equivalencia sobre las 29.312 filas.

---

## 7 · Invariantes nuevas

Nueve, y **ninguna salió de un diseño**: todas salieron de medir. SPA-17 a SPA-20
(ocupación fuera de las vistas, partición real, techo de plausibilidad, dos clases
de ausencia), IMP-13 e IMP-14 (inserción por conjuntos, umbral único comprobado) y
PLT-13 a PLT-15 (política sin función con columna, medir con RLS, demostrar
equivalencia al reescribir un predicado).

Cada una tiene detrás un defecto que llegó a estar aplicado en la base o
ejecutándose contra ella.
