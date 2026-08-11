/**
 * QUE CODIGO LEIDO IDENTIFICA UN HUECO, Y CUAL NO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA VIENE DEL ALMACEN, NO DE LA VISION
 *
 * `RCL51-C020` es un cuerpo de estanteria —una «altura»— y en el WMS el operador elige el
 * nivel a mano. Una lectura asi no dice en que hueco esta el pallet: dice en que columna.
 * Tratarla como ubicacion seria inventar una precision que la etiqueta no tiene.
 *
 * Solo cuenta el codigo completo —rack, cuerpo, nivel y posicion, `RCL51-C020-N01-2`—, que
 * es el que llevan las etiquetas nuevas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTA DUPLICADO A PROPOSITO, Y ESTA DICHO
 *
 * La misma regla vive en `backend/tools/inferir.py::es_ubicacion_completa`, porque el worker
 * la necesita para reclasificar una lectura incompleta como `etiqueta_ilegible` en el momento
 * de detectarla, y esta pantalla la necesita para decidir si ofrece el boton del mapa.
 *
 * No se comparte por HTTP porque preguntarle al servidor «¿esto tiene cuatro segmentos?»
 * seria un viaje de red para contar guiones. Si la regla cambia, hay que cambiar los dos
 * sitios — y por eso los dos llevan este comentario.
 */

/** Cuantos segmentos tiene una ubicacion COMPLETA: rack, cuerpo, nivel y posicion. */
export const SEGMENTOS_UBICACION = 4;

/**
 * Si el codigo identifica un HUECO concreto.
 *
 * Se cuentan SEGMENTOS y no se valida la forma de cada uno: el formato del rack cambia
 * entre almacenes y una expresion regular ajustada a `RCL` rechazaria el siguiente. Lo que
 * no cambia es que una ubicacion completa baja cuatro niveles.
 *
 * Los vacios se descartan: sin eso, `RCL51-C020-` colaria como si tuviera los cuatro.
 */
export function esUbicacionCompleta(codigo: string | null | undefined): boolean {
  if (!codigo) return false;
  return codigo.trim().split('-').filter(Boolean).length >= SEGMENTOS_UBICACION;
}

/**
 * El rack de un codigo de hueco: su primer segmento.
 *
 * Sirve para decir «RCL47» en la pantalla sin tener que preguntar al catalogo. Para ABRIR
 * el mapa no basta —el explorador espacial navega por identificadores, no por codigos— y de
 * eso se encarga la busqueda del hueco.
 */
export function rackDelCodigo(codigo: string): string | null {
  const partes = codigo.trim().split('-').filter(Boolean);
  return partes.length ? partes[0]! : null;
}
