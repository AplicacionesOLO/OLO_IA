# OLO_IA - ROADMAP DE IMPLEMENTACIÓN

## 1. RESUMEN EJECUTIVO

Este roadmap define las fases de desarrollo de la plataforma OLO_IA desde su concepción hasta alcanzar madurez de mercado. Está diseñado para construir una base empresarial sólida desde el inicio, incorporando capacidades progresivamente sin necesidad de reescritura.

El enfoque es **fundación primero**: la infraestructura, seguridad y arquitectura multi-tenant se construyen antes de cualquier funcionalidad de negocio.

---

## 2. PRINCIPIOS DEL ROADMAP

1. **No deuda técnica planificada**: Cada fase entrega código de producción, no prototipos.
2. **Valor incremental**: Cada sprint entrega funcionalidad utilizable.
3. **Seguridad antes que features**: La seguridad nunca se posterga.
4. **Testing continuo**: Nada se entrega sin cobertura de tests.
5. **Documentación sincronizada**: La documentación se actualiza con cada entrega.

---

## 3. VISIÓN GENERAL DE FASES

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        ROADMAP OLO_IA - 24 MESES                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  FASE 0        FASE 1         FASE 2         FASE 3         FASE 4           │
│  Fundación     Core Platform  IA & Vision    Drones &       Ecosistema       │
│                                              Digital Twin                     │
│  ─────────     ──────────     ──────────     ──────────     ──────────       │
│  Meses 1-2     Meses 3-6      Meses 7-10    Meses 11-16   Meses 17-24      │
│                                                                               │
│  • Arquit.     • Multi-tenant • YOLO Integ.  • Drones       • API Pública   │
│  • Infra       • Admin        • Inferencia   • Streaming    • Marketplace   │
│  • Auth        • Inventarios  • Training     • Planos       • SDK           │
│  • CI/CD       • Integ. WMS   • Datasets     • Digital Twin • Partners      │
│  • DB Base     • Reportes     • Video/Img    • Rutas        • Expansión     │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. FASE 0: FUNDACIÓN (Meses 1-2)

### 4.1 Objetivo
Establecer toda la infraestructura técnica, arquitectura base, pipeline de CI/CD, esquema de base de datos core y sistema de autenticación. Al finalizar esta fase, el equipo debe poder desarrollar features sobre una base sólida.

### 4.2 Sprints

#### Sprint 0.1 - Infraestructura y Proyecto (Semanas 1-2)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Repositorio monorepo | Estructura de carpetas definitiva | Linting, formatting, pre-commit hooks |
| Docker Compose | Entorno local completo | Un comando levanta todo el stack |
| CI/CD Pipeline | GitHub Actions base | Build, test, lint en cada PR |
| Supabase Project | Proyecto configurado | Conexión verificada desde backend |
| Entorno de desarrollo | Scripts de setup | Nuevo dev productivo en < 30 min |
| Documentación técnica | ADRs iniciales | Decisiones arquitectónicas registradas |

#### Sprint 0.2 - Base de Datos Core (Semanas 3-4)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Schema multi-tenant | Tablas core de tenancy | Countries, Companies, Warehouses |
| Migraciones Alembic | Sistema de migraciones | Up/down funcionando, versionado |
| RLS Policies base | Políticas de aislamiento | Tenant isolation verificado con tests |
| Seed data | Datos iniciales | Ambiente de desarrollo poblado |
| Índices optimizados | Índices para queries frecuentes | Explain plan verificado |

#### Sprint 0.3 - Autenticación y Seguridad (Semanas 5-6)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Supabase Auth integrado | Login/Register/Logout | Flujo completo funcionando |
| JWT + Refresh Tokens | Manejo de sesiones | Tokens rotan correctamente |
| RBAC base | Roles y permisos | Super Admin, Admin, User |
| Middleware de auth | Protección de endpoints | 401/403 correctos |
| Auditoría base | Log de eventos de auth | Login, logout, failed attempts |

#### Sprint 0.4 - Frontend Foundation (Semanas 7-8)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Proyecto React + Vite | Setup con TypeScript strict | Build sin errores, HMR funcional |
| Design System base | Componentes primitivos | Button, Input, Modal, Table, etc. |
| Layout principal | Shell de la aplicación | Sidebar, Header, Content area |
| Routing protegido | Rutas con auth guard | Redirect a login sin sesión |
| Theme Dark Mode | Sistema de theming | Toggle funcional, persistente |
| React Query setup | Configuración global | Interceptors, error handling |

