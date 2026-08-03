/**
 * VISOR DEL RACK — axonometrico, sobre Canvas 2D.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE CANVAS 2D Y NO THREE.JS
 *
 * El proyecto tiene 26 dependencias y NINGUNA grafica. Añadir three.js +
 * react-three-fiber + drei son ~600 KB de bundle para dibujar cajas alineadas a
 * una rejilla, y el engine anterior de este modulo ya trabajaba sobre Canvas 2D
 * con el mismo patron (viewport, camara y hit-testing separados del render).
 *
 * Lo que SI se toma del enfoque 3D: painter's algorithm para la oclusion, hit
 * testing por poligono (el equivalente al raycasting en esta proyeccion) y
 * separacion de material (`materials.ts`) respecto de geometria (`geometry.ts`).
 *
 * ── EL ORDEN DE PINTADO ES EL DISEÑO ────────────────────────────────────────
 *
 * Diez pasos, y el orden importa mas que cualquier valor de opacidad:
 *
 *   1  piso tecnico                  referencia de profundidad
 *   2  guias de nivel                la linea horizontal que se puede seguir
 *   3  bastidor del FONDO            tenue: esta lejos
 *   4  travesaños de profundidad     punteados: no se confunden con vigas
 *   5  celdas, fondo → frente        painter's algorithm
 *   6  bastidor del FRENTE           cruza POR DELANTE de la carga
 *   7  etiquetas de nivel y cuerpo   con guia y chip, no flotando
 *   8  celda bajo el cursor          realce y halo
 *   9  celda seleccionada            borde doble + halo, por encima de todo
 *
 * El paso 6 es el que convierte un conjunto de cajas de color en una estanteria:
 * en el almacen el bastidor esta delante de la carga, y hasta ahora se dibujaba
 * detras. El paso 9 hace cumplir la jerarquia —seleccion > rack > estructura >
 * rejilla > fondo— sin depender de que nada la tape.
 *
 * ── LO QUE NO DIBUJA ────────────────────────────────────────────────────────
 *
 * Ni pallets, ni articulos, ni cantidades, ni ocupacion, ni confianza, ni
 * evidencia: **esos datos no existen todavia**. El componente acepta
 * `inspectionOverlay` para cuando existan, y si no llega, la capa de inspeccion
 * aparece deshabilitada. No se simula.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import { INSPECTION_META, type InspectionOverlayMap } from '../inspection';
import { STATUS_META, situationLabel } from '../components/StatusLegend';
import type { RackFrontCell, RackFrontView } from '../types/index';
import type { VisualLayer } from '../viewTypes';
import {
  bayLabelAnchor,
  buildFloorGrid,
  buildFrames,
  buildLevelGuides,
  buildRackGeometry,
  BAY_GAP,
  bayWidth,
  CELL_H,
  CELL_W,
  DEPTH_SHIFT,
  LABEL_DROP,
  faceBand,
  hitTest,
  levelLabelAnchor,
  project,
  projectCellBack,
  projectCellFace,
  projectCellOpening,
  projectCellWallFloor,
  projectCellWallLeft,
  projectedBounds,
  rackSpanX,
  sortForPainting,
  type RackCellSlot,
} from './geometry';
import {
  HOLO,
  PAINT,
  hatchPattern,
  path,
  resolveColor,
  segment,
  stroke,
  toScreen,
  type Camara,
} from './materials';

interface Props {
  view: RackFrontView;
  selectedLocationId: string | null;
  onSelect: (cell: RackFrontCell) => void;
  /** Capa de color activa. `inspection` requiere `inspectionOverlay`. */
  layer: VisualLayer;
  /** Resultados de inspeccion. Ausente mientras no existan lecturas. */
  inspectionOverlay?: InspectionOverlayMap | undefined;
  className?: string | undefined;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 6;

/**
 * Margenes del encuadre, en pixeles.
 *
 * Asimetricos a proposito, y ninguno de los cuatro es «aire»:
 *
 *   izq    columna de etiquetas N0x
 *   abajo  fila de etiquetas C0xx
 *   der    rosa de ejes y controles de camara — sin esta banda el rack pasa por
 *          debajo de ellos, que es lo que hacia con 26 px
 *   arriba respiro del remate superior del bastidor
 */
const PAD = { izq: 58, der: 92, arriba: 16, abajo: 34 };

/**
 * Limites de la altura de un nivel EN PIXELES.
 *
 * Son el criterio de encuadre, y sustituyen al anterior «la altura manda», que con
 * un lienzo grande producia niveles de 90 px: solo cabian 5 cuerpos de 27 y el
 * bastidor desaparecia bajo la carga.
 *
 *   · 24 px  es el suelo por debajo del cual dos niveles se confunden
 *   · 62 px  es el techo por encima del cual solo se gana espacio vacio
 *
 * Entre esos dos, se prefiere ver el rack COMPLETO: contar los cuerpos es la tarea,
 * y para eso hay que verlos todos.
 */
const NIVEL_PX = { min: 24, max: 62 };

/** Periodo del latido de la seleccion. Muy lento: 2,6 s. */
const PULSO_SELECCION = 2600;

/**
 * Retícula CAD del fondo del visor.
 *
 * Va en CSS y no en el canvas: es estatica en pantalla —no se desplaza con la
 * camara, como el papel milimetrado bajo el dibujo— y asi no cuesta un repintado.
 */
const FONDO_CAD =
  'repeating-linear-gradient(135deg, rgba(120,150,190,0.02) 0 1px, transparent 1px 24px), ' +
  'repeating-linear-gradient(to right, rgba(120,150,190,0.032) 0 1px, transparent 1px 64px), ' +
  'repeating-linear-gradient(to bottom, rgba(120,150,190,0.032) 0 1px, transparent 1px 64px), ' +
  'radial-gradient(ellipse 90% 70% at 50% 108%, rgba(34,217,245,0.05) 0%, transparent 70%)';

