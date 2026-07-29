# OLO_IA - DISEÑO DE API

## 1. INTRODUCCIÓN

Este documento define el diseño de la API REST de OLO_IA, incluyendo convenciones, versionado, autenticación, endpoints, formatos de respuesta y documentación.

### 1.1 Principios de API Design

1. **RESTful**: Recursos como sustantivos, verbos HTTP como acciones.
2. **Consistente**: Mismas convenciones en todos los endpoints.
3. **Versionada**: Backwards-compatible, deprecation gradual.
4. **Documentada**: OpenAPI 3.1 auto-generada desde código.
5. **Segura**: Auth obligatorio, rate limiting, input validation.
6. **Performante**: Paginación, filtros, sparse fields.

---

## 2. CONVENCIONES

### 2.1 URL Structure

```
https://api.olo-ia.com/v1/{resource}
https://api.olo-ia.com/v1/{resource}/{id}
https://api.olo-ia.com/v1/{resource}/{id}/{sub-resource}
```

### 2.2 Naming Conventions

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| URLs | kebab-case, plural | `/v1/stock-records` |
| Query params | snake_case | `?warehouse_id=uuid` |
| Request body | snake_case | `{ "company_id": "..." }` |
| Response body | snake_case | `{ "created_at": "..." }` |
| Headers custom | X-prefix, PascalCase | `X-Warehouse-Id` |

### 2.3 HTTP Methods

| Method | Uso | Idempotente | Body |
|--------|-----|-------------|------|
| GET | Obtener recurso(s) | Sí | No |
| POST | Crear recurso | No | Sí |
| PUT | Reemplazar recurso completo | Sí | Sí |
| PATCH | Actualizar parcialmente | No | Sí |
| DELETE | Eliminar recurso (soft) | Sí | No |

### 2.4 HTTP Status Codes

| Code | Uso |
|------|-----|
| 200 | OK - Operación exitosa |
| 201 | Created - Recurso creado |
| 204 | No Content - Eliminado exitosamente |
| 400 | Bad Request - Input inválido |
| 401 | Unauthorized - No autenticado |
| 403 | Forbidden - Sin permisos |
| 404 | Not Found - Recurso no existe |
| 409 | Conflict - Conflicto de estado |
| 422 | Unprocessable - Regla de negocio violada |
| 429 | Too Many Requests - Rate limit |
| 500 | Internal Server Error |

---

## 3. FORMATO DE RESPUESTAS

### 3.1 Respuesta Exitosa (Single Resource)

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Almacén Central",
    "code": "WH-001",
    "status": "active",
    "created_at": "2026-07-28T10:00:00Z",
    "updated_at": "2026-07-28T10:00:00Z"
  }
}
```

### 3.2 Respuesta Exitosa (Collection)

```json
{
  "data": [
    { "id": "...", "name": "..." },
    { "id": "...", "name": "..." }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 157,
    "total_pages": 8,
    "has_next": true,
    "has_previous": false
  }
}
```

### 3.3 Respuesta de Error

```json
{
  "error": {
    "code": "WAREHOUSE_NOT_FOUND",
    "message": "Warehouse with id '550e8400...' not found",
    "details": {
      "field": "warehouse_id",
      "value": "550e8400-e29b-41d4-a716-446655440000"
    },
    "trace_id": "req-abc123"
  }
}
```

### 3.4 Respuesta de Validación

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "errors": [
        { "field": "name", "message": "Field is required", "type": "missing" },
        { "field": "code", "message": "Must be uppercase alphanumeric", "type": "pattern" }
      ]
    },
    "trace_id": "req-def456"
  }
}
```

---

## 4. AUTENTICACIÓN Y HEADERS

### 4.1 Headers Requeridos

| Header | Requerido | Descripción |
|--------|-----------|-------------|
| `Authorization` | Sí | `Bearer <jwt_token>` |
| `Content-Type` | Sí (POST/PUT/PATCH) | `application/json` |
| `Accept` | Opcional | `application/json` (default) |
| `X-Request-Id` | Opcional | Correlation ID para tracing |
| `X-Warehouse-Id` | Contextual | Filtrar por almacén (overrides default) |
| `Accept-Language` | Opcional | Idioma de mensajes de error |

### 4.2 Flujo de Autenticación via API

```
POST /v1/auth/login
POST /v1/auth/register
POST /v1/auth/refresh
POST /v1/auth/logout
POST /v1/auth/forgot-password
POST /v1/auth/reset-password
POST /v1/auth/verify-email
```

---

## 5. VERSIONADO

