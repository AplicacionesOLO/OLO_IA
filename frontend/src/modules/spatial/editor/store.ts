/**
 * EDITOR STORE — estado del editor de layout.
 *
 * Separado del workspace store: el workspace es para la navegacion
 * operativa; el editor es para la edicion del plano fisico.
 *
 * Persistencia: se guarda como draft en localStorage bajo
 *   olo.spatial.layout-draft.v1.{warehouseId}
 */

import { create } from 'zustand';
import { CAMARA_INICIAL, type Camara } from '../cluster3d/escena';
import type { ViewportTransform } from './transforms';
import type {
  Calibration,
  EditorLayers,
  EditorMode,
  HistoryAction,
  LayoutDraft,
  PlanFile,
  PositionedRack,
  ReferenceSystem,
  ViewDimension,
  VisualMode,
} from './types';
import { DEFAULT_EDITOR_LAYERS } from './types';
import {
  canRedo,
  canUndo,
  INITIAL_HISTORY,
  pushAction,
  redo,
  undo,
  type HistoryState,
} from './history';

const DRAFT_KEY_PREFIX = 'olo.spatial.layout-draft.v1.';

export interface EditorStoreState {
  // Mode
  mode: EditorMode;
  visualMode: VisualMode;
  viewDimension: ViewDimension;
  isEditing: boolean;

  // Plan
  plan: PlanFile | null;

  // Calibration
  calibration: Calibration;

  // Reference system
  reference: ReferenceSystem;

  // Racks
  racks: PositionedRack[];
  /**
   * Rack PRINCIPAL de la seleccion: el ultimo tocado.
   *
   * Se mantiene junto a `selectedRackIds` y no derivado, porque media docena de
   * consumidores lo leen directamente del estado. Las acciones actualizan los dos
   * SIEMPRE a la vez: `selectedRackId` es el ultimo de `selectedRackIds`, o null.
   */
  selectedRackId: string | null;
  /** Seleccion completa. Con un solo rack tiene un elemento. */
  selectedRackIds: string[];

  // Layers
  layers: EditorLayers;

  /**
   * Encuadre del lienzo: desplazamiento y zoom.
   *
   * Vive en el store y no dentro del lienzo porque hay consumidores fuera: la
   * paleta —zoom mas, menos, ajustar, ir a la seleccion—, y mas adelante el visor
   * 3D del cluster, que tendra que compartir encuadre con el 2D, y el seguimiento
   * de la flota, que necesitara centrar la vista en una posicion.
   */
  viewport: ViewportTransform;
  /** Tamaño del lienzo en pixeles. Lo publica el lienzo al medirse. */
  canvasSize: { w: number; h: number };

  /**
   * Camara del visor 3D: giro, inclinacion, escala y desplazamiento.
   *
   * Vive AQUI y no dentro del visor porque los controles de encuadre estan en la
   * paleta de arriba, y la paleta no puede alcanzar el estado interno de un
   * componente. Estuvo dentro, y la consecuencia fue que los botones de acercar,
   * ajustar y centrar desaparecian al pasar a 3D: el operador se quedaba sin forma
   * de recuperar el plano cuando lo perdia de vista.
   *
   * El visor del EXPLORADOR no usa esto: alli lleva su propia camara interna, porque
   * aquella pantalla no tiene paleta que la gobierne.
   */
  camara3d: Camara;
  /** Tamaño del lienzo 3D, para que la paleta pueda encuadrar sin conocer el DOM. */
  canvas3dSize: { w: number; h: number };

  // History
  history: HistoryState;
  canUndo: boolean;
  canRedo: boolean;

  // Snap
  /**
   * Ajuste a rejilla. APAGADO por defecto.
   *
   * Estaba encendido con un paso de 20 pixeles del plano, y en el plano del
   * mezzanine —26,72 px/m— eso son 75 cm: el rack no se podia mover menos de tres
   * cuartos de metro y era imposible colocarlo donde toca. Un ajuste que impide
   * posicionar es peor que ningun ajuste, asi que ahora se enciende cuando se
   * quiere y con el paso que se quiere.
   */
  snapToGrid: boolean;
  /**
   * Paso de la rejilla en METROS, no en pixeles del plano.
   *
   * En pixeles, el significado fisico del paso cambiaba con la resolucion de la
   * imagen y con la calibracion: los mismos 20 px son 0,4 m en un plano y 0,75 m
   * en otro. En metros, el operador decide «cada 25 cm» y eso vale para cualquier
   * plano. El canvas lo convierte con `pixelsPerMeter` al dibujar y al ajustar.
   */
  gridMeters: number;

