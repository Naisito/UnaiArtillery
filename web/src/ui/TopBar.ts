// ============================================================================
//  TopBar.ts — Barra superior de la estación de tiro.
//
//  Marca · chip de estado de misión (LISTO/APUNTANDO/CALCULANDO/EN VUELO/
//  IMPACTO) · posición de la batería (MGRS o lat/lon + cota) · resumen del
//  objetivo · chip MET (flecha de viento, velocidad, T, P; clic → pestaña
//  METEO) · reloj Zulú de la escena y hora solar local · día/noche · audio
//  (volumen + silencio) · ajustes · ayuda.
//
//  Refresco barato: `refresh()` (≈4 Hz desde main) solo escribe en el DOM
//  lo que cambió.
// ============================================================================
import { SliderField, Toggle, chip, iconButton, setChip } from './components';
import { h, setText } from './dom';
import { icon, logoSvg } from './icons';
import { MissionPhase, PHASE_LABEL, missionStatus } from './missionStatus';
import { settings } from './settings';
import { distanceParts, fmtAngle, fmtCoord, fmtNum } from './units';

export interface MetSummary {
  /** Fuente activa: 'manual' (constante), 'profile' (cizalladura), 'real'. */
  source: 'manual' | 'profile' | 'real';
  windSpeedMS: number;
  windFromDeg: number;
  tempC: number;
  pressureHPa: number;
}

export interface TopBarHost {
  battery(): { latDeg: number; lonDeg: number; heightM: number };
  target(): { rangeM: number; bearingDeg: number } | null;
  met(): MetSummary;
  sceneDate(): Date;
  night(): boolean;
  audio(): { volume: number; muted: boolean };
  toggleNight(): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  openSettings(): void;
  openHelp(): void;
  openMet(): void;
}

const PHASE_TONE: Record<MissionPhase, 'ok' | 'accent' | 'info' | 'warn' | 'danger'> = {
  ready: 'ok',
  aiming: 'accent',
  computing: 'info',
  inflight: 'warn',
  impact: 'danger',
};

const SOURCE_LABEL: Record<MetSummary['source'], string> = {
  manual: 'Manual',
  profile: 'Perfil',
  real: 'Real',
};

export class TopBar {
  readonly el: HTMLElement;
  private readonly statusChip: HTMLElement;
  private readonly batCoord: HTMLElement;
  private readonly batAlt: HTMLElement;
  private readonly tgtVal: HTMLElement;
  private readonly tgtSub: HTMLElement;
  private readonly metArrow: HTMLElement;
  private readonly metWind: HTMLElement;
  private readonly metDir: HTMLElement;
  private readonly metTP: HTMLElement;
  private readonly metSrc: HTMLElement;
  private readonly clockZ: HTMLElement;
  private readonly clockL: HTMLElement;
  private readonly nightBtn: HTMLButtonElement;
  private readonly audioBtn: HTMLButtonElement;
  private readonly audioPop: HTMLElement;
  private readonly volField: SliderField;
  private readonly muteToggle: Toggle;

