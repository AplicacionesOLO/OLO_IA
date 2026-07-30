/**
 * SPATIAL EXPLORER — Operator Workspace.
 *
 * Professional WMS operator interface integrating:
 * - Persistent workspace state (localStorage)
 * - Keyboard shortcuts (centralized)
 * - Command palette (Ctrl+Shift+P)
 * - Multi-select sync (tree + canvas + grid)
 * - Collapsible resizable panels
 * - Inspector with tabs
 * - Timeline status bar
 */

import { useCallback, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useSessionStore } from '../../../auth/sessionStore';
import type { SpatialLocation } from '../types/index';
import { computeLayout } from '../engine/LayoutEngine';
import {
  useFloorPlan,
  useLocationDetail,
  useLocations,
  useSpatialSummary,
  useWarehouses,
} from '../services/useSpatial';

import type { LayerConfig } from '../components/LayerPanel';
import { SpatialCanvas } from '../components/SpatialCanvas';
import { SpatialGrid } from '../components/SpatialGrid';
import { SpatialKpis } from '../components/SpatialKpis';
import { SpatialToolbar, type SpatialViewMode } from '../components/SpatialToolbar';
import { RackExplorer } from '../components/rack/RackExplorer';

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

  // Persistent workspace state
  const ws = useWorkspaceStore();

  // Command palette state (transient, not persisted)
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Data queries — each purpose has its own query
  const summary = useSpatialSummary(activeWarehouseId);

  // Floor plan: aggregated racks (NOT individual positions)
  const floorPlan = useFloorPlan(activeWarehouseId);

  // Locations: paginada para busqueda/grid/tree
  const locations = useLocations(
    activeWarehouseId,
    ws.search ? undefined : ws.parentId,
    ws.search,
    ws.statusFilter,
  );

  const selectedId = ws.selectedId;
  const detail = useLocationDetail(selectedId);

  // Derived
  const selectedIds = useMemo(() => new Set(ws.selectedIds), [ws.selectedIds]);
  const treeLocations = (locations.data?.items ?? []).filter((l) => ws.layers[l.status]);
  const floorLocations = (locations.data?.items ?? []).filter((l) => ws.layers[l.status]);
  const canvasLayout = useMemo(() => computeLayout(floorLocations), [floorLocations]);
  const isPartial = (locations.data?.total ?? 0) > (locations.data?.items.length ?? 0);

  // ── Navigation handlers ───────────────────────────────────────────────
  const drillDown = useCallback((loc: SpatialLocation) => {
    if (loc.kind === 'location') {
      ws.setSelectedId(loc.id);
      ws.setSelectedIds([loc.id]);
    } else {
      ws.setParentId(loc.id);
      ws.setBreadcrumb([...ws.breadcrumb, { id: loc.id, label: loc.code }]);
      ws.setSelectedId(null);
      ws.setSelectedIds([]);
    }
  }, [ws]);

  const navigateBreadcrumb = useCallback((idx: number) => {
    const crumb = ws.breadcrumb[idx];
    if (!crumb) return;
    ws.setParentId(crumb.id);
    ws.setBreadcrumb(ws.breadcrumb.slice(0, idx + 1));
    ws.setSelectedId(null);
    ws.setSelectedIds([]);
  }, [ws]);

  const handleWarehouseChange = useCallback((id: string) => {
    setActiveWarehouse(id);
    ws.resetNavigation();
  }, [setActiveWarehouse, ws]);

  const handleSelect = useCallback((ids: Set<string>) => {
    const arr = [...ids];
    ws.setSelectedIds(arr);
    ws.setSelectedId(arr.length === 1 ? arr[0]! : null);
  }, [ws]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  const shortcutHandlers: ShortcutHandlers = useMemo(() => ({
    'command-palette': () => setPaletteOpen(true),
    'search': () => document.querySelector<HTMLInputElement>('[data-spatial-search]')?.focus(),
    'view-tree': () => ws.setLeftPanelOpen(!ws.leftPanelOpen),
    'view-canvas': () => ws.setViewMode('canvas'),
    'view-inspector': () => ws.setRightPanelOpen(!ws.rightPanelOpen),
    'toggle-layers': () => ws.setRightPanelOpen(!ws.rightPanelOpen),
    'reset-zoom': () => ws.setZoomLevel(100),
    'clear-selection': () => { ws.setSelectedId(null); ws.setSelectedIds([]); },
    'delete-selection': () => { ws.setSelectedId(null); ws.setSelectedIds([]); },
    'reset-workspace': () => ws.resetWorkspace(),
    'focus-selection': () => { /* handled by canvas */ },
    'fit-all': () => { /* handled by canvas */ },
    'select-all': () => ws.setSelectedIds(floorLocations.map((l) => l.id)),
  }), [ws, floorLocations]);

  useShortcuts(shortcutHandlers);

  // ── Command palette commands ──────────────────────────────────────────
  const commands: Command[] = useMemo(() => [
    { id: 'search-location', label: 'Buscar ubicacion', category: 'Navegacion', shortcut: 'mod+f', execute: () => document.querySelector<HTMLInputElement>('[data-spatial-search]')?.focus() },
    { id: 'show-occupied', label: 'Mostrar solo ocupadas', category: 'Filtros', execute: () => ws.setStatusFilter('occupied') },
    { id: 'show-available', label: 'Mostrar solo disponibles', category: 'Filtros', execute: () => ws.setStatusFilter('available') },
    { id: 'show-inferred', label: 'Mostrar solo inferidas', category: 'Filtros', execute: () => ws.setStatusFilter('inferred') },
    { id: 'show-all', label: 'Mostrar todas', category: 'Filtros', execute: () => ws.setStatusFilter(undefined) },
    { id: 'view-canvas-cmd', label: 'Cambiar a vista canvas', category: 'Vista', shortcut: 'mod+2', execute: () => ws.setViewMode('canvas') },
    { id: 'view-grid-cmd', label: 'Cambiar a vista grid', category: 'Vista', execute: () => ws.setViewMode('grid') },
    { id: 'view-list-cmd', label: 'Cambiar a vista lista', category: 'Vista', execute: () => ws.setViewMode('list') },
    { id: 'toggle-tree', label: 'Mostrar/ocultar arbol', category: 'Paneles', shortcut: 'mod+1', execute: () => ws.setLeftPanelOpen(!ws.leftPanelOpen) },
    { id: 'toggle-inspector', label: 'Mostrar/ocultar inspector', category: 'Paneles', shortcut: 'mod+3', execute: () => ws.setRightPanelOpen(!ws.rightPanelOpen) },
    { id: 'reset-workspace-cmd', label: 'Reset workspace', category: 'Workspace', shortcut: 'mod+shift+r', execute: () => ws.resetWorkspace() },
    { id: 'clear-sel-cmd', label: 'Limpiar seleccion', category: 'Seleccion', shortcut: 'escape', execute: () => { ws.setSelectedId(null); ws.setSelectedIds([]); } },
    { id: 'select-all-cmd', label: 'Seleccionar todo visible', category: 'Seleccion', shortcut: 'mod+a', execute: () => ws.setSelectedIds(floorLocations.map((l) => l.id)) },
  ], [ws, floorLocations]);

  useRegisterCommands(commands);

  // ── Render ────────────────────────────────────────────────────────────

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
                count={floorLocations.length}
                className="flex-1"
              />
              <QuickActions
                onZoomIn={() => ws.setZoomLevel(Math.min(600, ws.zoomLevel + 25))}
                onZoomOut={() => ws.setZoomLevel(Math.max(30, ws.zoomLevel - 25))}
                onFitAll={() => ws.setZoomLevel(100)}
                onFocusSelection={() => {}}
                onResetView={() => ws.resetNavigation()}
                hasSelection={ws.selectedIds.length > 0}
              />
            </div>
          }
          left={
            <TreePanel
              locations={treeLocations}
              selectedId={ws.selectedId}
              breadcrumb={ws.breadcrumb}
              search={ws.search}
              onSearchChange={ws.setSearch}
              onSelect={(loc) => { ws.setSelectedId(loc.id); ws.setSelectedIds([loc.id]); }}
              onDrillDown={drillDown}
              onNavigateBreadcrumb={navigateBreadcrumb}
              loading={locations.isLoading}
              empty={!locations.isLoading && treeLocations.length === 0}
            />
          }
          center={
            <ViewportArea
              viewMode={ws.viewMode}
              locations={floorLocations}
              layout={canvasLayout}
              selectedIds={selectedIds}
              layers={ws.layers}
              loading={floorPlan.isLoading || locations.isLoading}
              drillDown={drillDown}
              handleSelect={handleSelect}
              isPartial={isPartial}
              totalLoaded={locations.data?.items.length ?? 0}
              totalReal={locations.data?.total ?? 0}
            />
          }
          right={
            <Inspector
              selectedLocation={detail.data ?? null}
              loading={detail.isLoading}
              layers={ws.layers}
              onToggleLayer={ws.toggleLayer}
              onClose={() => { ws.setSelectedId(null); ws.setSelectedIds([]); }}
            />
          }
          bottom={
            <Timeline
              selectionCount={ws.selectedIds.length}
              zoomPercent={ws.zoomLevel}
              totalLoaded={locations.data?.items.length ?? 0}
              totalReal={locations.data?.total ?? 0}
              viewMode={ws.viewMode}
            />
          }
        />
      </div>

      {/* Command Palette overlay */}
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

