/**
 * REPETIR EN FILA — la herramienta que hace viable montar un almacen real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ES LO PRIMERO QUE HACIA FALTA
 *
 * La familia RCL son 209 racks. Colocarlos de uno en uno, arrastrando y midiendo,
 * son horas y el resultado sale desalineado. Pero un almacen no es un monton de
 * racks sueltos: son FILAS de racks iguales separados por un paso constante. Con
 * esa forma, colocar 209 son cuatro operaciones de repetir.
 *
 * Es el equivalente al «array» de AutoCAD, y aqui se define con lo que el operario
 * ya sabe: cuantos, cada cuantos metros y en que direccion.
 *
 * ── EL PASO SE MIDE DE BORDE A BORDE ────────────────────────────────────────
 *
 * `separacion` es el HUECO entre racks, no la distancia entre centros. En un
 * almacen el dato que se conoce es el pasillo —«90 cm entre racks»—, no la suma del
 * pasillo mas el fondo del rack. Con centros habria que restar mentalmente el largo
 * en cada operacion, y ahi es donde se cuela el error.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cajaDe } from './alinear';
import type { PositionedRack } from './types';

export type DireccionRepeticion = 'derecha' | 'izquierda' | 'abajo' | 'arriba';

export interface OpcionesRepeticion {
  /** Copias NUEVAS. 3 deja el original mas 3 = 4 racks. */
  copias: number;
  /** Hueco entre el borde de un rack y el del siguiente, en metros. */
  separacionM: number;
  direccion: DireccionRepeticion;
}

/**
 * Genera las copias de los racks dados.
 *
 * Los codigos NO se inventan: cada copia conserva el `rackCode` del original y
 * queda marcada como no vinculada (`linked: false`). Inventar «RCL02» porque el
 * original era «RCL01» produciria racks que el WMS no conoce, y este editor existe
 * justamente para casar el plano con los codigos REALES del catalogo. Reasignar el
 * codigo de cada copia es un paso humano, y el inspector lo permite.
 */
export function repetir(
  racks: PositionedRack[],
  ppm: number,
  { copias, separacionM, direccion }: OpcionesRepeticion,
): PositionedRack[] {
  if (racks.length === 0 || copias < 1) return [];

  // El paso se calcula sobre la envolvente del CONJUNTO: repetir cuatro racks
  // seleccionados desplaza el bloque completo, no cada uno por su cuenta.
  const cajas = racks.map((r) => cajaDe(r, ppm));
  const bloque = {
    x0: Math.min(...cajas.map((c) => c.x0)),
    y0: Math.min(...cajas.map((c) => c.y0)),
    x1: Math.max(...cajas.map((c) => c.x1)),
    y1: Math.max(...cajas.map((c) => c.y1)),
  };

  const horizontal = direccion === 'derecha' || direccion === 'izquierda';
  const tamañoBloque = horizontal ? bloque.x1 - bloque.x0 : bloque.y1 - bloque.y0;
  const paso = tamañoBloque + separacionM * ppm;
  const signo = direccion === 'derecha' || direccion === 'abajo' ? 1 : -1;

  const nuevos: PositionedRack[] = [];
  for (let n = 1; n <= copias; n += 1) {
    const d = signo * paso * n;
    for (const rack of racks) {
      nuevos.push({
        ...rack,
        layoutId: `${rack.layoutId}-r${n}`,
        x: horizontal ? rack.x + d : rack.x,
        y: horizontal ? rack.y : rack.y + d,
        locked: false,
        linked: false,
      });
    }
  }
  return nuevos;
}

/**
 * Agrupa racks ya colocados por PROXIMIDAD, para poder seleccionar «esta hilera».
 *
 * Une los que se tocan o casi: dos racks pertenecen al mismo grupo si sus cajas
 * envolventes distan menos de `toleranciaM`. Es union-find sobre la lista, que para
 * unos cientos de racks es instantaneo y no necesita indice espacial.
 *
 * Se agrupa por lo que se VE, no por el codigo: la nomenclatura ya la agrupa
 * `groupByFamily`, y lo que aqui hace falta es «lo que esta fisicamente junto»,
 * que es justo lo que el backend no puede decir mientras no haya geometria.
 */
export function agruparPorProximidad(
  racks: readonly PositionedRack[],
  ppm: number,
  toleranciaM = 1.5,
): PositionedRack[][] {
  const tol = toleranciaM * ppm;
  const cajas = racks.map((r) => cajaDe(r, ppm));
  const padre = racks.map((_, i) => i);

  const raiz = (i: number): number => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]!]!;
      i = padre[i]!;
    }
    return i;
  };
  const unir = (a: number, b: number) => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) padre[rb] = ra;
  };

  for (let i = 0; i < racks.length; i += 1) {
    for (let j = i + 1; j < racks.length; j += 1) {
      const a = cajas[i]!;
      const b = cajas[j]!;
      const separadoX = b.x0 - a.x1 > tol || a.x0 - b.x1 > tol;
      const separadoY = b.y0 - a.y1 > tol || a.y0 - b.y1 > tol;
      if (!separadoX && !separadoY) unir(i, j);
    }
  }

  const grupos = new Map<number, PositionedRack[]>();
  racks.forEach((rack, i) => {
    const r = raiz(i);
    const lista = grupos.get(r);
    if (lista) lista.push(rack);
    else grupos.set(r, [rack]);
  });
  return [...grupos.values()].sort((a, b) => b.length - a.length);
}
