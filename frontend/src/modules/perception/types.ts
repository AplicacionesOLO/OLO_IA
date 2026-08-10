/**
 * PERCEPTION MODULE TYPES
 *
 * Contratos del frontend para Computer Vision / Perception.
 * No acoplados a una version concreta de YOLO.
 */

// ── Media ───────────────────────────────────────────────────────────────────

/**
 * Qué se analiza. `stream` desde la migración 0078.
 *
 * Un directo no es un archivo, y confundirlos tiene consecuencias visibles: el
 * repositorio mapeaba `media_kind` con `=== 'video' ? 'video' : 'image'`, así que un
 * directo llegaba a la pantalla como IMAGEN. Se pintaba «1/1 fotogramas», se ofrecía
 * reproducirlo y no había forma de saber que era una cámara emitiendo.
 */
export type MediaType = 'image' | 'video' | 'stream';
export type MediaMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime' | 'video/x-msvideo';

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  mime: MediaMime;
  /**
   * De dónde lee el worker en un directo. `null` en archivos.
   *
   * Se enseña en pantalla porque es lo que un operador necesita para diagnosticar un
   * directo que no arranca: la URL dice si apunta al servidor de medios correcto.
   */
  streamUrl?: string | null;
  /**
   * URL para reproducir el medio. `null` cuando no hay ninguna.
   *
   * Antes era `string` obligatoria y siempre venia de `URL.createObjectURL`. Con el
   * backend real hay tres situaciones distintas y hacen falta las tres:
   *
   *   · el archivo se acaba de elegir en ESTA pestaña → hay object URL y se reproduce
   *   · el trabajo se lee de la API en otra sesion    → `null`, los bytes no se subieron
   *   · algun dia habra almacenamiento                → una URL firmada del bucket
   *
   * Forzarla a `string` obligaba a inventar una cadena vacia para el segundo caso, y
   * un reproductor apuntando a una cadena vacia falla delante de quien mira.
   */
  url: string | null;
  /**
   * Si los BYTES estan guardados en el servidor. Distinto de tener `url`.
   *
   * Hoy es siempre `false`: no existe la subida de archivos. Un video elegido en esta
   * pestaña se ve —tiene object URL— y aun asi `stored` es `false`, porque nadie mas
   * lo puede ver y no sobrevive a recargar la pagina. Confundir las dos cosas haria
   * que la pantalla prometiera un material que no esta.
   */
  stored: boolean;
  bytes: number;
  /** Hash del contenido. Es lo que hace idempotente registrar el mismo medio. */
  sha256: string;
  width: number | null;
  height: number | null;
  /** Duracion en ms (solo video). */
  durationMs: number | null;
  /** Frames totales (solo video). */
  totalFrames: number | null;
}

// ── Job ─────────────────────────────────────────────────────────────────────

export type ProcessingStatus =
  | 'draft'
  | 'uploading'
  | 'uploaded'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Pipeline de procesamiento. Determina QUE hace el worker, no solo QUE modelo usa. */
export type PipelineType = 'object-detection' | 'ocr' | 'detection-ocr';

export interface ProcessingPipeline {
  id: PipelineType;
  label: string;
  description: string;
  /** Modelos compatibles con este pipeline. */
  compatibleTasks: string[];
}

export interface ProcessingConfiguration {
  pipeline: PipelineType;
  /**
   * La VERSION del modelo, no el modelo.
   *
   * Se ejecuta una version publicada concreta: «el modelo de racks» no es ejecutable,
   * «racks v3» si. El backend lo rechaza si no esta publicada, porque un trabajo
   * apuntando a un modelo que nadie declaro utilizable no se podria correr y nadie
   * sabria por que.
   */
  modelVersionId: string | null;
  confidenceThreshold: number;
  /** Frames por segundo a analizar (solo video). */
  frameSamplingRate: number;
  /** Guardar frames donde se detecte algo. */
  saveDetectedFrames: boolean;
  /** Observaciones del operador. */
  notes: string;
}

/*
  `WorkerCapability` se ha quitado. Describia un worker con `status`, `gpuAvailable` y
  `currentLoad`, y nunca hubo ninguno: el unico valor que existia lo escribia a mano el
  repositorio de desarrollo. Cuando haya registro de workers, el tipo saldra de su
  contrato y no de una suposicion sobre que campos tendra.

  Mientras no lo hay, lo que la pantalla necesita saber es una sola cosa —si alguien
  puede procesar— y eso viaja en `ModelCatalog.workerAvailable` con su motivo.
*/

// ── Status history ──────────────────────────────────────────────────────────

export interface JobStatusTransition {
  from: ProcessingStatus;
  to: ProcessingStatus;
  occurredAt: string;
  reason?: string | undefined;
}

export type JobSource = 'uploaded-file' | 'demo';

