/**
 * RACKS PROPIOS DEL CEDI (§6): estructura, cantilever y zonas a piso.
 *
 * ── CUANDO SE DIBUJAN ─────────────────────────────────────────────────────────
 *
 * Es el acomodo doble fondo del «Mapa mezzanine N2» (Excel de operaciones), transcrito en
 * `plano.ts`. Se construye SIEMPRE y en `/twin` se muestra JUNTO al catalogo del WMS —que vive
 * en el dominio, fuera del grupo reflejado— para poder comparar el acomodo planificado con lo
 * que hay en inventario. Su visibilidad se conmuta desde el pie del visor (`setRacksVisible`);
 * tambien sirve para validar el plano contra el anexo B cuando el almacen aun no tiene catalogo.
 *
 * ── RENDIMIENTO (§13.1) ───────────────────────────────────────────────────────
 *
 * Un `InstancedMesh` por tipo de pieza (postes, vigas), con `setColorAt` para Zona Franca. El
 * rayo no los toca: son decoracion a esta escala.
 */

import * as THREE from 'three';

import { FLOOR_Y } from './constantes';
import { colZ, type PlacedFila, type RackLayout } from './plano';
import { Recolector, caja, type ZonaCedi } from './comun';

/** Niveles N01…N07 sobre la losa (§6.3). */
export const LEVELS = [0, 1.3, 2.6, 3.9, 5.2, 6.5, 7.8];
const POSTE_H = 9.2;

const COLOR_POSTE = 0x1d4ed8;
const COLOR_POSTE_ZF = 0xf1f5f9;
const COLOR_VIGA = 0xf97316;
const COLOR_VIGA_ZF = 0xe2e8f0;

export function construirRacks(plan: RackLayout): ZonaCedi {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:racks';

  // Reunir matrices y colores de todas las filas.
  const postes: { m: THREE.Matrix4; zf: boolean }[] = [];
  const vigas: { m: THREE.Matrix4; zf: boolean }[] = [];

  const addFila = (f: PlacedFila): void => {
    const xs = [f.x0 + 0.05, (f.x0 + f.x1) / 2, f.x1 - 0.05];
    // Postes: en cada borde de columna (from..to+1), en las 3 x.
    for (let c = f.from; c <= f.to + 1; c += 1) {
      const z = colZ(plan, c);
      for (const x of xs) {
        postes.push({
          m: new THREE.Matrix4().compose(
            new THREE.Vector3(x, FLOOR_Y + POSTE_H / 2, z),
            new THREE.Quaternion(),
            new THREE.Vector3(0.09, POSTE_H, 0.09),
          ),
          zf: f.white,
        });
      }
    }
    // Vigas: por nivel (> N01) y por columna, a lo largo de z, en las 3 x.
    for (let c = f.from; c <= f.to; c += 1) {
      const zc = colZ(plan, c) + plan.col / 2;
      for (let n = 1; n < LEVELS.length; n += 1) {
        const y = FLOOR_Y + LEVELS[n]! - 0.08;
        for (const x of xs) {
          vigas.push({
            m: new THREE.Matrix4().compose(
              new THREE.Vector3(x, y, zc),
              new THREE.Quaternion(),
              new THREE.Vector3(0.06, 0.12, plan.col),
            ),
            zf: f.white,
          });
        }
      }
    }
  };

  for (const f of plan.filas) addFila(f);

  const instanciar = (
    datos: { m: THREE.Matrix4; zf: boolean }[],
    geo: THREE.BufferGeometry,
    base: number,
    zf: number,
  ): void => {
    if (datos.length === 0) return;
    const mat = r.mat(new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 }));
    const malla = new THREE.InstancedMesh(r.geo(geo), mat, datos.length);
    const col = new THREE.Color();
    datos.forEach((d, i) => {
      malla.setMatrixAt(i, d.m);
      malla.setColorAt(i, col.set(d.zf ? zf : base));
    });
    malla.instanceMatrix.needsUpdate = true;
    malla.computeBoundingSphere();
    malla.raycast = () => {};
    grupo.add(malla);
  };

  instanciar(postes, new THREE.BoxGeometry(1, 1, 1), COLOR_POSTE, COLOR_POSTE_ZF);
  instanciar(vigas, new THREE.BoxGeometry(1, 1, 1), COLOR_VIGA, COLOR_VIGA_ZF);

  // ── Cantilever (§6.6): columnas + brazos ──────────────────────────────────────
  const matCant = r.mat(new THREE.MeshStandardMaterial({ color: 0x1e2a5a, roughness: 0.6, metalness: 0.3 }));
  const matBrazo = r.mat(new THREE.MeshStandardMaterial({ color: 0xe2501c, roughness: 0.6, metalness: 0.3 }));
  for (const cant of plan.cants) {
    for (let c = cant.from; c <= cant.to; c += 1) {
      const z = colZ(plan, c);
      grupo.add(caja(r, 0.26, 8.6, 0.3, matCant, cant.x, FLOOR_Y + 4.3, z));
      for (let n = 0; n < 9; n += 1) {
        const y = FLOOR_Y + 0.35 + n * 0.95;
        grupo.add(caja(r, 1.15, 0.13, 0.14, matBrazo, cant.x - 0.7, y, z));
        grupo.add(caja(r, 1.15, 0.13, 0.14, matBrazo, cant.x + 0.7, y, z));
      }
    }
  }

  // ── Zonas a piso (§6.7): bordes amarillos ─────────────────────────────────────
  const matBorde = r.mat(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  for (const fl of plan.floors) {
    for (const b of fl.boxes) {
      const z0 = colZ(plan, b.from);
      const z1 = colZ(plan, b.to + 1);
      // Dibujar el borde como 4 tiras finas en el piso.
      const tira = (w: number, d: number, x: number, z: number): void => {
        grupo.add(caja(r, w, 0.02, d, matBorde, x, FLOOR_Y + 0.02, z));
      };
      tira(b.x1 - b.x0, 0.12, (b.x0 + b.x1) / 2, z0);
      tira(b.x1 - b.x0, 0.12, (b.x0 + b.x1) / 2, z1);
      tira(0.12, z1 - z0, b.x0, (z0 + z1) / 2);
      tira(0.12, z1 - z0, b.x1, (z0 + z1) / 2);
    }
  }

  return {
    grupo,
    dispose: () => r.dispose(),
  };
}
