/**
 * PALETA DE TRABAJO — la barra superior del editor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO ESTA ORGANIZADA, Y POR QUE ASI
 *
 * Por GRUPOS de tarea, como una paleta de dibujo: modo · herramientas · vista ·
 * ajuste · edicion · alinear · repartir · archivo. Antes era una fila de iconos sin
 * jerarquia donde el ojo no encontraba nada, y la mitad de lo util —alinear,
 * distribuir, zoom— no estaba o vivia escondido en el panel derecho.
 *
 * Las herramientas de vista viven aqui y no en el lienzo porque el encuadre es del
 * documento, no del raton: «ajustar» y «ir a la seleccion» son ordenes, y una orden
 * se pulsa.
 *
 * Cada grupo lleva su etiqueta en minusculas y pequeña. Cuesta 12 px de alto y
 * ahorra el «¿que era este icono?» de cada dia.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ColumnsIcon,
  Copy,
  Crosshair,
  Download,
  Expand,
  Grid3X3,
  Image,
  Maximize,
  MousePointer,
  Move,
  Redo2,
  RotateCw,
  RowsIcon,
  Ruler,
  Save,
  Scan,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Modal } from '../../../../design/foundation/Modal';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';
import {
  alinear,
  cajaDe,
  distribuir,
  type CriterioAlineacion,
  type EjeDistribucion,
} from '../alinear';
import { repetir, type DireccionRepeticion } from '../repetir';
import { useEditorStore } from '../store';
import { fitBounds, zoomAt } from '../transforms';

interface EditorToolbarProps {
  onSave?: (() => void) | undefined;
  onExport?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}

export function EditorToolbar({ onSave, onExport, onImport }: EditorToolbarProps = {}) {
  const {
    mode, setMode, isEditing, setEditing,
    canUndo, canRedo, performUndo, performRedo,
    snapToGrid, setSnapToGrid, gridMeters, setGridMeters,
    racks, selectedRackIds, calibration, plan,
    viewport, setViewport, canvasSize,
    updateRacks, updateRack, addRack, removeSelected, recordAction, selectRacks,
  } = useEditorStore();

  const [repeticionAbierta, setRepeticionAbierta] = useState(false);
  const ppm = calibration.pixelsPerMeter;
  const seleccion = racks.filter((r) => selectedRackIds.includes(r.layoutId));
  const hayUno = seleccion.length >= 1;
  const hayDos = seleccion.length >= 2;
  const hayTres = seleccion.length >= 3;

  // ── Vista ─────────────────────────────────────────────────────────────────
  const zoom = (delta: number) =>
    setViewport(zoomAt(viewport, canvasSize.w / 2, canvasSize.h / 2, delta));

  const ajustar = () => {
    if (!plan || canvasSize.w === 0) return;
    setViewport(fitBounds(plan.width, plan.height, canvasSize.w, canvasSize.h));
  };

  /** Encuadra un rectangulo del plano, con margen. Es «ir a la seleccion». */
  const encuadrar = (x0: number, y0: number, x1: number, y1: number) => {
    if (canvasSize.w === 0) return;
    const margen = 60;
    const ancho = Math.max(1, x1 - x0);
    const alto = Math.max(1, y1 - y0);
    const z = Math.min(
      (canvasSize.w - margen * 2) / ancho,
      (canvasSize.h - margen * 2) / alto,
      5,
    );
    setViewport({
      zoom: z,
      offsetX: canvasSize.w / 2 - ((x0 + x1) / 2) * z,
      offsetY: canvasSize.h / 2 - ((y0 + y1) / 2) * z,
    });
  };

  const irALaSeleccion = () => {
    if (seleccion.length === 0) return;
    const cajas = seleccion.map((r) => cajaDe(r, ppm));
    encuadrar(
      Math.min(...cajas.map((c) => c.x0)),
      Math.min(...cajas.map((c) => c.y0)),
      Math.max(...cajas.map((c) => c.x1)),
      Math.max(...cajas.map((c) => c.y1)),
    );
  };

  // ── Edicion ───────────────────────────────────────────────────────────────
  const aplicarMovimientos = (movs: ReturnType<typeof alinear>) => {
    if (movs.length === 0) return;
    updateRacks(movs.map((m) => ({ layoutId: m.layoutId, updates: m.to })));
    recordAction({ type: 'move-many', movimientos: movs });
  };

  const rotar = () => {
    for (const r of seleccion) {
      if (r.locked) continue;
      const hasta = (r.rotation + 90) % 360;
      updateRack(r.layoutId, { rotation: hasta });
      recordAction({ type: 'rotate-rack', layoutId: r.layoutId, from: r.rotation, to: hasta });
    }
  };

  const duplicar = () => {
    const nuevos = seleccion
      .filter((r) => !r.locked)
      .map((r) => ({
        ...r,
        layoutId: `${r.layoutId}-copia-${r.rackCode}`,
        x: r.x + r.width * ppm + 8,
        locked: false,
      }));
    nuevos.forEach(addRack);
    if (nuevos.length > 0) selectRacks(nuevos.map((r) => r.layoutId));
  };

  return (
    <>
      <div className="flex items-stretch gap-2 overflow-x-auto rounded-[var(--radius-sm)] px-2 py-1 [background:var(--glass-1)]">
        <Grupo etiqueta="modo">
          <Button
            variant={isEditing ? 'command' : 'secondary'}
            size="xs"
            onClick={() => setEditing(!isEditing)}
          >
            {isEditing ? 'Salir edicion' : 'Editar layout'}
          </Button>
        </Grupo>

        {isEditing && (
          <>
            <Grupo etiqueta="herramientas">
              <Boton icono={MousePointer} activo={mode === 'select'} onClick={() => setMode('select')} etiqueta="Seleccionar y mover" />
              <Boton icono={Move} activo={mode === 'pan'} onClick={() => setMode('pan')} etiqueta="Mover el plano · o Espacio + arrastrar" />
              <Boton icono={Ruler} activo={mode === 'calibrate'} onClick={() => setMode('calibrate')} etiqueta="Calibrar la escala con una distancia conocida" />
              <Boton icono={Crosshair} activo={mode === 'set-origin'} onClick={() => setMode('set-origin')} etiqueta="Definir el origen de coordenadas" />
            </Grupo>

            <Grupo etiqueta="vista">
              <Boton icono={ZoomIn} onClick={() => zoom(1)} etiqueta="Acercar · o rueda del raton" />
              <Boton icono={ZoomOut} onClick={() => zoom(-1)} etiqueta="Alejar" />
              <Boton icono={Maximize} onClick={ajustar} etiqueta="Ajustar el plano a la pantalla" disabled={!plan} />
              <Boton icono={Scan} onClick={irALaSeleccion} etiqueta="Ir a la seleccion" disabled={!hayUno} />
            </Grupo>

            <Grupo etiqueta="ajuste">
              <Boton
                icono={Grid3X3}
                activo={snapToGrid}
                onClick={() => setSnapToGrid(!snapToGrid)}
                etiqueta={
                  snapToGrid
                    ? `Ajuste a rejilla activo · cada ${gridMeters} m · Alt lo desactiva mientras arrastras`
                    : 'Ajuste a rejilla inactivo · movimiento libre · Alt lo activa mientras arrastras'
                }
              />
              <select
                value={gridMeters}
                onChange={(e) => setGridMeters(Number.parseFloat(e.target.value))}
                aria-label="Paso de la rejilla en metros"
                title="Paso de la rejilla"
                className={cn(
                  'h-6 shrink-0 rounded-[var(--radius-xs)] px-1 outline-none',
                  'font-[family-name:var(--font-data)] text-[length:9px]',
                  '[background:var(--glass-2)] focus:shadow-[var(--focus-ring)]',
                  snapToGrid ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
                )}
              >
                {[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((m) => (
                  <option key={m} value={m}>
                    {m < 1 ? `${Math.round(m * 100)} cm` : `${m} m`}
                  </option>
                ))}
              </select>
            </Grupo>

            <Grupo etiqueta="edicion">
              <Boton icono={Undo2} onClick={performUndo} disabled={!canUndo} etiqueta="Deshacer · Ctrl+Z" />
              <Boton icono={Redo2} onClick={performRedo} disabled={!canRedo} etiqueta="Rehacer · Ctrl+Mayus+Z" />
              <Boton icono={RotateCw} onClick={rotar} disabled={!hayUno} etiqueta="Rotar 90° · R · o tira del tirador de giro para un angulo libre" />
              <Boton icono={Copy} onClick={duplicar} disabled={!hayUno} etiqueta="Duplicar" />
              <Boton icono={Expand} onClick={() => setRepeticionAbierta(true)} disabled={!hayUno} etiqueta="Repetir en fila · coloca una hilera completa de una vez" />
              <Boton icono={Trash2} onClick={() => removeSelected()} disabled={!hayUno} etiqueta="Quitar del plano · Supr" />
            </Grupo>

            <Grupo etiqueta="alinear">
              <Boton icono={AlignStartVertical} onClick={() => aplicarMovimientos(alinear(seleccion, ppm, 'izquierda' as CriterioAlineacion))} disabled={!hayDos} etiqueta="Alinear a la izquierda" />
              <Boton icono={AlignCenterVertical} onClick={() => aplicarMovimientos(alinear(seleccion, ppm, 'centro-h'))} disabled={!hayDos} etiqueta="Centrar en horizontal" />
              <Boton icono={AlignEndVertical} onClick={() => aplicarMovimientos(alinear(seleccion, ppm, 'derecha'))} disabled={!hayDos} etiqueta="Alinear a la derecha" />
              <Boton icono={AlignStartHorizontal} onClick={() => aplicarMovimientos(alinear(seleccion, ppm, 'arriba'))} disabled={!hayDos} etiqueta="Alinear arriba" />
              <Boton icono={AlignCenterHorizontal} onClick={() => aplicarMovimientos(alinear(seleccion, ppm, 'centro-v'))} disabled={!hayDos} etiqueta="Centrar en vertical" />
              <Boton icono={AlignEndHorizontal} onClick={() => aplicarMovimientos(alinear(seleccion, ppm, 'abajo'))} disabled={!hayDos} etiqueta="Alinear abajo" />
            </Grupo>

            <Grupo etiqueta="repartir">
              <Boton icono={ColumnsIcon} onClick={() => aplicarMovimientos(distribuir(seleccion, ppm, 'horizontal' as EjeDistribucion))} disabled={!hayTres} etiqueta="Repartir en horizontal con huecos iguales · hacen falta 3" />
              <Boton icono={RowsIcon} onClick={() => aplicarMovimientos(distribuir(seleccion, ppm, 'vertical'))} disabled={!hayTres} etiqueta="Repartir en vertical con huecos iguales · hacen falta 3" />
            </Grupo>
          </>
        )}

        <div className="flex-1" />

        <Grupo etiqueta="archivo">
          <Boton icono={Image} onClick={() => {}} etiqueta="El plano base se carga en el panel de la izquierda" disabled />
          <Boton icono={Upload} onClick={onImport} disabled={!onImport} etiqueta="Importar layout (JSON)" />
          <Boton icono={Download} onClick={onExport} disabled={!onExport} etiqueta="Exportar layout (JSON)" />
          <Button variant="secondary" size="xs" onClick={onSave} disabled={!onSave} aria-label="Guardar borrador">
            <Save strokeWidth={1.5} className="size-3.5" />
            Guardar
          </Button>
        </Grupo>
      </div>

      <DialogoRepetir
        abierto={repeticionAbierta}
        cantidadSeleccionada={seleccion.length}
        onCerrar={() => setRepeticionAbierta(false)}
        onRepetir={(opciones) => {
          const nuevos = repetir(seleccion, ppm, opciones);
          nuevos.forEach(addRack);
          if (nuevos.length > 0) selectRacks(nuevos.map((r) => r.layoutId));
          setRepeticionAbierta(false);
        }}
      />
    </>
  );
}

