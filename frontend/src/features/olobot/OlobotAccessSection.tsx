/**
 * LOS NIVELES DE OLOBOT, en Configuración del sistema.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA LISTA ESTÁ APARTE DE LA MATRIZ DE PERMISOS
 *
 * En la matriz aparecen los tres permisos `olobot:*`, y eso es correcto: dicen qué
 * puede hacer un ROL. Pero el NIVEL es otra pregunta —qué puede hacer el asistente de
 * una PERSONA—, y las dos no caben en la misma cuadrícula: una tiene roles en las
 * columnas y la otra usuarios en las filas.
 *
 * Meter el nivel en la matriz habría obligado a inventar cuatro permisos falsos
 * —`olobot:owner`, `olobot:admin`…— y marcar «olobot:owner» a un rol no convierte a
 * nadie en owner. Serían casillas que mienten.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS NIVELES LOS MANDA EL SERVIDOR
 *
 * El desplegable se pinta con `levels` de la respuesta, no con una lista escrita aquí.
 * Quien decide qué trae cada nivel es `domain/olobot/level.py`; una segunda lista en
 * el frontend se separaría de aquella en la primera capacidad nueva, y la pantalla
 * describiría un nivel que ya no es el que se aplica.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA DICE EN VOZ ALTA
 *
 * Que el nivel NO concede permisos. Es la confusión que un administrador va a tener
 * al ver esta lista —«le pongo owner y ya puede todo»— y la respuesta está escrita
 * arriba, no escondida en la documentación: un `viewer` con nivel `owner` sigue sin
 * poder escribir nada, porque el 403 lo pone el permiso.
 */

import { useState } from 'react';
import { Bot } from 'lucide-react';

import { AsyncStatus } from '../../design/foundation/AsyncStatus';
import { cn } from '../../design/utils/cn';
import { ApiError, humanMessage } from '../../lib/apiErrors';
import type { AccesoUsuario, NivelDescrito, OlobotNivel } from './olobotTypes';
import { useOlobotAcceso, usePonerNivel, useQuitarNivel } from './useOlobot';

function mensaje(e: unknown, porOmision: string): string {
  if (e instanceof ApiError) return humanMessage(e);
  if (e instanceof Error && e.message) return e.message;
  return porOmision;
}

function nombreDe(u: AccesoUsuario): string {
  const n = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return n || u.email;
}

/** La celda de acciones de una fila: el desplegable y, si tiene nivel, retirarlo. */
function Acciones({
  usuario,
  niveles,
  soyYo,
}: {
  usuario: AccesoUsuario;
  niveles: NivelDescrito[];
  soyYo: boolean;
}) {
  const poner = usePonerNivel();
  const quitar = useQuitarNivel();
  const [error, setError] = useState<string | null>(null);

  // Nadie se cambia su propio nivel. El backend lo rechaza con un 422, y decirlo aquí
  // evita el clic que solo sirve para leer el error. El motivo va en el `title`: un
  // control desactivado sin explicación se lee como un fallo.
  if (soyYo) {
    return (
      <span
        className="t-mono-xs text-[var(--text-faint)]"
        title="Nadie cambia su propio nivel: así el registro dice quién lo concedió"
      >
        tu propio nivel
      </span>
    );
  }

  const pendiente = poner.isPending || quitar.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={usuario.level ?? ''}
        disabled={pendiente}
        onChange={(e) => {
          setError(null);
          const v = e.target.value;
          const p =
            v === ''
              ? quitar.mutateAsync(usuario.id)
              : poner.mutateAsync({ userId: usuario.id, level: v as OlobotNivel });
          p.catch((err: unknown) => setError(mensaje(err, 'No se pudo cambiar.')));
        }}
        className={cn(
          'h-7 rounded-[var(--radius-xs)] px-2 text-[length:var(--text-xs)]',
          '[background:var(--glass-2)] text-[var(--text-primary)]',
          'shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]',
        )}
      >
        {/* La opción vacía RETIRA el acceso. Sin fila no hay bot, y eso es lo
            correcto por omisión: el asistente aparece porque alguien lo concedió. */}
        <option value="">sin OLOBOT</option>
        {niveles.map((n) => (
          <option key={n.level} value={n.level}>
            {n.label}
          </option>
        ))}
      </select>
      {pendiente && <AsyncStatus phase="pending" pendingLabel="Guardando" />}
      {error && <span className="t-mono-xs text-[var(--state-critical)]">{error}</span>}
    </div>
  );
}

