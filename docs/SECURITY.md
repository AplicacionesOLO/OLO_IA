# OLO_IA - SEGURIDAD

## 1. INTRODUCCIÓN

La seguridad es una prioridad absoluta en OLO_IA. Este documento define la estrategia completa de seguridad, incluyendo autenticación, autorización, protección de datos, auditoría y cumplimiento.

### 1.1 Principios de Seguridad

1. **Security by Design**: La seguridad se integra en cada decisión arquitectónica.
2. **Defense in Depth**: Múltiples capas de protección.
3. **Least Privilege**: Mínimos permisos necesarios por defecto.
4. **Zero Trust**: No confiar en ninguna capa; verificar siempre.
5. **Fail Secure**: Ante fallo, denegar acceso.
6. **Auditability**: Toda acción debe ser rastreable.

---

## 2. AUTENTICACIÓN

### 2.1 Proveedor: Supabase Auth

Supabase Auth gestiona la identidad de usuarios con las siguientes capacidades:

| Característica | Implementación |
|---------------|----------------|
| Registro | Email + Password (bcrypt, cost 12+) |
| Login | Email + Password → JWT + Refresh Token |
| Recuperación | Email con link temporal (1 hora expiración) |
| MFA | TOTP (Google Authenticator, Authy) - opcional por tenant |
| SSO | SAML 2.0, OpenID Connect (fase 4) |
| Social Login | Deshabilitado por defecto (opcional por tenant) |
| Email Verification | Obligatorio antes de activar cuenta |

### 2.2 Flujo de Autenticación

