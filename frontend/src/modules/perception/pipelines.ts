/**
 * PIPELINES — definicion de los pipelines de procesamiento disponibles.
 */

import type { ProcessingPipeline } from './types';

export const PIPELINES: readonly ProcessingPipeline[] = [
  {
    id: 'object-detection',
    label: 'Deteccion de objetos',
    description: 'Detecta y clasifica objetos con bounding boxes.',
    compatibleTasks: ['detect', 'segment', 'count'],
  },
  {
    id: 'ocr',
    label: 'OCR',
    description: 'Lectura de texto en etiquetas, codigos y señaletica.',
    compatibleTasks: ['ocr'],
  },
  {
    id: 'detection-ocr',
    label: 'Deteccion + OCR',
    description: 'Detecta objetos y lee texto dentro de cada deteccion.',
    compatibleTasks: ['detect', 'ocr'],
  },
];
