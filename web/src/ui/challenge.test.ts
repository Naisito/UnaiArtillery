// ============================================================================
//  challenge.test.ts — P-PRO.7: lógica pura del reto (sin DOM: entorno node).
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  STAR_THRESHOLDS_M, improveRecord, pickTargetInRing, starBar, starsForMiss,
} from './challengeCore';

/** RNG determinista (mulberry32) para muestrear sin reloj. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('P-PRO.7 — elección del objetivo', () => {
  it('el punto cae SIEMPRE en el anillo [0.4, 0.9]·maxRange con azimut [0,360)', () => {
    const r = rng(42);
    for (let i = 0; i < 500; i++) {
      const t = pickTargetInRing(r, 20000);
      expect(t.rangeM).toBeGreaterThanOrEqual(8000);
      expect(t.rangeM).toBeLessThanOrEqual(18000);
      expect(t.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(t.azimuthDeg).toBeLessThan(360);
    }
  });

  it('respeta el alcance mínimo del arma (borde interior 1.1·mín)', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      // Mortero a carga corta: mínimo 12 km sobre máximo 20 km.
      const t = pickTargetInRing(r, 20000, 12000);
      expect(t.rangeM).toBeGreaterThanOrEqual(12000 * 1.1);
      expect(t.rangeM).toBeLessThanOrEqual(18000);
    }
  });

  it('mismo RNG => mismo objetivo (determinista, la semilla es del llamador)', () => {
    const a = pickTargetInRing(rng(123), 15000);
    const b = pickTargetInRing(rng(123), 15000);
    expect(a).toEqual(b);
  });
});

describe('P-PRO.7 — puntuación', () => {
  it('umbrales de estrellas EXACTOS: 3★<25, 2★<75, 1★<150', () => {
    expect(STAR_THRESHOLDS_M).toEqual([25, 75, 150]);
    expect(starsForMiss(0)).toBe(3);
    expect(starsForMiss(24.999)).toBe(3);
    expect(starsForMiss(25)).toBe(2);
    expect(starsForMiss(74.999)).toBe(2);
    expect(starsForMiss(75)).toBe(1);
    expect(starsForMiss(149.999)).toBe(1);
    expect(starsForMiss(150)).toBe(0);
    expect(starsForMiss(5000)).toBe(0);
  });

  it('starBar pinta las estrellas ganadas y rellena con huecas', () => {
    expect(starBar(3)).toBe('★★★');
    expect(starBar(2)).toBe('★★☆');
    expect(starBar(1)).toBe('★☆☆');
    expect(starBar(0)).toBe('☆☆☆');
  });
});

describe('P-PRO.7 — récords', () => {
  it('el récord solo mejora (menor fallo gana; empate no cuenta)', () => {
    const first = improveRecord(null, 80, '2026-07-06');
    expect(first.improved).toBe(true);
    expect(first.record).toEqual({ bestMissM: 80, stars: 1, atIso: '2026-07-06' });

    const better = improveRecord(first.record, 20, '2026-07-07');
    expect(better.improved).toBe(true);
    expect(better.record.bestMissM).toBe(20);
    expect(better.record.stars).toBe(3);

    const worse = improveRecord(better.record, 60);
    expect(worse.improved).toBe(false);
    expect(worse.record).toBe(better.record); // intacto

    const tie = improveRecord(better.record, 20);
    expect(tie.improved).toBe(false);
  });
});
