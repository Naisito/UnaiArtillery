// ============================================================================
//  panelTabs.ts — Pantallas estrechas (< 900 px): barra inferior + hojas.
//  [P-VIVO.11 · rediseño V2]
//
//  Los dos docks no caben junto al globo: una barra inferior (Misión ·
//  Meteo · Tabla · Análisis · Instrucción) abre UNA hoja deslizante cada
//  vez (tocar la pestaña activa la pliega). Con todo plegado queda un botón
//  FUEGO flotante. El CSS (media query) esconde todo esto en escritorio.
// ============================================================================
import { ControlPanel } from './ControlPanel';
import { h } from './dom';
import { IconName, icon } from './icons';
import { NARROW_QUERY } from './layout';
import { RightDock } from './RightDock';
import type { RightTab } from './settings';

export type SheetId = 'mission' | RightTab;

const TABS: { id: SheetId; label: string; icon: IconName }[] = [
  { id: 'mission', label: 'Misión', icon: 'target' },
  { id: 'met', label: 'Meteo', icon: 'cloud' },
  { id: 'table', label: 'Tabla', icon: 'table' },
  { id: 'analysis', label: 'Análisis', icon: 'chart' },
  { id: 'training', label: 'Instrucción', icon: 'medal' },
];

export interface PanelTabsController {
  /** Abre una hoja (y pliega las demás). Acepta los ids históricos. */
  open(id: SheetId | string): void;
  close(): void;
}

export function installPanelTabs(rightDock: RightDock, panel: ControlPanel): PanelTabsController {
  const buttons = new Map<SheetId, HTMLButtonElement>();
  let current: SheetId | null = null;

  const apply = (id: SheetId | null) => {
    current = id;
    const left = document.getElementById('leftDock');
    const right = document.getElementById('rightDock');
    left?.classList.toggle('sheet-open', id === 'mission');
    right?.classList.toggle('sheet-open', id !== null && id !== 'mission');
    if (id && id !== 'mission') rightDock.open(id);
    for (const [bid, b] of buttons) b.setAttribute('aria-selected', String(bid === id));
    document.body.classList.toggle('sheet-is-open', id !== null);
  };

  const bar = h('nav', { id: 'bottomNav', attrs: { role: 'tablist', 'aria-label': 'Paneles' } });
  for (const t of TABS) {
    const b = h('button', {
      class: 'bn-tab', testid: `sheet-${t.id}`,
      attrs: { type: 'button', role: 'tab', 'aria-selected': 'false' },
      on: { click: () => apply(current === t.id ? null : t.id) },
    }, icon(t.icon, 20), h('span', { text: t.label }));
    buttons.set(t.id, b);
    bar.appendChild(b);
  }

  // FUEGO flotante (hojas plegadas): misma semántica que el botón del dock.
  const fab = h('button', {
    id: 'fireFab', testid: 'fire-fab',
    attrs: { type: 'button', 'aria-label': 'Fuego' },
  }, icon('fire', 26), h('span', { text: 'Fuego' }));
  fab.addEventListener('pointerdown', (ev) => {
    fab.setPointerCapture(ev.pointerId);
    panel.triggerFire(true);
  });
  const up = (ev: PointerEvent) => {
    if (fab.hasPointerCapture(ev.pointerId)) fab.releasePointerCapture(ev.pointerId);
    panel.triggerFire(false);
  };
  fab.addEventListener('pointerup', up);
  fab.addEventListener('pointercancel', up);

  document.body.append(bar, fab);

  const normalize = (id: string): SheetId | null => {
    if (id === 'controlPanel' || id === 'leftDock' || id === 'cockpit' || id === 'mission') return 'mission';
    if (id === 'weatherPanel') return 'met';
    return (TABS.find((t) => t.id === id)?.id) ?? null;
  };

  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener('change', () => { if (!mq.matches) apply(null); });

  return {
    open(id: SheetId | string) {
      if (!mq.matches) return;
      const n = normalize(id);
      if (n) apply(n);
    },
    close() { apply(null); },
  };
}
