// ============================================================================
//  calibrate_bc.ts — Calibración de coeficientes balísticos (P1.3 / P1.4).
//
//  Busca por bisección el BC que hace que cada arma del catálogo BC reproduzca
//  el alcance máximo del núcleo C++ validado (curvas explícitas). Ejecutar
//  cuando se toquen las tablas G1/G7 o los parámetros del motor:
//
//      npx tsx tools/calibrate_bc.ts
//
//  Imprime el BC recomendado para pegar en WeaponCatalog.ts.
// ============================================================================
import { Atmosphere } from '../src/ballistics/Atmosphere';
import { SolverConfig } from '../src/ballistics/BallisticsSolver';
import { Weapon, WeaponCatalog } from '../src/ballistics/WeaponCatalog';
import { WeaponSystem } from '../src/ballistics/WeaponSystem';
import { Vec3 } from '../src/ballistics/Vec3';

function maxRange(w: Weapon, chargeIndex: number, spherical = false, maxFlight = 400): number {
  const atmo = new Atmosphere();
  const cfg = SolverConfig.with({
    dt: 0.005, enableCoriolis: true, latitudeDeg: 40.0,
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

/** Bisect BC so maxRange(weapon(BC)) ~= target (range grows with BC). */
function calibrate(
  label: string,
  make: (bc: number) => Weapon,
  chargeIndex: number,
  target: number,
  bcLo: number,
  bcHi: number,
  spherical = false,
  maxFlight = 400,
): number {
  let lo = bcLo, hi = bcHi;
  let bc = 0.5 * (lo + hi);
  for (let i = 0; i < 14; i++) {
    bc = 0.5 * (lo + hi);
    const r = maxRange(make(bc), chargeIndex, spherical, maxFlight);
    const err = (r - target) / target;
    console.log(`  ${label}: BC=${bc.toFixed(3)} -> ${r.toFixed(0)} m (err ${(err * 100).toFixed(2)}%)`);
    if (Math.abs(err) < 0.004) break;
    if (r < target) lo = bc; else hi = bc;
  }
  return bc;
}

const ONLY_MISSILE = process.argv.includes('--missile');

if (!ONLY_MISSILE) {
const mortarBC = calibrate(
  'mortar G1',
  (bc) => { const w = WeaponCatalog.mortar120(); w.round.ballisticCoefficient = bc; return w; },
  3, 6367.3, 0.8, 4.0,
);
console.log(`>> mortar120 G1 BC = ${mortarBC.toFixed(2)}\n`);

const m777BC = calibrate(
  'M777 G7',
  (bc) => { const w = WeaponCatalog.m777(); w.round.ballisticCoefficient = bc; return w; },
  3, 20803.1, 2.0, 8.0,
);
console.log(`>> m777 G7 BC = ${m777BC.toFixed(2)}\n`);

const gmlrsBC = calibrate(
  'GMLRS G7',
  (bc) => { const w = WeaponCatalog.himarsGMLRS(); w.round.ballisticCoefficient = bc; return w; },
  -1, 68381.0, 3.0, 16.0,
);
console.log(`>> gmlrs G7 BC = ${gmlrsBC.toFixed(2)}\n`);
}

// Misil táctico: objetivo ~300 km EN MODO ESFÉRICO (P1.4).
const missileBC = calibrate(
  'missile G7 (spherical)',
  (bc) => { const w = WeaponCatalog.tacticalMissile(); w.round.ballisticCoefficient = bc; return w; },
  -1, 300000.0, 2.0, 14.0, true, 700,
);
console.log(`>> tacticalMissile G7 BC = ${missileBC.toFixed(2)}\n`);
{
  const w = WeaponCatalog.tacticalMissile();
  w.round.ballisticCoefficient = missileBC;
  const rFlat = maxRange(w, -1, false, 700);
  const rSph = maxRange(w, -1, true, 700);
  console.log(`  check: flat=${(rFlat / 1000).toFixed(1)} km  sph=${(rSph / 1000).toFixed(1)} km`);
}
