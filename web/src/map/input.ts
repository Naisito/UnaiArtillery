// ============================================================================
//  map/input.ts — Atajos de teclado y gestos del mapa.  [V2:MAP]
//
//  * Atajos (PLAN §3.5, parte MAP): T designar · B batería · M medir ·
//    G rejilla · L capas · N norte arriba · Inicio ir a la batería ·
//    1–6 cámaras · Esc cancelar. Se ignoran con foco en campos editables,
//    con modificadores (Ctrl/Alt/Meta: atajos del navegador) y con el
//    ratón capturado (1ª persona: WASD/Espacio/C son del modo FPS).
//  * Clic derecho vs arrastre: Cesium hace zoom con arrastre derecho; solo
//    un clic "quieto y corto" abre el menú contextual.
//  * Compuerta de cadencia para el trabajo de hover (≥ 30 ms).
//  Módulo PURO (los eventos se describen con interfaces mínimas).
// ============================================================================

export type CameraKey = 'free' | 'orbital' | 'follow' | 'drone' | 'cabin' | 'fps';

export type MapAction =
  | { kind: 'designate' }
  | { kind: 'battery' }
  | { kind: 'measure' }
  | { kind: 'grid' }
  | { kind: 'layers' }
  | { kind: 'northUp' }
  | { kind: 'flyBattery' }
  | { kind: 'escape' }
  | { kind: 'camera'; mode: CameraKey };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

/** Cámaras 1–6 en el orden del PLAN: Libre, Órbita, Seguir, Dron, Artillero, 1ª persona. */
export const CAMERA_KEYS: CameraKey[] = ['free', 'orbital', 'follow', 'drone', 'cabin', 'fps'];

/** Acción del mapa para una tecla (null = no es nuestra). */
export function actionForKey(ev: KeyLike): MapAction | null {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  if (ev.key === 'Escape') return { kind: 'escape' };
  if (ev.repeat) return null; // mantener pulsado no re-dispara modos
  if (ev.key === 'Home') return { kind: 'flyBattery' };
  // Dígitos por `code` (fila superior o teclado numérico): independiente
  // del diseño de teclado (en AZERTY la fila superior da "&é\"'…").
  const code = ev.code ?? '';
  const m = /^(?:Digit|Numpad)([1-6])$/.exec(code);
  const digit = m ? Number(m[1]) : /^[1-6]$/.test(ev.key) ? Number(ev.key) : 0;
  if (digit) return { kind: 'camera', mode: CAMERA_KEYS[digit - 1] };
  switch (ev.key.toLowerCase()) {
    case 't': return { kind: 'designate' };
    case 'b': return { kind: 'battery' };
    case 'm': return { kind: 'measure' };
    case 'g': return { kind: 'grid' };
    case 'l': return { kind: 'layers' };
    case 'n': return { kind: 'northUp' };
    default: return null;
  }
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
}

/** El foco está en algo editable: el teclado es del usuario, no del mapa. */
export function isEditableTarget(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    // Casillas y botones no capturan letras: deslizadores y texto sí.
    const type = (t.type ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
  }
  return false;
}

export interface PointerSample { x: number; y: number; t: number }

/** Un clic derecho "de verdad": poco movimiento y poco tiempo. */
export function isStillClick(
  down: PointerSample, up: PointerSample, maxMovePx = 6, maxMs = 650,
): boolean {
  const moved = Math.hypot(up.x - down.x, up.y - down.y);
  return moved <= maxMovePx && up.t - down.t <= maxMs;
}

/** Compuerta de cadencia: deja pasar como mucho una vez cada `minMs`. */
export class RateGate {
  private last = -Infinity;
  constructor(private readonly minMs: number) {}
  /** true si ya toca (y consume el turno). */
  tryPass(nowMs: number): boolean {
    if (nowMs - this.last < this.minMs) return false;
    this.last = nowMs;
    return true;
  }
  reset(): void {
    this.last = -Infinity;
  }
}
