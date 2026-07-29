# Bloque 0 — Plan exacto de migraciones

> **Estado: propuesta. Nada ejecutado.** Última migración aplicada: **0018**.
>
> Verificado contra la base real el 2026-07-29 antes de escribir este plan:
> `platform` existe y está vacío · `olo_app` sin USAGE en `platform` ni `storage`
> · `postgres` tiene `rolbypassrls = true` · `core.permissions` tiene PK sobre
> `code` con CHECK `^[a-z_]+:[a-z_]+$` · `core.role_permissions` referencia
> `permission_code` sin ninguna guarda de alcance.

---

## 1. Resumen

**12 migraciones (0019 → 0030). 9 tablas nuevas. 2 tablas existentes alteradas.**

| Bloque | Migraciones | Tablas |
|---|---|---|
| Habilitar la plataforma | 0019 – 0024 | 2 |
| Tablas base del módulo | 0025 – 0030 | 7 |

Ninguna migración toca datos de negocio existentes. La única alteración de una
tabla ya aplicada es `core.permissions` (0022), aditiva y con valor por defecto.

---

## 2. Lista exacta

### 0019 · `0019_platform_schema_privileges.sql`

**Crea:** ninguna tabla.
**Depende de:** 0001 (schema `platform`), 0002 (rol `olo_app`).

```
GRANT USAGE ON SCHEMA platform TO olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
      GRANT USAGE, SELECT ON SEQUENCES TO olo_app;
```

**Por qué va primera.** `olo_app` no tiene USAGE sobre `platform` (verificado).
Sin esto, toda consulta del módulo falla con `42501` y el síntoma aparece en el
primer endpoint, lejos de su causa — es exactamente el fallo que la migración
0018 tuvo que corregir con el schema `auth`.

**`FOR ROLE postgres` es imprescindible.** `ALTER DEFAULT PRIVILEGES` solo afecta
a objetos futuros creados por el rol indicado. Las migraciones corren como
`postgres`; sin la cláusula, el `ALTER` aplicaría al rol de la sesión y las
tablas de 0025+ nacerían sin permisos.

**Riesgo:** bajo. No concede `CREATE`: `olo_app` no debe crear objetos.
**Rollback:** `REVOKE` + `ALTER DEFAULT PRIVILEGES ... REVOKE`.

---

### 0020 · `0020_platform_owners.sql`

**Crea:**

| Objeto | Tipo |
|---|---|
| `platform.owners` | tabla |
| `core.is_platform_owner()` | función `SECURITY DEFINER STABLE` |
| `platform.prevent_last_owner_revocation()` | función de trigger |
| `trg_owners_last_guard` | trigger `AFTER UPDATE OR DELETE` |
| `owners_platform_only` | política RESTRICTIVE |
| `owners_read`, `owners_write` | políticas PERMISSIVE |

```
platform.owners
  user_id     uuid        PRIMARY KEY  → core.users(id)
  granted_by  uuid        NULL         → core.users(id)
  granted_at  timestamptz NOT NULL DEFAULT now()
  revoked_at  timestamptz NULL
  reason      text        NOT NULL
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
  CHECK (granted_by IS DISTINCT FROM user_id)   -- nadie se concede a sí mismo
  INDEX (user_id) WHERE revoked_at IS NULL
```

**Depende de:** 0010 (`core.users`), 0015 (`core.current_user_id()`), 0019.

`user_id` como clave primaria: un usuario es o no es owner, no hay dos
concesiones simultáneas. La revocación es lógica para conservar la historia.

`core.is_platform_owner()` es `SECURITY DEFINER` por la misma razón que
`core.current_auth_id()` en 0018: `olo_app` no tiene USAGE sobre `platform`, y
concederlo abriría el schema entero cuando solo hace falta esta lectura.

El trigger del último owner es la única protección posible contra el bloqueo
total: un `CHECK` no puede evaluar una condición sobre la tabla completa. Si se
revocara al último, nadie podría volver a conceder el privilegio **y no habría
recuperación por la aplicación**.

**Riesgo:** medio — es la tabla que gobierna el acceso al módulo entero.
**Rollback:** `DROP` de trigger, políticas, tabla y función, en ese orden.

---

### 0021 · `0021_seed_first_platform_owner.sql`

**Crea:** ninguna tabla. Inserta **una fila**.
**Depende de:** 0020.

