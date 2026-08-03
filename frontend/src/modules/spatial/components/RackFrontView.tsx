/**
 * ALZADO DE UN RACK — cuerpo x nivel x posicion, desde el backend.
 *
 * Sustituye al camino `rack/RackFrontal` + `engine/RackModel`, que construia la
 * visual en el cliente a partir de una lista de ubicaciones. Ya no hace falta y
 * ademas no podia funcionar: aquel modelo pedia `occupied` y `capacity` por celda,
 * y ninguno de los dos existe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EL MARCO LO DA EL BACKEND
 *
 * `bayCount`, `maxLevel` y `maxPosition` llegan resueltos, asi que la rejilla se
 * dibuja ANTES de recorrer las celdas. Eso permite distinguir TRES cosas:
 *
 *   existe y esta libre · existe y esta bloqueada · **no existe**
 *
 * La tercera importa: 3.866 tripletas (rack, cuerpo, nivel) tienen UNA sola
 * posicion cuando el rack admite mas, porque **no se inventan posiciones
 * hermanas** (ADR-013). Derivando el marco de las celdas presentes, ese hueco
 * desaparece — y es justo el que dice si falta inventario o falta catalogo.
 *
 * ── DOS EJES, DOS CODIFICACIONES ────────────────────────────────────────────
 *
 * FONDO de la celda   → estado del ESPACIO (`available` | `blocked`).
 *                       Vocabulario cerrado, particiona el total.
 * PUNTO en la esquina → situacion del WMS. Vocabulario abierto, es una FOTO.
 *
 * Se contradicen en 2.365 ubicaciones. Compartir codificacion haria invisible la
 * contradiccion, que es lo que hay que poder ver.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cn } from '../../../design/utils/cn';
import type { RackFrontCell, RackFrontView as RackFrontViewData } from '../types/index';
import {
  STATUS_META,
  StatusLegend,
  WmsSituationLegend,
  situationDescription,
  situationLabel,
} from './StatusLegend';

/** Lado de una celda de posicion, en px. */
const CELDA = 20;
const HUECO = 2;

interface Props {
  view: RackFrontViewData;
  selectedLocationId: string | null;
  onSelect: (cell: RackFrontCell) => void;
  /** Fecha del archivo importado: sin ella la leyenda del WMS promete actualidad. */
  asOf?: string | null | undefined;
  className?: string | undefined;
}

