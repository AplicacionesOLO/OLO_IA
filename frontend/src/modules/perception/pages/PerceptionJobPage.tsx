/**
 * JOB DETAIL — visor de resultados de una inspeccion.
 */

import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Filter } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useDetections, usePerceptionJob } from '../usePerception';
import { PROGRESS_STAGES, getFailurePoint, getProgressIndex } from '../stateMachine';
import type { Detection, DetectionFilter, PerceptionJob, ReviewStatus } from '../types';
import { cn } from '../../../design/utils/cn';

export function PerceptionJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const job = usePerceptionJob(jobId ?? null);
  const [classFilter] = useState<string | undefined>(undefined);
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | undefined>(undefined);
  const [selectedDet, setSelectedDet] = useState<Detection | null>(null);

  const filter: DetectionFilter | null = jobId ? {
    jobId,
    classId: classFilter,
    reviewStatus: reviewFilter,
  } : null;
  const detections = useDetections(filter);

  if (job.isLoading) {
    return <CanvasHost mode="grid"><p className="t-small text-[var(--text-faint)]">Cargando…</p></CanvasHost>;
  }
  if (!job.data) {
    return <CanvasHost mode="grid"><p className="t-small text-[var(--state-alert)]">Job no encontrado</p></CanvasHost>;
  }

  const j = job.data;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* Header */}
        <div>
          <Link to="/perception" className="t-mono-xs text-[var(--text-faint)] hover:underline">
            <ArrowLeft strokeWidth={1.5} className="mb-0.5 mr-1 inline size-3" />Inspecciones
          </Link>
          <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] text-[var(--text-primary)]">{j.name}</h1>
          <p className="t-mono-xs text-[var(--text-faint)]">{j.media.name} · {j.modelName} v{j.modelVersion}</p>
        </div>

        {/* Progress line */}
        <JobProgressLine job={j} />

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Detecciones" value={j.detectionCount} />
          <Stat label="Frames" value={`${j.framesProcessed}/${j.framesTotal}`} />
          <Stat label="Confianza" value={`≥${(j.config.confidenceThreshold * 100).toFixed(0)}%`} />
          <Stat label="Tiempo" value={j.elapsedMs > 0 ? `${(j.elapsedMs / 1000).toFixed(1)}s` : '—'} />
        </div>

        {/* Content */}
        <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
          {/* Detection list */}
          <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-4 xl:col-span-7">
            <PanelHeader title="Detecciones" subtitle={`${detections.data?.total ?? 0} resultados`} trailing={
              <Button variant="ghost" size="xs"><Filter strokeWidth={1.5} className="size-3.5" /></Button>
            } />

            {/* Filters */}
            <div className="flex flex-wrap gap-1.5">
              <Button variant={!reviewFilter ? 'secondary' : 'ghost'} size="xs" onClick={() => setReviewFilter(undefined)}>Todas</Button>
              <Button variant={reviewFilter === 'pending' ? 'secondary' : 'ghost'} size="xs" onClick={() => setReviewFilter('pending')}>Pendientes</Button>
              <Button variant={reviewFilter === 'accepted' ? 'secondary' : 'ghost'} size="xs" onClick={() => setReviewFilter('accepted')}>Aceptadas</Button>
              <Button variant={reviewFilter === 'rejected' ? 'secondary' : 'ghost'} size="xs" onClick={() => setReviewFilter('rejected')}>Rechazadas</Button>
            </div>

            {/* Table */}
            {detections.data && detections.data.items.length > 0 && (
              <ul className="flex flex-col gap-1">
                {detections.data.items.map((det) => (
                  <li
                    key={det.id}
                    className={cn(
                      'flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 cursor-pointer transition-colors',
                      selectedDet?.id === det.id ? '[background:var(--glass-3)] shadow-[var(--rim-2)]' : '[background:var(--glass-1)] hover:[background:var(--glass-2)]',
                    )}
                    onClick={() => setSelectedDet(det)}
                  >
                    <span className="size-3 shrink-0 rounded-[2px]" style={{ background: det.classColor }} />
                    <span className="flex-1 text-[length:var(--text-sm)] text-[var(--text-primary)]">{det.className}</span>
                    <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-faint)]">{(det.confidence * 100).toFixed(0)}%</span>
                    <Badge tone={det.reviewStatus === 'accepted' ? 'confirmed' : det.reviewStatus === 'rejected' ? 'critical' : 'neutral'} size="xs">
                      {det.reviewStatus}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Inspector */}
          <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-4 xl:col-span-5">
            <PanelHeader title="Inspector" subtitle={selectedDet ? selectedDet.className : 'Selecciona una deteccion'} />
            {selectedDet && <DetectionInspector detection={selectedDet} />}
          </Panel>
        </div>
      </div>
    </CanvasHost>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Panel level="support" radius="lg" pad="sm">
      <div className="flex flex-col gap-1.5 px-1">
        <span className="t-label">{label}</span>
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">{value}</span>
      </div>
    </Panel>
  );
}