  constructor(private readonly host: TopBarHost) {
    this.el = document.getElementById('topbar')!;
    this.el.textContent = '';

    // -- Marca --------------------------------------------------------------
    const brand = h('div', { class: 'tb-brand' });
    const logo = h('span', { class: 'tb-logo' });
    logo.innerHTML = logoSvg(30);
    brand.append(
      logo,
      h('div', { class: 'tb-word' },
        h('span', { class: 'tb-word__name' }, h('b', { text: 'UNAI' }), ' ARTILLERY'),
        h('span', { class: 'tb-word__sub', text: 'Estación de dirección de tiro' }),
      ),
    );

    // -- Estado de misión -----------------------------------------------------
    this.statusChip = chip(PHASE_LABEL.ready, 'ok', 'mission-status');
    this.statusChip.classList.add('tb-status');
    missionStatus.subscribe((p) => setChip(this.statusChip, PHASE_LABEL[p], PHASE_TONE[p]));

    // -- Batería / objetivo ----------------------------------------------------
    this.batCoord = h('span', { class: 'tb-val num', testid: 'battery-coord' });
    this.batAlt = h('span', { class: 'tb-sub num' });
    const bat = h('div', { class: 'tb-block', dataset: { tip: 'Posición de la batería (asentamiento) y cota del terreno' } },
      h('span', { class: 'tb-sym tb-sym--friendly' }),
      h('div', { class: 'tb-block__text' },
        h('span', { class: 'tb-label', text: 'Batería' }),
        h('span', { class: 'tb-line' }, this.batCoord, this.batAlt),
      ),
    );
    this.tgtVal = h('span', { class: 'tb-val num', testid: 'topbar-target' });
    this.tgtSub = h('span', { class: 'tb-sub num' });
    const tgt = h('div', { class: 'tb-block tb-block--target', dataset: { tip: 'Objetivo designado: distancia y demora desde la batería' } },
      h('span', { class: 'tb-sym tb-sym--hostile' }),
      h('div', { class: 'tb-block__text' },
        h('span', { class: 'tb-label', text: 'Objetivo' }),
        h('span', { class: 'tb-line' }, this.tgtVal, this.tgtSub),
      ),
    );

    // -- MET -------------------------------------------------------------------
    this.metArrow = h('span', { class: 'tb-met__arrow' }, icon('arrowUp', 16));
    this.metWind = h('span', { class: 'tb-val num' });
    this.metDir = h('span', { class: 'tb-sub num' });
    this.metTP = h('span', { class: 'tb-sub num' });
    this.metSrc = h('span', { class: 'tb-met__src' });
    const met = h('button', {
      class: 'tb-met', testid: 'met-chip',
      attrs: { type: 'button', 'aria-label': 'Meteorología: abrir la pestaña METEO' },
      dataset: { tip: 'Meteorología activa — clic para abrir la pestaña METEO' },
      on: { click: () => host.openMet() },
    },
      this.metArrow,
      h('div', { class: 'tb-block__text' },
        h('span', { class: 'tb-label' }, 'MET ', this.metSrc),
        h('span', { class: 'tb-line' }, this.metWind, this.metDir, this.metTP),
      ),
    );

    // -- Reloj -------------------------------------------------------------------
    this.clockZ = h('span', { class: 'tb-val num' });
    this.clockL = h('span', { class: 'tb-sub num' });
    const clock = h('div', { class: 'tb-block tb-clock', dataset: { tip: 'Hora Zulú (UTC) de la escena y hora solar local de la batería' } },
      icon('clock', 16),
      h('div', { class: 'tb-block__text' },
        h('span', { class: 'tb-label', text: 'Hora' }),
        h('span', { class: 'tb-line' }, this.clockZ, this.clockL),
      ),
    );

    // -- Acciones ------------------------------------------------------------------
    this.nightBtn = iconButton({
      icon: 'moon', label: 'Noche: medianoche solar local en la batería', testid: 'night-toggle',
      pressed: false, onClick: () => host.toggleNight(),
    });
    this.audioBtn = iconButton({
      icon: 'volume', label: 'Audio', testid: 'audio-btn',
      onClick: (ev) => {
        ev.stopPropagation();
        this.toggleAudioPop();
      },
    });
    this.volField = new SliderField({ label: 'Volumen', min: 0, max: 100, step: 1, value: 80, unit: '%', testid: 'volume', icon: 'volume' });
    this.volField.onInput = (v) => {
      host.setVolume(v);
      this.reflectAudio();
    };
    this.muteToggle = new Toggle('Silenciar', false, { testid: 'mute' });
    this.muteToggle.onChange = (m) => {
      host.setMuted(m);
      this.reflectAudio();
    };
    this.audioPop = h('div', { class: 'tb-pop', attrs: { role: 'dialog', 'aria-label': 'Audio' } },
      h('span', { class: 'ua-eyebrow', text: 'Audio' }),
      this.volField.el,
      this.muteToggle.el,
      h('p', { class: 'tb-pop__note', text: 'Sonido sintetizado y posicional: el estampido llega con el retardo real del sonido.' }),
    );
    this.audioPop.hidden = true;
    document.addEventListener('pointerdown', (ev) => {
      if (!this.audioPop.hidden && !this.audioPop.contains(ev.target as Node) && ev.target !== this.audioBtn) {
        this.audioPop.hidden = true;
        this.audioBtn.classList.remove('is-active');
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !this.audioPop.hidden) {
        this.audioPop.hidden = true;
        this.audioBtn.classList.remove('is-active');
      }
    });
    const settingsBtn = iconButton({ icon: 'settings', label: 'Ajustes', testid: 'settings-open', onClick: () => host.openSettings() });
    const helpBtn = iconButton({ icon: 'help', label: 'Ayuda, atajos y tutorial (?)', testid: 'help-open', id: 'tutorialHelpBtn', onClick: () => host.openHelp() });

    this.el.append(
      brand,
      h('div', { class: 'tb-main' },
        this.statusChip,
        h('span', { class: 'tb-div' }),
        bat,
        h('span', { class: 'tb-div' }),
        tgt,
        h('span', { class: 'tb-grow' }),
        met,
        h('span', { class: 'tb-div' }),
        clock,
        h('span', { class: 'tb-div' }),
        h('div', { class: 'tb-actions' },
          this.nightBtn,
          h('div', { class: 'tb-audio' }, this.audioBtn, this.audioPop),
          settingsBtn,
          helpBtn,
        ),
      ),
    );

    settings.subscribe((_s, changed) => {
      if (changed.includes('coordFormat') || changed.includes('angleUnit')) this.refresh(true);
    });
    this.reflectAudio();
    this.refresh(true);
  }

