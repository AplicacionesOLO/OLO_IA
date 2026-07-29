# OLO IA — ESTRUCTURA DEL FRONTEND

## Organización de código y stack visual

> Este documento **extiende** `docs/FOLDER_STRUCTURE.md` §3 en el ámbito de la capa visual.
> No modifica arquitectura, backend, APIs ni lógica de dominio.

---

## 1. STACK VISUAL

| Capa | Tecnología | Justificación | Peso (gzip) |
|------|-----------|--------------|------------|
| Framework | React 18 + TypeScript strict | Ya definido en arquitectura | — |
| Build | Vite | Ya definido | — |
| Estilos | Tailwind CSS 4 + CSS custom properties | Tokens como variables CSS, Tailwind como utilidades | ~12KB |
| Animación | Framer Motion | Layout animations y `layoutId` son insustituibles para las transiciones de Canvas | ~34KB |
| Timeline | GSAP + ScrollTrigger | **Solo** para la escena de login y el scrubber del Twin. Secuencias de 20+ pasos son inmanejables en Framer | ~28KB (lazy) |
| 3D | React Three Fiber + drei | Solo el Twin y la escena de login | ~120KB (lazy) |
| Gráficos | Visx | Primitivas D3 sin estética impuesta | ~40KB (tree-shaken) |
| Microanimación | Lottie (`lottie-web/light`) | Solo iconos de estado complejos. Máximo 6 archivos, < 8KB cada uno | ~22KB (lazy) |
| Shaders | GLSL en R3F | Conos de escaneo, heatmap volumétrico, partículas | inline |
| Virtualización | TanStack Virtual | Tablas de 100k+ filas | ~6KB |
| Estado servidor | React Query | Ya definido | — |
| Estado cliente | Zustand | Ya definido | — |

### 1.1 Criterio de uso de cada herramienta pesada

| Herramienta | Se usa cuando | NO se usa para |
|------------|--------------|---------------|
| **GSAP** | Secuencia de > 8 pasos coordinados en el tiempo | Transiciones de componente (usar Framer) |
| **R3F** | Representación espacial real del almacén | Fondos decorativos (usar Canvas 2D) |
| **Lottie** | Icono con animación de > 20 frames | Iconos de estado (usar SVG + Framer) |
| **Shaders** | Efecto imposible en CSS con coste aceptable | Cualquier cosa que CSS resuelva |

Regla: cada una de estas cuatro se carga con `React.lazy` y **nunca** entra en el bundle
inicial.

---

## 2. ESTRUCTURA DE CARPETAS

