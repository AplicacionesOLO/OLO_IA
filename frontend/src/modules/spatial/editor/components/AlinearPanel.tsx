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

import { useState } from 'react';
import { Boxes, FlipHorizontal2, Group, Layers, MapPin, Ungroup } from 'lucide-react';

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
  const {
    racks, selectedRackId, selectedRackIds, calibration, updateRacks, removeSelected,
    selectRacks, agrupar, desagrupar, emparejarDeEspaldas,
  } = useEditorStore();

  //  El motivo por el que emparejar no se pudo hacer. Se enseña donde esta el boton: un
  //  boton que no hace nada al pulsarlo enseña que los botones de esta pantalla no son de
  //  fiar. Se declara antes del `return` temprano porque un hook no puede ir despues.
  const [aviso, setAviso] = useState<string | null>(null);

  const seleccion = racks.filter((r) => selectedRackIds.includes(r.layoutId));
  if (seleccion.length === 0) return null;

  const principal = racks.find((r) => r.layoutId === selectedRackId);

  const ppm = calibration.pixelsPerMeter;
  const movibles = seleccion.filter((r) => !r.locked).length;
  //  Cuantos de los seleccionados ya pertenecen a un grupo. Decide si se ofrece «separar» y
  //  es lo que distingue «estos van juntos» de «estos estan marcados ahora mismo».
  const yaAgrupados = seleccion.filter((r) => r.grupoId).length;

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

      {/*
        ── AGRUPAR ───────────────────────────────────────────────────────────────

        El caso que lo motiva es el rack doble: dos racks de espaldas con los frentes
        opuestos, donde mover uno sin el otro lo partiria por la mitad.

        No se deduce quien va con quien —el catalogo no dice hacia donde mira un rack y los
        codigos son consecutivos por importacion, no por parejas— asi que lo declara quien
        modela, que es quien tiene el almacen delante.

        Una vez agrupados, seleccionar uno selecciona el grupo, y eso hace que se muevan
        juntos en las tres vistas sin tocar el arrastre.
      */}
      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">
          {yaAgrupados > 0
            ? `Agrupados: ${yaAgrupados} de ${seleccion.length}`
            : 'Mover juntos'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Accion
            icono={Group}
            titulo="Agrupar"
            ayuda={
              seleccion.length < 2
                ? 'Hacen falta al menos dos: un grupo de uno no es un grupo'
                : 'A partir de ahora se mueven juntos'
            }
            onClick={() => agrupar()}
          />
          {yaAgrupados > 0 && (
            <Accion
              icono={Ungroup}
              titulo="Separar"
              ayuda="Deja de moverlos juntos"
              onClick={() => desagrupar()}
            />
          )}
        </div>
      </div>

      {/*
        ── MONTAR EL RACK DOBLE ─────────────────────────────────────────────────

        A mano no sale. Un rack mide 1,1 m de ancho en un plano de 112 m: a la escala a la
        que se ve el almacen entero, un pixel son varios centimetros, y lo que se consigue
        arrastrando es un par que PARECE pegado y no lo esta.

        Y desde que los pares se agrupan hay una trampa: agrupados, arrastrar uno mueve los
        dos, asi que ya no hay forma de juntarlos a mano. Este boton hace las cuatro cosas
        que son un solo gesto —pegar, alinear, declarar las dos caras y agrupar— y por eso
        no son cuatro botones.

        El PRINCIPAL no se mueve. Es el ultimo tocado, el que enseña el inspector, y decirlo
        aqui evita la pregunta de cual de los dos va a saltar.
      */}
      <div className="flex flex-col gap-1.5">
        <span className="t-mono-xs text-[var(--text-faint)]">Rack doble</span>
        <Accion
          icono={FlipHorizontal2}
          titulo="Poner de espaldas"
          ayuda={
            seleccion.length !== 2
              ? 'Selecciona exactamente DOS racks: un rack doble son dos'
              : `${principal?.rackCode ?? 'el principal'} se queda donde esta y el otro se ` +
                'pega a su trasera, alineado por la punta del C001. Les declara las dos ' +
                'caras hacia fuera y los agrupa.'
          }
          onClick={() => setAviso(emparejarDeEspaldas())}
        />
        {aviso && <p className="t-mono-xs text-[var(--text-warn)]">{aviso}</p>}
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
