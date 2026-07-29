// ============================================================================
//  AudioEngine.ts — Audio sintetizado con propagación física.  [P-AUD.1]
//
//  Sustituye al AudioBoom original (ruido lowpass + seno) por una cadena que
//  modela cómo suena de verdad un cañón a kilómetros de distancia:
//
//    1. RETARDO ACÚSTICO      t = d / a(h)  — ves el fogonazo y el estampido
//                             llega después (a 3 km, ~9 s).
//    2. ABSORCIÓN DEL AIRE    α(f) ≈ 1e-9·f²  dB/m: los agudos se comen a los
//                             pocos cientos de metros y solo sobrevive el
//                             grave. Un lowpass con fc = √(12/(1e-9·d)) lo
//                             reproduce: 11 kHz a 100 m, 3.5 kHz a 1 km,
//                             775 Hz a 20 km. Por eso lo lejano "retumba".
//    3. COLA DE REVERBERACIÓN Convolución con dos IR sintéticas (valle corto y
//                             largo). Cuanto más lejos, más señal va al envío
//                             largo: el eco rodante entre laderas.
//    4. PANORÁMICA            StereoPanner con el eje derecho de la cámara; si
//                             la fuente queda detrás, se apaga algo el agudo.
//    5. LIMITADOR             Compresor duro al final: una salva de 12 tiros
//                             no satura ni pega un petardazo digital.
//
//  Voces sintetizadas (cero assets binarios):
//    muzzle      — cañonazo: transitorio + cuerpo con barrido LP + sub que cae
//                  de 70 a 28 Hz + cola de retumbo que crece con la distancia.
//    muzzleSmall — arma ligera: seco, agudo, sin sub de pecho.
//    impact      — detonación: sub profundo, escombros granulares, cola larga.
//    crack       — onda N supersónica: dos transitorios separados por la
//                  longitud real de la N (L/v), no un chasquido cualquiera.
//    whistle     — silbido del proyectil entrante con Doppler descendente.
//    servo       — motor de puntería mientras el arma gira (loop, pitch por
//                  velocidad angular).
//    mech        — culata, bandeja de carga, casquillo al suelo, gatillo.
// ============================================================================

export type BoomKind = 'muzzle' | 'muzzleSmall' | 'impact' | 'crack';
export type MechKind = 'breechOpen' | 'breechClose' | 'load' | 'casing' | 'click';

/** Todo lo que el motor necesita para colocar un sonido en el espacio. */
export interface SoundCue {
  /** Distancia oyente→fuente (m): fija retardo, atenuación y absorción. */
  distanceM: number;
  /** Velocidad del sonido local (m/s), de la atmósfera del servicio. */
  soundSpeed: number;
  /** Escala de energía relativa (~yield^(1/3) o calibre relativo). */
  energy?: number;
  /** Panorámica −1 (izq) … +1 (der); 0 = centrado. */
  pan?: number;
  /** La fuente queda a la espalda del oyente: filtra un poco los agudos. */
  behind?: boolean;
  /** Calibre (m): afina el timbre (una .50 no suena como un 203 mm). */
  caliberM?: number;
}

