// ============================================================================
//  Atmosphere.ts — Standard atmosphere + wind field.
//
//  P-NEXT.2: the default model is now the full **US Standard Atmosphere 1976**
//  up to 86 km geometric altitude (7 layers defined in geopotential height,
//  H = r0·Z/(r0+Z) with r0 = 6356766 m), plus a smooth isothermal exponential
//  tail above. This matters because the tactical missile spends half its
//  flight at 30-80 km, where the old 2-layer extrapolation was badly wrong
//  (2.5x too thin at 70 km).
//
//  The original 2-layer model (troposphere + 11-20 km isothermal extrapolated
//  upward) is the exact model the validated C++ core uses; it stays available
//  as `model: 'isa2'` / `Atmosphere.legacyTwoLayer()` and the C++ parity
//  tests (validation.test.ts) run against it. Catalog and app use the ISA-76.
//
//  The sea-level knobs `seaLevelTemperatureK/PressurePa` shift the whole
//  column in both models: every layer base temperature moves by ΔT and the
//  pressure ladder is rebuilt from the actual P0.
//
//  Plus (P1.7) an altitude wind PROFILE: a list of
//  {altitude -> (speed, from-bearing)} points interpolated linearly in speed
//  and along the shortest arc in bearing, loadable from a simple CSV.
//
//  ISA sea-level reference:
//      T0 = 288.15 K,  P0 = 101325 Pa,  rho0 = 1.225 kg/m^3
//      g0 = 9.80665 m/s^2,  R = 287.05287 J/(kg*K)
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

export type AtmosphereModel = 'isa76' | 'isa2';

const G0 = 9.80665;
const R_AIR = 287.05287;
const GAMMA = 1.4;

/** Effective Earth radius for the geometric->geopotential conversion (m). */
const R_EARTH_GP = 6356766.0;

/** USSA-76 layer bases in geopotential meters and their lapse rates (K/m). */
const ISA76_LAYERS: { hB: number; L: number }[] = [
  { hB: 0.0,     L: -6.5e-3 },  // troposphere
  { hB: 11000.0, L: 0.0 },      // tropopause (isothermal)
  { hB: 20000.0, L: +1.0e-3 },  // lower stratosphere
  { hB: 32000.0, L: +2.8e-3 },  // upper stratosphere
  { hB: 47000.0, L: 0.0 },      // stratopause (isothermal)
  { hB: 51000.0, L: -2.8e-3 },  // lower mesosphere
  { hB: 71000.0, L: -2.0e-3 },  // upper mesosphere
];

/** Geopotential top of the tabulated model: 84.852 km H = 86 km geometric. */
const ISA76_TOP = 84852.0;

interface LayerBase { hB: number; T: number; P: number; L: number; }

export class Atmosphere {
  /** 'isa76' (default, full 86 km) or 'isa2' (C++ parity, 2 layers). */
  model: AtmosphereModel = 'isa76';

  // Weather knobs, expressed relative to the ISA baseline.
  seaLevelTemperatureK = 288.15;
  seaLevelPressurePa = 101325.0;

  // Wind is a full vector field over (position, time). Default: calm.
  windField: WindField = () => new Vec3(0, 0, 0);

  // Pressure/temperature ladder of the ISA-76 layer bases, rebuilt lazily
  // when the sea-level knobs change (the solver samples every RK4 substep).
  private layerCache: { T0: number; P0: number; bases: LayerBase[]; topT: number; topP: number } | null = null;

  /** The exact 2-layer model of the validated C++ core (parity tests). */
  static legacyTwoLayer(): Atmosphere {
    const a = new Atmosphere();
    a.model = 'isa2';
    return a;
  }

  /** Sample the standard atmosphere at geometric altitude h (meters MSL). */
  sample(h: number): AtmoSample {
    return this.model === 'isa2' ? this.sampleTwoLayer(h) : this.sampleISA76(h);
  }

