/**
 * EDITOR STORE — estado del editor de layout.
 *
 * Separado del workspace store: el workspace es para la navegacion
 * operativa; el editor es para la edicion del plano fisico.
 *
 * Persistencia: se guarda como draft en localStorage bajo
 *   olo.spatial.layout-draft.v1.{warehouseId}
 */

import { create } from 'zustand';
import { CAMARA_INICIAL, type Camara } from '../cluster3d/escena';
import { deEspaldas } from './emparejar';
import type { ViewportTransform } from './transforms';
import type {
  Calibration,
  EditorLayers,
  EditorMode,
  HistoryAction,
  LayoutDraft,
  OrdenCamara3D,
  PlanFile,
  PositionedRack,
  ReferenceSystem,
  ViewDimension,
  VisualMode,
} from './types';
import { DEFAULT_EDITOR_LAYERS } from './types';
import {
  canRedo,
  canUndo,
  INITIAL_HISTORY,
  pushAction,
  redo,
  undo,
  type HistoryState,
} from './history';

const DRAFT_KEY_PREFIX = 'olo.spatial.layout-draft.v1.';

/**
 * Los identificadores pedidos MAS los de sus companeros de grupo.
 *
 * Es la pieza que hace que «se muevan juntos» funcione sin tocar el arrastre: el lienzo ya
 * mueve toda la seleccion cuando se arrastra algo que esta en ella, asi que basta con que la
 * seleccion nunca contenga media pareja.
 *
 * Sin duplicados y conservando el orden de llegada: el ULTIMO de la lista es el rack
 * «principal» que lee el inspector, y reordenar aqui cambiaria cual se enseña.
 */
function conSuGrupo(
  racks: readonly PositionedRack[],
  ids: readonly string[],
): string[] {
  const claves = new Set(
    racks.filter((r) => ids.includes(r.layoutId) && r.grupoId).map((r) => r.grupoId!),
  );
  if (claves.size === 0) return [...new Set(ids)];
  const salida = [...ids];
  for (const r of racks) {
    if (r.grupoId && claves.has(r.grupoId) && !salida.includes(r.layoutId)) {
      //  Los companeros se añaden DELANTE para que el principal siga siendo el que se toco.
      salida.unshift(r.layoutId);
    }
  }
  return [...new Set(salida)];
}

export interface EditorStoreState {
  // Mode
  mode: EditorMode;
  visualMode: VisualMode;
  viewDimension: ViewDimension;
  /**
   * LA ULTIMA ORDEN DE CAMARA PARA LA VISTA WebGL.
   *
   * ── POR QUE UNA ORDEN Y NO UN ESTADO ────────────────────────────────────
   *
   * Porque «acercar» y «ajustar» son ORDENES, no posiciones. El estado de la camara WebGL
   * es posicion + objetivo y lo lleva el propio visor; guardarlo aqui obligaria a
   * traducirlo al formato del visor axonometrico —azimut, elevacion, escala— que es otra
   * cosa, y las dos representaciones acabarian discrepando.
   *
   * El contador es lo que hace que pulsar «acercar» dos veces acerque dos veces: sin el,
   * la segunda pulsacion escribiria el mismo valor y no habria cambio que observar.
   */
  orden3d: { tipo: OrdenCamara3D; n: number } | null;
  /** A que figura mira la orden `irAFigura`. */
  figuraObjetivo: string | null;
  isEditing: boolean;

  // Plan
  plan: PlanFile | null;

  // Calibration
  calibration: Calibration;

  // Reference system
  reference: ReferenceSystem;

  // Racks
  racks: PositionedRack[];
  /**
   * Rack PRINCIPAL de la seleccion: el ultimo tocado.
   *
   * Se mantiene junto a `selectedRackIds` y no derivado, porque media docena de
   * consumidores lo leen directamente del estado. Las acciones actualizan los dos
   * SIEMPRE a la vez: `selectedRackId` es el ultimo de `selectedRackIds`, o null.
   */
  selectedRackId: string | null;
  /** Seleccion completa. Con un solo rack tiene un elemento. */
  selectedRackIds: string[];

  // Layers
  layers: EditorLayers;

