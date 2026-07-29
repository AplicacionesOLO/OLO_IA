# OLO_IA - ESTRATEGIA DE INTEGRACIONES

## 1. INTRODUCCIÓN

Este documento define la arquitectura de integraciones de OLO_IA: cómo se conecta con sistemas WMS externos, ERPs, servicios cloud, dispositivos de hardware y cualquier sistema de terceros.

### 1.1 Principios

1. **Cada almacén puede usar un WMS distinto** - Nunca asumir un solo sistema.
2. **Conectores como plugins** - Instalables, configurables, versionados.
3. **Desacoplamiento total** - El core no depende de ningún conector.
4. **Resiliencia** - Reintentos, circuit breaker, dead letter queue.
5. **Observabilidad** - Todo logueado, traceable, monitoreable.

---

## 2. ARQUITECTURA DE CONECTORES

```
┌─────────────────────────────────────────────────────────────┐
│                 CONNECTOR ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  CONNECTOR INTERFACE (Puerto)                          │  │
│  │                                                        │  │
│  │  • connect() → ConnectionStatus                        │  │
│  │  • disconnect()                                        │  │
│  │  • health_check() → HealthResult                       │  │
│  │  • sync_products(direction) → SyncResult               │  │
│  │  • sync_inventory(direction) → SyncResult              │  │
│  │  • sync_locations(direction) → SyncResult              │  │
│  │  • push_adjustment(adjustment) → PushResult            │  │
│  │  • get_capabilities() → List[Capability]               │  │
│  │                                                        │  │
│  └──────────────┬──────────────┬──────────────┬──────────┘  │
│                 │              │              │               │
│        ┌────────┴──┐  ┌───────┴───┐  ┌──────┴────┐         │
│        │  SAP      │  │  Oracle   │  │  Generic  │         │
│        │  Adapter  │  │  Adapter  │  │  REST     │         │
│        ├───────────┤  ├───────────┤  ├───────────┤         │
│        │ • RFC/BAPI│  │ • REST/OCI│  │ • Config  │         │
│        │ • IDoc    │  │ • JDBC    │  │ • Mapping │         │
│        │ • OData   │  │           │  │ • Auth    │         │
│        └───────────┘  └───────────┘  └───────────┘         │
│                                                              │
│        ┌───────────┐  ┌───────────┐  ┌───────────┐         │
│        │  Softland │  │  Exactus  │  │  Dynamics │         │
│        │  Adapter  │  │  Adapter  │  │  Adapter  │         │
│        └───────────┘  └───────────┘  └───────────┘         │
│                                                              │
│        ┌───────────┐  ┌───────────┐  ┌───────────┐         │
│        │  CSV/     │  │  SOAP     │  │  MQTT     │         │
│        │  Excel    │  │  Adapter  │  │  Adapter  │         │
│        └───────────┘  └───────────┘  └───────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. CICLO DE VIDA DE UN CONECTOR

```
[configuring] ──► [testing] ──► [active] ──► [inactive]
      │                │             │            │
      │                │             │            ▼
      └────────────────┴─────────────┴──► [error] ──► [active] (auto-recovery)
