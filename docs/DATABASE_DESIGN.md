# OLO_IA - DISEÑO DE BASE DE DATOS

## 1. INTRODUCCIÓN

Este documento define el diseño completo de la base de datos PostgreSQL para OLO_IA, incluyendo schemas, tablas, relaciones, índices, constraints y convenciones.

### 1.1 Motor: PostgreSQL 15+ (Supabase)

### 1.2 Convenciones Generales

| Convención | Regla |
|-----------|-------|
| Nombres de tablas | snake_case, plural |
| Nombres de columnas | snake_case |
| Primary Keys | `id UUID DEFAULT gen_random_uuid()` |
| Foreign Keys | `{entity}_id UUID NOT NULL REFERENCES {schema}.{table}(id)` |
| Timestamps | `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ` |
| Soft Delete | `deleted_at TIMESTAMPTZ` (NULL = activo) |
| Enums | PostgreSQL ENUM types o lookup tables |
| Tenant isolation | `tenant_id UUID NOT NULL` en toda tabla de negocio |
| Naming FK | `fk_{table}_{referenced_table}` |
| Naming Index | `idx_{table}_{columns}` |
| Naming Constraint | `chk_{table}_{description}` |

### 1.3 Convenciones Adicionales (sincronizadas con DECISION_REGISTER v2.0)

| Convención | Regla | Decisión |
|-----------|-------|----------|
| Primary Keys | UUID simple. **No** claves compuestas en Fase 0. | DR-019 |
| Tenant denormalization | `tenant_id` presente en toda tabla de negocio, incluso cuando sea derivable por FK. Es requisito de RLS. | DR-001 |
| Warehouse denormalization | `warehouse_id` presente en `areas` y `locations`, aunque sea derivable. Evita JOINs en cada política RLS. | DR-020 |
| Soft delete | `deleted_at TIMESTAMPTZ`. Los índices únicos son **parciales** con `WHERE deleted_at IS NULL`. | DR-016, DR-021 |
| Optimistic locking | `version INT NOT NULL DEFAULT 1` en entidades transaccionales críticas. | DR-014 |
| Particionamiento | **Pospuesto**. No se particiona ninguna tabla en Fase 0. Se decide con métricas reales. | DR-022 |
| Índices únicos con soft delete | Siempre parciales, nunca totales. | DR-021 |

#### Por qué se desnormaliza `warehouse_id`

Las políticas RLS de plantilla B evalúan `core.can_access_warehouse(warehouse_id)`.
Si `areas` no tuviera `warehouse_id`, la política tendría que hacer un JOIN a
`core.warehouses` en cada fila evaluada. La desnormalización convierte esa evaluación
en una comparación directa. El coste es mantener consistencia, que se garantiza con
FK compuesta y trigger.

#### Por qué se pospone el particionamiento

Particionar exige elegir una clave (fecha, tenant) y esa elección es difícil de revertir.
Sin datos de producción no hay base para decidir. Las tablas candidatas (`audit.events`,
`ai.inference_jobs`) se crean sin particionar y se evalúan cuando existan métricas de
volumen real. El diseño no impide particionar después.

---

## 2. SCHEMAS

```sql
-- Schemas de la plataforma
CREATE SCHEMA IF NOT EXISTS core;        -- Tenant, org hierarchy, users
CREATE SCHEMA IF NOT EXISTS inventory;   -- Products, stock, counts
CREATE SCHEMA IF NOT EXISTS ai;          -- Models, datasets, inference
CREATE SCHEMA IF NOT EXISTS devices;     -- Drones, cameras, sensors, telemetry
CREATE SCHEMA IF NOT EXISTS integrations;-- Connectors, sync jobs
CREATE SCHEMA IF NOT EXISTS spatial;     -- Floor plans, maps
CREATE SCHEMA IF NOT EXISTS audit;       -- Audit events, changes
CREATE SCHEMA IF NOT EXISTS platform;    -- Platform-level (cross-tenant)
CREATE SCHEMA IF NOT EXISTS internal;    -- Materialized views, NO expuesto a PostgREST
```

### 2.1 Clasificación de tablas por scope

| Scope | Tablas | Tiene `tenant_id` | RLS |
|-------|--------|-------------------|-----|
| **Global de plataforma** | `public.countries`, `public.currencies`, `public.timezones`, `public.announcements` | No | Sí (read-only para authenticated) |
| **Plataforma privada** | `public.system_config`, `platform.*` | No | Sí (sin política de lectura para authenticated) |
| **Propias del tenant** | `core.tenants`, `core.tenant_countries`, `core.users`, `core.roles`, `inventory.products`, `ai.models`, `ai.datasets` | Sí | Plantilla A |
| **Propias de la company** | `core.companies` | Sí | Plantilla A |
| **Propias del warehouse** | `core.warehouses`, `core.areas`, `core.locations`, `devices.*`, `spatial.*` | Sí | Plantilla B |
| **Transaccionales** | `inventory.stock_records`, `inventory.counts`, `inventory.count_items`, `inventory.count_observations`, `inventory.adjustments`, `inventory.incidents` | Sí | Plantilla B |
| **De integración** | `integrations.connectors`, `integrations.sync_jobs`, `integrations.mappings` | Sí | Plantilla A |
| **De IA** | `ai.models`, `ai.datasets`, `ai.inference_jobs`, `ai.training_jobs` | Sí | Plantilla A |
| **De auditoría** | `audit.events` | Sí | Append-only (§5.4 de RLS_STRATEGY) |
| **Técnicas** | `internal.*` (matviews), `alembic_version` | Variable | Sin exposición a PostgREST |

Plantillas A y B definidas en `RLS_STRATEGY.md` v2.0 §4.2 y §4.3.

---

## 3. SCHEMA: CORE

### 3.1 core.tenants

```sql
CREATE TABLE core.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'trial'
        CHECK (status IN ('trial','active','suspended','cancelled','deleted')),
    plan VARCHAR(50) NOT NULL DEFAULT 'starter'
        CHECK (plan IN ('starter','professional','enterprise','custom')),
    settings JSONB NOT NULL DEFAULT '{}',
    limits JSONB NOT NULL DEFAULT '{}',
    trial_ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tenants_slug ON core.tenants(slug);
```

### 3.2 Países: catálogo global + presencia operativa

