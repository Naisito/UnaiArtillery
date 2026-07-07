// ============================================================================
//  audioMath.ts — Cálculo escalar PURO del paisaje sonoro.  [P-VIVO.1]
//
//  Todo el número que consume AudioBoom sale de aquí: pan estéreo desde
//  acimuts, retardo físico, atenuación por distancia y el silbido terminal
//  del proyectil. SIN AudioContext ni DOM: testeable en el node de Vitest.
//  AudioBoom solo APLICA estos valores a su grafo WebAudio.
// ============================================================================

/** Acimut (grados, 0 = norte, 90 = este) del vector (dEast, dNorth). */
export function azimuthDegOf(dEast: number, dNorth: number): number {
  if (Math.abs(dEast) < 1e-12 && Math.abs(dNorth) < 1e-12) return 0;
  return ((Math.atan2(dEast, dNorth) * 180) / Math.PI + 360) % 360;
}

/**
 * Pan estéreo [-1, +1] de un evento visto desde una cámara con rumbo
 * `cameraHeadingDeg`: sin(demora relativa). Un impacto justo a tu derecha
 * (demora +90º) da +1, a la izquierda -1, de frente O DE ESPALDAS da 0 —
 * con dos altavoces no hay delante/detrás, solo lateralidad.
 */
export function panFromAzimuths(eventAzimuthDeg: number, cameraHeadingDeg: number): number {
  const rel = ((eventAzimuthDeg - cameraHeadingDeg) * Math.PI) / 180;
  const pan = Math.sin(rel);
  return pan < -1 ? -1 : pan > 1 ? 1 : pan;
}

/**
 * Retardo físico del sonido: distancia / velocidad del sonido local, con
 * suelo de 200 m/s frente a datos absurdos y mínimo de 10 ms para que el
 * scheduler de WebAudio nunca reciba un instante en el pasado.
 */
export function boomDelayS(distanceM: number, soundSpeedMS: number): number {
  return Math.max(0.01, distanceM / Math.max(200, soundSpeedMS));
}

/**
 * Ganancia por distancia: atenuación geométrica suave con suelo (a 60 m ya
 * satura a 1, a 900 m vale 1, y siempre queda algo que intuir), escalada por
 * la energía del evento (yield^(1/3) relativo). Idéntica a la que AudioBoom
 * aplicaba en línea antes de P-VIVO.1.
 */
export function distanceGain(distanceM: number, energyScale = 1): number {
  const att = Math.min(1, 900 / Math.max(60, distanceM));
  return Math.min(1, att * energyScale);
}

// ---------------------------------------------------------------------------
//  Silbido terminal del proyectil.
//
//  El silbido de las bombas es la fase TERMINAL SUBSÓNICA: el aire silba al
//  pasar por el cuerpo cuando M < 1 (los morteros silban; un GMLRS
//  supersónico llega antes que su propio sonido y NO silba). Modelo:
//    * se anula por encima de Mach 1 y más allá de maxDistanceM (500 m);
//    * la ganancia crece al acercarse (cuadrática, más dramática al final);
//    * la frecuencia central cae de ~1200 Hz (M alto) a ~600 Hz (M bajo),
//      el "descenso" clásico del silbido al frenarse la bomba.
// ---------------------------------------------------------------------------
export interface WhistleParams {
  /** Ganancia 0..1 (0 = silencio: supersónico o demasiado lejos). */
  gain: number;
  /** Frecuencia central del bandpass/oscilador (Hz). */
  freqHz: number;
}

export const WHISTLE_MAX_DISTANCE_M = 500;

export function whistleParams(
  mach: number,
  distanceM: number,
  maxDistanceM = WHISTLE_MAX_DISTANCE_M,
): WhistleParams {
  if (mach >= 1.0 || mach <= 0.05 || distanceM >= maxDistanceM || distanceM < 0) {
    return { gain: 0, freqHz: 600 };
  }
  const closeness = 1 - distanceM / maxDistanceM;    // 0 lejos … 1 encima
  const gain = 0.55 * closeness * closeness;
  // M 0.3 → 600 Hz … M 1.0 → 1200 Hz (clamp fuera de esa banda).
  const m = Math.min(1, Math.max(0, (mach - 0.3) / 0.7));
  return { gain, freqHz: 600 + 600 * m };
}
