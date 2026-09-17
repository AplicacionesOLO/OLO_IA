/**
 * PLATFORM OWNERS — el privilegio mas alto del sistema, gestionado desde aqui.
 *
 * Hasta ahora esto se concedia registrando una fila a mano en `platform.owners`
 * por SQL directo — se vivio de primera mano en esta misma sesion, verificando
 * quien tenia el privilegio. Esta pantalla cierra ese hueco.
 *
 * ── POR QUE CADA ACCION PIDE UN MOTIVO ────────────────────────────────────
 *
 * `platform.owners.reason` tiene un CHECK que exige al menos 10 caracteres: es
 * lo unico que explicara, meses despues, por que esa persona tenia acceso al
 * modulo de IA. Revocar pide el suyo propio, aparte, que queda en el registro
 * de auditoria (`platform.privileged_operation_log`) y no en la fila —la razon
 * de la concesion original no se pierde al revocar.
 *
 * ── POR QUE NO HAY BOTON DE BORRAR ────────────────────────────────────────
 *
 * No existe: revocar es logico (`revoked_at`), nunca un DELETE. La base ni
 * siquiera tiene una politica de DELETE sobre esta tabla.
 */

import { useState } from 'react';
import { Ban, Crown } from 'lucide-react';

import { AsyncStatus } from '../../design/foundation/AsyncStatus';
import { Button } from '../../design/primitives/Button';
import { cn } from '../../design/utils/cn';
import { ApiError, humanMessage } from '../../lib/apiErrors';
import { useGrantOwner, usePlatformOwners, useRevokeOwner } from './useAdmin';

function mensaje(e: unknown, porOmision: string): string {
  if (e instanceof ApiError) return humanMessage(e);
  if (e instanceof Error && e.message) return e.message;
  return porOmision;
}

export function PlatformOwnersSection({ miCorreo }: { miCorreo: string | null }) {
  const owners = usePlatformOwners();

  if (owners.isLoading) {
    return <AsyncStatus phase="pending" pendingLabel="Cargando los Platform Owners" />;
  }
  if (owners.isError) {
    return (
      <AsyncStatus
        phase="error"
        errorLabel={mensaje(owners.error, 'no se pudieron leer los Platform Owners')}
        onRetry={() => void owners.refetch()}
      />
    );
  }

  const lista = owners.data ?? [];
  const activos = lista.filter((o) => o.revoked_at === null);
  const revocados = lista.filter((o) => o.revoked_at !== null);

  return (
    <div className="flex flex-col gap-4">
      <p className="t-mono-xs text-[var(--text-faint)]">
        Da acceso al módulo de IA. <strong className="text-[var(--text-secondary)]">
        No se concede por rol</strong> —ver la matriz de abajo—: un rol de tenant
        nunca puede escalar a esto. Se resuelve contra la base en cada petición, así
        que revocarlo surte efecto de inmediato, no cuando caduque la sesión.
      </p>

      <ul className="flex flex-col gap-2">
        {activos.map((o) => (
          <FilaOwner key={o.user_id} owner={o} soyYo={o.email === miCorreo} />
        ))}
        {activos.length === 0 && (
          <li className="t-mono-xs text-[var(--text-warn)]">
            Sin ningún Platform Owner activo — esto no debería poder pasar.
          </li>
        )}
      </ul>

      <FormConcederOwner />

      {revocados.length > 0 && (
        <details className="mt-1">
          <summary className="t-mono-xs cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-primary)]">
            {revocados.length} revocado(s) — historial
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {revocados.map((o) => (
              <li key={o.user_id} className="t-mono-xs text-[var(--text-faint)]">
                {o.email} · concedido {new Date(o.granted_at).toLocaleDateString('es')} por{' '}
                {o.granted_by_email ?? 'siembra inicial'} · revocado{' '}
                {new Date(o.revoked_at!).toLocaleDateString('es')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FilaOwner({
  owner,
  soyYo,
}: {
  owner: { user_id: string; email: string; granted_at: string; granted_by_email: string | null; reason: string };
  soyYo: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const revocar = useRevokeOwner();

  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] px-3 py-2.5 [background:var(--glass-1)]">
      <div className="flex items-center gap-3">
        <Crown strokeWidth={1.5} className="size-4 shrink-0 text-[var(--text-accent)]" />
        <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {owner.email}
          {soyYo && <span className="text-[var(--text-faint)]"> (tú)</span>}
        </span>
        <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
          desde {new Date(owner.granted_at).toLocaleDateString('es')}
        </span>
        {!confirmando && (
          <Button variant="ghost" size="xs" onClick={() => setConfirmando(true)}>
            <Ban strokeWidth={1.5} className="size-3.5" />
            Revocar
          </Button>
        )}
      </div>
      <p className="t-mono-xs text-[var(--text-faint)]">{owner.reason}</p>

      {confirmando && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="motivo de la revocación (mínimo 10 caracteres)"
            className="h-7 w-72 rounded-[var(--radius-sm)] px-2 [background:var(--glass-2)] text-[length:var(--text-xs)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
          />
          <Button
            variant="danger"
            size="xs"
            loading={revocar.isPending}
            disabled={motivo.trim().length < 10}
            onClick={() =>
              revocar.mutate(
                { userId: owner.user_id, reason: motivo.trim() },
                { onSuccess: () => setConfirmando(false) },
              )
            }
          >
            Sí, revocar
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
        </div>
      )}
      {revocar.isError && (
        <p className="t-mono-xs text-[var(--text-warn)]">
          {mensaje(revocar.error, 'No se pudo revocar')}
        </p>
      )}
    </li>
  );
}

function FormConcederOwner() {
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState('');
  const [motivo, setMotivo] = useState('');
  const conceder = useGrantOwner();

  if (!abierto) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)} className="self-start">
        <Crown strokeWidth={1.5} className="size-4" />
        Conceder Platform Owner
      </Button>
    );
  }

  const puedeEnviar = email.trim().length >= 3 && motivo.trim().length >= 10;

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-sm)] p-3',
        '[background:var(--glass-1)] shadow-[var(--rim-1)]',
      )}
    >
      <label className="flex flex-col gap-1">
        <span className="t-label">Correo del usuario</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="persona@empresa.com"
          className="h-9 rounded-[var(--radius-sm)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-label">Motivo (mínimo 10 caracteres)</span>
        <input
          type="text"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="por qué esta persona necesita el módulo de IA"
          className="h-9 rounded-[var(--radius-sm)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={conceder.isPending}
          disabled={!puedeEnviar}
          onClick={() =>
            conceder.mutate(
              { email: email.trim().toLowerCase(), reason: motivo.trim() },
              {
                onSuccess: () => {
                  setEmail('');
                  setMotivo('');
                  setAbierto(false);
                },
              },
            )
          }
        >
          Conceder
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
      {conceder.isError && (
        <p className="t-mono-xs text-[var(--text-warn)]">
          {mensaje(conceder.error, 'No se pudo conceder')}
        </p>
      )}
    </div>
  );
}
