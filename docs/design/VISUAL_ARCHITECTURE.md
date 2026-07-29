# OLO IA — ARQUITECTURA VISUAL

## Estructura espacial del centro de control

---

## 1. EL PRINCIPIO ORGANIZADOR

La aplicación **no** se organiza en páginas. Se organiza en **una superficie continua** con
distintos niveles de zoom y foco.

```
Modelo mental convencional (ERP):        Modelo mental de OLO IA:

  Página A  →  Página B  →  Página C       Una sola superficie
  (recarga)    (recarga)    (recarga)      Foco que se mueve
                                            Zoom que cambia
  El usuario "navega"                       El usuario "enfoca"
```

Consecuencia técnica: las transiciones entre vistas no son cambios de ruta con desmontaje.
Son movimientos de cámara y reordenación de foco sobre elementos que persisten.

---

## 2. ANATOMÍA DEL SHELL

```
┌────────────────────────────────────────────────────────────────────────────┐
│  VITALS BAR                                        32px · siempre visible  │
│  ● NOMINAL   47/47 EDGE   INF 12/s   TWIN SYNC   GPU 34%    [tenant] [◐]  │
├──────┬─────────────────────────────────────────────────────────────────────┤
│      │                                                                     │
│ SPINE│                      CANVAS                                         │
│      │                                                                     │
│  56px│   La superficie de trabajo. Contiene estaciones, el Twin,           │
│  ↕   │   o una vista de detalle. Nunca hay más de un Canvas.               │
│      │                                                                     │
│  ⬡   │   ┌──────────────────┐  ┌──────────────────┐                       │
│  ▣   │   │                  │  │                  │                       │
│  ◈   │   │    STATION       │  │    STATION       │                       │
│  ⬢   │   │                  │  │                  │                       │
│  ◉   │   └──────────────────┘  └──────────────────┘                       │
│  ⬡   │                                                                     │
│      │   ┌────────────────────────────────────────────┐                    │
│      │   │                                            │                    │
│      │   │           TWIN STATION                     │                    │
│      │   │                                            │                    │
│      │   └────────────────────────────────────────────┘                    │
│      │                                                                     │
├──────┴─────────────────────────────────────────────────────────────────────┤
│  STREAM                                            28px · colapsable       │
│  14:32:07  drone-04 detected anomaly · rack B-14 · confidence 0.94   ›     │
└────────────────────────────────────────────────────────────────────────────┘

           MESH — capa Z-0, detrás de todo, siempre viva
```

### 2.1 VITALS BAR (32px, superior, fija)

La franja de signos vitales del sistema. Nunca se oculta. Es el elemento que hace que el
producto se lea como centro de control desde el primer segundo.

| Zona | Contenido | Comportamiento |
|------|-----------|---------------|
| Izquierda | Indicador de estado global + etiqueta | Cambia de color y ritmo de pulso según estado |
| Centro-izq | Nodos Edge online / total | Se ilumina en ámbar si algún nodo cae |
| Centro | Throughput de inferencia (inf/s) | Valor numérico monoespaciado con micro-sparkline |
| Centro-der | Estado de sincronización del Twin | Icono + latencia |
| Derecha | GPU / carga del sistema | Barra horizontal de 40px |
| Extremo der | Selector de tenant/warehouse + avatar | Menú desplegable |

Altura de 32px: suficiente para 11px de tipografía HUD con respiración, insuficiente para
que robe protagonismo. Es instrumentación periférica, no contenido.

### 2.2 SPINE (56px, izquierda, fija)

La navegación. No es un sidebar con etiquetas de texto: es una **columna vertebral de
iconos** organizada por las tres capas cognitivas del ADN.

