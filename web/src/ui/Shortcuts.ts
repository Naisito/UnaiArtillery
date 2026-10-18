// ============================================================================
//  Shortcuts.ts — Atajos de teclado globales (§3.5 del plan V2).
//
//  UI: F fuego (mantener en automáticas) · H rama alta/baja · ←/→ azimut y
//  ↑/↓ elevación ±1 mil (Shift ±0.1, Ctrl ±10) · ? ayuda/atajos · Esc
//  cierra el modal (y cancela el modo de designación).
//  MAPA (provisional hasta integrar src/map/MapInteraction): T designar,
//  B mover batería, Inicio ir a la batería, 1–6 cámaras. Con `mapKeys:
//  false` se desactivan para que los gestione el agente MAP.
//  Se ignoran con el foco en campos de texto y en 1ª persona con el ratón
//  capturado (WASD/Espacio/C son del modo FPS).
// ============================================================================
import { anyModalOpen, closeTopModal, kbd } from './components';
import { h, isTypingTarget } from './dom';

export interface ShortcutDef {
  keys: string[];
  label: string;
  group: 'Fuego y puntería' | 'Mapa' | 'Cámaras' | 'General';
  /** Aparece en la chuleta corta de Ajustes. */
  compact?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: ['F'], label: 'Fuego (mantener en armas automáticas)', group: 'Fuego y puntería', compact: true },
  { keys: ['H'], label: 'Alternar rama alta / baja', group: 'Fuego y puntería', compact: true },
  { keys: ['←', '→'], label: 'Azimut ±1 mil (Shift ±0.1 · Ctrl ±10)', group: 'Fuego y puntería', compact: true },
  { keys: ['↑', '↓'], label: 'Elevación ±1 mil (Shift ±0.1 · Ctrl ±10)', group: 'Fuego y puntería', compact: true },
  { keys: ['Rueda'], label: 'Sobre los instrumentos: ajuste fino (Shift fino · Ctrl grueso)', group: 'Fuego y puntería' },
  { keys: ['T'], label: 'Designar objetivo en el mapa', group: 'Mapa', compact: true },
  { keys: ['B'], label: 'Mover la batería', group: 'Mapa' },
  { keys: ['M'], label: 'Medir distancia y perfil', group: 'Mapa' },
  { keys: ['G'], label: 'Rejilla MGRS', group: 'Mapa' },
  { keys: ['L'], label: 'Capas base', group: 'Mapa' },
  { keys: ['N'], label: 'Norte arriba', group: 'Mapa' },
  { keys: ['Inicio'], label: 'Ir a la batería', group: 'Mapa' },
  { keys: ['1'], label: 'Cámara libre', group: 'Cámaras' },
  { keys: ['2'], label: 'Órbita', group: 'Cámaras' },
  { keys: ['3'], label: 'Seguir al proyectil', group: 'Cámaras' },
  { keys: ['4'], label: 'Dron', group: 'Cámaras' },
  { keys: ['5'], label: 'Artillero (cabina)', group: 'Cámaras', compact: true },
  { keys: ['6'], label: '1ª persona (WASD · Espacio/C · Shift · Esc)', group: 'Cámaras' },
  { keys: ['?'], label: 'Ayuda y atajos', group: 'General', compact: true },
  { keys: ['Esc'], label: 'Cerrar ventana · cancelar designación', group: 'General', compact: true },
];

/** Lista visual de atajos (Ajustes / Ayuda). */
export function shortcutList(defs: ShortcutDef[], grouped = false): HTMLElement {
  const root = h('div', { class: 'kb-list' });
  const groups = grouped ? [...new Set(defs.map((d) => d.group))] : [null];
  for (const g of groups) {
    const wrap = h('div', { class: 'kb-group' });
    if (g) wrap.appendChild(h('h4', { class: 'ua-eyebrow kb-group__title', text: g }));
    for (const d of defs.filter((x) => !g || x.group === g)) {
      wrap.appendChild(h('div', { class: 'kb-row' },
        h('span', { class: 'kb-keys' }, ...d.keys.map((k) => kbd(k))),
        h('span', { class: 'kb-label', text: d.label }),
      ));
    }
    root.appendChild(wrap);
  }
  return root;
}

export interface ShortcutActions {
  fire(down: boolean): void;
  toggleBranch(): void;
  nudge(dAz: number, dEl: number, mods: { shiftKey: boolean; ctrlKey: boolean }): void;
  help(): void;
  /** Esc sin modal abierto: cancelar designación / menús. */
  escape(): void;
  pickTarget(): void;
  moveBattery(): void;
  flyHome(): void;
  camera(index: number): void;
  /** ¿1ª persona con el ratón capturado? (sus teclas mandan). */
  fpsLocked(): boolean;
}

export function installShortcuts(a: ShortcutActions, opts: { mapKeys?: boolean } = {}): void {
  const mapKeys = opts.mapKeys ?? true;
  let fireHeld = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!closeTopModal()) a.escape();
      return;
    }
    if (isTypingTarget(ev.target) || ev.altKey || ev.metaKey) return;
    if (a.fpsLocked()) return;
    if (anyModalOpen()) {
      if (ev.key === '?') { ev.preventDefault(); a.help(); }
      return;
    }
    const k = ev.key;
    const mods = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey };
    if (k === 'f' || k === 'F') {
      ev.preventDefault();
      if (ev.repeat || fireHeld) return;
      fireHeld = true;
      a.fire(true);
    } else if (k === 'h' || k === 'H') {
      if (ev.ctrlKey) return;
      ev.preventDefault();
      a.toggleBranch();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      // Dentro de controles con flechas propias (segmentados, pestañas,
      // deslizadores enfocados) manda el control.
      const t = ev.target as HTMLElement;
      if (t?.closest?.('[role="radiogroup"], [role="tablist"], .ua-range, .arsenal')) return;
      ev.preventDefault();
      a.nudge(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0, mods);
    } else if (k === '?') {
      ev.preventDefault();
      a.help();
    } else if (mapKeys && !ev.ctrlKey) {
      if (k === 't' || k === 'T') { ev.preventDefault(); a.pickTarget(); }
      else if (k === 'b' || k === 'B') { ev.preventDefault(); a.moveBattery(); }
      else if (k === 'Home') { ev.preventDefault(); a.flyHome(); }
      else if (/^[1-6]$/.test(k)) { ev.preventDefault(); a.camera(Number(k)); }
    }
  });
  window.addEventListener('keyup', (ev) => {
    if ((ev.key === 'f' || ev.key === 'F') && fireHeld) {
      fireHeld = false;
      a.fire(false);
    }
  });
  window.addEventListener('blur', () => {
    if (fireHeld) {
      fireHeld = false;
      a.fire(false);
    }
  });
}