function ViewportArea({ viewMode, locations, layout, selectedIds, layers, loading, drillDown, handleSelect, isPartial, totalLoaded, totalReal }: {
  viewMode: SpatialViewMode;
  locations: SpatialLocation[];
  layout: ReturnType<typeof computeLayout>;
  selectedIds: Set<string>;
  layers: LayerConfig;
  loading: boolean;
  drillDown: (loc: SpatialLocation) => void;
  handleSelect: (ids: Set<string>) => void;
  isPartial: boolean;
  totalLoaded: number;
  totalReal: number;
}) {
  if (loading) {
    return <div className="flex h-full items-center justify-center"><span className="t-mono-xs text-[var(--text-faint)]">Cargando…</span></div>;
  }
  if (locations.length === 0) {
    return <div className="flex h-full items-center justify-center"><span className="t-mono-xs text-[var(--text-faint)]">Sin ubicaciones visibles</span></div>;
  }
  if (viewMode === 'canvas') {
    return (
      <div className="relative h-full w-full">
        <SpatialCanvas layout={layout} selectedIds={selectedIds} onSelect={handleSelect} onHover={() => {}} layers={layers} />
        {isPartial && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1 [background:var(--glass-2)] shadow-[var(--rim-1)]">
            <span className="size-1.5 rounded-full bg-[var(--state-alert)]" />
            <span className="t-mono-xs text-[var(--text-faint)]">{totalLoaded} de {totalReal}</span>
          </div>
        )}
      </div>
    );
  }
  if (viewMode === 'grid') {
    return (
      <div className="h-full overflow-y-auto p-3">
        <SpatialGrid locations={locations} selectedId={[...selectedIds][0] ?? null} onSelect={(loc) => { if (loc.kind === 'location') handleSelect(new Set([loc.id])); else drillDown(loc); }} />
      </div>
    );
  }
  if (viewMode === 'rack') {
    return (
      <div className="h-full overflow-hidden">
        <RackExplorer
          locations={locations}
          selectedId={[...selectedIds][0] ?? null}
          onSelectPosition={(id) => handleSelect(new Set([id]))}
        />
      </div>
    );
  }
  return <div className="flex h-full items-center justify-center"><span className="t-mono-xs text-[var(--text-faint)]">El arbol esta en el panel izquierdo</span></div>;
}
