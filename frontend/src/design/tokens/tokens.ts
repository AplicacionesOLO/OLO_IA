/**
 * Espejo en TypeScript de los tokens.
 *
 * Existe porque SVG y Canvas necesitan valores en JS: un `stroke` animado por
 * Framer Motion no puede resolver `var(--aqua-400)` de forma fiable en todos los
 * navegadores.
 *
 * Regla: este archivo se usa SOLO donde CSS no llega. En cualquier otro caso se
 * consume la variable CSS, que es la que responde al cambio de tema.
 */

export const palette = {
  /** El fondo. Azul-negro profundo, nunca negro plano. */
  abyss: {
    1000: '#020509',
    950: '#04080f',
    900: '#070d18',
    850: '#0a1322',
    800: '#0e1a2d',
    700: '#142339',
  },
  /** Estructura sutil. Se usa con opacidad baja, casi nunca como color solido. */
  slate: { 700: '#1c2a3f', 600: '#2a3a52', 500: '#3d5069' },
  /** Texto y contenido. */
  haze: {
    400: '#64748b',
    300: '#8494a8',
    200: '#a8b6c8',
    100: '#cbd5e1',
    50: '#e8eef7',
    0: '#ffffff',
  },
  /** Acento primario. Dato MEDIDO. */
  aqua: { 600: '#0aa2c7', 500: '#10c0e0', 400: '#22d9f5', 300: '#5ee7fb', 200: '#a3f2fe' },
  /** Estructura profunda: la Mesh, el suelo del Twin, rutas. */
  azure: { 700: '#1e4ed8', 600: '#2563eb', 500: '#3b82f6', 400: '#60a5fa' },
  /** Inteligencia. Dato INFERIDO por IA. */
  iris: { 600: '#7c3aed', 500: '#8b5cf6', 400: '#a78bfa', 300: '#c4b5fd' },
  /** Atencion. Escaso por diseño. */
  ember: { 600: '#ea8a04', 500: '#f59e0b', 400: '#fbbf24' },
  crimson: { 500: '#f04352', 400: '#fb7185' },
  mint: { 500: '#10d9a0', 400: '#34e5b4' },
} as const;

/** Los estados cognitivos del sistema. */
export const systemStateColor = {
  idle: palette.aqua[400],
  thinking: palette.iris[500],
  alert: palette.ember[500],
  critical: palette.crimson[500],
  offline: palette.slate[500],
} as const;

/** Naturaleza del dato. Regla de producto: cian mide, violeta infiere. */
export const dataNatureColor = {
  measured: palette.aqua[400],
  inferred: palette.iris[500],
  predicted: palette.iris[400],
  imported: palette.azure[500],
  manual: palette.haze[300],
} as const;

export const meshColor = {
  node: palette.aqua[400],
  edge: palette.azure[500],
  pulse: palette.aqua[300],
} as const;

export const twinColor = {
  structure: palette.aqua[400],
  floor: palette.azure[600],
  active: palette.aqua[300],
  route: palette.iris[400],
} as const;

export type SystemState = keyof typeof systemStateColor;
export type DataNature = keyof typeof dataNatureColor;
export type Freshness = 'live' | 'recent' | 'cooling' | 'historic' | 'stale';

export const freshnessOpacity: Record<Freshness, number> = {
  live: 1,
  recent: 1,
  cooling: 0.85,
  historic: 0.7,
  stale: 0.45,
};
