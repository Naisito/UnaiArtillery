// ============================================================================
//  FiringTablePanel.ts — Pestaña TABLA DE TIRO.  [P-PRO.5 · rediseño V2]
//
//  Para el arma/munición/carga/meteo ACTUALES tabula alcance → QE de rama
//  baja y alta (en la unidad angular del usuario), TOF y deriva (giro +
//  Coriolis + viento). Clic en una fila = apuntar ahí con el azimut vigente
//  y la rama preferida. La fila más próxima al alcance del preview queda
//  resaltada (y se desplaza a la vista). Solo calcula con la pestaña visible;
//  el cálculo corre en el worker y CSV descarga la tabla completa.
// ============================================================================
import { FiringTable, FiringTableRow, firingTableCSV } from '../ballistics';
import { BallisticsService, SupersededError } from '../BallisticsService';
import { button, chip, setChip } from './components';
import { chargeLong, ControlPanel } from './ControlPanel';
import { h, setText } from './dom';
import { RightDock } from './RightDock';
import { settings } from './settings';
import { toast } from './toast';
import { UNIT_SUFFIX, fmtAngleValue, fmtNum } from './units';

export class FiringTablePanel {
  private readonly headEl: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly stateChip: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly scrollEl: HTMLElement;
  private readonly csvBtn: HTMLButtonElement;

  private open = false;
  private dirty = true;
  private table: FiringTable | null = null;
  private previewRangeM: number | null = null;
  private fetchSeq = 0;

  constructor(
    private readonly service: BallisticsService,
    private readonly panel: ControlPanel,
    private readonly schedulePreview: () => void,
    host: HTMLElement,
  ) {
    host.textContent = '';
    this.csvBtn = button({
      label: 'CSV', icon: 'download', size: 's', testid: 'table-csv',
      title: 'Descargar la tabla completa como CSV', onClick: () => this.downloadCSV(),
    });
    this.stateChip = chip('—', 'muted');
    this.headEl = h('div', { class: 'ft-title' });
    this.metaEl = h('div', { class: 'ft-meta' });
    this.statusEl = h('p', { class: 'met-note' });
    this.scrollEl = h('div', { class: 'ft-scroll', testid: 'firing-table' });
    host.append(
      RightDock.header('Tabla de tiro', this.stateChip, this.csvBtn),
      h('div', { class: 'rpanel-body ft-body' },
        h('div', { class: 'ft-card' }, this.headEl, this.metaEl),
        this.scrollEl,
        this.statusEl,
      ),
    );
    settings.subscribe((_s, changed) => {
      if (changed.includes('angleUnit') && this.table) this.render();
    });
  }

  /** La pestaña se ve / deja de verse: solo se calcula a la vista. */
  setVisible(visible: boolean): void {
    this.open = visible;
    if (visible && this.dirty) void this.refresh();
  }

  /** El alcance del preview vigente (resalta la fila más próxima). */
  setPreviewRange(rangeM: number): void {
    this.previewRangeM = rangeM;
    if (this.open && this.table) this.highlight(true);
  }

  /** La rama preferida cambió: resalta su columna. */
  onBranchChanged(): void {
    if (!this.table) return;
    this.render();
    this.highlight(false);
  }

  /** Cambió arma/munición/carga/meteo/batería: re-pide (la caché abarata). */
  notifyChanged(): void {
    this.dirty = true;
    if (this.open) void this.refresh();
  }

  private async refresh(): Promise<void> {
    const seq = ++this.fetchSeq;
    this.dirty = false;
    setChip(this.stateChip, 'Calculando', 'info');
    this.csvBtn.disabled = true;
    if (!this.table) {
      setText(this.headEl, 'Calculando la tabla de tiro…');
      setText(this.statusEl, 'El núcleo balístico integra cada alcance con la meteo vigente (en segundo plano).');
    }
    try {
      const id = this.panel.weaponId;
      const charge = this.panel.chargeIndex;
      const ring = await this.service.approxMaxRange(id, charge);
      // Paso: máx(500 m, alcanceMáx/25), redondeado a 100 m para leerse bien.
      const stepM = Math.round(Math.max(500, ring.maxRangeM / 25) / 100) * 100;
      const table = await this.service.generateFiringTable(id, charge, stepM);
      if (seq !== this.fetchSeq) return; // llegó otra petición más nueva
      if (this.table !== table) {
        this.table = table;
        this.render();
      }
      setChip(this.stateChip, 'Vigente', 'ok');
      setText(this.statusEl,
        `Paso ${fmtNum(stepM)} m · deriva = giro + Coriolis + viento actual (+ derecha). ` +
        'Clic en una fila para apuntar con la rama elegida.');
      this.csvBtn.disabled = false;
      this.highlight(true);
    } catch (err) {
      if ((err as Error)?.name === 'SupersededError' || err instanceof SupersededError) return;
      console.error('[firing-table]', err);
      if (seq === this.fetchSeq) {
        setChip(this.stateChip, 'Error', 'danger');
        setText(this.statusEl, 'No se pudo calcular la tabla.');
        this.csvBtn.disabled = this.table === null;
      }
    }
  }

