/**
 * LA RUTA SOBRE LA ESCENA — dibujo y reproduccion temporal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE AFIRMA LA POLILINEA
 *
 * Que la fuente vio esos racks, en ese orden, en esos instantes. NO que volo por
 * esas rectas: entre dos observaciones consecutivas pudo dar la vuelta al pasillo, y
 * eso no se sabe. Por eso la linea se dibuja DISCONTINUA.
 *
 * No es decoracion. Una linea continua se lee como trayectoria medida —así se leen
 * los mapas— y aqui lo unico medido son los vertices. La discontinuidad dice
 * «paso por aqui y por aqui» en lugar de «fue por aqui», que es exactamente la
 * diferencia entre lo que sabemos y lo que no.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REPRODUCCION TEMPORAL
 *
 * `interpolar()` da la posicion en un instante cualquiera moviendose en linea recta
 * entre las dos observaciones que lo rodean. Es una SUPOSICION —la mas simple que
 * respeta los datos— y la unica que se puede hacer sin inventar: cualquier curva
 * suave afirmaria un giro que nadie observo.
 *
 * Con eso el marcador avanza de forma continua en lugar de saltar de rack a rack, y
 * el operador ve «por donde iba el dron a las 14:03» aunque a esa hora exacta no
 * hubiera observacion. Lo que NO se hace es dibujar el marcador fuera de la ventana
 * observada: antes de la primera y despues de la ultima no hay nada que mostrar.
 */

import type { RouteDto, RoutePointDto } from '../repositories/dto';
import { proyectar, type Base, type Punto } from './escena';

/** Un punto de la ruta con su instante ya en milisegundos. */
export interface PasoRuta {
  punto: RoutePointDto;
  /** `Date.parse(observed_at)`. Se calcula una vez, no en cada fotograma. */
  ms: number;
}

export interface RutaPreparada {
  ruta: RouteDto;
  pasos: PasoRuta[];
  /** Instante de la primera y la ultima observacion, en ms. */
  desdeMs: number;
  hastaMs: number;
  /** Color con el que se dibuja. Uno por fuente. */
  color: string;
}

/**
 * Colores de las rutas. Distintos de la paleta de los racks A PROPOSITO: si una ruta
 * fuera del mismo cian que un rack, la linea desapareceria justo sobre lo que
 * atraviesa. Son tonos calidos, que ademas es como se leen las trazas.
 */
export const PALETA_RUTAS = [
  '#fbbf24',
  '#fb7185',
  '#a3e635',
  '#f0abfc',
  '#fdba74',
  '#67e8f9',
] as const;

/** Prepara las rutas para dibujar: instantes en ms y color estable por fuente. */
export function prepararRutas(rutas: readonly RouteDto[]): RutaPreparada[] {
  // Orden por codigo de fuente para que el color no dependa del orden de llegada de
  // la respuesta: la misma ruta debe salir del mismo color en cada recarga.
  const orden = [...rutas].sort((a, b) => a.source_code.localeCompare(b.source_code));
  return orden.map((ruta, i) => {
    const pasos = ruta.points.map((punto) => ({ punto, ms: Date.parse(punto.observed_at) }));
    return {
      ruta,
      pasos,
      desdeMs: pasos.length > 0 ? pasos[0]!.ms : 0,
      hastaMs: pasos.length > 0 ? pasos[pasos.length - 1]!.ms : 0,
      color: PALETA_RUTAS[i % PALETA_RUTAS.length]!,
    };
  });
}

/** Ventana temporal que cubre TODAS las rutas. Es el recorrido del deslizador. */
export function ventanaDe(preparadas: readonly RutaPreparada[]): { desde: number; hasta: number } | null {
  const conPasos = preparadas.filter((r) => r.pasos.length > 0);
  if (conPasos.length === 0) return null;
  return {
    desde: Math.min(...conPasos.map((r) => r.desdeMs)),
    hasta: Math.max(...conPasos.map((r) => r.hastaMs)),
  };
}

export interface PosicionEnRuta {
  /** Metros. Interpolado entre las dos observaciones que rodean el instante. */
  x: number;
  y: number;
  /** La observacion anterior o igual al instante. Es lo ULTIMO que se vio. */
  ultimo: RoutePointDto;
  /** 0..1 entre `ultimo` y el siguiente. `1` cuando ya no hay siguiente. */
  avance: number;
}

/**
 * Donde estaba la fuente en el instante `ms`, o `null` fuera de su ventana.
 *
 * `null` y no la posicion mas cercana: antes del primer avistamiento y despues del
 * ultimo NO SE SABE donde estaba, y dejar el marcador clavado en el primer rack
 * durante la hora anterior al vuelo afirmaria que estuvo ahi esperando.
 *
 * Busqueda binaria: con 5.000 puntos y un deslizador que se arrastra, un recorrido
 * lineal por fotograma serian 5.000 comparaciones × 60 fotogramas por segundo.
 */
