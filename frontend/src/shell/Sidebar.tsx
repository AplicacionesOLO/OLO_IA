/**
 * SIDEBAR — navegacion integrada en el lienzo.
 *
 * 244px, pildora de cristal activa, sin bordes. Los modulos no operativos se
 * muestran atenuados con su estado real, no ocultos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS MODOS, Y POR QUE EL RECOGIDO NO DESAPARECE DEL TODO
 *
 * · ANCLADA — ocupa sus 244px siempre. Es el comportamiento por defecto.
 *
 * · RECOGIDA — deja un carril de 76px y se despliega al acercar el cursor. El
 *   carril NO es decorativo: mantiene los iconos navegables y da la zona sobre la
 *   que aparecer. Una barra que se esconde por completo obliga a apuntar a un
 *   borde invisible de tres pixeles, y en una pantalla de almacen —con guantes y
 *   con prisa— eso no se acierta.
 *
 * Al desplegarse en modo recogido FLOTA sobre el contenido en lugar de empujarlo:
 * si empujara, cada pasada del raton reflowaria la tabla de 29.312 ubicaciones que
 * hay al lado. Por eso, y solo entonces, la barra tiene superficie propia: sin ella
 * el texto de debajo se leeria a traves.
 *
 * El teclado no queda fuera: `focus-within` la despliega igual que el cursor, asi
 * que tabular llega a los enlaces con sus etiquetas visibles.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Pin, PinOff } from 'lucide-react';
import {
  MODULE_STATUS_META,
  NAV_GROUPS,
  resolveNavItems,
  type NavAvailability,
  type ResolvedNavItem,
} from './navigation';
import { useSessionStore } from '../auth/sessionStore';
import { useSystemStore } from './systemStore';
import { useShellStore } from './shellStore';
import { useLayers } from '../design/capability/LayerContext';
import { cn } from '../design/utils/cn';

export function Sidebar() {
  const openIncidents = useSystemStore((s) => s.openIncidents);
  const syncErrors = useSystemStore((s) => s.syncErrors);
  const { maxLayer } = useLayers();

  const anclada = useShellStore((s) => s.sidebarPinned);
  const alternarAnclada = useShellStore((s) => s.toggleSidebarPinned);
  const [cerca, setCerca] = useState(false);
  const desplegada = anclada || cerca;
  const flotando = !anclada && cerca;

  const permissions = useSessionStore((s) => s.profile?.permissions);

  const items = useMemo(() => {
    const list = permissions ?? [];
    const check = (permission: string) => {
      if (list.includes(permission)) return true;
      const [module] = permission.split(':');
      return list.includes(`${module}:*`);
    };
    return resolveNavItems(check, maxLayer);
  }, [permissions, maxLayer]);

  const badgeFor = (item: ResolvedNavItem): number | null => {
    if (item.availability !== 'live') return null;
    if (item.badgeKey === 'incidents') return openIncidents || null;
    if (item.badgeKey === 'syncErrors') return syncErrors || null;
    return null;
  };

  return (
    // El hueco reservado en el flujo. Cambia de ancho SOLO al anclar o desanclar,
    // nunca al pasar el cursor: asi el contenido no se mueve mientras se navega.
    <div
      className={cn(
        'relative z-30 hidden shrink-0 lg:block',
        'transition-[width] duration-[240ms] ease-out',
        anclada ? 'w-[var(--sidebar-width)]' : 'w-[var(--sidebar-width-collapsed)]',
      )}
      onMouseEnter={() => setCerca(true)}
      onMouseLeave={() => setCerca(false)}
      onFocusCapture={() => setCerca(true)}
      onBlurCapture={() => setCerca(false)}
    >
      <nav
        aria-label="Navegacion principal"
        className={cn(
          'absolute inset-y-0 left-0 flex flex-col',
          'pb-[var(--space-6)] transition-[width,background-color,box-shadow] duration-[240ms] ease-out',
          desplegada
            ? 'w-[var(--sidebar-width)] px-[var(--space-4)]'
            : 'w-[var(--sidebar-width-collapsed)] px-[var(--space-2)]',
          // Superficie propia SOLO cuando flota sobre el contenido.
          flotando &&
            '[background:var(--glass-2)] shadow-[var(--rim-2),var(--drop-3)] backdrop-blur-[28px] [backdrop-saturate:1.5]',
        )}
      >
        <BrandBlock
          desplegada={desplegada}
          anclada={anclada}
          onAlternar={alternarAnclada}
        />

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-[var(--space-7)] pt-[var(--space-2)]',
            // Sin desplegar no hay barra de scroll: en 76px ocuparia un tercio del
            // ancho. Los grupos caben porque las etiquetas de grupo se ocultan.
            desplegada ? 'overflow-y-auto' : 'overflow-hidden',
          )}
        >
          {NAV_GROUPS.map((group) => {
            const groupItems = items.filter((i) => i.group === group.id);
            if (groupItems.length === 0) return null;

            return (
              <div key={group.id} className="flex flex-col gap-[var(--space-1)]">
                {group.label && desplegada && (
                  <span className="t-label px-[var(--space-4)] pb-[var(--space-2)]">
                    {group.label}
                  </span>
                )}
                {groupItems.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    badge={badgeFor(item)}
                    desplegada={desplegada}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * Bloque de marca. 72px para alinear con la TopBar.
 *
 * La marca ES el enlace al inicio: es donde todo el mundo pulsa para volver, y
 * hasta ahora no llevaba a ningun sitio. `end` para que solo se marque activa en
 * `/` y no en cada ruta que empiece por barra.
 *
 * El ancla vive aqui al lado y no en la TopBar porque anclar es una propiedad de
 * esta barra: el control tiene que estar donde esta el efecto.
 */
