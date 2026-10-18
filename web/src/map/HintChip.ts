// ============================================================================
//  map/HintChip.ts — Chip flotante de modo y avisos breves.  [V2:MAP]
//
//  "Clic para designar el objetivo · Esc cancela" mientras dura un modo de
//  designación, con una línea secundaria viva (distancia/demora al cursor,
//  alcance, motivo de invalidez) y avisos breves (copiado, bloqueado…).
// ============================================================================
import { el } from './dom';
import { ICON } from './icons';

export type HintKind = 'info' | 'error' | 'ok' | 'flash';

export class HintChip {
  readonly el: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly sub: HTMLSpanElement;
  private modeText = '';
  private modeKind: HintKind = 'info';
  private mode = '';
  private flashTimer: number | undefined;
  onCancel?: () => void;

  constructor(parent: HTMLElement) {
    this.el = el('div', 'ua-hint');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.appendChild(el('span', 'dot'));
    this.text = el('span', 'txt');
    this.sub = el('span', 'sub');
    const kbd = el('kbd');
    kbd.textContent = 'Esc';
    const close = el('button', '', ICON.close);
    close.title = 'Cancelar (Esc)';
    close.setAttribute('aria-label', 'Cancelar');
    close.addEventListener('click', () => this.onCancel?.());
    this.el.append(this.text, this.sub, kbd, close);
    parent.appendChild(this.el);
  }

  /** Muestra el chip de un modo (persistente hasta hideMode). */
  showMode(mode: string, text: string): void {
    window.clearTimeout(this.flashTimer);
    this.mode = mode;
    this.modeText = text;
    this.modeKind = 'info';
    this.render(text, 'info');
    this.sub.textContent = '';
  }

  /** Línea secundaria viva del modo (o aviso de invalidez). */
  setSub(text: string, invalid = false): void {
    if (!this.mode) return;
    this.sub.textContent = text;
    const kind: HintKind = invalid ? 'error' : 'info';
    if (kind !== this.modeKind) {
      this.modeKind = kind;
      this.el.dataset.kind = kind === 'error' ? 'warn' : 'info';
    }
  }

  hideMode(): void {
    this.mode = '';
    this.modeText = '';
    if (!this.flashTimer) this.el.classList.remove('show');
  }

  /** Aviso breve; al terminar vuelve el chip del modo si sigue activo. */
  flash(text: string, kind: HintKind = 'flash', ms = 1800): void {
    window.clearTimeout(this.flashTimer);
    this.render(text, kind);
    this.sub.textContent = '';
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = undefined;
      if (this.mode) this.render(this.modeText, 'info');
      else this.el.classList.remove('show');
    }, ms);
  }

  private render(text: string, kind: HintKind): void {
    this.text.textContent = text;
    this.el.dataset.kind = kind;
    this.el.dataset.mode = this.mode;
    // Re-dispara la animación (sacudida de error) aunque ya estuviera visible.
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
  }
}
