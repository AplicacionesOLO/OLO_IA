/**
 * GEOMETRIA DE GRAFICOS
 *
 * Matematica pura, sin React y sin dependencias. Se separa de los componentes
 * porque en Capa 2 los mismos calculos alimentaran un renderizador de Canvas:
 * la geometria es la fuente de verdad, el renderizador es intercambiable.
 *
 * ⚠ NADA aqui conoce el dominio. No hay "stock", "precision" ni "drones": solo
 * series de numeros. Es la regla de reutilizacion del sistema de diseño.
 */

export interface SeriesBox {
  width: number;
  height: number;
  /** Margen inferior reservado para que el trazo no toque el borde. */
  padY: number;
}

/**
 * Normaliza una serie a coordenadas de pantalla.
 *
 * El dominio vertical se calcula con un 12% de holgura sobre el rango real. Sin
 * holgura, el maximo de la serie toca el borde superior y el grafico parece
 * cortado.
 */
export function toPoints(
  values: readonly number[],
  box: SeriesBox,
): [number, number][] {
  if (values.length === 0) return [];
  if (values.length === 1) {
    return [[box.width / 2, box.height / 2]];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Serie plana: se dibuja a media altura en lugar de dividir por cero.
  const span = max - min || 1;
  const pad = span * 0.12;
  const lo = min - pad;
  const hi = max + pad;

  const usable = box.height - box.padY * 2;

  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * box.width;
    const y = box.padY + (1 - (v - lo) / (hi - lo)) * usable;
    return [x, y];
  });
}

/**
 * Path suavizado con Catmull-Rom convertido a Bezier cubica.
 *
 * Se usa esto y no `L` recto porque una serie temporal con esquinas duras se lee
 * como un grafico de instrumentacion tecnica. La curva suave es lo que hace que
 * el mismo dato se lea como analitica premium.
 *
 * La tension 0.5 es la Catmull-Rom estandar: sigue los puntos exactamente sin
 * producir los sobreimpulsos que aparecen con tensiones mayores.
 */
export function smoothPath(points: readonly [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${f(points[0]![0])},${f(points[0]![1])}`;

  let d = `M ${f(points[0]![0])},${f(points[0]![1])}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }

  return d;
}

/** Cierra un path de linea contra la base para poder rellenarlo. */
export function closeToBase(
  linePath: string,
  points: readonly [number, number][],
  baseY: number,
): string {
  if (points.length === 0) return '';
  const last = points[points.length - 1]!;
  const first = points[0]!;
  return `${linePath} L ${f(last[0])},${f(baseY)} L ${f(first[0])},${f(baseY)} Z`;
}

/** Arco de anillo, en sentido horario desde las 12. */
export function ringArc(
  cx: number,
  cy: number,
  r: number,
  fraction: number,
): string {
  const clamped = Math.min(0.9999, Math.max(0, fraction));
  const angle = clamped * Math.PI * 2 - Math.PI / 2;
  const x = cx + Math.cos(angle) * r;
  const y = cy + Math.sin(angle) * r;
  const largeArc = clamped > 0.5 ? 1 : 0;
  return `M ${f(cx)},${f(cy - r)} A ${f(r)},${f(r)} 0 ${largeArc} 1 ${f(x)},${f(y)}`;
}

function f(n: number): string {
  return n.toFixed(2);
}
