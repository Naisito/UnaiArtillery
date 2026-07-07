// ============================================================================
//  burst.ts — Lógica PURA de la ráfaga automática.  [P-VIVO.2]
//
//  Una M2 real escupe ~9 disparos/s con una trazadora cada 5 balas. Aquí vive
//  todo el número de la ráfaga — timestamps desde la cadencia, selección de
//  trazadoras, jitter de rebufo y de audio con RNG INYECTADO (el mismo
//  mulberry32 determinista de la dispersión: semilla por ráfaga = ráfaga
//  reproducible). ArtilleryPiece solo consume estos valores.
// ============================================================================
import { DeterministicRng } from './random';

/** σ del rebufo por bala (mils NATO): la ametralladora "pasea" el punto. */
export const BURST_JITTER_SIGMA_MILS = 2.5;

/** Tope de proyectiles simultáneos en vuelo (FIFO: el más viejo se descarta). */
export const MAX_LIVE_PROJECTILES = 24;

const MILS_TO_DEG = 360 / 6400;

/** Instante del disparo `index` (0-based) a `rpm` disparos/minuto. */
export function shotTimeS(index: number, rpm: number): number {
  return (index * 60) / Math.max(1, rpm);
}

/** ¿La bala `index` (0-based) lleva trazadora? La 5ª, 10ª, 15ª… con every=5. */
export function isTracer(index: number, tracerEvery: number): boolean {
  return tracerEvery > 0 && (index + 1) % tracerEvery === 0;
}

export interface BurstLay {
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Puntería perturbada por el rebufo: gaussiana de σ mils en cada eje con el
 * RNG inyectado. Mismo RNG + misma semilla => misma ráfaga, bala a bala.
 */
export function perturbedLay(
  azimuthDeg: number,
  elevationDeg: number,
  rng: DeterministicRng,
  sigmaMils = BURST_JITTER_SIGMA_MILS,
): BurstLay {
  return {
    azimuthDeg: azimuthDeg + rng.gaussian(0, sigmaMils * MILS_TO_DEG),
    elevationDeg: elevationDeg + rng.gaussian(0, sigmaMils * MILS_TO_DEG),
  };
}

/** Jitter del audio de la ráfaga: ±maxS uniformes (default ±5 ms). */
export function fireJitterS(rng: DeterministicRng, maxS = 0.005): number {
  return (rng.next() * 2 - 1) * maxS;
}
