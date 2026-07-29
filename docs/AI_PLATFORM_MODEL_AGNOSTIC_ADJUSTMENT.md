# OLO_IA — Ajuste a plataforma de IA agnóstica del modelo

> **Estado: análisis para revisión. Nada ejecutado, nada modificado.**
> No hay migraciones nuevas ni cambios en las existentes. El Bloque 0 sigue tal
> como quedó: 30 migraciones aplicadas, 71 pruebas en verde.
>
> Verificado contra la base real el 2026-07-29, antes de escribir esto:
> las 7 tablas de IA tienen **0 filas**. La única fila de `platform` es el owner.

---

## 0. Lo que encontré al analizarlo

Cinco cosas que conviene decidir con el ajuste, porque son más caras después.

| # | Hallazgo | Consecuencia |
|---|---|---|
| **H-1** | El flujo no es una cadena, es una bifurcación | Imágenes y anotaciones NO pueden colgar del modelo |
| **H-2** | La agnosticidad no la da una columna `framework` | Hace falta una tabla de capacidades por arquitectura |
| **H-3** | SAM2, Grounding DINO y CLIP **no se entrenan** | Una versión de modelo debe poder existir sin entrenamiento |
| **H-4** | Las observaciones son datos **de tenant**, no de plataforma | Otro régimen de aislamiento, otro schema |
| **H-5** | Un CHECK del Bloque 0 impide clasificación y OCR | Hay que relajarlo antes de la Fase 5 |

H-1 y H-4 son los que cambian la forma del sistema. Los explico donde toca.

---

## 1. Qué cambiaría

### 1.1 El flujo propuesto es correcto para versionar y insuficiente para el dato

Pediste evolucionar a:

```
Proyecto → Modelo IA → Dataset → Entrenamiento → Versión → Publicación
```

Eso es exactamente correcto **para la cadena de versionado**. Pero si se toma
literalmente para todo el dato, el dataset y sus anotaciones colgarían del
modelo, y ahí aparece un problema serio. El caso que lo revela es tu propio
ejemplo:

> Proyecto: Inventario EPA
> Modelos: Detector YOLO · Segmentador SAM · OCR · Detector de daños · Clasificador de pallets

Las **imágenes son las mismas**. Los mismos frames del dron alimentan al
detector, al segmentador y al OCR. Si cada modelo tuviera su pool de imágenes:

- se multiplicaría el almacenamiento por el número de modelos;
- la deduplicación por `sha256` dejaría de funcionar entre modelos;
- extraer frames de un vídeo habría que repetirlo por modelo.

Y las **anotaciones se comparten entre modelos que aprenden lo mismo**. El
experimento más común de todo el aprendizaje automático es «¿YOLO11 o RT-DETR
sobre los mismos datos?». Si las anotaciones colgaran del modelo, ese
experimento exigiría **volver a anotar todo**, que es el trabajo humano más caro
del sistema. Sería el peor resultado posible del ajuste.

La forma real es una bifurcación:

```
proyecto
 │
 ├── assets ──→ images                     ← pool COMPARTIDO, nivel proyecto
 │                 └── annotations          ← sobre imágenes del proyecto
 ├── classes                                ← vocabulario del proyecto
 │
 └── models                                 ← NUEVO nivel
       ├── model_classes  (subconjunto de classes + índice de entrenamiento)
       ├── dataset_versions ──→ dataset_items
       ├── training_runs ──→ training_events
       └── model_versions ──→ evaluations
```

**Lo que sube al modelo:** dataset, entrenamiento, versiones, publicación.
**Lo que se queda en el proyecto:** assets, imágenes, clases, anotaciones.

Con eso, `Detector YOLO` y `Detector RT-DETR` comparten imágenes y anotaciones
sin copiar nada, y `OCR` y `SAM` trabajan sobre las mismas imágenes con
anotaciones de otro `kind`.

### 1.2 Cómo se resuelve el vocabulario por modelo

Si las clases son del proyecto, ¿cómo distingue el `Detector de daños`
(`roto`, `mojado`) del `Detector de pallets` (`pallet`, `caja`, `etiqueta`)?

