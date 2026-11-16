/**
 * VECINOS SOBRE EL TALUD (§10) ⚠ estimados del video.
 *
 * A y 4.6 (la meseta), de x −178.75 a −147.75. Franjas de la calle al patio (ciclovia, acera,
 * grava), un restaurante y una plaza comercial. Masas principales con sus rotulos.
 */

import * as THREE from 'three';

import { Recolector, caja, cartelTexto, piso, type ZonaCedi } from './comun';

const std = (r: Recolector, color: number, roughness = 0.7, metalness = 0.1): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, metalness }));

export function construirVecinos(): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:vecinos';
  const Y = 4.6;

  // ── Franjas (§10) ───────────────────────────────────────────────────────────
  grupo.add(piso(r, 2.2, 135.5, std(r, 0xc9c5bd, 0.8), -177.55, Y + 0.02, -27.25));
  grupo.add(piso(r, 2.6, 135.5, std(r, 0xd6d3cb, 0.8), -174.95, Y + 0.02, -27.25));
  grupo.add(piso(r, 2.0, 135.5, std(r, 0x8d8a84, 0.9), -172.65, Y + 0.02, -27.25));
  grupo.add(piso(r, 23.8, 135.5, std(r, 0x3b3f45, 0.9), -159.65, Y + 0.015, -27.25));

  // ── Seto y palmeras en la grava ───────────────────────────────────────────────
  const matSeto = std(r, 0x4d7c2f, 0.8);
  for (let z = -90; z < 40; z += 6) {
    grupo.add(caja(r, 1.1, 0.8, 1.1, matSeto, -172.65, Y + 0.4, z));
  }

  // ── Restaurante (z −87 a −57) ─────────────────────────────────────────────────
  grupo.add(caja(r, 12, 6.8, 30, std(r, 0x1b2233, 0.6), -160.25, Y + 3.4, -72));
  grupo.add(caja(r, 2, 9.2, 1.4, std(r, 0xd62828, 0.5), -154.5, Y + 4.6, -72));
  grupo.add(
    cartelTexto(r, {
      ancho: 9,
      alto: 2.2,
      px: -154.0,
      py: Y + 5,
      pz: -72,
      texto: "McDonald's",
      colorTexto: '#ffcc00',
      rotY: -Math.PI / 2,
      fondo: '#cc0000',
    }),
  );

  // ── Plaza comercial (z −45 a 3) ───────────────────────────────────────────────
  grupo.add(caja(r, 12, 5.4, 48, std(r, 0x6b7178, 0.7), -160.25, Y + 2.7, -21));
  grupo.add(caja(r, 12, 0.25, 49, std(r, 0x3a3f46, 0.6), -160.25, Y + 3.5, -21));
  grupo.add(
    cartelTexto(r, {
      ancho: 8,
      alto: 1.6,
      px: -154.0,
      py: Y + 4.2,
      pz: -30,
      texto: 'ampm',
      colorTexto: '#ffffff',
      rotY: -Math.PI / 2,
      fondo: '#e11d48',
    }),
  );

  return {
    grupo,
    dispose: () => r.dispose(),
  };
}
