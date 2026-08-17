/**
 * LA SIMULACION DE UN RECORRIDO, COMPROBADA CON NUMEROS QUE SE PUEDEN HACER A MANO.
 *
 * Es el producto —«340 m y 4 min 50 s»— así que se prueba con geometrías donde la respuesta
 * se conoce de antemano: un rack de 20 m con paradas en cuerpos concretos da distancias
 * enteras, y a 1 m/s los segundos son los metros.
 *
 * Lo que más se cuida son los casos que darían un número BUENO Y FALSO:
 *
 *   · una parada cuyo rack no está colocado, que si se ignorara en silencio dejaría un
 *     recorrido de diez paradas contando cuatro y pareciendo barato;
 *   · la altura, que no se anda: sumarla inventaría un recorrido vertical;
 *   · el orden, que es parte del dato.
 */

import { describe, expect, it } from 'vitest';

import { componerEscena } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';
import type { PositionedRack } from '../editor/types';
import type { FloorPlanCell } from '../types/index';
import {
  comoDuracion,
  posicionEn,
  rumboEn,
  puntoDeParada,
  simular,
} from './recorrido';
import type { Parada } from './recorrido';

/** Un rack de 20 m de largo, 2 de ancho, 4 niveles, 20 cuerpos de 1 posición. */
function rackDe20(over: Partial<PositionedRack> = {}, nodo = 'nodo-a'): RackEnEscena {
  const r: PositionedRack = {
    layoutId: 'l1',
    rackCode: 'RCL47',
    x: 0,
    y: 0,
    width: 2,
    length: 20,
    height: 8,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
  const cat = {
    rackId: nodo,
    rackCode: r.rackCode,
    rackExternalCode: null,
    rackIndex: null,
    nodeType: 'rack',
    nodeFunction: null,
    functionLabel: null,
    aisleId: null,
    aisleCode: null,
    bayCount: 20,
    maxLevel: 4,
    maxPosition: 1,
    locationCount: 80,
    availableCount: 80,
    blockedCount: 0,
    //  El resto de `FloorPlanCell` no lo usa `componerEscena` —solo cuerpos, niveles y
    //  ubicaciones— así que se pasa por `unknown` en vez de rellenar veinte campos que la
    //  prueba no mira.
  } as unknown as FloorPlanCell;
  return componerEscena([r], 1, { x: 0, y: 0 }, [cat], new Map())[0]!;
}

function parada(over: Partial<Parada> = {}): Parada {
  return {
    id: 'p',
    seq: 0,
    locationCode: 'RCL47-C001-N01-1',
    rackNodeId: 'nodo-a',
    bayIndex: 1,
    level: 1,
    position: 1,
    operation: 'pasar',
    dwellS: 0,
    ...over,
  };
}

describe('donde cae una parada', () => {
  const r = rackDe20();
  const mapa = new Map([['nodo-a', r]]);

  it('el cuerpo 1 y el cuerpo 20 estan a 19 m', () => {
    //  20 cuerpos de 1 m: del centro del primero al centro del último hay 19 m.
    const a = puntoDeParada(parada({ bayIndex: 1 }), mapa)!;
    const b = puntoDeParada(parada({ bayIndex: 20 }), mapa)!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(19, 6);
  });

  it('se pone al BORDE del rack, no en su eje', () => {
    //  Se anda por el pasillo. Medido de centro a centro, un recorrido por la misma hilera
    //  parecería atravesar la estantería.
    const p = puntoDeParada(parada(), mapa)!;
    expect(Math.abs(p.x)).toBeCloseTo(r.ancho / 2, 6);
  });

  it('el nivel cambia la altura y NADA mas', () => {
    const n1 = puntoDeParada(parada({ level: 1 }), mapa)!;
    const n4 = puntoDeParada(parada({ level: 4 }), mapa)!;
    expect(n4.z).toBeGreaterThan(n1.z);
    expect([n4.x, n4.y]).toEqual([n1.x, n1.y]);
  });

  it('un cuerpo fuera de rango se acota, no se sale del rack', () => {
    //  Un cuerpo 99 en un rack de 20 pondría la parada mucho más allá del extremo y
    //  alargaría el recorrido con metros que no existen.
    const p = puntoDeParada(parada({ bayIndex: 99 }), mapa)!;
    const ultimo = puntoDeParada(parada({ bayIndex: 20 }), mapa)!;
    expect(p.y).toBeCloseTo(ultimo.y, 6);
  });

  it('una ubicacion SIN cuerpo va al centro del nodo, no al cuerpo 1', () => {
    /*
      No todas las ubicaciones son un hueco de estantería: un muelle o una zona de bulto no
      tienen `logical_column`. Comprobado en el catálogo real — `ALM-01-01` lo tiene a
      `null`—.

      Con el antiguo `?? 1` la parada caía en el extremo del nodo. Para un muelle de 20 m,
      decir «está en su punta izquierda» falsea la distancia sin avisar.
    */
    const p = puntoDeParada(parada({ bayIndex: null, position: null }), mapa)!;
    //  Centro del rack a lo largo: la coordenada del eje, no la del primer cuerpo.
    expect(p.y).toBeCloseTo(r.y, 6);
    const primerCuerpo = puntoDeParada(parada({ bayIndex: 1 }), mapa)!;
    expect(p.y).not.toBeCloseTo(primerCuerpo.y, 3);
  });

  it('sin rack colocado no hay punto, y no es el origen', () => {
    //  Devolver (0,0) metería una parada falsa en la esquina del almacén.
    expect(puntoDeParada(parada({ rackNodeId: 'no-existe' }), mapa)).toBeNull();
    expect(puntoDeParada(parada({ rackNodeId: null }), mapa)).toBeNull();
  });

  it('el giro del rack lleva la parada consigo', () => {
    const girado = rackDe20({ rotation: 90 }, 'nodo-a');
    const m2 = new Map([['nodo-a', girado]]);
    const a = puntoDeParada(parada({ bayIndex: 1 }), m2)!;
    const b = puntoDeParada(parada({ bayIndex: 20 }), m2)!;
    //  Sigue habiendo 19 m entre extremos, pero ahora sobre el otro eje.
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(19, 6);
    expect(Math.abs(b.x - a.x)).toBeCloseTo(19, 5);
  });
});

describe('la medida del recorrido', () => {
  const mapa = new Map([['nodo-a', rackDe20()]]);

  it('a 1 m/s los segundos son los metros', () => {
    const sim = simular(
      [parada({ id: '1', seq: 1, bayIndex: 1 }), parada({ id: '2', seq: 2, bayIndex: 20 })],
      mapa,
      1,
    );
    expect(sim.metros).toBeCloseTo(19, 2);
    expect(sim.segundosMarcha).toBeCloseTo(19, 1);
    expect(sim.segundosParado).toBe(0);
  });

  it('la velocidad divide el tiempo y NO la distancia', () => {
    const paradas = [
      parada({ id: '1', seq: 1, bayIndex: 1 }),
      parada({ id: '2', seq: 2, bayIndex: 20 }),
    ];
    const lento = simular(paradas, mapa, 1);
    const rapido = simular(paradas, mapa, 2);
    expect(rapido.metros).toBeCloseTo(lento.metros, 6);
    expect(rapido.segundosMarcha).toBeCloseTo(lento.segundosMarcha / 2, 2);
  });

  it('las paradas suman su tiempo, y la primera tambien', () => {
    //  Quien sale del muelle también tarda en cargar: la espera inicial cuenta.
    const sim = simular(
      [
        parada({ id: '1', seq: 1, bayIndex: 1, dwellS: 10 }),
        parada({ id: '2', seq: 2, bayIndex: 20, dwellS: 20 }),
      ],
      mapa,
      1,
    );
    expect(sim.segundosParado).toBeCloseTo(30, 1);
    expect(sim.segundosTotal).toBeCloseTo(49, 1);
    expect(sim.duracionMs).toBe(49_000);
  });

  it('el ORDEN cambia el resultado', () => {
    //  Las mismas paradas en otro orden son otro recorrido. Se ordena por `seq` y no por
    //  como lleguen.
    const ida = simular(
      [
        parada({ id: 'a', seq: 1, bayIndex: 1 }),
        parada({ id: 'b', seq: 2, bayIndex: 20 }),
        parada({ id: 'c', seq: 3, bayIndex: 10 }),
      ],
      mapa,
      1,
    );
    const mejor = simular(
      [
        parada({ id: 'a', seq: 1, bayIndex: 1 }),
        parada({ id: 'c', seq: 2, bayIndex: 10 }),
        parada({ id: 'b', seq: 3, bayIndex: 20 }),
      ],
      mapa,
      1,
    );
    //  19 + 10 = 29 frente a 9 + 10 = 19. Es EL caso de uso: reordenar ahorra metros.
    expect(ida.metros).toBeCloseTo(29, 2);
    expect(mejor.metros).toBeCloseTo(19, 2);
  });

  it('se ordena por seq aunque lleguen desordenadas', () => {
    const sim = simular(
      [parada({ id: 'b', seq: 2, bayIndex: 20 }), parada({ id: 'a', seq: 1, bayIndex: 1 })],
      mapa,
      1,
    );
    expect(sim.tramos[0]!.desde.id).toBe('a');
  });

  it('la ALTURA no se anda', () => {
    //  Dos huecos del mismo cuerpo a distinta altura están a cero metros de camino. Sumar la
    //  altura inventaría un recorrido vertical que nadie hace.
    const sim = simular(
      [
        parada({ id: '1', seq: 1, bayIndex: 5, level: 1 }),
        parada({ id: '2', seq: 2, bayIndex: 5, level: 4 }),
      ],
      mapa,
      1,
    );
    expect(sim.metros).toBeCloseTo(0, 6);
  });

  it('las paradas sin sitio se DICEN, no se ignoran', () => {
    //  Un recorrido de tres paradas del que solo cuentan dos sale barato precisamente porque
    //  le falta una. Callarlo daría un número bueno y falso.
    const sim = simular(
      [
        parada({ id: '1', seq: 1, bayIndex: 1 }),
        parada({ id: '2', seq: 2, rackNodeId: 'sin-colocar' }),
        parada({ id: '3', seq: 3, bayIndex: 20 }),
      ],
      mapa,
      1,
    );
    expect(sim.paradasSinSitio.map((p) => p.id)).toEqual(['2']);
    expect(sim.metros).toBeCloseTo(19, 2);
  });

  it('sin paradas no hay recorrido, y no revienta', () => {
    const sim = simular([], mapa, 1.2);
    expect(sim.tramos).toEqual([]);
    expect(sim.metros).toBe(0);
    expect(sim.duracionMs).toBe(0);
  });

  it('una velocidad absurda no produce infinitos', () => {
    //  Cero dividiría por cero y el total saldría `Infinity`, que en pantalla es un tiempo
    //  que no se puede leer.
    const sim = simular(
      [parada({ id: '1', seq: 1, bayIndex: 1 }), parada({ id: '2', seq: 2, bayIndex: 20 })],
      mapa,
      0,
    );
    expect(Number.isFinite(sim.segundosTotal)).toBe(true);
  });
});

describe('con buscador de caminos', () => {
  const mapa = new Map([['nodo-a', rackDe20()]]);
  const paradas = [
    parada({ id: '1', seq: 1, bayIndex: 1 }),
    parada({ id: '2', seq: 2, bayIndex: 20 }),
  ];

  it('rodear mide MAS que la recta, y se dice que se rodeo', () => {
    //  Un buscador de mentira que devuelve el doble: lo que se prueba es que `simular` USA lo
    //  que el buscador dice en vez de la recta, no la geometría —eso ya lo prueba
    //  `camino.test.ts`—.
    const doble = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      puntos: [a, b],
      metros: Math.hypot(b.x - a.x, b.y - a.y) * 2,
    });
    const recto = simular(paradas, mapa, 1);
    const rodeado = simular(paradas, mapa, 1, doble);
    expect(rodeado.metros).toBeCloseTo(recto.metros * 2, 2);
    //  Y el tiempo sube con la distancia: es lo que hace comparables dos disposiciones.
    expect(rodeado.segundosMarcha).toBeCloseTo(recto.segundosMarcha * 2, 1);
    expect(rodeado.rodeando).toBe(true);
    expect(recto.rodeando).toBe(false);
  });

  it('un tramo SIN camino se cuenta y deja de ser una medida entera', () => {
    //  Un hueco encerrado por racks no tiene camino. Callarlo dejaría un total que mezcla
    //  medidas con cotas sin decir cuáles.
    const ninguno = () => null;
    const sim = simular(paradas, mapa, 1, ninguno);
    expect(sim.tramosSinCamino).toBe(1);
    expect(sim.rodeando).toBe(false);
    //  Y se cae a la recta, no a cero: perder el tramo daría un total más corto que parece
    //  bueno.
    expect(sim.metros).toBeCloseTo(19, 2);
  });

  it('los vertices del camino viajan con el tramo, para poder dibujarlo', () => {
    //  Un número que dice «rodea el rack» y una línea que lo atraviesa serían dos
    //  afirmaciones contrarias en la misma pantalla.
    const conCurva = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      puntos: [a, { x: a.x + 5, y: a.y }, b],
      metros: 30,
    });
    const sim = simular(paradas, mapa, 1, conCurva);
    expect(sim.tramos[0]!.puntos).toHaveLength(3);
  });
});