```

| Estado | Descripción | Operaciones Permitidas |
|--------|-------------|----------------------|
| configuring | Configuración inicial | Editar config, test connection |
| testing | Verificando conectividad | Test, editar |
| active | Operativo, sincronizando | Sync, health check, desactivar |
| inactive | Pausado manualmente | Activar, editar, eliminar |
| error | Fallo detectado | Ver logs, reintentar, editar |

---

## 4. CONFIGURACIÓN DE UN CONECTOR

### 4.1 Connection Config

```json
{
  "base_url": "https://sap-erp.client.com/api",
  "auth_type": "oauth2",
  "auth_config": {
    "token_url": "https://sap-erp.client.com/oauth/token",
    "client_id": "encrypted:...",
    "client_secret": "encrypted:...",
    "scope": "read write"
  },
  "timeout_seconds": 30,
  "max_retries": 3,
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

### 4.2 Mapping Config

```json
{
  "products": {
    "source_endpoint": "/materials",
    "id_field": "MaterialNumber",
    "mappings": [
      { "source": "MaterialNumber", "target": "sku", "transform": "uppercase" },
      { "source": "Description", "target": "name" },
      { "source": "Category.Name", "target": "category", "transform": "lookup:categories" },
      { "source": "BaseUOM", "target": "unit_of_measure", "transform": "map:uom" },
      { "source": "GrossWeight", "target": "weight_kg", "transform": "to_float" }
    ],
    "filters": {
      "PlantCode": "1000",
      "Status": "active"
    }
  },
  "inventory": {
    "source_endpoint": "/stock-levels",
    "id_field": "StockId",
    "mappings": [
      { "source": "Material", "target": "product_id", "transform": "lookup:products_by_sku" },
      { "source": "StorageLocation", "target": "location_id", "transform": "lookup:locations_by_code" },
      { "source": "AvailableQty", "target": "quantity", "transform": "to_decimal" },
      { "source": "BatchNumber", "target": "lot_number" }
    ]
  }
}
```

### 4.3 Sync Config

```json
{
  "schedule": {
    "products": { "cron": "0 */6 * * *", "type": "delta" },
    "inventory": { "cron": "*/30 * * * *", "type": "delta" },
    "locations": { "cron": "0 0 * * 0", "type": "full" }
  },
  "conflict_resolution": "source_wins",
  "batch_size": 100,
  "delta_field": "ModifiedDate",
  "delta_window_minutes": 35,
  "error_threshold": 10,
  "notify_on_error": true
}
```

---

## 5. MOTOR DE SINCRONIZACIÓN

### 5.1 Flujo de Sync

```
┌─────────────────────────────────────────────────────────────┐
│                    SYNC ENGINE FLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. TRIGGER                                                  │
│     ├── Scheduled (cron)                                     │
│     ├── Manual (user request)                                │
│     └── Event (webhook from WMS)                             │
│                                                              │
│  2. FETCH                                                    │
│     ├── Get data from source (paginated)                     │
│     ├── Apply delta filter if not full sync                  │
│     └── Store raw response for audit                         │
│                                                              │
│  3. TRANSFORM                                                │
│     ├── Apply field mappings                                 │
│     ├── Execute transforms (type conversion, lookups)        │
│     ├── Validate transformed data (Pydantic)                 │
│     └── Skip invalid records (log + continue)                │
│                                                              │
│  4. COMPARE                                                  │
│     ├── Existing record? → UPDATE if changed                 │
│     ├── New record? → INSERT                                 │
│     ├── Missing in source? → Flag (configurable action)      │
│     └── Conflict detected? → Apply resolution strategy       │
│                                                              │
│  5. APPLY                                                    │
│     ├── Batch upsert to database                             │
│     ├── Emit domain events (ProductUpdated, StockChanged)    │
│     └── Update sync checkpoint                               │
│                                                              │
│  6. REPORT                                                   │
│     ├── Record results (created, updated, skipped, failed)   │
│     ├── Log errors with details                              │
│     └── Notify if error threshold exceeded                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Estrategias de Conflicto

| Estrategia | Descripción | Cuándo usar |
|-----------|-------------|-------------|
| source_wins | Dato del WMS sobrescribe | WMS es fuente de verdad |
| target_wins | OLO_IA mantiene su dato | OLO_IA es fuente de verdad |
| newest_wins | El más reciente gana | Bi-directional |
| manual | Marcar como conflicto para revisión | Datos críticos |
| merge | Combinar campos no conflictivos | Actualizaciones parciales |

### 5.3 Resiliencia

```
┌──────────────────────────────────────────────────────┐
│              RESILIENCE PATTERNS                       │
├──────────────────────────────────────────────────────┤
│                                                       │
│  RETRY (Backoff exponencial)                          │
│  ├── Attempt 1: inmediato                             │
│  ├── Attempt 2: 5 segundos                            │
│  ├── Attempt 3: 25 segundos                           │
│  ├── Attempt 4: 125 segundos                          │
│  └── Max retries: configurable (default 3)            │
│                                                       │
│  CIRCUIT BREAKER                                      │
│  ├── Closed: Operación normal                         │
│  ├── Open: >5 fallos consecutivos → stop requests     │
│  ├── Half-Open: Tras 60s, probar 1 request            │
│  └── Si OK → Closed; Si FAIL → Open                  │
│                                                       │
│  DEAD LETTER QUEUE                                    │
│  ├── Records que fallan tras max_retries              │
│  ├── Almacenados para review manual                   │
│  ├── UI para ver y re-procesar                        │
│  └── Alertas al equipo                                │
│                                                       │
│  IDEMPOTENCY                                          │
│  ├── Cada sync job tiene unique ID                    │
│  ├── Records procesados trackean sync_job_id          │
│  ├── Re-procesar es seguro (upsert by ID)             │
│  └── Checkpoints para resume tras fallo               │
│                                                       │
└──────────────────────────────────────────────────────┘
```

---

## 6. CONECTORES ESPECÍFICOS

### 6.1 Conector SAP

| Protocolo | OData v2/v4, RFC/BAPI, IDoc |
|-----------|----------------------------|
| Auth | OAuth 2.0, Basic Auth, X.509 Certificate |
| Entities | Materials, Stock, Storage Locations, Batches |
| Direction | Bidirectional |
| Real-time | IDoc listener (futuro) |

### 6.2 Conector Oracle

| Protocolo | REST API, JDBC |
|-----------|---------------|
| Auth | OAuth 2.0, API Key |
| Entities | Items, On-Hand, Subinventories |
| Direction | Bidirectional |

### 6.3 Conector Genérico REST

| Protocolo | HTTP REST (configurable) |
|-----------|-------------------------|
| Auth | Basic, Bearer, OAuth2, API Key, Custom Header |
| Entities | Configurable via mapping |
| Direction | Configurable |
| Transforms | JSONPath, JMESPath para extracción |

### 6.4 Conector CSV/Excel

| Input | File upload o SFTP |
|-------|-------------------|
| Parsing | Configurable (delimiter, encoding, headers) |
| Mapping | Column index or header name → field |
| Validation | Row-level, skip or fail |
| Schedule | Manual upload o SFTP polling |

---

## 7. INTEGRACIONES FUTURAS

### 7.1 Sistemas de Mensajería

| Sistema | Uso | Fase |
|---------|-----|------|
| MQTT | IoT sensors, dispositivos edge | 3 |
| RabbitMQ | Event bus distribuido | 4 |
| Kafka | Streaming de eventos alto volumen | 4+ |

### 7.2 Cloud Services

| Servicio | Uso | Fase |
|---------|-----|------|
| AWS S3 | Storage alternativo | 4 |
| Azure Blob | Storage alternativo | 4 |
| Google Drive | Import/export documentos | 4 |
| OneDrive/SharePoint | Integración corporativa | 4 |

### 7.3 Hardware

| Hardware | Protocolo | Fase |
|----------|----------|------|
| DJI Drones | DJI Mobile SDK / Cloud API | 3 |
| GoPro | GoPro Open API | 3 |
| Intel RealSense | librealsense SDK | 3+ |
| RTSP Cameras | RTSP/ONVIF | 3 |

---

## 8. SEGURIDAD DE INTEGRACIONES

| Control | Implementación |
|---------|---------------|
| Credenciales | Encriptadas AES-256 at-rest, nunca en logs |
| Network | Whitelist IPs, VPN para on-premise |
| Auth tokens | Rotación automática, short-lived |
| Data in transit | TLS 1.3 obligatorio |
| Audit | Toda operación de sync logueada |
| Rate limiting | Hacia sistemas externos (no saturar WMS) |
| Data masking | Datos sensibles maskeados en logs |

---

## 9. MONITOREO DE INTEGRACIONES

| Métrica | Alerta |
|---------|--------|
| Sync success rate < 95% | Warning |
| Sync success rate < 80% | Critical |
| Sync duration > 2x promedio | Warning |
| Circuit breaker opened | Critical |
| Dead letter queue > 100 items | Warning |
| Connector offline > 30 min | Critical |
| Auth token expiring < 24h | Warning |

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