```
┌──────┐
│  ⬡   │  OVERVIEW      — la vista de mando, punto de partida
├──────┤
│      │  ── PERCEPCIÓN ──
│  ◉   │  TWIN          — gemelo digital, el espacio
│  ▣   │  VISION        — cámaras, streams, detecciones
│  ⬢   │  FLEET         — drones, AGVs, dispositivos
├──────┤
│      │  ── COGNICIÓN ──
│  ◈   │  INTELLIGENCE  — modelos, inferencias, predicciones
│  ⬟   │  ANALYTICS     — KPIs, tendencias, comparativas
├──────┤
│      │  ── ACCIÓN ──
│  ▤   │  INVENTORY     — stock, conteos, ajustes
│  ⚠   │  INCIDENTS     — anomalías, alertas, resolución
│  ⇄   │  INTEGRATION   — conectores, sincronización
├──────┤
│      │  ── SISTEMA ──
│  ⚙   │  ADMIN         — organización, usuarios, roles
│  ⧉   │  AUDIT         — trazabilidad
└──────┘
```

Comportamiento:
- **Colapsado (56px)** por defecto: solo iconos. Tooltip al hover tras 400ms.
- **Expandido (200px)** al hover sostenido o por preferencia persistida: iconos + etiquetas.
- La expansión **empuja** el Canvas, no lo cubre. El operador nunca pierde de vista datos.
- El item activo tiene una barra de acento de 2px en el borde izquierdo + halo.
- Los separadores de capa cognitiva son hairlines con etiqueta de 10px en mayúsculas
  (visible solo en expandido).
- Badge numérico sobre INCIDENTS cuando hay alertas abiertas.

### 2.3 CANVAS (flexible, el resto del espacio)

La superficie de trabajo. Tres modos:

| Modo | Descripción | Cuándo |
|------|-------------|--------|
| **Grid** | Retícula de estaciones autónomas | Overview, Analytics |
| **Immersive** | Una sola superficie a pantalla completa | Twin, Vision |
| **Focus** | Una entidad en detalle + estaciones de contexto laterales | Detalle de pallet, dron, incidencia |

La transición entre modos es continua: en Grid → Immersive, la estación del Twin **crece**
hasta llenar el Canvas mientras las demás se retiran hacia los bordes con blur creciente.

### 2.4 STREAM (28px, inferior, colapsable)

El flujo de consciencia del sistema. Una línea, siempre la más reciente, con scroll
horizontal implícito de eventos.

```
14:32:07  ◈ drone-04 detected anomaly · rack B-14 · conf 0.94              ›
```

- Cada evento entra desde la derecha con desplazamiento suave, empujando el anterior.
- El icono codifica el tipo de evento; el color, su severidad.
- Click expande a un panel de 240px con el historial completo filtrable.
- Colapsable a 4px (solo una línea de luz que pulsa cuando hay actividad).
- En estado de alerta, el Stream se expande automáticamente a 56px y muestra 2 líneas.

### 2.5 MESH (Z-0, capa de fondo global)

La red neuronal. **Existe en todas las vistas**, con intensidad variable según el modo.

| Contexto | Nodos visibles | Opacidad | Actividad |
|----------|---------------|----------|-----------|
| Login | ~180 | 0.85 | Alta, tejido completo |
| Overview | ~90 | 0.28 | Media, pulsos según eventos reales |
| Twin (Immersive) | ~40 | 0.12 | Baja, cede protagonismo a la geometría |
| Focus | ~50 | 0.18 | Pulsos solo en las conexiones de la entidad enfocada |
| Tablas / Admin | ~30 | 0.08 | Mínima, casi solo textura |

La Mesh no es aleatoria: los nodos **corresponden a entidades reales** (almacenes, áreas,
dispositivos). Un pulso que viaja por la Mesh representa un evento real propagándose. Esto
es lo que hace que la metáfora sea honesta y no decorativa.

---

## 3. LA ESTACIÓN — UNIDAD FUNDAMENTAL

Sustituye al concepto de "card". Una Station es una **pantalla independiente** dentro del
Canvas.

### 3.1 Anatomía

