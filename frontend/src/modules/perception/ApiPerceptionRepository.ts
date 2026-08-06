/**
 * PERCEPCIÓN CONTRA LA API REAL — sustituye a `DevPerceptionRepository`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ERA FALSO Y AHORA NO
 *
 * El repositorio anterior servía `DEV_JOBS`, `DEV_DETECTIONS`, `DEV_MODELS` y
 * `DEV_DATASETS`: cuatro constantes escritas a mano que la pantalla presentaba como
 * inspecciones del almacén. Un operador veía trabajos que nadie había lanzado, con
 * detecciones que ningún modelo había producido, y con un historial de estados que
 * el propio navegador acababa de inventar al montar el componente.
 *
 * Ahora todo sale de `/v1/perception/*` (migración 0069) y las cuatro constantes se
 * han borrado del árbol. Lo que no existe se dice; no se rellena.
 *
 * ── LOS BYTES NO VIAJAN, Y ESO SE CUENTA ────────────────────────────────────
 *
 * No hay subida de archivos todavía. Al crear un trabajo se manda el `sha256` y los
 * metadatos —tamaño, dimensiones, duración—, no el contenido. Consecuencias, las tres
 * ciertas a la vez:
 *
 *   · el vídeo SE VE en la pestaña donde se eligió, con su `URL.createObjectURL`
 *   · nadie más lo ve, y al recargar deja de verse
 *   · `stored` es `false`, y la pantalla lo dice en lugar de prometerlo
 *
 * El `sha256` se calcula en el navegador con `crypto.subtle`, leyendo el archivo
 * entero en memoria. Para 500 MB —el tope del formulario— eso es medio giga de RAM
 * durante un segundo; es aceptable para un archivo que el usuario acaba de elegir, y
 * es el precio de que registrar el mismo vuelo dos veces no cree dos medios.
 *
 * ── SIN WORKER: LA COLA NO AVANZA ───────────────────────────────────────────
 *
 * `getModels()` devuelve `workerAvailable: false` con su motivo. Un trabajo se puede
 * crear y encolar, y ahí se queda. La alternativa —moverlo a `running` y animar una
 * barra— sería una pantalla que finge trabajar, que es peor que una que dice que no
 * puede.
 */

import type { ApiClient } from '../../lib/apiClient';
import type {
  ClassCountDto,
  DetectionDto,
  DetectionPageDto,
  FrameDto,
  JobDto,
  JobListDto,
  ModelCatalogDto,
  PublishedModelDto,
  ReviewResultDto,
} from './dto';
import type { PerceptionRepository } from './repository';
import type {
  CreateJobInput,
  Detection,
  DetectionFilter,
  DetectionState,
  FrameAnnotation,
  MediaMime,
  ModelCatalog,
  ModelSummary,
  PaginatedDetections,
  PerceptionJob,
  PipelineType,
  ProcessingStatus,
  ReviewDecision,
  ReviewStatus,
} from './types';

/** SIN `/v1`: lo lleva ya `ApiClient.baseUrl`. Misma convención que el resto. */
const BASE = '/perception';

/**
 * Color por defecto de una clase sin color declarado.
 *
 * Gris y no un color vivo: una clase sin color no es «gris», es que nadie le asignó
 * uno, y dar un color llamativo haría creer que significa algo.
 */
const COLOR_CLASE_SIN_COLOR = '#94a3b8';

/**
 * Qué pipelines admite un modelo según su `task`.
 *
 * Se deduce aquí y no viene del backend porque «pipeline» es una noción de ESTA
 * pantalla —qué hace el worker— mientras que `task` es una propiedad del modelo. Un
 * modelo de detección sirve para detectar y para detectar+leer; uno de OCR, para leer.
 */
export function pipelinesDe(task: string): PipelineType[] {
  const t = task.toLowerCase();
  if (t.includes('ocr') || t.includes('text')) return ['ocr', 'detection-ocr'];
  if (t.includes('detect') || t.includes('segment') || t.includes('count')) {
    return ['object-detection', 'detection-ocr'];
  }
  // Un modelo cuya tarea no reconocemos NO se declara compatible con nada. Suponer
  // que sirve para todo pondría en el desplegable un modelo que va a fallar al correr.
  return [];
}

export function aModelo(d: PublishedModelDto): ModelSummary {
  return {
    modelVersionId: d.model_version_id,
    modelId: d.model_id,
    name: d.name,
    architecture: d.architecture_name ?? d.architecture_code ?? 'sin arquitectura',
    task: d.task,
    version: `v${d.version}`,
    publishedAt: d.published_at,
    classes: (d.classes ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color ?? COLOR_CLASE_SIN_COLOR,
    })),
    supportedPipelines: pipelinesDe(d.task),
  };
}

