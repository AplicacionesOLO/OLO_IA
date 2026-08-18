/**
 * LAS FIGURAS DEL PLANO: tipos, y las tres cosas que hay que medir al subir una.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE MEDIR EL MODELO EN EL NAVEGADOR
 *
 * Porque un `.glb` no declara su unidad. glTF dice que son metros, pero quien exporta desde
 * Blender sin tocar nada saca centímetros, y quien exporta un CAD saca milímetros. Y no hay
 * forma de saberlo mirando el archivo.
 *
 * El navegador es el único sitio donde el modelo ya está descargado y descomprimido antes
 * de subirlo, así que medirlo ahí es gratis. En el servidor habría que volver a leer el
 * `.glb`, y para eso haría falta un intérprete de glTF en Python que no tenemos.
 *
 * Una persona de 1.700 m junto a un rack de 12 no es un detalle estético: hace inservible
 * el plano y no se ve mirando la figura, se ve cuando ya está colocada.
 */

/** Las categorías. La MISMA lista que el `CHECK` de 0093 y que `CATEGORIAS` del backend. */
export const CATEGORIAS_DE_FIGURA = [
  'persona',
  'dron',
  'montacargas',
  'vehiculo',
  'tarima',
  'senal',
  'mobiliario',
  'otro',
] as const;

export type CategoriaDeFigura = (typeof CATEGORIAS_DE_FIGURA)[number];

/** Cómo se llama cada categoría en pantalla. `senal` sin eñe en el código, con eñe aquí. */
export const NOMBRE_DE_CATEGORIA: Record<CategoriaDeFigura, string> = {
  persona: 'personas',
  dron: 'drones',
  montacargas: 'montacargas',
  vehiculo: 'vehículos',
  tarima: 'tarimas',
  senal: 'señales',
  mobiliario: 'mobiliario',
  otro: 'otros',
};

/**
 * Alto típico de cada categoría, en metros. Solo para SUGERIR una escala.
 *
 * No es una afirmación sobre el modelo de nadie: es la referencia con la que detectar un
 * error de unidad de tres órdenes de magnitud. `otro` no tiene alto típico, y darle uno
 * sería inventarlo.
 */
export const ALTO_TIPICO_M: Partial<Record<CategoriaDeFigura, number>> = {
  persona: 1.7,
  dron: 0.3,
  montacargas: 2.2,
  vehiculo: 2.5,
  tarima: 1.5,
  senal: 2.0,
  mobiliario: 1.0,
};

/**
 * DE DONDE SE BAJAN LOS BYTES DE UNA FIGURA.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * DOS ORIGENES, UNA SOLA RESPUESTA
 *
 * Una figura puede estar en dos sitios y solo en uno de los dos:
 *
 *   · SUBIDA por un operador: vive en el bucket y la API devuelve una URL firmada de una
 *     hora en `glb_url`.
 *   · DEL PROYECTO: viene con la aplicación, y la API devuelve una `builtin_key` en vez de
 *     una URL, porque no hay nada que firmar.
 *
 * Esta función devuelve lo único que el resto del código necesita: la dirección de la que
 * bajar el modelo. Vive aquí y no en cada pantalla porque hay tres consumidores —el visor
 * WebGL, el selector del panel y el medidor de la subida— y con la regla escrita tres veces
 * bastaría que una se quedara atrás para que una figura del proyecto saliera en el selector
 * y no se dibujara. Ese síntoma se lee como «el modelo está roto».
 *
 * ── POR QUE LAS DEL PROYECTO NO PASAN POR EL BUCKET ───────────────────────────
 *
 * Porque un palet europeo mide lo mismo en todos los almacenes del mundo. Subirlo era una
 * copia por operador, un almacén recién creado sin ninguna herramienta hasta que alguien
 * subiera algo, y una firma que caduca cada hora para un archivo de 15 KB que no cambia
 * nunca. Servido desde el propio origen se cachea, funciona sin Storage y no caduca.
 */
export const RUTA_FIGURAS_DEL_PROYECTO = '/figuras';

export function urlDeFigura(
  glbUrl: string | null | undefined,
  builtinKey: string | null | undefined,
): string | null {
  //  La del proyecto MANDA cuando está: si algún día una fila llegara con las dos —el CHECK
  //  de 0098 lo impide en la base, pero no en una respuesta inventada— servir la local es
  //  la opción que no depende de una firma que puede haber caducado.
  if (builtinKey) return `${RUTA_FIGURAS_DEL_PROYECTO}/${builtinKey}.glb`;
  return glbUrl ?? null;
}

/**
 * EL TIPO DE UN MODELO, QUE NO SE PUEDE PREGUNTAR AL ARCHIVO.
 *
 * ── EL FALLO QUE ESTO ARREGLA ─────────────────────────────────────────────────
 *
 * `File.type` lo pone el sistema operativo a partir de la extensión, y Windows no tiene
 * registrado el MIME de `.glb`. Así que un modelo exportado desde cualquier herramienta
 * llega con `type: ''`, el navegador manda `application/octet-stream` y el bucket lo
 * rechaza con «415 invalid_mime_type» — después de haber reservado la ruta—.
 *
 * Reportado tal cual, con un `person_0.glb` de 2,6 MB hecho a mano.
 *
 * Se decide por la EXTENSION, que es lo único fiable aquí, y solo se acepta el `type` del
 * sistema cuando ya es uno de los nuestros. `null` cuando no es un glTF: entonces la
 * pantalla lo dice antes de subir nada.
 */
