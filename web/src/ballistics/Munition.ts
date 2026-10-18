// ============================================================================
//  Munition.ts — Physical description of a projectile / round.
//
//  Port of core/Munition.h extended with the P1 fidelity features. All the new
//  features default OFF so a default-constructed Munition behaves exactly like
//  the validated C++ core (the parity tests in validation.test.ts rely on it).
//
//  Drag model (P1.3)
//  -----------------
//  Three ways to define Cd(Mach):
//    * 'explicit' — a hand-tuned table Cd(Mach) (the original core model).
//    * 'G1'/'G7'  — a standard reference drag table scaled by the ballistic
//                   coefficient: Cd(M) = i * Cd_ref(M), i = SD / BC.
//
//  Spin (P1.2) and guidance (P1.5) are consumed by BallisticsSolver.
// ============================================================================
import { G1_TABLE, G7_TABLE, sampleDragTable, sectionalDensityLbIn2 } from './DragTables';

/** One point of a drag curve: Cd measured at a given Mach number. */
export interface DragPoint { mach: number; cd: number; }

export type DragModel = 'explicit' | 'G1' | 'G7';

/** Optional rocket-motor description (thrust phase for MLRS / missiles). */
export class RocketMotor {
  enabled = false;
  thrust = 0.0;         // N, along the velocity vector while burning
  burnTime = 0.0;       // s
  propellantMass = 0.0; // kg expelled linearly over burnTime
  /**
   * P-PRO.4 — RAP: el motor enciende este tiempo DESPUÉS del disparo (s).
   * El empuje va de ignitionDelayS a ignitionDelayS + burnTime. Con 0 la
   * integración es bit a bit idéntica al modelo anterior.
   */
  ignitionDelayS = 0.0;

  clone(): RocketMotor {
    const m = new RocketMotor();
    Object.assign(m, this);
    return m;
  }
}

/**
 * P-PRO.4 — base bleed: un generador de gas rellena la depresión del culote
 * y reduce el arrastre de base mientras quema. Se modela como un único factor
 * sobre Cd durante durationS (0.75 es un fit razonable: el base drag es
 * ~25-35% del total en supersónico y el BB elimina la mayor parte).
 */
export interface BaseBleedSpec {
  enabled: boolean;
  durationS: number;   // s de quemado del generador de gas
  dragFactor: number;  // Cd_efectivo = dragFactor·Cd mientras t < durationS
}

/**
 * V2 · PHYS — datos del modelo de PUNTO-MASA MODIFICADO (STANAG 4355,
 * McCoy cap. 9) de un proyectil estabilizado por giro. Con ellos el solver
 * integra el spin p(t) con su amortiguamiento, calcula la guiñada de reposo
 * de equilibrio giroscópico y de ella la sustentación, la fuerza Magnus y el
 * arrastre inducido por guiñada (ver BallisticsSolver y FISICA_WEB.md).
 * Tablas paralelas a `mach` (interpolación lineal, extremos clampados).
 */
export interface SpinAero {
  /** Momento de inercia axial I_x (kg·m²). */
  ixKgM2: number;
  /** Momento de inercia transversal I_y (kg·m²): factor de estabilidad Sg. */
  iyKgM2: number;
  /** Nodos de Mach ascendentes. */
  mach: number[];
  /** C_Lα — pendiente de la fuerza de sustentación (1/rad). */
  cla: number[];
  /** C_Mα — momento de vuelco (1/rad; > 0 = estáticamente inestable). */
  cma: number[];
  /** C_Npα — fuerza Magnus (1/rad), convención STANAG/McCoy. */
  cnpa: number[];
  /** C_lp — amortiguamiento del giro (< 0). */
  clp: number[];
  /** C_Dδ² — arrastre inducido por la guiñada (1/rad²). */
  cda2: number[];
  /** Factor de ajuste de la sustentación f_L (STANAG; default 1). */
  fL?: number;
  /** Factor de ajuste del arrastre de guiñada Q_D (default 1). */
  qD?: number;
  /** Factor de ajuste de la fuerza Magnus Q_M (default 1). */
  qM?: number;
  /** Tope de |α_R| (rad): validez del modelo lineal. Default 0.30 (~17°). */
  maxYawRad?: number;
  /** Procedencia de los datos (para el informe/la UI). */
  source?: string;
}

/** P1.5 — terminal guidance (proportional navigation) parameters. */
export class GuidanceSpec {
  enabled = false;
  /** Navigation constant N (classic Pro-Nav uses 3..5). */
  navConstant = 3.5;
  /** Lateral acceleration limit, in g. Real GMLRS-class rounds pull ~5-10 g. */
  maxLateralG = 8.0;
  /** Guidance engages only after motor burnout (plus this extra delay, s). */
  activationDelay = 0.0;
  /**
   * Engage only in the terminal (descending) phase. Pro-Nav pointed at a
   * ground target during the ascent would dive early and wreck the arc; real
   * GMLRS-class rounds fly a shaped midcourse and steer hard near the end.
   */
  terminalOnly = true;

  clone(): GuidanceSpec {
    const g = new GuidanceSpec();
    Object.assign(g, this);
    return g;
  }
}

