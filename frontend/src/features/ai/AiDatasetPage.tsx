/** Dataset de un proyecto: subir, listar, ver y borrar imagenes. */

import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ImageOff, PenTool, Snowflake, Trash2, Upload } from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { Button } from '../../design/primitives/Button';
import { MAX_BYTES_IMAGEN, MIME_IMAGEN } from '../../lib/aiTypes';
import type { AiImage, ImageStatus } from '../../lib/aiTypes';
import { CanvasHost } from '../../shell/CanvasHost';
import { NotOwnerNotice } from './NotOwnerNotice';
import { useProject } from './useAi';
import {
  useDeleteAsset,
  useImageCounts,
  useImages,
  useSetImageStatus,
  useSignedUrl,
  useUploadImages,
  type ResultadoSubida,
} from './useAiAssets';

const ESTADOS: ImageStatus[] = ['pending', 'annotated', 'validated', 'rejected', 'archived'];

export function AiDatasetPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);
  const [filtro, setFiltro] = useState<ImageStatus | undefined>(undefined);

  const proyecto = useProject(projectId);
  const imagenes = useImages(projectId, filtro);
  const recuentos = useImageCounts(projectId);

  if (!esOwner) return <NotOwnerNotice />;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <Link
            to={`/ai/projects/${projectId}`}
            className="t-mono-xs text-[var(--text-faint)] hover:underline"
          >
            ← {proyecto.data?.name ?? 'Proyecto'}
          </Link>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight text-[var(--text-primary)]">
              Dataset
            </h1>
            {/*
              El acceso al anotador va aqui y no en cada tarjeta: anotar es un
              recorrido por todas las imagenes, no una accion sobre una. El anotador
              lleva su propia navegacion anterior/siguiente.
            */}
            {(imagenes.data?.items.length ?? 0) > 0 && (
              <div className="flex items-center gap-2">
                <Link to={`/ai/projects/${projectId}/annotate`}>
                  <Button variant="primary" size="sm">
                    <PenTool strokeWidth={1.5} className="mr-1.5 size-3.5" />
                    Anotar
                  </Button>
                </Link>
                <Link to={`/ai/projects/${projectId}/dataset-versions`}>
                  <Button variant="secondary" size="sm">
                    <Snowflake strokeWidth={1.5} className="mr-1.5 size-3.5" />
                    Versiones
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        <ZonaSubida projectId={projectId!} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={filtro === undefined ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setFiltro(undefined)}
          >
            todas
          </Button>
          {ESTADOS.map((e) => (
            <Button
              key={e}
              variant={filtro === e ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setFiltro(e)}
            >
              {e} {recuentos.data?.[e] ?? 0}
            </Button>
          ))}
        </div>

        {imagenes.isLoading && <p className="t-small text-[var(--text-faint)]">Cargando…</p>}

        {imagenes.data && imagenes.data.items.length === 0 && !imagenes.isLoading && (
          <Panel level="work" radius="lg" pad="lg">
            <p className="t-body text-[var(--text-secondary)]">
              Sin imagenes todavia. Sube archivos para empezar a construir el dataset.
            </p>
          </Panel>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {imagenes.data?.items.map((img) => (
            <TarjetaImagen key={img.id} img={img} projectId={projectId!} />
          ))}
        </div>
      </div>
    </CanvasHost>
  );
}

function ZonaSubida({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [rechazados, setRechazados] = useState<string[]>([]);
  const subir = useUploadImages(projectId);
  const resultados = subir.data as ResultadoSubida[] | undefined;

  // Validacion en cliente para no gastar un viaje. El backend valida igualmente:
  // MIME y tamaño se comprueban tambien en `prepare` y en `confirm`.
  const elegir = (lista: FileList | null) => {
    if (!lista) return;
    const validos: File[] = [];
    const malos: string[] = [];
    for (const f of Array.from(lista)) {
      if (!MIME_IMAGEN.includes(f.type as (typeof MIME_IMAGEN)[number])) {
        malos.push(`${f.name}: tipo ${f.type || 'desconocido'} no admitido`);
      } else if (f.size > MAX_BYTES_IMAGEN) {
        malos.push(`${f.name}: supera 25 MB`);
      } else {
        validos.push(f);
      }
    }
    setRechazados(malos);
    if (validos.length > 0) subir.mutate(validos);
  };

  const fallidos = resultados?.filter((r) => !r.ok) ?? [];
  const correctos = resultados?.filter((r) => r.ok).length ?? 0;

  return (
    <Panel level="decision" radius="lg" pad="md">
      <PanelHeader title="Subir imagenes" subtitle="JPEG, PNG o WebP · hasta 25 MB cada una" />
      <div
        className="mt-4 flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[color-mix(in_oklab,var(--accent)_30%,transparent)] p-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          elegir(e.dataTransfer.files);
        }}
      >
        <Upload strokeWidth={1.5} className="size-6 text-[var(--icon-accent)]" />
        <p className="t-small text-[var(--text-secondary)]">
          Arrastra archivos aqui o elige varios
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={MIME_IMAGEN.join(',')}
          className="hidden"
          onChange={(e) => elegir(e.target.files)}
        />
        <Button variant="primary" size="sm" loading={subir.isPending} onClick={() => input.current?.click()}>
          Elegir archivos
        </Button>
      </div>

      {subir.isPending && (
        <p className="t-small mt-3 text-[var(--text-faint)]">
          Subiendo… no cierres la pestaña.
        </p>
      )}

      {correctos > 0 && !subir.isPending && (
        <p className="t-small mt-3 text-[var(--aqua-300)]">{correctos} imagen(es) subidas.</p>
      )}

      {(rechazados.length > 0 || fallidos.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1">
          {rechazados.map((m) => (
            <li key={m} className="t-mono-xs text-[var(--state-alert)]">
              {m}
            </li>
          ))}
          {fallidos.map((r) => (
            <li key={r.file.name} className="t-mono-xs text-[var(--state-alert)]">
              {r.file.name}: {r.error}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TarjetaImagen({ img, projectId }: { img: AiImage; projectId: string }) {
  const url = useSignedUrl(img.asset_id);
  const cambiar = useSetImageStatus(projectId);
  const borrar = useDeleteAsset(projectId);

  const anotaciones = img.annotation_count ?? 0;
  // Tres razones distintas para no poder borrar, y el titulo las distingue: un
  // boton gris sin explicacion se lee como un fallo de la aplicacion.
  const impedimento =
    img.asset_version === null
      ? 'Sin version del asset: recarga la pagina'
      : anotaciones > 0
        ? `Tiene ${anotaciones} anotacion(es). Borralas o archiva la imagen.`
        : null;

  // El backend puede haber retirado el metadato y no el binario. Se muestra: el
  // objeto sigue ocupando espacio y alguien tiene que saberlo.
  const huerfano =
    borrar.data && !borrar.data.storage_deleted ? borrar.data.orphaned_object_path : null;

  return (
    <Panel level="work" radius="md" pad="none" className="overflow-hidden">
      <div className="relative aspect-square [background:var(--glass-1)]">
        {url.data ? (
          <img
            src={url.data.url}
            alt={img.original_filename ?? 'imagen del dataset'}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageOff strokeWidth={1.5} className="size-5 text-[var(--text-faint)]" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <Badge tone={img.status === 'validated' ? 'measured' : 'neutral'} size="xs">
            {img.status}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2">
        <p className="t-mono-xs truncate text-[var(--text-faint)]">
          {img.original_filename ?? img.id.slice(0, 8)}
        </p>
        <div className="flex items-center gap-1">
          <select
            value={img.status}
            onChange={(e) =>
              cambiar.mutate({
                id: img.id,
                status: e.target.value as ImageStatus,
                // La version de la IMAGEN. El borrado usa `asset_version`.
                version: img.version,
              })
            }
            className="h-7 flex-1 rounded-[var(--radius-xs)] px-1.5 [background:var(--glass-2)] text-[length:var(--text-2xs)] text-[var(--text-primary)] outline-none"
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Borrar"
            title={impedimento ?? 'Borrar imagen y archivo'}
            loading={borrar.isPending}
            disabled={impedimento !== null}
            onClick={() => {
              if (img.asset_version === null || anotaciones > 0) return;
              borrar.mutate({ assetId: img.asset_id, assetVersion: img.asset_version });
            }}
          >
            <Trash2 strokeWidth={1.5} className="size-3.5" />
          </Button>
        </div>

        {anotaciones > 0 && (
          <p className="t-mono-xs text-[var(--text-faint)]">{anotaciones} anotacion(es)</p>
        )}

        {borrar.isError && (
          <p className="t-mono-xs text-[var(--state-alert)]">
            {borrar.error instanceof Error ? borrar.error.message : 'No se pudo borrar'}
          </p>
        )}

        {huerfano && (
          <p className="t-mono-xs break-all text-[var(--state-alert)]">
            Registro borrado, archivo no: {huerfano}
          </p>
        )}
      </div>
    </Panel>
  );
}