```
┌──────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. LOGIN                                                     │
│  ────────                                                     │
│  Client ──► Supabase Auth (email + password)                  │
│         ◄── JWT Access Token (15 min) + Refresh Token (7 d)   │
│                                                               │
│  2. API REQUEST                                               │
│  ──────────────                                               │
│  Client ──► API (Authorization: Bearer <access_token>)        │
│         ──► Middleware valida firma, expiration, claims        │
│         ──► Extrae tenant_id, user_id, roles                  │
│         ──► SET LOCAL app.current_tenant = tenant_id          │
│         ──► Procesa request con RLS activo                    │
│                                                               │
│  3. TOKEN REFRESH                                             │
│  ────────────────                                             │
│  Client detecta 401 o token cerca de expirar                  │
│  Client ──► Supabase Auth (refresh_token)                     │
│         ◄── Nuevo access_token + nuevo refresh_token          │
│         (refresh token rotation: el anterior se invalida)     │
│                                                               │
│  4. LOGOUT                                                    │
│  ────────                                                     │
│  Client ──► Supabase Auth (invalidar refresh token)           │
│         ──► Eliminar tokens del cliente                       │
│         ──► Session terminada                                 │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Estructura del JWT (Mínimo)

> **Decisión DR-003 (aprobada).** El JWT es **mínimo**. No transporta listas de
> almacenes, permisos ni roles completos. La autorización contextual se resuelve
> en PostgreSQL mediante memberships y funciones de autorización.
> Fuente de verdad: `RLS_STRATEGY.md` v2.0 §3.

```json
{
  "aud": "authenticated",
  "exp": 1700000000,
  "iat": 1699999100,
  "iss": "https://project.supabase.co/auth/v1",
  "sub": "auth-user-uuid",
  "role": "authenticated",
  "email": "user@company.com",
  "app_metadata": {
    "tenant_id": "tenant-uuid",
    "tenant_wide_access": false
  },
  "user_metadata": {
    "full_name": "John Doe",
    "locale": "es",
    "timezone": "America/Costa_Rica"
  }
}
```

#### 2.3.1 Claims y su origen

| Claim | Tipo | Origen | Obligatorio |
|-------|------|--------|-------------|
| `sub` | uuid | Supabase Auth (identificador auth del usuario) | Sí |
| `role` | string | Supabase Auth (`authenticated`) | Sí |
| `aud`, `exp`, `iat`, `iss` | — | Supabase Auth (estándar) | Sí |
| `app_metadata.tenant_id` | uuid | Custom Access Token Hook | Sí |
| `app_metadata.tenant_wide_access` | boolean | Custom Access Token Hook | Sí (default `false`) |

`sub` es el identificador de **Supabase Auth**, no `core.users.id`. La identidad de
negocio se resuelve en PostgreSQL vía `core.users.auth_id = sub`.

#### 2.3.2 Lo que NO va en el JWT

| Excluido | Razón |
|----------|-------|
| `warehouse_ids` | Un usuario con 200 almacenes infla el token más allá de límites prácticos de cabecera HTTP. Se lee de `core.user_warehouse_access` en cada query. |
| `company_ids`, `country_ids` | Mismo motivo. Se resuelven en PostgreSQL. |
| `permissions` | El token se refresca cada 15 minutos: revocar un permiso no surtiría efecto inmediato. Se evalúan en la capa de aplicación consultando la BD. |
| `roles` completos | Mismo motivo que permissions. |
| Módulos contratados | Se verifican en la capa de aplicación contra `core.tenants.limits`. |
| Datos sensibles (fiscales, PII adicional) | Los JWT son legibles por el cliente. |

#### 2.3.3 Revocación inmediata

Al ser el JWT mínimo, la revocación de accesos surte efecto en el **siguiente request**,
sin esperar el refresh del token:

- Revocar acceso a un almacén → `UPDATE core.user_warehouse_access SET revoked_at = now()`
  → la función `core.accessible_warehouse_ids()` deja de retornarlo → RLS deniega.
- Revocar un permiso → se elimina de `core.user_role_assignments` → el evaluador de
  permisos de la capa de aplicación deja de concederlo.

#### 2.3.4 TTL del access token

Decisión **DR-013 (Fase 0)**: el access token tiene TTL corto (15 minutos) y **no se
implementa `membership_version`**. La autorización contextual se consulta en PostgreSQL
en cada request, de modo que `revoked_at` tiene efecto inmediato vía RLS sin necesidad
de un mecanismo de invalidación de token. `membership_version` queda pospuesto hasta
que exista un mecanismo real de verificación o revocación que lo justifique.

### 2.3.5 Custom Access Token Hook

La implementación principal es una **función PostgreSQL PL/pgSQL** registrada como
Custom Access Token Hook de Supabase Auth. No es una Edge Function.

| Propiedad | Valor | Razón |
|-----------|-------|-------|
| Lenguaje | PL/pgSQL | Sin salto de red, ejecuta dentro de la BD |
| `SECURITY DEFINER` | Sí | Debe leer `core.users` sin que el caller necesite SELECT directo |
| `search_path` | `''` (vacío) | Previene schema path hijacking |
| Volatilidad | `STABLE` | No modifica datos |
| Ejecución concedida a | `supabase_auth_admin` únicamente | Es el único invocador legítimo |
| Ejecución revocada de | `PUBLIC`, `anon`, `authenticated` | Nadie más debe invocarla |
| Comportamiento ante falta de membresía activa | Retorna el evento sin modificar (fail-secure) | Sin `tenant_id` en el token, RLS deniega todo |
| Complejidad | 1 query | Se ejecuta en cada emisión de token |

Contrato de la función:
1. Recibe el evento `JSONB` de Supabase Auth.
2. Extrae `sub` de `event -> 'claims'`.
3. Resuelve la membresía activa en `core.users` (status active, no borrado).
4. Conserva **todos** los claims obligatorios de Supabase.
5. Agrega `app_metadata.tenant_id` y `app_metadata.tenant_wide_access`.
6. No agrega listas de almacenes, permisos completos ni información sensible.
7. Si no hay membresía activa, devuelve el evento intacto.

El esquema de referencia de la función está en `DECISION_REGISTER.md` §B.

**Cuándo usar Edge Functions en su lugar:** solo para hooks que requieran consultar
servicios externos (validación contra un IdP corporativo, verificación antifraude,
enriquecimiento desde una API de terceros). Ningún hook de Fase 0 lo requiere.

### 2.4 Políticas de Contraseña (Configurable por Tenant)

| Parámetro | Default | Rango |
|-----------|---------|-------|
| Longitud mínima | 10 caracteres | 8-20 |
| Requiere mayúscula | Sí | Configurable |
| Requiere minúscula | Sí | Configurable |
| Requiere número | Sí | Configurable |
| Requiere carácter especial | Sí | Configurable |
| Historial de contraseñas | 5 últimas | 0-10 |
| Expiración | 90 días | 30-365 o nunca |
| Bloqueo por intentos fallidos | 5 intentos | 3-10 |
| Duración del bloqueo | 30 minutos | 5 min - 24h |
| Timeout de sesión | 8 horas | 1h - 24h |

### 2.5 Protección contra Ataques

| Ataque | Mitigación |
|--------|-----------|
| Brute Force | Rate limiting + account lockout |
| Credential Stuffing | Rate limiting por IP + CAPTCHA tras N fallos |
| Session Hijacking | Refresh token rotation + fingerprinting |
| Token Theft | Short-lived access tokens (15 min) |
| Replay Attack | JWT nonce + timestamp validation |
| CSRF | SameSite cookies + CSRF token para mutations |

---

## 3. AUTORIZACIÓN

### 3.1 Modelo Híbrido: RBAC + ABAC

```
┌──────────────────────────────────────────────────────────────┐
│              AUTHORIZATION MODEL                              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  RBAC (Role-Based Access Control)                        │ │
│  │  ─────────────────────────────────                       │ │
│  │  • Base del sistema de permisos                          │ │
│  │  • Roles asignados a usuarios                            │ │
│  │  • Permisos asignados a roles                            │ │
│  │  • Scope: global, por compañía, por almacén              │ │
│  │  • Herencia de roles (parent → child)                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  ABAC (Attribute-Based Access Control)                   │ │
│  │  ─────────────────────────────────────                   │ │
│  │  • Extiende RBAC para casos complejos                    │ │
│  │  • Evaluación de atributos en runtime                    │ │
│  │  • Condiciones contextuales:                             │ │
│  │    - Horario de acceso (ej: solo horario laboral)        │ │
│  │    - IP de origen (ej: solo desde red corporativa)       │ │
│  │    - Dispositivo (ej: solo desde dispositivos confiados) │ │
│  │    - Ubicación geográfica                                │ │
│  │    - Estado del recurso (ej: solo ajustar stock pending) │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  DECISIÓN: RBAC primero, ABAC cuando se necesite             │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Roles del Sistema

