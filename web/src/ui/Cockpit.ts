// ============================================================================
//  Cockpit.ts — Instrumentos de puntería de precisión.  [P-NEXT.1]
//
//  Panel inferior-izquierdo con dos instrumentos dibujados en canvas:
//    * ROSA DE AZIMUT — círculo de compás con aguja y rumbo numérico grande.
//    * CUADRANTE DE ELEVACIÓN — arco 0-90º con la envolvente mín/máx del arma
//      actual resaltada y aguja de QE.
//
//  Posar el cursor encima y girar la RUEDA ajusta el valor: paso 0.5º, con
//  Shift 0.05º (fino), con Ctrl 5º (grueso). Arrastrar también apunta.
//  Sincronía bidireccional con ControlPanel: la rueda mueve los sliders
//  (panel.setAim) y los sliders mueven las agujas (render() por frame lee el
//  estado del panel y solo repinta si cambió).
// ============================================================================
import { ControlPanel } from './ControlPanel';

const COL = {
  bg: 'rgba(20, 26, 32, 0.85)',
  line: 'rgba(255, 255, 255, 0.14)',
  text: '#e8eaed',
  dim: '#9aa4ad',
  accent: '#ffb545',
  accent2: '#4dc3ff',
};

const SIZE = 128;  // css px por instrumento
const DPR = 2;     // trazo nítido

function stepFor(ev: { shiftKey: boolean; ctrlKey: boolean }): number {
  if (ev.ctrlKey) return 5.0;   // grueso
  if (ev.shiftKey) return 0.05; // fino
  return 0.5;
}

export class Cockpit {
  private azCanvas!: HTMLCanvasElement;
  private elCanvas!: HTMLCanvasElement;
  private lastAz = NaN;
  private lastEl = NaN;
  private lastMin = NaN;
  private lastMax = NaN;

  constructor(
    private readonly panel: ControlPanel,
    private readonly onAimChanged: () => void,
  ) {
    const host = document.getElementById('cockpit')!;
    host.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = 'Cockpit';
    host.appendChild(title);

    const row = document.createElement('div');
    row.className = 'instruments';
    this.azCanvas = this.makeInstrument(row, 'Azimut · rueda ±0.5º · Shift fino · Ctrl grueso');
    this.elCanvas = this.makeInstrument(row, 'Elevación · rueda ±0.5º · Shift fino · Ctrl grueso');
    host.appendChild(row);

    this.bindAzimuth();
    this.bindElevation();
    this.render();
  }

