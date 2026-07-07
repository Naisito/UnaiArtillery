// ============================================================================
//  ricochet.test.ts — P-VIVO.4: reflexión correcta sobre plano inclinado
//  sintético, energía siempre decreciente y reproducibilidad por semilla.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { DeterministicRng } from './random';
import {
  RICOCHET_MAX_ANGLE_DEG, grazingAngleDeg, magnitude, normalFromHeights,
  reflectVelocity, ricochetProbability, shouldRicochet,
} from './ricochet';

describe('P-VIVO.4 — geometría pura del rebote rasante', () => {
  it('normal del terreno desde tres alturas: plano llano y ladera 45º', () => {
    const flat = normalFromHeights(100, 100, 100, 10);
    expect(flat).toEqual({ x: -0, y: -0, z: 1 });
    // Ladera que sube 10 m por cada 10 m en +x: normal inclinada hacia -x.
    const slope = normalFromHeights(0, 10, 0, 10);
    expect(slope.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(slope.z).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('ángulo de caída: rasante pequeño, picado grande, sensible a la ladera', () => {
    const flat = { x: 0, y: 0, z: 1 };
    // 100 m/s horizontales con 10 m/s de caída → ~5.7º sobre plano llano.
    expect(grazingAngleDeg({ x: 100, y: 0, z: -10 }, flat)).toBeCloseTo(5.71, 1);
    expect(grazingAngleDeg({ x: 0, y: 0, z: -300 }, flat)).toBeCloseTo(90, 6);
    // El MISMO tiro contra una ladera de 45º de frente ya no es rasante.
    const slope = normalFromHeights(0, 10, 0, 10);
    expect(grazingAngleDeg({ x: 100, y: 0, z: -10 }, slope)).toBeGreaterThan(30);
  });

  it('probabilidad: 1 a 0º, lineal hasta 0 a 12º (y 0 por encima)', () => {
    expect(ricochetProbability(0)).toBe(1);
    expect(ricochetProbability(6)).toBeCloseTo(0.5, 9);
    expect(ricochetProbability(RICOCHET_MAX_ANGLE_DEG)).toBe(0);
    expect(ricochetProbability(45)).toBe(0);
  });

  it('reflexión especular amortiguada sobre plano llano (desvío anulable)', () => {
    // RNG que devuelve 0.5 → desvío exactamente 0º.
    const rng = { next: () => 0.5 } as DeterministicRng;
    const out = reflectVelocity({ x: 100, y: 0, z: -10 }, { x: 0, y: 0, z: 1 }, rng);
    expect(out.x).toBeCloseTo(55, 9);  // tangencial ×0.55
    expect(out.y).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(3, 9);   // normal invertida ×0.3: sale hacia ARRIBA
  });

  it('la energía SIEMPRE decrece, también sobre laderas y con desvío', () => {
    const rng = new DeterministicRng(31337);
    const normals = [
      { x: 0, y: 0, z: 1 },
      normalFromHeights(0, 3, -2, 10),
      normalFromHeights(50, 46, 55, 10),
    ];
    for (const n of normals) {
      for (const v of [
        { x: 890, y: 0, z: -40 },
        { x: -200, y: 300, z: -25 },
        { x: 10, y: 5, z: -80 },
      ]) {
        const out = reflectVelocity(v, n, rng);
        expect(magnitude(out)).toBeLessThan(magnitude(v));
        // Y la bala sale ALEJÁNDOSE de la superficie (componente normal ≥ 0).
        const vn = out.x * n.x + out.y * n.y + out.z * n.z;
        expect(vn).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reproducible por semilla: misma semilla = mismos rebotes, otra difiere', () => {
    const run = (seed: number) => {
      const rng = new DeterministicRng(seed);
      const decisions: boolean[] = [];
      const outs: number[] = [];
      for (let i = 0; i < 8; i++) {
        decisions.push(shouldRicochet(4, rng));
        const o = reflectVelocity({ x: 500, y: 40, z: -30 }, { x: 0, y: 0, z: 1 }, rng);
        outs.push(o.x, o.y, o.z);
      }
      return { decisions, outs };
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42).outs).not.toEqual(run(43).outs);
  });
});
