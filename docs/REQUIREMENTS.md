# OLO_IA - REQUERIMIENTOS

## 1. INTRODUCCIÓN

Este documento define los requerimientos funcionales y no funcionales de la plataforma OLO_IA. Cada requerimiento está categorizado, priorizado y trazable a los módulos y fases del roadmap correspondientes.

### 1.1 Convenciones de Prioridad

| Prioridad | Significado |
|-----------|-------------|
| **P0 - Critical** | Indispensable para lanzamiento. Sin esto la plataforma no opera. |
| **P1 - High** | Necesario para valor comercial. Requerido para primer cliente. |
| **P2 - Medium** | Importante para competitividad. Puede esperar 1-2 sprints. |
| **P3 - Low** | Deseable. Mejora la experiencia pero no bloquea operación. |

### 1.2 Convenciones de Estado

| Estado | Significado |
|--------|-------------|
| **DRAFT** | Definido, pendiente de validación |
| **APPROVED** | Validado y priorizado |
| **IN PROGRESS** | En desarrollo |
| **DONE** | Implementado y verificado |
| **DEFERRED** | Pospuesto a fase posterior |

---

## 2. REQUERIMIENTOS FUNCIONALES

### 2.1 RF-AUTH: Autenticación y Sesiones

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-AUTH-001 | El sistema debe permitir registro de usuarios mediante email y contraseña | P0 | 0 |
| RF-AUTH-002 | El sistema debe permitir login con email y contraseña | P0 | 0 |
| RF-AUTH-003 | El sistema debe emitir JWT con claims de tenant, roles y permisos | P0 | 0 |
| RF-AUTH-004 | El sistema debe implementar refresh tokens con rotación automática | P0 | 0 |
| RF-AUTH-005 | El sistema debe permitir logout con invalidación de tokens | P0 | 0 |
| RF-AUTH-006 | El sistema debe soportar recuperación de contraseña por email | P0 | 0 |
| RF-AUTH-007 | El sistema debe bloquear cuenta tras N intentos fallidos (configurable) | P1 | 0 |
| RF-AUTH-008 | El sistema debe soportar MFA (TOTP) como opción por tenant | P2 | 1 |
| RF-AUTH-009 | El sistema debe soportar SSO via SAML 2.0 para clientes enterprise | P3 | 4 |
| RF-AUTH-010 | El sistema debe soportar SSO via OpenID Connect | P3 | 4 |
| RF-AUTH-011 | El sistema debe registrar todo evento de autenticación en log de auditoría | P0 | 0 |
| RF-AUTH-012 | El sistema debe permitir configurar política de contraseñas por tenant | P2 | 1 |
| RF-AUTH-013 | El sistema debe cerrar sesiones inactivas tras timeout configurable | P1 | 0 |
| RF-AUTH-014 | El sistema debe permitir ver y cerrar sesiones activas del usuario | P2 | 1 |

### 2.2 RF-TENANT: Multi-Tenancy

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-TENANT-001 | El sistema debe soportar múltiples tenants con aislamiento total de datos | P0 | 0 |
| RF-TENANT-002 | Cada tenant debe poder tener múltiples compañías | P0 | 0 |
| RF-TENANT-003 | Cada compañía debe poder tener múltiples almacenes | P0 | 0 |
| RF-TENANT-004 | Cada almacén debe poder tener múltiples áreas | P0 | 1 |
| RF-TENANT-005 | Cada área debe poder tener múltiples ubicaciones | P0 | 1 |
| RF-TENANT-006 | Un usuario nunca debe ver datos de un tenant al que no pertenece | P0 | 0 |
| RF-TENANT-007 | El sistema debe asociar países a la jerarquía organizacional | P1 | 1 |
| RF-TENANT-008 | Cada almacén debe poder configurarse independientemente (timezone, idioma, moneda) | P1 | 1 |
| RF-TENANT-009 | El sistema debe soportar la creación de tenants sin intervención manual | P2 | 4 |
| RF-TENANT-010 | El Super Admin debe poder visualizar métricas agregadas de todos los tenants | P1 | 1 |
| RF-TENANT-011 | El sistema debe permitir suspender un tenant sin eliminar datos | P1 | 1 |
| RF-TENANT-012 | El sistema debe permitir configurar límites por tenant (usuarios, almacenes, storage) | P1 | 1 |

