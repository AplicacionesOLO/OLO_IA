package com.olo.edges21.inference

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Cola de UN solo hueco entre "el MSDK entrega fotogramas" y "el modelo los
 * procesa" -- el patron de store-and-forward de la Seccion 4 del ADR-015,
 * llevado al nivel de fotograma en vez de al nivel de lote de detecciones:
 *
 *   "cola acotada y descarte del fotograma mas viejo bajo presion -- que es
 *   EXACTAMENTE el patron que `backend/tools/inferir.py::_procesar_directo`
 *   ya implementa para directos hoy [...] No hay que inventar el patron de
 *   sincronizacion: hay que generalizar el que ya existe."
 *
 * `_procesar_directo` tira el fotograma si `ahora < siguiente` (todavia no
 * toca procesar segun el fps objetivo). Aqui la logica es la version
 * "empujada por el productor": el MSDK entrega fotogramas a la velocidad de
 * la camara (potencialmente 30 fps), y la Fase 0 midio que el modelo en este
 * telefono aguanta ~3,3 FPS en CPU. En vez de encolar y acumular atraso
 * (lo que haria que las cajas dibujadas correspondan a un fotograma de hace
 * varios segundos), cada fotograma nuevo REEMPLAZA al anterior si el motor
 * todavia no lo tomo -- el fotograma viejo se descarta sin procesar, nunca se
 * apila.
 */
class FrameProcessor(
    private val engine: RfDetrEngine,
    private val threshold: Float,
    private val onResult: (frame: Bitmap, detections: List<Detection>, inferenceMs: Long) -> Unit,
) {
    private val latestFrame = AtomicReference<Bitmap?>(null)
    private val busy = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private var frameCounter = 0
    private var closed = false
    private val startedAt = SystemClock.elapsedRealtime()

    companion object {
        private const val TAG = "FrameProcessor"
    }

    /** Llamar por CADA fotograma que entrega el MSDK. No bloquea. */
    fun offerFrame(bitmap: Bitmap) {
        if (closed) return
        val reemplazado = latestFrame.getAndSet(bitmap) != null && busy.get()
        if (reemplazado) {
            Log.d(TAG, "offerFrame: fotograma anterior descartado sin procesar (el motor seguia ocupado)")
        }
        maybeStart()
    }

    private fun maybeStart() {
        if (closed) return
        if (!busy.compareAndSet(false, true)) return // ya hay un ciclo de proceso corriendo
        executor.submit {
            try {
                var frame = latestFrame.getAndSet(null)
                while (frame != null && !closed) {
                    procesarUnFotograma(frame)
                    frame = latestFrame.getAndSet(null)
                }
            } finally {
                busy.set(false)
                // Cierra la carrera: si llego un fotograma nuevo justo entre el
                // ultimo `getAndSet(null)` y este `busy.set(false)`, nadie lo
                // habria recogido -- lo relanzamos aqui.
                if (!closed && latestFrame.get() != null) {
                    maybeStart()
                }
            }
        }
    }

    private fun procesarUnFotograma(frame: Bitmap) {
        val t0 = SystemClock.elapsedRealtime()
        val tensor = RfDetrPreprocessor.preprocess(frame)
        val (dets, logits) = engine.run(tensor)
        val raw = RfDetrPostprocessor.decode(dets, logits, threshold)
        val elapsedMs = SystemClock.elapsedRealtime() - t0

        val observedAt = Instant.now()
        // `frame_ms` en el contrato del backend es el tiempo transcurrido
        // DENTRO del video/directo (ver `_procesar_directo`:
        // `"frame_ms": int(ahora * 1000)`, con `ahora` medido desde que
        // arranco el stream) -- no la latencia de inferencia. La latencia de
        // ESTE fotograma se sigue reportando por separado en `onResult`
        // (parametro `inferenceMs`) para la UI/depuracion.
        val frameMs = (SystemClock.elapsedRealtime() - startedAt).toInt()
        val detections = raw.map { d ->
            Detection(
                observedAt = observedAt,
                frameNumber = frameCounter,
                frameMs = frameMs,
                className = d.className,
                confidence = d.confidence,
                bboxX = d.x1,
                bboxY = d.y1,
                bboxWidth = (d.x2 - d.x1).coerceAtLeast(1e-6f),
                bboxHeight = (d.y2 - d.y1).coerceAtLeast(1e-6f),
            )
        }
        frameCounter++
        Log.d(TAG, "fotograma #$frameCounter procesado en ${elapsedMs}ms -> ${detections.size} detecciones")
        onResult(frame, detections, elapsedMs)
    }

    fun shutdown() {
        closed = true
        executor.shutdown()
    }
}
