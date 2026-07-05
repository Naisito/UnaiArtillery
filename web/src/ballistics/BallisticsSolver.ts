// ============================================================================
//  BallisticsSolver.ts — RK4 trajectory integrator (the simulator's heart).
//
//  Port of core/BallisticsSolver.h. Integrates the equation of motion:
//
//      m dv/dt = m*g - (1/2) * rho * Cd * A * |v - w| * (v - w)
//
//  plus, matching the C++ core:
//    * Coriolis acceleration  a_cor = -2 (Omega x v)
//    * Rocket thrust phase    +F_thrust * v_hat  with linear mass loss
//
//  and the P1 fidelity extensions (all OFF by default — with them off the
//  integration is arithmetically identical to the validated C++ core):
//    * P1.2 spin: gyroscopic (yaw-of-repose) drift + Magnus force.
//    * P1.4 spherical Earth: ECEF integration with radial gravity for
//      long-range shots (> ~50 km); I/O stays in ENU meters.
//    * P1.5 terminal guidance: proportional navigation toward a target.
//    * P4.2 enableDrag switch for the didactic comparison mode.
//
//  Integration is classical fixed-step RK4 on s = [position, velocity, mass].
// ============================================================================
import { Atmosphere } from './Atmosphere';
import { Munition } from './Munition';
import { Vec3 } from './Vec3';
import { EnuFrame, WGS84 } from './Geodesy';

/** One integrated sample of the flight, handed to VFX / camera / logging. */
export interface TrajectorySample {
  t: number;        // s since launch
  position: Vec3;   // ENU meters (always ENU, also in spherical mode)
  velocity: Vec3;   // m/s, ENU
  mach: number;     // |v_rel| / a(h)
  mass: number;     // kg (changes during rocket burn)
  drag: number;     // instantaneous drag force magnitude (N)
}

export interface FlightResult {
  path: TrajectorySample[];
  impactPoint: Vec3;
  impactSpeed: number;
  timeOfFlight: number;
  apex: number;       // max altitude reached (m above the ENU ground plane)
  maxMach: number;
  downrange: number;  // launch->impact ground distance (m); great-circle arc
                      // in spherical mode
  impacted: boolean;
  warheadTNTeq: number;    // yield rides along so VFX never guesses (P0.1)
  rhsEvaluations: number;  // # of derivative evaluations (benchmark/diagnostics)
}

export class SolverConfig {
  dt = 0.002;          // s, fixed integration step (RK4)
  maxFlight = 400.0;   // s, safety cap
  groundZ = 0.0;       // impact plane altitude (ENU z) unless terrainHeight set
  enableCoriolis = true;
  latitudeDeg = 40.0;  // battery latitude (Coriolis; ECEF anchor in spherical)
  gravity = new Vec3(0.0, 0.0, -9.80665);
  sampleEvery = 1;     // store 1 of every N steps (path decimation)

  /** Optional terrain height query: (east, north) -> ground z (m). */
  terrainHeight?: (east: number, north: number) => number;

  /** P4.2 — didactic switch: false integrates a vacuum trajectory. */
  enableDrag = true;

  /** P1.4 — integrate in ECEF over a rotating spherical-gravity Earth. */
  sphericalEarth = false;
  /** ECEF anchor longitude (anchor latitude is latitudeDeg). */
  anchorLonDeg = 0.0;

  clone(): SolverConfig {
    const c = new SolverConfig();
    Object.assign(c, this);
    c.gravity = this.gravity.clone();
    return c;
  }

  static with(partial: Partial<SolverConfig>): SolverConfig {
    const c = new SolverConfig();
    Object.assign(c, partial);
    return c;
  }
}

interface State { pos: Vec3; vel: Vec3; mass: number; }

/**
 * Everything frame-dependent, so one integration loop serves both the flat
 * ENU tangent plane and the rotating ECEF sphere.
 */
