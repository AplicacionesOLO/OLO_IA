/**
 * ANOTADOR — dibujar cajas sobre una imagen y etiquetarlas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO EN COORDENADAS NORMALIZADAS 0..1, NUNCA EN PIXELES
 *
 * Es el formato nativo de YOLO y sobrevive a que la imagen se reescale. La
 * consecuencia práctica es que la conversión pantalla↔modelo pasa SIEMPRE por el
 * rectángulo RENDERIZADO del `<img>`, que se mide con `getBoundingClientRect()`.
 *
 * Usar `naturalWidth` sería el error clásico: el navegador escala una foto de
 * 4032x3024 para que quepa en 900 px de ancho, así que las cajas aparecerían
 * desplazadas y encogidas respecto a donde se dibujaron. Y `object-contain` añade
 * franjas vacías a los lados, que también hay que descontar — por eso el `<img>` se
 * mide a sí mismo en lugar de medir su contenedor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE DIV ABSOLUTOS Y NO CANVAS
 *
 * Las cajas son rectángulos con borde, etiqueta y tirador de redimensionado: en DOM
 * eso son tres nodos y el navegador se encarga del hit-testing, el foco y el
 * teclado. En canvas habría que reimplementar los cuatro, y además perder la
 * accesibilidad: aquí cada caja es un `<button>` que se puede tabular.
 *
 * El rack 3D sí usa canvas, y por el motivo contrario: 374 celdas con oclusión por
 * painter's algorithm no son nodos del DOM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL BORRADOR VIVE EN ESTA PANTALLA, NO EN LA CACHE
 *
 * Mientras se dibuja, el estado es local. Solo al guardar se envía el conjunto
 * completo. Es lo que permite deshacer, y lo que evita una petición por cada píxel
 * que se arrastra.
 *
 * La contrapartida es que salir sin guardar pierde el trabajo, así que hay aviso al
 * cerrar la pestaña y al cambiar de imagen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { Button } from '../../design/primitives/Button';
import { AsyncStatus, fase } from '../../design/foundation/AsyncStatus';
import { ConfirmBar } from '../../design/foundation/ConfirmBar';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { CanvasHost } from '../../shell/CanvasHost';
import { cn } from '../../design/utils/cn';
import { ApiError } from '../../lib/apiErrors';
import type { AiClass, AiImage, Annotation, AnnotationDraft } from '../../lib/aiTypes';
import { useClasses, useProject } from './useAi';
import { useImages, useSignedUrl } from './useAiAssets';
import { useAnnotations, useSaveAnnotations } from './useAnnotations';
import { NotOwnerNotice } from './NotOwnerNotice';

/** Una caja en el borrador. `id` solo si ya está guardada en el servidor. */
interface Caja {
  /** Clave local estable, para React. No es el `id` del servidor. */
  key: string;
  id?: string;
  classId: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Lado mínimo de una caja, en fracción de la imagen.
 *
 * Un clic sin arrastrar produciría una caja de 0x0 que el motor rechaza —`w > 0`— y
 * que además es invisible e imposible de seleccionar para borrarla. Por debajo de
 * este umbral el gesto se descarta en lugar de crear basura.
 */
const LADO_MINIMO = 0.01;

let contador = 0;
const nuevaClave = () => `caja-${(contador += 1)}`;

function aCaja(a: Annotation): Caja {
  return {
    key: nuevaClave(),
    id: a.id,
    classId: a.class_id,
    cx: a.cx ?? 0,
    cy: a.cy ?? 0,
    w: a.w ?? 0,
    h: a.h ?? 0,
  };
}

/** Recorta la caja para que quepa entera en la imagen, como exige el motor. */
function encajar(c: Caja): Caja {
  const w = Math.min(c.w, 1);
  const h = Math.min(c.h, 1);
  return {
    ...c,
    w,
    h,
    cx: Math.min(1 - w / 2, Math.max(w / 2, c.cx)),
    cy: Math.min(1 - h / 2, Math.max(h / 2, c.cy)),
  };
}

export function AiAnnotatePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();

  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);

  const proyecto = useProject(projectId);
  const clases = useClasses(projectId);
  // Sin filtro de estado: el anotador recorre TODAS las imágenes del proyecto, no
  // solo las pendientes. Filtrar por `pending` haría que una imagen desapareciera de
  // la secuencia justo al anotarla, y el «siguiente» saltaría de forma errática.
  const imagenes = useImages(projectId);

  const lista = useMemo(() => imagenes.data?.items ?? [], [imagenes.data]);
  const idUrl = params.get('image');
  const actual: AiImage | undefined =
    lista.find((i) => i.id === idUrl) ?? lista[0];
  const indice = actual ? lista.findIndex((i) => i.id === actual.id) : -1;

  const url = useSignedUrl(actual?.asset_id);
  const anotaciones = useAnnotations(actual?.id);
  const guardar = useSaveAnnotations(projectId ?? '', actual?.id ?? '');

  // ── Borrador ──────────────────────────────────────────────────────────────
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [sucio, setSucio] = useState(false);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [claseActiva, setClaseActiva] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Solo las ACTIVAS: una clase desactivada no puede recibir anotaciones nuevas —el
  // backend responde 422 `AI_CLASS_INACTIVE`—, así que ofrecerla en la paleta sería
  // ofrecer un gesto que falla al guardar, cuando ya hay diez cajas dibujadas.
  const activas = useMemo(
    () => (clases.data ?? []).filter((c) => c.is_active),
    [clases.data],
  );

  useEffect(() => {
    if (!claseActiva && activas.length > 0) setClaseActiva(activas[0]!.id);
  }, [activas, claseActiva]);

  // El borrador se rehace cuando llegan las anotaciones del servidor. La clave del
  // efecto es el id de la imagen: sin él, un `refetch` en segundo plano borraría lo
  // que se acaba de dibujar.
  const imagenCargada = useRef<string | null>(null);
  useEffect(() => {
    if (!actual || anotaciones.data === undefined) return;
    if (imagenCargada.current === actual.id) return;
    imagenCargada.current = actual.id;
    setCajas(anotaciones.data.map(aCaja));
    setSucio(false);
    setSeleccion(null);
    setError(null);
  }, [actual, anotaciones.data]);

  // ── Geometría: pantalla ↔ modelo ──────────────────────────────────────────
  const imgRef = useRef<HTMLImageElement | null>(null);

  /** Rectángulo renderizado del `<img>`. Ver la cabecera: nunca `naturalWidth`. */
  const marco = useCallback((): DOMRect | null => {
    const el = imgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }, []);

  const aModelo = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const r = marco();
      if (!r) return null;
      return {
        x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
      };
    },
    [marco],
  );

  // ── Dibujar una caja nueva ────────────────────────────────────────────────
  const [trazo, setTrazo] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Solo botón principal, y solo si hay clase elegida: dibujar sin clase crearía
      // una caja que no se puede guardar.
      if (e.button !== 0 || !claseActiva) return;
      const p = aModelo(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setSeleccion(null);
      setTrazo({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    },
    [aModelo, claseActiva],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!trazo) return;
      const p = aModelo(e.clientX, e.clientY);
      if (!p) return;
      setTrazo({ ...trazo, x1: p.x, y1: p.y });
    },
    [aModelo, trazo],
  );

  const onPointerUp = useCallback(() => {
    if (!trazo || !claseActiva) {
      setTrazo(null);
      return;
    }
    const w = Math.abs(trazo.x1 - trazo.x0);
    const h = Math.abs(trazo.y1 - trazo.y0);
    setTrazo(null);
    // Un clic sin arrastrar no es una caja. Ver `LADO_MINIMO`.
    if (w < LADO_MINIMO || h < LADO_MINIMO) return;

    const caja = encajar({
      key: nuevaClave(),
      classId: claseActiva,
      cx: (trazo.x0 + trazo.x1) / 2,
      cy: (trazo.y0 + trazo.y1) / 2,
      w,
      h,
    });
    setCajas((prev) => [...prev, caja]);
    setSeleccion(caja.key);
    setSucio(true);
  }, [trazo, claseActiva]);

  // ── Acciones sobre el borrador ────────────────────────────────────────────
  const borrarSeleccionada = useCallback(() => {
    if (!seleccion) return;
    setCajas((prev) => prev.filter((c) => c.key !== seleccion));
    setSeleccion(null);
    setSucio(true);
  }, [seleccion]);

  const reclasificar = useCallback(
    (classId: string) => {
      setClaseActiva(classId);
      // Con una caja seleccionada, elegir clase la RECLASIFICA. Es el gesto que se
      // espera: se ve una caja mal etiquetada, se pulsa la clase correcta.
      if (seleccion) {
        setCajas((prev) =>
          prev.map((c) => (c.key === seleccion ? { ...c, classId } : c)),
        );
        setSucio(true);
      }
    },
    [seleccion],
  );

  const descartar = useCallback(() => {
    setCajas((anotaciones.data ?? []).map(aCaja));
    setSeleccion(null);
    setSucio(false);
    setError(null);
  }, [anotaciones.data]);

  /** Guarda. `despues` permite la opción «guardar y seguir» sin duplicar la lógica. */
  const salvar = useCallback(
    (despues?: () => void) => {
      if (!actual) return;
      setError(null);
      const carga: AnnotationDraft[] = cajas.map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        class_id: c.classId,
        cx: c.cx,
        cy: c.cy,
        w: c.w,
        h: c.h,
      }));
      guardar.mutate(
        { annotations: carga, imageVersion: actual.version },
        {
          onSuccess: (datos) => {
            // Los `id` nuevos vienen del servidor. Se recarga el borrador con ellos o
            // el siguiente guardado insertaría las mismas cajas otra vez.
            setCajas(datos.annotations.map(aCaja));
            setSucio(false);
            setSeleccion(null);
            despues?.();
          },
          onError: (e) => {
            // Los mensajes se traducen AQUÍ. `AsyncStatus` no interpreta excepciones:
            // recibe texto para el operador, y «409 Conflict» no lo es.
            if (e instanceof ApiError && e.status === 409) {
              setError(
                'otra persona cambió esta imagen mientras la anotabas. Recárgala para ' +
                  'ver su versión — tus cajas sin guardar se perderán.',
              );
              return;
            }
            if (e instanceof ApiError && e.code === 'AI_CLASS_INACTIVE') {
              setError('una de las clases que usaste está desactivada. Cámbiala y reintenta.');
              return;
            }
            setError(e instanceof Error ? e.message : 'no se pudo guardar');
          },
        },
      );
    },
    [actual, cajas, guardar],
  );

  // ── Navegación entre imágenes ─────────────────────────────────────────────
  //
  // Con cajas sin guardar NO se usa `confirm()`: bloquea el navegador y solo admite
  // sí o no. La pregunta real es de TRES opciones —guardar y seguir, salir perdiendo,
  // quedarse—, y la que el operador quiere casi siempre es la primera. Un `confirm()`
  // la convierte en una amenaza binaria y encima pone el foco en la destructiva.
  const [pendienteDeIr, setPendienteDeIr] = useState<string | null>(null);

  const saltarA = useCallback(
    (imageId: string) => {
      const p = new URLSearchParams(params);
      p.set('image', imageId);
      setParams(p, { replace: true });
      setPendienteDeIr(null);
    },
    [params, setParams],
  );

  const irA = useCallback(
    (delta: number) => {
      if (indice < 0) return;
      const destino = lista[indice + delta];
      if (!destino) return;
      if (sucio) {
        setPendienteDeIr(destino.id);
        return;
      }
      saltarA(destino.id);
    },
    [indice, lista, saltarA, sucio],
  );

  // Aviso al cerrar la pestaña. El navegador ignora el texto y muestra el suyo, pero
  // el diálogo aparece — que es lo que evita perder media hora de trabajo.
  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sucio]);

  // ── Teclado ───────────────────────────────────────────────────────────────
  //
  // Anotar solo con ratón es lentísimo: cada caja son dos gestos —dibujar y elegir
  // clase— y con 17 imágenes de cinco cajas eso son 170 viajes al panel lateral.
  // Con las cifras 1..9 la clase se elige sin soltar el ratón.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const enCampo =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (enCampo) return;

      if (e.key >= '1' && e.key <= '9') {
        const clase = activas[Number(e.key) - 1];
        if (clase) {
          e.preventDefault();
          reclasificar(clase.id);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (seleccion) {
          e.preventDefault();
          borrarSeleccionada();
        }
        return;
      }
      if (e.key === 'Escape') {
        setSeleccion(null);
        setTrazo(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (sucio) salvar();
        return;
      }
      if (e.key === 'ArrowRight' && !e.shiftKey) irA(1);
      if (e.key === 'ArrowLeft' && !e.shiftKey) irA(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activas, borrarSeleccionada, irA, reclasificar, salvar, seleccion, sucio]);

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // El permiso se comprueba PRIMERO. Sin esta puerta, un usuario que no es platform
  // owner recibiría 403 en todas las consultas, `clases.data` llegaría vacío y la
  // pantalla diría «este proyecto no tiene clases» — un mensaje falso que le manda a
  // crear algo que no puede crear. El servidor sigue siendo la autoridad; esto solo
  // evita explicar mal el motivo.
  if (!esOwner) return <NotOwnerNotice />;

  if (proyecto.error instanceof ApiError && proyecto.error.code === 'NOT_PLATFORM_OWNER') {
    return <NotOwnerNotice />;
  }

  if (activas.length === 0 && !clases.isLoading) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="lg" pad="lg">
          <PanelHeader
            title="Este proyecto no tiene clases"
            subtitle="Sin clases no hay nada con lo que etiquetar una caja"
          />
          <Link to={`/ai/projects/${projectId}`} className="mt-4 inline-block">
            <Button variant="primary" size="sm">
              Crear las clases
            </Button>
          </Link>
        </Panel>
      </CanvasHost>
    );
  }

  if (!actual) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="lg" pad="lg">
          {/* Spread condicional: con `exactOptionalPropertyTypes`, pasar `undefined`
              explícito NO es lo mismo que omitir la prop. */}
          <PanelHeader
            title={imagenes.isLoading ? 'Cargando…' : 'No hay imágenes que anotar'}
            {...(imagenes.isLoading
              ? {}
              : { subtitle: 'Sube imágenes al dataset para poder anotar' })}
          />
          {!imagenes.isLoading && (
            <Link to={`/ai/projects/${projectId}/dataset`} className="mt-4 inline-block">
              <Button variant="primary" size="sm">
                Ir al dataset
              </Button>
            </Link>
          )}
        </Panel>
      </CanvasHost>
    );
  }

  const porClase = new Map(activas.map((c) => [c.id, c]));
  const previa = trazo
    ? {
        left: `${Math.min(trazo.x0, trazo.x1) * 100}%`,
        top: `${Math.min(trazo.y0, trazo.y1) * 100}%`,
        width: `${Math.abs(trazo.x1 - trazo.x0) * 100}%`,
        height: `${Math.abs(trazo.y1 - trazo.y0) * 100}%`,
      }
    : null;

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        {/* Cabecera */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              to={`/ai/projects/${projectId}/dataset`}
              className="t-mono-xs text-[var(--text-faint)] hover:underline"
            >
              ← Dataset de {proyecto.data?.name ?? 'proyecto'}
            </Link>
            <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight text-[var(--text-primary)]">
              Anotar
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Imagen anterior"
              title="Imagen anterior (←)"
              disabled={indice <= 0}
              onClick={() => irA(-1)}
            >
              <ChevronLeft strokeWidth={1.5} className="size-4" />
            </Button>
            <span className="t-mono-xs tabular-nums text-[var(--text-muted)]">
              {indice + 1} / {lista.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Imagen siguiente"
              title="Imagen siguiente (→)"
              disabled={indice >= lista.length - 1}
              onClick={() => irA(1)}
            >
              <ChevronRight strokeWidth={1.5} className="size-4" />
            </Button>
          </div>
        </div>

        {/*
          Confirmación de tres vías, en línea. Sustituye al `confirm()` del navegador:
          la opción que el operador quiere —guardar y seguir— no cabe en un sí/no, y
          el diálogo nativo además pondría el foco en la destructiva.
        */}
        <ConfirmBar
          open={pendienteDeIr !== null}
          message="Tienes cajas sin guardar en esta imagen."
          onCancel={() => setPendienteDeIr(null)}
          cancelLabel="Quedarme aquí"
          actions={[
            {
              label: 'Guardar y seguir',
              preferred: true,
              onClick: () => {
                const destino = pendienteDeIr;
                if (destino) salvar(() => saltarA(destino));
              },
            },
            {
              label: 'Salir sin guardar',
              destructive: true,
              onClick: () => {
                if (pendienteDeIr) saltarA(pendienteDeIr);
              },
            },
          ]}
        />

        <div className="flex flex-col gap-[var(--panel-gap)] lg:flex-row">
          {/* ── Lienzo ────────────────────────────────────────────────────── */}
          <Panel level="work" radius="lg" pad="none" className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="t-mono-xs truncate text-[var(--text-faint)]">
                {actual.original_filename ?? actual.id.slice(0, 8)}
              </p>
              <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
                {actual.status} · v{actual.version}
              </span>
            </div>

            {/*
              `select-none` y `touch-none`: sin ellos, arrastrar sobre la imagen
              selecciona texto en el escritorio y desplaza la página en tableta, y en
              los dos casos el gesto de dibujar se pierde a mitad.
            */}
            <div
              className="relative flex touch-none select-none items-center justify-center [background:var(--canvas-deep)]"
              style={{ minHeight: '52vh' }}
            >
              {url.data ? (
                <div className="relative">
                  <img
                    ref={imgRef}
                    src={url.data.url}
                    alt={actual.original_filename ?? 'imagen a anotar'}
                    // `max-h` en vh para que una foto vertical de 4032 px de alto no
                    // obligue a hacer scroll para ver la caja que se está dibujando.
                    className="block max-h-[68vh] w-auto max-w-full cursor-crosshair"
                    draggable={false}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => setTrazo(null)}
                  />

                  {/*
                    Las cajas van en una capa `absolute inset-0` sobre el `<img>` y en
                    porcentajes, así que escalan solas cuando la imagen se reajusta.
                    `pointer-events-none` en la capa para que el gesto de dibujar llegue
                    a la imagen; cada caja reactiva los suyos.
                  */}
                  <div className="pointer-events-none absolute inset-0">
                    {cajas.map((c) => {
                      const clase = porClase.get(c.classId);
                      const color = clase?.color ?? '#94A3B8';
                      const elegida = seleccion === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSeleccion(c.key);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          aria-label={`Caja ${clase?.name ?? 'sin clase'}`}
                          className={cn(
                            'pointer-events-auto absolute cursor-pointer',
                            elegida ? 'z-20' : 'z-10',
                          )}
                          style={{
                            left: `${(c.cx - c.w / 2) * 100}%`,
                            top: `${(c.cy - c.h / 2) * 100}%`,
                            width: `${c.w * 100}%`,
                            height: `${c.h * 100}%`,
                            border: `${elegida ? 2.5 : 1.5}px solid ${color}`,
                            background: `${color}1f`,
                            boxShadow: elegida ? `0 0 0 2px ${color}55` : 'none',
                          }}
                        >
                          {/*
                            La etiqueta va DENTRO de la caja, arriba a la izquierda.
                            Fuera se sale del lienzo en las cajas pegadas al borde
                            superior, que son la mayoría en un rack alto.
                          */}
                          <span
                            className="absolute left-0 top-0 max-w-full truncate px-1 text-[10px] leading-[14px]"
                            style={{ background: color, color: '#04070d' }}
                          >
                            {clase?.name ?? '?'}
                          </span>
                        </button>
                      );
                    })}

                    {previa && (
                      <div
                        aria-hidden
                        className="absolute z-30 border-2 border-dashed"
                        style={{
                          ...previa,
                          borderColor: porClase.get(claseActiva ?? '')?.color ?? '#94A3B8',
                          background: `${porClase.get(claseActiva ?? '')?.color ?? '#94A3B8'}14`,
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-16">
                  <ImageOff strokeWidth={1.5} className="size-6 text-[var(--text-faint)]" />
                  <AsyncStatus
                    phase={fase(url)}
                    pendingLabel="Cargando la imagen"
                    successLabel="Imagen cargada"
                    errorLabel="el enlace de la imagen caducó o no se pudo firmar"
                    onRetry={() => void url.refetch()}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="t-mono-xs text-[var(--text-faint)]">
                Arrastra sobre la imagen para dibujar · 1-9 elige clase · Supr borra ·
                ←→ cambia de imagen · Ctrl+S guarda
              </p>
            </div>
          </Panel>

          {/* ── Panel lateral ─────────────────────────────────────────────── */}
          <div className="flex w-full shrink-0 flex-col gap-[var(--panel-gap)] lg:w-[320px]">
            <Panel level="work" radius="lg" pad="lg">
              <PanelHeader
                title="Clases"
                subtitle="Con una caja elegida, pulsar una clase la reetiqueta"
              />
              <div className="mt-3 flex flex-col gap-1">
                {activas.map((c, i) => (
                  <BotonClase
                    key={c.id}
                    clase={c}
                    atajo={i + 1}
                    activa={claseActiva === c.id}
                    cuantas={cajas.filter((x) => x.classId === c.id).length}
                    onClick={() => reclasificar(c.id)}
                  />
                ))}
              </div>
            </Panel>

            <Panel level="work" radius="lg" pad="lg">
              <PanelHeader
                title={`Cajas · ${cajas.length}`}
                subtitle={sucio ? 'Hay cambios sin guardar' : 'Todo guardado'}
              />

              <div className="mt-3 flex max-h-[240px] flex-col gap-1 overflow-y-auto">
                {cajas.length === 0 && (
                  <p className="t-mono-xs text-[var(--text-faint)]">
                    Ninguna todavía. Arrastra sobre la imagen.
                  </p>
                )}
                {cajas.map((c) => {
                  const clase = porClase.get(c.classId);
                  return (
                    <div
                      key={c.key}
                      className={cn(
                        'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1',
                        seleccion === c.key
                          ? '[background:var(--glass-3)]'
                          : 'hover:[background:var(--glass-2)]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSeleccion(c.key)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ background: clase?.color ?? '#94A3B8' }}
                        />
                        <span className="t-mono-xs truncate text-[var(--text-primary)]">
                          {clase?.name ?? 'sin clase'}
                        </span>
                        {!c.id && (
                          <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
                            nueva
                          </span>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="xs"
                        iconOnly
                        aria-label="Borrar caja"
                        onClick={() => {
                          setCajas((prev) => prev.filter((x) => x.key !== c.key));
                          setSucio(true);
                        }}
                      >
                        <Trash2 strokeWidth={1.5} className="size-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={guardar.isPending}
                  disabled={!sucio}
                  onClick={() => salvar()}
                >
                  <Save strokeWidth={1.5} className="mr-1.5 size-3.5" />
                  Guardar
                </Button>
                <Button variant="ghost" size="sm" disabled={!sucio} onClick={descartar}>
                  <Undo2 strokeWidth={1.5} className="mr-1.5 size-3.5" />
                  Descartar cambios
                </Button>

                {/*
                  El estado va JUNTO al botón que lo produce, no en la cabecera: el
                  operador está mirando aquí cuando pulsa Guardar.

                  `error` manda sobre la fase de la mutación porque un fallo traducido
                  a lenguaje del operador es mejor mensaje que `isError` a secas — y
                  porque el 409 necesita explicar qué hacer, no solo que falló.
                */}
                <AsyncStatus
                  phase={error ? 'error' : fase(guardar)}
                  pendingLabel="Guardando"
                  successLabel={`Guardado · ${cajas.length} ${cajas.length === 1 ? 'caja' : 'cajas'}`}
                  errorLabel={error}
                  onRetry={() => salvar()}
                />
              </div>

              {/*
                Se dice explícitamente qué significa una lista vacía guardada: es una
                afirmación —«en esta imagen no hay nada que anotar»— y devuelve la
                imagen a `pending`. Sin decirlo, guardar cero cajas parece un error.
              */}
              {cajas.length === 0 && sucio && (
                <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
                  Guardar sin cajas retira todas las de esta imagen y la devuelve a
                  «pending».
                </p>
              )}
            </Panel>

            <Panel level="work" radius="lg" pad="lg">
              <PanelHeader title="Progreso" subtitle="Del proyecto entero" />
              <dl className="mt-3 flex flex-col gap-1.5">
                <Fila etiqueta="imágenes" valor={String(lista.length)} />
                <Fila
                  etiqueta="con anotaciones"
                  valor={String(lista.filter((i) => (i.annotation_count ?? 0) > 0).length)}
                />
                <Fila
                  etiqueta="sin anotar"
                  valor={String(lista.filter((i) => (i.annotation_count ?? 0) === 0).length)}
                />
              </dl>
              <button
                type="button"
                onClick={() => navegar(`/ai/projects/${projectId}/dataset`)}
                className="t-mono-xs mt-3 text-[var(--text-faint)] hover:underline"
              >
                Ver el dataset completo →
              </button>
            </Panel>
          </div>
        </div>
      </div>
    </CanvasHost>
  );
}

function BotonClase({
  clase,
  atajo,
  activa,
  cuantas,
  onClick,
}: {
  clase: AiClass;
  atajo: number;
  activa: boolean;
  cuantas: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      title={clase.description ?? clase.name}
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left transition-colors',
        activa ? '[background:var(--glass-3)]' : 'hover:[background:var(--glass-2)]',
      )}
    >
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-[3px]"
        style={{ background: clase.color }}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[length:var(--text-xs)]',
          activa ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
        )}
      >
        {clase.name}
      </span>
      {cuantas > 0 && (
        <span className="t-mono-xs tabular-nums text-[var(--text-muted)]">{cuantas}</span>
      )}
      <kbd className="t-mono-xs shrink-0 rounded-[3px] px-1 text-[var(--text-faint)] [background:var(--glass-2)]">
        {atajo}
      </kbd>
    </button>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-label">{etiqueta}</dt>
      <dd className="t-mono-xs tabular-nums text-[var(--text-primary)]">{valor}</dd>
    </div>
  );
}
