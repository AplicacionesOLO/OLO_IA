# OLO IA — BIBLIOTECA DE COMPONENTES

## Catálogo de componentes reutilizables

---

## 1. ORGANIZACIÓN

Cuatro capas. Un componente solo puede depender de capas inferiores.

```
L4  ORGANISMS   Vistas compuestas: OverviewCanvas, TwinCanvas, Cortex
L3  STATIONS    Unidades de información: MetricStation, TwinStation, FeedStation
L2  MOLECULES   Combinaciones: DataField, StatusIndicator, MetricValue, Sparkline
L1  PRIMITIVES  Átomos: Button, Input, Badge, Icon, Surface, Halo
L0  FOUNDATION  Tokens, Veil, AmbientClock, MotionProvider, FocusContext
```

---

## 2. L0 — FOUNDATION

### 2.1 `<Surface>`
El componente que materializa el sistema de planos Z. **Todo** contenedor visual lo usa.

```ts
interface SurfaceProps {
  plane: 'ambient' | 'context' | 'work' | 'decision' | 'critical';  // Z-0..Z-4
  state?: 'idle' | 'thinking' | 'alert' | 'critical' | 'stale';
  halo?: boolean | 'focus';
  radius?: 'sm' | 'md' | 'lg' | 'xl';
  edge?: boolean;            // filo de luz superior
  interactive?: boolean;     // habilita hover/focus
  as?: ElementType;
}
```
Resuelve internamente: superficie + Veil + Halo + Lift + blur de contenido, según la tabla
de composición Z del Design System §5.4. Ningún componente aplica `backdrop-filter`
directamente: siempre pasa por `Surface`, que participa del contador global de capas blur.

### 2.2 `<MotionProvider>`
Provee el reloj ambiental único y las preferencias de movimiento.

```ts
interface MotionContextValue {
  clock: AmbientClock;                    // t, breath, pulse, frame
  systemState: SystemState;               // idle | thinking | alert | critical | offline
  reducedMotion: boolean;
  performanceMode: 'full' | 'reduced' | 'minimal';
  registerAnimation: () => () => void;    // para el presupuesto de 24 simultáneas
}
```

### 2.3 `<FocusContext>`
Implementa la coherencia neuronal (G3). Un identificador de entidad enfocada, global.

```ts
interface FocusContextValue {
  focused: EntityRef | null;              // { type, id }
  setFocus: (e: EntityRef | null) => void;
  isFocused: (e: EntityRef) => boolean;
  isRelated: (e: EntityRef) => boolean;   // relación conocida con lo enfocado
}
```
Cualquier componente que represente una entidad se suscribe. Al enfocar un pallet, todos
los componentes que lo contienen reaccionan con el stagger de FOCUS RIPPLE.

### 2.4 `<MeshLayer>`
La red neuronal de fondo. Una sola instancia, montada en el shell.

```ts
interface MeshLayerProps {
  density: 'minimal' | 'low' | 'medium' | 'high' | 'full';  // 30..180 nodos
  opacity: number;
  nodes?: MeshNode[];        // si se omite, se genera proceduralmente
  pulses?: MeshPulse[];      // eventos reales propagándose
}
```
Canvas 2D con `OffscreenCanvas` cuando esté disponible. Nunca WebGL: no lo necesita y así
no compite con el Twin por el contexto de GPU.

---

## 3. L1 — PRIMITIVES

### 3.1 `<Button>`

| Variante | Uso | Tratamiento |
|----------|-----|-------------|
| `primary` | Acción principal, una por vista | Fondo `--cyan-400`, texto `--void-1000`, halo idle |
| `secondary` | Acciones habituales | Borde `--border-strong`, fondo transparente, texto `--mist-050` |
| `ghost` | Acciones terciarias, iconos | Sin fondo ni borde, hover ilumina |
| `danger` | Destructivas | Borde carmesí, texto carmesí, hover rellena |
| `command` | Dispara un proceso del sistema | Borde violeta, muestra SCAN mientras procesa |

