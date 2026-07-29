# OLO_IA - ESTÁNDARES DE CÓDIGO

## 1. PRINCIPIOS GENERALES

1. **Claridad sobre brevedad**: Código legible > código corto.
2. **Consistencia obligatoria**: Todo el equipo sigue las mismas reglas.
3. **Automatizado**: Formatting y linting automáticos, no manuales.
4. **Type-safe**: Tipado estricto en ambos stacks (mypy + TypeScript strict).
5. **Tested**: Código sin tests no se mergea.
6. **Documented**: APIs públicas documentadas; código interno auto-explicativo.

---

## 2. PYTHON (Backend)

### 2.1 Herramientas

| Herramienta | Propósito | Config |
|------------|----------|--------|
| Ruff | Linter + Formatter | pyproject.toml |
| mypy | Type checker (strict) | pyproject.toml |
| pytest | Testing | pyproject.toml |
| pre-commit | Git hooks | .pre-commit-config.yaml |

### 2.2 Style Guide

- Python 3.12+
- Line length: 100 chars
- Indentation: 4 spaces
- Quotes: Double quotes para strings
- Imports: Organizados por isort (via Ruff)
- Docstrings: Google style para APIs públicas
- Type hints: Obligatorias en todo parámetro y retorno

### 2.3 Naming Conventions

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Módulos | snake_case | `warehouse_repository.py` |
| Clases | PascalCase | `WarehouseRepository` |
| Funciones | snake_case | `get_by_id()` |
| Variables | snake_case | `warehouse_id` |
| Constantes | UPPER_SNAKE | `MAX_RETRIES` |
| Privados | prefijo `_` | `_validate()` |
| Protocolos | I-prefix | `IWarehouseRepository` |

### 2.4 Patrones Obligatorios

```python
# ✓ Correcto: Type hints completas
async def get_warehouse(
    self, warehouse_id: WarehouseId
) -> Optional[Warehouse]:
    ...

# ✗ Incorrecto: Sin type hints
async def get_warehouse(self, warehouse_id):
    ...

# ✓ Correcto: Pydantic para DTOs
class CreateWarehouseDTO(BaseModel):
    model_config = ConfigDict(strict=True)
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(pattern=r"^[A-Z0-9\-]+$")

# ✓ Correcto: Dependency Injection
class CreateWarehouseUseCase:
    def __init__(
        self,
        repo: IWarehouseRepository,
        event_bus: IEventBus,
    ) -> None:
        self._repo = repo
        self._event_bus = event_bus

# ✓ Correcto: Result types para errores esperados
async def execute(self, command: CreateWarehouseCommand) -> Result[WarehouseDTO, DomainError]:
    ...
```

### 2.5 Reglas de Import

```python
# Orden (Ruff enforce automáticamente):
# 1. Standard library
# 2. Third-party
# 3. Local (application)

# ✓ Correcto
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.domain.tenant.entities import Warehouse
from src.application.tenant.dto import WarehouseDTO
```

### 2.6 Error Handling

```python
# ✓ Correcto: Excepciones de dominio específicas
class WarehouseNotFoundError(DomainError):
    def __init__(self, warehouse_id: WarehouseId) -> None:
        super().__init__(f"Warehouse '{warehouse_id}' not found")
        self.warehouse_id = warehouse_id

# ✓ Correcto: Catch específico, nunca bare except
try:
    warehouse = await repo.get_by_id(warehouse_id)
except DatabaseConnectionError as e:
    logger.error("DB connection failed", exc_info=e)
    raise ServiceUnavailableError() from e

# ✗ Incorrecto: Bare except
try:
    ...
except:
    pass
```

---

## 3. TYPESCRIPT (Frontend)

### 3.1 Herramientas

| Herramienta | Propósito | Config |
|------------|----------|--------|
| ESLint | Linter | eslint.config.js |
| Prettier | Formatter | .prettierrc |
| TypeScript | Type checker (strict) | tsconfig.json |
| Vitest | Testing | vitest.config.ts |

### 3.2 Style Guide

- TypeScript strict mode
- Line length: 100 chars
- Indentation: 2 spaces
- Quotes: Single quotes
- Semicolons: Sí
- Trailing commas: Sí (es-next)

### 3.3 Naming Conventions

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Archivos componente | PascalCase | `WarehouseList.tsx` |
| Archivos util/hook | camelCase | `useWarehouses.ts` |
| Componentes | PascalCase | `function WarehouseList()` |
| Hooks | camelCase con use- | `useWarehouses()` |
| Funciones | camelCase | `formatDate()` |
| Variables | camelCase | `warehouseId` |
| Constantes | UPPER_SNAKE | `API_BASE_URL` |
| Types/Interfaces | PascalCase | `interface Warehouse` |
| Enums | PascalCase | `enum WarehouseStatus` |

### 3.4 Componentes React

```tsx
// ✓ Correcto: Functional component con types explícitas
interface WarehouseCardProps {
  warehouse: Warehouse;
  onSelect: (id: string) => void;
  isActive?: boolean;
}

export function WarehouseCard({
  warehouse,
  onSelect,
  isActive = false,
}: WarehouseCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4 cursor-pointer transition-colors',
        isActive && 'border-primary bg-primary/5',
      )}
      onClick={() => onSelect(warehouse.id)}
    >
      <h3 className="font-medium">{warehouse.name}</h3>
      <p className="text-sm text-muted-foreground">{warehouse.code}</p>
    </div>
  );
}
```

### 3.5 Hooks y Services

