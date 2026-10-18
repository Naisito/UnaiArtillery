// ============================================================================
//  reports.ts — Informes de tiro que la pieza entrega a la pestaña ANÁLISIS.
//
//  Construcción PURA (sin DOM): a partir del FlightResult y del objetivo se
//  calcula el fallo y su descomposición en la línea de tiro, el ángulo de
//  caída, la energía en el impacto y la clasificación del resultado.
// ============================================================================
import type { FlightResult } from '../ballistics';
import { angleOfFallDeg, missComponents } from './units';

export interface Xyz { x: number; y: number; z: number }

export interface ShotReport {
  weaponName: string;
  roundName: string;
  fuzeLabel: string;
  rangeM: number;
  tofS: number;
  apexM: number;
  maxMach: number;
  impactSpeedMS: number;
  angleOfFallDeg: number;
  impactEnergyJ: number;
  detonation: 'ground' | 'air' | 'buried';
  burstHeightM: number;
  impact: Xyz;
  target: Xyz | null;
  miss: { missM: number; rangeM: number; deflM: number } | null;
  guided: boolean;
  /** Tramos (1 = sin rebote; >1 = rebotes rasantes de armas ligeras). */
  segments: number;
}

export interface SalvoReport {
  rounds: number;
  cepM: number;
  mpi: Xyz;
  target: Xyz | null;
  mpiMiss: { missM: number; rangeM: number; deflM: number } | null;
}

export interface PredictionReport {
  sigmaRangeM: number;
  sigmaCrossM: number;
  rangeM: number;
}

export interface CompareReport {
  entries: { label: string; cssColor: string; rangeM: number; tofS: number }[];
}

/** Informe de un disparo a partir de su vuelo (tramo final si hay rebotes). */
export function buildShotReport(
  segments: FlightResult[],
  meta: { weaponName: string; roundName: string; fuzeLabel: string; guided: boolean },
  target: Xyz | null,
): ShotReport {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const tail = last.path[last.path.length - 1];
  const v = tail?.velocity ?? { x: 0, y: 0, z: 0 };
  const speed = tail ? Math.hypot(v.x, v.y, v.z) : last.impactSpeed;
  const mass = tail?.mass ?? 0;
  const impact = { x: last.impactPoint.x, y: last.impactPoint.y, z: last.impactPoint.z };
  return {
    ...meta,
    rangeM: Math.hypot(impact.x, impact.y),
    tofS: segments.reduce((s, f) => s + f.timeOfFlight, 0),
    apexM: Math.max(...segments.map((f) => f.apex)),
    maxMach: Math.max(...segments.map((f) => f.maxMach)),
    impactSpeedMS: speed,
    angleOfFallDeg: tail ? angleOfFallDeg(v) : 0,
    impactEnergyJ: 0.5 * mass * speed * speed,
    detonation: last.detonation,
    burstHeightM: last.burstHeightM,
    impact,
    target,
    miss: target ? missComponents(impact, target) : null,
    guided: meta.guided,
    segments: segments.length || (first ? 1 : 0),
  };
}

/** Informe de una salva dispersa (PMI y su fallo respecto al objetivo). */
export function buildSalvoReport(impacts: Xyz[], cepM: number, target: Xyz | null): SalvoReport {
  const n = Math.max(1, impacts.length);
  const mpi = {
    x: impacts.reduce((s, p) => s + p.x, 0) / n,
    y: impacts.reduce((s, p) => s + p.y, 0) / n,
    z: impacts.reduce((s, p) => s + p.z, 0) / n,
  };
  return {
    rounds: impacts.length,
    cepM,
    mpi,
    target,
    mpiMiss: target ? missComponents(mpi, target) : null,
  };
}

/** Clasificación del fallo (misma escala que el reto: 25/75/150 m). */
export function missGrade(missM: number): 'ok' | 'warn' | 'danger' {
  if (missM < 25) return 'ok';
  if (missM < 150) return 'warn';
  return 'danger';
}
