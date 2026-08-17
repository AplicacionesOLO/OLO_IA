/**
 * PONER DOS RACKS DE ESPALDAS.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE PRUEBA Y POR QUE ASI
 *
 * Se prueba la GEOMETRIA RESULTANTE, no las fórmulas: dónde acaban las cuatro esquinas de
 * cada rack y qué distancia hay entre sus caras. Comprobar que la cuenta es la que escribí
 * sería comprobar que sé copiar; lo que hay que comprobar es que las dos traseras acaban en
 * el mismo plano.
 *
 * Y el fallo que esto atrapa no se ve en pantalla. Un par mal pegado —por medio centímetro,
 * o por un factor de escala— se dibuja igual de bien a la escala a la que se mira un almacén
 * de 112 m. Lo que falla después es todo lo que se apoya en la geometría: la cara interior
 * deja de ser una, la distancia entre pasillos queda mal, y el visor 3D pinta un hueco de
 * aire entre las dos espaldas.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA TRAMPA DE LAS UNIDADES
 *
 * `PositionedRack` guarda la POSICION en píxeles y las MEDIDAS en metros. Sumar `ancho / 2`
 * a `x` no da un error de tipos ni un aviso: da un rack colocado casi bien. Por eso las
 * pruebas usan una escala distinta de 1 —26,72 px/m, la real de este plano— porque con
 * `ppm = 1` las dos unidades coinciden y una conversión olvidada pasaría desapercibida.
 */

import { describe, expect, it } from 'vitest';

import { deEspaldas } from './emparejar';
import type { PositionedRack } from './types';

/** La escala real del plano de este almacén. Nunca 1: con 1, olvidar convertir no se nota. */
const PPM = 26.72;

