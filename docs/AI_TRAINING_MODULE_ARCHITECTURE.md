# OLO_IA — Arquitectura del módulo de entrenamiento YOLO

> **Estado: propuesta para revisión. Ninguna línea de esto está implementada.**
> No hay migraciones, no hay endpoints, no hay UI. El objetivo es acordar la
> arquitectura antes de escribir nada.
>
> Verificado contra la base real el 2026-07-29: 13 tablas en `core`, schema
> `platform` creado y **vacío**, 5 roles de sistema, 30 permisos.

---

## 0. Lo que necesito que revises primero

Ocho decisiones cambian la forma del sistema. El resto del documento las asume.

| # | Decisión | Propuesta | Si dices no |
|---|---|---|---|
| **D-1** | Dónde vive el entrenamiento | Worker propio con GPU, fuera de Supabase, que reclama trabajos de la base | Fases 1-5 siguen igual; la 6 se bloquea |
| **D-2** | Alcance del módulo | **Plataforma**, no tenant. Sin `tenant_id` | Habría que decidir el aislamiento entre tenants ahora |
| **D-3** | Cómo se representa Platform Owner | Tabla propia `platform.owners` + función, NO rol de tenant | No hay alternativa: el RBAC actual no lo admite |
| **D-4** | `is_platform_owner` en el JWT | **No**. Se resuelve en cada petición | Revocar el privilegio tardaría hasta 1 h |
| **D-5** | Estado «entrenada» de una imagen | **Eliminarlo** del estado de la imagen | Ver §6.1: introduce un dato que se corrompe |
| **D-6** | Versiones de dataset | Inmutables y obligatorias antes de entrenar | Las métricas entre modelos dejan de ser comparables |
| **D-7** | `class_index` de las clases | Inmutable para siempre una vez entrenado | Los pesos antiguos pasan a interpretarse mal, en silencio |
| **D-8** | Coordenadas de anotación | Normalizadas 0..1, no píxeles | Redimensionar una imagen invalida sus anotaciones |

Las cuatro que considero **no negociables** por corrección, no por gusto, son
D-3, D-6, D-7 y D-8. Explico cada una donde toca.

---

## 1. Modelo de acceso: Platform Owner

### 1.1 Por qué no puede ser un rol

Pediste una solución por permisos y no por correo. De acuerdo, y hay que ir un
paso más allá: **tampoco puede ser un rol del sistema actual.**

`core.role_assignments` tiene `tenant_id NOT NULL` y cinco claves foráneas
compuestas hacia `core.tenant_memberships` (migración 0014). Es decir: todo rol
se concede *dentro de un tenant*. Un Platform Owner es lo contrario — está por
encima de los tenants, y el modelo de identidad ya separa eso (`core.users` es
global, DEC-04).

Meter un rol `platform_owner` en `core.roles` obligaría a atarlo a un tenant
arbitrario. Funcionaría por accidente y significaría algo falso: que su poder
emana de pertenecer a `olo-demo`. Cuando existiese un segundo tenant, la
incoherencia se volvería un agujero.

### 1.2 La estructura

```
platform.owners
  user_id      uuid  PK  → core.users(id)
  granted_by   uuid      → core.users(id)   -- NULL solo para el primero
  granted_at   timestamptz NOT NULL
  revoked_at   timestamptz NULL
  reason       text NOT NULL                -- por qué se concedió
```

`user_id` como PK, no un `id` propio: un usuario es o no es owner, no hay dos
concesiones simultáneas. La revocación es lógica para conservar la historia.

```
core.is_platform_owner() → boolean
  SECURITY DEFINER, STABLE, search_path = ''
  EXISTS (SELECT 1 FROM platform.owners
           WHERE user_id = core.current_user_id() AND revoked_at IS NULL)
```

`SECURITY DEFINER` por la misma razón que `core.current_auth_id()` en la
migración 0018: `olo_app` **no tiene USAGE sobre `platform`** (verificado), y
concederlo abriría el schema entero cuando solo se necesita esta lectura.

**Soporta múltiples owners desde el primer día.** No hay nada que cambiar para
añadir el segundo: es una fila.

### 1.3 Dos trampas que hay que cerrar en la misma migración

**Bootstrap.** El primer owner no lo puede conceder un owner. Lo siembra la
migración buscando por correo — la única vez que el correo decide algo, y en un
contexto donde es aceptable porque es DDL revisada, no lógica de aplicación.

**Bloqueo total.** Si el último owner activo se revoca, nadie puede volver a
conceder el privilegio y el módulo queda inaccesible **sin vía de recuperación
por la aplicación**. Un `CHECK` no puede verlo porque es una condición sobre la
tabla completa. Hace falta un trigger `AFTER UPDATE/DELETE` que aborte si
quedarían cero owners activos.

### 1.4 Por qué no viaja en el JWT

El Hook (migración 0016) podría publicar `is_platform_owner`. **No debe.**

El proyecto ya decidió que los permisos no van en el token para que revocar uno
surta efecto de inmediato. Este privilegio es el más potente del sistema: si
viajara en el token, revocarlo tardaría **hasta una hora**. Se resuelve por
consulta en cada petición, igual que los permisos.

Coste: una consulta más por petición al módulo. Es una lectura por PK sobre una
tabla de decenas de filas. Irrelevante.

RLS no necesita el claim: `core.is_platform_owner()` deriva la identidad de
`core.current_user_id()`, que ya funciona por los dos canales de DEC-02.

### 1.5 Permisos en el catálogo

Se añaden a `core.permissions` con `is_privileged = true`:

| Módulo | Acciones |
|---|---|
| `ai_projects` | `read`, `write`, `delete` |
| `ai_classes` | `read`, `write` |
| `datasets` | `read`, `write`, `import` |
| `annotations` | `read`, `write`, `validate` |
| `training` | `read`, `launch`, `cancel` |
| `ai_models` | `read`, `publish`, `rollback`, `compare` |
| `inference` | `read`, `run` |

