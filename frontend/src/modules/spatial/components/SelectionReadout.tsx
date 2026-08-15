/**
 * LECTURA DE LA SELECCION — la linea de estado del operador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE, SI EL INSPECTOR YA MUESTRA ESTO
 *
 * Porque el inspector se puede colapsar y porque el operador trabaja mirando el
 * rack, no el panel derecho. Esta barra es el equivalente a la linea de estado de
 * una consola industrial: dice QUE esta seleccionado sin apartar la vista del rack.
 *
 * Y porque el hueco existe: un rack de 27 cuerpos y 7 niveles es un objeto de 6,9:1
 * dentro de un area de trabajo de 1,8:1. Encajado por ancho —que es lo que hay que
 * hacer para poder contar los cuerpos— deja mas de la mitad del alto sin usar. Esto
 * es lo que ocupa ese alto, y es informacion, no relleno.
 *
 * ── NO AÑADE NINGUNA CONSULTA ───────────────────────────────────────────────
 *
 * Consume el mismo `useLocationDetail()` que el inspector. Si la ubicacion ya esta
 * cargada, esto es cero red.
 *
 * ── LOS TRES CAMPOS QUE NO SE INVENTAN ──────────────────────────────────────
 *
 *   · nivel y posicion pueden ser `null` (codigo opaco): se dice «sin declarar»,
 *     no se pone 1;
 *   · la capacidad tiene TRES estados y «sin limite declarado» no es un numero;
 *   · el estado espacial y la situacion del WMS van SEPARADOS, porque en 2.365
 *     ubicaciones del catalogo real se contradicen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { MousePointerClick, ScanEye } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import { capacidadResumen } from './LocationDetail';
import { STATUS_META, situationDescription, situationLabel } from './StatusLegend';
import { INSPECTION_META } from '../inspection';
import type { LocationInspectionOverlay } from '../inspection';
import type { SpatialLocation } from '../types/index';

/**
 * LO QUE LA CAMARA VIO, FRENTE A LO QUE EL WMS DECLARA.
 *
 * ── POR QUE ESTO ESTABA EN OTRA PANTALLA ──────────────────────────────────────
 *
 * El visor sabia pintar la celda de un color por su estado de inspeccion, pero el pallet
 * concreto —el que ocupa el hueco— no se ensenaba en ningun sitio del mapa: habia que
 * irse a la tabla de reconciliacion, buscar la fila, y volver.
 *
 * Y ese es justo el momento en que hace falta: se esta mirando el rack, se elige una
 * celda, y la pregunta es «¿que hay aqui y que deberia haber?».
 *
 * Los dos codigos van SEPARADOS y con su etiqueta. Resumirlos en «coincide / no coincide»
 * ahorraria una linea y quitaria lo unico accionable: CUAL es el pallet que sobra.
 */
