/**
 * CONTRATO DEL DIGITAL TWIN
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL TWIN ES CAPA 5. ESTA INTERFAZ ES CAPA 1.
 *
 * Se define ahora, completa, para que el Dashboard nazca pensando que el Twin
 * sera el centro de la aplicacion. Cuando llegue la implementacion 3D, se
 * registra como renderizador de capa 5 y NINGUN consumidor cambia.
 *
 * Es la diferencia entre "dejamos hueco" y "dejamos el hueco con las tuberias
 * puestas".
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Zoom semantico: el mismo componente, distinta informacion segun el nivel. */
export type TwinLevel = 'network' | 'warehouse' | 'area' | 'location';

/** Capas visuales del Twin, activables de forma independiente. */
export type TwinLayerKind =
  | 'racks'
  | 'drones'
  | 'agvs'
  | 'routes'
  | 'heatmap'
  | 'sensors'
  | 'beacons';

export type TwinCameraPreset = 'top' | 'iso' | 'front' | 'free';

/** Marcador de atencion sobre el Twin. */
export interface TwinBeacon {
  id: string;
  /** Entidad señalada. */
  entity: { type: string; id: string };
  /** Ambar = alerta que requiere decision. Cian = foco actual. */
  intent: 'alert' | 'focus' | 'info';
  label?: string;
}

/** Estela de un objeto en movimiento (dron, AGV, ruta de picking). */
export interface TwinTrace {
  id: string;
  points: readonly { x: number; y: number; z?: number; t: number }[];
  nature: 'drone' | 'agv' | 'pick';
}

/**
 * Control temporal.
 *
 * `historic` con `at` permite ver el estado del almacen en cualquier momento
 * pasado. Es la caracteristica que mas impresiona en demo y por eso el contrato
 * la contempla desde el principio: añadirla despues obligaria a reescribir la
 * gestion de estado del Twin.
 */
export interface TwinTimeline {
  mode: 'live' | 'historic';
  at?: Date;
}

export interface TwinSurfaceProps {
  level: TwinLevel;
  /** Entidad raiz que se representa. */
  entityId?: string;
  layers?: readonly TwinLayerKind[];
  camera?: TwinCameraPreset;
  beacons?: readonly TwinBeacon[];
  traces?: readonly TwinTrace[];
  timeline?: TwinTimeline;
  /** Seleccion de una entidad dentro del Twin. */
  onSelect?: (entity: { type: string; id: string }) => void;
  reducedMotion?: boolean;
  className?: string;
}

/**
 * Capas activas por defecto.
 *
 * `routes` va incluida: es la capa que aporta MOVIMIENTO al Twin. Sin ella la
 * escena es correcta pero inerte, y el Twin tiene que sentirse vivo.
 */
export const DEFAULT_TWIN_LAYERS: readonly TwinLayerKind[] = [
  'racks',
  'routes',
  'drones',
  'beacons',
];
