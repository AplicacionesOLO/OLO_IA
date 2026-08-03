/**
 * Anotaciones de una imagen: leer el conjunto y reemplazarlo.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NO HAY MUTACION POR CAJA, Y NO ES UNA SIMPLIFICACION
 *
 * El backend expone un unico `PUT` con la lista completa. Quien anota dibuja,
 * corrige y borra varias cajas antes de guardar; con operaciones por caja, cerrar
 * el navegador a mitad deja la imagen con tres cajas de cinco y ninguna señal de
 * que falta algo. Ademas el estado de la imagen depende del conjunto, no de una
 * caja suelta.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL ETag ES LA VERSION DE LA IMAGEN
 *
 * `If-Match` lleva la version de la IMAGEN, no la de una anotacion. Es el cerrojo
 * del conjunto: si otra persona guarda entre tu lectura y tu guardado, recibes 409
 * y vuelves a leer.
 *
 * La respuesta trae `image_version` nueva y se siembra en la cache de imagenes al
 * instante, porque el siguiente guardado la necesita. Esperar al `refetch` deja una
 * ventana en la que dos guardados seguidos fallan sin que nadie haya tocado nada.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type {
  AiImage,
  Annotation,
  AnnotationDraft,
  AnnotationsSaved,
} from '../../lib/aiTypes';

export function useAnnotations(imageId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['ai', 'annotations', imageId ?? ''],
    enabled: Boolean(imageId),
    queryFn: () => api.get<Annotation[]>(`/ai/images/${imageId}/annotations`),
    // Sin reintento silencioso: si la lectura falla, el anotador debe saberlo antes
    // de dibujar. Reintentar deja la pantalla vacia como si la imagen no tuviera
    // cajas, y quien anota volveria a dibujar las que ya existen.
    retry: false,
  });
}

export function useSaveAnnotations(projectId: string, imageId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      annotations,
      imageVersion,
    }: {
      annotations: AnnotationDraft[];
      /** Version de la IMAGEN leida. Va en `If-Match`. */
      imageVersion: number;
    }) =>
      api.put<AnnotationsSaved>(
        `/ai/images/${imageId}/annotations`,
        { annotations },
        String(imageVersion),
      ),

    onSuccess: (datos) => {
      // La lista de anotaciones se reemplaza con lo que devolvio el servidor: trae
      // los `id` recien asignados, y sin ellos el siguiente guardado volveria a
      // insertar las mismas cajas en lugar de moverlas.
      qc.setQueryData(['ai', 'annotations', imageId], datos.annotations);

      // La imagen cambio de estado y de version. Se parchea en TODAS las paginas de
      // la lista que ya esten en cache para que el contador y la insignia se muevan
      // sin esperar a la red.
      qc.setQueriesData<{ items: AiImage[] } | undefined>(
        { queryKey: ['ai', 'images', projectId] },
        (previo) => {
          if (!previo?.items) return previo;
          return {
            ...previo,
            items: previo.items.map((i) =>
              i.id === datos.image_id
                ? {
                    ...i,
                    status: datos.image_status,
                    version: datos.image_version,
                    annotation_count: datos.annotations.length,
                  }
                : i,
            ),
          };
        },
      );

      // Los recuentos por estado los calcula el servidor con su propia consulta: no
      // se pueden derivar de una pagina, asi que se invalidan.
      void qc.invalidateQueries({ queryKey: ['ai', 'imageCounts', projectId] });
    },
  });
}
