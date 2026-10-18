// Tests de map/units.ts — formatos de la estación de tiro.  [V2:MAP]
import { describe, expect, it } from 'vitest';
import {
  THIN, degToMils, deltaDeg, formatAzDeg, formatDistance, formatElevMils, formatHeight,
  formatLat, formatLon, formatMgrs, formatMils, formatSignedHeight, groupThousands,
  latLonPlain, milsToDeg, normDeg,
} from './units';

describe('milésimas OTAN', () => {
  it('6400 mil = 360º y vuelta', () => {
    expect(degToMils(360)).toBe(6400);
    expect(degToMils(90)).toBe(1600);
    expect(milsToDeg(3200)).toBe(180);
  });

  it('formatMils rellena a 4 cifras y envuelve 6400 → 0000', () => {
    expect(formatMils(0)).toBe('0000');
    expect(formatMils(24.47)).toBe('0435');
    expect(formatMils(359.99)).toBe('0000');
    expect(formatMils(-90)).toBe('4800');
  });

  it('formatAzDeg con 3 cifras y un decimal', () => {
    expect(formatAzDeg(69.44)).toBe('069.4°');
    expect(formatAzDeg(359.96)).toBe('000.0°');
    expect(formatAzDeg(-1)).toBe('359.0°');
  });

  it('formatElevMils', () => {
    expect(formatElevMils(45)).toBe('800');
  });

  it('normDeg y deltaDeg por el camino corto', () => {
    expect(normDeg(-10)).toBe(350);
    expect(normDeg(725)).toBe(5);
    expect(deltaDeg(350, 10)).toBe(20);
    expect(deltaDeg(10, 350)).toBe(-20);
    expect(deltaDeg(0, 180)).toBe(180);
  });
});

describe('distancias y alturas', () => {
  it('precisión acorde a la magnitud', () => {
    expect(formatDistance(850.4)).toBe('850 m');
    expect(formatDistance(4823)).toBe('4.82 km');
    expect(formatDistance(48230)).toBe('48.2 km');
    expect(formatDistance(482300)).toBe('482 km');
    expect(formatDistance(1_482_300)).toBe(`1${THIN}482 km`);
    expect(formatDistance(NaN)).toBe('—');
  });

  it('separador de miles fino y signos', () => {
    expect(groupThousands(1234567)).toBe(`1${THIN}234${THIN}567`);
    expect(formatHeight(1234.4)).toBe(`1${THIN}234 m`);
    expect(formatSignedHeight(45.2)).toBe('+45 m');
    expect(formatSignedHeight(-120)).toBe('−120 m');
    expect(formatSignedHeight(0.2)).toBe('±0 m');
  });
});

describe('coordenadas', () => {
  it('decimal con hemisferio', () => {
    expect(formatLat(40.751234)).toBe('40.75123° N');
    expect(formatLon(-3.9)).toBe('3.90000° W');
    expect(formatLat(-33.5)).toBe('33.50000° S');
  });

  it('GMS con acarreo de segundos', () => {
    expect(formatLat(40.75, 'dms')).toBe('40°45′00.0″ N');
    expect(formatLon(-3.9, 'dms')).toBe('003°54′00.0″ W');
    // 10.9999999º: 59′59.99996″ redondea a 11°00′00.0″, nunca a 60.0″.
    expect(formatLat(10.9999999, 'dms')).toBe('11°00′00.0″ N');
  });

  it('lat/lon plano para copiar', () => {
    expect(latLonPlain(40.75, -3.9)).toBe('40.750000, -3.900000');
  });

  it('MGRS por grupos', () => {
    expect(formatMgrs('30TVK1234567890')).toBe('30T VK 12345 67890');
    expect(formatMgrs('4QFJ123678')).toBe('4Q FJ 123 678');
    expect(formatMgrs('30TVK')).toBe('30T VK');
    expect(formatMgrs('basura')).toBe('basura');
  });
});
