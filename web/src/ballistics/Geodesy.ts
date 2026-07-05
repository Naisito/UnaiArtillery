// ============================================================================
//  Geodesy.ts — WGS84 constants, ENU<->ECEF frames and gravity (P1.4).
//
//  The flat ENU tangent plane the core integrates on is accurate to well under
//  1% out to ~50 km. Beyond that the Earth curves away under the shell and the
//  gravity vector rotates with it, so long-range work (the ~300 km tactical
//  missile) integrates in ECEF coordinates instead:
//
//    * Positions/velocities in the Earth-fixed rotating frame (ECEF).
//    * Gravity: point-mass mu/r^2 pointing at the geocenter.
//    * Earth rotation appears as explicit Coriolis (-2 Omega x v) and
//      centrifugal (-Omega x (Omega x r)) terms.
//
//  This is a SPHERICAL-gravity approximation anchored to the WGS84 ellipsoid:
//  the anchor point sits exactly on the ellipsoid, but gravity ignores J2
//  (oblateness), which costs ~0.2% in g — far below the drag-model
//  uncertainty. Recommended switch-on range: > 50 km.
// ============================================================================
import { Vec3 } from './Vec3';

export const WGS84 = {
  a: 6378137.0,                 // semi-major axis (m)
  f: 1.0 / 298.257223563,       // flattening
  b: 6378137.0 * (1.0 - 1.0 / 298.257223563), // semi-minor axis (m)
  e2: (2.0 - 1.0 / 298.257223563) / 298.257223563, // first eccentricity^2
  GM: 3.986004418e14,           // gravitational parameter (m^3/s^2)
  omega: 7.2921159e-5,          // Earth angular rate (rad/s)
};

/**
 * Somigliana normal gravity on the ellipsoid surface at geodetic latitude
 * (includes the centrifugal contribution — informative/UI use only; the ECEF
 * integrator uses GM point-mass attraction + an explicit centrifugal term).
 */
export function somiglianaGravity(latDeg: number): number {
  const s2 = Math.sin((latDeg * Math.PI) / 180.0) ** 2;
  return (9.7803253359 * (1 + 0.00193185265241 * s2)) / Math.sqrt(1 - 0.00669437999013 * s2);
}

/** Geodetic (lat, lon, h) -> ECEF meters on the WGS84 ellipsoid. */
export function geodeticToEcef(latDeg: number, lonDeg: number, h: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180.0;
  const lon = (lonDeg * Math.PI) / 180.0;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84.a / Math.sqrt(1.0 - WGS84.e2 * sinLat * sinLat);
  return new Vec3(
    (N + h) * cosLat * Math.cos(lon),
    (N + h) * cosLat * Math.sin(lon),
    (N * (1.0 - WGS84.e2) + h) * sinLat,
  );
}

/**
 * Local East-North-Up tangent frame anchored at a geodetic point. Converts
 * positions and free vectors between the core's ENU meters and ECEF meters.
 */
export class EnuFrame {
  readonly originEcef: Vec3;
  readonly east: Vec3;
  readonly north: Vec3;
  readonly up: Vec3;

  constructor(
    readonly latDeg: number,
    readonly lonDeg: number,
    readonly heightM = 0.0,
  ) {
    this.originEcef = geodeticToEcef(latDeg, lonDeg, heightM);
    const lat = (latDeg * Math.PI) / 180.0;
    const lon = (lonDeg * Math.PI) / 180.0;
    const sLat = Math.sin(lat), cLat = Math.cos(lat);
    const sLon = Math.sin(lon), cLon = Math.cos(lon);
    this.east = new Vec3(-sLon, cLon, 0.0);
    this.north = new Vec3(-sLat * cLon, -sLat * sLon, cLat);
    this.up = new Vec3(cLat * cLon, cLat * sLon, sLat);
  }

  /** ENU position (m, relative to the anchor) -> ECEF position (m). */
  enuToEcefPosition(p: Vec3): Vec3 {
    return this.originEcef.add(this.enuToEcefVector(p));
  }

  /** ECEF position (m) -> ENU position (m, relative to the anchor). */
  ecefToEnuPosition(p: Vec3): Vec3 {
    return this.ecefToEnuVector(p.sub(this.originEcef));
  }

  /** Free vector ENU -> ECEF (rotation only). */
  enuToEcefVector(v: Vec3): Vec3 {
    return new Vec3(
      this.east.x * v.x + this.north.x * v.y + this.up.x * v.z,
      this.east.y * v.x + this.north.y * v.y + this.up.y * v.z,
      this.east.z * v.x + this.north.z * v.y + this.up.z * v.z,
    );
  }

  /** Free vector ECEF -> ENU (rotation only). */
  ecefToEnuVector(v: Vec3): Vec3 {
    return new Vec3(this.east.dot(v), this.north.dot(v), this.up.dot(v));
  }
}
