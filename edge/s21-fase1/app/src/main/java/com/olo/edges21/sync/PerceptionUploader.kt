package com.olo.edges21.sync

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sube lo que este dispositivo ya detecto al MISMO contrato que
 * `backend/tools/inferir.py::_procesar_directo` usa hoy para un directo real
 * -- ver el comentario de clase de `DetectionBatcher.kt`. Es la Fase 3 del
 * ADR-015: la pieza que faltaba para que esto aparezca en la app web.
 *
 * ── POR QUE `stream_url` ES UN MARCADOR DE POSICION ─────────────────────────
 *
 * Un job de "directo" normalmente lo llena un worker aparte que abre
 * `stream_url` con `cv2.VideoCapture` y corre el modelo el mismo (ver
 * `PerceptionService.start_live`, `perception.py`). Aqui no hay tal worker:
 * el modelo YA corrio en este telefono (`FrameProcessor`), asi que no hay
 * video que nadie mas necesite leer. `stream_url` solo tiene que pasar la
 * validacion del esquema (`http(s)://`, `rtmp://` o `rtsp://`) -- nunca la
 * abre nadie, porque este mismo proceso es el unico que escribe detecciones
 * en el job.
 *
 * ── POR QUE NO HACE FALTA UN `POST /jobs/{id}/status` APARTE ────────────────
 *
 * `ingest_detections` en el servicio ya mueve el job de `queued` a `running`
 * en el primer lote (`mark_completed=false`) -- ver `PerceptionService.
 * ingest_detections` en perception.py. Encadenar un cambio de estado antes
 * seria una llamada de mas para lo mismo que el primer lote ya hace.
 */
