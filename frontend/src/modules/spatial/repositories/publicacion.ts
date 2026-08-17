/**
 * TRADUCCION ENTRE EL BORRADOR Y EL LAYOUT PUBLICADO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS MODELOS QUE NO SON EL MISMO, Y ES DELIBERADO
 *
 * El editor trabaja en PIXELES DEL PLANO y referencia los racks por su CODIGO.
 * El backend guarda METROS y referencia los racks por su UUID. Ninguno de los dos
 * esta mal:
 *
 *   · El editor tiene una imagen delante y el raton devuelve pixeles. Obligarle a
 *     pensar en metros significaria convertir en cada `mousemove` con una escala
 *     que el operador aun no ha medido.
 *
 *   · La base no puede guardar pixeles. Un pixel no mide nada: cambia si mañana
 *     se recarga el mismo plano exportado a otra resolucion, y entonces los 347
 *     racks se mueven sin que nadie los toque. Los metros son la unica coordenada
 *     que sobrevive a cambiar de plano.
 *
 * Este modulo es la frontera, y es el UNICO sitio donde se hace la conversion.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE PUBLICAR PUEDE FALLAR SIN QUE FALLE LA RED
 *
 * Dos cosas del borrador pueden no ser publicables:
 *
 *   1. SIN CALIBRAR no hay metros. El store arranca con 50 px/m como valor de
 *      dibujo; publicar con ese numero guardaria coordenadas en una escala
 *      inventada, y nadie lo descubriria hasta medir sobre el mapa. Se avisa
 *      antes, no se convierte a la callada.
 *
 *   2. UN CODIGO SIN RACK no se puede publicar. El borrador puede contener
 *      `RCL99` porque se importo de otro navegador, o porque el rack se dio de
 *      baja despues. La FK compuesta del backend lo rechazaria entero; aqui se
 *      separa antes y se dice QUE codigos son, para que el operador los borre o
 *      los renombre en lugar de leer «violacion de clave foranea».
 *
 * Por eso `prepararPublicacion` devuelve tambien lo que NO va: publicar 340 de
 * 347 racks en silencio seria peor que no publicar.
 */

import { COLOR_RACK_POR_DEFECTO, DEFAULT_EDITOR_LAYERS } from '../editor/types';
import type { LayoutDraft, PositionedRack } from '../editor/types';
import type { PlacementDto, PublishLayoutBody, PublishedLayoutDto } from './dto';

/** Limites de la base (0065). Se comprueban aqui para no gastar la ida y vuelta. */
const MIN_LADO_M = 0.05;
const MAX_LADO_M = 200;
const MAX_ALTO_M = 60;
const MAX_COORD_M = 10_000;

export interface RackNoPublicable {
  rackCode: string;
  motivo: string;
}

export interface PublicacionPreparada {
  cuerpo: PublishLayoutBody;
  /** Racks del borrador que se quedan fuera, con el motivo para cada uno. */
  excluidos: RackNoPublicable[];
  /**
   * `false` cuando el borrador no tiene calibracion medida. NO impide publicar
   * —guardar el trabajo a medias es legitimo— pero la UI debe decirlo.
   */
  calibrado: boolean;
}

/** Normaliza a [0,360): la base rechaza 360 y los negativos. */
function normalizarGiro(grados: number): number {
  const g = grados % 360;
  return g < 0 ? g + 360 : g;
}

/** `#rrggbb` o nada. La base valida el formato y `#22d9f5aa` no pasa. */
function normalizarColor(color: string | undefined): string | null {
  if (!color) return null;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
}

function revisar(rack: PositionedRack, xM: number, yM: number): string | null {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) {
    return 'la posicion no es un numero (¿escala cero?)';
  }
  if (Math.abs(xM) > MAX_COORD_M || Math.abs(yM) > MAX_COORD_M) {
    return `esta a ${Math.round(Math.max(Math.abs(xM), Math.abs(yM)))} m del origen`;
  }
  for (const [nombre, valor] of [
    ['ancho', rack.width],
    ['largo', rack.length],
  ] as const) {
    if (!(valor >= MIN_LADO_M && valor <= MAX_LADO_M)) {
      return `${nombre} de ${valor} m fuera de ${MIN_LADO_M}–${MAX_LADO_M} m`;
    }
  }
  if (!(rack.height >= MIN_LADO_M && rack.height <= MAX_ALTO_M)) {
    return `alto de ${rack.height} m fuera de ${MIN_LADO_M}–${MAX_ALTO_M} m`;
  }
  return null;
}

/**
 * Convierte el borrador en el cuerpo del PUT.
 *
 * @param codigoARackId Codigo del rack → uuid del nodo, del catalogo del backend
 *   (`/floor-plan`). Es la traduccion que el borrador no puede hacer solo: guarda
 *   codigos porque son lo que el operador lee en el plano, y el codigo es unico
 *   por almacen, no globalmente.
 */