### 2.3 RF-RBAC: Roles y Permisos

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-RBAC-001 | El sistema debe implementar roles predefinidos (Super Admin, Admin, Manager, Operator, Viewer) | P0 | 0 |
| RF-RBAC-002 | El sistema debe permitir crear roles personalizados por tenant | P1 | 1 |
| RF-RBAC-003 | Los permisos deben ser granulares por módulo y acción (create, read, update, delete) | P0 | 0 |
| RF-RBAC-004 | Los permisos deben poder restringirse por almacén | P0 | 1 |
| RF-RBAC-005 | El sistema debe soportar herencia de permisos (rol padre → rol hijo) | P2 | 1 |
| RF-RBAC-006 | Un usuario puede tener múltiples roles en diferentes almacenes | P1 | 1 |
| RF-RBAC-007 | El cambio de permisos debe reflejarse inmediatamente (sin esperar re-login) | P1 | 1 |
| RF-RBAC-008 | El sistema debe registrar todo cambio de permisos en auditoría | P0 | 0 |
| RF-RBAC-009 | El sistema debe soportar ABAC para reglas complejas (horario, IP, ubicación) | P3 | 2 |
| RF-RBAC-010 | La UI debe adaptar elementos visibles según permisos del usuario activo | P1 | 1 |

### 2.4 RF-ADMIN: Administración

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-ADMIN-001 | CRUD completo de países con configuración regional | P1 | 1 |
| RF-ADMIN-002 | CRUD completo de compañías con logo, datos fiscales y configuración | P0 | 1 |
| RF-ADMIN-003 | CRUD completo de almacenes con dirección, coordenadas, timezone | P0 | 1 |
| RF-ADMIN-004 | CRUD completo de áreas dentro de un almacén | P0 | 1 |
| RF-ADMIN-005 | CRUD completo de ubicaciones con código, tipo, capacidad | P0 | 1 |
| RF-ADMIN-006 | CRUD completo de usuarios con invitación por email | P0 | 1 |
| RF-ADMIN-007 | Gestión de clientes del tenant (empresas a las que prestan servicio) | P2 | 1 |
| RF-ADMIN-008 | Gestión de proveedores | P2 | 1 |
| RF-ADMIN-009 | Gestión de equipos/dispositivos (cámaras, drones, sensores) | P2 | 3 |
| RF-ADMIN-010 | Panel de configuración general del tenant | P1 | 1 |
| RF-ADMIN-011 | Gestión de módulos activos por tenant | P1 | 4 |
| RF-ADMIN-012 | Dashboard de salud del sistema para Super Admin | P1 | 1 |

### 2.5 RF-INV: Inventarios

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-INV-001 | Gestión de catálogo de productos/SKUs con atributos configurables | P0 | 1 |
| RF-INV-002 | Registro de stock por ubicación, lote y estado | P0 | 1 |
| RF-INV-003 | Crear y ejecutar procesos de conteo (cíclico, completo, por zona) | P0 | 1 |
| RF-INV-004 | Registrar resultados de conteo con discrepancias calculadas | P0 | 1 |
| RF-INV-005 | Generar ajustes de inventario con motivo y aprobación | P0 | 1 |
| RF-INV-006 | Registrar y gestionar incidencias (faltantes, sobrantes, daños) | P1 | 1 |
| RF-INV-007 | Historial completo de movimientos por ubicación y producto | P1 | 1 |
| RF-INV-008 | Alertas configurables por nivel mínimo/máximo de stock | P2 | 1 |
| RF-INV-009 | Soporte para múltiples unidades de medida por producto | P2 | 1 |
| RF-INV-010 | Soporte para números de serie y trazabilidad individual | P2 | 2 |
| RF-INV-011 | Soporte para fechas de vencimiento y control FEFO/FIFO | P2 | 2 |
| RF-INV-012 | Dashboard de inventario con KPIs en tiempo real | P1 | 1 |
| RF-INV-013 | Comparación de inventario sistema vs conteo físico | P0 | 1 |
| RF-INV-014 | Workflow de aprobación para ajustes que excedan umbral | P1 | 1 |
| RF-INV-015 | Valorización de inventario con múltiples métodos (promedio, FIFO, LIFO) | P3 | 2 |

