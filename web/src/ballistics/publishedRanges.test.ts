// ============================================================================
//  publishedRanges.test.ts — V2 · auditoría de datos: cada arma del catálogo
//  BC reproduce su ALCANCE MÁXIMO PUBLICADO (±3 %) con la munición y la carga
//  de referencia. Fuentes: TM 43-0001-28, ATP 3-09.50 tabla 1-1, FM 3-22.90,
//  GD-OTS, designation-systems.net, CSIS (detalle en docs/FISICA_WEB.md).
//
//  Si un cambio de física (tablas de arrastre, atmósfera, motores, MPM…)
//  mueve alguno, se recalibra con tools/calibrate_bc.ts — no se toca el test.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { SolverConfig } from './BallisticsSolver';
import { Vec3 } from './Vec3';
import { Weapon, WeaponCatalog } from './WeaponCatalog';
import { WeaponSystem } from './WeaponSystem';

function maxRange(w: Weapon, chargeIndex: number, spherical: boolean): number {
  const cfg = SolverConfig.with({
    dt: 0.005, enableCoriolis: true, latitudeDeg: 40.0,
    sphericalEarth: spherical, maxFlight: 900, integrator: 'rk45',
  });
  const fc = new WeaponSystem(new Atmosphere(), cfg);
  const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex });
  let best = 0;
  for (let el = w.minElevationDeg; el <= w.maxElevationDeg; el += 1.0) {
    best = Math.max(best, fc.rangeForElevation(w, new Vec3(), 90.0, v0, el));
  }
  return best;
}

const withRound = (w: Weapon, r: Weapon['round']): Weapon => {
  w.round = r;
  return w;
};

const CASES: { name: string; make: () => Weapon; ci: number; km: number; spherical?: boolean }[] = [
  { name: 'Mortero 120 · M934A1 carga 4 — 7.2 km', make: () => WeaponCatalog.mortar120(), ci: 4, km: 7.2 },
  { name: 'M777A2 · M795 Z5 — 22.5 km', make: () => WeaponCatalog.m777(), ci: 4, km: 22.5 },
  { name: 'M109A7 · M795 Z5 — 22.5 km (mismo L39)', make: () => WeaponCatalog.m109Paladin(), ci: 4, km: 22.5 },
  {
    name: 'L39 · M795E1 base bleed Z5 — 28.5 km',
    make: () => withRound(WeaponCatalog.m777(), WeaponCatalog.m795BaseBleed()), ci: 4, km: 28.5,
  },
  {
    name: 'L39 · M549A1 RAP Z5 — 30.1 km',
    make: () => withRound(WeaponCatalog.m777(), WeaponCatalog.m549Rap()), ci: 4, km: 30.1,
  },
  { name: 'M982 Excalibur Z5 — 37.5 km', make: () => WeaponCatalog.excalibur(), ci: 4, km: 37.5 },
  { name: '2S7 Pion · OF-43 carga plena — 37.5 km', make: () => WeaponCatalog.pion2S7(), ci: 2, km: 37.5 },
  { name: 'M270 · M26 — 32 km', make: () => WeaponCatalog.m26MLRS(), ci: -1, km: 32 },
  { name: 'HIMARS · M31 GMLRS — 70 km', make: () => WeaponCatalog.himarsGMLRS(), ci: -1, km: 70, spherical: true },
  { name: 'HIMARS · ER GMLRS — 150 km', make: () => WeaponCatalog.erGMLRS(), ci: -1, km: 150, spherical: true },
  { name: 'ATACMS Block IA — 300 km', make: () => WeaponCatalog.tacticalMissile(), ci: -1, km: 300, spherical: true },
  { name: 'PrSM — clase 500 km', make: () => WeaponCatalog.prsm(), ci: -1, km: 500, spherical: true },
];

describe('V2 — alcances máximos publicados (±3 %)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = maxRange(c.make(), c.ci, c.spherical ?? false) / 1000;
      expect(Math.abs(r - c.km) / c.km).toBeLessThan(0.03);
    });
  }

  it('M777A2 y M109A7 comparten tubo, proyectil y zonas ⇒ mismo alcance', () => {
    const a = maxRange(WeaponCatalog.m777(), 4, false);
    const b = maxRange(WeaponCatalog.m109Paladin(), 4, false);
    expect(Math.abs(a - b)).toBeLessThan(50); // solo difieren en límites de elevación
  });
});
