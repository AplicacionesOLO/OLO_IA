/**
 * RACK INSPECTOR — editor numerico de propiedades del rack seleccionado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE LOS CAMPOS TIENEN ESTADO PROPIO
 *
 * Antes el `value` del input salia directo del store, formateado: `rack.width
 * .toFixed(2)`. Cada pulsacion escribia en el store y el store devolvia el valor
 * REFORMATEADO, asi que teclear «12» era imposible: al pulsar «1» el campo pasaba
 * a «1.00» con el cursor al final, y el «2» aterrizaba en «1.002». Solo se podia
 * escribir un digito.
 *
 * Ahora cada campo mantiene su borrador mientras se escribe y solo confirma al
 * salir del campo o con Enter. Mientras el campo tiene el foco, el store NO lo
 * reformatea.
 *
 * Y `parseFloat('')` es `NaN`: escribirlo en el store metia un `NaN` en la
 * geometria y el rack desaparecia del plano sin explicacion. Los valores se
 * validan antes de confirmar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react';
import { Copy, Lock, RotateCw, Trash2, Unlock } from 'lucide-react';

import { cn } from '../../../../design/utils/cn';
import { useEditorStore } from '../store';
import { nuevoLayoutId, COLORES_RACK, COLOR_RACK_POR_DEFECTO } from '../types';

export function RackInspector() {
  const {
    racks, selectedRackId, selectedRackIds, updateRack, removeRack, addRack,
    recordAction, calibration,
  } = useEditorStore();
  const rack = racks.find((r) => r.layoutId === selectedRackId);

  // Con varios seleccionados manda `AlinearPanel`. Mostrar aqui los campos del
  // ultimo tocado invitaria a teclear una medida creyendo que aplica a los ocho.
  if (selectedRackIds.length > 1) return null;

  if (!rack) {
    return (
      <div className="flex flex-col gap-2">
        <span className="t-label">Inspector</span>
        <p className="t-mono-xs text-[var(--text-faint)]">Selecciona un rack en el plano</p>
      </div>
    );
  }

  const ppm = calibration.pixelsPerMeter;
  const bloqueado = rack.locked;

  const rotar = () => {
    const desde = rack.rotation;
    const hasta = (rack.rotation + 90) % 360;
    updateRack(rack.layoutId, { rotation: hasta });
    recordAction({ type: 'rotate-rack', layoutId: rack.layoutId, from: desde, to: hasta });
  };

  // Duplicar desplaza la copia: encima del original serian dos racks invisibles el
  // uno para el otro, y el operador creeria que no ha pasado nada.
  const duplicar = () =>
    addRack({
      ...rack,
      layoutId: nuevoLayoutId(rack.rackCode),
      x: rack.x + 0.5 * rack.width * ppm + 8,
      y: rack.y + 8,
      locked: false,
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--text-primary)]">
          {rack.rackCode}
        </span>
        <div className="flex items-center gap-0.5">
          <Accion
            icono={RotateCw}
            etiqueta="Rotar 90°"
            atajo="R"
            onClick={rotar}
            disabled={bloqueado}
          />
          <Accion icono={Copy} etiqueta="Duplicar" onClick={duplicar} disabled={bloqueado} />
          <Accion
            icono={bloqueado ? Lock : Unlock}
            etiqueta={bloqueado ? 'Desbloquear' : 'Bloquear'}
            activo={bloqueado}
            onClick={() => updateRack(rack.layoutId, { locked: !bloqueado })}
          />
          <Accion
            icono={Trash2}
            etiqueta="Quitar del plano"
            atajo="Supr"
            onClick={() => removeRack(rack.layoutId)}
            disabled={bloqueado}
          />
        </div>
      </div>

      {/*
        UN RACK BLOQUEADO LO DICE, Y DICE COMO DESBLOQUEARLO.

        Antes solo se deshabilitaban los campos y el arrastre lo ignoraba en silencio.
        Desde fuera eso es «este rack no se puede mover y no se por que», que es
        exactamente lo que reporto el operador sobre MZ08. Un control deshabilitado sin
        motivo es peor que uno que falla: al menos el que falla dice algo.

        Es un boton y no un aviso: el sitio donde se lee el problema es el sitio donde
        se resuelve. Mandar a buscar el candado entre los cuatro iconos de arriba es
        pedirle al operador que adivine cual de ellos era.
      */}
      {bloqueado && (
        <button
          type="button"
          onClick={() => updateRack(rack.layoutId, { locked: false })}
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--state-alert)]/40 bg-[var(--state-alert)]/8 p-2 text-left transition-colors hover:bg-[var(--state-alert)]/16"
        >
          <Lock strokeWidth={1.5} className="mt-0.5 size-3.5 shrink-0 text-[var(--state-alert)]" />
          <span className="t-mono-xs text-[var(--text-muted)]">
            <strong className="text-[var(--text-primary)]">
              {rack.rackCode} esta bloqueado
            </strong>
            : no se puede mover —ni en el plano ni en 3D— y sus medidas no se pueden
            editar. Pulsa aqui para desbloquearlo.
          </span>
        </button>
      )}

      {/* ── Posicion y medidas ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="t-label">Posicion y medidas</span>
        {/*
          TRES decimales en la posicion: son milimetros. Con dos, el campo
          redondeaba a centimetros al confirmar y no habia forma de escribir una
          coordenada exacta — que es justo el camino que queda cuando el raton no
          alcanza la precision que hace falta.
        */}
        <Campo
          etiqueta="X"
          unidad="m"
          valor={rack.x / ppm}
          decimales={3}
          minimo={-100000}
          onConfirmar={(v) => updateRack(rack.layoutId, { x: v * ppm })}
          disabled={bloqueado}
        />
        <Campo
          etiqueta="Y"
          unidad="m"
          valor={rack.y / ppm}
          decimales={3}
          minimo={-100000}
          onConfirmar={(v) => updateRack(rack.layoutId, { y: v * ppm })}
          disabled={bloqueado}
        />
        <Campo
          etiqueta="Ancho"
          unidad="m"
          valor={rack.width}
          decimales={2}
          minimo={0.05}
          onConfirmar={(v) => {
            recordAction({
              type: 'resize-rack',
              layoutId: rack.layoutId,
              from: { width: rack.width, length: rack.length },
              to: { width: v, length: rack.length },
            });
            updateRack(rack.layoutId, { width: v });
          }}
          disabled={bloqueado}
        />
        <Campo
          etiqueta="Largo"
          unidad="m"
          valor={rack.length}
          decimales={2}
          minimo={0.05}
          onConfirmar={(v) => {
            recordAction({
              type: 'resize-rack',
              layoutId: rack.layoutId,
              from: { width: rack.width, length: rack.length },
              to: { width: rack.width, length: v },
            });
            updateRack(rack.layoutId, { length: v });
          }}
          disabled={bloqueado}
        />
        <Campo
          etiqueta="Alto"
          unidad="m"
          valor={rack.height}
          decimales={2}
          minimo={0.05}
          onConfirmar={(v) => updateRack(rack.layoutId, { height: v })}
          disabled={bloqueado}
        />
        <Campo
          etiqueta="Rotacion"
          unidad="°"
          valor={rack.rotation}
          decimales={0}
          minimo={-360}
          maximo={360}
          onConfirmar={(v) => updateRack(rack.layoutId, { rotation: v % 360 })}
          disabled={bloqueado}
        />
      </div>

      {/* ── Color ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="t-label">Color</span>
        <div className="flex flex-wrap gap-1.5">
          {COLORES_RACK.map((c) => {
            const activo = (rack.color ?? COLOR_RACK_POR_DEFECTO) === c.valor;
            return (
              <button
                key={c.valor}
                type="button"
                onClick={() => updateRack(rack.layoutId, { color: c.valor })}
                disabled={bloqueado}
                aria-pressed={activo}
                aria-label={`Color ${c.nombre}`}
                title={c.nombre}
                className={cn(
                  'size-5 rounded-[var(--radius-xs)] transition-transform',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                  activo
                    ? 'scale-110 shadow-[0_0_0_2px_var(--text-primary)]'
                    : 'hover:scale-105 disabled:opacity-40',
                )}
                style={{ background: c.valor }}
              />
            );
          })}
        </div>
      </div>

      <p className="t-mono-xs text-[var(--text-faint)]">
        Arrastra para mover · tira de un tirador para redimensionar · Mayus mantiene
        la proporcion · flechas mueven 1 cm y con Mayus 10 cm · Alt invierte el
        ajuste a rejilla · Espacio + arrastrar mueve el plano
      </p>
    </div>
  );
}

function Accion({
  icono: Icono,
  etiqueta,
  atajo,
  onClick,
  disabled,
  activo,
}: {
  icono: typeof RotateCw;
  etiqueta: string;
  atajo?: string;
  onClick: () => void;
  disabled?: boolean;
  activo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      aria-pressed={activo}
      title={atajo ? `${etiqueta} · ${atajo}` : etiqueta}
      className={cn(
        'flex size-7 items-center justify-center rounded-[var(--radius-xs)] transition-colors',
        'text-[var(--icon-muted)] hover:text-[var(--icon-primary)] hover:[background:var(--glass-1)]',
        'disabled:pointer-events-none disabled:opacity-30',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        activo && '[background:var(--glass-2)] text-[var(--icon-accent)]',
      )}
    >
      <Icono strokeWidth={1.5} className="size-3.5" />
    </button>
  );
}

/**
 * Campo numerico con borrador propio.
 *
 * Confirma al perder el foco y con Enter; Escape descarta. Mientras el campo tiene
 * el foco NO se resincroniza con el store, que es justo lo que impedia teclear mas
 * de un digito.
 */
function Campo({
  etiqueta,
  unidad,
  valor,
  decimales,
  minimo,
  maximo,
  onConfirmar,
  disabled,
}: {
  etiqueta: string;
  unidad: string;
  valor: number;
  decimales: number;
  minimo: number;
  maximo?: number;
  onConfirmar: (v: number) => void;
  disabled: boolean;
}) {
  const formateado = Number.isFinite(valor) ? valor.toFixed(decimales) : '0';
  const [borrador, setBorrador] = useState(formateado);
  const enfocado = useRef(false);

  // Se acepta el valor de fuera solo si el usuario no esta escribiendo: al
  // arrastrar el rack en el plano, los campos deben seguir al raton.
  useEffect(() => {
    if (!enfocado.current) setBorrador(formateado);
  }, [formateado]);

  const confirmar = () => {
    const n = Number.parseFloat(borrador.replace(',', '.'));
    if (!Number.isFinite(n)) {
      setBorrador(formateado); // vacio o basura: se revierte, no se escribe NaN
      return;
    }
    const acotado = Math.min(maximo ?? Number.POSITIVE_INFINITY, Math.max(minimo, n));
    setBorrador(acotado.toFixed(decimales));
    if (acotado !== valor) onConfirmar(acotado);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-right font-[family-name:var(--font-data)] text-[length:9px] text-[var(--text-faint)]">
        {etiqueta}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={borrador}
        onChange={(e) => setBorrador(e.target.value)}
        onFocus={(e) => {
          enfocado.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          enfocado.current = false;
          confirmar();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmar();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setBorrador(formateado);
            e.currentTarget.blur();
          }
        }}
        disabled={disabled}
        aria-label={`${etiqueta} en ${unidad === '°' ? 'grados' : 'metros'}`}
        className={cn(
          'h-6 w-full rounded-[2px] px-1.5 tabular-nums',
          'font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-primary)]',
          '[background:var(--glass-2)] outline-none focus:shadow-[var(--focus-ring)]',
          'disabled:opacity-40',
        )}
      />
      <span className="w-5 shrink-0 font-[family-name:var(--font-data)] text-[length:8px] text-[var(--text-faint)]">
        {unidad}
      </span>
    </div>
  );
}
