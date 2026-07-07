// ============================================================================
//  audioMath.test.ts — P-VIVO.1: el cálculo escalar del audio es puro y exacto.
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  azimuthDegOf, boomDelayS, distanceGain, panFromAzimuths, whistleParams,
} from './audioMath';

describe('P-VIVO.1 — audioMath (pan, retardo, silbido)', () => {
  it('pan: ±1 en los costados, 0 de frente y de espaldas', () => {
    // Cámara mirando al norte (0º): evento al este (90º) suena a la derecha.
    expect(panFromAzimuths(90, 0)).toBeCloseTo(1, 9);
    expect(panFromAzimuths(270, 0)).toBeCloseTo(-1, 9);
    expect(panFromAzimuths(0, 0)).toBeCloseTo(0, 9);
    expect(panFromAzimuths(180, 0)).toBeCloseTo(0, 9);
    // Gira la cámara: el MISMO evento cambia de lado con ella.
    expect(panFromAzimuths(90, 90)).toBeCloseTo(0, 9);
    expect(panFromAzimuths(90, 180)).toBeCloseTo(-1, 9);
    // Diagonales: sin(45º).
    expect(panFromAzimuths(45, 0)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('acimut de un delta ENU: convención brújula (0=N, 90=E)', () => {
    expect(azimuthDegOf(0, 1)).toBeCloseTo(0, 9);
    expect(azimuthDegOf(1, 0)).toBeCloseTo(90, 9);
    expect(azimuthDegOf(0, -1)).toBeCloseTo(180, 9);
    expect(azimuthDegOf(-1, 0)).toBeCloseTo(270, 9);
  });

  it('retardo = distancia / velocidad del sonido, con suelos', () => {
    expect(boomDelayS(3400, 340)).toBeCloseTo(10.0, 9);
    expect(boomDelayS(1, 340)).toBeCloseTo(0.01, 9); // mínimo del scheduler
    expect(boomDelayS(1000, 50)).toBeCloseTo(5.0, 9); // suelo de 200 m/s
  });

  it('ganancia por distancia: satura cerca, decae lejos, escala con la energía', () => {
    expect(distanceGain(60)).toBe(1);
    expect(distanceGain(900)).toBeCloseTo(1, 9);
    expect(distanceGain(1800)).toBeCloseTo(0.5, 9);
    expect(distanceGain(1800, 0.5)).toBeCloseTo(0.25, 9);
    expect(distanceGain(1800, 4)).toBe(1); // nunca pasa de 1
  });

  it('el silbido SE ANULA por encima de Mach 1 (un GMLRS no silba)', () => {
    expect(whistleParams(1.0, 100).gain).toBe(0);
    expect(whistleParams(2.4, 50).gain).toBe(0);
    expect(whistleParams(0.8, 100).gain).toBeGreaterThan(0);
  });

  it('el silbido se anula lejos y crece al acercarse', () => {
    expect(whistleParams(0.8, 500).gain).toBe(0);
    expect(whistleParams(0.8, 5000).gain).toBe(0);
    const far = whistleParams(0.8, 400).gain;
    const near = whistleParams(0.8, 50).gain;
    expect(near).toBeGreaterThan(far);
  });

  it('la frecuencia del silbido cae de ~1200 a ~600 Hz al frenarse', () => {
    const fast = whistleParams(0.99, 100).freqHz;
    const slow = whistleParams(0.35, 100).freqHz;
    expect(fast).toBeGreaterThan(1100);
    expect(slow).toBeLessThan(700);
    expect(fast).toBeGreaterThan(slow);
  });
});
