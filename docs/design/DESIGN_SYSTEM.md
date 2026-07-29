# OLO IA — DESIGN SYSTEM

## Sistema de tokens, materiales y fundamentos visuales

---

## 1. FILOSOFÍA DEL SISTEMA DE TOKENS

Tres capas, dependencia unidireccional. Un componente **nunca** consume un token primitivo.

```
PRIMITIVOS          →   SEMÁNTICOS          →   COMPONENTE
(valores crudos)        (significado)           (uso concreto)

--cyan-400          →   --state-nominal     →   --station-halo
#22D3EE                 role: sistema OK        glow de estación nominal

Nadie usa #22D3EE       Nadie usa --cyan-400    El componente usa
directamente            en un componente        --station-halo
```

Razón: cuando se cambie el acento de cian a otro color (rebranding, tema por tenant), se
cambia en una capa y propaga a todo. Si los componentes consumen primitivos, es imposible.

---

## 2. COLOR

### 2.1 Primitivos — Neutros (la base)

El 92% de la interfaz es neutro. El color es escaso y por tanto significativo.

```css
/* VOID — el negro estructural. No es #000: tiene un sesgo azul imperceptible
   que evita el "agujero muerto" en pantallas OLED y unifica con el acento. */
--void-1000: #04070D;   /* Fondo absoluto de la aplicación                  */
--void-950:  #070B14;   /* Fondo de viewport, detrás de la Mesh             */
--void-900:  #0A0F1A;   /* Superficie de estación, plano Z-1                */
--void-850:  #0E1420;   /* Superficie de estación activa, plano Z-2         */
--void-800:  #131A28;   /* Superficie elevada, diálogos                     */

/* GRAPHITE — estructura, bordes, separación */
--graphite-700: #1B2433;  /* Borde estructural, hairline                    */
--graphite-600: #26313F;  /* Borde de foco pasivo, divisores                */
--graphite-500: #37434F;  /* Borde activo, elementos deshabilitados         */
--graphite-400: #4C5A69;  /* Iconografía secundaria                         */

/* MIST — texto y contenido */
--mist-300: #6B7A8C;   /* Texto terciario, metadata, timestamps             */
--mist-200: #94A3B4;   /* Texto secundario, etiquetas                       */
--mist-100: #C4CFDB;   /* Texto primario de cuerpo                          */
--mist-050: #E8EEF5;   /* Texto de énfasis, títulos, valores de KPI         */
--mist-000: #FFFFFF;   /* Reservado. Solo para el valor más crítico en foco */
```

### 2.2 Primitivos — Acentos

```css
/* CYAN — el pulso del sistema. Es EL color de OLO IA.
   Representa: sistema vivo, datos frescos, estado nominal, foco. */
--cyan-600: #0891B2;
--cyan-500: #06B6D4;
--cyan-400: #22D3EE;   /* ← acento canónico */
--cyan-300: #67E8F9;
--cyan-200: #A5F3FC;   /* Solo para texto sobre superficies cian saturadas */

/* ELECTRIC — azul eléctrico. Estructura profunda, la Mesh, conexiones. */
--electric-700: #1D4ED8;
--electric-600: #2563EB;
--electric-500: #3B82F6;   /* ← canónico para la Mesh */
--electric-400: #60A5FA;

/* VIOLET — inteligencia. Todo lo que es inferencia, predicción, modelo IA.
   Distingue "el sistema calculó esto" de "esto es un dato medido". */
--violet-600: #7C3AED;
--violet-500: #8B5CF6;   /* ← canónico para IA */
--violet-400: #A78BFA;

/* AMBER — atención. Escaso por diseño. Si hay ámbar, algo requiere decisión. */
--amber-600: #D97706;
--amber-500: #F59E0B;   /* ← canónico para alerta */
--amber-400: #FBBF24;

/* CRIMSON — fallo. Aún más escaso. Solo para pérdida de servicio o dato corrupto. */
--crimson-600: #DC2626;
--crimson-500: #EF4444;

/* JADE — confirmación. Nunca decorativo. Solo para "la acción se completó". */
--jade-500: #10B981;
--jade-400: #34D399;
```

