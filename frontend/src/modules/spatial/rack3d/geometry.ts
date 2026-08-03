/**
 * GEOMETRIA DEL RACK — construida de los datos, no del codigo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS GEOMETRIAS DISTINTAS, Y SOLO UNA FALTA
 *
 *   A · INTERNA del rack:  cuerpo → nivel → posicion → ubicacion
 *       **YA EXISTE** en la respuesta del backend. Basta para dibujar el rack.
 *
 *   B · GLOBAL en el almacen:  metros, rotacion, sitio en el plano
 *       Requiere levantamiento CAD. `world_position` esta al 100% NULL.
 *
 * Que falte B no impide dibujar A, y tratarlo como si lo impidiera fue el error
 * que dejo el modulo sin representacion grafica. Un rack de 7 niveles se dibuja
 * con 7 alturas hoy; donde esta ese rack dentro del edificio es otra pregunta.
 *
 * ── EL MODELO ANTERIOR PARSEABA EL CODIGO ───────────────────────────────────
 *
 * `engine/RackModel.ts` tenia `parseLocationCode('RCL01-C001-N05-2')` y deducia
 * la estructura de la cadena. Eso esta prohibido (ADR-013) y ya no hace falta: el
 * endpoint devuelve `bayIndex`, `level` y `position` como CAMPOS. Con 2 ubicaciones
 * de codigo opaco en el catalogo real, el parser habria producido basura en tres
 * columnas.
 *
 * Aqui la estructura sale de `bayIndex`/`level`/`position` y de `bayCount`,
 * `maxLevel`, `maxPosition` — los limites tambien los da el backend, no un `max()`
 * sobre las celdas presentes. Es lo que permite distinguir «existe y esta libre»
 * de «no existe»: 3.866 tripletas del catalogo tienen UNA sola posicion cuando el
 * rack admite mas, y **no se inventan posiciones hermanas**.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { RackFrontCell, RackFrontView } from '../types/index';

// ── Unidades del mundo local ────────────────────────────────────────────────
//
// Sin escala metrica: son unidades arbitrarias coherentes entre si. La proyeccion
// las convierte a pixeles. Llamarlas «metros» seria exactamente la confusion que
// TWN-07 prohibe.
export const CELL_W = 30; // ancho de una posicion, eje X (cuerpo)
/**
 * Alto de un nivel, eje Y.
 *
 * Subido de 22 a 38: un nivel es MAS ALTO que ancha una posicion —del orden de
 * 1,6 m frente a 1,2 m— y con 22 contra 30 la celda salia apaisada, que es la
 * proporcion contraria a la de un rack real. La consecuencia visual era que un
 * cuerpo de 2 posiciones se leia igual que 2 niveles.
 */
export const CELL_H = 38;
/**
 * Profundidad de una posicion, eje Z.
 *
 * Subida de 18 a 26. Con 18 y el acortamiento del eje Z la cara superior medía 8 px
 * a zoom 1: por debajo de lo que se lee como volumen, y de ahi «las ubicaciones
 * parecen un bloque continuo». 26 da ~18 px de cara superior sin que la
 * profundidad compita con la altura del nivel (22).
 */
export const CELL_D = 26;
export const BAY_GAP = 8; // separacion entre cuerpos
/** Grosor del poste. Se dibuja como VOLUMEN, no como linea de 1 px. */
export const POST_W = 3.4;
/** Canto de la viga horizontal. */
export const BEAM_H = 2.8;

/** Distancia a la que se colocan las etiquetas de nivel, a la izquierda del rack. */
export const LABEL_LEAD = 34;
/** Distancia a la que se colocan las etiquetas de cuerpo, por debajo del rack. */
export const LABEL_DROP = 13;

/** Una celda de la rejilla: exista o no como ubicacion declarada. */
export interface RackCellSlot {
  bayIndex: number;
  level: number;
  position: number;
  /** `null` cuando la combinacion geometrica NO es una ubicacion del catalogo. */
  cell: RackFrontCell | null;
  /**
   * Coordenadas del mundo local. `y` crece hacia ARRIBA y `z` hacia el FONDO:
   * `z = 0` es el plano que mira al pasillo, donde esta la posicion 1.
   */
  x: number;
  y: number;
  z: number;
}

