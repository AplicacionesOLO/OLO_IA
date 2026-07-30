/**
 * SPATIAL EXPLORER — Operator Workspace.
 *
 * Each panel consumes its own purpose-specific hook:
 *   Tree        → useSpatialTree(warehouseId, parentId)
 *   Floor Plan  → useFloorPlan(warehouseId)
 *   Rack Front  → useRackFrontView(warehouseId, rackCode)
 *   Inspector   → useLocationDetail(locationId)
 *   KPIs        → useSpatialSummary(warehouseId)
 *   Grid/Search → useLocations(filter)
 *
 * NO universal query. Each read model is independent.
 */

import { useCallback, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useSessionStore } from '../../../auth/sessionStore';
import type { SpatialLocation } from '../types/index';
import {
  useFloorPlan,
  useLocationDetail,
  useLocations,
  useSpatialSummary,
  useSpatialTree,
  useWarehouses,
} from '../services/useSpatial';

import { SpatialGrid } from '../components/SpatialGrid';
import { SpatialKpis } from '../components/SpatialKpis';
import { SpatialToolbar, type SpatialViewMode } from '../components/SpatialToolbar';
import { RackExplorer } from '../components/rack/RackExplorer';
import { useEditorStore } from '../editor/store';
import { useEditorKeyboard } from '../editor/useEditorKeyboard';
import {
  EditorToolbar,
  LayoutEditorCanvas,
  PlanLoader,
  RackInspector,
  EditorLayerPanel,
  UnpositionedRacks,
} from '../editor/components/index';

import {
  CommandPalette,
  Inspector,
  QuickActions,
  Timeline,
  TreePanel,
  WorkspaceLayout,
} from '../components/workspace/index';

import { useWorkspaceStore } from '../workspace/store';
import { useShortcuts, type ShortcutHandlers } from '../workspace/useShortcuts';
import { useRegisterCommands } from '../workspace/useCommands';
import type { Command } from '../workspace/commands';

