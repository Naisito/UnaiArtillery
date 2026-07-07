// ============================================================================
//  Tutorial.ts — Primer contacto: coach-marks que avanzan AL HACER.  [P-VIVO.11]
//
//  Seis pasos que se completan detectando la ACCIÓN real (eventos del app,
//  nada de botón "siguiente" ciego): elegir arma → apuntar → FUEGO e impacto
//  → objetivo con clic (elipse PER) → salva dispersa → abrir el reto.
//
//  * `TutorialMachine` — máquina de pasos PURA (sin DOM): índice, condición
//    de avance por evento, terminado. Testeable en node.
//  * `Tutorial` — capa DOM: overlay oscuro con RECORTE alrededor del elemento
//    activo (box-shadow gigante del highlight) + globo con texto y "N/6";
//    "Saltar" siempre visible. Solo la primera visita
//    (localStorage 'unai-artillery/tutorial/v1') y relanzable desde "❓".
// ============================================================================

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
    title: 'Elige tu arma',
    text: 'Abre el selector y elige OTRA arma: de un mortero de 120 mm a un misil de 500 km.',
  },
  {
    event: 'aim-changed',
    title: 'Apunta',
    text: 'Mueve el azimut o la elevación (sliders del panel, o la rosa y el cuadrante del cockpit). El arco naranja es tu tiro previsto.',
  },
  {
    event: 'impact',
    title: '¡Fuego!',
    text: 'Pulsa FUEGO y sigue el proyectil hasta el impacto. El estampido llega tarde: es el sonido recorriendo la distancia real.',
  },
  {
    event: 'target-marked',
    title: 'Marca un objetivo',
    text: 'Pulsa 🎯 y haz clic en el globo: la dirección de tiro resuelve sola y la elipse roja muestra el error probable (PER).',
  },
  {
    event: 'salvo-fired',
    title: 'Salva dispersa',
    text: 'Lanza la salva ×6: seis tiros con errores realistas. Los cráteres dibujan la elipse de dispersión de verdad.',
  },
  {
    event: 'challenge-opened',
    title: 'El reto',
    text: 'Abre 🏅 Reto: diana aleatoria, puntería a mano y estrellas por precisión. También hay reto FO 🔭 y blanco móvil 🚚.',
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

  reset(): void { this.stepIndex = 0; }
}

// ---------------------------------------------------------------------------
//  Capa DOM.
// ---------------------------------------------------------------------------

const STORE_KEY = 'unai-artillery/tutorial/v1';

export class Tutorial {
  private readonly machine = new TutorialMachine();
  private overlay!: HTMLElement;
  private highlight!: HTMLElement;
  private balloon!: HTMLElement;
  private stepLabel!: HTMLElement;
  private titleEl!: HTMLElement;
  private textEl!: HTMLElement;
  private active = false;
  private repositionTimer: number | undefined;

  constructor(
    /** Elemento a resaltar en cada paso (null = globo centrado, sin recorte). */
    private readonly anchorOf: (stepIndex: number) => HTMLElement | null,
  ) {
    this.buildDom();
    // Botón ❓ para relanzarlo cuando se quiera.
    const help = document.createElement('button');
    help.id = 'tutorialHelpBtn';
    help.textContent = '❓';
    help.title = 'Relanzar el tutorial';
    help.setAttribute('aria-label', 'Relanzar el tutorial');
    help.onclick = () => this.start();
    document.body.appendChild(help);

    if (!this.seen()) this.start();
  }

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
    this.overlay = document.createElement('div');
    this.overlay.id = 'tutorialOverlay';
    this.overlay.style.display = 'none';

    this.highlight = document.createElement('div');
    this.highlight.className = 'tut-highlight';

    this.balloon = document.createElement('div');
    this.balloon.className = 'tut-balloon';
    this.stepLabel = document.createElement('div');
    this.stepLabel.className = 'tut-step';
    this.titleEl = document.createElement('h3');
    this.textEl = document.createElement('p');
    const skip = document.createElement('button');
    skip.className = 'tut-skip';
    skip.textContent = 'Saltar';
    skip.onclick = () => this.finish();
    this.balloon.append(this.stepLabel, this.titleEl, this.textEl, skip);

    this.overlay.append(this.highlight, this.balloon);
    document.body.appendChild(this.overlay);
  }

  start(): void {
    this.machine.reset();
    this.active = true;
    this.overlay.style.display = '';
    this.render();
    // Los paneles hacen scroll y las ventanas cambian: re-posiciona periódico.
    window.clearInterval(this.repositionTimer);
    this.repositionTimer = window.setInterval(() => this.position(), 400);
  }

  /** Conectar a los eventos reales del app (main.ts). */
  notify(ev: TutorialEvent): void {
    if (!this.active) return;
    if (!this.machine.advance(ev)) return;
    if (this.machine.done) {
      this.finish(true);
    } else {
      this.render();
    }
  }

  private finish(completed = false): void {
    this.active = false;
    this.overlay.style.display = 'none';
    window.clearInterval(this.repositionTimer);
    this.markSeen();
    if (completed) {
      this.stepLabel.textContent = '';
      // Un cierre amable sin depender de toast (evita ciclos de import).
      console.log('[tutorial] completado');
    }
  }

  private render(): void {
    const step = this.machine.current;
    if (!step) return;
    this.stepLabel.textContent = `${this.machine.stepIndex + 1}/${this.machine.total}`;
    this.titleEl.textContent = step.title;
    this.textEl.textContent = step.text;
    this.position();
  }

  /** Recorte sobre el ancla del paso y globo al lado (con flecha CSS). */
  private position(): void {
    if (!this.active) return;
    const anchor = this.anchorOf(this.machine.stepIndex);
    if (!anchor) {
      this.highlight.style.display = 'none';
      this.balloon.style.left = '50%';
      this.balloon.style.top = '30%';
      this.balloon.style.transform = 'translateX(-50%)';
      this.balloon.classList.remove('arrow-left');
      return;
    }
    const r = anchor.getBoundingClientRect();
    const pad = 6;
    this.highlight.style.display = '';
    this.highlight.style.left = `${r.left - pad}px`;
    this.highlight.style.top = `${r.top - pad}px`;
    this.highlight.style.width = `${r.width + pad * 2}px`;
    this.highlight.style.height = `${r.height + pad * 2}px`;

    // Globo a la derecha del ancla (los paneles viven a la izquierda); si no
    // cabe, debajo.
    const bw = 300;
    let left = r.right + 18;
    let top = r.top;
    let arrowLeft = true;
    if (left + bw > window.innerWidth - 8) {
      left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left));
      top = r.bottom + 14;
      arrowLeft = false;
    }
    this.balloon.style.transform = '';
    this.balloon.style.left = `${left}px`;
    this.balloon.style.top = `${Math.max(8, Math.min(window.innerHeight - 180, top))}px`;
    this.balloon.classList.toggle('arrow-left', arrowLeft);
  }
}
