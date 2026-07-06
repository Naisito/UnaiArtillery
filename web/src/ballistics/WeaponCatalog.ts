// ============================================================================
//  WeaponCatalog.ts — Real-world weapon & munition definitions.
//
//  Port of core/WeaponCatalog.h upgraded to the P1.3 drag model: munitions are
//  now defined by a standard drag function (G1/G7) plus a ballistic
//  coefficient, the way real ballistic data is published. The BCs below are
//  CALIBRATED against this solver so each weapon reproduces its published
//  maximum range (see physics tests); treat them as engineering fits, not
//  measured values. Re-calibrated under the ISA-76 atmosphere (P-NEXT.2):
//  the original values held within 0.3% — below 20 km both atmosphere models
//  are identical and that is where almost all the drag happens.
//
//  Each factory also accepts variant 'legacy' returning the original
//  hand-tuned explicit Cd(Mach) curve with every P1 feature off — that is the
//  exact configuration the C++ core validated, and what the TS<->C++ parity
//  tests run against.
// ============================================================================
import { Munition } from './Munition';

export type WeaponId =
  | 'mortar120' | 'm777' | 'm109' | 'pion2s7' | 'excalibur'
  | 'gmlrs' | 'm26' | 'ergmlrs' | 'tacticalMissile' | 'prsm'
  | 'pistol9' | 'rifle556' | 'mg762' | 'm2browning';
export type CatalogVariant = 'bc' | 'legacy';

/** A propellant "charge" (zone): same shell, different muzzle velocity. */
export interface ChargeZone {
  name: string;
  muzzleVelocity: number; // m/s
}

export class Weapon {
  name = '';
  category: 'Mortar' | 'Howitzer' | 'Rocket' | 'Missile' | 'SmallArms' = 'Howitzer';
  minElevationDeg = 0.0;
  maxElevationDeg = 70.0;
  traverseDeg = 360.0;
  reloadTime = 5.0; // s between rounds (rough)
  round = new Munition();
  charges: ChargeZone[] = []; // empty => single fixed velocity
  /**
   * P-PRO.4 — municiones alternativas seleccionables (rounds[0] es la
   * estándar, == round). El panel muestra el selector solo si hay >1.
   */
  rounds?: Munition[];

  clone(): Weapon {
    const w = new Weapon();
    Object.assign(w, this);
    w.round = this.round.clone();
    w.charges = this.charges.map((c) => ({ ...c }));
    w.rounds = this.rounds?.map((r) => r.clone());
    return w;
  }
}

export class WeaponCatalog {
  // ==========================================================================
  //  P-PRO.4 — municiones 155 mm de alcance extendido (compartidas por los
  //  obuses L39: M777 y M109A7). BCs calibrados con tools/calibrate_bc.ts.
  // ==========================================================================

  /** M795E-BB: proyectil base bleed (~28.5 km desde L39). El dragFactor 0.5
   *  es un fit AGREGADO: además de rellenar la depresión del culote (base
   *  drag ~25-35% del total), absorbe la mejora de forma del casco BB frente
   *  al mismo casco sin BB — con él la ganancia on/off queda ~24%, dentro de
   *  la banda publicada (M795 22.5 km → M795E-BB 28.5 km ≈ +27%). */
  static m795BaseBleed(): Munition {
    const m = new Munition();
    m.name = 'M795E-BB (base bleed)';
    m.mass = 46.7;
    m.diameter = 0.155;
    m.muzzleVelocity = 684.0;
    m.warheadMassTNTeq = 10.8; // IMX-101 ~10.8 kg
    m.dragModel = 'G7';
    m.ballisticCoefficient = 4.67; // calibrado: ~28.5 km con BB activo (L39)
    m.spinStabilized = true;
    m.twistCalibers = 20.0;
    m.rightHandTwist = true;
    m.baseBleed = { enabled: true, durationS: 25.0, dragFactor: 0.5 };
    return m;
  }

