/**
 * CONTRATO DEL MODULO DE IA
 *
 * Espeja `backend/src/olo/api/v1/ai_schemas.py`. Todo bajo `/v1/ai` exige ser
 * Platform Owner: si `MeProfile.is_platform_owner` es false, estos endpoints
 * responden 403 NOT_PLATFORM_OWNER y no hay permiso que un administrador de tenant
 * pueda conceder.
 */

export type AiTask =
  | 'detect'
  | 'segment'
  | 'classify'
  | 'ocr'
  | 'track'
  | 'pose'
  | 'count'
  | 'regress'
  | 'embed';

export type AiInputType =
  | 'image'
  | 'video'
  | 'frames'
  | 'point_cloud'
  | 'depth'
  | 'thermal'
  | 'fusion';

export type AiProjectStatus =
  | 'draft'
  | 'collecting'
  | 'annotating'
  | 'training'
  | 'published'
  | 'archived';

export type AiModelStatus = AiProjectStatus | 'deprecated';

/** Ciclo de vida de una version de modelo. La matriz de transiciones la impone la base. */
export type AiVersionStatus =
  | 'registered'
  | 'validating'
  | 'validated'
  | 'published'
  | 'deprecated'
  | 'archived'
  | 'failed';

/** Framework de entrenamiento. `adapter` es por donde despacha el worker. */
export interface Framework {
  code: string;
  display_name: string;
  adapter: string;
  is_active: boolean;
  notes: string | null;
}

/**
 * Capacidades de una arquitectura.
 *
 * ⚠ Es la configuracion RECOMENDADA VIGENTE, no un registro historico. Para saber
 * con que parametros se entreno una version se consulta su run, nunca esto. Si
 * muestras `hyperparam_schema` en una pantalla de detalle de version, estaras
 * mostrando datos que pueden no tener relacion con ese entrenamiento.
 *
 * `hyperparam_schema` vacio significa PENDIENTE de verificar: hoy solo yolo11* y
 * yolov8* lo traen relleno.
 */
export interface Architecture {
  code: string;
  framework_code: string;
  display_name: string;
  family: string;
  supported_tasks: AiTask[];
  supported_input_types: AiInputType[];
  supported_annotation_kinds: string[];
  requires_training: boolean;
  requires_annotations: boolean;
  weights_extension: string | null;
  default_hyperparams: Record<string, unknown>;
  hyperparam_schema: Record<string, unknown>;
  min_images_recommended: number | null;
  approx_weights_mb: number | null;
  is_active: boolean;
  notes: string | null;
}

export interface AiProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: AiProjectStatus;
  frame_interval_seconds: number;
  max_frames_per_video: number;
  max_video_duration_secs: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AiProjectCreate {
  name: string;
  slug: string;
  description?: string | null;
  frame_interval_seconds?: number;
  max_frames_per_video?: number;
  max_video_duration_secs?: number;
}

export type AiProjectUpdate = Partial<AiProjectCreate & { status: AiProjectStatus }>;

/**
 * Modelo logico. Varios por proyecto, sobre las MISMAS imagenes y clases.
 *
 * Los campos marcados `readonly` son DERIVADOS: el backend los resuelve por JOIN y
 * no se persisten en el modelo. Enviarlos en POST o PATCH produce
 * 400 VALIDATION_ERROR, porque el esquema usa `extra="forbid"`.
 */
export interface AiModel {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  purpose: string | null;
  architecture_code: string;
  task: AiTask;
  input_type: AiInputType;
  status: AiModelStatus;
  config: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;

  readonly requires_training: boolean;
  readonly framework_code: string | null;
  readonly framework_name: string | null;
  readonly framework_adapter: string | null;
  readonly architecture_name: string | null;
  readonly weights_extension: string | null;
  /** Se resuelve consultando la version con status='published'. No hay puntero persistido. */
  readonly published_version_id: string | null;
  readonly version_count: number | null;
}

export interface AiModelCreate {
  name: string;
  slug: string;
  architecture_code: string;
  task: AiTask;
  input_type: AiInputType;
  description?: string | null;
  purpose?: string | null;
  config?: Record<string, unknown>;
}

/**
 * ⚠ `task`, `input_type` y `architecture_code` dejan de ser editables en cuanto el
 * modelo tiene una version registrada: el backend responde **409** con
 * `details.immutable_fields`. No es un error de validacion —el valor es valido— sino
 * un conflicto con el estado del recurso, y la salida es crear un modelo nuevo.
 *
 * Usa `version_count > 0` para deshabilitar esos campos en el formulario.
 */
export type AiModelUpdate = Partial<
  Omit<AiModelCreate, 'config'> & { status: AiModelStatus; config: Record<string, unknown> }
>;

/**
 * Clase del vocabulario del proyecto.
 *
 * `class_index` lo asigna el SERVIDOR y es inmutable. No se reutiliza aunque la
 * clase se desactive: los pesos guardan indices, no nombres.
 */
