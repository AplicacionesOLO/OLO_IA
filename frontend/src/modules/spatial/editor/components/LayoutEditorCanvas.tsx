/**
 * LAYOUT EDITOR CANVAS — el lienzo interactivo del editor de plano.
 *
 * Orden de pintado:
 *   1. fondo · 2. imagen del plano · 3. rejilla · 4. ejes y origen · 5. racks
 *   6. etiquetas · 7. seleccion y tiradores · 8. linea de calibracion
 *   9. coordenadas del cursor
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTERACCION
 *
 *   rueda                    zoom sobre el cursor
 *   ESPACIO + arrastrar      mueve el plano (tambien boton central)
 *   arrastrar un rack        lo mueve
 *   arrastrar un tirador     redimensiona; MAYUS mantiene la proporcion
 *   clic en vacio            deselecciona
 *
 * ── DOS DECISIONES QUE NO SON OBVIAS ────────────────────────────────────────
 *
 * 1. Los tiradores se DIBUJAN y se PRUEBAN en pixeles de pantalla, no del plano.
 *    Si midieran en unidades del plano, al alejar el zoom se volverian
 *    inalcanzables —un cuadradito de 5 px del plano son 0,5 px en pantalla— y al
 *    acercarlo taparian el rack entero.
 *
 * 2. Redimensionar ANCLA el lado opuesto. Escalar respecto al centro es mas facil
 *    de programar y peor de usar: al estirar el borde derecho, el izquierdo se
 *    movia tambien y colocar un rack contra una pared se volvia imposible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Modal } from '../../../../design/foundation/Modal';
import { Button } from '../../../../design/primitives/Button';
import { useEditorStore } from '../store';
import {
  fitBounds,
  planToScreen,
  screenToPlan,
  zoomAt,
  type Vec2,
  type ViewportTransform,
} from '../transforms';
import { snapToGrid as snapValue } from '../snap';
import { COLOR_RACK_POR_DEFECTO, type PositionedRack } from '../types';

interface LayoutEditorCanvasProps {
  className?: string | undefined;
}

/** Tirador: signo en cada eje local. 0 = centro de ese eje (tirador de borde). */
type Tirador = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 };

const TIRADORES: Tirador[] = [
  { sx: -1, sy: -1 }, { sx: 1, sy: -1 }, { sx: -1, sy: 1 }, { sx: 1, sy: 1 },
  { sx: 0, sy: -1 }, { sx: 0, sy: 1 }, { sx: -1, sy: 0 }, { sx: 1, sy: 0 },
];

/** Lado del tirador en pixeles de PANTALLA. */
const LADO_TIRADOR = 8;
/** Tolerancia de acierto, mas generosa que el dibujo: se apunta con el raton. */
const TOLERANCIA = 9;
/** Medida minima de un rack, en metros. Por debajo deja de ser un rack. */
const MINIMO_M = 0.05;

