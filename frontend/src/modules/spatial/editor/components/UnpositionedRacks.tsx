/**
 * RACKS SIN POSICIONAR — agrupados por familia.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE AGRUPADOS
 *
 * Eran 348 filas planas ordenadas por codigo. Para montar la familia RCL —209
 * racks— habia que recorrer la lista buscando cuales empiezan por RCL, y entre
 * ellos se colaban ASCEN, BUFFER y CAAU. Agrupado por el prefijo del codigo, RCL es
 * UNA fila que se despliega, con su recuento.
 *
 * Es el mismo criterio que agrupa el arbol del explorador —el prefijo alfabetico—,
 * asi que lo que aqui se ve coincide con lo que alli se navega.
 *
 * ── COLOCAR LA FAMILIA DE UNA VEZ ───────────────────────────────────────────
 *
 * «Colocar los 209» los suelta en una cuadricula ordenada en lugar de apilarlos en
 * el mismo punto: apilados son 209 racks invisibles unos sobre otros, y separarlos
 * a mano es peor que colocarlos de cero. Puestos en cuadricula, se seleccionan por
 * filas y se llevan a su sitio con «repetir en fila» y «alinear».
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { ChevronRight, GripHorizontal, LayoutGrid } from 'lucide-react';

import { cn } from '../../../../design/utils/cn';
import { useEditorStore } from '../store';
import type { FloorPlanCell } from '../../types/index';
import type { PositionedRack } from '../types';
import { nuevoLayoutId } from '../types';

interface UnpositionedRacksProps {
  /** Racks del catalogo (de useFloorPlanCompleto). */
  allRacks: FloorPlanCell[];
}

/** Medidas de partida de un rack recien colocado, en metros. */
const ANCHO_M = 1.1;
const LARGO_M = 12;
const ALTO_M = 8.5;

function familiaDe(codigo: string): string {
  const m = /^[A-Z]+/.exec(codigo);
  return m ? m[0] : codigo;
}

export function UnpositionedRacks({ allRacks }: UnpositionedRacksProps) {
  const { racks: positioned, addRack, setMode, selectRack, selectRacks, calibration } =
    useEditorStore();
  const [abiertas, setAbiertas] = useState<string[]>([]);

  const puestos = new Set(positioned.map((r) => r.rackCode));
  const pendientes = allRacks.filter((r) => !puestos.has(r.rackCode));

  if (pendientes.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <span className="t-label">Racks sin posicionar</span>
        <p className="t-mono-xs text-[var(--text-faint)]">Todos posicionados</p>
      </div>
    );
  }

  const familias = new Map<string, FloorPlanCell[]>();
  for (const r of pendientes) {
    const f = familiaDe(r.rackCode);
    const lista = familias.get(f);
    if (lista) lista.push(r);
    else familias.set(f, [r]);
  }
  const ordenadas = [...familias.entries()]
    .map(([prefijo, lista]) => ({
      prefijo,
      lista: [...lista].sort((a, b) => a.rackCode.localeCompare(b.rackCode)),
    }))
    .sort((a, b) => b.lista.length - a.lista.length || a.prefijo.localeCompare(b.prefijo));

  const ppm = calibration.pixelsPerMeter;

  const nuevoRack = (codigo: string, x: number, y: number): PositionedRack => ({
    layoutId: nuevoLayoutId(codigo),
    rackCode: codigo,
    x,
    y,
    width: ANCHO_M,
    length: LARGO_M,
    height: ALTO_M,
    rotation: 0,
    locked: false,
    linked: true,
  });

  const colocarUno = (r: FloorPlanCell) => {
    const rack = nuevoRack(r.rackCode, 100 + Math.random() * 200, 100 + Math.random() * 200);
    addRack(rack);
    setMode('select');
    selectRack(rack.layoutId);
  };

  const colocarFamilia = (lista: FloorPlanCell[]) => {
    // Cuadricula: tantas columnas como quepan en una fila razonable. El paso deja
    // un hueco de un ancho de rack, suficiente para distinguirlos y agarrarlos.
    const columnas = Math.max(1, Math.ceil(Math.sqrt(lista.length)));
    const pasoX = (ANCHO_M * 2) * ppm;
    const pasoY = (LARGO_M + 1) * ppm;
    const nuevos = lista.map((r, i) =>
      nuevoRack(
        r.rackCode,
        120 + (i % columnas) * pasoX,
        120 + Math.floor(i / columnas) * pasoY,
      ),
    );
    nuevos.forEach(addRack);
    setMode('select');
    selectRacks(nuevos.map((r) => r.layoutId));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Racks sin posicionar</span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {pendientes.length} en {ordenadas.length} familias
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {ordenadas.map(({ prefijo, lista }) => {
          const abierta = abiertas.includes(prefijo);
          return (
            <div key={prefijo} className="flex flex-col">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setAbiertas((a) =>
                      a.includes(prefijo) ? a.filter((p) => p !== prefijo) : [...a, prefijo],
                    )
                  }
                  aria-expanded={abierta}
                  aria-label={`${abierta ? 'Plegar' : 'Desplegar'} la familia ${prefijo}`}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-xs)] px-1.5 py-1',
                    'text-left transition-colors hover:[background:var(--glass-1)]',
                  )}
                >
                  <ChevronRight
                    strokeWidth={1.5}
                    className={cn(
                      'size-3 shrink-0 text-[var(--text-faint)] transition-transform',
                      abierta && 'rotate-90',
                    )}
                  />
                  <span className="flex-1 truncate font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-primary)]">
                    {prefijo}
                  </span>
                  <span className="t-mono-xs text-[var(--text-faint)]">{lista.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => colocarFamilia(lista)}
                  title={`Colocar los ${lista.length} de ${prefijo} en cuadricula, listos para repartir`}
                  aria-label={`Colocar los ${lista.length} racks de la familia ${prefijo}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] transition-colors hover:text-[var(--icon-accent)] hover:[background:var(--glass-1)]"
                >
                  <LayoutGrid strokeWidth={1.5} className="size-3" />
                </button>
              </div>

              {abierta && (
                <div className="flex flex-col gap-0.5 pl-4">
                  {lista.map((r) => (
                    <button
                      key={r.rackCode}
                      type="button"
                      onClick={() => colocarUno(r)}
                      className="flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1 text-left transition-colors hover:[background:var(--glass-2)]"
                      title={`Colocar ${r.rackCode} en el plano`}
                    >
                      <GripHorizontal
                        strokeWidth={1.5}
                        className="size-3 shrink-0 text-[var(--text-faint)]"
                      />
                      <span className="flex-1 font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-primary)]">
                        {r.rackCode}
                      </span>
                      <span className="t-mono-xs text-[var(--text-faint)]">
                        {r.locationCount} ubic
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
