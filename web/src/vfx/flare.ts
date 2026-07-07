// ============================================================================
//  flare.ts — Cinemática PURA de la bengala ILLUM.  [P-VIVO.8]
//
//  Una bengala real cuelga de un paracaídas: desciende a ~4.5 m/s y DERIVA
//  con el viento de su altitud (no el de superficie). Aquí vive el número —
//  posición(t), intensidad(t), vida útil — con el PERFIL DE VIENTO INYECTADO
//  como función pura, para testear en node sin AudioContext ni Three. La
//  deriva se integra por pasos (el viento cambia con la altitud que la
//  bengala va cruzando): FlareFX solo consume `at(t)`.
// ============================================================================

export interface FlarePoint {
  x: number;
  y: number;
  z: number;
  /** 0..1: plena luz hasta el fundido final. */
  intensity: number;
  alive: boolean;
}

export interface FlareOptions {
  /** Descenso bajo paracaídas (m/s). */
  descentRateMS?: number;
  /** Vida útil de la composición iluminante (s). */
  lifeS?: number;
  /** Duración del fundido final (s). */
  fadeS?: number;
  /** Paso de integración de la deriva (s). */
  dtS?: number;
}

export const FLARE_DESCENT_MS = 4.5;
export const FLARE_LIFE_S = 50;
export const FLARE_FADE_S = 6;

/** Viento horizontal (m/s este/norte) a una altitud z ENU. */
export type WindAtAltitude = (z: number) => { x: number; y: number };

/**
 * Cinemática completa de una bengala: pre-integra la deriva paso a paso
 * (dt fijo, determinista) y expone `at(t)` con interpolación lineal.
 */
export class FlareKinematics {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly zs: number[] = [];
  private readonly dt: number;
  readonly lifeS: number;
  readonly fadeS: number;
  readonly descentRateMS: number;

  constructor(
    start: { x: number; y: number; z: number },
    windAt: WindAtAltitude,
    opts: FlareOptions = {},
  ) {
    this.descentRateMS = opts.descentRateMS ?? FLARE_DESCENT_MS;
    this.lifeS = opts.lifeS ?? FLARE_LIFE_S;
    this.fadeS = opts.fadeS ?? FLARE_FADE_S;
    this.dt = opts.dtS ?? 0.25;

    let { x, y, z } = start;
    const steps = Math.ceil(this.lifeS / this.dt);
    for (let i = 0; i <= steps; i++) {
      this.xs.push(x);
      this.ys.push(y);
      this.zs.push(z);
      const w = windAt(z);
      x += w.x * this.dt;
      y += w.y * this.dt;
      z -= this.descentRateMS * this.dt;
    }
  }

  at(tS: number): FlarePoint {
    if (tS >= this.lifeS) {
      const n = this.xs.length - 1;
      return { x: this.xs[n], y: this.ys[n], z: this.zs[n], intensity: 0, alive: false };
    }
    const t = Math.max(0, tS);
    const k = t / this.dt;
    const i = Math.min(this.xs.length - 2, Math.floor(k));
    const f = k - i;
    const lerp = (a: number[], idx: number) => a[idx] + f * (a[idx + 1] - a[idx]);
    // Plena luz hasta que empieza el fundido; luego rampa lineal a 0.
    const intensity = Math.min(1, Math.max(0, (this.lifeS - t) / this.fadeS));
    return { x: lerp(this.xs, i), y: lerp(this.ys, i), z: lerp(this.zs, i), intensity, alive: true };
  }
}