```
INSERT INTO platform.owners (user_id, granted_by, granted_at, reason)
SELECT u.id, NULL, now(), 'Owner inicial de plataforma. Bootstrap: Bloque 0.'
  FROM core.users u
 WHERE u.email = 'arojas@ologistics.com' AND u.deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;
```

**El único sitio del sistema donde un correo decide algo.** Es aceptable porque
es DDL revisada y versionada, no lógica de aplicación: el primer owner no lo
puede conceder otro owner. A partir de aquí, conceder es una operación de la API
que exige ser owner.

**No falla si el usuario no existe.** Es un `INSERT ... SELECT`: en un entorno
donde ese correo no esté sembrado inserta cero filas y la migración pasa. Así el
archivo es aplicable en cualquier entorno sin ser específico de este.

`granted_by = NULL` es correcto y está permitido solo aquí; el `CHECK` de 0020
impide que alguien se lo conceda a sí mismo, y NULL no lo viola.

**Nota sobre RLS:** `postgres` tiene `rolbypassrls = true` (verificado), así que
la siembra no choca con `FORCE ROW LEVEL SECURITY`. Por eso puede ir en su propia
migración en lugar de tener que ir antes de activar las políticas.

**Riesgo:** bajo.
**Rollback:** `DELETE` de esa fila — deshabilitando primero el trigger del último
owner, que si no aborta el propio rollback.

---

### 0022 · `0022_permission_scope_guard.sql`

**Altera:** `core.permissions` (aditivo).
**Crea:** `core.reject_platform_permission_on_role()` + trigger sobre
`core.role_permissions`.
**Depende de:** 0013.

```
ALTER TABLE core.permissions
  ADD COLUMN scope varchar(10) NOT NULL DEFAULT 'tenant';
ALTER TABLE core.permissions
  ADD CONSTRAINT chk_perm_scope CHECK (scope IN ('tenant','platform'));

-- Trigger BEFORE INSERT OR UPDATE ON core.role_permissions:
--   aborta si el permiso referenciado tiene scope = 'platform'.
```

**⚠ Esta migración cierra una vía de escalada de privilegios que encontré al
revisar el esquema, y es la razón por la que existe.**

`core.roles` admite roles personalizados por tenant (`roles.tenant_id` es
nullable, los de sistema lo tienen NULL). Sin esta guarda, un `tenant_admin`
podría crear un rol propio, asignarle `ai_models:publish` y otorgárselo a un
usuario de su tenant. Ese usuario tendría el permiso en su `/auth/me`, y
bastaría **un** endpoint del módulo que comprobara el permiso en lugar de
`is_platform_owner()` para que publicara modelos de la plataforma.

La defensa correcta es doble y ambas capas van en el Bloque 0:

1. **Aquí, en el motor:** un permiso de plataforma no puede entrar en un rol de
   tenant. La escalada es imposible aunque el código de aplicación se equivoque.
2. **En la aplicación:** todos los endpoints del módulo pasan por
   `require_platform_owner()` **antes** de mirar cualquier permiso.

Confiar solo en la capa 2 es confiar en que ningún endpoint futuro se escriba mal.

**Riesgo:** medio — altera una tabla aplicada y añade un trigger a la ruta de
asignación de permisos. Mitigado: la columna tiene DEFAULT, así que las 30 filas
existentes quedan `'tenant'`, y el trigger solo puede rechazar filas que hoy
nadie inserta.
**Rollback:** `DROP` de trigger y función, `DROP COLUMN scope`, `DROP CONSTRAINT`.

---

### 0023 · `0023_ai_permission_catalog.sql`

**Crea:** ninguna tabla. Inserta **23 filas** en `core.permissions`, todas con
`scope = 'platform'` e `is_privileged = true`.
**Depende de:** 0022.

| Módulo | Acciones | n |
|---|---|---|
| `ai_projects` | `read`, `write`, `delete` | 3 |
| `ai_classes` | `read`, `write` | 2 |
| `datasets` | `read`, `write`, `import` | 3 |
| `annotations` | `read`, `write`, `validate` | 3 |
| `training` | `read`, `launch`, `cancel` | 3 |
| `ai_models` | `read`, `publish`, `rollback`, `compare` | 4 |
| `inference` | `read`, `run` | 2 |
| `platform_owners` | `read`, `grant`, `revoke` | 3 |

