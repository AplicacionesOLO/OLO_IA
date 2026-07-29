# Bloque 0.5 — Plan exacto de migraciones

> **Estado: propuesta. Nada ejecutado. Ninguna migración existente modificada.**
> Última aplicada: **0030**. Historial en 30/30.
>
> Verificado contra la base real antes de escribir este plan:
> las 7 tablas de IA tienen **0 filas** · la única fila de `platform` es el owner
> · **los CHECK de un `DOMAIN` sí se aplican a los elementos de un array**
> (probado con una tabla temporal, ver §5.1).

---

## 1. Resumen

**11 migraciones (0031 → 0041).**

| Bloque | Migraciones | Efecto |
|---|---|---|
| Schemas y vocabulario | 0031 – 0032 | 2 schemas, 3 dominios, 0 tablas |
| Movimiento | 0033 – 0034 | 7 tablas cambian de schema, 2 columnas eliminadas |
| Agnosticidad | 0035 – 0036 | 2 tablas de catálogo con capacidades |
| Modelo lógico | 0037 – 0039 | 3 tablas nuevas |
| Anotaciones y permisos | 0040 – 0041 | 6 tipos de anotación, 4 permisos |

**Objetos nuevos:** 7 tablas, 3 dominios, 2 schemas, 3 funciones, 3 triggers,
~24 políticas, 4 permisos.
**Objetos movidos:** 7 tablas, 2 funciones de trigger.
**Objetos eliminados:** 2 columnas.
**Filas en riesgo: 0.**

---

## 2. Lista exacta

### 0031 · `0031_create_ai_schema.sql`

**Crea:** schema `ai`, privilegios, default privileges, **3 dominios**.
**Tablas:** ninguna.
**Depende de:** 0002 (rol `olo_app`).

```
CREATE SCHEMA ai;
GRANT USAGE ON SCHEMA ai TO olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
      GRANT USAGE, SELECT ON SEQUENCES TO olo_app;

CREATE DOMAIN ai.task            AS varchar(20) CHECK (VALUE IN (
    'detect','segment','classify','ocr','track','pose','count','regress','embed'));
CREATE DOMAIN ai.input_type      AS varchar(20) CHECK (VALUE IN (
    'image','video','frames','point_cloud','depth','thermal','fusion'));
CREATE DOMAIN ai.annotation_kind AS varchar(16) CHECK (VALUE IN (
    'bbox','polygon','keypoints','image_label','text_region','count'));
```

**Por qué dominios y no CHECK repetidos.** El mismo vocabulario lo usan dos
sitios: la columna escalar (`ai.models.task`) y el array de capacidades
(`ai.architectures.supported_tasks`). Con CHECK sueltos habría dos listas que se
desincronizan en el primer añadido, y una arquitectura podría declarar soportar
una tarea que ningún modelo puede pedir.

Verifiqué empíricamente que **los CHECK de un dominio sí se aplican a los
elementos de un array**, así que `supported_tasks ai.task[]` queda validado sin
duplicar nada. Es la razón de que este diseño funcione; sin esa propiedad habría
que repetir las listas.

`FOR ROLE postgres` es imprescindible, igual que en 0019: sin esa cláusula las
tablas de 0035+ nacerían sin permisos para `olo_app`.

**Riesgo:** bajo.
**Rollback:** `DROP` de los 3 dominios, `REVOKE`, `DROP SCHEMA ai` — abortando si
el schema tiene tablas.

---

### 0032 · `0032_create_perception_schema.sql`

**Crea:** schema `perception`, privilegios, default privileges.
**Tablas:** ninguna. Las de percepción son del Bloque 7.
**Depende de:** 0002.

Se crea ahora, vacío, por tres razones concretas y no por reservar el nombre:

1. **Los default privileges deben existir ANTES que la primera tabla.** Si se
   crean después, las tablas ya creadas no los heredan y hay que conceder a mano.
   Ese error ya costó una migración de corrección en este proyecto (0018).
2. Fija el **régimen de aislamiento** en el comentario del schema, para que quien
   cree la primera tabla no copie la política de `ai` por error. `perception` es
   régimen **tenant**; `ai` es régimen **owner**. Es el error más caro posible.
3. Es donde queda documentada la **estrategia de particionado, clave primaria y
   retención** que pediste (decisión 14), versionada junto al DDL.