export function LayoutEditorCanvas({ className }: LayoutEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vt, setVt] = useState<ViewportTransform>({ offsetX: 0, offsetY: 0, zoom: 1 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [espacio, setEspacio] = useState(false);
  const [sobreTirador, setSobreTirador] = useState<Tirador | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);

  const {
    plan, calibration, reference, racks, selectedRackId, layers,
    mode, visualMode, isEditing, selectRack, updateRack,
    setCalibration, setReference, recordAction,
    snapToGrid: snapEnabled, gridSize,
  } = useEditorStore();

  const panRef = useRef({ active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });
  const dragRef = useRef<{ layoutId: string; startPlan: Vec2; startRack: Vec2 } | null>(null);
  const resizeRef = useRef<{
    layoutId: string;
    tirador: Tirador;
    desde: { width: number; length: number };
    centro: Vec2;
  } | null>(null);
  const calRef = useRef<{ p1: Vec2 | null }>({ p1: null });

  // Calibracion: en lugar de `window.prompt`, que bloquea el hilo y congela el
  // lienzo, se guardan los dos puntos y se pregunta con un modal del sistema.
  const [calPendiente, setCalPendiente] = useState<{ p1: Vec2; p2: Vec2; px: number } | null>(null);
  const [distancia, setDistancia] = useState('');

  const rackSeleccionado = racks.find((r) => r.layoutId === selectedRackId) ?? null;
  const ppm = calibration.pixelsPerMeter;

  // ── Imagen del plano ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!plan) { imgRef.current = null; return; }
    const img = new window.Image();
    img.onload = () => { imgRef.current = img; };
    img.src = plan.objectUrl;
  }, [plan]);

  // ── Tamaño ────────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setSize({ w: width, h: height });
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!plan || size.w === 0) return;
    setVt(fitBounds(plan.width, plan.height, size.w, size.h));
  }, [plan, size.w, size.h]);

  // ── ESPACIO para mover el plano ───────────────────────────────────────────
  //
  // Se escucha en el documento y no en el lienzo porque el lienzo no recibe foco:
  // sin esto habria que hacer clic antes de poder mover, y el gesto es «mantengo
  // espacio y arrastro», no «hago clic, mantengo espacio y arrastro».
  useEffect(() => {
    const escribiendo = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      );
    };
    const abajo = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || escribiendo(e.target)) return;
      // Sin esto la barra espaciadora desplaza la pagina mientras se arrastra.
      e.preventDefault();
      setEspacio(true);
    };
    const arriba = (e: KeyboardEvent) => {
      if (e.code === 'Space') setEspacio(false);
    };
    // Si la ventana pierde el foco con espacio pulsado, el keyup no llega nunca y
    // el lienzo se queda creyendo que sigue apretado.
    const perderFoco = () => setEspacio(false);
    document.addEventListener('keydown', abajo);
    document.addEventListener('keyup', arriba);
    window.addEventListener('blur', perderFoco);
    return () => {
      document.removeEventListener('keydown', abajo);
      document.removeEventListener('keyup', arriba);
      window.removeEventListener('blur', perderFoco);
    };
  }, []);

  // ── Bucle de pintado ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, size.w, size.h);

      ctx.save();
      ctx.translate(vt.offsetX, vt.offsetY);
      ctx.scale(vt.zoom, vt.zoom);

      if (layers.plan && imgRef.current && plan) {
        ctx.drawImage(imgRef.current, 0, 0, plan.width, plan.height);
      }
      if (layers.grid) drawGrid(ctx, vt, size.w, size.h);
      if (layers.axes) drawAxes(ctx, reference.origin, plan?.width ?? 2000, plan?.height ?? 2000);
      if (layers.racks) {
        for (const rack of racks) {
          drawRack(ctx, rack, rack.layoutId === selectedRackId, visualMode === 'holographic', ppm);
        }
      }
      if (layers.labels) {
        for (const rack of racks) drawRackLabel(ctx, rack, ppm);
      }
      if (mode === 'calibrate' && calRef.current.p1) {
        const fin = cursor ? screenToPlan(cursor, vt) : calRef.current.p1;
        drawCalibrationLine(ctx, calRef.current.p1, calPendiente?.p2 ?? fin);
      }
      ctx.restore();

      // Tiradores FUERA de la transformacion: tamaño constante en pantalla.
      if (layers.selection && rackSeleccionado && isEditing && !rackSeleccionado.locked) {
        drawTiradores(ctx, rackSeleccionado, ppm, vt);
      }

      if (cursor && plan) {
        const planPt = screenToPlan(cursor, vt);
        const worldX = (planPt.x - reference.origin.x) / ppm;
        const worldY = (planPt.y - reference.origin.y) / ppm;
        ctx.fillStyle = 'rgba(200,220,240,0.6)';
        ctx.font = '10px "JetBrains Mono Variable", monospace';
        ctx.fillText(`${worldX.toFixed(2)}m, ${worldY.toFixed(2)}m`, 8, size.h - 8);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  });

  // ── Puntero ───────────────────────────────────────────────────────────────
  const puntoLocal = useCallback((sx: number, sy: number): Vec2 => screenToPlan({ x: sx, y: sy }, vt), [vt]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const planPt = puntoLocal(sx, sy);

    if (mode === 'calibrate') {
      if (!calRef.current.p1) {
        calRef.current.p1 = planPt;
      } else {
        const p1 = calRef.current.p1;
        const px = Math.hypot(planPt.x - p1.x, planPt.y - p1.y);
        calRef.current.p1 = null;
        if (px > 1) {
          setDistancia('');
          setCalPendiente({ p1, p2: planPt, px });
        }
      }
      return;
    }

    if (mode === 'set-origin') {
      const oldRef = { ...reference };
      const newRef = { ...reference, origin: { x: planPt.x, y: planPt.y } };
      setReference(newRef);
      recordAction({ type: 'set-origin', from: oldRef, to: newRef });
      return;
    }

    // Mover el plano: espacio, boton central o modo pan explicito.
    if (espacio || e.button === 1 || mode === 'pan') {
      panRef.current = {
        active: true, startX: e.clientX, startY: e.clientY,
        startOffsetX: vt.offsetX, startOffsetY: vt.offsetY,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (mode !== 'select' && mode !== 'view') return;

    // Un tirador tiene prioridad sobre el cuerpo: esta ENCIMA del rack y quien
    // apunta a la esquina quiere redimensionar, no mover.
    if (isEditing && rackSeleccionado && !rackSeleccionado.locked) {
      const t = tiradorEn({ x: sx, y: sy }, rackSeleccionado, ppm, vt);
      if (t) {
        resizeRef.current = {
          layoutId: rackSeleccionado.layoutId,
          tirador: t,
          desde: { width: rackSeleccionado.width, length: rackSeleccionado.length },
          centro: { x: rackSeleccionado.x, y: rackSeleccionado.y },
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
    }

    const hit = hitTestRack(planPt, racks, ppm);
    if (hit) {
      selectRack(hit.layoutId);
      if (isEditing && !hit.locked) {
        dragRef.current = { layoutId: hit.layoutId, startPlan: planPt, startRack: { x: hit.x, y: hit.y } };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    } else {
      selectRack(null);
    }
  }, [
    espacio, mode, racks, rackSeleccionado, ppm, vt, reference, isEditing,
    puntoLocal, selectRack, setReference, recordAction,
  ]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursor({ x: sx, y: sy });

    if (panRef.current.active) {
      setVt({
        ...vt,
        offsetX: panRef.current.startOffsetX + (e.clientX - panRef.current.startX),
        offsetY: panRef.current.startOffsetY + (e.clientY - panRef.current.startY),
      });
      return;
    }

    // ── Redimensionar ──────────────────────────────────────────────────────
    const rz = resizeRef.current;
    if (rz) {
      const rack = racks.find((r) => r.layoutId === rz.layoutId);
      if (!rack) return;
      const planPt = puntoLocal(sx, sy);

      // Al marco local del rack: asi el calculo es identico este rotado o no.
      const rad = (-rack.rotation * Math.PI) / 180;
      const dx = planPt.x - rz.centro.x;
      const dy = planPt.y - rz.centro.y;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

      const anchoPx0 = rz.desde.width * ppm;
      const largoPx0 = rz.desde.length * ppm;
      const minPx = MINIMO_M * ppm;

      let anchoPx = anchoPx0;
      let largoPx = largoPx0;
      let centroLocal: Vec2 = { x: 0, y: 0 };

      if (rz.tirador.sx !== 0) {
        const ancla = -rz.tirador.sx * (anchoPx0 / 2);
        let borde = snapEnabled ? snapValue(lx, gridSize) : lx;
        if (Math.abs(borde - ancla) < minPx) borde = ancla + Math.sign(rz.tirador.sx) * minPx;
        anchoPx = Math.abs(borde - ancla);
        centroLocal.x = (borde + ancla) / 2;
      }
      if (rz.tirador.sy !== 0) {
        const ancla = -rz.tirador.sy * (largoPx0 / 2);
        let borde = snapEnabled ? snapValue(ly, gridSize) : ly;
        if (Math.abs(borde - ancla) < minPx) borde = ancla + Math.sign(rz.tirador.sy) * minPx;
        largoPx = Math.abs(borde - ancla);
        centroLocal.y = (borde + ancla) / 2;
      }

      // MAYUS: proporcion intacta. Manda el eje que mas ha cambiado, y el otro le
      // sigue reanclando su lado opuesto para que la figura no se descentre.
      if (e.shiftKey && anchoPx0 > 0 && largoPx0 > 0) {
        const kx = rz.tirador.sx !== 0 ? anchoPx / anchoPx0 : 1;
        const ky = rz.tirador.sy !== 0 ? largoPx / largoPx0 : 1;
        const k = Math.max(kx, ky);
        anchoPx = Math.max(minPx, anchoPx0 * k);
        largoPx = Math.max(minPx, largoPx0 * k);
        centroLocal = {
          x: rz.tirador.sx !== 0 ? (rz.tirador.sx * (anchoPx - anchoPx0)) / 2 : 0,
          y: rz.tirador.sy !== 0 ? (rz.tirador.sy * (largoPx - largoPx0)) / 2 : 0,
        };
      }

      // Vuelta a coordenadas del plano: el centro local se rota con el rack.
      const r2 = (rack.rotation * Math.PI) / 180;
      updateRack(rz.layoutId, {
        width: anchoPx / ppm,
        length: largoPx / ppm,
        x: rz.centro.x + centroLocal.x * Math.cos(r2) - centroLocal.y * Math.sin(r2),
        y: rz.centro.y + centroLocal.x * Math.sin(r2) + centroLocal.y * Math.cos(r2),
      });
      return;
    }

    // ── Mover ──────────────────────────────────────────────────────────────
    if (dragRef.current) {
      const planPt = puntoLocal(sx, sy);
      let newX = dragRef.current.startRack.x + (planPt.x - dragRef.current.startPlan.x);
      let newY = dragRef.current.startRack.y + (planPt.y - dragRef.current.startPlan.y);
      if (snapEnabled) {
        newX = snapValue(newX, gridSize);
        newY = snapValue(newY, gridSize);
      }
      updateRack(dragRef.current.layoutId, { x: newX, y: newY });
      return;
    }

    // Sin gesto activo: solo se calcula el cursor sobre los tiradores.
    if (isEditing && rackSeleccionado && !rackSeleccionado.locked && !espacio) {
      setSobreTirador(tiradorEn({ x: sx, y: sy }, rackSeleccionado, ppm, vt));
    } else if (sobreTirador) {
      setSobreTirador(null);
    }
  }, [
    vt, racks, rackSeleccionado, ppm, snapEnabled, gridSize, isEditing, espacio,
    sobreTirador, puntoLocal, updateRack,
  ]);

  const onPointerUp = useCallback(() => {
    if (panRef.current.active) {
      panRef.current.active = false;
      return;
    }
    const rz = resizeRef.current;
    if (rz) {
      const rack = racks.find((r) => r.layoutId === rz.layoutId);
      if (rack && (rack.width !== rz.desde.width || rack.length !== rz.desde.length)) {
        recordAction({
          type: 'resize-rack',
          layoutId: rz.layoutId,
          from: rz.desde,
          to: { width: rack.width, length: rack.length },
        });
      }
      resizeRef.current = null;
      return;
    }
    if (dragRef.current) {
      const rack = racks.find((r) => r.layoutId === dragRef.current!.layoutId);
      if (rack) {
        recordAction({
          type: 'move-rack',
          layoutId: rack.layoutId,
          from: dragRef.current.startRack,
          to: { x: rack.x, y: rack.y },
        });
      }
      dragRef.current = null;
    }
  }, [racks, recordAction]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setVt(zoomAt(vt, e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? -1 : 1));
  }, [vt]);

  const confirmarCalibracion = () => {
    if (!calPendiente) return;
    const metros = Number.parseFloat(distancia.replace(',', '.'));
    if (!Number.isFinite(metros) || metros <= 0) return;
    const anterior = { ...calibration };
    const nueva = {
      pixelsPerMeter: calPendiente.px / metros,
      points: {
        p1: calPendiente.p1,
        p2: calPendiente.p2,
        realDistance: metros,
        unit: 'meters' as const,
      },
    };
    setCalibration(nueva);
    recordAction({ type: 'calibrate', from: anterior, to: nueva });
    setCalPendiente(null);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: espacio || panRef.current.active || mode === 'pan'
            ? 'grab'
            : mode === 'calibrate' || mode === 'set-origin'
              ? 'crosshair'
              : sobreTirador
                ? cursorDeTirador(sobreTirador)
                : 'default',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        aria-label="Lienzo del editor de plano"
      />

      {/* Ayuda del gesto de calibrar: sin ella, el modo se queda esperando clics
          sin decir cuantos ni para que. */}
      {mode === 'calibrate' && !calPendiente && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-[var(--radius-sm)] px-3 py-1.5 [background:var(--glass-3)] shadow-[var(--rim-1)]">
          <span className="t-mono-xs text-[var(--text-secondary)]">
            {calRef.current.p1
              ? 'Marca el segundo punto de una distancia que conozcas'
              : 'Marca el primer punto de una distancia que conozcas'}
          </span>
        </div>
      )}

      <Modal
        abierto={calPendiente !== null}
        titulo="Calibrar la escala"
        descripcion={
          calPendiente
            ? `Has marcado ${calPendiente.px.toFixed(0)} px del plano. ¿Cuantos metros son en el almacen?`
            : undefined
        }
        onCerrar={() => setCalPendiente(null)}
        acciones={
          <>
            <Button variant="ghost" size="xs" onClick={() => setCalPendiente(null)}>
              Cancelar
            </Button>
            <Button
              variant="command"
              size="xs"
              onClick={confirmarCalibracion}
              disabled={!(Number.parseFloat(distancia.replace(',', '.')) > 0)}
            >
              Calibrar
            </Button>
          </>
        }
      >
        <label className="flex items-center gap-3">
          <span className="t-label shrink-0">Distancia real</span>
          <input
            type="text"
            inputMode="decimal"
            value={distancia}
            onChange={(e) => setDistancia(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmarCalibracion();
            }}
            placeholder="112.62"
            className="h-8 w-full rounded-[var(--radius-xs)] px-2 font-[family-name:var(--font-data)] text-[length:var(--text-sm)] tabular-nums text-[var(--text-primary)] [background:var(--glass-2)] outline-none focus:shadow-[var(--focus-ring)]"
          />
          <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">m</span>
        </label>
        {calPendiente && Number.parseFloat(distancia.replace(',', '.')) > 0 && (
          <p className="t-mono-xs text-[var(--text-faint)]">
            escala resultante:{' '}
            {(calPendiente.px / Number.parseFloat(distancia.replace(',', '.'))).toFixed(2)} px/m
          </p>
        )}
      </Modal>
    </div>
  );
}

