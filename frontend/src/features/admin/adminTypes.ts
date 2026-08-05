/**
 * CONTRATO DE LA CONFIGURACION DEL SISTEMA
 *
 * Espeja `backend/src/olo/api/v1/admin_schemas.py`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LO QUE RLS FILTRA ANTES DE QUE LLEGUE
 *
 * Los bloques de tenant llegan YA filtrados por el motor. Concretamente:
 * `warehouses` trae solo los almacenes a los que el usuario tiene acceso, no los de
 * la tabla. En el entorno de desarrollo la tabla tiene 27 filas —24 son residuos de
 * pruebas de integracion— y la aplicacion ve 2.
 *
 * Consecuencia para la UI: **los recuentos que se muestren son los del usuario, no
 * los del sistema.** Escribir «3 almacenes» cuando el administrador ve 2 y otro ve 27
 * seria confuso; se dice «almacenes accesibles».
 */

/**
 * ⚠ `platform` NO se puede asignar a un rol de tenant.
 *
 * Lo aborta el trigger `trg_role_permissions_scope_guard`: seria una escalada de
 * privilegios —un administrador de tenant concediendose el modulo de IA—. De 61
 * permisos, 27 son de plataforma, asi que con 5 roles hay **135 casillas de 305 que
 * no se pueden marcar nunca**.
 *
 * La UI las pinta como imposibles CON su motivo. Pintarlas como casillas vacias
 * produce 135 clics que fallan.
 */
export type PermissionScope = 'platform' | 'tenant';

export interface Country {
  id: string;
  iso_code: string;
  iso_code_3: string | null;
  numeric_code: string | null;
  name_en: string;
  name_es: string;
  phone_code: string | null;
  default_currency_code: string | null;
}

export interface TenantCountry {
  id: string;
  country_id: string;
  iso_code: string;
  name_es: string;
  status: string;
  default_currency_code: string | null;
  default_timezone: string | null;
}

/**
 * Entidad legal del OPERADOR en un pais. NO es un cliente.
 *
 * `core.warehouses.company_id` apunta aqui: un almacen pertenece a una entidad legal.
 * Los duenos de la mercaderia son `Client`.
 */
export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  status: string;
  country_name: string | null;
  country_code: string | null;
  warehouse_count: number;
  client_count: number;
}

/**
 * Dueno de la mercaderia almacenada (3PL): EPA, Cofersa.
 *
 * `spatial.*` NO tiene ninguna referencia a esto, a proposito: el catalogo espacial
 * describe el edificio, que es del operador. La propiedad viaja con el pallet y la
 * resuelve el WMS al reconciliar.
 */
export interface Client {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  status: string;
  company_name: string;
}

/** `location_count` sale de `spatial.locations`, no de una columna. */
export interface WarehouseAdmin {
  id: string;
  code: string;
  name: string;
  status: string;
  company_name: string | null;
  location_count: number;
  node_count: number;
}

export interface UserAdmin {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  /** Se resuelve contra `platform.owners` en cada lectura. NO viaja en el JWT. */
  is_platform_owner: boolean;
  warehouse_access_count: number;
  role_names: string[];
  membership_status: string | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  /** Cambiar los permisos de un rol de sistema afecta a todos los usuarios que lo tengan. */
  is_system: boolean;
  /**
   * `true` = rol GLOBAL (`tenant_id IS NULL`), compartido por TODOS los tenants.
   *
   * Sus permisos son de SOLO LECTURA: la politica `rp_isolation` exige
   * `tenant_id = current_tenant_id()` en su WITH CHECK, asi que el INSERT se rechaza.
   * Hoy los 5 roles del sistema son globales, asi que **la matriz completa es de solo
   * lectura** hasta que el tenant cree un rol propio.
   *
   * La salida es crear un rol del tenant, que puede heredar de uno global con
   * `parent_role_id`.
   */
  is_global: boolean;
  parent_role_id: string | null;
  parent_name: string | null;
  permission_count: number;
}

export interface Permission {
  code: string;
  /** Lo que agrupa la matriz en carpetas colapsables. */
  module: string;
  action: string;
  description: string;
  is_privileged: boolean;
  scope: PermissionScope;
}

export interface RolePermission {
  role_id: string;
  permission_code: string;
}

export interface AdminOverview {
  countries: Country[];
  tenant_countries: TenantCountry[];
  companies: Company[];
  clients: Client[];
  warehouses: WarehouseAdmin[];
  users: UserAdmin[];
  roles: Role[];
  permissions: Permission[];
  role_permissions: RolePermission[];
}

/** Etiquetas legibles de los modulos. Los que no estan se muestran con su codigo. */
export const MODULO_ETIQUETA: Record<string, string> = {
  ai_architectures: 'IA · Arquitecturas',
  ai_classes: 'IA · Clases',
  ai_models: 'IA · Modelos',
  ai_projects: 'IA · Proyectos',
  annotations: 'IA · Anotaciones',
  datasets: 'IA · Datasets',
  inference: 'IA · Inferencia',
  training: 'IA · Entrenamiento',
  platform_owners: 'Plataforma · Owners',
  areas: 'Áreas',
  audit: 'Auditoría',
  clients: 'Clientes',
  companies: 'Entidades legales',
  dashboard: 'Panel',
  inventory: 'Inventario',
  locations: 'Ubicaciones',
  olobot: 'OLOBOT',
  products: 'Productos',
  reports: 'Informes',
  roles: 'Roles',
  settings: 'Configuración',
  users: 'Usuarios',
  warehouses: 'Almacenes',
};
