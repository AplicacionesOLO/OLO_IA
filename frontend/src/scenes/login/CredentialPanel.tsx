/**
 * PANEL DE CREDENCIALES
 *
 * Vive en la columna derecha, sobre fondo solido. Por eso NO usa `Panel`: un
 * cristal translucido sobre un fondo solido produce un rectangulo apenas
 * distinguible que solo añade ruido. La columna ya es el contenedor, y el
 * formulario flota directamente sobre ella.
 *
 * ⚠ El campo de correo recibe foco a los 800ms SIN esperar a la escena. Un
 * operador que entra 40 veces al dia debe poder escribir de inmediato.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AtSign, KeyRound, ArrowRight } from 'lucide-react';
import { Button, Input } from '../../design/primitives';
import { easing } from '../../design/motion/easing';
import { stagger } from '../../design/motion/stagger';
import { AuthError } from '../../auth/AuthGateway';
import { useAuth } from '../../auth/AuthProvider';
import type { SceneTiming } from './timeline';

interface CredentialPanelProps {
  timing: SceneTiming;
  reducedMotion: boolean;
  /** La escena ya se salto: el panel entra sin retardo. */
  skipped: boolean;
}

const FOCUS_DELAY_MS = 800;

export function CredentialPanel({ timing, reducedMotion, skipped }: CredentialPanelProps) {
  const { signIn, signUp, gateway } = useAuth();
  const emailRef = useRef<HTMLInputElement>(null);

  // 'signup' es el registro self-service (#8 del plan de mejoras SaaS): una
  // identidad nueva en Supabase Auth, sin tenant todavia -- crear LA
  // ORGANIZACION es un paso aparte, que ocurre en NoMembershipScreen una vez
  // que esa identidad ya tiene sesion.
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  // Foco temprano, independiente de la escena. Es la regla que convierte la
  // escena en un regalo y no en un peaje.
  useEffect(() => {
    const t = setTimeout(() => emailRef.current?.focus(), skipped ? 0 : FOCUS_DELAY_MS);
    return () => clearTimeout(t);
  }, [skipped]);

  function toggleMode() {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setFormError(null);
    setCheckEmail(false);
    setPassword('');
    setConfirmPassword('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (submitting) return;

    setFormError(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setFormError('Las claves no coinciden');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        // No se navega aqui: el router reacciona al estado de sesion. Asi el
        // mismo camino sirve para el login y para la restauracion de sesion.
      } else {
        const resultado = await signUp(email.trim(), password);
        if (resultado === 'check-email') {
          setCheckEmail(true);
          setSubmitting(false);
        }
        // 'active': igual que el login, el router reacciona solo.
      }
    } catch (error) {
      setFormError(
        error instanceof AuthError
          ? error.message
          : mode === 'login'
            ? 'No se pudo iniciar sesion'
            : 'No se pudo crear la cuenta',
      );
      setSubmitting(false);
    }
  }

  const delay = reducedMotion || skipped ? 0 : timing.panel;

  // El contenido entra escalonado: la marca primero, luego los campos, luego el
  // boton. Comunica que el sistema construye la puerta con intencion.
  const item = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.12 : 0.45, ease: easing.emerge },
    },
  };

  return (
    <motion.div
      className="w-full max-w-[400px]"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            delayChildren: delay,
            staggerChildren: reducedMotion ? 0 : stagger.base,
          },
        },
      }}
    >
      {/* ── Identidad de marca ───────────────────────────────────────── */}
      <motion.div variants={item} className="mb-[var(--space-12)] flex flex-col gap-5">
        <LogoMark />
        <div className="flex flex-col gap-2.5">
          <h1 className="text-[length:var(--text-3xl)] font-[var(--weight-thin)] leading-none tracking-[var(--tracking-tighter)] text-[var(--text-primary)]">
            OLO<span className="text-[var(--text-accent)]"> IA</span>
          </h1>
          <p className="t-small text-[var(--text-muted)]">
            {mode === 'login'
              ? 'Identificate para acceder a la consciencia del almacen.'
              : 'Crea tu identidad. La organizacion se arma en el siguiente paso.'}
          </p>
        </div>
      </motion.div>

      {checkEmail ? (
        <motion.div variants={item} className="flex flex-col gap-4">
          <p className="t-body text-[var(--text-secondary)]">
            Te mandamos un correo a <strong>{email}</strong> para confirmar tu
            identidad. Confirmalo y vuelve a entrar con tu clave.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              setCheckEmail(false);
              setMode('login');
            }}
          >
            Ya confirme, entrar
          </Button>
        </motion.div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
          <motion.div variants={item}>
            <Input
              ref={emailRef}
              label="Identidad"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="operador@empresa.com"
              leading={<AtSign strokeWidth={1.5} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              required
            />
          </motion.div>

          <motion.div variants={item}>
            <Input
              label="Clave"
              type="password"
              name="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••••"
              leading={<KeyRound strokeWidth={1.5} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              error={mode === 'login' ? (formError ?? undefined) : undefined}
              required
            />
          </motion.div>

          {mode === 'signup' && (
            <motion.div variants={item}>
              <Input
                label="Confirma la clave"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                placeholder="••••••••••"
                leading={<KeyRound strokeWidth={1.5} />}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                error={formError ?? undefined}
                required
              />
            </motion.div>
          )}

          <motion.div variants={item} className="mt-[var(--space-5)]">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              className="w-full"
            >
              {submitting
                ? mode === 'login'
                  ? 'Verificando identidad'
                  : 'Creando identidad'
                : mode === 'login'
                  ? 'Acceder'
                  : 'Crear cuenta'}
              {!submitting && <ArrowRight strokeWidth={2} className="size-[18px]" />}
            </Button>
          </motion.div>
        </form>
      )}

      <motion.div variants={item} className="mt-[var(--space-10)] flex items-center justify-between">
        <div className="flex flex-col items-start gap-2">
          {mode === 'login' && (
            <button
              type="button"
              className="text-[length:var(--text-sm)] text-[var(--text-faint)] transition-colors hover:text-[var(--text-accent)]"
            >
              Recuperar acceso
            </button>
          )}
          {!checkEmail && (
            <button
              type="button"
              onClick={toggleMode}
              className="text-[length:var(--text-sm)] text-[var(--text-faint)] transition-colors hover:text-[var(--text-accent)]"
            >
              {mode === 'login' ? 'Crear una organizacion' : 'Ya tengo cuenta'}
            </button>
          )}
        </div>
        {/* En modo mock se avisa explicitamente: es una barrera contra confundir
            el entorno de desarrollo con el real. */}
        {gateway.mode === 'mock' && (
          <span className="t-label text-[var(--text-warn)]">modo mock</span>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Marca: un nodo con sus conexiones. Es la Mesh reducida a un glifo. */
function LogoMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
      <g stroke="var(--accent)" strokeWidth="1.1" fill="none" opacity="0.45">
        <line x1="17" y1="17" x2="30" y2="8" />
        <line x1="17" y1="17" x2="5" y2="10" />
        <line x1="17" y1="17" x2="9" y2="28" />
        <line x1="17" y1="17" x2="28" y2="26" />
      </g>
      <g fill="var(--accent)" className="olo-breathe">
        <circle cx="30" cy="8" r="1.9" opacity="0.75" />
        <circle cx="5" cy="10" r="1.9" opacity="0.75" />
        <circle cx="9" cy="28" r="1.9" opacity="0.75" />
        <circle cx="28" cy="26" r="1.9" opacity="0.75" />
      </g>
      <circle cx="17" cy="17" r="5.2" fill="var(--accent)" />
      <circle cx="17" cy="17" r="2.3" fill="var(--abyss-1000)" />
    </svg>
  );
}
