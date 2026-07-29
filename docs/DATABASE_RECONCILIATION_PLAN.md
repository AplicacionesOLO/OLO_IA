# OLO_IA — PLAN DE RECONCILIACIÓN DE BASE DE DATOS

> **Autor:** Claude Code. **Fecha:** 2026-07-28
> **Base:** `DATABASE_DESIGN.md` v1.0 + `RLS_STRATEGY.md` v2.0 + decisiones aprobadas 4.1–4.12 + `DECISION_REGISTER.md`.
> **Naturaleza:** documento de diseño. **El DDL que aparece aquí es ilustrativo, no ejecutable como migración.** Está sin verificar contra una base real. No se ha creado ningún archivo de migración.
> **Versión 2.0** — actualizada tras la resolución de las 13 decisiones y la verificación empírica de `TECHNICAL_ASSUMPTION_VERIFICATION.md`.

---

## 0. ESTADO DE DECISIONES Y VERIFICACIÓN

### 0.1 Decisiones que este plan ya incorpora

| Decisión | Efecto en este plan |
|---|---|
| **DEC-01** Supabase CLI, fuente única | El DDL de aquí se materializará en `supabase/migrations/*.sql`. Sin Alembic |
| **DEC-02** Dos canales de contexto | GUCs canónicos: `app.auth_user_id`, `app.tenant_id`, `app.request_id`, `app.correlation_id` |
| **DEC-04** Membresías N:N | **Cambio de modelo.** `core.users` pasa a global; nueva `core.tenant_memberships`. Ver §12 |
| **DEC-05** FK compuestas | Aprobado §7 tal cual. **Verificado empíricamente** (V5) |
| **DEC-06** Auditoría sin particionar | §8.1 con `event_id UUID PRIMARY KEY` simple. **Verificado** (V1) |
| **DEC-07** Ledger inmutable + proyección con optimistic locking | §6.5 y §9.3. `stock_records` queda descrita explícitamente como proyección de balances |
| **DEC-10** `request_id` y `correlation_id` distintos | Ambas columnas en `audit.events` y ambos GUCs |
| **DEC-11** Escala: catálogo tenant-scoped vs stock warehouse-scoped | §11 recalculado |
| **DEC-12** CHECK para invariantes estructurales, catálogo para estados evolutivos | §0.3. **Invierte** lo que proponía la v1.0 |
| **CONF-06** No meter `core.users.id` en el JWT | `current_user_id()` resuelve vía `auth_id`. Ver §12.3 |
| **Soft delete** | Sin trigger. Eliminación explícita o RPC autorizada y auditada. **Verificado** (V2) |

### 0.2 Elementos verificados contra PostgreSQL 15.8

Ya no son propuestas razonadas: son comportamiento medido. Detalle en `TECHNICAL_ASSUMPTION_VERIFICATION.md`.

| Elemento de este plan | Prueba | Resultado |
|---|---|---|
| §8.1 Auditoría sin particionar con PK simple | V1 | La forma particionada **no se crea**; esta sí |
| §7.3 Cadena de FK compuestas | V5 | Rechaza los 3 invariantes de la decisión 4.1 |
| §9.2 Clave lógica de stock con `COALESCE` | V6-6D | Sin `COALESCE` entran duplicados y la cantidad se parte |
| `prevent_tenant_change` con `IS DISTINCT FROM` | V6-6A/6B | Con `!=`, poner `tenant_id` a NULL **atraviesa el trigger** |
| §6.6 `chk_files_path_tenant` | V6-6F | Bloquea ruta de otro tenant **y** escape de directorio |
| §7.6 `prevent_role_cycle` | V6-6G | Detecta ciclo indirecto y auto-referencia |
| §6.3 CHECK de serial | V6-6E | Funciona en ambas direcciones |
| Compatibilidad con pooler en modo transaction | V4-4E | **Sin fuga** de contexto entre transacciones |

### 0.3 Convención de CHECK frente a catálogo (DEC-12)

DEC-12 fija el criterio y **corrige lo que proponía la v1.0 de este plan**, que reservaba CHECK para los `status`. El criterio aprobado es el inverso: los estados evolucionan, así que van a catálogo.

| Mecanismo | Para qué | Ejemplos |
|---|---|---|
| **CHECK** | Invariantes estructurales estables — reglas que no cambian con el negocio | `quantity >= 0`, `reserved_quantity <= quantity`, `serial_number IS NULL OR quantity = 1`, `storage_path LIKE 'tenants/'‖tenant_id‖'/%'`, coherencia de `scope_type`, coherencia temporal |
| **Tabla catálogo** | Estados y valores que evolucionan con el producto | `status` de todas las entidades, `engine_type`, `connector_type`, `adjustment_reason`, `incident_type`, `device_type`, `movement_type`, `area_type`, `location_type` |

Consecuencia: ~20 columnas que hoy son `CHECK (x IN (...))` en `DATABASE_DESIGN.md` pasan a FK contra catálogo. Coste: 9 tablas de catálogo más y un JOIN en las lecturas que muestren el estado. Beneficio: añadir un motor de IA o un estado de conteo deja de ser una migración.

### 0.4 Condiciones abiertas

| # | Condición | Bloquea |
|---|---|---|
| **CP-1** | Docker Desktop no instalado (DEC-03 lo exige) | Toda migración |
| **CP-2** | Modelo de membresías por validar | Migraciones de identidad |
| **CP-3** | **DEC-14, nueva:** cómo se determina el tenant activo en el JWT | Custom Access Token Hook y canal A |
| **CP-4** | Escenarios de escala por aprobar | Dimensionado de Fase 1 |

---

## 1. MODELO OBJETIVO

### 1.1 Principios

1. **El aislamiento es responsabilidad del motor.** `tenant_id` en toda tabla de negocio, RLS con `tenant_isolation` RESTRICTIVE + `FORCE ROW LEVEL SECURITY`. La aplicación es la segunda línea, nunca la primera.
2. **La jerarquía desnormalizada se garantiza con FK compuestas, no con confianza.** La desnormalización de `tenant_id`/`warehouse_id` está aprobada por rendimiento y simplicidad de RLS; su coherencia se impone con claves foráneas compuestas (§7).
3. **El estado del inventario se deriva de un ledger inmutable.** `stock_records` es la proyección; `stock_movements` es la verdad. Sujeto a DEC-07.
4. **Nada relevante para consultar vive en JSONB.** JSONB para configuración y payloads opacos; columnas y tablas para lo que se filtra, ordena, agrupa o referencia.
5. **Los catálogos extensibles son tablas, no CHECK constraints.** Añadir un motor de IA o un tipo de conector no debe requerir migración.
6. **Soft delete es negocio, no seguridad.** Fuera de RLS (DR-016), con índices únicos parciales (decisión 4.4).
7. **Particionamiento diferido con criterio objetivo.** No en Fase 0 (decisión 4.3); umbrales medibles en §10.

### 1.2 Cambio de modelo más importante

```
ANTES (DATABASE_DESIGN.md v1.0)          DESPUÉS (objetivo)
─────────────────────────────────        ──────────────────────────────────────
stock_records.quantity                   stock_movements (ledger, append-only)
  ↑ sobrescrito por ajustes                ↓ delta aplicado atómicamente
  = carrera irresoluble (CRIT-08)        stock_records.quantity (proyección)
                                           = conmutativo, sin pérdida
```

Es el único cambio de este plan que altera el modelo conceptual y no solo el esquema. Todo lo demás son columnas, constraints, índices y tablas nuevas.

---

## 2. SCHEMAS

| Schema | Contenido | Fase de creación | Expuesto a PostgREST |
|---|---|---|---|
| `public` | Catálogos globales ISO, configuración de plataforma | **0** | Sí (solo lectura) |
| `core` | Tenancy, jerarquía organizacional, identidad, autorización | **0** | Sí |
| `audit` | Eventos de auditoría append-only | **0** | Sí (solo SELECT) |
| `platform` | Operaciones cross-tenant, log de privilegios, métricas | **0** | **No** |
| `internal` | Vistas materializadas y artefactos no expuestos | **0** | **No** |
| `inventory` | Productos, stock, ledger, conteos, ajustes, incidencias | 1 | Sí |
| `integrations` | Conectores, sync jobs, mapeos | 1 | Sí |
| `ai` | Modelos, datasets, anotaciones, inferencias, detecciones | 2 | Sí |
| `devices` | Dispositivos, misiones, telemetría, capturas | 3 | Sí |
| `spatial` | Planos, mapeo de ubicaciones, digital twin | 3 | Sí |

