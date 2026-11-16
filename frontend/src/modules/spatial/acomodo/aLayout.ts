/**
 * EL ACOMODO → LAYOUT EDITABLE Y PUBLICABLE.
 *
 * Convierte el acomodo del «Mapa mezzanine N2» (de `modelo.ts`, en metros) en los racks del
 * editor (`PositionedRack[]`, en pixeles de plano). Cada fila es un DOBLE FONDO: dos racks
 * reales `RCL{a}` (frente, lado x0) y `RCL{b}` (fondo, lado x1), con el codigo REAL del
 * catalogo —se verifico que `RCL01…RCL72` y `RCL600…RCL603` existen—, de modo que el layout
 * se puede PUBLICAR (el backend vincula cada posicion a su `rack_id` por el codigo).
 *
 * 38 filas × 2 = 76 racks. Los dos de una fila comparten `grupoId` para moverse juntos (si no,
 * mover uno partiria el doble fondo). Al volcarlo al store, las tres vistas (2D, 3D, 3D+) leen
 * el mismo arreglo: mover en una se ve en todas.
 *
 * Ejes (ver `modelo.ts`): `x` = profundidad del doble fondo (~2,3 m) · `y` = a lo largo de las
 * columnas. Sin giro.
 */

import { worldToPlan, type CalibrationTransform } from '../editor/transforms';
import type { PositionedRack } from '../editor/types';
import { modeloAcomodo } from './modelo';

/** Codigo real del catalogo: `RCL` + numero con 2 digitos minimo (RCL01, RCL72, RCL600). */
export function codigoRCL(n: number): string {
  return `RCL${String(n).padStart(2, '0')}`;
}

/** Genera los 76 racks reales del editor a partir del acomodo, en el marco de plano dado. */
export function acomodoARacks(
  ppm: number,
  origen: { x: number; y: number },
  rotation = 0,
): PositionedRack[] {
  const m = modeloAcomodo();
  const ct: CalibrationTransform = {
    pixelsPerMeter: ppm,
    originX: origen.x,
    originY: origen.y,
    rotation,
  };
  const alto = m.alto;

  const racks: PositionedRack[] = [];
  const empujar = (
    code: string,
    grupoId: string,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    color: string,
  ): void => {
    const centro = worldToPlan({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, ct);
    racks.push({
      layoutId: `acomodo-${code}`,
      rackCode: code,
      x: centro.x,
      y: centro.y,
      width: Math.abs(x1 - x0),
      length: Math.abs(y1 - y0),
      height: alto,
      rotation,
      locked: false,
      linked: true,
      color,
      grupoId,
    });
  };

  m.filas.forEach((f, i) => {
    const mid = (f.x0 + f.x1) / 2;
    const grupo = `acomodo-fila-${i}`;
    // Frente (lado x0) y fondo (lado x1): los dos racks reales del doble fondo.
    empujar(codigoRCL(f.racks[0]), grupo, f.x0, mid, f.y0, f.y1, f.fill);
    empujar(codigoRCL(f.racks[1]), grupo, mid, f.x1, f.y0, f.y1, f.fill);
  });

  return racks;
}
