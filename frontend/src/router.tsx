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
import { AiDatasetPage } from './features/ai/AiDatasetPage';
import { AiModelDetailPage } from './features/ai/AiModelDetailPage';
import { AiProjectDetailPage } from './features/ai/AiProjectDetailPage';
import { AiProjectsPage } from './features/ai/AiProjectsPage';
import { ModuleLandingPage } from './features/ModuleLandingPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { SpatialExplorerPage } from './modules/spatial/pages/SpatialExplorerPage';
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
      { path: 'ai/projects', element: <AiProjectsPage /> },
      { path: 'ai/projects/:projectId', element: <AiProjectDetailPage /> },
      { path: 'ai/projects/:projectId/dataset', element: <AiDatasetPage /> },
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

      // ── Modulo Perception: Computer Vision ──────────────────────────────
      { path: 'perception', element: <PerceptionProvider><PerceptionListPage /></PerceptionProvider> },
      { path: 'perception/new', element: <PerceptionProvider><NewInspectionPage /></PerceptionProvider> },
      { path: 'perception/jobs/:jobId', element: <PerceptionProvider><PerceptionJobPage /></PerceptionProvider> },

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