### 2.6 RF-IA: Inteligencia Artificial

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-IA-001 | El sistema debe soportar múltiples motores de IA mediante interfaz abstracta | P0 | 2 |
| RF-IA-002 | Integración de YOLO como primera implementación del motor de IA | P0 | 2 |
| RF-IA-003 | Ejecutar inferencia sobre una imagen individual | P0 | 2 |
| RF-IA-004 | Ejecutar inferencia sobre video (frame extraction + batch) | P1 | 2 |
| RF-IA-005 | Gestión de modelos entrenados (upload, versionar, activar, desactivar) | P0 | 2 |
| RF-IA-006 | Gestión de datasets (crear, versionar, split train/val/test) | P0 | 2 |
| RF-IA-007 | Herramienta de anotación de imágenes (bounding boxes) | P1 | 2 |
| RF-IA-008 | Configurar y lanzar entrenamientos con hiperparámetros | P1 | 2 |
| RF-IA-009 | Monitorear progreso de entrenamiento en tiempo real | P1 | 2 |
| RF-IA-010 | Comparar métricas entre versiones de modelos | P2 | 2 |
| RF-IA-011 | API de inferencia para consumo externo | P1 | 2 |
| RF-IA-012 | Cola de procesamiento para inferencias batch | P1 | 2 |
| RF-IA-013 | Resultados de inferencia asociados a ubicaciones de inventario | P1 | 2 |
| RF-IA-014 | Exportar datasets en formatos estándar (YOLO, COCO, VOC) | P2 | 2 |
| RF-IA-015 | Soporte futuro para GroundingDINO, SAM, Detectron2, TensorRT, OpenVINO | P3 | 3+ |

### 2.7 RF-DRONE: Drones

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-DRONE-001 | Registro y gestión de drones como dispositivos | P1 | 3 |
| RF-DRONE-002 | Planificación de misiones con waypoints sobre plano | P1 | 3 |
| RF-DRONE-003 | Ejecución de misiones con telemetría en tiempo real | P1 | 3 |
| RF-DRONE-004 | Captura automática de imágenes en puntos de interés | P1 | 3 |
| RF-DRONE-005 | Streaming de video RTSP desde drone | P1 | 3 |
| RF-DRONE-006 | Procesamiento IA en tiempo real sobre stream | P2 | 3 |
| RF-DRONE-007 | Historial de misiones con métricas | P1 | 3 |
| RF-DRONE-008 | Alertas de batería, colisión, zona restringida | P1 | 3 |
| RF-DRONE-009 | Soporte para múltiples fabricantes (DJI, otros) | P2 | 3 |
| RF-DRONE-010 | Programación de misiones recurrentes (cron) | P2 | 3 |
| RF-DRONE-011 | Conteo automatizado de inventario con drones + IA | P1 | 3 |
| RF-DRONE-012 | Integración de resultados de dron con inventario del sistema | P1 | 3 |

### 2.8 RF-PLAN: Planos y Digital Twin

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-PLAN-001 | Upload y parsing de archivos DWG/DXF | P1 | 3 |
| RF-PLAN-002 | Visualización 2D de planos con zoom, pan y layers | P1 | 3 |
| RF-PLAN-003 | Mapeo de ubicaciones de inventario sobre el plano | P1 | 3 |
| RF-PLAN-004 | Visualización de rutas de drone sobre plano | P2 | 3 |
| RF-PLAN-005 | Heatmaps de actividad por zona | P2 | 3 |
| RF-PLAN-006 | Digital Twin con estado en tiempo real de ubicaciones | P2 | 3 |
| RF-PLAN-007 | Playback histórico del estado del almacén | P3 | 3 |
| RF-PLAN-008 | Simulación de reorganización de almacén | P3 | 4 |
| RF-PLAN-009 | Soporte futuro para visualización 3D | P3 | 4+ |
| RF-PLAN-010 | Export de planos anotados (PDF, imagen) | P2 | 3 |