La estrategia va en la cabecera de la migración, resumida:

- **Clave primaria:** `(observed_at, id)`. `PARTITION BY RANGE (observed_at)`
  exige que la columna de partición esté en toda restricción única, y DEC-06 ya
  midió que PostgreSQL rechaza una PK que no la incluya. Una PK compuesta que
  empieza por tiempo también sirve al patrón de consulta real —«qué se observó en
  este rango»— así que no es una concesión.
- **Particionado:** mensual por `observed_at`, con `pg_partman` o creación
  programada. **No se implementa ahora** (decisión 14): con la tabla vacía no hay
  nada que ganar y el particionado condiciona la PK, que sí queda decidida.
- **Retención:** observaciones `matched` a 12 meses, `discarded` a 90 días,
  `unmatched` permanentes hasta resolverse. Las que sustenten una discrepancia
  abierta nunca se borran.
- **Volumen estimado:** un dron a 5 fps con 20 detecciones por frame son ~100
  filas/s, ~8,6 M/día por dron activo. Es la tabla más grande del sistema por
  órdenes de magnitud.

**Riesgo:** bajo.
**Rollback:** `REVOKE`, `DROP SCHEMA perception`, abortando si tiene tablas.

---

### 0033 · `0033_move_ai_tables_to_ai_schema.sql`

**La migración de riesgo del bloque.** Mueve 7 tablas y 2 funciones.
**Depende de:** 0031, y de 0025-0030 aplicadas.

```
platform.ai_projects          → ai.projects
platform.ai_classes           → ai.classes
platform.ai_assets            → ai.assets
platform.ai_images            → ai.images
platform.ai_dataset_versions  → ai.dataset_versions
platform.ai_dataset_items     → ai.dataset_items
platform.ai_annotations       → ai.annotations

platform.prevent_class_index_change     → ai.prevent_class_index_change
platform.reject_frozen_dataset_change   → ai.reject_frozen_dataset_change
```

Cada tabla: `ALTER TABLE ... SET SCHEMA ai` seguido de `RENAME TO ...` sin el
prefijo `ai_`, que ahora lo aporta el schema.

**Qué viaja solo y qué hay que tocar:**

| Objeto | ¿Viaja con la tabla? |
|---|---|
| Datos | sí — `SET SCHEMA` es un cambio de catálogo, no reescribe la tabla |
| Políticas RLS (24) | **sí**, con sus nombres. No hay que reescribir ninguna |
| Triggers (8) | sí; referencian la función por OID, así que mover la función no los rompe |
| Índices y constraints | sí, con sus nombres |
| Privilegios de `olo_app` | sí: la ACL está en la tabla, no en el schema |
| FK compuestas entre las 7 | sí, por OID |
| `core.is_platform_owner()` | **no se mueve**: se queda en `core`, es primitiva de seguridad |
| `platform.prevent_last_owner_revocation` | **no se mueve**: es gobierno |

**`platform.prevent_last_owner_revocation` se queda** y las dos de IA se van, con
lo que `platform` cumple la decisión 2: solo gobierno.

**Prueba de cero pérdida de datos.** «0 filas antes, 0 filas después» es una
tautología y no demuestra nada. Antes de aplicar 0033 siembro un **conjunto
testigo** con `COMMIT` real —un proyecto, una clase, un asset, una imagen, una
anotación, una versión de dataset y su item, con las FK compuestas enlazadas—,
aplico la migración, y verifico que las 7 filas están en el schema nuevo con
**valores idénticos** y las FK intactas. Después se elimina el testigo. Eso sí
demuestra que el movimiento preserva datos y relaciones.

**Riesgo:** medio-alto. No por el `ALTER` en sí, sino porque después de él todo
el SQL escrito hasta ahora que nombre `platform.ai_*` deja de resolver. Los tests
se actualizan en el mismo paso.

**Rollback:** el movimiento inverso, tabla por tabla y función por función.
Verificado por el ciclo aplicar → rollback → reaplicar.

---

### 0034 · `0034_projects_drop_model_columns.sql`

**Altera:** `ai.projects` — elimina `base_model` y `task`.
**Depende de:** 0033.

Su sitio es `ai.models`: un proyecto con cinco modelos no tiene una arquitectura
ni una tarea. Dejarlas sería mantener dos fuentes de verdad sobre lo mismo, que
es peor que eliminarlas.