```
frontend/src/
│
├── main.tsx
├── App.tsx
├── router.tsx
│
├── design/                          ← EL SISTEMA DE DISEÑO (nuevo)
│   │
│   ├── tokens/
│   │   ├── primitives.css           # --void-*, --cyan-*, --mist-*, ...
│   │   ├── semantic.css             # --state-*, --data-*, --surface-*, ...
│   │   ├── materials.css            # --veil-*, --halo-*, --lift-*, --grad-*
│   │   ├── typography.css           # familias, escala, roles
│   │   ├── space.css                # espaciado, radios, densidad
│   │   ├── themes/
│   │   │   ├── deep-space.css       # tema canónico oscuro
│   │   │   ├── daylight.css         # tema claro
│   │   │   └── high-contrast.css    # accesibilidad AAA
│   │   ├── index.css                # orquesta los imports
│   │   └── tokens.ts                # espejo en TS para uso en JS/canvas/R3F
│   │
│   ├── motion/
│   │   ├── easing.ts                # curvas canónicas
│   │   ├── spring.ts                # presets de resorte
│   │   ├── duration.ts              # escala de duraciones
│   │   ├── stagger.ts               # escalonados
│   │   ├── variants.ts              # variantes reutilizables de Framer
│   │   ├── ambient.ts               # constantes del latido
│   │   ├── AmbientClock.tsx         # el reloj único global
│   │   ├── MotionProvider.tsx       # contexto de movimiento + preferencias
│   │   ├── useAmbientPulse.ts       # hook de suscripción al reloj
│   │   ├── useMotionBudget.ts       # registro y control de las 24 simultáneas
│   │   └── usePerformanceGuard.ts   # degradación automática por FPS
│   │
│   ├── foundation/
│   │   ├── Surface/                 # el componente de planos Z
│   │   ├── Veil/
│   │   ├── Halo/
│   │   ├── MeshLayer/               # red neuronal, Canvas 2D
│   │   ├── FocusContext/            # coherencia neuronal
│   │   └── index.ts
│   │
│   ├── primitives/
│   │   ├── Button/                  # Button.tsx · Button.test.tsx · Button.stories.tsx
│   │   ├── Input/
│   │   ├── Select/
│   │   ├── Combobox/
│   │   ├── Textarea/
│   │   ├── Checkbox/
│   │   ├── Switch/
│   │   ├── Badge/
│   │   ├── Chip/
│   │   ├── Icon/
│   │   ├── Divider/
│   │   ├── ScrollArea/
│   │   ├── Kbd/
│   │   └── index.ts
│   │
│   ├── molecules/
│   │   ├── MetricValue/
│   │   ├── StatusIndicator/
│   │   ├── FreshnessIndicator/
│   │   ├── Sparkline/
│   │   ├── DataField/
│   │   ├── ConfidenceBar/
│   │   ├── DeltaIndicator/
│   │   ├── Timestamp/
│   │   ├── EntityRef/
│   │   └── index.ts
│   │
│   ├── stations/
│   │   ├── Station/                 # contenedor base
│   │   ├── MetricStation/
│   │   ├── ChartStation/
│   │   ├── TwinStation/
│   │   │   ├── TwinStation.tsx      # orquestador + detección de capacidad
│   │   │   ├── Twin3D.tsx           # R3F (lazy)
│   │   │   ├── Twin2D.tsx           # Canvas 2D isométrico (fallback)
│   │   │   ├── geometry/            # generación procedural desde datos
│   │   │   ├── layers/              # racks, drones, agvs, routes, heat, sensors
│   │   │   ├── shaders/             # scanCone.glsl, heatVolume.glsl
│   │   │   └── camera/              # presets y controles
│   │   ├── FeedStation/
│   │   ├── TableStation/
│   │   ├── VisionStation/
│   │   ├── FleetStation/
│   │   ├── InferenceStation/
│   │   ├── GaugeStation/
│   │   ├── HeatmapStation/
│   │   ├── AlertStation/
│   │   ├── TimelineStation/
│   │   └── index.ts
│   │
│   ├── charts/
│   │   ├── TimeSeries/
│   │   ├── StackedFlow/
│   │   ├── Distribution/
│   │   ├── RadialGauge/
│   │   ├── Heatmap/
│   │   ├── NetworkGraph/
│   │   ├── ConfidenceScatter/
│   │   ├── Waterfall/
│   │   ├── primitives/              # ejes, tooltip, gradientes compartidos
│   │   └── index.ts
│   │
│   ├── overlays/
│   │   ├── Dialog/
│   │   ├── SidePanel/
│   │   ├── Drawer/
│   │   ├── Popover/
│   │   ├── Tooltip/
│   │   ├── ContextMenu/
│   │   └── index.ts
│   │
│   ├── feedback/
│   │   ├── Toast/
│   │   ├── AlertBanner/
│   │   ├── CriticalOverlay/
│   │   ├── ConfirmAction/
│   │   └── index.ts
│   │
│   ├── states/
│   │   ├── Skeleton/
│   │   ├── EmptyState/
│   │   ├── ErrorState/
│   │   ├── OfflineState/
│   │   ├── LoadingScan/
│   │   ├── ProgressRing/
│   │   └── index.ts
│   │
│   └── index.ts                     # API pública del design system
│
├── shell/                           ← EL CENTRO DE CONTROL (nuevo)
│   ├── AppShell.tsx
│   ├── VitalsBar/
│   ├── Spine/
│   ├── Canvas/
│   │   ├── Canvas.tsx               # orquesta modo grid/immersive/focus
│   │   ├── GridCanvas.tsx
│   │   ├── ImmersiveCanvas.tsx
│   │   ├── FocusCanvas.tsx
│   │   └── useCanvasLayout.ts       # retícula, drag&drop, persistencia
│   ├── StreamBar/
│   ├── Cortex/                      # command palette
│   └── SystemStateProvider.tsx      # estado global idle|thinking|alert|...
│
├── scenes/                          ← ESCENAS CINEMATOGRÁFICAS (nuevo)
│   ├── LoginScene/
│   │   ├── LoginScene.tsx           # orquestador + degradación
│   │   ├── Scene3D.tsx              # R3F completo (lazy)
│   │   ├── Scene2D.tsx              # Canvas 2D: Mesh + partículas
│   │   ├── SceneStatic.tsx          # composición estática (reduced-motion)
│   │   ├── timeline.ts              # secuencia GSAP
│   │   ├── warehouse/               # geometría procedural del almacén
│   │   ├── agents/                  # drones, AGVs, sus trayectorias
│   │   ├── hud/                     # líneas de diagnóstico
│   │   └── useSceneCapability.ts    # detección de capacidad del dispositivo
│   └── EntryTransition/             # secuencia post-login de 1.8s
│
├── features/                        ← FEATURES (existente, sin cambios de lógica)
│   ├── auth/
│   ├── overview/
│   ├── twin/
│   ├── vision/
│   ├── fleet/
│   ├── intelligence/
│   ├── analytics/
│   ├── inventory/
│   ├── incidents/
│   ├── integration/
│   ├── admin/
│   └── audit/
│
├── shared/                          ← (existente)
│   ├── hooks/
│   ├── utils/
│   ├── types/
│   └── lib/
│
├── layouts/
├── pages/
└── stores/
    ├── authStore.ts
    ├── tenantStore.ts
    ├── uiStore.ts
    ├── canvasStore.ts               # layout de estaciones por usuario (nuevo)
    ├── focusStore.ts                # entidad enfocada (nuevo)
    └── systemStateStore.ts          # estado global del sistema (nuevo)
```

