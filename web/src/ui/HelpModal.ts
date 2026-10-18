// ============================================================================
//  HelpModal.ts — Ayuda: primeros pasos, atajos de teclado y glosario.
//
//  "Primeros pasos" explica el flujo de la misión de fuego en cinco pasos y
//  relanza el tutorial guiado; "Atajos" es la chuleta completa (también con
//  la tecla ?); "Glosario" recoge toda la jerga de dirección de tiro.
// ============================================================================
import { Modal, Tabs, button } from './components';
import { h } from './dom';
import { GLOSSARY } from './glossary';
import { IconName, icon } from './icons';
import { SHORTCUTS, shortcutList } from './Shortcuts';

type HelpTab = 'start' | 'keys' | 'glossary';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'cannon', title: 'Sistema de armas', text: 'Elige la pieza en el Arsenal: morteros, obuses, lanzacohetes, misiles o armas ligeras. Cada una con sus datos reales.' },
  { icon: 'ammo', title: 'Munición', text: 'Proyectil, espoleta (impacto, retardo, tiempo o proximidad) y carga. Las condiciones de la carga corrigen la V0.' },
  { icon: 'target', title: 'Objetivo', text: 'Designa el objetivo en el mapa: distancia, demora, diferencia de cota y coordenadas MGRS al instante. Elige rama baja o alta.' },
  { icon: 'angle', title: 'Solución de tiro', text: 'La dirección de tiro calcula azimut y elevación (QE) en milésimas contra el relieve y la meteo reales. Afina a mano con los instrumentos.' },
  { icon: 'fire', title: 'Fuego', text: 'FUEGO (tecla F) lanza el disparo. MRSI, salva dispersa y comparación de físicas enseñan la balística de verdad.' },
];

export class HelpModal {
  private readonly modal: Modal;
  private readonly tabs: Tabs<HelpTab>;
  private readonly panes: Record<HelpTab, HTMLElement>;

  constructor(onStartTutorial: () => void) {
    this.modal = new Modal({ title: 'Ayuda', eyebrow: 'Unai Artillery', icon: 'help', size: 'l', testid: 'help' });
    this.tabs = new Tabs<HelpTab>([
      { id: 'start', label: 'Primeros pasos', icon: 'play', testid: 'help-tab-start' },
      { id: 'keys', label: 'Atajos', icon: 'keyboard', testid: 'help-tab-keys' },
      { id: 'glossary', label: 'Glosario', icon: 'info', testid: 'help-tab-glossary' },
    ], 'start', 'Secciones de ayuda');
    this.tabs.el.classList.add('help-tabs');

    const start = h('div', { class: 'help-start' },
      h('p', { class: 'help-lead', text: 'Una misión de fuego en cinco pasos, de arriba abajo en el panel izquierdo. Todo lo demás (meteorología, tabla de tiro, análisis e instrucción) vive en el panel derecho.' }),
      h('ol', { class: 'help-steps' },
        ...STEPS.map((s, i) => h('li', { class: 'help-step' },
          h('span', { class: 'help-step__n num', text: String(i + 1) }),
          h('span', { class: 'help-step__icon' }, icon(s.icon, 18)),
          h('div', { class: 'help-step__t' }, h('strong', { text: s.title }), h('span', { text: s.text })),
        )),
      ),
      h('div', { class: 'help-cta' },
        button({ label: 'Iniciar tutorial guiado', icon: 'play', variant: 'primary', testid: 'help-start-tutorial', onClick: () => { this.modal.close(); onStartTutorial(); } }),
        h('span', { class: 'ua-muted', text: 'Seis pasos cortos que avanzan al hacer. No bloquea la pantalla.' }),
      ),
    );
    const keys = shortcutList(SHORTCUTS, true);
    keys.classList.add('kb-list--cols');
    const glossary = h('dl', { class: 'help-gloss' },
      ...Object.values(GLOSSARY).sort((a, b) => a.term.localeCompare(b.term, 'es')).flatMap((g) => [
        h('dt', { text: g.term }),
        h('dd', { text: g.text }),
      ]),
    );
    this.panes = {
      start: h('div', { class: 'help-pane', attrs: { role: 'tabpanel' } }, start),
      keys: h('div', { class: 'help-pane', attrs: { role: 'tabpanel' } }, keys),
      glossary: h('div', { class: 'help-pane', attrs: { role: 'tabpanel' } }, glossary),
    };
    this.tabs.onChange = (t) => this.show(t);
    this.modal.body.append(this.tabs.el, ...Object.values(this.panes));
    this.show('start');
  }

  private show(t: HelpTab): void {
    for (const [k, p] of Object.entries(this.panes)) p.hidden = k !== t;
  }

  open(tab: HelpTab = 'start'): void {
    this.tabs.set(tab);
    this.show(tab);
    this.modal.open();
  }

  get isOpen(): boolean { return this.modal.isOpen; }
}
