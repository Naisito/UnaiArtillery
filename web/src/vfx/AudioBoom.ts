// ============================================================================
//  AudioBoom.ts — Audio sintetizado con retardo físico.  [P3.2 web / P-VIVO.1]
//
//  Ves el destello y el estampido llega DESPUÉS: retardo = distancia / a(h),
//  con la velocidad del sonido real de la atmósfera del servicio. A 3 km el
//  boom llega ~9 s tarde. Voces, todas sintetizadas (cero assets):
//    * muzzle  — cañonazo: golpe grave + ráfaga de ruido lowpass.
//    * impact  — detonación: sub más profundo, cola larga, escala con yield.
//    * crack   — chasquido supersónico al pasar cerca de la cámara.
//    * rifle   — P-VIVO.1: crack corto highpass + golpe seco (armas ligeras;
//                P-VIVO.2 la encadena a la cadencia real de la ráfaga).
//    * whistle — P-VIVO.1: silbido terminal del proyectil subsónico cercano
//                (voz continua por proyectil, alimentada por frame).
//
//  P-VIVO.1: grafo con masterGain + DynamicsCompressorNode antes de
//  destination (volumen 0-100 + mute persistidos en localStorage
//  'unai-artillery/audio/v1') y cada voz pasa por un StereoPannerNode: el pan
//  sale del acimut del EVENTO respecto al heading de la cámara (audioMath).
//  Sin AudioContext disponible todo degrada en silencio, como siempre.
// ============================================================================
import {
  boomDelayS, distanceGain, panFromAzimuths, whistleParams,
} from './audioMath';

const STORE_KEY = 'unai-artillery/audio/v1';

interface WhistleVoice {
  osc: OscillatorNode;
  noise: AudioBufferSourceNode;
  band: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

export class AudioBoom {
  /** Rumbo de la cámara en GRADOS (main.ts lo conecta a Cesium). */
  headingProvider: (() => number) | null = null;

  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private whistles = new Map<unknown, WhistleVoice>();