```
┌─────────────────────────────────────────────────────────┐
│ ◤ filo de luz superior (--grad-edge-top, 1px)           │
│                                                          │
│  INVENTORY ACCURACY                    ● LIVE     ⋯     │  ← header 36px
│  ─────────────────────────────────────────────────────  │
│                                                          │
│                                                          │
│     97.4 %                    ▁▂▃▅▆▇█▇▆▅▃▂▁            │  ← body
│     ▲ 0.6 vs 24h                                        │
│                                                          │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│  updated 2s ago · 12,847 positions          detail ›    │  ← footer 28px
└─────────────────────────────────────────────────────────┘
   ▔▔▔▔▔ halo derivado del estado del dato
```

| Zona | Alto | Contenido |
|------|------|-----------|
| Filo | 1px | Gradiente de luz. En estado de alerta, cambia al color de estado |
| Header | 36px | Título (uppercase, tracking wide, 11px) + indicador de frescura + menú |
| Body | flexible | El contenido. Nunca con padding propio: lo hereda de la Station |
| Footer | 28px | Metadata temporal + acción de profundizar (opcional) |

### 3.2 Estados de una Station

| Estado | Veil | Halo | Blur contenido | Escala | Cuándo |
|--------|------|------|---------------|--------|--------|
| `ambient` | VEIL-1 | `--halo-idle` opacity 0.4 | 3px | 1.0 | No es el foco |
| `active` | VEIL-2 | `--halo-idle` | 0 | 1.0 | Es el foco (hover o keyboard) |
| `thinking` | VEIL-2 | `--halo-thinking` | 0 | 1.0 | Procesando (inferencia, sync) |
| `alert` | VEIL-2 | `--halo-alert` | 0 | 1.005 | Anomalía en sus datos |
| `critical` | VEIL-CRITICAL | `--halo-critical` | 0 | 1.01 | Fallo que requiere acción |
| `stale` | VEIL-1 | ninguno | 0 | 1.0 | Sin datos frescos, patrón diagonal |
| `expanded` | VEIL-3 | `--halo-focus` | 0 | — | Ocupa el Canvas completo |

Detalle importante: en estado `alert` la escala es 1.005 (no 1.05). Un crecimiento de medio
punto porcentual es imperceptible como animación pero suficiente para que el ojo detecte
que ese panel se adelantó respecto a los demás. Es jerarquía subliminal.

### 3.3 Tipos de Station

| Tipo | Contenido | Tamaño típico (columnas × filas) |
|------|-----------|---------------------------------|
| `MetricStation` | Un KPI grande + sparkline + delta | 3 × 1 |
| `ChartStation` | Serie temporal, distribución, comparativa | 6 × 2 |
| `TwinStation` | Gemelo digital, cualquier nivel de zoom | 8 × 3 |
| `FeedStation` | Lista de eventos en vivo (detecciones, alertas) | 4 × 3 |
| `TableStation` | Datos tabulares densos | 12 × 3 |
| `VisionStation` | Stream de vídeo con overlay de detecciones | 4 × 2 |
| `FleetStation` | Estado de dispositivos, mapa de posición | 4 × 2 |
| `InferenceStation` | Actividad de modelos, throughput, precisión | 4 × 2 |
| `GaugeStation` | Medidor radial (GPU, ocupación, capacidad) | 2 × 1 |
| `HeatmapStation` | Mapa de calor sobre el layout del almacén | 6 × 3 |

### 3.4 Reglas de composición

- Máximo **9 estaciones** simultáneas en un Canvas Grid. Más de 9 supera la capacidad de
  atención y degrada el rendimiento.
- Máximo **1 estación en estado `alert`** con animación activa. Si hay varias alertas, se
  agrupa en una única `AlertStation` con contador.
- El `TwinStation` es opcional en Overview pero, si está, ocupa la posición de anclaje
  inferior-izquierda (el ojo occidental descansa allí).
- Ninguna estación tiene scroll interno excepto `FeedStation` y `TableStation`.

---

## 4. VISTAS PRINCIPALES

### 4.1 OVERVIEW — la vista de mando

