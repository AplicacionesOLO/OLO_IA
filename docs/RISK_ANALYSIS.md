# OLO_IA - ANÁLISIS DE RIESGOS

## 1. INTRODUCCIÓN

Este documento identifica, clasifica y mitiga los riesgos técnicos, de negocio y operacionales del proyecto OLO_IA.

### 1.1 Matriz de Clasificación

| | Impacto Bajo | Impacto Medio | Impacto Alto | Impacto Crítico |
|---|---|---|---|---|
| **Probabilidad Alta** | Medio | Alto | Crítico | Crítico |
| **Probabilidad Media** | Bajo | Medio | Alto | Crítico |
| **Probabilidad Baja** | Bajo | Bajo | Medio | Alto |

---

## 2. RIESGOS TÉCNICOS

### RT-01: Limitaciones de Supabase a Escala

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Alto |
| Clasificación | **ALTO** |
| Descripción | Supabase podría no soportar la carga de 1000+ tenants o tener limitaciones en RLS performance, connection pooling o Realtime. |
| Indicadores | Latencia > 500ms, connection pool exhaustion, Realtime drops |
| Mitigación | 1. Abstracción de infraestructura (nunca llamar Supabase directamente desde dominio). 2. Plan B: migración a PostgreSQL self-hosted + GoTrue para auth. 3. Load testing temprano (Fase 0). 4. Monitoring proactivo de métricas de DB. |
| Contingencia | Migrar a RDS/Cloud SQL con abstractions ya implementadas. Timeline estimado: 2-4 semanas con abstractions. |

### RT-02: Complejidad de RLS con Queries Complejas

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Medio |
| Clasificación | **MEDIO** |
| Descripción | RLS puede degradar performance en queries con múltiples JOINs, aggregaciones o subqueries. |
| Indicadores | Query plan con Seq Scan, latencia > 1s en dashboards |
| Mitigación | 1. Índices compuestos incluyendo tenant_id siempre primero. 2. Materialized views para dashboards. 3. EXPLAIN ANALYZE obligatorio en code review. 4. Query optimization sprints programados. |
| Contingencia | Crear read replicas con vistas pre-filtradas. Implementar cache layer (Redis). |

### RT-03: GPU Availability para IA

| Atributo | Valor |
|----------|-------|
| Probabilidad | Alta |
| Impacto | Alto |
| Clasificación | **CRÍTICO** |
| Descripción | GPUs cloud son costosas y pueden tener disponibilidad limitada. El servicio de IA podría no escalar. |
| Indicadores | Cola de inferencia > 50 jobs, training wait > 24h |
| Mitigación | 1. CPU fallback para inferencia (modelos small). 2. Multi-cloud GPU (AWS, GCP, Azure spot instances). 3. Model optimization (TensorRT, ONNX, quantization). 4. Fair scheduling entre tenants. 5. Auto-scale con preemptible/spot instances. |
| Contingencia | Modelos más pequeños (yolov8n vs yolov8x). Batch processing en horarios off-peak. Priorización por plan tier. |

### RT-04: Complejidad de Integración con WMS Diversos

| Atributo | Valor |
|----------|-------|
| Probabilidad | Alta |
| Impacto | Medio |
| Clasificación | **ALTO** |
| Descripción | Cada WMS tiene APIs distintas, formatos diferentes, autenticaciones variadas. Algunos pueden no tener API documentada. |
| Indicadores | Tiempo de implementación de conector > 2 semanas, errores de mapeo frecuentes |
| Mitigación | 1. Conector genérico REST configurable (cubre 60% de casos). 2. Framework de transformación robusto. 3. Documentar cada integración extensamente. 4. Sandbox de testing por conector. 5. Partner program para integradores especializados. |
| Contingencia | CSV/Excel como formato de intercambio universal (siempre funciona). Middleware externo (Mulesoft, etc.) para WMS complejos. |

### RT-05: Streaming Video en Tiempo Real

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Medio |
| Clasificación | **MEDIO** |
| Descripción | El procesamiento de video RTSP en tiempo real con inferencia IA es computacionalmente intensivo y propenso a latencia. |
| Indicadores | Latencia glass-to-glass > 5s, frame drops > 10% |
| Mitigación | 1. Edge processing (inferencia cerca del origen). 2. Frame skip adaptativo (no procesar todos los frames). 3. Buffering inteligente. 4. Resolución adaptativa según bandwidth. 5. Procesamiento asíncrono (no bloquear stream). |
| Contingencia | Modo "captura periódica" en lugar de streaming continuo. Procesamiento offline de video grabado. |

