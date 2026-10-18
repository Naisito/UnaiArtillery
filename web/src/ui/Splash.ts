// ============================================================================
//  Splash.ts — Pantalla de arranque mientras Cesium y el núcleo despiertan.
//
//  El marcado vive en index.html (se ve ANTES de cargar el JS); aquí solo se
//  avanzan los pasos y se desvanece al terminar. Si el arranque falla, se
//  queda con el mensaje de error en lugar de dejar una pantalla negra.
// ============================================================================

export type BootStep = 'globe' | 'battery' | 'core' | 'scene' | 'ui' | 'solution';

const ORDER: BootStep[] = ['globe', 'battery', 'core', 'scene', 'ui', 'solution'];

export class Splash {
  private readonly root: HTMLElement | null = document.getElementById('splash');
  private readonly bar: HTMLElement | null = document.getElementById('splashBar');

  step(s: BootStep): void {
    if (!this.root) return;
    const idx = ORDER.indexOf(s);
    this.root.querySelectorAll<HTMLElement>('[data-boot]').forEach((li) => {
      const i = ORDER.indexOf(li.dataset.boot as BootStep);
      li.dataset.state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
    });
    if (this.bar) this.bar.style.width = `${Math.round(((idx + 0.5) / ORDER.length) * 100)}%`;
  }

  done(): void {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLElement>('[data-boot]').forEach((li) => { li.dataset.state = 'done'; });
    if (this.bar) this.bar.style.width = '100%';
    this.root.classList.add('is-done');
    window.setTimeout(() => this.root?.remove(), 700);
  }

  fail(message: string): void {
    if (!this.root) return;
    this.root.classList.add('is-error');
    const msg = this.root.querySelector<HTMLElement>('.splash__error');
    if (msg) {
      msg.textContent = message;
      msg.hidden = false;
    }
  }
}