export function aDeteccion(d: DetectionDto): Detection {
  return {
    id: d.id,
    jobId: d.job_id,
    observedAt: d.observed_at,
    textValue: d.text_value,
    state: d.state as DetectionState,
    rackNodeId: d.rack_node_id,
    isManual: d.is_manual,
    classId: d.ai_class_id ?? d.class_name,
    className: d.class_name,
    classColor: d.class_color ?? COLOR_CLASE_SIN_COLOR,
    confidence: d.confidence,
    bbox: {
      x: d.bbox_x,
      y: d.bbox_y,
      width: d.bbox_width,
      height: d.bbox_height,
      format: d.bbox_format === 'pixels' ? 'pixels' : 'normalized',
    },
    frameNumber: d.frame_number,
    timestampMs: d.frame_ms,
    // No hay miniaturas: no hay almacenamiento de fotogramas. `null` y no una ruta
    // inventada, que produciría una imagen rota por detección.
    thumbnailUrl: null,
    reviewStatus: d.review_status as ReviewStatus,
  };
}

function aRecuento(c: ClassCountDto) {
  return {
    className: c.class_name,
    count: c.n,
    averageConfidence: c.confianza_media,
    matched: c.casadas,
  };
}

/**
 * DTO → trabajo del módulo.
 *
 * `urlLocal` es la object URL de ESTA pestaña, si la hay. El backend no puede
 * saberla: la conoce solo el navegador que eligió el archivo, y se pasa aparte
 * precisamente para no fingir que viene del servidor.
 */
export function aTrabajo(d: JobDto, urlLocal?: string | null): PerceptionJob {
  return {
    id: d.id,
    name: d.name,
    status: d.status as ProcessingStatus,
    statusHistory: (d.events ?? []).map((e) => ({
      // La primera transición no tiene origen: el trabajo nace. Se representa como
      // `draft → draft` para que el tipo no necesite un `from` nulo y la línea de
      // progreso no tenga que tratar un caso especial.
      from: (e.from_status ?? e.to_status) as ProcessingStatus,
      to: e.to_status as ProcessingStatus,
      occurredAt: e.occurred_at,
      ...(e.reason ? { reason: e.reason } : {}),
    })),
    source: d.media_source === 'demo' ? 'demo' : 'uploaded-file',
    media: {
      id: d.media_id,
      name: d.media_filename,
      type: d.media_kind === 'video' ? 'video' : 'image',
      mime: d.media_content_type as MediaMime,
      url: urlLocal ?? null,
      stored: d.media_available,
      bytes: d.media_bytes,
      sha256: d.media_sha256,
      width: d.media_width,
      height: d.media_height,
      durationMs: d.media_duration_ms,
      totalFrames: d.media_total_frames,
    },
    processingAvailable: d.worker_available,
    mediaAvailable: Boolean(urlLocal) || d.media_available,
    warehouseId: d.warehouse_id,
    config: {
      pipeline: d.pipeline as PipelineType,
      modelVersionId: d.model_version_id,
      confidenceThreshold: d.confidence_threshold,
      frameSamplingRate: d.frame_sampling_rate ?? 0,
      saveDetectedFrames: d.save_detected_frames,
      notes: d.notes ?? '',
    },
    modelLabel: d.model_label,
    framesProcessed: d.frames_processed,
    framesTotal: d.frames_total,
    elapsedMs: d.elapsed_ms,
    // No se estima lo que no se puede estimar. Sin worker no hay velocidad de
    // proceso medida, y un «faltan 3 minutos» calculado de la nada es una promesa.
    estimatedRemainingMs: null,
    detectionCount: d.detection_count,
    classCounts: (d.class_counts ?? []).map(aRecuento),
    createdAt: d.created_at,
    queuedAt: d.queued_at,
    startedAt: d.started_at,
    completedAt: d.completed_at,
    errorMessage: d.error_message,
  };
}

export class ApiPerceptionRepository implements PerceptionRepository {
  /**
   * Object URLs de los medios elegidos en ESTA pestaña, por id de medio.
   *
   * Vive en el repositorio y no en el componente porque sobrevive a la navegación:
   * se crea un trabajo, se navega a su detalle, y el vídeo sigue reproduciéndose.
   * Se pierde al recargar, que es exactamente lo que significa «los bytes no se
   * subieron».
   */
  private readonly urlesLocales = new Map<string, string>();

  constructor(private readonly api: ApiClient) {}

  /**
   * Los almacenes a los que llega este usuario, para poder elegir a cual pertenece
   * la inspeccion.
   *
   * Va contra el endpoint de core y no contra el modulo espacial: percepcion no
   * depende de que exista un catalogo de racks —se puede inspeccionar un almacen sin
   * plano—, asi que atarla al listado del explorador la haria depender de otro modulo
   * para algo que solo necesita el nombre.
   */
  async listWarehouses(): Promise<{ id: string; code: string; name: string }[]> {
    const d = await this.api.get<{ id: string; code: string; name: string }[]>(
      '/warehouses',
      { limit: 100 },
    );
    return (d ?? []).map((w) => ({ id: w.id, code: w.code, name: w.name }));
  }

