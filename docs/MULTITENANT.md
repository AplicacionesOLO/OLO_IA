# OLO_IA - ESTRATEGIA MULTI-TENANT

## 1. INTRODUCCIÓN

Este documento define la estrategia completa de multi-tenancy para OLO_IA. La plataforma debe soportar cientos o miles de clientes con aislamiento total de datos, configuración independiente y escalabilidad horizontal.

---

## 2. MODELO DE TENANCY SELECCIONADO

### 2.1 Decisión: Shared Database, Shared Schema con Row Level Security

```
┌─────────────────────────────────────────────────────────────────┐
│              MODELOS DE MULTI-TENANCY EVALUADOS                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  DB por      │  │  Schema por  │  │  Shared Schema +     │  │
│  │  Tenant      │  │  Tenant      │  │  RLS (ELEGIDO)       │  │
│  ├──────────────┤  ├──────────────┤  ├──────────────────────┤  │
│  │ ✗ Costoso    │  │ ✗ Migraciones│  │ ✓ Costo eficiente    │  │
│  │ ✗ Operacional│  │   complejas  │  │ ✓ Operación simple   │  │
│  │ ✓ Aislamiento│  │ ✗ Límite de  │  │ ✓ Migraciones únicas │  │
│  │   total      │  │   schemas PG │  │ ✓ Supabase nativo    │  │
│  │ ✗ No escala  │  │ ~ Aislamiento│  │ ✓ Escala horizontal  │  │
│  │   a 1000+    │  │   medio      │  │ ✓ RLS = aislamiento  │  │
│  └──────────────┘  └──────────────┘  │   fuerte             │  │
│                                       └──────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Justificación:**
1. Supabase funciona con shared schema + RLS nativamente.
2. PostgreSQL RLS proporciona aislamiento a nivel de motor de base de datos (no solo aplicación).
3. Una sola migración aplica para todos los tenants.
4. Costo operacional mínimo: una sola base de datos a mantener.
5. Escala a miles de tenants sin overhead de conexiones.
6. Índices compuestos con `tenant_id` aseguran performance.

### 2.2 Garantías de Aislamiento

| Capa | Mecanismo | Nivel |
|------|-----------|-------|
| Base de Datos | RLS Policies | Enforced by PostgreSQL engine |
| Aplicación | Tenant Context Middleware | Defense in depth |
| API | JWT claims con tenant_id | Authentication level |
| Storage | Bucket paths con tenant_id prefix | File level |
| Cache | Key prefix con tenant_id | Memory level |
| Logs | Tenant_id en structured logs | Observability level |

---

## 3. JERARQUÍA ORGANIZACIONAL

### 3.1 Modelo Jerárquico

```
┌─────────────────────────────────────────────────────────────────┐
│                    JERARQUÍA MULTI-TENANT                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TENANT (Organización Cliente)                           │    │
│  │  • Aislamiento total de datos                            │    │
│  │  • Plan y licenciamiento propio                          │    │
│  │  • Configuración global (branding, seguridad)            │    │
│  │                                                          │    │
│  │  ┌───────────────────────────────────────────────────┐   │    │
│  │  │  TENANT_COUNTRY (Presencia operativa en un país)   │   │    │
│  │  │  • Referencia a public.countries (catálogo global) │   │    │
│  │  │  • Configuración regional propia del tenant        │   │    │
│  │  │  • Overrides: moneda, idioma, timezone, fiscal     │   │    │
│  │  │                                                    │   │    │
│  │  │  ┌─────────────────────────────────────────────┐   │   │    │
│  │  │  │  COMPANY (Compañía)                          │   │   │    │
│  │  │  │  • Entidad legal                             │   │   │    │
│  │  │  │  • Datos fiscales                            │   │   │    │
│  │  │  │  • Configuración de negocio                  │   │   │    │
│  │  │  │                                              │   │   │    │
│  │  │  │  ┌───────────────────────────────────────┐   │   │   │    │
│  │  │  │  │  WAREHOUSE (Almacén)                   │   │   │   │    │
│  │  │  │  │  • Unidad operativa independiente      │   │   │   │    │
│  │  │  │  │  • WMS propio (conector independiente) │   │   │   │    │
│  │  │  │  │  • Timezone, idioma, moneda propios    │   │   │   │    │
│  │  │  │  │                                        │   │   │   │    │
│  │  │  │  │  ┌─────────────────────────────────┐   │   │   │   │    │
│  │  │  │  │  │  AREA (Área)                     │   │   │   │   │    │
│  │  │  │  │  │  • Zona funcional del almacén    │   │   │   │   │    │
│  │  │  │  │  │                                  │   │   │   │   │    │
│  │  │  │  │  │  ┌───────────────────────────┐   │   │   │   │   │    │
│  │  │  │  │  │  │  LOCATION (Ubicación)      │   │   │   │   │   │    │
│  │  │  │  │  │  │  • Posición física         │   │   │   │   │   │    │
│  │  │  │  │  │  │  • Rack, estante, bin      │   │   │   │   │   │    │
│  │  │  │  │  │  └───────────────────────────┘   │   │   │   │   │    │
│  │  │  │  │  └─────────────────────────────────┘   │   │   │   │    │
│  │  │  │  └───────────────────────────────────────┘   │   │   │    │
│  │  │  └─────────────────────────────────────────────┘   │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1.1 Separación entre catálogo global y presencia operativa

