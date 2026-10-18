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
//  V2 · PHYS:
//    * RENDIMIENTO (tarea E): el estado vive en Float64Array [x,y,z,vx,vy,vz,
//      m,p] y el lado derecho se evalúa en escalares — CERO asignaciones y
//      cero cierres por paso (antes: ~40 Vec3 nuevos por evaluación). La
//      atmósfera y el viento se muestrean con `sampleInto`/`into`. Con
//      `integrator: 'rk4'` (default) el resultado es BIT A BIT el del solver
//      anterior: mismo orden de cada operación IEEE-754 (golden.test.ts).
//    * PASO ADAPTATIVO: `integrator: 'rk45'` = Dormand–Prince 5(4) con control
//      de error, FSAL, pasos recortados en las discontinuidades temporales
//      (encendido/apagado del motor, fin del base bleed, activación del
//      guiado, espoleta de tiempo), salida densa por Hermite cúbico (camino
//      muestreado cada `outputDt`) y detección de impacto/espoleta sobre el
//      interpolante (sondeo del terreno cada `terrainProbeM` dentro del paso +
//      bisección). Para previews, solves y tablas: ~20× menos evaluaciones con
//      el punto de impacto a centímetros de la referencia RK4 dt = 5 ms.
//    * `recordPath: false` — los solves (barridos, bisecciones, Monte-Carlo)
//      no necesitan el camino: solo primera y última muestra.
//    * STANAG 4355 — PUNTO-MASA MODIFICADO (tarea B) para proyectiles con
//      `round.aero`: spin integrado con amortiguamiento C_lp, guiñada de
//      reposo de equilibrio giroscópico, sustentación, Magnus y arrastre por
//      guiñada. Ver la sección MPM de `rhs()` y docs/FISICA_WEB.md.
// ============================================================================
import { AtmoSample, Atmosphere, WindField, WindInto } from './Atmosphere';
import { Munition, SpinAero } from './Munition';
import { Vec3 } from './Vec3';
import { EnuFrame, WGS84 } from './Geodesy';
import {
  G1_TABLE, G7_TABLE, TableLookup, lookupOf, sectionalDensityLbIn2,
} from './DragTables';
import type { FuzeSpec } from './WeaponSystem';

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
  /**
   * P-VIVO.3 — cómo terminó el vuelo: impacto clásico en el suelo ('ground'),
   * detonación aérea por espoleta de tiempo/proximidad ('air') o impacto con
   * espoleta de retardo ('buried': mismo punto, explosión enterrada).
   */
  detonation: 'ground' | 'air' | 'buried';
  /** Altura del punto de detonación sobre el suelo local (m; 0 en impacto). */
  burstHeightM: number;
  /** V2 — pasos aceptados del integrador (diagnóstico). */
  steps?: number;
  /** V2 · MPM — spin al final del vuelo (rad/s) y al disparo. */
  spinFinalRadS?: number;
  spinInitialRadS?: number;
  /** V2 · MPM — guiñada de reposo máxima del vuelo (grados). */
  maxYawOfReposeDeg?: number;
}

/** V2 — integrador: RK4 de paso fijo (referencia) o Dormand–Prince 5(4). */
export type IntegratorKind = 'rk4' | 'rk45';
/**
 * V2 — modelo de giro: 'auto' (MPM si la munición trae `aero`, si no la
 * deriva simplificada P1.2), 'simple' (siempre P1.2) o 'mpm' (MPM si hay
 * datos; sin datos cae a 'simple').
 */
export type SpinModel = 'auto' | 'simple' | 'mpm';

export class SolverConfig {
  dt = 0.002;          // s, fixed integration step (RK4)
  maxFlight = 400.0;   // s, safety cap
  groundZ = 0.0;       // impact plane altitude (ENU z) unless terrainHeight set
  enableCoriolis = true;
  latitudeDeg = 40.0;  // battery latitude (Coriolis; ECEF anchor in spherical)
  /**
   * Altitud MSL del suelo de la batería (m). El marco de integración ancla
   * z=0 en ese suelo, pero la atmósfera se define sobre el nivel del mar:
   * densidad/Mach se muestrean en z + anchorAltitudeM. Con 0 (default) la
   * integración es bit a bit la validada contra el core C++.
   */
  anchorAltitudeM = 0.0;
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

