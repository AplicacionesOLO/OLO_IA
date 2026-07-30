/**
 * SPATIAL EXPLORER — vista principal del modulo espacial.
 *
 * Selector de almacen → metricas → busqueda → arbol jerarquico → panel de detalle.
 */

import { useCallback, useState } from 'react';
import { ChevronRight, Layers, MapPin, Search } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useSessionStore } from '../../../auth/sessionStore';
import { cn } from '../../../design/utils/cn';

import type { LocationStatus, SpatialLocation } from '../types/index';
import {
  useLocationDetail,
  useLocations,
  useSpatialSummary,
  useWarehouses,
} from '../services/useSpatial';

const STATUS_LABELS: Record<LocationStatus, string> = {
  occupied: 'Ocupada',
  available: 'Disponible',
  inferred: 'Inferida',
  invalid: 'Invalida',
  reserved: 'Reservada',
  blocked: 'Bloqueada',
};

const STATUS_COLOR: Record<LocationStatus, string> = {
  occupied: 'var(--aqua-400)',
  available: 'var(--mint-400)',
  inferred: 'var(--iris-400)',
  invalid: 'var(--crimson-400)',
  reserved: 'var(--ember-400)',
  blocked: 'var(--text-faint)',
};

const STATUS_TONE: Record<LocationStatus, 'measured' | 'confirmed' | 'inferred' | 'critical' | 'alert' | 'neutral'> = {
  occupied: 'measured',
  available: 'confirmed',
  inferred: 'inferred',
  invalid: 'critical',
  reserved: 'alert',
  blocked: 'neutral',
};

