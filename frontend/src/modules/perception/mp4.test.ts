/**
 * LEER LA CABECERA DE UN MP4 SIN DECODIFICARLO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE PRUEBA Y POR QUE
 *
 * Que las medidas salen aunque el navegador no sepa nada del codec, que es todo el
 * motivo de este modulo. Los casos estan copiados de archivos reales:
 *
 *   · el `moov` AL FINAL, detras de 246 MB de `mdat`. Es donde lo deja el dron, y un
 *     lector que solo mire el principio del archivo no encuentra nada.
 *   · una pista de VIDEO detras de otras que traen ceros. El dron mete telemetria, y
 *     quedarse con el primer `trak` devolveria 0x0.
 *
 * Y sobre todo: que `null` sigue siendo `null`. La tentacion al ver un archivo raro es
 * devolver algo aproximado, y un tamaño inventado es exactamente como se llego a un
 * trabajo que anunciaba «1 de 1» mientras analizaba 212 fotogramas.
 */

import { describe, expect, it } from 'vitest';

import { medidasDeMp4 } from './mp4';

// ── Un MP4 de mentira, con las cajas de verdad ────────────────────────────────

function caja(tipo: string, cuerpo: Uint8Array): Uint8Array {
  const salida = new Uint8Array(8 + cuerpo.length);
  new DataView(salida.buffer).setUint32(0, salida.length);
  for (let i = 0; i < 4; i += 1) salida[4 + i] = tipo.charCodeAt(i);
  salida.set(cuerpo, 8);
  return salida;
}

function unir(...trozos: Uint8Array[]): Uint8Array {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const salida = new Uint8Array(total);
  let p = 0;
  for (const t of trozos) {
    salida.set(t, p);
    p += t.length;
  }
  return salida;
}

/** `mvhd` version 0: escala de tiempo y duracion en 32 bits. */
function mvhd(escala: number, duracion: number): Uint8Array {
  const c = new Uint8Array(100);
  const v = new DataView(c.buffer);
  v.setUint32(12 - 8 + 8, escala); //  offset 12 del cuerpo
  v.setUint32(16 - 8 + 8, duracion);
  //  Los offsets de arriba estan escritos como en el lector: 12 y 16 desde el cuerpo.
  v.setUint32(12, escala);
  v.setUint32(16, duracion);
  return caja('mvhd', c);
}

/** `tkhd` version 0 con ancho y alto en punto fijo 16.16. */
function tkhd(ancho: number, alto: number): Uint8Array {
  const c = new Uint8Array(84);
  const v = new DataView(c.buffer);
  const base = 24 + 16 + 36; //  lo mismo que calcula el lector
  v.setUint32(base, ancho << 16);
  v.setUint32(base + 4, alto << 16);
  return caja('tkhd', c);
}

function mp4({
  ancho = 3840,
  alto = 2160,
  escala = 30000,
  duracion = 634634,
  pistasVacias = 0,
  mdat = 4096,
  moovAlFinal = true,
} = {}): Blob {
  const traks: Uint8Array[] = [];
  for (let i = 0; i < pistasVacias; i += 1) traks.push(caja('trak', tkhd(0, 0)));
  traks.push(caja('trak', tkhd(ancho, alto)));
  const moov = caja('moov', unir(mvhd(escala, duracion), ...traks));
  const ftyp = caja('ftyp', new Uint8Array(20));
  const grande = caja('mdat', new Uint8Array(mdat));
  return new Blob([moovAlFinal ? unir(ftyp, grande, moov) : unir(ftyp, moov, grande)]);
}

describe('medidasDeMp4', () => {
  it('saca las medidas del contenedor, sin decodificar nada', async () => {
    //  Los numeros del archivo real: 3840x2160 y 21,154 s. 634634/30000 = 21,154.
    const m = await medidasDeMp4(mp4());
    expect(m).toEqual({ width: 3840, height: 2160, durationMs: 21154.466666666667 });
  });

  it('encuentra el `moov` aunque este DETRAS del video', async () => {
    //  Es donde lo deja el dron: en el archivo real, detras de 246 MB de `mdat`. Un lector
    //  que solo mire los primeros kilobytes devuelve `null` sobre un archivo perfecto.
    const alFinal = await medidasDeMp4(mp4({ moovAlFinal: true, mdat: 300_000 }));
    const alPrincipio = await medidasDeMp4(mp4({ moovAlFinal: false, mdat: 300_000 }));
    expect(alFinal).toEqual(alPrincipio);
    expect(alFinal?.width).toBe(3840);
  });

  it('se salta las pistas SIN medidas y coge la de video', async () => {
    //  El dron mete telemetria en pistas propias, y sus `tkhd` traen ceros. Quedarse con
    //  el primer `trak` daria 0x0 y el diagnostico se quedaria sin poder medir nada.
    const m = await medidasDeMp4(mp4({ pistasVacias: 2 }));
    expect(m).toEqual({ width: 3840, height: 2160, durationMs: 21154.466666666667 });
  });

  it('lo que no es un MP4 devuelve null, no un tamaño inventado', async () => {
    expect(await medidasDeMp4(new Blob([new Uint8Array(64)]))).toBeNull();
    expect(await medidasDeMp4(new Blob([]))).toBeNull();
    expect(await medidasDeMp4(new Blob([new TextEncoder().encode('no soy un video')]))).toBeNull();
  });

  it('un MP4 sin `moov` tambien es null', async () => {
    //  Un archivo cortado a mitad de subida. Decir «0x0» de el seria afirmar algo falso.
    const ftyp = caja('ftyp', new Uint8Array(20));
    const mdat = caja('mdat', new Uint8Array(1000));
    expect(await medidasDeMp4(new Blob([unir(ftyp, mdat)]))).toBeNull();
  });

  it('una caja de tamaño cero no cuelga la pestaña', async () => {
    //  `size = 0` significa «hasta el final», y una implementacion ingenua se queda en el
    //  sitio y gira para siempre. Sobre un archivo corrupto eso congela la pagina.
    const raro = new Uint8Array(32);
    new DataView(raro.buffer).setUint32(0, 0);
    for (let i = 0; i < 4; i += 1) raro[4 + i] = 'free'.charCodeAt(i);
    expect(await medidasDeMp4(new Blob([raro]))).toBeNull();
  });
});