```
┌──────────────────────────────────────────────────────────────┐
│                    ROLE HIERARCHY                              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  PLATFORM LEVEL (Internos OLO_IA)                             │
│  ├── platform_super_admin: Acceso total a la plataforma       │
│  ├── platform_admin: Gestión de tenants y configuración       │
│  └── platform_support: Soporte técnico con impersonation      │
│                                                               │
│  TENANT LEVEL (Por cada organización cliente)                 │
│  ├── tenant_owner: Dueño del tenant, acceso total             │
│  ├── tenant_admin: Administrador del tenant                   │
│  ├── company_manager: Gestión de una compañía                 │
│  ├── warehouse_manager: Gestión de un almacén                 │
│  ├── warehouse_operator: Operaciones en un almacén            │
│  ├── ai_engineer: Gestión de modelos y datasets               │
│  ├── drone_operator: Operación de drones y misiones           │
│  ├── auditor: Solo lectura + logs de auditoría                │
│  ├── viewer: Solo lectura limitada                            │
│  └── [custom_roles]: Roles personalizados por tenant          │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 Matriz de Permisos

Los permisos siguen el formato: `module:action[:resource]`

| Módulo | Acciones | Ejemplo |
|--------|----------|---------|
| dashboard | read | dashboard:read |
| companies | create, read, update, delete | companies:create |
| warehouses | create, read, update, delete | warehouses:update |
| users | create, read, update, delete, invite | users:invite |
| roles | create, read, update, delete, assign | roles:assign |
| inventory | read, write, count, adjust, approve | inventory:approve |
| products | create, read, update, delete, import | products:import |
| ai_models | create, read, update, delete, deploy | ai_models:deploy |
| datasets | create, read, update, delete, annotate | datasets:annotate |
| inference | execute, read, configure | inference:execute |
| training | create, read, cancel | training:create |
| drones | create, read, update, delete, operate | drones:operate |
| missions | create, read, update, delete, execute | missions:execute |
| integrations | create, read, update, delete, sync | integrations:sync |
| reports | create, read, export, schedule | reports:export |
| audit | read, export | audit:read |
| settings | read, update | settings:update |
| billing | read, update | billing:update |

### 3.4 Scope de Permisos

```
┌──────────────────────────────────────────────────────────────┐
│              PERMISSION SCOPE RESOLUTION                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  User: Juan                                                   │
│  ├── Role: warehouse_manager                                  │
│  │   └── Scope: warehouse_id = "wh-001"                      │
│  │       └── Permisos: inventory:*, products:read,            │
│  │                      reports:read, users:read              │
│  │                                                            │
│  ├── Role: ai_engineer                                        │
│  │   └── Scope: global (todo el tenant)                       │
│  │       └── Permisos: ai_models:*, datasets:*,              │
│  │                      inference:*, training:*               │
│  │                                                            │
│  └── Permission Resolution:                                   │
│      Q: ¿Juan puede ver inventario del warehouse wh-002?      │
│      A: NO. warehouse_manager scope es solo wh-001            │
│                                                               │
│      Q: ¿Juan puede crear un modelo de IA?                    │
│      A: SÍ. ai_engineer tiene scope global                    │
│                                                               │
│      Q: ¿Juan puede crear usuarios?                           │
│      A: NO. Ningún rol le da users:create                     │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.5 Evaluación de Permisos (Algoritmo)