> **Decisión DR-005 (aprobada).** Los países se modelan en dos niveles distintos.

```
public.countries                      core.tenant_countries
─────────────────                     ─────────────────────
Catálogo global ISO 3166-1            Presencia operativa del tenant
Sin tenant_id                         Con tenant_id
Read-only para todos los tenants      Editable por el tenant
Mantenido por la plataforma           Creado al expandir a un país
Dato universal:                       Dato del tenant:
  • iso_code, iso_code_3                • overrides de moneda/idioma/tz
  • name, official_name                 • configuración fiscal
  • defaults (moneda, locale, tz)       • status (activo/inactivo)
```

**Por qué se separan.** "Costa Rica existe y su código ISO es CR" es un hecho universal:
duplicarlo en cada tenant genera inconsistencias y trabajo de mantenimiento multiplicado.
"Este tenant opera en Costa Rica con moneda CRC y régimen fiscal X" es un dato del tenant.

**Consecuencia en la jerarquía**: `companies` referencia `core.tenant_countries`, no
`public.countries`. La jerarquía canónica es:

```
tenant → tenant_country → company → warehouse → area → location
```

### 3.2 Cardinalidad

| Relación | Cardinalidad | Ejemplo |
|----------|-------------|---------|
| Platform → Tenant | 1:N | Miles de clientes |
| Platform → Country (catálogo) | 1:N | ~250 países ISO, compartidos |
| Tenant → TenantCountry | 1:N | Operación en 5 países |
| Country (catálogo) → TenantCountry | 1:N | Muchos tenants operan en el mismo país |
| TenantCountry → Company | 1:N | 3 empresas en un país |
| Company → Warehouse | 1:N | 10 almacenes por empresa |
| Warehouse → Area | 1:N | 8 áreas por almacén |
| Area → Location | 1:N | 500 ubicaciones por área |
| Tenant → User | 1:N | 200 usuarios por tenant |
| User → Warehouse (access) | N:M | Usuario accede a 3 almacenes |

### 3.3 Configuración Heredable

La configuración fluye de arriba hacia abajo con override en cada nivel:

```
public.countries (defaults universales del país)
    │
    ▼ provee defaults a
Tenant Config (defaults del tenant)
    │
    ▼ inherit + override
TenantCountry Config (locale, currency, timezone, fiscal)
    │
    ▼ inherit + override
Company Config (business rules)
    │
    ▼ inherit + override
Warehouse Config (operational settings, WMS, timezone propio)
    │
    ▼ inherit + override
Area Config (specific rules)
```

**Ejemplo de resolución:**
```
Q: ¿Cuál es la moneda del Almacén X?
A:
  1. ¿Warehouse X tiene currency_code? → Usar esa
  2. ¿No? → ¿Company tiene currency_code? → Usar esa
  3. ¿No? → ¿TenantCountry tiene currency_code? → Usar esa
  4. ¿No? → ¿public.countries.default_currency_code del país asociado? → Usar esa
  5. ¿No? → Usar default del Tenant
```

---

## 4. TENANT CONTEXT

### 4.1 Propagación del Contexto

El `tenant_id` se propaga desde la autenticación hasta la base de datos en cada request:

```
┌─────────────────────────────────────────────────────────────┐
│                  TENANT CONTEXT FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. JWT Token contiene: { tenant_id, user_id, roles }        │
│                    │                                         │
│                    ▼                                         │
│  2. Auth Middleware extrae tenant_id del JWT                  │
│                    │                                         │
│                    ▼                                         │
│  3. TenantContext se crea y se inyecta via DI                │
│                    │                                         │
│                    ▼                                         │
│  4. DB Session ejecuta: SET LOCAL app.current_tenant = 'X'   │
│                    │                                         │
│                    ▼                                         │
│  5. RLS Policy filtra automáticamente:                       │
│     WHERE tenant_id = current_setting('app.current_tenant')  │
│                    │                                         │
│                    ▼                                         │
│  6. Query SOLO retorna datos del tenant activo               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Implementación del Tenant Context

> **Corregido.** La versión anterior de esta sección contenía código con tres defectos
> de seguridad y corrección. Se documentan aquí porque el patrón incorrecto es común y
> conviene poder reconocerlo.

#### 4.2.1 El patrón incorrecto y por qué falla

```python
# ❌ NO USAR — contiene tres defectos
await session.execute(
    text(f"SET LOCAL app.current_tenant = '{context.tenant_id.value}'")
)
```

| # | Defecto | Consecuencia |
|---|---------|-------------|
| 1 | **Interpolación de f-string en SQL crudo** | Inyección SQL si `tenant_id` no está validado como UUID antes de llegar aquí. La validación en un punto anterior no es garantía: el patrón es inseguro por construcción. |
| 2 | **`SET LOCAL` fuera de una transacción es un no-op silencioso** | PostgreSQL emite un warning y continúa. El resultado es RLS con contexto `NULL`, que deniega todo. Produce un bug intermitente: funciona cuando hay transacción activa, falla cuando no, sin error claro. |
| 3 | **Devuelve la sesión sin garantizar transacción abierta** | El ajuste puede perderse antes de la primera query real. |

Además, el `TenantContext` de la versión anterior leía `warehouse_ids` y `permissions`
del JWT, lo que contradice la decisión **DR-003** (JWT mínimo).

#### 4.2.2 El patrón correcto

Hay **dos caminos** según quién origina la request (decisión DR-002):

##### Camino A — Request de usuario (rol `authenticated`)

No se establece contexto manualmente. Las políticas RLS leen los claims directamente
del JWT vía `auth.jwt()`. El `tenant_id` llega en el token emitido por el Custom Access
Token Hook y no puede ser manipulado por el cliente (el token está firmado).

```python
# El contexto RLS viene del JWT. No hay set_config.
class UserContext:
    """Contexto derivado del JWT. Solo claims mínimos."""
    auth_id: AuthId        # el claim `sub`
    tenant_id: TenantId    # de app_metadata.tenant_id
    tenant_wide_access: bool

async def get_user_context(request: Request) -> UserContext:
    token = extract_and_verify_jwt(request)   # verifica firma contra JWKS de Supabase
    claims = token.claims
    app_meta = claims.get("app_metadata", {})

    if "tenant_id" not in app_meta:
        # Fail-secure: el hook no encontró membresía activa
        raise UnauthorizedError("no active tenant membership")

    return UserContext(
        auth_id=AuthId(claims["sub"]),
        tenant_id=TenantId(app_meta["tenant_id"]),
        tenant_wide_access=app_meta.get("tenant_wide_access", False),
    )

# Los permisos y almacenes accesibles NO vienen del token:
# se resuelven consultando la base de datos cuando se necesitan.
```

##### Camino B — Proceso interno (rol `olo_app`)

Un worker sin JWG de usuario (sync de conector, reporte programado) establece el
contexto explícitamente. Aquí sí se usa `set_config`, pero **parameterizado** y
**dentro de una transacción**.

```python
from sqlalchemy import text

# set_config(setting, value, is_local) con is_local=true equivale a SET LOCAL,
# pero acepta parámetros vinculados. No hay interpolación de strings.
_CONTEXT_SQL = text("""
    SELECT set_config('app.current_tenant',     :tenant_id,   true),
           set_config('app.current_user',       :user_id,     true),
           set_config('app.current_auth_id',    :auth_id,     true),
           set_config('app.tenant_wide_access', :tenant_wide, true)
""")

@asynccontextmanager
async def worker_tenant_session(
    session_factory,
    ctx: WorkerContext,
) -> AsyncIterator[AsyncSession]:
    """Sesión de worker con contexto de tenant garantizado.

    La transacción se abre ANTES de set_config, de modo que el ámbito local
    del ajuste está garantizado y no puede degradarse a no-op.
    """
    async with session_factory() as session:
        async with session.begin():          # transacción explícita, primero
            await session.execute(
                _CONTEXT_SQL,
                {
                    "tenant_id":   str(ctx.tenant_id),
                    "user_id":     str(ctx.user_id) if ctx.user_id else "",
                    "auth_id":     str(ctx.auth_id) if ctx.auth_id else "",
                    "tenant_wide": "true" if ctx.tenant_wide_access else "false",
                },
            )
            yield session
            # commit/rollback lo gestiona session.begin()