**Cambio respecto a `DATABASE_DESIGN.md` §2:** se añade `internal` (requerido por `RLS_STRATEGY.md` §6.1, hoy ausente) y **los schemas se crean con su primera tabla, no todos en Fase 0** (OVER-01). Fase 0 crea cinco: `public`, `core`, `audit`, `platform`, `internal`.

---

## 3. CLASIFICACIÓN DE TABLAS

Clasificación pedida en la instrucción §7. `N` = tabla nueva propuesta.

### 3.1 Plataforma global / catálogo

| Tabla | Clase | Estado | Nota |
|---|---|---|---|
| `public.countries` | catálogo global | **N** | Catálogo ISO 3166. ~250 filas. Sin `tenant_id`. RLS solo lectura. |
| `public.currencies` | catálogo global | **N** | ISO 4217. Referenciado por `MULTITENANT.md:326`, hoy ausente. |
| `public.system_config` | plataforma global | **N** | Configuración de plataforma. Sin política de lectura para `authenticated`. |
| `public.announcements` | plataforma global | **N** | `MULTITENANT.md:606`. Fase 4. |
| `platform.privileged_operation_log` | auditoría de plataforma | **N** | **Requerido por decisión 4.9 + DR-002 §C.** Cada invocación de `service_role`. |
| `platform.tenant_metrics_snapshots` | plataforma global | **N** | Métricas agregadas cross-tenant. Alternativa: matview en `internal`. |

> Zonas horarias: **no hace falta tabla.** `pg_timezone_names` es una vista del catálogo de PostgreSQL y se mantiene con el motor. `MULTITENANT.md:328` propone `public.timezones`; es duplicación innecesaria que además envejece.

### 3.2 Tenant

| Tabla | Clase | Estado |
|---|---|---|
| `core.tenants` | tenant | existe |
| `core.tenant_countries` | país operativo | **N** — decisión 4.7 |
| `core.tenant_usage_counters` | tenant / técnica | **N** — ESC-07, `RF-TENANT-012` |
| `core.idempotency_keys` | técnica | **N** — CRIT-12 |

### 3.3 Jerarquía organizacional

| Tabla | Clase | Estado |
|---|---|---|
| `core.companies` | compañía | existe — cambia FK a `tenant_countries` |
| `core.warehouses` | almacén | existe — añadir UNIQUE compuesto |
| `core.areas` | almacén | existe — añadir FK compuesta |
| `core.locations` | almacén | existe — añadir FK compuesta |
| ~~`core.countries`~~ | — | **SE DIVIDE** → `public.countries` + `core.tenant_countries` |

### 3.4 Identidad y autorización — **reescrita por DEC-04**

| Tabla | Clase | Estado |
|---|---|---|
| `core.users` | **plataforma global** | existe — **pierde `tenant_id`**. Ver §12 |
| `core.tenant_memberships` | autorización | **N** — DEC-04. Eslabón N:N entre identidad y tenant |
| `core.roles` | autorización | existe — añadir `deleted_at`, prevención de ciclos |
| `core.permissions` | catálogo | **N** — OVER-02: hoy `roles.permissions` es JSONB sin catálogo |
| `core.user_role_assignments` | autorización | existe — FK compuesta a membresía + CHECK de coherencia de scope |
| `core.user_warehouse_access` | autorización (read model) | existe — faltan 4 columnas + FK compuesta a membresía |
| `core.invitations` | autorización | **N** — ALTO-18 |
| `core.sessions` | autorización | **N** — ALTO-18, `RF-AUTH-014`. Clasificar según DEC-09 |

Nótese el cambio de clase de `core.users`: deja de ser tenant-scoped y pasa a plataforma global. Es la consecuencia más profunda de DEC-04 y afecta a su política RLS, no solo a sus columnas.

### 3.5 Transaccional (inventario)

| Tabla | Clase | Estado |
|---|---|---|
| `inventory.products` | transaccional (scope tenant, DR-010) | existe — extraer umbrales |
| `inventory.product_warehouse_settings` | transaccional | **N** — ALTO-15 |
| `inventory.stock_records` | transaccional (scope almacén) | existe — clave lógica + `version` |
| `inventory.stock_movements` | transaccional (ledger) | **N** — **CRIT-08**, sujeto a DEC-07 |
| `inventory.counts` | transaccional | existe — `version` |
| `inventory.count_items` | transaccional | existe — único + `version` |
| `inventory.count_observations` | transaccional | **N** — decisión 4.10 |
| `inventory.count_assignees` | transaccional | **N** — INT-11, hoy JSONB |
| `inventory.adjustments` | transaccional | existe — `version` |
| `inventory.adjustment_items` | transaccional | existe — pasa a deltas |
| `inventory.incidents` | transaccional | existe |
| `inventory.adjustment_reasons` | catálogo | **N** — OVER-02, hoy `reason_code VARCHAR` libre |

### 3.6 Auditoría

| Tabla | Clase | Estado |
|---|---|---|
| `audit.events` | auditoría | existe — **DDL no ejecuta (CRIT-01)**, modelo desalineado con 4.9 (ALTO-03) |

### 3.7 Integración

| Tabla | Clase | Estado |
|---|---|---|
| `integrations.connectors` | integración | existe |
| `integrations.sync_jobs` | integración | existe |
| `integrations.connector_types` | catálogo | **N** — OVER-02 |
| `integrations.sync_job_logs` | integración / técnica | **N** — `RF-INT-006` «logs detallados de cada operación»; hoy `errors JSONB` |

### 3.8 IA

| Tabla | Clase | Estado |
|---|---|---|
| `ai.models` | IA | existe — único parcial de deploy |
| `ai.engines` | catálogo | **N** — OVER-02 |
| `ai.datasets` | IA | existe |
| `ai.dataset_images` | IA | **N** — `DOMAIN_MODEL.md:753` |
| `ai.annotations` | IA | **N** — `RF-IA-007` |
| `ai.inference_jobs` | IA | existe |
| `ai.detections` | IA | **N** — ESC-06, `RF-IA-013` |
| `ai.training_jobs` | IA | existe |

### 3.9 Dispositivos y espacial

| Tabla | Clase | Estado |
|---|---|---|
| `devices.devices` | almacén / técnica | existe |
| `devices.drone_missions` | transaccional | existe — extraer telemetría |
| `devices.telemetry_points` | técnica (serie temporal) | **N** — decisión 4.5 |
| `devices.mission_captures` | técnica | **N** — `DOMAIN_MODEL.md:953` |
| `spatial.floor_plans` | almacén | existe |
| `spatial.plan_location_mappings` | almacén | **N** — INT-12 |

### 3.10 Transversal

| Tabla | Clase | Estado |
|---|---|---|
| `core.files` | técnica | **N** — ALTO-09. Registro de todo archivo en Storage. |
| `core.notifications` | técnica | **N** — `RF-NOTIF-005` |

**Total: 27 tablas existentes, 20 nuevas propuestas, 1 que se divide en 2.**

---

## 4. TABLAS QUE DEBEN DIVIDIRSE

### 4.1 `core.countries` → `public.countries` + `core.tenant_countries`

Motivo: CRIT-07 / decisión 4.7. Un código ISO es un hecho del mundo; la presencia operativa en un país es un dato del tenant.

```sql
-- Catálogo global. Sin tenant_id. Administrado por la plataforma.
CREATE TABLE public.countries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iso_code      CHAR(2)  NOT NULL UNIQUE,      -- ISO 3166-1 alpha-2
    iso_code_3    CHAR(3)  NOT NULL UNIQUE,
    numeric_code  CHAR(3)  NOT NULL,
    name_en       VARCHAR(100) NOT NULL,
    name_es       VARCHAR(100) NOT NULL,
    phone_code    VARCHAR(10),
    default_currency_code CHAR(3) NOT NULL REFERENCES public.currencies(code),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Presencia operativa del tenant en un país, con su configuración regional.
CREATE TABLE core.tenant_countries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES core.tenants(id),
    country_id    UUID NOT NULL REFERENCES public.countries(id),
    status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive')),
    default_currency_code CHAR(3) NOT NULL REFERENCES public.currencies(code),
    default_locale        VARCHAR(10) NOT NULL DEFAULT 'es',
    default_timezone      VARCHAR(50) NOT NULL,
    fiscal_config         JSONB NOT NULL DEFAULT '{}',
    number_format         VARCHAR(20) NOT NULL DEFAULT 'es-CR',
    date_format           VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY',
    version       INT NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,

    CONSTRAINT uq_tenant_countries UNIQUE (tenant_id, id)   -- destino de FK compuesta
);

CREATE UNIQUE INDEX uq_tenant_country_active
    ON core.tenant_countries (tenant_id, country_id) WHERE deleted_at IS NULL;
```