### 5.1 Estrategia: URL Path Versioning

```
/v1/warehouses    ← Versión actual
/v2/warehouses    ← Versión futura (cuando haya breaking changes)
```

### 5.2 Reglas de Versionado

- **Backwards compatible changes** (NO incrementan versión):
  - Agregar campos opcionales a response
  - Agregar endpoints nuevos
  - Agregar query params opcionales
  
- **Breaking changes** (SÍ incrementan versión):
  - Remover campos de response
  - Cambiar tipo de un campo
  - Cambiar comportamiento de un endpoint existente
  - Cambiar formato de error

### 5.3 Deprecation Policy

1. Versión anterior disponible por mínimo 6 meses tras nueva versión.
2. Header `Deprecation: true` + `Sunset: <date>` en responses de versión deprecated.
3. Documentación actualizada con guía de migración.

---

## 6. PAGINACIÓN Y FILTROS

### 6.1 Paginación (Offset-based)

```
GET /v1/products?page=2&page_size=50
```

| Param | Default | Max | Descripción |
|-------|---------|-----|-------------|
| `page` | 1 | - | Página actual |
| `page_size` | 20 | 100 | Items por página |

### 6.2 Filtrado

```
GET /v1/products?category=electronics&status=active&warehouse_id=uuid
GET /v1/stock-records?quantity_gte=10&quantity_lte=100
GET /v1/incidents?severity=critical&created_after=2026-01-01
```

### 6.3 Ordenamiento

```
GET /v1/products?sort=name        ← Ascending
GET /v1/products?sort=-created_at ← Descending (prefix -)
GET /v1/products?sort=category,-name ← Multiple fields
```

### 6.4 Búsqueda

```
GET /v1/products?search=cable+hdmi
```

### 6.5 Sparse Fields (selección de campos)

```
GET /v1/products?fields=id,name,sku,quantity
```

### 6.6 Expand/Include (relaciones)

```
GET /v1/warehouses?include=areas,company
GET /v1/stock-records?include=product,location
```

---

## 7. ENDPOINTS POR MÓDULO

### 7.1 Auth

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| POST | /v1/auth/login | Login con email/password |
| POST | /v1/auth/register | Registro (solo si self-service habilitado) |
| POST | /v1/auth/refresh | Renovar access token |
| POST | /v1/auth/logout | Cerrar sesión |
| POST | /v1/auth/forgot-password | Solicitar reset |
| POST | /v1/auth/reset-password | Ejecutar reset con token |
| GET | /v1/auth/me | Perfil del usuario actual |
| PATCH | /v1/auth/me | Actualizar perfil propio |
| GET | /v1/auth/sessions | Sesiones activas |
| DELETE | /v1/auth/sessions/{id} | Cerrar sesión específica |

### 7.2 Administration

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/countries | Listar países del tenant |
| POST | /v1/countries | Crear país |
| GET | /v1/countries/{id} | Detalle de país |
| PATCH | /v1/countries/{id} | Actualizar país |
| GET | /v1/companies | Listar compañías |
| POST | /v1/companies | Crear compañía |
| GET | /v1/companies/{id} | Detalle de compañía |
| PATCH | /v1/companies/{id} | Actualizar compañía |
| DELETE | /v1/companies/{id} | Desactivar compañía |
| GET | /v1/warehouses | Listar almacenes |
| POST | /v1/warehouses | Crear almacén |
| GET | /v1/warehouses/{id} | Detalle de almacén |
| PATCH | /v1/warehouses/{id} | Actualizar almacén |
| DELETE | /v1/warehouses/{id} | Desactivar almacén |
| GET | /v1/warehouses/{id}/areas | Listar áreas |
| POST | /v1/warehouses/{id}/areas | Crear área |
| GET | /v1/areas/{id} | Detalle de área |
| PATCH | /v1/areas/{id} | Actualizar área |
| GET | /v1/areas/{id}/locations | Listar ubicaciones |
| POST | /v1/areas/{id}/locations | Crear ubicación |
| POST | /v1/areas/{id}/locations/bulk | Crear ubicaciones masivamente |
| GET | /v1/locations/{id} | Detalle de ubicación |
| PATCH | /v1/locations/{id} | Actualizar ubicación |