Con una tabla de enlace: `ai.model_classes (model_id, class_id, training_index)`.

Cada modelo **declara qué subconjunto del vocabulario del proyecto consume**, y
lleva su propio índice contiguo `0..N-1`, que es lo que necesita el framework.

Esto refina —y refuerza— la decisión 4 del Bloque 0. Hasta ahora argumenté que
`class_index` **era** el índice YOLO y por eso debía ser inmutable. Con varios
modelos por proyecto eso ya no se sostiene: el detector de daños necesita
`0,1,2` para sus tres clases, pero `uq_class_indice UNIQUE (project_id,
class_index)` le habría dado `3,4,5`.

La separación correcta:

| Columna | Qué es | Alcance | Inmutable |
|---|---|---|---|
| `classes.class_index` | identidad estable de la clase | proyecto | sí, como está |
| `model_classes.training_index` | índice que verán los pesos | modelo | sí, mientras el modelo tenga versiones |
| `dataset_versions.class_snapshot` | el mapa congelado que interpreta unos pesos | versión de dataset | sí, por construcción |

**La garantía de seguridad no se debilita: se mueve al sitio correcto y se
refuerza.** El peligro original era «los pesos guardan índices; renumerar hace
que el modelo mienta sin dar error». Quien resuelve eso definitivamente es
`class_snapshot`, que ya es inmutable en el Bloque 0. `class_index` sigue siendo
inmutable porque es identidad, y `training_index` hereda la misma regla.

Ninguna columna del Bloque 0 cambia de tipo ni desaparece. Cambia lo que
significa `class_index`, y eso es documentación y capa de servicio.

### 1.3 La agnosticidad no la da una columna de texto

Aquí está el riesgo real del ajuste. Si `framework` y `architecture` son solo
`varchar`, el worker acaba así:

```
if architecture == 'yolo11':    ...
elif architecture == 'rtdetr':  ...
elif architecture == 'sam2':    ...
```

Eso **es** la refactorización que quieres evitar, solo que trasladada del
esquema al código. La agnosticidad de verdad consiste en sacar de código lo que
varía por arquitectura y meterlo en datos:

`ai.architectures` como **tabla de capacidades**, no como lista de nombres:

```
ai.architectures
  code                  'yolo11n' | 'rtdetr-l' | 'sam2-b' | 'grounding-dino-t' …
  framework_code        → ai.frameworks
  display_name
  supported_tasks       text[]      -- ['detect'] · ['segment'] · ['detect','segment']
  supported_input_types text[]
  requires_training     boolean     -- SAM2 y Grounding DINO: false
  requires_annotations  boolean     -- CLIP zero-shot: false
  annotation_kinds      text[]      -- ['bbox'] · ['polygon'] · ['image_label'] · ['text']
  weights_extension     '.pt' | '.onnx' | '.safetensors'
  default_hyperparams   jsonb       -- imgsz, batch, lr, patience por defecto
  hyperparam_schema     jsonb       -- qué acepta: el formulario se genera de aquí
  min_images_recommended integer
  is_active             boolean
```

Con esto:

- **el formulario de entrenamiento se genera** desde `hyperparam_schema`, así que
  añadir RT-DETR no toca la interfaz;
- **el validador rechaza combinaciones imposibles** antes de gastar una GPU: un
  modelo `segment` sobre una arquitectura cuyo `supported_tasks` no lo incluye;
- **el worker consulta y despacha** a un adaptador por `framework`, no por
  arquitectura: `ultralytics`, `torch`, `onnx`. Los adaptadores son pocos y
  estables; las arquitecturas son muchas y crecen.
- añadir Florence o Qwen-VL es **una fila**, no una migración ni un despliegue.

Frente a esto, `task` e `input_type` sí deben ser CHECK y no tablas: son taxonomías
pequeñas y semánticas, y añadir una es una decisión arquitectónica que merece
pasar por migración porque cambia lo que la plataforma *hace*.

### 1.4 Los modelos que no se entrenan