Con **0 filas** es un `DROP COLUMN` sin pérdida. También desaparece
`chk_proj_task`.

`frame_interval_seconds`, `max_frames_per_video` y `max_video_duration_secs`
**se quedan**: la extracción alimenta el pool de imágenes, que es del proyecto.

**Riesgo:** bajo.
**Rollback:** volver a añadir las dos columnas con su CHECK. Al ser aditivo y con
0 filas, es exacto.

---

### 0035 · `0035_ai_frameworks.sql`

**Crea:** `ai.frameworks` + políticas + **6 filas**.
**Depende de:** 0031.

```
ai.frameworks
  code          varchar(30) PRIMARY KEY   -- ultralytics, pytorch, tensorflow, openmmlab, onnx, custom
  display_name  varchar(60) NOT NULL
  adapter       varchar(40) NOT NULL      -- módulo del worker que sabe invocarlo
  is_active     boolean NOT NULL DEFAULT true
  notes         text
  + auditoría
  CHECK (code ~ '^[a-z][a-z0-9_]*$')
```

**`adapter` es la columna que sostiene la agnosticidad.** El worker despacha por
framework, no por arquitectura: los adaptadores son pocos y estables, las
arquitecturas son muchas y crecen. Sin esta columna, el worker acabaría con un
`elif` por arquitectura, que es exactamente la refactorización que este ajuste
evita.

**Riesgo:** bajo. **Rollback:** `DROP TABLE`.

---

### 0036 · `0036_ai_architectures.sql`

**Crea:** `ai.architectures` + políticas + **~16 filas**.
**Depende de:** 0035, 0031 (los 3 dominios).

```
ai.architectures
  code                        varchar(60) PRIMARY KEY
  framework_code              → ai.frameworks(code) ON DELETE RESTRICT
  display_name                varchar(80)  NOT NULL
  family                      varchar(40)  NOT NULL   -- agrupa variantes: yolo11, sam2…
  supported_tasks             ai.task[]            NOT NULL
  supported_input_types       ai.input_type[]      NOT NULL
  supported_annotation_kinds  ai.annotation_kind[] NOT NULL
  requires_training           boolean NOT NULL
  requires_annotations        boolean NOT NULL
  weights_extension           varchar(20) NOT NULL
  default_hyperparams         jsonb NOT NULL DEFAULT '{}'
  hyperparam_schema           jsonb NOT NULL DEFAULT '{}'
  min_images_recommended      integer
  approx_weights_mb           integer                 -- alimenta la retención
  is_active                   boolean NOT NULL DEFAULT true
  + auditoría

  CHECK (cardinality(supported_tasks) > 0)
  CHECK (cardinality(supported_input_types) > 0)
  -- Un modelo que no necesita anotaciones no declara tipos de anotación, y al
  -- contrario: si las necesita, debe decir cuáles acepta.
  CHECK (requires_annotations = (cardinality(supported_annotation_kinds) > 0))
  -- Entrenar sin anotaciones no tiene sentido para ninguna tarea supervisada.
  CHECK (NOT requires_training OR requires_annotations)
```

Los tres arrays quedan validados por los dominios, sin repetir las listas.

**Siembra deliberadamente desigual, y lo digo claro.** `yolo11*` y `yolov8*`
llevan `hyperparam_schema` y `default_hyperparams` completos, porque es el primer
modelo que vamos a integrar y conozco sus parámetros. Para `sam2`,
`grounding-dino`, `florence-2` y `clip` siembro **solo lo que puedo afirmar**:
framework, tareas, `requires_training = false`, extensión de pesos. Su
`hyperparam_schema` queda `{}` y se rellena cuando esa arquitectura se integre de
verdad, en su bloque. Sembrar números que no he verificado sería peor que dejarlo
vacío: parecerían configuración válida y nadie los revisaría.

Catálogo inicial: `yolo11n/s/m/l/x`, `yolov8n/s/m/l/x`, `rtdetr-l`, `sam2-b`,
`grounding-dino-t`, `florence-2-base`, `clip-vit-b32`, `custom`.

**Riesgo:** bajo. **Rollback:** `DROP TABLE`.

---

### 0037 · `0037_ai_models.sql`

**Crea:** `ai.models` + `ai.validate_model_against_architecture()` + trigger +
políticas.
**Depende de:** 0036, 0033 (`ai.projects`), 0010 (`core.users`).