/** Grupo con su etiqueta. La linea vertical separa sin encerrar. */
function Grupo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="px-0.5 font-[family-name:var(--font-data)] text-[length:8px] uppercase tracking-[var(--tracking-label)] text-[var(--text-faint)]">
          {etiqueta}
        </span>
        <div className="flex items-center gap-0.5">{children}</div>
      </div>
      <span aria-hidden className="h-8 w-px self-center [background:var(--hairline)]" />
    </div>
  );
}

function Boton({
  icono: Icono,
  etiqueta,
  onClick,
  activo,
  disabled,
}: {
  icono: typeof MousePointer;
  etiqueta: string;
  onClick?: (() => void) | undefined;
  activo?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      aria-pressed={activo}
      title={etiqueta}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] transition-colors',
        'text-[var(--icon-muted)] hover:text-[var(--icon-primary)] hover:[background:var(--glass-2)]',
        'disabled:pointer-events-none disabled:opacity-25',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        activo && '[background:var(--glass-3)] text-[var(--icon-accent)]',
      )}
    >
      <Icono strokeWidth={1.5} className="size-3.5" />
    </button>
  );
}

/**
 * Dialogo de repeticion.
 *
 * Pide lo que el operario sabe —cuantas, cada cuantos metros de HUECO y hacia
 * donde— y dice cuantos racks van a salir antes de pulsar. Sin ese recuento, pedir
 * 50 copias de una seleccion de 4 sorprende con 200 racks nuevos.
 */
