# OLO_IA — IDENTIDAD, TENANT ACTIVO Y AUTORIZACIÓN

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Estado:** contrato de implementación. Vinculante.
> **Contiene un único flujo oficial por cada operación.** Donde hay una alternativa, está marcada como *descartada* con el motivo.

---

## 1. REVISIÓN CRÍTICA DE DEC-04

DEC-04 aprobó membresías múltiples. La instrucción es no darlo por bueno. Analizo las dos opciones y recomiendo una.

### 1.1 El hecho técnico que decide el análisis

**Supabase Auth impone unicidad global de email sobre `auth.users`** (índice único parcial sobre `email` para usuarios no-SSO). Un email = un `auth.users`, por proyecto.

Esto invalida la ventaja principal que se le atribuye al modelo A. `DATABASE_DESIGN.md:226` declara `UNIQUE (tenant_id, email)`, es decir: dos tenants podrían tener cada uno un usuario `juan@acme.com`. **No pueden.** Cada fila de `core.users` se corresponde 1:1 con una de `auth.users` vía `auth_id`, y dos filas de `core.users` con el mismo email exigirían dos `auth.users` con el mismo email, que Supabase rechaza.

Consecuencia: **bajo el modelo A el email ya es global de hecho**, impuesto por la capa de autenticación. El `UNIQUE (tenant_id, email)` no es una capacidad, es una constraint que permite lo que otra capa prohíbe — el peor tipo de constraint, porque el fallo aparece en el registro de Supabase Auth y no en la base de datos donde se validó.

### 1.2 Modelo A — un usuario pertenece a un solo tenant

| Dimensión | Evaluación |
|---|---|
| **Ventajas** | `core.users` conserva `tenant_id`, así que sigue la plantilla RLS estándar como cualquier otra tabla. El Hook es una consulta trivial sin selección. No hace falta cambio de tenant en el frontend. Menos código en Fase 0 |
| **Desventajas** | Una persona que legítimamente opere en dos tenants necesita **dos direcciones de email distintas** (§1.1). No hay forma de saber que son la misma persona: la auditoría los ve como dos actores. Rompe el programa de partners e integradores del `ROADMAP.md` Fase 4 |
| **Impacto técnico** | Mínimo. Es el modelo de `DATABASE_DESIGN.md` v1.0 |
| **Impacto en JWT** | `tenant_id` se deriva de la única fila del usuario. Un claim, sin ambigüedad |
| **Impacto en RLS** | El más simple posible. Plantilla A uniforme en todo `core` |
| **Impacto en UX** | Malo para el caso multi-tenant: dos cuentas, dos contraseñas, dos sesiones, y hay que cerrar una para entrar en la otra |
| **Complejidad** | **Baja** |

### 1.3 Modelo B — un usuario pertenece a varios tenants

| Dimensión | Evaluación |
|---|---|
| **Ventajas** | Una identidad = una persona, que es lo que el email global ya impone. La auditoría atribuye correctamente. Habilita integradores, partners y consultores sin trucos de aliasing. La FK compuesta contra la membresía hace **imposible asignar un rol o un almacén a quien no es miembro del tenant** — garantía que el modelo A no ofrece |
| **Desventajas** | `core.users` pierde `tenant_id` y pasa a ser la **única tabla de `core` sin plantilla RLS estándar**: su política necesita un `EXISTS` sobre membresías, con riesgo de recursión. Introduce el problema del tenant activo (DEC-14). Provisioning con un paso más |
| **Impacto técnico** | Una tabla nueva, dos FK compuestas, una política RLS a medida |
| **Impacto en JWT** | El JWT mínimo lleva **un** `tenant_id`; con N membresías hay que elegir. Es DEC-14 |
| **Impacto en RLS** | Igual que A en todas las tablas de negocio. Solo `core.users` y `core.tenant_memberships` requieren tratamiento propio |
| **Impacto en UX** | Una cuenta, un login, selector de tenant. Mejor cuando hace falta; invisible cuando no |
| **Complejidad** | **Media** |

### 1.4 Coste de migrar A → B más adelante