export interface RackGeometry {
  rackId: string;
  rackCode: string;
  bayIndices: number[];
  maxLevel: number;
  maxPosition: number;
  slots: RackCellSlot[];
  /** Celdas declaradas: `slots.filter(s => s.cell)`, precalculado. */
  declaredCount: number;
  /** Combinaciones de la rejilla sin ubicacion declarada. */
  undeclaredCount: number;
  /**
   * Ubicaciones del rack SIN coordenada logica completa.
   *
   * No se dibujan en la rejilla y **no se les inventa el nivel 1**: aparecen en
   * su propia seccion. Con `code_form = 'opaque'` el backend no garantiza `level`
   * ni `position`, y colocarlas en la rejilla las pondria en un sitio falso.
   */
  withoutCoordinates: RackFrontCell[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

/** Clave de una celda de la rejilla. */
function slotKey(bay: number, level: number, position: number): string {
  return `${bay}|${level}|${position}`;
}

/** Ancho total de un cuerpo en el eje X. */
export function bayWidth(geo: Pick<RackGeometry, 'maxPosition'>): number {
  return geo.maxPosition * CELL_W;
}

/** X inicial de la columna `n` del rack. */
export function bayOriginX(geo: Pick<RackGeometry, 'maxPosition'>, columna: number): number {
  return columna * (bayWidth(geo) + BAY_GAP);
}

/**
 * Profundidad total del rack: del plano del pasillo al fondo.
 *
 * ⚠ UNA sola profundidad de celda, no una por posicion.
 *
 *   La version anterior desplazaba la posicion en X **y** en Z: la posicion 2 salia a
 *   la derecha Y detras de la 1. Eso afirma dos cosas a la vez y una de ellas no esta
 *   en los datos — `logicalPosition` es un indice, y el backend no dice si numera a lo
 *   ancho del cuerpo o en profundidad.
 *
 *   El desplazamiento en X ya distingue las posiciones, asi que el de Z solo añadia
 *   una afirmacion sin respaldo. Y ademas costaba legibilidad: cada cuerpo salia
 *   escalonado, con la posicion del fondo asomando entre niveles, y un rack de 27
 *   cuerpos se leia como una sierra.
 */
export function rackDepth(_geo?: Pick<RackGeometry, 'maxPosition'>): number {
  return CELL_D;
}

/** Altura total del rack. */
export function rackHeight(geo: Pick<RackGeometry, 'maxLevel'>): number {
  return geo.maxLevel * CELL_H;
}

/**
 * Construye la rejilla completa del rack a partir de la respuesta del backend.
 *
 * `bayCount`, `maxLevel` y `maxPosition` los da el backend, asi que el marco se
 * conoce ANTES de recorrer las celdas. Esa es la diferencia que permite dibujar
 * los huecos que el catalogo no declara.
 */
export function buildRackGeometry(view: RackFrontView): RackGeometry {
  const porCelda = new Map<string, RackFrontCell>();
  const cuerpos = new Set<number>();
  const sinCoordenadas: RackFrontCell[] = [];

  for (const c of view.cells) {
    // Sin nivel o sin posicion no hay sitio en la rejilla. Se aparta en lugar de
    // colocarla en un nivel inventado.
    if (c.level == null || c.position == null) {
      sinCoordenadas.push(c);
      continue;
    }
    porCelda.set(slotKey(c.bayIndex, c.level, c.position), c);
    cuerpos.add(c.bayIndex);
  }

  const bayIndices = [...cuerpos].sort((a, b) => a - b);
  const maxLevel = view.maxLevel ?? 1;
  const maxPosition = view.maxPosition ?? 1;
  const dims = { maxLevel, maxPosition };

  const slots: RackCellSlot[] = [];
  let declaradas = 0;

  bayIndices.forEach((bay, columna) => {
    // `columna` y no `bay`: los indices de cuerpo pueden no ser contiguos —un rack
    // puede tener C001 y C003 sin C002— y usar el indice como posicion dejaria un
    // hueco visual donde no hay estructura.
    const baseX = bayOriginX(dims, columna);

    for (let level = 1; level <= maxLevel; level += 1) {
      for (let position = 1; position <= maxPosition; position += 1) {
        const cell = porCelda.get(slotKey(bay, level, position)) ?? null;
        if (cell) declaradas += 1;
        slots.push({
          bayIndex: bay,
          level,
          position,
          cell,
          x: baseX + (position - 1) * CELL_W,
          // El nivel 1 abajo: `y` crece hacia arriba y la proyeccion lo invierte.
          y: (level - 1) * CELL_H,
          // Todas las posiciones en el plano del PASILLO. La posicion se distingue
          // por X, y afirmar ademas que unas estan detras de otras seria inventar un
          // dato que `logicalPosition` no contiene. Ver `rackDepth()`.
          z: 0,
        });
      }
    }
  });

  const xs = slots.map((s) => s.x);
  const ys = slots.map((s) => s.y);
  const zs = slots.map((s) => s.z);

  return {
    rackId: view.rackId,
    rackCode: view.rackCode,
    bayIndices,
    maxLevel,
    maxPosition,
    slots,
    declaredCount: declaradas,
    undeclaredCount: slots.length - declaradas,
    withoutCoordinates: sinCoordenadas,
    bounds: {
      minX: Math.min(0, ...xs),
      maxX: Math.max(CELL_W, ...xs.map((x) => x + CELL_W)),
      minY: Math.min(0, ...ys),
      maxY: Math.max(CELL_H, ...ys.map((y) => y + CELL_H)),
      minZ: Math.min(0, ...zs),
      maxZ: Math.max(CELL_D, ...zs.map((z) => z + CELL_D)),
    },
  };
}

// ── Proyeccion axonometrica ─────────────────────────────────────────────────
//
// No hay Three.js en el proyecto —26 dependencias, ninguna grafica— y añadirlo
// costaria ~600 KB de bundle para dibujar cajas. Una axonometria sobre Canvas 2D
// da la lectura tridimensional con las mismas primitivas que ya se usan.
//
// Es una proyeccion DIMETRICA: el eje Z se inclina y se acorta, de modo que
// profundidad y altura no se confunden. Con isometrica pura (30°/30°) un cuerpo de
// 2 posiciones se lee igual que 2 niveles, que es justo la ambigüedad a evitar.
//
// ⚠ EL SIGNO DE Z EN `sy` ESTABA INVERTIDO
//
//   La version anterior hacia `sy = -y + z·sen(28°)`: la profundidad crecia hacia
//   ABAJO-derecha. Esa direccion de fuga situa la camara POR DEBAJO del rack, y con
//   la camara debajo la cara superior de una caja no es visible — la funcion que se
//   llamaba `projectCellTop` dibujaba en realidad la cara inferior.
//
//   Sin cara superior no hay volumen, y de ahi los tres sintomas reportados: los
//   niveles parecian planos, la profundidad desaparecia y las ubicaciones se leian
//   como un bloque continuo. Con `sy = -y - z·sen(28°)` la fuga va hacia
//   ARRIBA-derecha, la camara queda arriba-derecha-delante y se ven las tres caras
//   que definen una caja: frontal, superior y lateral derecha.

const Z_COS = Math.cos((28 * Math.PI) / 180);
const Z_SIN = Math.sin((28 * Math.PI) / 180);
/**
 * El eje Z se dibuja al 78%: la profundidad debe leerse, pero no competir con la
 * altura. Con 0,62 el acortamiento sumado a un `CELL_D` de 18 dejaba la cara
 * superior por debajo del umbral en que se percibe como cara.
 */
const Z_SCALE = 0.78;

export interface Projected {
  sx: number;
  sy: number;
}

/**
 * Mundo local → plano de proyeccion.
 *
 * `sy` INVIERTE `y`: en el mundo `y` crece hacia arriba (nivel 1 abajo) y en
 * pantalla crece hacia abajo. Sin esa inversion el rack sale del reves, con el
 * suelo arriba, y un alzado con el suelo arriba no es un alzado.
 */
export function project(x: number, y: number, z: number): Projected {
  return {
    sx: x + z * Z_COS * Z_SCALE,
    sy: -y - z * Z_SIN * Z_SCALE,
  };
}

/** Cuanto se desplaza en pantalla una unidad de profundidad. */
export const DEPTH_SHIFT = { sx: Z_COS * Z_SCALE, sy: -Z_SIN * Z_SCALE };

// ── Una celda es un HUECO, no un rectangulo ─────────────────────────────────
//
// El modelo anterior dibujaba la celda como una caja que SOBRESALE: cara frontal en
// el plano del pasillo, y caras superior y lateral saliendo hacia el fondo. Con la
// rejilla completa eso no da volumen, y no por un error de calculo: la cara superior
// de una celda queda tapada por la celda de encima, y la lateral por la de al lado.
// Solo la fila de arriba y la columna del extremo mostraban su volumen. Las 340
// interiores se veian planas, y adyacentes del mismo color se fundian en un bloque —
// que es literalmente el sintoma reportado.
//
// Un rack no es una pared de cajas: es un bastidor con HUECOS. Asi que la celda se
// modela como un nicho:
//
//        hueco (z)            cara con color (z + CELL_RECESS)          fondo
//     ┌─────────────┐              ┌───────────┐
//     │  ╲          │   pared      │           │      canto tenue del fondo
//     │   ╲_________│   izquierda  │           │      (z + CELL_D)
//     │   │         │   y suelo     └───────────┘
//     └───┴─────────┘   del nicho
//
// Las paredes visibles de un hueco son la IZQUIERDA y el SUELO —las contrarias a las
// de una caja que sobresale— porque la camara esta arriba-derecha-delante. Esas dos
// bandas viven DENTRO del hueco, asi que ninguna celda vecina las puede tapar: cada
// ubicacion muestra su propio volumen, tenga vecinos o no.

/** Cuanto se hunde la cara con color respecto al plano del pasillo. */
export const CELL_RECESS = 7;
/** Holgura de la cara dentro de su hueco. Es lo que separa una celda de la vecina. */
export const CELL_INSET = { x: 1.5, y: 1.3 };

function rect(slot: RackCellSlot, z: number): Projected[] {
  const x0 = slot.x + CELL_INSET.x;
  const x1 = slot.x + CELL_W - CELL_INSET.x;
  const y0 = slot.y + CELL_INSET.y;
  const y1 = slot.y + CELL_H - CELL_INSET.y;
  // Orden [arribaIzq, arribaDer, abajoDer, abajoIzq], que es el que espera `faceBand`.
  return [project(x0, y1, z), project(x1, y1, z), project(x1, y0, z), project(x0, y0, z)];
}

/** Boca del hueco, en el plano del pasillo. Solo canto: es el borde del bastidor. */
export function projectCellOpening(slot: RackCellSlot): Projected[] {
  return rect(slot, slot.z);
}

/** Cara con el color del estado, hundida dentro del hueco. */
export function projectCellFace(slot: RackCellSlot): Projected[] {
  return rect(slot, slot.z + CELL_RECESS);
}

/** Fondo del hueco. Solo canto, nunca relleno: da la tercera profundidad. */
export function projectCellBack(slot: RackCellSlot): Projected[] {
  return rect(slot, slot.z + CELL_D);
}

/** Pared IZQUIERDA del hueco. Vertical, en sombra. */
export function projectCellWallLeft(slot: RackCellSlot): Projected[] {
  const boca = projectCellOpening(slot);
  const cara = projectCellFace(slot);
  return [boca[0]!, cara[0]!, cara[3]!, boca[3]!];
}

/** SUELO del hueco. Horizontal, asi que es la que recibe la luz. */
export function projectCellWallFloor(slot: RackCellSlot): Projected[] {
  const boca = projectCellOpening(slot);
  const cara = projectCellFace(slot);
  return [boca[3]!, cara[3]!, cara[2]!, boca[2]!];
}

/**
 * Sub-rectangulo de una cara, en fraccion de su altura.
 *
 * Sirve para el «charco de luz» del material holografico: una banda mas opaca en
 * la base de la celda. Se resuelve interpolando los vertices en lugar de crear un
 * `CanvasGradient` por celda — 374 gradientes por fotograma es un coste que no
 * hace falta pagar para dos tonos.
 *
 * La cara llega como `[arribaIzq, arribaDer, abajoDer, abajoIzq]`.
 */
export function faceBand(face: Projected[], desde: number, hasta: number): Projected[] {
  const [ai, ad, bd, bi] = face as [Projected, Projected, Projected, Projected];
  const lerp = (a: Projected, b: Projected, t: number): Projected => ({
    sx: a.sx + (b.sx - a.sx) * t,
    sy: a.sy + (b.sy - a.sy) * t,
  });
  return [lerp(ai, bi, desde), lerp(ad, bd, desde), lerp(ad, bd, hasta), lerp(ai, bi, hasta)];
}

// ── Estructura del rack: postes, vigas y travesaños ─────────────────────────
//
// Los postes son la REFERENCIA VISUAL PRINCIPAL, asi que no son lineas: son
// volumenes de `POST_W` de ancho, con su canto iluminado. Y se separan en dos
// grupos porque el orden de pintado es la oclusion:
//
//   · `back*`  se dibuja ANTES de las celdas → queda detras, tenue
//   · `front*` se dibuja DESPUES de las celdas → cruza por delante
//
// Ese cruce por delante es lo que convierte un conjunto de cajas de color en una
// estanteria: el operador ve el bastidor delante de la carga, como en el almacen.

export interface RackFrames {
  /** Postes del plano del fondo. */
  backPosts: Projected[][];
  /** Vigas del plano del fondo, una por frontera de nivel. */
  backBeams: Projected[][];
  /** Travesaños de profundidad, del frente al fondo. Se dibujan punteados. */
  depthRails: [Projected, Projected][];
  /** Postes del plano del pasillo. */
  frontPosts: Projected[][];
  /** Vigas del plano del pasillo. */
  frontBeams: Projected[][];
}

function quadXY(x0: number, x1: number, y0: number, y1: number, z: number): Projected[] {
  return [project(x0, y1, z), project(x1, y1, z), project(x1, y0, z), project(x0, y0, z)];
}

function quadXZ(x0: number, x1: number, y: number, z0: number, z1: number): Projected[] {
  return [project(x0, y, z0), project(x1, y, z0), project(x1, y, z1), project(x0, y, z1)];
}

export function buildFrames(geo: RackGeometry): RackFrames {
  const f: RackFrames = {
    backPosts: [],
    backBeams: [],
    depthRails: [],
    frontPosts: [],
    frontBeams: [],
  };
  const alto = rackHeight(geo);
  const zFondo = rackDepth(geo);
  const ancho = bayWidth(geo);

  geo.bayIndices.forEach((_, columna) => {
    const x0 = bayOriginX(geo, columna);
    const x1 = x0 + ancho;

    // Cuatro postes por cuerpo, en las esquinas, como volumen.
    for (const x of [x0, x1]) {
      f.frontPosts.push(quadXY(x - POST_W / 2, x + POST_W / 2, 0, alto, 0));
      f.backPosts.push(quadXY(x - POST_W / 2, x + POST_W / 2, 0, alto, zFondo));
    }

    // Una viga por frontera de nivel: `maxLevel + 1` incluye el suelo y el remate.
    for (let n = 0; n <= geo.maxLevel; n += 1) {
      const y = n * CELL_H;
      f.frontBeams.push(
        quadXY(x0 - POST_W / 2, x1 + POST_W / 2, y - BEAM_H / 2, y + BEAM_H / 2, 0),
      );
      f.backBeams.push(
        quadXY(x0 - POST_W / 2, x1 + POST_W / 2, y - BEAM_H / 2, y + BEAM_H / 2, zFondo),
      );
      for (const x of [x0, x1]) {
        f.depthRails.push([project(x, y, 0), project(x, y, zFondo)]);
      }
    }
  });

  return f;
}

// ── Piso tecnico ────────────────────────────────────────────────────────────

export interface FloorGrid {
  /** Fronteras de cuerpo. Mas visibles: son la referencia de conteo. */
  major: [Projected, Projected][];
  /** Subdivision por posicion y por profundidad. Muy tenue. */
  minor: [Projected, Projected][];
  /** Contorno de la huella del rack, para asentarlo. */
  outline: Projected[];
}

/**
 * Rejilla de ingenieria en el plano del suelo (`y = 0`).
 *
 * Su unico trabajo es dar una referencia de profundidad: sin ella, dos cajas a
 * distinta z se leen como dos cajas a distinta altura. Se dibuja al 8-12% de
 * opacidad porque debe ayudar a leer el rack, no competir con el.
 */
export function buildFloorGrid(geo: RackGeometry): FloorGrid {
  const major: [Projected, Projected][] = [];
  const minor: [Projected, Projected][] = [];

  const ancho = bayWidth(geo);
  const zFondo = rackDepth(geo);
  // Margen corto a proposito: el piso ES la referencia de profundidad, no un
  // decorado. Con margen amplio, el encuadre reservaba mas de 100 px a rejilla vacia
  // y empujaba el rack fuera del centro.
  const xIni = -CELL_W * 0.4;
  const xFin = bayOriginX(geo, geo.bayIndices.length - 1) + ancho + CELL_W * 0.4;
  const zIni = -CELL_D * 0.45;
  const zFin = zFondo + CELL_D * 0.7;

  // Lineas en Z: una por frontera de cuerpo (major) y una por posicion (minor).
  geo.bayIndices.forEach((_, columna) => {
    const x0 = bayOriginX(geo, columna);
    major.push([project(x0, 0, zIni), project(x0, 0, zFin)]);
    major.push([project(x0 + ancho, 0, zIni), project(x0 + ancho, 0, zFin)]);
    for (let p = 1; p < geo.maxPosition; p += 1) {
      const x = x0 + p * CELL_W;
      minor.push([project(x, 0, zIni), project(x, 0, zFin)]);
    }
  });

  // Lineas en X: los dos planos del rack —pasillo y fondo— como principales, y una
  // subdivision entre medias para que la profundidad tenga escala.
  for (const z of [zIni, 0, zFondo, zFin]) {
    major.push([project(xIni, 0, z), project(xFin, 0, z)]);
  }
  for (const z of [zIni / 2, zFondo / 2, zFondo + (zFin - zFondo) / 2]) {
    minor.push([project(xIni, 0, z), project(xFin, 0, z)]);
  }

  return {
    major,
    minor,
    outline: quadXZ(
      -POST_W,
      bayOriginX(geo, geo.bayIndices.length - 1) + ancho + POST_W,
      0,
      0,
      zFondo,
    ),
  };
}

// ── Guias de nivel ──────────────────────────────────────────────────────────

/**
 * Linea horizontal completa por cada frontera de nivel, prolongada hacia la
 * izquierda hasta la zona de etiquetas.
 *
 * Es lo que permite «seguir una linea horizontal completa» desde la etiqueta N0x
 * hasta el ultimo cuerpo del rack. Sin la prolongacion, la etiqueta flota.
 */
export function buildLevelGuides(geo: RackGeometry): [Projected, Projected][] {
  const xFin = bayOriginX(geo, geo.bayIndices.length - 1) + bayWidth(geo);
  const guias: [Projected, Projected][] = [];
  for (let n = 0; n <= geo.maxLevel; n += 1) {
    const y = n * CELL_H;
    guias.push([project(-LABEL_LEAD, y, 0), project(xFin, y, 0)]);
  }
  return guias;
}

/** Ancla de la etiqueta N0x: centrada en la banda del nivel, en el plano frontal. */
export function levelLabelAnchor(level: number): Projected {
  return project(-LABEL_LEAD + 6, (level - 1) * CELL_H + CELL_H / 2, 0);
}

/**
 * Ancla de la etiqueta C0xx.
 *
 * `z` en el CENTRO de la profundidad, no en el plano frontal: con la fuga
 * axonometrica, una etiqueta en `z = 0` cae bajo la primera posicion y no bajo el
 * centro del cuerpo. Es exactamente el desalineamiento reportado.
 */
export function bayLabelAnchor(geo: RackGeometry, columna: number): Projected {
  return project(
    bayOriginX(geo, columna) + bayWidth(geo) / 2,
    -LABEL_DROP,
    rackDepth(geo) / 2,
  );
}

/**
 * Rectangulo de lo que se dibuja EN EL MUNDO, para encuadrar la camara.
 *
 * Incluye la estructura y el piso, no solo las celdas: encuadrar por las celdas
 * dejaba los postes del fondo fuera del area visible.
 *
 * NO incluye las etiquetas. Su tamaño es en PIXELES —no escala con el zoom— asi que
 * meterlas en un rectangulo del mundo reserva un hueco que a zoom bajo sobra y a
 * zoom alto no llega. El sitio de las etiquetas es el margen en pixeles del
 * encuadre (`PAD` en el visor), y ahi si es constante.
 */
export function projectedBounds(geo: RackGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const pts: Projected[] = [];
  for (const s of geo.slots) {
    pts.push(...projectCellOpening(s), ...projectCellBack(s));
  }
  const piso = buildFloorGrid(geo);
  for (const [a, b] of [...piso.major, ...piso.minor]) pts.push(a, b);

  if (pts.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return {
    minX: Math.min(...pts.map((p) => p.sx)),
    maxX: Math.max(...pts.map((p) => p.sx)),
    minY: Math.min(...pts.map((p) => p.sy)),
    maxY: Math.max(...pts.map((p) => p.sy)),
  };
}

/** Extremos del rack en X proyectada, sin piso ni etiquetas. Para la barra de recorrido. */
export function rackSpanX(geo: RackGeometry): { desde: number; hasta: number } {
  const xFin = bayOriginX(geo, geo.bayIndices.length - 1) + bayWidth(geo);
  return { desde: project(0, 0, 0).sx, hasta: project(xFin, 0, rackDepth(geo)).sx };
}

// ── Orden de dibujo ─────────────────────────────────────────────────────────

/**
 * Ordena las celdas del FONDO hacia el FRENTE (painter's algorithm).
 *
 * Sin z-buffer, el orden de pintado ES la oclusion. Con la fuga hacia
 * arriba-derecha, `z` mayor esta mas LEJOS, asi que se dibuja primero. A igual
 * profundidad manda la ALTURA: la cara superior de una celda invade 8 px de la banda
 * de la celda de encima, asi que la de abajo va antes o la taparia.
 *
 * Hoy todas las celdas comparten `z = 0` —ver `rackDepth()`— asi que el criterio que
 * actua es el de altura. El de profundidad se conserva porque el dia que el backend
 * declare posiciones en profundidad, el orden ya sera el correcto.
 */
export function sortForPainting(slots: RackCellSlot[]): RackCellSlot[] {
  return [...slots].sort((a, b) => {
    if (a.z !== b.z) return b.z - a.z; // lo lejano primero
    if (a.y !== b.y) return a.y - b.y; // a igual z, lo bajo primero
    return a.x - b.x;
  });
}

// ── Hit testing ─────────────────────────────────────────────────────────────

/**
 * Que celda hay bajo un punto del plano proyectado.
 *
 * Recorre en orden INVERSO al de pintado: lo dibujado encima tiene prioridad, que
 * es lo que el usuario ve y por tanto lo que espera seleccionar.
 *
 * Solo devuelve celdas DECLARADAS: una posicion que el catalogo no declara no es
 * seleccionable, porque no hay ubicacion que abrir.
 */
export function hitTest(
  painted: RackCellSlot[],
  px: number,
  py: number,
): RackCellSlot | null {
  for (let i = painted.length - 1; i >= 0; i -= 1) {
    const s = painted[i]!;
    if (!s.cell) continue;
    if (pointInPolygon(px, py, projectCellFace(s))) return s;
  }
  return null;
}

function pointInPolygon(px: number, py: number, poly: Projected[]): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    const cruza = a.sy > py !== b.sy > py;
    if (cruza && px < ((b.sx - a.sx) * (py - a.sy)) / (b.sy - a.sy) + a.sx) {
      dentro = !dentro;
    }
  }
  return dentro;
}