SAM2 con prompt, Grounding DINO con texto y CLIP en zero-shot **no se entrenan**:
se usan con pesos preentrenados. La arquitectura planeada asumía
`model_versions.run_id NOT NULL UNIQUE` — «toda versión nace de un
entrenamiento».

Eso es falso para tres de los modelos de tu lista. Una versión de modelo debe
poder tener tres orígenes:

| `origin` | `run_id` | Caso |
|---|---|---|
| `trained` | obligatorio | entrenamiento propio |
| `pretrained` | NULL | pesos oficiales descargados (SAM2, DINO, CLIP) |
| `imported` | NULL | pesos que alguien trae de fuera |

No afecta al Bloque 0 —`ai_model_versions` no existe todavía— pero sí corrige el
diseño del Bloque 5 antes de implementarlo.

---

## 2. Qué tablas nuevas aparecerían

### 2.1 Dominio de autoría (régimen Platform Owner)

| Tabla | Contenido | Bloque |
|---|---|---|
| `ai.frameworks` | Ultralytics, PyTorch, TensorFlow, OpenMMLab, ONNX, Custom | 1 |
| `ai.architectures` | capacidades por arquitectura (§1.3) | 1 |
| **`ai.models`** | **la entidad que pediste** | 1 |
| `ai.model_classes` | vocabulario del modelo + `training_index` | 1 |

`ai.models`, con lo que pediste y cuatro columnas más que justifico:

```
ai.models
  id                  uuid PK
  project_id          uuid → ai.projects(id)
  name                varchar(120)
  slug                varchar(120)          -- rutas estables, como en projects
  description         text
  framework_code      → ai.frameworks(code)
  architecture_code   → ai.architectures(code)
  task                'detect'|'segment'|'classify'|'ocr'|'track'|'pose'|'count'|'regress'|'embed'
  input_type          'image'|'video'|'frames'|'point_cloud'|'depth'|'thermal'|'fusion'
  status              'draft'|'collecting'|'annotating'|'training'|'published'|'deprecated'|'archived'
  current_version_id  uuid NULL → ai.model_versions(id)
  purpose             text                  -- para qué sirve, en lenguaje de negocio
  requires_training   boolean               -- copiado de la arquitectura al crear
  config              jsonb                 -- prompts de SAM/DINO, charset del OCR
  created_at, created_by, updated_at, updated_by, version, deleted_at

  UNIQUE (project_id, slug) WHERE deleted_at IS NULL
  UNIQUE (project_id, id)                   -- destino de FK compuestas
  UNIQUE (project_id) ... no: varios modelos por proyecto, sin restricción
```

Las cuatro añadidas y por qué:

- **`slug`** — mismo motivo que en proyectos: rutas y referencias estables que no
  se rompen al renombrar.
- **`purpose`** — con doce modelos por proyecto, `name` no basta para saber cuál
  usar. Es el campo que evita que alguien publique el modelo equivocado.
- **`requires_training`** — se copia de la arquitectura al crear el modelo y se
  congela. Si mañana cambia la fila de la arquitectura, los modelos ya creados no
  deben cambiar de naturaleza.
- **`config`** — el prompt de SAM2, las clases de texto de Grounding DINO, el
  charset del OCR. Sin este campo, cada familia de modelo pediría columnas
  propias y la tabla se convertiría en una unión de casos.

`current_version_id` es nullable y crea un ciclo con `ai.model_versions`, igual
que `ai_projects.current_model_version_id` en el diseño anterior. Nullable lo
rompe sin FK diferida.

### 2.2 Dominio de percepción (régimen **tenant**) — §4 explica por qué

| Tabla | Contenido | Bloque |
|---|---|---|
| `perception.inference_sessions` | una ejecución de inferencia en producción | diseño ahora, implementación después |
| `perception.observation_batches` | una pasada de percepción (un vuelo, una ronda) | ídem |
| `perception.observations` | lo que el modelo **afirma** haber visto | ídem |

### 2.3 Lo que ya estaba planeado y no cambia de naturaleza

`ai.training_configs`, `ai.training_runs`, `ai.training_events`,
`ai.model_versions`, `ai.evaluations` — igual que en la arquitectura aprobada,
solo que ahora cuelgan de `ai.models` en lugar de `ai.projects`.

