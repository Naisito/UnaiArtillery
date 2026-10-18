// ============================================================================
//  map/StatusBar.ts — Franja de estado inferior del área de mapa. [V2:MAP]
//
//  Lectura bajo el cursor (lat/lon decimal o GMS, MGRS de 1 m, cota),
//  relación con la batería (distancia, demora en milésimas + grados, estado
//  de alcance contra el anillo mín/máx del arma vigente y QE estimada de la
//  tabla de tiro), barra de escala y créditos de Cesium/proveedores (se
//  mueve aquí el contenedor de créditos del visor: siguen visibles, como
//  exige la licencia). Solo DOM: los datos llegan ya calculados.
// ============================================================================
import { el } from './dom';
import type { QeEstimate } from './qe';
import type { ScaleBar } from './scale';
import {
  CoordFormat, formatAzDeg, formatDistance, formatElevMils, formatHeight, formatLat, formatLon,
  formatMgrs, formatMils,
} from './units';

export type RangeState = 'in' | 'out' | 'min' | 'unknown';

export interface CursorReadout {
  latDeg: number;
  lonDeg: number;
  /** Cota mostrada (MSL si hay corrección de geoide; si no, elipsoidal). */
  heightM: number | null;
  heightIsMsl: boolean;
  mgrs: string;
  rangeM: number;
  bearingDeg: number;
  rangeState: RangeState;
  qe: QeEstimate | null;
}

const LL_FMT_KEY = 'ua.map.coordFormat';

export class StatusBar {
  readonly el: HTMLDivElement;
  private readonly llVal: HTMLSpanElement;
  private readonly mgrsVal: HTMLSpanElement;
  private readonly elevVal: HTMLSpanElement;
  private readonly elevCap: HTMLSpanElement;
  private readonly rangeCell: HTMLDivElement;
  private readonly distVal: HTMLSpanElement;
  private readonly stateEl: HTMLSpanElement;
  private readonly azVal: HTMLSpanElement;
  private readonly qeCell: HTMLDivElement;
  private readonly qeVal: HTMLSpanElement;
  private readonly scaleBar: HTMLDivElement;
  private readonly scaleVal: HTMLSpanElement;
  private readonly scaleCell: HTMLDivElement;
  readonly credits: HTMLDivElement;
  private coordFormat: CoordFormat = 'dec';
  private last: CursorReadout | null = null;
  private idleCells: HTMLDivElement[] = [];

  constructor(parent: HTMLElement) {
    try {
      const f = localStorage.getItem(LL_FMT_KEY);
      if (f === 'dms' || f === 'dec') this.coordFormat = f;
    } catch { /* sin almacenamiento */ }

    this.el = el('div', 'ua-map-status ua-glass');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-label', 'Lectura del cursor y escala');
    this.el.style.pointerEvents = 'auto';

    const cell = (cls: string, cap: string): [HTMLDivElement, HTMLSpanElement, HTMLSpanElement] => {
      const c = el('div', `ua-ms-cell ${cls}`);
      const k = el('span', 'ua-ms-cap');
      k.textContent = cap;
      const v = el('span', 'ua-ms-val');
      c.append(k, v);
      this.el.appendChild(c);
      return [c, k, v];
    };

    const [llCell, , llVal] = cell('ua-ms-ll', 'Lat / Lon');
    llCell.title = 'Clic: alternar grados decimales / GMS';
    llCell.addEventListener('click', () => this.toggleFormat());
    this.llVal = llVal;
    const [mgrsCell, , mgrsVal] = cell('ua-ms-mgrs', 'MGRS');
    this.mgrsVal = mgrsVal;
    const [elevCell, elevCap, elevVal] = cell('ua-ms-elev', 'Cota');
    this.elevVal = elevVal;
    this.elevCap = elevCap;
    const [rangeCell, , rangeVal] = cell('ua-ms-range', 'Desde batería');
    this.rangeCell = rangeCell;
    this.distVal = el('span', 'ua-ms-dist');
    this.azVal = el('span', 'ua-ms-az');
    this.stateEl = el('span', 'ua-ms-state');
    rangeVal.append(this.distVal, this.azVal, this.stateEl);
    const [qeCell, , qeVal] = cell('ua-ms-qe', 'QE estimada');
    this.qeCell = qeCell;
    this.qeVal = qeVal;
    qeCell.title = 'Interpolada de la tabla de tiro vigente (arma, carga y meteo actuales)';
    this.idleCells = [llCell, mgrsCell, elevCell, rangeCell];

    this.el.appendChild(el('div', 'ua-ms-spacer'));

    this.scaleCell = el('div', 'ua-ms-cell ua-ms-scale');
    this.scaleBar = el('div', 'ua-ms-scalebar');
    this.scaleVal = el('span', 'ua-ms-val');
    this.scaleCell.append(this.scaleVal, this.scaleBar);
    this.el.appendChild(this.scaleCell);

    this.credits = el('div', 'ua-ms-credits');
    this.el.appendChild(this.credits);

    parent.appendChild(this.el);
    this.update(null);
  }

