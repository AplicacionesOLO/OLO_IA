/**
 * MODELO DE NAVEGACION
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECLARATIVO Y GENERICO.
 *
 * El Spine renderiza este modelo sin saber que es "Inventario". Añadir un modulo
 * es añadir una entrada aqui: el componente de navegacion no se toca nunca.
 *
 * Los grupos son las TRES CAPAS COGNITIVAS del ADN (percepcion, cognicion,
 * accion), no categorias arbitrarias. Son estables porque describen como piensa
 * el sistema, no como esta organizado el codigo.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  Activity,
  Boxes,
  BrainCircuit,
  Cctv,
  Cog,
  Compass,
  Layers,
  LineChart,
  PlaneTakeoff,
  ScrollText,
  ShieldAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Las tres capas cognitivas, mas el grupo de sistema. */
export type NavGroupId = 'command' | 'perception' | 'cognition' | 'action' | 'system';

export interface NavGroup {
  id: NavGroupId;
  /** Ausente en `command`: no necesita encabezado. */
  label?: string;
}

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Permiso necesario para operar el modulo. */
  permission?: string;
  /** Capa visual en la que el modulo estara disponible. */
  availableFromLayer?: 1 | 2 | 3 | 4 | 5;
  /** Contador dinamico (alertas abiertas, por ejemplo). */
  badgeKey?: 'incidents' | 'syncErrors';

  /**
   * Familia de dominio a la que pertenece el modulo.
   *
   * Es el prefijo del permiso, y es la SEÑAL que permite saber que agrupa que:
   * Inventario e Incidencias comparten la familia `inventory`, asi que un cambio
   * en los permisos de inventario afecta a los dos. Sin esta marca visible, esa
   * relacion solo se descubre leyendo el codigo.
   */
  family: string;

  /**
   * ¿Existe la PANTALLA real, o es todavia un marcador?
   *
   * Solo Overview esta implementado. El resto renderiza `PlaceholderPage`, que es
   * honesta al respecto. Se declara aqui para que la navegacion pueda decirlo
   * ANTES de que el usuario haga clic, en lugar de despues.
   */
  implemented?: boolean;

  /**
   * ¿Existe la familia de permisos en el catalogo del backend?
   *
   * `core.permissions` (migracion 0013) define 30 permisos y NO incluye siete
   * familias que la interfaz ya contempla: ai_models, datasets, inference,
   * training, drones, missions, integrations.
   *
   * ⚠ Hay que actualizar esta marca cuando una migracion añada la familia. Se
   * declara a mano y no se deduce porque el frontend no puede consultar el
   * catalogo: `/auth/me` devuelve los permisos DEL USUARIO, no los que existen.
   * Sin la distincion, «no tienes permiso» y «esto aun no existe» se confunden,
   * y son dos problemas con soluciones opuestas.
   */
  inCatalog?: boolean;
}

/** Por que un modulo no esta operativo. Cada valor pide una accion distinta. */
export type NavAvailability =
  /** Operativo: pantalla real y permiso concedido. */
  | 'live'
  /** Permiso concedido, pantalla aun no construida. */
  | 'placeholder'
  /** La familia de permisos no existe todavia en el backend. */
  | 'not-in-catalog'
  /** Existe y el permiso tambien, pero este usuario no lo tiene. */
  | 'no-permission'
  /** Requiere una capa visual superior a la activa. */
  | 'higher-layer';

export interface ResolvedNavItem extends NavItem {
  availability: NavAvailability;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'command' },
  { id: 'perception', label: 'Percepcion' },
  { id: 'cognition', label: 'Cognicion' },
  { id: 'action', label: 'Accion' },
  { id: 'system', label: 'Sistema' },
];