  private render(): void {
    const t = this.table;
    this.scrollEl.textContent = '';
    if (!t) return;
    const unit = settings.angleUnit;
    const suf = UNIT_SUFFIX[unit];
    setText(this.headEl, t.weaponName);
    this.metaEl.textContent = '';
    const meta = (k: string, v: string) => h('span', { class: 'ft-meta__item' }, h('span', { class: 'ua-eyebrow', text: k }), h('span', { class: 'num', text: v }));
    this.metaEl.append(
      meta('Carga', chargeLong(t.chargeName)),
      meta('V0', `${t.muzzleVelocity.toFixed(0)} m/s`),
      meta('Alcance máx.', `${(t.maxRangeM / 1000).toFixed(1)} km`),
    );

    const high = this.panel.preferHighAngle;
    const tbl = h('table', { class: 'ft-table' });
    const thead = h('thead', null, h('tr', null,
      h('th', { text: 'Alcance' }),
      h('th', { class: high ? '' : 'is-branch', text: `QE baja` }),
      h('th', { class: high ? 'is-branch' : '', text: `QE alta` }),
      h('th', { text: 'TOF' }),
      h('th', { text: 'Deriva' }),
    ));
    const unitRow = h('tr', { class: 'ft-units' },
      h('th', { text: 'km' }), h('th', { text: suf }), h('th', { text: suf }), h('th', { text: 's' }), h('th', { text: 'm' }),
    );
    thead.appendChild(unitRow);
    tbl.appendChild(thead);
    const tbody = h('tbody');
    const ang = (v: number | null) => (v === null ? '—' : fmtAngleValue(v, unit, unit === 'mil' ? 0 : 2).replace(' ', ''));
    for (const row of t.rows) {
      const tof = row.tofLowS ?? row.tofHighS;
      const drift = row.driftLowM ?? row.driftHighM;
      const tr = h('tr', { dataset: { rangeM: String(row.rangeM) } },
        h('td', { text: (row.rangeM / 1000).toFixed(1) }),
        h('td', { class: high ? '' : 'is-branch', text: ang(row.qeLowDeg) }),
        h('td', { class: high ? 'is-branch' : '', text: ang(row.qeHighDeg) }),
        h('td', { text: tof === null ? '—' : tof.toFixed(1) }),
        h('td', { text: drift === null ? '—' : `${drift >= 0 ? '+' : '−'}${Math.abs(drift).toFixed(0)}` }),
      );
      if (row.qeLowDeg !== null || row.qeHighDeg !== null) {
        tr.classList.add('aimable');
        tr.tabIndex = 0;
        tr.title = 'Apuntar a este alcance con el azimut actual';
        const aim = () => {
          // La QE se decide AL CLICAR, no al renderizar: manda la rama vigente.
          const qe = this.rowQE(row);
          if (qe === null) return;
          this.panel.setAim(this.panel.azimuthDeg, qe);
          this.schedulePreview();
        };
        tr.addEventListener('click', aim);
        tr.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            aim();
          }
        });
      }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    this.scrollEl.appendChild(tbl);
  }

  /** QE de la fila según la rama preferida en el panel (con fallback). */
  private rowQE(row: FiringTableRow): number | null {
    return this.panel.preferHighAngle
      ? row.qeHighDeg ?? row.qeLowDeg
      : row.qeLowDeg ?? row.qeHighDeg;
  }

  private highlight(scroll: boolean): void {
    if (!this.table || this.previewRangeM === null) return;
    let best: HTMLTableRowElement | null = null;
    let bestErr = Number.POSITIVE_INFINITY;
    for (const tr of this.scrollEl.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      tr.classList.remove('current');
      const err = Math.abs(Number(tr.dataset.rangeM) - this.previewRangeM);
      if (err < bestErr) { bestErr = err; best = tr; }
    }
    if (best) {
      best.classList.add('current');
      if (scroll) best.scrollIntoView({ block: 'nearest' });
    }
  }

  private downloadCSV(): void {
    if (!this.table) return;
    const blob = new Blob([firingTableCSV(this.table)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tabla_${this.table.weaponName.replace(/\W+/g, '_')}_${this.table.chargeName.replace(/\W+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Tabla de tiro descargada (CSV)', { level: 'success' });
  }
}
