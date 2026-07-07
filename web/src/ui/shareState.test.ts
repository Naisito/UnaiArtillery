// ============================================================================
//  shareState.test.ts — P-VIVO.10: round-trip exacto (tolerancia float en
//  lat/lon), rechazo limpio de hash corrupto y de versión futura, y campos
//  desconocidos ignorados (forward-compat).
// ============================================================================
import { describe, expect, it } from 'vitest';
import { SHARE_VERSION, ShareState, decodeState, encodeState } from './shareState';

const FULL: ShareState = {
  v: SHARE_VERSION,
  bat: { lat: 40.7512345, lon: -3.9123456 },
  w: 'm777',
  ri: 3,
  ci: 2,
  az: 123.456,
  el: 38.719,
  high: true,
  tgt: { e: 8123.4, n: -2456.7 },
  wx: { real: false, ws: 8, wb: 225, t: 28, p: 1002 },
  tog: { b: true, arc: false, night: true },
};

describe('P-VIVO.10 — shareState puro y versionado', () => {
  it('round-trip completo (tolerancia float por el redondeo)', () => {
    const encoded = encodeState(FULL);
    // URL-safe: nada de +, / ni = (van en location.hash).
    expect(encoded).not.toMatch(/[+/=]/);
    const back = decodeState(`#s=${encoded}`);
    expect(back.w).toBe('m777');
    expect(back.ri).toBe(3);
    expect(back.ci).toBe(2);
    expect(back.high).toBe(true);
    expect(back.bat.lat).toBeCloseTo(FULL.bat.lat, 4); // 5 decimales ≈ 1 m
    expect(back.bat.lon).toBeCloseTo(FULL.bat.lon, 4);
    expect(back.az).toBeCloseTo(123.46, 2);
    expect(back.el).toBeCloseTo(38.72, 2);
    expect(back.tgt!.e).toBeCloseTo(8123, 0);
    expect(back.tgt!.n).toBeCloseTo(-2457, 0);
    expect(back.wx).toEqual({ real: false, ws: 8, wb: 225, t: 28, p: 1002 });
    expect(back.tog).toEqual({ b: true, arc: false, night: true });
  });

  it('estado mínimo: solo batería + arma + puntería', () => {
    const s: ShareState = {
      v: SHARE_VERSION, bat: { lat: 0, lon: 0 }, w: 'mortar120', ri: 0, ci: -1, az: 90, el: 60,
    };
    const back = decodeState(encodeState(s));
    expect(back.w).toBe('mortar120');
    expect(back.ci).toBe(-1);
    expect(back.tgt).toBeUndefined();
    expect(back.wx).toBeUndefined();
  });

  it('rechaza limpio un hash corrupto', () => {
    expect(() => decodeState('#s=%%%no-base64%%%')).toThrow();
    expect(() => decodeState(`#s=${btoa('esto no es json')}`)).toThrow(/JSON|corrupto/);
    expect(() => decodeState('#s=')).toThrow();
    // JSON válido pero sin lo mínimo.
    expect(() => decodeState(`#s=${btoa('{"v":1}')}`)).toThrow(/batería/);
    expect(() => decodeState(`#s=${btoa('{"v":1,"bat":{"lat":200,"lon":0},"w":"m777"}')}`))
      .toThrow(/batería/);
  });

  it('rechaza limpio una versión futura', () => {
    const future = { ...FULL, v: SHARE_VERSION + 1 };
    const b64 = btoa(JSON.stringify(future));
    expect(() => decodeState(`#s=${b64}`)).toThrow(/versión más nueva/);
  });

  it('ignora campos desconocidos (forward-compat dentro de la versión)', () => {
    const withExtra = {
      ...FULL,
      unaCosaDelFuturo: { x: 1 },
      tgt: { e: 100, n: 200, algoNuevo: true },
    };
    const b64 = btoa(JSON.stringify(withExtra));
    const back = decodeState(`#s=${b64}`);
    expect(back.w).toBe('m777');
    expect(back.tgt).toEqual({ e: 100, n: 200 });
    expect((back as unknown as Record<string, unknown>).unaCosaDelFuturo).toBeUndefined();
  });
});
