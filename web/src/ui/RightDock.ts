// ============================================================================
//  RightDock.ts — Dock derecho con pestañas: METEO · TABLA DE TIRO ·
//  ANÁLISIS · INSTRUCCIÓN. Plegable a un riel de iconos (52 px): la UI
//  actualiza --ua-right-dock-w para que el mapa se recoloque.
// ============================================================================
import { TabDef, Tabs, iconButton } from './components';
import { h } from './dom';
import { RightTab, settings } from './settings';

export const RIGHT_TABS: TabDef<RightTab>[] = [
  { id: 'met', label: 'Meteo', icon: 'cloud' },
  { id: 'table', label: 'Tabla', icon: 'table' },
  { id: 'analysis', label: 'Análisis', icon: 'chart' },
  { id: 'training', label: 'Instrucción', icon: 'medal' },
];

const TAB_TITLES: Record<RightTab, string> = {
  met: 'Meteorología',
  table: 'Tabla de tiro',
  analysis: 'Análisis del tiro',
  training: 'Instrucción',
};

export class RightDock {
  readonly root: HTMLElement;
  readonly panels = {} as Record<RightTab, HTMLElement>;
  private readonly tabs: Tabs<RightTab>;
  private readonly railBtns = new Map<RightTab, HTMLButtonElement>();
  /** Notifica la pestaña visible (la tabla de tiro solo calcula si se ve). */
  onTabChanged?: (tab: RightTab, visible: boolean) => void;

  constructor() {
    this.root = document.getElementById('rightDock')!;
    this.root.textContent = '';
    const active = settings.get().rightTab;
    this.tabs = new Tabs(RIGHT_TABS, active, 'Paneles de datos');
    this.tabs.onChange = (id) => this.show(id);

    const collapse = iconButton({
      icon: 'panelRight', label: 'Plegar el panel de datos', testid: 'right-collapse',
      onClick: () => settings.set({ rightCollapsed: true }),
    });
    const body = h('div', { class: 'rdock-body' });
    for (const t of RIGHT_TABS) {
      const p = h('section', {
        class: 'rdock-panel',
        id: `tabpanel-${t.id}`,
        testid: `panel-${t.id}`,
        attrs: { role: 'tabpanel', 'aria-labelledby': `tab-${t.id}`, tabindex: -1 },
      });
      p.hidden = t.id !== active;
      this.panels[t.id] = p;
      body.appendChild(p);
    }

    const rail = h('nav', { class: 'dock-rail dock-rail--right', attrs: { 'aria-label': 'Paneles de datos (plegados)' } },
      iconButton({
        icon: 'panelRight', label: 'Desplegar el panel de datos', testid: 'right-expand',
        onClick: () => settings.set({ rightCollapsed: false }),
      }),
      h('span', { class: 'rail__sep' }),
    );
    for (const t of RIGHT_TABS) {
      const b = iconButton({ icon: t.icon, label: TAB_TITLES[t.id], testid: `rail-${t.id}`, onClick: () => this.open(t.id) });
      this.railBtns.set(t.id, b);
      rail.appendChild(b);
    }

    this.root.append(
      h('header', { class: 'rdock-head' }, this.tabs.el, collapse),
      body,
      rail,
    );
    this.markRail(active);
    settings.subscribe((_s, changed) => {
      if (changed.includes('rightCollapsed')) this.onTabChanged?.(this.tabs.value, this.visible);
    });
  }

  get active(): RightTab { return this.tabs.value; }

  /** ¿El contenido del dock está a la vista? (plegado = no). */
  get visible(): boolean { return !settings.get().rightCollapsed; }

  /** Abre una pestaña (y despliega el dock si estaba plegado). */
  open(tab: RightTab): void {
    if (settings.get().rightCollapsed) settings.set({ rightCollapsed: false });
    this.tabs.set(tab);
    this.show(tab);
  }

  private show(tab: RightTab): void {
    for (const t of RIGHT_TABS) this.panels[t.id].hidden = t.id !== tab;
    this.markRail(tab);
    settings.set({ rightTab: tab });
    this.panels[tab].scrollTop = 0;
    this.onTabChanged?.(tab, this.visible);
  }

  private markRail(tab: RightTab): void {
    for (const [id, b] of this.railBtns) b.setAttribute('aria-pressed', String(id === tab));
  }

  /** Cabecera estándar de una pestaña (título + acciones). */
  static header(title: string, ...actions: HTMLElement[]): HTMLElement {
    return h('div', { class: 'rpanel-head' },
      h('h2', { class: 'rpanel-title', text: title }),
      h('div', { class: 'rpanel-actions' }, ...actions),
    );
  }
}
