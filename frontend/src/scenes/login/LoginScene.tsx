/**
 * ESCENA DE LOGIN — orquestador
 *
 * No es un login: es la secuencia de ARRANQUE DE CONSCIENCIA del sistema.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMPOSICION: PANTALLA DIVIDIDA (aprobada por el usuario)
 *
 *   ┌──────────────────────────────┬──────────────────┐
 *   │                              │                  │
 *   │   ESCENA                     │   CREDENCIALES   │
 *   │   almacen · drones · mesh    │   fondo oscuro   │
 *   │   particulas · HUD           │   solido         │
 *   │                              │                  │
 *   └──────────────────────────────┴──────────────────┘
 *
 * El fondo solido de la derecha no es solo estetico: da a la tipografia del
 * formulario un contraste que sobre la escena en movimiento no tendria, y evita
 * que el ojo compita entre leer y mirar.
 *
 * Por debajo de 1024px no hay sitio para dos columnas: la escena pasa detras del
 * formulario, atenuada, y el formulario ocupa el ancho completo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * DEGRADACION EN CASCADA — se decide ANTES de montar nada:
 *   prefers-reduced-motion  → composicion estatica, sin secuencia
 *   memoria < 4GB           → escena sin particulas
 *   nucleos < 4             → escena sin particulas
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginWarehouseVisual } from './LoginWarehouseVisual';
import { Particles } from './Particles';
import { CredentialPanel } from './CredentialPanel';
import { markVisited, resolveTiming, INSTANT_TIMING } from './timeline';
import { AmbientLight } from '../../design/foundation/AmbientLight';
import {
  detectDeviceCapability,
  useSystemReducedMotion,
} from '../../design/motion/useMotionPreference';
import { ambient } from '../../design/motion/ambient';
import { cn } from '../../design/utils/cn';

export function LoginScene() {
  const systemReducedMotion = useSystemReducedMotion();
  const capability = useMemo(detectDeviceCapability, []);

  /** El usuario interrumpio la secuencia: se salta al estado final. */
  const [skipped, setSkipped] = useState(false);

  const reducedMotion = systemReducedMotion;
  const timing = useMemo(
    () => (skipped ? INSTANT_TIMING : resolveTiming(reducedMotion)),
    [reducedMotion, skipped],
  );

  // Las particulas son lo primero que se sacrifica: son puro atmosfera.
  const particleCount =
    reducedMotion || capability.lowMemory || capability.lowConcurrency
      ? 0
      : ambient.particleCountLogin;

  const skip = useCallback(() => setSkipped(true), []);

  // ── Interrumpibilidad ──────────────────────────────────────────────────
  // Cualquier tecla o click EN LA COLUMNA DE LA ESCENA salta la animacion.
  // Se limita a la escena: si se pone en window, el primer click en el
  // formulario (o el Enter para enviar) puede interferir con el submit.
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion || skipped) return;
    const el = sceneRef.current;
    if (!el) return;

    const onInteract = () => skip();
    el.addEventListener('pointerdown', onInteract, { once: true });

    // Keydown sigue en window pero solo si no estamos ya interactuando con el form
    const onKey = (e: KeyboardEvent) => {
      // Si el foco esta dentro de un form, no interceptar
      if ((e.target as HTMLElement)?.closest?.('form')) return;
      skip();
      window.removeEventListener('keydown', onKey);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      el.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onKey);
    };
  }, [reducedMotion, skipped, skip]);

  // Se marca la visita al desmontar y no al montar: si el usuario recarga a
  // mitad de la secuencia, la siguiente carga aun le muestra la escena completa.
  useEffect(() => () => markVisited(), []);

  return (
    <main className="relative flex h-dvh w-full overflow-hidden bg-[var(--canvas)]">
      {/* ══════════════════════════════════════════════════════════════════
          COLUMNA IZQUIERDA — LA ESCENA

          En pantallas grandes es una columna real que ocupa el espacio
          restante. Por debajo de 1024px pasa a `absolute` y queda DETRAS del
          formulario, atenuada al 40%: sigue presente como atmosfera pero no
          compite con la lectura.
          ══════════════════════════════════════════════════════════════════ */}
      <div
        ref={sceneRef}
        className={cn(
          'absolute inset-0 opacity-40',
          'lg:relative lg:inset-auto lg:flex-1 lg:opacity-100',
        )}
      >
        {/* Z-0: la luz del lienzo */}
        <AmbientLight vignette={false} />

        {/* Z-0: almacén visual híbrido (imagen + overlay SVG interactivo) */}
        <LoginWarehouseVisual reducedMotion={reducedMotion} />

        {/* Z-0: atmosfera */}
        {particleCount > 0 && <Particles count={particleCount} reducedMotion={reducedMotion} />}

        {/* Vignette: oscurece los bordes y enfoca el centro de la escena */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--vignette)' }}
        />

        {/*
          EL HUD SE HA QUITADO, Y NO POR SIMPLIFICAR.

          `warehouse-base.webp` ya trae pintado un panel «ESTADO DEL SISTEMA» abajo a la
          izquierda, con cinco filas —red neuronal, nodos edge, motor de inferencia,
          gemelo digital, organización—. `DiagnosticHud` dibujaba otro panel de estado en
          la MISMA esquina: dos paneles de estado solapados en el mismo sitio.

          Se conserva el componente porque mide tiempos reales de arranque y sirve para
          diagnosticar; lo que no tiene sentido es pintarlo sobre un dibujo que ya tiene
          uno. Si algún día el dibujo se cambia por uno sin HUD, se vuelve a montar aquí.
        */}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          COLUMNA DERECHA — LAS CREDENCIALES

          `clamp(420px, 34%, 580px)`: en un monitor de 1920 da ~580px, en uno de
          1280 da ~435px. Nunca menos de 420 (el formulario deja de respirar) ni
          mas de 580 (la escena pierde protagonismo).
          ══════════════════════════════════════════════════════════════════ */}
      <div
        className={cn(
          'relative z-10 flex w-full shrink-0 flex-col justify-center',
          'lg:w-[clamp(420px,34%,580px)]',
          // Movil: semitransparente con blur para que el formulario se lea
          // sobre la escena. Escritorio: solido, sin coste de blur.
          'bg-[color-mix(in_oklab,var(--canvas)_92%,transparent)] backdrop-blur-[18px]',
          'lg:bg-[var(--canvas)] lg:backdrop-blur-none',
        )}
      >
        {/* El filo que separa las dos mitades. No es un borde plano: es un
            gradiente vertical que se enciende en el centro, alineado con el
            nucleo de la escena. Se desvanece por completo arriba y abajo, asi
            que nunca se lee como una linea de reticula. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-px lg:block"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, rgb(255 255 255 / 0.05) 24%, ' +
              'color-mix(in oklab, var(--accent) 42%, transparent) 50%, ' +
              'rgb(255 255 255 / 0.05) 76%, transparent 100%)',
          }}
        />

        <div className="flex flex-1 items-center justify-center px-8 sm:px-14">
          <CredentialPanel timing={timing} reducedMotion={reducedMotion} skipped={skipped} />
        </div>

        {/* Pie de la columna: instrumentacion discreta */}
        <div className="flex shrink-0 items-center justify-between px-8 pb-8 sm:px-14">
          <span className="t-mono-xs text-[var(--text-faint)] opacity-70">
            Neural Warehouse OS
          </span>
          <span className="t-mono-xs text-[var(--text-faint)] opacity-70">
            v0.1.0 · capa 1
          </span>
        </div>
      </div>
    </main>
  );
}
