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

import { Lock } from 'lucide-react';

import { Modal } from '../../../../design/foundation/Modal';
import { Button } from '../../../../design/primitives/Button';
import { cajaDe } from '../alinear';
import { useEditorStore } from '../store';
import {
  fitBounds,
  planToScreen,
  screenToPlan,
  zoomAt,
  type Vec2,
  type ViewportTransform,
} from '../transforms';
import { colorDeOcupacion } from '../../cluster3d/escena';
import { snapToGrid as snapValue } from '../snap';
import { COLOR_RACK_POR_DEFECTO, type PositionedRack } from '../types';

interface LayoutEditorCanvasProps {
  className?: string | undefined;
  /**
   * Ocupacion por CODIGO de rack, para la capa de mapa de calor.
   *
   * Por codigo y no por uuid porque es la clave que el editor maneja: aqui un rack
   * es `rackCode`, y traducir a uuid obligaria a tener el catalogo cargado para
   * poder colorear. Un rack ausente del mapa se pinta de gris —«sin dato»— y no de
   * vacio: son cosas distintas.
   */
  ocupacion?: ReadonlyMap<string, number | null> | undefined;
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
/** Distancia en PANTALLA del tirador de giro al borde superior del rack. */
const DISTANCIA_GIRO = 26;
/** Con Mayus, el giro cae en multiplos de esto. 15° cubre 30, 45, 60 y 90. */
const PASO_GIRO = 15;

export function LayoutEditorCanvas({ className, ocupacion }: LayoutEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [espacio, setEspacio] = useState(false);
  const [sobreTirador, setSobreTirador] = useState<Tirador | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);

  const {
    plan, calibration, reference, racks, selectedRackId, selectedRackIds, layers,
    mode, visualMode, isEditing, selectRack, selectRacks, toggleRackSelection,
    updateRack, updateRacks, setCalibration, setReference, recordAction,
    snapToGrid: snapEnabled, gridMeters,
    viewport: vt, setViewport: setVt, setCanvasSize,
  } = useEditorStore();

