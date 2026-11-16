/**
 * PLANO MAESTRO DEL CEDI — la distribucion de racks y puertas, en metros, sin three.js.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE ES ESTO Y DE DONDE SALE
 *
 * Es el port del `planRacks` / `buildLayout` del Simulador Proceso 3D (repo
 * `AplicacionesOLO/Simulacion_Proceso_3D`, commit 97c6c9a). La distribucion de los 38 renglones
 * de racks esta transcrita del «Mapa mezzanine N2» (Excel de operaciones): cada renglon es un
 * rack y cada columna una columna del rack. No se inventa ninguna medida —las que no estaban en
 * el plano llevan ⚠ en `GEMELO_CEDI_OLO.md` y son constantes de `constantes.ts` o de este
 * archivo—.
 *
 * Se porta en vez de copiar la tabla del anexo B a mano por una razon: el anexo B es la SALIDA
 * de este calculo, asi que si se transcribiera a mano, una fila mal copiada no tendria como
 * detectarse. Portando el algoritmo, `plano.test.ts` comprueba que la salida coincide con el
 * anexo B del documento, y de paso valida el port.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ES PURO
 *
 * Mismo criterio que `mundo.ts` y `escena.ts`: aritmetica probada con vitest, sin WebGL. Los
 * constructores de `cedi/` consumen este plano y meten los metros en mallas; aqui solo salen
 * numeros.
 */

import {
  FRONT_Z,
  LENGTH,
  MEZZ_FROM_PHYS,
  MEZZ_TO_PHYS,
  OFFICE_COLS,
  OFFICE_W,
  PHYS_FIRST,
  PHYS_LAST,
  RACK_Z0,
  X_EAST,
  X_WEST,
  physX,
} from './constantes';

// ── Categorias del Excel ──────────────────────────────────────────────────────

export type RackCat = 'sobre' | 'orig' | 'menu' | 'zf';

export const RACK_CATS: Record<RackCat, { label: string; color: string; ink: string }> = {
  sobre: { label: 'Sobredimensionado', color: '#70ad47', ink: '#ffffff' },
  orig: { label: 'Originales', color: '#4472c4', ink: '#ffffff' },
  menu: { label: 'Menudencia', color: '#ed7d31', ink: '#ffffff' },
  zf: { label: 'Zona Franca', color: '#f8fafc', ink: '#0f172a' },
};

/**
 * Grilla de columnas a lo profundo: 0 = junto a la fachada … GRID−1 = junto a la linea
 * amarilla. Alcanza para la fila mas larga (32 columnas).
 */
const GRID = 32;
/** Pasillos cruzados (columnas W e I del Excel), contados desde la linea amarilla. */
const CROSS_FROM_LINE = [6, 20];
const CROSS_COLS = CROSS_FROM_LINE.map((n) => GRID - 1 - n);

/** Fondo de una fila de doble fondo, hueco espalda con espalda y ancho del cantilever. */
export const FILA_DEPTH = 2.3;
const FLUE = 0.3;
const CANT_W = 2.7;
const WALL_GAP = 0.5;

// ── Especificacion de cada renglon (en el orden del Excel) ────────────────────

interface FilaSpec {
  fila: number;
  racks: [number, number];
  /** Columnas del rack (incluye los pasos de los pasillos cruzados). */
  cols: number;
  cat: RackCat | null;
  /** Columnas de Menudencia en el extremo de la fachada; el resto en `cat`. */
  menu?: number;
  /** Pegada a la fachada (no a la linea amarilla): del lado de andenes queda una playa a piso. */
  front?: boolean;
  /** Columna C001 que cae en el pasillo cruzado mas cercano a la fachada. */
  bridgeAt?: number;
  /** Numero de la columna del extremo de andenes (por defecto C001). */
  c1?: number;
}

const F = (
  fila: number,
  racks: [number, number],
  cols: number,
  cat: RackCat | null,
  menu?: number,
): FilaSpec => ({ fila, racks, cols, cat, ...(menu != null ? { menu } : {}) });

export type PlayaKind = 'despacho' | 'chequeo';

/** Pegada a la fachada: conserva la numeracion del mapa (la C028 en la fachada). */
const front = (f: FilaSpec): FilaSpec => ({ ...f, front: true, c1: 28 - f.cols + 1 });

type Spec =
  | { t: 'single'; f: FilaSpec; wall?: -1 | 1; zfStart?: boolean }
  | { t: 'pair'; a: FilaSpec; b: FilaSpec; office?: boolean; playa?: PlayaKind }
  | { t: 'cant'; name: string; from: number; to: number }
  | {
      t: 'floor';
      label: string;
      cat: RackCat | null;
      boxes: { w: number; from: number; to: number }[];
      gap: number;
      fromLine?: boolean;
    };

