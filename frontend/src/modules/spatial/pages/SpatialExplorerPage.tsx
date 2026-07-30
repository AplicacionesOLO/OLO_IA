/**
 * SPATIAL EXPLORER — Operator Workspace.
 *
 * Integra arbol + canvas + inspector + timeline + acciones rapidas en un
 * layout tipo IDE/WMS profesional.
 */

import { useCallback, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useSessionStore } from '../../../auth/sessionStore';
import { cn } from '../../../design/utils/cn';

import type { LocationStatus, SpatialLocation } from '../types/index';
import { computeLayout } from '../engine/LayoutEngine';
import {
  useLocationDetail,
  useLocations,
  useSpatialSummary,
  useWarehouses,
} from '../services/useSpatial';

import { DEFAULT_LAYERS, type LayerConfig } from '../components/LayerPanel';
import { SpatialCanvas } from '../components/SpatialCanvas';
import { SpatialGrid } from '../components/SpatialGrid';
import { SpatialKpis } from '../components/SpatialKpis';
import { SpatialToolbar, type SpatialViewMode } from '../components/SpatialToolbar';
import type { BreadcrumbSegment } from '../components/Breadcrumb';

import {
  Inspector,
  QuickActions,
  Timeline,
  TreePanel,
  WorkspaceLayout,
} from '../components/workspace/index';

export function SpatialExplorerPage() {
  const activeWarehouseId = useSessionStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useSessionStore((s) => s.setActiveWarehouse);
  const warehouses = useWarehouses();

  // Navigation state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LocationStatus | undefined>(undefined);
  const [viewMode, setViewMode] = useState<SpatialViewMode>('canvas');
  const [layers, setLayers] = useState<LayerConfig>(DEFAULT_LAYERS);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbSegment[]>([
    { id: null, label: 'Raiz' },
  ]);

  // Data
  const summary = useSpatialSummary(activeWarehouseId);
  const locations = useLocations(
    activeWarehouseId,
    search ? undefined : parentId,
    search,
    statusFilter,
  );
  const detail = useLocationDetail(selectedId);

  // Derived
  const visibleLocations = (locations.data?.items ?? []).filter((l) => layers[l.status]);
  const canvasLayout = useMemo(() => computeLayout(visibleLocations), [visibleLocations]);
  const isPartial = (locations.data?.total ?? 0) > (locations.data?.items.length ?? 0);

  // Navigation handlers
  const drillDown = useCallback((loc: SpatialLocation) => {
    if (loc.kind === 'location') {
      setSelectedId(loc.id);
      setSelectedIds(new Set([loc.id]));
    } else {
      setParentId(loc.id);
      setBreadcrumb((prev) => [...prev, { id: loc.id, label: loc.code }]);
      setSelectedId(null);
      setSelectedIds(new Set());
    }
  }, []);

  const navigateBreadcrumb = useCallback((idx: number) => {
    const crumb = breadcrumb[idx];
    if (!crumb) return;
    setParentId(crumb.id);
    setBreadcrumb(breadcrumb.slice(0, idx + 1));
    setSelectedId(null);
    setSelectedIds(new Set());
  }, [breadcrumb]);

  const resetNavigation = useCallback(() => {
    setParentId(null);
    setSelectedId(null);
    setSelectedIds(new Set());
    setBreadcrumb([{ id: null, label: 'Raiz' }]);
    setSearch('');
    setStatusFilter(undefined);
  }, []);

  const toggleLayer = useCallback((status: LocationStatus) => {
    setLayers((prev) => ({ ...prev, [status]: !prev[status] }));
  }, []);

  // No warehouse selected
  if (!activeWarehouseId) {
    return (
      <CanvasHost mode="grid">
        <div className="flex flex-col gap-[var(--panel-gap)]">
          <Header warehouses={warehouses.data ?? []} activeId={activeWarehouseId} onChange={(id) => { setActiveWarehouse(id); resetNavigation(); }} loading={warehouses.isLoading} />
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <div className="mx-auto flex flex-col items-center gap-5 py-12">
              <Layers strokeWidth={1.25} className="size-10 text-[var(--icon-accent)]" />
              <p className="text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">
                Selecciona un almacen
              </p>
              <p className="t-body max-w-[42ch] text-[var(--text-secondary)]">
                Elige un almacen para explorar su estructura espacial.
              </p>
            </div>
          </Panel>
        </div>
      </CanvasHost>
    );
  }

  // Main workspace
  return (
    <CanvasHost mode="immersive">
      <div className="flex h-full flex-col gap-3 px-[var(--canvas-pad-x)] pb-4 pt-2">
        {/* Warehouse selector line */}
        <Header
          warehouses={warehouses.data ?? []}
          activeId={activeWarehouseId}
          onChange={(id) => { setActiveWarehouse(id); resetNavigation(); }}
          loading={warehouses.isLoading}
        />

        {/* Workspace */}
        <WorkspaceLayout
          className="min-h-0 flex-1"
          header={<SpatialKpis summary={summary.data} loading={summary.isLoading} />}
          toolbar={
            <div className="flex items-center gap-3">
              <SpatialToolbar
                search={search}
                onSearchChange={setSearch}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                count={visibleLocations.length}
                className="flex-1"
              />
              <QuickActions
                onZoomIn={() => {}}
                onZoomOut={() => {}}
                onFitAll={() => {}}
                onFocusSelection={() => {}}
                onResetView={resetNavigation}
                hasSelection={selectedIds.size > 0}
              />
            </div>
          }
          left={
            <TreePanel
              locations={visibleLocations}
              selectedId={selectedId}
              breadcrumb={breadcrumb}
              search={search}
              onSearchChange={setSearch}
              onSelect={(loc) => { setSelectedId(loc.id); setSelectedIds(new Set([loc.id])); }}
              onDrillDown={drillDown}
              onNavigateBreadcrumb={navigateBreadcrumb}
              loading={locations.isLoading}
              empty={!locations.isLoading && visibleLocations.length === 0}
            />
          }
          center={
            <ViewportArea
              viewMode={viewMode}
              locations={visibleLocations}
              layout={canvasLayout}
              selectedId={selectedId}
              selectedIds={selectedIds}
              setSelectedId={setSelectedId}
              setSelectedIds={setSelectedIds}
              layers={layers}
              loading={locations.isLoading}
              drillDown={drillDown}
              isPartial={isPartial}
              totalLoaded={locations.data?.items.length ?? 0}
              totalReal={locations.data?.total ?? 0}
            />
          }
          right={
            <Inspector
              selectedLocation={detail.data ?? null}
              loading={detail.isLoading}
              layers={layers}
              onToggleLayer={toggleLayer}
              onClose={() => { setSelectedId(null); setSelectedIds(new Set()); }}
            />
          }
          bottom={
            <Timeline
              selectionCount={selectedIds.size}
              zoomPercent={100}
              totalLoaded={locations.data?.items.length ?? 0}
              totalReal={locations.data?.total ?? 0}
              viewMode={viewMode}
            />
          }
        />
      </div>
    </CanvasHost>
  );
}

