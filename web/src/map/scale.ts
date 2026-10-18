// ============================================================================
//  map/scale.ts — Barra de escala con números redondos.  [V2:MAP]
//
//  Dada la resolución en el centro de la vista (m/píxel), elige la mayor
//  longitud "bonita" (1·2·5 × 10ⁿ) que quepa en `maxPx` y devuelve su ancho
//  en píxeles y su rótulo. Módulo PURO.
// ============================================================================

export interface ScaleBar {
  meters: number;
  px: number;
  label: string;
}

/** Mayor número 1·2·5×10ⁿ que no supere `x` (x > 0). */
export function niceFloor(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  const nice = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return nice * p;
}

/** Rótulo de una longitud redonda ("500 m", "2 km", "20 km"). */
export function scaleLabel(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? km.toFixed(0) : km.toString()} km`;
  }
  return `${Number.isInteger(m) ? m.toFixed(0) : m.toString()} m`;
}

/**
 * Barra de escala para `metersPerPixel` con ancho máximo `maxPx` (y mínimo
 * deseable `maxPx/2.5`, que 1·2·5 siempre garantiza). null si la
 * resolución no es válida (vista al cielo, horizonte).
 */
export function computeScaleBar(metersPerPixel: number, maxPx = 110): ScaleBar | null {
  if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) return null;
  const meters = niceFloor(metersPerPixel * maxPx);
  if (meters <= 0) return null;
  return { meters, px: meters / metersPerPixel, label: scaleLabel(meters) };
}
