/**
 * PANEL DE DETALLE — informacion completa de una ubicacion.
 *
 * Se abre al seleccionar una posicion en el arbol o en el grid. Muestra todo lo
 * que se sabe del punto: estado, ocupacion, dimensiones, ultima verificacion, y
 * un aviso explicito cuando el estado es inferido (no confirmado fisicamente).
 */

import { Clock, Maximize2, Package, X } from 'lucide-react';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import type { SpatialLocation } from '../types/index';
import { STATUS_META, STATUS_TONE } from './StatusLegend';

interface LocationDetailProps {
  location: SpatialLocation | null;
  loading: boolean;
  onClose: () => void;
}

export function LocationDetail({ location, loading, onClose }: LocationDetailProps) {
  if (loading) {
    return (
      <Panel level="work" radius="xl" pad="md" className="col-span-12 xl:col-span-4">
        <div className="flex flex-col gap-4 py-8">
          <div className="h-4 w-1/2 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
          <div className="h-3 w-3/4 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
          <div className="h-3 w-2/3 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
        </div>
      </Panel>
    );
  }

  if (!location) return null;

  const meta = STATUS_META[location.status];
  const pct = location.capacity > 0 ? Math.round((location.occupied / location.capacity) * 100) : 0;

  return (
    <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-5 xl:col-span-4">
      {/* Cabecera */}
      <PanelHeader
        title={location.code}
        subtitle={location.name ?? location.kind}
        trailing={
          <Button variant="ghost" size="xs" iconOnly onClick={onClose} aria-label="Cerrar detalle">
            <X strokeWidth={1.5} className="size-4" />
          </Button>
        }
      />

      {/* Estado con halo */}
      <div className="flex items-center gap-3">
        <span
          className="size-3.5 rounded-full"
          style={{ background: meta.color, boxShadow: `0 0 14px 3px color-mix(in oklab, ${meta.color} 50%, transparent)` }}
        />
        <Badge tone={STATUS_TONE[location.status]} size="sm" glow>
          {meta.label}
        </Badge>
        {location.status === 'inferred' && (
          <span className="t-mono-xs text-[var(--iris-300)]">No confirmado</span>
        )}
      </div>

      {/* Barra de ocupacion */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[var(--text-muted)]">
            <Package strokeWidth={1.5} className="size-4" />
            <span className="t-label">Ocupacion</span>
          </span>
          <span className="font-[family-name:var(--font-data)] text-[length:var(--text-lg)] font-[var(--weight-light)] [font-variant-numeric:tabular-nums] text-[var(--text-primary)]">
            {pct}<span className="ml-0.5 text-[length:var(--text-sm)] text-[var(--text-faint)]">%</span>
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-[var(--radius-full)] bg-[var(--glass-1)]">
          <div
            className="h-full rounded-[var(--radius-full)] transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background: meta.color,
              boxShadow: `0 0 12px 2px color-mix(in oklab, ${meta.color} 45%, transparent)`,
            }}
          />
        </div>
        <div className="flex justify-between">
          <span className="t-mono-xs text-[var(--text-faint)]">{location.occupied} unidades</span>
          <span className="t-mono-xs text-[var(--text-faint)]">cap. {location.capacity}</span>
        </div>
      </div>

      {/* Propiedades */}
      <dl className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-4">
        <Row label="Tipo" value={location.kind} />
        <Row label="Codigo completo" value={location.code} />
        {location.dimensions && (
          <Row
            label="Dimensiones"
            value={`${location.dimensions.width} × ${location.dimensions.depth} × ${location.dimensions.height} m`}
            icon={<Maximize2 strokeWidth={1.5} className="size-3.5" />}
          />
        )}
        <Row
          label="Ultima verificacion"
          value={location.lastVerifiedAt ? timeAgo(location.lastVerifiedAt) : 'Sin verificar'}
          icon={<Clock strokeWidth={1.5} className="size-3.5" />}
          muted={!location.lastVerifiedAt}
        />
      </dl>

      {/* Aviso de inferencia */}
      {location.status === 'inferred' && (
        <div className="rounded-[var(--radius-md)] p-4 [background:color-mix(in_oklab,var(--iris-400)_8%,transparent)]">
          <p className="text-[length:var(--text-sm)] leading-relaxed text-[var(--iris-300)]">
            El estado de esta ubicacion fue inferido por el motor de IA y no ha sido
            confirmado con una verificacion fisica. Los datos pueden no reflejar el
            estado real.
          </p>
        </div>
      )}
    </Panel>
  );
}

function Row({
  label,
  value,
  icon,
  muted,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-2 text-[var(--text-muted)]">
        {icon && <span className="text-[var(--text-faint)]">{icon}</span>}
        <span className="t-label">{label}</span>
      </dt>
      <dd className={cn('text-[length:var(--text-sm)]', muted ? 'text-[var(--text-faint)]' : 'text-[var(--text-primary)]')}>
        {value}
      </dd>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}