  // -- US Standard Atmosphere 1976 (default) ---------------------------------
  private sampleISA76(hGeometric: number): AtmoSample {
    // The standard defines its layers in geopotential height.
    const z = Math.max(hGeometric, -5000.0);
    const h = (R_EARTH_GP * z) / (R_EARTH_GP + z);
    const { bases, topT, topP } = this.isa76Bases();

    let T: number, P: number;
    if (h <= ISA76_TOP) {
      let i = bases.length - 1;
      while (i > 0 && h < bases[i].hB) i--;
      const b = bases[i];
      if (b.L === 0.0) {
        T = b.T;
        P = b.P * Math.exp((-G0 * (h - b.hB)) / (R_AIR * T));
      } else {
        T = b.T + b.L * (h - b.hB);
        P = b.P * Math.pow(T / b.T, -G0 / (R_AIR * b.L));
      }
    } else {
      // Smooth isothermal exponential tail above 86 km geometric.
      T = topT;
      P = topP * Math.exp((-G0 * (h - ISA76_TOP)) / (R_AIR * T));
    }
    T = Math.max(T, 150.0); // numerical floor
    const rho = P / (R_AIR * T);
    const a = Math.sqrt(GAMMA * R_AIR * T);
    return { density: rho, temperature: T, pressure: P, soundSpeed: a };
  }

  private isa76Bases(): { bases: LayerBase[]; topT: number; topP: number } {
    const T0 = this.seaLevelTemperatureK;
    const P0 = this.seaLevelPressurePa;
    const c = this.layerCache;
    if (c && c.T0 === T0 && c.P0 === P0) return c;

    // ΔT shifts every layer base; the pressure ladder rebuilds from P0.
    const bases: LayerBase[] = [];
    let T = T0;
    let P = P0;
    for (let i = 0; i < ISA76_LAYERS.length; i++) {
      const { hB, L } = ISA76_LAYERS[i];
      bases.push({ hB, T, P, L });
      const hNext = i + 1 < ISA76_LAYERS.length ? ISA76_LAYERS[i + 1].hB : ISA76_TOP;
      const dh = hNext - hB;
      if (L === 0.0) {
        P = P * Math.exp((-G0 * dh) / (R_AIR * T));
      } else {
        const Tn = T + L * dh;
        P = P * Math.pow(Tn / T, -G0 / (R_AIR * L));
        T = Tn;
      }
    }
    this.layerCache = { T0, P0, bases, topT: T, topP: P };
    return this.layerCache;
  }

  // -- Legacy 2-layer ISA (C++ parity) ----------------------------------------
  private sampleTwoLayer(h: number): AtmoSample {
    const L = 0.0065;
    const T0 = this.seaLevelTemperatureK;
    const P0 = this.seaLevelPressurePa;

    let T: number, P: number;
    if (h <= 11000.0) {
      T = T0 - L * h;
      P = P0 * Math.pow(T / T0, G0 / (R_AIR * L));
    } else {
      // Isothermal layer 11..20 km, extrapolated upward.
      const T11 = T0 - L * 11000.0;
      const P11 = P0 * Math.pow(T11 / T0, G0 / (R_AIR * L));
      T = T11;
      P = P11 * Math.exp((-G0 * (h - 11000.0)) / (R_AIR * T11));
    }
    T = Math.max(T, 150.0); // numerical floor for very high shots
    const rho = P / (R_AIR * T);
    const a = Math.sqrt(GAMMA * R_AIR * T);
    return { density: rho, temperature: T, pressure: P, soundSpeed: a };
  }

  densityAt(h: number): number { return this.sample(h).density; }

  /**
   * P-PRO.2 — altitud geométrica (m) a la que ESTE modelo (con sus knobs
   * actuales) tiene la presión `pPa`. Bisección sobre `sample().pressure`
   * en 0–86 km (la presión es estrictamente decreciente); clamp fuera de
   * rango. Se usa para colocar los niveles de presión de la meteo real
   * (1000→200 hPa) en altitud.
   */
  altitudeForPressure(pPa: number): number {
    let lo = 0.0;
    let hi = 86000.0;
    if (pPa >= this.sample(lo).pressure) return lo;
    if (pPa <= this.sample(hi).pressure) return hi;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (this.sample(mid).pressure > pPa) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

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
    a.model = this.model;
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