export function SpatialExplorerPage() {
  const activeWarehouseId = useSessionStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useSessionStore((s) => s.setActiveWarehouse);
  const warehouses = useWarehouses();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LocationStatus | undefined>(undefined);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; label: string }[]>([
    { id: null, label: 'Raiz' },
  ]);

  const summary = useSpatialSummary(activeWarehouseId);
  const locations = useLocations(activeWarehouseId, search ? undefined : parentId, search, statusFilter);
  const detail = useLocationDetail(selectedId);

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

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* ── Cabecera ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-label">Explorador espacial</span>
            <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              Ubicaciones
            </h1>
          </div>

          {/* Selector de almacen */}
          <WarehouseSelector
            warehouses={warehouses.data ?? []}
            activeId={activeWarehouseId}
            onChange={(id) => {
              setActiveWarehouse(id);
              setParentId(null);
              setSelectedId(null);
              setBreadcrumb([{ id: null, label: 'Raiz' }]);
            }}
            loading={warehouses.isLoading}
          />
        </div>

        {/* ── Metricas ───────────────────────────────────────────── */}
        {activeWarehouseId && <SummaryRow summary={summary.data} loading={summary.isLoading} />}

        {/* ── Error state ────────────────────────────────────────── */}
        {locations.error && (
          <Panel level="work" radius="lg" pad="md">
            <p className="t-small text-[var(--state-alert)]">
              {locations.error instanceof Error ? locations.error.message : 'Error al cargar ubicaciones'}
            </p>
          </Panel>
        )}

        {/* ── Empty state (sin almacen seleccionado) ─────────────── */}
        {!activeWarehouseId && (
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <div className="mx-auto flex flex-col items-center gap-4">
              <Layers strokeWidth={1.25} className="size-8 text-[var(--icon-accent)]" />
              <p className="t-body max-w-[42ch] text-[var(--text-secondary)]">
                Selecciona un almacen para explorar su estructura espacial.
              </p>
            </div>
          </Panel>
        )}

        {activeWarehouseId && (
          <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
            {/* ── Lista / arbol ─────────────────────────────────── */}
            <Panel
              level="work"
              radius="xl"
              pad="md"
              className={cn(
                'col-span-12 flex flex-col gap-4',
                selectedId ? 'xl:col-span-7' : 'xl:col-span-12',
              )}
            >
              {/* Busqueda + filtros */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] px-4 [background:var(--glass-2)] shadow-[var(--rim-1)]">
                  <Search strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por codigo o nombre"
                    className="w-full bg-transparent text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip active={!statusFilter} onClick={() => setStatusFilter(undefined)}>
                    Todas
                  </FilterChip>
                  {(['occupied', 'available', 'inferred', 'invalid'] as LocationStatus[]).map((s) => (
                    <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                      {STATUS_LABELS[s]}
                    </FilterChip>
                  ))}
                </div>
              </div>

              {/* Breadcrumb */}
              {!search && breadcrumb.length > 1 && (
                <nav className="flex flex-wrap items-center gap-1 px-1">
                  {breadcrumb.map((crumb, i) => (
                    <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight strokeWidth={1.5} className="size-3.5 text-[var(--text-faint)]" />}
                      <button
                        type="button"
                        onClick={() => navigateBreadcrumb(i)}
                        className={cn(
                          't-mono-xs transition-colors',
                          i === breadcrumb.length - 1
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-faint)] hover:text-[var(--accent)]',
                        )}
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </nav>
              )}

              {/* Loading */}
              {locations.isLoading && (
                <p className="t-small py-8 text-center text-[var(--text-faint)]">Cargando ubicaciones…</p>
              )}

              {/* Empty */}
              {locations.data && locations.data.length === 0 && !locations.isLoading && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <MapPin strokeWidth={1.25} className="size-6 text-[var(--text-faint)]" />
                  <p className="t-small text-[var(--text-faint)]">
                    {search ? `Sin resultados para "${search}"` : 'Sin ubicaciones en este nivel'}
                  </p>
                </div>
              )}

              {/* Location list */}
              {locations.data && locations.data.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {locations.data.map((loc) => (
                    <LocationRow
                      key={loc.id}
                      location={loc}
                      selected={selectedId === loc.id}
                      onSelect={() => setSelectedId(loc.id)}
                      onDrillDown={() => drillDown(loc)}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            {/* ── Panel de detalle ─────────────────────────────── */}
            {selectedId && (
              <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-4 xl:col-span-5">
                <LocationDetailPanel
                  location={detail.data ?? null}
                  loading={detail.isLoading}
                  onClose={() => setSelectedId(null)}
                />
              </Panel>
            )}
          </div>
        )}
      </div>
    </CanvasHost>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

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
      className="h-11 rounded-[var(--radius-md)] px-4 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
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

function SummaryRow({
  summary,
  loading,
}: {
  summary: { totalLocations: number; occupied: number; available: number; inferred: number; invalid: number; occupancyPercent: number } | undefined;
  loading: boolean;
}) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Panel key={i} level="support" radius="lg" pad="sm" className="animate-pulse">
            <div className="h-12" />
          </Panel>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
      <MetricCard label="Total" value={summary.totalLocations} color="var(--text-primary)" />
      <MetricCard label="Ocupadas" value={summary.occupied} color={STATUS_COLOR.occupied} />
      <MetricCard label="Disponibles" value={summary.available} color={STATUS_COLOR.available} />
      <MetricCard label="Inferidas" value={summary.inferred} color={STATUS_COLOR.inferred} />
      <MetricCard label="Ocupacion" value={`${summary.occupancyPercent}%`} color="var(--accent)" />
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Panel level="support" radius="lg" pad="sm">
      <div className="flex flex-col gap-1.5 px-1">
        <span className="t-label">{label}</span>
        <span
          className="font-[family-name:var(--font-data)] text-[length:var(--text-xl)] font-[var(--weight-light)] leading-none [font-variant-numeric:tabular-nums]"
          style={{ color }}
        >
          {value}
        </span>
      </div>
    </Panel>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button variant={active ? 'secondary' : 'ghost'} size="xs" onClick={onClick}>
      {children}
    </Button>
  );
}

function LocationRow({
  location,
  selected,
  onSelect,
  onDrillDown,
}: {
  location: SpatialLocation;
  selected: boolean;
  onSelect: () => void;
  onDrillDown: () => void;
}) {
  const isContainer = location.kind !== 'position';
  const pct = location.capacity > 0 ? Math.round((location.occupied / location.capacity) * 100) : 0;

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 transition-colors duration-150 cursor-pointer',
        selected ? '[background:var(--glass-3)] shadow-[var(--rim-2)]' : '[background:var(--glass-1)] hover:[background:var(--glass-2)]',
      )}
      onClick={isContainer ? onDrillDown : onSelect}
      onKeyDown={(e) => e.key === 'Enter' && (isContainer ? onDrillDown() : onSelect())}
      tabIndex={0}
      role="button"
      aria-label={`${location.code} · ${STATUS_LABELS[location.status]}`}
    >
      {/* Status dot */}
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: STATUS_COLOR[location.status] }}
      />

      {/* Code + kind */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {location.code}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {location.kind} · {pct}% ocupacion
        </span>
      </div>

      {/* Status badge */}
      <Badge tone={STATUS_TONE[location.status]} size="xs">
        {STATUS_LABELS[location.status]}
      </Badge>

      {/* Drill-down arrow for containers */}
      {isContainer && (
        <ChevronRight strokeWidth={1.5} className="size-4 shrink-0 text-[var(--text-faint)]" />
      )}
    </li>
  );
}