Es el argumento decisivo, y es asimétrico:

**Migración de datos: trivial y segura.** Por §1.1 no pueden existir emails duplicados entre tenants, así que el backfill es 1:1 — una membresía por usuario existente — y no puede colisionar. Cero riesgo.

**Migración de código: caro.** Cambia la política RLS de `core.users`, el Custom Access Token Hook, la resolución de contexto, el middleware, el contrato de `/v1/auth/me`, y el frontend gana estado de tenant activo. **Todo eso se escribe en Fase 0.** Retrofitear B significa reescribir en Fase 1 lo que se acaba de construir.

Cuando el coste de datos es cero y el coste de código se paga entero por adelantado, la decisión es construir el modelo correcto ahora.

### 1.5 Recomendación: **MODELO B**, en dos etapas

Se implementa B. No se implementa A.

Pero B se despliega en dos etapas, y **la etapa 1 elimina DEC-14 de la ruta crítica** en lugar de resolverlo por decisión:

**Etapa 1 — Fase 0 y Fase 1.** El esquema es el de B completo: `core.users` global, `core.tenant_memberships`, FK compuestas de autorización contra la membresía. Y se añade **una restricción de base de datos** que limita a **una membresía activa por usuario**:

```sql
CREATE UNIQUE INDEX uq_membership_one_active_per_user
    ON core.tenant_memberships (user_id)
    WHERE revoked_at IS NULL AND status = 'active';
```

Con esa restricción, «cuál es el tenant activo» **no tiene ambigüedad posible**: hay exactamente una membresía activa, y el Hook la resuelve sin necesidad de `active_tenant_id`, sin endpoint de cambio de tenant y sin estado adicional en el frontend. DEC-14 deja de ser una decisión pendiente porque la pregunta no se puede plantear.

**Etapa 2 — cuando exista el primer usuario multi-tenant real** (programa de partners, Fase 4, o antes si aparece un integrador). El cambio es:

1. `DROP INDEX uq_membership_one_active_per_user;`
2. Añadir `core.users.active_tenant_id UUID` con FK compuesta a la membresía.
3. El Hook lee `active_tenant_id` en vez de «la única activa».
4. Nuevo endpoint `POST /v1/auth/switch-tenant` que lo actualiza y fuerza refresh del token.
5. El frontend añade el selector.

**Nada de esto toca el esquema de `core.users`, `tenant_memberships`, `role_assignments` ni `user_warehouse_access`. Ninguna política RLS cambia.** Es exactamente la propiedad que se busca: la etapa 2 es aditiva.

### 1.6 Por qué esto no es el modelo A disfrazado

Distinción que importa, porque es la trampa en la que sería fácil caer:

| | Modelo A | Etapa 1 de B |
|---|---|---|
| `core.users.tenant_id` | Existe | **No existe** |
| Unicidad de email | `(tenant_id, email)` — engañosa | `(email)` — coincide con `auth.users` |
| `tenant_memberships` | No existe | **Existe, con datos** |
| Autorización anclada a membresía por FK | No | **Sí** |
| Política RLS de `core.users` | Plantilla estándar | **A medida, la definitiva** |
| Pasar a multi-tenant | Migración de esquema y reescritura de RLS | `DROP INDEX` + 1 columna + 1 endpoint |

La etapa 1 escribe la versión definitiva de todo lo estructural. La restricción de unicidad es una **política operativa**, no una decisión de modelo, y por eso se puede levantar con una sentencia.

---

## 2. TENANT ACTIVO — FLUJO OFICIAL ÚNICO

Válido para la etapa 1. Los puntos donde la etapa 2 se engancha están marcados **[E2]**.

### 2.1 Resolución del tenant

**Regla única:** el tenant activo de una sesión es el de la membresía activa del usuario, y viaja en el claim `app_metadata.tenant_id` del JWT. Ningún otro mecanismo es autoritativo.

Prohibido explícitamente:
- Que el cliente envíe `tenant_id` en cuerpo, query o cabecera. El backend lo ignora si llega.
- Derivar el tenant de un `warehouse_id` recibido.
- Cachear el tenant en el frontend como fuente de verdad; el JWT lo es.

