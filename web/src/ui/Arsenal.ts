// ============================================================================
//  Arsenal.ts — Galería modal del arsenal, agrupada por categoría.
//
//  Cada arma es una tarjeta (silueta, designación, papel, calibre, alcance
//  publicado, V0 de carga máxima del simulador y cadencia). Clic o Intro
//  selecciona y cierra; la vigente queda marcada. Operable entero con
//  teclado (flechas entre tarjetas, Esc cierra).
// ============================================================================
import { WeaponCatalog, WeaponId } from '../ballistics';
import { Modal } from './components';
import { h } from './dom';
import { icon, silhouette } from './icons';
import { WEAPON_INFO, weaponsByCategory } from './weaponInfo';

/** V0 de la carga máxima (o del cartucho/motor fijo) — la que se dispara. */
export function maxMuzzleVelocity(id: WeaponId): number {
  const w = WeaponCatalog.get(id);
  if (w.charges.length === 0) return w.round.muzzleVelocity;
  return Math.max(...w.charges.map((c) => c.muzzleVelocity));
}

export class ArsenalModal {
  private readonly modal: Modal;
  private readonly cards = new Map<WeaponId, HTMLButtonElement>();
  private current: WeaponId;

  constructor(current: WeaponId, private readonly onSelect: (id: WeaponId) => void) {
    this.current = current;
    this.modal = new Modal({
      title: 'Arsenal',
      eyebrow: 'Sistema de armas',
      icon: 'grid',
      size: 'xl',
      testid: 'arsenal',
    });
    this.modal.body.classList.add('arsenal');

    for (const group of weaponsByCategory()) {
      const grid = h('div', { class: 'arsenal__grid', attrs: { role: 'list' } });
      for (const id of group.ids) grid.appendChild(this.card(id));
      this.modal.body.appendChild(
        h('section', { class: 'arsenal__group' },
          h('h3', { class: 'arsenal__group-title' },
            h('span', { class: 'ua-eyebrow', text: group.label }),
            h('span', { class: 'arsenal__count num', text: String(group.ids.length) }),
          ),
          grid,
        ),
      );
    }
    this.modal.body.addEventListener('keydown', (ev) => this.onKey(ev));
    this.mark(current);
  }

  private card(id: WeaponId): HTMLButtonElement {
    const info = WEAPON_INFO[id];
    const w = WeaponCatalog.get(id);
    const v0 = maxMuzzleVelocity(id);
    const stat = (label: string, value: string, wide = false) =>
      h('div', { class: `arsenal__stat${wide ? ' arsenal__stat--wide' : ''}` },
        h('span', { class: 'arsenal__stat-k', text: label }),
        h('span', { class: 'arsenal__stat-v num', text: value }),
      );
    const b = h('button', {
      class: 'arsenal__card',
      testid: `arsenal-item-${id}`,
      attrs: { type: 'button', role: 'listitem', 'aria-label': `${info.name}. ${info.role}` },
      on: { click: () => this.choose(id) },
    },
      h('div', { class: 'arsenal__sil' }, silhouette(info.silhouette, 188)),
      h('div', { class: 'arsenal__head' },
        h('span', { class: 'arsenal__name', text: info.designation }),
        h('span', { class: 'arsenal__cal num', text: info.caliber }),
      ),
      h('span', { class: 'arsenal__role', text: info.role }),
      h('div', { class: 'arsenal__stats' },
        stat('Alcance publicado', info.publishedRange, true),
        stat('Cadencia', info.rateOfFire, true),
        stat('V0 máx. (sim.)', `${v0.toFixed(0)} m/s`),
        stat('Elevación', `${w.minElevationDeg.toFixed(0)}–${w.maxElevationDeg.toFixed(0)}°`),
      ),
      h('p', { class: 'arsenal__blurb', text: info.blurb }),
      h('span', { class: 'arsenal__current' }, icon('check', 14), 'En servicio'),
    );
    this.cards.set(id, b);
    return b;
  }

  private choose(id: WeaponId): void {
    this.modal.close();
    if (id !== this.current) this.onSelect(id);
  }

  /** Marca el arma vigente (también si cambió por un enlace/sesión). */
  mark(id: WeaponId): void {
    this.current = id;
    for (const [cid, b] of this.cards) {
      const on = cid === id;
      b.classList.toggle('is-current', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
    }
  }

  open(): void {
    this.modal.open();
    this.cards.get(this.current)?.focus({ preventScroll: false });
  }

  get isOpen(): boolean { return this.modal.isOpen; }

  private onKey(ev: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const list = [...this.cards.values()];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Columna aproximada por la geometría real (la rejilla es fluida).
    const cur = list[i].getBoundingClientRect();
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    list.forEach((b, j) => {
      if (j === i) return;
      const r = b.getBoundingClientRect();
      const dx = r.left - cur.left;
      const dy = r.top - cur.top;
      const ok =
        (ev.key === 'ArrowRight' && dx > 4 && Math.abs(dy) < cur.height / 2) ||
        (ev.key === 'ArrowLeft' && dx < -4 && Math.abs(dy) < cur.height / 2) ||
        (ev.key === 'ArrowDown' && dy > 4) ||
        (ev.key === 'ArrowUp' && dy < -4);
      if (!ok) return;
      const score = Math.abs(dx) + Math.abs(dy) * 1.5;
      if (score < bestScore) { bestScore = score; best = j; }
    });
    if (best >= 0) list[best].focus();
  }
}
