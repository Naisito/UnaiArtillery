// ============================================================================
//  units.ts — Unidades y formatos de la estación de tiro (lógica PURA).
//
//  * Milésimas OTAN: 6400 mil = 360° (STANAG 2934). Son la unidad principal
//    de azimut y elevación; los grados quedan como secundaria (el usuario
//    puede invertirlo en Ajustes).
//  * Distancias: m por debajo de 1 km, km con 2 decimales por encima.
//  * Coordenadas: MGRS (paquete `mgrs`, WGS84) o lat/lon decimal / DMS.
//
//  Sin DOM ni Cesium: testeable en el entorno node de Vitest.
// ============================================================================
import { forward as mgrsForward } from 'mgrs';

export type AngleUnit = 'mil' | 'deg';
export type CoordFormat = 'mgrs' | 'dd' | 'dms';

export const MILS_PER_TURN = 6400;
const MIL_PER_DEG = MILS_PER_TURN / 360;

export const degToMil = (deg: number): number => deg * MIL_PER_DEG;
export const milToDeg = (mil: number): number => mil / MIL_PER_DEG;

/** Ángulo de rumbo normalizado a [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Rumbo (0 = N, 90 = E) de un vector ENU horizontal. */
export function bearingDegOf(dx: number, dy: number): number {
  return normDeg((Math.atan2(dx, dy) * 180) / Math.PI);
}

/** Convierte un ángulo en grados a la unidad pedida. */
export function toUnit(deg: number, unit: AngleUnit): number {
  return unit === 'mil' ? degToMil(deg) : deg;
}

/** Convierte un valor en la unidad pedida a grados. */
export function fromUnit(value: number, unit: AngleUnit): number {
  return unit === 'mil' ? milToDeg(value) : value;
}

export const UNIT_SUFFIX: Record<AngleUnit, string> = { mil: 'mil', deg: '°' };

/** Decimales de presentación por unidad: 0.1 mil ≈ 0.0056°, 0.01° ≈ 0.18 mil. */
export const UNIT_DECIMALS: Record<AngleUnit, number> = { mil: 1, deg: 2 };

/** Número con N decimales y separador de miles fino (lectura de consola). */
export function fmtNum(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return '—';
  const fixed = Math.abs(v).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  // Separador de miles fino solo desde 5 cifras: 1600 mil se lee de un
  // golpe (así se cantan las milésimas); 24 700 m agradece el separador.
  const grouped = int.length >= 5 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') : int;
  return `${v < 0 && Number(fixed) !== 0 ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Ángulo formateado en la unidad pedida (sin sufijo). */
export function fmtAngleValue(deg: number, unit: AngleUnit, decimals = UNIT_DECIMALS[unit]): string {
  return fmtNum(toUnit(deg, unit), decimals);
}

/** Ángulo con sufijo: "1600.0 mil" / "90.00°". */
export function fmtAngle(deg: number, unit: AngleUnit, decimals = UNIT_DECIMALS[unit]): string {
  const v = fmtAngleValue(deg, unit, decimals);
  return unit === 'mil' ? `${v} mil` : `${v}°`;
}

/** Distancia en {valor, unidad}: m bajo 1 km, km con 2 (o 1) decimales. */
export function distanceParts(m: number): { value: string; unit: string } {
  if (!Number.isFinite(m)) return { value: '—', unit: '' };
  const a = Math.abs(m);
  if (a < 1000) return { value: fmtNum(m, 0), unit: 'm' };
  if (a < 100_000) return { value: fmtNum(m / 1000, 2), unit: 'km' };
  return { value: fmtNum(m / 1000, 1), unit: 'km' };
}

export function fmtDistance(m: number): string {
  const p = distanceParts(m);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/** Duración en s (1 decimal) o min:s por encima de 100 s. */
export function fmtSeconds(s: number): string {
  if (!Number.isFinite(s)) return '—';
  if (s < 100) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m} min ${String(r).padStart(2, '0')} s`;
}

/** MGRS con espacios de lectura: "30T VK 12345 67890" (precisión 1 m). */
export function toMgrs(latDeg: number, lonDeg: number, digits = 5): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return '—';
  if (latDeg > 84 || latDeg < -80) return 'Fuera de MGRS (UPS)';
  try {
    const raw = mgrsForward([lonDeg, latDeg], digits);
    const m = /^(\d{1,2}[C-X])([A-Z]{2})(\d*)$/.exec(raw);
    if (!m) return raw;
    const nums = m[3];
    const half = nums.length / 2;
    return `${m[1]} ${m[2]} ${nums.slice(0, half)} ${nums.slice(half)}`.trim();
  } catch {
    return '—';
  }
}

