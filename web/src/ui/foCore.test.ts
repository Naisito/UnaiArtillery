// ============================================================================
//  foCore.test.ts — P-VIVO.6: correcciones OT→ENU (casos cardinales), línea
//  de visión con perfiles sintéticos y escala de estrellas por rondas.
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  applyObserverCorrection, foStars, hasLineOfSight, improveFoRecord, opCandidates, otAxes,
} from './foCore';

describe('P-VIVO.6 — conversión OT→ENU (casos cardinales)', () => {
  it('OP al sur del objetivo (mirando al NORTE): derecha = este, largo = norte', () => {
    const op = { x: 0, y: -3000 };
    const target = { x: 0, y: 0 };
    const { along, right } = otAxes(op, target);
    expect(along.x).toBeCloseTo(0, 9);
    expect(along.y).toBeCloseTo(1, 9);
    expect(right.x).toBeCloseTo(1, 9);
    expect(right.y).toBeCloseTo(0, 9);

    // "Derecha 50, largo 100" desde el punto de puntería vigente.
    const moved = applyObserverCorrection({ x: 10, y: 20 }, op, target, 50, 100);
    expect(moved.x).toBeCloseTo(60, 9);
    expect(moved.y).toBeCloseTo(120, 9);
  });

  it('OP al este del objetivo (mirando al OESTE): derecha = norte, corto = este', () => {
    const op = { x: 2500, y: 0 };
    const target = { x: 0, y: 0 };
    const { along, right } = otAxes(op, target);
    expect(along.x).toBeCloseTo(-1, 9); // "largo" aleja del OP: hacia el oeste
    expect(right.x).toBeCloseTo(0, 9);
    expect(right.y).toBeCloseTo(1, 9);  // tu derecha mirando al oeste es el norte

    const moved = applyObserverCorrection({ x: 0, y: 0 }, op, target, -25, -100);
    expect(moved.y).toBeCloseTo(-25, 9);  // izquierda 25 = sur
    expect(moved.x).toBeCloseTo(100, 9);  // corto 100 = hacia el OP (este)
  });
});

describe('P-VIVO.6 — línea de visión con perfiles sintéticos', () => {
  it('una cresta entre OP y objetivo BLOQUEA la visión', () => {
    // OP a 800 m, objetivo a 780 m, cresta de 900 m en medio.
    const profile = [800, 810, 850, 900, 850, 800, 780];
    expect(hasLineOfSight(profile)).toBe(false);
  });

  it('un valle en medio DEJA ver', () => {
    const profile = [800, 720, 640, 600, 640, 700, 780];
    expect(hasLineOfSight(profile)).toBe(true);
  });

  it('terreno llano ve; la altura del observador salva ondulaciones menores', () => {
    expect(hasLineOfSight([500, 500, 500, 500])).toBe(true);
    // Loma de 1 m con observador a 1.7 m: pasa por encima.
    expect(hasLineOfSight([500, 501, 500])).toBe(true);
  });

  it('perfiles triviales (2 muestras) nunca bloquean', () => {
    expect(hasLineOfSight([100, 900])).toBe(true);
  });
});

describe('P-VIVO.6 — candidatos de OP y estrellas', () => {
  it('candidatos a 2-4 km del objetivo, alternando lado, deterministas', () => {
    // RNG determinista trivial.
    let s = 42;
    const rng = () => {
      s = (s * 16807) % 2147483647;
      return (s % 10000) / 10000;
    };
    const target = { x: 4000, y: 3000 };
    const cands = opCandidates(rng, target, 8);
    expect(cands.length).toBe(8);
    for (const c of cands) {
      const d = Math.hypot(c.x - target.x, c.y - target.y);
      expect(d).toBeGreaterThan(600);   // acortado en reintentos, nunca encima
      expect(d).toBeLessThan(4100);
    }
    // Los primeros dos caen a lados OPUESTOS de la línea batería→objetivo.
    const az = Math.atan2(target.x, target.y);
    const sideOf = (c: { x: number; y: number }) => {
      const dx = c.x - target.x;
      const dy = c.y - target.y;
      return Math.sign(dx * Math.cos(az) - dy * Math.sin(az));
    };
    expect(sideOf(cands[0])).not.toBe(sideOf(cands[1]));
  });

  it('estrellas por rondas: 1=★★★, 2-3=★★, 4-6=★, 7+=0', () => {
    expect(foStars(1)).toBe(3);
    expect(foStars(2)).toBe(2);
    expect(foStars(3)).toBe(2);
    expect(foStars(4)).toBe(1);
    expect(foStars(6)).toBe(1);
    expect(foStars(7)).toBe(0);
  });

  it('el récord FO solo mejora con menos rondas', () => {
    const first = improveFoRecord(null, 4);
    expect(first.improved).toBe(true);
    expect(first.record.stars).toBe(1);
    const worse = improveFoRecord(first.record, 5);
    expect(worse.improved).toBe(false);
    expect(worse.record.bestRounds).toBe(4);
    const better = improveFoRecord(first.record, 1);
    expect(better.improved).toBe(true);
    expect(better.record.stars).toBe(3);
  });
});