### 2.1 Separación entre `design/` y `features/`

Regla dura: **`design/` no sabe nada del dominio.**

| `design/` | `features/` |
|-----------|------------|
| `<MetricStation>` recibe `value`, `nature`, `freshness` | `<InventoryAccuracyStation>` sabe qué endpoint consultar y compone el `MetricStation` |
| No importa nada de `features/` | Importa libremente de `design/` |
| No conoce React Query | Usa React Query |
| Publicable como paquete independiente | Específico de OLO IA |

Esto permite que el design system se desarrolle, testee y documente en aislamiento total,
y que un cambio de endpoint nunca requiera tocar un componente visual.

---

## 3. CONVENCIÓN DE COMPONENTE

Cada componente del design system es una carpeta con estructura fija:

```
Button/
├── Button.tsx           # implementación
├── Button.types.ts      # interfaz pública
├── Button.variants.ts   # variantes (CVA — class-variance-authority)
├── Button.motion.ts     # variantes de Framer, si tiene movimiento
├── Button.test.tsx      # unitarios + jest-axe
├── Button.stories.tsx   # Storybook: todos los estados y variantes
└── index.ts             # export público
```

### 3.1 Variantes con CVA

```ts
// Button.variants.ts — las clases nunca se concatenan a mano
export const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium ' +
  'transition-[background,border-color,box-shadow] duration-[140ms] ' +
  'focus-visible:outline-none focus-visible:shadow-[var(--halo-focus)] ' +
  'disabled:opacity-40 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:   'bg-[--cyan-400] text-[--void-1000] shadow-[var(--halo-idle)] hover:bg-[--cyan-300]',
        secondary: 'border border-[--border-strong] text-[--text-primary] hover:border-[--cyan-400]',
        ghost:     'text-[--text-secondary] hover:text-[--text-primary] hover:bg-[--surface-active]',
        danger:    'border border-[--crimson-500] text-[--crimson-500] hover:bg-[--crimson-500] hover:text-[--void-1000]',
        command:   'border border-[--violet-500] text-[--violet-400] hover:bg-[--violet-500]/10',
      },
      size: {
        xs: 'h-6 px-2 text-[--text-2xs] rounded-[--radius-sm] gap-1',
        sm: 'h-7 px-3 text-[--text-xs] rounded-[--radius-sm] gap-1.5',
        md: 'h-8 px-4 text-[--text-sm] rounded-[--radius-md] gap-2',
        lg: 'h-10 px-5 text-[--text-base] rounded-[--radius-md] gap-2',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
```

