// ============================================================================
//  Atmosphere.ts — International Standard Atmosphere (ISA) + wind field.
//
//  1:1 port of core/Atmosphere.h, plus (P1.7) an altitude wind PROFILE:
//  a list of {altitude -> (speed, from-bearing)} points interpolated linearly
//  in speed and along the shortest arc in bearing, loadable from a simple CSV.
//
//  ISA reference (troposphere 0..11 km, then isothermal 11..20 km):
//      T0 = 288.15 K,  P0 = 101325 Pa,  rho0 = 1.225 kg/m^3
//      L  = 0.0065 K/m,  g0 = 9.80665 m/s^2,  R = 287.05287 J/(kg*K)
// ============================================================================
import { Vec3 } from './Vec3';

export interface AtmoSample {
  density: number;      // rho [kg/m^3]
  temperature: number;  // T   [K]
  pressure: number;     // P   [Pa]
  soundSpeed: number;   // a   [m/s]
}

/** One point of an altitude wind profile (P1.7). */
export interface WindProfilePoint {
  altitudeM: number;      // meters MSL, ascending
  speedMS: number;        // wind speed at that altitude
  fromBearingDeg: number; // compass bearing the wind blows FROM (0=N, 90=E)
}

export type WindField = (pos: Vec3, t: number) => Vec3;

export class Atmosphere {
  // Weather knobs, expressed relative to the ISA baseline.
  seaLevelTemperatureK = 288.15;
  seaLevelPressurePa = 101325.0;

  // Wind is a full vector field over (position, time). Default: calm.
  windField: WindField = () => new Vec3(0, 0, 0);

  /** Sample the standard atmosphere at geometric altitude h (meters MSL). */
  sample(h: number): AtmoSample {
    const g0 = 9.80665;
    const R = 287.05287;
    const L = 0.0065;
    const gamma = 1.4;

    const T0 = this.seaLevelTemperatureK;
    const P0 = this.seaLevelPressurePa;

    let T: number, P: number;
    if (h <= 11000.0) {
      T = T0 - L * h;
      P = P0 * Math.pow(T / T0, g0 / (R * L));
    } else {
      // Isothermal layer 11..20 km.
      const T11 = T0 - L * 11000.0;
      const P11 = P0 * Math.pow(T11 / T0, g0 / (R * L));
      T = T11;
      P = P11 * Math.exp((-g0 * (h - 11000.0)) / (R * T11));
    }
    T = Math.max(T, 150.0); // numerical floor for very high shots
    const rho = P / (R * T);
    const a = Math.sqrt(gamma * R * T);
    return { density: rho, temperature: T, pressure: P, soundSpeed: a };
  }

  densityAt(h: number): number { return this.sample(h).density; }

  windAt(pos: Vec3, t: number): Vec3 { return this.windField(pos, t); }

  /**
   * Helper: steady wind of `speed` (m/s) coming FROM `bearingDeg`
   * (0 = from North, 90 = from East).
   */
  static steadyWind(speed: number, bearingDeg: number): Vec3 {
    const br = (bearingDeg * Math.PI) / 180.0;
    // "From" bearing -> the vector points toward the opposite direction.
    return new Vec3(-speed * Math.sin(br), -speed * Math.cos(br), 0.0);
  }

  /** Shallow copy sharing nothing (windField reference is copied). */
  clone(): Atmosphere {
    const a = new Atmosphere();
    a.seaLevelTemperatureK = this.seaLevelTemperatureK;
    a.seaLevelPressurePa = this.seaLevelPressurePa;
    a.windField = this.windField;
    return a;
  }

  // -- P1.7: altitude wind profile ------------------------------------------

  /**
   * Install a wind profile interpolated by altitude. Speed interpolates
   * linearly; bearing interpolates along the shortest arc so a veering wind
   * (e.g. 350deg -> 20deg) doesn't swing the long way around the compass.
   * Points must be sorted by ascending altitude; outside the table the end
   * points clamp.
   */
  setWindProfile(points: WindProfilePoint[]): void {
    if (points.length === 0) {
      this.windField = () => new Vec3(0, 0, 0);
      return;
    }
    const pts = [...points].sort((a, b) => a.altitudeM - b.altitudeM);
    this.windField = (pos: Vec3) => {
      const h = pos.z;
      if (h <= pts[0].altitudeM) return Atmosphere.steadyWind(pts[0].speedMS, pts[0].fromBearingDeg);
      const last = pts[pts.length - 1];
      if (h >= last.altitudeM) return Atmosphere.steadyWind(last.speedMS, last.fromBearingDeg);
      let i = 1;
      while (pts[i].altitudeM < h) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const f = (h - a.altitudeM) / (b.altitudeM - a.altitudeM);
      const speed = a.speedMS + f * (b.speedMS - a.speedMS);
      // Shortest-arc bearing interpolation.
      let dBearing = b.fromBearingDeg - a.fromBearingDeg;
      dBearing = ((dBearing + 540) % 360) - 180;
      const bearing = a.fromBearingDeg + f * dBearing;
      return Atmosphere.steadyWind(speed, bearing);
    };
  }

  /**
   * Parse a wind-profile CSV with header `altitude_m,speed_ms,from_bearing_deg`
   * (header optional; `#` comments and blank lines ignored). Returns the points
   * so callers can inspect them before `setWindProfile`.
   */
  static windProfileFromCSV(csv: string): WindProfilePoint[] {
    const out: WindProfilePoint[] = [];
    for (const rawLine of csv.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      const cells = line.split(',').map((c) => c.trim());
      if (cells.length < 3) continue;
      const alt = Number(cells[0]);
      const speed = Number(cells[1]);
      const bearing = Number(cells[2]);
      if (!Number.isFinite(alt) || !Number.isFinite(speed) || !Number.isFinite(bearing)) {
        continue; // header row or malformed line
      }
      out.push({ altitudeM: alt, speedMS: speed, fromBearingDeg: bearing });
    }
    return out.sort((a, b) => a.altitudeM - b.altitudeM);
  }
}
