/**
 * ESCENA DEL CLUSTER — el almacen entero en axonometria, en METROS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NO ES `rack3d/geometry.ts` CON MAS RACKS
 *
 * `rack3d` dibuja UN rack por dentro: cuerpo, nivel, posicion, hueco a hueco. Su
 * cabecera lo dice y sigue siendo verdad, pero su mundo no sirve aqui, y no por
 * falta de generalidad:
 *
 *   · TRABAJA EN UNIDADES ARBITRARIAS. `CELL_W = 30` no son metros y su propio
 *     comentario advierte que llamarlas metros seria la confusion que TWN-07
 *     prohibe. Un cluster tiene que estar en metros: las distancias ENTRE racks
 *     son la mitad de la informacion, y un pasillo de 3,20 m tiene que medir eso.
 *
 *   · SU CAMARA ES FIJA. Para un rack basta: se mira de frente. Un almacen de
 *     112 m hay que poder girarlo, porque desde un solo angulo las hileras del
 *     fondo quedan detras de las del frente y no hay forma de ver el pasillo.
 *
 *   · DIBUJA 29.310 HUECOS. Uno por ubicacion. A escala de almacen eso son 29.310
 *     poligonos por fotograma para una nave que en pantalla mide 900 px: cada
 *     hueco caeria en menos de un pixel. Aqui cada rack es un CUERPO con bandas
 *     de nivel y divisiones de cuerpo, que es lo que se distingue a esa escala.
 *
 * Asi que son dos representaciones de dos cosas distintas —el rack y el almacen—
 * y este modulo es la segunda. Para ver un rack por dentro se sigue abriendo
 * `Rack3DView`, y este avisa de cual esta seleccionado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA PROYECCION, Y POR QUE ES AFIN
 *
 * Axonometria: se gira el mundo alrededor del eje vertical (azimut) y se aplana
 * con un escorzo constante (elevacion). NO hay perspectiva, y es deliberado: en
 * perspectiva dos racks iguales miden distinto segun donde esten, y esta vista se
 * usa para juzgar distancias. Es la misma razon por la que un plano de arquitecto
 * es axonometrico y un renderizado comercial no.
 *
 *     rx = x·cosθ − y·senθ                (giro por el azimut)
 *     ry = x·senθ + y·cosθ
 *     sx =  rx·Z
 *     sy = (ry·cosφ − z·senφ)·Z           (escorzo por la elevacion)
 *
 * Que sea LINEAL tiene una consecuencia que se aprovecha: el plano del suelo
 * (z = 0) se transforma con una matriz afin, y `ctx.setTransform` acepta
 * exactamente eso. Asi que la imagen del plano se puede dibujar como suelo de la
 * escena SIN deformarla a mano ni trocearla: es el mismo plano que el operador
 * calibro, tumbado. Con perspectiva habria hecho falta trocear el bitmap.
 *
 * `ry` sirve ademas de profundidad para el orden de pintado: crece hacia el
 * observador, asi que se pinta de menor a mayor y lo cercano tapa lo lejano.
 */

import type { PositionedRack } from '../editor/types';
import { COLOR_RACK_POR_DEFECTO } from '../editor/types';
import type { FloorPlanCell } from '../types/index';

// ── Camara ──────────────────────────────────────────────────────────────────

export interface Camara {
  /** Giro alrededor del eje vertical, en grados. 0 mira el plano como se dibujo. */
  azimut: number;
  /**
   * Inclinacion, en grados. 90 seria mirar desde arriba —una planta, sin volumen—
   * y 0 seria un alzado, donde todo el almacen se solapa en una linea. Se acota a
   * [12, 82] porque los dos extremos dejan la escena ilegible.
   */
  elevacion: number;
  /** Pixeles por metro. */
  escala: number;
  /** Desplazamiento en pantalla, en pixeles. */
  panX: number;
  panY: number;
}

export const CAMARA_INICIAL: Camara = {
  // 30°: suficiente para que las hileras paralelas al eje X dejen ver el pasillo,
  // sin llegar a 45° donde las dos direcciones del plano se vuelven simetricas y
  // no se distingue el largo del ancho.
  azimut: 30,
  elevacion: 34,
  escala: 8,
  panX: 0,
  panY: 0,
};