> **Corregido (DR-005).** La versión anterior definía `core.countries` con `tenant_id`,
> lo que duplicaba el catálogo ISO en cada tenant. El modelo aprobado separa dos
> conceptos distintos: **qué países existen** (dato universal) y **en qué países opera
> este tenant** (dato del tenant).

#### 3.2.1 public.countries — catálogo global

Dato universal e inmutable desde el punto de vista del tenant. Sin `tenant_id`.

```sql
CREATE TABLE public.countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iso_code CHAR(2) NOT NULL UNIQUE,        -- ISO 3166-1 alpha-2
    iso_code_3 CHAR(3) NOT NULL UNIQUE,      -- ISO 3166-1 alpha-3
    numeric_code CHAR(3),                     -- ISO 3166-1 numeric
    name VARCHAR(100) NOT NULL,
    official_name VARCHAR(200),
    phone_code VARCHAR(10),
    default_currency_code CHAR(3) NOT NULL,
    default_locale VARCHAR(10) NOT NULL,
    default_timezone VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,  -- para retirar países disueltos
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_countries_iso ON public.countries(iso_code);

-- RLS: lectura para todos, escritura para nadie salvo plataforma
-- (política completa en RLS_STRATEGY.md v2.0 §5.3)
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.countries FROM authenticated, anon, olo_app;
```

#### 3.2.2 core.tenant_countries — presencia operativa del tenant

Representa que un tenant **opera** en un país, con su configuración regional propia.
Es la entidad que participa en la jerarquía organizacional.

```sql
CREATE TABLE core.tenant_countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    country_id UUID NOT NULL REFERENCES public.countries(id),

    -- Overrides del catálogo global para este tenant
    currency_code CHAR(3),                    -- NULL = usar default del país
    locale VARCHAR(10),                       -- NULL = usar default del país
    timezone VARCHAR(50),                     -- NULL = usar default del país

    -- Configuración fiscal/regulatoria propia del tenant en este país
    fiscal_config JSONB NOT NULL DEFAULT '{}',
    settings JSONB NOT NULL DEFAULT '{}',

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_tenant_countries_tenant ON core.tenant_countries(tenant_id);
CREATE UNIQUE INDEX idx_tenant_countries_unique
    ON core.tenant_countries(tenant_id, country_id) WHERE deleted_at IS NULL;
```

#### 3.2.3 Resolución de configuración

```
¿Cuál es la moneda del tenant_country X?
  1. tenant_countries.currency_code IS NOT NULL → usar esa
  2. → public.countries.default_currency_code
```

Las `companies` referencian `core.tenant_countries`, no `public.countries`.
La jerarquía es: **tenant → tenant_country → company → warehouse → area → location**.

### 3.3 core.companies

```sql
CREATE TABLE core.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    tenant_country_id UUID NOT NULL REFERENCES core.tenant_countries(id),
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(300),
    tax_id VARCHAR(50),
    logo_url TEXT,
    address JSONB,
    settings JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_companies_tenant ON core.companies(tenant_id);
CREATE INDEX idx_companies_tenant_country ON core.companies(tenant_id, tenant_country_id);

-- Índice único PARCIAL: un tax_id borrado no bloquea reutilización (DR-021)
CREATE UNIQUE INDEX idx_companies_tenant_tax
    ON core.companies(tenant_id, tenant_country_id, tax_id)
    WHERE tax_id IS NOT NULL AND deleted_at IS NULL;
```

> **Cambio (DR-005):** `country_id → core.countries` se reemplaza por
> `tenant_country_id → core.tenant_countries`.

### 3.4 core.warehouses

```sql
CREATE TABLE core.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    company_id UUID NOT NULL REFERENCES core.companies(id),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(20) NOT NULL,
    address JSONB,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    locale VARCHAR(10) NOT NULL DEFAULT 'es',
    currency_code CHAR(3) NOT NULL DEFAULT 'USD',
    settings JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive','maintenance')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    -- Requerida por la FK compuesta de core.areas (ver §3.5)
    CONSTRAINT uq_warehouses_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_warehouses_tenant ON core.warehouses(tenant_id);
CREATE INDEX idx_warehouses_company ON core.warehouses(tenant_id, company_id);
CREATE UNIQUE INDEX idx_warehouses_company_code 
    ON core.warehouses(tenant_id, company_id, code) WHERE deleted_at IS NULL;
```

### 3.5 core.areas

```sql
```sql
CREATE TABLE core.areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Desnormalizados a propósito (DR-020): las políticas RLS de plantilla B
    -- evalúan can_access_warehouse(warehouse_id) sin necesidad de JOIN.
    tenant_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,

    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL,
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('receiving','storage','picking','shipping','staging','quarantine','returns')),
    max_locations INT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive')),
    metadata JSONB NOT NULL DEFAULT '{}',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    -- FK COMPUESTA: garantiza que warehouse_id y tenant_id son consistentes.
    -- Sin esto, la desnormalización permitiría un area con el tenant de A
    -- apuntando a un warehouse del tenant B.
    CONSTRAINT fk_areas_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),

    CONSTRAINT fk_areas_tenant
        FOREIGN KEY (tenant_id) REFERENCES core.tenants (id),

    -- Requerida por la FK compuesta de core.locations
    CONSTRAINT uq_areas_tenant_warehouse_id UNIQUE (tenant_id, warehouse_id, id)
);

CREATE INDEX idx_areas_tenant ON core.areas(tenant_id);
CREATE INDEX idx_areas_warehouse ON core.areas(tenant_id, warehouse_id);
CREATE UNIQUE INDEX idx_areas_warehouse_code 
    ON core.areas(tenant_id, warehouse_id, code) WHERE deleted_at IS NULL;