// ── Tiradores ───────────────────────────────────────────────────────────────

/** Centro de cada tirador en PANTALLA. */
function centrosTiradores(
  rack: PositionedRack,
  ppm: number,
  vt: ViewportTransform,
): { t: Tirador; p: Vec2 }[] {
  const hw = (rack.width * ppm) / 2;
  const hl = (rack.length * ppm) / 2;
  const rad = (rack.rotation * Math.PI) / 180;
  return TIRADORES.map((t) => {
    const lx = t.sx * hw;
    const ly = t.sy * hl;
    const planPt = {
      x: rack.x + lx * Math.cos(rad) - ly * Math.sin(rad),
      y: rack.y + lx * Math.sin(rad) + ly * Math.cos(rad),
    };
    return { t, p: planToScreen(planPt, vt) };
  });
}

function tiradorEn(
  pantalla: Vec2,
  rack: PositionedRack,
  ppm: number,
  vt: ViewportTransform,
): Tirador | null {
  for (const { t, p } of centrosTiradores(rack, ppm, vt)) {
    if (Math.abs(pantalla.x - p.x) <= TOLERANCIA && Math.abs(pantalla.y - p.y) <= TOLERANCIA) {
      return t;
    }
  }
  return null;
}

function cursorDeTirador(t: Tirador): string {
  if (t.sx === 0) return 'ns-resize';
  if (t.sy === 0) return 'ew-resize';
  return t.sx === t.sy ? 'nwse-resize' : 'nesw-resize';
}

