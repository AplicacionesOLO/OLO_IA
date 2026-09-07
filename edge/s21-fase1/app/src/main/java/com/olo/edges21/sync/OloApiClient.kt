package com.olo.edges21.sync

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Cliente HTTP minimo contra la API de OLO_IA -- MISMO contrato de
 * autenticacion que `backend/tools/sesion.py`: Supabase Auth por
 * email/password, con refresco antes de que el token caduque (una hora).
 *
 * No se usa una libreria HTTP (Retrofit/OkHttp): es la unica llamada de red
 * de toda la app, y `HttpURLConnection` de la JDK basta -- el mismo criterio
 * que `sesion.py` sigue con `urllib` en vez de `httpx` en el lado Python.
 *
 * Debe llamarse SIEMPRE desde un hilo de fondo: bloquea en I/O de red. En
 * esta app eso ya es cierto -- se usa desde el hilo del `DetectionBatcher`.
 */
class OloApiClient(
    private val baseUrl: String,
    private val email: String,
    private val password: String,
) {
    companion object {
        private const val TAG = "OloApiClient"

        /** Igual que `MARGEN_RENOVACION_S` de sesion.py: pedir uno nuevo con margen. */
        private const val MARGEN_RENOVACION_S = 120L
    }

    class HttpStatusException(val status: Int, detalle: String) :
        RuntimeException("HTTP $status: ${detalle.take(300)}")

    private val lock = Any()
    private var accessToken: String = ""
    private var refreshToken: String = ""
    private var expiraEn: Long = 0L

    /** El token vigente, renovando por adelantado si le queda poco -- igual que `Sesion.vigente()`. */
    private fun vigente(): String = synchronized(lock) {
        val ahora = System.currentTimeMillis() / 1000
        if (accessToken.isEmpty() || ahora >= expiraEn - MARGEN_RENOVACION_S) {
            try {
                if (refreshToken.isNotEmpty()) refrescar() else entrar()
            } catch (e: Exception) {
                Log.w(TAG, "fallo renovando la sesion (${e.message}); entrando de nuevo")
                entrar()
            }
        }
        accessToken
    }

    private fun entrar() {
        val cuerpo = JSONObject().apply {
            put("email", email)
            put("password", password)
        }
        guardar(peticion("POST", "/v1/auth/login", cuerpo, token = null))
    }

    private fun refrescar() {
        val cuerpo = JSONObject().apply { put("refresh_token", refreshToken) }
        guardar(peticion("POST", "/v1/auth/refresh", cuerpo, token = null))
    }

    private fun guardar(datos: JSONObject) {
        accessToken = datos.getString("access_token")
        refreshToken = datos.optString("refresh_token", "")
        expiraEn = if (datos.has("expires_at") && !datos.isNull("expires_at")) {
            datos.getLong("expires_at")
        } else {
            System.currentTimeMillis() / 1000 + datos.optLong("expires_in", 3600)
        }
    }

    /**
     * POST autenticado. Un reintento tras 401 con un token recien renovado --
     * mismo criterio que `Api._pedir` en Python: un 403 (falta de permiso) NO
     * se reintenta, porque renovar el token no cambia los permisos.
     */
    fun post(ruta: String, cuerpo: JSONObject): JSONObject {
        return try {
            peticion("POST", ruta, cuerpo, token = vigente())
        } catch (e: HttpStatusException) {
            if (e.status == 401) {
                synchronized(lock) { accessToken = "" } // fuerza una renovacion real, no una cacheada
                peticion("POST", ruta, cuerpo, token = vigente())
            } else {
                throw e
            }
        }
    }

    /** GET autenticado. Mismo reintento tras 401 que [post]. */
    fun get(ruta: String): JSONObject {
        return try {
            peticion("GET", ruta, cuerpo = null, token = vigente())
        } catch (e: HttpStatusException) {
            if (e.status == 401) {
                synchronized(lock) { accessToken = "" }
                peticion("GET", ruta, cuerpo = null, token = vigente())
            } else {
                throw e
            }
        }
    }

    /**
     * Sube bytes DIRECTO a una URL absoluta de Supabase Storage -- el mismo
     * camino que `ApiClient.subirBinario` del frontend y `StorageClient` del
     * backend (`storage/v1/object/{bucket}/{path}`). NO pasa por `baseUrl`
     * (Storage vive en el propio proyecto de Supabase, no en este backend) y
     * NO envuelve la respuesta en `{"data": ...}` -- Storage no es esta API.
     *
     * Storage exige `apikey` ADEMAS del Bearer del usuario, aunque el JWT sea
     * valido -- mismo detalle documentado en `StorageClient` (Python) y
     * `ApiClient.subirBinario` (frontend).
     */
    fun subirBinario(url: String, bytes: ByteArray, contentType: String, anonKey: String) {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", contentType)
        conn.setRequestProperty("Authorization", "Bearer ${vigente()}")
        conn.setRequestProperty("apikey", anonKey)
        conn.doOutput = true
        conn.connectTimeout = 10_000
        conn.readTimeout = 20_000 // una foto pesa mas que un lote de detecciones JSON
        try {
            conn.outputStream.use { it.write(bytes) }
            val codigo = conn.responseCode
            if (codigo >= 300) {
                val detalle = conn.errorStream?.bufferedReader()?.readText().orEmpty()
                throw HttpStatusException(codigo, detalle)
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun peticion(metodo: String, ruta: String, cuerpo: JSONObject?, token: String?): JSONObject {
        val conn = URL("$baseUrl$ruta").openConnection() as HttpURLConnection
        conn.requestMethod = metodo
        conn.setRequestProperty("Content-Type", "application/json")
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        conn.doOutput = cuerpo != null
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        try {
            if (cuerpo != null) {
                conn.outputStream.use { it.write(cuerpo.toString().toByteArray(StandardCharsets.UTF_8)) }
            }
            val codigo = conn.responseCode
            if (codigo >= 300) {
                val detalle = conn.errorStream?.bufferedReader()?.readText().orEmpty()
                throw HttpStatusException(codigo, detalle)
            }
            val texto = conn.inputStream.bufferedReader().readText()
            if (texto.isBlank()) return JSONObject()
            val raiz = JSONObject(texto)
            // El backend envuelve todo en {"data": ...} -- ver `Envelope` en schemas.py.
            return raiz.optJSONObject("data") ?: raiz
        } finally {
            conn.disconnect()
        }
    }
}
