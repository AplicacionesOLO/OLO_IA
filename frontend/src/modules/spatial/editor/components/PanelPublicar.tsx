/**
 * PUBLICAR EL LAYOUT — de borrador de este navegador a plano del almacen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE ES PUBLICAR Y POR QUE ES UN BOTON Y NO UN AUTOGUARDADO
 *
 * El borrador se guarda solo cada 900 ms y no sale del navegador. Publicar lo
 * escribe en la base, donde lo ve todo el tenant y de donde lo leera el visor 3D.
 *
 * Es una decision, no un guardado: colocar 347 racks son varias sesiones, y
 * publicar en cada arrastre convertiria el plano a medias de una persona en el
 * plano oficial del almacen durante toda la tarde. Igual que un archivo abierto no
 * es el archivo guardado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES COSAS QUE ESTE PANEL DICE Y NO CALLA
 *
 *   1. LO QUE NO SE PUBLICO. Un rack cuyo codigo no existe en el almacen se queda
 *      fuera —lo rechazaria la clave foranea— y publicar 346 de 347 en silencio
 *      seria peor que fallar: nadie mira el rack que falta. Se listan con motivo.
 *
 *   2. QUE LA IMAGEN NO VIAJA. El backend guarda el NOMBRE del archivo del plano,
 *      no sus bytes. Quien abra este layout en otro navegador vera los racks en su
 *      sitio y tendra que cargar la misma imagen; el nombre esta ahi para eso.
 *
 *   3. SI SE PUBLICA SIN CALIBRAR. Sin escala medida las posiciones estan en
 *      50 px/m, que es un valor de dibujo. Se permite —guardar el trabajo a medias
 *      es legitimo— pero se dice antes, con la confirmacion delante, porque
 *      descubrirlo al medir sobre el mapa es tarde.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE RETIRAR PIDE ESCRIBIR
 *
 * Retirar borra la colocacion de TODOS los racks del almacen, y es el unico dato
 * de este modulo que ninguna importacion puede regenerar: el DWG del almacen no
 * contiene los codigos del WMS, asi que «esta hilera es RCL01» solo existe porque
 * alguien lo coloco a mano. Un boton con un «¿seguro?» de un clic no esta a la
 * altura de perder eso, asi que hay que escribir el codigo del almacen.
 */

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CloudUpload, RefreshCw, Trash2, Users } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Modal } from '../../../../design/foundation/Modal';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';
import { humanMessage } from '../../../../lib/apiErrors';
import { ApiError } from '../../../../lib/apiErrors';
import type { FloorPlanCell } from '../../types/index';
import type { ResultadoPublicacion } from '../../repositories/ApiLayoutRepository';
import type { RackNoPublicable } from '../../repositories/publicacion';
import { spatialKeys } from '../../services/queryKeys';
import { useLayoutRemoto } from '../../services/SpatialProvider';
import { useLayoutPublicado } from '../../services/useSpatial';
import { useEditorStore } from '../store';

interface Props {
  warehouseId: string;
  /** Codigo del almacen. Es lo que hay que escribir para retirar. */
  warehouseCode: string;
  /** El catalogo completo: de aqui sale la traduccion codigo → uuid. */
  catalogo: readonly FloorPlanCell[];
  /** Se llama tras traer lo publicado, para que el editor lo abra. */
  onAbrirPublicado: () => void;
}

