# OLO_IA - CHANGELOG DE SINCRONIZACIÓN ARQUITECTÓNICA

## Ronda 1 — Sincronización de decisiones aprobadas

**Fecha**: Julio 2026
**Autorización**: Owner, aprobación de READY WITH CONDITIONS + 7 decisiones + 4 correcciones
**Fuente de decisiones**: `DECISION_REGISTER.md` v2.0
**Fuente de seguridad RLS**: `RLS_STRATEGY.md` v2.0 (no modificado)

### Alcance

| Documento | Sincronizado | Modificaciones |
|-----------|-------------|---------------|
| SECURITY.md | Sí | 3 secciones |
| DATABASE_DESIGN.md | Sí | 12 secciones |
| MULTITENANT.md | Sí | 5 secciones |
| ARCHITECTURE.md | Sí | 4 secciones |
| DEPLOYMENT.md | Sí | 4 secciones |
| TASKS.md | Sí | 5 secciones |
| FOLDER_STRUCTURE.md | Sí | 4 secciones |
| RLS_STRATEGY.md | **No** (fuente de verdad, sin contradicciones detectadas) | — |
| Otros 10 documentos | **No** (no autorizados en esta ronda) | — |

---

## 1. DIFF LÓGICO POR DOCUMENTO Y SECCIÓN

### 1.1 SECURITY.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §2.3 Estructura del JWT | `app_metadata` con `tenant_id`, `roles[]`, `warehouse_ids[]`, `permissions[]` | `app_metadata` con solo `tenant_id` + `tenant_wide_access`. Agregado claim `role: authenticated`. `sub` documentado como identificador de Supabase Auth (≠ `core.users.id`) | DR-003 | RLS_STRATEGY v2.0 §3 |
| §2.3.1 (nueva) | — | Tabla de claims con tipo, origen y obligatoriedad | DR-003 | — |
| §2.3.2 (nueva) | — | Tabla de exclusiones con justificación por cada claim excluido | DR-003 | — |
| §2.3.3 (nueva) | — | Mecanismo de revocación inmediata vía `revoked_at` y consulta a BD | DR-011, DR-013 | — |
| §2.3.4 (nueva) | — | TTL corto (15 min), `membership_version` NO implementado en Fase 0 | DR-013 | — |
| §2.3.5 (nueva) | — | Custom Access Token Hook como función PL/pgSQL. Tabla de propiedades. Contrato de 7 puntos. Criterio de cuándo usar Edge Function | DR-012 | DECISION_REGISTER §B |
| §3.5 (nota añadida) | Evaluador sin especificar origen de datos | Nota explícita: consulta desde BD, no desde JWT | DR-003 | — |
| §3.6 (nueva) | — | Modelo de 3 categorías de acceso: A (`authenticated`), B (`olo_app`), C (`service_role`). Tabla de roles con `BYPASSRLS`. Lista exhaustiva de operaciones de categoría C. Regla de decisión | DR-002 | RLS_STRATEGY v2.0 §2.1 |
| §6.3 Inmutabilidad de Logs | SQL con roles inexistentes: `api_user`, `service_user`, `audit_reader`, `audit_writer` | SQL con roles reales: `authenticated`, `olo_app`. Referencia a RLS_STRATEGY §5.4 | DR-002 | RLS_STRATEGY v2.0 §2.1, §5.4 |
| §6.3.1 (nueva) | Implícito: "inmutable" | Tabla honesta de alcance: qué roles sí pueden modificar (`service_role`, `postgres`) y qué se requiere para inmutabilidad real | DR-002 | RLS_STRATEGY v2.0 §5.4 |

**Impacto**: Alto. Redefine la estructura del token y el modelo de acceso a BD.

