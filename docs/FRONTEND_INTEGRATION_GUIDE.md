# OLO_IA — Guía de integración para el frontend

> **Estado: el primer vertical funciona de extremo a extremo contra Supabase real.**
> 53 pruebas en verde en una sola ejecución, incluido el ciclo
> crear → leer → actualizar → borrar completo. Kiro puede conectar el frontend ya.
>
> Base URL local: `http://127.0.0.1:8000` · OpenAPI: `/docs` y `/openapi.json`

---

## 1. Arrancar el backend

```bash
cd backend
.venv\Scripts\activate
uvicorn --factory olo.main:create_app --reload
```

Si `DATABASE_URL` no es válida, **el arranque falla con un mensaje accionable** en
lugar de arrancar y romper en la primera petición. Lo mismo si el entorno no
tiene base de datos de zonas horarias — ver más abajo.

### Dos usuarios de desarrollo, deliberadamente distintos

| Usuario | Rol | Qué ve | Para qué sirve |
|---|---|---|---|
| `mgr@olo-dev.test` | `warehouse_manager` | **1** almacén de 2 | probar que RLS filtra y que faltan permisos |
| `arojas@ologistics.com` | `tenant_admin` | **los 2** | probar el CRUD completo y `tenant_wide_access` |

El manager **no** tiene `warehouses:create` ni `warehouses:delete`: si pruebas el
botón «Nuevo almacén» con él recibirás **403 FORBIDDEN** y es correcto. Usa el
admin para los flujos de creación y borrado. Las contraseñas van por canal
aparte, no al repositorio.

Ese contraste es intencionado: con un solo usuario todopoderoso, un fallo de RLS
sería invisible.

### CORS: el frontend escucha en el 3000, no en el 5173

`frontend/vite.config.ts` fija `port: 3000` con `strictPort: true`, pero
`CORS_ORIGINS` traía solo el 5173 por defecto de Vite. Con esa combinación el
backend responde perfectamente a `curl` y **el navegador bloquea todas las
llamadas**, con el error en la consola del navegador y nada en los logs del
backend. Ya está corregido; si montas otro puerto, añádelo a `CORS_ORIGINS`.

Comprobación rápida de que el preflight pasa:

```bash
curl -i -X OPTIONS http://127.0.0.1:8000/v1/auth/me \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization"
# Espera 200 y access-control-allow-origin: http://localhost:3000
```

### `tzdata` es obligatorio, no opcional

Si montas el backend en Windows o en una imagen mínima (alpine, distroless),
instala `tzdata`. Ya está en las dependencias, pero conviene saber el síntoma
por si aparece: sin él, `zoneinfo` no encuentra **ninguna** zona y la API
responde `400 VALIDATION_ERROR · Zona horaria desconocida` a `America/Costa_Rica`
y a cualquier otra zona válida. Parecía un error del cliente y no lo era. Ahora
el arranque aborta con un mensaje explícito en lugar de dejar el CRUD inservible.

---

## 2. Los tres endpoints que necesitas primero

### Login

```http
POST /v1/auth/login
{"email": "mgr@olo-dev.test", "password": "..."}
```

```json
{"data": {"access_token": "eyJ…", "refresh_token": "…",
          "token_type": "bearer", "expires_in": 3600, "expires_at": 1790000000}}
```

**No valides la longitud de la contraseña en el formulario de login.** El
endpoint ya no lo hace, y a propósito: tenía un mínimo de 8 caracteres que
rechazaba con `400 VALIDATION_ERROR` cuentas cuya contraseña es válida para el
proveedor de identidad pero más corta. Una contraseña demasiado corta en el
login es simplemente incorrecta, y la respuesta correcta es
`401 INVALID_CREDENTIALS`. La política de longitud se aplica al **crear** y
**cambiar** contraseñas, no al usarlas — ahí sí valídala en el formulario.

