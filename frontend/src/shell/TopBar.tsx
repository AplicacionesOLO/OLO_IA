/**
 * TOPBAR — barra superior elegante.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 72px, cuatro elementos:
 *   izquierda  → titulo de la vista actual + contexto
 *   centro     → aire
 *   derecha    → buscador, aviso de datos de demo, latido del sistema, usuario
 *
 * Sin borde inferior.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  User,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { NAV_ITEMS } from './navigation';
import { useSystemStore } from './systemStore';
import { useSessionStore } from '../auth/sessionStore';
import { useAuth } from '../auth/AuthProvider';
import { StatusIndicator, Kbd, platformModifier } from '../design/primitives';
import { cn } from '../design/utils/cn';
import {
  ETIQUETA_TEMA,
  useTheme,
  type ThemePreference,
} from '../design/tokens/themes/useTheme';
import { env } from '../lib/env';
import { easing } from '../design/motion/easing';
import type { SystemState } from '../design/tokens/tokens';

const STATE_LABEL: Record<SystemState, string> = {
  idle: 'Nominal',
  thinking: 'Procesando',
  alert: 'Atencion',
  critical: 'Critico',
  offline: 'Sin conexion',
};

export function TopBar() {
  const location = useLocation();
  const state = useSystemStore((s) => s.state);
  const profile = useSessionStore((s) => s.profile);
  const { signOut } = useAuth();

  const current = NAV_ITEMS.find((i) =>
    i.path === '/' ? location.pathname === '/' : location.pathname.startsWith(i.path),
  );

  const initials = profile
    ? `${profile.first_name[0] ?? ''}${profile.last_name[0] ?? ''}`.toUpperCase()
    : '··';

  return (
    <header
      className={cn(
        'relative z-20 flex h-[var(--topbar-height)] shrink-0 items-center',
        'gap-[var(--space-6)] px-[var(--canvas-pad-x)]',
      )}
    >
      {/* ── Contexto de la vista ──────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-[length:var(--text-lg)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
          {current?.label ?? 'Overview'}
        </h1>
        <span className="t-mono-xs truncate text-[var(--text-faint)]">
          {profile?.tenant.name ?? 'Sin organizacion'}
        </span>
      </div>

      <div className="flex-1" />

      {/* ── Buscador ─────────────────────────────────────────────────── */}
      <button
        type="button"
        className={cn(
          'hidden h-10 items-center gap-3 rounded-[var(--radius-full)] pl-4 pr-2.5 xl:flex',
          '[background:var(--glass-1)] shadow-[var(--rim-1)]',
          'text-[var(--text-faint)] transition-colors duration-200',
          'hover:[background:var(--glass-2)] hover:text-[var(--text-secondary)]',
        )}
        aria-label="Buscar en el sistema"
      >
        <Search strokeWidth={1.5} className="size-4" />
        <span className="text-[length:var(--text-sm)]">Buscar</span>
        <Kbd>{`${platformModifier()} K`}</Kbd>
      </button>

      {/* ── Aviso de datos de demostracion ────────────────────────────── */}
      {env.demoData && (
        <span
          className={cn(
            'hidden h-7 items-center gap-2 rounded-[var(--radius-full)] px-3 md:flex',
            'bg-[color-mix(in_oklab,var(--state-alert)_16%,transparent)]',
            'font-[family-name:var(--font-ui)] text-[length:var(--text-2xs)]',
            'font-[var(--weight-medium)] uppercase tracking-[var(--tracking-label)]',
            'text-[var(--text-warn)]',
          )}
          title="La aplicacion funciona en modo mock: las cifras son de demostracion, no datos reales."
        >
          Datos de demostracion
        </span>
      )}

      {/* ── Latido del sistema ─────────────────────────────────────────── */}
      <div className="hidden items-center gap-2.5 md:flex">
        <StatusIndicator state={state} size="sm" live />
        <span
          className={cn(
            'text-[length:var(--text-sm)]',
            state === 'alert' && 'text-[var(--text-warn)]',
            state === 'critical' && 'text-[var(--crimson-400)]',
            state === 'offline' && 'text-[var(--text-faint)]',
            (state === 'idle' || state === 'thinking') && 'text-[var(--text-muted)]',
          )}
        >
          {STATE_LABEL[state]}
        </span>
      </div>

      {/* ── Menu de usuario ────────────────────────────────────────────── */}
      <UserMenu
        initials={initials}
        name={profile ? profile.first_name : 'Invitado'}
        email={profile?.email}
        onSignOut={() => void signOut()}
      />
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MENU DE USUARIO — dropdown flotante
   ═══════════════════════════════════════════════════════════════════════════ */

interface UserMenuProps {
  initials: string;
  name: string;
  email?: string | undefined;
  onSignOut: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: typeof User;
  /** Si es true, se muestra un separador antes de este item. */
  separator?: boolean;
  danger?: boolean;
  action: () => void;
}