### 2.3 Semánticos — Estado del sistema

```css
/* Los tres estados cognitivos del sistema (ver VISUAL_CONCEPT §1.2) */
--state-idle:        var(--cyan-400);      /* respirando, nominal        */
--state-thinking:    var(--violet-500);    /* inferencia en curso        */
--state-alert:       var(--amber-500);     /* requiere atención          */
--state-critical:    var(--crimson-500);   /* fallo de servicio          */
--state-confirmed:   var(--jade-500);      /* acción completada          */

/* Naturaleza del dato — distingue medición de predicción */
--data-measured:     var(--cyan-400);      /* sensor, conteo, dato real  */
--data-inferred:     var(--violet-500);    /* IA lo dedujo               */
--data-predicted:    var(--violet-400);    /* IA lo proyecta a futuro    */
--data-imported:     var(--electric-500);  /* vino de un WMS externo     */
--data-manual:       var(--mist-200);      /* lo escribió un humano      */
```

> **Regla dura**: el usuario debe poder distinguir *siempre* si un número lo midió un sensor
> o lo predijo un modelo. Confundirlos es un fallo de producto, no de estética.

### 2.4 Semánticos — Temperatura temporal

Implementa G6 del ADN. Se aplica como filtro sobre el valor, no como color distinto.

```css
--freshness-live:      1.00;   /* < 2s     + pulso de latido */
--freshness-recent:    1.00;   /* < 60s                      */
--freshness-cooling:   0.85;   /* < 5min                     */
--freshness-historic:  0.70;   /* > 5min   sin halo          */
--freshness-stale:     0.45;   /* sin conexión + patrón      */
```

### 2.5 Semánticos — Superficie y texto

```css
--surface-void:       var(--void-1000);
--surface-ambient:    var(--void-950);
--surface-station:    var(--void-900);
--surface-active:     var(--void-850);
--surface-elevated:   var(--void-800);

--border-hairline:    var(--graphite-700);
--border-subtle:      var(--graphite-600);
--border-strong:      var(--graphite-500);

--text-primary:       var(--mist-050);
--text-body:          var(--mist-100);
--text-secondary:     var(--mist-200);
--text-tertiary:      var(--mist-300);
--text-accent:        var(--cyan-300);
--text-inverse:       var(--void-1000);
```

### 2.6 Contraste verificado (WCAG 2.1 AA)

Toda combinación de uso real, medida. Requisito: ≥ 4.5:1 texto normal, ≥ 3:1 texto grande
y elementos gráficos.

| Primer plano | Fondo | Ratio | Uso | Cumple |
|--------------|-------|-------|-----|--------|
| `--mist-050` #E8EEF5 | `--void-900` #0A0F1A | 15.8:1 | Títulos, KPIs | AAA |
| `--mist-100` #C4CFDB | `--void-900` #0A0F1A | 11.9:1 | Cuerpo | AAA |
| `--mist-200` #94A3B4 | `--void-900` #0A0F1A | 6.9:1 | Etiquetas | AA |
| `--mist-300` #6B7A8C | `--void-900` #0A0F1A | 3.9:1 | **Solo ≥16px o bold** | AA large |
| `--cyan-300` #67E8F9 | `--void-900` #0A0F1A | 11.4:1 | Texto de acento | AAA |
| `--cyan-400` #22D3EE | `--void-900` #0A0F1A | 8.9:1 | Iconos, bordes activos | AAA |
| `--violet-400` #A78BFA | `--void-900` #0A0F1A | 7.2:1 | Texto de inferencia | AA |
| `--violet-500` #8B5CF6 | `--void-900` #0A0F1A | 4.6:1 | **Solo gráficos** | AA large |
| `--amber-400` #FBBF24 | `--void-900` #0A0F1A | 11.2:1 | Texto de alerta | AAA |
| `--amber-500` #F59E0B | `--void-900` #0A0F1A | 8.4:1 | Iconos de alerta | AAA |
| `--crimson-500` #EF4444 | `--void-900` #0A0F1A | 4.9:1 | Texto de fallo | AA |
| `--jade-400` #34D399 | `--void-900` #0A0F1A | 9.7:1 | Confirmación | AAA |
| `--void-1000` #04070D | `--cyan-400` #22D3EE | 8.9:1 | Botón primario | AAA |

