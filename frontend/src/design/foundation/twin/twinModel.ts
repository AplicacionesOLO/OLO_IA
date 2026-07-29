/**
 * GEOMETRIA DEL GEMELO DIGITAL
 *
 * Proyeccion isometrica calculada a mano. Determinista: la misma entrada
 * produce la misma escena, asi que no hay parpadeo estructural entre renders.
 *
 * En Capa 5 este MISMO modelo alimentara un InstancedMesh de R3F con miles de
 * racks. La geometria es la fuente de verdad; el renderizador es intercambiable.
 */

export const TWIN_VB = { w: 1000, h: 620 } as const;

/** Isometrica: mundo (x, y, z) → pantalla. */
export function iso(x: number, y: number, z: number): [number, number] {
  return [
    TWIN_VB.w / 2 + (x - y) * 0.866,
    TWIN_VB.h * 0.56 + (x + y) * 0.5 - z,
  ];
}

const fmt = (pts: [number, number][]) =>
  pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export interface TwinBlock {
  id: string;
  /** Cara superior: la que recibe la luz. */
  top: string;
  /** Cara frontal izquierda. */
  left: string;
  /** Cara frontal derecha. */
  right: string;
  /** 0..1 — atenuacion por distancia. */
  depth: number;
  /** Ocupacion 0..1 — determina la intensidad de la luz que emite. */
  load: number;
  /** Centro de la cara superior, para colocar marcadores. */
  center: [number, number];
  /** Orden de dibujado: en SVG no hay z-buffer. */
  order: number;
}

/**
 * Genera bloques de estanteria con pasillos.
 *
 * `load` se deriva de una funcion determinista en lugar de aleatoria para que
 * la escena tenga zonas coherentes de alta y baja ocupacion, como un almacen
 * real, en lugar de ruido.
 */
export function buildTwinBlocks(): TwinBlock[] {
  const blocks: TwinBlock[] = [];
  const rows = 5;
  const cols = 9;
  const bw = 58;
  const bd = 34;
  const gapX = 82;
  const gapY = 74;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      // Pasillo central: se salta la columna del medio.
      if (c === 4) continue;

      const wx = (c - cols / 2) * gapX;
      const wy = (r - rows / 2) * gapY;

      // Ocupacion coherente por zonas: dos ondas superpuestas.
      const load = Math.min(
        1,
        Math.max(
          0.12,
          0.5 + 0.34 * Math.sin(c * 0.72 + r * 0.5) + 0.18 * Math.cos(r * 1.3 - c * 0.4),
        ),
      );

      const h = 26 + load * 46;

      const p = (dx: number, dy: number, dz: number) => iso(wx + dx, wy + dy, dz);

      // b0 (esquina inferior trasera) no se dibuja: queda oculta por el
      // propio bloque en proyección isométrica. Se omite en lugar de calcularla
      // para que `noUnusedLocals` no falle el build.
      const b1 = p(bw, 0, 0);
      const b2 = p(bw, bd, 0);
      const b3 = p(0, bd, 0);
      const t0 = p(0, 0, h);
      const t1 = p(bw, 0, h);
      const t2 = p(bw, bd, h);
      const t3 = p(0, bd, h);

      const depth = Math.max(
        0.2,
        1 - (r / rows) * 0.42 - (Math.abs(c - cols / 2) / cols) * 0.3,
      );

      blocks.push({
        id: `b${r}-${c}`,
        top: fmt([t0, t1, t2, t3]),
        left: fmt([b3, b2, t2, t3]),
        right: fmt([b1, b2, t2, t1]),
        depth,
        load,
        center: [(t0[0] + t2[0]) / 2, (t0[1] + t2[1]) / 2],
        order: b2[1],
      });
    }
  }

  // El orden de dibujado ES el orden de oclusion.
  return blocks.sort((a, b) => a.order - b.order);
}

/** El suelo: rejilla luminosa que ancla la escena. */
export function buildTwinFloor(): { d: string; opacity: number }[] {
  const lines: { d: string; opacity: number }[] = [];
  const ext = 420;
  const step = 74;

  for (let i = -5; i <= 5; i += 1) {
    const a = iso(i * step, -ext, 0);
    const b = iso(i * step, ext, 0);
    lines.push({
      d: `M ${a[0].toFixed(1)},${a[1].toFixed(1)} L ${b[0].toFixed(1)},${b[1].toFixed(1)}`,
      opacity: 0.16 - Math.abs(i) * 0.02,
    });

    const c = iso(-ext, i * step, 0);
    const d = iso(ext, i * step, 0);
    lines.push({
      d: `M ${c[0].toFixed(1)},${c[1].toFixed(1)} L ${d[0].toFixed(1)},${d[1].toFixed(1)}`,
      opacity: 0.16 - Math.abs(i) * 0.02,
    });
  }

  return lines;
}

/** Rutas de AGV: recorridos luminosos por los pasillos. */
export function buildTwinRoutes(): { id: string; d: string; durS: number; delayS: number }[] {
  const route = (pts: [number, number, number][]) =>
    `M ${pts.map(([x, y, z]) => iso(x, y, z).map((n) => n.toFixed(1)).join(',')).join(' L ')}`;

  return [
    {
      id: 'r1',
      d: route([
        [-330, -160, 2],
        [10, -160, 2],
        [10, 150, 2],
        [330, 150, 2],
      ]),
      durS: 9,
      delayS: 0,
    },
    {
      id: 'r2',
      d: route([
        [330, -180, 2],
        [10, -180, 2],
        [10, 40, 2],
        [-330, 40, 2],
      ]),
      durS: 11,
      delayS: 2.4,
    },
    {
      id: 'r3',
      d: route([
        [-300, 180, 2],
        [10, 180, 2],
        [10, -110, 2],
        [300, -110, 2],
      ]),
      durS: 13,
      delayS: 5,
    },
  ];
}

/** Nodos de interes: drones en vuelo y puntos de actividad. */
export interface TwinMarker {
  id: string;
  pos: [number, number];
  kind: 'drone' | 'activity' | 'alert';
  label?: string;
}

export function buildTwinMarkers(): TwinMarker[] {
  return [
    { id: 'd1', pos: iso(-190, -70, 190), kind: 'drone', label: 'AI-B7' },
    { id: 'd2', pos: iso(210, 60, 165), kind: 'drone', label: 'AI-C2' },
    { id: 'a1', pos: iso(-60, 130, 70), kind: 'activity' },
    { id: 'a2', pos: iso(280, -140, 60), kind: 'activity' },
    { id: 'x1', pos: iso(120, -30, 82), kind: 'alert', label: 'B-14' },
  ];
}
