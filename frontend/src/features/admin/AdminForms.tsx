/**
 * FORMULARIOS DE ALTA — la parte que faltaba de la configuración.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CADA FORMULARIO REPITE LA VALIDACIÓN DEL MOTOR, Y ES A PROPÓSITO
 *
 * Los patrones de `code` y `name` son los mismos CHECK que tiene la base
 * (`chk_client_code`, `chk_roles_name`). Validar aquí no sustituye al motor —sigue
 * siendo la autoridad— sino que permite decir «solo minúsculas y guion bajo» junto al
 * campo, en lugar de devolver una violación de restricción de Postgres cuando el
 * usuario ya pulsó Guardar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE UN FORMULARIO NO PUEDE OFRECER
 *
 * Ninguno acepta `tenant_id`, `version` ni `deleted_at`. El servidor los pone o los
 * ignora, y el repositorio filtra las columnas con una lista blanca.
 *
 * Y NO hay formulario de «crear usuario»: un usuario nuevo necesita identidad en
 * Supabase Auth además de la fila en `core.users`. Eso es un flujo de invitación con
 * correo, no un POST — y el permiso `users:invite` existe en el catálogo esperándolo.
 */

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { AsyncStatus, fase } from '../../design/foundation/AsyncStatus';
import { Button } from '../../design/primitives/Button';
import { cn } from '../../design/utils/cn';
import { ApiError } from '../../lib/apiErrors';
import type { AdminOverview } from './adminTypes';
import {
  useCreateClient,
  useCreateCompany,
  useCreateRole,
  useCreateWarehouse,
  useOpenCountry,
} from './useAdmin';

/** Mismos patrones que los CHECK del motor. Ver la cabecera. */
const PATRON_CODIGO_CLIENTE = /^[A-Z0-9][A-Z0-9_-]*$/;
const PATRON_CODIGO_ALMACEN = /^[A-Z0-9][A-Z0-9-]*$/;
const PATRON_NOMBRE_ROL = /^[a-z][a-z0-9_]*$/;

// ── Envoltorio común ────────────────────────────────────────────────────────

/**
 * Formulario plegable con su propio estado de guardado.
 *
 * Plegado por omisión: una sección de configuración con cinco formularios abiertos
 * empuja los datos —que es lo que se viene a consultar— fuera de la pantalla.
 */
function Formulario({
  etiqueta,
  children,
  onSubmit,
  fase: faseActual,
  error,
  puedeGuardar,
  onAbrir,
}: {
  etiqueta: string;
  children: React.ReactNode;
  onSubmit: () => void;
  fase: 'idle' | 'pending' | 'success' | 'error';
  error: string | null;
  puedeGuardar: boolean;
  onAbrir?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setAbierto(true);
          onAbrir?.();
        }}
      >
        <Plus strokeWidth={1.5} className="mr-1 size-3" />
        {etiqueta}
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (puedeGuardar) onSubmit();
      }}
      className="flex flex-col gap-3 rounded-[var(--radius-sm)] p-3 [background:var(--glass-2)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="t-label">{etiqueta}</span>
        <Button variant="ghost" size="xs" iconOnly aria-label="Cerrar" onClick={() => setAbierto(false)}>
          <X strokeWidth={1.5} className="size-3" />
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">{children}</div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          size="xs"
          disabled={!puedeGuardar}
          loading={faseActual === 'pending'}
        >
          Guardar
        </Button>
        <AsyncStatus
          phase={error ? 'error' : faseActual}
          pendingLabel="Guardando"
          successLabel="Creado"
          errorLabel={error}
        />
      </div>
    </form>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
  ancho = 'w-40',
  placeholder,
  invalido,
  ayuda,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  ancho?: string;
  placeholder?: string;
  invalido?: boolean;
  ayuda?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-label">{etiqueta}</span>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-8 rounded-[var(--radius-xs)] px-2 text-[length:var(--text-sm)] outline-none',
          ancho,
          invalido
            ? 'text-[var(--text-warn)] [background:color-mix(in_oklab,var(--state-alert)_10%,var(--glass-3))]'
            : 'text-[var(--text-primary)] [background:var(--glass-3)]',
        )}
      />
      {ayuda && (
        <span
          className={cn(
            't-mono-xs',
            invalido ? 'text-[var(--text-warn)]' : 'text-[var(--text-faint)]',
          )}
        >
          {ayuda}
        </span>
      )}
    </label>
  );
}

function Selector({
  etiqueta,
  valor,
  onChange,
  opciones,
  ancho = 'w-52',
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  opciones: { value: string; label: string }[];
  ancho?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-label">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 rounded-[var(--radius-xs)] px-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none [background:var(--glass-3)]',
          ancho,
        )}
      >
        <option value="">Elige una</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function mensaje(e: unknown, porOmision: string): string {
  return e instanceof ApiError ? e.message : porOmision;
}

// ── Abrir un país ───────────────────────────────────────────────────────────

/**
 * No crea un país: abre uno del catálogo global para este operador.
 *
 * Los ya abiertos se excluyen de la lista — el servidor responde 409 y ofrecerlos
 * sería ofrecer un error.
 */
