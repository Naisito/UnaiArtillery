// ============================================================================
//  dem.test.ts — Cliente del DEM (Open-Meteo Elevation) con fetcher inyectado.
//  Sin red: verifica troceo ≤100/petición, caché por coordenada cuantizada,
//  orden de resultados y degradación a null ante fallos.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { DemFetch, LatLonDeg, sampleDem } from './dem';

/** Fetcher falso: elevación = lat·1000 + lon (fácil de verificar). */
function makeFetcher(log: string[]): DemFetch {
  return (url: string) => {
    log.push(url);
    const u = new URL(url);
    const lats = u.searchParams.get('latitude')!.split(',').map(Number);
    const lons = u.searchParams.get('longitude')!.split(',').map(Number);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ elevation: lats.map((la, i) => la * 1000 + lons[i]) }),
    });
  };
}

const P = (latDeg: number, lonDeg: number): LatLonDeg => ({ latDeg, lonDeg });

describe('DEM Copernicus vía Open-Meteo (fix 3D)', () => {
  it('devuelve alturas en orden y trocea en peticiones de ≤100 puntos', async () => {
    const log: string[] = [];
    const cache = new Map<string, number>();
    const points = Array.from({ length: 230 }, (_, i) => P(40 + i * 0.01, -3 - i * 0.01));
    const h = await sampleDem(points, makeFetcher(log), cache);
    expect(h).not.toBeNull();
    expect(h!).toHaveLength(230);
    expect(h![0]).toBeCloseTo(40 * 1000 - 3, 6);
    expect(h![229]).toBeCloseTo((40 + 2.29) * 1000 + (-3 - 2.29), 6);
    expect(log).toHaveLength(3); // 100 + 100 + 30
    for (const url of log) {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      expect(n).toBeLessThanOrEqual(100);
    }
  });

  it('cachea por coordenada cuantizada: repetir el corredor no re-pide nada', async () => {
    const log: string[] = [];
    const cache = new Map<string, number>();
    const points = Array.from({ length: 50 }, (_, i) => P(41 + i * 0.005, -2));
    await sampleDem(points, makeFetcher(log), cache);
    expect(log).toHaveLength(1);
    const again = await sampleDem(points, makeFetcher(log), cache);
    expect(log).toHaveLength(1); // cero peticiones nuevas
    expect(again![7]).toBeCloseTo((41 + 7 * 0.005) * 1000 - 2, 6);
  });

  it('degrada a null ante error HTTP o respuesta malformada', async () => {
    const bad: DemFetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    expect(await sampleDem([P(40, -3)], bad, new Map())).toBeNull();

    const weird: DemFetch = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ elevation: 'nope' }) });
    expect(await sampleDem([P(40, -3)], weird, new Map())).toBeNull();

    const boom: DemFetch = () => Promise.reject(new Error('sin red'));
    expect(await sampleDem([P(40, -3)], boom, new Map())).toBeNull();
  });
});
