// ============================================================================
//  random.ts — Deterministic, seedable PRNG for the dispersion model (P1.6).
//
//  Never Math.random(): reproducibility is an acceptance criterion. mulberry32
//  is a tiny 32-bit generator with good statistical quality for Monte-Carlo of
//  this size; gaussians come from the Marsaglia polar method.
// ============================================================================

export class DeterministicRng {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9; // seed 0 would degenerate
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Normal(mean, std) via Marsaglia polar (caches the spare deviate). */
  gaussian(mean = 0, std = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + std * v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mean + std * (u * m);
  }
}
