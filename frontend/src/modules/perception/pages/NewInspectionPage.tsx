/**
 * NEW INSPECTION — /perception/new
 *
 * Flujo: seleccionar archivo → preview → configurar → crear job.
 * Ya no hay fixtures ni demostracion cargable: `dev-data.ts` se borro del arbol.
 * Lo que se registra aqui son filas reales de `perception.inference_jobs` (0069).
 */

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Film, Play, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useSessionStore } from '../../../auth/sessionStore';
import { useCreateJob, usePerceptionModels, usePerceptionWarehouses } from '../usePerception';
import { PIPELINES } from '../pipelines';
import type { CreateJobInput, MediaType, PipelineType } from '../types';

const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_VIDEOS = ['video/mp4', 'video/webm'];
const ALL_ACCEPTED = [...ACCEPTED_IMAGES, ...ACCEPTED_VIDEOS];
const MAX_SIZE = 500 * 1024 * 1024; // 500MB

interface MediaMeta {
  file: File;
  objectUrl: string;
  type: MediaType;
  width: number;
  height: number;
  durationMs: number | null;
}

export function NewInspectionPage() {
  const navigate = useNavigate();
  const models = usePerceptionModels();
  const createJob = useCreateJob();
  const inputRef = useRef<HTMLInputElement>(null);

  // File state
  const [media, setMedia] = useState<MediaMeta | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [envioError, setEnvioError] = useState<string | null>(null);

  /*
    ── EL ALMACEN: ELEGIDO, NO SUPUESTO ───────────────────────────────────

    Una inspeccion es de un almacen —RLS lo exige— y este formulario no lo pedia
    nunca: `warehouseId` era opcional en el tipo y la pantalla no lo mandaba, asi que
    el envio fallaba en el servidor por un dato que nadie habia preguntado.

    El primer intento fue leer `activeWarehouseId` de la sesion. Se comprobo en el
    navegador y viene NULO: nadie lo ha fijado todavia, porque solo se escribe cuando
    alguien usa el selector del explorador. El resultado era un boton «Crear
    inspeccion» permanentemente deshabilitado.

    Asi que se elige aqui, con el valor de la sesion como preferencia y el primero
    accesible como respaldo. La eleccion se ESCRIBE en la sesion, para que las dos
    pantallas hablen del mismo almacen en lugar de cada una del suyo.
  */
  const almacenes = usePerceptionWarehouses();
  const persistido = useSessionStore((s) => s.activeWarehouseId);
  const setPersistido = useSessionStore((s) => s.setActiveWarehouse);
  const [almacenElegido, setAlmacenElegido] = useState<string | null>(null);

  const lista = almacenes.data ?? [];
  const warehouseId =
    almacenElegido ??
    (persistido && lista.some((w) => w.id === persistido) ? persistido : null) ??
    (lista.length > 0 ? lista[0]!.id : null);

  const elegirAlmacen = useCallback(
    (id: string) => {
      setAlmacenElegido(id);
      setPersistido(id);
    },
    [setPersistido],
  );

  // Form state
  const [name, setName] = useState('');
  const [pipeline, setPipeline] = useState<PipelineType>('object-detection');
  const [modelId, setModelId] = useState('');
  const [confidence, setConfidence] = useState(0.5);
  const [fps, setFps] = useState(1);
  const [saveFrames, setSaveFrames] = useState(false);
  const [notes, setNotes] = useState('');

  // ── File handling ─────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setFileError(null);

    if (!ALL_ACCEPTED.includes(file.type)) {
      setFileError(`Tipo no admitido: ${file.type}. Usa JPG, PNG, WebP, MP4 o WebM.`);
      return;
    }
    if (file.size > MAX_SIZE) {
      setFileError(`Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximo 500 MB.`);
      return;
    }

    // Revoke previous
    if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl);

    const objectUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');

    if (isVideo) {
      const meta = await getVideoMeta(objectUrl);
      setMedia({ file, objectUrl, type: 'video', width: meta.width, height: meta.height, durationMs: meta.durationMs });
    } else {
      const meta = await getImageMeta(objectUrl);
      setMedia({ file, objectUrl, type: 'image', width: meta.width, height: meta.height, durationMs: null });
    }

    if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
  }, [media, name]);

  const removeFile = useCallback(() => {
    if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl);
    setMedia(null);
    setFileError(null);
  }, [media]);

  // ── Modelos compatibles ───────────────────────────────────────────────
  const catalogo = models.data;
  const compatibleModels = (catalogo?.models ?? []).filter((m) =>
    m.supportedPipelines.includes(pipeline),
  );

  // Si el modelo elegido deja de ser compatible al cambiar de pipeline, se limpia.
  if (modelId && compatibleModels.length > 0 && !compatibleModels.some((m) => m.modelVersionId === modelId)) {
    setModelId('');
  }

  /*
    ── POR QUE SE PUEDE ENVIAR SIN MODELO ─────────────────────────────────

    Hoy no hay NINGUNA version de modelo publicada, asi que exigir modelo dejaria
    esta pantalla inservible: un formulario completo y un boton que nunca se
    habilita, sin decir por que.

    Registrar la inspeccion sin modelo si sirve para algo —queda el material, el
    almacen, el umbral y quien lo pidio— y el trabajo espera en la cola. Lo que NO se
    hace es fingir que va a analizarse: el aviso de abajo dice que no hay modelo ni
    worker, con lo que falta para que lo haya.
  */
  const canSubmit = Boolean(
    media && name.trim() && warehouseId && confidence > 0 && confidence <= 1 && fps > 0,
  );

  const handleSubmit = useCallback(async () => {
    if (!media || !canSubmit || !warehouseId) return;
    setEnvioError(null);
    const input: CreateJobInput = {
      name: name.trim(),
      file: media.file,
      source: 'uploaded-file',
      warehouseId,
      config: {
        pipeline,
        modelVersionId: modelId || null,
        confidenceThreshold: confidence,
        frameSamplingRate: fps,
        saveDetectedFrames: saveFrames,
        notes: notes.trim(),
      },
    };
    try {
      const job = await createJob.mutateAsync(input);
      navigate(`/perception/jobs/${job.id}`);
    } catch (e) {
      // El error se MUESTRA. Antes la promesa se rechazaba sin capturar: el boton
      // volvia a su sitio y no pasaba nada visible, que se lee como «no funciona».
      setEnvioError(e instanceof Error ? e.message : 'No se pudo crear la inspeccion.');
    }
  }, [media, name, pipeline, modelId, confidence, fps, saveFrames, notes, canSubmit, warehouseId, createJob, navigate]);

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* Header */}
        <div>
          <Link to="/perception" className="t-mono-xs text-[var(--text-faint)] hover:underline">
            <ArrowLeft strokeWidth={1.5} className="mb-0.5 mr-1 inline size-3" />Inspecciones
          </Link>
          <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] text-[var(--text-primary)]">Nueva inspeccion</h1>
        </div>

        <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
          {/* Left: file selector + preview */}
          <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-5 xl:col-span-5">
            <PanelHeader title="Archivo" subtitle="Imagen o video a procesar" />

            {!media && (
              <div
                className="flex flex-col items-center gap-4 rounded-[var(--radius-md)] border border-dashed border-[color-mix(in_oklab,var(--accent)_25%,transparent)] p-8"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
              >
                <Upload strokeWidth={1.25} className="size-7 text-[var(--icon-accent)]" />
                <p className="t-body text-center text-[var(--text-secondary)]">
                  Arrastra un archivo o selecciona
                </p>
                <p className="t-mono-xs text-center text-[var(--text-faint)]">
                  JPG · PNG · WebP · MP4 · WebM · hasta 500 MB
                </p>
                <input ref={inputRef} type="file" accept={ALL_ACCEPTED.join(',')} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}>
                  Seleccionar archivo
                </Button>
              </div>
            )}

            {media && (
              <div className="flex flex-col gap-4">
                {/* Preview */}
                <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)] bg-black">
                  {media.type === 'image' ? (
                    <img src={media.objectUrl} alt="Preview" className="size-full object-contain" />
                  ) : (
                    <video src={media.objectUrl} className="size-full object-contain" controls muted />
                  )}
                  <button
                    type="button"
                    onClick={removeFile}
                    className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Quitar archivo"
                  >
                    <X strokeWidth={1.5} className="size-4" />
                  </button>
                  <Badge tone={media.type === 'image' ? 'measured' : 'inferred'} size="xs" className="absolute left-2 top-2">
                    {media.type === 'image' ? <Camera strokeWidth={1.5} className="size-3" /> : <Film strokeWidth={1.5} className="size-3" />}
                    {media.type}
                  </Badge>
                </div>
                {/* Metadata */}
                <dl className="flex flex-col gap-1.5">
                  <MetaRow label="Nombre" value={media.file.name} />
                  <MetaRow label="Tipo" value={media.file.type} />
                  <MetaRow label="Tamaño" value={`${(media.file.size / 1024 / 1024).toFixed(2)} MB`} />
                  <MetaRow label="Resolucion" value={`${media.width} × ${media.height} px`} />
                  {media.durationMs !== null && (
                    <MetaRow label="Duracion" value={`${(media.durationMs / 1000).toFixed(1)} s`} />
                  )}
                </dl>
                <Button variant="ghost" size="xs" onClick={() => inputRef.current?.click()}>
                  Reemplazar
                </Button>
                <input ref={inputRef} type="file" accept={ALL_ACCEPTED.join(',')} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
              </div>
            )}

            {fileError && <p className="t-small text-[var(--state-alert)]">{fileError}</p>}
          </Panel>

          {/* Right: configuration */}
          <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-5 xl:col-span-7">
            <PanelHeader title="Configuracion" subtitle="Parametros del procesamiento" />

            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
              <Field label="Almacen" required>
                <select
                  value={warehouseId ?? ''}
                  onChange={(e) => elegirAlmacen(e.target.value)}
                  disabled={lista.length === 0}
                  className="h-10 w-full rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)] disabled:opacity-40"
                >
                  {lista.length === 0 && (
                    <option value="">
                      {almacenes.isLoading ? 'cargando…' : 'sin almacenes accesibles'}
                    </option>
                  )}
                  {lista.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
                <span className="t-mono-xs text-[var(--text-faint)]">
                  Las detecciones se guardan contra este almacen, y los codigos de rack
                  que se lean se resolveran contra SU catalogo.
                </span>
              </Field>

              <Field label="Nombre de inspeccion" required>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Conteo Pasillo 3" className="h-10 w-full rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]" />
              </Field>

              <Field label="Pipeline" required>
                <select value={pipeline} onChange={(e) => setPipeline(e.target.value as PipelineType)} className="h-10 w-full rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]">
                  {PIPELINES.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <span className="t-mono-xs text-[var(--text-faint)]">{PIPELINES.find((p) => p.id === pipeline)?.description}</span>
              </Field>

              <Field label="Modelo">
                <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={compatibleModels.length === 0} className="h-10 w-full rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)] disabled:opacity-40">
                  <option value="">{compatibleModels.length === 0 ? 'No hay ninguno publicado' : 'Seleccionar modelo'}</option>
                  {compatibleModels.map((m) => (
                    <option key={m.modelVersionId} value={m.modelVersionId}>
                      {m.name} {m.version} ({m.architecture} · {m.task})
                    </option>
                  ))}
                </select>
                {/*
                  Los dos casos se distinguen, y no es lo mismo:
                  · hay modelos publicados pero ninguno sirve para este pipeline
                  · no hay NINGUN modelo publicado todavia
                  Un unico mensaje para los dos mandaria a cambiar de pipeline a quien
                  lo que necesita es que alguien publique un modelo.
                */}
                {compatibleModels.length === 0 && (catalogo?.models.length ?? 0) > 0 && (
                  <span className="t-mono-xs text-[var(--state-alert)]">
                    Hay modelos publicados, pero ninguno sirve para este pipeline.
                  </span>
                )}
                {(catalogo?.models.length ?? 0) === 0 && (
                  <span className="t-mono-xs text-[var(--text-faint)]">
                    Todavia no hay ninguna version de modelo publicada. La inspeccion se
                    registra igual y queda en cola: se guarda el material, el almacen y
                    los parametros, y se puede analizar cuando exista el modelo.
                  </span>
                )}
              </Field>

              <Field label="Confidence threshold" hint={`${(confidence * 100).toFixed(0)}%`}>
                <input type="range" min="0.01" max="1" step="0.01" value={confidence} onChange={(e) => setConfidence(parseFloat(e.target.value))} className="w-full" />
              </Field>

              {media?.type === 'video' && (
                <Field label="Frames por segundo a analizar" hint={`${fps} fps`}>
                  <input type="number" min="0.1" max="30" step="0.1" value={fps} onChange={(e) => setFps(parseFloat(e.target.value) || 1)} className="h-10 w-24 rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]" />
                </Field>
              )}

              {media?.type === 'video' && (
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={saveFrames} onChange={(e) => setSaveFrames(e.target.checked)} />
                  <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">Guardar frames con detecciones</span>
                </label>
              )}

              <Field label="Observaciones">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas opcionales" className="w-full resize-none rounded-[var(--radius-md)] px-3 py-2 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]" />
              </Field>

              {/* Dev notice */}
              {/* El aviso lo dice el SERVIDOR, no esta escrito aqui.
                  Estaba fijo en el codigo —«el worker aun no esta conectado»— y habria
                  seguido diciendolo el dia que se conectara uno. */}
              {catalogo && !catalogo.workerAvailable && (
                <div className="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 [background:color-mix(in_oklab,var(--state-alert)_6%,transparent)]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--state-alert)]" />
                  <span className="t-mono-xs text-[var(--ember-400)]">
                    {catalogo.unavailableReason ??
                      'No hay ningun worker de inferencia disponible.'}
                  </span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" loading={createJob.isPending} disabled={!canSubmit}>
                  <Play strokeWidth={1.5} className="size-4" />
                  Crear inspeccion
                </Button>
                <Link to="/perception">
                  <Button variant="ghost">Cancelar</Button>
                </Link>
              </div>

              {(envioError ?? createJob.error) && (
                <p className="t-small text-[var(--state-alert)]">
                  {envioError ??
                    (createJob.error instanceof Error
                      ? createJob.error.message
                      : 'No se pudo crear la inspeccion.')}
                </p>
              )}

              {!warehouseId && !almacenes.isLoading && (
                <p className="t-mono-xs text-[var(--state-alert)]">
                  Este usuario no tiene ningun almacen accesible, asi que no hay donde
                  registrar la inspeccion.
                </p>
              )}
            </form>
          </Panel>
        </div>
      </div>
    </CanvasHost>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="t-label">
        {label}{required && <span className="ml-1 text-[var(--state-alert)]">*</span>}
        {hint && <span className="ml-2 font-normal text-[var(--text-faint)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-label">{label}</dt>
      <dd className="text-[length:var(--text-sm)] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function getImageMeta(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function getVideoMeta(url: string): Promise<{ width: number; height: number; durationMs: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => resolve({ width: 0, height: 0, durationMs: 0 });
    video.src = url;
  });
}
