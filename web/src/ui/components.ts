// ============================================================================
//  components.ts — Componentes reutilizables del sistema de diseño V2.
//
//  Vanilla TS, sin framework. Todos comparten estados (hover, focus-visible,
//  activo, deshabilitado), atributos ARIA y operación por teclado:
//    botones · botón de icono · control segmentado · interruptor · deslizador
//    con campo numérico y unidades · selector · pestañas · sección plegable ·
//    lectura (etiqueta/valor/unidad) · chip de tecla · modal · tooltips con
//    glosario.
// ============================================================================
import { Child, h, setText, uid } from './dom';
import { GLOSSARY } from './glossary';
import { IconName, icon } from './icons';

// ---------------------------------------------------------------------------
//  Botones
// ---------------------------------------------------------------------------
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'fire';

export interface ButtonOpts {
  label?: string;
  icon?: IconName;
  iconRight?: IconName;
  variant?: ButtonVariant;
  size?: 's' | 'm' | 'l';
  title?: string;
  /** Tecla de atajo mostrada como chip. */
  kbd?: string;
  testid?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
  block?: boolean;
  onClick?: (ev: MouseEvent) => void;
}

export function button(o: ButtonOpts): HTMLButtonElement {
  const cls = [
    'ua-btn',
    `ua-btn--${o.variant ?? 'secondary'}`,
    `ua-btn--${o.size ?? 'm'}`,
    o.block ? 'ua-btn--block' : '',
    !o.label ? 'ua-btn--icon' : '',
    o.className ?? '',
  ].filter(Boolean).join(' ');
  const b = h('button', {
    class: cls,
    id: o.id,
    testid: o.testid,
    attrs: { type: 'button', 'aria-label': o.ariaLabel ?? (o.label ? null : o.title ?? null) },
  });
  if (o.title) b.dataset.tip = o.title;
  if (o.icon) b.appendChild(icon(o.icon, o.size === 's' ? 16 : 18));
  if (o.label) b.appendChild(h('span', { class: 'ua-btn__label', text: o.label }));
  if (o.iconRight) b.appendChild(icon(o.iconRight, 16));
  if (o.kbd) b.appendChild(kbd(o.kbd));
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Botón cuadrado solo-icono (barra superior, rieles, cabeceras). */
export function iconButton(o: Omit<ButtonOpts, 'label'> & { label: string; pressed?: boolean }): HTMLButtonElement {
  const b = button({ ...o, label: undefined, ariaLabel: o.label, title: o.title ?? o.label, variant: o.variant ?? 'ghost' });
  if (o.pressed !== undefined) b.setAttribute('aria-pressed', String(o.pressed));
  return b;
}

/** Chip de tecla (atajos). */
export function kbd(key: string): HTMLElement {
  return h('kbd', { class: 'ua-kbd', text: key });
}

/** Cambia la etiqueta de un botón creado con button(). */
export function setButtonLabel(b: HTMLButtonElement, label: string): void {
  const el = b.querySelector('.ua-btn__label');
  if (el) setText(el, label);
}

// ---------------------------------------------------------------------------
//  Control segmentado (radiogroup): flechas mueven la selección.
// ---------------------------------------------------------------------------
export interface SegOption<T extends string> {
  value: T;
  label?: string;
  icon?: IconName;
  title?: string;
  testid?: string;
  /** Texto secundario pequeño bajo la etiqueta (p. ej. V0 de la carga). */
  sub?: string;
}

export class Segmented<T extends string> {
  readonly el: HTMLDivElement;
  private buttons = new Map<T, HTMLButtonElement>();
  private current: T;
  private readonly reselect: boolean;
  onChange?: (v: T) => void;

  constructor(
    options: SegOption<T>[],
    value: T,
    opts: {
      ariaLabel: string; size?: 's' | 'm'; testid?: string; className?: string; iconOnly?: boolean;
      /** Volver a pulsar la opción vigente también notifica. */
      reselect?: boolean;
    } = { ariaLabel: '' },
  ) {
    this.current = value;
    this.reselect = !!opts.reselect;
    this.el = h('div', {
      class: `ua-seg ua-seg--${opts.size ?? 'm'} ${opts.iconOnly ? 'ua-seg--icons' : ''} ${opts.className ?? ''}`,
      testid: opts.testid,
      attrs: { role: 'radiogroup', 'aria-label': opts.ariaLabel },
    });
    this.el.addEventListener('keydown', (ev) => this.onKey(ev));
    this.setOptions(options, value);
  }

  get value(): T { return this.current; }

  setOptions(options: SegOption<T>[], value: T): void {
    this.el.textContent = '';
    this.buttons.clear();
    for (const o of options) {
      const b = h('button', {
        class: 'ua-seg__opt',
        testid: o.testid,
        attrs: { type: 'button', role: 'radio', 'aria-label': o.label ? null : o.title ?? o.value },
      });
      if (o.title) b.dataset.tip = o.title;
      if (o.icon) b.appendChild(icon(o.icon, 18));
      if (o.label) {
        const lab = h('span', { class: 'ua-seg__label', text: o.label });
        b.appendChild(lab);
      }
      if (o.sub) b.appendChild(h('span', { class: 'ua-seg__sub', text: o.sub }));
      b.addEventListener('click', () => this.select(o.value, true));
      this.buttons.set(o.value, b);
      this.el.appendChild(b);
    }
    this.set(value, true);
  }

  /** Fija el valor (silent = sin notificar). */
  set(v: T, silent = true): void {
    if (!this.buttons.has(v)) return;
    this.current = v;
    for (const [val, b] of this.buttons) {
      const on = val === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-on', on);
    }
    if (!silent) this.onChange?.(v);
  }

  setDisabled(disabled: boolean, only?: T): void {
    for (const [val, b] of this.buttons) {
      if (only === undefined || only === val) b.disabled = disabled;
    }
  }

  button(v: T): HTMLButtonElement | undefined { return this.buttons.get(v); }

  private select(v: T, notify: boolean): void {
    if (v === this.current) {
      if (this.reselect && notify) this.onChange?.(v);
      return;
    }
    this.set(v, !notify);
  }

  private onKey(ev: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(ev.key)) return;
    ev.preventDefault();
    ev.stopPropagation(); // que la puntería por flechas no se dispare
    const vals = [...this.buttons.keys()].filter((v) => !this.buttons.get(v)!.disabled);
    const i = vals.indexOf(this.current);
    let n = i;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') n = Math.max(0, i - 1);
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') n = Math.min(vals.length - 1, i + 1);
    if (ev.key === 'Home') n = 0;
    if (ev.key === 'End') n = vals.length - 1;
    const v = vals[n];
    if (v !== undefined) {
      this.select(v, true);
      this.buttons.get(v)!.focus();
    }
  }
}

