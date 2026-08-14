/**
 * CAPA DE INSPECCION — el contrato, sin datos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE ES Y QUE NO ES
 *
 * Este archivo define la TERCERA dimension de estado de una ubicacion, que no
 * sustituye a ninguna de las dos que ya existen:
 *
 *   A · estado ESPACIAL      `available` | `blocked`   — del catalogo, cerrado
 *   B · situacion del WMS    `DISP`, `OCUP`, …          — del archivo, con fecha
 *   C · estado de INSPECCION  este archivo              — de la lectura fisica
 *
 * Las tres pueden discrepar, y ahi esta el valor: el WMS dice que hay un pallet,
 * el catalogo dice que la ubicacion es utilizable, y el dron dice que esta vacia.
 * Colapsarlas en un solo campo destruiria justo la informacion que hace falta.
 *
 * ⚠ NO HAY DATOS DE ESTA CAPA TODAVIA, y este archivo no los inventa. No exporta
 *   fixtures, no exporta valores por omision distintos de `null`, y ningun
 *   componente conectado al backend debe fabricarlos. Existe para que el visor
 *   del rack se escriba UNA vez con el hueco previsto, en lugar de reescribirse
 *   cuando lleguen las lecturas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Resultado de comparar lo que el WMS espera con lo que la camara observo.
 *
 * El orden de la union no es alfabetico: va de «no se sabe» a «se sabe y esta
 * bien» pasando por los modos de fallo, porque es el orden en que un operador
 * los lee.
 */
export type InspectionStatus =
  // ── Sin lectura ───────────────────────────────────────────────────────────
  /** La ubicacion aun no fue leida. Estado inicial de todas. */
  | 'not_scanned'
  /** Camara o dron procesando en este momento. */
  | 'scanning'
  // ── Lectura conforme ──────────────────────────────────────────────────────
  /** Ubicacion y pallet coinciden con el WMS. */
  | 'verified_match'
  /** Observada vacia, y el WMS tambien la esperaba vacia. */
  | 'verified_empty'
  // ── Discrepancias ─────────────────────────────────────────────────────────
  /** El WMS esperaba un pallet y la ubicacion esta vacia. */
  | 'unexpected_empty'
  /** Se observo un pallet distinto del esperado. */
  | 'unexpected_pallet'
  /** Hay un objeto, pero su QR no se pudo leer. */
  | 'pallet_without_qr'
  /** El QR de la ubicacion no se pudo confirmar: no se sabe que se esta mirando. */
  | 'location_qr_unreadable'
  /** El mismo pallet aparecio en mas de una ubicacion. */
  | 'duplicate_pallet'
  // ── Lectura no concluyente ────────────────────────────────────────────────
  /** Sin visibilidad suficiente. */
  | 'obstructed'
  /** Lectura posible pero por debajo del umbral de confianza. */
  | 'low_confidence'
  // ── Intervencion humana ───────────────────────────────────────────────────
  /** Requiere validacion de una persona. */
  | 'manual_review'
  /** Una persona confirmo el resultado. */
  | 'confirmed_manual'
  // ── Fallo tecnico ─────────────────────────────────────────────────────────
  /** Fallo de procesamiento. No es un hallazgo sobre el almacen. */
  | 'error';

/**
 * La superposicion que el visor acepta por ubicacion.
 *
 * Es un OVERLAY y no una propiedad de `SpatialLocation` a proposito: la ubicacion
 * es estructura permanente y esto es el resultado de UNA sesion de inspeccion.
 * Mezclarlos obligaria a reescribir la ubicacion en cada lectura.
 */
export interface LocationInspectionOverlay {
  locationId: string;
  /**
   * Del snapshot del WMS. `null` cuando el WMS no espera nada O cuando espera VARIAS
   * lineas: con dos codigos declarados no hay «el esperado», y elegir uno mentiria.
   * Para eso esta `expectedPalletCodes`, que es la lista completa.
   */
  expectedPalletCode: string | null;
  /**
   * TODOS los codigos que el WMS declara en ese hueco.
   *
   * Existe porque el caso de varias lineas no es raro: en el primer recorrido que se
   * miro, `RCL47-C018-N01-2` declaraba dos —22O0006887184 y 22O0014440164— y la camara
   * leyo un tercero. Con solo `expectedPalletCode` eso se ensena como «esperado: —»,
   * que es justo lo contrario de lo que pasa.
   */
  expectedPalletCodes: string[];
  /** Leido por la camara. `null` cuando no se leyo o no habia. */
  observedPalletCode: string | null;
  inspectionStatus: InspectionStatus;
  /** 0..1. `null` cuando no aplica —por ejemplo en `not_scanned`—. */
  confidence: number | null;
  capturedAt: string | null;
  /** De que recorrido viene esta lectura. Permite abrir la reconciliacion completa. */
  scanId: string | null;

