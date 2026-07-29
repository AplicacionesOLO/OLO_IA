# OLO_IA — MATRIZ DE CONFLICTOS DOCUMENTALES

> **Autor:** Claude Code. **Fecha:** 2026-07-28
> **Alcance:** conflictos detectados entre los 8 documentos auditados en profundidad, más `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md` y los 5 documentos de auditoría de Kiro.
> **Cota inferior:** `AI_ARCHITECTURE.md`, `INTEGRATION_STRATEGY.md`, `FOLDER_STRUCTURE.md`, `CODING_STANDARDS.md` y `RISK_ANALYSIS.md` **no fueron auditados** en esta pasada (1.377 líneas). Esta matriz está incompleta respecto a esos cinco.
> **Nota:** «decisión aprobada 4.x» se refiere a las decisiones de la instrucción recibida en sesión el 2026-07-28. Cuando una decisión aprobada ya resuelve el conflicto, la columna *Decisión requerida* dice «No — sincronizar».

---

## 1. LEYENDA DE PRIORIDAD

| Prioridad | Significado |
|---|---|
| **P0** | Bloquea la primera migración o el primer sprint. Resolver antes de escribir código. |
| **P1** | Bloquea un sprint concreto de Fase 0 o Fase 1. |
| **P2** | Debe corregirse por coherencia; no bloquea ejecución inmediata. |

---

## 2. MATRIZ

