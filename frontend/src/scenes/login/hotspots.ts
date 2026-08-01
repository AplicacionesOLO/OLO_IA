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

/** Dimensiones naturales del asset recortado (medidas del archivo real) */
export const ASSET_NATURAL_WIDTH = 1536;
export const ASSET_NATURAL_HEIGHT = 1024;

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
 * 4 hotspots with labels — positions calibrated against the 1536×1024 cropped asset.
 *
 * The image shows:
 *   - 3 rows of racks in isometric perspective
 *   - Back row (top of image): RCL-03, RCL-07
 *   - Middle row: RCL-01, RCL-05
 *   - Front row (bottom): unlabeled racks
 *   - Level guides (N01-N07) on the left
 *   - Body labels (C001-C012) along the bottom
 */
export const LOGIN_RACK_HOTSPOTS: RackHotspot[] = [
  {
    id: 'RCL-01',
    bounds: { x: 5, y: 18, w: 28, h: 55 },
    anchor: { x: 19, y: 44 },
    label: { x: 8, y: 6 },
    locations: 32,
    eventPoint: { x: 18, y: 38 },
  },
  {
    id: 'RCL-03',
    bounds: { x: 22, y: 8, w: 26, h: 48 },
    anchor: { x: 35, y: 32 },
    label: { x: 28, y: 1 },
    locations: 32,
    eventPoint: { x: 34, y: 26 },
  },
  {
    id: 'RCL-05',
    bounds: { x: 42, y: 22, w: 26, h: 54 },
    anchor: { x: 55, y: 48 },
    label: { x: 48, y: 14 },
    locations: 32,
    eventPoint: { x: 54, y: 43 },
  },
  {
    id: 'RCL-07',
    bounds: { x: 48, y: 10, w: 22, h: 42 },
    anchor: { x: 59, y: 31 },
    label: { x: 55, y: 3 },
    locations: 32,
    eventPoint: { x: 58, y: 26 },
  },
];

/** Secuencia del evento demo: rack activo → ilumina ubicación → pulsa → siguiente */
export const EVENT_SEQUENCE: Array<{ rackId: string; durationMs: number }> = [
  { rackId: 'RCL-03', durationMs: 5000 },
  { rackId: 'RCL-07', durationMs: 5000 },
  { rackId: 'RCL-01', durationMs: 4000 },
];
