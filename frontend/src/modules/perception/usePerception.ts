/**
 * HOOKS DE REACT QUERY — Perception.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePerceptionRepo } from './PerceptionProvider';
import type { CreateJobInput, DetectionFilter, ReviewDecision } from './types';

const K = {
  jobs: ['perception', 'jobs'] as const,
  job: (id: string) => ['perception', 'job', id] as const,
  detections: (filter: DetectionFilter) => ['perception', 'detections', filter.jobId, filter.classId ?? '', filter.reviewStatus ?? '', filter.page ?? 1] as const,
  frame: (jobId: string, frame: number) => ['perception', 'frame', jobId, frame] as const,
  models: ['perception', 'models'] as const,
  datasets: ['perception', 'datasets'] as const,
};

export function usePerceptionJobs() {
  const repo = usePerceptionRepo();
  return useQuery({ queryKey: K.jobs, queryFn: () => repo.listJobs() });
}

export function usePerceptionJob(jobId: string | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.job(jobId ?? ''),
    enabled: Boolean(jobId),
    queryFn: () => repo.getJob(jobId!),
  });
}

export function useCreateJob() {
  const repo = usePerceptionRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJobInput) => repo.createJob(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.jobs }),
  });
}

export function useDetections(filter: DetectionFilter | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: filter ? K.detections(filter) : ['perception', 'detections', '__disabled__'],
    enabled: Boolean(filter),
    queryFn: () => repo.getDetections(filter!),
  });
}

export function useFrameAnnotations(jobId: string | null, frameNumber: number | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.frame(jobId ?? '', frameNumber ?? -1),
    enabled: Boolean(jobId) && frameNumber !== null,
    queryFn: () => repo.getFrameAnnotations(jobId!, frameNumber!),
  });
}

export function useSubmitReview(jobId: string) {
  const repo = usePerceptionRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisions: ReviewDecision[]) => repo.submitReview(jobId, decisions),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.job(jobId) });
      void qc.invalidateQueries({ queryKey: ['perception', 'detections', jobId] });
    },
  });
}

export function usePerceptionModels() {
  const repo = usePerceptionRepo();
  return useQuery({ queryKey: K.models, queryFn: () => repo.getModels(), staleTime: 5 * 60_000 });
}

export function usePerceptionDatasets() {
  const repo = usePerceptionRepo();
  return useQuery({ queryKey: K.datasets, queryFn: () => repo.getDatasets() });
}