```

> **Nota sobre la FK compuesta.** La desnormalización de `warehouse_id` es un requisito
> de performance de RLS, pero introduce el riesgo de inconsistencia. La FK compuesta
> `(tenant_id, warehouse_id) → warehouses(tenant_id, id)` lo elimina a nivel de motor:
> es imposible insertar un `area` cuyo `tenant_id` no corresponda a su `warehouse_id`.

### 3.6 core.locations

```sql
CREATE TABLE core.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Desnormalizados a propósito (DR-020)
    tenant_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    area_id UUID NOT NULL,

    code VARCHAR(30) NOT NULL,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('rack','shelf','bin','floor','dock','pallet','bulk')),
    level INT,
    position_x DOUBLE PRECISION,
    position_y DOUBLE PRECISION,
    max_weight_kg DOUBLE PRECISION,
    max_volume_m3 DOUBLE PRECISION,
    max_units INT,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','occupied','blocked','reserved','maintenance')),
    plan_coordinates JSONB,
    metadata JSONB NOT NULL DEFAULT '{}',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    -- FK COMPUESTA hacia areas: propaga la consistencia tenant+warehouse
    CONSTRAINT fk_locations_area
        FOREIGN KEY (tenant_id, warehouse_id, area_id)
        REFERENCES core.areas (tenant_id, warehouse_id, id),

    CONSTRAINT fk_locations_tenant
        FOREIGN KEY (tenant_id) REFERENCES core.tenants (id),

    -- Requerida por FKs compuestas de inventory.stock_records
    CONSTRAINT uq_locations_tenant_warehouse_id UNIQUE (tenant_id, warehouse_id, id)
);

CREATE INDEX idx_locations_tenant ON core.locations(tenant_id);
CREATE INDEX idx_locations_warehouse ON core.locations(tenant_id, warehouse_id);
CREATE INDEX idx_locations_area ON core.locations(tenant_id, area_id);
CREATE UNIQUE INDEX idx_locations_area_code 
    ON core.locations(tenant_id, area_id, code) WHERE deleted_at IS NULL;
```

### 3.7 core.users

```sql
CREATE TABLE core.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    auth_id UUID NOT NULL UNIQUE,  -- Supabase Auth user ID
    email VARCHAR(320) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    locale VARCHAR(10) NOT NULL DEFAULT 'es',
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','active','inactive','suspended')),
    last_login_at TIMESTAMPTZ,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_tenant ON core.users(tenant_id);
CREATE UNIQUE INDEX idx_users_tenant_email 
    ON core.users(tenant_id, email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_auth_id ON core.users(auth_id);
```

### 3.8 core.roles

```sql
CREATE TABLE core.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES core.tenants(id),  -- NULL = system role
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    parent_role_id UUID REFERENCES core.roles(id),
    permissions JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_roles_tenant ON core.roles(tenant_id);
CREATE UNIQUE INDEX idx_roles_tenant_name 
    ON core.roles(tenant_id, name) WHERE tenant_id IS NOT NULL;
```

### 3.9 core.user_role_assignments

```sql
CREATE TABLE core.user_role_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    user_id UUID NOT NULL REFERENCES core.users(id),
    role_id UUID NOT NULL REFERENCES core.roles(id),
    scope_type VARCHAR(20) NOT NULL DEFAULT 'global'
        CHECK (scope_type IN ('global','company','warehouse')),
    scope_company_id UUID REFERENCES core.companies(id),
    scope_warehouse_id UUID REFERENCES core.warehouses(id),
    assigned_by UUID REFERENCES core.users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ura_tenant ON core.user_role_assignments(tenant_id);
CREATE INDEX idx_ura_user ON core.user_role_assignments(tenant_id, user_id);
CREATE UNIQUE INDEX idx_ura_unique 
    ON core.user_role_assignments(tenant_id, user_id, role_id, scope_type, 
       COALESCE(scope_company_id, '00000000-0000-0000-0000-000000000000'),
       COALESCE(scope_warehouse_id, '00000000-0000-0000-0000-000000000000'));
```

### 3.10 core.user_warehouse_access — proyección de autorización

> **Corregido (DR-011).** Se agrega `revoked_at`. Esta tabla es la **proyección de
> autorización contextual** que consulta `core.accessible_warehouse_ids()` en cada
> evaluación de política RLS de plantilla B. Es el mecanismo que hace posible la
> revocación inmediata descrita en `SECURITY.md` §2.3.3.

```sql
CREATE TABLE core.user_warehouse_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,

    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by UUID REFERENCES core.users(id),

    -- Revocación temporal con efecto inmediato vía RLS (DR-011, DR-013)
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES core.users(id),
    revoke_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_uwa_tenant FOREIGN KEY (tenant_id) REFERENCES core.tenants (id),
    CONSTRAINT fk_uwa_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),
    CONSTRAINT fk_uwa_user FOREIGN KEY (user_id) REFERENCES core.users (id),

    -- revoked_by y revoke_reason solo tienen sentido si hay revocación
    CONSTRAINT chk_uwa_revocation_coherent CHECK (
        (revoked_at IS NULL  AND revoked_by IS NULL) OR
        (revoked_at IS NOT NULL)
    )
);

CREATE INDEX idx_uwa_tenant ON core.user_warehouse_access(tenant_id);

-- Índice que sostiene core.accessible_warehouse_ids().
-- Parcial sobre revoked_at IS NULL: solo los accesos vigentes se recorren.
CREATE INDEX idx_uwa_tenant_user_active
    ON core.user_warehouse_access(tenant_id, user_id)
    WHERE revoked_at IS NULL;

-- Único PARCIAL: un acceso revocado no impide volver a conceder el mismo (DR-021)
CREATE UNIQUE INDEX idx_uwa_unique_active
    ON core.user_warehouse_access(tenant_id, user_id, warehouse_id)
    WHERE revoked_at IS NULL;
```

#### 3.10.1 Semántica de revocación

| Estado | `revoked_at` | Visible para `accessible_warehouse_ids()` |
|--------|-------------|------------------------------------------|
| Acceso vigente | `NULL` | Sí |
| Acceso revocado | timestamp | No |

Un `UPDATE ... SET revoked_at = now()` surte efecto en el **siguiente request** del
usuario, sin esperar refresh del token. Es lo que sustituye a `membership_version`
para Fase 0 (DR-013).

La fila revocada **se conserva** (no se borra) porque es evidencia de auditoría: quién
tuvo acceso a qué almacén y durante qué período.

---

## 4. SCHEMA: INVENTORY

### 4.1 inventory.products

```sql
CREATE TABLE inventory.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(300) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    subcategory VARCHAR(100),
    unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'unit',
    weight_kg DOUBLE PRECISION,
    volume_m3 DOUBLE PRECISION,
    barcode VARCHAR(100),
    barcode_type VARCHAR(20),
    image_urls JSONB NOT NULL DEFAULT '[]',
    attributes JSONB NOT NULL DEFAULT '{}',
    min_stock INT,
    max_stock INT,
    reorder_point INT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','discontinued','pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_products_tenant ON inventory.products(tenant_id);
