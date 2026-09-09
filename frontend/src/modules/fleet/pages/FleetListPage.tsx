/**
 * FLEET LIST — la flota de dispositivos de borde (0110), en vivo.
 *
 * ── QUE ES "EN VIVO" AQUI, Y QUE NO ES ──────────────────────────────────────
 *
 * A diferencia del listado de Percepcion, esta pantalla NUNCA deja de sondear:
 * un trabajo de inferencia termina y su tarjeta se congela, pero la flota
 * siempre puede tener un dispositivo que se conecte o se apague al segundo
 * siguiente. Ver `useFleetDevices` — 2 s fijos, sin condicion de parada.
 *
 * Los RETIRADOS se muestran siempre, igual que las archivadas de Percepcion:
 * "este telefono se dio de baja" es un hecho, no una fila que deba desaparecer.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Cpu, PlaneTakeoff, Plus, Radio, Smartphone, X } from 'lucide-react';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { Input } from '../../../design/primitives/Input';
import { StatusIndicator, type IndicatorState } from '../../../design/primitives/StatusIndicator';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { CanvasHost } from '../../../shell/CanvasHost';
import {
  useFleetDevices,
  useFleetWarehouses,
  useProvisionDevice,
  useReactivateDevice,
  useRetireDevice,
} from '../useFleet';
import type { DeviceKind, DeviceStatus, FleetDevice, FleetDeviceProvisioned } from '../types';

const KIND_ICON: Record<DeviceKind, typeof Smartphone> = {
  phone: Smartphone,
  drone: PlaneTakeoff,
  onboard_compute: Cpu,
};

const KIND_LABEL: Record<DeviceKind, string> = {
  phone: 'Telefono',
  drone: 'Dron',
  onboard_compute: 'Compute embarcado',
};

const STATUS_LABEL: Record<DeviceStatus, string> = {
  connected: 'Conectado',
  live: 'En vivo',
  offline: 'Apagado',
  out_of_service: 'Fuera de uso',
};

/** `out_of_service` no tiene glifo propio en StatusIndicator -- se muestra
 * como Badge critico aparte (ver el render de la tarjeta) en vez de forzar
 * un estado que no significa lo que dice. */
const STATUS_INDICATOR: Record<DeviceStatus, IndicatorState> = {
  connected: 'idle',
  live: 'idle',
  offline: 'offline',
  // Nunca se lee de verdad: el render muestra el Badge critico en su lugar
  // (ver DeviceCard). Presente solo para que el mapa cubra las 4 claves.
  out_of_service: 'offline',
};

