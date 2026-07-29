# OLO_IA - ARQUITECTURA DEL SISTEMA

## 1. RESUMEN EJECUTIVO

Este documento define la arquitectura completa de OLO_IA, basada en Clean Architecture con elementos de Domain-Driven Design. La arquitectura está diseñada para ser empresarial desde el primer día, escalable horizontalmente, y preparada para evolucionar hacia microservicios sin reescritura.

---

## 1.1 ARQUITECTURA INICIAL DECLARADA

> **Decisión DR-007 (aprobada).** La arquitectura inicial es **monolito modular**.

| Aspecto | Decisión Fase 0-2 | Cuándo cambia |
|---------|-------------------|---------------|
| Estilo arquitectónico | **Monolito modular** (una sola aplicación FastAPI con módulos de límites explícitos) | Cuando un módulo tenga un perfil de escalado o de fallo genuinamente distinto |
| Procesos pesados | **Workers desacoplados** (proceso separado, mismo código base) | Ya desde Fase 1 para sync e inferencia |
| Orquestación | **PaaS** (Cloud Run / Fly.io) | Ver DEPLOYMENT.md |
| Kubernetes | **Pospuesto** (DR-008) | > 50 req/s sostenidos, o > 5 workers GPU, o necesidad de GPU scaling fino |
| Microservicios | **Pospuesto** | Cuando el monolito modular demuestre ser el cuello de botella, no antes |

### 1.1.1 Qué significa "monolito modular" aquí

Una sola aplicación desplegable, con módulos que se comunican **solo a través de
interfaces de la capa de aplicación**. Nunca acceso directo entre repositorios de
módulos distintos.

