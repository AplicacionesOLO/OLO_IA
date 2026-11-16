/**
 * EDIFICIO DEL ALMACEN (§5): losa, muros, cubierta, puertas de anden y portones.
 *
 * El modo «sin techo» (cutaway) oculta cubierta, alero y paneles y baja los muros a 5,5 m para
 * ver el interior. Se resuelve con dos juegos de muros —alto y bajo— que se alternan, en vez de
 * reescalar: son pocas cajas y asi el cambio es instantaneo y sin recalcular geometria.
 */

import * as THREE from 'three';

import {
  BUILDING_HEIGHT,
  FLOOR_Y,
  FRONT_Z,
  HEAVY_GATE_H,
  HEAVY_GATE_W,
  HEAVY_GATE_Z,
  X_EAST,
  X_WEST,
  systemOfPhys,
} from './constantes';
import type { PlanoCedi } from './plano';
import { Recolector, caja, cartelTexto, type ZonaCedi } from './comun';
import { tiledTexture } from './texturas';

export interface ZonaEdificio extends ZonaCedi {
  setCutaway: (on: boolean) => void;
}

const std = (
  r: Recolector,
  color: number,
  roughness: number,
  metalness = 0.05,
  map?: THREE.Texture,
): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...(map ? { map } : {}) }));

/** x0, x1 del edificio de oficinas (ahi no hay losa ni fachada). */
function officeSpan(plano: PlanoCedi): { x0: number; x1: number } {
  const center = plano.officeX - 28 / 4;
  return { x0: center - 28 / 2, x1: center + 28 / 2 };
}

