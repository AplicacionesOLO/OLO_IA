import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Fuentes locales: cero peticiones a CDN en runtime. Se importan aqui y no en
// el CSS porque Tailwind v4 no resuelve especificadores de paquete en @import.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import './styles/index.css';
import { vigilarDeploys } from './lib/recargaTrasDeploy';

//  Una pestaña abierta desde antes de un deploy se recupera sola. Ver el modulo.
vigilarDeploys();

const container = document.getElementById('root');
if (!container) {
  throw new Error('[OLO] No se encontro #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