`core.companies.country_id` pasa a `tenant_country_id UUID NOT NULL`, con FK compuesta `(tenant_id, tenant_country_id) → core.tenant_countries (tenant_id, id)`. Así una company nunca puede colgar del país de otro tenant.

### 4.2 `devices.drone_missions.telemetry` → `devices.telemetry_points`

Motivo: ALTO-06 / decisión 4.5. Ver §6.4.

### 4.3 `inventory.count_items.counted_quantity` → `inventory.count_observations`

Motivo: ALTO-05 / decisión 4.10. Ver §6.3.

### 4.4 `inventory.products` umbrales → `inventory.product_warehouse_settings`

Motivo: ALTO-15. `min_stock`, `max_stock`, `reorder_point` salen de `products` (donde son globales al tenant e `INT`) y pasan a una tabla por almacén con tipo `DECIMAL(15,4)` coherente con `quantity`.

### 4.5 `ai.inference_jobs.results` → `ai.detections`

Motivo: ESC-06. Fase 2, pero conviene reservar la decisión ahora porque condiciona `RF-IA-013`.

---

## 5. CORRECCIONES SOBRE TABLAS EXISTENTES

### 5.1 Críticas

| Tabla | Corrección | Origen |
|---|---|---|
| `audit.events` | **Quitar `PARTITION BY RANGE (created_at)`** en Fase 0. Mantener `id UUID PRIMARY KEY` simple. Alinear columnas con decisión 4.9 (§8). | CRIT-01, ALTO-03, DEC-06 |
| `core.countries` | Eliminar. Se divide (§4.1). | CRIT-07 |
| `core.locations`, `core.areas` | Añadir FK compuestas (§7). | CRIT-10 |
| `core.user_warehouse_access` | Añadir `revoked_at`, `source_role_assignment_id`, `created_at`, `updated_at`. Índice único pasa a parcial `WHERE revoked_at IS NULL`. | ALTO-04, decisión 4.2 |
| `inventory.stock_records` | Añadir clave lógica única (§9.2) y `CHECK (serial_number IS NULL OR quantity = 1)`. | CRIT-09, ALTO-07 |
| Funciones comunes | `prevent_tenant_change`: `IS DISTINCT FROM`. Las tres: `SET search_path = ''`. **Eliminar `core.soft_delete()`.** | CRIT-06, ALTO-23 |

### 5.2 Altas

| Tabla | Corrección | Origen |
|---|---|---|
| `core.roles` | Añadir `deleted_at`. Prevención de ciclos en `parent_role_id`. | ALTO-13, ALTO-14 |
| `core.user_role_assignments` | `CHECK` de coherencia entre `scope_type` y los `scope_*_id`. FK compuestas al scope. | INT-09 |
| `inventory.count_items` | Único `(tenant_id, count_id, location_id, product_id)`. | ALTO-22 |
| `ai.models` | Único parcial `(tenant_id, engine_type) WHERE status='deployed'`. FK de `training_job_id`. | ALTO-08, INT-07 |
| `integrations.sync_jobs` | Único parcial `(tenant_id, connector_id) WHERE status IN ('queued','running')`. | ALTO-08 |
| `ai.training_jobs` | Único parcial `(tenant_id) WHERE status IN ('queued','training')`. | ALTO-08 |
| `inventory.counts` | `assigned_users JSONB` → tabla `count_assignees`. | INT-11 |
| `core.areas`, `core.countries`, `spatial.floor_plans` | Añadir `CHECK` a `status`. | INT-06 |
| `inventory.products` | Índice GIN de búsqueda: quitar `'spanish'` fijo o duplicar por idioma. | ESC-04 |
| Todas | `CHECK` de coherencia temporal donde aplique. | INT-08 |

---

## 6. TABLAS NUEVAS — DEFINICIÓN

Solo las de Fase 0 y las estructuralmente relevantes. El resto queda enumerado en §3.

### 6.1 `platform.privileged_operation_log` — Fase 0, requerida por decisión 4.9

```sql
CREATE TABLE platform.privileged_operation_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation      VARCHAR(100) NOT NULL,   -- provision_tenant, suspend_tenant, impersonate, ...
    actor_id       UUID NOT NULL,           -- platform admin que la ejecuta
    actor_email    VARCHAR(320) NOT NULL,   -- copia inmutable: el usuario puede desaparecer
    target_tenant_id UUID,                  -- tenant afectado, si aplica
    justification  TEXT NOT NULL,           -- obligatoria: sin motivo no se registra la operación
    parameters     JSONB NOT NULL DEFAULT '{}',
    result         VARCHAR(20) NOT NULL CHECK (result IN ('success','failure')),
    error_message  TEXT,
    request_id     UUID NOT NULL,
    ip_address     INET,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_priv_log_occurred   ON platform.privileged_operation_log (occurred_at DESC);
CREATE INDEX idx_priv_log_actor      ON platform.privileged_operation_log (actor_id, occurred_at DESC);
CREATE INDEX idx_priv_log_target     ON platform.privileged_operation_log (target_tenant_id, occurred_at DESC)
    WHERE target_tenant_id IS NOT NULL;
```

Sin RLS: el schema `platform` no se expone a PostgREST y solo lo alcanza `service_role`. `justification NOT NULL` es deliberado — obliga a que toda operación privilegiada tenga un motivo escrito.

### 6.2 `core.idempotency_keys` — Fase 0, requerida por CRIT-12

```sql
CREATE TABLE core.idempotency_keys (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES core.tenants(id),
    idempotency_key VARCHAR(255) NOT NULL,
    endpoint      VARCHAR(200) NOT NULL,
    request_hash  CHAR(64) NOT NULL,        -- SHA-256 del cuerpo canonicalizado
    status        VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','completed','failed')),
    response_status_code INT,
    response_body JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

CREATE UNIQUE INDEX uq_idem_tenant_key ON core.idempotency_keys (tenant_id, idempotency_key);
CREATE INDEX idx_idem_expires ON core.idempotency_keys (expires_at);
```

El `request_hash` detecta el caso peligroso: misma clave de idempotencia con cuerpo distinto, que debe responder `409` y no el resultado cacheado.

### 6.3 `inventory.count_observations` — decisión 4.10

```sql
CREATE TABLE inventory.count_observations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id    UUID NOT NULL,                 -- desnormalizado para RLS Plantilla B
    count_item_id   UUID NOT NULL REFERENCES inventory.count_items(id),
    sequence_number INT  NOT NULL CHECK (sequence_number > 0),
    quantity        DECIMAL(15,4) NOT NULL CHECK (quantity >= 0),
    counted_by      UUID REFERENCES core.users(id),
    counted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id       UUID REFERENCES devices.devices(id),
    method          VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK (method IN ('manual','scanner','drone','camera','ai')),
    evidence_file_id UUID REFERENCES core.files(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_observation_seq UNIQUE (tenant_id, count_item_id, sequence_number)
);

CREATE INDEX idx_obs_count_item ON inventory.count_observations (tenant_id, count_item_id, sequence_number);
```

`count_items` deja de tener `counted_quantity` como dato de entrada. Pasa a tener:

- `accepted_observation_id UUID` — qué observación se toma como válida.
- `counted_quantity DECIMAL(15,4)` — **desnormalizada desde la observación aceptada**, mantenida por el servicio de conteo, no `GENERATED`.
- `discrepancy` deja de ser `GENERATED ALWAYS ... STORED` (ya no depende de una sola columna) y pasa a columna normal mantenida junto a `counted_quantity`, o a vista calculada.