interface FrameOps {
  /** Geometric altitude (m MSL) of a position in the integration frame. */
  altitude(pos: Vec3): number;
  /** Local up unit vector. */
  up(pos: Vec3): Vec3;
  /** Gravitational acceleration (rotation terms excluded). */
  gravityAccel(pos: Vec3): Vec3;
  /** Frame rotation terms (Coriolis, and centrifugal in ECEF). */
  rotationAccel(pos: Vec3, vel: Vec3): Vec3;
  /** Wind vector in the integration frame. */
  wind(pos: Vec3, t: number): Vec3;
  /** Position in ENU meters (for terrain queries and output). */
  toEnuPosition(pos: Vec3): Vec3;
  /** Free vector to ENU (for output). */
  toEnuVector(v: Vec3): Vec3;
  /** Descending test for the impact gate. */
  descending(pos: Vec3, vel: Vec3): boolean;
}

export class BallisticsSolver {
  private readonly omegaEnu: Vec3;

  constructor(
    private readonly atmo: Atmosphere,
    private readonly cfg: SolverConfig,
  ) {
    // Earth angular velocity in the local ENU frame at latitude phi:
    //   Omega = |O| * (0, cos phi, sin phi)   (East, North, Up)
    const O = 7.2921159e-5;
    const phi = (cfg.latitudeDeg * Math.PI) / 180.0;
    this.omegaEnu = new Vec3(0.0, O * Math.cos(phi), O * Math.sin(phi));
  }

  /**
   * Integrate a full trajectory from launch to impact (or time cap).
   * Positions/velocities in and out are ENU meters regardless of mode.
   * `targetEnu` feeds the P1.5 proportional-navigation guidance of rounds
   * whose munition has `guidance.enabled`.
   */
  integrate(round: Munition, launchPos: Vec3, launchVel: Vec3, targetEnu?: Vec3): FlightResult {
    const cfg = this.cfg;
    const ops = cfg.sphericalEarth ? this.makeSphericalOps() : this.makeFlatOps();

    // Launch state in the integration frame.
    let s: State = cfg.sphericalEarth
      ? {
          pos: this.frame!.enuToEcefPosition(launchPos),
          vel: this.frame!.enuToEcefVector(launchVel),
          mass: round.mass,
        }
      : { pos: launchPos.clone(), vel: launchVel.clone(), mass: round.mass };

    const target = targetEnu
      ? cfg.sphericalEarth
        ? this.frame!.enuToEcefPosition(targetEnu)
        : targetEnu.clone()
      : undefined;

    // P1.2 — launch spin rate: one turn per twistCalibers calibers.
    const v0 = launchVel.length();
    const spin0 =
      round.spinStabilized && round.twistCalibers > 0
        ? (2.0 * Math.PI * v0) / (round.twistCalibers * round.diameter)
        : 0.0;

    // P1.5 — guidance engages after burnout (+ optional delay).
    const guidanceStart =
      (round.motor.enabled ? round.motor.burnTime : 0.0) + round.guidance.activationDelay;

    const ctx: IntegrationContext = { round, ops, spin0, guidanceStart, target, rhsEvals: 0 };

    const out: FlightResult = {
      path: [],
      impactPoint: new Vec3(),
      impactSpeed: 0.0,
      timeOfFlight: 0.0,
      apex: 0.0,
      maxMach: 0.0,
      downrange: 0.0,
      impacted: false,
      warheadTNTeq: round.warheadMassTNTeq,
      rhsEvaluations: 0,
    };

    let t = 0.0;
    const launchFramePos = s.pos.clone();

    this.pushSample(out, ctx, s, t);

    const maxSteps = Math.floor(cfg.maxFlight / cfg.dt);
    for (let step = 0; step < maxSteps; step++) {
      const prev: State = { pos: s.pos, vel: s.vel, mass: s.mass };
      const prevAlt = ops.altitude(prev.pos);
      const prevGround = this.groundAt(ops, prev.pos);

      s = this.rk4Step(ctx, s, t, cfg.dt);
      t += cfg.dt;

      // Track apex from the live state.
      const alt = ops.altitude(s.pos);
      out.apex = Math.max(out.apex, alt);

      // Ground / terrain intersection between prev and current. Only a
      // *descending* crossing counts as an impact, so an ascending shot that
      // starts exactly on the ground plane never false-triggers.
      const curGround = this.groundAt(ops, s.pos);
      const wasAbove = prevAlt - prevGround >= 0.0;
      const nowBelow = alt - curGround < 0.0;
      if (wasAbove && nowBelow && ops.descending(s.pos, s.vel)) {
        // Linear interpolation to the crossing for a clean impact point.
        const f0 = prevAlt - prevGround;
        const f1 = alt - curGround;
        const frac = f0 / (f0 - f1);
        const hit: State = {
          pos: prev.pos.add(s.pos.sub(prev.pos).mul(frac)),
          vel: prev.vel.add(s.vel.sub(prev.vel).mul(frac)),
          mass: s.mass,
        };
        const tHit = t - cfg.dt + frac * cfg.dt;
        this.pushSample(out, ctx, hit, tHit);
        out.impacted = true;
        out.impactPoint = ops.toEnuPosition(hit.pos);
        out.impactSpeed = hit.vel.length();
        out.timeOfFlight = tHit;
        s = hit;
        break;
      }

      if (step % cfg.sampleEvery === 0) this.pushSample(out, ctx, s, t);
    }

    if (!out.impacted) {
      // hit time cap
      out.impactPoint = ops.toEnuPosition(s.pos);
      out.impactSpeed = s.vel.length();
      out.timeOfFlight = t;
    }

    if (cfg.sphericalEarth) {
      // Great-circle ground distance over the sphere (the chord underestimates
      // range at 300 km by ~0.5%; the arc is what a map would measure).
      const r0 = launchFramePos.normalized();
      const r1 = s.pos.normalized();
      const cosAng = Math.min(1.0, Math.max(-1.0, r0.dot(r1)));
      out.downrange = this.earthRadius * Math.acos(cosAng);
    } else {
      const horiz = new Vec3(
        out.impactPoint.x - launchPos.x,
        out.impactPoint.y - launchPos.y,
        0.0,
      );
      out.downrange = horiz.length();
    }
    for (const p of out.path) out.maxMach = Math.max(out.maxMach, p.mach);
    out.rhsEvaluations = ctx.rhsEvals;
    return out;
  }