### 2.2 Login

```
1. Cliente → POST /v1/auth/login {email, password}
2. Backend → Supabase Auth (GoTrue) signInWithPassword
3. GoTrue autentica y, antes de firmar el token, invoca el
   Custom Access Token Hook (§4.4)
4. El Hook resuelve la membresía activa y añade a app_metadata:
      tenant_id            uuid
      tenant_wide_access   boolean
   Si NO hay membresía activa → NO añade claims (fail-secure)
5. GoTrue firma y devuelve access_token (1 h) + refresh_token
6. Backend registra AuditEvent 'auth.login' y devuelve los tokens
7. Cliente almacena los tokens y llama GET /v1/auth/me
```

**Usuario sin membresía activa:** el login **tiene éxito** en GoTrue —la identidad es válida— pero el JWT sale sin `tenant_id`. Toda consulta posterior devuelve cero filas porque `core.current_tenant_id()` es NULL. El backend detecta la ausencia del claim en el middleware y responde `403 NO_ACTIVE_MEMBERSHIP` con un mensaje accionable, en lugar de dejar que el usuario vea una aplicación vacía.

### 2.3 Refresh

```
1. Cliente detecta 401 o access_token próximo a expirar
2. Cliente → POST /v1/auth/refresh {refresh_token}
3. GoTrue valida, rota el refresh_token y REINVOCA el Hook
4. El nuevo access_token lleva claims RECALCULADOS
```

**Propiedad que esto da y hay que documentar:** revocar una membresía surte efecto **en el siguiente refresh**, como máximo 1 hora. Los permisos, en cambio, son inmediatos porque no viajan en el token (§4.2). Son dos latencias distintas y deliberadas:

| Qué cambia | Latencia | Por qué |
|---|---|---|
| Permisos y roles | **Inmediata** | Se resuelven en BD por request |
| Acceso a almacenes | **Inmediata** | Se resuelve en BD por RLS |
| Membresía de tenant | ≤ 1 h (hasta el refresh) | Va en el JWT |
| `tenant_wide_access` | ≤ 1 h | Va en el JWT |

Para revocación inmediata de membresía existe la vía dura: `POST /v1/admin/users/{id}/revoke-sessions`, que invalida los refresh tokens en GoTrue. Se usa en incidentes, no en la operación normal.

### 2.4 Cambio de tenant **[E2]**

No existe en la etapa 1: la restricción de una membresía activa lo hace imposible. Cuando se habilite:

```
1. Cliente → POST /v1/auth/switch-tenant {tenant_id}
2. Backend valida que existe membresía activa del usuario en ese tenant
   → si no, 403. Nunca 404: no se revela si el tenant existe
3. Backend actualiza core.users.active_tenant_id
4. Backend registra AuditEvent 'auth.tenant_switched'
5. Backend fuerza refresh: el cliente llama /v1/auth/refresh
6. El Hook lee active_tenant_id y emite el nuevo tenant_id
7. Frontend invalida TODA la caché de React Query
```

El paso 7 no es opcional. Sin él se muestran datos del tenant anterior, y ese bug es indistinguible de una fuga de datos.

### 2.5 Cambio de almacén

**No toca el JWT.** El almacén no es contexto de seguridad, es contexto de consulta: RLS ya limita a los almacenes accesibles vía `core.user_warehouse_access`, así que seleccionar uno solo estrecha lo que ya está permitido.

```
1. Frontend actualiza tenantStore.currentWarehouseId
2. Toda petición envía X-Warehouse-Id
3. El middleware VALIDA la cabecera contra
   core.accessible_warehouse_ids() → si no está, 403
4. El almacén entra en la queryKey de React Query, así que
   cambiarlo invalida las consultas afectadas
```

**El punto 3 es obligatorio.** `X-Warehouse-Id` es entrada del cliente. Sin validación explícita sería una pista de scope no verificada — el mismo defecto que se prohíbe para `tenant_id`. Que RLS lo cubra igualmente no exime: se valida para poder devolver un 403 claro en vez de una lista vacía inexplicable.