> `--mist-300` sobre `--void-900` da 3.9:1. **No cumple AA para texto normal.** Se usa
> exclusivamente en ≥16px o con peso ≥600. Está documentado en el token con un comentario
> y validado con un test automatizado de contraste.

### 2.7 El color nunca es el único canal

Requisito WCAG 1.4.1. Cada estado se codifica en **dos o más** canales:

| Estado | Color | Canal 2 | Canal 3 |
|--------|-------|---------|---------|
| Nominal | cian | halo estable | icono de círculo |
| Pensando | violeta | pulso animado | icono de nodo activo |
| Alerta | ámbar | pulso acelerado | icono de triángulo |
| Crítico | carmesí | borde sólido | icono de octágono |
| Confirmado | jade | check | fade-out temporizado |
| Stale | desaturado | patrón diagonal | texto "SIN SEÑAL" |

---

## 3. TIPOGRAFÍA

### 3.1 Familias

```css
/* INTERFAZ — Inter Variable.
   Razón: métrica óptica excelente en tamaños pequeños sobre fondo oscuro,
   variable (un solo archivo), features tipográficas completas. */
--font-ui: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* DATOS — JetBrains Mono Variable.
   Razón: TODO valor numérico es monoespaciado. Alineación vertical perfecta
   permite lectura por patrón: el operador detecta la anomalía sin leer cifras. */
--font-data: 'JetBrains Mono Variable', 'SF Mono', 'Cascadia Mono', monospace;

/* DISPLAY — Inter Variable en peso ligero y tracking negativo.
   Para los títulos de gran tamaño de la escena de login y encabezados de sección. */
--font-display: 'Inter Variable', sans-serif;
```

### 3.2 Ajustes obligatorios sobre fondo oscuro

El texto claro sobre fondo oscuro sufre *halation*: los trazos parecen más gruesos. Se
compensa:

```css
body {
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

/* Texto de cuerpo: un punto de peso por debajo del equivalente en tema claro */
--weight-body: 380;      /* en lugar de 400 */
--weight-medium: 480;    /* en lugar de 500 */
--weight-semibold: 580;  /* en lugar de 600 */
--weight-bold: 680;      /* en lugar de 700 */
```

### 3.3 Escala tipográfica

Escala modular ratio 1.2 (minor third), anclada en 13px. Base de 13 y no 16 porque la
densidad de datos lo exige y el público es de escritorio.

```css
--text-2xs:  10px;  /* line-height: 14px  — HUD, metadata, unidades          */
--text-xs:   11px;  /* line-height: 16px  — etiquetas de eje, badges         */
--text-sm:   13px;  /* line-height: 20px  — CUERPO BASE, tablas, inputs      */
--text-base: 15px;  /* line-height: 22px  — texto destacado, párrafos        */
--text-lg:   18px;  /* line-height: 26px  — títulos de estación              */
--text-xl:   22px;  /* line-height: 30px  — títulos de sección               */
--text-2xl:  28px;  /* line-height: 36px  — valores de KPI secundario        */
--text-3xl:  36px;  /* line-height: 42px  — valores de KPI primario          */
--text-4xl:  48px;  /* line-height: 52px  — métrica hero                     */
--text-5xl:  64px;  /* line-height: 66px  — display de login                 */

--tracking-tight:  -0.02em;   /* títulos grandes  */
--tracking-normal: 0;
--tracking-wide:   0.04em;    /* etiquetas en mayúsculas */
--tracking-hud:    0.12em;    /* HUD, tipografía técnica en mayúsculas */
```