### 4.3 Entregables de Fase 0

- [ ] Entorno de desarrollo reproducible con un comando.
- [ ] Pipeline CI/CD operativo (build + test + lint).
- [ ] Base de datos con schema multi-tenant y RLS.
- [ ] Sistema de autenticación completo.
- [ ] Frontend con design system base y routing.
- [ ] Documentación de arquitectura actualizada.

### 4.4 KPIs de Fase 0

| Métrica | Target |
|---------|--------|
| Tiempo de setup nuevo dev | < 30 min |
| Cobertura de tests core | > 80% |
| Build time CI | < 5 min |
| Vulnerabilidades críticas | 0 |

---

## 5. FASE 1: CORE PLATFORM (Meses 3-6)

### 5.1 Objetivo
Construir la plataforma operativa con los módulos esenciales de administración, gestión de inventarios y la primera integración WMS. Al finalizar, la plataforma debe ser capaz de gestionar clientes reales con operaciones básicas de inventario.

### 5.2 Sprints

#### Sprint 1.1 - Administración Multi-Tenant (Semanas 9-11)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| CRUD Países | Gestión de países | Crear, editar, activar/desactivar |
| CRUD Compañías | Gestión de compañías por país | Asociación a país, configuración |
| CRUD Almacenes | Gestión de almacenes por compañía | Configuración independiente por almacén |
| CRUD Áreas | Áreas dentro de almacén | Jerarquía completa |
| CRUD Ubicaciones | Ubicaciones dentro de áreas | Códigos, tipos, capacidad |
| Panel Super Admin | Vista de gestión global | Métricas de uso por tenant |

#### Sprint 1.2 - Gestión de Usuarios y Permisos (Semanas 12-14)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| CRUD Usuarios | Gestión completa de usuarios | Invitación, activación, desactivación |
| CRUD Roles | Roles configurables | Permisos granulares por módulo |
| Asignación de permisos | UI de gestión de permisos | Matriz módulo × acción × rol |
| Permisos por almacén | Acceso granular | Usuario puede ver solo sus almacenes |
| Perfil de usuario | Configuración personal | Idioma, timezone, avatar, preferencias |
| Invitaciones | Sistema de invitación por email | Flujo completo con expiración |

#### Sprint 1.3 - Módulo de Inventarios (Semanas 15-18)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Gestión de productos | Catálogo de SKUs | CRUD completo con imágenes |
| Registro de stock | Existencias por ubicación | Cantidad, lote, fecha, estado |
| Conteos manuales | Proceso de conteo | Crear, ejecutar, cerrar conteo |
| Ajustes de inventario | Regularizaciones | Motivos, aprobaciones, historial |
| Incidencias | Registro de discrepancias | Tipos, severidad, asignación |
| Dashboard inventarios | Vista general | KPIs, alertas, estado actual |

#### Sprint 1.4 - Integraciones WMS Base (Semanas 19-21)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Framework de conectores | Arquitectura de plugins | Interface base, lifecycle |
| Conector genérico REST | Conector configurable | Mapeo de campos, auth configurable |
| Conector SAP (básico) | Lectura de maestros | Productos, ubicaciones, stock |
| Sincronización | Motor de sync | Bidireccional, delta, full |
| Logs de integración | Trazabilidad | Cada operación logueada |
| Reintentos | Manejo de fallos | Backoff exponencial, dead letter |

#### Sprint 1.5 - Reportes y Analytics Base (Semanas 22-24)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Motor de reportes | Generación de reportes | PDF, Excel, CSV |
| Reportes predefinidos | Inventario, movimientos, conteos | Templates configurables |
| Dashboard ejecutivo | Vista gerencial | KPIs, tendencias, comparativas |
| Filtros avanzados | Por fecha, almacén, área | Combinables, guardables |
| Exportaciones | Bulk export | Async para grandes volúmenes |
| Programación | Reportes automáticos | Cron, envío por email |

### 5.3 Entregables de Fase 1

- [ ] Administración multi-tenant completa (País → Compañía → Almacén → Área → Ubicación).
- [ ] Gestión de usuarios con RBAC completo.
- [ ] Módulo de inventarios operativo.
- [ ] Framework de integraciones con al menos 1 conector WMS funcional.
- [ ] Sistema de reportes básico.
- [ ] Primer cliente piloto onboarded.

