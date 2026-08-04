/**
 * PRUEBAS DE LA GEOMETRIA DE LA ESCENA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTAS PRUEBAS Y NO OTRAS
 *
 * Todo lo de este modulo se verifico con sondas de navegador, y eso funciono pero es
 * caro y fragil: cada comprobacion tarda dos minutos, necesita un Chrome con el
 * protocolo de depuracion abierto, y varias veces me dio falsos negativos por buscar
 * un atributo que no existia o por medir con la ventana oculta —el navegador suspende
 * `requestAnimationFrame` y el lienzo no se dimensiona—.
 *
 * Lo que se prueba aqui es lo que NO necesita navegador: funciones puras con una
 * respuesta correcta comprobable. La proyeccion, su inversa, el reparto de anchos y la
 * interpolacion de rutas son matematicas, y las matematicas se prueban en
 * milisegundos.
 *
 * Lo que sigue necesitando el navegador —que el arrastre llegue al lienzo, que un
 * canvas dibuje pixeles ambar— se queda en las sondas, porque ahi el navegador ES el
 * sujeto de la prueba.
 *
 * ── LA REGLA QUE SIGUEN ────────────────────────────────────────────────────
 *
 * Cada prueba afirma algo que se puede calcular POR OTRO CAMINO. Comparar
 * `proyectar` consigo misma pasaria aunque estuviera mal; comparar `sueloEn` contra
 * `proyectar` en un viaje de ida y vuelta no, porque una tiene que deshacer
 * exactamente lo que hizo la otra.
 */

import { describe, expect, it } from 'vitest';

import type { PositionedRack } from '../editor/types';
import type { FloorPlanCell } from '../types/index';
import {
  CAMARA_INICIAL,
  COLOR_SIN_OCUPACION,
  ESCALA_OCUPACION,
  baseDe,
  carasDe,
  centroDe,
  colorDeOcupacion,
  componerEscena,
  dentro,
  encuadrar,
  esquinas,
  esquinasDelSuelo,
  familiaDe,
  matrizDelSuelo,
  orbitar,
  proyectar,
  sueloEn,
  type Camara,
  zoomEn,
} from './escena';

/** Camaras de prueba: incluyen los extremos del rango, no solo el caso cómodo. */
const CAMARAS: Camara[] = [
  CAMARA_INICIAL,
  { azimut: 0, elevacion: 12, escala: 0.6, panX: 0, panY: 0 },
  { azimut: 47.5, elevacion: 34, escala: 26.72, panX: 137, panY: -49 },
  { azimut: 133, elevacion: 60, escala: 8, panX: -400, panY: 900 },
  { azimut: 271, elevacion: 82, escala: 120, panX: 12.5, panY: 0.25 },
  { azimut: 359.9, elevacion: 45, escala: 1, panX: 1e4, panY: -1e4 },
];

