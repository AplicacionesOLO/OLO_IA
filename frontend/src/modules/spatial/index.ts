/**
 * API PUBLICA DEL MODULO SPATIAL.
 *
 * Se exporta lo que otros modulos pueden necesitar, no todo lo que existe. Los
 * componentes internos se importan por su ruta: un barrel que reexporta todo
 * convierte cualquier cambio interno en un cambio de API.
 */

export { SpatialExplorerPage } from './pages/SpatialExplorerPage';
export {
  SpatialProvider,
  useSpatialRepo,
  useLayoutRepo,
  useSpatialCapabilities,
} from './services/SpatialProvider';
export {
  SPATIAL_CAPABILITIES,
  resolveCapabilities,
  type SpatialCapabilities,
} from './capabilities';
export type {
  CapacityState,
  CodeForm,
  FloorPlanCell,
  LocationCapacity,
  LocationFilter,
  LocationOrigin,
  LocationStatus,
  NodeType,
  Paginated,
  RackFrontCell,
  RackFrontView,
  SpatialLocation,
  SpatialNode,
  SpatialSummary,
  WarehouseOption,
  WmsSituation,
} from './types/index';
