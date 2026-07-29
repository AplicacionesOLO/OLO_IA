# OLO_IA — ESPECIFICACIÓN TÉCNICA DE IMPLEMENTACIÓN

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Versión:** 1.0. **Estado:** contrato vinculante.
>
> **Este documento es la especificación definitiva para comenzar las migraciones.** Contiene decisiones implementables, no ideas. Entregado a cualquier desarrollador, debe permitir construir exactamente el mismo sistema.
>
> **Ninguna migración creada. Ningún documento original modificado.**

---

## 1. JERARQUÍA DE AUTORIDAD

Cuando dos documentos discrepan, manda el de arriba.

| # | Fuente | Naturaleza |
|---|---|---|
| 1 | **PostgreSQL, Supabase, FastAPI, React** — el comportamiento real | Hechos verificables |
| 2 | **`TECHNICAL_ASSUMPTION_VERIFICATION.md`** | Comportamiento medido |
| 3 | **Decisiones arbitradas** (DEC-01…DEC-13, `DECISION_REGISTER.md`) | Decisiones humanas |
| 4 | **Esta especificación y sus seis documentos hermanos** | Contrato de implementación |
| 5 | Los 18 documentos de Kiro | **Documentación funcional y arquitectónica** |

Kiro deja de ser fuente de verdad técnica. Sus documentos siguen siendo la referencia para *qué* hace el producto y *por qué*; esta especificación define *cómo* se construye.

### 1.1 Los siete documentos del contrato

| Documento | Contenido |
|---|---|
| **`TECHNICAL_IMPLEMENTATION_SPEC.md`** | Este. Índice, stack, validación crítica, decisiones cerradas |
| `FINAL_DATABASE_MODEL.md` | Las 55 entidades con sus 10 atributos cada una |
| `IDENTITY_AND_AUTH_FLOW.md` | Revisión de DEC-04, tenant activo, autorización |
| `INVENTORY_ENGINE_SPEC.md` | Ledger, balances, las 10 operaciones, concurrencia |
| `RLS_IMPLEMENTATION_GUIDE.md` | Las 7 plantillas, 7 funciones, contrato de pruebas |
| `MIGRATION_ROADMAP.md` | 56 migraciones ordenadas con rollback y riesgo |
| `IMPLEMENTATION_SEQUENCE.md` | Implementation map y 6 puertas de verificación |

---

## 2. STACK — VINCULANTE

| Capa | Tecnología | Fijado por |
|---|---|---|
| Base de datos | PostgreSQL 15+ vía Supabase | `RT-003` |
| Migraciones | **Supabase CLI**, fuente única | **DEC-01** |
| Autenticación | Supabase Auth (GoTrue) + Custom Access Token Hook PL/pgSQL | `RT-004`, DR-012 |
| Storage | Supabase Storage, buckets privados, URLs firmadas | `RT-005` |
| Realtime | Supabase Realtime, solo `postgres_changes` con RLS | `RT-006` |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 async, asyncpg | `RT-002` |
| Frontend | React 18, TypeScript strict, Vite, Tailwind, Zustand, React Query | `RT-001` |
| Jobs | `BackgroundTasks` → ARQ + Redis cuando exista el primer caso real | DR-009 |
| Entorno local | Supabase CLI + **Docker Desktop** | **DEC-03** |
| Despliegue | Render (plan free). Enmienda DR-008, que decía Cloud Run / Fly.io | Decisión del usuario |
| CI | GitHub Actions con Supabase local | DEC-03 |

### 2.1 Prohibiciones técnicas

