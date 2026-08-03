# /spatial conectado al backend real · entrega

Fecha: 2026-07-30 · Backend `lbfdvabxkgzrxvgnzrbj`, migración 0060 · Catálogo:
347 racks · 2.701 cuerpos · 29.310 ubicaciones

`DevSpatialRepository` **eliminado**. Ningún camino de código instancia datos
simulados. Todo lo que se ve en `/spatial` viene del backend o del layout local, y
se distingue cuál es cuál.

---

## 1 · Endpoints conectados

Los nueve, con su mapeo verificado por navegación real (todas devolvieron 200):

| Endpoint | Hook | Panel |
|---|---|---|
| `GET /v1/spatial/warehouses` | `useWarehouses` | selector, con recuentos |
| `GET .../{id}/summary` | `useSpatialSummary` | KPIs |
| `GET .../{id}/tree?depth=0` | `useTreeRoots` | raíces del árbol |
| `GET /v1/spatial/nodes/{id}/children` | `useNodeChildren` | expansión, **una por rama** |
| `GET /v1/spatial/nodes/{id}` | `useSpatialNode` | disponible, sin consumidor aún |
| `GET .../{id}/floor-plan` | `useFloorPlan` | racks agregados (editor) |
| `GET /v1/spatial/racks/{id}/front-view` | `useRackFrontView` | alzado |
| `GET /v1/spatial/locations` | `useLocations` | tabla |
| `GET /v1/spatial/locations/{id}` | `useLocationDetail` | inspector |

**Tres rutas que el adaptador anterior adivinaba y no existen** quedaron
corregidas. La que importaba: `/racks/{rack_code}/front` usaba el **código** como
identificador, y el código es único por almacén, no globalmente.

---

## 2 · Estrategia híbrida: dos repositorios disjuntos

```
SpatialRepository    → LO QUE ES.    Backend, con RLS. Verdad compartida.
LayoutRepository     → COMO SE VE.   localStorage, del operador. Sin autoridad.
```

El backend sabe qué racks existen; **no** sabe dónde están dibujados, y no por
falta de endpoint: `world_position` está al 100 % NULL porque el catálogo del WMS
no trae geometría métrica. Mezclarlos obligaba a una de dos cosas malas — que el
adaptador real inventara geometría, o que la pantalla del plano no funcionara
nunca.

`LocalLayoutRepository` usa **la misma clave** que ya usaba el editor
(`olo.spatial.layout-draft.v1.{warehouseId}`), así que los borradores existentes
siguen abriéndose. Lo que gana: `getStatus()` responde «este almacén no tiene
plano» sin cargar una imagen base64 de varios megas.

---

## 3 · Capacidades, no un booleano

`VITE_SPATIAL_BACKEND` obligaba a todo-o-nada, y el backend no es todo-o-nada.

```ts
{ warehouses: true, summary: true, tree: true, locations: true,
  locationDetail: true, rackFront: true,
  floorGeometry: false,    // world_position está al 100% NULL
  liveOccupancy: false,    // la ocupación es del inventario (SPA-11)
  inventory: false }
```

`VITE_SPATIAL_DISABLE=floorGeometry,rackFront` permite **bajar** capacidades para
probar los estados sin datos. La dirección es deliberada: activar una capacidad
inexistente por variable de entorno produciría pantallas que mienten en el entorno
de quien la puso, y solo ahí.

---

## 4 · Campos mapeados

### El defecto que arreglé en los tipos

`types/index.ts` describía un modelo que no existe:

| Antes | Realidad |
|---|---|
| `LocationStatus` con **6** valores | **2**: `available` \| `blocked`. `occupied`/`reserved` se retiraron en 0052; `inferred` es un `origin`; `invalid` nunca existió |
| `capacity: number`, `occupied: number` | `maxWeightKg` (kg) y `maxUnits` (piezas). **Solo 2.341 de 29.310** tienen capacidad real |
| `lastVerifiedAt`, `dimensions` | no existen en ninguna forma |

Lo que un tipo promete, la UI lo renderiza. Un campo que el backend no puede
llenar es un hueco que alguien rellena con un cero.

### La tabla de ubicaciones

Doce columnas, todas del backend, **sin parsear el código** (ADR-013):