  /**
   * Encuadre del lienzo: desplazamiento y zoom.
   *
   * Vive en el store y no dentro del lienzo porque hay consumidores fuera: la
   * paleta —zoom mas, menos, ajustar, ir a la seleccion—, y mas adelante el visor
   * 3D del cluster, que tendra que compartir encuadre con el 2D, y el seguimiento
   * de la flota, que necesitara centrar la vista en una posicion.
   */
  viewport: ViewportTransform;
  /** Tamaño del lienzo en pixeles. Lo publica el lienzo al medirse. */
  canvasSize: { w: number; h: number };

  /**
   * Camara del visor 3D: giro, inclinacion, escala y desplazamiento.
   *
   * Vive AQUI y no dentro del visor porque los controles de encuadre estan en la
   * paleta de arriba, y la paleta no puede alcanzar el estado interno de un
   * componente. Estuvo dentro, y la consecuencia fue que los botones de acercar,
   * ajustar y centrar desaparecian al pasar a 3D: el operador se quedaba sin forma
   * de recuperar el plano cuando lo perdia de vista.
   *
   * El visor del EXPLORADOR no usa esto: alli lleva su propia camara interna, porque
   * aquella pantalla no tiene paleta que la gobierne.
   */
  camara3d: Camara;
  /** Tamaño del lienzo 3D, para que la paleta pueda encuadrar sin conocer el DOM. */
  canvas3dSize: { w: number; h: number };

  // History
  history: HistoryState;
  canUndo: boolean;
  canRedo: boolean;

  // Snap
  /**
   * Ajuste a rejilla. APAGADO por defecto.
   *
   * Estaba encendido con un paso de 20 pixeles del plano, y en el plano del
   * mezzanine —26,72 px/m— eso son 75 cm: el rack no se podia mover menos de tres
   * cuartos de metro y era imposible colocarlo donde toca. Un ajuste que impide
   * posicionar es peor que ningun ajuste, asi que ahora se enciende cuando se
   * quiere y con el paso que se quiere.
   */
  snapToGrid: boolean;
  /**
   * Paso de la rejilla en METROS, no en pixeles del plano.
   *
   * En pixeles, el significado fisico del paso cambiaba con la resolucion de la
   * imagen y con la calibracion: los mismos 20 px son 0,4 m en un plano y 0,75 m
   * en otro. En metros, el operador decide «cada 25 cm» y eso vale para cualquier
   * plano. El canvas lo convierte con `pixelsPerMeter` al dibujar y al ajustar.
   */
  gridMeters: number;