### 3.4 Roles tipográficos

| Rol | Familia | Tamaño | Peso | Tracking | Transform |
|-----|---------|--------|------|----------|-----------|
| `hud-label` | data | 2xs | 500 | hud | uppercase |
| `station-title` | ui | lg | 480 | tight | none |
| `section-title` | ui | xl | 380 | tight | none |
| `kpi-value` | **data** | 3xl | 300 | tight | none |
| `kpi-unit` | data | sm | 400 | wide | uppercase |
| `kpi-delta` | data | xs | 500 | normal | none |
| `body` | ui | sm | 380 | normal | none |
| `label` | ui | xs | 500 | wide | uppercase |
| `table-cell` | ui | sm | 380 | normal | none |
| `table-numeric` | **data** | sm | 400 | normal | tabular-nums |
| `code` | data | xs | 400 | normal | none |
| `timestamp` | data | 2xs | 400 | normal | none |

> **KPI en peso 300 (light) a 36px**: el número grande y fino se lee como dato de
> instrumento de precisión. El número grande y bold se lee como cartel publicitario.

### 3.5 Números tabulares — obligatorio

```css
.numeric {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums slashed-zero;
}
```

`slashed-zero` elimina la ambigüedad 0/O en códigos de SKU y ubicación. `tabular-nums`
garantiza que las columnas de cifras se alineen aunque cambien en tiempo real (sin esto,
un valor que pasa de 999 a 1000 desplaza toda la columna: efecto de inestabilidad
inaceptable en un centro de control).

---

## 4. ESPACIADO Y RETÍCULA

### 4.1 Escala de espaciado

Base 4px. Rejilla estricta: ningún valor fuera de la escala.

```css
--space-0:   0;
--space-px:  1px;
--space-1:   4px;
--space-2:   8px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
--space-16:  64px;
--space-20:  80px;
--space-24:  96px;
```

### 4.2 Densidad — tres modos

El operador elige. Se persiste por usuario.

| Modo | Padding de estación | Alto de fila | Uso |
|------|--------------------|-------------|-----|
| `compact` | `--space-3` | 28px | Pantallas de control, mucha densidad |
| `default` | `--space-4` | 36px | Uso general |
| `comfortable` | `--space-6` | 44px | Presentaciones, pantallas grandes |

### 4.3 Retícula del centro de control

12 columnas, gutter 16px, sin ancho máximo. Un centro de control usa **todo** el monitor;
no se centra en 1280px como una web de marketing.

```
Breakpoints (desktop-first, este producto es de escritorio):

--bp-uw:   2560px   /* ultrawide — 16 columnas, estaciones adicionales visibles */
--bp-2xl:  1920px   /* estándar de operación — 12 columnas                      */
--bp-xl:   1536px   /* portátil grande — 12 columnas                            */
--bp-lg:   1280px   /* mínimo soportado plenamente — 8 columnas                 */
--bp-md:   1024px   /* tablet horizontal — 6 columnas, gemelo digital reducido  */
--bp-sm:   768px    /* solo consulta, sin operación — 4 columnas, apilado       */
```

> Por debajo de 1024px la aplicación entra en **modo consulta**: se pueden ver KPIs y
> alertas, no se puede operar (crear conteos, planificar misiones). Es una decisión de
> producto: operar un almacén desde un móvil es un error que la interfaz no debe facilitar.

### 4.4 Radios

```css
--radius-none: 0;
--radius-sm:   3px;    /* badges, chips, inputs pequeños  */
--radius-md:   5px;    /* botones, inputs                 */
--radius-lg:   8px;    /* estaciones, paneles             */
--radius-xl:   12px;   /* diálogos, superficies elevadas  */
--radius-full: 9999px; /* solo indicadores circulares     */
```

