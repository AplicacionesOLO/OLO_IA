/**
 * Hooks de React Query para el modulo de IA.
 *
 * Un archivo para todo el modulo: son consultas y mutaciones directas contra los 18
 * endpoints, sin logica propia. Separarlas en cinco archivos no aportaria nada.
 *
 * ⚠ El ETag lo gestiona `ApiClient`: guarda el del ultimo GET por ruta y lo envia
 * como If-Match en el PATCH/DELETE siguiente. Por eso las mutaciones de detalle
 * NO reciben la version a mano — pero exigen que se haya hecho el GET antes, que es
 * lo que ocurre al abrir la pantalla de detalle.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type {
  AiClass,
  AiClassCreate,
  AiClassUpdate,
  AiModel,
  AiModelCreate,
  AiModelUpdate,
  AiProject,
  AiProjectCreate,
  AiProjectUpdate,
  AiTask,
  Architecture,
  Framework,
  ModelClass,
} from '../../lib/aiTypes';

const K = {
  frameworks: ['ai', 'frameworks'] as const,
  architectures: (task?: AiTask) => ['ai', 'architectures', task ?? 'all'] as const,
  projects: (search?: string) => ['ai', 'projects', search ?? ''] as const,
  project: (id: string) => ['ai', 'project', id] as const,
  models: (projectId: string) => ['ai', 'models', projectId] as const,
  model: (id: string) => ['ai', 'model', id] as const,
  classes: (projectId: string) => ['ai', 'classes', projectId] as const,
  vocabulary: (modelId: string) => ['ai', 'vocabulary', modelId] as const,
};

// ── Catalogo ────────────────────────────────────────────────────────────────
export function useFrameworks() {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.frameworks,
    // El catalogo cambia con una migracion, no con el uso: no hace falta
    // revalidarlo en cada montaje.
    staleTime: 30 * 60 * 1000,
    queryFn: () => api.get<Framework[]>('/ai/frameworks'),
  });
}

export function useArchitectures(task?: AiTask) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.architectures(task),
    staleTime: 30 * 60 * 1000,
    queryFn: () => api.get<Architecture[]>('/ai/architectures', task ? { task } : undefined),
  });
}

// ── Proyectos ───────────────────────────────────────────────────────────────
export function useProjects(search?: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.projects(search),
    queryFn: () =>
      api.getPaged<AiProject>('/ai/projects', {
        limit: 50,
        ...(search ? { search } : {}),
      }),
  });
}

export function useProject(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.project(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<AiProject>(`/ai/projects/${id}`),
  });
}

export function useCreateProject() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiProjectCreate) => api.post<AiProject>('/ai/projects', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'projects'] }),
  });
}

export function useUpdateProject(id: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiProjectUpdate) => api.patch<AiProject>(`/ai/projects/${id}`, body),
    onSuccess: (actualizado) => {
      qc.setQueryData(K.project(id), actualizado);
      void qc.invalidateQueries({ queryKey: ['ai', 'projects'] });
    },
  });
}

export function useDeleteProject() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ai/projects/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'projects'] }),
  });
}

// ── Modelos ─────────────────────────────────────────────────────────────────
export function useModels(projectId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.models(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => api.getPaged<AiModel>(`/ai/projects/${projectId}/models`, { limit: 50 }),
  });
}

export function useModel(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.model(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<AiModel>(`/ai/models/${id}`),
  });
}

export function useCreateModel(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiModelCreate) =>
      api.post<AiModel>(`/ai/projects/${projectId}/models`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.models(projectId) }),
  });
}

export function useUpdateModel(id: string, projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiModelUpdate) => api.patch<AiModel>(`/ai/models/${id}`, body),
    onSuccess: (actualizado) => {
      qc.setQueryData(K.model(id), actualizado);
      void qc.invalidateQueries({ queryKey: K.models(projectId) });
    },
  });
}

// ── Clases ──────────────────────────────────────────────────────────────────
export function useClasses(projectId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.classes(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => api.get<AiClass[]>(`/ai/projects/${projectId}/classes`),
  });
}

export function useCreateClass(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    // `class_index` NO se envia: lo asigna el servidor con advisory lock.
    mutationFn: (body: AiClassCreate) =>
      api.post<AiClass>(`/ai/projects/${projectId}/classes`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.classes(projectId) }),
  });
}

export function useUpdateClass(projectId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    // El ETag se necesita explicito: la lista no lo captura por ruta de detalle.
    mutationFn: ({ id, body, version }: { id: string; body: AiClassUpdate; version: number }) =>
      api.patch<AiClass>(`/ai/classes/${id}`, body, `W/"${version}"`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.classes(projectId) }),
  });
}

// ── Vocabulario ─────────────────────────────────────────────────────────────
export function useVocabulary(modelId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.vocabulary(modelId ?? ''),
    enabled: Boolean(modelId),
    queryFn: () => api.get<ModelClass[]>(`/ai/models/${modelId}/classes`),
  });
}

export function useReplaceVocabulary(modelId: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    /** El ORDEN del array fija `training_index`. Reemplazo completo, no parcheo. */
    mutationFn: (classIds: string[]) =>
      api.put<ModelClass[]>(`/ai/models/${modelId}/classes`, { class_ids: classIds }),
    onSuccess: (filas) => qc.setQueryData(K.vocabulary(modelId), filas),
  });
}
