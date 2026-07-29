# OLO_IA - REGISTRO DE DECISIONES

## Convenciones

- **Aprobada**: Decisión tomada, implementar tal cual.
- **Pendiente**: Necesita más análisis pero no bloquea.
- **Requiere decisión humana**: Bloquea hasta que el owner decida.
- **Pospuesta**: No relevante para la fase actual.

---

| ID | Decisión | Estado | Docs Afectados | Alternativas | Recomendación | Impacto | Prioridad |
|----|----------|--------|---------------|-------------|--------------|---------|-----------|
| DR-001 | RLS_STRATEGY.md v2.0 es la fuente de verdad para seguridad de datos | **Aprobada** | SECURITY.md, MULTITENANT.md | — | Propagar correcciones a documentos originales | Crítico | P0 |
| DR-002 | Modelo de roles PostgreSQL: authenticated (frontend/usuario), olo_app (workers internos con RLS), service_role (solo ops administrativas aisladas) | **Aprobada** | RLS_STRATEGY, SECURITY, DEPLOYMENT | — | Ver §A abajo para detalle | Crítico | P0 |
| DR-003 | JWT mínimo: solo sub, role, tenant_id, tenant_wide_access. Sin warehouse_ids, permissions, roles completos | **Aprobada** | SECURITY.md §2.3, RLS_STRATEGY §3 | — | Autorización contextual resuelta en PostgreSQL | Crítico | P0 |
| DR-004 | Registro de tenants en Fase 0: solo aprovisionamiento administrativo | **Aprobada** | REQUIREMENTS, MULTITENANT, API_DESIGN | Self-service pospuesto a Fase 4 | — | Medio | P1 |
| DR-005 | Catálogo de países: `public.countries` global + `core.tenant_countries` para activación por tenant | **Aprobada** | DATABASE_DESIGN, MULTITENANT | — | Resolver en Sprint 0.2 | Bajo | P2 |
| DR-006 | Usar Alembic para migraciones (no Supabase CLI migrations) | **Aprobada** | DATABASE_DESIGN, DEPLOYMENT, TASKS | — | — | Bajo | P2 |
| DR-007 | Monolito modular para Fases 0-2. Microservicios solo si métricas lo justifican | **Aprobada** | ARCHITECTURE, DEPLOYMENT | — | — | Alto | P0 |
| DR-008 | Deploy inicial via PaaS (Cloud Run / Fly.io). Kubernetes pospuesto | **Aprobada** | DEPLOYMENT | K8s evaluable cuando se superen 50 req/s sostenidos | — | Medio | P1 |
| DR-009 | Cola de trabajos: FastAPI BackgroundTasks (tareas breves no críticas) + ARQ + Redis (trabajos persistentes con reintentos). Redis se instala cuando exista el primer caso real. Interfaz `JobDispatcher` desde Fase 0 | **Aprobada** | ARCHITECTURE, DEPLOYMENT, TASKS | Celery, Dramatiq, Temporal como alternativas futuras | — | Medio | P1 |
| DR-010 | Productos tienen scope tenant (no almacén). Stock tiene scope almacén | **Aprobada** | DATABASE_DESIGN, DOMAIN_MODEL | — | — | Bajo | P2 |
| DR-011 | `core.user_warehouse_access` requiere columna `revoked_at TIMESTAMPTZ` | **Aprobada** | DATABASE_DESIGN | — | — | Alto | P0 |
| DR-012 | Custom Access Token Hook implementado como función PL/pgSQL (no Edge Function). Ejecución solo para `supabase_auth_admin`. SECURITY DEFINER. Fail-secure | **Aprobada** | RLS_STRATEGY, SECURITY, DEPLOYMENT | Edge Function reservada para hooks que consulten servicios externos | Ver §B abajo | Crítico | P0 |
| DR-013 | Fase 0: access token con TTL corto (15 min). **`membership_version` NO se implementa.** Autorización contextual consultada en PostgreSQL. `revoked_at` con efecto inmediato vía RLS. `membership_version` pospuesto hasta existir un mecanismo real de verificación o revocación | **Aprobada** | SECURITY, DATABASE_DESIGN | A) Implementar membership_version ahora. B) TTL corto + consulta a BD | B: el TTL corto más la consulta a BD hacen innecesario el mecanismo de invalidación de token | Medio | P1 |
| DR-014 | Optimistic locking (`version INT DEFAULT 1`) en entidades transaccionales críticas: stock_records, counts, adjustments | **Aprobada** | DATABASE_DESIGN | — | Implementar durante Sprint 1.3 (inventarios) | Medio | P1 |
| DR-015 | `FORCE ROW LEVEL SECURITY` en todas las tablas de negocio | **Aprobada** | RLS_STRATEGY v2.0 | — | — | Crítico | P0 |
| DR-016 | Soft delete fuera de RLS. Vistas `_active` con `security_invoker = true` | **Aprobada** | RLS_STRATEGY v2.0 §4.4 | — | — | Medio | P1 |
| DR-017 | Frontend: invalidar queries de React Query con warehouse en queryKey al cambiar warehouse | **Pendiente** | ARCHITECTURE | — | — | Bajo | P2 |
| DR-018 | i18n preparado en frontend desde Fase 0 (archivos ES/EN). Backend en inglés hasta Fase 4 | **Pendiente** | REQUIREMENTS, ROADMAP | — | — | Bajo | P2 |
| DR-019 | UUID primary key simple en Fase 0. Sin claves compuestas | **Aprobada** | DATABASE_DESIGN | Claves compuestas naturales | Simplicidad. Revisar solo si hay evidencia de problema | Bajo | P2 |
| DR-020 | `tenant_id` y `warehouse_id` desnormalizados en `core.areas` y `core.locations`, garantizados con FK compuesta | **Aprobada** | DATABASE_DESIGN, RLS_STRATEGY | Derivar por JOIN en cada política RLS | FK compuesta elimina el riesgo de inconsistencia que introduce la desnormalización | Alto | P0 |
| DR-021 | Índices únicos parciales (`WHERE deleted_at IS NULL`) en toda entidad con soft delete | **Aprobada** | DATABASE_DESIGN | Índices totales (bloquean reutilización de códigos borrados) | 10 índices afectados, 4 excepciones legítimas | Medio | P1 |
| DR-022 | Particionamiento pospuesto para todas las tablas hasta disponer de métricas reales | **Aprobada** | DATABASE_DESIGN | Particionar `audit.events` desde el inicio | Umbrales de reevaluación definidos por tabla | Medio | P1 |
| DR-023 | Invariante `CHECK (serial_number IS NULL OR quantity = 1)` en `inventory.stock_records` | **Aprobada** | DATABASE_DESIGN, DOMAIN_MODEL | Validación solo en aplicación | Un número de serie identifica una unidad física única | Medio | P1 |
| DR-024 | `inventory.count_observations` como entidad independiente para conteos, doble conteo y reconteos | **Aprobada** | DATABASE_DESIGN, DOMAIN_MODEL, MODULES | `counted_quantity` inline (permite una sola observación) | Requisito de doble conteo de MODULES §6.3 era irrealizable sin esto | Alto | P0 |
| DR-025 | `devices.telemetry_points` como tabla independiente, no array JSONB en `drone_missions` | **Aprobada** | DATABASE_DESIGN, DOMAIN_MODEL | Array JSONB embebido | 9.000 puntos por vuelo hacen el array inviable (TOAST, reescritura de fila) | Alto | P1 |
| DR-026 | Sprint 0.1 no puede crear migraciones definitivas de dominio. Solo migración smoke test desechable | **Aprobada** | TASKS | Crear el schema en Sprint 0.1 | El schema depende de la auditoría técnica paralela en curso | Alto | P0 |
| DR-027 | 7 condiciones de entrada (C1-C7) para desbloquear Sprint 0.2, incluida aprobación explícita del owner | **Aprobada** | TASKS | Iniciar Sprint 0.2 tras Sprint 0.1 | Control de ejecución por fases | Alto | P0 |
| DR-028 | Transacciones multi-aggregate permitidas para invariantes críticas, con criterio de 3 puntos | **Aprobada** | ARCHITECTURE, DOMAIN_MODEL | Regla absoluta de un aggregate por transacción | 5 casos autorizados enumerados | Alto | P0 |