**Estos nombres no son inventados: son los que el frontend ya declara.** Los
items de navegación que ahora aparecen marcados «fase 1» piden exactamente
`ai_models:read`, `inference:read`, `datasets:*` y `training:*`. Al registrarlos,
esos módulos dejan de estar en fase 1 y pasan a «pendiente».

**En fase 1 la puerta real es `is_platform_owner()`, no el permiso.** Los
permisos existen para que el vocabulario de la interfaz sea real y para no tener
que rehacer nada después. `GET /v1/auth/me` devuelve `is_platform_owner: true` y
añade este conjunto de permisos, así que la navegación se enciende sin lógica
especial en el cliente.

Cuando haya varios owners con capacidades distintas, se añade
`platform.owner_permissions (user_id, permission_code)` y la puerta pasa a ser
`is_platform_owner() AND has_platform_permission(...)`. Es aditivo: ninguna tabla
de las de abajo cambia.

### 1.6 RLS de todo el módulo

Mismo patrón que el resto del proyecto — RESTRICTIVE que impone el piso,
PERMISSIVE que concede — pero con **un solo factor**:

```
ALTER TABLE platform.ai_* ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_* FORCE ROW LEVEL SECURITY;

POLICY ai_platform_only AS RESTRICTIVE FOR ALL TO authenticated, olo_app
  USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
```

Sin identidad, `current_user_id()` es NULL, el `EXISTS` es falso y no se ve
nada. Es la lección de la migración 0017 aplicada desde el principio: la guarda
de identidad es el primer factor, no un añadido.

---

## 2. Modelo de datos

Todo en el schema `platform`. Todas las tablas llevan las columnas de la casa:
`created_at`, `created_by`, `updated_at`, `updated_by`, `version` (bloqueo
optimista), `deleted_at` (borrado lógico **explícito**, nunca por trigger — se
verificó en fase 0 que un trigger de soft delete borra en cualquier UPDATE).

### 2.1 Fase 1 — Proyectos

```
platform.ai_projects
  id                        uuid PK
  name                      varchar(120)  NOT NULL
  slug                      varchar(120)  NOT NULL   -- único, para rutas
  description               text
  base_model                varchar(60)   NOT NULL   -- yolov8n … yolo11x
  task                      varchar(20)   NOT NULL DEFAULT 'detect'
  status                    varchar(24)   NOT NULL
  current_model_version_id  uuid NULL     → ai_model_versions(id)
  + auditoría

  UNIQUE (slug) WHERE deleted_at IS NULL
  CHECK  (task IN ('detect','segment','pose'))
```

`task` existe desde el principio aunque solo implementemos `detect`: determina la
forma de las anotaciones y de los pesos, y añadirlo después obligaría a
reinterpretar filas existentes.

`current_model_version_id` es nullable y crea un ciclo con `ai_model_versions`.
Es deliberado: el proyecto necesita saber su modelo activo sin recorrer todas las
versiones, y nullable rompe el ciclo sin FK diferida.

> **Sobre «versión» en tu Fase 1.** Un proyecto no tiene versión propia: lo que
> versiona es el *modelo* (§2.7) y el *dataset* (§2.5). La columna `version` que
> sí lleva es el entero de bloqueo optimista, el que viaja como `ETag`. Si lo que
> querías era una etiqueta editable tipo «v2 del proyecto de pallets», dilo y se
> añade como campo libre — pero no debe confundirse con las otras dos, que sí son
> identidad de artefactos.

### 2.2 Fase 2 — Clases

```
platform.ai_classes
  id           uuid PK
  project_id   uuid NOT NULL → ai_projects(id)
  name         varchar(60)  NOT NULL
  class_index  smallint     NOT NULL   -- índice YOLO. INMUTABLE
  color        char(7)      NOT NULL   -- #RRGGBB, para la UI de anotación
  description  text
  is_active    boolean      NOT NULL DEFAULT true
  + auditoría

  UNIQUE (project_id, name)        WHERE deleted_at IS NULL
  UNIQUE (project_id, class_index)
  CHECK  (class_index >= 0)
  CHECK  (color ~ '^#[0-9A-Fa-f]{6}$')
```

**D-7, y es la trampa menos evidente de todo el módulo.**

Los pesos de YOLO no guardan nombres de clase: guardan **índices**. Un modelo
entrenado con `0=pallet, 1=caja` y luego consultado en un proyecto donde alguien
borró `pallet` y `caja` pasó a ser 0, devuelve «caja» donde detecta pallets. No
falla, no avisa: **miente**.

De ahí tres reglas:

1. `class_index` se asigna al crear y **nunca** se modifica ni se reutiliza.
2. Las clases se **desactivan** (`is_active = false`), no se borran ni renumeran.
   Es lo que pediste en la Fase 2 y además es la única opción segura.
3. Cada versión de dataset **congela la lista de clases** (§2.5). Así un modelo
   siempre se puede interpretar con el vocabulario con el que se entrenó.

Desactivar una clase excluye sus anotaciones de los datasets **futuros**; no
altera los ya congelados.

### 2.3 Fase 3 — Assets: todo lo binario

Separo el binario en Storage del concepto de dominio. Un vídeo no es una imagen
del dataset, y una imagen tiene miniaturas que no son items entrenables.