Radios **contenidos a propósito**. Esquinas muy redondeadas (16px+) se leen como consumer
y suavizan la precisión que el producto debe transmitir. Comparar: instrumentación
aeronáutica vs aplicación de fitness.

---

## 5. MATERIALES — EL SISTEMA DE PROFUNDIDAD

Aquí es donde el producto se diferencia. No hay `box-shadow` genérico: hay **materiales**.

### 5.1 VEIL — el material de glass

```css
/* VEIL-1 — Contexto. Estaciones en segundo plano. */
--veil-1-bg:     rgba(10, 15, 26, 0.72);
--veil-1-blur:   blur(12px) saturate(1.1);
--veil-1-border: 1px solid rgba(38, 49, 63, 0.6);

/* VEIL-2 — Trabajo. Estación activa. */
--veil-2-bg:     rgba(14, 20, 32, 0.82);
--veil-2-blur:   blur(20px) saturate(1.2);
--veil-2-border: 1px solid rgba(55, 67, 79, 0.7);

/* VEIL-3 — Decisión. Diálogos, panel de comando. */
--veil-3-bg:     rgba(19, 26, 40, 0.90);
--veil-3-blur:   blur(32px) saturate(1.3);
--veil-3-border: 1px solid rgba(76, 90, 105, 0.8);

/* VEIL-CRITICAL — Alerta bloqueante. */
--veil-crit-bg:     rgba(20, 14, 8, 0.92);
--veil-crit-blur:   blur(40px) saturate(1.4);
--veil-crit-border: 1px solid rgba(245, 158, 11, 0.5);
```

### 5.2 HALO — el glow derivado del dato

Implementa G2 del ADN: la luz viene del dato.

```css
/* Halo de estado. La intensidad es función del estado, no una constante decorativa. */
--halo-idle:
  0 0 0 1px rgba(34, 211, 238, 0.10),
  0 0 24px -8px rgba(34, 211, 238, 0.18);

--halo-thinking:
  0 0 0 1px rgba(139, 92, 246, 0.22),
  0 0 32px -6px rgba(139, 92, 246, 0.30);

--halo-alert:
  0 0 0 1px rgba(245, 158, 11, 0.35),
  0 0 40px -4px rgba(245, 158, 11, 0.38);

--halo-critical:
  0 0 0 1px rgba(239, 68, 68, 0.50),
  0 0 48px -4px rgba(239, 68, 68, 0.45);

--halo-focus:
  0 0 0 1px rgba(34, 211, 238, 0.60),
  0 0 0 4px rgba(34, 211, 238, 0.12),
  0 0 40px -8px rgba(34, 211, 238, 0.35);
```

### 5.3 LIFT — la elevación física

El único uso de sombra proyectada: comunicar distancia real al plano de fondo. Sombras
frías (azuladas), no negras neutras.

```css
--lift-0: none;
--lift-1: 0 1px 2px rgba(4, 7, 13, 0.6),
          0 2px 8px -2px rgba(4, 7, 13, 0.4);
--lift-2: 0 2px 4px rgba(4, 7, 13, 0.7),
          0 8px 24px -6px rgba(4, 7, 13, 0.5);
--lift-3: 0 4px 8px rgba(4, 7, 13, 0.8),
          0 16px 48px -8px rgba(4, 7, 13, 0.6);
--lift-4: 0 8px 16px rgba(4, 7, 13, 0.85),
          0 32px 80px -12px rgba(4, 7, 13, 0.7);
```

### 5.4 Tabla de composición Z

Cada plano Z es una receta cerrada de material. No se improvisa.