---

## CONFLICTOS PENDIENTES DE DECISIÓN

Detectados durante la Ronda 1 de sincronización. **No resueltos unilateralmente.**

| ID | Conflicto | Opciones | Recomendación | Bloquea | Severidad |
|----|-----------|----------|--------------|---------|-----------|
| CONF-01 | `core.roles.permissions` JSONB vs tabla normalizada | A) JSONB + validación en app. B) Normalizar a 2 tablas. C) Catálogo en tabla + asignación JSONB validada por trigger | C | Sprint 0.2 | Media |
| CONF-02 | `tenant_wide_access` booleano no expresa el nivel `company_manager` | A) Tabla `core.user_company_access`. B) Claims de company en JWT (contradice DR-003). C) `company_manager` = accesos a warehouse auto-concedidos. D) Eliminar nivel company de autorización | C o A | Sprint 0.2 | Media |
| CONF-03 | Unicidad de `barcode` a nivel tenant puede bloquear casos multi-región | A) Mantener a nivel tenant. B) A nivel company (contradice DR-010). C) Sin restricción | A para Fase 0 | Sprint 0.2 (menor) | Baja |
| CONF-04 | Retención de `devices.telemetry_points` sin definir | A) Default 90 días ahora. B) Definir en Fase 3. C) Agregar a TenantLimits | B | Nada en Fase 0 | Baja |
| CONF-05 | Umbral de reconteo no definido en ningún documento | A) `warehouses.settings` JSONB. B) Tabla de config de conteo. C) Por categoría de producto | A para Fase 0 | Sprint 1.3 | Baja |
| **CONF-06** | **`user_id` en el JWT: la instrucción del owner lo omite, RLS_STRATEGY v2.0 §3 lo declara obligatorio** | A) Publicar `user_id` en el JWT. B) `current_user_id()` resuelve desde `sub` con lookup. C) `accessible_warehouse_ids()` filtra por `auth_id` en lugar de `user_id` | **C** — evita claim extra y evita lookup. Requiere modificar RLS_STRATEGY v2.0 §2.3, justificado por contradicción demostrada | **Sprint 0.2 y 0.3** | **Alta** |

