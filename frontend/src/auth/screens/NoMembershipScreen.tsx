/**
 * PANTALLA: IDENTIDAD SIN MEMBRESIA
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Este es el caso que el Auth Hook hace posible por diseño (fail-secure): el
 * login TIENE EXITO pero el token no lleva `tenant_id`, asi que /v1/auth/me
 * responde 403 NO_ACTIVE_MEMBERSHIP.
 *
 * Sin esta pantalla, el usuario veria una aplicacion vacia sin explicacion. Su
 * problema es administrativo y tiene solucion conocida, asi que la interfaz se
 * lo dice exactamente.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { UserX } from 'lucide-react';
import { Panel } from '../../design/foundation/Panel';
import { AmbientLight } from '../../design/foundation/AmbientLight';
import { Button } from '../../design/primitives';
import { useAuth } from '../AuthProvider';
import { useSessionStore } from '../sessionStore';

export function NoMembershipScreen() {
  const { signOut, retryProfile } = useAuth();
  const claims = useSessionStore((s) => s.claims);

  return (
    <main className="relative flex h-dvh items-center justify-center overflow-hidden bg-[var(--canvas)] px-6">
      <AmbientLight />

      <Panel
        level="decision"
        aura="alert"
        radius="2xl"
        pad="lg"
        className="relative z-10 max-w-[520px]"
      >
        <div className="mb-[var(--space-7)] flex size-14 items-center justify-center rounded-[var(--radius-lg)] bg-[color-mix(in_oklab,var(--state-alert)_14%,transparent)] shadow-[var(--rim-2)]">
          <UserX strokeWidth={1.25} className="size-6 text-[var(--text-warn)]" />
        </div>

        <h1 className="mb-[var(--space-5)] text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
          Identidad verificada, sin acceso
        </h1>

        <p className="t-body mb-[var(--space-4)] text-[var(--text-secondary)]">
          Tu identidad es correcta, pero no tienes una membresia activa en ninguna
          organizacion. Sin ella el sistema no puede determinar a que datos tienes
          acceso.
        </p>

        <p className="t-body mb-[var(--space-8)] text-[var(--text-secondary)]">
          Contacta con el administrador de tu organizacion para que active tu
          membresia.
        </p>

        {claims?.email && (
          <div className="mb-[var(--space-8)] flex flex-col gap-2 rounded-[var(--radius-md)] p-[var(--space-5)] [background:var(--glass-1)] shadow-[var(--rim-1)]">
            <span className="t-label">Identidad</span>
            <span className="t-num text-[length:var(--text-sm)] text-[var(--text-body)]">
              {claims.email}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="md" onClick={() => void retryProfile()}>
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
