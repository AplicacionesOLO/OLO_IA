/**
 * QUE COLOR LLEVA UN HUECO SEGUN LO QUE DIJO EL WMS.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LO QUE NO SE PINTA ES LA MITAD DE LA INFORMACION
 *
 * Un hueco `DISP` —disponible, vacío— NO se dibuja. Y es la decisión más importante de este
 * archivo.
 *
 * Pintar las 9.673 celdas convierte cada rack en una losa de color: desaparecen los
 * largueros, los montantes y la división entre las dos posiciones de cada cuerpo, o sea
 * justo la estantería que se construyó para poder contar hasta el C018. Y encima el color
 * más repetido sería el del hueco vacío, que es el que menos dice.
 *
 * Dejando el vacío sin pintar se ve a través de él: se lee el hierro, y el color queda para
 * donde hay algo. «Dónde está el stock» se responde de un vistazo, que es la pregunta.
 *
 * Es el mismo criterio que ya seguía la capa de inspección —«sin leer» no se pinta— y por la
 * misma razón: rellenar de gris todo lo que no se sabe tapa lo poco que sí se sabe.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA INSPECCION MANDA SOBRE EL WMS
 *
 * Cuando un hueco tiene lectura del dron, se pinta con el color de la inspección y no con
 * este. No es una preferencia estética: una es una OBSERVACION y la otra una DECLARACION de
 * hace veinte días. Si el WMS dice `OCUP` y el dron vio el hueco vacío, lo que hay que ver
 * en el plano es la discrepancia, no la declaración.
 *
 * Quien pinta aplica ese orden; aquí solo está el color del WMS.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL VOCABULARIO ES ABIERTO
 *
 * `OCUP`, `DISP`, `BLOQ`, `BLOQES`, `BLOQFI`, `RESREC`, `PROB` son los siete que aparecen hoy
 * en los 30 racks colocados. Pero el WMS puede traer otros, así que una palabra desconocida
 * NO se descarta: se pinta en un color neutro que dice «hay algo y no sé qué es». Descartarla
 * haría que un almacén con vocabulario nuevo se viera medio vacío sin avisar.
 */

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * LOS TRES MODOS, Y POR QUE SON TRES PREGUNTAS DISTINTAS
 *
 *   `dron`      lo que se ha VISTO. Hoy son 5 huecos de 9.673, y el vacío es el mensaje: la
 *               cobertura es del 0,05 %. Un plano casi negro dice eso mejor que un número.
 *   `wms`       lo que el sistema CREE que tiene. 8.654 huecos.
 *   `comparar`  solo donde hay las DOS cosas, pintado por si coinciden. Contesta «¿dónde se
 *               equivoca el sistema?», que es la pregunta que justifica el dron.
 *
 * Mezclarlos en uno era lo que había antes —la inspección tapaba al WMS— y eso contesta las
 * tres preguntas a medias: no se puede saber si un hueco sin color es que nadie lo miró o que
 * el WMS lo declara vacío.
 *
 * En `comparar` un hueco con una sola fuente NO se pinta. Comparar necesita dos, y pintar el
 * que solo tiene una lo haría pasar por comprobado.
 * ═════════════════════════════════════════════════════════════════════════════
 */
export type ModoDeOcupacion = 'dron' | 'wms' | 'comparar';

/** Cómo se llama cada modo en el conmutador, y qué contesta. */
export const MODOS_DE_OCUPACION: ReadonlyArray<{
  modo: ModoDeOcupacion;
  etiqueta: string;
  ayuda: string;
}> = [
  { modo: 'dron', etiqueta: 'dron', ayuda: 'Solo lo que se ha visto de verdad' },
  { modo: 'wms', etiqueta: 'WMS', ayuda: 'Solo lo que el sistema dice que tiene' },
  {
    modo: 'comparar',
    etiqueta: 'comparar',
    ayuda: 'Solo los huecos con las dos cosas, pintados por si coinciden',
  },
];

import { COLOR_SLOT } from './inspection';
import type { EstadoDeSlot } from './inspection';

/** Un hueco a pintar: color, cuánto se ve, y cómo se llama en la leyenda. */
export interface PinturaDeHueco {
  color: string;
  /** De 0 a 1. Los bloqueos van más opacos: son la excepción y hay que verlos. */
  opacidad: number;
  etiqueta: string;
}

