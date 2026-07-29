# OLO_IA - MODELO DE DOMINIO

## 1. INTRODUCCIÓN

Este documento define el modelo de dominio de OLO_IA utilizando los patrones tácticos de Domain-Driven Design (DDD). Define las entidades, value objects, aggregates, domain events y bounded contexts que conforman el núcleo de negocio de la plataforma.

### 1.1 Convenciones

| Símbolo | Significado |
|---------|-------------|
| **[E]** | Entity (tiene identidad) |
| **[VO]** | Value Object (inmutable, sin identidad) |
| **[AG]** | Aggregate Root |
| **[DE]** | Domain Event |
| **[DS]** | Domain Service |
| **[R]** | Repository Interface |

---

## 2. BOUNDED CONTEXTS

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OLO_IA BOUNDED CONTEXTS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   IDENTITY   │  │  TENANT      │  │  INVENTORY   │  │  AI ENGINE   │   │
│  │   & ACCESS   │  │  MANAGEMENT  │  │  MANAGEMENT  │  │              │   │
│  │              │  │              │  │              │  │              │   │
│  │ • Users      │  │ • Countries  │  │ • Products   │  │ • Models     │   │
│  │ • Auth       │  │ • Companies  │  │ • Stock      │  │ • Datasets   │   │
│  │ • Roles      │  │ • Warehouses │  │ • Counts     │  │ • Inference  │   │
│  │ • Permissions│  │ • Areas      │  │ • Adjustments│  │ • Training   │   │
│  │ • Sessions   │  │ • Locations  │  │ • Incidents  │  │ • Engines    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  DEVICES &   │  │  SPATIAL     │  │ INTEGRATION  │  │  REPORTING   │   │
│  │  DRONES      │  │              │  │              │  │  & ANALYTICS │   │
│  │              │  │              │  │              │  │              │   │
│  │ • Devices    │  │ • Floor Plans│  │ • Connectors │  │ • Reports    │   │
│  │ • Missions   │  │ • Maps       │  │ • Sync Jobs  │  │ • Dashboards │   │
│  │ • Telemetry  │  │ • Digital    │  │ • Mappings   │  │ • KPIs       │   │
│  │ • Streaming  │  │   Twin       │  │ • Transforms │  │ • Schedules  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐                                         │
│  │  AUDIT &     │  │  LICENSING   │                                         │
│  │  COMPLIANCE  │  │  & BILLING   │                                         │
│  │              │  │              │                                         │
│  │ • Events     │  │ • Plans      │                                         │
│  │ • Changes    │  │ • Subscript. │                                         │
│  │ • Alerts     │  │ • Usage      │                                         │
│  │              │  │ • Invoices   │                                         │
│  └──────────────┘  └──────────────┘                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Context Map (Relaciones entre Bounded Contexts)

```
┌────────────────────────────────────────────────────────────────┐
│                      CONTEXT MAP                                │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Identity & Access ──[U/D]──► Tenant Management                 │
│       │                            │                            │
│       │ [U/D]                      │ [U/D]                      │
│       ▼                            ▼                            │
│  Inventory Management ◄──[CF]──► Integration                    │
│       │                            │                            │
│       │ [U/D]                      │ [CF]                       │
│       ▼                            ▼                            │
│  AI Engine ───────────[U/D]──► Devices & Drones                 │
│       │                            │                            │
│       │ [U/D]                      │ [U/D]                      │
│       ▼                            ▼                            │
│  Reporting ◄──────────[CF]──── Spatial                          │
│                                                                 │
│  Audit & Compliance ◄──[PS]──── ALL CONTEXTS                    │
│  Licensing & Billing ◄──[PS]──── ALL CONTEXTS                   │
│                                                                 │
│  Leyenda:                                                       │
│  [U/D] = Upstream/Downstream                                    │
│  [CF]  = Conformist                                             │
│  [PS]  = Published Subscriber                                   │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. BOUNDED CONTEXT: IDENTITY & ACCESS

### 3.1 Aggregates

#### [AG] User

```
User (Aggregate Root)
├── Properties
│   ├── id: UserId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── email: Email [VO]
│   ├── full_name: PersonName [VO]
│   ├── avatar_url: Optional[URL]
│   ├── status: UserStatus [VO] (active, inactive, suspended, pending)
│   ├── locale: Locale [VO]
│   ├── timezone: Timezone [VO]
│   ├── last_login_at: Optional[datetime]
│   ├── failed_login_attempts: int
│   ├── locked_until: Optional[datetime]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Relationships
│   ├── role_assignments: List[RoleAssignment] [E]
│   └── sessions: List[Session] [E]
│
├── Behaviors
│   ├── activate() → UserActivated [DE]
│   ├── suspend(reason) → UserSuspended [DE]
│   ├── assign_role(role, scope) → RoleAssigned [DE]
│   ├── revoke_role(role, scope) → RoleRevoked [DE]
│   ├── record_login() → UserLoggedIn [DE]
│   ├── record_failed_login() → LoginFailed [DE]
│   ├── lock(duration) → UserLocked [DE]
│   ├── unlock() → UserUnlocked [DE]
│   └── update_profile(name, locale, tz) → ProfileUpdated [DE]
│
└── Invariants
    ├── Email must be unique within tenant
    ├── Cannot assign same role twice for same scope
    ├── Cannot activate an already active user
    ├── Failed attempts reset on successful login
    └── Locked user cannot login