  /** M549A1 RAP: cohete auxiliar de ~12 kN·s que enciende a los 7 s de vuelo
   *  (~30 km desde L39). */
  static m549Rap(): Munition {
    const m = new Munition();
    m.name = 'M549A1 RAP';
    m.mass = 43.5;
    m.diameter = 0.155;
    m.muzzleVelocity = 684.0;
    m.warheadMassTNTeq = 7.3; // ~6.8 kg Comp-B
    m.dragModel = 'G7';
    m.ballisticCoefficient = 3.43; // calibrado: ~30 km con el motor (L39)
    m.spinStabilized = true;
    m.twistCalibers = 20.0;
    m.rightHandTwist = true;
    m.motor.enabled = true;
    m.motor.thrust = 4000.0;        // N — impulso total ~12 kN·s
    m.motor.burnTime = 3.0;         // s
    m.motor.propellantMass = 5.9;   // kg (Isp ~ 207 s)
    m.motor.ignitionDelayS = 7.0;   // enciende en la fase ascendente
    return m;
  }

  // ---- Light/medium mortar: 120 mm --------------------------------------
  // ~13 kg fin-stabilized bomb, high-angle only, ~7-8 km with top charge.
  static mortar120(variant: CatalogVariant = 'bc'): Weapon {
    const m = new Munition();
    m.name = '120mm HE Bomb';
    m.mass = 13.0;
    m.diameter = 0.12;
    m.muzzleVelocity = 318.0;
    m.warheadMassTNTeq = 2.9;
    if (variant === 'legacy') {
      // Original hand-tuned curve (C++ parity configuration).
      m.dragCurve = [
        { mach: 0.0, cd: 0.14 }, { mach: 0.6, cd: 0.15 }, { mach: 0.9, cd: 0.22 },
        { mach: 1.0, cd: 0.40 }, { mach: 1.2, cd: 0.38 }, { mach: 1.5, cd: 0.33 },
        { mach: 2.0, cd: 0.30 },
      ];
    } else {
      // Blunt fin-stabilized bomb: G1 shape. BC calibrated to ~6.4 km max
      // (tools/calibrate_bc.ts). Fin-stabilized: no spin.
      m.dragModel = 'G1';
      m.ballisticCoefficient = 1.65;
    }
    const w = new Weapon();
    w.name = '120mm Heavy Mortar';
    w.category = 'Mortar';
    w.minElevationDeg = 45.0; // mortars are high-angle weapons
    w.maxElevationDeg = 85.0;
    w.traverseDeg = 12.0;
    w.reloadTime = 4.0;
    w.round = m;
    w.charges = [
      { name: 'Charge 0', muzzleVelocity: 110.0 },
      { name: 'Charge 2', muzzleVelocity: 190.0 },
      { name: 'Charge 4', muzzleVelocity: 265.0 },
      { name: 'Charge 6 (max)', muzzleVelocity: 318.0 },
    ];
    return w;
  }

