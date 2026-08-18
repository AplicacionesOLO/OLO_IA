/**
 * REPETIR UNA HILERA CON LOS CODIGOS REALES DEL CATALOGO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE PRUEBA Y POR QUE
 *
 * Repetir dejaba cada copia con el código del original y sin vincular, con el aviso «el código
 * real de cada una lo pones tú en el inspector». Con 318 racks por colocar, eso son 318
 * entradas a mano: el trabajo de verdad de montar un almacén no es la geometría, es teclear.
 *
 * El motivo de no inventarlos era bueno —`RCL02` sacado de `RCL01` produce racks que el WMS no
 * conoce— así que aquí no se inventan: se TOMAN del catálogo, de los que existen y aún no
 * están en el plano.
 *
 * Lo que se prueba es sobre todo que NO se pase de listo: que no salte de familia, que no
 * asigne un rack ya colocado, que no repita el mismo código dos veces y que se quede corto
 * antes que inventar. Un código mal asignado es un rack que en el WMS está en otro sitio, y
 * eso no da ningún error: da un almacén que miente.
 */

import { describe, expect, it } from 'vitest';

import { codigosParaRepetir, repetir } from './repetir';
import type { RackDisponible } from './repetir';
import type { PositionedRack } from './types';

function disponible(rackCode: string, length = 56.7): RackDisponible {
  return { rackCode, width: 1.1, length, height: 11.9 };
}