function hacecuanto(iso: string): string {
  const segundos = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (segundos < 60) return `hace ${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

export function FleetListPage() {
  const flota = useFleetDevices(true);
  const dispositivos = flota.data?.devices ?? [];
  const enLinea = flota.data?.online ?? 0;
  const [agregando, setAgregando] = useState(false);
  const [provisionado, setProvisionado] = useState<FleetDeviceProvisioned | null>(null);

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-label">Dispositivos de borde</span>
            <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              Flota
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {dispositivos.length > 0 && (
              <span className="t-mono-xs flex items-center gap-1.5 text-[var(--text-accent)]">
                <span className="size-1.5 animate-pulse rounded-full bg-[var(--text-accent)]" />
                {enLinea} de {dispositivos.length} operativos ahora
              </span>
            )}
            <Button variant="primary" size="sm" onClick={() => setAgregando(true)}>
              <Plus strokeWidth={1.5} className="mr-1.5 size-3.5" />
              Agregar dispositivo
            </Button>
          </div>
        </div>

        {agregando && (
          <ProvisionarDispositivoPanel
            onCerrar={() => setAgregando(false)}
            onListo={(p) => {
              setAgregando(false);
              setProvisionado(p);
            }}
          />
        )}

        {provisionado && (
          <CredencialModal provisionado={provisionado} onCerrar={() => setProvisionado(null)} />
        )}

        {/* Loading */}
        {flota.isLoading && <p className="t-small text-[var(--text-faint)]">Cargando…</p>}

        {/*
          Error -- SIN esto, cualquier fallo (401, 403 sin permiso drones:read,
          red caida) dejaba la pantalla en blanco: ni el loading ni el vacio se
          cumplen cuando `flota.data` nunca llega a existir. Una pantalla en
          blanco no dice si no hay flota o si la peticion nunca funciono, y son
          dos problemas completamente distintos de resolver.
        */}
        {flota.isError && (
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <p className="t-body text-[var(--crimson-400)]">No se pudo cargar la flota.</p>
            <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
              {flota.error instanceof Error ? flota.error.message : 'Error desconocido'}
            </p>
          </Panel>
        )}

        {/* Empty */}
        {flota.data && dispositivos.length === 0 && (
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <Radio strokeWidth={1.25} className="mx-auto mb-4 size-8 text-[var(--icon-accent)]" />
            <p className="t-body text-[var(--text-secondary)]">
              Ningun dispositivo se ha anunciado todavia.
            </p>
            <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
              Un telefono con la app de borde instalada aparece aqui solo con abrirla — ver{' '}
              ADR-015.
            </p>
          </Panel>
        )}

        {/* Device grid */}
        {dispositivos.length > 0 && (
          <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
            {dispositivos.map((d) => (
              <DeviceCard key={d.id} device={d} />
            ))}
          </div>
        )}
      </div>
    </CanvasHost>
  );
}

function DeviceCard({ device }: { device: FleetDevice }) {
  const [retirando, setRetirando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const retirar = useRetireDevice();
  const reactivar = useReactivateDevice();

  const Icono = KIND_ICON[device.kind];
  const fueraDeUso = device.status === 'out_of_service';

  return (
    <Panel level="work" radius="lg" pad="md" className="col-span-12 flex flex-col gap-3 md:col-span-6 xl:col-span-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icono strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-[var(--icon-accent)]" />
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-md)] text-[var(--text-primary)]">{device.name}</p>
            <p className="t-mono-xs text-[var(--text-faint)]">{KIND_LABEL[device.kind]}</p>
          </div>
        </div>
        {fueraDeUso ? (
          <Badge tone="critical" size="sm">FUERA DE USO</Badge>
        ) : (
          <StatusIndicator
            state={STATUS_INDICATOR[device.status]}
            live={device.status === 'live'}
            label={STATUS_LABEL[device.status]}
          />
        )}
      </div>

      {/* En vivo: enlace directo al trabajo que esta subiendo ahora mismo. */}
      {device.status === 'live' && device.currentJobId && (
        <Link
          to={`/perception/jobs/${device.currentJobId}`}
          className="t-mono-xs flex items-center gap-1.5 text-[var(--text-accent)] hover:underline"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-[var(--text-accent)]" />
          Ver el trabajo en directo →
        </Link>
      )}

      <div className="flex flex-col gap-0.5 text-[var(--text-faint)]">
        <span className="t-mono-xs">{device.deviceModel ?? 'modelo desconocido'}</span>
        <span className="t-mono-xs">
          {device.appVersion ? `v${device.appVersion} · ` : ''}
          {device.status === 'offline' ? 'ultima vez ' : 'visto '}
          {hacecuanto(device.lastSeenAt)}
        </span>
      </div>

      {fueraDeUso && device.retiredReason && (
        <p className="t-mono-xs text-[var(--crimson-400)]">Motivo: {device.retiredReason}</p>
      )}

      {/* Acciones — retirar o reactivar. Ver la cabecera de la migracion 0110:
          es una decision humana, no algo que el latido pueda deshacer solo. */}
      <div className="mt-auto pt-2">
        {fueraDeUso ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => reactivar.mutate(device.id)}
            disabled={reactivar.isPending}
          >
            Reactivar
          </Button>
        ) : retirando ? (
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Motivo (opcional)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              reserveMessageSpace={false}
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  retirar.mutate({ deviceId: device.id, ...(motivo ? { reason: motivo } : {}) });
                  setRetirando(false);
                  setMotivo('');
                }}
                disabled={retirar.isPending}
              >
                Confirmar retiro
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRetirando(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setRetirando(true)}>
            Marcar fuera de uso
          </Button>
        )}
      </div>
    </Panel>
  );
}

/**
 * Alta de un dispositivo CON credencial propia -- distinto de que el
 * dispositivo aparezca solo con abrir la app (eso sigue funcionando igual,
 * ver el panel vacio de arriba). Esto es para darle una identidad que no sea
 * la contraseña de una persona -- ver `FleetService.provision` en el backend.
 */
function ProvisionarDispositivoPanel({
  onCerrar,
  onListo,
}: {
  onCerrar: () => void;
  onListo: (p: FleetDeviceProvisioned) => void;
}) {
  const almacenes = useFleetWarehouses();
  const provisionar = useProvisionDevice();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<DeviceKind>('phone');
  const [almacenId, setAlmacenId] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel level="decision" radius="xl" pad="md" className="flex flex-col gap-3">
      <PanelHeader
        title="Agregar dispositivo"
        subtitle="Crea una identidad propia para el dispositivo -- no la de una persona"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          placeholder="Nombre (p. ej. S21 Fase 1)"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          reserveMessageSpace={false}
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as DeviceKind)}
          className="h-9 rounded-[var(--radius-sm)] border-0 bg-[var(--glass-2)] px-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]"
        >
          <option value="phone">Telefono</option>
          <option value="drone">Dron</option>
          <option value="onboard_compute">Compute embarcado</option>
        </select>
        <select
          value={almacenId}
          onChange={(e) => setAlmacenId(e.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border-0 bg-[var(--glass-2)] px-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]"
        >
          <option value="">Elige un almacen...</option>
          {(almacenes.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="t-mono-xs text-[var(--crimson-400)]">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!nombre.trim() || !almacenId || provisionar.isPending}
          onClick={() => {
            setError(null);
            provisionar
              .mutateAsync({ warehouseId: almacenId, kind: tipo, name: nombre.trim() })
              .then(onListo)
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'No se pudo crear el dispositivo.'),
              );
          }}
        >
          Crear credencial
        </Button>
        <Button variant="ghost" size="sm" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </Panel>
  );
}

/**
 * El secreto se muestra UNA sola vez -- igual que cualquier API key. Cerrar
 * este modal sin copiarlo significa retirar el dispositivo y crear uno
 * nuevo: el backend no lo vuelve a guardar en ningun sitio legible.
 */
function CredencialModal({
  provisionado,
  onCerrar,
}: {
  provisionado: FleetDeviceProvisioned;
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onCerrar}
    >
      <Panel
        level="decision"
        radius="xl"
        pad="lg"
        className="flex w-full max-w-lg flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="t-body text-[var(--text-primary)]">
              {provisionado.device.name}, creado
            </p>
            <p className="t-mono-xs text-[var(--text-faint)]">
              Esta credencial NO se vuelve a mostrar. Copiala y configurala en el dispositivo
              ahora.
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="shrink-0 text-[var(--text-faint)]">
            <X strokeWidth={1.5} className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--glass-2)] p-3">
          <code className="flex-1 break-all font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            {provisionado.refreshToken}
          </code>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              void navigator.clipboard.writeText(provisionado.refreshToken);
              setCopiado(true);
            }}
          >
            {copiado ? 'Copiado' : <Copy strokeWidth={1.5} className="size-3.5" />}
          </Button>
        </div>
        <Button variant="secondary" size="sm" onClick={onCerrar}>
          Ya la copie
        </Button>
      </Panel>
    </div>
  );
}
