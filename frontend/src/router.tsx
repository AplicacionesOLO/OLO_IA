/**
 * ROUTER
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL ROUTER REACCIONA AL ESTADO DE SESION, no al contrario.
 *
 * `SessionGate` decide qué se ve segun el estado, y el login no navega
 * manualmente al autenticarse. Asi el mismo camino sirve para el login, para la
 * restauracion de sesion al recargar, y para el cierre de sesion en otra
 * pestaña. Un `navigate()` dentro del formulario de login solo cubriria el
 * primer caso.
 * ─────────────────────────────────────────────────────────────────────────
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
import { OverviewPage } from './features/overview/OverviewPage';
import { PlaceholderPage } from './features/PlaceholderPage';
import { NAV_ITEMS } from './shell/navigation';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },

      // Modulo de IA: rutas REALES. Van antes de los marcadores para que ganen la
      // resolucion, ya que `/ai/projects` tambien lo cubriria el catch-all.
      { path: 'ai/projects', element: <AiProjectsPage /> },
      { path: 'ai/projects/:projectId', element: <AiProjectDetailPage /> },
      { path: 'ai/projects/:projectId/dataset', element: <AiDatasetPage /> },
      { path: 'ai/models/:modelId', element: <AiModelDetailPage /> },

      // Las rutas de los modulos aun no implementados se generan del propio
      // modelo de navegacion: asi no hay forma de que el Spine ofrezca un
      // enlace que lleve a un 404.
      //
      // Se excluyen los `implemented`: sin ese filtro, «Inteligencia» generaria un
      // segundo `ai/projects` que competiria con la ruta real de arriba.
      ...NAV_ITEMS.filter((i) => i.path !== '/' && !i.implemented).map((item) => ({
        path: item.path.slice(1),
        element: <PlaceholderPage title={item.label} navId={item.id} />,
      })),
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

/**
 * Puerta de sesion.
 *
 * Cada estado tiene su pantalla. Ninguno cae en un caso por defecto silencioso:
 * eso es lo que produce las aplicaciones vacias sin explicacion.
 */
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