```
platform.ai_assets
  id                 uuid PK
  project_id         uuid NOT NULL → ai_projects(id)
  kind               varchar(20) NOT NULL
  bucket             varchar(63) NOT NULL
  object_path        text        NOT NULL   -- canónica, GENERADA
  original_filename  text        NOT NULL   -- lo que subió el usuario, solo dato
  content_type       varchar(100) NOT NULL
  bytes              bigint      NOT NULL
  sha256             char(64)    NOT NULL
  width, height      integer                -- imagen y frame
  duration_ms        integer                -- vídeo
  uploaded_at        timestamptz NOT NULL
  + auditoría

  UNIQUE (bucket, object_path)
  UNIQUE (project_id, sha256) WHERE kind IN ('image','frame')
  CHECK  (kind IN ('image','video','frame','thumbnail','weights','run_artifact'))
```

`UNIQUE (project_id, sha256)` es deduplicación por contenido. La misma foto
subida dos veces con nombres distintos entraría dos veces en el dataset: una
acabaría en `train` y otra en `val`, y eso es **fuga de datos** — el modelo
puntúa alto contra una imagen que ya vio. Es un error que no da ningún síntoma
salvo métricas demasiado buenas.

`object_path` la genera el servidor; el nombre del usuario se guarda solo como
dato. Aceptar el nombre en la ruta invita a *path traversal* y a colisiones.

```
platform.ai_images                -- lo que se puede anotar y entrenar
  id                     uuid PK
  project_id             uuid NOT NULL → ai_projects(id)
  asset_id               uuid NOT NULL → ai_assets(id)   UNIQUE
  source                 varchar(10) NOT NULL            -- upload | frame
  source_video_asset_id  uuid NULL    → ai_assets(id)
  frame_index            integer NULL
  frame_timestamp_ms     integer NULL
  status                 varchar(16) NOT NULL
  annotated_by/at, reviewed_by/at
  + auditoría

  CHECK ((source = 'frame') = (source_video_asset_id IS NOT NULL))
  CHECK (status IN ('pending','annotated','validated','rejected','archived'))
  UNIQUE (source_video_asset_id, frame_index) WHERE source = 'frame'
```

La trazabilidad frame → vídeo permite algo práctico: descartar de golpe todos los
frames de un vídeo mal grabado.

### 2.4 Fase 5 — Anotaciones

```
platform.ai_annotations
  id          uuid PK
  image_id    uuid NOT NULL → ai_images(id)
  class_id    uuid NOT NULL → ai_classes(id)
  kind        varchar(12) NOT NULL          -- bbox | polygon | keypoints
  -- bbox: tipado, normalizado, formato nativo YOLO
  cx, cy, w, h  numeric(9,8) NULL
  -- futuro: polygon [[x,y],…] · keypoints [{x,y,v},…]
  geometry    jsonb NULL
  origin      varchar(10) NOT NULL          -- human | model | imported
  confidence  numeric(4,3) NULL             -- solo si origin <> 'human'
  + auditoría

  CHECK (kind IN ('bbox','polygon','keypoints'))
  CHECK ( (kind =  'bbox' AND cx IS NOT NULL AND geometry IS NULL)
       OR (kind <> 'bbox' AND cx IS     NULL AND geometry IS NOT NULL) )
  CHECK (cx BETWEEN 0 AND 1 AND cy BETWEEN 0 AND 1)
  CHECK (w > 0 AND h > 0 AND w <= 1 AND h <= 1)
  CHECK (cx - w/2 >= -1e-6 AND cx + w/2 <= 1 + 1e-6)   -- dentro de la imagen
  CHECK (cy - h/2 >= -1e-6 AND cy + h/2 <= 1 + 1e-6)
  CHECK ((origin = 'human') = (confidence IS NULL))
```

**Híbrido a propósito.** Columnas tipadas para `bbox` porque es el 99 % de los
casos, se puede indexar, y **el motor puede validar los rangos** — con `jsonb`
una caja fuera de la imagen entraría sin protestar y reventaría en el
entrenamiento, lejos de su causa. `jsonb` para polígonos y keypoints, cuya forma
es variable y cuya validación toca a la aplicación.

**D-8: normalizadas, no píxeles.** Es el formato nativo de YOLO (no hay que
convertir al exportar), y sobrevive a que la imagen se redimensione o se
recomprima. Con píxeles, generar miniaturas o reescalar el dataset invalida
silenciosamente todas las anotaciones.

`origin` prepara el bucle de mejora continua: el modelo activo preanota, el
humano corrige. Sin esa columna no se puede medir cuánto acierta la preanotación
ni evitar entrenar con sus propias suposiciones.

### 2.5 Fase 4 — Dataset: versiones inmutables

**D-6, y es lo que hace que las Fases 7 y 8 signifiquen algo.**

```
platform.ai_dataset_versions           -- INMUTABLE tras congelar
  id              uuid PK
  project_id      uuid NOT NULL → ai_projects(id)
  version         integer NOT NULL     -- 1,2,3… por proyecto
  name            varchar(120)
  notes           text
  class_snapshot  jsonb   NOT NULL     -- [{index,name},…] congelado
  image_count     integer NOT NULL
  train_count, val_count, test_count integer NOT NULL
  split_seed      integer NOT NULL
  frozen_at       timestamptz NOT NULL
  created_by      uuid NOT NULL

  UNIQUE (project_id, version)
  CHECK  (image_count = train_count + val_count + test_count)

platform.ai_dataset_items
  dataset_version_id  uuid NOT NULL → ai_dataset_versions(id)
  image_id            uuid NOT NULL → ai_images(id)
  split               varchar(5) NOT NULL   -- train | val | test
  PRIMARY KEY (dataset_version_id, image_id)
  CHECK (split IN ('train','val','test'))
```

Sin políticas de UPDATE ni DELETE: una vez congelada, no se toca.

El reparto train/val/test se calcula **una vez, se guarda y se reutiliza**. Si se
sortea en cada entrenamiento, dos ejecuciones «con la misma configuración» miden
cosas distintas, y comparar sus mAP no dice nada. Peor: la misma imagen cae en
`train` en una y en `val` en otra, así que la segunda puntúa contra material que
la primera ya usó.

