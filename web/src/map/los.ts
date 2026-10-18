// ============================================================================
//  map/los.ts — Línea de visión sobre un perfil del terreno.  [V2:MAP]
//
//  Entrada: distancias a lo largo de la recta A→B y alturas del terreno en
//  esas distancias (cualquier dátum común). El observador mira desde
//  `eyeHeightM` sobre A hacia un blanco de `targetHeightM` sobre B. El
//  terreno se "abomba" por la curvatura terrestre corregida de refracción
//  óptica (k = 0.13): más allá de unos kilómetros, el horizonte esconde
//  blancos bajos aunque el suelo sea llano — como en la realidad.
//
//  Además calcula el "terreno visto" (qué tramos del suelo ve el
//  observador): los ángulos muertos se sombrean en el perfil.
//  Módulo PURO.
// ============================================================================
import { earthBulgeM } from './geodesy';

export interface LosOptions {
  refractionK?: number;
  earthRadiusM?: number;
}

export interface LosResult {
  /** El blanco es visible desde el ojo. */
  visible: boolean;
  /** Primera muestra que corta el rayo (−1 si ninguna). */
  firstBlockIndex: number;
  /** Muestra de máxima obstrucción (la cresta que tapa), −1 si visible. */
  worstIndex: number;
  /** Cuánto sobresale esa cresta por encima del rayo (m, >0 tapa). */
  worstExcessM: number;
  /** Holgura mínima del rayo sobre el terreno (m; negativa = tapado). */
  minClearanceM: number;
  /** Altura del rayo en cada muestra (mismo dátum que la entrada). */
  rayHeights: number[];
  /** Terreno con el abombamiento aplicado (lo que "ve" el rayo). */
  effHeights: number[];
  /** Para cada muestra: el ojo ve ese punto del SUELO (ángulos muertos). */
  groundVisible: boolean[];
}

export function lineOfSight(
  distances: number[],
  heights: number[],
  eyeHeightM: number,
  targetHeightM: number,
  opts: LosOptions = {},
): LosResult {
  const n = Math.min(distances.length, heights.length);
  const k = opts.refractionK ?? 0.13;
  const R = opts.earthRadiusM;
  const empty: LosResult = {
    visible: true, firstBlockIndex: -1, worstIndex: -1, worstExcessM: 0,
    minClearanceM: Infinity, rayHeights: [], effHeights: [], groundVisible: [],
  };
  if (n < 2) return empty;

  const D = distances[n - 1] - distances[0];
  const eff: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = distances[i] - distances[0];
    eff[i] = heights[i] + (R !== undefined ? earthBulgeM(d, D, k, R) : earthBulgeM(d, D, k));
  }
  const eyeZ = heights[0] + eyeHeightM;
  const tgtZ = heights[n - 1] + targetHeightM;

  const ray: number[] = new Array(n);
  let firstBlock = -1;
  let worst = -1;
  let worstExcess = -Infinity;
  let minClear = Infinity;
  for (let i = 0; i < n; i++) {
    const f = D > 0 ? (distances[i] - distances[0]) / D : 0;
    ray[i] = eyeZ + (tgtZ - eyeZ) * f;
    if (i === 0 || i === n - 1) continue; // los extremos no tapan
    const excess = eff[i] - ray[i];
    minClear = Math.min(minClear, -excess);
    if (excess > worstExcess) {
      worstExcess = excess;
      worst = i;
    }
    if (excess > 0 && firstBlock < 0) firstBlock = i;
  }
  const visible = firstBlock < 0;

  // Terreno visto: un punto del suelo es visible si su ángulo de elevación
  // desde el ojo no queda por debajo del máximo de los anteriores.
  const groundVisible: boolean[] = new Array(n).fill(true);
  let maxSlope = -Infinity;
  for (let i = 1; i < n; i++) {
    const d = distances[i] - distances[0];
    if (d <= 0) continue;
    // Caída del suelo bajo la horizontal del ojo a la distancia d:
    // d²/(2·R_eff) == earthBulgeM(d, 2d).
    const drop = R !== undefined ? earthBulgeM(d, 2 * d, k, R) : earthBulgeM(d, 2 * d, k);
    const slope = (heights[i] - drop - eyeZ) / d;
    groundVisible[i] = slope >= maxSlope - 1e-9;
    if (slope > maxSlope) maxSlope = slope;
  }

  return {
    visible,
    firstBlockIndex: firstBlock,
    worstIndex: visible ? -1 : worst,
    worstExcessM: visible ? 0 : worstExcess,
    minClearanceM: Number.isFinite(minClear) ? minClear : Infinity,
    rayHeights: ray,
    effHeights: eff,
    groundVisible,
  };
}