| Prohibido | Motivo |
|---|---|
| Alembic | DEC-01. Una sola fuente de verdad del esquema |
| `service_role` en el backend para consultas de tenant | Tiene `BYPASSRLS`: anula todo el aislamiento |
| `SET LOCAL` fuera de transacción explícita | **No-op silencioso** (verificado): el GUC queda vacío y RLS deniega todo |
| Interpolación de cadenas en SQL | Inyección. `set_config` con parámetro ligado |
| Escrituras vía PostgREST | Se saltan auditoría, idempotencia y optimistic locking |
| Triggers de soft delete | **Verificado**: convierten todo UPDATE en borrado |
| `!=` en `prevent_tenant_change` | **Verificado**: con NULL atraviesa el trigger sin error |
| Índice único sin `COALESCE` en columnas nulables | **Verificado**: NULL no colisiona con NULL, el índice no protege |
| RLS sobre vistas materializadas | PostgreSQL no lo soporta |
| Postgres de Render | `RT-003` fija Supabase; la gratuita de Render caduca a 30 días |
| `postgres:15` plano en CI | **Verificado**: sin schema `auth`, la migración de funciones aborta |

---

## 3. VALIDACIÓN CRÍTICA

Encargo de §9 de la instrucción: buscar contradicciones, sobreingeniería, duplicaciones y elementos innecesarios, y simplificar sin perder capacidad empresarial.

### 3.1 Contradicciones resueltas en esta especificación

| # | Contradicción | Resolución |
|---|---|---|
| V-01 | **DEC-04 (membresías N:N) contra `UNIQUE (tenant_id, email)` de `DATABASE_DESIGN.md`** | Supabase Auth **ya impone email global** en `auth.users`. El `UNIQUE (tenant_id, email)` permitía lo que otra capa prohíbe. Email global, coherente con la realidad |
| V-02 | **DEC-04 exige elegir tenant; el JWT mínimo lleva uno solo** | **Disuelto**, no decidido: `uq_membership_one_active_per_user` en la etapa 1 hace la pregunta improcedente. DEC-14 desaparece de la ruta crítica |
| V-03 | **DEC-12 aplicado literalmente ⇒ 9 catálogos y un JOIN por lectura** | Criterio operativo: catálogo solo si el valor **tiene atributos** o **varía por tenant**. De 9 a **4** |
| V-04 | **`core.users` sin `tenant_id` no admite plantilla RLS estándar** | Plantilla **T4** a medida, con riesgo de recursión documentado y test obligatorio |
| V-05 | **La jerarquía necesita `can_access_warehouse()`, que lee `user_warehouse_access`, que necesita la jerarquía** | Se rompe separando tablas de políticas: 0012 crea tablas, 0015 crea funciones y políticas |
| V-06 | **DR-008 (Cloud Run / Fly.io) contra Render** | Render sustituye. Enmienda que Kiro debe registrar |
| V-07 | **`RF-AUTH-007` P1 en Fase 0, no nativo en Supabase Auth** | DEC-09 → hardening. Y `core.users` no lleva `failed_login_attempts` |
| V-08 | **Ledger con deltas contra `adjustment_items` con valores absolutos** | Los items pasan a `quantity_delta`. Es lo que hace conmutativas las operaciones |

### 3.2 Sobreingeniería eliminada

| # | Elemento descartado | Motivo |
|---|---|---|
| S-01 | **5 de 9 tablas catálogo** (`user_statuses`, `membership_statuses`, `count_statuses`, `location_types`, `area_types`, `device_types`, `incident_types`, `movement_types`) | Ciclos de vida cerrados. Añadirles un valor obliga a tocar la lógica de negocio igualmente |
| S-02 | **`public.system_config`** | Tabla de una fila con RLS para lo que resuelven variables de entorno |
| S-03 | **`public.timezones`** | `pg_timezone_names` ya existe y se mantiene con el motor |
| S-04 | **Tabla `Platform`** | No tiene estado propio que persistir (§4.3 de `FINAL_DATABASE_MODEL.md`) |
| S-05 | **`core.sessions` en Fase 0** | `RF-AUTH-014` no es nativo y no es MVP. DEC-09 → hardening |
| S-06 | **`membership_version`** (DR-013) | TTL de 30 s en la caché de permisos basta. Un mecanismo menos que mantener |
| S-07 | **`integrations.field_mappings`** como tabla | El mapeo se consume en bloque, no se consulta por campo. `JSONB` es correcto |
| S-08 | **Ledger separado de reservas** | Una cláusula `movement_type NOT IN ('reserve','release')` resuelve la invariante L1 |
| S-09 | **Particionamiento en Fase 0** | DEC-06. Y verificado que la forma propuesta ni se puede crear |
| S-10 | **`?fields=`, `?include=`, `sort` multi-campo en la v1** | Tres mecanismos de flexibilidad con coste de test y de seguridad, antes de tener un cliente |
| S-11 | **8 schemas creados de golpe** | Cinco en Fase 0; el resto con su primera tabla |
| S-12 | **`ai-service` con CUDA en el compose de Fase 0** | Fase 0 excluye IA. Obligaría a descargar GB de imagen sin usarla |
| S-13 | **Redis en Fase 0** | DR-009. Primer caso real: sync de conector WMS con reintentos, en Fase 1 |
| S-14 | **ABAC** | `RF-RBAC-009` es P3/Fase 2. RBAC con scope cubre todo lo de Fase 0-1 |

