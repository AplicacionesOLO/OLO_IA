/**
 * CONFIGURACIÓN DEL SISTEMA — la estructura del operador y la matriz de permisos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE SE VE AQUÍ ESTÁ FILTRADO POR RLS, Y HAY QUE DECIRLO
 *
 * Los bloques de tenant llegan ya filtrados por el motor. `warehouses` trae los
 * almacenes a los que ESTE usuario tiene acceso, no los de la tabla: en desarrollo la
 * tabla tiene 27 filas —24 son residuos de pruebas— y la aplicación ve 2.
 *
 * Por eso las cabeceras dicen «accesibles» y no un total: escribir «3 almacenes»
 * cuando un administrador ve 2 y otro vería 27 es una cifra que no significa nada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 135 DE LAS 305 CASILLAS SON IMPOSIBLES, Y SE PINTAN COMO TALES
 *
 * De 61 permisos, 27 son de alcance `platform`. El trigger
 * `trg_role_permissions_scope_guard` aborta cualquier intento de asignarlos a un rol
 * de tenant, porque sería una escalada de privilegios.
 *
 * Con 5 roles eso son 135 casillas que no se pueden marcar nunca. Pintarlas como
 * casillas vacías produce 135 clics que fallan y ninguna explicación. Aquí van con un
 * guion, sin `checkbox`, y el módulo entero lleva la etiqueta «solo plataforma» con
 * el motivo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE PAGINA NADA
 *
 * 37 países, 1 entidad legal, 2 clientes, 2 almacenes, 2 usuarios, 5 roles y 61
 * permisos. Y una matriz no se puede pintar a trozos: el operador la lee en dos
 * dimensiones y paginarla por filas rompe la comparación entre roles, que es
 * exactamente para lo que existe.
 */