### 2.9 RF-INT: Integraciones

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-INT-001 | Framework de conectores extensible con interface estándar | P0 | 1 |
| RF-INT-002 | Conector configurable para APIs REST genéricas | P0 | 1 |
| RF-INT-003 | Conector para SAP (lectura de maestros e inventario) | P1 | 1 |
| RF-INT-004 | Mapeo de campos configurable por conector | P0 | 1 |
| RF-INT-005 | Sincronización bidireccional con control de conflictos | P1 | 1 |
| RF-INT-006 | Logs detallados de cada operación de integración | P0 | 1 |
| RF-INT-007 | Reintentos automáticos con backoff exponencial | P1 | 1 |
| RF-INT-008 | Transformación de datos con motor de reglas | P2 | 2 |
| RF-INT-009 | Webhooks salientes para eventos de la plataforma | P2 | 4 |
| RF-INT-010 | Soporte para SOAP, CSV, Excel, XML, JSON como formatos de intercambio | P2 | 2 |
| RF-INT-011 | Conectores futuros: Oracle, Softland, Exactus, Dynamics | P2 | 4 |
| RF-INT-012 | Soporte futuro para mensajería (MQTT, RabbitMQ, Kafka) | P3 | 4 |
| RF-INT-013 | Health check automático de conexiones | P1 | 1 |
| RF-INT-014 | Versionado de conectores con compatibilidad retroactiva | P2 | 2 |

### 2.10 RF-RPT: Reportes y Analytics

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-RPT-001 | Generación de reportes en PDF, Excel y CSV | P1 | 1 |
| RF-RPT-002 | Reportes predefinidos de inventario (stock actual, movimientos, conteos) | P1 | 1 |
| RF-RPT-003 | Filtros avanzados (fecha, almacén, área, producto, usuario) | P1 | 1 |
| RF-RPT-004 | Dashboard ejecutivo con KPIs configurables | P1 | 1 |
| RF-RPT-005 | Programación de reportes automáticos (diario, semanal, mensual) | P2 | 1 |
| RF-RPT-006 | Envío de reportes por email | P2 | 1 |
| RF-RPT-007 | Exportación masiva asíncrona para grandes volúmenes | P2 | 2 |
| RF-RPT-008 | Reportes de IA (inferencias, precisión, rendimiento de modelos) | P2 | 2 |
| RF-RPT-009 | Reportes de auditoría (acciones por usuario, cambios) | P1 | 1 |
| RF-RPT-010 | Analytics predictivos (tendencias, forecast) | P3 | 4 |
| RF-RPT-011 | Comparativas entre almacenes/períodos | P2 | 2 |
| RF-RPT-012 | Custom report builder (selección de campos y agrupaciones) | P3 | 4 |

### 2.11 RF-AUDIT: Auditoría y Logs

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-AUDIT-001 | Todo cambio en datos de negocio debe generar registro de auditoría | P0 | 0 |
| RF-AUDIT-002 | Registro de quién, qué, cuándo, desde dónde para cada acción | P0 | 0 |
| RF-AUDIT-003 | Los registros de auditoría son inmutables (append-only) | P0 | 0 |
| RF-AUDIT-004 | Búsqueda y filtrado de logs de auditoría | P1 | 1 |
| RF-AUDIT-005 | Retención configurable de logs por tenant | P2 | 2 |
| RF-AUDIT-006 | Export de logs para compliance | P2 | 2 |
| RF-AUDIT-007 | Alertas por eventos sospechosos (múltiples fallos, acceso fuera de horario) | P2 | 2 |
| RF-AUDIT-008 | Dashboard de actividad por usuario | P2 | 1 |
| RF-AUDIT-009 | Historial de cambios de cada entidad (versioning) | P1 | 1 |
| RF-AUDIT-010 | Integración con SIEM externo (futuro) | P3 | 4 |

### 2.12 RF-NOTIF: Notificaciones

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-NOTIF-001 | Notificaciones in-app en tiempo real (WebSocket/Realtime) | P1 | 1 |
| RF-NOTIF-002 | Notificaciones por email para eventos críticos | P1 | 1 |
| RF-NOTIF-003 | Configuración de preferencias de notificación por usuario | P2 | 1 |
| RF-NOTIF-004 | Notificaciones push (futuro) | P3 | 4 |
| RF-NOTIF-005 | Centro de notificaciones con historial | P2 | 1 |
| RF-NOTIF-006 | Notificaciones configurables por tipo de evento | P2 | 2 |
| RF-NOTIF-007 | Alertas escalables (si no se atiende en X tiempo, escalar) | P3 | 3 |