function rack(over: Partial<PositionedRack> = {}): PositionedRack {
  return {
    layoutId: 'l1',
    rackCode: 'RCL21',
    x: 0,
    y: 0,
    width: 1.1,
    length: 56.7,
    height: 11.9,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
}

/** Las cuatro esquinas de un rack en píxeles del plano, para medir sobre el resultado. */
function esquinas(r: PositionedRack, ppm: number) {
  const t = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  const hw = (r.width / 2) * ppm;
  const hl = (r.length / 2) * ppm;
  return [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ].map(([u, v]) => ({
    x: r.x + u! * cos - v! * sen,
    y: r.y + u! * sen + v! * cos,
  }));
}

/** El rack `movil` ya colocado donde dice `deEspaldas`. */
function emparejados(ancla: PositionedRack, movil: PositionedRack, ppm = PPM) {
  const e = deEspaldas(ancla, movil, ppm);
  const colocado: PositionedRack = { ...movil, x: e.x, y: e.y, rotation: e.rotation };
  return { e, ancla, colocado };
}

describe('deEspaldas', () => {
  it('los centros quedan a medio ancho + medio ancho', () => {
    //  Ni un milímetro más: si sobrara, queda una rendija de aire entre las dos espaldas; si
    //  faltara, los dos racks se solapan y el visor pinta uno dentro del otro.
    const { ancla, colocado } = emparejados(rack(), rack({ layoutId: 'l2', x: 500 }));
    const d = Math.hypot(colocado.x - ancla.x, colocado.y - ancla.y);
    expect(d).toBeCloseTo(((1.1 + 1.1) / 2) * PPM, 6);
  });

  it('con anchos DISTINTOS tampoco queda hueco ni solape', () => {
    //  No se supone que las dos mitades sean iguales: los racks vienen de un catálogo real.
    const { ancla, colocado } = emparejados(
      rack({ width: 1.1 }),
      rack({ layoutId: 'l2', x: 500, width: 2.4 }),
    );
    const d = Math.hypot(colocado.x - ancla.x, colocado.y - ancla.y);
    expect(d).toBeCloseTo(((1.1 + 2.4) / 2) * PPM, 6);
  });

  it('LAS DOS TRASERAS ACABAN EN EL MISMO PLANO, girado como sea', () => {
    /*
      Ésta es la prueba de verdad, y es geométrica: se mide la distancia mínima entre las
      esquinas de uno y las del otro. Si las dos caras interiores comparten plano, hay
      esquinas de los dos racks que coinciden exactamente.

      Se recorre todo el círculo porque las fórmulas con senos y cosenos fallan en ángulos
      concretos —90°, 180°, 270°— y no en los intermedios.
    */
    for (let g = 0; g < 360; g += 15) {
      const { ancla, colocado } = emparejados(
        rack({ rotation: g }),
        rack({ layoutId: 'l2', x: 500, rotation: 137, length: 56.7 }),
      );
      const ea = esquinas(ancla, PPM);
      const ec = esquinas(colocado, PPM);
      //  Dos esquinas de cada uno tienen que caer sobre dos del otro: la arista donde se
      //  tocan es común.
      const encajadas = ea.filter((a) =>
        ec.some((c) => Math.hypot(a.x - c.x, a.y - c.y) < 1e-6),
      );
      expect(encajadas).toHaveLength(2);
    }
  });

  it('quedan PARALELOS', () => {
    //  Un grado de diferencia sobre 56,7 m son casi 100 cm en la punta: el par se abriría
    //  como unas tijeras y las dos traseras dejarían de tocarse en un extremo.
    const { e } = emparejados(rack({ rotation: 37.5 }), rack({ layoutId: 'l2', x: 500 }));
    expect(e.rotation).toBe(37.5);
  });

  it('se pega del lado donde el movil YA estaba', () => {
    //  Respeta lo que quien modela había empezado a hacer a mano, en vez de mandar el rack al
    //  otro lado del ancla sin motivo.
    const derecha = emparejados(rack(), rack({ layoutId: 'l2', x: 900 }));
    const izquierda = emparejados(rack(), rack({ layoutId: 'l2', x: -900 }));
    expect(derecha.colocado.x).toBeGreaterThan(0);
    expect(izquierda.colocado.x).toBeLessThan(0);
  });

  it('el lado se mide sobre el eje del rack, no sobre la pantalla', () => {
    //  Con el ancla girada 90°, «a la derecha» del rack es hacia abajo en el plano. Usar la
    //  `x` de pantalla en vez del eje local pegaría el rack por la cara que no es.
    const { colocado } = emparejados(
      rack({ rotation: 90 }),
      rack({ layoutId: 'l2', x: 0, y: 900, rotation: 90 }),
    );
    expect(colocado.y).toBeGreaterThan(0);
    expect(colocado.x).toBeCloseTo(0, 6);
  });

  it('el mismo par emparejado dos veces no se mueve la segunda', () => {
    //  Es idempotente: pulsar el botón otra vez sobre un par ya montado no lo empuja. Sin
    //  esto, cada pulsación separaría el par otro ancho más.
    const ancla = rack();
    const primero = emparejados(ancla, rack({ layoutId: 'l2', x: 500 }));
    const segundo = emparejados(ancla, primero.colocado);
    expect(segundo.colocado.x).toBeCloseTo(primero.colocado.x, 9);
    expect(segundo.colocado.y).toBeCloseTo(primero.colocado.y, 9);
  });

  it('con el movil justo encima del ancla elige un lado, y siempre el mismo', () => {
    //  El empate: sin desempatar, el signo de un cero decidiría, y dos pulsaciones seguidas
    //  darían resultados distintos sobre la misma selección.
    const a = deEspaldas(rack(), rack({ layoutId: 'l2', x: 0, y: 0 }), PPM);
    const b = deEspaldas(rack(), rack({ layoutId: 'l2', x: 0, y: 0 }), PPM);
    expect(a).toEqual(b);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1.1 * PPM, 6);
  });
});

describe('las caras que salen del gesto', () => {
  it('las dos miran HACIA FUERA del par', () => {
    /*
      Ponerlos de espaldas es decir dónde están las espaldas, así que las caras no hay que
      adivinarlas: se deducen del gesto que acaba de hacer quien modela.

      Se comprueba geométricamente —no comparando `1` con `-1`— proyectando la normal de cada
      cara sobre la línea que une los dos centros: la del ancla tiene que apuntar en contra
      del móvil y la del móvil en contra del ancla.
    */
    for (const dondeEstaba of [900, -900]) {
      const { e, ancla, colocado } = emparejados(
        rack({ rotation: 37.5 }),
        rack({ layoutId: 'l2', x: dondeEstaba, y: 200 }),
      );
      const t = (e.rotation * Math.PI) / 180;
      const normal = (lado: 1 | -1) => ({ x: lado * Math.cos(t), y: lado * Math.sin(t) });
      const haciaElMovil = { x: colocado.x - ancla.x, y: colocado.y - ancla.y };

      const na = normal(e.frenteAncla);
      const nm = normal(e.frenteMovil);
      //  La cara del ancla, en contra de donde está el móvil.
      expect(na.x * haciaElMovil.x + na.y * haciaElMovil.y).toBeLessThan(0);
      //  Y la del móvil, en el mismo sentido que se alejó: hacia fuera.
      expect(nm.x * haciaElMovil.x + nm.y * haciaElMovil.y).toBeGreaterThan(0);
    }
  });

  it('son SIEMPRE contrarias', () => {
    //  Un rack doble con las dos caras iguales sería un rack doble que da sus dos pasillos al
    //  mismo sitio. No existe.
    for (let g = 0; g < 360; g += 11) {
      const e = deEspaldas(rack({ rotation: g }), rack({ layoutId: 'l2', x: 500 }), PPM);
      expect(e.frenteAncla).toBe(e.frenteMovil === 1 ? -1 : 1);
    }
  });
});

