// ============================================================================
//  WeaponSystem.ts — Fire-control / weapon controller.
//
//  Port of core/WeaponSystem.h plus the P1.6 Monte-Carlo dispersion model and
//  the P2.2 MRSI solver. Responsibilities:
//    * Convert an (azimuth, elevation, muzzle velocity) lay into an ENU launch
//      velocity vector.
//    * Fire a round: build the initial state and run the RK4 solver.
//    * Inverse problem: bracket + bisect the range-vs-elevation curve to find
//      the quadrant elevation that lands on a target range (low/high branch).
//    * fireDispersed(): perturb V0 / lay / wind with a *deterministic* seeded
//      RNG and report the impact cloud + CEP.
//    * solveMRSI(): several rounds on different charges/branches timed so all
//      of them impact within a fraction of a second.
// ============================================================================
import { Atmosphere } from './Atmosphere';
import { BallisticsSolver, FlightResult, SolverConfig } from './BallisticsSolver';
import { Weapon } from './WeaponCatalog';
import { Vec3 } from './Vec3';
import { DeterministicRng } from './random';

export interface FireOrder {
  azimuthDeg: number;   // compass bearing to aim (0 = North, 90 = East)
  elevationDeg: number; // quadrant elevation
  chargeIndex: number;  // index into Weapon.charges (-1 => round default)
}

export function defaultFireOrder(): FireOrder {
  return { azimuthDeg: 0.0, elevationDeg: 45.0, chargeIndex: -1 };
}

export interface SolveResult {
  found: boolean;
  elevationDeg: number;
  timeOfFlight: number;
  impactSpeed: number;
  usedHighAngle: boolean;
}

// ---- P1.6 -------------------------------------------------------------------
export interface DispersionErrors {
  /** Std deviation of muzzle velocity (m/s). Lot-to-lot + round-to-round. */
  muzzleVelocityStd?: number;
  /** Std deviation of the azimuth lay (NATO mils, 6400/circle). */
  azimuthStdMils?: number;
  /** Std deviation of the elevation lay (NATO mils). */
  elevationStdMils?: number;
  /** Std deviation of an unreported steady wind, per horizontal axis (m/s). */
  windStd?: number;
}

export interface DispersionResult {
  impacts: Vec3[];    // ENU impact points
  meanImpact: Vec3;   // center of the impact cloud
  cep: number;        // radius containing 50% of impacts around the mean (m)
  /** Full trajectories, only when requested (P-NEXT.7: animate the salvo). */
  flights?: FlightResult[];
}

// ---- P2.2 -------------------------------------------------------------------
export interface MrsiRound {
  chargeIndex: number;
  elevationDeg: number;
  timeOfFlight: number;
  /** Seconds to wait after the FIRST round before firing this one. */
  fireDelay: number;
  usedHighAngle: boolean;
}

const MILS_TO_DEG = 360.0 / 6400.0;

export class WeaponSystem {
  private readonly solver: BallisticsSolver;

  constructor(
    private readonly atmo: Atmosphere,
    private readonly cfg: SolverConfig,
  ) {
    this.solver = new BallisticsSolver(atmo, cfg);
  }

  /** Effective muzzle velocity for a fire order (charge zone or default). */
  static muzzleVelocity(w: Weapon, order: FireOrder): number {
    if (order.chargeIndex >= 0 && order.chargeIndex < w.charges.length) {
      return w.charges[order.chargeIndex].muzzleVelocity;
    }
    return w.round.muzzleVelocity;
  }

  /**
   * Build an ENU launch velocity from azimuth + elevation + speed.
   * azimuth: 0 = +North(+y), 90 = +East(+x). elevation above horizon.
   */
  static launchVelocity(azimuthDeg: number, elevationDeg: number, speed: number): Vec3 {
    const az = (azimuthDeg * Math.PI) / 180.0;
    const el = (elevationDeg * Math.PI) / 180.0;
    const horiz = speed * Math.cos(el);
    return new Vec3(
      horiz * Math.sin(az),  // East
      horiz * Math.cos(az),  // North
      speed * Math.sin(el),  // Up
    );
  }

