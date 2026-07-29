# OLO IA — ARQUITECTURA DEL FRONTEND

## Análisis del estado actual y arquitectura propuesta

---

## 1. ESTADO ACTUAL DEL PROYECTO

### 1.1 Inventario real (verificado en disco)

| Área | Estado | Contenido |
|------|--------|-----------|
| `backend/` | **Existe, operativo** | FastAPI. 29 módulos. Clean Architecture aplicada. Endpoints: `/health`, `/ready`, `/version`, `/v1/auth/me`, `/v1/warehouses` |
| `supabase/migrations/` | **Existe, 16 migraciones** | Schemas, rol `olo_app`, catálogos globales, funciones de contexto, jerarquía completa, permisos, RLS, **Auth Hook** |
| `supabase/rollbacks/` | Existe, 16 archivos | Reverso de cada migración |
| `docs/` | Existe, 25 documentos | Diseño, auditoría, decisiones, sistema visual |
| `frontend/` | **NO EXISTE** | — |

### 1.2 Qué se reutiliza y qué se reemplaza

| Elemento | Decisión | Motivo |
|----------|---------|--------|
| Componentes de frontend existentes | **Nada que reutilizar** | No hay frontend |
| Contratos de la API | **Se reutilizan tal cual** | Están implementados y probados. Manda el backend |
| `docs/design/*` (7 documentos) | **Se reutilizan como especificación** | Son la fuente del ADN visual |
| `API_DESIGN.md` §6.1 (paginación offset) | **Se reemplaza** | El backend implementó cursores |
| `API_DESIGN.md` §7.1 (`POST /v1/auth/login`) | **Se reemplaza** | No existe. Auth va directo a Supabase |
| `.env.example` de la raíz | **Se extiende** | Faltan las variables `VITE_*` |

**Conclusión: el frontend es greenfield.** No hay deuda que arrastrar, pero hay contratos que respetar.

---

## 2. CONTRATOS REALES DEL BACKEND

Extraídos del código, no de la documentación. Son la especificación vinculante.

### 2.1 Envoltorio de respuesta

```ts
// Recurso único
{ "data": { ... } }

// Colección paginada — CURSOR, no offset
{ "data": [ ... ], "pagination": { "next_cursor": string | null, "page_size": number } }

// Error — formato único para todos los códigos
{ "error": {
    "code": string,            // "NOT_FOUND", "VERSION_CONFLICT", ...
    "message": string,
    "details"?: object,        // en VALIDATION_ERROR: { errors: [{field, message, type}] }
    "request_id"?: string,     // copiable por el usuario para soporte
    "correlation_id"?: string
} }
```

### 2.2 Códigos de error y su tratamiento en el cliente

| Código | HTTP | Tratamiento obligatorio en el frontend |
|--------|------|---------------------------------------|
| `UNAUTHENTICATED` | 401 | Refrescar token una vez, reintentar, si falla → login |
| `INVALID_TOKEN` | 401 | Igual que el anterior |
| `NO_ACTIVE_MEMBERSHIP` | **403** | **NO refrescar.** Pantalla dedicada. Es la trampa: un 401 haría bucle |
| `FORBIDDEN` | 403 | Mensaje de permiso insuficiente. No reintentar |
| `WAREHOUSE_NOT_ACCESSIBLE` | 403 | Limpiar el almacén seleccionado y recargar la lista |
| `NOT_FOUND` | 404 | Puede ser "de otro tenant". Nunca decir "no tienes permiso" |
| `VERSION_CONFLICT` | **412** | Recargar el recurso y ofrecer reintentar |
| `PRECONDITION_REQUIRED` | **428** | Bug del cliente: faltó `If-Match` |
| `VALIDATION_ERROR` | 400 | Mapear `details.errors[].field` a los campos del formulario |
| `RATE_LIMITED` | 429 | Backoff respetando `Retry-After` |
| `INTERNAL_ERROR` | 500 | Mostrar `request_id` copiable |

### 2.3 Cabeceras

| Cabecera | Dirección | Regla |
|----------|-----------|-------|
| `Authorization: Bearer <jwt>` | → | Token de Supabase Auth |
| `X-Correlation-Id` | → | Lo genera el cliente. El backend lo acepta y propaga |
| `X-Request-Id` | ← | Lo genera el servidor. El cliente **nunca** lo envía |
| `X-Warehouse-Id` | → | Preferencia de filtrado. El backend valida el acceso |
| `If-Match: W/"<version>"` | → | Obligatorio en PATCH. Sin él: 428 |
| `ETag: W/"<version>"` | ← | Se captura en GET para el siguiente PATCH |

### 2.4 Flujo de autenticación real

```
1. Frontend → Supabase Auth (signInWithPassword)
                 │
                 │  El Auth Hook (migración 0016) inyecta en app_metadata:
                 │     tenant_id, tenant_wide_access
                 │  FAIL-SECURE: sin membresía activa, NO inyecta nada
                 ▼
2. Frontend recibe JWT + refresh token
                 │
                 ▼
3. Frontend → GET /v1/auth/me  (con el JWT)
                 │
                 │  Devuelve: perfil, tenant, roles, permissions[],
                 │            accessible_warehouse_ids[], tenant_wide_access
                 ▼
4. Sesión completa. El JWT da identidad; /me da autorización.
```