`platform.ai_inference_tests` se queda en régimen owner: es el owner probando un
modelo, no producción. Es distinta de `perception.inference_sessions` y las dos
deben existir.

---

## 3. Qué relaciones cambiarían

### 3.1 Antes y después

```
ANTES                          DESPUÉS
ai_projects                    ai.projects
 ├─ ai_classes                  ├─ classes ────────────┐
 ├─ ai_assets                   ├─ assets              │ (sin cambio de padre)
 │   └─ ai_images               │   └─ images          │
 │       └─ ai_annotations      │       └─ annotations ┘
 ├─ ai_dataset_versions         └─ models          ← NIVEL NUEVO
 │   └─ ai_dataset_items             ├─ model_classes ─→ classes
 └─ (runs, versions)                 ├─ dataset_versions
                                     │   └─ dataset_items ─→ images
                                     ├─ training_runs
                                     └─ model_versions
```

**Se reparentan tres tablas** (dos existen, una está planeada):

| Tabla | Padre antes | Padre después |
|---|---|---|
| `dataset_versions` | proyecto | **modelo** |
| `dataset_items` | versión de dataset (+ project_id) | versión de dataset (+ **model_id**) |
| `training_runs` (planeada) | proyecto | **modelo** |

**No se reparenta ninguna:** classes, assets, images, annotations. Se quedan en
el proyecto, por §1.1.

### 3.2 Las FK compuestas siguen siendo el mecanismo

El patrón del Bloque 0 se mantiene y gana un eslabón. `dataset_items` referencia
imágenes que deben ser del **mismo proyecto** que el modelo:

```
dataset_versions   FK (project_id, model_id) → models(project_id, id)
dataset_items      FK (model_id, dataset_version_id) → dataset_versions(model_id, id)
                   FK (project_id, image_id)         → images(project_id, id)
                   + project_id, para poder cerrar las dos
model_classes      FK (project_id, model_id) → models(project_id, id)
                   FK (project_id, class_id) → classes(project_id, id)
```

`dataset_items` acaba llevando `project_id`, `model_id`, `dataset_version_id` e
`image_id`. Parece redundante y no lo es: es lo que hace **imposible por el
motor** que un dataset del `Detector de daños` incluya una imagen de otro
proyecto, o una clase que su modelo no declaró. Es el mismo argumento verificado
empíricamente en la fase 0, un nivel más abajo.

### 3.3 El desacoplamiento IA → Inventario

Esto es lo que pediste y es la parte más importante del ajuste.

```
Dron → Frames → Modelo IA → OBSERVACIONES → Motor de comparación → Inventario
                             ╰──────────── la costura ────────────╯
```

Cuatro reglas que hacen que el desacoplamiento sea real y no una intención:

1. **Ninguna tabla de IA tiene FK hacia inventario.** Ni al revés. La única
   relación entre los dos mundos la establece el motor de comparación, que **lee**
   observaciones y **lee** inventario, y escribe en sus propias tablas.
2. **Las observaciones son append-only.** Son evidencia: lo que el modelo afirmó
   en un momento. Corregir una observación sería falsificar el registro. Si el
   modelo se equivocó, se marca `discarded` y se emite otra; el histórico queda.
3. **`label` NO es una FK a `ai.classes`.** Es un código estable más su texto,
   denormalizado — el mismo razonamiento que `class_snapshot`. Una observación de
   hace seis meses tiene que seguir siendo legible aunque la clase se haya
   desactivado o renombrado, y el catálogo de clases es metadato de plataforma
   mientras la observación es dato del cliente.
4. **La observación nunca dice «hay 12 pallets en A-01-03».** Dice «detecté algo
   parecido a un pallet, con confianza 0.87, en este píxel de este frame, y mi
   mejor estimación de ubicación es A-01-03 con confianza 0.61». La diferencia
   entre percepción y hecho vive en las columnas, no en la interpretación de quien
   lea la tabla.