`code` · `external_code` · `rack` · `bay` · `logical_column` · `logical_level` ·
`logical_position` · `status` · `situation` · `code_form` · `origin` · `capacity`

Evidencia (búsqueda de `RCL01-C001-N01-1`, 1 fila):

```
RCL01-C001-N01-1 | — | RCL01 | C001 | 1 | 1 | 1 | Bloqueada | BLOQFI | estructurada | catalogo | 1300 kg
```

`external_code` muestra `—` cuando coincide con el normalizado: repetirlo gasta una
columna sin decir nada. Cuando difiere —`DAÑADO` frente a `DANADO`— es justo lo que
hay que ver.

**`logical_column` no venía en la vista.** La vista exponía `bay_index`, que es el
índice del **cuerpo padre**. Coinciden hoy en las 29.310 filas (medido: 0
discrepancias) porque el importador usa el mismo valor, pero no son el mismo campo:
una ubicación colgada de un rack sin cuerpo tiene columna y no tiene `bay_index`.
Aliasar uno como el otro funcionaría hoy y mentiría el día que dejen de coincidir.
Se añadió a la consulta por lotes que ya existía — **sin migración y sin viaje
extra**.

---

## 5 · Capacidad: tres estados, nunca un cero

De 29.310 ubicaciones:

| | | Qué muestra la UI |
|---|---|---|
| **2.341** | capacidad declarada | `1300 kg` |
| **26.244** | el WMS declaró «sin límite» | «Sin límite declarado por el WMS» |
| **727** | el WMS no dijo nada | «Capacidad no informada» |

La versión anterior mostraba `0 / 0` con una barra vacía en 26.971 de ellas. Un `0`
donde el dato es «sin límite» dice **lo contrario** de lo que ocurre.

---

## 6 · Los dos ejes de estado, separados

Sobre datos reales **se contradicen en 2.365 ubicaciones**:

```
situación  estado       filas
DISP       blocked      1.973   ← el WMS dice disponible, el espacio no
BLOQ       available      389   ← al contrario
BLOQES     available        3
```

* **Estado espacial** — `available` \| `blocked`. Cerrado, verificado por CHECK, y
  particiona el total. Relleno pleno en el alzado, badge con color en la tabla.
* **Situación del WMS** — `DISP`, `OCUP`, `BLOQ`, … Abierto y **con fecha**: una
  foto del archivo, no un estado vivo. Anillo en el alzado, texto sin color en la
  tabla.

Dos leyendas, nunca una. Una leyenda única con `available`, `blocked` y `OCUP`
juntos invitaría a sumarlos, y sumarlos da 45.174 sobre 29.312.

El alzado lleva escrito: *«Histórico del archivo importado. No es ocupación en
tiempo real.»* con la fecha de importación.

---

## 7 · El árbol

```
warehouse → rack → bay
```

Sin pasillos, y no es un olvido: la familia de letras del código abarca 2
preámbulos, 2 tipos y 11 zonas, así que **no es un pasillo** (ADR-013). El KPI de
sitios lo dice: «1 · sin pasillos».

* Al abrir: **348 raíces**, no los 3.048 nodos. Medido: 121.787 B.
* Al expandir: **una petición por rama** (medido: 1.074 B para `ASCEN1`), y el
  spinner sale **en la rama**, no en el workspace. Cada `TreeBranch` monta su
  propio hook; un `isLoading` compartido bloquearía el árbol entero por expandir un
  rack de 60 cuerpos.
* Un fallo al cargar una rama se muestra **en la rama**, con su reintento. El resto
  del árbol sigue usable, porque lo es.
* `childCount` viene del backend, así que el triángulo sabe si hay algo dentro sin
  una petición para averiguarlo. `ALM` (0 hijos) lo tiene deshabilitado.

---

## 8 · Evidencia: nunca se descargan las 29.310

Medido con un espía CDP sobre todas las peticiones:

```
carga inicial de /spatial          4 peticiones · 167,3 KB
   warehouses                            1.251 B
   summary                               1.249 B
   tree?depth=0                        121.787 B   ← 348 raíces
   locations?limit=50                   47.076 B   ← 50 filas, no 29.310

expandir una rama                  1 petición  ·   1,0 KB
buscar código exacto               1 petición  ·   1,6 KB   ← 1 fila
alzado de RCL01                    1 petición  · 136,5 KB   ← 374 celdas (un rack)
detalle de una ubicación           1 petición  ·   1,5 KB
```