  /**
   * Fire a round according to an order; returns the full trajectory.
   * `targetEnu` engages terminal guidance on munitions that have it (P1.5).
   */
  fire(w: Weapon, muzzlePos: Vec3, order: FireOrder, targetEnu?: Vec3): FlightResult {
    const v0 = WeaponSystem.muzzleVelocity(w, order);
    const el = WeaponSystem.clampElevation(w, order.elevationDeg);
    const v = WeaponSystem.launchVelocity(order.azimuthDeg, el, v0);
    return this.solver.integrate(w.round, muzzlePos, v, targetEnu);
  }

  /** Ground range achieved for a given elevation (helper for the solver). */
  rangeForElevation(w: Weapon, muzzlePos: Vec3, azimuthDeg: number, v0: number, elDeg: number): number {
    const v = WeaponSystem.launchVelocity(azimuthDeg, elDeg, v0);
    return this.solver.integrate(w.round, muzzlePos, v).downrange;
  }

  /**
   * Inverse problem: find quadrant elevation to hit a target at ground range R.
   * `preferHighAngle` picks the steep (plunging) solution when both exist.
   */
  solveForRange(
    w: Weapon,
    muzzlePos: Vec3,
    targetRange: number,
    azimuthDeg: number,
    chargeIndex: number,
    preferHighAngle: boolean,
  ): SolveResult {
    const none: SolveResult = {
      found: false, elevationDeg: 0, timeOfFlight: 0, impactSpeed: 0, usedHighAngle: false,
    };
    const probe: FireOrder = { azimuthDeg: 0, elevationDeg: 45, chargeIndex };
    const v0 = WeaponSystem.muzzleVelocity(w, probe);

    // Sweep elevation to find the range curve and locate the maximum.
    const lo = w.minElevationDeg;
    const hi = w.maxElevationDeg;
    const N = 90;
    let bestEl = lo;
    let bestRange = -1.0;
    for (let i = 0; i <= N; i++) {
      const el = lo + ((hi - lo) * i) / N;
      const r = this.rangeForElevation(w, muzzlePos, azimuthDeg, v0, el);
      if (r > bestRange) { bestRange = r; bestEl = el; }
    }
    if (targetRange > bestRange) return none; // out of reach with this charge

    // Two monotonic branches around bestEl. Bisect the requested one.
    // Unlike the C++ core, verify the branch actually brackets the target:
    // e.g. at max charge the steep branch may never come DOWN to a short
    // range, and bisecting without a sign change returns garbage.
    const bisect = (a: number, b: number): number | null => {
      let ra = this.rangeForElevation(w, muzzlePos, azimuthDeg, v0, a) - targetRange;
      const rb = this.rangeForElevation(w, muzzlePos, azimuthDeg, v0, b) - targetRange;
      if (ra < 0 === rb < 0) return null; // no crossing in this branch
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (a + b);
        const rm = this.rangeForElevation(w, muzzlePos, azimuthDeg, v0, mid) - targetRange;
        if (Math.abs(rm) < 0.5) return mid; // within 0.5 m
        if (ra < 0 === rm < 0) { a = mid; ra = rm; }
        else b = mid;
      }
      return 0.5 * (a + b);
    };

    const sol = preferHighAngle ? bisect(hi, bestEl) : bisect(lo, bestEl);
    if (sol === null) return none;

