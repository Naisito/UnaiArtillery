// ============================================================================
//  map/NavCluster.ts — Clúster de navegación y selector de capas. [V2:MAP]
//
//  Arriba-derecha del área de mapa: brújula (gira con el rumbo de la
//  cámara; clic = norte arriba), zoom ±, vista de planeamiento cenital, ir
//  a la batería / al objetivo, capas base, rejilla MGRS y medición. Cada
//  botón con tooltip y su atajo de teclado.
// ============================================================================
import { el } from './dom';
import { ICON } from './icons';
import { BASE_LAYERS, BaseLayerId } from './BaseLayers';
import { formatAzDeg, formatMils } from './units';

export interface NavCallbacks {
  northUp(): void;
  zoom(factor: number): void;
  planView(): void;
  flyToBattery(): void;
  flyToTarget(): void;
  toggleGrid(): void;
  toggleMeasure(): void;
  setBaseLayer(id: BaseLayerId): void;
  setLabels(on: boolean): void;
  isLayerAvailable(id: BaseLayerId): boolean;
}

const COMPASS_SVG =
  `<svg viewBox="0 0 48 48" aria-hidden="true">` +
  `<circle class="ring" cx="24" cy="24" r="21" fill="none" stroke-width="1"/>` +
  Array.from({ length: 16 }, (_, i) => {
    const a = (i * 22.5 * Math.PI) / 180;
    const r0 = i % 4 === 0 ? 16.5 : 18.5;
    const x0 = 24 + Math.sin(a) * r0, y0 = 24 - Math.cos(a) * r0;
    const x1 = 24 + Math.sin(a) * 20.5, y1 = 24 - Math.cos(a) * 20.5;
    return `<line class="tick" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke-width="${i % 4 === 0 ? 1.4 : 0.8}"/>`;
  }).join('') +
  `<path class="n-needle" d="M24 7 L28.2 24 L19.8 24 Z"/>` +
  `<path class="s-needle" d="M24 41 L28.2 24 L19.8 24 Z"/>` +
  `<circle cx="24" cy="24" r="2.2" fill="currentColor"/>` +
  `<text class="card" x="24" y="5.6" text-anchor="middle" dominant-baseline="middle">N</text>` +
  `</svg>`;

export class NavCluster {
  readonly el: HTMLDivElement;
  private readonly compass: HTMLButtonElement;
  private readonly rose: SVGElement;
  private readonly headingEl: HTMLDivElement;
  private readonly btns = new Map<string, HTMLButtonElement>();
  private readonly pop: HTMLDivElement;
  private readonly layerBtns = new Map<BaseLayerId, HTMLButtonElement>();
  private readonly labelsRow: HTMLDivElement;
  private readonly gridRow: HTMLDivElement;
  private lastHeading = NaN;
  private readonly onDocDown = (ev: Event) => {
    const t = ev.target as Node;
    if (!this.pop.contains(t) && !this.btns.get('layers')!.contains(t)) this.setLayersOpen(false);
  };