Cada `ai_training_run` apunta a **exactamente una** versión de dataset. Eso, y
solo eso, es lo que permite afirmar «la v3 es mejor que la v2».

### 2.6 Fase 6 — Entrenamiento

```
platform.ai_training_configs           -- «Guardar configuración»
  id            uuid PK
  project_id    uuid NOT NULL → ai_projects(id)
  name          varchar(120) NOT NULL
  base_model    varchar(60)  NOT NULL
  epochs        integer      NOT NULL  CHECK (epochs BETWEEN 1 AND 1000)
  batch_size    integer      NOT NULL  CHECK (batch_size BETWEEN 1 AND 256)
  learning_rate numeric(9,7) NOT NULL  CHECK (learning_rate > 0 AND < 1)
  image_size    integer      NOT NULL  CHECK (image_size IN (320,416,512,640,768,896,1024,1280))
  confidence    numeric(4,3) NOT NULL  CHECK (confidence BETWEEN 0 AND 1)
  device        varchar(20)  NOT NULL  -- auto | cpu | cuda:0 …
  extra         jsonb        NOT NULL DEFAULT '{}'   -- augmentaciones, patience…
  is_default    boolean      NOT NULL DEFAULT false
  + auditoría
```

`image_size` restringido a múltiplos de 32: YOLO los exige, y un 500 se
redondea en silencio, de modo que el número guardado no es el usado.

```
platform.ai_training_runs
  id                   uuid PK
  project_id           uuid NOT NULL → ai_projects(id)
  dataset_version_id   uuid NOT NULL → ai_dataset_versions(id)
  config_snapshot      jsonb NOT NULL     -- CONGELADO, no FK a config mutable
  base_model           varchar(60) NOT NULL
  seed                 integer NOT NULL
  state                varchar(12) NOT NULL
  -- cola
  claimed_by           varchar(100) NULL  -- identificador del worker
  claimed_at           timestamptz NULL
  heartbeat_at         timestamptz NULL
  cancel_requested_at  timestamptz NULL
  attempt              smallint NOT NULL DEFAULT 1
  -- progreso
  current_epoch, total_epochs integer
  started_at, finished_at     timestamptz
  error_code           varchar(50), error_message text
  runtime              jsonb NULL         -- {python, torch, ultralytics, cuda, gpu}
  requested_by         uuid NOT NULL → core.users(id)
  + auditoría

  CHECK (state IN ('queued','claimed','running','succeeded','failed','cancelled','lost'))
```

`config_snapshot` como jsonb y **no** una FK a `ai_training_configs`: la config
es editable, y una FK haría que el histórico de un run cambiara al editarla. Un
run debe poder decir con qué parámetros corrió *realmente*, para siempre.

`runtime` guarda versiones de librería y GPU. «Misma configuración» no reproduce
nada si cambió la versión de ultralytics; sin esta columna, un resultado que no
se reproduce es indepurable.

```
platform.ai_training_events            -- append-only, una fila por época
  id       bigserial PK
  run_id   uuid NOT NULL → ai_training_runs(id)
  epoch    integer NULL
  at       timestamptz NOT NULL
  metrics  jsonb NULL      -- {box_loss, cls_loss, dfl_loss, mAP50, lr, …}
  message  text NULL
  INDEX (run_id, id)
```

Tabla aparte y no columnas en el run: el progreso es una serie temporal, se
consulta como curva, y crece a miles de filas por run. Sin partición en esta
fase (DEC-06: `PARTITION BY` es incompatible con la PK que necesitamos).

### 2.7 Fases 7 y 8 — Modelos, métricas, versionado

```
platform.ai_model_versions
  id                 uuid PK
  project_id         uuid NOT NULL → ai_projects(id)
  run_id             uuid NOT NULL → ai_training_runs(id)  UNIQUE
  version            integer NOT NULL          -- 1,2,3… por proyecto
  weights_asset_id   uuid NOT NULL → ai_assets(id)
  -- métricas (Fase 7)
  precision, recall            numeric(6,5)
  map50, map50_95              numeric(6,5)
  box_loss, cls_loss           numeric(10,6)
  training_seconds             integer
  metrics_per_class            jsonb          -- mAP por clase
  status             varchar(12) NOT NULL      -- candidate|active|archived|rejected
  published_at, published_by
  + auditoría

  UNIQUE (project_id, version)
  UNIQUE (project_id) WHERE status = 'active'      -- ← un solo activo, por el motor
```

Ese índice único parcial es el mecanismo entero de la Fase 8: **la base impide
dos modelos activos en un proyecto.** No hay forma de que un error de aplicación
o una carrera entre dos peticiones publiquen dos a la vez. Publicar es una
transacción con dos UPDATE; si otra publicación va en paralelo, una falla con
violación de unicidad y se traduce a `409 CONFLICT`.

- **Modelo activo** → `status = 'active'`.
- **Históricos** → `archived`.
- **Rollback** → activar una versión anterior. Es la misma operación que
  publicar, así que no hay un camino de código distinto que pueda estar roto
  justo el día que hace falta.
- Publicar y hacer rollback se registran en `platform.privileged_operation_log`.

`metrics_per_class` no es un adorno: un mAP global de 0.85 puede esconder que
`persona` está en 0.30. Sin desglose por clase, el desbalance es invisible hasta
que el modelo falla en producción con la clase que menos ejemplos tenía.

```
platform.ai_evaluations        -- lo que hace VÁLIDA la comparación
  id                  uuid PK
  model_version_id    uuid NOT NULL → ai_model_versions(id)
  dataset_version_id  uuid NOT NULL → ai_dataset_versions(id)
  split               varchar(5) NOT NULL
  map50, map50_95, precision, recall  numeric(6,5)
  metrics             jsonb
  evaluated_at        timestamptz NOT NULL
  UNIQUE (model_version_id, dataset_version_id, split)
```