export function OlobotAccessSection({ miCorreo }: { miCorreo: string | null }) {
  const acceso = useOlobotAcceso();

  // 403 si el usuario no tiene `olobot:admin`. No es un error que haya que enseñar:
  // es que esta sección no es para él. Se calla.
  if (acceso.isError) {
    const e = acceso.error;
    if (e instanceof ApiError && (e.status === 403 || e.status === 401)) return null;
    return (
      <AsyncStatus
        phase="error"
        errorLabel={mensaje(e, 'no se pudieron leer los niveles de OLOBOT')}
        onRetry={() => void acceso.refetch()}
      />
    );
  }

  if (acceso.isLoading) {
    return <AsyncStatus phase="pending" pendingLabel="Cargando los niveles de OLOBOT" />;
  }

  const d = acceso.data;
  if (!d) return null;

  const conBot = d.users.filter((u) => u.level !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Bot strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-[var(--text-accent)]" />
        <p className="t-mono-xs text-[var(--text-faint)]">
          El nivel decide qué puede hacer el asistente de cada persona.{' '}
          <strong className="text-[var(--text-secondary)]">
            No concede permisos:
          </strong>{' '}
          OLOBOT actúa siempre con los del usuario, así que alguien con nivel «Owner» y
          rol de solo lectura sigue sin poder cambiar nada. Sin nivel, no tiene
          asistente.
        </p>
      </div>

      {/* Qué significa cada nivel, con las palabras del servidor. */}
      <div className="flex flex-col gap-1.5">
        {d.levels.map((n) => (
          <div key={n.level} className="flex flex-wrap items-baseline gap-2">
            <span className="t-mono-xs w-24 shrink-0 text-[var(--text-accent)]">
              {n.label}
            </span>
            <span className="t-mono-xs text-[var(--text-secondary)]">{n.description}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['usuario', 'correo', 'nivel', 'concedido por', 'motivo', ''].map((c) => (
                <th key={c} className="t-label py-2 pr-4 text-left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--hairline)]">
                <td className="t-mono-xs py-1.5 pr-4 text-[var(--text-primary)]">
                  {nombreDe(u)}
                </td>
                <td className="t-mono-xs py-1.5 pr-4 text-[var(--text-secondary)]">
                  {u.email}
                </td>
                <td
                  className={cn(
                    't-mono-xs py-1.5 pr-4',
                    u.level ? 'text-[var(--text-ok)]' : 'text-[var(--text-faint)]',
                  )}
                >
                  {u.level ?? 'sin OLOBOT'}
                </td>
                <td className="t-mono-xs py-1.5 pr-4 text-[var(--text-secondary)]">
                  {u.granted_by_email ?? '—'}
                </td>
                <td
                  className={cn(
                    't-mono-xs py-1.5 pr-4',
                    u.note ? 'text-[var(--text-secondary)]' : 'text-[var(--text-faint)]',
                  )}
                >
                  {u.note ?? '—'}
                </td>
                <td className="py-1.5 align-top">
                  <Acciones
                    usuario={u}
                    niveles={d.levels}
                    soyYo={miCorreo !== null && u.email === miCorreo}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="t-mono-xs text-[var(--text-faint)]">
        {conBot} de {d.users.length} usuarios tienen asistente.
      </p>
    </div>
  );
}
