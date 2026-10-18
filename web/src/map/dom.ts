// ============================================================================
//  map/dom.ts — Contenedor y utilidades DOM de los widgets del mapa. [V2:MAP]
//
//  Todos los widgets cuelgan de UN contenedor `.ua-map-root` (absoluto,
//  inset 0, sin z-index propio para que cada widget compita con su capa
//  --ua-z-* frente a los docks, y sin capturar el ratón: solo los widgets).
// ============================================================================
import './map.css';

let root: HTMLDivElement | null = null;

export function mapRoot(): HTMLDivElement {
  if (root && root.isConnected) return root;
  root = document.querySelector<HTMLDivElement>('.ua-map-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'ua-map-root';
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    document.body.appendChild(root);
  }
  return root;
}

/** Crea un elemento con clase y (opcional) HTML interno de confianza. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Px de una variable CSS de distribución (p. ej. --ua-left-dock-w). */
export function cssPx(name: string, fallback: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Rectángulo útil del área de mapa (entre docks, bajo la barra superior). */
export function mapViewportRect(): { left: number; right: number; top: number; bottom: number } {
  const g = cssPx('--ua-gutter', 12);
  const narrow = window.innerWidth <= 900;
  const left = narrow ? g : cssPx('--ua-left-dock-w', 360) + 2 * g;
  const right = window.innerWidth - (narrow ? g : cssPx('--ua-right-dock-w', 340) + 2 * g);
  const top = cssPx('--ua-topbar-h', 52) + g;
  const bottom = window.innerHeight - (cssPx('--ua-statusbar-h', 32) + 2 * g);
  return { left, right, top, bottom };
}