```

#### [AG] Role

```
Role (Aggregate Root)
├── Properties
│   ├── id: RoleId [VO]
│   ├── tenant_id: Optional[TenantId] [VO] (null = system role)
│   ├── name: str
│   ├── description: str
│   ├── is_system: bool (predefined, non-editable)
│   ├── parent_role_id: Optional[RoleId]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Relationships
│   └── permissions: List[Permission] [VO]
│
├── Behaviors
│   ├── add_permission(module, action, resource) → PermissionAdded [DE]
│   ├── remove_permission(permission) → PermissionRemoved [DE]
│   ├── rename(name) → RoleRenamed [DE]
│   └── inherit_from(parent_role) → RoleInheritanceSet [DE]
│
└── Invariants
    ├── System roles cannot be modified
    ├── Cannot create circular inheritance
    ├── Role name unique within tenant
    └── Cannot delete role with active assignments
```

### 3.2 Value Objects

```
Email
├── value: str
├── Validation: RFC 5322 format
└── Immutable

PersonName
├── first_name: str
├── last_name: str
├── display_name: str (computed)
└── Immutable

Permission
├── module: ModuleName (enum)
├── action: ActionType (enum: create, read, update, delete, execute)
├── resource: Optional[str] (specific resource type)
├── conditions: Optional[Dict] (ABAC attributes)
└── Immutable

RoleAssignment
├── role_id: RoleId
├── scope: AssignmentScope [VO]
├── assigned_at: datetime
├── assigned_by: UserId
└── Entity (has identity within User aggregate)

AssignmentScope
├── type: ScopeType (global, company, warehouse)
├── company_id: Optional[CompanyId]
├── warehouse_id: Optional[WarehouseId]
└── Immutable
```

### 3.3 Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| UserCreated | Nuevo usuario registrado | user_id, tenant_id, email |
| UserActivated | Usuario activado | user_id |
| UserSuspended | Usuario suspendido | user_id, reason |
| UserLocked | Cuenta bloqueada | user_id, locked_until |
| UserLoggedIn | Login exitoso | user_id, ip, user_agent |
| LoginFailed | Login fallido | email, ip, attempt_count |
| RoleAssigned | Rol asignado a usuario | user_id, role_id, scope |
| RoleRevoked | Rol removido de usuario | user_id, role_id, scope |
| PermissionAdded | Permiso agregado a rol | role_id, permission |
| PasswordChanged | Contraseña cambiada | user_id |

---

## 4. BOUNDED CONTEXT: TENANT MANAGEMENT

### 4.1 Aggregates

#### [AG] Tenant

```
Tenant (Aggregate Root)
├── Properties
│   ├── id: TenantId [VO]
│   ├── name: str
│   ├── slug: TenantSlug [VO]
│   ├── status: TenantStatus (active, suspended, trial, cancelled)
│   ├── plan: PlanType [VO]
│   ├── settings: TenantSettings [VO]
│   ├── limits: TenantLimits [VO]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── activate() → TenantActivated [DE]
│   ├── suspend(reason) → TenantSuspended [DE]
│   ├── update_plan(plan) → PlanChanged [DE]
│   ├── update_settings(settings) → SettingsUpdated [DE]
│   └── check_limits() → bool
│
└── Invariants
    ├── Slug must be globally unique
    ├── Cannot exceed plan limits
    └── Suspended tenant blocks all operations
```

#### [AG] Company

```
Company (Aggregate Root)
├── Properties
│   ├── id: CompanyId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── country_id: CountryId [VO]
│   ├── name: str
│   ├── legal_name: str
│   ├── tax_id: TaxIdentifier [VO]
│   ├── logo_url: Optional[URL]
│   ├── status: CompanyStatus (active, inactive)
│   ├── settings: CompanySettings [VO]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── activate() → CompanyActivated [DE]
│   ├── deactivate() → CompanyDeactivated [DE]
│   ├── update_info(name, legal_name, tax_id)
│   └── update_settings(settings) → SettingsUpdated [DE]
│
└── Invariants
    ├── Tax ID unique within country
    ├── Cannot deactivate with active warehouses
    └── Must belong to an active tenant
```

#### [AG] Warehouse

```
Warehouse (Aggregate Root)
├── Properties
│   ├── id: WarehouseId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── company_id: CompanyId [VO]
│   ├── name: str
│   ├── code: WarehouseCode [VO]
│   ├── address: Address [VO]
│   ├── coordinates: GeoCoordinates [VO]
│   ├── timezone: Timezone [VO]
│   ├── locale: Locale [VO]
│   ├── currency: Currency [VO]
│   ├── status: WarehouseStatus (active, inactive, maintenance)
│   ├── settings: WarehouseSettings [VO]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Relationships
│   └── areas: List[Area] [E]
│
├── Behaviors
│   ├── activate() → WarehouseActivated [DE]
│   ├── deactivate() → WarehouseDeactivated [DE]
│   ├── enter_maintenance() → MaintenanceStarted [DE]
│   ├── add_area(name, type) → AreaAdded [DE]
│   ├── remove_area(area_id) → AreaRemoved [DE]
│   └── update_settings(settings) → SettingsUpdated [DE]
│
└── Invariants
    ├── Code unique within company
    ├── Cannot deactivate with active counts in progress
    ├── Cannot remove area with stock
    └── Must belong to active company
