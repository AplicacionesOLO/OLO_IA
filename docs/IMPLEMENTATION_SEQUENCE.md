# OLO_IA — SECUENCIA DE IMPLEMENTACIÓN E IMPLEMENTATION MAP

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Estado:** contrato de ejecución.
> **Relación con otros documentos:** `PHASE_0_EXECUTION_BACKLOG.md` sigue siendo el backlog operativo con IDs `F0-`. Este documento aporta el **mapa módulo↔artefacto** y la **secuencia con puertas de verificación**.

---

## 1. IMPLEMENTATION MAP

Cada módulo, con sus seis artefactos. `—` significa que no aplica en la fase.

### 1.1 Fase 0 — Fundación

| Módulo | Documento | Migración | Backend | Frontend | Tests | CI |
|---|---|---|---|---|---|---|
| **Infra y tooling** | `FOLDER_STRUCTURE.md`, `CODING_STANDARDS.md` | — | `pyproject.toml`, app factory, health | `package.json`, Vite, TS strict | smoke de `/health` y `/ready` | lint, mypy, tsc, trufflehog |
| **Entorno Supabase** | `MIGRATION_ROADMAP.md` §8 | — | `supabase/config.toml` | — | `to_regprocedure('auth.jwt()')` no nulo | `supabase start` en el job |
| **Schemas y roles** | `FINAL_DATABASE_MODEL.md` §2 | 0001, 0002 | — | — | `rolbypassrls = false` para `olo_app` | `check-rls` (consultas A-D) |
| **Catálogos ISO** | `FINAL_DATABASE_MODEL.md` §4.1-4.2 | 0003 | — | — | lectura sí, escritura no | `db lint` |
| **Contexto RLS** | `RLS_IMPLEMENTATION_GUIDE.md` §3 | 0004, 0015 | `db/context.py` | — | tabla de verdad: JWT / GUC / ambos / ninguno | `db lint` (`search_path`) |
| **Triggers** | `FINAL_DATABASE_MODEL.md` §6.2 | 0005 | — | — | `tenant_id → NULL` lanza excepción | — |
| **Tenancy** | `FINAL_DATABASE_MODEL.md` §4.4-4.6 | 0007, 0008, 0009 | `domain/tenant/`, `application/tenant/` | — | aislamiento cross-tenant | `check-rls` |
| **Identidad** | `IDENTITY_AND_AUTH_FLOW.md` §1 | 0010, 0011, 0016 | `domain/identity/` | — | membresía única activa; política T4 | `check-rls` |
| **Jerarquía** | `FINAL_DATABASE_MODEL.md` §4.7-4.9 | 0012, 0015 | `domain/warehouse/` | — | **los 3 invariantes de FK compuesta** | `check-rls` |
| **Autorización** | `IDENTITY_AND_AUTH_FLOW.md` §3.6 | 0013, 0014 | `application/authorization/` | — | revocación inmediata; convergencia de la proyección | `check-rls` |
| **Auth flow** | `IDENTITY_AND_AUTH_FLOW.md` §2 | 0021 | `api/v1/auth/`, middleware | `LoginPage`, `authStore` | E2E login→request→logout | E2E en CI |
| **Auditoría** | `FINAL_DATABASE_MODEL.md` §4.19 | 0019 | `infrastructure/audit/` | — | UPDATE y DELETE denegados | `check-rls` |
| **Idempotencia** | `FINAL_DATABASE_MODEL.md` §4.18 | 0018 | middleware de idempotencia | — | misma clave + hash distinto ⇒ 409 | — |
| **Design system** | `MODULES.md` | — | — | `ui/` sobre Radix | Vitest de componentes | build + tamaño de bundle |
| **Observabilidad** | — | — | logging JSON, correlation IDs | — | todo log lleva `request_id` | — |

### 1.2 Fase 1 — Plataforma operativa

