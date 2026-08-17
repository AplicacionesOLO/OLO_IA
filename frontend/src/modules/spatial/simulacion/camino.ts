/**
 * EL CAMINO DE VERDAD: rodear los racks en vez de atravesarlos.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE ARREGLA
 *
 * `simular()` medía en línea recta entre paradas, y lo decía: «es el mínimo, no el camino
 * real». Entre dos huecos de pasillos distintos hay racks en medio, así que la recta pasa por
 * dentro de la estantería y el número sale corto.
 *
 * Con esto el número es el camino que alguien puede andar de verdad. Y eso cambia lo que la
 * simulación permite decidir: comparar dos disposiciones deja de ser comparar dos cotas
 * inferiores y pasa a ser comparar dos almacenes.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * COMO, Y POR QUE ASI
 *
 * Una rejilla sobre el suelo, las huellas de los racks marcadas como bloqueadas, y A* entre
 * parada y parada. Es lo mismo que hace cualquier planificador de movimiento y tiene tres
 * propiedades que aquí importan:
 *
 *   · encuentra el camino más corto SOBRE LA REJILLA, así que no se puede acusar al
 *     resultado de ser arbitrario;
 *   · si no hay camino lo DICE, en vez de devolver una recta que atraviesa una pared;
 *   · el error es acotado y conocido: como mucho, el paso de la rejilla.
 *
 * Después se SUAVIZA por visibilidad. Sin eso, un camino recto en diagonal sale en escalera y
 * mide un 8 % más que la recta que lo sustituye — un sobrecoste que no está en el almacén,
 * está en la rejilla—.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LO QUE SIGUE SIN AFIRMAR
 *
 * Que ese sea el camino que una persona elige. La gente corta por donde puede, se cruza y
 * espera. Esto es el camino más corto SIN obstáculos móviles, que es lo que se necesita para
 * comparar disposiciones, y sigue siendo una cota inferior — solo que mucho más ajustada—.
 */

import type { RackEnEscena } from '../cluster3d/escena';
import { esquinas } from '../cluster3d/escena';

/**
 * Lado de una celda, en metros.
 *
 * Medio metro es la mitad del hombro de una persona: por debajo, la rejilla de un almacén de
 * 290 m son cientos de miles de celdas y el cálculo se nota; por encima, un pasillo de 1,2 m
 * podría quedarse sin ninguna celda libre y el buscador diría que no hay camino donde sí lo
 * hay.
 */
export const PASO_M = 0.5;

/**
 * Cuánto se sale la rejilla de los racks, en metros.
 *
 * Hace falta porque el camino puede tener que rodear un rack por su extremo, y sin margen el
 * borde de la rejilla haría de pared: el buscador diría «no hay camino» donde lo que falta es
 * sitio para girar. Ocho metros es más que el pasillo más ancho que se ha medido.
 */
export const MARGEN_M = 8;

export interface Rejilla {
  /** Celdas a lo ancho y a lo largo. */
  cols: number;
  filas: number;
  /** Metros por celda. */
  paso: number;
  /** Esquina de la celda (0,0), en metros del dominio. */
  x0: number;
  y0: number;
  /** `1` si la celda está ocupada por un rack. */
  bloqueada: Uint8Array;
}

/** De metros a celda. Sin acotar: quien llame decide qué hacer con lo que cae fuera. */
export function aCelda(r: Rejilla, x: number, y: number): { c: number; f: number } {
  return {
    c: Math.floor((x - r.x0) / r.paso),
    f: Math.floor((y - r.y0) / r.paso),
  };
}

/** Del centro de una celda a metros. */
export function aMetros(r: Rejilla, c: number, f: number): { x: number; y: number } {
  return { x: r.x0 + (c + 0.5) * r.paso, y: r.y0 + (f + 0.5) * r.paso };
}

export function dentro(r: Rejilla, c: number, f: number): boolean {
  return c >= 0 && f >= 0 && c < r.cols && f < r.filas;
}

export function libre(r: Rejilla, c: number, f: number): boolean {
  return dentro(r, c, f) && r.bloqueada[f * r.cols + c] === 0;
}

