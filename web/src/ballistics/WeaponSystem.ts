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

// ---- P-VIVO.3 ---------------------------------------------------------------
/**
 * Espoleta del orden de tiro. Solo cambia la CONDICIÓN DE CORTE del solver:
 *   'impact'    — detonación al tocar el suelo (default; paridad C++ intacta).
 *   'time'      — la integración termina en t = timeS (airburst, esté donde esté).
 *   'proximity' — termina al bajar de heightM sobre el suelo en fase descendente.
 *   'delay'     — mismo punto de impacto; el resultado se marca 'buried'.
 */
export type FuzeMode = 'impact' | 'time' | 'proximity' | 'delay';

export interface FuzeSpec {
  mode: FuzeMode;
  /** 'time': instante de detonación (s desde el disparo). */
  timeS?: number;
  /** 'proximity': altura de disparo sobre el suelo (m). Default 7. */
  heightM?: number;
}

export interface FireOrder {
  azimuthDeg: number;   // compass bearing to aim (0 = North, 90 = East)
  elevationDeg: number; // quadrant elevation
  chargeIndex: number;  // index into Weapon.charges (-1 => round default)
  /** P-VIVO.3 — espoleta; ausente o 'impact' = comportamiento clásico. */
  fuze?: FuzeSpec;
  /** P-VIVO.9 — corrección de V0 (temperatura de carga, desgaste, sesgo). */
  v0Correction?: V0Correction;
}

export function defaultFireOrder(): FireOrder {
  return { azimuthDeg: 0.0, elevationDeg: 45.0, chargeIndex: -1 };
}

// ---- P-VIVO.9 ---------------------------------------------------------------
/**
 * La V0 real no es el número del catálogo: varía con la temperatura del
 * propelente (~0.06%/°C en cargas de 155 mm) y el desgaste del tubo, y la
 * dirección de tiro la corrige con radar de boca (biasFraction). Con el
 * default neutro el factor es exactamente 1.0 y la paridad queda intacta.
 *
 *   V0_efectiva = V0 · (1 + 0.0006·(chargeTempC − 21)) · (1 − wearFraction) · (1 + biasFraction)
 */
export interface V0Correction {
  /** Temperatura del propelente (°C). 21 °C = condición estándar de tablas. */
  chargeTempC: number;
  /** Fracción de V0 perdida por desgaste del tubo (0 = tubo nuevo). */
  wearFraction: number;
  /** Sesgo multiplicativo (radar de boca / lote); 0 = sin sesgo. */
  biasFraction?: number;
}

/** Sensibilidad térmica del propelente: ~0.06 %/°C (tablas 155 mm, orden de magnitud). */
export const V0_TEMP_COEFF_PER_C = 0.0006;