```
ai.models
  id                  uuid PRIMARY KEY
  project_id          uuid NOT NULL → ai.projects(id) ON DELETE RESTRICT
  name                varchar(120) NOT NULL
  slug                varchar(120) NOT NULL
  description         text
  purpose             text                    -- para qué sirve, en lenguaje de negocio
  framework_code      → ai.frameworks(code)
  architecture_code   → ai.architectures(code)
  task                ai.task       NOT NULL
  input_type          ai.input_type NOT NULL
  status              varchar(24)   NOT NULL DEFAULT 'draft'
  requires_training   boolean       NOT NULL   -- copiado y CONGELADO de la arquitectura
  config              jsonb         NOT NULL DEFAULT '{}'
  current_version_id  uuid NULL                -- FK la añade 0038
  + auditoría

  UNIQUE (project_id, slug) WHERE deleted_at IS NULL
  UNIQUE (project_id, id)                       -- destino de FK compuestas
  CHECK (status IN ('draft','collecting','annotating','training','published','deprecated','archived'))
```

**El trigger de validación es lo que convierte el catálogo de capacidades en algo
con efecto**, y no en documentación:

- `task` ∈ `architectures.supported_tasks`
- `input_type` ∈ `architectures.supported_input_types`
- `framework_code` = el de la arquitectura
- `requires_training` = el de la arquitectura, al insertar
- `architecture_code` y `requires_training` **inmutables** si el modelo ya tiene
  versiones: cambiar de arquitectura invalidaría los pesos existentes, igual que
  renumerar `class_index` invalidaba su interpretación

Un CHECK no puede hacerlo porque son condiciones entre tablas. Sin el trigger,
nada impediría un modelo `ocr` sobre `yolo11n`, y el fallo aparecería al lanzar
el entrenamiento, después de reservar una GPU.

`current_version_id` nace **sin FK** y la recibe en 0038. Es una referencia
colgante durante una migración, no de forma permanente — la alternativa sería
crear las dos tablas en una sola migración y perder la granularidad del ciclo de
rollback. Lo señalo porque critiqué exactamente esto en
`core.users.avatar_file_id`, donde la referencia lleva colgando desde la 0010.

**Riesgo:** medio — trigger con lógica entre tablas.
**Rollback:** `DROP` de trigger, función y tabla.

---

### 0038 · `0038_ai_model_versions.sql`

**Crea:** `ai.model_versions` + políticas + **la FK de `models.current_version_id`**.
**Depende de:** 0037, 0033 (`ai.assets`).

```
ai.model_versions
  id                 uuid PRIMARY KEY
  project_id         uuid NOT NULL
  model_id           uuid NOT NULL
  version            integer NOT NULL
  origin             varchar(12) NOT NULL      -- trained | pretrained | imported
  weights_asset_id   uuid NOT NULL
  source_reference   text                      -- de dónde salieron unos pesos preentrenados
  notes              text
  status             varchar(12) NOT NULL DEFAULT 'candidate'
  published_at       timestamptz, published_by uuid
  + auditoría

  FOREIGN KEY (project_id, model_id)        → ai.models(project_id, id)
  FOREIGN KEY (project_id, weights_asset_id)→ ai.assets(project_id, id)
  UNIQUE (model_id, version)
  UNIQUE (project_id, id)
  CHECK (origin IN ('trained','pretrained','imported'))
  CHECK (status IN ('candidate','active','archived','rejected'))
  CHECK (version > 0)
  -- Unos pesos que vienen de fuera deben decir de dónde.
  CHECK (origin = 'trained' OR source_reference IS NOT NULL)

  -- UN SOLO ACTIVO POR MODELO, garantizado por el motor
  CREATE UNIQUE INDEX uq_mv_activo ON ai.model_versions (model_id)
      WHERE status = 'active';
```

Ese índice parcial es el mecanismo entero de la publicación y el rollback: dos
publicaciones concurrentes y una recibe violación de unicidad, traducida a `409`.
Ninguna carrera puede dejar dos modelos activos.

**`run_id` NO se crea aquí, y es deliberado.** `ai.training_runs` es del Bloque 4;
una columna `run_id` sin su FK sería una referencia colgante permanente, no de una
migración. En el Bloque 4 se añade la columna, su FK y el CHECK
`(origin = 'trained') = (run_id IS NOT NULL)`.

