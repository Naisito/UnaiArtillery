// ============================================================================
//  Cockpit.ts — Instrumentos de puntería fina.  [P-NEXT.1 · rediseño V2]
//
//  Dos instrumentos en canvas dentro del paso 4 (Solución de tiro):
//    * ROSA DE AZIMUT — escala en la unidad principal (mil OTAN o grados),
//      cardinales, aguja ámbar, marca cian de la demora al objetivo y
//      lectura numérica central.
//    * CUADRANTE DE ELEVACIÓN — arco 0–1600 mil (0–90°) con la envolvente
//      del arma en cian, la frontera de rama alta (800 mil) punteada y la
//      aguja de QE.
//
//  Posar el cursor encima y girar la RUEDA ajusta el valor: en milésimas
//  10 mil (Shift 1 mil, Ctrl 100 mil); en grados 0.5° (Shift 0.05°, Ctrl 5°)
//  — el comportamiento clásico. Arrastrar también apunta (con dos dedos,
//  ajuste fino relativo). Sincronía bidireccional con ControlPanel: render()
//  por frame solo repinta si algo cambió.
// ============================================================================
import { ControlPanel } from './ControlPanel';
import { settings } from './settings';
import { AngleUnit, fmtAngleValue, layStepDeg, toUnit } from './units';

const COL = {
  well: 'rgba(5, 8, 12, 0.85)',
  wellEdge: 'rgba(148, 163, 184, 0.22)',
  tick: 'rgba(148, 163, 184, 0.28)',
  tickMajor: 'rgba(163, 175, 187, 0.75)',
  text: '#e8edf2',
  dim: '#6b7785',
  dim2: '#a3afbb',
  accent: '#f5a524',
  info: '#38bdf8',
  infoBand: 'rgba(56, 189, 248, 0.32)',
  danger: '#ff4d4f',
};
const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, Consolas, monospace';
const FONT_DISPLAY = '"Barlow Condensed", "Inter Variable", sans-serif';

const W = 156;   // css px por instrumento
const H = 148;
const DPR = 2;

export class Cockpit {
  private azCanvas!: HTMLCanvasElement;
  private elCanvas!: HTMLCanvasElement;
  private lastKey = '';

  constructor(
    private readonly panel: ControlPanel,
    private readonly onAimChanged: () => void,
    host: HTMLElement = panel.instrumentsHost,
    /** Demora al objetivo (null si no hay) para la marca de la rosa. */
    private readonly targetBearingDeg: () => number | null = () => null,
  ) {
    host.textContent = '';
    this.azCanvas = this.makeInstrument(host, 'cockpit-az', 'Rosa de azimut: rueda para ajustar (Shift fino, Ctrl grueso) o arrastra');
    this.elCanvas = this.makeInstrument(host, 'cockpit-el', 'Cuadrante de elevación: rueda para ajustar (Shift fino, Ctrl grueso) o arrastra');
    this.bindAzimuth();
    this.bindElevation();
    this.render();
  }

  private makeInstrument(parent: HTMLElement, testid: string, title: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W * DPR;
    c.height = H * DPR;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    c.dataset.testid = testid;
    c.dataset.tip = title;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', title);
    parent.appendChild(c);
    return c;
  }

  // -- Entrada ----------------------------------------------------------------
  private applyAim(az: number, el: number): void {
    const w = this.panel.weapon();
    const clampedEl = Math.min(Math.max(el, w.minElevationDeg), w.maxElevationDeg);
    this.panel.setAim(az, clampedEl);
    this.onAimChanged();
    this.render();
  }