```
perception.observations                     -- tenant, append-only
  id, tenant_id, batch_id
  observed_at
  -- QUÉ se percibió
  label_code, label_name                    -- denormalizado a propósito
  confidence            numeric(4,3)
  -- DÓNDE, con su propia incertidumbre
  warehouse_id, area_id, location_id        -- location puede ser inferida
  location_confidence   numeric(4,3)
  -- geometría en el frame (normalizada, como las anotaciones)
  frame_ref, cx, cy, w, h
  -- posición en el mundo, si el dron la aporta
  world_x, world_y, world_z
  -- carga variable por tipo de observación
  attributes            jsonb               -- {sscc, texto_ocr, cantidad, estado}
  -- PROVENIENCIA: sin esto una observación no es auditable
  model_version_id      → ai.model_versions(id)  ON DELETE RESTRICT
  inference_session_id  → perception.inference_sessions(id)
  status                'new'|'matched'|'unmatched'|'superseded'|'discarded'
```

El `ON DELETE RESTRICT` hacia `ai.model_versions` es deliberado: **no se puede
borrar un modelo del que dependen observaciones**, porque se perdería la
trazabilidad de cómo se llegó a una discrepancia de inventario. Encaja con la
política de retención que ya fijaste —modelos publicados para siempre— y la
convierte en una garantía del motor en lugar de una intención.

```
perception.inference_sessions               -- tenant
  id, tenant_id
  model_id, model_version_id                -- referencia a ai.*
  warehouse_id
  trigger              'mission'|'manual'|'scheduled'|'stream'
  mission_id           -- futuro: core.missions
  device_id            -- futuro: core.devices
  hardware             jsonb    -- {gpu:'RTX 4090', driver, torch, vram_mb}
  fps_target, fps_actual  numeric(6,2)
  confidence_threshold numeric(4,3)
  iou_threshold        numeric(4,3)
  frames_processed, observations_emitted  integer
  started_at, ended_at, duration_ms
  status               'running'|'complete'|'failed'|'cancelled'
  error_code, error_message
  requested_by         → core.users(id)
```

`hardware` y `fps_actual` no son adorno: cuando alguien pregunte «¿por qué el
conteo del martes fue peor?», la respuesta suele estar ahí — otra GPU, otro
umbral de confianza, la mitad de fps.

**La costura con inventario** (bloque posterior, solo la nombro para fijar el
límite): `perception.reconciliation_runs` y `perception.discrepancies`. Ese motor
es el único componente autorizado a leer las dos mitades, y su salida es una
propuesta de ajuste que alguien aprueba — no una escritura directa en inventario.

---

## 4. ¿Schema separado para IA? Sí, y son dos

Tu pregunta era si tiene sentido que todo el dominio de IA viva en `platform`.
**No lo tiene, pero por una razón distinta de la que sugieres.**

### 4.1 La regla que ya sigue este proyecto sin haberla escrito

Hoy hay dos schemas de negocio y cada uno codifica **un régimen de aislamiento**:

| Schema | Régimen | Política |
|---|---|---|
| `core` | tenant | `current_tenant_id()` + membresía |
| `platform` | plataforma | `is_platform_owner()` |

Esa correspondencia es una **propiedad de seguridad**, no un detalle
organizativo. En el Bloque 0 escribí la misma política nueve veces y siempre la
misma, porque el schema determinaba cuál tocaba. Si mezcláramos regímenes dentro
de un schema, la décima tabla la escribiría alguien copiando de la novena — y
sería un bloqueo o una fuga. Ya vi las dos formas de ese error en este proyecto:
el arranque circular de `core.users` y la fuga que corregí en 0017.

### 4.2 Por eso las observaciones no pueden ir en `platform`

**Las observaciones son datos del cliente.** Un dron volando en el almacén del
tenant X produce observaciones sobre el inventario del tenant X. Si vivieran en
`platform`:

- con la política de owner, **ningún usuario del tenant podría ver sus propios
  datos** y el módulo sería inútil;
- si alguien la relajara para arreglarlo, **un tenant vería las observaciones de
  otro**. Es la peor fuga posible en un SaaS multi-tenant: fotos, distribución y
  mercancía de un cliente visibles a otro.