export function construirEdificio(plano: PlanoCedi): ZonaEdificio {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:edificio';

  const oficina = officeSpan(plano);

  // ── Losa (§5.1): 3 cajas, hueco bajo el edificio de oficinas ───────────────────
  const matLosa = std(r, 0xd4d7dc, 0.35, 0.05, tiledTexture('floor', 183.5, 89, 6));
  const losa = (x0: number, x1: number, z0: number, z1: number): void => {
    grupo.add(caja(r, x1 - x0, FLOOR_Y, z1 - z0, matLosa, (x0 + x1) / 2, FLOOR_Y / 2, (z0 + z1) / 2));
  };
  losa(X_WEST, oficina.x0, FRONT_Z, 0);
  losa(oficina.x1, X_EAST, FRONT_Z, 0);
  losa(oficina.x0, oficina.x1, -70, 0);

  // ── Muros: dos juegos (alto a 14, bajo a 5.5) ─────────────────────────────────
  const murosAltos = new THREE.Group();
  const murosBajos = new THREE.Group();
  grupo.add(murosAltos, murosBajos);
  murosBajos.visible = false;

  const matMuro = std(r, 0xeef0f2, 0.55, 0.15);
  const ESP = 0.3;
  /** Un muro vertical del alto dado, con su base en y 0. */
  const muro = (
    destino: THREE.Group,
    largo: number,
    alto: number,
    x: number,
    z: number,
    ejeZ: boolean,
  ): void => {
    const w = ejeZ ? ESP : largo;
    const d = ejeZ ? largo : ESP;
    destino.add(caja(r, w, alto, d, matMuro, x, alto / 2, z));
  };

  for (const [destino, alto] of [
    [murosAltos, BUILDING_HEIGHT],
    [murosBajos, 5.5],
  ] as const) {
    // Fachada frontal, en dos tramos (hueco de oficinas)
    muro(destino, oficina.x0 - X_WEST, alto, (X_WEST + oficina.x0) / 2, FRONT_Z + 0.15, false);
    muro(destino, X_EAST - oficina.x1, alto, (oficina.x1 + X_EAST) / 2, FRONT_Z + 0.15, false);
    // Muro sur
    muro(destino, 89, alto, X_EAST - 0.15, FRONT_Z / 2, true);
    // Muro norte, partido por el vano del porton
    const vano0 = HEAVY_GATE_Z - HEAVY_GATE_W / 2;
    const vano1 = HEAVY_GATE_Z + HEAVY_GATE_W / 2;
    muro(destino, Math.abs(FRONT_Z - vano1), alto, X_WEST + 0.15, (FRONT_Z + vano1) / 2, true);
    muro(destino, Math.abs(vano0 - 0), alto, X_WEST + 0.15, vano0 / 2, true);
  }

  // Cara de andenes (z ≈ 0): zocalo + pilares entre puertas
  grupo.add(caja(r, 183.5, 1.2, 0.3, std(r, 0x9ca3af, 0.6), 0, FLOOR_Y + 0.6, -0.15));
  const matPilar = std(r, 0xeef0f2, 0.55, 0.15);
  for (const p of plano.puertas) {
    // pilar de 1,2 m a cada lado de la puerta
    grupo.add(caja(r, 1.2, 3.6, 0.3, matPilar, p.x + 2.3, FLOOR_Y + 1.8, -0.15));
  }
  // dintel sobre la cara de andenes
  grupo.add(caja(r, 183.5, BUILDING_HEIGHT - 4.8, 0.3, matMuro, 0, 4.8 + (BUILDING_HEIGHT - 4.8) / 2, -0.15));

  // ── Cubierta (§5.3) ───────────────────────────────────────────────────────────
  const techo = new THREE.Group();
  techo.name = 'cedi:cubierta';
  grupo.add(techo);
  const matPlaca = std(r, 0xeef0f3, 0.5, 0.3, tiledTexture('roof', 183.9, 89.4, 1.6));
  techo.add(caja(r, 183.9, 0.1, 89.4, matPlaca, 0, 14.05, FRONT_Z / 2));
  // Paneles solares 3x3
  const matPanel = std(r, 0x1e3a5f, 0.25, 0.6);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const panel = caja(r, 50.17, 0.08, 16, matPanel, -60 + i * 60, 14.25, -75 + j * 20);
      panel.rotation.x = 0.12;
      techo.add(panel);
    }
  }
  // Alero de andenes
  techo.add(caja(r, 183.5, 0.25, 6, std(r, 0xf8fafc, 0.6), 0, 6.6, 3));

  // ── Puertas de anden (§5.4): hoja + numero exterior ───────────────────────────
  const matHoja = std(r, 0xcbd5e1, 0.45, 0.35);
  const matSello = std(r, 0x111827, 0.95);
  for (const p of plano.puertas) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, 0);
    // hoja
    g.add(caja(r, 3.4, 3.6, 0.1, matHoja, 0, FLOOR_Y + 1.8, -0.05));
    // sellos laterales + superior
    g.add(caja(r, 0.4, 3.8, 0.5, matSello, -1.9, FLOOR_Y + 1.8, 0.25));
    g.add(caja(r, 0.4, 3.8, 0.5, matSello, 1.9, FLOOR_Y + 1.8, 0.25));
    g.add(caja(r, 4.2, 0.6, 0.5, matSello, 0, FLOOR_Y + 3.9, 0.25));
    // numero exterior (contra-reflejado), solo el fisico en verde
    g.add(
      cartelTexto(r, {
        ancho: 2.0,
        alto: 1.4,
        px: 0,
        py: FLOOR_Y + 1.95,
        pz: 0.06,
        texto: String(p.phys).padStart(2, '0'),
        colorTexto: '#15a34a',
        contorno: '#ffffff',
      }),
    );
    // numero interior (sistema), mirando hacia dentro
    g.add(
      cartelTexto(r, {
        ancho: 1.5,
        alto: 0.94,
        px: 0,
        py: FLOOR_Y + 4.0,
        pz: -0.32,
        texto: systemOfPhys(p.phys),
        colorTexto: '#14a37f',
        fondo: '#f8fafc',
        rotY: Math.PI,
      }),
    );
    grupo.add(g);
  }

  // ── Portones de carga pesada (§5.5) ───────────────────────────────────────────
  const porton = (x: number, z: number, rotY: number, color: number): void => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.add(caja(r, HEAVY_GATE_W, HEAVY_GATE_H, 0.08, std(r, color, 0.5, 0.3), 0, 2.1, 0));
    g.add(caja(r, 0.3, HEAVY_GATE_H, 0.1, std(r, 0xfacc15, 0.6), -3.15, 2.1, 0));
    g.add(caja(r, 0.3, HEAVY_GATE_H, 0.1, std(r, 0xfacc15, 0.6), 3.15, 2.1, 0));
    grupo.add(g);
  };
  porton(X_WEST, HEAVY_GATE_Z, -Math.PI / 2, 0x1d4ed8);
  porton(X_EAST - 1.5 - HEAVY_GATE_W / 2, 0, 0, 0x9aa5b1);

  // Rampa del porton sur (cuña maciza)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(8, 0);
  shape.lineTo(0, 1.2);
  shape.closePath();
  const rampaGeo = r.geo(new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false }));
  rampaGeo.rotateY(-Math.PI / 2);
  rampaGeo.translate(3.5, 0, 0);
  rampaGeo.computeVertexNormals();
  const rampa = new THREE.Mesh(rampaGeo, std(r, 0x9ca3af, 0.9));
  rampa.position.set(X_EAST - 1.5 - HEAVY_GATE_W / 2, 0, 0);
  grupo.add(rampa);

  return {
    grupo,
    dispose: () => r.dispose(),
    setCutaway: (on: boolean) => {
      murosAltos.visible = !on;
      murosBajos.visible = on;
      techo.visible = !on;
    },
  };
}
