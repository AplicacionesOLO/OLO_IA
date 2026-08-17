/**
 * EL PANEL DE FIGURAS: subir un modelo y ponerlo en el plano.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LAS TRES COSAS QUE ESTA PANTALLA TIENE QUE HACER BIEN
 *
 * 1. **Decir por dónde va la subida.** Un `.glb` de 10 MB tarda, y son cuatro pasos —medir,
 *    reservar, subir, registrar—. Un botón girando no distingue «va» de «se colgó», y las
 *    dos veces que la subida de un vídeo falló de verdad el síntoma que llegó fue el mismo:
 *    «no avanza».
 *
 * 2. **Pedir la licencia, no sugerirla.** Servir un modelo CC-BY sin el crédito que su
 *    licencia exige es incumplir, y esto es un SaaS multi-tenant. El campo es obligatorio y
 *    la atribución se pide en cuanto la licencia lleva «BY» — la base lo rechazaría igual,
 *    pero descubrirlo al guardar después de subir 10 MB sería un mal día—.
 *
 * 3. **Avisar del error de unidad ANTES de subir.** El modelo se mide en el navegador, que
 *    es donde ya está descomprimido. Si mide 1.700 y las personas miden 1,7, la pantalla lo
 *    dice y propone el factor. No lo aplica sola: adivinar la escala de un modelo ajeno y
 *    guardarla como dato sería inventar una medida.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * DONDE CAE LA FIGURA AL COLOCARLA
 *
 * En el CENTRO de lo que hay colocado, no en el origen. El origen del plano puede quedar a
 * cuarenta metros de los racks, y una figura que aparece fuera de la pantalla se lee como
 * «no funcionó». Arrastrar en perspectiva es lo siguiente; mientras no exista, aparecer
 * donde se está mirando es lo correcto.
 */