export function FormAbrirPais({ d }: { d: AdminOverview }) {
  const abrir = useOpenCountry();
  const [pais, setPais] = useState('');
  const [moneda, setMoneda] = useState('');
  const [zona, setZona] = useState('America/Costa_Rica');
  const [error, setError] = useState<string | null>(null);

  const yaAbiertos = new Set(d.tenant_countries.map((tc) => tc.country_id));
  const disponibles = d.countries.filter((c) => !yaAbiertos.has(c.id));
  const elegido = d.countries.find((c) => c.id === pais);

  return (
    <Formulario
      etiqueta="Abrir un país"
      fase={fase(abrir)}
      error={error}
      puedeGuardar={pais !== '' && moneda.length === 3}
      onSubmit={() => {
        setError(null);
        abrir.mutate(
          {
            country_id: pais,
            default_currency_code: moneda.toUpperCase(),
            default_timezone: zona,
          },
          {
            onSuccess: () => {
              setPais('');
              setMoneda('');
            },
            onError: (e) => setError(mensaje(e, 'no se pudo abrir el país')),
          },
        );
      }}
    >
      <Selector
        etiqueta="país"
        valor={pais}
        onChange={(v) => {
          setPais(v);
          // La moneda por omisión del propio catálogo: teclearla a mano invita a
          // escribir «CRC» donde el país usa otra.
          const c = d.countries.find((x) => x.id === v);
          if (c?.default_currency_code) setMoneda(c.default_currency_code);
        }}
        opciones={disponibles.map((c) => ({ value: c.id, label: `${c.name_es} (${c.iso_code})` }))}
      />
      <Campo
        etiqueta="moneda"
        valor={moneda}
        onChange={(v) => setMoneda(v.toUpperCase().slice(0, 3))}
        ancho="w-20"
        placeholder="CRC"
        invalido={moneda !== '' && moneda.length !== 3}
        ayuda={elegido?.default_currency_code ? `del catálogo: ${elegido.default_currency_code}` : '3 letras'}
      />
      <Campo etiqueta="zona horaria" valor={zona} onChange={setZona} ancho="w-52" />
    </Formulario>
  );
}

// ── Entidad legal ───────────────────────────────────────────────────────────

export function FormCrearCompany({ d }: { d: AdminOverview }) {
  const crear = useCreateCompany();
  const [pais, setPais] = useState('');
  const [nombre, setNombre] = useState('');
  const [razon, setRazon] = useState('');
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Formulario
      etiqueta="Nueva entidad legal"
      fase={fase(crear)}
      error={error}
      puedeGuardar={pais !== '' && nombre.trim().length >= 2}
      onSubmit={() => {
        setError(null);
        crear.mutate(
          {
            tenant_country_id: pais,
            name: nombre.trim(),
            legal_name: razon.trim() || null,
            tax_id: cedula.trim() || null,
          },
          {
            onSuccess: () => {
              setNombre('');
              setRazon('');
              setCedula('');
            },
            onError: (e) => setError(mensaje(e, 'no se pudo crear la entidad legal')),
          },
        );
      }}
    >
      <Selector
        etiqueta="país (ya abierto)"
        valor={pais}
        onChange={setPais}
        opciones={d.tenant_countries.map((tc) => ({ value: tc.id, label: tc.name_es }))}
      />
      <Campo etiqueta="nombre" valor={nombre} onChange={setNombre} placeholder="OLO Venezuela" />
      <Campo etiqueta="razón social" valor={razon} onChange={setRazon} ancho="w-52" />
      <Campo etiqueta="cédula jurídica" valor={cedula} onChange={setCedula} ancho="w-36" />
    </Formulario>
  );
}

// ── Cliente ─────────────────────────────────────────────────────────────────

export function FormCrearCliente({ d }: { d: AdminOverview }) {
  const crear = useCreateClient();
  const [empresa, setEmpresa] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [razon, setRazon] = useState('');
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);

  const codigoOk = codigo === '' || PATRON_CODIGO_CLIENTE.test(codigo);

  return (
    <Formulario
      etiqueta="Nuevo cliente"
      fase={fase(crear)}
      error={error}
      puedeGuardar={empresa !== '' && codigo !== '' && codigoOk && nombre.trim().length >= 2}
      onAbrir={() => {
        // Con una sola entidad legal no hay nada que elegir: se preselecciona.
        if (d.companies.length === 1) setEmpresa(d.companies[0]!.id);
      }}
      onSubmit={() => {
        setError(null);
        crear.mutate(
          {
            company_id: empresa,
            code: codigo,
            name: nombre.trim(),
            legal_name: razon.trim() || null,
            tax_id: cedula.trim() || null,
          },
          {
            onSuccess: () => {
              setCodigo('');
              setNombre('');
              setRazon('');
              setCedula('');
            },
            onError: (e) => setError(mensaje(e, 'no se pudo crear el cliente')),
          },
        );
      }}
    >
      <Selector
        etiqueta="atendido por"
        valor={empresa}
        onChange={setEmpresa}
        opciones={d.companies.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Campo
        etiqueta="código"
        valor={codigo}
        onChange={(v) => setCodigo(v.toUpperCase())}
        ancho="w-28"
        placeholder="EPA"
        invalido={!codigoOk}
        ayuda={codigoOk ? 'mayúsculas, sin espacios' : 'solo A-Z, 0-9, guion y guion bajo'}
      />
      <Campo etiqueta="nombre" valor={nombre} onChange={setNombre} placeholder="EPA" />
      <Campo etiqueta="razón social" valor={razon} onChange={setRazon} ancho="w-52" />
      <Campo etiqueta="cédula jurídica" valor={cedula} onChange={setCedula} ancho="w-36" />
    </Formulario>
  );
}

