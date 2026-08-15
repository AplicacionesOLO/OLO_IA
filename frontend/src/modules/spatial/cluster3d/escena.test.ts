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
  MINIMO_M,
  alturaEn,
  bandasDeNivel,
  baseDe,
  carasDe,
  celdaEn,
  celdasDeRack,
  centroDe,
  colorDeOcupacion,
  componerEscena,
  dentro,
  divisionesDeCuerpo,
  encuadrar,
  esquinas,
  esquinasDelSuelo,
  familiaDe,
  ladoDeCelda,
  matrizDelSuelo,
  orbitar,
  proyectar,
  redimensionarEnSuelo,
  sueloEn,
  tiradorEn,
  tiradoresDe,
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
  /*
    ── ESTA PRUEBA ESTABA MAL, Y LO ESTABA POR EL MOTIVO QUE LA CABECERA AVISA ──

    Afirmaba «sin giro: el largo va en X y el ancho en Y», que era lo que la escena
    hacia. O sea que comprobaba que la escena coincidiera CONSIGO MISMA, justo lo que
    esta cabecera dice que no vale.

    Con quien tiene que coincidir es con el lienzo 2D, que dibuja
    `fillRect(-w/2, -l/2, w, l)`: el ANCHO en el eje local X y el LARGO en el Y. Se
    midio la discrepancia llamando a las dos: un rack de 12 x 1,2 sin girar se
    extendia 12 m en X en 2D y 1,2 m en X en 3D. Todo rack no cuadrado se veia girado
    90 grados al cambiar de vista.

    Ahora la referencia esta escrita como constante, con la formula del 2D al lado, y
    no como un numero que se ajusta hasta que la prueba pase.
  */
  it('el ancho va en el eje local X, igual que en el lienzo 2D', () => {
    const r = rack({ x: 10, y: 5, rotation: 0 });
    const e = componerEscena([r], 1, { x: 0, y: 0 }, [], new Map());
    const q = esquinas(e[0]!);

    // Lo que dibuja el 2D con este mismo rack y ppm = 1, sin girar:
    //   fillRect(-width/2, -length/2, width, length)
    const extension2dEnX = r.width;
    const extension2dEnY = r.length;

    expect(Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x))).toBeCloseTo(
      extension2dEnX,
      9,
    );
    expect(Math.max(...q.map((p) => p.y)) - Math.min(...q.map((p) => p.y))).toBeCloseTo(
      extension2dEnY,
      9,
    );
  });

  it('girar 90 grados intercambia las medidas, y girar 360 no cambia nada', () => {
    const r = rack();
    const base = componerEscena([rack({ rotation: 0 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    const g90 = componerEscena([rack({ rotation: 90 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    const g360 = componerEscena([rack({ rotation: 360 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    const anchoEnPantalla = (q: { x: number }[]) =>
      Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x));

    // Sin girar, el eje X mide el ancho; girado 90 grados, mide el largo.
    expect(anchoEnPantalla(esquinas(base))).toBeCloseTo(r.width, 9);
    expect(anchoEnPantalla(esquinas(g90))).toBeCloseTo(r.length, 9);
    expect(anchoEnPantalla(esquinas(g360))).toBeCloseTo(r.width, 9);
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

// ── Tiradores de tamaño ─────────────────────────────────────────────────────
//
// La regla de la cabecera vale aqui igual: nada se compara consigo mismo. Los
// tiradores se comprueban contra `proyectar` y contra `esquinas`, y la matematica de
// estirar contra la propiedad que la define —el borde OPUESTO no se mueve—.

describe('tiradoresDe', () => {
  const b = baseDe(CAMARA_INICIAL);
  const escenaDe = (over = {}) =>
    componerEscena([rack(over)], 1, { x: 0, y: 0 }, [], new Map())[0]!;

  it('son cinco: cuatro en el suelo y uno para el alto', () => {
    const ts = tiradoresDe(b, escenaDe());
    expect(ts).toHaveLength(5);
    expect(ts.filter((x) => x.medida === 'ancho')).toHaveLength(2);
    expect(ts.filter((x) => x.medida === 'largo')).toHaveLength(2);
    expect(ts.filter((x) => x.medida === 'alto')).toHaveLength(1);
  });

  it('cada tirador del suelo cae en el CENTRO de su lado, no en una esquina', () => {
    // Es la razon de que estirar en axonometria no sea ambiguo: un punto en el centro
    // de un lado tiene un solo eje posible. Se comprueba contra `esquinas`: el centro
    // de un lado es el promedio de dos esquinas consecutivas.
    const r = escenaDe();
    const q = esquinas(r);
    const centrosDeLado = q.map((p, i) => {
      const s = q[(i + 1) % 4]!;
      return proyectar(b, (p.x + s.x) / 2, (p.y + s.y) / 2, 0);
    });

    for (const tir of tiradoresDe(b, r).filter((x) => x.medida !== 'alto')) {
      const cerca = centrosDeLado.some(
        (c) => Math.abs(c.sx - tir.punto.sx) < 1e-9 && Math.abs(c.sy - tir.punto.sy) < 1e-9,
      );
      expect(cerca).toBe(true);
    }
  });

  it('el tirador del alto esta sobre el centro del TECHO', () => {
    const r = escenaDe();
    const alto = tiradoresDe(b, r).find((x) => x.medida === 'alto')!;
    const esperado = proyectar(b, r.x, r.y, r.alto);
    expect(alto.punto.sx).toBeCloseTo(esperado.sx, 9);
    expect(alto.punto.sy).toBeCloseTo(esperado.sy, 9);
  });

  it('los ejes de los tiradores giran con el rack', () => {
    // Girado 90 grados, el eje del ancho pasa de (1,0) a (0,1). Si no girara, estirar
    // un rack rotado cambiaria la medida equivocada.
    const g90 = tiradoresDe(b, escenaDe({ rotation: 90 }));
    const ancho = g90.find((x) => x.medida === 'ancho' && x.signo === 1)!;
    expect(ancho.eje.x).toBeCloseTo(0, 9);
    expect(ancho.eje.y).toBeCloseTo(1, 9);
  });

  it('los dos tiradores de una medida son opuestos respecto al centro', () => {
    const r = escenaDe({ x: 7, y: -3 });
    const ts = tiradoresDe(b, r);
    for (const medida of ['ancho', 'largo'] as const) {
      const [a, c] = ts.filter((x) => x.medida === medida);
      const centro = proyectar(b, r.x, r.y, 0);
      // El centro del rack es el punto medio de sus dos tiradores.
      expect((a!.punto.sx + c!.punto.sx) / 2).toBeCloseTo(centro.sx, 9);
      expect((a!.punto.sy + c!.punto.sy) / 2).toBeCloseTo(centro.sy, 9);
    }
  });
});

describe('tiradorEn', () => {
  const b = baseDe(CAMARA_INICIAL);
  const r = componerEscena([rack()], 1, { x: 0, y: 0 }, [], new Map())[0]!;
  const ts = tiradoresDe(b, r);

  it('acierta justo encima de un tirador', () => {
    const t0 = ts[0]!;
    expect(tiradorEn(ts, t0.punto.sx, t0.punto.sy)).toBe(t0);
  });

  it('acierta con el puntero un poco desviado, y falla lejos', () => {
    const t0 = ts[0]!;
    expect(tiradorEn(ts, t0.punto.sx + 4, t0.punto.sy - 3)).toBe(t0);
    expect(tiradorEn(ts, t0.punto.sx + 400, t0.punto.sy)).toBeNull();
  });

  it('sin tiradores no acierta nada', () => {
    // Es el caso de varios racks seleccionados o de uno bloqueado: la lista va vacia y
    // el gesto tiene que caer en «mover», no lanzar.
    expect(tiradorEn([], 10, 10)).toBeNull();
  });
});

describe('redimensionarEnSuelo', () => {
  const b = baseDe(CAMARA_INICIAL);
  const r = componerEscena([rack({ x: 10, y: 5 })], 1, { x: 0, y: 0 }, [], new Map())[0]!;
  const ts = tiradoresDe(b, r);
  const delAncho = (signo: 1 | -1) => ts.find((x) => x.medida === 'ancho' && x.signo === signo)!;

  /** El borde opuesto al tirador, en el mundo. Es lo que NO se puede mover. */
  const bordeOpuesto = (tir: { eje: { x: number; y: number }; signo: number }, medida: number) => ({
    x: r.x - tir.eje.x * tir.signo * (medida / 2),
    y: r.y - tir.eje.y * tir.signo * (medida / 2),
  });

  it('el borde OPUESTO no se mueve: es lo que define el gesto', () => {
    const tir = delAncho(1);
    const antes = bordeOpuesto(tir, r.ancho);
    // Se arrastra a 3 m del centro sobre el eje del tirador.
    const res = redimensionarEnSuelo({
      centro: { x: r.x, y: r.y },
      medida0: r.ancho,
      tirador: tir,
      cursor: { x: r.x + tir.eje.x * 3, y: r.y + tir.eje.y * 3 },
      paso: null,
    });
    const despues = {
      x: res.centro.x - tir.eje.x * tir.signo * (res.medida / 2),
      y: res.centro.y - tir.eje.y * tir.signo * (res.medida / 2),
    };
    expect(despues.x).toBeCloseTo(antes.x, 9);
    expect(despues.y).toBeCloseTo(antes.y, 9);
  });

  it('la medida nueva es la distancia del cursor al ancla', () => {
    const tir = delAncho(1);
    const res = redimensionarEnSuelo({
      centro: { x: r.x, y: r.y },
      medida0: r.ancho,
      tirador: tir,
      cursor: { x: r.x + tir.eje.x * 3, y: r.y + tir.eje.y * 3 },
      paso: null,
    });
    // El ancla esta a −ancho/2 del centro y el cursor a +3: la medida es la suma.
    expect(res.medida).toBeCloseTo(3 + r.ancho / 2, 9);
  });

  it('no baja del minimo, y NO voltea el rack al pasarse', () => {
    const tir = delAncho(1);
    // Se arrastra muy por detras del borde opuesto: sin el tope, la medida saldria
    // grande otra vez y el rack quedaria del revés.
    const res = redimensionarEnSuelo({
      centro: { x: r.x, y: r.y },
      medida0: r.ancho,
      tirador: tir,
      cursor: { x: r.x - tir.eje.x * 50, y: r.y - tir.eje.y * 50 },
      paso: null,
    });
    expect(res.medida).toBeCloseTo(MINIMO_M, 9);
  });

  it('con rejilla, la medida cae en un multiplo del paso', () => {
    const tir = delAncho(1);
    const res = redimensionarEnSuelo({
      centro: { x: r.x, y: r.y },
      medida0: 2,
      tirador: tir,
      cursor: { x: r.x + tir.eje.x * 3.37, y: r.y + tir.eje.y * 3.37 },
      paso: 0.5,
    });
    // El BORDE se ajusta a la rejilla; la medida es la distancia al ancla, que esta a
    // −1. Con el borde en 3,5 la medida es 4,5.
    expect(res.medida).toBeCloseTo(4.5, 9);
  });

  it('el tirador opuesto crece en la direccion opuesta', () => {
    // Misma distancia arrastrada, misma medida final: el gesto es simetrico y lo que
    // cambia es hacia donde se desplaza el centro.
    const uno = redimensionarEnSuelo({
      centro: { x: r.x, y: r.y }, medida0: r.ancho, tirador: delAncho(1),
      cursor: { x: r.x + delAncho(1).eje.x * 3, y: r.y + delAncho(1).eje.y * 3 }, paso: null,
    });
    const otro = redimensionarEnSuelo({
      centro: { x: r.x, y: r.y }, medida0: r.ancho, tirador: delAncho(-1),
      cursor: { x: r.x - delAncho(-1).eje.x * 3, y: r.y - delAncho(-1).eje.y * 3 }, paso: null,
    });
    expect(otro.medida).toBeCloseTo(uno.medida, 9);
    // Y los centros quedan a lados contrarios del original.
    expect(Math.sign(uno.centro.x - r.x)).toBe(-Math.sign(otro.centro.x - r.x));
  });
});

describe('alturaEn', () => {
  it('deshace exactamente la proyeccion vertical', () => {
    // Ida y vuelta: se proyecta un punto a una altura conocida y se recupera. Es la
    // misma comprobacion que `sueloEn` hace para el plano del suelo.
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      const centro = { x: 12.5, y: -4.25 };
      for (const alto of [0.05, 1, 8.5, 30]) {
        const p = proyectar(b, centro.x, centro.y, alto);
        expect(alturaEn(b, centro, p.sy)).toBeCloseTo(alto, 6);
      }
    }
  });

  it('arrastrar hacia ARRIBA en pantalla da mas altura', () => {
    // En pantalla la y crece hacia abajo, asi que el signo tiene que estar invertido.
    // Si no lo estuviera, estirar hacia arriba encogeria el rack.
    const b = baseDe(CAMARA_INICIAL);
    const centro = { x: 0, y: 0 };
    const p = proyectar(b, 0, 0, 5);
    expect(alturaEn(b, centro, p.sy - 20)).toBeGreaterThan(5);
    expect(alturaEn(b, centro, p.sy + 20)).toBeLessThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LA ESTRUCTURA VA EN LOS MISMOS EJES QUE LA CAJA
//
// Reportado desde la pantalla: «la cuadricula queda en direccion opuesta a lo que
// simula el cajon del rack». La causa era un intercambio de ejes —las caras ponen el
// ancho en el eje local X y estas lineas ponian el largo—, asi que la malla se
// dibujaba girada 90 grados respecto a la caja. Con un rack de 36 x 1,1 m la malla se
// salia por los dos lados.
//
// Ninguna prueba lo cogia porque la geometria vivia dentro del lienzo.
// ═══════════════════════════════════════════════════════════════════════════════

describe('estructura del rack', () => {
  const largo = 36;
  const ancho = 1.1;
  const alto = 8.5;

  function enEscena(rotacion = 0) {
    const e = componerEscena(
      [rack({ x: 20, y: 15, width: ancho, length: largo, height: alto, rotation: rotacion })],
      1,
      { x: 0, y: 0 },
      [celda({ bayCount: 27, maxLevel: 5, locationCount: 135 })],
      new Map(),
    );
    return e[0]!;
  }

  it('las bandas de nivel caben DENTRO de la silueta de la caja', () => {
    //  Es la comprobacion que cogia el defecto: con los ejes cambiados, una banda medía
    //  el largo sobre el eje del ancho y se salia de la caja por los dos lados.
    for (const cam of CAMARAS) {
      const r = enEscena();
      const b = baseDe(cam);
      const caja = [...carasDe(b, r).silueta];
      const xs = caja.map((p) => p.sx);
      const ys = caja.map((p) => p.sy);
      const holgura = 1e-6;
      for (const s of bandasDeNivel(b, r)) {
        for (const p of [s.a, s.b]) {
          expect(p.sx).toBeGreaterThanOrEqual(Math.min(...xs) - holgura);
          expect(p.sx).toBeLessThanOrEqual(Math.max(...xs) + holgura);
          expect(p.sy).toBeGreaterThanOrEqual(Math.min(...ys) - holgura);
          expect(p.sy).toBeLessThanOrEqual(Math.max(...ys) + holgura);
        }
      }
    }
  });

  it('una banda de nivel mide el LARGO del rack, no el ancho', () => {
    //  Con la camara mirando de frente y sin girar, la banda se proyecta con la misma
    //  extension que el lado largo de la base. Si midiera 1,1 en vez de 36, la
    //  diferencia es de un factor 32: ninguna tolerancia la tapa.
    const cam: Camara = { azimut: 0, elevacion: 30, escala: 10, panX: 0, panY: 0 };
    const r = enEscena();
    const b = baseDe(cam);
    const bandas = bandasDeNivel(b, r);
    expect(bandas).toHaveLength(4); // 5 niveles → 4 separaciones
    const s = bandas[0]!;
    const medida = Math.hypot(s.b.sx - s.a.sx, s.b.sy - s.a.sy);
    expect(medida).toBeGreaterThan(largo * cam.escala * 0.5);
  });

  it('hay una division por cada cuerpo menos uno, y van del suelo al techo', () => {
    const cam: Camara = { azimut: 32, elevacion: 34, escala: 10, panX: 0, panY: 0 };
    const r = enEscena();
    const b = baseDe(cam);
    const divs = divisionesDeCuerpo(b, r);
    expect(divs).toHaveLength(26); // 27 cuerpos
    for (const s of divs) {
      //  El extremo de arriba esta MAS ARRIBA en pantalla: `sy` crece hacia abajo.
      expect(s.b.sy).toBeLessThan(s.a.sy);
    }
  });

  it('las divisiones se reparten a lo largo, no se apilan en un punto', () => {
    //  Con los ejes cambiados se repartian sobre 1,1 m en vez de 36: todas caian
    //  practicamente encima de la misma linea.
    //
    //  Se mide la distancia ENTRE LA PRIMERA Y LA ULTIMA, no la extension en `sx`. Con
    //  azimut 0 el eje del largo se proyecta entero en la vertical de pantalla y `sx` da
    //  cero para cualquier reparto — la primera version de esta prueba fallaba por eso, y
    //  el fallo era de la prueba, no del codigo—.
    for (const cam of CAMARAS) {
      const r = enEscena();
      const b = baseDe(cam);
      const divs = divisionesDeCuerpo(b, r);
      const a = divs[0]!.a;
      const z = divs[divs.length - 1]!.a;
      const separacion = Math.hypot(z.sx - a.sx, z.sy - a.sy);
      //  Lo que se reparte es el largo menos un cuerpo por cada punta, y la proyeccion
      //  acorta segun la elevacion: la mitad del largo es un suelo que solo se pasa si el
      //  reparto es sobre el eje correcto.
      expect(separacion).toBeGreaterThan(largo * cam.escala * 0.4);
    }
  });

  it('un rack sin cuerpos ni niveles no dibuja estructura', () => {
    //  Un rack cuyo codigo el backend no conoce: `cuerpos = 0`. Dibujarle divisiones
    //  seria inventarle una estructura que nadie declaro.
    const e = componerEscena(
      [rack({ width: ancho, length: largo, height: alto })],
      1,
      { x: 0, y: 0 },
      [],
      new Map(),
    );
    const b = baseDe(CAMARA_INICIAL);
    expect(bandasDeNivel(b, e[0]!)).toEqual([]);
    expect(divisionesDeCuerpo(b, e[0]!)).toEqual([]);
  });
});

describe('la cara larga es la larga', () => {
  it('el sombreado marca la cara que recorre el LARGO, no el testero', () => {
    //  Estaba al reves —`i % 2 === 0`— y en un rack de 36 x 1,1 daba la luz de la cara
    //  grande a 1,1 m de testero: el volumen se leia al contrario de lo que es.
    const e = componerEscena(
      [rack({ width: 1.1, length: 36, height: 8.5 })],
      1,
      { x: 0, y: 0 },
      [],
      new Map(),
    );
    const b = baseDe({ azimut: 32, elevacion: 34, escala: 10, panX: 0, panY: 0 });
    const cs = carasDe(b, e[0]!);
    for (const cara of cs.laterales) {
      //  La arista inferior de la cara, en pantalla.
      const medida = Math.hypot(
        cara.puntos[1]!.sx - cara.puntos[0]!.sx,
        cara.puntos[1]!.sy - cara.puntos[0]!.sy,
      );
      const otras = cs.laterales
        .filter((x) => x !== cara)
        .map((x) =>
          Math.hypot(x.puntos[1]!.sx - x.puntos[0]!.sx, x.puntos[1]!.sy - x.puntos[0]!.sy),
        );
      if (cara.larga) expect(medida).toBeGreaterThan(Math.min(...otras, medida));
      else expect(medida).toBeLessThan(Math.max(...otras, medida));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAS CELDAS DEL RACK
//
// Es lo que permite pintar cada slot por lo que la cámara vio. Se prueba la geometría
// —cuántas hay, dónde caen, que no se salgan de la caja— porque un error aquí pinta el
// estado de un hueco encima de otro, y eso es peor que no pintar nada.
// ═══════════════════════════════════════════════════════════════════════════════

describe('celdas del rack', () => {
  function rackReal() {
    //  RCL47 medido: 21 cuerpos, 7 niveles, 2 posiciones por cuerpo.
    return componerEscena(
      [rack({ x: 10, y: 10, width: 1.1, length: 56.7, height: 11.9 })],
      1,
      { x: 0, y: 0 },
      [celda({ bayCount: 21, maxLevel: 7, locationCount: 273 })],
      new Map(),
    )[0]!;
  }

  it('hay una por cuerpo, nivel y posicion', () => {
    const b = baseDe(CAMARA_INICIAL);
    expect(celdasDeRack(b, rackReal(), 2)).toHaveLength(21 * 7 * 2);
  });

  it('todas caben dentro de la silueta de la caja', () => {
    //  Si una celda se sale, el color de un hueco se pinta sobre el rack de al lado.
    for (const cam of CAMARAS) {
      const r = rackReal();
      const b = baseDe(cam);
      const caja = carasDe(b, r).silueta;
      const xs = caja.map((p) => p.sx);
      const ys = caja.map((p) => p.sy);
      for (const c of celdasDeRack(b, r, 2)) {
        for (const p of c.puntos) {
          expect(p.sx).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
          expect(p.sx).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
          expect(p.sy).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-6);
          expect(p.sy).toBeLessThanOrEqual(Math.max(...ys) + 1e-6);
        }
      }
    }
  });

  it('el nivel 1 va abajo, como en el almacen', () => {
    const b = baseDe({ azimut: 30, elevacion: 34, escala: 10, panX: 0, panY: 0 });
    const celdas = celdasDeRack(b, rackReal(), 2);
    const n1 = celdas.find((c) => c.cuerpo === 0 && c.nivel === 1 && c.posicion === 1)!;
    const n7 = celdas.find((c) => c.cuerpo === 0 && c.nivel === 7 && c.posicion === 1)!;
    //  `sy` crece hacia abajo en pantalla.
    expect(n1.puntos[0]!.sy).toBeGreaterThan(n7.puntos[0]!.sy);
  });

  it('las dos posiciones de un cuerpo son contiguas y no se solapan', () => {
    const b = baseDe({ azimut: 0, elevacion: 30, escala: 10, panX: 0, panY: 0 });
    const celdas = celdasDeRack(b, rackReal(), 2);
    const p1 = celdas.find((c) => c.cuerpo === 3 && c.nivel === 2 && c.posicion === 1)!;
    const p2 = celdas.find((c) => c.cuerpo === 3 && c.nivel === 2 && c.posicion === 2)!;
    //  El borde derecho de la primera es el izquierdo de la segunda.
    expect(p1.puntos[1]!.sx).toBeCloseTo(p2.puntos[0]!.sx, 6);
    expect(p1.puntos[1]!.sy).toBeCloseTo(p2.puntos[0]!.sy, 6);
  });

  it('un rack sin estructura no tiene celdas que pintar', () => {
    //  Codigo que el catalogo no conoce: `cuerpos = 0`. Inventarle una rejilla seria
    //  afirmar una estructura que nadie declaro.
    const e = componerEscena([rack()], 1, { x: 0, y: 0 }, [], new Map())[0]!;
    expect(celdasDeRack(baseDe(CAMARA_INICIAL), e, 2)).toEqual([]);
  });

  it('el lado en pantalla crece con el zoom', () => {
    const r = rackReal();
    expect(ladoDeCelda(r, 20, 2)).toBeCloseTo(ladoDeCelda(r, 10, 2) * 2, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOCAR UN HUECO
//
// Se prueba lo que puede salir mal de verdad: que la celda tocada NO sea la que está
// debajo del cursor. Por eso las pruebas van del píxel al hueco y no al revés —proyectar
// el centro de una celda y comprobar que el picking devuelve ESA celda es el único bucle
// cerrado que detecta un desfase de un cuerpo o una cara equivocada—.
// ═══════════════════════════════════════════════════════════════════════════════

describe('celdaEn: del pixel al hueco', () => {
  function rackDePrueba() {
    //  Cuatro cuerpos, cinco niveles, dos posiciones: 40 celdas, pocas para recorrerlas
    //  todas en cada camara sin que la prueba tarde.
    return componerEscena(
      [rack({ x: 5, y: 5, width: 1.1, length: 8, height: 7 })],
      1,
      { x: 0, y: 0 },
      [celda({ bayCount: 4, maxLevel: 5, locationCount: 40 })],
      new Map(),
    )[0]!;
  }
  const dos = () => 2;
  const centro = (c: { puntos: { sx: number; sy: number }[] }) => ({
    sx: c.puntos.reduce((a, p) => a + p.sx, 0) / c.puntos.length,
    sy: c.puntos.reduce((a, p) => a + p.sy, 0) / c.puntos.length,
  });
  /** Superficie en pixeles cuadrados. Una celda de canto mide cero y no se puede tocar. */
  const area = (c: { puntos: { sx: number; sy: number }[] }) => {
    let s = 0;
    for (let i = 0, j = c.puntos.length - 1; i < c.puntos.length; j = i, i += 1) {
      s += (c.puntos[j]!.sx + c.puntos[i]!.sx) * (c.puntos[j]!.sy - c.puntos[i]!.sy);
    }
    return Math.abs(s) / 2;
  };

  it('cada celda se recupera desde su propio centro, en cualquier camara', () => {
    let comprobadas = 0;
    let degeneradas = 0;
    for (const cam of CAMARAS) {
      const b = baseDe(cam);
      const r = rackDePrueba();
      const celdas = celdasDeRack(b, r, 2);
      expect(celdas).toHaveLength(4 * 5 * 2);
      for (const c of celdas) {
        //  Mirando el rack de canto, la cara cercana se proyecta como una LINEA: sus
        //  celdas no tienen superficie y no hay nada que pinchar. Se exige el ida y vuelta
        //  donde la celda se ve, que es donde el usuario puede tocarla.
        if (area(c) < 1) { degeneradas += 1; continue; }
        const p = centro(c);
        const hit = celdaEn(b, [r], p.sx, p.sy, dos);
        comprobadas += 1;
        //  La identidad COMPLETA: un desfase de un cuerpo, o el nivel invertido, la rompe.
        expect([hit?.celda?.cuerpo, hit?.celda?.nivel, hit?.celda?.posicion])
          .toEqual([c.cuerpo, c.nivel, c.posicion]);
      }
    }
    //  Que la prueba no se vacie sola: si un cambio dejara todas las celdas degeneradas,
    //  el bucle pasaria sin comprobar nada y esto lo caza.
    expect(comprobadas).toBeGreaterThan(100);
    expect(comprobadas + degeneradas).toBe(CAMARAS.length * 4 * 5 * 2);
  });

  it('fuera de todo rack no devuelve nada', () => {
    const b = baseDe(CAMARA_INICIAL);
    expect(celdaEn(b, [rackDePrueba()], -9e5, -9e5, dos)).toBeNull();
  });

  it('se toca el rack de delante, no el de atras', () => {
    //  Es la garantia que `rackEn` ya da; se comprueba aqui porque `celdaEn` podria
    //  haberla perdido al bajar un nivel.
    const b = baseDe({ azimut: 30, elevacion: 34, escala: 10, panX: 0, panY: 0 });
    const delante = rackDePrueba();
    const detras = { ...delante, layoutId: 'l2', y: delante.y + 40 };
    const p = centro(celdasDeRack(b, delante, 2)[0]!);
    expect(celdaEn(b, [detras, delante], p.sx, p.sy, dos)?.rack.layoutId).toBe('l1');
  });

  it('un rack sin estructura se toca sin celda en vez de romperse', () => {
    const b = baseDe(CAMARA_INICIAL);
    const plano = componerEscena(
      [rack({ x: 5, y: 5 })], 1, { x: 0, y: 0 }, [], new Map(),
    )[0]!;
    //  Se apunta al centro de su silueta: ahi seguro que hay rack y seguro que no hay
    //  celda, porque sin catalogo no tiene ni cuerpos ni niveles.
    const s = carasDe(b, plano).silueta;
    const p = {
      sx: s.reduce((a, q) => a + q.sx, 0) / s.length,
      sy: s.reduce((a, q) => a + q.sy, 0) / s.length,
    };
    const hit = celdaEn(b, [plano], p.sx, p.sy, dos);
    expect(hit?.rack.layoutId).toBe('l1');
    expect(hit?.celda).toBeNull();
  });
});
