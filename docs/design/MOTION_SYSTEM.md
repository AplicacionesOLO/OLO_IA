# OLO IA — SISTEMA DE MOVIMIENTO

## El lenguaje temporal del sistema

---

## 1. LA TESIS DEL MOVIMIENTO

En OLO IA el movimiento no es adorno: es **el canal por el que el sistema comunica que
piensa**. Un ERP se mueve para "sentirse moderno". NWOS se mueve porque hay algo ocurriendo.

### 1.1 Las cuatro leyes

**Ley 1 — Todo movimiento tiene causa.**
Ninguna animación existe porque quede bien. Cada una responde a: un evento del sistema, una
acción del usuario, un cambio de estado, o el latido base de la aplicación. Si no se puede
nombrar la causa, se elimina la animación.

**Ley 2 — Todo movimiento tiene origen y destino espacial.**
Prohibido el `fade` puro. Un elemento que aparece viene de algún sitio: del punto donde se
hizo click, del borde de la pantalla, del centro de su contenedor padre. El usuario debe
poder deshacer mentalmente el recorrido.

**Ley 3 — La masa determina la duración.**
Un elemento grande tarda más que uno pequeño. Es física básica y el cerebro lo espera.
Un badge cambia en 120ms; un panel de pantalla completa, en 420ms.

**Ley 4 — El movimiento nunca bloquea.**
Ninguna animación impide interactuar. Toda transición es interrumpible. Si el usuario hace
click durante una animación de entrada, la animación se resuelve inmediatamente al estado
final y procesa el click.

---

## 2. CURVAS DE ACELERACIÓN

### 2.1 El set canónico

```ts
export const easing = {
  // ── ENTRADA ────────────────────────────────────────────────
  // Emerge con energía y se asienta. El overshoot es mínimo (2%):
  // suficiente para sentirse vivo, insuficiente para parecer juguetón.
  emerge:    [0.16, 1.00, 0.30, 1.00],   // easeOutExpo modificado

  // ── SALIDA ─────────────────────────────────────────────────
  // Se retira rápido. Nadie quiere esperar a que algo desaparezca.
  retire:    [0.55, 0.00, 1.00, 0.45],   // easeInExpo

  // ── TRANSICIÓN ─────────────────────────────────────────────
  // Movimiento A→B. Simétrico, predecible, sin drama.
  glide:     [0.45, 0.05, 0.55, 0.95],   // easeInOutQuart

  // ── PRECISIÓN ──────────────────────────────────────────────
  // Micro-interacciones. Casi lineal, respuesta inmediata.
  precise:   [0.30, 0.00, 0.35, 1.00],

  // ── CINEMATOGRÁFICO ────────────────────────────────────────
  // Cámara, escena de login, cambios de nivel de zoom.
  // Aceleración muy lenta al final: sensación de peso y escala.
  cinematic: [0.22, 1.00, 0.36, 1.00],

  // ── ORGÁNICO ───────────────────────────────────────────────
  // El latido, la respiración, los pulsos de la Mesh.
  breathe:   [0.37, 0.00, 0.63, 1.00],   // sinusoidal
} as const;
```

### 2.2 Física de resortes (Framer Motion)

Para gestos y elementos que el usuario manipula directamente, el resorte es superior a la
curva: responde a la velocidad del gesto.

```ts
export const spring = {
  // Respuesta inmediata: toggles, checkboxes, switches
  snap:    { type: 'spring', stiffness: 700, damping: 40, mass: 0.5 },

  // Estándar: paneles, estaciones, elementos de tamaño medio
  fluid:   { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 },

  // Elementos grandes: expansión de estación, cambio de modo de Canvas
  heavy:   { type: 'spring', stiffness: 180, damping: 28, mass: 1.4 },

  // Arrastre: reordenar estaciones, mover paneles del Twin
  drag:    { type: 'spring', stiffness: 500, damping: 38, mass: 0.7 },
} as const;
```

Regla: **damping siempre ≥ 28**. Por debajo aparece rebote visible, que en software
industrial se lee como falta de seriedad.

---

## 3. ESCALA DE DURACIONES

