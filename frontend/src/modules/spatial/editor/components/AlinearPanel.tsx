/**
 * PANEL DE SELECCION — que hay seleccionado y como agrupar.
 *
 * Alinear y repartir ya no estan aqui: viven en la paleta superior, que es donde se
 * buscan. Tenerlos en los dos sitios obliga a mantener dos copias del mismo gesto.
 *
 * Lo que queda es lo que solo tiene sentido junto a la seleccion: cuantos hay, de
 * que familias, el color en bloque, y las dos formas de CLUSTERIZAR.
 *
 * ── LOS DOS CLUSTERES, Y EN QUE SE DIFERENCIAN ──────────────────────────────
 *
 * · POR NOMENCLATURA — el prefijo del codigo. RCL son 209 racks, PURT 38, MZ 12.
 *   Es el mismo criterio que agrupa el arbol del explorador (`groupByFamily`), asi
 *   que lo que se selecciona aqui coincide con lo que alli se ve.
 *
 * · POR UBICACION — lo que esta fisicamente junto en el plano. Y este no puede
 *   venir del backend: `aisle_count` es 0 y `world_position` esta al 100% NULL, asi
 *   que la unica fuente de «que esta al lado de que» son las posiciones que se
 *   crean en este editor. Se calcula uniendo los racks cuyas cajas distan menos de
 *   1,5 m — es decir, el cluster es CONSECUENCIA de colocar, no un dato previo.
 */

import { Boxes, Layers, MapPin } from 'lucide-react';

import { cn } from '../../../../design/utils/cn';
import { agruparPorProximidad } from '../repetir';
import { useEditorStore } from '../store';
import { COLORES_RACK } from '../types';

/** Prefijo alfabetico del codigo: el mismo criterio que el arbol del explorador. */
function familiaDe(codigo: string): string {
  const m = /^[A-Z]+/.exec(codigo);
  return m ? m[0] : codigo;
}

export function AlinearPanel() {
  const { racks, selectedRackIds, calibration, updateRacks, removeSelected, selectRacks } =
    useEditorStore();

  const seleccion = racks.filter((r) => selectedRackIds.includes(r.layoutId));
  if (seleccion.length === 0) return null;

  const ppm = calibration.pixelsPerMeter;
  const movibles = seleccion.filter((r) => !r.locked).length;

  const familias = [...new Set(seleccion.map((r) => familiaDe(r.rackCode)))].sort();

  const seleccionarFamilias = () => {
    const set = new Set(familias);
    selectRacks(racks.filter((r) => set.has(familiaDe(r.rackCode))).map((r) => r.layoutId));
  };

  const seleccionarClusterContiguo = () => {
    const grupos = agruparPorProximidad(racks, ppm);
    const ids = new Set(selectedRackIds);
    const elegidos = grupos.filter((g) => g.some((r) => ids.has(r.layoutId))).flat();
    if (elegidos.length > 0) selectRacks(elegidos.map((r) => r.layoutId));
  };

  const colorTodos = (valor: string) =>
    updateRacks(
      seleccion
        .filter((r) => !r.locked)
        .map((r) => ({ layoutId: r.layoutId, updates: { color: valor } })),
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Seleccion</span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {seleccion.length} rack{seleccion.length === 1 ? '' : 's'}
          {movibles !== seleccion.length && ` · ${seleccion.length - movibles} bloq.`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">
          Clusterizar {familias.length > 0 && `· ${familias.join(', ')}`}
        </span>
        <div className="flex flex-col gap-1">
          <Accion
            icono={Layers}
            titulo={`Toda la familia ${familias.join(' + ')}`}
            ayuda="Selecciona todos los racks del plano cuyo codigo empieza igual"
            onClick={seleccionarFamilias}
          />
          <Accion
            icono={MapPin}
            titulo="El cluster contiguo"
            ayuda="Selecciona los racks que estan fisicamente pegados a estos, a menos de 1,5 m"
            onClick={seleccionarClusterContiguo}
          />
          <Accion
            icono={Boxes}
            titulo={`Los ${racks.length} colocados`}
            ayuda="Ctrl+A hace lo mismo"
            onClick={() => selectRacks(racks.map((r) => r.layoutId))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">
          Color {movibles > 1 ? `de los ${movibles}` : ''}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {COLORES_RACK.map((c) => (
            <button
              key={c.valor}
              type="button"
              onClick={() => colorTodos(c.valor)}
              aria-label={`Pintar la seleccion de ${c.nombre}`}
              title={c.nombre}
              className="size-5 rounded-[var(--radius-xs)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: c.valor }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => selectRacks([])}
          className="t-mono-xs text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
        >
          Deseleccionar
        </button>
        <span aria-hidden className="h-3 w-px [background:var(--hairline)]" />
        <button
          type="button"
          onClick={() => removeSelected()}
          disabled={movibles === 0}
          className="t-mono-xs text-[var(--text-warn)] transition-opacity hover:opacity-80 disabled:opacity-30"
        >
          Quitar {movibles} del plano
        </button>
      </div>

      <p className="t-mono-xs text-[var(--text-faint)]">
        Ctrl + clic añade o quita · arrastra sobre el vacio para un marco · alinear y
        repartir estan en la paleta de arriba
      </p>
    </div>
  );
}

function Accion({
  icono: Icono,
  titulo,
  ayuda,
  onClick,
}: {
  icono: typeof Layers;
  titulo: string;
  ayuda: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={ayuda}
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left transition-colors',
        'hover:[background:var(--glass-2)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
      )}
    >
      <Icono strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
      <span className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{titulo}</span>
    </button>
  );
}