  const panRef = useRef({ active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });
  /**
   * Arrastre. `inicios` lleva la posicion de partida de CADA rack arrastrado.
   *
   * Con seleccion multiple no basta un delta aplicado al rack pinchado: si cada
   * uno se recalculara desde su posicion actual, los redondeos del ajuste a
   * rejilla se acumularian y la formacion se deformaria al arrastrar.
   */
  const dragRef = useRef<{
    startPlan: Vec2;
    inicios: { layoutId: string; x: number; y: number }[];
  } | null>(null);
  /** Marco de seleccion, en coordenadas de PANTALLA. */
  const marcoRef = useRef<{ x0: number; y0: number } | null>(null);
  const [marco, setMarco] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /**
   * Giro libre. Guarda el angulo de partida y el del puntero en ese instante, y
   * aplica la DIFERENCIA: sin eso, el rack salta al angulo del cursor en cuanto se
   * pincha el tirador, en lugar de girar desde donde estaba.
   */
  const giroRef = useRef<{ layoutId: string; desde: number; anguloPuntero: number } | null>(null);
  const [sobreGiro, setSobreGiro] = useState(false);
  /**
   * Rack bloqueado bajo el cursor.
   *
   * Existe para poder AVISAR antes de intentarlo. Sin esto, apuntar a un rack
   * bloqueado se ve igual que apuntar a uno libre y el arrastre no hace nada: el
   * operador concluye «no se puede mover» sin saber que hay un candado.
   */
  const [sobreBloqueado, setSobreBloqueado] = useState<PositionedRack | null>(null);
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
      // Se publica para que la paleta pueda calcular zoom y encuadres sin conocer
      // el DOM del lienzo.
      setCanvasSize({ w: width, h: height });
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [setCanvasSize]);

  useEffect(() => {
    if (!plan || size.w === 0) return;
    setVt(fitBounds(plan.width, plan.height, size.w, size.h));
  }, [plan, size.w, size.h, setVt]);

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
      // La rejilla que se DIBUJA es la que AJUSTA. Antes se pintaba cada 50 px y
      // se ajustaba cada 20: las lineas que se veian no eran donde caian las
      // cosas, que es la peor rejilla posible.
      if (layers.grid) drawGrid(ctx, vt, size.w, size.h, gridMeters * ppm);
      if (layers.axes) drawAxes(ctx, reference.origin, plan?.width ?? 2000, plan?.height ?? 2000);
      if (layers.racks) {
        // El mapa de calor solo se aplica si la capa esta encendida Y hay dato. Con
        // la capa encendida y sin dato se pintaria el almacen entero de gris, que
        // parece una averia del editor y no una ausencia de inventario.
        const calor = layers.heatmap && ocupacion != null && ocupacion.size > 0;
        for (const rack of racks) {
          drawRack(
            ctx, rack, selectedRackIds.includes(rack.layoutId),
            visualMode === 'holographic', ppm, vt.zoom,
            calor ? (ocupacion.get(rack.rackCode) ?? null) : undefined,
          );
        }
      }
      if (mode === 'calibrate' && calRef.current.p1) {
        const fin = cursor ? screenToPlan(cursor, vt) : calRef.current.p1;
        drawCalibrationLine(ctx, calRef.current.p1, calPendiente?.p2 ?? fin);
      }
      ctx.restore();

      /*
        Etiquetas en PANTALLA, no en el plano.

        Antes se dibujaban dentro de la transformacion, a `-length/2 - 4` del
        centro y sin deshacer la rotacion: en un rack girado 90° el codigo
        aparecia al lado en vez de encima, y el tamaño del texto crecia con el
        zoom hasta tapar el plano. Ahora todas van en el mismo sitio —centradas
        sobre la caja envolvente— y con el mismo cuerpo de letra.
      */
      if (layers.labels) {
        ctx.font = '11px "JetBrains Mono Variable", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (const rack of racks) {
          const caja = cajaDe(rack, ppm);
          const arriba = planToScreen({ x: (caja.x0 + caja.x1) / 2, y: caja.y0 }, vt);
          if (arriba.x < -60 || arriba.x > size.w + 60 || arriba.y < 0 || arriba.y > size.h + 40) {
            continue; // fuera de la vista: no se pinta lo que no se ve
          }
          const seleccionado = selectedRackIds.includes(rack.layoutId);
          ctx.fillStyle = seleccionado
            ? (rack.color ?? COLOR_RACK_POR_DEFECTO)
            : 'rgba(200,220,240,0.75)';
          ctx.fillText(rack.rackCode, arriba.x, arriba.y - 6);
        }
      }

      // Tiradores FUERA de la transformacion: tamaño constante en pantalla. Solo
      // con UN rack seleccionado: redimensionar varios a la vez con un tirador
      // comun es otra herramienta, y mostrarla sin que funcione seria mentir.
      if (
        layers.selection && isEditing && selectedRackIds.length === 1 &&
        rackSeleccionado && !rackSeleccionado.locked
      ) {
        drawTiradores(ctx, rackSeleccionado, ppm, vt);
        drawTiradorDeGiro(ctx, rackSeleccionado, ppm, vt);
      }

      // Marco de seleccion, tambien en pantalla.
      if (marco) {
        const x = Math.min(marco.x0, marco.x1);
        const y = Math.min(marco.y0, marco.y1);
        const w = Math.abs(marco.x1 - marco.x0);
        const h = Math.abs(marco.y1 - marco.y0);
        ctx.fillStyle = 'rgba(34,217,245,0.10)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(34,217,245,0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
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
      if (enTiradorDeGiro({ x: sx, y: sy }, rackSeleccionado, ppm, vt)) {
        const c = planToScreen({ x: rackSeleccionado.x, y: rackSeleccionado.y }, vt);
        giroRef.current = {
          layoutId: rackSeleccionado.layoutId,
          desde: rackSeleccionado.rotation,
          anguloPuntero: (Math.atan2(sy - c.y, sx - c.x) * 180) / Math.PI,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

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

    // Ctrl/Cmd o Mayus sobre un rack: añade o quita de la seleccion sin arrastrar.
    // Arrastrar en el mismo gesto en el que se añade produce movimientos
    // involuntarios al ir haciendo clic en varios.
    if (hit && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      toggleRackSelection(hit.layoutId);
      return;
    }

    if (hit) {
      // Pinchar dentro de una seleccion multiple la CONSERVA y arrastra el
      // conjunto; pinchar fuera de ella la reemplaza.
      const enSeleccion = selectedRackIds.includes(hit.layoutId);
      if (!enSeleccion) selectRack(hit.layoutId);

      if (isEditing) {
        const aMover = (enSeleccion ? racks.filter((r) => selectedRackIds.includes(r.layoutId)) : [hit])
          .filter((r) => !r.locked);
        if (aMover.length > 0) {
          dragRef.current = {
            startPlan: planPt,
            inicios: aMover.map((r) => ({ layoutId: r.layoutId, x: r.x, y: r.y })),
          };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
      }
      return;
    }

    // Vacio: marco de seleccion. Sin modo edicion solo deselecciona, porque un
    // marco que no puede hacer nada con lo que atrapa solo estorba.
    if (isEditing) {
      marcoRef.current = { x0: sx, y0: sy };
      setMarco({ x0: sx, y0: sy, x1: sx, y1: sy });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) selectRacks([]);
  }, [
    espacio, mode, racks, rackSeleccionado, selectedRackIds, ppm, vt, reference, isEditing,
    puntoLocal, selectRack, selectRacks, toggleRackSelection, setReference, recordAction,
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

    // ── Girar ──────────────────────────────────────────────────────────────
    const gr = giroRef.current;
    if (gr) {
      const rack = racks.find((r) => r.layoutId === gr.layoutId);
      if (!rack) return;
      const c = planToScreen({ x: rack.x, y: rack.y }, vt);
      const ahora = (Math.atan2(sy - c.y, sx - c.x) * 180) / Math.PI;
      let angulo = gr.desde + (ahora - gr.anguloPuntero);
      // Mayus fija angulos utiles. Sin Mayus el giro es LIBRE: hasta ahora solo se
      // podia girar de 90 en 90 con la tecla R, y una nave real tiene racks a 30°.
      if (e.shiftKey) angulo = Math.round(angulo / PASO_GIRO) * PASO_GIRO;
      // Normalizado a [0, 360): un -270 en el inspector no dice nada.
      updateRack(gr.layoutId, { rotation: ((angulo % 360) + 360) % 360 });
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
      // Alt INVIERTE el ajuste mientras dura el gesto: con la rejilla encendida
      // permite una medida libre, y con ella apagada permite clavar una cota
      // redonda. Es el atajo que ya existe en cualquier editor de dibujo.
      const ajustar = snapEnabled !== e.altKey;
      const pasoPx = gridMeters * ppm;

      let anchoPx = anchoPx0;
      let largoPx = largoPx0;
      let centroLocal: Vec2 = { x: 0, y: 0 };

      if (rz.tirador.sx !== 0) {
        const ancla = -rz.tirador.sx * (anchoPx0 / 2);
        let borde = ajustar ? snapValue(lx, pasoPx) : lx;
        if (Math.abs(borde - ancla) < minPx) borde = ancla + Math.sign(rz.tirador.sx) * minPx;
        anchoPx = Math.abs(borde - ancla);
        centroLocal.x = (borde + ancla) / 2;
      }
      if (rz.tirador.sy !== 0) {
        const ancla = -rz.tirador.sy * (largoPx0 / 2);
        let borde = ajustar ? snapValue(ly, pasoPx) : ly;
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

    // ── Marco de seleccion ─────────────────────────────────────────────────
    if (marcoRef.current) {
      setMarco({ x0: marcoRef.current.x0, y0: marcoRef.current.y0, x1: sx, y1: sy });
      return;
    }

    // ── Mover (uno o varios) ───────────────────────────────────────────────
    if (dragRef.current) {
      const planPt = puntoLocal(sx, sy);
      const dx = planPt.x - dragRef.current.startPlan.x;
      const dy = planPt.y - dragRef.current.startPlan.y;
      const ajustar = snapEnabled !== e.altKey;
      const pasoPx = gridMeters * ppm;
      const inicios = dragRef.current.inicios;

      const destinos = inicios.map((i) => {
        if (!ajustar) return { x: i.x + dx, y: i.y + dy };
        // Con UN rack se ajusta la POSICION final: es lo que se espera al
        // arrimarlo a una linea. Con varios se ajusta el DESPLAZAMIENTO, porque
        // llevar cada uno a la linea mas cercana los amontonaria y desharia la
        // formacion que se esta moviendo.
        if (inicios.length === 1) {
          return { x: snapValue(i.x + dx, pasoPx), y: snapValue(i.y + dy, pasoPx) };
        }
        return { x: i.x + snapValue(dx, pasoPx), y: i.y + snapValue(dy, pasoPx) };
      });

      updateRacks(
        inicios.map((i, n) => ({ layoutId: i.layoutId, updates: destinos[n]! })),
      );
      return;
    }

    // Sin gesto activo: el cursor sobre los tiradores, y si lo que hay debajo es un
    // rack bloqueado —para decirlo antes de que el arrastre no haga nada—.
    // Se asigna SIEMPRE, sin leer el valor anterior: `setState` con el mismo valor no
    // provoca render, y leerlo obligaria a declararlo como dependencia de este
    // `useCallback` —que se recrearia en cada movimiento del raton—.
    const bajoCursor = isEditing
      ? hitTestRack(screenToPlan({ x: sx, y: sy }, vt), racks, ppm)
      : null;
    setSobreBloqueado(bajoCursor?.locked ? bajoCursor : null);

    if (isEditing && rackSeleccionado && !rackSeleccionado.locked && !espacio) {
      setSobreTirador(tiradorEn({ x: sx, y: sy }, rackSeleccionado, ppm, vt));
      setSobreGiro(enTiradorDeGiro({ x: sx, y: sy }, rackSeleccionado, ppm, vt));
    } else {
      if (sobreTirador) setSobreTirador(null);
      if (sobreGiro) setSobreGiro(false);
    }
  }, [
    vt, racks, rackSeleccionado, ppm, snapEnabled, gridMeters, isEditing, espacio,
    sobreTirador, sobreGiro, puntoLocal, updateRack, updateRacks, setVt,
  ]);

  const onPointerUp = useCallback(() => {
    if (panRef.current.active) {
      panRef.current.active = false;
      return;
    }

    // Marco: atrapa lo que TOCA, no solo lo que encierra por completo. Exigir que
    // el rack entre entero obliga a marcos enormes en un plano denso.
    if (marcoRef.current) {
      const m = marco;
      marcoRef.current = null;
      setMarco(null);
      if (m) {
        const x0 = Math.min(m.x0, m.x1);
        const x1 = Math.max(m.x0, m.x1);
        const y0 = Math.min(m.y0, m.y1);
        const y1 = Math.max(m.y0, m.y1);
        // Un marco de dos pixeles es un clic con la mano temblorosa, no una
        // seleccion: se ignora para no vaciar la seleccion sin querer.
        if (x1 - x0 > 3 || y1 - y0 > 3) {
          const p0 = screenToPlan({ x: x0, y: y0 }, vt);
          const p1 = screenToPlan({ x: x1, y: y1 }, vt);
          const dentro = racks.filter((r) => {
            const c = cajaDe(r, ppm);
            return c.x1 >= p0.x && c.x0 <= p1.x && c.y1 >= p0.y && c.y0 <= p1.y;
          });
          selectRacks(dentro.map((r) => r.layoutId));
        }
      }
      return;
    }
    const gr = giroRef.current;
    if (gr) {
      const rack = racks.find((r) => r.layoutId === gr.layoutId);
      if (rack && rack.rotation !== gr.desde) {
        recordAction({
          type: 'rotate-rack',
          layoutId: gr.layoutId,
          from: gr.desde,
          to: rack.rotation,
        });
      }
      giroRef.current = null;
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
      const movimientos = dragRef.current.inicios
        .map((i) => {
          const rack = racks.find((r) => r.layoutId === i.layoutId);
          if (!rack || (rack.x === i.x && rack.y === i.y)) return null;
          return { layoutId: i.layoutId, from: { x: i.x, y: i.y }, to: { x: rack.x, y: rack.y } };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      if (movimientos.length === 1) {
        recordAction({ type: 'move-rack', ...movimientos[0]! });
      } else if (movimientos.length > 1) {
        recordAction({ type: 'move-many', movimientos });
      }
      dragRef.current = null;
    }
  }, [racks, marco, vt, ppm, selectRacks, recordAction]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setVt(zoomAt(vt, e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? -1 : 1));
  }, [vt, setVt]);

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
      // Explicito y no deducido de `points`: es lo que viaja al publicar, y lo
      // que hace que otro navegador sepa que esta escala se midio.
      measured: true,
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
              : sobreGiro
                ? 'grab'
                : sobreTirador
                  ? cursorDeTirador(sobreTirador)
                  : sobreBloqueado
                    ? 'not-allowed'
                    : 'default',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        aria-label="Lienzo del editor de plano"
      />

      {/*
        AVISO DEL CANDADO, sobre el lienzo y con la salida al lado.

        Apuntar a un rack bloqueado y que el arrastre no haga nada es la peor forma de
        negarse: no hay diferencia observable con un fallo. El aviso aparece al apuntar
        —antes de intentarlo— y el boton lo resuelve sin ir a buscar el candado entre
        los iconos del inspector.
      */}
      {sobreBloqueado && !dragRef.current && (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--state-alert)]/40 px-2.5 py-1.5 [background:var(--glass-3)]">
          <Lock strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--state-alert)]" />
          <span className="t-mono-xs text-[var(--text-muted)]">
            <strong className="text-[var(--text-primary)]">{sobreBloqueado.rackCode}</strong> esta
            bloqueado: no se puede mover
          </span>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => updateRack(sobreBloqueado.layoutId, { locked: false })}
          >
            Desbloquear
          </Button>
        </div>
      )}

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