### 5.4 KPIs de Fase 1

| Métrica | Target |
|---------|--------|
| Tiempo de onboarding tenant | < 2 horas |
| Latencia API p95 | < 500ms |
| Cobertura tests | > 75% |
| Satisfacción piloto | > 4/5 |
| Bugs críticos en producción | 0 |

---

## 6. FASE 2: IA Y VISIÓN (Meses 7-10)

### 6.1 Objetivo
Integrar el motor de IA YOLO como primera implementación, construir el pipeline completo de inferencia, entrenamiento y gestión de datasets. La plataforma debe ser capaz de realizar detección de objetos en imágenes y video para procesos de inventario.

### 6.2 Sprints

#### Sprint 2.1 - Arquitectura de Motores IA (Semanas 25-27)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Interface IAEngine | Abstracción de motores | Contrato claro, extensible |
| Registro de motores | Catálogo de engines | CRUD, versionado, configuración |
| YOLO Engine impl. | Primera implementación | Detectar objetos en imagen |
| Pipeline de inferencia | Flujo request → result | Async, cola, resultado |
| Gestión de modelos | CRUD modelos entrenados | Upload, versión, activar/desactivar |
| Métricas de modelo | Performance tracking | mAP, precision, recall, tiempo |

#### Sprint 2.2 - Gestión de Datasets (Semanas 28-30)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Upload de imágenes | Bulk upload a Storage | Drag & drop, preview, metadata |
| Anotaciones | Herramienta de anotación | Bounding boxes, labels, export |
| Datasets | Agrupación lógica | Train/val/test split |
| Versionado | Versiones de dataset | Historial, comparación |
| Formatos de export | YOLO, COCO, Pascal VOC | Conversión automática |
| Estadísticas | Análisis de dataset | Distribución de clases, balance |

#### Sprint 2.3 - Pipeline de Entrenamiento (Semanas 31-33)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Configuración de training | Hiperparámetros | UI para configurar epochs, batch, etc. |
| Ejecución de training | Lanzar entrenamiento | GPU allocation, progress tracking |
| Monitoreo | Métricas en tiempo real | Loss, mAP por epoch |
| Resultados | Evaluación post-training | Confusion matrix, PR curves |
| Comparación de modelos | A/B de modelos | Side-by-side metrics |
| Deployment de modelo | Activar modelo entrenado | One-click deploy a producción |

#### Sprint 2.4 - Procesamiento de Imágenes y Video (Semanas 34-37)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Upload de videos | Subida y procesamiento | Formatos comunes, thumbnail |
| Extracción de frames | Video → Imágenes | Configurable (fps, intervalo) |
| Inferencia batch | Procesar múltiples imágenes | Cola, progreso, resultados |
| Inferencia video | Procesar video completo | Frame by frame, output anotado |
| Galería de resultados | Visualización | Filtros, búsqueda, export |
| API de inferencia | Endpoint público | REST, async, webhook callback |

### 6.3 Entregables de Fase 2

- [ ] Arquitectura de motores IA desacoplada y extensible.
- [ ] YOLO integrado como primer motor funcional.
- [ ] Pipeline completo: Dataset → Training → Model → Inference.
- [ ] Procesamiento de imágenes y video operativo.
- [ ] API de inferencia disponible.
- [ ] Herramienta de anotación de datasets.

### 6.4 KPIs de Fase 2

| Métrica | Target |
|---------|--------|
| Tiempo de inferencia (imagen) | < 2 segundos |
| mAP del modelo base | > 85% |
| Uptime servicio IA | > 99% |
| Throughput inferencia | > 10 img/seg |
| Tiempo de entrenamiento (1000 imgs) | < 2 horas |

---

## 7. FASE 3: DRONES Y DIGITAL TWIN (Meses 11-16)

### 7.1 Objetivo
Implementar el módulo completo de gestión de drones para inventario automatizado y construir la representación digital del almacén (Digital Twin) con integración de planos AutoCAD.

### 7.2 Sprints