### 2.13 RF-CONFIG: Configuración

| ID | Requerimiento | Prioridad | Fase |
|----|--------------|-----------|------|
| RF-CONFIG-001 | Configuración por tenant (branding, idioma default, moneda, timezone) | P1 | 1 |
| RF-CONFIG-002 | Configuración por almacén independiente | P1 | 1 |
| RF-CONFIG-003 | Configuración de módulos activos | P1 | 4 |
| RF-CONFIG-004 | Feature flags por tenant | P2 | 2 |
| RF-CONFIG-005 | Personalización de campos (custom fields) en entidades principales | P3 | 3 |
| RF-CONFIG-006 | Configuración de workflows de aprobación | P2 | 2 |
| RF-CONFIG-007 | Configuración de umbrales y alertas | P2 | 2 |

---

## 3. REQUERIMIENTOS NO FUNCIONALES

### 3.1 RNF-PERF: Rendimiento

| ID | Requerimiento | Métrica | Target |
|----|--------------|---------|--------|
| RNF-PERF-001 | Tiempo de respuesta API para operaciones CRUD | Latencia p95 | < 300ms |
| RNF-PERF-002 | Tiempo de respuesta API para queries complejas | Latencia p95 | < 1000ms |
| RNF-PERF-003 | Tiempo de carga inicial de la aplicación web | First Contentful Paint | < 2 segundos |
| RNF-PERF-004 | Tiempo de navegación entre páginas (SPA) | Time to Interactive | < 500ms |
| RNF-PERF-005 | Tiempo de inferencia IA por imagen | Latencia E2E | < 3 segundos |
| RNF-PERF-006 | Throughput de inferencia batch | Imágenes/segundo | > 10 |
| RNF-PERF-007 | Latencia de streaming video | Glass-to-glass | < 3 segundos |
| RNF-PERF-008 | Tiempo de generación de reportes (< 10K registros) | Latencia E2E | < 10 segundos |
| RNF-PERF-009 | Tiempo de sincronización WMS (delta) | Latencia E2E | < 30 segundos |
| RNF-PERF-010 | Usuarios concurrentes por tenant sin degradación | Concurrencia | > 50 |
| RNF-PERF-011 | Queries de base de datos | Tiempo de ejecución | < 100ms para el 90% |
| RNF-PERF-012 | WebSocket/Realtime event delivery | Latencia | < 500ms |

### 3.2 RNF-SCAL: Escalabilidad

| ID | Requerimiento | Métrica | Target |
|----|--------------|---------|--------|
| RNF-SCAL-001 | Tenants soportados simultáneamente | Número | > 1000 |
| RNF-SCAL-002 | Usuarios totales en la plataforma | Número | > 50,000 |
| RNF-SCAL-003 | Almacenes por tenant | Número | > 100 |
| RNF-SCAL-004 | Productos por almacén | Número | > 1,000,000 |
| RNF-SCAL-005 | Registros de inventario totales | Número | > 100,000,000 |
| RNF-SCAL-006 | Imágenes almacenadas | Storage | > 10TB |
| RNF-SCAL-007 | Inferencias por día | Throughput | > 100,000 |
| RNF-SCAL-008 | Streams simultáneos | Concurrencia | > 50 |
| RNF-SCAL-009 | El sistema debe escalar horizontalmente sin downtime | Método | Auto-scaling |
| RNF-SCAL-010 | La base de datos debe soportar sharding futuro | Preparación | Schema compatible |

### 3.3 RNF-AVAIL: Disponibilidad