CREATE UNIQUE INDEX idx_products_tenant_sku 
    ON inventory.products(tenant_id, sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_products_tenant_barcode 
    ON inventory.products(tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_products_tenant_category ON inventory.products(tenant_id, category);
CREATE INDEX idx_products_name_search ON inventory.products 
    USING GIN (to_tsvector('spanish', name || ' ' || COALESCE(description, '')));
```

### 4.2 inventory.stock_records

```sql
CREATE TABLE inventory.stock_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    location_id UUID NOT NULL REFERENCES core.locations(id),
    product_id UUID NOT NULL REFERENCES inventory.products(id),
    quantity DECIMAL(15,4) NOT NULL DEFAULT 0
        CHECK (quantity >= 0),
    reserved_quantity DECIMAL(15,4) NOT NULL DEFAULT 0
        CHECK (reserved_quantity >= 0),
    lot_number VARCHAR(50),
    serial_number VARCHAR(100),
    expiration_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','reserved','damaged','quarantine','expired')),
    unit_cost DECIMAL(15,4),
    last_counted_at TIMESTAMPTZ,
    last_movement_at TIMESTAMPTZ,

    -- Optimistic locking (DR-014): entidad transaccional crítica.
    -- Múltiples operadores pueden intentar ajustar el mismo stock simultáneamente.
    version INT NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_reserved_lte_quantity CHECK (reserved_quantity <= quantity),

    -- INVARIANTE (DR-023): un número de serie identifica una unidad física única.
    -- Si hay serial_number, la cantidad tiene que ser exactamente 1.
    CONSTRAINT chk_serial_implies_unit_quantity CHECK (
        serial_number IS NULL OR quantity = 1
    ),

    -- FKs compuestas: propagan consistencia tenant + warehouse + location
    CONSTRAINT fk_stock_location
        FOREIGN KEY (tenant_id, warehouse_id, location_id)
        REFERENCES core.locations (tenant_id, warehouse_id, id)
);

CREATE INDEX idx_stock_tenant ON inventory.stock_records(tenant_id);
CREATE INDEX idx_stock_warehouse ON inventory.stock_records(tenant_id, warehouse_id);
CREATE INDEX idx_stock_location ON inventory.stock_records(tenant_id, location_id);
CREATE INDEX idx_stock_product ON inventory.stock_records(tenant_id, warehouse_id, product_id);
CREATE INDEX idx_stock_expiration ON inventory.stock_records(tenant_id, expiration_date) 
    WHERE expiration_date IS NOT NULL;
CREATE UNIQUE INDEX idx_stock_serial 
    ON inventory.stock_records(tenant_id, serial_number) 
    WHERE serial_number IS NOT NULL AND deleted_at IS NULL;
```

### 4.3 inventory.counts

```sql
CREATE TABLE inventory.counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    name VARCHAR(200),
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('full','cyclic','zone','spot')),
    status VARCHAR(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','in_progress','completed','cancelled')),
    scope JSONB NOT NULL DEFAULT '{}',
    assigned_users JSONB NOT NULL DEFAULT '[]',
    notes TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES core.users(id),

    -- Optimistic locking (DR-014)
    version INT NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_counts_tenant ON inventory.counts(tenant_id);
CREATE INDEX idx_counts_warehouse ON inventory.counts(tenant_id, warehouse_id);
CREATE INDEX idx_counts_status ON inventory.counts(tenant_id, status);
```

### 4.4 inventory.count_items — línea de conteo

Representa **qué se debe contar**: la combinación location × product incluida en el
alcance del conteo, con la cantidad que el sistema cree tener.

```sql
CREATE TABLE inventory.count_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL,
    count_id UUID NOT NULL REFERENCES inventory.counts(id),
    location_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES inventory.products(id),

    -- Cantidad del sistema al momento de crear la línea (snapshot)
    system_quantity DECIMAL(15,4) NOT NULL,

    -- Resultado ACEPTADO tras evaluar las observaciones (ver §4.4.1).
    -- NULL mientras no se haya aceptado ninguna observación.
    accepted_quantity DECIMAL(15,4),
    accepted_observation_id UUID,

    discrepancy DECIMAL(15,4)
        GENERATED ALWAYS AS (accepted_quantity - system_quantity) STORED,

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','counted','recount_required','accepted','skipped')),

    observation_count INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_count_items_location
        FOREIGN KEY (tenant_id, warehouse_id, location_id)
        REFERENCES core.locations (tenant_id, warehouse_id, id),

    CONSTRAINT uq_count_items_scope UNIQUE (count_id, location_id, product_id)
);

CREATE INDEX idx_count_items_tenant ON inventory.count_items(tenant_id);
CREATE INDEX idx_count_items_count ON inventory.count_items(tenant_id, count_id);
CREATE INDEX idx_count_items_status ON inventory.count_items(tenant_id, count_id, status);
```

#### 4.4.1 inventory.count_observations — conteos y reconteos

> **Nuevo (DR-024).** La versión anterior guardaba `counted_quantity` directamente en
> `count_items`, lo que permitía **una sola** observación por línea. Eso hace imposible
> el doble conteo y el reconteo, que `MODULES.md` §6.3 declara como requisito
> ("Doble conteo: segundo conteo si discrepancia > umbral").

Cada intento de contar una línea es una observación independiente e inmutable.

```sql
CREATE TABLE inventory.count_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL,
    count_item_id UUID NOT NULL REFERENCES inventory.count_items(id),

    -- Secuencia de la observación para esta línea: 1 = primer conteo,
    -- 2 = segundo conteo (verificación), 3+ = reconteos posteriores
    sequence INT NOT NULL CHECK (sequence >= 1),

    observed_quantity DECIMAL(15,4) NOT NULL CHECK (observed_quantity >= 0),

    -- Origen de la observación
    source VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual','drone','camera','ai','wms_import')),
    source_reference_id UUID,          -- inference_id, mission_id, sync_job_id

    -- Confianza: relevante para observaciones de IA (0.0 - 1.0)
    confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

    observed_by UUID REFERENCES core.users(id),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    evidence_urls JSONB NOT NULL DEFAULT '[]',
    notes TEXT,

    -- Resolución: ¿esta observación fue la aceptada?
    is_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    rejected_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_count_observations_sequence UNIQUE (count_item_id, sequence),

    -- Una observación manual debe tener autor; una de IA debe tener referencia
    CONSTRAINT chk_observation_provenance CHECK (
        (source = 'manual' AND observed_by IS NOT NULL) OR
        (source <> 'manual')
    )
);

