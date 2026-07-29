/**
 * PANTALLA: FALLO AL CARGAR EL PERFIL
 *
 * Distinta de NoMembershipScreen: aqui el problema es tecnico (el backend no
 * responde, un 500), no administrativo. El tratamiento correcto es reintentar,
 * no contactar con un administrador.
 */

import { ServerCrash } from 'lucide-react';
import { Panel } from '../../design/foundation/Panel';
import { AmbientLight } from '../../design/foundation/AmbientLight';
import { Button } from '../../design/primitives';
import { useAuth } from '../AuthProvider';
import { useSessionStore } from '../sessionStore';

export function SessionErrorScreen() {
  const { signOut, retryProfile } = useAuth();
  const error = useSessionStore((s) => s.error);

  return (
    <main className="relative flex h-dvh items-center justify-center overflow-hidden bg-[var(--canvas)] px-6">
      <AmbientLight intensity={0.8} />

      <Panel
        level="decision"
        aura="critical"
        radius="2xl"
        pad="lg"
        className="relative z-10 max-w-[500px]"
      >
        <div className="mb-[var(--space-7)] flex size-14 items-center justify-center rounded-[var(--radius-lg)] bg-[color-mix(in_oklab,var(--state-critical)_14%,transparent)] shadow-[var(--rim-2)]">
          <ServerCrash strokeWidth={1.25} className="size-6 text-[var(--crimson-400)]" />
        </div>

        <h1 className="mb-[var(--space-5)] text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
          No se pudo cargar tu contexto
        </h1>

        <p className="t-body mb-[var(--space-8)] text-[var(--text-secondary)]">
          La identidad es valida, pero el servicio no devolvio tu perfil. Puede ser
          un problema temporal de conexion con el backend.
        </p>

        {error && (
          <div className="mb-[var(--space-8)] flex flex-col gap-2 rounded-[var(--radius-md)] p-[var(--space-5)] [background:var(--glass-1)] shadow-[var(--rim-1)]">
            <span className="t-label">Detalle</span>
            <span className="t-num text-[length:var(--text-sm)] text-[var(--text-body)]">
              {error}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="md" onClick={() => void retryProfile()}>
            Reintentar
          </Button>
          <Button variant="ghost" size="md" onClick={() => void signOut()}>
            Cerrar sesion
          </Button>
        </div>
      </Panel>
    </main>
  );
}
