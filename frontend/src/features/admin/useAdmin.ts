/**
 * Configuracion del sistema: una lectura, una escritura.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LA MUTACION ES OPTIMISTA, Y AQUI SI HACE FALTA
 *
 * Marcar una casilla de la matriz es un gesto de 50 ms de intencion contra un viaje
 * de ~260 ms al pooler. Sin actualizacion optimista la casilla se queda quieta medio
 * segundo y el operador vuelve a hacer clic — creando el efecto de que no funciona, y
 * de paso una segunda peticion que deshace la primera.
 *
 * Se aplica el cambio al instante, y si el servidor lo rechaza se REVIERTE con el
 * estado exacto anterior. `onMutate` devuelve la instantanea; `onError` la restaura.
 *
 * ⚠ NO se invalida la consulta al terminar bien. Invalidar recargaria los NUEVE
 *   bloques —37 paises incluidos— por marcar una casilla, y con ~2,3 s de latencia
 *   eso hace que la matriz parpadee entera. El servidor devuelve 204 sin cuerpo, asi
 *   que el estado optimista YA es el correcto: solo se invalida si falla.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type { AdminOverview, InvitacionResultado } from './adminTypes';

const K = { overview: ['admin', 'overview'] as const };

export function useAdminOverview() {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.overview,
    queryFn: () => api.get<AdminOverview>('/admin/overview'),
    // Nueve consultas contra el pooler: ~2,3 s. No se reintenta en silencio ni se
    // recarga al volver a la pestana; que lo pida el operador.
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export interface ToggleArgs {
  roleId: string;
  code: string;
  granted: boolean;
}

export function useTogglePermission() {
  const { api } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ roleId, code, granted }: ToggleArgs) =>
      api.put<void>(`/admin/roles/${roleId}/permissions/${code}`, { granted }),

    onMutate: async ({ roleId, code, granted }) => {
      // Se cancelan las lecturas en vuelo: si una llegara despues de aplicar el
      // cambio optimista, lo sobrescribiria con el estado viejo.
      await qc.cancelQueries({ queryKey: K.overview });
      const previo = qc.getQueryData<AdminOverview>(K.overview);

      qc.setQueryData<AdminOverview>(K.overview, (d) => {
        if (!d) return d;
        const otras = d.role_permissions.filter(
          (rp) => !(rp.role_id === roleId && rp.permission_code === code),
        );
        return {
          ...d,
          role_permissions: granted
            ? [...otras, { role_id: roleId, permission_code: code }]
            : otras,
          // El recuento del rol se ajusta a mano: sale de un `count(*)` del servidor y
          // sin esto la cabecera diria 30 mientras la fila muestra 31.
          roles: d.roles.map((r) =>
            r.id === roleId
              ? { ...r, permission_count: r.permission_count + (granted ? 1 : -1) }
              : r,
          ),
        };
      });

      return { previo };
    },

    onError: (_e, _vars, ctx) => {
      // Restaurar la instantanea EXACTA, no recargar: recargar tarda 2,3 s y durante
      // ese tiempo la casilla sigue mostrando el valor que el servidor rechazo.
      if (ctx?.previo) qc.setQueryData(K.overview, ctx.previo);
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ESCRITURAS
//
// Todas invalidan `overview` al terminar bien, y aqui SI es lo correcto: crear un
// cliente cambia recuentos derivados —`client_count` de la entidad legal— que el
// cliente no puede recalcular sin conocer la regla del servidor.
//
// La excepcion es el toggle de la matriz, que es optimista: ahi el cambio es un solo
// par y recargar nueve bloques por una casilla haria parpadear la tabla entera.
// ════════════════════════════════════════════════════════════════════════════

/** Los almacenes NO van por `/admin`: `api/v1/warehouses.py` ya tiene su CRUD. */
const RUTA_ALMACENES = '/warehouses';

interface Creado {
  id: string;
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: K.overview });
}

export function useOpenCountry() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: {
      country_id: string;
      default_currency_code: string;
      default_locale?: string;
      default_timezone?: string;
    }) => api.post<Creado>('/admin/countries', body),
    onSuccess: invalidar,
  });
}

export function useCreateCompany() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: {
      tenant_country_id: string;
      name: string;
      legal_name?: string | null;
      tax_id?: string | null;
    }) => api.post<Creado>('/admin/companies', body),
    onSuccess: invalidar,
  });
}

export function useCreateClient() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: {
      company_id: string;
      code: string;
      name: string;
      legal_name?: string | null;
      tax_id?: string | null;
    }) => api.post<Creado>('/admin/clients', body),
    onSuccess: invalidar,
  });
}

export function useDeleteClient() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/clients/${id}`),
    onSuccess: invalidar,
  });
}

export function useCreateRole() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; parent_role_id?: string | null }) =>
      api.post<Creado>('/admin/roles', body),
    onSuccess: invalidar,
  });
}

export function useDeleteRole() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/roles/${id}`),
    onSuccess: invalidar,
  });
}

/** Crea un almacen. Va contra el CRUD que ya existia, no contra `/admin`. */
export function useCreateWarehouse() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: { code: string; name: string; company_id: string }) =>
      api.post<Creado>(RUTA_ALMACENES, body),
    onSuccess: invalidar,
  });
}