| Plano | Superficie | Veil | Halo | Lift | Blur de contenido | Opacidad |
|-------|-----------|------|------|------|-------------------|----------|
| **Z-0** Ambiente | `--surface-ambient` | — | — | — | 24px | 0.35 |
| **Z-1** Contexto | `--surface-station` | VEIL-1 | según estado | `--lift-1` | 3px | 0.75 |
| **Z-2** Trabajo | `--surface-active` | VEIL-2 | según estado | `--lift-2` | 0 | 1.0 |
| **Z-3** Decisión | `--surface-elevated` | VEIL-3 | `--halo-focus` | `--lift-3` | 0 | 1.0 |
| **Z-4** Crítico | `--surface-elevated` | VEIL-CRITICAL | `--halo-critical` | `--lift-4` | 0 | 1.0 |

### 5.5 Gradientes estructurales

```css
/* Gradiente de estación: sugiere luz superior sin usar sombra */
--grad-station: linear-gradient(
  168deg,
  rgba(255, 255, 255, 0.035) 0%,
  rgba(255, 255, 255, 0.008) 32%,
  transparent 100%
);

/* Filo superior: la línea de luz de 1px que define el borde superior de una superficie */
--grad-edge-top: linear-gradient(
  90deg,
  transparent 0%,
  rgba(255, 255, 255, 0.10) 20%,
  rgba(255, 255, 255, 0.14) 50%,
  rgba(255, 255, 255, 0.10) 80%,
  transparent 100%
);

/* Filo de acento: la misma idea pero en el color de estado */
--grad-edge-accent: linear-gradient(
  90deg,
  transparent 0%,
  var(--state-idle) 35%,
  var(--state-idle) 65%,
  transparent 100%
);

/* Profundidad de viewport: oscurece los bordes de la pantalla, enfoca el centro */
--grad-vignette: radial-gradient(
  ellipse 130% 110% at 50% 42%,
  transparent 0%,
  rgba(4, 7, 13, 0.35) 68%,
  rgba(4, 7, 13, 0.75) 100%
);
```

### 5.6 Presupuesto de blur — restricción crítica de rendimiento

`backdrop-filter` es la operación más costosa del sistema. Sin límite, mata los 60 FPS.

| Regla | Valor |
|-------|-------|
| Máximo de capas con `backdrop-filter` simultáneas | **4** |
| Blur máximo en un elemento animado | **12px** |
| Blur > 20px | Solo en elementos estáticos (sin transform/opacity animándose) |
| Elemento con blur en movimiento | Se congela el blur durante la transición, se reactiva al finalizar |
| Fallback | Si el navegador no soporta `backdrop-filter`: superficie opaca equivalente |

Se implementa un contador global de capas blur en desarrollo que emite warning al superar 4.

---

## 6. ICONOGRAFÍA

### 6.1 Reglas

| Regla | Valor |
|-------|-------|
| Estilo | Línea, nunca relleno |
| Grosor de trazo | 1.5px a 20px de tamaño (escala proporcional) |
| Terminaciones | `stroke-linecap: round`, `stroke-linejoin: round` |
| Grid de diseño | 24×24, área segura 20×20 |
| Color | `currentColor` siempre. El color viene del contexto, nunca del icono |
| Tamaños | 14, 16, 20, 24, 32px |
| Fuente base | Lucide (line-based, consistente, tree-shakeable) |

### 6.2 Iconos propios de dominio

Lucide no cubre el vocabulario de OLO IA. Set propio necesario:

```
Percepción:   drone-patrol · drone-docked · camera-cone · edge-node · lidar-sweep
Espacio:      rack-unit · pallet · bin · dock-door · aisle · zone-boundary
Cognición:    neural-node · inference-run · model-deployed · prediction-cone · anomaly
Operación:    count-cycle · recount · adjustment · pick-route · putaway
Integración:  connector-sync · connector-error · wms-link · dead-letter
Twin:         twin-view · layer-toggle · heatmap · trace-path · beacon
```

Cada icono se diseña en el mismo grid 24×24 y con el mismo grosor, para que conviva con
Lucide sin discontinuidad visual.

### 6.3 Iconos de estado — forma redundante con el color

WCAG 1.4.1. La forma sola debe comunicar el estado:

| Estado | Forma |
|--------|-------|
| Nominal | Círculo con punto central |
| Pensando | Nodo con 3 conexiones (animado) |
| Alerta | Triángulo con signo de exclamación |
| Crítico | Octágono |
| Confirmado | Check |
| Stale | Círculo con línea diagonal |

---

## 7. TEMAS

### 7.1 Tema canónico: Deep Space (oscuro)

Es el tema por defecto y el que define la identidad. Todo el sistema de tokens anterior
lo describe.

### 7.2 Tema secundario: Daylight (claro)

**Necesario**, no opcional. Casos reales: almacenes con luz solar directa sobre la pantalla,
proyección en sala de reuniones, impresión de reportes, requisitos de accesibilidad de
usuarios con astigmatismo (que leen peor texto claro sobre fondo oscuro).

No es una inversión mecánica. Cambia la naturaleza del material:

| Aspecto | Deep Space | Daylight |
|---------|-----------|----------|
| Superficie base | `#04070D` | `#F4F7FA` |
| Estación | `#0A0F1A` | `#FFFFFF` |
| Texto primario | `#E8EEF5` | `#0A0F1A` |
| Acento | `--cyan-400` | `--cyan-600` (más saturado, necesario sobre blanco) |
| Halo | Glow luminoso | **Sombra suave** — el glow no funciona sobre blanco |
| Mesh | Líneas luminosas sobre negro | Líneas oscuras con opacidad baja |
| Gemelo digital | Wireframe luminoso | Wireframe oscuro sobre fondo claro |

> La escena de login **no tiene versión Daylight**. Es cinematográfica y vive en la
> oscuridad. En tema claro, el login usa una composición estática elegante.

### 7.3 Tema de accesibilidad: High Contrast

Derivado de Deep Space con:
- Todos los ratios de contraste ≥ 7:1 (AAA).
- Bordes sólidos de 1px en toda superficie (no se depende de blur para delimitar).
- Halos reemplazados por bordes de 2px.
- Sin `backdrop-filter`.
- Movimiento reducido al mínimo.

### 7.4 Personalización por tenant

El tenant puede ajustar **solo** el color de acento primario, dentro de una paleta curada
de 8 opciones que garantizan contraste AA. No puede cambiar neutros, ni los colores
semánticos de estado (alerta siempre es ámbar: es seguridad operacional, no marca).

```css
/* El acento del tenant se inyecta en runtime como override de una sola variable */
:root[data-tenant-accent="cyan"]   { --accent-primary: #22D3EE; }
:root[data-tenant-accent="azure"]  { --accent-primary: #38BDF8; }
:root[data-tenant-accent="violet"] { --accent-primary: #A78BFA; }
:root[data-tenant-accent="jade"]   { --accent-primary: #34D399; }
/* ... 4 más, todas validadas ≥ 4.5:1 sobre --void-900 */
```

---

## 8. ACCESIBILIDAD DEL SISTEMA

| Requisito | Implementación |
|-----------|---------------|
| Contraste AA | Verificado en §2.6, con test automatizado en CI |
| Color no es único canal | §2.7 y §6.3 |
| Foco visible | `--halo-focus` con anillo de 4px, nunca `outline: none` sin sustituto |
| Movimiento reducido | `prefers-reduced-motion` desactiva toda animación no esencial (ver MOTION_SYSTEM) |
| Transparencia reducida | `prefers-reduced-transparency` sustituye Veil por superficie opaca |
| Navegación por teclado | Todo accionable alcanzable. Orden de tab = orden visual |
| Zoom | Funcional hasta 200% sin pérdida de contenido |
| Tamaño de diana | Mínimo 24×24px de área clicable (WCAG 2.5.8), 32×32 recomendado |
| Lectores de pantalla | Toda estación es `<section>` con `aria-label`. Datos en vivo con `aria-live="polite"` |
| Alertas críticas | `role="alert"` + `aria-live="assertive"` |

---

*Documento 2 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
