/**
 * LA SIMULACION DE UN RECORRIDO: metros, segundos, y dónde está en cada instante.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE AFIRMA ESTE CALCULO Y QUE NO
 *
 * Con un BUSCADOR DE CAMINOS —`camino.ts`— afirma que ese es el camino más corto que alguien
 * puede andar rodeando los racks, y que a la velocidad declarada se tarda ese tiempo. Eso ya
 * es una medida, no una cota, y es lo que permite comparar dos disposiciones de verdad.
 *
 * SIN buscador mide en línea recta, y entonces vuelve a ser una cota inferior: la recta pasa
 * por dentro de las estanterías. `rodeando` dice cuál de las dos cosas es el número, porque
 * presentarlas igual sería hacer pasar una por la otra.
 *
 * Lo que sigue sin afirmar, con buscador o sin él: que ese sea el camino que una persona
 * elige. La gente se cruza, espera y corta por donde puede. Esto es el camino más corto sin
 * obstáculos móviles.
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

import { posicionesDe, vDeCelda } from '../cluster3d/escena';
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

  //  Coordenada LOCAL a lo largo del rack. Por la MISMA funcion que usan las placas del
  //  visor y las celdas del axonometrico: si fueran tres cuentas, el mapa diria una cosa, el
  //  clic otra y la distancia una tercera.
  const v = sinCuerpo ? 0 : vDeCelda(r, cuerpo, dentro, posiciones);

  /*
    ── SE ANDA POR EL PASILLO, Y POR EL PASILLO DE LA CARA BUENA ──────────────

    La parada se pone al borde de la cara, no en el eje: sin eso las distancias saldrían de
    centro a centro y un recorrido por la misma hilera parecería atravesar la estantería.

    Y va a la cara DECLARADA, porque el palet se coge por donde se puede coger. En un rack
    doble esto decide por cuál de los dos pasillos —uno a cada lado del par— pasa quien hace
    el recorrido, y son pasillos distintos: ponerlo en el que no es mide un camino que nadie
    anda, y con un rack doble de por medio la diferencia no es de centímetros.

    Sin cara declarada se queda en `+1`, que es el lado que se usaba antes de que la cara
    existiera: mientras no se sepa, la medida no cambia de un día para otro.
  */
  const u = (r.frente ?? 1) * (r.ancho / 2);

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
  /**
   * Los vertices del camino ANDABLE, si se busco. Vacio si se midio en linea recta.
   *
   * Sirve para dibujarlo: un numero que dice «rodea el rack» y una linea que lo atraviesa
   * serian dos afirmaciones contrarias en la misma pantalla.
   */
  puntos: PuntoParada[];
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
   * Si los metros son el camino ANDABLE o la linea recta.
   *
   * Se dice porque cambia lo que el numero significa: la recta es una cota inferior y el
   * camino es una medida. Presentarlos igual seria hacer pasar una por la otra.
   */
  rodeando: boolean;
  /**
   * Los tramos para los que NO se encontro camino, y por tanto se midieron en recta.
   *
   * Un hueco encerrado por racks no tiene camino, y callarlo dejaria un total que mezcla
   * medidas con cotas sin decir cuales.
   */
  tramosSinCamino: number;
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
/**
 * Busca el camino andable entre dos puntos. `null` si no hay.
 *
 * Se pasa como FUNCION y no se importa: asi `simular` no depende de la rejilla —se puede
 * probar sin construir una— y quien llama decide si quiere el camino real o la recta. Con la
 * dependencia dentro, medir un recorrido obligaria a rasterizar 347 racks aunque solo se
 * quisiera el orden de las paradas.
 */
export type BuscadorDeCamino = (
  desde: { x: number; y: number },
  hasta: { x: number; y: number },
) => { puntos: { x: number; y: number }[]; metros: number } | null;

