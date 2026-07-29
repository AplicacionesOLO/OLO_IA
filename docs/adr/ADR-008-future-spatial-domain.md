# ADR-008 · Reserva del dominio espacial (gemelo digital)

| | |
|---|---|
| **Estado** | Aceptado como **reserva**. Nada implementado. |
| **Fecha** | 2026-07-29 |
| **Contexto de ejecución** | 43 migraciones aplicadas (última `0043`). Antes de empezar el Bloque 1. |
| **Decide** | Que el espacio físico sea un dominio propio, y qué NO puede absorberlo |
| **No decide** | El modelo de datos concreto, ni cuándo se implementa |

> **Sobre la numeración.** Se pidió «ADR-007» y ese número ya está reclamado dos
> veces con significados distintos: `TASKS.md:88` lo asigna a *job-dispatcher* y
> `PHASE_0_EXECUTION_BACKLOG.md:294` a *propagación de claims*. Además hay dos
> esquemas de numeración incompatibles en circulación —`ARCHITECTURE.md §14` dice
> que 003 es *Clean Architecture* y `PHASE_0_PLAN.md:75` dice que es *rls-v2*—, y
> el directorio `docs/adr/` no existía: los ADR 001-006 viven incrustados en
> `ARCHITECTURE.md`. Este documento toma **008**, el primer número sin reclamar, y
> crea el directorio. La colisión de numeración queda anotada en §9 como deuda a
> resolver; no la resuelvo aquí porque afecta a documentos que no son míos.

---

## 1. El problema que este ADR previene

El módulo de IA acaba de estrenar `ai.assets`, una tabla deliberadamente genérica:

```
ai.assets  kind ∈ (image, video, frame, thumbnail, weights, run_artifact)
           bucket · object_path · sha256 · bytes · width · height · duration_ms
```

Cuando llegue el importador CAD, alguien va a mirar esa tabla y pensar,
razonablemente, que un `.dwg` es «un fichero con su hash en un bucket» y que
basta añadir `kind = 'cad'`. Luego un `.ifc`. Luego una nube de puntos como
`kind = 'point_cloud'`. Y como `ai.dataset_versions` ya sabe agrupar assets en
conjuntos versionados e inmutables, aparecerá la tentación de modelar «el plano
del almacén, versión 3» como una versión de dataset.

**Cada uno de esos pasos es defendible por separado y el resultado conjunto es
irreversible.** No hay ningún momento en el que alguien decida «vamos a meter el
gemelo digital dentro del dominio de IA»: se llega ahí por seis decisiones
pequeñas que nadie considera arquitectónicas.

Este ADR existe para que la séptima persona que abra `ai.assets` con un `.dwg` en
la mano encuentre escrito por qué no va ahí.

---

## 2. Por qué un plano CAD no es un asset de IA

No es una cuestión de gusto. Son propiedades que no se cumplen.

**El régimen de aislamiento es el opuesto.** `ai.*` es régimen Platform Owner:
`USING (core.is_platform_owner())`. Un plano del almacén del cliente X es **dato
del cliente X**. En `ai.assets` pasarían dos cosas, las dos malas: ningún usuario
del tenant podría ver el plano de su propio almacén, y si alguien relajara la
política para arreglarlo, un cliente vería la distribución física de otro. Es
exactamente el razonamiento que llevó a poner `perception` en régimen tenant y no
en `platform`, y aplica igual aquí.

**El ciclo de vida no coincide.** Un asset de IA es inmutable por diseño: se
sube, se le calcula el `sha256`, se deduplica y no cambia. Un plano se **revisa**:
llega la revisión B del arquitecto, se añade un pasillo, se mueve una estantería.
Necesita versionado con linaje —qué revisión sustituye a cuál y por qué—, no
deduplicación por contenido. `UNIQUE (project_id, sha256)` sirve para impedir que
la misma foto entre dos veces en un dataset; sobre un plano no significa nada útil.

**Las columnas mienten.** `width` y `height` en píxeles son la forma de una
imagen. Un `.dwg` tiene extensión en **metros**, un sistema de coordenadas, una
escala y una unidad. Guardar 1920×1080 para un plano no es incompleto: es falso.