Esto no es una preferencia de diseño. Es el motivo por el que el ajuste hay que
hacerlo **ahora** y no cuando existan las tablas.

### 4.3 Recomendación

**Cuatro schemas, cada uno con una razón distinta que se puede decir en una
línea:**

| Schema | Régimen | Volumen | Perfil de permisos | Contenido |
|---|---|---|---|---|
| `core` | tenant | normal | `olo_app` | negocio: tenants, almacenes, inventario |
| `platform` | owner | mínimo | `olo_app` | **gobierno**: owners, auditoría privilegiada, config |
| `ai` | owner | medio | `olo_app` + **worker de entrenamiento** | autoría: proyectos, modelos, datasets, anotaciones, runs |
| `perception` | **tenant** | **el mayor del sistema** | `olo_app` + **worker de inferencia** | salida: sesiones, observaciones |

Cuatro razones para separar `ai` de `platform`, en orden de peso:

1. **Perfil de permisos.** El worker de entrenamiento necesita escribir en
   `training_runs` y `training_events` y en **nada más**. `ALTER DEFAULT
   PRIVILEGES` funciona por schema: con `ai` aparte, el worker tiene su perfil y
   cada tabla nueva lo hereda. Dentro de `platform` habría que conceder tabla a
   tabla y acordarse cada vez — y `platform` contiene justamente `owners` y el
   registro de auditoría, lo último a lo que debe llegar un worker.
2. **`platform` recupera su significado.** Pasa a ser lo que su nombre dice:
   gobierno de la plataforma. Nueve tablas, tres de gobierno y seis de IA es un
   schema sin tema.
3. **Perfil operativo.** `perception.observations` será la tabla más grande del
   sistema por órdenes de magnitud: un dron a 5 fps con 20 detecciones por frame
   son 100 filas por segundo. Retención, particionado, vacuum y backup no tienen
   nada que ver con los de `platform.owners`, que tiene una fila.
4. **Legibilidad.** `ai.models` frente a `platform.ai_models`. Cosmético con dos
   tablas; con veinte, no.

Sobre `perception`: la alternativa razonable es meter esas tablas en `core`, que
ya es el régimen tenant. Lo descarto por el punto 3 —volumen y perfil
operativo— y por el 1: el worker de inferencia necesita escritura sobre
observaciones y sobre nada de `core`. Además el nombre encaja con el vocabulario
que ya usa el producto: «Percepción» es uno de los grupos de la navegación.
**Si prefieres tres schemas en lugar de cuatro, la opción correcta es
`perception` dentro de `core`**, nunca las observaciones dentro de `platform`.

### 4.4 Coste del movimiento, medido

**Las 7 tablas de IA tienen 0 filas** (comprobado antes de escribir esto). El
movimiento es DDL puro:

- `ALTER TABLE platform.ai_x SET SCHEMA ai` + `RENAME TO x` — 7 tablas, sin
  migración de datos, sin riesgo de pérdida;
- `GRANT USAGE` y `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai`;
- las políticas RLS **se mueven con la tabla**: no hay que reescribirlas, y siguen
  invocando `core.is_platform_owner()`, que se queda en `core` junto a
  `current_user_id()` porque es una primitiva de seguridad;
- los triggers y CHECK también viajan con la tabla.

Este coste solo crece. Con datos reales, con endpoints escritos y con la interfaz
montada, deja de ser una migración de una tarde.

---

## 5. Impacto sobre lo ya implementado

**Ninguna migración existente se modifica.** Todo el ajuste va en migraciones
nuevas, 0031 en adelante.