const SPECS: Spec[] = [
  { t: 'single', f: F(1, [1, 2], 28, null), wall: -1 },
  { t: 'cant', name: 'C1', from: 0, to: 21 },
  { t: 'cant', name: 'C2', from: 0, to: 21 },
  {
    t: 'floor',
    label: 'PISO',
    cat: null,
    boxes: [
      { w: 6.9, from: 0, to: 21 },
      { w: 8.05, from: 0, to: 19 },
    ],
    gap: 1.15,
    fromLine: true,
  },
  { t: 'pair', a: { ...F(2, [603, 602], 18, 'sobre'), bridgeAt: 12 }, b: { ...F(3, [601, 600], 18, 'sobre'), bridgeAt: 12 } },
  { t: 'pair', a: front(F(4, [3, 4], 21, 'sobre')), b: front(F(5, [5, 6], 21, 'sobre')), playa: 'despacho' },
  { t: 'pair', a: front(F(6, [7, 8], 21, 'sobre')), b: front(F(7, [9, 10], 21, 'sobre')), playa: 'despacho' },
  { t: 'pair', a: F(8, [11, 12], 28, 'sobre'), b: F(9, [13, 14], 28, 'orig') },
  { t: 'pair', a: F(10, [15, 16], 28, 'orig'), b: F(11, [17, 18], 28, 'orig') },
  { t: 'pair', a: F(12, [19, 20], 28, 'orig'), b: F(13, [21, 22], 28, 'orig') },
  { t: 'pair', a: F(14, [23, 24], 28, 'orig'), b: F(15, [25, 26], 28, 'orig', 7) },
  { t: 'pair', a: F(16, [27, 28], 28, 'orig', 7), b: F(17, [29, 30], 28, 'orig') },
  { t: 'pair', a: front(F(18, [31, 32], 21, 'orig')), b: front(F(19, [33, 34], 21, 'orig')), playa: 'chequeo' },
  { t: 'pair', a: F(20, [35, 36], 28, 'orig'), b: F(21, [37, 38], 28, 'orig') },
  { t: 'pair', a: F(22, [39, 40], 20, 'orig'), b: F(23, [41, 42], 20, 'orig'), office: true },
  { t: 'pair', a: F(24, [43, 44], 20, 'orig'), b: F(25, [45, 46], 20, 'orig'), office: true },
  { t: 'pair', a: F(26, [47, 48], 20, 'orig'), b: F(27, [49, 50], 20, 'orig'), office: true },
  { t: 'pair', a: F(28, [51, 52], 20, 'orig'), b: F(29, [53, 54], 20, 'orig'), office: true },
  { t: 'pair', a: front(F(30, [55, 56], 28, 'orig')), b: front(F(31, [57, 58], 28, 'orig')) },
  { t: 'single', f: front(F(32, [59, 60], 28, 'orig')) },
  { t: 'single', f: F(33, [61, 62], 28, 'zf'), zfStart: true },
  { t: 'floor', label: 'AZF', cat: 'zf', boxes: [{ w: 4.6, from: 0, to: 5 }], gap: 0 },
  { t: 'pair', a: F(34, [63, 64], 28, 'zf'), b: F(35, [65, 66], 28, 'zf') },
  { t: 'pair', a: F(36, [67, 68], 28, 'zf'), b: F(37, [69, 70], 28, 'zf') },
  { t: 'single', f: F(38, [71, 72], 32, 'zf'), wall: 1 },
];

const pad = (n: number): string => String(n).padStart(3, '0');

// ── El plano ya ubicado ───────────────────────────────────────────────────────

export interface PlacedFila {
  fila: number;
  racks: [number, number];
  x0: number;
  x1: number;
  /** Lado que da al pasillo: −1 = x menor, 1 = x mayor, 0 = ambos. */
  face: -1 | 0 | 1;
  /** Columnas de la grilla (0 = fachada). */
  from: number;
  to: number;
  /** Columnas de la grilla que son paso de pasillo cruzado (solo los niveles de arriba). */
  tunnels: number[];
  /** Tramos de color (columnas inclusive). */
  segs: { from: number; to: number; cat: RackCat | null }[];
  cat: RackCat | null;
  /** Racks blancos (Zona Franca). */
  white: boolean;
  code: string;
  /** Numero de columna (C001…) en el extremo `to` (lado de andenes). */
  c1: number;
}