### Detalle de CONF-06 (el único con efecto funcional directo)

Si el JWT no publica `user_id`:

```
core.current_user_id()
  → auth.jwt() -> 'app_metadata' ->> 'user_id'   → NULL (no se publica)
  → current_setting('app.current_user', true)     → NULL (solo existe en camino olo_app)
  → retorna NULL

core.accessible_warehouse_ids()
  → WHERE uwa.user_id = core.current_user_id()    → WHERE uwa.user_id = NULL
  → retorna ARRAY[]::uuid[]

core.can_access_warehouse(x)
  → has_tenant_wide_access() = false
  → x = ANY(ARRAY[])  → false
  → DENIEGA
```

Resultado: **todo usuario sin `tenant_wide_access` quedaría sin acceso a ningún almacén**
en el camino `authenticated`. Es un fallo de disponibilidad total, no de seguridad, pero
bloquea el funcionamiento.

La opción C lo resuelve sin agregar claims: `core.user_warehouse_access` se relaciona con
`core.users` por `auth_id` (desnormalizado o vía JOIN), y `accessible_warehouse_ids()`
filtra por `core.current_auth_id()`, que sí resuelve desde `sub`.

---

## §A — MODELO DE ROLES POSTGRESQL (Detalle DR-002)

### Categoría A: Solicitudes en nombre de usuarios

```
Frontend o Backend con JWT del usuario
  → Rol: authenticated
  → RLS activo (políticas evalúan claims del JWT via auth.jwt())
  → Casos: toda operación iniciada por un usuario humano
```

