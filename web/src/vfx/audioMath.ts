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

// ---------------------------------------------------------------------------
//  V2 VFX — Propagación realista: absorción del aire, reverberación por
//  distancia y onda N del chasquido supersónico.
// ---------------------------------------------------------------------------

/**
 * Corte del paso-bajo por ABSORCIÓN ATMOSFÉRICA (Hz). La absorción crece
 * con f² (ISO 9613-1: ~5 dB/km a 1 kHz, ~30 dB/km a 4 kHz): de cerca se oye
 * el chasquido agudo; a kilómetros solo llega el retumbo grave. Monótona
 * decreciente: ~10 kHz a 100 m, ~1.7 kHz a 1 km, ~430 Hz a 5 km, ~260 Hz a
 * 15 km, con suelo de 200 Hz.
 */
export function airAbsorptionCutoffHz(distanceM: number): number {
  const d = Math.max(0, distanceM);
  return 200 + 16000 / (1 + Math.pow(d / 150, 1.2));
}

/**
 * Fracción de señal enviada a la reverberación (0..1): de cerca domina el
 * directo; lejos, el eco del valle y el retumbo (campo difuso) — un cañonazo
 * a 5 km es casi todo cola.
 */
export function reverbSend(distanceM: number): number {
  const d = Math.max(0, distanceM);
  return Math.min(0.85, 0.12 + 0.62 * (1 - Math.exp(-d / 2500)));
}

/**
 * Duración (s) de la onda N del chasquido supersónico (Whitham, forma de
 * Stoughton 1997): T = 1.82·M·b^¼·d / (c·(M²−1)^⅜·l^¼), con b la distancia
 * de paso, d el calibre y l ≈ 4.5 calibres. Bala de 7.62 a 50 m y Mach 2.5:
 * ~0.35 ms; granada de 155 mm a 300 m y Mach 2: ~5 ms. Acotada a [0.1, 12] ms.
 */
export function nWaveDurationS(
  missDistanceM: number, caliberM: number, mach: number, soundSpeedMS = 340,
): number {
  const M = Math.max(1.01, mach);
  const b = Math.max(1, missDistanceM);
  const d = Math.max(0.004, caliberM);
  const l = 4.5 * d;
  const t = (1.82 * M * Math.pow(b, 0.25) * d) /
    (Math.max(200, soundSpeedMS) * Math.pow(M * M - 1, 0.375) * Math.pow(l, 0.25));
  return Math.min(0.012, Math.max(0.0001, t));
}

/**
 * Ganancia relativa (0..1) del chasquido: la sobrepresión pico cae con
 * b^(−¾) y crece con el calibre; ~0.9 para una bala de 7.62 mm a 10 m,
 * saturada a 1.
 */
export function nWaveGain(missDistanceM: number, caliberM: number): number {
  const b = Math.max(1, missDistanceM);
  const p = (Math.max(0.004, caliberM) / 0.00762) * Math.pow(10 / b, 0.75);
  return Math.min(1, 0.9 * Math.pow(p, 0.6));
}
