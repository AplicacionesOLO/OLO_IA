/**
 * Detalle de un modelo: su contrato y su vocabulario.
 *
 * Dos cosas que la pantalla tiene que comunicar bien:
 *
 *  · con versiones registradas, `task`, `input_type` y `architecture_code` dejan de
 *    ser editables. Se deshabilitan Y se dice por que, porque un campo gris sin
 *    explicacion parece un fallo;
 *  · el vocabulario se reemplaza completo y el ORDEN fija `training_index`.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronDown,
  FlaskConical,
  Lock,
  Save,
  Trash2,
  X,
} from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { Modal } from '../../design/foundation/Modal';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { Button } from '../../design/primitives/Button';
import { CanvasHost } from '../../shell/CanvasHost';
import { cn } from '../../design/utils/cn';
import type {
  AiModel,
  ModelVersion,
  ModelVersionStatus,
  TrainingRun,
  TrainingRunStatus,
} from '../../lib/aiTypes';
import { useDatasetVersions } from './useDatasets';
import { NotOwnerNotice } from './NotOwnerNotice';
import {
  useArchitectures,
  useCancelTrainingRun,
  useClasses,
  useDeleteModel,
  useModel,
  useModelVersions,
  useQueueTrainingRun,
  useReplaceVocabulary,
  useTransitionVersion,
  useTrainingRuns,
  useVocabulary,
} from './useAi';

/**
 * La forma de una entrada de `Architecture.hyperparam_schema`.
 *
 * `Record<string, unknown>` es lo que trae el contrato general (`aiTypes.ts`) porque
 * cada arquitectura declara lo suyo; esto es la forma que de verdad manda el catalogo
 * hoy —comprobada contra `/v1/ai/architectures`—, solo para poder pintar el formulario
 * sin `any`.
 */
interface HyperparamSpec {
  type: 'number' | 'integer' | 'enum';
  default: number;
  min?: number;
  max?: number;
  values?: number[];
}

/**
 * Confirmar en dos pasos, EN LA PROPIA FILA — no `window.confirm()`.
 *
 * El resto de la aplicacion ya dejo de usar dialogos nativos (ver la cabecera de
 * `Modal.tsx`): tapan el hilo de render y su tipografia no es la del sistema. Un
 * borrado se comparte entre esta pantalla y la de proyecto, de ahi que viva aqui y
 * se importe en la otra en vez de escribirse dos veces.
 */
