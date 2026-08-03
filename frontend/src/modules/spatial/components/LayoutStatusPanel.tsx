/**
 * ESTADO DEL PLANO VISUAL — la capa local, no el backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE PANEL EXISTE
 *
 * El plano visual y la geometria metrica son dos ausencias DISTINTAS, y sin
 * separarlas la pantalla no puede decir la verdad:
 *
 *   · «No se ha configurado el plano visual de este almacen» — falta el layout
 *     LOCAL. Lo puede resolver el operador ahora mismo, cargando una imagen.
 *
 *   · «El catalogo esta disponible, pero el levantamiento metrico aun no existe»
 *     — falta `world_position` en la BASE. No lo resuelve nadie desde la UI:
 *     hace falta un importador CAD.
 *
 * Mezclarlas en un solo mensaje llevaria al operador a intentar arreglar lo que
 * no puede, o a no intentar lo que si.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AlertTriangle, ImageOff, Map as MapIcon, PencilRuler, Ruler } from 'lucide-react';
import { Link } from 'react-router-dom';

import { cn } from '../../../design/utils/cn';
import type { LayoutStatus } from '../repositories/LayoutRepository';

interface Props {
  status: LayoutStatus;
  /** Cuantos racks conoce el BACKEND, para comparar con los colocados. */
  backendRackCount: number | null;
  /** `withWorldGeometry` del resumen: 0 mientras no exista el importador CAD. */
  withWorldGeometry: number | null;
  className?: string;
}

export function LayoutStatusPanel({
  status,
  backendRackCount,
  withWorldGeometry,
  className,
}: Props) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* ── Capa 1 · el plano local ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="t-label">Plano visual</span>

        {!status.exists ? (
          <Fila
            icon={<MapIcon strokeWidth={1.5} className="size-3.5" />}
            texto="No se ha configurado el plano visual de este almacen."
            nota="Se configura desde el editor de plano. Es local a este navegador."
          />
        ) : (
          <>
            <Fila
              icon={<MapIcon strokeWidth={1.5} className="size-3.5" />}
              texto={`${status.positionedRackCount} de ${
                backendRackCount ?? '—'
              } racks colocados`}
              nota={
                status.updatedAt
                  ? `actualizado ${formatFecha(status.updatedAt)} · almacenado en este navegador`
                  : 'almacenado en este navegador'
              }
            />

            {/*
              La imagen puede faltar aunque la geometria este guardada:
              `localStorage` ronda los 5 MB y un plano grande no entra. Decirlo es
              mejor que mostrar un lienzo vacio sin explicacion.
            */}
            {!status.imageStored && (
              <Fila
                icon={<ImageOff strokeWidth={1.5} className="size-3.5" />}
                tono="alert"
                texto="La imagen del plano no se pudo guardar."
                nota={
                  status.storageError ??
                  'El navegador limita el almacenamiento local a unos 5 MB. Las posiciones de los racks si se guardaron.'
                }
              />
            )}

            {!status.calibrated && (
              <Fila
                icon={<AlertTriangle strokeWidth={1.5} className="size-3.5" />}
                tono="alert"
                texto="El plano no esta calibrado."
                nota="Sin calibracion las medidas son pixeles, no metros."
              />
            )}
          </>
        )}

        {/*
          El enlace al editor va AQUI y no solo en el menu: este panel es donde el
          operador descubre que falta el plano, y el sitio donde se arregla tiene
          que estar a un clic de donde se dice que falta.
        */}
        <Link
          to="/spatial/editor"
          className="flex w-fit items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--accent)] transition-opacity hover:opacity-80"
        >
          <PencilRuler strokeWidth={1.5} className="size-3.5" />
          {status.exists ? 'Editar el plano' : 'Configurar el plano'}
        </Link>
      </div>

      {/* ── Capa 2 · la geometria del BACKEND ───────────────────────────── */}
      <div className="flex flex-col gap-2 border-t border-[var(--hairline-strong)] pt-4">
        <span className="t-label">Levantamiento metrico</span>
        <Fila
          icon={<Ruler strokeWidth={1.5} className="size-3.5" />}
          texto={
            withWorldGeometry === 0 || withWorldGeometry == null
              ? 'El catalogo esta disponible, pero el levantamiento metrico aun no existe.'
              : `${withWorldGeometry.toLocaleString('es')} ubicaciones con geometria`
          }
          nota={
            withWorldGeometry === 0 || withWorldGeometry == null
              ? 'Ninguna ubicacion tiene coordenadas en metros. Llegara con el importador CAD.'
              : undefined
          }
        />
      </div>

      {/* ── Capa 3 · la ocupacion, que no es del espacio ────────────────── */}
      <div className="flex flex-col gap-2 border-t border-[var(--hairline-strong)] pt-4">
        <span className="t-label">Ocupacion</span>
        <Fila
          texto="La ocupacion en tiempo real estara disponible al integrar el inventario."
          nota="Lo que si hay es la situacion declarada por el WMS, con su fecha."
        />
      </div>
    </div>
  );
}

function Fila({
  icon,
  texto,
  nota,
  tono = 'normal',
}: {
  icon?: React.ReactNode;
  texto: string;
  nota?: string | undefined;
  tono?: 'normal' | 'alert';
}) {
  const color = tono === 'alert' ? 'var(--state-alert)' : 'var(--text-faint)';
  return (
    <div className="flex items-start gap-2">
      {icon && (
        <span className="mt-0.5 shrink-0" style={{ color }}>
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="text-[length:var(--text-xs)]"
          style={{ color: tono === 'alert' ? color : 'var(--text-secondary)' }}
        >
          {texto}
        </span>
        {nota && <span className="t-mono-xs text-[var(--text-faint)]">{nota}</span>}
      </div>
    </div>
  );
}

function formatFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