```

#### [E] Area (within Warehouse aggregate)

```
Area (Entity)
├── Properties
│   ├── id: AreaId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── name: str
│   ├── code: AreaCode [VO]
│   ├── type: AreaType (receiving, storage, picking, shipping, staging)
│   ├── status: AreaStatus (active, inactive)
│   ├── capacity: Optional[Capacity] [VO]
│   └── metadata: Dict
│
├── Relationships
│   └── locations: List[Location] [E]
│
├── Behaviors
│   ├── add_location(code, type, capacity) → LocationAdded [DE]
│   ├── remove_location(location_id) → LocationRemoved [DE]
│   ├── activate() → AreaActivated [DE]
│   └── deactivate() → AreaDeactivated [DE]
│
└── Invariants
    ├── Code unique within warehouse
    ├── Cannot remove location with stock
    └── Total locations cannot exceed area capacity
```

#### [E] Location (within Area)

```
Location (Entity)
├── Properties
│   ├── id: LocationId [VO]
│   ├── area_id: AreaId [VO]
│   ├── code: LocationCode [VO]
│   ├── type: LocationType (rack, shelf, bin, floor, dock)
│   ├── level: Optional[int]
│   ├── position: Optional[Position] [VO]
│   ├── capacity: Capacity [VO]
│   ├── status: LocationStatus (available, occupied, blocked, reserved)
│   ├── coordinates_on_plan: Optional[PlanCoordinates] [VO]
│   └── metadata: Dict
│
└── Invariants
    ├── Code unique within area
    ├── Cannot block location during active count
    └── Status transitions follow state machine
```

### 4.2 Value Objects

```
TenantId / CompanyId / WarehouseId / AreaId / LocationId
├── value: UUID
└── Validation: valid UUID v4

WarehouseCode / AreaCode / LocationCode
├── value: str
├── Validation: alphanumeric, max 20 chars, uppercase
└── Immutable

Address
├── street: str
├── city: str
├── state: str
├── postal_code: str
├── country_code: str
└── Immutable

GeoCoordinates
├── latitude: float (-90 to 90)
├── longitude: float (-180 to 180)
└── Immutable

Timezone
├── value: str (IANA timezone)
├── Validation: valid IANA timezone
└── Immutable

Currency
├── code: str (ISO 4217)
├── symbol: str
├── decimal_places: int
└── Immutable

Capacity
├── max_units: Optional[int]
├── max_weight_kg: Optional[float]
├── max_volume_m3: Optional[float]
└── Immutable

TenantSettings
├── default_locale: Locale
├── default_timezone: Timezone
├── default_currency: Currency
├── branding: BrandingConfig
├── security_policy: SecurityPolicy
└── Immutable

TenantLimits
├── max_users: int
├── max_warehouses: int
├── max_storage_gb: int
├── max_inferences_month: int
├── max_api_calls_month: int
└── Immutable
```

---

## 5. BOUNDED CONTEXT: INVENTORY MANAGEMENT

### 5.1 Aggregates

#### [AG] Product

```
Product (Aggregate Root)
├── Properties
│   ├── id: ProductId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── sku: SKU [VO]
│   ├── name: str
│   ├── description: Optional[str]
│   ├── category: ProductCategory [VO]
│   ├── unit_of_measure: UnitOfMeasure [VO]
│   ├── alternative_uoms: List[UOMConversion] [VO]
│   ├── weight_kg: Optional[float]
│   ├── volume_m3: Optional[float]
│   ├── barcode: Optional[Barcode] [VO]
│   ├── image_urls: List[URL]
│   ├── attributes: Dict[str, Any] (custom fields)
│   ├── status: ProductStatus (active, discontinued, pending)
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── update_info(name, description, category)
│   ├── add_barcode(barcode) → BarcodeAdded [DE]
│   ├── discontinue() → ProductDiscontinued [DE]
│   └── reactivate() → ProductReactivated [DE]
│
└── Invariants
    ├── SKU unique within tenant
    ├── Barcode unique within tenant
    ├── Cannot discontinue product with active stock > 0 (warning only)
    └── At least one UOM required
```

#### [AG] StockRecord

```
StockRecord (Aggregate Root)
├── Properties
│   ├── id: StockRecordId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── location_id: LocationId [VO]
│   ├── product_id: ProductId [VO]
│   ├── quantity: Quantity [VO]
│   ├── lot_number: Optional[LotNumber] [VO]
│   ├── serial_number: Optional[SerialNumber] [VO]
│   ├── expiration_date: Optional[date]
│   ├── status: StockStatus (available, reserved, damaged, quarantine)
│   ├── last_counted_at: Optional[datetime]
│   ├── last_movement_at: Optional[datetime]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── adjust(new_quantity, reason) → StockAdjusted [DE]
│   ├── reserve(quantity) → StockReserved [DE]
│   ├── release(quantity) → StockReleased [DE]
│   ├── move_to(new_location) → StockMoved [DE]
│   ├── mark_damaged(quantity, reason) → StockDamaged [DE]
│   ├── quarantine(reason) → StockQuarantined [DE]
│   └── record_count(counted_quantity) → StockCounted [DE]
│
└── Invariants
    ├── Quantity cannot be negative
    ├── Reserved quantity cannot exceed available
    ├── Serial number unique within tenant (if present)
    ├── Cannot move stock in quarantine status
    └── Adjustment requires reason
