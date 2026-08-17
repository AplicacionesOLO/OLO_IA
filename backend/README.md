# OLO_IA — Backend

API en FastAPI. **Estado: infraestructura.** Sin endpoints de negocio todavía.

## Puesta en marcha

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -e ".[dev]"
pre-commit install

cp .env.example ../.env.local        # y rellenar los valores
uvicorn olo.main:app --reload
```

Verificación: `GET /health`, `GET /ready`, `GET /version`.

```bash
pytest              # unitarios, no tocan la base
ruff check . && ruff format --check .
mypy src
mypy tools/inferir.py tools/sesion.py   # el worker: limpio, y hay que mantenerlo asi
```

> **El worker se verifica aparte, y no por gusto.** `mypy src` dejaba
> `tools/inferir.py` fuera, y por ahi paso un `'str' object is not callable` —`token` es
> una propiedad y el worker la llamaba como funcion— que se comio dos analisis completos:
> 180 detecciones y ni una imagen, porque la prueba visual esta escrita para no tumbar un
> analisis y se tragaba el error recorte a recorte. Un `mypy` habria dicho `"str" not
> callable` en la linea exacta. El worker no es un script auxiliar: es la mitad del
> sistema que ve.
>
> Va en su propia linea porque `mypy src` arrastra **49 errores previos** y
> `mypy tools` otros 11 en los demas scripts: metidos en el mismo comando, un error nuevo
> del worker se perderia entre sesenta viejos. Esos dos archivos si estan a cero, y esa es
> la linea que tiene que seguir dando `Success`.

## Lo que hay que saber antes de escribir código

### 1. La conexión usa `olo_app`, nunca `postgres` ni `service_role`

Ambos tienen `BYPASSRLS`: conectarse con ellos **anula todo el aislamiento
multi-tenant**. `olo_app` se creó en la migración 0002 con `NOBYPASSRLS`.

`olo_app` **todavía no tiene contraseña** — se creó así deliberadamente, porque
un rol con `LOGIN` y sin contraseña no puede autenticarse y ese es el estado
fail-secure. Antes de arrancar contra la base hay que fijársela como operación
de credenciales y ponerla en `DATABASE_URL`.

### 2. Toda escritura pasa por `tenant_session()`

```python
from olo.api.deps import Db, CurrentContext, require

@router.post("/algo", dependencies=[require("inventory:write")])
async def crear(db: Db, ctx: CurrentContext) -> Respuesta:
    ...
```

`Db` ya llega con transacción abierta, los cinco GUCs fijados, membresía
verificada y `X-Warehouse-Id` validado. No hay otro camino: no se abren
sesiones a mano.

### 3. Tres reglas del contexto, verificadas contra la base real

1. **`SET LOCAL` fuera de una transacción explícita es un no-op silencioso.** El
   GUC queda vacío, no hay error, y RLS deniega todas las filas. La transacción
   va siempre primero.
2. **Los valores van como parámetros ligados**, nunca interpolados en el SQL.
3. **`is_local => true`** da al ajuste alcance de transacción, y es lo que hace
   el patrón seguro con el pooler en modo *transaction*: se verificó que el
   contexto no se filtra a la siguiente transacción de la misma conexión.

### 4. Los repositorios no filtran por `tenant_id`

Lo hace RLS en el motor. Filtrar también aquí daría una falsa sensación de
seguridad e **ocultaría** un fallo de política en lugar de dejarlo a la vista.
El único filtro de esta capa es el de soft delete, que es negocio.

### 5. Un recurso de otro tenant devuelve 404, no 403

Un 403 confirmaría su existencia. `BaseRepository.require_by_id` ya lo hace:
RLS lo oculta, llega como «no existe» y produce 404.

### 6. El soft delete es explícito

`UPDATE ... SET deleted_at = now()`. **Nunca por trigger**: se verificó que un
trigger en `BEFORE UPDATE` marca `deleted_at` en cualquier actualización
—renombrar una entidad la eliminaba— y que en `BEFORE DELETE` no hace nada
mientras el borrado físico ocurre en silencio.

### 7. `version` la incrementa la aplicación

Nunca el trigger `set_updated_at`. Si lo hiciera, cualquier escritura de sistema
invalidaría la versión que el cliente tiene en mano y produciría 412 sin causa
real. Transporte HTTP: `ETag` en el GET, `If-Match` en el PATCH, 412 al no
coincidir, 428 si falta.

## Estructura

```
src/olo/
  core/       config, logging, errors, context      ← sin dependencias de FastAPI
  db/         session (canal B), repository base
  security/   jwt, authorization
  api/        deps, errors, middleware, v1/
  main.py     fábrica de la aplicación
```

`core/` no importa nada de `api/` ni de `db/`. La dependencia apunta hacia
dentro.

## El JWT es mínimo

Lleva `sub`, `role`, `app_metadata.tenant_id` y `app_metadata.tenant_wide_access`.
Nada más.

No lleva `core.users.id` (se resuelve por `auth_id`), ni `warehouse_ids`
(revocación diferida y bloat), ni `permissions` — los permisos se resuelven
contra la base en cada petición, que es lo que hace que revocar uno surta efecto
de inmediato.

## Pendiente

| Qué | Depende de |
|---|---|
| Contraseña de `olo_app` | Operación de credenciales |
| Resolución real de permisos | Migraciones 0013-0014 (`permissions`, `roles`, `role_assignments`) |
| `core.accessible_warehouse_ids()` | Migraciones 0014-0015 |
| Idempotencia (`Idempotency-Key`) | Migración 0018 (`core.idempotency_keys`) |
| Auditoría desde la aplicación | Migración 0019 (`audit.events`) |
| Rate limiting | Decidir almacén compartido; en memoria no sirve con más de una réplica |

Mientras las tablas de rol no existan, `require_permission` verifica membresía
activa y registra en el log el permiso que se habría exigido. Así ningún
endpoint queda sin protección por olvido, y la migración a la comprobación real
no cambia ninguna firma.