describe('donde esta la figura en cada instante', () => {
  const mapa = new Map([['nodo-a', rackDe20()]]);
  const sim = simular(
    [
      parada({ id: '1', seq: 1, bayIndex: 1, dwellS: 10 }),
      parada({ id: '2', seq: 2, bayIndex: 20, dwellS: 5 }),
    ],
    mapa,
    1,
  );

  it('durante la espera inicial esta quieta en la primera parada', () => {
    const a = posicionEn(sim, 0)!;
    const b = posicionEn(sim, 9_000)!;
    expect(a).toEqual(b);
  });

  it('a mitad del tramo esta a mitad de camino', () => {
    //  El tramo va de 10 s a 29 s. En 19,5 s lleva la mitad.
    const p = posicionEn(sim, 19_500)!;
    const desde = sim.tramos[0]!.puntoDesde;
    const hasta = sim.tramos[0]!.puntoHasta;
    expect(p.y).toBeCloseTo((desde.y + hasta.y) / 2, 3);
  });

  it('va por el SUELO, no por la altura del hueco', () => {
    expect(posicionEn(sim, 19_500)!.z).toBe(0);
  });

  it('fuera de la ventana no hay posicion', () => {
    //  Dibujarla antes de empezar o después de acabar afirmaría que está ahí en un momento
    //  del que el recorrido no dice nada.
    expect(posicionEn(sim, -1)).toBeNull();
    expect(posicionEn(sim, sim.duracionMs + 1)).toBeNull();
  });

  it('dos paradas en el mismo punto no dan NaN', () => {
    //  Un tramo de duración cero no se puede interpolar: dividir por cero haría desaparecer
    //  la figura sin decir por qué.
    const igual = simular(
      [parada({ id: '1', seq: 1, bayIndex: 5 }), parada({ id: '2', seq: 2, bayIndex: 5 })],
      mapa,
      1,
    );
    const p = posicionEn(igual, 0);
    if (p) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EL RUMBO: QUE LA FIGURA ANDE DE FRENTE
//
// Sin rumbo, una persona recorre el almacén mirando siempre al mismo sitio: se desliza de
// lado como un mueble arrastrado, y eso no se lee como «andar», se lee como un fallo.
//
// Se prueba con direcciones donde el ángulo se sabe de memoria, porque el error clásico aquí
// —cambiar el orden de `atan2`— gira la figura 90° y desde una cámara alta cuesta verlo: una
// persona de espaldas y una de perfil se parecen.
// ═══════════════════════════════════════════════════════════════════════════════

describe('rumboEn', () => {
  const mapa = new Map([['nodo-a', rackDe20()]]);

  /** Un recorrido de dos paradas en la misma hilera: la marcha va sobre +y del dominio. */
  const haciaMasY = simular(
    [parada({ id: '1', seq: 1, bayIndex: 1 }), parada({ id: '2', seq: 2, bayIndex: 20 })],
    mapa,
    1,
  );

  it('andando hacia +y del dominio, el giro es 0', () => {
    //  La convención: el ángulo se mide desde +Z, que es hacia donde mira el modelo. Y el +y
    //  del dominio ES el +z de three.js.
    const r = rumboEn(haciaMasY, haciaMasY.duracionMs / 2)!;
    expect(r).toBeCloseTo(0, 6);
  });

  it('andando hacia -y, el giro es media vuelta', () => {
    const alReves = simular(
      [parada({ id: '1', seq: 1, bayIndex: 20 }), parada({ id: '2', seq: 2, bayIndex: 1 })],
      mapa,
      1,
    );
    expect(Math.abs(rumboEn(alReves, alReves.duracionMs / 2)!)).toBeCloseTo(Math.PI, 6);
  });

  it('andando hacia +x, el giro es un cuarto de vuelta', () => {
    /*
      LA prueba del orden de `atan2`. Con `atan2(dz, dx)` en vez de `atan2(dx, dz)` este caso
      daría 0 y el anterior daría 90°: la figura andaría girada y habría que verlo a ojo.

      El rack girado 90° pone su largo sobre x, así que la marcha va sobre +x.
    */
    const m2 = new Map([['nodo-a', rackDe20({ rotation: 90 })]]);
    const sim = simular(
      [parada({ id: '1', seq: 1, bayIndex: 1 }), parada({ id: '2', seq: 2, bayIndex: 20 })],
      m2,
      1,
    );
    expect(Math.abs(rumboEn(sim, sim.duracionMs / 2)!)).toBeCloseTo(Math.PI / 2, 4);
  });

  it('el rumbo sale del SUBTRAMO, no de la recta entre paradas', () => {
    /*
      Con camino andable, un tramo puede rodear un rack. Si el rumbo saliera de la recta entre
      paradas, la figura miraría al destino mientras camina en perpendicular — andando de lado
      justo en el momento en el que se está comprobando si cabe por el pasillo—.

      El camino de mentira sale primero hacia +x y luego hacia +y; a un cuarto del recorrido
      todavía va hacia +x.
    */
    const enEle = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      puntos: [a, { x: a.x + 10, y: a.y }, b],
      metros: 10 + Math.abs(b.y - a.y),
    });
    const sim = simular(
      [parada({ id: '1', seq: 1, bayIndex: 1 }), parada({ id: '2', seq: 2, bayIndex: 20 })],
      mapa,
      1,
      enEle,
    );
    expect(Math.abs(rumboEn(sim, sim.duracionMs * 0.15)!)).toBeCloseTo(Math.PI / 2, 3);
  });

  it('fuera del recorrido no hay rumbo', () => {
    //  Girar a 0 pondría la figura mirando al norte por sorpresa. Quien llama conserva el
    //  último, que es lo que hace alguien parado en una parada.
    expect(rumboEn(haciaMasY, -1)).toBeNull();
    expect(rumboEn(haciaMasY, haciaMasY.duracionMs + 5_000)).toBeNull();
  });

  it('sin tramos no hay rumbo', () => {
    expect(rumboEn(simular([], mapa, 1), 0)).toBeNull();
  });
});

describe('comoDuracion', () => {
  it('escribe el tiempo sin que haya que dividir', () => {
    expect(comoDuracion(45)).toBe('45 s');
    expect(comoDuracion(290)).toBe('4 min 50 s');
    expect(comoDuracion(600)).toBe('10 min');
    expect(comoDuracion(3_900)).toBe('1 h 5 min');
  });

  it('un tiempo negativo no se escribe al reves', () => {
    expect(comoDuracion(-5)).toBe('0 s');
  });
});