```

#### [AG] InventoryCount

```
InventoryCount (Aggregate Root)
├── Properties
│   ├── id: CountId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── type: CountType (full, cyclic, zone, spot)
│   ├── status: CountStatus (planned, in_progress, completed, cancelled)
│   ├── scope: CountScope [VO]
│   ├── assigned_to: List[UserId]
│   ├── started_at: Optional[datetime]
│   ├── completed_at: Optional[datetime]
│   ├── created_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Relationships
│   └── items: List[CountItem] [E]
│
├── Behaviors
│   ├── start() → CountStarted [DE]
│   ├── add_count_result(location, product, qty) → CountResultRecorded [DE]
│   ├── complete() → CountCompleted [DE]
│   ├── cancel(reason) → CountCancelled [DE]
│   ├── calculate_discrepancies() → List[Discrepancy] [VO]
│   └── generate_adjustments() → List[AdjustmentRequest]
│
└── Invariants
    ├── Cannot start already started count
    ├── Cannot add results to non-started count
    ├── Cannot complete without at least one result
    ├── Items must belong to count scope (warehouse/zone)
    └── Cannot modify completed or cancelled count
```

#### [E] CountItem (within InventoryCount)

```
CountItem (Entity)
├── Properties
│   ├── id: CountItemId [VO]
│   ├── location_id: LocationId [VO]
│   ├── product_id: ProductId [VO]
│   ├── system_quantity: Quantity [VO] (at time of count)
│   ├── counted_quantity: Optional[Quantity] [VO]
│   ├── discrepancy: Optional[Quantity] [VO] (computed)
│   ├── counted_by: Optional[UserId]
│   ├── counted_at: Optional[datetime]
│   ├── source: CountSource (manual, drone, camera)
│   ├── evidence_urls: List[URL] (photos)
│   └── notes: Optional[str]
│
└── Computed
    └── discrepancy = counted_quantity - system_quantity
```

#### [AG] InventoryAdjustment

```
InventoryAdjustment (Aggregate Root)
├── Properties
│   ├── id: AdjustmentId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── count_id: Optional[CountId] [VO] (if from count)
│   ├── type: AdjustmentType (increase, decrease, correction)
│   ├── reason: AdjustmentReason [VO]
│   ├── status: AdjustmentStatus (pending, approved, rejected, applied)
│   ├── items: List[AdjustmentItem] [E]
│   ├── requires_approval: bool
│   ├── approved_by: Optional[UserId]
│   ├── approved_at: Optional[datetime]
│   ├── created_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── submit() → AdjustmentSubmitted [DE]
│   ├── approve(user) → AdjustmentApproved [DE]
│   ├── reject(user, reason) → AdjustmentRejected [DE]
│   ├── apply() → AdjustmentApplied [DE]
│   └── cancel(reason) → AdjustmentCancelled [DE]
│
└── Invariants
    ├── Cannot approve own adjustment (if requires_approval)
    ├── Cannot apply without approval (if requires_approval)
    ├── Cannot modify after applied
    └── Net adjustment must not make stock negative
```

#### [AG] Incident

```
Incident (Aggregate Root)
├── Properties
│   ├── id: IncidentId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── location_id: Optional[LocationId] [VO]
│   ├── product_id: Optional[ProductId] [VO]
│   ├── type: IncidentType (shortage, surplus, damage, misplace, expiry)
│   ├── severity: Severity (low, medium, high, critical)
│   ├── status: IncidentStatus (open, investigating, resolved, closed)
│   ├── description: str
│   ├── evidence_urls: List[URL]
│   ├── detected_by: DetectionSource [VO] (manual, ai, drone, count)
│   ├── assigned_to: Optional[UserId]
│   ├── resolution: Optional[str]
│   ├── resolved_at: Optional[datetime]
│   ├── created_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── assign(user) → IncidentAssigned [DE]
│   ├── escalate(severity) → IncidentEscalated [DE]
│   ├── resolve(resolution) → IncidentResolved [DE]
│   ├── close() → IncidentClosed [DE]
│   └── reopen(reason) → IncidentReopened [DE]
│
└── Invariants
    ├── Cannot resolve without resolution text
    ├── Cannot close unresolved incident
    ├── Cannot escalate beyond critical
    └── Resolved incidents auto-close after configurable period
```

### 5.2 Value Objects (Inventory)

```
SKU
├── value: str
├── Validation: alphanumeric + dashes, 3-50 chars
└── Immutable

Quantity
├── value: Decimal
├── unit: UnitOfMeasure
├── Validation: >= 0 (or configurable)
└── Immutable, supports arithmetic

LotNumber
├── value: str
├── Validation: non-empty, max 50 chars
└── Immutable

Barcode
├── value: str
├── type: BarcodeType (EAN13, EAN8, UPC, CODE128, QR)
└── Immutable

CountScope
├── scope_type: ScopeType (full_warehouse, zone, area, locations)
├── area_ids: Optional[List[AreaId]]
├── location_ids: Optional[List[LocationId]]
└── Immutable

AdjustmentReason
├── code: str
├── description: str
├── requires_evidence: bool
└── Immutable

Discrepancy
├── expected: Quantity
├── actual: Quantity
├── difference: Quantity (computed)
├── percentage: float (computed)
└── Immutable