import { Box, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { cn } from '../../../design/utils/cn';
import { Button } from '../../../design/primitives/Button';
import {
  CATEGORIAS_DE_FIGURA,
  NOMBRE_DE_CATEGORIA,
  avisoDeEscala,
  escalaSugerida,
} from '../figuras';
import type { CategoriaDeFigura, FiguraDelCatalogo } from '../figuras';
import { medirGlb } from '../repositories/ApiFigurasRepository';
import {
  useColocarFigura,
  useFiguras,
  useRetirarFigura,
  useSubirFigura,
} from '../services/useSpatial';

export function PanelDeFiguras({
  warehouseId,
  centro,
  className,
}: {
  warehouseId: string | null;
  /** Dónde cae una figura nueva, en metros. El centro de lo colocado. */
  centro: { x: number; y: number } | null;
  className?: string;
}) {
  const catalogo = useFiguras();
  const subir = useSubirFigura();
  const colocar = useColocarFigura(warehouseId);
  const retirar = useRetirarFigura(warehouseId);

  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const porCategoria = useMemo(() => {
    const m = new Map<string, FiguraDelCatalogo[]>();
    for (const f of catalogo.data ?? []) {
      const lista = m.get(f.kind) ?? [];
      lista.push(f);
      m.set(f.kind, lista);
    }
    return m;
  }, [catalogo.data]);

  const alColocar = (f: FiguraDelCatalogo) => {
    if (!warehouseId) return;
    setError(null);
    colocar.mutate(
      {
        modelId: f.id,
        //  Sin centro —ningún rack colocado— se pone en el origen, que es lo único que se
        //  puede saber. Con racks, en medio de ellos: el origen puede estar a cuarenta
        //  metros y la figura aparecería fuera de la pantalla.
        xM: centro?.x ?? 0,
        yM: centro?.y ?? 0,
      },
      { onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo colocar.') },
    );
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="t-label">Figuras</span>
        <Button variant="secondary" size="xs" onClick={() => setAbierto((v) => !v)}>
          <Upload strokeWidth={1.5} className="size-3.5" />
          {abierto ? 'Cerrar' : 'Subir modelo'}
        </Button>
      </div>

      {abierto && (
        <FormularioDeSubida
          onCerrar={() => setAbierto(false)}
          onSubir={async (datos) => {
            setError(null);
            try {
              await subir.mutateAsync({ ...datos, onPaso: setPaso });
              setAbierto(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'No se pudo subir la figura.');
            } finally {
              //  Se limpia pase lo que pase: dejar «Subiendo 8 MB…» bajo un error sería
              //  decir dos cosas contrarias a la vez.
              setPaso(null);
            }
          }}
          enCurso={subir.isPending}
          paso={paso}
        />
      )}

      {error && <p className="t-mono-xs text-[var(--text-warn)]">{error}</p>}

      {catalogo.isLoading ? (
        <p className="t-mono-xs animate-pulse text-[var(--text-faint)]">Cargando el catálogo…</p>
      ) : (catalogo.data?.length ?? 0) === 0 ? (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
          <span className="t-mono-xs text-[var(--text-secondary)]">
            No hay ninguna figura todavía.
          </span>
          {/*  Se dice DE DONDE sacarlas y con qué licencia, porque es la pregunta siguiente
               y porque un modelo con la licencia equivocada es un problema, no un adorno. */}
          <span className="t-mono-xs text-[var(--text-faint)]">
            Sube un `.glb`. Para empezar sin coste ni problema de licencia: Kenney,
            Quaternius y Poly Haven publican modelos CC0.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {CATEGORIAS_DE_FIGURA.filter((c) => porCategoria.has(c)).map((c) => (
            <div key={c} className="flex flex-col gap-1.5">
              <span className="t-label text-[var(--text-secondary)]">
                {NOMBRE_DE_CATEGORIA[c]}
              </span>
              {porCategoria.get(c)!.map((f) => (
                <Ficha
                  key={f.id}
                  figura={f}
                  puedeColocar={Boolean(warehouseId)}
                  onColocar={() => alColocar(f)}
                  onRetirar={() => retirar.mutate(f.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Una figura del catálogo, con lo que hay que saber de ella antes de usarla. */
function Ficha({
  figura,
  puedeColocar,
  onColocar,
  onRetirar,
}: {
  figura: FiguraDelCatalogo;
  puedeColocar: boolean;
  onColocar: () => void;
  onRetirar: () => void;
}) {
  //  La de la plataforma no se puede retirar desde aquí: es de todos.
  const esComun = figura.tenantId === null;
  const alto = figura.sizeYM;
  const aviso = avisoDeEscala(
    alto != null ? alto * figura.scale : null,
    figura.kind as CategoriaDeFigura,
  );

  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 [background:var(--glass-2)]">
      {figura.thumbUrl ? (
        <img
          src={figura.thumbUrl}
          alt={figura.name}
          className="size-8 rounded-[var(--radius-xs)] object-cover"
        />
      ) : (
        <Box strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-[var(--icon-muted)]" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-mono-xs truncate text-[var(--text-primary)]">{figura.name}</span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {/*  El alto REAL, ya con la escala aplicada: es lo que se va a ver en el plano, no
               lo que traía el archivo. */}
          {alto != null ? `${(alto * figura.scale).toFixed(2)} m · ` : 'sin medir · '}
          {figura.license}
          {esComun && ' · común'}
        </span>
        {aviso && <span className="t-mono-xs text-[var(--text-warn)]">{aviso}</span>}
        {!figura.glbUrl && (
          <span className="t-mono-xs text-[var(--text-warn)]">
            Su archivo no está: no se puede dibujar.
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onColocar}
          disabled={!puedeColocar || !figura.glbUrl}
          title={puedeColocar ? 'Poner en el plano' : 'Elige un almacén primero'}
          className="rounded-[var(--radius-xs)] p-1 text-[var(--icon-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          <Plus strokeWidth={1.5} className="size-3.5" />
        </button>
        {!esComun && (
          <button
            type="button"
            onClick={onRetirar}
            title="Retirar del catálogo"
            className="rounded-[var(--radius-xs)] p-1 text-[var(--icon-muted)] hover:text-[var(--state-critical)]"
          >
            <Trash2 strokeWidth={1.5} className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

interface DatosDeSubida {
  file: File;
  name: string;
  kind: CategoriaDeFigura;
  license: string;
  attribution?: string | undefined;
  sourceUrl?: string | undefined;
}

function FormularioDeSubida({
  onSubir,
  onCerrar,
  enCurso,
  paso,
}: {
  onSubir: (datos: DatosDeSubida) => void;
  onCerrar: () => void;
  enCurso: boolean;
  paso: string | null;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoriaDeFigura>('persona');
  const [license, setLicense] = useState('CC0-1.0');
  const [attribution, setAttribution] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [alto, setAlto] = useState<number | null>(null);
  const [midiendo, setMidiendo] = useState(false);

  //  «BY» en la licencia obliga a acreditar. Se exige AQUI y no solo en la base: descubrirlo
  //  al guardar, después de subir diez megas, sería un mal día por algo que se sabía antes.
  const exigeCredito = license.toUpperCase().includes('BY');
  const puedeEnviar =
    Boolean(file) &&
    name.trim().length > 0 &&
    license.trim().length > 0 &&
    (!exigeCredito || attribution.trim().length > 0) &&
    !enCurso;

  const alElegir = async (f: File | null) => {
    setFile(f);
    setAlto(null);
    if (!f) return;
    if (!name.trim()) {
      //  El nombre del archivo como propuesta, sin extensión. Se puede cambiar.
      setName(f.name.replace(/\.(glb|gltf)$/i, '').slice(0, 60));
    }
    //  Medir ANTES de subir: es lo que permite avisar del error de unidad a tiempo.
    setMidiendo(true);
    const m = await medirGlb(f);
    setMidiendo(false);
    setAlto(m?.y ?? null);
  };

  const aviso = avisoDeEscala(alto, kind);
  const factor = escalaSugerida(alto, kind);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
      <input
        ref={entrada}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        onChange={(e) => void alElegir(e.target.files?.[0] ?? null)}
        className="t-mono-xs text-[var(--text-secondary)]"
      />
      {file && (
        <span className="t-mono-xs text-[var(--text-faint)]">
          {(file.size / 1e6).toFixed(1)} MB
          {midiendo
            ? ' · midiendo…'
            : alto != null
              ? ` · ${alto.toFixed(2)} de alto en las unidades del archivo`
              : ' · no se pudo medir: se sube sin comprobar la escala'}
        </span>
      )}

      <Campo etiqueta="nombre">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] t-mono-xs text-[var(--text-primary)] outline-none"
        />
      </Campo>

      <Campo etiqueta="categoría">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as CategoriaDeFigura)}
          className="w-full rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] t-mono-xs text-[var(--text-primary)] outline-none"
        >
          {CATEGORIAS_DE_FIGURA.map((c) => (
            <option key={c} value={c}>
              {NOMBRE_DE_CATEGORIA[c]}
            </option>
          ))}
        </select>
      </Campo>

      {aviso && (
        <p className="t-mono-xs text-[var(--text-warn)]">
          {aviso}
          {/*  Se PROPONE el factor; no se aplica solo. Adivinar la escala de un modelo ajeno
               y guardarla como dato sería inventar una medida. */}
          {factor !== null && ' Corrígelo en el modelo o al colocarlo.'}
        </p>
      )}

      <Campo etiqueta="licencia">
        <input
          value={license}
          onChange={(e) => setLicense(e.target.value)}
          placeholder="CC0-1.0, CC-BY-4.0, propia…"
          maxLength={60}
          className="w-full rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] t-mono-xs text-[var(--text-primary)] outline-none"
        />
      </Campo>

      {exigeCredito && (
        <Campo etiqueta="atribución — obligatoria con BY">
          <input
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            placeholder="Autor, y de dónde salió"
            maxLength={2000}
            className="w-full rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] t-mono-xs text-[var(--text-primary)] outline-none"
          />
        </Campo>
      )}

      <Campo etiqueta="origen (opcional)">
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://…"
          maxLength={1000}
          className="w-full rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] t-mono-xs text-[var(--text-primary)] outline-none"
        />
      </Campo>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="primary"
          size="xs"
          loading={enCurso}
          disabled={!puedeEnviar}
          onClick={() =>
            file &&
            onSubir({
              file,
              name: name.trim(),
              kind,
              license: license.trim(),
              attribution: attribution.trim() || undefined,
              sourceUrl: sourceUrl.trim() || undefined,
            })
          }
        >
          Subir
        </Button>
        <Button variant="ghost" size="xs" onClick={onCerrar}>
          Cancelar
        </Button>
        {/*  Por dónde va. Son cuatro pasos y el de subir dura lo que dure la red. */}
        {paso && <span className="t-mono-xs text-[var(--text-secondary)]">{paso}</span>}
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="t-label text-[var(--text-faint)]">{etiqueta}</span>
      {children}
    </label>
  );
}
