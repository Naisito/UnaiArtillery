// ============================================================================
//  golden.test.ts — Regresión BIT A BIT del integrador RK4 de paso fijo.
//  [V2 · PHYS]
//
//  La optimización del solver (estado escalar, cero asignaciones en el bucle
//  caliente, sin cierres por paso) NO puede mover ni un bit la integración
//  clásica: la paridad con el núcleo C++ y todos los números validados
//  dependen de ello. `golden.json` se capturó con el solver ANTERIOR a la
//  optimización (Vec3 inmutable) sobre un abanico de escenarios que toca cada
//  término: arrastre explícito/G1/G7, Coriolis, viento constante/Ekman/perfil,
//  spin simple + Magnus, motor (y RAP con retardo), base bleed, guiado
//  Pro-Nav, Tierra esférica ECEF, terreno 2D con máscara de cresta,
//  espoletas de tiempo/proximidad/retardo, vacío, decimación y salva
//  dispersa. Cada escenario compara con `toBe` (igualdad exacta IEEE-754)
//  el punto de impacto, TOF, ápice, alcance, Mach máx., nº de evaluaciones y
//  sumas de control del camino completo.
//
//  Las municiones se definen AQUÍ (no desde el catálogo), para que la
//  auditoría de datos del catálogo no invalide la referencia del integrador.
//
//  Re-captura (solo si se cambia la física A PROPÓSITO):
//      GOLDEN_CAPTURE=1 npx vitest run src/ballistics/golden.test.ts
//  y pegar la salida en golden.json.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { BallisticsSolver, FlightResult, SolverConfig } from './BallisticsSolver';
import { Munition } from './Munition';
import { Vec3 } from './Vec3';
import { Weapon, WeaponCatalog } from './WeaponCatalog';
import { FuzeSpec, WeaponSystem } from './WeaponSystem';
import { buildTerrain, windFieldOf } from './WorkerProtocol';
import { existsSync, readFileSync } from 'node:fs';

interface Digest {
  ix: number; iy: number; iz: number;
  speed: number; tof: number; apex: number; downrange: number; maxMach: number;
  n: number; rhs: number; det: string; burst: number;
  sumPos: number; sumVel: number; sumMach: number; sumDrag: number; sumMass: number;
}

function digest(fr: FlightResult): Digest {
  let sumPos = 0, sumVel = 0, sumMach = 0, sumDrag = 0, sumMass = 0;
  for (const s of fr.path) {
    sumPos += s.position.x + s.position.y + s.position.z;
    sumVel += s.velocity.x + s.velocity.y + s.velocity.z;
    sumMach += s.mach;
    sumDrag += s.drag;
    sumMass += s.mass;
  }
  return {
    ix: fr.impactPoint.x, iy: fr.impactPoint.y, iz: fr.impactPoint.z,
    speed: fr.impactSpeed, tof: fr.timeOfFlight, apex: fr.apex, downrange: fr.downrange,
    maxMach: fr.maxMach, n: fr.path.length, rhs: fr.rhsEvaluations,
    det: fr.detonation, burst: fr.burstHeightM,
    sumPos, sumVel, sumMach, sumDrag, sumMass,
  };
}