Comparar las métricas *de entrenamiento* de dos modelos solo es legítimo si
usaron el mismo split. En cuanto el dataset crece, deja de serlo. Esta tabla
permite evaluar **cualquier modelo contra cualquier versión de dataset**, que es
la única comparación que se sostiene.

### 2.8 Fase 9 — Pruebas de inferencia

```
platform.ai_inference_tests
  id                     uuid PK
  model_version_id       uuid NOT NULL → ai_model_versions(id)
  image_asset_id         uuid NOT NULL → ai_assets(id)
  confidence_threshold   numeric(4,3) NOT NULL
  detections             jsonb NOT NULL   -- [{class_index,cx,cy,w,h,confidence}]
  latency_ms             integer
  ground_truth_image_id  uuid NULL → ai_images(id)   -- si se compara contra verdad
  + auditoría
```

Cuando `ground_truth_image_id` está presente, el IoU contra sus anotaciones se
calcula al vuelo: guardarlo sería un dato derivado que se desincroniza en cuanto
alguien corrige una anotación.

### 2.9 Relaciones

```
core.users ──────────┐
                     ├─→ platform.owners
                     │
                 ai_projects ──┬──→ ai_classes ─────────────┐
                     │         │                            │
                     │         ├──→ ai_assets ──┬──→ ai_images ──→ ai_annotations
                     │         │                │        │
                     │         │        (weights)│        │
                     │         │                │   ai_dataset_items
                     │         │                │        ↑
                     │         ├──→ ai_dataset_versions ──┘
                     │         │            │
                     │         ├──→ ai_training_configs
                     │         │            │
                     │         └──→ ai_training_runs ──→ ai_training_events
                     │                      │
                     │              ai_model_versions ──┬──→ ai_evaluations
                     │                      │           └──→ ai_inference_tests
                     └──────────────────────┘  (current_model_version_id)
```

Cada tabla hija lleva `project_id` además de la FK a su padre, y las FK son
**compuestas** — `(project_id, parent_id)` — igual que en `core`. Se verificó
empíricamente en fase 0 que es lo que impide mezclar jerarquías: sin ella, una
anotación podría referirse a una clase de otro proyecto y nada lo detendría.

---

## 3. Almacenamiento de imágenes

`olo_app` **no tiene USAGE sobre el schema `storage`** (verificado). El backend
no puede consultar `storage.objects` por SQL: todo pasa por la API REST de
Storage. Es una restricción, no un problema — mantiene el binario y el metadato
en capas separadas.

### 3.1 Buckets

| Bucket | Público | Contenido | Retención |
|---|---|---|---|
| `ai-source` | no | imágenes y vídeos originales | permanente |
| `ai-frames` | no | frames extraídos | regenerable |
| `ai-thumbs` | no | miniaturas | regenerable |
| `ai-weights` | no | `best.pt`, `last.pt` | según política, §9.5 |
| `ai-runs` | no | logs y gráficas del run | 90 días |

Ninguno público. Un dataset de un almacén real muestra su distribución, su
mercancía y a sus operarios: son datos del cliente.

### 3.2 Rutas

```
ai-source/{project_id}/{asset_id}.{ext}
ai-frames/{project_id}/{video_asset_id}/{frame_index:06d}.jpg
ai-weights/{project_id}/v{version}/best.pt
ai-runs/{project_id}/{run_id}/results.csv
```

Solo UUIDs e índices. Nada derivado del nombre del fichero: elimina de raíz el
*path traversal*, los caracteres problemáticos y las colisiones.

### 3.3 Acceso

Lectura por **URL firmada de vida corta** (5-15 min) emitida por el backend tras
comprobar `is_platform_owner()`. Nunca la clave anon contra estos buckets.

Subida: la app pide una URL firmada de subida, el navegador sube **directo a
Storage**, y luego confirma al backend, que registra el `ai_assets`. Así el
binario no atraviesa FastAPI. Para vídeos, subida reanudable (TUS) — una subida
de 500 MB por HTTP normal se pierde entera con un corte de red.

Consecuencia: entre «subido a Storage» y «confirmado» hay una ventana donde puede
quedar un objeto huérfano. Hace falta un barrido periódico de objetos sin fila en
`ai_assets` con más de 24 h. Sin él, el bucket acumula basura que nadie ve.

### 3.4 `core.files`, que ya se esperaba

`core.users.avatar_file_id` es una columna `uuid` que apunta a una tabla **que no
existe** (verificado). El diseño ya contaba con un registro genérico de ficheros.

Propongo separarlos, no unificarlos:

- **`core.files`** — ficheros de tenant (avatares, Excel de importación).
  RLS por tenant. Cierra la referencia colgante de `avatar_file_id`.
- **`platform.ai_assets`** — ficheros de plataforma. RLS por owner.

Una sola tabla con `tenant_id` nullable obligaría a políticas con `IS NULL` en el
predicado, que es exactamente la forma del agujero que corregí en la migración
0017: con `tenant_id` fijado y sin identidad se veían filas ajenas. Dos regímenes
de aislamiento, dos tablas, ningún predicado sobre NULL.

---

## 4. Estrategia de versionado

Tres cosas se versionan y son independientes:

| Qué | Mecanismo | Inmutable |
|---|---|---|
| **Dataset** | `ai_dataset_versions.version`, entero por proyecto | sí, tras congelar |
| **Modelo** | `ai_model_versions.version`, entero por proyecto | sí |
| **Fila** | columna `version` + `ETag`/`If-Match` | no: es bloqueo optimista |

Enteros y no semver: no hay compatibilidad que comunicar, solo orden.

Cadena de reproducibilidad completa:

```
modelo v4 → run → { dataset v2 (imágenes + splits + clases congeladas),
                    config_snapshot, seed, runtime }
```

