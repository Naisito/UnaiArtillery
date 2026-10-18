// ============================================================================
//  map/tactics.ts — Cálculos tácticos puros del mapa.  [V2:MAP]
//
//  Corrección de observador (spotting) de un impacto respecto al objetivo.
// ============================================================================

/**
 * Corrección de observador de un impacto respecto al objetivo, en la línea
 * batería→objetivo (convención de tiro: LARGO/CORTO en alcance, DCHA/IZDA
 * en dirección). ENU de la batería. Pura (testeada).
 */
export function spotting(
  impact: { x: number; y: number }, target: { x: number; y: number },
): { alongM: number; crossM: number; text: string } {
  const len = Math.hypot(target.x, target.y);
  const ux = len > 0 ? target.x / len : 0;
  const uy = len > 0 ? target.y / len : 1;
  const dx = impact.x - target.x;
  const dy = impact.y - target.y;
  const along = dx * ux + dy * uy;
  const cross = dx * uy - dy * ux; // + = a la derecha mirando al objetivo
  const a = Math.round(Math.abs(along));
  const c = Math.round(Math.abs(cross));
  const text =
    `${a === 0 ? 'EN ALCANCE' : `${along > 0 ? 'LARGO' : 'CORTO'} ${a} m`} · ` +
    `${c === 0 ? 'EN DIRECCIÓN' : `${cross > 0 ? 'DCHA' : 'IZDA'} ${c} m`}`;
  return { alongM: along, crossM: cross, text };
}
