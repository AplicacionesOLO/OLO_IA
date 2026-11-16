/**
 * UTILIDADES COMUNES de los constructores del CEDI.
 *
 * Cada zona (`sitio`, `edificio`, `racks`, …) devuelve un `ZonaCedi`: un `THREE.Group` y su
 * `dispose()`. El `Recolector` es lo que hace el `dispose()` fiable sin tener que acordarse de
 * cada geometria y material uno a uno — un contexto WebGL no los recoge solo, y cambiar de vista
 * veinte veces sin liberar deja la memoria de video llena y la pantalla en negro sin aviso.
 */

import * as THREE from 'three';

/** Una zona del CEDI: su grupo y como liberarla. */
export interface ZonaCedi {
  grupo: THREE.Group;
  dispose: () => void;
  /** Opcional: llamado cada cuadro con el delta y la camara (animaciones, LOD). */
  actualizar?: (dt: number, camara: THREE.Camera) => void;
}

/**
 * Junta geometrias y materiales para liberarlos de golpe. Devuelve lo que registra, asi se
 * encadena: `const m = r.mat(new THREE.MeshStandardMaterial(...))`.
 */
export class Recolector {
  private readonly geos = new Set<THREE.BufferGeometry>();
  private readonly mats = new Set<THREE.Material>();
  private readonly texs = new Set<THREE.Texture>();

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.add(g);
    return g;
  }

  mat<T extends THREE.Material>(m: T): T {
    this.mats.add(m);
    return m;
  }

  tex<T extends THREE.Texture>(t: T): T {
    this.texs.add(t);
    return t;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.clear();
    this.mats.clear();
    this.texs.clear();
  }
}

/** PRNG determinista del documento (§4): la escena no cambia entre recargas. */
export function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Una caja apoyada por su centro. `y` es el centro vertical. */
export function caja(
  r: Recolector,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(r.geo(new THREE.BoxGeometry(w, h, d)), material);
  m.position.set(x, y, z);
  return m;
}

/** Un plano horizontal (suelo) a la altura `y`, centrado en (x, z), con textura ya repetida. */
export function piso(
  r: Recolector,
  w: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(r.geo(new THREE.PlaneGeometry(w, d)), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/**
 * Un plano con un texto dibujado en canvas. Se usa para los numeros de puerta y los rotulos.
 *
 * Va CONTRA-REFLEJADO (`scale.x = −1`) por fuera, porque el grupo raiz del CEDI lleva
 * `scale(-1,1,1)` y sin esto el texto se leeria al reves.
 */
export function cartelTexto(
  r: Recolector,
  opciones: {
    ancho: number;
    alto: number;
    px: number;
    pz: number;
    py: number;
    texto: string;
    colorTexto: string;
    fondo?: string | null;
    contorno?: string | null;
    rotY?: number;
    tamFuente?: number;
  },
): THREE.Mesh {
  const { ancho, alto, texto, colorTexto, fondo = null, contorno = null, rotY = 0 } = opciones;
  const W = 512;
  const H = Math.round((W * alto) / ancho);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (fondo) {
    g.fillStyle = fondo;
    g.fillRect(0, 0, W, H);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fuente = opciones.tamFuente ?? Math.round(H * 0.6);
  g.font = `bold ${fuente}px Arial, sans-serif`;
  if (contorno) {
    g.strokeStyle = contorno;
    g.lineWidth = Math.max(2, fuente * 0.07);
    g.strokeText(texto, W / 2, H / 2);
  }
  g.fillStyle = colorTexto;
  g.fillText(texto, W / 2, H / 2);

  const tex = r.tex(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = r.mat(
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  const m = new THREE.Mesh(r.geo(new THREE.PlaneGeometry(ancho, alto)), mat);
  m.position.set(opciones.px, opciones.py, opciones.pz);
  m.rotation.y = rotY;
  //  Contra-reflejo: el grupo raiz invierte x, asi que el texto se endereza aqui.
  m.scale.x = -1;
  return m;
}

/** Libera un objeto GLB/mesh entero (geometrias y materiales de todos sus hijos). */
export function disposeObjeto(obj: THREE.Object3D): void {
  obj.traverse((h) => {
    const malla = h as THREE.Mesh;
    malla.geometry?.dispose?.();
    const mat = malla.material;
    for (const m of Array.isArray(mat) ? mat : [mat]) m?.dispose?.();
  });
}