export function BotonEliminarConConfirmacion({
  etiqueta,
  pendiente,
  onConfirmar,
}: {
  etiqueta: string;
  pendiente: boolean;
  onConfirmar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  if (confirmando) {
    return (
      <div className="flex items-center gap-2">
        <span className="t-mono-xs text-[var(--text-warn)]">¿Seguro?</span>
        <Button variant="danger" size="xs" loading={pendiente} onClick={onConfirmar}>
          Si, eliminar
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirmando(false)}>
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="xs" onClick={() => setConfirmando(true)}>
      <Trash2 strokeWidth={1.5} className="size-3.5" />
      {etiqueta}
    </Button>
  );
}

export function AiModelDetailPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const navigate = useNavigate();
  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);

  const modelo = useModel(modelId);
  const vocab = useVocabulary(modelId);
  const clases = useClasses(modelo.data?.project_id);
  const eliminar = useDeleteModel(modelo.data?.project_id ?? '');

  if (!esOwner) return <NotOwnerNotice />;
  if (modelo.isLoading) {
    return (
      <CanvasHost mode="grid">
        <p className="t-small text-[var(--text-faint)]">Cargando…</p>
      </CanvasHost>
    );
  }
  if (modelo.error || !modelo.data) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="lg" pad="md">
          <p className="t-small text-[var(--text-warn)]">
            {modelo.error instanceof Error ? modelo.error.message : 'Modelo no encontrado'}
          </p>
        </Panel>
      </CanvasHost>
    );
  }

  const m = modelo.data;
  const congelado = (m.version_count ?? 0) > 0;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              to={`/ai/projects/${m.project_id}`}
              className="t-mono-xs text-[var(--text-faint)] hover:underline"
            >
              ← Proyecto
            </Link>
            <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight text-[var(--text-primary)]">
              {m.name}
            </h1>
            <p className="t-mono-xs text-[var(--text-faint)]">
              {m.slug} · {m.status} · v{m.version}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <BotonEliminarConConfirmacion
              etiqueta="Eliminar modelo"
              pendiente={eliminar.isPending}
              onConfirmar={() =>
                eliminar.mutate(m.id, { onSuccess: () => navigate(`/ai/projects/${m.project_id}`) })
              }
            />
            {eliminar.error && (
              <p className="t-mono-xs max-w-[32ch] text-right text-[var(--text-warn)]">
                {eliminar.error instanceof Error ? eliminar.error.message : 'No se pudo eliminar'}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
          <Panel
            level="work"
            radius="xl"
            pad="md"
            className="col-span-12 flex flex-col gap-4 xl:col-span-5"
          >
            <PanelHeader title="Contrato" subtitle="Que sabe hacer y con que" />

            {congelado && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
                <Lock strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-[var(--icon-accent)]" />
                <p className="t-small text-[var(--text-secondary)]">
                  Este modelo tiene {m.version_count} version(es) registradas. La
                  arquitectura, la tarea y el tipo de entrada ya no se pueden cambiar:
                  los pesos existentes dejarian de poder interpretarse. Para otra
                  combinacion, crea un modelo nuevo.
                </p>
              </div>
            )}

            <dl className="flex flex-col gap-2">
              <Dato k="Arquitectura" v={`${m.architecture_name ?? m.architecture_code}`} bloqueado={congelado} />
              <Dato k="Tarea" v={m.task} bloqueado={congelado} />
              <Dato k="Entrada" v={m.input_type} bloqueado={congelado} />
              <Dato k="Framework" v={`${m.framework_name ?? '—'} (${m.framework_adapter ?? '—'})`} derivado />
              <Dato k="Entrena" v={m.requires_training ? 'si' : 'no (zero-shot)'} derivado />
              <Dato k="Pesos" v={m.weights_extension ?? '—'} derivado />
              <Dato
                k="Version publicada"
                v={m.published_version_id ? m.published_version_id.slice(0, 8) : 'ninguna'}
                derivado
              />
            </dl>

            {m.purpose && (
              <p className="t-small text-[var(--text-secondary)]">{m.purpose}</p>
            )}
          </Panel>

          <Panel
            level="work"
            radius="xl"
            pad="md"
            className="col-span-12 flex flex-col gap-4 xl:col-span-7"
          >
            <PanelHeader
              title="Vocabulario"
              subtitle="El orden fija el indice de entrenamiento que veran los pesos"
            />
            {vocab.isLoading || clases.isLoading ? (
              <p className="t-small text-[var(--text-faint)]">Cargando…</p>
            ) : (
              <EditorVocabulario
                modelId={modelId!}
                congelado={congelado}
                actual={(vocab.data ?? []).map((v) => v.class_id)}
                disponibles={(clases.data ?? []).filter((c) => c.is_active)}
              />
            )}
          </Panel>

          <PanelEntrenamiento modelo={m} />

          {m.requires_training && <PanelVersiones modelo={m} />}
        </div>
      </div>
    </CanvasHost>
  );
}

/*
  ── POR QUE UN PANEL APARTE, Y POR QUE NO SE ENCOLA DIRECTO DESDE UNA API KEY ────

  Antes de esto, reentrenar dependia de alguien con acceso a la maquina de GPU
  corriendo `entrenar.py` a mano por consola — asi que cada vez que hacia falta un
  modelo nuevo, alguien tenia que pedirlo por fuera de la aplicacion.

  Encolar una ejecucion es un INSERT en `ai.training_runs` (`POST /ai/training-runs`,
  ya existente): el propio `entrenar.py`, corriendo en la maquina con GPU, coge la
  siguiente fila `queued` el solo. Este panel es la parte que faltaba: el boton y el
  modal para escribir esa fila sin tocar una terminal.
*/
function PanelEntrenamiento({ modelo }: { modelo: AiModel }) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const runs = useTrainingRuns(modelo.id);

  if (!modelo.requires_training) {
    return (
      <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-3">
        <PanelHeader title="Entrenamiento" subtitle="No aplica a esta arquitectura" />
        <p className="t-small text-[var(--text-secondary)]">
          {modelo.architecture_name ?? modelo.architecture_code} funciona a partir de una
          descripcion en texto (zero-shot): no hay pesos propios que entrenar.
        </p>
      </Panel>
    );
  }

  const lista = runs.data?.runs ?? [];
  const runnerVivo = runs.data?.runner_available ?? false;

  return (
    <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-4">
      <PanelHeader
        title="Entrenamiento"
        subtitle="Cada ejecucion queda contra una version de dataset congelada"
        trailing={
          <Button variant="primary" size="sm" onClick={() => setModalAbierto(true)}>
            <FlaskConical strokeWidth={1.5} className="size-4" />
            Nuevo entrenamiento
          </Button>
        }
      />

      {!runnerVivo && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 [background:color-mix(in_oklab,var(--state-alert)_6%,transparent)]">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--state-alert)]" />
          <span className="t-mono-xs text-[var(--text-warn)]">
            {runs.data?.unavailable_reason ??
              'No hay ninguna maquina con GPU corriendo entrenar.py ahora mismo. Lo que se encole aqui espera en cola hasta que la haya.'}
          </span>
        </div>
      )}

      {lista.length === 0 ? (
        <p className="t-small text-[var(--text-secondary)]">
          Sin ejecuciones todavia. La primera version de pesos de este modelo sale de la
          primera que termine bien.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((r) => (
            <FilaEjecucion key={r.id} run={r} modeloId={modelo.id} />
          ))}
        </ul>
      )}

      {modalAbierto && (
        <NuevoEntrenamientoModal modelo={modelo} onCerrar={() => setModalAbierto(false)} />
      )}
    </Panel>
  );
}

