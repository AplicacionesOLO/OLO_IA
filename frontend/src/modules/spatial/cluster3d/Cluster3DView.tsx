/**
 * VISOR DEL CLUSTER — el almacen colocado, en tres dimensiones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE RESUELVE
 *
 * Antes solo se podia ver UN rack por dentro (`Rack3DView`) y el resto del almacen
 * era una lista. Aqui se ve lo que se acaba de colocar en el editor como lo que es:
 * hileras, pasillos y familias, con el plano de verdad debajo.
 *
 * Y es lo que hace util F2: la posicion en metros no se guardo para guardarla, se
 * guardo para poder mirarla. La escena se compone de dos fuentes que ninguna basta
 * sola —`escena.ts` lo explica— y esta ES la union.
 *
 * ── EL PLANO ES EL SUELO, NO UN FONDO ───────────────────────────────────────
 *
 * La imagen del plano se dibuja TUMBADA en z = 0, con la matriz afin de
 * `matrizDelSuelo`. No es un truco: la proyeccion axonometrica de un plano es afin,
 * asi que la transformacion es exacta y el navegador la interpola. La consecuencia
 * practica es que un rack colocado sobre una hilera del plano sigue encima de esa
 * hilera al girar la camara, y si se sale se ve que se sale.
 *
 * ── SIN CALIBRAR NO SE DIBUJA NADA ──────────────────────────────────────────
 *
 * Con la escala por defecto de 50 px/m un rack de 12 m mediria 12 unidades
 * inventadas y el almacen entero saldria con proporciones falsas. Se dice, con el
 * boton de calibrar al lado, en lugar de dibujar algo plausible.
 *
 * ── LO QUE NO DIBUJA ────────────────────────────────────────────────────────
 *
 * Ni ubicacion a ubicacion —29.310 huecos en una nave de 900 px de ancho caerian en
 * menos de un pixel cada uno— ni ocupacion, ni pallets: esos datos no existen. Cada
 * rack es un cuerpo con sus bandas de nivel y divisiones de cuerpo, que es la
 * informacion que a esta escala se distingue. Para ver un rack por dentro se abre
 * `Rack3DView`, y de eso avisa la seleccion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Layers, Lock, Maximize, Minus, Plus, RotateCcw, Ruler } from 'lucide-react';

import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import { agruparPorProximidad } from '../editor/repetir';
import {
  colorDeOcupacion,
  COLOR_SIN_OCUPACION,
  ESCALA_OCUPACION,
} from './escena';
import { dibujarRuta, racksVistos, type RutaPreparada } from './ruta';
import type { PositionedRack } from '../editor/types';
import type { FloorPlanCell } from '../types/index';
import { resolveColor } from '../rack3d/materials';
import {
  alturaEn,
  baseDe,
  CAMARA_INICIAL,
  carasDe,
  centroDe,
  componerEscena,
  encuadrar,
  bandasDeNivel,
  divisionesDeCuerpo,
  esquinasDelSuelo,
  familiaDe,
  LADO_TIRADOR_3D,
  matrizDelSuelo,
  MINIMO_M,
  orbitar,
  redimensionarEnSuelo,
  sueloEn,
  proyectar,
  rackEn,
  tiradorEn,
  tiradoresDe,
  zoomEn,
  type Base,
  type Camara,
  type CriterioColor,
  type Punto,
  type RackEnEscena,
  type TiradorTamano,
} from './escena';

/**
 * Paleta de grupos. Ocho, los mismos tonos del sistema que ya usa el editor para
 * los racks: si una familia es ambar en el 2D y verde en el 3D, el color deja de
 * ser informacion y pasa a ser decoracion.
 */
const PALETA = [
  '#22d9f5',
  '#8b7cf6',
  '#34d399',
  '#f59e0b',
  '#f87171',
  '#f472b6',
  '#60a5fa',
  '#94a3b8',
] as const;

/**
 * Todo entra por props y NADA sale del store del editor, aunque el editor sea el
 * primer consumidor. El segundo es el explorador, que dibuja el layout PUBLICADO y
 * no el borrador de este navegador: si el visor leyera el store, el explorador
 * mostraria el trabajo a medias de quien tuviera el editor abierto, o nada.
 */