export function SpatialExplorerPage() {
  const activeWarehouseId = useSessionStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useSessionStore((s) => s.setActiveWarehouse);
  const warehouses = useWarehouses();
  const ws = useWorkspaceStore();

  const [paletteOpen, setPaletteOpen] = useState(false);

  // ═══ PURPOSE-SPECIFIC QUERIES ═════════════════════════════════════════════

  // KPIs
  const summary = useSpatialSummary(activeWarehouseId);

  // Tree: one level at a time, lazy by parentId
  const tree = useSpatialTree(activeWarehouseId, ws.parentId);

  // Floor Plan: aggregated racks (NOT individual positions)
  const floorPlan = useFloorPlan(activeWarehouseId);

  // Rack Front View: positions of the selected rack only

  // Grid/Search: paginated locations (ONLY for grid and search views)
  const gridLocations = useLocations(
    activeWarehouseId,
    ws.search ? undefined : ws.parentId,
    ws.search,
    ws.statusFilter,
  );

  // Inspector: detail of selected location
  const detail = useLocationDetail(ws.selectedId);

  // ═══ DERIVED STATE ════════════════════════════════════════════════════════

  const selectedIds = useMemo(() => new Set(ws.selectedIds), [ws.selectedIds]);
  const gridItems = (gridLocations.data?.items ?? []).filter((l) => ws.layers[l.status]);
  const gridIsPartial = (gridLocations.data?.total ?? 0) > (gridLocations.data?.items.length ?? 0);

  // ═══ HANDLERS ═════════════════════════════════════════════════════════════

  const handleWarehouseChange = useCallback((id: string) => {
    setActiveWarehouse(id);
    ws.resetNavigation();
  }, [setActiveWarehouse, ws]);

  const handleTreeExpand = useCallback((nodeId: string, code: string) => {
    ws.setParentId(nodeId);
    ws.setBreadcrumb([...ws.breadcrumb, { id: nodeId, label: code }]);
    ws.setSelectedId(null);
    ws.setSelectedIds([]);
  }, [ws]);

  const handleTreeSelect = useCallback((nodeId: string) => {
    ws.setSelectedId(nodeId);
    ws.setSelectedIds([nodeId]);
  }, [ws]);

  const navigateBreadcrumb = useCallback((idx: number) => {
    const crumb = ws.breadcrumb[idx];
    if (!crumb) return;
    ws.setParentId(crumb.id);
    ws.setBreadcrumb(ws.breadcrumb.slice(0, idx + 1));
    ws.setSelectedId(null);
    ws.setSelectedIds([]);
  }, [ws]);

  const handleSelect = useCallback((ids: Set<string>) => {
    const arr = [...ids];
    ws.setSelectedIds(arr);
    ws.setSelectedId(arr.length === 1 ? arr[0]! : null);
  }, [ws]);

  const drillDown = useCallback((loc: SpatialLocation) => {
    if (loc.kind === 'location') {
      ws.setSelectedId(loc.id);
      ws.setSelectedIds([loc.id]);
    } else {
      handleTreeExpand(loc.id, loc.code);
    }
  }, [ws, handleTreeExpand]);

  // ═══ SHORTCUTS ════════════════════════════════════════════════════════════

  const shortcutHandlers: ShortcutHandlers = useMemo(() => ({
    'command-palette': () => setPaletteOpen(true),
    'search': () => document.querySelector<HTMLInputElement>('[data-spatial-search] input')?.focus(),
    'view-tree': () => ws.setLeftPanelOpen(!ws.leftPanelOpen),
    'view-canvas': () => ws.setViewMode('canvas'),
    'view-inspector': () => ws.setRightPanelOpen(!ws.rightPanelOpen),
    'toggle-layers': () => ws.setRightPanelOpen(!ws.rightPanelOpen),
    'reset-zoom': () => ws.setZoomLevel(100),
    'clear-selection': () => { ws.setSelectedId(null); ws.setSelectedIds([]); },
    'delete-selection': () => { ws.setSelectedId(null); ws.setSelectedIds([]); },
    'reset-workspace': () => { ws.resetWorkspace(); },
    'focus-selection': () => {},
    'fit-all': () => {},
    'select-all': () => {},
  }), [ws]);

  useShortcuts(shortcutHandlers);

  const commands: Command[] = useMemo(() => [
    { id: 'search-location', label: 'Buscar ubicacion', category: 'Navegacion', shortcut: 'mod+f', execute: () => document.querySelector<HTMLInputElement>('[data-spatial-search] input')?.focus() },
    { id: 'show-occupied', label: 'Mostrar solo ocupadas', category: 'Filtros', execute: () => ws.setStatusFilter('occupied') },
    { id: 'show-available', label: 'Mostrar solo disponibles', category: 'Filtros', execute: () => ws.setStatusFilter('available') },
    { id: 'show-all', label: 'Mostrar todas', category: 'Filtros', execute: () => ws.setStatusFilter(undefined) },
    { id: 'view-canvas-cmd', label: 'Vista canvas', category: 'Vista', execute: () => ws.setViewMode('canvas') },
    { id: 'view-grid-cmd', label: 'Vista grid', category: 'Vista', execute: () => ws.setViewMode('grid') },
    { id: 'view-rack-cmd', label: 'Vista rack', category: 'Vista', execute: () => ws.setViewMode('rack') },
    { id: 'toggle-tree-cmd', label: 'Toggle arbol', category: 'Paneles', shortcut: 'mod+1', execute: () => ws.setLeftPanelOpen(!ws.leftPanelOpen) },
    { id: 'toggle-inspector-cmd', label: 'Toggle inspector', category: 'Paneles', shortcut: 'mod+3', execute: () => ws.setRightPanelOpen(!ws.rightPanelOpen) },
    { id: 'reset-workspace-cmd', label: 'Reset workspace', category: 'Workspace', shortcut: 'mod+shift+r', execute: () => { ws.resetWorkspace(); } },
    { id: 'clear-sel-cmd', label: 'Limpiar seleccion', category: 'Seleccion', execute: () => { ws.setSelectedId(null); ws.setSelectedIds([]); } },
  ], [ws]);

  useRegisterCommands(commands);

  // Editor hooks (must be before conditional returns — React hooks rules)
  const editor = useEditorStore();
  useEditorKeyboard();

  // ═══ RENDER ═══════════════════════════════════════════════════════════════

  if (!activeWarehouseId) {
    return (
      <CanvasHost mode="grid">
        <div className="flex flex-col gap-[var(--panel-gap)]">
          <Header warehouses={warehouses.data ?? []} activeId={activeWarehouseId} onChange={handleWarehouseChange} loading={warehouses.isLoading} />
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <div className="mx-auto flex flex-col items-center gap-5 py-12">
              <Layers strokeWidth={1.25} className="size-10 text-[var(--icon-accent)]" />
              <p className="text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">Selecciona un almacen</p>
              <p className="t-body max-w-[42ch] text-[var(--text-secondary)]">Elige un almacen para explorar su estructura espacial.</p>
            </div>
          </Panel>
        </div>
      </CanvasHost>
    );
  }

  return (
    <CanvasHost mode="immersive">
      <div className="flex h-full flex-col gap-3 px-[var(--canvas-pad-x)] pb-4 pt-2">
        <Header warehouses={warehouses.data ?? []} activeId={activeWarehouseId} onChange={handleWarehouseChange} loading={warehouses.isLoading} />

        {/* Editor toolbar (always visible, toggles edit mode) */}
        <EditorToolbar />

        <WorkspaceLayout
          className="min-h-0 flex-1"
          leftCollapsed={!ws.leftPanelOpen}
          rightCollapsed={!ws.rightPanelOpen}
          leftWidth={ws.leftPanelWidth}
          rightWidth={ws.rightPanelWidth}
          onToggleLeft={() => ws.setLeftPanelOpen(!ws.leftPanelOpen)}
          onToggleRight={() => ws.setRightPanelOpen(!ws.rightPanelOpen)}
          onResizeLeft={ws.setLeftPanelWidth}
          onResizeRight={ws.setRightPanelWidth}
          header={<SpatialKpis summary={summary.data} loading={summary.isLoading} />}
          toolbar={
            <div className="flex items-center gap-3">
              <SpatialToolbar
                search={ws.search}
                onSearchChange={ws.setSearch}
                statusFilter={ws.statusFilter}
                onStatusFilterChange={ws.setStatusFilter}
                viewMode={ws.viewMode}
                onViewModeChange={ws.setViewMode}
                count={floorPlan.data?.racks.length ?? null}
                className="flex-1"
              />
              <QuickActions
                onZoomIn={() => ws.setZoomLevel(Math.min(600, ws.zoomLevel + 25))}
                onZoomOut={() => ws.setZoomLevel(Math.max(30, ws.zoomLevel - 25))}
                onFitAll={() => ws.setZoomLevel(100)}
                onFocusSelection={() => {}}
                onResetView={() => { ws.resetNavigation(); }}
                hasSelection={ws.selectedIds.length > 0}
              />
            </div>
          }
          left={
            <TreePanel
              nodes={tree.data ?? []}
              selectedId={ws.selectedId}
              breadcrumb={ws.breadcrumb}
              search={ws.search}
              onSearchChange={ws.setSearch}
              onSelect={handleTreeSelect}
              onExpand={handleTreeExpand}
              onNavigateBreadcrumb={navigateBreadcrumb}
              loading={tree.isLoading}
              empty={!tree.isLoading && (tree.data?.length ?? 0) === 0}
            />
          }
          center={
            editor.isEditing ? (
              <LayoutEditorCanvas />
            ) : (
            <CenterView
              viewMode={ws.viewMode}
              gridItems={gridItems}
              selectedIds={selectedIds}
              gridLoading={gridLocations.isLoading}
              floorPlanLoading={floorPlan.isLoading}
              gridIsPartial={gridIsPartial}
              gridTotal={gridLocations.data?.total ?? 0}
              gridLoaded={gridLocations.data?.items.length ?? 0}
              allLocations={(gridLocations.data?.items ?? [])}
              handleSelect={handleSelect}
              drillDown={drillDown}
            />
            )
          }
          right={
            editor.isEditing ? (
              <div className="flex flex-col gap-6 overflow-y-auto">
                <PlanLoader />
                <UnpositionedRacks allRacks={floorPlan.data?.racks ?? []} />
                <RackInspector />
                <EditorLayerPanel />
              </div>
            ) : (
            <Inspector
              selectedLocation={detail.data ?? null}
              loading={detail.isLoading}
              layers={ws.layers}
              onToggleLayer={ws.toggleLayer}
              onClose={() => { ws.setSelectedId(null); ws.setSelectedIds([]); }}
            />
            )
          }
          bottom={
            <Timeline
              selectionCount={ws.selectedIds.length}
              zoomPercent={ws.zoomLevel}
              totalLoaded={floorPlan.data?.racks.length ?? 0}
              totalReal={floorPlan.data?.racks.length ?? 0}
              viewMode={ws.viewMode}
            />
          }
        />
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </CanvasHost>
  );
}