Consecuencia útil: **hoy ya se puede registrar y publicar un SAM2 preentrenado**
sin nada de infraestructura de entrenamiento, que es justo la decisión 9.

`weights_asset_id` es `NOT NULL`: una versión sin pesos no es una versión. Implica
subir los pesos a Storage antes de registrarla, incluso los preentrenados —
correcto, porque reproducir un resultado exige los pesos exactos, no un nombre.

**Riesgo:** bajo. **Rollback:** quitar la FK de `models`, `DROP TABLE`.

---

### 0039 · `0039_ai_model_classes.sql`

**Crea:** `ai.model_classes` + `ai.prevent_training_index_change()` + trigger +
políticas.
**Depende de:** 0038, 0033 (`ai.classes`).

```
ai.model_classes
  model_id        uuid NOT NULL
  class_id        uuid NOT NULL
  project_id      uuid NOT NULL
  training_index  smallint NOT NULL

  PRIMARY KEY (model_id, class_id)
  FOREIGN KEY (project_id, model_id) → ai.models(project_id, id)
  FOREIGN KEY (project_id, class_id) → ai.classes(project_id, id)
  UNIQUE (model_id, training_index)
  CHECK (training_index >= 0)
```

Esta tabla es la que permite la decisión 6. `Detector YOLO` y `Detector RT-DETR`
declaran el mismo subconjunto de clases del proyecto y **comparten imágenes y
anotaciones sin copiar nada**. `Detector de daños` declara otro subconjunto sobre
las mismas imágenes.

Y resuelve la tensión de índices: `classes.class_index` es identidad estable a
nivel de proyecto; `training_index` es el índice contiguo `0..N-1` que verán los
pesos de **ese** modelo.

El trigger impide cambiar `training_index` si el modelo ya tiene versiones, por el
mismo motivo que `class_index`: los pesos guardan índices y renumerar hace que el
modelo devuelva la etiqueta equivocada **sin dar ningún error**.

**Riesgo:** bajo. **Rollback:** `DROP` de trigger, función y tabla.

---

### 0040 · `0040_annotations_extend_kinds.sql`

**Altera:** `ai.annotations` — 6 tipos, 2 columnas nuevas, matriz de CHECK.
**Depende de:** 0033, 0031 (dominio `ai.annotation_kind`).

Hoy el CHECK dice `(kind <> 'bbox' AND geometry IS NOT NULL)`. Un clasificador
anota **la imagen entera**: no hay geometría. Un OCR anota una región **y un
texto**, que no cabe en `geometry` con sentido.

```
ALTER TABLE ai.annotations
  ADD COLUMN text_value    text    NULL,     -- text_region
  ADD COLUMN numeric_value numeric NULL;     -- count

ALTER TABLE ai.annotations
  ALTER COLUMN kind TYPE ai.annotation_kind;  -- unifica el vocabulario
```

Matriz que impone el CHECK nuevo:

| `kind` | cx,cy,w,h | geometry | text_value | numeric_value |
|---|---|---|---|---|
| `bbox` | requerido | NULL | NULL | NULL |
| `polygon` | NULL | requerido | NULL | NULL |
| `keypoints` | NULL | requerido | NULL | NULL |
| `image_label` | NULL | NULL | NULL | NULL |
| `text_region` | requerido | NULL | **requerido** | NULL |
| `count` | NULL | NULL | NULL | **requerido** |

Se conservan intactos los CHECK de normalización y de caja dentro de la imagen —
siguen aplicando a `bbox` y a `text_region`, y no estorban al resto porque sus
coordenadas son NULL.

Se añade `UNIQUE (image_id, class_id) WHERE kind = 'image_label'`: una imagen no
puede llevar dos veces la misma etiqueta de clasificación. Multietiqueta sí, y es
un caso real.

Con **0 filas**, el cambio de tipo y los CHECK nuevos no pueden fallar por datos
existentes.

**Riesgo:** bajo. **Rollback:** restaurar el CHECK anterior, `DROP` de las dos
columnas, `varchar(12)` de vuelta.

---

### 0041 · `0041_ai_permission_catalog_extension.sql`

**Crea:** ninguna tabla. Inserta **4 filas** en `core.permissions`.
**Depende de:** 0022 (columna `scope` y su guarda), 0023.

