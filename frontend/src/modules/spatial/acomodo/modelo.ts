/**
 * MODELO DEL ACOMODO — una sola fuente para dibujarlo en 2D, 3D y 3D+.
 *
 * El acomodo del «Mapa mezzanine N2» vive en `webgl/cedi/plano.ts`, pero alli sale como
 * mallas de three.js (lo consume el 3D+). Las vistas 2D (Canvas) y 3D (axonometrico)
 * necesitan el MISMO acomodo como geometria plana en metros, no como mallas. Este modulo
 * lo traduce UNA vez a rectangulos en metros —agnosticos del renderer— para que las tres
 * vistas pinten exactamente lo mismo con la nomenclatura `RCL…` / `C0xx`.
 *
 * Ejes: `x` = profundidad (el fondo de la fila, ~2,3 m) · `y` = a lo largo de las columnas
 * (el eje z de `plano.ts`, via `colZ`). Es el marco de PLANTA que usan 2D y 3D.
 */

import {
  RACK_CATS,
  type RackCat,
  cantCode,
  colZ,
  construirPlano,
  filaColNumber,
  type PlacedFila,
  type RackLayout,
} from '../webgl/cedi/plano';

/** Color de relleno + tinta de un rotulo, por categoria (gris neutro si no la tiene). */
function colorCat(cat: RackCat | null): { fill: string; ink: string } {
  if (cat) return { fill: RACK_CATS[cat].color, ink: RACK_CATS[cat].ink };
  return { fill: '#475569', ink: '#e2e8f0' };
}

/** Categoria de una columna concreta, segun los segmentos de la fila. */
function catDeColumna(f: PlacedFila, c: number): RackCat | null {
  for (const s of f.segs) if (c >= s.from && c <= s.to) return s.cat;
  return f.cat;
}

/** Una columna de una fila: su celda en planta y su numero `C0xx`. */
export interface CeldaAcomodo {
  y0: number;
  y1: number;
  n: number;
  fill: string;
  ink: string;
}

/** Una fila (modulo) del acomodo, como rectangulo en metros. */
export interface FilaAcomodo {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Etiqueta del modulo (`RCL01 · 02`), para mostrar. */
  code: string;
  /**
   * Los DOS racks reales del doble fondo, por su numero de catalogo: `racks[0]` es el frente
   * (lado `x0`) y `racks[1]` el fondo (lado `x1`). Con ellos se arma el codigo real `RCL{n}`
   * que el backend conoce y se puede publicar.
   */
  racks: [number, number];
  fill: string;
  ink: string;
  celdas: CeldaAcomodo[];
}

/** Un cantilever, como franja fina. */
export interface CantAcomodo {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  code: string;
  fill: string;
  ink: string;
}

/** Una zona a piso (PISO, AZF). */
export interface ZonaAcomodo {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  label: string;
  fill: string;
  ink: string;
}

export interface LimitesAcomodo {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ModeloAcomodo {
  filas: FilaAcomodo[];
  cants: CantAcomodo[];
  floors: ZonaAcomodo[];
  limites: LimitesAcomodo;
  /** Alto nominal de un rack en metros (para el 3D). */
  alto: number;
}

/** Ancho nominal (en metros) con que se dibuja un cantilever, que en `plano.ts` es una linea. */
const CANT_ANCHO = 1.6;
/** Alto nominal de la estanteria en metros (coincide con `POSTE_H` de `racks.ts`). */
const ALTO_RACK = 9.2;

let cache: ModeloAcomodo | null = null;

/** El acomodo en metros, listo para dibujar. Se calcula una vez y se reutiliza. */
export function modeloAcomodo(): ModeloAcomodo {
  if (cache) return cache;

  const plan: RackLayout = construirPlano().racks;
  const col = plan.col;

  const filas: FilaAcomodo[] = plan.filas.map((f) => {
    const { fill, ink } = colorCat(f.cat);
    const celdas: CeldaAcomodo[] = [];
    for (let c = f.from; c <= f.to; c += 1) {
      const cc = colorCat(catDeColumna(f, c));
      celdas.push({
        y0: colZ(plan, c),
        y1: colZ(plan, c) + col,
        n: filaColNumber(f, c),
        fill: cc.fill,
        ink: cc.ink,
      });
    }
    return {
      x0: f.x0,
      x1: f.x1,
      y0: colZ(plan, f.from),
      y1: colZ(plan, f.to + 1),
      code: f.code,
      racks: f.racks,
      fill,
      ink,
      celdas,
    };
  });

  const cants: CantAcomodo[] = plan.cants.map((c) => {
    const { fill, ink } = colorCat('zf');
    return {
      x0: c.x - CANT_ANCHO / 2,
      x1: c.x + CANT_ANCHO / 2,
      y0: colZ(plan, c.from),
      y1: colZ(plan, c.to + 1),
      code: cantCode(c.name),
      fill,
      ink,
    };
  });

  const floors: ZonaAcomodo[] = [];
  for (const fl of plan.floors) {
    const { fill, ink } = colorCat(fl.cat);
    for (const b of fl.boxes) {
      floors.push({
        x0: b.x0,
        x1: b.x1,
        y0: colZ(plan, b.from),
        y1: colZ(plan, b.to + 1),
        label: fl.label,
        fill,
        ink,
      });
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const abarcar = (x0: number, x1: number, y0: number, y1: number): void => {
    minX = Math.min(minX, x0, x1);
    maxX = Math.max(maxX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxY = Math.max(maxY, y0, y1);
  };
  for (const f of filas) abarcar(f.x0, f.x1, f.y0, f.y1);
  for (const c of cants) abarcar(c.x0, c.x1, c.y0, c.y1);
  for (const fl of floors) abarcar(fl.x0, fl.x1, fl.y0, fl.y1);

  cache = {
    filas,
    cants,
    floors,
    limites: { minX, maxX, minY, maxY },
    alto: ALTO_RACK,
  };
  return cache;
}
