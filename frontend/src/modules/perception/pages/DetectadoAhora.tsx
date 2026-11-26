/**
 * DETECTADO AHORA — la franja bajo el video de un directo.
 *
 * El video embebido llega tal cual del servidor, sin cajas encima, y dibujarlas
 * sincronizadas no es fiable: video y detecciones llegan con 1-3 s de desfase y las
 * cajas quedarian corridas. En su lugar, la FOTO de cada detección (el recorte que sube
 * el worker), con su clase y el código leído, se ve a los ~2 s de pasar por delante.
 * Sirve para saber, en pleno vuelo, si la etiqueta salió nítida o hay que acercarse.
 *
 * Las detecciones llegan del sondeo de la página (cada 2 s mientras el directo vive):
 * aquí no se pide nada nuevo salvo la URL firmada de cada foto, que se cachea.
 */
import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useCropUrl } from '../usePerception';
import type { Detection } from '../types';

/** Cuantas fotos caben en la franja. Las más recientes primero. */
const CUANTAS = 8;
/** Durante cuanto una detección se marca como «nueva». */
const NUEVA_MS = 6000;

/**
 * Lecturas REPETIDAS juntas. Con el dron quieto frente a un hueco, el worker manda la
 * misma lectura cada pocos segundos; sin juntarlas, las copias empujaban fuera de la
 * franja a todo lo demas y parecia que las detecciones «desaparecian» (vuelo 26/11).
 * Se juntan las de la misma clase y el mismo codigo separadas por menos de `JUNTAR_MS`.
 */
const JUNTAR_MS = 20_000;

interface Grupo {
  d: Detection;
  veces: number;
}

function agrupar(detecciones: Detection[]): Grupo[] {
  const orden = [...detecciones].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const grupos: Grupo[] = [];
  for (const d of orden) {
    const t = new Date(d.observedAt).getTime();
    const igual = grupos.find(
      (g) =>
        g.d.className === d.className &&
        (g.d.textValue ?? '') === (d.textValue ?? '') &&
        Math.abs(new Date(g.d.observedAt).getTime() - t) < JUNTAR_MS * g.veces,
    );
    if (igual) {
      igual.veces += 1;
      //  La foto: la mas reciente que tenga.
      if (!igual.d.cropPath && d.cropPath) igual.d = { ...igual.d, cropPath: d.cropPath };
    } else {
      grupos.push({ d, veces: 1 });
    }
  }
  return grupos;
}

function Tarjeta({
  jobId,
  d,
  veces,
  ahora,
}: {
  jobId: string;
  d: Detection;
  veces: number;
  ahora: number;
}) {
  const url = useCropUrl(jobId, d.cropPath);
  const edad = ahora - new Date(d.observedAt).getTime();
  const nueva = edad >= 0 && edad < NUEVA_MS;
  const segundos = Math.max(0, Math.round(edad / 1000));
  const cuando =
    segundos < 60 ? `hace ${segundos} s` : `hace ${Math.round(segundos / 60)} min`;

  return (
    <figure
      className="flex w-36 shrink-0 flex-col overflow-hidden rounded-[var(--radius-md)] [background:var(--glass-1)]"
      style={{
        outline: nueva ? `2px solid ${d.classColor}` : '1px solid transparent',
        outlineOffset: -1,
      }}
    >
      <div className="flex aspect-[4/3] items-center justify-center bg-black">
        {url.data ? (
          <a href={url.data} target="_blank" rel="noreferrer" className="size-full">
            <img
              src={url.data}
              alt={`${d.className} detectado`}
              className="size-full object-contain"
              loading="lazy"
            />
          </a>
        ) : (
          <ImageOff strokeWidth={1.5} className="size-5 text-[var(--text-faint)]" />
        )}
      </div>
      <figcaption className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="flex items-center gap-1.5 t-mono-xs text-[var(--text-primary)]">
          <span className="size-2 shrink-0 rounded-full" style={{ background: d.classColor }} />
          <span className="truncate">{d.className}</span>
        </span>
        <span
          className={
            d.textValue
              ? 't-mono-xs truncate text-[var(--text-accent)]'
              : 't-mono-xs truncate text-[var(--text-faint)]'
          }
          title={d.textValue ?? undefined}
        >
          {d.textValue ?? (d.className.startsWith('qr') ? 'código sin leer' : '—')}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {Math.round(d.confidence * 100)}% · {cuando}
          {veces > 1 ? ` · ×${veces}` : ''}
        </span>
      </figcaption>
    </figure>
  );
}

export function DetectadoAhora({ jobId, detecciones }: { jobId: string; detecciones: Detection[] }) {
  //  El reloj para «hace N s»: un tic por segundo, sin pedir nada al servidor.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const ultimas = agrupar(detecciones).slice(0, CUANTAS);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
          Detectado ahora
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {detecciones.length > 0
            ? `las ${ultimas.length} más recientes · se actualiza sola`
            : 'aún nada: apunta la cámara a una etiqueta o a un hueco'}
        </span>
      </div>
      {ultimas.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {ultimas.map((g) => (
            <Tarjeta key={g.d.id} jobId={jobId} d={g.d} veces={g.veces} ahora={ahora} />
          ))}
        </div>
      )}
    </div>
  );
}
