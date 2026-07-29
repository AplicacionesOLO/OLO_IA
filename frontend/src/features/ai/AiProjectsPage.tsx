/**
 * Lista de proyectos de IA y creacion.
 *
 * Primera pantalla real del modulo: si `is_platform_owner` es false el backend
 * responde 403 en todo, asi que la pantalla lo dice en lugar de mostrar una lista
 * vacia sin explicacion.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Plus, Search } from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { Button } from '../../design/primitives/Button';
import { CanvasHost } from '../../shell/CanvasHost';
import { useCreateProject, useProjects } from './useAi';
import { NotOwnerNotice } from './NotOwnerNotice';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function aSlug(nombre: string): string {
  return (
    nombre
      .toLowerCase()
      .normalize('NFD')
      // `\p{Diacritic}` y no un rango de caracteres combinantes crudos: en el
      // fuente esos caracteres son invisibles y cualquier reformateo los rompe.
      //
      // Y el orden importa: hay que quitarlos ANTES del filtro siguiente. Si no,
      // «Jesús Pérez» daria «jesu-s-p-erez», porque tras el NFD cada marca es un
      // caracter no alfanumerico y se convertiria en un guion.
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
  );
}

export function AiProjectsPage() {
  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);
  const [busqueda, setBusqueda] = useState('');
  const [creando, setCreando] = useState(false);

  const { data, isLoading, error } = useProjects(busqueda || undefined);

  if (!esOwner) return <NotOwnerNotice />;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="t-label text-[var(--text-faint)]">PLATAFORMA</span>
            <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              Proyectos de IA
            </h1>
          </div>
          <Button variant="primary" onClick={() => setCreando((v) => !v)}>
            <Plus strokeWidth={1.5} className="size-4" />
            Nuevo proyecto
          </Button>
        </div>

        <label className="flex h-11 max-w-[420px] items-center gap-3 rounded-[var(--radius-md)] px-4 [background:var(--glass-2)] shadow-[var(--rim-1)]">
          <Search strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o slug"
            className="w-full bg-transparent text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </label>

        {creando && <FormularioProyecto onListo={() => setCreando(false)} />}

        {error && (
          <Panel level="work" radius="lg" pad="md">
            <p className="t-small text-[var(--state-alert)]">
              {error instanceof Error ? error.message : 'No se pudieron cargar los proyectos'}
            </p>
          </Panel>
        )}

        {isLoading && <p className="t-small text-[var(--text-faint)]">Cargando…</p>}

        {data && data.items.length === 0 && !isLoading && (
          <Panel level="work" radius="lg" pad="lg">
            <p className="t-body text-[var(--text-secondary)]">
              Todavia no hay proyectos. Un proyecto agrupa un pool de imagenes, un
              vocabulario de clases y varios modelos que se entrenan sobre ellos.
            </p>
          </Panel>
        )}

        <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
          {data?.items.map((p) => (
            <Panel
              key={p.id}
              level="work"
              radius="lg"
              pad="md"
              interactive
              className="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <Link to={`/ai/projects/${p.id}`} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Boxes
                      strokeWidth={1.5}
                      className="size-5 shrink-0 text-[var(--icon-accent)]"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[length:var(--text-md)] text-[var(--text-primary)]">
                        {p.name}
                      </p>
                      <p className="t-mono-xs truncate text-[var(--text-faint)]">{p.slug}</p>
                    </div>
                  </div>
                  <Badge tone={p.status === 'published' ? 'measured' : 'neutral'} size="sm">
                    {p.status}
                  </Badge>
                </div>
                {p.description && (
                  <p className="t-small line-clamp-2 text-[var(--text-secondary)]">
                    {p.description}
                  </p>
                )}
                <p className="t-mono-xs text-[var(--text-faint)]">
                  {p.frame_interval_seconds} s/frame · max {p.max_frames_per_video} frames
                </p>
              </Link>
            </Panel>
          ))}
        </div>
      </div>
    </CanvasHost>
  );
}

function FormularioProyecto({ onListo }: { onListo: () => void }) {
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const crear = useCreateProject();

  // El slug se propone desde el nombre pero se puede editar: es la referencia
  // estable en las rutas, y renombrar el proyecto no deberia cambiarla.
  const slugFinal = slug || aSlug(nombre);
  const slugValido = SLUG_RE.test(slugFinal) && slugFinal.length >= 2;

  return (
    <Panel level="decision" radius="lg" pad="md">
      <PanelHeader title="Nuevo proyecto" subtitle="Agrupa imagenes, clases y modelos" />
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!slugValido) return;
          crear.mutate(
            {
              name: nombre.trim(),
              slug: slugFinal,
              ...(descripcion.trim() ? { description: descripcion.trim() } : {}),
            },
            { onSuccess: onListo },
          );
        }}
      >
        <Campo label="Nombre" value={nombre} onChange={setNombre} autoFocus />
        <Campo
          label="Slug"
          value={slugFinal}
          onChange={setSlug}
          hint={slugValido ? undefined : 'Minusculas, digitos y guiones. Al menos 2 caracteres.'}
        />
        <Campo label="Descripcion" value={descripcion} onChange={setDescripcion} />

        {crear.error && (
          <p className="t-small text-[var(--state-alert)]">
            {crear.error instanceof Error ? crear.error.message : 'No se pudo crear'}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={crear.isPending}
            disabled={!nombre.trim() || !slugValido}
          >
            Crear
          </Button>
          <Button variant="ghost" onClick={onListo}>
            Cancelar
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function Campo({
  label,
  value,
  onChange,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  // `| undefined` explicito: con `exactOptionalPropertyTypes` un `hint?: string`
  // no acepta `hint={undefined}`, y aqui se pasa condicionalmente.
  hint?: string | undefined;
  autoFocus?: boolean | undefined;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="t-label">{label}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-[var(--radius-md)] px-4 [background:var(--glass-2)] text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]"
      />
      {hint && <span className="t-mono-xs text-[var(--state-alert)]">{hint}</span>}
    </label>
  );
}
