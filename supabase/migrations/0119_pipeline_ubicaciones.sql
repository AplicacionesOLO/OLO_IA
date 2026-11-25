-- ═══════════════════════════════════════════════════════════════════════════
-- 0119_pipeline_ubicaciones.sql
-- Altera    : perception.inference_jobs (chk_job_pipeline)
-- Depende de: 0069 (inference_jobs y el CHECK original de pipeline)
-- Riesgo    : bajo -- solo AMPLIA el conjunto permitido; ninguna fila existente
--             deja de cumplir el CHECK (los tres valores viejos siguen válidos).
--
-- Añade el pipeline 'ubicaciones' («Solo ubicaciones vacías»): detecta todo pero
-- lee con OCR únicamente los códigos de ubicación (qr_ubicacion), saltándose el
-- OCR de pallets. El worker (tools/inferir.py), la API (schemas), el servicio y el
-- frontend ya lo conocían; faltaba el CHECK de la base, que rechazaba la inserción
-- con «chk_job_pipeline» y dejaba el pipeline inservible de punta a punta.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE perception.inference_jobs DROP CONSTRAINT chk_job_pipeline;

ALTER TABLE perception.inference_jobs ADD CONSTRAINT chk_job_pipeline CHECK (
    pipeline IN ('object-detection', 'ocr', 'detection-ocr', 'ubicaciones')
);