| ID | Requerimiento | Métrica | Target |
|----|--------------|---------|--------|
| RNF-AVAIL-001 | Disponibilidad de la plataforma (core) | Uptime | 99.9% (8.7h downtime/año) |
| RNF-AVAIL-002 | Disponibilidad del servicio de IA | Uptime | 99.5% |
| RNF-AVAIL-003 | Disponibilidad del servicio de streaming | Uptime | 99% |
| RNF-AVAIL-004 | RTO (Recovery Time Objective) | Tiempo | < 1 hora |
| RNF-AVAIL-005 | RPO (Recovery Point Objective) | Pérdida datos | < 5 minutos |
| RNF-AVAIL-006 | Deployments sin downtime | Método | Blue-green / Rolling |
| RNF-AVAIL-007 | Health checks automatizados | Frecuencia | Cada 30 segundos |
| RNF-AVAIL-008 | Failover automático de base de datos | Tiempo | < 30 segundos |

### 3.4 RNF-SEC: Seguridad

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-SEC-001 | Toda comunicación debe ser sobre HTTPS/TLS 1.3 |
| RNF-SEC-002 | Contraseñas almacenadas con bcrypt (cost factor ≥ 12) |
| RNF-SEC-003 | Tokens JWT con expiración corta (15 min access, 7 días refresh) |
| RNF-SEC-004 | Rate limiting en todos los endpoints públicos |
| RNF-SEC-005 | Protección contra OWASP Top 10 |
| RNF-SEC-006 | Input validation en todas las entradas (Pydantic strict) |
| RNF-SEC-007 | SQL injection prevention (SQLAlchemy parameterized + RLS) |
| RNF-SEC-008 | XSS prevention (React escape + CSP headers) |
| RNF-SEC-009 | CSRF protection en operaciones mutantes |
| RNF-SEC-010 | Secrets nunca en código (environment variables / vault) |
| RNF-SEC-011 | Encriptación de datos sensibles at-rest (AES-256) |
| RNF-SEC-012 | Audit trail inmutable para compliance |
| RNF-SEC-013 | Penetration testing antes de cada release major |
| RNF-SEC-014 | Dependency scanning automático (vulnerabilidades) |
| RNF-SEC-015 | Data isolation entre tenants verificable con tests automatizados |
| RNF-SEC-016 | API Keys con scopes limitados y rotación |
| RNF-SEC-017 | CORS configurado restrictivamente por entorno |
| RNF-SEC-018 | Headers de seguridad (HSTS, X-Frame-Options, etc.) |

### 3.5 RNF-COMPAT: Compatibilidad

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-COMPAT-001 | Soporte para Chrome (últimas 2 versiones) |
| RNF-COMPAT-002 | Soporte para Firefox (últimas 2 versiones) |
| RNF-COMPAT-003 | Soporte para Safari (últimas 2 versiones) |
| RNF-COMPAT-004 | Soporte para Edge (últimas 2 versiones) |
| RNF-COMPAT-005 | Responsive design para tablets (1024px+) |
| RNF-COMPAT-006 | API compatible con versiones anteriores (versionado semántico) |
| RNF-COMPAT-007 | Soporte para PostgreSQL 15+ |
| RNF-COMPAT-008 | Python 3.11+ como requisito mínimo |
| RNF-COMPAT-009 | Node.js 20 LTS+ para herramientas de build |

### 3.6 RNF-MAINT: Mantenibilidad

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-MAINT-001 | Cobertura de tests unitarios > 80% en backend |
| RNF-MAINT-002 | Cobertura de tests de integración para flujos críticos > 90% |
| RNF-MAINT-003 | Documentación de API auto-generada desde código (OpenAPI) |
| RNF-MAINT-004 | Código formateado automáticamente (Black, Prettier) |
| RNF-MAINT-005 | Linting estricto (Ruff, ESLint) con zero warnings en CI |
| RNF-MAINT-006 | Type checking estricto (mypy, TypeScript strict) |
| RNF-MAINT-007 | ADRs (Architecture Decision Records) para decisiones clave |
| RNF-MAINT-008 | Migraciones de DB reversibles y versionadas |
| RNF-MAINT-009 | Feature flags para activar/desactivar funcionalidad sin deploy |
| RNF-MAINT-010 | Separación clara entre capas (Clean Architecture) |
| RNF-MAINT-011 | Tiempo máximo de build CI < 10 minutos |
| RNF-MAINT-012 | Deploy automatizado con un click / merge to main |