### 3.3 Duplicaciones eliminadas

| # | Duplicación | Resolución |
|---|---|---|
| D-01 | `core.countries` con `tenant_id` ⇒ 250 países × N tenants | `public.countries` global + `core.tenant_countries` |
| D-02 | `roles.permissions JSONB` y ningún catálogo | `core.permissions` + `core.role_permissions` |
| D-03 | `previous_quantity`/`new_quantity` en ajustes y el saldo en balances | Solo `quantity_delta`; el saldo se deriva |
| D-04 | `counts.assigned_users JSONB` y `count_assignees` | Solo la tabla |
| D-05 | `failed_login_attempts` en `core.users` y en Supabase Auth | Solo Supabase Auth |
| D-06 | `sync_logs` (ARCHITECTURE) y `sync_jobs` (DATABASE_DESIGN) | `integrations.sync_jobs` canónico |
| D-07 | `trace_id`, `X-Request-Id`, `correlation_id` | `request_id` (una petición) y `correlation_id` (una cadena). DEC-10 |
| D-08 | `evidence_urls JSONB` en cuatro tablas | `core.files` con `*_file_id` |
| D-09 | `plan_coordinates` en `locations` y planos versionados | `spatial.plan_location_mappings` |
| D-10 | Dos planes de Fase 0 con IDs colisionando | DEC-08: `TASKS.md` maestro, `PHASE_0_EXECUTION_BACKLOG.md` operativo |

### 3.4 Funciones — de 12 candidatas a 10

| Función | Veredicto |
|---|---|
| `current_auth_id`, `current_user_id`, `current_tenant_id`, `has_active_membership`, `has_tenant_wide_access`, `accessible_warehouse_ids`, `can_access_warehouse` | **Necesarias.** Las siete de contexto |
| `set_updated_at`, `prevent_tenant_change`, `prevent_role_cycle` | **Necesarias.** Triggers |
| `custom_access_token_hook` | **Necesaria.** Publica los claims |
| ~~`soft_delete`~~ | **Eliminada.** Verificado que ninguna de sus dos formas de uso es salvable |
| ~~`current_warehouse_ids`~~ | **Eliminada.** Devolvía NULL en vez de array vacío y su centinela nunca coincidía |

### 3.5 Capacidad empresarial preservada

La simplificación no recorta nada de lo que hace la plataforma vendible:

| Capacidad | Estado |
|---|---|
| Aislamiento multi-tenant verificable | **Reforzado**: RESTRICTIVE + FORCE + FK compuestas |
| Aislamiento por almacén | **Corregido**: antes era inerte por el OR de políticas permisivas |
| Auditoría inmutable | **Mantenida**, con alcance honesto y compensación frente a `BYPASSRLS` |
| Trazabilidad de inventario | **Añadida**: no existía; `RF-INV-007` era inimplementable |
| Múltiples motores de IA | Mantenida vía catálogo `ai.engines` |
| Conectores WMS | Mantenida |
| Escalado a 500 tenants | Mantenido, con escenarios coherentes |
| Multi-idioma, multi-moneda | Mantenido; GIN corregido para no fijar español |
| Membresías multi-tenant | **Habilitada** por diseño, activable con `DROP INDEX` |

