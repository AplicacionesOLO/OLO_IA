# OLO_IA - ESTRUCTURA DE CARPETAS

## 1. VISIÓN GENERAL

```
olo-ia/
├── .github/                    # GitHub Actions, templates
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── deploy-staging.yml
│   │   └── deploy-production.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
│
├── docs/                       # Documentación del proyecto
│   ├── VISION.md
│   ├── ARCHITECTURE.md
│   ├── API_DESIGN.md
│   ├── adr/                    # Architecture Decision Records
│   │   ├── 001-monolith-first.md
│   │   └── 002-supabase-backend.md
│   └── diagrams/
│
├── backend/                    # Backend Python (FastAPI)
│   ├── src/
│   ├── tests/
│   ├── alembic/
│   ├── requirements/
│   ├── pyproject.toml
│   └── Dockerfile
│
├── frontend/                   # Frontend React (Vite)
│   ├── src/
│   ├── public/
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── Dockerfile
│
├── ai-service/                 # Servicio de IA (separable)
│   ├── src/
│   ├── tests/
│   ├── models/                 # Local models para dev
│   ├── requirements/
│   └── Dockerfile
│
├── docker/                     # Configuraciones Docker
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── docker-compose.test.yml
│
├── infra/                      # Infrastructure as Code
│   ├── kubernetes/
│   ├── terraform/
│   └── scripts/
│
├── migrations/                 # Migraciones Alembic (fuente de verdad del schema)
│   ├── versions/
│   ├── env.py
│   ├── script.py.mako
│   └── alembic.ini
│
├── supabase/                   # Configuración Supabase (NO migraciones de dominio)
│   ├── config.toml             # Exposición de schemas a PostgREST
│   ├── hooks/                  # Custom Access Token Hook (PL/pgSQL)
│   └── seed.sql               # Solo catálogos globales (countries, currencies)
│
├── tests/                      # Tests que cruzan backend y frontend
│   ├── e2e/                    # Playwright: flujos completos de usuario
│   ├── rls/                    # Tests de aislamiento multi-tenant
│   └── fixtures/               # Datos compartidos entre suites
│
├── .env.example                # Versionado. Solo nombres y comentarios, NUNCA valores
├── .env.local                  # NO versionado. Valores reales de desarrollo local
├── .gitignore
├── Makefile
└── README.md
```

### 1.1 Reglas de organización de raíz

> **Decisión aprobada.** Separación explícita de responsabilidades en el nivel superior.

| Directorio | Responsabilidad | Versionado |
|-----------|----------------|-----------|
| `backend/` | Aplicación FastAPI (API + workers comparten código) | Sí |
| `frontend/` | Aplicación React | Sí |
| `workers/` | Puntos de entrada de workers (ver §1.3) | Sí |
| `migrations/` | Migraciones Alembic. **Única** fuente de verdad del schema | Sí |
| `supabase/` | Configuración de Supabase y hooks PL/pgSQL. **No** migraciones de dominio | Sí |
| `infra/` | Infrastructure as Code, scripts de despliegue | Sí |
| `tests/` | Tests cross-stack (E2E, RLS) | Sí |
| `docs/` | Documentación de arquitectura y decisiones | Sí |
| `docker/` | Dockerfiles y compose | Sí |

### 1.2 Variables de entorno

| Archivo | Ubicación | Versionado | Contenido |
|---------|-----------|-----------|-----------|
| `.env.example` | **Raíz** | **Sí** | Nombres de variables + comentarios explicativos. Cero valores reales |
| `.env.local` | **Raíz** | **No** (en `.gitignore`) | Valores reales para desarrollo local |

```gitignore
# .gitignore — entradas obligatorias
.env.local
.env.*.local
*.pem
*.key
!.env.example
```

`.env.example` es la documentación ejecutable de qué necesita el sistema para arrancar.
Un nuevo desarrollador lo copia a `.env.local` y rellena los valores.

### 1.3 Directorio de workers (preparado, sin implementar)

> **Decisión DR-009.** La estructura existe desde Fase 0. Las implementaciones llegan
> en Fase 1. En Fase 0 solo hay el `InlineJobDispatcher` y la estructura vacía con
> `__init__.py` y un README que explica el contrato.