function UserMenu({ initials, name, email, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const items: MenuItem[] = [
    { id: 'profile', label: 'Perfil', icon: User, action: close },
    { id: 'settings', label: 'Configuracion', icon: Settings, action: close },
    { id: 'contact', label: 'Contactenos', icon: Mail, action: close },
    {
      id: 'logout',
      label: 'Cerrar sesion',
      icon: LogOut,
      separator: true,
      danger: true,
      action: () => {
        close();
        onSignOut();
      },
    },
  ];

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          'flex h-11 items-center gap-2.5 rounded-[var(--radius-full)] pl-1 pr-3',
          '[background:var(--glass-1)] shadow-[var(--rim-1)]',
          'transition-colors duration-200 hover:[background:var(--glass-2)]',
          open && '[background:var(--glass-2)]',
        )}
      >
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-[var(--radius-full)]',
            'font-[family-name:var(--font-data)] text-[length:var(--text-xs)]',
            'text-white',
          )}
          style={{ background: 'var(--grad-action)' }}
        >
          {initials}
        </span>
        <span className="hidden max-w-[120px] truncate text-[length:var(--text-sm)] text-[var(--text-secondary)] lg:block">
          {name}
        </span>
        <ChevronDown
          strokeWidth={1.5}
          className={cn(
            'size-4 text-[var(--icon-muted)] transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: easing.emerge }}
            className={cn(
              'absolute right-0 top-[calc(100%+8px)] z-50 w-[240px]',
              'rounded-[var(--radius-lg)] p-1.5',
              '[background:var(--glass-3)] shadow-[var(--rim-2),var(--drop-3)]',
              'backdrop-blur-[28px] [backdrop-saturate:1.5]',
            )}
            role="menu"
            aria-orientation="vertical"
          >
            {/* Encabezado del menu: identidad */}
            <div className="flex items-center gap-3 px-3 py-3">
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-full)]',
                  'font-[family-name:var(--font-data)] text-[length:var(--text-xs)]',
                  'text-white',
                )}
                style={{ background: 'var(--grad-action)' }}
              >
                {initials}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--text-primary)]">
                  {name}
                </span>
                {email && (
                  <span className="t-mono-xs truncate text-[var(--text-faint)]">
                    {email}
                  </span>
                )}
              </div>
            </div>

            {/* Separador tras el encabezado */}
            <div className="mx-2 my-1 h-px [background:var(--hairline)]" />

            {/*
              EL TEMA, COMO TRES OPCIONES Y NO COMO UNA ENTRADA QUE ABRE ALGO.

              Aqui habia un item «Temas» cuya accion era cerrar el menu: parecia que
              habia donde elegir y no lo habia, con el tema claro ya escrito y
              esperando en `daylight.css`.

              Se resuelve con las tres opciones a la vista en lugar de un submenu.
              Son tres, caben, y un submenu añadiria un clic para elegir entre tres
              cosas que se leen de un vistazo.
            */}
            <SelectorDeTema />

            <div className="mx-2 my-1 h-px [background:var(--hairline)]" />

            {/* Items */}
            {items.map((item) => (
              <MenuItemRow key={item.id} item={item} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Las tres opciones de tema, con la activa marcada.
 *
 * ── POR QUE «SISTEMA» DICE A QUE RESUELVE ──────────────────────────────────
 *
 * Con «Seguir al sistema» elegido, el usuario no sabe si eso es claro u oscuro sin
 * mirar la pantalla. La opcion lleva al lado el tema al que resuelve AHORA —«claro» u
 * «oscuro»— porque es la unica de las tres cuyo efecto no esta en su nombre.
 */
function SelectorDeTema() {
  const { preferencia, resuelto, elegir } = useTheme();
  const opciones: { id: ThemePreference; icono: typeof Sun }[] = [
    { id: 'daylight', icono: Sun },
    { id: 'dark', icono: Moon },
    { id: 'system', icono: Monitor },
  ];

  return (
    <div className="px-1.5 py-1">
      <span className="t-label px-1.5 text-[var(--text-faint)]">Tema</span>
      <div className="mt-1 flex flex-col gap-0.5" role="radiogroup" aria-label="Tema">
        {opciones.map(({ id, icono: Icono }) => {
          const activa = preferencia === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={activa}
              onClick={() => elegir(id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2',
                'text-left text-[length:var(--text-sm)] transition-colors',
                activa
                  ? 'text-[var(--text-primary)] [background:var(--glass-1)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:[background:var(--glass-1)]',
              )}
            >
              <Icono strokeWidth={1.5} className="size-4 shrink-0" />
              <span className="flex-1">{ETIQUETA_TEMA[id]}</span>
              {id === 'system' && (
                <span className="t-mono-xs text-[var(--text-faint)]">
                  {resuelto === 'daylight' ? 'claro' : 'oscuro'}
                </span>
              )}
              {activa && <Check strokeWidth={2} className="size-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MenuItemRow({ item }: { item: MenuItem }) {
  const Icon = item.icon;

  return (
    <>
      {item.separator && (
        <div className="mx-2 my-1 h-px [background:var(--hairline)]" />
      )}
      <button
        type="button"
        role="menuitem"
        onClick={item.action}
        className={cn(
          'flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5',
          'text-left text-[length:var(--text-sm)] transition-colors duration-150',
          item.danger
            ? 'text-[var(--crimson-400)] hover:[background:color-mix(in_oklab,var(--state-critical)_12%,transparent)]'
            : 'text-[var(--text-secondary)] hover:[background:var(--glass-1)] hover:text-[var(--text-primary)]',
        )}
      >
        <Icon strokeWidth={1.5} className="size-4 shrink-0" />
        <span>{item.label}</span>
      </button>
    </>
  );
}
