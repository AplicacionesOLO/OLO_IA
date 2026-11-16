/**
 * SITIO (§4): terreno, calles, patio, talud, cerca, agujas y el almacen vecino.
 *
 * Todo en coordenadas LOGICAS (el grupo raiz las refleja). Los pisos son planos a `y` con unos
 * milimetros de separacion entre capas para evitar z-fighting, y textura procedural repetida.
 * Las piezas que se repiten —pilas de tarimas, arboles— van en `InstancedMesh` (regla §13.1).
 */

import * as THREE from 'three';

import {
  BLVD_Z,
  FENCE_Z,
  MAIN_GATE_X,
  PALLET_Z0,
  ROAD_Z,
  STREET_X,
  WAIT_X,
  X_EAST,
  YARD_ROAD_X,
} from './constantes';
import { Recolector, caja, piso, prng, type ZonaCedi } from './comun';
import { tiledTexture } from './texturas';

const std = (
  r: Recolector,
  color: number,
  roughness: number,
  map?: THREE.Texture,
): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, ...(map ? { map } : {}) }));

export function construirSitio(): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:sitio';

  const asf = (w: number, d: number): THREE.Texture => tiledTexture('asphalt', w, d, 4);

  // ── Pisos (§4) ──────────────────────────────────────────────────────────────
  grupo.add(piso(r, 623.5, 520, std(r, 0x5f8d4e, 0.85, tiledTexture('grass', 623.5, 520, 9)), 0, 0, -40));
  grupo.add(piso(r, 14, 520, std(r, 0x3f4448, 0.92, asf(14, 520)), STREET_X, 0.005, -112));
  grupo.add(piso(r, 303.5, 11, std(r, 0x3f4448, 0.92, asf(303.5, 11)), -46, 0.015, -112));
  grupo.add(piso(r, 183.5, 24, std(r, 0xc9c6bf, 0.85, tiledTexture('concrete', 183.5, 24, 4)), 0, 0.012, 12));
  grupo.add(piso(r, 230.5, 9, std(r, 0x3f4448, 0.92, asf(230.5, 9)), -9.5, 0.015, ROAD_Z));
  grupo.add(piso(r, 46, 127.5, std(r, 0x3f4448, 0.92, asf(46, 127.5)), -114.75, 0.013, -31.25));
  grupo.add(piso(r, 5, 105, std(r, 0x8a5a3c, 0.9, tiledTexture('dirt', 5, 105, 3)), WAIT_X, 0.02, -32.5));
  grupo.add(piso(r, 12, 17, std(r, 0x3f4448, 0.92, asf(12, 17)), YARD_ROAD_X, 0.014, -103.5));

  // Retorno (circulo r 9)
  const retorno = new THREE.Mesh(
    r.geo(new THREE.CircleGeometry(9, 48)),
    std(r, 0x3f4448, 0.92, tiledTexture('asphalt', 18, 18, 4)),
  );
  retorno.rotation.x = -Math.PI / 2;
  retorno.position.set(105.75, 0.02, 28);
  grupo.add(retorno);

  // Isla verde + 3 equipos naranja
  const isla = new THREE.Mesh(r.geo(new THREE.CylinderGeometry(5, 5, 0.5, 24)), std(r, 0x6fa35a, 0.8));
  isla.position.set(96.75, 0.25, 14);
  grupo.add(isla);
  const matEquipo = std(r, 0xea580c, 0.6);
  const matMastil = std(r, 0x111418, 0.5);
  for (let i = 0; i < 3; i += 1) {
    grupo.add(caja(r, 1.2, 1.4, 2, matEquipo, 95.4 + i * 1.3, 0.95, 14));
    grupo.add(caja(r, 0.08, 3, 0.08, matMastil, 95.4 + i * 1.3, 1.5, 13));
  }

  // ── Talud y meseta (§4.1) ─────────────────────────────────────────────────────
  const matTalud = std(r, 0x7a6a4f, 0.95);
  for (const x of [-143.75, -182.75]) {
    const t = caja(r, 12, 5, 135.5, matTalud, x, 2.5, -27.25);
    t.rotation.z = x === -143.75 ? -0.45 : 0.45;
    grupo.add(t);
  }
  grupo.add(piso(r, 31, 135.5, std(r, 0x6b8f55, 0.9), -163.25, 4.6, -27.25));

  // ── Cerca de malla (§4.2) ─────────────────────────────────────────────────────
  const matCerca = r.mat(
    new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8, transparent: true, opacity: 0.55 }),
  );
  const cerca = (x0: number, x1: number, z: number): void => {
    grupo.add(caja(r, x1 - x0, 2.2, 0.08, matCerca, (x0 + x1) / 2, 1.1, z));
  };
  cerca(-137.75, 105.75, FENCE_Z);
  cerca(-137.75, -126.75, -95);
  cerca(-106.75, -91.75, -95);

  // Agujas (barrera): poste + brazo. Simplificadas pero en su sitio.
  const matPoste = std(r, 0xfacc15, 0.6);
  const matBrazo = std(r, 0xdc2626, 0.5);
  const aguja = (x: number, z: number, largo: number): void => {
    grupo.add(caja(r, 0.5, 1.2, 0.5, matPoste, x, 0.6, z));
    const brazo = caja(r, 0.12, 0.12, largo, matBrazo, x, 1.1, z + largo / 2);
    grupo.add(brazo);
  };
  aguja(MAIN_GATE_X, -112, 4.5);
  aguja(YARD_ROAD_X - 5.6, -94, 5.2);
  aguja(YARD_ROAD_X + 5.6, -94, 5.2);

  // ── Pilas de tarimas (§4), instanciadas ───────────────────────────────────────
  const pilas: { x: number; h: number; dark: boolean }[] = [];
  const rp = prng(7);
  for (let x = -85.75; x < X_EAST; x += 7) {
    if (rp() < 0.25) continue;
    pilas.push({ x, h: 1 + rp() * 2.2, dark: rp() > 0.8 });
  }
  if (pilas.length > 0) {
    const geo = r.geo(new THREE.BoxGeometry(5, 1, 4));
    const mat = std(r, 0xffffff, 0.85, tiledTexture('carton', 5, 4, 5));
    const malla = new THREE.InstancedMesh(geo, mat, pilas.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    pilas.forEach((p, i) => {
      m.makeScale(1, p.h, 1);
      m.setPosition(p.x, p.h / 2, PALLET_Z0 + 2.5);
      malla.setMatrixAt(i, m);
      malla.setColorAt(i, col.set(p.dark ? 0x2f3b45 : 0x9a6b3f));
    });
    malla.instanceMatrix.needsUpdate = true;
    malla.computeBoundingSphere();
    malla.raycast = () => {};
    grupo.add(malla);
  }

  // ── Arboles (§4), tronco + copa instanciados ─────────────────────────────────
  const arboles: { x: number; z: number }[] = [];
  for (let i = 0; i < 10; i += 1) arboles.push({ x: -147.75 + i * 11, z: 48 + (i % 3) * 7 });
  for (let i = 0; i < 8; i += 1) arboles.push({ x: 131.75, z: -60 + i * 13 });
  if (arboles.length > 0) {
    const tGeo = r.geo(new THREE.CylinderGeometry(0.35, 0.4, 3, 8));
    const cGeo = r.geo(new THREE.SphereGeometry(3, 12, 8));
    const tMat = std(r, 0x6b4f2a, 0.9);
    const cMat = std(r, 0x3f6b34, 0.85);
    const troncos = new THREE.InstancedMesh(tGeo, tMat, arboles.length);
    const copas = new THREE.InstancedMesh(cGeo, cMat, arboles.length);
    const m = new THREE.Matrix4();
    arboles.forEach((a, i) => {
      m.makeTranslation(a.x, 1.5, a.z);
      troncos.setMatrixAt(i, m);
      m.makeTranslation(a.x, 4.5, a.z);
      copas.setMatrixAt(i, m);
    });
    troncos.raycast = () => {};
    copas.raycast = () => {};
    grupo.add(troncos, copas);
  }

  // ── Almacen vecino (§4): caja gris con fachada negra ──────────────────────────
  grupo.add(caja(r, 142.9, 12, 70, std(r, 0xe7e5e4, 0.9), -62.29, 6, -178.5));
  grupo.add(caja(r, 14.2, 12.6, 70.4, std(r, 0x1f2328, 0.8), -126.75, 6.3, -178.5));
  const matRemolque = std(r, 0x1e3a8a, 0.6);
  grupo.add(caja(r, 2.6, 2.9, 13.5, matRemolque, -120, 1.45, BLVD_Z + 8));
  grupo.add(caja(r, 2.6, 2.9, 13.5, matRemolque, -116, 1.45, BLVD_Z + 8));

  return {
    grupo,
    dispose: () => r.dispose(),
  };
}