// ── Almacén ─────────────────────────────────────────────────────────────────

/**
 * Crea un almacén. Va contra `POST /v1/warehouses`, que ya existía.
 *
 * El almacén nace SIN catálogo espacial: la estructura se importa después con
 * `tools/import_spatial_catalog.py`. Se dice en el formulario para que nadie espere
 * ver racks al terminar.
 */
export function FormCrearAlmacen({ d }: { d: AdminOverview }) {
  const crear = useCreateWarehouse();
  const [empresa, setEmpresa] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);

  const codigoOk = codigo === '' || PATRON_CODIGO_ALMACEN.test(codigo);

  return (
    <Formulario
      etiqueta="Nuevo almacén"
      fase={fase(crear)}
      error={error}
      puedeGuardar={empresa !== '' && codigo !== '' && codigoOk && nombre.trim().length >= 2}
      onAbrir={() => {
        if (d.companies.length === 1) setEmpresa(d.companies[0]!.id);
      }}
      onSubmit={() => {
        setError(null);
        crear.mutate(
          { company_id: empresa, code: codigo, name: nombre.trim() },
          {
            onSuccess: () => {
              setCodigo('');
              setNombre('');
            },
            onError: (e) => setError(mensaje(e, 'no se pudo crear el almacén')),
          },
        );
      }}
    >
      <Selector
        etiqueta="entidad legal"
        valor={empresa}
        onChange={setEmpresa}
        opciones={d.companies.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Campo
        etiqueta="código"
        valor={codigo}
        onChange={(v) => setCodigo(v.toUpperCase())}
        ancho="w-32"
        placeholder="OLO-VE"
        invalido={!codigoOk}
        ayuda={codigoOk ? 'mayúsculas y guion' : 'solo A-Z, 0-9 y guion. Sin espacios'}
      />
      <Campo etiqueta="nombre" valor={nombre} onChange={setNombre} ancho="w-56" />
      <p className="t-mono-xs w-full text-[var(--text-faint)]">
        Nace sin catálogo espacial: la estructura de racks se importa aparte con{' '}
        <code>tools/import_spatial_catalog.py</code>. No esperes ver ubicaciones al
        terminar.
      </p>
    </Formulario>
  );
}

// ── Rol ─────────────────────────────────────────────────────────────────────

/**
 * Crea un rol PROPIO del tenant. Es lo que desbloquea la matriz de permisos.
 *
 * Los 5 roles del sistema son globales y de solo lectura. Sin un rol propio, la matriz
 * entera es un mirador.
 */
export function FormCrearRol({ d }: { d: AdminOverview }) {
  const crear = useCreateRole();
  const [nombre, setNombre] = useState('');
  const [desc, setDesc] = useState('');
  const [padre, setPadre] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nombreOk = nombre === '' || PATRON_NOMBRE_ROL.test(nombre);

  return (
    <Formulario
      etiqueta="Nuevo rol del tenant"
      fase={fase(crear)}
      error={error}
      puedeGuardar={nombre.length >= 2 && nombreOk}
      onSubmit={() => {
        setError(null);
        crear.mutate(
          {
            name: nombre,
            description: desc.trim() || null,
            parent_role_id: padre || null,
          },
          {
            onSuccess: () => {
              setNombre('');
              setDesc('');
              setPadre('');
            },
            onError: (e) => setError(mensaje(e, 'no se pudo crear el rol')),
          },
        );
      }}
    >
      <Campo
        etiqueta="nombre"
        valor={nombre}
        onChange={(v) => setNombre(v.toLowerCase().replace(/\s+/g, '_'))}
        ancho="w-44"
        placeholder="jefe_de_turno"
        invalido={!nombreOk}
        ayuda={nombreOk ? 'minúsculas y guion bajo' : 'empieza por letra; solo a-z, 0-9 y _'}
      />
      <Campo etiqueta="descripción" valor={desc} onChange={setDesc} ancho="w-64" />
      <Selector
        etiqueta="hereda de (opcional)"
        valor={padre}
        onChange={setPadre}
        opciones={d.roles.map((r) => ({
          value: r.id,
          label: r.name + (r.is_global ? ' (sistema)' : ''),
        }))}
      />
      <p className="t-mono-xs w-full text-[var(--text-faint)]">
        Un rol propio del tenant <strong>sí</strong> admite cambios en la matriz. Heredar
        de uno del sistema es la forma de partir de un conjunto de permisos conocido.
      </p>
    </Formulario>
  );
}
