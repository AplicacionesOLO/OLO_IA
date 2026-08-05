/**
 * EDITAR Y DAR DE BAJA, FILA A FILA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE FALTABA
 *
 * La pantalla de configuración solo sabía CREAR. Cinco formularios de alta —país,
 * entidad legal, cliente, almacén, rol— y ninguna forma de corregir un nombre mal
 * escrito ni de dar de baja nada, con la única excepción del botón de borrar en la tabla
 * de roles.
 *
 * Los PATCH de clientes y de entidades legales llevaban tiempo en el backend sin nadie
 * que los llamara. Eso es peor que no tenerlos: parecen soportados al leer el router.
 *
 * ── DOS DECISIONES QUE GOBIERNAN ESTE ARCHIVO ───────────────────────────────
 *
 * 1. EDITAR ES EN LA PROPIA FILA, no en un modal.
 *
 *    Un modal tapa la tabla, y en una pantalla de configuración lo que se corrige casi
 *    siempre se decide COMPARANDO con las filas vecinas —«¿este código sigue el mismo
 *    formato que los otros?»—. La fila se expande y el resto sigue a la vista.
 *
 * 2. DAR DE BAJA PIDE CONFIRMACION EN LA MISMA FILA, y dice qué se va a perder.
 *
 *    Sin diálogo aparte: el segundo clic cae a dos centímetros del primero, con el
 *    nombre de lo que se borra delante. Un modal de confirmación genérico —«¿seguro?»—
 *    se contesta sin leer, y es exactamente el clic que no hay que facilitar.
 *
 * ── POR QUE EL ESTADO NO VIVE AQUI ──────────────────────────────────────────
 *
 * La primera versión metía el formulario DENTRO de la celda de acciones, y verlo en
 * pantalla dejó claro el error: una celda que crece exige ancho a la tabla y machaca las
 * demás columnas —la razón social y la cédula se partían en dos líneas cada vez que
 * alguien abría a editar—. Encima el formulario quedaba a la derecha, repitiendo los
 * valores que ya se leían a la izquierda en la misma fila.
 *
 * Así que la celda solo lleva los dos iconos, y el panel se pinta en una fila PROPIA a
 * todo lo ancho, debajo. Eso obliga a que «qué fila está abierta» lo sepa la tabla y no
 * cada celda: son dos sitios del DOM que comparten un estado. Por eso lo que se exporta
 * son PIEZAS —los botones, el editor, la confirmación— y un descriptor, en vez de un
 * componente que lo hiciera todo.
 *
 * ── LO QUE ESTE ARCHIVO NO HACE ─────────────────────────────────────────────
 *
 * No decide si una baja es posible. Eso lo decide el backend y responde 409 con las
 * cifras: «tiene 2 almacenes y 2 clientes», «quedan 1 entidad legal en ese país». El
 * mensaje se muestra TAL CUAL, sin reescribirlo: la cifra es la mitad de la información
 * y un «no se puede dar de baja» genérico la perdería.
 */

import { useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';

import { AsyncStatus } from '../../design/foundation/AsyncStatus';
import { Button } from '../../design/primitives/Button';
import { cn } from '../../design/utils/cn';
import { ApiError, humanMessage } from '../../lib/apiErrors';

/** Un campo editable de una fila. `select` cuando el valor es de vocabulario cerrado. */
export interface CampoEditable {
  clave: string;
  etiqueta: string;
  valor: string;
  ancho?: string;
  opciones?: readonly string[];
  /** Devuelve el motivo si el valor no vale, o `null` si vale. */
  validar?: (v: string) => string | null;
}

/**
 * Lo que una tabla declara sobre una de sus filas: cómo se edita y si se da de baja.
 *
 * Es un objeto y no un componente porque la fila se pinta en DOS sitios —los iconos en
 * su celda, el panel en una fila aparte— y quien decide cuál está abierta es la tabla.
 */
export interface AccionesFila {
  /** Lo que se nombra en la confirmación. Sin esto, «¿seguro?» se contesta sin leer. */
  nombre: string;
  campos: readonly CampoEditable[];
  /** Recibe SOLO los campos que cambiaron. Ver la nota de `EditorDeFila`. */
  onGuardar: (cambios: Record<string, string>) => Promise<unknown>;
  onBaja?: (() => Promise<unknown>) | undefined;
  /** «Dar de baja» no vale para todo: en un país la operación es cerrarla. */
  etiquetaBaja?: string | undefined;
}

function mensaje(e: unknown, porOmision: string): string {
  if (e instanceof ApiError) return humanMessage(e);
  if (e instanceof Error && e.message) return e.message;
  return porOmision;
}

const CAMPO = cn(
  'h-7 rounded-[var(--radius-xs)] px-2 text-[length:var(--text-xs)]',
  '[background:var(--glass-2)] text-[var(--text-primary)]',
  'shadow-[var(--rim-1)] outline-none focus:shadow-[var(--focus-ring)]',
);

/** Los dos iconos que van en la celda. Nada más: lo que crece va en otra fila. */
export function BotonesDeFila({
  nombre,
  etiquetaBaja = 'Dar de baja',
  hayBaja,
  abierta,
  onEditar,
  onBaja,
}: {
  nombre: string;
  etiquetaBaja?: string | undefined;
  hayBaja: boolean;
  abierta: boolean;
  onEditar: () => void;
  onBaja: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        aria-label={`Editar ${nombre}`}
        aria-expanded={abierta}
        onClick={onEditar}
      >
        <Pencil strokeWidth={1.5} className="size-3" />
      </Button>
      {hayBaja && (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`${etiquetaBaja} ${nombre}`}
          onClick={onBaja}
        >
          <Trash2 strokeWidth={1.5} className="size-3 text-[var(--text-warn)]" />
        </Button>
      )}
    </div>
  );
}

