/**
 * DEL DOMINIO AL MUNDO 3D: metros dentro, transformaciones de three.js fuera.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARCHIVO NO IMPORTA THREE.JS
 *
 * Porque lo que hay aquí es aritmética, y la aritmética se prueba sin abrir una tarjeta
 * gráfica. `vitest` no tiene WebGL: si estas cuentas vivieran dentro del componente que
 * pinta, no habría forma de comprobarlas, y ya sabemos cómo acaba eso — el eje girado 90°
 * en el visor axonométrico estuvo semanas en pantalla porque la única manera de verlo era
 * mirarlo—.
 *
 * Devuelve números. Quien renderiza los mete en un `Matrix4` y ya.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA CONVENCION DE EJES, QUE ES LO UNICO IMPORTANTE DE AQUI
 *
 * El dominio piensa en PLANTA: `x` e `y` son el suelo, y `alto` sube. three.js piensa con
 * `y` HACIA ARRIBA. Así que la correspondencia es:
 *
 *     dominio.x   →   three.x        (a lo ancho de la nave)
 *     dominio.y   →   three.z        (a lo largo de la nave)
 *     altura      →   three.y        (arriba)
 *
 * Y dentro del rack, la MISMA convención que `esquinas()` en el visor axonométrico:
 * **`ancho` va sobre el eje local X y `largo` sobre el local Y** —que aquí es Z—. No es
 * una elección nueva: es la que ya tiene el lienzo 2D, y tenerlas distintas haría que el
 * mismo rack se dibujara girado según desde qué vista se mire. Eso pasó una vez y costó
 * seis pruebas descubrirlo.
 *
 * El giro se hace alrededor de `y` y con signo NEGATIVO. La razón es que el dominio mide
 * el ángulo en sentido horario sobre el plano `x,y` visto desde arriba, y en three.js un
 * giro positivo sobre `y` es antihorario visto desde arriba. Mismo ángulo, sentido
 * contrario; sin el signo, dos racks perpendiculares salen intercambiados.
 */

import { celdasDeRack, posicionesDe } from '../cluster3d/escena';
import type { RackEnEscena } from '../cluster3d/escena';

/** Una caja lista para instanciar: dónde, cuánto mide y cuánto gira. */
export interface CajaEnMundo {
  /** Centro, en metros, ya en ejes de three.js. */
  posicion: [x: number, y: number, z: number];
  /** Tamaño en metros, en ejes de three.js: ancho, alto, largo. */
  escala: [x: number, y: number, z: number];
  /** Giro alrededor del eje vertical, en RADIANES. */
  giroY: number;
}

/** Grados a radianes. Aquí y no importado: es una línea y evita una dependencia. */
const rad = (grados: number): number => (grados * Math.PI) / 180;

/**
 * La caja de un rack.
 *
 * El centro está a media altura porque una caja de three.js se centra en su origen,
 * mientras que el dominio da el rack apoyado en el suelo. Sin esto, medio rack quedaría
 * enterrado — y con racks de 11,9 m se vería como si el almacén tuviera un sótano.
 */
export function cajaDeRack(r: RackEnEscena): CajaEnMundo {
  return {
    posicion: [r.x, r.alto / 2, r.y],
    escala: [r.ancho, r.alto, r.largo],
    giroY: -rad(r.rotacion),
  };
}

/**
 * Una celda de hueco, como placa fina pegada a una cara larga del rack.
 *
 * `lado` es `1` o `-1`: la cara de un extremo o la del otro. En axonométrico se pintaba
 * solo la cercana —en las dos se solapaban—, pero aquí hay profundidad de verdad y la
 * cámara puede estar a cualquier lado: pintar las dos es lo correcto, y la que sobra queda
 * detrás del rack sin estorbar.
 */
export interface PlacaDeHueco extends CajaEnMundo {
  cuerpo: number;
  nivel: number;
  posicion_: number;
  lado: 1 | -1;
}

/** Grosor de la placa de un hueco, en metros. */
const GROSOR_PLACA_M = 0.04;

/**
 * Las placas de los huecos de un rack, en las dos caras largas.
 *
 * Se reutiliza `celdasDeRack` SOLO para saber cuántos cuerpos, niveles y posiciones hay y
 * en qué orden se numeran — no su geometría, que es de pantalla—. Así el hueco
 * `cuerpo 18, nivel 1, posición 2` es EL MISMO en las dos vistas, que es lo que permite
 * pinchar en una y reconocerlo en la otra.
 */
export function placasDeHuecos(r: RackEnEscena): PlacaDeHueco[] {
  if (r.cuerpos <= 0 || r.niveles <= 0 || r.alto <= 0) return [];
  const posiciones = posicionesDe(r);
  const anchoCuerpo = r.largo / r.cuerpos;
  const anchoCelda = anchoCuerpo / posiciones;
  const altoNivel = r.alto / r.niveles;
  const hl = r.largo / 2;
  const ha = r.ancho / 2;
  const cos = Math.cos(rad(r.rotacion));
  const sen = Math.sin(rad(r.rotacion));

  const salida: PlacaDeHueco[] = [];
  for (let c = 0; c < r.cuerpos; c += 1) {
    for (let n = 0; n < r.niveles; n += 1) {
      for (let p = 0; p < posiciones; p += 1) {
        //  Centro de la celda en coordenadas LOCALES del rack: `v` a lo largo, `z` arriba.
        const v = -hl + c * anchoCuerpo + p * anchoCelda + anchoCelda / 2;
        const z = n * altoNivel + altoNivel / 2;
        for (const lado of [1, -1] as const) {
          //  Justo por fuera de la cara, no dentro: una placa coplanar con la caja
          //  produce el parpadeo de dos superficies peleándose por el mismo píxel.
          const u = lado * (ha + GROSOR_PLACA_M / 2);
          salida.push({
            posicion: [r.x + u * cos - v * sen, z, r.y + u * sen + v * cos],
            escala: [GROSOR_PLACA_M, altoNivel * 0.9, anchoCelda * 0.9],
            giroY: -rad(r.rotacion),
            cuerpo: c,
            nivel: n + 1,
            posicion_: p + 1,
            lado,
          });
        }
      }
    }
  }
  return salida;
}

