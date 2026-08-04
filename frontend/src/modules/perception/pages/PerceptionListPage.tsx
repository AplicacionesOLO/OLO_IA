/**
 * PERCEPTION LIST — listado de trabajos de inferencia.
 *
 * ── EL AVISO DEL ENCABEZADO CAMBIO DE SIGNIFICADO ──────────────────────────
 *
 * Decia «Datos simulados — sin backend de inferencia conectado», fijo en el codigo, y
 * era verdad mientras el listado venia de `dev-data.ts`. Desde 0069 los trabajos son
 * filas reales de `perception.inference_jobs`, asi que ese cartel afirmaba algo falso
 * sobre datos ciertos —y habria seguido diciendolo para siempre—.
 *
 * Lo que sigue siendo verdad es la SEGUNDA mitad: no hay worker. Son dos cosas
 * distintas y el aviso ahora dice solo la que se cumple, y la deduce del propio
 * trabajo (`processingAvailable`) en vez de tenerla escrita.
 */

import { Link } from 'react-router-dom';
import { Camera, Plus } from 'lucide-react';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { CanvasHost } from '../../../shell/CanvasHost';
import { usePerceptionJobs } from '../usePerception';
import { getFailurePoint } from '../stateMachine';
import type { ProcessingStatus } from '../types';

const STATUS_TONE: Record<ProcessingStatus, 'measured' | 'inferred' | 'alert' | 'critical' | 'neutral' | 'confirmed'> = {
  draft: 'neutral',
  uploading: 'neutral',
  uploaded: 'neutral',
  queued: 'neutral',
  running: 'inferred',
  completed: 'measured',
  failed: 'critical',
  cancelled: 'alert',
};

const STATUS_LABEL: Record<ProcessingStatus, string> = {
  draft: 'Borrador',
  uploading: 'Subiendo',
  uploaded: 'Subido',
  queued: 'En cola',
  running: 'Procesando',
  completed: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
};

export function PerceptionListPage() {
  const jobs = usePerceptionJobs();

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-label">Computer Vision</span>
            <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              Inspecciones
            </h1>
          </div>
          <Link to="/perception/new">
            <Button variant="primary">
              <Plus strokeWidth={1.5} className="size-4" />
              Nueva inspeccion
            </Button>
          </Link>
        </div>

        {/*
          Sin worker, la cola no avanza y hay que decirlo. Se deduce de los trabajos
          que ya estan cargados: si el servidor declarara un worker disponible, el
          aviso desaparece solo.

          Solo se muestra cuando hay algun trabajo ESPERANDO. Un almacen con todo
          completado no necesita que se le avise de una cola vacia.
        */}
        {(jobs.data ?? []).some(
          (j) => !j.processingAvailable && (j.status === 'queued' || j.status === 'uploaded'),
        ) && (
          <div className="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 [background:color-mix(in_oklab,var(--state-alert)_8%,transparent)]">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--state-alert)]" />
            <span className="t-mono-xs text-[var(--ember-400)]">
              No hay ningun worker de inferencia registrado: los trabajos en cola
              esperan y no van a avanzar solos. El material y los parametros quedan
              guardados.
            </span>
          </div>
        )}

        {/* Loading */}
        {jobs.isLoading && <p className="t-small text-[var(--text-faint)]">Cargando…</p>}

        {/* Empty */}
        {jobs.data && jobs.data.length === 0 && (
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <Camera strokeWidth={1.25} className="mx-auto mb-4 size-8 text-[var(--icon-accent)]" />
            <p className="t-body text-[var(--text-secondary)]">No hay inspecciones todavia.</p>
          </Panel>
        )}

        {/* Job list */}
        {jobs.data && jobs.data.length > 0 && (
          <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
            {jobs.data.map((job) => (
              <Panel key={job.id} level="work" radius="lg" pad="md" interactive className="col-span-12 md:col-span-6 xl:col-span-4">
                <Link to={`/perception/jobs/${job.id}`} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[length:var(--text-md)] text-[var(--text-primary)]">{job.name}</p>
                      <p className="t-mono-xs text-[var(--text-faint)]">{job.media.name}</p>
                    </div>
                    <Badge tone={STATUS_TONE[job.status]} size="sm">
                      {STATUS_LABEL[job.status]}
                    </Badge>
                  </div>

                  {/* Progress */}
                  {job.status === 'running' && (
                    <div className="flex flex-col gap-1.5">
                      <div className="h-1.5 overflow-hidden rounded-[var(--radius-full)] bg-[var(--glass-1)]">
                        <div
                          className="h-full rounded-[var(--radius-full)] bg-[var(--iris-400)] transition-[width] duration-500"
                          style={{ width: `${job.framesTotal > 0 ? (job.framesProcessed / job.framesTotal) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="t-mono-xs text-[var(--text-faint)]">
                        {job.framesProcessed}/{job.framesTotal} frames
                      </span>
                    </div>
                  )}

                  {/*
                    En la tarjeta, un job roto dice DONDE se rompio y por que. El
                    badge solo dice «Fallido», que no orienta: la etapa y el motivo
                    salen del historial, nunca del estado.
                  */}
                  <FailureNote job={job} />

                  <div className="flex items-center gap-4 text-[var(--text-faint)]">
                    <span className="t-mono-xs">{job.modelLabel ?? "sin modelo"}</span>
                    <span className="t-mono-xs">{job.detectionCount} detecciones</span>
                  </div>
                </Link>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </CanvasHost>
  );
}

/**
 * Donde y por que se rompio un job, leido del HISTORIAL.
 *
 * No renderiza nada cuando el job no esta roto o cuando su historial no registra
 * la transicion. Ese segundo caso es deliberado: sin el dato se calla, en lugar de
 * suponer una etapa. Suponerla es lo que hacia la linea de progreso, y suponia
 * siempre `draft`.
 */
function FailureNote({ job }: { job: Parameters<typeof getFailurePoint>[0] }) {
  const fallo = getFailurePoint(job);
  if (!fallo) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-mono-xs text-[var(--crimson-400)]">
        {fallo.outcome === 'failed' ? 'Fallo' : 'Cancelado'} en{' '}
        {STATUS_LABEL[fallo.previousStage]}
      </span>
      {fallo.reason && (
        <span className="t-mono-xs text-[var(--text-faint)]">{fallo.reason}</span>
      )}
    </div>
  );
}