export interface PerceptionJob {
  id: string;
  name: string;
  status: ProcessingStatus;
  /** Ordered chronologically. Every transition is recorded. */
  statusHistory: JobStatusTransition[];
  source: JobSource;
  media: MediaAsset;
  /**
   * Si hay algun worker capaz de procesar. Hoy `false` para todos los trabajos: no
   * hay ninguno registrado, y un trabajo en cola no va a avanzar solo.
   */
  processingAvailable: boolean;
  /** Si el medio se puede reproducir AHORA, o sea si hay `url`. */
  mediaAvailable: boolean;
  /**
   * Archivada: fuera de la lista, el rastro se queda. `null` si está activa.
   *
   * ⚠ Archivar **no libera Storage**. Es el precio de conservar lo que cuelga de ella
   * —incidencias, detecciones promovidas o revisadas—, y la pantalla lo dice para que
   * nadie archive creyendo que hace sitio.
   */
  archivedAt: string | null;
  warehouseId: string;
  config: ProcessingConfiguration;
  /**
   * Nombre y version del modelo COMO ESTABAN AL CORRER.
   *
   * Es una copia que guarda el trabajo, no un JOIN: el modelo se renombra, se archiva
   * o se despublica, y el trabajo tiene que seguir diciendo que corrio de verdad.
   * `null` cuando se creo sin modelo, que hoy es lo normal porque no hay ninguno
   * publicado.
   */
  modelLabel: string | null;
  // Progress
  framesProcessed: number;
  /**
   * Cuántos fotogramas se van a analizar, o `null` si no se sabe.
   *
   * `null` es un DIRECTO: no hay total porque el operario para cuando quiere. Es la
   * diferencia entre una barra de progreso con porcentaje y un contador que sube, y por
   * eso el tipo lo admite en vez de que el mapeo invente un 1.
   */
  framesTotal: number | null;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  // Results
  detectionCount: number;
  /** Cuantas detecciones por clase. Es el resumen del trabajo. */
  classCounts: {
    className: string;
    count: number;
    averageConfidence: number | null;
    matched: number;
  }[];
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// ── Detections ──────────────────────────────────────────────────────────────

export type BoundingBoxFormat = 'pixels' | 'normalized';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  format: BoundingBoxFormat;
}

export interface DetectionClass {
  id: string;
  name: string;
  color: string;
}

/**
 * Estado del ciclo de vida de una deteccion, tal como lo definio 0032:
 *
 *   unmatched   no casa con nada conocido   SIN CADUCIDAD mientras siga asi
 *   matched     caso y se promovio a observacion de rack
 *   discarded   falso positivo, ya revisado
 *   superseded  corregida por otra fila
 */
export type DetectionState = 'unmatched' | 'matched' | 'discarded' | 'superseded';

export interface Detection {
  id: string;
  jobId: string;
  /** Cuando se capto el fotograma. Es la clave de particion en la base. */
  observedAt: string;
  /** El texto LEIDO por OCR, si el pipeline lo incluye. */
  textValue: string | null;
  state: DetectionState;
  /** El rack al que se resolvio el texto, si se resolvio. */
  rackNodeId: string | null;
  /** Si la añadio una PERSONA: el falso negativo que el modelo no vio. */
  isManual: boolean;
  classId: string;
  className: string;
  classColor: string;
  confidence: number;
  bbox: BoundingBox;
  frameNumber: number;
  timestampMs: number | null;
  /** Thumbnail URL (solo para listado). */
  thumbnailUrl: string | null;
  reviewStatus: ReviewStatus;
}

// ── Frame annotations ───────────────────────────────────────────────────────

export interface FrameAnnotation {
  frameNumber: number;
  timestampMs: number;
  detections: Detection[];
  imageUrl: string | null;
}

// ── Review ──────────────────────────────────────────────────────────────────

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'corrected';

export interface ReviewDecision {
  detectionId: string;
  /** Hace falta: la clave de la tabla es `(observed_at, id)` por el particionado. */
  observedAt: string;
  status: ReviewStatus;
  /** Clase corregida (si se cambio). */
  correctedClassId: string | null;
  /** BBox corregido (si se ajusto). */
  correctedBbox: BoundingBox | null;
  /** Falso positivo. */
  isFalsePositive: boolean;
  /** Falso negativo (objeto no detectado, agregado manualmente). */
  isFalseNegative: boolean;
  comment: string | null;
}

/*
  `DatasetSummary` se ha quitado de este modulo. Los datasets viven en el esquema `ai`,
  que es de regimen PLATFORM OWNER: se midio que un usuario de tenant ve CERO filas de
  `ai.projects`. Un tipo aqui invitaba a escribir un metodo que devolveria siempre
  lista vacia, que es peor que no tenerlo porque parece informar.

  El taller de datasets y anotacion es otra pantalla, con su propia API, en
  `src/features/ai/`.
*/

// ── Model ───────────────────────────────────────────────────────────────────

export interface ModelSummary {
  /** Id de la VERSION publicada: es lo que se ejecuta. */
  modelVersionId: string;
  modelId: string;
  name: string;
  architecture: string;
  task: string;
  version: string;
  publishedAt: string | null;
  classes: DetectionClass[];
  /** Pipelines compatibles, deducidos de la `task` del modelo. */
  supportedPipelines: PipelineType[];
  /**
   * Proyecto de IA del modelo, para mandar fotogramas a su dataset.
   *
   * `null` si el catálogo no lo trae. La pantalla lo comprueba antes de ofrecer el
   * botón: mandar imágenes a un proyecto adivinado las metería en el dataset
   * equivocado, y eso ensucia un entrenamiento sin que nadie lo note.
   */
  aiProjectId: string | null;
}