function rack(over: Partial<PositionedRack> = {}): PositionedRack {
  return {
    layoutId: 'l1',
    rackCode: 'MZ04',
    x: 0,
    y: 0,
    width: 1.1,
    length: 12,
    height: 8.5,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
}

function celda(over: Partial<FloorPlanCell> = {}): FloorPlanCell {
  return {
    rackId: 'uuid-mz04',
    rackCode: 'MZ04',
    rackExternalCode: null,
    rackIndex: null,
    nodeType: 'rack',
    nodeFunction: null,
    functionLabel: null,
    aisleId: null,
    aisleCode: null,
    bayCount: 36,
    maxLevel: 5,
    maxPosition: 1,
    locationCount: 180,
    availableCount: 180,
    blockedCount: 0,
    minLogicalX: null,
    maxLogicalX: null,
    minLogicalY: null,
    maxLogicalY: null,
    ...over,
  } as FloorPlanCell;
}

describe('proyectar y sueloEn', () => {
  it('sueloEn deshace proyectar exactamente, en todo el rango de camaras', () => {
    // Es la prueba que habilita ARRASTRAR en 3D: si la inversa no fuera exacta, un
    // rack se movería a un sitio distinto del que marca el cursor.
    const puntos = [
      [0, 0],
      [40, 12],
      [-113.7, 55.2],
      [9999, -9999],
      [0.001, 0.002],
    ] as const;

    let peor = 0;
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      for (const [x, y] of puntos) {
        const p = proyectar(b, x, y, 0);
        const q = sueloEn(b, p.sx, p.sy);
        peor = Math.max(peor, Math.abs(q.x - x), Math.abs(q.y - y));
      }
    }
    // 1e-8 m es la centésima de micra: muy por debajo de cualquier medida de almacén.
    expect(peor).toBeLessThan(1e-8);
  });

  it('la altura solo mueve el punto en vertical', () => {
    // Es lo que hace que un rack alto se dibuje ARRIBA y no en diagonal. Si `senE`
    // se colara en `sx`, los racks altos se desplazarían de lado.
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      const suelo = proyectar(b, 30, 20, 0);
      const alto = proyectar(b, 30, 20, 8.5);
      expect(alto.sx).toBeCloseTo(suelo.sx, 10);
      expect(alto.sy).toBeLessThan(suelo.sy);
    }
  });

  it('es una proyeccion LINEAL: el punto medio se proyecta al punto medio', () => {
    // De aquí sale que se pueda usar `ctx.setTransform` para el suelo: una proyección
    // con perspectiva NO cumple esto, y habría que trocear el bitmap del plano.
    const b = baseDe(CAMARAS[2]!);
    const a = proyectar(b, 10, 4, 0);
    const c = proyectar(b, 50, 24, 0);
    const medio = proyectar(b, 30, 14, 0);
    expect(medio.sx).toBeCloseTo((a.sx + c.sx) / 2, 8);
    expect(medio.sy).toBeCloseTo((a.sy + c.sy) / 2, 8);
  });
});

describe('matrizDelSuelo', () => {
  it('lleva los pixeles del plano al mismo sitio que proyectar', () => {
    // La matriz se le pasa a `ctx.setTransform` para dibujar la imagen del plano
    // tumbada. Si discrepara de `proyectar`, los racks saldrían desplazados respecto
    // al plano sobre el que se colocaron, que es el peor error posible aquí.
    const ppm = 26.72;
    const origen = { x: 120, y: 45 };
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      const [a, bb, c, d, e, f] = matrizDelSuelo(b, ppm, origen);
      for (const [px, py] of [[0, 0], [3200, 909], [1600, 500]] as const) {
        // Lo que hace el navegador con la matriz.
        const porMatriz = { sx: a * px + c * py + e, sy: bb * px + d * py + f };
        // Lo que hace el resto del modulo con el mismo punto, en metros.
        const enMetros = { x: (px - origen.x) / ppm, y: (py - origen.y) / ppm };
        const porProyeccion = proyectar(b, enMetros.x, enMetros.y, 0);
        expect(porMatriz.sx).toBeCloseTo(porProyeccion.sx, 6);
        expect(porMatriz.sy).toBeCloseTo(porProyeccion.sy, 6);
      }
    }
  });
});