**Consecuencia arquitectónica**: la sesión se compone de dos fuentes asíncronas. Un usuario
puede estar autenticado (paso 2) pero sin autorización (paso 3 devuelve 403
`NO_ACTIVE_MEMBERSHIP`). El estado de sesión debe modelar ese caso explícitamente.

---

## 3. LAS CUATRO DECISIONES QUE EVITAN REFACTORIZACIONES

Estas son las decisiones cuyo coste, si se toman mal, es rehacer todo después.

### 3.1 DataSource — el puerto de datos

**Problema**: el Dashboard necesita KPIs, series y eventos. El backend **no tiene** esos
endpoints todavía (solo `/auth/me` y `/warehouses`). Si las estaciones llaman a `fetch`
directamente, cuando Claude publique los endpoints hay que reescribir cada estación.

**Solución**: toda estación consume un puerto, nunca HTTP.

```
design/stations/MetricStation  ──consume──►  MetricSource (puerto)
                                                   ▲
                            ┌──────────────────────┴──────────────────────┐
                            │                                             │
                  MockMetricSource                            HttpMetricSource
                  (Capa 1, hoy)                               (cuando exista el endpoint)
```

Cambiar de mock a HTTP es cambiar un registro en un provider. **Cero cambios en componentes.**

### 3.2 LayerContext — capacidades progresivas

**Problema**: las capas 2-5 (Canvas, R3F, shaders, Twin 3D) deben ser mejoras aditivas.
Si un componente hace `import { Canvas } from '@react-three/fiber'`, la Capa 3 pasa a ser
un requisito de build.

**Solución**: registro de renderizadores por capacidad.

```ts
// El componente pide el mejor renderizador disponible; nunca importa la tecnología.
const Renderer = useRenderer('mesh');   // → MeshSvg (L1) | MeshCanvas (L2)
const Twin     = useRenderer('twin');   // → TwinPlaceholder (L1) | Twin2D (L2) | Twin3D (L3)
```

Cada capa **registra** su renderizador. Si no está registrado, se usa el de la capa
inferior. La aplicación es completamente funcional con solo la Capa 1 registrada.

### 3.3 AmbientClock — un solo rAF, cero re-renders

**Problema**: el latido del sistema afecta a decenas de elementos. Con estado de React,
son decenas de re-renders a 60 Hz. Inviable.

**Solución**: un único `requestAnimationFrame` escribe **dos variables CSS** en
`documentElement`. Todo lo ambiental es CSS puro que las lee.

```
1 rAF  →  --ambient-breath: 0.73   →  cientos de elementos reaccionan en CSS
          --ambient-pulse:  0.41       0 re-renders de React
```

Los componentes que necesiten el valor en JS se suscriben con un callback que muta un ref,
nunca estado.

### 3.4 NavigationModel — navegación declarativa y genérica

**Problema**: si el Spine tiene los módulos escritos a mano, cada módulo nuevo lo toca.

**Solución**: un modelo de datos describe la navegación. El Spine lo renderiza sin saber
qué es "Inventario". Los grupos son las tres capas cognitivas del ADN, que son estables.

---

## 4. ESTRUCTURA DE CARPETAS

