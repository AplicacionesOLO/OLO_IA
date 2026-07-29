/**
 * DATOS DE DEMOSTRACION
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE ESTE ARCHIVO, Y POR QUE ESTA AISLADO
 *
 * La regla que fijamos antes era: "un dashboard con datos falsos es peor que un
 * hueco, porque nadie sabe si lo que ve es real". Sigue siendo cierta. Pero un
 * dashboard con siete huecos vacios tampoco permite evaluar el lenguaje visual:
 * la jerarquia, el peso de cada panel y el ritmo solo se pueden juzgar con
 * contenido dentro.
 *
 * La solucion no es renunciar a la honestidad, es hacerla explicita:
 *
 *   1. Estas cifras viven en UN solo archivo, separado de los componentes.
 *   2. Solo se usan cuando `env.demoData` es true (modo mock, sin backend).
 *   3. La TopBar muestra el aviso "Datos de demostracion" mientras se usan.
 *   4. Cuando exista el endpoint, se sustituye la fuente y este archivo se
 *      borra. Ningun componente cambia: todos reciben los datos por props.
 *
 * Las series son DETERMINISTAS. Si fueran aleatorias, cada render produciria un
 * grafico distinto y una captura de pantalla nunca seria reproducible.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Generador determinista: dos senos superpuestos con una deriva lenta. */
function series(length: number, base: number, amp: number, phase: number): number[] {
  return Array.from({ length }, (_, i) => {
    const a = Math.sin(i * 0.42 + phase) * amp;
    const b = Math.cos(i * 0.17 + phase * 1.7) * amp * 0.45;
    const drift = (i / length) * amp * 0.6;
    return Math.round((base + a + b + drift) * 10) / 10;
  });
}

export interface DemoMetric {
  id: string;
  label: string;
  value: string;
  /** Unidad separada del valor: se compone tipograficamente distinta. */
  unit?: string;
  /** Variacion respecto al periodo anterior, en puntos porcentuales. */
  delta: number;
  nature: 'measured' | 'inferred';
  series: readonly number[];
}

export const demoMetrics: readonly DemoMetric[] = [
  {
    id: 'accuracy',
    label: 'Precision de inventario',
    value: '99.2',
    unit: '%',
    delta: 0.8,
    nature: 'measured',
    series: series(24, 97.4, 1.1, 0.4),
  },
  {
    id: 'throughput',
    label: 'Movimientos por hora',
    value: '1 842',
    delta: 12.4,
    nature: 'measured',
    series: series(24, 1600, 240, 1.9),
  },
  {
    id: 'forecast',
    label: 'Rotura de stock prevista',
    value: '14',
    unit: 'SKU',
    delta: -22.0,
    nature: 'inferred',
    series: series(24, 19, 5, 3.1),
  },
];

/** Ocupacion por zona. Categorias genericas, sin semantica de negocio. */
export const demoZones: readonly { label: string; value: number }[] = [
  { label: 'A', value: 88 },
  { label: 'B', value: 64 },
  { label: 'C', value: 91 },
  { label: 'D', value: 47 },
  { label: 'E', value: 73 },
  { label: 'F', value: 58 },
  { label: 'G', value: 82 },
  { label: 'H', value: 35 },
];

export interface DemoActivity {
  id: string;
  /** Minutos transcurridos. Se convierte a hora en el momento del render para
      que la lista no quede congelada en el instante del build. */
  agoMin: number;
  nature: 'measured' | 'inferred' | 'alert';
  message: string;
  source: string;
}

export const demoActivity: readonly DemoActivity[] = [
  {
    id: 'a1',
    agoMin: 1,
    nature: 'measured',
    message: 'Conteo ciclico completado en pasillo C-04',
    source: 'AI-B7',
  },
  {
    id: 'a2',
    agoMin: 4,
    nature: 'inferred',
    message: 'Discrepancia probable detectada en ubicacion B-14-3',
    source: 'Motor de inferencia',
  },
  {
    id: 'a3',
    agoMin: 9,
    nature: 'measured',
    message: '1 204 unidades verificadas en zona A',
    source: 'AI-C2',
  },
  {
    id: 'a4',
    agoMin: 17,
    nature: 'alert',
    message: 'Nodo edge 12 sin responder',
    source: 'Salud del sistema',
  },
  {
    id: 'a5',
    agoMin: 24,
    nature: 'inferred',
    message: 'Reubicacion sugerida para 38 SKU de baja rotacion',
    source: 'Motor de inferencia',
  },
  {
    id: 'a6',
    agoMin: 31,
    nature: 'measured',
    message: 'Sincronizacion con WMS finalizada',
    source: 'Integraciones',
  },
];

/** Signos vitales de la plataforma, para el panel de estado. */
export const demoVitals = {
  coverage: 0.947,
  edgeOnline: 46,
  edgeTotal: 47,
  inferencesPerSecond: 34.6,
  twinLatencyMs: 42,
  gpuUtilization: 0.61,
} as const;
