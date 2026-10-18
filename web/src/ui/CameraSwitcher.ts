// ============================================================================
//  CameraSwitcher.ts — Selector de cámara flotante (arriba-izquierda del mapa).
//
//  Control segmentado de iconos: Libre · Órbita · Seguir · Dron · Artillero
//  (cabina) · 1ª persona, con atajos 1–6, más un botón FOV con su popover.
//  El modo 'op' (puesto de observación del reto FO) no tiene botón: ninguno
//  queda marcado mientras dura.
// ============================================================================
import type { CameraMode } from '../CameraDirector';
import { Segmented, SliderField, iconButton } from './components';
import { h, setText } from './dom';
import type { IconName } from './icons';

export type UiCameraMode = Exclude<CameraMode, 'op'>;

const MODES: { mode: UiCameraMode; label: string; icon: IconName; tip: string }[] = [
  { mode: 'free', label: 'Libre', icon: 'camFree', tip: 'Libre: navega el globo con el ratón (1)' },
  { mode: 'orbital', label: 'Órbita', icon: 'camOrbit', tip: 'Órbita: gira alrededor de la batería o del último impacto (2)' },
  { mode: 'follow', label: 'Seguir', icon: 'camFollow', tip: 'Seguir: persigue el proyectil; arrastra para orbitar, rueda para zoom (3)' },
  { mode: 'drone', label: 'Dron', icon: 'camDrone', tip: 'Dron: vista cenital estabilizada sobre la zona de tiro (4)' },
  { mode: 'cabin', label: 'Artillero', icon: 'camCabin', tip: 'Artillero: en la boca del tubo con el HUD de puntería (5)' },
  { mode: 'fps', label: '1ª persona', icon: 'camFps', tip: '1ª persona: clic captura el ratón · WASD · Espacio/C · Shift · Esc suelta (6)' },
];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  free: 'Libre', orbital: 'Órbita', follow: 'Seguir', drone: 'Dron', cabin: 'Artillero', fps: '1ª persona', op: 'Puesto de observación',
};

export class CameraSwitcher {
  readonly el: HTMLElement;
  private readonly seg: Segmented<UiCameraMode | 'op'>;
  private readonly modeLabel: HTMLElement;
  private readonly fovBtn: HTMLButtonElement;
  private readonly fovPop: HTMLElement;
  private readonly fovField: SliderField;

  constructor(
    onSelect: (mode: UiCameraMode) => void,
    private readonly fov: { get(): number; set(deg: number): void },
  ) {
    const canLock = 'requestPointerLock' in HTMLElement.prototype;
    const opts = MODES.filter((m) => m.mode !== 'fps' || canLock).map((m) => ({
      value: m.mode as UiCameraMode | 'op',
      icon: m.icon,
      title: m.tip,
      testid: `camera-${m.mode}`,
    }));
    // reselect: volver a pulsar el modo vigente lo re-aplica (p. ej. Libre
    // recoloca la cámara sobre la batería).
    this.seg = new Segmented<UiCameraMode | 'op'>(opts, 'free', {
      ariaLabel: 'Modo de cámara', iconOnly: true, testid: 'camera-switcher', reselect: true,
    });
    this.seg.onChange = (m) => {
      if (m !== 'op') onSelect(m);
    };
    this.modeLabel = h('span', { class: 'cam-dock__mode', testid: 'camera-mode' });

    this.fovField = new SliderField({ label: 'Campo de visión', min: 20, max: 120, step: 1, value: 60, unit: '°', testid: 'fov', icon: 'fov' });
    this.fovField.onInput = (v) => this.fov.set(v);
    this.fovPop = h('div', { class: 'cam-pop', attrs: { role: 'dialog', 'aria-label': 'Campo de visión' } },
      this.fovField.el,
      h('p', { class: 'tb-pop__note', text: 'Ángulo vertical de la cámara. Valores bajos = teleobjetivo.' }),
    );
    this.fovPop.hidden = true;
    this.fovBtn = iconButton({
      icon: 'fov', label: 'Campo de visión (FOV)', testid: 'fov-btn',
      onClick: (ev) => {
        ev.stopPropagation();
        const open = this.fovPop.hidden;
        this.fovPop.hidden = !open;
        this.fovBtn.classList.toggle('is-active', open);
        if (open) this.fovField.set(Math.round(this.fov.get()));
      },
    });
    document.addEventListener('pointerdown', (ev) => {
      if (!this.fovPop.hidden && !this.fovPop.contains(ev.target as Node) && !this.fovBtn.contains(ev.target as Node)) {
        this.fovPop.hidden = true;
        this.fovBtn.classList.remove('is-active');
      }
    });

    this.el = h('div', { id: 'camDock', class: 'cam-dock', attrs: { role: 'toolbar', 'aria-label': 'Cámara' } },
      h('div', { class: 'cam-dock__head' }, h('span', { class: 'ua-eyebrow', text: 'Cámara' }), this.modeLabel),
      h('div', { class: 'cam-dock__row' }, this.seg.el, h('span', { class: 'cam-dock__div' }), this.fovBtn),
      this.fovPop,
    );
    document.body.appendChild(this.el);
    this.mark('free');
  }

  /** Marca el modo vigente (sin notificar). 'op' no marca ningún botón. */
  mark(mode: CameraMode): void {
    if (mode === 'op') {
      for (const m of MODES) {
        const b = this.seg.button(m.mode);
        b?.classList.remove('is-on');
        b?.setAttribute('aria-checked', 'false');
      }
    } else {
      this.seg.set(mode);
    }
    setText(this.modeLabel, CAMERA_LABEL[mode]);
  }
}
