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
        ── DIGITAL TWIN: DONDE SE LEVANTA EL MODELO ─────────────────────────────

        Es el EDITOR: cargar el plano del CAD, calibrarlo, colocar los racks en 3D y
        publicar. No una vista mas del explorador — eso fue un intento anterior y el
        resultado era una copia de Spatial con menos pestañas, que es exactamente lo que se
        reporto.

        Aqui se CONSTRUYE el modelo; en Spatial se CONSULTA. Son dos pantallas distintas de
        verdad —esta tiene su barra de herramientas, sus capas, su borrador y su historial
        de deshacer— y estan conectadas: el editor vuelve al explorador con «Explorador», y
        el explorador entra aqui desde el panel de estado del layout.

        El borrador es LOCAL a este navegador hasta que se publica. Al publicar, la posicion
        de los racks se escribe en la base y el explorador la lee: eso es lo que conecta los
        dos modulos.
      */
      {
        path: 'twin',
        element: (
          <SpatialProvider>
            <SpatialLayoutEditorPage />
          </SpatialProvider>
        ),
      },
      //  Las dos rutas viejas siguen vivas: hay enlaces guardados y un 404 no explicaria
      //  nada. Redirigen, no duplican.
      { path: 'twin/editor', element: <Navigate to="/twin" replace /> },
      { path: 'spatial/editor', element: <Navigate to="/twin" replace /> },

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
