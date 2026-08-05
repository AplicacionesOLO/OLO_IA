/**
 * DOS LEYENDAS, DELIBERADAMENTE SEPARADAS
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NO SE MEZCLAN EN UNA SOLA
 *
 * Son dos ejes distintos, y sobre datos reales **se contradicen en 2.365
 * ubicaciones**:
 *
 *     situacion  estado       filas
 *     DISP       blocked      1.973   ← el WMS dice disponible, el espacio no
 *     BLOQ       available      389   ← al contrario
 *     BLOQES     available        3
 *
 * ESTADO ESPACIAL — `available` | `blocked`. Vocabulario cerrado, verificado por
 *   CHECK, y particiona el total: disponibles + bloqueadas = todas.
 *
 * SITUACION DEL WMS — `DISP`, `OCUP`, `BLOQ`, `BLOQES`, … Vocabulario abierto y
 *   con FECHA: es una foto del archivo de origen, no un estado vivo.
 *
 * Una leyenda unica con `available`, `blocked` y `OCUP` juntos invitaria a
 * sumarlos, y sumarlos da 45.174 sobre 29.312. Por eso los colores tampoco se
 * comparten: el estado usa relleno pleno y la situacion, solo un anillo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cn } from '../../../design/utils/cn';
import { INSPECTION_META, type InspectionStatus } from '../inspection';
import type { LocationStatus } from '../types/index';
import type { VisualLayer } from '../viewTypes';

// ── Eje 1 · Estado espacial ─────────────────────────────────────────────────

export const STATUS_META: Record<
  LocationStatus,
  /*
    `color` se usa como color de TEXTO —los KPI del explorador y esta leyenda— y no
    solo como punto. Por eso son tokens de texto y no primitivos: con `--mint-400` y
    `--ember-400`, «18.075 disponibles» y «11.237 bloqueadas» daban 1,56 y 1,62 de
    contraste sobre el tema claro, o sea que no se leían.
  */
  { label: string; color: string; description: string }
> = {
  available: {
    label: 'Disponible',
    color: 'var(--text-ok)',
    description: 'El espacio esta operativo. No dice si tiene algo encima.',
  },
  blocked: {
    label: 'Bloqueada',
    color: 'var(--text-warn)',
    description: 'El espacio no se puede usar.',
  },
};

export const STATUS_TONE: Record<LocationStatus, 'confirmed' | 'alert'> = {
  available: 'confirmed',
  blocked: 'alert',
};

// ── Eje 2 · Situacion del WMS ───────────────────────────────────────────────

/**
 * Situaciones MEDIDAS en el catalogo real. El vocabulario es abierto, asi que un
 * valor no listado se muestra con su codigo tal cual en lugar de descartarse:
 * `situationLabel()` no falla nunca.
 */
export const SITUATION_META: Record<string, { label: string; description: string }> = {
  DISP: { label: 'DISP', description: 'Disponible segun el WMS' },
  OCUP: { label: 'OCUP', description: 'Con existencias segun el WMS, en su fecha' },
  BLOQ: { label: 'BLOQ', description: 'Bloqueada por el WMS' },
  BLOQES: { label: 'BLOQES', description: 'Bloqueo especial' },
  BLOQFI: { label: 'BLOQFI', description: 'Bloqueo fisico' },
  RESREC: { label: 'RESREC', description: 'Reservada para recepcion' },
  RESREP: { label: 'RESREP', description: 'Reservada para reposicion' },
  PROB: { label: 'PROB', description: 'Con problema declarado' },
};

export function situationLabel(situation: string | null): string {
  if (!situation) return 'sin situacion';
  return SITUATION_META[situation]?.label ?? situation;
}

export function situationDescription(situation: string | null): string {
  if (!situation) return 'El archivo de origen no declaro situacion.';
  return SITUATION_META[situation]?.description ?? `Valor del WMS: ${situation}`;
}

// ── Componentes ─────────────────────────────────────────────────────────────