const NOISE_SECONDS = 5;
const VOICE_CAP = 28;        // voces "gordas" simultáneas antes de recortar
const STORAGE_KEY = 'unai.audio';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private revNearIn!: GainNode;
  private revFarIn!: GainNode;

  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;

  private volume = 0.85;
  private muted = false;

  /** Voces vivas: por encima del cap se recortan los adornos (escombros…). */
  private voices = 0;

  /** Motor de puntería: nodos persistentes, arrancados a la primera. */
  private servoNodes: {
    osc: OscillatorNode; sub: OscillatorNode; noise: AudioBufferSourceNode;
    gain: GainNode; filter: BiquadFilterNode;
  } | null = null;

  constructor() {
    // Preferencia persistida (el usuario no quiere volver a bajar el volumen
    // cada vez que recarga).
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { volume?: number; muted?: boolean };
        if (typeof s.volume === 'number') this.volume = clamp(s.volume, 0, 1);
        if (typeof s.muted === 'boolean') this.muted = s.muted;
      }
    } catch { /* sin localStorage: valores por defecto */ }
  }

  // -------------------------------------------------------------------------
  //  Ciclo de vida
  // -------------------------------------------------------------------------

  /** Llamar desde un gesto de usuario (botón FUEGO) para desbloquear. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.buildGraph();
    } catch {
      this.ctx = null; // sin audio: la simulación sigue igual
    }
  }

  get enabled(): boolean { return this.ctx !== null; }
  get isMuted(): boolean { return this.muted; }
  get masterVolume(): number { return this.volume; }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    this.applyGain();
    this.persist();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
    this.persist();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch { /* da igual */ }
  }

  private applyGain(): void {
    if (!this.ctx) return;
    const g = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  // -------------------------------------------------------------------------
  //  Grafo: [voces] → dry ┐
  //                       ├→ master → limitador → salida
  //         [voces] → rev ┘
  // -------------------------------------------------------------------------
  private buildGraph(): void {
    const ctx = this.ctx!;

    // Limitador final: nada de clipping digital con salvas de 12 tiros.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(limiter);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.master);

    // Dos ambientes: reflexión cercana (0.9 s) y valle abierto (4.5 s).
    const near = ctx.createConvolver();
    near.buffer = this.makeImpulse(0.9, 2.6, 0.55);
    const nearOut = ctx.createGain();
    nearOut.gain.value = 0.9;
    near.connect(nearOut).connect(this.master);
    this.revNearIn = ctx.createGain();
    this.revNearIn.gain.value = 1;
    this.revNearIn.connect(near);

    const far = ctx.createConvolver();
    far.buffer = this.makeImpulse(4.5, 1.5, 0.22);
    const farOut = ctx.createGain();
    farOut.gain.value = 1.4;
    far.connect(farOut).connect(this.master);
    this.revFarIn = ctx.createGain();
    this.revFarIn.gain.value = 1;
    this.revFarIn.connect(far);

    this.white = this.makeNoise('white');
    this.pink = this.makeNoise('pink');
    this.brown = this.makeNoise('brown');
  }

  /**
   * IR sintética: ruido con decaimiento exponencial y sesgo grave creciente
   * (las reflexiones lejanas llegan ya sin agudos). `tilt` = 0..1, cuánto se
   * oscurece la cola.
   */
  private makeImpulse(seconds: number, decay: number, tilt: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(1 - t, decay);
        const raw = (Math.random() * 2 - 1) * env;
        // Un polo: cuanto más avanza la cola, más cerrado el filtro.
        const a = 1 - tilt * t;
        lp += (raw - lp) * clamp(a, 0.04, 1);
        // Huecos aleatorios: reflexiones discretas, no una pared de ruido.
        d[i] = lp * (0.55 + 0.45 * Math.random());
      }
    }
    return buf;
  }

  private makeNoise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }
    if (kind === 'brown') {
      // Integrador con fuga: −6 dB/octava, el color del retumbo lejano.
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = clamp(last * 3.5, -1, 1);
      }
      return buf;
    }
    // Rosa (Paul Kellet): −3 dB/octava, el color del "cuerpo" del estampido.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11, -1, 1);
      b6 = w * 0.115926;
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  //  Física de la propagación
  // -------------------------------------------------------------------------

  /** Retardo acústico en segundos (la luz es instantánea, el sonido no). */
  private delayFor(cue: SoundCue): number {
    return Math.max(0.005, cue.distanceM / Math.max(200, cue.soundSpeed));
  }

  /**
   * Atenuación geométrica. Un frente esférico cae 1/d, pero una explosión de
   * artillería a 10 km sigue oyéndose: el exponente 0.75 (en vez de 1) y el
   * suelo de 0.02 dejan el retumbo lejano audible sin reventar lo cercano.
   */
  private attenuation(cue: SoundCue): number {
    const d = Math.max(35, cue.distanceM);
    const energy = cue.energy ?? 1;
    return clamp(Math.pow(260 / d, 0.75) * energy, 0, 1.6);
  }

  /**
   * Frecuencia de corte por absorción atmosférica: α(f) ≈ 1e-9·f² dB/m; se
   * corta donde la absorción acumulada llega a ~12 dB.
   */
  private airCutoff(distanceM: number): number {
    const d = Math.max(20, distanceM);
    return clamp(Math.sqrt(1.2e10 / d), 220, 18000);
  }

  /** Cadena espacial común: LP de aire → panner → dry + envíos de reverb. */
  private spatialChain(cue: SoundCue, revNear: number, revFar: number): AudioNode {
    const ctx = this.ctx!;
    const input = ctx.createGain();

    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = this.airCutoff(cue.distanceM);
    air.Q.value = 0.7;
    input.connect(air);

    // Fuente a la espalda: la cabeza filtra ~2.5 kHz arriba.
    let head: AudioNode = air;
    if (cue.behind) {
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf';
      shelf.frequency.value = 2200;
      shelf.gain.value = -7;
      air.connect(shelf);
      head = shelf;
    }

    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(cue.pan ?? 0, -1, 1) * 0.85;
    head.connect(pan);

    pan.connect(this.dry);

    // Envíos de reverb: cerca domina la reflexión corta; lejos, el valle.
    const near = ctx.createGain();
    near.gain.value = revNear;
    pan.connect(near).connect(this.revNearIn);

    const far = ctx.createGain();
    far.gain.value = revFar;
    pan.connect(far).connect(this.revFarIn);

    return input;
  }

  /** Mezcla seco/reverb en función de la distancia (0 m → seco, 5 km → cola). */
  private revMix(distanceM: number): { near: number; far: number } {
    const d = Math.max(0, distanceM);
    const far = clamp(d / 4000, 0, 1);
    return { near: 0.22 + 0.35 * (1 - far), far: 0.15 + 0.85 * far };
  }

  // -------------------------------------------------------------------------
  //  Bloques elementales
  // -------------------------------------------------------------------------

  private noiseSource(kind: 'white' | 'pink' | 'brown', dur: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = kind === 'white' ? this.white : kind === 'pink' ? this.pink : this.brown;
    if (dur > NOISE_SECONDS - 0.2) src.loop = true;
    return src;
  }

  /** Ráfaga de ruido filtrada con envolvente percusiva. */
  private burst(opts: {
    dest: AudioNode; t0: number; kind: 'white' | 'pink' | 'brown';
    gain: number; attack: number; dur: number;
    filter: BiquadFilterType; f0: number; f1?: number; q?: number;
  }): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(opts.kind, opts.dur);
    const f = ctx.createBiquadFilter();
    f.type = opts.filter;
    f.Q.value = opts.q ?? 0.8;
    f.frequency.setValueAtTime(opts.f0, opts.t0);
    if (opts.f1 !== undefined && opts.f1 !== opts.f0) {
      f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), opts.t0 + opts.dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(1e-4, opts.t0);
    g.gain.linearRampToValueAtTime(opts.gain, opts.t0 + Math.max(0.0005, opts.attack));
    g.gain.exponentialRampToValueAtTime(1e-4, opts.t0 + opts.dur);
    src.connect(f).connect(g).connect(opts.dest);
    // Offset aleatorio (rompe el patrón), dejando sitio para la cola entera.
    const offset = Math.random() * Math.max(0, NOISE_SECONDS - opts.dur - 0.15);
    if (src.loop) src.start(opts.t0, offset);
    else src.start(opts.t0, offset, opts.dur + 0.05);
    src.stop(opts.t0 + opts.dur + 0.08);
    this.trackVoice(src, opts.dur + 0.1);
  }

  /** Golpe senoidal con caída de tono (el "pecho" del estampido). */
  private thump(opts: {
    dest: AudioNode; t0: number; gain: number;
    fStart: number; fEnd: number; dur: number; type?: OscillatorType;
  }): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.fStart, opts.t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(12, opts.fEnd), opts.t0 + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1e-4, opts.t0);
    g.gain.linearRampToValueAtTime(opts.gain, opts.t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(1e-4, opts.t0 + opts.dur);
    osc.connect(g).connect(opts.dest);
    osc.start(opts.t0);
    osc.stop(opts.t0 + opts.dur + 0.05);
    this.trackVoice(osc, opts.dur + 0.1);
  }

  private trackVoice(node: AudioScheduledSourceNode, life: number): void {
    this.voices++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.voices = Math.max(0, this.voices - 1);
    };
    node.onended = release;
    // Red de seguridad: si onended no llega (nodo robado), libera igual.
    window.setTimeout(release, (life + 1) * 1000);
  }

  // -------------------------------------------------------------------------
  //  Voces principales
  // -------------------------------------------------------------------------

  /** Estampido con retardo, absorción, reverb y panorámica. */
  boom(kind: BoomKind, cue: SoundCue): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const att = this.attenuation(cue);
    if (att < 0.004) return;

    const t0 = ctx.currentTime + this.delayFor(cue);
    const mix = this.revMix(cue.distanceM);
    const cal = cue.caliberM ?? 0.155;
    // Calibre relativo: un 203 mm baja el tono, una .50 lo sube.
    const bore = clamp(Math.cbrt(0.155 / Math.max(0.005, cal)), 0.45, 3.2);
    const near = cue.distanceM < 1500;

    switch (kind) {
      case 'muzzle': {
        const dest = this.spatialChain(cue, mix.near, mix.far);
        // 1. Transitorio: el frente de choque de la boca, 6 ms.
        this.burst({
          dest, t0, kind: 'white', gain: att * 0.9, attack: 0.0008, dur: 0.05,
          filter: 'highpass', f0: 1400, q: 0.5,
        });
        // 2. Cuerpo: barrido de 1.1 kHz a 120 Hz — el "BOOM" que se abre.
        this.burst({
          dest, t0: t0 + 0.004, kind: 'pink', gain: att * 1.0, attack: 0.006, dur: 0.55,
          filter: 'lowpass', f0: 1100 * bore, f1: 120 * bore, q: 1.1,
        });
        // 3. Sub de pecho: 70 → 28 Hz.
        this.thump({
          dest, t0, gain: att * 0.95, fStart: 72 * bore, fEnd: 28 * bore, dur: 0.45,
        });
        // 4. Retumbo rodante: más largo cuanto más lejos (0.8 s → 4 s).
        const tail = clamp(0.8 + cue.distanceM / 1400, 0.8, 4.2);
        this.burst({
          dest, t0: t0 + 0.03, kind: 'brown', gain: att * 0.55, attack: 0.08, dur: tail,
          filter: 'lowpass', f0: 320, f1: 90, q: 0.6,
        });
        break;
      }

      case 'muzzleSmall': {
        const dest = this.spatialChain(cue, mix.near * 0.8, mix.far * 0.7);
        // Un fusil es casi todo transitorio: crack seco y punto.
        this.burst({
          dest, t0, kind: 'white', gain: att * 1.0, attack: 0.0004, dur: 0.035,
          filter: 'highpass', f0: 900 * clamp(bore, 0.8, 2.4), q: 0.6,
        });
        this.burst({
          dest, t0: t0 + 0.001, kind: 'pink', gain: att * 0.7, attack: 0.002, dur: 0.16,
          filter: 'bandpass', f0: 1500 * bore, f1: 400 * bore, q: 1.4,
        });
        this.thump({ dest, t0, gain: att * 0.35, fStart: 190, fEnd: 70, dur: 0.1 });
        this.burst({
          dest, t0: t0 + 0.02, kind: 'brown', gain: att * 0.3, attack: 0.03,
          dur: clamp(0.4 + cue.distanceM / 2500, 0.4, 2.2),
          filter: 'lowpass', f0: 700, f1: 180, q: 0.6,
        });
        break;
      }

      case 'impact': {
        const dest = this.spatialChain(cue, mix.near, mix.far * 1.25);
        const y = clamp(cue.energy ?? 1, 0.2, 6);
        // 1. Fractura de la carcasa: transitorio brillante.
        this.burst({
          dest, t0, kind: 'white', gain: att * 0.8, attack: 0.0006, dur: 0.06,
          filter: 'highpass', f0: 1200, q: 0.5,
        });
        // 2. Bola de fuego: barrido descendente, más lento cuanto más yield.
        this.burst({
          dest, t0: t0 + 0.005, kind: 'pink', gain: att * 1.05, attack: 0.008,
          dur: 0.55 + 0.25 * y, filter: 'lowpass', f0: 900, f1: 90, q: 1.0,
        });
        // 3. Sub profundo: la onda de sobrepresión que se siente, no se oye.
        this.thump({
          dest, t0, gain: att * 1.1, fStart: 58 / Math.cbrt(y), fEnd: 18, dur: 0.55 + 0.3 * y,
        });
        // 4. Escombros: granos dispersos (solo si hay voces libres y está cerca).
        if (near && this.voices < VOICE_CAP) {
          const grains = Math.round(clamp(6 * y, 4, 16));
          for (let i = 0; i < grains; i++) {
            const dt = 0.12 + Math.random() * (0.5 + 0.6 * y);
            this.burst({
              dest, t0: t0 + dt, kind: 'white', gain: att * 0.16 * Math.random(),
              attack: 0.001, dur: 0.05 + Math.random() * 0.09,
              filter: 'bandpass', f0: 600 + Math.random() * 2600, q: 2.5,
            });
          }
        }
        // 5. Cola larga: el eco que recorre el valle.
        const tail = clamp(1.4 + cue.distanceM / 900, 1.4, 6.5);
        this.burst({
          dest, t0: t0 + 0.04, kind: 'brown', gain: att * 0.6, attack: 0.1, dur: tail,
          filter: 'lowpass', f0: 260, f1: 70, q: 0.6,
        });
        break;
      }

      case 'crack': {
        // Onda N: dos frentes (choque de proa y de cola) separados por L/v.
        // Para un 155 mm a Mach 2 son ~2 ms; para una bala, ~0.3 ms.
        const dest = this.spatialChain(cue, mix.near * 0.5, mix.far * 0.5);
        const nWidth = clamp(cal * 6.5 / 600, 0.0003, 0.004);
        this.burst({
          dest, t0, kind: 'white', gain: att * 1.1, attack: 0.0002, dur: 0.012,
          filter: 'highpass', f0: 2400, q: 0.4,
        });
        this.burst({
          dest, t0: t0 + nWidth, kind: 'white', gain: att * 0.75, attack: 0.0002, dur: 0.02,
          filter: 'highpass', f0: 1600, q: 0.4,
        });
        // Cola de "zumbido" que deja el paso del proyectil.
        this.burst({
          dest, t0: t0 + nWidth + 0.004, kind: 'pink', gain: att * 0.3, attack: 0.004,
          dur: 0.22, filter: 'bandpass', f0: 900, f1: 260, q: 1.6,
        });
        break;
      }
    }
  }

  /**
   * Silbido del proyectil entrante. `delayS` es cuándo empieza a oírse desde
   * ahora (el llamante ya ha descontado el retardo acústico); la frecuencia
   * cae por Doppler al pasar de acercarse a alejarse.
   */
  whistle(opts: {
    delayS: number; durS: number; closingSpeed: number; soundSpeed: number;
    distanceM: number; pan?: number; energy?: number; caliberM?: number;
  }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const cue: SoundCue = {
      distanceM: opts.distanceM, soundSpeed: opts.soundSpeed,
      energy: opts.energy, pan: opts.pan, caliberM: opts.caliberM,
    };
    const att = this.attenuation(cue) * 0.55;
    if (att < 0.01) return;

    const t0 = ctx.currentTime + Math.max(0.01, opts.delayS);
    const dur = clamp(opts.durS, 0.5, 6);
    const mix = this.revMix(opts.distanceM);
    const dest = this.spatialChain(cue, mix.near * 0.6, mix.far * 0.8);

    // Tono base por calibre: un 203 mm silba grave, un 120 mm agudo.
    const cal = opts.caliberM ?? 0.155;
    const f0 = clamp(560 * Math.sqrt(0.155 / Math.max(0.02, cal)), 180, 1400);
    // Doppler: f = f0·c/(c − v_r). Al llegar, v_r → 0 y el tono se desploma.
    const c = Math.max(200, opts.soundSpeed);
    const v = clamp(opts.closingSpeed, 0, c * 0.9);
    const fStart = f0 * (c / (c - v));
    const fEnd = f0 * 0.62;

    const src = this.noiseSource('white', dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 11;
    bp.frequency.setValueAtTime(fStart, t0);
    bp.frequency.setValueAtTime(fStart, t0 + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);

    // Segundo formante una quinta arriba: el silbido real no es un seno puro.
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = 7;
    bp2.frequency.setValueAtTime(fStart * 1.5, t0);
    bp2.frequency.setValueAtTime(fStart * 1.5, t0 + dur * 0.55);
    bp2.frequency.exponentialRampToValueAtTime(fEnd * 1.5, t0 + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(1e-4, t0);
    g.gain.exponentialRampToValueAtTime(att, t0 + dur * 0.85);  // crece al acercarse
    g.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);

    const g2 = ctx.createGain();
    g2.gain.value = 0.4;

    src.connect(bp).connect(g).connect(dest);
    src.connect(bp2).connect(g2).connect(g);
    const offset = Math.random() * (NOISE_SECONDS - dur - 0.1);
    if (src.loop) src.start(t0, Math.max(0, offset));
    else src.start(t0, Math.max(0, offset), dur + 0.05);
    src.stop(t0 + dur + 0.08);
    this.trackVoice(src, dur + 0.1);
  }

  // -------------------------------------------------------------------------
  //  Mecánica del arma (sin retardo apreciable: el arma está "aquí")
  // -------------------------------------------------------------------------

  /** Golpes metálicos del ciclo de carga, casquillos y gatillo. */
  mech(kind: MechKind, cue: SoundCue): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const att = this.attenuation({ ...cue, energy: (cue.energy ?? 1) * 0.5 });
    if (att < 0.006) return;
    const t0 = ctx.currentTime + this.delayFor(cue);
    const mix = this.revMix(cue.distanceM);
    const dest = this.spatialChain(cue, mix.near * 0.7, mix.far * 0.4);

    switch (kind) {
      case 'breechOpen':
        // Chirrido + tope: la cuña deslizante corre y golpea.
        this.burst({
          dest, t0, kind: 'white', gain: att * 0.25, attack: 0.004, dur: 0.14,
          filter: 'bandpass', f0: 2600, f1: 1400, q: 2.2,
        });
        this.burst({
          dest, t0: t0 + 0.13, kind: 'white', gain: att * 0.5, attack: 0.0006, dur: 0.09,
          filter: 'bandpass', f0: 780, q: 3.5,
        });
        this.thump({ dest, t0: t0 + 0.13, gain: att * 0.3, fStart: 230, fEnd: 90, dur: 0.12 });
        break;

      case 'breechClose':
        // Cierre: golpe seco con resonancia de campana de acero.
        this.burst({
          dest, t0, kind: 'white', gain: att * 0.6, attack: 0.0004, dur: 0.11,
          filter: 'bandpass', f0: 1100, q: 2.8,
        });
        this.thump({ dest, t0, gain: att * 0.45, fStart: 320, fEnd: 110, dur: 0.18 });
        this.thump({ dest, t0: t0 + 0.005, gain: att * 0.14, fStart: 1450, fEnd: 1300, dur: 0.3, type: 'triangle' });
        break;

      case 'load':
        // Bandeja/atacador: raspado del proyectil entrando en la recámara.
        this.burst({
          dest, t0, kind: 'pink', gain: att * 0.3, attack: 0.02, dur: 0.32,
          filter: 'bandpass', f0: 900, f1: 1800, q: 1.2,
        });
        this.burst({
          dest, t0: t0 + 0.3, kind: 'white', gain: att * 0.4, attack: 0.0006, dur: 0.07,
          filter: 'bandpass', f0: 620, q: 3.0,
        });
        break;

      case 'casing': {
        // Casquillo rebotando: 3-5 tintineos que decaen y se juntan.
        let dt = 0;
        const n = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const amp = att * 0.35 * Math.pow(0.62, i);
          this.thump({
            dest, t0: t0 + dt, gain: amp,
            fStart: 2600 + Math.random() * 1800, fEnd: 1600, dur: 0.16, type: 'triangle',
          });
          this.burst({
            dest, t0: t0 + dt, kind: 'white', gain: amp * 0.7, attack: 0.0004, dur: 0.05,
            filter: 'highpass', f0: 2800, q: 1.2,
          });
          dt += 0.09 + Math.random() * 0.11;
        }
        break;
      }

      case 'click':
        this.burst({
          dest, t0, kind: 'white', gain: att * 0.3, attack: 0.0003, dur: 0.03,
          filter: 'bandpass', f0: 2200, q: 4,
        });
        break;
    }
  }

  /**
   * Motor de puntería. `rateDegS` es la velocidad angular total del arma;
   * 0 apaga la voz. El tono sube con la velocidad, como un servo real.
   */
  servo(rateDegS: number, load = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const active = rateDegS > 0.05;

    if (!this.servoNodes) {
      if (!active) return;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const noise = this.noiseSource('white', 1e6);
      noise.loop = true;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.12;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 620;
      filter.Q.value = 3.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(filter);
      noise.connect(noiseGain).connect(filter);
      filter.connect(gain).connect(this.dry);
      osc.start();
      sub.start();
      noise.start();
      this.servoNodes = { osc, sub, noise, gain, filter };
    }

    const s = this.servoNodes;
    const now = ctx.currentTime;
    const norm = clamp(rateDegS / 12, 0, 1);
    const target = active ? 0.045 + 0.05 * norm + 0.02 * load : 0;
    s.gain.gain.setTargetAtTime(target, now, 0.06);
    s.osc.frequency.setTargetAtTime(58 + 46 * norm, now, 0.08);
    s.sub.frequency.setTargetAtTime(29 + 23 * norm, now, 0.08);
    s.filter.frequency.setTargetAtTime(420 + 520 * norm, now, 0.08);
  }

  dispose(): void {
    if (!this.ctx) return;
    if (this.servoNodes) {
      this.servoNodes.osc.stop();
      this.servoNodes.sub.stop();
      this.servoNodes.noise.stop();
      this.servoNodes = null;
    }
    void this.ctx.close();
    this.ctx = null;
  }
}