/**
 * Cuánto se ve un hueco ocupado.
 *
 * Bajo a propósito. Es el color más repetido —7.090 de 9.673 celdas— y a 0,9 los racks
 * volvían a ser losas. A 0,55 se ve que el hueco está lleno y se sigue leyendo el larguero
 * por detrás.
 */
const OPACIDAD_OCUPADO = 0.55;

/** Y los bloqueos, más opacos: son 1.887 de 9.673 y son lo que hay que localizar. */
const OPACIDAD_BLOQUEO = 0.8;

/**
 * El color de una situación del WMS, o `null` si ese hueco NO se pinta.
 *
 * @param situacion La palabra del WMS, tal cual. `null` cuando la ubicación no la declara.
 * @param conflicto Si el WMS se contradice consigo mismo para este hueco: dice `BLOQ…` y a
 *   la vez que está disponible, o `DISP` y que está bloqueado. Son 86 de 9.673, y llevan su
 *   propio color porque no son un estado del almacén sino un problema del dato.
 */
export function pinturaDeSituacion(
  situacion: string | null | undefined,
  conflicto: boolean,
): PinturaDeHueco | null {
  //  El conflicto se pinta ANTES de mirar la palabra: es lo que hay que ver, y da igual si el
  //  hueco además está ocupado. Un dato que se contradice no se puede usar para decidir.
  if (conflicto) {
    return { color: '#c026d3', opacidad: 0.85, etiqueta: 'el WMS se contradice' };
  }

  const s = (situacion ?? '').toUpperCase();

  //  Vacío declarado: NO se pinta. Ver la cabecera.
  if (s === 'DISP') return null;

  if (s === 'OCUP') {
    return { color: '#38bdf8', opacidad: OPACIDAD_OCUPADO, etiqueta: 'ocupado' };
  }
  //  Todos los bloqueos empiezan por BLOQ y son motivos distintos: `BLOQES` es uno y `BLOQFI`
  //  otro. Se distinguen porque quien mira un almacén bloqueado quiere saber por qué, y
  //  colapsarlos en «bloqueado» perdería justo eso.
  if (s === 'BLOQ') return { color: '#f59e0b', opacidad: OPACIDAD_BLOQUEO, etiqueta: 'bloqueado' };
  if (s === 'BLOQES') {
    return { color: '#f87171', opacidad: OPACIDAD_BLOQUEO, etiqueta: 'bloqueado (ES)' };
  }
  if (s === 'BLOQFI') {
    return { color: '#fb923c', opacidad: OPACIDAD_BLOQUEO, etiqueta: 'bloqueado (FI)' };
  }
  if (s.startsWith('BLOQ')) {
    return { color: '#f59e0b', opacidad: OPACIDAD_BLOQUEO, etiqueta: `bloqueado (${s.slice(4)})` };
  }
  if (s === 'RESREC') {
    return { color: '#a78bfa', opacidad: OPACIDAD_OCUPADO, etiqueta: 'reservado' };
  }
  if (s === 'PROB') {
    return { color: '#facc15', opacidad: OPACIDAD_BLOQUEO, etiqueta: 'con problema' };
  }

  //  Sin declarar tampoco se pinta: no es lo mismo que estar vacío, pero tampoco hay nada que
  //  afirmar. Aparece en cero celdas hoy y el día que aparezca es mejor un hueco transparente
  //  que un color inventado.
  if (s === '') return null;

  //  Y una palabra que no conocemos SÍ se pinta, en neutro: el WMS declara algo de ese hueco
  //  y no saber qué es no lo convierte en vacío.
  return { color: '#94a3b8', opacidad: OPACIDAD_OCUPADO, etiqueta: `sin traducir (${s})` };
}

/**
 * La leyenda de lo que hay EN ESTA escena, no del vocabulario entero.
 *
 * Una leyenda con las siete palabras posibles en un almacén donde solo hay tres es ruido que
 * hay que leer para descartar. Se construye de lo que se ha pintado, y en el orden en que
 * llegó, que es el orden de frecuencia con el que la API los sirve.
 *
 * `DISP` no aparece: no se pinta, así que no hay color que explicar. Lo que sí aparece es
 * cuántas hay, porque «no se ve nada ahí» y «ahí no hay nada» son dos lecturas distintas y
 * la única forma de distinguirlas es el número.
 */