function DetectionInspector({ detection }: { detection: Detection }) {
  return (
    <dl className="flex flex-col gap-2.5">
      <Row label="Clase" value={detection.className} color={detection.classColor} />
      <Row label="Confianza" value={`${(detection.confidence * 100).toFixed(1)}%`} />
      <Row label="Frame" value={String(detection.frameNumber)} />
      <Row label="BBox" value={`${detection.bbox.x}, ${detection.bbox.y}, ${detection.bbox.width}×${detection.bbox.height} ${detection.bbox.format}`} />
      <Row label="Estado" value={detection.reviewStatus} />
    </dl>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-label">{label}</dt>
      <dd className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-primary)]">
        {color && <span className="size-2 rounded-[2px]" style={{ background: color }} />}
        {value}
      </dd>
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  uploading: 'Subiendo',
  uploaded: 'Subido',
  queued: 'En cola',
  running: 'Procesando',
  completed: 'Completado',
};

/**
 * LINEA DE PROGRESO — la etapa del fallo se LEE del historial, no se infiere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL DEFECTO QUE ESTO CORRIGE
 *
 * Antes recibia solo `status` y calculaba `idx = getProgressIndex(status)`, que
 * devuelve **-1** para `failed` y `cancelled`. Las consecuencias eran dos, y las
 * dos falsas:
 *
 *   · `isReached = idx >= i` → `-1 >= 0` es false, asi que **ninguna** etapa se
 *     marcaba como alcanzada: la linea entera quedaba apagada.
 *   · `isError = i === Math.max(0, idx)` → `i === 0`, asi que el error se pintaba
 *     siempre en la etapa **`draft`**.
 *
 * Resultado: un job que fallo subiendo un video de 200 MB se dibujaba como si
 * hubiera fallado antes de empezar. El dato correcto estaba en el historial:
 * `{ from: 'uploading', to: 'failed', reason: 'Storage timeout after 5s' }`.
 *
 * Ahora `getFailurePoint()` lo lee de ahi. Si el historial no lo dice —un fixture
 * antiguo, un job terminal sin transiciones— no se supone nada: se marca la linea
 * como incompleta y se dice que no se sabe donde.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function JobProgressLine({ job }: { job: PerceptionJob }) {
  const fallo = getFailurePoint(job);

  // Con fallo, el avance llega hasta la etapa donde se rompio, no hasta -1. Sin
  // fallo, el indice del estado actual.
  const idx = fallo ? fallo.previousStageIndex : getProgressIndex(job.status);
  const esTerminalRoto = job.status === 'failed' || job.status === 'cancelled';

  return (
    <div className="flex flex-col gap-2">
    <div className="flex items-center gap-1">
      {PROGRESS_STAGES.map((stage, i) => {
        const isReached = idx >= i;
        const isCurrent = idx === i && !esTerminalRoto;
        // La etapa del error es la que dice el historial. Sin historial no se
        // marca ninguna: es mejor una linea sin culpable que un culpable inventado.
        const isError = fallo != null && i === fallo.previousStageIndex;

        return (
          <div key={stage} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className="h-px w-6"
                style={{ background: isReached ? 'var(--aqua-400)' : 'var(--hairline)' }}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex size-5 items-center justify-center rounded-full text-[length:8px] font-[var(--weight-medium)]"
                style={{
                  background: isError ? 'color-mix(in oklab, var(--state-critical) 30%, transparent)'
                    : isReached ? 'color-mix(in oklab, var(--aqua-400) 25%, transparent)'
                    : 'var(--glass-1)',
                  color: isError ? 'var(--crimson-400)'
                    : isReached ? 'var(--aqua-300)'
                    : 'var(--text-faint)',
                  boxShadow: isCurrent ? '0 0 8px 1px color-mix(in oklab, var(--aqua-400) 40%, transparent)' : undefined,
                }}
              >
                {i + 1}
              </div>
              <span className="t-mono-xs" style={{ color: isReached ? 'var(--text-secondary)' : 'var(--text-faint)' }}>
                {STAGE_LABELS[stage] ?? stage}
              </span>
            </div>
          </div>
        );
      })}

      {esTerminalRoto && (
        <div className="ml-3 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[var(--state-critical)]" />
          <span className="t-mono-xs text-[var(--crimson-400)]">
            {job.status === 'failed' ? 'Fallido' : 'Cancelado'}
          </span>
        </div>
      )}
    </div>

    {/*
      Los tres datos del fallo, los tres del historial: donde estaba, por que se
      rompio y cuando. Ninguno se deduce del estado.
    */}
    {fallo && (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pl-1">
        <span className="t-mono-xs text-[var(--text-muted)]">
          {fallo.outcome === 'failed' ? 'Fallo' : 'Cancelado'} en{' '}
          <span className="text-[var(--crimson-400)]">
            {STAGE_LABELS[fallo.previousStage] ?? fallo.previousStage}
          </span>
        </span>
        {fallo.reason && (
          <span className="t-mono-xs text-[var(--text-secondary)]">{fallo.reason}</span>
        )}
        <span className="t-mono-xs text-[var(--text-faint)]">
          {formatMomento(fallo.occurredAt)}
        </span>
      </div>
    )}

    {/*
      Un job terminal cuyo historial no registra la transicion: se dice que no se
      sabe. Antes se pintaba `draft` como culpable, que era una afirmacion falsa.
    */}
    {esTerminalRoto && !fallo && (
      <span className="t-mono-xs pl-1 text-[var(--text-faint)]">
        El historial de este job no registra en que etapa se detuvo.
      </span>
    )}
    </div>
  );
}

function formatMomento(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
