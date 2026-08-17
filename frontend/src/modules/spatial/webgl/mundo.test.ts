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
  apoyarEnElSuelo,
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

/** La coordenada a lo largo del rack del cuerpo C001, nivel 1, posicion 1. */
function c001Simple(r: RackEnEscena): number {
  const p = placasDeHuecos(r).find(
    (q) => q.cuerpo === 0 && q.nivel === 1 && q.posicion_ === 1,
  )!;
  return p.posicion[2];
}

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

  /*
    ── EL RACK DOBLE: DOS DE ESPALDAS, MISMA NUMERACION ──────────────────────────

    Dos racks se ponen físicamente de espaldas para formar un rack doble, con los frentes
    opuestos. Y la numeración de los cuerpos NO se invierte: si uno empieza por C001 en un
    extremo, el que está de espaldas también empieza por C001 en ESE MISMO extremo.

    Girar 180° es cómo se modela el gemelo, y antes eso renumeraba los cuerpos físicamente:

        rack a   0°  →  C001 en y = −36,00
        rack a 180°  →  C001 en y = +36,00

    O sea, el hueco pintado como C001 de un lado quedaba enfrente del C021 del otro. Y eso se
    propaga a qué hueco se selecciona al pinchar y a la distancia de un recorrido: los dos
    sitios donde una equivocación no se ve, se cree.
  */
  it('un rack girado 180 numera los cuerpos desde el MISMO extremo fisico', () => {
    const cat = { bayCount: 21, maxLevel: 7, locationCount: 273 };
    const frente = enEscena({ layoutId: 'a', rotation: 0, length: 75.6 }, cat);
    const espalda = enEscena({ layoutId: 'b', rotation: 180, length: 75.6 }, cat);

    const c001De = (r: typeof frente) => {
      const p = placasDeHuecos(r).find((q) => q.cuerpo === 0 && q.nivel === 1 && q.posicion_ === 1)!;
      //  La coordenada a lo largo del rack: en un rack sin girar y en uno girado 180°, el eje
      //  largo es el mismo (z del mundo), así que las dos son comparables.
      return p.posicion[2];
    };
    expect(c001De(espalda)).toBeCloseTo(c001De(frente), 6);
  });

  it('y el ULTIMO cuerpo tambien acaba en el mismo extremo', () => {
    //  Con solo comprobar el primero, una implementación que colapsara todos los cuerpos en un
    //  punto pasaría la prueba anterior.
    const cat = { bayCount: 21, maxLevel: 7, locationCount: 273 };
    const frente = enEscena({ layoutId: 'a', rotation: 0, length: 75.6 }, cat);
    const espalda = enEscena({ layoutId: 'b', rotation: 180, length: 75.6 }, cat);
    const ultimoDe = (r: typeof frente) =>
      placasDeHuecos(r).find((q) => q.cuerpo === 20 && q.nivel === 1 && q.posicion_ === 1)!
        .posicion[2];
    expect(ultimoDe(espalda)).toBeCloseTo(ultimoDe(frente), 6);
    //  Y los dos extremos son DISTINTOS: el rack sigue teniendo 21 cuerpos repartidos.
    expect(Math.abs(ultimoDe(frente)! - c001Simple(frente))).toBeGreaterThan(60);
  });

  it('un rack a 90 y otro a 270 se numeran desde el mismo extremo', () => {
    //  El caso de empate: con el eje largo perpendicular a la referencia, hay que desempatar o
    //  la numeración se decide por el signo de un cero.
    const cat = { bayCount: 21, maxLevel: 7, locationCount: 273 };
    const a = enEscena({ layoutId: 'a', rotation: 90, length: 75.6 }, cat);
    const b = enEscena({ layoutId: 'b', rotation: 270, length: 75.6 }, cat);
    const c001X = (r: typeof a) =>
      placasDeHuecos(r).find((q) => q.cuerpo === 0 && q.nivel === 1 && q.posicion_ === 1)!
        .posicion[0];
    expect(c001X(b)).toBeCloseTo(c001X(a), 6);
  });

  it('un rack sin girar se numera EXACTAMENTE como antes', () => {
    //  La garantía de que este arreglo no toca los 30 racks que ya están colocados, todos a 0°.
    const r = enEscena({ rotation: 0, length: 75.6 }, { bayCount: 21, maxLevel: 7, locationCount: 273 });
    //  Centro del primer cuerpo: −largo/2 + anchoCelda/2, con 21 cuerpos de 2 posiciones.
    const anchoCelda = 75.6 / 21 / 2;
    expect(c001Simple(r)).toBeCloseTo(-75.6 / 2 + anchoCelda / 2, 6);
  });

  it('un rack sin estructura no produce placas', () => {
    const r = enEscena({}, { bayCount: 0, maxLevel: 0, locationCount: 0 });
    expect(placasDeHuecos(r)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LA CARA OPERATIVA: LOS HUECOS SOLO ESTAN POR DONDE SE COGEN
//
// Un rack tiene una cara buena, la que da al pasillo. Por la otra hay una pared, otro rack o
// el aire, y por ahí no se saca un palet.
//
// Mientras el modelo no supo cuál era, se pintaban las dos. Para un rack suelto eso solo es
// una cara de más que queda detrás. Para un RACK DOBLE es falso: las dos caras interiores
// están pegadas, ocupan el mismo plano, se solapan y muestran datos contradictorios.
//
//     pasillo │ ███ RCL21 ███ ║ ███ RCL22 ███ │ pasillo
//             ↑ cara buena    ↑↑ ahí no hay nada, y se pintaba dos veces
// ═══════════════════════════════════════════════════════════════════════════════

describe('la cara operativa', () => {
  const CAT = { bayCount: 4, maxLevel: 5, locationCount: 40 };

  it('sin declarar se pintan las DOS, como antes de que existiera el campo', () => {
    //  La garantía de que esto no cambia nada de lo que ya estaba en pantalla: no hay de
    //  dónde sacar la cara, y elegir una por defecto sería inventarse el almacén.
    const r = enEscena({}, CAT);
    expect(r.frente).toBeNull();
    expect(placasDeHuecos(r)).toHaveLength(4 * 5 * 2 * 2);
  });

  it('declarada, sale la mitad de placas y todas en esa cara', () => {
    const r = enEscena({ frente: 1 }, CAT);
    const placas = placasDeHuecos(r);
    expect(placas).toHaveLength(4 * 5 * 2);
    expect(placas.every((p) => p.lado === 1)).toBe(true);
    //  Sin girar, la cara `+1` está en las `x` positivas del mundo.
    expect(placas.every((p) => p.posicion[0] > 0)).toBe(true);
  });

  it('la cara −1 sale al otro lado, y no es la misma que la +1', () => {
    const mas = placasDeHuecos(enEscena({ layoutId: 'a', frente: 1 }, CAT));
    const menos = placasDeHuecos(enEscena({ layoutId: 'b', frente: -1 }, CAT));
    expect(menos.every((p) => p.posicion[0] < 0)).toBe(true);
    expect(mas).toHaveLength(menos.length);
  });

  /*
    ── EL RACK DOBLE, CON SU GEOMETRIA DE VERDAD ─────────────────────────────────

    Dos racks de 1,1 m pegados por la espalda, centros en x = 0 y x = 1,1. El plano donde se
    tocan está en x = 0,55, y ahí no hay hueco ninguno: es donde chocan las dos traseras.

              −0,55      0,55      1,65
                │ ███ a ███║███ b ███ │
        pasillo ↑          ↑          ↑ pasillo
                cara de a  las espaldas   cara de b

    Las dos mitades llevan el MISMO valor de cara —`-1`— y salen a lados contrarios, porque
    el gemelo está girado 180° y el giro ya invierte hacia dónde apunta. Eso es lo que
    justifica guardar la cara en el marco local del rack y no como rumbo del almacén: quien
    modela no tiene que acordarse de poner una al revés.

    Se comprueba con las dos pruebas juntas, y hacen falta las dos: la primera dice que con
    la cara declarada nada cae en la espalda, y la segunda dice que sin declararla SI caía —o
    sea, que el arreglo arregla algo—.
  */
  const parDeEspaldas = (frente?: 1 | -1) => {
    const cara = frente === undefined ? {} : { frente };
    return [
      enEscena({ layoutId: 'a', x: 0, rotation: 0, width: 1.1, ...cara }, CAT),
      enEscena({ layoutId: 'b', x: 1.1, rotation: 180, width: 1.1, ...cara }, CAT),
    ] as const;
  };

  /** Placas de los dos racks que caen sobre el plano donde se tocan las espaldas. */
  const enLaEspalda = (racks: readonly ReturnType<typeof enEscena>[]) =>
    racks.flatMap((r) => placasDeHuecos(r)).filter((p) => Math.abs(p.posicion[0] - 0.55) < 0.1);

  it('EL RACK DOBLE: con la cara declarada, nada queda entre las dos espaldas', () => {
    const [a, b] = parDeEspaldas(-1);
    //  Cada mitad saca sus huecos HACIA FUERA del par, a su propio pasillo.
    expect(placasDeHuecos(a).every((p) => p.posicion[0] < 0)).toBe(true);
    expect(placasDeHuecos(b).every((p) => p.posicion[0] > 1.1)).toBe(true);
    expect(enLaEspalda([a, b])).toHaveLength(0);
  });

  it('y sin declararla, las dos caras interiores se solapan hueco por hueco', () => {
    //  La contraprueba. Sin ella, la de arriba pasaría igual con una implementación que no
    //  pintara nada, y no diría que el problema existía.
    const par = parDeEspaldas();
    const dentro = enLaEspalda(par);
    //  Un juego entero de huecos por cada mitad, todos en el mismo plano físico.
    expect(dentro).toHaveLength(2 * 4 * 5 * 2);

    //  Y no es que estén cerca: coinciden. Cada placa de `a` tiene una de `b` en su sitio,
    //  con datos de otro hueco, peleándose por el mismo píxel.
    const deA = dentro.filter((p) => p.posicion[0] < 0.55);
    const deB = dentro.filter((p) => p.posicion[0] > 0.55);
    const solapadas = deA.filter((pa) =>
      deB.some(
        (pb) =>
          Math.abs(pa.posicion[1] - pb.posicion[1]) < 0.01 &&
          Math.abs(pa.posicion[2] - pb.posicion[2]) < 0.01,
      ),
    );
    expect(solapadas).toHaveLength(deA.length);
  });

  it('la cuenta previa sigue coincidiendo con lo construido, con caras mezcladas', () => {
    //  `cuantasPlacas` reserva el búfer. Un `* 2` fijo contaría de más con caras declaradas
    //  —solo cuesta memoria— pero la prueba está por el error contrario: si algún día se
    //  contara de menos, faltarían placas al final y el síntoma sería «a los racks del fondo
    //  les faltan huecos», que no se parece a su causa.
    const racks = [
      enEscena({ layoutId: 'a' }, { bayCount: 21, maxLevel: 7, locationCount: 273 }),
      enEscena({ layoutId: 'b', frente: 1 }, { bayCount: 27, maxLevel: 5, locationCount: 135 }),
      enEscena({ layoutId: 'c', frente: -1 }, { bayCount: 4, maxLevel: 5, locationCount: 40 }),
      enEscena({ layoutId: 'd', frente: 1 }, { bayCount: 0, maxLevel: 0, locationCount: 0 }),
    ];
    expect(cuantasPlacas(racks)).toBe(racks.flatMap((r) => placasDeHuecos(r)).length);
  });

  it('declarar la cara NO renumera los huecos', () => {
    //  La numeración y la cara son dos cosas: cuál es el cuerpo C001 no depende de por dónde
    //  se saque el palet. Si declarar la cara moviera los números, el hueco que alguien
    //  inspeccionó ayer sería otro hoy.
    const sin = enEscena({ layoutId: 'a' }, CAT);
    const con = enEscena({ layoutId: 'b', frente: 1 }, CAT);
    const clave = (p: { cuerpo: number; nivel: number; posicion_: number }) =>
      claveDeHueco(p.cuerpo, p.nivel, p.posicion_);
    const deUnLado = placasDeHuecos(sin).filter((p) => p.lado === 1).map(clave).sort();
    expect(placasDeHuecos(con).map(clave).sort()).toEqual(deUnLado);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// APOYAR UNA FIGURA EN EL SUELO
//
// Un `.glb` no dice dónde tiene los pies: cada herramienta pone el origen donde quiere.
// Reportado con una persona hecha a mano: «queda dividido en el mapa, bajo tierra, o la mitad
// si es visible sobre la superficie».
//
// No es estético: a una persona a la que se le ve medio cuerpo no se le puede juzgar si cabe
// en un pasillo.
// ═══════════════════════════════════════════════════════════════════════════════

describe('apoyarEnElSuelo', () => {
  it('un modelo con el origen en el CENTRO sube su media altura', () => {
    //  El caso reportado: una persona de 1,75 m con el origen centrado va de −0,875 a +0,875.
    //  Colocada a 0 quedaba medio enterrada; hay que subirla 0,875.
    expect(apoyarEnElSuelo(-0.875, 0)).toBeCloseTo(0.875, 6);
  });

  it('un modelo con el origen en la BASE no se mueve', () => {
    //  La misma regla vale para los dos casos, así que no hay que preguntar cuál es cuál.
    expect(apoyarEnElSuelo(0, 0)).toBe(0);
  });

  it('con la figura escalada, el desfase es el de la figura escalada', () => {
    /*
      El punto más bajo tiene que venir YA ESCALADO —`Box3.setFromObject` lo hace—. Con escala
      8, un modelo centrado de 1,75 m mide 14 y su base está a −7, así que hay que subirlo 7,
      no 0,875.

      Con escala 1, que es como cualquiera lo probaría, las dos versiones dan lo mismo: el
      defecto no aparecería hasta que alguien escalara una figura.
    */
    expect(apoyarEnElSuelo(-7, 0)).toBeCloseTo(7, 6);
  });

  it('la altura pedida se respeta: un dron a 6 m apoya su base ahi', () => {
    expect(apoyarEnElSuelo(-0.15, 6)).toBeCloseTo(6.15, 6);
  });

  it('un modelo que empieza POR ENCIMA de su origen baja', () => {
    //  Existe: un exportador puede dejar el modelo flotando sobre su origen. Entonces hay que
    //  bajarlo, o la figura aparece levitando.
    expect(apoyarEnElSuelo(0.5, 0)).toBeCloseTo(-0.5, 6);
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
