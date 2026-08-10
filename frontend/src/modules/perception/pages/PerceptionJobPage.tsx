/**
 * JOB DETAIL — visor de resultados de una inspeccion.
 */

import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Filter,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { AsyncStatus } from '../../../design/foundation/AsyncStatus';
import { useSessionStore } from '../../../auth/sessionStore';
import { ApiError } from '../../../lib/apiErrors';
import { CanvasHost } from '../../../shell/CanvasHost';
import {
  useArchiveJob,
  useChangeStatus,
  useDeletable,
  useDeleteJob,
  useDetections,
  useMediaUrl,
  usePerceptionJob,
  useUnarchiveJob,
} from '../usePerception';
import { ReconciliationPanel } from './ReconciliationPanel';
import {
  LIVE_STAGES,
  PROGRESS_STAGES,
  getFailurePoint,
  getLiveProgressIndex,
  getProgressIndex,
} from '../stateMachine';
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
    return <CanvasHost mode="grid"><p className="t-small text-[var(--text-warn)]">Job no encontrado</p></CanvasHost>;
  }

  const j = job.data;
  //  Un directo cambia TRES cosas de esta pantalla: no hay porcentaje de fotogramas
  //  —no se sabe el total—, la etapa «Completado» no es una meta sino un corte que
  //  alguien decide, y el origen es una URL y no un archivo.
  const esDirecto = j.media.type === 'stream';

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* Header */}
        <div>
          {/*
            `inline-flex` con altura minima al tacto: como `<a>` de linea medía 14px de
            alto y volver atras es el gesto mas repetido de esta pantalla.
          */}
          <Link
            to="/perception"
            className="t-mono-xs inline-flex items-center text-[var(--text-faint)] hover:underline pointer-coarse:min-h-11"
          >
            <ArrowLeft strokeWidth={1.5} className="mb-0.5 mr-1 inline size-3" />Inspecciones
          </Link>
          <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] text-[var(--text-primary)]">{j.name}</h1>
          {/*
            El origen. En un directo el nombre no es un archivo —es el que le puso quien
            lo abrió— y lo que identifica de dónde sale es la URL. Antes se pintaba el
            nombre para los tres tipos, así que un directo se leía como una foto.
          */}
          <p className="t-mono-xs text-[var(--text-faint)]">
            {esDirecto ? (
              <span className="text-[var(--text-accent)]">
                EN DIRECTO · {j.media.streamUrl ?? 'origen sin declarar'}
              </span>
            ) : (
              j.media.name
            )}{' '}
            · {j.modelLabel ?? 'sin modelo'}
          </p>
        </div>

        {/* El material. Era el fallo reportado: aqui no habia NADA que lo pintara. */}
        <Material job={j} />

        {/* Progress line */}
        <JobProgressLine job={j} />

        {/* Qué está pasando AHORA, qué falta, y quién lo hace. */}
        <QuePasa job={j} />

        {/* Quitar de en medio lo que no sirvio */}
        <Acciones job={j} />

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Detecciones" value={j.detectionCount} />
          <Stat
            label={esDirecto ? 'Fotogramas vistos' : 'Frames'}
            value={
              j.framesTotal !== null
                ? `${j.framesProcessed}/${j.framesTotal}`
                : String(j.framesProcessed)
            }
          />
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

        {/*
          La reconciliacion va DESPUES de las detecciones y a todo lo ancho, y ese
          orden es el del trabajo: primero se revisa lo que el modelo vio, y solo
          entonces tiene sentido contrastarlo con el WMS. Al lado del inspector
          compartiria espacio con una tabla que se lee entera.
        */}
        {jobId && <ReconciliationPanel jobId={jobId} puedeReconciliar={j.status === 'completed'} />}
      </div>
    </CanvasHost>
  );
}