```

#### 4.2.3 Reglas

| Regla | Motivo |
|-------|--------|
| Nunca construir SQL de contexto con f-strings o concatenación | Inyección |
| Usar `set_config(..., true)` en lugar de `SET LOCAL` con literal | Permite parámetros vinculados |
| Abrir la transacción antes de establecer el contexto | `SET LOCAL` fuera de transacción es no-op |
| El camino `authenticated` no establece contexto manualmente | El JWT ya lo transporta de forma firmada |
| El `tenant_id` nunca proviene del body ni de query params de la request | Solo del JWT (camino A) o de la configuración del job (camino B) |

Referencia completa: `RLS_STRATEGY.md` v2.0 §9.

### 4.3 Tenant Context en Frontend

> El frontend **nunca** envía `tenant_id`. El tenant se deriva del JWT en el servidor.
> Lo que el frontend sí gestiona es qué `tenant_country`, `company` y `warehouse` está
> viendo el usuario, que es estado de UI, no de autorización.

```typescript
// Zustand store para contexto de navegación
interface TenantState {
  tenant: Tenant | null;
  currentTenantCountry: TenantCountry | null;
  currentCompany: Company | null;
  currentWarehouse: Warehouse | null;
  availableWarehouses: Warehouse[];      // provisto por el backend, ya filtrado por RLS
  switchTenantCountry: (id: string) => void;
  switchCompany: (companyId: string) => void;
  switchWarehouse: (warehouseId: string) => void;
}

// React Query con tenant scope automático
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // El tenant context se incluye automáticamente via interceptor
      // No se necesita pasar tenant_id manualmente
    }
  }
});

// API Interceptor agrega el header de contexto de navegación.
// X-Warehouse-Id es una PREFERENCIA de filtrado, no una credencial:
// el backend valida que el usuario tenga acceso a ese warehouse antes de honrarlo.
apiClient.interceptors.request.use((config) => {
  const { currentWarehouse } = useTenantStore.getState();
  if (currentWarehouse) {
    config.headers['X-Warehouse-Id'] = currentWarehouse.id;
  }
  return config;
});
```

> **Importante**: `X-Warehouse-Id` no otorga acceso. Si el usuario envía el ID de un
> almacén al que no tiene acceso, RLS devuelve 0 filas. El header solo selecciona
> entre los almacenes que el usuario ya puede ver.

---

## 5. AISLAMIENTO DE DATOS

### 5.1 Niveles de Aislamiento

```
┌─────────────────────────────────────────────────────────────────┐
│              NIVELES DE AISLAMIENTO DE DATOS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NIVEL 1: TENANT ISOLATION (Obligatorio)                         │
│  ────────────────────────────────────                            │
│  • Tenant A NUNCA ve datos de Tenant B                           │
│  • Enforced por RLS en PostgreSQL                                │
│  • Verificado por tests automatizados                            │
│  • Aplicable a TODAS las tablas con datos de negocio             │
│                                                                  │
│  NIVEL 2: COMPANY ISOLATION (Dentro del tenant)                  │
│  ──────────────────────────────────────────────                  │
│  • Usuarios de Company A no ven datos de Company B               │
│  • Excepto: Admins del tenant ven todas las companies            │
│  • Enforced por filtros de aplicación + RLS                      │
│                                                                  │
│  NIVEL 3: WAREHOUSE ISOLATION (Dentro de la company)             │
│  ────────────────────────────────────────────────────            │
│  • Operadores del Almacén X no ven datos del Almacén Y           │
│  • Excepto: Managers de la company ven todos sus almacenes       │
│  • Enforced por permisos de usuario (warehouse_ids en token)     │
│                                                                  │
│  NIVEL 4: AREA/LOCATION ISOLATION (Opcional, por configuración)  │
│  ─────────────────────────────────────────────────────────       │
│  • Para almacenes muy grandes con equipos por zona               │
│  • Configurable por tenant                                       │
│  • Enforced a nivel de aplicación                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Tabla Base con Tenant ID

TODAS las tablas de datos de negocio incluyen `tenant_id`:

```sql
-- Patrón estándar para toda tabla
CREATE TABLE inventory.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    -- ... campos específicos ...
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ  -- soft delete
);

-- Índice compuesto obligatorio
CREATE INDEX idx_products_tenant ON inventory.products(tenant_id);
CREATE INDEX idx_products_tenant_sku ON inventory.products(tenant_id, sku);

-- RLS habilitado
ALTER TABLE inventory.products ENABLE ROW LEVEL SECURITY;

-- Policy de aislamiento
CREATE POLICY tenant_isolation ON inventory.products
    USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### 5.3 Tablas Exentas de Multi-Tenancy

Algunas tablas son globales (no tienen `tenant_id`):

| Tabla | Razón | RLS |
|-------|-------|-----|
| `public.countries` | Catálogo global ISO 3166-1 | Sí: lectura para todos, escritura para nadie |
| `public.currencies` | Catálogo global ISO 4217 | Sí: lectura para todos |
| `public.timezones` | Catálogo global IANA | Sí: lectura para todos |
| `public.announcements` | Avisos de plataforma | Sí: lectura para todos |
| `public.system_config` | Configuración de la plataforma | Sí: sin política de lectura para `authenticated` |
| `platform.*` | Funciones y datos de plataforma | Schema no expuesto a PostgREST |

> **Exentas de tenancy, no de RLS.** Una tabla en `public` sin RLS queda expuesta a
> escritura vía PostgREST y la marca el security advisor de Supabase. Todas llevan
> `ENABLE ROW LEVEL SECURITY` con política de solo lectura, más `REVOKE INSERT, UPDATE,
> DELETE`. Detalle en `RLS_STRATEGY.md` v2.0 §5.3.

> **`core.tenant_countries` NO está en esta lista**: tiene `tenant_id` y sigue la
> plantilla A de RLS. Es la presencia operativa del tenant, no el catálogo.

### 5.4 Storage Isolation (Supabase Storage)

```
Bucket Structure:
├── tenants/
│   ├── {tenant_id}/
│   │   ├── products/
│   │   │   ├── {product_id}/
│   │   │   │   ├── image_01.jpg
│   │   │   │   └── image_02.jpg
│   │   ├── datasets/
│   │   │   ├── {dataset_id}/
│   │   │   │   ├── images/
│   │   │   │   └── annotations/
│   │   ├── models/
│   │   │   ├── {model_id}/
│   │   │   │   └── weights.pt
│   │   ├── reports/
│   │   │   └── {report_id}.pdf
│   │   ├── plans/
│   │   │   └── {plan_id}.dxf
│   │   └── missions/
│   │       └── {mission_id}/
│   │           ├── captures/
│   │           └── telemetry/

Storage Policies:
- Acceso SOLO a paths que empiecen con tenants/{own_tenant_id}/
- Enforced por Supabase Storage policies
- Bucket privado por defecto
- URLs firmadas con expiración para acceso temporal
```

---

## 6. ONBOARDING DE TENANT

### 6.1 Flujo de Provisioning

```
┌─────────────────────────────────────────────────────────────────┐
│                  TENANT PROVISIONING FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Registro del Tenant                                          │
│     ├── Crear registro en core.tenants                           │
│     ├── Crear usuario admin inicial en Supabase Auth             │
│     ├── Crear perfil de usuario en core.users                    │
│     └── Asignar rol Super Admin al usuario                       │
│                                                                  │
│  2. Configuración Inicial                                        │
│     ├── Crear Company default                                    │
│     ├── Configurar plan/tier                                     │
│     ├── Configurar límites según plan                            │
│     ├── Crear roles default del tenant                           │
│     └── Crear configuración default (locale, timezone, currency) │
│                                                                  │
│  3. Seed Data                                                    │
│     ├── Copiar roles predefinidos al tenant                      │
│     ├── Crear permisos estándar                                  │
│     └── Configurar notificaciones default                        │
│                                                                  │
│  4. Verificación                                                 │
│     ├── Test de aislamiento RLS                                  │
│     ├── Test de acceso a storage                                 │
│     ├── Email de bienvenida al admin                             │
│     └── Activar tenant                                           │
│                                                                  │
│  5. Onboarding UX                                                │
│     ├── Wizard de configuración inicial                          │
│     ├── Crear primer almacén                                     │
│     ├── Invitar primeros usuarios                                │
│     └── Tour guiado de la plataforma                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Provisioning Atómico

El provisioning es una operación transaccional. Si falla cualquier paso, se revierte todo:

```python
# Conceptual: TenantProvisioningService
class TenantProvisioningService:
    async def provision(self, command: CreateTenantCommand) -> Tenant:
        async with self.uow:
            try:
                # 1. Create tenant record
                tenant = Tenant.create(
                    name=command.name,
                    slug=command.slug,
                    plan=command.plan,
                )
                await self.uow.tenants.save(tenant)
                
                # 2. Create admin user in Supabase Auth
                auth_user = await self.auth_service.create_user(
                    email=command.admin_email,
                    metadata={"tenant_id": str(tenant.id)}
                )
                
                # 3. Create user profile
                user = User.create(
                    tenant_id=tenant.id,
                    email=command.admin_email,
                    auth_id=auth_user.id,
                )
                await self.uow.users.save(user)
                
                # 4. Assign super admin role
                admin_role = await self.uow.roles.get_system_role("tenant_admin")
                user.assign_role(admin_role, scope=AssignmentScope.global_scope())
                
                # 5. Create default company
                company = Company.create(
                    tenant_id=tenant.id,
                    name=command.company_name,
                    country_id=command.country_id,
                )
                await self.uow.companies.save(company)
                
                # 6. Setup default configuration
                await self._setup_defaults(tenant)
                
                await self.uow.commit()
                await self.event_bus.publish(TenantProvisioned(tenant.id))
                
                return tenant
                
            except Exception:
                await self.uow.rollback()
                await self.auth_service.delete_user(auth_user.id)  # cleanup
                raise
```

