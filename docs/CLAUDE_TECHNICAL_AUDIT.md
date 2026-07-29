# OLO_IA — AUDITORÍA TÉCNICA INDEPENDIENTE (CLAUDE CODE)

> **Autor:** Claude Code — ingeniero de implementación, responsable de Supabase, migraciones y pruebas.
> **Fecha:** 2026-07-28
> **Método:** lectura estática de los documentos. **Nada se ha ejecutado contra una base de datos real** — no hay proyecto Supabase conectado. Toda afirmación sobre comportamiento de PostgreSQL está razonada sobre la semántica de PG 15, no verificada empíricamente. Los ítems marcados **[PoC]** requieren validación contra una base antes de darse por ciertos.

---

## 1. RESUMEN EJECUTIVO

### 1.1 Veredicto

El diseño es **sólido en su arquitectura y peligrosamente optimista en su evaluación de preparación**. `DATABASE_DESIGN.md` está bastante más avanzado de lo esperado: índices únicos parciales correctos, `user_warehouse_access` presente, jerarquía desnormalizada ya aplicada. El trabajo de Kiro es bueno.

Pero `IMPLEMENTATION_READINESS.md` afirma que quedan **«2 problemas críticos, ambos ediciones de documentos, no técnicos»**. Eso no se sostiene. Esta auditoría identifica **12 defectos críticos de naturaleza técnica**, de los cuales cinco harían fallar la Fase 0 en su primer día de ejecución y ninguno se resuelve editando prosa:

- Un `CREATE TABLE` que **PostgreSQL rechaza** (`audit.events`).
- Un trigger que **borra lógicamente toda fila que se edite** (`core.soft_delete`).
- El camino backend→RLS **está especificado al revés**: el plan asume que validar el JWT en middleware hace que RLS funcione. No lo hace.
- El **CI ejecuta los tests contra `postgres:15` plano**, que no tiene schema `auth`; toda función de contexto de RLS v2.0 falla al crearse.
- El **Docker Compose local no incluye Supabase Auth**, así que el PoC del Custom Access Token Hook — declarado como riesgo nº1 del proyecto — no es ejecutable en el entorno que el plan define.

Además, `IMPLEMENTATION_READINESS.md` declara **«0 decisiones bloqueantes»**. Hay al menos tres que bloquean absolutamente, y la primera es que **no está decidido con qué herramienta se escriben las migraciones**: `DECISION_REGISTER.md` DR-006 aprueba Alembic; la instrucción que recibí en sesión aprobó Supabase CLI como fuente única. No se puede escribir la primera migración sin arbitrar eso.

### 1.2 Métricas

| Métrica | Kiro (IMPLEMENTATION_READINESS v2.0) | Esta auditoría |
|---|---|---|
| Problemas críticos | 2 (ambos documentales) | **12** (10 técnicos, 2 documentales) |
| Problemas altos | 4 riesgos | **23** |
| Decisiones bloqueantes | 0 | **3** (de 8 pendientes) |
| Inconsistencias entre documentos | 5 | **28** |
| Tablas faltantes | 2 (`notifications`, `invitations`) | **20** (5 necesarias en Fase 0) |
| Veredicto de gate | READY WITH CONDITIONS | **GO WITH CONDITIONS** (ver `IMPLEMENTATION_GATE.md`) |

La diferencia de veredicto es menor de lo que sugieren los números: coincido en que el proyecto puede arrancar. Discrepo en **qué** puede arrancar. Sprint 0.1 (repositorio, CI, tooling) está listo. Sprint 0.2 (base de datos y RLS) **no**, y es donde el plan actual estrellaría.

### 1.3 Alcance de esta auditoría

**Auditados en profundidad (los 8 solicitados):** `DATABASE_DESIGN.md`, `TASKS.md`, `API_DESIGN.md`, `DOMAIN_MODEL.md`, `RLS_STRATEGY.md` (v2.0, de mi autoría), `SECURITY.md`, `MULTITENANT.md`, `MODULES.md`.

**Leídos como contexto:** `VISION.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, y los 5 documentos de auditoría de Kiro.

**NO auditados en esta pasada:** `AI_ARCHITECTURE.md`, `INTEGRATION_STRATEGY.md`, `FOLDER_STRUCTURE.md`, `CODING_STANDARDS.md`, `RISK_ANALYSIS.md`. Son 1.377 líneas que no entraron en el encargo. La matriz de conflictos es por tanto **incompleta respecto a esos cinco documentos** y debe considerarse una cota inferior.

---

## 2. HALLAZGOS CRÍTICOS

### CRIT-01 — `audit.events` no se puede crear. El DDL falla.

`DATABASE_DESIGN.md:757-774`

```sql
CREATE TABLE audit.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- ← PK solo sobre id
    ...
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);                    -- ← particionada por created_at
```

PostgreSQL exige que **toda constraint única o primaria de una tabla particionada incluya todas las columnas de partición**. Este `CREATE TABLE` aborta con:

```
ERROR:  unique constraint on partitioned table must include all partitioning columns
DETAIL: PRIMARY KEY constraint on table "events" lacks column "created_at"
        which is part of the partition key.