El doble conteo de `MODULES.md:189` es entonces simplemente `sequence_number = 2`, y la regla «recontar si discrepancia > umbral» es lógica de aplicación sobre datos que existen.

### 6.4 `devices.telemetry_points` — decisión 4.5

```sql
CREATE TABLE devices.telemetry_points (
    id              BIGSERIAL,               -- BIGSERIAL, no UUID: serie temporal de alto volumen
    tenant_id       UUID NOT NULL,
    warehouse_id    UUID NOT NULL,
    mission_id      UUID NOT NULL,
    device_id       UUID NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    altitude_m      DOUBLE PRECISION,
    battery_percent SMALLINT CHECK (battery_percent BETWEEN 0 AND 100),
    speed_ms        DOUBLE PRECISION,
    heading_degrees DOUBLE PRECISION,
    extra           JSONB NOT NULL DEFAULT '{}',

    PRIMARY KEY (id, recorded_at)             -- preparada para particionar por recorded_at
);

CREATE INDEX idx_telemetry_mission ON devices.telemetry_points (tenant_id, mission_id, recorded_at);
CREATE INDEX idx_telemetry_brin    ON devices.telemetry_points USING BRIN (recorded_at);
```

`BIGSERIAL` en lugar de UUID: 8 bytes contra 16, e inserción secuencial en el índice en vez de aleatoria. En una serie temporal de ingesta continua la diferencia es material. La PK compuesta desde el inicio evita el problema de CRIT-01 cuando llegue el particionamiento (Fase 3).

Ingesta **por lotes**, no punto a punto: `POST /v1/missions/{id}/telemetry` con array, insertado con `COPY` o `INSERT ... SELECT unnest(...)`.

### 6.5 `inventory.stock_movements` — ledger, sujeto a DEC-07

```sql
CREATE TABLE inventory.stock_movements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id   UUID NOT NULL,
    location_id    UUID NOT NULL,
    product_id     UUID NOT NULL,
    stock_record_id UUID,                    -- proyección afectada
    lot_number     VARCHAR(50),
    serial_number  VARCHAR(100),

    movement_type  VARCHAR(30) NOT NULL
                   CHECK (movement_type IN ('receipt','issue','transfer_in','transfer_out',
                                            'adjustment','count_correction','reservation',
                                            'release','damage','quarantine','expiry')),
    quantity_delta DECIMAL(15,4) NOT NULL CHECK (quantity_delta <> 0),   -- firmado
    quantity_after DECIMAL(15,4) NOT NULL,   -- saldo resultante, para auditoría y reconstrucción

    source_type    VARCHAR(30) NOT NULL
                   CHECK (source_type IN ('manual','count','adjustment','integration','ai','drone','api')),
    source_id      UUID,                     -- count_id, adjustment_id, sync_job_id...
    reason_code    VARCHAR(50),
    performed_by   UUID REFERENCES core.users(id),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    -- Sin updated_at ni deleted_at: append-only. Un error se corrige con un movimiento inverso.
);

CREATE INDEX idx_mov_stock_record ON inventory.stock_movements (tenant_id, stock_record_id, occurred_at DESC);
CREATE INDEX idx_mov_product      ON inventory.stock_movements (tenant_id, warehouse_id, product_id, occurred_at DESC);
CREATE INDEX idx_mov_location     ON inventory.stock_movements (tenant_id, location_id, occurred_at DESC);
CREATE INDEX idx_mov_source       ON inventory.stock_movements (tenant_id, source_type, source_id);
CREATE INDEX idx_mov_brin         ON inventory.stock_movements USING BRIN (occurred_at);
```

**Cómo resuelve la carrera de CRIT-08.** El ajuste deja de escribir un valor absoluto y escribe un delta:

```sql
-- Todo dentro de una transacción
UPDATE inventory.stock_records
   SET quantity = quantity + :delta,          -- ← relativo, no absoluto
       last_movement_at = now(),
       version = version + 1
 WHERE id = :stock_record_id
   AND quantity + :delta >= 0                 -- el CHECK como guarda explícita
RETURNING quantity INTO v_quantity_after;

INSERT INTO inventory.stock_movements (..., quantity_delta, quantity_after, ...)
VALUES (..., :delta, v_quantity_after, ...);
```

Con esto la recepción de t1 y el ajuste de t3 son conmutativos y el saldo final es correcto sin que ninguna operación falle. `RF-INV-007` pasa a ser una consulta directa, y la valorización de `RF-INV-015` (FIFO/LIFO/promedio) se vuelve calculable, que hoy no lo es.

### 6.6 `core.files` — ALTO-09

```sql
CREATE TABLE core.files (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES core.tenants(id),
    bucket         VARCHAR(63)  NOT NULL,
    storage_path   TEXT NOT NULL,             -- debe empezar por tenants/{tenant_id}/
    original_name  VARCHAR(500) NOT NULL,
    content_type   VARCHAR(100) NOT NULL,
    size_bytes     BIGINT NOT NULL CHECK (size_bytes > 0),
    checksum_sha256 CHAR(64),
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','quarantined','deleted')),
    resource_type  VARCHAR(50),               -- product_image, count_evidence, model_weights...
    resource_id    UUID,
    uploaded_by    UUID REFERENCES core.users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at   TIMESTAMPTZ,
    deleted_at     TIMESTAMPTZ,

    CONSTRAINT chk_files_path_tenant
        CHECK (storage_path LIKE 'tenants/' || tenant_id::text || '/%')
);

CREATE UNIQUE INDEX uq_files_path ON core.files (bucket, storage_path) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_resource   ON core.files (tenant_id, resource_type, resource_id);
CREATE INDEX idx_files_pending    ON core.files (created_at) WHERE status = 'pending';
```

`chk_files_path_tenant` es la pieza clave: hace **imposible a nivel de motor** registrar un archivo cuya ruta de Storage no sea del propio tenant. El índice parcial sobre `status='pending'` sirve al job de limpieza de uploads nunca confirmados.

Todas las columnas `*_url TEXT` y `evidence_urls JSONB` de las tablas existentes pasan a `*_file_id UUID REFERENCES core.files(id)`.

### 6.7 Resto de tablas nuevas

`public.currencies`, `public.system_config`, `core.tenant_usage_counters`, `core.permissions`, `core.invitations`, `core.sessions`, `core.notifications`, `inventory.product_warehouse_settings`, `inventory.count_assignees`, `inventory.adjustment_reasons`, `integrations.connector_types`, `integrations.sync_job_logs`, `ai.engines`, `ai.dataset_images`, `ai.annotations`, `ai.detections`, `devices.mission_captures`, `spatial.plan_location_mappings`, `platform.tenant_metrics_snapshots`.

Se especifican en el sprint que las necesita. Fase 0 requiere solo: `public.countries`, `public.currencies`, `core.tenant_countries`, `core.permissions`, `core.invitations`, `platform.privileged_operation_log`, `core.idempotency_keys`. **Siete.**

---

## 7. INTEGRIDAD DE LA JERARQUÍA DESNORMALIZADA

Respuesta al encargo explícito de la decisión 4.1. Mecanismo primario: **claves foráneas compuestas**. Mecanismo secundario: triggers. Nada depende del frontend.

### 7.1 Los tres invariantes a garantizar

| Invariante exigido | Mecanismo |
|---|---|
| `area_id` no puede pertenecer a otro warehouse | FK compuesta `(tenant_id, warehouse_id, area_id)` |
| `warehouse_id` no puede pertenecer a otro tenant | FK compuesta `(tenant_id, warehouse_id)` |
| `tenant_id` debe corresponder a la jerarquía real | Encadenamiento de las anteriores + `prevent_tenant_change` |

### 7.2 Índices únicos redundantes como destino de FK

PostgreSQL exige que el destino de una FK sea un índice único. Añadir `UNIQUE (tenant_id, id)` sobre una tabla cuyo `id` ya es PK es redundante en términos de unicidad, pero es lo que habilita la FK compuesta. Coste: un índice por tabla padre.

```sql
ALTER TABLE core.tenant_countries ADD CONSTRAINT uq_tc_tenant_id     UNIQUE (tenant_id, id);
ALTER TABLE core.companies        ADD CONSTRAINT uq_comp_tenant_id   UNIQUE (tenant_id, id);
ALTER TABLE core.warehouses       ADD CONSTRAINT uq_wh_tenant_id     UNIQUE (tenant_id, id);
ALTER TABLE core.areas            ADD CONSTRAINT uq_area_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id);
ALTER TABLE core.locations        ADD CONSTRAINT uq_loc_tenant_wh_id  UNIQUE (tenant_id, warehouse_id, id);
```