  /** Milisegundo del video del que salio. Permite saltar el material justo ahi. */
  frameMs: number | null;

  /**
   * LA PRUEBA VISUAL: los tres recortes, uno por eje.
   *
   * Son las imagenes de las TRES detecciones que esta lectura uso para decidir —la
   * etiqueta del hueco, lo que hay dentro, la etiqueta del pallet—, no unas parecidas del
   * mismo sitio. Eso es lo que las hace prueba: si la lectura dice un pallet y la imagen
   * ensena otra etiqueta, el fallo se ve sin volver al video.
   *
   * URLs firmadas de una hora. `null` cuando el analisis es anterior a 0091, cuando la
   * casilla de guardar fotogramas estaba apagada, o cuando el objeto ya no esta.
   */
  cropLocationUrl: string | null;
  cropContentUrl: string | null;
  cropPalletUrl: string | null;
}

/** Overlay por `locationId`. El visor lo recibe opcionalmente. */
export type InspectionOverlayMap = Readonly<Record<string, LocationInspectionOverlay>>;

/**
 * Etiqueta y color de cada estado, para la leyenda y para las celdas.
 *
 * Los colores siguen la paleta del sistema de diseño y NO se eligen por gusto: el
 * verde es conformidad, el rojo discrepancia dura, el ambar «hay que mirarlo», el
 * gris ausencia de dato. `pulse` marca los estados en los que la celda debe
 * animarse, y solo dos lo tienen — la animacion esta ligada a un evento real, no
 * es decoracion.
 */
export const INSPECTION_META: Record<
  InspectionStatus,
  { label: string; color: string; description: string; pulse?: boolean }
> = {
  not_scanned: {
    label: 'Sin leer',
    color: 'var(--text-faint)',
    description: 'La ubicacion aun no fue inspeccionada.',
  },
  scanning: {
    label: 'Leyendo',
    color: 'var(--aqua-400)',
    description: 'La camara o el dron esta procesando esta ubicacion.',
    pulse: true,
  },
  verified_match: {
    label: 'Coincide',
    color: 'var(--mint-400)',
    description: 'El pallet observado es el que el WMS esperaba.',
  },
  verified_empty: {
    label: 'Vacia confirmada',
    color: 'var(--iris-400)',
    description: 'Observada vacia, y el WMS tambien la esperaba vacia.',
  },
  unexpected_empty: {
    label: 'Vacia inesperada',
    color: 'var(--crimson-400)',
    description: 'El WMS esperaba un pallet y no hay ninguno.',
  },
  unexpected_pallet: {
    label: 'Pallet incorrecto',
    color: 'var(--crimson-400)',
    description: 'El pallet observado no es el esperado.',
  },
  pallet_without_qr: {
    label: 'Pallet sin QR',
    color: 'var(--ember-400)',
    description: 'Hay un objeto, pero su codigo no se pudo leer.',
  },
  location_qr_unreadable: {
    label: 'Ubicacion no confirmada',
    color: 'var(--ember-400)',
    description: 'No se pudo leer el QR de la ubicacion: la lectura no es atribuible.',
  },
  duplicate_pallet: {
    label: 'Pallet duplicado',
    color: 'var(--crimson-400)',
    description: 'El mismo pallet se observo en mas de una ubicacion.',
  },
  obstructed: {
    label: 'Obstruida',
    color: 'var(--text-muted)',
    description: 'Sin visibilidad suficiente para concluir.',
  },
  low_confidence: {
    label: 'Baja confianza',
    color: 'var(--amber-400, var(--ember-400))',
    description: 'Lectura por debajo del umbral. Requiere revision.',
  },
  manual_review: {
    label: 'Revision manual',
    color: 'var(--ember-400)',
    description: 'Necesita que una persona lo valide.',
  },
  confirmed_manual: {
    label: 'Confirmada a mano',
    color: 'var(--violet-400, var(--iris-400))',
    description: 'Una persona confirmo el resultado.',
  },
  error: {
    label: 'Error',
    color: 'var(--state-critical)',
    description: 'Fallo tecnico de procesamiento. No dice nada del almacen.',
  },
};

/** Los estados que cuentan como discrepancia operativa. */
export const DISCREPANCY_STATUSES: readonly InspectionStatus[] = [
  'unexpected_empty',
  'unexpected_pallet',
  'pallet_without_qr',
  'duplicate_pallet',
] as const;


