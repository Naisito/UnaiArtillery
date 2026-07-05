// ============================================================================
//  HUD.ts — Telemetría en vivo del proyectil activo.  [P4.1 / P-WEB.7]
//
//  Mach, altitud, velocidad, energía cinética, arrastre instantáneo, TOF y
//  alcance, actualizados cada frame, más el perfil de altitud del tiro con el
//  punto de progreso — la "gráfica simple" del brief.
// ============================================================================
import { FlightResult } from '../ballistics';
import { Telemetry } from '../ProjectilePresenter';

const CELLS: { key: keyof CellMap; label: string }[] = [
  { key: 'tof', label: 'TOF' },
  { key: 'mach', label: 'Mach' },
  { key: 'alt', label: 'Altitud' },
  { key: 'speed', label: 'Velocidad' },
  { key: 'energy', label: 'E. cinética' },
  { key: 'drag', label: 'Arrastre' },
  { key: 'range', label: 'Alcance' },
];

interface CellMap {
  tof: HTMLElement; mach: HTMLElement; alt: HTMLElement; speed: HTMLElement;
  energy: HTMLElement; drag: HTMLElement; range: HTMLElement;
}

export class HUD {
  private readonly el = document.getElementById('hud')!;
  private cells = {} as CellMap;
  private canvas!: HTMLCanvasElement;
  private flight: FlightResult | null = null;

  constructor() {
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const c of CELLS) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = c.label;
      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = '—';
      cell.append(k, v);
      grid.appendChild(cell);
      this.cells[c.key] = v;
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 72;
    this.el.append(grid, this.canvas);
  }

  show(flight: FlightResult): void {
    this.flight = flight;
    this.el.classList.add('active');
  }

  hide(): void {
    this.el.classList.remove('active');
    this.flight = null;
  }

  update(tel: Telemetry | null): void {
    if (!tel || !this.flight) return;
    this.cells.tof.textContent = `${tel.t.toFixed(1)} s`;
    this.cells.mach.textContent = tel.mach.toFixed(2);
    this.cells.mach.classList.toggle('mach-super', tel.mach >= 1.0);
    this.cells.alt.textContent =
      tel.altitudeM >= 10000 ? `${(tel.altitudeM / 1000).toFixed(1)} km` : `${tel.altitudeM.toFixed(0)} m`;
    this.cells.speed.textContent = `${tel.speedMS.toFixed(0)} m/s`;
    this.cells.energy.textContent = `${tel.kineticMJ.toFixed(1)} MJ`;
    this.cells.drag.textContent =
      tel.dragN >= 1000 ? `${(tel.dragN / 1000).toFixed(1)} kN` : `${tel.dragN.toFixed(0)} N`;
    this.cells.range.textContent =
      `${(tel.downrangeM / 1000).toFixed(1)} / ${(tel.totalRangeM / 1000).toFixed(1)} km`;
    this.drawProfile(tel);
  }

  private drawProfile(tel: Telemetry): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.flight) return;
    const { width: W, height: H } = this.canvas;
    ctx.clearRect(0, 0, W, H);

    const path = this.flight.path;
    if (path.length < 2) return;
    const tMax = path[path.length - 1].t || 1;
    let zMax = 1;
    for (const p of path) zMax = Math.max(zMax, p.position.z);

    ctx.strokeStyle = 'rgba(77,195,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(path.length / 220));
    for (let i = 0; i < path.length; i += step) {
      const x = (path[i].t / tMax) * (W - 8) + 4;
      const y = H - 6 - (path[i].position.z / zMax) * (H - 14);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Punto de progreso.
    const x = (tel.t / tMax) * (W - 8) + 4;
    const y = H - 6 - (tel.altitudeM / zMax) * (H - 14);
    ctx.fillStyle = '#ffb545';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