#### Sprint 3.1 - Gestión de Dispositivos (Semanas 38-40)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| CRUD Dispositivos | Registro de hardware | Tipo, modelo, serial, estado |
| Tipos de dispositivo | Drones, cámaras, sensores | Configuración por tipo |
| Estado de dispositivos | Monitoreo | Online/offline, batería, ubicación |
| Mantenimiento | Programación | Historial, alertas |
| Firmware | Gestión de versiones | OTA updates tracking |
| Asignación | Dispositivo → Almacén | Multi-almacén posible |

#### Sprint 3.2 - Módulo de Drones (Semanas 41-45)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Planificación de misiones | Definir rutas de vuelo | Waypoints, altitud, velocidad |
| Ejecución de misión | Control de vuelo | Start, pause, abort, resume |
| Captura programada | Fotos/video en puntos | Trigger automático |
| Streaming RTSP | Video en tiempo real | Latencia < 3 seg |
| Telemetría | Datos de vuelo | Posición, batería, sensores |
| Historial de vuelos | Log completo | Ruta real, eventos, duración |

#### Sprint 3.3 - Streaming y Procesamiento en Tiempo Real (Semanas 46-49)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Ingesta RTSP | Recepción de streams | Múltiples fuentes simultáneas |
| Procesamiento en vivo | Inferencia sobre stream | Detecciones en tiempo real |
| Alertas en tiempo real | Notificaciones | WebSocket, push, email |
| Grabación selectiva | Guardar clips relevantes | Trigger por evento/detección |
| Dashboard tiempo real | Visualización live | Múltiples cámaras/drones |
| Supabase Realtime | Eventos en vivo | Broadcast de detecciones |

#### Sprint 3.4 - Planos y Mapas (Semanas 50-53)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Upload de planos | DWG/DXF import | Parsing, renderizado |
| Visualización 2D | Renderizado de plano | Zoom, pan, layers |
| Ubicaciones sobre plano | Mapeo visual | Drag & drop positioning |
| Rutas sobre plano | Visualización de rutas | Drones, picking |
| Heatmaps | Actividad por zona | Frecuencia de acceso, incidencias |
| Export | Generación de planos | PDF, imagen, DXF |

#### Sprint 3.5 - Digital Twin Base (Semanas 54-57)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Modelo digital | Representación del almacén | Áreas, racks, ubicaciones |
| Estado en tiempo real | Sincronización | Ocupación, temperatura |
| Histórico | Playback de estados | Timeline navegable |
| Simulación básica | What-if scenarios | Reorganización virtual |
| Integración con IA | Resultados sobre gemelo | Detecciones mapeadas |
| KPIs espaciales | Métricas por zona | Utilización, rotación |

### 7.3 Entregables de Fase 3

- [ ] Gestión completa de dispositivos (drones, cámaras, sensores).
- [ ] Planificación y ejecución de misiones de drones.
- [ ] Streaming RTSP con procesamiento IA en tiempo real.
- [ ] Visualización de planos AutoCAD con ubicaciones mapeadas.
- [ ] Digital Twin básico con estado en tiempo real.
- [ ] Integración drones ↔ IA ↔ Inventario.

### 7.4 KPIs de Fase 3

| Métrica | Target |
|---------|--------|
| Latencia streaming | < 3 segundos |
| Cobertura de almacén por misión | > 95% |
| Precisión de ubicación | < 50cm error |
| Tiempo de conteo automático vs manual | -70% |
| Disponibilidad sistema drones | > 99% |

---

## 8. FASE 4: ECOSISTEMA (Meses 17-24)

### 8.1 Objetivo
Transformar OLO_IA de un producto a una plataforma/ecosistema. Abrir API pública, crear SDK, establecer marketplace de conectores y construir el programa de partners.

### 8.2 Sprints

#### Sprint 4.1 - API Pública y Developer Center (Semanas 58-62)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| API pública v1 | Endpoints documentados | OpenAPI spec completa |
| Rate limiting | Protección de API | Tiers por plan |
| API Keys | Gestión de credenciales | CRUD, rotación, scopes |
| Developer Portal | Documentación interactiva | Try-it-out, ejemplos |
| SDKs | Python, JavaScript, .NET | Publicados en registros |
| Webhooks | Eventos hacia clientes | Configurables, retry, logs |