export function simular(
  paradas: readonly Parada[],
  racksPorNodo: ReadonlyMap<string, RackEnEscena>,
  velocidadMps: number,
  buscador?: BuscadorDeCamino,
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
  let sinCamino = 0;
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
    const recta = Math.hypot(b.punto.x - a.punto.x, b.punto.y - a.punto.y);
    //  El camino ANDABLE si hay buscador y lo encuentra. Si no lo encuentra —un hueco
    //  encerrado— se cae a la recta y se CUENTA, porque entonces el total mezcla una medida
    //  con una cota y hay que poder decirlo.
    const camino = buscador ? buscador(a.punto, b.punto) : null;
    if (buscador && !camino) sinCamino += 1;
    const d = camino ? camino.metros : recta;
    const marcha = d / v;
    tramos.push({
      desde: a.parada,
      hasta: b.parada,
      puntoDesde: a.punto,
      puntoHasta: b.punto,
      metros: d,
      puntos: (camino?.puntos ?? []).map((q) => ({ x: q.x, y: q.y, z: 0 })),
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
    //  «Rodeando» solo si TODOS los tramos encontraron camino: con uno en recta, el total ya
    //  no es una medida entera y decir que lo es seria pasarse de listo.
    rodeando: Boolean(buscador) && sinCamino === 0 && tramos.length > 0,
    tramosSinCamino: sinCamino,
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

/**
 * HACIA DONDE MIRA quien hace el recorrido, en radianes.
 *
 * ── PARA QUE ──────────────────────────────────────────────────────────────────
 *
 * Para que la figura ande de frente. Sin rumbo, una persona recorre el almacén mirando
 * siempre al mismo sitio: se desliza de lado como un mueble arrastrado, y eso no se lee como
 * «andar», se lee como un fallo.
 *
 * ── LA CONVENCION ─────────────────────────────────────────────────────────────
 *
 * Se devuelve el ángulo con el que hay que girar alrededor del eje vertical para que el eje
 * **+Z del modelo** apunte en la dirección de la marcha, que es hacia donde miran los modelos
 * exportados con la convención de glTF.
 *
 * `atan2(dx, dz)` y no `atan2(dz, dx)`: el primero mide desde +Z, el segundo desde +X. Con el
 * orden cambiado la figura anda girada 90°, que es el error clásico de esto — y desde una
 * cámara alta cuesta verlo, porque una persona de espaldas y una de perfil se parecen—.
 *
 * `null` fuera del recorrido y en los tramos de duración cero: no hay dirección que medir, y
 * girar a 0 pondría a la figura mirando al norte por sorpresa. Quien llama conserva el último
 * rumbo, que es lo que hace alguien parado en una parada.
 */
export function rumboEn(sim: Simulacion, ms: number): number | null {
  if (sim.tramos.length === 0) return null;
  //  La MISMA guarda que `posicionEn`, y por el mismo motivo: sin ella, un instante negativo
  //  no salta el primer tramo y devuelve su rumbo — o sea, afirma una dirección en un momento
  //  del que el recorrido no dice nada—. Lo cazó la prueba.
  if (ms < 0 || ms > sim.duracionMs) return null;
  for (const t of sim.tramos) {
    if (ms > t.hastaMs) continue;
    /*
      Con camino andable, el rumbo sale del SUBTRAMO en el que se está, no de la recta entre
      paradas. Si saliera de la recta, la figura miraría hacia el destino mientras rodea un
      rack en perpendicular — andando de lado justo en el momento en el que se está viendo si
      cabe por el pasillo—.
    */
    const via = t.puntos.length >= 2 ? t.puntos : [t.puntoDesde, t.puntoHasta];
    const largo = t.hastaMs - t.desdeMs;
    const f = largo > 0 ? Math.min(1, Math.max(0, (ms - t.desdeMs) / largo)) : 0;
    //  Se reparte el tramo entre sus vértices por LONGITUD, no por número de vértices: dos
    //  subtramos de 1 m y 40 m no se recorren en el mismo tiempo.
    const total = largoDeVertices(via);
    if (total <= 0) return null;
    let acumulado = 0;
    for (let i = 1; i < via.length; i += 1) {
      const dx = via[i]!.x - via[i - 1]!.x;
      const dy = via[i]!.y - via[i - 1]!.y;
      const d = Math.hypot(dx, dy);
      if (acumulado + d >= f * total || i === via.length - 1) {
        if (d === 0) return null;
        return Math.atan2(dx, dy);
      }
      acumulado += d;
    }
    return null;
  }
  return null;
}

/** Longitud de una polilínea de puntos con `x` e `y`. */
function largoDeVertices(v: readonly { x: number; y: number }[]): number {
  let d = 0;
  for (let i = 1; i < v.length; i += 1) {
    d += Math.hypot(v[i]!.x - v[i - 1]!.x, v[i]!.y - v[i - 1]!.y);
  }
  return d;
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