```

**Impacto:** la primera migración de `audit` no ejecuta. Y como la auditoría append-only es obligatoria en Fase 0 (decisión 4.9), bloquea Sprint 0.2.

**Agravante:** la decisión aprobada 4.3 dice **«No implementar particionamiento en Fase 0»** y lista auditoría como candidata *futura*. `DATABASE_DESIGN.md` y `PHASE_0_PLAN.md:105` (tarea 026, «particionada mensual») contradicen esa decisión. La corrección correcta no es arreglar la PK: es **quitar el particionamiento de Fase 0** y dejar `id UUID PRIMARY KEY` simple, documentando el umbral de activación.

---

### CRIT-02 — No está decidido con qué herramienta se escriben las migraciones. Bloqueo absoluto.

| Fuente | Dice |
|---|---|
| `DECISION_REGISTER.md:19` (DR-006) | «Usar Alembic para migraciones (no Supabase CLI migrations) — **Aprobada**» |
| `PHASE_0_PLAN.md:93` (tarea 014) | «Configurar Alembic multi-schema» |
| `PHASE_0_PLAN.md:227` | «Deshabilitar migraciones automáticas de Supabase, usar solo Alembic» |
| `DEPLOYMENT.md:58-59` | El Dockerfile copia `alembic/` y `alembic.ini` |
| Instrucción recibida en sesión | Supabase CLI como fuente única de verdad; Alembic descartado |

Son mutuamente excluyentes y **soy el responsable de migraciones**, así que no puedo empezar sin arbitraje. Las consecuencias divergen de forma sustancial:

**Con Alembic:** cada política RLS, función, trigger, política de Storage y el Custom Access Token Hook van dentro de `op.execute("""...""")` a mano. El Studio de Supabase queda bloqueado para escritura o hay drift silencioso. Un solo pipeline con el backend Python.

**Con Supabase CLI:** SQL versionado en `supabase/migrations/`, soporte nativo de RLS/funciones/Storage, `supabase db diff` detecta drift, `supabase db lint` valida `search_path` y RLS. Pero se pierde la integración con el ciclo de vida de SQLAlchemy y hay que verificar la correspondencia modelo↔schema en CI.

**Mi recomendación técnica sigue siendo Supabase CLI**, porque el 70% de lo que esta base de datos necesita en Fase 0 es RLS, funciones y triggers — exactamente lo que Alembic no modela. Pero es una decisión del árbitro, no mía.

---

### CRIT-03 — El camino backend→RLS está especificado al revés. Fallaría el día 1 de Sprint 0.3.

`PHASE_0_PLAN.md:136` (tarea 043):

> «Backend middleware: **NO usar set_config cuando hay JWT** (PostgREST/RLS lee directamente claims) — Criterio: Verificar que RLS funciona solo con JWT claims»

Y `DECISION_REGISTER.md:40-43` (DR-002, Categoría A):

> «Frontend **o Backend** con JWT del usuario → Rol: `authenticated` → RLS activo (políticas evalúan claims del JWT via `auth.jwt()`)»

**Esto es incorrecto para el backend.** `auth.jwt()` de Supabase lee `current_setting('request.jwt.claims')`. Ese GUC **lo fija PostgREST** en cada request HTTP que atiende. Cuando FastAPI abre su propia conexión a Postgres vía asyncpg/SQLAlchemy, **no hay PostgREST en el camino y nadie fija ese GUC**. La conexión no sabe nada del JWT que el middleware validó tres capas más arriba.

Resultado real: `auth.jwt()` devuelve NULL → `core.current_tenant_id()` cae a la rama del GUC → que tampoco está fijado porque la tarea 043 prohíbe explícitamente fijarlo → NULL → **la política RESTRICTIVE deniega todas las filas**. El síntoma sería «RLS funciona, deniega todo», que es el fallo más difícil de diagnosticar porque parece correcto desde el punto de vista de seguridad.

**Las dos únicas soluciones viables:**

**(a) Emular PostgREST** en la conexión del backend, dentro de la transacción:
```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', $1::text, true);   -- JSON de claims validado
```
Preserva un solo modelo de autorización (todo evalúa `auth.jwt()`), pero el backend debe reproducir fielmente el formato de claims y `SET LOCAL ROLE` obliga a que el usuario de conexión pueda asumir `authenticated`.

**(b) Usar siempre el camino GUC propio** con rol `olo_app` para todo tráfico originado en el backend, y reservar `auth.jwt()` exclusivamente para PostgREST/Realtime/Storage (acceso directo del frontend). Más simple y es exactamente para lo que diseñé la función híbrida en `RLS_STRATEGY.md` §2.2.

La opción (b) choca con la instrucción de sesión de que «`olo_app` no debe sustituir universalmente a `authenticated`». Necesita arbitraje: ver **DEC-02**.

---

### CRIT-04 — El CI ejecuta los tests contra `postgres:15` plano. Las funciones de RLS v2.0 no compilan ahí.

`DEPLOYMENT.md:167-181`:

```yaml
test-backend:
    services:
      postgres:
        image: postgres:15        # ← Postgres vanilla
```

`RLS_STRATEGY.md` v2.0 §2.2 define `core.current_tenant_id()`, `core.current_auth_id()` y `core.current_user_id()` invocando `auth.jwt()` y `auth.uid()`. Esas funciones **las crea la plataforma Supabase**, no PostgreSQL. En `postgres:15` no existe ni el schema `auth`.

El fallo no ocurre en los tests: ocurre al **aplicar la migración** que crea las funciones —
```
ERROR:  schema "auth" does not exist
```
— así que el job entero muere antes de ejecutar un solo test. Y como `make check-rls` y los 6 tests de aislamiento (`PHASE_0_PLAN.md` tareas 033-038) dependen de esa migración, **la verificación de aislamiento multi-tenant nunca llegaría a correr en CI**. El proyecto tendría CI verde en lint y rojo permanente en lo único que de verdad protege los datos.

**Corrección:** usar `supabase/postgres:15.x` en el servicio de CI, o levantar Supabase local con la CLI en el job. Ver **DEC-03**.

---

### CRIT-05 — El entorno local no incluye Supabase Auth. El PoC del Hook no es ejecutable.

`PHASE_0_PLAN.md:132` marca el PoC del Custom Access Token Hook como tarea 039 y `PHASE_0_PLAN.md:223` lo declara **riesgo nº1 del proyecto** («probabilidad media», plan B definido). Pero el entorno donde probarlo no existe:

- `DEPLOYMENT.md:36-38` **dibuja** un servicio `supabase-local (Auth+Storage)` en el diagrama.
- `DEPLOYMENT.md:122-135` **el compose real** define solo `postgres: supabase/postgres:15.1.0.117`, `redis` y los tres servicios de aplicación. **No hay GoTrue (Auth), ni Storage, ni Realtime, ni PostgREST.**

Un Hook de Access Token solo se puede validar emitiendo un token real a través de GoTrue y decodificándolo. Sin Auth local, la tarea 039 solo es ejecutable contra el proyecto Supabase cloud, lo que convierte el riesgo nº1 en un riesgo que se descubre en la nube y no en local.

**Corrección:** reemplazar el `postgres` suelto por `supabase start` (la CLI levanta el stack completo: Postgres, GoTrue, PostgREST, Storage, Realtime, Studio). Esto además resuelve CRIT-04 de forma unificada, lo que es un argumento fuerte a favor de la CLI en CRIT-02.

---

### CRIT-06 — `core.soft_delete()` borra lógicamente cualquier fila que se edite.

`DATABASE_DESIGN.md:852-858`

```sql
CREATE OR REPLACE FUNCTION core.soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    NEW.deleted_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Está en la sección «Triggers y funciones comunes», junto a `set_updated_at()` que sí es `BEFORE UPDATE`. Si se engancha como `BEFORE UPDATE` — la lectura natural dado el contexto — **cualquier UPDATE marca la fila como borrada**. Renombrar un almacén lo elimina.

Si la intención era interceptar `BEFORE DELETE` para convertirlo en soft delete, la función tampoco sirve: en un trigger `BEFORE DELETE` la fila `NEW` no existe, y para cancelar el DELETE hay que `RETURN NULL` y ejecutar el UPDATE aparte.

**El soft delete no se implementa con triggers.** Se implementa en el repositorio (`UPDATE ... SET deleted_at = now()`) y se lee a través de las vistas `_active` que ya aprobó DR-016. Esta función debe **eliminarse**, no corregirse.

---

### CRIT-07 — `core.countries` con `tenant_id` contradice la decisión aprobada de países.

`DATABASE_DESIGN.md:69-86` define `core.countries` con `tenant_id UUID NOT NULL` y único por `(tenant_id, iso_code)`. Es decir: **cada tenant tiene su propia copia de Costa Rica**, con su propio UUID.

Contradice la decisión aprobada 4.7 y DR-005 (`public.countries` global ISO + `core.tenant_countries` para activación por tenant). Consecuencias del modelo actual:

- 250 países × 1.000 tenants = 250.000 filas de catálogo duplicado.
- El código ISO de un país es un hecho del mundo, no un dato del tenant: nada impide que el tenant A registre `CR` como «Costa Rica» y el tenant B como «Croacia».
- `core.companies.country_id` (`:94`) apunta a la copia del tenant, así que un reporte cross-tenant no puede agrupar por país sin unir por `iso_code` en texto.

Bloquea la migración de `core`, que es la primera del proyecto.

---