export const ELEVACION_MIN = 12;
export const ELEVACION_MAX = 82;
export const ESCALA_MIN = 0.6;
export const ESCALA_MAX = 120;

const rad = (grados: number): number => (grados * Math.PI) / 180;

export interface Punto {
  sx: number;
  sy: number;
}

/** Cosenos y senos de la camara, calculados una vez por fotograma. */
export interface Base {
  cosA: number;
  senA: number;
  cosE: number;
  senE: number;
  escala: number;
  panX: number;
  panY: number;
}

export function baseDe(cam: Camara): Base {
  return {
    cosA: Math.cos(rad(cam.azimut)),
    senA: Math.sin(rad(cam.azimut)),
    cosE: Math.cos(rad(cam.elevacion)),
    senE: Math.sin(rad(cam.elevacion)),
    escala: cam.escala,
    panX: cam.panX,
    panY: cam.panY,
  };
}

/** Mundo (metros) → pantalla (pixeles). */
export function proyectar(b: Base, x: number, y: number, z: number): Punto {
  const rx = x * b.cosA - y * b.senA;
  const ry = x * b.senA + y * b.cosA;
  return {
    sx: rx * b.escala + b.panX,
    sy: (ry * b.cosE - z * b.senE) * b.escala + b.panY,
  };
}

/**
 * Pantalla → SUELO del mundo (z = 0), en metros. La inversa exacta de `proyectar`.
 *
 * Es lo que permite ARRASTRAR racks en la vista 3D. Durante un tiempo la edicion en
 * 3D estuvo deshabilitada con el argumento de que arrastrar en axonometria es mover
 * en dos ejes sin saber en cual. Ese argumento no aguanta: la proyeccion es lineal,
 * asi que restringida al plano z = 0 es una biyeccion y el punto del suelo bajo el
 * cursor es UNO. La ambigüedad existiria solo para el movimiento vertical, y un rack
 * no se mueve en vertical: esta en el suelo.
 *
 *     sx = ( x·cosθ − y·senθ)·Z + panX
 *     sy = ( x·senθ + y·cosθ)·cosφ·Z + panY        (con z = 0)
 *
 * Deshaciendo la escala y el desplazamiento queda un giro puro, que se invierte con
 * su transpuesta. Sin iteraciones y sin aproximar.
 *
 * `cosφ` no puede ser cero porque la elevacion esta acotada a 82°: mirando desde el
 * cenit exacto el suelo se veria de canto y la inversa no existiria.
 */
export function sueloEn(b: Base, sx: number, sy: number): { x: number; y: number } {
  const u = (sx - b.panX) / b.escala;
  const v = (sy - b.panY) / (b.escala * b.cosE);
  return {
    x: u * b.cosA + v * b.senA,
    y: -u * b.senA + v * b.cosA,
  };
}

/** Profundidad de un punto del mundo. Crece hacia el observador. */
export function profundidad(b: Base, x: number, y: number): number {
  return x * b.senA + y * b.cosA;
}

/**
 * Matriz afin que lleva PIXELES DEL PLANO al suelo de la escena.
 *
 * Se le pasa a `ctx.setTransform` y luego se dibuja la imagen en (0,0) a su tamaño
 * natural: el navegador hace el resto con interpolacion. Es exacto —no una
 * aproximacion— porque la proyeccion del plano z = 0 es afin.
 */
export function matrizDelSuelo(
  b: Base,
  ppm: number,
  origen: { x: number; y: number },
): [number, number, number, number, number, number] {
  const k = b.escala / ppm;
  const a = k * b.cosA;
  const bb = k * b.cosE * b.senA;
  const c = -k * b.senA;
  const d = k * b.cosE * b.cosA;
  // El origen del plano en pixeles cae en el (0,0) del mundo, así que la
  // traslación es la que compensa haberlo restado.
  const e = b.panX - (a * origen.x + c * origen.y);
  const f = b.panY - (bb * origen.x + d * origen.y);
  return [a, bb, c, d, e, f];
}

// ── El rack como cuerpo ─────────────────────────────────────────────────────

