/**
 * PRUEBAS DE LA RUTA Y SU REPRODUCCION TEMPORAL.
 *
 * La reproduccion me costo dos intentos fallidos, los dos por la misma clase de error
 * —un valor que cambia por fotograma en las dependencias de un efecto— y los dos
 * detectados midiendo en el navegador. Lo que SI se puede probar aqui es la
 * aritmetica del tiempo: `interpolar` y `ventanaDe` son funciones puras, y son las que
 * deciden donde se dibuja el marcador.
 *
 * Lo que se afirma en cada prueba es algo que se puede calcular a mano: si el
 * marcador esta a mitad de camino entre dos avistamientos separados 12 s, a los 6 s
 * tiene que estar en el punto medio EXACTO.
 */

import { describe, expect, it } from 'vitest';

import type { RouteDto, RoutePointDto } from '../repositories/dto';
import { interpolar, PALETA_RUTAS, prepararRutas, racksVistos, ventanaDe } from './ruta';

const T0 = Date.parse('2026-08-04T09:00:00.000Z');

function punto(n: number, x: number, y: number, over: Partial<RoutePointDto> = {}): RoutePointDto {
  return {
    observation_id: `o${n}`,
    source_id: 's1',
    source_code: 'DRONE-01',
    source_name: 'Dron 01',
    source_kind: 'drone',
    rack_node_id: `r${n}`,
    rack_code: `MZ${String(n).padStart(2, '0')}`,
    observed_at: new Date(T0 + n * 12_000).toISOString(),
    confidence: 0.9,
    frame_ref: null,
    frame_ms: null,
    x_m: x,
    y_m: y,
    rotation_deg: 0,
    paso: n + 1,
    ...over,
  };
}

function ruta(puntos: RoutePointDto[], over: Partial<RouteDto> = {}): RouteDto {
  return {
    source_id: 's1',
    source_code: 'DRONE-01',
    source_name: 'Dron 01',
    source_kind: 'drone',
    forms_path: true,
    points: puntos,
    point_count: puntos.length,
    distinct_racks: new Set(puntos.map((p) => p.rack_node_id)).size,
    straight_line_distance_m: 0,
    duration_s: null,
    avg_speed_ms: null,
    first_seen: puntos[0]?.observed_at ?? null,
    last_seen: puntos[puntos.length - 1]?.observed_at ?? null,
    ...over,
  };
}

describe('prepararRutas', () => {
  it('el color depende del CODIGO de la fuente, no del orden de llegada', () => {
    // Si dependiera del orden, la misma ruta saldria de un color distinto en cada
    // recarga y el color dejaria de ser informacion.
    const a = ruta([punto(0, 0, 0)], { source_id: 'A', source_code: 'AAA' });
    const b = ruta([punto(1, 10, 0)], { source_id: 'B', source_code: 'BBB' });
    const orden1 = prepararRutas([a, b]);
    const orden2 = prepararRutas([b, a]);
    const color = (rs: ReturnType<typeof prepararRutas>, codigo: string) =>
      rs.find((r) => r.ruta.source_code === codigo)!.color;
    expect(color(orden1, 'AAA')).toBe(color(orden2, 'AAA'));
    expect(color(orden1, 'BBB')).toBe(color(orden2, 'BBB'));
    expect(color(orden1, 'AAA')).not.toBe(color(orden1, 'BBB'));
  });

  it('calcula los instantes una sola vez, en milisegundos', () => {
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 10, 0)])]);
    expect(r!.pasos[0]!.ms).toBe(T0);
    expect(r!.desdeMs).toBe(T0);
    expect(r!.hastaMs).toBe(T0 + 12_000);
  });

  it('una ruta sin puntos no rompe la ventana', () => {
    const [r] = prepararRutas([ruta([])]);
    expect(r!.pasos).toHaveLength(0);
    expect(ventanaDe([r!])).toBeNull();
  });

  it('los colores de ruta NO son los de los racks', () => {
    // Una linea del mismo cian que un rack desaparece justo sobre lo que atraviesa.
    expect(PALETA_RUTAS).not.toContain('#22d9f5');
  });
});

describe('ventanaDe', () => {
  it('abarca la union de todas las fuentes', () => {
    const a = ruta([punto(0, 0, 0), punto(1, 10, 0)], { source_id: 'A', source_code: 'A' });
    const b = ruta([punto(5, 0, 0), punto(9, 10, 0)], { source_id: 'B', source_code: 'B' });
    const v = ventanaDe(prepararRutas([a, b]))!;
    expect(v.desde).toBe(T0);
    expect(v.hasta).toBe(T0 + 9 * 12_000);
  });

  it('sin rutas devuelve null, para que el reproductor diga que no hay nada', () => {
    expect(ventanaDe([])).toBeNull();
  });
});

