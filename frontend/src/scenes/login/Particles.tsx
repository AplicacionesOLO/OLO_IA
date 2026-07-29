/**
 * PARTICULAS AMBIENTALES — "polvo de datos"
 *
 * CSS puro: solo transform y opacity, ambas compuestas por GPU. Con 120
 * particulas el coste de hilo principal es cero, porque no hay JavaScript
 * implicado en su movimiento.
 *
 * En Capa 2 se sustituyen por Canvas, que permite muchas mas y con fisica.
 * Cuando eso ocurra, este componente se registra como el renderizador de capa
 * inferior y sigue siendo el fallback.
 */

import { memo, useMemo } from 'react';
import { generateParticles } from './sceneModel';

interface ParticlesProps {
  count: number;
  reducedMotion: boolean;
}

function ParticlesImpl({ count, reducedMotion }: ParticlesProps) {
  const particles = useMemo(() => generateParticles(count), [count]);

  // Con movimiento reducido no se renderizan en absoluto: no aportan
  // informacion, solo atmosfera.
  if (reducedMotion) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="olo-particle absolute rounded-full bg-[var(--aqua-300)]"
          style={
            {
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              '--particle-opacity': p.opacity,
              '--particle-duration': `${p.durationS}s`,
              '--particle-delay': `${p.delayS}s`,
              '--particle-dx': `${p.driftX}px`,
              '--particle-dy': '-140px',
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export const Particles = memo(ParticlesImpl);