```ts
export const duration = {
  instant:  80,    // feedback de pulsación, cambio de color de estado
  quick:    140,   // hover, focus, cambio de icono
  base:     220,   // estándar: entrada de panel, apertura de menú
  moderate: 340,   // expansión de estación, cambio de modo
  slow:     480,   // transición entre vistas, movimiento de cámara
  scene:    900,   // cambio de nivel de zoom en el Twin
  epic:     1800,  // secuencia de entrada post-login
} as const;
```

### 3.1 Duración por masa

| Elemento | Área aproximada | Duración |
|----------|----------------|----------|
| Badge, chip, indicador | < 2.000 px² | `instant` – `quick` |
| Botón, input, fila de tabla | < 20.000 px² | `quick` |
| Tooltip, menú, popover | < 80.000 px² | `base` |
| Station | < 300.000 px² | `base` – `moderate` |
| Panel lateral, diálogo | < 600.000 px² | `moderate` |
| Canvas completo, cambio de vista | pantalla completa | `slow` |
| Cambio de nivel de zoom del Twin | pantalla completa + 3D | `scene` |

---

## 4. STAGGER — LA ENTRADA ESCALONADA

La aparición secuencial es la firma de movimiento de OLO IA. Comunica que el sistema
construye la interfaz pieza por pieza, con intención.

```ts
export const stagger = {
  tight:  0.024,   // filas de tabla, items de lista
  base:   0.045,   // items de menú, chips
  loose:  0.070,   // estaciones en el Canvas
  scene:  0.110,   // líneas del HUD de diagnóstico en el login
} as const;
```

### 4.1 Reglas de stagger

- **Límite de 12 elementos.** A partir del 12º, el stagger se colapsa a 0. Una lista de 200
  filas escalonadas tarda 5 segundos: inaceptable.
- **Orden por prioridad, no por posición DOM.** Las estaciones entran en orden de
  importancia (alertas primero, luego KPIs, luego contexto), no de arriba-izquierda a
  abajo-derecha.
- **En salida, el orden se invierte.** Lo último que entró es lo primero que sale.

---

## 5. EL LATIDO — MOVIMIENTO AMBIENTAL

El movimiento que nunca se detiene. Es lo que hace que una captura estática se sienta viva.

### 5.1 Frecuencias base

```ts
export const ambient = {
  // Respiración del sistema. Todo lo ambiental se sincroniza con esto.
  breathPeriod:   4000,   // ms — un ciclo completo
  breathAmplitude: 0.06,  // variación de opacidad: ±6%

  // Latido de dato en vivo. Más rápido que la respiración.
  pulsePeriod:    1800,
  pulseAmplitude: 0.14,

  // Deriva de la Mesh. Movimiento lateral casi imperceptible.
  meshDriftPeriod: 24000,
  meshDriftRange:  12,    // px

  // Partículas ambientales
  particleSpeed:  0.18,   // px/frame
  particleCount:  40,     // en Overview. 120 en login.
} as const;
```

### 5.2 Sincronización global

Todo el movimiento ambiental deriva de **un único reloj** compartido. Sin esto, 40 elementos
pulsando con fases independientes produce un caos visual que fatiga.

```ts
// Un solo requestAnimationFrame global publica el tiempo normalizado.
// Los componentes se suscriben y derivan su fase de él.
// Coste: 1 rAF en lugar de N. Coherencia visual: total.

interface AmbientClock {
  t: number;              // ms desde el arranque
  breath: number;         // 0..1 sinusoidal, período 4000ms
  pulse: number;          // 0..1 sinusoidal, período 1800ms
  frame: number;
}
```

Cuando el estado global pasa a `alert`, el período de respiración baja de 4000ms a 2400ms.
**Toda la aplicación se acelera al mismo tiempo.** El operador percibe la urgencia
corporalmente, antes de leer nada.

### 5.3 Ritmo por estado del sistema

| Estado | Período de respiración | Amplitud | Efecto percibido |
|--------|----------------------|----------|-----------------|
| `idle` | 4000ms | 0.06 | Calma, sistema atento |
| `thinking` | 3000ms | 0.10 | Actividad, procesamiento |
| `alert` | 2400ms | 0.16 | Urgencia contenida |
| `critical` | 1600ms | 0.22 | Urgencia máxima |
| `offline` | detenido | 0 | Sistema sin sentidos |

---

## 6. CATÁLOGO DE MOVIMIENTOS

### 6.1 EMERGE — aparición de superficie

