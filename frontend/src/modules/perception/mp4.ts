/**
 * LAS MEDIDAS DE UN MP4 SIN DECODIFICARLO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE ESTO
 *
 * Al subir un video, el ancho, el alto y la duracion los leia un `<video>`: se le daba el
 * archivo y se esperaba a `loadedmetadata`. Eso obliga al navegador a DECODIFICAR, y un
 * navegador sin decodificador H.265 —el caso normal en Windows sin la extension de
 * Microsoft— rechaza el archivo entero y devuelve `MEDIA_ERR_SRC_NOT_SUPPORTED`.
 *
 * Lo que pasaba entonces no era un error visible sino tres numeros a cero, y esos ceros
 * viajaban a la base como nulos. Con la duracion nula, el trabajo no sabia cuantos
 * fotogramas iba a analizar y anunciaba «1 de 1» mientras analizaba 212. Medido en
 * `DJI_20260308105811_0008_D`.
 *
 * Pero esos tres numeros NO estan en el video comprimido: estan en la cabecera del
 * contenedor, en texto estructurado, y no hace falta decodificar un solo pixel para
 * leerlos. Comprobado sobre ese mismo archivo que Chrome rechaza: da 3840x2160 y
 * 21,154 s, y 21,154 x 29,97 son los 634 fotogramas exactos que conto el worker.
 *
 * ── Y VALE PARA EL CODEC QUE VENGA ────────────────────────────────────────────
 *
 * Esta es la diferencia de fondo con «arreglar el H.265». Las cajas del MP4 son las
 * mismas para H.264, H.265, AV1 y lo que saque DJI el año que viene: aqui no se mira el
 * codec en ningun momento. La familia entera de fallos por «este navegador no sabe» se
 * cierra de una vez.
 *
 * ── SE LEEN TROZOS, NO EL ARCHIVO ─────────────────────────────────────────────
 *
 * `file.slice()` no carga nada: el navegador lee del disco solo el rango pedido. Se
 * recorren las cajas de primer nivel leyendo 16 bytes de cada una para saber su tamaño y
 * su tipo, y se salta a la siguiente. De un archivo de 252 MB se leen unos cientos de
 * kilobytes — y da igual que el `moov` este al final, que es donde lo deja el dron—.
 */

/** Lo que se puede saber de un video mirando solo su contenedor. */
export interface MedidasDeVideo {
  width: number;
  height: number;
  durationMs: number;
}

/** Cabecera de una caja: donde empieza su contenido y donde acaba la caja entera. */
interface Caja {
  tipo: string;
  cuerpo: number;
  fin: number;
}

const TEXTO = (v: DataView, off: number): string =>
  String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));

/**
 * La cabecera de la caja que empieza en `inicio`, o `null` si no cabe.
 *
 * `size === 1` significa que el tamaño real son 8 bytes de 64 bits —los videos de mas de
 * 4 GB lo usan— y `size === 0` que la caja llega hasta el final del archivo.
 */
function leerCabecera(v: DataView, inicio: number, finDelPadre: number): Caja | null {
  if (inicio + 8 > finDelPadre) return null;
  let tam = v.getUint32(inicio);
  const tipo = TEXTO(v, inicio + 4);
  let cuerpo = inicio + 8;
  if (tam === 1) {
    if (inicio + 16 > finDelPadre) return null;
    //  64 bits en dos mitades: `getBigUint64` no esta en todos los entornos de prueba.
    tam = v.getUint32(inicio + 8) * 2 ** 32 + v.getUint32(inicio + 12);
    cuerpo = inicio + 16;
  } else if (tam === 0) {
    tam = finDelPadre - inicio;
  }
  if (tam < 8) return null;
  return { tipo, cuerpo, fin: Math.min(inicio + tam, finDelPadre) };
}

/** Las cajas hijas dentro de un rango ya leido en memoria. */
function* cajas(v: DataView, desde: number, hasta: number): Generator<Caja> {
  let p = desde;
  while (p + 8 <= hasta) {
    const c = leerCabecera(v, p, hasta);
    if (!c) return;
    yield c;
    if (c.fin <= p) return; //  una caja que no avanza es un archivo corrupto, no un bucle
    p = c.fin;
  }
}

