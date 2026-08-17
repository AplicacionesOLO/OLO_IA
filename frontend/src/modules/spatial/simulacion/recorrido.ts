/**
 * LA SIMULACION DE UN RECORRIDO: metros, segundos, y dónde está en cada instante.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE AFIRMA ESTE CALCULO Y QUE NO
 *
 * Afirma que **entre dos paradas hay esa distancia en línea recta** y que, a la velocidad
 * declarada, se tarda ese tiempo. Nada más.
 *
 * NO afirma que se pueda ir en línea recta. Entre dos huecos de pasillos distintos hay
 * racks en medio, y el recorrido real es más largo. Sortear obstáculos pide un buscador de
 * caminos sobre el suelo libre, que no existe todavía — y hasta que exista, el número que
 * sale de aquí es una COTA INFERIOR: nunca se andará menos que esto—.
 *
 * Eso está dicho en pantalla y no es un descargo: una cota inferior sirve para comparar dos
 * disposiciones, que es para lo que se construyó. Lo que no sirve es presentarla como el
 * tiempo real de un operario.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTO ES UNA FUNCION PURA Y NO VIVE EN EL VISOR
 *
 * Porque es la respuesta, no el dibujo. «340 m y 4 min 50 s» es el producto; la animación
 * es una forma de mirarlo. Separados, el número se puede probar sin abrir una tarjeta
 * gráfica y se puede enseñar en una tabla, en un informe o en el propio panel.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * DE DONDE SALEN LOS METROS DE UN HUECO
 *
 * De cruzar tres cosas: la estructura lógica de la ubicación (rack, cuerpo, nivel,
 * posición), la colocación del rack en el plano (centro, giro, largo) y las posiciones por
 * cuerpo. La misma aritmética que `placasDeHuecos` usa para pintar, porque si fueran dos
 * cuentas distintas el marcador iría por un sitio y la figura estaría en otro.
 */

import { posicionesDe } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';

/** Una parada: dónde, qué se hace y cuánto se para. */
export interface Parada {
  id: string;
  seq: number;
  locationCode: string | null;
  /** El rack al que pertenece, ya en la escena. `null` si no está colocado. */
  rackNodeId: string | null;
  bayIndex: number | null;
  level: number | null;
  position: number | null;
  operation: string;
  dwellS: number;
}

/** Un punto del recorrido, en metros y en los ejes del dominio (x, y en el suelo). */
export interface PuntoParada {
  x: number;
  y: number;
  /** Altura del hueco sobre el suelo. Informativa: andar no sube. */
  z: number;
}

/**
 * DONDE ESTA UN HUECO, EN METROS.
 *
 * `null` cuando su rack no está colocado en el plano: entonces no hay posición, y eso es
 * distinto de estar en el origen. Devolver (0,0) metería una parada falsa en la esquina del
 * almacén y falsearía la distancia sin que nada avisara.
 */
