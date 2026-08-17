/**
 * EL RACK COMO ESTANTERIA: QUE LAS PIEZAS ESTEN DONDE ESTAN LOS DATOS.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE PRUEBA
 *
 * No que la estantería sea bonita —eso se mira— sino que sea VERDAD: que tenga los cuerpos y
 * los niveles que dice el catálogo, que los apoyos caigan donde el visor pinta cada hueco, y
 * que nada asome fuera de la silueta que las otras dos vistas dibujan como rack.
 *
 * Esa última es la que evita el fallo más caro: una pieza que sobresale medio metro pinta
 * hierro dentro del pasillo por el que después se mide un recorrido, y en pantalla se ve
 * perfectamente normal.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE NO SE PRUEBAN LAS FORMULAS
 *
 * Porque comprobar que la cuenta es la que escribí sería comprobar que sé copiar. Se prueba
 * lo que se puede medir sobre el resultado: cuántas piezas hay de cada tipo, a qué alturas
 * están, y a qué distancia caen unas de otras.
 */

import { describe, expect, it } from 'vitest';

import { componerEscena } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';
import type { PositionedRack } from '../editor/types';
import type { FloorPlanCell } from '../types/index';
import {
  alturasDeLarguero,
  cuantasPiezas,
  estructuraDeRack,
  PIEZAS_MAXIMAS,
} from './estructura';
import type { Pieza, TipoDePieza } from './estructura';