/**
 * Centro del tirador de giro, en PANTALLA.
 *
 * Va por encima del borde superior del rack y girado con el: asi el tirador
 * acompaña a la figura y el gesto se lee igual a cualquier angulo.
 */
function centroGiro(rack: PositionedRack, ppm: number, vt: ViewportTransform): Vec2 {
  const hl = (rack.length * ppm) / 2;
  const rad = (rack.rotation * Math.PI) / 180;
  const borde = planToScreen(
    { x: rack.x - -hl * Math.sin(rad), y: rack.y + -hl * Math.cos(rad) },
    vt,
  );
  const centro = planToScreen({ x: rack.x, y: rack.y }, vt);
  // Se separa DISTANCIA_GIRO pixeles de pantalla siguiendo la direccion
  // centro -> borde superior, para que no dependa del zoom.
  const dx = borde.x - centro.x;
  const dy = borde.y - centro.y;
  const largo = Math.hypot(dx, dy) || 1;
  return {
    x: borde.x + (dx / largo) * DISTANCIA_GIRO,
    y: borde.y + (dy / largo) * DISTANCIA_GIRO,
  };
}

function enTiradorDeGiro(
  pantalla: Vec2,
  rack: PositionedRack,
  ppm: number,
  vt: ViewportTransform,
): boolean {
  const c = centroGiro(rack, ppm, vt);
  return Math.hypot(pantalla.x - c.x, pantalla.y - c.y) <= TOLERANCIA + 2;
}

