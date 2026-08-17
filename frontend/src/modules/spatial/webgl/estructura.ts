/**
 * EL RACK COMO ESTANTERIA DE VERDAD: MONTANTES, LARGUEROS Y DOS HUECOS POR CELDA.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE VEIA ANTES Y POR QUE NO BASTABA
 *
 * Un rack era UN CAJON MACIZO de 56,7 x 1,1 x 11,9 m, con placas de color pegadas a la cara
 * cuando había lectura. Como silueta funciona: dice dónde está el rack y cuánto ocupa.
 *
 * Pero un rack de paletización no es un bloque, es sobre todo AIRE. Y esa diferencia no es
 * estética:
 *
 *   · No se ve cuántos niveles tiene, ni a qué altura está cada uno.
 *   · No se ve dónde empieza y acaba un cuerpo, así que no se puede contar hasta el C018.
 *   · No se ven las DOS posiciones de cada hueco, que es la unidad con la que se trabaja:
 *     una ubicación es `RCL47-C018-N01-2`, y ese `-2` es una de las dos.
 *   · Y un bloque macizo tapa lo que hay dentro y detrás, así que un pasillo entero se ve
 *     como una pared.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE SE GENERA Y NO SE DESCARGA UN MODELO
 *
 * Porque no hay un rack: hay 347, y cada uno tiene los suyos. RCL47 son 21 cuerpos x 7
 * niveles x 2 posiciones en 56,7 m; otros tienen 27 cuerpos, o 5 niveles, o miden 12 m.
 *
 * Un `.glb` de una estantería —por bueno que sea— trae una geometría FIJA. Para encajarlo
 * habría que estirarlo, y estirar un rack de 5 niveles hasta 11,9 m no da 7 niveles: da 5
 * niveles deformados, con los largueros donde no están y los huecos donde no hay. O sea, un
 * dibujo bonito que MIENTE sobre el almacén, que es lo contrario de lo que sirve aquí.
 *
 * Generándolo del catálogo, cada rack sale con sus cuerpos y sus niveles reales, y contar
 * hasta el C018 en la pantalla da el mismo C018 que en el suelo.
 *
 * (Se miró lo otro. Aparte de la geometría fija, un modelo externo trae su licencia, sus
 * megas y su formato, y este es un SaaS multi-tenant donde la licencia importa —ADR-014—.)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARCHIVO NO IMPORTA THREE.JS
 *
 * Por lo mismo que `mundo.ts`: esto es aritmética, y la aritmética se prueba sin abrir una
 * tarjeta gráfica. Devuelve cajas —centro, tamaño y giro— y quien renderiza las mete en un
 * `Matrix4`. El eje girado 90° del visor axonométrico estuvo semanas en pantalla porque la
 * única forma de verlo era mirarlo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LAS MEDIDAS DE LOS PERFILES
 *
 * Son las de una estantería selectiva convencional, redondeadas: montante de 100 mm,
 * larguero de 120x50, apoyo de 50. No salen del catálogo —que no las trae— así que son una
 * CONVENCION, igual que ya lo son las medidas en metros de los racks. Lo que tiene que ser
 * fiel es la ESTRUCTURA —cuántos cuerpos, cuántos niveles, dos posiciones por hueco— porque
 * eso sí está en los datos y es lo que se cuenta al mirar.
 */

import { posicionesDe, vDeCelda } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';
import type { CajaEnMundo } from './mundo';

/** Qué es cada pieza. Decide de qué color se pinta y en qué malla va. */
export type TipoDePieza =
  /** Los puntales verticales del bastidor, a los dos lados del fondo. */
  | 'montante'
  /** Las traviesas que unen los dos puntales de un bastidor: le dan la forma de escalera. */
  | 'traviesa'
  /** Las vigas horizontales que sostienen los palets, de cuerpo a cuerpo. */
  | 'larguero'
  /** Los apoyos bajo cada posición de palet, cruzando el fondo. */
  | 'apoyo'
  /**
   * La marca vertical que parte un cuerpo en sus DOS posiciones.
   *
   * Es lo único de aquí que no es necesariamente hierro: si en la instalación hay un
   * separador físico o solo una raya pintada depende del almacén. Lo que afirma sí sale del
   * catálogo —`ubicaciones / (cuerpos x niveles)` da 2 en este— y es el dato con el que se
   * trabaja: `RCL47-C018-N01-1` y `RCL47-C018-N01-2` son dos huecos, no uno grande.
   *
   * Hace falta porque desde el pasillo los apoyos se ven DE CANTO —van hacia el fondo— y sin
   * esto un cuerpo de dos posiciones se lee igual que uno de una.
   */
  | 'separador';

