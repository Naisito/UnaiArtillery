// Tests de geodesia, UTM/MGRS, rejilla, escala y LOS.  [V2:MAP]
import { describe, expect, it } from 'vitest';
import { forward as mgrsForward } from 'mgrs';
import { earthBulgeM, vincentyDirect, vincentyInverse } from './geodesy';
import { latBand, mgrs100kId, toMgrs, utmForward, utmInverse, utmZoneOf } from './utm';
import { buildGrid, clampBoxAround, gridSpacingForHeight } from './grid';
import { computeScaleBar, niceFloor, scaleLabel } from './scale';
import { lineOfSight } from './los';

const dmsToDeg = (d: number, m: number, s: number) => Math.sign(d) * (Math.abs(d) + m / 60 + s / 3600);

describe('Vincenty', () => {
  // Ejemplo clásico del artículo de Vincenty (1975): Flinders Peak → Buninyong.
  const lat1 = dmsToDeg(-37, 57, 3.7203);
  const lon1 = dmsToDeg(144, 25, 29.5244);
  const lat2 = dmsToDeg(-37, 39, 10.1561);
  const lon2 = dmsToDeg(143, 55, 35.3839);

  it('inverso: distancia y rumbos de referencia', () => {
    const r = vincentyInverse(lat1, lon1, lat2, lon2);
    expect(r.distanceM).toBeCloseTo(54972.271, 2);
    expect(r.initialBearingDeg).toBeCloseTo(dmsToDeg(306, 52, 5.37), 4);
    expect(r.finalBearingDeg).toBeCloseTo(dmsToDeg(307, 10, 25.07), 4);
  });

  it('directo: recupera el destino', () => {
    const d = vincentyDirect(lat1, lon1, dmsToDeg(306, 52, 5.37), 54972.271);
    expect(d.latDeg).toBeCloseTo(lat2, 6);
    expect(d.lonDeg).toBeCloseTo(lon2, 6);
  });

  it('puntos coincidentes y rumbo al este', () => {
    expect(vincentyInverse(40, -3, 40, -3).distanceM).toBe(0);
    const e = vincentyInverse(0, 0, 0, 1);
    expect(e.initialBearingDeg).toBeCloseTo(90, 6);
    expect(e.distanceM).toBeCloseTo(111319.49, 1);
  });

  it('abombamiento terrestre con refracción', () => {
    // A mitad de 20 km, con k = 0.13: 10·10 km² / (2·R/(1-0.13)) ≈ 6.8 m.
    expect(earthBulgeM(10_000, 20_000)).toBeCloseTo(6.83, 1);
    expect(earthBulgeM(0, 20_000)).toBe(0);
  });
});

describe('UTM / MGRS', () => {
  it('zonas, excepciones y bandas', () => {
    expect(utmZoneOf(40.75, -3.9)).toBe(30);
    expect(utmZoneOf(60, 5)).toBe(32); // Noruega
    expect(utmZoneOf(78, 15)).toBe(33); // Svalbard
    expect(latBand(40.75)).toBe('T');
    expect(latBand(-33)).toBe('H');
    expect(latBand(83)).toBe('X');
    expect(latBand(-81)).toBe('');
  });

  it('el meridiano central da E = 500 000 y el ecuador N = 0', () => {
    const u = utmForward(0, 3);
    expect(u.zone).toBe(31);
    expect(u.easting).toBeCloseTo(500000, 6);
    expect(u.northing).toBeCloseTo(0, 6);
  });

  it('ida y vuelta submilimétrica en toda la zona', () => {
    for (const [lat, lon] of [[40.75, -3.9], [-33.9, 18.4], [64.1, -21.9], [1.3, 103.8], [40.2, -5.95]]) {
      const u = utmForward(lat, lon);
      const back = utmInverse(u.zone, u.hemisphere, u.easting, u.northing);
      expect(back.latDeg).toBeCloseTo(lat, 9);
      expect(back.lonDeg).toBeCloseTo(lon, 9);
    }
  });

  it('coincide con el paquete mgrs (±1 m)', () => {
    for (const [lat, lon] of [[40.75, -3.9], [-33.92, 18.42], [51.47, -0.0015], [35.68, 139.69], [-22.9, -43.2]]) {
      const mine = toMgrs(lat, lon, 5);
      const ref = mgrsForward([lon, lat], 5);
      expect(mine.slice(0, -10)).toBe(ref.slice(0, -10)); // zona+banda+cuadrado
      const de = Math.abs(Number(mine.slice(-10, -5)) - Number(ref.slice(-10, -5)));
      const dn = Math.abs(Number(mine.slice(-5)) - Number(ref.slice(-5)));
      expect(de).toBeLessThanOrEqual(1);
      expect(dn).toBeLessThanOrEqual(1);
    }
  });

  it('identificador de 100 km (Guadarrama → VL)', () => {
    const u = utmForward(40.75, -3.9);
    expect(mgrs100kId(u.zone, u.easting, u.northing)).toBe('VL');
    expect(toMgrs(40.75, -3.9, 0)).toBe('30TVL');
  });
});

