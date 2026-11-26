/**
 * EL ALMACEN EN 3D DE VERDAD — WebGL, perspectiva, oclusión y mallas.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE APORTA SOBRE EL VISOR AXONOMETRICO, Y POR QUE NO LO SUSTITUYE
 *
 * El visor axonométrico dibuja con Canvas 2D y una proyección escrita a mano. Funciona,
 * está probado y es rápido con 347 racks. Pero tiene un techo que no es de esfuerzo sino
 * de técnica: no puede cargar mallas —un `.glb` habría que rasterizarlo a mano—, no tiene
 * cámara en perspectiva para recorrer un pasillo, la oclusión es orden de pintado (con
 * personas y drones metidos entre racks se rompe) y no hay luces, así que el volumen se
 * lee solo por colores planos.
 *
 * Esta vista es la tercera, no la única. Las otras dos siguen exactamente donde estaban.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LO QUE COMPARTE CON LAS OTRAS VISTAS (Y ES CASI TODO)
 *
 * `componerEscena`, `medidasDe`, `posicionesDe`, `colorDeInspeccion`, `estadoDeSlot` y las
 * rutas. Todo eso calcula METROS Y ESTADOS, no píxeles: no tiene nada que ver con cómo se
 * dibuje. Lo único propio de aquí es meter esos metros en matrices, y eso vive en
 * `mundo.ts` como funciones puras con 14 pruebas — porque `vitest` no tiene WebGL y unas
 * cuentas que solo se pueden comprobar mirando la pantalla es como estuvo semanas un eje
 * girado 90°.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE UNA MALLA INSTANCIADA Y NO UN OBJETO POR RACK
 *
 * 347 racks son 347 cajas, que da igual. Los HUECOS no: 29.310 por las dos caras son
 * 58.620 placas. Como objetos independientes serían 58.620 llamadas de dibujado por
 * fotograma y la pantalla iría a tirones. Instanciadas son DOS: una para los racks y una
 * para las placas.
 *
 * El precio es que el color va en un atributo por instancia y el picking devuelve un
 * `instanceId` que hay que traducir. Por eso se guarda el índice: `_indiceHueco`.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { cn } from '../../../design/utils/cn';
import type { OrdenCamara3D } from '../editor/types';
import type { FiguraColocada } from '../figuras';
import { estadoDeSlot } from '../inspection';
import type { SlotLeido } from '../inspection';
import type { RackEnEscena } from '../cluster3d/escena';
import {
  aDominio,
  destinoDeArrastre,
  movimientoApreciable,
  planoHorizontal,
  planoVertical,
} from './arrastre';
import type { PlanoDeArrastre, PuntoMundo } from './arrastre';
import {
  apoyarEnElSuelo,
  cajaDeRack,
  claveDeHueco,
  encuadreDe,
  placasDeHuecos,
} from './mundo';
import {
  CELDA,
  MODOS_DE_OCUPACION,
  leyendaDeOcupacion,
  pinturaDeHueco,
} from '../ocupacion';
import type { ModoDeOcupacion, OcupacionDeHuecos } from '../ocupacion';
import { cuantasPiezas, estructuraDeRack, PIEZAS_MAXIMAS } from './estructura';
import type { Pieza, TipoDePieza } from './estructura';
import { construirCedi } from './cedi/construirCedi';
import type { Cedi } from './cedi/construirCedi';

export interface Almacen3DProps {
  /** Los racks YA en metros, de `componerEscena`. La misma fuente que las otras vistas. */
  escena: readonly RackEnEscena[];
  /** Los huecos leídos por `rackId`, igual que el visor axonométrico. */
  slots?: ReadonlyMap<string, readonly SlotLeido[]> | undefined;
  /** Se ha pinchado un rack (o el vacío, que llega como `null`). */
  onSeleccionar?: ((rack: RackEnEscena | null) => void) | undefined;
  /** Se ha pinchado un hueco CON lectura. */
  onAbrirHueco?: ((slot: SlotLeido) => void) | undefined;
  /**
   * LAS FIGURAS colocadas en este plano: personas, drones, montacargas.
   *
   * Es lo que convierte una estantería en un almacén. Se cargan con `GLTFLoader` una a una
   * en cuanto llegan, no todas juntas: un `.glb` de 10 MB por la red de un almacén tarda, y
   * esperar a la última dejaría el plano sin ninguna.
   */
  figuras?: readonly FiguraColocada[] | undefined;
  /** Se ha pinchado una figura. Llega el `id` de la APARICION, no el del modelo. */
  onTocarFigura?: ((instanceId: string) => void) | undefined;
  /**
   * Se ha ARRASTRADO una figura y se ha soltado. Metros del plano.
   *
   * Sin esta devolución de llamada no se arrastra: mover algo que no se va a guardar sería
   * peor que no poder moverlo — la figura volvería a su sitio al recargar y nadie sabría por
   * qué—. Es lo que decide si el gesto está habilitado.
   */
  onMoverFigura?:
    | ((instanceId: string, destino: { xM: number; yM: number; zM: number }) => void)
    | undefined;
  /**
   * Se han arrastrado uno o varios racks y se han soltado, en METROS del dominio.
   *
   * Solo AL SOLTAR, no en cada fotograma — a diferencia de `Cluster3DView`, que
   * actualiza el borrador en cada fotograma porque ahí es barato: aquí reconstruir
   * la escena para reflejar cada posición intermedia significaría repintar hasta
   * 40.000 piezas de estantería sesenta veces por segundo. Mismo motivo que
   * `onMoverFigura`, y misma solución: se arrastra la MALLA en directo, y solo al
   * soltar se avisa a quien tenga que guardarlo.
   *
   * Si el rack agarrado forma parte de la selección actual y hay más de uno
   * seleccionado, se mueven TODOS juntos manteniendo la distancia entre ellos —
   * igual que en el axonométrico.
   */
  onMoverRacks?:
    | ((
        movimientos: {
          layoutId: string;
          from: { x: number; y: number };
          to: { x: number; y: number };
        }[],
      ) => void)
    | undefined;
  /**
   * Ajuste a rejilla, en metros. Los MISMOS valores que las otras dos vistas: un
   * rack colocado a rejilla en 2D tiene que caer en la misma casilla si se ajusta
   * desde aquí.
   */
  snapToGrid?: boolean | undefined;
  gridMeters?: number | undefined;
  /**
   * Si la herramienta MOVER está activa. Entonces arrastrar con el botón izquierdo desplaza
   * la vista en vez de girarla, igual que en el lienzo 2D y en el axonométrico: un solo
   * concepto de «mover la vista» para las tres.
   */
  modoPan?: boolean | undefined;
  /**
   * La última orden de los botones de encuadre. El contador es lo que distingue dos
   * pulsaciones iguales seguidas.
   */
  orden?: { tipo: OrdenCamara3D; n: number } | null | undefined;
  /**
   * A QUE figura ir cuando la orden es `irAFigura`.
   *
   * Va aparte del tipo de orden porque las otras cuatro no necesitan objetivo, y meterlo
   * dentro las obligaria a cargar un campo que no usan.
   */
  figuraObjetivo?: string | null | undefined;
  /**
   * Los `layoutId` marcados ahora mismo. Es a DONDE va la orden `irASeleccion`.
   *
   * Solo se usa para encuadrar: esta vista no pinta la selección de otra manera —el
   * inspector de la derecha ya dice cuál es— y hacerlo obligaría a reconstruir la escena en
   * cada clic.
   */
  seleccion?: readonly string[] | undefined;
  /**
   * LO QUE EL WMS DECLARO de cada hueco, para pintar el almacen entero y no solo lo leido.
   *
   * `undefined` cuando la capa esta apagada o todavia no ha llegado: entonces se pinta solo la
   * inspeccion, que es lo que se hacia antes. Nunca se inventa un color por no tener el dato.
   */
  ocupacion?: OcupacionDeHuecos | null | undefined;
  /**
   * DONDE VA EL RECORRIDO ahora mismo, en metros. `null` cuando no se esta reproduciendo.
   *
   * Lo calcula el panel, no el visor: asi el numero que se ensena —«51,30 m»— y el marcador
   * que se mueve salen del MISMO calculo. Con dos fuentes, el marcador iria por un sitio y
   * el total diria otro, y no habria forma de saber cual miente.
   */
  posicionRecorrido?: { x: number; y: number } | null | undefined;
  /**
   * El giro de quien hace el recorrido, en RADIANES, para que ande de frente.
   *
   * `null` mientras esta parado: entonces se conserva el ultimo, que es lo que hace alguien
   * que se detiene en una parada. Girar a 0 lo pondria mirando al norte por sorpresa.
   */
  rumboRecorrido?: number | null | undefined;
  /**
   * LA FIGURA QUE HACE EL RECORRIDO: su `.glb` y su escala.
   *
   * Es lo que convierte el marcador en una persona andando. Se carga aparte de las figuras
   * COLOCADAS porque no es una de ellas: las colocadas son decorado que se queda quieto, y
   * esta aparece solo mientras se reproduce.
   */
  figuraDelRecorrido?: { glbUrl: string; escala: number } | null | undefined;
  /**
   * MOSTRAR EL ACOMODO DE RACKS DEL CEDI: la estanteria doble fondo del «Mapa mezzanine N2»,
   * transcrita en `plano.ts`, en un grupo reflejado con las coordenadas logicas del documento.
   *
   * Cuando esta encendido se dibuja SOLO esa estanteria —sin edificio ni demas contexto— y se
   * ocultan los racks del catalogo del WMS, para ver el acomodo y nada mas. Arranca
   * encendido desde aqui y se conmuta en el pie del visor. (El resto del gemelo del documento
   * `GEMELO_CEDI_OLO.md` sigue en `cedi/`, disponible por si se quiere volver a montar.)
   */
  mostrarContextoCedi?: boolean | undefined;
  className?: string | undefined;
}

