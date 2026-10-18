// ============================================================================
//  Settings.ts — Modal de Ajustes.  [V2/UI]
//
//  Unidades (milésimas/grados como principal, formato de coordenadas),
//  gráficos (calidad vía src/render/quality.ts, edificios 3D, arco previsto,
//  noche, campo de visión), audio (volumen y silencio) y sesión (compartir
//  escenario, restablecer, reiniciar tutorial), más la chuleta de atajos.
//  Al abrir se sincroniza con el estado REAL de cada fuente.
// ============================================================================
import { QUALITY_LABELS, QualityLevel, applyQuality, getQuality, onQualityChanged } from '../render/quality';
import { Modal, Segmented, SliderField, Toggle, button } from './components';
import { h } from './dom';
import { SHORTCUTS, shortcutList } from './Shortcuts';
import { settings } from './settings';
import type { AngleUnit, CoordFormat } from './units';

export interface SettingsHost {
  arc(): boolean;
  setArc(on: boolean): void;
  google(): boolean;
  googleAvailable(): boolean;
  setGoogle(on: boolean): void;
  night(): boolean;
  setNight(on: boolean): void;
  audio(): { volume: number; muted: boolean };
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  fov(): number;
  setFov(deg: number): void;
  share(): void;
  resetSession(): void;
  restartTutorial(): void;
}

export class SettingsModal {
  private readonly modal: Modal;
  private readonly unitSeg: Segmented<AngleUnit>;
  private readonly coordSeg: Segmented<CoordFormat>;
  private readonly qualitySeg: Segmented<QualityLevel>;
  private readonly google: Toggle;
  private readonly arc: Toggle;
  private readonly night: Toggle;
  private readonly fov: SliderField;
  private readonly vol: SliderField;
  private readonly mute: Toggle;

  constructor(private readonly host: SettingsHost) {
    this.modal = new Modal({ title: 'Ajustes', eyebrow: 'Estación de tiro', icon: 'settings', size: 'l', testid: 'settings' });
    const group = (title: string, ...children: HTMLElement[]) =>
      h('section', { class: 'set-group' }, h('h3', { class: 'set-group__title ua-eyebrow', text: title }), ...children);
    const row = (label: string, hint: string, control: HTMLElement) =>
      h('div', { class: 'set-row' },
        h('div', { class: 'set-row__text' }, h('span', { class: 'set-row__label', text: label }), h('span', { class: 'set-row__hint', text: hint })),
        control,
      );

    this.unitSeg = new Segmented<AngleUnit>([
      { value: 'mil', label: 'Milésimas OTAN', testid: 'unit-mil' },
      { value: 'deg', label: 'Grados', testid: 'unit-deg' },
    ], settings.angleUnit, { ariaLabel: 'Unidad angular principal', size: 's' });
    this.unitSeg.onChange = (u) => settings.set({ angleUnit: u });
    this.coordSeg = new Segmented<CoordFormat>([
      { value: 'mgrs', label: 'MGRS', testid: 'coord-mgrs' },
      { value: 'dd', label: 'Lat/Lon', testid: 'coord-dd' },
      { value: 'dms', label: 'Sexagesimal', testid: 'coord-dms' },
    ], settings.coordFormat, { ariaLabel: 'Formato de coordenadas', size: 's' });
    this.coordSeg.onChange = (c) => settings.set({ coordFormat: c });

    this.qualitySeg = new Segmented<QualityLevel>(
      (Object.keys(QUALITY_LABELS) as QualityLevel[]).map((q) => ({ value: q, label: QUALITY_LABELS[q], testid: `quality-${q}` })),
      getQuality(), { ariaLabel: 'Calidad gráfica', size: 's' },
    );
    this.qualitySeg.onChange = (q) => applyQuality(q);
    onQualityChanged((q) => this.qualitySeg.set(q));

    this.google = new Toggle('Edificios 3D fotorrealistas', false, {
      testid: 'toggle-buildings',
      hint: 'Google Photorealistic 3D Tiles (o Cesium ion). Los tiros tensos se detienen en las fachadas.',
    });
    this.google.onChange = (on) => host.setGoogle(on);
    this.arc = new Toggle('Arco de trayectoria previsto', true, {
      testid: 'toggle-arc', hint: 'Desactívalo para ver solo el proyectil en vuelo (modo inmersión).',
    });
    this.arc.onChange = (on) => host.setArc(on);
    this.night = new Toggle('Noche', false, {
      testid: 'toggle-night', hint: 'Medianoche solar local en la batería: fogonazos, trazadoras y bengalas ILLUM.',
    });
    this.night.onChange = (on) => host.setNight(on);
    this.fov = new SliderField({ label: 'Campo de visión', min: 20, max: 120, step: 1, value: 60, unit: '°', testid: 'set-fov', icon: 'fov' });
    this.fov.onInput = (v) => host.setFov(v);

    this.vol = new SliderField({ label: 'Volumen general', min: 0, max: 100, step: 1, value: 80, unit: '%', testid: 'set-volume', icon: 'volume' });
    this.vol.onInput = (v) => host.setVolume(v);
    this.mute = new Toggle('Silenciar', false, { testid: 'set-mute' });
    this.mute.onChange = (m) => host.setMuted(m);

    const shareBtn = button({ label: 'Compartir escenario', icon: 'share', size: 's', testid: 'share', onClick: () => host.share() });
    const resetBtn = button({ label: 'Restablecer sesión', icon: 'reset', size: 's', variant: 'danger', testid: 'reset-session', onClick: () => host.resetSession() });
    const tutBtn = button({ label: 'Reiniciar tutorial', icon: 'play', size: 's', testid: 'restart-tutorial', onClick: () => { this.modal.close(); host.restartTutorial(); } });

    const left = h('div', { class: 'set-col' },
      group('Unidades',
        row('Unidad angular principal', 'Azimut y elevación; la otra se muestra como secundaria.', this.unitSeg.el),
        row('Coordenadas', 'Formato de la batería y del objetivo.', this.coordSeg.el),
      ),
      group('Gráficos',
        row('Calidad', 'Resolución, antialias, sombras y densidad de efectos.', this.qualitySeg.el),
        this.google.el,
        this.arc.el,
        this.night.el,
        this.fov.el,
      ),
    );
    const right = h('div', { class: 'set-col' },
      group('Audio', this.vol.el, this.mute.el),
      group('Sesión',
        h('p', { class: 'set-note', text: 'La sesión se guarda sola cada 5 s. El enlace compartido reconstruye batería, arma, munición, meteo, puntería y objetivo.' }),
        h('div', { class: 'set-actions' }, shareBtn, tutBtn, resetBtn),
      ),
      group('Atajos de teclado', shortcutList(SHORTCUTS.filter((s) => s.compact))),
    );
    this.modal.body.appendChild(h('div', { class: 'set-grid' }, left, right));
  }

  open(): void {
    const a = this.host.audio();
    this.unitSeg.set(settings.angleUnit);
    this.coordSeg.set(settings.coordFormat);
    this.qualitySeg.set(getQuality());
    this.google.set(this.host.google());
    this.google.setDisabled(!this.host.googleAvailable());
    this.arc.set(this.host.arc());
    this.night.set(this.host.night());
    this.fov.set(Math.round(this.host.fov()));
    this.vol.set(a.volume);
    this.mute.set(a.muted);
    this.modal.open();
  }

  get isOpen(): boolean { return this.modal.isOpen; }
  close(): void { this.modal.close(); }
}
