// ============================================================================
//  foCore.ts — Lógica PURA del reto de Observador Avanzado.  [P-VIVO.6]
//
//  Separada de ForwardObserver.ts (capa DOM/Cesium) siguiendo el patrón de
//  challengeCore: conversión de correcciones Observador→Objetivo (OT) a ENU,
//  validación de línea de visión sobre perfiles muestreados, generación de
//  candidatos de puesto de observación con RNG inyectado y escala de
//  estrellas por rondas. Todo testeable en node sin DOM.
//
//  La clave didáctica: "derecha 50" y "largo 100" son relativos a LO QUE VE
//  EL OBSERVADOR (la línea OP→objetivo), no al rumbo del arma — así se
//  corrige el tiro de verdad.
// ============================================================================

export interface Vec2 {
  x: number; // este (m)
  y: number; // norte (m)
}

export interface OtAxes {
  /** Unitario OP→objetivo ("largo" positivo = más allá del objetivo). */
  along: Vec2;
  /** Unitario a la DERECHA del observador mirando al objetivo. */
  right: Vec2;
}

/** Ejes de corrección sobre la línea observador→objetivo. */
export function otAxes(opEnu: Vec2, targetEnu: Vec2): OtAxes {
  const dx = targetEnu.x - opEnu.x;
  const dy = targetEnu.y - opEnu.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { along: { x: 0, y: 1 }, right: { x: 1, y: 0 } };
  const along = { x: dx / len, y: dy / len };
  // Mirando en dirección (dx, dy), la derecha es la rotación horaria 90º.
  return { along, right: { x: along.y, y: -along.x } };
}

/**
 * Traslada el punto de puntería según la corrección cantada por el FO:
 * `rightM` positivo = "derecha R", negativo = "izquierda"; `addM` positivo =
 * "largo A" (alargar), negativo = "corto".
 */
export function applyObserverCorrection(
  aimEnu: Vec2,
  opEnu: Vec2,
  targetEnu: Vec2,
  rightM: number,
  addM: number,
): Vec2 {
  const { along, right } = otAxes(opEnu, targetEnu);
  return {
    x: aimEnu.x + right.x * rightM + along.x * addM,
    y: aimEnu.y + right.y * rightM + along.y * addM,
  };
}

/**
 * Línea de visión sobre un perfil de alturas muestreado de OP (índice 0) a
 * objetivo (último índice), equiespaciado. El observador está a
 * `observerHeightM` sobre su suelo y el objetivo a `targetHeightM` sobre el
 * suyo; una muestra intermedia que asome `clearanceM` por encima de la recta
 * de mira la bloquea.
 */
export function hasLineOfSight(
  profile: number[],
  observerHeightM = 1.7,
  targetHeightM = 1.0,
  clearanceM = 0.5,
): boolean {
  const n = profile.length;
  if (n < 3) return true;
  const h0 = profile[0] + observerHeightM;
  const h1 = profile[n - 1] + targetHeightM;
  for (let i = 1; i < n - 1; i++) {
    const f = i / (n - 1);
    const sight = h0 + (h1 - h0) * f;
    if (profile[i] - clearanceM > sight) return false;
  }
  return true;
}

/**
 * Candidatos de puesto de observación: a 2-4 km del objetivo, perpendiculares
 * ± al rumbo batería→objetivo (la batería es el origen ENU), alternando lado
 * y ACORTANDO la distancia en cada reintento (si el relieve bloquea todo, el
 * OP se acerca hasta ver). `rng` uniforme [0,1) inyectado.
 */
export function opCandidates(
  rng: () => number,
  targetEnu: Vec2,
  n = 8,
): Vec2[] {
  const azBT = Math.atan2(targetEnu.x, targetEnu.y); // rumbo batería→objetivo
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const shrink = Math.max(0.35, 1 - 0.1 * i); // reintentos cada vez más cerca
    const dist = (2000 + rng() * 2000) * shrink;
    // Perpendicular con un abanico de ±14º para variar el punto de vista.
    const ang = azBT + side * (Math.PI / 2) + (rng() - 0.5) * 0.5;
    out.push({
      x: targetEnu.x + Math.sin(ang) * dist,
      y: targetEnu.y + Math.cos(ang) * dist,
    });
  }
  return out;
}

/** Umbral de "objetivo batido" del reto FO (m del centro). */
export const FO_HIT_RADIUS_M = 50;

/**
 * Escala de estrellas por rondas gastadas hasta batir el objetivo:
 * 1 ronda = ★★★ (first round hit), 2-3 = ★★, 4-6 = ★, más = 0.
 */
export function foStars(roundsUsed: number): 0 | 1 | 2 | 3 {
  if (roundsUsed <= 1) return 3;
  if (roundsUsed <= 3) return 2;
  if (roundsUsed <= 6) return 1;
  return 0;
}

export interface FoRecord {
  bestRounds: number;
  stars: number;
  atIso?: string;
}

/** El récord FO solo mejora: menos rondas ganan. */
export function improveFoRecord(
  prev: FoRecord | null | undefined,
  roundsUsed: number,
  atIso?: string,
): { record: FoRecord; improved: boolean } {
  if (prev && prev.bestRounds <= roundsUsed) return { record: prev, improved: false };
  return {
    record: { bestRounds: roundsUsed, stars: foStars(roundsUsed), atIso },
    improved: true,
  };
}
