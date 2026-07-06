// ============================================================================
//  fidelity.test.ts — P1 physics-fidelity + P2.2/P4.3 fire-control features.
//
//  Runs on the BC-based catalog (the production one). Covers:
//    P1.3  G1/G7 + ballistic coefficient: ranges stay in the published bands.
//    P1.2  Spin drift (right for right-hand twist, tens of meters at ~20 km)
//          and Magnus term sanity.
//    P1.7  Altitude wind profile with shear vs equivalent constant wind.
//    P1.6  Deterministic Monte-Carlo dispersion + CEP monotonic in V0 error.
//    P1.4  Spherical-Earth (ECEF) mode: ~300 km missile + flat/spherical
//          divergence growing with range.
//    P1.5  Pro-Nav terminal guidance: guided lands <5 m where ballistic
//          misses >100 m.
//    P2.2  MRSI: several rounds impact within <0.2 s.
//    P4.3  Firing-table generator coherent with the fire-control solver.
//    P0.1  Warhead yield rides inside FlightResult.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { BallisticsSolver, SolverConfig } from './BallisticsSolver';
import { Vec3 } from './Vec3';
import { Weapon, WeaponCatalog } from './WeaponCatalog';
import { WeaponSystem } from './WeaponSystem';
import { firingTableCSV, generateFiringTable } from './FiringTables';

function maxRange(w: Weapon, chargeIndex: number, spherical = false, maxFlight = 400, dt = 0.005): number {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({
    dt, enableCoriolis: true, latitudeDeg: 40.0, sphericalEarth: spherical, maxFlight,
  });
  const fc = new WeaponSystem(atmo, cfg);
  const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex });
  let best = 0.0;
  for (let el = w.minElevationDeg; el <= w.maxElevationDeg; el += 1.0) {
    best = Math.max(best, fc.rangeForElevation(w, new Vec3(), 90.0, v0, el));
  }
  return best;
}

// ---------------------------------------------------------------------------
describe('P-NEXT.2 — US Standard Atmosphere 1976 (86 km)', () => {
  it('density matches the published USSA-76 table at 20/32/47/71 km (±2%)', () => {
    // Geometric-altitude table values (the layers are defined in geopotential
    // height; the backlog quoted 1.43e-3 / 6.42e-5 for 47/71 km, which are the
    // geopotential-table entries — these are their geometric equivalents).
    const published: [number, number][] = [
      [20000, 8.891e-2],
      [32000, 1.3555e-2],
      [47000, 1.4973e-3],
      [71000, 7.1963e-5],
    ];
    const atmo = new Atmosphere();
    for (const [z, rho] of published) {
      expect(Math.abs(atmo.densityAt(z) - rho) / rho).toBeLessThan(0.02);
    }
  });

  it('extra published anchors: 30/40/50/86 km and the exponential tail', () => {
    const atmo = new Atmosphere();
    expect(Math.abs(atmo.densityAt(30000) - 1.841e-2) / 1.841e-2).toBeLessThan(0.02);
    expect(Math.abs(atmo.densityAt(40000) - 3.996e-3) / 3.996e-3).toBeLessThan(0.02);
    expect(Math.abs(atmo.densityAt(50000) - 1.0269e-3) / 1.0269e-3).toBeLessThan(0.02);
    expect(Math.abs(atmo.densityAt(86000) - 6.958e-6) / 6.958e-6).toBeLessThan(0.02);
    // Above the tabulated top the tail keeps decaying smoothly.
    const r90 = atmo.densityAt(90000);
    const r100 = atmo.densityAt(100000);
    expect(r90).toBeLessThan(atmo.densityAt(86000));
    expect(r100).toBeLessThan(r90);
    expect(r100).toBeGreaterThan(0);
  });

  it('sea-level knobs shift the whole column; legacy 2-layer stays available', () => {
    const hot = new Atmosphere();
    hot.seaLevelTemperatureK = 288.15 + 15;
    expect(hot.sample(0).temperature).toBeCloseTo(303.15, 6);
    expect(hot.sample(30000).temperature).toBeGreaterThan(new Atmosphere().sample(30000).temperature);
    expect(hot.densityAt(0)).toBeLessThan(1.225); // hot air is thinner

    // Below 20 km both models agree (same physics)...
    const isa76 = new Atmosphere();
    const isa2 = Atmosphere.legacyTwoLayer();
    expect(Math.abs(isa2.densityAt(10000) - isa76.densityAt(10000)) / isa2.densityAt(10000)).toBeLessThan(0.01);
    // ...above it the legacy extrapolation is far too thin (that was the bug).
    expect(isa2.densityAt(70000)).toBeLessThan(isa76.densityAt(70000) * 0.5);
  });
});