/**
 * EL MATERIAL DE LA INSPECCIÓN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTA PANTALLA NO TENIA REPRODUCTOR. NINGUNO.
 *
 * Reportado desde el uso real: «cargo un vídeo, creo la inspección, el vídeo no se
 * muestra, y no da mensajes de advertencia ni de error». Las dos cosas eran ciertas y
 * por el mismo motivo: en *Nueva inspección* el vídeo se pintaba desde una object URL
 * del archivo elegido —que vive en la memoria de esa pestaña— y al navegar aquí no
 * había ni un `<video>` ni un `<img>`. Los bytes SÍ estaban en Storage.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA URL SE PIDE AL SERVIDOR, Y ESO NO ES UN DETALLE
 *
 * Los buckets son privados: no hay URL pública que poner en un `src`. Se pide una
 * firmada de una hora a `/jobs/{id}/media-url`. Así funciona tras recargar y desde
 * otro equipo, que es lo que la object URL nunca podía dar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Y CUANDO NO HAY NADA QUE VER, SE DICE
 *
 * `mediaAvailable` existía en el tipo desde el principio y NINGUNA pantalla lo leía:
 * se calculaba y se tiraba. De ahí el «no da mensajes». Ahora los tres casos tienen
 * palabras distintas, porque exigen cosas distintas de quien lee:
 *
 *   sin bytes    la subida se cortó. Hay que volver a crear la inspección.
 *   directo      no hay archivo que reproducir; el material pasó y no se guardó.
 *   sin worker   el material está bien, lo que falta es quién lo analice.
 */
function Material({ job }: { job: PerceptionJob }) {
  const esDirecto = job.media.type === 'stream';
  // No se pide URL para un directo ni para un medio sin bytes: seria un viaje al
  // servidor para recibir el 422 que ya sabemos que va a dar.
  const medio = useMediaUrl(job.id, !esDirecto && job.mediaAvailable);
  const url = job.media.url ?? medio.data ?? null;

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
      <PanelHeader
        title="Material"
        subtitle={
          esDirecto
            ? 'Un directo no deja archivo: lo que se ve es lo que pasó por delante'
            : `${job.media.name} · ${formatearBytes(job.media.bytes)}`
        }
      />

      {/* ── Un directo no tiene nada que reproducir ────────────────────── */}
      {esDirecto && (
        <p className="t-mono-xs max-w-[76ch] text-[var(--text-faint)]">
          Esta inspección se abrió como emisión en vivo{' '}
          {job.media.streamUrl ? <code>{job.media.streamUrl}</code> : null}. El vídeo no
          se guarda: lo que queda son las detecciones de lo que pasó por delante de la
          cámara mientras estuvo abierta.
        </p>
      )}

      {/* ── Los bytes no llegaron ─────────────────────────────────────── */}
      {!esDirecto && !job.mediaAvailable && (
        <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
          <p className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-warn)]">
            <AlertTriangle strokeWidth={1.5} className="size-4" />
            El archivo no llegó a Storage
          </p>
          <p className="t-mono-xs mt-1 max-w-[76ch] text-[var(--text-faint)]">
            La inspección quedó registrada con sus datos —almacén, umbral, quién la
            pidió— pero sin bytes que analizar. Suele ser una subida cortada a medias.
            Hay que <strong>volver a crearla</strong> subiendo el archivo; esta se puede
            borrar abajo.
          </p>
        </div>
      )}

      {/* ── El caso normal: hay material, se ve ───────────────────────── */}
      {!esDirecto && job.mediaAvailable && (
        <>
          {medio.isLoading && !url && (
            <div className="mt-1">
              <AsyncStatus phase="pending" pendingLabel="Pidiendo el material" />
            </div>
          )}

          {medio.isError && !url && (
            <p className="t-mono-xs max-w-[76ch] text-[var(--text-warn)]">
              No se pudo obtener el material. Los bytes están guardados —esto es un fallo
              al firmar el enlace, no una pérdida—; vuelve a entrar en un momento.
            </p>
          )}

          {url && (
            <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)] bg-black">
              {job.media.type === 'video' ? (
                /*
                  `controls` y sin `autoplay`: quien abre una inspección de 70 MB por la
                  red de un almacén decide cuándo gastar ese ancho de banda.
                  `preload="metadata"` trae la duración y el primer fotograma sin
                  descargar el vídeo entero.
                */
                <video
                  src={url}
                  controls
                  preload="metadata"
                  className="size-full object-contain"
                />
              ) : (
                <img src={url} alt={job.media.name} className="size-full object-contain" />
              )}
            </div>
          )}
        </>
      )}

      {/*
        Y lo que falta para que esto SIRVA de algo, que es la otra mitad del «no hace
        lectura». `processingAvailable` tambien estaba en el tipo sin que nadie lo
        leyera. Ver el video y que no se analice son dos problemas distintos.
      */}
      {!job.processingAvailable && job.status !== 'completed' && (
        <p className="t-mono-xs max-w-[76ch] text-[var(--text-faint)]">
          <strong>Nadie va a analizar esto todavía.</strong> No hay ningún worker de
          inferencia activo{job.modelLabel ? '' : ' ni modelo publicado'}, así que la
          inspección espera en la cola. El material está guardado y se analizará cuando
          haya quien lo haga — no hace falta volver a subirlo.
        </p>
      )}
    </Panel>
  );
}