export function RackFrontView({
  view,
  selectedLocationId,
  onSelect,
  asOf,
  className,
}: Props) {
  // Indice por (cuerpo, nivel, posicion): permite preguntar «existe esta celda?»
  // en lugar de solo recorrer las que hay.
  const porCelda = new Map<string, RackFrontCell>();
  const cuerpos = new Set<number>();
  for (const c of view.cells) {
    porCelda.set(clave(c.bayIndex, c.level, c.position), c);
    cuerpos.add(c.bayIndex);
  }

  const indicesCuerpo = [...cuerpos].sort((a, b) => a - b);
  const maxNivel = view.maxLevel ?? 1;
  const maxPos = view.maxPosition ?? 1;

  // El endpoint del alzado devuelve celdas de los CUERPOS de un rack. Un nodo que
  // no es un rack —un `storage_area`, por ejemplo— tiene sus ubicaciones colgando
  // directamente de si mismo, sin cuerpo intermedio, asi que no tiene alzado.
  //
  // Sin este caso la vista dibujaba una rejilla vacia con «0 cuerpos», que parece
  // un rack roto en lugar de un nodo de otra clase. Medido con `ALM`, el
  // `storage_area` del escenario: 2 ubicaciones reales y 0 celdas de alzado.
  if (view.cells.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6', className)}>
        <div className="flex max-w-[46ch] flex-col items-center gap-3 text-center">
          <span className="text-[length:var(--text-md)] font-[var(--weight-light)] text-[var(--text-primary)]">
            {view.rackCode} no tiene alzado
          </span>
          <p className="t-body text-[var(--text-secondary)]">
            Este nodo no organiza sus ubicaciones en cuerpos, niveles y posiciones,
            asi que no hay una vista frontal que dibujar. Sus ubicaciones estan en
            la tabla.
          </p>
          {view.functionLabel && (
            <span className="t-mono-xs text-[var(--text-faint)]">
              funcion: {view.functionLabel}
            </span>
          )}
        </div>
      </div>
    );
  }
  // De arriba abajo: el nivel 1 es el suelo, y un alzado con el suelo arriba no
  // es un alzado.
  const niveles = Array.from({ length: maxNivel }, (_, i) => maxNivel - i);
  const anchoCuerpo = maxPos * CELDA + (maxPos - 1) * HUECO;

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto p-3', className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">
            {view.rackCode}
          </h2>
          {view.functionLabel && (
            <span className="t-mono-xs text-[var(--text-faint)]">{view.functionLabel}</span>
          )}
          {view.rackExternalCode && view.rackExternalCode !== view.rackCode && (
            <span className="t-mono-xs text-[var(--text-faint)]">
              WMS: {view.rackExternalCode}
            </span>
          )}
        </div>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {view.bayCount} cuerpos · {maxNivel} niveles · {maxPos}{' '}
          {maxPos === 1 ? 'posicion' : 'posiciones'} ·{' '}
          {view.cells.length.toLocaleString('es')} ubicaciones
        </span>
      </header>

      <div className="flex flex-col gap-[3px]">
        {niveles.map((nivel) => (
          <div key={nivel} className="flex items-center gap-2">
            <span className="t-mono-xs w-9 shrink-0 text-right text-[var(--text-faint)] [font-variant-numeric:tabular-nums]">
              N{String(nivel).padStart(2, '0')}
            </span>
            <div className="flex" style={{ gap: HUECO * 3 }}>
              {indicesCuerpo.map((bay) => (
                <div key={bay} className="flex" style={{ gap: HUECO }}>
                  {Array.from({ length: maxPos }, (_, i) => i + 1).map((pos) => {
                    const celda = porCelda.get(clave(bay, nivel, pos));
                    return celda ? (
                      <Celda
                        key={pos}
                        celda={celda}
                        seleccionada={celda.locationId === selectedLocationId}
                        onSelect={() => onSelect(celda)}
                      />
                    ) : (
                      <NoDeclarada key={pos} bay={bay} nivel={nivel} pos={pos} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-1 flex items-center gap-2">
          <span className="w-9 shrink-0" />
          <div className="flex" style={{ gap: HUECO * 3 }}>
            {indicesCuerpo.map((bay) => (
              <span
                key={bay}
                className="t-mono-xs text-center text-[var(--text-faint)] [font-variant-numeric:tabular-nums]"
                style={{ width: anchoCuerpo }}
              >
                {bay}
              </span>
            ))}
          </div>
        </div>
      </div>

      <footer className="flex flex-col gap-4 border-t border-[var(--hairline-strong)] pt-4">
        <StatusLegend />
        <WmsSituationLegend counts={contarSituaciones(view.cells)} asOf={asOf} />
        <span className="t-mono-xs text-[var(--text-faint)]">
          Las celdas con borde discontinuo son posiciones que el catalogo NO declara.
          No se inventan.
        </span>
      </footer>
    </div>
  );
}

// ── Celdas ──────────────────────────────────────────────────────────────────

function Celda({
  celda,
  seleccionada,
  onSelect,
}: {
  celda: RackFrontCell;
  seleccionada: boolean;
  onSelect: () => void;
}) {
  const meta = STATUS_META[celda.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${celda.code}, ${meta.label}`}
      aria-pressed={seleccionada}
      title={tooltip(celda)}
      className={cn(
        'relative shrink-0 rounded-[2px] transition-[transform,box-shadow]',
        seleccionada ? 'z-10 scale-[1.35] shadow-[var(--focus-ring)]' : 'hover:scale-110',
      )}
      style={{
        width: CELDA,
        height: CELDA,
        background: `color-mix(in oklab, ${meta.color} 55%, transparent)`,
      }}
    >
      {celda.situation && (
        <span
          aria-hidden
          className="absolute -right-px -top-px size-1.5 rounded-full border border-[var(--text-primary)]"
          /* `OCUP` mas visible: es el valor que el operador busca en la foto. */
          style={{ opacity: celda.situation === 'OCUP' ? 0.9 : 0.3 }}
        />
      )}
    </button>
  );
}

function NoDeclarada({ bay, nivel, pos }: { bay: number; nivel: number; pos: number }) {
  return (
    <span
      className="shrink-0 rounded-[2px] border border-dashed border-[var(--hairline-strong)]"
      style={{ width: CELDA, height: CELDA }}
      title={`Cuerpo ${bay} · nivel ${nivel} · posicion ${pos}: no declarada en el catalogo`}
      aria-hidden
    />
  );
}

// ── Auxiliares ──────────────────────────────────────────────────────────────

function clave(bay: number, nivel: number | null, pos: number | null): string {
  return `${bay}|${nivel ?? 0}|${pos ?? 0}`;
}

function contarSituaciones(cells: RackFrontCell[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cells) {
    const k = c.situation ?? '(sin situacion)';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function tooltip(c: RackFrontCell): string {
  const partes = [
    c.code,
    `espacio: ${STATUS_META[c.status].label}`,
    `WMS: ${situationLabel(c.situation)} — ${situationDescription(c.situation)}`,
  ];
  if (c.externalCode && c.externalCode !== c.code) partes.push(`etiqueta: ${c.externalCode}`);
  if (c.isBulkArea) partes.push('granel');
  return partes.join('\n');
}
