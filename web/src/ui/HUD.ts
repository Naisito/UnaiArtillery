// ============================================================================
//  HUD.ts — Telemetría de vuelo: tira de instrumentos.  [P4.1 · V2]
//
//  Abajo-centro del área de mapa, por encima de la franja de estado del
//  agente MAP. En vuelo: TOF, Mach (resaltado en supersónico), altitud,
//  velocidad, energía cinética y arrastre, barra de progreso de alcance y
//  perfil de altitud con el punto de progreso. Al terminar se pliega a una
//  línea "ÚLTIMO VUELO" con los controles de repetición (cámara + ×0.25).
//
//  Rendimiento: el DOM se toca a ≤ 15 Hz y solo con valores que cambian
//  (textContent, nunca innerHTML por frame).
// ============================================================================
import { FlightResult } from '../ballistics';
import { Telemetry } from '../ProjectilePresenter';
import { Segmented, button } from './components';
import { h, setAttr, setText } from './dom';
import { icon } from './icons';
import { distanceParts, fmtNum } from './units';

type ReplayCam = 'follow' | 'cabin' | 'drone';
const MIN_DT_MS = 1000 / 15;
const DPR = 2;

interface Cell { root: HTMLElement; v: HTMLElement; u: HTMLElement }

export class HUD {
  /** P-VIVO.10 — "Repetir" el último vuelo (main lo conecta a la pieza). */
  onReplay?: (camera: ReplayCam, slow: boolean) => void;

  private readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly roundEl: HTMLElement;
  private readonly cells: Record<'tof' | 'mach' | 'alt' | 'speed' | 'energy' | 'drag', Cell>;
  private readonly machTag: HTMLElement;
  private readonly rangeText: HTMLElement;
  private readonly rangeFill: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly camSeg: Segmented<ReplayCam>;
  private readonly slowBtn: HTMLButtonElement;
  private flight: FlightResult | null = null;
  private roundLabel = '';
  private state: 'hidden' | 'active' | 'ended' = 'hidden';
  private lastPaint = 0;
  private lastTel: Telemetry | null = null;
  private profileKey = '';
  private profileBase: ImageData | null = null;

  constructor() {
    this.el = document.getElementById('telemetry') ?? document.body.appendChild(h('div', { id: 'telemetry' }));
    this.el.textContent = '';
    this.el.classList.add('tel');
    this.el.dataset.testid = 'telemetry';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Telemetría de vuelo');

    this.titleEl = h('span', { class: 'tel-title', text: 'En vuelo' });
    this.roundEl = h('span', { class: 'tel-round' });
    const cell = (label: string, gloss?: string): Cell => {
      const v = h('span', { class: 'tel-cell__v num', text: '—' });
      const u = h('span', { class: 'tel-cell__u' });
      const lab = h('span', { class: 'tel-cell__k', text: label });
      if (gloss) lab.dataset.gloss = gloss;
      const root = h('div', { class: 'tel-cell' }, lab, h('span', { class: 'tel-cell__line' }, v, u));
      return { root, v, u };
    };
    this.cells = {
      tof: cell('TOF', 'tof'),
      mach: cell('Mach', 'mach'),
      alt: cell('Altitud'),
      speed: cell('Velocidad'),
      energy: cell('E. cinética'),
      drag: cell('Arrastre', 'arrastre'),
    };
    this.cells.tof.v.dataset.testid = 'tel-tof';
    this.machTag = h('span', { class: 'tel-tag', text: 'Supersónico' });
    this.machTag.hidden = true;
    this.cells.mach.root.appendChild(this.machTag);

    this.rangeText = h('span', { class: 'tel-range__t num' });
    this.rangeFill = h('span', { class: 'tel-range__fill' });
    this.canvas = document.createElement('canvas');
    this.canvas.width = 300 * DPR;
    this.canvas.height = 44 * DPR;
    this.canvas.className = 'tel-profile';

    // P-VIVO.10 — repetición: cámara + ×0.25 (bullet-time sostenido).
    this.camSeg = new Segmented<ReplayCam>([
      { value: 'follow', icon: 'camFollow', title: 'Repetir siguiendo al proyectil', testid: 'replay-follow' },
      { value: 'cabin', icon: 'camCabin', title: 'Repetir desde la vista del artillero', testid: 'replay-cabin' },
      { value: 'drone', icon: 'camDrone', title: 'Repetir desde el dron', testid: 'replay-drone' },
    ], 'follow', { ariaLabel: 'Cámara de la repetición', iconOnly: true, size: 's' });
    this.slowBtn = button({ label: '×0.25', size: 's', variant: 'ghost', testid: 'replay-slow', title: 'Toda la repetición a cámara lenta' });
    this.slowBtn.setAttribute('aria-pressed', 'false');
    this.slowBtn.addEventListener('click', () => {
      const on = this.slowBtn.getAttribute('aria-pressed') !== 'true';
      this.slowBtn.setAttribute('aria-pressed', String(on));
    });
    const replay = button({
      label: 'Repetir', icon: 'replay', size: 's', testid: 'replay',
      title: 'Re-reproduce el último vuelo (mismo camino, sin cráter nuevo)',
      onClick: () => this.onReplay?.(this.camSeg.value, this.slowBtn.getAttribute('aria-pressed') === 'true'),
    });

    this.el.append(
      h('header', { class: 'tel-head' },
        h('span', { class: 'tel-live' }),
        h('span', { class: 'tel-head__titles' }, this.titleEl, this.roundEl),
        h('span', { class: 'tel-grow' }),
        h('div', { class: 'tel-replay' }, this.camSeg.el, this.slowBtn, replay),
      ),
      h('div', { class: 'tel-body' },
        h('div', { class: 'tel-cells' }, ...Object.values(this.cells).map((c) => c.root)),
        h('div', { class: 'tel-track' },
          h('div', { class: 'tel-range' },
            h('span', { class: 'tel-cell__k' }, icon('range', 14), 'Alcance'),
            this.rangeText,
            h('span', { class: 'tel-range__bar' }, this.rangeFill),
          ),
          this.canvas,
        ),
      ),
    );
    this.setState('hidden');
  }