### 2.6 Realtime

```
1. Frontend abre el canal con el access_token del usuario
2. Realtime valida el JWT y ejecuta como rol `authenticated`
3. request.jwt.claims queda poblado por Realtime
4. core.current_tenant_id() lee el claim → RLS filtra
```

Requisitos, no recomendaciones:
- Solo canales de **postgres_changes** sobre tablas con RLS activo. **Prohibido** `broadcast` sin autorización propia: no pasa por RLS.
- Al expirar el token hay que reconectar con el nuevo. El cliente de Supabase lo hace con `setAuth()`; hay que llamarlo tras cada refresh o el canal sigue con el tenant viejo.
- Tablas expuestas por Realtime en Fase 0: **ninguna**. Se habilita en Fase 1 con `inventory.balances` e `inventory.incidents`.

### 2.7 Storage

```
1. Cliente → POST /v1/files/presign {filename, content_type, size, resource_type}
2. Backend valida tipo y tamaño contra la allowlist del servidor
   (el `size` del cliente es informativo; el límite lo impone el bucket)
3. Backend crea core.files con status='pending' y
   storage_path = 'tenants/{tenant_id}/{resource_type}/{file_id}/{nombre_saneado}'
   → el CHECK chk_files_path_tenant garantiza el prefijo (verificado)
4. Backend devuelve URL firmada de subida, TTL 5 min
5. Cliente sube directo a Storage
6. Cliente → POST /v1/files/{id}/confirm
7. Backend CONSULTA Storage para verificar que el objeto existe,
   su tamaño real y su content-type. Solo entonces status='confirmed'
```

El paso 7 es lo que cierra ALTO-10: sin verificar contra Storage, un cliente puede confirmar un archivo que nunca subió o mentir sobre su tipo.

Políticas de Storage: bucket privado, y política que solo permite operar bajo `tenants/{tenant_id}/` donde `tenant_id` sale del claim. La lectura se sirve siempre con URL firmada de vida corta emitida por el backend, **nunca con URL pública**.

### 2.8 Backend, workers y background jobs

| Actor | Rol PG | Contexto | Origen del tenant |
|---|---|---|---|
| Petición de usuario | `authenticated` | `SET LOCAL request.jwt.claims` + `SET LOCAL ROLE` | Claim del JWT recibido |
| Worker con dueño | `olo_app` | `set_config('app.tenant_id', ...)` | Columna `tenant_id` del job |
| Tarea de plataforma | `service_role` | Ninguno (bypasea RLS) | Explícito, y **auditado siempre** |

Un worker **nunca** infiere el tenant. Lo lee de la fila del trabajo que procesa. Un job sin `tenant_id` es un error de programación y debe fallar, no adivinar.

### 2.9 Webhooks salientes

Fase 4, pero el contrato se fija ahora porque condiciona el modelo de `platform.jobs`:

- Se despachan por el JobDispatcher, con `tenant_id` del suscriptor.
- Firma `HMAC-SHA256` del cuerpo con el secreto de la suscripción, en cabecera `X-OLO-Signature`, más `X-OLO-Timestamp` para evitar replay.
- Reintentos con backoff exponencial, máximo 5, y a dead-letter después.
- El secreto se guarda cifrado, nunca en claro.

---

## 3. AUTORIZACIÓN — FLUJO OFICIAL ÚNICO

### 3.1 Los dos canales (DEC-02)

```
CANAL A — el cliente habla directo con Supabase
  Frontend ──► PostgREST / Realtime / Storage
              rol: authenticated
              contexto: request.jwt.claims (lo pone Supabase)
              uso: lecturas y suscripciones filtradas por RLS

CANAL B — el cliente habla con el backend
  Frontend ──► FastAPI ──► PostgreSQL
              rol: authenticated (peticiones de usuario)
                   olo_app     (workers sin usuario)
              contexto: SET LOCAL dentro de transacción explícita
              uso: TODA escritura, toda lógica de negocio,
                   toda operación privilegiada
```

