// ============================================================================
//  map/grid.ts — Líneas de la rejilla MGRS/UTM para una vista.  [V2:MAP]
//
//  Dado el rectángulo geográfico visible y un paso (1 km / 10 km / 100 km),
//  genera las líneas de easting y northing constantes de cada zona UTM que
//  toca la vista, muestreadas en lat/lon y recortadas EXACTAMENTE en los
//  bordes de zona (bisección), con su rótulo de 2 cifras (km dentro del
//  cuadrado de 100 km) y si es línea mayor. También los rótulos de los
//  cuadrados de 100 km ("VK") cuando la vista es amplia. Módulo PURO.
//  Simplificación documentada: las zonas especiales de Noruega/Svalbard se
//  dibujan como zonas estándar de 6º.
// ============================================================================
import { centralMeridian, Hemisphere, mgrs100kId, utmForward, utmInverse } from './utm';

export interface GeoBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GridLine {
  axis: 'E' | 'N';
  value: number;
  zone: number;
  hemisphere: Hemisphere;
  major: boolean;
  label: string;
  /** Vértices [lonDeg, latDeg]. */
  points: [number, number][];
}

export interface SquareLabel {
  id: string;
  lonDeg: number;
  latDeg: number;
}

/** Paso de la rejilla según la altura de cámara (null = no dibujar). */
export function gridSpacingForHeight(cameraHeightM: number): number | null {
  if (!Number.isFinite(cameraHeightM) || cameraHeightM <= 0) return 1000;
  if (cameraHeightM < 28_000) return 1000;
  if (cameraHeightM < 320_000) return 10_000;
  if (cameraHeightM < 2_600_000) return 100_000;
  return null;
}

/** Semiextensión máxima alrededor del foco para cada paso (coste acotado). */
export function maxHalfExtentM(spacingM: number): number {
  return spacingM * 26;
}

/** Recorta la caja a ±halfM alrededor de (lat, lon) del foco. */
export function clampBoxAround(box: GeoBox, latDeg: number, lonDeg: number, halfM: number): GeoBox {
  const dLat = halfM / 111_320;
  const dLon = halfM / (111_320 * Math.max(0.05, Math.cos((latDeg * Math.PI) / 180)));
  return {
    west: Math.max(box.west, lonDeg - dLon),
    east: Math.min(box.east, lonDeg + dLon),
    south: Math.max(box.south, latDeg - dLat, -80),
    north: Math.min(box.north, latDeg + dLat, 84),
  };
}

function lineLabel(value: number, spacingM: number): string {
  if (spacingM >= 100_000) return '';
  const km = Math.round((((value % 100000) + 100000) % 100000) / 1000);
  return String(km).padStart(2, '0');
}

/**
 * Muestrea una línea UTM (parámetro t ∈ [t0, t1]) y la recorta a la franja
 * de longitudes de su zona; las salidas de zona se refinan por bisección.
 */
function sampleClipped(
  at: (t: number) => { latDeg: number; lonDeg: number },
  t0: number, t1: number, k: number, lonMin: number, lonMax: number,
): [number, number][][] {
  const inside = (p: { lonDeg: number }) => p.lonDeg >= lonMin - 1e-9 && p.lonDeg <= lonMax + 1e-9;
  const edge = (ta: number, tb: number) => {
    // ta dentro, tb fuera: bisección hasta ~1e-6 del tramo.
    let a = ta, b = tb;
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2;
      if (inside(at(m))) a = m;
      else b = m;
    }
    const p = at(a);
    return [Math.min(lonMax, Math.max(lonMin, p.lonDeg)), p.latDeg] as [number, number];
  };
  const parts: [number, number][][] = [];
  let cur: [number, number][] = [];
  let prevT = t0;
  let prevIn = false;
  for (let i = 0; i <= k; i++) {
    const t = t0 + ((t1 - t0) * i) / k;
    const p = at(t);
    const isIn = inside(p);
    if (isIn) {
      if (!prevIn && i > 0) cur.push(edge(t, prevT)); // entra
      cur.push([p.lonDeg, p.latDeg]);
    } else if (prevIn) {
      cur.push(edge(prevT, t)); // sale
      if (cur.length >= 2) parts.push(cur);
      cur = [];
    }
    prevIn = isIn;
    prevT = t;
  }
  if (cur.length >= 2) parts.push(cur);
  return parts;
}

/** Zonas UTM estándar que toca la caja. */
function zonesOf(box: GeoBox): number[] {
  const z0 = Math.floor((box.west + 180) / 6) + 1;
  const z1 = Math.floor((Math.min(box.east, 179.999) + 180) / 6) + 1;
  const out: number[] = [];
  for (let z = Math.max(1, z0); z <= Math.min(60, z1); z++) out.push(z);
  return out;
}