function BrandBlock({
  desplegada,
  anclada,
  onAlternar,
}: {
  desplegada: boolean;
  anclada: boolean;
  onAlternar: () => void;
}) {
  return (
    <div
      className={cn(
        'flex h-[var(--topbar-height)] shrink-0 items-center gap-3',
        desplegada ? 'px-[var(--space-4)]' : 'justify-center px-0',
      )}
    >
      <NavLink
        to="/"
        end
        aria-label="OLO IA · ir al inicio"
        title="Ir al inicio"
        className={cn(
          'flex min-w-0 items-center gap-3 rounded-[var(--radius-sm)]',
          'transition-opacity duration-200 hover:opacity-80',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        )}
      >
        <LogoMark />
        {desplegada && (
          <div className="flex min-w-0 flex-col">
            <span className="text-[length:var(--text-md)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              OLO<span className="text-[var(--text-accent)]"> IA</span>
            </span>
            <span className="t-mono-xs truncate text-[var(--text-faint)]">
              Neural Warehouse OS
            </span>
          </div>
        )}
      </NavLink>

      {desplegada && (
        <button
          type="button"
          onClick={onAlternar}
          aria-pressed={anclada}
          aria-label={anclada ? 'Desanclar la barra lateral' : 'Anclar la barra lateral'}
          title={
            anclada
              ? 'Desanclar: la barra se recoge y aparece al acercar el cursor'
              : 'Anclar: la barra se queda fija'
          }
          className={cn(
            'ml-auto flex size-8 shrink-0 items-center justify-center',
            'rounded-[var(--radius-sm)] transition-colors duration-200',
            anclada
              ? 'text-[var(--icon-accent)] [background:var(--glass-1)]'
              : 'text-[var(--icon-muted)] hover:text-[var(--icon-primary)] hover:[background:var(--glass-1)]',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
          )}
        >
          {anclada ? (
            <Pin strokeWidth={1.5} className="size-4" />
          ) : (
            <PinOff strokeWidth={1.5} className="size-4" />
          )}
        </button>
      )}
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
      <g stroke="var(--accent)" strokeWidth="1.1" fill="none" opacity="0.45">
        <line x1="17" y1="17" x2="30" y2="8" />
        <line x1="17" y1="17" x2="5" y2="10" />
        <line x1="17" y1="17" x2="9" y2="28" />
        <line x1="17" y1="17" x2="28" y2="26" />
      </g>
      <g fill="var(--accent)" className="olo-breathe">
        <circle cx="30" cy="8" r="1.8" opacity="0.75" />
        <circle cx="5" cy="10" r="1.8" opacity="0.75" />
        <circle cx="9" cy="28" r="1.8" opacity="0.75" />
        <circle cx="28" cy="26" r="1.8" opacity="0.75" />
      </g>
      <circle cx="17" cy="17" r="5" fill="var(--accent)" />
      <circle cx="17" cy="17" r="2.2" fill="var(--abyss-1000)" />
    </svg>
  );
}

