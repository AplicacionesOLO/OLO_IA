/**
 * JOB DETAIL — visor de resultados de una inspeccion.
 */

import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Filter,
  Images,
  MapPin,
  Maximize2,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  useTodasLasDetecciones,
  useMediaUrl,
  usePreviewUrl,
  useVideoUrl,
  usePerceptionJob,
  useReadingDiagnosis,
  usePerceptionModels,
  useResolverHueco,
  useSubirFotograma,
  useUnarchiveJob,
  useVincularVideo,
} from '../usePerception';
import { esUbicacionCompleta } from '../codigos';
import { FramesToDatasetModal } from './FramesToDatasetModal';
import { ReconciliationPanel } from './ReconciliationPanel';
import {
  LIVE_STAGES,
  PROGRESS_STAGES,
  getFailurePoint,
  getLiveProgressIndex,
  getProgressIndex,
} from '../stateMachine';
import type { Detection, PerceptionJob, ReviewStatus } from '../types';
import { cn } from '../../../design/utils/cn';

export function PerceptionJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const job = usePerceptionJob(jobId ?? null);
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | undefined>(undefined);
  const [selectedDet, setSelectedDet] = useState<Detection | null>(null);

  //  `vivo`: mientras el trabajo esté en cola o corriendo, las detecciones se
  //  refrescan solas y APARECEN a medida que el worker las encuentra.
  const vivo = job.data?.status === 'queued' || job.data?.status === 'running';

  /*
    ── TODAS, NO LA PRIMERA PÁGINA ─────────────────────────────────────────────

    Reportado y medido: en `dataset7` las cajas dejaban de dibujarse a mitad del vídeo.
    No fallaba la capa ni el análisis —los 74 fotogramas estaban procesados y la última
    detección está en el ms 14.607 de 14.741—: la pantalla pedía CINCUENTA detecciones de
    224, y esas cincuenta llegaban hasta el ms 6.403. Desde el segundo 6,4 no había nada
    que dibujar porque nunca se pidió.

    La misma consulta alimenta cuatro cosas, así que fallaban las cuatro a la vez: la capa
    sobre el vídeo, la regleta de la línea de tiempo, el modal que elige fotogramas para el
    dataset —decidiendo qué instantes son interesantes sin ver más de la mitad— y la lista,
    que ponía «224 resultados» encima de cincuenta filas.
  */
  const detections = useTodasLasDetecciones(jobId ?? null, vivo, reviewFilter);
  //  El proyecto de IA sale del catalogo, casando el modelo con el que se analizo. Sin
  //  el, mandar fotogramas los metaria en un dataset adivinado.
  const modelos = usePerceptionModels();
  const [eligiendoFotogramas, setEligiendoFotogramas] = useState(false);
  const proyectoIa =
    (modelos.data?.models ?? []).find(
      (m) => m.modelVersionId === job.data?.config.modelVersionId,
    )?.aiProjectId ?? null;
  const subirFotograma = useSubirFotograma(proyectoIa);
  const vincularVideo = useVincularVideo(proyectoIa, jobId ?? null);
  //  La MISMA consulta que usa el reproductor: `useMediaUrl` la cachea 50 minutos, asi
  //  que abrir el modal no pide otra firma.
  const urlMedio = useMediaUrl(
    jobId ?? null,
    job.data?.media.type !== 'stream' && Boolean(job.data?.mediaAvailable),
  );
  //  Y la copia, como SEGUNDA fuente del modal de anotar: el original de un dron es
  //  H.265 y el `<video>` del que salen los fotogramas no lo decodifica. Sin esto, el
  //  analisis se hacia y no habia forma de mandar un fotograma a anotar.
  const urlCopia = usePreviewUrl(
    jobId ?? null,
    Boolean(job.data?.media.hasPreview) && job.data?.media.type !== 'stream',
  );

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

        {/* El material, con lo que la IA vio dibujado encima. */}
        <Material
          job={j}
          detecciones={detections.data?.items ?? []}
          seleccionada={selectedDet}
          onElegir={setSelectedDet}
          onElegirFotogramas={
            j.media.type === 'video' && j.mediaAvailable
              ? () => setEligiendoFotogramas(true)
              : undefined
          }
        />

        {eligiendoFotogramas && (
          <FramesToDatasetModal
            job={j}
            detecciones={detections.data?.items ?? []}
            projectId={
              (modelos.data?.models ?? []).find(
                (m) => m.modelVersionId === j.config.modelVersionId,
              )?.aiProjectId ?? null
            }
            mediaUrl={j.media.url ?? urlMedio.data ?? null}
            mediaUrlAlternativa={urlCopia.data ?? null}
            //  La firma tarda: sin esto el modal abría diciendo «El material no está
            //  disponible» cuando lo único que pasaba es que la petición iba en vuelo.
            firmaEnVuelo={urlMedio.isPending || urlMedio.isFetching}
            //  Y las detecciones también: si el modal empieza a recortar antes de
            //  conocerlas, los instantes interesantes no entran en la lista y al llegar
            //  después obligan a repetir la extracción entera.
            deteccionesEnVuelo={detections.isPending || detections.isFetching}
            onCerrar={() => setEligiendoFotogramas(false)}
            onSubir={subirFotograma}
            onVincularVideo={vincularVideo}
          />
        )}

        {/* Progress line */}
        <JobProgressLine job={j} />

        {/* Qué está pasando AHORA, qué falta, y quién lo hace. */}
        <QuePasa job={j} />

        {/* Quitar de en medio lo que no sirvio */}
        <Acciones job={j} />

        {/* Por que este analisis leyo lo que leyo. Antes de las cifras, no despues. */}
        {jobId && <AvisoDeLectura jobId={jobId} status={j.status} />}

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

            {/*
              CUANDO EL TOPE CORTA, SE DICE.

              Con miles de detecciones no se traen todas: pintarlas colgaría el navegador.
              Pero una capa que se apaga a mitad del vídeo sin avisar es exactamente el
              fallo que se acaba de corregir, y repetirlo callando sería peor que el
              original — ahí al menos se notaba—.
            */}
            {detections.data?.truncated && (
              <p className="t-mono-xs max-w-[80ch] text-[var(--text-warn)]">
                Se cargaron {detections.data.items.length.toLocaleString('es')} de{' '}
                {detections.data.total.toLocaleString('es')} detecciones. Las cajas sobre
                el vídeo y la regleta solo cubren esa parte: el resto del material está
                analizado, pero no se dibuja.
              </p>
            )}

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
                    {/*
                      EL CODIGO LEIDO. No se enseñaba en ninguna parte de la interfaz, y es
                      el dato mas valioso de la deteccion: la diferencia entre «hay una
                      etiqueta ahi» y «dice RCL47-C018-N01-2». Quien revisaba no podia
                      verlo.

                      En negrita si identifica un hueco completo y en gris si no: un codigo
                      a nivel de cuerpo se lee, pero no ubica.
                    */}
                    {det.textValue && (
                      <span
                        className={cn(
                          'truncate font-[family-name:var(--font-data)] text-[length:var(--text-xs)]',
                          esUbicacionCompleta(det.textValue)
                            ? 'text-[var(--text-accent)]'
                            : 'text-[var(--text-faint)]',
                        )}
                        title={det.textValue}
                      >
                        {det.textValue}
                      </span>
                    )}
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
function Material({
  job,
  detecciones,
  seleccionada,
  onElegirFotogramas,
  onElegir,
}: {
  job: PerceptionJob;
  detecciones: Detection[];
  seleccionada: Detection | null;
  /** Solo para vídeo con bytes: de una foto no hay fotogramas que elegir. */
  onElegirFotogramas?: (() => void) | undefined;
  /** Elegir una detección: el vídeo salta a su instante y se para con la caja encima. */
  onElegir: (d: Detection) => void;
}) {
  const esDirecto = job.media.type === 'stream';
  // No se pide URL para un directo ni para un medio sin bytes: seria un viaje al
  // servidor para recibir el 422 que ya sabemos que va a dar.
  //  La copia ligera si la hay: el original suele ser H.265 y este navegador no lo
  //  reproduce. Ver `useVideoUrl` — el modal de dataset sigue con el original—.
  const medio = useVideoUrl(
    job.id,
    Boolean(job.media.hasPreview),
    !esDirecto && job.mediaAvailable,
  );
  const url = job.media.url ?? medio.data ?? null;

  const video = useRef<HTMLVideoElement | null>(null);
  const marco = useRef<HTMLDivElement | null>(null);
  /**
   * Qué INSTANTE del vídeo se está mirando, en milisegundos.
   *
   * ── POR QUE EL TIEMPO Y NO EL NUMERO DE FOTOGRAMA ──────────────────────────
   *
   * La primera versión emparejaba las cajas por `frameNumber`, traduciendo el tiempo
   * del reproductor con `frameSamplingRate`. Está mal, y se vio con el dato real: la
   * detección del vídeo del almacén es el fotograma **360** con `frame_ms` **6.030**,
   * o sea ~60 fotogramas por segundo. `frameSamplingRate` es 1.0 — pero eso es cada
   * cuánto MUESTREA el worker, no la cadencia del vídeo. Con esa cuenta, el fotograma
   * 360 caía en el segundo 360 de un vídeo de 11 segundos.
   *
   * El tiempo no necesita traducción: el worker guarda `frame_ms` y el reproductor da
   * segundos. `frameNumber` se sigue enseñando porque identifica la detección, pero no
   * se usa para posicionar nada.
   */
  const [instanteMs, setInstanteMs] = useState<number | null>(null);

  /**
   * Al elegir una detección, el vídeo SALTA a su instante.
   *
   * Es la mitad del valor de esto: una lista que dice «pallet, 78 %» no se puede
   * comprobar. Viendo el fotograma con la caja encima, cualquiera juzga en un segundo
   * si el modelo acertó.
   *
   * ── Y HAY QUE ESPERAR A QUE EL VIDEO SEPA SU DURACION ─────────────────────
   *
   * Poner `currentTime` antes de que carguen los metadatos no hace nada: el navegador
   * no sabe todavía a dónde saltar. La primera versión exigía `Number.isFinite(duration)`
   * y, si no lo era, se rendía en silencio — el vídeo se quedaba en 0 y la caja aparecía
   * sobre el primer fotograma, que es peor que no saltar: afirma que el modelo vio algo
   * donde no lo vio.
   *
   * Ahora, si los metadatos no están, el salto se apunta y se hace en cuanto lleguen.
   */
  useEffect(() => {
    if (!seleccionada || seleccionada.timestampMs == null) return;
    const ms = seleccionada.timestampMs;
    setInstanteMs(ms);

    const v = video.current;
    if (!v) return;

    const saltar = () => {
      v.pause();
      const seg = ms / 1000;
      v.currentTime = Number.isFinite(v.duration)
        ? Math.min(seg, Math.max(0, v.duration - 0.05))
        : seg;
    };

    // `readyState >= 1` es HAVE_METADATA: ya se sabe la duración.
    if (v.readyState >= 1) {
      saltar();
      return;
    }
    v.addEventListener('loadedmetadata', saltar, { once: true });
    return () => v.removeEventListener('loadedmetadata', saltar);
  }, [seleccionada]);

  /**
   * Las cajas del instante que se está viendo.
   *
   * La tolerancia sale del MUESTREO: con 1 fotograma por segundo, el worker analizó uno
   * cada 1.000 ms, así que media ventana a cada lado es lo que corresponde a «este es el
   * fotograma analizado más cercano». Con una tolerancia fija de, digamos, 100 ms, mover
   * el vídeo a mano casi nunca caería sobre un fotograma analizado y no se vería nada.
   */
  /*
    ── LA PANTALLA COMPLETA ES DEL MARCO, NO DEL VIDEO ─────────────────────────

    Reportado y comprobado: al maximizar, las cajas desaparecían. El botón nativo del
    reproductor pone a pantalla completa el `<video>` solo, y la capa de detecciones —que es
    un hermano posicionado encima— se queda fuera de esa pantalla.

    Poniendo el MARCO, el vídeo y la capa van juntos y las cajas siguen donde deben.
  */
  const [pantallaCompleta, setPantallaCompleta] = useState(false);

  //  Se escucha el evento del navegador en vez de fiarse del clic: se sale de pantalla
  //  completa con Esc, y entonces nadie llama a nuestro manejador. Sin esto, el marco se
  //  quedaría con las clases de pantalla completa dentro del panel.
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(document.fullscreenElement === marco.current);
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);

  const aPantallaCompleta = () => {
    const m = marco.current;
    if (!m) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void m.requestFullscreen?.();
  };

  const tolerancia = Math.max(
    250,
    (1000 / (job.config.frameSamplingRate || 1)) / 2,
  );
  const cajas =
    instanteMs == null
      ? []
      : detecciones.filter(
          (d) =>
            d.timestampMs != null && Math.abs(d.timestampMs - instanteMs) <= tolerancia,
        );

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelHeader
          title="Material"
          subtitle={
            esDirecto
              ? 'Un directo no deja archivo: lo que se ve es lo que pasó por delante'
              : `${job.media.name} · ${formatearBytes(job.media.bytes)}`
          }
        />
        {/*
          Sacar fotogramas para anotar. Es el cuello de botella medido del modelo: el
          dataset son ~20 imágenes y el conjunto de validación tiene UNA sola caja de
          códigos de hueco, así que el AP no puede medir nada. El material bueno está
          justo aquí, en los vídeos del almacén.
        */}
        {onElegirFotogramas && (
          <Button variant="secondary" size="sm" onClick={onElegirFotogramas}>
            <Images strokeWidth={1.5} className="size-3.5" />
            Mandar fotogramas a anotar
          </Button>
        )}
      </div>

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
            /*
              ── EL MARCO TOMA LA PROPORCION DEL MEDIO ─────────────────────────

              Dos intentos fallidos antes de esto, los dos vistos con el vídeo real del
              almacén, que es VERTICAL (478×850):

                `aspect-video` + `object-contain`   la imagen quedaba centrada con franjas
                                                    negras a los lados, y las cajas —en
                                                    porcentaje sobre el CONTENEDOR— se
                                                    estiraban sobre esas franjas: la caja
                                                    aparecía donde no estaba el pallet.
                contenedor `w-fit` al medio         depende de `videoWidth`, que es 0 hasta
                                                    que cargan los metadatos. El vídeo se
                                                    colapsaba al tamaño por defecto y el
                                                    panel quedaba en un sello.

              La proporción se fija con las medidas que YA están guardadas del medio, así
              que el marco es correcto ANTES de que el vídeo cargue: no hay franjas, no
              hay salto de maquetación, y los porcentajes del modelo caen donde el modelo
              los vio. `16 / 9` solo si el medio no trae medidas.
            */
            <div
              ref={marco}
              className={cn(
                'relative mx-auto overflow-hidden bg-black',
                //  `w-full` SOLO fuera de pantalla completa: dentro, el ancho lo tiene que
                //  decidir la proporción del vídeo. Ver la nota del estilo.
                !pantallaCompleta && 'w-full',
                //  El tope de altura y las esquinas SOLO fuera de pantalla completa. Se
                //  hace con estado y no con una variante `fullscreen:` de Tailwind porque
                //  esa variante no existe en v4: las clases se habrían escrito y no habrían
                //  hecho nada, y el vídeo se vería a media pantalla con marco negro.
                !pantallaCompleta && 'max-h-[60vh] rounded-[var(--radius-md)]',
              )}
              style={{
                aspectRatio:
                  job.media.width && job.media.height
                    ? `${job.media.width} / ${job.media.height}`
                    : '16 / 9',
                //  Fuera de pantalla completa, el ancho se ata a la altura para que un
                //  vídeo vertical no ocupe el panel entero. Dentro, atarlo dejaría la
                //  imagen pequeña en medio de una pantalla negra.
                maxWidth:
                  pantallaCompleta || !job.media.width || !job.media.height
                    ? undefined
                    : `calc(60vh * ${job.media.width} / ${job.media.height})`,
              }}
            >
              {job.media.type === 'video' ? (
                /*
                  `controls` y sin `autoplay`: quien abre una inspección de 70 MB por la
                  red de un almacén decide cuándo gastar ese ancho de banda.
                  `preload="metadata"` trae la duración y el primer fotograma sin
                  descargar el vídeo entero.
                */
                <video
                  ref={video}
                  src={url}
                  controls
                  /*
                    ── SIN EL BOTON NATIVO DE PANTALLA COMPLETA ──────────────────

                    El botón del navegador pone a pantalla completa el `<video>` Y NADA MÁS.
                    Las cajas de las detecciones son un `<div>` HERMANO posicionado encima,
                    así que se quedan detrás y desaparecen: el vídeo se ve enorme y sin una
                    sola marca de lo que la IA encontró. Justo cuando más falta hacen, porque
                    a pantalla completa es cuando se mira el detalle.

                    Se quita el botón nativo y se pone uno que llama a `requestFullscreen`
                    sobre el MARCO. Con el marco a pantalla completa, la capa de cajas va
                    dentro y sigue encima.
                  */
                  controlsList="nofullscreen"
                  preload="metadata"
                  className="size-full object-contain"
                  //  Al mover el vídeo, las cajas siguen a la imagen. Se guarda el
                  //  TIEMPO tal cual: no hay traducción que hacer ni que equivocar.
                  onTimeUpdate={(e) => {
                    const ms = Math.round(e.currentTarget.currentTime * 1000);
                    //  Solo se actualiza si se movió más de un cuarto de segundo:
                    //  `timeupdate` salta cuatro veces por segundo y repintar la capa
                    //  en cada uno no cambiaría nada visible.
                    if (instanteMs == null || Math.abs(ms - instanteMs) > 250) {
                      setInstanteMs(ms);
                    }
                  }}
                />
              ) : (
                <img src={url} alt={job.media.name} className="size-full object-contain" />
              )}

              {/*
                ── LO QUE LA IA VIO, ENCIMA DE LA IMAGEN ──────────────────────
                Las coordenadas vienen NORMALIZADAS (0–1) o en PIXELES, y hay que
                distinguirlo: tratar unos píxeles como fracción pinta una caja diminuta
                en la esquina, y al contrario una que se sale de la pantalla. Lo dice
                `bboxFormat` de cada detección.

                `pointer-events-none`: las cajas no deben robarle el clic a los
                controles del reproductor que quedan debajo.
              */}
              {/*
                Va DENTRO del marco a propósito: en pantalla completa el marco es lo único
                que se ve, así que un botón de fuera sería inalcanzable para salir.
              */}
              <button
                type="button"
                onClick={aPantallaCompleta}
                className="absolute right-2 top-2 z-10 rounded-[var(--radius-sm)] px-2 py-1 text-[length:11px] [background:color-mix(in_oklab,black_60%,transparent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                title="Pantalla completa, con las cajas encima"
              >
                <Maximize2 strokeWidth={1.5} className="inline size-3.5" />
              </button>

              {cajas.length > 0 && (
                /*
                  ── LA CAPA SE AJUSTA A LA IMAGEN, NO AL MARCO ────────────────────

                  Las cajas van en porcentaje, así que se posicionan sobre lo que ocupe esta
                  capa. Si la capa cubre el marco entero y el vídeo no lo llena —franjas
                  negras—, las cajas se dibujan sobre el negro: aparecen desplazadas y
                  estiradas. Pasó con `aspect-video`, y volvía a pasar en pantalla completa,
                  donde el navegador impone su tamaño al marco y un vídeo vertical deja dos
                  franjas enormes.

                  `absolute inset-0` + `margin:auto` + `aspect-ratio` del medio + los dos
                  máximos al 100 % reproduce EXACTAMENTE lo que hace `object-contain`: la
                  capa queda encima de la imagen pintada, del tamaño de la imagen pintada,
                  la llene o no. Sin medir nada ni escuchar cambios de tamaño.
                */
                <div
                  className="pointer-events-none absolute inset-0 m-auto"
                  style={{
                    aspectRatio:
                      job.media.width && job.media.height
                        ? `${job.media.width} / ${job.media.height}`
                        : undefined,
                    maxWidth: '100%',
                    maxHeight: '100%',
                  }}
                >
                  {cajas.map((d) => {
                    const enPixeles = d.bbox.format === 'pixels';
                    const ancho = job.media.width || 1;
                    const alto = job.media.height || 1;
                    const x = enPixeles ? d.bbox.x / ancho : d.bbox.x;
                    const y = enPixeles ? d.bbox.y / alto : d.bbox.y;
                    const w = enPixeles ? d.bbox.width / ancho : d.bbox.width;
                    const h = enPixeles ? d.bbox.height / alto : d.bbox.height;
                    const color = d.classColor || 'var(--aqua-400)';
                    return (
                      <div
                        key={d.id}
                        className="absolute rounded-[2px] border-2"
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          width: `${w * 100}%`,
                          height: `${h * 100}%`,
                          borderColor: color,
                          boxShadow: `0 0 12px ${color}`,
                        }}
                      >
                        <span
                          className="absolute -top-5 left-0 whitespace-nowrap rounded-[2px] px-1 text-[length:10px] font-[var(--weight-medium)]"
                          style={{ background: color, color: '#04121a' }}
                        >
                          {d.className} {Math.round(d.confidence * 100)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/*
            ── DONDE ESTAN LAS DETECCIONES, DE UN VISTAZO ──────────────────────

            Sin esto el módulo parecía no detectar nada. Y detectaba: con muestreo a 2
            fotogramas por segundo las cajas solo se dibujan 250 ms a cada lado de cada
            instante analizado, así que tres detecciones en un vídeo de 11,5 s son 1,5
            segundos de caja visible. Reproduciendo, eso es un parpadeo que se pierde.

            La tentativa fácil —ensanchar la tolerancia— sería mentir: dibujaría una caja
            sobre fotogramas que el modelo no miró. Lo que faltaba no era pintar más, era
            DECIR DÓNDE. Cada marca salta a su instante y para el vídeo ahí.
          */}
          {job.media.type === 'video' &&
            detecciones.length > 0 &&
            (job.media.durationMs ?? 0) > 0 && (
              //  La MISMA anchura que el vídeo, no la del panel. Con un vídeo vertical el
              //  panel es tres veces más ancho que la imagen, y una regleta a lo ancho deja
              //  las marcas flotando a la derecha del vídeo, como si señalaran otra cosa.
              <div
                className="mx-auto flex w-full flex-col gap-1"
                style={{
                  maxWidth:
                    job.media.width && job.media.height
                      ? `calc(60vh * ${job.media.width} / ${job.media.height})`
                      : undefined,
                }}
              >
                <div className="relative h-7 w-full overflow-hidden rounded-[var(--radius-sm)] [background:var(--glass-1)]">
                  {/* Dónde está el vídeo ahora mismo. */}
                  {instanteMs != null && (
                    <div
                      className="absolute inset-y-0 w-px bg-[var(--text-faint)]"
                      style={{
                        left: `${Math.min(100, (instanteMs / (job.media.durationMs || 1)) * 100)}%`,
                      }}
                    />
                  )}
                  {detecciones.map((d) => {
                    if (d.timestampMs == null) return null;
                    const izquierda = Math.min(
                      99.4,
                      (d.timestampMs / (job.media.durationMs || 1)) * 100,
                    );
                    const color = d.classColor || 'var(--aqua-400)';
                    const elegida = seleccionada?.id === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onElegir(d)}
                        data-marca={d.timestampMs}
                        title={`${d.className} ${Math.round(d.confidence * 100)} % · segundo ${(d.timestampMs / 1000).toFixed(1)}`}
                        aria-label={`Ir a ${d.className} en el segundo ${(d.timestampMs / 1000).toFixed(1)}`}
                        className={cn(
                          'absolute inset-y-1 w-[6px] rounded-[2px] transition-all hover:inset-y-0',
                          elegida && 'inset-y-0 ring-1 ring-[var(--text-primary)]',
                        )}
                        style={{ left: `${izquierda}%`, background: color }}
                      />
                    );
                  })}
                </div>
                <p className="t-mono-xs text-[var(--text-faint)]">
                  Cada marca es una detección. Púlsala y el vídeo salta ahí y se para.
                </p>
              </div>
            )}

          {/*
            Y se DICE qué se está viendo. Sin esto, una caja que no aparece se lee como
            «el modelo no detectó nada» cuando puede ser que el vídeo esté en otro
            instante.
          */}
          {job.media.type === 'video' && detecciones.length > 0 && (
            <p className="t-mono-xs text-[var(--text-faint)]">
              {instanteMs == null
                ? `${detecciones.length} detección(es) en este vídeo. Pulsa una de la lista y el vídeo salta a su instante con la caja encima.`
                : cajas.length > 0
                  ? `Segundo ${(instanteMs / 1000).toFixed(1)} · ${cajas.length} detección(es) dibujadas.`
                  : `Segundo ${(instanteMs / 1000).toFixed(1)} · sin detecciones aquí. El modelo miró ${job.config.frameSamplingRate ?? 1} fotograma(s) por segundo, así que las cajas solo se dibujan sobre los instantes que analizó: los de la regleta.`}
            </p>
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
  /**
   * Que el borrado ya se lanzó.
   *
   * ── POR QUE UN `ref` Y NO `isPending` ─────────────────────────────────────
   *
   * `disabled={borrar.isPending}` ya estaba, y NO fue suficiente: pasó en producción.
   * Los logs de la API muestran dos DELETE de la misma inspección separados por un
   * segundo, el primero 200 y el segundo 404. `isPending` solo desactiva el botón
   * cuando React vuelve a pintar, y un doble clic cabe entero antes de eso.
   *
   * Un `ref` se actualiza en el mismo instante del clic, sin esperar a nadie. Es la
   * diferencia entre «no se puede pulsar otra vez» y «pulsar otra vez no hace nada».
   */
  const yaLanzado = useRef(false);

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
              disabled={borrar.isPending || yaLanzado.current}
              onClick={() => {
                // La guarda va ANTES de todo: dos clics seguidos entran los dos en este
                // manejador antes de que React repinte, y el segundo mandaba un DELETE
                // sobre algo ya borrado.
                if (yaLanzado.current) return;
                yaLanzado.current = true;
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
                  onError: (e) => {
                    /*
                      Un 404 aquí significa «ya no está», y eso es EXACTAMENTE lo que se
                      pedía. Pintarlo como error haría que alguien creyera que el borrado
                      falló cuando funcionó — y volvería a intentarlo.

                      Cualquier otro código sí es un fallo, y entonces se suelta la
                      guarda para poder reintentar: un 409 o un 500 no dejan la
                      inspección borrada.
                    */
                    if (e instanceof ApiError && e.status === 404) {
                      setResultado('La inspección ya no estaba: se había borrado.');
                      setTimeout(() => navigate('/perception'), 1500);
                      return;
                    }
                    yaLanzado.current = false;
                  },
                });
              }}
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
      {/*
        `!resultado` en la condición: un 404 se resuelve como «ya no estaba» y pone
        `resultado`. Sin esta guarda saldrían las dos cosas a la vez —«ya se había
        borrado» y «no se pudo borrar»— y una de las dos sería mentira.
      */}
      {borrar.isError && !resultado && (
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

  /*
    ── EL RITMO SE MIDE DESDE EL PRIMER FOTOGRAMA, NO DESDE `startedAt` ──────────

    El worker empieza por descargar el vídeo y cargar el modelo: unos veinte segundos en
    los que no analiza nada. Contando desde `startedAt`, esos veinte segundos entraban en
    la división y el ritmo salía mucho más lento de lo real, así que el tiempo restante
    empezaba altísimo y luego se desplomaba — medido: 29 s, 15 s, 4 s, 6 s, 3 s. Un número
    que baila así no informa: desgasta la confianza justo donde intentábamos ganarla.

    Se guarda cuándo se vio el PRIMER fotograma y se mide desde ahí. Un `ref` porque es
    memoria de esta pantalla y no algo que deba repintar: cambiarlo no debe provocar un
    render, y sobrevive a los refrescos del sondeo.
  */
  const primerAvance = useRef<{ t: number; frames: number } | null>(null);
  if (job.status !== 'running') {
    primerAvance.current = null;
  } else if (primerAvance.current === null && job.framesProcessed > 0) {
    primerAvance.current = { t: Date.now(), frames: job.framesProcessed };
  }

  //  Hacen falta unos cuantos fotogramas DESDE la referencia para que la división
  //  signifique algo. Con dos, el ritmo lo decide el azar del muestreo.
  const base = primerAvance.current;
  const avanzados = base ? job.framesProcessed - base.frames : 0;
  const segundos = base ? (Date.now() - base.t) / 1000 : 0;
  const ritmo = base && avanzados >= 4 && segundos > 1 ? avanzados / segundos : null;

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

  const n = narrar(job, ritmo);

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
function narrar(
  job: PerceptionJob,
  /** Fotogramas por segundo REALES, medidos sobre la fase de análisis. `null` si aún no
   *  hay base suficiente: entonces no se promete ningún tiempo, que es mejor que prometer
   *  uno que va a cambiar en el próximo refresco. */
  ritmo: number | null = null,
): {
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

    case 'running': {
      /*
        ── DOS FASES, PORQUE SE PARECEN Y NO SON LO MISMO ────────────────────────

        Antes esto decía «Analizando el material» desde el primer segundo. Pero el worker
        empieza por descargar el vídeo y cargar el modelo —medido: unos 15 segundos para
        2,7 MB y RF-DETR en CPU— y durante ese rato el contador de fotogramas está en
        cero. Quien miraba leía «analizando» junto a un «0 de 58» que no se movía, y la
        conclusión natural era que estaba colgado.

        Son dos fases distintas y ahora se llaman distinto. El «0 de N» deja de ser un
        síntoma preocupante y pasa a ser lo que corresponde a la fase en la que está.
      */
      const hechos = job.framesProcessed;
      const total = job.framesTotal ?? 0;
      const porcentaje = total > 0 ? Math.round((hechos / total) * 100) : null;

      //  Lo que queda, redondeado a cinco segundos: la precisión al segundo es falsa
      //  —el ritmo varía entre fotogramas— y además hace que el número parpadee en cada
      //  refresco. «Menos de 5 s» dice lo mismo sin fingir exactitud.
      const restantes = ritmo && total > hechos ? (total - hechos) / ritmo : null;
      const quedan = restantes == null ? null : Math.max(5, Math.round(restantes / 5) * 5);

      if (hechos === 0) {
        return {
          pasa: 'Preparando el análisis: descargando el material y cargando el modelo.',
          falta:
            'Nada por tu parte. Los fotogramas empiezan a contarse en cuanto el modelo esté cargado — suele tardar unos segundos, más si el vídeo es grande.',
          desde: desdeCorre,
          color: 'var(--aqua-400)',
          latiendo: true,
          accion: null,
        };
      }

      return {
        pasa:
          `Analizando: ${hechos} de ${total} fotogramas` +
          (porcentaje != null ? ` (${porcentaje} %)` : '') +
          (quedan != null
            ? ` · ${quedan >= 60 ? `quedan unos ${Math.round(quedan / 60)} min` : `quedan unos ${quedan} s`}`
            : '') +
          '.',
        falta:
          'Nada por tu parte. Las detecciones van apareciendo abajo según se encuentran; si el número de fotogramas no se mueve durante minutos, el worker se colgó y conviene cancelar y reintentar.',
        desde: desdeCorre,
        color: 'var(--aqua-400)',
        latiendo: true,
        accion: null,
      };
    }

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
  const navigate = useNavigate();
  const resolver = useResolverHueco();
  const [buscando, setBuscando] = useState(false);
  const [noEsta, setNoEsta] = useState<string | null>(null);

  const codigo = detection.textValue;
  const ubica = esUbicacionCompleta(codigo);

  /*
    ── DEL CODIGO LEIDO AL MAPA ────────────────────────────────────────────────

    El explorador espacial ya acepta enlace directo por identificadores
    —`?view=rack&rack=…&location=…`— y su alzado dibuja la rejilla cuerpo x nivel x
    posicion. Lo unico que faltaba era el puente: traducir el codigo del QR al hueco del
    catalogo.

    La traduccion se hace AL PULSAR y no al pintar la lista: son 65 detecciones por
    inspeccion y resolver todas por adelantado serian 65 consultas para los dos codigos que
    alguien va a mirar.
  */
  const irAlMapa = async () => {
    if (!codigo) return;
    setBuscando(true);
    setNoEsta(null);
    try {
      const hueco = await resolver(codigo);
      if (!hueco) {
        //  Se dice el codigo que no aparece. «No se encontro» sin decir QUE no se encontro
        //  obliga a quien lee a adivinar si el fallo es del catalogo o de la lectura.
        setNoEsta(codigo);
        return;
      }
      //  Igual que desde la reconciliacion: se viene de una deteccion, y lo util es ver
      //  el alzado pintado por lo observado, no por el estado del catalogo.
      const p = new URLSearchParams({
        view: 'rack',
        location: hueco.locationId,
        layer: 'inspection',
      });
      if (hueco.rackId) p.set('rack', hueco.rackId);
      navigate(`/spatial?${p.toString()}`);
    } catch {
      setNoEsta(codigo);
    } finally {
      setBuscando(false);
    }
  };

  return (
    <dl className="flex flex-col gap-2.5">
      <Row label="Clase" value={detection.className} color={detection.classColor} />
      <Row label="Confianza" value={`${(detection.confidence * 100).toFixed(1)}%`} />
      {codigo && <Row label="Código leído" value={codigo} />}
      <Row label="Frame" value={String(detection.frameNumber)} />
      <Row label="BBox" value={`${detection.bbox.x}, ${detection.bbox.y}, ${detection.bbox.width}×${detection.bbox.height} ${detection.bbox.format}`} />
      <Row label="Estado" value={detection.reviewStatus} />

      {ubica && (
        <div className="mt-1 flex flex-col gap-1.5">
          <Button variant="secondary" size="sm" onClick={irAlMapa} disabled={buscando}>
            <MapPin strokeWidth={1.5} className="size-3.5" />
            {buscando ? 'Buscando el hueco…' : 'Ver en el mapa'}
          </Button>
          <p className="t-mono-xs text-[var(--text-faint)]">
            Abre el alzado del rack con esta celda seleccionada.
          </p>
        </div>
      )}

      {noEsta && (
        <p className="t-mono-xs max-w-[46ch] text-[var(--text-warn)]">
          El catálogo no tiene ningún hueco con el código <strong>{noEsta}</strong>. La
          lectura es buena; lo que falta es la ubicación en el catálogo — o el código de la
          etiqueta no corresponde a este almacén.
        </p>
      )}

      {codigo && !ubica && (
        <p className="t-mono-xs max-w-[46ch] text-[var(--text-faint)]">
          Ese código no identifica un hueco: le faltan el nivel y la posición. `RCL51-C020`
          es un cuerpo de estantería, y en el WMS el nivel lo elige el operador a mano.
        </p>
      )}
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


/**
 * POR QUE ESTE ANALISIS LEYO LO QUE LEYO.
 *
 * ── DE DONDE SALE ─────────────────────────────────────────────────────────────
 *
 * De un trabajo que devolvio 545 detecciones y ni un solo codigo de pallet. La pantalla
 * decia «completado» y ya, asi que para entender por que hubo que bajar el video,
 * medirlo, sacar recortes y cruzar 703 etiquetas contra su tasa de lectura.
 *
 * Todo lo que hizo falta para ese diagnostico estaba en la base en cuanto el analisis
 * termino. Lo unico que faltaba era decirlo, y decirlo ARRIBA: un aviso debajo de la
 * lista de detecciones lo lee quien ya ha entendido el problema.
 *
 * ── EL MATERIAL QUE VA BIEN NO RECIBE NINGUN AVISO ────────────────────────────
 *
 * `bien` no pinta nada, y no es un olvido: un aviso sobre lo que funciona entrena a
 * ignorar los avisos, y entonces el que importa tampoco se lee.
 */
function AvisoDeLectura({ jobId, status }: { jobId: string; status: string }) {
  const d = useReadingDiagnosis(jobId, status);
  const dato = d.data;
  if (!dato || dato.veredicto === 'bien' || dato.veredicto === 'sin_etiquetas') return null;

  //  `ilegible` es lo unico que pide una decision —repetir la grabacion—, asi que es lo
  //  unico que se pinta como aviso. Lo demas informa.
  const grave = dato.veredicto === 'ilegible';
  const color = grave ? 'var(--state-alert)' : 'var(--text-faint)';
  return (
    <div
      className="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2"
      style={{ background: `color-mix(in oklab, ${color} 6%, transparent)` }}
    >
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <div className="flex flex-col gap-0.5">
        <p className="t-small font-medium">
          {grave
            ? 'Este material no sirve para identificar pallets'
            : 'Sobre la lectura de codigos'}
        </p>
        <p className="t-small text-[var(--text-muted)]">{dato.mensaje}</p>
        {dato.anchoMedianoPx !== null && (
          <p className="t-small text-[var(--text-faint)]">
            {dato.leidas} de {dato.etiquetas} etiquetas leidas · {dato.anchoMedianoPx} px de ancho
            {dato.acercarse ? ` · harian falta ${dato.acercarse}x mas cerca` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