// ---------------------------------------------------------------------------
describe('P1.3 — G1/G7 drag + ballistic coefficient', () => {
  it('BC-defined mortar stays in the published 5.5-9 km band', () => {
    const w = WeaponCatalog.mortar120();
    expect(w.round.dragModel).toBe('G1');
    const r = maxRange(w, w.charges.length - 1);
    expect(r).toBeGreaterThan(5500);
    expect(r).toBeLessThan(9000);
  });

  it('BC-defined M777 stays in the published 20-28 km band', () => {
    const w = WeaponCatalog.m777();
    expect(w.round.dragModel).toBe('G7');
    const r = maxRange(w, w.charges.length - 1);
    expect(r).toBeGreaterThan(20000);
    expect(r).toBeLessThan(28000);
  });

  it('BC-defined GMLRS stays in the published 45-90 km band', () => {
    const w = WeaponCatalog.himarsGMLRS();
    expect(w.round.dragModel).toBe('G7');
    const r = maxRange(w, -1);
    expect(r).toBeGreaterThan(45000);
    expect(r).toBeLessThan(90000);
  });

  it('form factors i = SD/BC are physically plausible (0.3..1.5)', () => {
    for (const w of [WeaponCatalog.mortar120(), WeaponCatalog.m777(), WeaponCatalog.himarsGMLRS()]) {
      const i = w.round.formFactor();
      expect(i).toBeGreaterThan(0.3);
      expect(i).toBeLessThan(1.5);
    }
  });
});

// ---------------------------------------------------------------------------
describe('P-NEXT.4 — arsenal ampliado (banda ±20% del alcance publicado)', () => {
  const inBand = (r: number, publishedM: number) => {
    expect(r).toBeGreaterThan(publishedM * 0.8);
    expect(r).toBeLessThan(publishedM * 1.2);
  };

  it('M109A7 Paladin ~24 km', () => {
    const w = WeaponCatalog.m109Paladin();
    inBand(maxRange(w, w.charges.length - 1), 24000);
  });

  it('2S7 Pion ~37.5 km', () => {
    const w = WeaponCatalog.pion2S7();
    inBand(maxRange(w, w.charges.length - 1), 37500);
  });

  it('M982 Excalibur ~40 km', () => {
    const w = WeaponCatalog.excalibur();
    inBand(maxRange(w, -1), 40000);
  });

  it('M26 MLRS ~32 km', () => {
    const w = WeaponCatalog.m26MLRS();
    inBand(maxRange(w, -1), 32000);
  });

  it('ER GMLRS ~150 km (esférico)', () => {
    const w = WeaponCatalog.erGMLRS();
    inBand(maxRange(w, -1, true, 700, 0.02), 150000);
  });

  it('PrSM ~500 km y apogeo coherente (esférico)', () => {
    const w = WeaponCatalog.prsm();
    inBand(maxRange(w, -1, true, 900, 0.02), 500000);

    // Un tiro concreto al QE óptimo (~62º con esta fase de empuje, como el
    // misil táctico): ~500 km con apogeo ~140 km — alcance Y apogeo coherentes.
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({
      dt: 0.02, maxFlight: 900, enableCoriolis: true, latitudeDeg: 40.0, sphericalEarth: true,
    });
    const solver = new BallisticsSolver(atmo, cfg);
    const v = WeaponSystem.launchVelocity(90.0, 62.0, w.round.muzzleVelocity);
    const fr = solver.integrate(w.round, new Vec3(), v);
    expect(fr.impacted).toBe(true);
    expect(fr.downrange).toBeGreaterThan(450_000);
    expect(fr.apex).toBeGreaterThan(100_000);
    expect(fr.apex).toBeLessThan(200_000);
  });

  it('Excalibur clava <5 m un objetivo marcado que el tiro balístico falla', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: true, latitudeDeg: 40.0 });
    const fc = new WeaponSystem(atmo, cfg);
    const w = WeaponCatalog.excalibur();
    expect(w.round.guidance.enabled).toBe(true);

    const sol = fc.solveForRange(w, new Vec3(), 30000.0, 90.0, -1, false);
    expect(sol.found).toBe(true);
    const order = { azimuthDeg: 90.0, elevationDeg: sol.elevationDeg, chargeIndex: -1 };
    const target = new Vec3(30000.0, 150.0, 0.0); // error de puntería lateral

    const ballistic = fc.fire(w, new Vec3(), order);
    const guided = fc.fire(w, new Vec3(), order, target);
    const missOf = (p: Vec3) => new Vec3(p.x - target.x, p.y - target.y, 0).length();
    expect(missOf(ballistic.impactPoint)).toBeGreaterThan(50);
    expect(missOf(guided.impactPoint)).toBeLessThan(5);
  });

  it('M26: salva de 6 dispersa (semilla fija) — nube visible y reproducible', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.01 });
    const fc = new WeaponSystem(atmo, cfg);
    const w = WeaponCatalog.m26MLRS();
    expect(w.round.guidance.enabled).toBe(false); // NO guiado: cohete de área

    const sol = fc.solveForRange(w, new Vec3(), 25000.0, 0.0, -1, false);
    expect(sol.found).toBe(true);
    const order = { azimuthDeg: 0.0, elevationDeg: sol.elevationDeg, chargeIndex: -1 };
    const errors = {
      muzzleVelocityStd: 0.003 * 35, azimuthStdMils: 2.0, elevationStdMils: 3.0, windStd: 1.5,
    };
    const a = fc.fireDispersed(w, new Vec3(), order, 6, errors, 42);
    const b = fc.fireDispersed(w, new Vec3(), order, 6, errors, 42);
    expect(a.impacts).toHaveLength(6);
    expect(b.cep).toBe(a.cep); // determinista
    expect(a.cep).toBeGreaterThan(15);  // elipse visible sobre el terreno
    expect(a.cep).toBeLessThan(800);    // pero creíble para un MLRS
  });
});