### CRIT-08 — No existe ledger de movimientos de stock. Sin él, el inventario tiene una carrera irresoluble.

No hay ninguna tabla `inventory.stock_movements`. `inventory.stock_records` guarda **solo el estado actual** (`quantity`, `reserved_quantity`).

**Consecuencia funcional:** `RF-INV-007` («Historial completo de movimientos por ubicación y producto», P1) y `MODULES.md:175` («Movimientos — Historial de entradas/salidas/transfers — Trazable») **no son implementables**. No hay de dónde sacar el historial.

**Consecuencia de concurrencia, que es la grave:** `inventory.adjustment_items` (`:467-469`) guarda `previous_quantity` y `new_quantity`, o sea que **un ajuste es una sobrescritura absoluta**. La secuencia real de un almacén:

```
t0  Conteo lee stock de la ubicación A-01-01: 100 unidades
    → count_items.system_quantity = 100
t1  Un operario recibe mercancía: stock pasa a 130
t2  El conteo se cierra con counted_quantity = 95 y genera un ajuste
    previous_quantity=100, new_quantity=95
t3  Se aplica el ajuste: quantity := 95
    → las 30 unidades recibidas en t1 desaparecen sin rastro
```

Ni el `CHECK (quantity >= 0)` ni el optimistic locking aprobado en DR-014 salvan esto: la versión sí detectaría que la fila cambió, pero entonces **el ajuste falla y el conteo hay que repetirlo entero**, que es inaceptable operativamente.

La solución correcta es que los ajustes sean **deltas sobre un ledger**: `movement = -5`, aplicado como `quantity := quantity - 5`, con `stock_records` como proyección (o incluso como suma materializada del ledger). Entonces t1 y t3 son conmutativos y el resultado es 125, que es el correcto.

Esto es un cambio de modelo, no una columna. Ver **DEC-07**.

---

### CRIT-09 — `inventory.stock_records` no tiene unicidad lógica. Se pueden crear filas duplicadas del mismo stock.

`DATABASE_DESIGN.md:338-372`. El único índice único es sobre `serial_number`. **Nada impide** dos filas con idéntico `(tenant_id, warehouse_id, location_id, product_id, lot_number, status)`.

Dos inserciones concurrentes del mismo stock producen dos filas de 50 en vez de una de 100. `SUM(quantity)` sigue dando 100, así que los listados parecen correctos — pero:

- Un ajuste hecho por `stock_record_id` (`adjustment_items.stock_record_id`, `:466`) toca una de las dos y deja la otra intacta.
- Una reserva puede fallar por «stock insuficiente» teniendo stock, porque el `CHECK (reserved_quantity <= quantity)` se evalúa por fila.
- Un conteo genera dos `count_items` para la misma ubicación y producto (agravado por ALTO-22).

**Corrección:** índice único parcial con `COALESCE` sobre las columnas nulables:
```sql
CREATE UNIQUE INDEX uq_stock_logical ON inventory.stock_records (
    tenant_id, warehouse_id, location_id, product_id,
    COALESCE(lot_number, ''), COALESCE(serial_number, ''), status
) WHERE deleted_at IS NULL;
```
Y el `UPSERT` (`ON CONFLICT`) pasa a ser la única forma de crear stock, lo que además elimina la carrera de inserción.

---

### CRIT-10 — La integridad de la jerarquía desnormalizada no está implementada. Es exactamente lo que la decisión 4.1 encarga resolver.

`DATABASE_DESIGN.md:171-199` ya aplica la desnormalización aprobada — `core.locations` tiene `tenant_id`, `warehouse_id` **y** `area_id`. Pero las tres son **FK independientes**:

```sql
tenant_id    UUID NOT NULL REFERENCES core.tenants(id),
warehouse_id UUID NOT NULL REFERENCES core.warehouses(id),
area_id      UUID NOT NULL REFERENCES core.areas(id),
```

Cada una es válida por separado y **nada las relaciona entre sí**. Es perfectamente insertable una location cuyo `area_id` pertenece al almacén 1 mientras su `warehouse_id` dice almacén 2, o cuyo `warehouse_id` pertenece a otro tenant. En cuanto eso pasa, la política `warehouse_scope` de RLS v2.0 protege según `warehouse_id` mientras la aplicación navega por `area_id`: **fuga horizontal silenciosa**.

La instrucción es explícita: «No dependas solo del frontend para garantizarlo». La solución robusta son **claves foráneas compuestas**, que exigen añadir índices únicos redundantes como destino:

```sql
-- Destinos de FK compuesta
ALTER TABLE core.warehouses ADD CONSTRAINT uq_warehouses_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE core.areas      ADD CONSTRAINT uq_areas_tenant_wh_id   UNIQUE (tenant_id, warehouse_id, id);

-- areas: su warehouse debe ser del mismo tenant
ALTER TABLE core.areas ADD CONSTRAINT fk_areas_warehouse_tenant
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES core.warehouses (tenant_id, id);

-- locations: su area debe ser del mismo tenant Y del mismo warehouse
ALTER TABLE core.locations ADD CONSTRAINT fk_locations_area_scope
    FOREIGN KEY (tenant_id, warehouse_id, area_id) REFERENCES core.areas (tenant_id, warehouse_id, id);
```

Con eso, las tres incoherencias que la decisión 4.1 enumera pasan a ser **imposibles a nivel de motor**, sin triggers y sin coste en escritura más allá del índice. El mismo patrón aplica a las 9 tablas warehouse-scoped (detalle en `DATABASE_RECONCILIATION_PLAN.md` §7). Ver **DEC-05**.

---

### CRIT-11 — El Custom Access Token Hook falla silenciosamente: `jsonb_set` no crea niveles intermedios. **[PoC]**

`DECISION_REGISTER.md:125-127`

```sql
v_claims := (event -> 'claims')::jsonb;
v_claims := jsonb_set(v_claims, '{app_metadata,tenant_id}', to_jsonb(v_tenant_id::text));
```

`jsonb_set` crea la **clave final** si falta (`create_if_missing`, por defecto true), pero **todos los pasos anteriores de la ruta deben existir**. Si `claims` no trae la clave `app_metadata`, la ruta `{app_metadata,tenant_id}` no es recorrible y `jsonb_set` **devuelve el objeto sin modificar, sin error**.

El resultado sería: login exitoso, JWT válido, **sin `tenant_id`**, y por tanto `core.current_tenant_id()` = NULL y RLS denegando absolutamente todo para todos los usuarios. Un fallo cerrado y silencioso en el 100% de los logins.

La propia documentación de Supabase para este hook incluye la inicialización defensiva precisamente por esto:

```sql
IF jsonb_typeof(v_claims -> 'app_metadata') IS NULL THEN
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
END IF;
```

Marcado **[PoC]** porque en la práctica Supabase suele poblar `app_metadata`; pero depender de eso sin la guarda es un riesgo innecesario de una línea.

---

### CRIT-12 — Sin idempotencia. Aplicar un ajuste dos veces duplica su efecto sobre el stock.

`API_DESIGN.md` no menciona `Idempotency-Key` en ningún sitio: los headers de `§4.1` no lo incluyen y `§2.3` se limita a declarar que POST no es idempotente.

Los endpoints afectados son los que mueven stock:

| Endpoint | Consecuencia de la doble ejecución |
|---|---|
| `POST /v1/adjustments/{id}/apply` (`:335`) | El ajuste se aplica dos veces. Con el modelo actual de sobrescritura absoluta es inocuo por casualidad; **con el ledger de CRIT-08 duplica el delta**. |
| `POST /v1/counts/{id}/items` (`:327`) | Línea de conteo duplicada (agravado por ALTO-22). |
| `POST /v1/connectors/{id}/sync` (`:397`) | Dos sync jobs concurrentes sobre el mismo conector, que la invariante de `DOMAIN_MODEL.md:1080` prohíbe pero nada implementa. |
| `POST /v1/uploads/confirm` (`:514`) | Registro duplicado del mismo archivo. |

Un reintento de red del cliente, un doble clic o un retry de la propia API bastan. En operaciones de inventario esto es corrupción de datos, no una molestia.

**Corrección:** header `Idempotency-Key` obligatorio en todo POST que muta estado de negocio, con tabla `core.idempotency_keys (tenant_id, key, endpoint, request_hash, response_body, status_code, created_at)` y único sobre `(tenant_id, key)`.

---

## 3. HALLAZGOS ALTOS

| ID | Hallazgo | Referencia | Impacto |
|---|---|---|---|
| ALTO-01 | **Sin optimistic locking en ninguna tabla** pese a DR-014 aprobada, y la API no tiene forma de transportarlo: no hay `ETag`/`If-Match` ni campo `version` en los payloads. `PATCH /v1/stock-records/{id}` es el punto exacto donde se pierden updates. | `DATABASE_DESIGN.md` (todo), `API_DESIGN.md:322` | Lost updates en inventario |
| ALTO-02 | **El schema `platform` se crea vacío.** Cero tablas. Pero la decisión 4.9 exige auditoría obligatoria de cada uso de `service_role` y DR-002 §C enumera 5 operaciones privilegiadas. Falta `platform.privileged_operation_log`. | `DATABASE_DESIGN.md:38`, `DECISION_REGISTER.md:71-76` | Requisito aprobado sin implementación |
| ALTO-03 | **El modelo de auditoría no coincide con el aprobado en 4.9.** Falta `request_id`, falta `source`; `changes` en lugar de `old_values`/`new_values`; `resource_type`/`resource_id` en lugar de `entity_type`/`entity_id`; `created_at` en lugar de `occurred_at`. | `DATABASE_DESIGN.md:757-773` vs decisión 4.9 | Reescritura de auditoría post-Fase 0 |
| ALTO-04 | **`core.user_warehouse_access` le faltan 4 de las 9 columnas exigidas** por la decisión 4.2: `revoked_at`, `source_role_assignment_id`, `created_at`, `updated_at`. Y su índice único es total: con `revoked_at` debe ser parcial `WHERE revoked_at IS NULL` para permitir re-otorgar. **Además `accessible_warehouse_ids()` de RLS v2.0 ya filtra por `revoked_at`, así que la función no compila contra este schema.** | `DATABASE_DESIGN.md:278-291`, `RLS_STRATEGY.md` §2.3 | Bloquea Sprint 0.2 |
| ALTO-05 | **Falta `inventory.count_observations`** (decisión 4.10). `count_items.counted_quantity` es un valor único y `discrepancy` es `GENERATED` sobre él, así que el doble conteo de `MODULES.md:189` no tiene dónde vivir. | `DATABASE_DESIGN.md:411-412` | Requisito aprobado sin modelo |
| ALTO-06 | **Falta `devices.telemetry_points`** (decisión 4.5). `drone_missions.telemetry JSONB DEFAULT '[]'` acumula la serie entera en una fila: un vuelo de 20 min a 10 Hz son 12.000 puntos y cada `UPDATE` reescribe el JSONB completo. | `DATABASE_DESIGN.md:676` | Requisito aprobado sin modelo |
| ALTO-07 | **Falta el CHECK de serial** (decisión 4.11): `CHECK (serial_number IS NULL OR quantity = 1)`. Hoy es insertable un serial con cantidad 40. | `DATABASE_DESIGN.md:349` | Requisito aprobado sin implementación |
| ALTO-08 | **Tres invariantes de exclusión sin enforcement en DB.** «Un solo AI Model deployed por engine_type por tenant» (`DOMAIN_MODEL.md:724`), «un solo sync concurrente por connector» (`:1080`), «un solo training simultáneo por tenant» (`:837`). Todas son índices únicos parciales triviales; ninguna existe. Validarlas solo en aplicación es una carrera. | `DATABASE_DESIGN.md` §5.1, §5.4, §7.2 | Estado inconsistente bajo concurrencia |
| ALTO-09 | **No hay registro de archivos.** Todo es `*_url TEXT` y `evidence_urls JSONB`. La decisión 4.10 referencia `evidence_file_id`, que implica tabla. Sin `core.files` no se puede forzar que las rutas de Storage sean del tenant, ni limpiar huérfanos, ni auditar signed URLs, ni aplicar cuotas de storage (`RF-TENANT-012`). | `DATABASE_DESIGN.md` (transversal) | Aislamiento de Storage no verificable |
| ALTO-10 | **`POST /v1/uploads/confirm` no valida nada.** No comprueba que el archivo exista en Storage, que su content-type coincida con el declarado, ni que el `file_key` pertenezca al tenant. El `size` lo envía el cliente y es puramente informativo. | `API_DESIGN.md:505-517` | Falsificación de metadatos, cuotas evadibles |
| ALTO-11 | **Paginación solo por offset.** Con `RNF-SCAL-004` (>1M productos por almacén), `page=5000&page_size=100` es `OFFSET 500000`: PostgreSQL recorre y descarta medio millón de filas en cada página. Hace falta paginación por cursor/keyset para colecciones grandes. | `API_DESIGN.md:197-207` | `RNF-PERF-001` (<300ms p95) inalcanzable |
| ALTO-12 | **`X-Warehouse-Id` es un hint del cliente sin validación documentada.** No dice en ningún sitio que se compruebe contra `accessible_warehouse_ids()`, y «overrides default» no aclara qué sobrescribe. Es la misma clase de problema que la instrucción §9 prohíbe para `tenant_id`. | `API_DESIGN.md:148` | Potencial acceso a almacén no autorizado |
| ALTO-13 | **`core.roles.parent_role_id` es self-FK sin prevención de ciclos.** La invariante «Cannot create circular inheritance» (`DOMAIN_MODEL.md:166`) no tiene enforcement. Un ciclo A→B→A cuelga indefinidamente cualquier resolución recursiva de permisos. | `DATABASE_DESIGN.md:240` | DoS por dato malformado |
| ALTO-14 | **`core.roles` no tiene `deleted_at`** pero `DELETE /v1/roles/{id}` borra roles custom. Es hard delete, contradice `RNF-DATA-004`, y como `user_role_assignments.role_id` no declara `ON DELETE`, el borrado falla por FK o deja asignaciones colgando. La invariante «Cannot delete role with active assignments» no está implementada. | `DATABASE_DESIGN.md:234-249`, `API_DESIGN.md:307` | Error 500 o pérdida de trazabilidad |
| ALTO-15 | **Umbrales de stock en el sitio equivocado y con el tipo equivocado.** `products.min_stock/max_stock/reorder_point` son `INT` y globales al tenant, pero `MODULES.md:176` los quiere configurables por almacén y `quantity` es `DECIMAL(15,4)`. Un producto con mínimo 10 en el CD central y 2 en la tienda no es representable. | `DATABASE_DESIGN.md:315-317` | `RF-INV-008` no implementable |
| ALTO-16 | **`TASKS.md` y `PHASE_0_PLAN.md` son dos planes de Fase 0 distintos con IDs solapados y significados diferentes.** Tarea 011 = «Configurar Alembic» en uno y «FastAPI app factory» en el otro; 040 = «TenantStore» vs «Hook fail-secure». Cualquier referencia a «tarea 0NN» es ambigua, y `TASKS.md` además no refleja DR-005 ni DR-012. | `TASKS.md:38-77` vs `PHASE_0_PLAN.md:76-133` | Trazabilidad rota entre agentes |
| ALTO-17 | **Ninguna FK declara `ON DELETE`/`ON UPDATE`.** Con soft delete como norma el default `NO ACTION` es defendible, pero no está escrito, y hay una excepción sin justificar: `audit.events.tenant_id` sin FK «por performance» — razonable, pero entonces nada impide un `tenant_id` inventado más allá del `WITH CHECK` de RLS. | `DATABASE_DESIGN.md` (transversal), `:759` | Comportamiento no especificado |
| ALTO-18 | **Faltan `core.invitations` y `core.sessions`.** La invitación con expiración a 72h (`MODULES.md:133`) y `GET/DELETE /v1/auth/sessions` (`API_DESIGN.md:259-260`) ya están en la API y en el plan de Sprint 0.3, sin tabla donde persistir. | `API_DESIGN.md:259`, `PHASE_0_PLAN.md` Sprint 0.3 | Endpoints sin backing store |
| ALTO-19 | **La telemetría no tiene endpoint de escritura.** `GET /v1/missions/{id}/telemetry` existe; no hay POST ni canal de ingesta. Tampoco endpoints de aprovisionamiento de tenant (DR-004 lo requiere), impersonación (`MULTITENANT.md` §8.2), métricas de plataforma, notificaciones, ni `tenant-countries`. | `API_DESIGN.md:383` | Funcionalidad aprobada sin superficie de API |
| ALTO-20 | **`DEPLOYMENT.md` contradice tres decisiones aprobadas.** §5 mantiene Kubernetes como arquitectura de producción (DR-008 lo pospone); §3.1 y §3.4 incluyen `ai-service` con GPU y `redis` en el compose (DR-009 dice no instalar Redis hasta el primer caso real, y `PHASE_0_PLAN.md:28-38` excluye explícitamente IA y Redis de Fase 0). | `DEPLOYMENT.md:252-296`, `:110-131` | Entorno local pesado e inconsistente |
| ALTO-21 | **El Hook no tiene índice que lo soporte.** La consulta filtra `core.users.auth_id` y `user_role_assignments.user_id` **sin `tenant_id`** (aún no lo conoce). Los índices existentes son `(tenant_id, user_id)`, que no sirven para ese acceso. Hay `idx_users_auth_id`, pero falta uno por `user_role_assignments(user_id, scope_type)`. El Hook corre en cada refresh de token de cada usuario activo. | `DECISION_REGISTER.md:105-117`, `DATABASE_DESIGN.md:268` | Latencia de login; KPI «Hook < 50ms» en riesgo |
| ALTO-22 | **`inventory.count_items` sin único** en `(tenant_id, count_id, location_id, product_id)`. Permite líneas de conteo duplicadas para la misma ubicación y producto, que luego generan ajustes duplicados. | `DATABASE_DESIGN.md:404-425` | Doble ajuste desde un conteo |
| ALTO-23 | **Las tres funciones comunes no fijan `search_path` y `prevent_tenant_change` sigue usando `!=`.** `DATABASE_DESIGN.md:844` no incorporó la corrección de RLS v2.0 §8: con `!=`, si un lado es NULL la comparación es NULL, el `IF` no entra y **el cambio de tenant pasa sin excepción**. Las tres funciones son además hallazgos del linter de Supabase (`function_search_path_mutable`). | `DATABASE_DESIGN.md:826-858` | Escape de tenant no detectado |