| ID | Tema | Documento A | Documento B | Contradicción | Impacto | Recomendación | Decisión requerida | Prioridad |
|---|---|---|---|---|---|---|---|---|
| CONF-01 | Herramienta de migraciones | `DECISION_REGISTER.md:19` (DR-006: Alembic, «Aprobada») | Instrucción de sesión 2026-07-28 (Supabase CLI como fuente única) | Dos herramientas incompatibles aprobadas por vías distintas | **No se puede escribir la primera migración.** Con Alembic, RLS/funciones/Storage van en `op.execute()` a mano y el Studio queda en drift | Supabase CLI: el 70% de lo que Fase 0 necesita es RLS, funciones y triggers, que Alembic no modela | **Sí — DEC-01** | **P0** |
| CONF-02 | Herramienta de migraciones (infra) | `DEPLOYMENT.md:58-59` (Dockerfile copia `alembic/` y `alembic.ini`) | Supabase CLI | El contenedor de producción asume Alembic | Dockerfile inválido si se adopta la CLI | Resolver con CONF-01 y reescribir el Dockerfile en consecuencia | Derivada de DEC-01 | **P0** |
| CONF-03 | Propagación de claims backend→RLS | `PHASE_0_PLAN.md:136` (tarea 043: «NO usar set_config cuando hay JWT») | Semántica real de PostgREST/libpq; `RLS_STRATEGY.md` §2.2 | `request.jwt.claims` lo fija PostgREST, no libpq. Una conexión asyncpg no tiene JWT ⇒ `auth.jwt()` = NULL | **RLS deniega todas las filas** con síntoma «parece seguro». Fallo silencioso en Sprint 0.3 | Emular PostgREST (`SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims',...)`) para tráfico de usuario; `olo_app` + GUC solo para workers | **Sí — DEC-02** | **P0** |
| CONF-04 | Propagación de claims (modelo de roles) | `DECISION_REGISTER.md:40-43` (DR-002 §A: «Backend con JWT del usuario → rol `authenticated` → políticas evalúan `auth.jwt()`») | Igual que CONF-03 | El modelo de 3 roles no especifica **cómo** llegan los claims a la sesión de Postgres | El diseño es correcto; le falta el mecanismo | Documentar el mecanismo exacto en DR-002 §A | Derivada de DEC-02 | **P0** |
| CONF-05 | Imagen de Postgres en CI | `DEPLOYMENT.md:171` (`image: postgres:15`) | `RLS_STRATEGY.md` §2.2 (usa `auth.jwt()` y `auth.uid()`) | Postgres vanilla no tiene schema `auth` | **La migración falla al crear las funciones** ⇒ el job muere ⇒ los tests de aislamiento multi-tenant nunca corren. CI verde en lint, rojo permanente en lo único que protege datos | `supabase/postgres` o `supabase start` en CI | **Sí — DEC-03** | **P0** |
| CONF-06 | Stack local de desarrollo | `DEPLOYMENT.md:36-38` (diagrama: `supabase-local (Auth+Storage)`) | `DEPLOYMENT.md:122-135` (compose real: solo `supabase/postgres`, sin GoTrue, PostgREST, Storage ni Realtime) | Conflicto **interno** del mismo documento | El PoC del Custom Access Token Hook — riesgo nº1 declarado — **no es ejecutable en local** | Reemplazar el `postgres` suelto por `supabase start` | Derivada de DEC-03 | **P0** |
| CONF-07 | PK de tabla particionada | `DATABASE_DESIGN.md:758` (`id UUID PRIMARY KEY`) | `DATABASE_DESIGN.md:774` (`PARTITION BY RANGE (created_at)`) | Conflicto **interno**: PostgreSQL exige la clave de partición en toda constraint única | **El `CREATE TABLE` aborta.** Primera migración de `audit` no ejecuta | Quitar el particionamiento de Fase 0 (decisión 4.3) y dejar PK simple | Derivada de DEC-06 | **P0** |
| CONF-08 | Particionamiento en Fase 0 | `DATABASE_DESIGN.md:774-781` + `PHASE_0_PLAN.md:105` (tarea 026: «particionada mensual») | Decisión aprobada 4.3 («No implementar particionamiento en Fase 0») | Ambos documentos particionan lo que la decisión pospone | Complejidad prematura + CONF-07 | `audit.events` sin particionar en Fase 0. Umbrales C1-C5 en `DATABASE_RECONCILIATION_PLAN.md` §10.1 | **Sí — DEC-06** (¿PK compuesta preventiva en auditoría?) | **P0** |
| CONF-09 | Modelo de países | `DATABASE_DESIGN.md:69-86` (`core.countries` con `tenant_id NOT NULL`) | `DECISION_REGISTER.md:18` (DR-005) + decisión aprobada 4.7 | Cada tenant tiene su propia copia de cada país | 250×1.000 = 250.000 filas duplicadas; el ISO deja de ser un hecho compartido; imposible agrupar cross-tenant | Dividir en `public.countries` + `core.tenant_countries` | No — sincronizar | **P0** |
| CONF-10 | Modelo de países (jerarquía) | `MULTITENANT.md:71-74` (Country como nivel de la jerarquía del tenant) | `MULTITENANT.md:320-330` (`public.countries` catálogo global exento) | Conflicto **interno** del mismo documento | Ambigüedad sobre quién posee el país | El nivel de jerarquía es `tenant_countries`; el catálogo es `public.countries` | No — sincronizar | P1 |
| CONF-11 | Modelo de países (CRUD) | `MODULES.md:75-82` (CRUD editable por `tenant_admin`; «no desactivar con compañías activas») | `DATABASE_RECONCILIATION_PLAN.md` §4.1 (catálogo global solo lectura) | El tenant no puede editar el catálogo ISO, sí su activación | `RF-ADMIN-001` no implementable como está escrito | Reescribir §4.1 de MODULES como CRUD de `tenant_countries` | No — sincronizar | P1 |
| CONF-12 | Modelo de países (API) | `API_DESIGN.md:266-269` (`GET/POST /v1/countries` «del tenant») | DR-005 | La API presupone el modelo rechazado | Endpoints a rediseñar | `GET /v1/countries` global solo lectura + `POST/PATCH /v1/tenant-countries` | No — sincronizar | P1 |
| CONF-13 | Modelo de países (dominio) | `DOMAIN_MODEL.md` §4 (no existe aggregate `Country`; solo `CountryId` en `Company`) | `MULTITENANT.md:71` + `REQUIREMENTS.md` RF-ADMIN-001 (P1) | Un nivel de jerarquía sin entidad de dominio | El aggregate que la API debe exponer no está modelado | Añadir aggregate `TenantCountry` | No — sincronizar | P1 |
| CONF-14 | Contenido del JWT | `SECURITY.md:83-84` (`warehouse_ids`, `permissions` en `app_metadata`) | `DECISION_REGISTER.md:16` (DR-003) + `RLS_STRATEGY.md` §3 + instrucción §5 | JWT con listas y permisos vs JWT mínimo | Revocación diferida 15 min; bloat de token. `RF-RBAC-007` («cambio inmediato de permisos», P1) sería inalcanzable | Eliminar de SECURITY §2.3; añadir `tenant_wide_access` | No — sincronizar | **P0** |
| CONF-15 | Roles de PostgreSQL | `SECURITY.md:483-488` (`REVOKE`/`GRANT` sobre `api_user`, `service_user`, `audit_reader`, `audit_writer`) | `DECISION_REGISTER.md:15` (DR-002) | Cuatro roles que no existen en Supabase ni se crean en ningún documento | El SQL de inmutabilidad de auditoría no ejecuta | Reemplazar por `authenticated`, `olo_app`, `service_role` | No — sincronizar | **P0** |
| CONF-16 | Alcance de la inmutabilidad de auditoría | `SECURITY.md:471-489` (`REVOKE` ⇒ «imposible modificar») | `RLS_STRATEGY.md` §1.2 y §5.4 (`BYPASSRLS` ignora RLS y `service_role` lo tiene) | SECURITY afirma inmutabilidad absoluta sin la salvedad | Afirmación falsa en un documento de compliance | Añadir la salvedad y `platform.privileged_operation_log` como control compensatorio | No — sincronizar | P1 |
| CONF-17 | Columnas de `user_warehouse_access` | `DATABASE_DESIGN.md:278-291` (6 columnas) | Decisión aprobada 4.2 (9 columnas) + `DECISION_REGISTER.md:24` (DR-011) | Faltan `revoked_at`, `source_role_assignment_id`, `created_at`, `updated_at`; el índice único es total y debe ser parcial | **`accessible_warehouse_ids()` de RLS v2.0 no compila**: filtra por una columna inexistente. Bloquea Sprint 0.2 | Añadir las 4 columnas; índice único `WHERE revoked_at IS NULL` | No — sincronizar | **P0** |
| CONF-18 | Modelo de auditoría | `DATABASE_DESIGN.md:757-773` | Decisión aprobada 4.9 | Falta `request_id` y `source`; `changes` vs `old_values`/`new_values`; `resource_*` vs `entity_*`; `created_at` vs `occurred_at` | Cambiar el esquema de auditoría con 40M filas es de las migraciones más caras que existen. Hay que acertar antes | Alinear con 4.9 y crear `previous_hash`/`event_hash` nulas desde el inicio | No — sincronizar | **P0** |
| CONF-19 | Telemetría de drones | `DATABASE_DESIGN.md:676` (`telemetry JSONB DEFAULT '[]'`) + `DOMAIN_MODEL.md:954` (`List[TelemetryPoint]` en el aggregate) | Decisión aprobada 4.5 | Serie temporal completa dentro de una fila y de un aggregate | 12.000 puntos por vuelo; cada append reescribe el JSONB entero (amplificación de escritura) | Tabla `devices.telemetry_points` con `BIGSERIAL` e ingesta por lotes | No — sincronizar | P1 |
| CONF-20 | Observaciones de conteo | `DATABASE_DESIGN.md:411-412` (`counted_quantity` único + `discrepancy` GENERATED) + `DOMAIN_MODEL.md:547-566` | Decisión aprobada 4.10 + `MODULES.md:189` («doble conteo si discrepancia > umbral») | Un solo valor contado; el doble conteo no tiene dónde vivir | `MODULES.md:189` no implementable | Tabla `inventory.count_observations` con `sequence_number` | No — sincronizar | P1 |
| CONF-21 | Serial y cantidad | `DATABASE_DESIGN.md:349` (sin CHECK) + `DOMAIN_MODEL.md:483-505` | Decisión aprobada 4.11 | Es insertable un número de serie con cantidad 40 | Trazabilidad individual (`RF-INV-010`) incoherente | `CHECK (serial_number IS NULL OR quantity = 1)` | No — sincronizar | P1 |
| CONF-22 | Optimistic locking | `DECISION_REGISTER.md:27` (DR-014, «Aprobada») | `DATABASE_DESIGN.md` (ninguna columna `version`) + `API_DESIGN.md` (sin `ETag`/`If-Match`) | Decisión aprobada sin implementación ni transporte | Lost updates en inventario: dos ajustes concurrentes pierden unidades sin error | `version INT` en 13 tablas + `ETag`/`If-Match`/`412` en la API | No — planificar en Sprint 1.3 | P1 |
| CONF-23 | Ledger de movimientos de stock | `REQUIREMENTS.md` RF-INV-007 (P1) + `MODULES.md:175` («historial de entradas/salidas/transfers, trazable») | `DATABASE_DESIGN.md` (no existe `stock_movements`; `adjustment_items` guarda valores absolutos) | Requisito P1 sin modelo de datos | `RF-INV-007` no implementable. Y los ajustes por sobrescritura hacen que la carrera conteo↔movimiento **no tenga solución** | Tabla `inventory.stock_movements` con deltas firmados; `stock_records` como proyección | **Sí — DEC-07** | **P0** |
| CONF-24 | Regla de un aggregate por transacción | `DOMAIN_MODEL.md:1210` («cada transacción modifica UN solo aggregate») | `DOMAIN_MODEL.md:599`, `:317`, `:318`, `:280` (cuatro invariantes que cruzan aggregates) + decisión aprobada 4.6 | Conflicto **interno**; la decisión 4.6 ya elimina la regla absoluta | Determina qué se puede garantizar con constraints y qué no. El stock negativo no admite consistencia eventual | Aplicar 4.6: «una operación modifica el menor número posible de aggregates» | No — sincronizar | P1 |
| CONF-25 | Aggregates con colecciones sin cota | `DOMAIN_MODEL.md:529` (`items: List[CountItem]`) y `:954` | Decisión aprobada 4.5 + `RNF-SCAL-004` | Un conteo completo cargaría 1M de `CountItem` en un aggregate | Inviable en memoria; contradice «preferir aggregates pequeños» (`:1207`) | `CountItem` y `TelemetryPoint` como aggregates propios | No — sincronizar | P1 |
| CONF-26 | Canales de comunicación | `REQUIREMENTS.md` RT-008 («toda comunicación frontend-backend via API REST») | `ARCHITECTURE.md:109-115` + `MODULES.md:334` (frontend con Supabase Realtime directo) + decisión aprobada 4.8 | La restricción prohíbe lo que la arquitectura usa | Determina si la rama JWT del contexto híbrido es necesaria | Aplicar 4.8: enumerar canales autorizados (REST, Auth, Realtime con RLS, Storage con policies, RPC aprobadas) | No — sincronizar | P1 |
| CONF-27 | Capacidades de Supabase Auth | `SECURITY.md:94-107` (expiración a 90 días, historial de 5, bloqueo por intentos, política por tenant, bcrypt cost 12) + `REQUIREMENTS.md` RF-AUTH-007 (**P1, Fase 0**), RF-AUTH-012, RF-AUTH-013, RF-AUTH-014 | `REQUIREMENTS.md` RT-004 («autenticación debe usar Supabase Auth») | Ninguna de esas capacidades es nativa en Supabase Auth; el cost de bcrypt no es configurable | Cuatro requisitos planificados como si fueran flags de configuración. RF-AUTH-007 es P1 en la fase de fundación | Marcar los cuatro como desarrollo propio con diseño explícito, o bajarlos de alcance | **Sí** — alcance de RF-AUTH-007/012/013/014 | P1 |
| CONF-28 | Estado de bloqueo de cuenta | `DATABASE_DESIGN.md:217-218` + `DOMAIN_MODEL.md:113-114` (`failed_login_attempts`, `locked_until` en el aggregate `User`) | Supabase Auth como propietario de la autenticación | Dos fuentes de verdad para el estado de bloqueo | El endpoint público de Supabase Auth **evade el contador del backend** por completo. Y contar por email permite bloquear la cuenta de un tercero | Definir si el login pasa obligatoriamente por el backend; mitigar la enumeración | Derivada de CONF-27 | P1 |
| CONF-29 | Kubernetes | `DEPLOYMENT.md:252-296` (K8s como arquitectura de producción, con escalado y probes) | `DECISION_REGISTER.md:21` (DR-008: PaaS; K8s pospuesto) | Un documento entero de infraestructura pospuesta | Riesgo de que alguien lo implemente | Sustituir §5 por la arquitectura PaaS de `ARCHITECTURE_AUDIT.md` §6 | No — sincronizar | P2 |
| CONF-30 | Redis en Fase 0 | `DEPLOYMENT.md:129-131` (servicio `redis` en el compose) | `DECISION_REGISTER.md:22` (DR-009: Redis cuando exista el primer caso real) + `PHASE_0_PLAN.md:37` («NO incluye Redis») | Redis instalado antes de tener caso de uso | Complejidad local innecesaria | Comentarlo en el compose, como ya prevé `PHASE_0_PLAN.md:69` | No — sincronizar | P2 |
| CONF-31 | `ai-service` en Fase 0 | `DEPLOYMENT.md:110-121` (`ai-service` con reserva de GPU en el compose de dev) | `PHASE_0_PLAN.md:29` («NO incluye YOLO ni ningún motor de IA») | Servicio de IA en el entorno de una fase que excluye IA | Todo dev descarga varios GB de imagen CUDA sin usarla | Sacarlo del compose de Fase 0 | No — sincronizar | P2 |
| CONF-32 | Identificador de correlación | `API_DESIGN.md:113` (`trace_id` en el error) | `API_DESIGN.md:147` (`X-Request-Id`) + `DATABASE_DESIGN.md:772` (`correlation_id`) + decisión 4.9 (`request_id` **y** `correlation_id`) | Tres o cuatro nombres para lo mismo, sin que `TERMINOLOGY.md` los cubra | Imposible correlacionar el error que reporta un usuario con su traza y su evento de auditoría | Fijar dos conceptos distintos: `request_id` (una petición) y `correlation_id` (una cadena de operaciones). Añadirlos a `TERMINOLOGY.md` | **Sí** — nomenclatura | P1 |
| CONF-33 | Idempotencia | `API_DESIGN.md` (no existe `Idempotency-Key` en ningún endpoint) | `API_DESIGN.md:335` (`POST /adjustments/{id}/apply`) + `:327` + `:397` + `:514` | Operaciones que mutan stock sin protección ante reintento | Un doble clic o un retry de red duplica el efecto sobre el inventario. Con el ledger de CONF-23, duplica el delta | Header `Idempotency-Key` obligatorio + tabla `core.idempotency_keys` | No — añadir al alcance | **P0** |
| CONF-34 | Umbrales de stock | `DATABASE_DESIGN.md:315-317` (`min_stock`/`max_stock`/`reorder_point` `INT`, globales al tenant) | `MODULES.md:176` («configurable») + `RF-INV-008` + `quantity DECIMAL(15,4)` | Umbral único por producto para todos los almacenes, y tipo incompatible | Un producto con mínimo 10 en el CD y 2 en la tienda no es representable. `RF-INV-008` no implementable | Tabla `inventory.product_warehouse_settings` con `DECIMAL(15,4)` | No — sincronizar | P1 |
| CONF-35 | Coordenadas sobre plano | `DATABASE_DESIGN.md:187` (`locations.plan_coordinates JSONB`) | `DATABASE_DESIGN.md:804` (`floor_plans.version`) | Las coordenadas viven en la location, pero el plano está versionado | Con dos versiones de plano no hay dónde poner dos juegos de coordenadas | Tabla `spatial.plan_location_mappings` | No — sincronizar | P2 |
| CONF-36 | Borrado de roles | `API_DESIGN.md:307` (`DELETE /v1/roles/{id}`) | `DATABASE_DESIGN.md:234-249` (sin `deleted_at`) + `DOMAIN_MODEL.md:168` («no borrar rol con asignaciones») + `RNF-DATA-004` | Hard delete de una entidad que debe ser soft, con FK entrante sin `ON DELETE` | Error 500 por violación de FK, o pérdida de trazabilidad de quién tuvo qué permiso | Añadir `deleted_at` a `core.roles`; el endpoint pasa a desactivación | No — sincronizar | P1 |
| CONF-37 | Nombre de tabla de sync | `ARCHITECTURE.md:762` (`sync_logs`) | `DATABASE_DESIGN.md:725` (`sync_jobs`) + `RLS_STRATEGY.md` §5.2 (canónico `sync_jobs`) | Dos nombres para la misma tabla | Confusión en migraciones y consultas | `integrations.sync_jobs` canónico | No — sincronizar | P2 |
| CONF-38 | Inventario de schemas | `ARCHITECTURE.md:736-771` (5 + `public`) | `DATABASE_DESIGN.md:31-38` (8) + `RLS_STRATEGY.md` §6.1 (+`internal`) | Tres inventarios distintos; `audit.changes` de `ARCHITECTURE.md:767` no existe en ningún sitio | El script `check-rls` con la lista incompleta **no detectaría tablas sin RLS** en los schemas omitidos | Lista canónica de 10 schemas en `DATABASE_RECONCILIATION_PLAN.md` §2 | No — sincronizar | P1 |
| CONF-39 | Targets de escala | `REQUIREMENTS.md` RNF-SCAL-001 (>1.000 tenants), RNF-SCAL-003 (>100 almacenes/tenant), RNF-SCAL-004 (>1M productos **por almacén**) | `REQUIREMENTS.md` RNF-SCAL-005 (>100M registros) + `MULTITENANT.md:112` (10 almacenes por empresa) | Multiplicados dan 10¹¹, cuatro órdenes de magnitud sobre RNF-SCAL-005. RNF-SCAL-004 además tiene error de unidad: los productos tienen scope tenant (DR-010), no almacén | Los targets no sirven para dimensionar índices, retención ni particiones | Tres escenarios derivados en `DATABASE_RECONCILIATION_PLAN.md` §11 | **Sí** — aprobar escenarios | P1 |
| CONF-40 | Numeración de tareas de Fase 0 | `TASKS.md:21-77` (40 tareas, 001-040) | `PHASE_0_PLAN.md:64-192` (82 tareas, 001-082) | **IDs solapados con significados distintos**: tarea 011 = «Configurar Alembic» vs «FastAPI app factory»; tarea 040 = «TenantStore» vs «Hook fail-secure» | Cualquier referencia a «tarea 0NN» entre agentes es ambigua. Rompe la trazabilidad que Kiro posee | Declarar `TASKS.md` superseded para Fase 0; renumerar con prefijos `F0-`/`F1-` | **Sí — DEC-08** | P1 |
| CONF-41 | Contenido de `TASKS.md` | `TASKS.md:13` («crear tablas countries, companies»), `:38` («configurar Alembic»), `:44` (funciones helper sin `current_auth_id`) | DR-005, DEC-01, `RLS_STRATEGY.md` §2.2 | `TASKS.md` no incorporó ninguna decisión posterior a su v1.0 | Un agente que siga `TASKS.md` implementa el modelo rechazado | Sincronizar o marcar superseded (CONF-40) | Derivada de DEC-08 | P1 |
| CONF-42 | Membresía usuario–tenant | `DATABASE_DESIGN.md:207` (`auth_id UUID NOT NULL UNIQUE` global) | Instrucción §5 («membresía validada», «fallo seguro sin membresía activa») | Con `auth_id` único global, **un humano solo puede pertenecer a un tenant** | Un consultor que trabaje para dos tenants necesita dos cuentas. Es una limitación de producto, no técnica, y no está escrita en ningún sitio | Mantener 1 usuario = 1 tenant en Fase 0, **documentándolo como limitación consciente** | **Sí — DEC-04** | P1 |
| CONF-43 | Evaluación de preparación | `IMPLEMENTATION_READINESS.md:32` (2 críticos, «ambos ediciones de docs, no técnicos») y `:34` (0 decisiones bloqueantes) | `CLAUDE_TECHNICAL_AUDIT.md` §2 (12 críticos, 10 técnicos) y §12 (3 bloqueantes) | Discrepancia sustantiva de evaluación | Si se acepta la evaluación optimista, Sprint 0.2 arranca y se estrella en CONF-05, CONF-07 y CONF-17 | Arbitrar la discrepancia. Coincido en que Sprint 0.1 puede arrancar; discrepo en Sprint 0.2 | **Sí** — arbitraje de ChatGPT | **P0** |
| CONF-44 | Migraciones de plataforma en local | `PHASE_0_PLAN.md:227` («deshabilitar migraciones automáticas de Supabase, usar solo Alembic») | Funcionamiento de Supabase local | Las migraciones de plataforma (schema `auth`, `storage`, `realtime`) **no son opcionales**: sin ellas no hay `auth.jwt()` ni GoTrue | La mitigación de riesgo declarada es inaplicable y agrava CONF-05 | Reformular: las migraciones de plataforma son de Supabase; las de aplicación son nuestras. Nunca se «deshabilitan» las primeras | Derivada de DEC-01/DEC-03 | P1 |
| CONF-45 | Enums extensibles | `DATABASE_DESIGN.md:19` («PostgreSQL ENUM types o lookup tables») | `DATABASE_DESIGN.md` (20+ columnas con `CHECK (x IN (...))`, una tercera opción no documentada) | La convención declara dos mecanismos y usa un tercero | Añadir un motor de IA (`RF-IA-015` promete 5 más) o un conector (`RF-INT-011` promete 4) exige `ALTER ... DROP CONSTRAINT` + recrear | Catálogo para lo extensible (engines, connector types, adjustment reasons); CHECK para lo cerrado (status, severity) | **Sí** — convención | P2 |