// ---------------------------------------------------------------------------
describe('P-PRO.4 — base bleed y cohete auxiliar (RAP)', () => {
  /** L39 (M109) con la munición dada montada. */
  const onL39 = (round: () => import('./Munition').Munition) => {
    const w = WeaponCatalog.m109Paladin();
    w.round = round();
    return w;
  };

  it('(a) el MISMO proyectil con BB on/off gana 20-35% de alcance', () => {
    const on = onL39(WeaponCatalog.m795BaseBleed);
    const off = onL39(WeaponCatalog.m795BaseBleed);
    off.round.baseBleed.enabled = false;
    const rOn = maxRange(on, 3);
    const rOff = maxRange(off, 3);
    const gain = rOn / rOff - 1;
    expect(gain).toBeGreaterThan(0.20);
    expect(gain).toBeLessThan(0.35);
  });

  it('(b) ignitionDelay=0 reproduce exactamente el motor clásico; >0 cambia el tiro', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: true, latitudeDeg: 40.0 });
    const fc = new WeaponSystem(atmo, cfg);

    // GMLRS: motor clásico (delay 0 implícito). Ponerlo explícito no mueve
    // NI UN BIT la integración.
    const base = WeaponCatalog.himarsGMLRS();
    const explicit = WeaponCatalog.himarsGMLRS();
    explicit.round.motor.ignitionDelayS = 0.0;
    const order = { azimuthDeg: 90.0, elevationDeg: 45.0, chargeIndex: -1 };
    const a = fc.fire(base, new Vec3(), order);
    const b = fc.fire(explicit, new Vec3(), order);
    expect(b.downrange).toBe(a.downrange);
    expect(b.apex).toBe(a.apex);
    expect(b.timeOfFlight).toBe(a.timeOfFlight);
    expect(b.impactPoint.x).toBe(a.impactPoint.x);
    expect(b.impactPoint.y).toBe(a.impactPoint.y);

    // El RAP con ignición a los 7 s vuela distinto que con ignición inmediata
    // (quemar a menor velocidad/altitud cambia alcance y ápice de forma medible).
    const rapNow = onL39(WeaponCatalog.m549Rap);
    rapNow.round.motor.ignitionDelayS = 0.0;
    const rapDelayed = onL39(WeaponCatalog.m549Rap);
    const orderRap = { azimuthDeg: 90.0, elevationDeg: 45.0, chargeIndex: 3 };
    const now = fc.fire(rapNow, new Vec3(), orderRap);
    const delayed = fc.fire(rapDelayed, new Vec3(), orderRap);
    expect(Math.abs(delayed.downrange - now.downrange)).toBeGreaterThan(300);
    expect(Math.abs(delayed.apex - now.apex)).toBeGreaterThan(100);
  });

  it('(c) M795E-BB ~28.5 km y M549A1 RAP ~30 km desde L39 (±20%)', () => {
    const rBB = maxRange(onL39(WeaponCatalog.m795BaseBleed), 3);
    expect(rBB).toBeGreaterThan(28500 * 0.8);
    expect(rBB).toBeLessThan(28500 * 1.2);

    const rRAP = maxRange(onL39(WeaponCatalog.m549Rap), 3);
    expect(rRAP).toBeGreaterThan(30000 * 0.8);
    expect(rRAP).toBeLessThan(30000 * 1.2);

    // Y ambas están cableadas como munición seleccionable en los dos L39.
    for (const w of [WeaponCatalog.m777(), WeaponCatalog.m109Paladin()]) {
      expect(w.rounds?.length).toBe(3);
      expect(w.rounds?.[0].name).toBe(w.round.name);
      expect(w.rounds?.[1].baseBleed.enabled).toBe(true);
      expect(w.rounds?.[2].motor.ignitionDelayS).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe('P-PRO.6 — elipse de error predicha vs Monte-Carlo', () => {
  it('la predicción linealizada cae dentro de ±30% de las σ muestrales (M777 a 15 km, n=200)', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.01, enableCoriolis: true, latitudeDeg: 40.0 });
    const fc = new WeaponSystem(atmo, cfg);
    const w = WeaponCatalog.m777();
    const muzzle = new Vec3(0, 0, 3);

    const sol = fc.solveForRange(w, muzzle, 15000.0, 90.0, 3, false);
    expect(sol.found).toBe(true);
    const order = { azimuthDeg: 90.0, elevationDeg: sol.elevationDeg, chargeIndex: 3 };
    const v0 = WeaponSystem.muzzleVelocity(w, order);
    const errors = {
      muzzleVelocityStd: 0.003 * v0, azimuthStdMils: 1.0, elevationStdMils: 1.0, windStd: 0.6,
    };

    const pred = fc.predictDispersion(w, muzzle, order, errors);
    expect(pred.rangeM).toBeGreaterThan(14000);

    // n grande para que el error muestral (~σ/√(2n) ≈ 5%) no domine el ±30%.
    const mc = fc.fireDispersed(w, muzzle, order, 200, errors, 1234);
    // Rumbo 90º: alcance = x, deriva = -y (t positivo a la derecha del rumbo).
    const xs = mc.impacts.map((p) => p.x);
    const ys = mc.impacts.map((p) => p.y);
    const std = (a: number[]) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
    };
    const sampleRange = std(xs);
    const sampleCross = std(ys);

    expect(pred.sigmaRangeM / sampleRange).toBeGreaterThan(0.7);
    expect(pred.sigmaRangeM / sampleRange).toBeLessThan(1.3);
    expect(pred.sigmaCrossM / sampleCross).toBeGreaterThan(0.7);
    expect(pred.sigmaCrossM / sampleCross).toBeLessThan(1.3);
  });
});