---

## 4. PROBLEMAS DE RLS

Estos son adicionales a lo ya corregido en `RLS_STRATEGY.md` v2.0.

**RLS-01 — La propagación de claims desde el backend no está resuelta.** Es CRIT-03. Es el problema de RLS más importante que queda abierto, y no es un defecto de las políticas sino del cableado entre FastAPI y Postgres.

**RLS-02 — `accessible_warehouse_ids()` no compila contra el schema actual** por la ausencia de `revoked_at` (ALTO-04). Dependencia directa y bloqueante.

**RLS-03 — Coste de `accessible_warehouse_ids()` no medido. [PoC]** Es `STABLE`, así que PostgreSQL la evalúa una vez por statement y no por fila — el riesgo declarado en `IMPLEMENTATION_READINESS.md:56` está sobreestimado. Pero es `SECURITY DEFINER`, lo que **impide su inlining** por el planner, y aparece dentro de una política que se aplica a cada `SELECT` de 9 tablas. El KPI «< 5ms overhead» (`PHASE_0_PLAN.md:212`) hay que medirlo, no asumirlo.

**RLS-04 — Riesgo de recursión documentado pero no verificado. [PoC]** `RLS_STRATEGY.md` §5.1 exige que la política de `core.user_warehouse_access` no invoque `can_access_warehouse()`, y `PHASE_0_PLAN.md:104` lo recoge. Correcto. Pero nada en CI lo comprueba: un futuro cambio que añada esa llamada produciría recursión infinita en runtime. Debería haber un test explícito.

**RLS-05 — Las tablas de `public` siguen declaradas exentas de RLS.** `MULTITENANT.md:320-330` las llama «exentas de multi-tenancy», lo que es cierto, pero una tabla en `public` sin RLS queda expuesta a escritura vía PostgREST. `PHASE_0_PLAN.md:95` ya lo corrige para `public.countries`; falta `public.currencies` y `public.system_config`.

**RLS-06 — Nadie ha decidido qué schemas se exponen a PostgREST.** `RLS_STRATEGY.md` §6.2 lo especifica en `config.toml`, pero si la herramienta acaba siendo Alembic (CRIT-02) ese archivo no forma parte del pipeline y la configuración queda huérfana. Sin exponerlos, el frontend recibe 404 en todo; exponiéndolos de más, se publica `internal` y `platform`.

**RLS-07 — `FORCE ROW LEVEL SECURITY` no protege de `BYPASSRLS`.** Está bien aprobado (DR-015) y bien documentado en RLS v2.0 §1.2, pero conviene que quede en un solo sitio operativo: `FORCE` neutraliza al *propietario* de la tabla, no a `service_role` ni a `postgres`. La única protección real ahí es no poner esas credenciales al alcance del código de aplicación, y auditar su uso (ALTO-02).

---

## 5. PROBLEMAS DE INTEGRIDAD

