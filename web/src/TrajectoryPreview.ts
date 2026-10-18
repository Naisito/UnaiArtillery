// ============================================================================
//  TrajectoryPreview.ts — Arco de tiro y marcadores sobre el globo.
//  [P2.3 web · rediseño V2:MAP]
//
//  Pinta, con oclusión correcta contra el relieve:
//    * el arco previsto con halo luminoso (la parte tapada por el terreno se
//      insinúa punteada) y su TRAZA sobre el terreno (proyección drapeada),
//    * el ápice (chevrón + cota + instante) con su vertical punteada,
//    * el punto de impacto previsto (retícula) con alcance, TOF, ángulo y
//      velocidad de caída y la dispersión 1σ,
//    * la elipse de dispersión 1σ/2σ drapeada sobre el terreno,
//    * el objetivo designado en simbología APP-6 (rombo hostil con número
//      de objetivo, distancia y demora en milésimas),
//    * los arcos del modo comparación con su leyenda,
//    * la diana de los retos con sus anillos de estrellas,
//    * los anillos de alcance: si MapInteraction instala su abanico de tiro
//      (setRingRenderer), se le delegan; si no, anillos simples.
//  API pública idéntica a la anterior (la usan ArtilleryPiece, Challenge y
//  ForwardObserver) + setRingRenderer / targetDesignation.
// ============================================================================
import * as Cesium from 'cesium';
import { FlightResult, Vec3 } from './ballistics';
import { GeoFrame } from './frame';
import { SYM, applySymbol, warmSymbols, SymbolDef } from './map/mapSymbols';
import {
  FONT_DATA_SMALL, FONT_TAG, FONT_TAG_SMALL, LabelOpts, tagLabel, token, tokenColor,
} from './map/theme';
import { circlePoints, curvatureDropZ, decimate, ellipsePoints, P2 } from './map/fanGeometry';
import { vincentyInverse } from './map/geodesy';
import { formatDistance, formatHeight, formatMils, formatSeconds } from './map/units';
import { el, mapRoot } from './map/dom';
import { ICON } from './map/icons';

/** Quien dibuja los anillos/abanico de alcance (MapInteraction). */
export interface RingRenderer {
  setRange(minRangeM: number, maxRangeM: number): void;
}

/** Contenedor de una capa lógica: entidades + primitivas, borrables juntas. */
class Group {
  entities: Cesium.Entity[] = [];
  billboards: Cesium.Billboard[] = [];
  labels: Cesium.Label[] = [];
  polylines: Cesium.Polyline[] = [];

  constructor(
    private readonly ds: Cesium.CustomDataSource,
    private readonly bbs: Cesium.BillboardCollection,
    private readonly lbs: Cesium.LabelCollection,
    private readonly pls: Cesium.PolylineCollection,
  ) {}

  entity(opts: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const e = this.ds.entities.add(opts);
    this.entities.push(e);
    return e;
  }

  billboard(position: Cesium.Cartesian3, def: SymbolDef, extra: Partial<Cesium.Billboard.ConstructorOptions> = {}): Cesium.Billboard {
    const b = this.bbs.add({
      position,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(1.5e3, 1.0, 3e5, 0.6),
      ...extra,
    });
    applySymbol(b, def);
    this.billboards.push(b);
    return b;
  }

  label(position: Cesium.Cartesian3, opts: LabelOpts): Cesium.Label {
    const l = this.lbs.add({ ...opts, position });
    this.labels.push(l);
    return l;
  }

  polyline(opts: Parameters<Cesium.PolylineCollection['add']>[0]): Cesium.Polyline {
    const p = this.pls.add(opts);
    this.polylines.push(p);
    return p;
  }

  get empty(): boolean {
    return !this.entities.length && !this.billboards.length && !this.labels.length && !this.polylines.length;
  }

  clear(): void {
    for (const e of this.entities) this.ds.entities.remove(e);
    for (const b of this.billboards) this.bbs.remove(b);
    for (const l of this.labels) this.lbs.remove(l);
    for (const p of this.polylines) this.pls.remove(p);
    this.entities = [];
    this.billboards = [];
    this.labels = [];
    this.polylines = [];
  }
}

export class TrajectoryPreview {
  private readonly ds = new Cesium.CustomDataSource('ua-preview');
  /** Símbolos de suelo (objetivo, diana, impactos de comparación). */
  private readonly bbsUnder: Cesium.BillboardCollection;
  /** Marcadores de la solución (impacto previsto, ápice): siempre encima. */
  private readonly bbs: Cesium.BillboardCollection;
  private readonly lbs: Cesium.LabelCollection;
  private readonly pls: Cesium.PolylineCollection;

