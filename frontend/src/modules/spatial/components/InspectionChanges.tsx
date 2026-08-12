/**
 * QUÉ CAMBIÓ DESDE EL RECORRIDO ANTERIOR — la memoria del producto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ES UN INFORME MÁS
 *
 * «Hay un pallet que el WMS no declara» es un hallazgo. «Sigue ahí tres vuelos después»
 * es otra cosa: dice que nadie lo está arreglando. Y un hueco que discrepaba y ya no
 * discrepa es la única prueba barata de que el trabajo sirvió.
 *
 * Sin esto, cada recorrido es una foto suelta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE SIGUE IGUAL Y BIEN NO APARECE
 *
 * Una lista de «cambios» donde la mayoría de las filas dicen «igual que antes» es una
 * tabla que nadie lee dos veces. El backend ya la filtra; aquí solo se pinta.
 *
 * Y por eso una lista VACÍA no significa «no hay datos»: significa que nada se movió
 * entre los dos últimos recorridos. Se dice con esas palabras, porque un panel en blanco
 * se lee como una consulta que falló.
 */

import { History } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { cn } from '../../../design/utils/cn';
import { INSPECTION_META, VERDICT_META } from '../inspection';
import type { InspectionChange, InspectionVerdict } from '../inspection';

/** Orden de lectura: primero lo que exige actuar, al final lo que tranquiliza. */
const ORDEN: InspectionVerdict[] = ['persiste', 'nuevo', 'cambio', 'resuelto'];

function meta(v: string) {
  return VERDICT_META[v as InspectionVerdict];
}

/**
 * El estado, en castellano.
 *
 * El backend habla el vocabulario de `v_reconciliation` —`unexpected_pallet`— y la
 * pantalla ya tiene traducción para él en `INSPECTION_META`. Enseñar el crudo obligaría a
 * quien lo mira a aprenderse el vocabulario interno de la base para leer su almacén.
 *
 * Lo que no esté traducido se enseña TAL CUAL en vez de esconderse: un estado sin nombre
 * es un aviso de que el vocabulario se separó, y taparlo con «desconocido» lo perdería.
 */
function estado(s: string): string {
  return INSPECTION_META[s as keyof typeof INSPECTION_META]?.label ?? s;
}

function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function InspectionChanges({
  cambios,
  cargando,
  onAbrirHueco,
  className,
}: {
  cambios: InspectionChange[] | undefined;
  cargando: boolean;
  /** Llevar al hueco en el mapa. La fila sin destino sería un dato sin salida. */
  onAbrirHueco?: (locationId: string) => void;
  className?: string;
}) {
  if (cargando || !cambios) return null;

  //  Sin nada que decir, el panel no ocupa sitio. Pero si la razón es que solo hay UN
  //  recorrido, eso sí merece decirse — y no se puede distinguir desde aquí, así que no
  //  se afirma ninguna de las dos cosas.
  if (cambios.length === 0) return null;

  const porVeredicto = ORDEN.map((v) => ({
    v,
    filas: cambios.filter((c) => c.verdict === v),
  })).filter((g) => g.filas.length > 0);

  return (
    <Panel level="support" radius="lg" pad="sm" className={cn('flex flex-col gap-3', className)}>
      <span className="flex items-center gap-2">
        <History strokeWidth={1.5} className="size-3.5 text-[var(--icon-muted)]" />
        <span className="t-label text-[var(--text-secondary)]">
          Desde el recorrido anterior
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {cambios.length} hueco(s) con algo que decir
        </span>
      </span>

      {/* Los recuentos por veredicto, que es lo que se lee primero. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {porVeredicto.map(({ v, filas }) => (
          <span key={v} className="flex items-center gap-1.5" title={meta(v)?.description}>
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: meta(v)?.color }}
            />
            <span className="t-mono-xs text-[var(--text-secondary)]">
              {filas.length} {meta(v)?.label.toLowerCase()}
            </span>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {porVeredicto.flatMap(({ v, filas }) =>
          filas.map((c) => (
            <button
              key={c.locationId}
              type="button"
              onClick={() => onAbrirHueco?.(c.locationId)}
              disabled={!onAbrirHueco}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[var(--radius-xs)] px-1.5 py-1 text-left',
                onAbrirHueco && 'hover:[background:var(--glass-1)]',
              )}
              title={meta(v)?.description}
            >
              <span className="t-mono-xs" style={{ color: meta(v)?.color }}>
                {meta(v)?.label}
              </span>
              <span className="t-mono-xs text-[var(--text-primary)]">
                {c.locationCode ?? 'sin identificar'}
              </span>
              <span className="t-mono-xs text-[var(--text-faint)]">
                {/* Los dos lados, no solo el de ahora: «pallet inesperado» sin el «antes»
                    no dice si esto es nuevo o lleva semanas. */}
                {fecha(c.seenBefore)} {estado(c.statusBefore)} → {fecha(c.seenNow)}{' '}
                {estado(c.statusNow)}
                {c.palletNow && c.palletNow !== c.palletBefore && ` · ahora ${c.palletNow}`}
              </span>
            </button>
          )),
        )}
      </div>
    </Panel>
  );
}