// ---------------------------------------------------------------------------
//  Interruptor (switch)
// ---------------------------------------------------------------------------
export class Toggle {
  readonly el: HTMLLabelElement;
  readonly input: HTMLButtonElement;
  private on: boolean;
  onChange?: (on: boolean) => void;

  constructor(label: string, on: boolean, opts: { testid?: string; hint?: string; gloss?: string } = {}) {
    this.on = on;
    const id = uid('tg');
    this.input = h('button', {
      class: 'ua-switch',
      id,
      testid: opts.testid,
      attrs: { type: 'button', role: 'switch', 'aria-checked': String(on) },
    }, h('span', { class: 'ua-switch__thumb' }));
    const lab = h('span', { class: 'ua-toggle__label', text: label });
    if (opts.gloss) lab.dataset.gloss = opts.gloss;
    this.el = h('label', { class: 'ua-toggle', attrs: { for: id } },
      h('span', { class: 'ua-toggle__text' }, lab, opts.hint ? h('span', { class: 'ua-toggle__hint', text: opts.hint }) : null),
      this.input,
    );
    this.input.addEventListener('click', () => this.set(!this.on, false));
  }

  get value(): boolean { return this.on; }

  set(on: boolean, silent = true): void {
    this.on = on;
    this.input.setAttribute('aria-checked', String(on));
    if (!silent) this.onChange?.(on);
  }