```python
# Conceptual: Permission Evaluation
class PermissionEvaluator:
    async def has_permission(
        self,
        user: AuthUser,
        required_permission: str,
        resource_context: Optional[ResourceContext] = None,
    ) -> bool:
        # 1. Platform admin? → Allow all
        if user.is_platform_admin:
            return True
        
        # 2. Tenant suspended? → Deny all
        if user.tenant_status == TenantStatus.SUSPENDED:
            return False
        
        # 3. Check RBAC
        for assignment in user.role_assignments:
            role = await self.get_role(assignment.role_id)
            
            # Check if role has the permission
            if not role.has_permission(required_permission):
                continue
            
            # Check scope
            if not self._scope_matches(assignment.scope, resource_context):
                continue
            
            # 4. Check ABAC conditions (if any)
            if role.has_abac_conditions(required_permission):
                if not await self._evaluate_abac(
                    role.get_conditions(required_permission),
                    user,
                    resource_context,
                ):
                    continue
            
            return True  # Permission granted
        
        return False  # No matching role/permission found
    
    def _scope_matches(
        self, scope: AssignmentScope, context: Optional[ResourceContext]
    ) -> bool:
        if scope.type == ScopeType.GLOBAL:
            return True
        if scope.type == ScopeType.COMPANY and context:
            return scope.company_id == context.company_id
        if scope.type == ScopeType.WAREHOUSE and context:
            return scope.warehouse_id == context.warehouse_id
        return False
```

> **Nota (DR-003).** El evaluador consulta roles, permisos y scopes **desde la base de
> datos**, no desde el JWT. Esto es lo que hace posible la revocación inmediata descrita
> en §2.3.3.

---

### 3.6 Roles de Base de Datos y Caminos de Acceso