| Módulo | Documento | Migración | Backend | Frontend | Tests | CI |
|---|---|---|---|---|---|---|
| **Files** | `IDENTITY_AND_AUTH_FLOW.md` §2.7 | 0023 | `api/v1/files/`, adaptador de Storage | uploader | prefijo de ruta; confirmación contra Storage | — |
| **Jobs** | `FINAL_DATABASE_MODEL.md` §4.21 | 0024 | `JobDispatcher`, `api/v1/jobs/` | poller de estado | ciclo completo del job | — |
| **Catálogo** | `INVENTORY_ENGINE_SPEC.md` | 0025, 0026 | `domain/product/` | `ProductsPage` | SKU único por tenant | `check-rls` |
| **Motor de inventario** | `INVENTORY_ENGINE_SPEC.md` §2-5 | 0028, 0029 | `domain/inventory/`, `apply_movement` | `StockPage` | **L1-L5**; las 10 operaciones; concurrencia | `check-rls` |
| **Conteos** | `INVENTORY_ENGINE_SPEC.md` §6 | 0030, 0031 | `application/counts/` | flujo de conteo | reconteo; cálculo de §6.3 en ambos órdenes | — |
| **Ajustes** | `INVENTORY_ENGINE_SPEC.md` §5.4 | 0027, 0032 | `application/adjustments/` | flujo de aprobación | aprobar+rechazar concurrente ⇒ 409 | — |
| **Incidencias** | `FINAL_DATABASE_MODEL.md` §4.30 | 0033 | `domain/incident/` | `IncidentsPage` | ciclo de vida | — |
| **Admin CRUD** | `MODULES.md` §4 | — | `api/v1/{companies,warehouses,areas,locations}` | páginas de admin | permisos por endpoint | — |
| **Usuarios y roles** | `IDENTITY_AND_AUTH_FLOW.md` §3.6 | — | `api/v1/{users,roles,invitations}` | matriz de permisos | 403 sin permiso | — |
| **Integraciones** | `INTEGRATION_STRATEGY.md` | 0036-0038 | `infrastructure/connectors/` | wizard | conector genérico REST | — |
| **Reportes** | `MODULES.md` §11 | — | motor de reportes vía Jobs | `ReportsPage` | generación asíncrona | — |
| **Notificaciones** | `FINAL_DATABASE_MODEL.md` §4.23 | 0039 | `api/v1/notifications/` | centro de notificaciones | Realtime con RLS | — |

### 1.3 Fases 2 y 3 — resumen

| Fase | Migraciones | Backend | Frontend | Tests clave |
|---|---|---|---|---|
| **2 · IA** | 0040-0048 | `IInferenceEngine`, adaptador YOLO, cola | anotación, galería | contrato del motor; mapeo detección→inventario |
| **3 · Drones y espacial** | 0049-0056 | ingesta RTSP, telemetría por lotes | visor de planos, live | latencia de ingesta; particionamiento |

---

## 2. SECUENCIA CON PUERTAS DE VERIFICACIÓN

Una puerta es un punto donde **no se continúa** si la verificación falla.

```
┌─ ETAPA 0 · DESBLOQUEO ─────────────────────────────────────────┐
│ Docker Desktop instalado                                        │
│ Modelo de identidad validado por ChatGPT                        │
│ RLS_STRATEGY.md v3.0 revisado por ChatGPT                       │
│ Escenarios de escala aprobados                                  │
│ Requisitos de auth clasificados (DEC-09)                        │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
              ╔══ PUERTA G0 ══════════════════════════════╗
              ║ `supabase start` levanta el stack completo ║
              ║ `to_regprocedure('auth.jwt()')` no es NULL ║
              ╚═══════════════════════╤═══════════════════╝
                                      ▼
┌─ ETAPA 1 · REPOSITORIO Y CI ───────────────────────────────────┐
│ Repo, monorepo, tooling, CI, pre-commit, ADRs, JobDispatcher    │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
              ╔══ PUERTA G1 ══════════════════════════════╗
              ║ CI verde con Supabase local               ║
              ║ Un test roto a propósito ⇒ CI ROJO        ║
              ║ Setup de un dev externo < 30 min          ║
              ╚═══════════════════════╤═══════════════════╝
                                      ▼
┌─ ETAPA 2 · CIMIENTOS DE BD (0001-0006) ────────────────────────┐
│ Schemas, olo_app, catálogos, funciones de contexto, triggers    │
│ PoC de contexto con auth.jwt() real                             │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
              ╔══ PUERTA G2 · PUNTO DE NO RETORNO ════════╗
              ║ Contexto llega por AMBOS canales          ║
              ║ Sin contexto ⇒ 0 filas                   ║
              ║ olo_app con rolbypassrls = false         ║
              ╚═══════════════════════╤═══════════════════╝
                                      ▼
┌─ ETAPA 3 · MODELO CORE (0007-0021) ────────────────────────────┐
│ Tenancy → identidad → jerarquía → autorización → auditoría     │
│ Hook + seed de 2 tenants                                        │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
              ╔══ PUERTA G3 ══════════════════════════════╗
              ║ Los 3 invariantes de FK compuesta fallan  ║
              ║ Cero almacenes asignados ⇒ cero acceso    ║
              ║ Anti-recursión users↔memberships          ║
              ║ Sin fuga por pooler                      ║
              ║ check-rls y db lint limpios              ║
              ╚═══════════════════════╤═══════════════════╝
                                      ▼
┌─ ETAPA 4 · AUTH Y FRONTEND ────────────────────────────────────┐
│ Middleware, endpoints, RBAC, design system, login funcional     │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
              ╔══ PUERTA G4 · FIN DE FASE 0 ══════════════╗
              ║ JWT solo con sub, role, tenant_id,        ║
              ║   tenant_wide_access                     ║
              ║ Revocar permiso ⇒ efecto inmediato       ║
              ║ Recurso de otro tenant por ID ⇒ 404      ║
              ║ Cobertura backend > 80%                  ║
              ╚═══════════════════════╤═══════════════════╝
                                      ▼
┌─ ETAPA 5 · MOTOR DE INVENTARIO (Fase 1) ───────────────────────┐
│ Files, Jobs, catálogo, ledger, balances, conteos, ajustes       │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
              ╔══ PUERTA G5 ══════════════════════════════╗
              ║ L1: SUM(ledger) = balances.quantity      ║
              ║ L3: transferencias suman cero            ║
              ║ Carrera conteo↔movimiento correcta en    ║
              ║   AMBOS órdenes posibles                 ║
              ║ Dos reservas concurrentes ⇒ una 422      ║
              ╚═══════════════════════════════════════════╝
```

