/**
 * EL MUNDO 3D, COMPROBADO SIN TARJETA GRAFICA.
 *
 * Lo que se prueba es la correspondencia de ejes y la numeración de los huecos, que son
 * las dos cosas que, si se torcieran, producirían una pantalla convincente y equivocada:
 * racks perpendiculares intercambiados, o el estado de un hueco pintado sobre su vecino.
 *
 * Ya pasó en el visor axonométrico —el eje girado 90°, semanas en pantalla— y la lección
 * fue que estas cuentas tienen que ser funciones puras con pruebas, no líneas dentro de un
 * bucle de dibujado.
 */

import { describe, expect, it } from 'vitest';

import { componerEscena } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';
import type { PositionedRack } from '../editor/types';
import type { FloorPlanCell } from '../types/index';
import {
  cajaDeRack,
  celdasDeRack,
  claveDeHueco,
  cuantasPlacas,
  encuadreDe,
  placasDeHuecos,
} from './mundo';

function rack(over: Partial<PositionedRack> = {}): PositionedRack {
  return {
    layoutId: 'l1',
    rackCode: 'RCL47',
    x: 0,
    y: 0,
    width: 1.1,
    length: 8,
    height: 7,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
}

function celda(over: Partial<FloorPlanCell> = {}): FloorPlanCell {
  return {
    rackId: 'uuid-rcl47',
    rackCode: 'RCL47',
    rackExternalCode: null,
    rackIndex: null,
    nodeType: 'rack',
    nodeFunction: null,
    functionLabel: null,
    aisleId: null,
    aisleCode: null,
    bayCount: 4,
    maxLevel: 5,
    maxPosition: 2,
    locationCount: 40,
    availableCount: 40,
    blockedCount: 0,
    minLogicalX: null,
    maxLogicalX: null,
    minLogicalY: null,
    maxLogicalY: null,
    ...over,
  } as FloorPlanCell;
}

/** Un rack del dominio, ya en metros, como lo produce el editor. */
function enEscena(overRack: Partial<PositionedRack> = {}, overCat: Partial<FloorPlanCell> = {}) {
  return componerEscena(
    [rack(overRack)],
    1,
    { x: 0, y: 0 },
    [celda(overCat)],
    new Map(),
  )[0]!;
}

describe('la correspondencia de ejes', () => {
  it('el suelo del dominio va a x y z, y la altura a y', () => {
    const r = enEscena({ x: 12, y: 34, width: 1.1, length: 8, height: 7 });
    const c = cajaDeRack(r);
    //  x del dominio → x; y del dominio → z. Confundirlos pone el almacén transpuesto.
    expect(c.posicion[0]).toBeCloseTo(12, 6);
    expect(c.posicion[2]).toBeCloseTo(34, 6);
    //  A media altura: una caja se centra en su origen y el dominio la da apoyada.
    expect(c.posicion[1]).toBeCloseTo(3.5, 6);
  });

  it('ancho va al eje x local y largo al z local, como en el lienzo 2D', () => {
    const c = cajaDeRack(enEscena({ width: 1.1, length: 56.7, height: 11.9 }));
    expect(c.escala).toEqual([1.1, 11.9, 56.7]);
  });

  it('el giro es el mismo angulo en sentido contrario', () => {
    //  El dominio mide horario visto desde arriba; three.js, antihorario. Sin el signo,
    //  dos racks perpendiculares salen intercambiados.
    expect(cajaDeRack(enEscena({ rotation: 90 })).giroY).toBeCloseTo(-Math.PI / 2, 9);
    expect(cajaDeRack(enEscena({ rotation: 0 })).giroY).toBeCloseTo(0, 9);
  });

  it('un rack girado 90 grados ocupa a lo largo lo que antes a lo ancho', () => {
    //  La comprobación de verdad: no el ángulo, sino DONDE acaba la esquina. Se gira el
    //  vector local del largo y se mira que apunte al otro eje del mundo.
    const c = cajaDeRack(enEscena({ rotation: 90, width: 1.1, length: 8 }));
    const [, , largo] = c.escala;
    //  Extremo del rack a lo largo de su eje local z, ya girado al mundo.
    const puntaX = Math.sin(-c.giroY) * (largo / 2);
    const puntaZ = Math.cos(-c.giroY) * (largo / 2);
    expect(Math.abs(puntaX)).toBeCloseTo(4, 6);
    expect(Math.abs(puntaZ)).toBeCloseTo(0, 6);
  });
});

describe('las placas de los huecos', () => {
  it('hay una por hueco y por cara', () => {
    const r = enEscena({}, { bayCount: 4, maxLevel: 5, locationCount: 40 });
    //  4 cuerpos x 5 niveles x 2 posiciones x 2 caras.
    expect(placasDeHuecos(r)).toHaveLength(4 * 5 * 2 * 2);
    expect(cuantasPlacas([r])).toBe(4 * 5 * 2 * 2);
  });

  it('la cuenta previa coincide con lo construido, siempre', () => {
    //  `cuantasPlacas` reserva el búfer de la malla instanciada. Si contara distinto de lo
    //  que luego se construye, las últimas placas no se dibujarían y nadie sabría por qué.
    const racks = [
      enEscena({ layoutId: 'a' }, { bayCount: 21, maxLevel: 7, locationCount: 273 }),
      enEscena({ layoutId: 'b' }, { bayCount: 27, maxLevel: 5, locationCount: 135 }),
      enEscena({ layoutId: 'c' }, { bayCount: 0, maxLevel: 0, locationCount: 0 }),
    ];
    const construidas = racks.flatMap((r) => placasDeHuecos(r));
    expect(cuantasPlacas(racks)).toBe(construidas.length);
  });

  it('numera los huecos igual que el visor axonometrico', () => {
    //  Las dos vistas tienen que llamar igual al mismo hueco: es lo que permite pinchar
    //  en una y reconocerlo en la otra. Se comparan los conjuntos de claves.
    const r = enEscena({}, { bayCount: 4, maxLevel: 5, locationCount: 40 });
    const dosD = new Set(
      celdasDeRack(
        { escala: 1, cos: 1, sen: 0, kx: 1, ky: 1 } as never,
        r,
        2,
      ).map((c) => claveDeHueco(c.cuerpo, c.nivel, c.posicion)),
    );
    const tresD = new Set(
      placasDeHuecos(r).map((p) => claveDeHueco(p.cuerpo, p.nivel, p.posicion_)),
    );
    expect(tresD).toEqual(dosD);
  });

  it('el nivel 1 esta abajo, como en el almacen', () => {
    const placas = placasDeHuecos(enEscena({}, { bayCount: 4, maxLevel: 5, locationCount: 40 }));
    const n1 = placas.find((p) => p.nivel === 1)!;
    const n5 = placas.find((p) => p.nivel === 5)!;
    expect(n1.posicion[1]).toBeLessThan(n5.posicion[1]);
  });

  it('las placas quedan FUERA de la caja, no dentro', () => {
    //  Coplanares con la cara, dos superficies se pelean por el mismo píxel y el rack
    //  parpadea al girar. Se comprueba que la distancia al eje del rack supera el medio
    //  ancho.
    const r = enEscena({ x: 0, y: 0, rotation: 0, width: 1.1 });
    for (const p of placasDeHuecos(r)) {
      expect(Math.abs(p.posicion[0])).toBeGreaterThan(r.ancho / 2);
    }
  });

  it('un rack sin estructura no produce placas', () => {
    const r = enEscena({}, { bayCount: 0, maxLevel: 0, locationCount: 0 });
    expect(placasDeHuecos(r)).toEqual([]);
  });
});

describe('el encuadre', () => {
  it('sin racks no hay encuadre', () => {
    expect(encuadreDe([])).toBeNull();
  });

  it('el radio cubre los EXTREMOS, no los centros', () => {
    //  Un rack de 56 m asoma 28 m más allá de su centro: encuadrar por centros lo deja
    //  medio fuera de la pantalla.
    const r = enEscena({ x: 0, y: 0, length: 56.7 });
    const e = encuadreDe([r])!;
    expect(e.radio).toBeGreaterThanOrEqual(56.7 / 2);
  });

  it('un solo rack pequeno no da radio cero', () => {
    //  Con radio cero la cámara acaba dentro del rack y la pantalla en negro.
    const r = enEscena({ width: 0.2, length: 0.2, height: 0.2 });
    expect(encuadreDe([r])!.radio).toBeGreaterThan(0);
  });

  it('el centro cae entre los racks', () => {
    const a = enEscena({ layoutId: 'a', x: 0, y: 0 });
    const b: RackEnEscena = { ...a, layoutId: 'b', x: 100, y: 40 };
    const e = encuadreDe([a, b])!;
    expect(e.centro[0]).toBeCloseTo(50, 0);
    expect(e.centro[2]).toBeCloseTo(20, 0);
  });
});