Tamaños: `xs` 24px · `sm` 28px · `md` 32px · `lg` 40px. Diana mínima 24×24 (WCAG 2.5.8).

Estados: default, hover, active, focus-visible, disabled, `loading` (SCAN interno),
`success` (CONFIRM), `error`.

### 3.2 `<Input>` / `<Select>` / `<Textarea>` / `<Combobox>`
Sin borde en reposo: solo una hairline inferior. Al enfocar, la hairline se convierte en
gradiente de acento y el campo recibe halo focus. El label flota sobre el campo con
transición de 140ms.

Requisitos: `aria-invalid`, `aria-describedby` para el mensaje de error, el error nunca
desplaza el layout (ocupa espacio reservado).

### 3.3 `<Badge>` / `<Chip>` / `<Tag>`
`Badge` es informativo (estado, contador). `Chip` es removible. `Tag` es seleccionable.
Variantes por estado semántico. Tamaños `xs` y `sm` únicamente.

### 3.4 `<Icon>`
Wrapper de Lucide + el set propio de dominio. `currentColor` siempre. Tamaños 14/16/20/24/32.

### 3.5 `<Halo>`
Envuelve un hijo y le aplica el glow de estado, con la intensidad modulada por el reloj
ambiental. Es el componente que hace que la luz venga del dato (G2).

### 3.6 `<Veil>`
Capa de glass independiente, para casos en que se necesita el material sin la semántica
completa de `Surface` (por ejemplo, el backdrop del Cortex).

---

## 4. L2 — MOLECULES

### 4.1 `<MetricValue>`
Un número con toda su semántica.

```ts
interface MetricValueProps {
  value: number;
  unit?: string;
  precision?: number;
  nature: 'measured' | 'inferred' | 'predicted' | 'imported' | 'manual';
  freshness: 'live' | 'recent' | 'cooling' | 'historic' | 'stale';
  size: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  delta?: { value: number; period: string; polarity?: 'higher-better' | 'lower-better' };
}
```
Comportamiento: COUNT al cambiar, micro-glow del color de `nature`, opacidad según
`freshness`, tipografía monoespaciada tabular. El `delta` colorea según `polarity` (una
caída de accuracy es mala; una caída de tiempo de ciclo es buena).

### 4.2 `<StatusIndicator>`
Punto de estado con forma redundante (Design System §6.3) y pulso derivado del reloj.
Tamaños `xs`..`md`. Opcionalmente con etiqueta.

### 4.3 `<FreshnessIndicator>`
Micro-componente de 3 barras que codifica la antigüedad del dato. Con tooltip que muestra
el timestamp exacto.

### 4.4 `<Sparkline>`
Serie temporal minimalista. Sin ejes, sin rejilla. Área con gradiente que se desvanece
hacia abajo. Al cambiar el dato, el path interpola (no se redibuja de golpe). Máximo 60
puntos. SVG.

### 4.5 `<DataField>`
Par etiqueta/valor. Etiqueta en 11px uppercase tracking wide, valor en la tipografía
correspondiente a su tipo. Layout horizontal o vertical.

### 4.6 `<ConfidenceBar>`
Barra de confianza de una inferencia de IA. Color violeta. Muestra el valor numérico y el
umbral configurado. Por debajo del umbral: el color pasa a ámbar.

### 4.7 `<DeltaIndicator>`
Flecha + valor + período. Colorea según polaridad del indicador, no según el signo.

### 4.8 `<Timestamp>`
Muestra tiempo relativo (`2s ago`) con tooltip de tiempo absoluto en la zona horaria del
almacén. Se actualiza sin re-render del padre. Ojo: la zona horaria es del **warehouse**,
no del navegador.

### 4.9 `<EntityRef>`
Referencia clicable a una entidad (pallet, rack, dron, incidencia). Al hacer hover dispara
FOCUS RIPPLE. Es el componente que teje la coherencia neuronal en toda la aplicación.

---

## 5. L3 — STATIONS