export function PanelPublicar({
  warehouseId,
  warehouseCode,
  catalogo,
  onAbrirPublicado,
}: Props) {
  const remoto = useLayoutRemoto();
  const qc = useQueryClient();
  const racks = useEditorStore((s) => s.racks);
  const calibration = useEditorStore((s) => s.calibration);
  const construirBorrador = useEditorStore((s) => s.buildDraft);

  const [confirmar, setConfirmar] = useState(false);
  const [retirando, setRetirando] = useState(false);
  const [codigoEscrito, setCodigoEscrito] = useState('');
  const [excluidos, setExcluidos] = useState<RackNoPublicable[] | null>(null);
  /**
   * Lo que dejo la ultima publicacion de ESTA sesion. No sale del estado remoto
   * porque no es un estado: es el recibo de una accion, y decir «se calcularon
   * 1.800 posiciones» es lo que convierte publicar en algo con consecuencias
   * visibles en lugar de un boton que parece no hacer nada.
   */
  const [recibo, setRecibo] = useState<ResultadoPublicacion | null>(null);

  // La MISMA consulta que lee el explorador, no una propia: publicar aqui tiene que
  // dejar aquella pantalla mostrando el layout nuevo.
  const clave = spatialKeys.layout(warehouseId);
  const publicado = useLayoutPublicado(warehouseId);

  /**
   * Codigo → uuid. Se construye del catalogo que la pantalla YA tiene: pedirlo
   * otra vez al publicar seria pagar dos veces las 347 filas.
   */
  const codigoARackId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalogo) m.set(c.rackCode, c.rackId);
    return m;
  }, [catalogo]);

  const calibrado = calibration.measured ?? calibration.points != null;

  const publicar = useMutation({
    mutationFn: () => remoto.publicar(warehouseId, construirBorrador(warehouseId), codigoARackId),
    onSuccess: (res) => {
      setConfirmar(false);
      setRecibo(res);
      // Solo se muestra la lista si hay algo que decir: un panel de «0 excluidos»
      // entrena a cerrarlo sin leer, y el dia que haya 7 tampoco se leera.
      setExcluidos(res.excluidos.length > 0 ? res.excluidos : null);
      // El estado sale de la RESPUESTA del PUT, que ya trae el layout completo, en
      // lugar de invalidar y volver a pedirlo: asi el panel no se queda diciendo
      // «sin publicar» durante el viaje de vuelta de una peticion redundante.
      qc.setQueryData(clave, res.layout);
    },
  });

  const retirar = useMutation({
    mutationFn: () => remoto.retirar(warehouseId),
    onSuccess: () => {
      setRetirando(false);
      setCodigoEscrito('');
      setRecibo(null);
      // Aqui SI se invalida: el DELETE no devuelve cuerpo (204), asi que no hay de
      // donde sacar el estado nuevo sin preguntarlo.
      void qc.invalidateQueries({ queryKey: clave });
    },
  });

  const abrirPublicado = useCallback(() => {
    void (async () => {
      const draft = await remoto.abrir(warehouseId, construirBorrador(warehouseId));
      if (draft) {
        useEditorStore.getState().applyDraft(draft);
        onAbrirPublicado();
      }
    })();
  }, [remoto, warehouseId, construirBorrador, onAbrirPublicado]);

  const est = publicado.data;
  const sinColocar = racks.length === 0;

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline-strong)] pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Publicado</span>
        <button
          type="button"
          onClick={() => void publicado.refetch()}
          className="t-mono-xs flex items-center gap-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
        >
          <RefreshCw
            strokeWidth={1.5}
            className={cn('size-3', publicado.isFetching && 'animate-spin')}
          />
          {publicado.isFetching ? 'leyendo…' : 'releer'}
        </button>
      </div>

      {publicado.isError ? (
        <p className="t-mono-xs text-[var(--state-alert)]">
          {publicado.error instanceof ApiError
            ? humanMessage(publicado.error)
            : 'No se pudo leer el layout publicado.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <Linea k="estado" v={est?.publicado ? 'publicado' : 'sin publicar'} />
          {est?.publicado && (
            <>
              <Linea k="racks en la base" v={String(est.racks.length)} />
              <Linea k="ultima publicacion" v={formatFecha(est.publishedAt)} />
              <Linea
                k="escala"
                v={est.calibrado ? 'medida' : 'sin medir — no son metros'}
              />
              <Linea k="plano" v={est.planName ?? 'sin nombre'} />
            </>
          )}
        </div>
      )}

      <p className="t-mono-xs flex gap-1.5 text-[var(--text-faint)]">
        <Users strokeWidth={1.5} className="mt-0.5 size-3 shrink-0" />
        <span>
          Publicar escribe la posicion de los racks en la base: la ve todo el equipo y
          de ahi la lee la vista 3D. La imagen del plano no viaja, solo su nombre.
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="xs"
          onClick={() => setConfirmar(true)}
          disabled={sinColocar || publicar.isPending}
        >
          <CloudUpload strokeWidth={1.5} className="size-3" />
          {publicar.isPending ? 'publicando…' : 'Publicar'}
        </Button>
        {est?.publicado && (
          <>
            <Button variant="secondary" size="xs" onClick={abrirPublicado}>
              Abrir publicado
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setRetirando(true)}>
              <Trash2 strokeWidth={1.5} className="size-3" />
              Retirar
            </Button>
          </>
        )}
      </div>

      {recibo && (
        <div className="flex flex-col gap-0.5 border-l-2 border-[var(--accent)]/40 pl-2">
          <span className="t-mono-xs text-[var(--text-muted)]">
            {recibo.guardados} racks publicados
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {recibo.ubicacionesDerivadas > 0
              ? `${recibo.ubicacionesDerivadas.toLocaleString('es')} ubicaciones con posicion en metros`
              : 'sin posiciones en metros: calibra el plano y vuelve a publicar'}
          </span>
        </div>
      )}

      {sinColocar && (
        <p className="t-mono-xs text-[var(--text-faint)]">
          Coloca al menos un rack en el plano para poder publicar.
        </p>
      )}

      {publicar.isError && (
        <p className="t-mono-xs text-[var(--state-alert)]">
          {publicar.error instanceof ApiError
            ? humanMessage(publicar.error)
            : 'No se pudo publicar.'}
        </p>
      )}

      {/* ── Confirmar publicacion ─────────────────────────────────────────── */}
      <Modal
        abierto={confirmar}
        titulo="Publicar el layout del almacen"
        descripcion={
          `Se guardaran ${racks.length} racks en la base y REEMPLAZARAN por completo ` +
          'lo que hubiera publicado. Lo vera todo el equipo.'
        }
        onCerrar={() => setConfirmar(false)}
        acciones={
          <>
            <Button variant="ghost" size="xs" onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="xs"
              onClick={() => publicar.mutate()}
              disabled={publicar.isPending}
            >
              {publicar.isPending ? 'publicando…' : 'Publicar'}
            </Button>
          </>
        }
      >
        {!calibrado && (
          <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--state-alert)]/40 bg-[var(--state-alert)]/8 p-2.5">
            <AlertTriangle
              strokeWidth={1.5}
              className="mt-0.5 size-3.5 shrink-0 text-[var(--state-alert)]"
            />
            <p className="t-mono-xs text-[var(--text-muted)]">
              El plano no esta calibrado: las posiciones se guardaran con la escala por
              defecto de {calibration.pixelsPerMeter} px/m, que no se ha medido. Se puede
              publicar, pero las coordenadas NO seran metros reales hasta que se calibre
              y se vuelva a publicar.
            </p>
          </div>
        )}
        {est?.publicado && (
          <p className="t-mono-xs text-[var(--text-faint)]">
            Ahora mismo hay {est.racks.length} racks publicados desde{' '}
            {formatFecha(est.publishedAt)}. Se sustituyen.
          </p>
        )}
      </Modal>

      {/* ── Confirmar retirada ────────────────────────────────────────────── */}
      <Modal
        abierto={retirando}
        titulo="Retirar el layout publicado"
        descripcion={
          'Se borrara la posicion de TODOS los racks del almacen. Ninguna importacion ' +
          'puede recuperarla: el plano del almacen no contiene los codigos del WMS, ' +
          'asi que esas posiciones existen solo porque alguien las coloco a mano.'
        }
        onCerrar={() => {
          setRetirando(false);
          setCodigoEscrito('');
        }}
        acciones={
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setRetirando(false);
                setCodigoEscrito('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="xs"
              onClick={() => retirar.mutate()}
              disabled={codigoEscrito.trim().toUpperCase() !== warehouseCode.toUpperCase()}
            >
              {retirar.isPending ? 'retirando…' : 'Retirar'}
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="t-mono-xs text-[var(--text-faint)]">
            Escribe <strong className="text-[var(--text-primary)]">{warehouseCode}</strong>{' '}
            para confirmar
          </span>
          <input
            value={codigoEscrito}
            onChange={(e) => setCodigoEscrito(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="t-mono-xs w-full rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--glass-1)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <p className="t-mono-xs text-[var(--text-faint)]">
          El borrador de este navegador NO se borra: solo se retira lo publicado.
        </p>
      </Modal>

      {/* ── Lo que se quedo fuera ─────────────────────────────────────────── */}
      <Modal
        abierto={excluidos !== null}
        titulo={`${excluidos?.length ?? 0} racks no se publicaron`}
        descripcion={
          'El resto si se guardo. Estos se quedaron fuera y el motivo de cada uno esta ' +
          'abajo: corrigelos en el plano y vuelve a publicar.'
        }
        onCerrar={() => setExcluidos(null)}
        acciones={
          <Button variant="secondary" size="xs" onClick={() => setExcluidos(null)}>
            Entendido
          </Button>
        }
      >
        <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {excluidos?.map((e) => (
            <li key={e.rackCode} className="flex items-baseline justify-between gap-3">
              <span className="t-mono-xs text-[var(--text-primary)]">{e.rackCode}</span>
              <span className="t-mono-xs text-right text-[var(--text-faint)]">{e.motivo}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-mono-xs text-[var(--text-faint)]">{k}</span>
      <span className="t-mono-xs text-right text-[var(--text-muted)]">{v}</span>
    </div>
  );
}

function formatFecha(iso: string | null): string {
  if (!iso) return '—';
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
