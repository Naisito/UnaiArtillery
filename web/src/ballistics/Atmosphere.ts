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
//  V2 · PHYS (tarea C) — HUMEDAD y COLUMNA MEDIDA:
//    * `relativeHumidity` (0..1) y/o `setMetProfile()` (temperatura y HR por
//      altitud, p. ej. los niveles de presión de Open-Meteo). El vapor de agua
//      pesa menos que el aire seco: la densidad y la velocidad del sonido se
//      calculan con la TEMPERATURA VIRTUAL
//          e   = HR · e_s(T)                    (Buck 1996, sobre agua)
//          T_v = T / (1 − (e/P)·(1 − ε)),  ε = R_d/R_v = 0.62198
//          ρ   = P / (R_d·T_v),   a = √(γ·R_d·T_v)
//      que es exactamente lo que transporta el mensaje meteorológico de
//      artillería OTAN (METCM, STANAG 4082: "virtual temperature").
//    * Con humedad o perfil, la presión se integra HIDROSTÁTICAMENTE con T_v
//      (dlnP/dH = −g0/(R_d·T_v), en altura geopotencial para ISA-76) sobre una
//      tabla de 100 m: columna consistente (aire húmedo/caliente ⇒ más presión
//      en altura). La tabla se reconstruye solo al cambiar knobs o perfil.
//    * Por defecto HR = 0 (atmósfera estándar OACI SECA: la de las tablas de
//      tiro OTAN y la que calibró los BC) y sin perfil ⇒ se usa el modelo
//      analítico de siempre, bit a bit idéntico.
//
//  V2 · PHYS (tarea E) — `sampleInto()` escribe en un objeto reutilizable y
//  los campos de viento integrados traen un evaluador escalar `into()`: el
//  bucle RK4 muestrea atmósfera y viento sin asignar memoria.
//
//  ISA sea-level reference:
//      T0 = 288.15 K,  P0 = 101325 Pa,  rho0 = 1.225 kg/m^3
//      g0 = 9.80665 m/s^2,  R = 287.05287 J/(kg*K)
// ============================================================================
import { Vec3 } from './Vec3';

export interface AtmoSample {
  density: number;      // rho [kg/m^3]
  temperature: number;  // T   [K]  (temperatura real, bulbo seco)
  pressure: number;     // P   [Pa]
  soundSpeed: number;   // a   [m/s]
  /** V2 — temperatura virtual T_v [K] (== T en aire seco). */
  virtualTemperature?: number;
}

/** One point of an altitude wind profile (P1.7). */
export interface WindProfilePoint {
  altitudeM: number;      // meters MSL, ascending
  speedMS: number;        // wind speed at that altitude
  fromBearingDeg: number; // compass bearing the wind blows FROM (0=N, 90=E)
}

/**
 * V2 — un nivel de la columna meteorológica MEDIDA (radiosondeo, Open-Meteo
 * por niveles de presión, METCM). Altitud SOBRE EL NIVEL DEL MAR (la
 * atmósfera se muestrea en z ENU + cota de la batería). Cada campo es
 * opcional: un nivel puede traer solo HR, solo T o ambos.
 */
export interface MetProfilePoint {
  altitudeM: number;          // m MSL
  temperatureK?: number;      // temperatura real del nivel (K)
  relativeHumidity?: number;  // 0..1 (sobre agua, como la reportan las sondas)
}

/**
 * Evaluador escalar sin asignaciones de un campo de viento: escribe el vector
 * (x, y, z) del viento en out[o], out[o+1], out[o+2]. Debe dar EXACTAMENTE
 * los mismos números que la función (el solver usa uno u otro).
 */
export type WindInto = (
  x: number, y: number, z: number, t: number, out: Float64Array, o: number,
) => void;

export type WindField = ((pos: Vec3, t: number) => Vec3) & { into?: WindInto };

export type AtmosphereModel = 'isa76' | 'isa2';

const G0 = 9.80665;
const R_AIR = 287.05287;
const GAMMA = 1.4;
/** R_d/R_v: masa molar del agua / aire seco. */
const EPS_WATER = 0.62198;

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

/** Tabla hidrostática de la columna húmeda/medida (V2). */
interface MetTable {
  key: string;
  z0: number;          // m MSL del primer nodo
  dz: number;          // paso (m)
  T: Float64Array;     // temperatura real
  Tv: Float64Array;    // temperatura virtual
  lnP: Float64Array;   // ln presión
}

const MET_Z0 = -2000.0;
const MET_DZ = 100.0;
const MET_TOP = 90000.0;

/** Presión de vapor de saturación sobre agua (Pa), Buck (1996). */
export function saturationVaporPressurePa(tK: number): number {
  const tc = tK - 273.15;
  return 611.21 * Math.exp((18.678 - tc / 234.5) * (tc / (257.14 + tc)));
}

