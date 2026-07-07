// ============================================================================
//  ricochet.ts — Geometría PURA del rebote rasante.  [P-VIVO.4]
//
//  Las balas del .50 rebotan de verdad sobre el agua a ángulos bajos. Modelo
//  (solo munición SIN explosivo, y solo sobre agua — en tierra nada cambia):
//    * ángulo de caída respecto al PLANO LOCAL del terreno < 12º;
//    * probabilidad p = 1 − ángulo/12º (RNG determinista sembrado por disparo);
//    * velocidad reflejada especularmente con restitución 0.55 tangencial y
//      0.3 normal (la energía SIEMPRE decrece) + desvío aleatorio ±3º en el
//      plano de la superficie;
//    * máximo 2 rebotes; el tramo restante se RE-INTEGRA en el worker.
//
//  Sin Three ni Cesium: todo testeable en node con planos sintéticos.
// ============================================================================
import { DeterministicRng } from './random';

export interface V3 { x: number; y: number; z: number }

export const RICOCHET_MAX_ANGLE_DEG = 12;
export const RICOCHET_RESTITUTION_TANGENTIAL = 0.55;
export const RICOCHET_RESTITUTION_NORMAL = 0.3;
export const RICOCHET_DEVIATION_DEG = 3;
export const MAX_RICOCHETS = 2;

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const magnitude = (a: V3): number => Math.hypot(a.x, a.y, a.z);

/**
 * Normal unitaria del plano local del terreno a partir de tres alturas
 * muestreadas: z en el punto, z a +epsM en x y z a +epsM en y.
 */
export function normalFromHeights(z0: number, zXeps: number, zYeps: number, epsM: number): V3 {
  const nx = -(zXeps - z0) / epsM;
  const ny = -(zYeps - z0) / epsM;
  const len = Math.hypot(nx, ny, 1);
  return { x: nx / len, y: ny / len, z: 1 / len };
}

/** Ángulo de caída (grados) entre la velocidad y el PLANO local (0 = rasante). */
export function grazingAngleDeg(vel: V3, normal: V3): number {
  const speed = magnitude(vel);
  if (speed < 1e-9) return 90;
  const s = Math.min(1, Math.abs(dot(vel, normal)) / speed);
  return (Math.asin(s) * 180) / Math.PI;
}

/** p = 1 − ángulo/12º (0 a partir de 12º): rasante casi seguro, oblicuo raro. */
export function ricochetProbability(angleDeg: number, maxDeg = RICOCHET_MAX_ANGLE_DEG): number {
  if (angleDeg >= maxDeg || angleDeg < 0) return 0;
  return 1 - angleDeg / maxDeg;
}

/** Tirada del rebote con el RNG inyectado (consume UNA muestra siempre que p>0). */
export function shouldRicochet(
  angleDeg: number,
  rng: DeterministicRng,
  maxDeg = RICOCHET_MAX_ANGLE_DEG,
): boolean {
  const p = ricochetProbability(angleDeg, maxDeg);
  if (p <= 0) return false;
  return rng.next() < p;
}

/** Rotación de Rodrigues de v alrededor del eje unitario k. */
function rotateAboutAxis(v: V3, k: V3, angleRad: number): V3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return add(add(scale(v, c), scale(kxv, s)), scale(k, kdv * (1 - c)));
}

/**
 * Velocidad de salida del rebote: reflexión especular amortiguada
 * (tangencial ×0.55, normal invertida ×0.3) + desvío aleatorio ±3º girando
 * alrededor de la normal (desvío EN el plano de la superficie). La energía
 * decrece siempre: ambas restituciones son < 1.
 */
export function reflectVelocity(vel: V3, normal: V3, rng: DeterministicRng): V3 {
  const vn = dot(vel, normal);
  const vN = scale(normal, vn);
  const vT = sub(vel, vN);
  // La componente normal SIEMPRE sale alejándose de la superficie (|vn|):
  // robusto también si el muestreo de la normal deja un caso degenerado.
  const out = add(
    scale(vT, RICOCHET_RESTITUTION_TANGENTIAL),
    scale(normal, Math.abs(vn) * RICOCHET_RESTITUTION_NORMAL),
  );
  // El desvío gira alrededor de la NORMAL: no toca la componente de salida.
  const dev = ((rng.next() * 2 - 1) * RICOCHET_DEVIATION_DEG * Math.PI) / 180;
  return rotateAboutAxis(out, normal, dev);
}