Es la pantalla que define el producto. La primera que se ve, la que se usa como material
de venta.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ VITALS                                                                     │
├──┬─────────────────────────────────────────────────────────────────────────┤
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────────────┐  │
│S │ │ ACCURACY │ │  ALERTS  │ │ THROUGH- │ │  INFERENCE ACTIVITY       │  │
│P │ │  97.4%   │ │    3     │ │   PUT    │ │  ╱╲    ╱╲                 │  │
│I │ │  ▲0.6    │ │  ▲1      │ │  1,284/h │ │ ╱  ╲╱╲╱  ╲╱╲              │  │
│N │ └──────────┘ └──────────┘ └──────────┘ └───────────────────────────┘  │
│E │                                                                         │
│  │ ┌────────────────────────────────────┐ ┌───────────────────────────┐  │
│  │ │                                    │ │  LIVE DETECTIONS          │  │
│  │ │        DIGITAL TWIN                │ │  ◈ pallet · B-14 · 0.94   │  │
│  │ │        (nivel almacén)             │ │  ◈ pallet · A-07 · 0.91   │  │
│  │ │                                    │ │  ⚠ anomaly · B-14 · 0.88  │  │
│  │ │   racks · drones · AGVs · beacons  │ │  ◈ pallet · C-22 · 0.96   │  │
│  │ │                                    │ │  ◈ pallet · A-11 · 0.89   │  │
│  │ │                                    │ ├───────────────────────────┤  │
│  │ │                                    │ │  FLEET                    │  │
│  │ │                                    │ │  ⬢ drone-01  ● patrol     │  │
│  │ └────────────────────────────────────┘ │  ⬢ drone-04  ⚠ inspect    │  │
│  │                                        │  ⬢ agv-02    ● transit    │  │
│  │ ┌────────────────────┐ ┌────────────┐ │  ⬡ drone-02  ○ docked     │  │
│  │ │ OCCUPANCY HEATMAP  │ │ GPU / EDGE │ └───────────────────────────┘  │
│  │ └────────────────────┘ └────────────┘                                 │
├──┴─────────────────────────────────────────────────────────────────────────┤
│ STREAM                                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

Retícula: 12 columnas.
- Fila 1: cuatro `MetricStation` (3 col cada una) — pero la cuarta es un `ChartStation`
  de 6 col, así que la fila real es 3+3+3+3 o 3+3+6 según configuración.
- Fila 2-4: `TwinStation` (8 col × 3 filas) + columna derecha de 4 col con `FeedStation`
  y `FleetStation` apiladas.
- Fila 5: `HeatmapStation` (8 col) + `GaugeStation` compuesto (4 col).

El operador puede reorganizar (drag) y persistir su layout. Existen presets: *Operations*,
*Intelligence*, *Executive*.

### 4.2 TWIN — modo inmersivo

El gemelo digital a pantalla completa. La vista que vende el producto en una demo.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ VITALS                                                                     │
├──┬─────────────────────────────────────────────────────────────────────────┤
│  │  ┌─ LAYERS ─┐                                        ┌─ INSPECTOR ─┐   │
│S │  │ ☑ Racks  │                                        │ RACK B-14   │   │
│P │  │ ☑ Drones │         [ GEOMETRÍA 3D DEL ALMACÉN ]   │             │   │
│I │  │ ☑ AGVs   │                                        │ Occupancy   │   │
│N │  │ ☐ Routes │      trazas · beacons · conos de scan  │  84%        │   │
│E │  │ ☑ Heat   │                                        │             │   │
│  │  │ ☐ Sensors│                                        │ Last count  │   │
│  │  └──────────┘                                        │  2h ago     │   │
│  │                                                       │             │   │
│  │  ┌─ CAMERA ─┐                                        │ Anomalies   │   │
│  │  │ ⌂ Top    │                                        │  1 open ⚠   │   │
│  │  │ ◱ Iso    │                                        │             │   │
│  │  │ ▭ Front  │                                        │ [inspect]   │   │
│  │  │ ⊙ Free   │                                        └─────────────┘   │
│  │  └──────────┘                                                          │
│  │                          ┌─ TIMELINE ─────────────────────────────┐    │
│  │                          │ ◀◀ ◀ ⏸ ▶ ▶▶     14:32:07    [live] ● │    │
│  │                          └────────────────────────────────────────┘    │
├──┴─────────────────────────────────────────────────────────────────────────┤
│ STREAM                                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