**La deduplicación por hash es activamente dañina.** Dos plantas de un mismo
edificio pueden exportarse a ficheros idénticos byte a byte si el CAD las genera
desde la misma plantilla. En un dataset de entrenamiento eso es una duplicación
que hay que impedir; en un catálogo de planos son dos documentos legítimos y
distintos, y `uq_asset_contenido` rechazaría el segundo.

**Y una que se ve tarde:** `ai.assets` tiene FK compuesta a `ai.projects`. Un
plano de almacén no pertenece a un proyecto de entrenamiento. Meterlo ahí obliga
a inventar un proyecto ficticio para colgarlo, y a partir de ese momento el
esquema deja de poder explicarse.

---

## 3. Decisión

Se reserva el schema **`spatial`** para el dominio del espacio físico.

### 3.1 Régimen y frontera

| | |
|---|---|
| **Schema** | `spatial` |
| **Régimen de aislamiento** | **TENANT** — como `core` y `perception`, nunca como `ai` |
| **Contenido** | geometría, planos de origen, nubes de puntos, mallas 3D, calibración de sensores |
| **Prohibido** | pesos de modelos, imágenes de entrenamiento, anotaciones, datasets |

Queda establecido, y es la regla operativa de este ADR:

> **Ninguna tabla de `ai.*` puede almacenar geometría del mundo físico, y ninguna
> tabla de `spatial.*` puede almacenar artefactos de entrenamiento.**

### 3.2 Sobre el nombre

Descarto las dos alternativas que se plantearon, con el motivo:

- **`digital_twin`** nombra un *concepto de producto*, no un dominio de datos. El
  schema contendría cosas que no son el gemelo: el `.dwg` original que el cliente
  envió, un levantamiento topográfico, la calibración de una cámara. Nombrar por
  la característica y no por el dato lleva a que dentro de dos años haya tablas
  que no encajan en su propio schema. El gemelo digital es una **vista** de estos
  datos, y de hecho ya existe como tal: `frontend/src/design/foundation/twin/`.
- **`spaces`** es demasiado vago y colisiona con la palabra corriente. «¿En qué
  espacio está esto?» dejaría de tener respuesta única.

**`spatial`** describe lo que el dato *es*, coincide con el vocabulario de PostGIS
—que es lo que se usará— y no promete ninguna característica concreta.

### 3.3 Los dominios del proyecto, y las dos acepciones de «proyecto»

La estructura que se pidió reservar es esta:

```
Proyecto
├── AI            modelos, datasets, anotaciones, pesos
├── Assets        binarios
├── Images        material visual
├── Digital Twin  ← este ADR
├── Missions      vuelos de dron, rondas programadas
└── Observations  lo que la IA afirma haber visto
```

Recogerla obliga a aclarar algo que hoy es ambiguo, porque **«proyecto» significa
dos cosas distintas** y confundirlas es la vía rápida a que todo acabe otra vez
dentro de `ai`:

| Acepción | Qué es | Dónde vive |
|---|---|---|
| **Proyecto de entrenamiento** | un conjunto de imágenes, clases y modelos que se entrenan juntos | `ai.projects`, ya existe |
| **Proyecto físico / implantación** | este almacén, de este cliente: su edificio, sus sensores, sus drones | hoy lo cubre `core.warehouses` |

El árbol de arriba es el del **segundo**. Y ahí `AI` es solo una rama: el
almacén tiene geometría, misiones y observaciones con independencia de que haya
un modelo entrenado.

Con eso, la respuesta a por qué `ai.assets` y `ai.images` **sí** están dentro de
`ai` y no como ramas hermanas: son material de **entrenamiento**, pertenecen a un
proyecto de entrenamiento y son régimen owner. Los binarios del proyecto físico
—planos, nubes de puntos, mallas— son otra cosa, con otro dueño y otro régimen, y
por eso van en `spatial`. Dos ramas que en el árbol conceptual se llaman parecido y
en el esquema no pueden compartir tabla.