export interface RackEnEscena {
  layoutId: string;
  rackCode: string;
  /**
   * UUID del rack en el backend, o `null` si el catalogo no conoce este codigo.
   *
   * Hace falta porque las observaciones referencian el rack por UUID —el codigo es
   * unico por almacen, no globalmente— asi que cruzar la ruta con la escena por
   * codigo funcionaria hoy y fallaria el dia que dos almacenes compartan pantalla.
   */
  rackId: string | null;
  /** Centro en metros. */
  x: number;
  y: number;
  rotacion: number;
  ancho: number;
  largo: number;
  alto: number;
  color: string;
  /** Cuerpos del rack, del catalogo. `0` si el backend no lo conoce. */
  cuerpos: number;
  /** Niveles del rack, del catalogo. `0` si no se conoce. */
  niveles: number;
  /** Ubicaciones declaradas. Solo informativo: aqui no se dibujan una a una. */
  ubicaciones: number;
  /** Grupo al que pertenece segun el criterio de agrupacion activo. */
  grupo: string;
  /** Si esta bloqueado. Se dibuja distinto y el arrastre lo rechaza CON aviso. */
  bloqueado: boolean;
}

export type CriterioColor = 'rack' | 'familia' | 'cluster' | 'altura' | 'ocupacion';

/**
 * ESCALA DE OCUPACION. Del vacio al lleno, en cinco tramos.
 *
 * Cinco y no un degradado continuo: a simple vista nadie distingue el 61 % del 66 %,
 * y un degradado invita a intentarlo. Cinco tramos se leen de un vistazo y cada uno
 * significa algo que se puede decir en voz alta —«vacio», «medio», «lleno»—.
 *
 * El color de «sin dato» es GRIS y no verde: un rack sin inventario no esta vacio,
 * es que nadie ha subido lo que tiene. Pintarlo de vacio afirmaria algo sobre el
 * almacen que no se ha comprobado.
 */
export const ESCALA_OCUPACION: ReadonlyArray<{ hasta: number; color: string; etiqueta: string }> = [
  { hasta: 0, color: '#3f4d63', etiqueta: 'vacio' },
  { hasta: 25, color: '#34d399', etiqueta: 'hasta 25 pct' },
  { hasta: 50, color: '#a3e635', etiqueta: '25 a 50' },
  { hasta: 75, color: '#fbbf24', etiqueta: '50 a 75' },
  { hasta: 95, color: '#fb923c', etiqueta: '75 a 95' },
  { hasta: 100, color: '#f87171', etiqueta: 'mas de 95' },
];

/** Gris para «no hay dato». Distinto de «vacio», que es una medida. */
export const COLOR_SIN_OCUPACION = '#5b6474';

/** El color que corresponde a un porcentaje, o el gris si no hay dato. */
export function colorDeOcupacion(pct: number | null | undefined): string {
  if (pct == null) return COLOR_SIN_OCUPACION;
  for (const tramo of ESCALA_OCUPACION) {
    if (pct <= tramo.hasta) return tramo.color;
  }
  return ESCALA_OCUPACION[ESCALA_OCUPACION.length - 1]!.color;
}

/** Prefijo alfabetico del codigo. Mismo criterio que el arbol del explorador. */
export function familiaDe(codigo: string): string {
  const m = /^[A-Z]+/.exec(codigo);
  return m ? m[0] : codigo;
}

/**
 * Compone la escena: colocacion (del editor) × estructura interna (del backend).
 *
 * Es la union que da sentido a F3. El editor sabe DONDE esta cada rack porque
 * alguien lo puso ahi; el backend sabe QUE ES cada rack —36 cuerpos, 5 niveles—
 * porque lo trae el catalogo del WMS. Ninguno de los dos puede dibujar el almacen
 * solo: sin la colocacion no hay sitio, y sin la estructura un rack de 36 cuerpos
 * y uno de 3 se verian igual.
 *
 * Un rack colocado cuyo codigo el backend no conoce SE DIBUJA, con `cuerpos = 0`.
 * No se descarta: esta ahi porque alguien lo puso, y hacerlo desaparecer del 3D
 * sin decir nada convertiria un error de nomenclatura en un rack invisible.
 */
