/**
 * LOGIN RACK HOTSPOTS — coordenadas sobre la imagen recortada del almacén.
 *
 * IMPORTANTE:
 *   - Las coordenadas son PORCENTAJES (0–100) del asset recortado.
 *   - El asset debe contener SOLO el almacén, sin formulario ni login.
 *   - El overlay SVG usa las mismas dimensiones naturales del asset.
 *   - Las posiciones deben calibrarse una vez el asset real esté colocado.
 *
 * Dimensiones naturales del asset (actualizar cuando se coloque el archivo real):
 *   - Se usan para: viewBox del SVG overlay, width/height del <img>
 *   - El ratio debe coincidir entre imagen y SVG para alineación perfecta
 */

/** Dimensiones naturales del asset recortado (actualizar al colocar el archivo real) */
export const ASSET_NATURAL_WIDTH = 700;
export const ASSET_NATURAL_HEIGHT = 576;

export interface RackHotspot {
  id: string;
  /** Bounding box del rack en % del asset recortado (0–100) */
  bounds: { x: number; y: number; w: number; h: number };
  /** Punto de anclaje para la línea del label (centro visual del rack, en %) */
  anchor: { x: number; y: number };
  /** Posición del label (en %, evita solapamiento) */
  label: { x: number; y: number };
  /** Ubicaciones totales del rack */
  locations: number;
  /** Punto del evento demo (una ubicación concreta, en %) */
  eventPoint: { x: number; y: number };
}

/**
 * 4 hotspots con label — posiciones preliminares basadas en la composición de referencia.
 *
 * Tras colocar el asset real, recalibrar midiendo visualmente:
 *   1. Mostrar grid temporal en overlay (viewBox 0 0 100 100)
 *   2. Ubicar cada rack en la grid
 *   3. Actualizar bounds/anchor/label/eventPoint
 *   4. Quitar grid de diagnóstico
 */
export const LOGIN_RACK_HOTSPOTS: RackHotspot[] = [
  {
    id: 'RCL-01',
    bounds: { x: 6, y: 16, w: 26, h: 58 },
    anchor: { x: 19, y: 42 },
    label: { x: 12, y: 6 },
    locations: 32,
    eventPoint: { x: 18, y: 35 },
  },
  {
    id: 'RCL-03',
    bounds: { x: 30, y: 10, w: 24, h: 52 },
    anchor: { x: 42, y: 36 },
    label: { x: 38, y: 2 },
    locations: 32,
    eventPoint: { x: 40, y: 28 },
  },
  {
    id: 'RCL-05',
    bounds: { x: 52, y: 20, w: 24, h: 54 },
    anchor: { x: 64, y: 47 },
    label: { x: 60, y: 14 },
    locations: 32,
    eventPoint: { x: 62, y: 40 },
  },
  {
    id: 'RCL-07',
    bounds: { x: 55, y: 12, w: 20, h: 44 },
    anchor: { x: 65, y: 34 },
    label: { x: 68, y: 6 },
    locations: 32,
    eventPoint: { x: 63, y: 28 },
  },
];

/** Secuencia del evento demo: rack activo → ilumina ubicación → pulsa → siguiente */
export const EVENT_SEQUENCE: Array<{ rackId: string; durationMs: number }> = [
  { rackId: 'RCL-03', durationMs: 5000 },
  { rackId: 'RCL-07', durationMs: 5000 },
  { rackId: 'RCL-01', durationMs: 4000 },
];