DetectionSource
├── type: SourceType (manual, ai_inference, drone_mission, scheduled_count)
├── reference_id: Optional[str] (inference_id, mission_id, count_id)
└── Immutable
```

---

## 6. BOUNDED CONTEXT: AI ENGINE

### 6.1 Aggregates

#### [AG] AIModel

```
AIModel (Aggregate Root)
├── Properties
│   ├── id: ModelId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── engine_type: EngineType (yolo, grounding_dino, sam, custom)
│   ├── name: str
│   ├── version: ModelVersion [VO]
│   ├── architecture: str (yolov8n, yolov8s, yolov8m, etc.)
│   ├── task: ModelTask (detection, segmentation, classification)
│   ├── classes: List[ObjectClass] [VO]
│   ├── metrics: ModelMetrics [VO]
│   ├── file_path: StoragePath [VO]
│   ├── file_size_bytes: int
│   ├── status: ModelStatus (training, ready, deployed, archived)
│   ├── deployed_at: Optional[datetime]
│   ├── training_job_id: Optional[TrainingJobId]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── deploy() → ModelDeployed [DE]
│   ├── undeploy() → ModelUndeployed [DE]
│   ├── archive() → ModelArchived [DE]
│   ├── update_metrics(metrics) → MetricsUpdated [DE]
│   └── compare_with(other_model) → ComparisonResult
│
└── Invariants
    ├── Only one model per engine_type deployed per tenant at a time
    ├── Cannot deploy model in training status
    ├── Cannot archive deployed model
    └── Version must be incremental
```

#### [AG] Dataset

```
Dataset (Aggregate Root)
├── Properties
│   ├── id: DatasetId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── name: str
│   ├── description: Optional[str]
│   ├── version: DatasetVersion [VO]
│   ├── classes: List[ObjectClass] [VO]
│   ├── split: DatasetSplit [VO] (train/val/test ratios)
│   ├── statistics: DatasetStatistics [VO]
│   ├── format: DatasetFormat (yolo, coco, voc)
│   ├── status: DatasetStatus (building, ready, archived)
│   ├── image_count: int
│   ├── annotation_count: int
│   ├── storage_path: StoragePath [VO]
│   ├── created_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Relationships
│   └── images: List[DatasetImage] [E]
│
├── Behaviors
│   ├── add_images(images) → ImagesAdded [DE]
│   ├── remove_images(image_ids) → ImagesRemoved [DE]
│   ├── annotate(image_id, annotations) → ImageAnnotated [DE]
│   ├── finalize() → DatasetFinalized [DE]
│   ├── split_dataset(train, val, test) → DatasetSplit [DE]
│   ├── export(format) → DatasetExported [DE]
│   └── archive() → DatasetArchived [DE]
│
└── Invariants
    ├── Cannot finalize with < 10 images
    ├── Cannot train with unbalanced classes (warning)
    ├── Split ratios must sum to 1.0
    ├── Cannot modify finalized dataset (create new version)
    └── All images must have annotations to finalize
```

#### [AG] InferenceJob

```
InferenceJob (Aggregate Root)
├── Properties
│   ├── id: InferenceId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── model_id: ModelId [VO]
│   ├── type: InferenceType (single_image, batch, video, stream)
│   ├── input: InferenceInput [VO]
│   ├── config: InferenceConfig [VO]
│   ├── status: JobStatus (queued, processing, completed, failed)
│   ├── progress: Progress [VO]
│   ├── results: Optional[List[Detection]] [VO]
│   ├── metrics: Optional[InferenceMetrics] [VO]
│   ├── error: Optional[str]
│   ├── started_at: Optional[datetime]
│   ├── completed_at: Optional[datetime]
│   ├── requested_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── start() → InferenceStarted [DE]
│   ├── update_progress(percent) → ProgressUpdated [DE]
│   ├── complete(results) → InferenceCompleted [DE]
│   ├── fail(error) → InferenceFailed [DE]
│   └── cancel() → InferenceCancelled [DE]
│
└── Invariants
    ├── Cannot start without deployed model
    ├── Cannot process without valid input
    ├── Progress must be monotonically increasing
    └── Completed job must have results
```

#### [AG] TrainingJob

```
TrainingJob (Aggregate Root)
├── Properties
│   ├── id: TrainingJobId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── dataset_id: DatasetId [VO]
│   ├── base_model_id: Optional[ModelId] (transfer learning)
│   ├── config: TrainingConfig [VO]
│   ├── status: JobStatus (queued, training, completed, failed)
│   ├── progress: TrainingProgress [VO]
│   ├── result_model_id: Optional[ModelId]
│   ├── logs: List[TrainingLog] [E]
│   ├── started_at: Optional[datetime]
│   ├── completed_at: Optional[datetime]
│   ├── requested_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── start() → TrainingStarted [DE]
│   ├── update_progress(epoch, metrics) → EpochCompleted [DE]
│   ├── complete(model) → TrainingCompleted [DE]
│   ├── fail(error) → TrainingFailed [DE]
│   └── cancel() → TrainingCancelled [DE]
│
└── Invariants
    ├── Dataset must be finalized
    ├── Cannot start two trainings simultaneously (per tenant)
    ├── Config must have valid hyperparameters
    └── Completed training must produce a model
