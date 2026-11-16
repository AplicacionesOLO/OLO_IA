/**
 * MEZZANINE (§7): dos entrepisos sobre la zona de andenes, con el sistema de bandas.
 *
 * Huella x −50.35…32.45 × z −0.4…−26.4 (§7.1). Las losas a 4.4 y 8.0 sobre la losa interior.
 * Las bandas (banda superior, caracol y banda colgada) se dibujan como masas; el flujo animado
 * de cajas corre en `actualizar` sobre un unico `InstancedMesh` (§7.3).
 */

import * as THREE from 'three';

import { FLOOR_Y, MEZZ_FRONT_Z, MEZZ_LEVELS, MEZZ_WALL_Z } from './constantes';
import type { PlanoCedi } from './plano';
import { Recolector, caja, type ZonaCedi } from './comun';

const std = (r: Recolector, color: number, roughness = 0.6, metalness = 0.25): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, metalness }));

export function construirMezzanine(plano: PlanoCedi): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:mezzanine';

  const x0 = plano.mezzanine.x0;
  const x1 = plano.mezzanine.x1;
  const ancho = x1 - x0;
  const cx = (x0 + x1) / 2;
  const z0 = MEZZ_WALL_Z;
  const z1 = MEZZ_FRONT_Z;
  const cz = (z0 + z1) / 2;
  const fondo = Math.abs(z1 - z0);

  // ── Losas (§7.1) ──────────────────────────────────────────────────────────────
  const matLosa = std(r, 0xa3a8ae, 0.6, 0.2);
  for (const nivel of MEZZ_LEVELS) {
    grupo.add(caja(r, ancho, 0.25, fondo, matLosa, cx, FLOOR_Y + nivel, cz));
  }

  // ── Columnas de acero cada 2 andenes, en dos filas (§7.2) ─────────────────────
  const matAcero = std(r, 0x8f969e, 0.5, 0.4);
  for (let x = x0 + 1; x <= x1 - 1; x += 9.2) {
    for (const z of [z0 + 0.3, cz]) {
      grupo.add(caja(r, 0.32, 8.0, 0.32, matAcero, x, FLOOR_Y + 4.0, z));
    }
  }

  // ── Baranda del borde que da a los racks ──────────────────────────────────────
  const matBaranda = std(r, 0x1f2937, 0.5, 0.4);
  for (const nivel of MEZZ_LEVELS) {
    grupo.add(caja(r, ancho, 0.06, 0.06, matBaranda, cx, FLOOR_Y + nivel + 1.1, z1));
  }

  // ── Torres de ascensor (§7.2) ─────────────────────────────────────────────────
  const matMalla = r.mat(
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, transparent: true, opacity: 0.22 }),
  );
  for (const x of [-44.81, 10.68]) {
    grupo.add(caja(r, 2.2, 10.2, 2.2, matMalla, x, FLOOR_Y + 5.1, -25.0));
  }

  // ── Gradas (caja maciza como escalera) ────────────────────────────────────────
  const matGrada = std(r, 0x1f2937, 0.6, 0.3);
  for (const x of [-26.96, 27.79]) {
    grupo.add(caja(r, 2.4, 8.0, 3.0, matGrada, x, FLOOR_Y + 4.0, z0 + 1.0));
  }

  // ── Bandas (§7.3): banda superior, caracol y banda colgada ────────────────────
  const matBanda = std(r, 0x1f2937, 0.5, 0.4);
  // Banda superior a y 9.025 sobre la losa, de x del caracol (−36.72) a 21.54
  grupo.add(caja(r, 21.54 - -36.72, 0.2, 0.95, matBanda, (-36.72 + 21.54) / 2, FLOOR_Y + 9.025, -1.4));
  // Banda colgada a y 3.375, del caracol a x 42.25
  grupo.add(caja(r, 42.25 - -36.72, 0.2, 0.9, matBanda, (-36.72 + 42.25) / 2, FLOOR_Y + 3.375, -3.4));
  // Caracol: cilindro en (−36.72, z −2.4)
  const caracol = new THREE.Mesh(
    r.geo(new THREE.CylinderGeometry(1.0, 1.0, 5.65, 24, 1, true)),
    std(r, 0x334155, 0.5, 0.4),
  );
  caracol.position.set(-36.72, FLOOR_Y + 6.2, -2.4);
  grupo.add(caracol);

  // ── Flujo animado de cajas (§7.3), un solo InstancedMesh ──────────────────────
  const N = 24;
  const flujoGeo = r.geo(new THREE.BoxGeometry(0.42, 0.34, 0.42));
  const flujoMat = std(r, 0xcf9b62, 0.85, 0.05);
  const flujo = new THREE.InstancedMesh(flujoGeo, flujoMat, N);
  flujo.frustumCulled = false;
  flujo.raycast = () => {};
  grupo.add(flujo);

  const bx0 = -36.72;
  const bx1 = 21.54;
  const by = FLOOR_Y + 9.025 + 0.27;
  const bz = -1.4;
  const avance = new Array(N).fill(0).map((_, i) => i / N);
  const m = new THREE.Matrix4();

  const actualizar = (dt: number): void => {
    for (let i = 0; i < N; i += 1) {
      avance[i] = (avance[i]! + (dt * 1.1) / (bx1 - bx0)) % 1;
      const x = bx0 + avance[i]! * (bx1 - bx0);
      m.makeTranslation(x, by, bz);
      flujo.setMatrixAt(i, m);
    }
    flujo.instanceMatrix.needsUpdate = true;
  };
  actualizar(0);

  return {
    grupo,
    dispose: () => r.dispose(),
    actualizar,
  };
}
