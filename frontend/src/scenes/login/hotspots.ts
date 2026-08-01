/**
 * LOGIN RACK HOTSPOTS — coordenadas deterministas sobre la imagen de referencia.
 *
 * Cada hotspot define la posicion del rack en porcentajes relativos al contenedor
 * de la imagen (0-100%). Esto permite que funcionen independientemente del
 * viewport real, ya que el SVG overlay usa el mismo aspect ratio.
 *
 * Las posiciones fueron calibradas contra la imagen de referencia (1024x576 crop).
 */

export interface RackHotspot {
  id: string;
  /** Bounding box del rack en % del panel izquierdo */
  bounds: { x: number; y: number; w: number; h: number };
  /** Punto de anclaje para la línea del label (centro del rack) */
  anchor: { x: number; y: number };
  /** Posición del label (evita solapamiento) */
  label: { x: number; y: number };
  /** Ubicaciones totales */
  locations: number;
  /** Punto del evento activo (una ubicación concreta, en %) */
  eventPoint: { x: number; y: number };
}

/**
 * 4 hotspots visibles con label.
 * Posiciones calibradas contra la imagen de referencia 1024x576 (panel izquierdo ~680px).
 */
export const LOGIN_RACK_HOTSPOTS: RackHotspot[] = [
  {
    id: 'RCL-01',
    bounds: { x: 8, y: 18, w: 22, h: 55 },
    anchor: { x: 19, y: 45 },
    label: { x: 14, y: 8 },
    locations: 32,
    eventPoint: { x: 17, y: 38 },
  },
  {
    id: 'RCL-03',
    bounds: { x: 28, y: 12, w: 20, h: 50 },
    anchor: { x: 38, y: 37 },
    label: { x: 35, y: 4 },
    locations: 32,
    eventPoint: { x: 36, y: 30 },
  },
  {
    id: 'RCL-05',
    bounds: { x: 46, y: 22, w: 22, h: 52 },
    anchor: { x: 57, y: 48 },
    label: { x: 55, y: 16 },
    locations: 32,
    eventPoint: { x: 55, y: 42 },
  },
  {
    id: 'RCL-07',
    bounds: { x: 42, y: 14, w: 18, h: 42 },
    anchor: { x: 51, y: 35 },
    label: { x: 52, y: 8 },
    locations: 32,
    eventPoint: { x: 50, y: 30 },
  },
];

/** Secuencia del evento demo: rack activo → ilumina ubicación → pulsa → pasa al siguiente */
export const EVENT_SEQUENCE: Array<{ rackId: string; durationMs: number }> = [
  { rackId: 'RCL-03', durationMs: 5000 },
  { rackId: 'RCL-07', durationMs: 5000 },
  { rackId: 'RCL-01', durationMs: 4000 },
];

export const EVENT_TOTAL_MS = EVENT_SEQUENCE.reduce((sum, e) => sum + e.durationMs, 0);