  // Actions
  setMode: (mode: EditorMode) => void;
  setVisualMode: (mode: VisualMode) => void;
  setViewDimension: (dim: ViewDimension) => void;
  /** Manda una orden a la camara de la vista WebGL. */
  enviarOrden3d: (tipo: OrdenCamara3D) => void;
  /** Lleva la camara de la vista WebGL a una figura colocada. */
  irAFigura: (instanceId: string) => void;
  setEditing: (editing: boolean) => void;
  setPlan: (plan: PlanFile | null) => void;
  setCalibration: (cal: Calibration) => void;
  setReference: (ref: ReferenceSystem) => void;
  addRack: (rack: PositionedRack) => void;
  updateRack: (layoutId: string, updates: Partial<PositionedRack>) => void;
  /** Cambia varios racks de una vez: alinear, distribuir, color en bloque. */
  updateRacks: (cambios: { layoutId: string; updates: Partial<PositionedRack> }[]) => void;
  removeRack: (layoutId: string) => void;
  /** Quita todos los seleccionados. Devuelve los que quito, para el historial. */
  removeSelected: () => PositionedRack[];
  selectRack: (layoutId: string | null) => void;
  /** Añade o quita de la seleccion. Es el Ctrl+clic. */
  toggleRackSelection: (layoutId: string) => void;
  /** Reemplaza la seleccion entera. Es el marco de seleccion y el «todo». */
  selectRacks: (layoutIds: string[]) => void;
  /**
   * Agrupa la seleccion: a partir de ahora se mueven juntos.
   *
   * Devuelve la clave, o `null` si no habia al menos dos: un grupo de uno no es un grupo, y
   * dejarlo crearse pondria una clave que no hace nada y que hay que limpiar despues.
   */
  agrupar: () => string | null;
  /** Deshace el grupo de la seleccion. Poner la clave a nada no deja basura. */
  desagrupar: () => void;
  /**
   * Declara —o retira— la CARA OPERATIVA de un rack: por donde se saca el palet.
   *
   * `null` la retira y la deja SIN DECLARAR, que es un estado con significado propio: el
   * visor vuelve a pintar los huecos por las dos caras. Hace falta una accion propia y no
   * vale `updateRack`, porque retirar es QUITAR la propiedad, y `updateRack` fusiona: con
   * `exactOptionalPropertyTypes` ni siquiera acepta `undefined`, y aunque lo aceptara
   * dejaria una clave presente con valor nulo donde el borrador espera que no haya ninguna.
   */
  declararFrente: (layoutId: string, lado: 1 | -1 | null) => void;
  /**
   * Pone los dos seleccionados DE ESPALDAS: el rack doble, montado de una vez.
   *
   * Mueve el que NO es principal contra la trasera del principal, los deja paralelos, les
   * declara las dos caras hacia fuera y los agrupa. Devuelve `null` si salio bien, o el
   * motivo por el que no — nunca deja el plano a medias—.
   *
   * Es una sola operacion y no cuatro pasos sueltos porque los cuatro son el mismo gesto:
   * «estos dos forman un rack doble». Hacerlos por separado obliga a acertar el centro con
   * precision de milimetros a mano, que a la escala de un almacen de 112 m no se puede.
   */
  emparejarDeEspaldas: () => string | null;
  toggleLayer: (layer: keyof EditorLayers) => void;
  setViewport: (v: ViewportTransform) => void;
  setCanvasSize: (s: { w: number; h: number }) => void;
  setCamara3d: (c: Camara) => void;
  setCanvas3dSize: (s: { w: number; h: number }) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridMeters: (metros: number) => void;

  // History
  performUndo: () => void;
  performRedo: () => void;
  recordAction: (action: HistoryAction) => void;

  // Persistence
  /**
   * El estado del editor como borrador, sin escribirlo en ningun sitio.
   *
   * Existe porque tres sitios lo construian por separado —guardar, exportar y
   * ahora publicar— y cada copia era una oportunidad de que uno se olvidase de un
   * campo nuevo. `measured` de la calibracion habria sido el primero: la posicion
   * de los racks se publicaria y la escala no, sin que nada fallase.
   *
   * @param conImagen `false` para exportar o publicar: la imagen en base64 son
   *   megas y no viaja en ninguno de los dos casos.
   */
  buildDraft: (warehouseId: string, conImagen?: boolean) => LayoutDraft;
  /** Vuelca un borrador en el editor. Lo contrario de `buildDraft`. */
  applyDraft: (draft: LayoutDraft) => void;
  saveDraft: (warehouseId: string) => void;
  loadDraft: (warehouseId: string) => boolean;
  discardDraft: (warehouseId: string) => void;
  exportJson: () => string;
  importJson: (json: string, warehouseId: string) => boolean;
  resetEditor: () => void;
}

