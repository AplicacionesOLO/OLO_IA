/**
 * CONSTANTES MAESTRAS DEL CEDI OLO — metros, radianes, sin three.js.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARCHIVO NO IMPORTA THREE
 *
 * Es la misma razon que `mundo.ts`: lo que hay aqui son NUMEROS —medidas del sitio y la
 * conversion entre el marco logico del simulador y el dominio de OLO_IA— y los numeros se
 * prueban sin abrir una tarjeta grafica. `vitest` no tiene WebGL; una medida que solo se
 * puede comprobar mirando la pantalla es como estuvo semanas un eje girado 90°.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LOS TRES MARCOS, Y POR QUE HAY QUE TENERLOS CLAROS
 *
 *   LOGICO   el del simulador. `x` norte→sur a lo largo de la pared de andenes, `z` frente
 *            (−) → atras (+), `y` arriba. Es el marco en el que estan escritas TODAS las
 *            medidas de `GEMELO_CEDI_OLO.md`, porque copiar las piezas asimetricas de otro
 *            modo obligaria a reflejarlas a mano.
 *   MUNDO    three.js. El grupo raiz del CEDI lleva `scale(-1, 1, 1)`, asi que un punto
 *            logico `(xL, y, zL)` cae en three en `(−xL, y, zL)`. El espejo pone la entrada
 *            y la casetilla de despacho a la izquierda, como en el sitio real.
 *   DOMINIO  el de OLO_IA: `dominio.x → three.x`, `dominio.y → three.z`. Es donde viven los
 *            racks del catalogo, que el editor coloca contra el plano. Van FUERA del grupo
 *            reflejado porque ya vienen en el dominio.
 *
 * `logicoADominio` / `dominioALogico` son la bisagra entre el marco logico (este documento)
 * y el dominio (el catalogo), y por eso se prueban: el signo es exactamente lo que se
 * equivoca, y un rack del catalogo y el mismo rack del anexo B tienen que caer en el mismo
 * sitio.
 */

/** Reflejo en x del grupo raiz. −1 = entrada a la izquierda vista desde el frente. */
export const MIRROR_X = -1;

// ── Pared de andenes y puertas ────────────────────────────────────────────────

/** Entre centros de puertas de anden. */
export const DOCK_SPACING = 4.6;
/** Fondo del edificio: frente → pared de andenes. */
export const BUILDING_DEPTH = 89;
/** Alto del almacen. El 3.er piso de oficinas entra sobre el bloque interior. */
export const BUILDING_HEIGHT = 14;
/** Losa interior, a la altura de la plataforma de un remolque. */
export const FLOOR_Y = 1.2;
/** Vano de la puerta de anden: `DOCK_SPACING − 1.2`. */
export const DOOR_WIDTH = DOCK_SPACING - 1.2;
/** Puerta de anden: de y 1.2 a 4.8. */
export const DOOR_HEIGHT = 3.6;
export const CANOPY_DEPTH = 6;

// ── Camiones y patio trasero ──────────────────────────────────────────────────

export const TRUCK_LENGTH = 17;
/** Centro de un camion acoplado: `0.6 + 17/2`. */
export const DOCKED_Z = 0.6 + TRUCK_LENGTH / 2;
/** Plataforma de concreto detras de los andenes. */
export const APRON_DEPTH = 24;
export const ROAD_Z = 28;
export const ROAD_WIDTH = 9;
/** Franja de pilas de tarimas. */
export const PALLET_Z0 = ROAD_Z + ROAD_WIDTH / 2 + 1;
/** Cerca trasera (malla). */
export const FENCE_Z = PALLET_Z0 + 7;

// ── Frente: parqueo, bulevar, vecinos ─────────────────────────────────────────

export const FRONT_Z = -BUILDING_DEPTH;
export const CARPARK_DEPTH = 16;
export const BLVD_Z = FRONT_Z - CARPARK_DEPTH - 7;
export const BLVD_WIDTH = 11;
/** Fachada del almacen vecino (fachada negra). */
export const NEIGHBOR_Z1 = BLVD_Z - BLVD_WIDTH / 2 - 26;
export const NEIGHBOR_DEPTH = 70;

// ── Recepcion, pasillo transversal y arranque de racks ────────────────────────

/** Zona de recepcion (staging) detras de cada puerta. */
export const STAGING_DEPTH = 20;
/** Pasillo transversal entre recepcion y racks. */
export const CROSS_AISLE_Z = -STAGING_DEPTH - 3;
/** LINEA AMARILLA: donde arrancan las 38 filas de racks. */
export const RACK_Z0 = -STAGING_DEPTH - 6.5;

// ── Portones de carga pesada ──────────────────────────────────────────────────

export const HEAVY_GATE_W = 6;
export const HEAVY_GATE_H = 4.2;
/** De la pared norte al centro del anden 02: un anden y medio (con un escritorio). */
export const PHYS_NORTH_GAP = DOCK_SPACING * 1.5;
/** Arco detector y guarda junto a la pared norte, antes del porton. */
export const NORTH_GUARD_D = 3.4;
/** Porton norte: `RACK_Z0 + 3.4 + 3`. */
export const HEAVY_GATE_Z = RACK_Z0 + NORTH_GUARD_D + HEAVY_GATE_W / 2;
/** De la esquina sur al porton de Zona Franca. */
export const SOUTH_GATE_CORNER = 1.5;

