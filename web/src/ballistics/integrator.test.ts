// ============================================================================
//  integrator.test.ts — V2 · PHYS (tarea E): integrador adaptativo RK45.
//
//  El Dormand–Prince 5(4) se usa en previews, solves y tablas. Criterio de
//  aceptación: el punto de impacto a < 0.5 m (y el TOF a < 0.01 s) de la
//  referencia RK4 de paso fijo dt = 5 ms en todo el catálogo representativo
//  — tubo largo, alto ángulo, cohete con motor, RAP con ignición retardada,
//  base bleed, mortero, guiado, misil esférico, terreno con cresta y
//  espoletas — con muchas menos evaluaciones del lado derecho.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { BallisticsSolver, FlightResult, SolverConfig } from './BallisticsSolver';
import { Munition } from './Munition';
import { Vec3 } from './Vec3';
import { WeaponCatalog } from './WeaponCatalog';
import { FuzeSpec, WeaponSystem } from './WeaponSystem';
import { buildTerrain, windFieldOf } from './WorkerProtocol';

function windy(): Atmosphere {
  const a = new Atmosphere();
  a.windField = windFieldOf({ kind: 'steady', speedMS: 8, fromBearingDeg: 250, ekman: true });
  return a;
}

const RIDGE = buildTerrain({
  dirE: 1, dirN: 0, stepAlongM: 400, rows: 5, stepCrossM: 500, halfWidthM: 1000,
  profile: Array.from({ length: 5 * 120 }, (_, k) => {
    const i = k % 120, j = Math.floor(k / 120);
    return 70 * Math.sin(i / 6) ** 2 + 12 * (j - 2) + (i >= 40 && i <= 42 ? 300 : 0);
  }),
});

interface Case {
  name: string;
  round: () => Munition;
  v0?: number;
  az: number;
  el: number;
  cfg?: Partial<SolverConfig>;
  target?: Vec3;
  fuze?: FuzeSpec;
  muzzle?: Vec3;
  refDt?: number;
  tolM?: number;
  /**
   * Hay motor (cohete/misil/RAP): el empuje se apaga A MITAD de un paso fijo y
   * el RK4 comete ahí un error de PRIMER orden en dt (≈7 m en el RAP, ≈16 m en
   * el M26, ≈48 m en el misil a dt = 5 ms; medido contra RK4 a 0.5 ms). El
   * RK45 corta el paso justo en la discontinuidad y no lo arrastra: aquí el
   * RK4 NO es la verdad, sino lo que converge HACIA el RK45 (dividir dt por 10
   * divide por ~10 su distancia). Richardson no vale: el error depende de en
   * qué punto del paso cae el apagado, no es una función suave de dt.
   */
  motor?: boolean;
}

const CASES: Case[] = [
  { name: 'M777 carga máx. QE 45 (~20 km)', round: () => WeaponCatalog.m777().round, az: 60, el: 45 },
  { name: 'M777 alto ángulo QE 68', round: () => WeaponCatalog.m777().round, az: 200, el: 68 },
  { name: '2S7 Pion QE 50 (~37 km)', round: () => WeaponCatalog.pion2S7().round, az: 90, el: 50 },
  { name: 'M549A1 RAP (ignición a 7 s)', round: () => WeaponCatalog.m549Rap(), az: 90, el: 50, motor: true, tolM: 1.0 },
  { name: 'M795 base bleed', round: () => WeaponCatalog.m795BaseBleed(), az: 90, el: 50 },
  { name: 'mortero 120 QE 60', round: () => WeaponCatalog.mortar120().round, az: 10, el: 60 },
  { name: 'M26 cohete QE 45', round: () => WeaponCatalog.m26MLRS().round, az: 90, el: 45, motor: true, tolM: 2.0 },
  {
    name: 'GMLRS guiado a objetivo desplazado', round: () => WeaponCatalog.himarsGMLRS().round,
    az: 90, el: 40, target: new Vec3(52000, 300, 0), motor: true, tolM: 1.0,
  },
  {
    name: 'terreno con cresta (tiro tenso)', round: () => WeaponCatalog.m777().round,
    az: 90, el: 9, cfg: { terrainHeight: RIDGE }, muzzle: new Vec3(0, 0, 3),
  },
  {
    name: 'terreno, tiro largo', round: () => WeaponCatalog.m777().round,
    az: 90, el: 40, cfg: { terrainHeight: RIDGE, maxFlight: 700 }, muzzle: new Vec3(0, 0, 3),
  },
  {
    name: 'espoleta de proximidad', round: () => WeaponCatalog.m777().round,
    az: 90, el: 45, cfg: { terrainHeight: RIDGE }, fuze: { mode: 'proximity', heightM: 9 },
  },
  {
    name: 'espoleta de tiempo', round: () => WeaponCatalog.m777().round,
    az: 90, el: 45, fuze: { mode: 'time', timeS: 31.37 },
  },
  {
    name: 'misil táctico esférico (~290 km)', round: () => WeaponCatalog.tacticalMissile().round,
    az: 90, el: 63,
    cfg: { sphericalEarth: true, maxFlight: 700, latitudeDeg: 40, anchorLonDeg: -3.9 },
    motor: true, tolM: 6.0, // 2e-5 relativo a 300 km
  },
];