  // -------------------------------------------------------------------------
  private frame?: EnuFrame;
  private earthRadius = 0.0;

  private makeFlatOps(): FrameOps {
    const cfg = this.cfg;
    const atmo = this.atmo;
    const up = new Vec3(0, 0, 1);
    const zero = new Vec3(0, 0, 0);
    const omega = this.omegaEnu;
    return {
      altitude: (pos) => pos.z,
      up: () => up,
      gravityAccel: () => cfg.gravity,
      rotationAccel: (_pos, vel) =>
        cfg.enableCoriolis ? omega.cross(vel).mul(-2.0) : zero,
      wind: (pos, t) => atmo.windAt(pos, t),
      toEnuPosition: (pos) => pos.clone(),
      toEnuVector: (v) => v.clone(),
      descending: (_pos, vel) => vel.z <= 0.0,
    };
  }

  private makeSphericalOps(): FrameOps {
    const cfg = this.cfg;
    const atmo = this.atmo;
    // Anchor the ENU frame on the WGS84 ellipsoid at the battery latitude.
    const frame = new EnuFrame(cfg.latitudeDeg, cfg.anchorLonDeg, 0.0);
    this.frame = frame;
    const R0 = frame.originEcef.length();
    this.earthRadius = R0;
    const omegaEcef = new Vec3(0.0, 0.0, WGS84.omega);
    const zero = new Vec3(0, 0, 0);
    return {
      altitude: (pos) => pos.length() - R0,
      up: (pos) => pos.normalized(),
      gravityAccel: (pos) => {
        const r = pos.length();
        return pos.mul(-WGS84.GM / (r * r * r));
      },
      rotationAccel: (pos, vel) => {
        if (!cfg.enableCoriolis) return zero;
        const cor = omegaEcef.cross(vel).mul(-2.0);
        const cent = omegaEcef.cross(omegaEcef.cross(pos)).neg();
        return cor.add(cent);
      },
      wind: (pos, t) => {
        const enu = frame.ecefToEnuPosition(pos);
        return frame.enuToEcefVector(atmo.windAt(enu, t));
      },
      toEnuPosition: (pos) => frame.ecefToEnuPosition(pos),
      toEnuVector: (v) => frame.ecefToEnuVector(v),
      descending: (pos, vel) => vel.dot(pos) <= 0.0,
    };
  }

