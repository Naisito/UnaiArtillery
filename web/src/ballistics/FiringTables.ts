// ============================================================================
//  FiringTables.ts — Firing-table generator (P4.3).
//
//  Classic educational artillery output: for one weapon and charge, tabulate
//  range -> quadrant elevation (low and high branch), time of flight, impact
//  velocity and lateral drift (spin + Coriolis + wind, whatever the config
//  enables). Pure core code, reusable from the CLI (tools/firing_table.ts)
//  and from the app.
//
//  Implementation note: the naive approach (WeaponSystem.solveForRange per
//  row) re-sweeps the whole elevation envelope for every row. Here the sweep
//  runs ONCE, the two monotonic branches are extracted, and each row bisects
//  inside its bracketing interval — ~40x fewer integrations.
// ============================================================================
import { Atmosphere } from './Atmosphere';
import { BallisticsSolver, FlightResult, SolverConfig } from './BallisticsSolver';
import { Weapon } from './WeaponCatalog';
import { WeaponSystem } from './WeaponSystem';
import { Vec3 } from './Vec3';

export interface FiringTableRow {
  rangeM: number;
  // Low (direct) branch — null when the range is inside the minimum range of
  // the branch or the weapon cannot depress enough.
  qeLowDeg: number | null;
  tofLowS: number | null;
  vImpactLowMS: number | null;
  driftLowM: number | null;
  // High (plunging) branch.
  qeHighDeg: number | null;
  tofHighS: number | null;
  vImpactHighMS: number | null;
  driftHighM: number | null;
}

export interface FiringTableOptions {
  /** Range step between rows (m). Default 1000. */
  stepM?: number;
  /** First row (m). Default: one step. */
  minRangeM?: number;
  /** Integration step (s). Default 0.005 (the validated test setting). */
  dt?: number;
  /** Latitude for Coriolis. Default 40. */
  latitudeDeg?: number;
  atmosphere?: Atmosphere;
}

export interface FiringTable {
  weaponName: string;
  chargeName: string;
  muzzleVelocity: number;
  maxRangeM: number;
  rows: FiringTableRow[];
}

export function generateFiringTable(
  w: Weapon,
  chargeIndex: number,
  opts: FiringTableOptions = {},
): FiringTable {
  const atmo = opts.atmosphere ?? new Atmosphere();
  const cfg = SolverConfig.with({
    dt: opts.dt ?? 0.005,
    enableCoriolis: true,
    latitudeDeg: opts.latitudeDeg ?? 40.0,
  });
  const solver = new BallisticsSolver(atmo, cfg);
  const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex });

  // Fire due North so "drift" reads directly as the East (+x) miss component.
  const fireAt = (elDeg: number): FlightResult => {
    const v = WeaponSystem.launchVelocity(0.0, elDeg, v0);
    return solver.integrate(w.round, new Vec3(), v);
  };

  // One sweep of the whole elevation envelope.
  const N = 120;
  const lo = w.minElevationDeg;
  const hi = w.maxElevationDeg;
  const els: number[] = [];
  const ranges: number[] = [];
  let bestIdx = 0;
  for (let i = 0; i <= N; i++) {
    const el = lo + ((hi - lo) * i) / N;
    els.push(el);
    ranges.push(fireAt(el).downrange);
    if (ranges[i] > ranges[bestIdx]) bestIdx = i;
  }
  const maxRangeM = ranges[bestIdx];

  // Bisect one branch for a target range; returns the flight or null.
  const solveBranch = (targetRange: number, high: boolean): FlightResult | null => {
    // Bracket inside the sweep so each bisection starts tight.
    const idxs = high
      ? Array.from({ length: N - bestIdx + 1 }, (_, k) => bestIdx + k)
      : Array.from({ length: bestIdx + 1 }, (_, k) => k);
    let a = -1, b = -1;
    for (let k = 0; k + 1 < idxs.length; k++) {
      const r0 = ranges[idxs[k]];
      const r1 = ranges[idxs[k + 1]];
      if ((r0 - targetRange) * (r1 - targetRange) <= 0) {
        a = els[idxs[k]];
        b = els[idxs[k + 1]];
        break;
      }
    }
    if (a < 0) return null;
    let fa = fireAt(a).downrange - targetRange;
    let mid = 0.5 * (a + b);
    for (let it = 0; it < 40; it++) {
      mid = 0.5 * (a + b);
      const fr = fireAt(mid);
      const fm = fr.downrange - targetRange;
      if (Math.abs(fm) < 0.5) return fr;
      if (fa < 0 === fm < 0) { a = mid; fa = fm; }
      else b = mid;
    }
    return fireAt(mid);
  };

  const elevationOf = (fr: FlightResult): number => {
    // Recover QE from the launch velocity sample (first path point).
    const v = fr.path[0].velocity;
    return (Math.atan2(v.z, Math.hypot(v.x, v.y)) * 180.0) / Math.PI;
  };

  const step = opts.stepM ?? 1000.0;
  const first = opts.minRangeM ?? step;
  const rows: FiringTableRow[] = [];
  for (let r = first; r <= maxRangeM; r += step) {
    const low = solveBranch(r, false);
    const high = solveBranch(r, true);
    rows.push({
      rangeM: r,
      qeLowDeg: low ? elevationOf(low) : null,
      tofLowS: low ? low.timeOfFlight : null,
      vImpactLowMS: low ? low.impactSpeed : null,
      driftLowM: low ? low.impactPoint.x : null,
      qeHighDeg: high ? elevationOf(high) : null,
      tofHighS: high ? high.timeOfFlight : null,
      vImpactHighMS: high ? high.impactSpeed : null,
      driftHighM: high ? high.impactPoint.x : null,
    });
  }

  const chargeName =
    chargeIndex >= 0 && chargeIndex < w.charges.length
      ? w.charges[chargeIndex].name
      : 'default';
  return { weaponName: w.name, chargeName, muzzleVelocity: v0, maxRangeM, rows };
}

/** Render a firing table as CSV (semicolon-free, dot decimals). */
export function firingTableCSV(table: FiringTable): string {
  const fmt = (v: number | null, digits: number): string =>
    v === null ? '' : v.toFixed(digits);
  const lines: string[] = [];
  lines.push(`# ${table.weaponName} — ${table.chargeName} (V0=${table.muzzleVelocity} m/s)`);
  lines.push(`# max range: ${table.maxRangeM.toFixed(0)} m`);
  lines.push(
    'range_m,qe_low_deg,tof_low_s,v_impact_low_ms,drift_low_m,' +
      'qe_high_deg,tof_high_s,v_impact_high_ms,drift_high_m',
  );
  for (const r of table.rows) {
    lines.push(
      [
        r.rangeM.toFixed(0),
        fmt(r.qeLowDeg, 2), fmt(r.tofLowS, 2), fmt(r.vImpactLowMS, 1), fmt(r.driftLowM, 1),
        fmt(r.qeHighDeg, 2), fmt(r.tofHighS, 2), fmt(r.vImpactHighMS, 1), fmt(r.driftHighM, 1),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