**Ejemplos**: CRUD de warehouses, ejecutar conteo, ver dashboard, crear producto.

### Categoría B: Procesos internos sujetos a RLS

```
Worker / Backend interno sin JWT de usuario
  → Rol: olo_app (LOGIN, NOBYPASSRLS, NOINHERIT)
  → Contexto establecido con set_config() parameterizado
  → RLS activo (políticas evalúan GUC via current_setting())
  → Casos: sync jobs, report generation, scheduled tasks
```

**Ejemplos**: Sync de conector WMS (opera en contexto del tenant dueño del conector), generación de reporte programado, procesamiento de cola de inferencia.

### Categoría C: Operaciones privilegiadas (cross-tenant)

```
service_role (BYPASSRLS)
  → Únicamente para operaciones administrativas explícitas
  → Nunca expuesto al frontend
  → Uso mínimo y enumerado
  → Auditoría obligatoria de cada invocación
  → Funciones o servicios aislados (nunca en flujo normal)
```

**Ejemplos (exhaustivos para Fase 0)**:
- Provisioning de nuevo tenant
- Suspensión/reactivación de tenant
- Métricas agregadas cross-tenant (platform dashboard)
- Impersonation de soporte
- Refresh de materialized views globales

**Regla**: Si una operación puede resolverse con `authenticated` o `olo_app` + contexto, NO se usa `service_role`.

---

## §B — CUSTOM ACCESS TOKEN HOOK (Detalle DR-012)

### Implementación: Función PL/pgSQL

```sql
-- Esquema de la función (conceptual, no ejecutar todavía)
CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_tenant_id uuid;
    v_tenant_wide boolean;
    v_claims jsonb;
BEGIN
    -- Extraer sub del evento
    v_user_id := (event -> 'claims' ->> 'sub')::uuid;
    
    -- Buscar membresía activa
    SELECT u.tenant_id, 
           EXISTS(
             SELECT 1 FROM core.user_role_assignments ura
             JOIN core.roles r ON r.id = ura.role_id
             WHERE ura.user_id = u.id
               AND ura.scope_type = 'global'
               AND r.name IN ('tenant_owner', 'tenant_admin')
           )
    INTO v_tenant_id, v_tenant_wide
    FROM core.users u
    WHERE u.auth_id = v_user_id
      AND u.status = 'active'
      AND u.deleted_at IS NULL;
    
    -- Fail-secure: sin membresía activa, no agregar claims custom
    IF v_tenant_id IS NULL THEN
        RETURN event;
    END IF;
    
    -- Construir claims adicionales preservando los obligatorios de Supabase
    v_claims := (event -> 'claims')::jsonb;
    v_claims := jsonb_set(v_claims, '{app_metadata,tenant_id}', to_jsonb(v_tenant_id::text));
    v_claims := jsonb_set(v_claims, '{app_metadata,tenant_wide_access}', to_jsonb(v_tenant_wide));
    
    -- Retornar evento con claims modificados
    RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM authenticated;
GRANT  EXECUTE ON FUNCTION auth.custom_access_token_hook TO supabase_auth_admin;
```

### Propiedades

| Propiedad | Valor | Razón |
|-----------|-------|-------|
| SECURITY DEFINER | Sí | Debe leer `core.users` sin que el caller (supabase_auth_admin) necesite SELECT directo |
| search_path | `''` (vacío) | Previene ataques de schema path hijacking |
| STABLE | Sí | No modifica datos, puede ser cacheada por statement |
| Fail-secure | Sí | Si no hay membresía activa, retorna evento sin modificar (usuario no obtiene claims custom → RLS deniega todo) |
| Complejidad | 1 query | Simple y rápido, no consulta servicios externos |

### Lo que NO va en el hook
- Listas de warehouse_ids (se resuelven en runtime por RLS)
- Permissions completas (se resuelven en application layer)
- Información sensible (emails, datos fiscales)
- Módulos contratados (se verifican en application layer)

---

*Documento actualizado con resoluciones aprobadas.*
*Versión: 2.0*
*Fecha: Julio 2026*
