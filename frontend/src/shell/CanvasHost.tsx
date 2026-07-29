/**
 * CANVAS HOST — el contenedor de una vista.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUE CAMBIA
 *
 * La version anterior montaba la Mesh y la vignette en CADA vista, y tambien
 * gestionaba el scroll. Ahora la luz vive en el AppShell (una sola vez) y el
 * scroll tambien, asi que este componente se queda con una sola
 * responsabilidad: dar a la vista su respiracion y su animacion de entrada.
 *
 * La Mesh pasa a ser opcional y muy tenue. Con la luz ambiental ya dando
 * profundidad, una red de nodos sobre TODO el dashboard añadia justo lo que
 * habia que quitar: mas lineas.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { MeshLayer } from '../design/foundation/mesh/MeshLayer';
import { useSystemReducedMotion } from '../design/motion/useMotionPreference';
import { cn } from '../design/utils/cn';
import { easing } from '../design/motion/easing';
import { duration } from '../design/motion/duration';

export type CanvasMode =
  /** Reticula de paneles. El modo por defecto. */
  | 'grid'
  /** Una sola superficie a sangre. Para el Twin a pantalla completa. */
  | 'immersive'
  /** Una entidad en detalle. */
  | 'focus';

interface CanvasHostProps {
  mode?: CanvasMode;
  /** Añade la Mesh de fondo. Por defecto NO: el lienzo ya tiene luz propia. */
  mesh?: boolean;
  children: ReactNode;
}

export function CanvasHost({ mode = 'grid', mesh = false, children }: CanvasHostProps) {
  const reducedMotion = useSystemReducedMotion();

  return (
    <div className="relative min-h-full">
      {mesh && (
        <div
          aria-hidden
          className={cn('absolute inset-0', !reducedMotion && 'olo-mesh-drift')}
        >
          <MeshLayer preset="dense" reducedMotion={reducedMotion} />
        </div>
      )}

      <motion.div
        className={cn(
          'relative',
          mode === 'immersive'
            ? 'h-full p-0'
            : 'px-[var(--canvas-pad-x)] pb-[var(--space-16)] pt-[var(--space-2)]',
        )}
        initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reducedMotion ? 0.12 : duration.moderate,
          ease: easing.emerge,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
