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
import { nuevoLayoutId } from './types';

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
/**
 * UN RACK DEL CATALOGO QUE TODAVIA NO ESTA EN EL PLANO.
 *
 * Solo lo que hace falta para asignarlo: su codigo y sus medidas. Las medidas viajan porque
 * los racks de una hilera NO son clones —RCL21 mide 75,6 m y RCL31 mide 56,7— y repetir sin
 * ellas produce una fila uniforme que no existe.
 */
export interface RackDisponible {
  rackCode: string;
  width: number;
  length: number;
  height: number;
}

/** El codigo partido en prefijo y numero, para ordenar `RCL9` antes de `RCL10`. */
function ordenNatural(codigo: string): [string, number] {
  const m = /^([A-Za-z]*)(\d*)/.exec(codigo);
  return [m?.[1] ?? codigo, m?.[2] ? Number.parseInt(m[2], 10) : Number.NaN];
}

/**
 * QUE RACKS REALES LE TOCAN A LAS COPIAS.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NI INVENTAR NI TECLEAR 318 VECES
 *
 * Repetir dejaba cada copia con el codigo del original y sin vincular, con el aviso «el
 * codigo real de cada una lo pones tu en el inspector». El motivo era bueno: inventar `RCL02`
 * porque el original era `RCL01` produce racks que el WMS no conoce.
 *
 * Pero hay una tercera opcion que respeta eso entero: TOMARLOS DEL CATALOGO. Los racks que
 * existen en el WMS y todavia no estan en el plano, en su orden. No se inventa nada —cada
 * codigo asignado es un rack que existe— y desaparecen 318 entradas a mano.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL ORDEN, Y POR QUE PUEDE SALTARSE NUMEROS
 *
 * Se sigue el orden natural del codigo, empezando DESPUES del original: repetir `RCL21` da
 * `RCL22`, `RCL23`… Si `RCL22` ya estaba colocado, le toca el siguiente que no lo este, asi
 * que la serie puede saltar. No se corrige: el rack que falta ya esta en el plano, y meterlo
 * dos veces seria peor que un salto.
 *
 * Por eso quien llama tiene que ENSEÑAR lo que va a asignar antes de hacerlo. Una asignacion
 * de 28 codigos que nadie ha visto es exactamente el tipo de accion que hay que deshacer.
 *
 * Devuelve MENOS de `cuantas` si el catalogo se agota. Las copias que se queden sin codigo
 * siguen el camino de antes —sin vincular, para ponerlo a mano— en vez de repetir el ultimo.
 */
export function codigosParaRepetir(
  original: string,
  disponibles: readonly RackDisponible[],
  cuantas: number,
): RackDisponible[] {
  const [prefijoOriginal, numeroOriginal] = ordenNatural(original);
  const mismos = disponibles
    .filter((d) => {
      const [p, n] = ordenNatural(d.rackCode);
      //  Solo la MISMA familia: repetir `RCL21` no puede seguir por `PURT01` porque el
      //  catalogo se quede sin RCL. Son otra cosa y estaran en otro sitio de la nave.
      if (p !== prefijoOriginal) return false;
      //  Y solo los que van DESPUES. Los anteriores existen y no estan colocados, pero van
      //  en la otra direccion: repetir hacia la derecha y asignar codigos hacia atras deja
      //  la hilera numerada al reves.
      return Number.isNaN(n) || Number.isNaN(numeroOriginal) ? true : n > numeroOriginal;
    })
    .sort((a, b) => {
      const [, na] = ordenNatural(a.rackCode);
      const [, nb] = ordenNatural(b.rackCode);
      if (Number.isNaN(na) || Number.isNaN(nb)) return a.rackCode.localeCompare(b.rackCode);
      return na - nb;
    });
  return mismos.slice(0, Math.max(0, cuantas));
}

export function repetir(
  racks: PositionedRack[],
  ppm: number,
  { copias, separacionM, direccion }: OpcionesRepeticion,
  /**
   * Los racks REALES que le tocan a cada copia, de `codigosParaRepetir`. Sin ellos las copias
   * salen como antes: con el codigo del original y sin vincular.
   *
   * Solo se usa cuando se repite UN rack. Con varios seleccionados no hay forma de saber a
   * cual de los cuatro le corresponde el siguiente codigo, y adivinarlo mezclaria hileras.
   */
  asignados: readonly RackDisponible[] = [],
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
      //  El rack real de esta copia, si hay uno. Solo con un original seleccionado.
      const real = racks.length === 1 ? asignados[n - 1] : undefined;
      nuevos.push({
        ...rack,
        layoutId: nuevoLayoutId(real?.rackCode ?? rack.rackCode),
        rackCode: real?.rackCode ?? rack.rackCode,
        //  Y sus MEDIDAS: una hilera de racks no es una hilera de clones. Sin esto la copia
        //  se veria con el largo del original y el plano diria 75,6 m donde hay 56,7.
        ...(real ? { width: real.width, length: real.length, height: real.height } : {}),
        x: horizontal ? rack.x + d : rack.x,
        y: horizontal ? rack.y : rack.y + d,
        locked: false,
        //  Vinculado solo si se le asigno un rack de VERDAD. Sin codigo real sigue como antes:
        //  sin vincular, para que se vea que falta ponerlo.
        linked: Boolean(real),
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