```
workers/
├── README.md                   # Contrato de un worker, cómo agregar uno nuevo
├── __init__.py
│
├── base.py                     # BaseWorker: setup de contexto olo_app, logging, health
│
├── sync_worker/                # Fase 1 — vacío en Fase 0
│   ├── __init__.py
│   └── README.md               # "Implementación en Sprint 1.4"
│
├── report_worker/              # Fase 1 — vacío en Fase 0
│   ├── __init__.py
│   └── README.md
│
├── inference_worker/           # Fase 2 — vacío en Fase 0
│   ├── __init__.py
│   └── README.md
│
├── training_worker/            # Fase 2 — vacío en Fase 0
│   ├── __init__.py
│   └── README.md
│
└── stream_worker/              # Fase 3 — vacío en Fase 0
    ├── __init__.py
    └── README.md
```

**Contrato de un worker** (documentado en `workers/README.md`):

1. Se conecta con el rol `olo_app` (nunca `service_role`, nunca `authenticated`).
2. Establece contexto de tenant explícitamente antes de cualquier query
   (`MULTITENANT.md` §4.2.2, camino B).
3. Importa use cases de `backend/src/application/`, nunca repositorios directamente.
4. Expone un health check.
5. Es idempotente: reprocesar el mismo job no produce efectos duplicados.

**En Fase 0 no se implementa ningún worker.** Solo existe la estructura y el contrato.

---

## 2. BACKEND (Detalle)