// ---------------------------------------------------------------------------
describe('P1.2 — spin drift + Magnus', () => {
  // Fire due East at QE 45, no wind, Coriolis OFF to isolate the spin terms.
  function spinShot(rightHand: boolean, spinOn = true) {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: false });
    const solver = new BallisticsSolver(atmo, cfg);
    const w = WeaponCatalog.m777();
    w.round.spinStabilized = spinOn;
    w.round.rightHandTwist = rightHand;
    const v = WeaponSystem.launchVelocity(90.0, 45.0, w.round.muzzleVelocity);
    return solver.integrate(w.round, new Vec3(), v);
  }

  it('right-hand twist drifts RIGHT (south for an eastbound shell), tens of meters at ~20 km', () => {
    const fr = spinShot(true);
    expect(fr.downrange).toBeGreaterThan(18000); // sanity: long shot
    expect(fr.impactPoint.y).toBeLessThan(-10);  // right of the line of fire
    expect(fr.impactPoint.y).toBeGreaterThan(-150); // ...but not absurd
  });

  it('left-hand twist mirrors the drift', () => {
    const right = spinShot(true);
    const left = spinShot(false);
    expect(left.impactPoint.y).toBeGreaterThan(10);
    // Symmetric within a couple of meters (Magnus is exactly mirrored too).
    expect(Math.abs(left.impactPoint.y + right.impactPoint.y)).toBeLessThan(2.0);
  });

  it('no spin -> no lateral drift', () => {
    const fr = spinShot(true, false);
    expect(Math.abs(fr.impactPoint.y)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
describe('P1.7 — altitude wind profile (shear)', () => {
  it('sheared profile lands away from the equivalent constant wind', () => {
    const w = WeaponCatalog.m777();
    const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: false });

    const constant = new Atmosphere();
    constant.windField = () => Atmosphere.steadyWind(4.0, 270.0); // surface wind everywhere

    const sheared = new Atmosphere();
    sheared.setWindProfile([
      { altitudeM: 0, speedMS: 4, fromBearingDeg: 270 },
      { altitudeM: 3000, speedMS: 12, fromBearingDeg: 210 },
      { altitudeM: 6000, speedMS: 18, fromBearingDeg: 180 },
    ]);

    const v = WeaponSystem.launchVelocity(0.0, 45.0, w.round.muzzleVelocity);
    const frConst = new BallisticsSolver(constant, cfg).integrate(w.round, new Vec3(), v);
    const frShear = new BallisticsSolver(sheared, cfg).integrate(w.round, new Vec3(), v);

    const miss = frShear.impactPoint.sub(frConst.impactPoint);
    expect(new Vec3(miss.x, miss.y, 0).length()).toBeGreaterThan(100);
  });

  it('parses the CSV format and clamps outside the table', () => {
    const pts = Atmosphere.windProfileFromCSV(
      '# comment\naltitude_m,speed_ms,from_bearing_deg\n0,4,270\n3000, 12, 210\n\n6000,18,180\n',
    );
    expect(pts).toHaveLength(3);
    expect(pts[1]).toEqual({ altitudeM: 3000, speedMS: 12, fromBearingDeg: 210 });

    const atmo = new Atmosphere();
    atmo.setWindProfile(pts);
    // Below the table -> first point; above -> last point.
    const low = atmo.windAt(new Vec3(0, 0, -100), 0);
    const high = atmo.windAt(new Vec3(0, 0, 99999), 0);
    expect(low.x).toBeCloseTo(4.0, 6);   // from 270 -> blows east (+x)
    expect(high.y).toBeCloseTo(18.0, 6); // from 180 -> blows north (+y)
  });

  it('interpolates bearing along the shortest arc', () => {
    const atmo = new Atmosphere();
    atmo.setWindProfile([
      { altitudeM: 0, speedMS: 10, fromBearingDeg: 350 },
      { altitudeM: 1000, speedMS: 10, fromBearingDeg: 10 },
    ]);
    const mid = atmo.windAt(new Vec3(0, 0, 500), 0);
    // Halfway should be from 0 deg (north): vector (0, -10).
    expect(mid.x).toBeCloseTo(0, 6);
    expect(mid.y).toBeCloseTo(-10, 6);
  });
});

// ---------------------------------------------------------------------------
describe('P1.6 — deterministic dispersion + CEP', () => {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({ dt: 0.005 });
  const fc = new WeaponSystem(atmo, cfg);
  const w = WeaponCatalog.m777();
  const charge = w.charges.length - 1;
  const sol = fc.solveForRange(w, new Vec3(), 15000.0, 90.0, charge, false);
  const order = { azimuthDeg: 90.0, elevationDeg: sol.elevationDeg, chargeIndex: charge };
  const N = 48;

  it('CEP grows monotonically with muzzle-velocity error', () => {
    const ceps = [0.5, 2.0, 5.0].map(
      (sigma) =>
        fc.fireDispersed(w, new Vec3(), order, N, { muzzleVelocityStd: sigma }, 1234).cep,
    );
    expect(ceps[0]).toBeGreaterThan(0);
    expect(ceps[1]).toBeGreaterThan(ceps[0]);
    expect(ceps[2]).toBeGreaterThan(ceps[1]);
  });

  it('same seed reproduces the exact impact cloud; another seed differs', () => {
    const errors = { muzzleVelocityStd: 2.0, azimuthStdMils: 1.0, elevationStdMils: 1.0, windStd: 1.0 };
    const a = fc.fireDispersed(w, new Vec3(), order, 24, errors, 42);
    const b = fc.fireDispersed(w, new Vec3(), order, 24, errors, 42);
    const c = fc.fireDispersed(w, new Vec3(), order, 24, errors, 43);
    expect(b.cep).toBe(a.cep);
    for (let i = 0; i < a.impacts.length; i++) {
      expect(b.impacts[i].x).toBe(a.impacts[i].x);
      expect(b.impacts[i].y).toBe(a.impacts[i].y);
    }
    expect(c.cep).not.toBe(a.cep);
  });
});

// ---------------------------------------------------------------------------
describe('P1.4 — spherical Earth (ECEF) for long range', () => {
  it('tactical missile reaches ~300 km class in spherical mode', () => {
    const w = WeaponCatalog.tacticalMissile();
    const r = maxRange(w, -1, true, 700, 0.01);
    expect(r).toBeGreaterThan(280_000);
    expect(r).toBeLessThan(320_000);
  });

  it('flat/spherical divergence grows with range (160 -> 250 -> 295 km)', () => {
    const w = WeaponCatalog.tacticalMissile();
    const shoot = (elDeg: number, spherical: boolean) => {
      const atmo = new Atmosphere();
      const cfg = SolverConfig.with({
        dt: 0.02, maxFlight: 700, enableCoriolis: true, latitudeDeg: 40.0, sphericalEarth: spherical,
      });
      const solver = new BallisticsSolver(atmo, cfg);
      const v = WeaponSystem.launchVelocity(90.0, elDeg, w.round.muzzleVelocity);
      return solver.integrate(w.round, new Vec3(), v).downrange;
    };

    // The thrust phase pushes the optimum QE to ~63 deg; on the steep side of
    // the peak, lower elevation = longer range (measured: 80->160 km,
    // 72->~250 km, 63->~293 km).
    const els = [80.0, 72.0, 63.0];
    const flat = els.map((el) => shoot(el, false));
    const sph = els.map((el) => shoot(el, true));
    const div = els.map((_, i) => Math.abs(sph[i] - flat[i]));

    expect(flat[0]).toBeLessThan(flat[1]);
    expect(flat[1]).toBeLessThan(flat[2]);
    // Divergence grows with range...
    expect(div[1]).toBeGreaterThan(div[0]);
    expect(div[2]).toBeGreaterThan(div[1]);
    // ...and is material at 300 km class (>1 km) while modest at short range.
    expect(div[2]).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
describe('P1.5 — Pro-Nav terminal guidance', () => {
  it('guided GMLRS lands <5 m from a target the ballistic shot misses by >100 m', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.005, enableCoriolis: true, latitudeDeg: 40.0 });
    const fc = new WeaponSystem(atmo, cfg);
    const w = WeaponCatalog.himarsGMLRS();
    expect(w.round.guidance.enabled).toBe(true);

    // Lay the launcher for 40 km due East...
    const sol = fc.solveForRange(w, new Vec3(), 40000.0, 90.0, -1, false);
    expect(sol.found).toBe(true);
    const order = { azimuthDeg: 90.0, elevationDeg: sol.elevationDeg, chargeIndex: -1 };

    // ...but put the real target 200 m off to the side (aim-point error).
    const target = new Vec3(40000.0, 200.0, 0.0);

    const ballistic = fc.fire(w, new Vec3(), order); // no target -> unguided
    const guided = fc.fire(w, new Vec3(), order, target);

    const missOf = (p: Vec3) => new Vec3(p.x - target.x, p.y - target.y, 0).length();
    expect(missOf(ballistic.impactPoint)).toBeGreaterThan(100);
    expect(missOf(guided.impactPoint)).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
describe('P2.2 — MRSI (multiple rounds, simultaneous impact)', () => {
  it('3 rounds land on an 8 km target within 0.2 s of each other', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.01 });
    const fc = new WeaponSystem(atmo, cfg);
    const w = WeaponCatalog.m777();

    // At 8 km the top charges cannot come down on the steep branch (their
    // max-elevation range is still >8 km) — the charge ladder is what opens
    // distinct times of flight.
    const rounds = fc.solveMRSI(w, new Vec3(), 8000.0, 0.0, 3, [3, 2, 1]);
    expect(rounds.length).toBeGreaterThanOrEqual(3);

    // Re-simulate each solution and check the actual impact times align.
    const impactTimes: number[] = [];
    for (const r of rounds) {
      const fr = fc.fire(w, new Vec3(), {
        azimuthDeg: 0.0, elevationDeg: r.elevationDeg, chargeIndex: r.chargeIndex,
      });
      expect(Math.abs(fr.downrange - 8000.0)).toBeLessThan(5.0);
      impactTimes.push(r.fireDelay + fr.timeOfFlight);
    }
    const spread = Math.max(...impactTimes) - Math.min(...impactTimes);
    expect(spread).toBeLessThan(0.2);

    // The first round to fire is the slowest one (delay 0).
    expect(rounds[0].fireDelay).toBe(0);
    expect(rounds.every((r) => r.fireDelay >= 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('P4.3 — firing-table generator', () => {
  const w = WeaponCatalog.m777();
  const table = generateFiringTable(w, w.charges.length - 1, { stepM: 3000 });

  it('covers the weapon envelope coherently', () => {
    expect(table.maxRangeM).toBeGreaterThan(20000);
    expect(table.maxRangeM).toBeLessThan(28000);
    expect(table.rows.length).toBeGreaterThanOrEqual(6); // 3..18 km at 3 km step
  });

  it('low branch: QE and TOF grow with range; high branch: QE falls', () => {
    const rows = table.rows.filter((r) => r.qeLowDeg !== null && r.qeHighDeg !== null);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].qeLowDeg!).toBeGreaterThan(rows[i - 1].qeLowDeg!);
      expect(rows[i].tofLowS!).toBeGreaterThan(rows[i - 1].tofLowS!);
      expect(rows[i].qeHighDeg!).toBeLessThan(rows[i - 1].qeHighDeg!);
    }
  });

  it('agrees with the fire-control solver at 15 km', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.005 });
    const fc = new WeaponSystem(atmo, cfg);
    const sol = fc.solveForRange(w, new Vec3(), 15000.0, 0.0, w.charges.length - 1, false);
    const row = table.rows.find((r) => r.rangeM === 15000)!;
    expect(row).toBeDefined();
    expect(Math.abs(row.qeLowDeg! - sol.elevationDeg)).toBeLessThan(0.3);
  });

  it('renders CSV with header and one line per row', () => {
    const csv = firingTableCSV(table);
    const lines = csv.trim().split('\n');
    expect(lines[2]).toContain('range_m,qe_low_deg');
    expect(lines.length).toBe(3 + table.rows.length);
  });
});

// ---------------------------------------------------------------------------
describe('P0.1 (web) — warhead yield rides with the flight result', () => {
  it('each weapon reports its own TNT equivalent', () => {
    const atmo = new Atmosphere();
    const cfg = SolverConfig.with({ dt: 0.01 });
    const fc = new WeaponSystem(atmo, cfg);

    const mortar = WeaponCatalog.mortar120();
    const gmlrs = WeaponCatalog.himarsGMLRS();
    const frM = fc.fire(mortar, new Vec3(), { azimuthDeg: 0, elevationDeg: 60, chargeIndex: 3 });
    const frG = fc.fire(gmlrs, new Vec3(), { azimuthDeg: 0, elevationDeg: 45, chargeIndex: -1 });

    expect(frM.warheadTNTeq).toBe(2.9);
    expect(frG.warheadTNTeq).toBe(40.0);
    expect(frG.warheadTNTeq).toBeGreaterThan(frM.warheadTNTeq); // GMLRS >> mortar
  });
});
