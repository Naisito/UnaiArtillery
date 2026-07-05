// ============================================================================
//  validation.test.ts — Numerical regression / validation harness (P-WEB.1).
//
//  Direct translation of tests/validation.cpp with the SAME thresholds:
//    (1) Vacuum trajectory RK4 vs closed-form analytic solution.
//    (2) RK4 convergence order (halving dt ~ x16 error reduction).
//    (3) Published max ranges for the real weapon catalog.
//    (4) Crosswind deflection sign & magnitude.
//    (5) Fire-control inverse solve lands on the requested range.
//
//  Plus TS<->C++ PARITY: every figure is also compared against the value the
//  validated C++ core produces for the identical setup (captured with a
//  reference probe, g++ -O2, 2026-07-05). Tolerance ±0.1% — in practice the
//  match is far tighter because JS numbers are IEEE-754 doubles too.
//
//  These tests run the 'legacy' catalog variant: the exact hand-tuned drag
//  curves and feature set of the C++ core. The BC-based catalog has its own
//  suite in fidelity.test.ts.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { BallisticsSolver, SolverConfig } from './BallisticsSolver';
import { Munition } from './Munition';
import { Vec3 } from './Vec3';
import { Weapon, WeaponCatalog } from './WeaponCatalog';
import { WeaponSystem } from './WeaponSystem';

/** Reference values printed by the C++ core (scratch ref_probe.cpp). */
const CPP = {
  vacuum: { downrange: 9038.01989, tof: 39.32765682, apex: 1895.949789 },
  maxRange: { mortar: 6367.331287, m777: 20803.08557, gmlrs: 68380.98713 },
  wind: { northOffset: 459.2053084, downrange: 20741.79716 },
  fireControl: { loEl: 19.09223531, hiEl: 69.08321452, loTof: 37.31411372, impact: 14999.56584 },
  atmo: {
    rho0: 1.225000018, a0: 340.293988,
    rho5k: 0.7361155474, a5k: 320.5293944,
    rho15k: 0.193673452, a15k: 295.0694935,
  },
};

const PARITY = 1e-3; // ±0.1%

function expectParity(actual: number, reference: number): void {
  expect(Math.abs(actual - reference) / Math.abs(reference)).toBeLessThan(PARITY);
}

// ---------------------------------------------------------------------------
describe('(0) atmosphere parity with the C++ core', () => {
  it('ISA samples match at 0 / 5 / 15 km', () => {
    const atmo = new Atmosphere();
    const s0 = atmo.sample(0);
    const s5 = atmo.sample(5000);
    const s15 = atmo.sample(15000);
    expectParity(s0.density, CPP.atmo.rho0);
    expectParity(s0.soundSpeed, CPP.atmo.a0);
    expectParity(s5.density, CPP.atmo.rho5k);
    expectParity(s5.soundSpeed, CPP.atmo.a5k);
    expectParity(s15.density, CPP.atmo.rho15k);
    expectParity(s15.soundSpeed, CPP.atmo.a15k);
  });
});

// ---------------------------------------------------------------------------
describe('(1) vacuum trajectory: RK4 vs analytic', () => {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({ dt: 0.001, enableCoriolis: false });
  const solver = new BallisticsSolver(atmo, cfg);

  const m = new Munition();
  m.dragCurve = [{ mach: 0.0, cd: 0.0 }]; // Cd = 0 everywhere -> no drag term

  const v0 = 300.0;
  const elev = 40.0;
  const g = 9.80665;
  const v = WeaponSystem.launchVelocity(90.0 /*due East*/, elev, v0);
  const fr = solver.integrate(m, new Vec3(), v);

  // Closed form (flat ground, launch z=0):
  const el = (elev * Math.PI) / 180.0;
  const tof = (2.0 * v0 * Math.sin(el)) / g;
  const range = (v0 * v0 * Math.sin(2 * el)) / g;
  const apex = (v0 * Math.sin(el)) ** 2 / (2 * g);

  it('range within 0.05%', () => {
    expect(Math.abs(fr.downrange - range) / range).toBeLessThan(5e-4);
  });
  it('time within 0.05%', () => {
    expect(Math.abs(fr.timeOfFlight - tof) / tof).toBeLessThan(5e-4);
  });
  it('apex within 0.20%', () => {
    expect(Math.abs(fr.apex - apex) / apex).toBeLessThan(2e-3);
  });
  it('matches the C++ core (±0.1%)', () => {
    expectParity(fr.downrange, CPP.vacuum.downrange);
    expectParity(fr.timeOfFlight, CPP.vacuum.tof);
    expectParity(fr.apex, CPP.vacuum.apex);
  });
});