```
backend/
├── src/
│   ├── __init__.py
│   ├── main.py                     # FastAPI app factory
│   ├── config.py                   # Settings (pydantic-settings)
│   │
│   ├── domain/                     # CAPA DE DOMINIO (sin dependencias externas)
│   │   ├── __init__.py
│   │   ├── common/                 # Shared domain objects
│   │   │   ├── __init__.py
│   │   │   ├── entity.py           # Base Entity class
│   │   │   ├── value_objects.py    # TenantId, UserId, etc.
│   │   │   ├── events.py           # Base DomainEvent
│   │   │   ├── exceptions.py       # Domain exceptions
│   │   │   └── repository.py       # IRepository protocol
│   │   │
│   │   ├── tenant/                 # Bounded Context: Tenant
│   │   │   ├── __init__.py
│   │   │   ├── entities.py         # Tenant, Company, Warehouse, Area, Location
│   │   │   ├── value_objects.py    # WarehouseCode, Address, etc.
│   │   │   ├── events.py           # TenantCreated, WarehouseActivated
│   │   │   ├── exceptions.py       # TenantNotFound, etc.
│   │   │   ├── repository.py       # IWarehouseRepository, etc.
│   │   │   └── services.py         # Domain services
│   │   │
│   │   ├── identity/               # Bounded Context: Identity & Access
│   │   │   ├── __init__.py
│   │   │   ├── entities.py         # User, Role
│   │   │   ├── value_objects.py    # Email, Permission
│   │   │   ├── events.py           # UserCreated, RoleAssigned
│   │   │   ├── exceptions.py
│   │   │   ├── repository.py
│   │   │   └── services.py         # PermissionEvaluator
│   │   │
│   │   ├── inventory/              # Bounded Context: Inventory
│   │   │   ├── __init__.py
│   │   │   ├── entities.py         # Product, StockRecord, Count, Adjustment
│   │   │   ├── value_objects.py    # SKU, Quantity, Barcode
│   │   │   ├── events.py           # StockAdjusted, CountCompleted
│   │   │   ├── exceptions.py
│   │   │   ├── repository.py
│   │   │   └── services.py         # ReconciliationService
│   │   │
│   │   ├── ai_engine/              # Bounded Context: AI
│   │   │   ├── __init__.py
│   │   │   ├── entities.py         # AIModel, Dataset, InferenceJob
│   │   │   ├── value_objects.py    # Detection, BoundingBox, Metrics
│   │   │   ├── events.py           # InferenceCompleted, ModelDeployed
│   │   │   ├── exceptions.py
│   │   │   ├── repository.py
│   │   │   └── interfaces.py       # IInferenceEngine, ITrainingEngine
│   │   │
│   │   ├── devices/                # Bounded Context: Devices & Drones
│   │   │   ├── __init__.py
│   │   │   ├── entities.py         # Device, DroneMission
│   │   │   ├── value_objects.py    # FlightRoute, TelemetryPoint
│   │   │   ├── events.py
│   │   │   ├── exceptions.py
│   │   │   └── repository.py
│   │   │
│   │   └── integration/            # Bounded Context: Integration
│   │       ├── __init__.py
│   │       ├── entities.py         # Connector, SyncJob
│   │       ├── value_objects.py
│   │       ├── events.py
│   │       ├── exceptions.py
│   │       ├── repository.py
│   │       └── interfaces.py       # IWMSConnector
│   │
│   ├── application/                # CAPA DE APLICACIÓN (Use Cases)
│   │   ├── __init__.py
│   │   ├── common/
│   │   │   ├── __init__.py
│   │   │   ├── dto.py              # Base DTO
│   │   │   ├── use_case.py         # Base UseCase
│   │   │   ├── unit_of_work.py     # IUnitOfWork protocol
│   │   │   ├── event_bus.py        # IEventBus protocol
│   │   │   └── jobs.py             # IJobDispatcher protocol (DR-009)
│   │   │
│   │   ├── tenant/
│   │   │   ├── __init__.py
│   │   │   ├── commands/           # CreateWarehouse, UpdateCompany
│   │   │   ├── queries/            # GetWarehouses, GetWarehouseById
│   │   │   └── dto.py              # WarehouseDTO, CompanyDTO
│   │   │
│   │   ├── identity/
│   │   │   ├── commands/           # InviteUser, AssignRole
│   │   │   ├── queries/            # GetUsers, GetUserById
│   │   │   └── dto.py
│   │   │
│   │   ├── inventory/
│   │   │   ├── commands/           # CreateCount, ApproveAdjustment
│   │   │   ├── queries/            # GetStockByLocation, GetCountResults
│   │   │   └── dto.py
│   │   │
│   │   ├── ai_engine/
│   │   │   ├── commands/           # RunInference, StartTraining
│   │   │   ├── queries/            # GetModels, GetInferenceResult
│   │   │   └── dto.py
│   │   │
│   │   └── integration/
│   │       ├── commands/           # CreateConnector, RunSync
│   │       ├── queries/            # GetConnectors, GetSyncStatus
│   │       └── dto.py
│   │
│   ├── infrastructure/             # CAPA DE INFRAESTRUCTURA
│   │   ├── __init__.py
│   │   ├── database/
│   │   │   ├── __init__.py
│   │   │   ├── session.py          # AsyncSession factory
│   │   │   ├── models/             # SQLAlchemy ORM models
│   │   │   │   ├── __init__.py
│   │   │   │   ├── core.py         # Tenant, Company, Warehouse models
│   │   │   │   ├── identity.py     # User, Role models
│   │   │   │   ├── inventory.py    # Product, Stock models
│   │   │   │   ├── ai.py           # Model, Dataset models
│   │   │   │   └── integration.py  # Connector, SyncJob models
│   │   │   ├── repositories/       # Repository implementations
│   │   │   │   ├── warehouse_repo.py
│   │   │   │   ├── user_repo.py
│   │   │   │   ├── product_repo.py
│   │   │   │   └── ...
│   │   │   └── unit_of_work.py     # SQLAlchemy UoW implementation
│   │   │
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   ├── supabase_auth.py    # Supabase Auth client
│   │   │   └── jwt_handler.py      # JWT validation
│   │   │
│   │   ├── storage/
│   │   │   ├── __init__.py
│   │   │   └── supabase_storage.py # File storage client
│   │   │
│   │   ├── ai_engines/             # Engine implementations
│   │   │   ├── __init__.py
│   │   │   ├── yolo_engine.py      # YOLO inference engine
│   │   │   ├── yolo_trainer.py     # YOLO training engine
│   │   │   └── registry.py         # Engine registry
│   │   │
│   │   ├── connectors/             # WMS connector implementations
│   │   │   ├── __init__.py
│   │   │   ├── sap_connector.py
│   │   │   ├── generic_rest.py
│   │   │   └── csv_connector.py
│   │   │
│   │   ├── jobs/                   # Implementaciones de IJobDispatcher (DR-009)
│   │   │   ├── __init__.py
│   │   │   ├── inline_dispatcher.py  # Fase 0: ejecuta síncrono, sin Redis
│   │   │   └── arq_dispatcher.py     # Fase 1: encola en Redis (NO en Fase 0)
│   │   │
│   │   ├── events/
│   │   │   ├── __init__.py
│   │   │   └── event_bus.py        # In-process event bus
│   │   │
│   │   └── external/
│   │       ├── __init__.py
│   │       ├── email.py            # Email service
│   │       └── realtime.py         # Supabase Realtime
│   │
│   └── presentation/               # CAPA DE PRESENTACIÓN (API)
│       ├── __init__.py
│       ├── dependencies.py          # FastAPI DI providers
│       ├── middleware/
│       │   ├── __init__.py
│       │   ├── auth.py              # Auth middleware
│       │   ├── tenant_context.py    # Tenant context middleware
│       │   ├── rate_limit.py        # Rate limiting
│       │   ├── cors.py              # CORS config
│       │   └── logging.py           # Request logging
│       │
│       ├── api/
│       │   ├── __init__.py
│       │   ├── v1/
│       │   │   ├── __init__.py
│       │   │   ├── router.py        # Main v1 router
│       │   │   ├── auth.py          # /v1/auth/*
│       │   │   ├── warehouses.py    # /v1/warehouses/*
│       │   │   ├── users.py         # /v1/users/*
│       │   │   ├── products.py      # /v1/products/*
│       │   │   ├── stock.py         # /v1/stock-records/*
│       │   │   ├── counts.py        # /v1/counts/*
│       │   │   ├── adjustments.py   # /v1/adjustments/*
│       │   │   ├── incidents.py     # /v1/incidents/*
│       │   │   ├── ai_models.py     # /v1/ai/models/*
│       │   │   ├── datasets.py      # /v1/ai/datasets/*
│       │   │   ├── inferences.py    # /v1/ai/inferences/*
│       │   │   ├── devices.py       # /v1/devices/*
│       │   │   ├── missions.py      # /v1/missions/*
│       │   │   ├── connectors.py    # /v1/connectors/*
│       │   │   ├── reports.py       # /v1/reports/*
│       │   │   └── audit.py         # /v1/audit/*
│       │   └── health.py            # /health, /ready
│       │
│       ├── schemas/                  # Pydantic request/response schemas
│       │   ├── __init__.py
│       │   ├── common.py            # Pagination, Error schemas
│       │   ├── auth.py
│       │   ├── warehouse.py
│       │   ├── user.py
│       │   ├── product.py
│       │   ├── inventory.py
│       │   ├── ai.py
│       │   └── integration.py
│       │
│       └── exception_handlers.py    # Global exception → HTTP mapping
│
├── tests/
│   ├── __init__.py
│   ├── conftest.py                  # Shared fixtures
│   ├── unit/
│   │   ├── domain/                  # Domain entity tests
│   │   └── application/             # Use case tests (mocked repos)
│   ├── integration/
│   │   ├── repositories/            # Repo tests with real DB
│   │   ├── api/                     # Endpoint tests
│   │   └── rls/                     # RLS isolation tests
│   └── e2e/                         # Full flow tests
│
│   (Las migraciones NO viven aquí: están en /migrations en la raíz)
│
├── requirements/
│   ├── base.txt                     # Core dependencies
│   ├── prod.txt                     # Production (includes base)
│   ├── dev.txt                      # Development tools
│   ├── test.txt                     # Test dependencies
│   └── ai.txt                       # AI service dependencies
│
└── pyproject.toml                   # Project config (ruff, mypy, pytest)
```