const TONO_ESTADO: Record<TrainingRunStatus, 'neutral' | 'inferred' | 'confirmed' | 'critical'> = {
  queued: 'neutral',
  running: 'inferred',
  succeeded: 'confirmed',
  failed: 'critical',
  cancelled: 'neutral',
};

const FASE_TEXTO: Record<string, string> = {
  preparando: 'Preparando',
  entrenando: 'Entrenando',
  guardando: 'Guardando',
};

/**
 * Que esta pasando AHORA, y el porcentaje si se puede calcular.
 *
 * Sin esto, una ejecucion `running` de dos horas es indistinguible de otra que
 * lleva cinco minutos: las dos dicen «running» y una fecha de arranque quieta.
 */
function ProgresoEjecucion({ progress }: { progress: TrainingRun['progress'] }) {
  const fase = progress?.phase;
  const epoch = progress?.epoch;
  const epochs = progress?.epochs;
  const porcentaje =
    epoch != null && epochs != null && epochs > 0
      ? Math.round((epoch / epochs) * 100)
      : null;

  if (!fase) {
    return <p className="t-mono-xs text-[var(--text-faint)]">Arrancando…</p>;
  }

  const texto =
    fase === 'entrenando' && epoch != null && epochs != null
      ? `Entrenando: epoca ${epoch} de ${epochs}${porcentaje != null ? ` (${porcentaje} %)` : ''}`
      : (FASE_TEXTO[fase] ?? fase) + (progress?.message ? `: ${progress.message}` : '');

  return (
    <div className="flex flex-col gap-1">
      <p className="t-mono-xs text-[var(--text-secondary)]">{texto}</p>
      {porcentaje != null && (
        <div className="h-1 w-full overflow-hidden rounded-full [background:var(--glass-2)]">
          <div
            className="h-full rounded-full [background:var(--icon-accent)] transition-[width]"
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      )}
    </div>
  );
}