**Caso que debes manejar:** un usuario sin membresía activa recibe **200 con
tokens válidos**, pero toda llamada posterior responde `403 NO_ACTIVE_MEMBERSHIP`.
Es deliberado: la identidad es correcta, lo que falta es la pertenencia. Muestra
un mensaje del tipo «tu cuenta no está asociada a ninguna organización», no la
pantalla de login otra vez.

### Perfil, permisos y almacenes

```http
GET /v1/auth/me
Authorization: Bearer <access_token>
```

```json
{"data": {
  "id": "425bdbdc-…", "email": "mgr@olo-dev.test",
  "first_name": "María", "last_name": "Rojas",
  "locale": "es", "timezone": "America/Costa_Rica", "status": "active",
  "tenant": {"id": "d1ae4202-…", "name": "OLO Logistics Demo",
             "slug": "olo-demo", "status": "active", "plan": "professional"},
  "roles": [{"name": "warehouse_manager", "scope_type": "warehouse",
             "scope_warehouse_id": "…"}],
  "permissions": ["areas:read", "areas:write", "dashboard:read",
                  "inventory:adjust", "inventory:approve", "inventory:count",
                  "inventory:read", "inventory:write", "locations:read",
                  "locations:write", "products:read", "products:write",
                  "reports:read", "users:read", "warehouses:read",
                  "warehouses:update"],
  "accessible_warehouse_ids": ["…"],
  "tenant_wide_access": false}}
```

**Llama a `/me` justo después del login y guarda `permissions` en tu store.** Es
la fuente para ocultar botones y menús. No intentes deducir permisos del token:
no están ahí a propósito, para que revocar uno surta efecto de inmediato.

### Listar almacenes

```http
GET /v1/warehouses?limit=20
Authorization: Bearer <access_token>
```

```json
{"data": [{"id": "…", "company_id": "…",
           "name": "Centro de Distribución San José", "code": "WH-001",
           "status": "active", "timezone": "America/Costa_Rica", "locale": "es",
           "currency_code": "CRC", "latitude": 9.9281, "longitude": -84.0907,
           "address": {"city": "San José", "country": "CR"},
           "version": 1, "created_at": "…", "updated_at": "…"}],
 "pagination": {"next_cursor": null, "page_size": 20}}
```

**La lista ya viene filtrada por permisos.** El usuario de desarrollo ve **1** de
los 2 almacenes que existen, y eso lo impone PostgreSQL, no el frontend. No
filtres nada del lado del cliente.

---

## 3. Catálogo completo

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `POST` | `/v1/auth/login` | — | |
| `POST` | `/v1/auth/refresh` | — | rota el refresh token |
| `POST` | `/v1/auth/logout` | — | 204 siempre, incluso con token vencido |
| `GET` | `/v1/auth/me` | — | requiere membresía activa |
| `GET` | `/v1/warehouses` | `warehouses:read` | keyset, filtros, búsqueda |
| `GET` | `/v1/warehouses/{id}` | `warehouses:read` | devuelve `ETag` |
| `POST` | `/v1/warehouses` | `warehouses:create` | |
| `PATCH` | `/v1/warehouses/{id}` | `warehouses:update` | exige `If-Match` |
| `DELETE` | `/v1/warehouses/{id}` | `warehouses:delete` | lógico; exige `If-Match` |
| `GET` | `/health` · `/ready` · `/version` | — | sin auth |

Parámetros de `GET /v1/warehouses`: `limit` (1-100, por defecto 20), `cursor`,
`company_id`, `status`, `search`.

---

## 4. Optimistic locking: el patrón obligatorio

Toda mutación exige el `ETag` que devolvió el GET.

```ts
const get = await api.get(`/v1/warehouses/${id}`);
const etag = get.headers.etag;                    // 'W/"3"'

await api.patch(`/v1/warehouses/${id}`,
  { name: "Nuevo nombre" },
  { headers: { "If-Match": etag } });
```

