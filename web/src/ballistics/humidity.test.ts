// ============================================================================
//  humidity.test.ts — V2 · PHYS (tarea C): humedad y columna medida.
//
//  El vapor de agua (18 g/mol) es más ligero que el aire seco (29 g/mol): a
//  igual P y T, el aire húmedo es MENOS denso y el sonido va algo más rápido.
//  Se modela con la temperatura virtual (como el METCM de STANAG 4082) y la
//  presión se integra hidrostáticamente con ella.
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  Atmosphere, saturationVaporPressurePa, virtualTemperatureK,
} from './Atmosphere';
import { SolverConfig } from './BallisticsSolver';
import { Vec3 } from './Vec3';
import { WeaponCatalog } from './WeaponCatalog';
import { WeaponSystem } from './WeaponSystem';
import { buildAtmosphere } from './WorkerProtocol';

describe('V2 — humedad relativa y temperatura virtual', () => {
  it('presión de saturación de Buck: 20 °C ≈ 2339 Pa, 0 °C ≈ 611 Pa, 30 °C ≈ 4246 Pa', () => {
    expect(saturationVaporPressurePa(293.15)).toBeGreaterThan(2320);
    expect(saturationVaporPressurePa(293.15)).toBeLessThan(2355);
    expect(saturationVaporPressurePa(273.15)).toBeCloseTo(611.21, 1);
    expect(Math.abs(saturationVaporPressurePa(303.15) - 4246) / 4246).toBeLessThan(0.01);
  });

  it('HR = 0 es bit a bit la atmósfera seca de siempre', () => {
    const dry = new Atmosphere();
    const zero = new Atmosphere();
    zero.relativeHumidity = 0;
    for (const h of [0, 1500, 9000, 25000, 60000]) {
      expect(zero.sample(h).density).toBe(dry.sample(h).density);
      expect(zero.sample(h).soundSpeed).toBe(dry.sample(h).soundSpeed);
    }
  });

  it('aire saturado a 15 °C: densidad −0.6 %, sonido +0.3 % (T_v ≈ T + 1.8 K)', () => {
    const dry = new Atmosphere();
    const wet = new Atmosphere();
    wet.relativeHumidity = 1.0;
    const d = dry.sample(0), w = wet.sample(0);
    const tv = virtualTemperatureK(288.15, 101325, 1.0);
    expect(tv - 288.15).toBeGreaterThan(1.6);
    expect(tv - 288.15).toBeLessThan(2.0);
    expect(w.virtualTemperature).toBeCloseTo(tv, 6);
    expect(w.pressure).toBeCloseTo(d.pressure, 3); // P0 es el knob: no cambia
    const rhoRatio = w.density / d.density;
    expect(rhoRatio).toBeGreaterThan(0.990);
    expect(rhoRatio).toBeLessThan(0.996);
    const aRatio = w.soundSpeed / d.soundSpeed;
    expect(aRatio).toBeGreaterThan(1.002);
    expect(aRatio).toBeLessThan(1.005);
  });

  it('hidrostática consistente: la columna húmeda tiene MÁS presión en altura', () => {
    const dry = new Atmosphere();
    const wet = new Atmosphere();
    wet.relativeHumidity = 0.8;
    const r = wet.sample(5000).pressure / dry.sample(5000).pressure;
    expect(r).toBeGreaterThan(1.0005);
    expect(r).toBeLessThan(1.006);
    // Por encima de la tropopausa el vapor es despreciable: la T_v ≈ T.
    const s = wet.sample(15000);
    expect(s.virtualTemperature! - s.temperature).toBeLessThan(0.05);
  });

  it('perfil medido = ISA exacta reproduce la ISA analítica (±0.01 %)', () => {
    const isa = new Atmosphere();
    const meas = new Atmosphere();
    meas.setMetProfile([0, 1500, 3000, 5500, 9000, 12000].map((z) => ({
      altitudeM: z, temperatureK: isa.sample(z).temperature, relativeHumidity: 0,
    })));
    for (const h of [0, 800, 2500, 7000, 11000, 16000, 30000]) {
      const a = isa.sample(h), b = meas.sample(h);
      expect(Math.abs(b.pressure - a.pressure) / a.pressure).toBeLessThan(1e-4);
      expect(Math.abs(b.density - a.density) / a.density).toBeLessThan(1e-4);
      expect(Math.abs(b.temperature - a.temperature)).toBeLessThan(0.01);
    }
  });

  it('columna 10 K más cálida que la ISA: aire ~2.4 % menos denso a 3 km', () => {
    // A 3 km: T +3.7 % pero la columna cálida sostiene +1.3 % de presión
    // (hidrostática): ρ ≈ 1.0129 · 268.66/278.66 ≈ 0.9765.
    const isa = new Atmosphere();
    const warm = new Atmosphere();
    warm.setMetProfile([0, 3000, 6000, 9000].map((z) => ({
      altitudeM: z, temperatureK: isa.sample(z).temperature + 10,
    })));
    const r = warm.sample(3000).density / isa.sample(3000).density;
    expect(r).toBeGreaterThan(0.970);
    expect(r).toBeLessThan(0.982);
    expect(warm.sample(3000).pressure / isa.sample(3000).pressure).toBeGreaterThan(1.008);
    expect(warm.sample(3000).temperature).toBeCloseTo(isa.sample(3000).temperature + 10, 3);
  });

  it('el AtmoSpec del worker transporta HR y perfil (misma muestra)', () => {
    const direct = new Atmosphere();
    direct.relativeHumidity = 0.65;
    direct.setMetProfile([{ altitudeM: 0, temperatureK: 295 }, { altitudeM: 3000, temperatureK: 280 }]);
    const viaSpec = buildAtmosphere(structuredClone({
      model: 'isa76' as const, seaLevelTemperatureK: 288.15, seaLevelPressurePa: 101325,
      wind: { kind: 'none' as const }, relativeHumidity: 0.65,
      metProfile: [{ altitudeM: 0, temperatureK: 295 }, { altitudeM: 3000, temperatureK: 280 }],
    }));
    for (const h of [0, 1000, 4000]) {
      expect(viaSpec.sample(h).density).toBe(direct.sample(h).density);
    }
  });

  it('el aire húmedo alarga (un poco) el tiro: M777 +0.05..0.8 % con HR 90 % a 30 °C', () => {
    const shoot = (rh: number) => {
      const atmo = new Atmosphere();
      atmo.seaLevelTemperatureK = 303.15;
      atmo.relativeHumidity = rh;
      const fc = new WeaponSystem(atmo, SolverConfig.with({ dt: 0.01, integrator: 'rk45' }));
      const w = WeaponCatalog.m777();
      const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex: w.charges.length - 1 });
      return fc.rangeForElevation(w, new Vec3(), 90, v0, 45);
    };
    const gain = shoot(0.9) / shoot(0) - 1;
    expect(gain).toBeGreaterThan(0.0005);
    expect(gain).toBeLessThan(0.008);
  });
});