**Regla de reparto, sin excepciones:** el canal A es **solo lectura**. Toda mutación va por el canal B. No se conceden `INSERT`/`UPDATE`/`DELETE` a `authenticated` vía PostgREST sobre ninguna tabla de negocio.

Motivo: la lógica de negocio, la auditoría, la idempotencia y el optimistic locking viven en la capa de aplicación. Una escritura que entre por PostgREST se los salta todos. RLS protegería el aislamiento, pero no la corrección.

### 3.2 Qué va en el JWT y qué no

**Va** (DEC-03, CONF-06):

| Claim | Origen | Por qué |
|---|---|---|
| `sub` | GoTrue | Identidad externa. Es `auth.users.id` |
| `role` | GoTrue | Siempre `authenticated` |
| `app_metadata.tenant_id` | Hook | Contexto de aislamiento. Lo necesita el canal A |
| `app_metadata.tenant_wide_access` | Hook | Booleano explícito. Default `false`, fail-secure |

**No va, y por qué:**

| Excluido | Motivo |
|---|---|
| `core.users.id` | CONF-06. Se resuelve por `auth_id`. Un id de más en el token es superficie sin beneficio |
| `warehouse_ids` | Revocación diferida hasta el refresh y bloat: un usuario con 200 almacenes infla la cabecera |
| `permissions` | `RF-RBAC-007` exige efecto inmediato. En el token serían hasta 1 h de retraso |
| `roles` | Igual que permisos |
| `company_ids`, `country_ids` | Derivables. No son contexto de seguridad |
| Módulos contratados | Se verifican en aplicación |
| Email, nombre, datos fiscales | El JWT es legible por el cliente. No se mete nada que no haga falta para autorizar |

### 3.3 Funciones de contexto — contrato

Siete funciones. Ninguna más. Toda política RLS se escribe con estas.

| Función | Retorno | Volatilidad | SECURITY | Resuelve |
|---|---|---|---|---|
| `core.current_auth_id()` | `uuid` | STABLE | INVOKER | `auth.uid()` → GUC `app.auth_user_id` |
| `core.current_user_id()` | `uuid` | STABLE | **DEFINER** | `core.users.id` desde `auth_id` |
| `core.current_tenant_id()` | `uuid` | STABLE | INVOKER | claim del JWT → GUC `app.tenant_id` |
| `core.has_active_membership()` | `boolean` | STABLE | **DEFINER** | Membresía activa en el tenant actual |
| `core.has_tenant_wide_access()` | `boolean` | STABLE | INVOKER | claim → GUC. Default `false` |
| `core.accessible_warehouse_ids()` | `uuid[]` | STABLE | **DEFINER** | Almacenes del usuario. Nunca NULL |
| `core.can_access_warehouse(uuid)` | `boolean` | STABLE | INVOKER | Predicado único de scope de almacén |

Reglas obligatorias para las siete:
- `SET search_path = ''` **siempre**. Sin excepción. Es el hallazgo `function_search_path_mutable` del linter y un vector de escalada real.
- `STABLE`, nunca `VOLATILE`: se evalúan una vez por sentencia, no una vez por fila.
- `SECURITY DEFINER` **solo** en las tres marcadas, y por un motivo concreto: deben leer una tabla cuya política RLS las invocaría de vuelta. Es la única justificación aceptable.
- Las tres `DEFINER` filtran internamente por el contexto actual. Ahí está su seguridad, no en el rol.
- `core.current_tenant_id()` lee `current_setting('request.jwt.claims', true)` **directamente**, no vía `auth.jwt()`. Comportamiento idéntico en Supabase y **portable a PostgreSQL sin schema `auth`** (verificado), lo que permite ejecutar la suite de aislamiento sin el stack completo.
- Precedencia verificada: **JWT sobre GUC**. Si ambos están presentes gana el JWT.

### 3.4 Custom Access Token Hook

Función PL/pgSQL (DR-012). No Edge Function: no consulta servicios externos.