Los 23 códigos cumplen `^[a-z_]+:[a-z_]+$` y la regla `code = module:action`, los
dos CHECK que ya tiene la tabla (verificados).

**No se mapean a ningún rol**, a propósito: se conceden por ser owner, no por
tener un rol. Y el trigger de 0022 impide que alguien los mapee.

**Cuatro de estos nombres ya los pide el frontend.** Los items que hoy aparecen
marcados «fase 1» en la navegación piden `ai_models:read`, `inference:read`,
`datasets:*` y `training:*`. Al registrarlos pasan a «pendiente» sin tocar la UI.

**Riesgo:** bajo. Solo inserta en un catálogo.
**Rollback:** `DELETE` por `code`.

---

### 0024 · `0024_privileged_operation_log.sql`

**Crea:** `platform.privileged_operation_log` + políticas RLS.
**Depende de:** 0019, 0010.

```
platform.privileged_operation_log
  id              bigserial   PRIMARY KEY
  occurred_at     timestamptz NOT NULL DEFAULT now()
  actor_user_id   uuid        NOT NULL → core.users(id)
  operation       varchar(60) NOT NULL   -- owner.grant, owner.revoke, model.publish…
  target_type     varchar(40) NOT NULL
  target_id       uuid        NULL
  before_state    jsonb       NULL
  after_state     jsonb       NULL
  request_id      uuid        NULL
  correlation_id  uuid        NULL
  INDEX (occurred_at DESC), INDEX (actor_user_id, occurred_at DESC)
```

Append-only: políticas de `SELECT` e `INSERT`, ninguna de `UPDATE` ni `DELETE`.

**Por qué en el Bloque 0 y no después.** Conceder y revocar un Platform Owner
son las primeras operaciones privilegiadas que existirán, y ocurren en este
bloque. Un registro que empieza a llenarse *después* de las concesiones iniciales
no sirve para auditar cómo se concedieron.

`audit.events` (auditoría general de negocio) **no** entra aquí: es más grande,
arrastra la discusión de particionado de DEC-06 y no bloquea nada del módulo.
Queda para el bloque de entrenamiento.

**Riesgo:** bajo.
**Rollback:** `DROP TABLE`.

---

### 0025 · `0025_ai_projects.sql`

**Crea:** `platform.ai_projects` + políticas + trigger `set_updated_at`.
**Depende de:** 0020 (`is_platform_owner`), 0010 (`core.users`), 0019.

```
platform.ai_projects
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
  name          varchar(120) NOT NULL
  slug          varchar(120) NOT NULL
  description   text NULL
  base_model    varchar(60)  NOT NULL
  task          varchar(20)  NOT NULL DEFAULT 'detect'
  status        varchar(24)  NOT NULL DEFAULT 'draft'
  -- configuración de extracción de frames, POR PROYECTO (decisión operativa)
  frame_interval_seconds   numeric(6,3) NOT NULL DEFAULT 1.0
  max_frames_per_video     integer      NOT NULL DEFAULT 1000
  max_video_duration_secs  integer      NOT NULL DEFAULT 1200
  -- auditoría de la casa
  created_at, created_by, updated_at, updated_by, version, deleted_at

  UNIQUE (slug) WHERE deleted_at IS NULL
  UNIQUE (id, id)  → ver nota de FK compuesta abajo
  CHECK (task   IN ('detect','segment','pose'))
  CHECK (status IN ('draft','collecting','annotating','training','published','archived'))
  CHECK (frame_interval_seconds  > 0    AND frame_interval_seconds  <= 60)
  CHECK (max_frames_per_video    BETWEEN 1 AND 100000)
  CHECK (max_video_duration_secs BETWEEN 1 AND 7200)
```

Los tres campos de frames son los valores iniciales que fijaste — 1 fps, 1 000
frames, 20 minutos — como **defaults configurables por proyecto**, no como límite
global rígido. Los CHECK son topes de cordura, no política.

`current_model_version_id` **no** se crea aquí: apuntaría a una tabla del bloque
de modelos, que no existe todavía. Se añadirá entonces con un `ALTER`.

**Riesgo:** bajo.
**Rollback:** `DROP TABLE`.

---

### 0026 · `0026_ai_classes.sql`

**Crea:** `platform.ai_classes` + `platform.prevent_class_index_change()` +
trigger + políticas.
**Depende de:** 0025.

