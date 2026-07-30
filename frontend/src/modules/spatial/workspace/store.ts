/**
 * WORKSPACE STORE — estado persistido del workspace.
 *
 * Zustand con middleware `persist` sobre localStorage. Al recargar, el
 * workspace se restaura exactamente como estaba: paneles, zoom, capas,
 * filtros, vista y selección.
 *
 * NO almacena datos del repositorio. Solo el ESTADO DE LA UI.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LAYERS, type LayerConfig } from '../components/LayerPanel';
import type { SpatialViewMode } from '../components/SpatialToolbar';
import type { LocationStatus } from '../types/index';
import type { BreadcrumbSegment } from '../components/Breadcrumb';

export interface WorkspaceState {
  // Panel visibility
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;

  // View
  viewMode: SpatialViewMode;
  zoomLevel: number;

  // Layers
  layers: LayerConfig;

  // Filters
  statusFilter: LocationStatus | undefined;
  search: string;

  // Navigation
  parentId: string | null;
  breadcrumb: BreadcrumbSegment[];

  // Selection
  selectedId: string | null;
  selectedIds: string[];

  // Actions
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setViewMode: (mode: SpatialViewMode) => void;
  setZoomLevel: (zoom: number) => void;
  setLayers: (layers: LayerConfig) => void;
  toggleLayer: (status: LocationStatus) => void;
  setStatusFilter: (status: LocationStatus | undefined) => void;
  setSearch: (search: string) => void;
  setParentId: (id: string | null) => void;
  setBreadcrumb: (segments: BreadcrumbSegment[]) => void;
  setSelectedId: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  resetNavigation: () => void;
  resetWorkspace: () => void;
}

const INITIAL_BREADCRUMB: BreadcrumbSegment[] = [{ id: null, label: 'Raiz' }];

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      // Defaults
      leftPanelOpen: true,
      rightPanelOpen: true,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      viewMode: 'canvas',
      zoomLevel: 100,
      layers: DEFAULT_LAYERS,
      statusFilter: undefined,
      search: '',
      parentId: null,
      breadcrumb: INITIAL_BREADCRUMB,
      selectedId: null,
      selectedIds: [],

      // Setters
      setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setLeftPanelWidth: (width) => set({ leftPanelWidth: Math.max(200, Math.min(500, width)) }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(240, Math.min(500, width)) }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
      setLayers: (layers) => set({ layers }),
      toggleLayer: (status) =>
        set((s) => ({ layers: { ...s.layers, [status]: !s.layers[status] } })),
      setStatusFilter: (status) => set({ statusFilter: status }),
      setSearch: (search) => set({ search }),
      setParentId: (id) => set({ parentId: id }),
      setBreadcrumb: (segments) => set({ breadcrumb: segments }),
      setSelectedId: (id) => set({ selectedId: id }),
      setSelectedIds: (ids) => set({ selectedIds: ids }),

      resetNavigation: () =>
        set({
          parentId: null,
          breadcrumb: INITIAL_BREADCRUMB,
          selectedId: null,
          selectedIds: [],
          search: '',
          statusFilter: undefined,
        }),

      resetWorkspace: () =>
        set({
          leftPanelOpen: true,
          rightPanelOpen: true,
          leftPanelWidth: 280,
          rightPanelWidth: 320,
          viewMode: 'canvas',
          zoomLevel: 100,
          layers: DEFAULT_LAYERS,
          statusFilter: undefined,
          search: '',
          parentId: null,
          breadcrumb: INITIAL_BREADCRUMB,
          selectedId: null,
          selectedIds: [],
        }),
    }),
    {
      name: 'olo-spatial-workspace',
      // Only persist UI state, not transient data
      partialize: (state) => ({
        leftPanelOpen: state.leftPanelOpen,
        rightPanelOpen: state.rightPanelOpen,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        viewMode: state.viewMode,
        zoomLevel: state.zoomLevel,
        layers: state.layers,
        statusFilter: state.statusFilter,
        parentId: state.parentId,
        breadcrumb: state.breadcrumb,
      }),
    },
  ),
);