| ID | Problema | Referencia |
|---|---|---|
| INT-01 | Jerarquía desnormalizada sin FK compuestas — CRIT-10 | `DATABASE_DESIGN.md:171-199` |
| INT-02 | `stock_records` sin clave lógica — CRIT-09 | `:338-372` |
| INT-03 | `count_items` sin único por conteo/ubicación/producto — ALTO-22 | `:404-425` |
| INT-04 | Herencia de roles sin prevención de ciclos — ALTO-13 | `:240` |
| INT-05 | Ausencia de `ON DELETE`/`ON UPDATE` en todas las FK — ALTO-17 | transversal |
| INT-06 | `CHECK` de status ausente en 4 tablas donde el resto sí lo tiene: `core.countries.status` (`:79`), `core.areas.status` (`:155`), `core.locations` sí lo tiene, `spatial.floor_plans.status` (`:810`). Inconsistencia que permite estados inventados. | `:79`, `:155`, `:810` |
| INT-07 | `ai.models.training_job_id` **sin FK** mientras `ai.training_jobs.result_model_id` **sí la tiene**. Referencia circular tratada de forma asimétrica: una mitad íntegra y la otra no. Necesita FK diferida o eliminar un lado. | `:537` vs `:618` |
| INT-08 | Sin CHECK de coherencia temporal: nada impide `completed_at < started_at`, `resolved_at < created_at`, `revoked_at < granted_at`. Son CHECKs de una línea. | transversal |
| INT-09 | `user_role_assignments` no valida que `scope_company_id`/`scope_warehouse_id` sean coherentes con `scope_type`. Un `scope_type='global'` con `scope_warehouse_id` relleno es insertable y su semántica es indefinida. Falta `CHECK` condicional. | `:259-262` |
| INT-10 | Los transiciones de estado de `DOMAIN_MODEL.md` §12.3 (count, model, mission) no tienen ningún enforcement. Aceptable en capa de aplicación, pero debe existir test por máquina de estados; no hay ninguno en el plan. | `DOMAIN_MODEL.md:1227-1264` |
| INT-11 | `inventory.counts.assigned_users JSONB` y `scope JSONB` impiden integridad referencial e indexación. «Mis conteos asignados» requiere escanear JSONB. Debería ser `count_assignees`. | `:386-387` |
| INT-12 | `core.locations.plan_coordinates JSONB` guarda las coordenadas **en la location**, pero `spatial.floor_plans` está versionado (`version`, `:804`). Con dos versiones de plano no hay dónde poner dos juegos de coordenadas. Falta `spatial.plan_location_mappings`. | `:187` vs `:804` |

---

## 6. PROBLEMAS DE ESCALABILIDAD

**ESC-01 — Los targets de `RNF-SCAL` son internamente inconsistentes.** `RNF-SCAL-001` (>1.000 tenants) × `RNF-SCAL-003` (>100 almacenes/tenant) × `RNF-SCAL-004` (>1M productos/almacén) da 10¹¹, cuatro órdenes de magnitud por encima de `RNF-SCAL-005` (>100M registros de inventario). Y `MULTITENANT.md:112` planificó con 10 almacenes por empresa. Los números no se derivan unos de otros, así que no sirven para dimensionar nada. La instrucción 4.12 encarga tres escenarios coherentes: están en `DATABASE_RECONCILIATION_PLAN.md` §11.

**ESC-02 — Paginación por offset** — ALTO-11.

**ESC-03 — `?include=` sin allowlist ni límite de profundidad** (`API_DESIGN.md:236-241`). Con RLS activo cada expansión es un join adicional bajo política; `include=areas,company` sobre 100 almacenes es fácilmente un N+1. Falta declarar qué expansiones existen y su coste.

**ESC-04 — `to_tsvector('spanish', ...)` en índice GIN fija el idioma en el schema** (`:331`). La plataforma es multi-idioma (`RNF-I18N-001`: ES, EN, PT). Un catálogo en inglés se indexa con reglas de stemming españolas. Y cambiar la configuración obliga a reconstruir el índice sobre millones de filas.

**ESC-05 — `drone_missions.telemetry JSONB`** — ALTO-06. Además del tamaño, cada append reescribe la fila completa (`TOAST` incluido), lo que convierte la ingesta de telemetría en amplificación de escritura.

**ESC-06 — `ai.inference_jobs.results JSONB`** (`:590`) guarda las detecciones como blob. `RF-IA-013` pide asociar resultados de inferencia a ubicaciones de inventario, y la decisión 4.3 lista «detecciones» como candidata a particionamiento — ambas cosas presuponen una tabla `ai.detections` consultable. Con JSONB, «dame todas las detecciones de clase X con confianza > 0,8 del último mes» es un escaneo secuencial.

**ESC-07 — Sin contadores de uso.** `tenants.limits JSONB` guarda los límites, pero `MULTITENANT.md` §7.1 define medición en tiempo real de 7 recursos y `RF-TENANT-012` es P1. Contar usuarios con `COUNT(*)` cada vez es viable; contar inferencias del mes sobre una tabla de 100M filas no. Falta `core.tenant_usage_counters`.

**ESC-08 — El particionamiento está bien pospuesto pero sin criterio objetivo.** La decisión 4.3 pide documentar las condiciones de activación. `DATABASE_DESIGN.md:902` solo dice «partition si > 100M rows» para `stock_records`. Umbrales propuestos en `DATABASE_RECONCILIATION_PLAN.md` §10.

---

## 7. PROBLEMAS DE CONCURRENCIA

**CONC-01 — La carrera conteo↔movimiento no tiene solución en el modelo actual.** Es CRIT-08 y es el problema de concurrencia más serio del sistema. Merece repetirse porque no es un detalle de implementación: **es la razón por la que hace falta un ledger**.

**CONC-02 — Lost update en `stock_records`** — ALTO-01. Sin `version`, dos ajustes concurrentes que leen 100 y escriben 95 y 90 dejan 90: se pierden 5 unidades sin traza ni error.

**CONC-03 — Doble aplicación por falta de idempotencia** — CRIT-12.

**CONC-04 — Inserción duplicada de stock** — CRIT-09.

**CONC-05 — Tres invariantes de exclusión sin candado** — ALTO-08. «Un solo training simultáneo por tenant» comprobado con `SELECT` y luego `INSERT` es la carrera de libro; dos peticiones simultáneas pasan ambas la comprobación.

**CONC-06 — `reserve`/`release` sin bloqueo documentado.** El `CHECK (reserved_quantity <= quantity)` protege la fila, pero dos reservas concurrentes de 60 sobre 100 unidades: ambas leen 0 reservado, ambas escriben 60, la segunda sobrescribe. El CHECK pasa (60 ≤ 100) y se han reservado 60 de 120 comprometidas. Necesita `SELECT ... FOR UPDATE` o una actualización condicional atómica.

**CONC-07 — El pooler y el contexto de sesión.** `RLS_STRATEGY.md` §9.2 lo resuelve con `is_local=true`, y es correcto. Pero **no hay ningún test que lo verifique**, y el modo de fallo es catastrófico y silencioso: si algún día una query corre fuera de la transacción que fijó el contexto, hereda el contexto de otro tenant a través de una conexión reutilizada del pool. Debe haber un test que ejecute dos requests de tenants distintos sobre la misma conexión del pool y verifique el aislamiento.

**CONC-08 — Refresh de vista materializada sin `CONCURRENTLY` documentado.** `RLS_STRATEGY.md` §6.1 crea el índice único necesario y menciona `CONCURRENTLY`; DR-002 §C lista «refresh de materialized views globales» como operación de `service_role`. Sin `CONCURRENTLY` el refresh toma `ACCESS EXCLUSIVE` y bloquea todas las lecturas del dashboard.

