/**
 * Subida de imagenes en tres pasos.
 *
 * El binario NO pasa por el backend: se sube directo a Supabase Storage con el JWT
 * del usuario, y las politicas RLS del bucket lo autorizan. El backend posee la ruta
 * canonica y el metadato.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import { useSessionStore } from '../../auth/sessionStore';
import { env } from '../../lib/env';
import type {
  AiAsset,
  AiImage,
  AssetDeleteResult,
  ImageStatus,
  SignedUrl,
  UploadPrepareOut,
} from '../../lib/aiTypes';

/** SHA-256 en hex. El backend lo exige para deduplicar por contenido. */
async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Dimensiones reales, para no fiarse de lo que diga el nombre del archivo. */
function dimensiones(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function useImages(projectId: string | undefined, status?: ImageStatus) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['ai', 'images', projectId ?? '', status ?? 'all'],
    enabled: Boolean(projectId),
    queryFn: () =>
      api.getPaged<AiImage>(`/ai/projects/${projectId}/images`, {
        limit: 60,
        ...(status ? { status } : {}),
      }),
  });
}

export function useImageCounts(projectId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['ai', 'imageCounts', projectId ?? ''],
    enabled: Boolean(projectId),
    queryFn: () => api.get<Record<string, number>>(`/ai/projects/${projectId}/images/counts`),
  });
}

export function useSignedUrl(assetId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['ai', 'signedUrl', assetId ?? ''],
    enabled: Boolean(assetId),
    // La firma dura 15 min; se revalida antes de caducar.
    staleTime: 10 * 60 * 1000,
    queryFn: () => api.get<SignedUrl>(`/ai/assets/${assetId}/url`),
  });
}

export interface ResultadoSubida {
  file: File;
  ok: boolean;
  error?: string;
}

export function useUploadImages(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (files: File[]): Promise<ResultadoSubida[]> => {
      const resultados: ResultadoSubida[] = [];

      for (const file of files) {
        try {
          // El token se lee AQUI, no en el render: un lote grande puede durar mas
          // que la vida del JWT, y `apiClient` refresca por su cuenta para las
          // llamadas al backend. Un token capturado al montar el componente
          // dejaria las subidas posteriores al refresco con un 403 de Storage.
          const token = useSessionStore.getState().tokens?.accessToken ?? null;
          // `kind`, `content_type` y `original_filename` van IDENTICOS en las dos
          // llamadas: el servidor deriva la ruta de ellos y la recalcula en
          // `confirm`. Cambiar uno haria que buscara un objeto que no esta ahi.
          const identidad = {
            kind: 'image' as const,
            content_type: file.type,
            bytes: file.size,
            original_filename: file.name,
          };

          const prep = await api.post<UploadPrepareOut>(
            `/ai/projects/${projectId}/assets/prepare`,
            identidad,
          );

          const subida = await fetch(prep.upload_url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token ?? ''}`,
              apikey: env.supabaseAnonKey ?? '',
              'Content-Type': file.type,
              'x-upsert': 'false',
            },
            body: file,
          });
          if (!subida.ok) {
            // 403 aqui casi siempre es la politica del bucket: o no eres Platform
            // Owner o el proyecto de la ruta no esta vivo.
            const pista =
              subida.status === 403
                ? ' — Storage denego la ruta: revisa que seas Platform Owner y que el proyecto exista'
                : '';
            throw new Error(`Storage rechazo la subida (HTTP ${subida.status})${pista}`);
          }

          const [sha, dim] = await Promise.all([sha256Hex(file), dimensiones(file)]);

          try {
            await api.post<AiAsset>(`/ai/projects/${projectId}/assets/confirm`, {
              ...identidad,
              asset_id: prep.asset_id,
              sha256: sha,
              ...(dim ? { width: dim.width, height: dim.height } : {}),
            });
          } catch (e) {
            // El binario YA esta en Storage y no hay fila: es un huerfano. Se dice,
            // porque el usuario que reintenta debe saber que no esta duplicando el
            // archivo sino dejando otro objeto suelto.
            const causa = e instanceof Error ? e.message : 'fallo al confirmar';
            throw new Error(
              `${causa} — el archivo se subio pero no quedo registrado ` +
                `(objeto sin registrar: ${prep.object_path})`,
            );
          }

          resultados.push({ file, ok: true });
        } catch (e) {
          resultados.push({
            file,
            ok: false,
            error: e instanceof Error ? e.message : 'Fallo desconocido',
          });
        }
      }
      return resultados;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai', 'images', projectId] });
      void qc.invalidateQueries({ queryKey: ['ai', 'imageCounts', projectId] });
    },
  });
}

export function useSetImageStatus(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      version,
    }: {
      id: string;
      status: ImageStatus;
      version: number;
    }) => api.patch<AiImage>(`/ai/images/${id}/status`, { status }, `W/"${version}"`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai', 'images', projectId] });
      void qc.invalidateQueries({ queryKey: ['ai', 'imageCounts', projectId] });
    },
  });
}

/**
 * Borra el asset, su imagen y su binario.
 *
 * `version` es la del ASSET (`AiImage.asset_version`), nunca `AiImage.version`: son
 * contadores independientes y usar el de la imagen da 412 en cuanto cambia de estado.
 */
export function useDeleteAsset(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, assetVersion }: { assetId: string; assetVersion: number }) =>
      api.deleteWith<AssetDeleteResult>(`/ai/assets/${assetId}`, `W/"${assetVersion}"`),
    onSuccess: (_datos, { assetId }) => {
      void qc.invalidateQueries({ queryKey: ['ai', 'images', projectId] });
      void qc.invalidateQueries({ queryKey: ['ai', 'imageCounts', projectId] });
      // La firma se retira de la cache: `staleTime` la mantiene 10 minutos, y el
      // endpoint ya responde 404 para un asset borrado. Sin esto, una vuelta atras
      // en el navegador reintentaria una URL cuyo objeto ya no existe.
      qc.removeQueries({ queryKey: ['ai', 'signedUrl', assetId] });
    },
  });
}