/**
 * Invita a una persona: identidad en Supabase Auth, filas en el producto, rol y
 * almacenes. Todo en una peticion.
 *
 * `rol` y `almacenes` NO son opcionales de verdad. Sin rol la persona entra sin un solo
 * permiso y cada boton responde 403; sin almacenes, el explorador espacial y las
 * inspecciones se ven en blanco sin decir por que. La interfaz los pide juntos porque
 * separarlos entrega una cuenta que todavia no sirve.
 *
 * SI se invalida al terminar: hay una fila nueva en la tabla de usuarios, y el resultado
 * no trae lo suficiente para insertarla a mano (roles resueltos, recuento de almacenes).
 */
export function useInviteUser() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: {
      email: string;
      first_name: string;
      last_name: string;
      role_id?: string | null;
      warehouse_ids?: string[];
    }) => api.post<InvitacionResultado>('/admin/users/invite', body),
    onSuccess: invalidar,
  });
}

export function useSetRoleAssignment() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ userId, roleId, assigned }: { userId: string; roleId: string; assigned: boolean }) =>
      api.put<void>(`/admin/users/${userId}/roles/${roleId}`, { assigned }),
    onSuccess: invalidar,
  });
}

export function useSetWarehouseAccess() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({
      userId,
      warehouseId,
      granted,
    }: {
      userId: string;
      warehouseId: string;
      granted: boolean;
    }) => api.put<void>(`/admin/users/${userId}/warehouses/${warehouseId}`, { granted }),
    onSuccess: invalidar,
  });
}

// ── Editar y dar de baja ────────────────────────────────────────────────────
//
// Estos hooks no existían: la pantalla solo sabía CREAR. Los PATCH de clientes y
// empresas llevaban tiempo en el backend sin nada que los llamara, y países, empresas y
// almacenes no tenían forma de darse de baja.
//
// Todos invalidan el resumen completo al terminar. Es una petición de 40 KB por cada
// cambio, y es lo correcto aquí: una baja cambia los recuentos de tres bloques —un
// cliente menos cambia su empresa, y un almacén menos cambia el país— y actualizar solo
// la fila tocada dejaría los totales mintiendo hasta la siguiente recarga.

export function useUpdateCountry() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      status?: 'active' | 'inactive';
      default_timezone?: string;
      default_currency_code?: string;
    }) => api.patch(`/admin/countries/${id}`, body),
    onSuccess: invalidar,
  });
}

/**
 * Cierra la operación en un país.
 *
 * Responde 409 con el número de entidades legales que quedan dentro. Ese mensaje se
 * muestra tal cual: dice qué hacer, y reescribirlo como «no se puede cerrar» perdería
 * la cifra, que es la mitad de la información.
 */
export function useCloseCountry() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/countries/${id}`),
    onSuccess: invalidar,
  });
}

export function useUpdateCompany() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      name?: string;
      legal_name?: string | null;
      tax_id?: string | null;
      status?: string;
    }) => api.patch(`/admin/companies/${id}`, body),
    onSuccess: invalidar,
  });
}

export function useDeleteCompany() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/companies/${id}`),
    onSuccess: invalidar,
  });
}

export function useUpdateClient() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      code?: string;
      name?: string;
      legal_name?: string | null;
      tax_id?: string | null;
      status?: string;
    }) => api.patch(`/admin/clients/${id}`, body),
    onSuccess: invalidar,
  });
}

export function useUpdateWarehouse() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      name?: string;
      code?: string;
      status?: string;
      timezone?: string;
    }) => api.patch(`/warehouses/${id}`, body),
    onSuccess: invalidar,
  });
}

/**
 * Da de baja un almacén.
 *
 * Va contra `/warehouses/{id}` y no contra `/admin/...`: el CRUD de almacenes vive en su
 * propio router desde antes, y duplicarlo en admin daría dos caminos para la misma
 * escritura y dos sitios donde corregir un fallo.
 */
export function useDeleteWarehouse() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/warehouses/${id}`),
    onSuccess: invalidar,
  });
}

/**
 * Edita el perfil o el estado de un usuario.
 *
 * Sin `email`: es la llave con la identidad de Supabase Auth y el contrato del backend
 * lo rechaza. Que no esté en este tipo es lo que hace que el error salga al escribir el
 * código y no al pulsar el botón.
 */
export function useUpdateUser() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      first_name?: string;
      last_name?: string;
      locale?: string;
      timezone?: string;
      status?: 'active' | 'suspended';
    }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: invalidar,
  });
}

/**
 * Edita un rol PROPIO del tenant.
 *
 * El backend responde 422 en un rol global: los cinco del sistema los comparten todos
 * los operadores y no se editan desde un tenant. Por eso la acción solo se ofrece en
 * los propios.
 *
 * Sin `parent_role_id`: cambiar de quién hereda un rol reescribe en silencio los
 * permisos efectivos de todos los usuarios que lo tengan, y el sitio donde eso se ve
 * es la matriz. Un desplegable que lo hiciera sin mostrar la consecuencia sería peor
 * que no tenerlo.
 */
export function useUpdateRole() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string }) =>
      api.patch(`/admin/roles/${id}`, body),
    onSuccess: invalidar,
  });
}