function FilaEjecucion({ run, modeloId }: { run: TrainingRun; modeloId: string }) {
  const cancelable = run.status === 'queued' || run.status === 'running';

  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] px-3 py-2.5 [background:var(--glass-1)]">
      <div className="flex items-center gap-3">
        <Badge tone={TONO_ESTADO[run.status]} size="xs" glow={run.status === 'running'}>
          {run.status}
        </Badge>
        <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {run.dataset_name ?? run.dataset_version_id.slice(0, 8)}
          {run.dataset_image_count != null && (
            <span className="text-[var(--text-faint)]"> · {run.dataset_image_count} imagenes</span>
          )}
        </span>
        <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
          {new Date(run.created_at).toLocaleString('es')}
        </span>
        {cancelable && <BotonCancelarEjecucion runId={run.id} modeloId={modeloId} />}
      </div>
      {run.runner && (
        <p className="t-mono-xs text-[var(--text-faint)]">runner: {run.runner}</p>
      )}
      {run.status === 'running' && <ProgresoEjecucion progress={run.progress} />}
      {run.warning && (
        <p className="t-mono-xs text-[var(--text-warn)]">{run.warning}</p>
      )}
      {run.error_message && (
        <p className="t-mono-xs text-[var(--text-warn)]">{run.error_message}</p>
      )}
      {run.metrics && Object.keys(run.metrics).length > 0 && (
        <p className="t-mono-xs text-[var(--text-secondary)]">
          {Object.entries(run.metrics)
            .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(3) : String(v)}`)
            .join(' · ')}
        </p>
      )}
    </li>
  );
}

/**
 * Cancelar exige un motivo (lo impone el backend, minimo 3 caracteres) — por eso
 * este control no es el mismo `BotonEliminarConConfirmacion` de dos pasos: el
 * segundo paso aqui es escribir por que, no solo confirmar.
 */
function BotonCancelarEjecucion({ runId, modeloId }: { runId: string; modeloId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const cancelar = useCancelTrainingRun(modeloId);

  if (!abierto) {
    return (
      <Button variant="ghost" size="xs" onClick={() => setAbierto(true)}>
        <Ban strokeWidth={1.5} className="size-3.5" />
        Cancelar
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        autoFocus
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="motivo (minimo 3 caracteres)"
        className="h-7 w-44 rounded-[var(--radius-sm)] px-2 [background:var(--glass-2)] text-[length:var(--text-xs)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
      />
      <Button
        variant="danger"
        size="xs"
        loading={cancelar.isPending}
        disabled={motivo.trim().length < 3}
        onClick={() => cancelar.mutate({ id: runId, reason: motivo.trim() }, { onSuccess: () => setAbierto(false) })}
      >
        Confirmar
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setAbierto(false)}>
        <X className="size-3.5" strokeWidth={1.5} />
      </Button>
      {cancelar.error && (
        <span className="t-mono-xs text-[var(--text-warn)]">
          {cancelar.error instanceof Error ? cancelar.error.message : 'No se pudo cancelar'}
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VERSIONES DE PESOS: validar, publicar, degradar, archivar
//
// La matriz de transiciones vive en `ai.validate_version_transition()` (0038) y es
// la UNICA autoridad; esto de aqui es solo la comodidad de no ofrecer un boton que
// el servidor va a rechazar. Duplicarla aqui no inventa una segunda fuente de
// verdad porque un desajuste falla CERRADO: el boton desaparece, el 409 no.
// ═══════════════════════════════════════════════════════════════════════════
const TRANSICIONES_VALIDAS: Record<ModelVersionStatus, ModelVersionStatus[]> = {
  registered: ['validating', 'archived'],
  validating: ['validated', 'failed'],
  validated: ['published', 'validating', 'archived'],
  published: ['deprecated'],
  deprecated: ['published', 'archived'],
  failed: ['validating', 'archived'],
  archived: [],
};

const ETIQUETA_TRANSICION: Record<ModelVersionStatus, { etiqueta: string; variante: 'primary' | 'danger' }> = {
  registered: { etiqueta: 'registrada', variante: 'primary' },
  validating: { etiqueta: 'Iniciar validación', variante: 'primary' },
  validated: { etiqueta: 'Marcar validada', variante: 'primary' },
  published: { etiqueta: 'Publicar', variante: 'primary' },
  deprecated: { etiqueta: 'Retirar', variante: 'danger' },
  archived: { etiqueta: 'Archivar', variante: 'danger' },
  failed: { etiqueta: 'Marcar fallida', variante: 'danger' },
};

const TONO_VERSION: Record<ModelVersionStatus, 'neutral' | 'inferred' | 'measured' | 'confirmed' | 'critical'> = {
  registered: 'neutral',
  validating: 'inferred',
  validated: 'measured',
  published: 'confirmed',
  deprecated: 'neutral',
  archived: 'neutral',
  failed: 'critical',
};

/**
 * Que "validating" no tenga barra de progreso ES correcto: no hay ningun
 * proceso corriendo detras, es un estado manual que espera a que una persona
 * decida. Sin este texto eso se lee como que la pantalla se congelo — el mismo
 * problema de visibilidad que ya se resolvio en entrenamiento, aplicado aqui.
 */
const MENSAJE_ESTADO_VERSION: Record<ModelVersionStatus, string> = {
  registered: 'Recien entrenada, sin revisar todavia.',
  validating:
    'En revision manual — no hay ningun proceso corriendo. Confirma "Marcar validada" cuando compruebes que los pesos aciertan lo que dicen.',
  validated: 'Validada. Lista para reemplazar la version en produccion cuando la publiques.',
  published: 'Publicada: es la version que usa el analizador de percepcion ahora mismo.',
  deprecated: 'Retirada de produccion. Se puede volver a publicar sin reentrenar.',
  archived: 'Archivada. Estado final: no se puede reactivar.',
  failed: 'Marcada como fallida.',
};

function PanelVersiones({ modelo }: { modelo: AiModel }) {
  const versiones = useModelVersions(modelo.id);
  const lista = versiones.data?.versions ?? [];
  const publicada = lista.find((v) => v.status === 'published');

  return (
    <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-4">
      <PanelHeader
        title="Versiones de pesos"
        subtitle="Solo una version publicada aparece en el desplegable de percepcion"
      />
      {versiones.isLoading ? (
        <p className="t-small text-[var(--text-faint)]">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="t-small text-[var(--text-secondary)]">
          Sin versiones todavia. Salen de una ejecución de entrenamiento que termina bien.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((v) => (
            <FilaVersion key={v.id} version={v} modeloId={modelo.id} publicada={publicada} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * El mAP50-95 es un PROMEDIO de todas las clases: puede verse bien aunque una
 * clase concreta —justo la que a alguien le importa, como `hueco_vacio`— este
 * floja o directamente sin aprender. Sin el desglose, "valido esto" es un acto
 * de fe sobre un solo numero. Ordenado de peor a mejor: lo que hay que mirar
 * primero para decidir si validar es la clase mas debil, no la mejor.
 */
function DesgloseClases({
  version,
  publicada,
}: {
  version: ModelVersion;
  publicada: ModelVersion | undefined;
}) {
  const porClase = (version.metrics?.['ap_por_clase'] ?? null) as Record<string, number> | null;
  const porClasePublicada = (publicada?.metrics?.['ap_por_clase'] ?? null) as Record<
    string,
    number
  > | null;
  const vocabulario = version.class_map;

  if (!porClase) {
    return (
      <p className="t-mono-xs text-[var(--text-faint)]">
        Esta ejecucion no dejo metricas por clase.
      </p>
    );
  }

  // Las clases que el modelo aprendio a reconocer, no solo las que salieron en la
  // metrica: una clase con CERO ejemplos en validacion no aparece en `ap_por_clase`
  // y ES justo el caso que hay que poder ver — "no aprendio esto en absoluto" es
  // distinto de "aprendio esto pero le cuesta".
  const nombres = new Set(Object.keys(porClase));
  vocabulario?.forEach((c) => nombres.add(c.name));

  const filas = [...nombres]
    .map((nombre) => ({ nombre, ap: porClase[nombre] }))
    .sort((a, b) => (a.ap ?? -1) - (b.ap ?? -1));

  return (
    <ul className="flex flex-col gap-1">
      {filas.map(({ nombre, ap }) => {
        const previa = porClasePublicada?.[nombre];
        return (
          <li
            key={nombre}
            className="flex items-center justify-between gap-3 text-[length:var(--text-xs)]"
          >
            <span className="text-[var(--text-secondary)]">{nombre}</span>
            <span className="t-mono-xs flex items-center gap-2">
              {ap == null ? (
                <span className="text-[var(--text-warn)]">sin ejemplos en validacion</span>
              ) : (
                <span className={ap < 0.2 ? 'text-[var(--text-warn)]' : 'text-[var(--text-primary)]'}>
                  {ap.toFixed(3)}
                </span>
              )}
              {previa != null && ap != null && (
                <span className="text-[var(--text-faint)]">
                  ({ap >= previa ? '+' : ''}
                  {(ap - previa).toFixed(3)} vs publicada)
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FilaVersion({
  version,
  modeloId,
  publicada,
}: {
  version: ModelVersion;
  modeloId: string;
  publicada: ModelVersion | undefined;
}) {
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const siguientes = TRANSICIONES_VALIDAS[version.status];
  const metricas = version.metrics ?? {};
  const map5095 = metricas['map50_95'];

  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] px-3 py-2.5 [background:var(--glass-1)]">
      <div className="flex items-center gap-3">
        <Badge tone={TONO_VERSION[version.status]} size="xs" glow={version.status === 'published'}>
          {version.status}
        </Badge>
        <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
          v{version.version} · {version.origin}
          {typeof map5095 === 'number' && (
            <span className="text-[var(--text-faint)]"> · mAP50-95 {map5095.toFixed(3)}</span>
          )}
        </span>
        <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
          {new Date(version.created_at).toLocaleString('es')}
        </span>
        <div className="flex items-center gap-1.5">
          {siguientes.map((destino) => (
            <BotonTransicion key={destino} version={version} destino={destino} modeloId={modeloId} />
          ))}
        </div>
      </div>
      <p className="t-mono-xs text-[var(--text-faint)]">{MENSAJE_ESTADO_VERSION[version.status]}</p>
      {version.failure_reason && (
        <p className="t-mono-xs text-[var(--text-warn)]">{version.failure_reason}</p>
      )}
      {version.metrics && (
        <button
          type="button"
          onClick={() => setDetalleAbierto(!detalleAbierto)}
          className="t-mono-xs flex items-center gap-1 self-start text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:underline"
        >
          <ChevronDown
            strokeWidth={1.5}
            className={cn('size-3 transition-transform', detalleAbierto && 'rotate-180')}
          />
          {detalleAbierto ? 'ocultar metricas por clase' : 'ver metricas por clase'}
        </button>
      )}
      {detalleAbierto && <DesgloseClases version={version} publicada={publicada} />}
    </li>
  );
}

function BotonTransicion({
  version,
  destino,
  modeloId,
}: {
  version: ModelVersion;
  destino: ModelVersionStatus;
  modeloId: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const transicionar = useTransitionVersion(modeloId);
  const { etiqueta, variante } = ETIQUETA_TRANSICION[destino];
  const pideMotivo = destino === 'failed' || destino === 'archived';

  if (!confirmando) {
    return (
      <Button variant="ghost" size="xs" onClick={() => setConfirmando(true)}>
        {etiqueta}
      </Button>
    );
  }

  const confirmar = () =>
    transicionar.mutate(
      {
        id: version.id,
        body: {
          to_status: destino,
          expected_lock: version.version_lock,
          ...(motivo.trim() ? { failure_reason: motivo.trim() } : {}),
        },
      },
      { onSuccess: () => setConfirmando(false) },
    );

  return (
    <div className="flex items-center gap-1.5">
      {pideMotivo && (
        <input
          type="text"
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="motivo (opcional)"
          className="h-7 w-40 rounded-[var(--radius-sm)] px-2 [background:var(--glass-2)] text-[length:var(--text-xs)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
        />
      )}
      <Button variant={variante} size="xs" loading={transicionar.isPending} onClick={confirmar}>
        Confirmar: {etiqueta.toLowerCase()}
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setConfirmando(false)}>
        <X className="size-3.5" strokeWidth={1.5} />
      </Button>
      {transicionar.error && (
        <span className="t-mono-xs text-[var(--text-warn)]">
          {transicionar.error instanceof Error ? transicionar.error.message : 'No se pudo cambiar'}
        </span>
      )}
    </div>
  );
}

/**
 * El modal para encolar. Los hiperparametros son OPCIONALES a proposito: sin
 * tocarlos, el servidor usa los del catalogo de la arquitectura —el modal solo
 * los enseña de referencia—, y quien sepa lo que hace puede pisarlos con JSON.
 */
function NuevoEntrenamientoModal({
  modelo,
  onCerrar,
}: {
  modelo: AiModel;
  onCerrar: () => void;
}) {
  const versiones = useDatasetVersions(modelo.project_id);
  const arquitecturas = useArchitectures();
  const encolar = useQueueTrainingRun(modelo.id);

  const arquitectura = arquitecturas.data?.find((a) => a.code === modelo.architecture_code);
  const esquema = (arquitectura?.hyperparam_schema ?? {}) as Record<string, HyperparamSpec>;
  const claves = Object.keys(esquema);

  const [datasetVersionId, setDatasetVersionId] = useState('');
  const [notas, setNotas] = useState('');
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, number>>({});
  const [hiperparametrosTexto, setHiperparametrosTexto] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  //  Los campos arrancan en los valores por defecto del catalogo — el modal los
  //  ENSEÑA, no los inventa. Se resincroniza solo la primera vez que el catalogo
  //  llega, para no pisar lo que el usuario ya haya tocado en un reintento.
  const clavesFirma = claves.join(',');
  useEffect(() => {
    if (!clavesFirma) return;
    setValores((actual) => {
      if (Object.keys(actual).length > 0) return actual;
      const iniciales: Record<string, number> = {};
      for (const k of claves) iniciales[k] = esquema[k]!.default;
      return iniciales;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavesFirma]);

  const opciones = versiones.data ?? [];

  const enviar = () => {
    let hyperparams: Record<string, unknown> | undefined;

    if (avanzadoAbierto && claves.length > 0) {
      hyperparams = valores;
    } else if (avanzadoAbierto) {
      const texto = hiperparametrosTexto.trim();
      if (texto) {
        try {
          hyperparams = JSON.parse(texto) as Record<string, unknown>;
          setJsonError(null);
        } catch {
          setJsonError('Eso no es JSON valido — revisa comas y llaves.');
          return;
        }
      }
    }

    encolar.mutate(
      {
        model_id: modelo.id,
        dataset_version_id: datasetVersionId,
        ...(hyperparams ? { hyperparams } : {}),
        ...(notas.trim() ? { notes: notas.trim() } : {}),
      },
      { onSuccess: onCerrar },
    );
  };

  return (
    <Modal
      abierto
      titulo="Nuevo entrenamiento"
      descripcion={`${modelo.name} · ${modelo.architecture_name ?? modelo.architecture_code}`}
      onCerrar={onCerrar}
      acciones={
        <>
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={encolar.isPending}
            disabled={!datasetVersionId}
            onClick={enviar}
          >
            Encolar
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-2">
        <span className="t-label">Version de dataset (congelada)</span>
        <select
          value={datasetVersionId}
          onChange={(e) => setDatasetVersionId(e.target.value)}
          disabled={versiones.isLoading}
          className="h-10 w-full rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
        >
          <option value="">
            {versiones.isLoading
              ? 'cargando…'
              : opciones.length === 0
                ? 'sin versiones congeladas todavia'
                : 'elige una'}
          </option>
          {opciones.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} · {v.image_count} imagenes · congelada{' '}
              {new Date(v.frozen_at).toLocaleDateString('es')}
            </option>
          ))}
        </select>
        <Link
          to={`/ai/projects/${modelo.project_id}/dataset-versions`}
          target="_blank"
          rel="noreferrer"
          className="t-mono-xs self-start text-[var(--text-accent)] hover:underline"
        >
          {opciones.length === 0
            ? 'Sin versiones congeladas todavia — congelar una →'
            : '¿Falta una version nueva? Congelarla →'}
        </Link>
      </label>

      <label className="flex flex-col gap-2">
        <span className="t-label">Notas (opcional)</span>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          placeholder="Por que este entrenamiento, que se espera de el"
          className="w-full resize-none rounded-[var(--radius-md)] px-3 py-2 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
        />
      </label>

      <button
        type="button"
        onClick={() => setAvanzadoAbierto(!avanzadoAbierto)}
        className="t-mono-xs self-start text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:underline"
      >
        {avanzadoAbierto ? '− ocultar' : '+ parametros avanzados'}
      </button>

      {avanzadoAbierto && claves.length > 0 && (
        <div className="flex flex-col gap-3">
          {claves.map((k) => {
            const spec = esquema[k]!;
            return (
              <label key={k} className="flex flex-col gap-2">
                <span className="t-label">
                  {k}
                  <span className="ml-2 font-normal text-[var(--text-faint)]">
                    por defecto {spec.default}
                    {spec.type !== 'enum' && spec.min != null && spec.max != null
                      ? ` · ${spec.min}–${spec.max}`
                      : ''}
                  </span>
                </span>
                {spec.type === 'enum' ? (
                  <select
                    value={valores[k] ?? spec.default}
                    onChange={(e) => setValores({ ...valores, [k]: Number(e.target.value) })}
                    className="h-10 w-full rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
                  >
                    {(spec.values ?? []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    value={valores[k] ?? spec.default}
                    min={spec.min}
                    max={spec.max}
                    step={spec.type === 'integer' ? 1 : 'any'}
                    onChange={(e) =>
                      setValores({ ...valores, [k]: e.target.value === '' ? spec.default : Number(e.target.value) })
                    }
                    className="h-10 w-full rounded-[var(--radius-md)] px-3 font-[family-name:var(--font-data)] [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
                  />
                )}
              </label>
            );
          })}
          <span className="t-mono-xs text-[var(--text-faint)]">
            Sin abrir esto, el entrenamiento usa estos mismos valores por defecto del
            catalogo de {modelo.architecture_name ?? modelo.architecture_code}.
          </span>
        </div>
      )}

      {avanzadoAbierto && claves.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="t-mono-xs text-[var(--text-faint)]">
            Esta arquitectura todavia no declara un catalogo de hiperparametros — se puede
            sobrescribir con JSON libre.
          </p>
          <label className="flex flex-col gap-2">
            <span className="t-label">Sobrescribir con JSON (opcional)</span>
            <textarea
              value={hiperparametrosTexto}
              onChange={(e) => {
                setHiperparametrosTexto(e.target.value);
                setJsonError(null);
              }}
              rows={4}
              placeholder='{"epochs": 30, "batch_size": 8}'
              spellCheck={false}
              className="w-full resize-none rounded-[var(--radius-md)] px-3 py-2 font-[family-name:var(--font-data)] text-[length:var(--text-xs)] [background:var(--glass-2)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
            />
            <span className="t-mono-xs text-[var(--text-faint)]">
              Vacio usa los valores por defecto del catalogo tal cual.
            </span>
          </label>
          {jsonError && <p className="t-small text-[var(--text-warn)]">{jsonError}</p>}
        </div>
      )}

      {encolar.error && (
        <p className="t-small text-[var(--text-warn)]">
          {encolar.error instanceof Error ? encolar.error.message : 'No se pudo encolar'}
        </p>
      )}
    </Modal>
  );
}

function Dato({
  k,
  v,
  bloqueado,
  derivado,
}: {
  k: string;
  v: string;
  bloqueado?: boolean;
  derivado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-label flex items-center gap-1.5">
        {k}
        {bloqueado && <Lock strokeWidth={1.5} className="size-3 text-[var(--text-faint)]" />}
        {derivado && (
          <span className="t-mono-xs text-[var(--text-faint)]" title="Derivado, solo lectura">
            ·
          </span>
        )}
      </dt>
      <dd
        className={
          bloqueado || derivado
            ? 'text-[length:var(--text-sm)] text-[var(--text-faint)]'
            : 'text-[length:var(--text-sm)] text-[var(--text-primary)]'
        }
      >
        {v}
      </dd>
    </div>
  );
}

function EditorVocabulario({
  modelId,
  congelado,
  actual,
  disponibles,
}: {
  modelId: string;
  congelado: boolean;
  actual: string[];
  disponibles: { id: string; name: string; color: string }[];
}) {
  const [orden, setOrden] = useState<string[]>(actual);
  const guardar = useReplaceVocabulary(modelId);

  // Se compara por CLAVE, no por identidad: `actual` es un array nuevo en cada
  // render de React Query aunque el contenido no cambie, y depender de el
  // reiniciaria el borrador del usuario en cada revalidacion.
  const claveActual = actual.join(',');

  // El servidor es la fuente: si el vocabulario cambia de verdad, el borrador se
  // resincroniza. `actual` queda fuera de las dependencias a proposito.
  useEffect(() => {
    setOrden(claveActual ? claveActual.split(',') : []);
  }, [claveActual]);

  // Tipo explicito: sin el, `new Map(arr.map(c => [c.id, c]))` infiere un array y no
  // una tupla, y el constructor de Map no lo acepta.
  const porId = new Map<string, { id: string; name: string; color: string }>(
    disponibles.map((c) => [c.id, c]),
  );
  const fuera = disponibles.filter((c) => !orden.includes(c.id));
  const cambiado = orden.join(',') !== claveActual;

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= orden.length) return;
    const copia = [...orden];
    const tmp = copia[i]!;
    copia[i] = copia[j]!;
    copia[j] = tmp;
    setOrden(copia);
  };

  return (
    <div className="flex flex-col gap-4">
      {orden.length === 0 && (
        <p className="t-small text-[var(--text-secondary)]">
          Sin vocabulario. Anade las clases que este modelo debe aprender.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {orden.map((id, i) => {
          const c = porId.get(id);
          return (
            <li
              key={id}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 [background:var(--glass-1)]"
            >
              <span className="t-mono-xs w-5 shrink-0 text-[var(--icon-accent)]">{i}</span>
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-[3px]"
                style={{ background: c?.color ?? '#666' }}
              />
              <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                {c?.name ?? id.slice(0, 8)}
              </span>
              {!congelado && (
                <>
                  <Button variant="ghost" size="xs" iconOnly aria-label="Subir" onClick={() => mover(i, -1)}>
                    <ArrowUp strokeWidth={1.5} className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="xs" iconOnly aria-label="Bajar" onClick={() => mover(i, 1)}>
                    <ArrowDown strokeWidth={1.5} className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setOrden(orden.filter((x) => x !== id))}
                  >
                    Quitar
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ol>

      {!congelado && fuera.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-label">Anadir:</span>
          {fuera.map((c) => (
            <Button key={c.id} variant="ghost" size="xs" onClick={() => setOrden([...orden, c.id])}>
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-[2px]"
                style={{ background: c.color }}
              />
              {c.name}
            </Button>
          ))}
        </div>
      )}

      {congelado ? (
        <Badge tone="neutral" size="sm">
          congelado por las versiones existentes
        </Badge>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            loading={guardar.isPending}
            disabled={!cambiado || orden.length === 0}
            onClick={() => guardar.mutate(orden)}
          >
            <Save strokeWidth={1.5} className="size-4" />
            Guardar vocabulario
          </Button>
          {cambiado && (
            <span className="t-mono-xs text-[var(--text-faint)]">reemplazo completo</span>
          )}
        </div>
      )}

      {guardar.error && (
        <p className="t-small text-[var(--text-warn)]">
          {guardar.error instanceof Error ? guardar.error.message : 'No se pudo guardar'}
        </p>
      )}
    </div>
  );
}