/** Temperatura virtual (K) de aire a T, P con humedad relativa rh (0..1). */
export function virtualTemperatureK(tK: number, pPa: number, rh: number): number {
  if (rh <= 0) return tK;
  const e = Math.min(rh * saturationVaporPressurePa(tK), 0.5 * pPa);
  return tK / (1.0 - (e / pPa) * (1.0 - EPS_WATER));
}

/** Viento en calma (con evaluador escalar). */
export const CALM_WIND: WindField = Object.assign(() => new Vec3(0, 0, 0), {
  into: ((_x: number, _y: number, _z: number, _t: number, out: Float64Array, o: number) => {
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
  }) as WindInto,
});

/** Campo `base + offset` (ráfaga no reportada de la dispersión), con into(). */
export function offsetWind(base: WindField, offset: Vec3): WindField {
  const ox = offset.x, oy = offset.y, oz = offset.z;
  const f = ((pos: Vec3, t: number) => base(pos, t).add(offset)) as WindField;
  const bi = base.into;
  if (bi) {
    f.into = (x, y, z, t, out, o) => {
      bi(x, y, z, t, out, o);
      out[o] = out[o] + ox; out[o + 1] = out[o + 1] + oy; out[o + 2] = out[o + 2] + oz;
    };
  }
  return f;
}

export class Atmosphere {
  /** 'isa76' (default, full 86 km) or 'isa2' (C++ parity, 2 layers). */
  model: AtmosphereModel = 'isa76';

  // Weather knobs, expressed relative to the ISA baseline.
  seaLevelTemperatureK = 288.15;
  seaLevelPressurePa = 101325.0;
  /**
   * V2 — humedad relativa de la columna (0..1), constante con la altitud
   * salvo que un perfil medido la defina por nivel. 0 = aire seco (estándar
   * OACI de las tablas de tiro): modelo analítico bit a bit el de siempre.
   */
  relativeHumidity = 0.0;

  // Wind is a full vector field over (position, time). Default: calm.
  windField: WindField = CALM_WIND;