import { Fragment, useMemo, useState } from 'react';
import {
  Boxes,
  Building2,
  ChevronRight,
  Globe,
  Bot,
  Layers,
  Lock,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { AsyncStatus, fase } from '../../design/foundation/AsyncStatus';
import { ConfirmBar } from '../../design/foundation/ConfirmBar';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { cn } from '../../design/utils/cn';
import { ApiError } from '../../lib/apiErrors';
import { useSessionStore } from '../../auth/sessionStore';
import { OlobotAccessSection } from '../olobot/OlobotAccessSection';
import { CanvasHost } from '../../shell/CanvasHost';
import { NAV_ITEMS } from '../../shell/navigation';
import {
  FormAbrirPais,
  FormCrearAlmacen,
  FormCrearCliente,
  FormCrearCompany,
  FormCrearRol,
  FormInvitarUsuario,
} from './AdminForms';
import { MODULO_ETIQUETA, type Permission, type Role } from './adminTypes';
import {
  BotonesDeFila,
  ConfirmacionDeBaja,
  EditorDeFila,
  type AccionesFila,
} from './AdminRowActions';
import {
  useAdminOverview,
  useCloseCountry,
  useDeleteClient,
  useDeleteCompany,
  useDeleteRole,
  useDeleteWarehouse,
  useTogglePermission,
  useUpdateClient,
  useUpdateCompany,
  useUpdateCountry,
  useUpdateRole,
  useUpdateUser,
  useUpdateWarehouse,
} from './useAdmin';

export function AdminPage() {
  //  Para saber cuál de las filas de OLOBOT es la propia: nadie cambia su propio
  //  nivel, y decirlo en la fila evita el clic que solo sirve para leer el 422.
  const perfil = useSessionStore((s) => s.profile);
  // Las mutaciones de editar y dar de baja. Se instancian aquí y no en cada fila: un
  // hook por fila serían 37 suscripciones solo para la tabla de países.
  const actualizarPais = useUpdateCountry();
  const cerrarPais = useCloseCountry();
  const actualizarEmpresa = useUpdateCompany();
  const borrarEmpresa = useDeleteCompany();
  const actualizarCliente = useUpdateClient();
  const borrarCliente = useDeleteClient();
  const actualizarAlmacen = useUpdateWarehouse();
  const borrarAlmacen = useDeleteWarehouse();
  const actualizarUsuario = useUpdateUser();
  const overview = useAdminOverview();
  const toggle = useTogglePermission();
  const [errorToggle, setErrorToggle] = useState<string | null>(null);

  const d = overview.data;

  // Índice de casillas marcadas. Un `Set` de `roleId|code` y no un recorrido del array
  // por celda: 305 celdas × 72 asignaciones serían 21.960 comparaciones por render.
  const marcadas = useMemo(() => {
    const s = new Set<string>();
    for (const rp of d?.role_permissions ?? []) s.add(`${rp.role_id}|${rp.permission_code}`);
    return s;
  }, [d?.role_permissions]);

  const porModulo = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of d?.permissions ?? []) {
      const lista = m.get(p.module) ?? [];
      lista.push(p);
      m.set(p.module, lista);
    }
    // Los módulos de tenant primero: son los que tienen casillas accionables. Dejar
    // los 9 de plataforma arriba obligaría a bajar 27 filas para llegar a lo editable.
    return [...m.entries()].sort((a, b) => {
      const aPlat = a[1][0]!.scope === 'platform';
      const bPlat = b[1][0]!.scope === 'platform';
      if (aPlat !== bPlat) return aPlat ? 1 : -1;
      return etiqueta(a[0]).localeCompare(etiqueta(b[0]), 'es');
    });
  }, [d?.permissions]);

  const roles = d?.roles ?? [];

  const cambiar = (rol: Role, p: Permission, granted: boolean) => {
    setErrorToggle(null);
    toggle.mutate(
      { roleId: rol.id, code: p.code, granted },
      {
        onError: (e) => {
          setErrorToggle(
            e instanceof ApiError
              ? e.message
              : `no se pudo ${granted ? 'conceder' : 'retirar'} ${p.code}`,
          );
        },
      },
    );
  };

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight text-[var(--text-primary)]">
            Configuración del sistema
          </h1>
          <p className="t-body mt-1 text-[var(--text-secondary)]">
            Estructura del operador, usuarios y la matriz de permisos. Todo lo que se ve
            aquí está filtrado por RLS según tu acceso.
          </p>
        </div>

        {overview.isLoading && (
          <AsyncStatus
            phase="pending"
            pendingLabel="Cargando la configuración (nueve consultas)"
          />
        )}

        {overview.isError && (
          <AsyncStatus
            phase="error"
            errorLabel={
              overview.error instanceof ApiError
                ? overview.error.message
                : 'no se pudo leer la configuración'
            }
            onRetry={() => void overview.refetch()}
          />
        )}

        {d && (
          <>
            {/* ── Estructura ────────────────────────────────────────────── */}
            <Carpeta
              icono={<Globe strokeWidth={1.5} className="size-4" />}
              titulo="Países"
              resumen={`${d.tenant_countries.length} en operación · ${d.countries.length} en el catálogo`}
            >
              <p className="t-mono-xs mb-3 text-[var(--text-faint)]">
                El catálogo de países es global y no pertenece a ningún tenant. «En
                operación» son los que este operador tiene abiertos.
              </p>
              <Tabla
                cabeceras={['país', 'ISO', 'moneda', 'zona horaria', 'estado']}
                filas={d.tenant_countries.map((c) => [
                  c.name_es,
                  c.iso_code,
                  c.default_currency_code ?? '—',
                  c.default_timezone ?? '—',
                  c.status,
                ])}
                vacio="Este operador no tiene ningún país abierto."
                acciones={(i) => {
                  const c = d.tenant_countries[i]!;
                  return {
                    nombre: c.name_es ?? c.iso_code,
                    etiquetaBaja: 'Cerrar operación en',
                    campos: [
                      {
                        clave: 'default_timezone',
                        etiqueta: 'zona horaria',
                        valor: c.default_timezone ?? '',
                        ancho: 'w-44',
                      },
                      {
                        clave: 'default_currency_code',
                        etiqueta: 'moneda',
                        valor: c.default_currency_code ?? '',
                        ancho: 'w-16',
                        validar: (v) =>
                          v.length === 3 ? null : 'la moneda son 3 letras (ISO 4217)',
                      },
                      {
                        clave: 'status',
                        etiqueta: 'estado',
                        valor: c.status,
                        opciones: ['active', 'inactive'],
                      },
                    ],
                    onGuardar: (cambios) =>
                      actualizarPais.mutateAsync({ id: c.id, ...cambios }),
                    onBaja: () => cerrarPais.mutateAsync(c.id),
                  };
                }}
              />
              <div className="mt-3">
                <FormAbrirPais d={d} />
              </div>
            </Carpeta>

            <Carpeta
              icono={<Building2 strokeWidth={1.5} className="size-4" />}
              titulo="Entidades legales"
              resumen={`${d.companies.length}`}
            >
              <p className="t-mono-xs mb-3 text-[var(--text-faint)]">
                La entidad legal del <strong>operador</strong> en cada país. No son
                clientes: un almacén pertenece a una entidad legal, y esa entidad guarda
                mercadería de varios clientes.
              </p>
              <Tabla
                cabeceras={['nombre', 'razón social', 'cédula', 'país', 'almacenes', 'clientes']}
                filas={d.companies.map((c) => [
                  c.name,
                  c.legal_name ?? '—',
                  c.tax_id ?? '—',
                  c.country_name ?? '—',
                  String(c.warehouse_count),
                  String(c.client_count),
                ])}
                vacio="Sin entidades legales."
                acciones={(i) => {
                  const c = d.companies[i]!;
                  return {
                    nombre: c.name,
                    campos: [
                      { clave: 'name', etiqueta: 'nombre', valor: c.name, ancho: 'w-52' },
                      {
                        clave: 'legal_name',
                        etiqueta: 'razón social',
                        valor: c.legal_name ?? '',
                        ancho: 'w-64',
                      },
                      {
                        clave: 'tax_id',
                        etiqueta: 'cédula',
                        valor: c.tax_id ?? '',
                        ancho: 'w-36',
                      },
                    ],
                    onGuardar: (cambios) =>
                      actualizarEmpresa.mutateAsync({ id: c.id, ...cambios }),
                    onBaja: () => borrarEmpresa.mutateAsync(c.id),
                  };
                }}
              />
              <div className="mt-3">
                <FormCrearCompany d={d} />
              </div>
            </Carpeta>

            <Carpeta
              icono={<Users strokeWidth={1.5} className="size-4" />}
              titulo="Clientes"
              resumen={`${d.clients.length}`}
            >
              <p className="t-mono-xs mb-3 text-[var(--text-faint)]">
                Dueños de la mercadería almacenada. El catálogo espacial{' '}
                <strong>no</strong> los referencia: describe el edificio, que es del
                operador. De quién es cada pallet lo resuelve el WMS al reconciliar.
              </p>
              <Tabla
                cabeceras={['código', 'nombre', 'razón social', 'cédula', 'atendido por', 'estado']}
                filas={d.clients.map((c) => [
                  c.code,
                  c.name,
                  c.legal_name ?? '—',
                  c.tax_id ?? '—',
                  c.company_name,
                  c.status,
                ])}
                vacio="Sin clientes."
                acciones={(i) => {
                  const c = d.clients[i]!;
                  return {
                    nombre: c.name,
                    campos: [
                      { clave: 'name', etiqueta: 'nombre', valor: c.name, ancho: 'w-52' },
                      {
                        clave: 'legal_name',
                        etiqueta: 'razón social',
                        valor: c.legal_name ?? '',
                        ancho: 'w-64',
                      },
                      {
                        clave: 'tax_id',
                        etiqueta: 'cédula',
                        valor: c.tax_id ?? '',
                        ancho: 'w-36',
                      },
                    ],
                    onGuardar: (cambios) =>
                      actualizarCliente.mutateAsync({ id: c.id, ...cambios }),
                    onBaja: () => borrarCliente.mutateAsync(c.id),
                  };
                }}
              />
              <div className="mt-3">
                <FormCrearCliente d={d} />
              </div>
            </Carpeta>

            <Carpeta
              icono={<Boxes strokeWidth={1.5} className="size-4" />}
              titulo="Almacenes accesibles"
              resumen={`${d.warehouses.length} · ${d.warehouses
                .reduce((a, w) => a + w.location_count, 0)
                .toLocaleString('es')} ubicaciones`}
            >
              <p className="t-mono-xs mb-3 text-[var(--text-faint)]">
                Solo los que <strong>tú</strong> puedes ver: RLS los filtra por
                `core.user_warehouse_access`. Las ubicaciones se cuentan sobre
                `spatial.locations`, así que un almacén con 0 no tiene catálogo
                importado.
              </p>
              <Tabla
                cabeceras={['código', 'nombre', 'entidad legal', 'nodos', 'ubicaciones', 'estado']}
                filas={d.warehouses.map((w) => [
                  w.code,
                  w.name,
                  w.company_name ?? '—',
                  w.node_count.toLocaleString('es'),
                  w.location_count.toLocaleString('es'),
                  w.status,
                ])}
                vacio="No tienes acceso a ningún almacén."
                acciones={(i) => {
                  const w = d.warehouses[i]!;
                  return {
                    nombre: w.code,
                    campos: [
                      { clave: 'name', etiqueta: 'nombre', valor: w.name, ancho: 'w-64' },
                      {
                        clave: 'status',
                        etiqueta: 'estado',
                        valor: w.status,
                        opciones: ['active', 'inactive'],
                      },
                    ],
                    onGuardar: (cambios) =>
                      actualizarAlmacen.mutateAsync({ id: w.id, ...cambios }),
                    onBaja: () => borrarAlmacen.mutateAsync(w.id),
                  };
                }}
              />
              <div className="mt-3">
                <FormCrearAlmacen d={d} />
              </div>
            </Carpeta>

            <Carpeta
              icono={<Users strokeWidth={1.5} className="size-4" />}
              titulo="Usuarios"
              resumen={`${d.users.length}`}
            >
              <Tabla
                cabeceras={['correo', 'roles', 'almacenes', 'membresía', 'plataforma']}
                filas={d.users.map((u) => [
                  u.email,
                  u.role_names.length > 0 ? u.role_names.join(', ') : '—',
                  String(u.warehouse_access_count),
                  u.membership_status ?? '—',
                  u.is_platform_owner ? 'owner' : '—',
                ])}
                vacio="Sin usuarios."
                acciones={(i) => {
                  const u = d.users[i]!;
                  /*
                    Sin `onBaja`. Un usuario no se BORRA: se suspende, y eso es el campo
                    `status` de aquí al lado. Un botón de papelera junto a un desplegable
                    que ya hace el trabajo invita a pensar que son dos operaciones
                    distintas, y que la del icono es la irreversible.

                    El correo no se edita: es la llave con la identidad de Supabase Auth
                    y el backend lo rechaza. Por eso no está entre los campos.
                  */
                  return {
                    nombre: u.email,
                    campos: [
                      {
                        clave: 'first_name',
                        etiqueta: 'nombre',
                        valor: u.first_name ?? '',
                        ancho: 'w-40',
                      },
                      {
                        clave: 'last_name',
                        etiqueta: 'apellido',
                        valor: u.last_name ?? '',
                        ancho: 'w-40',
                      },
                      {
                        clave: 'status',
                        etiqueta: 'estado',
                        valor: u.status,
                        opciones: ['active', 'suspended'],
                      },
                    ],
                    onGuardar: (cambios) =>
                      actualizarUsuario.mutateAsync({ id: u.id, ...cambios }),
                  };
                }}
              />
              <div className="mt-3">
                <FormInvitarUsuario d={d} permisos={perfil?.permissions ?? []} />
              </div>
              <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
                «Plataforma: owner» se resuelve contra `platform.owners` en cada lectura
                y <strong>no viaja en el token</strong>: revocarlo surte efecto en la
                petición siguiente. Es lo que da acceso al módulo de IA, y no se
                concede por rol.
              </p>
            </Carpeta>

            {/* ── OLOBOT ────────────────────────────────────────────────── */}
            {/*
              Después de los usuarios y antes de la matriz, y ese sitio es una
              decisión: el nivel se asigna A UNA PERSONA, así que se lee justo
              después de la lista de personas. En la matriz aparecen los tres
              permisos `olobot:*`, que son otra pregunta —qué puede un ROL—.
            */}
            <Carpeta
              icono={<Bot strokeWidth={1.5} className="size-4" />}
              titulo="OLOBOT"
              resumen="nivel por usuario"
            >
              <OlobotAccessSection miCorreo={perfil?.email ?? null} />
            </Carpeta>

            {/* ── El menú ───────────────────────────────────────────────── */}
            <Carpeta
              icono={<Layers strokeWidth={1.5} className="size-4" />}
              titulo="Opciones del menú"
              resumen={`${NAV_ITEMS.length}`}
            >
              <p className="t-mono-xs mb-3 text-[var(--text-faint)]">
                Lo que hay en la barra lateral, con su estado real. Sale de{' '}
                <code>shell/navigation.ts</code>, que es la única fuente: si una opción
                no está aquí, no existe.
              </p>
              <Tabla
                cabeceras={['opción', 'ruta', 'estado']}
                filas={NAV_ITEMS.map((i) => [i.label, i.path, i.moduleStatus])}
                vacio="Sin opciones."
              />
            </Carpeta>

            {/*
              Los roles van en su propia carpeta y ANTES de la matriz: sin un rol
              propio del tenant, la matriz entera es un mirador. El formulario tiene
              que estar de camino, no después.
            */}
            <Carpeta
              icono={<ShieldCheck strokeWidth={1.5} className="size-4" />}
              titulo="Roles"
              resumen={`${roles.length} · ${roles.filter((r) => !r.is_global).length} propios del tenant`}
            >
              <p className="t-mono-xs mb-3 text-[var(--text-faint)]">
                Los roles de <strong>sistema</strong> son globales: los comparten todos
                los tenants y sus permisos no se pueden cambiar. Para tener permisos
                distintos hay que crear un rol propio, que puede heredar de uno del
                sistema.
              </p>
              <TablaRoles roles={roles} />
              <div className="mt-3">
                <FormCrearRol d={d} />
              </div>
            </Carpeta>

            {/* ── La matriz ─────────────────────────────────────────────── */}
            <Panel level="decision" radius="lg" pad="lg">
              <PanelHeader
                title="Matriz de permisos"
                subtitle={`${roles.length} roles × ${d.permissions.length} permisos`}
                trailing={
                  <div className="flex items-center gap-2">
                    <Badge tone="measured" size="xs">
                      {marcadas.size} concedidos
                    </Badge>
                  </div>
                }
              />

              <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
                {d.permissions.filter((p) => p.scope === 'platform').length * roles.length}{' '}
                de {d.permissions.length * roles.length} casillas son{' '}
                <strong>imposibles por diseño</strong>: los permisos de plataforma no se
                pueden asignar a un rol de tenant porque sería una escalada de
                privilegios. Se conceden registrando al usuario en{' '}
                <code>platform.owners</code>.
              </p>

              {/*
                Y el segundo motivo, que hoy afecta a TODA la matriz: los 5 roles del
                sistema son globales. Sin decirlo, cada casilla parece editable y todas
                fallan con un error de privilegios que no explica nada.
              */}
              {roles.every((r) => r.is_global) && (
                <p className="t-small mt-2 text-[var(--text-warn)]">
                  Los {roles.length} roles son de sistema <strong>globales</strong>:
                  los comparten todos los tenants, así que sus permisos son de{' '}
                  <strong>solo lectura</strong>. Para cambiar permisos hay que crear un
                  rol propio del tenant — puede heredar de uno de estos.
                </p>
              )}

              <div className="mt-3">
                <AsyncStatus
                  phase={errorToggle ? 'error' : fase(toggle)}
                  pendingLabel="Guardando"
                  successLabel="Permiso actualizado"
                  errorLabel={errorToggle}
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {porModulo.map(([modulo, permisos]) => (
                  <GrupoMatriz
                    key={modulo}
                    modulo={modulo}
                    permisos={permisos}
                    roles={roles}
                    marcadas={marcadas}
                    onToggle={cambiar}
                  />
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </CanvasHost>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function etiqueta(modulo: string): string {
  return MODULO_ETIQUETA[modulo] ?? modulo;
}

/**
 * Carpeta colapsable.
 *
 * Cerrada por omisión salvo la primera: con siete secciones abiertas, la matriz —que
 * es lo que se viene a hacer— queda a cuatro pantallas de scroll.
 */
function Carpeta({
  icono,
  titulo,
  resumen,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  resumen: string;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);
  return (
    <Panel level="work" radius="lg" pad="none">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:[background:var(--glass-2)]"
      >
        <ChevronRight
          strokeWidth={1.5}
          className={cn(
            'size-4 shrink-0 text-[var(--text-faint)] transition-transform',
            abierta && 'rotate-90',
          )}
        />
        <span className="text-[var(--icon-accent)]">{icono}</span>
        <span className="flex-1 text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {titulo}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">{resumen}</span>
      </button>
      {abierta && <div className="px-5 pb-5">{children}</div>}
    </Panel>
  );
}

/**
 * Un módulo de la matriz.
 *
 * Los de plataforma se marcan como no accionables en la propia cabecera del grupo, y
 * no solo casilla a casilla: es una propiedad del módulo entero y repetirla 27 veces
 * en forma de guion no la explica.
 */
function GrupoMatriz({
  modulo,
  permisos,
  roles,
  marcadas,
  onToggle,
}: {
  modulo: string;
  permisos: Permission[];
  roles: Role[];
  marcadas: Set<string>;
  onToggle: (r: Role, p: Permission, granted: boolean) => void;
}) {
  const esPlataforma = permisos[0]?.scope === 'platform';
  const [abierto, setAbierto] = useState(!esPlataforma);

  const concedidos = permisos.reduce(
    (n, p) => n + roles.filter((r) => marcadas.has(`${r.id}|${p.code}`)).length,
    0,
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] [background:var(--glass-1)]">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:[background:var(--glass-2)]"
      >
        <ChevronRight
          strokeWidth={1.5}
          className={cn(
            'size-3.5 shrink-0 text-[var(--text-faint)] transition-transform',
            abierto && 'rotate-90',
          )}
        />
        <span className="text-[length:var(--text-xs)] text-[var(--text-primary)]">
          {etiqueta(modulo)}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {permisos.length} {permisos.length === 1 ? 'permiso' : 'permisos'}
        </span>
        {esPlataforma ? (
          <span
            className="t-mono-xs ml-auto rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[var(--text-warn)] [background:color-mix(in_oklab,var(--state-alert)_12%,transparent)]"
            title="Los permisos de plataforma no se asignan por rol: se conceden registrando al usuario en platform.owners. El motor aborta cualquier intento."
          >
            solo plataforma
          </span>
        ) : (
          <span className="t-mono-xs ml-auto text-[var(--text-faint)]">
            {concedidos} concedidos
          </span>
        )}
      </button>

      {abierto && (
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="t-label sticky left-0 min-w-[200px] py-2 text-left [background:var(--glass-1)]">
                  permiso
                </th>
                {roles.map((r) => (
                  <th key={r.id} className="px-2 py-2 text-center">
                    <span
                      className="t-mono-xs text-[var(--text-muted)]"
                      title={
                        r.is_global
                          ? `${r.name} · rol de sistema GLOBAL: compartido por todos los tenants, de solo lectura`
                          : r.is_system
                            ? `${r.name} · rol de sistema: cambiarlo afecta a todos los usuarios que lo tengan`
                            : (r.description ?? r.name)
                      }
                    >
                      {r.name}
                      {r.is_global && (
                        <Lock
                          strokeWidth={1.5}
                          className="ml-1 inline size-3 text-[var(--text-warn)]"
                        />
                      )}
                      {r.is_system && !r.is_global && (
                        <ShieldCheck
                          strokeWidth={1.5}
                          className="ml-1 inline size-3 text-[var(--text-faint)]"
                        />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permisos.map((p) => (
                <tr key={p.code} className="border-t border-[var(--hairline)]">
                  <td className="sticky left-0 py-1.5 pr-3 [background:var(--glass-1)]">
                    <span className="t-mono-xs text-[var(--text-primary)]" title={p.description}>
                      {p.action}
                    </span>
                    {p.is_privileged && (
                      <span
                        className="t-mono-xs ml-1.5 text-[var(--text-warn)]"
                        title="Permiso privilegiado"
                      >
                        !
                      </span>
                    )}
                  </td>
                  {roles.map((r) => {
                    const activo = marcadas.has(`${r.id}|${p.code}`);
                    if (p.scope === 'platform') {
                      return (
                        <td key={r.id} className="px-2 py-1.5 text-center">
                          <span
                            className="t-mono-xs text-[var(--text-faint)]"
                            title="No asignable a un rol de tenant: sería una escalada de privilegios. Se concede en platform.owners."
                            aria-label="no asignable"
                          >
                            —
                          </span>
                        </td>
                      );
                    }
                    // Rol global: se MUESTRA el estado pero no se puede cambiar. Un
                    // `checkbox` habilitado aqui produce un error de privilegios del
                    // motor que no explica nada; deshabilitado con su motivo, si.
                    return (
                      <td key={r.id} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={activo}
                          disabled={r.is_global}
                          onChange={(e) => onToggle(r, p, e.target.checked)}
                          aria-label={`${p.code} para ${r.name}`}
                          title={
                            r.is_global
                              ? `${p.code} · ${r.name}: rol de sistema global, de solo lectura. Crea un rol propio del tenant para cambiar permisos.`
                              : `${p.code} · ${r.name}`
                          }
                          className={cn(
                            'size-3.5 accent-[var(--accent)]',
                            r.is_global ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tabla({
  cabeceras,
  filas,
  vacio,
  acciones,
}: {
  cabeceras: string[];
  filas: string[][];
  vacio: string;
  /**
   * Cómo se edita y se da de baja cada fila, por ÍNDICE.
   *
   * Se recibe como función del índice y no como una columna más de `filas` porque
   * `filas` es de cadenas: el estilo de esta tabla depende de eso —una celda «—» se
   * pinta tenue— y convertirla a nodos lo perdería en las seis tablas para ganarlo en
   * una columna.
   */
  acciones?: (indice: number) => AccionesFila | null;
}) {
  /**
   * Qué fila está abierta, y a qué. Vive aquí y no en la celda porque el panel se pinta
   * en una fila APARTE: son dos sitios del DOM que comparten un estado.
   *
   * Solo una a la vez. Dos formularios abiertos sobre la misma tabla invitan a llenar
   * los dos y perder uno, porque cada guardado recarga el resumen entero.
   */
  const [abierta, setAbierta] = useState<{ i: number; modo: 'editar' | 'baja' } | null>(
    null,
  );
  const cerrar = () => setAbierta(null);

  if (filas.length === 0) {
    return <p className="t-mono-xs text-[var(--text-faint)]">{vacio}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {cabeceras.map((c) => (
              <th key={c} className="t-label py-2 pr-4 text-left">
                {c}
              </th>
            ))}
            {/* `w-0`: la columna de acciones no debe robar ancho a las de datos. */}
            {acciones && <th className="t-label w-0 py-2 text-left" />}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const a = acciones?.(i) ?? null;
            const abierto = abierta?.i === i ? abierta.modo : null;
            return (
              <Fragment key={i}>
                <tr className={cn(!abierto && 'border-t border-[var(--hairline)]')}>
                  {f.map((celda, j) => (
                    <td
                      key={j}
                      className={cn(
                        't-mono-xs py-1.5 pr-4',
                        celda === '—'
                          ? 'text-[var(--text-faint)]'
                          : 'text-[var(--text-primary)]',
                      )}
                    >
                      {celda}
                    </td>
                  ))}
                  {acciones && (
                    <td className="w-0 py-1.5 align-top">
                      {a && (
                        <BotonesDeFila
                          nombre={a.nombre}
                          etiquetaBaja={a.etiquetaBaja}
                          hayBaja={Boolean(a.onBaja)}
                          abierta={abierto === 'editar'}
                          onEditar={() =>
                            setAbierta(abierto === 'editar' ? null : { i, modo: 'editar' })
                          }
                          onBaja={() =>
                            setAbierta(abierto === 'baja' ? null : { i, modo: 'baja' })
                          }
                        />
                      )}
                    </td>
                  )}
                </tr>
                {a && abierto && (
                  <tr>
                    <td colSpan={f.length + 1} className="pb-2">
                      {abierto === 'editar' ? (
                        <EditorDeFila
                          campos={a.campos}
                          onGuardar={a.onGuardar}
                          onCerrar={cerrar}
                        />
                      ) : (
                        a.onBaja && (
                          <ConfirmacionDeBaja
                            nombre={a.nombre}
                            etiquetaBaja={a.etiquetaBaja}
                            onBaja={a.onBaja}
                            onCerrar={cerrar}
                          />
                        )
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tabla de roles con su acción de baja.
 *
 * El botón de borrar solo aparece en los roles PROPIOS: en uno global no existe la
 * operación, y un botón deshabilitado sin explicación se lee como un fallo.
 */
function TablaRoles({ roles }: { roles: Role[] }) {
  const borrar = useDeleteRole();
  const actualizar = useUpdateRole();
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['rol', 'tipo', 'hereda de', 'permisos', ''].map((c) => (
                <th key={c} className="t-label py-2 pr-4 text-left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-[var(--hairline)]">
                  <td className="t-mono-xs py-1.5 pr-4 text-[var(--text-primary)]">{r.name}</td>
                  <td
                    className={cn(
                      't-mono-xs py-1.5 pr-4',
                      r.description
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-faint)]',
                    )}
                  >
                    {r.description ?? '—'}
                  </td>
                  <td className="t-mono-xs py-1.5 pr-4">
                    {r.is_global ? (
                      <span className="text-[var(--text-warn)]">sistema · global</span>
                    ) : (
                      <span className="text-[var(--text-ok)]">propio del tenant</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      't-mono-xs py-1.5 pr-4',
                      r.parent_name ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
                    )}
                  >
                    {r.parent_name ?? '—'}
                  </td>
                  <td className="t-mono-xs py-1.5 pr-4 tabular-nums text-[var(--text-primary)]">
                    {r.permission_count}
                  </td>
                  <td className="py-1.5">
                    {/*
                      Solo en los roles PROPIOS. En uno global la operación no existe
                      —el backend responde 422— y un botón que siempre falla se lee como
                      un fallo del producto.
                    */}
                    {!r.is_global && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-label={`Editar ${r.name}`}
                          aria-expanded={editando === r.id}
                          onClick={() => {
                            setError(null);
                            setEditando(editando === r.id ? null : r.id);
                          }}
                          className="t-mono-xs text-[var(--text-faint)] hover:text-[var(--text-primary)]"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          aria-label={`Dar de baja ${r.name}`}
                          onClick={() => {
                            setError(null);
                            setConfirmar(r.id);
                          }}
                          className="t-mono-xs text-[var(--text-faint)] hover:text-[var(--text-warn)]"
                        >
                          dar de baja
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {editando === r.id && (
                  <tr>
                    <td colSpan={6} className="pb-2">
                      <EditorDeFila
                        campos={[
                          {
                            clave: 'name',
                            etiqueta: 'nombre',
                            valor: r.name,
                            ancho: 'w-52',
                            // El CHECK `chk_roles_name` de la base: minúsculas, dígitos y
                            // guion bajo, empezando por letra. Avisar aquí evita un 422
                            // que llega después de pulsar y no dice dónde está el error.
                            validar: (v) =>
                              /^[a-z][a-z0-9_]*$/.test(v)
                                ? null
                                : 'minúsculas, dígitos y _, empezando por letra',
                          },
                          {
                            clave: 'description',
                            etiqueta: 'descripción',
                            valor: r.description ?? '',
                            ancho: 'w-96',
                          },
                        ]}
                        onGuardar={(cambios) =>
                          actualizar.mutateAsync({ id: r.id, ...cambios })
                        }
                        onCerrar={() => setEditando(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Confirmación en línea, no `confirm()`. Y el aviso dice la consecuencia real:
        el servidor rechaza con 409 si alguien lo tiene asignado, así que no hay riesgo
        de dejar usuarios sin permisos en silencio.
      */}
      <ConfirmBar
        className="mt-3"
        open={confirmar !== null}
        message="Se dará de baja el rol. Si algún usuario lo tiene asignado, el servidor lo rechazará."
        onCancel={() => setConfirmar(null)}
        actions={[
          {
            label: 'Dar de baja',
            destructive: true,
            onClick: () => {
              const id = confirmar;
              setConfirmar(null);
              if (!id) return;
              borrar.mutate(id, {
                onError: (e) =>
                  setError(e instanceof ApiError ? e.message : 'no se pudo dar de baja'),
              });
            },
          },
        ]}
      />

      <div className="mt-2">
        <AsyncStatus
          phase={error ? 'error' : fase(borrar)}
          pendingLabel="Dando de baja"
          successLabel="Rol dado de baja"
          errorLabel={error}
        />
      </div>
    </>
  );
}
