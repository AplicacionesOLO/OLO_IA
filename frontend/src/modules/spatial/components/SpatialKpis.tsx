/**
 * KPIs SUPERIORES — metricas del almacen a primera vista.
 */

import { Panel } from '../../../design/foundation/Panel';
import { cn } from '../../../design/utils/cn';
import type { SpatialSummary } from '../types/index';
import { STATUS_META } from './StatusLegend';

interface SpatialKpisProps {
  summary: SpatialSummary | undefined;
  loading: boolean;
  className?: string;
}

export function SpatialKpis({ summary, loading, className }: SpatialKpisProps) {
  if (loading || !summary) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Panel key={i} level="support" radius="lg" pad="sm" className="animate-pulse">
            <div className="h-14" />
          </Panel>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5', className)}>
      <KpiCard label="Total" value={summary.totalLocations} color="var(--text-primary)" />
      <KpiCard label="Ocupadas" value={summary.occupied} color={STATUS_META.occupied.color} />
      <KpiCard label="Disponibles" value={summary.available} color={STATUS_META.available.color} />
      <KpiCard label="Inferidas" value={summary.inferred} color={STATUS_META.inferred.color} />
      <KpiCard label="Ocupacion" value={`${summary.occupancyPercent}%`} color="var(--accent)" large />
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
  large,
}: {
  label: string;
  value: number | string;
  color: string;
  large?: boolean;
}) {
  return (
    <Panel level="support" radius="lg" pad="sm">
      <div className="flex flex-col gap-2 px-1 py-0.5">
        <span className="t-label">{label}</span>
        <span
          className={cn(
            'font-[family-name:var(--font-data)] font-[var(--weight-light)]',
            'leading-none [font-variant-numeric:tabular-nums]',
            large ? 'text-[length:var(--text-2xl)]' : 'text-[length:var(--text-xl)]',
          )}
          style={{ color }}
        >
          {value}
        </span>
      </div>
    </Panel>
  );
}