export function leyendaDeOcupacion(
  situaciones: readonly string[],
  cuentas: ReadonlyMap<string, number>,
): { etiqueta: string; color: string; cuenta: number }[] {
  const salida: { etiqueta: string; color: string; cuenta: number }[] = [];
  const vistas = new Set<string>();
  for (const s of situaciones) {
    const p = pinturaDeSituacion(s, false);
    if (!p || vistas.has(p.etiqueta)) continue;
    vistas.add(p.etiqueta);
    salida.push({ etiqueta: p.etiqueta, color: p.color, cuenta: cuentas.get(s) ?? 0 });
  }
  const enConflicto = cuentas.get('__conflicto__') ?? 0;
  if (enConflicto > 0) {
    const p = pinturaDeSituacion(null, true)!;
    salida.push({ etiqueta: p.etiqueta, color: p.color, cuenta: enConflicto });
  }
  return salida;
}

// ═════════════════════════════════════════════════════════════════════════════
// LO QUE LLEGA DE LA API, YA EN NOMBRES DE ESTE LADO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * La situacion del WMS de cada hueco de los racks colocados.
 *
 * Las celdas vienen en listas de cinco numeros —`[cuerpo, nivel, posicion, situacion,
 * conflicto]`— y no como objetos, porque son 9.673 hoy y 29.312 con el catalogo entero: un
 * objeto por celda son 4,4 MB por la red de un almacen para pintar un plano, y asi son 122 KB.
 */
export interface OcupacionDeHuecos {
  /** Cuando acabo la importacion que trajo esto. `null` si no consta. */
  importadoEl: string | null;
  /** El vocabulario que aparece de verdad. El indice de cada celda apunta aqui. */
  situaciones: readonly string[];
  racks: readonly { rackNodeId: string; celdas: readonly number[][] }[];
  celdas: number;
  conflictos: number;
  /** Huecos de racks colocados sin cuerpo o nivel: no hay celda que pintar. */
  sinCelda: number;
}

/** Los indices de una celda, con nombre. Es lo unico que un array de cinco no explica solo. */
export const CELDA = { cuerpo: 0, nivel: 1, posicion: 2, situacion: 3, conflicto: 4 } as const;

/**
 * EL COLOR DE UN HUECO EN EL MODO ELEGIDO. `null` = no se pinta.
 *
 * Una sola función para los tres modos, y no tres ramas dentro del bucle que dibuja: es la
 * decisión de qué significa cada color, y ahí es donde se equivoca uno. Con la regla aquí se
 * puede probar sin abrir una tarjeta gráfica, que es lo mismo que se hizo con la estantería.
 *
 * @param lectura El estado ya reducido de la lectura del dron, o `null` si no hay ninguna.
 *   `sin_leer` cuenta como no haber: es el estado inicial de las 29.312.
 * @param wms Lo que el WMS declara de ese hueco, o `null` si no llega el dato.
 */
export function pinturaDeHueco(
  modo: ModoDeOcupacion,
  lectura: EstadoDeSlot | null,
  wms: { situacion: string; conflicto: boolean } | null,
): PinturaDeHueco | null {
  const vista = lectura && lectura !== 'sin_leer' ? lectura : null;

  if (modo === 'dron') {
    if (!vista) return null;
    //  La lectura va opaca: es la única observación que hay y son cinco entre 9.673.
    return { color: COLOR_SLOT[vista].color, opacidad: 0.9, etiqueta: COLOR_SLOT[vista].etiqueta };
  }

  if (modo === 'wms') {
    //  Aquí la lectura NO manda: el modo pregunta por lo que dice el sistema, y taparlo con lo
    //  observado sería contestar otra cosa.
    return wms ? pinturaDeSituacion(wms.situacion, wms.conflicto) : null;
  }

  //  `comparar`: hacen falta las dos. Con una sola no hay comparación, y pintarla la haría
  //  pasar por comprobada.
  if (!vista || !wms) return null;
  //  El estado de la lectura YA es el resultado de comparar con el WMS —lo calculó la
  //  reconciliación— así que el color es el suyo. Escribir aquí una segunda comparación sería
  //  tener dos veredictos sobre el mismo hueco.
  return {
    color: COLOR_SLOT[vista].color,
    opacidad: 0.9,
    etiqueta: COLOR_SLOT[vista].etiqueta,
  };
}

