// ============================================================================
//  map/utm.ts — UTM directa/inversa y referencias MGRS.  [V2:MAP]
//
//  Proyección Transversa de Mercator con las series de Krüger hasta n⁴
//  (Karney 2011): error < 1 mm dentro de la zona. Incluye las excepciones de
//  zona de Noruega (32V) y Svalbard (31X–37X), las bandas de latitud C–X y
//  el identificador del cuadrado de 100 km (esquema AA del WGS84).
//  Módulo PURO: lo usan la rejilla MGRS y las etiquetas; Vitest lo valida
//  contra el paquete `mgrs` y con ida y vuelta directa→inversa.
// ============================================================================

const A_WGS = 6378137.0;
const F_WGS = 1 / 298.257223563;
const K0 = 0.9996;
const E0 = 500000;
const N0_SOUTH = 10000000;
const RAD = Math.PI / 180;

const n = F_WGS / (2 - F_WGS);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
/** Radio rectificante (A mayúscula de Krüger). */
const AK = (A_WGS / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const ALPHA = [
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4,
  (61 / 240) * n3 - (103 / 140) * n4,
  (49561 / 161280) * n4,
];
const BETA = [
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4,
  (17 / 480) * n3 - (37 / 840) * n4,
  (4397 / 161280) * n4,
];
const DELTA = [
  2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4,
  (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4,
  (56 / 15) * n3 - (136 / 35) * n4,
  (4279 / 630) * n4,
];
const TWO_SQRT_N = (2 * Math.sqrt(n)) / (1 + n);

export type Hemisphere = 'N' | 'S';

export interface Utm {
  zone: number;
  hemisphere: Hemisphere;
  band: string;
  easting: number;
  northing: number;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

/** Banda de latitud MGRS (C..X; X abarca 72–84º). '' fuera de UTM. */
export function latBand(latDeg: number): string {
  if (latDeg < -80 || latDeg > 84) return '';
  const i = Math.min(19, Math.floor((latDeg + 80) / 8));
  return BANDS[i];
}

/** Zona UTM con las excepciones de Noruega y Svalbard. */
export function utmZoneOf(latDeg: number, lonDeg: number): number {
  const lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  if (latDeg >= 56 && latDeg < 64 && lon >= 3 && lon < 12) zone = 32;
  if (latDeg >= 72 && latDeg <= 84 && lon >= 0 && lon < 42) {
    if (lon < 9) zone = 31;
    else if (lon < 21) zone = 33;
    else if (lon < 33) zone = 35;
    else zone = 37;
  }
  return zone;
}

/** Meridiano central de una zona (grados). */
export function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/**
 * Directa: lat/lon (grados) → UTM. `forceZone` proyecta en una zona
 * concreta (la rejilla dibuja una zona entera aunque desborde un poco).
 */
export function utmForward(latDeg: number, lonDeg: number, forceZone?: number): Utm {
  const zone = forceZone ?? utmZoneOf(latDeg, lonDeg);
  const phi = latDeg * RAD;
  let dl = (lonDeg - centralMeridian(zone)) % 360;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  const lam = dl * RAD;

  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - TWO_SQRT_N * Math.atanh(TWO_SQRT_N * sinPhi));
  const xiP = Math.atan2(t, Math.cos(lam));
  const etaP = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));

  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 4; j++) {
    const a = ALPHA[j - 1];
    xi += a * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += a * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const hemisphere: Hemisphere = latDeg >= 0 ? 'N' : 'S';
  return {
    zone,
    hemisphere,
    band: latBand(latDeg),
    easting: E0 + K0 * AK * eta,
    northing: (hemisphere === 'S' ? N0_SOUTH : 0) + K0 * AK * xi,
  };
}

/** Inversa: UTM → lat/lon (grados). */
export function utmInverse(
  zone: number, hemisphere: Hemisphere, easting: number, northing: number,
): { latDeg: number; lonDeg: number } {
  const xi = (northing - (hemisphere === 'S' ? N0_SOUTH : 0)) / (K0 * AK);
  const eta = (easting - E0) / (K0 * AK);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 4; j++) {
    const b = BETA[j - 1];
    xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { latDeg: phi / RAD, lonDeg: centralMeridian(zone) + lam / RAD };
}

const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/** Identificador de 2 letras del cuadrado de 100 km (esquema AA, WGS84). */
export function mgrs100kId(zone: number, easting: number, northing: number): string {
  const col = Math.floor(easting / 100000); // 1..8
  const set = COL_SETS[(zone - 1) % 3];
  const colLetter = set[Math.min(7, Math.max(0, col - 1))];
  const rowIdx = (Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20;
  return `${colLetter}${ROW_LETTERS[(rowIdx + 20) % 20]}`;
}

/**
 * Referencia MGRS compacta ("30TVK1234567890") con `digits` cifras por eje
 * (5 = 1 m). Como manda la norma, las cifras se TRUNCAN (la referencia
 * designa el cuadrado que contiene el punto), no se redondean.
 */
export function toMgrs(latDeg: number, lonDeg: number, digits = 5): string {
  const u = utmForward(latDeg, lonDeg);
  const id = mgrs100kId(u.zone, u.easting, u.northing);
  const div = 10 ** (5 - digits);
  const e = Math.floor((u.easting % 100000) / div);
  const nn = Math.floor((u.northing % 100000) / div);
  const ds = digits > 0 ? String(e).padStart(digits, '0') + String(nn).padStart(digits, '0') : '';
  return `${u.zone}${u.band}${id}${ds}`;
}
