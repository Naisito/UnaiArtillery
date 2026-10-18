// ============================================================================
//  map/ProfileChart.ts — Perfil del terreno con línea de visión.  [V2:MAP]
//
//  Canvas HiDPI: relieve relleno (con el abombamiento terrestre aplicado,
//  que es lo que "ve" el rayo), ángulos muertos sombreados, rayo de visión
//  verde hasta la primera obstrucción y rojo después, la cresta que tapa
//  marcada, ejes con distancia (km) y cotas, y cursor de inspección.
//  Colores de los tokens --ua-*.
// ============================================================================
import type { LosResult } from './los';
import { token } from './theme';

export interface ProfileData {
  distances: number[];
  /** Cotas mostradas (m), mismo dátum que los rótulos. */
  heights: number[];
  los: LosResult;
  /** Desplazamiento cota mostrada − cota de cálculo (geoide). */
  displayOffset: number;
}

const PAD = { l: 44, r: 10, t: 10, b: 20 };

export function drawProfile(canvas: HTMLCanvasElement, d: ProfileData | null, hoverIdx = -1): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 560;
  const cssH = canvas.clientHeight || 132;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!d || d.distances.length < 2) return;

  const n = d.distances.length;
  const D = d.distances[n - 1] || 1;
  const eff = d.los.effHeights.map((h) => h + d.displayOffset);
  const ray = d.los.rayHeights.map((h) => h + d.displayOffset);
  let lo = Math.min(...eff, ...ray);
  let hi = Math.max(...eff, ...ray);
  const span = Math.max(20, hi - lo);
  lo -= span * 0.12;
  hi += span * 0.18;
  const W = cssW - PAD.l - PAD.r;
  const H = cssH - PAD.t - PAD.b;
  const X = (dist: number) => PAD.l + (dist / D) * W;
  const Y = (h: number) => PAD.t + (1 - (h - lo) / (hi - lo)) * H;

  const text3 = token('--ua-text-3');
  const text2 = token('--ua-text-2');
  const border = token('--ua-border');
  const info = token('--ua-info');
  const ok = token('--ua-ok');
  const danger = token('--ua-danger');

  // Rejilla y ejes.
  ctx.font = '500 10px "JetBrains Mono Variable", Consolas, monospace';
  ctx.fillStyle = text3;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  const yTicks = niceTicks(lo, hi, 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yTicks) {
    const y = Math.round(Y(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(cssW - PAD.r, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(t)}`, PAD.l - 6, y);
  }
  const km = D >= 2000;
  const xTicks = niceTicks(0, km ? D / 1000 : D, 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xTicks) {
    const x = X(km ? t * 1000 : t);
    if (x < PAD.l - 1 || x > cssW - PAD.r + 1) continue;
    ctx.fillText(km ? `${t}` : `${Math.round(t)}`, x, cssH - PAD.b + 5);
  }
  ctx.textAlign = 'left';
  ctx.fillText(km ? 'km' : 'm', cssW - PAD.r - 14, cssH - PAD.b + 5);

  // Relieve relleno.
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + H);
  grad.addColorStop(0, withAlpha(info, 0.38));
  grad.addColorStop(1, withAlpha(info, 0.04));
  ctx.beginPath();
  ctx.moveTo(X(d.distances[0]), Y(lo));
  for (let i = 0; i < n; i++) ctx.lineTo(X(d.distances[i]), Y(eff[i]));
  ctx.lineTo(X(D), Y(lo));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Ángulos muertos: franjas sombreadas bajo el perfil.
  ctx.fillStyle = withAlpha(danger, 0.2);
  for (let i = 1; i < n; i++) {
    if (d.los.groundVisible[i]) continue;
    const x0 = X(d.distances[i - 1]);
    const x1 = X(d.distances[i]);
    ctx.beginPath();
    ctx.moveTo(x0, Y(eff[i - 1]));
    ctx.lineTo(x1, Y(eff[i]));
    ctx.lineTo(x1, Y(lo));
    ctx.lineTo(x0, Y(lo));
    ctx.closePath();
    ctx.fill();
  }

  // Línea del relieve.
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = X(d.distances[i]);
    const y = Y(eff[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = text2;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Rayo de visión: verde hasta la primera obstrucción, rojo después.
  const split = d.los.firstBlockIndex >= 0 ? d.los.firstBlockIndex : n - 1;
  const seg = (from: number, to: number, color: string, dash: number[]) => {
    ctx.beginPath();
    ctx.moveTo(X(d.distances[from]), Y(ray[from]));
    ctx.lineTo(X(d.distances[to]), Y(ray[to]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  seg(0, split, ok, []);
  if (split < n - 1) seg(split, n - 1, danger, [6, 4]);

  // Cresta que tapa.
  if (d.los.worstIndex >= 0) {
    const x = X(d.distances[d.los.worstIndex]);
    const y = Y(eff[d.los.worstIndex]);
    ctx.fillStyle = danger;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x - 6, y - 19);
    ctx.lineTo(x + 6, y - 19);
    ctx.closePath();
    ctx.fill();
  }

  // Extremos A/B: ojo y blanco.
  const endpoint = (i: number, label: string) => {
    const x = X(d.distances[i]);
    const y = Y(ray[i]);
    ctx.fillStyle = token('--ua-text-1');
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 10px "Inter Variable", sans-serif';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x + (i === 0 ? 6 : -6), y - 3);
  };
  endpoint(0, 'A');
  endpoint(n - 1, 'B');

  // Cursor de inspección.
  if (hoverIdx >= 0 && hoverIdx < n) {
    const x = X(d.distances[hoverIdx]);
    ctx.strokeStyle = withAlpha(token('--ua-text-1'), 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, PAD.t + H);
    ctx.stroke();
    ctx.fillStyle = token('--ua-accent');
    ctx.beginPath();
    ctx.arc(x, Y(eff[hoverIdx]), 4, 0, Math.PI * 2);
    ctx.fill();
    const label =
      `${km ? (d.distances[hoverIdx] / 1000).toFixed(2) + ' km' : Math.round(d.distances[hoverIdx]) + ' m'}` +
      ` · ${Math.round(d.heights[hoverIdx] + d.displayOffset)} m`;
    ctx.font = '500 10px "JetBrains Mono Variable", Consolas, monospace';
    const tw = ctx.measureText(label).width + 10;
    const bx = Math.min(cssW - PAD.r - tw, Math.max(PAD.l, x + 8));
    ctx.fillStyle = withAlpha(token('--ua-surface-solid'), 0.92);
    ctx.fillRect(bx, PAD.t + 2, tw, 16);
    ctx.fillStyle = token('--ua-text-1');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 5, PAD.t + 10);
  }
}

/** Índice de muestra bajo una x de ratón (CSS px) o −1. */
export function profileIndexAt(canvas: HTMLCanvasElement, d: ProfileData | null, xCss: number): number {
  if (!d || d.distances.length < 2) return -1;
  const W = (canvas.clientWidth || 560) - PAD.l - PAD.r;
  const f = (xCss - PAD.l) / W;
  if (f < 0 || f > 1) return -1;
  const D = d.distances[d.distances.length - 1];
  const target = f * D;
  let best = 0;
  for (let i = 1; i < d.distances.length; i++) {
    if (Math.abs(d.distances[i] - target) < Math.abs(d.distances[best] - target)) best = i;
  }
  return best;
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * p;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Number(t.toFixed(6)));
  return out;
}

/** Color CSS (hex o rgb[a]) con alfa. */
function withAlpha(css: string, a: number): string {
  const c = css.trim();
  if (c.startsWith('#')) {
    const hex = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    const v = parseInt(hex, 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const [r, g, b] = m[1].split(',').map((s) => s.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}