El movimiento por defecto para paneles, estaciones y diálogos.

```ts
const emergeVariants = {
  hidden: {
    opacity: 0,
    scale: 0.97,
    y: 12,
    filter: 'blur(6px)',
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.22, ease: easing.emerge },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: 6,
    filter: 'blur(4px)',
    transition: { duration: 0.14, ease: easing.retire },
  },
};
```

El `blur` de entrada es lo que diferencia esto de un fade genérico: el elemento se
**enfoca** al llegar, como una lente ajustándose.

### 6.2 PULSE — propagación de evento por la Mesh

El movimiento más característico del sistema. Un evento real viaja desde su nodo de origen
hasta el panel que lo representa.

```
Nodo origen (dron detecta)
    │
    │  Fase 1 (0-120ms): el nodo origen destella
    │      scale 1 → 1.4 → 1, opacity 0.4 → 1 → 0.6
    │
    ▼  Fase 2 (120-540ms): el pulso viaja por la conexión
    │      un punto luminoso recorre el path SVG
    │      deja una estela que se desvanece a 180ms
    │      la conexión completa se ilumina al 40% y decae
    │
    ▼  Fase 3 (540-700ms): el destino recibe
           el nodo destino destella
           la Station asociada cambia a estado `thinking`
           el valor se actualiza con COUNT (§6.4)
```

Duración total: ~700ms. Es la animación más larga del uso normal, y está justificada:
representa un recorrido físico real.

Implementación: `<motion.circle>` sobre un `<path>` SVG con `offsetPath`. Máximo **6 pulsos
simultáneos**; los excedentes se encolan.

### 6.3 SCAN — procesamiento sobre una región

Reemplaza al spinner. Comunica *qué* se está procesando, no solo *que* algo se procesa.

```
Una línea de luz horizontal (2px, gradiente que se desvanece en los extremos)
recorre la región de arriba a abajo.

Duración: 1400ms por pasada. Loop mientras dure el proceso.
Easing: linear (un escáner no acelera).
La región tiene un halo `--halo-thinking` mientras el scan está activo.
Al completar: el scan hace una última pasada más rápida (600ms) y desaparece.
```

Usos: inferencia en curso sobre una imagen, sincronización de un conector, análisis de un
área del Twin.

### 6.4 COUNT — transición de valor numérico

Un número **nunca** salta de un valor a otro. Interpola.

```ts
// Duración proporcional a la magnitud del cambio, con techo.
function countDuration(from: number, to: number): number {
  const delta = Math.abs(to - from);
  const magnitude = Math.log10(delta + 1);
  return Math.min(120 + magnitude * 180, 800);
}

// Easing: easing.precise
// Los dígitos que no cambian NO se re-renderizan (evita jitter)
// Números tabulares obligatorios: sin ellos, el ancho oscila
```

Detalle: al cambiar, el valor recibe un micro-glow de 200ms en el color de su naturaleza
(`--data-measured` o `--data-inferred`). El ojo detecta qué cambió sin comparar.

### 6.5 FOCUS RIPPLE — coherencia neuronal

Implementa G3 del ADN. Al enfocar una entidad, todos los paneles que la contienen reaccionan.

```
Usuario hace hover sobre pallet #4471 en la tabla
    │
    ├─ 0ms     la fila recibe halo focus
    ├─ 40ms    el Twin resalta la ubicación B-14-03-02 (beacon cian)
    ├─ 80ms    el gráfico de rotación marca el punto correspondiente
    ├─ 120ms   el FeedStation filtra visualmente las detecciones relacionadas
    └─ 160ms   la Mesh ilumina las conexiones de esa entidad
```

Stagger de 40ms hacia afuera desde el punto de interacción. El retardo es lo que hace que
se perciba como **propagación** y no como cambio simultáneo. Es la diferencia entre "el
sistema reaccionó" y "el sistema pensó".

Al salir del hover: el mismo recorrido en orden inverso, duración 0.6×.

### 6.6 CAMERA — cambio de nivel de zoom

El movimiento que hace sentir la escala del sistema (G7 del ADN).

```
Nivel Red → Nivel Almacén:

  0-100ms     los demás almacenes se desvanecen hacia los bordes (scale + blur)
  100-600ms   push-in hacia el almacén seleccionado (scale 1 → 3.2, con motion blur)
  400-900ms   la geometría del almacén se materializa (wireframe → superficie)
  700-900ms   los paneles de contexto entran con stagger loose

Easing: easing.cinematic
Duración total: 900ms (duration.scene)
```

