package com.olo.edges21.recording

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.Log
import com.olo.edges21.inference.Detection
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicLong

/**
 * Deja evidencia de una sesion en el propio almacenamiento del telefono, para
 * poder revisarla o mostrarla despues de una prueba en el almacen sin depender
 * de que el telefono siga conectado a una PC ni de un backend real (eso sigue
 * siendo trabajo de Fase 3 -- ver DetectionBatcher.kt).
 *
 * Dos archivos por sesion, en `Download/olo_edge_sesiones/<fecha-hora>/`:
 *
 *   detecciones.jsonl   Una linea JSON por LOTE de DetectionBatcher (los
 *                       mismos objetos que produce `Detection.toJson()` --
 *                       el mismo contrato que espera el backend, asi que
 *                       este archivo es directamente lo que se subiria en
 *                       Fase 3, no un formato aparte que haya que traducir).
 *
 *   fotogramas/NNNN.jpg Una imagen cada [intervaloFotogramaMs] (no cada
 *                       fotograma -- a ~3 fps eso serian miles de archivos
 *                       en una prueba de unos minutos) CON las cajas ya
 *                       dibujadas encima, para tener una prueba visual sin
 *                       tener que cruzar manualmente el JSON contra fotogramas
 *                       sueltos.
 *
 * Se guarda en el almacenamiento EXTERNO PROPIO de la app
 * (`getExternalFilesDir`, tipicamente `/sdcard/Android/data/com.olo.edges21/
 * files/...`), NO en `Download/` publica -- probado en el S21 real: escribir
 * directo en `Download/` con `File`/`FileOutputStream` en Android 15 exige
 * el permiso especial "Acceso a todos los archivos" (`MANAGE_EXTERNAL_STORAGE`,
 * que se otorga desde Ajustes, no con un dialogo comun) o pasar por la API de
 * `MediaStore` -- mas codigo y una concesion manual que no vale la pena para
 * un prototipo. `getExternalFilesDir` no pide ningun permiso especial y
 * funciona en cualquier version de Android desde API 19. Para sacar los
 * archivos del telefono: `adb pull
 * /sdcard/Android/data/com.olo.edges21/files/olo_edge_sesiones` o un
 * explorador de archivos que muestre carpetas de apps (p.ej. "Mis archivos"
 * de Samsung, en Almacenamiento interno > Android > data > com.olo.edges21 > files).
 */
class LocalRecorder(baseDir: File, intervaloFotogramaMs: Long = 2000L) {

    companion object {
        private const val TAG = "LocalRecorder"
        private val NOMBRE_SESION = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US)
    }

    private val intervaloNs = intervaloFotogramaMs * 1_000_000L
    private var ultimoFotogramaGuardadoNs = 0L
    private val contadorFotogramas = AtomicLong(0)

    private val carpetaSesion: File = File(baseDir, "olo_edge_sesiones/${NOMBRE_SESION.format(Date())}")
    private val carpetaFotogramas = File(carpetaSesion, "fotogramas")
    private val archivoDetecciones = File(carpetaSesion, "detecciones.jsonl")

    init {
        carpetaFotogramas.mkdirs()
        Log.i(TAG, "sesion local en: ${carpetaSesion.absolutePath}")
    }

    /** Un lote de [DetectionBatcher] -- se llama desde su hilo de fondo, no bloquea la UI. */
    fun grabarLote(lote: JSONArray) {
        try {
            FileOutputStream(archivoDetecciones, /* append = */ true).use { out ->
                out.write((lote.toString() + "\n").toByteArray(Charsets.UTF_8))
            }
        } catch (e: Exception) {
            Log.e(TAG, "no se pudo escribir el lote de detecciones", e)
        }
    }

    /**
     * Un fotograma con sus detecciones -- se llama en el hilo de
     * [com.olo.edges21.inference.FrameProcessor], tampoco bloquea la UI.
     * Descarta fotogramas si no ha pasado [intervaloFotogramaMs] desde el
     * ultimo guardado -- ver la nota de clase sobre por que.
     */
    fun talVezGrabarFotograma(frame: Bitmap, detections: List<Detection>) {
        val ahoraNs = System.nanoTime()
        if (ahoraNs - ultimoFotogramaGuardadoNs < intervaloNs) return
        ultimoFotogramaGuardadoNs = ahoraNs

        try {
            val anotado = dibujarCajas(frame, detections)
            val numero = contadorFotogramas.incrementAndGet()
            val archivo = File(carpetaFotogramas, String.format(Locale.US, "%05d.jpg", numero))
            FileOutputStream(archivo).use { out ->
                anotado.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }
        } catch (e: Exception) {
            Log.e(TAG, "no se pudo guardar el fotograma anotado", e)
        }
    }

    /**
     * Copia del fotograma con las cajas YA dibujadas encima -- mismo estilo
     * que [com.olo.edges21.ui.OverlayView], pero pintado sobre una copia
     * mutable del Bitmap en vez de un View aparte: el archivo .jpg tiene que
     * verse igual que la pantalla sin depender de que la vista siga viva.
     */
    private fun dibujarCajas(frame: Bitmap, detections: List<Detection>): Bitmap {
        val copia = frame.copy(Bitmap.Config.ARGB_8888, /* mutable = */ true)
        if (detections.isEmpty()) return copia
        val canvas = Canvas(copia)
        val boxPaint = Paint().apply {
            style = Paint.Style.STROKE
            strokeWidth = 4f
            color = Color.GREEN
            isAntiAlias = true
        }
        val textPaint = Paint().apply {
            color = Color.GREEN
            textSize = 32f
            isAntiAlias = true
            setShadowLayer(4f, 0f, 0f, Color.BLACK)
        }
        val w = copia.width.toFloat()
        val h = copia.height.toFloat()
        for (d in detections) {
            val rect = RectF(d.bboxX * w, d.bboxY * h, (d.bboxX + d.bboxWidth) * w, (d.bboxY + d.bboxHeight) * h)
            canvas.drawRect(rect, boxPaint)
            val label = "${d.className} ${(d.confidence * 100).toInt()}%"
            canvas.drawText(label, rect.left, (rect.top - 8f).coerceAtLeast(20f), textPaint)
        }
        return copia
    }
}
