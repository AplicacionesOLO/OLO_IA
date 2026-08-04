/**
 * PRUEBAS DE LA FRONTERA PIXEL ↔ METRO.
 *
 * Es el sitio del frontend donde un error tiene la peor consecuencia: escribe
 * coordenadas equivocadas en la base, y desde entonces el almacen «esta» donde no
 * esta. El backend las validaria en forma —rangos, formato— pero no puede saber que
 * 12,5 deberia haber sido 1,25.
 *
 * Lo que se prueba aqui es el viaje de ida y vuelta y los casos que NO deben viajar.
 */

import { describe, expect, it } from 'vitest';

import type { LayoutDraft, PositionedRack } from '../editor/types';
import { DEFAULT_EDITOR_LAYERS } from '../editor/types';
import type { PublishedLayoutDto } from './dto';
import { aLayoutPublicado, prepararPublicacion, publicadoABorrador } from './publicacion';

const PPM = 26.72;

function rack(over: Partial<PositionedRack> = {}): PositionedRack {
  return {
    layoutId: 'l1',
    rackCode: 'MZ04',
    x: 400,
    y: 200,
    width: 1.1,
    length: 12,
    height: 8.5,
    rotation: 0,
    locked: false,
    linked: true,
    ...over,
  };
}

function borrador(racks: PositionedRack[], over: Partial<LayoutDraft> = {}): LayoutDraft {
  return {
    version: 1,
    warehouseId: 'wh1',
    updatedAt: new Date(0).toISOString(),
    plan: { name: 'mz.png', type: 'image/png', width: 3200, height: 909, bytes: 246_000, dataUrl: null },
    planPersistence: { metadataStored: true, imageStored: false, imageStorage: 'not-stored', storageError: null },
    calibration: { pixelsPerMeter: PPM, points: null, measured: true },
    reference: { origin: { x: 100, y: 50 }, rotation: 0, unit: 'meters' },
    racks,
    layers: DEFAULT_EDITOR_LAYERS,
    visualMode: 'technical',
    viewDimension: '2d',
    ...over,
  };
}

const MAPA = new Map([['MZ04', 'uuid-mz04'], ['MZ05', 'uuid-mz05']]);