El motion blur durante el push-in es lo que convierte un zoom en un movimiento de cámara.
Se implementa como un `filter: blur()` direccional aplicado solo durante los 200ms centrales
del movimiento, cuando la velocidad es máxima.

### 6.7 TRACE — estela de objeto en movimiento

Drones, AGVs y rutas de picking dejan estela.

```
Un objeto que se mueve por el Twin deja un path que:
  · nace con opacity 0.7 y grosor 2px
  · decae a opacity 0 en 2400ms
  · se estrecha a 0.5px en el mismo tiempo
  · el color es el del estado del objeto

Máximo 200 puntos por traza (se descartan los más antiguos).
Máximo 8 trazas simultáneas.
```

### 6.8 ALERT INTRUSION — llegada de alerta crítica

El único movimiento que tiene permiso para interrumpir.

```
  0ms      el estado global pasa a `alert`: TODA la aplicación acelera su respiración
  0-80ms   Vitals cambia a ámbar (transición de color, no de posición)
  80ms     el Stream se expande de 28px a 56px
  120ms    la Station afectada pasa a estado `alert`: halo ámbar, escala 1.005
  160ms    un beacon ámbar aparece en el Twin sobre la ubicación afectada
  200ms    si es crítico: panel Z-4 emerge desde el borde superior (no centrado)
```

Deliberadamente **no** hay sonido, no hay parpadeo agresivo, no hay modal centrado. La
alerta se impone por coherencia de todo el sistema, no por estridencia. Es la diferencia
entre un centro de control profesional y una alarma de coche.

### 6.9 CONFIRM — acción completada

```
  0-100ms    el botón colapsa ligeramente (scale 0.98) y su halo pasa a jade
  100-180ms  aparece un check que se dibuja (stroke-dashoffset animado)
  180-1200ms el check permanece
  1200-1400ms fade out, el botón vuelve a su estado normal
```

El check **se dibuja**, no aparece. Dibujar un trazo comunica ejecución; aparecer, no.

---

## 7. TRANSICIONES ENTRE VISTAS

No hay desmontaje/montaje. Hay reordenación de foco.

### 7.1 Overview → Twin (Grid → Immersive)

```
  0-60ms      las Stations que no son el Twin comienzan a retirarse:
              scale 0.94, opacity → 0, desplazamiento radial hacia afuera
              stagger inverso (las más lejanas del Twin salen primero)
  60-400ms    la TwinStation crece: su rect se interpola hasta llenar el Canvas
              usa layout animation (Framer `layoutId`), no scale
  200-500ms   la geometría 3D gana detalle (LOD sube)
  400-560ms   los paneles flotantes (Layers, Camera, Timeline) entran con stagger
```

`layoutId` es clave: el Twin **es el mismo elemento**, no uno nuevo. El navegador interpola
su posición y tamaño. El usuario percibe continuidad física.

### 7.2 Cualquier vista → Focus

```
  0-40ms      el elemento origen (fila, nodo del Twin, item del feed) se ilumina
  40-340ms    el elemento crece y se desplaza hacia su posición en la vista Focus
              (layoutId compartido)
  120-340ms   el resto del Canvas se retira con blur creciente
  280-460ms   los paneles de contexto de Focus entran con stagger loose
```

El elemento sobre el que se hizo click **se convierte** en el elemento principal de la
siguiente vista. Es la ley 2 aplicada al máximo.

### 7.3 Navegación por el Spine

```
  0-40ms      el item del Spine recibe la barra de acento (transición de posición
              de la barra desde el item anterior: la barra se DESLIZA, no salta)
  40-200ms    el Canvas actual sale con desplazamiento horizontal de 24px + blur + fade
              (dirección según posición relativa en el Spine: hacia arriba o abajo)
  180-420ms   el Canvas nuevo entra desde la dirección opuesta
```

La barra de acento deslizándose entre items es un detalle pequeño con impacto grande:
comunica que el Spine es un objeto continuo, no una lista de enlaces.

---

## 8. LA ESCENA DE LOGIN — TIMELINE TÉCNICA

