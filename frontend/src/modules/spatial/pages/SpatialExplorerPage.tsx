/**
 * SPATIAL EXPLORER — pagina principal del modulo espacial.
 *
 * Compone los componentes reutilizables en un layout WMS profesional:
 *   Toolbar → KPIs → [Grid | Tree] + Detail panel lateral
 *
 * Sin logica de negocio: solo orquesta estado local y hooks de datos.
 */

import { useCallback, useMemo, useState } from 'react';
import { Layers, MapPin } from 'lucide-react';

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
import {
  DEFAULT_LAYERS,
  LayerPanel,
  LocationDetail,
  LocationTree,
  SpatialBreadcrumb,
  SpatialCanvas,
  SpatialGrid,
  SpatialKpis,
  SpatialToolbar,
  StatusLegend,
  type BreadcrumbSegment,
  type LayerConfig,
  type SpatialViewMode,
} from '../components/index';

export function SpatialExplorerPage() {
  const activeWarehouseId = useSessionStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useSessionStore((s) => s.setActiveWarehouse);
  const warehouses = useWarehouses();

  // Estado de navegacion
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

  // Datos
  const summary = useSpatialSummary(activeWarehouseId);
  const locations = useLocations(
    activeWarehouseId,
    search ? undefined : parentId,
    search,
    statusFilter,
  );
  const detail = useLocationDetail(selectedId);

  // Filtrar por capas visibles
  const visibleLocations = (locations.data?.items ?? []).filter((l) => layers[l.status]);

  // Layout para la vista canvas: trabaja con los items CARGADOS en la pagina
  // actual. Es una vista parcial si items.length < total.
  const canvasLayout = useMemo(
    () => computeLayout(visibleLocations),
    [visibleLocations],
  );
  const isPartialView = (locations.data?.total ?? 0) > (locations.data?.items.length ?? 0);

  // Navegacion jerarquica
  const drillDown = useCallback((loc: SpatialLocation) => {
    if (loc.kind === 'position') {
      setSelectedId(loc.id);
    } else {
      setParentId(loc.id);
      setBreadcrumb((prev) => [...prev, { id: loc.id, label: loc.code }]);
      setSelectedId(null);
    }
  }, []);

  const navigateBreadcrumb = useCallback((idx: number) => {
    const crumb = breadcrumb[idx];
    if (!crumb) return;
    setParentId(crumb.id);
    setBreadcrumb(breadcrumb.slice(0, idx + 1));
    setSelectedId(null);
  }, [breadcrumb]);

  const resetNavigation = useCallback(() => {
    setParentId(null);
    setSelectedId(null);
    setBreadcrumb([{ id: null, label: 'Raiz' }]);
    setSearch('');
    setStatusFilter(undefined);
  }, []);

  const handleWarehouseChange = useCallback((id: string) => {
    setActiveWarehouse(id);
    resetNavigation();
  }, [setActiveWarehouse, resetNavigation]);

  const toggleLayer = useCallback((status: LocationStatus) => {
    setLayers((prev) => ({ ...prev, [status]: !prev[status] }));
  }, []);

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* ── Cabecera ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-label">Explorador espacial</span>
            <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              Ubicaciones
            </h1>
          </div>
          <WarehouseSelector
            warehouses={warehouses.data ?? []}
            activeId={activeWarehouseId}
            onChange={handleWarehouseChange}
            loading={warehouses.isLoading}
          />
        </div>

        {/* ── Sin almacen ──────────────────────────────────────────── */}
        {!activeWarehouseId && (
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <div className="mx-auto flex flex-col items-center gap-5 py-8">
              <Layers strokeWidth={1.25} className="size-10 text-[var(--icon-accent)]" />
              <div className="flex flex-col gap-2">
                <p className="text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">
                  Selecciona un almacen
                </p>
                <p className="t-body max-w-[42ch] text-[var(--text-secondary)]">
                  Elige un almacen para explorar su estructura espacial,
                  ver el estado de sus ubicaciones y navegar la jerarquia.
                </p>
              </div>
            </div>
          </Panel>
        )}

        {activeWarehouseId && (
          <>
            {/* ── KPIs ──────────────────────────────────────────── */}
            <SpatialKpis summary={summary.data} loading={summary.isLoading} />

            {/* ── Toolbar ───────────────────────────────────────── */}
            <SpatialToolbar
              search={search}
              onSearchChange={setSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              count={visibleLocations.length}
            />

            {/* ── Breadcrumb ────────────────────────────────────── */}
            {!search && (
              <SpatialBreadcrumb segments={breadcrumb} onNavigate={navigateBreadcrumb} />
            )}

            {/* ── Error ─────────────────────────────────────────── */}
            {locations.error && (
              <Panel level="work" radius="lg" pad="md">
                <p className="t-small text-[var(--state-alert)]">
                  {locations.error instanceof Error
                    ? locations.error.message
                    : 'Error al cargar ubicaciones'}
                </p>
              </Panel>
            )}

            {/* ── Contenido principal ───────────────────────────── */}
            <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
              {/* Area principal: mapa o lista */}
              <div
                className={cn(
                  'col-span-12 flex flex-col gap-4',
                  selectedId ? 'xl:col-span-8' : 'xl:col-span-10',
                )}
              >
                {/* Loading */}
                {locations.isLoading && (
                  <Panel level="work" radius="lg" pad="lg">
                    <p className="t-small py-8 text-center text-[var(--text-faint)]">
                      Cargando ubicaciones…
                    </p>
                  </Panel>
                )}

                {/* Empty */}
                {!locations.isLoading && visibleLocations.length === 0 && (
                  <Panel level="work" radius="lg" pad="lg">
                    <div className="flex flex-col items-center gap-4 py-8">
                      <MapPin strokeWidth={1.25} className="size-7 text-[var(--text-faint)]" />
                      <p className="t-body text-center text-[var(--text-faint)]">
                        {search
                          ? `Sin resultados para "${search}"`
                          : 'Sin ubicaciones en este nivel'}
                      </p>
                    </div>
                  </Panel>
                )}

                {/* Vista Canvas (pan + zoom) */}
                {!locations.isLoading && viewMode === 'canvas' && canvasLayout.nodes.length > 0 && (
                  <Panel level="work" radius="xl" pad="none" className="overflow-hidden">
                    <div className="relative h-[520px]">
                      <SpatialCanvas
                        layout={canvasLayout}
                        selectedIds={selectedIds}
                        onSelect={(ids) => {
                          setSelectedIds(ids);
                          const arr = [...ids];
                          setSelectedId(arr.length === 1 ? arr[0]! : null);
                        }}
                        onHover={() => {/* tooltip handled internally */}}
                        layers={layers}
                      />
                      {isPartialView && (
                        <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 [background:var(--glass-2)] shadow-[var(--rim-1)]">
                          <span className="size-1.5 shrink-0 rounded-full bg-[var(--state-alert)]" />
                          <span className="t-mono-xs text-[var(--text-faint)]">
                            Vista parcial: {locations.data?.items.length ?? 0} de {locations.data?.total ?? 0} ubicaciones
                          </span>
                        </div>
                      )}
                    </div>
                  </Panel>
                )}

                {/* Vista Grid */}
                {!locations.isLoading && visibleLocations.length > 0 && viewMode === 'grid' && (
                  <Panel level="work" radius="xl" pad="md">
                    <SpatialGrid
                      locations={visibleLocations}
                      selectedId={selectedId}
                      onSelect={(loc) => {
                        if (loc.kind === 'position') setSelectedId(loc.id);
                        else drillDown(loc);
                      }}
                    />
                  </Panel>
                )}

                {/* Vista Lista */}
                {!locations.isLoading && visibleLocations.length > 0 && viewMode === 'list' && (
                  <Panel level="work" radius="xl" pad="md">
                    <LocationTree
                      locations={visibleLocations}
                      selectedId={selectedId}
                      onSelect={(loc) => setSelectedId(loc.id)}
                      onDrillDown={drillDown}
                    />
                  </Panel>
                )}

                {/* Leyenda */}
                <StatusLegend compact className="px-2" />
              </div>

              {/* Panel lateral: detalle o capas */}
              {selectedId ? (
                <LocationDetail
                  location={detail.data ?? null}
                  loading={detail.isLoading}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <Panel level="support" radius="xl" pad="md" className="col-span-12 xl:col-span-2">
                  <LayerPanel layers={layers} onToggle={toggleLayer} />
                </Panel>
              )}
            </div>
          </>
        )}
      </div>
    </CanvasHost>
  );
}

// ── Selector de almacen ─────────────────────────────────────────────────────

function WarehouseSelector({
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
    <select
      value={activeId ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      aria-label="Seleccionar almacen"
      className={cn(
        'h-11 min-w-[200px] rounded-[var(--radius-md)] px-4',
        '[background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)]',
        'shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]',
      )}
    >
      {warehouses.length === 0 && <option value="">Sin almacenes</option>}
      {warehouses.map((wh) => (
        <option key={wh.id} value={wh.id}>
          {wh.name} ({wh.code})
        </option>
      ))}
    </select>
  );
}