  private toggleAudioPop(): void {
    const open = this.audioPop.hidden;
    this.audioPop.hidden = !open;
    this.audioBtn.classList.toggle('is-active', open);
    if (open) {
      this.reflectAudio();
      this.volField.range.focus();
    }
  }

  /** Sincroniza el control de audio con el estado real (AudioBoom). */
  reflectAudio(): void {
    const a = this.host.audio();
    this.volField.set(a.volume);
    this.muteToggle.set(a.muted);
    const off = a.muted || a.volume === 0;
    this.audioBtn.innerHTML = '';
    this.audioBtn.appendChild(icon(off ? 'volumeOff' : 'volume', 18));
    this.audioBtn.setAttribute('aria-label', off ? 'Audio silenciado' : `Audio ${a.volume} %`);
    this.audioBtn.dataset.tip = off ? 'Audio silenciado' : `Audio · ${a.volume} %`;
  }

  private nightState: boolean | null = null;

  /** Refleja día/noche en el botón (solo si cambió). */
  reflectNight(on: boolean): void {
    if (on === this.nightState) return;
    this.nightState = on;
    this.nightBtn.setAttribute('aria-pressed', String(on));
    this.nightBtn.innerHTML = '';
    this.nightBtn.appendChild(icon(on ? 'sun' : 'moon', 18));
    const label = on ? 'Día: restaurar la hora real' : 'Noche: medianoche solar local en la batería';
    this.nightBtn.setAttribute('aria-label', label);
    this.nightBtn.dataset.tip = label;
  }

  private lastClockS = -1;

  /** Refresco barato (≈4 Hz): solo escribe lo que cambió. */
  refresh(force = false): void {
    const b = this.host.battery();
    setText(this.batCoord, fmtCoord(b.latDeg, b.lonDeg, settings.coordFormat));
    setText(this.batAlt, `${fmtNum(b.heightM, 0)} m`);

    const t = this.host.target();
    if (t) {
      const d = distanceParts(t.rangeM);
      setText(this.tgtVal, `${d.value} ${d.unit}`);
      setText(this.tgtSub, fmtAngle(t.bearingDeg, settings.angleUnit, settings.angleUnit === 'mil' ? 0 : 1));
      this.tgtVal.classList.remove('is-empty');
    } else {
      setText(this.tgtVal, 'Sin designar');
      setText(this.tgtSub, '');
      this.tgtVal.classList.add('is-empty');
    }

    const m = this.host.met();
    setText(this.metWind, `${m.windSpeedMS.toFixed(m.windSpeedMS < 10 ? 1 : 0)} m/s`);
    setText(this.metDir, fmtAngle(m.windFromDeg, settings.angleUnit, 0));
    setText(this.metTP, `${m.tempC.toFixed(0)} °C · ${m.pressureHPa.toFixed(0)} hPa`);
    setText(this.metSrc, SOURCE_LABEL[m.source]);
    this.metSrc.dataset.src = m.source;
    // La flecha apunta HACIA donde sopla (desde + 180°).
    this.metArrow.style.transform = `rotate(${(m.windFromDeg + 180) % 360}deg)`;
    this.metArrow.classList.toggle('is-calm', m.windSpeedMS < 0.5);

    const d = this.host.sceneDate();
    const s = Math.floor(d.getTime() / 1000);
    if (force || s !== this.lastClockS) {
      this.lastClockS = s;
      const pad = (n: number) => String(n).padStart(2, '0');
      setText(this.clockZ, `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`);
      const solar = new Date(d.getTime() + (b.lonDeg / 15) * 3600_000);
      setText(this.clockL, `${pad(solar.getUTCHours())}:${pad(solar.getUTCMinutes())} L`);
    }
    this.reflectNight(this.host.night());
  }
}