---

## 7. LÍMITES Y CUOTAS POR TENANT

### 7.1 Sistema de Límites

```
┌─────────────────────────────────────────────────────────────────┐
│                    TENANT LIMITS SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  PLAN LIMITS (definidos por el tier contratado)           │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │                                                           │   │
│  │  Starter         Professional     Enterprise              │   │
│  │  ─────────       ────────────     ──────────              │   │
│  │  5 users         25 users         Unlimited               │   │
│  │  1 warehouse     5 warehouses     Unlimited               │   │
│  │  1 company       3 companies      Unlimited               │   │
│  │  1GB storage     10GB storage     Custom                  │   │
│  │  100 inf/month   1000 inf/month   Custom                  │   │
│  │  1 AI model      3 AI models      Unlimited               │   │
│  │  No API access   Basic API        Full API                │   │
│  │  Email support   Priority support Dedicated support       │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  USAGE METERING (tracked in real-time)                    │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │                                                           │   │
│  │  Resource              Meter                  Alert at     │   │
│  │  ────────              ─────                  ────────     │   │
│  │  Users                 Count active           80%, 100%    │   │
│  │  Warehouses            Count active           80%, 100%    │   │
│  │  Storage               Sum file sizes         80%, 90%     │   │
│  │  Inferences/month      Count per calendar mo  80%, 100%    │   │
│  │  API calls/month       Count per calendar mo  80%, 100%    │   │
│  │  AI models             Count deployed         100%         │   │
│  │  Concurrent streams    Count active           80%, 100%    │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Enforcement de Límites

```python
# Conceptual: LimitEnforcement
class TenantLimitService:
    async def check_limit(
        self, tenant_id: TenantId, resource: ResourceType
    ) -> LimitCheckResult:
        limits = await self.get_tenant_limits(tenant_id)
        current_usage = await self.get_current_usage(tenant_id, resource)
        
        max_allowed = limits.get_max(resource)
        
        if current_usage >= max_allowed:
            return LimitCheckResult(
                allowed=False,
                current=current_usage,
                max=max_allowed,
                message=f"Limit reached for {resource}. Upgrade plan."
            )
        
        if current_usage >= max_allowed * 0.8:
            await self.notify_approaching_limit(tenant_id, resource, current_usage, max_allowed)
        
        return LimitCheckResult(allowed=True, current=current_usage, max=max_allowed)

# Usado como guard en use cases
class CreateWarehouseUseCase:
    async def execute(self, command: CreateWarehouseCommand) -> WarehouseDTO:
        # Check limit before creating
        limit_check = await self.limit_service.check_limit(
            command.tenant_id, ResourceType.WAREHOUSES
        )
        if not limit_check.allowed:
            raise PlanLimitExceededError(limit_check.message)
        
        # ... proceed with creation
```

---

## 8. CROSS-TENANT OPERATIONS

### 8.1 Super Admin (Platform Level)

El Super Admin de la plataforma (no del tenant) puede:

| Operación | Contexto | Uso |
|-----------|----------|-----|
| Ver todos los tenants | Platform admin panel | Gestión de clientes |
| Crear tenants | Provisioning | Onboarding |
| Suspender tenants | Incident response | Violation, non-payment |
| Ver métricas agregadas | Platform dashboard | Monitoring |
| Impersonate tenant | Support | Debugging (con audit trail) |

### 8.2 Impersonation (Soporte)

Para soporte técnico, un Super Admin puede "impersonar" un tenant:

```
┌────────────────────────────────────────────────────┐
│              IMPERSONATION FLOW                      │
├────────────────────────────────────────────────────┤
│                                                     │
│  1. Super Admin solicita impersonar Tenant X        │
│  2. Sistema registra AUDIT event (quién, cuándo)    │
│  3. Se genera token temporal con tenant_id = X      │
│  4. Token tiene claim especial: is_impersonated     │
│  5. Todas las acciones se loguean como impersonated │
│  6. Token expira en 30 minutos (no renovable)       │
│  7. Al finalizar, se registra fin de impersonation  │
│                                                     │
│  RESTRICCIONES:                                     │
│  • No puede modificar datos sensibles (billing)     │
│  • No puede cambiar permisos/roles                  │
│  • Solo lectura + operaciones de soporte            │
│  • Todo queda en audit trail                        │
│                                                     │
└────────────────────────────────────────────────────┘
```

### 8.3 Datos Compartidos (Cross-Tenant)

Algunos datos son compartidos entre todos los tenants (read-only):

| Dato | Tabla | Acceso |
|------|-------|--------|
| Catálogo de países | public.countries | Read-only para todos |
| Catálogo de monedas | public.currencies | Read-only para todos |
| Zonas horarias | public.timezones | Read-only para todos |
| System models (pre-trained) | ai.system_models | Read-only, no tenant_id |
| Connector templates | integrations.connector_templates | Read-only |
| Platform announcements | public.announcements | Read-only |

---

## 9. TENANT LIFECYCLE

### 9.1 Estados del Tenant

```
┌─────────────────────────────────────────────────────────────┐
│                    TENANT LIFECYCLE                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [trial] ──► [active] ──► [suspended] ──► [cancelled]       │
│     │            │              │                            │
│     │            │              ▼                            │
│     │            │         [reactivated] ──► [active]        │
│     │            │                                           │
│     │            └──► [cancelled] ──► [deleted] (90 days)    │
│     │                                                        │
│     └──► [expired] ──► [cancelled]                           │
│                                                              │
│  Estados:                                                    │
│  • trial: Período de prueba (14-30 días configurable)        │
│  • active: Operación normal, plan pagado                     │
│  • suspended: Temporalmente inactivo (non-payment, violation)│
│  • cancelled: Cliente canceló, datos en retención            │
│  • deleted: Datos eliminados permanentemente                 │
│  • expired: Trial expirado sin conversión                    │
│                                                              │
│  Behaviors por estado:                                       │
│  • trial: Full access con límites de trial                   │
│  • active: Full access según plan                            │
│  • suspended: Read-only, no operaciones, banner de aviso     │
│  • cancelled: No access, datos en cold storage               │
│  • deleted: Todo eliminado (right to be forgotten)           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Data Retention en Cancelación