/**
 * El catalogo, y si hay quien lo ejecute.
 *
 * Las dos cosas viajan juntas a proposito: elegir modelo sin saber si alguien lo va a
 * correr es la mitad de la informacion que hace falta para decidir si merece la pena
 * lanzar el analisis.
 */
export interface ModelCatalog {
  models: ModelSummary[];
  workerAvailable: boolean;
  unavailableReason: string | null;
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface DetectionFilter {
  jobId: string;
  classId?: string | undefined;
  minConfidence?: number | undefined;
  maxConfidence?: number | undefined;
  reviewStatus?: ReviewStatus | undefined;
  frameStart?: number | undefined;
  frameEnd?: number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface PaginatedDetections {
  items: Detection[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Job creation ────────────────────────────────────────────────────────────

export interface CreateJobInput {
  name: string;
  file: File;
  source: JobSource;
  /**
   * OBLIGATORIO. Antes era opcional y la pantalla no lo mandaba nunca.
   *
   * Una inspeccion es de un almacen: RLS lo exige y sin el la fila no se puede
   * escribir. Dejarlo opcional producia un formulario que se enviaba y fallaba en el
   * servidor por algo que la pantalla no habia pedido.
   */
  warehouseId: string;
  projectId?: string | undefined;
  zoneId?: string | undefined;
  config: ProcessingConfiguration;
}

// ── RECONCILIACIÓN CONTRA EL WMS ──────────────────────────────────────────
//
// Es la respuesta a la pregunta que un operador hace de verdad: ¿lo que hay en el hueco
// es lo que el WMS dice que hay? Sale de `inventory.v_reconciliation` (migración 0064),
// que compara las lecturas observadas contra el corte del WMS.
//
// Las detecciones dicen «vi un pallet»; esto dice «vi un pallet donde el WMS declara dos
// líneas», que es lo accionable.

/**
 * Cómo clasifica 0064 cada lectura. Es un vocabulario CERRADO de la base, y por eso
 * viaja como unión y no como `string`: si el backend añade un estado, el compilador
 * obliga a decidir cómo se pinta en vez de dejarlo sin color.
 */
export type ReconcileStatus =
  | 'verified_empty'
  | 'unexpected_empty'
  | 'unexpected_pallet'
  | 'pallet_match'
  | 'pallet_mismatch'
  | 'pallet_without_qr'
  | 'location_qr_unreadable'
  | 'obstructed'
  | 'not_scanned';

export interface ReconcileRow {
  /** `null` cuando el QR del hueco no se pudo leer: la lectura existe y no se sabe de dónde. */
  locationCode: string | null;
  locationQr: string;
  content: string;
  palletQr: string;
  palletCodeObserved: string | null;
  /** Cuántas líneas de stock declara el WMS en ese hueco. `null` si no hay corte. */
  expectedRows: number | null;
  expectedPallet: string | null;
  wmsExpectsPallet: boolean;
  status: ReconcileStatus;
  observedAt: string;
}

export interface ReconcileResult {
  scanId: string;
  /** `null` = no hay corte del WMS con el que comparar. Se dice en pantalla. */
  wmsSnapshotId: string | null;
  /** El aviso del backend, tal cual. Ver la nota de `warning` en el servicio. */
  warning: string | null;
  detections: number;
  readings: number;
  /** Fotogramas que no vieron ni hueco ni carga. No producen lectura. */
  emptyFrames: number;
  /** Clases que el modelo detectó y el puente no sabe interpretar. */
  unknownClasses: string[];
  summary: { status: ReconcileStatus; count: number }[];
  rows: ReconcileRow[];
}


/**
 * Si una inspección se puede borrar, y si no, qué lo impide.
 *
 * Los TRES recuentos y no solo el veredicto: «no se puede» a secas deja a quien lo
 * lee con la misma pregunta con la que llegó.
 */
export interface JobDeletable {
  borrable: boolean;
  archivada: boolean;
  /** Incidencias abiertas desde esta inspección. Alguien fue al pasillo por esto. */
  incidencias: number;
  /**
   * Detecciones convertidas en observaciones de rack. Las observaciones no guardan el
   * id del trabajo, así que borrarlo las dejaría afirmando venir de una inspección
   * que ya no existe.
   */
  promovidas: number;
  /** Detecciones aceptadas, rechazadas o corregidas por una persona. */
  revisadas: number;
}

/** Qué se liberó de verdad al borrar. */
export interface JobDeleted {
  /** Bytes que salieron de Storage. `0` si no se pudo o si el medio estaba compartido. */
  storage_liberado: number;
  /** El mismo archivo respaldaba otra inspección, así que sus bytes no se tocaron. */
  medio_compartido: boolean;
  /** Lo que ocupaba, incluso cuando no se liberó. */
  bytes_del_medio: number;
}