export function LecturaObservada({ ov }: { ov: LocationInspectionOverlay }) {
  const meta = INSPECTION_META[ov.inspectionStatus];
  const declarados = ov.expectedPalletCodes;
  const visto = ov.observedPalletCode;
  //  «Coincide» es que el leido este ENTRE los declarados, no que sea igual al primero:
  //  un hueco puede declarar dos lineas y la camara solo ve una.
  const cuadra = visto !== null && declarados.includes(visto);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] p-2 [background:var(--glass-2)]">
      <span className="flex items-center gap-1.5">
        <ScanEye strokeWidth={1.5} className="size-3.5" style={{ color: meta.color }} />
        <span className="t-label text-[var(--text-secondary)]">lo que se vio</span>
        <span className="t-mono-xs" style={{ color: meta.color }} title={meta.description}>
          {meta.label}
        </span>
        {ov.capturedAt && (
          <span className="t-mono-xs text-[var(--text-faint)]">
            {new Date(ov.capturedAt).toLocaleString('es-ES', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </span>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <dt className="t-label">pallet leido</dt>
          <dd
            className={cn(
              't-mono-xs',
              visto
                ? cuadra
                  ? 'text-[var(--text-ok)]'
                  : 'text-[var(--state-critical)]'
                : 'text-[var(--text-faint)]',
            )}
          >
            {/* Sin codigo NO se pone un guion a secas: «no se leyo» y «no habia nada»
                son cosas distintas, y el contenido observado es lo que las separa. */}
            {visto ?? (ov.inspectionStatus === 'verified_empty' ? 'nada, vacio' : 'no se leyo')}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="t-label">el WMS declara</dt>
          <dd
            className={cn(
              't-mono-xs',
              declarados.length > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
            )}
          >
            {declarados.length > 0 ? declarados.join(', ') : 'nada'}
          </dd>
        </div>
      </dl>

      <PruebaVisual ov={ov} />
    </div>
  );
}

/**
 * LAS TRES IMÁGENES: qué vio la cámara en este hueco.
 *
 * ── POR QUÉ TRES Y NO UNA FOTO DEL HUECO ──────────────────────────────────────
 *
 * Porque la lectura tiene tres ejes que fallan por separado, y una foto general no deja
 * ver cuál falló. Aquí cada imagen responde a una pregunta:
 *
 *     etiqueta del hueco   ¿de qué hueco hablamos?
 *     contenido            ¿qué hay dentro?
 *     etiqueta del pallet  ¿qué pallet concreto es?
 *
 * Y no son imágenes parecidas del mismo sitio: son los recortes de las TRES detecciones
 * que esta lectura usó para decidir. Si la lectura dice «22O0010471953» y la etiqueta de
 * la foto pone otra cosa, el fallo se ve sin volver al vídeo.
 *
 * ── CUANDO FALTA UNA, SE DICE POR QUÉ ─────────────────────────────────────────
 *
 * Un hueco de un análisis viejo —o de uno hecho con la casilla de guardar fotogramas
 * apagada— no tiene recortes. Un hueco de un análisis nuevo puede tener dos de tres si el
 * QR del pallet no se detectó. Son cosas distintas y el hueco vacío de la tercera no debe
 * leerse como «la cámara no vio nada».
 */
export function PruebaVisual({ ov }: { ov: LocationInspectionOverlay }) {
  const fotos = [
    { url: ov.cropLocationUrl, etiqueta: 'etiqueta del hueco' },
    { url: ov.cropContentUrl, etiqueta: 'contenido' },
    { url: ov.cropPalletUrl, etiqueta: 'etiqueta del pallet' },
  ];
  const hay = fotos.filter((f) => f.url).length;

  if (hay === 0) {
    return (
      <p className="t-mono-xs text-[var(--text-faint)]">
        Sin imágenes: este recorrido se analizó sin guardar los fotogramas.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="t-label text-[var(--text-secondary)]">lo que vio la cámara</span>
      <div className="flex flex-wrap gap-2">
        {fotos.map((f) => (
          <figure key={f.etiqueta} className="flex flex-col gap-1">
            {f.url ? (
              /* Abre el recorte a tamaño completo en otra pestaña: aquí es una tarjeta
                 para reconocer, y a veces hace falta mirar de cerca. */
              <a href={f.url} target="_blank" rel="noreferrer" title={f.etiqueta}>
                <img
                  src={f.url}
                  alt={f.etiqueta}
                  loading="lazy"
                  className="h-24 w-32 rounded-[var(--radius-xs)] object-cover shadow-[var(--rim-1)] transition-transform hover:scale-105"
                />
              </a>
            ) : (
              <div className="flex h-24 w-32 items-center justify-center rounded-[var(--radius-xs)] [background:var(--glass-1)]">
                <span className="t-mono-xs text-[var(--text-faint)]">no se detectó</span>
              </div>
            )}
            <figcaption className="t-mono-xs text-[var(--text-faint)]">{f.etiqueta}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function SelectionReadout({
  location,
  loading,
  hayId,
  inspeccion,
  className,
}: {
  location: SpatialLocation | undefined;
  loading: boolean;
  /** Si hay una ubicacion ELEGIDA. Distinto de tenerla ya cargada. */
  hayId: boolean;
  /** Lo ultimo que la camara vio en ESE hueco. `undefined` si nunca se inspecciono. */
  inspeccion?: LocationInspectionOverlay | undefined;
  className?: string;
}) {
  if (!hayId) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius-md)] px-4 py-3 [background:var(--glass-1)]',
          className,
        )}
      >
        <MousePointerClick strokeWidth={1.5} className="size-3.5 text-[var(--icon-muted)]" />
        <span className="t-mono-xs text-[var(--text-faint)]">
          Pulsa una celda del rack para leer su ubicacion. Doble clic la centra.
        </span>
      </div>
    );
  }

  if (loading || !location) {
    return (
      <div
        className={cn(
          'flex items-center rounded-[var(--radius-md)] px-4 py-3 [background:var(--glass-1)]',
          className,
        )}
      >
        <span className="t-mono-xs animate-pulse text-[var(--text-faint)]">
          Cargando la ubicacion…
        </span>
      </div>
    );
  }

  const meta = STATUS_META[location.status];
  const campos: [string, string][] = [
    ['rack', location.rackCode ?? '—'],
    ['cuerpo', location.bayCode ?? '—'],
    ['nivel', location.logicalLevel != null ? String(location.logicalLevel) : 'sin declarar'],
    [
      'posicion',
      location.logicalPosition != null ? String(location.logicalPosition) : 'sin declarar',
    ],
    ['codigo completo', location.code],
    ['forma', location.codeForm],
    ['origen', location.origin],
    ['capacidad', capacidadResumen(location.capacity)],
  ];

  return (
    <div
      className={cn(
        'flex flex-col gap-3 overflow-y-auto rounded-[var(--radius-md)] px-4 py-3',
        '[background:var(--glass-1)] shadow-[var(--rim-1)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="t-label">Seleccionado</span>
        <span className="t-mono-xs text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {location.code}
        </span>
        <span
          className="flex items-center gap-1.5 rounded-[var(--radius-full)] px-2 py-0.5"
          style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)` }}
          title={meta.description}
        >
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: meta.color }} />
          <span className="t-mono-xs text-[var(--text-secondary)]">{meta.label}</span>
        </span>
        <span
          className="rounded-[var(--radius-full)] px-2 py-0.5 [background:var(--glass-2)]"
          title={situationDescription(location.situation)}
        >
          <span className="t-mono-xs text-[var(--text-muted)]">
            WMS {situationLabel(location.situation)}
          </span>
        </span>
      </div>

      {inspeccion && <LecturaObservada ov={inspeccion} />}

      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {campos.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="t-label">{k}</dt>
            <dd
              className={cn(
                't-mono-xs',
                v === 'sin declarar' || v === '—'
                  ? 'text-[var(--text-faint)]'
                  : 'text-[var(--text-primary)]',
              )}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