function LocationDetailPanel({
  location,
  loading,
  onClose,
}: {
  location: SpatialLocation | null;
  loading: boolean;
  onClose: () => void;
}) {
  if (loading) {
    return <p className="t-small py-8 text-center text-[var(--text-faint)]">Cargando detalle…</p>;
  }

  if (!location) {
    return <p className="t-small py-8 text-center text-[var(--text-faint)]">Ubicacion no encontrada</p>;
  }

  const pct = location.capacity > 0 ? Math.round((location.occupied / location.capacity) * 100) : 0;

  return (
    <>
      <PanelHeader
        title={location.code}
        subtitle={location.name ?? `${location.kind} · ${STATUS_LABELS[location.status]}`}
        trailing={
          <Button variant="ghost" size="xs" onClick={onClose}>
            Cerrar
          </Button>
        }
      />

      {/* Status visual */}
      <div className="flex items-center gap-3">
        <span
          className="size-3 rounded-full"
          style={{ background: STATUS_COLOR[location.status], boxShadow: `0 0 12px 2px ${STATUS_COLOR[location.status]}` }}
        />
        <Badge tone={STATUS_TONE[location.status]} size="sm" glow>
          {STATUS_LABELS[location.status]}
        </Badge>
      </div>

      {/* Capacity bar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="t-label">Ocupacion</span>
          <span className="t-num text-[length:var(--text-sm)]">
            {location.occupied} / {location.capacity}
            <span className="ml-2 text-[var(--text-faint)]">({pct}%)</span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-[var(--radius-full)] bg-[var(--glass-1)]">
          <div
            className="h-full rounded-[var(--radius-full)] transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background: STATUS_COLOR[location.status],
              boxShadow: `0 0 10px 1px ${STATUS_COLOR[location.status]}`,
            }}
          />
        </div>
      </div>

      {/* Details */}
      <dl className="flex flex-col gap-2.5 pt-2">
        <DetailRow label="Tipo" value={location.kind} />
        <DetailRow label="Codigo" value={location.code} />
        {location.dimensions && (
          <DetailRow
            label="Dimensiones"
            value={`${location.dimensions.width}m × ${location.dimensions.depth}m × ${location.dimensions.height}m`}
          />
        )}
        <DetailRow
          label="Verificado"
          value={location.lastVerifiedAt ? new Date(location.lastVerifiedAt).toLocaleString('es') : 'Nunca'}
        />
        {location.status === 'inferred' && (
          <div className="rounded-[var(--radius-sm)] p-3 [background:color-mix(in_oklab,var(--iris-400)_10%,transparent)]">
            <p className="t-small text-[var(--iris-300)]">
              Estado inferido por IA. No confirmado fisicamente.
            </p>
          </div>
        )}
      </dl>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-label">{label}</dt>
      <dd className="text-[length:var(--text-sm)] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
