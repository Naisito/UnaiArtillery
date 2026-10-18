// ============================================================================
//  AudioBoom.ts — Audio sintetizado con retardo físico.  [P3.2 web / P-VIVO.1]
//
//  Ves el destello y el estampido llega DESPUÉS: retardo = distancia / a(h),
//  con la velocidad del sonido real de la atmósfera del servicio. A 3 km el
//  boom llega ~9 s tarde. Voces, todas sintetizadas (cero assets):
//    * muzzle  — cañonazo: transitorio seco + cuerpo grave + golpe de pecho.
//    * impact  — detonación: sub más profundo, cola larga, escala con yield.
//    * crack   — chasquido supersónico (onda N real, ver supersonicCrack).
//    * rifle   — P-VIVO.1: crack corto highpass + golpe seco (armas ligeras;
//                P-VIVO.2 la encadena a la cadencia real de la ráfaga).
//    * whistle — P-VIVO.1: silbido terminal del proyectil subsónico cercano
//                (voz continua por proyectil, alimentada por frame).
//
//  V2 VFX — propagación realista (números puros en audioMath, testeados):
//    * ABSORCIÓN DEL AIRE: cada voz pasa por un paso-bajo cuyo corte cae con
//      la distancia (~10 kHz a 100 m → ~430 Hz a 5 km): de cerca restalla,
//      de lejos retumba.
//    * REVERBERACIÓN / ECO DE VALLE: envío a un ConvolverNode con respuesta
//      impulsional procedural (cola difusa ~3 s + 4 ecos discretos filtrados
//      a 0.3-1.6 s); el envío crece con la distancia.
//    * CHASQUIDO SUPERSÓNICO: onda N sintetizada muestra a muestra con la
//      duración de Whitham (bala ~0.3 ms, granada ~5 ms) y su reflexión en el
//      suelo, disparado en el punto de máximo acercamiento a la cámara.
//    * RUGIDO DE LANZAMIENTO de cohetes/misiles: ruido grave + crepitar
//      durante toda la combustión, alejándose (corte y ganancia caen).
//    * RETUMBO LEJANO: las detonaciones a >1.5 km añaden un retumbo de baja
//      frecuencia modulado (el "trueno rodante" del valle).
//
//  P-VIVO.1: grafo con masterGain + DynamicsCompressorNode antes de
//  destination (volumen 0-100 + mute persistidos en localStorage
//  'unai-artillery/audio/v1') y cada voz pasa por un StereoPannerNode: el pan
//  sale del acimut del EVENTO respecto al heading de la cámara (audioMath).
//  Sin AudioContext disponible todo degrada en silencio, como siempre.
// ============================================================================
import {
  airAbsorptionCutoffHz, boomDelayS, distanceGain, nWaveDurationS, nWaveGain,
  panFromAzimuths, reverbSend, whistleParams,
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
  /** Ruido con chasquidos dispersos (crepitar del motor cohete). */
  private crackle: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private reverbIn: GainNode | null = null;
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
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * 2);
      this.noise = this.ctx.createBuffer(1, len, sr);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // Crepitar: ruido tenue + impulsos dispersos de amplitud aleatoria.
      this.crackle = this.ctx.createBuffer(1, len, sr);
      const cd = this.crackle.getChannelData(0);
      for (let i = 0; i < len; i++) {
        cd[i] = (Math.random() * 2 - 1) * 0.25;
        if (Math.random() < 0.0016) {
          const amp = 0.5 + Math.random() * 0.5;
          const w = 8 + Math.floor(Math.random() * 30);
          for (let k = 0; k < w && i + k < len; k++) cd[i + k] += amp * (1 - k / w) * (k % 2 ? -1 : 1);
        }
      }

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

      // V2 — bus de reverberación (eco de valle procedural).
      this.reverbIn = this.ctx.createGain();
      this.reverbIn.gain.value = 0.9;
      const conv = this.ctx.createConvolver();
      conv.buffer = this.makeImpulseResponse(this.ctx);
      this.reverbIn.connect(conv).connect(this.master);
    } catch {
      this.ctx = null; // sin audio: la simulación sigue igual
      this.master = null;
      this.reverbIn = null;
    }
  }

  /**
   * Respuesta impulsional estéreo: cola difusa exponencial (RT60 ~2.6 s) que
   * se oscurece con el tiempo + ecos discretos de las laderas.
   */
  private makeImpulseResponse(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const dur = 3.4;
    const n = Math.floor(sr * dur);
    const ir = ctx.createBuffer(2, n, sr);
    const echoes = [
      { t: 0.32, a: 0.55, w: 0.06 },
      { t: 0.71, a: 0.38, w: 0.09 },
      { t: 1.12, a: 0.26, w: 0.12 },
      { t: 1.63, a: 0.17, w: 0.16 },
    ];
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        // Decaimiento: −60 dB en ~2.6 s; arranque suave (sin predelay seco).
        let env = Math.exp(-t * 2.65) * Math.min(1, t / 0.012) * 0.55;
        for (const e of echoes) {
          const dt = (t - e.t - ch * 0.013) / e.w;
          if (dt > -1 && dt < 3) env += e.a * Math.exp(-dt * dt * 0.8) * (dt < 0 ? 0.3 : 1);
        }
        // Paso-bajo progresivo: las reflexiones lejanas pierden agudos.
        const k = Math.min(0.97, 0.35 + t * 0.35);
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * env * 2.2;
      }
    }
    return ir;
  }

  /** Pan estéreo de un evento por su acimut respecto a la cámara. */
  private panOf(eventAzimuthDeg?: number): number {
    if (eventAzimuthDeg === undefined || !this.headingProvider) return 0;
    return panFromAzimuths(eventAzimuthDeg, this.headingProvider());
  }

  /**
   * Nodo de entrada de una voz puntual: absorción del aire (paso-bajo por
   * distancia) → panner → master, más el envío a la reverberación.
   */
  private voiceOut(pan: number, distanceM = 0): AudioNode {
    const ctx = this.ctx!;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = airAbsorptionCutoffHz(distanceM);
    air.Q.value = 0.5;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    air.connect(p).connect(this.master!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = reverbSend(distanceM);
      air.connect(send).connect(this.reverbIn);
    }
    return air;
  }

  /** Ráfaga de ruido filtrada con envolvente (bloque reutilizado por voces). */
  private noiseBurst(
    out: AudioNode, t0: number, gain: number, attack: number, dur: number,
    type: BiquadFilterType, freq: number, q = 0.7, buffer?: AudioBuffer,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer ?? this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.2, dur + 0.1);
  }

  /** Golpe senoidal con barrido descendente (el "pecho" del estampido). */
  private thump(out: AudioNode, t0: number, gain: number, f0: number, dur: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 1.8, t0);
    osc.frequency.exponentialRampToValueAtTime(f0, t0 + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t0);
    og.gain.linearRampToValueAtTime(gain, t0 + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0008, t0 + dur * 2);
    osc.connect(og).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur * 2 + 0.1);
  }

  /**
   * Programa un boom. `distanceM` fija retardo, atenuación y timbre;
   * `soundSpeed` viene de Atmosphere.sample; `energyScale` ~ yield^(1/3)
   * relativo. `eventAzimuthDeg` (P-VIVO.1) posiciona el evento en el estéreo;
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
    if (kind === 'crack') {
      // Compatibilidad: chasquido genérico de 155 mm a esa distancia.
      this.supersonicCrack(distanceM, soundSpeed, 0.155, 1.6, eventAzimuthDeg);
      return;
    }
    const t0 = this.ctx.currentTime + boomDelayS(distanceM, soundSpeed) + Math.max(0, jitterS);
    const gain = distanceGain(distanceM, energyScale);
    if (gain < 0.004) return;
    const out = this.voiceOut(this.panOf(eventAzimuthDeg), distanceM);
    const e = Math.min(2.5, Math.max(0.2, energyScale));

    switch (kind) {
      case 'muzzle':
        // Transitorio seco (onda de choque de boca) + cuerpo + pecho.
        this.noiseBurst(out, t0, gain * 0.9, 0.003, 0.18, 'bandpass', 1400, 0.6);
        this.noiseBurst(out, t0, gain, 0.01, 0.9 + 0.3 * e, 'lowpass', 260);
        this.thump(out, t0, gain * 0.9, 55 / Math.sqrt(e), 0.35);
        break;
      case 'impact':
        this.noiseBurst(out, t0, gain * 0.8, 0.004, 0.25, 'bandpass', 1100, 0.5);
        this.noiseBurst(out, t0, gain, 0.012, 1.8 + 0.6 * e, 'lowpass', 180);
        this.thump(out, t0, gain * 0.95, 38 / Math.sqrt(e), 0.8);
        if (distanceM > 1500) this.rumble(out, t0 + 0.15, gain * 0.55, 2.4 + distanceM / 4000);
        break;
      case 'impactWater':
        // P-VIVO.4 — el agua se traga las frecuencias: ataque blando ("flump").
        this.noiseBurst(out, t0, gain, 0.06, 1.6, 'lowpass', 110);
        this.thump(out, t0, gain * 0.8, 30, 0.7);
        this.noiseBurst(out, t0 + 0.4, gain * 0.25, 0.3, 2.2, 'highpass', 900); // lluvia del espray
        break;
      case 'rifle':
        // P-VIVO.1 — crack corto muy agudo + golpe seco breve.
        this.noiseBurst(out, t0, gain, 0.002, 0.16, 'highpass', 1800);
        this.thump(out, t0, gain * 0.5, 120, 0.05);
        break;
    }
  }

  /** Retumbo lejano: ruido muy grave con modulación lenta ("trueno rodante"). */
  private rumble(out: AudioNode, t0: number, gain: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 90;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1.3 + Math.random();
    const lfoG = ctx.createGain();
    lfoG.gain.value = gain * 0.4;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.1);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.1);
  }

  /**
   * V2 — chasquido supersónico: onda N real con la duración de Whitham para
   * el calibre, Mach y distancia de paso, más su reflexión en el suelo. Llega
   * con el retardo de la distancia de paso (el cono de Mach barre al oyente
   * justo tras el máximo acercamiento).
   */
  supersonicCrack(
    missDistanceM: number, soundSpeed: number, caliberM: number, mach: number,
    eventAzimuthDeg?: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const gain = nWaveGain(missDistanceM, caliberM);
    if (gain < 0.01) return;
    const T = nWaveDurationS(missDistanceM, caliberM, mach, soundSpeed);
    const sr = ctx.sampleRate;
    const n = Math.max(8, Math.ceil(T * sr));
    const tail = Math.ceil(0.004 * sr);
    const buf = ctx.createBuffer(1, n * 2 + tail * 2, sr);
    const d = buf.getChannelData(0);
    // Onda N: salto a +1, rampa lineal a −1, salto a 0 (frentes de ~2 muestras).
    const write = (off: number, amp: number) => {
      for (let i = 0; i < n; i++) {
        const v = 1 - (2 * i) / (n - 1);
        const edge = i < 2 ? (i + 1) / 3 : 1;
        d[off + i] += amp * v * edge;
      }
    };
    write(0, 1);
    // Reflexión en el suelo: llega un pelín después, más débil y suavizada.
    write(Math.ceil(0.0011 * sr) + Math.ceil(Math.min(0.004, missDistanceM / 20000) * sr), 0.45);
    const t0 = ctx.currentTime + boomDelayS(missDistanceM, soundSpeed);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    const out = this.voiceOut(this.panOf(eventAzimuthDeg), missDistanceM * 0.3);
    src.connect(g).connect(out);
    src.start(t0);
    // "Restallido" del frente que se rompe en el aire (agudo, cortísimo).
    this.noiseBurst(out, t0, gain * 0.35, 0.0008, 0.05 + T * 4, 'highpass', 2500, 0.7);
  }

  /**
   * V2 — rugido de lanzamiento de cohete/misil: ruido grave + crepitar
   * durante la combustión; se apaga y oscurece al alejarse el motor.
   */
  launchRoar(
    distanceM: number, soundSpeed: number, burnTimeS: number, scale = 1,
    eventAzimuthDeg?: number, missile = false,
  ): void {
    if (!this.ctx || !this.noise || !this.crackle || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + boomDelayS(distanceM, soundSpeed);
    const gain = distanceGain(distanceM, 0.9 * Math.min(2, scale));
    if (gain < 0.004) return;
    const dur = Math.min(24, Math.max(2.5, burnTimeS)) + 2.5;
    const out = this.voiceOut(this.panOf(eventAzimuthDeg), distanceM);

    // Rugido grave (paso-bajo que se cierra al alejarse).
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(missile ? 520 : 650, t0);
    lp.frequency.exponentialRampToValueAtTime(140, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.12);
    // La distancia al motor crece ~cuadráticamente: la ganancia cae.
    g.gain.setTargetAtTime(gain * 0.35, t0 + 0.6, Math.max(0.8, burnTimeS * 0.4));
    g.gain.setTargetAtTime(0.0001, t0 + dur - 2.2, 0.7);
    rumble.connect(lp).connect(g).connect(out);
    rumble.start(t0, Math.random());
    rumble.stop(t0 + dur + 0.5);

    // Crepitar de la combustión (medios-agudos, se pierde antes).
    const cr = ctx.createBufferSource();
    cr.buffer = this.crackle;
    cr.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t0);
    cg.gain.linearRampToValueAtTime(gain * 0.55, t0 + 0.08);
    cg.gain.setTargetAtTime(0.0001, t0 + 0.5, Math.max(0.5, burnTimeS * 0.25));
    cr.connect(bp).connect(cg).connect(out);
    cr.start(t0, Math.random());
    cr.stop(t0 + dur + 0.5);
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
    // Voz inaudible y proyectil lejos: desmonta el grafo (osc + ruido en loop
    // + biquad quemaban CPU todo el vuelo). Si vuelve a <500 m se recrea.
    if (v && gain <= 0 && distanceM > 600) {
      this.whistleStop(key);
      return;
    }
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
