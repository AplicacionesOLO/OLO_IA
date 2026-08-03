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
import type { AdminOverview } from './adminTypes';

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