  // ---- Field howitzer: M777 155 mm ---------------------------------------
  // M107 HE ~43.2 kg, Charge 8 muzzle ~684 m/s, ~24 km max range.
  static m777(variant: CatalogVariant = 'bc'): Weapon {
    const m = new Munition();
    m.name = 'M107 155mm HE';
    m.mass = 43.2;
    m.diameter = 0.155;
    m.muzzleVelocity = 684.0;
    m.warheadMassTNTeq = 6.6;
    if (variant === 'legacy') {
      m.dragCurve = [
        { mach: 0.0, cd: 0.10 }, { mach: 0.7, cd: 0.11 }, { mach: 0.9, cd: 0.15 },
        { mach: 1.0, cd: 0.28 }, { mach: 1.2, cd: 0.26 }, { mach: 2.0, cd: 0.21 },
        { mach: 3.0, cd: 0.18 },
      ];
    } else {
      // Boat-tailed HE shell: G7 shape. BC calibrated to keep the validated
      // ~21 km (this solver's ISA, QE sweep) inside the published 20-28 km
      // (tools/calibrate_bc.ts).
      m.dragModel = 'G7';
      m.ballisticCoefficient = 3.69;
      // P1.2: rifled gun — 1 turn in 20 calibers, right-hand twist.
      m.spinStabilized = true;
      m.twistCalibers = 20.0;
      m.rightHandTwist = true;
    }
    const w = new Weapon();
    w.name = 'M777 155mm Howitzer';
    w.category = 'Howitzer';
    w.minElevationDeg = 0.0;
    w.maxElevationDeg = 71.7;
    w.traverseDeg = 45.0;
    w.reloadTime = 8.0;
    w.round = m;
    w.charges = [
      { name: 'Charge 3', muzzleVelocity: 310.0 },
      { name: 'Charge 5', muzzleVelocity: 470.0 },
      { name: 'Charge 7', muzzleVelocity: 585.0 },
      { name: 'Charge 8 (max)', muzzleVelocity: 684.0 },
    ];
    if (variant !== 'legacy') {
      // P-PRO.4 — munición seleccionable (la legacy queda pura para paridad).
      w.rounds = [m, WeaponCatalog.m795BaseBleed(), WeaponCatalog.m549Rap()];
    }
    return w;
  }

  // ---- Rocket artillery: HIMARS / GMLRS (M31) -----------------------------
  // 227 mm guided rocket, ~307 kg launch, solid motor, ~70+ km range.
  static himarsGMLRS(variant: CatalogVariant = 'bc'): Weapon {
    const m = new Munition();
    m.name = 'GMLRS M31 227mm';
    m.mass = 307.0; // launch mass incl. propellant
    m.diameter = 0.227;
    m.muzzleVelocity = 35.0; // leaves the tube slowly, then accelerates
    m.warheadMassTNTeq = 40.0; // ~90 kg class unitary warhead
    m.motor.enabled = true;
    m.motor.thrust = 66000.0; // N (approx sustained), tuned to ~70 km
    m.motor.burnTime = 4.5; // s
    m.motor.propellantMass = 98.0; // kg expelled during burn
    if (variant === 'legacy') {
      m.dragCurve = [
        { mach: 0.0, cd: 0.20 }, { mach: 0.8, cd: 0.22 }, { mach: 1.0, cd: 0.45 },
        { mach: 1.5, cd: 0.40 }, { mach: 2.5, cd: 0.34 }, { mach: 4.0, cd: 0.30 },
      ];
    } else {
      // Long finned rocket: G7 shape. BC calibrated to hold ~68 km max range
      // (tools/calibrate_bc.ts).
      m.dragModel = 'G7';
      m.ballisticCoefficient = 7.67;
      // P1.5: it is a *guided* rocket — Pro-Nav terminal guidance.
      m.guidance.enabled = true;
      m.guidance.navConstant = 3.5;
      m.guidance.maxLateralG = 8.0;
    }
    const w = new Weapon();
    w.name = 'HIMARS / GMLRS';
    w.category = 'Rocket';
    w.minElevationDeg = 25.0;
    w.maxElevationDeg = 60.0;
    w.traverseDeg = 360.0;
    w.reloadTime = 3.0; // ripple fire between rockets
    w.round = m;
    w.charges = []; // rocket: fixed motor, no charge zones
    return w;
  }