  private readonly arc: Group;
  private readonly rings: Group;
  private readonly compare: Group;
  private readonly target: Group;
  private readonly errorEllipse: Group;
  private readonly challenge: Group;

  private ringRenderer: RingRenderer | null = null;
  private legendEl: HTMLDivElement | null = null;

  /** Número de objetivo vigente ("AB1001"): cambia con cada designación nueva. */
  targetDesignation = '';
  private targetSeq = 1000;
  private lastTargetEnu: Vec3 | null = null;

  /** Etiqueta del impacto previsto (se reescribe al llegar la dispersión). */
  private impactLabel: Cesium.Label | null = null;
  private impactLines: string[] = [];
  private dispersionLine = '';

  /** Modo inmersión: ocultar el arco de preview y ver solo el proyectil. */
  private arcVisible = true;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private frameOf: () => GeoFrame,
  ) {
    void viewer.dataSources.add(this.ds);
    const scene = viewer.scene;
    this.pls = scene.primitives.add(new Cesium.PolylineCollection());
    this.bbsUnder = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.bbs = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.lbs = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    const g = (under = false) => new Group(this.ds, under ? this.bbsUnder : this.bbs, this.lbs, this.pls);
    this.arc = g();
    this.rings = g();
    this.compare = g(true);
    this.target = g(true);
    this.errorEllipse = g();
    this.challenge = g(true);
    warmSymbols([SYM.aimpoint(), SYM.apex(), SYM.target(), SYM.challenge()]);
  }

  /** MapInteraction instala su abanico de tiro: los anillos van a él. */
  setRingRenderer(r: RingRenderer | null): void {
    this.ringRenderer = r;
    if (r) this.rings.clear();
  }

  // -- utilidades -------------------------------------------------------------
  private positionsOf(result: FlightResult, maxPoints = 320): Cesium.Cartesian3[] {
    const frame = this.frameOf();
    const path = result.path;
    const step = Math.max(1, Math.floor(path.length / maxPoints));
    const out: Cesium.Cartesian3[] = [];
    for (let i = 0; i < path.length; i += step) out.push(frame.enuToEcef(path[i].position));
    if (path.length) out.push(frame.enuToEcef(path[path.length - 1].position));
    return out;
  }

  /** Puntos ENU 2D → posiciones sobre la superficie (para drapear). */
  private surface(pts: P2[]): Cesium.Cartesian3[] {
    const frame = this.frameOf();
    return pts.map((p) => frame.enuToEcef(new Vec3(p.x, p.y, curvatureDropZ(Math.hypot(p.x, p.y)))));
  }

  /** Distancia geodésica y demora desde la batería a un punto ENU. */
  private rangeBearing(enu: Vec3): { rangeM: number; bearingDeg: number } {
    const frame = this.frameOf();
    const c = frame.cartographicOfEnu(enu);
    const r = vincentyInverse(
      frame.latDeg, frame.lonDeg, Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude),
    );
    return { rangeM: r.distanceM, bearingDeg: r.initialBearingDeg };
  }

  // -- arco previsto ------------------------------------------------------------
  setArcVisible(on: boolean): void {
    this.arcVisible = on;
    if (!on) this.clearArc();
  }

  /** Dibuja el arco previsto + traza + ápice + impacto. */
  showFlight(result: FlightResult, cssColor = token('--ua-accent')): void {
    this.clearArc();
    if (!this.arcVisible) return; // inmersión: sin parábola ni marcadores
    if (result.path.length < 2) return;
    const frame = this.frameOf();
    const color = Cesium.Color.fromCssColorString(cssColor) ?? tokenColor('--ua-accent');
    const positions = this.positionsOf(result);

    // Arco con halo (visible) + punteado fino para lo que tapa el relieve.
    this.arc.entity({
      polyline: {
        positions,
        width: 11,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: color.withAlpha(0.95), glowPower: 0.14, taperPower: 1.0,
        }),
      },
    });
    this.arc.entity({
      polyline: {
        positions,
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: Cesium.Color.TRANSPARENT,
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.6), dashLength: 12,
        }),
      },
    });

    // Traza sobre el terreno (proyección del arco), drapeada y punteada.
    const ground = decimate(result.path, 96).map((s) => ({ x: s.position.x, y: s.position.y }));
    if (Math.hypot(result.impactPoint.x, result.impactPoint.y) > 5) {
      this.arc.entity({
        polyline: {
          positions: this.surface(ground),
          clampToGround: true,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: tokenColor('--ua-text-1', 0.7), gapColor: Cesium.Color.TRANSPARENT, dashLength: 14,
          }),
        },
      });
    }

    // Ápice: chevrón, cota sobre la batería y su vertical punteada.
    let apexIdx = 0;
    for (let i = 1; i < result.path.length; i++) {
      if (result.path[i].position.z > result.path[apexIdx].position.z) apexIdx = i;
    }
    const apex = result.path[apexIdx];
    const range = Math.hypot(result.impactPoint.x, result.impactPoint.y);
    if (apex.position.z > 30 && apexIdx > 0 && apexIdx < result.path.length - 1) {
      const apexPos = frame.enuToEcef(apex.position);
      this.arc.billboard(apexPos, SYM.apex());
      this.arc.label(apexPos, tagLabel(
        `ÁPICE ${formatHeight(apex.position.z)} · t ${formatSeconds(apex.t)}`,
        { font: FONT_DATA_SMALL, color: tokenColor('--ua-info'), origin: 'left', vertical: 'center', offset: new Cesium.Cartesian2(14, 0) },
      ));
      const hr = Math.hypot(apex.position.x, apex.position.y);
      const f = range > 1 ? Math.min(1, hr / range) : 0;
      // Cota aprox. del suelo bajo el ápice: relieve interpolado entre la
      // batería y el impacto + caída por curvatura (cuadrática) en ese punto.
      const reliefImpact = result.impactPoint.z - curvatureDropZ(range);
      const groundZ = reliefImpact * f + curvatureDropZ(hr);
      this.arc.polyline({
        positions: [apexPos, frame.enuToEcef(new Vec3(apex.position.x, apex.position.y, groundZ))],
        width: 1.5,
        material: Cesium.Material.fromType('PolylineDash', {
          color: tokenColor('--ua-info', 0.55), dashLength: 10,
        }),
      });
    }

    // Impacto previsto: retícula + ficha con los datos de la solución.
    const impactPos = frame.enuToEcef(result.impactPoint);
    this.arc.billboard(impactPos, SYM.aimpoint(cssColor));
    const last = result.path[result.path.length - 1];
    const v = last.velocity;
    const fallDeg = (Math.atan2(-v.z, Math.hypot(v.x, v.y)) * 180) / Math.PI;
    const air = result.detonation === 'air' && result.burstHeightM > 1;
    this.impactLines = [
      `${formatDistance(result.downrange)} · TOF ${formatSeconds(result.timeOfFlight)}`,
      air
        ? `ESTALLIDO a ${result.burstHeightM.toFixed(0)} m · ${result.impactSpeed.toFixed(0)} m/s`
        : `caída ${fallDeg.toFixed(1)}° · ${result.impactSpeed.toFixed(0)} m/s`,
    ];
    this.impactLabel = this.arc.label(impactPos, tagLabel(this.impactText(), {
      font: FONT_DATA_SMALL, origin: 'left', vertical: 'top', offset: new Cesium.Cartesian2(20, 10),
    }));
  }

  private impactText(): string {
    return this.dispersionLine ? [...this.impactLines, this.dispersionLine].join('\n') : this.impactLines.join('\n');
  }

  // -- anillos de alcance -------------------------------------------------------
  /** Anillos de alcance mín/máx de la carga actual alrededor de la batería. */
  showRings(minRangeM: number, maxRangeM: number): void {
    if (this.ringRenderer) {
      this.ringRenderer.setRange(minRangeM, maxRangeM);
      return;
    }
    this.clearRings();
    const frame = this.frameOf();
    const ring = (r: number, color: Cesium.Color, text: string, dashed: boolean) => {
      this.rings.entity({
        polyline: {
          positions: this.surface(circlePoints({ x: 0, y: 0 }, r, 128)),
          clampToGround: true,
          width: 2,
          material: dashed
            ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 16 })
            : new Cesium.ColorMaterialProperty(color),
        },
      });
      this.rings.label(
        frame.enuToEcef(new Vec3(0, r, curvatureDropZ(r))),
        tagLabel(text, { font: FONT_TAG_SMALL, color, vertical: 'center' }),
      );
    };
    if (Number.isFinite(minRangeM) && minRangeM > 200 && minRangeM < maxRangeM * 0.98) {
      ring(minRangeM, tokenColor('--ua-warn', 0.85), `MÍN ${formatDistance(minRangeM)}`, true);
    }
    if (maxRangeM > 0) {
      ring(maxRangeM, tokenColor('--ua-friendly', 0.9), `MÁX ${formatDistance(maxRangeM)}`, false);
    }
  }

  // -- objetivo -----------------------------------------------------------------
  /** Marca el objetivo designado (rombo hostil APP-6 con su número). */
  showTarget(targetEnu: Vec3 | null): void {
    this.target.clear();
    if (!targetEnu) {
      this.lastTargetEnu = null;
      return;
    }
    const moved = !this.lastTargetEnu ||
      Math.hypot(targetEnu.x - this.lastTargetEnu.x, targetEnu.y - this.lastTargetEnu.y) > 1;
    if (moved) this.targetSeq += 1;
    this.lastTargetEnu = targetEnu.clone();
    this.targetDesignation = `AB${this.targetSeq}`;
    const pos = this.frameOf().enuToEcef(targetEnu);
    const rb = this.rangeBearing(targetEnu);
    this.target.billboard(pos, SYM.target());
    this.target.label(pos, tagLabel(
      `OBJ ${this.targetDesignation}  ${formatDistance(rb.rangeM)} · ${formatMils(rb.bearingDeg)} mil`,
      { font: FONT_TAG, color: tokenColor('--ua-hostile'), origin: 'left', vertical: 'bottom', offset: new Cesium.Cartesian2(20, -10) },
    ));
  }

  // -- dispersión -----------------------------------------------------------------
  /**
   * P-PRO.6 — elipse de dispersión PREDICHA (1σ y 2σ) centrada en el impacto
   * previsto y orientada al rumbo, drapeada sobre el terreno. Semiejes =
   * σ_alcance / σ_deriva. Con null se borra.
   */
  showErrorEllipse(
    spec: {
      centerEnu: Vec3;
      bearingDeg: number;
      sigmaRangeM: number;
      sigmaCrossM: number;
    } | null,
  ): void {
    this.errorEllipse.clear();
    this.dispersionLine = '';
    if (spec && spec.sigmaRangeM > 0.5 && spec.sigmaCrossM > 0.5) {
      const { centerEnu, bearingDeg, sigmaRangeM, sigmaCrossM } = spec;
      const c = { x: centerEnu.x, y: centerEnu.y };
      const accent = token('--ua-accent');
      const col = (a: number) => (Cesium.Color.fromCssColorString(accent) ?? Cesium.Color.ORANGE).withAlpha(a);
      for (const [k, fillA, lineA, dashed] of [[2, 0.07, 0.6, true], [1, 0.17, 0.95, false]] as const) {
        const pts = ellipsePoints(c, bearingDeg, sigmaRangeM * k, sigmaCrossM * k, 72);
        const surf = this.surface(pts);
        this.errorEllipse.entity({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(surf.slice(0, -1)),
            material: col(fillA),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        this.errorEllipse.entity({
          polyline: {
            positions: surf,
            clampToGround: true,
            width: dashed ? 1.5 : 2,
            material: dashed
              ? new Cesium.PolylineDashMaterialProperty({ color: col(lineA), dashLength: 10 })
              : new Cesium.ColorMaterialProperty(col(lineA)),
          },
        });
        // Rótulo "1σ"/"2σ" en el flanco derecho (eje de deriva).
        const b = (bearingDeg * Math.PI) / 180;
        const side = new Vec3(
          c.x + Math.cos(b) * sigmaCrossM * k,
          c.y - Math.sin(b) * sigmaCrossM * k,
          centerEnu.z,
        );
        this.errorEllipse.label(this.frameOf().enuToEcef(side), {
          text: `${k}σ`,
          font: FONT_DATA_SMALL,
          fillColor: col(1),
          outlineColor: tokenColor('--ua-text-inverse'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(4, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: new Cesium.NearFarScalar(4e3, 1, 2.5e4, 0),
        });
      }
      this.dispersionLine = `1σ ±${sigmaRangeM.toFixed(0)} m alc. × ±${sigmaCrossM.toFixed(0)} m der.`;
    }
    if (this.impactLabel && this.arc.labels.includes(this.impactLabel)) {
      this.impactLabel.text = this.impactText();
    }
  }

  // -- reto ---------------------------------------------------------------------
  /**
   * P-PRO.7 — diana del reto (distinta del objetivo normal): símbolo dorado
   * y anillos con los umbrales de estrellas (25/75/150 m) drapeados para
   * leer el fallo sobre el terreno. Con null se borra.
   */
  showChallengeTarget(targetEnu: Vec3 | null): void {
    this.challenge.clear();
    if (!targetEnu) return;
    const frame = this.frameOf();
    const position = frame.enuToEcef(targetEnu);
    const gold = tokenColor('--ua-unknown');
    this.challenge.billboard(position, SYM.challenge());
    this.challenge.label(position, tagLabel('RETO', {
      font: FONT_TAG, color: gold, origin: 'left', vertical: 'center', offset: new Cesium.Cartesian2(24, 0),
    }));
    for (const [radius, alpha] of [[25, 0.95], [75, 0.6], [150, 0.35]] as const) {
      this.challenge.entity({
        polyline: {
          positions: this.surface(circlePoints({ x: targetEnu.x, y: targetEnu.y }, radius, 64)),
          clampToGround: true,
          width: 2,
          material: gold.withAlpha(alpha),
        },
      });
    }
  }

  // -- comparación --------------------------------------------------------------
  /** P4.2 — arcos superpuestos del modo comparación, con leyenda. */
  showCompare(list: { label: string; cssColor: string; result: FlightResult }[]): void {
    this.clearCompare();
    const frame = this.frameOf();
    for (const item of list) {
      const color = Cesium.Color.fromCssColorString(item.cssColor) ?? Cesium.Color.WHITE;
      this.compare.entity({
        polyline: {
          positions: this.positionsOf(item.result),
          width: 2.5,
          arcType: Cesium.ArcType.NONE,
          material: color.withAlpha(0.95),
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.3) }),
        },
      });
      const pos = frame.enuToEcef(item.result.impactPoint);
      this.compare.billboard(pos, SYM.dot(item.cssColor, '', 12));
      this.compare.label(pos, tagLabel(`${item.label} · ${formatDistance(item.result.downrange)}`, {
        font: FONT_DATA_SMALL, color, origin: 'left', vertical: 'center', offset: new Cesium.Cartesian2(10, 0),
        far: 3e5,
      }));
    }
    this.renderLegend(list);
  }

  private renderLegend(list: { label: string; cssColor: string; result: FlightResult }[]): void {
    if (!this.legendEl) {
      this.legendEl = el('div', 'ua-compare-legend ua-glass');
      this.legendEl.style.pointerEvents = 'auto';
      mapRoot().appendChild(this.legendEl);
    }
    const ref = list[list.length - 1]?.result.downrange ?? 0;
    this.legendEl.innerHTML =
      `<h4><span>Comparación de físicas</span>` +
      `<button class="ua-icon-btn" title="Quitar la comparación" aria-label="Cerrar">${ICON.close}</button></h4>`;
    for (const item of list) {
      const row = el('div', 'ua-compare-row');
      const d = item.result.downrange - ref;
      const delta = Math.abs(d) < 0.5 ? 'ref.' : `${d > 0 ? '+' : '−'}${formatDistance(Math.abs(d))}`;
      row.innerHTML =
        `<span class="sw" style="background:${item.cssColor}"></span>` +
        `<span>${item.label}</span>` +
        `<span class="r">${formatDistance(item.result.downrange)}</span>` +
        `<span class="d">${delta}</span>`;
      this.legendEl.appendChild(row);
    }
    this.legendEl.querySelector('button')!.addEventListener('click', () => this.clearCompare());
    this.legendEl.classList.add('show');
  }

  // -- limpieza -----------------------------------------------------------------
  clearArc(): void {
    this.arc.clear();
    this.impactLabel = null;
  }

  clearRings(): void {
    this.rings.clear();
  }

  clearCompare(): void {
    this.compare.clear();
    this.legendEl?.classList.remove('show');
  }

  clearAll(): void {
    this.clearArc();
    this.clearRings();
    this.clearCompare();
    this.showTarget(null);
    this.showErrorEllipse(null);
    this.showChallengeTarget(null);
  }

  /** Retira todas sus capas del visor (desmontaje completo). */
  dispose(): void {
    this.clearAll();
    void this.viewer.dataSources.remove(this.ds, true);
    const prims = this.viewer.scene.primitives;
    prims.remove(this.pls);
    prims.remove(this.bbsUnder);
    prims.remove(this.bbs);
    prims.remove(this.lbs);
    this.legendEl?.remove();
  }
}