export function interpolar(r: RutaPreparada, ms: number): PosicionEnRuta | null {
  const { pasos } = r;
  if (pasos.length === 0) return null;
  if (ms < r.desdeMs || ms > r.hastaMs) return null;

  let lo = 0;
  let hi = pasos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pasos[mid]!.ms <= ms) lo = mid;
    else hi = mid - 1;
  }
  const a = pasos[lo]!;
  const b = pasos[lo + 1];
  if (!b) {
    return { x: a.punto.x_m, y: a.punto.y_m, ultimo: a.punto, avance: 1 };
  }
  const span = b.ms - a.ms;
  // Dos observaciones en el mismo instante: no hay nada que interpolar y dividir
  // daria `Infinity`. Se queda en la primera, que es lo unico afirmable.
  const t = span > 0 ? (ms - a.ms) / span : 0;
  return {
    x: a.punto.x_m + (b.punto.x_m - a.punto.x_m) * t,
    y: a.punto.y_m + (b.punto.y_m - a.punto.y_m) * t,
    ultimo: a.punto,
    avance: t,
  };
}

/**
 * Dibuja una ruta: la polilinea discontinua, los vertices y el marcador.
 *
 * @param hastaMs Instante de la reproduccion. Lo posterior se dibuja MUY tenue en
 *   lugar de ocultarse: ver el recorrido completo en gris y lo recorrido en color es
 *   lo que convierte el deslizador en una lectura y no en un rompecabezas.
 */
export function dibujarRuta(
  ctx: CanvasRenderingContext2D,
  b: Base,
  r: RutaPreparada,
  hastaMs: number | null,
  escala: number,
): void {
  if (r.pasos.length === 0) return;

  const p = (paso: PasoRuta): Punto => proyectar(b, paso.punto.x_m, paso.punto.y_m, 0);

  // ── La polilinea ────────────────────────────────────────────────────────
  if (r.ruta.forms_path && r.pasos.length >= 2) {
    // Discontinua: los vertices estan medidos, los tramos entre ellos NO.
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    // Primero el recorrido COMPLETO, tenue: es el contexto.
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.30)';
    ctx.beginPath();
    r.pasos.forEach((paso, i) => {
      const q = p(paso);
      if (i === 0) ctx.moveTo(q.sx, q.sy);
      else ctx.lineTo(q.sx, q.sy);
    });
    ctx.stroke();

    // Y encima lo ya recorrido, en color.
    const recorridos = hastaMs == null ? r.pasos : r.pasos.filter((s) => s.ms <= hastaMs);
    if (recorridos.length >= 2) {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      recorridos.forEach((paso, i) => {
        const q = p(paso);
        if (i === 0) ctx.moveTo(q.sx, q.sy);
        else ctx.lineTo(q.sx, q.sy);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Los vertices ────────────────────────────────────────────────────────
  // Un circulo por observacion. Es lo MEDIDO, así que se dibuja solido mientras la
  // linea va discontinua: la jerarquia visual dice cual de los dos es el dato.
  const radio = Math.max(2.5, Math.min(5, escala * 0.35));
  for (const paso of r.pasos) {
    const q = p(paso);
    const pasado = hastaMs == null || paso.ms <= hastaMs;
    ctx.beginPath();
    ctx.arc(q.sx, q.sy, radio, 0, Math.PI * 2);
    ctx.fillStyle = pasado ? r.color : 'rgba(148, 163, 184, 0.35)';
    ctx.fill();
    if (pasado && paso.punto.confidence != null && paso.punto.confidence < 0.6) {
      // Confianza baja: anillo hueco. Un reconocimiento dudoso sigue siendo una
      // observacion, pero el operador tiene que poder verlo sin abrir la ficha.
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, radio + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ── El marcador de la reproduccion ──────────────────────────────────────
  if (hastaMs != null) {
    const pos = interpolar(r, hastaMs);
    if (pos) {
      const q = proyectar(b, pos.x, pos.y, 0);
      // Cruz mas anillo: un punto solido mas se confundiria con un vertice, y lo que
      // marca no es una observacion sino una POSICION INTERPOLADA.
      ctx.save();
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, radio + 5, 0, Math.PI * 2);
      ctx.stroke();
      const brazo = radio + 9;
      ctx.beginPath();
      ctx.moveTo(q.sx - brazo, q.sy);
      ctx.lineTo(q.sx + brazo, q.sy);
      ctx.moveTo(q.sx, q.sy - brazo);
      ctx.lineTo(q.sx, q.sy + brazo);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Racks que la fuente vio hasta un instante. Se usa para realzarlos en la escena. */
export function racksVistos(
  preparadas: readonly RutaPreparada[],
  hastaMs: number | null,
): Set<string> {
  const vistos = new Set<string>();
  for (const r of preparadas) {
    for (const paso of r.pasos) {
      if (hastaMs == null || paso.ms <= hastaMs) vistos.add(paso.punto.rack_node_id);
    }
  }
  return vistos;
}
