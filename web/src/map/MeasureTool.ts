// ============================================================================
//  map/MeasureTool.ts — Medición A→B con perfil del terreno y LOS. [V2:MAP]
//
//  Por defecto el origen A es la batería; "Medir desde aquí" (menú
//  contextual) o "Elegir origen" fijan otro. Mientras se elige el destino,
//  una goma elástica sigue al cursor con distancia y demora vivas en el chip.
//  Al fijar B: distancia horizontal (geodésica) e inclinada, demora en
//  milésimas y grados, desnivel, perfil del terreno muestreado con la MISMA
//  cascada que la física (service.sampleLineProfile) y línea de visión con
//  altura de ojo/blanco configurables, curvatura y refracción; la cresta
//  que tapa se marca en el mapa y en el perfil. Esc lo borra todo.
// ============================================================================
import * as Cesium from 'cesium';
import { Vec3 } from '../ballistics';
import type { BallisticsService } from '../BallisticsService';
import type { GeoFrame } from '../frame';
import { el } from './dom';
import { ICON } from './icons';
import { lineOfSight } from './los';
import { vincentyInverse } from './geodesy';
import { curvatureDropZ } from './fanGeometry';
import { SYM, applySymbol } from './mapSymbols';
import { drawProfile, profileIndexAt, ProfileData } from './ProfileChart';
import { FONT_DATA_SMALL, tagLabel, token, tokenColor } from './theme';
import {
  formatAzDeg, formatDistance, formatMils, formatSignedHeight,
} from './units';
import type { HintChip } from './HintChip';

export interface GeoPoint {
  ecef: Cesium.Cartesian3;
  latDeg: number;
  lonDeg: number;
  /** Altura elipsoidal del suelo (m) si se conoce. */
  heightM: number;
}

type Phase = 'idle' | 'pickDest' | 'pickOrigin' | 'done';

const EYE_KEY = 'ua.map.losEye';
const TGT_KEY = 'ua.map.losTarget';

export class MeasureTool {
  private phase: Phase = 'idle';
  private origin: GeoPoint | null = null; // null = batería
  private dest: GeoPoint | null = null;
  private seq = 0;
  private eyeM = 2;
  private targetM = 2;
  private profile: ProfileData | null = null;
  private profileEnds: { a: Cesium.Cartesian3; b: Cesium.Cartesian3; aEnu: Vec3; bEnu: Vec3 } | null = null;

  private readonly ds = new Cesium.CustomDataSource('ua-measure');
  private readonly bbs: Cesium.BillboardCollection;
  private readonly lbs: Cesium.LabelCollection;
  private readonly pls: Cesium.PolylineCollection;
  private rubber: Cesium.Polyline | null = null;
  private hoverBb: Cesium.Billboard | null = null;
  private marks: Cesium.Billboard[] = [];
  private crestLabel: Cesium.Label | null = null;

  private readonly card: HTMLDivElement;
  private readonly routeEl: HTMLSpanElement;
  private readonly stats: Record<'h' | 's' | 'az' | 'dh' | 'los', HTMLDivElement>;
  private readonly canvas: HTMLCanvasElement;
  private readonly busy: HTMLDivElement;
  private readonly originBtn: HTMLButtonElement;
  private hoverIdx = -1;