| Situación | Código | Qué hacer |
|---|---|---|
| Falta `If-Match` | **428** | error de programación, no del usuario |
| La versión no coincide | **412** | releer y avisar: «alguien lo modificó» |

No inventes el ETag ni lo construyas desde `version` a mano: úsalo tal como
llega en la cabecera.

---

## 5. Paginación por cursor

No hay `page`/`offset`. Cuando `next_cursor` no es `null`, hay más:

```ts
let cursor: string | null = null;
do {
  const url = cursor
    ? `/v1/warehouses?limit=50&cursor=${encodeURIComponent(cursor)}`
    : "/v1/warehouses?limit=50";
  const r = await api.get(url);
  render(r.data.data);
  cursor = r.data.pagination.next_cursor;
} while (cursor);
```

---

## 6. Errores: un único formato

```json
{"error": {"code": "VERSION_CONFLICT",
           "message": "El almacén fue modificado por otra operación…",
           "details": {"resource_id": "…", "expected_version": 3},
           "request_id": "8f3a…", "correlation_id": "8f3a…"}}
```

**Muestra el `request_id` en tu pantalla de error.** Es lo que permite encontrar
la traza exacta sin pedirle nada más al usuario.

| Código | HTTP | Significado |
|---|---|---|
| `UNAUTHENTICATED` | 401 | falta el Bearer |
| `INVALID_TOKEN` | 401 | firma inválida o expirado → **refresca** |
| `INVALID_CREDENTIALS` | 401 | email o contraseña incorrectos |
| `NO_ACTIVE_MEMBERSHIP` | 403 | identidad válida, sin organización |
| `FORBIDDEN` | 403 | falta el permiso; `details.required_permission` lo dice |
| `WAREHOUSE_NOT_ACCESSIBLE` | 403 | `X-Warehouse-Id` no válido para el usuario |
| `NOT_FOUND` | 404 | no existe **o no es accesible** — indistinguibles a propósito |
| `DUPLICATE_RESOURCE` | 409 | clave de negocio repetida |
| `CONFLICT` | 409 | p. ej. borrar un almacén con áreas activas |
| `VERSION_CONFLICT` | 412 | `If-Match` obsoleto |
| `VALIDATION_ERROR` | 400 | `details.errors[]` con `field` y `message` |
| `PRECONDITION_REQUIRED` | 428 | falta `If-Match` |
| `BUSINESS_RULE_VIOLATION` | 422 | regla de dominio |
| `INVALID_REFERENCE` | 422 | referencia a algo de otro ámbito |

**Sobre el 404:** pedir un almacén de otro tenant devuelve 404, no 403. Es
deliberado — un 403 confirmaría que el recurso existe.

---

## 7. Cabeceras

**Que envías:**

| Cabecera | Cuándo |
|---|---|
| `Authorization: Bearer <token>` | siempre salvo login, refresh y sondas |
| `If-Match: W/"N"` | obligatoria en PATCH y DELETE |
| `X-Warehouse-Id: <uuid>` | opcional; se **valida**, un almacén ajeno da 403 |
| `X-Correlation-Id: <uuid>` | opcional; útil para encadenar operaciones |

**Que recibes:** `X-Request-Id`, `X-Correlation-Id`, `ETag`, y `Location` en el
201.

---

## 8. Cliente mínimo

