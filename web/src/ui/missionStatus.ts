// ============================================================================
//  missionStatus.ts — Estado de la misión para el chip de la barra superior.
//
//  LISTO · APUNTANDO · CALCULANDO · EN VUELO · IMPACTO, derivado por
//  prioridad de tres entradas que alimentan la pieza y main:
//    * cálculos en curso (contador: varios solves pueden solaparse),
//    * proyectiles en vuelo,
//    * modo de designación activo en el mapa,
//  más un destello de IMPACTO de 3 s tras cada impacto real.
// ============================================================================

export type MissionPhase = 'ready' | 'aiming' | 'computing' | 'inflight' | 'impact';

export const PHASE_LABEL: Record<MissionPhase, string> = {
  ready: 'Listo',
  aiming: 'Apuntando',
  computing: 'Calculando',
  inflight: 'En vuelo',
  impact: 'Impacto',
};

type Listener = (phase: MissionPhase) => void;

class MissionStatus {
  private computing = 0;
  private inFlight = 0;
  private aiming = false;
  private impactUntil = 0;
  private impactTimer: number | undefined;
  private phaseNow: MissionPhase = 'ready';
  private readonly listeners = new Set<Listener>();

  get phase(): MissionPhase { return this.phaseNow; }

  /** Envuelve una promesa como "calculando" mientras dure. */
  async track<T>(p: Promise<T>): Promise<T> {
    this.computing++;
    this.recompute();
    try {
      return await p;
    } finally {
      this.computing = Math.max(0, this.computing - 1);
      this.recompute();
    }
  }

  setInFlight(n: number): void {
    if (n === this.inFlight) return;
    this.inFlight = n;
    this.recompute();
  }

  setAiming(on: boolean): void {
    if (on === this.aiming) return;
    this.aiming = on;
    this.recompute();
  }

  flashImpact(ms = 3000): void {
    this.impactUntil = performance.now() + ms;
    window.clearTimeout(this.impactTimer);
    this.impactTimer = window.setTimeout(() => this.recompute(), ms + 20);
    this.recompute();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private recompute(): void {
    const next: MissionPhase =
      this.inFlight > 0 ? 'inflight'
      : this.computing > 0 ? 'computing'
      : performance.now() < this.impactUntil ? 'impact'
      : this.aiming ? 'aiming'
      : 'ready';
    if (next === this.phaseNow) return;
    this.phaseNow = next;
    for (const fn of this.listeners) fn(next);
  }
}

export const missionStatus = new MissionStatus();
