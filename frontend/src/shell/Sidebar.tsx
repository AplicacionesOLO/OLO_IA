/**
 * SIDEBAR — navegacion integrada en el lienzo.
 *
 * 244px, etiquetas siempre visibles, pildora de cristal activa, sin bordes.
 * Los modulos no operativos se muestran atenuados con su estado real, no ocultos.
 */

import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  MODULE_STATUS_META,
  NAV_GROUPS,
  resolveNavItems,
  type NavAvailability,
  type ResolvedNavItem,
} from './navigation';
import { useSessionStore } from '../auth/sessionStore';
import { useSystemStore } from './systemStore';
import { useLayers } from '../design/capability/LayerContext';
import { cn } from '../design/utils/cn';

export function Sidebar() {
  const openIncidents = useSystemStore((s) => s.openIncidents);
  const syncErrors = useSystemStore((s) => s.syncErrors);
  const { maxLayer } = useLayers();

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
    <nav
      aria-label="Navegacion principal"
      className={cn(
        'relative z-20 hidden shrink-0 flex-col lg:flex',
        'w-[var(--sidebar-width)]',
        'px-[var(--space-4)] pb-[var(--space-6)]',
      )}
    >
      <BrandBlock />

      <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-7)] overflow-y-auto pt-[var(--space-2)]">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group.id);
          if (groupItems.length === 0) return null;

          return (
            <div key={group.id} className="flex flex-col gap-[var(--space-1)]">
              {group.label && (
                <span className="t-label px-[var(--space-4)] pb-[var(--space-2)]">
                  {group.label}
                </span>
              )}
              {groupItems.map((item) => (
                <SidebarItem key={item.id} item={item} badge={badgeFor(item)} />
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Bloque de marca. 72px para alinear con la TopBar.
 */
function BrandBlock() {
  return (
    <div className="flex h-[var(--topbar-height)] shrink-0 items-center gap-3 px-[var(--space-4)]">
      <LogoMark />
      <div className="flex min-w-0 flex-col">
        <span className="text-[length:var(--text-md)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
          OLO<span className="text-[var(--accent)]"> IA</span>
        </span>
        <span className="t-mono-xs truncate text-[var(--text-faint)]">
          Neural Warehouse OS
        </span>
      </div>
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

function SidebarItem({ item, badge }: { item: ResolvedNavItem; badge: number | null }) {
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
          'rounded-[var(--radius-sm)] px-[var(--space-4)] py-[var(--space-2)]',
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

          <Icon
            strokeWidth={1.5}
            className={cn(
              'relative size-[18px] shrink-0 transition-colors',
              isActive
                ? 'text-[var(--icon-accent)]'
                : operativo
                  ? 'text-[var(--icon-muted)]'
                  : 'text-[var(--text-faint)]',
              'group-hover:text-[var(--icon-primary)]',
            )}
          />

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
                'leading-none text-[var(--ember-400)]',
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
