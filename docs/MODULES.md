# OLO_IA - ESPECIFICACIÓN DE MÓDULOS

## 1. INTRODUCCIÓN

Este documento detalla cada módulo de la plataforma OLO_IA, incluyendo su propósito, funcionalidades, entidades, pantallas y reglas de negocio.

---

## 2. MAPA DE MÓDULOS

```
┌─────────────────────────────────────────────────────────────┐
│                    MÓDULOS OLO_IA                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  CORE                    OPERACIONES         INTELIGENCIA    │
│  ──────                  ────────────         ────────────   │
│  • Dashboard             • Inventarios        • Modelos IA   │
│  • Administración        • Conteos            • Datasets     │
│  • Usuarios              • Incidencias        • Training     │
│  • Roles/Permisos        • Ubicaciones        • Inferencia   │
│                                                              │
│  DISPOSITIVOS            INTEGRACIONES       ANALYTICS       │
│  ────────────            ─────────────       ──────────      │
│  • Equipos               • WMS               • Reportes      │
│  • Cámaras               • API Gateway       • Dashboards    │
│  • Drones                • Conectores        • KPIs          │
│  • Misiones                                                  │
│  • Streaming             PLATAFORMA          ESPACIAL        │
│                          ──────────          ────────         │
│                          • Auditoría         • Planos         │
│                          • Configuración     • Mapas          │
│                          • Licenciamiento    • Digital Twin   │
│                          • Developer Center                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. MÓDULO: DASHBOARD

### 3.1 Propósito
Vista ejecutiva centralizada con KPIs, alertas y acceso rápido a las funciones principales.

### 3.2 Funcionalidades

| Feature | Descripción | Prioridad |
|---------|-------------|-----------|
| KPI Cards | Métricas clave en tiempo real | P0 |
| Activity Feed | Últimos eventos y acciones | P1 |
| Quick Actions | Accesos directos a acciones frecuentes | P1 |
| Alerts Panel | Alertas activas por severidad | P0 |
| Chart Widgets | Gráficos configurables | P1 |
| Warehouse Selector | Cambio rápido de almacén activo | P0 |
| Notifications | Centro de notificaciones | P1 |

### 3.3 KPIs del Dashboard

| KPI | Cálculo | Refresh |
|-----|---------|---------|
| Precisión de inventario | (Correctos / Total) × 100 | Cada conteo |
| Incidencias abiertas | COUNT WHERE status = open | Real-time |
| Conteos pendientes | COUNT WHERE status = planned | Real-time |
| Inferencias hoy | COUNT WHERE date = today | Cada 5 min |
| Utilización de almacén | (Ocupados / Total ubicaciones) × 100 | Cada hora |
| Misiones activas | COUNT WHERE status = in_flight | Real-time |
| Alertas críticas | COUNT WHERE severity = critical | Real-time |
| Stock por debajo de mínimo | COUNT WHERE qty < min_threshold | Cada hora |

---

## 4. MÓDULO: ADMINISTRACIÓN

### 4.1 Sub-módulo: Países

| Feature | Campos | Reglas |
|---------|--------|--------|
| Listar países | Nombre, código ISO, moneda, idioma, flag | Filtrable, ordenable |
| Crear país | Nombre, ISO 3166-1, moneda default, idioma | Código ISO único |
| Editar país | Todos los campos | Solo tenant_admin+ |
| Activar/Desactivar | Toggle status | No desactivar con compañías activas |

### 4.2 Sub-módulo: Compañías

| Feature | Campos | Reglas |
|---------|--------|--------|
| Listar compañías | Nombre, país, almacenes, status | Filtro por país |
| Crear compañía | Nombre legal, RUC/NIT, dirección, logo, país | RUC único por país |
| Editar compañía | Todos los campos | Solo company_manager+ |
| Configurar | Moneda, idioma, timezone, reglas de negocio | Hereda de país |
| Desactivar | Soft delete | Desactivar almacenes dependientes |

### 4.3 Sub-módulo: Almacenes

| Feature | Campos | Reglas |
|---------|--------|--------|
| Listar almacenes | Nombre, código, compañía, áreas, status | Filtro por compañía |
| Crear almacén | Nombre, código, dirección, coordenadas, timezone | Código único por compañía |
| Configurar | WMS, moneda, idioma, umbrales, reglas | Override de compañía |
| Estructura | Áreas y ubicaciones (tree view) | Drag & drop para reorganizar |
| Métricas | Utilización, throughput, incidencias | Dashboard por almacén |
| Mantenimiento | Modo mantenimiento (bloquea operaciones) | Solo warehouse_manager+ |

### 4.4 Sub-módulo: Áreas

| Feature | Campos | Reglas |
|---------|--------|--------|
| Listar áreas | Nombre, código, tipo, ubicaciones, status | Por almacén |
| Crear área | Nombre, código, tipo (receiving/storage/picking/shipping) | Código único por almacén |
| Configurar | Capacidad, reglas específicas | Hereda de almacén |
| Ubicaciones | CRUD masivo de ubicaciones | Generación por patrón |

### 4.5 Sub-módulo: Ubicaciones

| Feature | Campos | Reglas |
|---------|--------|--------|
| Listar ubicaciones | Código, tipo, nivel, estado, producto actual | Filtros múltiples |
| Crear masivo | Patrón (A-01-01 a A-10-05), tipo, capacidad | Generación automática |
| Editar | Status, capacidad, restricciones | No editar con stock |
| Mapear en plano | Asignar coordenadas en plano AutoCAD | Visual drag & drop |
| Historial | Movimientos de la ubicación | Timeline |

---

## 5. MÓDULO: USUARIOS Y PERMISOS

### 5.1 Gestión de Usuarios

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Lista de usuarios | Avatar, nombre, email, roles, status, last login | Paginado, filtrable |
| Invitar usuario | Email de invitación con link temporal | 72h expiración |
| Crear usuario | Nombre, email, rol, almacenes asignados | Email único por tenant |
| Editar perfil | Nombre, avatar, idioma, timezone | Self-service para propio perfil |
| Asignar roles | Múltiples roles con scope | Solo admin puede asignar |
| Asignar almacenes | Acceso a almacenes específicos | Define el scope del usuario |
| Suspender usuario | Bloquear acceso sin eliminar | Mantiene historial |
| Eliminar usuario | Soft delete | Reasignar tareas pendientes |
| Sesiones activas | Ver y cerrar sesiones | Self-service + admin |
| Reset password | Forzar cambio de contraseña | Solo admin |

### 5.2 Gestión de Roles

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Roles predefinidos | Lista de roles del sistema | No editables |
| Roles custom | Crear roles específicos del tenant | Nombre único |
| Matriz de permisos | Módulo × Acción (checkbox grid) | Visual, intuitivo |
| Herencia | Rol hijo hereda de rol padre | Evitar ciclos |
| Usuarios asignados | Ver qué usuarios tienen el rol | Quick assign |
| Clonar rol | Copiar permisos de otro rol | Editar después |

---

## 6. MÓDULO: INVENTARIOS

### 6.1 Catálogo de Productos

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Lista de productos | SKU, nombre, categoría, stock total, imagen | Búsqueda full-text |
| Crear producto | SKU, nombre, descripción, UOM, categoría, imagen | SKU único |
| Import masivo | CSV/Excel con mapeo de columnas | Validación, preview |
| Export | CSV, Excel, PDF del catálogo | Filtros aplicados |
| Detalle producto | Stock por ubicación, historial, incidencias | Vista consolidada |
| Categorías | Árbol de categorías jerárquicas | Drag & drop |
| Atributos custom | Campos adicionales configurables | Por tenant |

### 6.2 Gestión de Stock

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Stock actual | Producto × Ubicación × Cantidad × Lote | Real-time |
| Movimientos | Historial de entradas/salidas/transfers | Trazable |
| Alertas de stock | Mínimo, máximo, punto de reorden | Configurable |
| Reservas | Stock reservado para pedidos | No disponible para conteo |
| Cuarentena | Stock bloqueado por calidad | Requiere liberación |
| Vencimientos | Control FEFO/FIFO | Alertas automáticas |
| Valorización | Costo promedio, FIFO, LIFO | Configurable por tenant |

### 6.3 Procesos de Conteo

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Crear conteo | Tipo (cíclico/completo/zona/spot), scope, asignados | Workflow |
| Ejecutar conteo | Registrar cantidades por ubicación | Mobile-friendly |
| Foto evidencia | Adjuntar foto de cada ubicación | Almacenada en Storage |
| Doble conteo | Segundo conteo si discrepancia > umbral | Configurable |
| Cierre de conteo | Calcular discrepancias, generar ajustes | Requiere aprobación |
| Historial | Conteos anteriores con comparativa | Tendencias |
| Programación | Conteos automáticos por calendario | Cron configurable |
| Conteo por IA | Resultado de inferencia como input | Fuente: ai |
| Conteo por dron | Resultado de misión como input | Fuente: drone |

### 6.4 Ajustes de Inventario

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Crear ajuste | Productos, cantidades, motivo | Requiere motivo |
| Workflow aprobación | Pendiente → Aprobado → Aplicado | Si qty > umbral |
| Auto-aprobación | Para ajustes menores al umbral | Configurable |
| Evidencia | Fotos, documentos adjuntos | Opcional |
| Reversar | Revertir un ajuste aplicado | Genera contra-ajuste |
| Reporte de ajustes | Resumen por período, motivo, usuario | Exportable |

### 6.5 Incidencias

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Crear incidencia | Tipo, severidad, ubicación, producto, descripción | Automática o manual |
| Asignar | A usuario específico | Notificación |
| Escalar | Subir severidad si no se resuelve | Automático por tiempo |
| Resolver | Registrar resolución con evidencia | Cerrar después |
| Dashboard incidencias | Por tipo, estado, tendencia | Filtrable |
| Origen IA | Incidencia creada por resultado de inferencia | Link a inferencia |

---

## 7. MÓDULO: INTELIGENCIA ARTIFICIAL

### 7.1 Gestión de Modelos

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Lista de modelos | Nombre, motor, versión, métricas, status | Por motor IA |
| Upload modelo | Archivo de pesos (.pt, .onnx) | Validar formato |
| Detalle modelo | Métricas, clases, historial de versiones | Comparación |
| Deploy modelo | Activar para inferencia en producción | Solo 1 activo por motor |
| Undeploy | Desactivar modelo | Requiere confirmación |
| Archivar | Mover a archivo | No disponible para deploy |
| Comparar modelos | Side-by-side de métricas | Gráficos |
| Model Card | Documentación del modelo | Auto-generada |

### 7.2 Gestión de Datasets

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Crear dataset | Nombre, descripción, clases | Versión automática |
| Upload imágenes | Bulk upload con drag & drop | Formatos: jpg, png |
| Anotación | Bounding boxes sobre imágenes | Tool integrado |
| Auto-annotation | Pre-anotar con modelo existente | Revisión humana después |
| Split | Dividir en train/val/test | Ratios configurables |
| Estadísticas | Distribución de clases, balance | Alertas de imbalance |
| Export | YOLO, COCO, Pascal VOC | Formato seleccionable |
| Versionado | Nueva versión al modificar | Historial completo |

### 7.3 Entrenamiento

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Configurar training | Epochs, batch_size, LR, augmentation | Presets disponibles |
| Lanzar training | Iniciar entrenamiento | 1 por tenant simultáneo |
| Monitor en vivo | Loss, mAP, precision por epoch | Gráficos real-time |
| Early stopping | Parar si no mejora | Configurable (patience) |
| Cancelar | Abortar entrenamiento | Libera GPU |
| Resultados | Métricas finales, confusion matrix | Exportable |
| Comparar runs | Historial de entrenamientos | Side-by-side |

### 7.4 Inferencia

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Inferencia single | Upload imagen → Resultado | Instantáneo |
| Inferencia batch | Múltiples imágenes → Cola | Async con progreso |
| Inferencia video | Video → Frame extraction → Resultados | Configurable FPS |
| API de inferencia | Endpoint REST para integración | Autenticado, rate limited |
| Resultados | Bounding boxes, confianza, clase | Filtrar por confianza |
| Mapeo a inventario | Resultado → Ubicación → Producto | Configuración de mapeo |
| Historial | Todas las inferencias ejecutadas | Búsqueda y filtros |
| Métricas | Throughput, latencia, accuracy | Dashboard |

---

## 8. MÓDULO: DISPOSITIVOS Y DRONES

### 8.1 Gestión de Dispositivos

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Registro | Tipo, fabricante, modelo, serial, almacén | Serial único |
| Status | Online/offline/maintenance | Heartbeat automático |
| Configuración | Parámetros por tipo de dispositivo | Template por modelo |
| Mantenimiento | Programar mantenimientos | Alertas preventivas |
| Firmware | Versión actual, historial de updates | Track de versiones |
| Ubicación | Dónde está el dispositivo | Tracking en plano |

### 8.2 Misiones de Drones

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Planificar misión | Nombre, dron, waypoints sobre plano | Visual editor |
| Waypoints | Puntos con acciones (foto, hover, rotate) | Asociar a ubicaciones |
| Pre-flight check | Verificaciones antes de vuelo | Checklist obligatorio |
| Ejecutar misión | Lanzar vuelo autónomo | Dron debe estar online |
| Telemetría | Posición, batería, velocidad en vivo | WebSocket/Realtime |
| Captura automática | Fotos en waypoints programados | Almacenadas en Storage |
| Abort | Abortar misión en cualquier momento | Return to home |
| Historial | Todas las misiones con métricas | Ruta real vs planificada |
| Programar | Misiones recurrentes (diario, semanal) | Cron |
| Resultados | Fotos capturadas → Inferencia → Inventario | Pipeline automático |

### 8.3 Streaming

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Fuentes | RTSP, cámaras IP, drones | Múltiples simultáneas |
| Visualización | Video en vivo en dashboard | Baja latencia |
| Procesamiento IA | Inferencia sobre stream | Real-time overlay |
| Grabación | Guardar clips por evento | Storage eficiente |
| Multi-view | Ver múltiples cámaras | Grid layout |
| Alertas | Detección → Alerta automática | Configurable |

---

## 9. MÓDULO: PLANOS Y DIGITAL TWIN

### 9.1 Planos

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Upload DWG/DXF | Importar plano de AutoCAD | Parser integrado |
| Visualización 2D | Renderizar con zoom/pan/layers | Canvas performante |
| Mapeo ubicaciones | Asociar ubicaciones a coordenadas | Drag & drop |
| Layers | Mostrar/ocultar capas del plano | Toggle visual |
| Anotaciones | Agregar notas sobre el plano | Persistentes |
| Export | PDF, PNG del plano anotado | Con o sin datos |

### 9.2 Digital Twin

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Vista del almacén | Representación visual con estado | Colores por status |
| Estado en vivo | Ocupación de ubicaciones real-time | Supabase Realtime |
| Heatmaps | Frecuencia de acceso por zona | Período configurable |
| Rutas de drone | Visualizar misiones sobre plano | Planificadas y reales |
| Histórico | Playback del estado en un período | Timeline slider |
| Simulación | What-if de reorganización | No afecta producción |

---

## 10. MÓDULO: INTEGRACIONES

### 10.1 Gestión de Conectores

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Catálogo | Conectores disponibles | Por tipo de WMS |
| Instalar | Configurar nuevo conector | Wizard guiado |
| Configurar conexión | URL, credenciales, auth method | Encriptado |
| Mapeo de campos | Campos OLO_IA ↔ Campos WMS | Visual mapper |
| Test conexión | Verificar conectividad | Health check |
| Activar/Desactivar | Toggle sin eliminar config | Mantiene historial |

### 10.2 Sincronización

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Sync manual | Ejecutar sincronización ahora | Bajo demanda |
| Sync programada | Cron configurable | Frecuencia por entidad |
| Sync delta | Solo cambios desde última sync | Eficiente |
| Sync full | Sincronización completa | Programable |
| Monitoreo | Estado, progreso, errores | Real-time |
| Logs detallados | Cada registro procesado | Búsqueda y filtros |
| Reintentos | Automáticos con backoff | Configurable |
| Conflictos | Estrategia de resolución | Configurable |

---

## 11. MÓDULO: REPORTES Y ANALYTICS

### 11.1 Reportes

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Reportes predefinidos | Templates listos para usar | Por módulo |
| Filtros avanzados | Fecha, almacén, área, producto, usuario | Combinables |
| Formatos | PDF, Excel, CSV | Seleccionable |
| Programación | Automáticos por cron | Email delivery |
| Favoritos | Guardar reportes frecuentes | Por usuario |
| Compartir | Enviar por email o link | Con permisos |

### 11.2 Reportes Predefinidos

| Reporte | Módulo | Contenido |
|---------|--------|-----------|
| Stock actual | Inventarios | Existencias por producto/ubicación |
| Movimientos | Inventarios | Entradas/salidas por período |
| Conteos | Inventarios | Resultados, discrepancias, tendencia |
| Ajustes | Inventarios | Por motivo, monto, período |
| Incidencias | Inventarios | Por tipo, estado, resolución |
| Rendimiento IA | IA | Inferencias, precisión, latencia |
| Misiones | Drones | Ejecutadas, métricas, cobertura |
| Auditoría | Sistema | Acciones por usuario, módulo |
| Integraciones | WMS | Syncs, errores, throughput |
| Uso de plataforma | Admin | Usuarios activos, módulos usados |

### 11.3 Dashboard Analytics

| Widget | Tipo | Datos |
|--------|------|-------|
| Precisión de inventario | Gauge + trend | % por período |
| Incidencias por tipo | Donut chart | Distribución |
| Stock vs capacidad | Bar chart | Por almacén |
| Inferencias diarias | Line chart | Últimos 30 días |
| Top discrepancias | Table | Productos más discrepantes |
| Cobertura de conteo | Progress | % del almacén contado |
| SLA de integración | Indicator | Uptime del conector |
| Actividad de usuarios | Heatmap | Por hora del día |

---

## 12. MÓDULO: AUDITORÍA Y LOGS

### 12.1 Funcionalidades

| Feature | Descripción | Reglas |
|---------|-------------|--------|
| Activity log | Todas las acciones del sistema | Inmutable |
| Búsqueda | Por usuario, fecha, módulo, acción | Full-text |
| Filtros | Período, severidad, tipo, recurso | Combinables |
| Detalle | Before/After de cada cambio | JSON diff |
| Export | CSV/JSON para compliance | Bulk async |
| Alertas | Actividad sospechosa | Configurable |
| Retención | Política de retención configurable | Por tipo |
| Integridad | Verificación de no-tamper | Hash chain |

---

## 13. MÓDULO: CONFIGURACIÓN

### 13.1 Configuración del Tenant

| Setting | Tipo | Default |
|---------|------|---------|
| Idioma default | Select | es |
| Moneda default | Select (ISO 4217) | USD |
| Timezone default | Select (IANA) | America/Costa_Rica |
| Tema | dark/light/system | dark |
| Logo | Upload (200×200 px) | OLO_IA default |
| Formato de fecha | Select | DD/MM/YYYY |
| Formato de número | Select | 1.000,00 |
| Política de contraseñas | Form | Defaults del sistema |
| Módulos activos | Checkboxes | Según plan |
| Notificaciones | Toggles por tipo | Todas activas |
| Umbrales de alerta | Inputs numéricos | Por módulo |
| Campos custom | Builder | Ninguno |

---

## 14. MÓDULO: LICENCIAMIENTO Y FACTURACIÓN

### 14.1 Funcionalidades (Fase 4)

| Feature | Descripción |
|---------|-------------|
| Plans | Visualizar plan actual y opciones |
| Usage | Métricas de consumo vs límites |
| Upgrade/Downgrade | Self-service con proración |
| Billing history | Facturas y pagos |
| Payment method | Tarjetas, transferencia |
| Módulos addon | Activar módulos premium |
| Invoices | Descarga de facturas |
| Notifications | Alertas de uso cercano a límite |

---

## 15. MÓDULO: DEVELOPER CENTER (Fase 4)

### 15.1 Funcionalidades

| Feature | Descripción |
|---------|-------------|
| API Documentation | OpenAPI spec interactiva |
| API Keys | Generar, rotar, revocar |
| Webhooks | Configurar endpoints de callback |
| SDKs | Download para Python, JS, .NET |
| Sandbox | Ambiente de pruebas |
| Rate limits | Visualizar uso vs límites |
| Logs de API | Requests/responses recientes |
| Examples | Código de ejemplo por lenguaje |

---

## 16. DEPENDENCIAS ENTRE MÓDULOS

```
Dashboard ──────► [Todos los módulos] (read-only)
Admin ──────────► Usuarios, Roles
Usuarios ───────► Roles, Admin
Inventarios ────► Admin (warehouses, locations), Productos
IA ─────────────► Inventarios (resultados), Storage (archivos)
Drones ─────────► IA (inferencia), Planos (rutas), Admin (devices)
Planos ─────────► Admin (warehouses, locations)
Integraciones ──► Inventarios (sync), Admin (warehouses)
Reportes ───────► [Todos los módulos] (read-only)
Auditoría ──────► [Todos los módulos] (events)
Configuración ──► Admin
Licenciamiento ─► Todos (limits enforcement)
Developer ──────► API, Auth
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
