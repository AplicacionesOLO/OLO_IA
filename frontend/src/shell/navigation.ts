/**
 * MODELO DE NAVEGACION
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECLARATIVO: añadir un modulo es añadir una entrada aqui. El componente de
 * navegacion no se toca nunca.
 *
 * GRUPOS: organizados por ROL en la operacion, no por capa cognitiva interna.
 * El usuario piensa "quiero ver el inventario" no "quiero ejecutar una accion".
 *
 * ESTADO DEL MODULO: cada modulo lleva un `moduleStatus` que describe su ciclo de
 * vida REAL, no un `implemented: boolean` binario. El sidebar y las landing pages
 * consumen ese estado para comunicar con precision que se puede hacer y que falta.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  Activity,
  BarChart3,
  Boxes,
  BrainCircuit,
  Cctv,
  Cog,
  Compass,
  Layers,
  MapPin,
  PlaneTakeoff,
  ScrollText,
  ShieldAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

// ── Grupos ──────────────────────────────────────────────────────────────────

export type NavGroupId = 'command' | 'operations' | 'intelligence' | 'admin' | 'platform';

export interface NavGroup {
  id: NavGroupId;
  label?: string;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'command' },
  { id: 'operations', label: 'Operaciones' },
  { id: 'intelligence', label: 'Inteligencia' },
  { id: 'admin', label: 'Administracion' },
  { id: 'platform', label: 'Plataforma' },
];

// ── Estado del modulo ───────────────────────────────────────────────────────

/**
 * Ciclo de vida de un modulo. No es un feature flag: es una declaracion honesta
 * del estado de desarrollo de cada pantalla, visible al usuario.
 *
 * El orden importa: es de mas avanzado a menos.
 */
export type ModuleStatus =
  /** Completamente funcional. Pantalla real, backend conectado. */
  | 'available'
  /** Frontend listo, conectado al backend. Puede tener limitaciones menores. */
  | 'beta'
  /** En construccion activa. Puede mostrar una preview parcial. */
  | 'in-development'
  /** Diseñado y planificado para la siguiente fase. */
  | 'planned'
  /** En el roadmap a largo plazo. Sin fecha. */
  | 'future'
  /** Solo para Platform Owners. */
  | 'admin-only'
  /** Requiere una capa visual superior. */
  | 'higher-layer';

export interface ModuleStatusMeta {
  label: string;
  description: string;
  /** Color del badge y del punto en la sidebar. */
  color: string;
  /** Opacidad del item en la sidebar cuando no esta activo. */
  opacity: string;
}

export const MODULE_STATUS_META: Record<ModuleStatus, ModuleStatusMeta> = {
  available: {
    label: 'Disponible',
    description: 'Modulo operativo',
    color: 'var(--state-idle)',
    opacity: '1',
  },
  beta: {
    label: 'Beta',
    description: 'Funcional con limitaciones menores',
    color: 'var(--aqua-300)',
    opacity: '1',
  },
  'in-development': {
    label: 'En desarrollo',
    description: 'En construccion activa',
    color: 'var(--iris-400)',
    opacity: '0.85',
  },
  planned: {
    label: 'Planificado',
    description: 'Diseñado para la proxima fase',
    color: 'var(--azure-400)',
    opacity: '0.7',
  },
  future: {
    label: 'Proximamente',
    description: 'En el roadmap a largo plazo',
    color: 'var(--text-faint)',
    opacity: '0.6',
  },
  'admin-only': {
    label: 'Solo administradores',
    description: 'Requiere privilegios de plataforma',
    color: 'var(--state-alert)',
    opacity: '0.7',
  },
  'higher-layer': {
    label: 'Capa superior',
    description: 'Requiere una capa visual superior',
    color: 'var(--text-faint)',
    opacity: '0.6',
  },
};

// ── Item de navegacion ──────────────────────────────────────────────────────

export interface NavItem {
  id: string;
  label: string;
  /** Subtitulo corto en la sidebar. */
  subtitle?: string;
  path: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Permiso necesario para operar el modulo. */
  permission?: string;
  /** Capa visual en la que el modulo estara disponible. */
  availableFromLayer?: 1 | 2 | 3 | 4 | 5;
  /** Contador dinamico. */
  badgeKey?: 'incidents' | 'syncErrors';
  /** Familia de permisos. */
  family: string;
  /** Estado del modulo en el ciclo de vida. */
  moduleStatus: ModuleStatus;
  /** La familia de permisos existe en core.permissions? */
  inCatalog: boolean;
  /** Version objetivo donde este modulo estara funcional. */
  targetVersion?: string;
}

// ── Disponibilidad resuelta ─────────────────────────────────────────────────

