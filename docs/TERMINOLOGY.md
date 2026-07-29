# OLO_IA - TERMINOLOGÍA OFICIAL

## 1. VOCABULARIO OBLIGATORIO

Estos son los términos oficiales del sistema. No usar sinónimos.

### 1.1 Jerarquía Organizacional

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **Platform** | La instancia global de OLO_IA que hospeda todos los tenants | Sistema, aplicación |
| **Tenant** | Organización cliente que contrata OLO_IA. Unidad de aislamiento de datos. | Cliente, organización, customer, account |
| **Country** | Agrupación geográfica dentro de un tenant. Define configuración regional. | País, región |
| **Company** | Entidad legal dentro de un tenant, perteneciente a un country. | Compañía, empresa, firma |
| **Warehouse** | Unidad operativa física. Puede tener WMS, timezone, moneda e idioma propios. | Almacén, bodega, centro, site, facility |
| **Area** | Zona funcional dentro de un warehouse (receiving, storage, picking, shipping). | Zona, sección |
| **Location** | Posición física específica dentro de un area (rack, shelf, bin). | Ubicación, posición, slot |

### 1.2 Identidad y Acceso

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **User** | Persona que opera en la plataforma, pertenece a un tenant. | Usuario, operador, persona |
| **Platform Admin** | Operador interno de OLO_IA con acceso cross-tenant. | Super admin global |
| **Tenant Admin** | Administrador del tenant con acceso total dentro de su organización. | Admin, super admin (ambiguo) |
| **Role** | Conjunto nombrado de permissions asignables a users. | Perfil, tipo de usuario |
| **Permission** | Capacidad granular de ejecutar una acción sobre un recurso. Formato: `module:action`. | Acceso, privilegio, derecho |
| **Scope** | Límite contextual de una asignación de rol (global, company, warehouse). | Alcance, contexto |
| **Session** | Período de actividad autenticada de un user. | Sesión, conexión |

### 1.3 Inventario

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **Product** | Artículo del catálogo, identificado por SKU. Scope: tenant. | Producto, item, material, artículo |
| **Stock Record** | Registro de existencia de un product en una location con cantidad específica. | Inventario (ambiguo), existencia |
| **Count** | Proceso de verificación física de stock en un warehouse. | Conteo, inventario físico |
| **Count Item** | Resultado de contar un product en una location durante un count. | Línea de conteo |
| **Adjustment** | Modificación de stock con motivo, sujeto a aprobación. | Ajuste, regularización, corrección |
| **Incident** | Discrepancia o anomalía detectada que requiere investigación. | Incidencia, problema, hallazgo |

### 1.4 Inteligencia Artificial

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **AI Engine** | Motor abstracto de inferencia/entrenamiento (YOLO, SAM, etc.). | Motor IA, modelo (ambiguo) |
| **AI Model** | Instancia entrenada de un engine con pesos específicos. | Modelo (cuando se refiere al engine) |
| **Dataset** | Conjunto de imágenes anotadas para entrenamiento. | Set de datos, corpus |
| **Inference Job** | Ejecución de un AI Model sobre input(s) para producir detecciones. | Predicción, análisis |
| **Training Job** | Proceso de entrenamiento que produce un AI Model. | Entrenamiento (como sustantivo de la ejecución) |
| **Detection** | Resultado unitario de una inference: clase + bbox + confianza. | Detección, hallazgo IA |

### 1.5 Dispositivos y Drones

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **Device** | Hardware registrado en la plataforma (drone, camera, sensor). | Equipo, dispositivo, aparato |
| **Mission** | Plan de vuelo de un drone con waypoints y objetivos. | Misión, vuelo, recorrido |
| **Capture** | Imagen o video tomado durante una mission en un waypoint. | Foto, toma, captura |
| **Telemetry** | Datos de estado del drone en vuelo (posición, batería, velocidad). | Datos de vuelo |
| **Stream** | Flujo de video en tiempo real desde un device. | Transmisión, feed |

### 1.6 Integraciones

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **Connector** | Componente que conecta un warehouse con un sistema externo (WMS). | Conector, integración (ambiguo), plugin |
| **Sync Job** | Ejecución de sincronización de datos entre OLO_IA y un sistema externo. | Sincronización (como ejecución), job |
| **Field Mapping** | Configuración que define cómo se traducen campos entre sistemas. | Mapeo, transformación |

### 1.7 Plataforma

| Término Oficial | Definición | NO usar |
|----------------|-----------|---------|
| **Plan** | Tier de servicio contratado por un tenant (Starter, Professional, Enterprise). | Licencia, suscripción |
| **Module** | Unidad funcional activable de la plataforma. | Módulo, feature (ambiguo) |
| **Feature Flag** | Toggle que activa/desactiva funcionalidad sin deploy. | Flag, toggle |
| **Audit Event** | Registro inmutable de una acción en el sistema. | Log, evento (genérico) |

---

## 2. TÉRMINOS PROHIBIDOS (Ambiguos)

| NO usar | Porque | Usar en su lugar |
|---------|--------|-----------------|
| "Cliente" | Ambiguo: ¿tenant? ¿customer del tenant? | **Tenant** (organización) |
| "Organización" | Ambiguo: ¿tenant? ¿company? | El término específico |
| "Inventario" | Ambiguo: ¿stock record? ¿count? ¿módulo? | **Stock Record** o **Count** |
| "Modelo" | Ambiguo: ¿AI Model? ¿domain model? ¿DB model? | Calificar: **AI Model**, **domain entity** |
| "Admin" | Ambiguo: ¿platform admin? ¿tenant admin? | Calificar: **Platform Admin** o **Tenant Admin** |
| "Integración" | Ambiguo: ¿connector? ¿sync job? ¿módulo? | El término específico |
| "Site" / "Facility" | No existe en el modelo | **Warehouse** |

---

*Documento generado como parte de la auditoría arquitectónica de OLO_IA.*
*Versión: 1.0*
*Fecha: Julio 2026*