### 1.2 DATABASE_DESIGN.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §1.3 (nueva) | — | 7 convenciones adicionales: UUID PK simple, desnormalización de tenant/warehouse, soft delete con índices parciales, optimistic locking, particionamiento pospuesto. Con justificación de desnormalización y de posponer particionamiento | DR-019 a DR-022 | DECISION_REGISTER v2.0 |
| §2 Schemas | 8 schemas | 9 schemas (agregado `internal` para matviews no expuestas) | DR-001 | RLS_STRATEGY v2.0 §6.1 |
| §2.1 (nueva) | — | Clasificación de tablas por scope: global de plataforma, plataforma privada, tenant, company, warehouse, transaccionales, integración, IA, auditoría, técnicas. Con plantilla RLS aplicable | DR-001 | RLS_STRATEGY v2.0 §5.2 |
| §3.2 Países | `core.countries` con `tenant_id` (catálogo duplicado por tenant) | Dividido en §3.2.1 `public.countries` (catálogo global ISO, sin tenant_id, RLS read-only) y §3.2.2 `core.tenant_countries` (presencia operativa con overrides). §3.2.3 cadena de resolución de configuración | DR-005 | — |
| §3.3 companies | `country_id → core.countries` | `tenant_country_id → core.tenant_countries`. Índice único de tax_id ahora parcial con `deleted_at IS NULL`. Agregado `version` | DR-005, DR-014, DR-021 | — |
| §3.4 warehouses | Sin `version`, sin constraint para FK compuesta | Agregado `version`. Agregado `UNIQUE (tenant_id, id)` requerido por la FK compuesta de areas | DR-014, DR-020 | — |
| §3.5 areas | `tenant_id` y `warehouse_id` con FK simples independientes | `tenant_id` y `warehouse_id` desnormalizados con **FK compuesta** `(tenant_id, warehouse_id) → warehouses(tenant_id, id)`. Agregado `version`, CHECK de status, `UNIQUE (tenant_id, warehouse_id, id)`. Nota explicando el riesgo que la FK compuesta elimina | DR-020, DR-014 | — |
| §3.6 locations | FKs simples | FK compuesta `(tenant_id, warehouse_id, area_id) → areas(...)`. Agregado `version`, `UNIQUE (tenant_id, warehouse_id, id)` | DR-020, DR-014 | — |
| §3.10 user_warehouse_access | Sin revocación. Índice único total | Agregado `revoked_at`, `revoked_by`, `revoke_reason`, CHECK de coherencia, `created_at`/`updated_at`. FK compuesta a warehouses. Índice parcial `WHERE revoked_at IS NULL`. Índice único parcial. §3.10.1 semántica de revocación. Documentada como "proyección de autorización" | DR-011, DR-013, DR-021 | RLS_STRATEGY v2.0 §2.3 |
| §4.2 stock_records | Sin `version`. Sin invariante de serial | Agregado `version`. Agregado `CHECK (serial_number IS NULL OR quantity = 1)`. FK compuesta a locations | DR-014, DR-023, DR-020 | — |
| §4.3 counts | Sin `version` | Agregado `version` | DR-014 | — |
| §4.4 count_items | `counted_quantity` inline (una sola observación posible) | Reestructurada: `accepted_quantity` + `accepted_observation_id` + `status` + `observation_count` + `version`. FK compuesta. UNIQUE de scope | DR-024 | MODULES.md §6.3 (requisito de doble conteo) |
| §4.4.1 (nueva) | — | Tabla `inventory.count_observations`: secuencia, cantidad observada, source, confidence, evidencia, is_accepted. Índice único de una sola aceptada. Flujo de reconciliación de 6 pasos | DR-024 | MODULES.md §6.3 |
| §4.5 adjustments | Sin `version` | Agregado `version` | DR-014 | — |
| §6.2 drone_missions | `telemetry JSONB` (array embebido) | Reemplazado por `telemetry_summary JSONB` + `telemetry_point_count`. Agregado `version` | DR-025 | — |
| §6.3 (nueva) | — | Tabla `devices.telemetry_points`: serie temporal con fila por punto. Índices por misión y por device. Justificación del cambio (9.000 puntos por vuelo, TOAST, reescritura de fila). Nota de retención | DR-025 | — |
| §8.1 audit.events | `PARTITION BY RANGE (created_at)` con particiones mensuales manuales | Sin particionamiento. Índices normales + BRIN. Nota de 3 razones para posponer y umbral de reevaluación (~50M filas) | DR-022 | — |
| §11 Diagrama ER | Jerarquía con `core.countries` | Jerarquía con `public.countries` → `core.tenant_countries` → companies. Agregados count_observations y telemetry_points. Jerarquía canónica explícita | DR-005, DR-024, DR-025 | — |
| §12 Particionamiento | Tabla de estrategias activas | Reescrita: ninguna tabla particionada. Tabla de candidatas futuras con umbrales. 4 razones para posponer. 3 prerequisitos para particionar | DR-022 | — |
| §12.4 (nueva) | — | Optimistic locking: tablas con y sin `version`, semántica del UPDATE, respuesta 409, nota de que el incremento es de aplicación no de trigger | DR-014 | — |
| §12.5 (nueva) | — | Índices únicos con soft delete: el problema, el patrón correcto, inventario de 10 índices parciales, 4 excepciones legítimas | DR-021 | — |

**Impacto**: Alto. Cambios estructurales en 6 tablas, 2 tablas nuevas, 1 tabla dividida en 2.