export function v0Factor(c?: V0Correction): number {
  if (!c) return 1.0;
  return (
    (1.0 + V0_TEMP_COEFF_PER_C * (c.chargeTempC - 21.0)) *
    (1.0 - c.wearFraction) *
    (1.0 + (c.biasFraction ?? 0.0))
  );
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
  /** Std deviation of muzzle velocity (m/s). Round-to-round. */
  muzzleVelocityStd?: number;
  /**
   * P-VIVO.9 — sesgo SISTEMÁTICO de V0 (m/s) compartido por toda la salva
   * (lote que sale caliente/frío, desgaste no declarado). Es lo que un radar
   * de boca mide y una corrección de dirección de tiro cancela.
   */
  muzzleVelocityBias?: number;
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

// ---- P-PRO.6 ------------------------------------------------------------------
/** Elipse de error 1σ predicha (a priori), en ejes alcance/deriva. */
export interface DispersionPrediction {
  sigmaRangeM: number;  // σ a lo largo del rumbo
  sigmaCrossM: number;  // σ transversal
  rangeM: number;       // alcance del tiro nominal (centro de la elipse)
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

  /** Effective muzzle velocity for a fire order (charge zone or default).
   *  P-VIVO.9: aplica la corrección de V0 del orden (factor 1.0 exacto con el
   *  default neutro: `v * 1.0` es bit a bit `v` en IEEE-754). */
  static muzzleVelocity(w: Weapon, order: FireOrder): number {
    const base =
      order.chargeIndex >= 0 && order.chargeIndex < w.charges.length
        ? w.charges[order.chargeIndex].muzzleVelocity
        : w.round.muzzleVelocity;
    const f = v0Factor(order.v0Correction);
    return f === 1.0 ? base : base * f;
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
    return this.solver.integrate(w.round, muzzlePos, v, targetEnu, order.fuze);
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
    v0Correction?: V0Correction,
  ): SolveResult {
    const none: SolveResult = {
      found: false, elevationDeg: 0, timeOfFlight: 0, impactSpeed: 0, usedHighAngle: false,
    };
    const probe: FireOrder = { azimuthDeg: 0, elevationDeg: 45, chargeIndex, v0Correction };
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

    const ord: FireOrder = { azimuthDeg, elevationDeg: sol, chargeIndex, v0Correction };
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
      const v0 =
        v0Nominal +
        (errors.muzzleVelocityBias ?? 0) + // P-VIVO.9 — sesgo de lote sistemático
        rng.gaussian(0, errors.muzzleVelocityStd ?? 0);
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
      const fr = solver.integrate(w.round, muzzlePos, v, undefined, order.fuze);
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
  //  P-PRO.6 — Elipse de error PREDICHA (linealización por diferencias finitas).
  // ---------------------------------------------------------------------------
  /**
   * Predice las σ 1-sigma de alcance y deriva SIN Monte-Carlo: mide las
   * sensibilidades reales re-integrando — ∂R/∂V0 y ∂R/∂QE con diferencias
   * centradas, y las de viento con dos integraciones con viento unitario
   * longitudinal/transversal (nada de constantes mágicas) — y las compone:
   *
   *   σ_alcance = √((∂R/∂V0·σ_V0)² + (∂R/∂QE·σ_QE)² + (S_wl·σ_w)²)
   *   σ_deriva  = √((R·σ_az)² + (S_wt·σ_w)²)
   *
   * Total: 7 integraciones (1 nominal + 4 de ∂R + 2 de viento). Con las
   * mismas σ que fireDispersed, la elipse predicha y la nube muestral deben
   * solaparse (test de fidelidad: ±30% con n = 200).
   */
  predictDispersion(
    w: Weapon,
    muzzlePos: Vec3,
    order: FireOrder,
    errors: DispersionErrors,
  ): DispersionPrediction {
    const v0 = WeaponSystem.muzzleVelocity(w, order);
    const el = WeaponSystem.clampElevation(w, order.elevationDeg);
    const az = (order.azimuthDeg * Math.PI) / 180.0;
    const alongDir = new Vec3(Math.sin(az), Math.cos(az), 0);
    const crossDir = new Vec3(Math.cos(az), -Math.sin(az), 0); // derecha del rumbo

    const fly = (v0x: number, elx: number, extraWind?: Vec3): FlightResult => {
      let solver = this.solver;
      if (extraWind) {
        const atmo = this.atmo.clone();
        const base = this.atmo.windField;
        atmo.windField = (pos, t) => base(pos, t).add(extraWind);
        solver = new BallisticsSolver(atmo, this.cfg);
      }
      const v = WeaponSystem.launchVelocity(order.azimuthDeg, elx, v0x);
      return solver.integrate(w.round, muzzlePos, v);
    };
    const alongOf = (fr: FlightResult) =>
      fr.impactPoint.x * alongDir.x + fr.impactPoint.y * alongDir.y;
    const crossOf = (fr: FlightResult) =>
      fr.impactPoint.x * crossDir.x + fr.impactPoint.y * crossDir.y;

    const nominal = fly(v0, el);
    const R = nominal.downrange;

    // ∂R/∂V0 y ∂R/∂QE por diferencias CENTRADAS (el tiro no es lineal cerca
    // del alcance máximo: el esquema centrado cancela el término cuadrático).
    const dV = Math.max(0.5, v0 * 0.005);
    const dRdV = (alongOf(fly(v0 + dV, el)) - alongOf(fly(v0 - dV, el))) / (2 * dV);
    const dEl = 0.25; // grados
    const dRdEl = (alongOf(fly(v0, el + dEl)) - alongOf(fly(v0, el - dEl))) / (2 * dEl);

    // Sensibilidades de viento con 2 m/s de señal (lineal en este rango).
    const wMag = 2.0;
    const sWl = (alongOf(fly(v0, el, alongDir.mul(wMag))) - alongOf(nominal)) / wMag;
    const sWt = (crossOf(fly(v0, el, crossDir.mul(wMag))) - crossOf(nominal)) / wMag;

    const sV0 = errors.muzzleVelocityStd ?? 0;
    const sQEdeg = (errors.elevationStdMils ?? 0) * MILS_TO_DEG;
    const sAzRad = ((errors.azimuthStdMils ?? 0) * MILS_TO_DEG * Math.PI) / 180.0;
    const sW = errors.windStd ?? 0;

    return {
      sigmaRangeM: Math.hypot(dRdV * sV0, dRdEl * sQEdeg, sWl * sW),
      sigmaCrossM: Math.hypot(R * sAzRad, sWt * sW),
      rangeM: R,
    };
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
    v0Correction?: V0Correction,
  ): MrsiRound[] {
    const charges =
      chargeIndices ??
      (w.charges.length > 0 ? [...w.charges.keys()].reverse() : [-1]);

    interface Candidate { chargeIndex: number; el: number; tof: number; high: boolean; }
    const candidates: Candidate[] = [];
    for (const ci of charges) {
      for (const high of [true, false]) {
        const sr = this.solveForRange(w, muzzlePos, targetRange, azimuthDeg, ci, high, v0Correction);
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