  /** Adopta el contenedor de créditos de Cesium (sigue vivo y visible). */
  adoptCredits(container: Element): void {
    this.credits.appendChild(container);
  }

  private toggleFormat(): void {
    this.coordFormat = this.coordFormat === 'dec' ? 'dms' : 'dec';
    try { localStorage.setItem(LL_FMT_KEY, this.coordFormat); } catch { /* idem */ }
    this.update(this.last);
  }

  get format(): CoordFormat {
    return this.coordFormat;
  }

  /** null = cursor fuera del globo (los campos quedan en reposo). */
  update(r: CursorReadout | null): void {
    this.last = r;
    for (const c of this.idleCells) c.classList.toggle('is-idle', !r);
    if (!r) {
      this.llVal.textContent = '— cursor fuera del mapa —';
      this.mgrsVal.textContent = '—';
      this.elevVal.textContent = '—';
      this.distVal.textContent = '—';
      this.azVal.textContent = '';
      this.stateEl.dataset.state = 'unknown';
      this.rangeCell.dataset.state = 'unknown';
      this.qeCell.style.display = 'none';
      return;
    }
    this.llVal.textContent = `${formatLat(r.latDeg, this.coordFormat)}  ${formatLon(r.lonDeg, this.coordFormat)}`;
    this.mgrsVal.textContent = r.mgrs ? formatMgrs(r.mgrs) : '—';
    this.elevCap.textContent = r.heightIsMsl ? 'Cota (MSL)' : 'Altura elip.';
    this.elevVal.textContent = r.heightM === null ? '—' : formatHeight(r.heightM);
    this.distVal.textContent = formatDistance(r.rangeM);
    this.azVal.innerHTML =
      ` · ${formatMils(r.bearingDeg)}<span class="u">mil</span>` +
      `<span class="sec">${formatAzDeg(r.bearingDeg)}</span>`;
    this.stateEl.dataset.state = r.rangeState;
    this.rangeCell.dataset.state = r.rangeState;
    this.stateEl.textContent =
      r.rangeState === 'in' ? 'En alcance' : r.rangeState === 'out' ? 'Fuera' : r.rangeState === 'min' ? 'Bajo mín.' : '';
    if (r.qe && r.rangeState === 'in') {
      const parts: string[] = [];
      if (r.qe.lowDeg !== null) parts.push(`${formatElevMils(r.qe.lowDeg)}<span class="u">mil</span>`);
      if (r.qe.highDeg !== null) parts.push(`${formatElevMils(r.qe.highDeg)}<span class="u">mil alta</span>`);
      this.qeVal.innerHTML = parts.join(' · ');
      this.qeCell.style.display = parts.length ? '' : 'none';
    } else {
      this.qeCell.style.display = 'none';
    }
  }

  updateScale(s: ScaleBar | null): void {
    if (!s) {
      this.scaleCell.style.visibility = 'hidden';
      return;
    }
    this.scaleCell.style.visibility = '';
    this.scaleBar.style.width = `${s.px.toFixed(1)}px`;
    this.scaleVal.textContent = s.label;
  }
}