**`Missions` queda reservada igualmente.** Ya la asumí sin decirlo: el diseño de
`perception.inference_sessions` lleva un `mission_id` con la nota «futuro:
core.missions». Al reservar el espacio físico conviene fijar también dónde va, y no
es en `ai`:

```
core.missions          (TENANT)  una ronda o vuelo planificado: qué recorrer, cuándo
core.devices           (TENANT)  el dron o la cámara que la ejecuta
spatial.navigation_graph          por dónde puede pasar
perception.inference_sessions     qué modelo corrió durante la misión
```

Una misión es una operación de negocio del tenant —se programa, se ejecuta, se
audita—, así que `core` es su sitio; consume geometría de `spatial` y produce
sesiones en `perception`. No la implemento ni la diseño aquí: solo queda dicho que
**no pertenece a `ai`**, que es lo que este ADR reserva.

### 3.4 La relación con `core`: no es un dominio virgen

Esto es lo menos evidente del documento y lo más importante para no duplicar.

**`core` YA modela el espacio físico**, y lo hace bien: `core.warehouses` →
`core.areas` → `core.locations` es la jerarquía **lógica** —qué ubicación existe,
cómo se llama, a qué área pertenece— y es la que usa el inventario. `A-01-03` es
una ubicación real y `core.locations` es su fuente de verdad.

Lo que `core` **no** modela es la **geometría**: dónde está `A-01-03` en metros,
qué volumen ocupa, qué forma tiene la estantería que la contiene, por dónde puede
pasar un AGV para llegar.

Así que la relación correcta es:

```
core.locations   (identidad lógica: existe, se llama A-01-03, está en el área 7)
      ↑ 1:0..1
spatial.location_geometry   (geometría: posición, dimensiones, orientación)
```

**`spatial` aporta geometría PARA las entidades de `core`. No las sustituye ni las
duplica.** Un almacén sin plano cargado sigue siendo operativo: el inventario
funciona con la jerarquía lógica y la geometría es opcional. Esa direccionalidad
—`spatial` referencia a `core`, nunca al revés— es lo que permite implementar el
dominio espacial años después sin tocar el inventario.

El error que esto previene es el simétrico del de §2: crear
`spatial.locations` con su propia jerarquía y acabar con dos verdades sobre qué
ubicaciones existen.

### 3.5 Forma prevista, sin comprometer el modelo

Solo para fijar que las piezas son distintas de las de `ai`:

```
spatial.source_documents     el .dwg / .dxf / .ifc tal como llegó, con su revisión
spatial.import_runs          una pasada del importador CAD, con su log y errores
spatial.layers               capas del CAD y a qué se traduce cada una
spatial.floors               plantas o niveles del edificio
spatial.footprints           huella 2D de racks, muros, pasillos, zonas
spatial.location_geometry    geometría de una core.locations
spatial.point_clouds         levantamientos LiDAR o fotogramétricos
spatial.meshes               mallas 3D derivadas, para el visor
spatial.sensor_placements    dónde está cada cámara y su calibración
spatial.navigation_graph     nodos y aristas transitables (AGV, drones)
```

Nada de esto se crea ahora. Lo que importa es que **ninguna de esas diez tablas
tiene un equivalente razonable en `ai.*`**, que es la prueba de que el dominio es
distinto y no una subdivisión.

### 3.6 PostGIS está disponible, y eso cambia el diseño futuro

Verificado hoy contra la base real:

```
postgis           3.3.7   disponible, NO instalada
postgis_raster    3.3.7   disponible
postgis_topology  3.3.7   disponible
pgrouting         3.4.1   disponible, NO instalada
```

Consecuencia para este ADR: la geometría podrá tener **tipo real**
(`geometry(PolygonZ, …)`), con índices GiST y operadores de intersección, en lugar
de `jsonb` con arrays de coordenadas. Y `pgrouting` cubre el grafo de navegación
sin escribir un buscador de caminos.

No se instala nada ahora —una extensión es una decisión de plataforma con su
propio coste de mantenimiento— pero queda registrado que **la opción existe**, para
que quien implemente el dominio no empiece modelando polígonos en `jsonb` por
suponer que no hay alternativa. Ese sería un trabajo perdido difícil de deshacer.

---