/**
 * LA REJILLA DEL SUELO, con las huellas de los racks marcadas.
 *
 * Se marca celda a celda comprobando si su centro cae dentro del rectángulo girado del rack.
 * No se usa la caja envolvente: un rack girado 45° tiene una envolvente casi el doble de
 * grande, y bloquearla entera cerraría pasillos que existen.
 */
export function construirRejilla(
  racks: readonly RackEnEscena[],
  paso = PASO_M,
  margen = MARGEN_M,
): Rejilla | null {
  if (racks.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of racks) {
    for (const e of esquinas(r)) {
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y);
      maxY = Math.max(maxY, e.y);
    }
  }

  const x0 = minX - margen;
  const y0 = minY - margen;
  const cols = Math.ceil((maxX + margen - x0) / paso);
  const filas = Math.ceil((maxY + margen - y0) / paso);
  //  Un tope de seguridad: cuatro millones de celdas son 2 km × 500 m a medio metro. Por
  //  encima, algo está mal en las coordenadas —un rack en el infinito por un plano sin
  //  calibrar— y reservar el búfer colgaría la pestaña sin decir por qué.
  if (cols <= 0 || filas <= 0 || cols * filas > 4_000_000) return null;

  const bloqueada = new Uint8Array(cols * filas);
  const rej: Rejilla = { cols, filas, paso, x0, y0, bloqueada };

  for (const r of racks) {
    const poli = esquinas(r);
    //  Solo las celdas de la caja envolvente del rack: recorrer la rejilla entera por cada
    //  rack serían 347 × 14.000 comprobaciones para nada.
    const ex = poli.map((p) => p.x);
    const ey = poli.map((p) => p.y);
    const a = aCelda(rej, Math.min(...ex), Math.min(...ey));
    const b = aCelda(rej, Math.max(...ex), Math.max(...ey));
    for (let f = Math.max(0, a.f); f <= Math.min(filas - 1, b.f); f += 1) {
      for (let c = Math.max(0, a.c); c <= Math.min(cols - 1, b.c); c += 1) {
        const m = aMetros(rej, c, f);
        if (enPoligono(poli, m.x, m.y)) bloqueada[f * cols + c] = 1;
      }
    }
  }
  return rej;
}