### 3.7 RNF-OBS: Observabilidad

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-OBS-001 | Logging estructurado (JSON) en todos los servicios |
| RNF-OBS-002 | Correlation IDs para tracing de requests |
| RNF-OBS-003 | Métricas de negocio expuestas (Prometheus format) |
| RNF-OBS-004 | Alertas configurables por umbral |
| RNF-OBS-005 | Dashboard de monitoreo de infraestructura |
| RNF-OBS-006 | Error tracking con stack traces (Sentry o similar) |
| RNF-OBS-007 | Performance monitoring (APM) |
| RNF-OBS-008 | Log aggregation centralizado |
| RNF-OBS-009 | Retention de logs: 30 días hot, 1 año cold |
| RNF-OBS-010 | Health endpoints para cada servicio (/health, /ready) |

### 3.8 RNF-I18N: Internacionalización

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-I18N-001 | Soporte para múltiples idiomas en UI (mínimo: ES, EN, PT) |
| RNF-I18N-002 | Mensajes de error y validación localizados |
| RNF-I18N-003 | Formatos de fecha, hora y número según locale |
| RNF-I18N-004 | Soporte para múltiples monedas con conversión |
| RNF-I18N-005 | Soporte para múltiples zonas horarias por almacén |
| RNF-I18N-006 | RTL support preparado (para expansión futura a mercados árabes) |
| RNF-I18N-007 | Content localizable sin rebuild (archivos de traducción externos) |

### 3.9 RNF-UX: Experiencia de Usuario

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-UX-001 | Dark mode como tema principal |
| RNF-UX-002 | Animaciones suaves y transiciones fluidas (60fps) |
| RNF-UX-003 | Feedback visual inmediato para toda acción del usuario |
| RNF-UX-004 | Loading states explícitos (skeletons, spinners contextuales) |
| RNF-UX-005 | Error states informativos con acción sugerida |
| RNF-UX-006 | Keyboard shortcuts para power users |
| RNF-UX-007 | Búsqueda global (command palette style) |
| RNF-UX-008 | Breadcrumbs para navegación jerárquica |
| RNF-UX-009 | Tablas con sort, filter, pagination, column resize |
| RNF-UX-010 | Forms con validación inline en tiempo real |
| RNF-UX-011 | Optimistic updates para operaciones frecuentes |
| RNF-UX-012 | Accesibilidad WCAG 2.1 Level AA |
| RNF-UX-013 | Diseño consistente con design system propio |
| RNF-UX-014 | Empty states informativos y con acción |
| RNF-UX-015 | Onboarding guiado para nuevos usuarios |

### 3.10 RNF-DATA: Datos

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| RNF-DATA-001 | Backup automático de base de datos cada 6 horas |
| RNF-DATA-002 | Point-in-time recovery disponible |
| RNF-DATA-003 | Data retention configurable por tenant y tipo de dato |
| RNF-DATA-004 | Soft delete para todas las entidades de negocio |
| RNF-DATA-005 | Exportación de datos del tenant (data portability) |
| RNF-DATA-006 | Eliminación completa de datos al terminar contrato (right to be forgotten) |
| RNF-DATA-007 | Consistencia eventual aceptable solo para analytics (strong para transaccional) |
| RNF-DATA-008 | Particionamiento de tablas grandes por fecha y tenant |
| RNF-DATA-009 | Archivado automático de datos históricos (> 2 años) |

---

## 4. RESTRICCIONES TÉCNICAS

