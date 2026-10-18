// ============================================================================
//  map/RangeFanLayer.ts — Abanico de tiro drapeado sobre el terreno. [V2:MAP]
//
//  Capa estática (se reconstruye SOLO si cambian alcance, traverse, centro
//  del sector o el marco de la batería): corona/sector translúcido entre el
//  alcance mínimo y el máximo, zona muerta interior, anillo máximo sólido,
//  mínimo discontinuo, anillos intermedios discontinuos y radiales de los
//  límites de traverse. Capa dinámica barata (cada cambio de puntería):
//  línea de tiro con punta de flecha (fuente de datos propia: su
//  reconstrucción no arrastra a las demás) y rótulos de distancia de los
//  anillos colocados junto a la línea de tiro.
// ============================================================================
import * as Cesium from 'cesium';
import { Vec3 } from '../ballistics';
import type { GeoFrame } from '../frame';
import {
  P2, curvatureDropZ, fanShape, intermediateRings, isSectorLimited, polar, updateSectorCenter,
} from './fanGeometry';
import { FONT_DATA_SMALL, FONT_TAG_SMALL, tagLabel, tokenColor } from './theme';
import { formatDistance, formatMils } from './units';

export class RangeFanLayer {
  private readonly ds = new Cesium.CustomDataSource('ua-fan');
  private readonly lofDs = new Cesium.CustomDataSource('ua-line-of-fire');
  private readonly labels: Cesium.LabelCollection;