describe('prepararPublicacion', () => {
  it('convierte pixeles a metros restando el origen', () => {
    const { cuerpo } = prepararPublicacion(borrador([rack()]), MAPA);
    expect(cuerpo.placements).toHaveLength(1);
    expect(cuerpo.placements[0]!.x_m).toBeCloseTo((400 - 100) / PPM, 9);
    expect(cuerpo.placements[0]!.y_m).toBeCloseTo((200 - 50) / PPM, 9);
  });

  it('traduce el CODIGO del rack a su uuid', () => {
    // El borrador guarda codigos porque son lo que el operador lee; la base referencia
    // por uuid porque el codigo es unico por almacen, no globalmente.
    const { cuerpo } = prepararPublicacion(borrador([rack()]), MAPA);
    expect(cuerpo.placements[0]!.rack_node_id).toBe('uuid-mz04');
  });

  it('un codigo que el almacen no conoce se EXCLUYE con motivo, no se publica', () => {
    // La clave foranea lo rechazaria y tumbaria la publicacion entera: 346 racks bien
    // colocados perdidos por uno que sobra.
    const r = prepararPublicacion(borrador([rack(), rack({ layoutId: 'l2', rackCode: 'FANTASMA' })]), MAPA);
    expect(r.cuerpo.placements).toHaveLength(1);
    expect(r.excluidos).toHaveLength(1);
    expect(r.excluidos[0]!.rackCode).toBe('FANTASMA');
    expect(r.excluidos[0]!.motivo).toMatch(/no tiene ningun rack con ese codigo/);
  });

  it('el MISMO rack colocado dos veces se excluye la segunda', () => {
    // Un rack esta en UN sitio: dos colocaciones son dos sitios y el visor 3D no
    // sabria cual dibujar. La base lo rechazaria por unicidad.
    const r = prepararPublicacion(
      borrador([rack({ layoutId: 'a' }), rack({ layoutId: 'b', x: 900 })]),
      MAPA,
    );
    expect(r.cuerpo.placements).toHaveLength(1);
    expect(r.excluidos[0]!.motivo).toMatch(/dos veces/);
  });

  it('normaliza el giro a [0,360): la base rechaza 360 y los negativos', () => {
    const casos: [number, number][] = [
      [0, 0],
      [37.5, 37.5],
      [360, 0],
      [-90, 270],
      [720, 0],
      [-450, 270],
    ];
    for (const [entra, sale] of casos) {
      const { cuerpo } = prepararPublicacion(borrador([rack({ rotation: entra })]), MAPA);
      expect(cuerpo.placements[0]!.rotation_deg).toBeCloseTo(sale, 9);
    }
  });

  it('un color que no es #rrggbb viaja como null, no como texto invalido', () => {
    // La base valida el formato; mandar 'rojo' o '#22d9f5aa' tumbaria la publicacion.
    for (const malo of ['rojo', '#ff00', '#22d9f5aa', '']) {
      const { cuerpo } = prepararPublicacion(borrador([rack({ color: malo })]), MAPA);
      expect(cuerpo.placements[0]!.color).toBeNull();
    }
    const { cuerpo } = prepararPublicacion(borrador([rack({ color: '#F59E0B' })]), MAPA);
    expect(cuerpo.placements[0]!.color).toBe('#f59e0b');
  });

  it('una medida imposible se excluye ANTES de llegar a la base', () => {
    const casos: [Partial<PositionedRack>, RegExp][] = [
      [{ width: 0 }, /ancho/],
      [{ width: 500 }, /ancho/],
      [{ length: 0.001 }, /largo/],
      [{ height: 61 }, /alto/],
    ];
    for (const [over, motivo] of casos) {
      const r = prepararPublicacion(borrador([rack(over)]), MAPA);
      expect(r.cuerpo.placements).toHaveLength(0);
      expect(r.excluidos[0]!.motivo).toMatch(motivo);
    }
  });

  it('una coordenada absurda se excluye diciendo a cuantos metros esta', () => {
    // Es el sintoma de haber colado pixeles como metros: la base lo acota a ±10.000
    // justo para atrapar ese error.
    const r = prepararPublicacion(borrador([rack({ x: 40_000_000 })]), MAPA);
    expect(r.cuerpo.placements).toHaveLength(0);
    expect(r.excluidos[0]!.motivo).toMatch(/del origen/);
  });

  it('con escala CERO no publica NaN', () => {
    // Dividir por cero da Infinity, y `JSON.stringify(Infinity)` es `null`: se colaria
    // una fila sin coordenadas en lugar de un error.
    const b = borrador([rack()], { calibration: { pixelsPerMeter: 0, points: null, measured: true } });
    const r = prepararPublicacion(b, MAPA);
    expect(r.cuerpo.placements).toHaveLength(0);
    expect(r.excluidos[0]!.motivo).toMatch(/no es un numero/);
  });

  it('declara si la escala se MIDIO', () => {
    expect(prepararPublicacion(borrador([rack()]), MAPA).calibrado).toBe(true);
    const sinMedir = borrador([rack()], {
      calibration: { pixelsPerMeter: 50, points: null, measured: false },
    });
    expect(prepararPublicacion(sinMedir, MAPA).calibrado).toBe(false);
  });

  it('un borrador viejo sin `measured` se lee por sus puntos', () => {
    // Compatibilidad: los borradores guardados antes de que existiera el campo.
    const conPuntos = borrador([rack()], {
      calibration: {
        pixelsPerMeter: PPM,
        points: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, realDistance: 3.74, unit: 'meters' },
      },
    });
    expect(prepararPublicacion(conPuntos, MAPA).calibrado).toBe(true);
    const sinNada = borrador([rack()], { calibration: { pixelsPerMeter: 50, points: null } });
    expect(prepararPublicacion(sinNada, MAPA).calibrado).toBe(false);
  });
});

