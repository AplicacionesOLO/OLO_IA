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
  RotateCcw,
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
import {
  CAMARA_INICIAL,
  centroDe,
  componerEscena,
  encuadrar as encuadrar3d,
  esquinasDelSuelo,
  orbitar,
  zoomEn,
} from '../../cluster3d/escena';
import { useEditorStore } from '../store';
import { zoomAt } from '../transforms';
import { nuevoLayoutId } from '../types';

interface EditorToolbarProps {
  onSave?: (() => void) | undefined;
  onExport?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}

export function EditorToolbar({ onSave, onExport, onImport }: EditorToolbarProps = {}) {
  const {
    mode, setMode, isEditing, setEditing,
    viewDimension, setViewDimension,
    camara3d, setCamara3d, canvas3dSize, reference,
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
  /**
   * LAS ACCIONES DE ENCUADRE VALEN PARA LAS DOS VISTAS.
   *
   * Cada una actua sobre la camara de la vista ACTIVA: el viewport plano en 2D, la
   * camara axonometrica en 3D. Son la misma intencion —«acercame», «mete todo en
   * pantalla», «llevame a lo que tengo seleccionado»— y por eso comparten boton.
   *
   * La escena del 3D se compone aqui igual que en el visor: colocacion × catalogo. No
   * hace falta el catalogo para encuadrar —solo las posiciones y las medidas— asi que
   * se pasa vacio y los cuerpos y niveles quedan a 0, que es irrelevante para la caja.
   */
  const en3d = viewDimension === '3d';
  const escena3d = () =>
    componerEscena(racks, ppm, reference.origin, [], new Map());

  const zoom = (delta: number) => {
    if (en3d) {
      setCamara3d(zoomEn(camara3d, canvas3dSize.w / 2, canvas3dSize.h / 2, delta));
      return;
    }
    setViewport(zoomAt(viewport, canvasSize.w / 2, canvasSize.h / 2, delta));
  };

  const ajustar = () => {
    if (en3d) {
      if (canvas3dSize.w === 0) return;
      setCamara3d(
        encuadrar3d(camara3d, escena3d(), canvas3dSize, 48, esquinasDelSuelo(ppm, reference.origin, plan)),
      );
      return;
    }
    if (canvasSize.w === 0) return;

    /*
      «Centrar» en 2D encuadra el plano Y LOS RACKS, no solo la imagen.

      Antes era `fitBounds(plan.width, plan.height, …)`: encuadraba la imagen del
      plano y nada mas. Un rack colocado fuera de los limites de la imagen —al
      importar un layout de otra escala, al pegar una hilera cerca del borde, o
      simplemente al mover uno de mas— quedaba invisible Y FUERA DEL ALCANCE del
      unico boton que existe para recuperar la vista: centrar volvia a encuadrar la
      imagen, o sea exactamente donde el rack no estaba. Medido con 18 racks
      colocados fuera de la imagen: encender y apagar su capa no cambiaba UN SOLO
      PIXEL del lienzo, y el editor decia «18 racks situados».

      Tampoco exige que haya plano. Sin imagen y con racks colocados el boton estaba
      deshabilitado, que es el momento en que hace mas falta.
    */
    const cajas = racks.map((r) => cajaDe(r, ppm));
    const limites = plan ? [{ x0: 0, y0: 0, x1: plan.width, y1: plan.height }, ...cajas] : cajas;
    if (limites.length === 0) return;
    encuadrar(
      Math.min(...limites.map((c) => c.x0)),
      Math.min(...limites.map((c) => c.y0)),
      Math.max(...limites.map((c) => c.x1)),
      Math.max(...limites.map((c) => c.y1)),
    );
  };

  /** Devuelve la camara 3D a su angulo de partida sin perder de vista la escena. */
  const volverAlAngulo = () => {
    const centro = centroDe(escena3d(), esquinasDelSuelo(ppm, reference.origin, plan));
    setCamara3d(
      orbitar(
        camara3d,
        centro,
        CAMARA_INICIAL.azimut - camara3d.azimut,
        CAMARA_INICIAL.elevacion - camara3d.elevacion,
      ),
    );
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
    if (en3d) {
      if (canvas3dSize.w === 0) return;
      // Solo lo seleccionado, sin el suelo: «ir a la seleccion» es acercarse a ella, y
      // meter el plano entero en el encuadre la dejaria igual de lejos que estaba.
      const ids = new Set(seleccion.map((r) => r.layoutId));
      setCamara3d(
        encuadrar3d(camara3d, escena3d().filter((r) => ids.has(r.layoutId)), canvas3dSize),
      );
      return;
    }
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
        layoutId: nuevoLayoutId(r.rackCode),
        x: r.x + r.width * ppm + 8,
        locked: false,
      }));
    nuevos.forEach(addRack);
    if (nuevos.length > 0) selectRacks(nuevos.map((r) => r.layoutId));
  };

  return (
    <>
      <div className="flex items-stretch gap-2 overflow-x-auto rounded-[var(--radius-sm)] px-2 py-1 [background:var(--glass-1)]">
        <Grupo etiqueta="vista">
          {/* Antes de las herramientas porque es la pregunta anterior: 2D es el plano
              de frente y 3D el almacen mirado. En LAS DOS se edita.
              
              Durante un tiempo la edicion en 3D estuvo deshabilitada, con el
              argumento de que arrastrar en axonometria es mover en dos ejes sin saber
              en cual. El argumento no aguanta: la proyeccion del suelo es afin e
              invertible, asi que el punto bajo el cursor es UNO. Lo que si es ambiguo
              es cambiar el TAMAÑO con tiradores —¿que eje estira un arrastre
              diagonal?— y eso sigue siendo del inspector. */}
          <Conmutador
            activo={viewDimension !== '3d'}
            onClick={() => setViewDimension('2d')}
            etiqueta="Plano de frente · la vista en la que se coloca y se edita"
          >
            2D
          </Conmutador>
          <Conmutador
            activo={viewDimension === '3d'}
            onClick={() => setViewDimension('3d')}
            etiqueta="Cluster en tres dimensiones · el plano tumbado de suelo"
          >
            3D
          </Conmutador>
        </Grupo>

        <Grupo etiqueta="modo">
          <Button
            variant={isEditing ? 'command' : 'secondary'}
            size="xs"
            onClick={() => setEditing(!isEditing)}
            title={
              viewDimension === '3d'
                ? 'Arrastra los racks sobre el suelo. Las medidas y el giro, en el inspector'
                : undefined
            }
          >
            {isEditing ? 'Salir edicion' : 'Editar layout'}
          </Button>
        </Grupo>

        {/*
          EL ENCUADRE NO ES UNA HERRAMIENTA DE EDICION.

          Estuvo dentro del bloque `isEditing` junto a alinear, rotar y duplicar, y
          eso dejaba a quien solo MIRA el plano sin manera de recuperar la vista: la
          rueda del raton hace zoom siempre, se editando o no, asi que perderse es
          igual de facil en los dos modos y solo en uno habia salida. Se comprobo en
          el navegador: con el modo edicion apagado la barra tenia cuatro botones y
          ninguno era «centrar».

          En 3D tambien estuvo oculto, con el argumento de que la camara tiene sus
          controles en la esquina del lienzo. Fue el mismo error de sitio: quien pierde
          el plano de vista lo busca en la BARRA.

          «Centrar» es la salida de emergencia de esta pantalla. Se deshabilita solo
          cuando no hay literalmente nada que encuadrar —ni imagen ni racks—.
        */}
        <Grupo etiqueta="encuadre">
          <Boton icono={ZoomIn} onClick={() => zoom(1)} etiqueta="Acercar · o rueda del raton" />
          <Boton icono={ZoomOut} onClick={() => zoom(-1)} etiqueta="Alejar" />
          <Boton
            icono={Maximize}
            onClick={ajustar}
            etiqueta={
              viewDimension === '3d'
                ? 'Centrar: mete el almacen entero en pantalla'
                : 'Centrar: mete el plano y todos los racks en pantalla'
            }
            disabled={racks.length === 0 && !plan}
          />
          <Boton
            icono={Scan}
            onClick={irALaSeleccion}
            etiqueta="Ir a la seleccion"
            disabled={!hayUno}
          />
          {viewDimension === '3d' && (
            <Boton
              icono={RotateCcw}
              onClick={volverAlAngulo}
              etiqueta="Volver al angulo de vista inicial"
            />
          )}
        </Grupo>

        {isEditing && (
          <>
            {/* Calibrar y fijar el origen se hacen marcando PIXELES del plano, y en
                axonometria el plano esta escorzado: marcar dos puntos ahi mediria
                sobre una imagen deformada. Por eso esas dos —y solo esas— son de la
                vista 2D. Seleccionar y desplazar valen en las dos. */}
            <Grupo etiqueta="herramientas">
              <Boton icono={MousePointer} activo={mode === 'select'} onClick={() => setMode('select')} etiqueta="Seleccionar y mover" />
              <Boton icono={Move} activo={mode === 'pan'} onClick={() => setMode('pan')} etiqueta={viewDimension === '3d' ? 'Desplazar la escena · o Shift + arrastrar' : 'Mover el plano · o Espacio + arrastrar'} />
              {viewDimension !== '3d' && (
                <>
                  <Boton icono={Ruler} activo={mode === 'calibrate'} onClick={() => setMode('calibrate')} etiqueta="Calibrar la escala con una distancia conocida" />
                  <Boton icono={Crosshair} activo={mode === 'set-origin'} onClick={() => setMode('set-origin')} etiqueta="Definir el origen de coordenadas" />
                </>
              )}
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

/** Pestaña de dos estados. Texto y no icono: «2D» y «3D» se leen sin aprenderlos. */
function Conmutador({
  activo,
  onClick,
  etiqueta,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={etiqueta}
      aria-label={etiqueta}
      aria-pressed={activo}
      className={cn(
        't-mono-xs h-8 rounded-[var(--radius-xs)] px-2.5 transition-colors',
        activo
          ? 'text-[var(--text-primary)] [background:var(--glass-3)]'
          : 'text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:[background:var(--glass-1)]',
      )}
    >
      {children}
    </button>
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