function DialogoRepetir({
  abierto,
  cantidadSeleccionada,
  onCerrar,
  onRepetir,
}: {
  abierto: boolean;
  cantidadSeleccionada: number;
  onCerrar: () => void;
  onRepetir: (o: { copias: number; separacionM: number; direccion: DireccionRepeticion }) => void;
}) {
  const [copias, setCopias] = useState('4');
  const [separacion, setSeparacion] = useState('0.90');
  const [direccion, setDireccion] = useState<DireccionRepeticion>('derecha');

  const n = Number.parseInt(copias, 10);
  const sep = Number.parseFloat(separacion.replace(',', '.'));
  const valido = Number.isFinite(n) && n >= 1 && n <= 200 && Number.isFinite(sep) && sep >= 0;

  return (
    <Modal
      abierto={abierto}
      titulo="Repetir en fila"
      descripcion={`Copia ${cantidadSeleccionada} rack${cantidadSeleccionada === 1 ? '' : 's'} a lo largo de una direccion, con un hueco constante.`}
      onCerrar={onCerrar}
      acciones={
        <>
          <Button variant="ghost" size="xs" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            variant="command"
            size="xs"
            disabled={!valido}
            onClick={() => onRepetir({ copias: n, separacionM: sep, direccion })}
          >
            Repetir
          </Button>
        </>
      }
    >
      <Fila etiqueta="Copias">
        <input
          type="text"
          inputMode="numeric"
          value={copias}
          onChange={(e) => setCopias(e.target.value)}
          className={entrada}
        />
      </Fila>
      <Fila etiqueta="Hueco entre racks">
        <input
          type="text"
          inputMode="decimal"
          value={separacion}
          onChange={(e) => setSeparacion(e.target.value)}
          className={entrada}
        />
        <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">m</span>
      </Fila>
      <Fila etiqueta="Direccion">
        <select
          value={direccion}
          onChange={(e) => setDireccion(e.target.value as DireccionRepeticion)}
          className={entrada}
        >
          <option value="derecha">a la derecha</option>
          <option value="izquierda">a la izquierda</option>
          <option value="abajo">hacia abajo</option>
          <option value="arriba">hacia arriba</option>
        </select>
      </Fila>
      {valido && (
        <p className="t-mono-xs text-[var(--text-faint)]">
          se añadiran {n * cantidadSeleccionada} racks · total{' '}
          {cantidadSeleccionada + n * cantidadSeleccionada} en la fila
        </p>
      )}
      <p className="t-mono-xs text-[var(--text-faint)]">
        Las copias conservan el codigo del original y quedan sin vincular: el codigo
        real de cada una lo pones tu en el inspector.
      </p>
    </Modal>
  );
}

const entrada =
  'h-8 w-full rounded-[var(--radius-xs)] px-2 font-[family-name:var(--font-data)] text-[length:var(--text-sm)] tabular-nums text-[var(--text-primary)] [background:var(--glass-2)] outline-none focus:shadow-[var(--focus-ring)]';

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="t-label w-[132px] shrink-0">{etiqueta}</span>
      {children}
    </label>
  );
}