> **Decisión DR-002 (aprobada).** Tres categorías de acceso, cada una con su rol de
> PostgreSQL. Fuente de verdad: `RLS_STRATEGY.md` v2.0 §2.1.

| Rol | `BYPASSRLS` | Uso | Expuesto al frontend |
|-----|-------------|-----|---------------------|
| `anon` | No | Pre-login. Sin acceso a datos de negocio. | Sí |
| `authenticated` | No | Solicitudes en nombre de un usuario, con su JWT. | Sí |
| `olo_app` | No | Procesos internos sin JWT de usuario, sujetos a RLS. | **Nunca** |
| `service_role` | **Sí** | Operaciones administrativas explícitas y enumeradas. | **Nunca** |
| `postgres` | Sí | Solo migraciones. | **Nunca** |

#### Categoría A — Solicitudes en nombre de usuarios

```
Frontend o Backend con JWT del usuario
  → rol authenticated
  → RLS activo (las políticas leen los claims vía auth.jwt())
```

Aplica a toda operación iniciada por una persona: CRUD de warehouses, ejecutar un conteo,
ver el dashboard, crear un producto. Es el camino por defecto.

#### Categoría B — Procesos internos sujetos a RLS

```
Worker o proceso interno sin JWT de usuario
  → conexión con rol olo_app (LOGIN, NOBYPASSRLS, NOINHERIT)
  → contexto establecido con set_config() parameterizado
  → RLS activo (las políticas leen el GUC vía current_setting())
```

Aplica a: sync de conectores WMS (opera en el contexto del tenant dueño del conector),
generación de reportes programados, procesamiento de la cola de inferencia.

`olo_app` **no** es un reemplazo universal de `authenticated`. Se usa exclusivamente
cuando no existe un JWT de usuario que propagar.

#### Categoría C — Operaciones privilegiadas cross-tenant

```
service_role (BYPASSRLS)
  → únicamente para operaciones administrativas explícitas
  → nunca expuesto al frontend
  → uso mínimo y enumerado
  → auditoría obligatoria de cada invocación
  → funciones o servicios aislados, nunca en el flujo normal
```

Lista exhaustiva para Fase 0:

| Operación | Justificación |
|-----------|--------------|
| Provisioning de nuevo tenant | Crea el tenant antes de que exista contexto |
| Suspensión / reactivación de tenant | Cambia estado del propio registro de tenant |
| Métricas agregadas cross-tenant | Dashboard de plataforma |
| Impersonation de soporte | Emite token con `tenant_id` del objetivo |
| Refresh de materialized views globales | Tarea programada de plataforma |

**Regla de decisión:** si una operación puede resolverse con `authenticated`, o con
`olo_app` más contexto, no se usa `service_role`.

---

## 4. PROTECCIÓN DE DATOS

### 4.1 Datos en Tránsito

| Mecanismo | Aplicación |
|-----------|-----------|
| TLS 1.3 | Toda comunicación HTTP |
| HSTS | Force HTTPS en navegadores |
| Certificate Pinning | Para conexiones mobile (futuro) |
| mTLS | Comunicación entre servicios internos (futuro) |

### 4.2 Datos en Reposo

| Dato | Encriptación | Método |
|------|-------------|--------|
| Contraseñas | Hash irreversible | bcrypt (cost 12) |
| Tokens de integración | Encriptado | AES-256-GCM |
| API Keys | Hash + Encriptado | SHA-256 (verificación) + AES (display) |
| Datos sensibles de tenant | Encriptado por columna | pgcrypto / application-level |
| Backups | Encriptados | AES-256 (Supabase managed) |
| Storage files | Encriptados | Server-side encryption |

### 4.3 Datos Sensibles