```

### 6.2 Value Objects (AI)

```
Detection
├── class_name: str
├── confidence: float (0.0 - 1.0)
├── bounding_box: BoundingBox [VO]
├── mask: Optional[SegmentationMask]
└── Immutable

BoundingBox
├── x_min: float
├── y_min: float
├── x_max: float
├── y_max: float
├── Validation: x_min < x_max, y_min < y_max
└── Immutable

ModelMetrics
├── mAP: float
├── mAP_50: float
├── mAP_75: float
├── precision: float
├── recall: float
├── f1_score: float
├── inference_time_ms: float
└── Immutable

TrainingConfig
├── epochs: int (1-1000)
├── batch_size: int (1-128)
├── learning_rate: float
├── image_size: int
├── augmentation: AugmentationConfig
├── optimizer: str
├── patience: int (early stopping)
└── Immutable

InferenceConfig
├── confidence_threshold: float (0.0-1.0)
├── iou_threshold: float (0.0-1.0)
├── max_detections: int
├── target_classes: Optional[List[str]]
└── Immutable

DatasetStatistics
├── total_images: int
├── total_annotations: int
├── class_distribution: Dict[str, int]
├── avg_annotations_per_image: float
├── min_image_size: ImageSize
├── max_image_size: ImageSize
└── Immutable
```

---

## 7. BOUNDED CONTEXT: DEVICES & DRONES

### 7.1 Aggregates

#### [AG] Device

```
Device (Aggregate Root)
├── Properties
│   ├── id: DeviceId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── type: DeviceType (drone, camera, sensor, gateway)
│   ├── manufacturer: str
│   ├── model: str
│   ├── serial_number: SerialNumber [VO]
│   ├── firmware_version: Optional[str]
│   ├── name: str
│   ├── status: DeviceStatus (online, offline, maintenance, retired)
│   ├── last_seen_at: Optional[datetime]
│   ├── configuration: Dict[str, Any]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── register() → DeviceRegistered [DE]
│   ├── go_online() → DeviceOnline [DE]
│   ├── go_offline() → DeviceOffline [DE]
│   ├── enter_maintenance(reason) → DeviceInMaintenance [DE]
│   ├── retire() → DeviceRetired [DE]
│   └── update_firmware(version) → FirmwareUpdated [DE]
│
└── Invariants
    ├── Serial number unique within tenant
    ├── Cannot assign mission to offline device
    ├── Cannot retire device with active mission
    └── Must belong to active warehouse
```

#### [AG] DroneMission

```
DroneMission (Aggregate Root)
├── Properties
│   ├── id: MissionId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── drone_id: DeviceId [VO]
│   ├── name: str
│   ├── type: MissionType (inventory_scan, inspection, surveillance)
│   ├── route: FlightRoute [VO]
│   ├── status: MissionStatus (planned, pre_flight, in_flight, completed, aborted)
│   ├── telemetry: List[TelemetryPoint] [VO]
│   ├── captures: List[MissionCapture] [E]
│   ├── started_at: Optional[datetime]
│   ├── completed_at: Optional[datetime]
│   ├── duration_seconds: Optional[int]
│   ├── created_by: UserId
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── plan(route) → MissionPlanned [DE]
│   ├── start_preflight() → PreflightStarted [DE]
│   ├── launch() → MissionLaunched [DE]
│   ├── add_waypoint_reached(point, capture) → WaypointReached [DE]
│   ├── complete() → MissionCompleted [DE]
│   ├── abort(reason) → MissionAborted [DE]
│   └── record_telemetry(point) → TelemetryRecorded [DE]
│
└── Invariants
    ├── Cannot launch without pre-flight check
    ├── Drone must be online and available
    ├── Route must have at least 2 waypoints
    ├── Cannot modify in-flight mission route
    └── Battery level must be > threshold at launch
```

### 7.2 Value Objects (Devices)

```
FlightRoute
├── waypoints: List[Waypoint] [VO]
├── total_distance_m: float (computed)
├── estimated_duration_s: int (computed)
├── altitude_m: float
└── Immutable

Waypoint
├── sequence: int
├── coordinates: GeoCoordinates [VO]
├── altitude_m: float
├── action: WaypointAction (hover, capture_photo, capture_video, rotate)
├── hover_duration_s: Optional[int]
├── target_location_id: Optional[LocationId]
└── Immutable

TelemetryPoint
├── timestamp: datetime
├── position: GeoCoordinates [VO]
├── altitude_m: float
├── battery_percent: int
├── speed_ms: float
├── heading_degrees: float
└── Immutable
```

---

## 8. BOUNDED CONTEXT: INTEGRATION

### 8.1 Aggregates

#### [AG] Connector

```
Connector (Aggregate Root)
├── Properties
│   ├── id: ConnectorId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── warehouse_id: WarehouseId [VO]
│   ├── type: ConnectorType (sap, oracle, dynamics, softland, generic_rest, generic_soap)
│   ├── name: str
│   ├── version: str
│   ├── connection_config: ConnectionConfig [VO] (encrypted)
│   ├── mapping_config: MappingConfig [VO]
│   ├── sync_config: SyncConfig [VO]
│   ├── status: ConnectorStatus (active, inactive, error, configuring)
│   ├── last_sync_at: Optional[datetime]
│   ├── last_health_check: Optional[HealthCheckResult] [VO]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── configure(config) → ConnectorConfigured [DE]
│   ├── activate() → ConnectorActivated [DE]
│   ├── deactivate() → ConnectorDeactivated [DE]
│   ├── test_connection() → ConnectionTested [DE]
│   ├── sync_now() → SyncRequested [DE]
│   └── update_mapping(mapping) → MappingUpdated [DE]
│
└── Invariants
    ├── Cannot activate without valid connection test
    ├── Cannot sync inactive connector
    ├── Mapping must cover required fields
    └── One active connector per WMS per warehouse
