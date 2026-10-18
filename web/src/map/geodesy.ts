// ============================================================================
//  map/geodesy.ts — Geodesia sobre el elipsoide WGS84 (Vincenty).  [V2:MAP]
//
//  Distancia de superficie y rumbos inicial/final entre dos puntos
//  (problema inverso) y punto de destino dado rumbo y distancia (problema
//  directo). Precisión submilimétrica en distancias de artillería; para
//  puntos casi antípodas (irrelevante aquí) el inverso puede no converger y
//  degrada a la fórmula esférica. Módulo PURO, testeado contra el ejemplo
//  clásico de Vincenty (Flinders Peak → Buninyong).
// ============================================================================

const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const RAD = Math.PI / 180;

/** Radio medio terrestre (IUGG) para correcciones de curvatura. */
export const EARTH_MEAN_RADIUS_M = 6371008.8;

export interface GeoInverse {
  distanceM: number;
  /** Rumbo verdadero en el origen, [0, 360). */
  initialBearingDeg: number;
  /** Rumbo verdadero a la llegada, [0, 360). */
  finalBearingDeg: number;
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Gran círculo esférico: respaldo si Vincenty no converge. */
function sphericalInverse(lat1: number, lon1: number, lat2: number, lon2: number): GeoInverse {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const a =
    Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const b1 = norm360(Math.atan2(y, x) / RAD);
  const y2 = Math.sin(-dl) * Math.cos(p1);
  const x2 = Math.cos(p2) * Math.sin(p1) - Math.sin(p2) * Math.cos(p1) * Math.cos(-dl);
  const b2 = norm360(Math.atan2(y2, x2) / RAD + 180);
  return { distanceM: d, initialBearingDeg: b1, finalBearingDeg: b2 };
}

/** Problema inverso de Vincenty (grados → metros y rumbos verdaderos). */
export function vincentyInverse(
  lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number,
): GeoInverse {
  const L = (lon2Deg - lon1Deg) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(lat1Deg * RAD));
  const U2 = Math.atan((1 - F) * Math.tan(lat2Deg * RAD));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L;
  let sinLambda = 0, cosLambda = 0;
  let sinSigma = 0, cosSigma = 0, sigma = 0;
  let cosSqAlpha = 0, cos2SigmaM = 0;
  let iter = 0;
  let lambdaP: number;
  do {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    const t1 = cosU2 * sinLambda;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLambda;
    sinSigma = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinSigma === 0) {
      return { distanceM: 0, initialBearingDeg: 0, finalBearingDeg: 0 }; // coincidentes
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0; // ecuatorial
    const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda =
      L +
      (1 - C) * F * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iter < 200);

  if (iter >= 200) return sphericalInverse(lat1Deg, lon1Deg, lat2Deg, lon2Deg);

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const Ak = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bk = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    Bk * sinSigma *
    (cos2SigmaM +
      (Bk / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (Bk / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const s = B * Ak * (sigma - deltaSigma);
  const a1 = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
  const a2 = Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda);
  return { distanceM: s, initialBearingDeg: norm360(a1 / RAD), finalBearingDeg: norm360(a2 / RAD) };
}

/** Problema directo de Vincenty: destino a `distM` por el rumbo `bearingDeg`. */
export function vincentyDirect(
  latDeg: number, lonDeg: number, bearingDeg: number, distM: number,
): { latDeg: number; lonDeg: number } {
  const alpha1 = bearingDeg * RAD;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);
  const tanU1 = (1 - F) * Math.tan(latDeg * RAD);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const Ak = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bk = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distM / (B * Ak);
  let sigmaP: number;
  let cos2SigmaM = 0, sinSigma = 0, cosSigma = 0;
  let iter = 0;
  do {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      Bk * sinSigma *
      (cos2SigmaM +
        (Bk / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (Bk / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    sigmaP = sigma;
    sigma = distM / (B * Ak) + deltaSigma;
  } while (Math.abs(sigma - sigmaP) > 1e-12 && ++iter < 200);

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const lat2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - F) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp),
  );
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
  const L =
    lambda -
    (1 - C) * F * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  let lon2 = lonDeg + L / RAD;
  lon2 = ((lon2 + 540) % 360) - 180;
  return { latDeg: lat2 / RAD, lonDeg: lon2 };
}

/**
 * Corrección de curvatura + refracción: cuánto "sube" el terreno a una
 * distancia d de un rayo de longitud total D (abombamiento de la Tierra),
 * con radio efectivo R/(1-k). k = 0.13 es la refracción óptica estándar.
 */
export function earthBulgeM(dM: number, totalM: number, k = 0.13, radiusM = EARTH_MEAN_RADIUS_M): number {
  const rEff = radiusM / (1 - k);
  return (dM * (totalM - dM)) / (2 * rEff);
}