### 5.1 `<Station>` — el contenedor base

```ts
interface StationProps {
  title: string;
  state?: StationState;              // ambient|active|thinking|alert|critical|stale
  span?: { cols: number; rows: number };
  priority?: number;                 // orden de entrada en el stagger
  freshness?: Freshness;
  actions?: StationAction[];         // menú ⋯
  detailHref?: string;               // enlace del footer
  expandable?: boolean;
  children: ReactNode;
}
```
Compone: `Surface` (plano según estado) + header + body + footer. Registra su animación en
el presupuesto. Se pausa cuando sale del viewport.

### 5.2 Catálogo de estaciones

| Componente | Contenido | Span típico |
|-----------|-----------|-------------|
| `<MetricStation>` | KPI grande + sparkline + delta | 3 × 1 |
| `<ChartStation>` | Serie, distribución o comparativa | 6 × 2 |
| `<TwinStation>` | Gemelo digital, nivel de zoom variable | 8 × 3 |
| `<FeedStation>` | Eventos en vivo con entrada animada | 4 × 3 |
| `<TableStation>` | Datos tabulares densos, virtualizados | 12 × 3 |
| `<VisionStation>` | Stream de vídeo + overlay de detecciones | 4 × 2 |
| `<FleetStation>` | Dispositivos: estado, batería, posición | 4 × 2 |
| `<InferenceStation>` | Throughput, precisión, cola de modelos | 4 × 2 |
| `<GaugeStation>` | Medidor radial (GPU, ocupación) | 2 × 1 |
| `<HeatmapStation>` | Mapa de calor sobre el layout | 6 × 3 |
| `<AlertStation>` | Alertas agrupadas con acciones | 4 × 2 |
| `<TimelineStation>` | Eventos en eje temporal | 12 × 2 |

### 5.3 `<TwinStation>` — el componente crítico

```ts
interface TwinStationProps {
  level: 'network' | 'warehouse' | 'area' | 'location';
  entityId: string;
  layers: TwinLayer[];               // racks, drones, agvs, routes, heat, sensors
  camera?: CameraPreset | 'free';
  beacons?: Beacon[];
  traces?: Trace[];
  timeline?: { mode: 'live' | 'historic'; at?: Date };
  onSelect?: (e: EntityRef) => void;
}
```
Implementación: React Three Fiber. `InstancedMesh` para racks (~2000 instancias, 1 draw
call). Geometría procedural desde los datos de `core.locations`. LOD por distancia de
cámara. Degrada a `<TwinStation2D>` (Canvas 2D isométrico) si no hay WebGL2 o si el
rendimiento cae.

### 5.4 `<TableStation>`
Sin filas zebra. Densidad de luz: la fila en hover se ilumina. Header sticky con hairline.
Virtualización obligatoria por encima de 100 filas. Columnas numéricas con tipografía
tabular y alineación derecha. Selección múltiple con barra de acciones que emerge desde
abajo. Cada celda que referencia una entidad usa `<EntityRef>`.

---

## 6. L4 — ORGANISMS

### 6.1 Shell

| Componente | Descripción |
|-----------|-------------|
| `<AppShell>` | Compone Vitals + Spine + Canvas + Stream + MeshLayer |
| `<VitalsBar>` | Franja de signos vitales, 32px, con reloj ambiental |
| `<Spine>` | Navegación vertical por capas cognitivas, colapsable |
| `<Canvas>` | Contenedor de modo grid/immersive/focus con transiciones de layout |
| `<StreamBar>` | Flujo de eventos, 28px, expandible a 240px |

### 6.2 `<Cortex>` — command palette
`Cmd/Ctrl+K`. Cuatro clases de resultado: entidades, anomalías, acciones y consulta a la IA.
Navegación completa por teclado. Búsqueda difusa con resaltado. Historial de comandos
recientes. Es la interfaz conversacional del sistema sin ser un chatbot.

### 6.3 Overlays

