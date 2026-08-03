/**
 * SELECTOR DE ALMACEN — con los recuentos reales, no solo el nombre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS REGLAS QUE NO SON COSMETICAS
 *
 * 1. NUNCA SE AUTOSELECCIONA UN ALMACEN AL QUE EL USUARIO NO TIENE ACCESO.
 *
 *    El almacen activo se persiste en la sesion. Si el operador pierde el acceso a
 *    ese almacen —o simplemente entra otro usuario en el mismo navegador—, la
 *    seleccion guardada apunta a algo que RLS no deja ver, y todas las consultas
 *    devuelven 404. `useResolvedWarehouse` compara la seleccion contra la lista
 *    que el backend acaba de devolver y la descarta si no esta.
 *
 * 2. UN ALMACEN SIN CATALOGO SE MUESTRA, no se oculta.
 *
 *    El backend devuelve los almacenes accesibles aunque no tengan catalogo
 *    importado, con todos los recuentos a cero. Ocultarlos haria imposible
 *    distinguir «no tengo acceso» de «esta vacio», que son dos problemas con dos
 *    soluciones distintas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react';
import { AlertCircle, Warehouse } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import type { WarehouseOption } from '../types/index';

interface WarehousePickerProps {
  warehouses: WarehouseOption[];
  activeId: string | null;
  onChange: (id: string) => void;
  loading: boolean;
  className?: string;
}

export function WarehousePicker({
  warehouses,
  activeId,
  onChange,
  loading,
  className,
}: WarehousePickerProps) {
  const activo = warehouses.find((w) => w.id === activeId);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <label className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-3 [background:var(--glass-2)] shadow-[var(--rim-1)] focus-within:shadow-[var(--focus-ring)]">
        <Warehouse strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
        <select
          value={activeId ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading || warehouses.length === 0}
          aria-label="Seleccionar almacen"
          className="min-w-[200px] bg-transparent text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none"
        >
          {loading && <option value="">Cargando…</option>}
          {!loading && warehouses.length === 0 && (
            <option value="">Sin almacenes accesibles</option>
          )}
          {!loading && !activeId && <option value="">Selecciona un almacen…</option>}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
              {w.hasCatalog ? '' : ' (sin catalogo)'}
            </option>
          ))}
        </select>
      </label>

      {/* Los recuentos del almacen activo, a la vista. */}
      {activo && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {activo.hasCatalog ? (
            <>
              <Dato label="racks" value={activo.rackCount} />
              <Dato label="cuerpos" value={activo.bayCount} />
              <Dato label="ubicaciones" value={activo.locationCount} />
              {activo.lastImportAt && (
                <span className="t-mono-xs text-[var(--text-faint)]">
                  importado {formatFecha(activo.lastImportAt)}
                </span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-[var(--text-faint)]">
              <AlertCircle strokeWidth={1.5} className="size-3.5" />
              <span className="t-mono-xs">catalogo espacial sin importar</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Dato({ label, value }: { label: string; value: number }) {
  return (
    <span className="t-mono-xs text-[var(--text-faint)]">
      <span className="text-[var(--text-muted)] [font-variant-numeric:tabular-nums]">
        {value.toLocaleString('es')}
      </span>{' '}
      {label}
    </span>
  );
}

function formatFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Resuelve el almacen activo contra la lista que el backend acaba de devolver.
 *
 * Devuelve `null` mientras la lista carga —para no lanzar consultas con un id que
 * quiza no sea valido— y descarta una seleccion persistida que no aparezca en la
 * lista. Es la regla 1 de la cabecera, implementada en un solo sitio.
 *
 * NO autoselecciona cuando hay varias opciones REALES: elegir por el operador es
 * decidir cual es «su» almacen, y eso no lo sabe el frontend. Cuando no hay
 * ambigüedad si autoselecciona, y eso ocurre en dos casos:
 *
 *   · un solo almacen accesible
 *   · un solo almacen CON CATALOGO, aunque haya mas accesibles
 *
 * El segundo caso no es un adorno: `sessionStore.setProfile` preselecciona
 * `accessible_warehouse_ids[0]`, y para un usuario con acceso transversal
 * —`tenant_admin`— esa lista llega VACIA, porque su acceso no se enumera almacen
 * por almacen. Medido con `arojas@ologistics.com`: `accessible_warehouse_ids:
 * []` y dos almacenes en `/spatial/warehouses`, de los cuales solo OLO-CR tiene
 * estructura. Sin esta regla, el administrador abria el explorador y se quedaba
 * en «Selecciona un almacen» con 347 racks al otro lado de un desplegable: los
 * datos estaban y la pantalla parecia vacia.
 */
export function useResolvedWarehouse(
  warehouses: WarehouseOption[] | undefined,
  persistedId: string | null,
  onChange: (id: string) => void,
): string | null {
  const listaLista = warehouses != null;
  const existe = listaLista && persistedId != null && warehouses.some((w) => w.id === persistedId);

  useEffect(() => {
    if (!listaLista) return;

    // Seleccion persistida que ya no es accesible: se descarta en lugar de
    // dejarla producir 404 en cada consulta.
    if (persistedId != null && !existe) {
      onChange('');
      return;
    }

    if (persistedId != null) return;

    // Un solo almacen accesible: no hay nada que elegir.
    if (warehouses.length === 1) {
      onChange(warehouses[0]!.id);
      return;
    }

    // Un solo almacen explorable: tampoco hay ambigüedad. Los demas se siguen
    // ofreciendo en el desplegable, no se ocultan.
    const conCatalogo = warehouses.filter((w) => w.hasCatalog);
    if (conCatalogo.length === 1) {
      onChange(conCatalogo[0]!.id);
    }
  }, [listaLista, persistedId, existe, warehouses, onChange]);

  if (!listaLista) return null;
  return existe ? persistedId : null;
}