interface Props {
  /** Racks colocados, en pixeles del plano —igual que en el editor—. */
  racks: readonly PositionedRack[];
  /** Escala del plano. */
  ppm: number;
  /** Origen del sistema de coordenadas, en pixeles del plano. */
  origen: { x: number; y: number };
  /** Si `ppm` se midio. Sin medir, las proporciones no son reales y se avisa. */
  calibrado: boolean;
  /** Imagen del plano, para el suelo. `null` dibuja solo los racks. */
  plan: { objectUrl: string; width: number; height: number } | null;
  /** El catalogo completo: de aqui salen cuerpos y niveles de cada rack. */
  catalogo: readonly FloorPlanCell[];
  /** `layoutId` de lo seleccionado. */
  seleccion: readonly string[];
  onSeleccionar?: ((rack: RackEnEscena | null) => void) | undefined;
  /** Doble clic en un rack: abrir su vista de detalle. */
  onAbrirRack?: ((rackCode: string) => void) | undefined;
  /**
   * Rutas ya preparadas. Vacio dibuja solo el almacen.
   *
   * Entran preparadas y no como DTO porque el color de cada fuente tiene que ser el
   * MISMO en el lienzo y en el reproductor: si cada uno lo eligiera, la linea ambar
   * del mapa seria la fila rosa de la leyenda.
   */
  rutas?: readonly RutaPreparada[] | undefined;
  /** Instante de la reproduccion en ms. `null` dibuja el recorrido completo. */
  instante?: number | null | undefined;
  /**
   * Ocupacion por rack, del inventario. Habilita el criterio «por ocupacion».
   *
   * Se indexa por UUID del rack y no por codigo: el codigo es unico por almacen, no
   * globalmente. Sin este mapa, el desplegable no ofrece esa opcion —no se ofrece un
   * criterio que no se puede cumplir—.
   */
  ocupacion?: ReadonlyMap<string, number | null> | undefined;
  /**
   * Si se pueden ARRASTRAR y ESTIRAR racks.
   *
   * ── LO QUE ESTE COMENTARIO DECIA, Y ERA FALSO ────────────────────────────
   *
   * Decia: «cambiar el tamaño con tiradores en axonometria pediria decidir que eje se
   * estira a partir de un arrastre diagonal, que SI es ambiguo». El operador lo
   * reporto —«en 3D no puedo estirar o encoger el rack como en 2D»— y tenia razon:
   * el argumento vale para un tirador de ESQUINA y no para uno de LADO, que tiene un
   * solo grado de libertad. Ver `tiradoresDe`.
   *
   * Es el mismo error de razonamiento que ya se habia corregido para el movimiento y
   * que la cabecera de `sueloEn` deja escrito: confundir «hay una direccion en la que
   * esto seria ambiguo» con «esto es ambiguo».
   *
   * Ahora se puede mover, estirar el ancho, estirar el largo y —solo aqui— estirar el
   * ALTO, que en planta no se ve. Girar sigue en el inspector: para el giro el
   * argumento de la ambigüedad si se sostiene, porque un arrastre circular en
   * axonometria no tiene un eje que lo desambigüe.
   */
  editable?: boolean | undefined;
  /**
   * Ajuste a rejilla y su paso EN METROS. Entran por props como todo lo demas.
   *
   * El paso es el mismo que el del lienzo 2D a proposito: si en 2D se ajusta cada
   * 25 cm y en 3D cada metro, el mismo rack cae en dos sitios distintos segun desde
   * donde se lo mueva, y entonces la rejilla deja de ser una referencia.
   */
  snapToGrid?: boolean | undefined;
  gridMeters?: number | undefined;
  /**
   * Camara CONTROLADA desde fuera. Con ella, el encuadre lo gobierna quien aloja el
   * visor —la paleta del editor— y no un estado escondido aqui dentro.
   *
   * Es el patron controlado/no controlado de siempre: si no se pasa, el visor lleva su
   * propia camara. El explorador la omite porque no tiene paleta; el editor la pasa
   * porque sus botones de acercar, ajustar y centrar viven arriba.
   */
  camara?: Camara | undefined;
  onCamara?: ((c: Camara) => void) | undefined;
  /** Publica el tamaño del lienzo, para que quien encuadre no toque el DOM. */
  onTamano?: ((s: { w: number; h: number }) => void) | undefined;
  /**
   * `true` cuando la herramienta activa es DESPLAZAR: el arrastre primario mueve la
   * escena en lugar de orbitarla.
   *
   * Existe porque desplazar estaba solo en Shift+arrastrar y en el boton central, y
   * eso no se descubre. El operador reporto que «no puedo mover el plano de izquierda a
   * derecha, solo rotarlo»: el gesto estaba, escondido.
   */
  modoPan?: boolean | undefined;
  /** Posiciones nuevas, en PIXELES del plano. Se llama en cada fotograma del arrastre. */
  onMoverRacks?: ((cambios: { layoutId: string; x: number; y: number }[]) => void) | undefined;
  /**
   * Medidas nuevas al estirar un tirador. Se llama en cada fotograma.
   *
   * Lleva `x`/`y` porque estirar MUEVE el centro: el borde opuesto queda anclado,
   * igual que en el lienzo 2D. Sin mover el centro, el rack creceria simetricamente y
   * se saldria del sitio donde lo pusieron.
   *
   * Las medidas van en METROS y la posicion en PIXELES del plano, que es como las
   * guarda el borrador. Mezclar unidades en un mismo callback es incomodo y es lo que
   * hay: `PositionedRack` las tiene asi.
   */
  onRedimensionar?:
    | ((cambio: {
        layoutId: string;
        width?: number;
        length?: number;
        height?: number;
        x?: number;
        y?: number;
      }) => void)
    | undefined;
  /** Al soltar el tirador. Lleva el antes y el despues, para UNA entrada de historial. */
  onRedimensionHecho?:
    | ((cambio: {
        layoutId: string;
        from: { width: number; length: number; height: number; x: number; y: number };
        to: { width: number; length: number; height: number; x: number; y: number };
      }) => void)
    | undefined;
  /** Al soltar. Lleva el antes y el despues, para una sola entrada de historial. */
  onMovimientoHecho?:
    | ((
        movimientos: {
          layoutId: string;
          from: { x: number; y: number };
          to: { x: number; y: number };
        }[],
      ) => void)
    | undefined;
  className?: string | undefined;
}