```
┌──────────────────────────────────────────────────────────────┐
│              SENSITIVE DATA CLASSIFICATION                     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  CRITICAL (Encriptado + Audit + Access restricted)            │
│  ├── Credenciales de integración WMS                          │
│  ├── API Keys de terceros                                     │
│  ├── Tokens de acceso almacenados                             │
│  └── Datos de facturación/pago                                │
│                                                               │
│  HIGH (Encriptado selectivo + Audit)                          │
│  ├── Datos fiscales de compañías                              │
│  ├── Información personal de usuarios                         │
│  ├── Configuraciones de seguridad                             │
│  └── Logs de auditoría                                        │
│                                                               │
│  MEDIUM (RLS + Audit)                                         │
│  ├── Datos de inventario                                      │
│  ├── Resultados de inferencia                                 │
│  ├── Datos de misiones de drones                              │
│  └── Configuraciones operativas                               │
│                                                               │
│  LOW (RLS)                                                    │
│  ├── Catálogos de productos                                   │
│  ├── Estructuras organizacionales                             │
│  └── Configuraciones de UI                                    │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. PROTECCIÓN DE API

### 5.1 Rate Limiting

| Tier | Requests/min | Burst | Scope |
|------|-------------|-------|-------|
| Anonymous | 20 | 30 | Por IP |
| Authenticated (Starter) | 60 | 100 | Por API Key/User |
| Authenticated (Pro) | 300 | 500 | Por API Key/User |
| Authenticated (Enterprise) | 1000 | 2000 | Por API Key/User |
| Internal | Unlimited | - | Servicios internos |

### 5.2 Headers de Seguridad

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0 (disabled, rely on CSP)
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store (for sensitive endpoints)
```

### 5.3 Input Validation

```python
# Toda entrada validada con Pydantic (strict mode)
class CreateWarehouseRequest(BaseModel):
    model_config = ConfigDict(strict=True)
    
    name: str = Field(min_length=2, max_length=100, pattern=r'^[\w\s\-]+$')
    code: str = Field(min_length=2, max_length=20, pattern=r'^[A-Z0-9\-]+$')
    company_id: UUID
    timezone: str  # validated against IANA DB
    currency: str = Field(pattern=r'^[A-Z]{3}$')  # ISO 4217
    
    @field_validator('timezone')
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        if v not in pytz.all_timezones:
            raise ValueError(f'Invalid timezone: {v}')
        return v
```

### 5.4 Protección OWASP Top 10

| Vulnerabilidad | Mitigación |
|---------------|-----------|
| A01: Broken Access Control | RLS + RBAC + Middleware + Tests |
| A02: Cryptographic Failures | TLS 1.3 + AES-256 + bcrypt |
| A03: Injection | SQLAlchemy ORM + Pydantic validation + parameterized queries |
| A04: Insecure Design | Threat modeling + Security reviews |
| A05: Security Misconfiguration | Infrastructure as Code + Security headers + minimal exposure |
| A06: Vulnerable Components | Dependency scanning (Dependabot/Snyk) + pinned versions |
| A07: Auth Failures | Supabase Auth + MFA + lockout + rate limiting |
| A08: Data Integrity | Input validation + HMAC + audit trail |
| A09: Logging Failures | Structured logging + centralized aggregation + alerts |
| A10: SSRF | Whitelist URLs + no user-controlled URLs in server requests |

---

## 6. AUDITORÍA

### 6.1 Eventos Auditados

| Categoría | Eventos | Retención |
|-----------|---------|-----------|
| Authentication | Login, logout, failed login, password change, MFA enable/disable | 2 años |
| Authorization | Permission denied, role change, impersonation | 2 años |
| Data Access | Read sensitive data, export data, bulk download | 1 año |
| Data Mutation | Create, update, delete en cualquier entidad | 2 años |
| Configuration | Settings change, integration config, security policy change | 5 años |
| System | Service start/stop, migration, deployment | 1 año |
| Integration | Sync start/end, API calls to/from external | 1 año |
| AI Operations | Training start/end, inference, model deploy | 1 año |

### 6.2 Formato de Evento de Auditoría

