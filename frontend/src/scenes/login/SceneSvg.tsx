/**
 * ESCENA DE LOGIN — RENDERIZADOR DE CAPA 1 (SVG)
 *
 * Un almacen gigantesco visto en isometrica: racks, drones en patrulla, AGVs,
 * conos de escaneo, particulas. Todo procedural, todo SVG, cero WebGL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RENDIMIENTO
 *
 * · ~90 racks x 3 caras = 270 poligonos estaticos. SVG los dibuja sin esfuerzo.
 * · Los agentes usan `animateMotion` de SMIL, no Framer Motion: el navegador lo
 *   ejecuta en el compositor sin pasar por JavaScript. 5 agentes = 0 coste de
 *   hilo principal.
 * · La materializacion usa una sola animacion de opacidad sobre un grupo, no
 *   una por rack.
 * · Las particulas son CSS.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  VIEWBOX,
  generateAgentPaths,
  generateScanCones,
  generateWarehouse,
} from './sceneModel';
import type { SceneTiming } from './timeline';
import { easing } from '../../design/motion/easing';

interface SceneSvgProps {
  timing: SceneTiming;
  reducedMotion: boolean;
}

const FACE_FILL = {
  top: 'rgb(34 217 245 / 0.16)',
  front: 'rgb(59 130 246 / 0.07)',
  side: 'rgb(2 5 9 / 0.6)',
} as const;

function SceneSvgImpl({ timing, reducedMotion }: SceneSvgProps) {
  const racks = useMemo(generateWarehouse, []);
  const agents = useMemo(generateAgentPaths, []);
  const cones = useMemo(generateScanCones, []);

  const dur = (s: number) => (reducedMotion ? 0 : s);

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="olo-scene-core" cx="50%" cy="50%">
          <stop offset="0%" stopColor="var(--aqua-200)" stopOpacity="1" />
          <stop offset="45%" stopColor="var(--aqua-400)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--aqua-400)" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="olo-scene-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--aqua-300)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--aqua-300)" stopOpacity="0" />
        </linearGradient>

        <filter id="olo-scene-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" />
        </filter>

        {/* Los agentes se dibujan con una referencia al path para que
            animateMotion pueda seguirlo. */}
        {agents.map((a) => (
          <path key={`${a.id}-def`} id={`olo-path-${a.id}`} d={a.d} />
        ))}
      </defs>

      {/* ── LA NAVE ──────────────────────────────────────────────────────
          Un solo grupo con una sola animacion: la camara retrocede (scale) y
          los racks se materializan (opacity). 2 propiedades animadas para 270
          poligonos. */}
      <motion.g
        initial={{ opacity: 0, scale: 1.35 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          opacity: { duration: dur(1.6), delay: dur(timing.materialize), ease: easing.glide },
          scale: { duration: dur(2.4), delay: dur(timing.reveal), ease: easing.cinematic },
        }}
        style={{ transformOrigin: 'center' }}
      >
        {racks.map((rack) => (
          <g key={rack.id} opacity={rack.depth}>
            {rack.faces.map((face) => (
              <polygon
                key={face.id}
                points={face.points}
                fill={FACE_FILL[face.face]}
                stroke="var(--aqua-400)"
                strokeOpacity={face.face === 'top' ? 0.34 : 0.16}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ))}
      </motion.g>

      {/* ── CONOS DE ESCANEO ─────────────────────────────────────────────
          Camaras fijas barriendo. La rotacion es SMIL: coste nulo. */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: dur(1.2), delay: dur(timing.agents) }}
      >
        {cones.map((cone) => (
          <g key={cone.id} transform={`translate(${cone.origin.sx} ${cone.origin.sy})`}>
            <g transform={`rotate(${cone.rotation})`}>
              <polygon
                points={`0,0 ${-cone.length * 0.34},${cone.length} ${cone.length * 0.34},${cone.length}`}
                fill="url(#olo-scene-cone)"
              />
              {!reducedMotion && (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  values={`${cone.rotation - 14};${cone.rotation + 14};${cone.rotation - 14}`}
                  dur="9s"
                  begin={`${cone.delayS}s`}
                  repeatCount="indefinite"
                />
              )}
            </g>
            <circle r={2.4} fill="var(--aqua-300)" filter="url(#olo-scene-glow)" />
          </g>
        ))}
      </motion.g>

      {/* ── AGENTES: drones y AGVs ───────────────────────────────────────
          `animateMotion` con `mpath` es la forma mas barata que existe de mover
          un objeto por una trayectoria: lo hace el compositor del navegador. */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: dur(1.4), delay: dur(timing.agents) }}
      >
        {agents.map((agent) => {
          const isDrone = agent.kind === 'drone';
          const color = isDrone ? 'var(--aqua-300)' : 'var(--iris-400)';

          return (
            <g key={agent.id}>
              {/* La trayectoria visible, muy tenue: da la nocion de ruta */}
              <path
                d={agent.d}
                fill="none"
                stroke={color}
                strokeOpacity={0.1}
                strokeWidth={0.6}
                strokeDasharray="4 6"
                vectorEffect="non-scaling-stroke"
              />
              <g>
                {/* Estela */}
                <circle r={isDrone ? 9 : 7} fill={color} opacity={0.1} filter="url(#olo-scene-glow)" />
                <circle r={isDrone ? 3 : 2.4} fill={color} />
                <circle r={isDrone ? 1.2 : 1} fill="var(--haze-000)" opacity={0.85} />
                {!reducedMotion && (
                  <animateMotion
                    dur={`${agent.durationS}s`}
                    begin={`${agent.delayS}s`}
                    repeatCount="indefinite"
                    rotate="auto"
                  >
                    <mpath href={`#olo-path-${agent.id}`} />
                  </animateMotion>
                )}
              </g>
            </g>
          );
        })}
      </motion.g>

      {/* ── NUCLEO ───────────────────────────────────────────────────────
          El punto de luz del que nace todo. Permanece como corazon de la
          escena, latiendo con el reloj ambiental. */}
      <motion.circle
        cx={VIEWBOX.width / 2}
        cy={VIEWBOX.height * 0.52}
        r={90}
        fill="url(#olo-scene-core)"
        className={reducedMotion ? undefined : 'olo-breathe'}
        initial={{ opacity: 0, scale: 0.1 }}
        animate={{ opacity: 0.55, scale: 1 }}
        transition={{ duration: dur(1.4), delay: dur(timing.spark), ease: easing.emerge }}
        style={{ transformOrigin: `${VIEWBOX.width / 2}px ${VIEWBOX.height * 0.52}px` }}
      />
    </svg>
  );
}

export const SceneSvg = memo(SceneSvgImpl);