| Elemento | Impacto |
|---|---|
| 0019 privilegios de `platform` | **ninguno** |
| 0020 `platform.owners` + `is_platform_owner()` | **ninguno** |
| 0021 owner inicial | **ninguno** |
| 0022 guarda de alcance de permisos | **ninguno** |
| 0023 los 23 permisos | **ninguno**; los códigos siguen siendo válidos |
| 0024 registro privilegiado | **ninguno** |
| 0025 `ai_projects` | cambia de schema y **pierde 2 columnas** |
| 0026-0030 (classes, assets, images, datasets, annotations) | cambian de schema y de nombre |
| `core.is_platform_owner()` | **ninguno**: se queda en `core` |
| Patrón RLS, `FORCE`, triggers, FK compuestas | **ninguno**: se replica igual en `ai` |
| `/v1/auth/me`, `is_platform_owner`, 403 `NOT_PLATFORM_OWNER` | **ninguno** |
| Contrato TypeScript | **ninguno** |

Cinco impactos concretos, todos acotados:

**(a) `ai_projects` pierde `base_model` y `task`.** Se mueven a `ai.models`, que
es su sitio: un proyecto con cinco modelos no tiene una arquitectura ni una
tarea. Con 0 filas, es un `DROP COLUMN` sin pérdida. Dejarlas sería peor: dos
fuentes de verdad sobre lo mismo.

**(b) Los rollbacks de 0025-0030 quedan obsoletos.** Referencian
`platform.ai_*`, que ya no existirá. **No los modifico**, y no hace falta: es
exactamente cómo funcionan ya todos los rollbacks de este proyecto — cada uno
aborta si existe algo que dependa de él («revierte 0026-0030 primero»). Para
volver antes del movimiento, primero se revierte el movimiento. La migración 0031
traerá su propio rollback que devuelve las tablas a `platform`.

**(c) `tests/test_platform_block0.py` necesita actualizar nombres.** La tupla
`TABLAS` y el SQL de los ayudantes. Las 17 pruebas siguen probando lo mismo; es
mecánico y lo verifica su propia ejecución.

**(d) El CHECK de anotaciones bloquea clasificación y OCR.** Hoy dice:

```
(kind <> 'bbox' AND geometry IS NOT NULL)
```

Un clasificador de pallets anota **la imagen entera**: no hay geometría. Un OCR
anota una región **y un texto**, que no cabe en `geometry` con sentido. Con doce
familias de modelo, `kind` tiene que crecer a `bbox | polygon | keypoints |
image_label | text_region | count`, y el CHECK debe pedir geometría solo a los
que la tienen. No afecta al Bloque 0 en funcionamiento —no hay filas— pero es
una corrección que hay que hacer antes de la Fase 5, no durante.

**(e) Falta un permiso.** `ai_models:*` existe con `read/publish/rollback/compare`,
pensado para versiones. Con la entidad nueva hace falta `ai_models:write` para
crear un modelo lógico. Es una fila más en el catálogo, aditiva.

---

## 6. Ventajas

Las que justifican el ajuste, y por qué cada una **evita una refactorización
concreta**:

**Añadir una arquitectura es una fila.** Con `ai.architectures` como tabla de
capacidades, incorporar RT-DETR o Florence no toca esquema, ni backend, ni
formulario: el formulario se genera de `hyperparam_schema`. Sin ella, cada
arquitectura nueva es una migración más un despliegue más un `elif` en el worker.

**Un proyecto puede tener doce modelos compartiendo el trabajo caro.** Las
imágenes se suben una vez y se anotan una vez. Comparar YOLO11 contra RT-DETR
sobre los mismos datos es crear un segundo modelo que declara el mismo
`model_classes`: cero anotación adicional. Ese experimento es el pan de cada día
del aprendizaje automático y con el diseño anterior habría sido prohibitivo.

**Los modelos zero-shot entran sin caso especial.** SAM2 y Grounding DINO se
registran como modelos con `requires_training = false` y una versión de origen
`pretrained`. Sin `origin`, cada uno de ellos habría necesitado un camino
paralelo en el código.

**IA, comparación, inventario y WMS quedan desacoplados de verdad.** Cada uno
puede evolucionar, fallar o reemplazarse sin arrastrar a los otros. Se puede
cambiar el modelo de detección sin tocar inventario, y se puede auditar una
discrepancia hasta el frame y la versión de modelo que la originó. Sin la capa de
observaciones, el día que YOLO se equivocara habría escrito directamente en el
inventario del cliente.