export function componerEscena(
  racks: readonly PositionedRack[],
  ppm: number,
  origen: { x: number; y: number },
  catalogo: readonly FloorPlanCell[],
  grupos: ReadonlyMap<string, string>,
): RackEnEscena[] {
  const porCodigo = new Map<string, FloorPlanCell>();
  for (const c of catalogo) porCodigo.set(c.rackCode, c);

  return racks.map((r) => {
    const cat = porCodigo.get(r.rackCode);
    return {
      layoutId: r.layoutId,
      rackCode: r.rackCode,
      rackId: cat?.rackId ?? null,
      x: (r.x - origen.x) / ppm,
      y: (r.y - origen.y) / ppm,
      rotacion: r.rotation,
      ancho: r.width,
      largo: r.length,
      alto: r.height,
      color: r.color ?? COLOR_RACK_POR_DEFECTO,
      cuerpos: cat?.bayCount ?? 0,
      niveles: cat?.maxLevel ?? 0,
      ubicaciones: cat?.locationCount ?? 0,
      grupo: grupos.get(r.layoutId) ?? familiaDe(r.rackCode),
      bloqueado: r.locked,
    };
  });
}

/** Las cuatro esquinas de la base, en metros y en orden antihorario. */
export function esquinas(r: RackEnEscena): { x: number; y: number }[] {
  const cos = Math.cos(rad(r.rotacion));
  const sen = Math.sin(rad(r.rotacion));
  const hl = r.largo / 2;
  const ha = r.ancho / 2;
  return [
    [-hl, -ha],
    [hl, -ha],
    [hl, ha],
    [-hl, ha],
  ].map(([u, v]) => ({
    x: r.x + u! * cos - v! * sen,
    y: r.y + u! * sen + v! * cos,
  }));
}

/**
 * Caras visibles de un rack, ya proyectadas y en orden de pintado.
 *
 * De las cuatro laterales solo se dibujan las que MIRAN al observador. No es una
 * optimizacion: dibujar las cuatro pinta las de detras encima de las de delante
 * —el orden dentro de un mismo cuerpo no lo arregla el painter's algorithm— y el
 * rack sale con las aristas del fondo cruzándolo.
 */
export interface CarasRack {
  /** Laterales visibles, de la mas lejana a la mas cercana. */
  laterales: { puntos: Punto[]; /** Cara larga (frente/trasera) o corta (testero). */ larga: boolean }[];
  /** Cara superior. Siempre visible con elevacion > 0. */
  techo: Punto[];
  /** Silueta completa, para el hit-testing y el realce. */
  silueta: Punto[];
  /** Profundidad del centro, para ordenar los racks entre si. */
  z: number;
}

export function carasDe(b: Base, r: RackEnEscena): CarasRack {
  const base = esquinas(r);
  const abajo = base.map((p) => proyectar(b, p.x, p.y, 0));
  const arriba = base.map((p) => proyectar(b, p.x, p.y, r.alto));

  const laterales: CarasRack['laterales'] = [];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    // Una cara mira al observador si su normal apunta hacia el. En la proyeccion
    // eso equivale al signo del producto cruzado de la arista de la base con la
    // vertical de pantalla: si la arista va de izquierda a derecha en pantalla, su
    // cara exterior queda de cara.
    const dx = abajo[j]!.sx - abajo[i]!.sx;
    if (dx <= 0) continue;
    laterales.push({
      puntos: [abajo[i]!, abajo[j]!, arriba[j]!, arriba[i]!],
      // Los lados 0 y 2 son los largos; 1 y 3 los testeros.
      larga: i % 2 === 0,
    });
  }
  // De atras hacia delante: la cara con menor profundidad media se pinta primero.
  laterales.sort((p, q) => media(p.puntos) - media(q.puntos));

  return {
    laterales,
    techo: arriba,
    silueta: siluetaDe(abajo, arriba),
    z: profundidad(b, r.x, r.y),
  };
}

function media(ps: Punto[]): number {
  return ps.reduce((a, p) => a + p.sy, 0) / ps.length;
}

