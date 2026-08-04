/**
 * LAYOUT EDITOR TYPES
 *
 * Define el estado del editor de plano. Todo es local hasta que Claude
 * entregue el endpoint de persistencia.
 */

// ── Plan (imagen de fondo) ──────────────────────────────────────────────────

export type PlanFileType = 'image/svg+xml' | 'image/png' | 'image/jpeg';

export interface PlanFile {
  name: string;
  type: PlanFileType;
  /** Object URL para renderizar. Se regenera al cargar desde draft. */
  objectUrl: string;
  width: number;
  height: number;
  bytes: number;
  /** Base64 del archivo para persistir en localStorage (solo < 5MB). */
  dataUrl: string | null;
}

// ── Calibracion ─────────────────────────────────────────────────────────────

export interface CalibrationPoints {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  /** Distancia real entre los dos puntos. */
  realDistance: number;
  unit: 'meters' | 'centimeters';
}

export interface Calibration {
  /** Pixels por metro. */
  pixelsPerMeter: number;
  points: CalibrationPoints | null;
  /**
   * Si `pixelsPerMeter` se MIDIO, independientemente de quien lo midiese.
   *
   * Normalmente se deduce de `points != null`: quien calibra marca dos puntos y
   * dice cuanto miden. Pero al abrir un layout PUBLICADO los puntos no vienen —el
   * backend guarda la escala, que es el resultado, no el procedimiento— y sin este
   * campo el editor anunciaria «sin calibrar» sobre un plano medido por otra
   * persona, avisando de un problema que no existe.
   *
   * Opcional para que los borradores ya guardados sigan abriendose: cuando falta,
   * `points != null` es la respuesta correcta.
   */
  measured?: boolean;
}

// ── Sistema de referencia ───────────────────────────────────────────────────

export interface ReferenceSystem {
  /** Origen (0,0) en coordenadas de pixel del plano. */
  origin: { x: number; y: number };
  /** Rotacion general del plano en grados (norte). */
  rotation: number;
  unit: 'meters' | 'centimeters';
}

// ── Rack posicionado ────────────────────────────────────────────────────────

export interface PositionedRack {
  /** Identificador interno del layout (no es rack_id del backend). */
  layoutId: string;
  /** Codigo del rack logico al que se vincula. */
  rackCode: string;
  /**
   * Centro del rack en coordenadas del PLANO (pixeles de la imagen).
   * Para convertir a metros: planPixelsToMeters(x, calibration.pixelsPerMeter)
   */
  x: number;
  y: number;
  /**
   * Dimensiones fisicas reales en METROS.
   * El canvas convierte a pixeles: metersToPlanPixels(width, ppm)
   */
  width: number;
  length: number;
  height: number;
  /** Rotacion en GRADOS. */
  rotation: number;
  /** Si la posicion esta bloqueada. */
  locked: boolean;
  /** Si esta vinculado a un rack logico del dominio. */
  linked: boolean;
  /**
   * Color del rack en el plano. Opcional: sin el se usa el color por defecto.
   *
   * Existe para AGRUPAR VISUALMENTE, que es lo que se hace de verdad al montar un
   * layout: distinguir familias (RCL, PURT, MZ), separar zonas de picking de
   * almacenaje, o marcar lo que esta pendiente de verificar. Se guarda con el
   * borrador, asi que el criterio de color sobrevive a la sesion.
   */
  color?: string;
}

/**
 * Paleta de los racks.
 *
 * Colores del sistema de diseño, no inventados: los mismos tokens que usa el resto
 * de la aplicacion para estado y acento. Ocho es suficiente para distinguir
 * familias sin que dos se confundan a simple vista en un plano denso.
 */
export const COLORES_RACK: ReadonlyArray<{ nombre: string; valor: string }> = [
  { nombre: 'Cian', valor: '#22d9f5' },
  { nombre: 'Iris', valor: '#8b7cf6' },
  { nombre: 'Verde', valor: '#34d399' },
  { nombre: 'Ambar', valor: '#f59e0b' },
  { nombre: 'Rojo', valor: '#f87171' },
  { nombre: 'Rosa', valor: '#f472b6' },
  { nombre: 'Azul', valor: '#60a5fa' },
  { nombre: 'Acero', valor: '#94a3b8' },
];