**El aislamiento sigue siendo una propiedad del schema.** Cuatro schemas, cuatro
regímenes, ninguna tabla en el sitio equivocado. Es lo que evita el error de
copiar la política de al lado.

**Y una ventaja que no es técnica:** `ai.models` es el sitio natural para
responder «¿qué sabe hacer esta plataforma?». Hoy esa pregunta no tiene tabla.

---

## 7. Cómo quedaría la arquitectura final

```
core            (régimen TENANT)
  tenants · companies · warehouses · areas · locations
  users · tenant_memberships · roles · permissions · role_assignments
  is_platform_owner()  current_user_id()  current_tenant_id()

platform        (régimen OWNER · gobierno)
  owners
  privileged_operation_log
  config                                         ← futuro

ai              (régimen OWNER · autoría)
  frameworks · architectures                     ← capacidades, no listas
  projects
    ├─ classes
    ├─ assets ─→ images ─→ annotations
    └─ models                                    ← LA ENTIDAD NUEVA
         ├─ model_classes ─→ classes
         ├─ dataset_versions ─→ dataset_items ─→ images
         ├─ training_configs
         ├─ training_runs ─→ training_events
         └─ model_versions ─→ evaluations
                └─ (uno activo por modelo, garantizado por índice parcial)

perception      (régimen TENANT · salida)
  inference_sessions ─→ observations
  observation_batches
  reconciliation_runs ─→ discrepancies          ← la costura, bloque posterior

        ai.model_versions ←── (RESTRICT) ── perception.observations
        La única referencia entre los dos mundos, y va en el sentido de la
        proveniencia: una observación sabe qué modelo la produjo.
```

Pipeline completo, con los dos mundos separados:

```
AUTORÍA (plataforma)                    PRODUCCIÓN (tenant)
proyecto                                dron / cámara
  → modelo                                → frames
    → clases + anotaciones                  → sesión de inferencia
      → versión de dataset                    → observaciones
        → entrenamiento                         → motor de comparación
          → versión de modelo                     → discrepancias
            → publicación ─────────────────────────→ (modelo activo)
                                                        → inventario
```

### Plan por bloques, revisado

| Bloque | Contenido | Cambio respecto al plan aprobado |
|---|---|---|
| **0** | terminado | — |
| **0.5** | schema `ai` + movimiento de las 7 tablas + `frameworks` + `architectures` + `models` + `model_classes` + `DROP` de las 2 columnas + relajar el CHECK de anotaciones | **nuevo**, ~5 migraciones |
| 1 | CRUD de proyectos, **modelos** y clases | ahora incluye modelos |
| 2 | assets, imágenes, Storage | sin cambio |
| 3 | anotaciones y datasets | datasets pasan a colgar del modelo |
| 4 | entrenamiento y worker | el worker despacha por `framework` |
| 5 | versiones, métricas, publicación | `origin` + `run_id` nullable |
| 6 | pruebas de inferencia (owner) | sin cambio |
| **7** | schema `perception`, sesiones y observaciones | **nuevo** |
| **8** | motor de comparación y discrepancias | **nuevo** |
| 9 | importaciones Excel | sin cambio |

El Bloque 0.5 es la parte barata del ajuste y hay que hacerla antes del 1: son
5 migraciones sobre tablas vacías. Si se hace después de escribir el CRUD, hay
que reescribir el CRUD.

---

## Lo que este documento no decide

- **Cuántos schemas: 4 o 3.** Recomiendo 4. Si prefieres 3, `perception` va
  dentro de `core`; las observaciones **nunca** dentro de `platform` (§4.2).
- **Si `ai.projects` conserva la configuración de frames.** Yo diría que sí: la
  extracción alimenta el pool compartido, que es del proyecto. Pero si un modelo
  necesitara otra cadencia, habría que moverla o duplicarla.
- **Si `perception.observations` nace particionada.** Por volumen debería, pero
  DEC-06 ya midió que `PARTITION BY` es incompatible con la clave primaria que
  usamos. Hay que resolverlo antes de que la tabla crezca, no después.
- **Dónde corre el worker con GPU.** Sigue pendiente del Bloque 4.
