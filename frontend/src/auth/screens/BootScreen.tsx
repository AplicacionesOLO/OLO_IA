/**
 * PANTALLA DE ARRANQUE
 *
 * Se muestra mientras se restaura la sesion. Debe ser INSTANTANEA y no parecer
 * una pantalla de carga: es la continuidad entre el fondo del documento y la
 * aplicacion.
 *
 * Sin spinner. Un barrido de escaneo sobre la marca comunica "el sistema esta
 * despertando", que es lo que realmente ocurre.
 */

import { ScanLine } from '../../design/primitives';
import { AmbientLight } from '../../design/foundation/AmbientLight';

export function BootScreen({ label = 'Restaurando contexto' }: { label?: string }) {
  return (
    <main className="relative flex h-dvh items-center justify-center overflow-hidden bg-[var(--canvas)]">
      <AmbientLight intensity={0.7} />

      <div className="relative flex flex-col items-center gap-5">
        <div className="relative overflow-hidden rounded-[var(--radius-sm)] px-5 py-3">
          <ScanLine nature="measured" />
          <span className="text-[length:var(--text-2xl)] font-[var(--weight-light)] tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
            OLO<span className="text-[var(--accent)]"> IA</span>
          </span>
        </div>
        <span className="t-label">{label}</span>
      </div>
    </main>
  );
}