  setDisabled(d: boolean): void {
    this.input.disabled = d;
    this.el.classList.toggle('is-disabled', d);
  }
}

// ---------------------------------------------------------------------------
//  Deslizador con campo numérico + unidad (+ pasos finos con las flechas).
// ---------------------------------------------------------------------------
export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  /** Paso del campo numérico (las flechas del input). El rango es continuo. */
  step: number;
  value: number;
  unit: string;
  decimals?: number;
  testid?: string;
  gloss?: string;
  icon?: IconName;
  /** Envolvente (el rango no se estira, solo se resalta [lo, hi]). */
  wrap?: boolean;
}

export class SliderField {
  readonly el: HTMLDivElement;
  readonly range: HTMLInputElement;
  readonly num: HTMLInputElement;
  private readonly unitEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private decimals: number;
  private min: number;
  private max: number;
  private wrap: boolean;
  /** input = arrastre en curso; change = valor confirmado. */
  onInput?: (v: number) => void;

  constructor(o: SliderOpts) {
    this.decimals = o.decimals ?? 0;
    this.min = o.min;
    this.max = o.max;
    this.wrap = !!o.wrap;
    const id = uid('sl');
    this.labelEl = h('label', { class: 'ua-field__label', text: o.label, attrs: { for: `${id}-n` } });
    if (o.gloss) this.labelEl.dataset.gloss = o.gloss;
    this.range = h('input', {
      class: 'ua-range',
      id: `${id}-r`,
      testid: o.testid ? `${o.testid}-slider` : undefined,
      attrs: { type: 'range', min: o.min, max: o.max, step: 'any', 'aria-label': o.label },
    });
    this.num = h('input', {
      class: 'ua-num',
      id: `${id}-n`,
      testid: o.testid ? `${o.testid}-input` : undefined,
      // type=text + inputmode decimal: el punto decimal es consistente con el
      // resto de lecturas (el number nativo localiza a coma en es-ES).
      attrs: { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-step': o.step, 'aria-label': o.label },
    });
    this.unitEl = h('span', { class: 'ua-num__unit', text: o.unit });
    this.el = h('div', { class: 'ua-slider', testid: o.testid },
      h('div', { class: 'ua-slider__head' },
        o.icon ? icon(o.icon, 16) : null,
        this.labelEl,
        h('span', { class: 'ua-num-wrap' }, this.num, this.unitEl),
      ),
      this.range,
    );
    this.range.addEventListener('input', () => {
      const v = Number(this.range.value);
      this.reflect(v, true);
      this.onInput?.(v);
    });
    const commitNum = () => {
      let v = Number(this.num.value.replace(',', '.').replace(/[^\d.+-]/g, ''));
      if (!Number.isFinite(v)) return;
      v = this.clamp(v);
      this.reflect(v, false);
      this.onInput?.(v);
    };
    this.num.addEventListener('change', commitNum);
    this.num.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') commitNum();
      // Flechas en el campo: paso fino con Shift (÷10) y grueso con Ctrl (×10).
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        ev.stopPropagation();
        const base = Number(this.num.dataset.step) || 1;
        const k = ev.ctrlKey ? 10 : ev.shiftKey ? 0.1 : 1;
        const dir = ev.key === 'ArrowUp' ? 1 : -1;
        const cur = Number(this.num.value.replace(',', '.'));
        const v = this.clamp((Number.isFinite(cur) ? cur : this.value) + dir * base * k);
        this.reflect(v, false);
        this.onInput?.(v);
      }
    });
    this.set(o.value);
  }

  get value(): number { return Number(this.range.value); }

  private clamp(v: number): number {
    if (this.wrap) {
      const span = this.max - this.min;
      return ((((v - this.min) % span) + span) % span) + this.min;
    }
    return Math.min(this.max, Math.max(this.min, v));
  }

  private reflect(v: number, fromRange: boolean): void {
    if (!fromRange) this.range.value = String(v);
    if (document.activeElement !== this.num || fromRange) this.num.value = v.toFixed(this.decimals);
    const pct = ((v - this.min) / Math.max(1e-9, this.max - this.min)) * 100;
    this.range.style.setProperty('--pct', `${Math.min(100, Math.max(0, pct))}%`);
  }

  /** Valor externo (sin notificar). */
  set(v: number): void {
    const c = this.clamp(v);
    this.range.value = String(c);
    this.num.value = c.toFixed(this.decimals);
    const pct = ((c - this.min) / Math.max(1e-9, this.max - this.min)) * 100;
    this.range.style.setProperty('--pct', `${Math.min(100, Math.max(0, pct))}%`);
  }

  /** Reconfigura escala (cambio de unidades/envolvente del arma). */
  configure(o: { min?: number; max?: number; step?: number; unit?: string; decimals?: number; label?: string }): void {
    if (o.min !== undefined) { this.min = o.min; this.range.min = String(o.min); }
    if (o.max !== undefined) { this.max = o.max; this.range.max = String(o.max); }
    if (o.step !== undefined) this.num.dataset.step = String(o.step);
    if (o.unit !== undefined) setText(this.unitEl, o.unit);
    if (o.decimals !== undefined) this.decimals = o.decimals;
    if (o.label !== undefined) {
      setText(this.labelEl, o.label);
      this.range.setAttribute('aria-label', o.label);
    }
  }

  /** Banda resaltada sobre la pista (p. ej. envolvente de elevación). */
  setBand(lo: number | null, hi: number | null): void {
    if (lo === null || hi === null) {
      this.range.style.removeProperty('--band-lo');
      this.range.style.removeProperty('--band-hi');
      return;
    }
    const span = Math.max(1e-9, this.max - this.min);
    this.range.style.setProperty('--band-lo', `${((lo - this.min) / span) * 100}%`);
    this.range.style.setProperty('--band-hi', `${((hi - this.min) / span) * 100}%`);
  }

  setDisabled(d: boolean): void {
    this.range.disabled = d;
    this.num.disabled = d;
    this.el.classList.toggle('is-disabled', d);
  }
}