/** Lat/lon decimal: "40.75000° N  3.90000° W". */
export function fmtLatLonDD(latDeg: number, lonDeg: number, decimals = 5): string {
  const ns = latDeg >= 0 ? 'N' : 'S';
  const ew = lonDeg >= 0 ? 'E' : 'W';
  return `${Math.abs(latDeg).toFixed(decimals)}° ${ns}  ${Math.abs(lonDeg).toFixed(decimals)}° ${ew}`;
}

function dms(v: number): string {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = (a - d - m / 60) * 3600;
  if (s >= 59.95) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`;
}

/** Lat/lon sexagesimal: "40°45′00.0″ N  3°54′00.0″ W". */
export function fmtLatLonDMS(latDeg: number, lonDeg: number): string {
  return `${dms(latDeg)} ${latDeg >= 0 ? 'N' : 'S'}  ${dms(lonDeg)} ${lonDeg >= 0 ? 'E' : 'W'}`;
}

/** Coordenada en el formato elegido por el usuario. */
export function fmtCoord(latDeg: number, lonDeg: number, fmt: CoordFormat): string {
  switch (fmt) {
    case 'mgrs': return toMgrs(latDeg, lonDeg);
    case 'dms': return fmtLatLonDMS(latDeg, lonDeg);
    default: return fmtLatLonDD(latDeg, lonDeg);
  }
}

/**
 * Paso de puntería fina en GRADOS para una pulsación (teclado/rueda):
 * en milésimas 1 mil (Shift 0.1, Ctrl 10) — el brief del teclado —;
 * la rueda del cockpit usa `wheel` (10/1/100 mil · 0.5/0.05/5°).
 */
export function layStepDeg(
  unit: AngleUnit,
  mods: { shiftKey: boolean; ctrlKey: boolean },
  source: 'key' | 'wheel' = 'key',
): number {
  if (unit === 'mil') {
    const base = source === 'wheel' ? 10 : 1;
    const k = mods.ctrlKey ? 10 : mods.shiftKey ? 0.1 : 1;
    return milToDeg(base * k);
  }
  const base = source === 'wheel' ? 0.5 : 0.05;
  const k = mods.ctrlKey ? 10 : mods.shiftKey ? 0.1 : 1;
  return base * k;
}

/** Energía cinética (MJ) de una masa (kg) a una velocidad (m/s). */
export function kineticMJ(massKg: number, speedMS: number): number {
  return 0.5 * massKg * speedMS * speedMS * 1e-6;
}

/** Energía legible: J, kJ o MJ según magnitud. */
export function fmtEnergy(joules: number): string {
  const a = Math.abs(joules);
  if (a >= 1e6) return `${fmtNum(joules / 1e6, 1)} MJ`;
  if (a >= 1e3) return `${fmtNum(joules / 1e3, 1)} kJ`;
  return `${fmtNum(joules, 0)} J`;
}

/**
 * Descompone el error de un impacto respecto al objetivo en los ejes de la
 * línea de tiro (batería → objetivo): `rangeM` > 0 = LARGO, < 0 = CORTO;
 * `deflM` > 0 = a la DERECHA del rumbo, < 0 = a la izquierda.
 */
export function missComponents(
  impact: { x: number; y: number },
  target: { x: number; y: number },
): { missM: number; rangeM: number; deflM: number } {
  const len = Math.hypot(target.x, target.y);
  const ux = len > 1e-6 ? target.x / len : 0;
  const uy = len > 1e-6 ? target.y / len : 1;
  const dx = impact.x - target.x;
  const dy = impact.y - target.y;
  return {
    missM: Math.hypot(dx, dy),
    rangeM: dx * ux + dy * uy,
    deflM: dx * uy - dy * ux,
  };
}

/** Ángulo de caída (° bajo la horizontal) de un vector velocidad ENU. */
export function angleOfFallDeg(v: { x: number; y: number; z: number }): number {
  return (Math.atan2(-v.z, Math.hypot(v.x, v.y)) * 180) / Math.PI;
}

/** Error probable (EP) desde una σ: 0.6745·σ (tablas de tiro OTAN). */
export const probableError = (sigma: number): number => 0.6745 * sigma;

/** CEP aproximado de una elipse σx/σy (fórmula de Grubbs, ±10 %). */
export const cepFromSigmas = (sx: number, sy: number): number => 0.5887 * (sx + sy);