  private minM = NaN;
  private maxM = NaN;
  private traverseDeg = 360;
  private centerDeg: number | null = null;
  private layDeg = 0;
  private builtKey = '';
  private lofKey = '';
  private lofTimer: number | undefined;
  private lastLofAt = 0;
  private visible = true;
  private ringLabels: { label: Cesium.Label; r: number }[] = [];
  private ringLabelsOn = true;
  private lofLabel: Cesium.Label | null = null;
  private lofEntity: Cesium.Entity | null = null;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly frameOf: () => GeoFrame,
  ) {
    void viewer.dataSources.add(this.ds);
    void viewer.dataSources.add(this.lofDs);
    this.labels = viewer.scene.primitives.add(new Cesium.LabelCollection({ scene: viewer.scene }));
  }

  /** Alcances del arma/carga vigente (RingRenderer de TrajectoryPreview). */
  setRange(minRangeM: number, maxRangeM: number): void {
    this.minM = minRangeM;
    this.maxM = maxRangeM;
    this.rebuildIfNeeded();
  }

  setTraverse(traverseDeg: number): void {
    if (traverseDeg !== this.traverseDeg) {
      this.traverseDeg = traverseDeg;
      this.centerDeg = null; // arma nueva: el sector se centra en la puntería
    }
    this.rebuildIfNeeded();
  }

  /** Puntería actual (barato): recoloca línea de tiro y rótulos. */
  setLay(azDeg: number): void {
    this.layDeg = azDeg;
    const c = updateSectorCenter(this.centerDeg, azDeg, this.traverseDeg);
    if (c !== this.centerDeg) {
      this.centerDeg = c;
      this.rebuildIfNeeded();
    }
    this.placeDynamic();
  }

  /** El marco de la batería cambió: todo se rehace. */
  invalidate(): void {
    this.builtKey = '';
    this.lofKey = '';
    this.centerDeg = null;
    this.setLay(this.layDeg);
    this.rebuildIfNeeded();
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.ds.show = on;
    this.lofDs.show = on;
    this.labels.show = on;
  }

  /**
   * Rótulos de los anillos: solo en vistas que miran hacia abajo. En una
   * oblicua rasante se apilan junto al horizonte y estorban.
   */
  setRingLabelsVisible(on: boolean): void {
    if (on === this.ringLabelsOn) return;
    this.ringLabelsOn = on;
    for (const { label } of this.ringLabels) label.show = on;
  }

  get sectorCenterDeg(): number | null {
    return this.centerDeg;
  }

  get maxRangeM(): number {
    return this.maxM;
  }

  get minRangeM(): number {
    return this.minM;
  }

  get traverse(): number {
    return this.traverseDeg;
  }

  private surface(pts: P2[]): Cesium.Cartesian3[] {
    const frame = this.frameOf();
    return pts.map((p) => frame.enuToEcef(new Vec3(p.x, p.y, curvatureDropZ(Math.hypot(p.x, p.y)))));
  }

  private rebuildIfNeeded(): void {
    if (!(this.maxM > 0)) return;
    const sector = isSectorLimited(this.traverseDeg);
    const center = sector ? (this.centerDeg ?? this.layDeg) : 0;
    const frame = this.frameOf();
    const key = [
      frame.lonDeg.toFixed(6), frame.latDeg.toFixed(6), this.minM.toFixed(0), this.maxM.toFixed(0),
      this.traverseDeg, center.toFixed(2),
    ].join('|');
    if (key === this.builtKey) return;
    this.builtKey = key;
    this.build(center);
    this.placeDynamic();
  }

  private build(centerDeg: number): void {
    const ents = this.ds.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const r of this.ringLabels) this.labels.remove(r.label);
    this.ringLabels = [];

    const shape = fanShape(this.minM, this.maxM, this.traverseDeg, centerDeg);
    const friendly = (a: number) => tokenColor('--ua-friendly', a);
    const hasMin = !!shape.inner;

    // Relleno de la zona batible (corona o sector).
    ents.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          this.surface(shape.full ? shape.fill.slice(0, -1) : shape.fill),
          shape.fillHole ? [new Cesium.PolygonHierarchy(this.surface(shape.fillHole.slice(0, -1)))] : [],
        ),
        material: friendly(0.13),
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    // Zona muerta (dentro del alcance mínimo): tinte de advertencia.
    if (hasMin) {
      const dead = shape.full
        ? shape.inner!.slice(0, -1)
        : [...shape.inner!, { x: 0, y: 0 }];
      ents.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(this.surface(dead)),
          material: tokenColor('--ua-warn', 0.09),
          classificationType: Cesium.ClassificationType.BOTH,
        },
      });
    }
    // Anillo máximo: sólido.
    ents.add({
      polyline: {
        positions: this.surface(shape.outer),
        clampToGround: true,
        width: 2.5,
        material: friendly(0.95),
      },
    });
    // Anillo mínimo: discontinuo de advertencia.
    if (shape.inner) {
      ents.add({
        polyline: {
          positions: this.surface(shape.inner),
          clampToGround: true,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: tokenColor('--ua-warn', 0.9), dashLength: 18,
          }),
        },
      });
    }
    // Anillos intermedios: discontinuos y tenues.
    const rings = intermediateRings(hasMin ? this.minM : 0, this.maxM);
    for (const r of rings) {
      const pts = shape.full
        ? polarCircle(r)
        : arcBetween(r, shape.leftAzDeg, shape.rightAzDeg);
      ents.add({
        polyline: {
          positions: this.surface(pts),
          clampToGround: true,
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({ color: friendly(0.45), dashLength: 12 }),
        },
      });
    }
    // Límites de traverse.
    if (shape.limits) {
      for (const lim of shape.limits) {
        ents.add({
          polyline: {
            positions: this.surface(densify(lim[0], lim[1], 24)),
            clampToGround: true,
            width: 2,
            material: friendly(0.75),
          },
        });
      }
    }
    ents.resumeEvents();

    // Rótulos de los anillos (se recolocan junto a la línea de tiro).
    const mk = (r: number, text: string, color: Cesium.Color) => {
      const label = this.labels.add({
        ...tagLabel(text, { font: FONT_TAG_SMALL, color, origin: 'left', vertical: 'center', offset: new Cesium.Cartesian2(6, 0) }),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        position: Cesium.Cartesian3.ZERO,
        show: this.ringLabelsOn,
      });
      this.ringLabels.push({ label, r });
    };
    for (const r of rings) mk(r, formatDistance(r), tokenColor('--ua-text-2'));
    // El MÍN solo se rotula si se separa de la batería (si no, tapa su ficha).
    if (hasMin && this.minM > 0.08 * this.maxM) {
      mk(this.minM, `MÍN ${formatDistance(this.minM)}`, tokenColor('--ua-warn'));
    }
    mk(this.maxM, `MÁX ${formatDistance(this.maxM)}`, tokenColor('--ua-friendly'));
    this.labels.show = this.visible;
  }

  /** Rótulos junto a la línea de tiro + la línea (con cadencia acotada). */
  private placeDynamic(): void {
    if (!(this.maxM > 0)) return;
    const frame = this.frameOf();
    // Rótulos lejos de la línea de tiro (donde viven el arco, el objetivo y
    // sus fichas): junto al límite izquierdo del sector, o a 90º a la
    // derecha de la línea de tiro si el arma gira 360º.
    const az = isSectorLimited(this.traverseDeg) && this.centerDeg !== null
      ? this.centerDeg - this.traverseDeg / 2 + Math.min(2.5, this.traverseDeg * 0.08)
      : this.layDeg + 90;
    for (const { label, r } of this.ringLabels) {
      const p = polar(r, az);
      label.position = frame.enuToEcef(new Vec3(p.x, p.y, curvatureDropZ(r)));
    }
    this.scheduleLineOfFire();
  }

  private scheduleLineOfFire(): void {
    const key = `${this.builtKey}|${this.layDeg.toFixed(2)}`;
    if (key === this.lofKey) return;
    const now = performance.now();
    const wait = Math.max(0, 140 - (now - this.lastLofAt));
    window.clearTimeout(this.lofTimer);
    this.lofTimer = window.setTimeout(() => {
      this.lastLofAt = performance.now();
      this.lofKey = `${this.builtKey}|${this.layDeg.toFixed(2)}`;
      this.buildLineOfFire();
    }, wait);
  }

  private buildLineOfFire(): void {
    const frame = this.frameOf();
    const r1 = this.maxM * 1.04;
    const pts = densify({ x: 0, y: 0 }, polar(r1, this.layDeg), 48);
    if (this.lofEntity) this.lofDs.entities.remove(this.lofEntity);
    this.lofEntity = this.lofDs.entities.add({
      polyline: {
        positions: this.surface(pts),
        clampToGround: true,
        width: 9,
        material: new Cesium.PolylineArrowMaterialProperty(tokenColor('--ua-accent', 0.85)),
      },
    });
    const tip = polar(r1, this.layDeg);
    const tipPos = frame.enuToEcef(new Vec3(tip.x, tip.y, curvatureDropZ(r1)));
    if (!this.lofLabel) {
      this.lofLabel = this.labels.add({
        ...tagLabel('', { font: FONT_DATA_SMALL, color: tokenColor('--ua-accent'), vertical: 'bottom', offset: new Cesium.Cartesian2(0, -10) }),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        position: tipPos,
      });
    }
    this.lofLabel.position = tipPos;
    this.lofLabel.text = `AZ ${formatMils(this.layDeg)} mil`;
  }

  dispose(): void {
    window.clearTimeout(this.lofTimer);
    void this.viewer.dataSources.remove(this.ds, true);
    void this.viewer.dataSources.remove(this.lofDs, true);
    this.viewer.scene.primitives.remove(this.labels);
  }
}

function polarCircle(r: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= 144; i++) out.push(polar(r, (360 * i) / 144));
  return out;
}

function arcBetween(r: number, leftAz: number, rightAz: number): P2[] {
  let sweep = (((rightAz - leftAz) % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  const n = Math.max(2, Math.ceil(sweep / 2.5));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push(polar(r, leftAz + (sweep * i) / n));
  return out;
}

/** Segmento A→B con n tramos (para que el drapeado siga el relieve). */
function densify(a: P2, b: P2, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}
