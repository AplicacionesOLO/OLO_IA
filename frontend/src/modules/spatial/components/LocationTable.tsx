/**
 * TABLA DE UBICACIONES — paginada, nunca las 29.310 de golpe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA TABLA NO HACE
 *
 * · No descarga el catalogo. El maximo por peticion es 200 filas, y el limite lo
 *   impone el backend, no la buena voluntad del cliente.
 *
 * · No parsea `code`. Columna, nivel y posicion son campos propios (ADR-013). Si
 *   esta tabla hiciera `code.split('-')`, las 2 ubicaciones de codigo opaco
 *   mostrarian basura en tres columnas.
 *
 * · No muestra `0` cuando no hay dato. El total es `null` hasta que se pide, y la
 *   capacidad tiene tres estados. Un cero en cualquiera de los dos sitios
 *   afirmaria algo falso.
 *
 * · No mezcla los dos ejes de estado. `status` es del espacio y `situation` del
 *   WMS, y se contradicen en 2.365 filas: van en columnas separadas, con formato
 *   distinto.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';

import { Badge } from '../../../design/primitives/Badge';
import { cn } from '../../../design/utils/cn';
import type { Paginated, SpatialLocation } from '../types/index';
import { capacidadResumen } from './LocationDetail';
import { STATUS_META, STATUS_TONE, situationDescription, situationLabel } from './StatusLegend';

interface LocationTableProps {
  page: Paginated<SpatialLocation> | undefined;
  loading: boolean;
  selectedId: string | null;
  onSelect: (location: SpatialLocation) => void;
  /** Navegacion por numero de pagina. `null` desactiva el control. */
  currentPage: number;
  onPageChange: (page: number) => void;
  className?: string;
}

const COLUMNAS = [
  { key: 'code', label: 'Codigo', width: 'minmax(170px, 1.4fr)' },
  { key: 'external', label: 'Codigo WMS', width: 'minmax(150px, 1.2fr)' },
  { key: 'rack', label: 'Rack', width: 'minmax(80px, 0.7fr)' },
  { key: 'bay', label: 'Cuerpo', width: 'minmax(70px, 0.6fr)' },
  { key: 'col', label: 'Col', width: '52px' },
  { key: 'level', label: 'Niv', width: '52px' },
  { key: 'pos', label: 'Pos', width: '52px' },
  { key: 'status', label: 'Estado', width: 'minmax(96px, 0.8fr)' },
  { key: 'situation', label: 'WMS', width: 'minmax(80px, 0.7fr)' },
  { key: 'form', label: 'Forma', width: 'minmax(84px, 0.7fr)' },
  { key: 'origin', label: 'Origen', width: 'minmax(84px, 0.7fr)' },
  { key: 'capacity', label: 'Capacidad', width: 'minmax(110px, 0.9fr)' },
] as const;

const GRID_COLS = COLUMNAS.map((c) => c.width).join(' ');

export function LocationTable({
  page,
  loading,
  selectedId,
  onSelect,
  currentPage,
  onPageChange,
  className,
}: LocationTableProps) {
  const items = page?.items ?? [];

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div
        className="grid shrink-0 items-center gap-2 border-b border-[var(--hairline-strong)] px-3 py-2"
        style={{ gridTemplateColumns: GRID_COLS }}
        role="row"
      >
        {COLUMNAS.map((c) => (
          <span key={c.key} className="t-label truncate" role="columnheader">
            {c.label}
          </span>
        ))}
      </div>

      {/* ── Filas ────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto" role="rowgroup">
        {loading &&
          Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-2 px-3 py-2"
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              {COLUMNAS.map((c) => (
                <div
                  key={c.key}
                  className="h-3 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]"
                />
              ))}
            </div>
          ))}

        {!loading &&
          items.map((loc) => (
            <Row
              key={loc.id}
              loc={loc}
              selected={loc.id === selectedId}
              onSelect={() => onSelect(loc)}
            />
          ))}
      </div>

      {/* ── Pie: recuento y paginacion ───────────────────────────────────── */}
      <Footer
        page={page}
        loading={loading}
        shown={items.length}
        currentPage={currentPage}
        onPageChange={onPageChange}
      />
    </div>
  );
}

// ── Una fila ────────────────────────────────────────────────────────────────