function rack(rackCode: string, over: Partial<PositionedRack> = {}): PositionedRack {
  return {
    layoutId: `l-${rackCode}`,
    rackCode,
    x: 100,
    y: 200,
    width: 1.1,
    length: 75.6,
    height: 11.9,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
}

describe('codigosParaRepetir', () => {
  it('sigue la serie del original', () => {
    const d = [disponible('RCL22'), disponible('RCL23'), disponible('RCL24')];
    expect(codigosParaRepetir('RCL21', d, 3).map((x) => x.rackCode)).toEqual([
      'RCL22',
      'RCL23',
      'RCL24',
    ]);
  });

  it('ordena por NUMERO y no por texto', () => {
    //  `RCL10` va después de `RCL9`. Ordenando como cadena, `RCL10` iría antes y la hilera
    //  saldría numerada al revés en el tramo del 9 al 10.
    const d = [disponible('RCL10'), disponible('RCL9'), disponible('RCL11')];
    expect(codigosParaRepetir('RCL8', d, 3).map((x) => x.rackCode)).toEqual([
      'RCL9',
      'RCL10',
      'RCL11',
    ]);
  });

  it('NO cambia de familia cuando se agota la suya', () => {
    /*
      Repetir `RCL21` no puede seguir por `PURT01` porque no queden RCL. Son otra cosa y están
      en otro sitio de la nave: asignarlos pondría un rack de PURT en medio de una hilera de
      RCL, y en el WMS ese rack está a cien metros.
    */
    const d = [disponible('RCL22'), disponible('PURT01'), disponible('MZ04')];
    expect(codigosParaRepetir('RCL21', d, 3).map((x) => x.rackCode)).toEqual(['RCL22']);
  });

  it('solo los que van DESPUES del original', () => {
    //  Los anteriores existen y están libres, pero van en la otra dirección: repetir hacia la
    //  derecha asignando códigos hacia atrás deja la hilera numerada al revés.
    const d = [disponible('RCL19'), disponible('RCL20'), disponible('RCL22')];
    expect(codigosParaRepetir('RCL21', d, 3).map((x) => x.rackCode)).toEqual(['RCL22']);
  });

  it('salta los que ya estan colocados, porque no estan disponibles', () => {
    //  `RCL22` no está en la lista: ya está en el plano. Le toca el siguiente libre, y la
    //  serie salta. No se corrige: meter `RCL22` dos veces sería peor que un salto.
    const d = [disponible('RCL23'), disponible('RCL25')];
    expect(codigosParaRepetir('RCL21', d, 2).map((x) => x.rackCode)).toEqual(['RCL23', 'RCL25']);
  });

  it('se queda CORTO antes que inventar o repetir', () => {
    //  Con dos disponibles y cinco copias devuelve dos. Las otras tres se quedan sin código y
    //  siguen el camino de antes: sin vincular, para ponerlo a mano.
    expect(codigosParaRepetir('RCL21', [disponible('RCL22'), disponible('RCL23')], 5)).toHaveLength(
      2,
    );
    expect(codigosParaRepetir('RCL21', [], 4)).toEqual([]);
  });

  it('nunca devuelve el mismo codigo dos veces', () => {
    const salida = codigosParaRepetir(
      'RCL21',
      [disponible('RCL22'), disponible('RCL23'), disponible('RCL24')],
      3,
    );
    expect(new Set(salida.map((x) => x.rackCode)).size).toBe(salida.length);
  });

  it('un codigo SIN numero no rompe el orden', () => {
    //  El catálogo tiene familias de una sola pieza: `S`, `BUFFER`, `PATIO`. No tienen número
    //  y no pueden reventar la comparación.
    const d = [disponible('S'), disponible('BUFFER')];
    expect(() => codigosParaRepetir('S', d, 2)).not.toThrow();
  });
});

describe('repetir con codigos asignados', () => {
  const PASO = 1; //  ppm de 1 para que los metros y los pixeles coincidan y se lea la cuenta

  it('cada copia lleva SU codigo y queda vinculada', () => {
    const copias = repetir([rack('RCL21')], PASO, { copias: 2, separacionM: 0, direccion: 'derecha' }, [
      disponible('RCL22'),
      disponible('RCL23'),
    ]);
    expect(copias.map((c) => c.rackCode)).toEqual(['RCL22', 'RCL23']);
    expect(copias.every((c) => c.linked)).toBe(true);
  });

  it('y sus MEDIDAS: una hilera no es una hilera de clones', () => {
    //  RCL21 mide 75,6 m y RCL31 mide 56,7. Sin las medidas del catálogo la copia se vería
    //  con el largo del original y el plano diría 75,6 donde hay 56,7.
    const copias = repetir([rack('RCL21')], PASO, { copias: 1, separacionM: 0, direccion: 'derecha' }, [
      disponible('RCL31', 56.7),
    ]);
    expect(copias[0]!.length).toBe(56.7);
  });

  it('sin codigos asignados se comporta como antes', () => {
    //  El camino de siempre: mismo código, sin vincular. Es lo que queda cuando el catálogo se
    //  agota, y tiene que seguir funcionando.
    const copias = repetir([rack('RCL21')], PASO, { copias: 2, separacionM: 0, direccion: 'derecha' });
    expect(copias.map((c) => c.rackCode)).toEqual(['RCL21', 'RCL21']);
    expect(copias.every((c) => c.linked)).toBe(false);
  });

  it('con VARIOS originales no asigna nada', () => {
    /*
      Con cuatro racks seleccionados no hay forma de saber a cuál de los cuatro le corresponde
      el siguiente código, y adivinarlo mezclaría hileras: el codigo de la fila de arriba
      acabaría en la de abajo. Se repite como antes y los códigos se ponen a mano.
    */
    const copias = repetir(
      [rack('RCL21'), rack('RCL22', { x: 200 })],
      PASO,
      { copias: 1, separacionM: 0, direccion: 'derecha' },
      [disponible('RCL23'), disponible('RCL24')],
    );
    expect(copias.every((c) => !c.linked)).toBe(true);
  });

  it('cada copia tiene su propio layoutId', () => {
    //  Dos racks con el mismo `layoutId` son el mismo rack para la selección y para el
    //  historial: mover uno movería los dos.
    const copias = repetir([rack('RCL21')], PASO, { copias: 3, separacionM: 0, direccion: 'abajo' }, [
      disponible('RCL22'),
      disponible('RCL23'),
      disponible('RCL24'),
    ]);
    expect(new Set(copias.map((c) => c.layoutId)).size).toBe(3);
  });
});