export interface Pieza extends CajaEnMundo {
  tipo: TipoDePieza;
}

/** Lado del montante, en metros. Perfil de 100 mm. */
const MONTANTE_M = 0.1;
/** Canto del larguero —lo que mide de alto— y su espesor. */
const LARGUERO_ALTO_M = 0.12;
const LARGUERO_ESPESOR_M = 0.05;
/** Espesor de las traviesas del bastidor y de los apoyos de palet. */
const TRAVIESA_M = 0.05;
const APOYO_M = 0.05;
const APOYO_ALTO_M = 0.04;
/** Espesor del separador entre posiciones. Fino: marca, no estructura. */
const SEPARADOR_M = 0.03;

/**
 * Tope de piezas de toda la escena.
 *
 * El catálogo entero —347 racks como RCL47— da unas 411.000, y hay una prueba que lo mide en
 * vez de fiarse de esta nota. Cinco mallas instanciadas las llevan sin despeinarse: son
 * cinco llamadas de dibujo, y la matriz de cada pieza ocupa 64 bytes, o sea unos 26 MB.
 *
 * El tope está muy por encima —no pegado a los 411.000— por dos razones: para que añadir una
 * pieza más por hueco no lo desborde de golpe, y para que lo que lo dispare sea de verdad un
 * dato absurdo —un rack con 4.000 cuerpos por un error de importación— y no un almacén
 * grande.
 *
 * Cuando se pasa NO se recorta en silencio: no se construye ninguna y quien renderiza vuelve
 * al cajón macizo y lo dice en pantalla. Media estantería dibujada se lee como un almacén
 * raro, no como un aviso.
 */
export const PIEZAS_MAXIMAS = 1_500_000;

const rad = (grados: number): number => (grados * Math.PI) / 180;

/**
 * Del marco local del rack al mundo.
 *
 * `u` cruza el fondo —el eje del ancho—, `v` va a lo largo y `z` sube. La misma
 * correspondencia que usan las placas de los huecos y el punto de una parada; si esta
 * cuenta se separase de aquellas, la estructura y los datos dejarían de coincidir.
 */
function enMundo(
  r: RackEnEscena,
  u: number,
  v: number,
  z: number,
): [number, number, number] {
  const t = rad(r.rotacion);
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  return [r.x + u * cos - v * sen, z, r.y + u * sen + v * cos];
}

/** Las alturas a las que hay largueros: el suelo NO lleva, que el primer nivel se apoya en él. */
export function alturasDeLarguero(r: RackEnEscena): number[] {
  if (r.niveles <= 1 || r.alto <= 0) return [];
  const altoNivel = r.alto / r.niveles;
  return Array.from({ length: r.niveles - 1 }, (_, i) => (i + 1) * altoNivel);
}

/**
 * Las piezas de un rack.
 *
 * Vacío cuando el catálogo no conoce su estructura —`cuerpos = 0`, el rack cuyo código no
 * está importado—. No se inventa una: dibujarle siete niveles a un rack del que no se sabe
 * nada sería afirmar una estructura que nadie ha declarado, y en pantalla se vería idéntica
 * a la de un rack real.
 */