## 4. La zona gris: nubes de puntos

Es el único caso realmente ambiguo, y merece resolverse ahora porque es donde la
frontera se rompería.

Una nube de puntos LiDAR puede ser dos cosas a la vez:

1. **un levantamiento del edificio** — geometría, sirve para construir el gemelo;
2. **entrada de entrenamiento** — si algún día se entrena un modelo con
   `input_type = 'point_cloud'`, que ya está en el dominio `ai.input_type`.

La resolución no es elegir un lado, es distinguir origen de uso:

> **`spatial` posee el levantamiento original.** Si se usa para entrenar, se
> registra un `ai.assets` que **referencia** ese origen, con su propio `sha256` y
> su propio ciclo de vida de dataset.

Es el mismo patrón que ya se aplicó a las observaciones: `perception.observations`
guarda `model_version_id` para saber su proveniencia, sin que `ai` sepa nada de
`perception`. Aquí sería `ai.assets.spatial_source_id` nullable, y la dirección de
la dependencia es `ai → spatial`, nunca al revés.

Sin esa regla escrita, la primera nube de puntos que se use para entrenar
terminará viviendo solo en `ai.assets`, y el gemelo digital perderá su fuente.

---

## 5. Consecuencias

### Lo que este ADR prohíbe explícitamente

1. Añadir `cad`, `dwg`, `dxf`, `ifc`, `point_cloud`, `mesh`, `floorplan` o similar
   al CHECK de `ai.assets.kind`.
2. Modelar planos, plantas o revisiones de plano como `ai.dataset_versions`.
3. Crear `spatial.locations`, `spatial.warehouses` o `spatial.areas` con jerarquía
   propia: la identidad lógica es de `core`.
4. Cualquier FK de `spatial` hacia `ai`. La dependencia va en el otro sentido.
5. Poner tablas de `spatial` bajo `is_platform_owner()`: son datos del cliente.

Las cinco son comprobables. Cuando el dominio se implemente, la primera migración
debería incluir una prueba que falle si el CHECK de `ai.assets.kind` contiene
alguno de los valores del punto 1 — igual que la migración 0028 comprueba que el
estado `trained` no existe en `ai.images`.

### Coste de reservar ahora

Prácticamente ninguno: este documento y un schema que no existe todavía. No hay
migración, no hay código, no hay privilegios que conceder.

### Coste de no reservar

Alto y difícil de estimar a la baja. Si los planos entran en `ai.assets`, salir de
ahí requiere: schema nuevo, mover filas con sus binarios en Storage, reescribir las
políticas de RLS de datos que pasan de régimen owner a régimen tenant —lo que
implica revisar quién los vio mientras estuvieron mal ubicados—, y corregir todo
el código que los consulte. Con datos reales de clientes dentro.

---

## 6. Cuándo se implementa

Sin fecha. Depende de dos cosas que no controlamos: que haya planos reales de un
almacén y que el visor 3D justifique la geometría precisa.

Orden natural cuando llegue: `spatial.source_documents` e `import_runs` primero
—para poder recibir un fichero y registrar qué pasó al leerlo— y solo después la
geometría derivada. El importador CAD antes que el gemelo, porque sin datos de
origen el gemelo no tiene qué mostrar.

**No bloquea nada del plan actual.** Bloques 1 a 9 del módulo de IA, importaciones
Excel y `perception` son independientes.

---

## 7. Alternativas consideradas

**Meter todo en `ai.assets` con más valores de `kind`.** Descartada por §2: cinco
propiedades que no se cumplen, y el régimen de aislamiento equivocado.

**Un schema `files` genérico para todo binario del sistema.** Tentador porque
evita repetir columnas de metadatos. Descartada por la misma razón que se
descartó unificar `core.files` con `ai.assets` en la arquitectura del módulo:
obligaría a políticas de RLS con `IS NULL` en el predicado para distinguir
regímenes, que es exactamente la forma del agujero que hubo que corregir en la
migración 0017 —donde con `tenant_id` fijado y sin identidad se veían filas
ajenas—. Dos regímenes de aislamiento, dos schemas.

