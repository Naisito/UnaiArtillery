// ============================================================================
//  GunnerHud.ts — HUD de artillero para la vista Cabina (estilo videojuego).
//
//  Se superpone al globo SOLO en modo Cabina (pointer-events: none — la rueda
//  del cockpit y los paneles siguen vivos). Piezas, siguiendo el patrón de
//  las vistas de artillero de los juegos (WoT/War Thunder/Arma):
//
//    * CINTA DE COMPÁS arriba: ticks cada 5º, cardinales, aguja central con
//      el rumbo numérico grande y un caret rojo marcando la demora al
//      objetivo si lo hay.
//    * GONIÓMETRO de elevación a la izquierda: escala 0-90º con la envolvente
//      del arma resaltada y la aguja de QE.
//    * RETÍCULA central sutil (CSS).
//    * MINIMAPA "vista de dron" abajo-derecha: norte arriba, teselas OSM
//      reales de fondo (atenuadas; si no cargan, rejilla táctica), anillos de
//      alcance mín/máx, línea de rumbo, objetivo, impacto previsto e
//      impactos recientes con fundido. El dron (la batería) late en el
//      centro. Las teselas se cachean por (z, x, y) y solo se reconstruyen
//      al mover la batería o cambiar el alcance del arma.
// ============================================================================
import { RangeRing } from '../ballistics/WorkerProtocol';

export interface GunnerAim {
  azimuthDeg: number;
  elevationDeg: number;
  minElevationDeg: number;
  maxElevationDeg: number;
}

export interface GunnerProviders {
  aim(): GunnerAim;
  weaponLabel(): string;
  /** Posición de la batería (para las teselas del minimapa). */
  battery(): { latDeg: number; lonDeg: number };
  targetEnu(): { x: number; y: number } | null;
  previewImpactEnu(): { x: number; y: number } | null;
  /** Texto de la solución actual (alcance/TOF del preview). */
  solutionText(): string;
  ring(): RangeRing | null;
  /** P-VIVO.7 — blanco móvil con su velocidad (vector en el minimapa). */
  movingTarget?(): { x: number; y: number; vx: number; vy: number } | null;
}

const COL = {
  bg: 'rgba(10, 14, 18, 0.72)',
  line: 'rgba(255, 255, 255, 0.16)',
  text: '#e8eaed',
  dim: '#9aa4ad',
  accent: '#ffb545',
  accent2: '#4dc3ff',
  danger: '#ff5d5d',
  ok: '#6fe08e',
};
const DPR = 2;

const CARDINALS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO',
};

interface MapTile { img: HTMLImageElement; loaded: boolean; dxTilePx: number; dyTilePx: number }

export class GunnerHud {
  private readonly root: HTMLElement;
  private readonly tape: HTMLCanvasElement;
  private readonly gauge: HTMLCanvasElement;
  private readonly map: HTMLCanvasElement;
  private readonly infoEl: HTMLElement;
  private readonly mapLabel: HTMLElement;
  private visible = false;
  private clock = 0;

  // Impactos recientes en el minimapa (posición ENU + edad para el fundido).
  private impacts: { x: number; y: number; age: number }[] = [];

  // Teselas OSM del minimapa.
  private tiles: MapTile[] = [];
  private tileKey = '';
  private tileMpp = 1; // metros por pixel de tesela en la latitud del centro

  constructor(private readonly p: GunnerProviders) {
    this.root = document.getElementById('gunnerHud')!;
    this.root.innerHTML = '';

    this.tape = this.canvas('gh-tape', 480, 58);
    this.gauge = this.canvas('gh-gauge', 62, 230);

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'gh-info';
    this.root.appendChild(this.infoEl);

    const reticle = document.createElement('div');
    reticle.className = 'gh-reticle';
    this.root.appendChild(reticle);

    const mapBox = document.createElement('div');
    mapBox.className = 'gh-map';
    this.map = document.createElement('canvas');
    this.map.width = 210 * DPR;
    this.map.height = 210 * DPR;
    this.map.style.width = '210px';
    this.map.style.height = '210px';
    this.mapLabel = document.createElement('div');
    this.mapLabel.className = 'gh-map-label';
    mapBox.append(this.map, this.mapLabel);
    this.root.appendChild(mapBox);
  }

  private canvas(cls: string, wCss: number, hCss: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = cls;
    c.width = wCss * DPR;
    c.height = hCss * DPR;
    c.style.width = `${wCss}px`;
    c.style.height = `${hCss}px`;
    this.root.appendChild(c);
    return c;
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('active', on);
  }

