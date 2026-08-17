/**
 * LOS TIPOS DE UN RECORRIDO.
 *
 * Separados del cálculo (`recorrido.ts`) porque el cálculo no necesita saber de dónde
 * vienen los datos, y separados de los DTO porque un DTO es la forma en la que viajan por
 * la red — con sus `snake_case` y sus nulos— y no la forma en la que se piensan.
 */

/** Qué se hace en una parada. La MISMA lista que el `CHECK` de 0094. */
export const OPERACIONES = [
  'salida',
  'recoger',
  'dejar',
  'revisar',
  'pasar',
  'vuelta',
] as const;

export type Operacion = (typeof OPERACIONES)[number];

/** Cómo se llama cada operación en pantalla. */
export const NOMBRE_DE_OPERACION: Record<Operacion, string> = {
  salida: 'salir',
  recoger: 'recoger',
  dejar: 'dejar',
  revisar: 'revisar',
  pasar: 'pasar',
  vuelta: 'volver',
};

/**
 * Segundos que suele costar cada operación. Solo para PROPONER al añadir una parada.
 *
 * No es una medida de nada: es un punto de partida para no obligar a teclear un número desde
 * cero. Quien mide su almacén los corrige, y entonces el total significa algo.
 */
export const SEGUNDOS_TIPICOS: Record<Operacion, number> = {
  salida: 30,
  recoger: 20,
  dejar: 15,
  revisar: 10,
  pasar: 0,
  vuelta: 30,
};

/** Velocidades de partida, en m/s. Se pueden cambiar por recorrido. */
export const VELOCIDADES = [
  { etiqueta: 'a pie, cargando', mps: 1.2 },
  { etiqueta: 'a pie, sin carga', mps: 1.4 },
  { etiqueta: 'transpaleta', mps: 1.8 },
  { etiqueta: 'montacargas', mps: 2.5 },
  { etiqueta: 'dron', mps: 3.0 },
] as const;

/** Una parada tal como llega de la API, con la estructura de su hueco. */
export interface ParadaDeRecorrido {
  id: string;
  tripId: string;
  seq: number;
  operation: string;
  dwellS: number;
  locationId: string;
  locationCode: string | null;
  /**
   * El RACK del hueco. `null` cuando la ubicación no cuelga de ninguno.
   *
   * Es lo que permite situar la parada en metros. Sin él, la simulación la salta —y lo dice—
   * en vez de inventarle una posición.
   */
  rackNodeId: string | null;
  bayIndex: number | null;
  level: number | null;
  position: number | null;
}

export interface Recorrido {
  id: string;
  warehouseId: string;
  name: string;
  modelId: string | null;
  /** Metros por segundo. De aquí sale el tiempo, no de duraciones tecleadas. */
  speedMps: number;
  notes: string | null;
  stops: ParadaDeRecorrido[];
  updatedAt: string;
}

/** Lo que la lista necesita sin traerse las paradas. */
export interface RecorridoResumen {
  id: string;
  warehouseId: string;
  name: string;
  modelId: string | null;
  speedMps: number;
  notes: string | null;
  /** Distingue un recorrido a medio escribir de uno completo sin abrirlo. */
  stopCount: number;
  updatedAt: string;
}

/** Una parada que se va a guardar. Sin `seq`: lo pone el servidor por la posición. */
export interface ParadaNueva {
  locationId: string;
  operation: Operacion;
  dwellS: number;
}