function drawTiradores(
  ctx: CanvasRenderingContext2D,
  rack: PositionedRack,
  ppm: number,
  vt: ViewportTransform,
) {
  const color = rack.color ?? COLOR_RACK_POR_DEFECTO;
  ctx.save();
  for (const { p } of centrosTiradores(rack, ppm, vt)) {
    ctx.fillStyle = '#0b1220';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(p.x - LADO_TIRADOR / 2, p.y - LADO_TIRADOR / 2, LADO_TIRADOR, LADO_TIRADOR);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ── Pintado ─────────────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, vt: ViewportTransform, w: number, h: number) {
  const spacing = 50;
  ctx.strokeStyle = 'rgba(100,140,180,0.06)';
  ctx.lineWidth = 1 / vt.zoom;

  const tl = screenToPlan({ x: 0, y: 0 }, vt);
  const br = screenToPlan({ x: w, y: h }, vt);

  ctx.beginPath();
  const startX = Math.floor(tl.x / spacing) * spacing;
  for (let x = startX; x <= br.x; x += spacing) {
    ctx.moveTo(x, tl.y);
    ctx.lineTo(x, br.y);
  }
  const startY = Math.floor(tl.y / spacing) * spacing;
  for (let y = startY; y <= br.y; y += spacing) {
    ctx.moveTo(tl.x, y);
    ctx.lineTo(br.x, y);
  }
  ctx.stroke();
}

function drawAxes(ctx: CanvasRenderingContext2D, origin: Vec2, w: number, h: number) {
  ctx.strokeStyle = 'rgba(255,80,80,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, origin.y);
  ctx.lineTo(w, origin.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80,255,80,0.5)';
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, h);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawRack(
  ctx: CanvasRenderingContext2D,
  rack: PositionedRack,
  selected: boolean,
  holographic: boolean,
  ppm: number,
) {
  const w = rack.width * ppm;
  const l = rack.length * ppm;
  const color = rack.color ?? COLOR_RACK_POR_DEFECTO;

  ctx.save();
  ctx.translate(rack.x, rack.y);
  ctx.rotate((rack.rotation * Math.PI) / 180);

  // Relleno traslucido: debajo esta el plano y taparlo del todo obligaria a
  // apagar la capa del rack para comprobar si esta bien puesto.
  ctx.globalAlpha = holographic ? (selected ? 0.32 : 0.2) : selected ? 0.45 : 0.3;
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -l / 2, w, l);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2 : 1;
  if (holographic) {
    ctx.shadowColor = color;
    ctx.shadowBlur = selected ? 12 : 4;
  }
  ctx.strokeRect(-w / 2, -l / 2, w, l);
  ctx.shadowBlur = 0;

  if (rack.locked) {
    ctx.fillStyle = 'rgba(245,158,11,0.7)';
    ctx.beginPath();
    ctx.arc(0, -l / 2 - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawRackLabel(ctx: CanvasRenderingContext2D, rack: PositionedRack, ppm: number) {
  ctx.save();
  ctx.translate(rack.x, rack.y);
  ctx.fillStyle = 'rgba(200,220,240,0.8)';
  ctx.font = '10px "JetBrains Mono Variable", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(rack.rackCode, 0, -(rack.length * ppm) / 2 - 4);
  ctx.restore();
}

function drawCalibrationLine(ctx: CanvasRenderingContext2D, p1: Vec2, p2: Vec2) {
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#f59e0b';
  for (const p of [p1, p2]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hitTestRack(planPt: Vec2, racks: PositionedRack[], ppm: number): PositionedRack | null {
  for (let i = racks.length - 1; i >= 0; i--) {
    const rack = racks[i]!;
    const w = rack.width * ppm;
    const l = rack.length * ppm;
    const dx = planPt.x - rack.x;
    const dy = planPt.y - rack.y;
    const rad = (-rack.rotation * Math.PI) / 180;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (lx >= -w / 2 && lx <= w / 2 && ly >= -l / 2 && ly <= l / 2) return rack;
  }
  return null;
}