**El máximo simultáneo en memoria fue 374 celdas + 50 filas.** El `limit` lo impone
el backend, no la buena voluntad del cliente.

`with_total` es **opt-in visible** (casilla «contar total»), porque el `count`
exacto cuesta una consulta más:

```
sin marcar   → «50 en pantalla · hay más»        (total = null)
marcado      → «1–50 de 29.312»   ·  1/587
página 2     → «51–100 de 29.312» ·  2/587       URL: …&page=2&with_total=true
```

Sin total **no se inventa uno**: `null` significa «no se contó» y `0` significaría
«no hay nada». Confundirlos produce una tabla que dice «0 resultados» sobre 29.310
filas.

---

## 9 · Evidencia de RLS

En la base hay **dos** almacenes: WH-001 y WH-002. El usuario del escenario
(`warehouse_manager`) tiene acceso a uno.

```
selector de almacén → [ 'WH-001 — Centro de Distribución San José' ]
total visible: 1
```

RLS decide, no el cliente: el frontend no filtra nada. Y el backend responde **404,
no 403**, a un almacén ajeno pedido por su UUID — un 403 confirmaría que existe.
Está cubierto por `test_un_almacen_ajeno_es_404_no_403` en la suite de integración.

**El almacén activo se valida contra la lista real** en cada carga
(`useResolvedWarehouse`): una selección persistida que ya no es accesible se
descarta en lugar de producir 404 en cada consulta. Es el caso de otro usuario
entrando en el mismo navegador.

---

## 10 · El defecto más importante que encontré probando

Con la red caída, la tabla mostraba **«Sin resultados»**.

Le decía al operador que su almacén está vacío cuando lo que pasaba es que no había
red. Es exactamente el fallo que pediste evitar, y no era mío de origen: es el
`networkMode: 'online'` **por defecto** de React Query, que **pausa** la query en
lugar de fallar. Queda en `fetchStatus: 'paused'`, `isPending: true`,
`isError: false` — indefinidamente. Comprobado a los 4, 8, 14 y 22 segundos: nunca
llegaba a error.

Dos arreglos:

1. `networkMode: 'always'` en todos los hooks. La petición se intenta, falla con
   `NETWORK_ERROR`, y el error llega a la UI.
2. En el render: «sin resultados» **solo** se puede afirmar cuando la respuesta
   llegó. Sin `page` no hay respuesta, y decir que no hay datos sería inventar una
   conclusión.

Después del arreglo, medido a los 4/8/14/22 s:

```
role=alert → "Sin conexion · Sin conexion con el servidor. · [Reintentar]"
```

---

## 11 · Manejo de errores

Trece clases, en **dos familias que no se mezclan**:

**Errores** — algo falló, puede tener sentido reintentar:
`session` (401) · `no-permission` (403) · `not-found` (404) · `timeout` (408/504 **y
500 `DATABASE_ERROR`**, que es cómo llega un `statement_timeout` del motor) ·
`disconnected` · `contract` · `generic`

**Ausencias** — nada falló, el dato no existe y eso es correcto:
`empty` · `no-results` · `no-catalog` · `no-layout` · `no-geometry` ·
`no-occupancy`

Confundirlas produce las dos peores pantallas: un error rojo cuando simplemente no
se ha configurado el plano, y un «no hay datos» tranquilizador cuando el token
expiró. Por eso `reintentable` es un campo del catálogo, no una decisión de quien
renderiza: un 403 no ofrece reintentar.

**`SpatialContractError`** es su propia clase y **nunca** se reintenta: si el
backend devolvió un valor que el contrato no admite, volver a pedirlo devuelve el
mismo valor. Y se comprueba **antes** que `ApiError`, porque un contrato inválido
puede llegar en un HTTP 200.

Los mappers **ya no absorben valores desconocidos**. La versión anterior hacía
`VALID_STATUSES.has(x) ? x : 'available'`: un estado desconocido se convertía en
`available` **en silencio**, que es lo peor posible en un almacén — una ubicación
bloqueada mostrada como disponible, sin dejar rastro.

---

## 12 · Las tres capas de ausencia, distinguidas

