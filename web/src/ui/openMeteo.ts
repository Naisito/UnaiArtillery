// ============================================================================
//  openMeteo.ts — Meteorología real de Open-Meteo (gratis, sin clave). [P-PRO.2]
//
//  api.open-meteo.com da viento por NIVELES DE PRESIÓN (1000→200 hPa ≈
//  0–12 km) y condiciones de superficie en cualquier lat/lon. Aquí:
//
//    * parseOpenMeteo(json, h) — PURA (testeable con fixture): convierte la
//      respuesta en { profile, seaLevelTempK, seaLevelPressurePa }.
//      - Reducción barométrica a nivel del mar desde la altura h de la
//        batería: T_msl = T_2m + 0.0065·h, P_msl = P_surf·e^(g·h/(R·T_media)).
//      - Cada nivel de presión se pasa a altitud con
//        Atmosphere.altitudeForPressure sobre el modelo YA corregido, y se
//        expresa RELATIVO a la batería (el solver muestrea el viento en z
//        ENU): así el viento de 850 hPa sopla a su altura real sobre el
//        terreno, no desplazado por la cota de la batería.
//      - Niveles bajo tierra en esa batería (p.ej. 1000 hPa a 1000 m de
//        cota) se descartan; solo se usan los presentes en la respuesta.
//    * fetchOpenMeteo(lon, lat, h) — el fetch real con caché de 15 min por
//      celda de ~1 km (Open-Meteo actualiza por horas; no hay que martillear).
//
//  Sin red o JSON inválido: se lanza (el panel hace toast y conserva el modo
//  manual).
// ============================================================================
import { Atmosphere, WindProfilePoint } from '../ballistics';

const G0 = 9.80665;
const R_AIR = 287.05287;

/** Niveles de presión que pedimos (hPa), de suelo a ~12 km. */
export const OPEN_METEO_LEVELS = [1000, 925, 850, 700, 500, 300, 200] as const;

export interface OpenMeteoLevel {
  hPa: number;
  altitudeMslM: number;   // altitud del nivel sobre el mar (modelo corregido)
  speedMS: number;
  fromBearingDeg: number; // Open-Meteo da la dirección DESDE la que sopla
}

export interface OpenMeteoResult {
  /** Perfil listo para service.setWindProfile — altitudes RELATIVAS a la batería. */
  profile: WindProfilePoint[];
  seaLevelTempK: number;
  seaLevelPressurePa: number;
  /** Niveles usados (para el resumen del panel). */
  levels: OpenMeteoLevel[];
  stationTempC: number;
  stationPressureHPa: number;
}

/**
 * Convierte una respuesta de api.open-meteo.com/v1/forecast (hourly con
 * `forecast_hours=1` y `wind_speed_unit=ms`) en condiciones instalables.
 * `batteryHeightM` es la cota de la batería; si falta se usa `elevation`
 * de la propia respuesta (la celda del modelo).
 */
export function parseOpenMeteo(json: unknown, batteryHeightM?: number): OpenMeteoResult {
  const root = json as { hourly?: Record<string, unknown>; elevation?: unknown } | null;
  const hourly = root?.hourly;
  if (!hourly || typeof hourly !== 'object') {
    throw new Error('Respuesta Open-Meteo sin bloque hourly');
  }
  const num = (field: string): number | null => {
    const arr = (hourly as Record<string, unknown>)[field];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const v = Number(arr[0]);
    return Number.isFinite(v) ? v : null;
  };

  const t2mC = num('temperature_2m');
  const pSurfHPa = num('surface_pressure');
  if (t2mC === null || pSurfHPa === null) {
    throw new Error('Open-Meteo sin temperature_2m/surface_pressure');
  }
  const h = batteryHeightM ?? (Number.isFinite(Number(root?.elevation)) ? Number(root!.elevation) : 0);

  // Reducción barométrica a nivel del mar (fórmula estándar de estación).
  const t2mK = t2mC + 273.15;
  const seaLevelTempK = t2mK + 0.0065 * h;
  const tMeanK = 0.5 * (t2mK + seaLevelTempK);
  const seaLevelPressurePa = pSurfHPa * 100 * Math.exp((G0 * h) / (R_AIR * tMeanK));

  // Modelo corregido: con él se invierte presión -> altitud para cada nivel.
  const atmo = new Atmosphere();
  atmo.seaLevelTemperatureK = seaLevelTempK;
  atmo.seaLevelPressurePa = seaLevelPressurePa;

  const levels: OpenMeteoLevel[] = [];
  for (const hPa of OPEN_METEO_LEVELS) {
    const speedMS = num(`wind_speed_${hPa}hPa`);
    const fromBearingDeg = num(`wind_direction_${hPa}hPa`);
    if (speedMS === null || fromBearingDeg === null) continue; // nivel ausente
    const altitudeMslM = atmo.altitudeForPressure(hPa * 100);
    if (altitudeMslM <= h + 1) continue; // este nivel queda bajo tierra aquí
    levels.push({ hPa, altitudeMslM, speedMS, fromBearingDeg });
  }
  if (levels.length === 0) throw new Error('Open-Meteo sin niveles de viento útiles');

  const profile: WindProfilePoint[] = levels
    .map((l) => ({
      altitudeM: l.altitudeMslM - h, // el solver muestrea z ENU (sobre la batería)
      speedMS: l.speedMS,
      fromBearingDeg: l.fromBearingDeg,
    }))
    .sort((a, b) => a.altitudeM - b.altitudeM);

  return {
    profile,
    seaLevelTempK,
    seaLevelPressurePa,
    levels,
    stationTempC: t2mC,
    stationPressureHPa: pSurfHPa,
  };
}

// ---------------------------------------------------------------------------
//  Fetch con caché de 15 minutos (Open-Meteo publica datos horarios).
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; data: OpenMeteoResult }>();

export async function fetchOpenMeteo(
  lonDeg: number,
  latDeg: number,
  batteryHeightM: number,
): Promise<OpenMeteoResult> {
  const key = `${latDeg.toFixed(2)},${lonDeg.toFixed(2)},${Math.round(batteryHeightM)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const fields = [
    'temperature_2m',
    'surface_pressure',
    ...OPEN_METEO_LEVELS.flatMap((p) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`]),
  ].join(',');
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${latDeg.toFixed(4)}&longitude=${lonDeg.toFixed(4)}` +
    `&hourly=${fields}&wind_speed_unit=ms&forecast_hours=1&timezone=UTC`;

  // Timeout explícito: una conexión COLGADA (no fallida) dejaba el botón de
  // meteo real deshabilitado minutos y bloqueaba la restauración de enlaces.
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = parseOpenMeteo(await res.json(), batteryHeightM);
  cache.set(key, { at: Date.now(), data });
  return data;
}