---

## 8. PROBLEMAS DE API

Además de CRIT-12, ALTO-10, ALTO-11, ALTO-12 y ALTO-19:

| ID | Problema | Referencia |
|---|---|---|
| API-01 | **Tres nombres para el mismo concepto de correlación:** `trace_id` en el cuerpo del error, `X-Request-Id` en el header, `correlation_id` en `audit.events`. `TERMINOLOGY.md` no cubre ninguno. Imposible correlacionar un error reportado por un usuario con su traza y su evento de auditoría. | `API_DESIGN.md:113`, `:147`, `DATABASE_DESIGN.md:772` |
| API-02 | **`GET/POST /v1/countries` contradice DR-005.** «Listar países del tenant» y `POST /v1/countries` presuponen el modelo rechazado. Debe ser `GET /v1/countries` (catálogo global, solo lectura) + `POST/PATCH /v1/tenant-countries` (activación). | `API_DESIGN.md:266-269` |
| API-03 | **Sin patrón genérico de trabajo asíncrono.** `POST /v1/reports/generate` → `GET /v1/reports/{id}` es un caso especial. No hay convención de `202 Accepted` + `Location`, ni recurso `/v1/jobs/{id}`, ni enum de estado. La instrucción §6 exige diseñar `JobDispatcher` desde Fase 0; la API no tiene su contrapartida. Afecta también a `POST /v1/audit/export` y `POST /v1/products/import`. | `API_DESIGN.md:407`, `:422`, `:315` |
| API-04 | **Solo dos endpoints bulk** (`/products/import`, `/areas/{id}/locations/bulk`). El tier de rate limiting «Bulk Operations» (`§9.2`) no tiene a qué aplicarse. Falta bulk para observaciones de conteo — una misión de dron produce miles, y una petición HTTP por observación no es viable — y para actualización de stock. | `API_DESIGN.md:493-497` |
| API-05 | **Webhooks sin firma ni reintentos ni configuración.** No hay HMAC, ni secreto compartido, ni política de retry, ni tabla de suscripciones. Es Fase 4, pero el documento los presenta como diseñados. | `API_DESIGN.md:444-477` |
| API-06 | **`DELETE` con semántica inconsistente.** `§2.3` lo declara idempotente y soft; `DELETE /v1/companies/{id}` es «desactivar», `DELETE /v1/roles/{id}` es borrado real (ALTO-14) y `DELETE /v1/auth/sessions/{id}` no es soft en ningún sentido. Tres semánticas bajo el mismo verbo. | `API_DESIGN.md:46`, `:274`, `:307`, `:260` |
| API-07 | **Rate limiting sin mecanismo.** Los límites por plan están tabulados, pero no se dice dónde se aplican (¿gateway? ¿middleware? ¿Redis?), y DR-009 dice que Redis no se instala todavía. Un rate limiter en memoria no funciona con más de una réplica, y `DEPLOYMENT.md:292` planifica 2-10 réplicas de backend. Tampoco se recoge la programación equitativa anti-vecino-ruidoso de `MULTITENANT.md` §10.3. | `API_DESIGN.md:480-497` |
| API-08 | **`?fields=` y `?sort=` multi-campo sin allowlist.** `sort=category,-name` construido dinámicamente sobre nombres de columna es superficie de inyección si no hay lista blanca, y `fields` permite pedir columnas que la capa de aplicación quizá filtra por permisos. | `API_DESIGN.md:221`, `:233` |
| API-09 | **`POST /v1/auth/login` delega en Supabase Auth pero el lockout es del backend.** La tarea 051 de `PHASE_0_PLAN.md` bloquea tras 5 intentos usando `core.users.failed_login_attempts`, lo que exige que el backend intercepte el fallo de GoTrue y actualice la fila. Nada define qué pasa si el usuario va directo a Supabase Auth (que es un endpoint público del proyecto), lo que **evade el contador por completo**. Además, contar por email permite bloquear la cuenta de un tercero a voluntad. | `API_DESIGN.md:251`, `PHASE_0_PLAN.md:144` |

---

## 9. PROBLEMAS DE TAREAS

**TASK-01 — Dos planes de Fase 0 con IDs colisionando** — ALTO-16. Es el problema de tareas más serio porque rompe la trazabilidad entre agentes: si Kiro dice «hecha la 014» y yo leo `PHASE_0_PLAN.md`, entiendo Alembic; si leo `TASKS.md`, entiendo warehouses/areas/locations. **Recomendación: declarar `TASKS.md` superseded para Fase 0** y mantenerlo solo como backlog de Fases 1-2, con prefijos de ID distintos (`F0-`, `F1-`).

**TASK-02 — Tareas prematuras.** `PHASE_0_PLAN.md` tarea 026 crea `audit.events` particionada, contra la decisión 4.3. Tarea 014 configura Alembic para los 8 schemas cuando Fase 0 solo usa `core`, `audit` y `public`.

**TASK-03 — Tareas no verificables.** Tarea 051 («account lockout») no dice cómo se intercepta el fallo de GoTrue (API-09). Tarea 043 tiene un criterio de aceptación que no se puede cumplir (CRIT-03). Tarea 038 («benchmark, todas usan Index Scan») no define el dataset de prueba: con 10 filas de seed el planner elige `Seq Scan` legítimamente y el criterio falla por razones equivocadas.

**TASK-04 — Tareas ausentes en Fase 0.** No hay tarea para: rol `olo_app` con `GRANT` de `authenticated` si se adopta la opción (a) de CRIT-03; test de aislamiento a través del pooler (CONC-07); test anti-recursión de RLS (RLS-04); `platform.privileged_operation_log` (ALTO-02); tabla de idempotencia (CRIT-12); exposición de schemas a PostgREST (RLS-06); ni migración de `public.currencies`.

**TASK-05 — Sin rollback en ninguna tarea.** Ni `TASKS.md` ni `PHASE_0_PLAN.md` definen procedimiento de reversión para las migraciones, que es precisamente donde importa. La instrucción §8 lo pide explícitamente. Incluido en `PHASE_0_EXECUTION_BACKLOG.md`.

**TASK-06 — Observabilidad presente pero incompleta.** `PHASE_0_PLAN.md` tareas 012 (logging estructurado) y 011 (health) están bien. Falta: métricas Prometheus (`RNF-OBS-003`), y `/v1/system/metrics` ya está en la API sin tarea que lo implemente.

**TASK-07 — Estimaciones.** `TASKS.md` estima Fase 0 en «~8 semanas, 2 devs» para 40 tareas; `PHASE_0_PLAN.md` tiene 82 tareas en las mismas 8 semanas. 82 tareas / 8 semanas / 2 devs ≈ 5 tareas por dev y semana, con tareas del tamaño de «design system: Modal, Drawer, Dropdown, Toast, Command Palette» (tarea 066). El diseño de Fase 0 es realista; **la estimación no lo es**. Añadiendo lo que falta (TASK-04) y las correcciones críticas, mi estimación es **11-13 semanas con 2 devs**.

**TASK-08 — Orden correcto en lo esencial.** Justo es decirlo: `PHASE_0_PLAN.md` respeta las dependencias importantes — RLS antes que datos, seguridad antes que módulos, contratos antes que pantallas. Sprint 0.2 completo antes de 0.3 es la secuencia correcta. El problema no es el orden, es el contenido de algunas tareas.