  private groundAt(ops: FrameOps, pos: Vec3): number {
    if (this.cfg.terrainHeight) {
      const enu = ops.toEnuPosition(pos);
      return this.cfg.terrainHeight(enu.x, enu.y);
    }
    return this.cfg.groundZ;
  }

  // Time-derivative of the state: the physics live here.
  private derivative(ctx: IntegrationContext, s: State, t: number): State {
    ctx.rhsEvals++;
    const { round, ops } = ctx;
    const cfg = this.cfg;

    const alt = ops.altitude(s.pos);
    const air = this.atmo.sample(alt);
    const wind = ops.wind(s.pos, t);
    const vRel = s.vel.sub(wind); // airspeed vector
    const vRelMag = vRel.length();
    const A = round.referenceArea();

    // --- Aerodynamic drag: -1/2 rho Cd A |vRel| vRel ----------------------
    let aDrag = new Vec3(0, 0, 0);
    if (cfg.enableDrag && vRelMag > 1e-6 && air.density > 0.0) {
      const mach = vRelMag / air.soundSpeed;
      const Cd = round.dragCoefficient(mach);
      const fMag = 0.5 * air.density * Cd * A * vRelMag; // scalar
      aDrag = vRel.mul(-fMag * vRelMag).div(vRelMag * s.mass);
      // = -(1/2 rho Cd A |vRel|) * vRel / m   (force / mass)
    }

    // --- Gravity -----------------------------------------------------------
    const aGrav = ops.gravityAccel(s.pos);

    // --- Frame rotation: Coriolis (+ centrifugal in ECEF) ------------------
    const aRot = ops.rotationAccel(s.pos, s.vel);

    // --- Rocket thrust (optional, along velocity) ---------------------------
    let aThrust = new Vec3(0, 0, 0);
    let dmdt = 0.0;
    if (round.motor.enabled && t < round.motor.burnTime && s.mass > 0.0) {
      const dir = vRelMag > 1e-6 ? s.vel.normalized() : ops.up(s.pos);
      aThrust = dir.mul(round.motor.thrust / s.mass);
      dmdt = -round.motor.propellantMass / round.motor.burnTime;
    }

    // --- P1.2: spin-induced forces (gyroscopic drift + Magnus) -------------
    // Approximations (documented in docs/FISICA_WEB.md):
    //  * Spin p(t) decays exponentially (tau ~ 80 s); launch value from the
    //    rifling twist: p0 = 2*pi*v0 / (twist_calibers * d).
    //  * Yaw of repose: a spin-stabilized shell on a curved arc trims at a
    //    small equilibrium yaw; the resulting side lift is modeled as
    //    a_sd = k_sd * g * (p*d / |vRel|) toward the twist side. k_sd lumps
    //    the 6-DOF inertia/moment coefficients into one calibration constant.
    //  * Magnus: a_m = C_mag * rho*A*d/(2m) * (omega_spin x vRel); only
    //    significant with crosswind, kept for sign-correct response.
    let aSpin = new Vec3(0, 0, 0);
    if (round.spinStabilized && ctx.spin0 > 0.0 && vRelMag > 1e-6) {
      const sign = round.rightHandTwist ? 1.0 : -1.0;
      const p = ctx.spin0 * Math.exp(-t / round.spinDecayTau);
      const vhat = s.vel.normalized();
      const side = vhat.cross(ops.up(s.pos)); // right of the velocity vector
      const sideLen = side.length();
      if (sideLen > 1e-9) {
        const aSd = side
          .div(sideLen)
          .mul(sign * round.spinDriftCoeff * aGrav.length() * ((p * round.diameter) / vRelMag));
        const omegaSpin = vhat.mul(sign * p);
        const aMag = omegaSpin
          .cross(vRel)
          .mul((round.magnusCoeff * air.density * A * round.diameter) / (2.0 * s.mass));
        aSpin = aSd.add(aMag);
      }
    }

    // --- P1.5: proportional navigation toward the target -------------------
    // a_cmd = N * (Omega_los x v), Omega_los = (r x v_rel)/(r.r) with a static
    // target (v_rel = -v). Lateral-only, clamped to maxLateralG.
    let aGuide = new Vec3(0, 0, 0);
    if (
      round.guidance.enabled &&
      ctx.target &&
      t >= ctx.guidanceStart &&
      (!round.guidance.terminalOnly || ops.descending(s.pos, s.vel))
    ) {
      const r = ctx.target.sub(s.pos);
      const dist = r.length();
      if (dist > 30.0) {
        const omegaLos = r.cross(s.vel.neg()).div(r.dot(r));
        let a = omegaLos.cross(s.vel).mul(round.guidance.navConstant);
        const vhat = s.vel.normalized();
        a = a.sub(vhat.mul(a.dot(vhat))); // pure lateral steering
        const maxA = round.guidance.maxLateralG * 9.80665;
        const aMagn = a.length();
        if (aMagn > maxA) a = a.mul(maxA / aMagn);
        aGuide = a;
      }
    }

    return {
      pos: s.vel, // dx/dt = v
      vel: aGrav.add(aDrag).add(aRot).add(aThrust).add(aSpin).add(aGuide),
      mass: dmdt,
    };
  }

