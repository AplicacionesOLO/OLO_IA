/**
 * EL ARRASTRE EN PERSPECTIVA, COMPROBADO SIN TARJETA GRAFICA.
 *
 * Lo que se prueba son los dos sitios donde esto se equivoca de verdad:
 *
 *   · el SIGNO de la constante del plano — al revés, la figura se va al infinito en cuanto
 *     alguien la toca—;
 *   · la correspondencia de ejes al volver al dominio — invertida, la figura se mueve en
 *     diagonal respecto al ratón—.
 *
 * Los dos producen una pantalla que se ve bien hasta que se usa, que es la clase de fallo
 * que este proyecto ya ha pagado dos veces.
 */

import { describe, expect, it } from 'vitest';

import {
  ALTURA_MAXIMA_M,
  aDominio,
  destinoDeArrastre,
  movimientoApreciable,
  planoHorizontal,
  planoVertical,
} from './arrastre';

/** Evalúa `normal · punto + constante`. Cero significa que el punto está EN el plano. */
function enElPlano(
  plano: { normal: [number, number, number]; constante: number },
  p: { x: number; y: number; z: number },
): number {
  return plano.normal[0] * p.x + plano.normal[1] * p.y + plano.normal[2] * p.z + plano.constante;
}

describe('el plano horizontal', () => {
  it('contiene la altura de la figura, con el signo correcto', () => {
    //  LA prueba del signo. Con `+altura` en vez de `-altura`, el plano queda al otro lado
    //  del origen y el corte del rayo sale disparado.
    const plano = planoHorizontal(6);
    expect(enElPlano(plano, { x: 100, y: 6, z: -40 })).toBeCloseTo(0, 9);
  });

  it('no contiene otra altura', () => {
    expect(enElPlano(planoHorizontal(6), { x: 0, y: 0, z: 0 })).not.toBeCloseTo(0, 3);
  });

  it('a ras de suelo funciona igual', () => {
    expect(enElPlano(planoHorizontal(0), { x: 3, y: 0, z: 9 })).toBeCloseTo(0, 9);
  });
});

describe('el plano vertical', () => {
  const figura = { x: 10, y: 1.7, z: 20 };

  it('pasa por la figura', () => {
    const plano = planoVertical({ x: 0, y: 15, z: 0 }, figura)!;
    expect(enElPlano(plano, figura)).toBeCloseTo(0, 9);
  });

  it('es VERTICAL: la altura no entra en su normal', () => {
    //  Con componente vertical, el plano se inclina y subir el ratón movería la figura
    //  también en el suelo. El gesto dejaría de hacer una sola cosa.
    const plano = planoVertical({ x: 0, y: 80, z: 0 }, figura)!;
    expect(plano.normal[1]).toBe(0);
  });

  it('su normal esta normalizada', () => {
    const plano = planoVertical({ x: -5, y: 3, z: 40 }, figura)!;
    const largo = Math.hypot(plano.normal[0], plano.normal[1], plano.normal[2]);
    expect(largo).toBeCloseTo(1, 9);
  });

  it('contiene cualquier altura sobre la vertical de la figura', () => {
    //  Es lo que permite que el corte del rayo dé la altura nueva.
    const plano = planoVertical({ x: 0, y: 15, z: 0 }, figura)!;
    expect(enElPlano(plano, { x: 10, y: 99, z: 20 })).toBeCloseTo(0, 9);
  });

  it('mirando desde justo encima no hay plano, y se dice', () => {
    //  Desde arriba no se puede juzgar una altura. `null` es honesto; un plano rasante
    //  movería la figura decenas de metros por cada pixel de raton.
    expect(planoVertical({ x: 10, y: 50, z: 20 }, figura)).toBeNull();
  });
});

