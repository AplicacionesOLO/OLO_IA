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
  /** Centro del rack en coordenadas del plano (px). */
  x: number;
  y: number;
  /** Dimensiones en metros. */
  width: number;
  length: number;
  height: number;
  /** Rotacion en grados. */
  rotation: number;
  /** Si la posicion esta bloqueada. */
  locked: boolean;
  /** Si esta vinculado a un rack logico del dominio. */
  linked: boolean;
}

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

// ── Draft (lo que se persiste en localStorage) ──────────────────────────────

export interface LayoutDraft {
  version: 1;
  warehouseId: string;
  updatedAt: string;
  plan: Omit<PlanFile, 'objectUrl'> | null;
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
  | { type: 'rotate-rack'; layoutId: string; from: number; to: number }
  | { type: 'resize-rack'; layoutId: string; from: { width: number; length: number }; to: { width: number; length: number } }
  | { type: 'remove-rack'; rack: PositionedRack }
  | { type: 'calibrate'; from: Calibration; to: Calibration }
  | { type: 'set-origin'; from: ReferenceSystem; to: ReferenceSystem };
