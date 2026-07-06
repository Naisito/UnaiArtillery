// ============================================================================
//  challengeCore.ts — Lógica PURA del modo reto (P-PRO.7).
//
//  Separada de Challenge.ts (la capa DOM/Cesium) para poder testearse en el
//  entorno node de Vitest sin arrastrar Cesium: elección del objetivo con RNG
//  inyectado, escala de puntuación y récords que solo mejoran. La semilla del
//  reloj entra SOLO en la app.
// ============================================================================

export interface ChallengeTargetSpec {
  azimuthDeg: number; // [0, 360)
  rangeM: number;     // dentro del anillo jugable
}

/**
 * Elige un objetivo aleatorio en el anillo [0.4, 0.9]·alcanceMáx con azimut
 * uniforme. Si el arma tiene alcance mínimo (morteros a carga corta), el
 * borde interior se eleva a 1.1·mínimo para que el objetivo sea alcanzable.
 * `rng` devuelve uniformes en [0, 1) — inyectado para testear sin reloj.
 */
export function pickTargetInRing(
  rng: () => number,
  maxRangeM: number,
  minRangeM = 0,
): ChallengeTargetSpec {
  const lo = Math.max(0.4 * maxRangeM, minRangeM > 0 ? minRangeM * 1.1 : 0);
  const hi = 0.9 * maxRangeM;
  const rangeM = lo + Math.max(0, hi - lo) * rng();
  const azimuthDeg = 360 * rng();
  return { azimuthDeg, rangeM };
}

/**
 * Escala de puntuación (documentada): el fallo radial del PRIMER impacto.
 *   3★ < 25 m   — fuego de precisión (CEP de munición guiada)
 *   2★ < 75 m   — dentro del radio letal de una granada de 155 mm
 *   1★ < 150 m  — corrección de un observador avanzado en 1 salva
 *   0★ resto
 */
export const STAR_THRESHOLDS_M = [25, 75, 150] as const;

export function starsForMiss(missM: number): 0 | 1 | 2 | 3 {
  if (missM < STAR_THRESHOLDS_M[0]) return 3;
  if (missM < STAR_THRESHOLDS_M[1]) return 2;
  if (missM < STAR_THRESHOLDS_M[2]) return 1;
  return 0;
}

export function starBar(stars: number): string {
  return '★★★'.slice(0, stars).padEnd(3, '☆');
}

export interface ChallengeRecord {
  bestMissM: number;
  stars: number;
  atIso?: string;
}

/** El récord SOLO mejora: menor fallo gana (las estrellas van con él). */
export function improveRecord(
  prev: ChallengeRecord | null | undefined,
  missM: number,
  atIso?: string,
): { record: ChallengeRecord; improved: boolean } {
  if (prev && prev.bestMissM <= missM) return { record: prev, improved: false };
  return { record: { bestMissM: missM, stars: starsForMiss(missM), atIso }, improved: true };
}