function drawTiradorDeGiro(
  ctx: CanvasRenderingContext2D,
  rack: PositionedRack,
  ppm: number,
  vt: ViewportTransform,
) {
  const color = rack.color ?? COLOR_RACK_POR_DEFECTO;
  const c = centroGiro(rack, ppm, vt);
  const hl = (rack.length * ppm) / 2;
  const rad = (rack.rotation * Math.PI) / 180;
  const borde = planToScreen(
    { x: rack.x + hl * Math.sin(rad), y: rack.y - hl * Math.cos(rad) },
    vt,
  );

  ctx.save();
  // Tallo: sin el, el circulo flota sin explicar a que rack pertenece.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(borde.x, borde.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1220';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
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

function drawGrid(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  w: number,
  h: number,
  pasoPx: number,
) {
  // Con el zoom alejado, un paso de 25 cm son fracciones de pixel en pantalla: se
  // pintarian miles de lineas hasta formar una masa gris. Se salta la rejilla en
  // lugar de dibujar ruido.
  if (!(pasoPx > 0) || pasoPx * vt.zoom < 4) return;
  const spacing = pasoPx;
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
  /**
   * Zoom del encuadre. Necesario para que los TRAZOS midan en pixeles de PANTALLA.
   *
   * El contexto esta escalado por el zoom, asi que `lineWidth = 1` no es un pixel:
   * es una unidad del plano. Con el plano del mezzanine ajustado a la pantalla el
   * zoom ronda 0,29, asi que un trazo de 1 salia a un tercio de pixel —medido: el
   * rayado del candado añadia 3 pixeles de color en todo el lienzo—.
   *
   * Es la misma leccion que la cabecera de este archivo ya documenta para los
   * tiradores: lo que el ojo tiene que ver se mide en pantalla, no en el plano.
   */
  zoom: number,
  /**
   * Ocupacion del rack para el mapa de calor, o `undefined` si la capa esta apagada.
   *
   * `undefined` y `null` significan cosas distintas a proposito: `undefined` es «no
   * pintes calor», `null` es «pinta calor y este rack no tiene dato» —que sale gris—.
   * Colapsarlos haria que un rack sin inventario se viera igual que uno vacio.
   */
  ocupacionPct?: number | null | undefined,
) {
  const w = rack.width * ppm;
  const l = rack.length * ppm;
  // Con el mapa de calor encendido el RELLENO pasa a decir cuanto hay dentro; el
  // TRAZO se queda con el color de agrupacion, para no perder de vista que familia
  // es cada rack mientras se mira la ocupacion.
  const color = rack.color ?? COLOR_RACK_POR_DEFECTO;
  const relleno = ocupacionPct === undefined ? color : colorDeOcupacion(ocupacionPct);

  ctx.save();
  ctx.translate(rack.x, rack.y);
  ctx.rotate((rack.rotation * Math.PI) / 180);

  // Relleno traslucido: debajo esta el plano y taparlo del todo obligaria a
  // apagar la capa del rack para comprobar si esta bien puesto.
  // Con calor el relleno sube de opacidad: 0,3 sobre un plano de fondo oscuro deja
  // el ambar y el naranja indistinguibles, y el mapa de calor deja de informar.
  ctx.globalAlpha =
    ocupacionPct !== undefined
      ? selected
        ? 0.78
        : 0.66
      : holographic
        ? selected
          ? 0.32
          : 0.2
        : selected
          ? 0.45
          : 0.3;
  ctx.fillStyle = relleno;
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

  // ── El candado, VISIBLE ─────────────────────────────────────────────────
  //
  // Antes era un punto ambar de 3 px sobre el borde superior. A la escala de un
  // almacen de 112 m eso no se ve, y encima quedaba FUERA del rack, donde se
  // confunde con el vecino. El operador reporto «MZ08 no lo puedo mover» sin nada
  // en pantalla que se lo explicara.
  //
  // Ahora se raya el cuerpo entero en diagonal y el borde va discontinuo: son las dos
  // señales que se leen a cualquier zoom y que no se pueden confundir con un color de
  // agrupacion —el rayado no es un tinte—. La barra vale para 4 px de ancho y para 400.
  if (rack.locked) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -l / 2, w, l);
    ctx.clip();
    ctx.strokeStyle = 'rgba(245,158,11,0.55)';
    // 1,25 px de PANTALLA, y el paso entre rayas tambien: a 8 px de separacion el
    // rayado se lee como rayado a cualquier zoom, mientras que en unidades del plano
    // se convertia en una mancha al acercar y en nada al alejar.
    ctx.lineWidth = 1.25 / zoom;
    const paso = 8 / zoom;
    for (let d = -l; d < w + l; d += paso) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + d, -l / 2);
      ctx.lineTo(-w / 2 + d - l, l / 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(245,158,11,0.9)';
    ctx.lineWidth = (selected ? 2.5 : 2) / zoom;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.strokeRect(-w / 2, -l / 2, w, l);
    ctx.restore();
  }

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