```tsx
// ✓ Correcto: Custom hook con React Query
export function useWarehouses(companyId?: string) {
  return useQuery({
    queryKey: ['warehouses', { companyId }],
    queryFn: () => warehouseService.getAll({ companyId }),
    enabled: !!companyId,
  });
}

// ✓ Correcto: Service layer
export const warehouseService = {
  getAll: async (params?: GetWarehousesParams): Promise<PaginatedResponse<Warehouse>> => {
    const response = await apiClient.get('/v1/warehouses', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Warehouse> => {
    const response = await apiClient.get(`/v1/warehouses/${id}`);
    return response.data.data;
  },

  create: async (data: CreateWarehouseInput): Promise<Warehouse> => {
    const response = await apiClient.post('/v1/warehouses', data);
    return response.data.data;
  },
};
```

### 3.6 Reglas Estrictas TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

---

## 4. SQL / DATABASE

### 4.1 Convenciones SQL

| Elemento | Regla | Ejemplo |
|----------|-------|---------|
| Keywords | UPPERCASE | `SELECT`, `WHERE`, `JOIN` |
| Tables | snake_case, plural | `stock_records` |
| Columns | snake_case | `created_at` |
| Schemas | lowercase | `inventory` |
| Indexes | idx_{table}_{cols} | `idx_products_tenant_sku` |
| Constraints | chk_{table}_{desc} | `chk_stock_positive_qty` |
| FK | fk_{table}_{ref} | `fk_products_tenant` |

### 4.2 Migraciones (Alembic)

```python
# Naming: YYYYMMDD_HHMM_description.py
# Ejemplo: 20260728_1030_add_products_table.py

def upgrade() -> None:
    """Descripción clara de qué hace la migración."""
    op.create_table(
        "products",
        sa.Column("id", sa.UUID(), primary_key=True),
        # ...
        schema="inventory",
    )

def downgrade() -> None:
    """Reverso exacto del upgrade."""
    op.drop_table("products", schema="inventory")
```

---

## 5. GIT

### 5.1 Commit Messages

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
| Type | Uso |
|------|-----|
| feat | Nueva funcionalidad |
| fix | Bug fix |
| refactor | Refactoring sin cambio funcional |
| docs | Solo documentación |
| test | Solo tests |
| chore | Build, CI, tooling |
| perf | Mejora de performance |
| style | Formatting (no lógica) |

**Ejemplos:**
```
feat(inventory): add stock adjustment approval workflow
fix(auth): handle expired refresh token gracefully
refactor(ai): extract inference pipeline to separate module
docs(api): update OpenAPI spec for /v1/products
test(rls): add cross-tenant isolation tests
```

### 5.2 Branching Strategy

```
main ─────────────────────────────────── (producción)
  │
  ├── develop ────────────────────────── (integración)
  │     │
  │     ├── feature/INV-42-stock-adj ─── (feature branch)
  │     ├── feature/AI-15-yolo-engine
  │     └── fix/AUTH-8-token-refresh
  │
  └── hotfix/SEC-3-rls-bypass ────────── (hotfix directo a main)
```

### 5.3 PR Requirements

- [ ] Título descriptivo (< 70 chars)
- [ ] Descripción con contexto y qué se probó
- [ ] Tests pasando (CI verde)
- [ ] Lint y type check pasando
- [ ] Al menos 1 reviewer aprobó
- [ ] No secrets en el código
- [ ] Documentación actualizada si aplica

---

## 6. TESTING

### 6.1 Convenciones de Tests

```python
# Backend: pytest
class TestCreateWarehouse:
    """Tests for CreateWarehouseUseCase."""
    
    async def test_creates_warehouse_successfully(self, ...):
        """Should create warehouse when all data is valid."""
        ...
    
    async def test_rejects_duplicate_code(self, ...):
        """Should raise ConflictError when code already exists."""
        ...
    
    async def test_requires_active_company(self, ...):
        """Should raise error when company is inactive."""
        ...
```

```tsx
// Frontend: Vitest + Testing Library
describe('WarehouseCard', () => {
  it('renders warehouse name and code', () => { ... });
  it('calls onSelect when clicked', () => { ... });
  it('applies active styles when isActive is true', () => { ... });
});
```

### 6.2 Coverage Requirements

| Capa | Minimum | Target |
|------|---------|--------|
| Domain (entities, VOs) | 90% | 95% |
| Application (use cases) | 80% | 90% |
| Infrastructure (repos) | 70% | 80% |
| Presentation (API) | 70% | 80% |
| Frontend (components) | 60% | 75% |
| Frontend (hooks) | 80% | 90% |

---

## 7. DOCUMENTACIÓN EN CÓDIGO

### 7.1 Cuándo Documentar

- APIs públicas (funciones exportadas, clases públicas): SIEMPRE
- Lógica compleja de negocio: SIEMPRE
- Workarounds o hacks: SIEMPRE (con link a issue)
- Código auto-explicativo: NO documentar lo obvio
- Funciones privadas simples: NO necesario

### 7.2 Formato

```python
# Python: Google-style docstrings
class CreateWarehouseUseCase:
    """Creates a new warehouse within a company.
    
    Validates that the company exists and is active, that the warehouse
    code is unique within the company, and that the tenant hasn't exceeded
    their warehouse limit.
    
    Args:
        repo: Warehouse repository for persistence.
        company_repo: Company repository for validation.
        limit_service: Tenant limit enforcement service.
    
    Raises:
        CompanyNotFoundError: If the company doesn't exist.
        DuplicateCodeError: If the code is already in use.
        PlanLimitExceededError: If tenant reached max warehouses.
    """
```

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
