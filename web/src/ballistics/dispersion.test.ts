// ============================================================================
//  dispersion.test.ts — V2 · PHYS (tarea D): presupuesto de errores por arma.
//
//  Las σ son de las CAUSAS; los errores probables (EP = 0.6745·σ) que salen
//  de la física deben caer en las bandas de las tablas de tiro publicadas, y
//  la elipse predicha debe seguir solapando la nube Monte-Carlo con las
//  fuentes nuevas (arrastre, impulso) activas.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { SolverConfig } from './BallisticsSolver';
import { dispersionModel, probableError } from './Dispersion';
import { Vec3 } from './Vec3';
import { Weapon, WeaponCatalog } from './WeaponCatalog';
import { FireOrder, WeaponSystem } from './WeaponSystem';

const cfg = () => SolverConfig.with({ dt: 0.005, latitudeDeg: 40, integrator: 'rk45', maxFlight: 400 });

/** Orden de fuego para `rangeM` con la carga dada (rama baja por defecto). */
function orderFor(w: Weapon, fc: WeaponSystem, rangeM: number, ci: number, high = false): FireOrder {
  const sol = fc.solveForRange(w, new Vec3(), rangeM, 90, ci, high);
  if (!sol.found) throw new Error(`sin solución a ${rangeM} m`);
  return { azimuthDeg: 90, elevationDeg: sol.elevationDeg, chargeIndex: ci };
}

function pe(w: Weapon, rangeM: number, ci: number, high = false) {
  const fc = new WeaponSystem(new Atmosphere(), cfg());
  const order = orderFor(w, fc, rangeM, ci, high);
  const pred = fc.predictDispersion(w, new Vec3(), order, dispersionModel(w, order));
  return {
    range: probableError(pred.sigmaRangeM),
    cross: probableError(pred.sigmaCrossM),
    R: pred.rangeM,
  };
}

describe('V2 — modelo de dispersión por arma (EP de tablas de tiro)', () => {
  it('155 mm M795 a Z4 y 14 km: EP alcance ~27 m (FT), deriva ≤ 1/3', () => {
    const p = pe(WeaponCatalog.m777(), 14000, 3);
    expect(p.range).toBeGreaterThan(15);
    expect(p.range).toBeLessThan(45);
    expect(p.cross).toBeLessThan(p.range / 3);
  });

  it('155 mm: el EP de alcance es 0.15-0.45 % del alcance a media distancia', () => {
    const p = pe(WeaponCatalog.m777(), 18000, 4);
    expect(p.range / p.R).toBeGreaterThan(0.0015);
    expect(p.range / p.R).toBeLessThan(0.0045);
  });

  it('mortero (rama alta, como dispara): EP relativo mayor que el del tubo', () => {
    const m = pe(WeaponCatalog.mortar120(), 5500, 4, true);
    const t = pe(WeaponCatalog.m777(), 18000, 4);
    expect(m.range / m.R).toBeGreaterThan(t.range / t.R);
  });

  it('cohete M26 no guiado: EP alcance 0.6-2.5 % del alcance a 28 km', () => {
    const p = pe(WeaponCatalog.m26MLRS(), 28000, -1);
    expect(p.range / p.R).toBeGreaterThan(0.006);
    expect(p.range / p.R).toBeLessThan(0.025);
  });

  it('CEP de navegación de los guiados (Excalibur, GMLRS, ATACMS, PrSM)', () => {
    const o: FireOrder = { azimuthDeg: 0, elevationDeg: 45, chargeIndex: -1 };
    expect(dispersionModel(WeaponCatalog.excalibur(), o).guidedCepM).toBeLessThanOrEqual(4);
    expect(dispersionModel(WeaponCatalog.himarsGMLRS(), o).guidedCepM).toBeLessThan(5);
    expect(dispersionModel(WeaponCatalog.tacticalMissile(), o).guidedCepM).toBe(9);
    expect(dispersionModel(WeaponCatalog.prsm(), o).guidedCepM).toBe(5);
    expect(dispersionModel(WeaponCatalog.m26MLRS(), o).guidedCepM).toBeUndefined();
  });

  it('elipse predicha ≈ nube Monte-Carlo con arrastre e impulso activos (M26, n=150, ±35 %)', () => {
    const w = WeaponCatalog.m26MLRS();
    const fc = new WeaponSystem(new Atmosphere(), cfg());
    const order = orderFor(w, fc, 26000, -1);
    const errs = dispersionModel(w, order);
    const pred = fc.predictDispersion(w, new Vec3(), order, errs);
    const salvo = fc.fireDispersed(w, new Vec3(), order, 150, errs, 4242);
    const az = (order.azimuthDeg * Math.PI) / 180;
    const along = (p: Vec3) => p.x * Math.sin(az) + p.y * Math.cos(az);
    const cross = (p: Vec3) => p.x * Math.cos(az) - p.y * Math.sin(az);
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    const sR = sd(salvo.impacts.map(along));
    const sC = sd(salvo.impacts.map(cross));
    expect(Math.abs(sR - pred.sigmaRangeM) / pred.sigmaRangeM).toBeLessThan(0.35);
    expect(Math.abs(sC - pred.sigmaCrossM) / pred.sigmaCrossM).toBeLessThan(0.35);
  });

  it('sin dragStd/impulseStd la salva con semilla reproduce exactamente lo de antes', () => {
    const w = WeaponCatalog.m777();
    const fc = new WeaponSystem(new Atmosphere(), cfg());
    const order: FireOrder = { azimuthDeg: 90, elevationDeg: 30, chargeIndex: 4 };
    const base = { muzzleVelocityStd: 2, azimuthStdMils: 1, elevationStdMils: 1, windStd: 0.6 };
    const a = fc.fireDispersed(w, new Vec3(), order, 6, base, 7);
    const b = fc.fireDispersed(w, new Vec3(), order, 6, { ...base, dragStd: 0, impulseStd: 0 }, 7);
    a.impacts.forEach((p, i) => {
      expect(p.x).toBe(b.impacts[i].x);
      expect(p.y).toBe(b.impacts[i].y);
    });
  });
});