### 1.3 MULTITENANT.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §3.1 Diagrama jerárquico | `COUNTRY (País)` | `TENANT_COUNTRY (Presencia operativa en un país)` con referencia al catálogo global | DR-005 | — |
| §3.1.1 (nueva) | — | Separación explícita catálogo global vs presencia operativa, con comparativa lado a lado y justificación. Jerarquía canónica declarada | DR-005 | — |
| §3.2 Cardinalidad | `Tenant → Country`, `Country → Company` | `Tenant → TenantCountry`, `Country (catálogo) → TenantCountry` (1:N cross-tenant), `TenantCountry → Company`. Agregada `Platform → Country (catálogo)` | DR-005 | — |
| §3.3 Configuración heredable | Cadena de 5 niveles desde Tenant | Cadena de 6 niveles: `public.countries` provee defaults → Tenant → TenantCountry → Company → Warehouse → Area. Ejemplo de resolución con 5 pasos | DR-005 | — |
| §4.2 Implementación del Tenant Context | Código con f-string en SQL, `SET LOCAL` sin transacción, `TenantContext` leyendo warehouse_ids y permissions del JWT | Reescrita en 3 subsecciones: §4.2.1 el patrón incorrecto con tabla de 3 defectos y sus consecuencias; §4.2.2 dos caminos (A: `authenticated` sin set_config, B: `olo_app` con set_config parameterizado en transacción explícita); §4.2.3 tabla de 5 reglas | DR-002, DR-003 | RLS_STRATEGY v2.0 §9 |
| §4.3 Tenant Context en Frontend | Store sin `currentTenantCountry`. Interceptor sin aclarar semántica | Agregado `currentTenantCountry` y `switchTenantCountry`. Nota de que el frontend nunca envía `tenant_id`. Nota de que `X-Warehouse-Id` es preferencia de filtrado, no credencial | DR-003, DR-005 | — |
| §5.3 Tablas exentas | Lista sin columna de RLS. Incluía `audit_system_events` | Tabla con columna RLS explícita. Agregado `public.announcements` y `platform.*`. Nota "exentas de tenancy, no de RLS". Aclaración de que `core.tenant_countries` NO está exenta | DR-001, DR-005 | RLS_STRATEGY v2.0 §5.3 |

**Impacto**: Alto. Corrige un patrón de código inseguro y redefine la jerarquía.

### 1.4 ARCHITECTURE.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §1.1 (nueva) | — | Arquitectura inicial declarada: tabla de decisiones Fase 0-2 vs cuándo cambia. §1.1.1 qué significa monolito modular, con diagrama y regla de comunicación entre módulos. §1.1.2 tabla de 5 workers desacoplados con su fase. §1.1.3 canales autorizados del frontend (5 permitidos, 4 prohibidos con razón) | DR-007, DR-008, DR-009 | — |
| §6.4.1 (nueva) | Regla absoluta "una transacción modifica UN solo aggregate" (estaba en DOMAIN_MODEL §12.1) | Regla general + excepción autorizada. Criterio de 3 puntos para autorizar. Tabla de 5 casos autorizados en OLO_IA con la invariante que los justifica. Tabla de 5 casos que permanecen eventuales. Ejemplo de implementación con docstring justificativo | Corrección aprobada | — |
| §7.2 Comunicación Asíncrona | "Task Queue (in-process o Redis)" sin definir | Tabla de 9 tipos con mecanismo y fase. §7.2.1 criterio de selección BackgroundTasks vs ARQ (5 criterios). Advertencia de que BackgroundTasks no es una cola. §7.2.2 interfaz `IJobDispatcher` con 2 implementaciones y cuándo se instala Redis | DR-009 | — |
| §9.1 Esquema de BD | `integrations.sync_logs` | `integrations.sync_jobs` | Corrección C-04 | RLS_STRATEGY v2.0 §5.2 |

**Impacto**: Medio-Alto. Elimina una regla absoluta que habría bloqueado casos legítimos.

### 1.5 DEPLOYMENT.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §1.1 (nueva) | — | Decisión de plataforma: PaaS para Fases 0-2, K8s pospuesto. Tabla de aspectos. §1.1.1 cinco razones para PaaS. §1.1.2 cinco umbrales medibles para reevaluar K8s | DR-008 | — |
| §2 Entornos | 4 entornos (local, dev, staging, production) con "Cloud" genérico | 3 entornos (se elimina `dev` compartido con justificación). Infra explícita: PaaS + Supabase Cloud. §2.1 topología por entorno con diagrama | DR-008 | — |
| §5 Kubernetes | Presentado como arquitectura de producción | Marcado como "REFERENCIA FUTURA (NO APLICA A FASES 0-2)" con nota explícita de que no es el plan vigente | DR-008 | — |
| §8 Disaster Recovery | Escenarios en términos de K8s (pod crash, node failure) | Escenarios en términos de PaaS (container crash, instancia degradada, región del PaaS) | DR-008 | — |
| §9 (nueva) | — | Gestión de secretos: 7 reglas, inventario de secretos por entorno (7 secretos × 3 entornos), §9.3 uso de `service_role` con 5 reglas y verificación en CI | DR-002, decisión aprobada | — |
| §10 (nueva) | — | Cola de trabajos: qué se instala y cuándo (tabla por fase), por qué no Redis en Fase 0, primer caso real que lo dispara (Sprint 1.4 tarea 076), tabla de 5 alternativas con estado | DR-009 | — |

