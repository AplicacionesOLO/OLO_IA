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

import { ApiError } from '../../lib/apiErrors';
import type { ApiClient } from '../../lib/apiClient';
import type {
  ReconcileIncidentsDto,
  ClassCountDto,
  DetectionDto,
  DetectionPageDto,
  FrameDto,
  JobDto,
  JobListDto,
  ModelCatalogDto,
  PublishedModelDto,
  ReadingDiagnosisDto,
  ReconcileDto,
  ReviewResultDto,
} from './dto';
import type {
  CreateJobInput,
  Detection,
  DetectionFilter,
  DetectionState,
  FrameAnnotation,
  IncidentsFromScan,
  JobDeletable,
  JobDeleted,
  MediaMime,
  ModelCatalog,
  ModelSummary,
  PaginatedDetections,
  PerceptionJob,
  PipelineType,
  ProcessingStatus,
  ReadingDiagnosis,
  ReconcileResult,
  ReviewDecision,
  ReviewStatus,
} from './types';
import type { PerceptionRepository, ReconcileSource } from './repository';

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
    aiProjectId: d.ai_project_id ?? null,
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
      // Los TRES tipos, y no dos con un `else`. El mapeo anterior era
      // `=== 'video' ? 'video' : 'image'`, así que un directo caía en `image` y la
      // pantalla lo trataba como una foto: «1/1 fotogramas» y un botón de reproducir.
      type:
        d.media_kind === 'video'
          ? 'video'
          : d.media_kind === 'stream'
            ? 'stream'
            : 'image',
      mime: d.media_content_type as MediaMime,
      url: urlLocal ?? null,
      stored: d.media_available,
      bytes: d.media_bytes,
      sha256: d.media_sha256,
      width: d.media_width,
      height: d.media_height,
      durationMs: d.media_duration_ms,
      totalFrames: d.media_total_frames,
      streamUrl: d.media_stream_url ?? null,
      hasPreview: d.media_has_preview ?? false,
    },
    processingAvailable: d.worker_available,
    mediaAvailable: Boolean(urlLocal) || d.media_available,
    archivedAt: d.archived_at ?? null,
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
      //  Cero significa «el servidor no lo dijo», y quien lo usa cae a su propio tope.
      //  Poner aqui un valor por omision volveria a tener el numero en dos sitios.
      maxUploadBytes: d.max_upload_bytes ?? 0,
      acceptedTypes: d.accepted_types ?? [],
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
    const paso = input.onPaso ?? (() => {});

    paso('Leyendo el archivo…');
    const medidas = await medirArchivo(input.file, esVideo);

    //  La huella tiene que leer el archivo ENTERO: en un video de 148 MB son unos
    //  segundos con el resto de la pagina parada. Decirlo evita que se lea como colgada.
    paso('Calculando la huella…');
    const sha256 = await hashDe(input.file);

    // 1 · Reservar sitio. La ruta la genera el servidor: no se manda ni se propone.
    paso('Reservando sitio…');
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

    // 2 · Los bytes, directos a Storage. El paso largo: minutos con un video grande.
    paso(`Subiendo ${(input.file.size / 1e6).toFixed(0)} MB…`);
    await this.api.subirBinario(reserva.upload_url, input.file);

    paso('Registrando la inspeccion…');

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

  async listJobs(incluirArchivadas = false): Promise<PerceptionJob[]> {
    const d = await this.api.get<JobListDto>(`${BASE}/jobs`, {
      limit: 100,
      ...(incluirArchivadas ? { include_archived: true } : {}),
    });
    return (d.jobs ?? []).map((j) => aTrabajo(j, this.urlesLocales.get(j.media_id) ?? null));
  }

  /**
   * URL firmada para ver el material, del servidor.
   *
   * ── POR QUE NO SE CACHEA ──────────────────────────────────────────────────
   *
   * La firma caduca en una hora. Guardarla haría que una pestaña abierta toda la
   * mañana intentara reproducir con una firma muerta, y el `<video>` fallaría sin
   * decir por qué. Pedirla cada vez cuesta un viaje y siempre funciona.
   *
   * Un 409/422 significa «este medio no tiene bytes» —un directo, o una inspección
   * registrada solo con metadatos— y se traduce a `null`, que no es lo mismo que un
   * fallo: la pantalla tiene que decir «no hay nada que ver», no «algo se rompió».
   */
  /**
   * URL firmada de la COPIA ligera, la que el navegador si reproduce.
   *
   * Aparte de `getMediaUrl` a proposito: quien quiere recortar fotogramas para un
   * dataset necesita el ORIGINAL a resolucion nativa, y servirle 720p degradaria el
   * entrenamiento sin que nadie lo notara hasta mucho despues.
   */
  async getPreviewUrl(jobId: string): Promise<string | null> {
    const d = await this.api.get<{ url: string }>(`${BASE}/jobs/${jobId}/preview-url`);
    return d?.url ?? null;
  }

  async getMediaUrl(jobId: string): Promise<string | null> {
    try {
      const d = await this.api.get<{ url: string; expires_in: number }>(
        `${BASE}/jobs/${jobId}/media-url`,
      );
      return d.url ?? null;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) return null;
      throw e;
    }
  }

  /**
   * Por que este analisis leyo lo que leyo.
   *
   * Se pide aparte y no viene en el trabajo porque se calcula recorriendo sus
   * detecciones: meterlo en `getJob` cargaria esa cuenta en cada refresco de la lista.
   */
  async getReadingDiagnosis(jobId: string): Promise<ReadingDiagnosis> {
    const d = await this.api.get<ReadingDiagnosisDto>(`${BASE}/jobs/${jobId}/reading-diagnosis`);
    return {
      jobId: d.job_id,
      etiquetas: d.etiquetas,
      leidas: d.leidas,
      anchoMedianoPx: d.ancho_mediano_px,
      veredicto: d.veredicto as ReadingDiagnosis['veredicto'],
      mensaje: d.mensaje,
      acercarse: d.acercarse,
    };
  }

  async getDeletable(jobId: string): Promise<JobDeletable> {
    return this.api.get<JobDeletable>(`${BASE}/jobs/${jobId}/deletable`);
  }

  async archiveJob(jobId: string): Promise<void> {
    await this.api.post<void>(`${BASE}/jobs/${jobId}/archive`);
  }

  async unarchiveJob(jobId: string): Promise<void> {
    await this.api.post<void>(`${BASE}/jobs/${jobId}/unarchive`);
  }

  async deleteJob(jobId: string): Promise<JobDeleted> {
    /*
      `request` y no `api.delete`: ese atajo devuelve `void` y aqui el CUERPO es el dato
      que justifica la operacion —cuantos bytes se liberaron de verdad—.

      ── Y HAY QUE DESENVOLVER EL `{data}` A MANO ────────────────────────────────

      `api.get` y `api.post` lo hacen por dentro; `request` devuelve la respuesta CRUDA.
      Sin este `.data`, `storage_liberado` llegaba `undefined`, `undefined > 0` era
      falso, y la pantalla decia «se borro, pero el archivo sigue en Storage» sobre un
      borrado que habia funcionado — Storage habia respondido 200. Mentir en la
      direccion de «no se libero» es de lo peor que puede hacer esta pantalla: el
      motivo de borrar es hacer sitio.
    */
    const sobre = await this.api.request<{ data: JobDeleted }>(
      `${BASE}/jobs/${jobId}`,
      { method: 'DELETE' },
    );
    const d = sobre.data;
    // La object URL local se suelta: el archivo ya no existe y dejarla colgando
    // mantendría los bytes en memoria del navegador hasta recargar.
    for (const [mediaId, url] of this.urlesLocales) {
      if (url) {
        URL.revokeObjectURL(url);
        this.urlesLocales.delete(mediaId);
      }
    }
    return d;
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

  /**
   * TODAS las detecciones del trabajo, no la primera pagina.
   *
   * ── EL FALLO QUE ESTO ARREGLA, MEDIDO ─────────────────────────────────────
   *
   * La pantalla del trabajo pedia `getDetections` sin `pageSize`, o sea CINCUENTA. En
   * `dataset7` hay 224 y esas cincuenta llegaban hasta el ms 6.403 de un video de 14.741:
   * desde el segundo 6,4 el reproductor no dibujaba ni una caja. Y no era un fallo de la
   * capa ni del analisis —los 74 fotogramas estaban procesados— sino que las detecciones
   * del final nunca se pedian.
   *
   * Afectaba a cuatro sitios a la vez con la misma consulta: la capa sobre el video, la
   * regleta de la linea de tiempo, el modal de mandar fotogramas al dataset —que elegia
   * los instantes «interesantes» sin ver la mitad del video— y la lista, que decia «224
   * resultados» encima de cincuenta filas.
   *
   * ── POR QUE UN TOPE, Y POR QUE SE DICE ────────────────────────────────────
   *
   * Un video de cinco minutos a 5 fps con veinte detecciones por fotograma son 30.000
   * filas: traerlas todas para pintar cajas colgaria el navegador. El tope corta, y
   * `truncado` lo DICE — una capa que se apaga a mitad sin avisar es exactamente el fallo
   * que esto arregla, y repetirlo callando seria peor.
   */
  async getAllDetections(
    jobId: string,
    opts: { cap?: number; reviewStatus?: ReviewStatus | undefined } = {},
  ): Promise<PaginatedDetections & { truncated: boolean }> {
    //  500 es el maximo que admite el backend por pagina. Con el tope de 3.000 son seis
    //  idas y vueltas como mucho, que es lo que aguanta abrir una pantalla.
    const TAMANO = 500;
    const cap = opts.cap ?? 3000;
    const items: Detection[] = [];
    let page = 1;
    let total = 0;
    for (;;) {
      const d = await this.getDetections({
        jobId,
        ...(opts.reviewStatus ? { reviewStatus: opts.reviewStatus } : {}),
        page,
        pageSize: TAMANO,
      });
      items.push(...d.items);
      total = d.total;
      if (items.length >= total || items.length >= cap || d.items.length === 0) break;
      page += 1;
    }
    return { items, total, page: 1, pageSize: items.length, truncated: items.length < total };
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

  // ── Reconciliación contra el WMS ────────────────────────────────────────

  async reconcile(jobId: string, source: ReconcileSource = 'drone'): Promise<ReconcileResult> {
    const d = await this.api.post<ReconcileDto>(`${BASE}/jobs/${jobId}/reconcile`, {
      source,
    });
    return aReconciliacion(d);
  }

  async getReconciliation(scanId: string): Promise<ReconcileResult> {
    const d = await this.api.get<ReconcileDto>(`${BASE}/scans/${scanId}/reconciliation`);
    return aReconciliacion(d);
  }

  //  De hallazgo a trabajo. Solo las discrepancias: lo que no se pudo VER pide volver a
  //  grabar, no ir al pasillo, y mezclarlo llenaria la bandeja de problemas de camara
  //  disfrazados de problemas de inventario.
  async abrirIncidencias(scanId: string): Promise<IncidentsFromScan> {
    const d = await this.api.post<ReconcileIncidentsDto>(
      `${BASE}/scans/${scanId}/incidents`,
      {},
    );
    return {
      scanId: d.scan_id,
      created: d.created,
      skipped: d.skipped,
      skippedLocations: d.skipped_locations ?? [],
      incidentIds: d.incident_ids ?? [],
      actionableRows: d.actionable_rows,
      totalRows: d.total_rows,
    };
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
 * CUANTO SE ESPERA A QUE EL NAVEGADOR LEA UN ARCHIVO, Y POR QUE HAY UN LIMITE.
 *
 * Quince segundos son de sobra para leer una cabecera —es lectura de metadatos, no
 * decodificación— y son el límite entre «tarda» y «no va a pasar».
 */
const PLAZO_DE_MEDIDA_MS = 15_000;

/** Lo que se manda cuando no se pudo medir. Las cuatro son `null` en el contrato. */
const SIN_MEDIR = { width: null, height: null, durationMs: null, totalFrames: null } as const;

/**
 * `true` si la promesa terminó a tiempo, `false` si falló o se agotó el plazo.
 *
 * ── EL FALLO QUE ESTO ARREGLA ─────────────────────────────────────────────────
 *
 * `onloadedmetadata` / `onerror` cubren dos de los tres finales posibles. Falta el
 * tercero: que el navegador no sepa demuxear el contenedor y NO dispare ninguno de los
 * dos. Entonces la promesa no se resuelve nunca — y como medir es el primer paso de
 * crear una inspección, el botón se quedaba girando para siempre, sin error, sin una
 * sola petición de red. Reportado como «le di a crear inspección y no avanza», con un
 * vídeo de 8K de 148 MB.
 *
 * ── Y POR QUE NO MEDIR NO ES UN ERROR ─────────────────────────────────────────
 *
 * Porque lo que Chrome sepa leer no dice NADA sobre lo que se puede analizar: el worker
 * decodifica con su propia pila y lee formatos que el navegador ni abre. Las cuatro
 * medidas son opcionales en el contrato, así que cuando no se pueden tomar se mandan a
 * `null` y el análisis sigue. Bloquear la subida por no poder pintar una vista previa
 * sería dejar fuera justo el material que más falta hace: el de 8K.
 */
async function conPlazo(promesa: Promise<void>): Promise<boolean> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        reloj = setTimeout(() => reject(new Error('plazo agotado')), PLAZO_DE_MEDIDA_MS);
      }),
    ]);
    return true;
  } catch {
    //  Ni el fallo ni el plazo agotado paran nada: se sigue sin medidas.
    return false;
  } finally {
    if (reloj !== undefined) clearTimeout(reloj);
  }
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
      const ok = await conPlazo(
        new Promise<void>((resolve, reject) => {
          v.onloadedmetadata = () => resolve();
          v.onerror = () => reject(new Error('no se pudo leer los metadatos del video'));
        }),
      );
      if (!ok) return SIN_MEDIR;
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
    const ok = await conPlazo(
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('no se pudo leer las dimensiones de la imagen'));
      }),
    );
    if (!ok) return SIN_MEDIR;
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