// ---- Municiones de referencia (valores del catálogo previo a V2) -----------
function m107bc(): Munition {
  const m = new Munition();
  m.name = 'M107 ref';
  m.mass = 43.2; m.diameter = 0.155; m.muzzleVelocity = 684.0;
  m.dragModel = 'G7'; m.ballisticCoefficient = 3.69;
  m.spinStabilized = true; m.twistCalibers = 20.0; m.rightHandTwist = true;
  return m;
}
function rapRef(): Munition {
  const m = m107bc();
  m.mass = 43.5; m.ballisticCoefficient = 3.43;
  m.motor.enabled = true; m.motor.thrust = 4000; m.motor.burnTime = 3.0;
  m.motor.propellantMass = 5.9; m.motor.ignitionDelayS = 7.0;
  return m;
}
function bbRef(): Munition {
  const m = m107bc();
  m.mass = 46.7; m.ballisticCoefficient = 4.67;
  m.baseBleed = { enabled: true, durationS: 25.0, dragFactor: 0.5 };
  return m;
}
function gmlrsRef(): Munition {
  const m = new Munition();
  m.mass = 307; m.diameter = 0.227; m.muzzleVelocity = 35;
  m.motor.enabled = true; m.motor.thrust = 66000; m.motor.burnTime = 4.5; m.motor.propellantMass = 98;
  m.dragModel = 'G7'; m.ballisticCoefficient = 7.67;
  m.guidance.enabled = true; m.guidance.navConstant = 3.5; m.guidance.maxLateralG = 8;
  return m;
}
function prsmRef(): Munition {
  const m = new Munition();
  m.mass = 1400; m.diameter = 0.43; m.muzzleVelocity = 25;
  m.motor.enabled = true; m.motor.thrust = 120000; m.motor.burnTime = 20; m.motor.propellantMass = 800;
  m.dragModel = 'G7'; m.ballisticCoefficient = 14.02;
  m.guidance.enabled = true; m.guidance.navConstant = 3.0; m.guidance.maxLateralG = 5;
  m.guidance.activationDelay = 5;
  return m;
}
function mortarRef(): Munition {
  const m = new Munition();
  m.mass = 13.0; m.diameter = 0.12; m.muzzleVelocity = 318;
  m.dragModel = 'G1'; m.ballisticCoefficient = 1.65;
  return m;
}
function rifleRef(): Munition {
  const m = new Munition();
  m.mass = 0.00402; m.diameter = 0.0057; m.muzzleVelocity = 920;
  m.dragModel = 'G7'; m.ballisticCoefficient = 0.151;
  m.spinStabilized = true; m.twistCalibers = 31; m.rightHandTwist = true;
  return m;
}

const RIDGE = buildTerrain({
  dirE: 1, dirN: 0, stepAlongM: 400, rows: 5, stepCrossM: 500, halfWidthM: 1000,
  profile: Array.from({ length: 5 * 90 }, (_, k) => {
    const i = k % 90, j = Math.floor(k / 90);
    return 60 * Math.sin(i / 7) ** 2 + 15 * (j - 2) - (i >= 30 && i <= 33 ? -350 : 0);
  }),
});

function isa76Wind(): Atmosphere {
  const a = new Atmosphere();
  a.seaLevelTemperatureK = 293.15;
  a.seaLevelPressurePa = 100500;
  a.windField = windFieldOf({ kind: 'steady', speedMS: 7, fromBearingDeg: 230, ekman: true });
  return a;
}

function shot(
  atmo: Atmosphere, cfg: Partial<SolverConfig>, m: Munition, az: number, el: number,
  opts: { target?: Vec3; fuze?: FuzeSpec; muzzle?: Vec3 } = {},
): FlightResult {
  const solver = new BallisticsSolver(atmo, SolverConfig.with(cfg));
  const v = WeaponSystem.launchVelocity(az, el, m.muzzleVelocity);
  return solver.integrate(m, opts.muzzle ?? new Vec3(), v, opts.target, opts.fuze);
}