```
ENTRADA:  event jsonb con event->'claims'
SALIDA:   event con claims aumentados

1. v_auth_id := (event->'claims'->>'sub')::uuid
2. Buscar la membresía activa:
     SELECT m.tenant_id,
            EXISTS(...rol con tenant_wide...) 
       FROM core.users u
       JOIN core.tenant_memberships m ON m.user_id = u.id
      WHERE u.auth_id = v_auth_id
        AND u.deleted_at IS NULL
        AND m.revoked_at IS NULL
        AND m.status = 'active'
     -- Etapa 1: la restricción de unicidad garantiza 0 o 1 fila
     -- [E2]: añadir AND m.tenant_id = u.active_tenant_id
3. Si no hay fila → RETURN event SIN MODIFICAR   ← fail-secure
4. Inicializar app_metadata SI NO EXISTE:
     IF v_claims->'app_metadata' IS NULL THEN
        v_claims := jsonb_set(v_claims,'{app_metadata}','{}'::jsonb);
     END IF;
5. jsonb_set de tenant_id y tenant_wide_access
6. RETURN jsonb_set(event,'{claims}',v_claims)
```

**El paso 4 es obligatorio y es un defecto real, no una precaución.** `jsonb_set` exige que existan todos los niveles intermedios de la ruta: si `app_metadata` no está, `jsonb_set(claims,'{app_metadata,tenant_id}',...)` devuelve el objeto **sin cambios y sin error**. El resultado sería un JWT válido sin `tenant_id` y RLS denegando todo, en el 100 % de los logins. Es CRIT-11.

Propiedades exigidas:
- `SECURITY DEFINER` + `SET search_path = ''`. Debe leer `core.users` sin depender de los privilegios de `supabase_auth_admin`.
- `STABLE`.
- `REVOKE EXECUTE FROM public, anon, authenticated;` `GRANT EXECUTE TO supabase_auth_admin;`
- Índices que la sostienen: `core.users(auth_id)` y `core.tenant_memberships(user_id) WHERE revoked_at IS NULL`. **La consulta filtra por `user_id` sin `tenant_id`** —aún no lo conoce— así que los índices que empiezan por `tenant_id` no le sirven. Es ALTO-21.
- Presupuesto de latencia: < 50 ms. Corre en cada login y en cada refresh.

### 3.5 Middleware de FastAPI — secuencia obligatoria

```
1. Extraer Bearer token
2. Validar firma contra el JWKS de Supabase (cacheado, TTL 10 min)
   → inválido o expirado ⇒ 401
3. Extraer sub, tenant_id, tenant_wide_access
   → sin tenant_id ⇒ 403 NO_ACTIVE_MEMBERSHIP
4. Si viene X-Warehouse-Id: validar contra accessible_warehouse_ids() ⇒ 403 si no
5. Generar request_id (nuevo) y correlation_id
   (del X-Correlation-Id entrante, o = request_id si no viene)
6. ABRIR TRANSACCIÓN EXPLÍCITA
7. Dentro de la transacción:
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims',  $1, true),
             set_config('app.auth_user_id',    $2, true),
             set_config('app.tenant_id',       $3, true),
             set_config('app.request_id',      $4, true),
             set_config('app.correlation_id',  $5, true);
8. Verificar permiso del endpoint (§3.6)
9. Ejecutar el caso de uso
10. Emitir AuditEvent si hubo mutación
11. COMMIT (o ROLLBACK)
```

Tres reglas que la verificación empírica convirtió en obligaciones:

- **El paso 6 antes del 7, sin excepción.** `SET LOCAL` fuera de transacción explícita es un **no-op silencioso**: el GUC queda vacío, no hay error, y RLS deniega todo. Medido.
- **`set_config` con parámetros ligados, nunca interpolación de cadenas.** El antipatrón de `MULTITENANT.md:212` es inyección SQL y además inútil en autocommit.
- **`is_local => true` en los cinco.** Hace el ajuste de alcance transaccional, lo que es lo que da compatibilidad con el pooler en modo *transaction*: verificado que el contexto **no se filtra** a la siguiente transacción de la misma conexión.

### 3.6 Evaluación de permisos

Formato: `module:action`. Catálogo en `core.permissions` con FK — un permiso mal escrito falla al escribir, no en silencio.