```
Tenant cancela servicio:
│
├── Día 0: Status → cancelled
│   ├── Acceso cortado inmediatamente
│   ├── Datos marcados para retención
│   └── Notificación al admin del tenant
│
├── Día 0-30: Período de gracia
│   ├── Datos intactos
│   ├── Reactivación posible (auto-restore)
│   └── Export de datos disponible bajo solicitud
│
├── Día 30-90: Cold storage
│   ├── Datos movidos a cold storage
│   ├── DB records soft-deleted
│   ├── Storage archivado
│   └── Reactivación posible con restore manual
│
└── Día 90+: Eliminación permanente
    ├── Datos eliminados de cold storage
    ├── Records hard-deleted de DB
    ├── Storage files eliminados
    ├── Audit logs archivados (compliance: 7 años)
    └── Confirmación de eliminación al ex-cliente
```

---

## 10. PERFORMANCE MULTI-TENANT

### 10.1 Indexación para Multi-Tenancy

```sql
-- PRINCIPIO: Todo índice relevante incluye tenant_id como primer campo

-- Índice primario de aislamiento
CREATE INDEX idx_[table]_tenant ON [schema].[table](tenant_id);

-- Índices compuestos para queries frecuentes
CREATE INDEX idx_products_tenant_sku ON inventory.products(tenant_id, sku);
CREATE INDEX idx_products_tenant_category ON inventory.products(tenant_id, category);
CREATE INDEX idx_stock_tenant_warehouse_product ON inventory.stock_records(tenant_id, warehouse_id, product_id);
CREATE INDEX idx_stock_tenant_location ON inventory.stock_records(tenant_id, location_id);
CREATE INDEX idx_users_tenant_email ON core.users(tenant_id, email);
CREATE INDEX idx_audit_tenant_timestamp ON audit.events(tenant_id, timestamp DESC);

-- Índices parciales para registros activos
CREATE INDEX idx_products_active ON inventory.products(tenant_id, sku) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_warehouses_active ON core.warehouses(tenant_id, company_id) 
    WHERE status = 'active';
```

### 10.2 Query Performance

| Escenario | Estrategia | Resultado Esperado |
|-----------|-----------|-------------------|
| Tenant con 1M productos | Partition by tenant_id + índice compuesto | < 50ms |
| Dashboard con aggregations | Materialized views por tenant | < 200ms |
| Búsqueda full-text | GIN index con tenant filter | < 100ms |
| Audit log query | BRIN index en timestamp + tenant filter | < 500ms |
| Concurrent tenants (1000) | Connection pooling + RLS | No degradación |

### 10.3 Noisy Neighbor Prevention