  /** V2 — columna medida (T/HR por altitud MSL), ordenada; vacía = ISA. */
  private metProfile: MetProfilePoint[] = [];
  private metTable: MetTable | null = null;

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
    return this.sampleInto(h, {
      density: 0, temperature: 0, pressure: 0, soundSpeed: 0, virtualTemperature: 0,
    });
  }

  /**
   * V2 — como sample() pero escribe en `out` (sin asignar): es lo que llama
   * el bucle caliente del solver en cada evaluación RK.
   */
  sampleInto(h: number, out: AtmoSample): AtmoSample {
    if (this.relativeHumidity > 0 || this.metProfile.length > 0) return this.sampleMetInto(h, out);
    return this.model === 'isa2' ? this.sampleTwoLayerInto(h, out) : this.sampleISA76Into(h, out);
  }

  /** ¿Hay humedad o columna medida activas? (si no: modelo analítico seco). */
  get isHumidOrMeasured(): boolean {
    return this.relativeHumidity > 0 || this.metProfile.length > 0;
  }

  // -- US Standard Atmosphere 1976 (default) ---------------------------------
  private sampleISA76Into(hGeometric: number, out: AtmoSample): AtmoSample {
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
    out.density = P / (R_AIR * T);
    out.temperature = T;
    out.pressure = P;
    out.soundSpeed = Math.sqrt(GAMMA * R_AIR * T);
    out.virtualTemperature = T;
    return out;
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
  private sampleTwoLayerInto(h: number, out: AtmoSample): AtmoSample {
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
    out.density = P / (R_AIR * T);
    out.temperature = T;
    out.pressure = P;
    out.soundSpeed = Math.sqrt(GAMMA * R_AIR * T);
    out.virtualTemperature = T;
    return out;
  }

  // -- V2: columna húmeda / medida (tabla hidrostática) -------------------------

  /**
   * Instala (o borra, con []) la columna medida: temperatura y/o humedad
   * relativa por altitud MSL. Entre niveles se interpola linealmente; la T
   * se aplica como DESVIACIÓN ΔT sobre la ISA de los knobs (constante bajo
   * el nivel más bajo; por encima del más alto se mantiene 5 km y se
   * desvanece linealmente en los 10 km siguientes); la HR se mantiene en
   * los extremos (por encima de ~12 km el vapor es despreciable de todos
   * modos: e_s(−55 °C) ≈ 2 Pa).
   */
  setMetProfile(points: MetProfilePoint[]): void {
    this.metProfile = points
      .filter((p) => Number.isFinite(p.altitudeM))
      .map((p) => ({ ...p }))
      .sort((a, b) => a.altitudeM - b.altitudeM);
    this.metTable = null;
  }

  /** Copia de la columna medida instalada (vacía = ISA). */
  getMetProfile(): MetProfilePoint[] {
    return this.metProfile.map((p) => ({ ...p }));
  }

  /** T seca del modelo base (ISA-76 o 2 capas) con los knobs, a z MSL. */
  private baseTemperature(z: number): number {
    const tmp: AtmoSample = { density: 0, temperature: 0, pressure: 0, soundSpeed: 0 };
    return (this.model === 'isa2' ? this.sampleTwoLayerInto(z, tmp) : this.sampleISA76Into(z, tmp))
      .temperature;
  }

  /** Interpola un campo del perfil (solo puntos que lo traen); null si no hay. */
  private profileField(z: number, pick: (p: MetProfilePoint) => number | undefined): number | null {
    let prev: MetProfilePoint | null = null;
    let first: MetProfilePoint | null = null;
    let last: MetProfilePoint | null = null;
    for (const p of this.metProfile) {
      const v = pick(p);
      if (v === undefined || !Number.isFinite(v)) continue;
      if (!first) first = p;
      last = p;
      if (p.altitudeM >= z) {
        if (!prev) return v;
        const pv = pick(prev)!;
        const f = (z - prev.altitudeM) / Math.max(1e-9, p.altitudeM - prev.altitudeM);
        return pv + f * (v - pv);
      }
      prev = p;
    }
    if (!first || !last) return null;
    return pick(last)!; // por encima del último nivel
  }

  private metTableNow(): MetTable {
    const key =
      `${this.model}|${this.seaLevelTemperatureK}|${this.seaLevelPressurePa}|` +
      `${this.relativeHumidity}`;
    if (this.metTable && this.metTable.key === key) return this.metTable;

    const n = Math.floor((MET_TOP - MET_Z0) / MET_DZ) + 1;
    const T = new Float64Array(n);
    const Tv = new Float64Array(n);
    const lnP = new Float64Array(n);

    // ΔT del perfil respecto de la ISA de los knobs, en los niveles con T.
    const tPts = this.metProfile.filter((p) => p.temperatureK !== undefined);
    const topT = tPts.length ? tPts[tPts.length - 1].altitudeM : 0;
    const deltaT = (z: number): number => {
      if (tPts.length === 0) return 0;
      const base = this.profileField(z, (p) =>
        p.temperatureK !== undefined ? p.temperatureK - this.baseTemperature(p.altitudeM) : undefined,
      )!;
      if (z <= topT + 5000) return base;
      const fade = 1 - (z - topT - 5000) / 10000;
      return fade > 0 ? base * fade : 0;
    };
    const rhAt = (z: number): number => {
      const v = this.profileField(z, (p) => p.relativeHumidity);
      return Math.min(1, Math.max(0, v ?? this.relativeHumidity));
    };

    // Temperatura real en cada nodo.
    for (let i = 0; i < n; i++) {
      const z = MET_Z0 + i * MET_DZ;
      T[i] = Math.max(150.0, this.baseTemperature(z) + deltaT(z));
    }
    // Integración hidrostática desde el nivel del mar (P0 conocido), hacia
    // arriba y hacia abajo, con trapecio sobre 1/T_v. La presión de cada
    // nodo se necesita para e/P: se itera el nodo una vez (punto fijo).
    const geo = (z: number) => (this.model === 'isa2' ? z : (R_EARTH_GP * z) / (R_EARTH_GP + z));
    const i0 = Math.round((0 - MET_Z0) / MET_DZ);
    lnP[i0] = Math.log(this.seaLevelPressurePa);
    Tv[i0] = virtualTemperatureK(T[i0], this.seaLevelPressurePa, rhAt(0));
    const stepTo = (from: number, to: number): void => {
      const dH = geo(MET_Z0 + to * MET_DZ) - geo(MET_Z0 + from * MET_DZ);
      const zTo = MET_Z0 + to * MET_DZ;
      // Predictor con T_v del nodo origen, corrector con la T_v resultante.
      let lp = lnP[from] - (G0 * dH) / (R_AIR * Tv[from]);
      let tv = virtualTemperatureK(T[to], Math.exp(lp), rhAt(zTo));
      lp = lnP[from] - (G0 * dH * 0.5) * (1 / (R_AIR * Tv[from]) + 1 / (R_AIR * tv));
      tv = virtualTemperatureK(T[to], Math.exp(lp), rhAt(zTo));
      lnP[to] = lp;
      Tv[to] = tv;
    };
    for (let i = i0 + 1; i < n; i++) stepTo(i - 1, i);
    for (let i = i0 - 1; i >= 0; i--) stepTo(i + 1, i);

    this.metTable = { key, z0: MET_Z0, dz: MET_DZ, T, Tv, lnP };
    return this.metTable;
  }

  private sampleMetInto(h: number, out: AtmoSample): AtmoSample {
    const tb = this.metTableNow();
    const n = tb.T.length;
    let T: number, Tv: number, P: number;
    const u = (h - tb.z0) / tb.dz;
    if (u <= 0) {
      T = tb.T[0]; Tv = tb.Tv[0]; P = Math.exp(tb.lnP[0]);
    } else if (u >= n - 1) {
      // Cola isoterma por encima de la tabla.
      T = tb.T[n - 1]; Tv = tb.Tv[n - 1];
      const zTop = tb.z0 + (n - 1) * tb.dz;
      const dH = this.model === 'isa2'
        ? h - zTop
        : (R_EARTH_GP * h) / (R_EARTH_GP + h) - (R_EARTH_GP * zTop) / (R_EARTH_GP + zTop);
      P = Math.exp(tb.lnP[n - 1] - (G0 * dH) / (R_AIR * Tv));
    } else {
      const i = Math.floor(u);
      const f = u - i;
      T = tb.T[i] + f * (tb.T[i + 1] - tb.T[i]);
      Tv = tb.Tv[i] + f * (tb.Tv[i + 1] - tb.Tv[i]);
      P = Math.exp(tb.lnP[i] + f * (tb.lnP[i + 1] - tb.lnP[i]));
    }
    out.density = P / (R_AIR * Tv);
    out.temperature = T;
    out.pressure = P;
    out.soundSpeed = Math.sqrt(GAMMA * R_AIR * Tv);
    out.virtualTemperature = Tv;
    return out;
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

  /** Copy sharing nothing mutable (windField reference and met profile copied). */
  clone(): Atmosphere {
    const a = new Atmosphere();
    a.model = this.model;
    a.seaLevelTemperatureK = this.seaLevelTemperatureK;
    a.seaLevelPressurePa = this.seaLevelPressurePa;
    a.relativeHumidity = this.relativeHumidity;
    a.windField = this.windField;
    if (this.metProfile.length) {
      a.metProfile = this.metProfile.map((p) => ({ ...p }));
      a.metTable = this.metTable; // inmutable: compartirla es seguro
    }
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
    this.windField = Atmosphere.profileWindField(points);
  }

  /** Campo de viento de un perfil (con evaluador escalar sin asignaciones). */
  static profileWindField(points: WindProfilePoint[]): WindField {
    if (points.length === 0) return CALM_WIND;
    const pts = [...points].sort((a, b) => a.altitudeM - b.altitudeM);
    const f = ((pos: Vec3) => {
      const h = pos.z;
      if (h <= pts[0].altitudeM) return Atmosphere.steadyWind(pts[0].speedMS, pts[0].fromBearingDeg);
      const last = pts[pts.length - 1];
      if (h >= last.altitudeM) return Atmosphere.steadyWind(last.speedMS, last.fromBearingDeg);
      let i = 1;
      while (pts[i].altitudeM < h) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const fr = (h - a.altitudeM) / (b.altitudeM - a.altitudeM);
      const speed = a.speedMS + fr * (b.speedMS - a.speedMS);
      // Shortest-arc bearing interpolation.
      let dBearing = b.fromBearingDeg - a.fromBearingDeg;
      dBearing = ((dBearing + 540) % 360) - 180;
      const bearing = a.fromBearingDeg + fr * dBearing;
      return Atmosphere.steadyWind(speed, bearing);
    }) as WindField;
    // Mismo cálculo en escalar (bit a bit): steadyWind(speed, bearing).
    const steadyInto = (speed: number, bearingDeg: number, out: Float64Array, o: number) => {
      const br = (bearingDeg * Math.PI) / 180.0;
      out[o] = -speed * Math.sin(br);
      out[o + 1] = -speed * Math.cos(br);
      out[o + 2] = 0.0;
    };
    f.into = (_x, _y, h, _t, out, o) => {
      if (h <= pts[0].altitudeM) { steadyInto(pts[0].speedMS, pts[0].fromBearingDeg, out, o); return; }
      const last = pts[pts.length - 1];
      if (h >= last.altitudeM) { steadyInto(last.speedMS, last.fromBearingDeg, out, o); return; }
      let i = 1;
      while (pts[i].altitudeM < h) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const fr = (h - a.altitudeM) / (b.altitudeM - a.altitudeM);
      const speed = a.speedMS + fr * (b.speedMS - a.speedMS);
      let dBearing = b.fromBearingDeg - a.fromBearingDeg;
      dBearing = ((dBearing + 540) % 360) - 180;
      steadyInto(speed, a.fromBearingDeg + fr * dBearing, out, o);
    };
    return f;
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