### 3.2 Tailwind consumiendo tokens CSS

Tailwind **no** define los colores: los referencia. Una sola fuente de verdad.

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        void:     { 1000: 'var(--void-1000)', 950: 'var(--void-950)', /* ... */ },
        cyan:     { 400: 'var(--cyan-400)', /* ... */ },
        // ...
      },
      boxShadow: {
        'halo-idle':     'var(--halo-idle)',
        'halo-thinking': 'var(--halo-thinking)',
        'halo-alert':    'var(--halo-alert)',
        'halo-focus':    'var(--halo-focus)',
        'lift-1':        'var(--lift-1)',
        // ...
      },
      backdropBlur: { veil1: '12px', veil2: '20px', veil3: '32px' },
    },
  },
};
```

Consecuencia: cambiar de tema es cambiar el valor de las variables CSS en `:root`. Cero
recompilación, cero clases duplicadas por tema.

---

## 4. ESTRATEGIA DE BUNDLE

### 4.1 Presupuesto

| Bundle | Contenido | Objetivo |
|--------|----------|----------|
| **initial** | React, router, shell, design/primitives, tokens | **≤ 180KB** gzip |
| `login-scene` | R3F + GSAP + geometría de la escena | ≤ 400KB (lazy) |
| `twin` | R3F + drei + shaders + geometría del almacén | ≤ 320KB (lazy) |
| `charts` | Visx + gráficos | ≤ 90KB (lazy) |
| `lottie` | lottie-web/light + 6 animaciones | ≤ 60KB (lazy) |
| Por feature | Cada feature en su chunk | ≤ 60KB cada uno |

### 4.2 Reglas de carga

```ts
// La escena de login carga EN PARALELO al formulario, nunca antes.
// El formulario es interactivo a los 800ms sin esperar la escena.
const LoginScene3D = lazy(() => import('./scenes/LoginScene/Scene3D'));

// El Twin carga al entrar a la vista, con prefetch al hacer hover en el Spine.
const Twin3D = lazy(() => import('./design/stations/TwinStation/Twin3D'));

// Prefetch en hover sobre el item del Spine: cuando el usuario hace click,
// el chunk ya está en caché.
onMouseEnter={() => import('./design/stations/TwinStation/Twin3D')}
```

### 4.3 Verificación en CI

```
size-limit falla el build si:
  · initial > 180KB gzip
  · cualquier chunk lazy > su presupuesto
  · el total del bundle crece > 5% respecto a main sin justificación