// ---------------------------------------------------------------------------
//  Selector (select nativo estilizado: accesible y operable por teclado).
// ---------------------------------------------------------------------------
export class SelectField<T extends string = string> {
  readonly el: HTMLDivElement;
  readonly select: HTMLSelectElement;
  onChange?: (v: T) => void;

  constructor(label: string | null, opts: { testid?: string; gloss?: string; ariaLabel?: string } = {}) {
    const id = uid('sel');
    this.select = h('select', {
      class: 'ua-select',
      id,
      testid: opts.testid,
      attrs: { 'aria-label': opts.ariaLabel ?? label },
    });
    const lab = label ? h('label', { class: 'ua-field__label', text: label, attrs: { for: id } }) : null;
    if (lab && opts.gloss) lab.dataset.gloss = opts.gloss;
    this.el = h('div', { class: 'ua-field' }, lab, h('div', { class: 'ua-select-wrap' }, this.select, icon('chevronDown', 16)));
    this.select.addEventListener('change', () => this.onChange?.(this.select.value as T));
  }

  setOptions(options: { value: T; label: string }[], value: T): void {
    this.select.textContent = '';
    for (const o of options) this.select.appendChild(h('option', { text: o.label, attrs: { value: o.value } }));
    this.select.value = value;
  }

  get value(): T { return this.select.value as T; }
  set(v: T): void { this.select.value = v; }
}

