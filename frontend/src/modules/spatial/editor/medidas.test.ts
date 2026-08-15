/**
 * Las medidas de un rack salen de su estructura, no de una constante para todos.
 *
 * ── EL CASO QUE ORIGINÓ ESTO ────────────────────────────────────────────────────────
 *
 * Reportado desde la pantalla: en 2D los racks se veían bien y en 3D quedaba «una cruz».
 * Era `MZ01`, con 27 cuerpos, dibujado con el largo fijo de 12 m que se le daba a
 * cualquiera: 12 m de largo, 1,1 de fondo y 8,5 de alto es geométricamente una lámina
 * vertical, y eso es lo que se veía.
 */

import { describe, expect, it } from 'vitest';

import { medidasDe, medidasPara, posicionesPorCuerpo } from './medidas';
import type { FloorPlanCell, WarehouseMetrics } from '../types/index';

function celda(parcial: Partial<FloorPlanCell>): FloorPlanCell {
  return {
    rackId: 'r1',
    rackCode: 'MZ01',
    rackExternalCode: null,
    rackIndex: null,
    nodeType: 'rack',
    nodeFunction: null,
    functionLabel: null,
    aisleId: null,
    aisleCode: null,
    bayCount: 0,
    locationCount: 0,
    availableCount: 0,
    blockedCount: 0,
    inferredCount: 0,
    bulkCount: 0,
    wmsSituationCounts: {},
    statusSituationConflicts: 0,
    minLogicalX: null,
    maxLogicalX: null,
    minLogicalY: null,
    maxLogicalY: null,
    maxLevel: null,
    ...parcial,
  } as FloorPlanCell;
}

describe('posicionesPorCuerpo', () => {
  it('sale del catálogo real de MZ01: una posición por cuerpo', () => {
    //  135 ubicaciones / (27 cuerpos x 5 niveles) = 1 exacto.
    expect(posicionesPorCuerpo(celda({ bayCount: 27, maxLevel: 5, locationCount: 135 }))).toBe(1);
  });

  it('y del de RCL47: dos', () => {
    //  273 / (21 x 7) = 1,857 → 2, que es lo que ese rack tiene.
    expect(posicionesPorCuerpo(celda({ bayCount: 21, maxLevel: 7, locationCount: 273 }))).toBe(2);
  });

  it('un rack a medio importar no produce un fondo absurdo', () => {
    //  Niveles a cero daría una división por cero; ubicaciones sin cuerpos, un cociente
    //  enorme. Las dos cosas pasan con datos importados a medias.
    expect(posicionesPorCuerpo(celda({ bayCount: 10, maxLevel: 0, locationCount: 500 }))).toBe(1);
    expect(posicionesPorCuerpo(celda({ bayCount: 0, maxLevel: 5, locationCount: 500 }))).toBe(1);
    expect(posicionesPorCuerpo(celda({ bayCount: 1, maxLevel: 1, locationCount: 900 }))).toBe(6);
  });
});

