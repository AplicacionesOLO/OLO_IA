/**
 * Los tipos de OLOBOT, tal como los devuelve el backend.
 *
 * `OlobotNivel` es la MISMA lista que `domain/olobot/level.py` y que el CHECK
 * `chk_olobot_level` de la migración 0073. Está escrita aquí porque TypeScript no lee
 * Python, y el precio de esa duplicación se paga en un solo sitio: la pantalla de
 * Configuración pinta el desplegable con los niveles que MANDA el servidor
 * (`NivelDescrito[]`), no con esta lista. Este tipo solo sirve para que el compilador
 * atrape un `'jefazo'` escrito a mano.
 */

/** Los cuatro niveles. Ver `domain/olobot/level.py` para qué trae cada uno. */
export type OlobotNivel = 'user' | 'supervisor' | 'admin' | 'owner';

/**
 * Un nivel con su etiqueta, como lo describe el servidor.
 *
 * Las etiquetas y las capacidades vienen del backend a propósito: quien decide qué
 * puede hacer cada nivel es el dominio, y una segunda lista aquí se separaría de
 * aquella en la primera capacidad nueva.
 */
export interface NivelDescrito {
  level: OlobotNivel;
  label: string;
  description: string;
  capabilities: string[];
}

export interface HerramientaOfrecida {
  name: string;
  /** Si propone cambios. Las que escriben se pintan distinto: son las que confirman. */
  writes: boolean;
  description: string;
}

/**
 * Si el bot está disponible, y por qué no si no lo está.
 *
 * `available: false` con `reason` y no un 403: a quien no tiene bot hay que poder
 * decirle que no lo tiene. Ver la cabecera de `api/v1/olobot.py`.
 */
export interface OlobotEstado {
  available: boolean;
  reason: string | null;
  level: OlobotNivel | null;
  model?: string;
  tools: HerramientaOfrecida[];
}

export interface OlobotMensaje {
  id: number;
  role: 'user' | 'assistant';
  content: string | null;
  created_at: string;
}

export interface OlobotConversacion {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  messages: number;
}

/** Adónde quiere llevarte el bot. La ruta la resuelve el servidor: no es texto libre. */
export interface Navegacion {
  key: string;
  path: string;
  reason: string | null;
}

/**
 * Un cambio que el bot propone. NO está aplicado.
 *
 * `summary` lo escribe el servidor a partir de los MISMOS argumentos que se van a
 * ejecutar, no el modelo: si lo escribiera el modelo, lo que se confirma y lo que se
 * ejecuta podrían no ser lo mismo.
 */
export interface AccionPendiente {
  id: string;
  tool: string;
  summary: string;
  arguments: Record<string, unknown>;
}

export interface RespuestaTurno {
  conversation_id: string;
  reply: string;
  navigate: Navegacion | null;
  pending_actions: AccionPendiente[];
}

export interface AccionRegistrada {
  id: string;
  tool: string;
  summary: string;
  status: 'proposed' | 'executed' | 'rejected' | 'failed';
  error_message: string | null;
  proposed_at: string;
  decided_at: string | null;
  user_email: string;
}

/** Una fila de la lista de niveles. `level` a `null` = ese usuario no tiene bot. */
export interface AccesoUsuario {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  level: OlobotNivel | null;
  granted_at: string | null;
  note: string | null;
  granted_by_email: string | null;
}

export interface AccesoLista {
  users: AccesoUsuario[];
  levels: NivelDescrito[];
}