// ---------------------------------------------------------------------------
// Measure RK4 global error at a FIXED time on a NONLINEAR problem (full
// aerodynamic drag) against a fine-step reference. In vacuum the ODE is
// linear and RK4 is exact — useless for gauging order.
function dragStatePosition(dt: number): Vec3 {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({
    dt,
    enableCoriolis: false,
    maxFlight: 15.0,   // stop mid-flight, before impact
    groundZ: -1e9,     // no ground impact during the window
  });
  const solver = new BallisticsSolver(atmo, cfg);
  const m = WeaponCatalog.m777('legacy').round; // real Mach-dependent drag
  const v = WeaponSystem.launchVelocity(90.0, 45.0, m.muzzleVelocity);
  return solver.integrate(m, new Vec3(), v).impactPoint; // final state @ cap
}

describe('(2) RK4 convergence order on a nonlinear (drag) problem', () => {
  it('halving dt cuts error ~16x (>10x)', () => {
    const ref = dragStatePosition(0.0001); // reference "truth"
    const p1 = dragStatePosition(0.02);
    const p2 = dragStatePosition(0.01);
    const e1 = p1.sub(ref).length();
    const e2 = p2.sub(ref).length();
    const ratio = e1 / (e2 + 1e-18);
    expect(ratio).toBeGreaterThan(10.0);
  });
});

// ---------------------------------------------------------------------------
function maxRange(w: Weapon, chargeIndex: number): number {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: true, latitudeDeg: 40.0 });
  const fc = new WeaponSystem(atmo, cfg);
  const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex });
  let best = 0.0;
  for (let el = w.minElevationDeg; el <= w.maxElevationDeg; el += 1.0) {
    best = Math.max(best, fc.rangeForElevation(w, new Vec3(), 90.0, v0, el));
  }
  return best;
}

describe('(3) published max ranges (legacy drag curves)', () => {
  const mortar = WeaponCatalog.mortar120('legacy');
  const m777 = WeaponCatalog.m777('legacy');
  const himars = WeaponCatalog.himarsGMLRS('legacy');

  const rM = maxRange(mortar, mortar.charges.length - 1);
  const rH = maxRange(m777, m777.charges.length - 1);
  const rR = maxRange(himars, -1);

  it('mortar 120mm in 5.5-9 km', () => {
    expect(rM).toBeGreaterThan(5500);
    expect(rM).toBeLessThan(9000);
  });
  it('M777 in 20-28 km', () => {
    expect(rH).toBeGreaterThan(20000);
    expect(rH).toBeLessThan(28000);
  });
  it('GMLRS in 45-90 km', () => {
    expect(rR).toBeGreaterThan(45000);
    expect(rR).toBeLessThan(90000);
  });
  it('matches the C++ core (±0.1%)', () => {
    expectParity(rM, CPP.maxRange.mortar);
    expectParity(rH, CPP.maxRange.m777);
    expectParity(rR, CPP.maxRange.gmlrs);
  });
});

// ---------------------------------------------------------------------------
describe('(4) crosswind deflection', () => {
  const atmo = new Atmosphere();
  // Wind FROM the South (bearing 180) pushes an East-bound shell to +North.
  atmo.windField = () => Atmosphere.steadyWind(15.0, 180.0);
  const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: false });
  const solver = new BallisticsSolver(atmo, cfg);
  const m777 = WeaponCatalog.m777('legacy');
  const v = WeaponSystem.launchVelocity(90.0, 45.0, m777.round.muzzleVelocity);
  const fr = solver.integrate(m777.round, new Vec3(), v);

  it('south wind pushes shell north (+y)', () => {
    expect(fr.impactPoint.y).toBeGreaterThan(5.0);
  });
  it('matches the C++ core (±0.1%)', () => {
    expectParity(fr.impactPoint.y, CPP.wind.northOffset);
    expectParity(fr.downrange, CPP.wind.downrange);
  });
});

// ---------------------------------------------------------------------------
describe('(5) fire-control inverse solve', () => {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({ dt: 0.005 });
  const fc = new WeaponSystem(atmo, cfg);
  const m777 = WeaponCatalog.m777('legacy');
  const charge = m777.charges.length - 1;
  const target = 15000.0;

  const lo = fc.solveForRange(m777, new Vec3(), target, 90.0, charge, false);
  const hi = fc.solveForRange(m777, new Vec3(), target, 90.0, charge, true);
  const fr = fc.fire(m777, new Vec3(), {
    azimuthDeg: 90.0, elevationDeg: lo.elevationDeg, chargeIndex: charge,
  });

  it('low-angle solution found', () => { expect(lo.found).toBe(true); });
  it('high-angle solution found', () => { expect(hi.found).toBe(true); });
  it('high angle steeper than low', () => {
    expect(hi.elevationDeg).toBeGreaterThan(lo.elevationDeg);
  });
  it('impact within 2 m of target', () => {
    expect(Math.abs(fr.downrange - target)).toBeLessThan(2.0);
  });
  it('matches the C++ core (±0.1%)', () => {
    expectParity(lo.elevationDeg, CPP.fireControl.loEl);
    expectParity(hi.elevationDeg, CPP.fireControl.hiEl);
    expectParity(lo.timeOfFlight, CPP.fireControl.loTof);
    expectParity(fr.downrange, CPP.fireControl.impact);
  });
});