| Código | Para qué |
|---|---|
| `ai_models:write` | crear y editar el modelo lógico |
| `ai_models:import` | registrar pesos preentrenados o importados |
| `ai_architectures:read` | ver el catálogo de capacidades |
| `ai_architectures:write` | añadir o desactivar arquitecturas |

Todos con `scope = 'platform'` e `is_privileged = true`, sin mapear a ningún rol.
Total: **27 permisos de plataforma**.

`ai_models:import` va aparte de `write` a propósito: registrar pesos que vienen
de fuera es una operación de confianza distinta de crear un modelo lógico, y
conviene poder concederlas por separado cuando haya varios owners.

**Riesgo:** bajo. **Rollback:** `DELETE` por código.

---

## 3. Grafo de dependencias

```
0002 ─┬─→ 0031 (schema ai + dominios) ─┬─→ 0033 (mover 7 tablas) ─→ 0034 (drop 2 columnas)
      │                                │        │
      └─→ 0032 (schema perception)     │        ├─→ 0040 (ampliar anotaciones)
                                       │        │
0025-0030 ────────────────────────────→┘        │
                                                │
                          0035 (frameworks) ─→ 0036 (architectures) ─→ 0037 (models)
                                                                          │
                                                            0038 (model_versions)
                                                                          │
                                                            0039 (model_classes)

0022, 0023 ──────────────────────────────────────────────→ 0041 (4 permisos)
```

Orden de aplicación: estrictamente 0031 → 0041.

---

## 4. Objetos afectados

### 4.1 Tablas

| Tabla | Acción | Migración |
|---|---|---|
| `platform.ai_projects` | → `ai.projects`, −2 columnas | 0033, 0034 |
| `platform.ai_classes` | → `ai.classes` | 0033 |
| `platform.ai_assets` | → `ai.assets` | 0033 |
| `platform.ai_images` | → `ai.images` | 0033 |
| `platform.ai_dataset_versions` | → `ai.dataset_versions` | 0033 |
| `platform.ai_dataset_items` | → `ai.dataset_items` | 0033 |
| `platform.ai_annotations` | → `ai.annotations`, +2 columnas, 6 kinds | 0033, 0040 |
| **`ai.frameworks`** | nueva | 0035 |
| **`ai.architectures`** | nueva | 0036 |
| **`ai.models`** | nueva | 0037 |
| **`ai.model_versions`** | nueva | 0038 |
| **`ai.model_classes`** | nueva | 0039 |
| `core.permissions` | +4 filas | 0041 |

Al terminar: `platform` con **2 tablas** (owners, privileged_operation_log), `ai`
con **12**, `perception` con **0**.

### 4.2 Funciones y triggers

| Objeto | Acción |
|---|---|
| `platform.prevent_class_index_change` | → `ai.prevent_class_index_change` |
| `platform.reject_frozen_dataset_change` | → `ai.reject_frozen_dataset_change` |
| `platform.prevent_last_owner_revocation` | **se queda** (gobierno) |
| `core.is_platform_owner` | **se queda** (primitiva de seguridad) |
| `ai.validate_model_against_architecture` | nueva + trigger |
| `ai.prevent_training_index_change` | nueva + trigger |
| Los 8 triggers de las tablas movidas | viajan con la tabla, sin cambios |

### 4.3 Políticas RLS

Las 24 de las 7 tablas movidas **viajan intactas** y siguen invocando
`core.is_platform_owner()`. Las 5 tablas nuevas reciben el mismo patrón:
RESTRICTIVE `USING (core.is_platform_owner())` + PERMISSIVE de concesión, con
`ENABLE` y `FORCE`. Ninguna con política de `DELETE`.

### 4.4 Código y pruebas

| Archivo | Cambio |
|---|---|
| `tests/test_platform_block0.py` | tupla `TABLAS` y SQL de los ayudantes |
| `tests/test_ai_block05.py` | **nuevo**, ~20 pruebas |
| `supabase/rollbacks/0025-0030` | **no se modifican** (§6) |
| Backend | **ninguno**: no hay CRUD de IA todavía |
| Frontend | **ninguno** |

---

## 5. Pruebas

### 5.1 Compatibilidad — que el Bloque 0 siga intacto

