/**
 * ELEGIR FOTOGRAMAS Y MANDARLOS A ANOTAR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTO ES LO QUE HACE FALTA, MEDIDO
 *
 * El dataset entero son ~20 imágenes y ~31 anotaciones. El conjunto de VALIDACIÓN
 * tiene **una sola** caja de `qr_ubicacion`, dos de `pallet` y tres de `qr_pallet`.
 *
 * Con un único ejemplo el AP es binario —o acierta esa caja o no— así que el «AP 0,00»
 * de `qr_ubicacion` no dice que el modelo no sepa detectar códigos de hueco: dice que
 * falló una caja concreta en una imagen concreta. Se comprobó reentrenando a 736 en vez
 * de 384: `qr_ubicacion` siguió en 0,00 exacto y `pallet` bajó de 0,75 a 0,63. No hay
 * señal porque no hay muestras.
 *
 * O sea que lo que falta no es afinar hiperparámetros: es MATERIAL. Y el material bueno
 * está en los vídeos del almacén — con sus luces, sus distancias y sus QR de verdad.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LOS FOTOGRAMAS SE EXTRAEN EN EL NAVEGADOR
 *
 * El vídeo ya está cargado y reproduciéndose aquí: se busca cada instante y se copia a
 * un `canvas`. La alternativa era que el servidor descargara el vídeo y lo decodificara
 * con OpenCV en el proceso web — cientos de MB y un decodificador dentro del proceso que
 * atiende peticiones, para hacer lo que el navegador ya tiene hecho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SE ELIGEN A MANO, Y NO SE MANDAN TODOS
 *
 * Pedido explícitamente, y con razón: en un vídeo de 11 s a 60 fps hay 687 fotogramas y
 * la mayoría son la misma estantería con un desenfoque distinto. Mandarlos todos infla el
 * dataset sin añadir información y encima da la sensación de tener 687 imágenes cuando en
 * realidad hay una escena.
 *
 * Las que se manden nacen en `pending`: un fotograma recién traído no está anotado, y
 * decir lo contrario haría que el entrenamiento contara como etiquetado algo que nadie
 * miró.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';

import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { cn } from '../../../design/utils/cn';
import type { Detection, PerceptionJob } from '../types';

/** Un fotograma ya extraído, con su miniatura y sus bytes listos para subir. */
interface Candidato {
  ms: number;
  /** `data:` URL para la miniatura. Se revoca sola al cerrar el modal. */
  vistaPrevia: string;
  blob: Blob;
  /** Si el modelo detectó algo en este instante. Es la mejor pista de utilidad. */
  detecciones: number;
  elegido: boolean;
  /**
   * El número de fotograma dentro del vídeo.
   *
   * El esquema lo exige junto al instante, y tiene que significar algo: se calcula con los
   * fotogramas por segundo REALES del material —`total_frames` partido por la duración—,
   * no con el orden en que se eligieron en esta rejilla, que no dice nada del vídeo.
   */
  indice: number;
}

/** Cuántos fotogramas se ofrecen como máximo. */
const MAX_CANDIDATOS = 24;

/**
 * Cuánto se espera a que el vídeo declare sus medidas antes de darlo por atascado.
 *
 * Generoso: los bytes ya están en memoria, así que abrirlos es cuestión de un instante
 * salvo que el navegador haya decidido no hacerlo. Es holgura para una máquina cargada,
 * no para descargar nada.
 */
const ESPERA_METADATOS_MS = 15_000;