### 7.3 Cadena de FK compuestas

```sql
-- companies → tenant_countries (mismo tenant)
ALTER TABLE core.companies ADD CONSTRAINT fk_comp_tenant_country
    FOREIGN KEY (tenant_id, tenant_country_id)
    REFERENCES core.tenant_countries (tenant_id, id);

-- warehouses → companies (mismo tenant)
ALTER TABLE core.warehouses ADD CONSTRAINT fk_wh_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES core.companies (tenant_id, id);

-- areas → warehouses (mismo tenant)
ALTER TABLE core.areas ADD CONSTRAINT fk_area_warehouse
    FOREIGN KEY (tenant_id, warehouse_id)
    REFERENCES core.warehouses (tenant_id, id);

-- locations → areas (mismo tenant Y mismo warehouse) ← el invariante clave
ALTER TABLE core.locations ADD CONSTRAINT fk_loc_area
    FOREIGN KEY (tenant_id, warehouse_id, area_id)
    REFERENCES core.areas (tenant_id, warehouse_id, id);
```

La última es la que resuelve CRIT-10: una location **no puede** apuntar a un área de otro almacén, porque la tripleta no existiría en `core.areas`.

### 7.4 Tablas warehouse-scoped

Todas las tablas con `warehouse_id` reciben `FOREIGN KEY (tenant_id, warehouse_id) REFERENCES core.warehouses (tenant_id, id)`; las que además tengan `location_id`, la tripleta contra `core.locations`:

| Tabla | FK compuesta |
|---|---|
| `inventory.stock_records` | `(tenant_id, warehouse_id, location_id)` → `core.locations` |
| `inventory.stock_movements` | `(tenant_id, warehouse_id, location_id)` → `core.locations` |
| `inventory.counts` | `(tenant_id, warehouse_id)` → `core.warehouses` |
| `inventory.count_items` | `(tenant_id, warehouse_id, location_id)` → `core.locations` |
| `inventory.adjustments` | `(tenant_id, warehouse_id)` → `core.warehouses` |
| `inventory.incidents` | `(tenant_id, warehouse_id)` → `core.warehouses` |
| `devices.devices` | `(tenant_id, warehouse_id)` → `core.warehouses` |
| `devices.drone_missions` | `(tenant_id, warehouse_id)` → `core.warehouses` |
| `integrations.connectors` | `(tenant_id, warehouse_id)` → `core.warehouses` |
| `spatial.floor_plans` | `(tenant_id, warehouse_id)` → `core.warehouses` |

> **Nota:** `inventory.count_items` y `stock_records` no tienen hoy `warehouse_id` y `warehouse_id` respectivamente — `count_items` no lo tiene en absoluto. Debe añadirse: es requisito de la Plantilla B de RLS v2.0 y de esta FK.

### 7.5 Trigger secundario

Según la instrucción («los triggers pueden utilizarse como protección secundaria»), y porque las FK compuestas no cubren un caso: la **coherencia de `scope_*_id` con `scope_type`** en `user_role_assignments`.

```sql
ALTER TABLE core.user_role_assignments ADD CONSTRAINT chk_ura_scope_coherent CHECK (
    (scope_type = 'global'    AND scope_company_id IS NULL     AND scope_warehouse_id IS NULL)
 OR (scope_type = 'company'   AND scope_company_id IS NOT NULL AND scope_warehouse_id IS NULL)
 OR (scope_type = 'warehouse' AND scope_warehouse_id IS NOT NULL)
);
```

Un `CHECK`, no un trigger: más barato y más claro.

### 7.6 Prevención de ciclos en herencia de roles (ALTO-13)

Un `CHECK` no puede recorrer un grafo. Aquí sí hace falta trigger:

```sql
CREATE OR REPLACE FUNCTION core.prevent_role_cycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_cursor uuid := NEW.parent_role_id; v_depth int := 0;
BEGIN
    WHILE v_cursor IS NOT NULL LOOP
        IF v_cursor = NEW.id THEN
            RAISE EXCEPTION 'circular role inheritance detected on role %', NEW.id
                USING ERRCODE = '23514';
        END IF;
        v_depth := v_depth + 1;
        IF v_depth > 16 THEN
            RAISE EXCEPTION 'role inheritance chain exceeds maximum depth of 16'
                USING ERRCODE = '23514';
        END IF;
        SELECT parent_role_id INTO v_cursor FROM core.roles WHERE id = v_cursor;
    END LOOP;
    RETURN NEW;
END; $$;
```

El límite de profundidad es una segunda red: corta también las cadenas patológicas sin ciclo.

---

## 8. ESTRATEGIA DE AUDITORÍA

### 8.1 Modelo alineado con la decisión 4.9

```sql
CREATE TABLE audit.events (
    event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- era `id`
    tenant_id     UUID NOT NULL,          -- sin FK, deliberado: no bloquear inserción de auditoría
    actor_id      UUID,                   -- NULL para eventos de sistema
    actor_type    VARCHAR(20) NOT NULL DEFAULT 'user'
                  CHECK (actor_type IN ('user','system','integration','platform_admin')),
    actor_email   VARCHAR(320),           -- copia inmutable
    action        VARCHAR(100) NOT NULL,  -- era action_category + action_type
    entity_type   VARCHAR(50)  NOT NULL,  -- era resource_type
    entity_id     UUID,                   -- era resource_id
    old_values    JSONB,                  -- era `changes.before`
    new_values    JSONB,                  -- era `changes.after`
    request_id    UUID,                   -- FALTABA
    correlation_id UUID,
    ip_address    INET,
    user_agent    TEXT,
    source        VARCHAR(30) NOT NULL DEFAULT 'api'            -- FALTABA
                  CHECK (source IN ('api','worker','integration','migration','platform')),
    is_impersonated BOOLEAN NOT NULL DEFAULT FALSE,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),           -- era created_at

    -- Preparado para la cadena criptográfica, pospuesta a hardening (decisión 4.9)
    previous_hash CHAR(64),
    event_hash    CHAR(64)
);

CREATE INDEX idx_audit_tenant_time  ON audit.events (tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_actor        ON audit.events (tenant_id, actor_id, occurred_at DESC);
CREATE INDEX idx_audit_entity       ON audit.events (tenant_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_request      ON audit.events (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_audit_brin         ON audit.events USING BRIN (occurred_at);
```

**Sin `PARTITION BY` en Fase 0** (decisión 4.3, DEC-06). Esto resuelve CRIT-01: con la tabla sin particionar, `event_id UUID PRIMARY KEY` es válido.

Las columnas `previous_hash` y `event_hash` se **crean nulas desde el inicio** aunque la cadena se pospone. Añadir columnas a una tabla de auditoría de 40M filas más adelante es una migración cara; crearlas vacías cuesta cero.

### 8.2 Inmutabilidad

Según `RLS_STRATEGY.md` §5.4: RLS con `tenant_isolation` RESTRICTIVE, política de SELECT para lectura, política de INSERT solo para el rol de aplicación, **ninguna política de UPDATE ni DELETE**, más `REVOKE UPDATE, DELETE`. Con el límite ya documentado: protege de `authenticated` y `olo_app`, no de `BYPASSRLS`. De ahí que ALTO-02 (`platform.privileged_operation_log`) sea parte de la estrategia de auditoría y no un extra.

### 8.3 Qué genera eventos

La instrucción no lo pide, pero es la decisión que hace o rompe la auditoría: **los eventos los emite la capa de aplicación, no triggers de base de datos.** Un trigger no conoce el `request_id`, ni el `user_agent`, ni la intención de negocio (distinguir «ajuste por conteo» de «corrección manual»). Triggers de auditoría genéricos producen un log técnicamente completo y funcionalmente inútil.

---

## 9. SOFT DELETE, OPTIMISTIC LOCKING, CLAVES

### 9.1 Soft delete (decisión 4.4, DR-016)