// ── Internal ────────────────────────────────────────────────────────────────

function Header({ warehouses, activeId, onChange, loading }: {
  warehouses: { id: string; name: string; code: string }[];
  activeId: string | null;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-[length:var(--text-lg)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
        Spatial Explorer
      </h1>
      <select
        value={activeId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        aria-label="Seleccionar almacen"
        className="h-9 min-w-[180px] rounded-[var(--radius-sm)] px-3 [background:var(--glass-2)] text-[length:var(--text-xs)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
      >
        {warehouses.length === 0 && <option value="">Sin almacenes</option>}
        {warehouses.map((wh) => (
          <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
        ))}
      </select>
    </div>
  );
}

function CenterView({
  viewMode, gridItems, selectedIds, gridLoading, floorPlanLoading,
  gridIsPartial, gridTotal, gridLoaded, allLocations,
  handleSelect, drillDown,
}: {
  viewMode: SpatialViewMode;
  gridItems: SpatialLocation[];
  selectedIds: Set<string>;
  gridLoading: boolean;
  floorPlanLoading: boolean;
  gridIsPartial: boolean;
  gridTotal: number;
  gridLoaded: number;
  allLocations: SpatialLocation[];
  handleSelect: (ids: Set<string>) => void;
  drillDown: (loc: SpatialLocation) => void;

}) {
  if (viewMode === 'rack') {
    if (floorPlanLoading) {
      return <LoadingCenter label="Cargando plano…" />;
    }
    return (
      <div className="h-full overflow-hidden">
        <RackExplorer
          locations={allLocations}
          selectedId={[...selectedIds][0] ?? null}
          onSelectPosition={(id) => handleSelect(new Set([id]))}
        />
      </div>
    );
  }

  if (viewMode === 'grid') {
    if (gridLoading) return <LoadingCenter label="Cargando ubicaciones…" />;
    if (gridItems.length === 0) return <EmptyCenter />;
    return (
      <div className="relative h-full overflow-y-auto p-3">
        <SpatialGrid
          locations={gridItems}
          selectedId={[...selectedIds][0] ?? null}
          onSelect={(loc) => {
            if (loc.kind === 'location') handleSelect(new Set([loc.id]));
            else drillDown(loc);
          }}
        />
        {gridIsPartial && <PartialBadge loaded={gridLoaded} total={gridTotal} />}
      </div>
    );
  }

  if (viewMode === 'canvas') {
    if (gridLoading) return <LoadingCenter label="Cargando…" />;
    return <div className="flex h-full items-center justify-center"><span className="t-mono-xs text-[var(--text-faint)]">Canvas: usar vista Rack para visualizacion completa</span></div>;
  }

  // list
  return <div className="flex h-full items-center justify-center"><span className="t-mono-xs text-[var(--text-faint)]">El arbol esta en el panel izquierdo</span></div>;
}

function LoadingCenter({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center"><span className="t-mono-xs animate-pulse text-[var(--text-faint)]">{label}</span></div>;
}

function EmptyCenter() {
  return <div className="flex h-full items-center justify-center"><span className="t-mono-xs text-[var(--text-faint)]">Sin ubicaciones visibles</span></div>;
}

function PartialBadge({ loaded, total }: { loaded: number; total: number }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1 [background:var(--glass-2)] shadow-[var(--rim-1)]">
      <span className="size-1.5 rounded-full bg-[var(--state-alert)]" />
      <span className="t-mono-xs text-[var(--text-faint)]">Vista parcial: {loaded} de {total}</span>
    </div>
  );
}