  // Volumen persistido (0..100) + mute. Se cargan ANTES de tener contexto.
  private volume100 = 80;
  private mutedFlag = false;

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { volume?: number; muted?: boolean };
        if (typeof s.volume === 'number') this.volume100 = Math.min(100, Math.max(0, s.volume));
        if (typeof s.muted === 'boolean') this.mutedFlag = s.muted;
      }
    } catch {
      // almacenamiento bloqueado: defaults
    }
  }

  get volume(): number { return this.volume100; }
  get muted(): boolean { return this.mutedFlag; }

  setVolume(v: number): void {
    this.volume100 = Math.min(100, Math.max(0, v));
    this.applyMaster();
    this.persist();
  }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
    this.applyMaster();
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ volume: this.volume100, muted: this.mutedFlag }));
    } catch {
      // sin persistencia: el control sigue funcionando en la sesión
    }
  }

  private masterLevel(): number {
    // Curva perceptual suave (x²): 50% del slider ≈ -12 dB.
    const x = this.volume100 / 100;
    return this.mutedFlag ? 0 : x * x;
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.03);
  }

  /** Llamar desde un gesto de usuario (el botón FUEGO) para desbloquear. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      const len = Math.floor(this.ctx.sampleRate * 2);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // P-VIVO.1 — bus master: voces -> masterGain -> compresor -> salida.
      // El compresor doma la suma de una ráfaga entera sin recortar feo.
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterLevel();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      this.master.connect(comp).connect(this.ctx.destination);
    } catch {
      this.ctx = null; // sin audio: la simulación sigue igual
      this.master = null;
    }
  }

  /** Pan estéreo de un evento por su acimut respecto a la cámara. */
  private panOf(eventAzimuthDeg?: number): number {
    if (eventAzimuthDeg === undefined || !this.headingProvider) return 0;
    return panFromAzimuths(eventAzimuthDeg, this.headingProvider());
  }

  /** Nodo de salida de una voz puntual: panner -> master. */
  private voiceOut(pan: number): AudioNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master!);
    return p;
  }

  /**
   * Programa un boom. `distanceM` fija retardo y atenuación; `soundSpeed`
   * viene de Atmosphere.sample; `energyScale` ~ yield^(1/3) relativo.
   * `eventAzimuthDeg` (P-VIVO.1) posiciona el evento en el estéreo;
   * `jitterS` (P-VIVO.2) desincroniza los disparos de una ráfaga.
   */
  boom(
    kind: 'muzzle' | 'impact' | 'impactWater' | 'crack' | 'rifle',
    distanceM: number,
    soundSpeed: number,
    energyScale = 1,
    eventAzimuthDeg?: number,
    jitterS = 0,
  ): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const t0 = this.ctx.currentTime + boomDelayS(distanceM, soundSpeed) + Math.max(0, jitterS);

    const gain = distanceGain(distanceM, energyScale);
    if (gain < 0.005) return;

    const params = {
      muzzle: { dur: 0.9, lp: 260, sub: 55, subDur: 0.35 },
      impact: { dur: 1.8, lp: 180, sub: 38, subDur: 0.8 },
      // P-VIVO.4 — el agua se traga las frecuencias: lowpass más cerrado,
      // ataque blando (el "flump" de la columna en vez del crack de la roca).
      impactWater: { dur: 1.6, lp: 110, sub: 30, subDur: 0.7 },
      crack: { dur: 0.09, lp: 3200, sub: 0, subDur: 0 },
      // P-VIVO.1 — rifle: crack corto muy agudo + golpe seco breve, escala pequeña.
      rifle: { dur: 0.16, lp: 1800, sub: 120, subDur: 0.05 },
    }[kind];
    const attackS = kind === 'impactWater' ? 0.06 : 0.012;
    const out = this.voiceOut(this.panOf(eventAzimuthDeg));

    // Ráfaga de ruido filtrada con envolvente exponencial.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = kind === 'crack' || kind === 'rifle' ? 'highpass' : 'lowpass';
    filter.frequency.value = params.lp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attackS);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + params.dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t0, Math.random(), params.dur + 0.1);

    // Sub-golpe senoidal para el "pecho" del estampido.
    if (params.sub > 0) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(params.sub * 1.8, t0);
      osc.frequency.exponentialRampToValueAtTime(params.sub, t0 + params.subDur);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0, t0);
      og.gain.linearRampToValueAtTime(gain * (kind === 'rifle' ? 0.5 : 0.9), t0 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0008, t0 + params.subDur * 2);
      osc.connect(og).connect(out);
      osc.start(t0);
      osc.stop(t0 + params.subDur * 2 + 0.1);
    }
  }

  // ---------------------------------------------------------------------------
  //  P-VIVO.1 — Silbido terminal: voz continua por proyectil, alimentada por
  //  frame desde ProjectilePresenter (Mach + distancia + acimut a la cámara).
  //  Ruido bandpass estrecho + oscilador; audioMath decide ganancia/frecuencia
  //  (0 por encima de Mach 1 o a >500 m: los morteros silban, un GMLRS no).
  // ---------------------------------------------------------------------------
  whistleTick(key: unknown, mach: number, distanceM: number, eventAzimuthDeg?: number): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const { gain, freqHz } = whistleParams(mach, distanceM);
    let v = this.whistles.get(key);
    if (!v) {
      if (gain <= 0) return; // nada que arrancar
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noise;
      noise.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freqHz;
      band.Q.value = 9; // estrecho: silba, no sopla
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freqHz;
      const oscGain = this.ctx.createGain();
      oscGain.gain.value = 0.18; // el oscilador solo "afina" el ruido
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const pan = this.ctx.createStereoPanner();
      noise.connect(band).connect(g);
      osc.connect(oscGain).connect(g);
      g.connect(pan).connect(this.master);
      noise.start(0, Math.random());
      osc.start();
      v = { osc, noise, band, gain: g, pan };
      this.whistles.set(key, v);
    }
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(gain, t, 0.08);
    v.band.frequency.setTargetAtTime(freqHz, t, 0.1);
    v.osc.frequency.setTargetAtTime(freqHz, t, 0.1);
    v.pan.pan.setTargetAtTime(this.panOf(eventAzimuthDeg), t, 0.08);
  }

  /** El proyectil impactó o murió: apaga y desmonta su silbido. */
  whistleStop(key: unknown): void {
    const v = this.whistles.get(key);
    if (!v || !this.ctx) return;
    this.whistles.delete(key);
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, 0.05);
    window.setTimeout(() => {
      try {
        v.noise.stop();
        v.osc.stop();
        v.gain.disconnect();
        v.pan.disconnect();
        v.band.disconnect();
      } catch {
        // ya parados
      }
    }, 400);
  }
}
