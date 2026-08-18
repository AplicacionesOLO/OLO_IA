/**
 * EL COLOR DE UN HUECO SEGUN EL WMS.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE PRUEBA
 *
 * Sobre todo lo que NO se pinta, que es la decisión de fondo: un hueco vacío se deja
 * transparente para que se lea la estantería por detrás. Si alguien «arregla» eso pintándolo,
 * los racks vuelven a ser losas de color y desaparece el hierro que se construyó para poder
 * contar hasta el C018 — y no daría ningún error, solo se vería mal—.
 *
 * Y el vocabulario ABIERTO: el WMS puede traer una palabra nueva, y esa celda tiene que
 * pintarse igual. Descartar lo desconocido haría que un almacén con vocabulario nuevo se
 * viera medio vacío sin avisar de nada.
 */

import { describe, expect, it } from 'vitest';

import { leyendaDeOcupacion, pinturaDeSituacion } from './ocupacion';

describe('pinturaDeSituacion', () => {
  it('un hueco VACIO no se pinta', () => {
    //  La decisión de fondo. Ver la cabecera.
    expect(pinturaDeSituacion('DISP', false)).toBeNull();
  });

  it('un hueco ocupado se pinta, y se ve a traves', () => {
    const p = pinturaDeSituacion('OCUP', false)!;
    expect(p.color).toBeTruthy();
    //  Es el color más repetido —7.090 de 9.673— así que no puede tapar la estantería.
    expect(p.opacidad).toBeLessThan(0.7);
  });

  it('los bloqueos van MAS opacos que lo ocupado', () => {
    //  Son la excepción y son lo que se busca al mirar un almacén. Con la misma opacidad que
    //  lo ocupado se perderían entre 7.090 celdas azules.
    const ocupado = pinturaDeSituacion('OCUP', false)!;
    for (const b of ['BLOQ', 'BLOQES', 'BLOQFI']) {
      expect(pinturaDeSituacion(b, false)!.opacidad).toBeGreaterThan(ocupado.opacidad);
    }
  });

  it('los tres bloqueos se distinguen entre si', () => {
    //  `BLOQES` y `BLOQFI` son motivos distintos. Colapsarlos en «bloqueado» perdería lo que
    //  de verdad se quiere saber al ver un hueco bloqueado: por qué.
    const colores = ['BLOQ', 'BLOQES', 'BLOQFI'].map((s) => pinturaDeSituacion(s, false)!.color);
    expect(new Set(colores).size).toBe(3);
    const etiquetas = ['BLOQ', 'BLOQES', 'BLOQFI'].map(
      (s) => pinturaDeSituacion(s, false)!.etiqueta,
    );
    expect(new Set(etiquetas).size).toBe(3);
  });

  it('un bloqueo con sufijo NUEVO se reconoce como bloqueo', () => {
    //  Vocabulario abierto: el día que aparezca `BLOQXX` sigue siendo un bloqueo, y decirlo
    //  es mejor que pintarlo de neutro como si no se supiera nada.
    const p = pinturaDeSituacion('BLOQXX', false)!;
    expect(p.etiqueta).toMatch(/bloqueado/);
    expect(p.opacidad).toBeGreaterThan(0.7);
  });

  it('una palabra desconocida SI se pinta, en neutro', () => {
    /*
      No se descarta. El WMS declara algo de ese hueco y no saber qué es no lo convierte en
      vacío: descartándola, un almacén con vocabulario nuevo se vería medio vacío y nadie
      sabría que falta información.
    */
    const p = pinturaDeSituacion('RESPRO', false)!;
    expect(p).not.toBeNull();
    expect(p.etiqueta).toContain('RESPRO');
  });

  it('sin declarar no se pinta, y no es lo mismo que vacio', () => {
    //  No hay nada que afirmar. Un color inventado sobre un dato que no existe es peor que un
    //  hueco transparente.
    expect(pinturaDeSituacion(null, false)).toBeNull();
    expect(pinturaDeSituacion('', false)).toBeNull();
    expect(pinturaDeSituacion(undefined, false)).toBeNull();
  });

  it('el CONFLICTO manda sobre la palabra, sea la que sea', () => {
    /*
      Un hueco donde el WMS dice `BLOQ…` y a la vez que está disponible no es un estado del
      almacén: es un problema del dato, y con él no se puede decidir nada. Son 86 de 9.673.

      Manda incluso sobre `DISP`, que normalmente no se pinta: un vacío que se contradice hay
      que verlo.
    */
    const p = pinturaDeSituacion('DISP', true);
    expect(p).not.toBeNull();
    expect(p!.etiqueta).toMatch(/contradice/);
    for (const s of ['OCUP', 'BLOQ', 'BLOQES', null]) {
      expect(pinturaDeSituacion(s, true)!.color).toBe(p!.color);
    }
  });

  it('da igual como venga escrita la palabra', () => {
    expect(pinturaDeSituacion('ocup', false)!.etiqueta).toBe('ocupado');
    expect(pinturaDeSituacion('disp', false)).toBeNull();
  });
});

describe('leyendaDeOcupacion', () => {
  it('solo lo que hay en ESTA escena, con su cuenta', () => {
    //  Una leyenda con las siete palabras posibles en un almacén donde hay tres es ruido que
    //  hay que leer para descartar.
    const l = leyendaDeOcupacion(
      ['OCUP', 'BLOQES'],
      new Map([
        ['OCUP', 7090],
        ['BLOQES', 1168],
      ]),
    );
    expect(l.map((x) => x.etiqueta)).toEqual(['ocupado', 'bloqueado (ES)']);
    expect(l.map((x) => x.cuenta)).toEqual([7090, 1168]);
  });

  it('el vacio NO sale en la leyenda: no hay color que explicar', () => {
    const l = leyendaDeOcupacion(['DISP', 'OCUP'], new Map([['OCUP', 10]]));
    expect(l.map((x) => x.etiqueta)).toEqual(['ocupado']);
  });

  it('el conflicto sale al final y solo si hay alguno', () => {
    //  Al final porque no es un estado del almacén sino un problema del dato, y solo si hay
    //  alguno porque una leyenda que anuncia un color que no aparece hace buscarlo.
    expect(leyendaDeOcupacion(['OCUP'], new Map([['OCUP', 3]]))).toHaveLength(1);
    const con = leyendaDeOcupacion(
      ['OCUP'],
      new Map([
        ['OCUP', 3],
        ['__conflicto__', 86],
      ]),
    );
    expect(con).toHaveLength(2);
    expect(con[1]!.etiqueta).toMatch(/contradice/);
    expect(con[1]!.cuenta).toBe(86);
  });

  it('no repite una etiqueta cuando dos palabras dan el mismo color', () => {
    //  `BLOQXX` y `BLOQYY` caen los dos en el bloqueo genérico. Dos filas iguales en la
    //  leyenda se leen como dos cosas distintas.
    const l = leyendaDeOcupacion(['BLOQ', 'BLOQ'], new Map([['BLOQ', 5]]));
    expect(l).toHaveLength(1);
  });
});