  private setState(s: 'hidden' | 'active' | 'ended'): void {
    if (s === this.state && this.el.dataset.state === s) return;
    this.state = s;
    this.el.dataset.state = s;
    this.el.hidden = s === 'hidden';
    document.body.classList.toggle('tel-active', s === 'active');
    document.body.classList.toggle('tel-ended', s === 'ended');
  }

  /** Nombre de la munición para la cabecera (lo da main al disparar). */
  setRoundLabel(label: string): void { this.roundLabel = label; }

  show(flight: FlightResult): void {
    this.flight = flight;
    this.lastTel = null;
    this.profileKey = '';
    setText(this.titleEl, 'En vuelo');
    setText(this.roundEl, this.roundLabel);
    this.setState('active');
  }

  /** Fin de los vuelos: se pliega a la línea de "último vuelo". */
  hide(): void {
    if (this.state !== 'active') return;
    if (this.lastTel && this.flight) {
      this.paint(this.lastTel, true);
      const d = distanceParts(this.flight.downrange);
      setText(this.titleEl, 'Último vuelo');
      setText(this.roundEl, `${d.value} ${d.unit} · TOF ${this.flight.timeOfFlight.toFixed(1)} s`);
      this.setState('ended');
    } else {
      this.setState('hidden');
    }
  }

  /** Batería movida / sesión nueva: fuera del todo. */
  reset(): void {
    this.flight = null;
    this.lastTel = null;
    this.setState('hidden');
  }

  update(tel: Telemetry | null): void {
    if (!tel || !this.flight) return;
    this.lastTel = tel;
    if (this.state !== 'active') this.setState('active');
    const now = performance.now();
    if (now - this.lastPaint < MIN_DT_MS) return;
    this.lastPaint = now;
    this.paint(tel, false);
  }