  // -- V2 · PHYS ---------------------------------------------------------------
  /** Integrador. 'rk4' (default) = referencia bit a bit; 'rk45' = adaptativo. */
  integrator: IntegratorKind = 'rk4';
  /**
   * RK45 — tolerancia (adimensional). Escala de error por paso:
   * posición τ·(10 km + |Δr|), velocidad τ·(100 m/s + |v|). 1e-9 deja el
   * impacto a < 5 cm de la referencia RK4 dt = 5 ms a 30 km (tests).
   */
  tolerance = 1e-9;
  /** RK45 — paso máximo (s). */
  maxStep = 2.0;
  /** RK45 — separación de las muestras del camino (s); 0 = dt·sampleEvery. */
  outputDt = 0.0;
  /** false = no guardar el camino (solo primera y última muestra). */
  recordPath = true;
  /**
   * Modelo de giro (ver SpinModel). Default 'simple' (P1.2) HASTA validar el
   * MPM contra la deriva de FT 155-AM-1 (ver docs/v2/REPORT_PHYS.md): con
   * 'auto' o 'mpm' se usa el punto-masa modificado en las municiones con
   * `aero`. Cambiar el default a 'auto' solo tras pasar esa validación.
   */
  spinModel: SpinModel = 'simple';
  /** RK45 — separación máxima (m) del sondeo del terreno dentro de un paso. */
  terrainProbeM = 20.0;

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

// ---- Estado: índices del vector [x, y, z, vx, vy, vz, m, p] -------------------
const NS = 8;
const IM = 6; // masa
const IP = 7; // spin (rad/s, módulo; el sentido lo da el estriado)

// ---- Dormand–Prince 5(4) -----------------------------------------------------
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525,
  E7 = -1 / 40;

/** Guiñada de reposo máxima por defecto (rad): validez del modelo lineal. */
const DEFAULT_MAX_YAW = 0.30;

/**
 * V2 · MPM — factor de estabilidad giroscópica
 *   Sg = 2·I_x²·p² / (π·ρ·d³·I_y·C_Mα·V²)
 * (> 1 = estable; los obuses de 155 mm salen con Sg ≈ 1.5–2.5).
 */
export function gyroscopicStability(
  aero: SpinAero, diameterM: number, rho: number, speedMS: number, spinRadS: number, mach: number,
): number {
  const cma = lookupOf(aero.mach, aero.cma).value(mach);
  const d3 = diameterM * diameterM * diameterM;
  return (2 * aero.ixKgM2 * aero.ixKgM2 * spinRadS * spinRadS) /
    (Math.PI * rho * d3 * aero.iyKgM2 * cma * speedMS * speedMS);
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

  // ---------------------------------------------------------------------------
  //  Contexto de la integración en curso (campos planos: el lado derecho los
  //  lee sin cierres ni objetos intermedios).
  // ---------------------------------------------------------------------------
  private frame?: EnuFrame;
  private earthRadius = 0.0;
  private round!: Munition;
  private spherical = false;
  private R0 = 0.0;
  // Base ENU→ECEF y origen (modo esférico).
  private fex = 0; private fey = 0; private fez = 0;
  private fnx = 0; private fny = 0; private fnz = 0;
  private fux = 0; private fuy = 0; private fuz = 0;
  private fox = 0; private foy = 0; private foz = 0;
  // Gravedad (plano) y rotación terrestre.
  private gfx = 0; private gfy = 0; private gfz = 0;
  private omx = 0; private omy = 0; private omz = 0;
  private refArea = 0;
  private anchorAlt = 0;
  // Arrastre de guiñada nula.
  private dragLut!: TableLookup;
  private dragScaled = false;
  private formI = 1;
  // Giro.
  private spin0 = 0;
  private spinSign = 1;
  private spinSimple = false;
  private spinMpm = false;
  private claL!: TableLookup; private cmaL!: TableLookup; private cnpaL!: TableLookup;
  private clpL!: TableLookup; private cda2L!: TableLookup;
  private aIx = 0; private aFL = 1; private aQD = 1; private aQM = 1; private aMaxYaw = DEFAULT_MAX_YAW;
  // Guiado.
  private hasTarget = false;
  private tgx = 0; private tgy = 0; private tgz = 0;
  private guidanceStart = 0;
  // Viento.
  private windFn: WindField = (() => new Vec3()) as WindField;
  private windInto: WindInto | null = null;
  private readonly windPos = new Vec3();
  private readonly w = new Float64Array(3);
  // Muestras atmosféricas de trabajo.
  private readonly air: AtmoSample = {
    density: 0, temperature: 0, pressure: 0, soundSpeed: 0, virtualTemperature: 0,
  };
  // Buffers del estado y de las etapas RK.
  private readonly y = new Float64Array(NS);
  private readonly yPrev = new Float64Array(NS);
  private readonly ys = new Float64Array(NS);
  private readonly yNew = new Float64Array(NS);
  private readonly yh = new Float64Array(NS);
  private readonly k1 = new Float64Array(NS);
  private readonly k2 = new Float64Array(NS);
  private readonly k3 = new Float64Array(NS);
  private readonly k4 = new Float64Array(NS);
  private readonly k5 = new Float64Array(NS);
  private readonly k6 = new Float64Array(NS);
  private readonly k7 = new Float64Array(NS);
  private readonly kTmp = new Float64Array(NS);
  private rhsEvals = 0;
  /** ¿Guardar el camino en esta integración? (cfg.recordPath o integrateLight). */
  private record = true;
  private recordOverride: boolean | null = null;
  // Diagnóstico de la última evaluación.
  private lastMach = 0;
  private lastCd = 0;
  private lastYaw2 = 0;
  private maxYaw2 = 0;
  private maxMachSeen = 0;

  /**
   * Integrate a full trajectory from launch to impact (or time cap).
   * Positions/velocities in and out are ENU meters regardless of mode.
   * `targetEnu` feeds the P1.5 proportional-navigation guidance of rounds
   * whose munition has `guidance.enabled`. `fuze` (P-VIVO.3) cambia SOLO la
   * condición de corte; ausente o 'impact'/'delay' la integración es bit a
   * bit la clásica.
   */
  integrate(
    round: Munition,
    launchPos: Vec3,
    launchVel: Vec3,
    targetEnu?: Vec3,
    fuze?: FuzeSpec,
  ): FlightResult {
    const cfg = this.cfg;
    this.prepare(round, launchVel, targetEnu);
    const y = this.y;

    // Launch state in the integration frame.
    if (this.spherical) {
      const p = this.frame!.enuToEcefPosition(launchPos);
      const v = this.frame!.enuToEcefVector(launchVel);
      y[0] = p.x; y[1] = p.y; y[2] = p.z;
      y[3] = v.x; y[4] = v.y; y[5] = v.z;
    } else {
      y[0] = launchPos.x; y[1] = launchPos.y; y[2] = launchPos.z;
      y[3] = launchVel.x; y[4] = launchVel.y; y[5] = launchVel.z;
    }
    y[IM] = round.mass;
    y[IP] = this.spin0;
    const launchFramePos = new Vec3(y[0], y[1], y[2]);

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
      detonation: 'ground',
      burstHeightM: 0.0,
    };

    // P-VIVO.3 — parámetros de la espoleta (solo la condición de corte).
    const fuzeMode = fuze?.mode ?? 'impact';
    const fuzeTimeS = fuzeMode === 'time' ? Math.max(0, fuze?.timeS ?? 0) : Number.POSITIVE_INFINITY;
    const fuzeHeightM = fuze?.heightM ?? 7.0;

    if (cfg.integrator === 'rk45') this.runRK45(out, fuzeMode, fuzeTimeS, fuzeHeightM);
    else this.runRK4(out, fuzeMode, fuzeTimeS, fuzeHeightM);

    // ---- Cierre común -----------------------------------------------------------
    if (cfg.sphericalEarth) {
      // Great-circle ground distance over the sphere (the chord underestimates
      // range at 300 km by ~0.5%; the arc is what a map would measure).
      const r0 = launchFramePos.normalized();
      const r1 = new Vec3(y[0], y[1], y[2]).normalized();
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
    if (this.record) {
      for (const p of out.path) out.maxMach = Math.max(out.maxMach, p.mach);
    } else {
      // Sin camino: máximo sobre los nodos de integración (k1 de cada paso).
      out.maxMach = this.maxMachSeen;
      for (const p of out.path) out.maxMach = Math.max(out.maxMach, p.mach);
    }
    out.rhsEvaluations = this.rhsEvals;
    if (this.spinMpm) {
      out.spinInitialRadS = this.spin0;
      out.spinFinalRadS = y[IP];
      out.maxYawOfReposeDeg = (Math.sqrt(this.maxYaw2) * 180) / Math.PI;
    }
    return out;
  }

  /**
   * V2 — como integrate() pero SIN guardar el camino (solo primera y última
   * muestra): para barridos, bisecciones, tablas y Monte-Carlo, que solo
   * leen alcance/TOF/impacto. La integración es la misma (bit a bit).
   */
  integrateLight(
    round: Munition,
    launchPos: Vec3,
    launchVel: Vec3,
    targetEnu?: Vec3,
    fuze?: FuzeSpec,
  ): FlightResult {
    this.recordOverride = false;
    try {
      return this.integrate(round, launchPos, launchVel, targetEnu, fuze);
    } finally {
      this.recordOverride = null;
    }
  }

  // ---------------------------------------------------------------------------
  //  Preparación: copia a campos planos todo lo que el lado derecho necesita.
  // ---------------------------------------------------------------------------
  private prepare(round: Munition, launchVel: Vec3, targetEnu?: Vec3): void {
    const cfg = this.cfg;
    this.round = round;
    this.record = this.recordOverride ?? cfg.recordPath;
    this.rhsEvals = 0;
    this.maxYaw2 = 0;
    this.lastYaw2 = 0;
    this.maxMachSeen = 0;
    this.spherical = cfg.sphericalEarth;

    if (this.spherical) {
      // Anchor the ENU frame on the WGS84 ellipsoid at the battery latitude.
      const f = this.frame && this.frame.latDeg === cfg.latitudeDeg && this.frame.lonDeg === cfg.anchorLonDeg
        ? this.frame
        : new EnuFrame(cfg.latitudeDeg, cfg.anchorLonDeg, 0.0);
      this.frame = f;
      this.R0 = f.originEcef.length();
      this.earthRadius = this.R0;
      this.fex = f.east.x; this.fey = f.east.y; this.fez = f.east.z;
      this.fnx = f.north.x; this.fny = f.north.y; this.fnz = f.north.z;
      this.fux = f.up.x; this.fuy = f.up.y; this.fuz = f.up.z;
      this.fox = f.originEcef.x; this.foy = f.originEcef.y; this.foz = f.originEcef.z;
      this.omx = 0.0; this.omy = 0.0; this.omz = WGS84.omega;
    } else {
      this.gfx = cfg.gravity.x; this.gfy = cfg.gravity.y; this.gfz = cfg.gravity.z;
      this.omx = this.omegaEnu.x; this.omy = this.omegaEnu.y; this.omz = this.omegaEnu.z;
    }
    this.refArea = round.referenceArea();
    this.anchorAlt = cfg.anchorAltitudeM;

    // Cd(M) de guiñada nula — mismo tramo y fórmula que Munition.dragCoefficient.
    if (round.dragModel === 'G1' || round.dragModel === 'G7') {
      this.dragLut = new TableLookup(round.dragModel === 'G1' ? G1_TABLE : G7_TABLE);
      this.dragScaled = true;
      this.formI = sectionalDensityLbIn2(round.mass, round.diameter) / round.ballisticCoefficient;
    } else {
      this.dragLut = new TableLookup(round.dragCurve.length ? round.dragCurve : [{ mach: 0, cd: 0.3 }]);
      this.dragScaled = false;
      this.formI = 1;
    }

    // P1.2 — launch spin rate: one turn per twistCalibers calibers.
    const v0 = launchVel.length();
    this.spin0 =
      round.spinStabilized && round.twistCalibers > 0
        ? (2.0 * Math.PI * v0) / (round.twistCalibers * round.diameter)
        : 0.0;
    this.spinSign = round.rightHandTwist ? 1.0 : -1.0;
    const aero = round.aero;
    const wantMpm = cfg.spinModel !== 'simple' && aero !== undefined && cfg.enableDrag;
    this.spinMpm = round.spinStabilized && this.spin0 > 0.0 && wantMpm;
    this.spinSimple = round.spinStabilized && !this.spinMpm;
    if (this.spinMpm && aero) {
      this.claL = lookupOf(aero.mach, aero.cla);
      this.cmaL = lookupOf(aero.mach, aero.cma);
      this.cnpaL = lookupOf(aero.mach, aero.cnpa);
      this.clpL = lookupOf(aero.mach, aero.clp);
      this.cda2L = lookupOf(aero.mach, aero.cda2);
      this.aIx = aero.ixKgM2;
      this.aFL = aero.fL ?? 1.0;
      this.aQD = aero.qD ?? 1.0;
      this.aQM = aero.qM ?? 1.0;
      this.aMaxYaw = aero.maxYawRad ?? DEFAULT_MAX_YAW;
    }

    // P1.5 — guidance engages after burnout (+ optional delay). Con RAP el
    // fin REAL del quemado es ignitionDelayS + burnTime (P-PRO.4).
    this.guidanceStart =
      (round.motor.enabled ? round.motor.ignitionDelayS + round.motor.burnTime : 0.0) +
      round.guidance.activationDelay;
    this.hasTarget = targetEnu !== undefined;
    if (targetEnu) {
      const tg = this.spherical ? this.frame!.enuToEcefPosition(targetEnu) : targetEnu;
      this.tgx = tg.x; this.tgy = tg.y; this.tgz = tg.z;
    }

    this.windFn = this.atmo.windField;
    this.windInto = this.atmo.windField.into ?? null;
  }

  // ---------------------------------------------------------------------------
  //  Utilidades de marco sobre el vector de estado.
  // ---------------------------------------------------------------------------
  private altitudeOf(y: Float64Array): number {
    if (this.spherical) return Math.sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2]) - this.R0;
    return y[2];
  }

  private descendingOf(y: Float64Array): boolean {
    if (this.spherical) return y[3] * y[0] + y[4] * y[1] + y[5] * y[2] <= 0.0;
    return y[5] <= 0.0;
  }

  /** ENU (este, norte, arriba) de una posición del marco de integración. */
  private enuX(px: number, py: number, pz: number): number {
    return this.fex * (px - this.fox) + this.fey * (py - this.foy) + this.fez * (pz - this.foz);
  }
  private enuY(px: number, py: number, pz: number): number {
    return this.fnx * (px - this.fox) + this.fny * (py - this.foy) + this.fnz * (pz - this.foz);
  }
  private enuZ(px: number, py: number, pz: number): number {
    return this.fux * (px - this.fox) + this.fuy * (py - this.foy) + this.fuz * (pz - this.foz);
  }

  private groundAt(y: Float64Array): number {
    const th = this.cfg.terrainHeight;
    if (th) {
      if (!this.spherical) return th(y[0], y[1]);
      return th(this.enuX(y[0], y[1], y[2]), this.enuY(y[0], y[1], y[2]));
    }
    return this.cfg.groundZ;
  }

  /** Viento en el marco de integración → this.w. */
  private windAt(px: number, py: number, pz: number, t: number): void {
    const w = this.w;
    if (!this.spherical) {
      if (this.windInto) this.windInto(px, py, pz, t, w, 0);
      else {
        const v = this.windFn(this.windPos.set(px, py, pz), t);
        w[0] = v.x; w[1] = v.y; w[2] = v.z;
      }
      return;
    }
    const ex = this.enuX(px, py, pz), ny = this.enuY(px, py, pz), uz = this.enuZ(px, py, pz);
    let wx: number, wy: number, wz: number;
    if (this.windInto) {
      this.windInto(ex, ny, uz, t, w, 0);
      wx = w[0]; wy = w[1]; wz = w[2];
    } else {
      const v = this.windFn(this.windPos.set(ex, ny, uz), t);
      wx = v.x; wy = v.y; wz = v.z;
    }
    // enuToEcefVector
    w[0] = this.fex * wx + this.fnx * wy + this.fux * wz;
    w[1] = this.fey * wx + this.fny * wy + this.fuy * wz;
    w[2] = this.fez * wx + this.fnz * wy + this.fuz * wz;
  }

  /** Cd de guiñada nula (bit a bit Munition.dragCoefficient). */
  private cd0(mach: number): number {
    const raw = this.dragLut.value(mach);
    return this.dragScaled ? this.formI * raw : raw;
  }

  // ---------------------------------------------------------------------------
  //  Lado derecho: la física vive aquí. `tSw` es el instante con el que se
  //  evalúan los conmutadores TEMPORALES (motor, base bleed, guiado): en RK4
  //  es t (idéntico al solver previo); en RK45 se congela en el punto medio
  //  del paso, que nunca cruza una discontinuidad (los pasos se recortan en
  //  ellas). Escribe dy = [v, a, dm/dt, dp/dt].
  // ---------------------------------------------------------------------------
  private rhs(t: number, tSw: number, y: Float64Array, dy: Float64Array): void {
    this.rhsEvals++;
    const round = this.round;
    const cfg = this.cfg;
    const px = y[0], py = y[1], pz = y[2];
    const vx = y[3], vy = y[4], vz = y[5];
    const mass = y[IM];
    const sph = this.spherical;

    let r = 0.0;
    let alt: number;
    if (sph) {
      r = Math.sqrt(px * px + py * py + pz * pz);
      alt = r - this.R0;
    } else {
      alt = pz;
    }
    const air = this.atmo.sampleInto(alt + this.anchorAlt, this.air);
    this.windAt(px, py, pz, t);
    const w = this.w;
    const vrx = vx - w[0], vry = vy - w[1], vrz = vz - w[2]; // airspeed vector
    const vRelMag = Math.sqrt(vrx * vrx + vry * vry + vrz * vrz);
    const A = this.refArea;

    // --- Gravity -----------------------------------------------------------
    let gx: number, gy: number, gz: number;
    if (sph) {
      const f = -WGS84.GM / (r * r * r);
      gx = px * f; gy = py * f; gz = pz * f;
    } else {
      gx = this.gfx; gy = this.gfy; gz = this.gfz;
    }

    // --- Frame rotation: Coriolis (+ centrifugal in ECEF) ------------------
    let arx = 0.0, ary = 0.0, arz = 0.0;
    if (cfg.enableCoriolis) {
      const ox = this.omx, oy = this.omy, oz = this.omz;
      // omega.cross(vel).mul(-2.0)
      const cx = (oy * vz - oz * vy) * -2.0;
      const cy = (oz * vx - ox * vz) * -2.0;
      const cz = (ox * vy - oy * vx) * -2.0;
      if (sph) {
        // cent = -(Ω × (Ω × r))
        const ix = oy * pz - oz * py;
        const iy = oz * px - ox * pz;
        const iz = ox * py - oy * px;
        arx = cx + -(oy * iz - oz * iy);
        ary = cy + -(oz * ix - ox * iz);
        arz = cz + -(ox * iy - oy * ix);
      } else {
        arx = cx; ary = cy; arz = cz;
      }
    }

    let adx = 0.0, ady = 0.0, adz = 0.0;  // drag
    let asx = 0.0, asy = 0.0, asz = 0.0;  // spin (P1.2 o MPM: sustentación + Magnus)
    let dpdt = 0.0;

    if (this.spinMpm) {
      // =======================================================================
      //  STANAG 4355 — PUNTO-MASA MODIFICADO (McCoy, Modern Exterior
      //  Ballistics, cap. 9; Lieske & Reiter, BRL R-1314):
      //
      //    α_R = −8·I_x·p·(v × u̇) / (π·ρ·d³·C_Mα·V⁴)     guiñada de reposo
      //    a_D = −(πρd²/8m)·(C_D0 + Q_D²·C_Dδ²·α²)·V·v     arrastre (+guiñada)
      //    a_L = +(πρd²/8m)·f_L·C_Lα·V²·α_R               sustentación
      //    a_M = −(πρd³/8m)·Q_M·C_Npα·p·(α_R × v)          Magnus
      //    ṗ   = (πρd⁴/8I_x)·C_lp·V·p                    amortiguamiento
      //
      //  con v la velocidad relativa al aire, p el spin con signo (+ estriado
      //  dextrógiro) y u̇ ≈ g + aceleraciones del marco (el arrastre es
      //  colineal con v y no aporta a v × u̇). α_R se limita a aMaxYaw.
      // =======================================================================
      if (vRelMag > 1e-6 && air.density > 0.0) {
        const rho = air.density;
        const mach = vRelMag / air.soundSpeed;
        const d = round.diameter;
        const pS = this.spinSign * y[IP];
        const V2 = vRelMag * vRelMag;
        const ux = gx + arx, uy = gy + ary, uz = gz + arz;
        const cx = vry * uz - vrz * uy;
        const cy = vrz * ux - vrx * uz;
        const cz = vrx * uy - vry * ux;
        const cma = this.cmaL.value(mach);
        let ax = 0.0, ay = 0.0, az = 0.0, a2 = 0.0;
        if (cma > 1e-6) {
          const ka = (-8.0 * this.aIx * pS) / (Math.PI * rho * d * d * d * cma * V2 * V2);
          ax = ka * cx; ay = ka * cy; az = ka * cz;
          a2 = ax * ax + ay * ay + az * az;
          const amax = this.aMaxYaw;
          if (a2 > amax * amax) {
            const s = amax / Math.sqrt(a2);
            ax *= s; ay *= s; az *= s;
            a2 = amax * amax;
          }
        }
        let Cd = this.cd0(mach);
        if (round.baseBleed.enabled && tSw < round.baseBleed.durationS) Cd *= round.baseBleed.dragFactor;
        const qd = this.aQD;
        Cd += qd * qd * this.cda2L.value(mach) * a2;
        const kq = (rho * A) / (2.0 * mass); // πρd²/8m
        const kD = -kq * Cd * vRelMag;
        adx = kD * vrx; ady = kD * vry; adz = kD * vrz;
        const kL = kq * this.aFL * this.claL.value(mach) * V2;
        const kM = -kq * d * this.aQM * this.cnpaL.value(mach) * pS;
        // α × v
        const mx = ay * vrz - az * vry;
        const my = az * vrx - ax * vrz;
        const mz = ax * vry - ay * vrx;
        asx = kL * ax + kM * mx;
        asy = kL * ay + kM * my;
        asz = kL * az + kM * mz;
        dpdt = ((rho * A * d * d * vRelMag * this.clpL.value(mach)) / (2.0 * this.aIx)) * y[IP];
        this.lastMach = mach;
        this.lastCd = Cd;
        this.lastYaw2 = a2;
      }
    } else {
      // --- Aerodynamic drag: -1/2 rho Cd A |vRel| vRel ----------------------
      if (cfg.enableDrag && vRelMag > 1e-6 && air.density > 0.0) {
        const mach = vRelMag / air.soundSpeed;
        let Cd = this.cd0(mach);
        // P-PRO.4 — base bleed: mientras el generador de gas quema, el culote
        // deja de succionar y el Cd efectivo baja (off por defecto: bit a bit
        // idéntico al modelo validado).
        if (round.baseBleed.enabled && tSw < round.baseBleed.durationS) {
          Cd *= round.baseBleed.dragFactor;
        }
        const fMag = 0.5 * air.density * Cd * A * vRelMag; // scalar
        const k = -fMag * vRelMag;
        const den = vRelMag * mass;
        adx = (vrx * k) / den; ady = (vry * k) / den; adz = (vrz * k) / den;
        // = -(1/2 rho Cd A |vRel|) * vRel / m   (force / mass)
        this.lastMach = mach;
        this.lastCd = Cd;
      }

      // --- P1.2: spin-induced forces (gyroscopic drift + Magnus) -----------
      // Approximations (documented in docs/FISICA_WEB.md):
      //  * Spin p(t) decays exponentially (tau ~ 80 s); launch value from the
      //    rifling twist: p0 = 2*pi*v0 / (twist_calibers * d).
      //  * Yaw of repose: a_sd = k_sd * g * (p*d / |vRel|) toward the twist
      //    side; k_sd lumps the 6-DOF coefficients into one constant.
      //  * Magnus: a_m = C_mag * rho*A*d/(2m) * (omega_spin x vRel).
      if (this.spinSimple && this.spin0 > 0.0 && vRelMag > 1e-6) {
        const sign = this.spinSign;
        const p = this.spin0 * Math.exp(-t / round.spinDecayTau);
        // vhat = vel.normalized()
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        let hx = 0.0, hy = 0.0, hz = 0.0;
        if (vl > 1e-12) { hx = vx / vl; hy = vy / vl; hz = vz / vl; }
        // up
        let ux = 0.0, uy = 0.0, uz = 1.0;
        if (sph) {
          if (r > 1e-12) { ux = px / r; uy = py / r; uz = pz / r; } else { uz = 0.0; }
        }
        // side = vhat × up (right of the velocity vector)
        const sx = hy * uz - hz * uy;
        const sy = hz * ux - hx * uz;
        const sz = hx * uy - hy * ux;
        const sideLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sideLen > 1e-9) {
          const gLen = Math.sqrt(gx * gx + gy * gy + gz * gz);
          const ks = sign * round.spinDriftCoeff * gLen * ((p * round.diameter) / vRelMag);
          const sdx = (sx / sideLen) * ks, sdy = (sy / sideLen) * ks, sdz = (sz / sideLen) * ks;
          const sp = sign * p;
          const ox = hx * sp, oy = hy * sp, oz = hz * sp;
          const km = (round.magnusCoeff * air.density * A * round.diameter) / (2.0 * mass);
          const mx = (oy * vrz - oz * vry) * km;
          const my = (oz * vrx - ox * vrz) * km;
          const mz = (ox * vry - oy * vrx) * km;
          asx = sdx + mx; asy = sdy + my; asz = sdz + mz;
        }
      }
    }

    // --- Rocket thrust (optional, along velocity) ---------------------------
    // P-PRO.4 — RAP: el empuje va de ignitionDelayS a ignitionDelayS+burnTime
    // (con delay 0, tBurn == t y la ventana es la de siempre).
    let atx = 0.0, aty = 0.0, atz = 0.0;
    let dmdt = 0.0;
    const motor = round.motor;
    const tBurn = tSw - motor.ignitionDelayS;
    if (motor.enabled && tBurn >= 0.0 && tBurn < motor.burnTime && mass > 0.0) {
      // La rama vertical cubre v≈0 ABSOLUTA (cohete en rampa con brisa):
      // vRelMag>0 con |v|=0 normalizaría el vector cero y anularía el empuje.
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let dx: number, dyy: number, dz: number;
      if (vl > 1e-6) {
        dx = vx / vl; dyy = vy / vl; dz = vz / vl;
      } else if (sph) {
        if (r > 1e-12) { dx = px / r; dyy = py / r; dz = pz / r; } else { dx = 0.0; dyy = 0.0; dz = 0.0; }
      } else {
        dx = 0.0; dyy = 0.0; dz = 1.0;
      }
      const f = motor.thrust / mass;
      atx = dx * f; aty = dyy * f; atz = dz * f;
      dmdt = -motor.propellantMass / motor.burnTime;
    }

    // --- P1.5: proportional navigation toward the target -------------------
    // a_cmd = N * (Omega_los x v), Omega_los = (r x v_rel)/(r.r) with a static
    // target (v_rel = -v). Lateral-only, clamped to maxLateralG.
    let agx = 0.0, agy = 0.0, agz = 0.0;
    const guid = round.guidance;
    if (
      guid.enabled &&
      this.hasTarget &&
      tSw >= this.guidanceStart &&
      (!guid.terminalOnly || (sph ? vx * px + vy * py + vz * pz <= 0.0 : vz <= 0.0))
    ) {
      const rx = this.tgx - px, ry = this.tgy - py, rz = this.tgz - pz;
      const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (dist > 30.0) {
        const nvx = -vx, nvy = -vy, nvz = -vz;
        const rr = rx * rx + ry * ry + rz * rz;
        const olx = (ry * nvz - rz * nvy) / rr;
        const oly = (rz * nvx - rx * nvz) / rr;
        const olz = (rx * nvy - ry * nvx) / rr;
        const N = guid.navConstant;
        let ax = (oly * vz - olz * vy) * N;
        let ay = (olz * vx - olx * vz) * N;
        let az = (olx * vy - oly * vx) * N;
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        let hx = 0.0, hy = 0.0, hz = 0.0;
        if (vl > 1e-12) { hx = vx / vl; hy = vy / vl; hz = vz / vl; }
        const dd = ax * hx + ay * hy + az * hz;
        ax = ax - hx * dd; ay = ay - hy * dd; az = az - hz * dd; // pure lateral steering
        const maxA = guid.maxLateralG * 9.80665;
        const aMagn = Math.sqrt(ax * ax + ay * ay + az * az);
        if (aMagn > maxA) {
          const s = maxA / aMagn;
          ax = ax * s; ay = ay * s; az = az * s;
        }
        agx = ax; agy = ay; agz = az;
      }
    }

    dy[0] = vx; dy[1] = vy; dy[2] = vz; // dx/dt = v
    dy[3] = ((((gx + adx) + arx) + atx) + asx) + agx;
    dy[4] = ((((gy + ady) + ary) + aty) + asy) + agy;
    dy[5] = ((((gz + adz) + arz) + atz) + asz) + agz;
    dy[IM] = dmdt;
    dy[IP] = dpdt;
  }

  // ---------------------------------------------------------------------------
  //  RK4 clásico de paso fijo — la referencia (bit a bit el solver previo).
  // ---------------------------------------------------------------------------
  private rk4Step(y: Float64Array, t: number, dt: number): void {
    const k1 = this.k1, k2 = this.k2, k3 = this.k3, k4 = this.k4, ys = this.ys;
    this.rhs(t, t, y, k1);
    const h2 = dt * 0.5;
    for (let i = 0; i < NS; i++) ys[i] = y[i] + k1[i] * h2;
    const tm = t + dt * 0.5;
    this.rhs(tm, tm, ys, k2);
    for (let i = 0; i < NS; i++) ys[i] = y[i] + k2[i] * h2;
    this.rhs(tm, tm, ys, k3);
    for (let i = 0; i < NS; i++) ys[i] = y[i] + k3[i] * dt;
    const te = t + dt;
    this.rhs(te, te, ys, k4);
    const h6 = dt / 6.0;
    for (let i = 0; i < 6; i++) y[i] = y[i] + (((k1[i] + k2[i] * 2) + k3[i] * 2) + k4[i]) * h6;
    const m = y[IM] + (((k1[IM] + 2 * k2[IM]) + 2 * k3[IM]) + k4[IM]) * h6;
    if (!(m < 1e-6)) y[IM] = m; // guard: masa no positiva => conserva la previa
    y[IP] = y[IP] + (((k1[IP] + 2 * k2[IP]) + 2 * k3[IP]) + k4[IP]) * h6;
    if (!this.record && this.lastMach > this.maxMachSeen) {
      this.maxMachSeen = this.lastMach;
    }
    if (this.spinMpm && this.lastYaw2 > this.maxYaw2) this.maxYaw2 = this.lastYaw2;
  }

  private runRK4(out: FlightResult, fuzeMode: string, fuzeTimeS: number, fuzeHeightM: number): void {
    const cfg = this.cfg;
    const y = this.y, yPrev = this.yPrev, ys = this.ys;
    const dt = cfg.dt;
    let t = 0.0;

    this.pushSample(out, y, t);
    // El ápice arranca en la altitud de LANZAMIENTO: un tiro tenso cuesta
    // abajo (todo el vuelo bajo z=0) reporta su vértice real, no 0.
    out.apex = this.altitudeOf(y);

    // Con TERRENO real, un tiro tenso puede comerse una ladera que sube más
    // deprisa que él (máscara de cresta): el cruce cuenta también en fase
    // ascendente. Sin terreno (plano analítico, la config de paridad C++) se
    // mantiene la puerta descendente clásica: un tiro que nace exactamente
    // sobre el plano del suelo no debe auto-impactar al salir.
    const crestMask = cfg.terrainHeight !== undefined;
    const record = this.record;
    const every = cfg.sampleEvery;

    let prevAlt = out.apex;
    let prevGround = this.groundAt(y);
    const maxSteps = Math.floor(cfg.maxFlight / dt);
    let steps = 0;
    for (let step = 0; step < maxSteps; step++) {
      yPrev.set(y);
      this.rk4Step(y, t, dt);
      t += dt;
      steps++;

      // Track apex from the live state.
      const alt = this.altitudeOf(y);
      out.apex = Math.max(out.apex, alt);

      // Ground / terrain intersection between prev and current. With terrain,
      // ANY above->below crossing is an impact (crest mask, see above); on the
      // analytic plane only a *descending* crossing counts.
      const curGround = this.groundAt(y);
      const wasAbove = prevAlt - prevGround >= 0.0;
      const nowBelow = alt - curGround < 0.0;

      // P-VIVO.3 — espoleta de proximidad: detona al bajar de fuzeHeightM
      // sobre el suelo en fase DESCENDENTE.
      if (
        fuzeMode === 'proximity' &&
        this.descendingOf(y) &&
        prevAlt - prevGround >= fuzeHeightM &&
        alt - curGround < fuzeHeightM
      ) {
        const f0 = prevAlt - prevGround - fuzeHeightM;
        const f1 = alt - curGround - fuzeHeightM;
        const frac = f0 / (f0 - f1);
        this.lerpState(yPrev, y, frac, ys);
        const tBurst = t - dt + frac * dt;
        this.pushSample(out, ys, tBurst);
        out.impacted = true;
        out.detonation = 'air';
        this.setImpact(out, ys);
        out.timeOfFlight = tBurst;
        out.burstHeightM = this.altitudeOf(ys) - this.groundAt(ys);
        y.set(ys);
        break;
      }

      // Cruce con el suelo dentro del paso (si lo hay): frac del instante.
      const crossFrac =
        wasAbove && nowBelow && (crestMask || this.descendingOf(y))
          ? (prevAlt - prevGround) / (prevAlt - prevGround - (alt - curGround))
          : Number.POSITIVE_INFINITY;
      // P-VIVO.3 — espoleta de tiempo: frac del instante timeS en este paso.
      const timeFrac =
        fuzeMode === 'time' && t >= fuzeTimeS
          ? Math.max(0, (fuzeTimeS - (t - dt)) / dt)
          : Number.POSITIVE_INFINITY;

      if (crossFrac <= timeFrac && crossFrac <= 1.0) {
        // Linear interpolation to the crossing for a clean impact point.
        this.lerpState(yPrev, y, crossFrac, ys);
        const tHit = t - dt + crossFrac * dt;
        this.pushSample(out, ys, tHit);
        out.impacted = true;
        if (fuzeMode === 'delay') out.detonation = 'buried';
        this.setImpact(out, ys);
        out.timeOfFlight = tHit;
        y.set(ys);
        break;
      }

      if (timeFrac <= 1.0) {
        // Detonación aérea en t = timeS, esté donde esté el proyectil.
        this.lerpState(yPrev, y, timeFrac, ys);
        this.pushSample(out, ys, fuzeTimeS);
        out.impacted = true;
        out.detonation = 'air';
        this.setImpact(out, ys);
        out.timeOfFlight = fuzeTimeS;
        out.burstHeightM = this.altitudeOf(ys) - this.groundAt(ys);
        y.set(ys);
        break;
      }

      if (record && step % every === 0) this.pushSample(out, y, t);
      prevAlt = alt;
      prevGround = curGround;
    }

    if (!out.impacted) {
      // hit time cap
      if (!record) this.pushSample(out, y, t);
      this.setImpact(out, y);
      out.timeOfFlight = t;
    }
    out.steps = steps;
  }

  /** Estado interpolado linealmente (pos/vel/spin); la masa es la del final. */
  private lerpState(a: Float64Array, b: Float64Array, f: number, out: Float64Array): void {
    for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * f;
    out[IM] = b[IM];
    out[IP] = a[IP] + (b[IP] - a[IP]) * f;
  }

  private setImpact(out: FlightResult, y: Float64Array): void {
    out.impactPoint = this.toEnuPosition(y);
    out.impactSpeed = Math.sqrt(y[3] * y[3] + y[4] * y[4] + y[5] * y[5]);
  }

  private toEnuPosition(y: Float64Array): Vec3 {
    if (!this.spherical) return new Vec3(y[0], y[1], y[2]);
    return this.frame!.ecefToEnuPosition(new Vec3(y[0], y[1], y[2]));
  }

  private toEnuVelocity(y: Float64Array): Vec3 {
    if (!this.spherical) return new Vec3(y[3], y[4], y[5]);
    return this.frame!.ecefToEnuVector(new Vec3(y[3], y[4], y[5]));
  }

  // ---------------------------------------------------------------------------
  //  Dormand–Prince 5(4) adaptativo con salida densa (Hermite cúbico).
  // ---------------------------------------------------------------------------
  /** Máscara de los conmutadores temporales en tSw (cambia solo en breakpoints). */
  private phaseMask(tSw: number): number {
    const round = this.round;
    const motor = round.motor;
    const tBurn = tSw - motor.ignitionDelayS;
    let m = 0;
    if (motor.enabled && tBurn >= 0.0 && tBurn < motor.burnTime) m |= 1;
    if (round.baseBleed.enabled && tSw < round.baseBleed.durationS) m |= 2;
    if (tSw >= this.guidanceStart) m |= 4;
    return m;
  }

  /** Hermite cúbico entre (y0,f0) y (y1,f1) en θ ∈ [0,1] → out (pos, vel, m, p). */
  private hermite(
    y0: Float64Array, f0: Float64Array, y1: Float64Array, f1: Float64Array,
    h: number, th: number, out: Float64Array,
  ): void {
    const t2 = th * th, t3 = t2 * th;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = (t3 - 2 * t2 + th) * h;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = (t3 - t2) * h;
    for (let i = 0; i < 6; i++) out[i] = h00 * y0[i] + h10 * f0[i] + h01 * y1[i] + h11 * f1[i];
    out[IM] = y0[IM] + (y1[IM] - y0[IM]) * th;
    out[IP] = y0[IP] + (y1[IP] - y0[IP]) * th;
  }

  private runRK45(out: FlightResult, fuzeMode: string, fuzeTimeS: number, fuzeHeightM: number): void {
    const cfg = this.cfg;
    const y = this.y, yNew = this.yNew, ys = this.ys, yh = this.yh;
    const k1 = this.k1, k2 = this.k2, k3 = this.k3, k4 = this.k4, k5 = this.k5, k6 = this.k6,
      k7 = this.k7;
    const record = this.record;
    const crestMask = cfg.terrainHeight !== undefined;
    const tol = cfg.tolerance;
    const maxStep = cfg.maxStep;
    const lx = y[0], ly = y[1], lz = y[2]; // origen para la escala de error de posición

    let t = 0.0;
    this.pushSample(out, y, t);
    out.apex = this.altitudeOf(y);

    // Espoleta de tiempo en t ≤ 0: detonación en la boca.
    if (fuzeMode === 'time' && fuzeTimeS <= 0) {
      out.impacted = true;
      out.detonation = 'air';
      this.setImpact(out, y);
      out.timeOfFlight = fuzeTimeS;
      out.burstHeightM = this.altitudeOf(y) - this.groundAt(y);
      this.pushSample(out, y, fuzeTimeS);
      out.steps = 0;
      return;
    }

    // Discontinuidades temporales: los pasos aterrizan exactamente en ellas.
    const round = this.round;
    const bps: number[] = [];
    if (round.motor.enabled) {
      if (round.motor.ignitionDelayS > 0) bps.push(round.motor.ignitionDelayS);
      bps.push(round.motor.ignitionDelayS + round.motor.burnTime);
    }
    if (round.baseBleed.enabled) bps.push(round.baseBleed.durationS);
    if (round.guidance.enabled && this.hasTarget && this.guidanceStart > 0) bps.push(this.guidanceStart);
    if (fuzeMode === 'time') bps.push(fuzeTimeS);
    bps.push(cfg.maxFlight);
    const bp = [...new Set(bps.filter((b) => b > 0 && b <= cfg.maxFlight))].sort((a, b) => a - b);
    let bpi = 0;

    const outDt = cfg.outputDt > 0 ? cfg.outputDt : cfg.dt * Math.max(1, cfg.sampleEvery);
    let nextK = 1;
    const probeM = Math.max(1, cfg.terrainProbeM);
    const needProbe = crestMask || fuzeMode === 'proximity';

    let h = Math.min(maxStep, 0.02);
    let fsalMask = -1;
    let gPrev = out.apex - this.groundAt(y); // altura sobre el suelo al inicio del paso
    let steps = 0;
    let done = false;

    for (let iter = 0; iter < 2_000_000 && !done; iter++) {
      while (bpi < bp.length && bp[bpi] <= t + 1e-12) bpi++;
      if (bpi >= bp.length) break; // tope de tiempo alcanzado
      const tb = bp[bpi];
      let hTry = Math.min(h, maxStep);
      let hitsBp = false;
      if (t + hTry >= tb - 1e-9) { hTry = tb - t; hitsBp = true; }
      const tSw = t + 0.5 * hTry;
      const mask = this.phaseMask(tSw);
      if (mask !== fsalMask) this.rhs(t, tSw, y, k1);

      // Etapas.
      for (let i = 0; i < NS; i++) ys[i] = y[i] + hTry * (A21 * k1[i]);
      this.rhs(t + C2 * hTry, tSw, ys, k2);
      for (let i = 0; i < NS; i++) ys[i] = y[i] + hTry * (A31 * k1[i] + A32 * k2[i]);
      this.rhs(t + C3 * hTry, tSw, ys, k3);
      for (let i = 0; i < NS; i++) ys[i] = y[i] + hTry * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
      this.rhs(t + C4 * hTry, tSw, ys, k4);
      for (let i = 0; i < NS; i++) {
        ys[i] = y[i] + hTry * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
      }
      this.rhs(t + C5 * hTry, tSw, ys, k5);
      for (let i = 0; i < NS; i++) {
        ys[i] = y[i] + hTry * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
      }
      this.rhs(t + hTry, tSw, ys, k6);
      for (let i = 0; i < NS; i++) {
        yNew[i] = y[i] + hTry * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i]);
      }
      if (yNew[IM] < 1e-6) yNew[IM] = y[IM];
      const t1 = hitsBp ? tb : t + hTry;
      this.rhs(t1, tSw, yNew, k7);

      // Error RMS escalado (posición respecto del punto de lanzamiento).
      const dr = Math.sqrt(
        (yNew[0] - lx) * (yNew[0] - lx) + (yNew[1] - ly) * (yNew[1] - ly) + (yNew[2] - lz) * (yNew[2] - lz),
      );
      const vmag = Math.sqrt(yNew[3] * yNew[3] + yNew[4] * yNew[4] + yNew[5] * yNew[5]);
      const sPos = tol * (1e4 + dr);
      const sVel = tol * (1e2 + vmag);
      let acc = 0.0;
      for (let i = 0; i < NS; i++) {
        const e = hTry * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
        const sc = i < 3 ? sPos : i < 6 ? sVel : i === IM ? tol * (1 + y[IM]) * 1e3 : tol * (1e3 + y[IP]);
        const q = e / sc;
        acc += q * q;
      }
      const err = Math.sqrt(acc / NS);
      if (err > 1.0 && hTry > 1e-9) {
        h = hTry * Math.max(0.2, 0.9 * Math.pow(err, -0.25));
        fsalMask = mask; // k1 sigue valiendo (mismo t, mismo estado, misma máscara)
        continue;
      }

      // ---- Paso aceptado: eventos sobre el interpolante [t, t1] -------------
      steps++;
      if (!record && this.lastMach > this.maxMachSeen) this.maxMachSeen = this.lastMach;
      if (this.spinMpm && this.lastYaw2 > this.maxYaw2) this.maxYaw2 = this.lastYaw2;
      const H = t1 - t;
      const alt1 = this.altitudeOf(yNew);
      const g1 = alt1 - this.groundAt(yNew);

      // Ápice dentro del paso (la velocidad vertical cambia de signo).
      const up0 = this.spherical ? y[3] * y[0] + y[4] * y[1] + y[5] * y[2] : y[5];
      const up1 = this.spherical
        ? yNew[3] * yNew[0] + yNew[4] * yNew[1] + yNew[5] * yNew[2]
        : yNew[5];
      out.apex = Math.max(out.apex, alt1);
      if (up0 > 0 && up1 <= 0) {
        let a = 0.0, b = 1.0;
        for (let it = 0; it < 40; it++) {
          const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
          this.hermite(y, k1, yNew, k7, H, m1, yh);
          const h1 = this.altitudeOf(yh);
          this.hermite(y, k1, yNew, k7, H, m2, yh);
          const h2 = this.altitudeOf(yh);
          if (h1 < h2) a = m1; else b = m2;
        }
        this.hermite(y, k1, yNew, k7, H, 0.5 * (a + b), yh);
        out.apex = Math.max(out.apex, this.altitudeOf(yh));
      }

      // Sondeo de sub-intervalos (terreno / espoleta de proximidad).
      let nSub = 1;
      if (needProbe) {
        const dx = yNew[0] - y[0], dyy = yNew[1] - y[1], dz = yNew[2] - y[2];
        nSub = Math.max(1, Math.min(4096, Math.ceil(Math.sqrt(dx * dx + dyy * dyy + dz * dz) / probeM)));
      }
      let eventTh = -1;
      let eventKind: 'air' | 'ground' | null = null;
      let gA = gPrev;
      for (let s = 1; s <= nSub; s++) {
        const thB = s / nSub;
        let gB: number;
        let descB: boolean;
        if (s === nSub) {
          gB = g1;
          descB = this.descendingOf(yNew);
        } else {
          this.hermite(y, k1, yNew, k7, H, thB, yh);
          gB = this.altitudeOf(yh) - this.groundAt(yh);
          descB = this.descendingOf(yh);
        }
        if (fuzeMode === 'proximity' && descB && gA >= fuzeHeightM && gB < fuzeHeightM) {
          eventTh = this.refineRoot(H, (s - 1) / nSub, thB, fuzeHeightM);
          eventKind = 'air';
          break;
        }
        if (gA >= 0.0 && gB < 0.0 && (crestMask || descB)) {
          eventTh = this.refineRoot(H, (s - 1) / nSub, thB, 0.0);
          eventKind = 'ground';
          break;
        }
        gA = gB;
      }

      const tEvent = eventKind ? t + eventTh * H : Number.POSITIVE_INFINITY;

      // Salida densa: muestras en k·outDt dentro del paso (antes del evento).
      if (record) {
        let tk = nextK * outDt;
        while (tk <= t1 + 1e-12 && tk < tEvent) {
          this.hermite(y, k1, yNew, k7, H, (tk - t) / H, yh);
          this.pushSample(out, yh, tk);
          nextK++;
          tk = nextK * outDt;
        }
      }

      if (eventKind) {
        this.hermite(y, k1, yNew, k7, H, eventTh, yh);
        this.pushSample(out, yh, tEvent);
        out.impacted = true;
        this.setImpact(out, yh);
        out.timeOfFlight = tEvent;
        if (eventKind === 'air') {
          out.detonation = 'air';
          out.burstHeightM = this.altitudeOf(yh) - this.groundAt(yh);
        } else if (fuzeMode === 'delay') {
          out.detonation = 'buried';
        }
        y.set(yh);
        done = true;
        break;
      }

      if (fuzeMode === 'time' && hitsBp && tb === fuzeTimeS) {
        // Detonación aérea en t = timeS (el paso aterrizó exactamente ahí).
        if (record && (out.path[out.path.length - 1]?.t ?? -1) !== fuzeTimeS) {
          this.pushSample(out, yNew, fuzeTimeS);
        } else if (!record) {
          this.pushSample(out, yNew, fuzeTimeS);
        }
        out.impacted = true;
        out.detonation = 'air';
        this.setImpact(out, yNew);
        out.timeOfFlight = fuzeTimeS;
        out.burstHeightM = alt1 - this.groundAt(yNew);
        y.set(yNew);
        done = true;
        break;
      }

      // Avance (FSAL: k7 es el k1 del paso siguiente si no cambia la máscara).
      t = t1;
      y.set(yNew);
      k1.set(k7);
      fsalMask = mask;
      gPrev = g1;
      const fac = err === 0 ? 5.0 : Math.min(5.0, Math.max(0.2, 0.9 * Math.pow(err, -0.2)));
      h = hitsBp ? Math.max(h, hTry * fac) : hTry * fac;
    }

    if (!done) {
      // Tope de tiempo.
      const last = out.path[out.path.length - 1];
      if (!record || !last || last.t !== t) this.pushSample(out, y, t);
      this.setImpact(out, y);
      out.timeOfFlight = t;
    }
    out.steps = steps;
  }

  /**
   * Raíz de g(θ) − offset en [a, b] sobre el interpolante del paso en curso
   * (y, k1) → (yNew, k7). Bisección (g(a) ≥ offset > g(b)).
   */
  private refineRoot(H: number, a: number, b: number, offset: number): number {
    const yh = this.yh;
    for (let it = 0; it < 60; it++) {
      const m = 0.5 * (a + b);
      this.hermite(this.y, this.k1, this.yNew, this.k7, H, m, yh);
      const g = this.altitudeOf(yh) - this.groundAt(yh) - offset;
      if (g >= 0.0) a = m; else b = m;
      if (b - a < 1e-13) break;
    }
    return 0.5 * (a + b);
  }

  // ---------------------------------------------------------------------------
  private pushSample(out: FlightResult, y: Float64Array, t: number): void {
    const alt = this.altitudeOf(y);
    const air = this.atmo.sampleInto(alt + this.anchorAlt, this.air);
    this.windAt(y[0], y[1], y[2], t);
    const w = this.w;
    const vrx = y[3] - w[0], vry = y[4] - w[1], vrz = y[5] - w[2];
    const vRelMag = Math.sqrt(vrx * vrx + vry * vry + vrz * vrz);
    const mach = vRelMag / air.soundSpeed;
    let Cd: number;
    if (this.spinMpm) {
      // El HUD ve el mismo Cd que la física (incluido el arrastre de guiñada).
      const ev = this.rhsEvals;
      this.lastCd = this.cd0(mach);
      this.rhs(t, t, y, this.kTmp);
      this.rhsEvals = ev;
      Cd = this.lastCd;
      if (this.lastYaw2 > this.maxYaw2) this.maxYaw2 = this.lastYaw2;
    } else {
      Cd = this.cd0(mach);
      if (this.round.baseBleed.enabled && t < this.round.baseBleed.durationS) {
        Cd *= this.round.baseBleed.dragFactor; // el HUD ve el mismo Cd que la física
      }
    }
    const A = this.refArea;
    const drag = this.cfg.enableDrag ? 0.5 * air.density * Cd * A * vRelMag * vRelMag : 0.0;
    out.path.push({
      t,
      position: this.toEnuPosition(y),
      velocity: this.toEnuVelocity(y),
      mach,
      mass: y[IM],
      drag,
    });
  }
}