```
frontend/
├── index.html
├── package.json
├── tsconfig.json · tsconfig.node.json
├── vite.config.ts
├── eslint.config.js
├── .env.example                    ← versionado, solo nombres
│
└── src/
    ├── main.tsx
    ├── App.tsx                     ← providers
    ├── router.tsx
    │
    ├── styles/
    │   └── index.css               ← @import tailwindcss + @theme
    │
    ├── design/                     ═══ AGNÓSTICO DE DOMINIO ═══
    │   │                               No importa NADA de features/
    │   ├── tokens/
    │   │   ├── primitives.css      ← --void-*, --cyan-*, --mist-*
    │   │   ├── semantic.css        ← --state-*, --data-*, --surface-*
    │   │   ├── materials.css       ← --veil-*, --halo-*, --lift-*
    │   │   ├── typography.css
    │   │   ├── space.css
    │   │   ├── themes/
    │   │   │   ├── deep-space.css
    │   │   │   ├── daylight.css
    │   │   │   └── high-contrast.css
    │   │   ├── index.css
    │   │   └── tokens.ts           ← espejo TS para SVG/JS
    │   │
    │   ├── motion/
    │   │   ├── easing.ts · duration.ts · stagger.ts · spring.ts
    │   │   ├── variants.ts         ← EMERGE, y las demás
    │   │   ├── ambient.ts          ← constantes del latido
    │   │   ├── AmbientClock.tsx    ← el único rAF
    │   │   ├── useAmbient.ts
    │   │   └── useMotionPreference.ts
    │   │
    │   ├── capability/
    │   │   ├── LayerContext.tsx    ← registro de renderizadores
    │   │   ├── useRenderer.ts
    │   │   └── types.ts
    │   │
    │   ├── foundation/
    │   │   ├── Surface.tsx         ← los 5 planos Z
    │   │   ├── FocusContext.tsx    ← coherencia neuronal
    │   │   └── mesh/
    │   │       ├── MeshLayer.tsx   ← orquestador
    │   │       ├── MeshSvg.tsx     ← CAPA 1
    │   │       ├── meshModel.ts    ← generación de nodos y aristas
    │   │       └── types.ts
    │   │
    │   ├── primitives/
    │   │   ├── Button.tsx · Input.tsx · Icon.tsx · Badge.tsx
    │   │   ├── StatusIndicator.tsx · Kbd.tsx · ScanLine.tsx
    │   │   └── index.ts
    │   │
    │   ├── ports/                  ← PUERTOS DE DATOS (§3.1)
    │   │   ├── types.ts
    │   │   └── DataSourceContext.tsx
    │   │
    │   └── utils/
    │       └── cn.ts
    │
    ├── shell/                      ═══ EL CENTRO DE CONTROL ═══
    │   ├── AppShell.tsx
    │   ├── VitalsBar.tsx
    │   ├── Spine.tsx
    │   ├── StreamBar.tsx
    │   ├── CanvasHost.tsx          ← reserva el hueco del Twin
    │   ├── navigation.ts           ← NavigationModel declarativo
    │   └── SystemStateProvider.tsx
    │
    ├── scenes/
    │   └── login/
    │       ├── LoginScene.tsx      ← orquestador + degradación
    │       ├── SceneSvg.tsx        ← CAPA 1: mesh + almacén + agentes
    │       ├── SceneStatic.tsx     ← reduced-motion
    │       ├── DiagnosticHud.tsx
    │       ├── CredentialPanel.tsx
    │       └── sceneModel.ts       ← geometría procedural
    │
    ├── auth/                       ═══ IDENTIDAD ═══
    │   ├── AuthGateway.ts          ← puerto
    │   ├── SupabaseAuthGateway.ts  ← implementación real
    │   ├── MockAuthGateway.ts      ← sin credenciales, para desarrollo
    │   ├── sessionStore.ts
    │   └── AuthProvider.tsx
    │
    ├── lib/
    │   ├── apiClient.ts            ← envoltorio, errores, ETag, correlation
    │   ├── apiErrors.ts            ← mapa del §2.2
    │   └── queryClient.ts
    │
    ├── features/                   ← vacío en esta entrega
    └── stores/
        ├── uiStore.ts
        └── systemStore.ts
```

### 4.1 La regla de dependencia

```
scenes/ ──┐
shell/  ──┼──► design/ ──► (nada del proyecto)
features/─┘        │
                   └──► ports/  ← interfaces, sin implementación

auth/ ──► lib/ ──► (contratos del backend)
```

`design/` no importa de `shell/`, ni de `features/`, ni de `auth/`. Es publicable como
paquete independiente. Esa es la garantía de que cualquier módulo futuro lo reutilice.

---

## 5. DESVIACIONES DEL DOCUMENTO DE DISEÑO ORIGINAL

Registradas para trazabilidad. `FRONTEND_STRUCTURE.md` describía el estado final; esto es
la Capa 1.

| # | Documentado | En Capa 1 | Motivo |
|---|------------|-----------|--------|
| D1 | `MeshLayer` en Canvas 2D | **SVG + Framer Motion** | Canvas es Capa 2. SVG llega a ~60 nodos con soltura |
| D2 | Carpeta por componente | Archivo por componente | 75 carpetas para componentes de 40 líneas es fricción sin retorno. Se adopta carpeta cuando el componente tiene 3+ archivos |
| D3 | Escena de login con R3F | SVG procedural | R3F es Capa 3 |
| D4 | GSAP para la timeline | Framer Motion con `useAnimate` | GSAP es dependencia extra sin necesidad todavía |
| D5 | `TwinStation` | `TwinSlot` reservado | El Twin es Capa 5. Se reserva el espacio y la interfaz |
| D6 | Storybook en V0 | Pospuesto a la siguiente entrega | El usuario pidió entregas pequeñas. Primero login + shell funcionando |
| D7 | Paginación offset | Cursores | Manda el backend |

---

## 6. ALCANCE DE ESTA ENTREGA

| Incluido | Excluido |
|----------|---------|
| Setup completo del proyecto | Dashboard con estaciones |
| Sistema de tokens + 3 temas | Design System completo (75 componentes) |
| Sistema de movimiento + AmbientClock | Cortex (command palette) |
| `Surface`, `MeshLayer` SVG, `FocusContext` | Gráficos |
| 7 primitivos | Módulos funcionales |
| Login cinematográfico con degradación | Twin (solo el hueco reservado) |
| Shell: Vitals + Spine + Canvas + Stream | Tablas, formularios |
| Navegación declarativa | Storybook |
| Cliente HTTP con el contrato real | Tests E2E |
| `AuthGateway` con mock y Supabase | |

---

*Documento 8 del sistema de diseño de OLO IA.*
*Versión: 1.0*