/**
 * Cuántas placas saldrían de estos racks. Sirve para decidir ANTES de construir.
 *
 * Con 347 racks y 29.310 huecos, las dos caras son 58.620 placas. Cabe en una malla
 * instanciada, pero conviene saber el número antes de reservar el búfer: `InstancedMesh`
 * pide el tope de golpe y crecerlo obliga a tirar el anterior.
 */
export function cuantasPlacas(racks: readonly RackEnEscena[]): number {
  let total = 0;
  for (const r of racks) {
    if (r.cuerpos <= 0 || r.niveles <= 0 || r.alto <= 0) continue;
    total += r.cuerpos * r.niveles * posicionesDe(r) * 2;
  }
  return total;
}

/**
 * Centro y radio de todo lo colocado, para plantar la cámara.
 *
 * El radio se mide sobre las ESQUINAS y no sobre los centros: un rack de 56 m puesto en el
 * borde asoma 28 m más allá de su centro, y encuadrar por centros lo deja medio fuera.
 *
 * `null` cuando no hay nada: quien llama decide qué hacer, en vez de recibir un centro
 * (0,0) que parece válido y no lo es.
 */
export function encuadreDe(
  racks: readonly RackEnEscena[],
): { centro: [number, number, number]; radio: number } | null {
  if (racks.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxY = 0;
  for (const r of racks) {
    //  La media diagonal cubre el rack en cualquier giro sin tener que rotar esquina a
    //  esquina: se pasa de largo un poco y encuadrar de más nunca deja nada fuera.
    const alcance = Math.hypot(r.ancho, r.largo) / 2;
    minX = Math.min(minX, r.x - alcance);
    maxX = Math.max(maxX, r.x + alcance);
    minZ = Math.min(minZ, r.y - alcance);
    maxZ = Math.max(maxZ, r.y + alcance);
    maxY = Math.max(maxY, r.alto);
  }
  const centro: [number, number, number] = [
    (minX + maxX) / 2,
    maxY / 2,
    (minZ + maxZ) / 2,
  ];
  const radio = Math.max(
    //  Un almacén con UN rack pequeño no puede dar radio cero: la cámara acabaría dentro
    //  de él y la pantalla en negro sin nada que avisara.
    1,
    Math.hypot(maxX - minX, maxZ - minZ) / 2,
    maxY,
  );
  return { centro, radio };
}

/**
 * A QUE ALTURA HAY QUE PONER UNA FIGURA PARA QUE SE APOYE EN EL SUELO.
 *
 * ── EL PROBLEMA ───────────────────────────────────────────────────────────────
 *
 * Un `.glb` no dice dónde tiene los pies. Cada herramienta pone el origen donde quiere: la
 * mitad de los modelos lo tienen en la BASE y la otra mitad en el CENTRO geométrico.
 *
 * Colocando la figura a `y = altura` sin más, un modelo con el origen centrado queda medio
 * enterrado — reportado tal cual: «queda dividido en el mapa, bajo tierra, o la mitad si es
 * visible sobre la superficie»—. Y no es un problema estético: una persona a la que se le ve
 * medio cuerpo no sirve para juzgar si cabe en un pasillo.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────────
 *
 * Se mide la caja del modelo y se sube tanto como esté su punto más bajo por debajo del
 * origen. Con el origen ya en la base, `minY` es 0 y no cambia nada: la regla vale para los
 * dos casos y no hay que preguntar cuál es cuál.
 *
 * ── EL PUNTO MAS BAJO TIENE QUE VENIR YA ESCALADO ─────────────────────────────
 *
 * Es el detalle que se equivoca. `Box3.setFromObject` ya aplica la escala del objeto, así que
 * medir DESPUES de escalar da el desfase real. Medir antes y no multiplicar por la escala
 * deja el modelo hundido justo en esa proporción — y con escala 1, que es el caso con el que
 * cualquiera lo probaría, las dos versiones dan lo mismo y el defecto no aparece hasta que
 * alguien escala una figura—.
 *
 * Por eso el parámetro se llama así y no `minYDelModelo`: el nombre es el recordatorio.
 */
export function apoyarEnElSuelo(minYYaEscalado: number, alturaM: number): number {
  return alturaM - minYYaEscalado;
}

/**
 * La clave de un hueco, igual que la que usa el visor axonométrico para cruzar lecturas.
 *
 * Está aquí para que las dos vistas construyan la MISMA clave. Escrita dos veces, basta
 * que una cambie para que una vista pinte el estado de un hueco sobre otro — y no habría
 * síntoma salvo un color que no cuadra con el dato.
 */
export function claveDeHueco(cuerpo: number, nivel: number, posicion: number): string {
  return `${cuerpo}|${nivel}|${posicion}`;
}

/** Las celdas tal como las numera el visor axonométrico. Solo para comprobar el acuerdo. */
export { celdasDeRack };