export function Cluster3DView({
  racks,
  ppm,
  origen,
  calibrado,
  plan,
  catalogo,
  seleccion,
  onSeleccionar,
  onAbrirRack,
  rutas = [],
  instante = null,
  editable = false,
  snapToGrid = false,
  gridMeters = 0.25,
  ocupacion,
  camara,
  onCamara,
  onTamano,
  modoPan = false,
  onMoverRacks,
  onMovimientoHecho,
  onRedimensionar,
  onRedimensionHecho,
  className,
}: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  // Estado interno SOLO para el modo no controlado. Cuando llega `camara` por props,
  // este valor no se lee: la fuente de verdad esta fuera.
  const [camInterna, setCamInterna] = useState<Camara>(CAMARA_INICIAL);
  const cam = camara ?? camInterna;
  /**
   * La camara actual, en un `ref`, para que `setCam` sea ESTABLE.
   *
   * Sin el ref, `setCam` depende de `cam` y se recrea en cada movimiento de camara —o
   * sea, en cada fotograma de un arrastre—, arrastrando consigo a todo lo que lo tenga
   * en sus dependencias. Es el mismo defecto que me costo dos intentos en el
   * reproductor de rutas: lo que cambia por fotograma va en un ref, no en el array.
   */
  const camRef = useRef(cam);
  camRef.current = cam;
  const setCam = useCallback(
    (siguiente: Camara | ((c: Camara) => Camara)) => {
      const valor = typeof siguiente === 'function' ? siguiente(camRef.current) : siguiente;
      if (onCamara) onCamara(valor);
      else setCamInterna(valor);
    },
    [onCamara],
  );
  const [criterio, setCriterio] = useState<CriterioColor>('familia');
  const [conSuelo, setConSuelo] = useState(true);
  const [conEtiquetas, setConEtiquetas] = useState(true);
  const [conRutas, setConRutas] = useState(true);
  const [encima, setEncima] = useState<string | null>(null);
  /** Codigo del rack bloqueado que se ha intentado mover. Se limpia solo. */
  const [avisoBloqueado, setAvisoBloqueado] = useState<string | null>(null);
  /** ESPACIO mantenido: desplaza la escena, igual que en el lienzo 2D. */
  const [espacio, setEspacio] = useState(false);

  /**
   * Racks ya vistos en el instante de la reproduccion.
   *
   * Se realzan en la escena, y eso es la mitad del valor de F4: no solo «por donde
   * fue» sino «que ha quedado sin mirar». Un almacen con la mitad de los racks
   * apagados es una respuesta que ninguna tabla da igual de rapido.
   */
  const vistos = useMemo(
    () => (conRutas ? racksVistos(rutas, instante) : new Set<string>()),
    [conRutas, rutas, instante],
  );

  // ── Agrupacion ────────────────────────────────────────────────────────────
  //
  // Los dos criterios que pidio el operador: por NOMENCLATURA —el prefijo, que es
  // como esta organizado el almacen en el WMS— y por UBICACION, que agrupa lo que
  // esta fisicamente junto aunque se llame distinto. El segundo es el que descubre
  // que dos familias comparten pasillo.
  const grupos = useMemo(() => {
    const m = new Map<string, string>();
    if (criterio === 'cluster') {
      agruparPorProximidad(racks, ppm).forEach((grupo, i) => {
        for (const r of grupo) m.set(r.layoutId, `C${String(i + 1).padStart(2, '0')}`);
      });
    } else if (criterio === 'familia') {
      for (const r of racks) m.set(r.layoutId, familiaDe(r.rackCode));
    }
    return m;
  }, [racks, ppm, criterio]);

  const escena = useMemo(
    () => componerEscena(racks, ppm, origen, catalogo, grupos),
    [racks, ppm, origen, catalogo, grupos],
  );

  /** Color de cada grupo, estable: el orden alfabetico no depende del render. */
  const colorDeGrupo = useMemo(() => {
    const nombres = [...new Set(escena.map((r) => r.grupo))].sort();
    const m = new Map<string, string>();
    nombres.forEach((n, i) => m.set(n, PALETA[i % PALETA.length]!));
    return m;
  }, [escena]);

  // El suelo entra en el encuadre: sin esto, con el plano cargado y ningun rack
  // todavia colocado la camara se quedaba por defecto y el plano aparecia en una
  // esquina, para desaparecer del lienzo al primer giro.
  const suelo = useMemo(
    () => (conSuelo ? esquinasDelSuelo(ppm, origen, plan) : []),
    [conSuelo, ppm, origen, plan],
  );

  /** El tirador bajo el cursor, para el cursor del raton y para resaltarlo. */
  const [tiradorEncima, setTiradorEncima] = useState<TiradorTamano | null>(null);

  /**
   * Los tiradores que hay AHORA en pantalla.
   *
   * Solo con edicion activa, un unico rack seleccionado, sin candado y con la
   * herramienta de seleccionar. Las razones, una por condicion:
   *
   *   · con varios seleccionados, estirar uno no dice que pasa con los demas —¿la
   *     misma medida?, ¿la misma proporcion?— y el 2D tampoco lo hace.
   *   · un rack bloqueado no se estira, igual que no se mueve: el candado es un tope.
   *   · con la herramienta de DESPLAZAR, el arrastre es de la escena. Dibujar
   *     tiradores que no responden seria peor que no dibujarlos.
   */
  const tiradores = useMemo<TiradorTamano[]>(() => {
    if (!editable || modoPan || seleccion.length !== 1) return [];
    const r = escena.find((x) => x.layoutId === seleccion[0]);
    if (!r || r.bloqueado) return [];
    return tiradoresDe(baseDe(cam), r);
  }, [editable, modoPan, seleccion, escena, cam]);

  const alturaMax = useMemo(
    () => Math.max(1, ...escena.map((r) => r.alto)),
    [escena],
  );

  const colorDe = useCallback(
    (r: RackEnEscena): string => {
      if (criterio === 'ocupacion') {
        // `undefined` —el rack no esta en el mapa— y `null` —esta pero sin dato— dan
        // los dos gris, y es correcto: en ambos casos no se sabe cuanto tiene.
        return colorDeOcupacion(r.rackId ? ocupacion?.get(r.rackId) : null);
      }
      if (criterio === 'rack') return r.color;
      if (criterio === 'altura') {
        // Del cian al ambar segun la altura. Contesta «¿que zonas son altas?» sin
        // tener que abrir un rack.
        const t = Math.min(1, r.alto / alturaMax);
        return t < 0.5 ? PALETA[0]! : t < 0.8 ? PALETA[2]! : PALETA[3]!;
      }
      return colorDeGrupo.get(r.grupo) ?? r.color;
    },
    [criterio, colorDeGrupo, alturaMax, ocupacion],
  );

  /**
   * TECLADO: ESPACIO para desplazar y las FLECHAS para mover la escena.
   *
   * Se escucha en el documento y no en el lienzo porque el lienzo no recibe foco: sin
   * esto habria que hacer clic antes de poder mover, y el gesto es «mantengo espacio y
   * arrastro», no «hago clic, mantengo espacio y arrastro». Es el mismo razonamiento
   * —y el mismo codigo— que el del editor 2D.
   *
   * Las flechas existen porque hay un caso que el raton no cubre: recolocar la vista
   * unos pocos pixeles sin perder de vista lo que se esta mirando.
   */
  useEffect(() => {
    const escribiendo = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
         el.tagName === 'SELECT' || el.isContentEditable)
      );
    };
    const abajo = (e: KeyboardEvent) => {
      if (escribiendo(e.target)) return;
      if (e.code === 'Space') {
        // Sin esto la barra espaciadora desplaza la pagina mientras se arrastra.
        e.preventDefault();
        setEspacio(true);
        return;
      }
      const salto = e.shiftKey ? 120 : 30;
      const paso: Record<string, [number, number]> = {
        ArrowLeft: [salto, 0],
        ArrowRight: [-salto, 0],
        ArrowUp: [0, salto],
        ArrowDown: [0, -salto],
      };
      const d = paso[e.key];
      if (!d) return;
      e.preventDefault();
      setCam((c) => ({ ...c, panX: c.panX + d[0], panY: c.panY + d[1] }));
    };
    const arriba = (e: KeyboardEvent) => {
      if (e.code === 'Space') setEspacio(false);
    };
    // Si la ventana pierde el foco con espacio pulsado, el keyup no llega nunca y el
    // lienzo se queda creyendo que sigue apretado.
    const perderFoco = () => setEspacio(false);
    document.addEventListener('keydown', abajo);
    document.addEventListener('keyup', arriba);
    window.addEventListener('blur', perderFoco);
    return () => {
      document.removeEventListener('keydown', abajo);
      document.removeEventListener('keyup', arriba);
      window.removeEventListener('blur', perderFoco);
    };
  }, [setCam]);

  // El aviso del candado se retira solo: describe un gesto que ya paso, y dejarlo fijo
  // lo convertiria en una alarma que nadie cierra.
  useEffect(() => {
    if (!avisoBloqueado) return;
    const t = window.setTimeout(() => setAvisoBloqueado(null), 4000);
    return () => window.clearTimeout(t);
  }, [avisoBloqueado]);

  // ── Medida del lienzo ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const publicar = () => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      setTam(s);
      onTamano?.(s);
    };
    const ro = new ResizeObserver(publicar);
    ro.observe(el);
    publicar();
    return () => ro.disconnect();
  }, [onTamano]);

  // Encuadre inicial: en cuanto hay racks Y lienzo. Se hace UNA vez por conjunto,
  // no en cada render: recolocar la camara mientras el operador la mueve seria
  // pelearse con el.
  const encuadrado = useRef(false);
  useEffect(() => {
    if (encuadrado.current || tam.w === 0) return;
    if (escena.length === 0 && suelo.length === 0) return;
    setCam((c) => encuadrar(c, escena, tam, 48, suelo));
    encuadrado.current = true;
  }, [escena, tam, suelo, setCam]);

  const ajustar = useCallback(() => {
    setCam((c) => encuadrar(c, escena, tam, 48, suelo));
  }, [escena, tam, suelo, setCam]);

  // ── Pintado ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas || tam.w === 0 || tam.h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(tam.w * dpr);
    canvas.height = Math.round(tam.h * dpr);
    canvas.style.width = `${tam.w}px`;
    canvas.style.height = `${tam.h}px`;

    const b = baseDe(cam);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, tam.w, tam.h);

    if (conSuelo) dibujarSuelo(ctx, b, ppm, origen, plan);
    dibujarRejilla(ctx, b, cam.escala, escena, suelo);

    // Painter's algorithm: de lo lejano a lo cercano. `profundidad` crece hacia el
    // observador, asi que ordenar ascendente y pintar en ese orden hace que lo de
    // delante tape lo de detras sin z-buffer.
    const conCaras = escena
      .map((r) => ({ r, caras: carasDe(b, r) }))
      .sort((p, q) => p.caras.z - q.caras.z);

    for (const { r, caras } of conCaras) {
      const sel = seleccion.includes(r.layoutId);
      dibujarRack(
        ctx, b, r, caras, colorDe(r), sel, encima === r.layoutId, cam.escala,
        // `null` cuando no hay rutas: sin observaciones «no visto» no significa nada
        // y apagar el almacen entero seria decir que nadie ha pasado por ningun sitio
        // cuando lo que pasa es que no hay datos.
        rutas.length > 0 && conRutas ? r.rackId != null && vistos.has(r.rackId) : null,
      );
    }

    // Las rutas van ENCIMA de los racks y debajo de las etiquetas. Debajo de los
    // racks quedarian tapadas por lo que atraviesan —una ruta pasa por el pasillo,
    // entre hileras— y encima de las etiquetas taparian el codigo del rack, que es
    // lo que se esta buscando cuando se sigue una traza.
    if (conRutas) {
      for (const r of rutas) dibujarRuta(ctx, b, r, instante, cam.escala);
    }

    if (conEtiquetas) {
      // Las etiquetas VAN APARTE y al final, en espacio de pantalla: dentro del
      // bucle las tapaba el rack siguiente, que es el defecto que ya se corrigio
      // en el editor 2D. Y en el mismo sitio para todos —encima del centro del
      // techo— porque una etiqueta que salta de sitio segun el giro no se puede
      // seguir con la vista.
      for (const { r, caras } of conCaras) {
        dibujarEtiqueta(ctx, r, caras.techo, cam.escala, seleccion.includes(r.layoutId));
      }
    }

    // Los tiradores, lo ultimo de todo: son la unica cosa que NUNCA debe quedar tapada
    // por un rack, porque son la diana del gesto. En pantalla y no en el mundo, asi
    // que miden lo mismo a cualquier zoom.
    for (const tir of tiradores) dibujarTirador(ctx, tir, tir === tiradorEncima);
  }, [
    tam, cam, escena, seleccion, encima, conSuelo, conEtiquetas,
    plan, ppm, origen, suelo, colorDe, rutas, instante, conRutas, vistos,
    tiradores, tiradorEncima,
  ]);

  // ── Interaccion ───────────────────────────────────────────────────────────
  const centro = useMemo(() => centroDe(escena, suelo), [escena, suelo]);


  const arrastre = useRef<{
    x: number;
    y: number;
    cam: Camara;
    modo: 'orbitar' | 'desplazar';
    /** Si el puntero se movio de verdad. Decide si el `click` cuenta. */
    movido: boolean;
  } | null>(null);

  /**
   * Arrastre de racks sobre el suelo.
   *
   * Guarda el punto del SUELO donde empezo —no el de pantalla— porque la camara puede
   * cambiar de escala a media edicion y un delta en pixeles significaria distinto
   * antes y despues. En metros el delta es el mismo mire quien mire.
   *
   * Y guarda las posiciones INICIALES: el delta se aplica siempre sobre ellas y no
   * acumulando fotograma a fotograma. Acumulando, el error de redondeo del ajuste a
   * rejilla se suma en cada movimiento y el rack acaba desplazado respecto al cursor.
   */
  const moviendo = useRef<{
    suelo: { x: number; y: number };
    inicios: { layoutId: string; x: number; y: number }[];
  } | null>(null);
  /**
   * Estirado de un rack con un tirador.
   *
   * Guarda las medidas y el centro INICIALES y calcula siempre desde ellos, no
   * acumulando fotograma a fotograma: acumulando, el redondeo del ajuste a rejilla se
   * suma en cada movimiento y el borde se despega del cursor. Es la misma razon por la
   * que `moviendo` guarda las posiciones de partida.
   */
  const estirando = useRef<{
    layoutId: string;
    tirador: TiradorTamano;
    desde: { width: number; length: number; height: number; x: number; y: number };
    /** Centro inicial en METROS del mundo, para la matematica del suelo. */
    centroM: { x: number; y: number };
  } | null>(null);

  /**
   * Si el ultimo gesto fue un arrastre.
   *
   * Un arrastre termina con un evento `click` —el navegador lo emite igual—, asi que
   * sin esto orbitar la camara SELECCIONA lo que hubiera bajo el punto donde se
   * suelta, o deselecciona si es hueco. Es decir: girar para mirar mejor el rack que
   * acabas de seleccionar te lo quitaba de la seleccion.
   */
  const fueArrastre = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    const r = lienzo.current?.getBoundingClientRect();
    if (!r) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    fueArrastre.current = false;

    // ── Mover un rack ────────────────────────────────────────────────────
    // Solo con el boton principal, sin Shift, sin Espacio y con la herramienta de
    // seleccionar activa. Cuando la herramienta es DESPLAZAR, el arrastre primario
    // mueve la escena: es una herramienta, y una herramienta manda sobre lo que haya
    // debajo del cursor.
    if (editable && e.button === 0 && !e.shiftKey && !espacio && !modoPan) {
      const b = baseDe(cam);
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;

      // ── Estirar, ANTES que mover ──────────────────────────────────────
      // Los tiradores caen encima del cuerpo del rack, asi que si ganara el rack,
      // apuntar a un tirador lo moveria en lugar de estirarlo. Mismo orden que en 2D.
      const tir = tiradorEn(tiradores, sx, sy);
      if (tir) {
        const enEscena = escena.find((x) => x.layoutId === seleccion[0]);
        const enBorrador = racks.find((x) => x.layoutId === seleccion[0]);
        if (enEscena && enBorrador) {
          estirando.current = {
            layoutId: enBorrador.layoutId,
            tirador: tir,
            desde: {
              width: enBorrador.width,
              length: enBorrador.length,
              height: enBorrador.height,
              x: enBorrador.x,
              y: enBorrador.y,
            },
            centroM: { x: enEscena.x, y: enEscena.y },
          };
          return;
        }
      }

      const bajo = rackEn(b, escena, sx, sy);
      if (bajo) {
        // Tocar un rack que no estaba seleccionado lo selecciona: arrastrar sin
        // seleccionar primero es lo que uno espera de un editor.
        const ids = seleccion.includes(bajo.layoutId) ? [...seleccion] : [bajo.layoutId];
        if (!seleccion.includes(bajo.layoutId)) onSeleccionar?.(bajo);

        const inicios = racks
          .filter((x) => ids.includes(x.layoutId) && !x.locked)
          .map((x) => ({ layoutId: x.layoutId, x: x.x, y: x.y }));
        if (inicios.length > 0) {
          moviendo.current = {
            suelo: sueloEn(b, e.clientX - r.left, e.clientY - r.top),
            inicios,
          };
          return;
        }
        // Todos bloqueados: no se mueve nada y TAMPOCO se orbita, para que el candado
        // se note como un tope y no como un giro inesperado. Y se DICE, porque un tope
        // sin explicacion es indistinguible de un fallo.
        setAvisoBloqueado(bajo.rackCode);
        return;
      }
    }

    arrastre.current = {
      x: e.clientX,
      y: e.clientY,
      movido: false,
      cam,
      // Boton central, Shift, Espacio o la herramienta de desplazar mueven la
      // escena; el resto orbita. Espacio es el mismo gesto que en el editor 2D, y
      // tenerlo aqui evita que el operador aprenda dos formas de mover una vista.
      modo:
        e.button === 1 || e.shiftKey || espacio || modoPan ? 'desplazar' : 'orbitar',
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = lienzo.current?.getBoundingClientRect();
    if (!rect) return;

    // ── Estirando un rack ────────────────────────────────────────────────
    const es = estirando.current;
    if (es) {
      const b = baseDe(cam);
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      fueArrastre.current = true;
      // Alt INVIERTE el ajuste mientras dura el gesto, igual que en 2D: con la
      // rejilla encendida deja una medida libre, y apagada deja clavar una cota
      // redonda.
      const ajustar = snapToGrid !== e.altKey;
      const paso = ajustar && gridMeters > 0 ? gridMeters : null;

      if (es.tirador.medida === 'alto') {
        // El alto no toca el centro: el rack crece hacia arriba desde el suelo.
        const bruto = alturaEn(b, es.centroM, sy);
        const ajustado = paso ? Math.round(bruto / paso) * paso : bruto;
        onRedimensionar?.({
          layoutId: es.layoutId,
          height: Math.max(MINIMO_M, ajustado),
        });
        return;
      }

      const r = redimensionarEnSuelo({
        centro: es.centroM,
        medida0: es.tirador.medida === 'ancho' ? es.desde.width : es.desde.length,
        tirador: es.tirador,
        cursor: sueloEn(b, sx, sy),
        paso,
      });
      // De metros del mundo a pixeles del plano, que es como el borrador guarda x/y.
      const xPx = origen.x + r.centro.x * ppm;
      const yPx = origen.y + r.centro.y * ppm;
      onRedimensionar?.({
        layoutId: es.layoutId,
        ...(es.tirador.medida === 'ancho' ? { width: r.medida } : { length: r.medida }),
        x: xPx,
        y: yPx,
      });
      return;
    }

    // ── Arrastrando racks ────────────────────────────────────────────────
    const m = moviendo.current;
    if (m) {
      const b = baseDe(cam);
      const ahora = sueloEn(b, e.clientX - rect.left, e.clientY - rect.top);
      let dx = (ahora.x - m.suelo.x) * ppm;
      let dy = (ahora.y - m.suelo.y) * ppm;
      if (Math.abs(dx) + Math.abs(dy) > 1) fueArrastre.current = true;

      // Ajuste a rejilla sobre el DELTA, no sobre la posicion: con varios racks
      // seleccionados, ajustar cada posicion los junta todos a la misma casilla y
      // deshace la separacion que tenian. Alt lo desactiva mientras se arrastra,
      // igual que en el lienzo 2D.
      if (snapToGrid && !e.altKey && gridMeters > 0) {
        const paso = gridMeters * ppm;
        dx = Math.round(dx / paso) * paso;
        dy = Math.round(dy / paso) * paso;
      }

      onMoverRacks?.(
        m.inicios.map((i) => ({ layoutId: i.layoutId, x: i.x + dx, y: i.y + dy })),
      );
      return;
    }

    const a = arrastre.current;
    if (!a) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // El tirador se comprueba primero, y si hay uno el rack de debajo no se resalta:
      // resaltar el cuerpo mientras el cursor dice «vas a estirar» son dos mensajes
      // distintos a la vez.
      const tir = tiradorEn(tiradores, sx, sy);
      setTiradorEncima(tir);
      setEncima(tir ? null : (rackEn(baseDe(cam), escena, sx, sy)?.layoutId ?? null));
      return;
    }

    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    // 4 px de tolerancia: un clic con la mano apoyada se mueve uno o dos, y tratarlo
    // como arrastre haria que seleccionar fallara una vez de cada tres.
    if (!a.movido && Math.abs(dx) + Math.abs(dy) > 4) {
      a.movido = true;
      fueArrastre.current = true;
    }
    if (a.modo === 'desplazar') {
      setCam({ ...a.cam, panX: a.cam.panX + dx, panY: a.cam.panY + dy });
    } else {
      // Se orbita alrededor del CENTRO de la escena, no del origen del mundo: con el
      // origen —la esquina del plano— el almacen describe un arco y se sale del
      // lienzo. 0,4°/px: girar de lado a lado son ~450 px, que caben en el lienzo.
      setCam(orbitar(a.cam, centro, dx * 0.4, -dy * 0.3));
    }
  };

  const onPointerUp = () => {
    arrastre.current = null;

    // ── Cierre del estirado ──────────────────────────────────────────────
    // Una entrada por GESTO y no por fotograma: estirar un rack es una decision, y
    // con una entrada por movimiento haria falta deshacer cientos de veces.
    const es = estirando.current;
    estirando.current = null;
    if (es) {
      const rack = racks.find((x) => x.layoutId === es.layoutId);
      if (rack) {
        const to = {
          width: rack.width,
          length: rack.length,
          height: rack.height,
          x: rack.x,
          y: rack.y,
        };
        // Solo si algo cambio de verdad: un clic sobre el tirador sin arrastrar no es
        // una edicion, y grabarla llenaria el historial de pasos que no hacen nada.
        const cambio =
          to.width !== es.desde.width ||
          to.length !== es.desde.length ||
          to.height !== es.desde.height ||
          to.x !== es.desde.x ||
          to.y !== es.desde.y;
        if (cambio) onRedimensionHecho?.({ layoutId: es.layoutId, from: es.desde, to });
      }
      return;
    }

    const m = moviendo.current;
    moviendo.current = null;
    if (!m) return;
    // UNA entrada de historial por gesto, no una por fotograma: arrastrar ocho racks
    // es una decision, y con una entrada por movimiento haria falta pulsar deshacer
    // cientos de veces para volver atras.
    const movimientos = m.inicios
      .map((i) => {
        const rack = racks.find((x) => x.layoutId === i.layoutId);
        if (!rack || (rack.x === i.x && rack.y === i.y)) return null;
        return { layoutId: i.layoutId, from: { x: i.x, y: i.y }, to: { x: rack.x, y: rack.y } };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (movimientos.length > 0) onMovimientoHecho?.(movimientos);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = lienzo.current?.getBoundingClientRect();
    if (!rect) return;
    setCam((c) =>
      zoomEn(c, e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? -1 : 1),
    );
  };

  const onClick = (e: React.MouseEvent) => {
    // El `click` que cierra un arrastre no selecciona nada: mover la camara no es
    // señalar un rack.
    if (fueArrastre.current) {
      fueArrastre.current = false;
      return;
    }
    const rect = lienzo.current?.getBoundingClientRect();
    if (!rect) return;
    const r = rackEn(baseDe(cam), escena, e.clientX - rect.left, e.clientY - rect.top);
    // La seleccion sale hacia fuera para que sea LA MISMA que la de la pantalla que
    // aloja el visor: tener dos selecciones distintas del mismo rack es como se
    // acaba editando uno y mirando otro.
    onSeleccionar?.(r);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = lienzo.current?.getBoundingClientRect();
    if (!rect || !onAbrirRack) return;
    const r = rackEn(baseDe(cam), escena, e.clientX - rect.left, e.clientY - rect.top);
    if (r) onAbrirRack(r.rackCode);
  };

  const rackEncima = escena.find((r) => r.layoutId === encima) ?? null;

  return (
    <div ref={contenedor} className={cn('relative overflow-hidden rounded-[var(--radius-sm)] [background:var(--glass-1)]', className)}>
      <canvas
        ref={lienzo}
        className={cn(
          'block touch-none',
          // El gesto de desplazar manda sobre lo que haya debajo: si la herramienta es
          // mover, el cursor lo dice aunque el puntero este sobre un rack.
          espacio || modoPan
            ? 'cursor-grab'
            : // Un tirador manda sobre el rack: esta encima de el y es lo que se va a
              // agarrar. El cursor dice QUE medida se estira —el del alto es vertical
              // y los del suelo diagonales— porque en axonometria «horizontal» no
              // corresponde a ningun eje del mundo.
              tiradorEncima
              ? tiradorEncima.medida === 'alto'
                ? 'cursor-ns-resize'
                : 'cursor-nwse-resize'
              : encima
              ? editable
                ? escena.find((r) => r.layoutId === encima)?.bloqueado
                  ? 'cursor-not-allowed'
                  : 'cursor-move'
                : 'cursor-pointer'
              : 'cursor-grab',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          onPointerUp();
          setEncima(null);
        }}
        onWheel={onWheel}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />

      {/* ── Sin nada que dibujar ─────────────────────────────────────────── */}
      {escena.length === 0 && (
        <Aviso
          icono={Boxes}
          titulo="Todavia no hay racks colocados"
          texto="Coloca racks sobre el plano en la vista 2D y apareceran aqui como cluster."
        />
      )}

      {escena.length > 0 && !calibrado && (
        <Aviso
          icono={Ruler}
          titulo="El plano no esta calibrado"
          texto={
            `Las medidas se estan interpretando con la escala por defecto de ${ppm} px/m, ` +
            'que nadie ha medido: las proporciones del almacen no son reales. Calibra en ' +
            'la vista 2D con una distancia conocida.'
          }
          tenue
        />
      )}

      {/* ── Controles ────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-[var(--radius-xs)] px-1.5 py-1 [background:var(--glass-2)]">
            <Layers strokeWidth={1.5} className="size-3 text-[var(--icon-muted)]" />
            <select
              value={criterio}
              onChange={(e) => setCriterio(e.target.value as CriterioColor)}
              aria-label="Criterio de agrupacion por color"
              title="Como se agrupan los racks por color"
              className="t-mono-xs cursor-pointer border-none bg-transparent text-[var(--text-muted)] outline-none"
            >
              {ocupacion && ocupacion.size > 0 && (
                <option value="ocupacion">por ocupacion</option>
              )}
              <option value="familia">por nomenclatura</option>
              <option value="cluster">por ubicacion</option>
              <option value="altura">por altura</option>
              <option value="rack">color del rack</option>
            </select>
          </div>
          <Interruptor activo={conSuelo} onClick={() => setConSuelo(!conSuelo)}>
            plano base
          </Interruptor>
          <Interruptor activo={conEtiquetas} onClick={() => setConEtiquetas(!conEtiquetas)}>
            codigos
          </Interruptor>
          {rutas.length > 0 && (
            <Interruptor activo={conRutas} onClick={() => setConRutas(!conRutas)}>
              rutas
            </Interruptor>
          )}
        </div>

        <div className="pointer-events-auto flex items-end justify-between gap-2">
          {/* Leyenda de grupos. Solo con criterio de grupo: con «color del rack»
              no hay grupos que nombrar. */}
          {criterio === 'ocupacion' ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[var(--radius-xs)] px-2 py-1.5 [background:var(--glass-2)]">
              <span className="t-mono-xs text-[var(--text-faint)]">ocupacion</span>
              {ESCALA_OCUPACION.map((tr) => (
                <span key={tr.etiqueta} className="t-mono-xs flex items-center gap-1 text-[var(--text-muted)]">
                  <span aria-hidden className="size-2 rounded-[1px]" style={{ background: tr.color }} />
                  {tr.etiqueta}
                </span>
              ))}
              <span className="t-mono-xs flex items-center gap-1 text-[var(--text-faint)]">
                <span aria-hidden className="size-2 rounded-[1px]" style={{ background: COLOR_SIN_OCUPACION }} />
                sin dato
              </span>
            </div>
          ) : (criterio === 'familia' || criterio === 'cluster') && colorDeGrupo.size > 0 ? (
            <div className="flex max-w-[60%] flex-wrap gap-x-3 gap-y-1 rounded-[var(--radius-xs)] px-2 py-1.5 [background:var(--glass-2)]">
              {[...colorDeGrupo.entries()].slice(0, 14).map(([nombre, color]) => (
                <span key={nombre} className="t-mono-xs flex items-center gap-1 text-[var(--text-muted)]">
                  <span aria-hidden className="size-2 rounded-[1px]" style={{ background: color }} />
                  {nombre}
                  <span className="text-[var(--text-faint)]">
                    {escena.filter((r) => r.grupo === nombre).length}
                  </span>
                </span>
              ))}
              {colorDeGrupo.size > 14 && (
                <span className="t-mono-xs text-[var(--text-faint)]">
                  +{colorDeGrupo.size - 14} mas
                </span>
              )}
            </div>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1">
            <Boton icono={Plus} onClick={() => setCam((c) => zoomEn(c, tam.w / 2, tam.h / 2, 1))} etiqueta="Acercar" />
            <Boton icono={Minus} onClick={() => setCam((c) => zoomEn(c, tam.w / 2, tam.h / 2, -1))} etiqueta="Alejar" />
            <Boton icono={Maximize} onClick={ajustar} etiqueta="Ajustar a la pantalla" />
            <Boton
              icono={RotateCcw}
              onClick={() =>
                setCam((c) =>
                  orbitar(
                    c,
                    centro,
                    CAMARA_INICIAL.azimut - c.azimut,
                    CAMARA_INICIAL.elevacion - c.elevacion,
                  ),
                )
              }
              etiqueta="Volver al angulo inicial"
            />
          </div>
        </div>
      </div>

      {/* ── Lo que hay bajo el cursor ────────────────────────────────────── */}
      {rackEncima && (
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-0.5 rounded-[var(--radius-xs)] px-2 py-1.5 [background:var(--glass-3)]">
          <span className="t-mono-xs text-[var(--text-primary)]">{rackEncima.rackCode}</span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {rackEncima.largo.toFixed(2)} × {rackEncima.ancho.toFixed(2)} × {rackEncima.alto.toFixed(2)} m
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {rackEncima.cuerpos > 0
              ? `${rackEncima.cuerpos} cuerpos · ${rackEncima.niveles} niveles · ${rackEncima.ubicaciones} ubicaciones`
              : 'el catalogo no conoce este codigo'}
          </span>
          {criterio === 'ocupacion' && rackEncima.rackId && (
            <span className="t-mono-xs text-[var(--text-muted)]">
              {ocupacion?.get(rackEncima.rackId) != null
                ? `${ocupacion.get(rackEncima.rackId)}% ocupado`
                : 'sin dato de inventario'}
            </span>
          )}
          {rackEncima.rotacion !== 0 && (
            <span className="t-mono-xs text-[var(--text-faint)]">
              girado {rackEncima.rotacion.toFixed(1)}°
            </span>
          )}
        </div>
      )}

      {avisoBloqueado && (
        <div className="pointer-events-none absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--state-alert)]/40 px-2.5 py-1.5 [background:var(--glass-3)]">
          <Lock strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--text-warn)]" />
          <span className="t-mono-xs text-[var(--text-muted)]">
            <strong className="text-[var(--text-primary)]">{avisoBloqueado}</strong> esta
            bloqueado · desbloquealo en el inspector para moverlo
          </span>
        </div>
      )}

      {/* ── Escala grafica ───────────────────────────────────────────────── */}
      {escena.length > 0 && <Escala escala={cam.escala} />}
    </div>
  );
}

