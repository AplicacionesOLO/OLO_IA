/**
 * SPATIAL EXPLORER — conectado al backend real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO SE ALIMENTA CADA PANEL
 *
 *   selector      → useWarehouses()       GET /spatial/warehouses
 *   KPIs          → useSpatialSummary()   GET .../summary
 *   arbol         → useTreeRoots()        GET .../tree?depth=0
 *                   + useNodeChildren()   GET /nodes/{id}/children  (por rama)
 *   tabla         → useLocations()        GET /spatial/locations
 *   inspector     → useLocationDetail()   GET /spatial/locations/{id}
 *   alzado        → useRackFrontView()    GET /racks/{id}/front-view
 *   plano         → layout LOCAL          localStorage, no el backend
 *
 * No hay una query universal. Cada read model es independiente, y por eso un fallo
 * en el alzado no apaga el arbol.
 *
 * ── LO QUE NO SE DIBUJA, Y POR QUE ──────────────────────────────────────────
 *
 * · Ocupacion EN VIVO: `capabilities.liveOccupancy === false`. La ocupacion en si
 *   SI se dibuja desde 0068 —el panel la da y el visor 3D colorea con ella— pero
 *   sale de una FOTO FECHADA del WMS, no del momento. La distincion es la que
 *   evita que alguien mande a un operario a un hueco que se lleno ayer.
 *
 *   Sigue siendo del inventario y no del estante (SPA-11): por eso vive en su
 *   propio esquema, se DERIVA de las lineas de stock, y este modulo la pide en vez
 *   de guardarla.
 *
 * · Plano a escala: `capabilities.floorGeometry === false` porque `world_position`
 *   esta al 100% NULL. El plano visual lo aporta el layout local; si no hay
 *   layout, se dice.
 *
 * ── LAS TRES VISTAS COEXISTEN ───────────────────────────────────────────────
 *
 *   Tabla    administrativa: buscar, filtrar, auditar, revisar en masa
 *   Rack 3D  OPERACIONAL: es donde se veran las lecturas del dron
 *   Plano    situar cada rack en el almacen — necesita layout o CAD
 *
 * La geometria INTERNA del rack (cuerpo, nivel, posicion) ya esta en los datos y
 * basta para dibujarlo. Tratar la falta de coordenadas metricas GLOBALES como
 * impedimento para dibujar un rack fue un error: son dos geometrias distintas y
 * solo falta la segunda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Layers, Map as MapIcon } from 'lucide-react';

import { useSessionStore } from '../../../auth/sessionStore';
import { cn } from '../../../design/utils/cn';
import { Panel } from '../../../design/foundation/Panel';
import {
  BotonExpandir,
  CLASES_EXPANDIDO,
  useExpansion,
} from '../../../design/foundation/Expandible';
import { CanvasHost } from '../../../shell/CanvasHost';

import { SpatialFilters, type FiltersValue } from '../components/SpatialFilters';
import { SpatialKpis } from '../components/SpatialKpis';
import { SpatialTree, groupByFamily } from '../components/SpatialTree';
import { LocationTable } from '../components/LocationTable';
import { LocationDetail } from '../components/LocationDetail';
import { InspectionChanges } from '../components/InspectionChanges';
import { SelectionReadout } from '../components/SelectionReadout';
import { LayoutStatusPanel } from '../components/LayoutStatusPanel';
import { Cluster3DView, prepararRutas, ReproductorRutas } from '../cluster3d/index';
import type { RutaPreparada } from '../cluster3d/index';
import { PanelFlota } from '../components/PanelFlota';
import { PanelOcupacion } from '../components/PanelOcupacion';
import { RackFrontView } from '../components/RackFrontView';
import { Rack3DView } from '../rack3d/Rack3DView';
import { QueryError, SpatialError } from '../components/errors/SpatialError';
import { WarehousePicker, useResolvedWarehouse } from '../components/WarehousePicker';
import {
  InspectionLegend,
  VisualLayerPicker,
  StatusLegend,
  WmsSituationLegend,
} from '../components/StatusLegend';
import {
  CommandPalette,
  QuickActions,
  WorkspaceLayout,
} from '../components/workspace/index';

import { SPATIAL_CONFIG } from '../config';
import {
  useFloorPlanCompleto,
  useLayoutPublicado,
  useLocationDetail,
  useCambiosInspeccion,
  useCoberturaInspeccion,
  useInspeccion,
  useOcupacionPorRack,
  useRutas,
  useLocations,
  useRackFrontView,
  useSpatialSummary,
  useTreeRoots,
  useWarehouses,
} from '../services/useSpatial';
import { useLayoutRepo, useSpatialCapabilities } from '../services/SpatialProvider';
import type { InspectionOverlayMap } from '../inspection';
import type { InspeccionDeRack } from '../cluster3d/escena';
import type { LayoutStatus } from '../repositories/LayoutRepository';
import type { LayoutPublicado } from '../repositories/publicacion';
import type {
  FloorPlanCell,
  LocationFilter,
  RackFrontCell,
  SpatialLocation,
  SpatialNode,
} from '../types/index';
import type { SpatialViewMode, VisualLayer } from '../viewTypes';
import { useWorkspaceStore } from '../workspace/store';
import { useShortcuts, type ShortcutHandlers } from '../workspace/useShortcuts';
import { useRegisterCommands } from '../workspace/useCommands';
import type { Command } from '../workspace/commands';

export function SpatialExplorerPage() {
  const persistedWarehouseId = useSessionStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useSessionStore((s) => s.setActiveWarehouse);
  const caps = useSpatialCapabilities();
  const layoutRepo = useLayoutRepo();
  const ws = useWorkspaceStore();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // ═══ ALMACEN ══════════════════════════════════════════════════════════════
  const warehouses = useWarehouses();

  // Resuelve la seleccion persistida contra la lista real. Devuelve `null`
  // mientras carga o si el almacen guardado ya no es accesible, para que ninguna
  // consulta salga con un id que produciria 404.
  const warehouseId = useResolvedWarehouse(
    warehouses.data,
    persistedWarehouseId,
    setActiveWarehouse,
  );

  const nav = ws.navOf(warehouseId);

  // El layout es LOCAL: `localStorage`, sin red y sin query. Se lee en cada
  // render porque leerlo cuesta un `getItem` y no una peticion, y asi refleja al
  // instante lo que el editor acabe de guardar.
  const layoutStatus = layoutRepo.getStatus(warehouseId ?? '');


  // ═══ QUERIES ══════════════════════════════════════════════════════════════
  const summary = useSpatialSummary(caps.summary ? warehouseId : null);
  const roots = useTreeRoots(caps.tree ? warehouseId : null);

  const filtro: LocationFilter = useMemo(
    () => ({
      warehouseId,
      ...(nav.activeRackId ? { rackId: nav.activeRackId } : {}),
      ...(ws.statusFilter ? { status: ws.statusFilter } : {}),
      ...(ws.situationFilter ? { situation: ws.situationFilter } : {}),
      ...(ws.codeFormFilter ? { codeForm: ws.codeFormFilter } : {}),
      ...(ws.levelFilter != null ? { level: ws.levelFilter } : {}),
      ...(ws.search ? { search: ws.search } : {}),
      pageSize: SPATIAL_CONFIG.defaultPageSize,
      page: ws.page,
      withTotal: ws.withTotal,
    }),
    [
      warehouseId,
      nav.activeRackId,
      ws.statusFilter,
      ws.situationFilter,
      ws.codeFormFilter,
      ws.levelFilter,
      ws.search,
      ws.page,
      ws.withTotal,
    ],
  );

  const locations = useLocations(caps.locations ? filtro : { ...filtro, warehouseId: null });
  const detail = useLocationDetail(caps.locationDetail ? nav.selectedLocationId : null);
  const rackView = useRackFrontView(
    caps.rackFront && ws.viewMode === 'rack' ? nav.activeRackId : null,
  );

  // El layout PUBLICADO, no el borrador local: aqui mira todo el equipo, y el
  // borrador es de quien tenga el editor abierto. Solo se pide con la vista del
  // plano visible —347 colocaciones no hacen falta para la tabla— y el catalogo
  // completo tambien, porque de ahi salen cuerpos y niveles de cada rack.
  const enPlano = ws.viewMode === 'plan';
  const layoutPublicado = useLayoutPublicado(enPlano ? warehouseId : null);
  const catalogoCompleto = useFloorPlanCompleto(enPlano ? warehouseId : null);

  // ═══ FLOTA ════════════════════════════════════════════════════════════════
  // Las rutas derivadas de las observaciones. Se preparan aqui —y no dentro del
  // visor— porque el COLOR de cada fuente tiene que ser el mismo en el lienzo, en el
  // reproductor y en el panel: si cada uno lo eligiera, la linea ambar del mapa seria
  // la fila rosa de la lista.
  // Ocupacion por rack: es lo que colorea el cluster 3D por «ocupacion». Se pide solo
  // con la vista del plano abierta —347 filas no hacen falta para la tabla— y se indexa
  // por UUID porque el codigo del rack es unico por almacen, no globalmente.
  const ocupacionConsulta = useOcupacionPorRack(enPlano ? warehouseId : null);
  const ocupacionPorRack = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of ocupacionConsulta.data?.racks ?? []) m.set(r.rack_id, r.occupancy_pct);
    return m;
  }, [ocupacionConsulta.data]);

  const rutasConsulta = useRutas(enPlano ? warehouseId : null);
  const rutas = useMemo(
    () => prepararRutas(rutasConsulta.data?.routes ?? []),
    [rutasConsulta.data],
  );
  /** Instante de la reproduccion. `null` es «ver el recorrido completo». */
  const [instante, setInstante] = useState<number | null>(null);

  // ═══ INSPECCION ═══════════════════════════════════════════════════════════
  //
  // Lo que la camara VIO en cada hueco, que es lo que le faltaba al mapa: hasta ahora
  // esto era `undefined` y una constante `false`, asi que el visor ensenaba el catalogo
  // y la ocupacion DECLARADA, y lo observado se quedaba en una tabla de otra pantalla.
  //
  // Se acota al rack abierto cuando hay uno: mirando UN alzado no hacen falta los huecos
  // del almacen entero. En el plano se piden todos, que es lo que colorea el conjunto.
  //  Cuanto del almacen se ha mirado. Consulta aparte de `useInspeccion` porque agrega
  //  sobre las 29.310 ubicaciones del catalogo y no hace falta repetirla al cambiar de rack.
  const cobertura = useCoberturaInspeccion(warehouseId);
  //  La memoria: que cambio desde el recorrido anterior. Sin acotar a un rack — quien abre
  //  el mapa quiere saber si algo se movio en el almacen, no solo en el alzado que mira.
  const cambios = useCambiosInspeccion(warehouseId);

  //  LO QUE LA CAMARA ENCONTRO, POR RACK. Sale de la misma consulta de cobertura —no anade
  //  ni una peticion— e indexa por `rackId`, que es como el cluster pinta. Es lo que le
  //  faltaba al plano: coloreaba por lo que el WMS DECLARA y lo observado se quedaba en
  //  otras pantallas.
  const inspeccionPorRack = useMemo(() => {
    const m = new Map<string, InspeccionDeRack>();
    for (const r of cobertura.data?.racks ?? []) {
      m.set(r.rackId, {
        huecos: r.locations,
        vistos: r.inspected,
        discrepan: r.mismatched,
        ultima: r.lastSeenAt,
      });
    }
    return m;
  }, [cobertura.data]);
  const inspeccionConsulta = useInspeccion(
    warehouseId,
    ws.viewMode === 'rack' && nav.activeRackId ? nav.activeRackId : undefined,
  );
  const inspectionOverlay = useMemo<InspectionOverlayMap | undefined>(() => {
    const filas = inspeccionConsulta.data;
    if (!filas || filas.length === 0) return undefined;
    const m: Record<string, (typeof filas)[number]> = {};
    for (const f of filas) m[f.locationId] = f;
    return m;
  }, [inspeccionConsulta.data]);

  //  DISPONIBLE ES «HAY LECTURAS», no «el endpoint existe». Un almacen donde todavia no
  //  se ha volado no tiene capa que ensenar, y habilitar el boton para pintarlo todo de
  //  gris «sin leer» seria prometer un dato que no hay.
  const inspectionAvailable = inspectionOverlay !== undefined;

  // ═══ URL ↔ ESTADO ═════════════════════════════════════════════════════════
  //
  // `/spatial?view=rack&rack=<uuid>&location=<uuid>` abre esa vista.
  //
  // ⚠ LA URL SE LEE UNA SOLA VEZ, al montar. Dos efectos sincronizando en las dos
  //   direcciones se pelean: el que escribia lo hacia con el `viewMode` del render
  //   anterior —el `set` del otro no se refleja hasta el siguiente— y volvia a poner
  //   el valor viejo. Medido: la vista quedaba en «Rack 3D» con `?view=grid` en la
  //   barra, y al recargar volvia a la tabla.
  //
  //   Con una lectura unica no hay pelea posible: la URL es el punto de ENTRADA y el
  //   store es la verdad desde ese momento.
  const hidratado = useRef(false);

  useEffect(() => {
    if (hidratado.current || !warehouseId) return;

    const v = searchParams.get('view');
    if (v === 'rack' || v === 'grid' || v === 'plan') ws.setViewMode(v);

    const r = searchParams.get('rack');
    // El rack de la URL se VALIDA contra las raices que el backend acaba de
    // devolver: un UUID de otro almacen —pegado, o guardado antes de perder el
    // acceso— produciria un 404 por cada consulta. Si el arbol no ha cargado, se
    // espera: el efecto vuelve a correr.
    if (r) {
      if (!roots.data) return;
      if (roots.data.some((n) => n.id === r)) ws.setActiveRack(warehouseId, r);
    }

    const loc = searchParams.get('location');
    if (loc) ws.setSelectedLocation(warehouseId, loc);

    hidratado.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, roots.data]);

  // A partir de la hidratacion, el store escribe la URL. `replace` y no `push`:
  // cada clic en una celda no debe convertirse en un paso del boton «atras».
  useEffect(() => {
    if (!hidratado.current || !warehouseId) return;
    const p = new URLSearchParams(searchParams);
    p.set('view', ws.viewMode);
    if (nav.activeRackId) p.set('rack', nav.activeRackId);
    else p.delete('rack');
    if (nav.selectedLocationId) p.set('location', nav.selectedLocationId);
    else p.delete('location');
    if (p.toString() !== searchParams.toString()) setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, ws.viewMode, nav.activeRackId, nav.selectedLocationId]);

  // ═══ HANDLERS ═════════════════════════════════════════════════════════════

  const cambiarAlmacen = useCallback(
    (id: string) => {
      setActiveWarehouse(id || null);
      // La navegacion es POR ALMACEN, asi que no hace falta limpiarla: la del
      // nuevo almacen ya es la suya. Lo que si se reinicia es la pagina, que es
      // un estado global de la tabla.
      ws.setPage(1);
    },
    [setActiveWarehouse, ws],
  );

  const seleccionarNodo = useCallback(
    (node: SpatialNode) => {
      if (!warehouseId) return;
      ws.setSelectedNode(warehouseId, node.id);
      // Un rack o un cuerpo filtran la tabla por si mismos: es lo que el operador
      // espera al pulsar en el arbol.
      if (node.nodeType === 'rack') {
        ws.setActiveRack(warehouseId, node.id);
        ws.setPage(1);
      }
    },
    [warehouseId, ws],
  );

  const abrirAlzado = useCallback(
    (node: SpatialNode) => {
      if (!warehouseId) return;
      // El alzado es de un RACK. Un cuerpo abre el alzado de su rack padre.
      const rackId = node.nodeType === 'bay' ? node.parentId : node.id;
      if (!rackId) return;
      ws.setActiveRack(warehouseId, rackId);
      ws.setViewMode('rack');
    },
    [warehouseId, ws],
  );

  /**
   * Abrir el alzado de un rack a partir de su CODIGO.
   *
   * El cluster referencia racks por codigo porque es lo que lleva la colocacion y
   * lo que el operador lee en el plano. El alzado necesita el uuid: el codigo es
   * unico por almacen, no globalmente, y usarlo como identificador global fue una
   * de las tres rutas que este modulo llego a inventarse.
   */
  const abrirRackPorCodigo = useCallback(
    (rackCode: string) => {
      if (!warehouseId) return;
      const cat = catalogoCompleto.data?.items.find((c) => c.rackCode === rackCode);
      if (!cat) return;
      ws.setActiveRack(warehouseId, cat.rackId);
      ws.setViewMode('rack');
    },
    [warehouseId, ws, catalogoCompleto.data],
  );

  const seleccionarUbicacion = useCallback(
    (loc: SpatialLocation) => {
      if (!warehouseId) return;
      ws.setSelectedLocation(warehouseId, loc.id);
    },
    [warehouseId, ws],
  );

  const seleccionarCelda = useCallback(
    (cell: RackFrontCell) => {
      if (!warehouseId) return;
      ws.setSelectedLocation(warehouseId, cell.locationId);
    },
    [warehouseId, ws],
  );

  const filtros: FiltersValue = {
    search: ws.search,
    status: ws.statusFilter,
    situation: ws.situationFilter,
    codeForm: ws.codeFormFilter,
    level: ws.levelFilter,
    withTotal: ws.withTotal,
  };

  const aplicarFiltros = useCallback(
    (patch: Partial<FiltersValue>) => {
      if ('search' in patch) ws.setSearch(patch.search ?? '');
      if ('status' in patch) ws.setStatusFilter(patch.status);
      if ('situation' in patch) ws.setSituationFilter(patch.situation);
      if ('codeForm' in patch) ws.setCodeFormFilter(patch.codeForm);
      if ('level' in patch) ws.setLevelFilter(patch.level);
      if ('withTotal' in patch) ws.setWithTotal(patch.withTotal ?? false);
    },
    [ws],
  );

  // ═══ ATAJOS ═══════════════════════════════════════════════════════════════

  const shortcutHandlers: ShortcutHandlers = useMemo(
    () => ({
      'command-palette': () => setPaletteOpen(true),
      search: () =>
        document
          .querySelector<HTMLInputElement>('[data-spatial-search] input')
          ?.focus(),
      'view-tree': () => ws.setLeftPanelOpen(!ws.leftPanelOpen),
      'view-canvas': () => ws.setViewMode('grid'),
      'view-inspector': () => ws.setRightPanelOpen(!ws.rightPanelOpen),
      'toggle-layers': () => ws.setRightPanelOpen(!ws.rightPanelOpen),
      'reset-zoom': () => ws.setZoomLevel(100),
      'clear-selection': () => warehouseId && ws.setSelectedLocation(warehouseId, null),
      'view-rack': () => ws.setViewMode('rack'),
      'view-plan': () => ws.setViewMode('plan'),
      'delete-selection': () => warehouseId && ws.setSelectedLocation(warehouseId, null),
      'reset-workspace': () => ws.resetWorkspace(),
      'focus-selection': () => {},
      'fit-all': () => {},
      'select-all': () => {},
    }),
    [ws, warehouseId],
  );

  useShortcuts(shortcutHandlers);

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'search-location',
        label: 'Buscar ubicacion',
        category: 'Navegacion',
        shortcut: 'mod+f',
        execute: () =>
          document.querySelector<HTMLInputElement>('[data-spatial-search] input')?.focus(),
      },
      {
        id: 'filter-available',
        label: 'Solo disponibles',
        category: 'Filtros',
        execute: () => ws.setStatusFilter('available'),
      },
      {
        id: 'filter-blocked',
        label: 'Solo bloqueadas',
        category: 'Filtros',
        execute: () => ws.setStatusFilter('blocked'),
      },
      {
        id: 'filter-clear',
        label: 'Limpiar filtros',
        category: 'Filtros',
        execute: () => ws.clearFilters(),
      },
      {
        id: 'view-table',
        label: 'Vista tabla',
        category: 'Vista',
        execute: () => ws.setViewMode('grid'),
      },
      {
        id: 'view-rack',
        label: 'Vista alzado de rack',
        category: 'Vista',
        execute: () => ws.setViewMode('rack'),
      },
      {
        id: 'toggle-tree',
        label: 'Alternar arbol',
        category: 'Paneles',
        shortcut: 'mod+1',
        execute: () => ws.setLeftPanelOpen(!ws.leftPanelOpen),
      },
      {
        id: 'toggle-inspector',
        label: 'Alternar inspector',
        category: 'Paneles',
        shortcut: 'mod+3',
        execute: () => ws.setRightPanelOpen(!ws.rightPanelOpen),
      },
    ],
    [ws],
  );

  useRegisterCommands(commands);

  // ═══ RENDER ═══════════════════════════════════════════════════════════════

  // El listado de almacenes es la puerta: si falla, no hay nada que explorar y
  // hay que decir POR QUE falla, no mostrar un selector vacio.
  if (warehouses.isError) {
    return (
      <CanvasHost mode="grid">
        <div className="flex flex-col gap-[var(--panel-gap)]">
          <Titulo />
          <QueryError error={warehouses.error} onRetry={() => void warehouses.refetch()} />
        </div>
      </CanvasHost>
    );
  }

  if (!warehouses.isLoading && (warehouses.data?.length ?? 0) === 0) {
    return (
      <CanvasHost mode="grid">
        <div className="flex flex-col gap-[var(--panel-gap)]">
          <Titulo />
          <SpatialError
            kind="no-permission"
            message="No tienes acceso a ningun almacen. Contacta con el administrador de tu organizacion."
          />
        </div>
      </CanvasHost>
    );
  }

  if (!warehouseId) {
    return (
      <CanvasHost mode="grid">
        <div className="flex flex-col gap-[var(--panel-gap)]">
          <Cabecera
            warehouses={warehouses.data ?? []}
            activeId={null}
            onChange={cambiarAlmacen}
            loading={warehouses.isLoading}
          />
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <div className="mx-auto flex flex-col items-center gap-5 py-12">
              <Layers strokeWidth={1.25} className="size-10 text-[var(--icon-accent)]" />
              <p className="text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">
                Selecciona un almacen
              </p>
              <p className="t-body max-w-[42ch] text-[var(--text-secondary)]">
                Elige un almacen para explorar su estructura espacial.
              </p>
            </div>
          </Panel>
        </div>
      </CanvasHost>
    );
  }

  const almacenActivo = warehouses.data?.find((w) => w.id === warehouseId);
  const sinCatalogo = almacenActivo != null && !almacenActivo.hasCatalog;
  const situaciones = Object.keys(summary.data?.wmsSituationCounts ?? {}).filter(
    (s) => s !== '(sin situacion)',
  );

  return (
    <CanvasHost mode="immersive">
      {/*
        ⚠ ALTURA DEFINIDA, y aqui es el unico sitio donde puede estar.

        `CanvasHost` termina en un `min-h-full` y su hijo en `h-full`: un porcentaje
        contra un padre de altura automatica se resuelve a `auto`, asi que TODA la
        cadena era indefinida. Con la cadena indefinida, un `flex-1` mas abajo no
        reparte altura —reparte contenido—, y el visor del rack, cuyo canvas esta
        fuera del flujo, se quedaba en 0 px.

        Fijandola aqui, `min-h-0 flex-1` funciona hasta el lienzo y el rack ocupa
        todo el alto del area de trabajo sin numeros magicos ni `vh` por componente.
        `100dvh` y no `100vh` por la barra de direcciones movil, igual que el shell.
      */}
      <div className="flex h-[calc(100dvh-var(--topbar-height))] flex-col gap-3 px-[var(--canvas-pad-x)] pb-4 pt-2">
        <Cabecera
          warehouses={warehouses.data ?? []}
          activeId={warehouseId}
          onChange={cambiarAlmacen}
          loading={warehouses.isLoading}
        />

        {sinCatalogo ? (
          /*
            ⚠ UN ALMACEN SIN CATALOGO NO PUEDE DEJAR AL OPERADOR SIN SALIDA.

            Antes esto era solo el mensaje de error, y el resultado es que quien
            selecciona WH-002 se queda mirando un aviso sin nada que hacer: el
            selector sigue arriba, pero no dice cuales de los otros 26 almacenes SI
            tienen estructura, y 24 de ellos son residuos de pruebas con el mismo
            nombre. Encontrar el bueno era adivinar.

            Ahora se listan los que tienen catalogo, con su recuento, y se puede
            saltar a uno con un clic.
          */
          <div className="flex flex-col gap-4">
            <SpatialError
              kind="no-catalog"
              message={
                `El almacen ${almacenActivo.code} — ${almacenActivo.name} — existe y es ` +
                'accesible, pero su catalogo espacial no se ha importado todavia. ' +
                'No hay estructura que explorar.'
              }
            />
            <AlmacenesConCatalogo
              warehouses={warehouses.data ?? []}
              activeId={warehouseId}
              onChange={cambiarAlmacen}
            />
          </div>
        ) : (
          <WorkspaceLayout
            className="min-h-0 flex-1"
            leftCollapsed={!ws.leftPanelOpen}
            rightCollapsed={!ws.rightPanelOpen}
            leftWidth={ws.leftPanelWidth}
            rightWidth={ws.rightPanelWidth}
            onToggleLeft={() => ws.setLeftPanelOpen(!ws.leftPanelOpen)}
            onToggleRight={() => ws.setRightPanelOpen(!ws.rightPanelOpen)}
            onResizeLeft={ws.setLeftPanelWidth}
            onResizeRight={ws.setRightPanelWidth}
            header={
              summary.isError ? (
                <QueryError
                  error={summary.error}
                  onRetry={() => void summary.refetch()}
                  compact
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <SpatialKpis
                    summary={summary.data}
                    loading={summary.isLoading}
                    /* Cuánto se ha mirado con la cámara. Va con los KPIs porque es una
                       advertencia sobre cómo leerlos, no un dato más. */
                    cobertura={cobertura.data}
                  />
                  {/* Qué cambió desde el recorrido anterior. No aparece si no hay nada que
                      decir: un panel que siempre dice «igual que antes» deja de leerse. */}
                  <InspectionChanges
                    cambios={cambios.data}
                    cargando={cambios.isLoading}
                    onAbrirHueco={(id) => {
                      if (warehouseId) ws.setSelectedLocation(warehouseId, id);
                    }}
                  />
                </div>
              )
            }
            toolbar={
              <div className="flex items-center gap-3">
                <SpatialFilters
                  value={filtros}
                  onChange={aplicarFiltros}
                  onClear={ws.clearFilters}
                  situations={situaciones}
                  maxLevel={null}
                  activeRackCode={
                    nav.activeRackId
                      ? roots.data?.find((r) => r.id === nav.activeRackId)?.code ?? '…'
                      : null
                  }
                  onClearRack={() => {
                    ws.setActiveRack(warehouseId, null);
                    ws.setPage(1);
                  }}
                  className="flex-1"
                />
                <QuickActions
                  onZoomIn={() => ws.setZoomLevel(Math.min(600, ws.zoomLevel + 25))}
                  onZoomOut={() => ws.setZoomLevel(Math.max(30, ws.zoomLevel - 25))}
                  onFitAll={() => ws.setZoomLevel(100)}
                  onFocusSelection={() => {}}
                  onResetView={() => ws.resetNav(warehouseId)}
                  hasSelection={Boolean(nav.selectedLocationId)}
                />
              </div>
            }
            left={
              <PanelArbol
                roots={roots.data}
                loading={roots.isLoading}
                error={roots.isError ? roots.error : null}
                onRetry={() => void roots.refetch()}
                expandedIds={nav.expandedIds}
                selectedNodeId={nav.selectedNodeId}
                selectedLocationId={nav.selectedLocationId}
                onToggleExpand={(id) => ws.toggleExpanded(warehouseId, id)}
                onSelectNode={seleccionarNodo}
                onSelectLocation={seleccionarUbicacion}
                onOpenRack={abrirAlzado}
              />
            }
            center={
              ws.viewMode === 'rack' ? (
                <VistaRack
                  rackId={nav.activeRackId}
                  view={rackView.data}
                  loading={rackView.isLoading}
                  error={rackView.isError ? rackView.error : null}
                  onRetry={() => void rackView.refetch()}
                  selectedLocationId={nav.selectedLocationId}
                  onSelect={seleccionarCelda}
                  asOf={summary.data?.lastImportAt ?? null}
                  layer={ws.visualLayer}
                  onLayerChange={ws.setVisualLayer}
                  inspectionOverlay={inspectionOverlay}
                  inspectionAvailable={inspectionAvailable}
                  seleccion={detail.data}
                  seleccionCargando={detail.isLoading}
                />
              ) : ws.viewMode === 'plan' ? (
                <VistaPlano
                  ocupacion={ocupacionPorRack}
                  inspeccion={inspeccionPorRack}
                  rutas={rutas}
                  instante={instante}
                  onInstante={setInstante}
                  layout={layoutPublicado.data}
                  cargando={layoutPublicado.isLoading || catalogoCompleto.isLoading}
                  error={layoutPublicado.isError ? layoutPublicado.error : null}
                  onRetry={() => void layoutPublicado.refetch()}
                  catalogo={catalogoCompleto.data?.items ?? []}
                  layoutStatus={layoutStatus}
                  rackCount={summary.data?.rackCount ?? null}
                  withWorldGeometry={summary.data?.withWorldGeometry ?? null}
                  onAbrirRack={abrirRackPorCodigo}
                />
              ) : (
                <VistaTabla
                  page={locations.data}
                  loading={locations.isLoading}
                  error={locations.isError ? locations.error : null}
                  onRetry={() => void locations.refetch()}
                  selectedId={nav.selectedLocationId}
                  onSelect={seleccionarUbicacion}
                  currentPage={ws.page}
                  onPageChange={ws.setPage}
                  hayFiltros={Boolean(ws.search || ws.statusFilter || ws.situationFilter)}
                />
              )
            }
            bottom={
              <BarraEstado
                viewMode={ws.viewMode}
                onViewModeChange={ws.setViewMode}
                rootCount={roots.data?.length ?? null}
                shown={locations.data?.items.length ?? 0}
                total={locations.data?.total ?? null}
                seleccion={nav.selectedLocationId != null}
              />
            }
            right={
              <div className="flex flex-col gap-4 overflow-y-auto">
                <PanelInspector
                  location={detail.data}
                  loading={detail.isLoading}
                  error={detail.isError ? detail.error : null}
                  onRetry={() => void detail.refetch()}
                  onClose={() => ws.setSelectedLocation(warehouseId, null)}
                  situationCounts={summary.data?.wmsSituationCounts ?? {}}
                  asOf={summary.data?.lastImportAt ?? null}
                  layoutStatus={layoutStatus}
                  backendRackCount={summary.data?.rackCount ?? null}
                  withWorldGeometry={summary.data?.withWorldGeometry ?? null}
                />
                {/* La flota, solo en la vista del plano: es donde la ruta se DIBUJA,
                    y sus cifras sin el mapa al lado son una lista de numeros. */}
                {/* La ocupacion va ANTES de la flota: es lo que el almacen mira todos
                    los dias, y la flota es lo que se esta empezando a medir. */}
                {warehouseId && <PanelOcupacion warehouseId={warehouseId} />}
                {enPlano && warehouseId && (
                  <PanelFlota
                    warehouseId={warehouseId}
                    catalogo={catalogoCompleto.data?.items ?? []}
                    rutas={rutas}
                    racksTotales={summary.data?.rackCount ?? null}
                  />
                )}
              </div>
            }
          />
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </CanvasHost>
  );
}

// ── Bloques ─────────────────────────────────────────────────────────────────

function Titulo() {
  return (
    <h1 className="text-[length:var(--text-lg)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
      Spatial Explorer
    </h1>
  );
}

function Cabecera({
  warehouses,
  activeId,
  onChange,
  loading,
}: {
  warehouses: Parameters<typeof WarehousePicker>[0]['warehouses'];
  activeId: string | null;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <Titulo />
      <WarehousePicker
        warehouses={warehouses}
        activeId={activeId}
        onChange={onChange}
        loading={loading}
      />
    </div>
  );
}

/**
 * Los almacenes que SI tienen estructura que explorar.
 *
 * Existe porque el selector de arriba lista los 27 almacenes accesibles y **24 de
 * ellos son residuos de pruebas de integracion** —todos llamados «Bodega Cartago
 * Norte», todos inactivos, todos con cero ubicaciones—. Con ese ruido, encontrar el
 * que tiene catalogo es adivinar.
 *
 * `hasCatalog` lo da el backend; aqui no se deduce de nada.
 */
function AlmacenesConCatalogo({
  warehouses,
  activeId,
  onChange,
}: {
  warehouses: Parameters<typeof WarehousePicker>[0]['warehouses'];
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  const conCatalogo = warehouses.filter((w) => w.hasCatalog && w.id !== activeId);

  if (conCatalogo.length === 0) {
    return (
      <Panel level="work" radius="lg" pad="lg">
        <span className="t-label">Ningun almacen tiene catalogo</span>
        <p className="t-body mt-2 text-[var(--text-secondary)]">
          Ninguno de los almacenes a los que tienes acceso tiene su catalogo espacial
          importado. Hace falta ejecutar el importador antes de poder explorar
          estructura.
        </p>
        <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
          backend/tools/import_spatial_catalog.py
        </p>
      </Panel>
    );
  }

  return (
    <Panel level="work" radius="lg" pad="lg">
      <span className="t-label">Almacenes con estructura importada</span>
      <div className="mt-3 flex flex-wrap gap-2">
        {conCatalogo.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onChange(w.id)}
            className="flex flex-col items-start gap-0.5 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors [background:var(--glass-2)] hover:[background:var(--glass-3)]"
          >
            <span className="t-mono-xs text-[var(--text-primary)]">{w.code}</span>
            <span className="t-mono-xs text-[var(--text-faint)]">{w.name}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function PanelArbol({
  roots,
  loading,
  error,
  onRetry,
  expandedIds,
  selectedNodeId,
  onToggleExpand,
  onSelectNode,
  onSelectLocation,
  onOpenRack,
  selectedLocationId,
}: {
  roots: SpatialNode[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  expandedIds: string[];
  selectedNodeId: string | null;
  selectedLocationId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (n: SpatialNode) => void;
  onSelectLocation: (l: SpatialLocation) => void;
  onOpenRack: (n: SpatialNode) => void;
}) {
  if (error) return <QueryError error={error} onRetry={onRetry} compact />;

  if (loading) {
    return (
      <div className="flex flex-col gap-2 py-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-5 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]"
            style={{ width: `${60 + ((i * 13) % 35)}%` }}
          />
        ))}
      </div>
    );
  }

  if (!roots || roots.length === 0) {
    return <SpatialError kind="empty" compact />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <span className="t-label">Estructura</span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {groupByFamily(roots).length} familias · {roots.length.toLocaleString('es')} racks
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SpatialTree
          roots={roots}
          expandedIds={expandedIds}
          selectedNodeId={selectedNodeId}
          selectedLocationId={selectedLocationId}
          onToggleExpand={onToggleExpand}
          onSelectNode={onSelectNode}
          onSelectLocation={onSelectLocation}
          onOpenRack={onOpenRack}
        />
      </div>
      <span className="t-mono-xs px-1 text-[var(--text-faint)]">
        Familia → rack → cuerpo C → nivel N → posicion. Doble clic en un rack abre
        su alzado.
      </span>
    </div>
  );
}

function VistaTabla({
  page,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  currentPage,
  onPageChange,
  hayFiltros,
}: {
  page: Parameters<typeof LocationTable>[0]['page'];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (l: SpatialLocation) => void;
  currentPage: number;
  onPageChange: (p: number) => void;
  hayFiltros: boolean;
}) {
  if (error) return <QueryError error={error} onRetry={onRetry} />;

  // «Sin resultados» solo se puede afirmar cuando la respuesta LLEGO. Sin `page`
  // no hay respuesta: hay una peticion que no termino, y decir que no hay datos
  // seria inventar una conclusion.
  if (!loading && page == null) {
    return <SpatialError kind="disconnected" onRetry={onRetry} />;
  }

  if (!loading && page != null && page.items.length === 0) {
    return <SpatialError kind={hayFiltros ? 'no-results' : 'empty'} />;
  }

  return (
    <LocationTable
      page={page}
      loading={loading}
      selectedId={selectedId}
      onSelect={onSelect}
      currentPage={currentPage}
      onPageChange={onPageChange}
    />
  );
}

/**
 * VISTA DEL RACK — 3D axonometrico, con alzado plano como alternativa.
 *
 * El visor 3D es el principal: es la vista OPERACIONAL, donde se veran las
 * lecturas del dron. El alzado plano (`RackFrontView`) se mantiene como
 * alternativa accesible y como recurso si el navegador no puede dibujar.
 *
 * Las dos consumen el MISMO endpoint y los mismos datos: no hay dos verdades.
 */
function VistaRack({
  rackId,
  view,
  loading,
  error,
  onRetry,
  selectedLocationId,
  onSelect,
  asOf,
  layer,
  onLayerChange,
  inspectionOverlay,
  inspectionAvailable,
  seleccion,
  seleccionCargando,
}: {
  rackId: string | null;
  view: Parameters<typeof RackFrontView>[0]['view'] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedLocationId: string | null;
  onSelect: (c: RackFrontCell) => void;
  asOf: string | null;
  layer: VisualLayer;
  onLayerChange: (l: VisualLayer) => void;
  inspectionOverlay: InspectionOverlayMap | undefined;
  inspectionAvailable: boolean;
  /** Ubicacion seleccionada, ya cargada para el inspector. No añade consulta. */
  seleccion: SpatialLocation | undefined;
  seleccionCargando: boolean;
}) {
  const [plano, setPlano] = useState(false);
  // Expande el bloque COMPLETO —controles, lienzo y lectura de la seleccion—, no
  // solo el lienzo: a pantalla completa hay que poder seguir cambiando de capa y
  // de representacion sin salir. Cubre las dos vistas porque 3D y Frontal 2D
  // cuelgan de este mismo contenedor.
  const exp = useExpansion();

  if (!rackId) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-[46ch] flex-col items-center gap-3 text-center">
          <Boxes strokeWidth={1.25} className="size-9 text-[var(--icon-accent)]" />
          <p className="text-[length:var(--text-md)] font-[var(--weight-light)] text-[var(--text-primary)]">
            Selecciona un rack
          </p>
          <p className="t-body text-[var(--text-secondary)]">
            Pulsa un rack en el arbol —o la columna Rack de la tabla— para ver su
            estructura: cuerpos, niveles y posiciones.
          </p>
        </div>
      </div>
    );
  }

  if (error) return <QueryError error={error} onRetry={onRetry} />;

  if (loading || !view) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="t-mono-xs animate-pulse text-[var(--text-faint)]">
          Cargando el rack…
        </span>
      </div>
    );
  }

  return (
    <div
      ref={exp.ref}
      className={cn(
        exp.expandido
          ? CLASES_EXPANDIDO
          : 'flex h-full min-h-0 flex-col gap-2 px-3 pt-2',
      )}
    >
      {/*
        UNA SOLA FILA DE CONTROL, no dos.

        Antes la capa de color iba arriba y su leyenda en un pie con borde, titulo y
        nota al pie: ~90 px por debajo del lienzo para tres pastillas de color. Los
        dos hablan de lo mismo —que significa cada tono—, asi que van juntos y la
        leyenda va en su forma compacta. Los 90 px se los queda el rack, que es el
        protagonista de la pantalla.

        La leyenda COMPLETA, con su fecha y su nota, sigue en el inspector cuando no
        hay ubicacion seleccionada. No se pierde nada.
      */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <VisualLayerPicker
            value={layer}
            onChange={onLayerChange}
            inspectionAvailable={inspectionAvailable}
          />
          <span aria-hidden className="h-4 w-px [background:var(--hairline)]" />
          {layer === 'spatial' && <StatusLegend compact />}
          {layer === 'wms' && (
            <WmsSituationLegend counts={contarSituaciones(view)} asOf={asOf} compact />
          )}
          {layer === 'inspection' && (
            <InspectionLegend available={inspectionAvailable} compact />
          )}
        </div>

        {/* Segmentado: las dos representaciones son pares, no una accion y su deshacer */}
        <div className="flex items-center gap-2">
          <BotonExpandir expandido={exp.expandido} onClick={exp.alternar} />
          <div
            className="flex items-center gap-0.5 rounded-[var(--radius-xs)] p-0.5 [background:var(--glass-2)]"
            role="group"
            aria-label="Representacion del rack"
          >
            {([
              [false, '3D', 'Axonometrico. Muestra profundidad y posiciones.'],
              [true, 'Frontal 2D', 'El mismo dato sin proyeccion. Navegable con teclado.'],
            ] as const).map(([esPlano, etiqueta, ayuda]) => (
              <button
                key={etiqueta}
                type="button"
                onClick={() => setPlano(esPlano)}
                aria-pressed={plano === esPlano}
                title={ayuda}
                className={cn(
                  'h-6 rounded-[calc(var(--radius-xs)-2px)] px-2.5 text-[length:var(--text-xs)] transition-colors',
                  plano === esPlano
                    ? 'text-[var(--text-inverse)] [background:var(--accent-strong)]'
                    : 'text-[var(--text-faint)] hover:text-[var(--text-primary)]',
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {plano ? (
          <RackFrontView
            view={view}
            selectedLocationId={selectedLocationId}
            onSelect={onSelect}
            asOf={asOf}
          />
        ) : (
          <Rack3DView
            view={view}
            selectedLocationId={selectedLocationId}
            onSelect={onSelect}
            layer={layer}
            inspectionOverlay={inspectionOverlay}
          />
        )}

        {/*
          Lectura de la seleccion. Ocupa el alto que el rack no necesita —que en un
          rack de 27 cuerpos es mas de la mitad del area de trabajo—, y lo ocupa con
          informacion en lugar de con vacio.
        */}
        {!plano && (
          <SelectionReadout
            location={seleccion}
            loading={seleccionCargando}
            hayId={selectedLocationId != null}
            /* Lo que la camara vio en ESE hueco. Sale del mismo overlay que colorea la
               celda, asi que no anade ni una consulta. */
            inspeccion={
              selectedLocationId ? inspectionOverlay?.[selectedLocationId] : undefined
            }
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </div>
  );
}

/** Situaciones presentes en ESTE rack, para su leyenda. */
function contarSituaciones(
  view: NonNullable<Parameters<typeof RackFrontView>[0]['view']>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of view.cells) {
    const k = c.situation ?? '(sin situacion)';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * VISTA DEL PLANO — donde esta cada rack DENTRO del almacen.
 *
 * Es la unica de las tres que si depende de geometria global, y por eso puede estar
 * vacia. Vacia con su motivo: distingue «no has configurado el plano» —que el
 * operador puede resolver ahora— de «no existe el levantamiento metrico», que
 * necesita un importador CAD.
 */
/**
 * VISTA DEL PLANO — el cluster publicado, en tres dimensiones.
 *
 * Esta vista existia vacia, y su propio tipo lo justificaba: «`plan` si necesita
 * geometria global (`world_position`, al 100 % NULL) o un layout local, y por eso
 * puede estar vacia — pero vacia con su motivo, no ausente». Ese motivo ya no
 * aplica: hay layout publicado y hay metros.
 *
 * Se dibuja lo PUBLICADO y no el borrador local. Aqui mira todo el equipo, y el
 * borrador es de quien tenga el editor abierto: mostrarlo seria ensenar el trabajo
 * a medias de otra persona como si fuera el plano del almacen. El panel del estado
 * local se conserva DEBAJO, porque saber que hay un borrador sin publicar es
 * justamente lo que explica que el plano no cuadre con lo que uno acaba de colocar.
 */
function VistaPlano({
  ocupacion,
  inspeccion,
  rutas,
  instante,
  onInstante,
  layout,
  cargando,
  error,
  onRetry,
  catalogo,
  layoutStatus,
  rackCount,
  withWorldGeometry,
  onAbrirRack,
}: {
  ocupacion: ReadonlyMap<string, number | null>;
  /** Lo que la camara encontro en cada rack. Habilita el criterio «por inspeccion». */
  inspeccion: ReadonlyMap<string, InspeccionDeRack>;
  rutas: readonly RutaPreparada[];
  instante: number | null;
  onInstante: (ms: number | null) => void;
  layout: LayoutPublicado | undefined;
  cargando: boolean;
  error: unknown;
  onRetry: () => void;
  catalogo: readonly FloorPlanCell[];
  layoutStatus: LayoutStatus;
  rackCount: number | null;
  withWorldGeometry: number | null;
  onAbrirRack: (rackCode: string) => void;
}) {
  const [seleccion, setSeleccion] = useState<string[]>([]);

  if (error) return <QueryError error={error} onRetry={onRetry} />;

  if (cargando) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="t-mono-xs text-[var(--text-faint)]">leyendo el layout…</span>
      </div>
    );
  }

  if (layout?.publicado) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <span className="t-mono-xs text-[var(--text-muted)]">
            {layout.racks.length} racks colocados
            {layout.planName ? ` · sobre ${layout.planName}` : ''}
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {layout.calibrado
              ? 'escala medida'
              : 'escala sin medir: las proporciones no son reales'}
          </span>
        </div>
        {/* Sin `plan`: el backend guarda el NOMBRE del archivo del plano, no sus
            bytes, asi que aqui no hay imagen que tumbar de suelo. Los racks se
            dibujan sobre la rejilla metrica, que es informacion real; el nombre del
            plano se muestra arriba para saber cual falta. */}
        <Cluster3DView
          racks={layout.racks}
          ppm={layout.ppm}
          origen={layout.origen}
          calibrado={layout.calibrado}
          plan={null}
          catalogo={catalogo}
          seleccion={seleccion}
          onSeleccionar={(r) => setSeleccion(r ? [r.layoutId] : [])}
          onAbrirRack={onAbrirRack}
          rutas={rutas}
          instante={instante}
          ocupacion={ocupacion}
          inspeccion={inspeccion}
          className="min-h-0 flex-1"
        />
        {/* El reproductor DEBAJO del lienzo, no encima: recorrer el tiempo es mirar
            el mapa, y un control flotante taparia justo la zona que se esta
            siguiendo. Solo aparece si hay algo que reproducir. */}
        {rutas.length > 0 && (
          <ReproductorRutas
            rutas={rutas}
            instante={instante}
            onInstante={onInstante}
            className="shrink-0"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-[54ch] flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <MapIcon strokeWidth={1.25} className="size-9 text-[var(--icon-accent)]" />
          <p className="text-[length:var(--text-md)] font-[var(--weight-light)] text-[var(--text-primary)]">
            Este almacen todavia no tiene plano publicado
          </p>
          <p className="t-mono-xs text-[var(--text-faint)]">
            Se coloca en el editor de plano y se publica desde ahi. Hasta entonces no
            hay donde estan los racks, y no se inventa.
          </p>
        </div>

        <LayoutStatusPanel
          status={layoutStatus}
          backendRackCount={rackCount}
          withWorldGeometry={withWorldGeometry}
        />

        <p className="t-mono-xs text-center text-[var(--text-faint)]">
          La estructura de cada rack SI se puede ver sin plano: usa la vista «Rack 3D».
          No necesita coordenadas del edificio.
        </p>
      </div>
    </div>
  );
}

function PanelInspector({
  location,
  loading,
  error,
  onRetry,
  onClose,
  situationCounts,
  asOf,
  layoutStatus,
  backendRackCount,
  withWorldGeometry,
}: {
  location: SpatialLocation | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
  situationCounts: Record<string, number>;
  asOf: string | null;
  layoutStatus: LayoutStatus;
  backendRackCount: number | null;
  withWorldGeometry: number | null;
}) {
  if (error) return <QueryError error={error} onRetry={onRetry} compact />;

  if (loading) return <LocationDetail location={null} loading onClose={onClose} bare />;

  if (!location) {
    // Sin seleccion: en lugar de un panel vacio, las dos leyendas y lo que aun no
    // existe. Es informacion real y ocupa el sitio que ocuparia el detalle.
    return (
      <div className="flex flex-col gap-6 overflow-y-auto">
        <div className="flex flex-col gap-3">
          <span className="t-label">Inspector</span>
          <p className="t-mono-xs text-[var(--text-faint)]">
            Selecciona una ubicacion en la tabla o en el alzado para ver su detalle.
          </p>
        </div>
        <WmsSituationLegend counts={situationCounts} asOf={asOf} />
        <div className="border-t border-[var(--hairline-strong)] pt-4">
          <LayoutStatusPanel
            status={layoutStatus}
            backendRackCount={backendRackCount}
            withWorldGeometry={withWorldGeometry}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      <LocationDetail location={location} loading={false} onClose={onClose} bare />
    </div>
  );
}

/**
 * BARRA DE ESTADO — que se esta viendo y cuanto de ello.
 *
 * Dice `shown de total` solo cuando el total EXISTE. Sin `withTotal`, dice cuantas
 * hay en pantalla y punto: inventar un total es la mentira mas facil en una tabla
 * paginada sobre 29.310 filas.
 */
function BarraEstado({
  viewMode,
  onViewModeChange,
  rootCount,
  shown,
  total,
  seleccion,
}: {
  viewMode: SpatialViewMode;
  onViewModeChange: (m: SpatialViewMode) => void;
  rootCount: number | null;
  shown: number;
  total: number | null;
  seleccion: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-1">
      {/*
        Las TRES vistas, siempre visibles. La tabla no desaparece: es la
        herramienta administrativa. El rack es la vista operacional.
      */}
      <div className="flex items-center gap-1" role="group" aria-label="Modo de vista">
        {([
          ['grid', 'Tabla'],
          ['rack', 'Rack 3D'],
          ['plan', 'Plano'],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => onViewModeChange(m)}
            aria-pressed={viewMode === m}
            className={cn(
              // 24px de alto está bien con ratón y no con un dedo. `min-h` al tacto y
              // no `h`, para que gane sobre el `h-6` sin tocar la densidad de
              // escritorio, que aquí es deliberada.
              'h-6 pointer-coarse:min-h-11 rounded-[var(--radius-xs)] px-2.5 text-[length:var(--text-xs)] transition-colors',
              viewMode === m
                ? '[background:var(--glass-2)] text-[var(--text-primary)]'
                : 'text-[var(--text-faint)] hover:[background:var(--glass-1)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4">
        {rootCount != null && (
          <span className="t-mono-xs text-[var(--text-faint)]">
            {rootCount.toLocaleString('es')} nodos raiz
          </span>
        )}
        {viewMode === 'grid' && (
          <span className="t-mono-xs text-[var(--text-faint)]">
            {total != null
              ? `${shown.toLocaleString('es')} de ${total.toLocaleString('es')} ubicaciones`
              : `${shown.toLocaleString('es')} ubicaciones en pantalla`}
          </span>
        )}
        {seleccion && (
          <span className="t-mono-xs text-[var(--text-accent)]">1 seleccionada</span>
        )}
      </div>
    </div>
  );
}
