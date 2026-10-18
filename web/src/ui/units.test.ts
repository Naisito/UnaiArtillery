// ============================================================================
//  units.test.ts — V2/UI: conversiones mil⇄grados, formatos de distancia y
//  coordenadas (MGRS con el paquete mgrs), pasos de puntería fina y la
//  descomposición del error de impacto en alcance/deriva.
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  angleOfFallDeg, bearingDegOf, cepFromSigmas, degToMil, distanceParts, fmtAngle,
  fmtLatLonDD, fmtLatLonDMS, fmtNum, layStepDeg, milToDeg, missComponents, normDeg,
  probableError, toMgrs,
} from './units';

describe('V2/UI — milésimas OTAN', () => {
  it('6400 mil = 360°, 1600 mil = 90°, ida y vuelta exacta', () => {
    expect(degToMil(360)).toBe(6400);
    expect(degToMil(90)).toBe(1600);
    expect(degToMil(45)).toBe(800);
    expect(milToDeg(3200)).toBe(180);
    for (const d of [0, 0.05625, 12.3456, 271.5]) expect(milToDeg(degToMil(d))).toBeCloseTo(d, 12);
  });

  it('formatea con la unidad pedida', () => {
    expect(fmtAngle(90, 'mil')).toBe('1600.0 mil');
    expect(fmtAngle(45, 'deg')).toBe('45.00°');
  });

  it('normaliza rumbos y calcula demoras ENU', () => {
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(720)).toBe(0);
    expect(bearingDegOf(1, 0)).toBeCloseTo(90, 12);
    expect(bearingDegOf(0, -1)).toBeCloseTo(180, 12);
    expect(bearingDegOf(-1, 0)).toBeCloseTo(270, 12);
  });

  it('pasos de puntería: ±1 mil (Shift 0.1, Ctrl 10) por tecla; rueda 10 mil', () => {
    const none = { shiftKey: false, ctrlKey: false };
    expect(degToMil(layStepDeg('mil', none))).toBeCloseTo(1, 12);
    expect(degToMil(layStepDeg('mil', { shiftKey: true, ctrlKey: false }))).toBeCloseTo(0.1, 12);
    expect(degToMil(layStepDeg('mil', { shiftKey: false, ctrlKey: true }))).toBeCloseTo(10, 12);
    expect(degToMil(layStepDeg('mil', none, 'wheel'))).toBeCloseTo(10, 12);
    // En grados la rueda conserva el comportamiento clásico 0.5/0.05/5°.
    expect(layStepDeg('deg', none, 'wheel')).toBeCloseTo(0.5, 12);
    expect(layStepDeg('deg', { shiftKey: true, ctrlKey: false }, 'wheel')).toBeCloseTo(0.05, 12);
    expect(layStepDeg('deg', { shiftKey: false, ctrlKey: true }, 'wheel')).toBeCloseTo(5, 12);
  });
});

describe('V2/UI — formatos', () => {
  it('números con separador fino y signo menos tipográfico', () => {
    expect(fmtNum(1234567.891, 1)).toBe('1\u2009234\u2009567.9');
    expect(fmtNum(6399.9, 1)).toBe('6399.9');
    expect(fmtNum(24700)).toBe('24\u2009700');
    expect(fmtNum(-12.5, 1)).toBe('−12.5');
    expect(fmtNum(-0.01, 1)).toBe('0.0');
    expect(fmtNum(Number.NaN)).toBe('—');
  });

  it('distancias en m bajo 1 km y en km por encima', () => {
    expect(distanceParts(850)).toEqual({ value: '850', unit: 'm' });
    expect(distanceParts(21940)).toEqual({ value: '21.94', unit: 'km' });
    expect(distanceParts(300_000)).toEqual({ value: '300.0', unit: 'km' });
  });

  it('MGRS de la Sierra de Guadarrama con espacios de lectura', () => {
    const s = toMgrs(40.75, -3.9);
    expect(s).toMatch(/^30T [A-Z]{2} \d{5} \d{5}$/);
    expect(toMgrs(40.75, -3.9, 3)).toMatch(/^30T [A-Z]{2} \d{3} \d{3}$/);
    expect(toMgrs(88, 0)).toContain('UPS');
  });

  it('lat/lon decimal y sexagesimal con hemisferios', () => {
    expect(fmtLatLonDD(40.75, -3.9, 2)).toBe('40.75° N  3.90° W');
    expect(fmtLatLonDMS(40.75, -3.9)).toBe('40°45′00.0″ N  3°54′00.0″ W');
  });
});

describe('V2/UI — análisis del tiro', () => {
  it('descompone el fallo en largo/corto y derecha/izquierda de la línea de tiro', () => {
    // Tiro al norte: objetivo a 10 km; impacto 50 m largo y 20 m a la derecha (este).
    const c = missComponents({ x: 20, y: 10_050 }, { x: 0, y: 10_000 });
    expect(c.rangeM).toBeCloseTo(50, 9);
    expect(c.deflM).toBeCloseTo(20, 9);
    expect(c.missM).toBeCloseTo(Math.hypot(50, 20), 9);
    // Tiro al este: impacto 30 m corto y 10 m a la izquierda (norte).
    const e = missComponents({ x: 4970, y: 10 }, { x: 5000, y: 0 });
    expect(e.rangeM).toBeCloseTo(-30, 9);
    expect(e.deflM).toBeCloseTo(-10, 9);
  });

  it('ángulo de caída, EP y CEP', () => {
    expect(angleOfFallDeg({ x: 100, y: 0, z: -100 })).toBeCloseTo(45, 9);
    expect(probableError(10)).toBeCloseTo(6.745, 9);
    expect(cepFromSigmas(10, 10)).toBeCloseTo(11.774, 3);
  });
});