/** Color del suelo y del fondo. Neutros: el color tiene que ser información, no decoración. */
const COLOR_SUELO = 0x1b1f27;
const COLOR_FONDO = 0x0e1116;

/** Sin figuras, una lista estable: una nueva en cada render reconstruiría la escena. */
const SIN_FIGURAS: readonly FiguraColocada[] = [];
/** Y lo mismo para la selección, por el mismo motivo. */
const SIN_SELECCION: readonly string[] = [];

/** El motor de la vista: se crea UNA vez por montaje y lo comparten los efectos de contenido. */
interface Tres {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controles: OrbitControls;
}

/**
 * Cuánto puede quedar una placa de hueco POR DETRAS del rack y seguir siendo lo que se
 * apunta, en metros.
 *
 * Un rack de este almacén tiene 1,10 m de fondo, así que su cara de atrás queda a 1,14 m de
 * la de delante. Dos metros la alcanzan con holgura y no llegan al rack siguiente, que en
 * este plano está a diez.
 */
const MARGEN_HUECO_M = 2;

/**
 * Cuánto se ve el volumen del rack por encima de su estantería.
 *
 * Bajo a propósito. Es lo que hace de silueta a lo lejos y de blanco para el cursor, pero
 * subirlo empaña la estructura: a 0,3 un pasillo de racks vuelve a leerse como una pared de
 * cristal esmerilado y deja de verse dónde acaba un cuerpo.
 */
const OPACIDAD_VOLUMEN = 0.12;

/**
 * De qué está hecha cada pieza —el ACABADO, no el color—.
 *
 * El color ya NO vive aquí: lo pone cada pieza por `instanceColor` (montantes azules,
 * largueros blancos, brazos de cantilever naranjas, todo lo de ZF blanco), porque dentro de
 * un mismo tipo conviven varios colores según la zona del rack. Lo que queda aquí es el
 * acabado del material —cuánto metal, cuánta rugosidad, cuánto refleja el entorno—, que sí es
 * común a cada tipo: un montante es acero más pulido que un apoyo galvanizado. El `color`
 * arranca en blanco y lo multiplica el de la instancia; se deja escrito porque el material lo
 * exige, pero no se ve.
 */
const MATERIAL_PIEZA: Record<TipoDePieza, THREE.MeshStandardMaterialParameters> = {
  //  Acero pintado del bastidor: metálico y poco rugoso, con reflejo de entorno casi pleno.
  //  Es lo que hace que un montante tenga el brillo del canto y la sombra del alma.
  montante: { color: 0xffffff, roughness: 0.4, metalness: 0.85, envMapIntensity: 0.9 },
  traviesa: { color: 0xffffff, roughness: 0.42, metalness: 0.8, envMapIntensity: 0.85 },
  //  Largueros/brazos: acero PINTADO (pintura en polvo). Refleja menos que el acero desnudo
  //  —más rugoso, menos metálico— pero conserva algo de brillo.
  larguero: { color: 0xffffff, roughness: 0.46, metalness: 0.6, envMapIntensity: 0.7 },
  //  Apoyos: galvanizado apagado. Son los más numerosos (dos por hueco), así que un reflejo
  //  fuerte repetido tantas veces robaría la atención; se dejan mates.
  apoyo: { color: 0xffffff, roughness: 0.55, metalness: 0.8, envMapIntensity: 0.55 },
  //  El separador es una MARCA, no hierro: va traslúcido para que se lea como una división
  //  del modelo y no se confunda con un montante. Sin escribir profundidad, porque cruza el
  //  hueco entero y opaco taparía lo que haya dentro.
  separador: {
    color: 0x8b98a8,
    roughness: 0.8,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  },
};