**Impacto**: Medio. Elimina complejidad operacional prematura.

### 1.6 TASKS.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §1.1 (nueva) | — | Estado de autorización de sprints: solo Sprint 0.1 AUTORIZADO, resto BLOQUEADO con su bloqueador | Autorización del owner | — |
| §1.2 (nueva) | — | Restricción crítica: Sprint 0.1 no puede crear migraciones definitivas de dominio. Tabla permitido/prohibido. Motivo (auditoría paralela en curso). Especificación de la migración smoke test desechable | Autorización del owner | — |
| §1.3 (nueva) | — | 7 condiciones de entrada a Sprint 0.2 (C1-C7) con verificador de cada una. Declaración de que el sprint permanece bloqueado si falla cualquiera | Autorización del owner | — |
| Sprint 0.1 | 10 tareas (001-010) | 18 tareas (001-018): agregadas Alembic sin migraciones de dominio, smoke test, IJobDispatcher, InlineJobDispatcher, estructura workers, app factory, logging estructurado, verificación CI de service_role. Tarea 009 ampliada de 2 a 7 ADRs. Tarea 010 especifica .env.example versionado y .env.local ignorado | DR-009, decisión aprobada | — |
| Sprint 0.1 — Reconciliación (nueva) | — | 8 tareas R01-R08: recibir e inventariar hallazgos de Claude, clasificar, registrar en DECISION_REGISTER, detectar contradicciones, escalar al owner sin resolver unilateralmente, actualizar changelog, verificación cruzada, congelar schema | Autorización del owner | — |
| Sprint 0.1 — Criterio de completitud (nueva) | — | Checklist de 8 puntos incluyendo "cero migraciones de dominio creadas" | — | — |
| Sprint 0.2 | 10 tareas, sin gating | Marcado BLOQUEADO. Primera tarea: eliminar smoke test. Tarea 019 ajustada a catálogo global de países | DR-005 | — |
| Sprint 0.2 — Suite multi-tenant (nueva) | Tarea 020 genérica "escribir tests de aislamiento RLS" | 8 tareas T01-T08 específicas y verificables | DR-001 | RLS_STRATEGY v2.0 §9 |
| Sprint 0.2 — Fuga horizontal (nueva) | — | 6 tareas H01-H06. Incluye H02 como test de regresión del bug de centinela de array vacío y H03 para verificar efecto inmediato de `revoked_at` | DR-011, DR-013 | RLS_STRATEGY v2.0 §2.3 |
| Sprint 0.2 — Escalamiento vertical (nueva) | — | 9 tareas V01-V09: JWT manipulado, auto-asignación de rol, auto-concesión de acceso, funciones platform, `olo_app` sin BYPASSRLS, catálogos read-only, search_path en SECURITY DEFINER, creación de tenants, cambio de tenant_id propio | DR-002 | RLS_STRATEGY v2.0 §2.1, §7 |
| Sprint 0.2 — Criterio de salida (nueva) | — | Checklist de 7 puntos, incluye aprobación explícita del owner | — | — |
| Sprint 0.3 | Sin gating | Marcado BLOQUEADO con condición de entrada | — | — |
| Sprint 0.3 — PoC Auth Hook (nueva) | — | 9 tareas P01-P09 bajo responsabilidad de **Claude**: verificar soporte del plan, implementar función, registrar hook, verificar claims propios y estándar, fail-secure, permisos, latencia, informe GO/NO-GO. Plan B documentado si es NO-GO | DR-012 | DECISION_REGISTER §B |
| Sprint 0.3 tarea 030 | RBAC middleware sin especificar origen | Especifica "consultando BD no JWT". Agregada 030b: test de revocación inmediata sin re-login | DR-003, DR-013 | — |
| Sprint 0.4 | Sin gating | Marcado BLOQUEADO. Condición: contratos de API definidos antes de construir pantallas | — | — |

**Impacto**: Alto. Establece control de ejecución por fases y agrega 32 tareas de verificación de seguridad.

### 1.7 FOLDER_STRUCTURE.md

