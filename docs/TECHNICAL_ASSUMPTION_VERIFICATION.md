# OLO_IA — VERIFICACIÓN EMPÍRICA DE SUPUESTOS TÉCNICOS

> **Autor:** Claude Code. **Fecha:** 2026-07-28
> **Propósito:** confirmar o refutar contra una base de datos real las cinco afirmaciones críticas de `CLAUDE_TECHNICAL_AUDIT.md` que hasta ahora eran deducciones sobre la semántica de PostgreSQL.
> **Resultado global:** **5 de 5 hipótesis CONFIRMADAS.** Una con un mecanismo distinto del que predije (V2) — corregido más abajo.
> **Ninguna migración creada. No se tocó producción. Todos los recursos temporales eliminados (§9).**

---

## 1. ENTORNO DE PRUEBA

Desechable por construcción: binarios portables, sin instalación, sin servicio de Windows, sin entradas de registro, en puerto no estándar.

| Elemento | Valor |
|---|---|
| Motor | PostgreSQL **15.8** (`compiled by Visual C++ build 1940, 64-bit`) |
| Origen | `https://get.enterprisedb.com/postgresql/postgresql-15.8-1-windows-x64-binaries.zip` (319,1 MB) |
| Instalación | Ninguna. Extracción selectiva de `pgsql/bin`, `pgsql/lib`, `pgsql/share` al scratchpad |
| Cluster | `initdb -A trust -E UTF8 --locale=C` en directorio temporal |
| Puerto | `55432`, `listen_addresses=127.0.0.1` |
| Cliente SQL | `psql` 15.8 de los mismos binarios |
| Cliente Python | **asyncpg 0.31.0** sobre **Python 3.14.6**, en venv temporal |
| Producción | **No tocada.** Sin proyecto Supabase conectado en ningún momento |

**Por qué PostgreSQL vanilla es el sujeto correcto.** Cuatro de las cinco hipótesis son sobre semántica del motor, idéntica en cualquier distribución. La quinta (V3) afirma precisamente que *falta* lo que Supabase añade, así que un PostgreSQL sin tocar es el proxy fiel de la imagen `postgres:15` para ese propósito.

**Limitación declarada:** V3 se verificó sobre una instalación local de PostgreSQL 15.8, no sobre el contenedor `postgres:15` de Docker Hub. La afirmación verificada es «PostgreSQL sin las migraciones de plataforma de Supabase carece del schema `auth`, de sus funciones y de sus roles». Esa es la afirmación relevante; la imagen concreta no cambia el resultado, pero no la he ejecutado.

---

## 2. VERIFICACIÓN 1 — `audit.events` particionada no se puede crear

### Hipótesis
El DDL de `DATABASE_DESIGN.md:757-774` es rechazado por PostgreSQL, porque declara `id UUID PRIMARY KEY` sobre una tabla `PARTITION BY RANGE (created_at)` y el motor exige que toda constraint única incluya las columnas de partición.

### Preparación
Schema `t1` vacío. Cuatro variantes: el DDL tal cual, con PK compuesta, sin particionar, y con `UNIQUE` en lugar de `PRIMARY KEY`.

### Comando
```
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -f t1_audit_partition.sql
```

### Resultado y evidencia

**1A — DDL exacto del documento:**
```
ERROR:  unique constraint on partitioned table must include all partitioning columns
DETAIL:  PRIMARY KEY constraint on table "events_asis" lacks column "created_at"
         which is part of the partition key.
```

**1B — con `PRIMARY KEY (id, created_at)`:** `CREATE TABLE`
**1C — sin particionar, `event_id UUID PRIMARY KEY` (forma DEC-06):** `CREATE TABLE`

**1D — el mismo fallo con `UNIQUE`, no solo con `PRIMARY KEY`:**
```
ERROR:  unique constraint on partitioned table must include all partitioning columns
DETAIL:  UNIQUE constraint on table "events_unique" lacks column "created_at"
         which is part of the partition key.
```

**1E — qué quedó creado:**
```
        relname        |     tipo
-----------------------+--------------
 events_compuesta      | particionada
 events_dec06          | normal
```
`events_asis` y `events_unique` no existen.

