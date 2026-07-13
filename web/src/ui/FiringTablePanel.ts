// ============================================================================
//  FiringTablePanel.ts — Tabla de tiro interactiva.  [P-PRO.5]
//
//  La clase de dirección de tiro: para el arma/carga/meteo ACTUALES, tabula
//  alcance → QE baja/alta, TOF y deriva. Clic en una fila = apuntar ahí
//  (setAim con el azimut vigente + preview). La fila más próxima al alcance
//  del preview vigente queda resaltada. El cálculo corre en el worker: el
//  globo sigue fluido y mientras tanto se lee "calculando…". Botón CSV
//  descarga la tabla completa (firingTableCSV).
// ============================================================================
import { FiringTable, FiringTableRow, firingTableCSV } from '../ballistics';
import { BallisticsService, SupersededError } from '../BallisticsService';
import { ControlPanel } from './ControlPanel';
import { toast } from './toast';

export class FiringTablePanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly scrollEl: HTMLElement;
  private readonly csvBtn: HTMLButtonElement;
  private readonly toggleBtn: HTMLButtonElement;

  private open = false;
  private table: FiringTable | null = null;
  private previewRangeM: number | null = null;
  private fetchSeq = 0;

  constructor(
    private readonly service: BallisticsService,
    private readonly panel: ControlPanel,
    private readonly schedulePreview: () => void,
  ) {
    this.root = document.createElement('aside');
    this.root.id = 'firingTable';
    this.root.className = 'panel';
    document.body.appendChild(this.root);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'wide';
    this.toggleBtn.textContent = '📋 Tabla de tiro';
    this.toggleBtn.title = 'Alcance → QE baja/alta, TOF y deriva con la meteo actual';
    this.toggleBtn.onclick = () => this.setOpen(!this.open);
    this.root.appendChild(this.toggleBtn);

    this.body = document.createElement('div');
    this.body.className = 'ft-body';
    this.body.hidden = true;

    this.headEl = document.createElement('div');
    this.headEl.className = 'ft-head';

    this.csvBtn = document.createElement('button');
    this.csvBtn.textContent = 'CSV';
    this.csvBtn.title = 'Descargar la tabla completa como CSV';
    this.csvBtn.onclick = () => this.downloadCSV();

    const headRow = document.createElement('div');
    headRow.className = 'row';
    headRow.append(this.headEl, this.csvBtn);
    this.body.appendChild(headRow);

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'hint';
    this.body.appendChild(this.statusEl);

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'ft-scroll';
    this.body.appendChild(this.scrollEl);

    this.root.appendChild(this.body);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.body.hidden = !open;
    this.toggleBtn.classList.toggle('toggled', open);
    if (open) void this.refresh();
  }

  /** El alcance del preview vigente (resalta la fila más próxima). */
  setPreviewRange(rangeM: number): void {
    this.previewRangeM = rangeM;
    if (this.open && this.table) this.highlight();
  }

  /** Cambió arma/munición/carga/meteo/batería: re-pide (la caché abarata). */
  notifyChanged(): void {
    if (this.open) void this.refresh();
  }

  private async refresh(): Promise<void> {
    const seq = ++this.fetchSeq;
    this.statusEl.textContent = 'calculando…';
    this.csvBtn.disabled = true;
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
      this.statusEl.textContent =
        `Paso ${stepM} m · deriva = spin + Coriolis + viento actual. Clic en una fila para apuntar.`;
      this.csvBtn.disabled = false;
      this.highlight();
    } catch (err) {
      if ((err as Error)?.name === 'SupersededError' || err instanceof SupersededError) return;
      console.error('[firing-table]', err);
      if (seq === this.fetchSeq) {
        this.statusEl.textContent = 'No se pudo calcular la tabla.';
        // La tabla anterior sigue renderizada: su CSV sigue siendo válido.
        this.csvBtn.disabled = this.table === null;
      }
    }
  }

  private render(): void {
    const t = this.table;
    this.scrollEl.innerHTML = '';
    if (!t) return;
    this.headEl.textContent =
      `${t.weaponName} · ${t.chargeName} · V0 ${t.muzzleVelocity.toFixed(0)} m/s · ` +
      `máx ${(t.maxRangeM / 1000).toFixed(1)} km`;

    const tbl = document.createElement('table');
    tbl.className = 'ft-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const h of ['Alcance', 'QE↓', 'QE↑', 'TOF', 'Deriva']) {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    const fmt = (v: number | null, digits: number, unit = ''): string =>
      v === null ? '—' : `${v.toFixed(digits)}${unit}`;
    for (const row of t.rows) {
      const tr = document.createElement('tr');
      tr.dataset.rangeM = String(row.rangeM);
      const tof = row.tofLowS ?? row.tofHighS;
      const drift = row.driftLowM ?? row.driftHighM;
      for (const cell of [
        `${(row.rangeM / 1000).toFixed(1)} km`,
        fmt(row.qeLowDeg, 1, 'º'),
        fmt(row.qeHighDeg, 1, 'º'),
        fmt(tof, 1, ' s'),
        fmt(drift, 0, ' m'),
      ]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      if (row.qeLowDeg !== null || row.qeHighDeg !== null) {
        tr.classList.add('aimable');
        tr.title = 'Apuntar a este alcance (rama según "Rama alta") al azimut actual';
        tr.onclick = () => {
          // La QE se decide AL CLICAR, no al renderizar: si el usuario cambió
          // "Rama alta" con la tabla abierta, manda la preferencia vigente.
          const qe = this.rowQE(row);
          if (qe === null) return;
          this.panel.setAim(this.panel.azimuthDeg, qe);
          this.schedulePreview();
        };
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

  private highlight(): void {
    if (!this.table || this.previewRangeM === null) return;
    let best: HTMLTableRowElement | null = null;
    let bestErr = Number.POSITIVE_INFINITY;
    for (const tr of this.scrollEl.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      tr.classList.remove('current');
      const err = Math.abs(Number(tr.dataset.rangeM) - this.previewRangeM);
      if (err < bestErr) { bestErr = err; best = tr; }
    }
    best?.classList.add('current');
  }

  private downloadCSV(): void {
    if (!this.table) return;
    const blob = new Blob([firingTableCSV(this.table)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tabla_${this.table.weaponName.replace(/\W+/g, '_')}_${this.table.chargeName.replace(/\W+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Tabla de tiro descargada (CSV)');
  }
}
