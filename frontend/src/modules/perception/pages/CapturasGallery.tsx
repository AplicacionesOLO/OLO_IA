/**
 * CAPTURAS — los fotogramas que SÍ se subieron junto con una detección.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ES LO MISMO QUE EL REPRODUCTOR DE ARRIBA
 *
 * El reproductor muestra el vídeo u origen ENTERO, cuando existe. Pero un
 * dispositivo de borde (el prototipo S21, o un dron con inferencia embarcada)
 * no siempre sube el vídeo — sube el recorte del instante en que detectó algo,
 * vía `crop-prefix`/`crop-url` (0110). Para esos trabajos, `cropPath` en la
 * detección es la ÚNICA imagen que existe: sin esta galería, «se detectó un
 * pallet» era una frase sin nada que mirar.
 *
 * Sirve para dos cosas a la vez, tal como se pidió: juzgar a ojo si el modelo
 * acertó, y mandar la captura a anotar sin pasar por `FramesToDatasetModal`
 * (que re-extrae fotogramas del VÍDEO -- estos trabajos no tienen video que
 * extraer, solo recortes ya subidos). Ver `link-detection-crop` en el backend
 * y `useVincularRecorte`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE DEDUPLICA POR RUTA
 *
 * Varias detecciones del mismo instante comparten el mismo fotograma subido
 * (`adjuntarFotogramaSiToca` en el S21 solo sube uno cada ~2s y lo reparte
 * entre todas las detecciones de ese lote). Pintar una tarjeta por detección
 * repetiría la misma imagen varias veces seguidas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA ELEGIR PROYECTO AQUÍ, Y NO HEREDARLO DEL TRABAJO
 *
 * `FramesToDatasetModal` resuelve el proyecto casando `job.config.modelVersionId`
 * contra el catálogo publicado. Un trabajo de un dispositivo de borde no corre
 * ningún modelo publicado por el backend -- el modelo ya corrió EN el teléfono
 * -- así que `modelVersionId` es `null` y esa casada nunca encuentra nada. Sin
 * un proyecto que ofrecer, la pantalla lo pregunta directamente.
 */

import { useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge } from '../../../design/primitives/Badge';
import { useProjects } from '../../../features/ai/useAi';
import type { Detection } from '../types';
import { useCropUrl, useVincularRecorte } from '../usePerception';

function agruparPorRuta(detecciones: Detection[]) {
  const porRuta = new Map<string, Detection[]>();
  for (const d of detecciones) {
    if (!d.cropPath) continue;
    const grupo = porRuta.get(d.cropPath);
    if (grupo) grupo.push(d);
    else porRuta.set(d.cropPath, [d]);
  }
  return [...porRuta.entries()].sort(
    (a, b) => (b[1][0]?.timestampMs ?? 0) - (a[1][0]?.timestampMs ?? 0),
  );
}

type EstadoEnvio = 'idle' | 'enviando' | 'enviado' | 'error';

function Captura({
  jobId,
  path,
  detecciones,
  onAmpliar,
  puedeAnotar,
  onEnviarAAnotar,
}: {
  jobId: string;
  path: string;
  detecciones: Detection[];
  onAmpliar: (url: string) => void;
  /** `false` mientras no haya un proyecto elegido: no tiene sentido ofrecer el boton. */
  puedeAnotar: boolean;
  onEnviarAAnotar: (path: string) => Promise<void>;
}) {
  const url = useCropUrl(jobId, path);
  const principal = detecciones[0];
  const [estado, setEstado] = useState<EstadoEnvio>('idle');
  if (!principal) return null;

  return (
    <div className="group relative flex flex-col gap-1.5 rounded-[var(--radius-md)] bg-[var(--surface-recessed)] p-1.5">
      <button
        type="button"
        disabled={!url.data}
        onClick={() => url.data && onAmpliar(url.data)}
        className="flex flex-col gap-1.5 text-left disabled:cursor-default"
      >
        <div className="relative aspect-video overflow-hidden rounded-[var(--radius-sm)] bg-black/40">
          {url.data ? (
            <img
              src={url.data}
              alt={`Captura con ${principal.className}`}
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
            />
          ) : url.isError ? (
            <div className="flex h-full items-center justify-center t-mono-xs text-[var(--text-faint)]">
              Sin acceso
            </div>
          ) : (
            <div className="h-full w-full animate-pulse bg-[var(--surface-hover)]" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {detecciones.slice(0, 3).map((d) => (
            <Badge key={d.id} tone="measured" size="xs">
              {d.className} · {Math.round(d.confidence * 100)}%
            </Badge>
          ))}
          {detecciones.length > 3 && (
            <span className="t-mono-xs text-[var(--text-faint)]">+{detecciones.length - 3}</span>
          )}
        </div>
      </button>

      {puedeAnotar && (
        <button
          type="button"
          title={
            estado === 'enviado'
              ? 'Ya se mando a anotar'
              : estado === 'error'
                ? 'No se pudo mandar -- reintentar'
                : 'Mandar a anotar'
          }
          disabled={estado === 'enviando' || estado === 'enviado'}
          onClick={async (e) => {
            e.stopPropagation();
            setEstado('enviando');
            try {
              await onEnviarAAnotar(path);
              setEstado('enviado');
            } catch {
              setEstado('error');
            }
          }}
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100 disabled:opacity-100"
        >
          {estado === 'enviando' ? (
            <Loader2 strokeWidth={2} className="size-3.5 animate-spin" />
          ) : estado === 'enviado' ? (
            <Check strokeWidth={2} className="size-3.5 text-[var(--text-ok)]" />
          ) : (
            <Sparkles strokeWidth={1.75} className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

export function CapturasGallery({ jobId, detections }: { jobId: string; detections: Detection[] }) {
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const grupos = useMemo(() => agruparPorRuta(detections), [detections]);
  const proyectos = useProjects();
  const vincularRecorte = useVincularRecorte(projectId, jobId);

  if (grupos.length === 0) return null;

  return (
    <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-3">
      <PanelHeader
        title="Capturas"
        subtitle={`${grupos.length} fotograma${grupos.length === 1 ? '' : 's'} subido${grupos.length === 1 ? '' : 's'} por el dispositivo`}
        trailing={
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="h-[28px] rounded-[var(--radius-full)] border-0 bg-[var(--glass-2)] px-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
          >
            <option value="">Mandar a anotar en...</option>
            {(proyectos.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {grupos.map(([path, dets]) => (
          <Captura
            key={path}
            jobId={jobId}
            path={path}
            detecciones={dets}
            onAmpliar={setAmpliada}
            puedeAnotar={projectId !== null}
            onEnviarAAnotar={async (p) => {
              await vincularRecorte(p);
            }}
          />
        ))}
      </div>

      {ampliada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setAmpliada(null)}
        >
          <button
            type="button"
            className="absolute right-6 top-6 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            onClick={() => setAmpliada(null)}
          >
            <X strokeWidth={1.5} className="size-5" />
          </button>
          <img
            src={ampliada}
            alt="Captura ampliada"
            className="max-h-full max-w-full rounded-[var(--radius-md)] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Panel>
  );
}
