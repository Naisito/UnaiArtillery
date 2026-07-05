// ============================================================================
//  frame.ts — Puente ENU (core) <-> ECEF (Cesium).  [P-WEB.2]
//
//  El núcleo balístico integra en un plano tangente ENU en METROS anclado en
//  la posición de la batería. Cesium trabaja en ECEF (metros, WGS84). Esta es
//  la ÚNICA pieza que traduce entre ambos mundos, igual que hacía
//  UnaiBallisticsBridge.h en la capa Unreal:
//
//      ENU (x=Este, y=Norte, z=Arriba)  --eastNorthUpToFixedFrame-->  ECEF
//
//  Mantener la conversión aislada aquí deja el solver testeable sin Cesium.
// ============================================================================
import * as Cesium from 'cesium';
import { Vec3 } from './ballistics/Vec3';

export class GeoFrame {
  readonly origin: Cesium.Cartesian3;
  readonly enuToEcefMatrix: Cesium.Matrix4;
  readonly ecefToEnuMatrix: Cesium.Matrix4;

  constructor(
    readonly lonDeg: number,
    readonly latDeg: number,
    readonly heightM = 0.0,
  ) {
    this.origin = Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, heightM);
    this.enuToEcefMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(this.origin);
    this.ecefToEnuMatrix = Cesium.Matrix4.inverseTransformation(
      this.enuToEcefMatrix,
      new Cesium.Matrix4(),
    );
  }

  /** Posición ENU (m, relativa a la batería) -> ECEF. */
  enuToEcef(p: Vec3, out = new Cesium.Cartesian3()): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPoint(
      this.enuToEcefMatrix, new Cesium.Cartesian3(p.x, p.y, p.z), out,
    );
  }

  /** Posición ECEF -> ENU (m, relativa a la batería). */
  ecefToEnu(c: Cesium.Cartesian3): Vec3 {
    const r = Cesium.Matrix4.multiplyByPoint(this.ecefToEnuMatrix, c, new Cesium.Cartesian3());
    return new Vec3(r.x, r.y, r.z);
  }

  /** Vector libre ENU -> ECEF (solo rotación). */
  enuVectorToEcef(v: Vec3, out = new Cesium.Cartesian3()): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPointAsVector(
      this.enuToEcefMatrix, new Cesium.Cartesian3(v.x, v.y, v.z), out,
    );
  }

  /** Vector libre ECEF -> ENU (solo rotación). */
  ecefVectorToEnu(c: Cesium.Cartesian3): Vec3 {
    const r = Cesium.Matrix4.multiplyByPointAsVector(
      this.ecefToEnuMatrix, c, new Cesium.Cartesian3(),
    );
    return new Vec3(r.x, r.y, r.z);
  }

  /** Cartographic (lon/lat/alt elipsoidal) de un punto ENU. */
  cartographicOfEnu(p: Vec3): Cesium.Cartographic {
    return Cesium.Cartographic.fromCartesian(this.enuToEcef(p));
  }
}