**Geometría dentro de `core.locations` como columnas.** Descartada: haría que cada
lectura de inventario arrastre polígonos que no necesita, y ataría el ritmo de
evolución del gemelo al de la tabla más consultada del sistema.

---

## 8. Cómo se relaciona con lo demás

```
core        (TENANT)     identidad logica: warehouses, areas, locations, inventario
platform    (OWNER)      gobierno: owners, auditoria privilegiada
ai          (OWNER)      autoria de modelos: proyectos, datasets, anotaciones, pesos
perception  (TENANT)     evidencia: sesiones de inferencia, observaciones
spatial     (TENANT)     ← ESTE ADR. Geometria del espacio fisico
```

Con las dependencias permitidas:

```
spatial ──→ core          geometria PARA entidades logicas
ai      ──→ spatial       un asset puede citar su levantamiento de origen (§4)
spatial ──✗ ai            PROHIBIDO
```

Cuatro schemas hoy, cinco cuando esto se implemente. Y sigue cumpliéndose la regla
que el proyecto ya seguía sin haberla escrito: **cada schema codifica un régimen de
aislamiento**, así que quien crea una tabla nueva sabe qué política le toca sin
tener que copiar la de al lado.

### 8.1 Dos aclaraciones que este ADR fija de paso

Salieron al revisar el módulo de IA y encajan aquí porque son de la misma familia
—qué es fuente de verdad y qué es proyección—, así que se anotan para no dejarlas
solo en un comentario de código. Las dos están además escritas en la base, en la
migración `0044`, que es donde las lee quien inspecciona el esquema.

**`ai.models_resolved` es un read model, no el contrato del dominio.** Las
entidades reales son `ai.models`, `ai.architectures` y `ai.frameworks`. La vista
existe para no repetir un JOIN de tres tablas en cada lectura, y nada más:

- toda **escritura** va contra `ai.models`. La vista no es actualizable, y no debe
  hacerse actualizable con reglas ni `INSTEAD OF`: eso la convertiría en una
  segunda puerta de entrada con sus propias invariantes;
- sus columnas derivadas se exponen como **solo lectura**, y su conjunto puede
  cambiar sin que sea un cambio de contrato del dominio.

La migración 0044 comprueba que la vista **no** es insertable. No por desconfianza:
PostgreSQL haría auto-actualizable una vista que fuese un `SELECT` simple de una
tabla, así que si alguien simplifica el JOIN en el futuro se volvería escribible sin
que nadie lo decidiera.

**El catálogo es vigente; el entrenamiento es histórico.** En una frase:

> `ai.architectures` representa la configuración **recomendada vigente**;
> `ai.training_runs.config_snapshot` representa la configuración **utilizada
> históricamente**.

Es lo que hace seguro que `hyperparam_schema` evolucione. Y previene el
razonamiento inverso, que es el peligroso: «el catálogo dice `imgsz 640`, así que
la v3 se entrenó a 640». Falso, e indetectable a simple vista. Para responder «¿con
qué parámetros se entrenó esta versión?» **nunca** se consulta el catálogo.

---

## 9. Deuda que este ADR deja anotada

**La numeración de ADR está inconsistente y no la arreglo aquí.**

- `docs/adr/` no existía; los ADR 001-006 están incrustados en
  `ARCHITECTURE.md §14`.
- ADR-007 está reclamado por dos documentos con significados distintos
  (`TASKS.md` → *job-dispatcher*; `PHASE_0_EXECUTION_BACKLOG.md` → *propagación de
  claims*), y ninguno de los dos existe como archivo.
- Circulan dos esquemas incompatibles para 003-005: `ARCHITECTURE.md` dice *Clean
  Architecture / CQRS Lite / Async-First*; `PHASE_0_PLAN.md` dice *rls-v2 /
  jwt-minimal / role-model*.

Resolverlo significa decidir qué numeración es la buena y extraer los ADR de
`ARCHITECTURE.md` a archivos, o renumerar. Es trabajo sobre documentos de Kiro y
conviene acordarlo antes de tocarlos. Mientras no se resuelva, cualquier ADR nuevo
debería tomar 009 o superior para no empeorarlo.
