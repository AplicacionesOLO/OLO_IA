package com.olo.edges21.sync

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.olo.edges21.BuildConfig
import org.json.JSONObject
import java.util.UUID

/**
 * Anuncia este telefono en el modulo de Flota del backend (ver
 * `POST /v1/fleet/devices/heartbeat`, migracion 0110 del backend). Corre
 * SIEMPRE que la app esta abierta -- a diferencia de [PerceptionUploader],
 * que solo existe mientras hay una sesion de simulacion -- porque "el
 * telefono esta conectado" es una pregunta distinta de "el telefono esta
 * mandando detecciones ahora mismo".
 *
 * ── POR QUE `device_key` VIVE EN SharedPreferences Y NO LO ASIGNA EL SERVIDOR ──
 *
 * Este mismo telefono tiene que reconocerse a si mismo despues de un
 * reinicio de la app, incluso si se reinstala el APK, SIN depender de haber
 * guardado un id que el servidor le dio la vez anterior. Se genera un UUID
 * la primera vez y se persiste local -- ver la cabecera de la migracion 0110
 * para el porque completo.
 *
 * ── POR QUE 20 S Y NO LOS 30 S DE UN WORKER ────────────────────────────────
 *
 * La ventana de "offline" de un dispositivo de flota es de 45 s (mas corta
 * que los 90 s de un worker -- ver 0110: un worker es un proceso de servidor
 * con un latido exacto, un telefono depende de una red movil que se puede
 * colgar un instante). 20 s de intervalo tolera perder UN latido sin
 * parpadear a "apagado" en el modulo de Flota.
 */
class FleetHeartbeat(
    private val context: Context,
    private val api: OloApiClient,
    private val warehouseId: String,
    private val nombre: String,
) {
    companion object {
        private const val TAG = "FleetHeartbeat"
        private const val PREFS = "olo_edge_device"
        private const val CLAVE_DEVICE_KEY = "device_key"
        private const val INTERVALO_MS = 20_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val deviceKey: String = obtenerOCrearDeviceKey()

    /** El job en vivo actual, si hay uno -- ver `PerceptionUploader`'s callback. */
    @Volatile var currentJobId: String? = null

    private val latidoRunnable = object : Runnable {
        override fun run() {
            Thread { latirUnaVez() }.start()
            handler.postDelayed(this, INTERVALO_MS)
        }
    }

    private fun obtenerOCrearDeviceKey(): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existente = prefs.getString(CLAVE_DEVICE_KEY, null)
        if (existente != null) return existente
        val nuevo = UUID.randomUUID().toString()
        prefs.edit().putString(CLAVE_DEVICE_KEY, nuevo).apply()
        Log.i(TAG, "device_key nueva generada: $nuevo")
        return nuevo
    }

    /** Llamar UNA vez, en onCreate -- corre mientras la Activity exista. */
    fun iniciar() {
        handler.post(latidoRunnable)
    }

    fun detener() {
        handler.removeCallbacks(latidoRunnable)
    }

    /**
     * Un latido FUERA de turno, ademas del ciclo de 20 s -- para que el
     * modulo de Flota refleje "en vivo"/"conectado" en cuanto cambia de
     * verdad (arranca o se cierra una simulacion), en vez de esperar hasta
     * 20 s a que le toque el proximo latido programado. Llamar despues de
     * cambiar `currentJobId`.
     */
    fun latirAhora() {
        Thread { latirUnaVez() }.start()
    }

    private fun latirUnaVez() {
        try {
            val cuerpo = JSONObject().apply {
                put("device_key", deviceKey)
                put("kind", "phone")
                put("name", nombre)
                put("warehouse_id", warehouseId)
                put("app_version", BuildConfig.VERSION_NAME)
                put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("current_job_id", currentJobId ?: JSONObject.NULL)
            }
            api.post("/v1/fleet/devices/heartbeat", cuerpo)
        } catch (e: Exception) {
            // No es un fallo que deba interrumpir nada: la app sigue funcionando
            // sin aparecer en el modulo de Flota, igual que sigue funcionando
            // sin subir detecciones si el backend no responde.
            Log.w(TAG, "no se pudo mandar el latido de flota (${e.message})")
        }
    }
}