// ── Internal components ─────────────────────────────────────────────────────

function Header({
  warehouses,
  activeId,
  onChange,
  loading,
}: {
  warehouses: { id: string; name: string; code: string }[];
  activeId: string | null;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[length:var(--text-lg)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
          Spatial Explorer
        </h1>
      </div>
      <select
        value={activeId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        aria-label="Seleccionar almacen"
        className={cn(
          'h-9 min-w-[180px] rounded-[var(--radius-sm)] px-3',
          '[background:var(--glass-2)] text-[length:var(--text-xs)] text-[var(--text-primary)]',
          'shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]',
        )}
      >
        {warehouses.length === 0 && <option value="">Sin almacenes</option>}
        {warehouses.map((wh) => (
          <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
        ))}
      </select>
    </div>
  );
}

function ViewportArea({
  viewMode,
  locations,
  layout,
  selectedId,
  selectedIds,
  setSelectedId,
  setSelectedIds,
  layers,
  loading,
  drillDown,
  isPartial,
  totalLoaded,
  totalReal,
}: {
  viewMode: SpatialViewMode;
  locations: SpatialLocation[];
  layout: ReturnType<typeof computeLayout>;
  selectedId: string | null;
  selectedIds: Set<string>;
  setSelectedId: (id: string | null) => void;
  setSelectedIds: (ids: Set<string>) => void;
  layers: LayerConfig;
  loading: boolean;
  drillDown: (loc: SpatialLocation) => void;
  isPartial: boolean;
  totalLoaded: number;
  totalReal: number;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="t-mono-xs text-[var(--text-faint)]">Cargando…</span>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="t-mono-xs text-[var(--text-faint)]">Sin ubicaciones visibles</span>
      </div>
    );
  }

  if (viewMode === 'canvas') {
    return (
      <div className="relative h-full w-full">
        <SpatialCanvas
          layout={layout}
          selectedIds={selectedIds}
          onSelect={(ids) => {
            setSelectedIds(ids);
            const arr = [...ids];
            setSelectedId(arr.length === 1 ? arr[0]! : null);
          }}
          onHover={() => {}}
          layers={layers}
        />
        {isPartial && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1 [background:var(--glass-2)] shadow-[var(--rim-1)]">
            <span className="size-1.5 rounded-full bg-[var(--state-alert)]" />
            <span className="t-mono-xs text-[var(--text-faint)]">
              {totalLoaded} de {totalReal}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="h-full overflow-y-auto p-3">
        <SpatialGrid
          locations={locations}
          selectedId={selectedId}
          onSelect={(loc) => {
            if (loc.kind === 'location') {
              setSelectedId(loc.id);
              setSelectedIds(new Set([loc.id]));
            } else {
              drillDown(loc);
            }
          }}
        />
      </div>
    );
  }

  // List (fallback — the tree is already in the left panel)
  return (
    <div className="flex h-full items-center justify-center">
      <span className="t-mono-xs text-[var(--text-faint)]">
        El arbol esta en el panel izquierdo
      </span>
    </div>
  );
}