/** Leyenda del ESTADO ESPACIAL. Relleno pleno: es la verdad del espacio. */
export function StatusLegend({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const items: LocationStatus[] = ['available', 'blocked'];
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {!compact && <span className="t-label">Estado del espacio</span>}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        role="list"
        aria-label="Leyenda de estado del espacio"
      >
        {items.map((s) => {
          const meta = STATUS_META[s];
          return (
            <div
              key={s}
              className="flex items-center gap-2"
              role="listitem"
              title={meta.description}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  background: meta.color,
                  boxShadow: `0 0 6px 1px color-mix(in oklab, ${meta.color} 40%, transparent)`,
                }}
              />
              <span
                className={cn(
                  'text-[var(--text-secondary)]',
                  compact ? 't-mono-xs' : 'text-[length:var(--text-xs)]',
                )}
              >
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Leyenda de la SITUACION DEL WMS, con su fecha.
 *
 * Se dibuja con anillo y no con relleno: visualmente no puede confundirse con el
 * estado espacial, que es el punto. Y solo lista los valores PRESENTES en los
 * datos, con su recuento, porque un vocabulario abierto listado a mano acaba
 * mostrando categorias vacias.
 */
export function WmsSituationLegend({
  counts,
  asOf,
  compact = false,
  className,
}: {
  counts: Record<string, number>;
  /** Fecha del archivo importado. Sin ella, la leyenda promete actualidad. */
  asOf?: string | null | undefined;
  /**
   * Forma compacta, para la barra de control del rack: una sola fila, sin titulo ni
   * nota al pie. La forma COMPLETA —con la fecha y la advertencia de que es
   * historico— sigue existiendo y es la que se usa en el inspector.
   */
  compact?: boolean;
  className?: string;
}) {
  const entradas = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entradas.length === 0) return null;

  return (
    <div
      className={cn(
        compact ? 'flex flex-wrap items-center gap-x-4 gap-y-1' : 'flex flex-col gap-1.5',
        className,
      )}
    >
      {!compact && (
        <span className="t-label">
          Situacion segun el WMS{asOf ? ` · ${formatFechaCorta(asOf)}` : ''}
        </span>
      )}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        role="list"
        aria-label="Leyenda de situacion del WMS"
      >
        {entradas.map(([code, n]) => (
          <div
            key={code}
            className="flex items-center gap-2"
            role="listitem"
            title={situationDescription(code)}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full border border-[var(--text-faint)]"
            />
            <span className="t-mono-xs text-[var(--text-muted)]">
              {situationLabel(code)}
              <span className="ml-1 text-[var(--text-faint)]">{n.toLocaleString('es')}</span>
            </span>
          </div>
        ))}
      </div>
      <span className="t-mono-xs text-[var(--text-faint)]">
        {compact
          ? `historico${asOf ? ` · ${formatFechaCorta(asOf)}` : ''}`
          : 'Historico del archivo importado. No es ocupacion en tiempo real.'}
      </span>
    </div>
  );
}

// ── Eje 3 · Estado de inspeccion ────────────────────────────────────────────

/**
 * Selector de capa de color, con la de inspeccion DESHABILITADA.
 *
 * La opcion existe y se ve, porque su ausencia no explicaria nada; pero no se
 * puede elegir mientras no haya lecturas. Habilitarla mostraria las 29.310
 * ubicaciones como «sin leer», que es cierto, y a la vez sugeriria que el sistema
 * ya inspecciona — que no es cierto.
 */
export function VisualLayerPicker({
  value,
  onChange,
  inspectionAvailable,
  className,
}: {
  value: VisualLayer;
  onChange: (l: VisualLayer) => void;
  /** `true` solo cuando llegan resultados de inspeccion reales. */
  inspectionAvailable: boolean;
  className?: string;
}) {
  const opciones: { id: VisualLayer; label: string; disabled: boolean; title: string }[] = [
    {
      id: 'spatial',
      label: 'Estado espacial',
      disabled: false,
      title: 'Vocabulario cerrado del catalogo: disponible o bloqueada.',
    },
    {
      id: 'wms',
      label: 'Situacion WMS',
      disabled: false,
      title: 'Vocabulario abierto del archivo importado. Historico, con su fecha.',
    },
    {
      id: 'inspection',
      label: 'Inspeccion',
      disabled: !inspectionAvailable,
      title: inspectionAvailable
        ? 'Resultado de comparar el WMS con lo que la camara observo.'
        : 'Disponible al integrar las lecturas del dron',
    },
  ];

  return (
    <div className={cn('flex items-center gap-1', className)} role="group" aria-label="Capa visual">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => !o.disabled && onChange(o.id)}
          disabled={o.disabled}
          aria-pressed={value === o.id}
          title={o.title}
          className={cn(
            'h-7 rounded-[var(--radius-xs)] px-2.5 text-[length:var(--text-xs)] transition-colors',
            o.disabled
              ? 'cursor-not-allowed text-[var(--text-faint)] opacity-50'
              : value === o.id
                ? '[background:var(--glass-2)] text-[var(--text-primary)]'
                : 'text-[var(--text-faint)] hover:[background:var(--glass-1)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Leyenda de la capa de inspeccion.
 *
 * Sin resultados muestra los estados posibles en gris, con el aviso de que aun no
 * hay lecturas. Es un catalogo de lo que se vera, no una afirmacion de que ya se ve.
 */
export function InspectionLegend({
  available,
  compact = false,
  className,
}: {
  available: boolean;
  /** Forma compacta para la barra de control del rack. Ver `WmsSituationLegend`. */
  compact?: boolean;
  className?: string;
}) {
  const todos: InspectionStatus[] = [
    'not_scanned',
    'scanning',
    'verified_match',
    'verified_empty',
    'unexpected_empty',
    'unexpected_pallet',
    'pallet_without_qr',
    'location_qr_unreadable',
  ];
  // En compacto se recortan a los cuatro que resumen el eje: sin leer, leida y
  // conforme, discrepancia y lectura imposible. El catalogo completo sigue en el
  // inspector, donde hay sitio para explicar cada uno.
  const destacados = compact
    ? (['not_scanned', 'verified_match', 'unexpected_pallet', 'location_qr_unreadable'] as const)
    : todos;

  return (
    <div
      className={cn(
        compact ? 'flex flex-wrap items-center gap-x-4 gap-y-1' : 'flex flex-col gap-1.5',
        className,
      )}
    >
      {!compact && <span className="t-label">Estado de inspeccion</span>}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        role="list"
        aria-label="Leyenda de estado de inspeccion"
      >
        {destacados.map((s) => {
          const meta = INSPECTION_META[s];
          return (
            <div
              key={s}
              className="flex items-center gap-2"
              role="listitem"
              title={meta.description}
              style={{ opacity: available ? 1 : 0.45 }}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: `color-mix(in oklab, ${meta.color} 55%, transparent)` }}
              />
              <span className="t-mono-xs text-[var(--text-muted)]">{meta.label}</span>
            </div>
          );
        })}
      </div>
      <span className="t-mono-xs text-[var(--text-faint)]">
        {available
          ? compact
            ? 'WMS vs camara'
            : 'Resultado de comparar el inventario del WMS con lo observado por la camara.'
          : compact
            ? 'sin lecturas del dron'
            : 'Disponible al integrar las lecturas del dron.'}
      </span>
    </div>
  );
}

function formatFechaCorta(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