/** Envolvente convexa de las 8 esquinas proyectadas. Sirve de diana y de realce. */
function siluetaDe(abajo: Punto[], arriba: Punto[]): Punto[] {
  const ps = [...abajo, ...arriba];
  // Andrew's monotone chain. Ocho puntos: el coste es irrelevante y evita el caso
  // en que el rack se ve casi de canto y la silueta degenera en un poligono
  // cruzado, que rompe el hit-testing.
  const orden = [...ps].sort((a, b) => a.sx - b.sx || a.sy - b.sy);
  const cruz = (o: Punto, a: Punto, c: Punto): number =>
    (a.sx - o.sx) * (c.sy - o.sy) - (a.sy - o.sy) * (c.sx - o.sx);
  const media1: Punto[] = [];
  for (const p of orden) {
    while (media1.length >= 2 && cruz(media1[media1.length - 2]!, media1[media1.length - 1]!, p) <= 0) {
      media1.pop();
    }
    media1.push(p);
  }
  const media2: Punto[] = [];
  for (const p of [...orden].reverse()) {
    while (media2.length >= 2 && cruz(media2[media2.length - 2]!, media2[media2.length - 1]!, p) <= 0) {
      media2.pop();
    }
    media2.push(p);
  }
  media1.pop();
  media2.pop();
  return [...media1, ...media2];
}