  // Actions
  setMode: (mode: EditorMode) => void;
  setVisualMode: (mode: VisualMode) => void;
  setViewDimension: (dim: ViewDimension) => void;
  setEditing: (editing: boolean) => void;
  setPlan: (plan: PlanFile | null) => void;
  setCalibration: (cal: Calibration) => void;
  setReference: (ref: ReferenceSystem) => void;
  addRack: (rack: PositionedRack) => void;
  updateRack: (layoutId: string, updates: Partial<PositionedRack>) => void;
  /** Cambia varios racks de una vez: alinear, distribuir, color en bloque. */
  updateRacks: (cambios: { layoutId: string; updates: Partial<PositionedRack> }[]) => void;
  removeRack: (layoutId: string) => void;
  /** Quita todos los seleccionados. Devuelve los que quito, para el historial. */
  removeSelected: () => PositionedRack[];
  selectRack: (layoutId: string | null) => void;
  /** Añade o quita de la seleccion. Es el Ctrl+clic. */
  toggleRackSelection: (layoutId: string) => void;
  /** Reemplaza la seleccion entera. Es el marco de seleccion y el «todo». */
  selectRacks: (layoutIds: string[]) => void;
  toggleLayer: (layer: keyof EditorLayers) => void;
  setViewport: (v: ViewportTransform) => void;
  setCanvasSize: (s: { w: number; h: number }) => void;
  setCamara3d: (c: Camara) => void;
  setCanvas3dSize: (s: { w: number; h: number }) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridMeters: (metros: number) => void;

  // History
  performUndo: () => void;
  performRedo: () => void;
  recordAction: (action: HistoryAction) => void;

  // Persistence
  /**
   * El estado del editor como borrador, sin escribirlo en ningun sitio.
   *
   * Existe porque tres sitios lo construian por separado —guardar, exportar y
   * ahora publicar— y cada copia era una oportunidad de que uno se olvidase de un
   * campo nuevo. `measured` de la calibracion habria sido el primero: la posicion
   * de los racks se publicaria y la escala no, sin que nada fallase.
   *
   * @param conImagen `false` para exportar o publicar: la imagen en base64 son
   *   megas y no viaja en ninguno de los dos casos.
   */
  buildDraft: (warehouseId: string, conImagen?: boolean) => LayoutDraft;
  /** Vuelca un borrador en el editor. Lo contrario de `buildDraft`. */
  applyDraft: (draft: LayoutDraft) => void;
  saveDraft: (warehouseId: string) => void;
  loadDraft: (warehouseId: string) => boolean;
  discardDraft: (warehouseId: string) => void;
  exportJson: () => string;
  importJson: (json: string, warehouseId: string) => boolean;
  resetEditor: () => void;
}