  // ---- Tactical ballistic missile (ATACMS-class) --------------------------
  // Large solid rocket, steep ballistic arc, ~300 km class. Long-range shots
  // should be solved with SolverConfig.sphericalEarth = true (P1.4).
  static tacticalMissile(variant: CatalogVariant = 'bc'): Weapon {
    const m = new Munition();
    m.name = 'Tactical Ballistic Missile';
    m.mass = 1670.0;
    m.diameter = 0.61;
    m.muzzleVelocity = 25.0;
    m.warheadMassTNTeq = 230.0;
    m.motor.enabled = true;
    if (variant === 'legacy') {
      // C++ mirror. NOTE: this motor has an effective exhaust velocity of
      // 7000 m/s (unphysical) and flies ~2000 km — the C++ catalog never
      // validated the missile. Kept verbatim for parity only.
      m.motor.thrust = 350000.0;
      m.motor.burnTime = 18.0;
      m.motor.propellantMass = 900.0;
      m.dragCurve = [
        { mach: 0.0, cd: 0.18 }, { mach: 0.9, cd: 0.20 }, { mach: 1.0, cd: 0.42 },
        { mach: 2.0, cd: 0.32 }, { mach: 4.0, cd: 0.26 }, { mach: 6.0, cd: 0.22 },
      ];
    } else {
      // Solid motor with realistic specific impulse (~Isp 265 s, exhaust
      // velocity ~2600 m/s): dv = 2600*ln(1670/740) ~ 2.1 km/s, leaving
      // ~1.8 km/s after gravity+drag losses — a ~300 km-class ballistic arc.
      // Burn 16 s at ~9 g initial acceleration.
      m.motor.thrust = 151000.0;
      m.motor.burnTime = 16.0;
      m.motor.propellantMass = 930.0;
      m.dragModel = 'G7';
      m.ballisticCoefficient = 11.56; // calibrated with tools/calibrate_bc.ts
      m.guidance.enabled = true;
      m.guidance.navConstant = 3.0;
      m.guidance.maxLateralG = 5.0;
      m.guidance.activationDelay = 5.0; // coast a bit after burnout
    }
    const w = new Weapon();
    w.name = 'Tactical Ballistic Missile';
    w.category = 'Missile';
    w.minElevationDeg = 30.0;
    w.maxElevationDeg = 80.0;
    w.traverseDeg = 360.0;
    w.reloadTime = 20.0;
    w.round = m;
    w.charges = [];
    return w;
  }

  // ==========================================================================
  //  P-NEXT.4 — arsenal ampliado (datos públicos, BC calibrado con
  //  tools/calibrate_bc.ts contra el alcance máximo publicado, ISA-76).
  //  Estas armas solo existen en variante BC (no hay espejo C++ que igualar).
  // ==========================================================================

  // ---- M109A7 Paladin: obús autopropulsado 155 mm/L39 ----------------------
  // Mismo proyectil M107 que el M777; cañón L39 con cargas hasta ~684 m/s.
  // Calibrado a ~24 km (banda publicada del sistema con munición asistida).
  static m109Paladin(): Weapon {
    const m = new Munition();
    m.name = 'M107 155mm HE (L39)';
    m.mass = 43.2;
    m.diameter = 0.155;
    m.muzzleVelocity = 684.0;
    m.warheadMassTNTeq = 6.6;
    m.dragModel = 'G7';
    m.ballisticCoefficient = 5.13; // calibrado: ~24 km
    m.spinStabilized = true;
    m.twistCalibers = 20.0; // estriado 1/20, dextrógiro
    m.rightHandTwist = true;

    const w = new Weapon();
    w.name = 'M109A7 Paladin 155mm';
    w.category = 'Howitzer';
    w.minElevationDeg = 0.0;
    w.maxElevationDeg = 75.0;
    w.traverseDeg = 360.0; // torreta
    w.reloadTime = 7.0;
    w.round = m;
    w.charges = [
      { name: 'Charge 3', muzzleVelocity: 310.0 },
      { name: 'Charge 5', muzzleVelocity: 470.0 },
      { name: 'Charge 7', muzzleVelocity: 585.0 },
      { name: 'Charge 8 (max)', muzzleVelocity: 684.0 },
    ];
    // P-PRO.4 — mismas municiones extendidas que el M777 (ambos L39).
    w.rounds = [m, WeaponCatalog.m795BaseBleed(), WeaponCatalog.m549Rap()];
    return w;
  }