describe('el viaje de ida y vuelta', () => {
  it('publicar y volver a abrir devuelve la MISMA posicion en pixeles', () => {
    // Es la propiedad que hace correcto guardar en metros: la conversion es exacta en
    // los dos sentidos porque es multiplicar por la escala publicada.
    const original = rack({ x: 1234.5, y: 678.25, rotation: 37.5 });
    const b = borrador([original]);
    const { cuerpo } = prepararPublicacion(b, MAPA);

    const dto: PublishedLayoutDto = {
      layout: {
        id: 'lay1',
        warehouse_id: 'wh1',
        plan_name: cuerpo.plan_name,
        plan_width_px: cuerpo.plan_width_px,
        plan_height_px: cuerpo.plan_height_px,
        pixels_per_meter: cuerpo.pixels_per_meter,
        origin_x_px: cuerpo.origin_x_px,
        origin_y_px: cuerpo.origin_y_px,
        is_calibrated: cuerpo.is_calibrated,
        published_at: new Date(0).toISOString(),
        published_by: null,
        updated_at: new Date(0).toISOString(),
      },
      placements: cuerpo.placements.map((p, i) => ({
        ...p,
        id: `p${i}`,
        rack_code: 'MZ04',
        node_type: 'rack',
        node_function: null,
        updated_at: new Date(0).toISOString(),
      })),
      published: cuerpo.placements.length,
      calibrated: true,
      derived_locations: 180,
    };

    const vuelta = publicadoABorrador(dto, 'wh1', b)!;
    expect(vuelta.racks[0]!.x).toBeCloseTo(original.x, 6);
    expect(vuelta.racks[0]!.y).toBeCloseTo(original.y, 6);
    expect(vuelta.racks[0]!.rotation).toBeCloseTo(original.rotation, 9);
    expect(vuelta.racks[0]!.width).toBeCloseTo(original.width, 9);
  });

  it('al abrir lo publicado, la escala consta como MEDIDA aunque no vengan los puntos', () => {
    // El backend guarda la escala, no el procedimiento. Sin este campo, abrir en otro
    // navegador un layout calibrado avisaria de un problema que no existe.
    const dto = aLayoutPublicado({
      layout: {
        id: 'l', warehouse_id: 'w', plan_name: 'p.png', plan_width_px: 3200, plan_height_px: 909,
        pixels_per_meter: PPM, origin_x_px: 0, origin_y_px: 0, is_calibrated: true,
        published_at: new Date(0).toISOString(), published_by: null, updated_at: new Date(0).toISOString(),
      },
      placements: [],
      published: null, calibrated: null, derived_locations: null,
    });
    expect(dto.calibrado).toBe(true);
    expect(dto.publicado).toBe(true);
  });

  it('sin layout publicado devuelve el hueco vacio, no un error', () => {
    const vacio = aLayoutPublicado({
      layout: null, placements: [], published: null, calibrated: null, derived_locations: null,
    });
    expect(vacio.publicado).toBe(false);
    expect(vacio.racks).toEqual([]);
    expect(vacio.ppm).toBe(0);
  });

  it('la IMAGEN del borrador local se conserva al abrir lo publicado', () => {
    // El backend guarda el nombre del archivo, no sus bytes. Si este operador ya tenia
    // la imagen cargada, no debe perderla por abrir el layout del equipo.
    const conImagen = borrador([rack()], {
      plan: { name: 'mz.png', type: 'image/png', width: 3200, height: 909, bytes: 1, dataUrl: 'data:x' },
    });
    const vuelta = publicadoABorrador(
      {
        layout: {
          id: 'l', warehouse_id: 'w', plan_name: 'mz.png', plan_width_px: 3200, plan_height_px: 909,
          pixels_per_meter: PPM, origin_x_px: 0, origin_y_px: 0, is_calibrated: true,
          published_at: new Date(0).toISOString(), published_by: null, updated_at: new Date(0).toISOString(),
        },
        placements: [],
        published: null, calibrated: null, derived_locations: null,
      },
      'wh1',
      conImagen,
    )!;
    expect(vuelta.plan?.dataUrl).toBe('data:x');
  });
});
