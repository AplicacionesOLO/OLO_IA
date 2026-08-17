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
import { COLOR_SLOT, estadoDeSlot } from '../inspection';
import type { SlotLeido } from '../inspection';
import type { RackEnEscena } from '../cluster3d/escena';
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
  className?: string | undefined;
}

/** Color del suelo y del fondo. Neutros: el color tiene que ser información, no decoración. */
const COLOR_SUELO = 0x1b1f27;
const COLOR_FONDO = 0x0e1116;

export function Almacen3D({
  escena,
  slots,
  onSeleccionar,
  onAbrirHueco,
  className,
}: Almacen3DProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [placas, setPlacas] = useState(0);

  //  Las devoluciones de llamada en una referencia: si entraran en las dependencias del
  //  efecto, cada render del padre reconstruiría la escena entera —58.620 placas— y la
  //  cámara volvería a su sitio en cada clic.
  const cb = useRef({ onSeleccionar, onAbrirHueco });
  cb.current = { onSeleccionar, onAbrirHueco };

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
    if (encuadre) {
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

    // ── Picking ──────────────────────────────────────────────────────────────
    //
    //  Un rayo desde el cursor. Es lo que en la vista axonométrica costó `carasDe`,
    //  `dentro`, `rackEn` y `celdaEn` —y una prueba por cámara para comprobar que el
    //  hueco tocado era el que se veía—. Aquí lo da el motor, y con la profundidad real:
    //  se toca lo que está delante, no lo que el orden de pintado dejó encima.
    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    let arrastro = false;
    const alBajar = () => {
      arrastro = false;
    };
    const alMover = () => {
      arrastro = true;
    };
    const alPulsar = (e: MouseEvent) => {
      //  Girar la cámara no es señalar nada. Mismo criterio que la vista axonométrica.
      if (arrastro) return;
      const caja = renderer.domElement.getBoundingClientRect();
      puntero.x = ((e.clientX - caja.left) / caja.width) * 2 - 1;
      puntero.y = -((e.clientY - caja.top) / caja.height) * 2 + 1;
      rayo.setFromCamera(puntero, camera);
      //  Los huecos PRIMERO: están por fuera de la cara del rack, así que si el rayo toca
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
    renderer.setAnimationLoop(() => {
      controles.update();
      renderer.render(scene, camera);
    });

    return () => {
      //  Soltarlo TODO. Un contexto WebGL no lo recoge el recolector de basura: cambiar de
      //  vista veinte veces sin esto deja veinte contextos vivos y el navegador acaba
      //  tirando el más antiguo — la pantalla se queda en negro sin ningún error—.
      renderer.setAnimationLoop(null);
      observador.disconnect();
      renderer.domElement.removeEventListener('pointerdown', alBajar);
      renderer.domElement.removeEventListener('pointermove', alMover);
      renderer.domElement.removeEventListener('click', alPulsar);
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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [escena, slots]);

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
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            arrastrar gira · rueda acerca · clic señala
          </span>
        </div>
      )}
    </div>
  );
}