const INITIAL_CALIBRATION: Calibration = { pixelsPerMeter: 50, points: null };
const INITIAL_REFERENCE: ReferenceSystem = { origin: { x: 0, y: 0 }, rotation: 0, unit: 'meters' };

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  mode: 'view',
  visualMode: 'technical',
  viewDimension: '2d',
  orden3d: null,
  figuraObjetivo: null,
  isEditing: false,
  plan: null,
  calibration: INITIAL_CALIBRATION,
  reference: INITIAL_REFERENCE,
  racks: [],
  selectedRackId: null,
  selectedRackIds: [],
  layers: DEFAULT_EDITOR_LAYERS,
  viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
  canvasSize: { w: 0, h: 0 },
  camara3d: CAMARA_INICIAL,
  canvas3dSize: { w: 0, h: 0 },
  history: INITIAL_HISTORY,
  canUndo: false,
  canRedo: false,
  snapToGrid: false,
  gridMeters: 0.25,

  setMode: (mode) => set({ mode }),
  setVisualMode: (visualMode) => set({ visualMode }),
  setViewDimension: (viewDimension) => set({ viewDimension }),
  enviarOrden3d: (tipo) =>
    set((s) => ({ orden3d: { tipo, n: (s.orden3d?.n ?? 0) + 1 } })),
  //  El objetivo se escribe ANTES que la orden, en el mismo `set`: si fueran dos, el visor
  //  podria reaccionar a la orden con el objetivo anterior todavia puesto e ir a la figura
  //  equivocada.
  irAFigura: (instanceId) =>
    set((s) => ({
      figuraObjetivo: instanceId,
      orden3d: { tipo: 'irAFigura', n: (s.orden3d?.n ?? 0) + 1 },
    })),
  setEditing: (isEditing) => set({ isEditing, mode: isEditing ? 'select' : 'view' }),
  setPlan: (plan) => set({ plan }),
  setCalibration: (calibration) => set({ calibration }),
  setReference: (reference) => set({ reference }),

  addRack: (rack) => {
    set((s) => ({
      racks: [...s.racks, rack],
      history: pushAction(s.history, { type: 'place-rack', rack }),
      canUndo: true,
      canRedo: false,
    }));
  },

  updateRack: (layoutId, updates) => {
    set((s) => ({
      racks: s.racks.map((r) => (r.layoutId === layoutId ? { ...r, ...updates } : r)),
    }));
  },

  updateRacks: (cambios) => {
    const porId = new Map(cambios.map((c) => [c.layoutId, c.updates]));
    set((s) => ({
      racks: s.racks.map((r) => {
        const u = porId.get(r.layoutId);
        return u ? { ...r, ...u } : r;
      }),
    }));
  },

  removeRack: (layoutId) => {
    const rack = get().racks.find((r) => r.layoutId === layoutId);
    if (!rack) return;
    set((s) => ({
      racks: s.racks.filter((r) => r.layoutId !== layoutId),
      selectedRackId: s.selectedRackId === layoutId ? null : s.selectedRackId,
      selectedRackIds: s.selectedRackIds.filter((id) => id !== layoutId),
      history: pushAction(s.history, { type: 'remove-rack', rack }),
      canUndo: true,
      canRedo: false,
    }));
  },

  removeSelected: () => {
    const s = get();
    const fuera = s.racks.filter((r) => s.selectedRackIds.includes(r.layoutId) && !r.locked);
    if (fuera.length === 0) return [];
    const ids = new Set(fuera.map((r) => r.layoutId));
    set((prev) => ({
      racks: prev.racks.filter((r) => !ids.has(r.layoutId)),
      selectedRackId: null,
      selectedRackIds: [],
      // Una entrada de historial por rack: el modelo de acciones no tiene un
      // «quitar varios», y encadenarlas conserva la reversibilidad.
      history: fuera.reduce(
        (h, rack) => pushAction(h, { type: 'remove-rack', rack }),
        prev.history,
      ),
      canUndo: true,
      canRedo: false,
    }));
    return fuera;
  },

  /*
    ── SELECCIONAR UN RACK AGRUPADO SELECCIONA EL GRUPO ────────────────────────

    Es lo que hace que «se muevan juntos» funcione sin tocar el arrastre: el lienzo ya mueve
    TODA la seleccion cuando se arrastra un rack que esta en ella. Expandiendo aqui, el
    comportamiento sale gratis en las tres vistas y en las acciones de alinear y borrar.

    Al reves —dejar la seleccion en uno y arreglarlo en el arrastre— habria que acordarse en
    cada sitio que mueve algo, y el primero que se olvidara partiria el rack doble.
  */
  selectRack: (layoutId) =>
    set((s) => {
      if (!layoutId) return { selectedRackId: null, selectedRackIds: [] };
      const ids = conSuGrupo(s.racks, [layoutId]);
      return { selectedRackId: layoutId, selectedRackIds: ids };
    }),

  toggleRackSelection: (layoutId) =>
    set((s) => {
      const dentro = s.selectedRackIds.includes(layoutId);
      const ids = dentro
        ? s.selectedRackIds.filter((id) => id !== layoutId)
        : [...s.selectedRackIds, layoutId];
      return { selectedRackIds: ids, selectedRackId: ids[ids.length - 1] ?? null };
    }),

  selectRacks: (layoutIds) =>
    set((s) => {
      //  El marco de seleccion tambien expande: si el marco toca una mitad de un rack doble,
      //  entra el doble entero. Coger media pareja con un marco y moverla seria el mismo
      //  desastre por otra puerta.
      const ids = conSuGrupo(s.racks, layoutIds);
      return { selectedRackIds: ids, selectedRackId: ids[ids.length - 1] ?? null };
    }),

  agrupar: () => {
    const s = get();
    if (s.selectedRackIds.length < 2) return null;
    //  La clave se deriva de los codigos ordenados: asi es estable —agrupar los mismos dos
    //  racks da la misma clave— y legible en la base, que es donde alguien la va a leer para
    //  entender por que dos racks se movieron juntos.
    const codigos = s.racks
      .filter((r) => s.selectedRackIds.includes(r.layoutId))
      .map((r) => r.rackCode)
      .sort();
    const clave = `g-${codigos.join('-')}`.slice(0, 40);
    set({
      racks: s.racks.map((r) =>
        s.selectedRackIds.includes(r.layoutId) ? { ...r, grupoId: clave } : r,
      ),
    });
    return clave;
  },

  desagrupar: () =>
    set((s) => ({
      racks: s.racks.map((r) => {
        if (!s.selectedRackIds.includes(r.layoutId)) return r;
        //  Se quita la propiedad en vez de dejarla a `undefined`: al serializar el borrador,
        //  una clave presente con valor nulo y una ausente se leen igual, pero en la base son
        //  distintas y conviene que el JSON diga lo mismo que la fila.
        const { grupoId: _fuera, ...resto } = r;
        return resto;
      }),
    })),

  emparejarDeEspaldas: (): string | null => {
    const s = get();
    const sel = s.racks.filter((r) => s.selectedRackIds.includes(r.layoutId));
    //  Dos, ni uno ni tres. Un rack doble son dos; con tres no hay forma de saber cual va
    //  contra cual, y adivinarlo movería racks a sitios que nadie pidió.
    if (sel.length !== 2) {
      return sel.length < 2
        ? 'Selecciona los DOS racks que van de espaldas'
        : `Hay ${sel.length} seleccionados y un rack doble son dos`;
    }
    //  El principal es el ANCLA y no se mueve. Es el último tocado —el que enseña el
    //  inspector— así que se sabe de antemano cuál de los dos va a cambiar de sitio.
    const ancla = sel.find((r) => r.layoutId === s.selectedRackId) ?? sel[0]!;
    const movil = sel.find((r) => r.layoutId !== ancla.layoutId)!;
    //  Un rack bloqueado no se mueve, y aquí menos: quien lo bloqueó lo hizo para que nada
    //  lo tocara. Se dice cuál es, porque si no el botón parecería estropeado.
    if (movil.locked) {
      return `${movil.rackCode} esta bloqueado: desbloquealo o hazlo principal`;
    }

    const e = deEspaldas(ancla, movil, s.calibration.pixelsPerMeter);
    //  La clave del grupo, con la misma regla que `agrupar`: derivada de los códigos
    //  ordenados, estable y legible en la base.
    const clave = `g-${[ancla.rackCode, movil.rackCode].sort().join('-')}`.slice(0, 40);

    const anclaDespues: PositionedRack = { ...ancla, frente: e.frenteAncla, grupoId: clave };
    const movilDespues: PositionedRack = {
      ...movil,
      x: e.x,
      y: e.y,
      rotation: e.rotation,
      frente: e.frenteMovil,
      grupoId: clave,
    };
    const porId = new Map([
      [ancla.layoutId, anclaDespues],
      [movil.layoutId, movilDespues],
    ]);

    set({
      racks: s.racks.map((r) => porId.get(r.layoutId) ?? r),
      //  Se graban los dos racks ENTEROS, antes y después: esta operación cambia posición,
      //  giro, las dos caras y el grupo, y deshacer solo la posición dejaría el plano en un
      //  estado que no es ni el de antes ni el de después.
      history: pushAction(s.history, {
        type: 'emparejar',
        antes: [ancla, movil],
        despues: [anclaDespues, movilDespues],
      }),
      canUndo: true,
      canRedo: false,
    });
    return null;
  },

  declararFrente: (layoutId, lado) =>
    set((s) => ({
      racks: s.racks.map((r) => {
        if (r.layoutId !== layoutId) return r;
        if (lado === null) {
          const { frente: _fuera, ...resto } = r;
          return resto;
        }
        return { ...r, frente: lado };
      }),
    })),

  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),

  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setCamara3d: (camara3d) => set({ camara3d }),
  setCanvas3dSize: (canvas3dSize) => set({ canvas3dSize }),

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  // Minimo 1 cm: por debajo el ajuste no ajusta nada y solo cuesta calculo.
  setGridMeters: (metros) => set({ gridMeters: Math.max(0.01, metros) }),

  recordAction: (action) => {
    set((s) => {
      const h = pushAction(s.history, action);
      return { history: h, canUndo: canUndo(h), canRedo: canRedo(h) };
    });
  },

  performUndo: () => {
    set((s) => {
      const { state: h, action } = undo(s.history);
      if (!action) return s;
      // Reverse the action
      let racks = s.racks;
      switch (action.type) {
        case 'place-rack':
          racks = racks.filter((r) => r.layoutId !== action.rack.layoutId);
          break;
        case 'remove-rack':
          racks = [...racks, action.rack];
          break;
        case 'move-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, x: action.from.x, y: action.from.y } : r);
          break;
        case 'move-many': {
          const previos = new Map(action.movimientos.map((m) => [m.layoutId, m.from]));
          racks = racks.map((r) => {
            const p = previos.get(r.layoutId);
            return p ? { ...r, x: p.x, y: p.y } : r;
          });
          break;
        }
        case 'rotate-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, rotation: action.from } : r);
          break;
        case 'resize-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, ...action.from } : r);
          break;
        case 'emparejar': {
          //  Se sustituyen ENTEROS, no se fusionan: el rack de antes podia no tener grupo ni
          //  cara, y fusionar dejaria las dos propiedades puestas — que es justo lo que se
          //  esta deshaciendo—.
          const previos = new Map(action.antes.map((r) => [r.layoutId, r]));
          racks = racks.map((r) => previos.get(r.layoutId) ?? r);
          break;
        }
        case 'calibrate':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), calibration: action.from };
        case 'set-origin':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), reference: action.from };
      }
      return { racks, history: h, canUndo: canUndo(h), canRedo: canRedo(h) };
    });
  },

  performRedo: () => {
    set((s) => {
      const { state: h, action } = redo(s.history);
      if (!action) return s;
      let racks = s.racks;
      switch (action.type) {
        case 'place-rack':
          racks = [...racks, action.rack];
          break;
        case 'remove-rack':
          racks = racks.filter((r) => r.layoutId !== action.rack.layoutId);
          break;
        case 'move-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, x: action.to.x, y: action.to.y } : r);
          break;
        case 'move-many': {
          const destinos = new Map(action.movimientos.map((m) => [m.layoutId, m.to]));
          racks = racks.map((r) => {
            const d = destinos.get(r.layoutId);
            return d ? { ...r, x: d.x, y: d.y } : r;
          });
          break;
        }
        case 'rotate-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, rotation: action.to } : r);
          break;
        case 'resize-rack':
          racks = racks.map((r) => r.layoutId === action.layoutId ? { ...r, ...action.to } : r);
          break;
        case 'emparejar': {
          const nuevos = new Map(action.despues.map((r) => [r.layoutId, r]));
          racks = racks.map((r) => nuevos.get(r.layoutId) ?? r);
          break;
        }
        case 'calibrate':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), calibration: action.to };
        case 'set-origin':
          return { history: h, canUndo: canUndo(h), canRedo: canRedo(h), reference: action.to };
      }
      return { racks, history: h, canUndo: canUndo(h), canRedo: canRedo(h) };
    });
  },

  buildDraft: (warehouseId, conImagen = true) => {
    const s = get();
    // 2 MB: `localStorage` ronda los 5 y el base64 crece un tercio sobre el
    // archivo. Por encima se guarda la geometria SIN la imagen, porque perder la
    // imagen y conservar las posiciones es mucho mejor que perder las dos.
    const imageStored = conImagen && Boolean(s.plan?.dataUrl && s.plan.bytes < 2 * 1024 * 1024);
    return {
      version: 1,
      warehouseId,
      updatedAt: new Date().toISOString(),
      plan: s.plan
        ? {
            name: s.plan.name,
            type: s.plan.type,
            width: s.plan.width,
            height: s.plan.height,
            bytes: s.plan.bytes,
            dataUrl: imageStored ? s.plan.dataUrl : null,
          }
        : null,
      planPersistence: {
        metadataStored: Boolean(s.plan),
        imageStored,
        imageStorage: imageStored ? 'localStorage-base64' : 'not-stored',
        storageError: null,
      },
      calibration: s.calibration,
      reference: s.reference,
      racks: s.racks,
      layers: s.layers,
      visualMode: s.visualMode,
      viewDimension: s.viewDimension,
    };
  },

  applyDraft: (draft) => {
    // La imagen se reconstruye del base64 si venia; si no, el editor se queda sin
    // fondo y el cargador de plano lo dice. Los racks se dibujan igual: sus
    // coordenadas no dependen de que la imagen este.
    const plan: PlanFile | null =
      draft.plan && draft.plan.dataUrl
        ? { ...draft.plan, objectUrl: draft.plan.dataUrl }
        : null;
    set({
      plan,
      calibration: draft.calibration,
      reference: draft.reference,
      racks: draft.racks,
      layers: draft.layers,
      visualMode: draft.visualMode,
      viewDimension: draft.viewDimension,
      // La seleccion NO se restaura: apuntaria a racks de otra sesion.
      selectedRackId: null,
      selectedRackIds: [],
      // El historial tampoco: deshacer sobre un borrador recien abierto volveria a
      // un estado que este editor nunca tuvo.
      history: INITIAL_HISTORY,
      canUndo: false,
      canRedo: false,
    });
  },

  saveDraft: (warehouseId) => {
    const draft = get().buildDraft(warehouseId);
    const persistence = draft.planPersistence;
    try {
      localStorage.setItem(DRAFT_KEY_PREFIX + warehouseId, JSON.stringify(draft));
    } catch (err) {
      persistence.imageStored = false;
      persistence.imageStorage = 'not-stored';
      persistence.storageError = err instanceof Error ? err.message : 'Storage quota exceeded';
      if (draft.plan) draft.plan.dataUrl = null;
      draft.planPersistence = persistence;
      try { localStorage.setItem(DRAFT_KEY_PREFIX + warehouseId, JSON.stringify(draft)); } catch { /* truly full */ }
    }
  },

  loadDraft: (warehouseId) => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY_PREFIX + warehouseId);
      if (!raw) return false;
      const draft = JSON.parse(raw) as LayoutDraft;
      // Una version futura se ignora en lugar de intentar leerse: un layout mal
      // interpretado dibuja racks en sitios equivocados, y eso es peor que no
      // dibujar nada.
      if (draft.version !== 1) return false;
      get().applyDraft(draft);
      return true;
    } catch {
      return false;
    }
  },

  discardDraft: (warehouseId) => {
    localStorage.removeItem(DRAFT_KEY_PREFIX + warehouseId);
    get().resetEditor();
  },

  exportJson: () => {
    // Sin imagen: un JSON con megas de base64 no se pega en ningun sitio. Se
    // exporta la geometria, que es lo que cuesta rehacer.
    const draft = get().buildDraft('', false);
    return JSON.stringify(draft, null, 2);
  },

  importJson: (json, warehouseId) => {
    try {
      const draft = JSON.parse(json) as LayoutDraft;
      if (draft.version !== 1) return false;
      draft.warehouseId = warehouseId;
      // El plano cargado NO se sustituye: el JSON exportado no lleva imagen, asi
      // que aplicarlo tal cual dejaria al operador sin el fondo que tenia delante.
      get().applyDraft({ ...draft, plan: get().plan ?? draft.plan });
      return true;
    } catch {
      return false;
    }
  },

  resetEditor: () => set({
    mode: 'view',
    isEditing: false,
    plan: null,
    calibration: INITIAL_CALIBRATION,
    camara3d: CAMARA_INICIAL,
    reference: INITIAL_REFERENCE,
    racks: [],
    selectedRackId: null,
    selectedRackIds: [],
    layers: DEFAULT_EDITOR_LAYERS,
    history: INITIAL_HISTORY,
    canUndo: false,
    canRedo: false,
  }),
}));