CREATE INDEX idx_count_obs_tenant ON inventory.count_observations(tenant_id);
CREATE INDEX idx_count_obs_item ON inventory.count_observations(count_item_id, sequence);

-- Solo una observación aceptada por línea
CREATE UNIQUE INDEX idx_count_obs_one_accepted
    ON inventory.count_observations(count_item_id)
    WHERE is_accepted = TRUE;
```

**Flujo de reconciliación** (lógica de aplicación, no de BD):

```
1. Se crea count_item con system_quantity (snapshot).
2. Operador cuenta → observation sequence=1.
3. Si |observed - system| > umbral del warehouse:
     → count_item.status = 'recount_required'
     → Se solicita observation sequence=2
4. Si sequence=1 y sequence=2 coinciden → se acepta esa cantidad.
   Si difieren → observation sequence=3 (supervisor) decide.
5. La observación aceptada se marca is_accepted=TRUE y se copia
   a count_item.accepted_quantity + accepted_observation_id.
6. discrepancy se calcula automáticamente.
```

Las observaciones **no se modifican ni se borran**: son el registro de qué se contó,
cuándo, por quién y con qué evidencia.

### 4.5 inventory.adjustments

```sql
CREATE TABLE inventory.adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    count_id UUID REFERENCES inventory.counts(id),
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('increase','decrease','correction','transfer')),
    reason_code VARCHAR(50) NOT NULL,
    reason_description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','applied','cancelled')),
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    approved_by UUID REFERENCES core.users(id),
    approved_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    rejected_reason TEXT,
    evidence_urls JSONB NOT NULL DEFAULT '[]',
    created_by UUID NOT NULL REFERENCES core.users(id),

    -- Optimistic locking (DR-014): el workflow de aprobación es concurrente
    version INT NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_adjustments_tenant ON inventory.adjustments(tenant_id);
CREATE INDEX idx_adjustments_warehouse ON inventory.adjustments(tenant_id, warehouse_id);
CREATE INDEX idx_adjustments_status ON inventory.adjustments(tenant_id, status);
```

### 4.6 inventory.adjustment_items

```sql
CREATE TABLE inventory.adjustment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    adjustment_id UUID NOT NULL REFERENCES inventory.adjustments(id),
    product_id UUID NOT NULL REFERENCES inventory.products(id),
    location_id UUID NOT NULL REFERENCES core.locations(id),
    stock_record_id UUID REFERENCES inventory.stock_records(id),
    previous_quantity DECIMAL(15,4) NOT NULL,
    new_quantity DECIMAL(15,4) NOT NULL,
    difference DECIMAL(15,4) GENERATED ALWAYS AS (new_quantity - previous_quantity) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_adj_items_tenant ON inventory.adjustment_items(tenant_id);
CREATE INDEX idx_adj_items_adjustment ON inventory.adjustment_items(adjustment_id);
```

### 4.7 inventory.incidents

```sql
CREATE TABLE inventory.incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    location_id UUID REFERENCES core.locations(id),
    product_id UUID REFERENCES inventory.products(id),
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('shortage','surplus','damage','misplace','expiry','other')),
    severity VARCHAR(10) NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('low','medium','high','critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','investigating','resolved','closed')),
    title VARCHAR(300) NOT NULL,
    description TEXT,
    detected_source VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (detected_source IN ('manual','ai','drone','count','integration')),
    source_reference_id UUID,
    evidence_urls JSONB NOT NULL DEFAULT '[]',
    assigned_to UUID REFERENCES core.users(id),
    resolution TEXT,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_tenant ON inventory.incidents(tenant_id);
CREATE INDEX idx_incidents_warehouse ON inventory.incidents(tenant_id, warehouse_id);
CREATE INDEX idx_incidents_status ON inventory.incidents(tenant_id, status);
CREATE INDEX idx_incidents_severity ON inventory.incidents(tenant_id, severity) 
    WHERE status IN ('open', 'investigating');
```

---

## 5. SCHEMA: AI

### 5.1 ai.models

```sql
CREATE TABLE ai.models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    engine_type VARCHAR(30) NOT NULL
        CHECK (engine_type IN ('yolo','grounding_dino','sam','detectron2','tensorrt','openvino','custom')),
    name VARCHAR(200) NOT NULL,
    version VARCHAR(50) NOT NULL,
    architecture VARCHAR(50),
    task VARCHAR(30) NOT NULL
        CHECK (task IN ('detection','segmentation','classification','pose')),
    classes JSONB NOT NULL DEFAULT '[]',
    metrics JSONB NOT NULL DEFAULT '{}',
    file_path TEXT,
    file_size_bytes BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'ready'
        CHECK (status IN ('training','ready','deployed','archived')),
    training_job_id UUID,
    deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_models_tenant ON ai.models(tenant_id);
CREATE INDEX idx_ai_models_engine ON ai.models(tenant_id, engine_type);
CREATE INDEX idx_ai_models_status ON ai.models(tenant_id, status);
```

### 5.2 ai.datasets

```sql
CREATE TABLE ai.datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL DEFAULT '1.0',
    classes JSONB NOT NULL DEFAULT '[]',
    split_config JSONB NOT NULL DEFAULT '{"train":0.7,"val":0.2,"test":0.1}',
    statistics JSONB NOT NULL DEFAULT '{}',
    format VARCHAR(20) NOT NULL DEFAULT 'yolo'
        CHECK (format IN ('yolo','coco','voc','custom')),
    image_count INT NOT NULL DEFAULT 0,
    annotation_count INT NOT NULL DEFAULT 0,
    storage_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'building'
        CHECK (status IN ('building','ready','archived')),
    created_by UUID NOT NULL REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_datasets_tenant ON ai.datasets(tenant_id);
