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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS SALIDAS, NO UNA (#8 del plan de mejoras SaaS: onboarding self-service)
 *
 * Antes esta pantalla solo sabia decir "pidele a tu administrador que te
 * invite" -- correcto para quien SI espera una invitacion, pero un callejon
 * sin salida para quien acaba de registrarse para crear SU PROPIA
 * organizacion: es exactamente el mismo estado de sesion (identidad valida,
 * sin tenant), pero la solucion es la opuesta. El formulario de abajo llama
 * a `POST /v1/auth/onboard` (0118) -- la funcion decide si esta identidad
 * puede crear una organizacion nueva, esta pantalla no lo decide por su
 * cuenta.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState, type FormEvent } from 'react';
import { Building2, UserX } from 'lucide-react';
import { Panel } from '../../design/foundation/Panel';
import { AmbientLight } from '../../design/foundation/AmbientLight';
import { Button, Input } from '../../design/primitives';
import { ApiError } from '../../lib/apiErrors';
import { useAuth } from '../AuthProvider';
import { useSessionStore } from '../sessionStore';

export function NoMembershipScreen() {
  const { signOut, retryProfile } = useAuth();
  const claims = useSessionStore((s) => s.claims);
  const [creando, setCreando] = useState(false);

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

        {claims?.email && (
          <div className="mb-[var(--space-8)] flex flex-col gap-2 rounded-[var(--radius-md)] p-[var(--space-5)] [background:var(--glass-1)] shadow-[var(--rim-1)]">
            <span className="t-label">Identidad</span>
            <span className="t-num text-[length:var(--text-sm)] text-[var(--text-body)]">
              {claims.email}
            </span>
          </div>
        )}

        {creando ? (
          <CrearOrganizacionForm onCancelar={() => setCreando(false)} />
        ) : (
          <>
            <p className="t-body mb-[var(--space-8)] text-[var(--text-secondary)]">
              Si esperas una invitacion, pide al administrador de tu organizacion
              que active tu membresia. Si vienes a dar de alta tu propia empresa,
              puedes crearla ahora mismo.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button variant="primary" size="md" onClick={() => setCreando(true)}>
                <Building2 strokeWidth={1.5} className="size-[18px]" />
                Crear mi organizacion
              </Button>
              <Button variant="secondary" size="md" onClick={() => void retryProfile()}>
                Reintentar
              </Button>
              <Button variant="ghost" size="md" onClick={() => void signOut()}>
                Cerrar sesion
              </Button>
            </div>
          </>
        )}
      </Panel>
    </main>
  );
}

function CrearOrganizacionForm({ onCancelar }: { onCancelar: () => void }) {
  const { api, gateway, retryProfile } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    setEnviando(true);

    try {
      if (gateway.mode === 'mock') {
        // Sin backend real en mock: el "onboarding" es simbolico, y lo unico
        // que hace falta demostrar es la transicion de pantalla. Ver
        // MockAuthGateway.signUp -- el mismo criterio.
        await retryProfile();
        return;
      }

      await api.post('/auth/onboard', {
        org_name: orgName.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });

      // El token que ya tenemos en mano NO lleva tenant_id -- se calculo
      // ANTES de que existiera la membresia. Pedir uno nuevo es lo que hace
      // que el Hook (0016) lo recalcule con la organizacion recien creada;
      // `onSessionChange`, ya suscrito en AuthProvider, recoge el token
      // fresco y reevalua el perfil solo.
      const fresh = await gateway.refresh();
      if (!fresh) {
        setError('La organizacion se creo, pero no se pudo renovar la sesion. Cierra sesion y vuelve a entrar.');
        setEnviando(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la organizacion');
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Nombre de la organizacion"
        name="org_name"
        placeholder="Bodega Central S.A."
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        disabled={enviando}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Tu nombre"
          name="first_name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          disabled={enviando}
          required
        />
        <Input
          label="Tu apellido"
          name="last_name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          disabled={enviando}
          error={error ?? undefined}
          required
        />
      </div>

      <p className="t-small text-[var(--text-faint)]">
        Empieza en periodo de prueba de 14 dias. Seras el administrador.
      </p>

      <div className="mt-[var(--space-3)] flex flex-wrap gap-3">
        <Button type="submit" variant="primary" size="md" loading={enviando}>
          Crear organizacion
        </Button>
        <Button type="button" variant="ghost" size="md" disabled={enviando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