function Row({
  loc,
  selected,
  onSelect,
}: {
  loc: SpatialLocation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role="row"
      aria-selected={selected}
      className={cn(
        'grid w-full items-center gap-2 px-3 py-2 text-left transition-colors',
        selected ? '[background:var(--glass-2)]' : 'hover:[background:var(--glass-1)]',
      )}
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <Cell mono title={loc.code}>
        {loc.code}
      </Cell>

      {/*
        El codigo del WMS solo se repite si DIFIERE del normalizado. Mostrar dos
        veces `ASCEN1-C001-N01-1` gasta una columna sin decir nada; cuando difiere
        —`DAÑADO` frente a `DANADO`— es justo lo que hay que ver.
      */}
      <Cell mono faint title={loc.externalCode ?? undefined}>
        {loc.externalCode && loc.externalCode !== loc.code ? loc.externalCode : '—'}
      </Cell>

      <Cell mono>{loc.rackCode ?? '—'}</Cell>
      <Cell mono>{loc.bayCode ?? '—'}</Cell>
      <Cell mono num>{loc.logicalColumn ?? '—'}</Cell>
      <Cell mono num>{loc.logicalLevel ?? '—'}</Cell>
      <Cell mono num>{loc.logicalPosition ?? '—'}</Cell>

      {/* Eje 1: estado del espacio. Badge con color pleno. */}
      <span className="min-w-0">
        <Badge tone={STATUS_TONE[loc.status]}>{STATUS_META[loc.status].label}</Badge>
      </span>

      {/* Eje 2: situacion del WMS. Solo texto, sin color: no es lo mismo. */}
      <Cell mono faint title={situationDescription(loc.situation)}>
        {situationLabel(loc.situation)}
      </Cell>

      <Cell faint>{loc.codeForm === 'structured' ? 'estructurada' : 'opaca'}</Cell>
      <Cell faint>{etiquetaOrigen(loc.origin)}</Cell>
      <Cell mono faint>
        {capacidadResumen(loc.capacity)}
      </Cell>
    </button>
  );
}

function Cell({
  children,
  mono,
  faint,
  num,
  title,
}: {
  children: React.ReactNode;
  mono?: boolean;
  faint?: boolean;
  num?: boolean;
  title?: string | undefined;
}) {
  return (
    <span
      className={cn(
        'truncate',
        mono ? 't-mono-xs' : 'text-[length:var(--text-xs)]',
        faint ? 'text-[var(--text-faint)]' : 'text-[var(--text-secondary)]',
        num && '[font-variant-numeric:tabular-nums]',
      )}
      title={title}
      role="cell"
    >
      {children}
    </span>
  );
}

function etiquetaOrigen(origin: SpatialLocation['origin']): string {
  switch (origin) {
    case 'catalog':
      return 'catalogo';
    case 'inferred':
      return 'inferida';
    case 'manual':
      return 'manual';
  }
}

// ── Pie ─────────────────────────────────────────────────────────────────────

function Footer({
  page,
  loading,
  shown,
  currentPage,
  onPageChange,
}: {
  page: Paginated<SpatialLocation> | undefined;
  loading: boolean;
  shown: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const total = page?.total ?? null;
  const totalPages = page?.totalPages ?? null;
  const hayMas = Boolean(page?.nextCursor) || (totalPages != null && currentPage < totalPages);

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--hairline-strong)] px-3 py-2">
      <span className="t-mono-xs text-[var(--text-faint)]">
        {loading ? (
          'cargando…'
        ) : total != null ? (
          /* Con total: se puede decir el rango exacto. */
          <>
            {shown === 0
              ? '0 de ' + total.toLocaleString('es')
              : `${(((currentPage - 1) * (page?.pageSize ?? 0)) + 1).toLocaleString('es')}–${
                  (((currentPage - 1) * (page?.pageSize ?? 0)) + shown).toLocaleString('es')
                } de ${total.toLocaleString('es')}`}
          </>
        ) : (
          /*
            Sin total: se dice cuantas se ven y que hay mas, NUNCA un total
            inventado. «10 de 10» sobre 29.310 filas es la mentira mas facil de
            cometer en una tabla paginada.
          */
          <>
            {shown.toLocaleString('es')} en pantalla
            {hayMas ? ' · hay mas' : ''}
          </>
        )}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || loading}
          aria-label="Pagina anterior"
          className="flex size-7 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] disabled:opacity-30 enabled:hover:[background:var(--glass-2)]"
        >
          <ChevronLeft strokeWidth={1.5} className="size-4" />
        </button>
        <span className="t-mono-xs min-w-[5ch] text-center text-[var(--text-muted)]">
          {totalPages != null ? `${currentPage}/${totalPages}` : currentPage}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hayMas || loading}
          aria-label="Pagina siguiente"
          className="flex size-7 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] disabled:opacity-30 enabled:hover:[background:var(--glass-2)]"
        >
          <ChevronRight strokeWidth={1.5} className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Enlace «ver detalle» para reutilizar desde otras vistas. */
export function VerDetalle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--text-accent)]"
    >
      Ver detalle
      <ArrowRight strokeWidth={1.5} className="size-3" />
    </button>
  );
}