```
platform.ai_classes
  id           uuid PRIMARY KEY
  project_id   uuid NOT NULL → ai_projects(id)
  name         varchar(60) NOT NULL
  class_index  smallint    NOT NULL      -- INMUTABLE
  color        char(7)     NOT NULL
  description  text NULL
  is_active    boolean     NOT NULL DEFAULT true
  + auditoría

  UNIQUE (project_id, id)                          -- destino de FK compuesta
  UNIQUE (project_id, name)        WHERE deleted_at IS NULL
  UNIQUE (project_id, class_index)
  CHECK  (class_index >= 0)
  CHECK  (color ~ '^#[0-9A-Fa-f]{6}$')
```

**El trigger de inmutabilidad es el corazón de la decisión 4.** Aborta cualquier
`UPDATE` que cambie `class_index`. No basta con no exponerlo en la API: los pesos
de YOLO guardan índices, no nombres, y renumerar hace que un modelo entrenado
devuelva la etiqueta equivocada **sin producir ningún error**. La única defensa
fiable está en el motor.

Las clases se desactivan (`is_active = false`), nunca se renumeran. `deleted_at`
existe por coherencia con el resto del esquema, pero el flujo correcto es la
desactivación.

**Riesgo:** bajo.
**Rollback:** `DROP` de trigger, función y tabla.

---

### 0027 · `0027_ai_assets.sql`

**Crea:** `platform.ai_assets` + políticas.
**Depende de:** 0025.

```
platform.ai_assets
  id                 uuid PRIMARY KEY
  project_id         uuid NOT NULL → ai_projects(id)
  kind               varchar(20)  NOT NULL
  bucket             varchar(63)  NOT NULL
  object_path        text         NOT NULL
  original_filename  text         NOT NULL
  content_type       varchar(100) NOT NULL
  bytes              bigint       NOT NULL
  sha256             char(64)     NOT NULL
  width, height      integer NULL
  duration_ms        integer NULL
  uploaded_at        timestamptz NOT NULL DEFAULT now()
  + auditoría

  UNIQUE (project_id, id)                       -- destino de FK compuesta
  UNIQUE (bucket, object_path)
  UNIQUE (project_id, sha256) WHERE kind IN ('image','frame') AND deleted_at IS NULL
  CHECK  (kind IN ('image','video','frame','thumbnail','weights','run_artifact'))
  CHECK  (bytes > 0)
  CHECK  (sha256 ~ '^[0-9a-f]{64}$')
  CHECK  (kind <> 'video' OR duration_ms IS NOT NULL)
```

`UNIQUE (project_id, sha256)` es la deduplicación por contenido. Sin ella, la
misma foto subida dos veces puede acabar una en `train` y otra en `val`: fuga de
datos cuyo único síntoma son métricas demasiado buenas.

**Solo metadatos.** Ningún binario en PostgreSQL (decisión 13). `object_path` la
genera el servidor a partir de UUIDs; el nombre del usuario se guarda como dato
para poder mostrarlo, nunca como ruta.

**Riesgo:** bajo.
**Rollback:** `DROP TABLE`.

---

### 0028 · `0028_ai_images.sql`

**Crea:** `platform.ai_images` + políticas.
**Depende de:** 0027.

```
platform.ai_images
  id                     uuid PRIMARY KEY
  project_id             uuid NOT NULL
  asset_id               uuid NOT NULL
  source                 varchar(10) NOT NULL
  source_video_asset_id  uuid NULL
  frame_index            integer NULL
  frame_timestamp_ms     integer NULL
  status                 varchar(16) NOT NULL DEFAULT 'pending'
  annotated_by, annotated_at, reviewed_by, reviewed_at
  + auditoría

  FOREIGN KEY (project_id, asset_id)              → ai_assets(project_id, id)
  FOREIGN KEY (project_id, source_video_asset_id) → ai_assets(project_id, id)
  UNIQUE (project_id, id)          -- destino de FK compuesta
  UNIQUE (asset_id)
  UNIQUE (source_video_asset_id, frame_index) WHERE source = 'frame'
  CHECK  (source IN ('upload','frame'))
  CHECK  ((source = 'frame') = (source_video_asset_id IS NOT NULL))
  CHECK  ((source = 'frame') = (frame_index IS NOT NULL))
  CHECK  (status IN ('pending','annotated','validated','rejected','archived'))
```