```json
{
  "id": "evt-uuid",
  "tenant_id": "tenant-uuid",
  "timestamp": "2026-07-28T10:30:00Z",
  "actor": {
    "id": "user-uuid",
    "email": "user@company.com",
    "type": "user",
    "ip_address": "192.168.1.100",
    "user_agent": "Mozilla/5.0...",
    "session_id": "session-uuid",
    "is_impersonated": false
  },
  "action": {
    "category": "data_mutation",
    "type": "update",
    "module": "inventory",
    "resource_type": "stock_record",
    "resource_id": "stock-uuid"
  },
  "changes": {
    "before": { "quantity": 100 },
    "after": { "quantity": 95 },
    "changed_fields": ["quantity"]
  },
  "context": {
    "warehouse_id": "wh-uuid",
    "correlation_id": "req-uuid",
    "reason": "Physical count adjustment"
  }
}
```

### 6.3 Inmutabilidad de Logs

> **Corregido (DR-002).** La versión anterior de esta sección usaba los roles
> `api_user`, `service_user`, `audit_reader` y `audit_writer`. **Esos roles no existen
> en Supabase ni se crean en ningún documento**, por lo que el SQL fallaba al ejecutarse.
> Los roles reales están definidos en §3.6 y en `RLS_STRATEGY.md` v2.0 §2.1.

```sql
-- Tabla de auditoría: APPEND ONLY
-- RLS y políticas completas en RLS_STRATEGY.md v2.0 §5.4

ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE  ROW LEVEL SECURITY;

-- Lectura: solo del propio tenant
-- Escritura: solo el backend (olo_app), nunca el frontend
-- Sin políticas UPDATE/DELETE + revocación de privilegios de tabla
REVOKE UPDATE, DELETE ON audit.events FROM authenticated, olo_app;
```

#### 6.3.1 Alcance real de esta inmutabilidad

Es importante ser preciso sobre qué garantiza y qué no:

| Rol | ¿Puede modificar audit.events? | Por qué |
|-----|-------------------------------|---------|
| `authenticated` | No | Sin política UPDATE/DELETE + REVOKE |
| `olo_app` | No (solo INSERT) | Sin política UPDATE/DELETE + REVOKE |
| `service_role` | **Sí** | Tiene `BYPASSRLS` |
| `postgres` | **Sí** | Superusuario |

La inmutabilidad frente a `service_role` y `postgres` exige que sus credenciales no
estén al alcance del código de aplicación (§7.2), más archivado externo con verificación
de integridad. Documentar la tabla como "imposible de modificar" sin esta salvedad
sería inexacto.

---

## 7. SEGURIDAD DE INFRAESTRUCTURA

### 7.1 Network Security