```

#### [AG] SyncJob

```
SyncJob (Aggregate Root)
├── Properties
│   ├── id: SyncJobId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── connector_id: ConnectorId [VO]
│   ├── type: SyncType (full, delta, push)
│   ├── direction: SyncDirection (inbound, outbound, bidirectional)
│   ├── entity_type: str (products, inventory, locations)
│   ├── status: JobStatus (queued, running, completed, failed, partial)
│   ├── progress: SyncProgress [VO]
│   ├── results: SyncResults [VO]
│   ├── errors: List[SyncError] [VO]
│   ├── retry_count: int
│   ├── max_retries: int
│   ├── started_at: Optional[datetime]
│   ├── completed_at: Optional[datetime]
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── Behaviors
│   ├── start() → SyncStarted [DE]
│   ├── update_progress(processed, total) → SyncProgress [DE]
│   ├── complete(results) → SyncCompleted [DE]
│   ├── fail(errors) → SyncFailed [DE]
│   ├── retry() → SyncRetried [DE]
│   └── mark_partial(results, errors) → SyncPartial [DE]
│
└── Invariants
    ├── Retry count cannot exceed max_retries
    ├── Cannot start if connector is inactive
    ├── Cannot run two syncs simultaneously for same connector
    └── Delta sync requires previous successful full sync
```

---

## 9. BOUNDED CONTEXT: AUDIT & COMPLIANCE

### 9.1 Aggregates

#### [AG] AuditEvent

```
AuditEvent (Aggregate Root) - IMMUTABLE
├── Properties
│   ├── id: AuditEventId [VO]
│   ├── tenant_id: TenantId [VO]
│   ├── actor_id: UserId [VO]
│   ├── actor_type: ActorType (user, system, integration)
│   ├── action: AuditAction [VO]
│   ├── resource_type: str
│   ├── resource_id: str
│   ├── changes: Optional[ChangeSet] [VO]
│   ├── metadata: AuditMetadata [VO]
│   ├── timestamp: datetime
│   └── correlation_id: CorrelationId [VO]
│
└── Invariants
    ├── IMMUTABLE - Cannot be modified after creation
    ├── Must have valid actor
    ├── Must have valid resource reference
    └── Timestamp is server-side (not client-provided)
```

### 9.2 Value Objects (Audit)

```
AuditAction
├── category: str (auth, data, config, integration)
├── type: str (create, update, delete, login, export)
├── description: str
└── Immutable

ChangeSet
├── before: Dict[str, Any]
├── after: Dict[str, Any]
├── changed_fields: List[str] (computed)
└── Immutable

AuditMetadata
├── ip_address: Optional[str]
├── user_agent: Optional[str]
├── request_id: str
├── session_id: Optional[str]
├── geo_location: Optional[str]
└── Immutable
```

---

## 10. DOMAIN SERVICES

### 10.1 Servicios que Cruzan Aggregates

| Service | Responsabilidad | Aggregates Involucrados |
|---------|----------------|------------------------|
| InventoryReconciliation | Reconciliar conteo con stock | InventoryCount, StockRecord, Adjustment |
| InferenceToInventory | Mapear detecciones IA a stock | InferenceJob, StockRecord, Incident |
| MissionToCount | Crear conteo desde misión de dron | DroneMission, InventoryCount |
| SyncReconciliation | Reconciliar datos WMS con inventario | SyncJob, StockRecord, Product |
| PermissionEvaluator | Evaluar permisos complejos (ABAC) | User, Role, Resource |
| TenantProvisioning | Crear y configurar nuevo tenant | Tenant, Company, User, Role |

### 10.2 Detalle de Domain Services

```
[DS] InventoryReconciliationService
├── reconcile(count: InventoryCount) → ReconciliationResult
│   ├── For each CountItem:
│   │   ├── Compare counted_quantity vs system_quantity
│   │   ├── If discrepancy > threshold → Create Incident
│   │   ├── Generate AdjustmentRequest
│   │   └── Update StockRecord.last_counted_at
│   └── Emit ReconciliationCompleted [DE]
│
└── Rules
    ├── Threshold configurable per warehouse
    ├── Large discrepancies require manual approval
    └── Creates audit trail for each adjustment

[DS] InferenceToInventoryService
├── process_results(inference: InferenceJob, mapping: LocationMapping) → ProcessResult
│   ├── For each Detection:
│   │   ├── Map detection class → ProductId
│   │   ├── Map image coordinates → LocationId
│   │   ├── Compare detected qty vs system qty
│   │   ├── If mismatch → Create Incident (source: ai)
│   │   └── Update confidence metrics
│   └── Emit InferenceProcessed [DE]
│
└── Rules
    ├── Only process detections above confidence threshold
    ├── Require class-to-product mapping configuration
    └── Multiple detections in same location are aggregated