  async getModels(): Promise<ModelCatalog> {
    const d = await this.api.get<ModelCatalogDto>(`${BASE}/models`);
    return {
      models: (d.models ?? []).map(aModelo),
      workerAvailable: d.worker_available,
      unavailableReason: d.unavailable_reason,
    };
  }

  /**
   * Crea la inspección SUBIENDO LOS BYTES.
   *
   * ── LO QUE ESTO ARREGLA ───────────────────────────────────────────────
   *
   * Hasta la migración 0076 este método mandaba solo metadatos —nombre, tipo,
   * tamaño, hash, dimensiones— y los bytes se quedaban en la pestaña. Se perdían al
   * cerrarla. El trabajo quedaba en cola con un vídeo que no existía en ningún
   * sitio, y cuando existiera un worker no habría tenido nada que descargar.
   *
   * Tres pasos, y el del medio va PRIMERO a propósito: si la subida falla —red de
   * almacén, 400 MB— no se ha creado ningún trabajo huérfano que alguien tenga que
   * limpiar después.
   *
   *   1. `prepare` reserva la ruta en el bucket y devuelve dónde subir
   *   2. el binario va DIRECTO a Storage, con el token del propio usuario
   *   3. `POST /jobs` con el `media_id`, y el servidor comprueba que el objeto está
   *
   * El binario no atraviesa el backend: 400 MB por el proceso web solo para
   * reenviarlos gastarían memoria del servidor sin añadir nada.
   */
  async createJob(input: CreateJobInput): Promise<PerceptionJob> {
    const esVideo = input.file.type.startsWith('video');
    const medidas = await medirArchivo(input.file, esVideo);
    const sha256 = await hashDe(input.file);

    // 1 · Reservar sitio. La ruta la genera el servidor: no se manda ni se propone.
    const reserva = await this.api.post<{
      media_id: string;
      bucket: string;
      object_path: string;
      upload_url: string;
    }>(`${BASE}/media/prepare`, {
      warehouse_id: input.warehouseId,
      original_filename: input.file.name,
      content_type: input.file.type,
      bytes: input.file.size,
    });

    // 2 · Los bytes, directos a Storage.
    await this.api.subirBinario(reserva.upload_url, input.file);

    const d = await this.api.post<JobDto>(`${BASE}/jobs`, {
      warehouse_id: input.warehouseId,
      name: input.name,
      pipeline: input.config.pipeline,
      // `null` explícito y no omitido: el backend distingue «sin modelo» de «no
      // mandado», y hoy lo normal es sin modelo porque no hay ninguno publicado.
      model_version_id: input.config.modelVersionId ?? null,
      confidence_threshold: input.config.confidenceThreshold,
      // La frecuencia de muestreo solo se manda en vídeo: en una imagen no significa
      // nada y el backend la rechazaría por incoherente.
      frame_sampling_rate: esVideo ? input.config.frameSamplingRate : null,
      save_detected_frames: input.config.saveDetectedFrames,
      notes: input.config.notes || null,
      media: {
        kind: esVideo ? 'video' : 'image',
        original_filename: input.file.name,
        content_type: input.file.type,
        bytes: input.file.size,
        sha256,
        width: medidas.width,
        height: medidas.height,
        duration_ms: medidas.durationMs,
        total_frames: medidas.totalFrames,
        source: input.source,
        //  Con esto el servidor recalcula la ruta y COMPRUEBA que el objeto esté.
        //  Sin él, un trabajo con la subida cortada a medias llegaría a la cola y el
        //  worker fallaría al descargar, sin que nadie supiera por qué.
        media_id: reserva.media_id,
      },
    });

    // La object URL se asocia al MEDIO que devolvió el servidor: si el mismo archivo
    // ya estaba registrado, el id es el de antes y la reproducción sigue funcionando.
    const url = URL.createObjectURL(input.file);
    const anterior = this.urlesLocales.get(d.media_id);
    if (anterior) URL.revokeObjectURL(anterior);
    this.urlesLocales.set(d.media_id, url);

    return aTrabajo(d, url);
  }

  async getJob(jobId: string): Promise<PerceptionJob | null> {
    const d = await this.api.get<JobDto>(`${BASE}/jobs/${jobId}`);
    return aTrabajo(d, this.urlesLocales.get(d.media_id) ?? null);
  }

  async listJobs(): Promise<PerceptionJob[]> {
    const d = await this.api.get<JobListDto>(`${BASE}/jobs`, { limit: 100 });
    return (d.jobs ?? []).map((j) => aTrabajo(j, this.urlesLocales.get(j.media_id) ?? null));
  }