El inspector sin selección las separa, porque tienen tres soluciones distintas:

| Capa | Mensaje | Quién lo resuelve |
|---|---|---|
| **Plano visual** | «No se ha configurado el plano visual de este almacén.» | el operador, ahora, cargando una imagen |
| **Levantamiento métrico** | «El catálogo está disponible, pero el levantamiento métrico aún no existe.» | un importador CAD |
| **Ocupación** | «La ocupación en tiempo real estará disponible al integrar el inventario.» | el bloque de inventario |

Y si el layout existe pero la imagen no se pudo guardar, se dice con su motivo:
`localStorage` ronda los 5 MB, y «el plano no aparece» sin explicación es peor que
«la imagen no se pudo guardar: excede el límite del navegador. Las posiciones sí se
guardaron».

---

## 13 · Comprobaciones

```
tsc --noEmit    limpio en todo `src/modules/spatial`
eslint          0 errores · 1 warning PREEXISTENTE en el editor (no tocado)
vite build      ✓ 2189 módulos · 3,46 s · index 279 KB (76,6 KB gzip)
```

Navegación real contra datos reales, con capturas en
`scratchpad/shots-final/` (F1 a F10): carga inicial, árbol expandido, búsqueda
exacta, detalle, alzado de RCL01, total activado, página 2, recarga, offline y las
tres capas de ausencia.

**El alzado de RCL01**, que es la pantalla más densa: 27 cuerpos · 7 niveles · 2
posiciones · 374 ubicaciones, con **4 celdas de borde discontinuo** — posiciones que
el catálogo no declara y que **no se inventan**. Las dos leyendas separadas, con la
fecha del archivo.

**Tras recargar** se conserva el almacén y la vista activa; la navegación es **por
almacén** (`nav[warehouseId]`), así que cambiar de almacén ya no deja seleccionado
un nodo del anterior produciendo un 404 inexplicable.

---

## 14 · Lo que eliminé, y por qué no se podía «arreglar»

`DevSpatialRepository` · `dev-data/` · `LocationTree` · `SpatialGrid` ·
`SpatialCanvas` · `SpatialToolbar` · `LayerPanel` · `TreePanel` · `Inspector` ·
`Timeline` · todo `components/rack/` viejo · todo `engine/`

Consumían `occupied`, `capacity`, `dimensions` y coordenadas métricas. Adaptarlos
habría sido trabajo para mostrar campos que no existen; `SpatialCanvas` y el
`engine` dibujaban un plano a escala que **no se puede dibujar** sin geometría.

`SpatialViewMode` y `LayerConfig` vivían dentro de esos componentes y los importaba
el store del workspace, así que se movieron a `viewTypes.ts`. `LayerConfig` pasó de
6 claves a las 2 que existen.

También borré tres duplicados muertos en la raíz del módulo (`types.ts`,
`repository.ts`, `service.ts`) que solo referenciaba el barrel.

---

## 15 · Deuda declarada

1. **`tree?depth=0` son 122 KB**, el 73 % de la carga inicial. Son 348 nodos × ~350
   B, y es lo que permite el árbol instantáneo sin una petición por nodo. Si crece a
   miles de racks habrá que paginar las raíces o adelgazar el DTO.

2. **`useSpatialNode` no tiene consumidor.** Está implementado y tipado; lo usará el
   panel de detalle de nodo (hoy solo hay detalle de ubicación).

3. **El editor de plano sigue con su store propio.** `LayoutRepository` existe, está
   implementado y la página lee su estado, pero `editor/store.ts` mantiene su propia
   lógica de `saveDraft`/`loadDraft` sobre la misma clave. Unificarlos es mecánico y
   no lo hice para no tocar el editor en la misma entrega.

4. **`perception` no compila** — `DevPerceptionRepository.ts:26` le falta
   `statusHistory`. **No es mío**: `perception/types.ts` y `dev-data.ts` están
   modificados en el árbol de trabajo por el trabajo en curso de Kiro, que añadió ese
   campo como requerido. No lo toqué.

5. **La vista `canvas` desapareció.** Tres perfiles de workspace la pedían como
   vista por omisión y ahora abren en `grid`. Cuando exista geometría métrica, el
   plano vuelve — con el layout local como fondo.
