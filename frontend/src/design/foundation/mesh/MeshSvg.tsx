/**
 * MESH — RENDERIZADOR DE CAPA 1 (SVG)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISIONES DE RENDIMIENTO
 *
 * 1. CERO animaciones de Framer Motion por nodo. Con 68 nodos serian 68
 *    animaciones simultaneas, muy por encima del presupuesto de 24. En su lugar
 *    la respiracion se hace con CSS que lee `--ambient-breath`, publicada por el
 *    reloj unico. Coste: 0 re-renders, 0 animaciones registradas.
 *
 * 2. La geometria se calcula UNA vez con useMemo. Es determinista, asi que no
 *    cambia entre renders y no produce parpadeo estructural.
 *
 * 3. Los pulsos SI usan Framer Motion, porque son pocos (maximo 6) y
 *    representan eventos reales que merecen movimiento explicito.
 *
 * 4. `vectorEffect="non-scaling-stroke"` mantiene el grosor de linea constante
 *    aunque el SVG escale con el viewport.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { buildMesh } from './meshModel';
import type { MeshEdge, MeshNode, MeshRendererProps } from './types';
import { cn } from '../../utils/cn';

/** Maximo de pulsos simultaneos. El resto se descarta en el orquestador. */
const MAX_VISIBLE_PULSES = 6;

const PULSE_COLOR = {
  measured: 'var(--mesh-pulse)',
  inferred: 'var(--data-inferred)',
  alert: 'var(--state-alert)',
} as const;

function MeshSvgImpl({
  density,
  opacity,
  nodes: externalNodes,
  edges: externalEdges,
  pulses = [],
  reducedMotion = false,
  className,
}: MeshRendererProps) {
  const geometry = useMemo(() => {
    if (externalNodes && externalEdges) {
      return { nodes: externalNodes, edges: externalEdges };
    }
    return buildMesh(density);
  }, [density, externalNodes, externalEdges]);

  // Indice para resolver aristas → coordenadas sin recorrer el array por arista.
  const nodeById = useMemo(() => {
    const map = new Map<string, MeshNode>();
    for (const n of geometry.nodes) map.set(n.id, n);
    return map;
  }, [geometry.nodes]);

  const visiblePulses = pulses.slice(0, MAX_VISIBLE_PULSES);

  return (
    <svg
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      viewBox="0 0 1000 562"
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity }}
    >
      <defs>
        {/* Difuminado de los nodos: es lo que les da presencia luminosa en
            lugar de parecer puntos planos. stdDeviation baja para no disparar
            el coste del filtro. */}
        <filter id="olo-mesh-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <radialGradient id="olo-mesh-node-fill">
          <stop offset="0%" stopColor="var(--mesh-node)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--mesh-node)" stopOpacity="0.25" />
        </radialGradient>
      </defs>

      {/* ── ARISTAS ────────────────────────────────────────────────────────
          Se dibujan primero para quedar por debajo de los nodos. */}
      <g stroke="var(--mesh-edge)" fill="none">
        {geometry.edges.map((edge) => {
          const a = nodeById.get(edge.from);
          const b = nodeById.get(edge.to);
          if (!a || !b) return null;

          return (
            <line
              key={edge.id}
              x1={a.x * 1000}
              y1={a.y * 562}
              x2={b.x * 1000}
              y2={b.y * 562}
              strokeWidth={0.4 + edge.strength * 0.5}
              strokeOpacity={0.08 + edge.strength * 0.16}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      {/* ── NODOS ──────────────────────────────────────────────────────────
          La respiracion es CSS puro leyendo --ambient-breath. Cada nodo tiene
          su propio desfase para que la malla no lata como un bloque, lo que
          pareceria un unico objeto en lugar de una red. */}
      <g className={reducedMotion ? undefined : 'olo-mesh-nodes'}>
        {geometry.nodes.map((node, i) => {
          const r = (1.6 + node.depth * 1.5) * (node.weight ?? 1);
          const baseOpacity = 0.2 + node.depth * 0.55;

          return (
            <circle
              key={node.id}
              cx={node.x * 1000}
              cy={node.y * 562}
              r={r}
              fill="url(#olo-mesh-node-fill)"
              filter={node.depth > 0.55 ? 'url(#olo-mesh-glow)' : undefined}
              style={
                {
                  '--node-opacity': baseOpacity,
                  // Desfase determinista derivado del indice
                  '--node-phase': (i % 7) / 7,
                } as React.CSSProperties
              }
            />
          );
        })}
      </g>

      {/* ── PULSOS ─────────────────────────────────────────────────────────
          Un evento real recorriendo una arista. Este SI merece Framer Motion:
          son pocos y su movimiento es informacion. */}
      {!reducedMotion &&
        visiblePulses.map((pulse) => {
          const edge = geometry.edges.find((e: MeshEdge) => e.id === pulse.edgeId);
          if (!edge) return null;
          const a = nodeById.get(edge.from);
          const b = nodeById.get(edge.to);
          if (!a || !b) return null;

          return (
            <motion.circle
              key={pulse.id}
              r={2.2}
              fill={PULSE_COLOR[pulse.nature]}
              filter="url(#olo-mesh-glow)"
              initial={{ cx: a.x * 1000, cy: a.y * 562, opacity: 0 }}
              animate={{
                cx: b.x * 1000,
                cy: b.y * 562,
                opacity: [0, 1, 1, 0],
              }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1], times: [0, 0.15, 0.8, 1] }}
            />
          );
        })}
    </svg>
  );
}

/**
 * `memo` es importante: la Mesh se monta en el shell y no debe re-renderizarse
 * cuando cambia cualquier cosa del arbol superior.
 */
export const MeshSvg = memo(MeshSvgImpl);
