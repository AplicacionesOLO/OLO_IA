/**
 * DIRECTO DEL DRON — todo el vuelo en vivo desde la app, sin consola.
 *
 * Tres pasos numerados, cada uno con su estado en verde/gris, y abajo el directo que se
 * está analizando con sus dos acciones: ver las lecturas y terminarlo. El directo se
 * ABRE SOLO cuando el dron empieza a transmitir (hook del servidor de video), así que
 * aquí no hay botón de «abrir»: hay que transmitir.
 *
 * Los datos salen de `GET /perception/live/station`, refrescado cada 3 s.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Radio, Square, Video } from 'lucide-react';
import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { ApiError } from '../../../lib/apiErrors';
import { useFinishLive, useLiveStation } from '../usePerception';

function Paso({
  n,
  hecho,
  titulo,
  children,
}: {
  n: number;
  hecho: boolean;
  titulo: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full t-mono-xs"
        style={{
          background: hecho
            ? 'color-mix(in oklab, var(--state-ok, #22c55e) 22%, transparent)'
            : 'color-mix(in oklab, var(--text-faint) 18%, transparent)',
          color: hecho ? 'var(--state-ok, #22c55e)' : 'var(--text-faint)',
        }}
      >
        {hecho ? <Check strokeWidth={2} className="size-3.5" /> : n}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">{titulo}</span>
        {children}
      </div>
    </li>
  );
}

function hora(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
}

export function DirectoDronPanel() {
  const estacion = useLiveStation();
  const terminar = useFinishLive();
  const [copiada, setCopiada] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const e = estacion.data;
  if (!e) return null;

  const url = e.rtmpUrls[0] ?? null;
  const emitiendo = e.droneStreaming === true;
  const activo = e.activeLive;

  const copiar = (u: string) => {
    void navigator.clipboard?.writeText(u).then(() => {
      setCopiada(u);
      window.setTimeout(() => setCopiada(null), 2000);
    });
  };

  const onTerminar = () => {
    if (!activo) return;
    if (!window.confirm(`¿Terminar «${activo.name}»? Se conserva todo lo leído.`)) return;
    setError(null);
    terminar.mutate(activo.id, {
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'No se pudo terminar el directo.'),
    });
  };

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio
            strokeWidth={1.5}
            className={emitiendo ? 'size-4 animate-pulse text-[var(--state-alert)]' : 'size-4 text-[var(--text-faint)]'}
          />
          <span className="text-[length:var(--text-base)] text-[var(--text-primary)]">
            Directo del dron
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {emitiendo ? `· transmitiendo desde ${hora(e.droneSince)}` : '· esperando al dron'}
          </span>
        </div>
        {emitiendo && (
          <a href={e.watchUrl} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="xs">
              <Video strokeWidth={1.5} className="size-3.5" />
              Ver video
            </Button>
          </a>
        )}
      </div>

      {!e.serverOn ? (
        <p className="t-small text-[var(--text-warn)]">
          {e.mode === 'nube'
            ? 'El servidor de video en la nube no responde. Esta tarjeta se actualiza sola en cuanto vuelva.'
            : 'El servidor de video local no está encendido en esta PC.'}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {e.mode === 'nube' ? (
            //  En la nube el dron transmite por internet: no hay «misma WiFi» que cuidar.
            <Paso n={1} hecho titulo="Enciende el control con internet (cualquier WiFi o los datos del celular)">
              <span className="t-mono-xs text-[var(--text-faint)]">
                El video va por internet al servidor de OLO_IA: funciona desde cualquier red.
              </span>
            </Paso>
          ) : (
            <Paso n={1} hecho={Boolean(e.wifi)} titulo="Conecta el control a la misma WiFi que esta PC">
              <span className="t-mono-xs text-[var(--text-accent)]">{e.wifi ?? 'WiFi no detectada'}</span>
            </Paso>
          )}
          <Paso
            n={2}
            hecho={emitiendo}
            titulo="En DJI Fly: Transmisión en vivo → RTMP personalizado, y pega esta URL"
          >
            {url ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="t-mono-xs rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-primary)] [background:color-mix(in_oklab,var(--text-faint)_12%,transparent)]">
                  {url}
                </code>
                <Button variant="ghost" size="xs" onClick={() => copiar(url)}>
                  {copiada === url ? (
                    <Check strokeWidth={1.5} className="size-3.5" />
                  ) : (
                    <Copy strokeWidth={1.5} className="size-3.5" />
                  )}
                  {copiada === url ? 'Copiada' : 'Copiar'}
                </Button>
              </div>
            ) : (
              <span className="t-mono-xs text-[var(--text-warn)]">Esta PC no tiene IP de red</span>
            )}
          </Paso>
          <Paso n={3} hecho={Boolean(activo)} titulo="Inicia la transmisión: el directo se abre solo">
            <span className="t-mono-xs text-[var(--text-faint)]">
              {activo
                ? 'Analizando en vivo los huecos vacíos y las ubicaciones.'
                : emitiendo
                  ? 'Dron transmitiendo; abriendo el directo…'
                  : 'Cuando el dron transmita, aparece aquí abajo.'}
            </span>
            {/* El worker dedicado nace al conectar el dron: antes de eso no hay que avisar. */}
            {activo && !e.workerAlive && (
              <span className="t-mono-xs text-[var(--text-warn)]">
                El directo está abierto pero ningún worker lo está analizando.
              </span>
            )}
          </Paso>
        </ol>
      )}

      {/*
        LA CALIDAD CON LA QUE LLEGA. No se puede fijar desde aquí: la elige DJI Fly en el
        control, que no acepta órdenes externas. Sí se mide y se dice qué tocar. A 720p el
        QR del larguero salía de ~85×45 px y no se leyó ninguno (directo del 24/11).
      */}
      {emitiendo && e.videoHeight !== null && (
        <p
          className={
            e.lowQuality
              ? 't-mono-xs text-[var(--text-warn)]'
              : 't-mono-xs text-[var(--text-faint)]'
          }
        >
          {e.lowQuality
            ? `Calidad: llega a ${e.videoWidth}×${e.videoHeight}. Las etiquetas QR casi no se leen así: en DJI Fly → Transmisión en vivo → Calidad, elige 1080p, y detén e inicia la transmisión para que se aplique.`
            : `Calidad: ${e.videoWidth}×${e.videoHeight} ✓`}
        </p>
      )}

      {activo && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 [background:color-mix(in_oklab,var(--state-alert)_8%,transparent)]">
          <div className="flex flex-col">
            <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">{activo.name}</span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              {activo.detectionCount} lecturas · {activo.framesProcessed} fotogramas vistos
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/perception/jobs/${activo.id}`}>
              <Button variant="secondary" size="sm">Ver lecturas</Button>
            </Link>
            <Button variant="ghost" size="sm" disabled={terminar.isPending} onClick={onTerminar}>
              <Square strokeWidth={1.5} className="size-3.5" />
              {terminar.isPending ? 'Terminando…' : 'Terminar directo'}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="t-mono-xs text-[var(--text-warn)]">{error}</p>}
    </Panel>
  );
}
