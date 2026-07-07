// ============================================================================
//  MovingTarget.test.ts — P-VIVO.7: propagación pura, altura interpolada,
//  extrapolación del fantasma y puntuación en el instante del impacto.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { TargetMotion, heightAlong } from './MovingTarget';
import { starsForMiss } from './ui/challengeCore';

describe('P-VIVO.7 — propagación pura del blanco móvil', () => {
  it('avanza con rumbo y velocidad constantes (brújula: 0=N, 90=E)', () => {
    const east = new TargetMotion({ x: 100, y: 200 }, 90, 20);
    expect(east.positionAt(0)).toEqual({ x: 100, y: 200 });
    expect(east.positionAt(10).x).toBeCloseTo(300, 9);
    expect(east.positionAt(10).y).toBeCloseTo(200, 9);

    const north = new TargetMotion({ x: 0, y: 0 }, 0, 11.11); // ~40 km/h
    const p = north.positionAt(40);
    expect(p.y).toBeCloseTo(444.4, 1); // la lección: 40 s de TOF = 444 m
    expect(p.x).toBeCloseTo(0, 9);
  });

  it('es determinista y su distancia recorrida es monótona', () => {
    const a = new TargetMotion({ x: 5, y: -3 }, 213, 16.7);
    const b = new TargetMotion({ x: 5, y: -3 }, 213, 16.7);
    for (const t of [0, 3.7, 12.2, 60]) {
      expect(a.positionAt(t)).toEqual(b.positionAt(t));
    }
    expect(a.distanceAt(10)).toBeGreaterThan(a.distanceAt(5));
    expect(a.distanceAt(10)).toBeCloseTo(167, 6);
  });

  it('rebase re-ancla sin teleportar y conserva la distancia acumulada', () => {
    const m = new TargetMotion({ x: 0, y: 0 }, 0, 10); // al norte
    const at10 = m.positionAt(10);
    m.rebase(10, 180); // media vuelta
    // Justo tras el rebase sigue en el mismo sitio…
    expect(m.positionAt(10)).toEqual(at10);
    // …y 5 s después ha desandado 50 m hacia el sur.
    expect(m.positionAt(15).y).toBeCloseTo(at10.y - 50, 9);
    // La distancia total sigue creciendo (alimenta la altura del camino).
    expect(m.distanceAt(15)).toBeCloseTo(150, 9);
  });

  it('altura del camino: interpolación lineal con clamp en los bordes', () => {
    const samples = [100, 110, 130];
    expect(heightAlong(samples, 50, 0)).toBe(100);
    expect(heightAlong(samples, 50, 25)).toBeCloseTo(105, 9);
    expect(heightAlong(samples, 50, 75)).toBeCloseTo(120, 9);
    expect(heightAlong(samples, 50, 9999)).toBe(130); // clamp final
    expect(heightAlong(samples, 50, -5)).toBe(100);   // clamp inicial
  });
});

describe('P-VIVO.7 — fantasma de adelanto y puntuación en t de impacto', () => {
  it('el fantasma es la posición extrapolada al TOF: apuntar ahí acierta', () => {
    const m = new TargetMotion({ x: 1000, y: 4000 }, 90, 12);
    const tofS = 35;
    const now = 8.5;
    const ghost = m.positionAt(now + tofS); // donde pinta el fantasma
    // El tiro sale AHORA y vuela TOF: el blanco está exactamente ahí.
    const atImpact = m.positionAt(now + tofS);
    expect(Math.hypot(ghost.x - atImpact.x, ghost.y - atImpact.y)).toBe(0);
  });

  it('sin adelanto se falla por ≈ v·TOF; con blanco sintético puntúa 0★', () => {
    const speed = 16.7; // 60 km/h
    const tofS = 30;
    const m = new TargetMotion({ x: 0, y: 5000 }, 90, speed);
    // Apuntas a DONDE ESTABA al disparar (t=0); el impacto llega en t=TOF.
    const aimed = m.positionAt(0);
    const actual = m.positionAt(tofS);
    const missM = Math.hypot(aimed.x - actual.x, aimed.y - actual.y);
    expect(missM).toBeCloseTo(speed * tofS, 6); // ≈ 501 m
    expect(starsForMiss(missM)).toBe(0);
    // Apuntando al fantasma (posición en t=TOF) el fallo es 0 → ★★★.
    expect(starsForMiss(0)).toBe(3);
  });
});
