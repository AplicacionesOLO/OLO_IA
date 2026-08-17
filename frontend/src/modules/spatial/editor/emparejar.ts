/**
 * PONER DOS RACKS DE ESPALDAS: LA CUENTA.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTO NO SE HACE ARRASTRANDO
 *
 * Un rack mide 1,1 m de ancho en un plano de 112 m. Para que dos queden de espaldas de
 * verdad —tocandose, sin solaparse ni dejar un hueco— hay que acertar el centro con
 * precision de milimetros, y ese gesto con el raton no existe: a la escala a la que se ve el
 * almacen entero, un pixel son varios centimetros.
 *
 * Lo que sale de intentarlo es un par que PARECE pegado y no lo esta. Y no es cosmetico: las
 * dos caras interiores dejan de coincidir, la distancia entre pasillos queda mal, y el rack
 * doble deja de ser un bloque para ser dos racks casi juntos.
 *
 * Ademas, desde que los pares se agrupan hay una trampa nueva: agrupados, arrastrar uno
 * mueve los dos, asi que ya no se pueden juntar a mano ni con toda la paciencia del mundo.
 * Esta operacion resuelve las dos cosas de una vez.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE DECIDE Y QUE NO
 *
 * NO se decide quien va con quien: eso lo dice quien modela seleccionando dos racks. Aqui
 * solo se calcula donde cae el segundo para quedar espalda contra espalda con el primero.
 *
 * El ANCLA no se mueve. Es el rack principal de la seleccion —el ultimo tocado, el que
 * enseña el inspector— y quedarse quieto es lo que hace la operacion predecible: se sabe de
 * antemano cual de los dos va a cambiar de sitio.
 *
 * EL LADO sale de donde ya estaba el movil. Si estaba a la derecha del ancla, se pega por la
 * derecha. Asi la operacion respeta lo que quien modela ya habia empezado a hacer a mano en
 * vez de mandar el rack al otro lado sin motivo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LAS UNIDADES, QUE AQUI MUERDEN
 *
 * `PositionedRack` guarda la POSICION en pixeles del plano y las MEDIDAS en metros. No es un
 * descuido: el raton devuelve pixeles y la base guarda metros, y la frontera esta en
 * `publicacion.ts`. Pero significa que sumar `ancho / 2` a `x` mezcla dos unidades, y el
 * resultado no avisa — sale un rack colocado casi bien—. Por eso todo lo que se mide en
 * metros se multiplica por `ppm` explicitamente y no hay ni una suma sin convertir.
 */

import { invierteNumeracionPorGiro } from '../cluster3d/escena';
import type { PositionedRack } from './types';

/** Lo que hay que cambiarle a cada uno de los dos racks para que queden de espaldas. */
export interface Emparejado {
  /** Nueva posicion del movil, en PIXELES del plano. */
  x: number;
  y: number;
  /** Giro del movil: el mismo que el ancla, para que queden paralelos. */
  rotation: number;
  /** Cara operativa del movil: la que da hacia fuera del par. */
  frenteMovil: 1 | -1;
  /** Cara operativa del ancla: la contraria, tambien hacia fuera. */
  frenteAncla: 1 | -1;
}

const rad = (grados: number): number => (grados * Math.PI) / 180;

/**
 * Donde tiene que ir `movil` para quedar de espaldas contra `ancla`.
 *
 * @param ppm Pixeles por metro del plano. Sin el no se puede pasar de las medidas —metros—
 *   a la posicion —pixeles—, y una operacion asi con la escala equivocada deja los racks
 *   separados por un factor de veintitantos.
 */
export function deEspaldas(
  ancla: PositionedRack,
  movil: PositionedRack,
  ppm: number,
): Emparejado {
  const t = rad(ancla.rotation);
  //  El eje LOCAL X del ancla, en coordenadas del plano —`y` hacia abajo—. Es el eje del
  //  ancho, o sea el que va de una cara larga a la otra: justo por donde se pegan.
  const ejeAncho = { x: Math.cos(t), y: Math.sin(t) };
  //  Y el eje LARGO, perpendicular. Sobre el se alinean las puntas.
  const ejeLargo = { x: -Math.sin(t), y: Math.cos(t) };

  //  ── De que lado se pega ────────────────────────────────────────────────────
  //  Del lado donde el movil ya estaba. Se proyecta el vector que los separa sobre el eje
  //  del ancho; el signo dice si estaba a un lado o al otro.
  const dx = movil.x - ancla.x;
  const dy = movil.y - ancla.y;
  const haciaDonde = dx * ejeAncho.x + dy * ejeAncho.y;
  //  Empate exacto —el movil justo sobre el eje del ancla, o encima de el— se resuelve
  //  con `+1`. Es arbitrario, pero tiene que ser determinista: si no, dos pulsaciones
  //  seguidas sobre la misma seleccion darian resultados distintos.
  const lado: 1 | -1 = haciaDonde < 0 ? -1 : 1;

  //  ── Cuanto se separan los centros ──────────────────────────────────────────
  //  Medio ancho de cada uno: asi las dos caras interiores acaban en el MISMO plano, que es
  //  lo que significa «de espaldas». Con racks de anchos distintos tampoco falla, porque no
  //  se supone que sean iguales.
  const separacion = ((ancla.width + movil.width) / 2) * ppm;

  /*
    ── Y como se alinean a lo largo ───────────────────────────────────────────

    Por la PUNTA del C001, no por el centro. Lo dijo quien modela: «la punta es la misma
    para todos; aunque esten de espaldas, si uno empieza con C001 el otro tambien empieza
    C001». Con dos racks del mismo largo —lo normal— alinear por la punta y por el centro
    es exactamente lo mismo; con largos distintos, alinear por el centro dejaria el C001 de
    uno enfrente del C003 del otro.

    Con el mismo giro los dos numeran en el mismo sentido, asi que su C001 esta en el mismo
    extremo local, y la correccion es media diferencia de largos.
  */
  const sentido = invierteNumeracionPorGiro(ancla.rotation) ? 1 : -1;
  const correccion = (sentido * (ancla.length - movil.length)) / 2 * ppm;

  return {
    x: ancla.x + lado * separacion * ejeAncho.x + correccion * ejeLargo.x,
    y: ancla.y + lado * separacion * ejeAncho.y + correccion * ejeLargo.y,
    //  Paralelos. No hace falta girar el movil 180 grados: la numeracion de los cuerpos ya
    //  es independiente del giro, y hacia donde se saca el palet lo dice la cara, que se
    //  declara aqui mismo. Girarlo seria un cambio que no aporta y que se ve raro al
    //  compararlo con el vecino.
    rotation: ancla.rotation,
    //  ── Y las dos caras salen GRATIS ─────────────────────────────────────────
    //  Ponerlos de espaldas es decir donde estan las espaldas. El ancla tiene al movil en su
    //  lado `lado`, asi que esa es su trasera y su cara buena es la contraria; y al reves
    //  para el movil. No es una suposicion: es lo que acaba de declarar quien modela con
    //  este gesto, y ahorra ir rack por rack declarando lo que ya se sabe.
    frenteAncla: lado === 1 ? -1 : 1,
    frenteMovil: lado,
  };
}