// ---------------------------------------------------------------------------
//  Lectura de datos: etiqueta / valor / unidad (+ secundaria).
// ---------------------------------------------------------------------------
export class Readout {
  readonly el: HTMLDivElement;
  private readonly valueEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly subEl: HTMLElement;

  constructor(label: string, opts: { size?: 's' | 'm' | 'l' | 'xl'; gloss?: string; testid?: string; tone?: 'info' | 'accent' | 'plain'; icon?: IconName } = {}) {
    const lab = h('span', { class: 'ua-readout__label' }, opts.icon ? icon(opts.icon, 14) : null, label);
    if (opts.gloss) lab.dataset.gloss = opts.gloss;
    this.valueEl = h('span', { class: 'ua-readout__value', text: '—', testid: opts.testid });
    this.unitEl = h('span', { class: 'ua-readout__unit' });
    this.subEl = h('span', { class: 'ua-readout__sub' });
    this.el = h('div', { class: `ua-readout ua-readout--${opts.size ?? 'm'} ua-readout--${opts.tone ?? 'plain'}` },
      lab,
      h('span', { class: 'ua-readout__line' }, this.valueEl, this.unitEl),
      this.subEl,
    );
  }

  set(value: string, unit = '', sub = ''): void {
    setText(this.valueEl, value);
    setText(this.unitEl, unit);
    setText(this.subEl, sub);
  }

  setState(state: '' | 'ok' | 'warn' | 'danger' | 'muted'): void {
    this.el.dataset.state = state;
  }
}

// ---------------------------------------------------------------------------
//  Pestañas (tablist) con flechas.
// ---------------------------------------------------------------------------
export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  testid?: string;
}

export class Tabs<T extends string> {
  readonly el: HTMLDivElement;
  private buttons = new Map<T, HTMLButtonElement>();
  private current: T;
  onChange?: (id: T) => void;

  constructor(tabs: TabDef<T>[], active: T, ariaLabel: string) {
    this.current = active;
    this.el = h('div', { class: 'ua-tabs', attrs: { role: 'tablist', 'aria-label': ariaLabel } });
    for (const t of tabs) {
      const b = h('button', {
        class: 'ua-tab',
        id: `tab-${t.id}`,
        testid: t.testid ?? `tab-${t.id}`,
        attrs: { type: 'button', role: 'tab', 'aria-controls': `tabpanel-${t.id}` },
      }, icon(t.icon, 18), h('span', { class: 'ua-tab__label', text: t.label }));
      b.dataset.tip = t.label;
      b.addEventListener('click', () => this.set(t.id, false));
      this.buttons.set(t.id, b);
      this.el.appendChild(b);
    }
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      ev.stopPropagation();
      const ids = [...this.buttons.keys()];
      const i = ids.indexOf(this.current);
      const fwd = ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
      const n = (i + (fwd ? 1 : -1) + ids.length) % ids.length;
      this.set(ids[n], false);
      this.buttons.get(ids[n])!.focus();
    });
    this.set(active, true);
  }

  get value(): T { return this.current; }

  set(id: T, silent = true): void {
    this.current = id;
    for (const [tid, b] of this.buttons) {
      const on = tid === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!silent) this.onChange?.(id);
  }

  button(id: T): HTMLButtonElement | undefined { return this.buttons.get(id); }
}

// ---------------------------------------------------------------------------
//  Sección plegable (cabecera botón + cuerpo).
// ---------------------------------------------------------------------------
export class Collapsible {
  readonly el: HTMLElement;
  readonly head: HTMLButtonElement;
  readonly body: HTMLDivElement;
  private open: boolean;
  onToggle?: (open: boolean) => void;

