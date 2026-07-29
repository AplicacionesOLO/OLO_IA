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
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Lock, Save } from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { Button } from '../../design/primitives/Button';
import { CanvasHost } from '../../shell/CanvasHost';
import { NotOwnerNotice } from './NotOwnerNotice';
import { useClasses, useModel, useReplaceVocabulary, useVocabulary } from './useAi';

export function AiModelDetailPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);

  const modelo = useModel(modelId);
  const vocab = useVocabulary(modelId);
  const clases = useClasses(modelo.data?.project_id);

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
          <p className="t-small text-[var(--state-alert)]">
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
        </div>
      </div>
    </CanvasHost>
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
        <p className="t-small text-[var(--state-alert)]">
          {guardar.error instanceof Error ? guardar.error.message : 'No se pudo guardar'}
        </p>
      )}
    </div>
  );
}
