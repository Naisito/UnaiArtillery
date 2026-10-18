// ============================================================================
//  map/ContextMenu.ts — Menú contextual del globo.  [V2:MAP]
//
//  Cabecera con la referencia MGRS del punto, su cota y su relación con la
//  batería; entradas con icono, atajo y, si están deshabilitadas, el MOTIVO.
//  Teclado completo (↑/↓/Inicio/Fin, Intro/Espacio, Esc), foco atrapado en
//  el menú y cierre al pulsar fuera, al girar la rueda o al redimensionar.
// ============================================================================
import { el } from './dom';

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  kbd?: string;
  disabledReason?: string | null;
  tone?: 'accent' | 'friendly';
  run: () => void;
}

export type MenuEntry = MenuItem | 'sep';

export interface MenuHeader {
  title: string;
  meta: string[];
}

export class ContextMenu {
  private menu: HTMLDivElement | null = null;
  private items: HTMLButtonElement[] = [];
  private readonly onDocDown = (ev: Event) => {
    if (this.menu && !this.menu.contains(ev.target as Node)) this.close();
  };
  private readonly onResize = () => this.close();
  onClose?: () => void;

  constructor(private readonly parent: HTMLElement) {}

  get isOpen(): boolean {
    return !!this.menu;
  }

  open(x: number, y: number, header: MenuHeader, entries: MenuEntry[]): void {
    this.close();
    const m = el('div', 'ua-ctx');
    m.setAttribute('role', 'menu');
    m.tabIndex = -1;
    m.style.pointerEvents = 'auto';

    const head = el('div', 'ua-ctx-head');
    const grid = el('div', 'grid');
    grid.textContent = header.title;
    const meta = el('div', 'meta');
    for (const t of header.meta) {
      const s = el('span');
      s.innerHTML = t;
      meta.appendChild(s);
    }
    head.append(grid, meta);
    m.appendChild(head);

    this.items = [];
    for (const e of entries) {
      if (e === 'sep') {
        m.appendChild(el('div', 'ua-ctx-sep'));
        continue;
      }
      const b = el('button', `ua-ctx-item${e.tone ? ` ${e.tone}` : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.id = e.id;
      const disabled = !!e.disabledReason;
      if (disabled) b.setAttribute('aria-disabled', 'true');
      const label = el('span');
      label.textContent = e.label;
      if (disabled) {
        const why = el('span', 'why');
        why.textContent = e.disabledReason!;
        label.appendChild(why);
      }
      const kbd = el('kbd');
      kbd.textContent = e.kbd ?? '';
      if (!e.kbd) kbd.style.visibility = 'hidden';
      b.append(el('span', '', e.icon), label, kbd);
      b.addEventListener('click', () => {
        if (disabled) return;
        this.close();
        e.run();
      });
      b.addEventListener('mouseenter', () => { if (!disabled) b.focus({ preventScroll: true }); });
      m.appendChild(b);
      this.items.push(b);
    }

    m.addEventListener('keydown', (ev) => this.onKey(ev));
    m.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.parent.appendChild(m);
    this.menu = m;

    // Dentro de la ventana: se abre hacia donde haya sitio.
    const r = m.getBoundingClientRect();
    const px = x + r.width + 8 > window.innerWidth ? Math.max(8, x - r.width) : x;
    const py = y + r.height + 8 > window.innerHeight ? Math.max(8, y - r.height) : y;
    m.style.left = `${px}px`;
    m.style.top = `${py}px`;

    const first = this.enabled()[0];
    (first ?? m).focus({ preventScroll: true });

    window.setTimeout(() => {
      document.addEventListener('pointerdown', this.onDocDown, true);
      document.addEventListener('wheel', this.onDocDown, true);
      window.addEventListener('resize', this.onResize);
      window.addEventListener('blur', this.onResize);
    }, 0);
  }

  private enabled(): HTMLButtonElement[] {
    return this.items.filter((b) => b.getAttribute('aria-disabled') !== 'true');
  }

  private onKey(ev: KeyboardEvent): void {
    const list = this.enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (k: number) => list[(k + list.length) % list.length]?.focus({ preventScroll: true });
    switch (ev.key) {
      case 'ArrowDown': focus(i + 1); break;
      case 'ArrowUp': focus(i < 0 ? list.length - 1 : i - 1); break;
      case 'Home': focus(0); break;
      case 'End': focus(list.length - 1); break;
      case 'Tab': focus(ev.shiftKey ? i - 1 : i + 1); break;
      case 'Escape': this.close(); break;
      case 'Enter':
      case ' ':
        if (i >= 0) list[i].click();
        break;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }

  close(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.items = [];
    document.removeEventListener('pointerdown', this.onDocDown, true);
    document.removeEventListener('wheel', this.onDocDown, true);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onResize);
    this.onClose?.();
  }
}