  constructor(title: Child, open: boolean, opts: { className?: string; testid?: string; aside?: Child } = {}) {
    this.open = open;
    const bodyId = uid('col');
    this.head = h('button', {
      class: 'ua-collapse__head',
      testid: opts.testid,
      attrs: { type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId },
    }, icon('chevronRight', 16, 'ua-collapse__chev'), h('span', { class: 'ua-collapse__title' }, title), opts.aside ?? null);
    this.body = h('div', { class: 'ua-collapse__body', id: bodyId });
    this.body.hidden = !open;
    this.el = h('div', { class: `ua-collapse ${opts.className ?? ''}` }, this.head, this.body);
    this.el.classList.toggle('is-open', open);
    this.head.addEventListener('click', () => this.setOpen(!this.open, true));
  }

  get isOpen(): boolean { return this.open; }

  setOpen(open: boolean, notify = false): void {
    this.open = open;
    this.body.hidden = !open;
    this.head.setAttribute('aria-expanded', String(open));
    this.el.classList.toggle('is-open', open);
    if (notify) this.onToggle?.(open);
  }
}

// ---------------------------------------------------------------------------
//  Modal (diálogo): Esc y el velo cierran, foco atrapado y devuelto.
// ---------------------------------------------------------------------------
const openModals: Modal[] = [];
/** El foco devuelto al cerrar un modal no debe abrir un tooltip. */
let tipMuteUntil = 0;

export class Modal {
  readonly root: HTMLDivElement;
  readonly panel: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly foot: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private lastFocus: HTMLElement | null = null;
  onClose?: () => void;

