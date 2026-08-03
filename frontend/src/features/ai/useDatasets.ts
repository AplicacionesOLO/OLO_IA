/**
 * Versiones de dataset: previsualizar, congelar, listar y exportar.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NO HAY MUTACION DE ACTUALIZACION NI DE BORRADO, Y NO ES UNA OMISION
 *
 * Una version congelada es INMUTABLE: la base tiene un trigger que ABORTA UPDATE y
 * DELETE. Congelar el reparto train/val/test es lo que hace reproducible un
 * entrenamiento y comparables dos modelos; poder editarlo despues le quitaria ese
 * valor. Si hace falta corregir algo, se crea otra version.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * `preview` EXISTE PARA NO OBLIGAR A CREAR ALGO IRREVERSIBLE SOLO PARA MIRAR
 *
 * Sin el, la unica forma de saber cuantas imagenes estan listas seria congelar una
 * version que luego no se puede borrar. Trae `can_freeze` para poder deshabilitar el
 * boton CON su motivo visible, en lugar de aceptar el clic y responder 422.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type {
  DatasetFreezeInput,
  DatasetPreview,
  DatasetVersion,
  YoloExport,
} from '../../lib/aiTypes';

const K = {
  versions: (p: string) => ['ai', 'datasetVersions', p] as const,
  preview: (p: string) => ['ai', 'datasetPreview', p] as const,
  exportar: (p: string, v: string) => ['ai', 'datasetExport', p, v] as const,
};

export function useDatasetVersions(projectId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.versions(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () =>
      api.get<DatasetVersion[]>(`/ai/projects/${projectId}/dataset-versions`),
  });
}

export function useDatasetPreview(projectId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.preview(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () =>
      api.get<DatasetPreview>(`/ai/projects/${projectId}/dataset-versions/preview`),
    // Se recalcula al volver a la pestaña: el operador pudo anotar en otra ventana y
    // un `can_freeze` obsoleto le diría que no puede cuando ya sí.
    refetchOnWindowFocus: true,
  });
}

export function useFreezeDataset(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DatasetFreezeInput) =>
      api.post<DatasetVersion>(`/ai/projects/${projectId}/dataset-versions`, body),
    onSuccess: (creada) => {
      // La lista se siembra con la nueva al principio en lugar de invalidar: la
      // versión ya llegó completa en la respuesta y es inmutable, así que no hay
      // ninguna posibilidad de que el servidor tenga algo distinto.
      qc.setQueryData<DatasetVersion[]>(K.versions(projectId), (previo) =>
        previo ? [creada, ...previo] : [creada],
      );
      // El `preview` SÍ se invalida: `next_version` acaba de cambiar.
      void qc.invalidateQueries({ queryKey: K.preview(projectId) });
    },
  });
}

/**
 * Manifiesto YOLO de una version.
 *
 * `enabled` controlado por el llamante: firma una URL por imagen contra Storage, asi
 * que no puede dispararse solo al montar la pantalla. Se pide cuando el operador lo
 * pide.
 *
 * `gcTime` corto y `staleTime: 0` porque las URLs firmadas CADUCAN a los 15 minutos:
 * servir un manifiesto de cache seria entregar enlaces muertos.
 */
export function useYoloExport(
  projectId: string | undefined,
  versionId: string | undefined,
  enabled: boolean,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.exportar(projectId ?? '', versionId ?? ''),
    enabled: Boolean(projectId && versionId && enabled),
    queryFn: () =>
      api.get<YoloExport>(
        `/ai/projects/${projectId}/dataset-versions/${versionId}/export`,
      ),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
}