---

## 3. RESUMEN

| Prioridad | Conflictos | De ellos, resueltos por decisión ya aprobada (solo sincronizar) |
|---|---|---|
| **P0** | 13 | 5 |
| **P1** | 22 | 15 |
| **P2** | 10 | 8 |
| **Total** | **45** | **28** |

**28 de 45 conflictos ya tienen resolución aprobada** y solo requieren sincronizar los documentos originales. Eso es una señal buena: el trabajo de decisión está hecho en su mayor parte.

**Los 17 restantes requieren decisión.** Se consolidan en las 8 decisiones de `CLAUDE_TECHNICAL_AUDIT.md` §12 más cuatro específicas de esta matriz:

| Decisión | Conflictos que cierra |
|---|---|
| **DEC-01** — herramienta de migraciones | CONF-01, CONF-02, CONF-44 |
| **DEC-02** — propagación de claims backend→RLS | CONF-03, CONF-04 |
| **DEC-03** — imagen de Postgres en CI y stack local | CONF-05, CONF-06, CONF-44 |
| **DEC-04** — membresía multi-tenant | CONF-42 |
| **DEC-05** — FK compuestas para la jerarquía | (integridad; ver auditoría §5) |
| **DEC-06** — particionamiento y PK de auditoría | CONF-07, CONF-08 |
| **DEC-07** — ledger de movimientos de stock | CONF-23, CONF-24 |
| **DEC-08** — numeración y vigencia de `TASKS.md` | CONF-40, CONF-41 |
| **DEC-09** — alcance de RF-AUTH-007/012/013/014 | CONF-27, CONF-28 |
| **DEC-10** — nomenclatura de correlación | CONF-32 |
| **DEC-11** — aprobación de los escenarios de escala | CONF-39 |
| **DEC-12** — convención de enums vs catálogos | CONF-45 |
| **DEC-13** — arbitraje de la discrepancia de evaluación | CONF-43 |

