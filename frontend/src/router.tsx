/**
 * ROUTER
 *
 * EL ROUTER REACCIONA AL ESTADO DE SESION, no al contrario.
 */

import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { LoginScene } from './scenes/login/LoginScene';
import { BootScreen } from './auth/screens/BootScreen';
import { NoMembershipScreen } from './auth/screens/NoMembershipScreen';
import { SessionErrorScreen } from './auth/screens/SessionErrorScreen';
import { useSessionStore } from './auth/sessionStore';
import { AdminPage } from './features/admin/AdminPage';
import { AiAnnotatePage } from './features/ai/AiAnnotatePage';
import { AiDatasetPage } from './features/ai/AiDatasetPage';
import { AiDatasetVersionsPage } from './features/ai/AiDatasetVersionsPage';
import { AiModelDetailPage } from './features/ai/AiModelDetailPage';
import { AiProjectDetailPage } from './features/ai/AiProjectDetailPage';
import { AiProjectsPage } from './features/ai/AiProjectsPage';
import { ModuleLandingPage } from './features/ModuleLandingPage';
import { AuditPage } from './modules/audit/pages/AuditPage';
import { IncidentsPage } from './modules/incidents/pages/IncidentsPage';
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { SpatialExplorerPage } from './modules/spatial/pages/SpatialExplorerPage';
import { SpatialLayoutEditorPage } from './modules/spatial/pages/SpatialLayoutEditorPage';
import { SpatialProvider } from './modules/spatial/services/SpatialProvider';
import { PerceptionProvider } from './modules/perception/PerceptionProvider';
import { PerceptionListPage, PerceptionJobPage, NewInspectionPage } from './modules/perception/pages/index';
import { NAV_ITEMS } from './shell/navigation';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },

      // ── Modulo de IA: rutas reales ──────────────────────────────────────
      { path: 'admin', element: <AdminPage /> },
      { path: 'ai/projects', element: <AiProjectsPage /> },
      { path: 'ai/projects/:projectId', element: <AiProjectDetailPage /> },
      { path: 'ai/projects/:projectId/dataset', element: <AiDatasetPage /> },
      // `?image=<uuid>` elige la imagen; sin el parametro abre la primera.
      { path: 'ai/projects/:projectId/annotate', element: <AiAnnotatePage /> },
      { path: 'ai/projects/:projectId/dataset-versions', element: <AiDatasetVersionsPage /> },
      { path: 'ai/models/:modelId', element: <AiModelDetailPage /> },

      // ── Modulo Spatial: explorador de ubicaciones ────────────────────────
      {
        path: 'spatial',
        element: (
          <SpatialProvider>
            <SpatialExplorerPage />
          </SpatialProvider>
        ),
      },
      /*
        ── DIGITAL TWIN: MODELAR EL ALMACEN, NO EXPLORARLO ──────────────────────

        Son dos oficios distintos sobre la misma pantalla. Levantar el modelo —subir el
        plano del CAD, calibrarlo, colocar los 347 racks y publicar— se hace de vez en
        cuando y es un trabajo de construccion. El arbol y el alzado se usan a diario y son
        de consulta.

        Asi que `/twin` es la puerta de lo primero: abre el almacen DE CONJUNTO, en vista de
        plano, y de ahi se entra al editor. `/spatial` sigue siendo el explorador.

        Lo que NO se hace es duplicar: es la misma pagina, el mismo estado y el mismo visor
        —el estado vive en un store persistido, no en el provider—. Dos visores 3D con el
        mismo trabajo hecho dos veces es exactamente lo que esto evita.
      */
      {
        path: 'twin',
        element: (
          <SpatialProvider>
            <SpatialExplorerPage vistaInicial="plan" />
          </SpatialProvider>
        ),
      },
      // El editor va en su propia ruta y no como una vista mas: el explorador es de
      // consulta y esto es un modo de edicion con su propio estado, su historial de
      // deshacer y su borrador.
      {
        path: 'twin/editor',
        element: (
          <SpatialProvider>
            <SpatialLayoutEditorPage />
          </SpatialProvider>
        ),
      },
      //  La ruta vieja del editor sigue viva: hay enlaces guardados y un 404 no explicaria
      //  nada. Se queda como redireccion, no como copia.
      { path: 'spatial/editor', element: <Navigate to="/twin/editor" replace /> },

      // ── Modulo Perception: Computer Vision ──────────────────────────────
      { path: 'perception', element: <PerceptionProvider><PerceptionListPage /></PerceptionProvider> },
      { path: 'perception/new', element: <PerceptionProvider><NewInspectionPage /></PerceptionProvider> },
      { path: 'perception/jobs/:jobId', element: <PerceptionProvider><PerceptionJobPage /></PerceptionProvider> },

      // ── Modulo Inventario: lo que el WMS declara ────────────────────────
      // Sin provider a proposito: sus endpoints son de solo lectura y no tienen
      // variante de desarrollo que merezca la pena mantener. Un hook que exige
      // provider revienta cualquier pantalla que lo use fuera de su arbol, y eso
      // TypeScript no lo ve.
      { path: 'inventory', element: <InventoryPage /> },

      // ── Modulo Incidencias: el trabajo que sale de los descuadres ───────
      { path: 'incidents', element: <IncidentsPage /> },
      { path: 'audit', element: <AuditPage /> },

      // ── Modulos no implementados: landing pages ricas ───────────────────
      // Cada uno muestra su propio contenido: capacidades, estado, version.
      // No es un placeholder generico: es una carta de presentacion del modulo.
      ...NAV_ITEMS.filter(
        (i) => i.path !== '/' && i.moduleStatus !== 'available' && i.moduleStatus !== 'beta',
      ).map((item) => ({
        path: item.path.slice(1),
        element: <ModuleLandingPage navId={item.id} />,
      })),

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function AppRouter() {
  const status = useSessionStore((s) => s.status);

  switch (status) {
    case 'restoring':
      return <BootScreen />;
    case 'authenticating':
      return <BootScreen label="Verificando autorizacion" />;
    case 'anonymous':
      return <LoginScene />;
    case 'no-membership':
      return <NoMembershipScreen />;
    case 'error':
      return <SessionErrorScreen />;
    case 'active':
      return <RouterProvider router={router} />;
  }
}