/**
 * QUITAR DE EN MEDIO LO QUE NO SIRVIÓ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BORRAR Y ARCHIVAR NO SON LO MISMO, Y LA PANTALLA NO LO DISIMULA
 *
 * Borrar libera Storage, que es el motivo de que esto exista: un vídeo de 70 MB que
 * nunca se analizó ocupa igual. Archivar solo lo saca de la lista.
 *
 * Cuál toca NO lo decide quien pulsa: lo decide el dato. Si de la inspección cuelga
 * una incidencia, una detección promovida a observación de rack o una revisada por una
 * persona, borrar destruiría algo que nadie puede reconstruir, y el único botón que
 * aparece es archivar — con el motivo escrito, no con un «no se puede».
 */
function Acciones({ job }: { job: PerceptionJob }) {
  const navigate = useNavigate();
  const puedeBorrar = useSessionStore((s) => s.hasPermission('perception:delete'));
  const estado = useDeletable(job.id);
  const archivar = useArchiveJob();
  const desarchivar = useUnarchiveJob();
  const borrar = useDeleteJob();
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  // Sin permiso no se pinta el panel: un bloque de acciones deshabilitadas solo
  // informa de lo que otros pueden hacer.
  if (!puedeBorrar) return null;

  const enlaces = estado.data;
  const bloqueada = enlaces ? !enlaces.borrable : true;

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
      <PanelHeader
        title="Quitar de en medio"
        subtitle="Borrar libera el espacio en Storage. Archivar solo la saca de la lista."
      />

      {estado.isLoading && (
        <AsyncStatus phase="pending" pendingLabel="Comprobando qué cuelga de ella" />
      )}

      {/* ── Lo que impide borrarla, con nombre y número ─────────────────── */}
      {enlaces && bloqueada && (
        <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
          <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
            Esta inspección no se puede borrar: de ella cuelga trabajo que nadie puede
            reconstruir.
          </p>
          <ul className="t-mono-xs mt-2 flex flex-col gap-1 text-[var(--text-muted)]">
            {enlaces.incidencias > 0 && (
              <li>
                · {enlaces.incidencias} incidencia(s) abiertas desde ella — alguien fue
                al pasillo por esto.
              </li>
            )}
            {enlaces.promovidas > 0 && (
              <li>
                · {enlaces.promovidas} detección(es) promovidas a observaciones de rack
                sobre el plano.
              </li>
            )}
            {enlaces.revisadas > 0 && (
              <li>
                · {enlaces.revisadas} detección(es) aceptadas, rechazadas o corregidas
                por una persona.
              </li>
            )}
          </ul>
          <p className="t-mono-xs mt-2 max-w-[76ch] text-[var(--text-faint)]">
            Se puede <strong>archivar</strong>: sale de la lista y el rastro se queda.
            Eso <strong>no libera</strong> sus {formatearBytes(job.media.bytes)}.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {job.archivedAt ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={desarchivar.isPending}
            onClick={() => desarchivar.mutate(job.id)}
          >
            {desarchivar.isPending ? 'Devolviendo…' : 'Devolver a la lista'}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={archivar.isPending}
            onClick={() => archivar.mutate(job.id)}
          >
            <Archive strokeWidth={1.5} className="size-3.5" />
            {archivar.isPending ? 'Archivando…' : 'Archivar'}
          </Button>
        )}

        {enlaces && !bloqueada && !confirmando && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmando(true)}>
            <Trash2 strokeWidth={1.5} className="size-3.5" />
            Borrar y liberar {formatearBytes(job.media.bytes)}
          </Button>
        )}

        {confirmando && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="t-mono-xs text-[var(--text-warn)]">
              Se borran la inspección, sus {job.detectionCount} detecciones y el
              archivo. No se puede deshacer.
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={borrar.isPending}
              onClick={() =>
                borrar.mutate(job.id, {
                  onSuccess: (r) => {
                    // El resultado se ENSEÑA antes de irse: un borrado que liberó 0
                    // bytes —archivo compartido, o fallo al quitarlo de Storage— tiene
                    // que poder verse, porque el motivo de borrar era hacer sitio.
                    setResultado(
                      r.storage_liberado > 0
                        ? `Liberados ${formatearBytes(r.storage_liberado)}.`
                        : r.medio_compartido
                          ? 'El archivo lo usaba otra inspección: no se borró.'
                          : 'La inspección se borró, pero el archivo sigue en Storage.',
                    );
                    setTimeout(() => navigate('/perception'), 1800);
                  },
                })
              }
            >
              {borrar.isPending ? 'Borrando…' : 'Sí, borrar'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
          </span>
        )}
      </div>

      {resultado && (
        <p className="t-mono-xs text-[var(--text-ok)]">{resultado}</p>
      )}
      {borrar.isError && (
        <p className="t-mono-xs max-w-[76ch] text-[var(--text-warn)]">
          {borrar.error instanceof ApiError
            ? borrar.error.message
            : 'No se pudo borrar la inspección.'}
        </p>
      )}
    </Panel>
  );
}