### RT-06: Parsing de Archivos DWG/DXF

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Bajo |
| Clasificación | **BAJO** |
| Descripción | Los formatos AutoCAD son complejos y las librerías open-source pueden no cubrir todos los casos. |
| Indicadores | Archivos que no parsean, layers incorrectos |
| Mitigación | 1. Soportar DXF primero (formato abierto, mejor documentado). 2. DWG como best-effort con ezdxf/ODA File Converter. 3. Fallback: upload de imagen/SVG del plano. 4. Validación al upload con preview. |
| Contingencia | Solicitar exportación a DXF/SVG al cliente. Ofrecer servicio de conversión manual. |

### RT-07: Seguridad Multi-Tenant (Data Leak)

| Atributo | Valor |
|----------|-------|
| Probabilidad | Baja |
| Impacto | Crítico |
| Clasificación | **ALTO** |
| Descripción | Un bug en RLS, middleware o lógica de aplicación podría exponer datos de un tenant a otro. |
| Indicadores | Test de aislamiento fallando, reporte de cliente |
| Mitigación | 1. RLS a nivel de DB (no solo aplicación). 2. Tests automatizados de aislamiento en cada PR. 3. Penetration testing trimestral. 4. Code review obligatorio para cambios en auth/RLS. 5. Principio de mínimo privilegio en todo. 6. Audit logging de todo acceso a datos. |
| Contingencia | Incident response plan. Notificación a clientes afectados < 72h. Post-mortem público. Compensación al cliente. |

---

## 3. RIESGOS DE NEGOCIO

### RN-01: Mercado No Validado Suficientemente

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Crítico |
| Clasificación | **CRÍTICO** |
| Descripción | La demanda de IA aplicada a inventarios podría ser menor a la esperada, o los clientes podrían no estar dispuestos a pagar el precio necesario. |
| Mitigación | 1. Buscar cliente piloto ANTES de Fase 1 completa. 2. Validar pricing con 5+ prospectos. 3. Empezar con módulos de inventario (valor probado) y agregar IA progresivamente. 4. Ofrecer tier gratuito limitado para tracción. |
| Contingencia | Pivotar a herramienta de gestión de inventario (sin IA) como core, con IA como addon premium. |

### RN-02: Time-to-Market Lento

| Atributo | Valor |
|----------|-------|
| Probabilidad | Alta |
| Impacto | Alto |
| Clasificación | **CRÍTICO** |
| Descripción | La arquitectura empresarial desde el día 1 puede alargar el tiempo hasta tener un producto usable por clientes. |
| Mitigación | 1. Fase 0 acotada a 2 meses máximo. 2. Cliente piloto en Fase 1 (mes 3-4). 3. Features mínimos pero completos (no half-baked). 4. Priorización estricta (P0 primero). 5. No over-engineer features de Fase 3+ en Fase 0. |
| Contingencia | Reducir scope de Fase 1 al mínimo absoluto para piloto. Entrega incremental cada 2 semanas. |

### RN-03: Equipo Insuficiente

| Atributo | Valor |
|----------|-------|
| Probabilidad | Alta |
| Impacto | Alto |
| Clasificación | **CRÍTICO** |
| Descripción | El proyecto es ambicioso y requiere expertise en múltiples áreas (backend, frontend, IA, DevOps, seguridad). Un equipo pequeño podría no cubrir todas las necesidades. |
| Mitigación | 1. Arquitectura que maximiza productividad (generación de código, templates). 2. Priorizar hiring de full-stack + ML engineer. 3. Usar servicios managed (Supabase) para reducir carga ops. 4. AI-assisted development (Kiro, Copilot). 5. Documentación para onboarding rápido. |
| Contingencia | Outsource módulos no-core. Retrasar fases según recursos disponibles. |

### RN-04: Competidor con Más Recursos

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Alto |
| Clasificación | **ALTO** |
| Descripción | Un competidor con más recursos (Zebra, Amazon, etc.) podría lanzar una solución similar. |
| Mitigación | 1. Moverse rápido a mercados latinoamericanos (menos competencia). 2. Foco en integración con WMS regionales (SAP, Softland, Exactus). 3. Soporte en español como diferenciador. 4. Precios competitivos para el mercado. 5. Conocimiento de dominio local profundo. |
| Contingencia | Posicionarse como "plataforma de integración" más que "producto de IA". Ser adquiridos por competidor como exit strategy. |

### RN-05: Regulación de Drones

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Medio |
| Clasificación | **MEDIO** |
| Descripción | Regulaciones de aviación podrían restringir o complicar el uso de drones en interiores de almacenes en ciertos países. |
| Mitigación | 1. Módulo de drones es OPCIONAL (no es core). 2. Consultar regulación por país antes de vender el módulo. 3. Diseñar para interiores (regulación más permisiva). 4. Alternativa: cámaras fijas en lugar de drones. |
| Contingencia | Ofrecer solución con cámaras PTZ montadas + IA como alternativa a drones. |