| Regla | Implementación |
|---|---|
| Marca | `deleted_at TIMESTAMPTZ NULL` |
| Fuera de RLS | Sin política; se filtra en consulta o vista `_active` con `security_invoker = true` |
| Unicidad reutilizable | **Índice único parcial** `WHERE deleted_at IS NULL` |
| Nunca | `CONSTRAINT UNIQUE` convencional sobre claves comerciales |
| Aplicación | `UPDATE ... SET deleted_at = now()` en el repositorio. **No triggers** (CRIT-06) |

`DATABASE_DESIGN.md` ya lo hace bien en 6 de 7 casos. Faltan: `core.roles` (no tiene `deleted_at`), `core.user_warehouse_access` (usa `revoked_at`, semántica distinta y correcta), y las tablas append-only (`audit.events`, `stock_movements`, `telemetry_points`, `count_observations`) que **no deben tener `deleted_at`** por diseño.

### 9.2 Claves lógicas frente a claves técnicas

`id UUID` es la clave técnica. Toda tabla de negocio necesita además su **clave lógica** como índice único parcial. La que falta y más importa:

```sql
CREATE UNIQUE INDEX uq_stock_logical ON inventory.stock_records (
    tenant_id, warehouse_id, location_id, product_id,
    COALESCE(lot_number, ''), COALESCE(serial_number, ''), status
) WHERE deleted_at IS NULL;
```

`COALESCE` es obligatorio: en un índice único, `NULL` no colisiona con `NULL`, así que sin él dos filas con `lot_number IS NULL` se consideran distintas y el índice no protege nada — que es precisamente el agujero de CRIT-09.

Con este índice, el alta de stock pasa a ser `INSERT ... ON CONFLICT (...) DO UPDATE SET quantity = stock_records.quantity + EXCLUDED.quantity`, que además resuelve la carrera de inserción concurrente sin bloqueo explícito.

### 9.3 Optimistic locking (DR-014)

```sql
version INT NOT NULL DEFAULT 1
```

**Tablas que la llevan:** `stock_records`, `counts`, `count_items`, `adjustments`, `incidents`, `products`, `warehouses`, `areas`, `locations`, `tenant_countries`, `companies`, `roles`, `connectors`.

**Tablas que NO la llevan:** append-only (`audit.events`, `stock_movements`, `telemetry_points`, `count_observations`, `privileged_operation_log`) y read models (`user_warehouse_access`).

Patrón de actualización:

```sql
UPDATE inventory.stock_records
   SET quantity = :q, version = version + 1, updated_at = now()
 WHERE id = :id AND version = :expected_version;
-- rowcount = 0 ⇒ conflicto ⇒ HTTP 409
```

**El trigger `set_updated_at` no debe incrementar `version`.** Si lo hiciera, cualquier escritura de sistema invalidaría la versión que el cliente tiene en mano y produciría 409 espurios. La versión la incrementa la sentencia de la aplicación, explícitamente.

**Transporte en API** (hoy ausente, ALTO-01): `ETag` en la respuesta del GET, `If-Match` obligatorio en PATCH/PUT de recursos versionados, `412 Precondition Failed` si no coincide, `428 Precondition Required` si falta. Es preferible a poner `version` en el cuerpo porque es HTTP estándar y cacheable.

---

## 10. PARTICIONAMIENTO FUTURO

Nada particionado en Fase 0 (decisión 4.3). La instrucción pide **condiciones objetivas de activación**.

### 10.1 Criterios de activación

Se activa cuando se cumple **cualquiera** de estos, verificado con datos de producción:

| # | Criterio | Umbral | Cómo se mide |
|---|---|---|---|
| C1 | Filas en la tabla | > 50.000.000 | `pg_class.reltuples` |
| C2 | Tamaño de la tabla + índices | > 50 GB | `pg_total_relation_size()` |
| C3 | p95 de la consulta más frecuente sobre la tabla, **con el índice correcto ya aplicado** | > 200 ms | `pg_stat_statements` |
| C4 | Tuplas muertas sostenidas, autovacuum sin alcanzar | > 20% durante 7 días | `pg_stat_user_tables` |
| C5 | **Existe política de retención con borrado masivo periódico** | cualquiera | Requisito funcional |

**C5 es el criterio determinante, y suele llegar antes que los demás.** `audit.events` con retención de 2 años (`SECURITY.md` §6.1) implica borrar decenas de millones de filas cada mes. `DELETE` de 40M filas genera bloat, consume WAL y bloquea autovacuum durante horas. `DROP TABLE audit.events_2024_07` es instantáneo y no genera bloat. Cuando hay retención por fecha, particionar no es optimización: es la única forma sostenible de implementarla.

### 10.2 Tablas candidatas, en orden probable de activación

| Orden | Tabla | Clave de partición | Granularidad | Disparador esperado | Fase |
|---|---|---|---|---|---|
| 1 | `audit.events` | `RANGE (occurred_at)` | Mensual | **C5** (retención 2 años) | 1 |
| 2 | `inventory.stock_movements` | `RANGE (occurred_at)` | Mensual | C1 (~50M en escenario crecimiento) | 1-2 |
| 3 | `devices.telemetry_points` | `RANGE (recorded_at)` | Semanal | C1 + C5 | 3 |
| 4 | `ai.detections` | `RANGE (created_at)` | Mensual | C1 | 2-3 |
| 5 | `integrations.sync_job_logs` | `RANGE (created_at)` | Mensual | C5 (retención 1 año) | 2 |
| — | `inventory.stock_records` | — | — | **No es candidata**: es proyección de estado, crece con el número de ubicaciones, no con el tiempo. Se acota con archivado, no con particiones. | — |

### 10.3 Preparación desde ahora, sin coste

Las tres decisiones que evitan una migración dolorosa después:

1. **PK compuesta desde el inicio en las tablas que se sabe que se particionarán por tiempo.** `telemetry_points` ya lleva `PRIMARY KEY (id, recorded_at)` (§6.4). `stock_movements` debería llevar `PRIMARY KEY (id, occurred_at)` si DEC-07 se aprueba. Esto **es** el aprendizaje de CRIT-01: la PK compuesta cuesta nada ahora y es una recreación de tabla después.
2. **Nunca FK entrante hacia una tabla que se va a particionar.** PostgreSQL soporta FK hacia tablas particionadas desde PG 12, pero limita las operaciones de attach/detach. Por eso `audit.events.tenant_id` sin FK es correcto y `stock_movements` no debe ser destino de FK.
3. **Índice BRIN sobre la columna temporal desde el primer día.** Barato en espacio, muy eficaz en consultas por rango, y hace que la tabla sin particionar aguante mucho más antes de cumplir C3.

`audit.events` es el caso interesante: su PK **no** necesita ser compuesta hoy porque no se particiona en Fase 0, pero sí la necesitará. Recomiendo `PRIMARY KEY (event_id, occurred_at)` desde el inicio: rompe la convención de `id UUID PRIMARY KEY` simple, pero la decisión 4.3 dice «no cambiar preventivamente **todas** las claves», no «ninguna». Auditoría es la excepción justificada porque su particionamiento está garantizado por C5. **Esto forma parte de DEC-06.**

---

## 11. ESCENARIOS DE ESCALA

Encargo de la decisión 4.12. Los targets actuales de `RNF-SCAL` no se derivan unos de otros (ESC-01). Estos tres sí: cada uno multiplica el anterior por factores explícitos.

### 11.1 Factores de derivación

| Dimensión | Inicial → Crecimiento | Crecimiento → Máximo |
|---|---|---|
| Tenants | ×10 | ×10 |
| Almacenes por tenant | ×2 | ×1,7 |
| Ubicaciones por almacén | ×1,5 | ×1,6 |
| Productos por tenant | ×2,5 | ×2 |
| Movimientos por almacén y mes | ×1 | ×1,2 |

### 11.2 Los tres escenarios