Detalle de implementación de la secuencia descrita en VISUAL_CONCEPT §3.

| Tiempo | Elemento | Propiedades animadas | Easing | Coste |
|--------|----------|---------------------|--------|-------|
| 0-600ms | Punto de origen | scale 0→1, opacity 0→1, glow 0→0.8 | `emerge` | Trivial |
| 600-1400ms | 6 axones iniciales | pathLength 0→1 | `cinematic` | SVG, bajo |
| 1400-2600ms | Malla neuronal | 180 nodos: scale + opacity, stagger 6ms | `emerge` | Canvas 2D |
| 2600-4000ms | Dolly back | camera.z 100→400, fov constante | `cinematic` | R3F |
| 4000-5200ms | Materialización | opacity de material 0→0.6, wireframe→solid | `glide` | R3F |
| 4200-∞ | Drones (3) | posición sobre curva Catmull-Rom, loop 18s | linear | R3F, bajo |
| 4400-∞ | AGVs (2) | posición sobre path, loop 24s | linear | R3F, bajo |
| 4600-∞ | Conos de escaneo | rotación + opacity oscilante | `breathe` | Shader simple |
| 5200-6000ms | HUD (5 líneas) | opacity + x -12→0, stagger 110ms | `emerge` | DOM |
| 6400-6800ms | Panel credenciales | emerge + blur del fondo 0→24px | `emerge` | DOM + CSS |

### 8.1 Presupuesto de rendimiento de la escena

| Recurso | Límite | Estrategia |
|---------|--------|-----------|
| Frame time | ≤ 8ms | LOD agresivo, instancing para racks |
| Draw calls | ≤ 60 | `InstancedMesh` para los ~2000 racks |
| Triángulos | ≤ 120k | Geometría procedural simple, sin modelos importados |
| Texturas | 0 | Todo procedural. Cero peso de descarga |
| Peso del bundle de la escena | ≤ 400KB | Code-split, carga en paralelo al formulario |
| Tiempo hasta input | ≤ 800ms | El formulario NO espera a la escena |

### 8.2 Degradación en cascada

```
Detección al montar:
  ¿WebGL2 disponible?           NO → Escena 2D (Canvas: solo Mesh + partículas)
  ¿prefers-reduced-motion?      SÍ → Composición estática + un pulso de respiración
  ¿prefers-reduced-transparency? SÍ → Sin blur, superficies opacas
  ¿deviceMemory < 4GB?          SÍ → Escena 2D
  ¿hardwareConcurrency < 4?     SÍ → Escena 2D

Monitorización en runtime:
  FPS < 45 durante 2s consecutivos → degradar un nivel (LOD, luego 2D)
  FPS < 30 durante 1s              → degradar a 2D inmediatamente
  Nunca se re-escala hacia arriba en la misma sesión (evita oscilación)
```

---

## 9. MOVIMIENTO REDUCIDO — `prefers-reduced-motion`

No es "quitar las animaciones". Es **traducir** el lenguaje de movimiento a un lenguaje
estático equivalente que preserve el significado.

| Movimiento normal | Con movimiento reducido |
|-------------------|------------------------|
| EMERGE (scale + y + blur) | Cross-fade de 120ms, sin desplazamiento |
| PULSE por la Mesh | La conexión se ilumina sin recorrido, 200ms |
| SCAN | Halo `thinking` estático + barra de progreso determinista |
| COUNT | El valor cambia directamente, con micro-glow de 200ms |
| FOCUS RIPPLE | Todos los destinos se iluminan simultáneamente, sin stagger |
| CAMERA (zoom) | Corte directo con cross-fade de 180ms |
| TRACE | Path completo estático, sin decaimiento animado |
| Latido ambiental | Detenido. La Mesh es estática |
| Partículas | Ocultas |
| Escena de login | Composición estática, un único fade de entrada |
| ALERT INTRUSION | Cambio de color inmediato, sin aceleración de ritmo |

**Lo que se conserva siempre**, incluso con movimiento reducido:
- Los cambios de color de estado (son información, no decoración).
- Los indicadores de frescura de dato.
- Las barras de progreso deterministas.
- El foco visible.

---

## 10. PRESUPUESTO DE RENDIMIENTO

### 10.1 Reglas duras