// ── Edificio de oficinas (3 pisos, contra la fachada) ─────────────────────────

export const OFFICE_W = 28;
export const OFFICE_DEPTH = 20;
/** Cara de la fachada del edificio de oficinas: sobresale 1 m del almacen. */
export const OFFICE_FACE_Z = FRONT_Z - 1;
/** Cara de su pared del fondo, dentro de la bodega. */
export const OFFICE_BACK_Z = OFFICE_FACE_Z + OFFICE_DEPTH;
/** Columnas de Oficinas / Comedor del mapa, desde la fachada. */
export const OFFICE_COLS = 6;

// ── Mezzanine ─────────────────────────────────────────────────────────────────

/** Losas sobre la losa interior. */
export const MEZZ_LEVELS = [4.4, 8.0] as const;
export const MEZZ_WALL_Z = -0.4;
/** La cara del mezzanine queda a ~10 cm del inicio de los racks. */
export const MEZZ_FRONT_Z = RACK_Z0 + 0.1;
/** Mezzanine: del anden fisico 10 al 27. */
export const MEZZ_FROM_PHYS = 10;
export const MEZZ_TO_PHYS = 27;

// ── Andenes fisicos ───────────────────────────────────────────────────────────

/** 37 puertas fisicas, numeradas del 02 (esquina norte) al 38 (esquina sur, Zona Franca). */
export const PHYS_FIRST = 2;
export const PHYS_LAST = 38;
export const PHYS_COUNT = PHYS_LAST - PHYS_FIRST + 1;

// ── Patio de espera y accesos (lado oeste / este) ─────────────────────────────

const YARD_WIDTH = 46;
const EAST_ROAD_GAP = 14;

// ── Valores derivados (§2.1 del documento) ────────────────────────────────────

/**
 * Largo total de la pared de andenes, con numeracion fisica.
 *
 *   6.9 + 36·4.6 + 2.3 + 1.2 + 6 + 1.5 = 183.5
 *   (PHYS_NORTH_GAP + (PHYS_COUNT−1)·DOCK_SPACING + DOCK_SPACING/2 + 1.2 + HEAVY_GATE_W + SOUTH_GATE_CORNER)
 */
export const LENGTH =
  PHYS_NORTH_GAP +
  (PHYS_COUNT - 1) * DOCK_SPACING +
  DOCK_SPACING / 2 +
  1.2 +
  HEAVY_GATE_W +
  SOUTH_GATE_CORNER;

/** Pared norte (lado Recepcion / porton norte). */
export const X_WEST = -LENGTH / 2;
/** Pared sur (Zona Franca). */
export const X_EAST = LENGTH / 2;

/** Calle del patio de espera (norte–sur, lado oeste). */
export const YARD_ROAD_X = X_WEST - 27;
/** Fila de espera junto al talud. */
export const WAIT_X = X_WEST - 40;
/** Pie del talud. */
export const EMBANKMENT_X = X_WEST - YARD_WIDTH;
/** Aguja de la casetilla de despacho. */
export const DESPACHO_GATE_Z = FRONT_Z - 6;
/** Aguja principal. */
export const MAIN_GATE_X = EMBANKMENT_X - 30;
/** Calle publica. */
export const STREET_X = MAIN_GATE_X - 30;
/** Calle de salida y retorno (lado este). */
export const EAST_ROAD_X = X_EAST + EAST_ROAD_GAP;

/**
 * x logico del centro de la puerta fisica `p`.
 *
 *   physX(2)  = −84.85
 *   physX(38) =  80.75
 */
export const physX = (p: number): number => X_WEST + PHYS_NORTH_GAP + (p - PHYS_FIRST) * DOCK_SPACING;

/** Nombre del anden del sistema para una puerta fisica (`0101` = fisico 02). ⚠ provisional. */
export const systemOfPhys = (phys: number): string => `01${String(phys - 1).padStart(2, '0')}`;

/** Puerta fisica de un nombre del sistema, o `null` si no sigue la numeracion `01xx`. */
export const physOfSystem = (name: string): number | null => {
  const m = /^01(\d\d)$/.exec(name.trim());
  return m ? Number(m[1]) + 1 : null;
};

// ── Conversion entre marcos ───────────────────────────────────────────────────

/**
 * Punto logico → dominio de OLO_IA. Con el espejo, `x mundo = −x logico`; `z` y `y` no
 * cambian, y en el dominio `z logico` es `y`.
 */
export const logicoADominio = (xL: number, zL: number): { x: number; y: number } => ({
  x: -xL,
  y: zL,
});

/** Dominio de OLO_IA → punto logico. La inversa exacta. */
export const dominioALogico = (x: number, y: number): { xL: number; zL: number } => ({
  xL: -x,
  zL: y,
});

/**
 * Rumbo logico θ (0 = mirando a +z, el giro de three) → grados de rotacion del dominio.
 *
 * El signo ya lo invierten el espejo y la convencion `−rad` de `mundo.ts`, asi que aqui es
 * una conversion directa de radianes a grados.
 */
export const rumboLogicoADominioGrados = (theta: number): number => (theta * 180) / Math.PI;