| Sección | Antes | Después | Decisión | Fuente |
|---------|-------|---------|----------|--------|
| §1 Estructura raíz | `supabase/migrations/`, sin `tests/` raíz, sin `workers/`, `.env.example` sin aclarar | Agregado `migrations/` en raíz (Alembic, fuente de verdad del schema). `supabase/` reducido a config + hooks + seed de catálogos. Agregado `tests/` raíz (e2e, rls, fixtures). `.env.example` marcado versionado, `.env.local` marcado no versionado | DR-006, decisión aprobada | — |
| §1.1 (nueva) | — | Tabla de 9 directorios de raíz con responsabilidad y estado de versionado | Decisión aprobada | — |
| §1.2 (nueva) | — | Variables de entorno: tabla comparativa de `.env.example` vs `.env.local`, entradas obligatorias de `.gitignore` | Decisión aprobada | — |
| §1.3 (nueva) | — | Directorio `workers/` preparado sin implementar: estructura de 5 workers con `__init__.py` y README de "implementación en Sprint X". Contrato de worker en 5 puntos. Declaración explícita de que en Fase 0 no se implementa ninguno | DR-009 | — |
| §2 Backend — application/common | 4 archivos | 5 archivos: agregado `jobs.py` (IJobDispatcher) | DR-009 | — |
| §2 Backend — infrastructure | Sin directorio de jobs | Agregado `jobs/` con `inline_dispatcher.py` (Fase 0) y `arq_dispatcher.py` (Fase 1, marcado NO en Fase 0) | DR-009 | — |
| §2 Backend — alembic | `backend/alembic/` con versions | Eliminado. Nota: las migraciones viven en `/migrations` en la raíz | DR-006 | — |

**Impacto**: Bajo-Medio. Reorganización de raíz y preparación de estructura.

---

## 2. TABLA RESUMEN DE TRAZABILIDAD

| # | Documento | Sección | Decisión aplicada | Fuente | Impacto |
|---|-----------|---------|-------------------|--------|---------|
| 1 | SECURITY.md | §2.3, §2.3.1-2.3.4 | JWT mínimo | DR-003 | Alto |
| 2 | SECURITY.md | §2.3.5 | Hook PL/pgSQL, no Edge Function | DR-012 | Alto |
| 3 | SECURITY.md | §3.6 | Modelo de 3 roles | DR-002 | Alto |
| 4 | SECURITY.md | §6.3, §6.3.1 | Roles reales de Supabase | DR-002 | Alto |
| 5 | DATABASE_DESIGN.md | §1.3, §2.1 | Convenciones y clasificación de scope | DR-019 a DR-022 | Medio |
| 6 | DATABASE_DESIGN.md | §3.2 | Países global + tenant_countries | DR-005 | Alto |
| 7 | DATABASE_DESIGN.md | §3.3-3.6 | FK compuestas, desnormalización, version | DR-014, DR-020 | Alto |
| 8 | DATABASE_DESIGN.md | §3.10 | revoked_at en accesos contextuales | DR-011 | Alto |
| 9 | DATABASE_DESIGN.md | §4.2 | Invariante serial → quantity = 1 | DR-023 | Medio |
| 10 | DATABASE_DESIGN.md | §4.4, §4.4.1 | CountObservation para reconteos | DR-024 | Alto |
| 11 | DATABASE_DESIGN.md | §6.2, §6.3 | TelemetryPoint independiente | DR-025 | Alto |
| 12 | DATABASE_DESIGN.md | §8.1, §12 | Particionamiento pospuesto | DR-022 | Medio |
| 13 | DATABASE_DESIGN.md | §12.4 | Optimistic locking | DR-014 | Medio |
| 14 | DATABASE_DESIGN.md | §12.5 | Índices únicos parciales | DR-021 | Medio |
| 15 | MULTITENANT.md | §3.1, §3.1.1, §3.2, §3.3 | Jerarquía con tenant_country | DR-005 | Alto |
| 16 | MULTITENANT.md | §4.2 | Corrección de código inseguro | DR-002, DR-003 | Alto |
| 17 | MULTITENANT.md | §4.3, §5.3 | Contexto frontend y RLS en catálogos | DR-001, DR-005 | Medio |
| 18 | ARCHITECTURE.md | §1.1 | Monolito modular, workers, canales frontend | DR-007, DR-008, DR-009 | Alto |
| 19 | ARCHITECTURE.md | §6.4.1 | Transacciones multi-aggregate autorizadas | Corrección aprobada | Alto |
| 20 | ARCHITECTURE.md | §7.2 | JobDispatcher y criterio de cola | DR-009 | Medio |
| 21 | ARCHITECTURE.md | §9.1 | sync_jobs canónico | C-04 | Bajo |
| 22 | DEPLOYMENT.md | §1.1, §2, §5, §8 | PaaS, K8s pospuesto | DR-008 | Medio |
| 23 | DEPLOYMENT.md | §9 | Secretos fuera del repo, service_role restringido | DR-002 | Alto |
| 24 | DEPLOYMENT.md | §10 | Redis/ARQ diferidos | DR-009 | Medio |
| 25 | TASKS.md | §1.1, §1.2, §1.3 | Solo Sprint 0.1 autorizado, sin migraciones de dominio | Autorización owner | Alto |
| 26 | TASKS.md | Sprint 0.1 + R01-R08 | Tareas de reconciliación documental | Autorización owner | Alto |
| 27 | TASKS.md | Sprint 0.2 T/H/V | 23 tests de seguridad multi-tenant | DR-001, DR-002 | Alto |
| 28 | TASKS.md | Sprint 0.3 P01-P09 | PoC del Auth Hook a cargo de Claude | DR-012 | Alto |
| 29 | FOLDER_STRUCTURE.md | §1, §1.1, §1.2 | Separación de raíz, .env versionado/no versionado | Decisión aprobada | Medio |
| 30 | FOLDER_STRUCTURE.md | §1.3 | workers/ preparado sin implementar | DR-009 | Bajo |
| 31 | FOLDER_STRUCTURE.md | §2 | jobs/ en application y infrastructure | DR-009 | Bajo |

