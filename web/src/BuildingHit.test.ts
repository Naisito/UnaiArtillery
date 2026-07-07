// ============================================================================
//  BuildingHit.test.ts — P-VIVO.5: primer cruce polilínea vs alturas
//  muestreadas y umbral edificio/suelo, con alturas sintéticas.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { firstStructuralCrossing, tailSamples } from './BuildingHit';

describe('P-VIVO.5 — cola submuestreada de la trayectoria', () => {
  it('devuelve los últimos ~2 km cada ~15 m e incluye SIEMPRE el impacto', () => {
    // Trayectoria recta de 10 km muestreada cada 5 m.
    const pts = Array.from({ length: 2001 }, (_, i) => ({
      t: i * 0.1, x: i * 5, y: 0, z: 500 - i * 0.25,
    }));
    const tail = tailSamples(pts);
    // Empieza a ~2 km del final…
    expect(tail[0].x).toBeGreaterThanOrEqual(10000 - 2000 - 5);
    // …los pasos son de ~15 m (el ÚLTIMO puede ser más corto: es el impacto,
    // que se incluye siempre esté donde esté)…
    for (let i = 1; i < tail.length - 1; i++) {
      expect(tail[i].x - tail[i - 1].x).toBeGreaterThanOrEqual(15 - 1e-9);
      expect(tail[i].x - tail[i - 1].x).toBeLessThan(30);
    }
    // …y el último punto ES el impacto.
    expect(tail[tail.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('trayectorias triviales no rompen', () => {
    expect(tailSamples([])).toEqual([]);
    expect(tailSamples([{ t: 0, x: 0, y: 0, z: 10 }])).toEqual([]);
  });
});

describe('P-VIVO.5 — primer cruce estructural (alturas sintéticas)', () => {
  // Tiro tenso que baja de 60 a 0 m sobre terreno llano a 0 m.
  const flightZ = [60, 50, 40, 30, 20, 10, 0];
  const flatTerrain = [0, 0, 0, 0, 0, 0, 0];

  it('una torre intercepta un tiro tenso: recorta EN la torre', () => {
    // Torre de 45 m visual en el índice 3 (terreno 0): 30 < 45 y 45-0 > 3.
    const visual = [0, 0, 0, 45, 0, 0, 0];
    expect(firstStructuralCrossing(flightZ, visual, flatTerrain)).toBe(3);
  });

  it('un tiro alto SOBREVUELA la torre y no se recorta en ella', () => {
    // La misma torre pero el vuelo pasa por encima (z=80 en ese punto):
    // el primer punto bajo el visual es el impacto contra suelo visual (≤3 m).
    const high = [200, 170, 140, 80, 50, 20, 0];
    const visual = [0, 0, 0, 45, 0, 0, 0.5];
    expect(firstStructuralCrossing(high, visual, flatTerrain)).toBeNull();
  });

  it('cruce contra el SUELO visual (≤3 m sobre el corredor) no recorta', () => {
    // Suelo visual 2 m por encima del corredor en todas partes: no es edificio.
    const visual = [2, 2, 2, 2, 2, 2, 2];
    expect(firstStructuralCrossing(flightZ, visual, flatTerrain)).toBeNull();
  });

  it('muestreo incompleto (null/NaN) = SIN recorte, aunque haya torre después', () => {
    const visual: (number | null)[] = [0, null, 0, 45, 0, 0, 0];
    expect(firstStructuralCrossing(flightZ, visual, flatTerrain)).toBeNull();
    const visualNaN: (number | null)[] = [0, Number.NaN, 0, 45, 0, 0, 0];
    expect(firstStructuralCrossing(flightZ, visualNaN, flatTerrain)).toBeNull();
  });

  it('el umbral usa el TERRENO DEL CORREDOR, no el cero: ladera con edificio', () => {
    // Corredor que sube a 30 m; visual = corredor salvo un edificio de 12 m
    // sobre la ladera en el índice 2.
    const terrain = [0, 10, 20, 25, 30, 30, 30];
    const visual = [0, 10, 32, 25, 30, 30, 30];
    const flight = [60, 45, 30, 20, 10, 5, 0]; // cruza el visual en el índice 2
    expect(firstStructuralCrossing(flight, visual, terrain)).toBe(2);
    // Sin edificio (visual == terreno) el mismo vuelo no recorta.
    expect(firstStructuralCrossing(flight, terrain, terrain)).toBeNull();
  });
});