---

## 4. DECISIONES CERRADAS EN ESTA ESPECIFICACIÓN

| ID | Decisión | Dónde |
|---|---|---|
| **DEC-04 revisada** | Modelo B (membresías N:N) en dos etapas | `IDENTITY_AND_AUTH_FLOW.md` §1.5 |
| **DEC-14** | **Disuelta** por la restricción de una membresía activa | ídem §1.5 |
| **DR-013** | `membership_version` **no se implementa** | ídem §3.6 |
| **DEC-12 operativo** | Catálogo si tiene atributos o varía por tenant | `FINAL_DATABASE_MODEL.md` §7 |
| Tenant activo | Flujo único, con `[E2]` marcado | `IDENTITY_AND_AUTH_FLOW.md` §2 |
| Canal A solo lectura | Toda mutación por el canal B | ídem §3.1 |
| Optimistic locking | 7 entidades; **no** en la ruta de movimientos | `INVENTORY_ENGINE_SPEC.md` §8 |
| Cálculo de corrección de conteo | Saldo reconstruido en `counted_at` | ídem §6.3 |
| Movimiento de serializados | `UPDATE location_id`, no decrementar y crear | ídem §3.2 |
| Nivel de aislamiento | `READ COMMITTED` | ídem §9.1 |
| Orden de migraciones | 56, con la circularidad resuelta | `MIGRATION_ROADMAP.md` §2.1 |

---

## 5. CONDICIONES ABIERTAS

Ninguna es una decisión de diseño. Las cuatro son trabajo o validación.

| # | Condición | Bloquea | Quién |
|---|---|---|---|
| **C-1** | **Docker Desktop no está instalado.** DEC-03 lo exige y sin él `supabase start` no funciona | Toda migración | Humano |
| **C-2** | Validación del modelo de identidad (§1 de `IDENTITY_AND_AUTH_FLOW.md`) | Migraciones 0010, 0011, 0016 | ChatGPT |
| **C-3** | Revisión de las plantillas RLS. **`RLS_IMPLEMENTATION_GUIDE.md` es de mi autoría y no puedo auditarlo con independencia** | Migraciones 0004, 0015 | ChatGPT |
| **C-4** | Aprobación de los escenarios de escala y corrección de los 4 targets `RNF-SCAL` | Dimensionado de Fase 1 | Humano |

**Mitigación de C-1 si se retrasa:** las funciones de contexto son portables a PostgreSQL sin schema `auth` (verificado), así que la suite de aislamiento entre tenants puede ejecutarse sobre un Postgres ligero mientras se difiere solo lo que necesita GoTrue. No sustituye a Docker; evita detener el trabajo.

---

## 6. EVIDENCIA EMPÍRICA INCORPORADA

Nueve elementos del contrato no son juicio técnico, son comportamiento medido contra PostgreSQL 15.8. Registro completo en `TECHNICAL_ASSUMPTION_VERIFICATION.md`.

| # | Hecho verificado | Qué determina |
|---|---|---|
| 1 | Tabla particionada con PK simple **no se crea** | `audit.events` sin particionar (0019) |
| 2 | Trigger de soft delete borra todo lo que se edita | Función eliminada |
| 3 | PostgreSQL sin Supabase carece de `auth`; `CREATE FUNCTION` aborta | CI con Supabase local; funciones portables |
| 4 | asyncpg **no** recibe `request.jwt.claims` | Canal B con `SET LOCAL` en transacción |
| 5 | `SET LOCAL` fuera de transacción es **no-op silencioso** | Transacción explícita obligatoria |
| 6 | `is_local=true` **no filtra** contexto entre transacciones | Pooler en modo transaction es seguro |
| 7 | FK compuestas rechazan los 3 invariantes de jerarquía | Cadena de FK de 0012 |
| 8 | Índice único **sin `COALESCE` no protege** con NULL | Clave lógica de `balances` |
| 9 | `!=` con NULL atraviesa el trigger sin error | `IS DISTINCT FROM` |