/** Numero de columna del inventario (C001 …) para una columna de la grilla. */
export const filaColNumber = (f: PlacedFila, g: number): number => f.c1 + (f.to - g);
/** Columna de la grilla de un numero de columna del inventario. */
export const filaGrid = (f: PlacedFila, n: number): number => f.to - (n - f.c1);
/** Cantilever: 11 posiciones de 2 columnas, la C001 del lado de andenes. */
export const cantColNumber = (to: number, g: number): number => Math.floor((to - g) / 2) + 1;
/** Nombre del cantilever (la nomenclatura es CANT, no RCL). */
export const cantCode = (name: string): string => `CANT ${name}A · ${name}B`;

export interface RackLayout {
  /** Largo de una columna (m, a lo profundo). */
  col: number;
  /** z del borde de la columna 0 del lado de la fachada. */
  zFront: number;
  filas: PlacedFila[];
  cants: { name: string; x: number; from: number; to: number }[];
  floors: {
    label: string;
    cat: RackCat | null;
    boxes: { x0: number; x1: number; from: number; to: number }[];
  }[];
  /** Pasillos cruzados (columnas I y W): columna de la grilla y tramo en x que recorren. */
  cross: { c: number; x0: number; x1: number }[];
  /** Oficinas / Comedor: de la fachada a `zFace`, entre x0 y x1. */
  office: { x0: number; x1: number; zFace: number };
  /** Linea de la division de Zona Franca. */
  zfLineX: number;
  /** Playas a piso del lado de andenes (columnas de la grilla). */
  playas: { kind: PlayaKind; x0: number; x1: number; from: number; to: number }[];
  /** Centros de pasillo con racks (para los montacargas). */
  aisles: number[];
  /** Taller de equipos: contra la fachada, en el tramo de la zona a piso; abierto hacia andenes. */
  workshop: { x: number; z: number };
}

/** z (lado de la fachada) del inicio de la columna `c` de la grilla. */
export function colZ(plan: RackLayout, c: number): number {
  return plan.zFront + c * plan.col;
}

function placeFila(f: FilaSpec, x0: number, face: -1 | 0 | 1, wall: boolean): PlacedFila {
  const to = f.bridgeAt ? Math.min(...CROSS_COLS) + f.bridgeAt - 1 : f.front ? f.cols - 1 : GRID - 1;
  const from = to - f.cols + 1;
  const segs: PlacedFila['segs'] = f.menu
    ? [
        { from, to: from + f.menu - 1, cat: 'menu' },
        { from: from + f.menu, to, cat: f.cat },
      ]
    : [{ from, to, cat: f.cat }];
  return {
    fila: f.fila,
    racks: f.racks,
    x0,
    x1: x0 + FILA_DEPTH,
    face,
    from,
    to,
    // Las filas contra la pared no tienen paso: el pasillo cruzado termina en ellas.
    tunnels: wall ? [] : CROSS_COLS.filter((c) => c >= from && c < to),
    segs,
    cat: f.cat,
    white: f.cat === 'zf',
    code: `RCL${pad(f.racks[0])} · ${pad(f.racks[1])}`,
    c1: f.c1 ?? 1,
  };
}

const widthOf = (s: Spec): number =>
  s.t === 'single'
    ? FILA_DEPTH
    : s.t === 'pair'
      ? 2 * FILA_DEPTH + FLUE
      : s.t === 'cant'
        ? CANT_W
        : s.boxes.reduce((a, b) => a + b.w, 0) + s.gap * (s.boxes.length - 1);

/**
 * Ubica el plan de racks en el edificio (coordenadas logicas). `frontZ` = fachada, `rackZ0` =
 * la linea amarilla del pasillo transversal, donde arrancan los racks.
 */