export interface AiClass {
  id: string;
  project_id: string;
  name: string;
  readonly class_index: number;
  color: string;
  description: string | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AiClassCreate {
  name: string;
  /** #RRGGBB */
  color: string;
  description?: string | null;
}

/** No hay DELETE de clases: se desactivan con `is_active: false`. */
export type AiClassUpdate = Partial<AiClassCreate & { is_active: boolean }>;

/** Una clase dentro del vocabulario de un modelo, con su indice de entrenamiento. */
export interface ModelClass {
  class_id: string;
  /** Indice contiguo 0..N-1 que veran los pesos de ESTE modelo. */
  training_index: number;
  class_name: string | null;
  class_color: string | null;
  /** El indice de la clase en el PROYECTO. Distinto de `training_index`. */
  class_index: number | null;
  class_is_active: boolean | null;
}

/**
 * Reemplazo COMPLETO del vocabulario. El ORDEN del array fija `training_index`.
 *
 * No hay alta ni baja individual a proposito: `training_index` debe ser contiguo
 * 0..N-1, y retirar una clase del medio con operaciones sueltas dejaria un hueco que
 * el framework no admite. Envia siempre la lista entera y ordenada.
 *
 * Si el modelo ya tiene versiones, la operacion falla COMPLETA con 409: el
 * vocabulario nunca se queda a medias.
 */
export interface ModelVocabularyPut {
  class_ids: string[];
}

// ── Assets e imagenes ───────────────────────────────────────────────────────
export type AssetKind = 'image' | 'video' | 'frame' | 'thumbnail' | 'weights' | 'run_artifact';
export type ImageStatus = 'pending' | 'annotated' | 'validated' | 'rejected' | 'archived';

export interface UploadPrepareIn {
  kind: AssetKind;
  content_type: string;
  bytes: number;
  /** Entra en la ruta ya saneado. No hay campo `object_path`: la ruta la genera el servidor. */
  original_filename: string;
}

/**
 * `upload_url` es el endpoint de Storage: el cliente sube ahi con su propio JWT.
 *
 * `object_path` tiene la forma `{project_id}/{kind}/{asset_id}/{nombre_saneado}` y es
 * de SOLO LECTURA. El servidor la recalcula en `confirm` a partir de `asset_id`,
 * `content_type` y `original_filename`, asi que esos tres campos deben ser los MISMOS
 * en ambas llamadas o `confirm` no encontrara el objeto.
 */
export interface UploadPrepareOut {
  asset_id: string;
  bucket: string;
  readonly object_path: string;
  upload_url: string;
}

export interface UploadConfirmIn {
  asset_id: string;
  kind: AssetKind;
  /** Debe coincidir EXACTAMENTE con el enviado en `prepare`: la ruta se deriva de el. */
  original_filename: string;
  content_type: string;
  bytes: number;
  /** Hex de 64 caracteres. Es la deduplicacion: el mismo archivo dos veces se rechaza. */
  sha256: string;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
}

/**
 * El DELETE devuelve cuerpo, no 204.
 *
 * El metadato y el binario viven en sistemas distintos: si Storage falla, la fila
 * queda retirada y el objeto vivo. `storage_deleted: false` lo dice en lugar de
 * ocultarlo, y hay que mostrarlo.
 */
export interface AssetDeleteResult {
  asset_id: string;
  storage_deleted: boolean;
  orphaned_object_path: string | null;
  image_deleted: boolean;
}

export interface AiAsset {
  id: string;
  project_id: string;
  kind: AssetKind;
  bucket: string;
  object_path: string;
  original_filename: string;
  content_type: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uploaded_at: string;
  version: number;
}

export interface AiImage {
  id: string;
  project_id: string;
  asset_id: string;
  source: string;
  status: ImageStatus;
  version: number;
  created_at: string;
  frame_index: number | null;
  object_path: string | null;
  content_type: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  original_filename: string | null;
  annotation_count: number | null;
  /**
   * Version del ASSET, no de la imagen. Son contadores INDEPENDIENTES: cambiar el
   * estado incrementa `version` y no toca esta. El DELETE exige esta en `If-Match`;
   * enviar `version` da 412 en cuanto la imagen se ha anotado o cambiado de estado.
   */
  asset_version: number | null;
}

export interface SignedUrl {
  url: string;
  expires_in: number;
}

// ── Anotaciones ────────────────────────────────────────────────────────────
//
// ⚠ COORDENADAS NORMALIZADAS 0..1, NO PIXELES.
//
//   Es el formato nativo de YOLO y sobrevive a que la imagen se redimensione: la
//   misma caja vale para el original de 4032x3024 y para una miniatura de 400x300.
//   Con pixeles, generar una miniatura invalidaria en silencio todas las cajas.
//
//   La consecuencia para la UI es que TODA conversion pasa por el tamaño RENDERIZADO
//   del elemento <img>, no por `naturalWidth`. Mezclarlos coloca las cajas donde no
//   estan en cuanto el navegador escala la imagen para que quepa.

/** `cx`,`cy` = centro. `w`,`h` = ancho y alto. Todo entre 0 y 1. */
export interface Annotation {
  id: string;
  project_id: string;
  image_id: string;
  class_id: string;
  kind: string;
  cx: number | null;
  cy: number | null;
  w: number | null;
  h: number | null;
  origin: string;
  confidence: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  /** Resueltos por el backend en el JOIN con las clases, para poder pintar ya. */
  class_name: string | null;
  class_color: string | null;
  class_index: number | null;
}

/**
 * Una caja que se envia al guardar.
 *
 * `id` presente = ya existia, actualizala. `id` ausente = es nueva. El servidor
 * rechaza un `id` que no sea de esta imagen en lugar de crearlo con el.
 */
export interface AnnotationDraft {
  id?: string;
  class_id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Resultado de guardar. Trae la version NUEVA de la imagen, que es el `If-Match` de
 * la siguiente escritura: sin ella el cliente quedaria con un ETag caducado y el
 * segundo guardado fallaria con 409 sin que nadie haya tocado nada.
 */
export interface AnnotationsSaved {
  annotations: Annotation[];
  image_id: string;
  image_status: ImageStatus;
  image_version: number;
}

export const MIME_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_BYTES_IMAGEN = 25 * 1024 * 1024;

/** Codigos de error propios del modulo, para mensajes especificos en la UI. */
export const AI_ERROR_CODES = {
  NOT_PLATFORM_OWNER: 'NOT_PLATFORM_OWNER',
  MODEL_CONTRACT_IMMUTABLE: 'AI_MODEL_CONTRACT_IMMUTABLE',
  ARCHITECTURE_CAPABILITY: 'AI_ARCHITECTURE_CAPABILITY',
  ARCHITECTURE_IN_USE: 'AI_ARCHITECTURE_IN_USE',
  VERSION_TRANSITION_INVALID: 'AI_VERSION_TRANSITION_INVALID',
  MODEL_VOCABULARY_FROZEN: 'AI_MODEL_VOCABULARY_FROZEN',
  CLASS_INDEX_CONFLICT: 'AI_CLASS_INDEX_CONFLICT',
  CLASS_INACTIVE: 'AI_CLASS_INACTIVE',
  CROSS_PROJECT_REFERENCE: 'AI_CROSS_PROJECT_REFERENCE',
} as const;

// ── Versiones de dataset ───────────────────────────────────────────────────
//
// Una version congelada es INMUTABLE: la base tiene un trigger que aborta UPDATE y
// DELETE. Es lo que hace reproducible un entrenamiento y comparables dos modelos.
// Por eso no hay tipo de actualizacion ni de borrado.

export interface DatasetClassSnapshot {
  index: number;
  name: string;
}

export interface DatasetVersion {
  id: string;
  project_id: string;
  version: number;
  name: string | null;
  notes: string | null;
  class_snapshot: DatasetClassSnapshot[];
  image_count: number;
  train_count: number;
  val_count: number;
  test_count: number;
  split_seed: number;
  frozen_at: string;
}

/** Que entraria si se congelara ahora. No escribe nada. */
export interface DatasetPreview {
  total_images: number;
  eligible: number;
  with_annotations: number;
  annotations: number;
  by_status: Record<string, number>;
  active_classes: number;
  next_version: number;
  /** `false` significa que congelar fallaria. Permite explicar el motivo antes. */
  can_freeze: boolean;
}

export interface DatasetFreezeInput {
  name?: string | null;
  notes?: string | null;
  /** Fija, no aleatoria: repetirla reproduce el reparto anterior. */
  split_seed?: number;
  train_pct?: number;
  val_pct?: number;
  test_pct?: number;
}

export interface YoloExportItem {
  image_id: string;
  asset_id: string;
  split: string;
  filename: string;
  object_path: string | null;
  /** Contenido literal del .txt. Vacio en un negativo, que es valido. */
  label: string;
  box_count: number;
  url: string | null;
}

export interface YoloExport {
  version: number;
  version_id: string;
  image_count: number;
  train_count: number;
  val_count: number;
  test_count: number;
  split_seed: number;
  data_yaml: string;
  /**
   * `class_index` del proyecto → `training_index` de los pesos.
   *
   * ⚠ NO son el mismo numero. `class_index` es inmutable y NO se reutiliza, asi que
   *   puede tener huecos; los frameworks exigen indices contiguos 0..N-1. Sin este
   *   mapa, un modelo entrenado no se puede interpretar.
   */
  class_map: { training_index: number; class_index: number; name: string }[];
  items: YoloExportItem[];
  signed_url_ttl: number;
  bucket: string;
  /** `false` cuando el conjunto supera `sign_limit`: hay rutas pero no firmas. */
  signed: boolean;
  sign_limit: number;
}