  /** Encolar, cancelar o reintentar. La transición la valida la base. */
  async changeStatus(
    jobId: string,
    to: ProcessingStatus,
    reason?: string,
  ): Promise<PerceptionJob> {
    const d = await this.api.post<JobDto>(`${BASE}/jobs/${jobId}/status`, {
      to_status: to,
      ...(reason ? { reason } : {}),
    });
    return aTrabajo(d, this.urlesLocales.get(d.media_id) ?? null);
  }

  async getDetections(filter: DetectionFilter): Promise<PaginatedDetections> {
    const d = await this.api.get<DetectionPageDto>(`${BASE}/jobs/${filter.jobId}/detections`, {
      ...(filter.classId ? { class_name: filter.classId } : {}),
      ...(filter.minConfidence !== undefined ? { min_confidence: filter.minConfidence } : {}),
      ...(filter.reviewStatus ? { review_status: filter.reviewStatus } : {}),
      ...(filter.frameStart !== undefined ? { frame_start: filter.frameStart } : {}),
      ...(filter.frameEnd !== undefined ? { frame_end: filter.frameEnd } : {}),
      page: filter.page ?? 1,
      page_size: filter.pageSize ?? 50,
    });
    return {
      items: (d.items ?? []).map(aDeteccion),
      total: d.total,
      page: d.page,
      pageSize: d.page_size,
    };
  }

  async getFrameAnnotations(jobId: string, frameNumber: number): Promise<FrameAnnotation | null> {
    const d = await this.api.get<FrameDto>(`${BASE}/jobs/${jobId}/frames/${frameNumber}`);
    return {
      frameNumber: d.frame_number,
      timestampMs: d.frame_ms ?? 0,
      detections: (d.detections ?? []).map(aDeteccion),
      // El fotograma en sí no se guarda; lo que hay es una referencia. `null` en lugar
      // de una ruta que no se puede abrir.
      imageUrl: null,
    };
  }

  async submitReview(jobId: string, decisions: ReviewDecision[]): Promise<void> {
    const r = await this.api.post<ReviewResultDto>(`${BASE}/jobs/${jobId}/reviews`, {
      decisions: decisions.map((d) => ({
        detection_id: d.detectionId,
        observed_at: d.observedAt,
        status: d.status === 'pending' ? 'accepted' : d.status,
        is_false_positive: d.isFalsePositive,
        ...(d.comment ? { comment: d.comment } : {}),
      })),
    });
    // Si el servidor no encontró alguna, se levanta: aplicar 38 de 40 en silencio
    // hace creer a quien revisó que revisó las 40.
    if (r.not_found.length > 0) {
      throw new Error(
        `${r.applied} de ${decisions.length} revisiones aplicadas. No se encontraron: ` +
          r.not_found.slice(0, 5).join(', ') +
          (r.not_found.length > 5 ? '…' : ''),
      );
    }
  }
}

// ── Auxiliares del navegador ──────────────────────────────────────────────────

/**
 * SHA-256 del archivo, con la API del propio navegador.
 *
 * `crypto.subtle` solo existe en contextos seguros: HTTPS o localhost. Si faltara, se
 * lanza en lugar de inventar un hash —un hash falso rompería la idempotencia sin que
 * nada avisara, y el mismo vídeo se registraría cada vez como nuevo—.
 */
async function hashDe(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Este navegador no expone crypto.subtle (hace falta HTTPS o localhost). ' +
        'Sin hash no se puede registrar el medio sin duplicarlo.',
    );
  }
  const buf = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Dimensiones y duración, leídas del propio archivo.
 *
 * Se miden y no se suponen: el repositorio anterior escribía 1920×1080 y 900
 * fotogramas para CUALQUIER archivo, así que un vídeo vertical de móvil se
 * registraba como horizontal y la barra de progreso contaba fotogramas que no
 * existían.
 *
 * `totalFrames` NO se calcula: el navegador no lo expone y deducirlo de la duración
 * exige saber los fps reales del archivo, que tampoco expone. Se deja `null`, y el
 * backend calcula cuántos se van a analizar con la frecuencia de muestreo.
 */
async function medirArchivo(
  file: File,
  esVideo: boolean,
): Promise<{
  width: number | null;
  height: number | null;
  durationMs: number | null;
  totalFrames: number | null;
}> {
  const url = URL.createObjectURL(file);
  try {
    if (esVideo) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error('no se pudo leer los metadatos del video'));
      });
      const dur = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null;
      return {
        width: v.videoWidth || null,
        height: v.videoHeight || null,
        durationMs: dur && dur > 0 ? dur : null,
        totalFrames: null,
      };
    }
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('no se pudo leer las dimensiones de la imagen'));
    });
    return {
      width: img.naturalWidth || null,
      height: img.naturalHeight || null,
      durationMs: null,
      totalFrames: null,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