#### Sprint 4.2 - Marketplace de Conectores (Semanas 63-67)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Catálogo de conectores | Listado público | Búsqueda, categorías |
| Conectores oficiales | 5+ WMS soportados | SAP, Oracle, Dynamics, Softland, Exactus |
| Conectores community | Framework para terceros | Docs, templates, review process |
| Instalación one-click | Activar conector | Configuración guiada |
| Rating y reviews | Feedback | Calificaciones, comentarios |
| Monetización | Revenue sharing | Para conectores de pago |

#### Sprint 4.3 - Licenciamiento y Facturación (Semanas 68-72)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Motor de licencias | Gestión de planes | Por módulo, por uso, por tier |
| Billing integration | Stripe/similar | Suscripciones, invoices |
| Usage metering | Medición de consumo | Inferencias, storage, API calls |
| Self-service | Upgrade/downgrade | Sin intervención humana |
| Trial management | Períodos de prueba | Automáticos, configurables |
| Revenue analytics | Métricas financieras | MRR, churn, LTV |

#### Sprint 4.4 - Analytics Avanzado y ML (Semanas 73-78)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| Predicción de demanda | ML para forecast | Modelo base entrenado |
| Anomaly detection | Detección de irregularidades | Alertas automáticas |
| Optimización de rutas | Picking path optimization | Algoritmo funcional |
| Benchmarking | Comparativas entre almacenes | Anonimizado, opt-in |
| Recomendaciones | Sugerencias IA | Reorganización, restock |
| Custom analytics | Queries ad-hoc | Builder visual |

#### Sprint 4.5 - Internacionalización y Expansión (Semanas 79-84)

| Entregable | Descripción | Criterio de Aceptación |
|------------|-------------|------------------------|
| i18n completo | Multi-idioma | ES, EN, PT mínimo |
| Multi-moneda | Soporte de monedas | Conversión, formatos |
| Multi-timezone | Zonas horarias | Por almacén, por usuario |
| Compliance regional | Regulaciones por país | GDPR, normativas locales |
| Onboarding self-service | Registro sin fricción | < 5 min primer uso |
| Partner program | Programa de socios | Integradores, revendedores |

### 8.3 Entregables de Fase 4

- [ ] API pública con SDK en 3 lenguajes.
- [ ] Developer Center con documentación interactiva.
- [ ] Marketplace de conectores con 5+ WMS.
- [ ] Sistema de licenciamiento y facturación automatizado.
- [ ] Analytics avanzado con predicción ML.
- [ ] Plataforma internacionalizada (3+ idiomas).
- [ ] Programa de partners activo.

### 8.4 KPIs de Fase 4

| Métrica | Target |
|---------|--------|
| API requests/día | > 1M |
| Conectores disponibles | > 10 |
| Desarrolladores registrados | > 100 |
| Revenue por API | > 20% del total |
| Partners activos | > 10 |
| Países operativos | > 5 |

---

## 9. MILESTONES CLAVE

| Milestone | Fecha Target | Criterio |
|-----------|-------------|----------|
| M0: Infraestructura Ready | Mes 2 | CI/CD, Auth, DB, Frontend shell |
| M1: First Tenant Live | Mes 6 | Cliente piloto operando |
| M2: IA Operational | Mes 10 | Inferencia en producción |
| M3: Drone Mission Complete | Mes 14 | Conteo automatizado E2E |
| M4: Digital Twin Live | Mes 16 | Gemelo digital operativo |
| M5: API Public Launch | Mes 18 | Developer Center abierto |
| M6: Marketplace Launch | Mes 20 | 5+ conectores disponibles |
| M7: International Launch | Mes 24 | 3+ países, 3+ idiomas |

---

## 10. DEPENDENCIAS CRÍTICAS