| Magnitud | **Inicial** (Fase 0-1, año 1) | **Crecimiento** (años 2-3) | **Máximo futuro** (año 5) |
|---|---|---|---|
| Tenants activos | 5 | 50 | 500 |
| Países operativos por tenant | 1 | 2 | 4 |
| Compañías por tenant | 2 | 4 | 8 |
| Almacenes por tenant | 3 | 6 | 10 |
| **Almacenes totales** | **15** | **300** | **5.000** |
| Áreas por almacén | 8 | 8 | 10 |
| Ubicaciones por área | 250 | 375 | 600 |
| **Ubicaciones totales** | **30.000** | **900.000** | **30.000.000** |
| Productos por tenant | 20.000 | 50.000 | 100.000 |
| **Productos totales** | **100.000** | **2.500.000** | **50.000.000** |
| **`stock_records`** | **90.000** | **2.700.000** | **90.000.000** |
| Usuarios por tenant | 20 | 40 | 60 |
| **Usuarios totales** | **100** | **2.000** | **30.000** |
| Movimientos / almacén / mes | 50.000 | 50.000 | 60.000 |
| **`stock_movements` / mes** | **750.000** | **15.000.000** | **300.000.000** |
| **`stock_movements` / año** | **9M** | **180M** | **3.600M** |
| **`audit.events` / mes** | **2M** | **40M** | **800M** |
| Conteos / almacén / mes | 4 | 4 | 6 |
| `count_items` / mes | 120.000 | 3.600.000 | 120.000.000 |
| Inferencias / mes | — | 500.000 | 10.000.000 |
| Storage total | 50 GB | 5 TB | 100 TB |
| Usuarios concurrentes pico | 20 | 400 | 6.000 |

### 11.3 Reconciliación con `RNF-SCAL`

| Requisito | Valor actual | Escenario al que corresponde | Corrección propuesta |
|---|---|---|---|
| `RNF-SCAL-001` >1.000 tenants | 1.000 | Ninguno (2× el máximo) | Reducir a **500**, o mover el máximo al año 7 |
| `RNF-SCAL-003` >100 almacenes/tenant | 100 | Ninguno (10× el máximo) | Reducir a **10** por tenant; 100 es plausible solo para un tenant enterprise atípico, que debe tratarse como excepción dimensionada aparte |
| `RNF-SCAL-004` >1M productos **por almacén** | 1M | Ninguno | **Error de unidad.** Debe ser «por tenant». Productos tienen scope tenant (DR-010), no almacén |
| `RNF-SCAL-005` >100M registros de inventario | 100M | **Máximo** ✓ | Correcto. Coincide con `stock_records` = 90M |
| `RNF-SCAL-002` >50.000 usuarios | 50.000 | Ninguno (1,7× el máximo) | Reducir a **30.000** |
| `RNF-SCAL-007` >100.000 inferencias/día | 100k/día = 3M/mes | Entre crecimiento y máximo ✓ | Correcto |
| `RNF-SCAL-006` >10 TB storage | 10 TB | Entre crecimiento y máximo ✓ | Correcto |

Tres de los siete targets son inalcanzables por combinación y uno tiene un error de unidad. Los otros tres son coherentes con el escenario máximo.

### 11.3-bis Separación catálogo / stock (DEC-11)

DEC-11 pide distinguir explícitamente el catálogo tenant-scoped del stock warehouse-scoped. Es la corrección de fondo de `RNF-SCAL-004`: **son dos magnitudes con dueños distintos y factores de crecimiento distintos**, y confundirlas es lo que producía el 10¹¹.

| | **Catálogo** (`inventory.products`) | **Stock** (`inventory.stock_records`) |
|---|---|---|
| Scope | **Tenant** (DR-010) | **Almacén** |
| Se replica por almacén | **No.** Un SKU existe una vez por tenant | **Sí.** Una fila por (almacén, ubicación, producto, lote) |
| Crece con | Amplitud del surtido del tenant | Ubicaciones × densidad de ocupación |
| Fórmula | `tenants × productos_por_tenant` | `ubicaciones × productos_distintos_por_ubicación` |
| Inicial | 5 × 20.000 = **100.000** | 30.000 × 3 = **90.000** |
| Crecimiento | 50 × 50.000 = **2.500.000** | 900.000 × 3 = **2.700.000** |
| Máximo | 500 × 100.000 = **50.000.000** | 30.000.000 × 3 = **90.000.000** |
| Patrón de acceso | Lectura intensiva, escritura rara. Búsqueda full-text | Escritura intensiva vía ledger, lectura por ubicación y por producto |
| Índice determinante | `(tenant_id, sku)` y GIN de búsqueda | `(tenant_id, warehouse_id, location_id, product_id, ...)` |
| Estrategia a escala | Cursor en listados; GIN por idioma | Clave lógica única; ledger particionado; archivado |

La consecuencia práctica: `RNF-SCAL-004` debe leerse **«>1M productos por tenant»**, no por almacén. Y el número que gobierna el dimensionado de escritura no es el catálogo sino `stock_movements`, que en el escenario máximo son 300M al mes — tres órdenes de magnitud por encima del catálogo completo.

### 11.4 Para qué sirven estos escenarios

| Decisión | Se justifica con |
|---|---|
| Índices compuestos con `tenant_id` primero | Todos los escenarios: `tenant_id` es el filtro de mayor selectividad desde el inicio |
| Paginación por cursor en `products`, `stock_records`, `audit.events` | Crecimiento: 2,5M productos hacen inviable el offset (ALTO-11) |
| Particionar `audit.events` | Crecimiento: 40M/mes con retención de 2 años ⇒ criterio C5 |
| Particionar `stock_movements` | Crecimiento: 180M/año cruza C1 en el segundo año |
| BRIN en columnas temporales | Inicial: cuesta nada y retrasa C3 |
| `BIGSERIAL` en `telemetry_points` | Máximo: la diferencia UUID/BIGSERIAL sobre 10⁹ filas es de decenas de GB solo en índices |
| Contadores de uso materializados | Crecimiento: contar inferencias del mes sobre 3M filas ya no es un `COUNT(*)` aceptable en un dashboard |
| Vistas materializadas de dashboard | Crecimiento: agregaciones sobre 2,7M `stock_records` superan el p95 de 200ms |
| Cuándo evaluar sharding | Solo pasado el máximo. Con 90M `stock_records` un PostgreSQL bien indexado no necesita sharding |
| Cuándo evaluar Kubernetes | 6.000 concurrentes del escenario máximo. En inicial y crecimiento, PaaS sobra (DR-008) |

---

## 12. MODELO DE IDENTIDAD Y MEMBRESÍAS (DEC-04)

Es el cambio de modelo más profundo de esta revisión y toca la cadena de autorización completa.

### 12.1 Cadena aprobada

```
auth.users              (Supabase Auth — identidad externa, el claim `sub`)
      │ 1:1 vía core.users.auth_id
      ▼
core.users              (identidad GLOBAL de plataforma — SIN tenant_id)
      │ 1:N
      ▼
core.tenant_memberships (N:N entre identidad y tenant — aquí vive tenant_id)
      │ 1:N
      ├──► core.user_role_assignments
      └──► core.user_warehouse_access
```

### 12.2 `core.users` pierde `tenant_id`

Tres consecuencias que no son evidentes:

1. **La unicidad de email se traslada.** Era `UNIQUE (tenant_id, email) WHERE deleted_at IS NULL`. Pasa a `UNIQUE (email) WHERE deleted_at IS NULL`, global. Es más restrictivo: dos tenants ya no pueden tener sendos usuarios con el mismo email, porque ahora serían **la misma persona con dos membresías**. Eso es precisamente lo que DEC-04 busca.
2. **Su política RLS cambia de naturaleza.** Sin `tenant_id` no hay Plantilla A posible. La regla pasa a ser: veo mi propia fila, y veo las filas de quienes comparten membresía activa conmigo en el tenant actual. Requiere un `EXISTS` sobre `tenant_memberships`, con el cuidado de que la política de esa tabla no llame de vuelta (mismo riesgo de recursión que ya documentamos para `user_warehouse_access`).
3. **`auth_id UNIQUE` global pasa a ser coherente.** En el modelo anterior era una limitación silenciosa que forzaba una cuenta por tenant; ahora es exactamente la semántica correcta.

```sql
CREATE TABLE core.users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id     UUID NOT NULL UNIQUE,          -- = auth.users.id, el claim `sub`
    email       VARCHAR(320) NOT NULL,
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    avatar_url  TEXT,
    locale      VARCHAR(10) NOT NULL DEFAULT 'es',
    timezone    VARCHAR(50) NOT NULL DEFAULT 'UTC',
    status_code VARCHAR(20) NOT NULL REFERENCES core.user_statuses(code),  -- catálogo, DEC-12
    active_tenant_id UUID,                     -- ver §12.5 (DEC-14, pendiente)
    version     INT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_users_email ON core.users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_auth_id     ON core.users (auth_id);   -- crítico: lo usa el Hook y current_user_id()
```