---

## 3. FRONTEND (Detalle)

```
frontend/
├── src/
│   ├── main.tsx                     # Entry point
│   ├── App.tsx                      # Root component + providers
│   ├── router.tsx                   # Route definitions
│   │
│   ├── app/                         # App-level configuration
│   │   ├── providers.tsx            # React Query, Theme, Auth providers
│   │   ├── queryClient.ts           # React Query config
│   │   └── constants.ts             # Global constants
│   │
│   ├── shared/                      # Shared across all features
│   │   ├── ui/                      # Design system components
│   │   │   ├── Button/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Button.test.tsx
│   │   │   │   └── index.ts
│   │   │   ├── Input/
│   │   │   ├── Modal/
│   │   │   ├── Table/
│   │   │   ├── Card/
│   │   │   ├── Badge/
│   │   │   ├── Toast/
│   │   │   ├── Sidebar/
│   │   │   ├── Header/
│   │   │   └── index.ts            # Barrel export
│   │   │
│   │   ├── hooks/                   # Shared hooks
│   │   │   ├── useAuth.ts
│   │   │   ├── useDebounce.ts
│   │   │   ├── useLocalStorage.ts
│   │   │   └── usePagination.ts
│   │   │
│   │   ├── utils/                   # Utility functions
│   │   │   ├── format.ts            # Date, number formatting
│   │   │   ├── validation.ts
│   │   │   └── cn.ts                # Tailwind class merge
│   │   │
│   │   ├── types/                   # Shared TypeScript types
│   │   │   ├── api.ts               # API response types
│   │   │   ├── auth.ts
│   │   │   └── common.ts
│   │   │
│   │   └── lib/                     # Configured libraries
│   │       ├── api-client.ts        # Axios/fetch configured
│   │       └── supabase.ts          # Supabase client
│   │
│   ├── features/                    # Feature modules
│   │   ├── auth/
│   │   │   ├── components/          # LoginForm, RegisterForm
│   │   │   ├── hooks/               # useLogin, useRegister
│   │   │   ├── services/            # authService
│   │   │   ├── store/               # authStore (Zustand)
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   │
│   │   ├── dashboard/
│   │   │   ├── components/          # KPICard, ActivityFeed, AlertPanel
│   │   │   ├── hooks/               # useDashboardStats
│   │   │   └── index.ts
│   │   │
│   │   ├── warehouses/
│   │   │   ├── components/          # WarehouseList, WarehouseForm
│   │   │   ├── hooks/               # useWarehouses, useCreateWarehouse
│   │   │   ├── services/            # warehouseService
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   │
│   │   ├── inventory/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   │
│   │   ├── ai/
│   │   │   ├── components/          # ModelList, InferenceResult
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   └── index.ts
│   │   │
│   │   ├── devices/
│   │   ├── integrations/
│   │   ├── reports/
│   │   ├── audit/
│   │   └── settings/
│   │
│   ├── layouts/                     # Page layouts
│   │   ├── MainLayout.tsx           # Sidebar + Header + Content
│   │   ├── AuthLayout.tsx           # Centered card layout
│   │   └── FullScreenLayout.tsx     # For maps, digital twin
│   │
│   ├── pages/                       # Route page components
│   │   ├── DashboardPage.tsx
│   │   ├── WarehousesPage.tsx
│   │   ├── WarehouseDetailPage.tsx
│   │   ├── InventoryPage.tsx
│   │   ├── CountsPage.tsx
│   │   ├── AIModelsPage.tsx
│   │   ├── LoginPage.tsx
│   │   └── NotFoundPage.tsx
│   │
│   └── stores/                      # Global Zustand stores
│       ├── authStore.ts
│       ├── tenantStore.ts
│       ├── uiStore.ts               # Sidebar, theme, modals
│       └── notificationStore.ts
│
├── public/
│   ├── favicon.ico
│   └── locales/                     # i18n translation files
│       ├── es/
│       ├── en/
│       └── pt/
│
├── tests/
│   ├── setup.ts
│   ├── unit/
│   └── e2e/
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── eslint.config.js
└── vitest.config.ts
```

---

## 4. REGLAS DE ORGANIZACIÓN

| Regla | Descripción |
|-------|-------------|
| Feature-first | Frontend organizado por features, no por tipo de archivo |
| Layer-first | Backend organizado por capas (domain → application → infrastructure) |
| Colocation | Tests junto al código que testean (frontend) o en /tests mirror (backend) |
| Barrel exports | Cada carpeta con index.ts/\_\_init\_\_.py para public API |
| No circular imports | Dependencias fluyen: presentation → application → domain |
| One file, one purpose | Cada archivo tiene una responsabilidad clara |
| Naming convention | PascalCase para componentes, camelCase para funciones, snake_case para Python |

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