  private makeInstrument(parent: HTMLElement, title: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = SIZE * DPR;
    c.height = SIZE * DPR;
    c.style.width = `${SIZE}px`;
    c.style.height = `${SIZE}px`;
    c.title = title;
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
        this.applyAim(this.panel.azimuthDeg + dir * stepFor(ev), this.panel.elevationDeg);
      },
      { passive: false },
    );

    const aimFromPointer = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      if (dx * dx + dy * dy < 25) return; // demasiado cerca del pivote
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
        this.applyAim(this.panel.azimuthDeg, this.panel.elevationDeg + dir * stepFor(ev));
      },
      { passive: false },
    );

    const aimFromPointer = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      // Pivote del cuadrante: esquina inferior-izquierda (como se dibuja).
      const px = r.left + 16;
      const py = r.top + r.height - 16;
      const dx = ev.clientX - px;
      const dy = py - ev.clientY;
      if (dx * dx + dy * dy < 25) return;
      const el = (Math.atan2(dy, Math.max(1e-6, dx)) * 180) / Math.PI;
      this.applyAim(this.panel.azimuthDeg, el);
    };
    // P-VIVO.11 — dos dedos = ajuste FINO relativo de la QE.
    this.bindDrag(c, aimFromPointer, (_dxPx, dyPx) => {
      this.applyAim(this.panel.azimuthDeg, this.panel.elevationDeg - dyPx * 0.02);
    });
  }

  /**
   * Arrastre con Pointer Events (ratón Y dedo: setPointerCapture +
   * touch-action:none en CSS). P-VIVO.11: con DOS punteros activos el
   * movimiento pasa a `fineMove` (ajuste relativo suave, el "Shift" táctil).
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
  /** Llamar cada frame: solo repinta si la puntería o la envolvente cambió. */
  render(): void {
    const w = this.panel.weapon();
    const az = this.panel.azimuthDeg;
    const el = this.panel.elevationDeg;
    if (
      az === this.lastAz && el === this.lastEl &&
      w.minElevationDeg === this.lastMin && w.maxElevationDeg === this.lastMax
    ) {
      return;
    }
    this.lastAz = az;
    this.lastEl = el;
    this.lastMin = w.minElevationDeg;
    this.lastMax = w.maxElevationDeg;
    this.drawAzimuth(az);
    this.drawElevation(el, w.minElevationDeg, w.maxElevationDeg);
  }

  private drawAzimuth(azDeg: number): void {
    const ctx = this.azCanvas.getContext('2d')!;
    const S = SIZE * DPR;
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2 - 6 * DPR;
    ctx.clearRect(0, 0, S, S);

    // Dial.
    ctx.fillStyle = COL.bg;
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = DPR;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ticks cada 10º, mayores cada 30º, cardinales cada 90º.
    for (let a = 0; a < 360; a += 10) {
      const rad = ((a - 90) * Math.PI) / 180; // 0º arriba
      const major = a % 30 === 0;
      const r0 = R - (major ? 9 : 5) * DPR;
      ctx.strokeStyle = major ? COL.dim : COL.line;
      ctx.lineWidth = (major ? 1.4 : 1) * DPR;
      ctx.beginPath();
      ctx.moveTo(cx + r0 * Math.cos(rad), cy + r0 * Math.sin(rad));
      ctx.lineTo(cx + (R - 2 * DPR) * Math.cos(rad), cy + (R - 2 * DPR) * Math.sin(rad));
      ctx.stroke();
    }
    ctx.fillStyle = COL.dim;
    ctx.font = `${10 * DPR}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rl = R - 17 * DPR;
    for (const [label, a] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]] as const) {
      const rad = ((a - 90) * Math.PI) / 180;
      ctx.fillStyle = label === 'N' ? COL.accent2 : COL.dim;
      ctx.fillText(label, cx + rl * Math.cos(rad), cy + rl * Math.sin(rad));
    }

    // Aguja.
    const rad = ((azDeg - 90) * Math.PI) / 180;
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath();
    ctx.moveTo(cx - 8 * DPR * Math.cos(rad), cy - 8 * DPR * Math.sin(rad));
    ctx.lineTo(cx + (R - 12 * DPR) * Math.cos(rad), cy + (R - 12 * DPR) * Math.sin(rad));
    ctx.stroke();
    // Punta.
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    const tip = R - 10 * DPR;
    ctx.arc(cx + tip * Math.cos(rad), cy + tip * Math.sin(rad), 2.4 * DPR, 0, Math.PI * 2);
    ctx.fill();

    // Rumbo numérico grande.
    ctx.fillStyle = COL.text;
    ctx.font = `700 ${16 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText(`${azDeg.toFixed(1)}º`, cx, cy + 14 * DPR);
    ctx.fillStyle = COL.dim;
    ctx.font = `${8.5 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText('AZIMUT', cx, cy - 13 * DPR);
  }

  private drawElevation(elDeg: number, minDeg: number, maxDeg: number): void {
    const ctx = this.elCanvas.getContext('2d')!;
    const S = SIZE * DPR;
    const px = 16 * DPR;          // pivote inferior-izquierdo
    const py = S - 16 * DPR;
    const R = S - 30 * DPR;
    ctx.clearRect(0, 0, S, S);

    const radOf = (deg: number) => (-deg * Math.PI) / 180; // 0º→derecha, + hacia arriba

    // Fondo del cuadrante.
    ctx.fillStyle = COL.bg;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, R, radOf(0), radOf(90), true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = DPR;
    ctx.stroke();

    // Envolvente mín/máx del arma (banda resaltada).
    ctx.strokeStyle = 'rgba(77, 195, 255, 0.55)';
    ctx.lineWidth = 5 * DPR;
    ctx.beginPath();
    ctx.arc(px, py, R - 5 * DPR, radOf(minDeg), radOf(maxDeg), true);
    ctx.stroke();

    // Ticks cada 10º.
    for (let a = 0; a <= 90; a += 10) {
      const major = a % 30 === 0;
      const rad = radOf(a);
      const r0 = R - (major ? 11 : 8) * DPR;
      ctx.strokeStyle = major ? COL.dim : COL.line;
      ctx.lineWidth = (major ? 1.4 : 1) * DPR;
      ctx.beginPath();
      ctx.moveTo(px + r0 * Math.cos(rad), py + r0 * Math.sin(rad));
      ctx.lineTo(px + (R - 2 * DPR) * Math.cos(rad), py + (R - 2 * DPR) * Math.sin(rad));
      ctx.stroke();
    }

    // Aguja de QE.
    const rad = radOf(elDeg);
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (R - 13 * DPR) * Math.cos(rad), py + (R - 13 * DPR) * Math.sin(rad));
    ctx.stroke();
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    ctx.arc(px, py, 3 * DPR, 0, Math.PI * 2);
    ctx.fill();

    // QE numérico grande + envolvente.
    ctx.fillStyle = COL.text;
    ctx.font = `700 ${16 * DPR}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${elDeg.toFixed(1)}º`, S - 6 * DPR, 8 * DPR);
    ctx.fillStyle = COL.dim;
    ctx.font = `${8.5 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText(`QE ${minDeg.toFixed(0)}–${maxDeg.toFixed(0)}º`, S - 6 * DPR, 26 * DPR);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }
}