export function estructuraDeRack(r: RackEnEscena): Pieza[] {
  if (r.cuerpos <= 0 || r.niveles <= 0 || r.alto <= 0 || r.largo <= 0) return [];

  const piezas: Pieza[] = [];
  const giroY = -rad(r.rotacion);
  const hl = r.largo / 2;
  const anchoCuerpo = r.largo / r.cuerpos;
  const altoNivel = r.alto / r.niveles;
  const alturas = alturasDeLarguero(r);
  //  Los montantes van pegados a las dos caras del fondo, metidos medio perfil para que la
  //  estructura no sobresalga de la silueta que el resto de vistas dibuja como rack.
  const uLado = Math.max(0, r.ancho / 2 - MONTANTE_M / 2);
  const fondoLibre = Math.max(0.02, r.ancho - MONTANTE_M);

  // ── Bastidores: un par de montantes en cada junta de cuerpos ────────────────
  //
  //  Son `cuerpos + 1` porque hay uno a cada lado de cada cuerpo y el último cierra: 21
  //  cuerpos llevan 22 bastidores. Con `cuerpos` se quedaría el extremo colgando.
  for (let i = 0; i <= r.cuerpos; i += 1) {
    //  Los de las puntas, metidos medio perfil hacia dentro, por lo mismo que los del fondo.
    const bruto = -hl + i * anchoCuerpo;
    const v = Math.min(Math.max(bruto, -hl + MONTANTE_M / 2), hl - MONTANTE_M / 2);

    for (const lado of [1, -1] as const) {
      piezas.push({
        tipo: 'montante',
        posicion: enMundo(r, lado * uLado, v, r.alto / 2),
        escala: [MONTANTE_M, r.alto, MONTANTE_M],
        giroY,
      });
    }

    //  Las traviesas que hacen del par de montantes un bastidor. Se ponen a la altura de
    //  cada larguero y una arriba del todo: es lo que da la lectura de «escalera» que
    //  distingue un rack de una columna, y se ve desde la punta del pasillo.
    for (const z of [...alturas, r.alto]) {
      piezas.push({
        tipo: 'traviesa',
        //  BAJO la cota, no centrada en ella. Centrada, la de arriba del todo asomaba 25 mm
        //  por encima del rack —lo cazó la prueba de la silueta— y las de los niveles
        //  cruzaban por donde va el palet en vez de atarse al larguero.
        posicion: enMundo(r, 0, v, z - TRAVIESA_M / 2),
        escala: [fondoLibre, TRAVIESA_M, TRAVIESA_M],
        giroY,
      });
    }
  }

  // ── Largueros: las vigas que sostienen los palets ───────────────────────────
  const posiciones = posicionesDe(r);
  for (let c = 0; c < r.cuerpos; c += 1) {
    //  Centro GEOMETRICO del cuerpo. No se usa `vDeCelda` aquí a propósito: esa función
    //  responde «dónde cae el cuerpo C001», que depende del giro; un larguero es hierro y
    //  está donde está, se numere como se numere.
    const vCuerpo = -hl + (c + 0.5) * anchoCuerpo;
    //  Y el hueco entre bastidores: el larguero va de junta a junta, sin comerse el perfil.
    const largoLibre = Math.max(0.02, anchoCuerpo - MONTANTE_M);

    for (const z of alturas) {
      for (const lado of [1, -1] as const) {
        piezas.push({
          tipo: 'larguero',
          //  El larguero se apoya SOBRE la cota del nivel: su canto queda por debajo del
          //  palet, no atravesándolo.
          posicion: enMundo(r, lado * uLado, vCuerpo, z - LARGUERO_ALTO_M / 2),
          escala: [LARGUERO_ESPESOR_M, LARGUERO_ALTO_M, largoLibre],
          giroY,
        });
      }
    }
  }

  // ── Los apoyos: DOS por posición, que es lo que hace visibles los dos huecos ─
  //
  //  Entre dos bastidores no hay nada que separe las dos posiciones de un cuerpo —el hueco
  //  es aire— así que sin esto un cuerpo de dos posiciones se ve igual que uno de una. Y la
  //  ubicación se llama `RCL47-C018-N01-2`: ese `-2` es una de las dos, y hay que poder
  //  señalarla.
  //
  //  Son piezas de verdad, no una ayuda visual inventada: los apoyos de palet existen y van
  //  justo ahí, cruzando el fondo bajo cada palet.
  const anchoCelda = anchoCuerpo / posiciones;
  for (let c = 0; c < r.cuerpos; c += 1) {
    for (let n = 0; n < r.niveles; n += 1) {
      //  El nivel `n` se apoya en su cota inferior: el primero en el suelo, el resto en su
      //  larguero.
      const zBase = n * altoNivel;
      for (let p = 0; p < posiciones; p += 1) {
        //  Por la función compartida, para que el apoyo del hueco C001-N01-1 esté donde el
        //  visor pinta ese hueco y donde la parada de un recorrido lo sitúa.
        const v = vDeCelda(r, c, p, posiciones);
        //  Dos por posición, separados como lo estarían bajo un palet.
        for (const s of [-1, 1] as const) {
          piezas.push({
            tipo: 'apoyo',
            posicion: enMundo(r, 0, v + s * anchoCelda * 0.3, zBase + APOYO_ALTO_M / 2),
            escala: [fondoLibre, APOYO_ALTO_M, APOYO_M],
            giroY,
          });
        }

        //  ── Y la marca que separa esta posición de la siguiente ───────────────
        //
        //  Solo entre posiciones, no al final del cuerpo: ahí ya está el bastidor. Con dos
        //  posiciones sale una marca por hueco, que es justo lo que hace que desde el
        //  pasillo se vea que el cuerpo son DOS y no uno.
        if (p < posiciones - 1) {
          //  El borde derecho de esta celda en coordenada local. Se calcula desde su centro
          //  —el que da la función compartida— para que la marca caiga exactamente donde
          //  acaba el hueco que el visor pinta y no medio palet más allá.
          const borde = v + (anchoCelda / 2) * (invierteEste(r) ? -1 : 1);
          piezas.push({
            tipo: 'separador',
            posicion: enMundo(r, 0, borde, zBase + altoNivel / 2),
            escala: [fondoLibre, altoNivel * 0.9, SEPARADOR_M],
            giroY,
          });
        }
      }
    }
  }

  return piezas;
}