  // ---- 2S7 Pion: cañón pesado 203 mm ---------------------------------------
  // Proyectil OF-43 ~110 kg, v0 ~960 m/s, ~37.5 km sin asistencia.
  static pion2S7(): Weapon {
    const m = new Munition();
    m.name = 'OF-43 203mm HE';
    m.mass = 110.0;
    m.diameter = 0.203;
    m.muzzleVelocity = 960.0;
    m.warheadMassTNTeq = 20.0; // ~17.8 kg de explosivo
    m.dragModel = 'G7';
    m.ballisticCoefficient = 4.58; // calibrado: ~37.5 km
    m.spinStabilized = true;
    m.twistCalibers = 25.0;
    m.rightHandTwist = true;

    const w = new Weapon();
    w.name = '2S7 Pion 203mm';
    w.category = 'Howitzer';
    w.minElevationDeg = 0.0;
    w.maxElevationDeg = 60.0;
    w.traverseDeg = 30.0;
    w.reloadTime = 15.0; // cadencia real ~1.5 disparos/min
    w.round = m;
    w.charges = [
      { name: 'Carga reducida', muzzleVelocity: 550.0 },
      { name: 'Carga intermedia', muzzleVelocity: 760.0 },
      { name: 'Carga plena', muzzleVelocity: 960.0 },
    ];
    return w;
  }

  // ---- M982 Excalibur: 155 mm guiada ---------------------------------------
  // 48 kg, base-bleed + planeo con canards (~40 km desde L39). El planeo no
  // se modela: el BC calibrado lo absorbe (por eso i queda <0.3). Guiado
  // Pro-Nav terminal, CEP <5 m con objetivo marcado.
  static excalibur(): Weapon {
    const m = new Munition();
    m.name = 'M982 Excalibur 155mm';
    m.mass = 48.0;
    m.diameter = 0.155;
    m.muzzleVelocity = 684.0;
    m.warheadMassTNTeq = 10.0; // PBXN-9 ~9.7 kg
    m.dragModel = 'G7';
    m.ballisticCoefficient = 25.0; // calibrado: ~40 km (base-bleed + planeo)
    // Obturador deslizante: sale casi sin giro y vuela con canards.
    m.spinStabilized = false;
    m.guidance.enabled = true;
    m.guidance.navConstant = 3.5;
    m.guidance.maxLateralG = 6.0;

    const w = new Weapon();
    w.name = 'M982 Excalibur (155mm L39)';
    w.category = 'Howitzer';
    w.minElevationDeg = 15.0;
    w.maxElevationDeg = 70.0;
    w.traverseDeg = 45.0;
    w.reloadTime = 8.0;
    w.round = m;
    w.charges = []; // se dispara a carga máxima para el alcance guiado
    return w;
  }

  // ---- M26 MLRS: cohete 227 mm NO guiado ------------------------------------
  // 306 kg al lanzamiento, ~32 km. Protagonista del modo dispersión: sin
  // guiado, la salva de 6 dibuja la elipse sobre el terreno.
  static m26MLRS(): Weapon {
    const m = new Munition();
    m.name = 'M26 227mm (salva)';
    m.mass = 306.0;
    m.diameter = 0.227;
    m.muzzleVelocity = 35.0;
    m.warheadMassTNTeq = 45.0; // 644 submuniciones M77 (~156 kg de carga útil)
    m.motor.enabled = true;
    m.motor.thrust = 58000.0;  // N
    m.motor.burnTime = 3.2;    // s
    m.motor.propellantMass = 98.0;
    m.dragModel = 'G7';
    m.ballisticCoefficient = 9.94; // calibrado: ~32 km
    // Sin guiado: dispersión real de cohete de área.

    const w = new Weapon();
    w.name = 'M270 / M26 MLRS';
    w.category = 'Rocket';
    w.minElevationDeg = 25.0;
    w.maxElevationDeg = 60.0;
    w.traverseDeg = 360.0;
    w.reloadTime = 2.5; // ripple de 6-12 cohetes
    w.round = m;
    w.charges = [];
    return w;
  }