```

### 5.3 ai.inference_jobs

```sql
CREATE TABLE ai.inference_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    model_id UUID NOT NULL REFERENCES ai.models(id),
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('single_image','batch','video','stream')),
    input_config JSONB NOT NULL,
    inference_config JSONB NOT NULL DEFAULT '{"confidence":0.5,"iou":0.45}',
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','processing','completed','failed','cancelled')),
    progress_percent INT NOT NULL DEFAULT 0
        CHECK (progress_percent BETWEEN 0 AND 100),
    results JSONB,
    metrics JSONB,
    error_message TEXT,
    requested_by UUID NOT NULL REFERENCES core.users(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inferences_tenant ON ai.inference_jobs(tenant_id);
CREATE INDEX idx_inferences_status ON ai.inference_jobs(tenant_id, status);
CREATE INDEX idx_inferences_model ON ai.inference_jobs(tenant_id, model_id);
CREATE INDEX idx_inferences_date ON ai.inference_jobs(tenant_id, created_at DESC);
```

### 5.4 ai.training_jobs

```sql
CREATE TABLE ai.training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    dataset_id UUID NOT NULL REFERENCES ai.datasets(id),
    base_model_id UUID REFERENCES ai.models(id),
    config JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','training','completed','failed','cancelled')),
    progress JSONB NOT NULL DEFAULT '{}',
    result_model_id UUID REFERENCES ai.models(id),
    error_message TEXT,
    requested_by UUID NOT NULL REFERENCES core.users(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_tenant ON ai.training_jobs(tenant_id);
CREATE INDEX idx_training_status ON ai.training_jobs(tenant_id, status);
```

---

## 6. SCHEMA: DEVICES

### 6.1 devices.devices

```sql
CREATE TABLE devices.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('drone','camera','sensor','gateway')),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100) NOT NULL,
    firmware_version VARCHAR(50),
    name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online','offline','maintenance','retired')),
    configuration JSONB NOT NULL DEFAULT '{}',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_tenant ON devices.devices(tenant_id);
CREATE INDEX idx_devices_warehouse ON devices.devices(tenant_id, warehouse_id);
CREATE UNIQUE INDEX idx_devices_serial ON devices.devices(tenant_id, serial_number);
```

### 6.2 devices.drone_missions

```sql
CREATE TABLE devices.drone_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    drone_id UUID NOT NULL REFERENCES devices.devices(id),
    name VARCHAR(200) NOT NULL,
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('inventory_scan','inspection','surveillance','custom')),
    route JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','pre_flight','in_flight','completed','aborted')),

    -- La telemetría NO se almacena aquí (ver §6.3). Solo el resumen agregado.
    telemetry_summary JSONB NOT NULL DEFAULT '{}',
    telemetry_point_count INT NOT NULL DEFAULT 0,

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_seconds INT,
    abort_reason TEXT,
    created_by UUID NOT NULL REFERENCES core.users(id),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_missions_tenant ON devices.drone_missions(tenant_id);
CREATE INDEX idx_missions_warehouse ON devices.drone_missions(tenant_id, warehouse_id);
CREATE INDEX idx_missions_status ON devices.drone_missions(tenant_id, status);
CREATE INDEX idx_missions_drone ON devices.drone_missions(tenant_id, drone_id);
```

### 6.3 devices.telemetry_points — persistencia independiente

> **Nuevo (DR-025).** La versión anterior guardaba la telemetría como un array JSONB
> dentro de `drone_missions`. Eso no es viable: un vuelo de 15 minutos con muestreo
> a 10 Hz genera 9.000 puntos. Un array JSONB de ese tamaño supera el umbral de TOAST,
> obliga a reescribir toda la fila en cada append, y hace imposible consultar la
> telemetría por rango de tiempo o agregarla.

La telemetría es una serie temporal y se modela como tal: tabla propia, append-only,
una fila por punto.

```sql
CREATE TABLE devices.telemetry_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL,
    mission_id UUID NOT NULL REFERENCES devices.drone_missions(id),
    device_id UUID NOT NULL REFERENCES devices.devices(id),

    -- Momento de la medición en el dispositivo (no de la inserción)
    recorded_at TIMESTAMPTZ NOT NULL,

    -- Posición
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    altitude_m DOUBLE PRECISION,
    position_x DOUBLE PRECISION,      -- coordenadas relativas al plano del almacén
    position_y DOUBLE PRECISION,

    -- Estado de vuelo
    battery_percent SMALLINT CHECK (battery_percent BETWEEN 0 AND 100),
    speed_ms DOUBLE PRECISION,
    heading_degrees DOUBLE PRECISION CHECK (heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees < 360)),

    -- Waypoint asociado, si aplica
    waypoint_sequence INT,

    -- Sensores adicionales sin esquema fijo (temperatura, señal, etc.)
    sensors JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_telemetry_tenant ON devices.telemetry_points(tenant_id);

-- El acceso natural es "toda la telemetría de esta misión, en orden"
CREATE INDEX idx_telemetry_mission_time
    ON devices.telemetry_points(mission_id, recorded_at);

CREATE INDEX idx_telemetry_device_time
    ON devices.telemetry_points(tenant_id, device_id, recorded_at DESC);
```

**Sin particionamiento en Fase 0** (DR-022). Esta es la tabla con mayor probabilidad
de necesitarlo, pero la decisión de clave de partición (por `recorded_at` mensual, o
por `tenant_id`) requiere conocer el patrón de uso real. El módulo de drones es Fase 3;
habrá métricas antes de necesitar la decisión.

**Retención**: la telemetría cruda es candidata a archivado agresivo (agregado a
`telemetry_summary` + purga de puntos > 90 días). Se define al implementar Fase 3.

> **Nota**: `devices.telemetry_points` es append-only por naturaleza pero **no** se
> declara inmutable a nivel de privilegios (a diferencia de `audit.events`). No es
> evidencia de auditoría, es dato operativo.

---

## 7. SCHEMA: INTEGRATIONS

### 7.1 integrations.connectors

```sql
CREATE TABLE integrations.connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('sap','oracle','dynamics','softland','exactus','generic_rest','generic_soap','csv','custom')),
    name VARCHAR(200) NOT NULL,
    version VARCHAR(20) NOT NULL DEFAULT '1.0',
    connection_config JSONB NOT NULL DEFAULT '{}',  -- encrypted at application level
    mapping_config JSONB NOT NULL DEFAULT '{}',
    sync_config JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'configuring'
        CHECK (status IN ('configuring','active','inactive','error')),
    last_sync_at TIMESTAMPTZ,
    last_health_check JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connectors_tenant ON integrations.connectors(tenant_id);
