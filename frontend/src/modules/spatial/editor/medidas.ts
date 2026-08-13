/**
 * DE CUÁNTOS CUERPOS Y NIVELES TIENE UN RACK, A CUÁNTO MIDE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL PROBLEMA QUE ESTO ARREGLA
 *
 * Todos los racks se colocaban con la MISMA medida: 1,1 × 12 × 8,5 m, tuviera 3 cuerpos
 * o 36. En un editor cuyo trabajo es juzgar si una hilera cabe y si el pasillo da, eso es
 * un dibujo que no se puede usar para decidir nada.
 *
 * Y en 3D se nota más que en planta. `MZ01` tiene 27 cuerpos: son unos 36 m de largo, y se
 * dibujaba de 12. Con 8,5 m de alto y 1,1 de fondo, lo que aparece es una lámina vertical
 * — que es exactamente lo que se reportó desde la pantalla: «los racks se ven bien en 2D y
 * en 3D queda una cruz»—.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ESTO SIGUE SIENDO UNA CONVENCIÓN, Y HAY QUE DECIRLO
 *
 * El catálogo espacial **no tiene medidas en metros**: tiene la estructura lógica —rack,
 * cuerpo, nivel, posición— y nada más. Así que los metros de aquí no salen de un
 * levantamiento: salen de dos números declarados abajo.
 *
 * Lo que cambia respecto a antes NO es que ahora sean ciertos, es que ahora son
 * PROPORCIONALES: un rack con el triple de cuerpos se dibuja tres veces más largo, y un
 * rack de 7 niveles más alto que uno de 5. Eso ya permite juzgar una hilera. El tamaño
 * absoluto sigue dependiendo de calibrar el plano, y la pantalla lo advierte.
 *
 * Cualquiera puede corregir un rack a mano en el inspector; esto solo decide con qué
 * medida NACE.
 */

import type { FloorPlanCell } from '../types/index';

/**
 * Ancho de UNA posición de pallet, en metros.
 *
 * Un europalet mide 1,2 m de frente; 1,35 deja el hueco entre bastidores. No es una
 * medida del almacén: es la convención con la que se dibuja hasta que haya levantamiento.
 */
export const ANCHO_POSICION_M = 1.35;

/**
 * Alto de un nivel, en metros.
 *
 * 1,7 m por nivel es lo que da 8,5 m para cinco niveles, que era el alto por omisión que
 * ya usaba el editor. O sea: esto no cambia la altura de un rack de cinco niveles, solo
 * hace que uno de siete sea más alto y uno de tres más bajo.
 */
export const ALTO_NIVEL_M = 1.7;

/** Fondo de un rack de una sola profundidad. Es lo que ya se usaba. */
export const FONDO_M = 1.1;

/** Lo que se usa cuando el catálogo no sabe nada del rack. Las medidas de antes. */
export const LARGO_POR_OMISION_M = 12;
export const ALTO_POR_OMISION_M = 8.5;

export interface MedidasRack {
  /** Fondo, en el eje local X. */
  width: number;
  /** Largo, por donde se suceden los cuerpos. */
  length: number;
  height: number;
}

/**
 * CUÁNTAS POSICIONES TIENE CADA CUERPO.
 *
 * No viene en el catálogo, pero se deduce de lo que sí: `ubicaciones / (cuerpos × niveles)`.
 * Medido en el catálogo real: `MZ01` da 135 / (27 × 5) = 1 exacto, y `RCL47` da
 * 273 / (21 × 7) = 1,86 → 2. Los dos coinciden con lo que el almacén tiene.
 *
 * Se redondea y se acota a [1, 6]: un cociente raro —niveles a cero, un rack a medio
 * importar— no puede producir un rack de 40 m de fondo.
 */
export function posicionesPorCuerpo(cat: FloorPlanCell): number {
  const niveles = cat.maxLevel ?? 0;
  if (cat.bayCount <= 0 || niveles <= 0 || cat.locationCount <= 0) return 1;
  const cociente = cat.locationCount / (cat.bayCount * niveles);
  return Math.min(6, Math.max(1, Math.round(cociente)));
}

/**
 * Las tres medidas con las que nace un rack, sacadas de su estructura.
 *
 * Sin catálogo —un rack colocado cuyo código el backend no conoce— se cae a las medidas de
 * antes en vez de inventar un cero: un rack de lado cero no se puede ni agarrar con el
 * ratón, y desaparecería en 3D sin decir por qué.
 */
export function medidasDe(cat: FloorPlanCell | undefined): MedidasRack {
  if (!cat || cat.bayCount <= 0) {
    return { width: FONDO_M, length: LARGO_POR_OMISION_M, height: ALTO_POR_OMISION_M };
  }
  const niveles = cat.maxLevel ?? 0;
  const anchoCuerpo = posicionesPorCuerpo(cat) * ANCHO_POSICION_M;
  return {
    width: FONDO_M,
    length: Number((cat.bayCount * anchoCuerpo).toFixed(2)),
    height: Number(
      (niveles > 0 ? niveles * ALTO_NIVEL_M : ALTO_POR_OMISION_M).toFixed(2),
    ),
  };
}
