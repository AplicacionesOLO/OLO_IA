# OLO_IA - AUDITORÍA ARQUITECTÓNICA

> Versión 2.0 — Actualizado con resoluciones aprobadas.

## RESUMEN EJECUTIVO

Se auditaron los 18 documentos como un sistema único. La arquitectura es **coherente en su visión, segura en su diseño y lista para implementación** tras la aprobación de las decisiones críticas.

**Estado de preparación: READY WITH CONDITIONS** — Las condiciones son exclusivamente sincronización de documentos originales (esfuerzo < 2 horas) y un PoC técnico del Custom Access Token Hook (esfuerzo ~2 horas).

---

## 1. FORTALEZAS

1. **Jerarquía consistente**: Tenant → Country → Company → Warehouse → Area → Location idéntica en todos los documentos.
2. **IA completamente desacoplada del dominio**: Interfaces definidas, YOLO es solo un adapter en infrastructure.
3. **RLS v2.0 es ejecutable y correcta**: Patrón RESTRICTIVE + PERMISSIVE, rol olo_app, FORCE RLS, fail-secure.
4. **Modelo de 3 roles PostgreSQL bien definido**: authenticated (usuario), olo_app (workers), service_role (admin aislado).
5. **JWT mínimo**: Reduce superficie de ataque, revocación inmediata de permisos, sin bloat de token.
6. **Custom Hook PL/pgSQL**: Simple, eficiente, fail-secure, sin dependencia de infraestructura externa.
7. **Cola de trabajos pragmática**: BackgroundTasks para lo trivial, ARQ+Redis cuando se necesite, interfaz para swap.
8. **Roadmap respeta dependencias**: Seguridad → Multi-tenant → Módulos → IA → Drones.
9. **Monolito modular + PaaS**: Complejidad operacional mínima para equipo pequeño.
10. **Conector genérico REST**: Cubre mayoría de WMS sin desarrollo custom.

---

## 2. CONTRADICCIONES (pendientes de sincronización)

Las decisiones aprobadas resuelven las contradicciones. Los documentos originales aún contienen la información desactualizada:

| # | Contradicción | Documento a corregir | Resolución |
|---|--------------|---------------------|-----------|
| C-01 | JWT con warehouse_ids y permissions | SECURITY.md §2.3 | Eliminar. JWT solo tiene tenant_id + tenant_wide_access |
| C-02 | Roles ficticios (api_user, audit_writer) | SECURITY.md §6.3 | Reemplazar por authenticated, olo_app, service_role |
| C-03 | core.countries con tenant_id | DATABASE_DESIGN.md §3.2 | Cambiar a public.countries global + core.tenant_countries |
| C-04 | sync_logs vs sync_jobs | ARCHITECTURE.md | Usar sync_jobs (canónico) |
| C-05 | SET LOCAL con f-string | MULTITENANT.md §4.2 | Reemplazar por set_config parameterizado |

**Ninguna de estas bloquea Sprint 0.1.** Las correcciones 1-3 deben aplicarse antes de Sprint 0.2.

---

## 3. VACÍOS RESUELTOS

| Vacío original | Resolución |
|---------------|-----------|
| Custom Access Token Hook sin definir | DR-012: función PL/pgSQL documentada en DECISION_REGISTER §B |
| Task queue sin tecnología | DR-009: BackgroundTasks + interfaz JobDispatcher + ARQ cuando se necesite |
| Context switching en frontend | Pospuesto a P2; solución: invalidar queryKey con warehouse |

---

## 4. VACÍOS RESIDUALES (no bloqueantes)

| # | Vacío | Cuándo resolver | Impacto |
|---|-------|----------------|---------|
| 1 | Tabla `core.notifications` no existe en DATABASE_DESIGN | Sprint 1.1 | No bloquea Fase 0 |
| 2 | Tabla `core.invitations` no existe | Sprint 0.3 (al implementar invite flow) | Bajo |
| 3 | Feature flags sin tabla ni servicio | Sprint 1.3 o cuando se necesite | Bajo |
| 4 | Webhooks outbound: tabla de configuración | Fase 4 | No relevante ahora |
| 5 | membership_version mecanismo no definido | Sprint 0.3 (decidir si TTL basta) | DR-013 pendiente |
| 6 | Optimistic locking no en schema actual | Sprint 1.3 al implementar inventarios | DR-014 aprobada |
| 7 | Gestión de secretos: herramienta específica | Sprint 0.1 (env vars + Supabase vault) | Bajo |
| 8 | Import masivo: formato de errores parciales | Sprint 1.3 | Bajo |

---

## 5. DOCUMENTOS ORIGINALES QUE DEBEN SINCRONIZARSE

La siguiente es la lista priorizada de ediciones pendientes sobre los 18 documentos originales:

### Prioritarios (antes de Sprint 0.2)

| Documento | Cambio |
|-----------|--------|
| **SECURITY.md** | §2.3: JWT mínimo. §6.3: roles reales de Supabase. §3.2: eliminar warehouse_ids de role hierarchy si los menciona como claim |
| **DATABASE_DESIGN.md** | §3.2: modelo híbrido de countries. §3.10: agregar revoked_at. Agregar version column como nota para Sprint 1.3 |
| **MULTITENANT.md** | §4.2: reemplazar código inseguro por set_config parameterizado. Agregar nota sobre caminos authenticated vs olo_app |

### Secundarios (antes de Sprint 0.3)

| Documento | Cambio |
|-----------|--------|
| **ARCHITECTURE.md** | Corregir sync_logs → sync_jobs. Agregar nota sobre JobDispatcher interface |
| **DEPLOYMENT.md** | Eliminar K8s como requisito Fase 0. Agregar PaaS como target de staging |

### Terciarios (pueden esperar a Fase 1)

| Documento | Cambio |
|-----------|--------|
| **TASKS.md** | Actualizar tareas 011-030 para reflejar modelo de países híbrido y hook PL/pgSQL |
| **FOLDER_STRUCTURE.md** | Agregar `backend/src/infrastructure/jobs/` para JobDispatcher |

---

## 6. RECOMENDACIÓN ARQUITECTÓNICA SOBRE DESPLIEGUE

Kubernetes queda pospuesto. La arquitectura de deploy para Fases 0-2:

```
LOCAL DEV:
  Docker Compose (Supabase local + Backend + Frontend)

STAGING:
  PaaS (Cloud Run / Fly.io)
  ├── Backend container (FastAPI)
  ├── Frontend container (Nginx + static)
  └── Supabase Cloud (shared project, branch de staging)

PRODUCTION (cuando exista primer cliente):
  PaaS (mismo proveedor)
  ├── Backend container (FastAPI) x2 min
  ├── Frontend via CDN (Vercel o CloudFlare Pages)
  └── Supabase Cloud (proyecto dedicado producción)
```

Kubernetes se evalúa cuando: > 50 req/s sostenidos, > 5 workers de IA, o necesidad de GPU scaling.

---

## 7. MÉTRICAS FINALES POST-RESOLUCIÓN

| Métrica | Valor |
|---------|-------|
| Problemas críticos | **2** (ambos son ediciones de docs, no técnicos) |
| Decisiones bloqueantes | **0** |
| Inconsistencias entre documentos | **5** (todas con corrección definida) |
| Riesgos altos | **4** (todos con mitigación) |
| Vacíos bloqueantes | **0** |
| Vacíos no bloqueantes | **8** (todos con fecha de resolución) |

---

*Documento actualizado con resoluciones aprobadas.*
*Versión: 2.0*
*Fecha: Julio 2026*