export function prepararPublicacion(
  draft: LayoutDraft,
  codigoARackId: ReadonlyMap<string, string>,
): PublicacionPreparada {
  const ppm = draft.calibration.pixelsPerMeter;
  const { origin } = draft.reference;
  const calibrado = draft.calibration.measured ?? draft.calibration.points != null;

  const placements: PlacementDto[] = [];
  const excluidos: RackNoPublicable[] = [];
  const vistos = new Set<string>();

  for (const rack of draft.racks) {
    const rackId = codigoARackId.get(rack.rackCode);
    if (!rackId) {
      excluidos.push({
        rackCode: rack.rackCode,
        motivo: 'el almacen no tiene ningun rack con ese codigo',
      });
      continue;
    }
    // Un rack esta en UN sitio. Dos colocaciones del mismo son dos sitios y el
    // visor 3D no sabria cual dibujar; la base lo rechazaria por unicidad, asi
    // que se corta aqui con un motivo legible.
    if (vistos.has(rackId)) {
      excluidos.push({ rackCode: rack.rackCode, motivo: 'colocado dos veces en el plano' });
      continue;
    }

    const xM = (rack.x - origin.x) / ppm;
    const yM = (rack.y - origin.y) / ppm;
    const problema = revisar(rack, xM, yM);
    if (problema) {
      excluidos.push({ rackCode: rack.rackCode, motivo: problema });
      continue;
    }

    vistos.add(rackId);
    placements.push({
      rack_node_id: rackId,
      x_m: xM,
      y_m: yM,
      rotation_deg: normalizarGiro(rack.rotation),
      width_m: rack.width,
      length_m: rack.length,
      height_m: rack.height,
      color: normalizarColor(rack.color),
      is_locked: rack.locked,
      //  El grupo viaja con el plano: si viviera solo en el borrador, el rack doble seria
      //  doble para quien lo modelo y dos racks sueltos para todos los demas — y el primero
      //  que moviera uno lo partiria—.
      ...(rack.grupoId ? { group_key: rack.grupoId } : {}),
      //  Y la cara igual. Es un dato del almacen —por donde se saca el palet—, no una
      //  preferencia de quien lo dibujo: se recorre el sitio una vez y vale para todos.
      //  Ausente y no `null` cuando no se ha declarado: son lo mismo para el backend, pero
      //  el cuerpo dice entonces exactamente lo que se sabe.
      ...(rack.frente ? { facing: rack.frente } : {}),
    });
  }

  //  Un grupo al que solo le llega UN miembro se queda sin clave.
  //
  //  Pasa cuando la pareja del rack no se publica: su codigo ya no esta en el catalogo, o
  //  esta colocado dos veces, y se quedo en `excluidos`. El superviviente saldria con una
  //  clave que no agrupa a nadie, y el backend rechaza el PUT ENTERO con «estos grupos
  //  tienen un solo rack» — un mensaje sobre el que no se puede hacer nada, mientras que el
  //  motivo real («el almacen no tiene ningun rack con ese codigo») ya esta en `excluidos`—.
  //
  //  Asi que se quita la clave y se publica: el plano se guarda, y lo que hay que arreglar
  //  se lee en la lista de excluidos, que es donde el operador puede actuar.
  const cuantos = new Map<string, number>();
  for (const p of placements) {
    if (p.group_key) cuantos.set(p.group_key, (cuantos.get(p.group_key) ?? 0) + 1);
  }
  for (const p of placements) {
    if (p.group_key && cuantos.get(p.group_key) === 1) delete p.group_key;
  }

  return {
    calibrado,
    excluidos,
    cuerpo: {
      plan_name: draft.plan?.name ?? null,
      plan_width_px: draft.plan?.width ?? null,
      plan_height_px: draft.plan?.height ?? null,
      pixels_per_meter: ppm,
      origin_x_px: origin.x,
      origin_y_px: origin.y,
      is_calibrated: calibrado,
      placements,
    },
  };
}

/**
 * El layout publicado, en la forma que consumen las pantallas.
 *
 * Un solo tipo y un solo mapeo para las DOS que lo leen —el panel de publicar y la
 * vista del explorador— porque comparten la clave de cache. Con dos formas bajo la
 * misma clave, la ultima respuesta que llegara dejaria a la otra pantalla leyendo
 * campos que no existen, y sin ningun error: solo huecos vacios.
 */
