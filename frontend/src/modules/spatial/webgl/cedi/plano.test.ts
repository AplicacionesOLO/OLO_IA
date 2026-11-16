/**
 * El plano del CEDI tiene que salir EXACTO. Estos valores son los del documento
 * `GEMELO_CEDI_OLO.md` (§2.1, §14.1 y los anexos A y B), que a su vez salieron de ejecutar
 * `buildLayout()`/`planRacks()` en el simulador. Si el port diverge, aqui se ve — y no mirando
 * la pantalla, que es como un eje girado 90° estuvo semanas sin detectarse.
 */

import { describe, expect, it } from 'vitest';

import { X_EAST, X_WEST, physX } from './constantes';
import { construirPlano, planRacks } from './plano';
import type { PlacedFila } from './plano';

/** El anexo B: x0 (fondo de la fila) de cada renglon, en x logico. x1 = x0 + 2.3. */
const ANEXO_B_X0: Record<number, number> = {
  1: -90.95, 2: -56.6, 3: -54.0, 4: -49.06, 5: -46.46, 6: -41.52, 7: -38.92,
  8: -33.99, 9: -31.39, 10: -26.45, 11: -23.85, 12: -18.91, 13: -16.31,
  14: -11.37, 15: -8.77, 16: -3.84, 17: -1.24, 18: 3.7, 19: 6.3, 20: 11.24,
  21: 13.84, 22: 18.77, 23: 21.38, 24: 26.31, 25: 28.91, 26: 33.85, 27: 36.45,
  28: 41.39, 29: 43.99, 30: 48.93, 31: 51.52, 32: 56.46, 33: 61.4, 34: 73.57,
  35: 76.17, 36: 81.11, 37: 83.71, 38: 88.65,
};

describe('constantes maestras', () => {
  it('xWest y xEast son ±91.75 (length 183.5)', () => {
    expect(X_WEST).toBeCloseTo(-91.75, 5);
    expect(X_EAST).toBeCloseTo(91.75, 5);
  });

  it('physX(2) = −84.85 y physX(38) = 80.75', () => {
    expect(physX(2)).toBeCloseTo(-84.85, 5);
    expect(physX(38)).toBeCloseTo(80.75, 5);
  });
});

describe('plano de racks (port de planRacks)', () => {
  const plan = planRacks(X_WEST, X_EAST, -89, -26.5);

  it('col = 61.2 / 32 = 1.9125', () => {
    expect(plan.col).toBeCloseTo(1.9125, 5);
    expect(plan.zFront).toBeCloseTo(-87.7, 5);
  });

  it('hay 38 filas, numeradas 1..38', () => {
    expect(plan.filas).toHaveLength(38);
    const nums = plan.filas.map((f) => f.fila).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
  });

  it('cada fila cae donde dice el anexo B (x0, y x1 = x0 + 2.3)', () => {
    const porNum = new Map<number, PlacedFila>(plan.filas.map((f) => [f.fila, f]));
    for (const [fila, x0] of Object.entries(ANEXO_B_X0)) {
      const f = porNum.get(Number(fila));
      expect(f, `falta la fila ${fila}`).toBeDefined();
      //  Precision 1: el anexo B redondea a 2 decimales y alguno cae justo en el medio punto
      //  (fila 30 sale 48.925 → 48.93). Las filas distan >= 2.3 m, asi que 0.05 de holgura
      //  sigue delatando cualquier divergencia real del port.
      expect(f!.x0, `fila ${fila} x0`).toBeCloseTo(x0, 1);
      expect(f!.x1, `fila ${fila} x1`).toBeCloseTo(x0 + 2.3, 1);
    }
  });

  it('fila 22 arranca en x0 = 18.77 (frente a oficinas)', () => {
    const f22 = plan.filas.find((f) => f.fila === 22);
    expect(f22?.x0).toBeCloseTo(18.77, 2);
  });

  it('la linea de Zona Franca cae en x ≈ 60.08', () => {
    expect(plan.zfLineX).toBeCloseTo(60.08, 1);
  });
});

describe('plano del CEDI ensamblado', () => {
  const plano = construirPlano();

  it('37 puertas fisicas, de la 02 a la 38', () => {
    expect(plano.puertas).toHaveLength(37);
    expect(plano.puertas[0]).toMatchObject({ phys: 2 });
    expect(plano.puertas[0]!.x).toBeCloseTo(-84.85, 5);
    expect(plano.puertas[36]).toMatchObject({ phys: 38 });
    expect(plano.puertas[36]!.x).toBeCloseTo(80.75, 5);
  });

  it('el mezzanine va de x −50.35 a 32.45 (andenes 10 a 27)', () => {
    expect(plano.mezzanine.x0).toBeCloseTo(-50.35, 5);
    expect(plano.mezzanine.x1).toBeCloseTo(32.45, 5);
  });

  it('el edificio de oficinas queda centrado en 32.53 (x 18.53…46.53) y officeX = 39.53', () => {
    expect(plano.officeX).toBeCloseTo(39.53, 1);
    const center = plano.officeX - 28 / 4;
    expect(center).toBeCloseTo(32.53, 1);
    expect(center - 14).toBeCloseTo(18.53, 1);
    expect(center + 14).toBeCloseTo(46.53, 1);
  });
});