### 12.3 `core.tenant_memberships`

```sql
CREATE TABLE core.tenant_memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES core.tenants(id),
    user_id     UUID NOT NULL REFERENCES core.users(id),
    status_code VARCHAR(20) NOT NULL REFERENCES core.membership_statuses(code),  -- invited/active/suspended
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    invited_by  UUID REFERENCES core.users(id),
    joined_at   TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    version     INT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- UNIQUE TOTAL, no parcial: es destino de FK compuesta y PostgreSQL
    -- no admite índices parciales como destino de clave foránea.
    CONSTRAINT uq_membership_tenant_user UNIQUE (tenant_id, user_id),
    CONSTRAINT uq_membership_tenant_id   UNIQUE (tenant_id, id),
    CONSTRAINT chk_membership_temporal   CHECK (revoked_at IS NULL OR joined_at IS NULL OR revoked_at >= joined_at)
);

CREATE INDEX idx_membership_user   ON core.tenant_memberships (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_membership_tenant ON core.tenant_memberships (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_membership_one_default
    ON core.tenant_memberships (user_id) WHERE is_default AND revoked_at IS NULL;
```

**Decisión de diseño deliberada:** `UNIQUE (tenant_id, user_id)` es **total**, no parcial. PostgreSQL no acepta índices parciales como destino de clave foránea, y necesito que lo sea (§12.4). La consecuencia es que hay **una sola fila de membresía por par (tenant, usuario)** y la revocación se expresa poniendo `revoked_at`; volver a incorporar a alguien lo pone a NULL en la misma fila. El historial de entradas y salidas vive en `audit.events`, que es su sitio.

Alternativa descartada: unicidad parcial `WHERE revoked_at IS NULL` para tener una fila por episodio de membresía. Es más expresiva pero impide la FK compuesta, y la garantía de integridad vale más que el historial en la tabla operativa.

### 12.4 La ganancia de integridad que aporta DEC-04

Con la membresía como destino de FK compuesta, la autorización queda anclada a la pertenencia **en el motor**:

```sql
ALTER TABLE core.user_role_assignments ADD CONSTRAINT fk_ura_membership
    FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships (tenant_id, user_id);

ALTER TABLE core.user_warehouse_access ADD CONSTRAINT fk_uwa_membership
    FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships (tenant_id, user_id);
```

**Es imposible asignar un rol o el acceso a un almacén a alguien que no es miembro de ese tenant.** El modelo anterior no ofrecía esa garantía: `user_role_assignments` referenciaba `users` y `roles` por separado, y nada impedía cruzarlos. Es la misma técnica que V5 verificó para la jerarquía de almacenes, aplicada a la de autorización.

Encadenado con §7.3, la cadena completa queda cerrada por claves foráneas: `tenant → membership → role assignment` y `tenant → warehouse → area → location`.

### 12.5 Funciones de contexto revisadas (DEC-02 + CONF-06)

CONF-06 fija que el JWT **no** lleva `core.users.id`: la identidad externa es `sub`/`auth.uid()` y `core.users.id` se resuelve por `auth_id`.

```sql
-- Identidad externa. Canal A: auth.uid(). Canal B: GUC app.auth_user_id.
CREATE OR REPLACE FUNCTION core.current_auth_id()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    auth.uid(),
    NULLIF(current_setting('app.auth_user_id', true), '')::uuid
  )
$$;

-- Identidad de negocio, resuelta por auth_id (CONF-06).
-- SECURITY DEFINER: debe leer core.users sin que la política de core.users
-- —que a su vez consulta membresías— entre en recursión.
-- STABLE: se evalúa una vez por statement, y el planner puede tratarla como
-- parámetro de InitPlan dentro de las políticas.
CREATE OR REPLACE FUNCTION core.current_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM core.users u
  WHERE u.auth_id = core.current_auth_id()
    AND u.deleted_at IS NULL
$$;

-- Tenant activo. Canal A: claim del JWT. Canal B: GUC app.tenant_id.
CREATE OR REPLACE FUNCTION core.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb
           -> 'app_metadata' ->> 'tenant_id', ''),
    NULLIF(current_setting('app.tenant_id', true), '')
  )::uuid
$$;

-- Membresía activa: sin ella no hay acceso a nada (fail-secure).
CREATE OR REPLACE FUNCTION core.has_active_membership()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.tenant_memberships m
    WHERE m.tenant_id = core.current_tenant_id()
      AND m.user_id   = core.current_user_id()
      AND m.revoked_at IS NULL
      AND m.status_code = 'active'
  )
$$;
```

Dos notas sobre `current_tenant_id()`, ambas respaldadas por la verificación empírica (pruebas 4F, 4G y 3H):

- Lee `request.jwt.claims` **directamente** en vez de a través de `auth.jwt()`. El comportamiento en Supabase es idéntico —`auth.jwt()` es esencialmente un envoltorio sobre ese mismo `current_setting`— y la función queda **portable a PostgreSQL sin el schema `auth`**, lo que desacopla la suite de aislamiento del stack completo.
- La precedencia verificada es **JWT sobre GUC**. Importa dejarlo escrito: si un worker del canal B corriera sobre una conexión que por cualquier motivo tuviera claims, el JWT ganaría.

### 12.6 DEC-14 — pendiente: ¿cuál es el tenant activo?

El JWT mínimo lleva **un** `tenant_id`. Con membresías múltiples, **el Hook tiene que elegir uno y no está definido con qué criterio.** El canal A solo dispone del JWT, así que sin tenant en el token PostgREST, Realtime y Storage se quedan sin contexto y RLS les deniega todo.

La columna `active_tenant_id` de §12.2 está puesta como propuesta (opción (a) de `IMPLEMENTATION_GATE.md` CP-3): el Hook la lee, y un endpoint de cambio de tenant la actualiza y fuerza refresh del token. Mantiene el JWT mínimo y el canal A operativo.

**No implementar `active_tenant_id` hasta que DEC-14 se decida.** Si se opta por otra vía, esa columna sobra.

---

## 13. RESUMEN DE CAMBIOS

| Categoría | v1.0 | **v2.0 (tras las 13 decisiones)** |
|---|---|---|
| Tablas existentes sin cambios | 8 | **6** |
| Tablas existentes con correcciones | 18 | **20** (+`users`, +`user_role_assignments`) |
| Tablas que se dividen | 1 (`core.countries`) | 1 |
| Tablas nuevas propuestas | 20 | **30** (+1 membresías, +9 catálogos por DEC-12) |
| Tablas nuevas requeridas en **Fase 0** | 7 | **11** (+`tenant_memberships`, +3 catálogos de estado) |
| Funciones a eliminar | 1 (`core.soft_delete`) | 1 |
| Funciones a corregir | 2 | **2** (`prevent_tenant_change`, `set_updated_at`) |
| Funciones nuevas | 1 | **6** (`prevent_role_cycle`, `current_auth_id`, `current_user_id`, `current_tenant_id`, `has_active_membership`, `can_access_warehouse`) |
| FK compuestas a añadir | 14 | **16** (+2 de membresía) |
| Índices únicos redundantes (destino de FK) | 5 | **6** |
| Índices únicos parciales nuevos | 9 | **11** |
| Columnas `version` a añadir | 13 | **15** |
| CHECK constraints nuevos | 12+ | **10+** (menos que en v1.0: DEC-12 mueve los `status` a catálogo) |

### 13.1 Verificado frente a propuesto

| Estado | Elementos |
|---|---|
| **Verificado empíricamente** | Auditoría sin particionar; FK compuestas de jerarquía; clave lógica con `COALESCE`; `IS DISTINCT FROM`; `chk_files_path_tenant`; `prevent_role_cycle`; CHECK de serial; seguridad del pooler; portabilidad de las funciones de contexto |
| **Propuesto, sin verificar** | Modelo de membresías (CP-2); ledger de movimientos; catálogos de DEC-12; contadores de uso; `core.files` completa |
| **Bloqueado por decisión** | `active_tenant_id` (DEC-14) |

---

*Plan de reconciliación. Ningún archivo de migración creado. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