/** ¿Cae el punto de pantalla dentro del poligono? Ray casting. */
export function dentro(poligono: Punto[], sx: number, sy: number): boolean {
  let hit = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const a = poligono[i]!;
    const c = poligono[j]!;
    if (
      a.sy > sy !== c.sy > sy &&
      sx < ((c.sx - a.sx) * (sy - a.sy)) / (c.sy - a.sy) + a.sx
    ) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * El rack bajo el cursor, o `null`.
 *
 * Se prueba del MAS CERCANO al mas lejano: si dos racks se solapan en pantalla, el
 * que se toca es el que se ve, no el que esta detras.
 */
export function rackEn(
  b: Base,
  escena: readonly RackEnEscena[],
  sx: number,
  sy: number,
): RackEnEscena | null {
  const conCaras = escena.map((r) => ({ r, caras: carasDe(b, r) }));
  conCaras.sort((p, q) => q.caras.z - p.caras.z);
  for (const { r, caras } of conCaras) {
    if (dentro(caras.silueta, sx, sy)) return r;
  }
  return null;
}

// ── Encuadre ────────────────────────────────────────────────────────────────

/**
 * Las cuatro esquinas del plano, en metros. Sirven para encuadrar el suelo.
 *
 * Existe porque el encuadre solo miraba los racks, y con el plano cargado y ningun
 * rack colocado todavia —que es como empieza SIEMPRE una sesion— la camara se
 * quedaba en su posicion por defecto y el plano aparecia pegado a una esquina; al
 * girar, se salia del lienzo y la pantalla quedaba en negro sin ningun aviso, porque
 * tecnicamente no habia nada que avisar.
 */
export function esquinasDelSuelo(
  ppm: number,
  origen: { x: number; y: number },
  plan: { width: number; height: number } | null,
): { x: number; y: number }[] {
  if (!plan || ppm <= 0) return [];
  return [
    [0, 0],
    [plan.width, 0],
    [plan.width, plan.height],
    [0, plan.height],
  ].map(([px, py]) => ({ x: (px! - origen.x) / ppm, y: (py! - origen.y) / ppm }));
}

/**
 * Camara que mete toda la escena en el lienzo.
 *
 * Se calcula proyectando con escala 1 y sin desplazamiento, midiendo la caja
 * resultante y despejando. Iterar «prueba y ajusta» seria innecesario: la
 * proyeccion es lineal, asi que la escala sale de una division.
 *
 * @param suelo Esquinas del plano en metros, si se esta dibujando. Entran en el
 *   encuadre porque el suelo tambien es escena: encuadrar solo los racks deja el
 *   plano medio fuera, y con cero racks lo deja donde caiga.
 */
export function encuadrar(
  cam: Camara,
  escena: readonly RackEnEscena[],
  lienzo: { w: number; h: number },
  margen = 48,
  suelo: readonly { x: number; y: number }[] = [],
): Camara {
  if ((escena.length === 0 && suelo.length === 0) || lienzo.w === 0 || lienzo.h === 0) {
    return cam;
  }
  const b = baseDe({ ...cam, escala: 1, panX: 0, panY: 0 });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const meter = (q: Punto): void => {
    if (q.sx < minX) minX = q.sx;
    if (q.sx > maxX) maxX = q.sx;
    if (q.sy < minY) minY = q.sy;
    if (q.sy > maxY) maxY = q.sy;
  };
  for (const r of escena) {
    for (const p of esquinas(r)) {
      for (const z of [0, r.alto]) meter(proyectar(b, p.x, p.y, z));
    }
  }
  for (const p of suelo) meter(proyectar(b, p.x, p.y, 0));
  const ancho = Math.max(maxX - minX, 1e-6);
  const alto = Math.max(maxY - minY, 1e-6);
  const escala = Math.min(
    (lienzo.w - margen * 2) / ancho,
    (lienzo.h - margen * 2) / alto,
  );
  const e = Math.min(Math.max(escala, ESCALA_MIN), ESCALA_MAX);
  return {
    ...cam,
    escala: e,
    panX: lienzo.w / 2 - ((minX + maxX) / 2) * e,
    panY: lienzo.h / 2 - ((minY + maxY) / 2) * e,
  };
}

/**
 * Centro de la escena en el mundo, en metros. El punto sobre el que se orbita.
 *
 * Es la media de los centros de los racks y, si no hay ninguno, del suelo: lo que
 * hay. `z` a media altura para que al inclinar la camara la escena no suba ni baje.
 */
export function centroDe(
  escena: readonly RackEnEscena[],
  suelo: readonly { x: number; y: number }[] = [],
): { x: number; y: number; z: number } {
  const puntos = escena.length > 0
    ? escena.map((r) => ({ x: r.x, y: r.y, z: r.alto / 2 }))
    : suelo.map((p) => ({ x: p.x, y: p.y, z: 0 }));
  if (puntos.length === 0) return { x: 0, y: 0, z: 0 };
  const n = puntos.length;
  return {
    x: puntos.reduce((a, p) => a + p.x, 0) / n,
    y: puntos.reduce((a, p) => a + p.y, 0) / n,
    z: puntos.reduce((a, p) => a + p.z, 0) / n,
  };
}

/**
 * Gira la camara MANTENIENDO FIJO el centro de la escena en pantalla.
 *
 * Sin esto el giro es alrededor del origen del mundo —la esquina del plano— y el
 * almacen describe un arco que lo saca del lienzo: se medio: arrastrando 220 px la
 * mitad del dibujo desaparecia. Es la diferencia entre orbitar y hacer girar el
 * suelo bajo los pies.
 *
 * Se calcula proyectando el centro con la camara vieja y con la nueva, y corrigiendo
 * el desplazamiento con la diferencia. No hace falta iterar: la proyeccion es lineal.
 */
export function orbitar(
  cam: Camara,
  centro: { x: number; y: number; z: number },
  dAzimut: number,
  dElevacion: number,
): Camara {
  const antes = proyectar(baseDe(cam), centro.x, centro.y, centro.z);
  const girada: Camara = {
    ...cam,
    azimut: (cam.azimut + dAzimut) % 360,
    elevacion: Math.min(ELEVACION_MAX, Math.max(ELEVACION_MIN, cam.elevacion + dElevacion)),
  };
  const despues = proyectar(baseDe(girada), centro.x, centro.y, centro.z);
  return {
    ...girada,
    panX: girada.panX + (antes.sx - despues.sx),
    panY: girada.panY + (antes.sy - despues.sy),
  };
}

/** Zoom manteniendo fijo el punto de pantalla bajo el cursor. */
export function zoomEn(cam: Camara, sx: number, sy: number, pasos: number): Camara {
  const factor = Math.pow(1.15, pasos);
  const nueva = Math.min(Math.max(cam.escala * factor, ESCALA_MIN), ESCALA_MAX);
  const k = nueva / cam.escala;
  return {
    ...cam,
    escala: nueva,
    panX: sx - (sx - cam.panX) * k,
    panY: sy - (sy - cam.panY) * k,
  };
}