export function Rack3DView({
  view,
  selectedLocationId,
  onSelect,
  layer,
  inspectionOverlay,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const [camara, setCamara] = useState<Camara | null>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<RackCellSlot | null>(null);
  const [soportaCanvas, setSoportaCanvas] = useState(true);
  const arrastre = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const geo = useMemo(() => buildRackGeometry(view), [view]);
  const pintado = useMemo(() => sortForPainting(geo.slots), [geo]);
  const marco = useMemo(() => buildFrames(geo), [geo]);
  const piso = useMemo(() => buildFloorGrid(geo), [geo]);
  const guias = useMemo(() => buildLevelGuides(geo), [geo]);
  const limites = useMemo(() => projectedBounds(geo), [geo]);
  const tramo = useMemo(() => rackSpanX(geo), [geo]);

  // ── Encuadre: la altura de un NIVEL es el criterio ────────────────────────
  //
  // Ni «que quepa todo» ni «que la altura mande» dan un resultado usable por si
  // solos, y los dos se probaron:
  //
  //   · encuadrar por ANCHO deja los 7 niveles de RCL01 en 60 px sobre un panel de
  //     694 px — una tira en la que no se distingue un nivel de otro;
  //   · encuadrar por ALTO, con el lienzo ya a pantalla completa, da niveles de
  //     90 px y solo 5 cuerpos de 27 visibles: el bastidor desaparece bajo la carga
  //     y no hay forma de contar cuerpos.
  //
  // El criterio correcto no es una dimension, es la LEGIBILIDAD DE UN NIVEL: se
  // muestra el rack entero mientras un nivel no baje de 24 px, y no se pasa de 62 px
  // porque por encima solo se gana hueco. Lo que no cabe se recorre.
  const encuadrar = useCallback(() => {
    const { w, h } = tam;
    if (w === 0 || h === 0) return;
    const anchoMundo = Math.max(1, limites.maxX - limites.minX);
    const altoMundo = Math.max(1, limites.maxY - limites.minY);

    const utilW = Math.max(80, w - PAD.izq - PAD.der);
    const utilH = Math.max(80, h - PAD.arriba - PAD.abajo);

    const zoom = Math.max(
      ZOOM_MIN,
      Math.min(
        ZOOM_MAX,
        // Nunca mas alto de lo que caben los niveles, ni de 62 px por nivel…
        Math.min(utilH / altoMundo, NIVEL_PX.max / CELL_H),
        // …y dentro de eso, lo que haga falta para ver el rack entero, con 24 px
        // por nivel como suelo irrenunciable.
        Math.max(utilW / anchoMundo, NIVEL_PX.min / CELL_H),
      ),
    );

    // Tolerancia de 1 px: cuando el zoom sale EXACTAMENTE de `utilW / anchoMundo`, la
    // comparacion cae del lado de «no cabe» por redondeo de coma flotante, y el rack
    // se pegaba a la izquierda cuando en realidad cabia justo.
    const cabeElAncho = anchoMundo * zoom <= utilW + 1;
    setCamara({
      zoom,
      // Si no cabe, se alinea a la IZQUIERDA: el cuerpo 1 es el punto de partida
      // natural de un recorrido, y centrarlo dejaria los primeros fuera de pantalla.
      panX: cabeElAncho
        ? w / 2 - ((limites.minX + limites.maxX) / 2) * zoom
        : PAD.izq - limites.minX * zoom,
      panY: h / 2 - ((limites.minY + limites.maxY) / 2) * zoom,
    });
  }, [limites, tam]);

  // `view.rackId` en las dependencias: cambiar de rack REEMPLAZA la geometria y
  // reencuadra. Sin esto, el rack nuevo aparece con la camara del anterior y
  // puede quedar fuera de la pantalla.
  useEffect(() => {
    encuadrar();
  }, [encuadrar, view.rackId]);

  useEffect(() => {
    const cont = contenedorRef.current;
    if (!cont) return;
    const medir = () => setTam({ w: cont.clientWidth, h: cont.clientHeight });
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(cont);
    return () => ro.disconnect();
  }, []);

  // ── Color de una celda segun la capa activa ───────────────────────────────
  //
  // Devuelve el color BASE. Las opacidades del material —cara, base, canto, cara
  // superior, lateral— las aplica el pintado desde `HOLO`, para que una celda verde
  // y una ambar tengan exactamente el mismo material y solo cambie el tono.
  const colorDe = useCallback(
    (slot: RackCellSlot): { base: string; pulso: boolean; trama: boolean } | null => {
      if (!slot.cell) return null;

      if (layer === 'inspection') {
        const ov = inspectionOverlay?.[slot.cell.locationId];
        // Sin overlay, TODO esta «sin leer». Es la verdad: no hay lecturas.
        const meta = INSPECTION_META[ov?.inspectionStatus ?? 'not_scanned'];
        return { base: meta.color, pulso: meta.pulse === true, trama: false };
      }

      if (layer === 'wms') {
        const sit = slot.cell.situation;
        // Vocabulario ABIERTO: no se puede mapear a colores fijos sin inventar
        // categorias. Se codifica por familia, que es lo que el operador distingue.
        const bloqueada = sit != null && sit.startsWith('BLOQ');
        const base =
          sit == null
            ? 'var(--text-faint)'
            : sit === 'OCUP'
              ? 'var(--aqua-400)'
              : bloqueada
                ? 'var(--ember-400)'
                : sit === 'DISP'
                  ? 'var(--mint-400)'
                  : 'var(--iris-400)';
        return { base, pulso: false, trama: bloqueada };
      }

      const estado = slot.cell.status;
      return {
        base: STATUS_META[estado].color,
        pulso: false,
        // La trama es la SEGUNDA señal del estado: en escala de grises, o con un
        // daltonismo rojo-verde, ambar y verde son el mismo relleno.
        trama: estado === 'blocked',
      };
    },
    [layer, inspectionOverlay],
  );

  // ── Pintado ───────────────────────────────────────────────────────────────
  //
  // Una sola funcion, invocada por el efecto de dependencias y por el bucle de
  // animacion. El bucle NO pasa por el estado de React: la version anterior hacia
  // `setCamara({...c})` en cada fotograma para forzar el repintado, lo que
  // reconciliaba el arbol 60 veces por segundo para mover un halo.
  const dibujar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !camara || tam.w === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // Sin contexto 2D no hay nada que hacer: se muestra el alzado plano.
      setSoportaCanvas(false);
      return;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = tam;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';

    const c = camara;
    const t = performance.now();
    const zoom = c.zoom;

    // ── 1 · Piso tecnico ────────────────────────────────────────────────────
    // Rejilla de ingenieria muy tenue. Su unico trabajo es que la profundidad se
    // lea: sin una referencia en el plano del suelo, dos celdas a distinta z se
    // interpretan como dos celdas a distinta altura.
    ctx.lineWidth = 1;
    ctx.strokeStyle = PAINT.floorMinor;
    ctx.beginPath();
    for (const [a, b] of piso.minor) {
      const [x0, y0] = toScreen(c, a);
      const [x1, y1] = toScreen(c, b);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();

    ctx.strokeStyle = PAINT.floorMajor;
    ctx.beginPath();
    for (const [a, b] of piso.major) {
      const [x0, y0] = toScreen(c, a);
      const [x1, y1] = toScreen(c, b);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();

    // Huella del rack: un tono de luz bajo la estructura, para asentarla.
    ctx.fillStyle = PAINT.floorGlow;
    path(ctx, c, piso.outline);
    ctx.fill();

    // ── 2 · Guias de nivel ──────────────────────────────────────────────────
    // La linea horizontal completa que el operador puede seguir desde la etiqueta
    // N0x hasta el ultimo cuerpo. Es una division PRINCIPAL: blanco azulado.
    ctx.lineWidth = 1;
    ctx.strokeStyle = PAINT.gridMajor;
    for (const [a, b] of guias) {
      segment(ctx, c, a, b);
      ctx.stroke();
    }

    // ── 3 · Bastidor del fondo ──────────────────────────────────────────────
    ctx.fillStyle = PAINT.postBack;
    for (const q of marco.backPosts) {
      path(ctx, c, q);
      ctx.fill();
    }
    ctx.fillStyle = PAINT.beamBack;
    for (const q of marco.backBeams) {
      path(ctx, c, q);
      ctx.fill();
    }

    // ── 4 · Travesaños de profundidad ───────────────────────────────────────
    // Punteados y mas oscuros: es la señal que distingue una linea de PROFUNDIDAD
    // de una viga. Con las tres al mismo trazo, la axonometria se lee ambigua.
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = PAINT.gridDepth;
    for (const [a, b] of marco.depthRails) {
      segment(ctx, c, a, b);
      ctx.stroke();
    }
    ctx.restore();

    // ── 5 · Celdas, del fondo al frente ─────────────────────────────────────
    const anchoCanto = stroke(zoom, 1.15, 0.85, 2.4);
    let slotHover: RackCellSlot | null = null;
    let slotSel: RackCellSlot | null = null;

    for (const slot of pintado) {
      const mat = colorDe(slot);

      if (!mat) {
        // Posicion que el catalogo NO declara. Hueco vacio: se dibuja la boca con
        // trazo discontinuo y no se rellena nada. Ni libre ni ocupada — inexistente,
        // que es un tercer estado y merece su propia forma.
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = PAINT.undeclared;
        ctx.lineWidth = Math.max(0.7, anchoCanto * 0.6);
        path(ctx, c, projectCellOpening(slot));
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (slot.cell?.locationId === selectedLocationId) slotSel = slot;
      if (hover?.cell && slot.cell?.locationId === hover.cell.locationId) slotHover = slot;

      const cara = projectCellFace(slot);
      const alfa = mat.pulso ? 0.62 + 0.3 * Math.sin(t / 340) : 1;

      // Canto del FONDO del hueco. Tenue, porque esta lejos: es la tercera
      // profundidad —frente, medio, fondo— y sin ella el nicho no tiene final.
      ctx.strokeStyle = PAINT.cellBackEdge;
      ctx.lineWidth = Math.max(0.6, anchoCanto * 0.5);
      path(ctx, c, projectCellBack(slot));
      ctx.stroke();

      ctx.globalAlpha = alfa;

      // Pared IZQUIERDA del hueco: vertical, en sombra.
      path(ctx, c, projectCellWallLeft(slot));
      ctx.fillStyle = HOLO.sideShade;
      ctx.fill();
      ctx.fillStyle = resolveColor(mat.base, HOLO.side);
      ctx.fill();

      // SUELO del hueco: horizontal, asi que recibe la luz. Es la banda que hace que
      // la celda se lea como un estante con algo dentro y no como una lamina.
      path(ctx, c, projectCellWallFloor(slot));
      ctx.fillStyle = resolveColor(mat.base, HOLO.top);
      ctx.fill();
      ctx.fillStyle = HOLO.topWash;
      ctx.fill();

      // Cara con el color del estado: material holografico. Cuerpo translucido +
      // banda de base mas densa — el «charco de luz» que le quita el aspecto de papel.
      path(ctx, c, cara);
      ctx.fillStyle = resolveColor(mat.base, HOLO.face);
      ctx.fill();
      path(ctx, c, faceBand(cara, 0.62, 1));
      ctx.fillStyle = resolveColor(mat.base, HOLO.faceBase);
      ctx.fill();

      // Trama diagonal del estado no utilizable. Segunda señal, muy tenue: al 40 %
      // dominaba la cara y el rack se leia como una textura, no como carga.
      if (mat.trama) {
        const pat = hatchPattern(ctx, resolveColor(mat.base, 0.17));
        if (pat) {
          path(ctx, c, cara);
          ctx.fillStyle = pat;
          ctx.fill();
        }
      }

      // Canto brillante de la cara: la prioridad 2 de la jerarquia visual.
      ctx.strokeStyle = resolveColor(mat.base, HOLO.edge);
      ctx.lineWidth = anchoCanto;
      path(ctx, c, cara);
      ctx.stroke();

      // Realce del canto superior, 1 px. Es lo que da el borde «encendido».
      ctx.strokeStyle = PAINT.cellTopHighlight;
      ctx.lineWidth = 1;
      segment(ctx, c, cara[0]!, cara[1]!);
      ctx.stroke();

      ctx.globalAlpha = 1;

      // Boca del hueco, en el plano del bastidor. Cierra el nicho por delante y es
      // lo que separa esta celda de su vecina: sin ella, dos celdas del mismo color
      // se fundian en un bloque continuo.
      ctx.strokeStyle = PAINT.cellMouth;
      ctx.lineWidth = Math.max(0.7, anchoCanto * 0.7);
      path(ctx, c, projectCellOpening(slot));
      ctx.stroke();
    }

    // ── 6 · Bastidor del FRENTE, por delante de la carga ────────────────────
    // Postes con volumen, canto iluminado y sombra interior: metal, no linea. Son
    // la referencia visual principal, y cruzando por delante permiten CONTAR los
    // cuerpos sin leer una sola etiqueta.
    const anchoPoste = stroke(zoom, 1.3, 1, 2.8);

    ctx.fillStyle = PAINT.postFrontShade;
    for (const q of marco.frontPosts) {
      path(ctx, c, q);
      ctx.fill();
    }
    ctx.fillStyle = PAINT.postFront;
    for (const q of marco.frontPosts) {
      path(ctx, c, q);
      ctx.fill();
    }
    ctx.strokeStyle = PAINT.postFrontEdge;
    ctx.lineWidth = anchoPoste;
    for (const q of marco.frontPosts) {
      // Solo el canto IZQUIERDO: un contorno de cuatro lados vuelve a leerse como
      // rectangulo dibujado. Un unico canto iluminado se lee como un perfil.
      segment(ctx, c, q[0]!, q[3]!);
      ctx.stroke();
    }

    ctx.fillStyle = PAINT.beamFront;
    for (const q of marco.frontBeams) {
      path(ctx, c, q);
      ctx.fill();
    }
    ctx.strokeStyle = PAINT.beamFrontEdge;
    ctx.lineWidth = 1;
    for (const q of marco.frontBeams) {
      segment(ctx, c, q[0]!, q[1]!);
      ctx.stroke();
    }

    // ── 7 · Etiquetas ───────────────────────────────────────────────────────
    // `ctx.font` tampoco resuelve `var(--font-data)`: se usa la familia directa.
    const cuerpo = Math.round(Math.min(13, Math.max(9, 8.4 * Math.sqrt(zoom))));
    ctx.font = `${cuerpo}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textBaseline = 'middle';

    // Nivel: chip alineado con la banda del nivel, con guia hasta el rack. La guia
    // es lo que impide que la etiqueta «flote».
    ctx.textAlign = 'right';
    for (let nivel = 1; nivel <= geo.maxLevel; nivel += 1) {
      const p = levelLabelAnchor(nivel);
      const [x, y] = toScreen(c, p);
      const texto = `N${String(nivel).padStart(2, '0')}`;
      const anchoTexto = ctx.measureText(texto).width;

      ctx.fillStyle = PAINT.labelChip;
      redondeado(ctx, x - anchoTexto - 6, y - cuerpo * 0.82, anchoTexto + 10, cuerpo * 1.64, 4);
      ctx.fill();
      ctx.fillStyle = PAINT.labelLevel;
      ctx.fillText(texto, x, y + 0.5);
    }

    // Cuerpo: bajo el CENTRO del cuerpo —no bajo la primera celda— y con salto de
    // rotulado cuando el paso en pantalla no da para todas. Es lo que sostiene la
    // legibilidad de 2 a 100 cuerpos.
    ctx.textAlign = 'center';
    ctx.fillStyle = PAINT.labelBay;
    const pasoPx = (bayWidth(geo) + BAY_GAP) * zoom;
    const salto = Math.max(1, Math.ceil((cuerpo * 3.4) / Math.max(1, pasoPx)));
    const ultima = geo.bayIndices.length - 1;
    geo.bayIndices.forEach((bay, col) => {
      if (col % salto !== 0 && col !== ultima) return;
      const [x, y] = toScreen(c, bayLabelAnchor(geo, col));
      ctx.fillText(`C${String(bay).padStart(3, '0')}`, x, y + cuerpo * 0.9);
    });

    // Posicion: solo en el PRIMER cuerpo y con zoom suficiente. La posicion se
    // distingue a lo ancho del cuerpo, asi que su etiqueta va sobre el remate del
    // cuerpo 1 y sirve de leyenda para los otros 26: repetirla en todos ensucia.
    if (geo.maxPosition > 1 && zoom > 1.15) {
      ctx.textAlign = 'center';
      ctx.fillStyle = PAINT.labelBay;
      const yRemate = geo.maxLevel * CELL_H;
      for (let p = 1; p <= geo.maxPosition; p += 1) {
        const [x, y] = toScreen(
          c,
          project((p - 0.5) * CELL_W, yRemate + LABEL_DROP * 0.5, 0),
        );
        ctx.fillText(`P${p}`, x, y);
      }
    }

    // ── 8 · Celda bajo el cursor ────────────────────────────────────────────
    // Se repinta encima del bastidor: si el poste la tapa, el realce no informa.
    if (slotHover && slotHover !== slotSel) {
      const cara = projectCellFace(slotHover);
      ctx.save();
      ctx.shadowColor = 'rgba(226, 240, 255, 0.55)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(240, 249, 255, 0.9)';
      ctx.lineWidth = anchoCanto + 0.9;
      path(ctx, c, cara);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      path(ctx, c, cara);
      ctx.fill();
    }

    // ── 9 · Celda seleccionada, por encima de TODO ──────────────────────────
    // Prioridad 1 de la jerarquia. Borde doble en dos tonos —azul electrico fuera,
    // acento dentro— y halo con un latido de 2,6 s: presente, no decorativo.
    if (slotSel) {
      const cara = projectCellFace(slotSel);
      const fase = 0.5 + 0.5 * Math.sin((t / PULSO_SELECCION) * Math.PI * 2);
      const halo = resolveColor('var(--azure-400)', 0.3 + 0.22 * fase);

      ctx.save();
      ctx.shadowColor = halo;
      ctx.shadowBlur = 16 + 10 * fase;
      ctx.strokeStyle = resolveColor('var(--azure-400)', 0.95);
      ctx.lineWidth = anchoCanto + 2.6;
      path(ctx, c, cara);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = resolveColor('var(--accent)', 1);
      ctx.lineWidth = Math.max(1, anchoCanto * 0.75);
      path(ctx, c, faceBand(cara, 0.06, 0.94));
      ctx.stroke();
    }
  }, [camara, tam, pintado, marco, piso, guias, colorDe, selectedLocationId, hover, geo]);

  // El bucle de animacion invoca la ultima version de `dibujar` a traves de una
  // referencia: asi no reinicia el `requestAnimationFrame` en cada render.
  const dibujarRef = useRef(dibujar);
  dibujarRef.current = dibujar;

  useEffect(() => {
    dibujar();
  }, [dibujar]);

  // ── Animacion: solo si HAY algo animandose ────────────────────────────────
  //
  // Sin seleccion y sin overlay de inspeccion no hay nada que latir, y un
  // `requestAnimationFrame` permanente gastaria bateria por nada. Ademas el latido
  // de la seleccion es de 2,6 s: repintarlo a 60 fps es 60 veces mas de lo que el
  // ojo necesita, asi que va limitado a 20 fps.
  const hayPulso = useMemo(() => {
    if (layer !== 'inspection' || !inspectionOverlay) return false;
    return Object.values(inspectionOverlay).some(
      (o) => INSPECTION_META[o.inspectionStatus].pulse === true,
    );
  }, [layer, inspectionOverlay]);

  const anima = hayPulso || selectedLocationId != null;

  useEffect(() => {
    if (!anima) return;
    let raf = 0;
    let ultimo = 0;
    const intervalo = hayPulso ? 1000 / 30 : 1000 / 20;
    const tick = (ahora: number) => {
      if (ahora - ultimo >= intervalo) {
        ultimo = ahora;
        dibujarRef.current();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anima, hayPulso]);

  // ── Interaccion ───────────────────────────────────────────────────────────
  const aMundo = useCallback(
    (ev: { clientX: number; clientY: number }): [number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas || !camara) return null;
      const r = canvas.getBoundingClientRect();
      return [
        (ev.clientX - r.left - camara.panX) / camara.zoom,
        (ev.clientY - r.top - camara.panY) / camara.zoom,
      ];
    },
    [camara],
  );

  const onMove = useCallback(
    (ev: React.MouseEvent) => {
      if (arrastre.current && camara) {
        setCamara({
          zoom: camara.zoom,
          panX: arrastre.current.panX + (ev.clientX - arrastre.current.x),
          panY: arrastre.current.panY + (ev.clientY - arrastre.current.y),
        });
        return;
      }
      const m = aMundo(ev);
      const s = m ? hitTest(pintado, m[0], m[1]) : null;
      // Comparacion por id y no por objeto: `setHover` con un slot equivalente
      // repintaria el rack en cada `mousemove` sobre la misma celda.
      setHover((prev) =>
        prev?.cell?.locationId === s?.cell?.locationId ? prev : s,
      );
    },
    [aMundo, pintado, camara],
  );

  const onClick = useCallback(
    (ev: React.MouseEvent) => {
      const m = aMundo(ev);
      if (!m) return;
      const s = hitTest(pintado, m[0], m[1]);
      // Solo las celdas DECLARADAS abren detalle: una posicion que el catalogo no
      // declara no tiene ubicacion que mostrar.
      if (s?.cell) onSelect(s.cell);
    },
    [aMundo, pintado, onSelect],
  );

  const onDoubleClick = useCallback(
    (ev: React.MouseEvent) => {
      const m = aMundo(ev);
      if (!m || !camara) return;
      const s = hitTest(pintado, m[0], m[1]);
      if (!s) return;
      // Centrar en la celda, sin cambiar el zoom: el doble clic enfoca, no acerca.
      const cara = projectCellFace(s);
      const cx = (cara[0]!.sx + cara[2]!.sx) / 2;
      const cy = (cara[0]!.sy + cara[2]!.sy) / 2;
      setCamara({
        zoom: camara.zoom,
        panX: tam.w / 2 - cx * camara.zoom,
        panY: tam.h / 2 - cy * camara.zoom,
      });
    },
    [aMundo, pintado, camara, tam],
  );

  const onWheel = useCallback(
    (ev: React.WheelEvent) => {
      if (!camara) return;
      ev.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nuevo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camara.zoom * factor));
      // Zoom hacia el cursor: el punto bajo el puntero se queda quieto.
      setCamara({
        zoom: nuevo,
        panX: cx - ((cx - camara.panX) * nuevo) / camara.zoom,
        panY: cy - ((cy - camara.panY) * nuevo) / camara.zoom,
      });
    },
    [camara],
  );

  const zoomPaso = useCallback(
    (factor: number) => {
      if (!camara) return;
      const cx = tam.w / 2;
      const cy = tam.h / 2;
      const nuevo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camara.zoom * factor));
      setCamara({
        zoom: nuevo,
        panX: cx - ((cx - camara.panX) * nuevo) / camara.zoom,
        panY: cy - ((cy - camara.panY) * nuevo) / camara.zoom,
      });
    },
    [camara, tam],
  );

  /** Desplazamiento horizontal desde la barra de recorrido. `f` ∈ [0,1]. */
  const recorrerA = useCallback(
    (f: number) => {
      if (!camara) return;
      const total = tramo.hasta - tramo.desde;
      const visible = tam.w / camara.zoom;
      const desde = tramo.desde - PAD.izq / camara.zoom + f * Math.max(0, total - visible + 40);
      setCamara({ ...camara, panX: -desde * camara.zoom });
    },
    [camara, tramo, tam],
  );

  // ── Altura que el rack NECESITA ───────────────────────────────────────────
  //
  // Un rack de 27 cuerpos y 7 niveles es un objeto de 6,9:1 dentro de un panel de
  // 1,8:1. Encajado por ancho —que es lo que hay que hacer para poder contar los
  // cuerpos— ocupa 210 px de los 850 disponibles: el 74 % del lienzo queda vacio, y
  // un vacio de ese tamaño no es aire, es espacio desperdiciado.
  //
  // Asi que el lienzo pide solo la altura que el rack usa. El resto del area de
  // trabajo lo ocupa la lectura de la seleccion, debajo. Se calcula del ANCHO —que no
  // depende de la altura— asi que no hay realimentacion posible entre el tamaño del
  // contenedor y el del contenido.
  //
  // ⚠ Antes del retorno anticipado: un hook detras de un `return` condicional cambia
  //   el orden de hooks entre renders. Lo detecto `react-hooks/rules-of-hooks`.
  const alturaNecesaria = useMemo(() => {
    const anchoMundo = Math.max(1, limites.maxX - limites.minX);
    const altoMundo = Math.max(1, limites.maxY - limites.minY);
    const utilW = Math.max(80, tam.w - PAD.izq - PAD.der);
    const z = Math.min(
      NIVEL_PX.max / CELL_H,
      Math.max(utilW / anchoMundo, NIVEL_PX.min / CELL_H),
    );
    return Math.round(altoMundo * z) + PAD.arriba + PAD.abajo;
  }, [limites, tam.w]);

  // ── Sin celdas: estado vacio, no una rejilla rota ─────────────────────────
  if (view.cells.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6', className)}>
        <div className="flex max-w-[48ch] flex-col items-center gap-3 text-center">
          <span className="text-[length:var(--text-md)] font-[var(--weight-light)] text-[var(--text-primary)]">
            {view.rackCode} no tiene alzado
          </span>
          <p className="t-body text-[var(--text-secondary)]">
            Este nodo no organiza sus ubicaciones en cuerpos, niveles y posiciones.
            Sus ubicaciones estan disponibles en la tabla.
          </p>
          {view.functionLabel && (
            <span className="t-mono-xs text-[var(--text-faint)]">
              funcion: {view.functionLabel}
            </span>
          )}
        </div>
      </div>
    );
  }

  const cabeEntero =
    (limites.maxX - limites.minX) * (camara?.zoom ?? 1) <= tam.w - PAD.izq - PAD.der + 1;
  const visibleIni = camara ? (-camara.panX / camara.zoom - tramo.desde) / (tramo.hasta - tramo.desde) : 0;
  const visibleFrac = camara ? tam.w / camara.zoom / (tramo.hasta - tramo.desde) : 1;

  return (
    // `shrink-0` y no `h-full`: el visor pide la altura que el rack NECESITA y deja el
    // resto del area de trabajo para la lectura de la seleccion. Estirandolo, el rack
    // quedaba flotando en el centro de un lienzo con el 74 % vacio.
    <div className={cn('flex shrink-0 flex-col', className)}>
      {/* Cabecera: codigo del rack y sus dimensiones REALES, en chips */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pb-2">
        <div className="flex items-center gap-3">
          <h2 className="text-[length:var(--text-lg)] font-[var(--weight-light)] tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
            {view.rackCode}
          </h2>
          {view.functionLabel && (
            <span className="t-mono-xs text-[var(--text-faint)]">{view.functionLabel}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip valor={geo.bayIndices.length} unidad="cuerpos" />
          <Chip valor={geo.maxLevel} unidad="niveles" />
          <Chip
            valor={geo.maxPosition}
            unidad={geo.maxPosition === 1 ? 'posicion' : 'posiciones'}
          />
          <Chip valor={geo.declaredCount} unidad="ubicaciones" acento />
          {geo.undeclaredCount > 0 && (
            <Chip valor={geo.undeclaredCount} unidad="no declaradas" atenuado />
          )}
        </div>
      </header>

      {/*
        LIENZO — ocupa TODO el alto disponible del area de trabajo.

        ⚠ Requiere que la cadena de contenedores tenga altura DEFINIDA. La tiene
          desde que la pagina de Spatial fija `h-[calc(100dvh - topbar)]`: sin eso,
          `CanvasHost` termina en un `min-h-full` que permite crecer, el canvas leia
          `clientHeight` del contenedor, se dibujaba a esa altura, el contenedor
          crecia para caberlo y la siguiente medicion era mayor — 11.482 px medidos.

          El canvas sigue en `absolute inset-0` por el mismo motivo: fuera del flujo
          no puede alimentar el tamaño de su propio contenedor.
      */}
      <div
        ref={contenedorRef}
        className="relative w-full shrink-0 overflow-hidden rounded-[var(--radius-md)] [background:var(--glass-1)] shadow-[var(--rim-1)]"
        style={{
          backgroundImage: FONDO_CAD,
          // La altura la manda el rack, con `72dvh` como techo por si la ventana es
          // muy baja. El techo NO es el criterio de encuadre —lo es la altura de un
          // nivel—, solo evita que un rack de 20 niveles desborde la pantalla.
          height: `min(${Math.max(260, alturaNecesaria)}px, 72dvh)`,
        }}
      >
        {soportaCanvas ? (
          <canvas
            ref={canvasRef}
            className={cn(
              'absolute inset-0 block',
              arrastre.current ? 'cursor-grabbing' : hover?.cell ? 'cursor-pointer' : 'cursor-grab',
            )}
            onMouseMove={onMove}
            onMouseLeave={() => {
              setHover(null);
              arrastre.current = null;
            }}
            onMouseDown={(e) => {
              if (!camara) return;
              arrastre.current = { x: e.clientX, y: e.clientY, panX: camara.panX, panY: camara.panY };
            }}
            onMouseUp={() => {
              arrastre.current = null;
            }}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            role="img"
            aria-label={
              `Rack ${view.rackCode}: ${geo.bayIndices.length} cuerpos, ` +
              `${geo.maxLevel} niveles, ${geo.declaredCount} ubicaciones. ` +
              'Use la tabla para navegar con teclado.'
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="t-body max-w-[42ch] text-[var(--text-secondary)]">
              Este navegador no permite dibujar el rack. Usa la vista de tabla, que
              tiene la misma informacion.
            </p>
          </div>
        )}

        {/* Orientacion de los ejes: que direccion es cuerpo, nivel y posicion */}
        <RosaDeEjes />

        {/* Controles de camara */}
        <div className="absolute right-2 top-[86px] flex flex-col gap-1">
          <BotonCamara label="Acercar" onClick={() => zoomPaso(1.25)}>
            <Plus strokeWidth={1.5} className="size-3.5" />
          </BotonCamara>
          <BotonCamara label="Alejar" onClick={() => zoomPaso(1 / 1.25)}>
            <Minus strokeWidth={1.5} className="size-3.5" />
          </BotonCamara>
          <BotonCamara label="Encuadrar el rack" onClick={encuadrar}>
            <Maximize2 strokeWidth={1.5} className="size-3.5" />
          </BotonCamara>
        </div>

        {/* Tooltip de la celda bajo el cursor */}
        {hover?.cell && (
          <div className="pointer-events-none absolute bottom-2 left-2 max-w-[46ch] rounded-[var(--radius-sm)] px-3 py-2 [background:var(--glass-3)] shadow-[var(--rim-2)]">
            <p className="t-mono-xs text-[var(--text-primary)]">{hover.cell.code}</p>
            <p className="t-mono-xs text-[var(--text-faint)]">
              cuerpo {hover.cell.bayCode} · nivel {hover.cell.level} · posicion{' '}
              {hover.cell.position} · {STATUS_META[hover.cell.status].label} · WMS{' '}
              {situationLabel(hover.cell.situation)}
            </p>
          </div>
        )}

      </div>

      {/*
        Los avisos van FUERA del lienzo.

        Flotando dentro se montaban sobre las etiquetas de cuerpo en cuanto el lienzo
        se ajusto a la altura que el rack necesita: un texto encima del dato es peor
        que no tenerlo.
      */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <span className="flex items-center gap-1.5">
          <Crosshair strokeWidth={1.5} className="size-3 text-[var(--text-faint)]" />
          <span className="t-mono-xs text-[var(--text-faint)]">
            geometria interna del rack · sin situar en el plano del almacen
          </span>
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          Arrastra para desplazar · Rueda para zoom · Doble clic para centrar
        </span>
      </div>

      {/*
        BARRA DE RECORRIDO — para racks que no caben.

        Siempre presente, aunque atenuada cuando el rack cabe entero: si apareciera y
        desapareciera segun el zoom, cambiaria la altura del contenedor, que cambia el
        encuadre, que cambia el zoom. Ese bucle ya costo un diagnostico.
      */}
      <BarraRecorrido
        activa={!cabeEntero}
        inicio={visibleIni}
        fraccion={visibleFrac}
        onIr={recorrerA}
        cuerpos={geo.bayIndices.length}
      />

      {/* Ubicaciones que no caben en la rejilla, con su motivo */}
      {geo.withoutCoordinates.length > 0 && (
        <div className="mt-2 shrink-0 px-1">
          <span className="t-label">Ubicaciones sin coordenada logica</span>
          <p className="t-mono-xs mb-1.5 text-[var(--text-faint)]">
            Su codigo no declara nivel ni posicion, asi que no tienen sitio en la
            rejilla. No se les asigna uno.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {geo.withoutCoordinates.map((c) => (
              <button
                key={c.locationId}
                type="button"
                onClick={() => onSelect(c)}
                className={cn(
                  'rounded-[var(--radius-xs)] px-2 py-1 t-mono-xs transition-colors',
                  c.locationId === selectedLocationId
                    ? '[background:var(--glass-3)] text-[var(--text-primary)]'
                    : '[background:var(--glass-2)] text-[var(--text-muted)] hover:[background:var(--glass-3)]',
                )}
              >
                {c.code}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Piezas de la interfaz del visor ─────────────────────────────────────────

/** Dato de dimension del rack. Cifra tabular, unidad atenuada. */
function Chip({
  valor,
  unidad,
  acento = false,
  atenuado = false,
}: {
  valor: number;
  unidad: string;
  acento?: boolean;
  atenuado?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex items-baseline gap-1 rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)]',
        atenuado && 'opacity-70',
      )}
    >
      <span
        className={cn(
          't-mono-xs tabular-nums',
          acento ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]',
        )}
      >
        {valor.toLocaleString('es')}
      </span>
      <span className="t-mono-xs text-[var(--text-faint)]">{unidad}</span>
    </span>
  );
}

/**
 * ROSA DE EJES — que direccion de la pantalla es cada eje del rack.
 *
 * No es un compas de norte: el rack no esta situado en el plano del almacen, asi que
 * un norte seria una invencion. Declara los tres ejes del MODELO con la misma
 * inclinacion que usa la proyeccion, leida de `DEPTH_SHIFT`:
 *
 *   C  cuerpos y posiciones, a lo ancho
 *   N  niveles, en altura
 *   F  fondo del rack — profundidad de la estanteria, no de la posicion
 */
function RosaDeEjes() {
  const largo = 15;
  const zx = DEPTH_SHIFT.sx * largo * 1.35;
  const zy = DEPTH_SHIFT.sy * largo * 1.35;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-2 top-2 rounded-[var(--radius-sm)] px-2 py-1.5 [background:var(--glass-2)] shadow-[var(--rim-1)]"
    >
      <svg width="66" height="62" viewBox="-24 -34 66 62">
        <g stroke="rgba(199,219,243,0.5)" strokeWidth="1" strokeLinecap="round" fill="none">
          <line x1="0" y1="0" x2={largo} y2="0" />
          <line x1="0" y1="0" x2="0" y2={-largo} />
          <line x1="0" y1="0" x2={zx} y2={zy} />
        </g>
        <g fill="rgba(186,206,232,0.85)" fontSize="7.5" fontFamily="ui-monospace, monospace">
          <text x={largo + 2} y="3">C</text>
          <text x="-3" y={-largo - 3}>N</text>
          <text x={zx + 2} y={zy - 2}>F</text>
        </g>
      </svg>
    </div>
  );
}

/**
 * BARRA DE RECORRIDO HORIZONTAL.
 *
 * Un rack de 27 cuerpos no cabe con los 7 niveles legibles, asi que se recorre. La
 * barra dice DONDE esta el operador dentro del rack, que un `pan` con el raton no
 * dice: sin ella, en el cuerpo 14 de 27 no hay forma de saber si queda mas.
 */
function BarraRecorrido({
  activa,
  inicio,
  fraccion,
  onIr,
  cuerpos,
}: {
  activa: boolean;
  inicio: number;
  fraccion: number;
  onIr: (f: number) => void;
  cuerpos: number;
}) {
  const pistaRef = useRef<HTMLDivElement | null>(null);

  const mover = useCallback(
    (clientX: number) => {
      const el = pistaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ancho = Math.max(1, r.width);
      const anchoPulgar = Math.min(1, Math.max(0.04, fraccion)) * ancho;
      const f = (clientX - r.left - anchoPulgar / 2) / Math.max(1, ancho - anchoPulgar);
      onIr(Math.min(1, Math.max(0, f)));
    },
    [fraccion, onIr],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!activa) return;
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      mover(e.clientX);
      const onMove = (ev: PointerEvent) => mover(ev.clientX);
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    },
    [activa, mover],
  );

  const anchoPulgar = Math.min(100, Math.max(4, fraccion * 100));
  const izq = Math.min(100 - anchoPulgar, Math.max(0, inicio * 100));

  return (
    <div className="mt-2 flex shrink-0 items-center gap-2 px-1">
      <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">C001</span>
      <div
        ref={pistaRef}
        onPointerDown={onPointerDown}
        role="presentation"
        className={cn(
          'relative h-2 flex-1 overflow-hidden rounded-full [background:var(--glass-2)]',
          activa ? 'cursor-col-resize' : 'opacity-40',
        )}
        title={
          activa
            ? 'Arrastra para recorrer el rack a lo largo'
            : 'El rack cabe entero: no hay nada que recorrer'
        }
      >
        <div
          className="absolute inset-y-0 rounded-full transition-[left] duration-75"
          style={{
            left: `${izq}%`,
            width: `${anchoPulgar}%`,
            background: 'color-mix(in oklab, var(--accent) 42%, transparent)',
          }}
        />
      </div>
      <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
        C{String(cuerpos).padStart(3, '0')}
      </span>
    </div>
  );
}

function BotonCamara({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] [background:var(--glass-2)] shadow-[var(--rim-1)] hover:[background:var(--glass-3)] hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  );
}

/** Rectangulo redondeado. `roundRect` no existe en todos los navegadores objetivo. */
function redondeado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