  /** Un tiro cayó: punto en el minimapa que se funde en ~45 s. */
  addImpact(enu: { x: number; y: number }): void {
    this.impacts.push({ x: enu.x, y: enu.y, age: 0 });
    if (this.impacts.length > 24) this.impacts.shift();
  }

  /** La batería se movió: fuerza teselas nuevas. */
  invalidateMap(): void {
    this.tileKey = '';
  }

  render(dt: number): void {
    this.clock += dt;
    for (const i of this.impacts) i.age += dt;
    this.impacts = this.impacts.filter((i) => i.age < 45);
    if (!this.visible) return;

    const aim = this.p.aim();
    this.drawTape(aim);
    this.drawGauge(aim);
    this.drawMap(aim);
    const sol = this.p.solutionText();
    this.infoEl.textContent = sol ? `${this.p.weaponLabel()} · ${sol}` : this.p.weaponLabel();
  }

  // -- Cinta de compás ---------------------------------------------------------
  private drawTape(aim: GunnerAim): void {
    const ctx = this.tape.getContext('2d')!;
    const W = this.tape.width;
    const H = this.tape.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = COL.bg;
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = DPR;
    this.roundRect(ctx, 0, 0, W, H, 10 * DPR);
    ctx.fill();
    ctx.stroke();

    const az = aim.azimuthDeg;
    const span = 80; // grados visibles en la cinta
    const pxPerDeg = W / span;
    ctx.textAlign = 'center';

    const from = Math.floor((az - span / 2) / 5) * 5;
    for (let d = from; d <= az + span / 2; d += 5) {
      const x = W / 2 + (d - az) * pxPerDeg;
      if (x < 8 * DPR || x > W - 8 * DPR) continue;
      const deg = ((d % 360) + 360) % 360;
      const isCardinal = deg % 45 === 0;
      const major = deg % 15 === 0;
      ctx.strokeStyle = major ? COL.dim : COL.line;
      ctx.lineWidth = (major ? 1.4 : 1) * DPR;
      const h = (isCardinal ? 12 : major ? 9 : 5) * DPR;
      ctx.beginPath();
      ctx.moveTo(x, 6 * DPR);
      ctx.lineTo(x, 6 * DPR + h);
      ctx.stroke();
      if (isCardinal) {
        ctx.fillStyle = deg === 0 ? COL.accent2 : COL.dim;
        ctx.font = `700 ${10 * DPR}px "Segoe UI", sans-serif`;
        ctx.fillText(CARDINALS[deg], x, 28 * DPR);
      } else if (major) {
        ctx.fillStyle = COL.dim;
        ctx.font = `${8.5 * DPR}px "Segoe UI", sans-serif`;
        ctx.fillText(String(deg), x, 27 * DPR);
      }
    }

    // Demora al objetivo (caret rojo sobre la cinta).
    const tgt = this.p.targetEnu();
    if (tgt) {
      const bearing = ((Math.atan2(tgt.x, tgt.y) * 180) / Math.PI + 360) % 360;
      let dd = bearing - az;
      dd = ((dd + 540) % 360) - 180;
      if (Math.abs(dd) <= span / 2) {
        const x = W / 2 + dd * pxPerDeg;
        ctx.fillStyle = COL.danger;
        ctx.beginPath();
        ctx.moveTo(x, 4 * DPR);
        ctx.lineTo(x - 4 * DPR, 0);
        ctx.lineTo(x + 4 * DPR, 0);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Aguja central + rumbo numérico grande.
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath();
    ctx.moveTo(W / 2, 4 * DPR);
    ctx.lineTo(W / 2, 20 * DPR);
    ctx.stroke();
    ctx.fillStyle = COL.text;
    ctx.font = `700 ${15 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText(`${(((az % 360) + 360) % 360).toFixed(1)}º`, W / 2, 47 * DPR);
  }

  // -- Goniómetro de elevación ---------------------------------------------------
  private drawGauge(aim: GunnerAim): void {
    const ctx = this.gauge.getContext('2d')!;
    const W = this.gauge.width;
    const H = this.gauge.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = COL.bg;
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = DPR;
    this.roundRect(ctx, 0, 0, W, H, 10 * DPR);
    ctx.fill();
    ctx.stroke();

    const top = 16 * DPR;
    const bottom = H - 34 * DPR;
    const yOf = (deg: number) => bottom - (deg / 90) * (bottom - top);
    const x0 = W - 18 * DPR;

    // Envolvente del arma.
    ctx.strokeStyle = 'rgba(77, 195, 255, 0.6)';
    ctx.lineWidth = 5 * DPR;
    ctx.beginPath();
    ctx.moveTo(x0, yOf(aim.minElevationDeg));
    ctx.lineTo(x0, yOf(aim.maxElevationDeg));
    ctx.stroke();

    // Escala.
    ctx.textAlign = 'left';
    for (let d = 0; d <= 90; d += 10) {
      const major = d % 30 === 0;
      ctx.strokeStyle = major ? COL.dim : COL.line;
      ctx.lineWidth = (major ? 1.4 : 1) * DPR;
      ctx.beginPath();
      ctx.moveTo(x0 - (major ? 9 : 5) * DPR, yOf(d));
      ctx.lineTo(x0, yOf(d));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = COL.dim;
        ctx.font = `${8.5 * DPR}px "Segoe UI", sans-serif`;
        ctx.fillText(String(d), 6 * DPR, yOf(d) + 3 * DPR);
      }
    }

    // Aguja de QE.
    const y = yOf(Math.min(90, Math.max(0, aim.elevationDeg)));
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    ctx.moveTo(x0 + 2 * DPR, y);
    ctx.lineTo(x0 - 7 * DPR, y - 4.5 * DPR);
    ctx.lineTo(x0 - 7 * DPR, y + 4.5 * DPR);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COL.text;
    ctx.textAlign = 'center';
    ctx.font = `700 ${13 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText(`${aim.elevationDeg.toFixed(1)}º`, W / 2, H - 16 * DPR);
    ctx.fillStyle = COL.dim;
    ctx.font = `${8 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText('QE', W / 2, H - 5 * DPR);
  }

  // -- Minimapa "vista de dron" --------------------------------------------------
  private drawMap(aim: GunnerAim): void {
    const ctx = this.map.getContext('2d')!;
    const S = this.map.width; // cuadrado
    const cx = S / 2;
    const R = S / 2 - 4 * DPR;
    ctx.clearRect(0, 0, S, S);

    const ring = this.p.ring();
    const maxR = Math.max(1000, ring?.maxRangeM ?? 8000);
    const pxPerMeter = R / (maxR * 1.15);
    this.ensureTiles(pxPerMeter);

    // Recorte circular.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, Math.PI * 2);
    ctx.clip();

    // Fondo: teselas OSM atenuadas, o rejilla táctica si no hay mapa.
    ctx.fillStyle = 'rgba(9, 13, 17, 0.9)';
    ctx.fillRect(0, 0, S, S);
    let drewMap = false;
    const tileScale = this.tileMpp * pxPerMeter; // px de canvas por px de tesela
    for (const t of this.tiles) {
      if (!t.loaded) continue;
      ctx.filter = 'saturate(0.55) brightness(0.62)';
      ctx.drawImage(
        t.img,
        cx + t.dxTilePx * tileScale,
        cx + t.dyTilePx * tileScale,
        256 * tileScale,
        256 * tileScale,
      );
      ctx.filter = 'none';
      drewMap = true;
    }
    if (!drewMap) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = DPR;
      const step = (maxR / 4) * pxPerMeter;
      for (let k = -4; k <= 4; k++) {
        ctx.beginPath();
        ctx.moveTo(cx + k * step, 0);
        ctx.lineTo(cx + k * step, S);
        ctx.moveTo(0, cx + k * step);
        ctx.lineTo(S, cx + k * step);
        ctx.stroke();
      }
    }

    // Coordenadas ENU -> canvas (norte arriba).
    const X = (e: number) => cx + e * pxPerMeter;
    const Y = (n: number) => cx - n * pxPerMeter;

    // Anillos de alcance.
    ctx.lineWidth = 1.4 * DPR;
    ctx.strokeStyle = 'rgba(77, 195, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(cx, cx, maxR * pxPerMeter, 0, Math.PI * 2);
    ctx.stroke();
    if (ring && Number.isFinite(ring.minRangeM) && ring.minRangeM > 200) {
      ctx.strokeStyle = 'rgba(255, 181, 69, 0.55)';
      ctx.setLineDash([4 * DPR, 4 * DPR]);
      ctx.beginPath();
      ctx.arc(cx, cx, ring.minRangeM * pxPerMeter, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Línea de rumbo hasta el alcance máximo.
    const azRad = (aim.azimuthDeg * Math.PI) / 180;
    const tipX = X(Math.sin(azRad) * maxR);
    const tipY = Y(Math.cos(azRad) * maxR);
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 1.6 * DPR;
    ctx.beginPath();
    ctx.moveTo(cx, cx);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Impactos recientes (se funden con la edad).
    for (const i of this.impacts) {
      const a = Math.max(0, 1 - i.age / 45);
      ctx.fillStyle = `rgba(255, 140, 42, ${0.85 * a})`;
      ctx.beginPath();
      ctx.arc(X(i.x), Y(i.y), 2.6 * DPR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Impacto previsto (×) y objetivo (rombo).
    const prev = this.p.previewImpactEnu();
    if (prev) {
      const x = X(prev.x);
      const y = Y(prev.y);
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 1.8 * DPR;
      const r = 4 * DPR;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y - r);
      ctx.stroke();
    }
    const tgt = this.p.targetEnu();
    if (tgt) {
      const x = X(tgt.x);
      const y = Y(tgt.y);
      const r = 5 * DPR;
      ctx.strokeStyle = COL.danger;
      ctx.lineWidth = 1.8 * DPR;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.stroke();
    }

    // P-VIVO.7 — blanco móvil: cuadrado verde + vector de velocidad (la
    // punta marca dónde estará en ~20 s: la lección del adelanto en el mapa).
    const mov = this.p.movingTarget?.();
    if (mov) {
      const x = X(mov.x);
      const y = Y(mov.y);
      ctx.fillStyle = 'rgba(111, 224, 142, 0.95)';
      ctx.fillRect(x - 3 * DPR, y - 3 * DPR, 6 * DPR, 6 * DPR);
      const tipXv = X(mov.x + mov.vx * 20);
      const tipYv = Y(mov.y + mov.vy * 20);
      ctx.strokeStyle = 'rgba(111, 224, 142, 0.9)';
      ctx.lineWidth = 1.6 * DPR;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tipXv, tipYv);
      ctx.stroke();
      // Punta de flecha sencilla.
      const ang = Math.atan2(tipYv - y, tipXv - x);
      ctx.beginPath();
      ctx.moveTo(tipXv, tipYv);
      ctx.lineTo(tipXv - 5 * DPR * Math.cos(ang - 0.5), tipYv - 5 * DPR * Math.sin(ang - 0.5));
      ctx.moveTo(tipXv, tipYv);
      ctx.lineTo(tipXv - 5 * DPR * Math.cos(ang + 0.5), tipYv - 5 * DPR * Math.sin(ang + 0.5));
      ctx.stroke();
    }

    // El dron (la batería) late en el centro.
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 3.2);
    ctx.strokeStyle = `rgba(111, 224, 142, ${0.25 + 0.35 * pulse})`;
    ctx.lineWidth = 1.6 * DPR;
    ctx.beginPath();
    ctx.arc(cx, cx, (6 + 4 * pulse) * DPR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COL.ok;
    // Cuerpo + 4 rotores del dron.
    ctx.fillRect(cx - 2 * DPR, cx - 2 * DPR, 4 * DPR, 4 * DPR);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.beginPath();
      ctx.arc(cx + sx * 4 * DPR, cx + sy * 4 * DPR, 1.7 * DPR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Borde + norte.
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1.5 * DPR;
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COL.accent2;
    ctx.textAlign = 'center';
    ctx.font = `700 ${10 * DPR}px "Segoe UI", sans-serif`;
    ctx.fillText('N', cx, 13 * DPR);

    this.mapLabel.textContent = `DRON · ⌀ ${((maxR * 2.3) / 1000).toFixed(0)} km`;
  }

  /** Teselas OSM 3×3 alrededor de la batería, al zoom que cubre el minimapa. */
  private ensureTiles(pxPerMeter: number): void {
    const { latDeg, lonDeg } = this.p.battery();
    const mppNeeded = 1 / pxPerMeter; // metros por px de canvas
    const latRad = (latDeg * Math.PI) / 180;
    const zRaw = Math.log2((156543.03392 * Math.cos(latRad)) / mppNeeded);
    const z = Math.min(17, Math.max(3, Math.round(zRaw)));

    const xt = ((lonDeg + 180) / 360) * 2 ** z;
    const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z;
    const cx0 = Math.floor(xt);
    const cy0 = Math.floor(yt);
    const key = `${z}/${cx0}/${cy0}`;
    if (key === this.tileKey) return;

    this.tileKey = key;
    this.tileMpp = (156543.03392 * Math.cos(latRad)) / 2 ** z;
    this.tiles = [];
    const n = 2 ** z;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = ((cx0 + dx) % n + n) % n;
        const ty = cy0 + dy;
        if (ty < 0 || ty >= n) continue;
        const tile: MapTile = {
          img: new Image(),
          loaded: false,
          dxTilePx: (cx0 + dx - xt) * 256,
          dyTilePx: (ty - yt) * 256,
        };
        tile.img.crossOrigin = 'anonymous';
        tile.img.onload = () => { tile.loaded = true; };
        tile.img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
        this.tiles.push(tile);
      }
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