/** El que se usa cuando el rack no tiene color propio. */
export const COLOR_RACK_POR_DEFECTO = '#22d9f5';

/*
 * UNIDADES EXPLICITAS (documentacion):
 *   x, y             → plan pixels (pixeles de la imagen cargada)
 *   width, length    → meters (metros reales del almacen)
 *   height           → meters
 *   rotation         → degrees
 *
 * Conversion:
 *   planPixels = meters * calibration.pixelsPerMeter
 *   meters = planPixels / calibration.pixelsPerMeter
 *
 * El canvas SIEMPRE convierte width/length a pixels para dibujar:
 *   rectW = rack.width * calibration.pixelsPerMeter
 *   rectL = rack.length * calibration.pixelsPerMeter
 */

// ── Editor modes ────────────────────────────────────────────────────────────

export type EditorMode =
  | 'view'
  | 'select'
  | 'pan'
  | 'calibrate'
  | 'set-origin'
  | 'place-rack'
  | 'measure';

export type VisualMode = 'technical' | 'holographic';
export type ViewDimension = '2d' | '2.5d';

// ── Layers ──────────────────────────────────────────────────────────────────

export interface EditorLayers {
  plan: boolean;
  racks: boolean;
  labels: boolean;
  grid: boolean;
  axes: boolean;
  measurements: boolean;
  zones: boolean;
  selection: boolean;
  // Future (disabled by default)
  heatmap: boolean;
  inventory: boolean;
  sensors: boolean;
  routes: boolean;
  ai: boolean;
}

export const DEFAULT_EDITOR_LAYERS: EditorLayers = {
  plan: true,
  racks: true,
  labels: true,
  grid: true,
  axes: true,
  measurements: true,
  zones: true,
  selection: true,
  heatmap: false,
  inventory: false,
  sensors: false,
  routes: false,
  ai: false,
};

// ── Persistencia del plano ───────────────────────────────────────────────────

/**
 * Describe como se persiste el archivo de imagen del plano.
 * Se guarda junto al draft para que la UI pueda decir que falta.
 */
export interface PlanPersistence {
  metadataStored: boolean;
  imageStored: boolean;
  imageStorage: 'localStorage-base64' | 'not-stored' | 'indexeddb-future';
  /** Si hubo error al intentar guardar la imagen. */
  storageError: string | null;
}

// ── Draft (lo que se persiste en localStorage) ──────────────────────────────

export interface LayoutDraft {
  version: 1;
  warehouseId: string;
  updatedAt: string;
  plan: Omit<PlanFile, 'objectUrl'> | null;
  planPersistence: PlanPersistence;
  calibration: Calibration;
  reference: ReferenceSystem;
  racks: PositionedRack[];
  layers: EditorLayers;
  visualMode: VisualMode;
  viewDimension: ViewDimension;
}

// ── Validaciones ────────────────────────────────────────────────────────────

export type ValidationSeverity = 'warning' | 'error';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  message: string;
  rackCode?: string;
}

// ── History action ──────────────────────────────────────────────────────────

export type HistoryAction =
  | { type: 'place-rack'; rack: PositionedRack }
  | { type: 'move-rack'; layoutId: string; from: { x: number; y: number }; to: { x: number; y: number } }
  /**
   * Movimiento de VARIOS racks como una sola operacion.
   *
   * Alinear ocho racks son ocho movimientos, pero UNA decision: con entradas
   * separadas en el historial habria que pulsar deshacer ocho veces para volver
   * atras, y a la tercera nadie sabe ya donde estaba.
   */
  | {
      type: 'move-many';
      movimientos: { layoutId: string; from: { x: number; y: number }; to: { x: number; y: number } }[];
    }
  | { type: 'rotate-rack'; layoutId: string; from: number; to: number }
  | { type: 'resize-rack'; layoutId: string; from: { width: number; length: number }; to: { width: number; length: number } }
  | { type: 'remove-rack'; rack: PositionedRack }
  | { type: 'calibrate'; from: Calibration; to: Calibration }
  | { type: 'set-origin'; from: ReferenceSystem; to: ReferenceSystem };