export function puntoDeParada(
  p: Parada,
  racksPorNodo: ReadonlyMap<string, RackEnEscena>,
): PuntoParada | null {
  if (!p.rackNodeId) return null;
  const r = racksPorNodo.get(p.rackNodeId);
  if (!r || r.cuerpos <= 0) return null;

  const posiciones = posicionesDe(r);
  const anchoCuerpo = r.largo / r.cuerpos;
  const anchoCelda = anchoCuerpo / posiciones;

  /*
    ── UNA UBICACION SIN CUERPO NO ESTA EN EL CUERPO 1 ───────────────────────

    No todas las ubicaciones son un hueco de estantería. Un muelle, una zona de bulto o un
    área de tránsito son nodos SIN `logical_column` ni `logical_position` — comprobado en el
    catálogo real: `ALM-01-01` los tiene a `null`—.

    Con `?? 1` la parada caía en el primer cuerpo del nodo, que es una posición inventada:
    para un muelle de cuarenta metros, decir «está en su extremo izquierdo» falsea la
    distancia sin que nada avise.

    Sin cuerpo, la parada va al CENTRO del nodo (`v = 0`). Es lo único que se sabe de verdad:
    «en algún punto de esta zona», y el centro es el representante menos malo.
  */
  const sinCuerpo = p.bayIndex == null;
  //  `bayIndex` viene del catálogo empezando en 1; el índice de la rejilla empieza en 0. Y
  //  se ACOTA: un cuerpo 21 en un rack de 20 pondría la parada más allá del extremo, y eso
  //  alargaría el recorrido con metros que no existen.
  const cuerpo = Math.min(Math.max((p.bayIndex ?? 1) - 1, 0), r.cuerpos - 1);
  const dentro = Math.min(Math.max((p.position ?? 1) - 1, 0), posiciones - 1);

  //  Coordenada LOCAL a lo largo del rack, desde su extremo negativo hasta el centro de la
  //  celda. La misma que usa `placasDeHuecos` para pintar.
  const v = sinCuerpo
    ? 0
    : -r.largo / 2 + cuerpo * anchoCuerpo + dentro * anchoCelda + anchoCelda / 2;

  //  Se anda por el PASILLO, no dentro del rack: la parada se pone al borde de la cara, no
  //  en el eje. Sin esto, las distancias saldrían medidas de centro a centro y un recorrido
  //  por la misma hilera parecería atravesar la estantería.
  const u = r.ancho / 2;

  const rad = (r.rotacion * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sen = Math.sin(rad);

  const niveles = r.niveles > 0 ? r.niveles : 1;
  const altoNivel = r.alto / niveles;
  const nivel = Math.min(Math.max((p.level ?? 1) - 1, 0), niveles - 1);

  return {
    x: r.x + u * cos - v * sen,
    y: r.y + u * sen + v * cos,
    z: nivel * altoNivel + altoNivel / 2,
  };
}

/** Un tramo entre dos paradas, ya medido. */
export interface Tramo {
  desde: Parada;
  hasta: Parada;
  puntoDesde: PuntoParada;
  puntoHasta: PuntoParada;
  metros: number;
  /** Segundos de marcha, sin contar lo que se para. */
  segundosMarcha: number;
  /** Milisegundo del recorrido en el que empieza este tramo. */
  desdeMs: number;
  hastaMs: number;
}

export interface Simulacion {
  tramos: Tramo[];
  metros: number;
  /** Segundos andando. */
  segundosMarcha: number;
  /** Segundos parado en las paradas. */
  segundosParado: number;
  segundosTotal: number;
  /** Duración total en ms, que es lo que la línea de tiempo recorre. */
  duracionMs: number;
  /**
   * Las paradas que se saltaron porque su rack no está colocado.
   *
   * Se DICEN. Callarlas daría un total más corto que parece bueno: un recorrido de diez
   * paradas del que solo cuentan cuatro sale barato precisamente porque le faltan seis.
   */
  paradasSinSitio: Parada[];
}

/**
 * Mide el recorrido: metros, segundos y cuándo pasa por cada tramo.
 *
 * ── EL ORDEN DE LAS PARADAS ES PARTE DEL DATO ─────────────────────────────────
 *
 * Se ordena por `seq` y no se confía en el orden de llegada: las mismas paradas en otro
 * orden son otro recorrido, casi siempre con otra distancia. Es la razón de que `seq` sea
 * único por recorrido en la base.
 */
export function simular(
  paradas: readonly Parada[],
  racksPorNodo: ReadonlyMap<string, RackEnEscena>,
  velocidadMps: number,
): Simulacion {
  const v = velocidadMps > 0 ? velocidadMps : 1.2;
  const enOrden = [...paradas].sort((a, b) => a.seq - b.seq);

  const conSitio: { parada: Parada; punto: PuntoParada }[] = [];
  const paradasSinSitio: Parada[] = [];
  for (const p of enOrden) {
    const punto = puntoDeParada(p, racksPorNodo);
    if (punto) conSitio.push({ parada: p, punto });
    else paradasSinSitio.push(p);
  }

  const tramos: Tramo[] = [];
  let metros = 0;
  let segundosMarcha = 0;
  let segundosParado = 0;
  //  El reloj empieza en la primera parada, y su espera cuenta: quien sale del muelle
  //  también tarda en cargar.
  let ms = (conSitio[0]?.parada.dwellS ?? 0) * 1000;
  segundosParado += conSitio[0]?.parada.dwellS ?? 0;

  for (let i = 1; i < conSitio.length; i += 1) {
    const a = conSitio[i - 1]!;
    const b = conSitio[i]!;
    //  Distancia en PLANTA: andar no sube. Un hueco del nivel 7 y otro del 1 en el mismo
    //  cuerpo están a cero metros de camino, y sumar la altura inventaría un recorrido
    //  vertical que nadie hace. Para un dron esto habrá que revisarlo, y está dicho.
    const d = Math.hypot(b.punto.x - a.punto.x, b.punto.y - a.punto.y);
    const marcha = d / v;
    tramos.push({
      desde: a.parada,
      hasta: b.parada,
      puntoDesde: a.punto,
      puntoHasta: b.punto,
      metros: d,
      segundosMarcha: marcha,
      desdeMs: ms,
      hastaMs: ms + marcha * 1000,
    });
    metros += d;
    segundosMarcha += marcha;
    ms += marcha * 1000 + b.parada.dwellS * 1000;
    segundosParado += b.parada.dwellS;
  }

  return {
    tramos,
    metros: Number(metros.toFixed(2)),
    segundosMarcha: Number(segundosMarcha.toFixed(1)),
    segundosParado: Number(segundosParado.toFixed(1)),
    segundosTotal: Number((segundosMarcha + segundosParado).toFixed(1)),
    duracionMs: Math.round(ms),
    paradasSinSitio,
  };
}

/**
 * DONDE ESTA LA FIGURA en un instante del recorrido.
 *
 * Interpolación lineal dentro del tramo, y quieta durante las paradas. Es la suposición más
 * simple que respeta los datos: cualquier curva suave afirmaría un giro que nadie ha
 * definido. Mismo criterio que `interpolar` de las rutas observadas.
 *
 * `null` antes de empezar y después de acabar: dibujar la figura fuera de la ventana del
 * recorrido sería afirmar que está ahí en un momento del que el recorrido no dice nada.
 */
export function posicionEn(sim: Simulacion, ms: number): PuntoParada | null {
  if (sim.tramos.length === 0) return null;
  if (ms < 0 || ms > sim.duracionMs) return null;

  const primero = sim.tramos[0]!;
  //  Antes del primer tramo se está PARADO en la primera parada, no en ningún sitio: la
  //  espera inicial es parte del recorrido.
  if (ms <= primero.desdeMs) return primero.puntoDesde;

  for (const t of sim.tramos) {
    if (ms <= t.hastaMs) {
      const largo = t.hastaMs - t.desdeMs;
      //  Un tramo de duración cero —dos paradas en el mismo punto— no se puede interpolar:
      //  dividir por cero daría `NaN` y la figura desaparecería sin decir por qué.
      if (largo <= 0) return t.puntoHasta;
      const f = (ms - t.desdeMs) / largo;
      return {
        x: t.puntoDesde.x + (t.puntoHasta.x - t.puntoDesde.x) * f,
        y: t.puntoDesde.y + (t.puntoHasta.y - t.puntoDesde.y) * f,
        //  La altura NO se interpola: quien anda va por el suelo. La z de una parada dice a
        //  qué altura está el hueco, no por dónde pasa quien va a él.
        z: 0,
      };
    }
    //  Si el instante cae DESPUES de este tramo pero antes del siguiente, se está parado en
    //  la parada de llegada.
  }
  //  Entre el fin de un tramo y el inicio del siguiente: parado en la parada intermedia.
  for (let i = 0; i < sim.tramos.length - 1; i += 1) {
    if (ms > sim.tramos[i]!.hastaMs && ms < sim.tramos[i + 1]!.desdeMs) {
      return sim.tramos[i]!.puntoHasta;
    }
  }
  return sim.tramos[sim.tramos.length - 1]!.puntoHasta;
}

/** «4 min 50 s». Para escribir un tiempo sin que quien lo lea tenga que dividir. */
export function comoDuracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const resto = s % 60;
  if (m < 60) return resto === 0 ? `${m} min` : `${m} min ${resto} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