describe('rejilla MGRS', () => {
  it('paso según altura de cámara', () => {
    expect(gridSpacingForHeight(5_000)).toBe(1000);
    expect(gridSpacingForHeight(100_000)).toBe(10_000);
    expect(gridSpacingForHeight(1_000_000)).toBe(100_000);
    expect(gridSpacingForHeight(9_000_000)).toBeNull();
  });

  it('líneas de 1 km alrededor de la batería, con rótulos de 2 cifras', () => {
    const box = clampBoxAround({ west: -4.2, south: 40.5, east: -3.6, north: 41 }, 40.75, -3.9, 5000);
    const { lines } = buildGrid(box, 1000);
    expect(lines.length).toBeGreaterThan(12);
    expect(lines.length).toBeLessThan(30);
    for (const l of lines) {
      expect(l.label).toMatch(/^\d\d$/);
      // Cada vértice cae sobre su línea UTM (error < 1 m).
      const mid = l.points[Math.floor(l.points.length / 2)];
      const u = utmForward(mid[1], mid[0], l.zone);
      expect(Math.abs((l.axis === 'E' ? u.easting : u.northing) - l.value)).toBeLessThan(1);
    }
  });

  it('recorta exactamente en el borde de zona', () => {
    // Caja a caballo del meridiano 0 (zonas 30 y 31).
    const { lines } = buildGrid({ west: -0.3, south: 40, east: 0.3, north: 40.2 }, 10_000);
    const z30 = lines.filter((l) => l.zone === 30 && l.axis === 'N');
    expect(z30.length).toBeGreaterThan(0);
    const maxLon = Math.max(...z30.flatMap((l) => l.points.map((p) => p[0])));
    expect(maxLon).toBeLessThanOrEqual(1e-9);
    expect(maxLon).toBeGreaterThan(-1e-4);
  });

  it('rehúsa rejillas desmesuradas', () => {
    const { lines } = buildGrid({ west: -10, south: 35, east: 5, north: 44 }, 1000, 160);
    expect(lines).toEqual([]);
  });
});

describe('barra de escala', () => {
  it('números 1·2·5', () => {
    expect(niceFloor(7.3)).toBe(5);
    expect(niceFloor(19)).toBe(10);
    expect(niceFloor(2300)).toBe(2000);
    expect(scaleLabel(500)).toBe('500 m');
    expect(scaleLabel(20000)).toBe('20 km');
  });

  it('cabe en el ancho máximo y es ≥ 40 % de él', () => {
    for (const mpp of [0.37, 3.1, 18, 140, 2200]) {
      const s = computeScaleBar(mpp, 110)!;
      expect(s.px).toBeLessThanOrEqual(110.0001);
      expect(s.px).toBeGreaterThanOrEqual(110 * 0.4 - 1e-9);
    }
    expect(computeScaleBar(0)).toBeNull();
    expect(computeScaleBar(NaN)).toBeNull();
  });
});

describe('línea de visión', () => {
  const dist = Array.from({ length: 11 }, (_, i) => i * 100);

  it('terreno llano y corto: visible', () => {
    const r = lineOfSight(dist, dist.map(() => 500), 2, 2);
    expect(r.visible).toBe(true);
    expect(r.worstIndex).toBe(-1);
    expect(r.groundVisible.every(Boolean)).toBe(true);
  });

  it('una cresta en medio tapa y se localiza', () => {
    const h = dist.map((d) => (d === 600 ? 540 : 500));
    const r = lineOfSight(dist, h, 2, 2);
    expect(r.visible).toBe(false);
    expect(r.firstBlockIndex).toBe(6);
    expect(r.worstIndex).toBe(6);
    expect(r.worstExcessM).toBeGreaterThan(37);
    // Tras la cresta el suelo queda en ángulo muerto.
    expect(r.groundVisible[7]).toBe(false);
    expect(r.groundVisible[5]).toBe(true);
  });

  it('la curvatura esconde un blanco bajo a 30 km en llano', () => {
    const d = Array.from({ length: 31 }, (_, i) => i * 1000);
    const r = lineOfSight(d, d.map(() => 0), 2, 2);
    expect(r.visible).toBe(false);
    // ...pero no desde 300 m de altura (mástil/colina).
    expect(lineOfSight(d, d.map(() => 0), 300, 2).visible).toBe(true);
  });
});