export const NAV_ITEMS: readonly NavItem[] = [
  // ── Mando ────────────────────────────────────────────────────────────
  {
    id: 'overview',
    label: 'Overview',
    path: '/',
    icon: Compass,
    group: 'command',
    family: 'dashboard',
    implemented: true,
    inCatalog: true,
  },

  // ── Percepcion: lo que el sistema capta ──────────────────────────────
  {
    id: 'twin',
    label: 'Digital Twin',
    path: '/twin',
    icon: Layers,
    group: 'perception',
    availableFromLayer: 2,
    family: 'twin',
    inCatalog: true, // no exige permiso: depende de la capa visual
  },
  {
    id: 'vision',
    label: 'Vision',
    path: '/vision',
    icon: Cctv,
    group: 'perception',
    permission: 'inference:read',
    family: 'inference',
    inCatalog: false,
  },
  {
    id: 'fleet',
    label: 'Flota',
    path: '/fleet',
    icon: PlaneTakeoff,
    group: 'perception',
    permission: 'drones:read',
    family: 'drones',
    inCatalog: false,
  },

  // ── Cognicion: lo que el sistema deduce ──────────────────────────────
  {
    // Modulo de IA, IMPLEMENTADO. Los permisos existen desde la migracion 0023 y el
    // CRUD desde el Bloque 1, asi que deja de estar en «fase 1».
    //
    // El permiso es `ai_projects:read` y no `ai_models:read` porque la pantalla de
    // entrada es la lista de proyectos: un modelo vive dentro de uno.
    id: 'intelligence',
    label: 'Inteligencia',
    path: '/ai/projects',
    icon: BrainCircuit,
    group: 'cognition',
    permission: 'ai_projects:read',
    family: 'ai_projects',
    implemented: true,
    inCatalog: true,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    path: '/analytics',
    icon: LineChart,
    group: 'cognition',
    permission: 'reports:read',
    family: 'reports',
    inCatalog: true,
  },

  // ── Accion: lo que el sistema ejecuta ────────────────────────────────
  {
    id: 'inventory',
    label: 'Inventario',
    path: '/inventory',
    icon: Boxes,
    group: 'action',
    permission: 'inventory:read',
    family: 'inventory',
    inCatalog: true,
  },
  {
    id: 'incidents',
    label: 'Incidencias',
    path: '/incidents',
    icon: ShieldAlert,
    group: 'action',
    permission: 'inventory:read',
    badgeKey: 'incidents',
    // Misma familia que Inventario: no tiene permisos propios todavia.
    family: 'inventory',
    inCatalog: true,
  },
  {
    id: 'integration',
    label: 'Integraciones',
    path: '/integration',
    icon: Workflow,
    group: 'action',
    permission: 'integrations:read',
    badgeKey: 'syncErrors',
    family: 'integrations',
    inCatalog: false,
  },

  // ── Sistema ──────────────────────────────────────────────────────────
  {
    id: 'admin',
    label: 'Administracion',
    path: '/admin',
    icon: Cog,
    group: 'system',
    permission: 'warehouses:read',
    family: 'warehouses',
    inCatalog: true,
  },
  {
    id: 'audit',
    label: 'Auditoria',
    path: '/audit',
    icon: ScrollText,
    group: 'system',
    permission: 'audit:read',
    family: 'audit',
    inCatalog: true,
  },
  {
    id: 'vitals',
    label: 'Salud',
    path: '/vitals',
    icon: Activity,
    group: 'system',
    family: 'system',
    inCatalog: true,
  },
];

/**
 * Anota cada modulo con su estado en lugar de ocultarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE YA NO SE FILTRA
 *
 * Antes esto era `visibleNavItems`, que eliminaba de la lista todo modulo sin
 * permiso. El efecto medido: un `tenant_admin` con los 30 permisos que EXISTEN
 * —o sea, con todo— veia 7 entradas, mientras el modo mock mostraba 12. La
 * diferencia parecia un fallo de permisos del usuario y no lo era: cuatro de esas
 * familias no existen todavia en `core.permissions`.
 *
 * Ocultar convertia tres situaciones distintas en el mismo vacio:
 *   · no tienes permiso              → lo arregla un administrador
 *   · el permiso aun no existe       → lo arregla una migracion
 *   · la pantalla aun no existe      → lo arregla implementarla
 *
 * Ahora se muestran todos, marcados. Es un INVENTARIO del producto en lugar de
 * una lista de enlaces, y cada marca dice de quien es el siguiente paso.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠ Sigue siendo SOLO interfaz. La autorizacion la aplican el backend y RLS;
 * mostrar un item no concede nada, y cada ruta no implementada aterriza en
 * `PlaceholderPage`, no en un 403 ni en un 404.
 */
export function resolveNavItems(
  hasPermission: (p: string) => boolean,
  currentLayer: number,
): ResolvedNavItem[] {
  return NAV_ITEMS.map((item) => ({ ...item, availability: resolveAvailability(item, hasPermission, currentLayer) }));
}

function resolveAvailability(
  item: NavItem,
  hasPermission: (p: string) => boolean,
  currentLayer: number,
): NavAvailability {
  // La capa visual se comprueba primero: es la unica razon que no depende del
  // usuario ni del backend, solo de la configuracion del despliegue.
  if (item.availableFromLayer && item.availableFromLayer > currentLayer) {
    return 'higher-layer';
  }
  // El catalogo antes que el permiso: si la familia no existe, NADIE puede tener
  // el permiso, y decir «no tienes permiso» seria enviar al usuario a pedirselo
  // a un administrador que no puede concederlo.
  if (item.inCatalog === false) return 'not-in-catalog';
  if (item.permission && !hasPermission(item.permission)) return 'no-permission';
  if (!item.implemented) return 'placeholder';
  return 'live';
}

/** Etiqueta corta de cada estado. En la sidebar y en la leyenda. */
export const AVAILABILITY_LABEL: Record<NavAvailability, string> = {
  live: 'activo',
  placeholder: 'pendiente',
  'not-in-catalog': 'fase 1',
  'no-permission': 'sin permiso',
  'higher-layer': 'capa 2+',
};
