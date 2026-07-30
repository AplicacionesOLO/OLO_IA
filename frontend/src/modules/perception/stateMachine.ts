/**
 * PROCESSING STATUS STATE MACHINE
 *
 * Defines valid transitions. No arbitrary status assignments allowed.
 */

import type { ProcessingStatus } from './types';

const TRANSITIONS: Record<ProcessingStatus, ProcessingStatus[]> = {
  draft: ['uploading', 'cancelled'],
  uploading: ['uploaded', 'failed', 'cancelled'],
  uploaded: ['queued', 'cancelled'],
  queued: ['running', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['queued', 'cancelled'],
  cancelled: [],
};

/** Check if a status transition is valid. */
export function canTransitionJobStatus(from: ProcessingStatus, to: ProcessingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Assert a transition is valid. Throws if not. */
export function assertJobStatusTransition(from: ProcessingStatus, to: ProcessingStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new Error(
      `[Perception] Transicion invalida: ${from} → ${to}. ` +
      `Transiciones validas desde '${from}': ${TRANSITIONS[from].join(', ') || 'ninguna (terminal)'}`,
    );
  }
}

/** Get valid next statuses from a given state. */
export function getValidTransitions(from: ProcessingStatus): ProcessingStatus[] {
  return TRANSITIONS[from];
}

/** Check if a status is terminal (no further transitions). */
export function isTerminalStatus(status: ProcessingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Ordered stages for the progress line visualization. */
export const PROGRESS_STAGES: ProcessingStatus[] = [
  'draft',
  'uploading',
  'uploaded',
  'queued',
  'running',
  'completed',
];

/** Get the index of a status in the progress line. -1 if not in the happy path. */
export function getProgressIndex(status: ProcessingStatus): number {
  if (status === 'failed' || status === 'cancelled') return -1;
  return PROGRESS_STAGES.indexOf(status);
}
