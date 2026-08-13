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

export type CriterioColor =
  | 'rack'
  | 'familia'
  | 'cluster'
  | 'altura'
  | 'ocupacion'
  | 'inspeccion';

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

/**
 * LO QUE LA CAMARA ENCONTRO EN UN RACK.
 *
 * Es lo que el plano no sabia decir: coloreaba por lo que el WMS DECLARA —la ocupacion— y
 * lo que se habia visto de verdad se quedaba en la pantalla de reconciliacion y en el
 * alzado de un rack suelto.
 */
export interface InspeccionDeRack {
  /** Huecos del rack en el catalogo. */
  huecos: number;
  /** De esos, cuantos tienen alguna lectura. */
  vistos: number;
  /** Cuantos CONTRADICEN al WMS. */
  discrepan: number;
  /** Cuando se vio por ultima vez. `null` si nunca. */
  ultima: string | null;
}

/**
 * TRES COLORES, Y EL GRIS NO ES «BIEN».
 *
 *   gris    nadie lo ha grabado          → no se sabe, y eso no es salud
 *   verde   visto y sin contradicciones  → cuadra
 *   rojo    hay huecos que no cuadran    → aqui hay trabajo
 *
 * Es la misma particion que la pantalla de reconciliacion hace con sus tres grupos, y por el
 * mismo motivo: el silencio no es lo mismo que la conformidad. Un almacen entero en gris se
 * lee como «pendiente de mirar», que es la verdad, y no como «todo en orden».
 *
 * El rojo NO se gradua por cuantas discrepancias hay. Un rack con una y otro con doce piden
 * lo mismo —que alguien vaya— y un degradado invitaria a ordenar por gravedad una escala que
 * no mide gravedad: doce huecos mal en un rack de 273 no es «peor» que uno mal en un rack de
 * 6, y con el color no se puede decir cual de las dos cosas se esta viendo.
 */
export const COLOR_SIN_INSPECCIONAR = '#5b6474';
export const COLOR_INSPECCION_CUADRA = '#34d399';
export const COLOR_INSPECCION_DISCREPA = '#f87171';

