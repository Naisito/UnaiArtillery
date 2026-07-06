// ============================================================================
//  calibrate_bc.ts — Calibración de coeficientes balísticos (P1.3/P1.4/P-NEXT.4).
//
//  Busca por bisección el BC que hace que cada arma del catálogo BC reproduzca
//  su alcance máximo publicado (los 4 originales, contra el alcance del núcleo
//  C++ validado). Corre sobre la atmósfera por defecto (ISA-76 desde P-NEXT.2).
//  Ejecutar cuando se toquen las tablas G1/G7, la atmósfera o los motores:
//
//      npx tsx tools/calibrate_bc.ts            # todas
//      npx tsx tools/calibrate_bc.ts --only prsm ergmlrs
//
//  Imprime el BC recomendado para pegar en WeaponCatalog.ts.
// ============================================================================
import { Atmosphere } from '../src/ballistics/Atmosphere';
import { SolverConfig } from '../src/ballistics/BallisticsSolver';
import { Weapon, WeaponCatalog } from '../src/ballistics/WeaponCatalog';
import { WeaponSystem } from '../src/ballistics/WeaponSystem';
import { Vec3 } from '../src/ballistics/Vec3';

function maxRange(w: Weapon, chargeIndex: number, spherical = false, maxFlight = 400, dt = 0.005): number {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({
    dt, enableCoriolis: true, latitudeDeg: 40.0,
    sphericalEarth: spherical, maxFlight,
  });
  const fc = new WeaponSystem(atmo, cfg);
  const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex });
  let best = 0.0;
  for (let el = w.minElevationDeg; el <= w.maxElevationDeg; el += 1.0) {
    best = Math.max(best, fc.rangeForElevation(w, new Vec3(), 90.0, v0, el));
  }
  return best;
}

interface Entry {
  key: string;
  make: () => Weapon;
  chargeIndex: number;
  targetM: number;
  bcLo: number;
  bcHi: number;
  spherical?: boolean;
  maxFlight?: number;
  dt?: number;
}

const ENTRIES: Entry[] = [
  { key: 'mortar120', make: () => WeaponCatalog.mortar120(), chargeIndex: 3, targetM: 6367.3, bcLo: 0.8, bcHi: 4.0 },
  { key: 'm777', make: () => WeaponCatalog.m777(), chargeIndex: 3, targetM: 20803.1, bcLo: 2.0, bcHi: 8.0 },
  { key: 'm109', make: () => WeaponCatalog.m109Paladin(), chargeIndex: 3, targetM: 24000, bcLo: 2.0, bcHi: 12.0 },
  { key: 'pion2s7', make: () => WeaponCatalog.pion2S7(), chargeIndex: 2, targetM: 37500, bcLo: 2.0, bcHi: 12.0 },
  { key: 'excalibur', make: () => WeaponCatalog.excalibur(), chargeIndex: -1, targetM: 40000, bcLo: 4.0, bcHi: 60.0 },
  { key: 'gmlrs', make: () => WeaponCatalog.himarsGMLRS(), chargeIndex: -1, targetM: 68381, bcLo: 3.0, bcHi: 16.0 },
  { key: 'm26', make: () => WeaponCatalog.m26MLRS(), chargeIndex: -1, targetM: 32000, bcLo: 1.0, bcHi: 12.0 },
  {
    key: 'ergmlrs', make: () => WeaponCatalog.erGMLRS(), chargeIndex: -1, targetM: 150000,
    bcLo: 4.0, bcHi: 30.0, spherical: true, maxFlight: 700, dt: 0.01,
  },
  {
    key: 'tacticalMissile', make: () => WeaponCatalog.tacticalMissile(), chargeIndex: -1, targetM: 300000,
    bcLo: 2.0, bcHi: 14.0, spherical: true, maxFlight: 700, dt: 0.01,
  },
  {
    key: 'prsm', make: () => WeaponCatalog.prsm(), chargeIndex: -1, targetM: 500000,
    bcLo: 6.0, bcHi: 60.0, spherical: true, maxFlight: 900, dt: 0.01,
  },
];

/** Bisect BC so maxRange(weapon(BC)) ~= target (range grows with BC). */
function calibrate(e: Entry): number {
  let lo = e.bcLo, hi = e.bcHi;
  let bc = 0.5 * (lo + hi);
  for (let i = 0; i < 14; i++) {
    bc = 0.5 * (lo + hi);
    const w = e.make();
    w.round.ballisticCoefficient = bc;
    const r = maxRange(w, e.chargeIndex, e.spherical ?? false, e.maxFlight ?? 400, e.dt ?? 0.005);
    const err = (r - e.targetM) / e.targetM;
    console.log(`  ${e.key}: BC=${bc.toFixed(3)} -> ${r.toFixed(0)} m (err ${(err * 100).toFixed(2)}%)`);
    if (Math.abs(err) < 0.004) break;
    if (r < e.targetM) lo = bc; else hi = bc;
  }
  return bc;
}

const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv.slice(onlyIdx + 1) : null;

for (const e of ENTRIES) {
  if (only && !only.includes(e.key)) continue;
  const bc = calibrate(e);
  console.log(`>> ${e.key} BC = ${bc.toFixed(2)}\n`);
}