function rack(over: Partial<PositionedRack> = {}): PositionedRack {
  return {
    layoutId: 'l1',
    rackCode: 'RCL47',
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

/**
 * El catálogo de un rack.
 *
 * Las POSICIONES por cuerpo no son un campo: salen de `ubicaciones / (cuerpos x niveles)`,
 * que es como las calcula `posicionesDe` para las tres vistas. Así que para probar un rack
 * de una sola posición hay que darle la mitad de ubicaciones, no cambiar una bandera — y
 * decirlo aquí evita escribir un caso que no prueba lo que dice—.
 */
function celda(over: Partial<FloorPlanCell> = {}): FloorPlanCell {
  return {
    rackId: 'uuid-rcl47',
    rackCode: 'RCL47',
    bayCount: 21,
    maxLevel: 7,
    //  21 cuerpos x 7 niveles x 2 posiciones.
    locationCount: 294,
    ...over,
  } as unknown as FloorPlanCell;
}

/** RCL47 medido: 21 cuerpos, 7 niveles, 2 posiciones. El rack real de las pruebas. */
function enEscena(
  overRack: Partial<PositionedRack> = {},
  overCat: Partial<FloorPlanCell> = {},
): RackEnEscena {
  return componerEscena([rack(overRack)], 1, { x: 0, y: 0 }, [celda(overCat)], new Map())[0]!;
}

const deTipo = (piezas: Pieza[], t: TipoDePieza) => piezas.filter((p) => p.tipo === t);

describe('la estructura del rack', () => {
  it('hay un bastidor a cada lado de cada cuerpo, y uno que cierra', () => {
    //  21 cuerpos son 22 juntas. Con 21 el extremo se quedaría colgando, que es el error
    //  clasico del bucle de una valla.
    const piezas = estructuraDeRack(enEscena());
    expect(deTipo(piezas, 'montante')).toHaveLength(22 * 2);
  });

  it('hay un larguero por cuerpo, nivel y cara, y el suelo no lleva', () => {
    //  El primer nivel se apoya en el suelo: poner un larguero a la cota 0 pondría una viga
    //  atravesando el pasillo a ras de suelo.
    const piezas = estructuraDeRack(enEscena());
    expect(deTipo(piezas, 'larguero')).toHaveLength(21 * 6 * 2);
    expect(alturasDeLarguero(enEscena())).toHaveLength(6);
  });

  it('hay DOS apoyos por posicion: son los que hacen visibles los dos huecos', () => {
    //  Entre dos bastidores no hay nada que separe las dos posiciones de un cuerpo, así que
    //  sin esto un cuerpo de dos posiciones se vería igual que uno de una.
    const piezas = estructuraDeRack(enEscena());
    expect(deTipo(piezas, 'apoyo')).toHaveLength(21 * 7 * 2 * 2);
  });

  it('un rack de UNA posicion por cuerpo tiene la mitad de apoyos', () => {
    //  La comprobación de que las dos posiciones salen del catálogo y no están puestas a
    //  mano: cambiando el dato, cambia la estantería.
    const una = estructuraDeRack(enEscena({}, { locationCount: 147 }));
    expect(deTipo(una, 'apoyo')).toHaveLength(21 * 7 * 1 * 2);
  });

  it('los largueros estan a las alturas de los niveles, no repartidos a ojo', () => {
    //  11,9 m entre 7 niveles son 1,7 m: los largueros van a 1,7, 3,4… y el de arriba a
    //  10,2. Si estuvieran a otra cota, contar niveles en pantalla daria una altura y el
    //  dato otra.
    const r = enEscena();
    const alturas = alturasDeLarguero(r);
    expect(alturas.map((z) => Number(z.toFixed(3)))).toEqual([1.7, 3.4, 5.1, 6.8, 8.5, 10.2]);

    const ys = new Set(deTipo(estructuraDeRack(r), 'larguero').map((p) => p.posicion[1].toFixed(3)));
    //  El larguero se apoya bajo la cota, no la atraviesa: su centro está medio canto abajo.
    expect(ys.size).toBe(6);
  });

  it('NADA se sale de la silueta del rack, girado como sea', () => {
    /*
      Es la prueba que importa. Una pieza que asome medio metro mete hierro en el pasillo por
      el que después se mide un recorrido, y en pantalla no se ve nada raro.

      Se comprueba en coordenadas del rack: se deshace el giro sobre cada esquina de cada
      pieza y se mira que caiga dentro de la caja de `ancho x largo x alto`.
    */
    for (const g of [0, 37.5, 90, 137, 180, 270, 359]) {
      const r = enEscena({ rotation: g, x: 12, y: -34 });
      const t = (-g * Math.PI) / 180;
      const cos = Math.cos(t);
      const sen = Math.sin(t);
      for (const p of estructuraDeRack(r)) {
        //  Del mundo al marco local: se resta el centro y se gira al revés.
        const dx = p.posicion[0] - r.x;
        const dz = p.posicion[2] - r.y;
        const u = dx * cos - dz * sen;
        const v = dx * sen + dz * cos;
        const EPS = 1e-6;
        expect(Math.abs(u) + p.escala[0] / 2).toBeLessThanOrEqual(r.ancho / 2 + EPS);
        expect(Math.abs(v) + p.escala[2] / 2).toBeLessThanOrEqual(r.largo / 2 + EPS);
        expect(p.posicion[1] - p.escala[1] / 2).toBeGreaterThanOrEqual(-EPS);
        expect(p.posicion[1] + p.escala[1] / 2).toBeLessThanOrEqual(r.alto + EPS);
      }
    }
  });

  it('los apoyos de un hueco estan donde el visor pinta ese hueco', () => {
    /*
      La estructura y los datos tienen que coincidir. Si los apoyos se repartieran con su
      propia cuenta, el palet dibujado en el C018 se apoyaría en el hierro del C017 — y peor:
      pinchar el hueco daría uno y mirarlo daría otro—.

      Se comprueba que los dos apoyos de cada posición están CENTRADOS en la coordenada que
      da la función compartida, la misma que usan las placas y las paradas.
    */
    const r = enEscena();
    const apoyos = deTipo(estructuraDeRack(r), 'apoyo').filter(
      (p) => Math.abs(p.posicion[1] - 0.02) < 1e-6,
    );
    //  Sin girar, la coordenada a lo largo es la `z` del mundo. Se agrupan de dos en dos y
    //  se mira el punto medio de cada par.
    const centros = [...new Set(apoyos.map((p) => Number(p.posicion[2].toFixed(4))))].sort(
      (a, b) => a - b,
    );
    //  42 posiciones en el nivel 1 —21 cuerpos x 2— y dos apoyos cada una, en cotas
    //  distintas: 84 valores.
    expect(centros).toHaveLength(84);

    const anchoCelda = 56.7 / 21 / 2;
    for (let i = 0; i < centros.length; i += 2) {
      const medio = (centros[i]! + centros[i + 1]!) / 2;
      //  El primer hueco cae en −largo/2 + anchoCelda/2 y de ahí en adelante.
      const esperado = -56.7 / 2 + (i / 2) * anchoCelda + anchoCelda / 2;
      expect(medio).toBeCloseTo(esperado, 6);
    }
  });

  it('hay UNA marca entre las dos posiciones de cada celda, y ninguna al final', () => {
    //  Al final del cuerpo ya está el bastidor: otra marca ahí sería una raya sobre un
    //  montante, y contando marcas alguien leería tres posiciones donde hay dos.
    const piezas = estructuraDeRack(enEscena());
    expect(deTipo(piezas, 'separador')).toHaveLength(21 * 7 * 1);
  });

  it('un rack de UNA posicion por cuerpo no tiene ninguna marca', () => {
    //  Nada que separar. Una marca en el centro de un cuerpo de una sola posición diría que
    //  hay dos huecos donde hay uno, que es peor que no decir nada.
    const una = estructuraDeRack(enEscena({}, { locationCount: 147 }));
    expect(deTipo(una, 'separador')).toHaveLength(0);
  });

  it('la marca cae en el BORDE entre las dos posiciones, no en medio de una', () => {
    /*
      Es lo que la hace útil: separa dos huecos. Media celda corrida partiría un palet por la
      mitad y dejaría dos marcas juntas en un sitio y ninguna en otro, y desde el pasillo se
      contarían mal las posiciones — que es justo lo que esto viene a arreglar—.

      Se mide contra el reparto real: el borde tiene que estar a media celda del centro de la
      primera posición Y a media celda del centro de la segunda.
    */
    const r = enEscena();
    const anchoCelda = 56.7 / 21 / 2;
    const marcas = deTipo(estructuraDeRack(r), 'separador')
      .filter((p) => Math.abs(p.posicion[1] - 11.9 / 7 / 2) < 1e-6)
      .map((p) => p.posicion[2])
      .sort((a, b) => a - b);
    expect(marcas).toHaveLength(21);

    //  Los centros de las celdas del nivel 1, del mismo reparto compartido.
    const centros = deTipo(estructuraDeRack(r), 'apoyo')
      .filter((p) => Math.abs(p.posicion[1] - 0.02) < 1e-6)
      .map((p) => p.posicion[2])
      .sort((a, b) => a - b);
    //  Cada marca, a media celda del centro de las dos posiciones que separa.
    for (const marca of marcas) {
      const cerca = centros.filter((c) => Math.abs(c - marca) < anchoCelda);
      expect(cerca.length).toBeGreaterThan(0);
      expect(Math.min(...cerca.map((c) => Math.abs(c - marca)))).toBeLessThan(anchoCelda / 2);
    }
  });

  it('girar el rack 180 no mueve las marcas de sitio', () => {
    //  La numeración se invierte al girar —para que C001 quede en la misma punta— y el borde
    //  «derecho» de una celda pasa a estar al otro lado. Con el signo mal, las marcas de un
    //  rack de espaldas saldrían corridas media celda respecto a las de su pareja.
    //  El `+ 0` no sobra: girar 180° convierte el separador del centro exacto en `-0`, y
    //  `-0` no es `0` para la comparación aunque midan lo mismo. Sumar cero lo normaliza —y
    //  este es el único sitio donde la diferencia importa, porque el rack es simétrico—.
    const marcas = (g: number) =>
      deTipo(estructuraDeRack(enEscena({ rotation: g })), 'separador')
        .map((p) => Number(p.posicion[2].toFixed(6)) + 0)
        .sort((a, b) => a - b);
    expect(marcas(180)).toEqual(marcas(0));
  });

  it('los dos apoyos de una posicion estan SEPARADOS', () => {
    //  Si coincidieran, un palet se apoyaría en una sola barra y las dos posiciones de un
    //  cuerpo volverían a leerse como una.
    const apoyos = deTipo(estructuraDeRack(enEscena()), 'apoyo');
    const primeros = apoyos.slice(0, 2);
    const d = Math.abs(primeros[0]!.posicion[2] - primeros[1]!.posicion[2]);
    expect(d).toBeGreaterThan(0.5);
  });

  it('un rack que el catalogo no conoce NO tiene estructura inventada', () => {
    //  `cuerpos = 0` es el rack cuyo código no está importado. Dibujarle siete niveles sería
    //  afirmar una estructura que nadie declaró, y en pantalla se vería igual que la real.
    const sinCatalogo = componerEscena([rack()], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    expect(estructuraDeRack(sinCatalogo)).toEqual([]);
    expect(cuantasPiezas([sinCatalogo])).toBe(0);
  });

  it('un rack de UN nivel no lleva largueros, pero si bastidores', () => {
    //  Caso borde del `niveles - 1`: con uno solo no hay ninguna cota intermedia. Un `- 1`
    //  sin acotar habría dado −1 y un bucle vacío o negativo según cómo se escriba.
    const r = enEscena({}, { maxLevel: 1, locationCount: 42 });
    const piezas = estructuraDeRack(r);
    expect(deTipo(piezas, 'larguero')).toHaveLength(0);
    expect(deTipo(piezas, 'montante')).toHaveLength(22 * 2);
    //  Y sigue teniendo sus apoyos: un nivel con dos posiciones son dos huecos.
    expect(deTipo(piezas, 'apoyo')).toHaveLength(21 * 1 * 2 * 2);
  });

  it('la cuenta previa coincide con lo construido, para cualquier forma de rack', () => {
    /*
      `cuantasPiezas` decide si se construye la estantería o se deja el cajón macizo. Si
      contara distinto de lo que luego sale, la decisión se tomaría con un número falso.

      Se prueban formas distintas a propósito: el rack real, uno de un nivel, uno de una
      posición, uno de un solo cuerpo y uno que el catálogo no conoce.
    */
    const racks = [
      enEscena({ layoutId: 'a' }),
      enEscena({ layoutId: 'b' }, { maxLevel: 1, locationCount: 42 }),
      enEscena({ layoutId: 'c' }, { locationCount: 147 }),
      enEscena({ layoutId: 'd', length: 2.7 }, { bayCount: 1, maxLevel: 5, locationCount: 10 }),
      componerEscena([rack({ layoutId: 'e' })], 1, { x: 0, y: 0 }, [], new Map())[0]!,
    ];
    const construidas = racks.flatMap((r) => estructuraDeRack(r));
    expect(cuantasPiezas(racks)).toBe(construidas.length);
  });

  it('el catalogo entero cabe holgadamente en el tope', () => {
    /*
      347 racks como RCL47 son el peor caso realista, y son unas 411.000 piezas. Se mide en
      vez de fiarse del comentario: al añadir la marca entre posiciones la cuenta subió y se
      pasó del tope que había, y esta prueba fue la que lo dijo.

      Importa porque pasarse no degrada un poco: el visor vuelve entero al cajón macizo, y lo
      haría justo cuando el almacén esté completo, que es cuando hace falta verlo.
    */
    const catalogoEntero = cuantasPiezas([enEscena()]) * 347;
    expect(catalogoEntero).toBeGreaterThan(400_000);
    expect(catalogoEntero).toBeLessThan(PIEZAS_MAXIMAS / 2);
  });

  it('girar el rack no cambia CUANTAS piezas tiene', () => {
    //  Suena obvio y no lo es: los montantes de las puntas se meten hacia dentro con un
    //  acotado, y un acotado mal puesto podría colapsar dos en uno según el ángulo.
    const cuenta = (g: number) => estructuraDeRack(enEscena({ rotation: g })).length;
    const base = cuenta(0);
    for (const g of [37.5, 90, 180, 270]) expect(cuenta(g)).toBe(base);
  });
});