function run(c: Case, rk45: boolean, dtOverride?: number): FlightResult {
  const round = c.round();
  const cfg = SolverConfig.with({
    dt: dtOverride ?? c.refDt ?? 0.005, latitudeDeg: 40.75, enableCoriolis: true, maxFlight: 400,
    anchorAltitudeM: 600, ...c.cfg,
  });
  if (rk45) {
    cfg.integrator = 'rk45';
    cfg.outputDt = 0.05;
  }
  const solver = new BallisticsSolver(windy(), cfg);
  const v = WeaponSystem.launchVelocity(c.az, c.el, c.v0 ?? round.muzzleVelocity);
  return solver.integrate(round, c.muzzle ?? new Vec3(), v, c.target, c.fuze);
}

describe('V2 — RK45 adaptativo vs referencia RK4 dt = 5 ms', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const fast = run(c, true);
      if (c.motor) {
        const coarse = run(c, false);          // RK4 5 ms
        const fine = run(c, false, 0.0005);    // RK4 0.5 ms
        const d5 = coarse.impactPoint.sub(fast.impactPoint).length();
        const d05 = fine.impactPoint.sub(fast.impactPoint).length();
        expect(fast.impacted).toBe(fine.impacted);
        expect(fast.detonation).toBe(fine.detonation);
        // Convergencia de primer orden del RK4 HACIA el RK45.
        expect(d05).toBeLessThan(0.2 * d5 + 0.3);
        expect(d05).toBeLessThan(c.tolM ?? 1.0);
        expect(Math.abs(fine.timeOfFlight - fast.timeOfFlight)).toBeLessThan(0.01);
        expect(fast.rhsEvaluations * 5).toBeLessThan(coarse.rhsEvaluations);
        return;
      }
      const ref = run(c, false);
      const flags = ref;
      const rk4Evals5ms = ref.rhsEvaluations;
      const d = fast.impactPoint.sub(ref.impactPoint).length();
      expect(fast.impacted).toBe(flags.impacted);
      expect(fast.detonation).toBe(flags.detonation);
      expect(d).toBeLessThan(c.tolM ?? 0.5);
      expect(Math.abs(fast.timeOfFlight - ref.timeOfFlight)).toBeLessThan(0.01);
      expect(Math.abs(fast.apex - ref.apex)).toBeLessThan(1.0);
      expect(Math.abs(fast.impactSpeed - ref.impactSpeed)).toBeLessThan(0.1);
      // Mucho más barato: al menos 5× menos evaluaciones que RK4 a 5 ms.
      expect(fast.rhsEvaluations * 5).toBeLessThan(rk4Evals5ms);
    });
  }

  it('salida densa: muestras cada outputDt y sobre la curva de referencia', () => {
    const c = CASES[0];
    const ref = run(c, false);
    const fast = run(c, true);
    // Espaciado uniforme (salvo la última muestra, el impacto interpolado).
    for (let i = 1; i < fast.path.length - 1; i++) {
      expect(fast.path[i].t - fast.path[i - 1].t).toBeCloseTo(0.05, 9);
    }
    // Cada muestra cae sobre la trayectoria de referencia (lerp en t).
    const at = (t: number) => {
      const k = Math.min(ref.path.length - 2, Math.max(0, Math.floor(t / 0.005)));
      const a = ref.path[k], b = ref.path[k + 1];
      const f = (t - a.t) / (b.t - a.t);
      return a.position.add(b.position.sub(a.position).mul(f));
    };
    for (let i = 0; i < fast.path.length - 1; i += 7) {
      const s = fast.path[i];
      expect(s.position.sub(at(s.t)).length()).toBeLessThan(0.1);
    }
  });

  it('recordPath=false: mismo impacto bit a bit con solo 2 muestras (RK4)', () => {
    const round = WeaponCatalog.m777().round;
    const cfg = SolverConfig.with({ dt: 0.005, latitudeDeg: 40 });
    const solver = new BallisticsSolver(new Atmosphere(), cfg);
    const v = WeaponSystem.launchVelocity(90, 45, round.muzzleVelocity);
    const full = solver.integrate(round, new Vec3(), v);
    const light = solver.integrateLight(round, new Vec3(), v);
    expect(light.path).toHaveLength(2);
    expect(light.impactPoint.x).toBe(full.impactPoint.x);
    expect(light.impactPoint.y).toBe(full.impactPoint.y);
    expect(light.timeOfFlight).toBe(full.timeOfFlight);
    expect(light.downrange).toBe(full.downrange);
    expect(light.path[0].velocity.x).toBe(full.path[0].velocity.x);
  });
});
