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
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Bot,
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
  Warehouse,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { NAV_ITEMS } from './navigation';
import { useShellStore } from './shellStore';
import { useSystemStore } from './systemStore';
import {
  useDismissNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from './useNotifications';
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
import type { AppNotification } from '../lib/notificationTypes';

const STATE_LABEL: Record<SystemState, string> = {
  idle: 'Nominal',
  thinking: 'Procesando',
  alert: 'Atencion',
  critical: 'Critico',
  offline: 'Sin conexion',
};

export function TopBar() {
  const location = useLocation();
  const olobotAbierto = useShellStore((s) => s.olobotAbierto);
  const alternarOlobot = useShellStore((s) => s.alternarOlobot);
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

      {/* ── Almacen activo ───────────────────────────────────────────── */}
      {/*
        Aqui y no solo dentro de Espacial: Inventario e Incidencias ya leen el
        mismo `activeWarehouseId` del store de sesion (via `useAlmacenActivo`),
        pero hasta ahora la UNICA forma de cambiarlo era entrar a una pantalla
        de Espacial, elegirlo alli, y volver. Alguien con dos almacenes no
        podia cambiar de almacen estando en Inventario o Incidencias.

        No es el `WarehousePicker` de Espacial: ese enseña racks/cuerpos/
        ubicaciones, que aqui no pintan nada — es una version minima, y solo
        se muestra si hay algo real que elegir.
      */}
      <SelectorDeAlmacen />

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

      {/* ── OLOBOT ───────────────────────────────────────────────────── */}
      {/*
        Junto al buscador y no en la barra lateral: es una herramienta transversal
        —se usa MIRANDO otra pantalla—, no un módulo al que se navega. Un icono en
        la barra lateral lo pondría al nivel de «Inventario» y sugeriría que tiene
        su propia página, que es justo lo que no tiene.
      */}
      <button
        type="button"
        onClick={alternarOlobot}
        aria-label="Abrir OLOBOT"
        aria-pressed={olobotAbierto}
        className={cn(
          'flex h-10 items-center gap-2 rounded-[var(--radius-full)] px-3',
          'shadow-[var(--rim-1)] transition-colors duration-200',
          olobotAbierto
            ? '[background:var(--glass-2)] text-[var(--text-accent)]'
            : '[background:var(--glass-1)] text-[var(--text-faint)] hover:text-[var(--text-secondary)]',
        )}
      >
        <Bot strokeWidth={1.5} className="size-4" />
        <span className="hidden text-[length:var(--text-sm)] lg:inline">OLOBOT</span>
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

      {/* ── Avisos ───────────────────────────────────────────────────────── */}
      <NotificationBell />

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
   SELECTOR DE ALMACEN — version minima, para cambiar desde cualquier modulo
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sin provider a proposito: esta barra se renderiza en TODAS las rutas, y
 * `<SpatialProvider>` solo envuelve las de Espacial. Se pide directo a la API,
 * igual que `useAlmacenActivo()` de Inventario resuelve el mismo problema.
 */
function useAlmacenesDelSelector() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['shell', 'warehouses'] as const,
    queryFn: async () => {
      const filas = await api.get<
        { warehouse_id: string; warehouse_code: string; warehouse_name: string }[]
      >('/spatial/warehouses');
      return filas.map((f) => ({
        id: f.warehouse_id,
        code: f.warehouse_code,
        name: f.warehouse_name,
      }));
    },
    staleTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function SelectorDeAlmacen() {
  const activo = useSessionStore((s) => s.activeWarehouseId);
  const fijar = useSessionStore((s) => s.setActiveWarehouse);
  const { data: almacenes, isLoading } = useAlmacenesDelSelector();

  //  Sin ambiguedad real no hay nada que mostrar: ni cargando, ni con cero o
  //  un solo almacen. Es el mismo criterio que ya aplica `WarehousePicker` en
  //  Espacial — elegir por el operador cuando solo hay una opcion es ruido.
  if (isLoading || !almacenes || almacenes.length <= 1) return null;

  return (
    <label
      className={cn(
        'hidden h-10 items-center gap-2 rounded-[var(--radius-full)] px-3 md:flex',
        '[background:var(--glass-1)] shadow-[var(--rim-1)]',
        'focus-within:shadow-[var(--focus-ring)]',
      )}
    >
      <Warehouse strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
      <select
        value={activo ?? ''}
        onChange={(e) => fijar(e.target.value || null)}
        aria-label="Almacen activo"
        className="max-w-[140px] bg-transparent text-[length:var(--text-sm)] text-[var(--text-secondary)] outline-none"
      >
        {!activo && <option value="">Elige un almacén…</option>}
        {almacenes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAMPANA DE AVISOS — mismo patron de dropdown que UserMenu
   ═══════════════════════════════════════════════════════════════════════════ */

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const avisos = useNotifications();
  const marcarLeida = useMarkNotificationRead();
  const marcarTodas = useMarkAllNotificationsRead();
  const descartar = useDismissNotification();

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

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

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const lista = avisos.data?.notifications ?? [];
  const noLeidas = avisos.data?.unread_count ?? 0;

  const abrir = (n: AppNotification) => {
    if (!n.read_at) marcarLeida.mutate(n.id);
    close();
    if (n.link) navigate(n.link);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={noLeidas > 0 ? `Avisos, ${noLeidas} sin leer` : 'Avisos'}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-[var(--radius-full)]',
          '[background:var(--glass-1)] shadow-[var(--rim-1)]',
          'text-[var(--text-faint)] transition-colors duration-200',
          'hover:[background:var(--glass-2)] hover:text-[var(--text-secondary)]',
          open && '[background:var(--glass-2)] text-[var(--text-secondary)]',
        )}
      >
        <Bell strokeWidth={1.5} className="size-4" />
        {noLeidas > 0 && (
          <span
            className={cn(
              'absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center',
              'rounded-[var(--radius-full)] px-1 font-[family-name:var(--font-data)]',
              'text-[length:9px] font-[var(--weight-medium)] text-white',
              '[background:var(--state-alert)]',
            )}
          >
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: easing.emerge }}
            className={cn(
              'absolute right-0 top-[calc(100%+8px)] z-50 w-[360px]',
              'rounded-[var(--radius-lg)] p-1.5',
              '[background:var(--glass-3)] shadow-[var(--rim-2),var(--drop-3)]',
              'backdrop-blur-[28px] [backdrop-saturate:1.5]',
            )}
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="t-label text-[var(--text-faint)]">Avisos</span>
              {noLeidas > 0 && (
                <button
                  type="button"
                  onClick={() => marcarTodas.mutate()}
                  className="t-mono-xs text-[var(--text-accent)] hover:underline"
                >
                  marcar todo leido
                </button>
              )}
            </div>
            <div className="mx-2 mb-1 h-px [background:var(--hairline)]" />

            <div className="flex max-h-[420px] flex-col gap-0.5 overflow-y-auto">
              {avisos.isLoading ? (
                <p className="px-3 py-4 text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
                  Cargando…
                </p>
              ) : lista.length === 0 ? (
                <p className="px-3 py-6 text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
                  Sin avisos todavia
                </p>
              ) : (
                lista.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      'group flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2.5',
                      'cursor-pointer text-left transition-colors',
                      n.read_at
                        ? 'hover:[background:var(--glass-1)]'
                        : '[background:var(--glass-1)] hover:[background:var(--glass-2)]',
                    )}
                    onClick={() => abrir(n)}
                  >
                    {!n.read_at && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full [background:var(--text-accent)]" />
                    )}
                    <div className={cn('min-w-0 flex-1', n.read_at && 'pl-3.5')}>
                      <p className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                        {n.title}
                      </p>
                      <p className="line-clamp-2 text-[length:var(--text-xs)] text-[var(--text-faint)]">
                        {n.body}
                      </p>
                      <span className="t-mono-xs text-[var(--text-faint)]">
                        {new Date(n.created_at).toLocaleString('es')}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label="Descartar"
                      onClick={(e) => {
                        e.stopPropagation();
                        descartar.mutate(n.id);
                      }}
                      className="mt-0.5 shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] group-hover:opacity-100"
                    >
                      <X strokeWidth={1.5} className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
