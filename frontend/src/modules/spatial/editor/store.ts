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

  // History
  history: HistoryState;
  canUndo: boolean;
  canRedo: boolean;

  // Snap
  snapToGrid: boolean;
  gridSize: number; // in pixels

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
  setSnapToGrid: (snap: boolean) => void;
  setGridSize: (size: number) => void;

  // History
  performUndo: () => void;
  performRedo: () => void;
  recordAction: (action: HistoryAction) => void;

  // Persistence
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
  history: INITIAL_HISTORY,
  canUndo: false,
  canRedo: false,
  snapToGrid: true,
  gridSize: 20,

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

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setGridSize: (size) => set({ gridSize: size }),

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

  saveDraft: (warehouseId) => {
    const s = get();
    const imageStored = Boolean(s.plan?.dataUrl && s.plan.bytes < 2 * 1024 * 1024);
    const persistence: import('./types').PlanPersistence = {
      metadataStored: Boolean(s.plan),
      imageStored,
      imageStorage: imageStored ? 'localStorage-base64' : 'not-stored',
      storageError: null,
    };
    const draft: LayoutDraft = {
      version: 1,
      warehouseId,
      updatedAt: new Date().toISOString(),
      plan: s.plan ? { name: s.plan.name, type: s.plan.type, width: s.plan.width, height: s.plan.height, bytes: s.plan.bytes, dataUrl: imageStored ? s.plan.dataUrl : null } : null,
      planPersistence: persistence,
      calibration: s.calibration,
      reference: s.reference,
      racks: s.racks,
      layers: s.layers,
      visualMode: s.visualMode,
      viewDimension: s.viewDimension,
    };
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
      if (draft.version !== 1) return false;

      // Rebuild plan objectUrl from dataUrl
      let plan: PlanFile | null = null;
      if (draft.plan && draft.plan.dataUrl) {
        plan = { ...draft.plan, objectUrl: draft.plan.dataUrl };
      }

      set({
        plan,
        calibration: draft.calibration,
        reference: draft.reference,
        racks: draft.racks,
        layers: draft.layers,
        visualMode: draft.visualMode,
        viewDimension: draft.viewDimension,
        // La seleccion NO se persiste: apuntaria a racks de otra sesion.
        selectedRackId: null,
        selectedRackIds: [],
        history: INITIAL_HISTORY,
        canUndo: false,
        canRedo: false,
      });
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
    const s = get();
    const draft: LayoutDraft = {
      version: 1,
      warehouseId: '',
      updatedAt: new Date().toISOString(),
      plan: s.plan ? { name: s.plan.name, type: s.plan.type, width: s.plan.width, height: s.plan.height, bytes: s.plan.bytes, dataUrl: null } : null,
      planPersistence: { metadataStored: Boolean(s.plan), imageStored: false, imageStorage: 'not-stored', storageError: null },
      calibration: s.calibration,
      reference: s.reference,
      racks: s.racks,
      layers: s.layers,
      visualMode: s.visualMode,
      viewDimension: s.viewDimension,
    };
    return JSON.stringify(draft, null, 2);
  },

  importJson: (json, warehouseId) => {
    try {
      const draft = JSON.parse(json) as LayoutDraft;
      if (draft.version !== 1) return false;
      draft.warehouseId = warehouseId;
      set({
        calibration: draft.calibration,
        reference: draft.reference,
        racks: draft.racks,
        layers: draft.layers,
        visualMode: draft.visualMode,
        viewDimension: draft.viewDimension,
        history: INITIAL_HISTORY,
        canUndo: false,
        canRedo: false,
      });
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
