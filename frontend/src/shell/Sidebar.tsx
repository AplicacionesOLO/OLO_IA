/**
 * SIDEBAR — navegacion integrada en el lienzo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUE CAMBIA RESPECTO AL `Spine` ANTERIOR
 *
 * El Spine era una columna de 56px de iconos sobre una superficie con borde
 * derecho, con hairlines separando los grupos. Eso es la barra de herramientas
 * de un SCADA.
 *
 * Este componente:
 *   · 244px, con las ETIQUETAS SIEMPRE VISIBLES. Un icono sin texto obliga al
 *     usuario a memorizar o a esperar un tooltip; ninguna de las dos cosas pasa
 *     en Linear ni en VisionOS.
 *   · NO tiene borde derecho ni separadores. La sidebar no es un panel: es parte
 *     del lienzo. La separacion la produce el espacio, no una linea.
 *   · El item activo es una PILDORA de cristal con halo, no una barra de acento
 *     de 2px sobre un fondo teñido.
 *   · Los grupos se separan con 28px de aire y una etiqueta en mayusculas muy
 *     tenue — el unico uso legitimo de las mayusculas en el sistema.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AVAILABILITY_LABEL,
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

  // ── Por que se suscribe a `permissions` y no a `hasPermission` ──────────
  // `hasPermission` es un metodo del store de Zustand: su referencia NUNCA
  // cambia. Usarlo como dependencia del useMemo haria que la navegacion no se
  // recalculase al cambiar los permisos, incumpliendo RF-RBAC-007 (el cambio de
  // permisos surte efecto inmediato, sin re-login).
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
    // Un contador sobre un modulo que no existe seria una cifra inventada.
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

        <NavLegend items={items} />
      </div>
    </nav>
  );
}

/** Color de cada estado. `live` no lleva punto: lo normal no se señala. */
const DOT_COLOR: Record<NavAvailability, string> = {
  live: 'transparent',
  placeholder: 'var(--state-idle)',
  'not-in-catalog': 'var(--state-thinking)',
  'no-permission': 'var(--state-alert)',
  'higher-layer': 'var(--text-faint)',
};

/**
 * Leyenda de las señales.
 *
 * Sin ella, los puntos de color son decoracion: el usuario ve que hay tres
 * estados pero no cuales. Solo enumera los estados PRESENTES, para que no crezca
 * con casos que no estan en pantalla.
 */
function NavLegend({ items }: { items: ResolvedNavItem[] }) {
  const presentes = useMemo(() => {
    const orden: NavAvailability[] = [
      'live',
      'placeholder',
      'not-in-catalog',
      'no-permission',
      'higher-layer',
    ];
    const cuenta = new Map<NavAvailability, number>();
    for (const i of items) cuenta.set(i.availability, (cuenta.get(i.availability) ?? 0) + 1);
    return orden.filter((a) => cuenta.has(a)).map((a) => ({ a, n: cuenta.get(a) ?? 0 }));
  }, [items]);

  if (presentes.length <= 1) return null;

  return (
    // Compacta y en flujo, no `mt-auto`. Con 12 modulos a dos lineas, una leyenda
    // de cinco filas al fondo del contenido quedaba siempre fuera de la vista.
    // Asi cabe en dos lineas justo tras el ultimo grupo, y de paso funciona como
    // recuento: cuantos modulos hay en cada estado.
    <div className="flex flex-col gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)]">
      <span className="t-label text-[var(--text-faint)]">Estado de los modulos</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {presentes.map(({ a, n }) => (
          <span key={a} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: a === 'live' ? 'var(--accent)' : DOT_COLOR[a] }}
            />
            <span className="t-mono-xs text-[var(--text-faint)]">
              {n} {AVAILABILITY_LABEL[a]}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Bloque de marca.
 *
 * 72px de alto para alinearse EXACTAMENTE con la altura de la TopBar: el logo y
 * el titulo de la vista comparten linea base. Una desalineacion de unos pocos
 * pixeles ahi es lo que separa una interfaz cuidada de una improvisada.
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

/** La marca es la Mesh reducida a un glifo: un nucleo con sus conexiones. */
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

function SidebarItem({ item, badge }: { item: ResolvedNavItem; badge: number | null }) {
  const Icon = item.icon;
  const operativo = item.availability === 'live';
  const estado = AVAILABILITY_LABEL[item.availability];

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      // El nombre accesible incluye familia y estado: quien navega con lector de
      // pantalla necesita la misma informacion que las señales visuales dan.
      aria-label={`${item.label}. Familia ${item.family}. Estado: ${estado}.`}
      title={`${item.label} · familia ${item.family} · ${estado}`}
      className={({ isActive }) =>
        cn(
          'group relative flex min-h-11 items-center gap-3',
          'rounded-[var(--radius-sm)] px-[var(--space-4)] py-[var(--space-2)]',
          'transition-colors duration-[200ms]',
          // Foco con outline y no con box-shadow: la pildora activa usa
          // box-shadow para su halo, y los dos se pisarian.
          'focus-visible:outline-2 focus-visible:outline-offset-1',
          'focus-visible:outline-[var(--accent)] focus-visible:shadow-none',
          isActive
            ? 'text-[var(--text-primary)]'
            : operativo
              ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              // Atenuado, no deshabilitado: la ruta existe y lleva a un
              // marcador honesto, asi que se puede visitar para inspeccionarlo.
              : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* La pildora activa se DESPLAZA entre items en lugar de saltar:
              `layoutId` compartido hace que Framer interpole su posicion. Es un
              detalle pequeño con impacto grande — comunica que la sidebar es un
              objeto continuo y no una lista de enlaces. */}
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

          {/* Hover: tinte aun mas leve que la pildora activa. Se hace con un
              span y no con `hover:bg-*` para que quede por DEBAJO del icono y
              del texto sin necesidad de z-index en ellos. */}
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

          {/* Dos lineas: el nombre y, debajo, la FAMILIA a la que pertenece.
              Es la señal que permite ver de un vistazo que Inventario e
              Incidencias son la misma familia `inventory`, o que Vision depende
              de `inference`, que todavia no existe en el backend. */}
          <span className="relative flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[length:var(--text-sm)] leading-tight">
              {item.label}
            </span>
            {/* Sin `truncate`: la familia y el estado son la informacion que se
                vino a buscar aqui, y `integrations · pendiente` no cabe en una
                linea de 244px. Antes se cortaba en `integrations · fas…`, que es
                justo la parte que importa. Envuelve en lugar de esconder. */}
            <span className="t-mono-xs leading-tight break-words text-[var(--text-faint)]">
              {item.family}
              {!operativo && ` · ${estado}`}
            </span>
          </span>

          {/* Punto de estado. Ausente cuando el modulo esta operativo: lo normal
              no necesita señal, y marcar todo equivale a no marcar nada. */}
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
