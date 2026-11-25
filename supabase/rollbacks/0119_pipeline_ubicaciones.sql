-- ═══════════════════════════════════════════════════════════════════════════
-- 0119_pipeline_ubicaciones.sql (ROLLBACK)
-- Revierte el CHECK al conjunto de 0069 (los tres pipelines originales).
--
-- OJO: si ya existen trabajos con pipeline='ubicaciones', este rollback FALLA al
-- re-crear el CHECK (hay filas que no lo cumplen). Primero habría que migrar o
-- borrar esos trabajos. Es el comportamiento correcto: no se debe invalidar en
-- silencio datos que ya existen.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE perception.inference_jobs DROP CONSTRAINT chk_job_pipeline;

ALTER TABLE perception.inference_jobs ADD CONSTRAINT chk_job_pipeline CHECK (
    pipeline IN ('object-detection', 'ocr', 'detection-ocr')
);
