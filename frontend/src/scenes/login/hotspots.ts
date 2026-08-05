/**
 * COORDENADAS SOBRE EL DIBUJO DEL ALMACEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARCHIVO SE HA QUEDADO CASI VACIO, Y ESO ES EL ARREGLO
 *
 * Tenía cuatro «hotspots» con caja, ancla, etiqueta y punto de evento, más una
 * secuencia de demostración. Su propio comentario admitía que «las posiciones deben
 * calibrarse una vez el asset real esté colocado» y nunca se calibraron.
 *
 * Al superponer una rejilla de porcentajes sobre `warehouse-base.webp` apareció el
 * motivo de fondo: el dibujo NO es una foto, es un render que YA INCLUYE la interfaz.
 * Trae pintadas sus etiquetas de hilera («RCL-01 112 ubicaciones», «RCL-03 32»,
 * «RCL-05 98», «RCL-07 32»), sus guías de nivel N01…N07, sus etiquetas de cuerpo
 * C001…C012, un panel «ESTADO DEL SISTEMA» abajo a la izquierda y dos pallets
 * resaltados en cian.
 *
 * O sea que no había nada que calibrar: había que dejar de dibujar una segunda copia de
 * lo que ya estaba. Las cuatro cajas y las cuatro etiquetas se han ido.
 *
 * ── LO QUE QUEDA ────────────────────────────────────────────────────────────
 *
 * Las dimensiones del asset —que el `<img>` necesita para reservar sitio y el SVG para
 * su `viewBox`— y UN punto: el pallet que el dibujo ya destaca, donde el overlay pone su
 * anillo. Coincidir con el resaltado del dibujo es lo que hace que se lea como el
 * sistema respirando y no como un adorno pegado encima.
 */

/**
 * Dimensiones naturales del asset.
 *
 * Se usan para el `width`/`height` del `<img>` —que evita el salto de maquetación
 * mientras carga— y para el `viewBox` del overlay. Si se cambia la imagen por otra de
 * distinto tamaño, hay que actualizarlas aquí: es lo único que ata las dos capas al
 * mismo sistema de coordenadas.
 */
export const ASSET_NATURAL_WIDTH = 1536;
export const ASSET_NATURAL_HEIGHT = 1024;

/** Porcentaje del asset → píxeles del asset, que es en lo que trabaja el overlay. */
export const toPxX = (pct: number): number => (pct / 100) * ASSET_NATURAL_WIDTH;
export const toPxY = (pct: number): number => (pct / 100) * ASSET_NATURAL_HEIGHT;

/**
 * El pallet que el dibujo ya tiene resaltado, en % del asset.
 *
 * Leído sobre la rejilla y luego CORREGIDO sobre el render: en la rejilla parecía (69,
 * 68) y al verlo dibujado el anillo caía ocho puntos por debajo del resaltado, sobre el
 * rack de abajo. Medido en la captura —el pallet brillante en x 735 de un dibujo de 1045
 * de ancho, y 620 de una franja que empieza en 205 y mide 697— sale (70,5, 59,5).
 *
 * La diferencia entre leer una rejilla y comprobar el resultado: los ocho puntos.
 *
 * Si se cambia el dibujo, este punto deja de significar nada y hay que volver a leerlo.
 * No se puede deducir del código, y por eso está aquí solo y con su nota.
 */
export const PUNTO_VIVO = { x: 70.5, y: 59.5 } as const;