const INITIAL_CALIBRATION: Calibration = { pixelsPerMeter: 50, points: null };
const INITIAL_REFERENCE: ReferenceSystem = { origin: { x: 0, y: 0 }, rotation: 0, unit: 'meters' };

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  mode: 'view',
  visualMode: 'technical',
  viewDimension: '2d',
  isEditing: false,
  plan: null,
  calibration: INITIAL_CALIBRATION,
  reference: INITIAL_REFERENCE,
  racks: [],
  selectedRackId: null,
  selectedRackIds: [],
  layers: DEFAULT_EDITOR_LAYERS,
  viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
  canvasSize: { w: 0, h: 0 },
  camara3d: CAMARA_INICIAL,
  canvas3dSize: { w: 0, h: 0 },
  history: INITIAL_HISTORY,
  canUndo: false,
  canRedo: false,
  snapToGrid: false,
  gridMeters: 0.25,

  setMode: (mode) => set({ mode }),
  setVisualMode: (visualMode) => set({ visualMode }),
  setViewDimension: (viewDimension) => set({ viewDimension }),
  setEditing: (isEditing) => set({ isEditing, mode: isEditing ? 'select' : 'view' }),
  setPlan: (plan) => set({ plan }),
  setCalibration: (calibration) => set({ calibration }),
  setReference: (reference) => set({ reference }),

  addRack: (rack) => {
    set((s) => ({
      racks: [...s.racks, rack],
      history: pushAction(s.history, { type: 'place-rack', rack }),
      canUndo: true,
      canRedo: false,
    }));
  },

  updateRack: (layoutId, updates) => {
    set((s) => ({
      racks: s.racks.map((r) => (r.layoutId === layoutId ? { ...r, ...updates } : r)),
    }));
  },

  updateRacks: (cambios) => {
    const porId = new Map(cambios.map((c) => [c.layoutId, c.updates]));
    set((s) => ({
      racks: s.racks.map((r) => {
        const u = porId.get(r.layoutId);
        return u ? { ...r, ...u } : r;
      }),
    }));
  },

  removeRack: (layoutId) => {
    const rack = get().racks.find((r) => r.layoutId === layoutId);
    if (!rack) return;
    set((s) => ({
      racks: s.racks.filter((r) => r.layoutId !== layoutId),
      selectedRackId: s.selectedRackId === layoutId ? null : s.selectedRackId,
      selectedRackIds: s.selectedRackIds.filter((id) => id !== layoutId),
      history: pushAction(s.history, { type: 'remove-rack', rack }),
      canUndo: true,
      canRedo: false,
    }));
  },

  removeSelected: () => {
    const s = get();
    const fuera = s.racks.filter((r) => s.selectedRackIds.includes(r.layoutId) && !r.locked);
    if (fuera.length === 0) return [];
    const ids = new Set(fuera.map((r) => r.layoutId));
    set((prev) => ({
      racks: prev.racks.filter((r) => !ids.has(r.layoutId)),
      selectedRackId: null,
      selectedRackIds: [],
      // Una entrada de historial por rack: el modelo de acciones no tiene un
      // «quitar varios», y encadenarlas conserva la reversibilidad.
      history: fuera.reduce(
        (h, rack) => pushAction(h, { type: 'remove-rack', rack }),
        prev.history,
      ),
      canUndo: true,
      canRedo: false,
    }));
    return fuera;
  },

  selectRack: (layoutId) =>
    set({ selectedRackId: layoutId, selectedRackIds: layoutId ? [layoutId] : [] }),

  toggleRackSelection: (layoutId) =>
    set((s) => {
      const dentro = s.selectedRackIds.includes(layoutId);
      const ids = dentro
        ? s.selectedRackIds.filter((id) => id !== layoutId)
        : [...s.selectedRackIds, layoutId];
      return { selectedRackIds: ids, selectedRackId: ids[ids.length - 1] ?? null };
    }),

  selectRacks: (layoutIds) =>
    set({ selectedRackIds: layoutIds, selectedRackId: layoutIds[layoutIds.length - 1] ?? null }),

  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),

  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setCamara3d: (camara3d) => set({ camara3d }),
  setCanvas3dSize: (canvas3dSize) => set({ canvas3dSize }),

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  // Minimo 1 cm: por debajo el ajuste no ajusta nada y solo cuesta calculo.
  setGridMeters: (metros) => set({ gridMeters: Math.max(0.01, metros) }),

  recordAction: (action) => {
    set((s) => {
      const h = pushAction(s.history, action);
      return { history: h, canUndo: canUndo(h), canRedo: canRedo(h) };
    });
  },

  performUndo: () => {
    set((s) => {
      const { state: h, action } = undo(s.history);
      if (!action) return s;
      // Reverse the action
      let racks = s.racks;
      switch (action.type) {
        case 'place-rack':
          racks = racks.filter((r) => r.layoutId !== action.rack.layoutId);
          break;
        case 'remove-rack':
          racks = [...racks, action.rack];
          break;
        case 'move-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, x: action.from.x, y: action.from.y } : r);
          break;
        case 'move-many': {
          const previos = new Map(action.movimientos.map((m) => [m.layoutId, m.from]));
          racks = racks.map((r) => {
            const p = previos.get(r.layoutId);
            return p ? { ...r, x: p.x, y: p.y } : r;
          });
          break;
        }
        case 'rotate-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, rotation: action.from } : r);
          break;
        case 'resize-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, ...action.from } : r);
          break;
        case 'calibrate':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), calibration: action.from };
        case 'set-origin':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), reference: action.from };
      }
      return { racks, history: h, canUndo: canUndo(h), canRedo: canRedo(h) };
    });
  },

  performRedo: () => {
    set((s) => {
      const { state: h, action } = redo(s.history);
      if (!action) return s;
      let racks = s.racks;
      switch (action.type) {
        case 'place-rack':
          racks = [...racks, action.rack];
          break;
        case 'remove-rack':
          racks = racks.filter((r) => r.layoutId !== action.rack.layoutId);
          break;
        case 'move-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, x: action.to.x, y: action.to.y } : r);
          break;
        case 'move-many': {
          const destinos = new Map(action.movimientos.map((m) => [m.layoutId, m.to]));
          racks = racks.map((r) => {
            const d = destinos.get(r.layoutId);
            return d ? { ...r, x: d.x, y: d.y } : r;
          });
          break;
        }
        case 'rotate-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, rotation: action.to } : r);
          break;
        case 'resize-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, ...action.to } : r);
          break;
        case 'calibrate':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), calibration: action.to };
        case 'set-origin':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), reference: action.to };
      }
      return { racks, history: h, canUndo: canUndo(h), canRedo: canRedo(h) };
    });
  },

  buildDraft: (warehouseId, conImagen = true) => {
    const s = get();
    // 2 MB: `localStorage` ronda los 5 y el base64 crece un tercio sobre el
    // archivo. Por encima se guarda la geometria SIN la imagen, porque perder la
    // imagen y conservar las posiciones es mucho mejor que perder las dos.
    const imageStored = conImagen && Boolean(s.plan?.dataUrl && s.plan.bytes < 2 * 1024 * 1024);
    return {
      version: 1,
      warehouseId,
      updatedAt: new Date().toISOString(),
      plan: s.plan
        ? {
            name: s.plan.name,
            type: s.plan.type,
            width: s.plan.width,
            height: s.plan.height,
            bytes: s.plan.bytes,
            dataUrl: imageStored ? s.plan.dataUrl : null,
          }
        : null,
      planPersistence: {
        metadataStored: Boolean(s.plan),
        imageStored,
        imageStorage: imageStored ? 'localStorage-base64' : 'not-stored',
        storageError: null,
      },
      calibration: s.calibration,
      reference: s.reference,
      racks: s.racks,
      layers: s.layers,
      visualMode: s.visualMode,
      viewDimension: s.viewDimension,
    };
  },

  applyDraft: (draft) => {
    // La imagen se reconstruye del base64 si venia; si no, el editor se queda sin
    // fondo y el cargador de plano lo dice. Los racks se dibujan igual: sus
    // coordenadas no dependen de que la imagen este.
    const plan: PlanFile | null =
      draft.plan && draft.plan.dataUrl
        ? { ...draft.plan, objectUrl: draft.plan.dataUrl }
        : null;
    set({
      plan,
      calibration: draft.calibration,
      reference: draft.reference,
      racks: draft.racks,
      layers: draft.layers,
      visualMode: draft.visualMode,
      viewDimension: draft.viewDimension,
      // La seleccion NO se restaura: apuntaria a racks de otra sesion.
      selectedRackId: null,
      selectedRackIds: [],
      // El historial tampoco: deshacer sobre un borrador recien abierto volveria a
      // un estado que este editor nunca tuvo.
      history: INITIAL_HISTORY,
      canUndo: false,
      canRedo: false,
    });
  },

  saveDraft: (warehouseId) => {
    const draft = get().buildDraft(warehouseId);
    const persistence = draft.planPersistence;
    try {
      localStorage.setItem(DRAFT_KEY_PREFIX + warehouseId, JSON.stringify(draft));
    } catch (err) {
      persistence.imageStored = false;
      persistence.imageStorage = 'not-stored';
      persistence.storageError = err instanceof Error ? err.message : 'Storage quota exceeded';
      if (draft.plan) draft.plan.dataUrl = null;
      draft.planPersistence = persistence;
      try { localStorage.setItem(DRAFT_KEY_PREFIX + warehouseId, JSON.stringify(draft)); } catch { /* truly full */ }
    }
  },

  loadDraft: (warehouseId) => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY_PREFIX + warehouseId);
      if (!raw) return false;
      const draft = JSON.parse(raw) as LayoutDraft;
      // Una version futura se ignora en lugar de intentar leerse: un layout mal
      // interpretado dibuja racks en sitios equivocados, y eso es peor que no
      // dibujar nada.
      if (draft.version !== 1) return false;
      get().applyDraft(draft);
      return true;
    } catch {
      return false;
    }
  },

  discardDraft: (warehouseId) => {
    localStorage.removeItem(DRAFT_KEY_PREFIX + warehouseId);
    get().resetEditor();
  },

  exportJson: () => {
    // Sin imagen: un JSON con megas de base64 no se pega en ningun sitio. Se
    // exporta la geometria, que es lo que cuesta rehacer.
    const draft = get().buildDraft('', false);
    return JSON.stringify(draft, null, 2);
  },

  importJson: (json, warehouseId) => {
    try {
      const draft = JSON.parse(json) as LayoutDraft;
      if (draft.version !== 1) return false;
      draft.warehouseId = warehouseId;
      // El plano cargado NO se sustituye: el JSON exportado no lleva imagen, asi
      // que aplicarlo tal cual dejaria al operador sin el fondo que tenia delante.
      get().applyDraft({ ...draft, plan: get().plan ?? draft.plan });
      return true;
    } catch {
      return false;
    }
  },

  resetEditor: () => set({
    mode: 'view',
    isEditing: false,
    plan: null,
    calibration: INITIAL_CALIBRATION,
    camara3d: CAMARA_INICIAL,
    reference: INITIAL_REFERENCE,
    racks: [],
    selectedRackId: null,
    selectedRackIds: [],
    layers: DEFAULT_EDITOR_LAYERS,
    history: INITIAL_HISTORY,
    canUndo: false,
    canRedo: false,
  }),
}));
