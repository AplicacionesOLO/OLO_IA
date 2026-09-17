/**
 * GUÍA DE ARRANQUE — el orden para levantar un almacén nuevo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 *
 * El editor de plano es sofisticado —snapping, alineación, calibración de
 * escala— pero no dice en qué orden usar todo eso. Sin esta guía, alguien que
 * abre un almacén sin catálogo ni plano se encuentra un lienzo vacío y ningún
 * indicio de que el primer paso es «Importar el catálogo», ni de que colocar
 * racks sin calibrar antes coloca metros que no son metros.
 *
 * Los cinco pasos —catálogo → plano → calibrar → colocar → publicar— son
 * exactamente el camino que ya exige el propio editor: no se inventa ningún
 * orden nuevo, solo se hace visible el que ya había.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ DESAPARECE SOLA AL TERMINAR
 *
 * Es una guía de ARRANQUE, no un panel de estado permanente: un almacén ya
 * publicado no necesita que cinco marcas de verificación le ocupen espacio en
 * cada visita. Vuelve a aparecer sola si algo deja de estar completo —un
 * layout borrado, por ejemplo—, porque entonces sí hay algo que retomar.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Circle } from 'lucide-react';

import { Panel } from '../../../../design/foundation/Panel';
import { cn } from '../../../../design/utils/cn';
import { useLayoutPublicado, useWarehouses } from '../../services/useSpatial';
import { useEditorStore } from '../store';

interface Paso {
  id: string;
  etiqueta: string;
  hecho: boolean;
  detalle: string;
  enlace?: { to: string; texto: string } | undefined;
}

export function GuiaDeArranque({ warehouseId }: { warehouseId: string | null }) {
  const [abierta, setAbierta] = useState(true);
  const warehouses = useWarehouses();
  const plan = useEditorStore((s) => s.plan);
  const calibration = useEditorStore((s) => s.calibration);
  const racks = useEditorStore((s) => s.racks);
  const publicado = useLayoutPublicado(warehouseId);

  const almacen = warehouses.data?.find((w) => w.id === warehouseId);

  // Sin almacen resuelto todavia, o sin datos del almacen: nada que guiar.
  if (!warehouseId || !almacen) return null;

  const calibrado = calibration.measured ?? calibration.points != null;

  const pasos: Paso[] = [
    {
      id: 'catalogo',
      etiqueta: 'Importar el catálogo',
      hecho: almacen.hasCatalog,
      detalle: 'Racks, cuerpos y ubicaciones desde el xlsx del WMS.',
      enlace: almacen.hasCatalog ? undefined : { to: '/twin/catalogo', texto: 'Importar' },
    },
    {
      id: 'plano',
      etiqueta: 'Cargar el plano',
      hecho: plan !== null,
      detalle: 'La imagen de fondo sobre la que se calibra y se colocan los racks.',
    },
    {
      id: 'calibrar',
      etiqueta: 'Calibrar la escala',
      hecho: calibrado,
      detalle: 'Marcar dos puntos de distancia conocida para que el plano hable en metros.',
    },
    {
      id: 'colocar',
      etiqueta: 'Colocar los racks',
      hecho: racks.length > 0,
      detalle: 'Arrastrar los racks del catálogo sobre el plano ya calibrado.',
    },
    {
      id: 'publicar',
      etiqueta: 'Publicar',
      hecho: publicado.data?.publicado === true,
      detalle: 'Escribe la colocación en la base: es lo que ve el resto del equipo.',
    },
  ];

  const completos = pasos.filter((p) => p.hecho).length;

  // Todo listo: no hace falta seguir ocupando espacio. Vuelve a aparecer sola
  // en cuanto algo deje de estarlo.
  if (completos === pasos.length) return null;

  return (
    <Panel level="support" radius="lg" pad="none" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronDown
          strokeWidth={1.5}
          className={cn(
            'size-3.5 shrink-0 text-[var(--text-faint)] transition-transform',
            !abierta && '-rotate-90',
          )}
        />
        <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
          Arrancar este almacén
        </span>
        <span className="t-mono-xs ml-auto shrink-0 text-[var(--text-faint)]">
          {completos} de {pasos.length}
        </span>
      </button>

      {abierta && (
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          {pasos.map((p) => (
            <div key={p.id} className="flex items-start gap-2.5">
              {p.hecho ? (
                <Check
                  strokeWidth={2}
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--text-ok)]"
                />
              ) : (
                <Circle
                  strokeWidth={1.5}
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--text-faint)]"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'text-[length:var(--text-sm)]',
                      p.hecho ? 'text-[var(--text-faint)] line-through' : 'text-[var(--text-primary)]',
                    )}
                  >
                    {p.etiqueta}
                  </span>
                  {p.enlace && (
                    <Link
                      to={p.enlace.to}
                      className="t-mono-xs text-[var(--text-accent)] hover:underline"
                    >
                      {p.enlace.texto}
                    </Link>
                  )}
                </div>
                {!p.hecho && (
                  <p className="t-mono-xs text-[var(--text-faint)]">{p.detalle}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