  // ---- ER GMLRS: 227 mm guiado de largo alcance -----------------------------
  // Motor mayor que el GMLRS (~150 km). Modo esférico automático (>50 km).
  static erGMLRS(): Weapon {
    const m = new Munition();
    m.name = 'ER GMLRS 227mm';
    m.mass = 330.0;
    m.diameter = 0.227;
    m.muzzleVelocity = 35.0;
    m.warheadMassTNTeq = 40.0; // cabeza unitaria ~90 kg
    m.motor.enabled = true;
    m.motor.thrust = 70000.0;  // N (Isp ~290 s)
    m.motor.burnTime = 5.5;    // s
    m.motor.propellantMass = 135.0;
    m.dragModel = 'G7';
    m.ballisticCoefficient = 12.53; // calibrado: ~150 km (esférico)
    m.guidance.enabled = true;
    m.guidance.navConstant = 3.5;
    m.guidance.maxLateralG = 8.0;

    const w = new Weapon();
    w.name = 'HIMARS / ER GMLRS';
    w.category = 'Rocket';
    w.minElevationDeg = 25.0;
    w.maxElevationDeg = 60.0;
    w.traverseDeg = 360.0;
    w.reloadTime = 3.0;
    w.round = m;
    w.charges = [];
    return w;
  }

  // ---- PrSM (clase): misil táctico ~500 km ----------------------------------
  // Sucesor del ATACMS (2 por pod, más esbelto). Isp ~310 s, dv ~2.9 km/s.
  static prsm(): Weapon {
    const m = new Munition();
    m.name = 'PrSM (clase 500 km)';
    m.mass = 1400.0;
    m.diameter = 0.43;
    m.muzzleVelocity = 25.0;
    m.warheadMassTNTeq = 200.0;
    m.motor.enabled = true;
    m.motor.thrust = 120000.0; // N (Isp ~306 s, dv ≈ 2.5 km/s)
    m.motor.burnTime = 20.0;   // s
    m.motor.propellantMass = 800.0;
    m.dragModel = 'G7';
    m.ballisticCoefficient = 14.02; // calibrado: ~500 km (esférico)
    m.guidance.enabled = true;
    m.guidance.navConstant = 3.0;
    m.guidance.maxLateralG = 5.0;
    m.guidance.activationDelay = 5.0;

    const w = new Weapon();
    w.name = 'PrSM (clase)';
    w.category = 'Missile';
    w.minElevationDeg = 30.0;
    w.maxElevationDeg = 80.0;
    w.traverseDeg = 360.0;
    w.reloadTime = 25.0;
    w.round = m;
    w.charges = [];
    return w;
  }


  // ==========================================================================
  //  Armas de mano y ametralladoras — misma física, otra escala.
  //  A diferencia de la artillería (BC ajustados al alcance publicado), los
  //  BC de armas ligeras SÍ están medidos y publicados (Litz/fabricantes) en
  //  lb/in², exactamente las unidades del solver: aquí no se calibra nada.
  //  Los factores de forma salen 0.97-1.17, como deben. Sin carga explosiva:
  //  warheadMassTNTeq ~0 (impacto = polvareda, sin cráter).
  // ==========================================================================

  private static smallArm(opts: {
    name: string; roundName: string; massKg: number; diameterM: number;
    v0: number; dragModel: 'G1' | 'G7'; bc: number; twistCalibers: number;
    maxElevationDeg: number; reloadTime: number;
  }): Weapon {
    const m = new Munition();
    m.name = opts.roundName;
    m.mass = opts.massKg;
    m.diameter = opts.diameterM;
    m.muzzleVelocity = opts.v0;
    m.warheadMassTNTeq = 0.001; // bala: sin explosivo (VFX mínimo, sin cráter)
    m.dragModel = opts.dragModel;
    m.ballisticCoefficient = opts.bc; // PUBLICADO, no calibrado
    m.spinStabilized = true;
    m.twistCalibers = opts.twistCalibers;
    m.rightHandTwist = true;

    const w = new Weapon();
    w.name = opts.name;
    w.category = 'SmallArms';
    w.minElevationDeg = 0.0;
    w.maxElevationDeg = opts.maxElevationDeg;
    w.traverseDeg = 360.0;
    w.reloadTime = opts.reloadTime;
    w.round = m;
    w.charges = [];
    return w;
  }

