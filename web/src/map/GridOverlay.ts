// ============================================================================
//  map/GridOverlay.ts — Rejilla MGRS/UTM drapeada + rótulos de borde. [V2:MAP]
//
//  Líneas de 1 km cerca (10 km al alejarse, 100 km en vista regional),
//  drapeadas sobre el terreno (y sobre los edificios 3D si están). Se
//  reconstruye SOLO cuando la vista cambia de forma significativa (foco
//  desplazado > 30 % de la ventana, altura ×1.5 o paso distinto). Los
//  rótulos de 2 cifras van en los bordes inferior (eastings) e izquierdo
//  (northings) del área de mapa, como en una hoja topográfica, y se
//  recolocan con la cámara a ≤ 10 Hz.
// ============================================================================
import * as Cesium from 'cesium';
import { el, mapViewportRect } from './dom';
import { GridLine, SquareLabel, buildGrid, clampBoxAround, gridSpacingForHeight, maxHalfExtentM } from './grid';
import { tokenColor } from './theme';

interface ProjectedLine {
  line: GridLine;
  positions: Cesium.Cartesian3[];
}

export class GridOverlay {
  private readonly ds = new Cesium.CustomDataSource('ua-grid');
  private readonly labelsEl: HTMLDivElement;
  private enabled = false;
  private tone: 'dark' | 'light' = 'dark';
  private builtFor: { lat: number; lon: number; h: number; spacing: number } | null = null;
  private lines: ProjectedLine[] = [];
  private squares: { sq: SquareLabel; pos: Cesium.Cartesian3 }[] = [];
  private labelPool: HTMLDivElement[] = [];
  private lastLabelAt = 0;
  private dirtyLabels = true;
  private readonly removeListeners: (() => void)[] = [];
  private readonly scratch = new Cesium.Cartesian2();
  private readonly lastView = new Cesium.Matrix4();

  constructor(
    private readonly viewer: Cesium.Viewer,
    parent: HTMLElement,
    private readonly fallbackHeight: () => number,
  ) {
    void viewer.dataSources.add(this.ds);
    this.ds.show = false;
    this.labelsEl = el('div', 'ua-grid-labels');
    this.labelsEl.style.display = 'none';
    parent.appendChild(this.labelsEl);
    const cam = viewer.camera;
    this.removeListeners.push(
      cam.changed.addEventListener(() => { this.dirtyLabels = true; this.maybeRebuild(); }),
      cam.moveEnd.addEventListener(() => { this.dirtyLabels = true; this.maybeRebuild(true); }),
      viewer.scene.postRender.addEventListener(() => this.tickLabels()),
    );
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.ds.show = on;
    this.labelsEl.style.display = on ? '' : 'none';
    if (on) this.maybeRebuild(true);
    this.dirtyLabels = true;
  }

  /** Tono de la capa base: rejilla clara sobre satélite/oscuro, oscura sobre papel. */
  setTone(tone: 'dark' | 'light'): void {
    if (tone === this.tone) return;
    this.tone = tone;
    this.labelsEl.classList.toggle('light', tone === 'light');
    this.builtFor = null;
    if (this.enabled) this.maybeRebuild(true);
  }

