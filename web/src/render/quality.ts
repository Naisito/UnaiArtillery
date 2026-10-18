// ============================================================================
//  quality.ts — Preajustes de calidad gráfica.  [V2]
//
//  CONTRATO (lo consume la UI de Ajustes; lo implementa el agente VFX):
//    applyQuality(level) reconfigura Cesium (resolución, MSAA/FXAA, error de
//    pantalla del terreno, sombras, niebla/atmósfera) y el overlay Three
//    (pixel ratio, densidad de partículas) y persiste la elección.
//    getQuality() devuelve el nivel vigente; onQualityChanged notifica.
//  Implementación provisional: solo guarda el nivel.
// ============================================================================

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  ultra: 'Ultra',
};

const KEY = 'unai-artillery/quality/v1';
let current: QualityLevel = 'high';
const listeners = new Set<(level: QualityLevel) => void>();

try {
  const saved = localStorage.getItem(KEY) as QualityLevel | null;
  if (saved && saved in QUALITY_LABELS) current = saved;
} catch {
  // sin almacenamiento
}

export function getQuality(): QualityLevel {
  return current;
}

export function applyQuality(level: QualityLevel): void {
  current = level;
  try {
    localStorage.setItem(KEY, level);
  } catch {
    // sin almacenamiento
  }
  for (const fn of listeners) fn(level);
}

export function onQualityChanged(fn: (level: QualityLevel) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