/**
 * CUÁNTO del almacén se ha mirado, y CUÁNDO.
 *
 * ── POR QUÉ ESTE NÚMERO VA DELANTE DE TODO LO DEMÁS ───────────────────────────
 *
 * Porque sin él, «cero discrepancias» significa dos cosas a la vez —«todo cuadra» y «no
 * has mirado»— y son la conclusión contraria. Un mapa con el 99,99 % en gris y un resumen
 * que no lo dice se lee como un almacén sano.
 *
 * La FECHA va con el porcentaje y no aparte: un almacén inspeccionado al 100 % hace tres
 * meses no está inspeccionado, está fotografiado.
 */
export interface InspectionCoverage {
  warehouseId: string;
  /** Huecos del catálogo. */
  locations: number;
  /** De esos, cuántos tienen alguna lectura. */
  inspected: number;
  racksTotal: number;
  racksInspected: number;
  /**
   * Huecos que CONTRADICEN al WMS.
   *
   * Va aparte de `inspected` porque son preguntas distintas: uno dice cuánto se ha mirado y
   * el otro cuánto de lo mirado está mal. Con un solo número, un rack entero inspeccionado
   * y limpio y otro con tres discrepancias se pintarían igual.
   */
  mismatched: number;
  /** El recorrido más reciente que dejó alguna lectura. `null` si no hay ninguno. */
  lastSeenAt: string | null;
  /** Solo los racks CON algo visto. Los demás son la resta. */
  racks: {
    rackId: string;
    rackCode: string;
    locations: number;
    inspected: number;
    mismatched: number;
    lastSeenAt: string | null;
  }[];
}


/** Los cuatro veredictos de comparar dos recorridos. */
export type InspectionVerdict =
  | 'resuelto'
  | 'persiste'
  | 'nuevo'
  | 'cambio'
  | 'sin_comprobar';

/**
 * QUÉ CAMBIÓ EN UN HUECO ENTRE LOS DOS ÚLTIMOS RECORRIDOS QUE LO VIERON.
 *
 * ── POR QUÉ ESTO NO ES UN INFORME MÁS ─────────────────────────────────────────
 *
 * «Hay un pallet que el WMS no declara» es un hallazgo. «Sigue ahí tres vuelos después»
 * es otra cosa: dice que nadie lo está arreglando. Y un hueco que discrepaba y ya no
 * discrepa es la prueba barata de que el trabajo sirvió.
 *
 * Sin esto, cada recorrido es una foto suelta y el producto no tiene memoria.
 */
export interface InspectionChange {
  locationId: string;
  locationCode: string | null;
  verdict: InspectionVerdict | string;
  statusNow: string;
  palletNow: string | null;
  seenNow: string;
  statusBefore: string;
  palletBefore: string | null;
  seenBefore: string;
}

/** Cómo se dice cada veredicto, y qué significa. */
export const VERDICT_META: Record<
  InspectionVerdict,
  { label: string; color: string; description: string }
> = {
  resuelto: {
    label: 'Resuelto',
    color: 'var(--mint-400)',
    description: 'Antes no cuadraba y ahora sí. Es la prueba de que el trabajo sirvió.',
  },
  persiste: {
    label: 'Persiste',
    color: 'var(--crimson-400)',
    //  El que nadie mide y el que más dice. Por eso va en rojo y no en ámbar: una
    //  discrepancia que aguanta varios vuelos no es un hallazgo, es un proceso roto.
    description:
      'No cuadraba y sigue igual en el recorrido siguiente. Nadie lo está arreglando.',
  },
  nuevo: {
    label: 'Nuevo',
    color: 'var(--ember-400)',
    description: 'Antes cuadraba y ahora no. Pasó algo desde el vuelo anterior.',
  },
  cambio: {
    label: 'Cambió el pallet',
    color: 'var(--aqua-400)',
    description: 'El pallet observado es otro: se movió mercancía.',
  },
  /**
   * NO CUADRABA, Y EL VUELO SIGUIENTE NO PUDO VERLO.
   *
   * Existe porque sin él esto se daba por «resuelto»: la única señal de que el trabajo
   * sirvió se disparaba justo cuando la cámara falló. Es el mismo principio que la
   * reconciliación aplica separando «no se pudo ver» de «cuadra» — el silencio no es
   * salud—, que aquí faltaba.
   */
  sin_comprobar: {
    label: 'Sin comprobar',
    color: 'var(--text-warn)',
    description:
      'No cuadraba y el recorrido siguiente no pudo leer el hueco. Sigue sin saberse: ' +
      'hay que volver a grabarlo.',
  },
};
