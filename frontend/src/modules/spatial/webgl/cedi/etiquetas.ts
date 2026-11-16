/**
 * ETIQUETAS DEL ACOMODO (§6.5): que rack y que columna es cada uno.
 *
 * ── QUE ROTULA Y CON QUE NOMBRES ────────────────────────────────────────────────
 *
 * La MISMA nomenclatura que usan las vistas 2D / 3D / 3D+ y las etiquetas fisicas del almacen
 * (ver `perception/codigos.ts`): un slot completo es `RCL51-C020-N01-2` —rack · columna · nivel ·
 * posicion—. Aqui se rotula hasta la COLUMNA, que es lo que se lee a escala de nave:
 *
 *   · Rack (fila/modulo): su codigo `RCL{a} · {b}`, coloreado por categoria.
 *   · Columna: `C001 … C028`, el `filaColNumber` de cada columna de la grilla.
 *   · Cantilever: `CANT C1A · C1B`.
 *   · Zonas a piso: su nombre (PISO, AZF).
 *   · Nivel (N01…N07) y posicion (1/2): solo al ACERCARSE mucho (LOD), para no llenar la nave
 *     de ~30.000 carteles ilegibles de lejos. El nivel va a su altura real; la posicion marca
 *     el doble fondo (1 = cara de pasillo, 2 = fondo). Asi se arma el codigo `RCL51-C020-N01-2`.
 *
 * ── POR QUE FUERA DEL GRUPO ESPEJO ──────────────────────────────────────────────
 *
 * El contexto del CEDI vive en un grupo con `scale(-1,1,1)`; un texto ahi dentro saldria al
 * reves y habria que contra-reflejarlo. Las etiquetas son `THREE.Sprite` (miran siempre a la
 * camara), y un sprite en un grupo con escala negativa sale reflejado. Por eso este grupo NO se
 * refleja: se colocan las etiquetas en coordenadas de MUNDO (x logico negado), de modo que caen
 * justo sobre su pieza del grupo espejo sin ningun truco de reflejo.
 *
 * ── RENDIMIENTO (§13) ───────────────────────────────────────────────────────────
 *
 * Los numeros de columna se repiten en las 38 filas, asi que sus texturas se COMPARTEN: hay una
 * textura por numero (C001…C032), no una por cartel. Y `actualizar(camara)` hace LOD: escala los
 * sprites para que midan casi lo mismo en pantalla y OCULTA los de columna cuando la fila esta
 * lejos, que es cuando solo estorban.
 */

import * as THREE from 'three';

import { FLOOR_Y } from './constantes';
import {
  RACK_CATS,
  cantCode,
  colZ,
  filaColNumber,
  type PlacedFila,
  type RackLayout,
} from './plano';
import { LEVELS } from './racks';
import { Recolector } from './comun';

/** Altura (y) a la que flotan las etiquetas: sobre la coronacion de los racks. */
const Y_ETIQUETA = FLOOR_Y + 9.6;
/** Distancia (m) de la camara a partir de la cual se ocultan los numeros de columna. */
const LOD_COLUMNA = 70;
/** Distancia (m) para el detalle fino —nivel (N0x) y posicion (1/2)—: solo muy de cerca. */
const LOD_NIVEL = 26;
/** Siempre visible (sin LOD). */
const SIEMPRE = Infinity;
/** Factor de tamano en pantalla: alto en mundo ≈ distancia × esto, acotado. */
const TAM = 0.05;
const TAM_MIN = 0.7;
const TAM_MAX = 4.5;

interface Marca {
  sprite: THREE.Sprite;
  /** Ancho/alto de la textura, para no deformar al escalar. */
  aspecto: number;
  /** Tamano relativo (los numeros de columna son mas pequenos que el codigo del rack). */
  escala: number;
  /** Distancia (m) a partir de la cual se oculta; `Infinity` = siempre visible. */
  lodDist: number;
}

