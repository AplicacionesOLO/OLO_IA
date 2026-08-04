/**
 * PRUEBAS DEL REPARTO DE ANCHOS.
 *
 * El defecto que arregla `repartir` no se veia: la columna derecha se salia de su
 * contenedor, que la RECORTA, y la pagina no desbordaba. Medido, `scrollWidth ==
 * clientWidth` con media columna invisible.
 *
 * Aqui se prueba la aritmetica, que es donde vive la decision. Lo que sigue en las
 * sondas de navegador es que el reparto LLEGUE al DOM.
 *
 * La regla que se comprueba en casi todas: el centro nunca baja de su minimo. Es lo
 * que hace que el trabajo siga siendo posible en una ventana estrecha, y es
 * exactamente lo que fallaba.
 */

import { describe, expect, it } from 'vitest';

import { repartir } from './useAnchoDisponible';

const PEDIDO = { izquierda: 300, derecha: 340, minCentro: 380, anchoColapsado: 40, extra: 12 };

describe('repartir', () => {
  it('con espacio de sobra respeta lo que se pidio', () => {
    const r = repartir(1600, PEDIDO);
    expect(r.izquierda).toBe(300);
    expect(r.derecha).toBe(340);
    expect(r.izquierdaForzada).toBe(false);
    expect(r.derechaForzada).toBe(false);
    expect(r.centro).toBe(1600 - 12 - 300 - 340);
  });

  it('sin medir todavia devuelve lo pedido, no una pantalla colapsada', () => {
    // El primer render ocurre antes de que el `ResizeObserver` mida. Si aqui se
    // colapsara todo, habria un parpadeo visible en cada carga.
    const r = repartir(0, PEDIDO);
    expect(r.izquierda).toBe(300);
    expect(r.derecha).toBe(340);
  });

  it('el CENTRO nunca baja de su minimo, en ningun ancho', () => {
    // Es la razon de ser de todo el modulo. Se barre de un movil a un monitor grande.
    for (let ancho = 320; ancho <= 2400; ancho += 7) {
      const r = repartir(ancho, PEDIDO);
      const usado = r.izquierda + r.derecha;
      const colapsadas =
        (r.izquierda === 0 ? PEDIDO.anchoColapsado : 0) + (r.derecha === 0 ? PEDIDO.anchoColapsado : 0);
      const disponible = ancho - PEDIDO.extra;
      // O cabe el minimo del centro, o ya no hay laterales que colapsar.
      const centroReal = disponible - usado - colapsadas;
      if (usado > 0) {
        expect(centroReal).toBeGreaterThanOrEqual(PEDIDO.minCentro - 1);
      }
      // Y nunca se reparte mas de lo que hay.
      expect(usado + colapsadas).toBeLessThanOrEqual(disponible);
    }
  });

  it('cuando aprieta, las dos laterales encogen A LA VEZ y en proporcion', () => {
    // Encoger primero la mas ancha las dejaria iguales y perderia la jerarquia que el
    // operador eligio al arrastrarlas.
    const r = repartir(1000, PEDIDO);
    if (r.izquierda > 0 && r.derecha > 0) {
      expect(r.izquierda).toBeLessThan(300);
      expect(r.derecha).toBeLessThan(340);
      // La derecha pidio mas, asi que sigue siendo la mas ancha.
      expect(r.derecha).toBeGreaterThanOrEqual(r.izquierda);
    }
  });

  it('ninguna lateral encoge por debajo del suelo de 200 px', () => {
    // Un panel de 90 px no es un panel, es una columna de texto cortado.
    for (let ancho = 700; ancho <= 1400; ancho += 3) {
      const r = repartir(ancho, PEDIDO);
      if (r.izquierda > 0) expect(r.izquierda).toBeGreaterThanOrEqual(200);
      if (r.derecha > 0) expect(r.derecha).toBeGreaterThanOrEqual(200);
    }
  });

  it('la primera que se colapsa es la DERECHA', () => {
    // El inspector es contextual: sin el se puede trabajar. Sin el arbol de la
    // izquierda no hay por donde navegar.
    let vistaDerechaSola = false;
    for (let ancho = 400; ancho <= 1200; ancho += 1) {
      const r = repartir(ancho, PEDIDO);
      if (r.derechaForzada && !r.izquierdaForzada) vistaDerechaSola = true;
      // Nunca al contrario: la izquierda sola no se colapsa mientras quede derecha.
      if (r.izquierdaForzada) expect(r.derechaForzada).toBe(true);
    }
    expect(vistaDerechaSola).toBe(true);
  });

  it('en el ancho de un portatil con escalado al 150 % deja lienzo de trabajo', () => {
    // 1.366 fisicos al 150 % son 910 px CSS: el caso real que rompio la pantalla.
    const r = repartir(910, PEDIDO);
    const colapsadas =
      (r.izquierda === 0 ? PEDIDO.anchoColapsado : 0) + (r.derecha === 0 ? PEDIDO.anchoColapsado : 0);
    const centro = 910 - PEDIDO.extra - r.izquierda - r.derecha - colapsadas;
    expect(centro).toBeGreaterThanOrEqual(PEDIDO.minCentro);
  });

  it('sin columna derecha reparte todo entre la izquierda y el centro', () => {
    const r = repartir(900, { ...PEDIDO, derecha: 0 });
    expect(r.derecha).toBe(0);
    expect(r.derechaForzada).toBe(false); // no habia nada que colapsar
    expect(r.izquierda).toBeGreaterThan(0);
  });

  it('en un ancho imposible colapsa las dos y no devuelve numeros negativos', () => {
    const r = repartir(360, PEDIDO);
    expect(r.izquierda).toBe(0);
    expect(r.derecha).toBe(0);
    expect(r.izquierdaForzada).toBe(true);
    expect(r.derechaForzada).toBe(true);
    // El centro puede quedarse corto —no hay mas espacio— pero no puede ser negativo
    // de forma que el estilo produzca un ancho invalido.
    expect(r.centro).toBeGreaterThan(0);
  });

  it('lo forzado distingue «no cabe» de «lo cerro una persona»', () => {
    // Con `izquierda: 0` porque el operador la cerro, no hay nada forzado: no debe
    // reabrirse sola al agrandar la ventana.
    const r = repartir(1600, { ...PEDIDO, izquierda: 0 });
    expect(r.izquierdaForzada).toBe(false);
  });
});
