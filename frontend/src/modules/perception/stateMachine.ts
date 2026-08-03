/**
 * PROCESSING STATUS STATE MACHINE
 *
 * Defines valid transitions. No arbitrary status assignments allowed.
 */

import type { JobStatusTransition, ProcessingStatus } from './types';

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

// ── Transiciones ────────────────────────────────────────────────────────────

/**
 * Lo minimo que necesita un job para cambiar de estado.
 *
 * Se tipa por estructura y no como `PerceptionJob` para que la funcion sirva
 * tanto al job completo como a un fixture parcial en una prueba, sin obligar a
 * construir un job entero para comprobar una transicion.
 */
export interface JobStatusFields {
  status: ProcessingStatus;
  statusHistory: JobStatusTransition[];
}

/**
 * EL UNICO camino para cambiar el estado de un job.
 *
 * Hace las tres cosas juntas, y juntas es el punto: valida, actualiza y registra.
 * Repartidas en tres llamadas, cualquiera puede olvidar la tercera y dejar un job
 * con un estado que su historial no explica.
 *
 * Devuelve un job NUEVO en lugar de mutar el recibido. Asi `job.status = ...`
 * deja de ser una alternativa mas comoda: no lo es, porque el resultado hay que
 * asignarlo de todas formas.
 *
 * Lanza si la transicion no es legal — `assertJobStatusTransition` decide—, y
 * lanzar es lo correcto: una transicion invalida es un error de programacion, no
 * un dato malo del usuario. Absorberla dejaria un job en un estado que la maquina
 * declara imposible.
 */
export function changeJobStatus<J extends JobStatusFields>(
  job: J,
  to: ProcessingStatus,
  options: { reason?: string | undefined; occurredAt?: string | undefined } = {},
): J {
  assertJobStatusTransition(job.status, to);

  const transition: JobStatusTransition = {
    from: job.status,
    to,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  };

  return {
    ...job,
    status: to,
    statusHistory: [...job.statusHistory, transition],
  };
}

/**
 * Aplica varias transiciones en orden.
 *
 * Existe para los fixtures y para `createJob`, que necesitan un job en un estado
 * avanzado con el historial coherente. Construirlo a mano invitaria a escribir el
 * historial y el estado por separado, que es justo lo que puede divergir.
 */
export function applyJobTransitions<J extends JobStatusFields>(
  job: J,
  steps: { to: ProcessingStatus; reason?: string | undefined; occurredAt?: string | undefined }[],
): J {
  return steps.reduce<J>(
    (acc, step) =>
      changeJobStatus(acc, step.to, {
        reason: step.reason,
        occurredAt: step.occurredAt,
      }),
    job,
  );
}

/** La ultima transicion registrada, o `null` si el job nunca cambio de estado. */
export function getLastTransition(job: JobStatusFields): JobStatusTransition | null {
  return job.statusHistory.length > 0
    ? job.statusHistory[job.statusHistory.length - 1]!
    : null;
}

/**
 * Donde se rompio un job, LEIDO DEL HISTORIAL y no inferido del estado.
 *
 * Es la diferencia que importa. `getProgressIndex('failed')` devuelve -1, asi que
 * cualquier calculo del tipo `Math.max(0, idx)` termina señalando la etapa 0
 * —`draft`— para todos los fallos. Un job que fallo subiendo un video de 200 MB se
 * dibujaba como si hubiera fallado antes de empezar, con la linea entera apagada.
 *
 * El historial si lo sabe: `{ from: 'uploading', to: 'failed', reason: 'Storage
 * timeout after 5s' }`. Devuelve `null` cuando el job no esta en un estado
 * terminal de fallo, para que quien llame no tenga que comprobarlo dos veces.
 */
export function getFailurePoint(job: JobStatusFields): {
  /** Etapa en la que estaba el job cuando se rompio. */
  previousStage: ProcessingStatus;
  /** Su indice en la linea de progreso. -1 si la etapa no esta en el camino feliz. */
  previousStageIndex: number;
  reason: string | null;
  occurredAt: string;
  outcome: 'failed' | 'cancelled';
} | null {
  if (job.status !== 'failed' && job.status !== 'cancelled') return null;

  const last = getLastTransition(job);
  // Un job terminal SIN historial no es reconstruible: se dice que no se sabe en
  // lugar de suponer que fue en `draft`. Ocurre con fixtures antiguos, y suponer
  // seria repetir el defecto que esta funcion existe para corregir.
  if (!last || last.to !== job.status) return null;

  return {
    previousStage: last.from,
    previousStageIndex: PROGRESS_STAGES.indexOf(last.from),
    reason: last.reason ?? null,
    occurredAt: last.occurredAt,
    outcome: job.status,
  };
}