/** Bytes en algo que se lee. `0` es «sin archivo», no «0 B». */
function formatearBytes(bytes: number): string {
  if (!bytes) return 'sin archivo';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * QUÉ ESTÁ PASANDO AHORA MISMO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA LINEA DE ETAPAS DICE DONDE ESTA, NO QUE OCURRE
 *
 * Reportado desde el uso real: «Borrador · Subiendo · Subido, pero no tenemos
 * conocimiento de qué está pasando. No sé si está procesando algo o está detenido. No
 * hay detecciones, no hay mensajes de error, no hay nada, no sé cuándo va a pasar a
 * En cola».
 *
 * Tenía toda la razón, y por dos motivos a la vez:
 *
 *   · la línea de etapas pinta la POSICION —bolita 3 de 6— y no dice si algo se está
 *     moviendo o si lleva tres horas parado.
 *   · en «Subido» no se movía **nada**, porque el backend no encola por su cuenta y la
 *     aplicación no tenía botón para encolar. La espera era infinita por diseño, y
 *     nadie lo decía.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TRES PREGUNTAS, SIEMPRE LAS MISMAS
 *
 *   ¿qué pasa?     el estado en una frase, no una etiqueta
 *   ¿qué falta?    la acción concreta que desbloquea, y de quién es
 *   ¿desde cuándo? porque «en cola» treinta segundos y «en cola» dos días son
 *                  problemas distintos y la bolita se ve igual
 *
 * Se distingue con cuidado «esperando a que alguien lo pida» de «esperando a una
 * máquina que no existe»: la primera la arregla quien mira la pantalla, la segunda no.
 */
function QuePasa({ job }: { job: PerceptionJob }) {
  const puedeEscribir = useSessionStore((s) => s.hasPermission('perception:write'));
  const cambiar = useChangeStatus();
  const [error, setError] = useState<string | null>(null);

  const encolar = () => {
    setError(null);
    cambiar.mutate(
      { jobId: job.id, to: 'queued' },
      {
        onError: (e) =>
          setError(e instanceof ApiError ? e.message : 'No se pudo poner en cola.'),
      },
    );
  };

  const n = narrar(job);

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              n.latiendo && 'animate-pulse',
            )}
            style={{ background: n.color }}
          />
          <div>
            <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
              {n.pasa}
            </p>
            {n.desde && (
              <p className="t-mono-xs mt-0.5 text-[var(--text-faint)]">{n.desde}</p>
            )}
          </div>
        </div>

        {/* La acción que desbloquea, si es de quien está mirando. */}
        {n.accion === 'encolar' && puedeEscribir && (
          <Button
            variant="primary"
            size="sm"
            disabled={cambiar.isPending}
            onClick={encolar}
          >
            <Play strokeWidth={1.5} className="size-3.5" />
            {cambiar.isPending ? 'Poniendo en cola…' : 'Analizar ahora'}
          </Button>
        )}
        {n.accion === 'reintentar' && puedeEscribir && (
          <Button
            variant="secondary"
            size="sm"
            disabled={cambiar.isPending}
            onClick={encolar}
          >
            <RotateCcw strokeWidth={1.5} className="size-3.5" />
            {cambiar.isPending ? 'Reintentando…' : 'Reintentar'}
          </Button>
        )}
      </div>

      {/* Qué falta para que avance. Es la parte que no existía. */}
      <p className="t-mono-xs max-w-[80ch] text-[var(--text-muted)]">{n.falta}</p>

      {/*
        El progreso REAL cuando hay algo corriendo. Sin esto, «Procesando» es una
        bolita encendida que no distingue entre avanzar y estar colgado.
      */}
      {job.status === 'running' && (
        <div className="flex flex-col gap-1">
          <div className="h-1 w-full overflow-hidden rounded-full [background:var(--glass-2)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width:
                  job.framesTotal && job.framesTotal > 0
                    ? `${Math.min(100, (job.framesProcessed / job.framesTotal) * 100)}%`
                    : '15%',
                background: 'var(--aqua-400)',
              }}
            />
          </div>
          <p className="t-mono-xs text-[var(--text-faint)]">
            {job.framesTotal && job.framesTotal > 0
              ? `${job.framesProcessed} de ${job.framesTotal} fotogramas · ${job.detectionCount} detecciones hasta ahora`
              : `${job.framesProcessed} fotogramas analizados · ${job.detectionCount} detecciones. No se sabe el total, así que no hay porcentaje.`}
          </p>
        </div>
      )}

      {/* El error del motor, tal cual. Es el dato, no un resumen. */}
      {job.status === 'failed' && job.errorMessage && (
        <div className="rounded-[var(--radius-sm)] p-3 [background:color-mix(in_oklab,var(--state-critical)_10%,transparent)]">
          <p className="t-label text-[var(--text-warn)]">lo que dijo el sistema</p>
          <p className="t-mono-xs mt-1 break-words text-[var(--text-secondary)]">
            {job.errorMessage}
          </p>
        </div>
      )}

      {error && <p className="t-mono-xs text-[var(--text-warn)]">{error}</p>}
    </Panel>
  );
}