---

## 10. SOBREARQUITECTURA

Poco, y merece reconocerse: `RISK_ANALYSIS.md` no auditado aparte, el aplazamiento de K8s, sharding, marketplace, SDK y Digital Twin está bien hecho.

| ID | Ítem | Recomendación |
|---|---|---|
| OVER-01 | **8 schemas creados en Fase 0** cuando solo se usan 3. El script `check-rls` recorrería 5 schemas vacíos. | Crear `core`, `audit`, `public` en Fase 0. Los demás con su primera tabla. |
| OVER-02 | **Enums como CHECK de strings en 20+ columnas.** `DATABASE_DESIGN.md:19` dice «PostgreSQL ENUM types o lookup tables» y luego usa una tercera opción no documentada. Añadir un motor de IA a `ai.models.engine_type` (7 valores hoy, `RF-IA-015` promete 5 más) requiere migración con `ALTER ... DROP CONSTRAINT` + recrear. Igual en `connectors.type` (9 valores, `RF-INT-011` añade 4). | Catálogo (`lookup table`) para lo extensible: engines, connector types, adjustment reasons, incident types. CHECK para lo cerrado: status, severity. |
| OVER-03 | **`?fields=`, `?include=` y `sort` multi-campo en la v1 de la API.** Tres mecanismos de flexibilidad con coste de implementación, de test y de seguridad (API-08), antes de tener un solo cliente. | Posponer a Fase 1. Empezar con paginación, filtros fijos y un `sort` de un campo. |
| OVER-04 | **`ai-service` con CUDA en el compose de Fase 0** cuando Fase 0 excluye IA explícitamente. Obliga a todo dev a descargar una imagen de CUDA de varios GB. | Sacarlo del compose de Fase 0. |
| OVER-05 | **ABAC especificado en detalle** (`SECURITY.md` §3.1, condiciones por horario, IP, geolocalización) para un `RF-RBAC-009` que es P3/Fase 2. | Correctamente priorizado en requisitos; basta marcar la sección de SECURITY como diseño futuro para que nadie lo implemente en Fase 0. |

---

## 11. RECOMENDACIONES

**Antes de la primera migración (bloqueante):**

1. Arbitrar CRIT-02 (herramienta de migraciones). Sin esto no hay migración.
2. Arbitrar CRIT-03 (propagación de claims backend→RLS). Define las funciones de contexto y el rol de conexión.
3. Arbitrar CRIT-04/CRIT-05 (imagen de Postgres en CI y stack local). Define si los tests de RLS existen de verdad.
4. Aplicar CRIT-01, CRIT-06, CRIT-07, CRIT-10, ALTO-04, ALTO-23 sobre el modelo objetivo. Son correcciones mecánicas, ya especificadas en `DATABASE_RECONCILIATION_PLAN.md`.
5. Fijar los tres escenarios de escala (ESC-01) para poder justificar índices y retención.

**Durante Fase 0:**

6. Añadir `platform.privileged_operation_log` (ALTO-02) y `core.idempotency_keys` (CRIT-12) al alcance de Sprint 0.2. Ambos son requisitos de decisiones ya aprobadas.
7. Añadir los tres tests que faltan: aislamiento a través del pooler (CONC-07), anti-recursión de RLS (RLS-04), y máquinas de estado (INT-10).
8. Renumerar tareas con prefijo de fase y declarar `TASKS.md` superseded para Fase 0 (TASK-01).
9. Alinear el modelo de auditoría con la decisión 4.9 **antes** de escribir la tabla (ALTO-03). Cambiar el esquema de auditoría después es de las migraciones más caras que existen.

**Antes de Fase 1 (inventarios):**

10. Decidir CRIT-08 (ledger de movimientos). Es la decisión de modelo más consecuente que queda abierta y condiciona ajustes, conteos, trazabilidad y valorización.
11. Implementar optimistic locking (ALTO-01) con su transporte en API, no solo la columna.
12. Resolver los umbrales de stock por almacén (ALTO-15).

**Transversal:**

13. Sincronizar los documentos originales según `DOCUMENT_CONFLICT_MATRIX.md`, con `RLS_STRATEGY.md` v2.0 y `DECISION_REGISTER.md` como fuentes, **una vez arbitradas** las decisiones abiertas. Sincronizar antes del arbitraje solo propagaría el conflicto.

---

## 12. DECISIONES PENDIENTES

Detalle completo, alternativas e impacto en `DOCUMENT_CONFLICT_MATRIX.md`. Resumen:

| ID | Decisión | Bloquea | Mi recomendación |
|---|---|---|---|
| **DEC-01** | Herramienta de migraciones: Alembic (DR-006) vs Supabase CLI | **La primera migración** | Supabase CLI |
| **DEC-02** | Propagación de claims backend→RLS: emular PostgREST (`SET LOCAL request.jwt.claims` + `SET ROLE authenticated`) vs `olo_app` + GUC propio para todo tráfico de backend | **Sprint 0.3 y las funciones de contexto** | Emular PostgREST para tráfico de usuario; `olo_app` solo para workers sin usuario. Mantiene un solo modelo de autorización y respeta la instrucción §5. |
| **DEC-03** | Imagen de Postgres en CI y stack local: `supabase/postgres` + CLI vs `postgres:15` con stub del schema `auth` | **Todos los tests de RLS** | `supabase start` en local y CLI en CI. Resuelve CRIT-04 y CRIT-05 juntos. |
| **DEC-04** | ¿Un humano puede pertenecer a más de un tenant? Hoy `core.users.auth_id UNIQUE` global lo prohíbe | Modelo de membresía, Hook, `/v1/auth/me` | Mantener 1 usuario = 1 tenant en Fase 0, **documentándolo como limitación consciente**. Introducir `core.memberships` solo si aparece el caso real. |
| **DEC-05** | Integridad de la jerarquía desnormalizada: FK compuestas (con UNIQUE redundantes) vs solo triggers | Migración de `core.areas`/`locations` | FK compuestas. Garantía del motor, coste solo de índice. Triggers como refuerzo secundario, según la instrucción 4.1. |
| **DEC-06** | `audit.events` en Fase 0: particionada (DATABASE_DESIGN) o simple (decisión 4.3) | Migración de `audit` | Sin particionar, `id UUID PRIMARY KEY`. Umbral de activación documentado. |
| **DEC-07** | Ajustes de stock: delta sobre ledger vs sobrescritura absoluta | Fase 1 completa; conviene decidir ya | Ledger (`inventory.stock_movements`). Es la única forma de que CRIT-08 y CONC-01 tengan solución. |
| **DEC-08** | `TASKS.md`: ¿superseded para Fase 0, o renumerado? | Trazabilidad entre agentes | Superseded para Fase 0; renumerar con prefijos `F0-`/`F1-`. |

**DEC-01, DEC-02 y DEC-03 son bloqueantes absolutos.** Las cinco restantes se pueden trabajar en paralelo, pero DEC-05 y DEC-06 deben cerrarse antes de la migración de `core` y `audit` respectivamente, que son las dos primeras.

---

*Auditoría técnica independiente. No se ha modificado ningún documento original.*
*Claude Code — 2026-07-28*