| Componente | Comportamiento |
|-----------|---------------|
| `<Dialog>` | Emerge desde el punto de origen del click, no centrado sin contexto |
| `<SidePanel>` | Panel lateral de 400/560/720px. **Sustituye a los modales para formularios** |
| `<Drawer>` | Panel inferior para acciones sobre selección múltiple |
| `<Popover>` | Contenido contextual anclado a un trigger |
| `<Tooltip>` | Delay 400ms, VEIL-2, nunca contiene información esencial |
| `<ContextMenu>` | Menú de clic derecho sobre entidades del Twin y filas de tabla |

### 6.4 Feedback

| Componente | Comportamiento |
|-----------|---------------|
| `<Toast>` | Esquina inferior derecha, apilable máx 3, auto-dismiss 5s |
| `<AlertBanner>` | Franja bajo Vitals para estados degradados. Persistente |
| `<CriticalOverlay>` | Z-4. El único componente con permiso de bloquear |
| `<ConfirmAction>` | Confirmación en línea, no modal, para acciones reversibles |

### 6.5 Estados

| Componente | Tratamiento |
|-----------|-------------|
| `<Skeleton>` | Forma del contenido real + SCAN horizontal. **Nunca** un pulso genérico |
| `<EmptyState>` | Ilustración de línea (nodo desconectado) + causa + acción sugerida |
| `<ErrorState>` | Qué falló, por qué, qué hacer, y `trace_id` copiable |
| `<OfflineState>` | Mesh congelada y desaturada + banner + acciones deshabilitadas |
| `<LoadingScan>` | SCAN sobre una región. Reemplaza al spinner |
| `<ProgressRing>` | Progreso determinista. Solo cuando se conoce el porcentaje real |

> **Regla sobre loaders**: si se conoce el progreso, se muestra progreso. Si no, se muestra
> SCAN. Nunca un spinner circular sin información: no comunica nada y es el gesto visual
> más genérico que existe.

---

## 7. GRÁFICOS

Base: **Visx** (primitivas de D3 con componentes React). No Recharts ni Chart.js: su
estética es demasiado convencional y su personalización, limitada.

| Componente | Uso |
|-----------|-----|
| `<TimeSeries>` | Métricas en el tiempo. Área con gradiente, sin rejilla horizontal |
| `<StackedFlow>` | Composición a lo largo del tiempo |
| `<Distribution>` | Histograma o densidad |
| `<RadialGauge>` | Medidor con arco. GPU, ocupación, capacidad |
| `<Heatmap>` | Matriz de intensidad. Proyectable sobre el layout del almacén |
| `<NetworkGraph>` | Grafo de relaciones. Usa el mismo motor que la Mesh |
| `<ConfidenceScatter>` | Dispersión de confianza de inferencias |
| `<Waterfall>` | Descomposición de una discrepancia de inventario |

### 7.1 Reglas de los gráficos

- Cero rejilla horizontal. Se usan hairlines de `--graphite-700` solo si es imprescindible.
- El eje Y no empieza en 0 si eso oculta la variación relevante, pero **se indica**.
- Series de IA en violeta con línea discontinua; series medidas en cian, línea continua.
- Al cambiar el dato, el path interpola.
- Tooltip sigue el cursor con `spring.snap`.
- Sin leyendas flotantes: las series se etiquetan en su extremo derecho.
- Todo gráfico tiene alternativa accesible: tabla de datos accesible por teclado.

---

## 8. INVENTARIO Y ESFUERZO

| Capa | Componentes | Esfuerzo |
|------|------------|----------|
| L0 Foundation | 6 | 5 días |
| L1 Primitives | 14 | 8 días |
| L2 Molecules | 12 | 6 días |
| L3 Stations | 13 | 14 días |
| L4 Organisms | 22 | 16 días |
| Gráficos | 8 | 8 días |
| **Total** | **75** | **~57 días** |

Cada componente entrega: implementación, tipos, historia de Storybook, test de accesibilidad
(`jest-axe`), y estados documentados.

---

*Documento 5 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