---

## 3. DECISIONES NUEVAS REGISTRADAS EN ESTA RONDA

Las siguientes instrucciones del owner no tenían ID en DECISION_REGISTER v2.0 y se
registran ahora. **No son decisiones arquitectónicas nuevas de mi parte**: son las
instrucciones recibidas, formalizadas con ID para trazabilidad.

| ID | Decisión | Origen |
|----|----------|--------|
| DR-019 | UUID primary key simple en Fase 0. Sin claves compuestas | Instrucción del owner |
| DR-020 | `tenant_id` y `warehouse_id` desnormalizados en Area y Location, con FK compuesta | Instrucción del owner |
| DR-021 | Índices únicos parciales para entidades con soft delete | Instrucción del owner |
| DR-022 | Particionamiento pospuesto hasta disponer de métricas reales | Instrucción del owner |
| DR-023 | Invariante `quantity = 1` cuando `serial_number` no sea nulo | Instrucción del owner |
| DR-024 | `CountObservation` como entidad independiente para conteos y reconteos | Instrucción del owner |
| DR-025 | `TelemetryPoint` como persistencia independiente | Instrucción del owner |

> **Nota**: la FK compuesta de DR-020 es un detalle de implementación que se desprende
> de la instrucción de desnormalizar. Sin ella, la desnormalización permitiría estados
> inconsistentes. Si el owner prefiere otro mecanismo de garantía (trigger, validación
> de aplicación), es un ajuste menor.

---

## 4. CONFLICTOS NO RESUELTOS

Los siguientes puntos requieren decisión del owner. **No los resolví unilateralmente.**

### CONF-01: `core.roles.permissions` como JSONB vs tabla normalizada

| Aspecto | Detalle |
|---------|---------|
| Situación | `DATABASE_DESIGN.md` §3.8 define `permissions JSONB` en `core.roles`. `DOMAIN_MODEL.md` §3.1 modela `Permission` como Value Object con `module`, `action`, `resource`, `conditions` |
| Conflicto | JSONB no permite FK ni validación de que un permiso referenciado exista. Una tabla `core.permissions` + `core.role_permissions` sí, pero añade 2 tablas y JOINs en cada evaluación |
| Por qué no lo resolví | Es una decisión de diseño con trade-off real, no una corrección de error. Elegir sería introducir una decisión arquitectónica nueva |
| Opciones | A) Mantener JSONB con validación en aplicación. B) Normalizar a 2 tablas. C) Híbrido: catálogo de permisos válidos en tabla + asignación en JSONB validada por trigger |
| Mi recomendación | C. Da validación sin JOINs en el hot path |
| Bloquea | Sprint 0.2 (tabla `core.roles`) |

### CONF-02: Alcance de `tenant_wide_access` respecto a company

| Aspecto | Detalle |
|---------|---------|
| Situación | `tenant_wide_access` es booleano: o ves todos los almacenes del tenant, o solo los asignados |
| Conflicto | `SECURITY.md` §3.2 define el rol `company_manager` ("gestión de una compañía"), que necesitaría ver todos los almacenes **de su company**, no del tenant. El booleano no expresa ese nivel intermedio |
| Por qué no lo resolví | Resolverlo exige o agregar un claim (`company_wide_access` + `company_id`), o una tabla `user_company_access`, o eliminar el rol `company_manager`. Las tres son decisiones nuevas |
| Opciones | A) Agregar tabla `core.user_company_access` análoga a warehouse. B) Agregar claims de company al JWT (contradice DR-003). C) Modelar `company_manager` como conjunto de accesos a warehouse concedidos automáticamente. D) Eliminar el nivel company del modelo de autorización |
| Mi recomendación | C o A. C evita nueva estructura pero requiere sincronización al crear warehouses; A es más limpio |
| Bloquea | Sprint 0.2 (definición de funciones de autorización) |

