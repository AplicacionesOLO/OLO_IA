/**
 * ALINEAR Y DISTRIBUIR — controles de la seleccion multiple.
 *
 * Solo aparece con dos o mas racks seleccionados: con uno no hay nada que alinear
 * y un panel de botones inertes es peor que un panel ausente.
 *
 * Distribuir necesita TRES y sus botones se deshabilitan con dos, en lugar de
 * ocultarse: asi se ve que la funcion existe y que falta un rack, en vez de
 * parecer que la herramienta no esta.
 */

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ColumnsIcon,
  RowsIcon,
} from 'lucide-react';

import { cn } from '../../../../design/utils/cn';
import {
  alinear,
  distribuir,
  type CriterioAlineacion,
  type EjeDistribucion,
} from '../alinear';
import { useEditorStore } from '../store';
import { COLORES_RACK } from '../types';

export function AlinearPanel() {
  const {
    racks, selectedRackIds, calibration, updateRacks, recordAction, removeSelected, selectRacks,
  } = useEditorStore();

  const seleccion = racks.filter((r) => selectedRackIds.includes(r.layoutId));
  if (seleccion.length < 2) return null;

  const ppm = calibration.pixelsPerMeter;
  const movibles = seleccion.filter((r) => !r.locked).length;

  const aplicar = (movimientos: ReturnType<typeof alinear>) => {
    if (movimientos.length === 0) return;
    updateRacks(movimientos.map((m) => ({ layoutId: m.layoutId, updates: m.to })));
    // Una sola entrada de historial: alinear ocho racks es UNA decision.
    recordAction({ type: 'move-many', movimientos });
  };

  const alinearA = (criterio: CriterioAlineacion) => aplicar(alinear(seleccion, ppm, criterio));
  const distribuirEn = (eje: EjeDistribucion) => aplicar(distribuir(seleccion, ppm, eje));

  const colorTodos = (valor: string) =>
    updateRacks(
      seleccion.filter((r) => !r.locked).map((r) => ({ layoutId: r.layoutId, updates: { color: valor } })),
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Seleccion</span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {seleccion.length} racks
          {movibles !== seleccion.length && ` · ${seleccion.length - movibles} bloqueados`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">Alinear</span>
        <div className="flex gap-1">
          <Boton icono={AlignStartVertical} etiqueta="Alinear a la izquierda" onClick={() => alinearA('izquierda')} />
          <Boton icono={AlignCenterVertical} etiqueta="Centrar en horizontal" onClick={() => alinearA('centro-h')} />
          <Boton icono={AlignEndVertical} etiqueta="Alinear a la derecha" onClick={() => alinearA('derecha')} />
          <span aria-hidden className="mx-1 h-7 w-px self-center [background:var(--hairline)]" />
          <Boton icono={AlignStartHorizontal} etiqueta="Alinear arriba" onClick={() => alinearA('arriba')} />
          <Boton icono={AlignCenterHorizontal} etiqueta="Centrar en vertical" onClick={() => alinearA('centro-v')} />
          <Boton icono={AlignEndHorizontal} etiqueta="Alinear abajo" onClick={() => alinearA('abajo')} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">Distribuir</span>
        <div className="flex gap-1">
          <Boton
            icono={ColumnsIcon}
            etiqueta="Repartir en horizontal con huecos iguales"
            onClick={() => distribuirEn('horizontal')}
            disabled={seleccion.length < 3}
          />
          <Boton
            icono={RowsIcon}
            etiqueta="Repartir en vertical con huecos iguales"
            onClick={() => distribuirEn('vertical')}
            disabled={seleccion.length < 3}
          />
          {seleccion.length < 3 && (
            <span className="t-mono-xs self-center pl-1 text-[var(--text-faint)]">
              hacen falta 3
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">Color de los {movibles}</span>
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
          className="t-mono-xs text-[var(--state-alert)] transition-opacity hover:opacity-80 disabled:opacity-30"
        >
          Quitar {movibles} del plano
        </button>
      </div>

      <p className="t-mono-xs text-[var(--text-faint)]">
        Ctrl + clic añade o quita · arrastra sobre el vacio para hacer un marco ·
        Ctrl + A selecciona todos
      </p>
    </div>
  );
}

function Boton({
  icono: Icono,
  etiqueta,
  onClick,
  disabled,
}: {
  icono: typeof AlignStartVertical;
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn(
        'flex size-7 items-center justify-center rounded-[var(--radius-xs)] transition-colors',
        'text-[var(--icon-muted)] hover:text-[var(--icon-primary)] hover:[background:var(--glass-1)]',
        'disabled:pointer-events-none disabled:opacity-30',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
      )}
    >
      <Icono strokeWidth={1.5} className="size-3.5" />
    </button>
  );
}