  constructor(opts: { title: string; eyebrow?: string; icon?: IconName; size?: 's' | 'm' | 'l' | 'xl'; testid?: string }) {
    const titleId = uid('dlg');
    this.titleEl = h('h2', { class: 'ua-modal__title', id: titleId, text: opts.title });
    const close = iconButton({ icon: 'close', label: 'Cerrar', testid: opts.testid ? `${opts.testid}-close` : undefined, onClick: () => this.close() });
    this.body = h('div', { class: 'ua-modal__body' });
    this.foot = h('div', { class: 'ua-modal__foot' });
    this.foot.hidden = true;
    this.panel = h('div', {
      class: `ua-modal__panel ua-modal__panel--${opts.size ?? 'm'}`,
      testid: opts.testid,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    },
      h('header', { class: 'ua-modal__head' },
        opts.icon ? h('span', { class: 'ua-modal__icon' }, icon(opts.icon, 20)) : null,
        h('div', { class: 'ua-modal__titles' },
          opts.eyebrow ? h('span', { class: 'ua-eyebrow', text: opts.eyebrow }) : null,
          this.titleEl,
        ),
        close,
      ),
      this.body,
      this.foot,
    );
    this.root = h('div', { class: 'ua-modal', attrs: { hidden: true } }, this.panel);
    this.root.addEventListener('mousedown', (ev) => {
      if (ev.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (ev) => this.trapFocus(ev));
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(): void {
    if (this.isOpen) return;
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('is-open'));
    openModals.push(this);
    const first = this.panel.querySelector<HTMLElement>('[data-autofocus]') ??
      this.panel.querySelector<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    first?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    const i = openModals.indexOf(this);
    if (i >= 0) openModals.splice(i, 1);
    tipMuteUntil = performance.now() + 500;
    this.lastFocus?.focus?.({ preventScroll: true });
    this.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private trapFocus(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab') return;
    const f = [...this.panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null);
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }
}

/** Cierra el modal superior (Esc global). Devuelve si había alguno. */
export function closeTopModal(): boolean {
  const m = openModals[openModals.length - 1];
  if (!m) return false;
  m.close();
  return true;
}

export function anyModalOpen(): boolean {
  return openModals.length > 0;
}

// ---------------------------------------------------------------------------
//  Tooltips: un único flotante para [data-tip] y [data-gloss].
// ---------------------------------------------------------------------------
let tipEl: HTMLDivElement | null = null;
let tipTimer: number | undefined;
let tipTarget: HTMLElement | null = null;

function findTipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  return node.closest<HTMLElement>('[data-tip], [data-gloss]');
}

function showTip(target: HTMLElement): void {
  if (!tipEl) return;
  const gloss = target.dataset.gloss ? GLOSSARY[target.dataset.gloss] : undefined;
  const text = target.dataset.tip;
  if (!gloss && !text) return;
  tipEl.textContent = '';
  if (gloss) {
    tipEl.appendChild(h('span', { class: 'ua-tip__term', text: gloss.term }));
    tipEl.appendChild(h('span', { class: 'ua-tip__text', text: gloss.text }));
    tipEl.classList.add('ua-tip--gloss');
  } else {
    tipEl.appendChild(h('span', { class: 'ua-tip__text', text: text! }));
    tipEl.classList.remove('ua-tip--gloss');
  }
  tipEl.hidden = false;
  const r = target.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 8) top = r.top - th - 8;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  tipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  tipEl.classList.add('is-on');
}

function hideTip(): void {
  window.clearTimeout(tipTimer);
  tipTarget = null;
  if (!tipEl) return;
  tipEl.classList.remove('is-on');
  tipEl.hidden = true;
}

/** Instala el gestor global de tooltips (una vez). */
export function installTooltips(): void {
  if (tipEl) return;
  tipEl = h('div', { class: 'ua-tip', attrs: { role: 'tooltip', hidden: true } });
  document.body.appendChild(tipEl);
  const enter = (ev: Event) => {
    if (ev.type === 'focusin' && performance.now() < tipMuteUntil) return;
    const t = findTipTarget(ev.target);
    if (!t || t === tipTarget) return;
    hideTip();
    tipTarget = t;
    const delay = t.dataset.gloss ? 280 : 520;
    tipTimer = window.setTimeout(() => {
      if (tipTarget === t && t.isConnected) showTip(t);
    }, delay);
  };
  const leave = (ev: Event) => {
    const t = findTipTarget(ev.target);
    if (t && t === tipTarget) hideTip();
  };
  document.addEventListener('pointerover', (ev) => {
    if ((ev as PointerEvent).pointerType === 'touch') return;
    enter(ev);
  });
  document.addEventListener('pointerout', leave);
  document.addEventListener('focusin', (ev) => {
    // Solo foco de teclado (no el clic del ratón).
    const t = ev.target as HTMLElement;
    if (t.matches?.(':focus-visible')) enter(ev);
  });
  document.addEventListener('focusout', leave);
  document.addEventListener('pointerdown', hideTip, true);
  window.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hideTip();
  });
}

/** Término con definición de glosario (subrayado punteado). */
export function gloss(key: string, label: string): HTMLSpanElement {
  return h('span', { class: 'ua-gloss', text: label, dataset: { gloss: key }, attrs: { tabindex: 0 } });
}

/** Etiqueta de sección (Barlow Condensed en mayúsculas). */
export function eyebrow(text: string, glossKey?: string): HTMLSpanElement {
  const s = h('span', { class: 'ua-eyebrow', text });
  if (glossKey) s.dataset.gloss = glossKey;
  return s;
}

/** Chip de estado (punto + texto). */
export function chip(text: string, tone: 'accent' | 'info' | 'ok' | 'warn' | 'danger' | 'muted' = 'muted', testid?: string): HTMLSpanElement {
  return h('span', { class: `ua-chip ua-chip--${tone}`, testid }, h('span', { class: 'ua-chip__dot' }), h('span', { class: 'ua-chip__text', text }));
}

export function setChip(el: HTMLElement, text: string, tone: 'accent' | 'info' | 'ok' | 'warn' | 'danger' | 'muted'): void {
  el.className = `ua-chip ua-chip--${tone}`;
  const t = el.querySelector('.ua-chip__text');
  if (t) setText(t, text);
}