describe('interpolar', () => {
  it('en el instante de un avistamiento devuelve su punto EXACTO', () => {
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 12, 0)])]);
    const p = interpolar(r!, T0)!;
    expect(p.x).toBe(0);
    expect(p.ultimo.rack_code).toBe('MZ00');
  });

  it('a mitad de camino esta en el punto medio exacto', () => {
    // Es la suposicion mas simple que respeta los datos: movimiento recto entre dos
    // avistamientos. Cualquier curva suave afirmaria un giro que nadie observo.
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 12, 6)])]);
    const p = interpolar(r!, T0 + 6_000)!;
    expect(p.x).toBeCloseTo(6, 9);
    expect(p.y).toBeCloseTo(3, 9);
    expect(p.avance).toBeCloseTo(0.5, 9);
  });

  it('FUERA de la ventana devuelve null, no el punto mas cercano', () => {
    // Dejar el marcador clavado en el primer rack durante la hora anterior al vuelo
    // afirmaria que la fuente estuvo ahi esperando.
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 12, 0)])]);
    expect(interpolar(r!, T0 - 1)).toBeNull();
    expect(interpolar(r!, T0 + 12_001)).toBeNull();
  });

  it('en el ultimo instante se queda en el ultimo punto, con avance 1', () => {
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 12, 0)])]);
    const p = interpolar(r!, T0 + 12_000)!;
    expect(p.x).toBe(12);
    expect(p.avance).toBe(1);
  });

  it('dos avistamientos en el MISMO instante no dividen por cero', () => {
    // Hacen falta TRES puntos para llegar a la division: con solo dos empatados, la
    // busqueda binaria se queda en el ultimo y no hay tramo siguiente que interpolar.
    // Mi primera version de esta prueba usaba dos y afirmaba `avance: 0`; el codigo
    // devuelve 1, y tenia razon el codigo.
    const p0 = punto(0, 0, 0);
    const p1 = { ...punto(1, 40, 0), observed_at: p0.observed_at };
    const p2 = punto(2, 80, 0);
    const [r] = prepararRutas([ruta([p0, p1, p2])]);

    const empate = interpolar(r!, T0)!;
    expect(Number.isFinite(empate.x)).toBe(true);
    expect(Number.isFinite(empate.avance)).toBe(true);
    // Se queda en uno de los dos empatados, sin inventar una posicion intermedia.
    expect([0, 40]).toContain(empate.x);

    // Y el tramo siguiente, que si tiene duracion, interpola con normalidad.
    const despues = interpolar(r!, T0 + 18_000)!;
    expect(Number.isFinite(despues.x)).toBe(true);
  });

  it('con dos avistamientos empatados y nada mas, se queda en el ultimo', () => {
    const p0 = punto(0, 0, 0);
    const p1 = { ...punto(1, 40, 0), observed_at: p0.observed_at };
    const [r] = prepararRutas([ruta([p0, p1])]);
    const p = interpolar(r!, T0)!;
    expect(p.x).toBe(40);
    expect(p.avance).toBe(1);
  });

  it('encuentra el tramo correcto con muchos puntos', () => {
    // La busqueda es binaria: con 5.000 vertices y un deslizador que se arrastra, un
    // recorrido lineal por fotograma serian 300.000 comparaciones por segundo.
    const puntos = Array.from({ length: 500 }, (_, i) => punto(i, i * 2, 0));
    const [r] = prepararRutas([ruta(puntos)]);
    for (const i of [0, 1, 137, 498, 499]) {
      const p = interpolar(r!, T0 + i * 12_000)!;
      expect(p.ultimo.rack_node_id).toBe(`r${i}`);
      expect(p.x).toBeCloseTo(i * 2, 9);
    }
    // Y a mitad de un tramo cualquiera.
    const medio = interpolar(r!, T0 + 137 * 12_000 + 6_000)!;
    expect(medio.x).toBeCloseTo(137 * 2 + 1, 9);
  });

  it('una ruta vacia no tiene posicion', () => {
    const [r] = prepararRutas([ruta([])]);
    expect(interpolar(r!, T0)).toBeNull();
  });
});

describe('racksVistos', () => {
  it('acumula solo lo visto HASTA el instante', () => {
    // Es la mitad del valor de la reproduccion: no solo por donde fue, sino que ha
    // quedado sin mirar.
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 12, 0), punto(2, 24, 0)])]);
    expect(racksVistos([r!], T0).size).toBe(1);
    expect(racksVistos([r!], T0 + 12_000).size).toBe(2);
    expect(racksVistos([r!], T0 + 24_000).size).toBe(3);
  });

  it('con instante nulo cuenta todo el recorrido', () => {
    const [r] = prepararRutas([ruta([punto(0, 0, 0), punto(1, 12, 0)])]);
    expect(racksVistos([r!], null).size).toBe(2);
  });

  it('no cuenta dos veces el mismo rack visto dos veces', () => {
    // «Se vieron 3 racks» y «hay 7 observaciones» son cosas distintas, y confundirlas
    // diria que se ha cubierto el doble de almacen del que se cubrio.
    const a = punto(0, 0, 0);
    const b = { ...punto(1, 12, 0), rack_node_id: a.rack_node_id };
    const [r] = prepararRutas([ruta([a, b])]);
    expect(racksVistos([r!], null).size).toBe(1);
  });
});