export function colorDeInspeccion(i: InspeccionDeRack | null | undefined): string {
  if (!i || i.vistos <= 0) return COLOR_SIN_INSPECCIONAR;
  return i.discrepan > 0 ? COLOR_INSPECCION_DISCREPA : COLOR_INSPECCION_CUADRA;
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

/**
 * Las cuatro esquinas de la base, en metros y en orden antihorario.
 *
 * ── EL ANCHO VA EN EL EJE LOCAL X. LA MISMA CONVENCION QUE EL LIENZO 2D ────
 *
 * Estuvo al contrario —el largo en X— y era un defecto medido, no una eleccion:
 *
 *     rack de 12 m de ancho y 1,2 m de largo, sin girar
 *       lienzo 2D  →  12 m de extension en X    (`fillRect(-w/2, -l/2, w, l)`)
 *       escena 3D  →   1,2 m de extension en X
 *
 * O sea que TODO rack no cuadrado se veia girado 90 grados al pasar de una vista a
 * la otra. El operador lo reporto por su consecuencia practica —no poder estirar en
 * 3D— y la razon de fondo era esta: con los ejes en desacuerdo, un tirador no puede
 * saber que medida esta estirando.
 *
 * Manda el 2D, y no por antigüedad: el plano, la calibracion y el origen viven en
 * pixeles de la imagen del plano, y el operador coloca los racks CONTRA esa imagen.
 * La escena 3D es la vista derivada, asi que es la que se adapta.
 *
 * Habia una prueba que fijaba la convencion antigua —«sin giro: el largo va en X»—.
 * La escribi yo, y comprobaba que la escena coincidiera consigo misma en lugar de
 * con la vista con la que tiene que coincidir.
 */
export function esquinas(r: RackEnEscena): { x: number; y: number }[] {
  const cos = Math.cos(rad(r.rotacion));
  const sen = Math.sin(rad(r.rotacion));
  const ha = r.ancho / 2;
  const hl = r.largo / 2;
  return [
    [-ha, -hl],
    [ha, -hl],
    [ha, hl],
    [-ha, hl],
  ].map(([u, v]) => ({
    x: r.x + u! * cos - v! * sen,
    y: r.y + u! * sen + v! * cos,
  }));
}

// ── Tiradores de tamaño ─────────────────────────────────────────────────────

/**
 * Medida minima de un rack, en metros. La MISMA que usa el lienzo 2D.
 *
 * Se declara aqui y se importa alli, en lugar de tenerla dos veces: si divergieran,
 * el mismo rack tendria dos minimos segun desde que vista se estirara, y el que
 * permitiera menos «rebotaria» al cambiar de vista.
 */
export const MINIMO_M = 0.05;

/**
 * Un tirador de tamaño: donde se dibuja y QUE medida estira.
 *
 * `eje` es el eje LOCAL del rack sobre el que se mueve, ya girado al mundo. `signo`
 * dice de que lado esta, y con el se sabe cual es el borde ancla: el opuesto.
 */
export interface TiradorTamano {
  /** `ancho` y `largo` viven en el suelo; `alto` es el vertical. */
  medida: 'ancho' | 'largo' | 'alto';
  signo: 1 | -1;
  /** Direccion unitaria en el mundo. Para `alto` no aplica y va en (0,0). */
  eje: { x: number; y: number };
  /** Donde se pinta, en pixeles de pantalla. */
  punto: Punto;
}

/** Lado del tirador en pixeles de PANTALLA. Como en 2D: lo que ve el ojo se mide ahi. */
export const LADO_TIRADOR_3D = 9;
/** Tolerancia de acierto, mas generosa que el dibujo: se apunta con el raton. */
export const TOLERANCIA_TIRADOR_3D = 11;

/**
 * Los CINCO tiradores de tamaño de un rack.
 *
 * ── POR QUE EN EL CENTRO DE CADA LADO Y NO EN LAS ESQUINAS ─────────────────
 *
 * El contrato de `Cluster3DView` decia que estirar en axonometria «pediria decidir
 * que eje se estira a partir de un arrastre diagonal, que SI es ambiguo». Eso es
 * cierto para un tirador de ESQUINA —una diagonal en pantalla puede querer decir dos
 * cosas— y falso para uno de LADO: un tirador en el centro de un lado tiene un solo
 * grado de libertad, el eje local de ese lado, y el arrastre se proyecta sobre el.
 *
 * Es el mismo error de razonamiento que ya se corrigio para el movimiento, y esta
 * escrito en la cabecera de `sueloEn`: se confundio «hay una direccion en la que esto
 * seria ambiguo» con «esto es ambiguo».
 *
 *   4 en el suelo   dos para el ancho y dos para el largo, en el centro de cada lado
 *   1 en el techo   para el alto, el unico que se mueve en vertical
 *
 * El del techo es lo que esta vista aporta y el 2D no puede: en planta la altura no
 * se ve, asi que hoy solo se puede teclear en el inspector.
 */
export function tiradoresDe(b: Base, r: RackEnEscena): TiradorTamano[] {
  const cos = Math.cos(rad(r.rotacion));
  const sen = Math.sin(rad(r.rotacion));
  // Ejes locales llevados al mundo. `u` es el del ancho y `v` el del largo, la misma
  // convencion que `esquinas` y que el lienzo 2D.
  const u = { x: cos, y: sen };
  const v = { x: -sen, y: cos };

  const enSuelo = (
    medida: 'ancho' | 'largo',
    eje: { x: number; y: number },
    mitad: number,
    signo: 1 | -1,
  ): TiradorTamano => ({
    medida,
    signo,
    eje,
    punto: proyectar(b, r.x + eje.x * mitad * signo, r.y + eje.y * mitad * signo, 0),
  });

  return [
    enSuelo('ancho', u, r.ancho / 2, 1),
    enSuelo('ancho', u, r.ancho / 2, -1),
    enSuelo('largo', v, r.largo / 2, 1),
    enSuelo('largo', v, r.largo / 2, -1),
    {
      medida: 'alto',
      signo: 1,
      eje: { x: 0, y: 0 },
      punto: proyectar(b, r.x, r.y, r.alto),
    },
  ];
}

/**
 * El tirador bajo el cursor, o `null`.
 *
 * Se busca ANTES que el rack: los tiradores caen encima del cuerpo, y si ganara el
 * rack, apuntar a un tirador moveria el rack en lugar de estirarlo. Es el mismo orden
 * que en el lienzo 2D.
 */
export function tiradorEn(
  tiradores: readonly TiradorTamano[],
  sx: number,
  sy: number,
): TiradorTamano | null {
  for (const t of tiradores) {
    if (Math.hypot(sx - t.punto.sx, sy - t.punto.sy) <= TOLERANCIA_TIRADOR_3D) return t;
  }
  return null;
}

/**
 * Altura del mundo (metros) bajo el cursor, para un rack en (x, y).
 *
 * Es la inversa de la componente vertical de `proyectar`, con el punto del suelo
 * FIJO —el del centro del rack—:
 *
 *     sy = (ry·cosφ − z·senφ)·Z + panY      →      z = (ry·cosφ·Z + panY − sy) / (Z·senφ)
 *
 * `senφ` no puede ser cero porque la elevacion esta acotada a 12° como minimo: a 0°
 * el techo y el suelo se proyectarian a la misma altura de pantalla y estirar en
 * vertical no significaria nada.
 */
export function alturaEn(
  b: Base,
  centro: { x: number; y: number },
  sy: number,
): number {
  const ry = centro.x * b.senA + centro.y * b.cosA;
  return (ry * b.cosE * b.escala + b.panY - sy) / (b.escala * b.senE);
}

/**
 * La medida nueva y el centro nuevo al arrastrar un tirador del SUELO.
 *
 * Reproduce exactamente lo que hace el lienzo 2D, y por eso devuelve las dos cosas:
 * el borde OPUESTO queda anclado, asi que cambiar el tamaño mueve el centro. Sin eso
 * el rack creceria simetricamente y se saldria del sitio donde lo pusieron.
 *
 * Todo en METROS y en el marco local, que es lo que hace que el calculo sea el mismo
 * este el rack girado o no.
 */
export function redimensionarEnSuelo(opciones: {
  /** Centro al empezar el gesto. */
  centro: { x: number; y: number };
  /** Medida al empezar el gesto, en metros. */
  medida0: number;
  tirador: TiradorTamano;
  /** Punto del suelo bajo el cursor, en metros. */
  cursor: { x: number; y: number };
  /** Paso de rejilla en metros; 0 o `null` para no ajustar. */
  paso: number | null;
}): { medida: number; centro: { x: number; y: number } } {
  const { centro, medida0, tirador, cursor, paso } = opciones;

  // Proyeccion del cursor sobre el eje del tirador, medida desde el centro inicial.
  const l = (cursor.x - centro.x) * tirador.eje.x + (cursor.y - centro.y) * tirador.eje.y;

  const ancla = -tirador.signo * (medida0 / 2);
  let borde = paso && paso > 0 ? Math.round(l / paso) * paso : l;

  /*
    El tope se mide CON SIGNO en la direccion del tirador.

    Con `Math.abs(borde − ancla) < MINIMO` el tope solo saltaba cerca del ancla, y
    pasarse al OTRO lado daba una distancia grande otra vez: el rack se volteaba y
    crecia. Medido: un rack de 1,1 m con el tirador arrastrado 50 m al otro lado
    daba 49,45 m en lugar de topar en 0,05.

    Con la distancia firmada, «pasarse» es negativo y cae en el mismo tope que
    «quedarse corto», que es lo que un tope tiene que hacer.
  */
  const avance = (borde - ancla) * tirador.signo;
  if (avance < MINIMO_M) borde = ancla + tirador.signo * MINIMO_M;

  const desplazamiento = (borde + ancla) / 2;
  return {
    medida: Math.abs(borde - ancla),
    centro: {
      x: centro.x + tirador.eje.x * desplazamiento,
      y: centro.y + tirador.eje.y * desplazamiento,
    },
  };
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
      /*
        ── QUE CARA ES LA LARGA, DERIVADO DE LAS ESQUINAS ─────────────────────

        Con el ancho en el eje local X, las esquinas van
        `[-ha,-hl] [ha,-hl] [ha,hl] [-ha,hl]`, asi que:

            lado 0  y 2   recorren el ANCHO   → son los TESTEROS
            lado 1  y 3   recorren el LARGO   → son el frente y la trasera

        Estaba escrito `i % 2 === 0`, o sea al reves: el sombreado daba a los testeros
        la luz de la cara grande. En un rack de 36 x 1,1 eso ilumina 1,1 m como si
        fueran 36 y el volumen se lee al contrario de lo que es.

        Se calcula midiendo la arista en vez de fiarse de la paridad: la paridad
        depende del ORDEN en que `esquinas()` devuelve los puntos, y la proxima vez que
        alguien lo toque este sombreado volveria a invertirse en silencio.
      */
      larga: aristaMasLarga(base, i),
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

/**
 * Si el lado `i` de la base es uno de los dos LARGOS.
 *
 * Se mide, no se deduce del indice: un cambio en el orden de `esquinas()` invertiria una
 * comprobacion por paridad sin que nada fallara.
 */
function aristaMasLarga(base: readonly { x: number; y: number }[], i: number): boolean {
  const l = (n: number) => {
    const a = base[n]!;
    const b = base[(n + 1) % base.length]!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  //  Un lado es «largo» si mide mas que el siguiente, que es perpendicular a el. En un
  //  rack cuadrado los dos miden igual y ninguno lo es: no hay cara grande que iluminar.
  return l(i) > l((i + 1) % base.length);
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

// ═══════════════════════════════════════════════════════════════════════════════
// LA ESTRUCTURA DEL RACK: BANDAS DE NIVEL Y DIVISIONES DE CUERPO
//
// Estaba dentro del lienzo, y ahi no se puede probar. Salio de ahi por un defecto
// reportado desde la pantalla —«la cuadricula queda en direccion opuesta a lo que
// simula el cajon del rack»— cuya causa era un intercambio de ejes: las CARAS ponen
// el ancho en el eje local X y estas lineas ponian el largo, asi que la estructura se
// dibujaba girada 90 grados respecto a la caja que la contiene.
//
// Con un rack de 36 x 1,1 m el efecto no es un detalle: la malla se sale de la caja
// por los dos lados y cruza la escena en la otra direccion.
// ═══════════════════════════════════════════════════════════════════════════════

/** Un segmento ya proyectado, listo para trazar. */
export interface Segmento {
  a: Punto;
  b: Punto;
}

/** Punto local del rack —`u` en el eje del ANCHO, `v` en el del LARGO— ya proyectado. */
function localDe(b: Base, r: RackEnEscena, u: number, v: number, z: number): Punto {
  const cos = Math.cos(rad(r.rotacion));
  const sen = Math.sin(rad(r.rotacion));
  return proyectar(b, r.x + u * cos - v * sen, r.y + u * sen + v * cos, z);
}

/**
 * Las bandas horizontales que separan los niveles.
 *
 * Van a lo LARGO del rack y solo en la cara larga que mira al observador: en las dos se
 * cruzarian y el rack se leeria como una jaula.
 *
 * La cara se elige UNA vez por rack y no punto a punto. Eligiendola en cada extremo, un
 * rack visto casi de canto podia coger un extremo de cada cara y dibujar una diagonal
 * que atraviesa la caja.
 */
export function bandasDeNivel(b: Base, r: RackEnEscena): Segmento[] {
  if (r.niveles <= 1 || r.alto <= 0) return [];
  const ha = r.ancho / 2;
  const hl = r.largo / 2;
  //  Cara cercana: la que queda mas abajo en pantalla.
  const cercaEn = (u: number) =>
    localDe(b, r, u, -hl, 0).sy + localDe(b, r, u, hl, 0).sy;
  const u = cercaEn(-ha) > cercaEn(ha) ? -ha : ha;

  const salida: Segmento[] = [];
  for (let k = 1; k < r.niveles; k += 1) {
    const z = (k / r.niveles) * r.alto;
    salida.push({ a: localDe(b, r, u, -hl, z), b: localDe(b, r, u, hl, z) });
  }
  return salida;
}

/**
 * Los montantes que separan un cuerpo del siguiente.
 *
 * Se reparten a lo LARGO —es por donde se suceden los cuerpos— y van del suelo al techo
 * sobre la misma cara cercana que las bandas. Repartirlos por el ancho es lo que producia
 * la malla cruzada.
 */
export function divisionesDeCuerpo(b: Base, r: RackEnEscena): Segmento[] {
  if (r.cuerpos <= 1 || r.largo <= 0) return [];
  const ha = r.ancho / 2;
  const hl = r.largo / 2;
  const cercaEn = (u: number) =>
    localDe(b, r, u, -hl, 0).sy + localDe(b, r, u, hl, 0).sy;
  const u = cercaEn(-ha) > cercaEn(ha) ? -ha : ha;

  const salida: Segmento[] = [];
  for (let i = 1; i < r.cuerpos; i += 1) {
    const v = -hl + (i / r.cuerpos) * r.largo;
    salida.push({ a: localDe(b, r, u, v, 0), b: localDe(b, r, u, v, r.alto) });
  }
  return salida;
}