export interface LayoutPublicado {
  publicado: boolean;
  /** En PIXELES del plano, como los entiende el resto del modulo. */
  racks: PositionedRack[];
  ppm: number;
  origen: { x: number; y: number };
  calibrado: boolean;
  /** Nombre del archivo del plano. El backend no guarda la imagen. */
  planName: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

const VACIO: LayoutPublicado = {
  publicado: false,
  racks: [],
  ppm: 0,
  origen: { x: 0, y: 0 },
  calibrado: false,
  planName: null,
  publishedAt: null,
  updatedAt: null,
};

/**
 * DTO → `LayoutPublicado`. Vuelve a pixeles del plano, y no es un viaje absurdo.
 *
 * El backend guarda metros porque es la unica unidad que sobrevive a cambiar de
 * plano. Pero `PositionedRack` —en pixeles— es el tipo que ya entienden el editor
 * 2D, el visor 3D y el inspector; tener DOS tipos de rack colocado, uno en metros
 * para leer y otro en pixeles para editar, seria dos versiones de cada componente
 * que los dibuja. La conversion es exacta en ambos sentidos: es multiplicar por la
 * escala, que viaja con el layout.
 */
export function aLayoutPublicado(d: PublishedLayoutDto): LayoutPublicado {
  if (!d.layout) return VACIO;
  const l = d.layout;
  return {
    publicado: true,
    racks: d.placements.map<PositionedRack>((p) => ({
      layoutId: p.id,
      rackCode: p.rack_code,
      x: p.x_m * l.pixels_per_meter + l.origin_x_px,
      y: p.y_m * l.pixels_per_meter + l.origin_y_px,
      width: p.width_m,
      length: p.length_m,
      height: p.height_m,
      rotation: p.rotation_deg,
      locked: p.is_locked,
      ...(p.group_key ? { grupoId: p.group_key } : {}),
      ...(p.facing ? { frente: p.facing } : {}),
      // Viene del backend: por definicion existe como rack del dominio.
      linked: true,
      ...(p.color ? { color: p.color } : {}),
    })),
    ppm: l.pixels_per_meter,
    origen: { x: l.origin_x_px, y: l.origin_y_px },
    calibrado: l.is_calibrated,
    planName: l.plan_name,
    publishedAt: l.published_at,
    updatedAt: l.updated_at,
  };
}

/**
 * El camino de vuelta: layout publicado → borrador que el editor puede abrir.
 *
 * La IMAGEN no vuelve, y no es un olvido: el backend guarda el NOMBRE del archivo
 * del plano, no sus bytes. Subir imagenes es otro problema —almacenamiento, tipos
 * MIME, tamaño— y meterlo aqui habria retrasado poder guardar las posiciones, que
 * es lo unico irreemplazable. Al abrir un layout publicado el editor pide el
 * archivo y lo compara por nombre: `plan_name` existe precisamente para eso.
 *
 * @param anterior Borrador local, si lo hay. Se usa para conservar la imagen y
 *   las capas, que son del operador y no viajan.
 */
export function publicadoABorrador(
  publicado: PublishedLayoutDto,
  warehouseId: string,
  anterior: LayoutDraft | null,
): LayoutDraft | null {
  if (!publicado.layout) return null;
  const l = publicado.layout;
  const ppm = l.pixels_per_meter;

  const racks: PositionedRack[] = publicado.placements.map((p) => ({
    layoutId: p.id,
    rackCode: p.rack_code,
    x: p.x_m * ppm + l.origin_x_px,
    y: p.y_m * ppm + l.origin_y_px,
    width: p.width_m,
    length: p.length_m,
    height: p.height_m,
    rotation: p.rotation_deg,
    locked: p.is_locked,
    ...(p.group_key ? { grupoId: p.group_key } : {}),
    ...(p.facing ? { frente: p.facing } : {}),
    // Viene del backend: por definicion existe como rack del dominio.
    linked: true,
    color: p.color ?? COLOR_RACK_POR_DEFECTO,
  }));

  const base = anterior;
  return {
    version: 1,
    warehouseId,
    updatedAt: l.updated_at,
    // La imagen es del navegador. Si este operador la tenia cargada se conserva;
    // si no, el editor pedira el archivo cuyo nombre dice `plan_name`.
    plan: base?.plan ?? null,
    planPersistence:
      base?.planPersistence ?? {
        metadataStored: false,
        imageStored: false,
        imageStorage: 'not-stored',
        storageError: null,
      },
    calibration: {
      pixelsPerMeter: ppm,
      // El backend guarda la ESCALA, no los dos puntos con los que se midio: son
      // el procedimiento, no el resultado. Se conservan los puntos locales si
      // este operador fue quien calibro; para el resto quedan en null.
      points: l.is_calibrated ? (base?.calibration.points ?? null) : null,
      // Y por eso existe `measured`: sin el, abrir en OTRO navegador un layout
      // calibrado se veria como «sin calibrar» —no hay puntos que copiar— y la UI
      // avisaria de un problema que no existe. `measured` afirma lo que de verdad
      // importa: que esta escala se midio, la mida quien la midiese.
      measured: l.is_calibrated,
    },
    reference: {
      origin: { x: l.origin_x_px, y: l.origin_y_px },
      rotation: base?.reference.rotation ?? 0,
      unit: base?.reference.unit ?? 'meters',
    },
    racks,
    layers: base?.layers ?? DEFAULT_EDITOR_LAYERS,
    visualMode: base?.visualMode ?? 'technical',
    viewDimension: base?.viewDimension ?? '2d',
  };
}
