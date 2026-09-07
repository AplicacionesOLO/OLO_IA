package com.olo.edges21.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

/**
 * Decoracion pura de "visor" -- cuadricula de tercios, marcas de esquina y
 * cruz central, igual que el HUD de una app de vuelo o una camara profesional.
 * No mide nada, no procesa nada: es la diferencia visual entre "una camara
 * mostrando video" y "un instrumento apuntando a algo". Se puede ocultar con
 * [mostrarCuadricula] sin afectar el pipeline de inferencia -- vive en su
 * propia capa, separada de [OverlayView], que sí depende de datos reales
 * (las detecciones).
 */
class HudGridView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    var mostrarCuadricula: Boolean = true
        set(value) {
            field = value
            invalidate()
        }

    private val lineaTercios = Paint().apply {
        color = Color.argb(70, 255, 255, 255)
        strokeWidth = 1.5f
        style = Paint.Style.STROKE
        isAntiAlias = true
    }

    private val esquina = Paint().apply {
        color = Color.argb(220, 124, 252, 152) // mismo verde de syncStatusText en modo OK
        strokeWidth = 4f
        style = Paint.Style.STROKE
        isAntiAlias = true
        strokeCap = Paint.Cap.ROUND
    }

    private val cruzCentral = Paint().apply {
        color = Color.argb(160, 124, 252, 152)
        strokeWidth = 2f
        style = Paint.Style.STROKE
        isAntiAlias = true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!mostrarCuadricula) return

        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0 || h <= 0) return

        // Lineas de tercios -- ayuda a encuadrar el rack, no decoracion sola:
        // es la misma guia que usa cualquier camara para no cortar el sujeto.
        val x1 = w / 3f
        val x2 = w * 2f / 3f
        val y1 = h / 3f
        val y2 = h * 2f / 3f
        canvas.drawLine(x1, 0f, x1, h, lineaTercios)
        canvas.drawLine(x2, 0f, x2, h, lineaTercios)
        canvas.drawLine(0f, y1, w, y1, lineaTercios)
        canvas.drawLine(0f, y2, w, y2, lineaTercios)

        // Marcas de esquina (estilo visor de camara/dron) -- un margen fijo
        // para que no toquen el borde real de la pantalla.
        val margen = minOf(w, h) * 0.04f
        val largo = minOf(w, h) * 0.06f
        dibujarEsquina(canvas, margen, margen, largo, largo)
        dibujarEsquina(canvas, w - margen, margen, -largo, largo)
        dibujarEsquina(canvas, margen, h - margen, largo, -largo)
        dibujarEsquina(canvas, w - margen, h - margen, -largo, -largo)

        // Cruz central pequeña -- punto de referencia, no un retículo de armas;
        // deliberadamente discreta (radio corto, sin circulo alrededor).
        val cx = w / 2f
        val cy = h / 2f
        val r = minOf(w, h) * 0.015f
        canvas.drawLine(cx - r, cy, cx + r, cy, cruzCentral)
        canvas.drawLine(cx, cy - r, cx, cy + r, cruzCentral)
    }

    private fun dibujarEsquina(canvas: Canvas, x: Float, y: Float, dx: Float, dy: Float) {
        canvas.drawLine(x, y, x + dx, y, esquina)
        canvas.drawLine(x, y, x, y + dy, esquina)
    }
}
