/**
 * OLOBOT — el panel de conversación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN PANEL LATERAL, NO UN MODAL
 *
 * Un modal tapa la aplicación, y aquí eso rompe justo lo que el bot hace mejor:
 * llevarte a una pantalla y comentarla. Con un modal, «te llevo a Configuración»
 * significa cerrar la conversación para poder mirar.
 *
 * El panel se ancla a la derecha, deja ver el contenido y sobrevive a la navegación:
 * el bot te lleva a la pantalla, la pantalla cambia detrás y la conversación sigue
 * abierta al lado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA CONFIRMACIÓN ES LA PARTE IMPORTANTE DE ESTA PANTALLA
 *
 * Cuando el bot propone un cambio, aquí NO aparece un «¿seguro?». Aparece la frase
 * exacta de lo que va a pasar —la escribe el servidor, a partir de los mismos
 * argumentos que se van a ejecutar— y dos botones. El texto viene del backend a
 * propósito: si lo compusiera este archivo, lo que se lee y lo que se ejecuta podrían
 * dejar de ser lo mismo sin que nada fallara.
 *
 * Y no se cierra solo al confirmar: el resultado se queda a la vista. Un cambio que
 * desaparece de la pantalla en cuanto ocurre no se puede comprobar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL BOTÓN NO SE ESCONDE CUANDO NO HAY BOT
 *
 * Si el usuario no tiene nivel, el panel se abre igual y dice por qué, con la frase
 * del servidor. Un asistente que existe para tus compañeros y para ti no, sin
 * explicación, se lee como un fallo del producto —y genera la pregunta a soporte que
 * esta frase contesta—.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Check, Send, Sparkles, Trash2, X } from 'lucide-react';

import { AsyncStatus } from '../../design/foundation/AsyncStatus';
import { Button } from '../../design/primitives/Button';
import { cn } from '../../design/utils/cn';
import { ApiError, humanMessage } from '../../lib/apiErrors';
import { useShellStore } from '../../shell/shellStore';
import type { AccionPendiente, Navegacion } from './olobotTypes';
import {
  useConfirmarAccion,
  useHablar,
  useHistorial,
  useOlobotEstado,
  useRechazarAccion,
} from './useOlobot';

function mensaje(e: unknown, porOmision: string): string {
  if (e instanceof ApiError) return humanMessage(e);
  if (e instanceof Error && e.message) return e.message;
  return porOmision;
}

/** Lo que se enseña mientras el bot piensa. No es decorativo: un turno tarda segundos. */
function Pensando() {
  return (
    <div className="flex items-center gap-2 py-2">
      <Sparkles
        strokeWidth={1.5}
        className="size-3.5 animate-pulse text-[var(--text-accent)]"
      />
      <span className="t-mono-xs text-[var(--text-secondary)]">
        Consultando los datos…
      </span>
    </div>
  );
}

/**
 * Un cambio propuesto, con lo que va a pasar delante.
 *
 * El `summary` es del servidor. Ver la cabecera del módulo.
 */
