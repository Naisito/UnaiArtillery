// ============================================================================
//  burst.test.ts — P-VIVO.2: cadencia exacta, trazadoras 1/5 y jitter
//  reproducible por semilla.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { DeterministicRng } from './random';
import { fireJitterS, isTracer, perturbedLay, shotTimeS } from './burst';

describe('P-VIVO.2 — lógica pura de la ráfaga', () => {
  it('cadencia exacta: disparo i sale en i·60/rpm segundos', () => {
    // M2 a 550 rpm ≈ 9.2 disparos/s.
    expect(shotTimeS(0, 550)).toBe(0);
    expect(shotTimeS(1, 550)).toBeCloseTo(60 / 550, 12);
    expect(shotTimeS(9, 550)).toBeCloseTo((9 * 60) / 550, 12);
    // M240 a 750 rpm: 12.5 disparos/s.
    expect(shotTimeS(5, 750)).toBeCloseTo(0.4, 12);
  });

  it('trazadoras: exactamente 1 de cada 5 (la 5ª, la 10ª…)', () => {
    const flags = Array.from({ length: 20 }, (_, i) => isTracer(i, 5));
    expect(flags.filter(Boolean).length).toBe(4);
    expect(flags[4]).toBe(true);   // 5ª bala
    expect(flags[9]).toBe(true);   // 10ª
    expect(flags[0]).toBe(false);
    expect(flags[5]).toBe(false);
    // Sin trazadoras si el arma no las define.
    expect(isTracer(4, 0)).toBe(false);
  });

  it('rebufo: reproducible por semilla, distinto con otra semilla', () => {
    const a = new DeterministicRng(1234);
    const b = new DeterministicRng(1234);
    const c = new DeterministicRng(99);
    const layA = Array.from({ length: 12 }, () => perturbedLay(90, 10, a));
    const layB = Array.from({ length: 12 }, () => perturbedLay(90, 10, b));
    const layC = Array.from({ length: 12 }, () => perturbedLay(90, 10, c));
    expect(layA).toEqual(layB);
    expect(layA.map((l) => l.azimuthDeg)).not.toEqual(layC.map((l) => l.azimuthDeg));
    // El rebufo es pequeño: σ 2.5 mils ≈ 0.14º — ninguna bala se va a >1º (6σ).
    for (const l of layA) {
      expect(Math.abs(l.azimuthDeg - 90)).toBeLessThan(1);
      expect(Math.abs(l.elevationDeg - 10)).toBeLessThan(1);
    }
  });

  it('jitter de audio: dentro de ±5 ms y reproducible', () => {
    const a = new DeterministicRng(7);
    const b = new DeterministicRng(7);
    for (let i = 0; i < 50; i++) {
      const ja = fireJitterS(a);
      expect(Math.abs(ja)).toBeLessThanOrEqual(0.005);
      expect(ja).toBe(fireJitterS(b));
    }
  });
});