/** Partes de la caja por hemisferio (la rejilla cambia de origen en el ecuador). */
function hemisphereParts(box: GeoBox): { hemi: Hemisphere; box: GeoBox }[] {
  if (box.south >= 0) return [{ hemi: 'N', box }];
  if (box.north <= 0) return [{ hemi: 'S', box }];
  return [
    { hemi: 'N', box: { ...box, south: 0 } },
    { hemi: 'S', box: { ...box, north: 0 } },
  ];
}

export interface GridResult {
  lines: GridLine[];
  squares: SquareLabel[];
}

/**
 * Rejilla de la caja con paso `spacingM`. Si saldrían más de `maxLines`
 * líneas se devuelve vacía (el llamador debe subir el paso).
 */
export function buildGrid(box: GeoBox, spacingM: number, maxLines = 160): GridResult {
  const lines: GridLine[] = [];
  const squares: SquareLabel[] = [];
  if (!(box.east > box.west) || !(box.north > box.south)) return { lines, squares };

  for (const { hemi, box: hb } of hemisphereParts(box)) {
    for (const zone of zonesOf(hb)) {
      const cm = centralMeridian(zone);
      const lonMin = Math.max(hb.west, cm - 3);
      const lonMax = Math.min(hb.east, cm + 3);
      if (lonMax <= lonMin) continue;
      // Extensión UTM de la sub-caja: malla 5×5 de muestras.
      let eMin = Infinity, eMax = -Infinity, nMin = Infinity, nMax = -Infinity;
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          const lat = hb.south + ((hb.north - hb.south) * i) / 4;
          const lon = lonMin + ((lonMax - lonMin) * j) / 4;
          const u = utmForward(lat, lon, zone);
          const nn = hemi === 'S' && lat === 0 ? 10_000_000 : u.northing;
          eMin = Math.min(eMin, u.easting); eMax = Math.max(eMax, u.easting);
          nMin = Math.min(nMin, nn); nMax = Math.max(nMax, nn);
        }
      }
      const nE = Math.floor(eMax / spacingM) - Math.ceil(eMin / spacingM) + 1;
      const nN = Math.floor(nMax / spacingM) - Math.ceil(nMin / spacingM) + 1;
      if (lines.length + nE + nN > maxLines) return { lines: [], squares: [] };

      const majorEvery = spacingM < 10_000 ? 10_000 : 100_000;
      const kN = Math.min(48, Math.max(8, Math.ceil((nMax - nMin) / spacingM)));
      const kE = Math.min(48, Math.max(8, Math.ceil((eMax - eMin) / spacingM)));
      for (let e = Math.ceil(eMin / spacingM) * spacingM; e <= eMax; e += spacingM) {
        const parts = sampleClipped(
          (t) => utmInverse(zone, hemi, e, t), nMin, nMax, kN, lonMin, lonMax,
        );
        for (const points of parts) {
          lines.push({
            axis: 'E', value: e, zone, hemisphere: hemi,
            major: Math.abs(e % majorEvery) < 1e-6, label: lineLabel(e, spacingM), points,
          });
        }
      }
      for (let nv = Math.ceil(nMin / spacingM) * spacingM; nv <= nMax; nv += spacingM) {
        const parts = sampleClipped(
          (t) => utmInverse(zone, hemi, t, nv), eMin, eMax, kE, lonMin, lonMax,
        );
        for (const points of parts) {
          lines.push({
            axis: 'N', value: nv, zone, hemisphere: hemi,
            major: Math.abs(nv % majorEvery) < 1e-6, label: lineLabel(nv, spacingM), points,
          });
        }
      }

      // Rótulos de los cuadrados de 100 km (vista amplia).
      if (spacingM >= 10_000) {
        for (let e = Math.floor(eMin / 1e5) * 1e5; e < eMax; e += 1e5) {
          for (let nv = Math.floor(nMin / 1e5) * 1e5; nv < nMax; nv += 1e5) {
            const ce = Math.min(Math.max(e + 5e4, eMin), eMax);
            const cn = Math.min(Math.max(nv + 5e4, nMin), nMax);
            const ll = utmInverse(zone, hemi, ce, cn);
            if (ll.lonDeg < lonMin || ll.lonDeg > lonMax) continue;
            if (e < 1e5 || e >= 9e5) continue; // fuera de las columnas válidas
            squares.push({ id: mgrs100kId(zone, e + 1, nv + 1), lonDeg: ll.lonDeg, latDeg: ll.latDeg });
          }
        }
      }
    }
  }
  return { lines, squares };
}