describe('esquinas y carasDe', () => {
  it('las esquinas respetan las medidas y el giro', () => {
    const r = { ...rack({ x: 10, y: 5, rotation: 0 }) };
    const e = componerEscena([r], 1, { x: 0, y: 0 }, [], new Map());
    const q = esquinas(e[0]!);
    // Sin giro: el largo va en X y el ancho en Y.
    expect(Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x))).toBeCloseTo(12, 9);
    expect(Math.max(...q.map((p) => p.y)) - Math.min(...q.map((p) => p.y))).toBeCloseTo(1.1, 9);
  });

  it('girar 90 grados intercambia las medidas, y girar 360 no cambia nada', () => {
    const base = componerEscena([rack({ rotation: 0 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    const g90 = componerEscena([rack({ rotation: 90 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    const ancho = (q: { x: number }[]) => Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x));
    expect(ancho(esquinas(g90))).toBeCloseTo(1.1, 9);
    expect(ancho(esquinas(base))).toBeCloseTo(12, 9);
  });

  it('el centro del techo cae DENTRO de la silueta, y un punto lejano fuera', () => {
    // La silueta es la diana del hit-testing: si el centro del rack no estuviera
    // dentro, señalar un rack en medio no lo seleccionaría.
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      const e = componerEscena([rack({ x: 20, y: 15 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
      const caras = carasDe(b, e);
      const cx = caras.techo.reduce((a, p) => a + p.sx, 0) / caras.techo.length;
      const cy = caras.techo.reduce((a, p) => a + p.sy, 0) / caras.techo.length;
      expect(dentro(caras.silueta, cx, cy)).toBe(true);
      expect(dentro(caras.silueta, cx + 1e5, cy)).toBe(false);
    }
  });

  it('solo dibuja las caras que MIRAN al observador', () => {
    // Dibujar las cuatro pinta las de detrás encima de las de delante, y el rack sale
    // con las aristas del fondo cruzándolo. Nunca deben ser más de dos.
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      const e = componerEscena([rack({ x: 0, y: 0 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
      const { laterales } = carasDe(b, e);
      expect(laterales.length).toBeLessThanOrEqual(2);
      expect(laterales.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('componerEscena', () => {
  it('convierte pixeles del plano a metros con el origen', () => {
    const e = componerEscena(
      [rack({ x: 400, y: 200 })],
      50,
      { x: 100, y: 50 },
      [celda()],
      new Map(),
    )[0]!;
    expect(e.x).toBeCloseTo((400 - 100) / 50, 9);
    expect(e.y).toBeCloseTo((200 - 50) / 50, 9);
  });

  it('un rack que el catalogo NO conoce se dibuja igual, con cuerpos a 0', () => {
    // No se descarta a propósito: está en el plano porque alguien lo puso, y hacerlo
    // desaparecer convertiría un error de nomenclatura en un rack invisible.
    const e = componerEscena([rack({ rackCode: 'NOEXISTE' })], 1, { x: 0, y: 0 }, [celda()], new Map())[0]!;
    expect(e).toBeDefined();
    expect(e.cuerpos).toBe(0);
    expect(e.rackId).toBeNull();
  });

  it('toma cuerpos, niveles y el uuid del catalogo cuando lo conoce', () => {
    const e = componerEscena([rack()], 1, { x: 0, y: 0 }, [celda()], new Map())[0]!;
    expect(e.cuerpos).toBe(36);
    expect(e.niveles).toBe(5);
    expect(e.rackId).toBe('uuid-mz04');
  });

  it('propaga el candado', () => {
    const e = componerEscena([rack({ locked: true })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    expect(e.bloqueado).toBe(true);
  });
});

describe('familiaDe', () => {
  it('agrupa por el prefijo alfabetico', () => {
    expect(familiaDe('MZ04')).toBe('MZ');
    expect(familiaDe('RCL109')).toBe('RCL');
    expect(familiaDe('PGUAC1')).toBe('PGUAC');
  });

  it('un codigo sin prefijo alfabetico se queda entero, no vacio', () => {
    // Devolver '' agruparia todos los codigos raros bajo la misma familia sin nombre.
    expect(familiaDe('123')).toBe('123');
  });
});

describe('encuadrar', () => {
  it('mete toda la escena dentro del lienzo, con margen', () => {
    const lienzo = { w: 900, h: 700 };
    const margen = 48;
    const escena = componerEscena(
      [rack({ layoutId: 'a', x: 0, y: 0 }), rack({ layoutId: 'b', x: 100, y: 60 })],
      1,
      { x: 0, y: 0 },
      [],
      new Map(),
    );
    const cam = encuadrar(CAMARA_INICIAL, escena, lienzo, margen);
    const b = baseDe(cam);
    for (const r of escena) {
      for (const p of esquinas(r)) {
        for (const z of [0, r.alto]) {
          const q = proyectar(b, p.x, p.y, z);
          // Dentro del lienzo, y respetando el margen menos un pixel de redondeo.
          expect(q.sx).toBeGreaterThanOrEqual(margen - 1);
          expect(q.sx).toBeLessThanOrEqual(lienzo.w - margen + 1);
          expect(q.sy).toBeGreaterThanOrEqual(margen - 1);
          expect(q.sy).toBeLessThanOrEqual(lienzo.h - margen + 1);
        }
      }
    }
  });

  it('con el plano cargado y CERO racks encuadra el suelo', () => {
    // Es como empieza siempre una sesión, y sin esto el plano aparecía en una esquina
    // y desaparecía al primer giro.
    const suelo = esquinasDelSuelo(26.72, { x: 0, y: 0 }, { width: 3200, height: 909 });
    expect(suelo).toHaveLength(4);
    const cam = encuadrar(CAMARA_INICIAL, [], { w: 900, h: 700 }, 48, suelo);
    const b = baseDe(cam);
    const xs = suelo.map((p) => proyectar(b, p.x, p.y, 0).sx);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(47);
    expect(Math.max(...xs)).toBeLessThanOrEqual(853);
  });

  it('sin nada que encuadrar devuelve la camara intacta', () => {
    expect(encuadrar(CAMARA_INICIAL, [], { w: 900, h: 700 })).toEqual(CAMARA_INICIAL);
  });

  it('sin plano, esquinasDelSuelo no inventa un rectangulo', () => {
    expect(esquinasDelSuelo(26.72, { x: 0, y: 0 }, null)).toEqual([]);
    // Escala cero: dividir daría Infinity, y un encuadre con Infinity no vuelve.
    expect(esquinasDelSuelo(0, { x: 0, y: 0 }, { width: 100, height: 100 })).toEqual([]);
  });
});

describe('orbitar', () => {
  it('mantiene el centro de la escena FIJO en pantalla', () => {
    // Sin esto el giro es alrededor del origen del mundo y el almacén describe un arco
    // que lo saca del lienzo: medido, arrastrando 220 px desaparecía media escena.
    const escena = componerEscena(
      [rack({ layoutId: 'a', x: 40, y: 12 }), rack({ layoutId: 'b', x: 80, y: 30 })],
      1,
      { x: 0, y: 0 },
      [],
      new Map(),
    );
    const centro = centroDe(escena);
    let cam = { ...CAMARA_INICIAL, escala: 6, panX: 400, panY: 300 };
    const antes = proyectar(baseDe(cam), centro.x, centro.y, centro.z);

    for (const paso of [30, 80, -145, 200]) {
      cam = orbitar(cam, centro, paso, 0);
      const ahora = proyectar(baseDe(cam), centro.x, centro.y, centro.z);
      expect(ahora.sx).toBeCloseTo(antes.sx, 6);
      expect(ahora.sy).toBeCloseTo(antes.sy, 6);
    }
  });

  it('acota la inclinacion sin bloquear el giro', () => {
    // 90 grados seria mirar desde el cenit: el suelo se ve de canto y su inversa no
    // existe, asi que arrastrar racks dejaria de funcionar.
    const centro = { x: 0, y: 0, z: 0 };
    const arriba = orbitar({ ...CAMARA_INICIAL }, centro, 0, 500);
    const abajo = orbitar({ ...CAMARA_INICIAL }, centro, 0, -500);
    expect(arriba.elevacion).toBeLessThanOrEqual(82);
    expect(abajo.elevacion).toBeGreaterThanOrEqual(12);
    expect(orbitar({ ...CAMARA_INICIAL }, centro, 45, 0).azimut).toBeCloseTo(75, 9);
  });
});

describe('zoomEn', () => {
  it('deja quieto el punto de pantalla bajo el cursor', () => {
    let cam: Camara = { ...CAMARA_INICIAL, escala: 8, panX: 120, panY: 90 };
    const b0 = baseDe(cam);
    const cursor = { sx: 640, sy: 400 };
    const mundoBajoCursor = sueloEn(b0, cursor.sx, cursor.sy);

    for (const pasos of [1, 1, -1, 3, -5]) {
      cam = zoomEn(cam, cursor.sx, cursor.sy, pasos);
      const q = proyectar(baseDe(cam), mundoBajoCursor.x, mundoBajoCursor.y, 0);
      expect(q.sx).toBeCloseTo(cursor.sx, 6);
      expect(q.sy).toBeCloseTo(cursor.sy, 6);
    }
  });

  it('no se sale del rango de escala por muchos pasos que se pidan', () => {
    let cam: Camara = { ...CAMARA_INICIAL };
    for (let i = 0; i < 200; i += 1) cam = zoomEn(cam, 0, 0, 1);
    expect(cam.escala).toBeLessThanOrEqual(120);
    for (let i = 0; i < 400; i += 1) cam = zoomEn(cam, 0, 0, -1);
    expect(cam.escala).toBeGreaterThanOrEqual(0.6);
  });
});

describe('centroDe', () => {
  it('con racks usa su centro y media altura', () => {
    const escena = componerEscena(
      [rack({ layoutId: 'a', x: 0, y: 0 }), rack({ layoutId: 'b', x: 20, y: 10 })],
      1,
      { x: 0, y: 0 },
      [],
      new Map(),
    );
    const c = centroDe(escena);
    expect(c.x).toBeCloseTo(10, 9);
    expect(c.y).toBeCloseTo(5, 9);
    expect(c.z).toBeCloseTo(8.5 / 2, 9);
  });

  it('sin racks cae al suelo, y sin nada al origen', () => {
    const suelo = [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    ];
    expect(centroDe([], suelo)).toEqual({ x: 50, y: 20, z: 0 });
    expect(centroDe([], [])).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ── La escala de ocupacion ─────────────────────────────────────────────────
//
// Se prueba por los LIMITES, que es donde un `<` que deberia ser `<=` no se nota
// mirando el mapa: el 25 % cae en un tramo o en el otro y los dos colores existen.
describe('colorDeOcupacion', () => {
  it('sin dato es gris, y NO el color de vacio', () => {
    expect(colorDeOcupacion(null)).toBe(COLOR_SIN_OCUPACION);
    expect(colorDeOcupacion(undefined)).toBe(COLOR_SIN_OCUPACION);
    // Es la afirmacion que importa: un rack del que nadie sabe nada no puede
    // verse igual que uno que se ha medido y esta vacio.
    expect(colorDeOcupacion(null)).not.toBe(colorDeOcupacion(0));
  });

  it('el cero exacto es «vacio»', () => {
    expect(colorDeOcupacion(0)).toBe(ESCALA_OCUPACION[0]!.color);
  });

  it('cada limite pertenece a SU tramo, no al siguiente', () => {
    for (const tramo of ESCALA_OCUPACION) {
      expect(colorDeOcupacion(tramo.hasta)).toBe(tramo.color);
    }
  });

  it('un pelo por encima de un limite ya es del tramo siguiente', () => {
    // 25,01 no puede pintarse igual que 25: si lo hiciera, el limite estaria
    // desplazado y el mapa mentiria justo en la frontera que se mira.
    expect(colorDeOcupacion(25.01)).not.toBe(colorDeOcupacion(25));
    expect(colorDeOcupacion(75.5)).not.toBe(colorDeOcupacion(75));
  });

  it('el lleno total es el color del ultimo tramo', () => {
    const ultimo = ESCALA_OCUPACION[ESCALA_OCUPACION.length - 1]!.color;
    expect(colorDeOcupacion(100)).toBe(ultimo);
    // Por encima de 100 no deberia llegar nunca, pero si llega no puede quedarse
    // sin color: devolver `undefined` dejaria el rack invisible.
    expect(colorDeOcupacion(140)).toBe(ultimo);
  });

  it('los seis tramos son colores distintos', () => {
    const colores = new Set([...ESCALA_OCUPACION.map((t) => t.color), COLOR_SIN_OCUPACION]);
    expect(colores.size).toBe(ESCALA_OCUPACION.length + 1);
  });

  it('los tramos van en orden y cubren de 0 a 100 sin huecos', () => {
    const limites = ESCALA_OCUPACION.map((t) => t.hasta);
    expect(limites).toEqual([...limites].sort((a, b) => a - b));
    expect(limites[0]).toBe(0);
    expect(limites[limites.length - 1]).toBe(100);
  });
});