| Regla | Valor | Razón |
|-------|-------|-------|
| Solo se animan `transform`, `opacity`, `filter` | — | Son las únicas propiedades compuestas por GPU |
| Nunca animar `width`, `height`, `top`, `left` | — | Provocan layout/reflow en cada frame |
| Máximo de elementos animándose simultáneamente | 24 | Por encima, el hilo principal se saturaba en pruebas |
| Máximo de capas `backdrop-filter` | 4 | La más costosa del sistema |
| Blur animado | ≤ 12px | Por encima, coste no lineal |
| `will-change` | Solo durante la animación | Aplicado antes, reservado; retirado al terminar |
| Relojes `requestAnimationFrame` | **1** global | N relojes = N recálculos por frame |
| Partículas | ≤ 40 (app) / ≤ 120 (login) | Medido: 40 es el techo antes de notar coste |
| Pulsos de Mesh simultáneos | ≤ 6 | El resto se encola |
| Trazas simultáneas | ≤ 8 | — |
| Animaciones fuera del viewport | 0 | `IntersectionObserver` las pausa |
| Animaciones en pestaña oculta | 0 | `visibilitychange` pausa el reloj global |

### 10.2 Instrumentación obligatoria

```ts
// En desarrollo, un monitor persistente:
interface MotionBudget {
  fps: number;                  // objetivo: 60, alarma: < 55
  activeAnimations: number;     // objetivo: < 24
  blurLayers: number;           // objetivo: ≤ 4
  longTasks: number;            // tareas > 50ms en el último segundo
  droppedFrames: number;        // en los últimos 60 frames
}

// Warning en consola al superar cualquier umbral, con el stack del componente culpable.
// En CI: test de rendimiento que falla si la vista Overview cae de 55 FPS.
```

### 10.3 El principio de degradación honesta

Cuando el rendimiento cae, **el sistema lo dice**. Aparece un indicador discreto en Vitals:
`PERFORMANCE MODE`. Nunca se degrada en silencio: un operador que ve menos movimiento debe
saber que es por rendimiento y no porque el sistema se detuvo.

---

## 11. TABLA MAESTRA DE MOVIMIENTO

| Interacción | Movimiento | Duración | Easing / Spring |
|-------------|-----------|----------|-----------------|
| Hover en botón | Halo + luminancia | 140ms | `precise` |
| Click en botón | scale 0.98 → 1 | 80ms | `spring.snap` |
| Toggle / switch | Desplazamiento del thumb | 140ms | `spring.snap` |
| Focus en input | Halo focus + filo de acento | 140ms | `precise` |
| Apertura de menú | EMERGE desde el trigger | 220ms | `emerge` |
| Apertura de Cortex | EMERGE centro + blur de fondo | 220ms | `emerge` |
| Entrada de tooltip | EMERGE, delay 400ms | 140ms | `emerge` |
| Entrada de Station | EMERGE con stagger `loose` | 220ms | `emerge` |
| Station → estado alert | Halo + scale 1.005 | 340ms | `glide` |
| Expansión de Station | Layout animation | 340ms | `spring.heavy` |
| Cambio de valor de KPI | COUNT | 120-800ms | `precise` |
| Actualización de gráfico | Interpolación de path | 340ms | `glide` |
| Nueva fila en Feed | Entrada desde arriba + empuje | 220ms | `spring.fluid` |
| Nuevo evento en Stream | Deslizamiento desde la derecha | 340ms | `glide` |
| Pulso en la Mesh | PULSE | 700ms | `cinematic` |
| Procesamiento | SCAN | 1400ms loop | linear |
| Foco en entidad | FOCUS RIPPLE, stagger 40ms | 160ms | `precise` |
| Navegación por Spine | Deslizamiento horizontal | 420ms | `glide` |
| Overview → Twin | Layout + LOD | 560ms | `spring.heavy` |
| Cambio de nivel de zoom | CAMERA | 900ms | `cinematic` |
| Entrada post-login | Secuencia completa | 1800ms | `cinematic` |
| Llegada de alerta | ALERT INTRUSION | 200ms | `precise` |
| Acción confirmada | CONFIRM | 1400ms | `emerge` |
| Arrastre de Station | Seguimiento del puntero | — | `spring.drag` |
| Respiración ambiental | Oscilación de opacidad | 4000ms loop | `breathe` |

---

*Documento 4 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