---

## 4. ORDEN DE SINCRONIZACIÓN RECOMENDADO

**No sincronizar nada antes de arbitrar DEC-01, DEC-02 y DEC-03.** Editar los documentos ahora propagaría el conflicto a más sitios.

Una vez arbitradas:

| Orden | Documento | Conflictos que cierra | Antes de |
|---|---|---|---|
| 1 | `DATABASE_DESIGN.md` | CONF-07, 08, 09, 17, 18, 21, 34, 35, 36, 38, 45 | Sprint 0.2 |
| 2 | `SECURITY.md` | CONF-14, 15, 16, 27 | Sprint 0.2 |
| 3 | `DEPLOYMENT.md` | CONF-02, 05, 06, 29, 30, 31 | Sprint 0.1 |
| 4 | `PHASE_0_PLAN.md` | CONF-03, 08, 44 | Sprint 0.2 |
| 5 | `MULTITENANT.md` | CONF-10, 39 | Sprint 0.2 |
| 6 | `TASKS.md` | CONF-40, 41 | Sprint 0.1 |
| 7 | `API_DESIGN.md` | CONF-12, 22, 32, 33, 36 | Sprint 0.3 |
| 8 | `DOMAIN_MODEL.md` | CONF-13, 19, 20, 24, 25 | Fase 1 |
| 9 | `REQUIREMENTS.md` | CONF-26, 27, 39 | Fase 1 |
| 10 | `ARCHITECTURE.md` | CONF-37, 38 | Fase 1 |
| 11 | `TERMINOLOGY.md` | CONF-32 | Fase 1 |
| 12 | `DECISION_REGISTER.md` | DR-006 según DEC-01; DR-002 §A según DEC-02 | Sprint 0.1 |

`DEPLOYMENT.md` sube al puesto 3 pese a su prioridad P2 nominal porque CONF-05 y CONF-06 bloquean el CI y el entorno local, que son Sprint 0.1.

---

*Matriz de conflictos. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