/**
 * Ancho, alto y duracion de un `moov` ya leido entero.
 *
 * Las medidas salen del `tkhd` de la pista de VIDEO, y de ahi la busqueda del primer
 * `trak` con medidas distintas de cero: un MP4 lleva tambien pistas de audio y de datos
 * —el dron mete telemetria— y sus `tkhd` traen ceros. Quedarse con el primero daria
 * 0x0 en cuanto el orden de las pistas cambiara.
 */
function medidasDeMoov(v: DataView, desde: number, hasta: number): MedidasDeVideo | null {
  let durationMs = 0;
  let width = 0;
  let height = 0;

  for (const c of cajas(v, desde, hasta)) {
    if (c.tipo === 'mvhd') {
      const version = v.getUint8(c.cuerpo);
      //  v0: escala y duracion en 32 bits tras dos fechas. v1: fechas de 64 y duracion de 64.
      const escala = version === 0 ? v.getUint32(c.cuerpo + 12) : v.getUint32(c.cuerpo + 20);
      const dur =
        version === 0
          ? v.getUint32(c.cuerpo + 16)
          : v.getUint32(c.cuerpo + 24) * 2 ** 32 + v.getUint32(c.cuerpo + 28);
      if (escala > 0) durationMs = (dur / escala) * 1000;
    }
    if (c.tipo !== 'trak') continue;
    for (const c2 of cajas(v, c.cuerpo, c.fin)) {
      if (c2.tipo !== 'tkhd') continue;
      const version = v.getUint8(c2.cuerpo);
      //  version+flags(4) + fechas y duracion (20 o 32) + reservado(16) + matriz(36)
      const base = c2.cuerpo + (version === 0 ? 24 : 36) + 16 + 36;
      if (base + 8 > c2.fin) continue;
      //  Punto fijo 16.16: los 16 bits altos son los pixeles.
      const an = v.getUint32(base) >>> 16;
      const al = v.getUint32(base + 4) >>> 16;
      if (an > 0 && al > 0 && width === 0) {
        width = an;
        height = al;
      }
    }
  }

  if (width === 0 || durationMs <= 0) return null;
  return { width, height, durationMs };
}

/**
 * Las medidas de un MP4, leyendo solo su cabecera.
 *
 * Devuelve `null` si el archivo no es un MP4 o si su cabecera no dice lo que hace falta.
 * `null` es «no lo se», y quien llama tiene que tratarlo como tal: inventar un tamaño por
 * convencion es exactamente como se llego al «1 de 1».
 */
export async function medidasDeMp4(file: Blob): Promise<MedidasDeVideo | null> {
  const total = file.size;
  let p = 0;
  //  Un tope de vueltas: un archivo corrupto no puede dejar la pestaña colgada.
  for (let vuelta = 0; vuelta < 200 && p + 8 <= total; vuelta += 1) {
    const cab = new DataView(await file.slice(p, Math.min(p + 16, total)).arrayBuffer());
    //  El limite que se pasa es lo que queda DEL ARCHIVO, no los 16 bytes que se acaban de
    //  leer. Con el buffer como limite, el `fin` de la caja se acotaba a 16 y el recorrido
    //  avanzaba de 16 en 16: sobre un `mdat` de 246 MB eso son 15 millones de vueltas —que
    //  el tope de 200 corta— y un archivo perfecto devolvia `null`.
    //
    //  Es seguro: `leerCabecera` no lee mas alla del byte 16, que es justo lo que hay.
    const c = leerCabecera(cab, 0, total - p);
    if (!c) return null;
    //  Sus offsets son relativos al trozo, que empieza en `p`: se devuelven al archivo.
    const cuerpo = p + c.cuerpo;
    const fin = Math.min(p + c.fin, total);
    if (c.tipo === 'moov') {
      const datos = new DataView(await file.slice(cuerpo, fin).arrayBuffer());
      return medidasDeMoov(datos, 0, datos.byteLength);
    }
    if (fin <= p) return null;
    p = fin;
  }
  return null;
}
