/**
 * TIPOS DE VISTA — sin dependencia de ningun componente.
 *
 * Vivian dentro de `components/SpatialToolbar.tsx` y `components/LayerPanel.tsx`,
 * asi que el store del workspace importaba de un componente para tipar su estado.
 * Eso ataba el estado a la existencia de esos dos archivos: al eliminar los
 * componentes que mostraban el modelo inventado, el store dejaba de compilar por
 * un tipo que no tiene nada que ver con ellos.
 */

/**
 * Vistas del explorador. Las tres COEXISTEN: ninguna sustituye a otra.
 *
 *   `grid`  tabla — busqueda, filtros, auditoria, revision masiva
 *   `rack`  rack tridimensional — cuerpos, niveles, posiciones, seleccion
 *   `plan`  plano del almacen — situar cada rack en su sitio global
 *
 * `rack` es la vista OPERACIONAL: es donde las lecturas del dron se veran. La
 * tabla es administrativa. Haberla dejado como unica vista fue un error: dibujar
 * la geometria INTERNA del rack —cuerpo, nivel, posicion— no necesita coordenadas
 * metricas, y esas coordenadas ya estan en los datos.
 *
 * `plan` si necesita geometria global (`world_position`, al 100% NULL) o un layout
 * local, y por eso puede estar vacia — pero vacia con su motivo, no ausente.
 */
export type SpatialViewMode = 'grid' | 'rack' | 'plan';

/**
 * Capa de color de la vista del rack. Son TRES dimensiones independientes de la
 * misma ubicacion, y pueden discrepar entre si:
 *
 *   `spatial`     `available` | `blocked`  — del catalogo, vocabulario cerrado
 *   `wms`         `DISP`, `OCUP`, …        — del archivo importado, con fecha
 *   `inspection`  lectura del dron         — todavia sin datos
 *
 * Se eligen, no se superponen: mezclar dos codificaciones de color en la misma
 * celda hace ilegibles las 2.365 ubicaciones donde el catalogo y el WMS se
 * contradicen.
 */
export type VisualLayer = 'spatial' | 'wms' | 'inspection';

/**
 * Capas por estado del espacio.
 *
 * Tenia SEIS claves —`occupied`, `inferred`, `invalid`, `reserved`— de las que
 * cuatro no existen en el vocabulario real. El estado del espacio tiene dos
 * valores, y las capas solo pueden tener esos dos.
 */
export interface LayerConfig {
  available: boolean;
  blocked: boolean;
}

export const DEFAULT_LAYERS: LayerConfig = {
  available: true,
  blocked: true,
};
