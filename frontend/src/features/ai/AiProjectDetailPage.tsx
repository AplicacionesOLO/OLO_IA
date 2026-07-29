/**
 * Detalle de un proyecto: sus clases y sus modelos.
 *
 * Las dos cosas en una pantalla porque el flujo real las encadena: se definen las
 * clases y despues se crea el modelo que las consume.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Cpu, Images, Plus } from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { Button } from '../../design/primitives/Button';
import type { AiInputType, AiTask } from '../../lib/aiTypes';
import { CanvasHost } from '../../shell/CanvasHost';
import { Campo } from './AiProjectsPage';
import { NotOwnerNotice } from './NotOwnerNotice';
import {
  useArchitectures,
  useClasses,
  useCreateClass,
  useCreateModel,
  useModels,
  useProject,
  useUpdateClass,
} from './useAi';

export function AiProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);

  const proyecto = useProject(projectId);
  const clases = useClasses(projectId);
  const modelos = useModels(projectId);

  if (!esOwner) return <NotOwnerNotice />;
  if (proyecto.isLoading) {
    return (
      <CanvasHost mode="grid">
        <p className="t-small text-[var(--text-faint)]">Cargando…</p>
      </CanvasHost>
    );
  }
  if (proyecto.error || !proyecto.data) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="lg" pad="md">
          <p className="t-small text-[var(--state-alert)]">
            {proyecto.error instanceof Error ? proyecto.error.message : 'Proyecto no encontrado'}
          </p>
        </Panel>
      </CanvasHost>
    );
  }

  const p = proyecto.data;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <Link to="/ai/projects" className="t-mono-xs text-[var(--text-faint)] hover:underline">
            ← Proyectos
          </Link>
          <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight text-[var(--text-primary)]">
            {p.name}
          </h1>
          <p className="t-mono-xs text-[var(--text-faint)]">
            {p.slug} · {p.status} · v{p.version}
          </p>
          <Link to={`/ai/projects/${p.id}/dataset`} className="mt-3 inline-block">
            <Button variant="secondary" size="sm">
              <Images strokeWidth={1.5} className="size-4" />
              Dataset
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
          {/* ── Clases ─────────────────────────────────────────────────── */}
          <Panel
            level="work"
            radius="xl"
            pad="md"
            className="col-span-12 flex flex-col gap-4 xl:col-span-5"
          >
            <PanelHeader
              title="Clases"
              subtitle="Vocabulario del proyecto. El indice lo asigna el servidor."
            />
            {clases.data && clases.data.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {clases.data.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 [background:var(--glass-1)]"
                  >
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-[3px]"
                      style={{ background: c.color }}
                    />
                    <span className="t-mono-xs w-6 shrink-0 text-[var(--text-faint)]">
                      {c.class_index}
                    </span>
                    <span
                      className={
                        c.is_active
                          ? 'flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]'
                          : 'flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-faint)] line-through'
                      }
                    >
                      {c.name}
                    </span>
                    <BotonActivar clase={c} projectId={projectId!} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-small text-[var(--text-secondary)]">
                Sin clases todavia. Son las etiquetas que los modelos aprenderan a detectar.
              </p>
            )}
            <FormularioClase projectId={projectId!} />
          </Panel>

          {/* ── Modelos ────────────────────────────────────────────────── */}
          <Panel
            level="work"
            radius="xl"
            pad="md"
            className="col-span-12 flex flex-col gap-4 xl:col-span-7"
          >
            <PanelHeader
              title="Modelos"
              subtitle="Varios modelos comparten las mismas imagenes y clases"
            />
            {modelos.data && modelos.data.items.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {modelos.data.items.map((m) => (
                  <li key={m.id}>
                    <Link
                      to={`/ai/models/${m.id}`}
                      className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-3 [background:var(--glass-1)] hover:[background:var(--glass-2)]"
                    >
                      <Cpu
                        strokeWidth={1.5}
                        className="size-4 shrink-0 text-[var(--icon-accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                          {m.name}
                        </p>
                        <p className="t-mono-xs truncate text-[var(--text-faint)]">
                          {m.architecture_code} · {m.task} · {m.framework_name ?? m.framework_code}
                        </p>
                      </div>
                      {m.published_version_id ? (
                        <Badge tone="measured" size="sm">
                          publicado
                        </Badge>
                      ) : (
                        <Badge tone="neutral" size="sm">
                          {m.version_count ?? 0} versiones
                        </Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-small text-[var(--text-secondary)]">Sin modelos todavia.</p>
            )}
            <FormularioModelo projectId={projectId!} />
          </Panel>
        </div>
      </div>
    </CanvasHost>
  );
}

function BotonActivar({
  clase,
  projectId,
}: {
  clase: { id: string; is_active: boolean; version: number };
  projectId: string;
}) {
  const actualizar = useUpdateClass(projectId);
  return (
    <Button
      variant="ghost"
      size="xs"
      loading={actualizar.isPending}
      onClick={() =>
        actualizar.mutate({
          id: clase.id,
          body: { is_active: !clase.is_active },
          version: clase.version,
        })
      }
    >
      {clase.is_active ? 'Desactivar' : 'Activar'}
    </Button>
  );
}

function FormularioClase({ projectId }: { projectId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('#FF8800');
  const crear = useCreateClass(projectId);

  if (!abierto) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        <Plus strokeWidth={1.5} className="size-4" />
        Anadir clase
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-md)] p-3 [background:var(--glass-1)]"
      onSubmit={(e) => {
        e.preventDefault();
        crear.mutate(
          { name: nombre.trim(), color },
          {
            onSuccess: () => {
              setNombre('');
              setAbierto(false);
            },
          },
        );
      }}
    >
      <Campo label="Nombre de la clase" value={nombre} onChange={setNombre} autoFocus />
      <label className="flex items-center gap-3">
        <span className="t-label">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value.toUpperCase())}
          className="h-8 w-14 cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent"
        />
        <span className="t-mono-xs text-[var(--text-faint)]">{color}</span>
      </label>
      {crear.error && (
        <p className="t-small text-[var(--state-alert)]">
          {crear.error instanceof Error ? crear.error.message : 'No se pudo crear'}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={crear.isPending} disabled={!nombre.trim()}>
          Crear
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

const TAREAS: AiTask[] = [
  'detect',
  'segment',
  'classify',
  'ocr',
  'track',
  'pose',
  'count',
  'regress',
  'embed',
];

function FormularioModelo({ projectId }: { projectId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tarea, setTarea] = useState<AiTask>('detect');
  const [arquitectura, setArquitectura] = useState('');
  const [entrada, setEntrada] = useState<AiInputType>('image');

  // El catalogo se filtra por tarea: solo se ofrecen arquitecturas que la soportan,
  // asi que la combinacion imposible no es elegible.
  const arquitecturas = useArchitectures(tarea);
  const crear = useCreateModel(projectId);

  const elegida = arquitecturas.data?.find((a) => a.code === arquitectura);
  const entradas = elegida?.supported_input_types ?? ['image'];

  if (!abierto) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        <Plus strokeWidth={1.5} className="size-4" />
        Anadir modelo
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-md)] p-3 [background:var(--glass-1)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!arquitectura) return;
        crear.mutate(
          {
            name: nombre.trim(),
            slug: nombre.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            architecture_code: arquitectura,
            task: tarea,
            input_type: entrada,
          },
          {
            onSuccess: () => {
              setNombre('');
              setArquitectura('');
              setAbierto(false);
            },
          },
        );
      }}
    >
      <Campo label="Nombre del modelo" value={nombre} onChange={setNombre} autoFocus />

      <Selector label="Tarea" value={tarea} onChange={(v) => { setTarea(v as AiTask); setArquitectura(''); }} opciones={TAREAS} />

      <Selector
        label="Arquitectura"
        value={arquitectura}
        onChange={setArquitectura}
        opciones={(arquitecturas.data ?? []).map((a) => a.code)}
        placeholder={arquitecturas.isLoading ? 'Cargando…' : 'Elige una'}
      />

      {elegida && (
        <p className="t-mono-xs text-[var(--text-faint)]">
          {elegida.framework_code} · {elegida.requires_training ? 'entrena' : 'zero-shot'}
          {elegida.min_images_recommended
            ? ` · ${elegida.min_images_recommended}+ imagenes recomendadas`
            : ''}
          {Object.keys(elegida.hyperparam_schema).length === 0
            ? ' · hiperparametros pendientes de verificar'
            : ''}
        </p>
      )}

      {elegida && entradas.length > 1 && (
        <Selector
          label="Tipo de entrada"
          value={entrada}
          onChange={(v) => setEntrada(v as AiInputType)}
          opciones={entradas}
        />
      )}

      {crear.error && (
        <p className="t-small text-[var(--state-alert)]">
          {crear.error instanceof Error ? crear.error.message : 'No se pudo crear'}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={crear.isPending}
          disabled={!nombre.trim() || !arquitectura}
        >
          Crear
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function Selector({
  label,
  value,
  onChange,
  opciones,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opciones: readonly string[];
  placeholder?: string | undefined;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="t-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-[var(--radius-md)] px-3 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