Con eso, «reentrena la v4» es determinista salvo el no-determinismo de CUDA. Sin
cualquiera de las cuatro piezas, no lo es.

---

## 5. Pipeline de entrenamiento

### 5.1 D-1: dónde corre

Pediste que el entrenamiento viva dentro del sistema, y así debe ser — pero hay
que ser preciso sobre qué significa, porque hay un límite físico:

**Supabase no ofrece GPU.** No hay forma de entrenar YOLO en PostgreSQL, ni en
una Edge Function, ni dentro de FastAPI atendiendo una petición HTTP. Y también
verifiqué que **no hay `pg_cron` ni `pg_net`**, así que la base tampoco puede
lanzar trabajos por sí misma.

Lo que sí vive dentro del sistema, y es lo que importa:

- la **cola** y el estado de cada run
- la **configuración** y su congelación
- el **dataset** y sus versiones
- los **artefactos** (pesos, logs) y sus métricas
- el **ciclo de vida**: lanzar, cancelar, consultar, publicar, revertir

Lo que corre fuera es únicamente el **cómputo**, en un worker que nosotros
controlamos y que no expone nada: no recibe peticiones, solo reclama trabajo.

```
FastAPI ──INSERT run(queued)──→ PostgreSQL
                                    ↑ claim / heartbeat / eventos
                                    │
                          Training Worker (GPU)
                                    │
                                    └──→ Supabase Storage (pesos, logs)
```

El worker se autentica como su propia identidad de servicio, con permiso para
las tablas de runs y nada más. Tres opciones para alojarlo, en orden de coste:
una estación de trabajo con GPU para desarrollo, una VM con GPU por horas, o un
runner gestionado. **Esta decisión no bloquea las fases 1 a 5**, que son la mayor
parte del trabajo. Conviene tomarla antes de empezar la 6.

### 5.2 Reclamar trabajo sin carreras

```sql
UPDATE platform.ai_training_runs SET
    state = 'claimed', claimed_by = :worker, claimed_at = now(), heartbeat_at = now()
WHERE id = (
    SELECT id FROM platform.ai_training_runs
     WHERE state = 'queued'
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` es lo que permite varios workers sin que dos tomen el
mismo run y sin que se bloqueen entre sí.

### 5.3 Workers que mueren

Un worker puede caerse sin marcar nada. `heartbeat_at` se actualiza cada época; un
barrido marca `lost` los runs `running` con latido más viejo que el umbral, y
quedan reintentables (`attempt + 1`).

Sin esto, un run se queda en `running` **para siempre** y la interfaz muestra un
entrenamiento en curso que no existe. Es el fallo más habitual de este patrón.

### 5.4 Cancelación: cooperativa, y hay que decirlo

Cancelar escribe `cancel_requested_at`. El worker lo comprueba **entre épocas** y
termina limpio.

No es instantáneo, y no puede serlo: interrumpir a mitad de época deja el
checkpoint a medias. Con 300 imágenes y `batch=16` una época es de segundos; con
50 000 puede ser minutos. **La interfaz debe decir "cancelación solicitada" y no
"cancelado"** hasta que el worker confirme. Prometer lo contrario es un fallo de
producto, no de código.

### 5.5 Progreso

El worker inserta en `ai_training_events` una fila por época. El frontend
consulta ese histórico. Realtime de Supabase es la mejora natural, pero hay que
publicar la tabla explícitamente y ninguna lo está todavía; sondeo cada pocos
segundos es suficiente para empezar y no tiene coste de diseño.

---

## 6. Flujos de estado

### 6.1 Imagen — D-5, con una corrección a tu especificación

Pediste: pendiente → anotada → validada → **entrenada** → archivada.

Los cuatro primeros y el último son propiedades de la imagen. **«Entrenada» no
lo es.** Es una propiedad de la relación *(imagen, versión de dataset)*.

El caso que lo rompe es normal, no exótico: una imagen entra en el dataset v1, se
entrena, queda «entrenada». Luego se detecta que su anotación estaba mal, se
corrige y se incluye en el v2. ¿Qué estado tiene? «Entrenada» es cierto para v1
y falso para v2. Un único campo no puede representarlo, y lo que ocurre en la
práctica es que se queda pegado en «entrenada» y deja de reflejar la realidad.

Propuesta:

```
pending ──anotar──→ annotated ──validar──→ validated
   │                    │                      │
   │                    └──rechazar──→ rejected│
   └────────────────────────────────────────────┴──→ archived
```

Y «entrenada» se **deriva**: existe una fila en `ai_dataset_items` para una
versión con un run `succeeded`. Siempre exacto, imposible de desincronizar, y en
la interfaz se muestra igual: «entrenada en v1, v2».

Solo `validated` entra en una versión de dataset. Es la puerta de calidad de tu
pipeline.

Si prefieres los cinco estados literales, se puede hacer — pero entonces hay que
aceptar que ese campo será inexacto en cuanto haya una segunda versión.

### 6.2 Run

```
queued ──claim──→ claimed ──→ running ──→ succeeded
   │                             │  │
   │                             │  ├──→ failed ──(reintento)──→ queued
   │                             │  └──→ lost   ──(reintento)──→ queued
   └──cancelar──→ cancelled ←────┘
```

### 6.3 Modelo

```
(run succeeded) → candidate ──publicar──→ active ──(otra publicación)──→ archived
                      │                      ↑                              │
                      └──→ rejected          └──────── rollback ────────────┘
```

### 6.4 Proyecto

```
draft → collecting → annotating → training → published → archived
```
Indicativo, no restrictivo: un proyecto publicado sigue recibiendo imágenes.

---

## 7. Arquitectura del módulo

### 7.1 Backend

Se respeta la estructura existente, sin inventar capas:

```
api/v1/ai_projects.py, ai_classes.py, ai_datasets.py,
        ai_annotations.py, ai_training.py, ai_models.py, ai_inference.py
domain/ai/          entidades y máquinas de estado
repositories/ai/    SQL, sin filtrado por tenant (lo hace RLS)
services/ai/        reglas: congelar dataset, publicar modelo, exportar YOLO
storage/            cliente de Supabase Storage, URLs firmadas
workers/training/   proceso aparte, no importable desde la API
```

Una dependencia nueva junto a `require(permission)`:

```
require_platform_owner()   →  403 NOT_PLATFORM_OWNER
```

Código de error nuevo, distinto de `FORBIDDEN`: el frontend debe poder decir
«esta zona es de administración de plataforma» y no «te falta un permiso», que
mandaría al usuario a pedir algo que un administrador de tenant no puede dar.

### 7.2 Exportación al formato YOLO

Entre «congelar dataset» y «entrenar» hay un paso que merece nombre propio: el
worker materializa la versión congelada en el layout que espera ultralytics
(`images/train`, `labels/train`, `data.yaml` con las clases del snapshot). Es
determinista y derivado, así que no se guarda: se regenera. Es también el punto
natural donde un error de coordenadas se detecta antes de gastar una GPU.

### 7.3 Frontend

Un módulo nuevo bajo `/ai`, visible solo si `is_platform_owner`. Los items que
hoy marqué «fase 1» en la navegación pasan a reales al registrar los permisos.

La pieza con peso propio es el **anotador**: canvas con cajas, atajos de teclado,
navegación entre imágenes sin recargar. Es la pantalla donde se gastarán horas
reales de trabajo, y merece su propio diseño; conviene no subestimarla porque es,
con diferencia, el mayor esfuerzo de UI de todo el módulo.

---

## 8. Arquitectura de importaciones masivas (solo diseño)

Sin implementación, como pediste. Tablas en `core`, con RLS por tenant: **esto sí
es de tenant**, al contrario que el módulo de IA.

```
core.import_profiles           -- el motor de mapeo
  id, tenant_id, entity_type, name, version, is_active
  column_map  jsonb   -- [{source,target,transform,required,default}]
  options     jsonb   -- {sheet, header_row, date_format, decimal_sep, encoding}
  UNIQUE (tenant_id, entity_type, name, version)

core.import_batches
  id, tenant_id, entity_type, profile_id, file_id → core.files
  state             -- uploaded|profiling|validating|validated|committing|committed|failed|cancelled
  idempotency_key   -- UNIQUE (tenant_id, idempotency_key)
  total_rows, valid_rows, invalid_rows, committed_rows
  started_at, finished_at, created_by

core.import_rows               -- staging: el trabajo sucio fuera de las tablas reales
  batch_id, row_number   PRIMARY KEY (batch_id, row_number)
  raw     jsonb   -- la fila tal como vino
  mapped  jsonb   -- tras aplicar el perfil
  state           -- pending|valid|invalid|committed|skipped
  target_id uuid  -- entidad creada o actualizada

core.import_row_errors
  batch_id, row_number, field, code, message, severity
```

Cuatro propiedades que considero irrenunciables:

1. **Staging.** Las filas se validan en `import_rows`, no contra las tablas
   reales. Un Excel de 40 000 filas con 12 malas no debe dejar 39 988 aplicadas
   ni obligar a repetir todo.
2. **Dos fases.** Validar entero → mostrar errores → confirmar. Nunca aplicar a
   medias.
3. **Mapeo como dato, no como código.** Cada cliente trae sus cabeceras. El
   perfil se guarda, se versiona y se reutiliza; añadir un cliente no toca el
   backend. La primera importación propone un mapeo por similitud de nombres y el
   usuario lo corrige — esa corrección **es** el perfil.
4. **Idempotencia.** `idempotency_key` por tenant: reintentar una importación
   interrumpida no duplica nada.

**Dependencia que conviene tener presente:** de las ocho entidades que quieres
importar, solo existen hoy `locations` (y `warehouses`, `areas`). `products`,
`pallets`, `lots`, `series`, `customers`, `suppliers` e `inventory` **no tienen
tablas**. La arquitectura del importador se puede acordar ya; su implementación
depende de esas migraciones. Cuando me pases los Excel reales del WMS, el orden
sensato es: modelar la entidad, y después importarla.

---

## 9. Riesgos técnicos

### 9.1 GPU — bloquea la Fase 6, nada más
Ya tratado en §5.1. Mitigación: decidir el alojamiento del worker antes de la
Fase 6; con CPU se puede validar el pipeline completo con un dataset diminuto,
solo será lento.

### 9.2 Privilegios que faltan — bloquea la primera migración
`olo_app` no tiene USAGE sobre `platform` (verificado). Sin `GRANT USAGE` y
`ALTER DEFAULT PRIVILEGES`, todas las consultas del módulo fallan con 42501, y
además `FORCE ROW LEVEL SECURITY` afecta al propietario. Hay que resolverlo en la
migración de preparación, no descubrirlo con el primer endpoint.

### 9.3 `class_index` — corrupción silenciosa
§2.2. Es el riesgo más peligroso porque **no produce ningún error**: produce
detecciones con la etiqueta equivocada. Mitigación: inmutabilidad, desactivación
en lugar de borrado, y `class_snapshot` por versión.

### 9.4 Fuga entre train y val — métricas que mienten hacia arriba
Duplicados por contenido y splits sorteados en cada run. Mitigación:
`UNIQUE (project_id, sha256)` y splits congelados. El síntoma de este fallo es
un modelo excelente en las métricas y mediocre en la realidad.