**`'entrenada'` no está en la lista de estados. Es la decisión 7.** Se deriva de
la pertenencia a una versión de dataset con un entrenamiento exitoso.

Las **FK compuestas** `(project_id, asset_id)` son el mecanismo verificado
empíricamente en fase 0 para impedir mezclar jerarquías: sin ellas una imagen
podría apuntar a un asset de otro proyecto y nada lo detendría.

**Riesgo:** bajo.
**Rollback:** `DROP TABLE`.

---

### 0029 · `0029_ai_dataset_versions.sql`

**Crea:** `platform.ai_dataset_versions`, `platform.ai_dataset_items`,
`platform.reject_frozen_dataset_change()` + triggers + políticas.
**Depende de:** 0028, 0026.

```
platform.ai_dataset_versions
  id              uuid PRIMARY KEY
  project_id      uuid NOT NULL → ai_projects(id)
  version         integer NOT NULL
  name            varchar(120) NULL
  notes           text NULL
  class_snapshot  jsonb   NOT NULL      -- [{index,name},…] congelado
  image_count     integer NOT NULL
  train_count, val_count, test_count integer NOT NULL
  split_seed      integer NOT NULL
  frozen_at       timestamptz NOT NULL DEFAULT now()
  created_at, created_by

  UNIQUE (project_id, version)
  UNIQUE (project_id, id)          -- destino de FK compuesta
  CHECK  (version > 0)
  CHECK  (image_count = train_count + val_count + test_count)
  CHECK  (jsonb_typeof(class_snapshot) = 'array')

platform.ai_dataset_items
  dataset_version_id  uuid NOT NULL
  image_id            uuid NOT NULL
  project_id          uuid NOT NULL
  split               varchar(5) NOT NULL
  PRIMARY KEY (dataset_version_id, image_id)
  FOREIGN KEY (project_id, dataset_version_id) → ai_dataset_versions(project_id, id)
  FOREIGN KEY (project_id, image_id)           → ai_images(project_id, id)
  CHECK (split IN ('train','val','test'))
  INDEX (dataset_version_id, split)
```

**Inmutabilidad con trigger, no solo por ausencia de política (decisión 5).**

Una tabla con RLS y sin política de `UPDATE` no rechaza el `UPDATE`: lo deja en
**cero filas afectadas, en silencio**. Lo comprobé hoy al corregir un nombre en
`core.users` — el `UPDATE` devolvió 0 filas en lugar de fallar. Para
inmutabilidad eso es insuficiente: quien intente modificar un dataset congelado
debe recibir un error, no creer que funcionó.

Por eso: sin políticas de `UPDATE`/`DELETE` **y** trigger que aborta. La primera
capa protege de `olo_app`; la segunda protege también de `postgres`, que tiene
`rolbypassrls`.

`class_snapshot` congela el vocabulario. Junto con `split_seed` y los tres
recuentos, es lo que hace reproducible un entrenamiento y comparables dos
modelos.

**Riesgo:** medio — dos tablas, cuatro FK compuestas y dos triggers.
**Rollback:** `DROP` en orden inverso (items → versions → función).

---

### 0030 · `0030_ai_annotations.sql` — **recomendada, tú decides**

**Crea:** `platform.ai_annotations` + políticas.
**Depende de:** 0028, 0026.

```
platform.ai_annotations
  id          uuid PRIMARY KEY
  project_id  uuid NOT NULL
  image_id    uuid NOT NULL
  class_id    uuid NOT NULL
  kind        varchar(12) NOT NULL DEFAULT 'bbox'
  cx, cy, w, h  numeric(9,8) NULL
  geometry    jsonb NULL
  origin      varchar(10) NOT NULL DEFAULT 'human'
  confidence  numeric(4,3) NULL
  + auditoría

  FOREIGN KEY (project_id, image_id) → ai_images(project_id, id)
  FOREIGN KEY (project_id, class_id) → ai_classes(project_id, id)
  CHECK (kind   IN ('bbox','polygon','keypoints'))
  CHECK (origin IN ('human','model','imported'))
  CHECK ( (kind =  'bbox' AND cx IS NOT NULL AND geometry IS NULL)
       OR (kind <> 'bbox' AND cx IS     NULL AND geometry IS NOT NULL) )
  CHECK (cx BETWEEN 0 AND 1 AND cy BETWEEN 0 AND 1)
  CHECK (w > 0 AND w <= 1 AND h > 0 AND h <= 1)
  CHECK (cx - w/2 >= -1e-6 AND cx + w/2 <= 1 + 1e-6)
  CHECK (cy - h/2 >= -1e-6 AND cy + h/2 <= 1 + 1e-6)
  CHECK ((origin = 'human') = (confidence IS NULL))
  INDEX (image_id) WHERE deleted_at IS NULL
```