### Conclusión
**CONFIRMADA.** La tabla de auditoría tal como está especificada **no se puede crear**. No es un aviso ni una degradación: el `CREATE TABLE` aborta. La primera migración de `audit` habría fallado.

Hallazgo adicional no previsto: la restricción alcanza a **cualquier** constraint única, no solo a la primaria. Esto importa porque `audit.events` no puede tener ninguna clave única que no incluya `created_at` mientras esté particionada — lo que descarta también la variante «PK compuesta + UNIQUE(event_id) para referencias externas».

### Impacto en diseño
Confirma **DEC-06** en su totalidad. `audit.events` en Fase 0 va sin particionar, con `event_id UUID PRIMARY KEY` simple, según ya aprobado. Cuando la retención active el particionamiento, la PK deberá pasar a `(event_id, occurred_at)` y **eso implica recrear la tabla**, así que la nota de `DATABASE_RECONCILIATION_PLAN.md` §10.3 sobre preparar PK compuestas desde el inicio en tablas de serie temporal queda reforzada con evidencia.

---

## 3. VERIFICACIÓN 2 — `core.soft_delete()` convierte cualquier UPDATE en borrado

### Hipótesis
La función de `DATABASE_DESIGN.md:852-858`, enganchada como `BEFORE UPDATE`, marca `deleted_at` en toda actualización, de modo que renombrar un almacén lo elimina lógicamente.

### Preparación
Tabla `t2.warehouses` con la función y el trigger exactos del documento. Una fila viva. Tres escenarios: `BEFORE UPDATE`, `BEFORE DELETE`, y el patrón correcto sin trigger.

### Comando
```
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -f t2_soft_delete.sql
```

### Resultado y evidencia

**2A — solo se renombra el almacén:**
```
--- estado inicial: fila viva ---
 id |      name       | vivo
----+-----------------+------
  1 | Almacen Central | t

--- ahora solo RENOMBRAMOS el almacen ---
UPDATE 1

--- estado tras el rename: ¿sigue vivo? ---
 id |     name      | vivo |          deleted_at
----+---------------+------+-------------------------------
  1 | Almacen Norte | f    | 2026-07-28 14:31:20.055848-06
```

**2B — la misma función como `BEFORE DELETE`:**
```
--- intento de DELETE (se espera ERROR o borrado real) ---
DELETE 1
--- ¿queda la fila? ---
 filas_restantes
-----------------
               0
```

**2C — patrón correcto, `UPDATE` explícito sin trigger:**
```
--- rename NO borra ---            vivo = t
--- soft delete explicito SI borra --- vivo = f
```

### Conclusión
**CONFIRMADA.** Un `UPDATE` que solo cambia el nombre deja la fila con `deleted_at` relleno. Todo almacén, área, ubicación o producto que alguien edite queda borrado lógicamente.

**Corrección a mi propia auditoría.** En `CLAUDE_TECHNICAL_AUDIT.md` CRIT-06 escribí que como `BEFORE DELETE` la función «tampoco sirve» porque «la fila `NEW` no existe» y daría error. **Es incorrecto:** PL/pgSQL acepta la asignación a `NEW` en un trigger de `DELETE` sin protestar, el `RETURN NEW` no cancela nada y **el borrado físico se ejecuta** (`DELETE 1`, cero filas restantes). No hay error de ningún tipo.

El resultado es peor de lo que describí: en lugar de fallar de forma visible, la función **no hace absolutamente nada y el borrado duro ocurre en silencio**. Un equipo que la enganchara a `BEFORE DELETE` creyendo tener soft delete tendría borrado permanente sin ninguna señal.

### Impacto en diseño
La función se **elimina**, no se corrige — ya recogido en el acuerdo sobre el defecto de soft delete. Ninguna de sus dos formas de uso es salvable. El soft delete se hace con `UPDATE ... SET deleted_at = now()` en el repositorio, o mediante RPC autorizada y auditada, y la lectura pasa por vistas `_active` con `security_invoker = true`.

---

## 4. VERIFICACIÓN 3 — `postgres:15` plano no sirve para el CI