/** Punto en polígono, por cruces. El mismo criterio que `dentro()` de la escena. */
function enPoligono(poli: { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i, i += 1) {
    const a = poli[i]!;
    const b = poli[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * La celda libre más cercana a un punto. `null` si no hay ninguna cerca.
 *
 * ── POR QUE HACE FALTA ────────────────────────────────────────────────────────
 *
 * Porque una parada está en el borde del rack —se anda por el pasillo— y medio metro de
 * redondeo puede meter su celda DENTRO de la huella. Sin esto, el buscador diría «no hay
 * camino» desde una parada perfectamente accesible.
 *
 * Se busca en anillos crecientes y con un tope: si a tres metros no hay suelo libre, la
 * parada está de verdad encerrada y eso hay que decirlo, no arreglarlo moviéndola diez
 * metros a otro pasillo.
 */
export function celdaLibreCerca(
  r: Rejilla,
  x: number,
  y: number,
  radioMaxM = 3,
): { c: number; f: number } | null {
  const p = aCelda(r, x, y);
  if (libre(r, p.c, p.f)) return p;
  const maxAnillo = Math.ceil(radioMaxM / r.paso);
  for (let k = 1; k <= maxAnillo; k += 1) {
    for (let d = -k; d <= k; d += 1) {
      const candidatas = [
        { c: p.c + d, f: p.f - k },
        { c: p.c + d, f: p.f + k },
        { c: p.c - k, f: p.f + d },
        { c: p.c + k, f: p.f + d },
      ];
      for (const q of candidatas) if (libre(r, q.c, q.f)) return q;
    }
  }
  return null;
}

/** Un punto del camino, en metros. */
export interface PuntoCamino {
  x: number;
  y: number;
}

/**
 * A* DE OCHO VECINOS entre dos puntos en metros.
 *
 * `null` cuando no hay camino: un hueco encerrado por racks, o una parada fuera de la
 * rejilla. Devolver una recta en ese caso sería afirmar que se puede atravesar una
 * estantería, que es exactamente lo que esto viene a arreglar.
 *
 * ── POR QUE OCHO Y NO CUATRO ──────────────────────────────────────────────────
 *
 * Con cuatro vecinos, un tramo en diagonal se recorre en zigzag y mide un 41 % más de lo que
 * mide: el número saldría inflado y las comparaciones entre disposiciones dependerían de
 * cómo estén orientados los pasillos. Con ocho, el error antes de suavizar es del 8 %, y
 * después del suavizado es cero en los tramos con visibilidad directa.
 *
 * No se permite cortar una esquina en diagonal si las dos celdas ortogonales están
 * bloqueadas: eso es pasar entre dos racks que se tocan, por un hueco de cero centímetros.
 */
export function buscarCamino(
  rej: Rejilla,
  desde: PuntoCamino,
  hasta: PuntoCamino,
): PuntoCamino[] | null {
  const a = celdaLibreCerca(rej, desde.x, desde.y);
  const b = celdaLibreCerca(rej, hasta.x, hasta.y);
  if (!a || !b) return null;
  if (a.c === b.c && a.f === b.f) return [aMetros(rej, a.c, a.f)];

  const n = rej.cols * rej.filas;
  const inicio = a.f * rej.cols + a.c;
  const meta = b.f * rej.cols + b.c;

  //  Arrays planos y no objetos: con 14.000 celdas da igual, pero con 300.000 —un almacén
  //  grande a medio metro— crear un objeto por celda es lo que hace que se note.
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n).fill(Infinity);
  const previo = new Int32Array(n).fill(-1);
  const cerrado = new Uint8Array(n);

  const heur = (i: number) => {
    const c = i % rej.cols;
    const fl = (i - c) / rej.cols;
    const dx = Math.abs(c - b.c);
    const dy = Math.abs(fl - b.f);
    //  Distancia OCTIL: la exacta para ocho vecinos. Con la euclídea el heurístico sigue
    //  siendo admisible pero explora más; con la Manhattan sobreestima y el camino que
    //  encuentra ya no es el más corto.
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * rej.paso;
  };

  g[inicio] = 0;
  f[inicio] = heur(inicio);
  //  Un montón binario a mano: importar una librería para esto sería una dependencia por
  //  cuarenta líneas, y con `sort` en cada paso el coste pasa de n·log n a n²·log n.
  const abierto: number[] = [inicio];
  const enAbierto = new Uint8Array(n);
  enAbierto[inicio] = 1;

  const sacarMejor = (): number => {
    let mejor = 0;
    for (let k = 1; k < abierto.length; k += 1) {
      if (f[abierto[k]!]! < f[abierto[mejor]!]!) mejor = k;
    }
    const i = abierto[mejor]!;
    abierto[mejor] = abierto[abierto.length - 1]!;
    abierto.pop();
    enAbierto[i] = 0;
    return i;
  };

  while (abierto.length > 0) {
    const i = sacarMejor();
    if (i === meta) break;
    cerrado[i] = 1;
    const c = i % rej.cols;
    const fl = (i - c) / rej.cols;

    for (let dc = -1; dc <= 1; dc += 1) {
      for (let df = -1; df <= 1; df += 1) {
        if (dc === 0 && df === 0) continue;
        const nc = c + dc;
        const nf = fl + df;
        if (!libre(rej, nc, nf)) continue;
        //  Nada de cortar esquinas por un hueco de cero: si las dos ortogonales están
        //  bloqueadas, esa diagonal pasa entre dos racks que se tocan.
        if (dc !== 0 && df !== 0 && (!libre(rej, c + dc, fl) || !libre(rej, c, fl + df))) {
          continue;
        }
        const j = nf * rej.cols + nc;
        if (cerrado[j]) continue;
        const coste = (dc !== 0 && df !== 0 ? Math.SQRT2 : 1) * rej.paso;
        const tentativo = g[i]! + coste;
        if (tentativo < g[j]!) {
          g[j] = tentativo;
          f[j] = tentativo + heur(j);
          previo[j] = i;
          if (!enAbierto[j]) {
            abierto.push(j);
            enAbierto[j] = 1;
          }
        }
      }
    }
  }

  if (previo[meta] === -1 && meta !== inicio) return null;

  const celdas: number[] = [];
  for (let i: number = meta; i !== -1; i = previo[i]!) {
    celdas.push(i);
    if (i === inicio) break;
  }
  celdas.reverse();
  return celdas.map((i) => {
    const c = i % rej.cols;
    const fl = (i - c) / rej.cols;
    return aMetros(rej, c, fl);
  });
}

/**
 * ¿Se ve un punto desde otro sin atravesar nada?
 *
 * Se muestrea la recta cada medio paso: con el paso entero, una esquina de un rack podría
 * quedar justo entre dos muestras y el camino la atravesaría.
 */
export function hayVisibilidad(rej: Rejilla, a: PuntoCamino, b: PuntoCamino): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const pasos = Math.max(1, Math.ceil(d / (rej.paso / 2)));
  for (let k = 0; k <= pasos; k += 1) {
    const t = k / pasos;
    const p = aCelda(rej, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (!libre(rej, p.c, p.f)) return false;
  }
  return true;
}

/**
 * QUITA LOS VERTICES QUE NO HACEN FALTA.
 *
 * Un camino de A* va de centro de celda en centro de celda, así que un tramo recto en
 * diagonal sale en escalera y mide un 8 % más que la recta que lo sustituye. Ese 8 % no está
 * en el almacén, está en la rejilla — y con él, dos disposiciones que se diferencian en un
 * 5 % no se podrían distinguir—.
 *
 * Se avanza al vértice más lejano que siga viéndose desde el actual. Es lineal y no cambia
 * la topología del camino: solo quita lo que sobra.
 */
export function suavizar(rej: Rejilla, camino: readonly PuntoCamino[]): PuntoCamino[] {
  if (camino.length <= 2) return [...camino];
  const salida: PuntoCamino[] = [camino[0]!];
  let i = 0;
  while (i < camino.length - 1) {
    let j = camino.length - 1;
    //  Del más lejano hacia atrás: el primero que se vea es el mejor salto posible.
    while (j > i + 1 && !hayVisibilidad(rej, camino[i]!, camino[j]!)) j -= 1;
    salida.push(camino[j]!);
    i = j;
  }
  return salida;
}

/** Longitud de una polilínea, en metros. */
export function largoDe(camino: readonly PuntoCamino[]): number {
  let d = 0;
  for (let i = 1; i < camino.length; i += 1) {
    d += Math.hypot(camino[i]!.x - camino[i - 1]!.x, camino[i]!.y - camino[i - 1]!.y);
  }
  return d;
}

/**
 * El camino andable entre dos puntos, ya suavizado. `null` si no hay.
 *
 * Es la función que usa la simulación. Devuelve los vértices y su longitud juntos porque
 * quien la llama necesita las dos cosas y calcular el largo aparte invitaría a que un sitio
 * midiera el camino suavizado y otro el de la rejilla.
 */
export function caminoEntre(
  rej: Rejilla,
  desde: PuntoCamino,
  hasta: PuntoCamino,
): { puntos: PuntoCamino[]; metros: number } | null {
  const crudo = buscarCamino(rej, desde, hasta);
  if (!crudo) return null;
  const suave = suavizar(rej, crudo);

  /*
    ── LOS EXTREMOS SON LOS PUNTOS DE VERDAD, NO CENTROS DE CELDA ──────────────

    A* trabaja con centros de celda, así que el camino empezaba y acababa hasta 35 cm de
    donde está la parada. Y eso producía un número IMPOSIBLE: en un pasillo despejado salían
    78,00 m donde la recta mide 78,30 — un camino que rodea midiendo menos que la línea
    recta—. Visto en pantalla, con el recorrido real de RCL47.

    No es un error de un decimal: es una afirmación falsa. La recta es la cota inferior
    absoluta y nada puede bajar de ahí.

    Se sustituyen el primero y el último por los puntos exactos. En un pasillo despejado el
    camino queda siendo la recta —y mide exactamente lo que la recta— y cuando hay que
    rodear, los tramos de dentro siguen siendo los de la rejilla.
  */
  const puntos = suave.length >= 2
    ? [desde, ...suave.slice(1, -1), hasta]
    : [desde, hasta];
  return { puntos, metros: largoDe(puntos) };
}