export class Munition {
  name = 'Generic';
  mass = 43.2;            // kg (initial, incl. propellant if rocket)
  diameter = 0.155;       // m (caliber) -> reference area
  muzzleVelocity = 684.0; // m/s at the gun (0 for pure rockets)

  // -- Drag ------------------------------------------------------------------
  dragModel: DragModel = 'explicit';
  /**
   * Ballistic coefficient in lb/in^2 (the units BCs are published in), used
   * when dragModel is 'G1' or 'G7'.
   */
  ballisticCoefficient = 1.0;
  /**
   * Mach-dependent explicit drag table, ordered by ascending Mach; values
   * outside clamp to the end points. Defaults approximate a modern spin-
   * stabilized HE shell. Used when dragModel === 'explicit'.
   */
  dragCurve: DragPoint[] = [
    { mach: 0.0, cd: 0.14 }, { mach: 0.7, cd: 0.15 }, { mach: 0.9, cd: 0.20 },
    { mach: 1.0, cd: 0.36 }, { mach: 1.2, cd: 0.34 }, { mach: 2.0, cd: 0.29 },
    { mach: 3.0, cd: 0.26 }, { mach: 5.0, cd: 0.24 },
  ];

  motor = new RocketMotor();

  // -- P-PRO.4: base bleed -----------------------------------------------------
  baseBleed: BaseBleedSpec = { enabled: false, durationS: 25.0, dragFactor: 0.75 };

  // -- P1.2: spin ------------------------------------------------------------
  /** Spin-stabilized (rifled) round: enables gyroscopic drift + Magnus. */
  spinStabilized = false;
  /** Rifling twist: one turn per this many calibers (e.g. 20 for 155mm guns). */
  twistCalibers = 20.0;
  /** Right-hand twist drifts right; left-hand twist drifts left. */
  rightHandTwist = true;
  /**
   * Lumped yaw-of-repose drift coefficient (dimensionless). Absorbs the axial
   * inertia, overturning-moment and lift coefficients of the full 6-DOF
   * treatment into one calibration constant; 0.008 lands a 155mm shell ~0.2%
   * of range to the right at 20 km, matching firing-table drift columns.
   */
  spinDriftCoeff = 0.008;
  /** Magnus force coefficient (dimensionless, small; matters with crosswind). */
  magnusCoeff = 0.25;
  /** Spin decays as exp(-t/tau); shells keep most spin over a full flight. */
  spinDecayTau = 80.0;
  /**
   * V2 · PHYS — datos MPM (STANAG 4355). Presentes => con
   * `SolverConfig.spinModel` 'auto' (default) o 'mpm' el solver usa el
   * punto-masa modificado en vez de la deriva simplificada de P1.2.
   */
  aero?: SpinAero;

  // -- P1.5: guidance ----------------------------------------------------------
  guidance = new GuidanceSpec();

  // -- Warhead / payload (drives VFX & camera shake, not trajectory) ----------
  warheadMassTNTeq = 6.6; // kg TNT-equivalent for explosion scaling
  fuzeDelay = 0.0;        // s after impact (0 = point detonation)
  /**
   * P-VIVO.8 — carga de misión: 'he' explota (default), 'illum' despliega
   * una bengala con paracaídas al detonar la espoleta de tiempo y 'smoke'
   * levanta una cortina persistente al impactar. SOLO presentación: la
   * trayectoria integra la misma masa/BC.
   */
  payload: 'he' | 'illum' | 'smoke' = 'he';

  /** Cross-sectional reference area A = pi * (d/2)^2. */
  referenceArea(): number {
    const r = 0.5 * this.diameter;
    return Math.PI * r * r;
  }

  /** Cd(Mach) — explicit table or BC-scaled standard drag function. */
  dragCoefficient(mach: number): number {
    if (this.dragModel === 'G1' || this.dragModel === 'G7') {
      const table = this.dragModel === 'G1' ? G1_TABLE : G7_TABLE;
      const i = sectionalDensityLbIn2(this.mass, this.diameter) / this.ballisticCoefficient;
      return i * sampleDragTable(table, mach);
    }
    const curve = this.dragCurve;
    if (curve.length === 0) return 0.3;
    if (mach <= curve[0].mach) return curve[0].cd;
    if (mach >= curve[curve.length - 1].mach) return curve[curve.length - 1].cd;
    for (let i = 1; i < curve.length; i++) {
      if (mach <= curve[i].mach) {
        const a = curve[i - 1];
        const b = curve[i];
        const t = (mach - a.mach) / (b.mach - a.mach);
        return a.cd + t * (b.cd - a.cd);
      }
    }
    return curve[curve.length - 1].cd;
  }

  /** Form factor i = SD/BC (informative; only meaningful for G1/G7 rounds). */
  formFactor(): number {
    return sectionalDensityLbIn2(this.mass, this.diameter) / this.ballisticCoefficient;
  }

  clone(): Munition {
    const m = new Munition();
    Object.assign(m, this);
    m.dragCurve = this.dragCurve.map((p) => ({ ...p }));
    m.motor = this.motor.clone();
    m.guidance = this.guidance.clone();
    m.baseBleed = { ...this.baseBleed };
    if (this.aero) m.aero = { ...this.aero };
    return m;
  }
}