class PerceptionUploader(
    private val api: OloApiClient,
    private val warehouseId: String,
    private val nombre: String,
    // Para que la pantalla pueda mostrar, en una sola linea, si esto de verdad
    // esta llegando al backend o no -- ver `syncStatusText` en activity_main.xml.
    // Se llama desde el hilo de fondo del DetectionBatcher; quien lo use debe
    // saltar al hilo principal el mismo (`runOnUiThread`), esta clase no lo hace
    // para no acoplarse a Android UI.
    private val onEstado: (String) -> Unit = {},
    // Para que FleetHeartbeat reporte "este telefono esta en el job X" en el
    // modulo de Flota (ver core.fleet_devices.current_job_id, migracion 0110)
    // -- null cuando no hay ninguno (todavia no se creo, o ya se cerro).
    private val onJobId: (String?) -> Unit = {},
    // Publica por diseno -- ver la nota en gradle.properties. Solo hace falta
    // para subir fotogramas (Storage la exige ademas del Bearer del usuario).
    private val supabaseAnonKey: String = "",
) {
    companion object {
        private const val TAG = "PerceptionUploader"

        // Por debajo del umbral real de `FrameProcessor` (0.3f) a proposito:
        // el backend rechaza el LOTE ENTERO si trae una sola deteccion por
        // debajo del umbral que el propio job declaro (ver `ingest_detections`
        // en perception.py). Un margen evita que una diferencia de precision
        // Float(Kotlin) vs float(Python) en el limite (0.30000001 vs 0.3)
        // tire un lote entero por un redondeo, no por una detección real.
        private const val UMBRAL_JOB = 0.25
        private const val FPS_DECLARADO = 3.0
    }

    @Volatile private var jobId: String? = null
    @Volatile private var cerrado = false
    @Volatile private var lotesEnviados = 0
    @Volatile private var deteccionesEnviadas = 0

    // Donde subir fotogramas para ESTE job -- ver crop_prefix en perception.py
    // (0091). Se piden UNA vez, justo despues de crear el job (misma llamada
    // de fondo que ya bloquea para crearlo), y se leen desde el hilo de
    // FrameProcessor via `rutaParaNuevoFotograma()` -- de ahi el `@Volatile`,
    // los escribe un hilo y los lee otro.
    @Volatile private var cropPrefix: String? = null
    @Volatile private var cropUploadBase: String? = null

    /** Cuantas detecciones se llevan subidas -- para preguntar "¿enviar o descartar?"
     * con un numero real en vez de "esta sesion" a secas. */
    val totalDeteccionesEnviadas: Int get() = deteccionesEnviadas

    /** Si ya se creo un job de verdad -- sin esto, "descartar" no tendria nada
     * que cancelar (la sesion nunca llego a mandar una sola deteccion). */
    fun hayJobCreado(): Boolean = jobId != null

    /** Crea el job en vivo si todavia no existe. Llamar desde el hilo de fondo. */
    private fun asegurarJob(): String {
        jobId?.let { return it }
        val cuerpo = JSONObject().apply {
            put("warehouse_id", warehouseId)
            put("name", nombre)
            put("stream_url", "https://edge.olo-s21.local/sesion-${System.currentTimeMillis()}")
            put("pipeline", "object-detection")
            put("confidence_threshold", UMBRAL_JOB)
            put("frame_sampling_rate", FPS_DECLARADO)
            put(
                "notes",
                "Fase 1 del ADR-015: deteccion corrida EN el propio dispositivo (S21), " +
                    "no por un worker que lee un stream de video.",
            )
            // Ver migracion 0109. Sin esto, el worker real de inferencia del proyecto
            // reclama este job en segundos, no puede abrir el stream_url (que es un
            // marcador de posicion) y lo marca `failed` antes de que este dispositivo
            // pueda depositar una sola deteccion -- probado en vivo, dos veces.
            put("origin", "edge_device")
        }
        onEstado("☁ Conectando con OLO_IA...")
        val job = api.post("/v1/perception/live", cuerpo)
        val id = job.getString("id")
        jobId = id
        Log.i(TAG, "job en vivo creado: $id (almacen=$warehouseId)")
        onEstado("☁ Job creado en OLO_IA -- esperando detecciones...")
        onJobId(id)
        asegurarPrefijoDeRecortes(id)
        return id
    }

    /**
     * Pide UNA vez donde subir los fotogramas de este job (ver `crop_prefix`
     * en perception.py, 0091) -- justo despues de crear el job, en la misma
     * llamada de fondo que ya bloqueaba para eso. Si falla, las capturas de
     * esta sesion simplemente no tienen imagen -- las detecciones se siguen
     * mandando igual, esto es un extra, no algo que deba tumbar la sesion.
     */
    private fun asegurarPrefijoDeRecortes(id: String) {
        try {
            val datos = api.get("/v1/perception/jobs/$id/crop-prefix")
            cropPrefix = datos.getString("prefix")
            cropUploadBase = datos.getString("upload_base")
            Log.i(TAG, "prefijo de recortes listo: $cropPrefix")
        } catch (e: Exception) {
            Log.w(TAG, "no se pudo obtener el prefijo de recortes -- sin imagenes en esta sesion (${e.message})")
        }
    }

    /**
     * Una ruta NUEVA y determinista para el proximo fotograma -- sin red, se
     * puede llamar desde cualquier hilo. `null` si el job/prefijo todavia no
     * estan listos (los primeros segundos de la sesion, antes del primer
     * lote) -- en ese caso ese fotograma en particular no lleva imagen, pero
     * los siguientes si en cuanto el prefijo llegue.
     */
    fun rutaParaNuevoFotograma(): String? {
        val prefijo = cropPrefix ?: return null
        return "$prefijo/${System.currentTimeMillis()}.jpg"
    }

    /**
     * Sube el fotograma a Storage EN SU PROPIO HILO -- adrede "fire and
     * forget": la ruta ya viaja en el lote de detecciones (ver
     * `rutaParaNuevoFotograma`) antes de que esta subida siquiera empiece, asi
     * que esperarla bloquearia el pipeline de inferencia para nada. Un fallo
     * aqui deja un `crop_path` que apunta a una imagen que nunca llego --
     * mismo riesgo que ya se acepta si `enviarLote` falla para ese lote.
     */
    fun subirFotogramaEnFondo(jpegBytes: ByteArray, ruta: String) {
        val base = cropUploadBase ?: return
        Thread {
            try {
                api.subirBinario("$base/$ruta", jpegBytes, "image/jpeg", supabaseAnonKey)
                Log.i(TAG, "fotograma subido: $ruta (${jpegBytes.size} bytes)")
            } catch (e: Exception) {
                Log.w(TAG, "no se pudo subir el fotograma $ruta (${e.message})")
            }
        }.start()
    }

    /**
     * Un lote de [com.olo.edges21.sync.DetectionBatcher] -- se llama desde su
     * propio hilo de fondo, nunca desde la UI. No relanza: un fallo de red
     * aqui no debe tumbar la grabacion local, que es la copia de respaldo
     * (ver `LocalRecorder`).
     */
    fun enviarLote(detecciones: JSONArray) {
        if (cerrado || detecciones.length() == 0) return
        try {
            val id = asegurarJob()
            val cuerpo = JSONObject().apply {
                put("detections", detecciones)
                put("replace", false) // aditivo: cada lote SUMA, nunca borra los anteriores
                put("mark_completed", false)
            }
            val resultado = api.post("/v1/perception/jobs/$id/detections", cuerpo)
            val estado = resultado.optJSONObject("job")?.optString("status")
            lotesEnviados++
            deteccionesEnviadas += detecciones.length()
            Log.i(TAG, "lote subido (${detecciones.length()} detecciones) -> job $estado")
            onEstado(
                "☁ Enviando a OLO_IA: $deteccionesEnviadas detecciones · " +
                    "$lotesEnviados lotes · job $estado",
            )
        } catch (e: Exception) {
            Log.e(TAG, "no se pudo subir el lote al backend -- queda solo en LocalRecorder", e)
            onEstado("⚠ Sin conexion al backend -- guardando solo en el telefono (${e.message})")
        }
    }

    /** Cierra el job COMO REAL. Llamar cuando el usuario confirma que quiere
     * quedarse con esta sesion (ver el dialogo en MainActivity), o desde
     * onDestroy si la app se cierra sin preguntar. */
    fun cerrar() {
        val id = jobId
        if (id == null || cerrado) return
        cerrado = true
        try {
            val cuerpo = JSONObject().apply {
                put("detections", JSONArray())
                put("replace", false)
                put("mark_completed", true)
            }
            api.post("/v1/perception/jobs/$id/detections", cuerpo)
            Log.i(TAG, "job cerrado: $id")
            onEstado("☁ Job cerrado en OLO_IA -- $deteccionesEnviadas detecciones en total")
        } catch (e: Exception) {
            Log.e(TAG, "no se pudo cerrar el job en el backend", e)
            onEstado("⚠ No se pudo cerrar el job en el backend (${e.message})")
        } finally {
            onJobId(null)
        }
    }

    /**
     * Descarta el job -- lo mueve a `cancelled` en vez de `completed`, para
     * que una prueba manual (apuntar la camara a lo que sea, sin intencion de
     * inventariar de verdad) no quede archivada como si fuera un analisis
     * real. Ver PerceptionService.change_status en el backend: `cancelled` es
     * un estado terminal valido igual que `completed`, y el mismo permiso
     * (`perception:write`) que ya usa este dispositivo alcanza.
     *
     * OJO CON LO QUE ESTO NO DESHACE: las detecciones que ya se subieron en
     * lotes anteriores (mientras la sesion estaba en vivo) NO se borran --
     * cancelar el job las deja donde estan, solo cambia la etiqueta del job de
     * `completed` a `cancelled` para que quien mire la lista sepa que no es
     * un resultado real. Borrarlas de verdad seria una llamada aparte que
     * esta version no hace.
     */
    fun descartar(motivo: String) {
        val id = jobId
        if (id == null || cerrado) return
        cerrado = true
        try {
            val cuerpo = JSONObject().apply {
                put("to_status", "cancelled")
                put("reason", motivo)
            }
            api.post("/v1/perception/jobs/$id/status", cuerpo)
            Log.i(TAG, "job descartado (cancelled): $id -- $motivo")
            onEstado("☁ Sesion descartada -- no cuenta como analisis real")
        } catch (e: Exception) {
            Log.e(TAG, "no se pudo descartar el job en el backend", e)
            onEstado("⚠ No se pudo descartar el job en el backend (${e.message})")
        } finally {
            onJobId(null)
        }
    }
}
