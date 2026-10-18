// ============================================================================
//  Tutorial.ts — Primer contacto: coach-marks que avanzan AL HACER.
//  [P-VIVO.11 · rediseño V2: no bloqueante]
//
//  Seis pasos que se completan detectando la ACCIÓN real (eventos de la app,
//  nada de "siguiente" ciego): elegir arma → apuntar → FUEGO e impacto →
//  designar objetivo (elipse PER) → salva dispersa → abrir un reto.
//
//  * `TutorialMachine` — máquina de pasos PURA (sin DOM): índice, condición
//    de avance por evento, salto de paso, terminado. Testeable en node.
//  * `Tutorial` — capa DOM NO BLOQUEANTE: un anillo pulsante alrededor del
//    control del paso (sin velo: la app se ve y se usa entera) y una tarjeta
//    compacta junto a él con "Paso N de 6", progreso, "Saltar paso" y
//    "Cerrar". Solo en la primera visita (localStorage
//    'unai-artillery/tutorial/v1'); se relanza desde Ayuda.
// ============================================================================
import { h, setText } from './dom';
import { icon } from './icons';

export type TutorialEvent =
  | 'weapon-changed'
  | 'aim-changed'
  | 'impact'
  | 'target-marked'
  | 'salvo-fired'
  | 'challenge-opened';

export interface TutorialStep {
  event: TutorialEvent;
  title: string;
  text: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    event: 'weapon-changed',
    title: 'Elige un sistema de armas',
    text: 'Abre el Arsenal y selecciona otra arma: del mortero de 120 mm al misil de 500 km.',
  },
  {
    event: 'aim-changed',
    title: 'Apunta',
    text: 'Gira la rosa de azimut o el cuadrante de elevación (rueda o arrastre), o usa las flechas del teclado. El arco ámbar es el tiro previsto.',
  },
  {
    event: 'impact',
    title: 'Fuego',
    text: 'Pulsa FUEGO (o la tecla F) y sigue el proyectil. El estampido llega tarde: es el sonido recorriendo la distancia real.',
  },
  {
    event: 'target-marked',
    title: 'Designa un objetivo',
    text: 'Pulsa "Designar en mapa" y haz clic en el terreno: la dirección de tiro resuelve sola y la elipse muestra el error probable.',
  },
  {
    event: 'salvo-fired',
    title: 'Salva dispersa',
    text: 'Lanza la salva ×6: seis tiros con errores realistas. Los cráteres dibujan la dispersión y ANÁLISIS la mide.',
  },
  {
    event: 'challenge-opened',
    title: 'Instrucción',
    text: 'En la pestaña INSTRUCCIÓN inicia un reto: diana a mano, blanco móvil o corrección como observador avanzado.',
  },
];

/** Máquina de pasos PURA: avanza solo con el evento que el paso espera. */
export class TutorialMachine {
  stepIndex = 0;

  get total(): number { return TUTORIAL_STEPS.length; }
  get done(): boolean { return this.stepIndex >= TUTORIAL_STEPS.length; }
  get current(): TutorialStep | null {
    return this.done ? null : TUTORIAL_STEPS[this.stepIndex];
  }

  /** true si el evento completó el paso actual (y se avanzó). */
  advance(ev: TutorialEvent): boolean {
    if (this.done) return false;
    if (TUTORIAL_STEPS[this.stepIndex].event !== ev) return false;
    this.stepIndex++;
    return true;
  }

  /** El usuario salta el paso actual (sin realizar la acción). */
  skipStep(): void {
    if (!this.done) this.stepIndex++;
  }

  reset(): void { this.stepIndex = 0; }
}

// ---------------------------------------------------------------------------
//  Capa DOM.
// ---------------------------------------------------------------------------

const STORE_KEY = 'unai-artillery/tutorial/v1';

export class Tutorial {
  private readonly machine = new TutorialMachine();
  private overlay!: HTMLElement;
  private ring!: HTMLElement;
  private card!: HTMLElement;
  private stepLabel!: HTMLElement;
  private titleEl!: HTMLElement;
  private textEl!: HTMLElement;
  private dots!: HTMLElement;
  private active = false;
  private repositionTimer: number | undefined;
  /** Notifica el fin (completado o cerrado) — p. ej. para un aviso. */
  onFinish?: (completed: boolean) => void;

  constructor(
    /** Elemento a resaltar en cada paso (null = tarjeta centrada, sin anillo). */
    private readonly anchorOf: (stepIndex: number) => HTMLElement | null,
    opts: { autoStart?: boolean } = {},
  ) {
    this.buildDom();
    if ((opts.autoStart ?? true) && !this.seen()) this.start();
  }

  get isActive(): boolean { return this.active; }

  private seen(): boolean {
    try {
      return localStorage.getItem(STORE_KEY) === 'done';
    } catch {
      return true; // sin almacenamiento: mejor no insistir en cada carga
    }
  }

  private markSeen(): void {
    try {
      localStorage.setItem(STORE_KEY, 'done');
    } catch {
      // sin almacenamiento
    }
  }

