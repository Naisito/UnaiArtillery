// ============================================================================
//  openMeteo.test.ts — P-PRO.2: parseo puro de Open-Meteo y la inversión
//  presión -> altitud del modelo ISA-76.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from '../ballistics';
import { OPEN_METEO_FIXTURE } from './openMeteoFixture';
import { parseOpenMeteo } from './openMeteo';

const G0 = 9.80665;
const R_AIR = 287.05287;

describe('P-PRO.2 — Atmosphere.altitudeForPressure', () => {
  it('invierte el propio modelo con error <10 m en 0–25 km', () => {
    const atmo = new Atmosphere();
    for (let h = 0; h <= 25000; h += 500) {
      const p = atmo.sample(h).pressure;
      expect(Math.abs(atmo.altitudeForPressure(p) - h)).toBeLessThan(10);
    }
  });

  it('respeta los knobs de superficie (columna desplazada) y clampa fuera de rango', () => {
    const hot = new Atmosphere();
    hot.seaLevelTemperatureK = 288.15 + 12;
    hot.seaLevelPressurePa = 99000;
    for (let h = 0; h <= 20000; h += 2000) {
      const p = hot.sample(h).pressure;
      expect(Math.abs(hot.altitudeForPressure(p) - h)).toBeLessThan(10);
    }
    expect(hot.altitudeForPressure(2e5)).toBe(0);      // más presión que en superficie
    expect(hot.altitudeForPressure(1e-3)).toBe(86000); // por encima del modelo
  });
});

describe('P-PRO.2 — parseOpenMeteo (fixture real, batería a 998 m)', () => {
  it('convierte el fixture: 5 niveles útiles, 1000 y 925 hPa bajo tierra', () => {
    const r = parseOpenMeteo(OPEN_METEO_FIXTURE);
    // Con estación a 902.5 hPa, todo nivel con p >= 902.5 no existe sobre el
    // suelo: 1000 y 925 hPa se descartan.
    expect(r.levels.map((l) => l.hPa)).toEqual([850, 700, 500, 300, 200]);
    expect(r.profile).toHaveLength(5);
    // Perfil ascendente y RELATIVO a la batería (todo por encima del suelo).
    for (let i = 0; i < r.profile.length; i++) {
      expect(r.profile[i].altitudeM).toBeGreaterThan(0);
      if (i > 0) expect(r.profile[i].altitudeM).toBeGreaterThan(r.profile[i - 1].altitudeM);
    }
    // Velocidades/rumbos pasan intactos (m/s pedidos con wind_speed_unit=ms).
    expect(r.profile[0].speedMS).toBe(8.4);
    expect(r.profile[0].fromBearingDeg).toBe(225);
    expect(r.profile[4].speedMS).toBe(38.9);
  });

  it('reduce a nivel del mar con la fórmula barométrica estándar', () => {
    const r = parseOpenMeteo(OPEN_METEO_FIXTURE);
    const h = 998.0;
    const t2mK = 22.3 + 273.15;
    const tMslK = t2mK + 0.0065 * h;
    expect(r.seaLevelTempK).toBeCloseTo(tMslK, 9);
    const tMean = 0.5 * (t2mK + tMslK);
    const pMsl = 902.5 * 100 * Math.exp((G0 * h) / (R_AIR * tMean));
    expect(r.seaLevelPressurePa).toBeCloseTo(pMsl, 6);
    // Cordura: la reducción de 902.5 hPa a 998 m cae en ~1010-1015 hPa.
    expect(r.seaLevelPressurePa).toBeGreaterThan(100500);
    expect(r.seaLevelPressurePa).toBeLessThan(102000);
  });

  it('las altitudes de los niveles son físicamente coherentes', () => {
    const r = parseOpenMeteo(OPEN_METEO_FIXTURE);
    const at = (hPa: number) => r.levels.find((l) => l.hPa === hPa)!;
    // Bandas anchas de sanidad (dependen de la T real del día).
    expect(at(850).altitudeMslM).toBeGreaterThan(1100);
    expect(at(850).altitudeMslM).toBeLessThan(2100);
    expect(at(500).altitudeMslM).toBeGreaterThan(4800);
    expect(at(500).altitudeMslM).toBeLessThan(6500);
    expect(at(200).altitudeMslM).toBeGreaterThan(10500);
    expect(at(200).altitudeMslM).toBeLessThan(13500);
  });

  it('batteryHeightM explícito manda sobre elevation; solo usa niveles presentes', () => {
    // Con h = 0 no hay reducción: T_msl = T_2m y P_msl = P_surf, y las
    // altitudes de los niveles pasan a ser las MSL sin offset.
    const atSea = parseOpenMeteo(OPEN_METEO_FIXTURE, 0);
    expect(atSea.seaLevelTempK).toBeCloseTo(22.3 + 273.15, 9);
    expect(atSea.seaLevelPressurePa).toBeCloseTo(902.5 * 100, 6);
    const l850sea = atSea.levels.find((l) => l.hPa === 850)!;
    const l850mtn = parseOpenMeteo(OPEN_METEO_FIXTURE).levels.find((l) => l.hPa === 850)!;
    expect(l850sea.altitudeMslM).not.toBeCloseTo(l850mtn.altitudeMslM, 0);
    expect(atSea.profile.find((p) => p.speedMS === 8.4)!.altitudeM)
      .toBeCloseTo(l850sea.altitudeMslM, 6); // sin batería que restar

    // Nivel ausente: se salta sin romper el resto.
    const clone = structuredClone(OPEN_METEO_FIXTURE) as Record<string, unknown>;
    delete (clone.hourly as Record<string, unknown>).wind_speed_700hPa;
    const r = parseOpenMeteo(clone);
    expect(r.levels.map((l) => l.hPa)).toEqual([850, 500, 300, 200]);
  });

  it('JSON inválido o incompleto lanza (el panel degrada con toast)', () => {
    expect(() => parseOpenMeteo(null)).toThrow();
    expect(() => parseOpenMeteo({})).toThrow();
    expect(() => parseOpenMeteo({ hourly: { time: ['x'] } })).toThrow();
  });
});