export function tipoDeModelo(file: File): string | null {
  const declarado = file.type.toLowerCase();
  if (declarado === 'model/gltf-binary' || declarado === 'model/gltf+json') return declarado;
  const nombre = file.name.toLowerCase();
  if (nombre.endsWith('.glb')) return 'model/gltf-binary';
  if (nombre.endsWith('.gltf')) return 'model/gltf+json';
  return null;
}

/** Una figura del catálogo. */
export interface FiguraDelCatalogo {
  id: string;
  /** `null` es la biblioteca de la PLATAFORMA, que todos ven. */
  tenantId: string | null;
  name: string;
  kind: string;
  /** URL FIRMADA de una hora. `null` si el objeto ya no está. */
  /** Si viene CON LA APLICACION. `null` = subida al bucket por alguien. */
  builtinKey: string | null;
  glbUrl: string | null;
  thumbUrl: string | null;
  byteCount: number | null;
  sizeXM: number | null;
  sizeYM: number | null;
  sizeZM: number | null;
  scale: number;
  license: string;
  attribution: string | null;
  sourceUrl: string | null;
  notes: string | null;
  updatedAt: string;
}

/** Una figura COLOCADA en un plano. */
export interface FiguraColocada {
  id: string;
  warehouseId: string;
  modelId: string;
  /** En METROS y en el mismo sistema que los racks. */
  xM: number;
  yM: number;
  /** Altura sobre el suelo. Un dron a 6 m es el caso que da sentido a esto. */
  zM: number;
  rotationDeg: number;
  /** Escala de ESTA aparición, que se multiplica por la del modelo. */
  scale: number;
  label: string | null;
  notes: string | null;
  modelName: string;
  modelKind: string;
  modelScale: number;
  modelSizeYM: number | null;
  /** Si el modelo viene CON LA APLICACION. Ver `urlDeFigura`. */
  builtinKey: string | null;
  glbUrl: string | null;
  thumbUrl: string | null;
}

/** Lo que hace falta para subir una figura. */
export interface FiguraNueva {
  file: File;
  name: string;
  kind: CategoriaDeFigura;
  license: string;
  attribution?: string | undefined;
  sourceUrl?: string | undefined;
  notes?: string | undefined;
  /** Si va a la biblioteca común. Solo el Platform Owner puede. */
  forPlatform?: boolean | undefined;
  /** Por dónde va la subida. Un `.glb` de 60 MB tarda, y un botón girando no informa. */
  onPaso?: ((paso: string) => void) | undefined;
}

/** Las medidas de un modelo, en las unidades del propio archivo. */
export interface MedidasDelModelo {
  x: number;
  y: number;
  z: number;
}

/**
 * POR CUANTO MULTIPLICAR PARA QUE EL ALTO CUADRE CON LO TIPICO.
 *
 * `null` cuando no hay con qué comparar o cuando el desajuste es pequeño: entre la mitad y
 * el doble la diferencia es de modelado, no de unidad, y proponer «x 0,94» sobre un modelo
 * que ya estaba bien invita a estropearlo.
 *
 * Es una SUGERENCIA. No se aplica sola: adivinar la escala de un modelo ajeno y guardarla
 * como dato sería inventar una medida.
 */
export function escalaSugerida(
  altoM: number | null | undefined,
  categoria: CategoriaDeFigura,
): number | null {
  const tipico = ALTO_TIPICO_M[categoria];
  if (!altoM || !tipico || altoM <= 0) return null;
  const factor = tipico / altoM;
  if (factor >= 0.5 && factor <= 2) return null;
  return Number(factor.toPrecision(6));
}

/**
 * Qué decir de un modelo cuyo tamaño no cuadra. `null` si cuadra o no se sabe.
 *
 * El mensaje nombra la unidad probable porque es lo que permite decidir: «mide 170» no dice
 * nada, «parece estar en centímetros» sí.
 */
export function avisoDeEscala(
  altoM: number | null | undefined,
  categoria: CategoriaDeFigura,
): string | null {
  const factor = escalaSugerida(altoM, categoria);
  if (factor === null || !altoM) return null;
  const unidad =
    factor <= 0.0015 ? 'milímetros' : factor <= 0.015 ? 'centímetros' : 'otra unidad';
  const tipico = ALTO_TIPICO_M[categoria];
  return (
    `El modelo mide ${altoM.toFixed(altoM >= 100 ? 0 : 2)} de alto y ${NOMBRE_DE_CATEGORIA[categoria]} ` +
    `suele medir ${tipico} m. Parece estar en ${unidad}: multiplica por ${factor}.`
  );
}