### CONF-03: `inventory.products` sin scope de warehouse vs índice de barcode

| Aspecto | Detalle |
|---------|---------|
| Situación | DR-010 aprobó que `products` tiene scope tenant. El índice único de `barcode` es `(tenant_id, barcode)` |
| Conflicto | Si dos companies del mismo tenant operan en países distintos, pueden tener productos legítimamente distintos con el mismo barcode (EAN reutilizado entre regiones). El índice a nivel tenant lo impide |
| Por qué no lo resolví | Cambiar el scope de unicidad de barcode es una decisión de negocio, no técnica |
| Opciones | A) Mantener unicidad a nivel tenant (asume catálogo global unificado). B) Unicidad a nivel company (requiere `company_id` en products, contradice DR-010). C) Eliminar la restricción de unicidad de barcode y permitir duplicados con resolución manual |
| Mi recomendación | A para Fase 0. Es el caso mayoritario y el más simple. Revisar si aparece un cliente multi-región con el problema |
| Bloquea | Sprint 0.2 (índices de `inventory.products`) — bloqueo menor |

### CONF-04: Retención de `devices.telemetry_points`

| Aspecto | Detalle |
|---------|---------|
| Situación | DR-025 creó la tabla. `REQUIREMENTS.md` RNF-DATA-003 exige retención configurable por tenant |
| Conflicto | La telemetría cruda crece muy rápido (9.000 puntos por vuelo). Sin política de retención definida, la tabla crece sin límite. Pero definir la política ahora es prematuro (módulo de drones es Fase 3) |
| Por qué no lo resolví | No hay datos para elegir el umbral, y es una decisión de producto (¿el cliente paga por retener telemetría?) |
| Opciones | A) Definir default (90 días) ahora, configurable después. B) Dejar sin política hasta Fase 3. C) Agregar a `TenantLimits` desde el inicio |
| Mi recomendación | B, con nota explícita en el diseño de Fase 3. Ya está documentada como pendiente en §6.3 |
| Bloquea | Nada en Fase 0 |

### CONF-05: `MODULES.md` menciona "Doble conteo" pero no define el umbral

| Aspecto | Detalle |
|---------|---------|
| Situación | DR-024 creó `count_observations` para soportar reconteos. El flujo depende de un "umbral del warehouse" |
| Conflicto | Ningún documento define dónde vive ese umbral, su valor default, ni si es por warehouse, por producto o por valor monetario |
| Por qué no lo resolví | Es configuración de negocio que requiere input del dominio |
| Opciones | A) `warehouses.settings` JSONB con `recount_threshold_percent`. B) Tabla de configuración de conteo por warehouse. C) Por categoría de producto |
| Mi recomendación | A para Fase 0 (simple, ya existe el JSONB). Migrar a B si la lógica se complica |
| Bloquea | Sprint 1.3 (implementación de conteos), no Fase 0 |

---

## 5. VERIFICACIÓN DE NO CONTRADICCIÓN CON RLS_STRATEGY v2.0

`RLS_STRATEGY.md` v2.0 no fue modificado. Verificación de que los cambios aplicados
son consistentes con él:

| Punto de RLS v2.0 | Sección sincronizada | Consistente |
|-------------------|---------------------|-------------|
| §2.1 Roles (`olo_app`, `authenticated`, `service_role`) | SECURITY.md §3.6, §6.3 | Sí |
| §2.3 `core.accessible_warehouse_ids()` filtra `revoked_at IS NULL` | DATABASE_DESIGN.md §3.10 (columna agregada + índice parcial) | Sí |
| §3 JWT solo con `tenant_id`, `user_id`, `tenant_wide_access` | SECURITY.md §2.3 | Parcial — ver nota |
| §4.1 RESTRICTIVE + PERMISSIVE | DATABASE_DESIGN.md §2.1 (clasificación por plantilla) | Sí |
| §4.4 Soft delete fuera de RLS | DATABASE_DESIGN.md §12.5 | Sí |
| §5.2 `integrations.sync_jobs` canónico | ARCHITECTURE.md §9.1 | Sí |
| §5.3 Tablas globales con RLS read-only | MULTITENANT.md §5.3, DATABASE_DESIGN.md §3.2.1 | Sí |
| §5.4 audit append-only con alcance honesto | SECURITY.md §6.3.1 | Sí |
| §6.1 Matviews en schema `internal` | DATABASE_DESIGN.md §2 | Sí |
| §9 set_config parameterizado en transacción | MULTITENANT.md §4.2.2 | Sí |