**Por qué la recomiendo dentro del Bloque 0.** Lo que excluiste es el *anotador
visual*, que es interfaz; esta es solo la tabla. Sin ella, dos cosas que sí están
en el bloque quedan sin referente: el estado `annotated` de `ai_images` no puede
alcanzarse nunca, y congelar una versión de dataset no puede validar que las
imágenes tengan anotaciones. Añadirla después obliga a revisar la semántica de
tablas ya creadas.

Los CHECK de geometría son la razón de usar columnas tipadas para `bbox`: con
`jsonb`, una caja fuera de la imagen entraría sin protestar y reventaría en el
entrenamiento, a mucha distancia de su causa.

**Si prefieres dejarla fuera**, se omite sin renumerar nada: es la última y
ninguna otra depende de ella.

**Riesgo:** bajo.
**Rollback:** `DROP TABLE`.

---

## 3. Grafo de dependencias

```
0001 ─┬─→ 0019 ─┬─→ 0020 ─→ 0021
0002 ─┘         │     │
                │     └─────────────────┐
0010 ───────────┴─→ 0024               │
0015 ───────────────→ 0020             │
                                        ↓
0013 ─→ 0022 ─→ 0023              0025 (ai_projects)
                                    ├─→ 0026 (ai_classes) ──┬─→ 0029
                                    └─→ 0027 (ai_assets)    │   0030
                                          └─→ 0028 (ai_images) ─┴─
```

Orden de aplicación: estrictamente 0019 → 0030. Las ramas `0022–0023` y
`0025–0030` son independientes entre sí, pero se aplican en orden numérico por
la regla del proyecto (una migración a la vez, verificada).

---

## 4. Objetos creados — recuento

**9 tablas**

| # | Tabla | Migración |
|---|---|---|
| 1 | `platform.owners` | 0020 |
| 2 | `platform.privileged_operation_log` | 0024 |
| 3 | `platform.ai_projects` | 0025 |
| 4 | `platform.ai_classes` | 0026 |
| 5 | `platform.ai_assets` | 0027 |
| 6 | `platform.ai_images` | 0028 |
| 7 | `platform.ai_dataset_versions` | 0029 |
| 8 | `platform.ai_dataset_items` | 0029 |
| 9 | `platform.ai_annotations` | 0030 *(opcional)* |

**5 funciones:** `core.is_platform_owner()`,
`platform.prevent_last_owner_revocation()`,
`core.reject_platform_permission_on_role()`,
`platform.prevent_class_index_change()`,
`platform.reject_frozen_dataset_change()`.

**Tablas existentes alteradas:** `core.permissions` (columna `scope`),
`core.role_permissions` (trigger).

**Datos insertados:** 1 owner + 23 permisos.

---

## 5. Backend del Bloque 0

Mínimo indispensable para poder **demostrar** que un no-owner recibe acceso
denegado por la ruta real y no solo en SQL:

| Pieza | Archivo |
|---|---|
| `NotPlatformOwnerError` → 403 `NOT_PLATFORM_OWNER` | `core/errors.py` |
| `is_platform_owner()`, `require_platform_owner()` | `security/authorization.py` |
| Dependencia `require_platform_owner` | `api/deps.py` |
| `is_platform_owner` + permisos de plataforma en la respuesta | `api/v1/auth.py` (`/auth/me`) |
| `GET /v1/platform/owners` — un solo endpoint, para tener qué probar | `api/v1/platform.py` |

Código de error propio y distinto de `FORBIDDEN`: la interfaz debe poder decir
«esta zona es de administración de plataforma» en lugar de «te falta un permiso»,
que mandaría al usuario a pedir algo que **ningún administrador de tenant puede
conceder**.

**Ningún CRUD de proyectos, clases, assets ni datasets.** Solo tablas, RLS y la
puerta. El CRUD es el Bloque 1.