/**
 * El estado traducido a las tres preguntas.
 *
 * Una función y no un mapa de literales: lo que hay que decir en «En cola» depende de
 * si existe un worker, y en «Subido» de si alguien puede pulsar. Un diccionario plano
 * diría lo mismo en los dos casos y uno de los dos sería mentira.
 */
function narrar(job: PerceptionJob): {
  pasa: string;
  falta: string;
  desde: string | null;
  color: string;
  latiendo: boolean;
  accion: 'encolar' | 'reintentar' | null;
} {
  const hayWorker = job.processingAvailable;
  const desdeCola = job.queuedAt ? `en cola desde ${hace(job.queuedAt)}` : null;
  const desdeCorre = job.startedAt ? `analizando desde ${hace(job.startedAt)}` : null;

  switch (job.status) {
    case 'draft':
      return {
        pasa: 'Registrada, sin material.',
        falta:
          'La inspección existe pero no tiene archivo. Nada va a pasar hasta que se suba uno: vuelve a crearla.',
        desde: null,
        color: 'var(--text-faint)',
        latiendo: false,
        accion: null,
      };

    case 'uploading':
      return {
        pasa: 'Subiendo el archivo.',
        falta:
          'Los bytes están viajando a Storage. Si se queda aquí, la subida se cortó y hay que volver a crear la inspección.',
        desde: null,
        color: 'var(--aqua-400)',
        latiendo: true,
        accion: null,
      };

    case 'uploaded':
      return {
        pasa: 'El material está guardado. Ahora mismo NO se está analizando nada.',
        falta: hayWorker
          ? 'Falta ponerla en cola: el análisis no arranca solo, para que puedas revisar el umbral y el modelo antes de gastar máquina. Pulsa «Analizar ahora».'
          : 'Falta ponerla en cola, y además no hay ningún worker de inferencia activo. Puedes encolarla ya —esperará ahí— pero no avanzará hasta que se levante un worker.',
        desde: null,
        color: 'var(--state-alert)',
        latiendo: false,
        accion: 'encolar',
      };

    case 'queued':
      return {
        pasa: hayWorker
          ? 'En cola. Hay un worker activo, así que debería cogerla en segundos.'
          : 'En cola, y esperando a una máquina que no existe.',
        falta: hayWorker
          ? 'Nada por tu parte: el worker la toma y pasa a «Procesando». Si se queda aquí varios minutos con worker activo, está atascado.'
          : 'No hay ningún worker de inferencia registrado. La cola no avanza sola: hay que levantar uno. Mientras, el material y los parámetros quedan guardados.',
        desde: desdeCola,
        color: hayWorker ? 'var(--aqua-400)' : 'var(--state-alert)',
        latiendo: hayWorker,
        accion: null,
      };

    case 'running':
      return {
        pasa: 'Analizando el material.',
        falta:
          'Nada por tu parte. Abajo va el avance real; si el número de fotogramas no se mueve durante minutos, el worker se colgó y conviene cancelar y reintentar.',
        desde: desdeCorre,
        color: 'var(--aqua-400)',
        latiendo: true,
        accion: null,
      };

    case 'completed':
      return {
        pasa:
          job.detectionCount > 0
            ? `Terminada, con ${job.detectionCount} detecciones.`
            : 'Terminada, y sin una sola detección.',
        falta:
          job.detectionCount > 0
            ? 'Ya se puede revisar la lista de abajo y reconciliar contra el WMS.'
            : 'El análisis corrió y no encontró nada. Suele significar que el modelo no reconoce lo que hay en el material, no que el material esté vacío.',
        desde: job.completedAt ? `terminó ${hace(job.completedAt)}` : null,
        color: 'var(--state-confirmed)',
        latiendo: false,
        accion: null,
      };

    case 'failed':
      return {
        pasa: 'Falló durante el análisis.',
        falta:
          'El material sigue guardado, así que reintentar no exige volver a subirlo. Lo que dijo el sistema está abajo — si no lo explica, mira los registros del worker.',
        desde: null,
        color: 'var(--state-critical)',
        latiendo: false,
        accion: 'reintentar',
      };

    case 'cancelled':
      return {
        pasa: 'Cancelada.',
        falta:
          'Alguien la paró a propósito. El material sigue guardado y se puede volver a poner en cola.',
        desde: null,
        color: 'var(--text-faint)',
        latiendo: false,
        accion: 'reintentar',
      };

    default:
      return {
        pasa: `Estado «${job.status}».`,
        falta: 'Este estado no está contemplado en la pantalla. No se inventa lo que hace falta para salir de él.',
        desde: null,
        color: 'var(--text-faint)',
        latiendo: false,
        accion: null,
      };
  }
}