  /** La herramienta terminó (B fijado) o se canceló: MapInteraction sale del modo. */
  onPhaseChanged?: (phase: Phase) => void;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly service: BallisticsService,
    private readonly frameOf: () => GeoFrame,
    parent: HTMLElement,
    private readonly hint: HintChip,
    /** Ondulación del geoide N (m) para mostrar cotas MSL; null = elipsoidal. */
    private readonly geoidN: () => number | null,
  ) {
    try {
      const e = Number(localStorage.getItem(EYE_KEY));
      const t = Number(localStorage.getItem(TGT_KEY));
      if (Number.isFinite(e) && e > 0) this.eyeM = e;
      if (Number.isFinite(t) && t >= 0 && localStorage.getItem(TGT_KEY) !== null) this.targetM = t;
    } catch { /* sin almacenamiento */ }

    void viewer.dataSources.add(this.ds);
    const scene = viewer.scene;
    this.pls = scene.primitives.add(new Cesium.PolylineCollection());
    this.bbs = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.lbs = scene.primitives.add(new Cesium.LabelCollection({ scene }));

    // -- Tarjeta ------------------------------------------------------------
    this.card = el('div', 'ua-measure ua-glass');
    this.card.style.pointerEvents = 'auto';
    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-label', 'Medición y perfil del terreno');
    const head = el('div', 'ua-measure-head');
    const title = el('div', 'ua-measure-title', `${ICON.profile}<span>Medición</span>`);
    this.routeEl = el('span', 'ua-measure-route');
    title.appendChild(this.routeEl);
    this.originBtn = el('button', 'ua-chip-btn', `${ICON.origin}<span>Elegir origen</span>`);
    this.originBtn.type = 'button';
    this.originBtn.addEventListener('click', () => {
      if (this.origin) {
        this.origin = null; // vuelve a la batería
        if (this.dest) void this.compute();
        this.syncOriginBtn();
      } else {
        this.beginPickOrigin();
      }
    });
    const close = el('button', 'ua-icon-btn', ICON.close);
    close.type = 'button';
    close.title = 'Cerrar (Esc)';
    close.setAttribute('aria-label', 'Cerrar medición');
    close.addEventListener('click', () => this.clear());
    head.append(title, el('span', 'grow'), this.originBtn, close);

    const statsEl = el('div', 'ua-measure-stats');
    const stat = (k: string) => {
      const s = el('div', 'ua-stat');
      s.innerHTML = `<div class="k">${k}</div><div class="v">—</div>`;
      statsEl.appendChild(s);
      return s;
    };
    this.stats = {
      h: stat('Dist. horizontal'),
      s: stat('Inclinada'),
      az: stat('Demora'),
      dh: stat('Desnivel'),
      los: stat('Línea de visión'),
    };

    const chart = el('div', 'ua-measure-chart');
    this.canvas = el('canvas');
    this.busy = el('div', 'busy');
    this.busy.textContent = 'Muestreando el terreno…';
    chart.append(this.canvas, this.busy);
    this.canvas.addEventListener('pointermove', (ev) => {
      const r = this.canvas.getBoundingClientRect();
      this.setHover(profileIndexAt(this.canvas, this.profile, ev.clientX - r.left));
    });
    this.canvas.addEventListener('pointerleave', () => this.setHover(-1));

    const foot = el('div', 'ua-measure-foot');
    const num = (label: string, value: number, key: string, set: (v: number) => void) => {
      const l = el('label');
      l.innerHTML = `${label}`;
      const i = el('input');
      i.type = 'number';
      i.min = '0';
      i.max = '500';
      i.step = '0.5';
      i.value = String(value);
      i.addEventListener('change', () => {
        const v = Math.max(0, Math.min(500, Number(i.value) || 0));
        i.value = String(v);
        set(v);
        try { localStorage.setItem(key, String(v)); } catch { /* idem */ }
        this.recomputeLos();
      });
      const u = el('span');
      u.textContent = 'm';
      l.append(i, u);
      foot.appendChild(l);
    };
    num(`${ICON.eye.replace('width="18" height="18"', 'width="14" height="14"')} Ojo`, this.eyeM, EYE_KEY, (v) => (this.eyeM = v));
    num('Blanco', this.targetM, TGT_KEY, (v) => (this.targetM = v));
    foot.appendChild(el('span', 'grow'));
    const note = el('span');
    note.textContent = 'Curvatura y refracción (k = 0.13) incluidas';
    foot.appendChild(note);

    this.card.append(head, statsEl, chart, foot);
    parent.appendChild(this.card);
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get picking(): boolean {
    return this.phase === 'pickDest' || this.phase === 'pickOrigin';
  }

  get hasResult(): boolean {
    return this.phase === 'done';
  }

  /** Empieza a medir: A = `origin` (null = batería), B con el próximo clic. */
  begin(origin: GeoPoint | null = this.origin): void {
    this.origin = origin;
    this.setPhase('pickDest');
    this.hint.showMode('measure', origin ? 'Clic para fijar el destino B' : 'Clic para medir desde la batería');
    this.syncOriginBtn();
  }

  beginPickOrigin(): void {
    this.setPhase('pickOrigin');
    this.hint.showMode('measure', 'Clic para fijar el origen A');
  }

  /** Mide directamente A→B (menú contextual "perfil y LOS desde la batería"). */
  measure(dest: GeoPoint, origin: GeoPoint | null = null): void {
    this.origin = origin;
    this.dest = dest;
    this.setPhase('done');
    this.hint.hideMode();
    this.syncOriginBtn();
    void this.compute();
  }

  /** Clic en el globo durante la medición. */
  click(pt: GeoPoint): void {
    if (this.phase === 'pickOrigin') {
      this.origin = pt;
      this.begin(pt);
      return;
    }
    if (this.phase === 'pickDest') this.measure(pt, this.origin);
  }

  /** Cursor sobre el globo durante la medición (goma elástica). */
  hover(pt: GeoPoint | null): void {
    if (this.phase !== 'pickDest' || !pt) {
      if (this.rubber) this.rubber.show = false;
      return;
    }
    const a = this.originPoint();
    if (!this.rubber) {
      this.rubber = this.pls.add({
        width: 2,
        material: Cesium.Material.fromType('PolylineDash', {
          color: tokenColor('--ua-info', 0.95), dashLength: 14,
        }),
      });
    }
    const lift = (p: Cesium.Cartesian3) => {
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p, new Cesium.Cartesian3());
      return Cesium.Cartesian3.add(p, Cesium.Cartesian3.multiplyByScalar(up, 3, up), new Cesium.Cartesian3());
    };
    this.rubber.positions = [lift(a.ecef), lift(pt.ecef)];
    this.rubber.show = true;
    const g = vincentyInverse(a.latDeg, a.lonDeg, pt.latDeg, pt.lonDeg);
    this.hint.setSub(
      `${formatDistance(g.distanceM)} · ${formatMils(g.initialBearingDeg)} mil · ` +
        `Δ ${formatSignedHeight(pt.heightM - a.heightM)}`,
    );
  }

  /** Esc: cancela la elección en curso o borra la medición. */
  clear(): void {
    this.seq++;
    this.origin = null;
    this.dest = null;
    this.profile = null;
    this.profileEnds = null;
    this.ds.entities.removeAll();
    this.clearMarks();
    if (this.rubber) this.rubber.show = false;
    if (this.hoverBb) this.hoverBb.show = false;
    this.card.classList.remove('show');
    this.hint.hideMode();
    this.setPhase('idle');
  }

  /** Cancela solo la elección (deja el resultado anterior si lo había). */
  cancelPicking(): void {
    if (!this.picking) return;
    if (this.rubber) this.rubber.show = false;
    this.hint.hideMode();
    this.setPhase(this.dest ? 'done' : 'idle');
  }

  /** Re-ancla tras mover la batería: la medición vieja queda obsoleta. */
  invalidate(): void {
    if (this.active) this.clear();
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.onPhaseChanged?.(p);
  }

  private syncOriginBtn(): void {
    const span = this.originBtn.querySelector('span')!;
    span.textContent = this.origin ? 'Origen: batería' : 'Elegir origen';
    this.originBtn.title = this.origin ? 'Medir de nuevo desde la batería' : 'Fijar otro origen A con un clic';
  }

  /** Punto A efectivo (la batería si no hay origen propio). */
  private originPoint(): GeoPoint {
    if (this.origin) return this.origin;
    const f = this.frameOf();
    return { ecef: f.origin, latDeg: f.latDeg, lonDeg: f.lonDeg, heightM: f.heightM };
  }

  private clearMarks(): void {
    for (const b of this.marks) this.bbs.remove(b);
    this.marks = [];
    if (this.crestLabel) this.lbs.remove(this.crestLabel);
    this.crestLabel = null;
  }

  private async compute(): Promise<void> {
    const seq = ++this.seq;
    const a = this.originPoint();
    const b = this.dest!;
    const frame = this.frameOf();
    const aEnu = frame.ecefToEnu(a.ecef);
    const bEnu = frame.ecefToEnu(b.ecef);
    const g = vincentyInverse(a.latDeg, a.lonDeg, b.latDeg, b.lonDeg);

    this.card.classList.add('show');
    this.busy.style.display = '';
    this.profile = null;
    drawProfile(this.canvas, null);
    this.routeEl.textContent = `${this.origin ? 'A' : 'BATERÍA'} → B`;
    this.setStat('h', formatDistance(g.distanceM));
    this.setStat('az', `${formatMils(g.initialBearingDeg)}<small>mil</small>`, formatAzDeg(g.initialBearingDeg));
    this.setStat('s', '…');
    this.setStat('dh', '…');
    this.setLos('pending', 'Calculando…');

    // Geometría en el mapa: extremos y trayecto drapeado.
    this.ds.entities.removeAll();
    this.clearMarks();
    if (this.origin) this.mark(a.ecef, SYM.dot(token('--ua-info'), 'A', 20));
    this.mark(b.ecef, SYM.dot(token('--ua-info'), 'B', 20));
    this.ds.entities.add({
      polyline: {
        positions: [a.ecef, b.ecef],
        clampToGround: true,
        width: 2,
        arcType: Cesium.ArcType.GEODESIC,
        material: new Cesium.PolylineDashMaterialProperty({
          color: tokenColor('--ua-text-1', 0.85), gapColor: Cesium.Color.TRANSPARENT, dashLength: 16,
        }),
      },
    });

    let rel: number[];
    try {
      const n = 96;
      rel = await this.service.sampleLineProfile(aEnu, bEnu, Math.max(5, g.distanceM / (n - 1)));
    } catch (err) {
      console.warn('[measure] perfil', err);
      if (seq === this.seq) {
        this.busy.textContent = 'No se pudo muestrear el terreno';
        this.setLos('pending', '—');
      }
      return;
    }
    if (seq !== this.seq || rel.length < 2) return;
    this.busy.style.display = 'none';

    const base = frame.heightM;
    const heights = rel.map((h) => h + base);
    const distances = rel.map((_, i) => (g.distanceM * i) / (rel.length - 1));
    this.profileEnds = { a: a.ecef, b: b.ecef, aEnu, bEnu };
    const dh = heights[heights.length - 1] - heights[0];
    const slant = Math.hypot(g.distanceM, dh);
    this.setStat('s', formatDistance(slant));
    this.setStat('dh', formatSignedHeight(dh), `${((Math.atan2(dh, g.distanceM) * 180) / Math.PI).toFixed(1)}° de pendiente media`);
    this.profile = {
      distances,
      heights,
      los: lineOfSight(distances, heights, this.eyeM, this.targetM),
      displayOffset: -(this.geoidN() ?? 0),
    };
    this.applyLos();
  }

  private recomputeLos(): void {
    if (!this.profile) return;
    this.profile.los = lineOfSight(this.profile.distances, this.profile.heights, this.eyeM, this.targetM);
    this.applyLos();
  }

  private applyLos(): void {
    const p = this.profile;
    const ends = this.profileEnds;
    if (!p || !ends) return;
    const los = p.los;
    const n = p.distances.length;
    if (los.visible) {
      const clear = Number.isFinite(los.minClearanceM) ? ` · holgura ${Math.max(0, los.minClearanceM).toFixed(0)} m` : '';
      this.setLos('visible', 'Visible', `ojo ${this.eyeM} m → blanco ${this.targetM} m${clear}`);
    } else {
      const d = p.distances[los.worstIndex];
      this.setLos('blocked', 'Oculto', `cresta a ${formatDistance(d)} (+${los.worstExcessM.toFixed(0)} m)`);
    }
    drawProfile(this.canvas, p, this.hoverIdx);

    // Rayo de visión 3D (el tramo tapado se ve punteado a través del relieve)
    // y la cresta que tapa.
    const frame = this.frameOf();
    const enuAt = (i: number, extra: number) => {
      const f = i / (n - 1);
      const x = ends.aEnu.x + (ends.bEnu.x - ends.aEnu.x) * f;
      const y = ends.aEnu.y + (ends.bEnu.y - ends.aEnu.y) * f;
      return new Vec3(x, y, p.heights[i] - frame.heightM + curvatureDropZ(Math.hypot(x, y)) + extra);
    };
    const eye = frame.enuToEcef(enuAt(0, this.eyeM));
    const tgt = frame.enuToEcef(enuAt(n - 1, this.targetM));
    const toRemove = this.ds.entities.values.filter((e) => e.name === 'los' || e.name === 'crest');
    for (const e of toRemove) this.ds.entities.remove(e);
    const split = los.firstBlockIndex >= 0 ? los.firstBlockIndex / (n - 1) : 1;
    const mid = Cesium.Cartesian3.lerp(eye, tgt, split, new Cesium.Cartesian3());
    const ray = (from: Cesium.Cartesian3, to: Cesium.Cartesian3, cssVar: string) =>
      this.ds.entities.add({
        name: 'los',
        polyline: {
          positions: [from, to],
          width: 2.5,
          arcType: Cesium.ArcType.NONE,
          material: tokenColor(cssVar, 0.95),
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: tokenColor(cssVar, 0.55), dashLength: 10 }),
        },
      });
    ray(eye, mid, '--ua-ok');
    if (split < 1) ray(mid, tgt, '--ua-danger');
    // Marca y rótulo de la cresta que tapa.
    if (this.crestLabel) {
      this.lbs.remove(this.crestLabel);
      this.crestLabel = null;
    }
    if (los.worstIndex >= 0) {
      const crest = frame.enuToEcef(enuAt(los.worstIndex, 0));
      this.ds.entities.add({
        name: 'crest',
        position: crest,
        point: {
          pixelSize: 10,
          color: tokenColor('--ua-danger'),
          outlineColor: tokenColor('--ua-text-inverse'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.crestLabel = this.lbs.add({
        ...tagLabel(`CRESTA +${los.worstExcessM.toFixed(0)} m`, {
          font: FONT_DATA_SMALL, color: tokenColor('--ua-danger'), vertical: 'bottom', offset: new Cesium.Cartesian2(0, -10),
        }),
        position: crest,
      });
    }
  }

  private setHover(i: number): void {
    if (i === this.hoverIdx) return;
    this.hoverIdx = i;
    const p = this.profile;
    if (!p) return;
    drawProfile(this.canvas, p, i);
    const ends = this.profileEnds;
    if (!ends || i < 0) {
      if (this.hoverBb) this.hoverBb.show = false;
      return;
    }
    const frame = this.frameOf();
    const f = i / (p.distances.length - 1);
    const x = ends.aEnu.x + (ends.bEnu.x - ends.aEnu.x) * f;
    const y = ends.aEnu.y + (ends.bEnu.y - ends.aEnu.y) * f;
    const pos = frame.enuToEcef(new Vec3(x, y, p.heights[i] - frame.heightM + curvatureDropZ(Math.hypot(x, y))));
    if (!this.hoverBb) {
      this.hoverBb = this.bbs.add({ position: pos, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      applySymbol(this.hoverBb, SYM.dot(token('--ua-accent'), '', 14));
    }
    this.hoverBb.position = pos;
    this.hoverBb.show = true;
  }

  private mark(pos: Cesium.Cartesian3, def: ReturnType<typeof SYM.dot>): void {
    const b = this.bbs.add({ position: pos, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    applySymbol(b, def);
    this.marks.push(b);
  }

  private setStat(k: keyof MeasureTool['stats'], html: string, sub = ''): void {
    const s = this.stats[k];
    s.querySelector('.v')!.innerHTML = html;
    let v2 = s.querySelector<HTMLDivElement>('.v2');
    if (sub) {
      if (!v2) {
        v2 = el('div', 'v2');
        s.appendChild(v2);
      }
      v2.textContent = sub;
    } else if (v2) {
      v2.remove();
    }
  }

  private setLos(state: 'visible' | 'blocked' | 'pending', text: string, sub = ''): void {
    this.setStat('los', `<span class="ua-los" data-los="${state}">${text}</span>`, sub);
  }

  dispose(): void {
    void this.viewer.dataSources.remove(this.ds, true);
    const prims = this.viewer.scene.primitives;
    prims.remove(this.pls);
    prims.remove(this.bbs);
    prims.remove(this.lbs);
    this.card.remove();
  }
}