Las **17 pruebas del Bloque 0 deben seguir pasando** tras actualizar los nombres.
Eso *es* la prueba de compatibilidad: aislamiento sin identidad, no-owner con cero
filas, guarda del último owner, escalada de permisos, inmutabilidad de
`class_index` y de datasets congelados, FK cruzadas, geometría, deduplicación,
403 por HTTP y revocación inmediata con token vigente.

### 5.2 Cero pérdida de datos — con testigo, no con tautología

Alrededor de 0033: sembrar 7 filas enlazadas con `COMMIT`, mover, verificar
igualdad campo a campo y FK intactas, eliminar el testigo. Detalle en §0033.

### 5.3 Nuevas, ~20

**Aislamiento (5 tablas nuevas)**
1. Sin identidad → 0 filas en las 12 tablas de `ai`
2. Usuario no owner → 0 filas en las 12
3. Owner → lectura y escritura correctas
4. `perception` existe, con USAGE para `olo_app` y **0 tablas**

**El catálogo de capacidades con efecto**
5. Modelo `ocr` sobre `yolo11n` (que no lo soporta) → **error**
6. Modelo con `framework` distinto al de su arquitectura → **error**
7. `requires_training` se copia de la arquitectura al insertar
8. Cambiar `architecture_code` con versiones existentes → **error**
9. Arquitectura con `requires_annotations = false` y `supported_annotation_kinds` no vacío → **error**
10. Un elemento inválido en `supported_tasks` → **error del dominio**

**Modelo lógico y versiones**
11. Varios modelos en el mismo proyecto → correcto
12. Dos modelos con el mismo `slug` en un proyecto → **error**
13. Versión `pretrained` sin entrenamiento → **correcta** (decisión 9)
14. Versión `imported` sin `source_reference` → **error**
15. Dos versiones `active` del mismo modelo → **error** por índice parcial
16. Dos modelos del mismo proyecto, cada uno con su versión activa → correcto

**Vocabulario compartido**
17. Dos modelos declarando las mismas clases → **anotaciones compartidas**, sin copia
18. `training_index` duplicado en un modelo → **error**
19. Cambiar `training_index` con versiones existentes → **error**
20. `model_classes` con una clase de otro proyecto → **error** por FK compuesta

**Anotaciones ampliadas**
21. `image_label` sin geometría → **correcta**
22. `bbox` sin coordenadas → **error**
23. `text_region` sin `text_value` → **error**
24. `count` sin `numeric_value` → **error**
25. Dos `image_label` con la misma clase en una imagen → **error**

**Estructura**
26. `ai.projects` ya no tiene `base_model` ni `task`
27. `platform` tiene exactamente 2 tablas
28. Los 27 permisos de plataforma, 0 mapeados a roles

---

## 6. Sobre los rollbacks de 0025-0030

Quedan obsoletos: nombran `platform.ai_*`. **No los modifico**, y no hace falta.

Es cómo funciona ya cada rollback de este proyecto: todos abortan si existe algo
que dependa de ellos. El rollback de 0033 devuelve las tablas a `platform`, y a
partir de ahí los de 0025-0030 vuelven a ser válidos. La cadena completa sigue
siendo reversible: para volver antes del Bloque 0.5 se revierte 0041 → 0031 en
orden inverso.

Esa propiedad queda **demostrada** por el propio ciclo de ejecución: cada
migración se aplica, se revierte y se reaplica.

---

## 7. Lo que necesito que confirmes

| | Punto | Mi recomendación |
|---|---|---|
| **A** | `ai.model_versions` **sin** `run_id`; se añade en el Bloque 4 con su FK y su CHECK | **Sí.** Una columna sin FK sería referencia colgante permanente. Lo pretrained/imported funciona igual desde hoy |
| **B** | `weights_asset_id` `NOT NULL`, incluso para preentrenados | **Sí.** Reproducir exige los pesos exactos, no un nombre |
| **C** | Siembra completa solo de `yolo11`/`yolov8`; el resto con `hyperparam_schema` vacío | **Sí.** Sembrar números sin verificar es peor que dejarlo vacío |
| **D** | Crear `perception` vacío ahora | **Sí.** Los default privileges deben preceder a la primera tabla |
| **E** | 11 migraciones, sin fusionar | **Sí.** Fusionar el movimiento con el `DROP COLUMN` complica su rollback |

Si las cinco son «sí», ejecuto 0031 → 0041 con el ciclo habitual: aplicación,
prueba, rollback, reaplicación, una a la vez.