### 9.5 Crecimiento de pesos y almacenamiento
`yolov8n` pesa ~6 MB; `yolov8x`, ~130 MB. Cada run produce `best.pt` y
`last.pt`. Cien experimentos con modelos grandes son decenas de GB.
Mitigación: `last.pt` solo mientras el run vive; conservar `best.pt` de las
versiones publicadas y de las N últimas candidatas; `ai-runs` con 90 días.
Decidir la política **antes** de acumular, no después.

### 9.6 Subidas grandes y extracción de frames
Un vídeo de 500 MB por HTTP normal se pierde entero con un corte. TUS resuelve
la subida. La extracción de frames necesita ffmpeg y CPU sostenida: va en el
worker, jamás en el proceso que atiende peticiones. Un vídeo de 10 min a 5 fps
son 3 000 imágenes — hay que poner un límite por vídeo y avisarlo.

### 9.7 Reproducibilidad
Sin `seed` ni `runtime`, un resultado que no se reproduce es indepurable.
Mitigación: ambas columnas. Aun así, CUDA no es determinista al 100 %; hay que
esperar variación pequeña y no perseguirla.

### 9.8 Runs zombis
§5.3. Sin latido y barrido, la interfaz miente indefinidamente.

### 9.9 Bloqueo de plataforma
§1.3. Revocar al último owner deja el módulo inaccesible sin recuperación por la
aplicación. Mitigación: trigger que lo impide.

### 9.10 Desbalance de clases
«Montacargas» tendrá cientos de ejemplos y «drone» quizá diez. El mAP global lo
oculta. Mitigación: `metrics_per_class` y avisar en la UI cuando una clase activa
baje de un mínimo de ejemplos anotados.

### 9.11 Calidad de anotación
El techo del modelo lo pone la anotación, no la arquitectura. En esta fase el
único control es el estado `validated`. Cuando haya varios anotadores habrá que
medir acuerdo entre ellos; `reviewed_by` ya deja sitio.

### 9.12 Auditoría inexistente
`audit.events` y `platform.privileged_operation_log` no existen. Publicar un
modelo, hacer rollback o conceder un Platform Owner son operaciones que **deben**
dejar rastro. Es prerrequisito, no adorno.

---

## 10. Plan de implementación por fases

Migraciones sobre la 0018, la última aplicada. Cada una con su rollback, una a la
vez, verificada contra la base real — el ciclo de siempre.

### Bloque 0 · Prerrequisitos (pequeño, desbloquea todo)

| # | Contenido | Por qué antes |
|---|---|---|
| 0019 | `GRANT USAGE`/default privileges en `platform` | sin esto nada funciona (§9.2) |
| 0020 | `platform.owners`, `core.is_platform_owner()`, trigger del último owner, siembra del primero | §1 |
| 0021 | `audit.events` + `platform.privileged_operation_log` | §9.12 |
| 0022 | permisos nuevos en `core.permissions` | enciende la navegación |
| 0023 | `core.files` | cierra `users.avatar_file_id` y sirve a las importaciones |

Backend: `require_platform_owner()`, `is_platform_owner` en `/auth/me`, código
`NOT_PLATFORM_OWNER`.
**Comprobación de que el bloque está bien:** Andrey entra al módulo y cualquier
otro usuario recibe 403 — sin que ningún correo aparezca en el código.

### Bloque 1 · Proyectos y clases (Fases 1 y 2)
Migraciones 0024-0025. CRUD completo de ambos, con el patrón ya establecido
(keyset, `ETag`/`If-Match`, borrado lógico). Primera pantalla del módulo.
**Comprobación:** crear un proyecto con 10 clases y desactivar una sin que se
renumere ninguna.

### Bloque 2 · Assets e imágenes (Fase 3)
Migración 0026. URLs firmadas, subida directa a Storage, confirmación, miniaturas,
deduplicación por sha256, barrido de huérfanos. Vídeo y extracción de frames al
final del bloque, porque necesita el worker.
**Comprobación:** subir la misma imagen dos veces y que la segunda se rechace por
duplicada.

### Bloque 3 · Anotaciones y dataset (Fases 4 y 5)
Migraciones 0027-0028. El anotador de bounding boxes es la pieza grande de UI
(§7.3). Congelación de versiones y exportación a formato YOLO.
**Comprobación:** congelar una versión, exportarla y que ultralytics la lea sin
avisos.

### Bloque 4 · Entrenamiento (Fase 6)
Migración 0029. Aquí hace falta D-1 resuelto. Worker, claim, latido, barrido,
cancelación cooperativa, eventos por época.
**Comprobación:** lanzar dos runs con dos workers y que ninguno tome el mismo;
matar un worker a media época y ver el run pasar a `lost` y reintentarse.

### Bloque 5 · Modelos y resultados (Fases 7 y 8)
Migración 0030. Métricas, versionado, publicación, rollback, evaluaciones
cruzadas y comparación.
**Comprobación:** dos publicaciones concurrentes y que una reciba 409 en lugar de
dejar dos modelos activos.

### Bloque 6 · Inferencia de prueba (Fase 9)
Migración 0031. Subir una imagen, inferir con el modelo activo, dibujar
detecciones, comparar contra la verdad si existe.

### Bloque 7 · Importaciones (cuando lleguen los Excel reales)
Migraciones a partir de 0032, y **primero las entidades de destino**, que no
existen (§8).

---

## Lo que este documento no resuelve

- **Dónde corre el worker con GPU** (D-1). No bloquea los bloques 0 a 3.
- **Cuántos frames por vídeo** como máximo. Es una decisión de producto con
  impacto directo en coste de almacenamiento.
- **Política de retención de pesos** (§9.5). Hay que fijarla antes de acumular.
- **Si el módulo será algún día multi-tenant.** El diseño no lo impide: se
  añadirían `owner_scope` + `tenant_id` con un CHECK que los ligue, evitando
  predicados sobre NULL. Pero no lo diseño ahora para no pagar complejidad por
  algo que quizá no ocurra.
