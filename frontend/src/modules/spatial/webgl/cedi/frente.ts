/**
 * FRENTE DEL CEDI (§9): fachada frontal, parqueo en espiga, motos, busetas y postes LED.
 *
 * Tramos [−91.75, 18.53] y [46.53, 91.75]; frente a oficinas no hay alero ni acera. Las piezas
 * repetidas —pilastras, carros, postes— van en `InstancedMesh` (§13.1).
 */

import * as THREE from 'three';

import { FRONT_Z, X_EAST, X_WEST } from './constantes';
import type { PlanoCedi } from './plano';
import { Recolector, caja, piso, prng, type ZonaCedi } from './comun';
import { tiledTexture } from './texturas';

const std = (r: Recolector, color: number, roughness = 0.6, metalness = 0.1, map?: THREE.Texture): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...(map ? { map } : {}) }));

export function construirFrente(plano: PlanoCedi): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:frente';

  const officeC = plano.officeX - 28 / 4;
  const tramos: [number, number][] = [
    [X_WEST, officeC - 14],
    [officeC + 14, X_EAST],
  ];

  // ── Pared baja de paneles y pilastras ─────────────────────────────────────────
  const matPanel = std(r, 0x8f959c, 0.6);
  const matPilastra = std(r, 0xf4f6f8, 0.5);
  const pilastras: number[] = [];
  for (const [a, b] of tramos) {
    grupo.add(caja(r, b - a, 4.2, 0.06, matPanel, (a + b) / 2, 2.1, FRONT_Z + 0.03));
    for (let x = a + 4.8; x < b; x += 9.6) pilastras.push(x);
  }
  if (pilastras.length > 0) {
    const geo = r.geo(new THREE.BoxGeometry(0.6, 14 - 4.2, 0.3));
    const malla = new THREE.InstancedMesh(geo, matPilastra, pilastras.length);
    const m = new THREE.Matrix4();
    pilastras.forEach((x, i) => {
      m.makeTranslation(x, 4.2 + (14 - 4.2) / 2, FRONT_Z - 0.1);
      malla.setMatrixAt(i, m);
    });
    malla.raycast = () => {};
    grupo.add(malla);
  }

  // ── Alero gris oscuro: angosto en todo el frente, ancho sobre las motos ───────
  const matAlero = std(r, 0x9aa0a7, 0.6);
  for (const [a, b] of tramos) {
    grupo.add(caja(r, b - a, 0.5, 2.6, matAlero, (a + b) / 2, 4.4, FRONT_Z - 1.3));
  }
  // Alero ancho (6.4 m) sobre las motos, de x −86.15 a −70.15
  grupo.add(caja(r, 16, 0.5, 6.4, matAlero, -78.15, 4.4, FRONT_Z - 3.2));
  const matCol = std(r, 0xf4f6f8, 0.5);
  for (const x of [-85.65, -80.65, -75.65, -70.65]) {
    const c = new THREE.Mesh(r.geo(new THREE.CylinderGeometry(0.1, 0.1, 4.3, 8)), matCol);
    c.position.set(x, 2.15, FRONT_Z - 1.5);
    grupo.add(c);
  }

  // ── Suelos del frente ─────────────────────────────────────────────────────────
  grupo.add(piso(r, 183.5, 2.6, std(r, 0xc4bcae, 0.85, 0.1, tiledTexture('concrete', 183.5, 2.6, 4)), 0, 0.012, FRONT_Z - 1.3));
  // Parqueo de adoquin en espiga
  grupo.add(piso(r, 183.5, 16, std(r, 0xa39a8e, 0.85, 0.1, tiledTexture('espiga', 183.5, 16, 1.6)), 0, 0.01, FRONT_Z - 8));
  // Bordillos amarillos
  const matBordillo = std(r, 0xf2c200, 0.6);
  grupo.add(caja(r, 183.5, 0.16, 0.16, matBordillo, 0, 0.08, FRONT_Z - 3.6));
  grupo.add(caja(r, 183.5, 0.16, 0.16, matBordillo, 0, 0.08, FRONT_Z - 16.08));

  // ── Carros en dos filas (instanciados) ────────────────────────────────────────
  const colores = [0xe5e7eb, 0x9ca3af, 0x111827, 0x1e3a8a, 0x7f1d1d, 0xd1d5db, 0x374151, 0x1d4ed8];
  const carros: { x: number; z: number; rot: number; color: number }[] = [];
  const rc = prng(11);
  for (const [z, rot] of [
    [FRONT_Z - 5.8, Math.PI],
    [FRONT_Z - 13.4, 0],
  ] as const) {
    for (let x = -83.75; x < X_EAST - 4; x += 2.8) {
      // saltar frente a oficinas y en la entrada
      if (Math.abs(x - officeC) < 17) continue;
      if (rc() < 0.3) continue;
      carros.push({ x, z, rot, color: colores[Math.floor(rc() * colores.length)]! });
    }
  }
  if (carros.length > 0) {
    const geo = r.geo(new THREE.BoxGeometry(1.8, 0.7, 4.3));
    const mat = r.mat(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }));
    const malla = new THREE.InstancedMesh(geo, mat, carros.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    carros.forEach((c, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
      m.compose(new THREE.Vector3(c.x, 0.7, c.z), q, new THREE.Vector3(1, 1, 1));
      malla.setMatrixAt(i, m);
      malla.setColorAt(i, col.set(c.color));
    });
    malla.raycast = () => {};
    grupo.add(malla);
  }

  // ── Motos (extremo norte) y busetas verde menta ───────────────────────────────
  const matMoto = std(r, 0x1f2937, 0.5, 0.3);
  for (let i = 0; i < 15; i += 1) {
    grupo.add(caja(r, 0.5, 1.0, 1.6, matMoto, -85.15 + i * 0.9, 0.6, FRONT_Z - 5.8));
  }
  const matBuseta = std(r, 0x3fc6a8, 0.5, 0.2);
  for (let i = 0; i < 4; i += 1) {
    grupo.add(caja(r, 1.9, 1.9, 4.4, matBuseta, officeC - 17 + i * 4, 1.2, FRONT_Z - 5.8));
  }

  // ── Postes LED en «V» (instanciados simplificados) ────────────────────────────
  const matPoste = std(r, 0x8c9196, 0.5, 0.4);
  for (let x = X_WEST + 12; x < X_EAST; x += 28) {
    const p = new THREE.Mesh(r.geo(new THREE.CylinderGeometry(0.1, 0.12, 9.8, 8)), matPoste);
    p.position.set(x, 4.9, FRONT_Z - 16.75);
    grupo.add(p);
  }

  return {
    grupo,
    dispose: () => r.dispose(),
  };
}