/** Color de cada disponibilidad en la sidebar. */
const DOT_COLOR: Record<NavAvailability, string> = {
  live: 'transparent',
  'coming-soon': 'var(--iris-400)',
  'not-in-catalog': 'var(--text-faint)',
  'no-permission': 'var(--state-alert)',
  'higher-layer': 'var(--text-faint)',
};

function SidebarItem({
  item,
  badge,
  desplegada,
}: {
  item: ResolvedNavItem;
  badge: number | null;
  desplegada: boolean;
}) {
  const Icon = item.icon;
  const operativo = item.availability === 'live';
  const meta = MODULE_STATUS_META[item.moduleStatus];

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      aria-label={`${item.label}. ${meta.label}.`}
      title={`${item.label} · ${meta.label}${item.targetVersion ? ` · ${item.targetVersion}` : ''}`}
      className={({ isActive }) =>
        cn(
          'group relative flex min-h-11 items-center gap-3',
          'rounded-[var(--radius-sm)] py-[var(--space-2)]',
          desplegada ? 'px-[var(--space-4)]' : 'justify-center px-0',
          'transition-colors duration-[200ms]',
          'focus-visible:outline-2 focus-visible:outline-offset-1',
          'focus-visible:outline-[var(--accent)] focus-visible:shadow-none',
          isActive
            ? 'text-[var(--text-primary)]'
            : operativo
              ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="olo-nav-active"
              aria-hidden
              className="absolute inset-0 rounded-[var(--radius-sm)]"
              style={{
                background: 'var(--glass-2)',
                boxShadow: 'var(--rim-2), var(--aura-idle)',
              }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          )}

          {!isActive && (
            <span
              aria-hidden
              className={cn(
                'absolute inset-0 rounded-[var(--radius-sm)] opacity-0',
                'transition-opacity duration-[200ms]',
                'group-hover:opacity-100',
              )}
              style={{ background: 'var(--glass-1)' }}
            />
          )}

          <span className="relative shrink-0">
            <Icon
              strokeWidth={1.5}
              className={cn(
                'size-[18px] transition-colors',
                isActive
                  ? 'text-[var(--icon-accent)]'
                  : operativo
                    ? 'text-[var(--icon-muted)]'
                    : 'text-[var(--text-faint)]',
                'group-hover:text-[var(--icon-primary)]',
              )}
            />

            {/*
              Recogida, la señal se pega al icono: es lo unico que se ve, y perder
              el aviso de una incidencia abierta por haber recogido la barra seria
              cambiar comodidad por informacion.
            */}
            {!desplegada && badge !== null && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-2 rounded-full ring-2 ring-[var(--canvas)]"
                style={{ background: 'var(--state-alert)' }}
              />
            )}
            {!desplegada && badge === null && !operativo && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-1.5 rounded-full"
                style={{ background: DOT_COLOR[item.availability] }}
              />
            )}
          </span>

          {desplegada && (
            <>
              <span className="relative flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[length:var(--text-sm)] leading-tight">
                  {item.label}
                </span>
                {item.subtitle && (
                  <span className="t-mono-xs truncate leading-tight text-[var(--text-faint)]">
                    {operativo ? item.subtitle : meta.label}
                  </span>
                )}
              </span>

              {/* Punto de estado: solo para no-operativos */}
              {!operativo && (
                <span
                  aria-hidden
                  className="relative size-1.5 shrink-0 self-center rounded-full"
                  style={{ background: DOT_COLOR[item.availability] }}
                />
              )}

              {badge !== null && (
                <span
                  className={cn(
                    'relative ml-auto flex h-5 min-w-5 items-center justify-center px-1.5',
                    'rounded-[var(--radius-full)]',
                    'bg-[color-mix(in_oklab,var(--state-alert)_20%,transparent)]',
                    'font-[family-name:var(--font-data)] text-[length:var(--text-2xs)]',
                    'leading-none text-[var(--text-warn)]',
                  )}
                >
                  {badge}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}