CREATE INDEX idx_connectors_warehouse ON integrations.connectors(tenant_id, warehouse_id);
```

### 7.2 integrations.sync_jobs

```sql
CREATE TABLE integrations.sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    connector_id UUID NOT NULL REFERENCES integrations.connectors(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('full','delta','push')),
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound','outbound','bidirectional')),
    entity_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','completed','failed','partial')),
    progress JSONB NOT NULL DEFAULT '{"processed":0,"total":0}',
    results JSONB,
    errors JSONB NOT NULL DEFAULT '[]',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_jobs_tenant ON integrations.sync_jobs(tenant_id);
CREATE INDEX idx_sync_jobs_connector ON integrations.sync_jobs(tenant_id, connector_id);
CREATE INDEX idx_sync_jobs_status ON integrations.sync_jobs(tenant_id, status);
```

---

## 8. SCHEMA: AUDIT

### 8.1 audit.events

```sql
CREATE TABLE audit.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,  -- No FK para performance
    actor_id UUID NOT NULL,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (actor_type IN ('user','system','integration','platform_admin')),
    action_category VARCHAR(30) NOT NULL,
    action_type VARCHAR(30) NOT NULL,
    module VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    changes JSONB,
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    correlation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_date ON audit.events(tenant_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit.events(tenant_id, actor_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit.events(tenant_id, resource_type, resource_id);
CREATE INDEX idx_audit_correlation ON audit.events(correlation_id) WHERE correlation_id IS NOT NULL;

-- BRIN index para queries temporales eficientes (barato, útil desde el inicio)
CREATE INDEX idx_audit_created_brin ON audit.events USING BRIN(created_at);
```

> **Cambio (DR-022): particionamiento pospuesto.** La versión anterior declaraba
> `PARTITION BY RANGE (created_at)` con particiones mensuales creadas a mano.
> Se retira por tres razones:
>
> 1. **Sin métricas no hay decisión informada.** La clave de partición correcta
>    (fecha vs tenant vs ambas) depende del patrón de consulta real.
> 2. **Coste operacional inmediato.** Una tabla particionada exige un mecanismo de
>    creación automática de particiones futuras (`pg_partman` o cron). Es
>    infraestructura que no aporta valor con volumen bajo.
> 3. **Es reversible.** Convertir una tabla en particionada después es una migración
>    conocida (crear particionada, copiar, renombrar). No hay lock-in.
>
> El índice BRIN sobre `created_at` da la mayor parte del beneficio de rango temporal
> a coste casi nulo. Se reevalúa cuando `audit.events` supere ~50M filas.

`audit.events` no lleva columna `version`: es append-only, nunca se actualiza, así que
el optimistic locking no aplica.

---

## 9. SCHEMA: SPATIAL

### 9.1 spatial.floor_plans

```sql
CREATE TABLE spatial.floor_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
    name VARCHAR(200) NOT NULL,
    version VARCHAR(20) NOT NULL DEFAULT '1.0',
    file_format VARCHAR(10) NOT NULL CHECK (file_format IN ('dwg','dxf','svg','png')),
    file_url TEXT NOT NULL,
    file_size_bytes BIGINT,
    dimensions JSONB,  -- {width, height, scale}
    layers JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    uploaded_by UUID NOT NULL REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_floor_plans_tenant ON spatial.floor_plans(tenant_id);
CREATE INDEX idx_floor_plans_warehouse ON spatial.floor_plans(tenant_id, warehouse_id);
```

---

## 10. TRIGGERS Y FUNCIONES COMUNES

```sql
-- Auto-update de updated_at
CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar a todas las tablas con updated_at
-- (ejecutar para cada tabla)
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core.warehouses
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Prevent tenant_id change
CREATE OR REPLACE FUNCTION core.prevent_tenant_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id != OLD.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id of existing record';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Soft delete helper
CREATE OR REPLACE FUNCTION core.soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    NEW.deleted_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 11. DIAGRAMA ER (Relaciones Principales)

```
public.countries  (catálogo global, sin tenant_id)
    │
    │ referenciado por
    ▼
core.tenants
    │
    ├── 1:N ── core.tenant_countries ── 1:N ── core.companies
    │              (presencia operativa)              │
    │                                                 │
    │                                                 └── 1:N ── core.warehouses
    │                                                                │
    │      ┌─────────────────────────────────────────────────────────┤
    │      │                                                         │
    │      ├── 1:N ── core.areas ── 1:N ── core.locations            │
    │      │          (tenant_id + warehouse_id desnormalizados)     │
    │      │                                                         │
    │      ├── 1:N ── inventory.stock_records                        │
    │      ├── 1:N ── inventory.counts                               │
    │      │              └── 1:N ── inventory.count_items           │
    │      │                             └── 1:N ── count_observations
    │      ├── 1:N ── inventory.adjustments                          │
    │      ├── 1:N ── inventory.incidents                            │
    │      ├── 1:N ── devices.devices                                │
    │      ├── 1:N ── devices.drone_missions                         │
    │      │              └── 1:N ── devices.telemetry_points        │
    │      ├── 1:N ── integrations.connectors                        │
    │      └── 1:N ── spatial.floor_plans                            │
    │
    ├── 1:N ── core.users
    │              ├── N:M ── core.roles (via core.user_role_assignments)
    │              └── N:M ── core.warehouses (via core.user_warehouse_access)
    │                              └── revoked_at = revocación inmediata
    │
    ├── 1:N ── inventory.products     (scope tenant, no warehouse)
    ├── 1:N ── ai.models
    ├── 1:N ── ai.datasets
    └── 1:N ── audit.events           (append-only)
```

### Jerarquía canónica

```
tenant → tenant_country → company → warehouse → area → location
```

`public.countries` no forma parte de la jerarquía: es un catálogo referenciado por
`core.tenant_countries`.

---

## 12. ESTRATEGIA DE PARTICIONAMIENTO

> **Decisión DR-022: particionamiento pospuesto para todas las tablas.**
> Ninguna tabla se particiona en Fase 0.

### 12.1 Estado actual

| Tabla | Particionada | Candidata futura | Umbral de reevaluación |
|-------|-------------|------------------|----------------------|
| `audit.events` | No | Sí (RANGE por created_at) | ~50M filas |
| `devices.telemetry_points` | No | Sí (RANGE por recorded_at) | ~100M filas |
| `ai.inference_jobs` | No | Sí (RANGE por created_at) | ~20M filas |
| `integrations.sync_jobs` | No | Improbable | ~10M filas |
| `inventory.stock_records` | No | Improbable (es tabla de estado, no de eventos) | ~100M filas |

### 12.2 Por qué se pospone

1. La clave de partición es difícil de cambiar una vez elegida. Elegirla sin datos de
   producción es adivinar.
2. Una tabla particionada exige automatizar la creación de particiones futuras
   (`pg_partman`, cron). Es carga operacional sin beneficio a volumen bajo.
3. Los índices BRIN sobre columnas temporales entregan buena parte del beneficio de
   pruning de rango a coste marginal.
4. Convertir a particionada más adelante es una migración estándar y conocida.

### 12.3 Prerequisito para particionar

Antes de particionar cualquier tabla debe existir:
- Métrica de volumen real (filas, GB) durante al menos 3 meses.
- Perfil de queries (¿se filtra por fecha? ¿por tenant? ¿ambos?).
- Evidencia de degradación medida (no anticipada).

---

## 12.4 OPTIMISTIC LOCKING

> **Decisión DR-014 (aprobada).** Las entidades transaccionales críticas llevan
> `version INT NOT NULL DEFAULT 1`.

### 12.4.1 Tablas con optimistic locking

| Tabla | Razón |
|-------|-------|
| `inventory.stock_records` | Múltiples operadores pueden ajustar el mismo stock simultáneamente |
| `inventory.counts` | El ciclo de vida del conteo (start/complete/cancel) es concurrente |
| `inventory.count_items` | Aceptar una observación mientras otro operador registra otra |
| `inventory.adjustments` | El workflow de aprobación es inherentemente concurrente |
| `core.warehouses`, `core.companies`, `core.areas`, `core.locations` | Configuración editable por varios administradores |
| `devices.drone_missions` | Estado de misión modificado por telemetría y por operador |

### 12.4.2 Tablas SIN optimistic locking

| Tabla | Razón |
|-------|-------|
| `audit.events` | Append-only, nunca se actualiza |
| `devices.telemetry_points` | Append-only |
| `inventory.count_observations` | Inmutables tras creación |
| `core.user_warehouse_access` | Operaciones son grant/revoke, no edición concurrente del mismo registro |
| `public.countries` | Catálogo de plataforma, no editable por tenants |

### 12.4.3 Semántica

El `UPDATE` incluye la versión leída en el `WHERE` e incrementa la columna:

```sql
UPDATE inventory.stock_records
SET quantity = :new_quantity,
    version  = version + 1
WHERE id = :id
  AND version = :expected_version;
-- Si rowcount = 0 → otro proceso modificó la fila → conflicto
```

Si `rowcount = 0`, la capa de aplicación lanza un error de concurrencia y la API
responde `409 Conflict`. El cliente debe recargar y reintentar.

**El incremento de `version` es responsabilidad de la capa de aplicación, no de un
trigger.** Un trigger incrementaría la versión también en escrituras que no pasaron
por la comprobación, lo que rompería la garantía.

---

## 12.5 ÍNDICES ÚNICOS CON SOFT DELETE

> **Decisión DR-021 (aprobada).** Todo índice único sobre una tabla con `deleted_at`
> debe ser **parcial**.

### 12.5.1 El problema

```sql
-- ❌ INCORRECTO: índice único total
CREATE UNIQUE INDEX idx_products_sku ON inventory.products(tenant_id, sku);
```

Con soft delete, la fila borrada permanece. El índice total impide crear un producto
nuevo con el SKU de uno borrado, aunque el borrado ya no sea operativo. El usuario ve
"SKU duplicado" sobre un registro que no puede encontrar en la UI.

### 12.5.2 El patrón correcto

```sql
-- ✓ CORRECTO: índice único parcial
CREATE UNIQUE INDEX idx_products_tenant_sku
    ON inventory.products(tenant_id, sku)
    WHERE deleted_at IS NULL;
```

Solo las filas vigentes participan en la restricción de unicidad.

### 12.5.3 Inventario de índices únicos parciales

| Tabla | Índice | Columnas | Condición |
|-------|--------|----------|-----------|
| `core.companies` | `idx_companies_tenant_tax` | tenant_id, tenant_country_id, tax_id | `tax_id IS NOT NULL AND deleted_at IS NULL` |
| `core.tenant_countries` | `idx_tenant_countries_unique` | tenant_id, country_id | `deleted_at IS NULL` |
| `core.warehouses` | `idx_warehouses_company_code` | tenant_id, company_id, code | `deleted_at IS NULL` |
| `core.areas` | `idx_areas_warehouse_code` | tenant_id, warehouse_id, code | `deleted_at IS NULL` |
| `core.locations` | `idx_locations_area_code` | tenant_id, area_id, code | `deleted_at IS NULL` |
| `core.users` | `idx_users_tenant_email` | tenant_id, email | `deleted_at IS NULL` |
| `inventory.products` | `idx_products_tenant_sku` | tenant_id, sku | `deleted_at IS NULL` |
| `inventory.products` | `idx_products_tenant_barcode` | tenant_id, barcode | `barcode IS NOT NULL AND deleted_at IS NULL` |
| `inventory.stock_records` | `idx_stock_serial` | tenant_id, serial_number | `serial_number IS NOT NULL AND deleted_at IS NULL` |
| `core.user_warehouse_access` | `idx_uwa_unique_active` | tenant_id, user_id, warehouse_id | `revoked_at IS NULL` |

### 12.5.4 Excepciones (índices únicos totales legítimos)

| Tabla | Índice | Razón |
|-------|--------|-------|
| `core.tenants` | `idx_tenants_slug` | El slug es parte de la URL; reutilizarlo tras cancelación causaría confusión |
| `public.countries` | `iso_code`, `iso_code_3` | Catálogo sin soft delete |
| `core.users` | `auth_id` | Vínculo 1:1 con Supabase Auth, nunca se reutiliza |
| `inventory.count_observations` | `uq_count_observations_sequence` | Tabla sin soft delete |

---

## 13. BACKUPS Y RECOVERY

| Componente | Estrategia | RPO | RTO |
|-----------|-----------|-----|-----|
| PostgreSQL (Supabase) | Point-in-time recovery | 5 min | < 1 hora |
| Storage (Supabase) | Redundancia automática | Near-zero | < 30 min |
| Configuración | Git (IaC) | 0 (committed) | < 15 min |
| Secrets | Vault backup | 0 | < 30 min |

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