Elementos flotantes sobre el Twin (todos en VEIL-2, arrastrables, colapsables):
- **LAYERS**: toggles de capas visuales.
- **CAMERA**: presets de cámara + control libre.
- **INSPECTOR**: aparece al seleccionar una entidad. Contextual.
- **TIMELINE**: scrubber temporal. Permite ver el estado del almacén en cualquier momento
  pasado. Es la característica que más impresiona en demo.

### 4.3 FOCUS — detalle de entidad

Cuando el usuario profundiza en un pallet, un dron, una incidencia.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ VITALS                                                                     │
├──┬─────────────────────────────────────────────────────────────────────────┤
│  │  ‹ back to twin        PALLET #4471                    [actions ▾]     │
│S │  ────────────────────────────────────────────────────────────────────  │
│P │                                                                         │
│I │  ┌───────────────────────────┐  ┌────────────────────────────────────┐│
│N │  │                           │  │ IDENTITY                           ││
│E │  │   ÚLTIMA CAPTURA IA       │  │ SKU        PRD-88213               ││
│  │  │   (imagen con bboxes)     │  │ Location   B-14-03-02              ││
│  │  │                           │  │ Quantity   48 units                ││
│  │  │   ┌──────┐                │  │ Lot        L-2026-0714             ││
│  │  │   │ 0.94 │                │  │ Expiry     2027-01-14              ││
│  │  │   └──────┘                │  ├────────────────────────────────────┤│
│  │  │                           │  │ INFERENCE HISTORY                  ││
│  │  └───────────────────────────┘  │ 14:32 detected  conf 0.94  ◈       ││
│  │                                  │ 12:18 detected  conf 0.91  ◈       ││
│  │  ┌───────────────────────────┐  │ 09:04 counted   manual     ✓       ││
│  │  │ POSICIÓN EN TWIN          │  ├────────────────────────────────────┤│
│  │  │ (mini-twin enfocado)      │  │ RELATED                            ││
│  │  └───────────────────────────┘  │ ⚠ Anomaly #221 · qty mismatch      ││
│  │                                  └────────────────────────────────────┘│
├──┴─────────────────────────────────────────────────────────────────────────┤
│ STREAM                                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

Principio: **el contexto nunca se pierde**. El mini-twin muestra dónde está la entidad. Las
relaciones (`RELATED`) hacen visible G3 del ADN.

### 4.4 Vistas operativas (Inventory, Incidents, Admin)

Estas vistas son más convencionales por necesidad: gestionan datos tabulares y formularios.
La identidad se mantiene mediante:

- La Mesh sigue presente (opacidad 0.08).
- Las tablas usan `TableStation` con el mismo material.
- Los formularios viven en paneles VEIL-3 que emergen lateralmente, no en modales centrados.
- Vitals y Stream siempre visibles: el operador nunca deja de ver el estado del sistema.

> Reconocimiento honesto: un CRUD de usuarios no puede ser cinematográfico. La disciplina
> es que **no traicione** el lenguaje: mismos materiales, mismo movimiento, misma densidad.
> El objetivo no es que un formulario sea espectacular, es que no rompa la ilusión.

---

## 5. CORTEX — LA BARRA DE COMANDO

`Cmd/Ctrl + K`. El punto de entrada a todo. En un centro de control, el teclado es más
rápido que el ratón.

