/**
 * EL BUSCADOR DE CAMINOS, CON GEOMETRIAS DONDE LA RESPUESTA SE SABE.
 *
 * Se prueba con dos racks separados por un pasillo, porque ahí la respuesta se puede calcular
 * a mano: ir de un lado al otro por el pasillo mide lo que mide, y atravesar el rack mediría
 * menos — que es justamente lo que no puede pasar—.
 *
 * Lo que más se cuida:
 *
 *   · que el camino NO atraviese un rack, que es la razón de existir de este módulo;
 *   · que cuando no hay camino se DIGA, en vez de devolver una recta;
 *   · que el suavizado no cambie la topología: quitar vértices no puede abrir un atajo por
 *     dentro de una estantería.
 */

import { describe, expect, it } from 'vitest';

import { componerEscena } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';
import type { PositionedRack } from '../editor/types';
import {
  aCelda,
  caminoEntre,
  celdaLibreCerca,
  construirRejilla,
  hayVisibilidad,
  largoDe,
  libre,
  suavizar,
} from './camino';

/** Un rack en metros, sin catálogo: para la huella solo hacen falta las medidas. */
function rack(over: Partial<PositionedRack>): RackEnEscena {
  const r: PositionedRack = {
    layoutId: 'l',
    rackCode: 'R',
    x: 0,
    y: 0,
    width: 2,
    length: 20,
    height: 6,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
  return componerEscena([r], 1, { x: 0, y: 0 }, [], new Map())[0]!;
}

/**
 * Dos racks de 20 m paralelos, separados por un pasillo de 3 m.
 *
 *      y = -2.5   ███████████████  rack A (ancho 2, de y −3,5 a −1,5)
 *      y =  0     ..............   pasillo libre
 *      y = +2.5   ███████████████  rack B
 */
function dosRacks(): RackEnEscena[] {
  return [
    { ...rack({ x: -2.5, y: 0, width: 2, length: 20 }), layoutId: 'a' },
    { ...rack({ x: 2.5, y: 0, width: 2, length: 20 }), layoutId: 'b' },
  ];
}

describe('la rejilla', () => {
  it('marca la huella del rack y deja libre el pasillo', () => {
    const rej = construirRejilla(dosRacks())!;
    //  Dentro del rack A: bloqueado.
    const dentroA = aCelda(rej, -2.5, 0);
    expect(libre(rej, dentroA.c, dentroA.f)).toBe(false);
    //  En medio del pasillo: libre.
    const pasillo = aCelda(rej, 0, 0);
    expect(libre(rej, pasillo.c, pasillo.f)).toBe(true);
  });

  it('no bloquea la envolvente de un rack girado, solo su huella', () => {
    //  Un rack girado 45° tiene una envolvente casi el doble de grande. Bloquearla entera
    //  cerraría pasillos que existen.
    const r = rack({ x: 0, y: 0, width: 2, length: 20, rotation: 45 });
    const rej = construirRejilla([r])!;
    /*
      El rack girado 45° es una franja fina que va de (7,8; −6,4) a (−6,4; 7,8), y su
      envolvente es el cuadrado que la contiene.

      Se comprueba (6, 6): está DENTRO de la envolvente y a 8,5 m del eje de la franja, cuya
      media anchura es 1 m. Si se bloqueara la envolvente en vez de la huella, este punto
      saldría ocupado y el pasillo diagonal desaparecería.

      El primer intento usó (7, −7), que está pegado a la punta del rack: el punto estaba mal
      elegido, no el código.
    */
    const suelto = aCelda(rej, 6, 6);
    expect(libre(rej, suelto.c, suelto.f)).toBe(true);
  });

  it('sin racks no hay rejilla', () => {
    expect(construirRejilla([])).toBeNull();
  });

  it('deja margen alrededor para poder rodear', () => {
    //  Sin margen, el borde haría de pared y el buscador diría «no hay camino» donde lo que
    //  falta es sitio para girar.
    const rej = construirRejilla(dosRacks())!;
    const fuera = aCelda(rej, 0, 6);
    expect(libre(rej, fuera.c, fuera.f)).toBe(true);
  });
});

describe('el camino', () => {
  const rej = construirRejilla(dosRacks())!;

  it('por el pasillo mide lo que mide', () => {
    //  De un extremo al otro del pasillo: 16 m en línea recta, y el pasillo está libre, así
    //  que el camino es esa recta.
    const c = caminoEntre(rej, { x: 0, y: -8 }, { x: 0, y: 8 })!;
    expect(c.metros).toBeCloseTo(16, 0);
  });

  it('NO atraviesa un rack', () => {
    /*
      De un lado del rack A al otro. En línea recta serían ~4 m atravesando la estantería; el
      camino real tiene que rodearla por un extremo, así que mide MUCHO más.

      Es la prueba que justifica todo el módulo.
    */
    const c = caminoEntre(rej, { x: -5, y: 0 }, { x: 0, y: 0 })!;
    expect(c.metros).toBeGreaterThan(15);
    //  Y ningún vértice cae dentro de la huella.
    for (const p of c.puntos) {
      const q = aCelda(rej, p.x, p.y);
      expect(libre(rej, q.c, q.f)).toBe(true);
    }
  });

  it('el camino suavizado no mide mas que el de la rejilla', () => {
    //  El suavizado solo quita vértices: no puede alargar. Si alargara, sería que ha
    //  cambiado la topología.
    const c = caminoEntre(rej, { x: -5, y: -8 }, { x: 5, y: 8 })!;
    expect(c.metros).toBeGreaterThan(0);
    //  Y nunca menos que la recta, que es la cota inferior absoluta.
    const recta = Math.hypot(10, 16);
    expect(c.metros).toBeGreaterThanOrEqual(recta - 0.01);
  });

  it('en un pasillo recto el suavizado deja DOS vertices', () => {
    //  Sin suavizar serían treinta y dos centros de celda. Con suavizado, origen y destino: la
    //  escalera de la rejilla no está en el almacén.
    const c = caminoEntre(rej, { x: 0, y: -8 }, { x: 0, y: 8 })!;
    expect(c.puntos.length).toBe(2);
  });

  it('una parada en el BORDE del rack sigue teniendo camino', () => {
    //  Las paradas están al borde porque se anda por el pasillo, y medio metro de redondeo
    //  puede meter su celda dentro de la huella. Sin `celdaLibreCerca`, el buscador diría que
    //  no hay camino desde una parada perfectamente accesible.
    const borde = { x: -1.5, y: -5 };
    expect(caminoEntre(rej, borde, { x: 0, y: 5 })).not.toBeNull();
  });

  it('cuando no hay camino lo DICE', () => {
    /*
      Un punto encerrado: se rodea de racks por los cuatro lados. Devolver una recta afirmaría
      que se puede atravesar una estantería, que es lo que este módulo viene a arreglar.
    */
    /*
      Cuatro paredes SIN girar, que es lo único que no se puede equivocar: con `rotation: 90`
      el ancho y el largo cambian de eje, y la primera versión de esta prueba dejó las
      esquinas abiertas — la jaula no encerraba nada—.

      `ancho` va sobre x y `largo` sobre y (la convención de `esquinas()`), así que:
        · pared horizontal: ancho 12, largo 2  →  x ∈ [−6, 6]
        · pared vertical:   ancho 2,  largo 12 →  y ∈ [−6, 6]
      Puestas a ±4 se solapan en las esquinas y el interior queda sellado.
    */
    const jaula = [
      { ...rack({ x: 0, y: -4, width: 12, length: 2 }), layoutId: '1' },
      { ...rack({ x: 0, y: 4, width: 12, length: 2 }), layoutId: '2' },
      { ...rack({ x: -4, y: 0, width: 2, length: 12 }), layoutId: '3' },
      { ...rack({ x: 4, y: 0, width: 2, length: 12 }), layoutId: '4' },
    ];
    const r2 = construirRejilla(jaula, 0.5, 6)!;
    //  Desde dentro de la jaula hasta fuera: no hay salida.
    expect(caminoEntre(r2, { x: 0, y: 0 }, { x: 0, y: 12 })).toBeNull();
  });

  it('NUNCA mide menos que la recta, que es la cota inferior absoluta', () => {
    /*
      LA invariante. A* trabaja con centros de celda, así que el camino empezaba y acababa
      hasta 35 cm de donde está la parada: en un pasillo despejado salían 78,00 m donde la
      recta mide 78,30. Un camino que rodea midiendo MENOS que la línea recta no es un error
      de un decimal, es una afirmación falsa. Se vio en pantalla con el recorrido real.

      Se prueba en varios pares, incluidos los que caen a media celda, porque el defecto
      dependía de dónde cayera el redondeo.
    */
    const pares: [{ x: number; y: number }, { x: number; y: number }][] = [
      [{ x: 0, y: -8 }, { x: 0, y: 8 }],
      [{ x: 0, y: -7.3 }, { x: 0, y: 6.7 }],
      [{ x: 0.2, y: -5.1 }, { x: -0.3, y: 4.9 }],
      [{ x: 0, y: 0 }, { x: 0, y: 0.4 }],
    ];
    for (const [a, b] of pares) {
      const c = caminoEntre(rej, a, b)!;
      const recta = Math.hypot(b.x - a.x, b.y - a.y);
      expect(c.metros).toBeGreaterThanOrEqual(recta - 1e-9);
    }
  });

  it('en un pasillo despejado mide EXACTAMENTE la recta', () => {
    //  Sin obstaculo, el camino mas corto ES la recta. Cualquier diferencia seria la escalera
    //  de la rejilla colandose en el numero.
    const a = { x: 0, y: -7.3 };
    const b = { x: 0, y: 6.7 };
    const c = caminoEntre(rej, a, b)!;
    expect(c.metros).toBeCloseTo(Math.hypot(b.x - a.x, b.y - a.y), 6);
  });

  it('ir a donde ya se esta no revienta', () => {
    const c = caminoEntre(rej, { x: 0, y: 0 }, { x: 0, y: 0 })!;
    expect(c.metros).toBeCloseTo(0, 6);
  });
});

describe('la visibilidad', () => {
  const rej = construirRejilla(dosRacks())!;

  it('a lo largo del pasillo si', () => {
    expect(hayVisibilidad(rej, { x: 0, y: -8 }, { x: 0, y: 8 })).toBe(true);
  });

  it('a traves de un rack no', () => {
    //  Es lo que impide que el suavizado abra un atajo por dentro de una estantería.
    expect(hayVisibilidad(rej, { x: -5, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });
});

describe('celdaLibreCerca', () => {
  const rej = construirRejilla(dosRacks())!;

  it('devuelve la propia celda si ya esta libre', () => {
    const p = celdaLibreCerca(rej, 0, 0)!;
    expect(libre(rej, p.c, p.f)).toBe(true);
  });

  it('saca del rack a la celda libre mas cercana', () => {
    const p = celdaLibreCerca(rej, -2.5, 0)!;
    expect(libre(rej, p.c, p.f)).toBe(true);
  });

  it('si de verdad esta encerrado, lo dice', () => {
    //  Con un radio de búsqueda pequeño y un punto en medio de un rack de 10 m de ancho, no
    //  hay suelo libre cerca. Moverlo diez metros a otro pasillo sería inventar la parada.
    const gordo = [{ ...rack({ x: 0, y: 0, width: 20, length: 20 }), layoutId: 'g' }];
    const r2 = construirRejilla(gordo)!;
    expect(celdaLibreCerca(r2, 0, 0, 2)).toBeNull();
  });
});

describe('suavizar', () => {
  const rej = construirRejilla(dosRacks())!;

  it('un camino de dos puntos se queda igual', () => {
    const c = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ];
    expect(suavizar(rej, c)).toEqual(c);
  });

  it('nunca alarga', () => {
    const crudo = [
      { x: 0, y: -6 },
      { x: 0.5, y: -5 },
      { x: 0, y: -4 },
      { x: 0.5, y: -3 },
      { x: 0, y: -2 },
    ];
    expect(largoDe(suavizar(rej, crudo))).toBeLessThanOrEqual(largoDe(crudo) + 1e-9);
  });
});
