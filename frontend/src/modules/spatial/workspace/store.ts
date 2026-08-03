/**
 * WORKSPACE STORE — estado de la UI, persistido.
 *
 * NO almacena datos del repositorio. Solo lo que el operador configuro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ARREGLO: LA NAVEGACION ES **POR ALMACEN**
 *
 * Antes `parentId`, `breadcrumb`, `selectedId` y los nodos expandidos se
 * guardaban en la raiz del store, compartidos entre todos los almacenes. Con dos
 * almacenes eso produce dos fallos concretos:
 *
 *   · cambiar de almacen dejaba seleccionado un nodo del anterior, y el panel de
 *     detalle pedia un UUID que RLS no deja ver en el nuevo → 404 inexplicable;
 *   · al volver, la navegacion no estaba donde se dejo, sino donde la dejo el
 *     otro almacen.
 *
 * Ahora la navegacion vive en `nav[warehouseId]`. Cada almacen recuerda la suya y
 * ninguno puede contaminar al otro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  DEFAULT_LAYERS,
  type LayerConfig,
  type SpatialViewMode,
  type VisualLayer,
} from '../viewTypes';
import type { BreadcrumbSegment } from '../components/Breadcrumb';
import type { CodeForm, LocationStatus } from '../types/index';

/** Navegacion de UN almacen. */
export interface WarehouseNav {
  /** Nodos expandidos en el arbol. Array y no Set: `persist` serializa a JSON. */
  expandedIds: string[];
  /** Nodo seleccionado en el arbol (rack o cuerpo). */
  selectedNodeId: string | null;
  /** Ubicacion seleccionada, para el inspector. */
  selectedLocationId: string | null;
  /** Rack cuyo alzado se esta viendo. */
  activeRackId: string | null;
  breadcrumb: BreadcrumbSegment[];
}

const NAV_VACIA: WarehouseNav = {
  expandedIds: [],
  selectedNodeId: null,
  selectedLocationId: null,
  activeRackId: null,
  breadcrumb: [{ id: null, label: 'Raiz' }],
};

export interface WorkspaceState {
  // ── Paneles ───────────────────────────────────────────────────────────────
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;

  // ── Vista ─────────────────────────────────────────────────────────────────
  viewMode: SpatialViewMode;
  zoomLevel: number;
  layers: LayerConfig;
  /**
   * Capa de color de la vista del rack. `inspection` queda seleccionable pero sin
   * datos: pinta todo como «sin leer», que es la verdad hasta que haya lecturas.
   */
  visualLayer: VisualLayer;

  // ── Filtros (globales: describen que se busca, no donde se esta) ──────────
  statusFilter: LocationStatus | undefined;
  situationFilter: string | undefined;
  codeFormFilter: CodeForm | undefined;
  levelFilter: number | undefined;
  search: string;
  /** Pagina de la tabla. Se reinicia al cambiar cualquier filtro. */
  page: number;
  /**
   * Si se pide el `count` exacto. Opt-in porque cuesta una consulta mas, y en una
   * navegacion por cursor sobre 29.310 filas contarlas en cada pagina es trabajo
   * que nadie pidio.
   */
  withTotal: boolean;

  // ── Navegacion, POR ALMACEN ───────────────────────────────────────────────
  nav: Record<string, WarehouseNav>;

  // ── Acciones ──────────────────────────────────────────────────────────────
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setViewMode: (mode: SpatialViewMode) => void;
  setZoomLevel: (zoom: number) => void;
  setLayers: (layers: LayerConfig) => void;
  setVisualLayer: (layer: VisualLayer) => void;
  toggleLayer: (status: LocationStatus) => void;

  setStatusFilter: (status: LocationStatus | undefined) => void;
  setSituationFilter: (situation: string | undefined) => void;
  setCodeFormFilter: (form: CodeForm | undefined) => void;
  setLevelFilter: (level: number | undefined) => void;
  setSearch: (search: string) => void;
  setPage: (page: number) => void;
  setWithTotal: (on: boolean) => void;
  clearFilters: () => void;

  /** Navegacion de un almacen concreto. Nunca `undefined`. */
  navOf: (warehouseId: string | null) => WarehouseNav;
  toggleExpanded: (warehouseId: string, nodeId: string) => void;
  setSelectedNode: (warehouseId: string, nodeId: string | null) => void;
  setSelectedLocation: (warehouseId: string, locationId: string | null) => void;
  setActiveRack: (warehouseId: string, rackId: string | null) => void;
  setBreadcrumb: (warehouseId: string, segments: BreadcrumbSegment[]) => void;
  resetNav: (warehouseId: string) => void;

  resetWorkspace: () => void;
}

