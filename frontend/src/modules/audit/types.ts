/**
 * AUDITORÍA — quién cambió qué, y cuándo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SOLO LECTURA, Y NO POR CONVENCIÓN
 *
 * No hay tipo de entrada con cuerpo porque por aquí no se escribe: `olo_app` **no
 * tiene privilegio de INSERT** sobre `audit.entries` (migración 0085). Escriben los
 * triggers del motor, con SECURITY DEFINER.
 *
 * Eso significa que la única forma de cambiar algo sin dejar rastro es tener permiso
 * para desactivar el trigger — que es exactamente el privilegio que se quiere vigilar.
 * Y si alguien lo desactiva, `watched` lo dice.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL SILENCIO DE UN REGISTRO SE LEE COMO «NO PASÓ NADA»
 *
 * Y aquí hay cosas que deliberadamente NO se auditan: las 41.055 filas de stock de
 * cada importación, las 29.312 ubicaciones del catálogo, las imágenes del dataset. Una
 * importación es UNA decisión —ya registrada en `inventory.wms_snapshots`— y auditarla
 * fila a fila enterraría los cambios que sí importan bajo un muro de entradas idénticas.
 *
 * Por eso `watched` viene en la misma respuesta y la pantalla lo enseña: sin esa lista,
 * un registro sin entradas de inventario parece decir que nadie importó nada.
 */

/** Una columna que cambió, de qué a qué. Calculado en el servidor. */
export interface AuditDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditEntry {
  id: number;
  occurred_at: string;
  schema_name: string;
  table_name: string;
  /** `null` en tablas con clave compuesta: la fila se identifica por `before`/`after`. */
  row_id: string | null;
  operation: AuditOperation | string;

  actor_user_id: string | null;
  /**
   * `null` cuando no hubo persona detrás: lo hizo una migración o una herramienta.
   * Quien decide cómo llamar a eso en pantalla es esta capa, no la API — y para eso
   * está `db_role`, que distingue «lo hizo una herramienta» de «lo hizo alguien y no
   * tengo permiso para ver quién».
   */
  actor_name: string | null;
  actor_email: string | null;
  db_role: string;

  /**
   * La escritura venía de la suite de tests. Es una PISTA, no un control: la entrada se
   * guarda completa y nunca se borra. La suite corre contra la base de producción —hay
   * una sola instancia— y deja ~150 entradas por ejecución.
   */
  is_test: boolean;

  changed: string[] | null;
  diff: AuditDiff[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditSummaryRow {
  tabla: string;
  operation: string;
  n: number;
  ultima: string;
}

export interface AuditActor {
  actor_user_id: string | null;
  actor_name: string | null;
  email: string | null;
  db_role: string;
  n: number;
  ultima: string;
}

/**
 * Una tabla con el trigger puesto.
 *
 * `activo` sale de `pg_trigger`, no de una lista en el código: si alguien desactiva el
 * trigger, la pantalla lo dice en vez de seguir prometiendo cobertura.
 */
export interface WatchedTable {
  schema_name: string;
  table_name: string;
  activo: boolean;
}

export interface AuditLog {
  entries: AuditEntry[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  summary: AuditSummaryRow[];
  actors: AuditActor[];
  watched: WatchedTable[];

  /**
   * Cuántas entradas de la suite de tests hay. Viene SIEMPRE, también cuando se están
   * incluyendo: un filtro que quita filas sin contarlas es lo mismo que perderlas, y
   * quien mira el registro no tendría forma de saber que había algo más.
   */
  test_total: number;
  including_tests: boolean;
}

/**
 * Cómo se llama cada tabla en castellano, y a qué módulo pertenece.
 *
 * Sin esto la pantalla diría `core.role_permissions` y `spatial.rack_placements`, que
 * son nombres de esquema y no dicen nada a quien audita. El mapa está aquí y no en el
 * backend porque es una decisión de presentación: la API devuelve el nombre real, que
 * es el que sirve para volver a consultar.
 */
export const TABLAS: Record<string, { etiqueta: string; grupo: string }> = {
  'core.users': { etiqueta: 'Personas', grupo: 'Accesos' },
  'core.tenant_memberships': { etiqueta: 'Pertenencia al tenant', grupo: 'Accesos' },
  'core.role_assignments': { etiqueta: 'Roles asignados', grupo: 'Accesos' },
  'core.role_permissions': { etiqueta: 'Permisos de cada rol', grupo: 'Accesos' },
  'core.roles': { etiqueta: 'Roles', grupo: 'Accesos' },
  'core.user_warehouse_access': { etiqueta: 'Acceso a almacenes', grupo: 'Accesos' },
  'core.permissions': { etiqueta: 'Catálogo de permisos', grupo: 'Accesos' },

  'core.tenants': { etiqueta: 'Tenants', grupo: 'Estructura' },
  'core.companies': { etiqueta: 'Empresas', grupo: 'Estructura' },
  'core.clients': { etiqueta: 'Clientes', grupo: 'Estructura' },
  'core.warehouses': { etiqueta: 'Almacenes', grupo: 'Estructura' },
  'core.tenant_countries': { etiqueta: 'Países', grupo: 'Estructura' },
  'core.workers': { etiqueta: 'Workers', grupo: 'Estructura' },
  'spatial.sites': { etiqueta: 'Sitios', grupo: 'Estructura' },
  'spatial.reference_frames': { etiqueta: 'Marcos de referencia', grupo: 'Estructura' },

  'incidents.incidents': { etiqueta: 'Incidencias', grupo: 'Operación' },
  'inventory.clusters': { etiqueta: 'Zonas del almacén', grupo: 'Operación' },
  'inventory.cluster_members': { etiqueta: 'Contenido de las zonas', grupo: 'Operación' },
  'inventory.wms_snapshots': { etiqueta: 'Importaciones del WMS', grupo: 'Operación' },
  'spatial.warehouse_layouts': { etiqueta: 'Planos publicados', grupo: 'Operación' },
  'spatial.rack_placements': { etiqueta: 'Colocación de racks', grupo: 'Operación' },
  'spatial.import_batches': { etiqueta: 'Importaciones del catálogo', grupo: 'Operación' },

  'ai.projects': { etiqueta: 'Proyectos de IA', grupo: 'Inteligencia' },
  'ai.models': { etiqueta: 'Modelos', grupo: 'Inteligencia' },
  'ai.model_versions': { etiqueta: 'Versiones de modelo', grupo: 'Inteligencia' },
  'ai.dataset_versions': { etiqueta: 'Versiones de dataset', grupo: 'Inteligencia' },
  'ai.training_runs': { etiqueta: 'Entrenamientos', grupo: 'Inteligencia' },
};

export function etiquetaTabla(schema: string, tabla: string): string {
  return TABLAS[`${schema}.${tabla}`]?.etiqueta ?? `${schema}.${tabla}`;
}

/** Qué significa cada operación en la frase que lee una persona. */
export const OPERACIONES: Record<
  AuditOperation,
  { verbo: string; tono: 'confirmed' | 'alert' | 'critical' }
> = {
  INSERT: { verbo: 'creó', tono: 'confirmed' },
  UPDATE: { verbo: 'cambió', tono: 'alert' },
  // `critical` y no `alert`: un borrado es la única operación de la que no se vuelve, y
  // el color es lo que hace que la vista se pare en ella al recorrer 50 filas.
  DELETE: { verbo: 'borró', tono: 'critical' },
};