```
has_permission(user_id, tenant_id, 'inventory:approve', ctx) →
  1. ¿tenant suspendido? → false
  2. ¿membresía activa?  → si no, false
  3. Para cada role_assignment del usuario en el tenant:
       a. ¿el rol (o un ancestro) concede el permiso?
       b. ¿el scope de la asignación cubre ctx?
            global    → sí
            company   → assignment.company_id   = ctx.company_id
            warehouse → assignment.warehouse_id = ctx.warehouse_id
       c. si a y b → true
  4. false
```

- Se resuelve **contra la base de datos**, no contra el JWT. Es lo que hace inmediata la revocación (`RF-RBAC-007`).
- Cacheable por (user, tenant) con TTL ≤ 30 s. Con TTL corto no hace falta `membership_version` — cierra DR-013 sin añadir mecanismo.
- La herencia de roles se recorre con `parent_role_id`, con protección de ciclos por trigger y profundidad máxima 16 (verificado).

### 3.7 RPC — funciones expuestas

Regla: **una RPC solo existe si la operación no puede resolverse por el canal B.** En Fase 0 hay dos, y ambas son de plataforma:

| RPC | Rol | Motivo |
|---|---|---|
| `platform.provision_tenant(...)` | `service_role` | Debe crear tenant, membresía y rol en una transacción, antes de que exista contexto de tenant |
| `platform.get_metrics()` | `service_role` | Agregado cross-tenant |

Ambas: `SECURITY DEFINER`, `search_path=''`, verificación de `is_platform_admin` **dentro** de la función, `REVOKE FROM public`, y escritura obligatoria en `platform.privileged_operation_log`. Confiar en que el llamante ya validó es exactamente cómo esto se convierte en una fuga cross-tenant.

### 3.8 Matriz de roles PostgreSQL

| Rol | `BYPASSRLS` | Quién lo usa | Puede escribir |
|---|---|---|---|
| `anon` | No | Pre-login | Nada |
| `authenticated` | No | Canal A y peticiones de usuario del canal B | Nada por PostgREST; todo por FastAPI bajo política |
| `olo_app` | **No** | Workers del canal B | Según política, con contexto por GUC |
| `service_role` | **Sí** | Solo las RPC de §3.7 | Todo, sin RLS. **Nunca expuesto al frontend** |
| `postgres` | Sí | Solo migraciones | Todo |

`olo_app` **no es propietario de ninguna tabla**, y toda tabla de negocio lleva `FORCE ROW LEVEL SECURITY` para que el propietario tampoco se salte las políticas. Contra `BYPASSRLS` no hay defensa técnica: la única compensación es no poner esas credenciales al alcance del código de aplicación y auditar cada uso (`platform.privileged_operation_log`).

---

## 4. LO QUE ESTE DOCUMENTO CIERRA

| Pendiente previo | Resolución |
|---|---|
| **DEC-04** | Modelo B, en dos etapas (§1.5) |
| **DEC-14** | **Disuelto.** La restricción de una membresía activa hace la pregunta improcedente en la etapa 1 |
| **DR-013** `membership_version` | **No se implementa.** TTL de 30 s en la caché de permisos basta (§3.6) |
| **CONF-06** | `current_user_id()` resuelve por `auth_id`; `core.users.id` fuera del JWT (§3.2, §3.3) |
| **ALTO-12** `X-Warehouse-Id` | Validación obligatoria en el middleware (§2.5, paso 4 de §3.5) |
| **ALTO-10** confirmación de upload | Verificación contra Storage antes de `confirmed` (§2.7) |
| **CRIT-11** Hook y `jsonb_set` | Inicialización defensiva de `app_metadata` obligatoria (§3.4) |
| **CRIT-03** claims en el backend | `SET LOCAL ROLE` + `set_config` en transacción explícita (§3.5) |
| **API-09** lockout | Ver `TECHNICAL_IMPLEMENTATION_SPEC.md` §9: clasificado a hardening por DEC-09 |

---

*Contrato de identidad y autorización. Ninguna migración creada. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
