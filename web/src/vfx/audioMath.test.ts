// ============================================================================
//  audioMath.test.ts — P-VIVO.1: el cálculo escalar del audio es puro y exacto.
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  airAbsorptionCutoffHz, azimuthDegOf, boomDelayS, distanceGain, nWaveDurationS, nWaveGain,
  panFromAzimuths, reverbSend, whistleParams,
} from './audioMath';

// ============================================================================
//  V2 VFX — propagación: absorción, reverberación y onda N.
// ============================================================================
describe('V2 — audioMath (absorción, reverberación, onda N)', () => {
  it('la absorción del aire cierra el paso-bajo con la distancia (monótona)', () => {
    const near = airAbsorptionCutoffHz(50);
    const km = airAbsorptionCutoffHz(1000);
    const far = airAbsorptionCutoffHz(5000);
    const vfar = airAbsorptionCutoffHz(20000);
    expect(near).toBeGreaterThan(8000);
    expect(km).toBeGreaterThan(1000);
    expect(km).toBeLessThan(2500);
    expect(far).toBeLessThan(600);
    expect(vfar).toBeGreaterThanOrEqual(200);
    expect(near).toBeGreaterThan(km);
    expect(km).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(vfar);
  });

  it('la reverberación gana peso lejos y está acotada', () => {
    expect(reverbSend(0)).toBeCloseTo(0.12, 6);
    expect(reverbSend(5000)).toBeGreaterThan(reverbSend(500));
    expect(reverbSend(1e6)).toBeLessThanOrEqual(0.85);
  });

  it('onda N: ~0.35 ms para una bala, varios ms para una granada', () => {
    const bullet = nWaveDurationS(50, 0.00762, 2.5, 343);
    expect(bullet).toBeGreaterThan(0.0002);
    expect(bullet).toBeLessThan(0.0006);
    const shell = nWaveDurationS(300, 0.155, 2.0, 343);
    expect(shell).toBeGreaterThan(0.003);
    expect(shell).toBeLessThan(0.008);
    // Más lejos = onda más larga (se ensancha con b^¼).
    expect(nWaveDurationS(200, 0.00762, 2.5)).toBeGreaterThan(nWaveDurationS(20, 0.00762, 2.5));
  });

  it('el chasquido se apaga con la distancia de paso', () => {
    expect(nWaveGain(10, 0.00762)).toBeGreaterThan(nWaveGain(100, 0.00762));
    expect(nWaveGain(1, 0.155)).toBeLessThanOrEqual(1);
    expect(nWaveGain(300, 0.155)).toBeGreaterThan(nWaveGain(300, 0.00762));
  });
});

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
