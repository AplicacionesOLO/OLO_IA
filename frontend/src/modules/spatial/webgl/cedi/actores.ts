/**
 * ACTORES (§11): montacargas y un camion acoplado. Estaticos, como escala humana del CEDI.
 *
 * El recorrido animado de montacargas y las fases de camion del simulador son otra capa (viven
 * en `agvs`/`routes` del editor); aqui solo se colocan unas piezas para dar vida y escala.
 */

import * as THREE from 'three';

import { DOCKED_Z, FLOOR_Y } from './constantes';
import type { PlanoCedi } from './plano';
import { Recolector, caja, type ZonaCedi } from './comun';
import { tiledTexture } from './texturas';

const std = (r: Recolector, color: number, roughness = 0.6, metalness = 0.2, map?: THREE.Texture): THREE.MeshStandardMaterial =>
  r.mat(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...(map ? { map } : {}) }));

function montacargas(r: Recolector, x: number, z: number, rot: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  g.add(caja(r, 1.12, 0.5, 1.75, std(r, 0xf2a20c, 0.6, 0.3), 0, FLOOR_Y + 0.35, 0));
  g.add(caja(r, 1.0, 0.7, 0.5, std(r, 0x1a222c, 0.6, 0.3), 0, FLOOR_Y + 0.6, -0.9));
  // mastil
  g.add(caja(r, 0.9, 3.4, 0.14, std(r, 0x1f2937, 0.5, 0.4), 0, FLOOR_Y + 1.7, 0.9));
  // techo protector
  g.add(caja(r, 1.1, 0.06, 1.4, std(r, 0x1f2937, 0.5, 0.4), 0, FLOOR_Y + 2.12, 0));
  return g;
}

export function construirActores(plano: PlanoCedi): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:actores';

  // Un par de montacargas en el pasillo transversal.
  grupo.add(montacargas(r, plano.puertas[6]!.x, -24, 0));
  grupo.add(montacargas(r, plano.puertas[18]!.x, -30, Math.PI));

  // Un camion acoplado a una puerta del centro.
  const camion = new THREE.Group();
  const px = plano.puertas[14]!.x;
  camion.position.set(px, 0, DOCKED_Z);
  camion.add(caja(r, 2.6, 2.9, 13.5, std(r, 0xf1f5f9, 0.5, 0.1, tiledTexture('trailer', 13.5, 2.9, 0.9)), 0, 2.65, -1.75));
  camion.add(caja(r, 1.9, 0.35, 16.6, std(r, 0x1f2937, 0.6, 0.3), 0, 0.95, 0));
  camion.add(caja(r, 2.5, 2.7, 2.4, std(r, 0x0ea5e9, 0.5, 0.35), 0, 2.35, 6.6));
  grupo.add(camion);

  return {
    grupo,
    dispose: () => r.dispose(),
  };
}