export function Almacen3D({
  escena,
  slots,
  onSeleccionar,
  onAbrirHueco,
  figuras = SIN_FIGURAS,
  onTocarFigura,
  onMoverFigura,
  onMoverRacks,
  snapToGrid = false,
  gridMeters = 0.25,
  modoPan = false,
  orden,
  figuraObjetivo,
  seleccion = SIN_SELECCION,
  ocupacion,
  posicionRecorrido,
  rumboRecorrido,
  figuraDelRecorrido,
  mostrarContextoCedi = false,
  className,
}: Almacen3DProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  //  El contexto del CEDI y el modo «sin techo». Viven aqui, en la vista, no en el store del
  //  editor: es como se esta mirando el plano, no algo que se publica ni se deshace con Ctrl+Z.
  //  El acomodo de racks del CEDI (estructura doble fondo del «Mapa mezzanine N2»). Cuando esta
  //  encendido, `/twin` muestra SOLO esa estanteria —sin edificio ni demas contexto— y oculta
  //  los racks del catalogo del WMS. Vive aqui, en la vista, no en el store del editor: es como
  //  se esta mirando el plano, no algo que se publica ni se deshace con Ctrl+Z.
  const [contexto, setContexto] = useState(mostrarContextoCedi);
  //  Las etiquetas de rack/columna (RCL…, C0xx), con la misma nomenclatura que 2D/3D/3D+.
  //  Arrancan encendidas; se conmutan en el pie sin reconstruir la escena.
  const [etiquetas, setEtiquetas] = useState(true);
  //  La instancia del CEDI (solo racks), para liberarla en la limpieza del efecto.
  const cediRef = useRef<Cedi | null>(null);
  const etiquetasRef = useRef(etiquetas);
  const [error, setError] = useState<string | null>(null);
  const [placas, setPlacas] = useState(0);
  //  Piezas de estanteria construidas. `0` significa que se dejaron los cajones macizos —o
  //  porque ningun rack tiene catalogo, o porque la escena se pasaba del tope— y eso hay que
  //  poder decirlo: un almacen que de pronto se ve como bloques no es un fallo de dibujo.
  const [piezas, setPiezas] = useState(0);
  //  Placas pintadas y la leyenda de lo que hay EN PANTALLA. La leyenda se calcula al construir
  //  la escena porque solo alli se sabe que se ha pintado de verdad: una leyenda sacada del
  //  vocabulario entero anunciaria colores que no estan.
  const [pintados, setPintados] = useState(0);
  const [leyenda, setLeyenda] = useState<
    { etiqueta: string; color: string; cuenta: number }[]
  >([]);
  //  Celdas del WMS sin placa donde pintarse. Ver donde se cuenta.
  const [sinPlaca, setSinPlaca] = useState(0);
  /*
    ── EL MODO ───────────────────────────────────────────────────────────────────

    Vive AQUI, en la propia vista, y no en el store del editor: es como se está mirando el
    plano, no algo que se publica ni que se deshace con Ctrl+Z. Si algún día el axonométrico
    quiere el mismo conmutador, entonces sí subirá al store.

    Arranca en `wms` porque es el modo con datos: `dron` pinta hoy cinco huecos de 9.673 y
    abrir la vista en negro se lee como que algo falló.
  */
  const [modo, setModo] = useState<ModoDeOcupacion>('wms');
  const [colocadas, setColocadas] = useState(0);
  const [fallidas, setFallidas] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);
  const [donde, setDonde] = useState<{ xM: number; yM: number; zM: number } | null>(null);

  //  Dónde quedó la cámara. Sobrevive al efecto para que guardar un arrastre —que invalida
  //  la consulta y vuelve a montar la escena— no devuelva la vista al encuadre inicial.
  const camaraGuardada = useRef<{
    pos: [number, number, number];
    mira: [number, number, number];
  } | null>(null);

  //  El mando de la camara, que el efecto de la escena rellena. Asi las ordenes de encuadre
  //  no tienen que reconstruir nada para mover la vista.
  const mandoDeCamara = useRef<((tipo: OrdenCamara3D) => void) | null>(null);
  //  Mueve el marcador del recorrido. Lo rellena el efecto de la escena, que es quien tiene
  //  la escena de three.js.
  const marcadorRecorrido = useRef<
    ((p: { x: number; y: number } | null, rumbo: number | null) => void) | null
  >(null);
  //  En una referencia y no en las dependencias del efecto de la escena: cambiar a que
  //  figura se mira no puede reconstruir 58.620 placas.
  const objetivoFigura = useRef<string | null>(null);
  objetivoFigura.current = figuraObjetivo ?? null;

  //  Las devoluciones de llamada en una referencia: si entraran en las dependencias del
  //  efecto, cada render del padre reconstruiría la escena entera —58.620 placas— y la
  //  cámara volvería a su sitio en cada clic.
  const cb = useRef({ onSeleccionar, onAbrirHueco, onTocarFigura, onMoverFigura, onMoverRacks });
  cb.current = { onSeleccionar, onAbrirHueco, onTocarFigura, onMoverFigura, onMoverRacks };

  //  Lo SELECCIONADO, por la misma razón que las devoluciones de llamada: cambia con cada
  //  clic y meterlo en las dependencias del efecto reconstruiría la escena entera —y las
  //  40.000 piezas de estantería— cada vez que se señala un rack.
  const seleccionRef = useRef<readonly string[]>(seleccion);
  seleccionRef.current = seleccion;

  /*
    ═══════════════════════════════════════════════════════════════════════════════
    UN MOTOR POR MONTAJE, Y CADA DATO REPINTA SOLO LO SUYO

    Medido como causa de que el 3D+ tardara en abrir: TODO vivía en un solo efecto con diez
    dependencias, y cada consulta que llegaba —el plano (dos páginas), las lecturas, las
    figuras, la ocupación (~2,5 s después)— lo tiraba entero y lo volvía a montar: un
    contexto WebGL nuevo, el mapa de entorno (PMREM) otra vez, los sombreadores compilados
    de cero y decenas de miles de piezas recalculadas. Cuatro o cinco veces al abrir.

    Ahora:
      · el MOTOR (renderer, escena, cámara, controles, entorno, luces, bucle, picking) se
        crea UNA vez por montaje — efecto sin dependencias;
      · la ESTRUCTURA (suelo, volúmenes, estantería, CEDI) se rehace solo si cambia el plano
        o el acomodo;
      · las PLACAS de los huecos, solo con lecturas, ocupación o modo;
      · las FIGURAS, solo con las figuras; la del RECORRIDO, solo con su modelo.
    Los controladores del motor leen lo que necesitan de referencias, así que ven siempre
    las mallas vigentes sin volver a registrarse. `modoPan`, la rejilla y el ajuste se leen
    también por referencia: cambiarlos no reconstruye nada.

    El orden de declaración importa: el efecto del motor va PRIMERO para que, al montar,
    los de contenido ya encuentren la escena en `tres`.
    ═══════════════════════════════════════════════════════════════════════════════
  */
  const tres = useRef<Tres | null>(null);
  //  Lo que el picking y la cámara consultan, siempre de la última construcción.
  const escenaConstruida = useRef<readonly RackEnEscena[]>([]);
  const mallaRacksRef = useRef<THREE.InstancedMesh | null>(null);
  const mallasHuecosRef = useRef<THREE.InstancedMesh[]>([]);
  const lecturaPorMallaRef = useRef(new Map<THREE.InstancedMesh, (SlotLeido | undefined)[]>());
  const cargadosRef = useRef<THREE.Object3D[]>([]);
  const figurasRef = useRef<readonly FiguraColocada[]>(figuras);
  const andanteRef = useRef<{ obj: THREE.Object3D; apoyo: number } | null>(null);
  //  Si la cámara ya se encuadró sobre racks de verdad, o solo sobre la vista provisional
  //  de mientras el plano no ha llegado. Ver el efecto de la estructura.
  const encuadrada = useRef<'no' | 'provisional' | 'escena'>('no');
  const modoPanRef = useRef(modoPan);
  modoPanRef.current = modoPan;
  const ajusteRef = useRef({ snapToGrid, gridMeters });
  ajusteRef.current = { snapToGrid, gridMeters };
  const contextoRef = useRef(contexto);
  contextoRef.current = contexto;

  // ── EL MOTOR: una vez por montaje ───────────────────────────────────────────
  useEffect(() => {
    const host = contenedor.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      //  Una máquina sin WebGL —o con la aceleración desactivada— no puede con esta vista.
      //  Se dice, en vez de dejar un rectángulo negro que parece un fallo de carga.
      setError('Este navegador no tiene WebGL disponible. Las vistas 2D y axonométrica sí funcionan.');
      return;
    }
    //  Tope de 2: por encima, cuadruplicar píxeles en una pantalla de portátil no se
    //  distingue y sí se nota en fotogramas por segundo.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    //  Tono fílmico (ACES) y exposición: sin esto, los metales con reflejo se queman en los
    //  brillos y aplastan los grises. `outputColorSpace` ya es sRGB por defecto en esta
    //  versión, pero se fija para que no dependa de un default futuro.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR_FONDO);

    /*
      ── EL ENTORNO QUE EL METAL REFLEJA ───────────────────────────────────────

      Un material metálico es, casi todo, lo que REFLEJA. Sin un entorno que reflejar,
      `metalness` alto se ve plano y oscuro. Se genera UNA vez por montaje un pequeño estudio
      (`RoomEnvironment`) precalculado con `PMREMGenerator`, sin cargar ninguna imagen externa.
      Se libera en la limpieza: la textura de PMREM y su generador no los recoge el contexto.
    */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const entornoRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = entornoRT.texture;

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    const controles = new OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    controles.dampingFactor = 0.08;
    //  No se deja pasar por debajo del suelo: mirar el almacén desde el subsuelo no
    //  informa de nada y desorienta.
    controles.maxPolarAngle = Math.PI / 2 - 0.02;
    /*
      ── DESPLAZARSE, NO SOLO GIRAR ────────────────────────────────────────────

      Tres formas, las MISMAS que en el visor axonométrico: la herramienta MOVER (`modoPan`),
      Mayús/espacio + arrastrar, y el botón central o el derecho. `screenSpacePanning`
      desplaza en el plano de la PANTALLA: con `false`, mirando casi de frente el
      desplazamiento vertical se convierte en un avance enorme sobre el suelo.
      El botón izquierdo según `modoPan` lo fija su propio efecto, más abajo.
    */
    controles.screenSpacePanning = true;
    controles.mouseButtons = {
      LEFT: modoPanRef.current ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    /*
      ── ESPACIO O MAYUS + ARRASTRAR DESPLAZA ──────────────────────────────────

      Se conmuta al vuelo: `OrbitControls` decide el gesto al PULSAR. El espacio se traga
      (`preventDefault`) mientras el puntero está sobre el lienzo: sin eso, la página hace
      scroll a la vez que se desplaza la vista.
    */
    let sobreElLienzo = false;
    const alEntrar = () => {
      sobreElLienzo = true;
    };
    const alSalir = () => {
      sobreElLienzo = false;
    };
    const esTeclaDePan = (e: KeyboardEvent) => e.key === 'Shift' || e.code === 'Space';
    const alTeclaBajar = (e: KeyboardEvent) => {
      if (!esTeclaDePan(e) || modoPanRef.current) return;
      controles.mouseButtons.LEFT = THREE.MOUSE.PAN;
      if (e.code === 'Space' && sobreElLienzo) e.preventDefault();
    };
    const alTeclaSubir = (e: KeyboardEvent) => {
      if (!esTeclaDePan(e) || modoPanRef.current) return;
      controles.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    };
    //  Al perder el foco de la ventana no llega el `keyup`, y la vista se quedaría en modo
    //  desplazar para siempre — con Alt+Tab, que es constante—.
    const alPerderFoco = () => {
      if (!modoPanRef.current) controles.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    };
    window.addEventListener('keydown', alTeclaBajar);
    window.addEventListener('keyup', alTeclaSubir);
    window.addEventListener('blur', alPerderFoco);
    renderer.domElement.addEventListener('pointerenter', alEntrar);
    renderer.domElement.addEventListener('pointerleave', alSalir);

    // ── Luces ────────────────────────────────────────────────────────────────
    //
    //  Hemisférica para que nada quede en negro absoluto y una direccional para que las
    //  cajas se lean como volúmenes. Sin sombras proyectadas: cuestan y no informan.
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1d24, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.5);
    sol.position.set(1, 2, 1.4);
    scene.add(sol);

    //  Una cámara que sobrevive a un remontaje (el doble montaje de desarrollo) vuelve a
    //  donde estaba en vez de reencuadrar.
    if (camaraGuardada.current) {
      const g = camaraGuardada.current;
      camera.position.set(g.pos[0], g.pos[1], g.pos[2]);
      controles.target.set(g.mira[0], g.mira[1], g.mira[2]);
      encuadrada.current = 'escena';
    } else {
      controles.target.set(0, 0, 0);
      camera.position.set(30, 25, 30);
      encuadrada.current = 'no';
    }
    controles.update();

    // ── Picking ──────────────────────────────────────────────────────────────
    //
    //  Un rayo desde el cursor, con la profundidad real: se toca lo que está delante.
    //  Las mallas se leen de referencias en cada gesto, así que siempre son las vigentes.
    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eje = new THREE.Vector3(0, 1, 0);
    const vPos = new THREE.Vector3();
    const vEsc = new THREE.Vector3();
    let arrastro = false;

    /** Pone el rayo donde está el cursor. Devuelve `false` si el lienzo no tiene tamaño. */
    const apuntar = (e: MouseEvent): boolean => {
      const caja = renderer.domElement.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) return false;
      puntero.x = ((e.clientX - caja.left) / caja.width) * 2 - 1;
      puntero.y = -((e.clientY - caja.top) / caja.height) * 2 + 1;
      rayo.setFromCamera(puntero, camera);
      return true;
    };

    /*
      ── ARRASTRAR UNA FIGURA ──────────────────────────────────────────────────

      En perspectiva un píxel es una RECTA: hay que decir contra qué plano se corta.
        arrastrar          plano HORIZONTAL a la altura actual  → mover por el suelo
        Mayús + arrastrar  plano VERTICAL de cara a la cámara   → cambiar la altura
      La aritmética está en `arrastre.ts` con sus pruebas. Mientras se arrastra,
      `OrbitControls` se APAGA para no mover la figura y girar la cámara a la vez.
    */
    const planoThree = new THREE.Plane();
    const cortePlano = new THREE.Vector3();
    let agarrada:
      | {
          obj: THREE.Object3D;
          id: string;
          desfase: PuntoMundo;
          inicio: { xM: number; yM: number; zM: number };
          vertical: boolean;
        }
      | null = null;

    /*
      ── AGARRAR UN RACK ───────────────────────────────────────────────────────

      Un rack es una instancia dentro de `mallaRacks`: se agarra por su `instanceIndex` —su
      posición en la escena construida— y se mueve recalculando SU matriz con `cajaDeRack`.
      Se guardan la malla y la escena del momento: si llega otro plano a mitad del gesto, la
      malla vieja ya no está en pantalla y el arrastre se suelta en vez de mover otra cosa.
    */
    let agarradaRacks:
      | {
          malla: THREE.InstancedMesh;
          escena: readonly RackEnEscena[];
          items: { layoutId: string; instanceIndex: number; x0: number; y0: number }[];
          desfase: { x: number; z: number };
          alturaY: number;
          dx: number;
          dy: number;
        }
      | null = null;

    const ponerPlano = (p: PlanoDeArrastre) => {
      planoThree.set(new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]), p.constante);
    };

    const matrizDeRack = (r: RackEnEscena): THREE.Matrix4 => {
      const c = cajaDeRack(r);
      q.setFromAxisAngle(eje, c.giroY);
      return m.compose(vPos.set(...c.posicion), q, vEsc.set(...c.escala));
    };

    const soltarSinGuardar = () => {
      agarrada = null;
      agarradaRacks = null;
      controles.enabled = true;
      setArrastrando(false);
      setDonde(null);
    };

    const alBajar = (e: MouseEvent) => {
      arrastro = false;
      //  Solo el botón principal: el secundario y el central son de la cámara.
      if (e.button !== 0) return;
      if (!apuntar(e)) return;

      //  Las FIGURAS primero: quien pincha una quiere agarrarla a ella, no al rack de detrás.
      const cargados = cargadosRef.current;
      if (cargados.length > 0 && cb.current.onMoverFigura) {
        const tocada = rayo.intersectObjects(cargados, true)[0];
        const id = tocada?.object.userData?.figuraId as string | undefined;
        //  El objeto raíz, no la hoja que tocó el rayo.
        const obj = id
          ? cargados.find((o) => o.userData.figuraId === id || o.name === `figura:${id}`)
          : undefined;
        if (tocada && id && obj) {
          const vertical = e.shiftKey;
          const pos = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
          const plano = vertical
            ? planoVertical(
                { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                pos,
              )
            : planoHorizontal(pos.y);
          //  Sin plano —cámara justo encima— no se arrastra en vertical.
          if (plano) {
            ponerPlano(plano);
            if (rayo.ray.intersectPlane(planoThree, cortePlano)) {
              agarrada = {
                obj,
                id,
                //  Se agarra POR DONDE se pinchó: sin el desfase la figura salta al cursor.
                desfase: {
                  x: pos.x - cortePlano.x,
                  y: pos.y - cortePlano.y,
                  z: pos.z - cortePlano.z,
                },
                inicio: aDominio(pos),
                vertical,
              };
              controles.enabled = false;
              setArrastrando(true);
              setDonde(aDominio(pos));
              e.preventDefault();
              return;
            }
          }
        }
      }

      //  Luego los RACKS, si esta vista los deja mover.
      const mallaRacks = mallaRacksRef.current;
      if (cb.current.onMoverRacks && mallaRacks) {
        const escena = escenaConstruida.current;
        const enRacks = rayo.intersectObject(mallaRacks, false)[0];
        const rack = enRacks?.instanceId != null ? escena[enRacks.instanceId] : undefined;
        if (!rack) return;

        //  Si el rack tocado forma parte de la selección y hay más de uno, se mueven TODOS.
        const idsSeleccion = new Set(seleccionRef.current);
        const enGrupo = idsSeleccion.has(rack.layoutId) && idsSeleccion.size > 1;
        const items = (enGrupo ? escena.filter((r) => idsSeleccion.has(r.layoutId)) : [rack]).map(
          (r) => ({ layoutId: r.layoutId, instanceIndex: escena.indexOf(r), x0: r.x, y0: r.y }),
        );

        //  El plano horizontal a la altura DEL RACK: un rack no cambia de altura.
        ponerPlano(planoHorizontal(rack.alto / 2));
        if (!rayo.ray.intersectPlane(planoThree, cortePlano)) return;

        agarradaRacks = {
          malla: mallaRacks,
          escena,
          items,
          desfase: { x: rack.x - cortePlano.x, z: rack.y - cortePlano.z },
          alturaY: rack.alto / 2,
          dx: 0,
          dy: 0,
        };
        controles.enabled = false;
        setArrastrando(true);
        setDonde({ xM: rack.x, yM: rack.y, zM: rack.alto / 2 });
        e.preventDefault();
      }
    };

    const alMover = (e: MouseEvent) => {
      arrastro = true;
      if (agarrada) {
        //  La figura agarrada ya no está (llegaron otras figuras a mitad del gesto).
        if (!cargadosRef.current.includes(agarrada.obj)) {
          soltarSinGuardar();
          return;
        }
        if (!apuntar(e)) return;
        if (!rayo.ray.intersectPlane(planoThree, cortePlano)) return;
        const destino = destinoDeArrastre({
          puntoEnPlano: { x: cortePlano.x, y: cortePlano.y, z: cortePlano.z },
          desfase: agarrada.desfase,
          posicionActual: {
            x: agarrada.obj.position.x,
            y: agarrada.obj.position.y,
            z: agarrada.obj.position.z,
          },
          vertical: agarrada.vertical,
        });
        agarrada.obj.position.set(destino.x, destino.y, destino.z);
        setDonde(aDominio(destino));
        return;
      }

      if (agarradaRacks) {
        //  Llegó otro plano a mitad del gesto: la malla agarrada ya no se dibuja.
        if (mallaRacksRef.current !== agarradaRacks.malla) {
          soltarSinGuardar();
          return;
        }
        if (!apuntar(e)) return;
        if (!rayo.ray.intersectPlane(planoThree, cortePlano)) return;
        let nuevoX = cortePlano.x + agarradaRacks.desfase.x;
        let nuevoY = cortePlano.z + agarradaRacks.desfase.z;
        const { snapToGrid: ajustar, gridMeters: rejillaM } = ajusteRef.current;
        if (ajustar && rejillaM > 0) {
          nuevoX = Math.round(nuevoX / rejillaM) * rejillaM;
          nuevoY = Math.round(nuevoY / rejillaM) * rejillaM;
        }
        const primero = agarradaRacks.items[0]!;
        agarradaRacks.dx = nuevoX - primero.x0;
        agarradaRacks.dy = nuevoY - primero.y0;

        //  Se mueve la MATRIZ de cada rack del grupo, no la escena entera. `cajaDeRack` es la
        //  MISMA función que construyó la malla: la posición final coincide con la que saldrá
        //  al reconstruir de verdad, tras soltar.
        for (const it of agarradaRacks.items) {
          const r = agarradaRacks.escena[it.instanceIndex];
          if (!r) continue;
          agarradaRacks.malla.setMatrixAt(
            it.instanceIndex,
            matrizDeRack({ ...r, x: it.x0 + agarradaRacks.dx, y: it.y0 + agarradaRacks.dy }),
          );
        }
        agarradaRacks.malla.instanceMatrix.needsUpdate = true;
        setDonde({ xM: nuevoX, yM: nuevoY, zM: agarradaRacks.alturaY });
      }
    };

    const alSoltar = () => {
      const g = agarrada;
      const gr = agarradaRacks;
      soltarSinGuardar();

      if (g) {
        const fin = aDominio({ x: g.obj.position.x, y: g.obj.position.y, z: g.obj.position.z });
        //  Se guarda solo si de verdad se movió.
        if (movimientoApreciable(g.inicio, fin)) cb.current.onMoverFigura?.(g.id, fin);
      }

      if (gr) {
        const primero = gr.items[0]!;
        const inicio = { xM: primero.x0, yM: primero.y0, zM: gr.alturaY };
        const fin = {
          xM: Number((primero.x0 + gr.dx).toFixed(3)),
          yM: Number((primero.y0 + gr.dy).toFixed(3)),
          zM: gr.alturaY,
        };
        if (movimientoApreciable(inicio, fin)) {
          cb.current.onMoverRacks?.(
            gr.items.map((it) => ({
              layoutId: it.layoutId,
              from: { x: it.x0, y: it.y0 },
              to: {
                x: Number((it.x0 + gr.dx).toFixed(3)),
                y: Number((it.y0 + gr.dy).toFixed(3)),
              },
            })),
          );
        } else {
          //  No se guarda, pero la matriz YA se desplazó en pantalla: se devuelve a su sitio.
          for (const it of gr.items) {
            const r = gr.escena[it.instanceIndex];
            if (!r) continue;
            gr.malla.setMatrixAt(it.instanceIndex, matrizDeRack(r));
          }
          gr.malla.instanceMatrix.needsUpdate = true;
        }
      }
    };

    const alPulsar = (e: MouseEvent) => {
      //  Girar la cámara no es señalar nada. Mismo criterio que la vista axonométrica.
      if (arrastro) return;
      if (!apuntar(e)) return;
      const escena = escenaConstruida.current;
      //  Las FIGURAS antes que nada: quien pincha una persona quiere la persona. `true` para
      //  recorrer los hijos del `.glb`; de la hoja se sube al id por `userData`.
      const cargados = cargadosRef.current;
      if (cargados.length > 0) {
        const tocada = rayo.intersectObjects(cargados, true)[0];
        const id = tocada?.object.userData?.figuraId as string | undefined;
        if (id) {
          cb.current.onTocarFigura?.(id);
          return;
        }
      }
      /*
        ── LOS HUECOS, Y POR QUE HAY UN MARGEN ───────────────────────────────────

        Con el volumen traslúcido, la placa de la cara de ATRÁS se ve a través del rack; con
        la regla estricta el rayo se quedaba con el cajón, 1,14 m por delante, y un hueco
        visible no se podía abrir. El margen alcanza la cara de atrás del rack tocado y NO el
        de más allá. Contra TODAS las mallas de huecos —una por opacidad—, el corte más cercano.
      */
      const enHuecos = rayo
        .intersectObjects(mallasHuecosRef.current, false)
        .sort((a, b) => a.distance - b.distance);
      const mallaRacks = mallaRacksRef.current;
      const enRacks = mallaRacks ? rayo.intersectObject(mallaRacks, false) : [];
      const primero = enHuecos[0];
      const rackTocado = enRacks[0];
      if (
        primero &&
        primero.instanceId != null &&
        (!rackTocado || primero.distance <= rackTocado.distance + MARGEN_HUECO_M)
      ) {
        const leido = lecturaPorMallaRef.current.get(primero.object as THREE.InstancedMesh)?.[
          primero.instanceId
        ];
        //  El rack también se selecciona: abrir el hueco no le quita al clic lo que ya hacía.
        if (rackTocado?.instanceId != null) {
          cb.current.onSeleccionar?.(escena[rackTocado.instanceId] ?? null);
        }
        if (leido) cb.current.onAbrirHueco?.(leido);
        return;
      }
      cb.current.onSeleccionar?.(
        rackTocado?.instanceId != null ? (escena[rackTocado.instanceId] ?? null) : null,
      );
    };
    renderer.domElement.addEventListener('pointerdown', alBajar);
    renderer.domElement.addEventListener('pointermove', alMover);
    renderer.domElement.addEventListener('click', alPulsar);
    //  `pointerup` en la VENTANA: soltar fuera del lienzo es normal al arrastrar hasta el
    //  borde, y escuchando solo el lienzo la figura se quedaría pegada al ratón.
    window.addEventListener('pointerup', alSoltar);
    //  Y al perder el puntero: un arrastre que no termina deja la cámara apagada.
    window.addEventListener('pointercancel', alSoltar);

    // ── Tamaño ───────────────────────────────────────────────────────────────
    const medir = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(host);

    /*
      El mando de la cámara, para el efecto de las órdenes. `ajustar` recalcula el encuadre
      desde cero y acercar/alejar mueven la cámara por la línea que la une con el objetivo,
      que es lo que hace un zoom en perspectiva.
    */
    mandoDeCamara.current = (tipo) => {
      const escena = escenaConstruida.current;
      const alObjetivo = new THREE.Vector3().subVectors(camera.position, controles.target);
      if (tipo === 'acercar' || tipo === 'alejar') {
        const f = tipo === 'acercar' ? 0.75 : 1 / 0.75;
        //  Con un tope mínimo: sin él, acercar repetidamente mete la cámara dentro de un rack.
        const largo = Math.max(1.5, alObjetivo.length() * f);
        camera.position.copy(controles.target).add(alObjetivo.setLength(largo));
      } else if (tipo === 'ajustar' || tipo === 'irASeleccion') {
        //  El mismo encuadre sobre la escena entera o sobre lo marcado. Sin selección se
        //  comporta como «ajustar».
        const ids = new Set(seleccionRef.current);
        const deInteres =
          tipo === 'irASeleccion' && ids.size > 0
            ? escena.filter((r) => ids.has(r.layoutId))
            : escena;
        const e = encuadreDe(deInteres);
        if (!e) return;
        const [cx, cy, cz] = e.centro;
        controles.target.set(cx, cy, cz);
        const d = (e.radio / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
        const dir = new THREE.Vector3(0.7, 0.55, 0.7).normalize().multiplyScalar(d);
        camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z);
      } else if (tipo === 'irAFigura') {
        //  Una persona de 1,75 m en una nave de 290 m ocupa cinco píxeles. La cámara va
        //  cuatro metros por encima del rack más alto —a 45° y 12 m acababa DENTRO de uno— y
        //  mirando hacia abajo.
        const f = figurasRef.current.find((x) => x.id === objetivoFigura.current);
        if (!f) return;
        controles.target.set(f.xM, f.zM + 1, f.yM);
        const masAlto = escena.reduce((mx, r) => Math.max(mx, r.alto), 0);
        const alturaOjo = Math.max(8, masAlto + 4);
        const dir = new THREE.Vector3(0.55, 1, 0.55).normalize();
        camera.position.copy(controles.target).add(dir.multiplyScalar(alturaOjo / dir.y));
      } else {
        //  Volver al ángulo de partida SIN cambiar la distancia.
        const dir = new THREE.Vector3(0.7, 0.55, 0.7).normalize().multiplyScalar(
          alObjetivo.length(),
        );
        camera.position.copy(controles.target).add(dir);
      }
      controles.update();
    };

    /*
      El marcador del recorrido: una esfera de 40 cm. Se crea UNA vez y se esconde cuando no
      hay reproducción; la figura que anda (si su `.glb` cargó) la sustituye.
    */
    const geoMarca = new THREE.SphereGeometry(0.4, 16, 12);
    const matMarca = new THREE.MeshStandardMaterial({
      color: 0x5eead4,
      emissive: 0x134e4a,
      roughness: 0.4,
    });
    const marcador = new THREE.Mesh(geoMarca, matMarca);
    marcador.visible = false;
    scene.add(marcador);

    marcadorRecorrido.current = (p, rumbo) => {
      const andante = andanteRef.current;
      if (!p) {
        marcador.visible = false;
        if (andante) andante.obj.visible = false;
        return;
      }
      //  A media altura de una persona: pegado al suelo se pierde entre la rejilla.
      marcador.position.set(p.x, 0.9, p.y);
      //  El marcador solo cuando NO hay figura: con los dos, la esfera flota dentro de ella.
      marcador.visible = !andante;
      if (andante) {
        andante.obj.position.set(p.x, andante.apoyo, p.y);
        //  Sin rumbo se conserva el último: es lo que hace alguien parado en una parada.
        if (rumbo != null) andante.obj.rotation.y = rumbo;
        andante.obj.visible = true;
      }
    };

    tres.current = { renderer, scene, camera, controles };

    const reloj = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      controles.update();
      const dt = reloj.getDelta();
      //  Con el acomodo, la cámara nunca baja de y = 0.6 (§14.4), ni ella ni su objetivo.
      if (contextoRef.current) {
        if (controles.target.y < 0.6) controles.target.y = 0.6;
        if (camera.position.y < 0.6) camera.position.y = 0.6;
        cediRef.current?.actualizar(dt, camera);
      }
      camaraGuardada.current = {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        mira: [controles.target.x, controles.target.y, controles.target.z],
      };
      renderer.render(scene, camera);
    });

    return () => {
      //  Soltarlo TODO. Un contexto WebGL no lo recoge el recolector de basura: cambiar de
      //  vista veinte veces sin esto deja veinte contextos vivos. El contenido (estructura,
      //  placas, figuras) lo liberan sus propios efectos.
      tres.current = null;
      renderer.setAnimationLoop(null);
      observador.disconnect();
      renderer.domElement.removeEventListener('pointerdown', alBajar);
      renderer.domElement.removeEventListener('pointermove', alMover);
      renderer.domElement.removeEventListener('click', alPulsar);
      window.removeEventListener('pointerup', alSoltar);
      window.removeEventListener('pointercancel', alSoltar);
      window.removeEventListener('keydown', alTeclaBajar);
      window.removeEventListener('keyup', alTeclaSubir);
      window.removeEventListener('blur', alPerderFoco);
      renderer.domElement.removeEventListener('pointerenter', alEntrar);
      renderer.domElement.removeEventListener('pointerleave', alSalir);
      controles.dispose();
      scene.environment = null;
      entornoRT.dispose();
      pmrem.dispose();
      mandoDeCamara.current = null;
      marcadorRecorrido.current = null;
      geoMarca.dispose();
      matMarca.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  //  La herramienta MOVER: cambia el botón izquierdo de la cámara viva, sin reconstruir.
  useEffect(() => {
    const t = tres.current;
    if (t) t.controles.mouseButtons.LEFT = modoPan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }, [modoPan]);

  // ── LA ESTRUCTURA: suelo, volúmenes, estantería y acomodo del CEDI ─────────────
  useEffect(() => {
    const t = tres.current;
    if (!t) return;
    const { scene, camera, controles } = t;

    /*
      ── EL ACOMODO DEL CEDI ────────────────────────────────────────────────────

      Solo la estantería del acomodo del Excel, en un grupo reflejado con las coordenadas
      lógicas del documento. Cuando está encendido se ocultan los racks del catálogo.
    */
    let cedi: Cedi | null = null;
    if (contexto) {
      cedi = construirCedi({ soloRacks: true, conEtiquetas: etiquetasRef.current });
      scene.add(cedi.grupo);
      cediRef.current = cedi;
    }

    const encuadre = encuadreDe(escena);

    // ── El suelo ─────────────────────────────────────────────────────────────
    const lado = Math.max(60, (encuadre?.radio ?? 30) * 3);
    const suelo = new THREE.Mesh(
      new THREE.PlaneGeometry(lado, lado),
      new THREE.MeshStandardMaterial({ color: COLOR_SUELO, roughness: 0.95 }),
    );
    suelo.rotation.x = -Math.PI / 2;
    if (encuadre) suelo.position.set(encuadre.centro[0], 0, encuadre.centro[2]);
    scene.add(suelo);

    const rejilla = new THREE.GridHelper(lado, Math.round(lado), 0x2a3038, 0x20252c);
    if (encuadre) rejilla.position.set(encuadre.centro[0], 0.01, encuadre.centro[2]);
    scene.add(rejilla);

    /*
      ── EL RACK: UN VOLUMEN PARA APUNTAR, Y LA ESTANTERIA DENTRO ───────────────

      El cajón traslúcido y sin escribir profundidad: es contra lo que dispara el rayo del
      picking —una malla de barras finas es casi imposible de acertar— y a cien metros da la
      silueta y el color de familia. `depthWrite: false` deja ver lo de dentro.
    */
    const geoCaja = new THREE.BoxGeometry(1, 1, 1);
    const matRack = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.05,
      transparent: true,
      opacity: OPACIDAD_VOLUMEN,
      depthWrite: false,
    });
    const mallaRacks = new THREE.InstancedMesh(geoCaja, matRack, Math.max(1, escena.length));
    mallaRacks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    //  Temporales REUTILIZADOS: con ~90.000 piezas, dos `Vector3` nuevos por pieza eran
    //  180.000 objetos para el recolector en cada construcción.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const vPos = new THREE.Vector3();
    const vEsc = new THREE.Vector3();
    const color = new THREE.Color();
    const eje = new THREE.Vector3(0, 1, 0);
    escena.forEach((r, i) => {
      const c = cajaDeRack(r);
      q.setFromAxisAngle(eje, c.giroY);
      m.compose(vPos.set(...c.posicion), q, vEsc.set(...c.escala));
      mallaRacks.setMatrixAt(i, m);
      mallaRacks.setColorAt(i, color.set(r.color));
    });
    mallaRacks.count = escena.length;
    scene.add(mallaRacks);

    /*
      ── LA ESTANTERIA: MONTANTES, LARGUEROS Y LOS DOS HUECOS DE CADA CELDA ─────

      Se construye del CATALOGO —cuerpos, niveles y posiciones de cada rack— y no de un
      modelo descargado. Se cuenta primero y cada malla se pide del tamaño exacto. Los racks
      que el catálogo no conoce —`cuerpos = 0`— se quedan como cajón macizo.
    */
    const totalPiezas = cuantasPiezas(escena);
    const conEstructura = totalPiezas > 0 && totalPiezas <= PIEZAS_MAXIMAS;
    const porTipo = new Map<TipoDePieza, Pieza[]>();
    if (conEstructura) {
      for (const r of escena) {
        for (const p of estructuraDeRack(r)) {
          const lista = porTipo.get(p.tipo);
          if (lista) lista.push(p);
          else porTipo.set(p.tipo, [p]);
        }
      }
    }
    setPiezas(conEstructura ? totalPiezas : 0);

    const mallasEstructura: THREE.InstancedMesh[] = [];
    for (const [tipo, piezas] of porTipo) {
      //  El MATERIAL da el acabado por tipo de pieza; el COLOR lo pone cada instancia.
      const malla = new THREE.InstancedMesh(
        geoCaja,
        new THREE.MeshStandardMaterial({ ...MATERIAL_PIEZA[tipo], color: 0xffffff }),
        piezas.length,
      );
      malla.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      //  El rayo NO pregunta por las barras: quien pincha un rack quiere el rack.
      malla.raycast = () => {};
      piezas.forEach((p, i) => {
        q.setFromAxisAngle(eje, p.giroY);
        m.compose(vPos.set(...p.posicion), q, vEsc.set(...p.escala));
        malla.setMatrixAt(i, m);
        malla.setColorAt(i, color.set(p.color));
      });
      scene.add(malla);
      mallasEstructura.push(malla);
    }

    //  Los racks SIN estructura vuelven a ser un cajón sólido.
    const sinCatalogo = conEstructura ? escena.filter((r) => r.cuerpos <= 0) : [...escena];
    const mallaMacizos = new THREE.InstancedMesh(
      geoCaja,
      new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
      Math.max(1, sinCatalogo.length),
    );
    //  Tampoco recibe el rayo: su `instanceId` sería el de ESTA lista y no el de la escena.
    mallaMacizos.raycast = () => {};
    sinCatalogo.forEach((r, i) => {
      const c = cajaDeRack(r);
      q.setFromAxisAngle(eje, c.giroY);
      m.compose(vPos.set(...c.posicion), q, vEsc.set(...c.escala));
      mallaMacizos.setMatrixAt(i, m);
      mallaMacizos.setColorAt(i, color.set(r.color));
    });
    mallaMacizos.count = sinCatalogo.length;
    scene.add(mallaMacizos);

    //  Con el acomodo encendido se ocultan las mallas del catálogo del WMS —también las
    //  placas, que viven en su propio efecto—. Se crean igual: el picking las necesita.
    for (const o of [mallaRacks, mallaMacizos, ...mallasEstructura, ...mallasHuecosRef.current]) {
      o.visible = !contexto;
    }

    escenaConstruida.current = escena;
    mallaRacksRef.current = mallaRacks;

    /*
      ── EL ENCUADRE ───────────────────────────────────────────────────────────

      La cámara ya no se recrea con cada dato, así que se encuadra AQUÍ y una sola vez sobre
      racks de verdad. Mientras el plano no ha llegado se usa una vista provisional (la del
      CEDI o la de partida) y, cuando llegan los racks, se encuadra sobre ellos.
    */
    if (encuadre && encuadrada.current !== 'escena') {
      const [cx, cy, cz] = encuadre.centro;
      controles.target.set(cx, cy, cz);
      //  La distancia sale del campo de visión: para que una esfera de radio R entre justo,
      //  la cámara va a `R / sen(fov/2)`. La dirección, normalizada.
      const d = (encuadre.radio / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
      const dir = new THREE.Vector3(0.7, 0.55, 0.7).normalize().multiplyScalar(d);
      camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z);
      encuadrada.current = 'escena';
      controles.update();
    } else if (!encuadre && contexto && encuadrada.current === 'no') {
      //  Vista inicial del CEDI (§14.4): oblicua desde el frente-oeste, a unos 220 m.
      controles.target.set(0, 1, -40);
      const dir = new THREE.Vector3(-0.45, 0.5, -0.78).normalize().multiplyScalar(220);
      camera.position.set(dir.x, Math.max(0.6, dir.y), -40 + dir.z);
      encuadrada.current = 'provisional';
      controles.update();
    }

    return () => {
      for (const o of [suelo, rejilla, mallaRacks, mallaMacizos, ...mallasEstructura]) {
        scene.remove(o);
      }
      geoCaja.dispose();
      matRack.dispose();
      mallaRacks.dispose();
      for (const malla of mallasEstructura) {
        malla.dispose();
        (malla.material as THREE.Material).dispose();
      }
      mallaMacizos.dispose();
      (mallaMacizos.material as THREE.Material).dispose();
      suelo.geometry.dispose();
      (suelo.material as THREE.Material).dispose();
      rejilla.geometry.dispose();
      (rejilla.material as THREE.Material).dispose();
      if (mallaRacksRef.current === mallaRacks) mallaRacksRef.current = null;
      //  El CEDI: libera geometrías, materiales y sus texturas procedurales.
      if (cedi) {
        scene.remove(cedi.grupo);
        cedi.dispose();
      }
      cediRef.current = null;
    };
  }, [escena, contexto]);

  // ── LAS PLACAS DE LOS HUECOS: lo que vio el dron y, debajo, lo que dijo el WMS ──
  useEffect(() => {
    const t = tres.current;
    if (!t) return;
    const { scene } = t;

    /*
      Dos reglas, que están en `ocupacion.ts`: la INSPECCION manda sobre la palabra del WMS,
      y el hueco VACIO no se pinta (pintar las 9.673 celdas convertiría cada rack en una losa).

      `InstancedMesh` lleva color por instancia pero NO opacidad, y la opacidad es
      información: se agrupa por opacidad y sale una malla por cada valor distinto.
    */
    const geoPlaca = new THREE.BoxGeometry(1, 1, 1);
    const q = new THREE.Quaternion();
    const vPos = new THREE.Vector3();
    const vEsc = new THREE.Vector3();
    const color = new THREE.Color();
    const eje = new THREE.Vector3(0, 1, 0);

    /** Una placa lista para instanciar, con su color, su opacidad y a que lectura pertenece. */
    interface PlacaPintada {
      matriz: THREE.Matrix4;
      color: string;
      etiqueta: string;
      leido: SlotLeido | undefined;
      locationId: string | null;
    }

    //  Índice de la situación del WMS por rack y celda.
    const wmsPorRack = new Map<string, Map<string, { situacion: string; conflicto: boolean }>>();
    for (const r of ocupacion?.racks ?? []) {
      const porCelda = new Map<string, { situacion: string; conflicto: boolean }>();
      for (const c of r.celdas) {
        porCelda.set(
          //  `bay_index` del catálogo empieza en 1 y el índice de la rejilla en 0.
          claveDeHueco(c[CELDA.cuerpo]! - 1, c[CELDA.nivel]!, c[CELDA.posicion]!),
          {
            situacion: ocupacion?.situaciones[c[CELDA.situacion]!] ?? '',
            conflicto: c[CELDA.conflicto] === 1,
          },
        );
      }
      wmsPorRack.set(r.rackNodeId, porCelda);
    }

    const porOpacidad = new Map<number, PlacaPintada[]>();
    //  Los huecos pintados, DEDUPLICADOS: cada hueco pone hasta dos placas —una por cara—.
    const pintadosPorHueco = new Set<string>();
    //  Las celdas del WMS que NO encontraron placa donde pintarse (la rejilla es derivada).
    let wmsSinPlaca = 0;
    //  Los huecos DISTINTOS con lectura.
    const huecos = new Set<string>();
    //  Cuántas celdas de cada palabra se han pintado, para la leyenda.
    const cuentas = new Map<string, number>();

    for (const r of escena) {
      const leidos = new Map<string, SlotLeido>();
      for (const sl of (r.rackId ? slots?.get(r.rackId) : undefined) ?? []) {
        if (sl.bayIndex == null || sl.level == null) continue;
        leidos.set(claveDeHueco(sl.bayIndex - 1, sl.level, sl.position ?? 1), sl);
        //  «Huecos con lectura» es una propiedad del dato, no de lo que se dibuja.
        if (estadoDeSlot(sl.status) !== 'sin_leer') huecos.add(sl.locationId);
      }
      const wms = r.rackId ? wmsPorRack.get(r.rackId) : undefined;
      if (leidos.size === 0 && !wms) continue;
      const conPlaca = new Set<string>();

      for (const p of placasDeHuecos(r)) {
        const clave = claveDeHueco(p.cuerpo, p.nivel, p.posicion_);
        conPlaca.add(clave);
        const leido = leidos.get(clave);
        const dato = wms?.get(clave) ?? null;
        const estado = leido ? estadoDeSlot(leido.status) : null;
        //  QUÉ color lleva este hueco lo decide el dominio, según el modo.
        const pintura = pinturaDeHueco(modo, estado, dato);
        if (!pintura) continue;

        if (!pintadosPorHueco.has(`${r.layoutId}|${clave}`)) {
          const k =
            modo === 'wms'
              ? dato!.conflicto
                ? '__conflicto__'
                : dato!.situacion
              : `__${pintura.etiqueta}__`;
          cuentas.set(k, (cuentas.get(k) ?? 0) + 1);
        }
        pintadosPorHueco.add(`${r.layoutId}|${clave}`);

        q.setFromAxisAngle(eje, p.giroY);
        const matriz = new THREE.Matrix4().compose(
          vPos.set(...p.posicion),
          q,
          vEsc.set(...p.escala),
        );
        const placa: PlacaPintada = {
          matriz,
          color: pintura.color,
          etiqueta: pintura.etiqueta,
          leido,
          locationId: leido?.locationId ?? null,
        };
        const bolsa = porOpacidad.get(pintura.opacidad);
        if (bolsa) bolsa.push(placa);
        else porOpacidad.set(pintura.opacidad, [placa]);
      }

      for (const clave of wms?.keys() ?? []) {
        if (!conPlaca.has(clave)) wmsSinPlaca += 1;
      }
    }

    //  Una malla por opacidad, y el mapa de `instanceId` a lectura por malla.
    const mallasHuecos: THREE.InstancedMesh[] = [];
    const lecturaPorMalla = new Map<THREE.InstancedMesh, (SlotLeido | undefined)[]>();
    for (const [opacidad, placas] of porOpacidad) {
      const malla = new THREE.InstancedMesh(
        geoPlaca,
        new THREE.MeshStandardMaterial({ roughness: 0.5, transparent: true, opacity: opacidad }),
        placas.length,
      );
      malla.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const lecturas: (SlotLeido | undefined)[] = [];
      placas.forEach((pl, k) => {
        malla.setMatrixAt(k, pl.matriz);
        malla.setColorAt(k, color.set(pl.color));
        lecturas[k] = pl.leido;
      });
      //  Con el acomodo encendido, oculta como el resto del catálogo.
      malla.visible = !contextoRef.current;
      scene.add(malla);
      mallasHuecos.push(malla);
      lecturaPorMalla.set(malla, lecturas);
    }
    mallasHuecosRef.current = mallasHuecos;
    lecturaPorMallaRef.current = lecturaPorMalla;

    setPlacas(huecos.size);
    setPintados(pintadosPorHueco.size);
    setSinPlaca(wmsSinPlaca);
    //  La leyenda: en modo WMS sale del vocabulario; en los otros dos, de lo pintado.
    if (modo === 'wms') {
      setLeyenda(leyendaDeOcupacion(ocupacion?.situaciones ?? [], cuentas));
    } else {
      const propias: { etiqueta: string; color: string; cuenta: number }[] = [];
      for (const [k, cuenta] of cuentas) {
        if (!k.startsWith('__') || k === '__conflicto__') continue;
        const etiqueta = k.slice(2, -2);
        const muestra = [...porOpacidad.values()].flat().find((pl) => pl.etiqueta === etiqueta);
        if (muestra) propias.push({ etiqueta, color: muestra.color, cuenta });
      }
      setLeyenda(propias);
    }

    return () => {
      for (const malla of mallasHuecos) {
        scene.remove(malla);
        malla.dispose();
        (malla.material as THREE.Material).dispose();
      }
      geoPlaca.dispose();
      if (mallasHuecosRef.current === mallasHuecos) {
        mallasHuecosRef.current = [];
        lecturaPorMallaRef.current = new Map();
      }
    };
  }, [escena, slots, ocupacion, modo]);

  // ── LAS FIGURAS (0093): personas, drones, montacargas ──────────────────────────
  useEffect(() => {
    const t = tres.current;
    if (!t) return;
    const { scene } = t;
    figurasRef.current = figuras;

    //  Los contadores se REINICIAN aquí: sin esto siguen sumando entre montajes —y en
    //  desarrollo React monta dos veces— y el pie decía «2 de 1 figura(s)».
    setColocadas(0);
    setFallidas(0);

    /*
      Se cargan de forma ASÍNCRONA y una a una: con `Promise.all` una figura lenta dejaría el
      plano sin ninguna. `cancelado` impide añadir un modelo que llega tarde a una escena ya
      liberada o a un conjunto de figuras que ya cambió.
    */
    let cancelado = false;
    const cargados: THREE.Object3D[] = [];
    cargadosRef.current = cargados;

    /*
      ── LAS MARCAS: SIN ELLAS UNA FIGURA NO SE ENCUENTRA ──────────────────────

      Una persona de 1,75 m en una nave de 290 m ocupa cinco píxeles. La marca es un punto de
      tamaño en PANTALLA más una línea vertical que dice a qué altura está.
    */
    const marcaGeo = new THREE.BufferGeometry();
    const marcaMat = new THREE.PointsMaterial({
      color: 0xffc14d,
      size: 11,
      sizeAttenuation: false,
      //  Por delante de todo: una marca tapada por un rack no serviría para encontrar nada.
      depthTest: false,
      transparent: true,
    });
    const marcas = new THREE.Points(marcaGeo, marcaMat);
    marcas.renderOrder = 999;
    const astaGeo = new THREE.BufferGeometry();
    const astaMat = new THREE.LineBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 0.55 });
    const astas = new THREE.LineSegments(astaGeo, astaMat);
    if (figuras.length > 0) {
      const puntos: number[] = [];
      const lineas: number[] = [];
      for (const f of figuras) {
        const alto = Math.max(3, f.zM);
        puntos.push(f.xM, f.zM + alto * 0.15, f.yM);
        lineas.push(f.xM, 0, f.yM, f.xM, f.zM + alto * 0.15, f.yM);
      }
      marcaGeo.setAttribute('position', new THREE.Float32BufferAttribute(puntos, 3));
      astaGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineas, 3));
      scene.add(marcas);
      scene.add(astas);

      void (async () => {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (cancelado) return;
        const loader = new GLTFLoader();
        for (const f of figuras) {
          if (cancelado) return;
          if (!f.glbUrl) continue;
          try {
            const gltf = await loader.loadAsync(f.glbUrl);
            if (cancelado) return;
            const obj = gltf.scene;
            //  La escala del MODELO por la de la aparición.
            const s = (f.modelScale || 1) * (f.scale || 1);
            obj.scale.setScalar(s);
            //  Apoyarla en el suelo: la caja se mide YA ESCALADA y con la posición en el origen.
            const caja = new THREE.Box3().setFromObject(obj);
            const apoyo = apoyarEnElSuelo(caja.min.y, f.zM);
            //  Mismos ejes que los racks, y el giro negativo (el dominio mide horario).
            obj.position.set(f.xM, apoyo, f.yM);
            obj.rotation.y = (-f.rotationDeg * Math.PI) / 180;
            obj.name = `figura:${f.id}`;
            //  Para el picking: de un hijo cualquiera hay que poder llegar a la figura.
            obj.traverse((h) => {
              h.userData.figuraId = f.id;
            });
            scene.add(obj);
            cargados.push(obj);
            setColocadas((n) => n + 1);
          } catch {
            //  Una figura que no se puede descargar no puede tumbar el plano.
            setFallidas((n) => n + 1);
          }
        }
      })();
    }

    return () => {
      cancelado = true;
      scene.remove(marcas);
      scene.remove(astas);
      marcaGeo.dispose();
      marcaMat.dispose();
      astaGeo.dispose();
      astaMat.dispose();
      //  Las figuras, hoja por hoja: cada una tiene memoria de vídeo que no se libera sola.
      for (const obj of cargados) {
        obj.traverse((h) => {
          const malla = h as THREE.Mesh;
          malla.geometry?.dispose?.();
          const mat = malla.material;
          for (const m2 of Array.isArray(mat) ? mat : [mat]) m2?.dispose?.();
        });
        scene.remove(obj);
      }
      if (cargadosRef.current === cargados) cargadosRef.current = [];
    };
  }, [figuras]);

  // ── LA FIGURA QUE ANDA EL RECORRIDO ────────────────────────────────────────────
  //  Aparte de las colocadas: no es decorado, aparece solo mientras se reproduce.
  const glbRecorrido = figuraDelRecorrido?.glbUrl;
  const escalaRecorrido = figuraDelRecorrido?.escala;
  useEffect(() => {
    const t = tres.current;
    if (!t || !glbRecorrido) return;
    const { scene } = t;
    let cancelado = false;
    let propio: THREE.Object3D | null = null;
    void (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      if (cancelado) return;
      try {
        const gltf = await new GLTFLoader().loadAsync(glbRecorrido);
        if (cancelado) return;
        const obj = gltf.scene;
        obj.scale.setScalar(escalaRecorrido || 1);
        const apoyo = apoyarEnElSuelo(new THREE.Box3().setFromObject(obj).min.y, 0);
        //  Invisible hasta que haya posición.
        obj.visible = false;
        scene.add(obj);
        propio = obj;
        andanteRef.current = { obj, apoyo };
      } catch {
        //  Si su modelo no se puede descargar, queda el marcador.
        andanteRef.current = null;
      }
    })();
    return () => {
      cancelado = true;
      if (propio) {
        propio.traverse((h) => {
          const malla = h as THREE.Mesh;
          malla.geometry?.dispose?.();
          const mat = malla.material;
          for (const m2 of Array.isArray(mat) ? mat : [mat]) m2?.dispose?.();
        });
        scene.remove(propio);
        if (andanteRef.current?.obj === propio) andanteRef.current = null;
      }
    };
  }, [glbRecorrido, escalaRecorrido]);


  /*
    ── LOS BOTONES DE ENCUADRE ───────────────────────────────────────────────────

    Acercar, alejar, ajustar y volver al ángulo. En 3D+ estaban MUERTOS: actuaban sobre el
    lienzo 2D y sobre la cámara del axonométrico, y con esta vista delante no hacían nada.

    Va en su PROPIO efecto y no en el de la escena. Si estuviera allí, cada pulsación de
    «acercar» reconstruiría los racks, las placas y volvería a descargar las figuras — para
    mover una cámara—.

    Se opera sobre la cámara viva a través de la referencia que el bucle mantiene al día, y
    los cambios se escriben ahí mismo para que sobrevivan al siguiente repintado.
  */
  /*
    ── EL MARCADOR DEL RECORRIDO ─────────────────────────────────────────────────

    Una esfera que va por donde va el recorrido. En su PROPIO efecto y sobre un objeto que ya
    existe: mover un marcador cada fotograma no puede reconstruir 58.620 placas.

    Se crea al vuelo la primera vez que hace falta y se esconde cuando no hay reproduccion,
    en vez de crearla y destruirla: crear geometria sesenta veces por segundo es como se
    consigue que una animacion vaya a tirones.
  */
  useEffect(() => {
    const poner = marcadorRecorrido.current;
    if (poner) poner(posicionRecorrido ?? null, rumboRecorrido ?? null);
  }, [posicionRecorrido, rumboRecorrido]);

  useEffect(() => {
    if (!orden) return;
    const mando = mandoDeCamara.current;
    if (!mando) return;
    mando(orden.tipo);
    //  Solo `orden.n`: es el contador el que dice «hay una orden nueva». Con el objeto
    //  entero en las dependencias, dos órdenes iguales seguidas no se distinguirían.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orden?.n]);

  //  Etiquetas de rack/columna sobre el CEDI ya montado: no reconstruye la escena, solo cambia
  //  la visibilidad del grupo de rotulos.
  useEffect(() => {
    etiquetasRef.current = etiquetas;
    cediRef.current?.setLabelsVisible(etiquetas);
  }, [etiquetas]);

  return (
    <div className={cn('relative overflow-hidden rounded-[var(--radius-sm)]', className)}>
      <div ref={contenedor} className="size-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <span className="t-mono-xs text-[var(--text-warn)]">{error}</span>
        </div>
      )}
      {!error && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-0.5">
          <span className="t-mono-xs text-[var(--text-faint)]">
            {escena.length} rack(s) · {placas} hueco(s) con lectura
            {figuras.length > 0 && ` · ${colocadas} de ${figuras.length} figura(s)`}
          </span>

          {/*  Un solo interruptor: el acomodo del Excel (solo racks) o el catalogo del WMS. */}
          <span className="pointer-events-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setContexto((v) => !v)}
              aria-pressed={contexto}
              title="Mostrar los racks acomodados del Mapa mezzanine N2 (oculta el catalogo del WMS)"
              className={cn(
                't-mono-xs rounded-[var(--radius-xs)] border px-1.5 py-0.5 transition-colors',
                contexto
                  ? 'border-[var(--accent)] text-[var(--text-accent)] [background:var(--glass-2)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-faint)] hover:[background:var(--glass-1)]',
              )}
            >
              acomodo
            </button>
            {contexto && (
              <button
                type="button"
                onClick={() => setEtiquetas((v) => !v)}
                aria-pressed={etiquetas}
                title="Rotular cada rack (RCL…) y columna (C0xx), como en 2D/3D/3D+"
                className={cn(
                  't-mono-xs rounded-[var(--radius-xs)] border px-1.5 py-0.5 transition-colors',
                  etiquetas
                    ? 'border-[var(--accent)] text-[var(--text-accent)] [background:var(--glass-2)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-faint)] hover:[background:var(--glass-1)]',
                )}
              >
                etiquetas
              </button>
            )}
          </span>
          {/*  CUANTAS piezas de estanteria hay montadas, y cuando no hay ninguna, por que.
               Un almacen que de pronto se ve como bloques macizos no es un fallo de dibujo:
               o esos racks no estan en el catalogo, o la escena se paso del tope. Callarlo
               dejaria a quien mira buscando un problema donde no lo hay. */}
          {/*
            ── EL CONMUTADOR DE LOS TRES MODOS ─────────────────────────────────────

            Va aqui, junto a la leyenda y la fecha, porque es lo que explica lo que se esta
            viendo: el modo, de cuando es el dato y que significa cada color, todo junto. En
            el panel de capas quedaria lejos de su consecuencia.

            `pointer-events-auto` porque el pie entero los tiene desactivados —es un rotulo
            sobre el lienzo y no debe robar el raton al girar la camara— y este es el unico
            trozo que si se pulsa.
          */}
          {ocupacion && (
            <span className="pointer-events-auto flex items-center gap-1">
              {MODOS_DE_OCUPACION.map((m) => (
                <button
                  key={m.modo}
                  type="button"
                  onClick={() => setModo(m.modo)}
                  aria-pressed={modo === m.modo}
                  title={m.ayuda}
                  className={cn(
                    't-mono-xs rounded-[var(--radius-xs)] border px-1.5 py-0.5 transition-colors',
                    modo === m.modo
                      ? 'border-[var(--accent)] text-[var(--text-accent)] [background:var(--glass-2)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-faint)] hover:[background:var(--glass-1)]',
                  )}
                >
                  {m.etiqueta}
                </button>
              ))}
            </span>
          )}

          {/*
            ── LA FECHA DEL DATO, AL LADO DEL COLOR ────────────────────────────────

            Un plano pintado de colores se lee como el estado de AHORA MISMO. Y no lo es: es
            lo que el WMS declaro en la importacion, que hoy tiene veinte dias. Sin la fecha
            aqui, el color miente con mucha seguridad — y esta pantalla es de las que se
            miran para decidir—.

            Los CONFLICTOS tambien se dicen: son huecos donde el WMS se contradice consigo
            mismo, asi que no son un estado del almacen sino un dato con el que no se puede
            decidir. Callarlos los dejaria pintados de morado sin explicacion.
          */}
          {ocupacion && (
            <span className="t-mono-xs text-[var(--text-faint)]">
              {pintados.toLocaleString('es')} de {ocupacion.celdas.toLocaleString('es')} hueco(s)
              {modo === 'dron' && ' vistos por el dron'}
              {modo === 'comparar' && ' comparables'}
              {' · WMS del '}
              {ocupacion.importadoEl
                ? new Date(ocupacion.importadoEl).toLocaleDateString('es', {
                    day: 'numeric',
                    month: 'short',
                  })
                : 'sin fecha'}
              {ocupacion.conflictos > 0 &&
                ` · ${ocupacion.conflictos} se contradicen en el dato`}
              {ocupacion.sinCelda > 0 && ` · ${ocupacion.sinCelda} sin celda`}
              {sinPlaca > 0 && ` · ${sinPlaca} sin sitio en la rejilla`}
            </span>
          )}

          {/*  La leyenda, de lo que hay EN PANTALLA. El hueco vacio no aparece: no se pinta,
               asi que no hay color que explicar. */}
          {leyenda.length > 0 && (
            <span className="t-mono-xs flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--text-faint)]">
              {leyenda.map((l) => (
                <span key={l.etiqueta} className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="size-2 rounded-[1px]"
                    style={{ background: l.color }}
                  />
                  {l.etiqueta} {l.cuenta.toLocaleString('es')}
                </span>
              ))}
            </span>
          )}

          <span className="t-mono-xs text-[var(--text-faint)]">
            {piezas > 0
              ? `${piezas.toLocaleString('es')} pieza(s) de estanteria`
              : escena.some((r) => r.cuerpos > 0)
                ? 'sin estanteria: la escena se pasa del tope de piezas'
                : 'sin estanteria: estos racks no estan en el catalogo'}
          </span>
          {/*  Las que no se pudieron descargar se DICEN. Callarlas dejaría un plano con
               menos figuras de las que hay y nadie sabría que falta algo. */}
          {fallidas > 0 && (
            <span className="t-mono-xs text-[var(--text-warn)]">
              {fallidas} figura(s) no se pudieron cargar. Puede que su archivo ya no esté.
            </span>
          )}
          {/*  Mientras se arrastra, DONDE está: es la única forma de colocar algo en un
               sitio concreto sin adivinar, y de ver que el gesto está haciendo lo que se
               espera —solo el suelo, o solo la altura—. */}
          {arrastrando && donde ? (
            <span className="t-mono-xs text-[var(--text-primary)]">
              x {donde.xM.toFixed(2)} · y {donde.yM.toFixed(2)} · altura{' '}
              {donde.zM.toFixed(2)} m
            </span>
          ) : (
            <span className="t-mono-xs text-[var(--text-faint)]">
              {/*  Se dice CÓMO desplazarse, porque no es obvio y fue lo primero que se echó
                   en falta: «no puedo moverme, solo gira en su eje». */}
              {modoPan
                ? 'arrastrar desplaza'
                : 'arrastrar gira · espacio, Mayús o botón central desplaza'}
              {' · rueda acerca · clic señala'}
              {onMoverFigura && figuras.length > 0 && (
                <> · arrastrar una figura la mueve · Mayús sobre ella la sube</>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