  /** Pistola 9×19 mm (124 gr FMJ, G1 0.145 publicado). Alcance máx ~1.7 km. */
  static pistol9(): Weapon {
    return WeaponCatalog.smallArm({
      name: 'Pistola 9mm', roundName: '9×19 mm FMJ 124 gr',
      massKg: 0.00804, diameterM: 0.00901, v0: 360,
      dragModel: 'G1', bc: 0.145,
      twistCalibers: 28, // 1:10" en calibre .355
      maxElevationDeg: 45, reloadTime: 0.5,
    });
  }

  /** Fusil 5.56×45 NATO (M855 62 gr, G7 0.151 medido). Alcance máx ~3.6 km. */
  static rifle556(): Weapon {
    return WeaponCatalog.smallArm({
      name: 'Fusil 5.56 NATO', roundName: '5.56×45 M855 62 gr',
      massKg: 0.00402, diameterM: 0.0057, v0: 920,
      dragModel: 'G7', bc: 0.151,
      twistCalibers: 31, // 1:7" en calibre .224
      maxElevationDeg: 50, reloadTime: 0.15,
    });
  }

  /** Ametralladora 7.62×51 NATO (M80 147 gr, G7 0.195). Alcance máx ~4 km. */
  static mg762(): Weapon {
    return WeaponCatalog.smallArm({
      name: 'M240 · AMT 7.62 NATO', roundName: '7.62×51 M80 147 gr',
      massKg: 0.00952, diameterM: 0.00782, v0: 850,
      dragModel: 'G7', bc: 0.195,
      twistCalibers: 39, // 1:12" en calibre .308
      maxElevationDeg: 60, reloadTime: 0.12,
    });
  }

  /** M2 Browning 12.7×99 (.50 M33 660 gr, G7 0.35). Alcance máx ~6.8 km. */
  static m2browning(): Weapon {
    return WeaponCatalog.smallArm({
      name: 'M2 Browning · .50 BMG', roundName: '12.7×99 M33 660 gr',
      massKg: 0.0429, diameterM: 0.01295, v0: 890,
      dragModel: 'G7', bc: 0.35,
      twistCalibers: 29, // 1:15" en calibre .510
      maxElevationDeg: 60, reloadTime: 0.12,
    });
  }

  static get(id: WeaponId, variant: CatalogVariant = 'bc'): Weapon {
    switch (id) {
      case 'mortar120': return WeaponCatalog.mortar120(variant);
      case 'm777': return WeaponCatalog.m777(variant);
      case 'm109': return WeaponCatalog.m109Paladin();
      case 'pion2s7': return WeaponCatalog.pion2S7();
      case 'excalibur': return WeaponCatalog.excalibur();
      case 'gmlrs': return WeaponCatalog.himarsGMLRS(variant);
      case 'm26': return WeaponCatalog.m26MLRS();
      case 'ergmlrs': return WeaponCatalog.erGMLRS();
      case 'tacticalMissile': return WeaponCatalog.tacticalMissile(variant);
      case 'prsm': return WeaponCatalog.prsm();
      case 'pistol9': return WeaponCatalog.pistol9();
      case 'rifle556': return WeaponCatalog.rifle556();
      case 'mg762': return WeaponCatalog.mg762();
      case 'm2browning': return WeaponCatalog.m2browning();
    }
  }

  static all(variant: CatalogVariant = 'bc'): Weapon[] {
    return WeaponCatalog.ids().map((id) => WeaponCatalog.get(id, variant));
  }

  static ids(): WeaponId[] {
    return [
      'mortar120', 'm777', 'm109', 'pion2s7', 'excalibur',
      'gmlrs', 'm26', 'ergmlrs', 'tacticalMissile', 'prsm',
      'pistol9', 'rifle556', 'mg762', 'm2browning',
    ];
  }
}