/** Resultado de evaluar un item contra el usuario y entorno actual. */
export type NavAvailability =
  | 'live'
  | 'no-permission'
  | 'not-in-catalog'
  | 'higher-layer'
  | 'coming-soon';

export interface ResolvedNavItem extends NavItem {
  availability: NavAvailability;
}

// ── Catalogo de modulos ─────────────────────────────────────────────────────

export const NAV_ITEMS: readonly NavItem[] = [
  // ═══ MANDO ═══════════════════════════════════════════════════════════════
  {
    id: 'overview',
    label: 'Dashboard',
    subtitle: 'Centro de mando',
    path: '/',
    icon: Compass,
    group: 'command',
    family: 'dashboard',
    moduleStatus: 'available',
    inCatalog: true,
  },

  // ═══ OPERACIONES ═════════════════════════════════════════════════════════
  {
    id: 'spatial',
    label: 'Spatial',
    subtitle: 'Explorador de ubicaciones',
    path: '/spatial',
    icon: MapPin,
    group: 'operations',
    permission: 'inventory:read',
    family: 'inventory',
    moduleStatus: 'beta',
    inCatalog: true,
    targetVersion: 'v0.3',
  },
  {
    id: 'inventory',
    label: 'Inventario',
    subtitle: 'Stock y movimientos',
    path: '/inventory',
    icon: Boxes,
    group: 'operations',
    permission: 'inventory:read',
    family: 'inventory',
    moduleStatus: 'beta',
    inCatalog: true,
    targetVersion: 'v0.3',
  },
  {
    id: 'incidents',
    label: 'Incidencias',
    subtitle: 'Discrepancias y alertas',
    path: '/incidents',
    icon: ShieldAlert,
    group: 'operations',
    permission: 'incidents:read',
    badgeKey: 'incidents',
    family: 'inventory',
    moduleStatus: 'beta',
    inCatalog: true,
    targetVersion: 'v0.4',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    subtitle: 'Reportes y metricas',
    path: '/analytics',
    icon: BarChart3,
    group: 'operations',
    permission: 'reports:read',
    family: 'reports',
    moduleStatus: 'planned',
    inCatalog: true,
    targetVersion: 'v0.4',
  },

  // ═══ INTELIGENCIA ════════════════════════════════════════════════════════
  {
    id: 'intelligence',
    label: 'Motor de IA',
    subtitle: 'Proyectos y modelos',
    path: '/ai/projects',
    icon: BrainCircuit,
    group: 'intelligence',
    permission: 'ai_projects:read',
    family: 'ai_projects',
    moduleStatus: 'available',
    inCatalog: true,
  },
  {
    id: 'vision',
    label: 'Vision',
    subtitle: 'Inspecciones CV',
    path: '/perception',
    icon: Cctv,
    group: 'intelligence',
    // `perception:read` y NO `inference:read`, que es lo que ponia antes.
    //
    // Es el mismo error que la entrada de `admin` avisa de no cometer: si el menu se
    // abre con un permiso distinto del que pide la API, la opcion no cuadra con la
    // pantalla. Aqui pasaba en la direccion silenciosa: `inference:read` existe en
    // `core.permissions` pero esta asignado a CERO roles —se comprobo—, asi que
    // cualquiera que no fuera platform owner veia «sin permiso» en un modulo cuyos
    // endpoints (0069) piden `perception:read`, que si tiene los cinco roles.
    permission: 'perception:read',
    family: 'perception',
    // `beta` y no `available`: las inspecciones se registran de verdad y las
    // detecciones se leen de la base, pero no hay worker de inferencia conectado —un
    // trabajo encolado espera— ni almacenamiento de los videos. La pantalla lo dice.
    moduleStatus: 'beta',
    // `true` desde 0069. Estaba en `false` cuando el modulo servia `dev-data.ts`, y
    // entonces era cierto; al conectar el backend real se quedo sin actualizar y el
    // menu seguia mostrando «fase futura» sobre un modulo que ya funcionaba.
    inCatalog: true,
    targetVersion: 'v0.3',
  },
  /*
    ── DIGITAL TWIN: MODELAR EL ALMACEN ────────────────────────────────────────

    Estuvo en el menu como PROMESA —seis capacidades, cinco ya hechas en Spatial— y se
    quito. Vuelve con otro contenido y por otra razon: es donde se LEVANTA el modelo.

    Subir el plano del CAD, calibrarlo, colocar los 347 racks y publicar es un trabajo de
    construccion que se hace de vez en cuando. El arbol, la tabla y el alzado son de
    consulta diaria. Dos oficios, dos puertas — pero UNA implementacion: `/twin` abre la
    misma pantalla de Spatial en vista de plano, con el mismo estado y el mismo visor.

    Lo que sigue sin ser suyo, y por eso no aparece aqui: la posicion de la flota en vivo
    es de FLOTA, y el modo inmersivo es un modo de ver, no un modulo.
  */
  {
    id: 'twin',
    label: 'Digital Twin',
    subtitle: 'Modelo 3D del almacen',
    path: '/twin',
    //  `Layers` y no `Boxes`: Inventario ya usa `Boxes`, y dos entradas del menu con el
    //  mismo icono se distinguen solo leyendo — que es justo lo que un icono evita.
    icon: Layers,
    group: 'intelligence',
    //  El mismo permiso que Spatial: es la misma pantalla vista de otra manera, y pedir
    //  uno distinto dejaria a alguien con acceso al explorador fuera de su propio plano.
    permission: 'areas:read',
    family: 'twin',
    moduleStatus: 'beta',
    inCatalog: true,
    targetVersion: 'v0.5',
  },
  {
    id: 'fleet',
    label: 'Flota',
    subtitle: 'Drones y AGVs',
    path: '/fleet',
    icon: PlaneTakeoff,
    group: 'intelligence',
    permission: 'drones:read',
    family: 'drones',
    moduleStatus: 'future',
    inCatalog: false,
    targetVersion: 'v0.7',
  },

  // ═══ ADMINISTRACION ══════════════════════════════════════════════════════
  {
    id: 'admin',
    label: 'Configuracion',
    subtitle: 'Roles, permisos y estructura',
    path: '/admin',
    icon: Cog,
    group: 'admin',
    // `settings:read` y no `warehouses:read`: es el permiso que exige
    // GET /v1/admin/overview. Si el menu se abriera con uno distinto del que pide la
    // API, la opcion seria visible y la pantalla daria 403.
    permission: 'settings:read',
    family: 'warehouses',
    // `beta` y no `available`: hay lectura completa y la matriz de permisos funciona,
    // pero todavia no hay alta ni edicion de paises, clientes, almacenes ni usuarios.
    // Y `planned` haria que el router sirviera la landing en lugar de la pantalla.
    moduleStatus: 'beta',
    inCatalog: true,
    targetVersion: 'v0.3',
  },
  {
    id: 'audit',
    label: 'Auditoria',
    subtitle: 'Trazabilidad completa',
    path: '/audit',
    icon: ScrollText,
    group: 'admin',
    permission: 'audit:read',
    family: 'audit',
    // `beta` y no `available`: la captura funciona sobre 27 tablas y el registro se lee
    // con sus filtros, pero el historial EMPIEZA en la migracion 0085 —lo anterior no
    // existe, y no se puede reconstruir lo que nadie guardo— y todavia no hay exportacion
    // ni retencion configurable. La pantalla lo dice.
    //
    // Y `planned` haria que el router sirviera la landing en lugar de la pantalla.
    moduleStatus: 'beta',
    inCatalog: true,
    targetVersion: 'v0.4',
  },
  {
    id: 'vitals',
    label: 'Salud',
    subtitle: 'Estado del sistema',
    path: '/vitals',
    icon: Activity,
    group: 'admin',
    family: 'system',
    moduleStatus: 'planned',
    inCatalog: true,
    targetVersion: 'v0.3',
  },

  // ═══ PLATAFORMA ══════════════════════════════════════════════════════════
  {
    id: 'integration',
    label: 'Integraciones',
    subtitle: 'WMS y sistemas externos',
    path: '/integration',
    icon: Workflow,
    group: 'platform',
    permission: 'integrations:read',
    badgeKey: 'syncErrors',
    family: 'integrations',
    moduleStatus: 'future',
    inCatalog: false,
    targetVersion: 'v0.5',
  },
];

// ── Resolucion ──────────────────────────────────────────────────────────────

export function resolveNavItems(
  hasPermission: (p: string) => boolean,
  currentLayer: number,
): ResolvedNavItem[] {
  return NAV_ITEMS.map((item) => ({
    ...item,
    availability: resolveAvailability(item, hasPermission, currentLayer),
  }));
}

function resolveAvailability(
  item: NavItem,
  hasPermission: (p: string) => boolean,
  currentLayer: number,
): NavAvailability {
  if (item.availableFromLayer && item.availableFromLayer > currentLayer) {
    return 'higher-layer';
  }
  if (item.inCatalog === false) return 'not-in-catalog';
  if (item.permission && !hasPermission(item.permission)) return 'no-permission';
  // Un modulo no-disponible con permiso concedido: es "coming soon" para ESTE usuario.
  if (item.moduleStatus !== 'available' && item.moduleStatus !== 'beta') return 'coming-soon';
  return 'live';
}

export const AVAILABILITY_LABEL: Record<NavAvailability, string> = {
  live: 'activo',
  'coming-soon': 'proximamente',
  'not-in-catalog': 'fase futura',
  'no-permission': 'sin permiso',
  'higher-layer': 'capa 2+',
};
