// ============================================================================
//  map/qe.ts — QE instantánea bajo el cursor a partir de la tabla de tiro.
//  [V2:MAP]
//
//  Interpola linealmente las filas de la tabla de tiro vigente (la que ya
//  calculó el panel para el arma/carga/meteo actuales): coste nulo por
//  movimiento de ratón y exactitud de tabla (±0.1 %). Sin tabla no hay
//  estimación — nunca se inventa. Módulo PURO.
// ============================================================================
import type { FiringTableRow } from '../ballistics';

export interface QeEstimate {
  lowDeg: number | null;
  highDeg: number | null;
  tofLowS: number | null;
  tofHighS: number | null;
}

function lerpNullable(a: number | null, b: number | null, f: number): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a + (b - a) * f;
}

/**
 * Estima QE (rama baja y alta) y TOF para `rangeM`. null si el alcance cae
 * fuera de la tabla (no se extrapola: fuera de tabla = fuera de alcance).
 */
export function interpolateQe(rows: FiringTableRow[], rangeM: number): QeEstimate | null {
  if (!rows.length || !Number.isFinite(rangeM)) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (rangeM < first.rangeM || rangeM > last.rangeM) return null;
  let i = 0;
  while (i < rows.length - 2 && rows[i + 1].rangeM < rangeM) i++;
  const a = rows[i];
  const b = rows[Math.min(rows.length - 1, i + 1)];
  const span = b.rangeM - a.rangeM;
  const f = span > 0 ? (rangeM - a.rangeM) / span : 0;
  const est: QeEstimate = {
    lowDeg: lerpNullable(a.qeLowDeg, b.qeLowDeg, f),
    highDeg: lerpNullable(a.qeHighDeg, b.qeHighDeg, f),
    tofLowS: lerpNullable(a.tofLowS, b.tofLowS, f),
    tofHighS: lerpNullable(a.tofHighS, b.tofHighS, f),
  };
  if (est.lowDeg === null && est.highDeg === null) return null;
  return est;
}
