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

import { cn } from '../../../design/utils/cn';
import type { OrdenCamara3D } from '../editor/types';
import type { FiguraColocada } from '../figuras';
import { COLOR_SLOT, estadoDeSlot } from '../inspection';
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
import { cajaDeRack, claveDeHueco, cuantasPlacas, encuadreDe, placasDeHuecos } from './mundo';

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
  className?: string | undefined;
}

/** Color del suelo y del fondo. Neutros: el color tiene que ser información, no decoración. */
const COLOR_SUELO = 0x1b1f27;
const COLOR_FONDO = 0x0e1116;

/** Sin figuras, una lista estable: una nueva en cada render reconstruiría la escena. */
const SIN_FIGURAS: readonly FiguraColocada[] = [];

export function Almacen3D({
  escena,
  slots,
  onSeleccionar,
  onAbrirHueco,
  figuras = SIN_FIGURAS,
  onTocarFigura,
  onMoverFigura,
  modoPan = false,
  orden,
  className,
}: Almacen3DProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [placas, setPlacas] = useState(0);
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

  //  Las devoluciones de llamada en una referencia: si entraran en las dependencias del
  //  efecto, cada render del padre reconstruiría la escena entera —58.620 placas— y la
  //  cámara volvería a su sitio en cada clic.
  const cb = useRef({ onSeleccionar, onAbrirHueco, onTocarFigura, onMoverFigura });
  cb.current = { onSeleccionar, onAbrirHueco, onTocarFigura, onMoverFigura };

  useEffect(() => {
    const host = contenedor.current;
    if (!host) return;

    //  Los contadores se REINICIAN aquí. Sin esto siguen sumando entre montajes del efecto
    //  —y en desarrollo React monta dos veces a propósito—, así que el pie decía «2 de 1
    //  figura(s)»: un número imposible que se vio en una captura.
    setColocadas(0);
    setFallidas(0);

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
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR_FONDO);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    const controles = new OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    controles.dampingFactor = 0.08;
    //  No se deja pasar por debajo del suelo: mirar el almacén desde el subsuelo no
    //  informa de nada y desorienta.
    controles.maxPolarAngle = Math.PI / 2 - 0.02;
    /*
      ── DESPLAZARSE, NO SOLO GIRAR ────────────────────────────────────────────

      Reportado tal cual: «no puedo moverme en el 3D+, solo gira en su eje». Y era verdad
      para el gesto que todo el mundo prueba primero — arrastrar con el botón izquierdo—.

      Ahora hay tres formas, las MISMAS que en el visor axonométrico, que resuelve esto con
      `e.button === 1 || e.shiftKey || espacio || modoPan`:

        · la herramienta MOVER de la barra (`modoPan`), que es la explícita;
        · Mayús + arrastrar, para no tener que cambiar de herramienta;
        · el botón central o el derecho, que es lo que espera quien viene de un CAD.

      `screenSpacePanning` a `true`: desplaza en el plano de la PANTALLA y no en el del
      suelo. Con `false`, mirando casi de frente el desplazamiento vertical se convierte en
      un avance enorme sobre el suelo y la escena se escapa de la vista.
    */
    controles.screenSpacePanning = true;
    controles.mouseButtons = {
      LEFT: modoPan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    //  Mayús + arrastrar desplaza, sin cambiar de herramienta. Se conmuta al vuelo porque
    //  `OrbitControls` decide el gesto al pulsar, así que basta que el botón esté bien
    //  asignado en ese instante.
    const alTeclaBajar = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !modoPan) controles.mouseButtons.LEFT = THREE.MOUSE.PAN;
    };
    const alTeclaSubir = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !modoPan) controles.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    };
    window.addEventListener('keydown', alTeclaBajar);
    window.addEventListener('keyup', alTeclaSubir);

    // ── Luces ────────────────────────────────────────────────────────────────
    //
    //  Hemisférica para que nada quede en negro absoluto —una cara sin luz no se puede
    //  juzgar— y una direccional para que las cajas se lean como volúmenes y no como
    //  siluetas. Sin sombras proyectadas: con 347 racks cuestan y no añaden información.
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1d24, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.5);
    sol.position.set(1, 2, 1.4);
    scene.add(sol);

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

    // ── Los racks, en UNA malla instanciada ──────────────────────────────────
    const geoCaja = new THREE.BoxGeometry(1, 1, 1);
    const matRack = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
    const mallaRacks = new THREE.InstancedMesh(geoCaja, matRack, Math.max(1, escena.length));
    mallaRacks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    escena.forEach((r, i) => {
      const c = cajaDeRack(r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.giroY);
      m.compose(
        new THREE.Vector3(...c.posicion),
        q,
        new THREE.Vector3(...c.escala),
      );
      mallaRacks.setMatrixAt(i, m);
      mallaRacks.setColorAt(i, color.set(r.color));
    });
    mallaRacks.count = escena.length;
    scene.add(mallaRacks);

    // ── Los huecos, en OTRA malla instanciada ────────────────────────────────
    //
    //  Solo de los racks que tienen lectura. Hoy son 5 huecos de 29.310, así que reservar
    //  para todos serían 58.620 instancias vacías: el búfer se pide del tamaño que hace
    //  falta, no del que podría hacer falta algún día.
    const conLectura = escena.filter((r) => r.rackId && (slots?.get(r.rackId)?.length ?? 0) > 0);
    const tope = Math.max(1, cuantasPlacas(conLectura));
    const geoPlaca = new THREE.BoxGeometry(1, 1, 1);
    const matPlaca = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      transparent: true,
      opacity: 0.9,
    });
    const mallaHuecos = new THREE.InstancedMesh(geoPlaca, matPlaca, tope);
    //  De `instanceId` a la lectura. El picking devuelve un número; esto lo traduce.
    const porInstancia: SlotLeido[] = [];
    //  Los huecos DISTINTOS. Cada uno pone dos placas —una por cara— y contar placas
    //  diria «10 huecos» donde hay 5: un numero que parece un dato y es el doble.
    const huecos = new Set<string>();
    let n = 0;
    for (const r of conLectura) {
      const leidos = new Map<string, SlotLeido>();
      for (const s of slots?.get(r.rackId!) ?? []) {
        if (s.bayIndex == null || s.level == null) continue;
        leidos.set(claveDeHueco(s.bayIndex - 1, s.level, s.position ?? 1), s);
      }
      for (const p of placasDeHuecos(r)) {
        const leido = leidos.get(claveDeHueco(p.cuerpo, p.nivel, p.posicion_));
        //  «Sin leer» no se dibuja: una placa gris sobre cada hueco taparía el rack entero
        //  y haría desaparecer los pocos que sí tienen dato.
        if (!leido) continue;
        const estado = estadoDeSlot(leido.status);
        if (estado === 'sin_leer') continue;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.giroY);
        m.compose(new THREE.Vector3(...p.posicion), q, new THREE.Vector3(...p.escala));
        mallaHuecos.setMatrixAt(n, m);
        mallaHuecos.setColorAt(n, color.set(COLOR_SLOT[estado].color));
        porInstancia[n] = leido;
        n += 1;
        huecos.add(leido.locationId);
      }
    }
    mallaHuecos.count = n;
    scene.add(mallaHuecos);
    setPlacas(huecos.size);

    // ── Cámara ───────────────────────────────────────────────────────────────
    /*
      ── LA CAMARA SOBREVIVE AL REPINTADO ──────────────────────────────────────

      Guardar un arrastre invalida la consulta de figuras, y eso vuelve a montar la escena.
      Sin recordar dónde estaba la cámara, cada figura que se mueve devolvería la vista al
      encuadre inicial: se arrastra un operario, la pantalla salta, y hay que volver a
      acercarse para mover el siguiente. Inusable.

      Se guarda en una referencia que sobrevive al efecto, y se restaura si hay algo. Solo
      la primera vez se encuadra.
    */
    if (camaraGuardada.current) {
      const g = camaraGuardada.current;
      camera.position.set(g.pos[0], g.pos[1], g.pos[2]);
      controles.target.set(g.mira[0], g.mira[1], g.mira[2]);
    } else if (encuadre) {
      const [cx, cy, cz] = encuadre.centro;
      controles.target.set(cx, cy, cz);
      /*
        ── LA DISTANCIA SALE DEL CAMPO DE VISION, NO DE UN NUMERO A OJO ──────────

        Para que una esfera de radio R entre justo en la pantalla, la camara tiene que
        estar a `R / sen(fov/2)`. Con un multiplicador inventado el encuadre sale bien en
        un almacen y mal en el siguiente, porque depende del tamaño.

        Y la direccion se NORMALIZA. Antes se sumaba (0,7 · 0,6 · 0,7) a cada eje, cuyo
        modulo es 1,16: la camara acababa un 16 % mas lejos de lo calculado y el almacen
        salia pequeño en medio de la pantalla. Se vio en una captura.
      */
      const d = (encuadre.radio / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
      const dir = new THREE.Vector3(0.7, 0.55, 0.7).normalize().multiplyScalar(d);
      camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z);
    } else {
      controles.target.set(0, 0, 0);
      camera.position.set(30, 25, 30);
    }
    controles.update();

    /*
      ── LAS FIGURAS (0093) ────────────────────────────────────────────────────

      Personas, drones, montacargas. Es lo que convierte una estantería en un almacén: para
      juzgar si un pasillo da o si el dron pasa entre dos hileras hay que verlo A ESCALA,
      y eso no se dibuja con cajas.

      Se cargan de forma ASÍNCRONA y una a una, en cuanto llega cada una. No se espera a
      tenerlas todas: un `.glb` de 10 MB por una red de almacén tarda, y con `Promise.all`
      una figura lenta dejaría el plano sin ninguna.

      `cancelado` es lo que impide el fallo clásico de esto: la vista se cierra mientras un
      modelo viaja, la descarga termina después, y se añade a una escena que ya no existe —o
      peor, ya liberada—. Sin esa bandera, cambiar de vista mientras carga deja fugas y
      excepciones que no apuntan a ningún sitio.
    */
    let cancelado = false;
    const cargados: THREE.Object3D[] = [];
    if (figuras.length > 0) {
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
            //  La escala del MODELO por la de la aparición: la primera corrige la unidad
            //  del archivo, la segunda es del plano. Multiplicarlas permite un mismo modelo
            //  a dos tamaños sin subirlo dos veces.
            const s = (f.modelScale || 1) * (f.scale || 1);
            obj.scale.setScalar(s);
            //  Mismos ejes que los racks: x del dominio a x, y del dominio a z, altura a y.
            //  Y el giro negativo, por la misma razón — el dominio mide horario visto desde
            //  arriba y three.js antihorario—.
            obj.position.set(f.xM, f.zM, f.yM);
            obj.rotation.y = (-f.rotationDeg * Math.PI) / 180;
            obj.name = `figura:${f.id}`;
            //  Para el picking: de un hijo cualquiera de la malla hay que poder llegar a la
            //  figura, y `userData` viaja con el objeto.
            obj.traverse((h) => {
              h.userData.figuraId = f.id;
            });
            scene.add(obj);
            cargados.push(obj);
            setColocadas((n) => n + 1);
          } catch {
            //  Una figura que no se puede descargar no puede tumbar el plano: se queda sin
            //  dibujar y las demás siguen. Es el mismo criterio que la prueba visual de una
            //  lectura — un extra no puede ser el motivo de que no se vea nada—.
            setFallidas((n) => n + 1);
          }
        }
      })();
    }

    // ── Picking ──────────────────────────────────────────────────────────────
    //
    //  Un rayo desde el cursor. Es lo que en la vista axonométrica costó `carasDe`,
    //  `dentro`, `rackEn` y `celdaEn` —y una prueba por cámara para comprobar que el
    //  hueco tocado era el que se veía—. Aquí lo da el motor, y con la profundidad real:
    //  se toca lo que está delante, no lo que el orden de pintado dejó encima.
    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
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

      En perspectiva un píxel es una RECTA, no un punto: hay que decir contra qué plano se
      corta. Dos gestos, cada uno con el suyo, y los dos inequívocos:

        arrastrar          plano HORIZONTAL a la altura actual  → mover por el suelo
        Mayús + arrastrar  plano VERTICAL de cara a la cámara   → cambiar la altura

      La aritmética está en `arrastre.ts` con 18 pruebas, porque el signo de la constante
      del plano y la correspondencia de ejes son exactamente lo que se equivoca — y produce
      una figura que se va al infinito o que se mueve en diagonal respecto al ratón—.

      Mientras se arrastra, `OrbitControls` se APAGA. Sin eso, el mismo gesto movería la
      figura y giraría la cámara a la vez, y no se podría hacer ninguna de las dos cosas.
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

    const ponerPlano = (p: PlanoDeArrastre) => {
      planoThree.set(
        new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]),
        p.constante,
      );
    };

    const alBajar = (e: MouseEvent) => {
      arrastro = false;
      //  Solo el botón principal: el secundario y el central son de la cámara.
      if (e.button !== 0 || cargados.length === 0 || !cb.current.onMoverFigura) return;
      if (!apuntar(e)) return;
      const tocada = rayo.intersectObjects(cargados, true)[0];
      const id = tocada?.object.userData?.figuraId as string | undefined;
      if (!tocada || !id) return;

      //  El objeto raíz, no la hoja que tocó el rayo: mover una hoja movería un brazo del
      //  operario y dejaría el resto donde estaba.
      const obj = cargados.find((o) => o.userData.figuraId === id || o.name === `figura:${id}`);
      if (!obj) return;

      const vertical = e.shiftKey;
      const pos = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
      const plano = vertical
        ? planoVertical(
            { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            pos,
          )
        : planoHorizontal(pos.y);
      //  Sin plano —cámara justo encima— no se arrastra en vertical. Mejor no hacer nada
      //  que mover la figura decenas de metros por un píxel de ratón.
      if (!plano) return;
      ponerPlano(plano);
      if (!rayo.ray.intersectPlane(planoThree, cortePlano)) return;

      agarrada = {
        obj,
        id,
        //  Se agarra POR DONDE se pinchó: sin el desfase, la figura salta a centrarse bajo
        //  el cursor antes de moverse, y el salto se lee como un fallo.
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
      //  La posición YA al agarrar, no solo al mover: si apareciera al primer
      //  desplazamiento, agarrar algo y dudar un segundo se vería como que no ha pasado
      //  nada — y el gesto necesita decir que está activo antes de cambiar nada—.
      setDonde(aDominio(pos));
      e.preventDefault();
    };

    const alMover = (e: MouseEvent) => {
      arrastro = true;
      if (!agarrada) return;
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
    };

    const alSoltar = () => {
      const g = agarrada;
      agarrada = null;
      controles.enabled = true;
      setArrastrando(false);
      setDonde(null);
      if (!g) return;
      const fin = aDominio({
        x: g.obj.position.x,
        y: g.obj.position.y,
        z: g.obj.position.z,
      });
      //  Se guarda solo si de verdad se movió: por debajo de un centímetro sería una
      //  escritura, una invalidación de consulta y un repintado de la escena por nada.
      if (movimientoApreciable(g.inicio, fin)) cb.current.onMoverFigura?.(g.id, fin);
    };
    const alPulsar = (e: MouseEvent) => {
      //  Girar la cámara no es señalar nada. Mismo criterio que la vista axonométrica.
      if (arrastro) return;
      const caja = renderer.domElement.getBoundingClientRect();
      puntero.x = ((e.clientX - caja.left) / caja.width) * 2 - 1;
      puntero.y = -((e.clientY - caja.top) / caja.height) * 2 + 1;
      rayo.setFromCamera(puntero, camera);
      /*
        Las FIGURAS antes que nada: están sueltas por el suelo y por los pasillos, así que
        si el rayo toca una es a ella a quien se apunta — y quien pincha una persona quiere
        la persona, no el rack que tenga detrás—.

        `true` para recorrer los hijos: un `.glb` es un árbol de mallas, y el rayo toca una
        hoja. De ahí se sube al identificador por `userData`, que viaja con cada nodo.
      */
      if (cargados.length > 0) {
        const enFiguras = rayo.intersectObjects(cargados, true);
        const tocada = enFiguras[0];
        if (tocada) {
          const id = tocada.object.userData?.figuraId as string | undefined;
          if (id) {
            cb.current.onTocarFigura?.(id);
            return;
          }
        }
      }
      //  Los huecos DESPUÉS: están por fuera de la cara del rack, así que si el rayo toca
      //  uno es al hueco a quien se apunta.
      const enHuecos = rayo.intersectObject(mallaHuecos, false);
      const enRacks = rayo.intersectObject(mallaRacks, false);
      const primero = enHuecos[0];
      const rackTocado = enRacks[0];
      if (
        primero &&
        primero.instanceId != null &&
        (!rackTocado || primero.distance <= rackTocado.distance + 1e-6)
      ) {
        const leido = porInstancia[primero.instanceId];
        //  El rack también se selecciona: abrir el hueco no le quita al clic lo que ya
        //  hacía. Mismo criterio que la vista axonométrica.
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
    //  `pointerup` en la VENTANA y no en el lienzo: soltar el botón fuera del lienzo es
    //  normal al arrastrar hasta el borde, y escuchando solo el lienzo la figura se quedaría
    //  pegada al ratón para siempre.
    window.addEventListener('pointerup', alSoltar);
    //  Y también al perder el puntero —otra pestaña, un menú del sistema—: un arrastre que
    //  no termina deja la cámara apagada y el visor sin responder.
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

    // ── El bucle ─────────────────────────────────────────────────────────────
    //
    //  `setAnimationLoop` y no `requestAnimationFrame` a mano: el motor lo para solo al
    //  perder el contexto y funciona igual en WebXR, si algún día se mira con gafas.
    /*
      El mando de la cámara, expuesto para el efecto de las órdenes. Se define aquí porque
      necesita `camera` y `controles`, que viven en este efecto.

      `ajustar` recalcula el encuadre desde cero —igual que al montar— y las otras dos
      mueven la cámara a lo largo de la línea que la une con el objetivo, que es lo que hace
      un zoom en una vista en perspectiva: acercarse, no cambiar el ángulo de visión.
    */
    mandoDeCamara.current = (tipo) => {
      const alObjetivo = new THREE.Vector3().subVectors(camera.position, controles.target);
      if (tipo === 'acercar' || tipo === 'alejar') {
        const f = tipo === 'acercar' ? 0.75 : 1 / 0.75;
        //  Con un tope mínimo: sin él, acercar repetidamente mete la cámara dentro de un
        //  rack y la pantalla se queda en negro sin decir por qué.
        const largo = Math.max(1.5, alObjetivo.length() * f);
        camera.position.copy(controles.target).add(alObjetivo.setLength(largo));
      } else if (tipo === 'ajustar') {
        const e = encuadreDe(escena);
        if (!e) return;
        const [cx, cy, cz] = e.centro;
        controles.target.set(cx, cy, cz);
        const d = (e.radio / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
        const dir = new THREE.Vector3(0.7, 0.55, 0.7).normalize().multiplyScalar(d);
        camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z);
      } else {
        //  Volver al ángulo de partida SIN cambiar la distancia: es «recuperar la
        //  orientación», no «volver al principio». Perder el zoom al querer solo enderezar
        //  la vista obliga a acercarse otra vez.
        const dir = new THREE.Vector3(0.7, 0.55, 0.7).normalize().multiplyScalar(
          alObjetivo.length(),
        );
        camera.position.copy(controles.target).add(dir);
      }
      controles.update();
    };

    renderer.setAnimationLoop(() => {
      controles.update();
      //  Dónde está la cámara, en cada fotograma. Es lo que permite que un repintado no
      //  devuelva la vista al encuadre inicial. Escribir dos vectores por fotograma no se
      //  nota; volver a encuadrar tras cada arrastre sí.
      camaraGuardada.current = {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        mira: [controles.target.x, controles.target.y, controles.target.z],
      };
      renderer.render(scene, camera);
    });

    return () => {
      //  Soltarlo TODO. Un contexto WebGL no lo recoge el recolector de basura: cambiar de
      //  vista veinte veces sin esto deja veinte contextos vivos y el navegador acaba
      //  tirando el más antiguo — la pantalla se queda en negro sin ningún error—.
      //  Primero la bandera: si un modelo está viajando, lo que llegue después no se añade
      //  a una escena que ya no existe.
      cancelado = true;
      renderer.setAnimationLoop(null);
      observador.disconnect();
      renderer.domElement.removeEventListener('pointerdown', alBajar);
      renderer.domElement.removeEventListener('pointermove', alMover);
      renderer.domElement.removeEventListener('click', alPulsar);
      window.removeEventListener('pointerup', alSoltar);
      window.removeEventListener('pointercancel', alSoltar);
      window.removeEventListener('keydown', alTeclaBajar);
      window.removeEventListener('keyup', alTeclaSubir);
      controles.dispose();
      geoCaja.dispose();
      geoPlaca.dispose();
      matRack.dispose();
      matPlaca.dispose();
      suelo.geometry.dispose();
      (suelo.material as THREE.Material).dispose();
      rejilla.geometry.dispose();
      (rejilla.material as THREE.Material).dispose();
      mallaRacks.dispose();
      mallaHuecos.dispose();
      //  Las figuras, hoja por hoja. Un `.glb` es un árbol de mallas con sus materiales y
      //  sus texturas, y cada uno tiene memoria de vídeo reservada que no se libera sola.
      for (const obj of cargados) {
        obj.traverse((h) => {
          const malla = h as THREE.Mesh;
          malla.geometry?.dispose?.();
          const mat = malla.material;
          for (const m2 of Array.isArray(mat) ? mat : [mat]) m2?.dispose?.();
        });
        scene.remove(obj);
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [escena, slots, figuras, modoPan]);

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
  useEffect(() => {
    if (!orden) return;
    const mando = mandoDeCamara.current;
    if (!mando) return;
    mando(orden.tipo);
    //  Solo `orden.n`: es el contador el que dice «hay una orden nueva». Con el objeto
    //  entero en las dependencias, dos órdenes iguales seguidas no se distinguirían.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orden?.n]);

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
              {modoPan ? 'arrastrar desplaza' : 'arrastrar gira · Mayús o botón central desplaza'}
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