export interface Etiquetas {
  grupo: THREE.Group;
  /** LOD y tamano constante en pantalla. */
  actualizar: (camara: THREE.Camera) => void;
  setVisible: (on: boolean) => void;
  dispose: () => void;
}

/** Dibuja el texto en un canvas ajustado y devuelve textura + aspecto. */
function texturaTexto(
  r: Recolector,
  texto: string,
  colorTexto: string,
  fondo: string | null,
): { tex: THREE.CanvasTexture; aspecto: number } {
  const H = 128;
  const pad = 26;
  const medir = document.createElement('canvas').getContext('2d')!;
  const fuente = Math.round(H * 0.56);
  medir.font = `bold ${fuente}px Arial, sans-serif`;
  const W = Math.ceil(medir.measureText(texto).width) + pad * 2;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (fondo) {
    g.fillStyle = fondo;
    const rr = 22;
    g.beginPath();
    g.moveTo(rr, 0);
    g.arcTo(W, 0, W, H, rr);
    g.arcTo(W, H, 0, H, rr);
    g.arcTo(0, H, 0, 0, rr);
    g.arcTo(0, 0, W, 0, rr);
    g.closePath();
    g.fill();
  }
  g.font = `bold ${fuente}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = Math.max(3, fuente * 0.14);
  g.strokeStyle = fondo ? 'rgba(0,0,0,0.25)' : 'rgba(8,12,20,0.9)';
  g.strokeText(texto, W / 2, H / 2 + 2);
  g.fillStyle = colorTexto;
  g.fillText(texto, W / 2, H / 2 + 2);

  const tex = r.tex(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspecto: W / H };
}

export function construirEtiquetas(plan: RackLayout): Etiquetas {
  const r = new Recolector();
  const grupo = new THREE.Group();
  grupo.name = 'cedi:etiquetas';

  const marcas: Marca[] = [];

  /**
   * Un sprite ya colocado (en coordenadas de MUNDO: x logico negado). `y` por defecto flota
   * sobre la coronacion; el detalle de nivel va a su altura real.
   */
  const poner = (
    material: THREE.SpriteMaterial,
    aspecto: number,
    xLogico: number,
    z: number,
    escala: number,
    lodDist: number,
    y: number = Y_ETIQUETA,
  ): void => {
    const sprite = new THREE.Sprite(material);
    sprite.position.set(-xLogico, y, z);
    sprite.renderOrder = 10;
    grupo.add(sprite);
    marcas.push({ sprite, aspecto, escala, lodDist });
  };

  /** Material propio (textura unica) para un rotulo. */
  const matUnico = (texto: string, color: string, fondo: string | null): {
    mat: THREE.SpriteMaterial;
    aspecto: number;
  } => {
    const { tex, aspecto } = texturaTexto(r, texto, color, fondo);
    const mat = r.mat(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
    );
    return { mat, aspecto };
  };

  // ── Codigo de cada rack (fila) ──────────────────────────────────────────────────
  const centroZ = (f: PlacedFila): number => (colZ(plan, f.from) + colZ(plan, f.to + 1)) / 2;
  for (const f of plan.filas) {
    const cat = f.cat ? RACK_CATS[f.cat] : null;
    const color = cat?.ink ?? '#e5edff';
    const fondo = cat?.color ?? '#1e293b';
    const { mat, aspecto } = matUnico(f.code, color, fondo);
    poner(mat, aspecto, (f.x0 + f.x1) / 2, centroZ(f), 1, SIEMPRE);
  }

  // ── Numeros de columna, con texturas COMPARTIDAS por numero ──────────────────────
  const matColumna = new Map<number, { mat: THREE.SpriteMaterial; aspecto: number }>();
  const columna = (n: number): { mat: THREE.SpriteMaterial; aspecto: number } => {
    let m = matColumna.get(n);
    if (!m) {
      m = matUnico(`C${String(n).padStart(3, '0')}`, '#dbeafe', 'rgba(15,23,42,0.82)');
      matColumna.set(n, m);
    }
    return m;
  };
  for (const f of plan.filas) {
    const xc = (f.x0 + f.x1) / 2;
    for (let c = f.from; c <= f.to; c += 1) {
      const n = filaColNumber(f, c);
      const { mat, aspecto } = columna(n);
      poner(mat, aspecto, xc, colZ(plan, c) + plan.col / 2, 0.62, LOD_COLUMNA);
    }
  }

  // ── Nivel (N01…N07) y posicion (1/2), texturas COMPARTIDAS; solo muy de cerca ──────
  // El nivel se rotula a su ALTURA real, en el arranque de la fila; la posicion (doble fondo:
  // 1 = cara de pasillo en x0, 2 = fondo en x1) a ras de la primera columna.
  const matNivel = new Map<number, { mat: THREE.SpriteMaterial; aspecto: number }>();
  const nivel = (n: number): { mat: THREE.SpriteMaterial; aspecto: number } => {
    let m = matNivel.get(n);
    if (!m) {
      m = matUnico(`N${String(n).padStart(2, '0')}`, '#ecfccb', 'rgba(22,34,10,0.82)');
      matNivel.set(n, m);
    }
    return m;
  };
  const pos1 = matUnico('1', '#fef9c3', 'rgba(60,45,5,0.85)');
  const pos2 = matUnico('2', '#fef9c3', 'rgba(60,45,5,0.85)');
  for (const f of plan.filas) {
    const zIni = colZ(plan, f.from) + plan.col / 2;
    // Pila de niveles a la altura real, al inicio de la fila.
    for (let i = 0; i < LEVELS.length; i += 1) {
      const { mat, aspecto } = nivel(i + 1);
      poner(mat, aspecto, (f.x0 + f.x1) / 2, zIni, 0.42, LOD_NIVEL, FLOOR_Y + LEVELS[i]! + 0.55);
    }
    // Posicion: las dos caras del doble fondo, a ras de suelo.
    poner(pos1.mat, pos1.aspecto, f.x0 + 0.05, zIni, 0.42, LOD_NIVEL, FLOOR_Y + 0.4);
    poner(pos2.mat, pos2.aspecto, f.x1 - 0.05, zIni, 0.42, LOD_NIVEL, FLOOR_Y + 0.4);
  }

  // ── Cantilever ──────────────────────────────────────────────────────────────────
  for (const cant of plan.cants) {
    const { mat, aspecto } = matUnico(cantCode(cant.name), '#fff7ed', '#b45309');
    poner(mat, aspecto, cant.x, (colZ(plan, cant.from) + colZ(plan, cant.to + 1)) / 2, 1, SIEMPRE);
  }

  // ── Zonas a piso (PISO, AZF) ──────────────────────────────────────────────────────
  for (const fl of plan.floors) {
    const cat = fl.cat ? RACK_CATS[fl.cat] : null;
    const { mat, aspecto } = matUnico(fl.label, cat?.ink ?? '#f8fafc', cat?.color ?? '#334155');
    for (const b of fl.boxes) {
      poner(mat, aspecto, (b.x0 + b.x1) / 2, (colZ(plan, b.from) + colZ(plan, b.to + 1)) / 2, 1, SIEMPRE);
    }
  }

  const posSprite = new THREE.Vector3();
  const posCam = new THREE.Vector3();

  return {
    grupo,
    actualizar: (camara) => {
      if (!grupo.visible) return;
      camara.getWorldPosition(posCam);
      for (const m of marcas) {
        m.sprite.getWorldPosition(posSprite);
        const dist = posSprite.distanceTo(posCam);
        // Columnas al acercarse, nivel/posicion solo muy de cerca; de lejos solo estorban.
        const visible = dist < m.lodDist;
        m.sprite.visible = visible;
        if (!visible) continue;
        const alto = Math.min(TAM_MAX, Math.max(TAM_MIN, dist * TAM)) * m.escala;
        m.sprite.scale.set(alto * m.aspecto, alto, 1);
      }
    },
    setVisible: (on) => {
      grupo.visible = on;
    },
    dispose: () => r.dispose(),
  };
}