```

---

## 5. RENDIMIENTO — REGLAS DE IMPLEMENTACIÓN

| Regla | Implementación |
|-------|---------------|
| Un solo `requestAnimationFrame` global | `AmbientClock` publica el tiempo; los componentes se suscriben |
| Animaciones pausadas fuera del viewport | `IntersectionObserver` en `Station` |
| Animaciones pausadas en pestaña oculta | `visibilitychange` detiene el reloj |
| Máximo 24 animaciones simultáneas | `useMotionBudget` registra y rechaza excedentes |
| Máximo 4 capas `backdrop-filter` | Contador en `Surface`, warning en desarrollo |
| Solo `transform`/`opacity`/`filter` animados | Regla de ESLint personalizada que prohíbe animar layout |
| `will-change` con ciclo de vida | Aplicado al iniciar, retirado al terminar |
| Tablas virtualizadas > 100 filas | TanStack Virtual obligatorio |
| Datos en vivo sin re-render del árbol | Suscripción granular vía Zustand selectors |
| El Twin fuera del árbol de React Query | Recibe datos por props estables, no re-monta |
| Degradación automática | `usePerformanceGuard` monitoriza FPS y baja el nivel |

### 5.1 Objetivos medibles

| Métrica | Objetivo | Herramienta |
|---------|---------|------------|
| FPS en Overview con 9 estaciones activas | ≥ 58 | Test de rendimiento en CI |
| FPS en Twin con 2000 racks + 8 agentes | ≥ 55 | — |
| FCP | < 1.2s | Lighthouse CI |
| TTI | < 2.0s | Lighthouse CI |
| INP | < 100ms | Web Vitals |
| CLS | < 0.02 | Lighthouse CI |
| Frame time de la escena de login | ≤ 8ms | Instrumentación propia |

Hardware de referencia para las mediciones: portátil corporativo de gama media de 3 años
(i5 de 8ª generación, gráficos integrados, 8GB). Si funciona ahí, funciona en cualquier
centro de distribución.

---

## 6. ACCESIBILIDAD — IMPLEMENTACIÓN

| Requisito | Cómo |
|-----------|------|
| Contraste AA | Test automatizado que recorre los tokens y verifica cada par de uso |
| Foco visible | `--halo-focus` en todo `:focus-visible`. Regla de ESLint contra `outline: none` |
| Navegación por teclado | Radix UI como base de overlays (foco gestionado, foco atrapado) |
| Movimiento reducido | `MotionProvider` lee la preferencia y sirve variantes alternativas |
| Transparencia reducida | `prefers-reduced-transparency` desactiva Veil en favor de superficie opaca |
| Datos en vivo | `aria-live="polite"` en valores que cambian; `assertive` solo en alertas |
| Estaciones | `<section aria-label>` con `aria-describedby` al footer de metadata |
| Gráficos | Tabla de datos equivalente accesible por teclado, `aria-hidden` en el SVG |
| Twin 3D | Panel de lista navegable por teclado con las mismas entidades |
| Atajos | Documentados en el Cortex, todos con alternativa por ratón |
| Tests | `jest-axe` en cada componente + Playwright con navegación solo por teclado |

> El Twin 3D es intrínsecamente inaccesible para un lector de pantalla. La solución no es
> renunciar al Twin: es ofrecer una **vista de lista equivalente** con la misma información
> (ubicaciones, ocupación, anomalías, dispositivos), navegable por teclado. Se accede con
> `T` desde el Twin y es un ciudadano de primera clase, no una concesión.

---

## 7. TESTING VISUAL

| Tipo | Herramienta | Alcance |
|------|-----------|---------|
| Unitario | Vitest + Testing Library | Lógica y renderizado de componentes |
| Accesibilidad | jest-axe | Todos los componentes del design system |
| Visual regression | Chromatic o Playwright screenshots | Todos los estados de cada componente |
| Interacción | Playwright | Flujos de usuario, navegación por teclado |
| Rendimiento | Playwright + trace | FPS en Overview y Twin |
| Bundle | size-limit | Presupuestos de §4.1 |
| Contraste | Script propio sobre tokens | Cada par color/fondo documentado |

---

*Documento 6 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
