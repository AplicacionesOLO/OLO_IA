/**
 * TWIN SURFACE — RENDERIZADOR DE CAPA 1 (SVG)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEJA DE SER UN PLACEHOLDER.
 *
 * El Twin es el corazon de la aplicacion, asi que:
 *   · EMITE LUZ. Cada bloque irradia segun su ocupacion; el suelo tiene un
 *     glow radial propio; hay un nucleo luminoso en el centro.
 *   · RESPIRA. La intensidad general se modula con el reloj ambiental.
 *   · TIENE MOVIMIENTO. Rutas de AGV recorridas por trazos luminosos, drones
 *     que laten, marcadores de actividad.
 *   · SE INTEGRA. No tiene marco ni borde: se desvanece hacia los bordes con
 *     una mascara radial, asi que no se lee como "un recuadro con un dibujo"
 *     sino como una ventana al almacen.
 *
 * COSTE: ~40 bloques x 3 caras = 120 poligonos estaticos, 3 paths animados por
 * CSS y 5 marcadores. Todo el movimiento es CSS o SMIL: cero animaciones de
 * Framer Motion, cero coste de hilo principal.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { memo, useMemo } from 'react';
import {
  TWIN_VB,
  buildTwinBlocks,
  buildTwinFloor,
  buildTwinMarkers,
  buildTwinRoutes,
} from './twinModel';
import type { TwinSurfaceProps } from './types';
import { cn } from '../../utils/cn';

function TwinSurfaceImpl({
  layers = ['racks', 'routes', 'drones', 'beacons'],
  reducedMotion = false,
  className,
  level,
}: TwinSurfaceProps) {
  const blocks = useMemo(buildTwinBlocks, []);
  const floor = useMemo(buildTwinFloor, []);
  const routes = useMemo(buildTwinRoutes, []);
  const markers = useMemo(buildTwinMarkers, []);

  const show = (l: string) => layers.includes(l as never);

  return (
    <div
      className={cn('relative h-full w-full', className)}
      role="img"
      aria-label={`Gemelo digital del almacen, nivel ${level}. Vista isometrica con ${blocks.length} bloques de estanteria, rutas de vehiculos y dispositivos activos.`}
    >
      {/* Glow de base: la luz que el almacen proyecta sobre su entorno.
          Va en un div y no en el SVG para que el blur sea de compositor. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0',
          !reducedMotion && 'olo-breathe-soft',
        )}
        style={{
          background:
            'radial-gradient(ellipse 62% 46% at 50% 62%, rgb(34 217 245 / 0.13) 0%, rgb(59 130 246 / 0.05) 42%, transparent 72%)',
        }}
      />

      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${TWIN_VB.w} ${TWIN_VB.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Cara superior: la que recibe la luz ambiental. */}
          <linearGradient id="tw-top" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="var(--aqua-300)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--aqua-500)" stopOpacity="0.12" />
          </linearGradient>

          {/* Caras laterales: en sombra, con un tinte azul profundo. */}
          <linearGradient id="tw-left" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--azure-600)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--abyss-1000)" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="tw-right" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--azure-700)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--abyss-1000)" stopOpacity="0.62" />
          </linearGradient>

          <radialGradient id="tw-core">
            <stop offset="0%" stopColor="var(--aqua-200)" stopOpacity="0.9" />
            <stop offset="40%" stopColor="var(--aqua-400)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--aqua-400)" stopOpacity="0" />
          </radialGradient>

          <filter id="tw-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>

          {/* MASCARA DE INTEGRACION — la clave para que no parezca un recuadro.
              El contenido se desvanece hacia los bordes, asi que el Twin no
              tiene un limite duro: se funde con el panel que lo contiene. */}
          <radialGradient id="tw-fade" cx="50%" cy="55%" r="62%">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="62%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="tw-mask">
            <rect width={TWIN_VB.w} height={TWIN_VB.h} fill="url(#tw-fade)" />
          </mask>
        </defs>

        <g mask="url(#tw-mask)">
          {/* ── SUELO ──────────────────────────────────────────────────── */}
          <g stroke="var(--twin-floor)" fill="none" strokeWidth={0.6}>
            {floor.map((l, i) => (
              <path key={i} d={l.d} strokeOpacity={Math.max(0.02, l.opacity)} />
            ))}
          </g>

          {/* Nucleo luminoso en el centro del almacen. Respira. */}
          <circle
            cx={TWIN_VB.w / 2}
            cy={TWIN_VB.h * 0.58}
            r={150}
            fill="url(#tw-core)"
            opacity={0.28}
            className={reducedMotion ? undefined : 'olo-breathe'}
          />

          {/* ── RUTAS ──────────────────────────────────────────────────────
              Trazo tenue permanente + un segmento luminoso que lo recorre. */}
          {show('routes') && (
            <g fill="none" strokeLinecap="round">
              {routes.map((r) => (
                <g key={r.id}>
                  <path d={r.d} stroke="var(--twin-route)" strokeOpacity={0.14} strokeWidth={1.4} />
                  <path
                    d={r.d}
                    stroke="var(--twin-route)"
                    strokeWidth={2.4}
                    strokeOpacity={0.85}
                    filter="url(#tw-glow)"
                    className={reducedMotion ? undefined : 'olo-trace'}
                    style={
                      {
                        '--trace-dash': '46 1200',
                        '--trace-len': 1246,
                        '--trace-dur': `${r.durS}s`,
                        '--trace-delay': `${r.delayS}s`,
                      } as React.CSSProperties
                    }
                  />
                </g>
              ))}
            </g>
          )}

          {/* ── BLOQUES DE ESTANTERIA ────────────────────────────────────
              Sin stroke de contorno: el volumen se lee por la diferencia de
              luz entre las tres caras. Un contorno haria que cada bloque
              pareciera una caja dibujada. */}
          {show('racks') && (
            <g>
              {blocks.map((b) => (
                <g key={b.id} opacity={b.depth}>
                  <polygon points={b.right} fill="url(#tw-right)" />
                  <polygon points={b.left} fill="url(#tw-left)" />
                  <polygon points={b.top} fill="url(#tw-top)" />
                  {/* Filo luminoso superior: proporcional a la ocupacion. Es
                      el canal que comunica "cuanto hay" sin ningun numero. */}
                  <polygon
                    points={b.top}
                    fill="none"
                    stroke="var(--twin-active)"
                    strokeWidth={0.7}
                    strokeOpacity={0.12 + b.load * 0.5}
                  />
                </g>
              ))}
            </g>
          )}

          {/* ── MARCADORES ─────────────────────────────────────────────── */}
          {show('drones') &&
            markers
              .filter((m) => m.kind === 'drone')
              .map((m) => (
                <g key={m.id} transform={`translate(${m.pos[0]} ${m.pos[1]})`}>
                  {/* Linea al suelo: ancla el dron en el espacio. Sin ella
                      parece un punto flotando sin ubicacion. */}
                  <line
                    y2={86}
                    stroke="var(--aqua-400)"
                    strokeOpacity={0.18}
                    strokeWidth={0.8}
                    strokeDasharray="2 4"
                  />
                  <circle r={13} fill="var(--aqua-400)" opacity={0.12} filter="url(#tw-glow)" />
                  <circle
                    r={3.4}
                    fill="var(--aqua-300)"
                    className={reducedMotion ? undefined : 'olo-pulse'}
                  />
                  {!reducedMotion && (
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values={`${m.pos[0]} ${m.pos[1]}; ${m.pos[0] + 26} ${m.pos[1] - 10}; ${m.pos[0]} ${m.pos[1]}`}
                      dur="14s"
                      repeatCount="indefinite"
                      additive="replace"
                    />
                  )}
                </g>
              ))}

          {show('beacons') &&
            markers
              .filter((m) => m.kind !== 'drone')
              .map((m) => {
                const isAlert = m.kind === 'alert';
                const color = isAlert ? 'var(--state-alert)' : 'var(--aqua-300)';
                return (
                  <g key={m.id} transform={`translate(${m.pos[0]} ${m.pos[1]})`}>
                    <circle r={isAlert ? 16 : 10} fill={color} opacity={0.14} filter="url(#tw-glow)" />
                    <circle r={2.6} fill={color} />
                    {!reducedMotion && (
                      <circle r={3} fill="none" stroke={color} strokeWidth={1} opacity={0.6}>
                        {/* Onda expansiva: llama la atencion sin parpadear. */}
                        <animate
                          attributeName="r"
                          values="3;22"
                          dur={isAlert ? '2.2s' : '3.4s'}
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.6;0"
                          dur={isAlert ? '2.2s' : '3.4s'}
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
        </g>
      </svg>
    </div>
  );
}

export const TwinSurface = memo(TwinSurfaceImpl);