/**
 * «hace 4 minutos», «hace 2 horas».
 *
 * En palabras y no una fecha: la pregunta que se hace mirando esto es «¿lleva mucho?»,
 * y `10/08/2026 09:29` obliga a calcular. La fecha exacta está en el historial.
 */
function hace(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'hace un momento';
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
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

/**
 * Las dos etapas que un directo llama de otra forma.
 *
 * `running` no es «Procesando»: es que la cámara está emitiendo AHORA. Y `completed` no
 * es «Completado» —un directo no se completa solo— sino el corte que decide alguien.
 *
 * Reusar las etiquetas del archivo haría que la barra dijera «Completado» de una emisión
 * que se cortó a los diez segundos, y eso se lee como que terminó bien.
 */
const STAGE_LABELS_DIRECTO: Record<string, string> = {
  running: 'Emitiendo',
  completed: 'Cerrado',
};

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

  // Un directo recorre TRES etapas, no seis: no hay nada que subir. Con las seis, las
  // tres primeras saldrian marcadas como completadas y eso afirmaria que hubo una
  // subida que nunca existio.
  const esDirecto = job.media.type === 'stream';
  const etapas = esDirecto ? LIVE_STAGES : PROGRESS_STAGES;

  // Con fallo, el avance llega hasta la etapa donde se rompio, no hasta -1. Sin
  // fallo, el indice del estado actual.
  const idx = fallo
    ? fallo.previousStageIndex
    : esDirecto
      ? getLiveProgressIndex(job.status)
      : getProgressIndex(job.status);
  const esTerminalRoto = job.status === 'failed' || job.status === 'cancelled';

  return (
    <div className="flex flex-col gap-2">
    <div className="flex items-center gap-1">
      {etapas.map((stage, i) => {
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
                {(esDirecto ? STAGE_LABELS_DIRECTO[stage] : null) ??
                  STAGE_LABELS[stage] ??
                  stage}
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