```
┌────────────────────────────────────────────────────────────┐
│             NOISY NEIGHBOR MITIGATION                        │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Rate Limiting per Tenant                                │
│     ├── API calls: X/min según plan                         │
│     ├── Bulk operations: queued, fair scheduling            │
│     └── Inference: dedicated queue per tenant               │
│                                                             │
│  2. Resource Quotas                                         │
│     ├── Max concurrent DB connections per tenant            │
│     ├── Max query execution time: 30s (kill long queries)   │
│     ├── Max upload size: configurable per plan              │
│     └── Max background jobs: configurable per plan          │
│                                                             │
│  3. Fair Scheduling                                         │
│     ├── Inference queue: round-robin por tenant             │
│     ├── Sync jobs: priority queue, no monopolization        │
│     └── Report generation: async, limited concurrency       │
│                                                             │
│  4. Monitoring & Alerts                                     │
│     ├── Per-tenant resource usage dashboards                │
│     ├── Anomaly detection (sudden spike)                    │
│     └── Auto-throttle if exceeding fair share               │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## 11. TESTING DE MULTI-TENANCY

### 11.1 Tests Obligatorios

| Test | Descripción | Frecuencia |
|------|-------------|-----------|
| Isolation Test | Crear 2 tenants, verificar que no ven datos cruzados | Cada PR |
| RLS Bypass Test | Intentar acceder sin tenant context → debe fallar | Cada PR |
| Cross-Tenant Query Test | Query con tenant_id de otro tenant → 0 resultados | Cada PR |
| Storage Isolation Test | Intentar acceder a archivos de otro tenant → 403 | Cada PR |
| Impersonation Audit Test | Verificar que impersonation genera audit trail | Cada PR |
| Limit Enforcement Test | Exceder límite → operación rechazada | Cada PR |
| Concurrent Tenant Test | 10 tenants operando simultáneamente sin interferencia | Semanal |
| Performance Isolation Test | Un tenant con carga alta no degrada a otros | Mensual |

### 11.2 Estrategia de Tests

```python
# Fixture base para tests multi-tenant
@pytest.fixture
async def two_tenants(db_session):
    """Create two isolated tenants for cross-isolation testing."""
    tenant_a = await create_test_tenant(db_session, name="Tenant A")
    tenant_b = await create_test_tenant(db_session, name="Tenant B")
    return tenant_a, tenant_b

@pytest.fixture
async def tenant_a_context(two_tenants):
    """DB session configured as Tenant A."""
    tenant_a, _ = two_tenants
    session = await get_session_for_tenant(tenant_a.id)
    return session

# Test de aislamiento
async def test_tenant_isolation(two_tenants, db_session):
    tenant_a, tenant_b = two_tenants
    
    # Create product in Tenant A
    await create_product_in_tenant(db_session, tenant_a.id, sku="PROD-001")
    
    # Switch to Tenant B context
    await set_tenant_context(db_session, tenant_b.id)
    
    # Query should return NOTHING
    products = await query_products(db_session)
    assert len(products) == 0  # Tenant B cannot see Tenant A's products
    
    # Direct query with wrong tenant_id should also fail (RLS)
    result = await db_session.execute(
        text("SELECT * FROM inventory.products WHERE sku = 'PROD-001'")
    )
    assert result.fetchall() == []  # RLS prevents access
```

---

## 12. MIGRACIÓN Y EVOLUCIÓN

### 12.1 Schema Migrations (Alembic)

Las migraciones aplican a TODOS los tenants simultáneamente:

```python
# Una migración, todos los tenants
def upgrade():
    op.add_column(
        'products',
        sa.Column('weight_kg', sa.Float(), nullable=True),
        schema='inventory'
    )
    # RLS se mantiene automáticamente (la policy usa tenant_id)
    # No se necesita modificar RLS al agregar columnas

def downgrade():
    op.drop_column('products', 'weight_kg', schema='inventory')
```

### 12.2 Data Migrations per Tenant

Para migraciones de datos que deben ejecutarse por tenant:

```python
# Data migration que procesa tenant por tenant
async def migrate_product_categories():
    tenants = await get_all_active_tenants()
    
    for tenant in tenants:
        async with tenant_context(tenant.id):
            # Ejecuta en contexto del tenant (RLS active)
            await update_categories_for_tenant(tenant.id)
            
    log.info(f"Migrated {len(tenants)} tenants")
```

### 12.3 Future: Tenant Sharding

Si la plataforma crece más allá de los límites de un solo PostgreSQL:

```
ACTUAL (Single DB):
┌──────────────────────┐
│   PostgreSQL         │
│   (all tenants)      │
└──────────────────────┘

FUTURO (Sharded):
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Shard 1 │  │  Shard 2 │  │  Shard 3 │
│ (1-333)  │  │(334-666) │  │(667-1000)│
└──────────┘  └──────────┘  └──────────┘

Shard key: tenant_id
Router: Application-level or PgBouncer
Preparación actual:
  • tenant_id en toda tabla
  • No queries cross-tenant
  • IDs globally unique (UUID)
  • No foreign keys cross-schema que impidan split
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