  private buildDom(): void {
    this.ring = h('div', { class: 'tut-ring' });
    this.stepLabel = h('span', { class: 'tut-step num', testid: 'tutorial-step' });
    this.titleEl = h('h3', { class: 'tut-title' });
    this.textEl = h('p', { class: 'tut-text' });
    this.dots = h('div', { class: 'tut-dots', attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) this.dots.appendChild(h('span', { class: 'tut-dot' }));
    const skip = h('button', {
      class: 'ua-btn ua-btn--ghost ua-btn--s tut-skip-step', testid: 'tutorial-next',
      attrs: { type: 'button' }, on: { click: () => this.skipStep() },
    }, h('span', { class: 'ua-btn__label', text: 'Saltar paso' }), icon('chevronRight', 14));
    const close = h('button', {
      class: 'ua-btn ua-btn--secondary ua-btn--s tut-skip', testid: 'tutorial-close',
      attrs: { type: 'button' }, on: { click: () => this.finish() },
    }, h('span', { class: 'ua-btn__label', text: 'Saltar tutorial' }));
    this.card = h('div', { class: 'tut-card', attrs: { role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Tutorial' } },
      h('div', { class: 'tut-card__head' },
        h('span', { class: 'tut-badge' }, icon('help', 14), 'Primeros pasos'),
        this.stepLabel,
      ),
      this.titleEl,
      this.textEl,
      h('div', { class: 'tut-card__foot' }, this.dots, h('span', { class: 'tut-grow' }), skip, close),
    );
    this.overlay = h('div', { id: 'tutorialOverlay', testid: 'tutorial' }, this.ring, this.card);
    this.overlay.hidden = true;
    document.body.appendChild(this.overlay);
  }

  start(): void {
    this.machine.reset();
    this.active = true;
    this.overlay.hidden = false;
    this.render();
    // Los paneles se desplazan y la ventana cambia: re-posiciona periódico.
    window.clearInterval(this.repositionTimer);
    this.repositionTimer = window.setInterval(() => this.position(), 350);
  }

  /** Conectar a los eventos reales de la app (main.ts). */
  notify(ev: TutorialEvent): void {
    if (!this.active) return;
    if (!this.machine.advance(ev)) return;
    if (this.machine.done) this.finish(true);
    else this.render();
  }

  private skipStep(): void {
    this.machine.skipStep();
    if (this.machine.done) this.finish(true);
    else this.render();
  }

  finish(completed = false): void {
    if (!this.active) return;
    this.active = false;
    this.overlay.hidden = true;
    window.clearInterval(this.repositionTimer);
    this.markSeen();
    this.onFinish?.(completed);
  }

  private render(): void {
    const step = this.machine.current;
    if (!step) return;
    setText(this.stepLabel, `${this.machine.stepIndex + 1}/${this.machine.total}`);
    setText(this.titleEl, step.title);
    setText(this.textEl, step.text);
    [...this.dots.children].forEach((d, i) => {
      d.classList.toggle('is-done', i < this.machine.stepIndex);
      d.classList.toggle('is-on', i === this.machine.stepIndex);
    });
    this.card.classList.remove('is-in');
    void this.card.offsetWidth; // reinicia la animación de entrada
    this.card.classList.add('is-in');
    this.position();
  }

  /** Anillo sobre el ancla del paso y tarjeta al lado (sin tapar el ancla). */
  private position(): void {
    if (!this.active) return;
    const anchor = this.anchorOf(this.machine.stepIndex);
    const cw = this.card.offsetWidth || 320;
    const ch = this.card.offsetHeight || 170;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!anchor || anchor.offsetParent === null) {
      this.ring.hidden = true;
      this.card.style.left = `${Math.round((vw - cw) / 2)}px`;
      this.card.style.top = `${Math.round(vh * 0.22)}px`;
      this.card.dataset.side = 'none';
      return;
    }
    const r = anchor.getBoundingClientRect();
    const pad = 5;
    this.ring.hidden = false;
    this.ring.style.left = `${r.left - pad}px`;
    this.ring.style.top = `${r.top - pad}px`;
    this.ring.style.width = `${r.width + pad * 2}px`;
    this.ring.style.height = `${r.height + pad * 2}px`;

    const gap = 16;
    let left: number;
    let top: number;
    let side: string;
    // Dentro de un dock, la tarjeta sale FUERA de él (sobre el mapa) para no
    // tapar los controles vecinos; la flecha apunta al ancla.
    const dock = anchor.closest<HTMLElement>('#leftDock, #rightDock');
    const dr = dock && vw > 900 ? dock.getBoundingClientRect() : null;
    if (dr && dock!.id === 'leftDock' && dr.right + gap + cw < vw - 8) {
      left = dr.right + gap; top = r.top + r.height / 2 - ch / 2; side = 'right';
    } else if (dr && dock!.id === 'rightDock' && dr.left - gap - cw > 8) {
      left = dr.left - gap - cw; top = r.top + r.height / 2 - ch / 2; side = 'left';
    } else if (r.right + gap + cw < vw - 8) {
      left = r.right + gap; top = r.top + r.height / 2 - ch / 2; side = 'right';
    } else if (r.left - gap - cw > 8) {
      left = r.left - gap - cw; top = r.top + r.height / 2 - ch / 2; side = 'left';
    } else if (r.bottom + gap + ch < vh - 8) {
      left = r.left + r.width / 2 - cw / 2; top = r.bottom + gap; side = 'below';
    } else {
      left = r.left + r.width / 2 - cw / 2; top = r.top - gap - ch; side = 'above';
    }
    left = Math.max(8, Math.min(vw - cw - 8, left));
    top = Math.max(60, Math.min(vh - ch - 8, top));
    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(top)}px`;
    this.card.dataset.side = side;
    // Flecha hacia el centro del ancla.
    const ax = side === 'below' || side === 'above' ? r.left + r.width / 2 - left : 0;
    const ay = side === 'left' || side === 'right' ? r.top + r.height / 2 - top : 0;
    this.card.style.setProperty('--arrow-x', `${Math.max(16, Math.min(cw - 16, ax))}px`);
    this.card.style.setProperty('--arrow-y', `${Math.max(16, Math.min(ch - 16, ay))}px`);
  }
}