export function FramesToDatasetModal({
  job,
  detecciones,
  projectId,
  mediaUrl,
  firmaEnVuelo = false,
  deteccionesEnVuelo = false,
  onCerrar,
  onSubir,
  onVincularVideo,
}: {
  job: PerceptionJob;
  detecciones: Detection[];
  /** El proyecto de IA al que van las imágenes. Sin él no hay dónde ponerlas. */
  projectId: string | null;
  /**
   * La URL FIRMADA del material, la misma que usa el reproductor.
   *
   * No se lee `job.media.url`: eso es una object URL que solo existe en la pestaña
   * donde se creó la inspección, así que al abrir esta pantalla de nuevo era `null` y
   * el modal no extraía nada.
   */
  mediaUrl: string | null;
  /**
   * Si la petición de la firma sigue en vuelo.
   *
   * Sin esto `mediaUrl` nulo era ambiguo: significaba lo mismo «todavía no ha llegado»
   * que «no hay material», y el modal abría acusando de lo segundo cuando pasaba lo
   * primero. Se veía al entrar por URL directa —el reproductor pide la firma al montar,
   * y el botón ya está pulsable antes de que responda—.
   */
  firmaEnVuelo?: boolean;
  /**
   * Si las detecciones aún se están pidiendo.
   *
   * Se espera por lo mismo que a la firma, pero el síntoma era otro: el modal recortaba
   * los fotogramas con la lista vacía —ninguno venía marcado— y cuando las detecciones
   * llegaban, el efecto se reiniciaba y volvía a recortar desde cero.
   */
  deteccionesEnVuelo?: boolean;
  onCerrar: () => void;
  /** Sube un fotograma y devuelve cuando esté registrado como imagen del dataset. */
  onSubir: (f: {
    blob: Blob;
    ms: number;
    indice: number;
    videoAssetId: string;
  }) => Promise<void>;
  /**
   * Deja el vídeo de la inspección registrado como material del proyecto y devuelve su
   * asset. Se llama una vez por lote, antes del primer fotograma: sin esa procedencia el
   * registro del fotograma se rechaza DESPUÉS de haber subido el binario.
   */
  onVincularVideo: () => Promise<string>;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [extrayendo, setExtrayendo] = useState(true);
  const [progreso, setProgreso] = useState(0);
  const [subiendo, setSubiendo] = useState(false);
  const [hechas, setHechas] = useState(0);
  const [error, setError] = useState<string | null>(null);
  //  Sube uno y el efecto vuelve a intentarlo. Es lo que hace útil el mensaje de «vuelve
  //  a esta pestaña»: sin forma de reintentar, saber la causa no arregla nada.
  const [intento, setIntento] = useState(0);
  /** Envío en curso. Cierra la puerta a la segunda pulsación en el mismo tick. */
  const enviando = useRef(false);

  /**
   * Extrae los candidatos: los instantes con detección primero, y el resto repartido
   * por el vídeo.
   *
   * Los que tienen detección van SIEMPRE porque son los que el modelo consideró
   * interesantes, y revisar esos es lo que corrige sus errores. El reparto uniforme
   * completa con variedad: si solo se ofrecieran los detectados, el dataset acabaría
   * teniendo únicamente lo que el modelo ya sabe ver.
   */
  useEffect(() => {
    //  Esperar no es fallar. Mientras la firma esté en vuelo no hay nada que extraer ni
    //  nada que reprochar: el efecto se vuelve a ejecutar cuando `mediaUrl` llegue.
    if ((!mediaUrl && firmaEnVuelo) || deteccionesEnVuelo) {
      setExtrayendo(true);
      setError(null);
      return;
    }

    let vivo = true;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    let urlLocal: string | null = null;

    const extraer = async () => {
      try {
        if (!mediaUrl) throw new Error('El material no está disponible.');

        /*
          ── SE DESCARGAN LOS BYTES, NO SE APUNTA A LA URL ───────────────────────

          Dos razones, y la segunda es la que obliga:

            · un `<video>` que apunta a otro origen CONTAMINA el canvas, y `toBlob`
              lanza SecurityError. Los fotogramas no se podrían extraer aunque el vídeo
              se viera perfectamente.
            · buscar veinte instantes sobre HTTP son veinte peticiones con rango; sobre
              un blob local es instantáneo.

          El precio es descargar el vídeo entero una vez. Para 2,7 MB no se nota; para
          70 MB tarda, y por eso el modal dice que está trabajando.
        */
        setProgreso(0);
        const resp = await fetch(mediaUrl);
        if (!resp.ok) throw new Error(`No se pudo descargar el material (HTTP ${resp.status}).`);
        const bytes = await resp.blob();
        urlLocal = URL.createObjectURL(bytes);
        video.src = urlLocal;
        video.load();
        /*
          ── LA ESPERA DE LOS METADATOS LLEVA PLAZO, Y EL PLAZO TIENE UN MOTIVO ────

          Con la pestaña en segundo plano Chrome NO carga el vídeo: `readyState` se queda
          en 0 y `loadedmetadata` no llega nunca. Sin plazo, el modal se queda «Descargando
          el material…» para siempre —medido: 80 s sin una sola miniatura y sin un solo
          mensaje—, que es exactamente el fallo silencioso que este módulo tenía que dejar
          de tener.

          Así que se espera un rato razonable y, si no llega, se dice lo que pasa y qué
          hacer. `document.hidden` distingue las dos causas: pestaña de fondo (se arregla
          volviendo) de vídeo ilegible (no se arregla).
        */
        await new Promise<void>((res, rej) => {
          const plazo = window.setTimeout(() => {
            rej(
              new Error(
                document.hidden
                  ? 'El navegador no carga el vídeo mientras esta pestaña está en segundo ' +
                    'plano. Vuelve a ella y pulsa «Reintentar».'
                  : `El vídeo no se abrió en ${Math.round(ESPERA_METADATOS_MS / 1000)} s. ` +
                    'Puede que el formato no sea legible en este navegador.',
              ),
            );
          }, ESPERA_METADATOS_MS);
          video.onloadedmetadata = () => {
            window.clearTimeout(plazo);
            res();
          };
          video.onerror = () => {
            window.clearTimeout(plazo);
            rej(new Error('No se pudo abrir el vídeo.'));
          };
        });

        const duracionMs = (Number.isFinite(video.duration) ? video.duration : 0) * 1000;
        if (duracionMs <= 0) throw new Error('El vídeo no declara su duración.');

        /*
          ── DE INSTANTE A NUMERO DE FOTOGRAMA ───────────────────────────────────

          El navegador no expone los fotogramas por segundo, pero el medio sí trae su
          recuento total, y con la duración sale la cadencia real. Para el vídeo de prueba
          son 687 fotogramas en 11,5 s, o sea 59,7 fps: el segundo 6,03 es el fotograma
          360, y así el dato sirve para volver al sitio exacto.

          Si el recuento no está —hay medios que no lo declaran— se deriva del instante a
          25 fps, que es una convención, y se dice aquí para que nadie lo lea como medido.
        */
        const fps =
          job.media.totalFrames != null && job.media.totalFrames > 0
            ? job.media.totalFrames / (duracionMs / 1000)
            : 25;
        const numeroDeFotograma = (ms: number) => Math.max(0, Math.round((ms / 1000) * fps));

        // Los instantes con detección, sin repetir.
        const conDeteccion = [
          ...new Set(
            detecciones
              .map((d) => d.timestampMs)
              .filter((ms): ms is number => ms != null && ms <= duracionMs),
          ),
        ].sort((a, b) => a - b);

        // Y un reparto uniforme para completar hasta el máximo.
        const faltan = Math.max(0, MAX_CANDIDATOS - conDeteccion.length);
        const paso = faltan > 0 ? duracionMs / (faltan + 1) : 0;
        const uniformes: number[] = [];
        for (let i = 1; i <= faltan; i += 1) {
          const ms = Math.round(paso * i);
          //  No se repite lo que ya viene por detección, con medio segundo de margen:
          //  dos miniaturas del mismo instante son la misma imagen dos veces.
          if (!conDeteccion.some((d) => Math.abs(d - ms) < 500)) uniformes.push(ms);
        }

        const instantes = [...conDeteccion, ...uniformes].sort((a, b) => a - b);
        const lienzo = document.createElement('canvas');
        const ctx = lienzo.getContext('2d');
        if (!ctx) throw new Error('El navegador no da contexto 2D.');

        const sacados: Candidato[] = [];
        for (const ms of instantes) {
          if (!vivo) return;
          await new Promise<void>((res) => {
            video.onseeked = () => res();
            video.currentTime = Math.min(ms / 1000, video.duration - 0.05);
          });
          //  El tamaño se toma del vídeo, no de un valor fijo: reescalar aquí perdería
          //  justo el detalle de los QR, que es lo que se quiere anotar.
          lienzo.width = video.videoWidth;
          lienzo.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const blob = await new Promise<Blob | null>((res) =>
            //  Calidad 0.92: un JPEG muy comprimido destruye los códigos, que ya son
            //  pocos píxeles. No se usa PNG porque multiplicaría el peso por cinco.
            lienzo.toBlob((b) => res(b), 'image/jpeg', 0.92),
          );
          if (!blob) continue;
          sacados.push({
            ms,
            vistaPrevia: lienzo.toDataURL('image/jpeg', 0.5),
            blob,
            detecciones: detecciones.filter(
              (d) => d.timestampMs != null && Math.abs(d.timestampMs - ms) < 500,
            ).length,
            //  Los que tienen detección vienen marcados: es lo más probable que se
            //  quiera mandar, y quitar una marca cuesta menos que poner veinte.
            elegido: conDeteccion.some((d) => Math.abs(d - ms) < 500),
            indice: numeroDeFotograma(ms),
          });
          if (vivo) {
            setCandidatos([...sacados]);
            setProgreso(Math.round((sacados.length / instantes.length) * 100));
          }
        }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudieron extraer los fotogramas.');
      } finally {
        if (vivo) setExtrayendo(false);
        video.src = '';
        //  Quien crea la object URL la libera. Es la misma regla que se rompió en la
        //  vista previa del formulario, donde revocarla de más dejó el vídeo en blanco.
        if (urlLocal) URL.revokeObjectURL(urlLocal);
      }
    };

    void extraer();
    /*
      ── LA BANDERA DE CANCELACION ES LOCAL, NO UN `ref` ─────────────────────────

      Aquí había un `useRef(false)` que la limpieza ponía a `true`. En desarrollo React
      monta cada efecto DOS veces —monta, limpia, monta— y el `ref` sobrevive a los dos:
      el segundo montaje, que es el que cuenta, encontraba la bandera ya levantada y
      salía del bucle sin extraer nada. El modal se abría vacío, sin miniaturas y sin
      error, que es la peor forma de fallar.

      Una variable local nace nueva en cada ejecución del efecto, así que dice la verdad
      sobre ESA ejecución y solo sobre ella.
    */
    return () => {
      vivo = false;
      video.src = '';
    };
  }, [mediaUrl, firmaEnVuelo, deteccionesEnVuelo, detecciones, intento]);

  const alternar = useCallback((ms: number) => {
    setCandidatos((prev) =>
      prev.map((c) => (c.ms === ms ? { ...c, elegido: !c.elegido } : c)),
    );
  }, []);

  const elegidos = candidatos.filter((c) => c.elegido);

  const mandar = async () => {
    if (!projectId) {
      setError('Esta inspección no tiene proyecto de IA asociado.');
      return;
    }
    /*
      ── LA GUARDA ES UN `ref`, NO EL `disabled` ─────────────────────────────────

      `setSubiendo(true)` no desactiva el botón hasta el siguiente repintado, así que dos
      pulsaciones en el mismo instante pasan las dos. Medido aquí: dos `prepare`, dos
      subidas a Storage y dos `confirm`, el segundo con 422 porque el primero ya había
      registrado ese fotograma. El usuario veía «no quedó registrado» de algo que SÍ
      quedó registrado, que es la peor variante de un fallo.

      Un `ref` se pone en el mismo tick, antes de ceder el control. Es la misma guarda que
      hizo falta al borrar inspecciones.
    */
    if (enviando.current) return;
    enviando.current = true;
    setSubiendo(true);
    setError(null);
    setHechas(0);
    try {
      //  Antes de nada, que el vídeo exista como material del proyecto. Si esto falla no
      //  se ha subido ningún byte todavía, que es el momento bueno para fallar.
      const videoAssetId = await onVincularVideo();

      let i = 0;
      for (const c of elegidos) {
        //  De uno en uno y no en paralelo: son imágenes de 1–3 MB y cada una son tres
        //  viajes —reservar, subir, confirmar—. Veinte a la vez saturan la subida del
        //  almacén y el primero en fallar deja el resto en un estado incierto.
        await onSubir({ blob: c.blob, ms: c.ms, indice: c.indice, videoAssetId });
        i += 1;
        setHechas(i);
      }
      onCerrar();
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Falló la subida'}. Se enviaron ${hechas} de ${elegidos.length}; las que faltan siguen aquí.`,
      );
    } finally {
      setSubiendo(false);
      enviando.current = false;
    }
  };

  return (
    /*
      `fixed inset-0` con fondo: es un modal de verdad, no un panel más de la página.
      Elegir entre veinticuatro miniaturas necesita la pantalla entera.
    */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 [background:color-mix(in_oklab,black_70%,transparent)]">
      <Panel
        level="work"
        radius="xl"
        pad="md"
        className="flex max-h-[90vh] w-full max-w-[1100px] flex-col gap-4 overflow-hidden"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelHeader
            title="Mandar fotogramas a anotar"
            subtitle="Elige los que sirvan. Los que tienen detección vienen marcados."
          />
          <Button variant="ghost" size="sm" onClick={onCerrar} aria-label="Cerrar">
            <X strokeWidth={1.5} className="size-4" />
          </Button>
        </div>

        {/*
          Por qué esto importa, en la propia pantalla. Sin el motivo, «mandar fotogramas»
          parece una utilidad más y no el cuello de botella del modelo.
        */}
        <p className="t-mono-xs max-w-[92ch] text-[var(--text-faint)]">
          El dataset tiene ~20 imágenes, y el conjunto de validación **una sola** caja de
          códigos de hueco. Con un único ejemplo el AP no mide capacidad: por eso
          reentrenar a más resolución no movió nada. Lo que falta es material real, y está
          aquí dentro.
        </p>

        {extrayendo && (
          <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            <Loader2 strokeWidth={1.5} className="size-4 animate-spin" />
            {/*
              Cuatro mensajes porque son cuatro esperas distintas, y confundirlas es lo que
              hacía que el modal pareciera roto: preguntar qué vio la IA, pedir la firma,
              traerse los bytes y recortar tardan cada uno lo suyo.
            */}
            {deteccionesEnVuelo
              ? 'Buscando qué vio la IA en este vídeo…'
              : !mediaUrl
                ? 'Pidiendo el enlace del material…'
                : progreso === 0
                  ? `Descargando el material (${formatearMB(job.media.bytes)})…`
                  : `Extrayendo fotogramas… ${progreso} %`}
          </div>
        )}

        {error && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="t-mono-xs max-w-[80ch] text-[var(--text-warn)]">{error}</p>
            {candidatos.length === 0 && !subiendo && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setError(null);
                  setIntento((n) => n + 1);
                }}
              >
                <RotateCcw strokeWidth={1.5} className="size-3.5" />
                Reintentar
              </Button>
            )}
          </div>
        )}

        {candidatos.length > 0 && (
          <div className="grid grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {candidatos.map((c) => (
              <button
                key={c.ms}
                type="button"
                onClick={() => alternar(c.ms)}
                aria-pressed={c.elegido}
                //  Marcas para poder comprobar esta rejilla sin adivinar. Localizar las
                //  miniaturas por posicion o por su texto ya produjo dos diagnosticos
                //  falsos, porque en la pantalla hay otros botones con estado.
                data-fotograma={c.ms}
                data-deteccion={c.detecciones > 0 ? '1' : '0'}
                disabled={subiendo}
                className={cn(
                  'relative overflow-hidden rounded-[var(--radius-sm)] text-left transition-all',
                  c.elegido
                    ? 'ring-2 ring-[var(--accent)]'
                    : 'opacity-60 hover:opacity-100',
                )}
              >
                <img
                  src={c.vistaPrevia}
                  alt={`Segundo ${(c.ms / 1000).toFixed(1)}`}
                  className="block aspect-square w-full object-cover"
                />
                <span className="absolute left-1 top-1 rounded-[2px] px-1 text-[length:10px] [background:color-mix(in_oklab,black_70%,transparent)] text-[var(--text-secondary)]">
                  {(c.ms / 1000).toFixed(1)} s
                </span>
                {c.detecciones > 0 && (
                  <span className="absolute right-1 top-1 rounded-[2px] bg-[var(--accent)] px-1 text-[length:10px] text-[#04121a]">
                    {c.detecciones} det.
                  </span>
                )}
                {c.elegido && (
                  <span className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-[var(--accent)]">
                    <Check strokeWidth={2.5} className="size-3 text-[#04121a]" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--rule)] pt-3">
          <p className="t-mono-xs text-[var(--text-muted)]">
            {elegidos.length} de {candidatos.length} elegidos
            {subiendo ? ` · enviando ${hechas + 1} de ${elegidos.length}…` : null}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCerrar} disabled={subiendo}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={elegidos.length === 0 || subiendo || extrayendo}
              onClick={() => void mandar()}
            >
              {subiendo
                ? 'Enviando…'
                : `Mandar ${elegidos.length} a anotar`}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}


/** MB con un decimal. Un «0 MB» en un vídeo de 700 KB confundiría más que ayudar. */
function formatearMB(bytes: number): string {
  if (!bytes) return 'tamaño desconocido';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
