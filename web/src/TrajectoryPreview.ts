// ============================================================================
//  TrajectoryPreview.ts — Arco de tiro dibujado sobre el globo.  [P2.3 web]
//
//  Pinta con entidades Cesium (se ocluyen correctamente contra el relieve):
//    * la polilínea de la trayectoria prevista (y la parte oculta, punteada),
//    * marcadores de ápice e impacto con etiquetas (alt / alcance / TOF),
//    * anillos de alcance mín/máx del arma+carga alrededor de la batería,
//    * y el juego de arcos del modo comparación (P4.2), cada uno con su color
//      y su alcance etiquetado.
// ============================================================================
import * as Cesium from 'cesium';
import { FlightResult, Vec3 } from './ballistics';
import { GeoFrame } from './frame';

export class TrajectoryPreview {
  private arc: Cesium.Entity[] = [];
  private rings: Cesium.Entity[] = [];
  private compare: Cesium.Entity[] = [];
  private targetMark?: Cesium.Entity;
  private errorEllipse: Cesium.Entity[] = [];
  private challengeMark: Cesium.Entity[] = [];

  constructor(
    private readonly viewer: Cesium.Viewer,
    private frameOf: () => GeoFrame,
  ) {}

  private positionsOf(result: FlightResult, maxPoints = 320): Cesium.Cartesian3[] {
    const frame = this.frameOf();
    const path = result.path;
    const step = Math.max(1, Math.floor(path.length / maxPoints));
    const out: Cesium.Cartesian3[] = [];
    for (let i = 0; i < path.length; i += step) out.push(frame.enuToEcef(path[i].position));
    if (path.length) out.push(frame.enuToEcef(path[path.length - 1].position));
    return out;
  }

  private label(text: string): Cesium.LabelGraphics.ConstructorOptions {
    return {
      text,
      font: '13px "Segoe UI", sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(1e3, 1.0, 3e5, 0.55),
    };
  }