describe('medidasDe', () => {
  it('MZ01 mide 36 m de largo, no 12', () => {
    const m = medidasDe(celda({ bayCount: 27, maxLevel: 5, locationCount: 135 }));
    //  27 cuerpos x 1 posición x 1,35 m
    expect(m.length).toBeCloseTo(36.45, 2);
    expect(m.width).toBeCloseTo(1.1, 2);
    //  5 niveles x 1,7 m — el mismo alto que el fijo de antes, que es lo que valida el 1,7.
    expect(m.height).toBeCloseTo(8.5, 2);
  });

  it('un rack con más cuerpos sale más largo, y con más niveles más alto', () => {
    const pequeno = medidasDe(celda({ bayCount: 5, maxLevel: 3, locationCount: 15 }));
    const grande = medidasDe(celda({ bayCount: 36, maxLevel: 7, locationCount: 252 }));
    expect(grande.length).toBeGreaterThan(pequeno.length * 5);
    expect(grande.height).toBeGreaterThan(pequeno.height);
  });

  it('sin catálogo se cae a las medidas de antes, no a cero', () => {
    //  Un rack de lado cero no se puede agarrar con el ratón y desaparece en 3D sin decir
    //  por qué. Es peor que una medida convencional.
    expect(medidasDe(undefined)).toEqual({ width: 1.1, length: 12, height: 8.5 });
    expect(medidasDe(celda({ bayCount: 0 }))).toEqual({ width: 1.1, length: 12, height: 8.5 });
  });

  it('todo lo que produce cabe en los límites que la base admite', () => {
    //  `publicacion.ts`: lado <= 200 m, alto <= 60 m. El rack más grande del catálogo real
    //  tiene 36 cuerpos, y hay que asegurarse de que no se publica un rack imposible.
    const m = medidasDe(celda({ bayCount: 36, maxLevel: 7, locationCount: 504 }));
    expect(m.length).toBeLessThanOrEqual(200);
    expect(m.height).toBeLessThanOrEqual(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CUANDO ALGUIEN MIDE, MANDA LA MEDIDA
//
// Es lo que convierte «Data Almacén» en algo más que una tabla: el dibujo cambia. Se
// prueba el ORDEN de preferencia, porque es donde está la decisión — lo medido gana a la
// convención, y lo de la familia gana a lo del almacén.
// ═══════════════════════════════════════════════════════════════════════════════

function metricas(over: Partial<WarehouseMetrics> = {}): WarehouseMetrics {
  return {
    id: 'm1',
    warehouseId: 'w1',
    rackFamily: null,
    palletWidthM: null, palletDepthM: null, palletHeightM: null,
    slotWidthM: null, slotHeightM: null, slotDepthM: null,
    bayWidthM: null, levelHeightM: null, rackHeightM: null, rackDepthM: null,
    uprightWidthM: null, beamHeightM: null, aisleWidthM: null, aisleLengthM: null,
    doubleDeep: null, notes: null,
    slotVolumeM3: null, palletVolumeM3: null, medidasTomadas: 0,
    updatedAt: '2026-08-15T00:00:00Z',
    ...over,
  };
}

describe('las medidas reales mandan sobre la convención', () => {
  const rcl = celda({ rackCode: 'RCL47', bayCount: 21, maxLevel: 7, locationCount: 273 });

  it('sin medidas, sigue la convención de siempre', () => {
    //  21 cuerpos x 2 posiciones x 1,35 = 56,7 · 7 niveles x 1,7 = 11,9
    const m = medidasDe(rcl);
    expect(m.length).toBeCloseTo(56.7, 2);
    expect(m.height).toBeCloseTo(11.9, 2);
  });

  it('el ancho del cuerpo medido sustituye al compuesto', () => {
    const m = medidasDe(rcl, metricas({ bayWidthM: 2.9 }));
    expect(m.length).toBeCloseTo(21 * 2.9, 2);
  });

  it('sin ancho de cuerpo, se compone con el del hueco y las posiciones', () => {
    //  Medir el hueco es más fácil que medir de eje a eje, así que vale como fuente.
    const m = medidasDe(rcl, metricas({ slotWidthM: 1.4 }));
    expect(m.length).toBeCloseTo(21 * 2 * 1.4, 2);
  });

  it('el alto del rack entero gana a multiplicar niveles', () => {
    //  Un rack de 7 niveles no mide 7 veces un nivel: está el suelo y el último larguero
    //  no lleva nada encima. Quien midió el rack completo midió la verdad.
    const m = medidasDe(rcl, metricas({ levelHeightM: 1.8, rackHeightM: 11.2 }));
    expect(m.height).toBeCloseTo(11.2, 2);
  });

  it('el fondo medido sustituye al de por omisión', () => {
    expect(medidasDe(rcl, metricas({ rackDepthM: 2.4 })).width).toBeCloseTo(2.4, 2);
  });

  it('lo de la familia gana a lo del almacén, campo a campo', () => {
    const filas = [
      metricas({ id: 'def', rackFamily: null, bayWidthM: 1.5, rackDepthM: 1.2 }),
      metricas({ id: 'rcl', rackFamily: 'RCL', bayWidthM: 2.9 }),
    ];
    const elegida = medidasPara('RCL47', filas)!;
    //  El ancho lo pone RCL; el fondo, que RCL no midió, lo hereda del almacén.
    expect(elegida.bayWidthM).toBe(2.9);
    expect(elegida.rackDepthM).toBe(1.2);
  });

  it('un rack de otra familia usa las del almacén', () => {
    const filas = [
      metricas({ rackFamily: null, bayWidthM: 1.5 }),
      metricas({ rackFamily: 'RCL', bayWidthM: 2.9 }),
    ];
    expect(medidasPara('MZ01', filas)!.bayWidthM).toBe(1.5);
  });

  it('sin ninguna fila, no hay medidas y se usa la convención', () => {
    expect(medidasPara('RCL47', [])).toBeUndefined();
    expect(medidasPara('RCL47', undefined)).toBeUndefined();
  });
});