```
┌─────────────────────────────────────────────────────┐
│              CADENA DE DEPENDENCIAS                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Auth & RLS ──► Multi-tenant ──► Admin Module        │
│       │                              │               │
│       ▼                              ▼               │
│  API Base ───► Inventarios ───► Integ. WMS           │
│       │              │                               │
│       ▼              ▼                               │
│  Storage ───► Datasets ───► Training ───► Inference  │
│       │                                    │         │
│       ▼                                    ▼         │
│  Streaming ──► Drones ──► Misiones ──► Conteo Auto   │
│                              │                       │
│                              ▼                       │
│                     Planos ──► Digital Twin           │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Dependencias Externas

| Dependencia | Riesgo | Mitigación |
|-------------|--------|------------|
| Supabase stability | Medio | Abstracción de infraestructura, plan de migración |
| GPU availability | Alto | Multi-cloud, spot instances, queue management |
| DJI SDK access | Alto | Abstracción de drone SDK, soporte multi-fabricante |
| AutoCAD libraries | Medio | Parser propio DXF, fallback a formatos abiertos |
| Regulación drones | Alto | Diseño modular, drones opcionales por país |

---

## 11. RECURSOS ESTIMADOS POR FASE

| Fase | Duración | Equipo Mínimo | Equipo Ideal |
|------|----------|---------------|--------------|
| Fase 0 | 2 meses | 2 devs (1 full-stack, 1 backend) | 3 devs + 1 DevOps |
| Fase 1 | 4 meses | 3 devs (1 front, 1 back, 1 full) | 5 devs + 1 QA + 1 PM |
| Fase 2 | 4 meses | 3 devs + 1 ML engineer | 5 devs + 2 ML + 1 QA |
| Fase 3 | 6 meses | 4 devs + 1 ML + 1 embedded | 6 devs + 2 ML + 1 QA + 1 PM |
| Fase 4 | 8 meses | 5 devs + 1 ML + 1 DevOps | 8 devs + 2 ML + 2 QA + 1 PM |

---

## 12. GESTIÓN DE RIESGOS DEL ROADMAP

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Retraso en Fase 0 | Media | Crítico | Buffer de 2 semanas, scope mínimo definido |
| Complejidad IA subestimada | Alta | Alto | PoC temprano en Sprint 0, experto ML desde inicio |
| Piloto no satisfecho | Media | Alto | Feedback semanal, iteración rápida |
| Equipo insuficiente | Alta | Alto | Priorización estricta, contratación en Fase 1 |
| Supabase limitaciones | Baja | Medio | Abstracción de infraestructura, plan B |
| Regulación de drones | Media | Medio | Fase 3 diseñada modular, drones opcionales |

---

## 13. CRITERIOS DE GO/NO-GO ENTRE FASES

### Fase 0 → Fase 1
- [ ] CI/CD pipeline verde y estable.
- [ ] Auth funcional con RLS verificado.
- [ ] Frontend shell navegable.
- [ ] Al menos 1 dev externo hizo setup exitoso.
- [ ] Zero vulnerabilidades críticas.

### Fase 1 → Fase 2
- [ ] Al menos 1 cliente piloto activo.
- [ ] CRUD completo de inventarios funcionando.
- [ ] Al menos 1 integración WMS operativa.
- [ ] Performance dentro de SLA (< 500ms p95).
- [ ] Feedback positivo del piloto.

### Fase 2 → Fase 3
- [ ] Inferencia YOLO operativa en producción.
- [ ] Pipeline training → deploy funcional.
- [ ] mAP > 85% en dataset de producción.
- [ ] API de inferencia estable con SLA.
- [ ] Al menos 3 clientes usando módulo IA.

### Fase 3 → Fase 4
- [ ] Al menos 1 misión de dron completada con éxito en producción.
- [ ] Digital Twin sincronizado con datos reales.
- [ ] Streaming procesado en tiempo real sin pérdida.
- [ ] Conteo automatizado verificado con precisión > 90%.
- [ ] Al menos 5 clientes activos.

---

## 14. ROADMAP DE PRODUCTO vs ROADMAP TÉCNICO

### Producto (lo que el cliente ve)
```
Q1 ─── Administración + Inventarios ──────────────────────►
Q2 ─── Reportes + Integraciones WMS ─────────────────────►
Q3 ─── IA (detección + conteo) ──────────────────────────►
Q4 ─── Drones + Streaming ──────────────────────────────►
Q5 ─── Digital Twin + Planos ────────────────────────────►
Q6 ─── API Pública + Marketplace ────────────────────────►
```

### Técnico (lo que el equipo construye)
```
Q1 ─── Infra + Auth + DB + Design System ───────────────►
Q2 ─── Multi-tenant + RBAC + APIs Core ─────────────────►
Q3 ─── Engine Framework + YOLO + Storage Pipeline ──────►
Q4 ─── RTSP + WebSocket + Edge Processing ─────────────►
Q5 ─── DXF Parser + 3D Rendering + State Sync ─────────►
Q6 ─── Rate Limiting + SDK + Billing Engine ────────────►
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