function Propuesta({ accion }: { accion: AccionPendiente }) {
  const confirmar = useConfirmarAccion();
  const rechazar = useRechazarAccion();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<'executed' | 'rejected' | null>(null);

  const pendiente = confirmar.isPending || rechazar.isPending;

  return (
    <div
      className={cn(
        'my-2 flex flex-col gap-2 rounded-[var(--radius-sm)] p-3',
        '[background:var(--glass-2)] shadow-[var(--rim-1)]',
        hecho === 'executed' && 'shadow-[inset_0_0_0_1px_var(--text-ok)]',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="t-label mt-0.5 text-[var(--text-warn)]">cambio propuesto</span>
      </div>
      {/* La frase del backend, tal cual: es lo que se va a ejecutar. */}
      <p className="t-body text-[var(--text-primary)]">{accion.summary}</p>

      {hecho === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="xs"
            loading={confirmar.isPending}
            disabled={pendiente}
            onClick={() => {
              setError(null);
              confirmar
                .mutateAsync(accion.id)
                .then(() => setHecho('executed'))
                .catch((e: unknown) => setError(mensaje(e, 'No se pudo aplicar.')));
            }}
          >
            <Check strokeWidth={2} className="mr-1 size-3" />
            Confirmar
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={pendiente}
            onClick={() => {
              setError(null);
              rechazar
                .mutateAsync(accion.id)
                .then(() => setHecho('rejected'))
                .catch((e: unknown) => setError(mensaje(e, 'No se pudo descartar.')));
            }}
          >
            Descartar
          </Button>
          <span className="t-mono-xs text-[var(--text-faint)]">
            No se ha aplicado nada todavía
          </span>
        </div>
      ) : (
        // El resultado se queda: un cambio que desaparece al ocurrir no se comprueba.
        <span
          className={cn(
            't-mono-xs',
            hecho === 'executed' ? 'text-[var(--text-ok)]' : 'text-[var(--text-faint)]',
          )}
        >
          {hecho === 'executed' ? 'Aplicado' : 'Descartado, no se cambió nada'}
        </span>
      )}

      {error && <span className="t-mono-xs text-[var(--state-critical)]">{error}</span>}
    </div>
  );
}

/** La invitación del bot a ir a una pantalla. El usuario decide si va. */
function Llevar({ nav, onIr }: { nav: Navegacion; onIr: () => void }) {
  return (
    <div className="my-2 flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="xs" onClick={onIr}>
        Ir a {nav.key}
      </Button>
      {nav.reason && (
        <span className="t-mono-xs text-[var(--text-faint)]">{nav.reason}</span>
      )}
    </div>
  );
}

interface Turno {
  quien: 'user' | 'assistant';
  texto: string;
  acciones?: AccionPendiente[];
  nav?: Navegacion | null;
}

export function OlobotPanel() {
  const abierto = useShellStore((s) => s.olobotAbierto);
  const cerrar = useShellStore((s) => s.cerrarOlobot);
  const navegar = useNavigate();

  const estado = useOlobotEstado();
  const hablar = useHablar();

  const [conversacion, setConversacion] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  // El historial del servidor, para cuando se reabre el panel con una conversación en
  // marcha. Los turnos en memoria son los de ESTA sesión del panel: traen las
  // propuestas y las navegaciones, que el historial no guarda.
  const historial = useHistorial(abierto && turnos.length === 0 ? conversacion : null);

  useEffect(() => {
    if (abierto) finRef.current?.scrollIntoView({ block: 'end' });
  }, [abierto, turnos.length, hablar.isPending]);

  if (!abierto) return null;

  const disponible = estado.data?.available === true;

  const enviar = () => {
    const pregunta = texto.trim();
    if (!pregunta || hablar.isPending) return;
    setTexto('');
    setError(null);
    setTurnos((t) => [...t, { quien: 'user', texto: pregunta }]);

    hablar
      .mutateAsync({
        message: pregunta,
        ...(conversacion ? { conversation_id: conversacion } : {}),
      })
      .then((r) => {
        setConversacion(r.conversation_id);
        setTurnos((t) => [
          ...t,
          {
            quien: 'assistant',
            texto: r.reply,
            acciones: r.pending_actions,
            nav: r.navigate,
          },
        ]);
      })
      .catch((e: unknown) => {
        setError(mensaje(e, 'No se pudo hablar con OLOBOT.'));
      });
  };

  const previos = (historial.data?.messages ?? []).filter((m) => m.content);

  return (
    <aside
      // `z-50`: por encima del visor expandido (z-40). El asistente tiene que poder
      // abrirse sobre cualquier pantalla, incluido el plano a pantalla completa.
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col',
        '[background:var(--glass-1)] backdrop-blur-[var(--glass-1-blur)]',
        'shadow-[var(--rim-1)] ring-1 ring-[var(--hairline)]',
      )}
      aria-label="OLOBOT"
    >
      {/* ── Cabecera ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-[var(--hairline)] px-4 py-3">
        <Bot strokeWidth={1.5} className="size-4 text-[var(--text-accent)]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="t-label text-[var(--text-primary)]">OLOBOT</span>
          {estado.data?.level && (
            <span className="t-mono-xs text-[var(--text-faint)]">
              nivel {estado.data.level}
              {estado.data.tools.some((h) => h.writes)
                ? ' · puede proponer cambios'
                : ' · solo consulta y navega'}
            </span>
          )}
        </div>
        {turnos.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Empezar una conversación nueva"
            onClick={() => {
              setTurnos([]);
              setConversacion(null);
              setError(null);
            }}
          >
            <Trash2 strokeWidth={1.5} className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label="Cerrar OLOBOT"
          onClick={cerrar}
        >
          <X strokeWidth={1.5} className="size-3.5" />
        </Button>
      </header>

      {/* ── Conversación ─────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {estado.isLoading && <AsyncStatus phase="pending" pendingLabel="Comprobando" />}

        {/* El motivo del servidor, tal cual. Ver la cabecera del módulo. */}
        {estado.data && !disponible && (
          <div className="flex flex-col gap-2 py-4">
            <p className="t-body text-[var(--text-secondary)]">{estado.data.reason}</p>
          </div>
        )}

        {disponible && turnos.length === 0 && previos.length === 0 && (
          <div className="flex flex-col gap-3 py-2">
            <p className="t-body text-[var(--text-secondary)]">
              Pregúntame por los datos de tu almacén. Consulto la base cada vez: no
              contesto de memoria.
            </p>
            <div className="flex flex-col gap-1.5">
              {[
                '¿Cómo está de lleno el almacén?',
                '¿Qué racks están más saturados?',
                '¿Dónde hay descuadres de inventario?',
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTexto(s)}
                  className={cn(
                    't-mono-xs rounded-[var(--radius-xs)] px-2 py-1.5 text-left',
                    'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                    'shadow-[var(--rim-1)] [background:var(--glass-2)]',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lo que se dijo antes, si el panel se reabrió sobre una conversación. */}
        {previos.map((m) => (
          <Burbuja key={m.id} quien={m.role} texto={m.content ?? ''} />
        ))}

        {turnos.map((t, i) => (
          <div key={i}>
            <Burbuja quien={t.quien} texto={t.texto} />
            {t.nav && (
              <Llevar
                nav={t.nav}
                onIr={() => {
                  navegar(t.nav!.path);
                  // El panel NO se cierra al navegar: es lo que hace que el bot pueda
                  // comentar la pantalla a la que te acaba de llevar.
                }}
              />
            )}
            {t.acciones?.map((a) => (
              <Propuesta key={a.id} accion={a} />
            ))}
          </div>
        ))}

        {hablar.isPending && <Pensando />}
        {error && (
          <div className="py-2">
            <AsyncStatus phase="error" errorLabel={error} />
          </div>
        )}
        <div ref={finRef} />
      </div>

      {/* ── Escribir ─────────────────────────────────────────────────── */}
      {disponible && (
        <footer className="border-t border-[var(--hairline)] p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter envía, Shift+Enter hace salto de línea. Es lo que la gente
                // espera de un chat, y una pregunta al bot rara vez tiene párrafos.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              rows={2}
              placeholder="Pregunta algo del almacén…"
              className={cn(
                'min-h-[52px] flex-1 resize-none rounded-[var(--radius-xs)] px-2 py-1.5',
                'text-[length:var(--text-sm)] text-[var(--text-primary)]',
                '[background:var(--glass-2)] shadow-[var(--rim-1)]',
                'outline-none focus:shadow-[var(--focus-ring)]',
              )}
            />
            <Button
              variant="primary"
              size="sm"
              iconOnly
              aria-label="Enviar"
              disabled={!texto.trim() || hablar.isPending}
              loading={hablar.isPending}
              onClick={enviar}
            >
              <Send strokeWidth={1.5} className="size-3.5" />
            </Button>
          </div>
        </footer>
      )}
    </aside>
  );
}

function Burbuja({ quien, texto }: { quien: 'user' | 'assistant'; texto: string }) {
  const mio = quien === 'user';
  return (
    <div className={cn('my-2 flex', mio ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-[var(--radius-sm)] px-3 py-2',
          'text-[length:var(--text-sm)] leading-relaxed whitespace-pre-wrap',
          mio
            ? '[background:var(--glass-2)] text-[var(--text-primary)]'
            : 'text-[var(--text-primary)]',
        )}
      >
        {texto}
      </div>
    </div>
  );
}
