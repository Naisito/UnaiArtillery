// ============================================================================
//  toast.ts — Pila de avisos con niveles (info · éxito · aviso · error).
//
//  API compatible con la anterior: `toast(mensaje[, ms])` sigue valiendo para
//  todos los módulos; el nivel se puede pasar explícito
//  (`toast(msg, { level: 'success' })`) o se infiere del texto ("Fallo…",
//  "fuera de alcance"…). Pila arriba-centro bajo la barra superior, máx. 4
//  visibles, los repetidos se funden (×N) en vez de apilarse. Cualquier emoji
//  que llegue de otros módulos se elimina: la interfaz no usa emojis.
// ============================================================================
import { h, setText } from './dom';
import { IconName, icon } from './icons';

export type ToastLevel = 'info' | 'success' | 'warn' | 'error';

export interface ToastOpts {
  level?: ToastLevel;
  ms?: number;
  /** Título corto en negrita sobre el mensaje. */
  title?: string;
}

const LEVEL_ICON: Record<ToastLevel, IconName> = {
  info: 'info',
  success: 'success',
  warn: 'warning',
  error: 'error',
};

const MAX_VISIBLE = 4;

interface Live {
  key: string;
  el: HTMLElement;
  countEl: HTMLElement;
  count: number;
  timer: number | undefined;
}

let stack: HTMLElement | null = null;
const live: Live[] = [];

function ensureStack(): HTMLElement | null {
  if (stack && stack.isConnected) return stack;
  stack = document.getElementById('toastStack');
  if (!stack) {
    if (!document.body) return null;
    stack = h('div', { id: 'toastStack', testid: 'toast-stack' });
    document.body.appendChild(stack);
  }
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  return stack;
}

/** Quita pictogramas/emojis y selectores de variación, y limpia espacios. */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Nivel inferido del texto cuando el llamador no lo da. */
export function inferLevel(text: string): ToastLevel {
  const t = text.toLowerCase();
  if (/(fallo|no se pudo|error|inválid|imposible|sin meteo real)/.test(t)) return 'error';
  if (/(fuera de alcance|aún no|todavía|no hay|ahí no|sin )/.test(t)) return 'warn';
  if (/(copiad|instalad|restaurad|desplegad|listo|completad|récord|batido|zona batida|descargad)/.test(t)) return 'success';
  return 'info';
}

function dismiss(item: Live): void {
  window.clearTimeout(item.timer);
  const i = live.indexOf(item);
  if (i >= 0) live.splice(i, 1);
  item.el.classList.remove('is-in');
  item.el.classList.add('is-out');
  window.setTimeout(() => item.el.remove(), 220);
}

export function toast(message: string, opts: number | ToastOpts = {}): void {
  const o: ToastOpts = typeof opts === 'number' ? { ms: opts } : opts;
  const host = ensureStack();
  const text = stripEmoji(message);
  if (!host || !text) return;
  const level = o.level ?? inferLevel(text);
  const ms = o.ms ?? (level === 'error' ? 5200 : Math.min(7000, 2600 + text.length * 28));
  const key = `${level}|${o.title ?? ''}|${text}`;

  // Repetido: se funde con el vivo (contador) y reinicia su temporizador.
  const dup = live.find((l) => l.key === key);
  if (dup) {
    dup.count += 1;
    setText(dup.countEl, `×${dup.count}`);
    dup.countEl.hidden = false;
    window.clearTimeout(dup.timer);
    dup.timer = window.setTimeout(() => dismiss(dup), ms);
    return;
  }

  const countEl = h('span', { class: 'ua-toast__count' });
  countEl.hidden = true;
  const close = h('button', {
    class: 'ua-toast__close',
    attrs: { type: 'button', 'aria-label': 'Cerrar aviso' },
  }, icon('close', 14));
  const el = h('div', { class: `ua-toast ua-toast--${level}` },
    h('span', { class: 'ua-toast__icon' }, icon(LEVEL_ICON[level], 18)),
    h('div', { class: 'ua-toast__body' },
      o.title ? h('strong', { class: 'ua-toast__title', text: stripEmoji(o.title) }) : null,
      h('span', { class: 'ua-toast__text', text }),
    ),
    countEl,
    close,
  );
  const item: Live = { key, el, countEl, count: 1, timer: undefined };
  close.addEventListener('click', () => dismiss(item));
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  live.push(item);
  item.timer = window.setTimeout(() => dismiss(item), ms);
  while (live.length > MAX_VISIBLE) dismiss(live[0]);
}