describe('el destino del arrastre', () => {
  const actual = { x: 10, y: 1.7, z: 20 };

  it('en horizontal, la altura NO se toca', () => {
    //  El caso que importa: un dron a 6 m no puede caerse al suelo por arrastrarlo.
    const d = destinoDeArrastre({
      puntoEnPlano: { x: 30, y: 6, z: 40 },
      desfase: { x: 0, y: 0, z: 0 },
      posicionActual: { x: 10, y: 6, z: 20 },
      vertical: false,
    });
    expect(d.y).toBe(6);
    expect([d.x, d.z]).toEqual([30, 40]);
  });

  it('en vertical, solo se toca la altura', () => {
    const d = destinoDeArrastre({
      puntoEnPlano: { x: 999, y: 4.5, z: 999 },
      desfase: { x: 0, y: 0, z: 0 },
      posicionActual: actual,
      vertical: true,
    });
    expect([d.x, d.z]).toEqual([10, 20]);
    expect(d.y).toBe(4.5);
  });

  it('el desfase conserva por donde se agarro', () => {
    //  Sin esto, pinchar el pie de un operario lo centra de golpe bajo el cursor: la figura
    //  salta antes de moverse y el salto se lee como un fallo.
    const d = destinoDeArrastre({
      puntoEnPlano: { x: 30, y: 0, z: 40 },
      desfase: { x: -0.4, y: 0, z: 0.25 },
      posicionActual: { x: 10, y: 0, z: 20 },
      vertical: false,
    });
    expect(d.x).toBeCloseTo(29.6, 9);
    expect(d.z).toBeCloseTo(40.25, 9);
  });

  it('no se puede subir mas alto de lo que la base admite', () => {
    //  Con la cámara lejos, cada píxel son casi cincuenta centímetros: medido en el
    //  navegador, 120 px dieron 57 m. Pasarse de 200 es fácil, y la base lo rechaza — así
    //  que el gesto no puede ofrecerlo—.
    const d = destinoDeArrastre({
      puntoEnPlano: { x: 0, y: 5000, z: 0 },
      desfase: { x: 0, y: 0, z: 0 },
      posicionActual: actual,
      vertical: true,
    });
    expect(d.y).toBe(ALTURA_MAXIMA_M);
  });

  it('no se puede enterrar una figura', () => {
    //  Bajo el suelo no se ve y no se puede volver a agarrar: el gesto se quedaria sin
    //  salida.
    const d = destinoDeArrastre({
      puntoEnPlano: { x: 0, y: -8, z: 0 },
      desfase: { x: 0, y: 0, z: 0 },
      posicionActual: actual,
      vertical: true,
    });
    expect(d.y).toBe(0);
  });
});

describe('de vuelta al dominio', () => {
  it('z del mundo es y del plano, y y del mundo es la altura', () => {
    //  LA prueba de los ejes. Invertidos, la figura se mueve en diagonal respecto al ratón
    //  — y en el visor axonométrico ese mismo error estuvo semanas en pantalla—.
    expect(aDominio({ x: 12.5, y: 6, z: 30 })).toEqual({ xM: 12.5, yM: 30, zM: 6 });
  });

  it('redondea al milimetro', () => {
    expect(aDominio({ x: 1.23456789, y: 0, z: 0 }).xM).toBe(1.235);
  });
});

describe('cuando merece guardarse', () => {
  it('un temblor de raton no escribe', () => {
    const a = { xM: 10, yM: 20, zM: 0 };
    expect(movimientoApreciable(a, { xM: 10.004, yM: 20.002, zM: 0 })).toBe(false);
  });

  it('un centimetro si', () => {
    //  Este caso FALLABA: en coma flotante `|10 - 10,01|` da 0,00999999999999979, menor que
    //  0,01. Un movimiento de exactamente un centímetro no se guardaba — y solo en los
    //  valores donde la resta cae del lado malo del redondeo, que es imposible de
    //  reproducir a mano—. Por eso ahora se compara en milímetros enteros.
    const a = { xM: 10, yM: 20, zM: 0 };
    expect(movimientoApreciable(a, { xM: 10.01, yM: 20, zM: 0 })).toBe(true);
  });

  it('un centimetro si, en varios valores donde la resta binaria engana', () => {
    //  Una prueba con un solo número no basta: el defecto dependía del número concreto.
    for (const base of [0, 3, 10, 12.5, 99.999, 1234.567]) {
      expect(
        movimientoApreciable(
          { xM: base, yM: 0, zM: 0 },
          { xM: Number((base + 0.01).toFixed(3)), yM: 0, zM: 0 },
        ),
      ).toBe(true);
    }
  });

  it('tambien cuenta un cambio de altura', () => {
    const a = { xM: 10, yM: 20, zM: 0 };
    expect(movimientoApreciable(a, { xM: 10, yM: 20, zM: 6 })).toBe(true);
  });
});
