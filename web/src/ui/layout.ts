// ============================================================================
//  layout.ts — Distribución de pantalla: anchos de dock en :root.
//
//  Contrato §3.1 del plan V2: los widgets del mapa (agente MAP) se colocan
//  con --ua-left-dock-w / --ua-right-dock-w / --ua-topbar-h. Aquí se
//  mantienen al plegar/desplegar los docks (riel de 52 px) y en pantallas
//  estrechas (< 900 px: docks como hojas inferiores → 0 px y barra inferior
//  --ua-bottomnav-h).
// ============================================================================
import { settings } from './settings';

const LEFT_W = 368;
const RIGHT_W = 344;
const RAIL_W = 52;
const BOTTOM_NAV_H = 58;

export const NARROW_QUERY = '(max-width: 900px)';

export function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifica cambios de distribución (el HUD de artillero reubica teselas…). */
export function onLayoutChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyDockLayout(): void {
  const s = settings.get();
  const root = document.documentElement.style;
  const narrow = isNarrow();
  const left = narrow ? 0 : s.leftCollapsed ? RAIL_W : LEFT_W;
  const right = narrow ? 0 : s.rightCollapsed ? RAIL_W : RIGHT_W;
  root.setProperty('--ua-left-dock-w', `${left}px`);
  root.setProperty('--ua-right-dock-w', `${right}px`);
  root.setProperty('--ua-bottomnav-h', narrow ? `${BOTTOM_NAV_H}px` : '0px');
  document.body.classList.toggle('left-collapsed', !narrow && s.leftCollapsed);
  document.body.classList.toggle('right-collapsed', !narrow && s.rightCollapsed);
  document.body.classList.toggle('is-narrow', narrow);
  for (const fn of listeners) fn();
}

/** Instala la sincronización (ajustes + media query). */
export function installLayout(): void {
  applyDockLayout();
  settings.subscribe((_s, changed) => {
    if (changed.includes('leftCollapsed') || changed.includes('rightCollapsed')) applyDockLayout();
  });
  window.matchMedia(NARROW_QUERY).addEventListener('change', applyDockLayout);
}