```ts
// api.ts
const BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

export async function login(email: string, password: string) {
  const r = await fetch(`${BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json();
  if (!r.ok) throw new ApiError(r.status, body.error);
  return body.data;   // { access_token, refresh_token, expires_in, … }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly error: {
    code: string; message: string; request_id?: string;
    details?: Record<string, unknown>;
  }) {
    super(error.message);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<{
  data: T; headers: Headers;
}> {
  const token = useAuthStore.getState().accessToken;
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  // 401 con token presente ⇒ expiró: refresca UNA vez y reintenta.
  if (r.status === 401 && token) {
    await useAuthStore.getState().refresh();
    return request<T>(path, init);
  }

  if (r.status === 204) return { data: undefined as T, headers: r.headers };
  const body = await r.json();
  if (!r.ok) throw new ApiError(r.status, body.error);
  return { data: body.data, headers: r.headers };
}
```

### React Query: el almacén va en la queryKey

```ts
// Sin `warehouse` en la clave, al cambiar de almacén se muestran los datos del
// anterior. Ese bug es indistinguible de una fuga de datos y cuesta un día
// diagnosticar.
export const useWarehouses = (filters: Filters) =>
  useQuery({
    queryKey: ["warehouses", currentWarehouseId, filters],
    queryFn: () => request<Warehouse[]>(buildUrl(filters)),
  });
```

### Ocultar por permiso, no por rol

```tsx
const { permissions } = useAuthStore();
const can = (p: string) => permissions.includes(p);

{can("warehouses:create") && <Button onClick={openCreate}>Nuevo almacén</Button>}
```

Comprueba **permisos**, nunca nombres de rol: los roles personalizados por
tenant llegarán y el nombre dejará de ser fiable.

---

## 9. Ciclo de sesión

```
login  → guarda access_token (1 h) y refresh_token
       → GET /me → guarda permissions y accessible_warehouse_ids
401    → POST /v1/auth/refresh → reintenta UNA vez
       → si el refresh falla, vuelve a login
logout → POST /v1/auth/logout → borra el estado local
```

Dos latencias distintas, y conviene tenerlas claras:

| Qué cambia | Cuándo lo notas |
|---|---|
| Permisos y roles | **inmediato** — se resuelven en cada petición |
| Acceso a almacenes | **inmediato** — lo resuelve RLS |
| Membresía del tenant | hasta 1 h — viaja en el token |

---

## 10. Módulo de IA: dos reglas de contrato antes de que lleguen los endpoints

Los endpoints son del Bloque 1 y aún no existen, pero conviene conocer dos
decisiones para no montar tipos que habrá que rehacer.

**Campos derivados de un modelo: solo lectura.** Un `AiModel` **no tiene**
`framework_code` propio: se deriva de su arquitectura. La respuesta de la API sí
lo incluye, junto a `framework_name` y `adapter`, y los tres son de **solo
lectura**:

```ts
interface AiModelOut {
  id: string;
  name: string;
  architecture_code: string;   // editable (solo si el modelo no tiene versiones)
  task: string;
  input_type: string;
  // Derivados. NUNCA se envían en POST ni PATCH:
  readonly framework_code: string;
  readonly framework_name: string;
  readonly adapter: string;
}
```

Vienen de una vista de lectura, así que su conjunto puede crecer sin que sea un
cambio de contrato. No los guardes en un formulario ni los envíes de vuelta: el
servidor los rechazaría, porque `extra="forbid"`.

**El catálogo dice lo recomendado hoy, no lo que se usó ayer.**
`GET /v1/ai/architectures/{code}` devuelve `hyperparam_schema` y
`default_hyperparams` para **generar el formulario** de un entrenamiento nuevo. No
sirven para mostrar con qué parámetros se entrenó una versión existente: eso lo
dará el run, que congela su propia copia. Si en una pantalla de detalle de versión
muestras los valores del catálogo, estarás mostrando datos que pueden no tener
nada que ver con ese entrenamiento.

---

## 11. Lo que todavía no existe

| Ausente | Cuándo |
|---|---|
| CRUD de áreas y ubicaciones | tablas listas; endpoints pendientes |
| Productos, stock, conteos | migraciones de Fase 1 |
| Invitaciones y gestión de usuarios | migración 0019 |
| Subida de archivos | requiere `core.files` |
| Realtime | ninguna tabla publicada todavía |
| Cambio de tenant | por diseño: un usuario tiene **una** membresía activa |

Si necesitas un endpoint para avanzar, dilo y lo priorizo: el patrón está
establecido y añadir un CRUD sobre una tabla existente es directo.
