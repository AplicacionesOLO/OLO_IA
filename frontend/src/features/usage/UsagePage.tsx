/**
 * USO — cuanto consume el tenant este periodo (0112), y contra que cuota
 * (0113).
 *
 * Sin repositorio propio: son dos llamadas de lectura, y montar todo el
 * andamiaje de un modulo (dto/types/repository/provider) para eso seria mas
 * codigo que el propio dato -- mismo criterio que `useVincularVideo` en
 * `perception/usePerception.ts`, que tambien llama a `api` directo.
 *
 * Fijar la cuota es cosa de un platform owner (`PUT /v1/platform/tenants/
 * {id}/quotas`) -- esta pantalla es SOLO lectura, la del tenant de la sesion.
 */

import { useQuery } from '@tanstack/react-query';
import { Cpu, Radar, Smartphone, Workflow } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { CanvasHost } from '../../shell/CanvasHost';

interface UsageSummary {
  period_start: string;
  period_end: string;
  detecciones: number;
  trabajos_de_inspeccion: number;
  dispositivos_nuevos: number;
  dispositivos_registrados: number;
}

interface Quota {
  max_detections_monthly: number | null;
  max_devices: number | null;
  updated_at: string | null;
}

function useUsageSummary() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['usage', 'summary'],
    queryFn: () => api.get<UsageSummary>('/usage/summary'),
    staleTime: 60_000,
  });
}

function useQuota() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['usage', 'quota'],
    queryFn: () => api.get<Quota>('/usage/quotas'),
    staleTime: 60_000,
  });
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function Metrica({
  icono: Icono,
  valor,
  etiqueta,
  limite,
}: {
  icono: typeof Radar;
  valor: number;
  etiqueta: string;
  /** `null`/`undefined` = sin cuota fijada para esta metrica -- no se pinta barra. */
  limite?: number | null | undefined;
}) {
  const porcentaje = limite ? Math.min(100, Math.round((valor / limite) * 100)) : null;
  const cerca = porcentaje !== null && porcentaje >= 90;

  return (
    <Panel level="work" radius="lg" pad="lg" className="col-span-12 flex flex-col gap-2 sm:col-span-6 xl:col-span-3">
      <Icono strokeWidth={1.5} className="size-5 text-[var(--icon-accent)]" />
      <span className="font-[family-name:var(--font-data)] text-[length:var(--text-3xl)] text-[var(--text-primary)]">
        {valor.toLocaleString('es')}
        {limite != null && (
          <span className="text-[length:var(--text-md)] text-[var(--text-faint)]">
            {' '}
            / {limite.toLocaleString('es')}
          </span>
        )}
      </span>
      <span className="t-mono-xs text-[var(--text-faint)]">{etiqueta}</span>
      {porcentaje !== null && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-2)]">
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${porcentaje}%`,
              background: cerca ? 'var(--crimson-400)' : 'var(--accent)',
            }}
          />
        </div>
      )}
    </Panel>
  );
}

export function UsagePage() {
  const uso = useUsageSummary();
  const cuota = useQuota();
  const sinLimites = cuota.data && cuota.data.max_detections_monthly == null && cuota.data.max_devices == null;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div className="flex flex-col gap-1">
          <span className="t-label">Consumo del tenant</span>
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
            Uso
          </h1>
          {uso.data && (
            <p className="t-mono-xs text-[var(--text-faint)]">
              {fecha(uso.data.period_start)} — {fecha(uso.data.period_end)}
            </p>
          )}
        </div>

        {uso.isLoading && <p className="t-small text-[var(--text-faint)]">Cargando…</p>}

        {uso.isError && (
          <Panel level="work" radius="xl" pad="lg" className="text-center">
            <p className="t-body text-[var(--crimson-400)]">No se pudo cargar el consumo.</p>
            <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
              {uso.error instanceof Error ? uso.error.message : 'Error desconocido'}
            </p>
          </Panel>
        )}

        {uso.data && (
          <>
            <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
              <Metrica
                icono={Radar}
                valor={uso.data.detecciones}
                etiqueta="Detecciones procesadas"
                limite={cuota.data?.max_detections_monthly}
              />
              <Metrica
                icono={Workflow}
                valor={uso.data.trabajos_de_inspeccion}
                etiqueta="Trabajos de inspeccion"
              />
              <Metrica
                icono={Smartphone}
                valor={uso.data.dispositivos_nuevos}
                etiqueta="Dispositivos nuevos"
              />
              <Metrica
                icono={Cpu}
                valor={uso.data.dispositivos_registrados}
                etiqueta="Dispositivos activos ahora"
                limite={cuota.data?.max_devices}
              />
            </div>

            {sinLimites && (
              <Panel level="support" radius="lg" pad="md">
                <PanelHeader
                  title="Sin cuota fijada"
                  subtitle="Este tenant no tiene limite de detecciones ni de dispositivos"
                />
                <p className="t-mono-xs px-4 pb-4 text-[var(--text-faint)]">
                  Un platform owner puede fijar una desde la consola de plataforma. Sin cuota,
                  nada de lo de arriba bloquea nada.
                </p>
              </Panel>
            )}
          </>
        )}
      </div>
    </CanvasHost>
  );
}