const SCENARIOS: Record<string, () => Digest | Digest[]> = {
  legacyM777: () => {
    const w = WeaponCatalog.m777('legacy');
    return digest(shot(Atmosphere.legacyTwoLayer(), { dt: 0.005, latitudeDeg: 40 }, w.round, 90, 45));
  },
  legacyMortar: () => {
    const w = WeaponCatalog.mortar120('legacy');
    return digest(shot(Atmosphere.legacyTwoLayer(), { dt: 0.005 }, w.round, 10, 60));
  },
  legacyGmlrs: () => {
    const w = WeaponCatalog.himarsGMLRS('legacy');
    return digest(shot(Atmosphere.legacyTwoLayer(), { dt: 0.005 }, w.round, 90, 45));
  },
  legacyMissileSpherical: () => {
    const w = WeaponCatalog.tacticalMissile('legacy');
    return digest(shot(
      Atmosphere.legacyTwoLayer(),
      { dt: 0.02, maxFlight: 300, sphericalEarth: true, latitudeDeg: 40, anchorLonDeg: -3.9 },
      w.round, 90, 60,
    ));
  },
  m107SpinWindAnchor: () =>
    digest(shot(isa76Wind(), { dt: 0.005, latitudeDeg: 40.75, anchorAltitudeM: 1200 }, m107bc(), 60, 45)),
  m107HighAngle: () =>
    digest(shot(new Atmosphere(), { dt: 0.005, latitudeDeg: 40.75 }, m107bc(), 200, 68)),
  rapDelayed: () => digest(shot(new Atmosphere(), { dt: 0.005 }, rapRef(), 90, 45)),
  baseBleed: () => digest(shot(new Atmosphere(), { dt: 0.005 }, bbRef(), 90, 45)),
  gmlrsGuided: () =>
    digest(shot(new Atmosphere(), { dt: 0.005, latitudeDeg: 40 }, gmlrsRef(), 90, 40,
      { target: new Vec3(52000, 300, 0) })),
  prsmSpherical: () =>
    digest(shot(new Atmosphere(),
      { dt: 0.02, maxFlight: 900, sphericalEarth: true, latitudeDeg: 40, anchorLonDeg: -3.9 },
      prsmRef(), 90, 62, { target: new Vec3(480000, 0, 0) })),
  terrainCrest: () =>
    digest(shot(isa76Wind(), { dt: 0.005, terrainHeight: RIDGE }, m107bc(), 90, 9,
      { muzzle: new Vec3(0, 0, 3) })),
  terrainLong: () =>
    digest(shot(isa76Wind(), { dt: 0.01, terrainHeight: RIDGE, maxFlight: 700 }, m107bc(), 90, 40,
      { muzzle: new Vec3(0, 0, 3) })),
  fuzeTime: () =>
    digest(shot(new Atmosphere(), { dt: 0.005 }, m107bc(), 90, 45, { fuze: { mode: 'time', timeS: 31.37 } })),
  fuzeProximity: () =>
    digest(shot(new Atmosphere(), { dt: 0.005, terrainHeight: RIDGE }, m107bc(), 90, 45,
      { fuze: { mode: 'proximity', heightM: 9 } })),
  fuzeDelay: () =>
    digest(shot(new Atmosphere(), { dt: 0.005 }, mortarRef(), 0, 55, { fuze: { mode: 'delay' } })),
  windProfile: () => {
    const a = new Atmosphere();
    a.setWindProfile([
      { altitudeM: 0, speedMS: 4, fromBearingDeg: 270 },
      { altitudeM: 3000, speedMS: 12, fromBearingDeg: 210 },
      { altitudeM: 6000, speedMS: 18, fromBearingDeg: 180 },
    ]);
    return digest(shot(a, { dt: 0.005, enableCoriolis: false }, m107bc(), 0, 45));
  },
  vacuum: () => digest(shot(new Atmosphere(), { dt: 0.002, enableDrag: false }, m107bc(), 90, 30)),
  decimated: () => digest(shot(new Atmosphere(), { dt: 0.005, sampleEvery: 4 }, mortarRef(), 0, 70)),
  rifle: () => digest(shot(new Atmosphere(), { dt: 0.001 }, rifleRef(), 45, 30)),
  dispersedSalvo: () => {
    const w = new Weapon();
    w.minElevationDeg = 0; w.maxElevationDeg = 70; w.round = m107bc();
    w.charges = [{ name: 'c', muzzleVelocity: 684 }];
    const fc = new WeaponSystem(isa76Wind(), SolverConfig.with({ dt: 0.01 }));
    const res = fc.fireDispersed(
      w, new Vec3(0, 0, 3), { azimuthDeg: 30, elevationDeg: 30, chargeIndex: 0 }, 5,
      { muzzleVelocityStd: 2, azimuthStdMils: 1, elevationStdMils: 1, windStd: 0.8, muzzleVelocityBias: 1 },
      77, true,
    );
    return res.flights!.map(digest);
  },
};

const capture = typeof process !== 'undefined' && process.env.GOLDEN_CAPTURE === '1';

describe('golden — RK4 de paso fijo bit a bit idéntico al solver previo', () => {
  if (capture) {
    it('captura', () => {
      const out: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(SCENARIOS)) out[k] = f();
      console.log('GOLDEN_JSON_BEGIN' + JSON.stringify(out) + 'GOLDEN_JSON_END');
    });
    return;
  }
  const url = new URL('./golden.json', import.meta.url);
  const ref = (existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : {}) as Record<
    string, Digest | Digest[]
  >;
  for (const [name, f] of Object.entries(SCENARIOS)) {
    it(name, () => {
      expect(ref[name]).toBeDefined();
      expect(f()).toStrictEqual(ref[name]);
    });
  }
});