> **Nota sobre §3 (parcial)**: `RLS_STRATEGY.md` v2.0 §3 lista `user_id` como claim
> obligatorio del JWT (siendo `core.users.id`). La instrucción del owner especifica usar
> `sub` como identificador principal y no menciona `user_id` entre los claims propios.
> Sincronicé SECURITY.md según la instrucción del owner (solo `tenant_id` y
> `tenant_wide_access` como claims propios), y documenté que `core.users.id` se resuelve
> en PostgreSQL vía `core.users.auth_id = sub`.
>
> **Esto es una divergencia real** entre la instrucción del owner y RLS_STRATEGY v2.0 §3.
> La función `core.current_user_id()` de RLS v2.0 lee `app_metadata.user_id`; si ese claim
> no se publica, la función caerá al fallback de GUC (`app.current_user`), que solo está
> disponible en el camino `olo_app`. En el camino `authenticated` retornaría NULL, y
> `core.accessible_warehouse_ids()` retornaría array vacío → el usuario no vería ningún
> almacén.
>
> **No modifiqué RLS_STRATEGY.md** (regla 4). Registro esto como conflicto que requiere
> decisión:

### CONF-06: `user_id` en el JWT — divergencia entre instrucción y RLS v2.0

| Aspecto | Detalle |
|---------|---------|
| Instrucción del owner | Claims propios iniciales: `tenant_id`, `tenant_wide_access`, `membership_version` (condicional). Usar `sub` como identificador principal |
| RLS_STRATEGY v2.0 §3 | `user_id` (= `core.users.id`) es claim **obligatorio**. `core.current_user_id()` lo lee de `app_metadata.user_id` |
| Consecuencia si no se publica | `core.current_user_id()` retorna NULL en el camino `authenticated` → `accessible_warehouse_ids()` retorna `ARRAY[]` → usuario sin `tenant_wide_access` no ve ningún almacén |
| Opciones | A) Publicar `user_id` en el JWT (RLS v2.0 tal cual, coste: un claim más). B) Modificar `core.current_user_id()` para resolver `core.users.id` desde `sub` con un lookup (coste: 1 query extra por evaluación, mitigable con STABLE). C) Cambiar `accessible_warehouse_ids()` para filtrar por `auth_id` en lugar de `user_id` |
| Mi recomendación | C. `core.user_warehouse_access` puede unirse a `core.users` por `auth_id`, o incluso llevar `auth_id` desnormalizado. Evita el claim extra y evita el lookup. Requiere modificar RLS_STRATEGY v2.0 §2.3, lo cual sí está justificado por contradicción demostrada |
| Bloquea | **Sprint 0.2 y Sprint 0.3** |
| Severidad | **Alta** — es la única divergencia con efecto funcional directo |

---

## 6. DOCUMENTOS NO SINCRONIZADOS EN ESTA RONDA

| Documento | Motivo | Cambios pendientes conocidos |
|-----------|--------|----------------------------|
| RLS_STRATEGY.md | Fuente de verdad, regla 4 | §2.3: posible ajuste por CONF-06 |
| DOMAIN_MODEL.md | No autorizado | §12.1 regla "one aggregate per transaction" contradice ARCHITECTURE.md §6.4.1. §4.1 Company referencia `country_id`. §5.1 CountItem sin observaciones. §7.1 DroneMission con telemetría embebida. Falta `version` en entidades transaccionales |
| REQUIREMENTS.md | No autorizado | RF-TENANT-009 (creación sin intervención manual) debe marcarse Fase 4 explícitamente. Glosario debe usar terminología de TERMINOLOGY.md |
| MODULES.md | No autorizado | §4.1 "Países" debe distinguir catálogo de presencia operativa. §6.3 doble conteo debe referenciar CountObservation |
| API_DESIGN.md | No autorizado | Endpoints `/v1/countries` deben distinguir catálogo global de `tenant_countries`. Falta 409 Conflict para optimistic locking |
| AI_ARCHITECTURE.md | No autorizado | Sin cambios detectados |
| INTEGRATION_STRATEGY.md | No autorizado | Sin cambios detectados |
| CODING_STANDARDS.md | No autorizado | Convención de migraciones apunta a ruta antigua |
| VISION.md | No autorizado | Menciona Kubernetes en el stack; debe marcarse como futuro |
| ROADMAP.md | No autorizado | Fase 0 debe reflejar gating de sprints |
| RISK_ANALYSIS.md | No autorizado | Agregar riesgo de CONF-06 |

---

*Ronda 1 de sincronización completada.*
*Versión: 1.0*
*Fecha: Julio 2026*