  private bindAzimuth(): void {
    const c = this.azCanvas;
    c.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault(); // Ctrl+rueda no debe hacer zoom del navegador
        const dir = ev.deltaY < 0 ? 1 : -1;
        const step = layStepDeg(settings.angleUnit, ev, 'wheel');
        this.applyAim(this.panel.azimuthDeg + dir * step, this.panel.elevationDeg);
      },
      { passive: false },
    );
    const aimFromPointer = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      if (dx * dx + dy * dy < 36) return; // demasiado cerca del pivote
      const az = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      this.applyAim(az, this.panel.elevationDeg);
    };
    // P-VIVO.11 — dos dedos = ajuste FINO relativo (el Shift del táctil).
    this.bindDrag(c, aimFromPointer, (dxPx) => {
      this.applyAim(this.panel.azimuthDeg + dxPx * 0.02, this.panel.elevationDeg);
    });
  }

  private bindElevation(): void {
    const c = this.elCanvas;
    c.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const dir = ev.deltaY < 0 ? 1 : -1;
        const step = layStepDeg(settings.angleUnit, ev, 'wheel');
        this.applyAim(this.panel.azimuthDeg, this.panel.elevationDeg + dir * step);
      },
      { passive: false },
    );
    const aimFromPointer = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const { px, py } = this.quadrantPivot();
      const dx = ev.clientX - (r.left + px / DPR);
      const dy = r.top + py / DPR - ev.clientY;
      if (dx * dx + dy * dy < 36) return;
      const el = (Math.atan2(dy, Math.max(1e-6, dx)) * 180) / Math.PI;
      this.applyAim(this.panel.azimuthDeg, el);
    };
    this.bindDrag(c, aimFromPointer, (_dxPx, dyPx) => {
      this.applyAim(this.panel.azimuthDeg, this.panel.elevationDeg - dyPx * 0.02);
    });
  }

  /**
   * Arrastre con Pointer Events (ratón Y dedo: setPointerCapture +
   * touch-action:none en CSS). Con DOS punteros el movimiento pasa a
   * `fineMove` (ajuste relativo suave, el "Shift" táctil).
   */
  private bindDrag(
    c: HTMLCanvasElement,
    move: (ev: PointerEvent) => void,
    fineMove?: (dxPx: number, dyPx: number) => void,
  ): void {
    const active = new Map<number, { x: number; y: number }>();
    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (active.size === 1) move(ev);
    });
    c.addEventListener('pointermove', (ev) => {
      const prev = active.get(ev.pointerId);
      if (!prev) return;
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (active.size >= 2) fineMove?.(dx, dy);
      else move(ev);
    });
    const stop = (ev: PointerEvent) => {
      active.delete(ev.pointerId);
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId);
    };
    c.addEventListener('pointerup', stop);
    c.addEventListener('pointercancel', stop);
  }

  // -- Pintado ------------------------------------------------------------------
  /** Llamar cada frame: solo repinta si la puntería, la envolvente, la
   *  unidad o la demora al objetivo cambiaron. */
  render(): void {
    const w = this.panel.weapon();
    const az = this.panel.azimuthDeg;
    const el = this.panel.elevationDeg;
    const unit = settings.angleUnit;
    const tb = this.targetBearingDeg();
    const key = `${az}|${el}|${w.minElevationDeg}|${w.maxElevationDeg}|${unit}|${tb ?? ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.drawAzimuth(az, unit, tb);
    this.drawElevation(el, w.minElevationDeg, w.maxElevationDeg, unit);
  }

  private drawAzimuth(azDeg: number, unit: AngleUnit, targetBearing: number | null): void {
    const ctx = this.azCanvas.getContext('2d')!;
    const S = W * DPR;
    const cx = S / 2;
    const cy = (H * DPR) / 2;
    const R = Math.min(S, H * DPR) / 2 - 4 * DPR;
    ctx.clearRect(0, 0, S, H * DPR);

    // Pozo con degradado radial.
    const g = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
    g.addColorStop(0, 'rgba(22, 30, 40, 0.95)');
    g.addColorStop(1, COL.well);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.wellEdge;
    ctx.lineWidth = DPR;
    ctx.stroke();

    // Escala: en mil, menores cada 100 y mayores cada 800; en grados, 5/45.
    const minor = unit === 'mil' ? 5.625 : 5;
    const majorEvery = unit === 'mil' ? 8 : 9; // nº de menores por mayor (45°)
    const n = Math.round(360 / minor);
    for (let i = 0; i < n; i++) {
      const a = i * minor;
      const rad = ((a - 90) * Math.PI) / 180;
      const major = i % majorEvery === 0;
      const mid = !major && i % (majorEvery / 2) === 0;
      const len = (major ? 9 : mid ? 6 : 3.5) * DPR;
      ctx.strokeStyle = major ? COL.tickMajor : COL.tick;
      ctx.lineWidth = (major ? 1.4 : 1) * DPR;
      ctx.beginPath();
      ctx.moveTo(cx + (R - 2 * DPR - len) * Math.cos(rad), cy + (R - 2 * DPR - len) * Math.sin(rad));
      ctx.lineTo(cx + (R - 2 * DPR) * Math.cos(rad), cy + (R - 2 * DPR) * Math.sin(rad));
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${10 * DPR}px ${FONT_DISPLAY}`;
    const rl = R - 18 * DPR;
    for (const [label, a] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]] as const) {
      const rad = ((a - 90) * Math.PI) / 180;
      ctx.fillStyle = label === 'N' ? COL.info : COL.dim2;
      ctx.fillText(label, cx + rl * Math.cos(rad), cy + rl * Math.sin(rad));
    }

    // Demora al objetivo: marca cian en el borde.
    if (targetBearing !== null) {
      const rad = ((targetBearing - 90) * Math.PI) / 180;
      const tip = R - 1 * DPR;
      ctx.fillStyle = COL.danger;
      ctx.beginPath();
      ctx.moveTo(cx + tip * Math.cos(rad), cy + tip * Math.sin(rad));
      const back = R - 9 * DPR;
      const side = 0.07;
      ctx.lineTo(cx + back * Math.cos(rad - side), cy + back * Math.sin(rad - side));
      ctx.lineTo(cx + back * Math.cos(rad + side), cy + back * Math.sin(rad + side));
      ctx.closePath();
      ctx.fill();
    }

    // Aguja con halo.
    const rad = ((azDeg - 90) * Math.PI) / 180;
    const tipR = R - 6 * DPR;
    ctx.save();
    ctx.shadowColor = 'rgba(245, 165, 36, 0.55)';
    ctx.shadowBlur = 8 * DPR;
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 2 * DPR;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 22 * DPR * Math.cos(rad), cy + 22 * DPR * Math.sin(rad));
    ctx.lineTo(cx + tipR * Math.cos(rad), cy + tipR * Math.sin(rad));
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    ctx.arc(cx + tipR * Math.cos(rad), cy + tipR * Math.sin(rad), 2.6 * DPR, 0, Math.PI * 2);
    ctx.fill();

    // Lectura central.
    ctx.fillStyle = 'rgba(5, 8, 12, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 21 * DPR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.wellEdge;
    ctx.lineWidth = DPR;
    ctx.stroke();
    ctx.fillStyle = COL.text;
    ctx.font = `500 ${12 * DPR}px ${FONT_MONO}`;
    ctx.fillText(fmtAngleValue(azDeg, unit, unit === 'mil' ? 0 : 1).replace(' ', ''), cx, cy + 1 * DPR);
    ctx.fillStyle = COL.dim;
    ctx.font = `600 ${7.5 * DPR}px ${FONT_DISPLAY}`;
    ctx.fillText(unit === 'mil' ? 'AZ · MIL' : 'AZ · GRAD', cx, cy - 11 * DPR);
  }

  /** Pivote del cuadrante (px de canvas): esquina inferior-izquierda. */
  private quadrantPivot(): { px: number; py: number; R: number } {
    const px = 14 * DPR;
    const py = H * DPR - 14 * DPR;
    const R = Math.min(W * DPR - px - 6 * DPR, py - 6 * DPR);
    return { px, py, R };
  }

  private drawElevation(elDeg: number, minDeg: number, maxDeg: number, unit: AngleUnit): void {
    const ctx = this.elCanvas.getContext('2d')!;
    const S = W * DPR;
    const { px, py, R } = this.quadrantPivot();
    ctx.clearRect(0, 0, S, H * DPR);
    const radOf = (deg: number) => (-deg * Math.PI) / 180; // 0°→derecha, + arriba

    // Pozo del cuadrante.
    const g = ctx.createRadialGradient(px, py, R * 0.1, px, py, R);
    g.addColorStop(0, 'rgba(22, 30, 40, 0.95)');
    g.addColorStop(1, COL.well);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, R, radOf(0), radOf(90), true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COL.wellEdge;
    ctx.lineWidth = DPR;
    ctx.stroke();

    // Envolvente del arma.
    ctx.strokeStyle = COL.infoBand;
    ctx.lineWidth = 6 * DPR;
    ctx.beginPath();
    ctx.arc(px, py, R - 6 * DPR, radOf(minDeg), radOf(maxDeg), true);
    ctx.stroke();

    // Frontera de rama alta (45° = 800 mil), punteada.
    ctx.setLineDash([3 * DPR, 3 * DPR]);
    ctx.strokeStyle = 'rgba(163, 175, 187, 0.3)';
    ctx.lineWidth = DPR;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (R - 12 * DPR) * Math.cos(radOf(45)), py + (R - 12 * DPR) * Math.sin(radOf(45)));
    ctx.stroke();
    ctx.setLineDash([]);

    // Escala: mil 100/400; grados 5/15.
    const minor = unit === 'mil' ? 5.625 : 5;
    const majorEvery = unit === 'mil' ? 4 : 3;
    for (let i = 0; i * minor <= 90.0001; i++) {
      const a = i * minor;
      const major = i % majorEvery === 0;
      const rad = radOf(a);
      const len = (major ? 9 : 4) * DPR;
      ctx.strokeStyle = major ? COL.tickMajor : COL.tick;
      ctx.lineWidth = (major ? 1.4 : 1) * DPR;
      ctx.beginPath();
      ctx.moveTo(px + (R - 2 * DPR - len) * Math.cos(rad), py + (R - 2 * DPR - len) * Math.sin(rad));
      ctx.lineTo(px + (R - 2 * DPR) * Math.cos(rad), py + (R - 2 * DPR) * Math.sin(rad));
      ctx.stroke();
    }

    // Aguja de QE.
    const rad = radOf(Math.min(90, Math.max(0, elDeg)));
    ctx.save();
    ctx.shadowColor = 'rgba(245, 165, 36, 0.55)';
    ctx.shadowBlur = 8 * DPR;
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 2 * DPR;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (R - 8 * DPR) * Math.cos(rad), py + (R - 8 * DPR) * Math.sin(rad));
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    ctx.arc(px, py, 3.2 * DPR, 0, Math.PI * 2);
    ctx.fill();

    // Lectura arriba-derecha + envolvente.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COL.dim;
    ctx.font = `600 ${7.5 * DPR}px ${FONT_DISPLAY}`;
    ctx.fillText(unit === 'mil' ? 'QE · MIL' : 'QE · GRAD', S - 4 * DPR, 4 * DPR);
    ctx.fillStyle = COL.text;
    ctx.font = `500 ${14 * DPR}px ${FONT_MONO}`;
    ctx.fillText(fmtAngleValue(elDeg, unit, unit === 'mil' ? 0 : 1).replace(' ', ''), S - 4 * DPR, 15 * DPR);
    ctx.fillStyle = COL.info;
    ctx.font = `500 ${8.5 * DPR}px ${FONT_MONO}`;
    const lo = toUnit(minDeg, unit).toFixed(0);
    const hi = toUnit(maxDeg, unit).toFixed(0);
    ctx.fillText(`${lo}–${hi}`, S - 4 * DPR, 34 * DPR);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }
}