### 2.1 Por qué G2 es el punto de no retorno

Antes de G2, un error en el mecanismo de contexto cuesta rehacer cinco migraciones. Después de la etapa 3, cuesta rehacer veintiuna y todos sus tests. El PoC va deliberadamente antes de la primera tabla de negocio.

El mecanismo ya está verificado contra PostgreSQL 15.8 vanilla en ocho sub-pruebas; G2 lo confirma con `auth.jwt()` real. El riesgo bajó de alto a medio, pero la puerta se mantiene.

---

## 3. QUÉ HACE CADA AGENTE

| Agente | Responsabilidad | No hace |
|---|---|---|
| **Claude** | Migraciones, RLS, funciones, motor de inventario, middleware, tests de aislamiento y concurrencia, CI, CLI de Supabase y GitHub | Diseño visual, redacción de especificaciones funcionales |
| **Kiro** | Documentación funcional, ADRs, scaffolding de frontend, design system, páginas CRUD, trazabilidad de requisitos | Migraciones, RLS, motor de inventario |
| **ChatGPT** | Revisión arquitectónica, arbitraje, revisión de `RLS_STRATEGY.md` v3.0 (que no puedo auditar con independencia) | Implementación |
| **Humano** | Decisiones de negocio, credenciales, autorizaciones, aprobación de puertas | — |

---

## 4. ESTIMACIÓN

| Etapa | Duración | Agente |
|---|---|---|
| 0 · Desbloqueo | 1-2 días + instalar Docker | Humano, ChatGPT |
| 1 · Repo y CI | 2 semanas | Claude, Kiro |
| 2 · Cimientos de BD | 1 semana | Claude |
| 3 · Modelo core | 3 semanas | Claude |
| 4 · Auth y frontend | 3-4 semanas | Claude, Kiro |
| **Fase 0** | **9-11 semanas** | |
| 5 · Motor de inventario | 5-6 semanas | Claude |
| Resto de Fase 1 | 8-10 semanas | Claude, Kiro |
| **Fase 1** | **13-16 semanas** | |

Fase 0 baja de 11-13 a 9-11 semanas respecto a la estimación anterior: el diseño está cerrado y los supuestos verificados, así que desaparece el trabajo de descubrimiento. Sigue por encima de las 8 semanas de `PHASE_0_PLAN.md`, que no contaba el sprint de desbloqueo ni las tablas exigidas por decisiones aprobadas.

---

## 5. DEFINICIÓN DE «TERMINADO»

Para una migración:
- [ ] Aplicada en local y en dev
- [ ] Rollback **probado** en desechable (obligatorio si el riesgo es alto)
- [ ] `check-rls` y `db lint` limpios
- [ ] Tests de aislamiento verdes, ejecutados como `olo_app`
- [ ] `EXPLAIN ANALYZE` con ≥ 100.000 filas: `Index Scan`

Para un módulo de backend:
- [ ] Contrato OpenAPI publicado
- [ ] Permiso verificado en cada endpoint
- [ ] `AuditEvent` en toda mutación
- [ ] Idempotencia en todo POST que mute estado
- [ ] `ETag`/`If-Match` en recursos versionados
- [ ] Cobertura > 80 %
- [ ] Test de aislamiento a nivel de API: recurso de otro tenant ⇒ **404, no 403**

Para un módulo de frontend:
- [ ] Sin lógica de negocio (`RT-007`)
- [ ] Estados de carga, error y vacío
- [ ] Elementos ocultos según permisos
- [ ] `warehouse` en la `queryKey` de React Query
- [ ] Strings localizables

---

*Secuencia de implementación. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