describe('la alineacion a lo largo', () => {
  it('con el mismo largo, los centros quedan enfrentados', () => {
    const { ancla, colocado } = emparejados(
      rack({ y: 300 }),
      rack({ layoutId: 'l2', x: 500, y: 800 }),
    );
    //  Sin componente a lo largo: sin girar, el eje largo es `y`.
    expect(colocado.y).toBeCloseTo(ancla.y, 6);
  });

  it('con largos DISTINTOS se alinea la punta del C001, no el centro', () => {
    /*
      «La punta es la misma para todos: aunque estén de espaldas, si uno empieza con C001 el
      otro también empieza C001.»

      Con largos distintos, alinear por el centro dejaría el C001 de uno enfrente de un
      cuerpo del medio del otro. Se mide el extremo, no la fórmula: sin girar y sin invertir
      numeración, el C001 está en el `y` menor.
    */
    const ancla = rack({ y: 0, length: 56.7 });
    const { colocado } = emparejados(ancla, rack({ layoutId: 'l2', x: 500, length: 40 }));
    const puntaDe = (r: PositionedRack) => r.y - (r.length / 2) * PPM;
    expect(puntaDe(colocado)).toBeCloseTo(puntaDe(ancla), 6);
    //  Y no están centrados: es lo que distingue esta regla de la otra.
    expect(colocado.y).not.toBeCloseTo(ancla.y, 3);
  });

  /*
    ── GIRAR EL RACK NO CAMBIA DONDE ESTA EL C001 ────────────────────────────────

    A 180° se invierten DOS cosas y se cancelan: la numeración empieza por el otro extremo
    local —eso lo hace `invierteNumeracion`— y el eje largo apunta al revés. El resultado es
    que el C001 acaba en la MISMA punta física, que es exactamente lo que se pidió: «la punta
    es la misma para todos».

    Por eso la alineación de aquí tiene que usar esa misma regla y no el extremo local a
    secas. Si usara el extremo local, un par girado 180° se alinearía por la punta contraria
    y el C001 de una mitad quedaría enfrente del último cuerpo de la otra.

    Se mide sobre la punta FISICA —la coordenada del plano— y no sobre la local, porque es la
    única que significa lo mismo en los dos racks.
  */
  const puntaC001 = (r: PositionedRack) => {
    //  Sin invertir, el C001 está en el extremo local negativo; invertido, en el positivo. Y
    //  a 0° y 180° el eje largo del plano es `y` en un sentido o en el otro.
    const invierte = r.rotation === 180;
    const signoLocal = invierte ? 1 : -1;
    const signoEje = invierte ? -1 : 1;
    return r.y + signoLocal * signoEje * (r.length / 2) * PPM;
  };

  it('girado 180, la punta del C001 cae donde caeria sin girar', () => {
    const derecho = rack({ y: 0, rotation: 0, length: 56.7 });
    const alReves = rack({ y: 0, rotation: 180, length: 56.7 });
    expect(puntaC001(alReves)).toBeCloseTo(puntaC001(derecho), 6);
  });

  it('y el par girado 180 se alinea por esa misma punta', () => {
    const ancla = rack({ y: 0, rotation: 180, length: 56.7 });
    const { colocado } = emparejados(
      ancla,
      rack({ layoutId: 'l2', x: 500, rotation: 180, length: 40 }),
    );
    expect(puntaC001(colocado)).toBeCloseTo(puntaC001(ancla), 6);
  });
});
