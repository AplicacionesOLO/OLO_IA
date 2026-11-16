/**
 * EDIFICIO DE OFICINAS (§8): 3 pisos metidos en la bodega, contra la fachada.
 *
 * Planta 28 × 20 (x 18.53…46.53, z −90…−70). Se dibujan las masas principales: el volumen con
 * sus losas de piso, la fachada acristalada, la cornisa, la terraza y el control de acceso
 * pegado a la pared del fondo. El detalle interior fino (muebles, salas) no es necesario para
 * leer el edificio dentro del CEDI.
 */

import * as THREE from 'three';

import { OFFICE_BACK_Z, OFFICE_FACE_Z, OFFICE_W } from './constantes';
import type { PlanoCedi } from './plano';
import { Recolector, caja, cartelTexto, type ZonaCedi } from './comun';

const std = (r: Recolector, color: number, roughness = 0.6, metalness = 0.1): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, metalness }));

export function construirOficinas(plano: PlanoCedi): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:oficinas';

  const center = plano.officeX - OFFICE_W / 4;
  const x0 = center - OFFICE_W / 2;
  const x1 = center + OFFICE_W / 2;
  const z0 = OFFICE_FACE_Z;
  const z1 = OFFICE_BACK_Z;
  const cz = (z0 + z1) / 2;
  const ancho = x1 - x0;
  const fondo = z1 - z0;

  // ── Volumen: muros laterales y del fondo, losas de piso ───────────────────────
  const matMuro = std(r, 0xeef0f2, 0.55, 0.1);
  const ESP = 0.3;
  // laterales
  grupo.add(caja(r, ESP, 14.6, fondo, matMuro, x0, 7.3, cz));
  grupo.add(caja(r, ESP, 14.6, fondo, matMuro, x1, 7.3, cz));
  // pared del fondo (da a los racks)
  grupo.add(caja(r, ancho, 14.6, ESP, matMuro, center, 7.3, z1));

  // Losas de piso (1, 2, 3) y techo
  const matLosa = std(r, 0xd4d7dc, 0.5, 0.1);
  for (const y of [0, 4.8, 9.6, 14.6]) {
    grupo.add(caja(r, ancho, 0.25, fondo, matLosa, center, y, cz));
  }

  // ── Fachada acristalada (§8.1) ────────────────────────────────────────────────
  const matVidrio = r.mat(
    new THREE.MeshPhysicalMaterial({
      color: 0x8fd3c5,
      roughness: 0.1,
      metalness: 0,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  );
  grupo.add(caja(r, ancho - 0.6, 13.6, 0.1, matVidrio, center, 7.3, z0 + 0.1));

  // Cornisa / alero de la entrada (sobresale 3 m a cada lado)
  grupo.add(caja(r, ancho + 6, 1.1, 0.9, std(r, 0xf4f6f8, 0.5, 0.1), center, 4.25, z0 - 0.4));

  // Parasoles sobre piso 2 y 3
  const matLama = r.mat(
    new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5, emissive: 0x6b7280, emissiveIntensity: 0.15 }),
  );
  for (const y of [9.35, 14.25]) {
    grupo.add(caja(r, ancho, 0.15, 1.8, matLama, center, y, z0 - 0.9));
  }

  // ── Terraza (§8.3): piso de madera + baranda de vidrio ────────────────────────
  grupo.add(caja(r, 7.78, 0.1, 5, std(r, 0x8a6a45, 0.8), center + 6.2, 9.6, z0 + 2.5));
  grupo.add(
    caja(
      r,
      7.78,
      1.0,
      0.08,
      r.mat(
        new THREE.MeshPhysicalMaterial({
          color: 0xa7e3dc,
          roughness: 0.1,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      ),
      center + 6.2,
      10.1,
      z0 + 0.1,
    ),
  );

  // ── Control de acceso del personal (§8.4), pegado al fondo ────────────────────
  const acx = center;
  grupo.add(caja(r, 11, 3.2, 0.2, std(r, 0xf1f5f4, 0.6), acx, 1.2 + 1.6, z1 + 0.3));
  // arco detector
  const matArco = std(r, 0xb9bec4, 0.5, 0.3);
  grupo.add(caja(r, 0.12, 2.25, 0.58, matArco, acx - 0.44, 1.2 + 1.125, z1 + 1.0));
  grupo.add(caja(r, 0.12, 2.25, 0.58, matArco, acx + 0.44, 1.2 + 1.125, z1 + 1.0));
  // letrero SALIDA
  grupo.add(
    cartelTexto(r, {
      ancho: 2.4,
      alto: 0.6,
      px: acx,
      py: 1.2 + 2.6,
      pz: z1 + 0.42,
      texto: 'SALIDA',
      colorTexto: '#ffffff',
      fondo: '#15803d',
    }),
  );

  return {
    grupo,
    dispose: () => r.dispose(),
  };
}