```
┌──────────────────────────────────────────────────────────────┐
│  ⌕  rack b-14                                                │
├──────────────────────────────────────────────────────────────┤
│  LOCATIONS                                                   │
│  ◉  B-14        Warehouse Central · 84% occupancy      ⏎     │
│  ◉  B-14-03     Rack level 3 · 12 positions                  │
│                                                              │
│  ANOMALIES                                                   │
│  ⚠  #221        Quantity mismatch · B-14-03-02               │
│                                                              │
│  ACTIONS                                                     │
│  ▸  Start cycle count on B-14                                │
│  ▸  Dispatch drone to B-14                                   │
│  ▸  Open B-14 in Digital Twin                                │
│                                                              │
│  ASK OLO                                                     │
│  ◈  "why is B-14 accuracy dropping?"                    ⏎    │
└──────────────────────────────────────────────────────────────┘
```

Cuatro clases de resultado: **entidades**, **anomalías**, **acciones** y **consulta a la
IA**. La última convierte el Cortex en la interfaz conversacional del sistema sin necesidad
de un chatbot separado.

Material: VEIL-3, emerge desde el centro con escala 0.96 → 1.0 y blur decreciente. El fondo
completo recibe blur 8px. Duración 220ms.

---

## 6. JERARQUÍA DE ATENCIÓN

Cómo el sistema decide qué destaca. Orden estricto de prioridad:

```
1. CRÍTICO      Fallo de servicio, pérdida de dato        → Z-4, ámbar/carmesí, bloquea
2. ALERTA       Anomalía que requiere decisión            → Z-2 con halo alert, Stream expandido
3. FOCO         Lo que el usuario está mirando            → Z-2, halo focus, contexto en blur
4. VIVO         Datos actualizándose en tiempo real       → luminancia plena, pulso de latido
5. CONTEXTO     Información de apoyo                      → Z-1, blur 3px, opacity 0.75
6. AMBIENTE     Mesh, Twin de fondo, textura              → Z-0, blur 24px, opacity 0.35
```

Regla de exclusión: **nunca dos niveles 1-2 activos simultáneamente**. Si hay dos alertas
críticas, se agrupan. Un centro de control con tres cosas parpadeando es un centro de
control que se ignora.

---

## 7. RESPONSIVE Y ADAPTACIÓN

| Ancho | Spine | Canvas | Twin | Stream | Modo |
|-------|-------|--------|------|--------|------|
| ≥ 2560px | Expandido (200px) | 16 col | Completo + inspector | 2 líneas | Operación total |
| ≥ 1920px | Colapsado (56px) | 12 col | Completo | 1 línea | Operación estándar |
| ≥ 1536px | Colapsado | 12 col | Completo | 1 línea | Operación |
| ≥ 1280px | Colapsado | 8 col | Reducido | 1 línea | Operación mínima |
| ≥ 1024px | Overlay | 6 col | 2D simplificado | Colapsado | **Consulta** |
| < 1024px | Overlay | Apilado | Estático | Oculto | **Consulta** |

Modo **Consulta**: se pueden ver KPIs, alertas e historial. Están deshabilitadas las
acciones de operación (crear conteos, lanzar misiones, aprobar ajustes). Es intencional.

---

## 8. ESTADOS GLOBALES DE LA APLICACIÓN

| Estado | Manifestación |
|--------|--------------|
| **Booting** | Escena de login o secuencia de arranque abreviada |
| **Nominal** | Mesh respirando, Vitals en cian, Stream con actividad normal |
| **Thinking** | Pulsos violeta en la Mesh, Vitals con indicador de proceso |
| **Degraded** | Un servicio caído: Vitals en ámbar, banner de 24px bajo Vitals |
| **Offline** | Sin conexión: Mesh se congela y desatura, todas las Stations en `stale`, banner persistente, acciones deshabilitadas |
| **Maintenance** | Tenant en mantenimiento: overlay informativo, solo lectura |
| **Suspended** | Tenant suspendido: pantalla dedicada, sin acceso a datos |

El estado **Offline** merece atención especial: es el momento en que un centro de control
demuestra su calidad. La Mesh congelándose y desaturándose comunica "el sistema perdió sus
sentidos" mejor que cualquier mensaje de error.

---

*Documento 3 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