```
┌──────────────────────────────────────────────────────────────┐
│              NETWORK SECURITY LAYERS                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  INTERNET                                                     │
│       │                                                       │
│       ▼                                                       │
│  [CloudFlare/CDN] ← DDoS protection, WAF, bot detection      │
│       │                                                       │
│       ▼                                                       │
│  [Load Balancer] ← TLS termination, health checks            │
│       │                                                       │
│       ▼                                                       │
│  [Application Tier] ← Private subnet, no public IP           │
│       │                                                       │
│       ▼                                                       │
│  [Database Tier] ← Private subnet, no internet access        │
│                     Only accessible from application tier      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Secrets Management

| Secret | Almacenamiento | Rotación |
|--------|---------------|----------|
| Database credentials | Environment variables / Vault | 90 días |
| JWT signing key | Supabase managed | Automática |
| API Keys (internos) | Environment variables | 180 días |
| Integration credentials | Encrypted in DB (AES-256) | Por tenant |
| Storage keys | Supabase managed | Automática |
| Encryption keys | Key Management Service | Anual |

### 7.3 Container Security

| Control | Implementación |
|---------|---------------|
| Base images | Alpine Linux / Distroless (minimal attack surface) |
| Non-root | Contenedores ejecutan como non-root user |
| Read-only FS | Filesystem read-only donde sea posible |
| No privileged | Nunca --privileged flag |
| Scanning | Image scanning en CI (Trivy/Grype) |
| Signing | Image signing (cosign) para verificar integridad |
| Resources | Limits de CPU/memory para prevenir DoS |

---

## 8. INCIDENT RESPONSE

### 8.1 Severidades

| Severidad | Definición | Response Time | Ejemplo |
|-----------|-----------|---------------|---------|
| SEV-1 Critical | Breach confirmado, datos expuestos | < 15 min | Data leak, unauthorized access |
| SEV-2 High | Vulnerabilidad activamente explotada | < 1 hora | DDoS, credential stuffing |
| SEV-3 Medium | Vulnerabilidad descubierta, no explotada | < 4 horas | CVE en dependencia |
| SEV-4 Low | Mejora de seguridad recomendada | < 1 semana | Header faltante |

### 8.2 Playbook de Respuesta

```
1. DETECT → Alertas, monitoring, reporte de usuario
2. CONTAIN → Aislar sistema afectado, revocar credenciales
3. ASSESS → Determinar alcance y impacto
4. NOTIFY → Informar stakeholders según severidad
5. REMEDIATE → Fix y deploy de corrección
6. RECOVER → Restaurar servicio normal
7. POST-MORTEM → Análisis de causa raíz, mejoras
```

---

## 9. COMPLIANCE

### 9.1 Regulaciones Consideradas

| Regulación | Aplicabilidad | Requisitos Clave |
|-----------|--------------|-----------------|
| GDPR | Clientes EU | Consentimiento, derecho al olvido, DPO |
| SOC 2 Type II | Todos | Controles de seguridad auditados |
| ISO 27001 | Enterprise | ISMS implementado |
| PCI DSS | Si maneja pagos | Seguridad de datos de tarjetas |
| Ley de Protección de Datos (local) | Por país | Varía por jurisdicción |

### 9.2 Capacidades de Compliance

- **Data Residency**: Configurar en qué región se almacenan los datos del tenant.
- **Data Export**: Exportar todos los datos de un tenant (GDPR Art. 20).
- **Right to be Forgotten**: Eliminar completamente datos de un usuario/tenant.
- **Consent Management**: Registro de consentimientos otorgados.
- **Data Processing Records**: Log de todo procesamiento de datos personales.
- **Breach Notification**: Mecanismo para notificar en < 72 horas (GDPR).

---

## 10. SECURITY TESTING

### 10.1 Testing Continuo

| Tipo | Frecuencia | Herramienta | Scope |
|------|-----------|-------------|-------|
| SAST (Static Analysis) | Cada PR | Semgrep, Bandit | Código fuente |
| DAST (Dynamic Analysis) | Semanal | OWASP ZAP | API endpoints |
| Dependency Scan | Cada PR | Dependabot, Snyk | Dependencias |
| Container Scan | Cada build | Trivy | Docker images |
| Secret Scan | Cada commit | git-leaks, truffleHog | Repositorio |
| Penetration Test | Trimestral | Externo | Plataforma completa |
| RLS Isolation Test | Cada PR | Tests automatizados | Base de datos |

### 10.2 Security Tests Automatizados

```python
# Tests obligatorios en cada PR
class TestTenantIsolation:
    """Verify that tenant data isolation is enforced."""
    
    async def test_tenant_a_cannot_access_tenant_b_data(self):
        """Cross-tenant access must be impossible."""
        ...
    
    async def test_rls_blocks_direct_query_without_context(self):
        """Queries without tenant context must return empty."""
        ...
    
    async def test_api_rejects_cross_tenant_resource_ids(self):
        """API must reject resource IDs from other tenants."""
        ...

class TestAuthSecurity:
    """Verify authentication security."""
    
    async def test_expired_token_rejected(self):
        ...
    
    async def test_invalid_signature_rejected(self):
        ...
    
    async def test_brute_force_triggers_lockout(self):
        ...
    
    async def test_locked_user_cannot_login(self):
        ...
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
