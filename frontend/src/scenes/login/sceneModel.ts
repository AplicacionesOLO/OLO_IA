/**
 * GEOMETRIA PROCEDURAL DE LA ESCENA DE LOGIN
 *
 * Todo se genera con codigo: cero texturas, cero modelos, cero peso de descarga.
 * Determinista, para que la escena sea identica en cada carga y las capturas de
 * pantalla reproducibles.
 *
 * Proyeccion isometrica calculada a mano en lugar de usar una libreria 3D: en
 * Capa 1 no hay WebGL, y para una escena de composicion fija la matematica cabe
 * en 20 lineas.
 */

const VB_W = 1600;
const VB_H = 900;

export const VIEWBOX = { width: VB_W, height: VB_H } as const;

/** Proyeccion isometrica: mundo (x, y, z) → pantalla (sx, sy). */
export function project(x: number, y: number, z: number): { sx: number; sy: number } {
  // 30 grados de inclinacion: el angulo isometrico clasico, legible y estable.
  const isoX = (x - y) * 0.866;
  const isoY = (x + y) * 0.5 - z;
  return { sx: VB_W / 2 + isoX, sy: VB_H * 0.52 + isoY };
}

export interface RackFace {
  id: string;
  /** Poligono ya proyectado. */
  points: string;
  /** 0..1 — profundidad para opacidad y grosor de linea. */
  depth: number;
  /** Cara superior, frontal o lateral. Cada una recibe distinta luz. */
  face: 'top' | 'front' | 'side';
}

export interface Rack {
  id: string;
  faces: RackFace[];
  depth: number;
  /** Centro proyectado, para colocar beacons. */
  center: { sx: number; sy: number };
}

/**
 * Genera la nave: filas de racks con pasillos.
 *
 * ~90 racks es el equilibrio: suficiente para transmitir escala, lo bastante
 * pocos para que SVG lo dibuje sin coste. En Capa 3 este mismo modelo alimenta
 * un InstancedMesh con 2000.
 */
export function generateWarehouse(): Rack[] {
  const racks: Rack[] = [];
  const rows = 6;
  const cols = 15;
  const cell = 46;
  const rackW = 34;
  const rackD = 16;
  const rackH = 38;
  const aisleEvery = 3;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      // Pasillos: se salta una fila cada 3 para que se lean corredores y no una
      // masa solida. Sin pasillos parece un bloque, no un almacen.
      if (r % aisleEvery === aisleEvery - 1) continue;

      const wx = (c - cols / 2) * cell;
      const wy = (r - rows / 2) * cell * 1.5;
      const h = rackH * (0.82 + ((r * 7 + c * 3) % 5) / 14);

      const p = (dx: number, dy: number, dz: number) => project(wx + dx, wy + dy, dz);

      const b = p(rackW, 0, 0);
      const cc = p(rackW, rackD, 0);
      const d = p(0, rackD, 0);
      const at = p(0, 0, h);
      const bt = p(rackW, 0, h);
      const ct = p(rackW, rackD, h);
      const dt = p(0, rackD, h);

      // Profundidad normalizada: los racks del fondo se atenuan.
      const depth = 1 - (r / rows) * 0.55 - Math.abs(c - cols / 2) / cols * 0.25;

      const fmt = (pts: { sx: number; sy: number }[]) =>
        pts.map((q) => `${q.sx.toFixed(1)},${q.sy.toFixed(1)}`).join(' ');

      racks.push({
        id: `r${r}-${c}`,
        depth: Math.max(0.15, depth),
        center: { sx: (at.sx + ct.sx) / 2, sy: (at.sy + ct.sy) / 2 },
        faces: [
          { id: `r${r}-${c}-top`, points: fmt([at, bt, ct, dt]), depth, face: 'top' },
          { id: `r${r}-${c}-front`, points: fmt([d, cc, ct, dt]), depth, face: 'front' },
          { id: `r${r}-${c}-side`, points: fmt([b, cc, ct, bt]), depth, face: 'side' },
        ],
      });
    }
  }

  // Se ordenan por profundidad de pantalla: en SVG no hay z-buffer, asi que el
  // orden de dibujado ES el orden de oclusion. Sin esto los racks del fondo se
  // pintan encima de los del frente.
  return racks.sort((p, q) => p.center.sy - q.center.sy);
}

export interface AgentPath {
  id: string;
  kind: 'drone' | 'agv';
  /** Path SVG cerrado por el que circula el agente. */
  d: string;
  /** Duracion de una vuelta completa, en segundos. */
  durationS: number;
  delayS: number;
}

/**
 * Trayectorias de drones y AGVs.
 *
 * Los drones vuelan alto (z elevado) y describen circuitos amplios; los AGVs se
 * mueven por los pasillos a nivel de suelo. La diferencia de altura y de
 * recorrido es lo que los hace distinguibles de un vistazo.
 */
export function generateAgentPaths(): AgentPath[] {
  const path = (pts: { sx: number; sy: number }[]) =>
    `M ${pts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' L ')} Z`;

  const droneRing = (radius: number, height: number, steps = 24) =>
    Array.from({ length: steps }, (_, i) => {
      const t = (i / steps) * Math.PI * 2;
      return project(Math.cos(t) * radius, Math.sin(t) * radius * 0.55, height);
    });

  const aisleRun = (rowOffset: number) => [
    project(-320, rowOffset, 4),
    project(320, rowOffset, 4),
    project(320, rowOffset + 30, 4),
    project(-320, rowOffset + 30, 4),
  ];

  return [
    { id: 'drone-1', kind: 'drone', d: path(droneRing(300, 150)), durationS: 26, delayS: 0 },
    { id: 'drone-2', kind: 'drone', d: path(droneRing(210, 190, 20)), durationS: 21, delayS: 3.5 },
    { id: 'drone-3', kind: 'drone', d: path(droneRing(370, 120, 28)), durationS: 34, delayS: 7 },
    { id: 'agv-1', kind: 'agv', d: path(aisleRun(-70)), durationS: 30, delayS: 1.5 },
    { id: 'agv-2', kind: 'agv', d: path(aisleRun(140)), durationS: 37, delayS: 5 },
  ];
}

/** Camaras fijas con su cono de escaneo. */
export interface ScanCone {
  id: string;
  origin: { sx: number; sy: number };
  /** Grados. */
  rotation: number;
  length: number;
  delayS: number;
}

export function generateScanCones(): ScanCone[] {
  const spots: { x: number; y: number; rot: number }[] = [
    { x: -420, y: -180, rot: 34 },
    { x: 420, y: -180, rot: 146 },
    { x: -420, y: 200, rot: -34 },
    { x: 420, y: 200, rot: 214 },
  ];

  return spots.map((s, i) => ({
    id: `cam-${i}`,
    origin: project(s.x, s.y, 210),
    rotation: s.rot,
    length: 250,
    delayS: i * 1.6,
  }));
}

/** Particulas ambientales: el "polvo de datos". */
export interface Particle {
  id: string;
  x: number;
  y: number;
  size: number;
  opacity: number;
  durationS: number;
  delayS: number;
  driftX: number;
}

export function generateParticles(count: number): Particle[] {
  // PRNG determinista para que las particulas no salten entre renders.
  let seed = 91237;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    x: rand() * 100,
    y: rand() * 100,
    size: 0.8 + rand() * 1.6,
    opacity: 0.12 + rand() * 0.3,
    durationS: 14 + rand() * 16,
    delayS: rand() * -30,
    driftX: (rand() - 0.5) * 40,
  }));
}
