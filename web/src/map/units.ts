// ============================================================================
//  map/units.ts — Unidades y formatos de la estación de tiro.  [V2:MAP]
//
//  Milésimas OTAN (6400 ‹mil› = 360º) como unidad principal de azimut,
//  grados como secundaria; distancias en m/km; coordenadas en grados
//  decimales o GMS (grados-minutos-segundos) y MGRS con sus grupos
//  separados. Módulo PURO (sin Cesium ni DOM): testeable en Vitest.
// ============================================================================

export const MILS_PER_CIRCLE = 6400;

/** Espacio fino no separable: separador de miles legible en cifras. */
export const THIN = ' ';

export const degToMils = (deg: number): number => (deg * MILS_PER_CIRCLE) / 360;
export const milsToDeg = (mils: number): number => (mils * 360) / MILS_PER_CIRCLE;

/** Normaliza un ángulo a [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Diferencia angular con signo en (-180, 180]: b respecto de a. */
export function deltaDeg(a: number, b: number): number {
  let d = normDeg(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Azimut en milésimas con 4 cifras ("0435"); 6400 vuelve a "0000". */
export function formatMils(deg: number): string {
  let m = Math.round(degToMils(normDeg(deg)));
  if (m >= MILS_PER_CIRCLE) m -= MILS_PER_CIRCLE;
  return String(m).padStart(4, '0');
}

/** Azimut en grados con un decimal y 3 cifras enteras ("069.4°"). */
export function formatAzDeg(deg: number): string {
  let d = Math.round(normDeg(deg) * 10) / 10;
  if (d >= 360) d -= 360;
  const [i, f] = d.toFixed(1).split('.');
  return `${i.padStart(3, '0')}.${f}°`;
}

/** Ángulo de elevación (QE) en milésimas, sin relleno ("312"). */
export function formatElevMils(deg: number): string {
  return String(Math.round(degToMils(deg)));
}

/** Agrupa los miles con espacio fino: 12345 → "12 345". */
export function groupThousands(n: number): string {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return neg ? `−${out}` : out;
}

/**
 * Distancia legible con precisión acorde a la magnitud:
 * 850 m · 4.82 km · 48.2 km · 482 km.
 */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  const a = Math.abs(m);
  if (a < 1000) return `${Math.round(m)} m`;
  if (a < 10_000) return `${(m / 1000).toFixed(2)} km`;
  if (a < 100_000) return `${(m / 1000).toFixed(1)} km`;
  return `${groupThousands(m / 1000)} km`;
}

/** Altura/cota en metros con separador de miles ("1 234 m"). */
export function formatHeight(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return `${groupThousands(m)} m`;
}

/** Desnivel con signo explícito ("+45 m", "−120 m"). */
export function formatSignedHeight(m: number): string {
  if (!Number.isFinite(m)) return '—';
  const r = Math.round(m);
  if (r === 0) return '±0 m';
  return r > 0 ? `+${groupThousands(r)} m` : `${groupThousands(r)} m`;
}

export type CoordFormat = 'dec' | 'dms';

/** GMS de un valor absoluto en grados con décimas de segundo y acarreo. */
function dms(absDeg: number, degDigits: number): string {
  // Se trabaja en décimas de segundo enteras: el redondeo a 60.0" acarrea.
  const tenths = Math.round(absDeg * 36000);
  const d = Math.floor(tenths / 36000);
  const rem = tenths - d * 36000;
  const m = Math.floor(rem / 600);
  const s = (rem - m * 600) / 10;
  return (
    `${String(d).padStart(degDigits, '0')}°` +
    `${String(m).padStart(2, '0')}′` +
    `${s.toFixed(1).padStart(4, '0')}″`
  );
}

/** Latitud: "40.75123° N" o "40°45′04.4″ N". */
export function formatLat(latDeg: number, fmt: CoordFormat = 'dec'): string {
  const h = latDeg >= 0 ? 'N' : 'S';
  const a = Math.abs(latDeg);
  return fmt === 'dms' ? `${dms(a, 2)} ${h}` : `${a.toFixed(5)}° ${h}`;
}

/** Longitud: "3.90012° W" o "003°54′00.4″ W" (O/W: notación OTAN en inglés). */
export function formatLon(lonDeg: number, fmt: CoordFormat = 'dec'): string {
  const h = lonDeg >= 0 ? 'E' : 'W';
  const a = Math.abs(lonDeg);
  return fmt === 'dms' ? `${dms(a, 3)} ${h}` : `${a.toFixed(5)}° ${h}`;
}

/** Par lat/lon para copiar al portapapeles: "40.751230, -3.900120". */
export function latLonPlain(latDeg: number, lonDeg: number): string {
  return `${latDeg.toFixed(6)}, ${lonDeg.toFixed(6)}`;
}

/**
 * Separa una referencia MGRS compacta en sus grupos:
 * "30TVK1234567890" → "30T VK 12345 67890". Acepta precisiones 0–5.
 */
export function formatMgrs(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  const m = /^(\d{1,2}[C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d*)$/.exec(s);
  if (!m) return raw;
  const digits = m[3];
  if (digits.length === 0 || digits.length % 2 !== 0) return `${m[1]} ${m[2]}${digits ? ` ${digits}` : ''}`;
  const half = digits.length / 2;
  return `${m[1]} ${m[2]} ${digits.slice(0, half)} ${digits.slice(half)}`;
}

/** Tiempo de vuelo/segundos con un decimal ("32.1 s"). */
export function formatSeconds(s: number): string {
  return Number.isFinite(s) ? `${s.toFixed(1)} s` : '—';
}