// ══ Pintado ═════════════════════════════════════════════════════════════════

/**
 * El plano, tumbado en el suelo.
 *
 * Una sola llamada a `drawImage` bajo la matriz afin del suelo. La alternativa
 * —trocear el bitmap en cuadros y transformar cada uno— solo hace falta con
 * perspectiva; aqui la transformacion es exacta.
 */
function dibujarSuelo(
  ctx: CanvasRenderingContext2D,
  b: Base,
  ppm: number,
  origen: { x: number; y: number },
  plan: { objectUrl: string; width: number; height: number } | null,
): void {
  if (!plan) return;
  const img = imagen(plan.objectUrl);
  if (!img?.complete || img.naturalWidth === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const [a, bb, c, d, e, f] = matrizDelSuelo(b, ppm, origen);
  ctx.save();
  // Atenuado: es la referencia, no el protagonista. Con el plano a plena opacidad
  // los racks —que son el dato nuevo— se pierden sobre sus lineas.
  ctx.globalAlpha = 0.34;
  ctx.setTransform(dpr * a, dpr * bb, dpr * c, dpr * d, dpr * e, dpr * f);
  try {
    ctx.drawImage(img, 0, 0, plan.width, plan.height);
  } catch {
    // Imagen en un estado no dibujable (SVG sin dimensiones intrinsecas en algunos
    // navegadores). Se omite el suelo; los racks se dibujan igual.
  }
  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Cache de imagenes por URL: crear un `Image` por fotograma recargaria el plano. */
const cacheImg = new Map<string, HTMLImageElement>();

function imagen(url: string): HTMLImageElement | null {
  const hit = cacheImg.get(url);
  if (hit) return hit;
  const img = new Image();
  img.src = url;
  cacheImg.set(url, img);
  return img;
}

/**
 * Rejilla metrica del suelo.
 *
 * El paso se elige por la escala para que las lineas queden entre 24 y 240 px: una
 * rejilla de 1 m a escala de almacen es una mancha gris, y una de 20 m a escala de
 * rack no da ninguna referencia.
 */
function dibujarRejilla(
  ctx: CanvasRenderingContext2D,
  b: Base,
  escala: number,
  escena: readonly RackEnEscena[],
  suelo: readonly { x: number; y: number }[],
): void {
  const pasos = [0.5, 1, 2, 5, 10, 20, 50];
  const paso = pasos.find((p) => p * escala >= 24) ?? 50;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of escena) {
    const rad = Math.max(r.largo, r.ancho);
    minX = Math.min(minX, r.x - rad);
    maxX = Math.max(maxX, r.x + rad);
    minY = Math.min(minY, r.y - rad);
    maxY = Math.max(maxY, r.y + rad);
  }
  // El suelo tambien acota la rejilla: con el plano cargado y ningun rack, sin esto
  // no se dibujaba ninguna linea y el lienzo quedaba sin ninguna referencia.
  for (const p of suelo) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  const x0 = Math.floor(minX / paso) * paso;
  const y0 = Math.floor(minY / paso) * paso;

  ctx.save();
  ctx.lineWidth = 1;
  for (let x = x0; x <= maxX + paso; x += paso) {
    const decena = Math.abs(x % (paso * 5)) < 1e-6;
    ctx.strokeStyle = decena ? 'rgba(126, 158, 198, 0.20)' : 'rgba(110, 140, 180, 0.09)';
    linea(ctx, proyectar(b, x, y0, 0), proyectar(b, x, maxY + paso, 0));
  }
  for (let y = y0; y <= maxY + paso; y += paso) {
    const decena = Math.abs(y % (paso * 5)) < 1e-6;
    ctx.strokeStyle = decena ? 'rgba(126, 158, 198, 0.20)' : 'rgba(110, 140, 180, 0.09)';
    linea(ctx, proyectar(b, x0, y, 0), proyectar(b, maxX + paso, y, 0));
  }
  ctx.restore();
}

function linea(ctx: CanvasRenderingContext2D, a: Punto, b: Punto): void {
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
}

function poligono(ctx: CanvasRenderingContext2D, ps: Punto[]): void {
  ctx.beginPath();
  ctx.moveTo(ps[0]!.sx, ps[0]!.sy);
  for (let i = 1; i < ps.length; i += 1) ctx.lineTo(ps[i]!.sx, ps[i]!.sy);
  ctx.closePath();
}

/**
 * Un rack: caras, bandas de nivel y divisiones de cuerpo.
 *
 * Las bandas y las divisiones son lo que distingue un rack de una caja, y salen del
 * CATALOGO: 36 cuerpos son 36 divisiones, no un numero decorativo. Se dibujan solo
 * si caben —por debajo de 4 px entre lineas serian una trama— y ese umbral es la
 * razon de que a poco zoom el rack se vea como un cuerpo limpio y al acercarse
 * aparezca su estructura.
 */
function dibujarRack(
  ctx: CanvasRenderingContext2D,
  b: Base,
  r: RackEnEscena,
  caras: ReturnType<typeof carasDe>,
  color: string,
  seleccionado: boolean,
  encima: boolean,
  escala: number,
  /**
   * `true` visto, `false` sin ver, `null` no aplica —no hay observaciones—.
   *
   * Los tres estados son distintos y el tercero importa: sin rutas cargadas, apagar
   * el almacen entero diria «nadie ha pasado por ningun sitio» cuando lo que pasa es
   * que no hay datos que lo digan.
   */
  visto: boolean | null,
): void {
  // Un rack SIN VER se apaga en lugar de cambiar de color: cambiarlo competiria con
  // el criterio de agrupacion, que ya usa el color para otra cosa. Apagado se lee
  // como «pendiente» sin discutir con nada.
  const k = visto === false ? 0.32 : 1;

  // Laterales, de la mas lejana a la mas cercana.
  for (const cara of caras.laterales) {
    ctx.fillStyle = resolveColor(color, (cara.larga ? 0.30 : 0.20) * k);
    poligono(ctx, cara.puntos);
    ctx.fill();
  }

  // Techo: mas claro, porque recibe la luz. Es lo que da el volumen.
  ctx.fillStyle = resolveColor(color, 0.46 * k);
  poligono(ctx, caras.techo);
  ctx.fill();

  // ── Estructura ──────────────────────────────────────────────────────────
  /*
    La geometria de las dos vive en `escena.ts` y no aqui, y salio de aqui por un defecto:
    estas lineas ponian el LARGO en el eje local X y las caras ponen el ANCHO, asi que la
    estructura se dibujaba girada 90 grados respecto a la caja que la contiene. Con un rack
    de 36 x 1,1 m la malla se salia por los dos lados y cruzaba la escena en la otra
    direccion — reportado desde la pantalla tal cual: «la cuadricula queda en direccion
    opuesta a lo que simula el cajon del rack»—.

    Dentro del lienzo no se podia probar. Fuera, si.
  */
  const altoNivel = r.niveles > 0 ? (r.alto / r.niveles) * escala : 0;
  if (altoNivel >= 4) {
    ctx.strokeStyle = resolveColor(color, 0.55);
    ctx.lineWidth = 1;
    for (const s of bandasDeNivel(b, r)) linea(ctx, s.a, s.b);
  }

  const anchoCuerpo = r.cuerpos > 0 ? (r.largo / r.cuerpos) * escala : 0;
  if (anchoCuerpo >= 4) {
    ctx.strokeStyle = resolveColor(color, 0.40);
    ctx.lineWidth = 1;
    for (const s of divisionesDeCuerpo(b, r)) linea(ctx, s.a, s.b);
  }

  // ── Aristas y estados ───────────────────────────────────────────────────
  ctx.strokeStyle = resolveColor(color, (seleccionado ? 1 : encima ? 0.9 : 0.62) * k);
  ctx.lineWidth = seleccionado ? 2 : 1;
  poligono(ctx, caras.techo);
  ctx.stroke();
  for (const cara of caras.laterales) {
    poligono(ctx, cara.puntos);
    ctx.stroke();
  }

  if (seleccionado || encima) {
    ctx.save();
    ctx.strokeStyle = resolveColor(color, seleccionado ? 0.85 : 0.5);
    ctx.lineWidth = seleccionado ? 2.5 : 1.5;
    ctx.setLineDash(seleccionado ? [] : [4, 3]);
    poligono(ctx, caras.silueta);
    ctx.stroke();
    ctx.restore();
  }

  // Bloqueado: rayado en el techo y borde discontinuo ambar. La MISMA señal que en el
  // lienzo 2D, porque es el mismo estado: si en una vista fuera un punto y en la otra
  // un rayado, habria que aprender dos idiomas para leer el mismo candado.
  if (r.bloqueado) {
    ctx.save();
    poligono(ctx, caras.techo);
    ctx.clip();
    ctx.strokeStyle = 'rgba(245,158,11,0.6)';
    ctx.lineWidth = 1;
    const xs = caras.techo.map((p) => p.sx);
    const ys = caras.techo.map((p) => p.sy);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const paso = Math.max(5, Math.min(12, (x1 - x0) / 8));
    for (let d = x0 - (y1 - y0); d < x1 + (y1 - y0); d += paso) {
      ctx.beginPath();
      ctx.moveTo(d, y0);
      ctx.lineTo(d + (y1 - y0), y1);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(245,158,11,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    poligono(ctx, caras.techo);
    ctx.stroke();
    ctx.restore();
  }

  // Un rack que el catalogo no conoce: trama discontinua en el techo. No se
  // esconde y no se finge que tiene estructura.
  if (r.cuerpos === 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    poligono(ctx, caras.techo);
    ctx.stroke();
    ctx.restore();
  }
}

/** El codigo del rack, en espacio de pantalla y encima del centro del techo. */
/**
 * Un tirador de tamaño, en espacio de PANTALLA.
 *
 * Cuadrado para los del suelo y con una barra para el del techo: la forma dice que
 * medida se estira antes de tocarlo. Y en pixeles de pantalla, no del mundo, asi que
 * mide lo mismo con el almacen entero a la vista que acercado a un rack —un tirador
 * que se hace enorme al acercar tapa justo lo que se esta ajustando—.
 *
 * El relleno oscuro no es decorativo: sin el, un tirador sobre la cara clara del techo
 * se pierde, y es la diana del gesto.
 */
function dibujarTirador(
  ctx: CanvasRenderingContext2D,
  tir: TiradorTamano,
  resaltado: boolean,
): void {
  const { sx, sy } = tir.punto;
  const l = LADO_TIRADOR_3D * (resaltado ? 1.25 : 1);
  ctx.save();
  ctx.fillStyle = '#0b1220';
  ctx.strokeStyle = resaltado ? '#ffffff' : '#22d9f5';
  ctx.lineWidth = resaltado ? 2 : 1.5;

  if (tir.medida === 'alto') {
    // Un rombo para el alto: es el unico que se mueve en vertical, y una forma
    // distinta lo separa de los cuatro del suelo sin necesidad de leer nada.
    ctx.beginPath();
    ctx.moveTo(sx, sy - l / 2);
    ctx.lineTo(sx + l / 2, sy);
    ctx.lineTo(sx, sy + l / 2);
    ctx.lineTo(sx - l / 2, sy);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.rect(sx - l / 2, sy - l / 2, l, l);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function dibujarEtiqueta(
  ctx: CanvasRenderingContext2D,
  r: RackEnEscena,
  techo: Punto[],
  escala: number,
  seleccionado: boolean,
): void {
  // Por debajo de 5 px/m un almacen de 347 racks son 347 etiquetas solapadas: se
  // dejan de dibujar en lugar de amontonarlas. La seleccionada siempre se muestra,
  // porque es la que se esta buscando.
  if (escala < 5 && !seleccionado) return;

  const cx = techo.reduce((a, p) => a + p.sx, 0) / techo.length;
  const cy = Math.min(...techo.map((p) => p.sy));

  ctx.save();
  ctx.font = `${seleccionado ? 11 : 10}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const ancho = ctx.measureText(r.rackCode).width;
  ctx.fillStyle = 'rgba(10, 20, 36, 0.74)';
  ctx.fillRect(cx - ancho / 2 - 3, cy - 15, ancho + 6, 13);
  ctx.fillStyle = seleccionado ? 'rgba(240, 249, 255, 0.98)' : 'rgba(206, 224, 245, 0.82)';
  ctx.fillText(r.rackCode, cx, cy - 3);
  ctx.restore();
}

// ══ Piezas de interfaz ══════════════════════════════════════════════════════

function Escala({ escala }: { escala: number }) {
  // Se elige la longitud REDONDA cuya barra mida entre 60 y 160 px. Una barra de
  // longitud fija con un numero raro (37,4 m) no se puede usar para medir a ojo.
  const opciones = [1, 2, 5, 10, 20, 50, 100];
  const metros = opciones.find((m) => m * escala >= 60) ?? 100;
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5">
      <span className="t-mono-xs text-[var(--text-faint)]">{metros} m</span>
      <span
        aria-hidden
        className="h-[3px] border-x border-[var(--text-faint)] [background:var(--hairline-strong)]"
        style={{ width: `${metros * escala}px` }}
      />
    </div>
  );
}

function Interruptor({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        't-mono-xs rounded-[var(--radius-xs)] px-2 py-1 transition-colors',
        activo
          ? 'text-[var(--text-primary)] [background:var(--glass-3)]'
          : 'text-[var(--text-faint)] [background:var(--glass-2)] hover:text-[var(--text-muted)]',
      )}
    >
      {children}
    </button>
  );
}

function Boton({
  icono: Icono,
  onClick,
  etiqueta,
}: {
  icono: typeof Plus;
  onClick: () => void;
  etiqueta: string;
}) {
  return (
    <Button variant="secondary" size="xs" iconOnly onClick={onClick} title={etiqueta} aria-label={etiqueta}>
      <Icono strokeWidth={1.5} className="size-3.5" />
    </Button>
  );
}

function Aviso({
  icono: Icono,
  titulo,
  texto,
  tenue,
}: {
  icono: typeof Boxes;
  titulo: string;
  texto: string;
  tenue?: boolean;
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 flex justify-center px-4',
        tenue ? 'top-12' : 'inset-y-0 items-center',
      )}
    >
      <div className="flex max-w-md items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 [background:var(--glass-3)]">
        <Icono strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-[var(--icon-muted)]" />
        <div className="flex flex-col gap-0.5">
          <span className="t-mono-xs text-[var(--text-primary)]">{titulo}</span>
          <span className="t-mono-xs text-[var(--text-faint)]">{texto}</span>
        </div>
      </div>
    </div>
  );
}