### Hipótesis
PostgreSQL sin las migraciones de plataforma de Supabase carece del schema `auth`, de `auth.jwt()`/`auth.uid()` y de los roles de Supabase; por tanto las funciones de contexto de `RLS_STRATEGY.md` v2.0 no se pueden crear y el job de tests muere en la migración, antes de ejecutar un solo test.

### Preparación
Cluster limpio. Inspección de catálogos y intento de crear `core.current_tenant_id()` tal como está especificada.

### Comando
```
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -f t3_vanilla_pg.sql
```

### Resultado y evidencia

**3B — schemas de Supabase:**
```
 schema_auth | schema_storage | schema_realtime | schema_extensions | schema_graphql
-------------+----------------+-----------------+-------------------+----------------
             |                |                 |                   |
```
Todos NULL.

**3C — funciones de contexto:**
```
 fn_auth_jwt | fn_auth_uid | fn_auth_role
-------------+-------------+--------------
             |             |
```
Todas NULL.

**3D — roles de Supabase** (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`, `authenticator`, `supabase_admin`, `supabase_storage_admin`):
```
(0 rows)
```

**3E — schemas realmente presentes:** `information_schema`, `public` (más los de prueba).

**3F — intento de crear `core.current_tenant_id()` de RLS v2.0:**
```
ERROR:  schema "auth" does not exist
LINE 8:     NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')...
                   ^
```

**3G — la función no existe:** `fn_creada` vacío.
**3H — la variante que solo lee el GUC sí se crea:** `core.current_tenant_id_guc()`.

### Conclusión
**CONFIRMADA, y el modo de fallo es el que describí.** El error ocurre en `CREATE FUNCTION`, no al ejecutar un test. En un pipeline eso significa que **la migración aborta y ningún test de aislamiento llega a correr**: el CI quedaría verde en lint y tipos, y sin una sola verificación de que un tenant no ve los datos de otro.

### Impacto en diseño
Confirma **DEC-03**: el CI debe levantar Supabase local, y `postgres:15` plano no es suficiente **mientras las funciones de contexto dependan de `auth.jwt()`**.

**Mitigación adicional descubierta en V4 (§5, sub-prueba 4F), que conviene incorporar por robustez:** si las funciones de contexto leen `current_setting('request.jwt.claims', true)` **directamente** en lugar de a través de `auth.jwt()`, funcionan igual y **son portables a PostgreSQL vanilla**. `auth.jwt()` de Supabase es, esencialmente, un envoltorio sobre ese mismo `current_setting`. Leerlo directo no cambia el comportamiento en Supabase y desacopla la suite de RLS del stack completo.

Esto **no revierte DEC-03** — el stack completo sigue siendo necesario para probar GoTrue, el Custom Access Token Hook, Storage y Realtime. Lo que aporta es que la parte más valiosa y frecuente de la suite (aislamiento entre tenants) podría ejecutarse también sobre un Postgres ligero, lo que abarata el bucle local y da un camino de respaldo si Docker Desktop no está disponible — situación real hoy en esta máquina, donde no hay Docker instalado.

---

## 5. VERIFICACIÓN 4 — asyncpg no recibe `request.jwt.claims`

### Hipótesis
Una conexión asyncpg no obtiene `request.jwt.claims` automáticamente, porque ese GUC lo fija PostgREST por request y no forma parte del protocolo de PostgreSQL. En consecuencia, la tarea 043 de `PHASE_0_PLAN.md` («NO usar `set_config` cuando hay JWT») produciría RLS denegando todas las filas.

### Preparación
Rol `olo_app` con `LOGIN NOBYPASSRLS NOINHERIT`. Tabla `t4.products` con `ENABLE` + `FORCE ROW LEVEL SECURITY` y el patrón `RESTRICTIVE` + `PERMISSIVE` de RLS v2.0. Tres filas: dos del tenant A, una del tenant B. Función de contexto **híbrida** que lee `request.jwt.claims` y cae al GUC `app.tenant_id`. Conexión como `olo_app`, no como superusuario.

### Comando
```
venv\Scripts\python.exe t4_asyncpg_context.py
```

### Resultado y evidencia

```
conectado como: olo_app  bypassrls=False

=== 4A: ¿asyncpg establece request.jwt.claims por si solo? ===
  current_setting('request.jwt.claims', true) = None
  t4.current_tenant_id()                      = None

=== 4B: consecuencia sobre RLS sin contexto ===
  SELECT count(*) FROM t4.products = 0

=== 4C: SET LOCAL FUERA de transaccion explicita (autocommit) ===
  tras SET LOCAL, app.tenant_id = ''
  count(*) = 0   <- sigue sin ver nada

=== 4D: set_config parametrizado DENTRO de transaccion explicita (DEC-02 camino B) ===
  app.tenant_id           = '11111111-1111-1111-1111-111111111111'
  t4.current_tenant_id()  = UUID('11111111-1111-1111-1111-111111111111')
  filas visibles          = ['A-1', 'A-2']   <- solo las del tenant A
  todas del tenant A      = True

=== 4E: ¿el contexto se filtra a la transaccion siguiente en la MISMA conexion? ===
  app.tenant_id = ''
  count(*)      = 0   <- 0 = no hay fuga por pool

=== 4F: camino A (claims del JWT) emulado sobre la misma funcion hibrida ===
  t4.current_tenant_id() = UUID('22222222-2222-2222-2222-222222222222')
  filas visibles         = ['B-1']   <- solo las del tenant B

=== 4G: precedencia cuando ambos canales estan presentes ===
  JWT=B, GUC=A -> current_tenant_id() = UUID(...2222)  (gana el JWT)

=== 4H: INSERT cross-tenant bajo WITH CHECK ===
  INSERT con tenant ajeno: RECHAZADO -> InsufficientPrivilegeError:
  new row violates row-level security policy for table "products"
```

### Conclusión
**CONFIRMADA**, y con cinco resultados adicionales de valor para el diseño:

1. **4A/4B — el hallazgo principal.** `request.jwt.claims` es `None` en una conexión asyncpg limpia, y la consecuencia es RLS devolviendo cero filas. La tarea 043 tal como está escrita produce exactamente el fallo que anticipé en CRIT-03: aislamiento aparentemente perfecto que en realidad no deja trabajar a nadie.
2. **4C — `SET LOCAL` fuera de transacción explícita es un no-op silencioso.** El valor queda en cadena vacía, sin error. Con asyncpg en autocommit cada sentencia es su propia transacción, así que el `SET LOCAL` muere inmediatamente. Confirma que el contexto **debe** establecerse dentro de una transacción explícita.
3. **4D — el camino B de DEC-02 funciona.** `set_config(..., is_local => true)` con parámetro ligado, dentro de transacción, filtra correctamente al tenant A.
4. **4E — no hay fuga de contexto entre transacciones de la misma conexión.** Al terminar la transacción el GUC vuelve a vacío. Esto **valida empíricamente la compatibilidad con el pooler en modo transaction**, que era una suposición de `RLS_STRATEGY.md` §9.2 y el riesgo CONC-07 sin verificar.
5. **4F/4G — la función híbrida funciona por ambos canales, con precedencia del JWT.** Y funciona **sin el schema `auth`**, leyendo `request.jwt.claims` directamente (ver §4, impacto en diseño).
6. **4H — `WITH CHECK` bloquea el INSERT cross-tenant** con `InsufficientPrivilegeError`, no lo filtra en silencio.

### Impacto en diseño
Confirma **DEC-02** completo y **obliga a reescribir la tarea 043 de `PHASE_0_PLAN.md`**, cuyo criterio de aceptación es inalcanzable tal como está redactado.

Requisitos que pasan de recomendación a obligación verificada para el middleware:
- Transacción explícita **siempre**. Sin ella el contexto no existe y RLS deniega todo.
- `set_config(clave, valor, true)` con parámetro ligado. Nunca `SET LOCAL` con interpolación de cadenas — inseguro y, en autocommit, además inútil.
- Los cuatro GUCs aprobados (`app.auth_user_id`, `app.tenant_id`, `app.request_id`, `app.correlation_id`) se fijan en el mismo `set_config` múltiple, dentro de la transacción.
- El test de fuga por pooler (F0-221) tiene ahora un resultado esperado conocido y verificado.

---

## 6. VERIFICACIÓN 5 — Las FK compuestas impiden la jerarquía cruzada

### Hipótesis
El diseño actual, con tres FK independientes, **permite** insertar una `location` cuya `area_id` pertenece a otro almacén o cuyo `tenant_id` no corresponde a la jerarquía. Las FK compuestas de DEC-05 lo **impiden** a nivel de motor.

### Preparación
Dos réplicas de la jerarquía. Schema `t5` con las FK independientes de `DATABASE_DESIGN.md:171-199`; schema `t5b` con `UNIQUE (tenant_id, id)` / `UNIQUE (tenant_id, warehouse_id, id)` como destinos y FK compuestas. Datos: tenant A con dos almacenes, tenant B con uno, un área en A-WH1.

### Comando
```
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -f t5_fk_compuesta.sql
```

### Resultado y evidencia

**Parte A — diseño actual. Los tres inserts salen adelante:**
```
--- A1: location coherente ---                 INSERT 0 1
--- A2: location con warehouse_id=WH2 pero area_id de WH1 --- INSERT 0 1
--- A3: area del tenant B en un warehouse del tenant A ---    INSERT 0 1

--- A4: incoherencias presentes en el diseno actual ---
  location  | dice_warehouse | pero_area_esta_en
------------+----------------+-------------------
 CRUZADA-WH | A-WH2          | A-WH1-AREA1

       area        | tenant_del_area | tenant_del_warehouse
-------------------+-----------------+----------------------
 B-AREA-EN-WH-DE-A | Tenant B        | Tenant A
```

**Parte B — FK compuestas. Los tres ataques rechazados:**
```
--- B1: location coherente ---  INSERT 0 1

--- B2: area_id de otro warehouse ---
ERROR:  insert or update on table "locations" violates foreign key constraint "fk_loc_area"
DETAIL:  Key (tenant_id, warehouse_id, area_id)=(1111...1111, aaaa...0002, a1a1...0001)
         is not present in table "areas".

--- B3: area del tenant B en warehouse del tenant A ---
ERROR:  insert or update on table "areas" violates foreign key constraint "fk_area_warehouse"
DETAIL:  Key (tenant_id, warehouse_id)=(2222...2222, aaaa...0001)
         is not present in table "warehouses".

--- B4: location con tenant_id ajeno a la jerarquia ---
ERROR:  insert or update on table "locations" violates foreign key constraint "fk_loc_area"
DETAIL:  Key (tenant_id, warehouse_id, area_id)=(2222...2222, aaaa...0001, a1a1...0001)
         is not present in table "areas".

--- B5: incoherencias presentes con FK compuestas ---
 locations_incoherentes = 0
 areas_cross_tenant     = 0
 codigos supervivientes = OK-01
```

### Conclusión
**CONFIRMADA en las dos direcciones**, que es lo que hace la prueba concluyente: no solo el remedio funciona, además el defecto es real y reproducible.

Los **tres invariantes** que la decisión 4.1 encarga garantizar quedan cubiertos por las FK compuestas: `area_id` de otro almacén (B2), `warehouse_id` de otro tenant (B3), y `tenant_id` incoherente con la jerarquía (B4). Los tres fallan con violación de clave foránea, sin trigger y sin lógica de aplicación.

Y el diseño actual permite construir exactamente el escenario peligroso: una `location` que RLS protege según `warehouse_id` mientras la aplicación la alcanza navegando por `area_id`. Los dos identificadores apuntan a almacenes distintos.

### Impacto en diseño
Confirma **DEC-05**. El patrón de `DATABASE_RECONCILIATION_PLAN.md` §7 se aplica tal cual: 5 índices únicos redundantes como destino y 14 FK compuestas. Coste medido: un índice adicional por tabla padre. Los tests de F0-213 tienen ya sus mensajes de error esperados.

---

## 7. VERIFICACIÓN 6 (adicional) — Mis propias correcciones

No estaba en el encargo. La incluyo porque verificar solo los defectos ajenos y dar por buenas mis propuestas sería incoherente.

### Comando
```
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -f t6_mis_propuestas.sql
```

### 6A/6B — `prevent_tenant_change`: `!=` frente a `IS DISTINCT FROM`

```
--- con != , cambio de tenant a NULL ---
UPDATE 1
 id | tenant_quedo_null
----+-------------------
  1 | t

--- con IS DISTINCT FROM, cambio a NULL ---
ERROR:  cannot change tenant_id of existing record
        (11111111-1111-1111-1111-111111111111 -> <NULL>)

--- update legitimo que no toca tenant_id ---
UPDATE 1   (tenant_id intacto)
```

**CONFIRMADO.** Con `!=`, poner `tenant_id` a NULL **atraviesa el trigger sin error**: la comparación da NULL, el `IF` no entra. Es un escape de tenant que el trigger existente no detecta. `IS DISTINCT FROM` lo corta y sigue permitiendo los updates legítimos. La corrección de ALTO-23 es necesaria, no cosmética.

### 6C/6D — Clave lógica de stock con `COALESCE`

```
--- 6C: primera fila, lot_number NULL ---   INSERT 0 1
--- 6D: duplicado logico, lot_number NULL ---
ERROR:  duplicate key value violates unique constraint "uq_stock_logical"
DETAIL:  Key (..., COALESCE(lot_number, ''::text), COALESCE(serial_number, ''::text), status)
         =(..., , , available) already exists.

--- 6D-bis: el MISMO indice SIN COALESCE ---
INSERT 0 2
 filas_duplicadas_sin_coalesce | cantidad_partida
-------------------------------+------------------
                             2 |          80.0000
```

**CONFIRMADO en ambas direcciones.** Sin `COALESCE`, el índice único **no protege nada** cuando las columnas nulables son NULL: entran dos filas del mismo stock lógico y la cantidad queda partida en 50 + 30. Con `COALESCE`, el duplicado se rechaza. Es exactamente el modo de fallo de CRIT-09, reproducido.

### 6E — CHECK de número de serie
```
--- serial con quantity = 40 ---  ERROR: violates check constraint "chk_serial_qty"
--- serial con quantity = 1  ---  INSERT 0 1
```
**CONFIRMADO.** La decisión 4.11 es implementable con un CHECK de una línea.

### 6F — `chk_files_path_tenant`
```
--- ruta propia del tenant ---            INSERT 0 1
--- ruta de OTRO tenant ---               ERROR: violates check constraint
--- ruta con escape "../../etc/passwd" -- ERROR: violates check constraint
 archivos_registrados = 1
```
**CONFIRMADO, y cubre más de lo previsto.** El CHECK bloquea tanto el registro de un archivo en la ruta de otro tenant como el escape de directorio, que no había considerado al proponerlo. Hace imposible a nivel de motor que `core.files` apunte fuera del prefijo del tenant.

### 6G — `prevent_role_cycle`
```
--- jerarquia lineal admin <- manager <- operator ---  creada
--- cerrar el ciclo: admin.parent = operator ---
ERROR:  circular role inheritance detected on role 1
--- auto-referencia: manager.parent = manager ---
ERROR:  circular role inheritance detected on role 2
--- estado final: intacto (3 filas, sin ciclos) ---
```
**CONFIRMADO.** Detecta el ciclo indirecto y la auto-referencia, y deja el estado intacto. Cubre ALTO-13.

### Conclusión de §7
Las seis correcciones que propuse funcionan como especifiqué, y dos de ellas (6A y 6D-bis) demuestran además que los defectos que corrigen son reales y reproducibles, no teóricos.

---

## 8. RESUMEN

| # | Hipótesis | Veredicto | Precisión de la predicción |
|---|---|---|---|
| **V1** | `audit.events` particionada no se crea | **CONFIRMADA** | Exacta. Extra: afecta a `UNIQUE`, no solo a `PRIMARY KEY` |
| **V2** | `soft_delete()` afecta a cualquier UPDATE | **CONFIRMADA** | El caso `BEFORE UPDATE` exacto. **El caso `BEFORE DELETE` lo predije mal** (§3) |
| **V3** | `postgres:15` plano no basta para el CI | **CONFIRMADA** | Exacta, incluido el fallo en `CREATE FUNCTION`. Extra: mitigación portable |
| **V4** | asyncpg no recibe `request.jwt.claims` | **CONFIRMADA** | Exacta. Extra: pooler seguro, precedencia, `SET LOCAL` no-op |
| **V5** | FK compuestas impiden jerarquía cruzada | **CONFIRMADA** | Exacta en ambas direcciones |
| **V6** | Mis seis correcciones funcionan | **CONFIRMADAS** | Extra: `chk_files_path_tenant` bloquea también el escape de directorio |

**5 de 5 confirmadas.** Una corrección a mi propia auditoría (V2, caso `BEFORE DELETE`): predije un error y la realidad es un no-op silencioso con borrado físico, que es peor. La conclusión —eliminar la función— no cambia.

### Supuestos que quedan sin verificar y por qué

| Supuesto | Estado | Cómo verificarlo |
|---|---|---|
| El Custom Access Token Hook PL/pgSQL funciona en el plan Supabase contratado | **Sin verificar** | Requiere GoTrue. Tarea F0-301 |
| `jsonb_set` sin `app_metadata` previo devuelve el objeto sin cambios (CRIT-11) | **Sin verificar** | Verificable en vanilla; no entraba en el encargo |
| Sobrecoste real de RLS y de `accessible_warehouse_ids()` (RLS-03) | **Sin verificar** | Necesita ≥100k filas. Tarea F0-222 |
| `postgres:15` de Docker Hub específicamente | **Sin verificar** | Verificado el equivalente local. No hay Docker en esta máquina |

---

## 9. LIMPIEZA DE RECURSOS TEMPORALES

Ejecutada al terminar. Nada persiste fuera del scratchpad de la sesión.

| Recurso | Acción |
|---|---|
| Cluster PostgreSQL en `:55432` | `pg_ctl stop -m immediate` |
| Directorio de datos (`pgdata`) | Eliminado |
| Binarios portables (`pgx`, `pg15.zip`) | Eliminados |
| venv con asyncpg | Eliminado |
| Scripts SQL y Python de prueba | Eliminados |
| Rol `olo_app` de prueba | Desaparece con el cluster |
| Servicio de Windows | **Ninguno creado** |
| Entradas de registro | **Ninguna creada** |
| PATH del sistema | **No modificado** |
| Proyecto Supabase / producción | **No tocado en ningún momento** |

Evidencia de la limpieza en §10.

---

## 10. EVIDENCIA DE LIMPIEZA

**Parada del cluster:**
```
=== parando el cluster ===
waiting for server to shut down.... done
server stopped

=== procesos postgres restantes ===
ninguno
=== puerto 55432 ===
cerrado
```

**Borrado de recursos:**
```
eliminado  pgdata
eliminado  pgx
eliminado  pg15.zip
eliminado  venv
eliminado  pg.log
eliminado  t1_audit_partition.sql
eliminado  t2_soft_delete.sql
eliminado  t3_vanilla_pg.sql
eliminado  t4_asyncpg_context.py
eliminado  t5_fk_compuesta.sql
eliminado  t6_mis_propuestas.sql
```

**Estado final del sistema:**
```
scratchpad        : vacio
procesos postgres : 0
servicios pg      : 0
psql en PATH      : no
PATH usuario mod. : no
```

El único artefacto persistente es `C:\Users\arojast\AppData\Local\Programs\supabase\supabase.exe` (Supabase CLI 2.110.0), que es una **instalación permanente y deliberada** de una tarea anterior, no un recurso temporal de estas pruebas.

**Nota sobre reproducibilidad.** Los seis scripts de prueba se eliminaron según lo instruido. Sus comandos y salidas quedan íntegros en §2-§7, que es suficiente para reconstruirlos. Si se quiere conservarlos ejecutables, su sitio es `backend/tests/rls/` en el repositorio —varios son directamente el germen de la suite de F0-221— y no el scratchpad.

---

*Verificación empírica de supuestos técnicos. Ninguna migración creada. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