### 7.3 Users & Roles

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/users | Listar usuarios |
| POST | /v1/users/invite | Invitar usuario por email |
| GET | /v1/users/{id} | Detalle de usuario |
| PATCH | /v1/users/{id} | Actualizar usuario |
| DELETE | /v1/users/{id} | Desactivar usuario |
| POST | /v1/users/{id}/roles | Asignar rol |
| DELETE | /v1/users/{id}/roles/{assignment_id} | Revocar rol |
| GET | /v1/users/{id}/warehouses | Almacenes accesibles |
| POST | /v1/users/{id}/warehouses | Otorgar acceso a almacén |
| GET | /v1/roles | Listar roles |
| POST | /v1/roles | Crear rol custom |
| GET | /v1/roles/{id} | Detalle de rol |
| PATCH | /v1/roles/{id} | Actualizar permisos del rol |
| DELETE | /v1/roles/{id} | Eliminar rol custom |

### 7.4 Inventory

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/products | Listar productos |
| POST | /v1/products | Crear producto |
| POST | /v1/products/import | Import masivo (CSV/Excel) |
| GET | /v1/products/{id} | Detalle de producto |
| PATCH | /v1/products/{id} | Actualizar producto |
| DELETE | /v1/products/{id} | Soft delete producto |
| GET | /v1/products/{id}/stock | Stock del producto por ubicación |
| GET | /v1/stock-records | Listar registros de stock |
| GET | /v1/stock-records/{id} | Detalle de stock record |
| PATCH | /v1/stock-records/{id} | Actualizar (reservar, mover) |
| GET | /v1/counts | Listar conteos |
| POST | /v1/counts | Crear conteo |
| GET | /v1/counts/{id} | Detalle de conteo |
| POST | /v1/counts/{id}/start | Iniciar conteo |
| POST | /v1/counts/{id}/items | Registrar resultado de item |
| POST | /v1/counts/{id}/complete | Completar conteo |
| POST | /v1/counts/{id}/cancel | Cancelar conteo |
| GET | /v1/counts/{id}/discrepancies | Ver discrepancias |
| GET | /v1/adjustments | Listar ajustes |
| POST | /v1/adjustments | Crear ajuste |
| POST | /v1/adjustments/{id}/approve | Aprobar ajuste |
| POST | /v1/adjustments/{id}/reject | Rechazar ajuste |
| POST | /v1/adjustments/{id}/apply | Aplicar ajuste aprobado |
| GET | /v1/incidents | Listar incidencias |
| POST | /v1/incidents | Crear incidencia |
| GET | /v1/incidents/{id} | Detalle de incidencia |
| PATCH | /v1/incidents/{id} | Actualizar (asignar, escalar) |
| POST | /v1/incidents/{id}/resolve | Resolver incidencia |
| POST | /v1/incidents/{id}/close | Cerrar incidencia |

### 7.5 AI Engine

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/ai/models | Listar modelos |
| POST | /v1/ai/models | Registrar modelo (upload) |
| GET | /v1/ai/models/{id} | Detalle de modelo |
| POST | /v1/ai/models/{id}/deploy | Deploy a producción |
| POST | /v1/ai/models/{id}/undeploy | Quitar de producción |
| POST | /v1/ai/models/{id}/archive | Archivar modelo |
| GET | /v1/ai/datasets | Listar datasets |
| POST | /v1/ai/datasets | Crear dataset |
| GET | /v1/ai/datasets/{id} | Detalle de dataset |
| POST | /v1/ai/datasets/{id}/images | Upload imágenes |
| POST | /v1/ai/datasets/{id}/annotate | Anotar imagen |
| POST | /v1/ai/datasets/{id}/finalize | Finalizar dataset |
| POST | /v1/ai/datasets/{id}/export | Exportar en formato |
| GET | /v1/ai/inferences | Listar inferencias |
| POST | /v1/ai/inferences | Ejecutar inferencia |
| GET | /v1/ai/inferences/{id} | Resultado de inferencia |
| GET | /v1/ai/training-jobs | Listar entrenamientos |
| POST | /v1/ai/training-jobs | Lanzar entrenamiento |
| GET | /v1/ai/training-jobs/{id} | Estado del entrenamiento |
| POST | /v1/ai/training-jobs/{id}/cancel | Cancelar entrenamiento |

### 7.6 Devices & Drones

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/devices | Listar dispositivos |
| POST | /v1/devices | Registrar dispositivo |
| GET | /v1/devices/{id} | Detalle de dispositivo |
| PATCH | /v1/devices/{id} | Actualizar dispositivo |
| GET | /v1/devices/{id}/status | Estado actual (telemetría) |
| GET | /v1/missions | Listar misiones |
| POST | /v1/missions | Planificar misión |
| GET | /v1/missions/{id} | Detalle de misión |
| POST | /v1/missions/{id}/start | Iniciar pre-flight |
| POST | /v1/missions/{id}/launch | Lanzar vuelo |
| POST | /v1/missions/{id}/abort | Abortar misión |
| GET | /v1/missions/{id}/telemetry | Telemetría de la misión |
| GET | /v1/missions/{id}/captures | Capturas de la misión |