    const ord: FireOrder = { azimuthDeg, elevationDeg: sol, chargeIndex };
    const fr = this.fire(w, muzzlePos, ord);
    return {
      found: true,
      elevationDeg: sol,
      timeOfFlight: fr.timeOfFlight,
      impactSpeed: fr.impactSpeed,
      usedHighAngle: preferHighAngle,
    };
  }

  static clampElevation(w: Weapon, el: number): number {
    if (el < w.minElevationDeg) return w.minElevationDeg;
    if (el > w.maxElevationDeg) return w.maxElevationDeg;
    return el;
  }

  // ---------------------------------------------------------------------------
  //  P1.6 — Monte-Carlo dispersion.
  // ---------------------------------------------------------------------------
  /**
   * Fire `n` rounds with the given order, perturbing muzzle velocity, lay and
   * wind with a seeded deterministic RNG. Same seed => identical result.
   */
  fireDispersed(
    w: Weapon,
    muzzlePos: Vec3,
    order: FireOrder,
    n: number,
    errors: DispersionErrors,
    seed: number,
    collectFlights = false,
  ): DispersionResult {
    const rng = new DeterministicRng(seed);
    const v0Nominal = WeaponSystem.muzzleVelocity(w, order);
    const baseWind = this.atmo.windField;
    const impacts: Vec3[] = [];
    const flights: FlightResult[] = [];

    for (let i = 0; i < n; i++) {
      const v0 = v0Nominal + rng.gaussian(0, errors.muzzleVelocityStd ?? 0);
      const az = order.azimuthDeg + rng.gaussian(0, (errors.azimuthStdMils ?? 0) * MILS_TO_DEG);
      const el = WeaponSystem.clampElevation(
        w,
        order.elevationDeg + rng.gaussian(0, (errors.elevationStdMils ?? 0) * MILS_TO_DEG),
      );
      const gust = new Vec3(
        rng.gaussian(0, errors.windStd ?? 0),
        rng.gaussian(0, errors.windStd ?? 0),
        0,
      );

      const atmo = this.atmo.clone();
      atmo.windField = (pos, t) => baseWind(pos, t).add(gust);
      const solver = new BallisticsSolver(atmo, this.cfg);
      const v = WeaponSystem.launchVelocity(az, el, v0);
      const fr = solver.integrate(w.round, muzzlePos, v);
      impacts.push(fr.impactPoint);
      if (collectFlights) flights.push(fr);
    }

    // Center of the impact cloud, then CEP = median radial miss around it.
    let mean = new Vec3();
    for (const p of impacts) mean = mean.add(p);
    mean = mean.div(Math.max(1, impacts.length));
    const radii = impacts
      .map((p) => new Vec3(p.x - mean.x, p.y - mean.y, 0).length())
      .sort((a, b) => a - b);
    const cep = radii.length ? radii[Math.max(0, Math.ceil(radii.length * 0.5) - 1)] : 0;
    const out: DispersionResult = { impacts, meanImpact: mean, cep };
    if (collectFlights) out.flights = flights;
    return out;
  }

  // ---------------------------------------------------------------------------
  //  P2.2 — MRSI (Multiple Rounds Simultaneous Impact).
  // ---------------------------------------------------------------------------
  /**
   * Find up to `nRounds` (charge, elevation) pairs that land on `targetRange`
   * with distinct times of flight, and the fire delays that make all of them
   * impact at the same instant. Rounds are ordered by firing time: the
   * slowest (highest) round fires first with delay 0.
   *
   * `chargeIndices` restricts which charges to consider (defaults to all,
   * highest velocity first — those give the widest TOF spread).
   */
  solveMRSI(
    w: Weapon,
    muzzlePos: Vec3,
    targetRange: number,
    azimuthDeg: number,
    nRounds: number,
    chargeIndices?: number[],
  ): MrsiRound[] {
    const charges =
      chargeIndices ??
      (w.charges.length > 0 ? [...w.charges.keys()].reverse() : [-1]);

    interface Candidate { chargeIndex: number; el: number; tof: number; high: boolean; }
    const candidates: Candidate[] = [];
    for (const ci of charges) {
      for (const high of [true, false]) {
        const sr = this.solveForRange(w, muzzlePos, targetRange, azimuthDeg, ci, high);
        if (sr.found) {
          candidates.push({ chargeIndex: ci, el: sr.elevationDeg, tof: sr.timeOfFlight, high });
        }
      }
      if (candidates.length >= nRounds * 2) break; // enough options collected
    }

    // Longest TOF first; drop near-duplicates (same physical solution reached
    // from both branches, or charges whose solutions collapse together).
    candidates.sort((a, b) => b.tof - a.tof);
    const picked: Candidate[] = [];
    for (const c of candidates) {
      if (picked.every((p) => Math.abs(p.tof - c.tof) > 0.5)) picked.push(c);
      if (picked.length === nRounds) break;
    }
    if (picked.length === 0) return [];

    const tofMax = picked[0].tof;
    return picked.map((c) => ({
      chargeIndex: c.chargeIndex,
      elevationDeg: c.el,
      timeOfFlight: c.tof,
      fireDelay: tofMax - c.tof,
      usedHighAngle: c.high,
    }));
  }
}
