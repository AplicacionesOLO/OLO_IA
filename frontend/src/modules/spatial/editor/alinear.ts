/**
 * ALINEAR Y DISTRIBUIR — geometria pura, sin React ni store.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE QUE SE ALINEA
 *
 * Sobre la CAJA ENVOLVENTE de cada rack, no sobre su centro. Un rack rotado 30°
 * ocupa mas ancho del que dice `width`, y alinear por el centro dejaria sus bordes
 * desparejos — que es justo lo que se ve y lo que se queria arreglar.
 *
 * La referencia es la caja envolvente de la SELECCION COMPLETA. La alternativa era
 * anclar al ultimo rack tocado; se descarto porque obliga a recordar en que orden
 * se hizo clic para saber que va a pasar.
 *
 * ── DISTRIBUIR REPARTE HUECOS, NO CENTROS ───────────────────────────────────
 *
 * Igualar la distancia entre CENTROS es lo que hacen las herramientas de dibujo, y
 * con racks de distinto largo deja pasillos desiguales. En un almacen el hueco ES
 * el pasillo: por eso se igualan los huecos entre cajas y los dos racks de los
 * extremos no se mueven.
 *
 * Los racks bloqueados nunca se mueven, pero SI cuentan para la referencia: si uno
 * esta clavado contra una pared, alinear el resto a esa pared es exactamente lo que
 * se espera.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PositionedRack } from './types';

export interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type CriterioAlineacion =
  | 'izquierda'
  | 'centro-h'
  | 'derecha'
  | 'arriba'
  | 'centro-v'
  | 'abajo';

export type EjeDistribucion = 'horizontal' | 'vertical';

export interface Movimiento {
  layoutId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * Caja envolvente del rack en coordenadas del PLANO (pixeles).
 *
 * Se calcula proyectando los cuatro vertices: para un rectangulo rotado, el ancho
 * de la envolvente es |w·cos| + |l·sen|, y usar `width` a secas subestima el
 * espacio que ocupa.
 */
export function cajaDe(rack: PositionedRack, ppm: number): Caja {
  const w = rack.width * ppm;
  const l = rack.length * ppm;
  const rad = (rack.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sen = Math.abs(Math.sin(rad));
  const semiAncho = (w * cos + l * sen) / 2;
  const semiAlto = (w * sen + l * cos) / 2;
  return {
    x0: rack.x - semiAncho,
    y0: rack.y - semiAlto,
    x1: rack.x + semiAncho,
    y1: rack.y + semiAlto,
  };
}

function envolvente(cajas: Caja[]): Caja {
  return {
    x0: Math.min(...cajas.map((c) => c.x0)),
    y0: Math.min(...cajas.map((c) => c.y0)),
    x1: Math.max(...cajas.map((c) => c.x1)),
    y1: Math.max(...cajas.map((c) => c.y1)),
  };
}

/** Movimientos necesarios para alinear. Los bloqueados no se mueven. */
export function alinear(
  racks: PositionedRack[],
  ppm: number,
  criterio: CriterioAlineacion,
): Movimiento[] {
  if (racks.length < 2) return [];
  const cajas = racks.map((r) => cajaDe(r, ppm));
  const ref = envolvente(cajas);

  const movimientos: Movimiento[] = [];
  racks.forEach((rack, i) => {
    if (rack.locked) return;
    const c = cajas[i]!;
    let x = rack.x;
    let y = rack.y;

    switch (criterio) {
      case 'izquierda':
        x = rack.x + (ref.x0 - c.x0);
        break;
      case 'derecha':
        x = rack.x + (ref.x1 - c.x1);
        break;
      case 'centro-h':
        x = rack.x + ((ref.x0 + ref.x1) / 2 - (c.x0 + c.x1) / 2);
        break;
      case 'arriba':
        y = rack.y + (ref.y0 - c.y0);
        break;
      case 'abajo':
        y = rack.y + (ref.y1 - c.y1);
        break;
      case 'centro-v':
        y = rack.y + ((ref.y0 + ref.y1) / 2 - (c.y0 + c.y1) / 2);
        break;
    }

    if (x !== rack.x || y !== rack.y) {
      movimientos.push({ layoutId: rack.layoutId, from: { x: rack.x, y: rack.y }, to: { x, y } });
    }
  });
  return movimientos;
}

/**
 * Movimientos para repartir el espacio con huecos iguales.
 *
 * Hacen falta TRES: con dos no hay nada que repartir —el hueco entre ellos es el
 * que es— y devolver una lista vacia es mas honesto que fingir un cambio.
 */
export function distribuir(
  racks: PositionedRack[],
  ppm: number,
  eje: EjeDistribucion,
): Movimiento[] {
  if (racks.length < 3) return [];

  const horizontal = eje === 'horizontal';
  const conCaja = racks
    .map((r) => ({ rack: r, caja: cajaDe(r, ppm) }))
    .sort((a, b) => (horizontal ? a.caja.x0 - b.caja.x0 : a.caja.y0 - b.caja.y0));

  const primero = conCaja[0]!;
  const ultimo = conCaja[conCaja.length - 1]!;
  const inicio = horizontal ? primero.caja.x1 : primero.caja.y1;
  const fin = horizontal ? ultimo.caja.x0 : ultimo.caja.y0;

  // Espacio libre = tramo entre los extremos menos lo que ocupan los de en medio.
  const medio = conCaja.slice(1, -1);
  const ocupado = medio.reduce(
    (t, { caja }) => t + (horizontal ? caja.x1 - caja.x0 : caja.y1 - caja.y0),
    0,
  );
  const hueco = (fin - inicio - ocupado) / (medio.length + 1);

  const movimientos: Movimiento[] = [];
  let borde = inicio;
  for (const { rack, caja } of medio) {
    const largo = horizontal ? caja.x1 - caja.x0 : caja.y1 - caja.y0;
    const nuevoInicio = borde + hueco;
    // El desplazamiento se aplica al CENTRO del rack, que es lo que guarda el
    // modelo; la caja solo sirve para medir.
    const desplazamiento = nuevoInicio - (horizontal ? caja.x0 : caja.y0);
    borde = nuevoInicio + largo;

    if (rack.locked || desplazamiento === 0) continue;
    movimientos.push({
      layoutId: rack.layoutId,
      from: { x: rack.x, y: rack.y },
      to: {
        x: horizontal ? rack.x + desplazamiento : rack.x,
        y: horizontal ? rack.y : rack.y + desplazamiento,
      },
    });
  }
  return movimientos;
}
