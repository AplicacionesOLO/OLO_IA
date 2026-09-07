package com.olo.edges21.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import com.olo.edges21.inference.Detection

/**
 * Dibuja las cajas detectadas encima del fotograma. Las cajas de [Detection]
 * vienen normalizadas [0,1] respecto del fotograma ORIGINAL (mismo
 * `bbox_format: "normalized"` del contrato del backend) -- esta vista solo
 * las reescala al rectangulo donde el `ImageView` de abajo esta realmente
 * dibujando la imagen (letterbox de `scaleType="fitCenter"`), replicando a
 * mano la matematica de `fitCenter` porque no tenemos acceso directo a la
 * `Matrix` interna del ImageView desde aqui sin acoplar las dos vistas.
 */
class OverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    private var detections: List<Detection> = emptyList()
    private var frameWidth: Int = 0
    private var frameHeight: Int = 0

    private val boxPaint = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = 4f
        color = Color.GREEN
        isAntiAlias = true
    }
    private val textPaint = Paint().apply {
        color = Color.GREEN
        textSize = 32f
        isAntiAlias = true
        setShadowLayer(4f, 0f, 0f, Color.BLACK)
    }

    /** Llamar desde el hilo principal cada vez que hay un resultado nuevo. */
    fun update(detections: List<Detection>, frameWidth: Int, frameHeight: Int) {
        this.detections = detections
        this.frameWidth = frameWidth
        this.frameHeight = frameHeight
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (frameWidth <= 0 || frameHeight <= 0 || detections.isEmpty()) return

        // Letterbox de fitCenter: la imagen se escala entera para caber en la
        // vista, centrada, sin recortar -- misma matematica que
        // `Matrix.ScaleToFit.CENTER` que usa internamente `ImageView`.
        val viewW = width.toFloat()
        val viewH = height.toFloat()
        val scale = minOf(viewW / frameWidth, viewH / frameHeight)
        val drawnW = frameWidth * scale
        val drawnH = frameHeight * scale
        val offsetX = (viewW - drawnW) / 2f
        val offsetY = (viewH - drawnH) / 2f

        for (d in detections) {
            val rect = RectF(
                offsetX + d.bboxX * drawnW,
                offsetY + d.bboxY * drawnH,
                offsetX + (d.bboxX + d.bboxWidth) * drawnW,
                offsetY + (d.bboxY + d.bboxHeight) * drawnH,
            )
            canvas.drawRect(rect, boxPaint)
            val label = "${d.className} ${(d.confidence * 100).toInt()}%"
            canvas.drawText(label, rect.left, (rect.top - 8f).coerceAtLeast(20f), textPaint)
        }
    }
}