const DEFAULTS = {
  leftPanelOpen: true,
  rightPanelOpen: true,
  leftPanelWidth: 300,
  rightPanelWidth: 340,
  viewMode: 'grid' as SpatialViewMode,
  zoomLevel: 100,
  layers: DEFAULT_LAYERS,
  visualLayer: 'spatial' as VisualLayer,
  statusFilter: undefined,
  situationFilter: undefined,
  codeFormFilter: undefined,
  levelFilter: undefined,
  search: '',
  page: 1,
  withTotal: false,
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      nav: {},

      setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setLeftPanelWidth: (w) => set({ leftPanelWidth: Math.max(220, Math.min(520, w)) }),
      setRightPanelWidth: (w) => set({ rightPanelWidth: Math.max(260, Math.min(520, w)) }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
      setLayers: (layers) => set({ layers }),
      setVisualLayer: (layer) => set({ visualLayer: layer }),
      toggleLayer: (status) =>
        set((s) => ({ layers: { ...s.layers, [status]: !s.layers[status] } })),

      // Todo cambio de filtro vuelve a la pagina 1. Sin esto, filtrar desde la
      // pagina 7 pide la pagina 7 de un resultado que quiza tenga 2.
      setStatusFilter: (status) => set({ statusFilter: status, page: 1 }),
      setSituationFilter: (situation) => set({ situationFilter: situation, page: 1 }),
      setCodeFormFilter: (form) => set({ codeFormFilter: form, page: 1 }),
      setLevelFilter: (level) => set({ levelFilter: level, page: 1 }),
      setSearch: (search) => set({ search, page: 1 }),
      setPage: (page) => set({ page: Math.max(1, page) }),
      setWithTotal: (on) => set({ withTotal: on }),
      clearFilters: () =>
        set({
          statusFilter: undefined,
          situationFilter: undefined,
          codeFormFilter: undefined,
          levelFilter: undefined,
          search: '',
          page: 1,
        }),

      navOf: (warehouseId) => {
        if (!warehouseId) return NAV_VACIA;
        return get().nav[warehouseId] ?? NAV_VACIA;
      },

      toggleExpanded: (warehouseId, nodeId) =>
        set((s) => {
          const actual = s.nav[warehouseId] ?? NAV_VACIA;
          const yaEsta = actual.expandedIds.includes(nodeId);
          return {
            nav: {
              ...s.nav,
              [warehouseId]: {
                ...actual,
                expandedIds: yaEsta
                  ? actual.expandedIds.filter((id) => id !== nodeId)
                  : [...actual.expandedIds, nodeId],
              },
            },
          };
        }),

      setSelectedNode: (warehouseId, nodeId) =>
        set((s) => ({
          nav: {
            ...s.nav,
            [warehouseId]: { ...(s.nav[warehouseId] ?? NAV_VACIA), selectedNodeId: nodeId },
          },
        })),

      setSelectedLocation: (warehouseId, locationId) =>
        set((s) => ({
          nav: {
            ...s.nav,
            [warehouseId]: {
              ...(s.nav[warehouseId] ?? NAV_VACIA),
              selectedLocationId: locationId,
            },
          },
        })),

      setActiveRack: (warehouseId, rackId) =>
        set((s) => ({
          nav: {
            ...s.nav,
            [warehouseId]: { ...(s.nav[warehouseId] ?? NAV_VACIA), activeRackId: rackId },
          },
        })),

      setBreadcrumb: (warehouseId, segments) =>
        set((s) => ({
          nav: {
            ...s.nav,
            [warehouseId]: { ...(s.nav[warehouseId] ?? NAV_VACIA), breadcrumb: segments },
          },
        })),

      resetNav: (warehouseId) =>
        set((s) => ({ nav: { ...s.nav, [warehouseId]: NAV_VACIA } })),

      resetWorkspace: () => set({ ...DEFAULTS, nav: {} }),
    }),
    {
      name: 'olo-spatial-workspace',
      // v2: la forma de `nav` cambio. Sin subir la version, un estado v1 en
      // localStorage dejaria `nav` como `undefined` y `navOf` reventaria en el
      // primer render tras el despliegue.
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          // La navegacion antigua era global y no se puede atribuir a un almacen:
          // se descarta. Los ajustes de panel y vista si se conservan.
          const viejo = (persisted ?? {}) as Partial<WorkspaceState>;
          return {
            ...DEFAULTS,
            leftPanelOpen: viejo.leftPanelOpen ?? DEFAULTS.leftPanelOpen,
            rightPanelOpen: viejo.rightPanelOpen ?? DEFAULTS.rightPanelOpen,
            leftPanelWidth: viejo.leftPanelWidth ?? DEFAULTS.leftPanelWidth,
            rightPanelWidth: viejo.rightPanelWidth ?? DEFAULTS.rightPanelWidth,
            viewMode: viejo.viewMode ?? DEFAULTS.viewMode,
            zoomLevel: viejo.zoomLevel ?? DEFAULTS.zoomLevel,
            layers: viejo.layers ?? DEFAULTS.layers,
            nav: {},
          } as WorkspaceState;
        }
        return persisted as WorkspaceState;
      },
      partialize: (state) => ({
        leftPanelOpen: state.leftPanelOpen,
        rightPanelOpen: state.rightPanelOpen,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        viewMode: state.viewMode,
        zoomLevel: state.zoomLevel,
        layers: state.layers,
        visualLayer: state.visualLayer,
        // Los filtros SI se persisten: volver y encontrar el mismo filtro es lo
        // esperado. `page` no, porque una pagina profunda sin contexto desorienta.
        statusFilter: state.statusFilter,
        situationFilter: state.situationFilter,
        codeFormFilter: state.codeFormFilter,
        levelFilter: state.levelFilter,
        withTotal: state.withTotal,
        nav: state.nav,
      }),
    },
  ),
);