**Consecuencia en el contrato TypeScript:** `MeOut` gana un campo, así que
`frontend/src/auth/sessionStore.ts` (tipo `MeProfile`) y
`frontend/src/auth/mockProfile.ts` necesitan `is_platform_owner`. Son dos líneas
y no es trabajo de interfaz, pero si no se hacen `tsc` falla — el mock replica
`MeOut` campo por campo a propósito.

---

## 6. Pruebas del Bloque 0

**Aislamiento (SQL, como `olo_app`)**

1. Sin identidad en el contexto → 0 filas en las 9 tablas.
2. Con identidad de `mgr@olo-dev.test` (no owner) → 0 filas en las 9 tablas.
3. Con identidad de `arojas@ologistics.com` → lectura y escritura correctas.
4. `core.is_platform_owner()` → `false` sin identidad, `false` para el manager,
   `true` para el owner.

**Guardas del motor**

5. Revocar al último owner activo → **error**, no éxito silencioso.
6. Asignar un permiso `scope='platform'` a un rol de tenant → **error**.
7. `UPDATE` de `class_index` → **error**.
8. `UPDATE` o `DELETE` sobre un dataset congelado → **error** (no 0 filas).
9. FK compuesta: imagen del proyecto A con asset del proyecto B → **error**.
10. FK compuesta: anotación con una clase de otro proyecto → **error**.
11. Anotación con `cx + w/2 > 1` → **error**.
12. Dos assets con el mismo `sha256` en el mismo proyecto → **error**.

**API (HTTP)**

13. `GET /v1/platform/owners` con token del manager → **403 `NOT_PLATFORM_OWNER`**.
14. `GET /v1/platform/owners` con token de Andrey → **200**, con su fila.
15. `GET /v1/auth/me` de Andrey → `is_platform_owner: true` y los 23 permisos.
16. `GET /v1/auth/me` del manager → `is_platform_owner: false` y sin permisos `ai_*`.

**Revocación inmediata (decisión 2)**

17. Con Andrey autenticado y su token **vigente**, revocar su condición de owner
    en la base y repetir la petición: debe responder **403 sin refrescar el
    token**. Es la prueba de que el privilegio no viaja en el JWT.

La 17 es la que realmente demuestra la decisión 2, y no se puede escribir si el
privilegio está en el token.

---

## 7. Lo que este bloque deja fuera, a propósito

| Fuera | Cuándo |
|---|---|
| CRUD de proyectos, clases, assets, datasets | Bloque 1 |
| `platform.ai_training_*`, `ai_model_versions`, `ai_evaluations` | Bloque 4-5 |
| `audit.events` | Bloque 4 |
| `core.files` | con las importaciones; el módulo usa `ai_assets` |
| `ai_projects.current_model_version_id` | `ALTER` en el bloque de modelos |
| Buckets de Storage, URLs firmadas | Bloque 2 |
| Worker, entrenamiento, frames, anotador, inferencia, importador, frontend | según lo indicado |

Las políticas de retención que fijaste no crean tablas todavía: son trabajo de
limpieza que necesita `ai_training_runs` y `ai_model_versions`. Quedan anotadas
en la arquitectura y se implementan en el Bloque 5. La única que toca a este
bloque —«no eliminar datasets usados por modelos publicados»— queda garantizada
por las FK cuando esas tablas existan; hoy no hay nada que pueda borrarlos.

---

## 8. Lo que necesito que confirmes antes de ejecutar

| | Punto | Mi recomendación |
|---|---|---|
| **A** | ¿Entra `0030_ai_annotations`? | **Sí.** Es tabla, no anotador. Sin ella `annotated` y la congelación quedan sin referente |
| **B** | ¿Entra `0022_permission_scope_guard`, que ALTERa `core.permissions`? | **Sí.** Cierra una escalada real: rol de tenant → permiso de plataforma |
| **C** | ¿Entra `0024_privileged_operation_log`? | **Sí.** Las concesiones de owner ocurren en este bloque; el registro debe existir antes |
| **D** | ¿Se añade `GET /v1/platform/owners` y el campo en `/auth/me`? | **Sí.** Sin al menos un endpoint no hay forma de probar la denegación por HTTP ni la revocación inmediata |

Si las cuatro son «sí», ejecuto 0019 → 0030 con el ciclo habitual: una migración
a la vez, con su rollback, verificada contra la base real antes de pasar a la
siguiente.