/**
 * El DTO de reconciliación a su tipo de dominio.
 *
 * `snake_case` → `camelCase` como todo lo demás de este archivo. Y `cuantas` → `count`:
 * el backend lo devuelve en castellano porque es un alias de SQL, y el tipo de dominio
 * no tiene por qué heredar esa costura.
 */
function aReconciliacion(d: ReconcileDto): ReconcileResult {
  return {
    scanId: d.scan_id,
    wmsSnapshotId: d.wms_snapshot_id,
    warning: d.warning,
    detections: d.detections,
    readings: d.readings,
    emptyFrames: d.empty_frames,
    discardedTexts: d.discarded_texts ?? 0,
    unknownClasses: d.unknown_classes ?? [],
    unknownLocations: d.unknown_locations ?? [],
    summary: (d.summary ?? []).map((s) => ({ status: s.status, count: s.cuantas })),
    rows: (d.rows ?? []).map((r) => ({
      locationCode: r.location_code,
      locationQr: r.location_qr,
      content: r.content,
      palletQr: r.pallet_qr,
      palletCodeObserved: r.pallet_code_observed,
      expectedRows: r.expected_rows,
      expectedPallet: r.expected_pallet,
      expectedPallets: r.expected_pallets ?? [],
      wmsExpectsPallet: r.wms_expects_pallet,
      status: r.status,
      observedAt: r.observed_at,
    })),
  };
}