```
┌──────────────────────────────────────────────────────────┐
│              APLICACIÓN ÚNICA (FastAPI)                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ tenant  │ │identity │ │inventory│ │integr.  │        │
│  │ module  │ │ module  │ │ module  │ │ module  │        │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘        │
│       │           │           │           │              │
│       └───────────┴───────────┴───────────┘              │
│                     │                                     │
│         Comunicación SOLO vía interfaces                  │
│         de application layer + domain events              │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Regla que hace posible la extracción futura**: si el módulo A necesita datos del
módulo B, lo obtiene llamando a un use case de B, no consultando las tablas de B.
Esta disciplina es lo que permite extraer un módulo a servicio sin reescribirlo.

### 1.1.2 Workers desacoplados

Los procesos pesados corren en un proceso separado desde Fase 1, aunque compartan
el código base:

| Worker | Responsabilidad | Fase |
|--------|----------------|------|
| Sync worker | Ejecutar sync jobs de conectores WMS | 1 |
| Report worker | Generar reportes asíncronos | 1 |
| Inference worker | Procesar cola de inferencia (requiere GPU) | 2 |
| Training worker | Ejecutar entrenamientos (requiere GPU) | 2 |
| Stream worker | Procesar streams RTSP | 3 |

Los workers usan el rol `olo_app` con contexto explícito (ver `SECURITY.md` §3.6,
categoría B). No reciben requests HTTP de usuarios.

La abstracción que los desacopla del disparador es la interfaz `JobDispatcher`
(decisión DR-009), definida desde Fase 0 aunque su implementación inicial sea trivial.

### 1.1.3 Canales autorizados del frontend

El frontend puede comunicarse con el backend **solo** por estos canales:

| Canal | Uso | Autorización |
|-------|-----|-------------|
| **REST API** (`/v1/*`) | Toda operación de negocio | JWT → rol `authenticated` → RBAC en aplicación |
| **Supabase Auth** | Login, logout, refresh, reset password | Directo contra Supabase Auth |
| **Supabase Realtime** | Suscripción a cambios y eventos en vivo | JWT → rol `authenticated` → **RLS obligatorio** en las tablas suscritas |
| **Supabase Storage** | Upload/download de archivos | JWT → policies de Storage con prefijo `tenants/{tenant_id}/` |
| **RPCs aprobadas** | Funciones PostgreSQL expuestas vía PostgREST, lista explícita | JWT → `SECURITY DEFINER` con verificación interna |

Canales **no** autorizados:

| Canal | Por qué |
|-------|---------|
| Conexión directa a PostgreSQL | El frontend nunca tiene credenciales de BD |
| `service_role` key en el cliente | Tiene `BYPASSRLS`: expondría todos los tenants |
| RPCs no listadas | Cada RPC expuesta es superficie de ataque; requiere revisión explícita |
| Escritura directa a tablas vía PostgREST sin RLS verificada | Toda tabla expuesta debe tener RLS con `FORCE` |

Cualquier RPC nueva expuesta a PostgREST requiere: revisión de seguridad, verificación
de autorización dentro de la función, y registro en la lista de RPCs aprobadas.

---

## 2. PRINCIPIOS ARQUITECTÓNICOS

### 2.1 Principios Fundamentales

| Principio | Descripción | Aplicación |
|-----------|-------------|------------|
| **Clean Architecture** | Dependencias apuntan hacia adentro | Domain no depende de infraestructura |
| **SOLID** | Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion | Todas las capas |
| **DDD Táctico** | Entities, Value Objects, Aggregates, Domain Events | Capa de dominio |
| **Separation of Concerns** | Cada capa tiene una responsabilidad clara | Backend y Frontend |
| **Dependency Injection** | Las dependencias se inyectan, no se instancian | FastAPI DI container |
| **API-First** | La API se diseña antes que la implementación | OpenAPI spec driven |
| **Event-Driven** | Comunicación por eventos para desacoplamiento | Domain Events, Realtime |
| **Stateless Services** | Sin estado entre requests | Escalabilidad horizontal |

### 2.2 Regla de Dependencia

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│    Las dependencias SOLO apuntan hacia adentro       │
│                                                      │
│    ┌───────────────────────────────────────┐         │
│    │         INFRASTRUCTURE                 │         │
│    │    ┌─────────────────────────────┐    │         │
│    │    │       APPLICATION            │    │         │
│    │    │    ┌───────────────────┐     │    │         │
│    │    │    │      DOMAIN       │     │    │         │
│    │    │    │                   │     │    │         │
│    │    │    │   (Entities,      │     │    │         │
│    │    │    │    Value Objects,  │     │    │         │
│    │    │    │    Interfaces)     │     │    │         │
│    │    │    └───────────────────┘     │    │         │
│    │    │                              │    │         │
│    │    │  (Use Cases, Services,       │    │         │
│    │    │   DTOs, Ports)               │    │         │
│    │    └─────────────────────────────┘    │         │
│    │                                       │         │
│    │  (DB, APIs, Frameworks, External)     │         │
│    └───────────────────────────────────────┘         │
│                                                      │
│    PRESENTATION (React, API Controllers)             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Reglas estrictas:**
- Domain NO importa nada de Application, Infrastructure ni Presentation.
- Application importa de Domain pero NO de Infrastructure ni Presentation.
- Infrastructure implementa interfaces definidas en Domain/Application.
- Presentation consume Application a través de interfaces definidas.

---

## 3. ARQUITECTURA DE ALTO NIVEL

### 3.1 Vista General del Sistema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENTES                                        │
│                                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Web App  │  │ Mobile   │  │ API      │  │ Drones   │               │
│  │ (React)  │  │ (Future) │  │ Clients  │  │ SDK      │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       │              │              │              │                      │
└───────┼──────────────┼──────────────┼──────────────┼─────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        EDGE / CDN / LOAD BALANCER                         │
│                    (CloudFlare / Vercel / Nginx)                          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY                                      │
│              (Rate Limiting, Auth Verification, Routing)                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   CORE API       │ │   AI SERVICE     │ │   STREAMING      │
│   (FastAPI)      │ │   (FastAPI)      │ │   SERVICE        │
│                  │ │                  │ │                  │
│ • Auth           │ │ • Inference      │ │ • RTSP Ingestion │
│ • Admin          │ │ • Training       │ │ • Processing     │
│ • Inventory      │ │ • Datasets       │ │ • WebSocket      │
│ • Integrations   │ │ • Models         │ │ • Recording      │
│ • Reports        │ │ • Pipeline       │ │                  │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         PLATFORM SERVICES                                 │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Supabase   │  │  Supabase   │  │  Supabase   │  │  Supabase   │   │
│  │  PostgreSQL │  │  Auth       │  │  Storage    │  │  Realtime   │   │
│  │             │  │             │  │             │  │             │   │
│  │  • RLS      │  │  • JWT      │  │  • Files    │  │  • Events   │   │
│  │  • Triggers │  │  • MFA      │  │  • Images   │  │  • Channels │   │
│  │  • Functions│  │  • SSO      │  │  • Videos   │  │  • Presence │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Flujo de una Request Típica

```
Client Request
     │
     ▼
[CDN/Edge] ─── Static assets served here
     │
     ▼
[API Gateway] ─── Rate limit check
     │              API key validation
     ▼              Route to service
[Auth Middleware] ─── JWT validation
     │                 Token refresh if needed
     ▼                 Extract tenant context
[Controller] ─── Input validation (Pydantic)
     │             Map to application DTO
     ▼
[Use Case / Service] ─── Business logic
     │                     Domain rules
     ▼                     Event emission
[Repository] ─── Data access
     │             Query building
     ▼             RLS enforcement
[Database] ─── PostgreSQL with RLS
     │
     ▼
Response flows back up through layers
```

---

## 4. CAPAS DEL BACKEND

### 4.1 Capa de Dominio (Domain Layer)

**Responsabilidad**: Contiene la lógica de negocio pura. No tiene dependencias externas.

**Contenido:**
- Entities (con identidad)
- Value Objects (sin identidad, inmutables)
- Aggregates (consistencia transaccional)
- Domain Events
- Repository Interfaces (puertos)
- Domain Services (lógica que no pertenece a una entidad)
- Exceptions de dominio
- Enums y constantes de negocio

**Reglas:**
- NO imports de SQLAlchemy, FastAPI, Pydantic ni ningún framework.
- NO acceso a base de datos ni APIs externas.
- Las entidades se validan a sí mismas.
- Los Value Objects son inmutables.
- Los eventos de dominio se emiten pero NO se publican aquí.

```python
# Ejemplo conceptual: Entity de dominio
class Warehouse:
    id: WarehouseId
    company_id: CompanyId
    name: str
    timezone: Timezone
    status: WarehouseStatus
    areas: List[Area]
    
    def activate(self) -> None:
        if self.status == WarehouseStatus.ACTIVE:
            raise DomainError("Warehouse already active")
        self.status = WarehouseStatus.ACTIVE
        self.add_event(WarehouseActivated(self.id))
    
    def add_area(self, area: Area) -> None:
        if self._area_name_exists(area.name):
            raise DomainError(f"Area '{area.name}' already exists")
        self.areas.append(area)
        self.add_event(AreaAdded(self.id, area.id))
```

### 4.2 Capa de Aplicación (Application Layer)

**Responsabilidad**: Orquesta los casos de uso. Coordina entidades de dominio y servicios de infraestructura a través de interfaces.

**Contenido:**
- Use Cases (un archivo por caso de uso)
- Application Services
- DTOs (Data Transfer Objects) de entrada y salida
- Port Interfaces (para infraestructura)
- Command/Query objects (CQRS lite)
- Event Handlers
- Validators de aplicación

**Reglas:**
- Importa SOLO del Domain.
- Define interfaces que Infrastructure implementará.
- No conoce detalles de base de datos ni frameworks HTTP.
- Cada Use Case hace UNA cosa.
- Los DTOs son objetos Pydantic para validación.

```python
# Ejemplo conceptual: Use Case
class CreateWarehouseUseCase:
    def __init__(
        self,
        warehouse_repo: IWarehouseRepository,  # Interface del Domain
        company_repo: ICompanyRepository,
        event_bus: IEventBus,                   # Interface de Application
    ):
        self._warehouse_repo = warehouse_repo
        self._company_repo = company_repo
        self._event_bus = event_bus
    
    async def execute(self, command: CreateWarehouseCommand) -> WarehouseDTO:
        company = await self._company_repo.get_by_id(command.company_id)
        if not company:
            raise CompanyNotFoundError(command.company_id)
        
        warehouse = Warehouse.create(
            company_id=company.id,
            name=command.name,
            timezone=command.timezone,
        )
        
        await self._warehouse_repo.save(warehouse)
        await self._event_bus.publish(warehouse.pull_events())
        
        return WarehouseDTO.from_entity(warehouse)
```

### 4.3 Capa de Infraestructura (Infrastructure Layer)

**Responsabilidad**: Implementa las interfaces definidas en Domain y Application. Contiene todo el código dependiente de frameworks y servicios externos.

**Contenido:**
- Repository Implementations (SQLAlchemy)
- Database Models (ORM mappings)
- External API clients
- Message queue adapters
- File storage adapters (Supabase Storage)
- Email service adapters
- Event bus implementation
- Cache adapters
- Third-party SDK wrappers

**Reglas:**
- Implementa interfaces del Domain/Application.
- Conoce SQLAlchemy, Supabase, etc.
- Mapea entre modelos ORM y entidades de dominio.
- NO contiene lógica de negocio.
- Maneja transacciones de base de datos.

```python
# Ejemplo conceptual: Repository Implementation
class SQLAlchemyWarehouseRepository(IWarehouseRepository):
    def __init__(self, session: AsyncSession):
        self._session = session
    
    async def get_by_id(self, warehouse_id: WarehouseId) -> Optional[Warehouse]:
        stmt = select(WarehouseModel).where(
            WarehouseModel.id == warehouse_id.value
        )
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        
        if model is None:
            return None
        
        return self._to_entity(model)
    
    async def save(self, warehouse: Warehouse) -> None:
        model = self._to_model(warehouse)
        self._session.add(model)
        await self._session.flush()
    
    def _to_entity(self, model: WarehouseModel) -> Warehouse:
        # Mapping ORM → Domain Entity
        ...
    
    def _to_model(self, entity: Warehouse) -> WarehouseModel:
        # Mapping Domain Entity → ORM
        ...
```

### 4.4 Capa de Presentación (Presentation Layer)

**Responsabilidad**: Expone la funcionalidad al mundo exterior. Maneja HTTP, WebSocket, serialización y documentación de API.

**Contenido:**
- API Controllers (FastAPI routers)
- Request/Response schemas (Pydantic)
- Middleware (auth, logging, CORS, rate limiting)
- Error handlers
- OpenAPI documentation
- WebSocket handlers
- Background task triggers

**Reglas:**
- Conoce FastAPI y HTTP.
- Valida input con Pydantic schemas.
- Delega TODO a la capa de Application.
- NO contiene lógica de negocio.
- Mapea excepciones de dominio a HTTP status codes.
- Documenta cada endpoint con OpenAPI.

```python
# Ejemplo conceptual: Controller
@router.post(
    "/warehouses",
    response_model=WarehouseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new warehouse",
)
async def create_warehouse(
    request: CreateWarehouseRequest,
    current_user: AuthUser = Depends(get_current_user),
    use_case: CreateWarehouseUseCase = Depends(get_create_warehouse_use_case),
) -> WarehouseResponse:
    command = CreateWarehouseCommand(
        company_id=request.company_id,
        name=request.name,
        timezone=request.timezone,
        created_by=current_user.id,
    )
    
    result = await use_case.execute(command)
    return WarehouseResponse.from_dto(result)
```

---

## 5. ARQUITECTURA DEL FRONTEND

### 5.1 Capas del Frontend

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND LAYERS                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              PAGES / VIEWS                       │    │
│  │  (Route components, layout composition)          │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              FEATURES                            │    │
│  │  (Feature-specific components and logic)         │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                                │
│  ┌──────────────┐  ┌───┴────────┐  ┌──────────────┐    │
│  │   HOOKS      │  │   STORES   │  │   SERVICES   │    │
│  │  (React Q.)  │  │  (Zustand) │  │  (API calls) │    │
│  └──────────────┘  └────────────┘  └──────────────┘    │
│                         │                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              SHARED / UI                         │    │
│  │  (Design system, primitives, utilities)          │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Responsabilidades por Capa Frontend

| Capa | Responsabilidad | Ejemplos |
|------|----------------|----------|
| **Pages** | Composición de layout y routing | `WarehousesPage`, `DashboardPage` |
| **Features** | Lógica específica de un feature | `WarehouseList`, `InventoryCount` |
| **Hooks** | Data fetching y cache (React Query) | `useWarehouses`, `useCreateWarehouse` |
| **Stores** | Estado global de UI (Zustand) | `useAuthStore`, `useSidebarStore` |
| **Services** | Llamadas HTTP al backend | `warehouseService.getAll()` |
| **Shared/UI** | Componentes reutilizables | `Button`, `Table`, `Modal`, `Input` |

### 5.3 Gestión de Estado

```
┌────────────────────────────────────────────────────────┐
│                  ESTADO EN FRONTEND                      │
├────────────────────────────────────────────────────────┤
│                                                         │
│  SERVER STATE (React Query)                             │
│  ├── Cache de datos del servidor                        │
│  ├── Sincronización automática                          │
│  ├── Optimistic updates                                 │
│  ├── Background refetching                              │
│  └── Pagination/Infinite scroll                         │
│                                                         │
│  CLIENT STATE (Zustand)                                 │
│  ├── Auth session (token, user)                         │
│  ├── UI state (sidebar, theme, modals)                  │
│  ├── Form state complejo                                │
│  └── Preferencias del usuario                           │
│                                                         │
│  URL STATE (React Router)                               │
│  ├── Current page/route                                 │
│  ├── Query params (filtros, paginación)                 │
│  └── Navigation history                                 │
│                                                         │
│  LOCAL STATE (useState/useReducer)                      │
│  ├── Estado de formularios simples                      │
│  ├── Toggles de UI locales                              │
│  └── Estado temporal de interacción                     │
│                                                         │
└────────────────────────────────────────────────────────┘
```

---

## 6. PATRONES ARQUITECTÓNICOS

### 6.1 Repository Pattern

Abstrae el acceso a datos detrás de una interfaz. Permite cambiar la implementación de persistencia sin afectar el dominio.

```
Domain Layer:          IWarehouseRepository (interface)
                              ▲
                              │ implements
Infrastructure Layer:  SQLAlchemyWarehouseRepository
                       InMemoryWarehouseRepository (tests)
```

**Interfaces base:**

```python
# Domain/ports
class IRepository(Protocol[T]):
    async def get_by_id(self, id: EntityId) -> Optional[T]: ...
    async def save(self, entity: T) -> None: ...
    async def delete(self, entity: T) -> None: ...

class IWarehouseRepository(IRepository[Warehouse]):
    async def find_by_company(self, company_id: CompanyId) -> List[Warehouse]: ...
    async def find_by_name(self, name: str) -> Optional[Warehouse]: ...
    async def count_by_company(self, company_id: CompanyId) -> int: ...
```

### 6.2 Unit of Work Pattern

Gestiona transacciones de forma consistente, asegurando que múltiples operaciones de repositorio se ejecuten en una misma transacción.

```python
class IUnitOfWork(Protocol):
    warehouses: IWarehouseRepository
    companies: ICompanyRepository
    users: IUserRepository
    
    async def commit(self) -> None: ...
    async def rollback(self) -> None: ...
    
    async def __aenter__(self) -> "IUnitOfWork": ...
    async def __aexit__(self, *args) -> None: ...
```

### 6.3 CQRS Lite

Separación de Commands (escritura) y Queries (lectura) sin infraestructura separada. Misma base de datos, pero modelos mentales distintos.

```
┌─────────────────────────────────────────────────┐
│                    CQRS Lite                      │
├─────────────────────────────────────────────────┤
│                                                  │
│  COMMANDS (Modifican estado)                     │
│  ├── CreateWarehouseCommand → Use Case → Repo   │
│  ├── UpdateInventoryCommand → Use Case → Repo   │
│  └── LaunchInferenceCommand → Use Case → Queue  │
│                                                  │
│  QUERIES (Solo lectura, optimizadas)             │
│  ├── GetWarehouseQuery → Query Service → View   │
│  ├── ListInventoryQuery → Query Service → View  │
│  └── DashboardStatsQuery → Query Service → View │
│                                                  │
│  Mismo DB, diferentes modelos de lectura         │
│  Queries pueden usar Views o materialized views  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 6.4 Domain Events

Los eventos de dominio desacoplan las consecuencias de una acción del código que la ejecuta.

```
┌──────────────────────────────────────────────────────────┐
│                   DOMAIN EVENTS FLOW                       │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Entity Action ──► Event Created ──► Event Bus           │
│                                         │                 │
│                         ┌───────────────┼────────────┐   │
│                         ▼               ▼            ▼   │
│                   [Audit Log]    [Notification]  [Sync]   │
│                                                           │
│  Ejemplo:                                                 │
│  warehouse.activate()                                     │
│       │                                                   │
│       ▼                                                   │
│  WarehouseActivated event                                 │
│       │                                                   │
│       ├──► AuditHandler: Log activación                   │
│       ├──► NotificationHandler: Notificar admin           │
│       └──► SyncHandler: Sincronizar con WMS               │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 6.4.1 Límites transaccionales y aggregates

> **Corregido.** La regla "un aggregate por transacción" se declaraba como absoluta.
> Se reemplaza por una regla con excepciones explícitas.

**Regla general (preferente):** una transacción modifica un solo aggregate. Las
consecuencias en otros aggregates se propagan por domain events con consistencia
eventual.

**Excepción autorizada:** cuando una invariante de negocio abarca varios aggregates y
su violación produciría un estado inconsistente inaceptable, se permite una transacción
multi-aggregate.

#### Criterio para autorizar una transacción multi-aggregate

Se permite solo si se cumplen los tres puntos:

1. Existe una invariante de negocio que **debe** ser verdadera en todo momento
   (no "debería serlo eventualmente").
2. La violación temporal de esa invariante produce daño real: pérdida de dinero,
   descuadre de inventario, o exposición de datos.
3. No hay forma razonable de rediseñar los límites de aggregate para que la invariante
   quede dentro de uno solo.

#### Casos autorizados en OLO_IA

| Operación | Aggregates | Invariante que lo justifica |
|-----------|-----------|----------------------------|
| Aplicar `InventoryAdjustment` | Adjustment + StockRecord(s) | El ajuste marcado como "aplicado" y el stock resultante deben coincidir. Un ajuste aplicado sin el stock actualizado es un descuadre contable. |
| Completar `InventoryCount` con generación de ajustes | Count + Adjustment(s) | Un conteo cerrado debe tener sus ajustes generados; si no, las discrepancias detectadas se pierden. |
| Aceptar `CountObservation` | CountItem + CountObservation | La observación marcada como aceptada y `count_item.accepted_quantity` deben ser consistentes. |
| Provisioning de tenant | Tenant + Company + User + RoleAssignment | Un tenant sin usuario administrador es inutilizable y no auto-reparable. |
| Revocar acceso a warehouse | UserWarehouseAccess + AuditEvent | La revocación y su registro de auditoría deben ser atómicos. |

#### Casos que permanecen con consistencia eventual

| Operación | Mecanismo |
|-----------|-----------|
| `InferenceCompleted` → crear Incident | Domain event |
| `MissionCompleted` → crear InventoryCount | Domain event |
| `StockAdjusted` → notificar a usuarios | Domain event |
| `SyncCompleted` → actualizar métricas de conector | Domain event |
| Cualquier operación → escribir audit event no crítico | Domain event |

#### Implementación

El `UnitOfWork` ya soporta múltiples repositorios en una transacción. La restricción es
de diseño, no técnica: se documenta en el use case por qué la transacción abarca varios
aggregates.

```python
class ApplyAdjustmentUseCase:
    """Aplica un ajuste y actualiza el stock en UNA transacción.

    Transacción multi-aggregate autorizada: un ajuste en estado 'applied'
    cuyo stock no fue modificado es un descuadre contable no auto-reparable.
    Ver ARCHITECTURE.md §6.4.1.
    """
    async def execute(self, command: ApplyAdjustmentCommand) -> AdjustmentDTO:
        async with self._uow:
            adjustment = await self._uow.adjustments.get_by_id(command.adjustment_id)
            # ... validaciones de dominio ...
            for item in adjustment.items:
                stock = await self._uow.stock_records.get_by_id(item.stock_record_id)
                stock.adjust(item.new_quantity, adjustment.reason)   # optimistic lock
                await self._uow.stock_records.save(stock)
            adjustment.apply()
            await self._uow.adjustments.save(adjustment)
            await self._uow.commit()          # ← ambos aggregates, una transacción
```

---

### 6.5 Dependency Injection

FastAPI proporciona un sistema de DI nativo mediante `Depends()`. Se estructura en providers que conectan las interfaces con sus implementaciones.

```python
# Dependency Provider
async def get_unit_of_work(
    session: AsyncSession = Depends(get_db_session),
) -> IUnitOfWork:
    return SQLAlchemyUnitOfWork(session)

async def get_create_warehouse_use_case(
    uow: IUnitOfWork = Depends(get_unit_of_work),
    event_bus: IEventBus = Depends(get_event_bus),
) -> CreateWarehouseUseCase:
    return CreateWarehouseUseCase(
        warehouse_repo=uow.warehouses,
        company_repo=uow.companies,
        event_bus=event_bus,
    )
```

### 6.6 Strategy Pattern para Motores IA

Permite intercambiar motores de IA sin modificar el código que los consume.

```
┌──────────────────────────────────────────────┐
│           IA ENGINE STRATEGY                  │
├──────────────────────────────────────────────┤
│                                               │
│  IInferenceEngine (Interface)                 │
│  ├── predict(image) → List[Detection]         │
│  ├── get_model_info() → ModelInfo             │
│  └── health_check() → HealthStatus            │
│       ▲           ▲           ▲               │
│       │           │           │               │
│  ┌────┴───┐  ┌───┴────┐  ┌──┴──────┐        │
│  │  YOLO  │  │ Ground │  │ Custom  │        │
│  │ Engine │  │  DINO  │  │ Engine  │        │
│  └────────┘  └────────┘  └─────────┘        │
│                                               │
│  EngineFactory.create(engine_type) → Engine   │
│                                               │
└──────────────────────────────────────────────┘
```

### 6.7 Adapter Pattern para Integraciones WMS

```
┌──────────────────────────────────────────────────┐
│           WMS CONNECTOR ADAPTER                    │
├──────────────────────────────────────────────────┤
│                                                   │
│  IWMSConnector (Interface)                        │
│  ├── connect() → ConnectionStatus                 │
│  ├── sync_products() → SyncResult                 │
│  ├── sync_inventory() → SyncResult                │
│  ├── push_adjustment() → PushResult               │
│  └── health_check() → HealthStatus                │
│       ▲        ▲         ▲         ▲              │
│       │        │         │         │              │
│  ┌────┴──┐ ┌──┴───┐ ┌───┴──┐ ┌───┴────┐        │
│  │  SAP  │ │Oracle│ │Softl.│ │Generic │        │
│  │Adapter│ │Adapt.│ │Adapt.│ │REST Ad.│        │
│  └───────┘ └──────┘ └──────┘ └────────┘        │
│                                                   │
└──────────────────────────────────────────────────┘
```

---

## 7. COMUNICACIÓN ENTRE SERVICIOS

### 7.1 Comunicación Síncrona

| Tipo | Uso | Protocolo |
|------|-----|-----------|
| Client → API | Todo request de usuario | HTTPS REST |
| API → Supabase DB | Queries y mutations | PostgreSQL protocol |
| API → Supabase Auth | Verificación de tokens | HTTPS |
| API → Supabase Storage | Upload/download archivos | HTTPS |

### 7.2 Comunicación Asíncrona

> **Decisión DR-009 (aprobada).** Dos mecanismos con criterio explícito de uso.
> Detalle en `DEPLOYMENT.md` §10.

| Tipo | Uso | Mecanismo | Fase |
|------|-----|-----------|------|
| API → Email de notificación | Envío best-effort | FastAPI BackgroundTasks | 0 |
| API → Audit event no crítico | Escritura diferida | FastAPI BackgroundTasks | 0 |
| API → Sync worker | Sincronización WMS | `JobDispatcher` → ARQ + Redis | 1 |
| API → Report worker | Generación de reportes | `JobDispatcher` → ARQ + Redis | 1 |
| API → Inference worker | Solicitudes de inferencia | `JobDispatcher` → ARQ + Redis | 2 |
| Worker → API | Resultados | Escritura directa a BD + domain event | 1 |
| API → Client | Eventos en tiempo real | Supabase Realtime (con RLS) | 1 |
| Scheduling recurrente | Cron de sync y reportes | ARQ cron jobs | 1 |

#### 7.2.1 Criterio de selección

| Usar BackgroundTasks si | Usar ARQ + Redis si |
|------------------------|---------------------|
| La tarea dura < 1 segundo | La tarea puede durar minutos |
| Perderla no tiene impacto | Perderla es inaceptable |
| No necesita reintentos | Necesita reintentos con backoff |
| No necesita visibilidad de estado | El usuario debe poder consultar el progreso |
| No necesita scheduling | Necesita ejecución programada |

`FastAPI BackgroundTasks` corre en el mismo proceso que la request y **se pierde si el
proceso muere**. No es una cola: es ejecución diferida sin garantías.

#### 7.2.2 Interfaz JobDispatcher

Definida desde Fase 0 para que el código de aplicación no dependa del mecanismo:

```python
# application/common/jobs.py
class IJobDispatcher(Protocol):
    async def dispatch(
        self,
        job_type: str,
        payload: dict[str, Any],
        *,
        tenant_id: TenantId,
        delay_seconds: int = 0,
        max_retries: int = 3,
    ) -> JobId: ...

    async def get_status(self, job_id: JobId) -> JobStatus: ...
    async def cancel(self, job_id: JobId) -> bool: ...
```

Implementaciones:

| Implementación | Cuándo | Estado |
|---------------|--------|--------|
| `InlineJobDispatcher` | Fase 0: ejecuta síncrono, útil para tests y dev | Sin Redis |
| `ARQJobDispatcher` | Fase 1+: encola en Redis, workers ARQ consumen | Requiere Redis |

**Redis no se instala hasta que exista el primer caso real que lo necesite** (primer
sync job de conector, Sprint 1.4). Hasta entonces `InlineJobDispatcher` es suficiente
y no añade infraestructura.

### 7.3 Arquitectura de Eventos

```
┌─────────────────────────────────────────────────────┐
│                 EVENT ARCHITECTURE                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  IN-PROCESS EVENTS (Fase 1-2)                        │
│  ├── Python asyncio event bus                        │
│  ├── Handlers registrados al startup                 │
│  └── Síncrono dentro del request                     │
│                                                      │
│  SUPABASE REALTIME (Fase 1+)                         │
│  ├── Broadcast de cambios a clientes                 │
│  ├── Presence para colaboración                      │
│  └── Postgres Changes para UI sync                   │
│                                                      │
│  EXTERNAL EVENTS (Fase 4+)                           │
│  ├── Webhooks para integraciones                     │
│  ├── Posible migración a RabbitMQ/Kafka              │
│  └── Event sourcing para dominos específicos         │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 8. SEGURIDAD EN LA ARQUITECTURA

### 8.1 Capas de Seguridad

```
┌─────────────────────────────────────────────────────┐
│              SECURITY LAYERS (Defense in Depth)       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Layer 1: EDGE                                       │
│  ├── DDoS protection (CloudFlare)                    │
│  ├── WAF rules                                       │
│  ├── TLS termination                                 │
│  └── IP whitelisting (opcional)                      │
│                                                      │
│  Layer 2: API GATEWAY                                │
│  ├── Rate limiting (por IP, por API key)             │
│  ├── Request size limits                             │
│  ├── CORS enforcement                                │
│  └── Security headers                                │
│                                                      │
│  Layer 3: AUTHENTICATION                             │
│  ├── JWT validation (Supabase Auth)                  │
│  ├── Token refresh mechanism                         │
│  ├── Session management                              │
│  └── MFA enforcement                                 │
│                                                      │
│  Layer 4: AUTHORIZATION                              │
│  ├── RBAC check (role → permissions)                 │
│  ├── ABAC rules (attributes, context)                │
│  ├── Module access verification                      │
│  └── Resource ownership validation                   │
│                                                      │
│  Layer 5: DATA                                       │
│  ├── RLS policies (PostgreSQL)                       │
│  ├── Column-level encryption                         │
│  ├── Input validation (Pydantic)                     │
│  └── Output sanitization                             │
│                                                      │
│  Layer 6: AUDIT                                      │
│  ├── Action logging                                  │
│  ├── Anomaly detection                               │
│  ├── Compliance reporting                            │
│  └── Data access tracking                            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 8.2 Flujo de Autenticación

```
┌──────────┐         ┌──────────┐         ┌──────────────┐
│  Client  │────────►│  Supabase│────────►│  PostgreSQL  │
│          │  Login  │  Auth    │  Store  │  (users)     │
│          │◄────────│         │◄────────│              │
│          │  JWT +  │         │         │              │
│          │  Refresh│         │         │              │
└──────┬───┘         └──────────┘         └──────────────┘
       │
       │ API Request + JWT
       ▼
┌──────────────┐
│ Auth         │─── Validate JWT signature
│ Middleware   │─── Check expiration
│              │─── Extract tenant_id, user_id, roles
│              │─── Set RLS context (SET LOCAL)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Permission   │─── Check RBAC (role has permission?)
│ Guard        │─── Check ABAC (attributes match policy?)
│              │─── Check resource ownership
└──────┬───────┘
       │
       ▼
  [Execute Request with RLS active]
```

---

## 9. ESTRATEGIA DE PERSISTENCIA

### 9.1 Esquema de Base de Datos

```
┌─────────────────────────────────────────────────────┐
│              DATABASE SCHEMA STRATEGY                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  SCHEMA: public                                      │
│  └── Tablas compartidas (migrations, configs)        │
│                                                      │
│  SCHEMA: core                                        │
│  ├── tenants                                         │
│  ├── companies                                       │
│  ├── warehouses                                      │
│  ├── users                                           │
│  ├── roles                                           │
│  └── permissions                                     │
│                                                      │
│  SCHEMA: inventory                                   │
│  ├── products                                        │
│  ├── stock_records                                   │
│  ├── counts                                          │
│  ├── adjustments                                     │
│  └── incidents                                       │
│                                                      │
│  SCHEMA: ai                                          │
│  ├── models                                          │
│  ├── datasets                                        │
│  ├── inferences                                      │
│  └── training_jobs                                   │
│                                                      │
│  SCHEMA: integrations                                │
│  ├── connectors                                      │
│  ├── sync_jobs                                       │
│  └── mappings                                        │
│                                                      │
│  SCHEMA: audit                                       │
│  ├── events                                          │
│  └── changes                                         │
│                                                      │
│  Todas las tablas tienen: tenant_id + RLS            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 9.2 Estrategia de Indexación

| Tipo de Índice | Uso | Ejemplos |
|----------------|-----|----------|
| Primary Key | Identidad | `id UUID` en todas las tablas |
| Tenant Index | Filtrado RLS | `tenant_id` en todas las tablas |
| Composite | Queries frecuentes | `(tenant_id, company_id)`, `(tenant_id, warehouse_id, product_id)` |
| Partial | Registros activos | `WHERE deleted_at IS NULL` |
| GIN | Full-text search | `product_name`, `description` |
| BRIN | Datos temporales | `created_at` en tablas de logs |

### 9.3 Estrategia de Migración

```
Alembic Migrations
├── Versionadas secuencialmente
├── Cada migración es reversible (up/down)
├── Backwards-compatible (zero downtime)
├── Testeadas antes de deploy
├── Separadas: schema changes vs data migrations
└── Naming: YYYYMMDD_HHMM_description.py
```

---

## 10. ESCALABILIDAD

### 10.1 Escalabilidad Horizontal

```
┌─────────────────────────────────────────────────────────┐
│            HORIZONTAL SCALING STRATEGY                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  STATELESS API SERVERS                                   │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐               │
│  │API-1 │  │API-2 │  │API-3 │  │API-N │               │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘               │
│     │         │         │         │                      │
│     └─────────┴─────────┴─────────┘                      │
│                    │                                      │
│            Load Balancer                                  │
│                    │                                      │
│     ┌──────────────┼──────────────┐                      │
│     ▼              ▼              ▼                       │
│  ┌──────┐    ┌──────────┐   ┌────────┐                  │
│  │Supabase│  │  Redis    │   │Storage │                  │
│  │  DB    │  │  Cache    │   │(S3)    │                  │
│  │(Pool)  │  │(Sessions) │   │        │                  │
│  └────────┘  └──────────┘   └────────┘                  │
│                                                          │
│  AI WORKERS (GPU)                                        │
│  ┌──────┐  ┌──────┐  ┌──────┐                          │
│  │GPU-1 │  │GPU-2 │  │GPU-N │                          │
│  └──┬───┘  └──┬───┘  └──┬───┘                          │
│     │         │         │                                │
│     └─────────┴─────────┘                                │
│              │                                           │
│         Task Queue                                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Estrategias de Cache

| Nivel | Tecnología | Datos | TTL |
|-------|-----------|-------|-----|
| CDN | CloudFlare | Assets estáticos | 1 año |
| API Response | Redis / In-memory | Queries frecuentes | 5-60 min |
| Database | PostgreSQL cache | Materialized views | Refresh periódico |
| Application | React Query | Server state | Stale-while-revalidate |
| Browser | Service Worker | Shell de la app | Indefinido |

### 10.3 Preparación para Microservicios

La arquitectura modular permite extraer servicios en el futuro:

```
MONOLITO MODULAR (Fases 0-2)          SERVICIOS (Fase 3+)
┌──────────────────────┐              ┌─────────┐ ┌─────────┐
│  Single FastAPI App  │              │Core API │ │AI Svc   │
│  ├── core module     │    ──►       │         │ │         │
│  ├── inventory module│              └─────────┘ └─────────┘
│  ├── ai module       │              ┌─────────┐ ┌─────────┐
│  ├── integration mod │              │Integ Svc│ │Stream Sv│
│  └── streaming mod   │              │         │ │         │
└──────────────────────┘              └─────────┘ └─────────┘
```

**Principio**: Empezar como monolito modular con boundaries claros. Extraer a servicios independientes cuando el volumen o la complejidad lo justifique.

---

## 11. MANEJO DE ERRORES

### 11.1 Estrategia de Errores

```
┌─────────────────────────────────────────────────────┐
│              ERROR HANDLING STRATEGY                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  DOMAIN ERRORS                                       │
│  ├── DomainError (base)                              │
│  ├── ValidationError                                 │
│  ├── BusinessRuleViolation                           │
│  ├── EntityNotFound                                  │
│  └── ConflictError                                   │
│       │                                              │
│       ▼ Mapped by Exception Handler                  │
│                                                      │
│  HTTP RESPONSES                                      │
│  ├── DomainError → 422 Unprocessable                 │
│  ├── ValidationError → 400 Bad Request               │
│  ├── EntityNotFound → 404 Not Found                  │
│  ├── ConflictError → 409 Conflict                    │
│  ├── AuthError → 401 Unauthorized                    │
│  ├── ForbiddenError → 403 Forbidden                  │
│  └── UnexpectedError → 500 Internal Server Error     │
│                                                      │
│  ERROR RESPONSE FORMAT                               │
│  {                                                   │
│    "error": {                                        │
│      "code": "WAREHOUSE_NOT_FOUND",                  │
│      "message": "Warehouse with id X not found",     │
│      "details": { ... },                             │
│      "trace_id": "abc-123"                           │
│    }                                                 │
│  }                                                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 11.2 Error Boundaries en Frontend

```
App
├── GlobalErrorBoundary (crash fatal → pantalla de error)
│   ├── AuthErrorBoundary (token expirado → redirect login)
│   │   ├── ModuleErrorBoundary (error en módulo → fallback por módulo)
│   │   │   └── ComponentErrorBoundary (error en componente → retry)
```

---

## 12. TESTING EN LA ARQUITECTURA

### 12.1 Pirámide de Tests

```
                    ┌───────┐
                    │  E2E  │  ← Pocos, lentos, alto valor
                   ┌┴───────┴┐
                   │Integration│  ← Moderados, flows críticos
                  ┌┴──────────┴┐
                  │   Unit      │  ← Muchos, rápidos, dominio
                 ┌┴─────────────┴┐
                 │   Static       │  ← TypeCheck, Lint, Format
                 └────────────────┘
```

### 12.2 Estrategia por Capa

| Capa | Tipo de Test | Herramienta | Qué se testea |
|------|-------------|-------------|---------------|
| Domain | Unit | pytest | Reglas de negocio, validaciones, eventos |
| Application | Unit + Integration | pytest + mocks | Use cases, orchestration |
| Infrastructure | Integration | pytest + testcontainers | Repos, DB queries, APIs externas |
| Presentation | Integration | pytest + httpx | Endpoints, auth, serialización |
| Frontend | Unit | Vitest + Testing Library | Components, hooks, utils |
| Frontend | E2E | Playwright | Flujos completos de usuario |

---

## 13. OBSERVABILIDAD

### 13.1 Tres Pilares

```
┌─────────────────────────────────────────────────────┐
│               OBSERVABILITY STACK                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  LOGS (Structured JSON)                              │
│  ├── Request/Response logging                        │
│  ├── Business event logging                          │
│  ├── Error logging with context                      │
│  └── Aggregation: Loki / CloudWatch                  │
│                                                      │
│  METRICS (Prometheus format)                         │
│  ├── Request count/latency (by endpoint)             │
│  ├── Error rate (by type)                            │
│  ├── Business metrics (inferencias, conteos)         │
│  ├── Resource utilization (CPU, memory, GPU)         │
│  └── Visualization: Grafana                          │
│                                                      │
│  TRACES (OpenTelemetry)                              │
│  ├── Request tracing across services                 │
│  ├── Database query tracing                          │
│  ├── External API call tracing                       │
│  └── Visualization: Jaeger / Tempo                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 14. DECISIONES ARQUITECTÓNICAS (ADR)

### ADR-001: Monolito Modular antes de Microservicios
- **Decisión**: Comenzar como monolito modular con boundaries de módulos claros.
- **Razón**: Equipo pequeño, velocidad de desarrollo, complejidad operacional reducida.
- **Consecuencia**: Los módulos deben comunicarse únicamente a través de interfaces. Nunca acceso directo entre módulos a nivel de repositorio.

### ADR-002: Supabase como Backend-as-a-Service
- **Decisión**: Usar Supabase para PostgreSQL, Auth, Storage y Realtime.
- **Razón**: Reduce carga operacional, RLS nativo, costo predecible, managed service.
- **Consecuencia**: Abstracción obligatoria sobre Supabase para permitir migración futura.

### ADR-003: Clean Architecture estricta
- **Decisión**: Implementar Clean Architecture con separación estricta de capas.
- **Razón**: Testabilidad, mantenibilidad, independencia de frameworks.
- **Consecuencia**: Más código boilerplate inicial, pero ganancia en calidad y evolución.

### ADR-004: CQRS Lite (sin event sourcing)
- **Decisión**: Separar commands y queries conceptualmente, misma DB.
- **Razón**: Beneficios de separación sin la complejidad de event sourcing.
- **Consecuencia**: Si un dominio requiere event sourcing futuro, se puede agregar sin afectar el resto.

### ADR-005: Async-First en Backend
- **Decisión**: Todas las operaciones de I/O son async (asyncio).
- **Razón**: Mejor throughput con FastAPI, no bloquear event loop.
- **Consecuencia**: Uso de SQLAlchemy async, httpx, aiofiles.

### ADR-006: Feature Modules en Frontend
- **Decisión**: Organizar frontend por features, no por tipo de archivo.
- **Razón**: Colocation, mejor navegabilidad, encapsulamiento.
- **Consecuencia**: Cada feature es self-contained con sus componentes, hooks, services y types.

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