  /** Foco de la vista: punto del globo en el centro del área de mapa. */
  private viewFocus(): { lat: number; lon: number; h: number } | null {
    const scene = this.viewer.scene;
    const cam = this.viewer.camera;
    const r = mapViewportRect();
    const center = new Cesium.Cartesian2((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    const ray = cam.getPickRay(center);
    let p: Cesium.Cartesian3 | undefined;
    if (ray) p = scene.globe.pick(ray, scene) ?? undefined;
    if (!p) p = cam.pickEllipsoid(center, scene.globe.ellipsoid) ?? undefined;
    const h = cam.positionCartographic.height;
    if (!p) return null;
    const c = Cesium.Cartographic.fromCartesian(p);
    const groundH = Number.isFinite(c.height) ? c.height : 0;
    return {
      lat: Cesium.Math.toDegrees(c.latitude),
      lon: Cesium.Math.toDegrees(c.longitude),
      h: Math.max(1, h - groundH),
    };
  }

  private maybeRebuild(force = false): void {
    if (!this.enabled) return;
    const f = this.viewFocus();
    if (!f) return;
    // Altura efectiva: distancia de la cámara al foco (vistas oblicuas).
    const spacing = gridSpacingForHeight(f.h);
    if (spacing === null) {
      if (this.lines.length) this.clear();
      this.builtFor = null;
      return;
    }
    const b = this.builtFor;
    if (b && !force && b.spacing === spacing) {
      const moved = Math.hypot((f.lat - b.lat) * 111_320, (f.lon - b.lon) * 111_320 * Math.cos((f.lat * Math.PI) / 180));
      if (moved < maxHalfExtentM(spacing) * 0.3 && f.h / b.h < 1.5 && b.h / f.h < 1.5) return;
    }
    if (b && force && b.spacing === spacing) {
      const moved = Math.hypot((f.lat - b.lat) * 111_320, (f.lon - b.lon) * 111_320 * Math.cos((f.lat * Math.PI) / 180));
      if (moved < spacing * 0.5 && Math.abs(f.h / b.h - 1) < 0.2) return;
    }
    this.build(f, spacing);
  }

  private clear(): void {
    this.ds.entities.removeAll();
    this.lines = [];
    this.squares = [];
  }

  private build(f: { lat: number; lon: number; h: number }, spacing: number): void {
    const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
    const half = maxHalfExtentM(spacing);
    const viewBox = rect
      ? {
          west: Cesium.Math.toDegrees(rect.west), east: Cesium.Math.toDegrees(rect.east),
          south: Cesium.Math.toDegrees(rect.south), north: Cesium.Math.toDegrees(rect.north),
        }
      : { west: f.lon - 5, east: f.lon + 5, south: f.lat - 5, north: f.lat + 5 };
    if (viewBox.east < viewBox.west) viewBox.east += 360; // antimeridiano: simplificación
    const box = clampBoxAround(viewBox, f.lat, f.lon, half);
    let res = buildGrid(box, spacing, 170);
    if (!res.lines.length && spacing < 100_000) res = buildGrid(box, spacing * 10, 170);
    this.builtFor = { lat: f.lat, lon: f.lon, h: f.h, spacing };

    const ents = this.ds.entities;
    ents.suspendEvents();
    ents.removeAll();
    const light = this.tone === 'light';
    const minor = light ? tokenColor('--ua-text-inverse', 0.4) : tokenColor('--ua-text-1', 0.34);
    const major = light ? tokenColor('--ua-text-inverse', 0.75) : tokenColor('--ua-accent', 0.7);
    const globe = this.viewer.scene.globe;
    const fb = this.fallbackHeight();
    this.lines = res.lines.map((line) => {
      const positions = line.points.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      ents.add({
        polyline: {
          positions,
          clampToGround: true,
          width: line.major ? 1.6 : 1,
          material: line.major ? major : minor,
        },
      });
      // Para los rótulos: vértices a la cota del terreno (si está cargado).
      const labelPositions = line.points.map(([lon, lat]) => {
        const h = globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
        return Cesium.Cartesian3.fromDegrees(lon, lat, h ?? fb);
      });
      return { line, positions: labelPositions };
    });
    ents.resumeEvents();
    this.squares = res.squares.map((sq) => ({
      sq, pos: Cesium.Cartesian3.fromDegrees(sq.lonDeg, sq.latDeg, globe.getHeight(Cesium.Cartographic.fromDegrees(sq.lonDeg, sq.latDeg)) ?? fb),
    }));
    this.dirtyLabels = true;
  }

  /** Rótulos en los bordes del área de mapa (≤ 10 Hz, solo si la vista cambió). */
  private tickLabels(): void {
    if (!this.enabled) return;
    const vm = this.viewer.camera.viewMatrix;
    if (!Cesium.Matrix4.equalsEpsilon(vm, this.lastView, 1e-10)) {
      Cesium.Matrix4.clone(vm, this.lastView);
      this.dirtyLabels = true;
    }
    if (!this.dirtyLabels) return;
    const now = performance.now();
    if (now - this.lastLabelAt < 100) return;
    this.lastLabelAt = now;
    this.dirtyLabels = false;

    const r = mapViewportRect();
    const yEdge = r.bottom - 14;
    const xEdge = r.left + 18;
    const scene = this.viewer.scene;
    const placed: { x: number; y: number; text: string; cls: string }[] = [];
    const screen = (p: Cesium.Cartesian3) =>
      Cesium.SceneTransforms.worldToWindowCoordinates(scene, p, this.scratch)?.clone();

    for (const { line, positions } of this.lines) {
      if (!line.label) continue;
      let prev: Cesium.Cartesian2 | undefined;
      for (const p of positions) {
        const s = screen(p);
        if (s && prev) {
          if (line.axis === 'E') {
            if ((prev.y - yEdge) * (s.y - yEdge) <= 0 && prev.y !== s.y) {
              const t = (yEdge - prev.y) / (s.y - prev.y);
              const x = prev.x + (s.x - prev.x) * t;
              if (x > r.left + 30 && x < r.right - 30) {
                placed.push({ x, y: yEdge, text: line.label, cls: line.major ? 'major' : '' });
                break;
              }
            }
          } else if ((prev.x - xEdge) * (s.x - xEdge) <= 0 && prev.x !== s.x) {
            const t = (xEdge - prev.x) / (s.x - prev.x);
            const y = prev.y + (s.y - prev.y) * t;
            if (y > r.top + 20 && y < r.bottom - 30) {
              placed.push({ x: xEdge, y, text: line.label, cls: line.major ? 'major' : '' });
              break;
            }
          }
        }
        prev = s;
      }
    }
    for (const { sq, pos } of this.squares) {
      const s = screen(pos);
      if (s && s.x > r.left + 40 && s.x < r.right - 40 && s.y > r.top + 30 && s.y < r.bottom - 30) {
        placed.push({ x: s.x, y: s.y, text: sq.id, cls: 'sq' });
      }
    }

    // Reutiliza nodos: sin churn de DOM por movimiento de cámara.
    while (this.labelPool.length < placed.length) {
      const d = el('div', 'ua-grid-label');
      this.labelsEl.appendChild(d);
      this.labelPool.push(d);
    }
    this.labelPool.forEach((d, i) => {
      const p = placed[i];
      if (!p) {
        d.style.display = 'none';
        return;
      }
      d.style.display = '';
      d.className = `ua-grid-label ${p.cls}`;
      if (d.textContent !== p.text) d.textContent = p.text;
      d.style.left = `${p.x.toFixed(1)}px`;
      d.style.top = `${p.y.toFixed(1)}px`;
    });
  }

  dispose(): void {
    for (const off of this.removeListeners) off();
    void this.viewer.dataSources.remove(this.ds, true);
    this.labelsEl.remove();
  }
}