---

## 4. RIESGOS OPERACIONALES

### RO-01: Vendor Lock-in con Supabase

| Atributo | Valor |
|----------|-------|
| Probabilidad | Baja |
| Impacto | Alto |
| Clasificación | **MEDIO** |
| Descripción | Si Supabase cambia precios, reduce features o cierra, la migración podría ser costosa. |
| Mitigación | 1. Abstracción en infrastructure layer (nunca importar supabase directamente en domain/application). 2. Supabase es open-source (self-hosteable). 3. PostgreSQL estándar (portable). 4. Auth abstracted detrás de interface. |
| Contingencia | Self-host Supabase stack. O migrar a: PostgreSQL (RDS) + GoTrue (auth) + MinIO (storage). |

### RO-02: Pérdida de Datos de Cliente

| Atributo | Valor |
|----------|-------|
| Probabilidad | Baja |
| Impacto | Crítico |
| Clasificación | **ALTO** |
| Descripción | Pérdida de datos por fallo de infraestructura, error humano o ataque. |
| Mitigación | 1. Backups automáticos cada 6 horas. 2. Point-in-time recovery (Supabase). 3. Soft delete (nunca hard delete). 4. Storage redundante (multi-AZ). 5. Disaster recovery plan testeado. 6. Immutable audit logs. |
| Contingencia | Restore from backup. RPO < 5 minutos. RTO < 1 hora. Comunicación al cliente inmediata. |

### RO-03: Burnout del Equipo

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Alto |
| Clasificación | **ALTO** |
| Descripción | El scope del proyecto es enorme. Un equipo pequeño trabajando a alta intensidad puede sufrir burnout. |
| Mitigación | 1. Sprints sostenibles (no crunch permanente). 2. Priorización estricta (hacer menos, mejor). 3. Celebrate wins (cada milestone). 4. Automatizar todo lo repetitivo. 5. Contratación planificada antes de Fase 2. |
| Contingencia | Reducir scope. Extender timelines. Contratar freelancers para picos. |

---

## 5. RIESGOS DE CALIDAD

### RC-01: Deuda Técnica Acumulada

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Alto |
| Clasificación | **ALTO** |
| Descripción | Presión por entregar puede llevar a shortcuts que acumulan deuda técnica. |
| Mitigación | 1. Definition of Done estricta (tests, lint, types, review). 2. Refactoring sprints cada 3 sprints. 3. Monitoring de métricas de calidad (coverage, complexity). 4. Tech debt backlog visible y priorizado. 5. Arquitectura clean desde día 1 (la deuda es más costosa de pagar después). |
| Contingencia | Sprint dedicado de cleanup si métricas caen. |

### RC-02: Precisión de IA Insuficiente

| Atributo | Valor |
|----------|-------|
| Probabilidad | Media |
| Impacto | Alto |
| Clasificación | **ALTO** |
| Descripción | Los modelos de IA podrían no alcanzar la precisión necesaria para uso en producción (mAP < 85%). |
| Mitigación | 1. PoC temprano con datos reales (Sprint 0). 2. Dataset de calidad (labeling riguroso). 3. Múltiples arquitecturas para comparar. 4. Transfer learning desde modelos pre-trained. 5. Feedback loop humano para mejorar. 6. Threshold de confianza configurable. |
| Contingencia | Modo "asistido" donde IA sugiere pero humano confirma. No reemplazar conteo manual sino complementar. |

---

## 6. PLAN DE MONITOREO DE RIESGOS

| Frecuencia | Actividad |
|-----------|-----------|
| Semanal | Review de indicadores de riesgos críticos |
| Bi-semanal | Sprint retrospective incluye riesgos |
| Mensual | Revisión formal del risk register |
| Trimestral | Penetration testing + load testing |
| Por milestone | Go/No-Go assessment de riesgos |

---

## 7. RESUMEN EJECUTIVO

### Riesgos Críticos (requieren atención inmediata)

1. **GPU Availability** → Multi-cloud + optimization + CPU fallback
2. **Market Validation** → Piloto temprano, pricing validation
3. **Time-to-Market** → Scope control, entrega incremental
4. **Team Size** → Hiring plan, managed services, AI-assist

### Riesgos Altos (requieren plan activo)

5. **Supabase Scale** → Abstraction + load testing
6. **WMS Integration** → Generic connector + framework
7. **Data Security** → RLS + testing + pen testing
8. **Competitor** → Speed + regional focus + domain expertise
9. **Data Loss** → Backups + DR plan
10. **Burnout** → Sustainable pace + hiring
11. **Tech Debt** → DoD + quality gates
12. **AI Accuracy** → PoC early + human-in-loop

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
