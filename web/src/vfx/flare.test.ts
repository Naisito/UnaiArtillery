// ============================================================================
//  flare.test.ts — P-VIVO.8: la bengala baja a 4.5 m/s, deriva con el perfil
//  de viento INYECTADO y se apaga al agotarse la composición.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { FLARE_DESCENT_MS, FLARE_LIFE_S, FlareKinematics } from './flare';

const calm = () => ({ x: 0, y: 0 });

describe('P-VIVO.8 — cinemática pura de la bengala', () => {
  it('altura(t): desciende exactamente a la tasa del paracaídas', () => {
    const f = new FlareKinematics({ x: 0, y: 0, z: 400 }, calm);
    expect(f.at(0).z).toBeCloseTo(400, 6);
    expect(f.at(10).z).toBeCloseTo(400 - FLARE_DESCENT_MS * 10, 3);
    expect(f.at(40).z).toBeCloseTo(400 - FLARE_DESCENT_MS * 40, 3);
    // Sin viento no hay deriva.
    expect(f.at(40).x).toBeCloseTo(0, 9);
    expect(f.at(40).y).toBeCloseTo(0, 9);
  });

  it('deriva con viento constante: x = v·t', () => {
    const f = new FlareKinematics({ x: 0, y: 0, z: 500 }, () => ({ x: 6, y: -2 }));
    const p = f.at(20);
    expect(p.x).toBeCloseTo(120, 1);
    expect(p.y).toBeCloseTo(-40, 1);
  });

  it('deriva con PERFIL: usa el viento de la altitud que va cruzando', () => {
    // Cizalladura sintética: viento solo por encima de 300 m.
    const shear = (z: number) => ({ x: z > 300 ? 10 : 0, y: 0 });
    const f = new FlareKinematics({ x: 0, y: 0, z: 400 }, shear, { dtS: 0.1 });
    // Cruza 300 m en (400-300)/4.5 ≈ 22.2 s: hasta ahí deriva 10 m/s…
    const above = f.at(20);
    expect(above.x).toBeCloseTo(200, 0);
    // …y por debajo deja de derivar (la x se congela).
    const below = f.at(45);
    expect(below.x - f.at(30).x).toBeLessThan(f.at(20).x - f.at(5).x);
  });

  it('vida útil: plena luz, fundido final y muerte', () => {
    const f = new FlareKinematics({ x: 0, y: 0, z: 400 }, calm);
    expect(f.at(10).intensity).toBe(1);
    expect(f.at(10).alive).toBe(true);
    const fading = f.at(FLARE_LIFE_S - 2);
    expect(fading.intensity).toBeGreaterThan(0);
    expect(fading.intensity).toBeLessThan(1);
    const dead = f.at(FLARE_LIFE_S + 0.1);
    expect(dead.intensity).toBe(0);
    expect(dead.alive).toBe(false);
  });

  it('es determinista: dos instancias idénticas dan el mismo camino', () => {
    const wind = (z: number) => ({ x: Math.sin(z * 0.01) * 4, y: 2 });
    const a = new FlareKinematics({ x: 5, y: -3, z: 350 }, wind);
    const b = new FlareKinematics({ x: 5, y: -3, z: 350 }, wind);
    for (const t of [0, 7.3, 22.2, 41.9]) {
      expect(a.at(t)).toEqual(b.at(t));
    }
  });
});