### 7.7 Integrations

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/connectors | Listar conectores |
| POST | /v1/connectors | Crear conector |
| GET | /v1/connectors/{id} | Detalle de conector |
| PATCH | /v1/connectors/{id} | Actualizar configuración |
| POST | /v1/connectors/{id}/test | Test de conexión |
| POST | /v1/connectors/{id}/activate | Activar conector |
| POST | /v1/connectors/{id}/deactivate | Desactivar conector |
| POST | /v1/connectors/{id}/sync | Ejecutar sincronización |
| GET | /v1/sync-jobs | Listar trabajos de sync |
| GET | /v1/sync-jobs/{id} | Detalle de sync job |

### 7.8 Reports & Analytics

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/reports/templates | Templates disponibles |
| POST | /v1/reports/generate | Generar reporte |
| GET | /v1/reports/{id} | Estado/descarga del reporte |
| GET | /v1/analytics/dashboard | KPIs del dashboard |
| GET | /v1/analytics/inventory-accuracy | Precisión de inventario |
| GET | /v1/analytics/stock-levels | Niveles de stock |
| GET | /v1/analytics/incident-trends | Tendencias de incidencias |
| GET | /v1/analytics/ai-performance | Rendimiento de modelos IA |

### 7.9 Audit

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/audit/events | Buscar eventos de auditoría |
| GET | /v1/audit/events/{id} | Detalle de evento |
| GET | /v1/audit/resources/{type}/{id}/history | Historial de un recurso |
| GET | /v1/audit/users/{id}/activity | Actividad de un usuario |
| POST | /v1/audit/export | Exportar logs |

### 7.10 Configuration

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /v1/settings | Configuración del tenant |
| PATCH | /v1/settings | Actualizar configuración |
| GET | /v1/settings/warehouses/{id} | Config del almacén |
| PATCH | /v1/settings/warehouses/{id} | Actualizar config almacén |

### 7.11 Health & System

| Method | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | /health | No | Liveness check |
| GET | /ready | No | Readiness check |
| GET | /v1/system/info | Sí (admin) | Versión, status |
| GET | /v1/system/metrics | Sí (admin) | Métricas prometheus |

---

## 8. WEBHOOKS (Outbound)

### 8.1 Eventos Disponibles

```json
{
  "id": "evt-uuid",
  "type": "inventory.count.completed",
  "tenant_id": "tenant-uuid",
  "timestamp": "2026-07-28T10:30:00Z",
  "data": {
    "count_id": "count-uuid",
    "warehouse_id": "wh-uuid",
    "discrepancies_found": 5,
    "total_items": 100
  }
}
```

### 8.2 Tipos de Eventos

| Evento | Trigger |
|--------|---------|
| `inventory.count.completed` | Conteo finalizado |
| `inventory.adjustment.applied` | Ajuste aplicado |
| `inventory.incident.created` | Incidencia creada |
| `ai.inference.completed` | Inferencia terminada |
| `ai.training.completed` | Entrenamiento terminado |
| `integration.sync.completed` | Sync completado |
| `integration.sync.failed` | Sync fallido |
| `drone.mission.completed` | Misión completada |
| `user.invited` | Usuario invitado |
| `user.activated` | Usuario activado |

---

## 9. RATE LIMITING

### 9.1 Headers de Rate Limit

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1700000060
Retry-After: 30  (solo en 429)
```

### 9.2 Límites por Plan

| Plan | General | Inference | Bulk Operations |
|------|---------|-----------|-----------------|
| Starter | 60/min | 10/min | 5/min |
| Professional | 300/min | 50/min | 20/min |
| Enterprise | 1000/min | 200/min | 100/min |

---

## 10. UPLOAD DE ARCHIVOS

### 10.1 Flujo de Upload

```
1. Client solicita URL firmada:
   POST /v1/uploads/presigned
   Body: { "filename": "image.jpg", "content_type": "image/jpeg", "size": 1048576 }
   Response: { "upload_url": "https://storage...", "file_key": "..." }

2. Client sube directamente a Storage:
   PUT {upload_url} + file binary

3. Client confirma upload:
   POST /v1/uploads/confirm
   Body: { "file_key": "...", "resource_type": "product_image", "resource_id": "..." }
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
