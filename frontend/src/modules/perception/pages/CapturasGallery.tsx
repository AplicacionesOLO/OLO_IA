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
 * acertó, y —más adelante— elegir cuáles de estas imágenes vale la pena meter
 * al dataset. Esto último no está conectado todavía: `FramesToDatasetModal`
 * re-extrae fotogramas del VÍDEO, no lee `cropPath`. Ver nota en el repositorio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE DEDUPLICA POR RUTA
 *
 * Varias detecciones del mismo instante comparten el mismo fotograma subido
 * (`adjuntarFotogramaSiToca` en el S21 solo sube uno cada ~2s y lo reparte
 * entre todas las detecciones de ese lote). Pintar una tarjeta por detección
 * repetiría la misma imagen varias veces seguidas.
 */

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge } from '../../../design/primitives/Badge';
import type { Detection } from '../types';
import { useCropUrl } from '../usePerception';

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

function Captura({
  jobId,
  path,
  detecciones,
  onAmpliar,
}: {
  jobId: string;
  path: string;
  detecciones: Detection[];
  onAmpliar: (url: string) => void;
}) {
  const url = useCropUrl(jobId, path);
  const principal = detecciones[0];
  if (!principal) return null;

  return (
    <button
      type="button"
      disabled={!url.data}
      onClick={() => url.data && onAmpliar(url.data)}
      className="group flex flex-col gap-1.5 rounded-[var(--radius-md)] bg-[var(--surface-recessed)] p-1.5 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-default"
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
  );
}

export function CapturasGallery({ jobId, detections }: { jobId: string; detections: Detection[] }) {
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const grupos = useMemo(() => agruparPorRuta(detections), [detections]);

  if (grupos.length === 0) return null;

  return (
    <Panel level="work" radius="xl" pad="md" className="col-span-12 flex flex-col gap-3">
      <PanelHeader
        title="Capturas"
        subtitle={`${grupos.length} fotograma${grupos.length === 1 ? '' : 's'} subido${grupos.length === 1 ? '' : 's'} por el dispositivo`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {grupos.map(([path, dets]) => (
          <Captura key={path} jobId={jobId} path={path} detecciones={dets} onAmpliar={setAmpliada} />
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