/**
 * Si este rack numera sus cuerpos al revés del eje local.
 *
 * Lo necesita el separador: el borde «derecho» de una celda está a un lado o al otro según
 * cómo se recorra, y ponerlo al lado que no es dejaría la marca medio palet corrida — dos
 * marcas juntas en un sitio y ninguna en otro—.
 *
 * Se deduce del propio reparto en vez de reimplementar la regla: se piden dos celdas
 * consecutivas y se mira hacia dónde avanza. Así no hay una segunda copia de
 * `invierteNumeracion` que pueda separarse de la primera.
 */
function invierteEste(r: RackEnEscena): boolean {
  const posiciones = posicionesDe(r);
  //  Con una sola celda no hay separadores, así que el valor da igual.
  if (r.cuerpos * posiciones < 2) return false;
  const a = vDeCelda(r, 0, 0, posiciones);
  const b = posiciones > 1 ? vDeCelda(r, 0, 1, posiciones) : vDeCelda(r, 1, 0, posiciones);
  return b < a;
}

/**
 * Cuántas piezas saldrían de estos racks, SIN construirlas.
 *
 * Sirve para decidir antes de gastar la memoria. Se calcula con la misma aritmética que
 * `estructuraDeRack`, y hay una prueba que compara las dos con racks de distintas formas:
 * si contara de menos, faltarían piezas y el síntoma sería «a los racks del fondo les faltan
 * largueros», que no se parece en nada a su causa.
 */
export function cuantasPiezas(racks: readonly RackEnEscena[]): number {
  let total = 0;
  for (const r of racks) {
    if (r.cuerpos <= 0 || r.niveles <= 0 || r.alto <= 0 || r.largo <= 0) continue;
    const alturas = Math.max(0, r.niveles - 1);
    const bastidores = r.cuerpos + 1;
    total += bastidores * 2; //  montantes
    total += bastidores * (alturas + 1); //  traviesas, una por larguero y otra arriba
    total += r.cuerpos * alturas * 2; //  largueros
    const posiciones = posicionesDe(r);
    total += r.cuerpos * r.niveles * posiciones * 2; //  apoyos
    //  Separadores: uno MENOS que posiciones por celda —el último borde ya es el bastidor—.
    total += r.cuerpos * r.niveles * (posiciones - 1);
  }
  return total;
}