/**
 * El formulario de edición, a todo lo ancho de la fila.
 *
 * `onGuardar` recibe SOLO los campos que cambiaron. Mandar todos convertiría un PATCH en
 * un PUT encubierto: reescribiría campos que nadie tocó, y con dos personas editando a
 * la vez la segunda desharía el cambio de la primera sin saberlo.
 */
export function EditorDeFila({
  campos,
  onGuardar,
  onCerrar,
}: {
  campos: readonly CampoEditable[];
  onGuardar: (cambios: Record<string, string>) => Promise<unknown>;
  onCerrar: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.clave, c.valor])),
  );
  const [fase, setFase] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const de = (c: CampoEditable) => valores[c.clave] ?? c.valor;

  // Solo lo que cambió de verdad. Ver la nota de arriba.
  const cambios = Object.fromEntries(
    campos.filter((c) => de(c).trim() !== c.valor).map((c) => [c.clave, de(c).trim()]),
  );
  const invalido = campos.map((c) => c.validar?.(de(c)) ?? null).find((x) => x !== null);
  const puedeGuardar = Object.keys(cambios).length > 0 && !invalido && fase !== 'pending';

  return (
    <div className="flex flex-wrap items-end gap-3 py-2">
      {campos.map((c) => (
        <label key={c.clave} className="flex flex-col gap-1">
          <span className="t-label">{c.etiqueta}</span>
          {c.opciones ? (
            <select
              value={de(c)}
              onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
              className={cn(CAMPO, c.ancho ?? 'w-32')}
            >
              {c.opciones.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={de(c)}
              onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
              className={cn(CAMPO, c.ancho ?? 'w-32')}
            />
          )}
        </label>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="xs"
          disabled={!puedeGuardar}
          loading={fase === 'pending'}
          onClick={() => {
            setFase('pending');
            setError(null);
            onGuardar(cambios)
              .then(() => {
                setFase('success');
                onCerrar();
              })
              .catch((e: unknown) => {
                setFase('error');
                setError(mensaje(e, 'No se pudo guardar.'));
              });
          }}
        >
          <Check strokeWidth={2} className="mr-1 size-3" />
          Guardar
        </Button>
        <Button variant="ghost" size="xs" onClick={onCerrar}>
          Cancelar
        </Button>
        {invalido && (
          <span className="t-mono-xs text-[var(--text-warn)]">{invalido}</span>
        )}
        <AsyncStatus
          phase={error ? 'error' : fase}
          pendingLabel="Guardando"
          successLabel="Guardado"
          errorLabel={error}
        />
      </div>
    </div>
  );
}

/** La confirmación de baja, con el nombre delante y el 409 del backend tal cual. */
export function ConfirmacionDeBaja({
  nombre,
  etiquetaBaja = 'Dar de baja',
  onBaja,
  onCerrar,
}: {
  nombre: string;
  etiquetaBaja?: string | undefined;
  onBaja: () => Promise<unknown>;
  onCerrar: () => void;
}) {
  const [fase, setFase] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* El nombre delante: es lo que hace que el segundo clic sea una decisión. */}
        <span className="t-mono-xs text-[var(--text-warn)]">
          {etiquetaBaja} «{nombre}»?
        </span>
        <Button
          variant="danger"
          size="xs"
          loading={fase === 'pending'}
          onClick={() => {
            setFase('pending');
            setError(null);
            onBaja()
              .then(onCerrar)
              .catch((e: unknown) => {
                setFase('error');
                setError(mensaje(e, 'No se pudo dar de baja.'));
              });
          }}
        >
          Sí, dar de baja
        </Button>
        <Button variant="ghost" size="xs" onClick={onCerrar}>
          No
        </Button>
      </div>
      {/* El 409 del backend se muestra TAL CUAL: trae las cifras. */}
      {error && <span className="t-mono-xs text-[var(--state-critical)]">{error}</span>}
    </div>
  );
}