| ID | Restricción | Justificación |
|----|-------------|---------------|
| RT-001 | Frontend debe usar React + TypeScript + Vite | Decisión de stack definida |
| RT-002 | Backend debe usar Python + FastAPI | Ecosistema IA nativo |
| RT-003 | Base de datos debe ser Supabase PostgreSQL | Decisión de infraestructura |
| RT-004 | Autenticación debe usar Supabase Auth | Integración con RLS |
| RT-005 | Storage debe usar Supabase Storage | Unificación de plataforma |
| RT-006 | Realtime debe usar Supabase Realtime | WebSocket managed |
| RT-007 | No se permite lógica de negocio en el frontend | Clean Architecture |
| RT-008 | Toda comunicación frontend-backend debe ser via API REST | Desacoplamiento |
| RT-009 | No se permite SQL directo en capas superiores al repositorio | Repository Pattern |
| RT-010 | Todo endpoint debe estar autenticado excepto /health y /auth/* | Security by default |
| RT-011 | No se permite estado compartido entre requests (stateless) | Escalabilidad horizontal |
| RT-012 | Las migraciones de DB deben ser backwards-compatible | Zero downtime deploys |

---

## 5. SUPUESTOS

| ID | Supuesto | Riesgo si es falso |
|----|----------|-------------------|
| SUP-001 | Los clientes tienen conectividad a internet estable | Se necesitaría modo offline |
| SUP-002 | Supabase soporta la escala requerida en los primeros 2 años | Migración a PostgreSQL self-hosted |
| SUP-003 | Los almacenes tienen WiFi/LAN para drones | Se necesitaría 4G/5G |
| SUP-004 | Los navegadores target soportan WebSocket | Fallback a polling |
| SUP-005 | GPU disponible para entrenamiento e inferencia | CPU fallback con degradación |
| SUP-006 | El equipo domina Python y React/TypeScript | Curva de aprendizaje |
| SUP-007 | Los drones DJI permiten integración SDK | Alternativas de hardware |
| SUP-008 | Los WMS target exponen APIs documentadas | Reverse engineering o middleware |

---

## 6. CRITERIOS DE ACEPTACIÓN GLOBALES

Todo feature entregado debe cumplir:

1. **Funcionalidad**: Cumple los criterios de aceptación específicos del requerimiento.
2. **Seguridad**: No introduce vulnerabilidades. Pasa análisis estático.
3. **Performance**: Cumple métricas de latencia definidas.
4. **Aislamiento**: Datos de un tenant no son accesibles desde otro.
5. **Testing**: Cobertura > 80% para el feature.
6. **Documentación**: API documentada en OpenAPI. Changelog actualizado.
7. **Accesibilidad**: WCAG 2.1 AA para componentes de UI.
8. **i18n**: Todos los strings visibles al usuario son localizables.
9. **Observabilidad**: Logging y métricas implementados.
10. **Code Quality**: Pasa linting, formatting y type checking sin warnings.

---

## 7. TRAZABILIDAD REQUERIMIENTOS → MÓDULOS → FASES

| Grupo de Requerimientos | Módulo(s) | Fase |
|------------------------|-----------|------|
| RF-AUTH | Auth, Seguridad | 0 |
| RF-TENANT | Administración | 0-1 |
| RF-RBAC | Administración, Seguridad | 0-1 |
| RF-ADMIN | Administración | 1 |
| RF-INV | Inventarios | 1-2 |
| RF-IA | IA, Modelos, Datasets, Inferencia | 2 |
| RF-DRONE | Drones, Dispositivos, Streaming | 3 |
| RF-PLAN | Planos, Mapas, Digital Twin | 3 |
| RF-INT | Integraciones, WMS | 1-4 |
| RF-RPT | Reportes, Analytics, KPIs | 1-4 |
| RF-AUDIT | Logs, Auditoría | 0-1 |
| RF-NOTIF | Notificaciones | 1-2 |
| RF-CONFIG | Configuración, Licenciamiento | 1-4 |

---

## 8. GLOSARIO

| Término | Definición |
|---------|-----------|
| Tenant | Organización cliente que contrata OLO_IA |
| Compañía | Entidad legal dentro de un tenant |
| Almacén | Ubicación física gestionada por una compañía |
| Área | Subdivisión lógica de un almacén (recepción, picking, etc.) |
| Ubicación | Posición específica dentro de un área (estante, rack, bin) |
| SKU | Stock Keeping Unit - identificador único de producto |
| Inferencia | Ejecución de un modelo de IA sobre datos de entrada |
| Dataset | Conjunto de datos etiquetados para entrenamiento de IA |
| Misión | Plan de vuelo de un drone con objetivos definidos |
| Conector | Componente de integración con un sistema externo |
| RLS | Row Level Security - filtrado de datos a nivel de fila en PostgreSQL |
| RBAC | Role-Based Access Control - control de acceso basado en roles |
| ABAC | Attribute-Based Access Control - control de acceso basado en atributos |
| WMS | Warehouse Management System - sistema de gestión de almacenes |
| Digital Twin | Representación digital del almacén físico |
| mAP | Mean Average Precision - métrica de precisión de modelos de detección |

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