```

---

## 11. INVARIANTES GLOBALES

| Invariante | Scope | Enforcement |
|------------|-------|-------------|
| Tenant data isolation | All aggregates | RLS + Application layer |
| Unique email per tenant | User | DB unique constraint + domain validation |
| Unique SKU per tenant | Product | DB unique constraint + domain validation |
| Non-negative stock | StockRecord | Domain entity + DB check constraint |
| One active model per engine type per tenant | AIModel | Domain service + DB constraint |
| Audit immutability | AuditEvent | No update/delete operations, append-only table |
| Referential integrity in hierarchy | Tenant → Company → Warehouse → Area → Location | DB FK + cascade rules |
| Active parent for active child | All hierarchy entities | Domain validation on activation |

---

## 12. AGGREGATE DESIGN RULES

### 12.1 Sizing Guidelines

1. **Small aggregates**: Preferir aggregates pequeños. Solo incluir entidades que DEBEN ser consistentes transaccionalmente.
2. **Reference by ID**: Los aggregates referencian otros aggregates por ID, nunca por instancia directa.
3. **Eventual consistency**: Entre aggregates, aceptar consistencia eventual via domain events.
4. **One aggregate per transaction**: Cada transacción modifica UN solo aggregate.

### 12.2 Consistency Boundaries

```
TRANSACCIONAL (dentro del aggregate):
  Warehouse.add_area() → Warehouse + Area en una transacción

EVENTUAL (entre aggregates, via events):
  CountCompleted → [event] → InventoryReconciliationService → StockRecord.adjust()
  InferenceCompleted → [event] → InferenceToInventoryService → Incident.create()
  MissionCompleted → [event] → MissionToCountService → InventoryCount.create()
```

### 12.3 Lifecycle de Aggregates

```
┌────────────────────────────────────────────────────┐
│         INVENTORY COUNT LIFECYCLE                    │
├────────────────────────────────────────────────────┤
│                                                     │
│  [planned] ──► [in_progress] ──► [completed]        │
│      │              │                               │
│      │              ▼                               │
│      └──────► [cancelled]                           │
│                                                     │
│  Transitions:                                       │
│  planned → in_progress: start()                     │
│  in_progress → completed: complete()                │
│  planned → cancelled: cancel()                      │
│  in_progress → cancelled: cancel()                  │
│                                                     │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│         AI MODEL LIFECYCLE                          │
├────────────────────────────────────────────────────┤
│                                                     │
│  [training] ──► [ready] ──► [deployed] ──► [archived]│
│                    │              │                  │
│                    │              ▼                  │
│                    └──────► [archived]               │
│                                                     │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│         DRONE MISSION LIFECYCLE                     │
├────────────────────────────────────────────────────┤
│                                                     │
│  [planned] ──► [pre_flight] ──► [in_flight] ──► [completed]│
│      │              │               │              │
│      │              │               ▼              │
│      └──────────────┴──────► [aborted]             │
│                                                     │
└────────────────────────────────────────────────────┘
```

---

## 13. REPOSITORY INTERFACES

```python
# Base Repository Interface
class IRepository(Protocol[T, ID]):
    async def get_by_id(self, id: ID) -> Optional[T]
    async def save(self, entity: T) -> None
    async def delete(self, id: ID) -> None
    async def exists(self, id: ID) -> bool

# Specific Repository Interfaces
class IWarehouseRepository(IRepository[Warehouse, WarehouseId]):
    async def find_by_company(self, company_id: CompanyId) -> List[Warehouse]
    async def find_by_tenant(self, tenant_id: TenantId) -> List[Warehouse]
    async def find_active_by_company(self, company_id: CompanyId) -> List[Warehouse]
    async def count_by_tenant(self, tenant_id: TenantId) -> int

class IProductRepository(IRepository[Product, ProductId]):
    async def find_by_sku(self, tenant_id: TenantId, sku: SKU) -> Optional[Product]
    async def find_by_barcode(self, tenant_id: TenantId, barcode: Barcode) -> Optional[Product]
    async def search(self, tenant_id: TenantId, query: str, limit: int) -> List[Product]
    async def find_by_category(self, tenant_id: TenantId, category: ProductCategory) -> List[Product]

class IStockRecordRepository(IRepository[StockRecord, StockRecordId]):
    async def find_by_location(self, location_id: LocationId) -> List[StockRecord]
    async def find_by_product(self, warehouse_id: WarehouseId, product_id: ProductId) -> List[StockRecord]
    async def get_total_quantity(self, warehouse_id: WarehouseId, product_id: ProductId) -> Quantity
    async def find_expired(self, warehouse_id: WarehouseId, before_date: date) -> List[StockRecord]

class IInferenceJobRepository(IRepository[InferenceJob, InferenceId]):
    async def find_by_model(self, model_id: ModelId) -> List[InferenceJob]
    async def find_pending(self, tenant_id: TenantId) -> List[InferenceJob]
    async def count_by_tenant_month(self, tenant_id: TenantId, month: date) -> int

class IAuditEventRepository:
    async def append(self, event: AuditEvent) -> None  # Only append, no update/delete
    async def find_by_resource(self, resource_type: str, resource_id: str) -> List[AuditEvent]
    async def find_by_actor(self, actor_id: UserId, since: datetime) -> List[AuditEvent]
    async def find_by_tenant(self, tenant_id: TenantId, filters: AuditFilters) -> PaginatedResult[AuditEvent]
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
