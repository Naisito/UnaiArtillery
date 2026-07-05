// ============================================================================
//  AudioBoom.ts — Audio sintetizado con retardo físico.  [P3.2 web]
//
//  Ves el destello y el estampido llega DESPUÉS: retardo = distancia / a(h),
//  con la velocidad del sonido real de la atmósfera del servicio. A 3 km el
//  boom llega ~9 s tarde. Tres voces, todas sintetizadas (cero assets):
//    * muzzle — cañonazo: golpe grave + ráfaga de ruido lowpass.
//    * impact — detonación: sub más profundo, cola larga, escala con yield.
//    * crack  — chasquido supersónico al pasar cerca de la cámara.
// ============================================================================

export class AudioBoom {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /** Llamar desde un gesto de usuario (el botón FUEGO) para desbloquear. */
  unlock(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      const len = Math.floor(this.ctx.sampleRate * 2);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null; // sin audio: la simulación sigue igual
    }
  }

  /**
   * Programa un boom. `distanceM` fija retardo y atenuación; `soundSpeed`
   * viene de Atmosphere.sample; `energyScale` ~ yield^(1/3) relativo.
   */
  boom(
    kind: 'muzzle' | 'impact' | 'crack',
    distanceM: number,
    soundSpeed: number,
    energyScale = 1,
  ): void {
    if (!this.ctx || !this.noise) return;
    const t0 = this.ctx.currentTime + Math.max(0.01, distanceM / Math.max(200, soundSpeed));

    // Atenuación geométrica suave, con suelo para que siempre se intuya.
    const att = Math.min(1, 900 / Math.max(60, distanceM));
    const gain = Math.min(1, att * energyScale);
    if (gain < 0.005) return;

    const params = {
      muzzle: { dur: 0.9, lp: 260, sub: 55, subDur: 0.35 },
      impact: { dur: 1.8, lp: 180, sub: 38, subDur: 0.8 },
      crack: { dur: 0.09, lp: 3200, sub: 0, subDur: 0 },
    }[kind];

    // Ráfaga de ruido filtrada con envolvente exponencial.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = kind === 'crack' ? 'highpass' : 'lowpass';
    filter.frequency.value = params.lp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + params.dur);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t0, Math.random(), params.dur + 0.1);

    // Sub-golpe senoidal para el "pecho" del estampido.
    if (params.sub > 0) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(params.sub * 1.8, t0);
      osc.frequency.exponentialRampToValueAtTime(params.sub, t0 + params.subDur);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0, t0);
      og.gain.linearRampToValueAtTime(gain * 0.9, t0 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0008, t0 + params.subDur * 2);
      osc.connect(og).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + params.subDur * 2 + 0.1);
    }
  }
}
