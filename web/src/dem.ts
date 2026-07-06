// ============================================================================
//  dem.ts — Alturas de terreno del DEM Copernicus GLO-90 vía Open-Meteo.
//
//  Se usa SOLO cuando los Edificios 3D están activos sin terreno real de ion:
//  el suelo visual de Google trae el relieve horneado en las teselas, y la
//  física necesita ese relieve para que las parábolas terminen en el valle o
//  choquen con la cresta de verdad (en modo plano/OSM no se usa: el suelo
//  visual ES el elipsoide y el corredor sigue a 0 m, como siempre).
//
//  API: https://api.open-meteo.com/v1/elevation?latitude=a,b&longitude=x,y
//  (gratis, sin clave, CORS, hasta 100 coordenadas por petición; misma casa
//  que la meteo real de P-PRO.2). Devuelve alturas SOBRE EL NIVEL DEL MAR —
//  el corredor usa el perfil RELATIVO a su primer punto, así que la ondulación
//  del geoide (~50 m en Iberia, variación <1 m en 70 km) se cancela.
//
//  Módulo sin Cesium ni DOM: testeable en Vitest con un fetcher inyectado.
// ============================================================================

export interface LatLonDeg {
  latDeg: number;
  lonDeg: number;
}

/** Firma mínima de fetch para poder inyectar uno falso en tests. */
export type DemFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const MAX_PER_REQUEST = 100;

/** Cuantización de la clave de caché: 1e-4º ≈ 11 m ≪ paso del corredor. */
function keyOf(p: LatLonDeg): string {
  return `${p.latDeg.toFixed(4)},${p.lonDeg.toFixed(4)}`;
}

const defaultCache = new Map<string, number>();

/**
 * Alturas MSL (m) del DEM para cada punto, en el mismo orden. Cachea por
 * coordenada cuantizada (apuntar dos veces al mismo rumbo no re-pide nada).
 * Devuelve null ante CUALQUIER fallo (sin red, respuesta rara): el llamador
 * degrada a su plan B sin romper el solve.
 */
export async function sampleDem(
  points: LatLonDeg[],
  fetcher: DemFetch = fetch,
  cache: Map<string, number> = defaultCache,
): Promise<number[] | null> {
  if (points.length === 0) return [];

  // Puntos aún no cacheados, deduplicados por clave.
  const missing = new Map<string, LatLonDeg>();
  for (const p of points) {
    const k = keyOf(p);
    if (!cache.has(k) && !missing.has(k)) missing.set(k, p);
  }

  try {
    const pending = [...missing.entries()];
    const chunks: [string, LatLonDeg][][] = [];
    for (let i = 0; i < pending.length; i += MAX_PER_REQUEST) {
      chunks.push(pending.slice(i, i + MAX_PER_REQUEST));
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        const lats = chunk.map(([, p]) => p.latDeg.toFixed(5)).join(',');
        const lons = chunk.map(([, p]) => p.lonDeg.toFixed(5)).join(',');
        const res = await fetcher(`${ENDPOINT}?latitude=${lats}&longitude=${lons}`);
        if (!res.ok) throw new Error('elevation http error');
        const body = (await res.json()) as { elevation?: unknown };
        const elev = body.elevation;
        if (!Array.isArray(elev) || elev.length !== chunk.length) {
          throw new Error('elevation malformed response');
        }
        chunk.forEach(([k], i) => {
          const h = Number(elev[i]);
          if (!Number.isFinite(h)) throw new Error('elevation NaN');
          cache.set(k, h);
        });
      }),
    );
    return points.map((p) => cache.get(keyOf(p))!);
  } catch (err) {
    console.warn('[dem] sin alturas del DEM — degradando', err);
    return null;
  }
}