export function planRacks(
  xWest: number,
  xEast: number,
  frontZ: number,
  rackZ0: number,
): RackLayout {
  const zFront = frontZ + 1.3;
  const col = (rackZ0 - zFront) / GRID;
  const start = xWest + 0.3 + WALL_GAP;
  const inner = xEast - 0.3 - WALL_GAP - start;
  const fixed = SPECS.reduce((a, s) => a + widthOf(s), 0);
  const aisle = Math.min(4.5, Math.max(2.0, (inner - fixed) / (SPECS.length - 1)));

  const filas: PlacedFila[] = [];
  const cants: RackLayout['cants'] = [];
  const floors: RackLayout['floors'] = [];
  const aisles: number[] = [];
  let office: { x0: number; x1: number } | null = null;
  let zfLineX = xEast;
  let workshopX = (xWest + xEast) / 2;
  let prevRack = false;
  const playas: RackLayout['playas'] = [];

  let x = start;
  SPECS.forEach((s, i) => {
    const w = widthOf(s);
    // La fila del fondo va contra la pared.
    if (s.t === 'single' && s.wall === 1) x = Math.max(x, xEast - 0.3 - WALL_GAP - w);
    const isRack = s.t === 'single' || s.t === 'pair';
    if (i > 0) {
      const ac = x - aisle / 2;
      if (prevRack || isRack) aisles.push(ac);
      if (s.t === 'single' && s.zfStart) zfLineX = ac;
    }
    if (s.t === 'single') {
      filas.push(placeFila(s.f, x, s.wall ? ((-s.wall) as -1 | 1) : 0, !!s.wall));
    } else if (s.t === 'pair') {
      filas.push(placeFila(s.a, x, -1, false), placeFila(s.b, x + FILA_DEPTH + FLUE, 1, false));
      if (s.office) office = { x0: office?.x0 ?? x, x1: x + w };
      if (s.playa) {
        const last = playas[playas.length - 1];
        const fromCol = Math.max(s.a.cols, s.b.cols);
        if (last && last.kind === s.playa) last.x1 = x + w;
        else playas.push({ kind: s.playa, x0: x, x1: x + w, from: fromCol, to: GRID - 1 });
      }
    } else if (s.t === 'cant') {
      cants.push({ name: s.name, x: x + w / 2, from: s.from, to: s.to });
    } else {
      let bx = x;
      floors.push({
        label: s.label,
        cat: s.cat,
        boxes: s.boxes.map((b) => {
          const n = b.to - b.from + 1;
          const out = {
            x0: bx,
            x1: bx + b.w,
            from: s.fromLine ? GRID - n : b.from,
            to: s.fromLine ? GRID - 1 : b.to,
          };
          bx += b.w + s.gap;
          return out;
        }),
      });
      if (s.label === 'PISO') workshopX = x + w / 2;
    }
    prevRack = isRack;
    x += w + aisle;
  });

  // Pasillos cruzados: de la primera fila que los tiene hasta la fila contra la pared del fondo.
  const eastWall = filas[filas.length - 1]!;
  const cross = CROSS_COLS.map((c) => {
    const withIt = filas.filter((f) => f.tunnels.includes(c));
    return {
      c,
      x0: Math.min(...withIt.map((f) => f.x0)),
      x1: Math.max(...withIt.map((f) => f.x1), eastWall.x0),
    };
  });

  const o = office ?? { x0: (xWest + xEast) / 2 - 15, x1: (xWest + xEast) / 2 + 15 };
  return {
    col,
    zFront,
    filas,
    cants,
    floors,
    cross,
    playas,
    office: { ...o, zFace: zFront + OFFICE_COLS * col - 0.6 },
    zfLineX,
    aisles,
    workshop: { x: workshopX, z: frontZ + 0.6 },
  };
}

// ── El plano del CEDI, ensamblado con las constantes maestras ──────────────────

/** Una puerta fisica de la pared de andenes. */
export interface PuertaFisica {
  phys: number;
  x: number;
}

export interface PlanoCedi {
  length: number;
  xWest: number;
  xEast: number;
  /** Las 37 puertas fisicas (02 … 38). */
  puertas: PuertaFisica[];
  /** Tramo en x del mezzanine (andenes fisicos 10 a 27). */
  mezzanine: { x0: number; x1: number };
  /** Centro del bloque Oficinas / Comedor, referencia del edificio de oficinas. */
  officeX: number;
  racks: RackLayout;
}

/**
 * Arma el plano completo del CEDI a partir de las constantes maestras.
 *
 * No necesita datos de andenes en vivo: la geometria del sitio es la del documento, fija. Los
 * andenes del sistema (que puerta corresponde a cada `01xx`) son cosa del catalogo y no de esta
 * geometria —el gemelo dibuja las 37 puertas con su numero fisico, siempre—.
 */
export function construirPlano(): PlanoCedi {
  const puertas: PuertaFisica[] = [];
  for (let p = PHYS_FIRST; p <= PHYS_LAST; p += 1) puertas.push({ phys: p, x: physX(p) });

  const mezzanine = {
    x0: physX(MEZZ_FROM_PHYS) - 4.6 / 2,
    x1: physX(MEZZ_TO_PHYS) + 4.6 / 2,
  };

  const racks = planRacks(X_WEST, X_EAST, FRONT_Z, RACK_Z0);
  const officeCenter = (racks.office.x0 + racks.office.x1) / 2;

  return {
    length: LENGTH,
    xWest: X_WEST,
    xEast: X_EAST,
    puertas,
    mezzanine,
    officeX: officeCenter + OFFICE_W / 4,
    racks,
  };
}
