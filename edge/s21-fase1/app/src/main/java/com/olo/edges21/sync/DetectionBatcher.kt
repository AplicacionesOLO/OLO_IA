package com.olo.edges21.sync

import android.util.Log
import com.olo.edges21.inference.Detection
import org.json.JSONArray
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Acumula detecciones y las "sube" por lotes -- MISMO patron que
 * `backend/tools/inferir.py::_procesar_directo` usa para un directo hoy:
 *
 *   "Manda un lote por cada `LOTE_S` segundos de analisis: ni por fotograma
 *   -seria una peticion cada 500 ms- ni al final -un directo no tiene final,
 *   y las detecciones no aparecerian nunca en la pantalla-."
 *
 * Esta es la pieza que la Fase 1 existe para probar segun la Seccion 6 del
 * ADR-015 ("aqui se prueba la arquitectura de sincronizacion... no la
 * precision") -- por eso [upload] es un punto de extension deliberadamente
 * vacio (solo loguea) en vez de una llamada HTTP real:
 *
 *   - Fase 1 (esta) no tiene un `job_id` de verdad (no hay un trabajo
 *     `stream` creado en `/v1/perception/jobs` para este prototipo) ni
 *     autenticacion de API configurada en el dispositivo.
 *   - Lo que SI se prueba aca es la forma -- lote acotado, cadencia fija,
 *     JSON con los mismos nombres de campo que `DetectionIn` -- que es
 *     exactamente lo que Fase 3 necesita reusar. Conectar el HTTP real es
 *     copiar el `POST /v1/perception/jobs/{id}/detections` que ya usa
 *     `_procesar_directo` (ver inferir.py lineas ~1880-1888) y reemplazar
 *     `upload()` por esa llamada.
 */
class DetectionBatcher(
    private val batchSeconds: Long = 5,
    private val maxPerBatch: Int = 5000, // mismo tope que `DetectionIngestIn.detections` en schemas.py
    private val upload: (JSONArray) -> Unit = ::logOnly,
) {
    private val pending = CopyOnWriteArrayList<Detection>()
    private val executor = Executors.newSingleThreadScheduledExecutor()

    init {
        executor.scheduleWithFixedDelay({ flush() }, batchSeconds, batchSeconds, TimeUnit.SECONDS)
    }

    fun add(detections: List<Detection>) {
        pending.addAll(detections)
    }

    private fun flush() {
        if (pending.isEmpty()) return
        val batch = pending.toList().take(maxPerBatch)
        pending.removeAll(batch.toSet())
        val array = JSONArray()
        batch.forEach { array.put(it.toJson()) }
        upload(array)
    }

    fun shutdown() {
        executor.shutdown()
        try {
            executor.awaitTermination(2, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
        }
    }

    companion object {
        private const val TAG = "DetectionBatcher"
        private fun logOnly(batch: JSONArray) {
            Log.i(TAG, "lote listo para subir (${batch.length()} detecciones) -- Fase 1 no sube, ver comentario de clase")
        }
    }
}