  constructor(parent: HTMLElement, private readonly cb: NavCallbacks) {
    this.el = el('div', 'ua-map-nav');
    this.el.style.pointerEvents = 'auto';

    this.compass = el('button', 'ua-compass ua-glass', COMPASS_SVG);
    this.compass.type = 'button';
    this.compass.dataset.tip = 'Norte arriba · N';
    this.compass.setAttribute('aria-label', 'Orientar al norte');
    this.compass.addEventListener('click', () => cb.northUp());
    this.rose = this.compass.querySelector('svg')!;
    this.headingEl = el('div', 'ua-compass-readout ua-glass');
    const compassWrap = el('div');
    compassWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';
    compassWrap.append(this.compass, this.headingEl);
    this.el.appendChild(compassWrap);

    const group = (...ids: [string, string, string, () => void][]) => {
      const g = el('div', 'ua-nav-group ua-glass');
      for (const [id, icon, tip, run] of ids) {
        const b = el('button', 'ua-nav-btn', icon);
        b.type = 'button';
        b.dataset.tip = tip;
        b.setAttribute('aria-label', tip.split(' · ')[0]);
        b.addEventListener('click', run);
        this.btns.set(id, b);
        g.appendChild(b);
      }
      this.el.appendChild(g);
    };
    group(
      ['zoomIn', ICON.plus, 'Acercar', () => cb.zoom(0.5)],
      ['zoomOut', ICON.minus, 'Alejar', () => cb.zoom(2)],
    );
    group(
      ['plan', ICON.plan, 'Vista de planeamiento (cenital)', () => cb.planView()],
      ['battery', ICON.battery, 'Ir a la batería · Inicio', () => cb.flyToBattery()],
      ['target', ICON.target, 'Ir al objetivo', () => cb.flyToTarget()],
    );
    group(
      ['layers', ICON.layers, 'Capas base · L', () => this.setLayersOpen(!this.layersOpen)],
      ['grid', ICON.grid, 'Rejilla MGRS · G', () => cb.toggleGrid()],
      ['measure', ICON.ruler, 'Medir distancia, perfil y LOS · M', () => cb.toggleMeasure()],
    );
    for (const id of ['layers', 'grid', 'measure']) this.btns.get(id)!.setAttribute('aria-pressed', 'false');

    // -- Popover de capas ------------------------------------------------------
    this.pop = el('div', 'ua-layers-pop');
    this.pop.style.pointerEvents = 'auto';
    this.pop.setAttribute('role', 'dialog');
    this.pop.setAttribute('aria-label', 'Capas del mapa');
    this.pop.innerHTML = `<div class="ua-pop-title"><span>Capa base</span><kbd>L</kbd></div>`;
    const grid = el('div', 'ua-layer-grid');
    grid.setAttribute('role', 'radiogroup');
    for (const info of BASE_LAYERS) {
      const b = el('button', 'ua-layer-opt');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.innerHTML =
        `<span class="ua-layer-swatch ua-sw-${info.id}"></span>` +
        `<span class="ua-layer-name"><span>${info.name}</span><small>${info.short}</small></span>`;
      b.addEventListener('click', () => cb.setBaseLayer(info.id));
      this.layerBtns.set(info.id, b);
      grid.appendChild(b);
    }
    this.pop.appendChild(grid);
    this.pop.appendChild(el('div', 'ua-pop-sep'));
    const row = (label: string, kbd: string, onClick: () => void) => {
      const r = el('div', 'ua-toggle-row');
      r.setAttribute('role', 'switch');
      r.tabIndex = 0;
      r.innerHTML = `<span>${label}${kbd ? `<kbd>${kbd}</kbd>` : ''}</span><span class="ua-switch"></span>`;
      r.addEventListener('click', onClick);
      r.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onClick();
        }
      });
      this.pop.appendChild(r);
      return r;
    };
    this.labelsRow = row('Rótulos (topónimos)', '', () =>
      cb.setLabels(this.labelsRow.getAttribute('aria-checked') !== 'true'));
    this.gridRow = row('Rejilla MGRS / UTM', 'G', () => cb.toggleGrid());
    const note = el('div', 'ua-pop-note');
    note.textContent =
      'La física usa siempre el relieve real; la capa base es solo visual. ' +
      'Con los edificios 3D activos el globo base queda oculto.';
    this.pop.appendChild(note);

    parent.append(this.el, this.pop);
  }

  get layersOpen(): boolean {
    return this.pop.classList.contains('open');
  }

  setLayersOpen(open: boolean): void {
    this.pop.classList.toggle('open', open);
    this.btns.get('layers')!.setAttribute('aria-pressed', String(open));
    if (open) {
      for (const [id, b] of this.layerBtns) {
        b.disabled = !this.cb.isLayerAvailable(id);
        b.title = b.disabled ? 'Requiere token de Cesium ion (VITE_CESIUM_TOKEN)' : '';
      }
      window.setTimeout(() => document.addEventListener('pointerdown', this.onDocDown, true), 0);
      this.layerBtns.get([...this.layerBtns.keys()].find((k) => this.layerBtns.get(k)!.getAttribute('aria-checked') === 'true') ?? 'satellite')?.focus({ preventScroll: true });
    } else {
      document.removeEventListener('pointerdown', this.onDocDown, true);
    }
  }

  setBaseLayer(id: BaseLayerId, labelsOn: boolean): void {
    for (const [lid, b] of this.layerBtns) b.setAttribute('aria-checked', String(lid === id));
    this.labelsRow.setAttribute('aria-checked', String(labelsOn));
  }

  setGrid(on: boolean): void {
    this.btns.get('grid')!.setAttribute('aria-pressed', String(on));
    this.gridRow.setAttribute('aria-checked', String(on));
  }

  setMeasure(on: boolean): void {
    this.btns.get('measure')!.setAttribute('aria-pressed', String(on));
  }

  setTargetAvailable(on: boolean): void {
    const b = this.btns.get('target')!;
    b.disabled = !on;
    b.dataset.tip = on ? 'Ir al objetivo' : 'Ir al objetivo (sin objetivo designado)';
  }

  /** Rumbo de la cámara (grados): la rosa gira al contrario. */
  setHeading(headingDeg: number): void {
    const h = ((headingDeg % 360) + 360) % 360;
    if (Math.abs(h - this.lastHeading) < 0.2) return;
    this.lastHeading = h;
    this.rose.style.transform = `rotate(${(-h).toFixed(1)}deg)`;
    this.headingEl.textContent = formatMils(h);
    this.compass.dataset.tip = `Rumbo ${formatMils(h)} mil · ${formatAzDeg(h)} — clic: norte arriba (N)`;
  }
}