  // Classical RK4 over the compound state.
  private rk4Step(ctx: IntegrationContext, s: State, t: number, dt: number): State {
    const k1 = this.derivative(ctx, s, t);
    const k2 = this.derivative(ctx, addState(s, k1, dt * 0.5), t + dt * 0.5);
    const k3 = this.derivative(ctx, addState(s, k2, dt * 0.5), t + dt * 0.5);
    const k4 = this.derivative(ctx, addState(s, k3, dt), t + dt);

    const out: State = {
      pos: s.pos.add(k1.pos.add(k2.pos.mul(2)).add(k3.pos.mul(2)).add(k4.pos).mul(dt / 6.0)),
      vel: s.vel.add(k1.vel.add(k2.vel.mul(2)).add(k3.vel.mul(2)).add(k4.vel).mul(dt / 6.0)),
      mass: s.mass + (k1.mass + 2 * k2.mass + 2 * k3.mass + k4.mass) * (dt / 6.0),
    };
    if (out.mass < 1e-6) out.mass = s.mass; // guard
    return out;
  }

  private pushSample(out: FlightResult, ctx: IntegrationContext, s: State, t: number): void {
    const ops = ctx.ops;
    const air = this.atmo.sample(ops.altitude(s.pos));
    const wind = ops.wind(s.pos, t);
    const vRel = s.vel.sub(wind);
    const vRelMag = vRel.length();
    const mach = vRelMag / air.soundSpeed;
    const Cd = ctx.round.dragCoefficient(mach);
    const A = ctx.round.referenceArea();
    const drag = this.cfg.enableDrag ? 0.5 * air.density * Cd * A * vRelMag * vRelMag : 0.0;
    out.path.push({
      t,
      position: ops.toEnuPosition(s.pos),
      velocity: ops.toEnuVector(s.vel),
      mach,
      mass: s.mass,
      drag,
    });
  }
}

interface IntegrationContext {
  round: Munition;
  ops: FrameOps;
  spin0: number;
  guidanceStart: number;
  target?: Vec3; // in the integration frame
  rhsEvals: number;
}

function addState(s: State, k: State, h: number): State {
  return { pos: s.pos.add(k.pos.mul(h)), vel: s.vel.add(k.vel.mul(h)), mass: s.mass + k.mass * h };
}