  private paint(tel: Telemetry, final: boolean): void {
    const c = this.cells;
    setText(c.tof.v, tel.t.toFixed(1));
    setText(c.tof.u, 's');
    setText(c.mach.v, tel.mach.toFixed(2));
    const sup = tel.mach >= 1.0;
    c.mach.root.classList.toggle('is-super', sup);
    this.machTag.hidden = !sup;
    const alt = distanceParts(tel.altitudeM);
    setText(c.alt.v, tel.altitudeM >= 1000 ? (tel.altitudeM / 1000).toFixed(tel.altitudeM >= 10000 ? 1 : 2) : fmtNum(tel.altitudeM, 0));
    setText(c.alt.u, alt.unit);
    setText(c.speed.v, fmtNum(tel.speedMS, 0));
    setText(c.speed.u, 'm/s');
    if (tel.kineticMJ >= 0.1) {
      setText(c.energy.v, tel.kineticMJ.toFixed(tel.kineticMJ >= 100 ? 0 : 1));
      setText(c.energy.u, 'MJ');
    } else {
      setText(c.energy.v, fmtNum(tel.kineticMJ * 1e6, 0));
      setText(c.energy.u, 'J');
    }
    if (tel.dragN >= 1000) {
      setText(c.drag.v, (tel.dragN / 1000).toFixed(1));
      setText(c.drag.u, 'kN');
    } else {
      setText(c.drag.v, fmtNum(tel.dragN, tel.dragN < 10 ? 1 : 0));
      setText(c.drag.u, 'N');
    }
    const total = Math.max(1, tel.totalRangeM);
    const done = final ? total : tel.downrangeM;
    const a = distanceParts(done);
    const b = distanceParts(total);
    setText(this.rangeText, `${a.value} ${a.unit === b.unit ? '' : a.unit} / ${b.value} ${b.unit}`.replace('  ', ' '));
    const pct = Math.min(100, Math.max(0, (done / total) * 100));
    this.rangeFill.style.width = `${pct.toFixed(1)}%`;
    setAttr(this.rangeFill, 'data-pct', pct.toFixed(0));
    this.drawProfile(final ? Number.POSITIVE_INFINITY : tel.t, tel.altitudeM);
  }

  /** Perfil de altitud del tiro (se pinta una vez por vuelo) + punto. */
  private drawProfile(t: number, altM: number): void {
    const ctx = this.canvas.getContext('2d');
    const f = this.flight;
    if (!ctx || !f) return;
    const { width: W, height: H } = this.canvas;
    const path = f.path;
    if (path.length < 2) return;
    const tMax = path[path.length - 1].t || 1;
    let zMax = 1;
    for (const p of path) zMax = Math.max(zMax, p.position.z);
    const X = (tt: number) => (Math.min(tt, tMax) / tMax) * (W - 10 * DPR) + 5 * DPR;
    const Y = (z: number) => H - 5 * DPR - (Math.max(0, z) / zMax) * (H - 12 * DPR);

    const key = `${path.length}|${tMax}|${zMax}`;
    if (key !== this.profileKey || !this.profileBase) {
      this.profileKey = key;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(148,163,184,0.16)';
      ctx.lineWidth = DPR;
      ctx.beginPath();
      ctx.moveTo(0, H - 5 * DPR);
      ctx.lineTo(W, H - 5 * DPR);
      ctx.stroke();
      const step = Math.max(1, Math.floor(path.length / 240));
      ctx.beginPath();
      for (let i = 0; i < path.length; i += step) {
        const x = X(path[i].t);
        const y = Y(path[i].position.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.lineWidth = 1.6 * DPR;
      ctx.setLineDash([3 * DPR, 3 * DPR]);
      ctx.stroke();
      ctx.setLineDash([]);
      this.profileBase = ctx.getImageData(0, 0, W, H);
    } else {
      ctx.putImageData(this.profileBase, 0, 0);
    }
    // Tramo recorrido (sólido) + punto de progreso.
    const step = Math.max(1, Math.floor(path.length / 240));
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < path.length && path[i].t <= t; i += step) {
      const x = X(path[i].t);
      const y = Y(path[i].position.z);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    const tt = Math.min(t, tMax);
    if (started) {
      ctx.lineTo(X(tt), Y(Number.isFinite(t) ? altM : path[path.length - 1].position.z));
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8 * DPR;
      ctx.stroke();
    }
    const px = X(tt);
    const py = Y(Number.isFinite(t) ? altM : path[path.length - 1].position.z);
    ctx.fillStyle = '#f5a524';
    ctx.shadowColor = 'rgba(245,165,36,0.8)';
    ctx.shadowBlur = 6 * DPR;
    ctx.beginPath();
    ctx.arc(px, py, 3.4 * DPR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