  /** Dibuja el arco previsto + ápice + impacto. */
  showFlight(result: FlightResult, cssColor = '#ffb545'): void {
    this.clearArc();
    if (result.path.length < 2) return;
    const frame = this.frameOf();
    const color = Cesium.Color.fromCssColorString(cssColor);

    this.arc.push(
      this.viewer.entities.add({
        polyline: {
          positions: this.positionsOf(result),
          width: 3,
          material: color.withAlpha(0.9),
          // La parte tapada por el relieve se insinúa punteada.
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
            color: color.withAlpha(0.28),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      }),
    );

    // Ápice.
    let apexSample = result.path[0];
    for (const p of result.path) if (p.position.z > apexSample.position.z) apexSample = p;
    this.arc.push(
      this.viewer.entities.add({
        position: frame.enuToEcef(apexSample.position),
        point: { pixelSize: 6, color: Cesium.Color.SKYBLUE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this.label(`ápice ${(apexSample.position.z / 1000).toFixed(2)} km`),
      }),
    );

    // Impacto.
    this.arc.push(
      this.viewer.entities.add({
        position: frame.enuToEcef(result.impactPoint),
        point: { pixelSize: 8, color, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this.label(
          `${(result.downrange / 1000).toFixed(2)} km · ${result.timeOfFlight.toFixed(1)} s · ` +
            `${result.impactSpeed.toFixed(0)} m/s`,
        ),
      }),
    );
  }

  /** Anillos de alcance mín/máx de la carga actual alrededor de la batería. */
  showRings(minRangeM: number, maxRangeM: number): void {
    this.clearRings();
    const frame = this.frameOf();
    const make = (radius: number, color: Cesium.Color, text: string) =>
      this.viewer.entities.add({
        position: frame.origin,
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          fill: false,
          outline: true,
          outlineColor: color,
          outlineWidth: 2,
          height: frame.heightM + 2,
        },
        label: { ...this.label(text), pixelOffset: new Cesium.Cartesian2(0, 14) },
      });
    if (Number.isFinite(minRangeM) && minRangeM > 200 && minRangeM < maxRangeM * 0.98) {
      this.rings.push(make(minRangeM, Cesium.Color.ORANGE.withAlpha(0.7),
        `mín ${(minRangeM / 1000).toFixed(1)} km`));
    }
    if (maxRangeM > 0) {
      this.rings.push(make(maxRangeM, Cesium.Color.CYAN.withAlpha(0.7),
        `máx ${(maxRangeM / 1000).toFixed(1)} km`));
    }
  }

  /** Marca el objetivo elegido con clic. */
  showTarget(targetEnu: Vec3 | null): void {
    if (this.targetMark) {
      this.viewer.entities.remove(this.targetMark);
      this.targetMark = undefined;
    }
    if (!targetEnu) return;
    this.targetMark = this.viewer.entities.add({
      position: this.frameOf().enuToEcef(targetEnu),
      point: {
        pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: this.label('objetivo'),
    });
  }

  /**
   * P-PRO.6 — elipse de error PREDICHA (1σ y 2σ más tenue) centrada en el
   * impacto previsto y orientada al rumbo. Semiejes = σ_alcance / σ_deriva.
   * Con null se borra.
   */
  showErrorEllipse(
    spec: {
      centerEnu: Vec3;
      bearingDeg: number;
      sigmaRangeM: number;
      sigmaCrossM: number;
    } | null,
  ): void {
    for (const e of this.errorEllipse) this.viewer.entities.remove(e);
    this.errorEllipse = [];
    if (!spec) return;
    const { centerEnu, bearingDeg, sigmaRangeM, sigmaCrossM } = spec;
    if (!(sigmaRangeM > 0.5) || !(sigmaCrossM > 0.5)) return;

    const frame = this.frameOf();
    const position = frame.enuToEcef(centerEnu);
    const height = frame.heightM + centerEnu.z + 1.5;
    // Cesium mide la rotación de la elipse antihoraria desde el norte y exige
    // semiMajor >= semiMinor: si domina la deriva, gira el eje mayor 90º.
    const rangeIsMajor = sigmaRangeM >= sigmaCrossM;
    const major = rangeIsMajor ? sigmaRangeM : sigmaCrossM;
    const minor = rangeIsMajor ? sigmaCrossM : sigmaRangeM;
    const rotation = Cesium.Math.toRadians(-(bearingDeg + (rangeIsMajor ? 0 : 90)));

    const make = (k: number, alpha: number, withLabel: boolean) =>
      this.viewer.entities.add({
        position,
        ellipse: {
          semiMajorAxis: major * k,
          semiMinorAxis: minor * k,
          rotation,
          stRotation: rotation,
          height,
          fill: true,
          material: Cesium.Color.fromCssColorString('#ff5d5d').withAlpha(alpha * 0.16),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#ff5d5d').withAlpha(alpha),
          outlineWidth: 2,
        },
        label: withLabel
          ? {
              ...this.label(`PER ±${sigmaRangeM.toFixed(0)} m / ±${sigmaCrossM.toFixed(0)} m`),
              pixelOffset: new Cesium.Cartesian2(0, 18),
            }
          : undefined,
      });
    this.errorEllipse.push(make(1, 0.85, true), make(2, 0.35, false));
  }

  /**
   * P-PRO.7 — diana del reto (distinta del objetivo normal): punto dorado y
   * anillos con los umbrales de estrellas (25/75/150 m) para leer el fallo
   * sobre el terreno. Con null se borra.
   */
  showChallengeTarget(targetEnu: Vec3 | null): void {
    for (const e of this.challengeMark) this.viewer.entities.remove(e);
    this.challengeMark = [];
    if (!targetEnu) return;
    const frame = this.frameOf();
    const position = frame.enuToEcef(targetEnu);
    const height = frame.heightM + targetEnu.z + 1;
    const gold = Cesium.Color.fromCssColorString('#ffd54a');

    this.challengeMark.push(
      this.viewer.entities.add({
        position,
        point: {
          pixelSize: 11, color: gold, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: this.label('🏅 reto'),
      }),
    );
    for (const [radius, alpha] of [[25, 0.9], [75, 0.55], [150, 0.3]] as const) {
      this.challengeMark.push(
        this.viewer.entities.add({
          position,
          ellipse: {
            semiMajorAxis: radius, semiMinorAxis: radius, height,
            fill: false, outline: true, outlineColor: gold.withAlpha(alpha), outlineWidth: 2,
          },
        }),
      );
    }
  }

  /** P4.2 — arcos superpuestos del modo comparación, con etiquetas. */
  showCompare(list: { label: string; cssColor: string; result: FlightResult }[]): void {
    this.clearCompare();
    const frame = this.frameOf();
    for (const item of list) {
      const color = Cesium.Color.fromCssColorString(item.cssColor);
      this.compare.push(
        this.viewer.entities.add({
          polyline: {
            positions: this.positionsOf(item.result),
            width: 2.5,
            material: color.withAlpha(0.9),
            depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.25) }),
            arcType: Cesium.ArcType.NONE,
          },
        }),
        this.viewer.entities.add({
          position: frame.enuToEcef(item.result.impactPoint),
          point: { pixelSize: 7, color, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: this.label(`${item.label}: ${(item.result.downrange / 1000).toFixed(2)} km`),
        }),
      );
    }
  }

  clearArc(): void {
    for (const e of this.arc) this.viewer.entities.remove(e);
    this.arc = [];
  }

  clearRings(): void {
    for (const e of this.rings) this.viewer.entities.remove(e);
    this.rings = [];
  }

  clearCompare(): void {
    for (const e of this.compare) this.viewer.entities.remove(e);
    this.compare = [];
  }

  clearAll(): void {
    this.clearArc();
    this.clearRings();
    this.clearCompare();
    this.showTarget(null);
    this.showErrorEllipse(null);
    this.showChallengeTarget(null);
  }
}