---

## 7. RECUENTO

| Elemento | Cantidad |
|---|---|
| Tablas totales | 55 |
| Tablas de Fase 0 | **19** |
| Tablas catálogo | 4 (de 9 propuestas) |
| Funciones | 10 (de 12 candidatas) |
| Plantillas RLS | 7 |
| FK compuestas | 16 |
| Migraciones totales | 56 |
| Migraciones de Fase 0 | **21** |
| Migraciones de riesgo alto | 14 |
| Puertas de verificación | 6 |

---

## 8. QUÉ NO ESTÁ EN ESTA ESPECIFICACIÓN

Declarado para que nadie asuma cobertura que no existe:

| Ausente | Cuándo |
|---|---|
| Contratos OpenAPI endpoint por endpoint | Con cada módulo. `API_DESIGN.md` es la base, con sus 9 defectos pendientes |
| Especificación del design system | Kiro, Fase 0 etapa 4 |
| Contrato de `IInferenceEngine` | Fase 2 |
| Protocolo de drones | Fase 3 |
| Motor de facturación | Fase 4 |
| **Auditoría de 5 documentos** (`AI_ARCHITECTURE`, `INTEGRATION_STRATEGY`, `FOLDER_STRUCTURE`, `CODING_STANDARDS`, `RISK_ANALYSIS`) | Pendiente. La matriz de conflictos sigue siendo cota inferior |

---

## 9. REQUISITOS RECLASIFICADOS POR DEC-09

| Requisito | Prioridad original | Nativo | Destino |
|---|---|---|---|
| `RF-AUTH-007` bloqueo por intentos | **P1, Fase 0** | No | **Hardening.** Supabase Auth ya aplica rate limiting; un contador propio es evadible por el endpoint público de GoTrue y permite bloquear la cuenta de un tercero |
| `RF-AUTH-012` política de contraseñas por tenant | P2 | No | **Hardening.** Política única de proyecto en Fase 0 |
| `RF-AUTH-013` timeout de sesión | P1, Fase 0 | Parcial | **MVP con el TTL del proyecto**; por tenant a hardening |
| `RF-AUTH-014` sesiones activas | P2 | No | **Hardening.** Requiere `core.sessions` |

---

## 10. FIRMA DEL CONTRATO

Esta especificación está lista para dirigir la implementación en cuanto se cierren C-1 a C-4.

**Lo que aporta frente al estado anterior:**

- Un modelo de identidad que resuelve DEC-04 y **disuelve DEC-14** en lugar de aplazarlo.
- Un motor de inventario donde la carrera conteo↔movimiento **tiene solución**, no mitigación.
- Aislamiento por almacén que **efectivamente aísla** — antes era inerte por el OR de políticas permisivas.
- Nueve puntos del diseño respaldados por medición, no por deducción.
- 14 elementos de sobreingeniería y 10 duplicaciones eliminados, sin recortar capacidad empresarial.

**Lo que sigue siendo incierto y hay que tratar como tal:**

- El Custom Access Token Hook no se ha probado contra el plan Supabase contratado. Es el riesgo nº1 y su PoC va el primer día de la etapa 4.
- El sobrecoste real de RLS no está medido. El KPI de 5 ms exige el benchmark con ≥ 100.000 filas; no asumirlo.
- `RLS_IMPLEMENTATION_GUIDE.md` es de mi autoría y necesita revisión externa (C-3). Es la limitación estructural de tener al mismo agente diseñando y auditando.

---

*Especificación técnica de implementación v1.0. Ninguna migración creada. Ningún documento original modificado. Sin push, sin PR, sin cambios en Supabase.*
*Claude Code — 2026-07-28*
