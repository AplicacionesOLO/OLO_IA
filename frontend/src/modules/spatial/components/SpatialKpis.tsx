/**
 * KPIs DEL ALMACEN — solo metricas que el backend puede llenar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE YA NO SE MUESTRA, Y POR QUE
 *
 * Antes habia dos tarjetas: «Ocupadas» y «Ocupacion %». Las dos venian de un
 * `occupied_count` que la migracion 0059 elimino, porque sobre datos reales:
 *
 *   available (18.075) + blocked (11.237) = 29.312 exacto — particion real
 *   occupied  (15.862) salia de OTRA columna y solapaba con las dos
 *   los tres juntos sumaban 45.174 sobre 29.312 ubicaciones
 *
 * Un porcentaje calculado con ese numerador puede pasar del 100%, y la tarjeta lo
 * habria mostrado sin protestar. La ocupacion no es una propiedad del espacio
 * (SPA-11): vive en el inventario, que aun no existe.
 *
 * En su lugar se muestra lo que si es cierto, incluido lo incomodo: las 2.365
 * ubicaciones donde el propio WMS se contradice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AlertTriangle, Ruler } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { cn } from '../../../design/utils/cn';
import type { SpatialSummary } from '../types/index';
import { STATUS_META } from './StatusLegend';

interface SpatialKpisProps {
  summary: SpatialSummary | undefined;
  loading: boolean;
  className?: string;
}

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6';

export function SpatialKpis({ summary, loading, className }: SpatialKpisProps) {
  if (loading || !summary) {
    return (
      <div className={cn(GRID, className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Panel key={i} level="support" radius="lg" pad="sm" className="animate-pulse">
            <div className="h-14" />
          </Panel>
        ))}
      </div>
    );
  }

  const sinCatalogo = summary.locationCount === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className={cn(GRID, className)}>
        <Kpi label="Ubicaciones" value={summary.locationCount} color="var(--text-primary)" />
        <Kpi
          label="Disponibles"
          value={summary.availableCount}
          color={STATUS_META.available.color}
          hint={pct(summary.availableCount, summary.locationCount)}
        />
        <Kpi
          label="Bloqueadas"
          value={summary.blockedCount}
          color={STATUS_META.blocked.color}
          hint={pct(summary.blockedCount, summary.locationCount)}
        />
        <Kpi label="Racks" value={summary.rackCount} color="var(--text-primary)" />
        <Kpi label="Cuerpos" value={summary.bayCount} color="var(--text-primary)" />
        <Kpi
          label="Sitios"
          value={summary.siteCount}
          color="var(--text-primary)"
          hint={summary.aisleCount > 0 ? `${summary.aisleCount} pasillos` : 'sin pasillos'}
        />
      </div>

      {/* Segunda fila: lo que hay que saber antes de fiarse de los numeros. */}
      {!sinCatalogo && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
          <Nota
            icon={<Ruler strokeWidth={1.5} className="size-3.5" />}
            tone={summary.withWorldGeometry === 0 ? 'faint' : 'normal'}
          >
            {summary.withWorldGeometry === 0
              ? 'Sin levantamiento metrico'
              : `${summary.withWorldGeometry.toLocaleString('es')} con geometria`}
          </Nota>

          {summary.statusSituationConflicts > 0 && (
            <Nota
              icon={<AlertTriangle strokeWidth={1.5} className="size-3.5" />}
              tone="alert"
              title={
                'El WMS de origen declara estado y situacion distintos en estas ' +
                'ubicaciones. No es un error de importacion: el archivo las trae asi.'
              }
            >
              {summary.statusSituationConflicts.toLocaleString('es')} con estado y
              situacion contradictorios
            </Nota>
          )}

          {summary.opaqueCount > 0 && (
            <Nota
              tone="faint"
              title="Codigos que no siguen el patron estructurado, asi que no tienen nivel ni posicion."
            >
              {summary.opaqueCount.toLocaleString('es')} con codigo opaco
            </Nota>
          )}

          {summary.inferredCount > 0 && (
            <Nota tone="faint" title="Ubicaciones deducidas, no declaradas por el WMS.">
              {summary.inferredCount.toLocaleString('es')} inferidas
            </Nota>
          )}

          <Nota
            tone="faint"
            title={
              'El WMS declaro «sin limite» en unas y no dijo nada en otras. ' +
              'Son estados distintos: la primera se puede usar, la segunda hay que medirla.'
            }
          >
            capacidad: {summary.capacityUnlimitedCount.toLocaleString('es')} sin limite
            declarado · {summary.capacityUnknownCount.toLocaleString('es')} sin dato
          </Nota>

          {summary.lastImportAt && (
            <Nota tone="faint">
              importado {formatFecha(summary.lastImportAt)}
              {summary.totalRowsRejected != null && summary.totalRowsRejected > 0
                ? ` · ${summary.totalRowsRejected} filas rechazadas`
                : ''}
            </Nota>
          )}
        </div>
      )}
    </div>
  );
}

// ── Internos ────────────────────────────────────────────────────────────────

/** Porcentaje sobre el total. Solo se calcula cuando el total NO es cero. */
function pct(part: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((part / total) * 1000) / 10}%`;
}

function formatFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function Kpi({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color: string;
  hint?: string | undefined;
}) {
  return (
    <Panel level="support" radius="lg" pad="sm">
      <div className="flex flex-col gap-1.5 px-1 py-0.5">
        <span className="t-label">{label}</span>
        <span
          className={cn(
            'font-[family-name:var(--font-data)] font-[var(--weight-light)]',
            'text-[length:var(--text-xl)] leading-none [font-variant-numeric:tabular-nums]',
          )}
          style={{ color }}
        >
          {value.toLocaleString('es')}
        </span>
        <span className="t-mono-xs h-3 text-[var(--text-faint)]">{hint ?? ''}</span>
      </div>
    </Panel>
  );
}

function Nota({
  icon,
  children,
  tone,
  title,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone: 'normal' | 'faint' | 'alert';
  title?: string;
}) {
  const color =
    tone === 'alert'
      ? 'var(--text-warn)'
      : tone === 'faint'
        ? 'var(--text-faint)'
        : 'var(--text-muted)';
  return (
    <span className="flex items-center gap-1.5" style={{ color }} title={title}>
      {icon}
      <span className="t-mono-xs">{children}</span>
    </span>
  );
}
