// ============================================================================
//  BallisticsService.ts — Servicio central de balística.  [P-WEB.2]
//
//  Equivalente web de UBallisticsWorldSubsystem: posee la atmósfera, la
//  configuración del solver y la dirección de tiro, ancla el marco ENU en la
//  posición real de la batería y da al solver un callback de altura de
//  terreno construido MUESTREANDO el relieve de Cesium a lo largo del
//  corredor de tiro (async) antes de integrar — así el impacto cae sobre la
//  ladera real y la integración en sí es síncrona y pura.
// ============================================================================
import * as Cesium from 'cesium';
import { GeoFrame } from './frame';
import {
  Atmosphere, FlightResult, SolverConfig, Vec3, Weapon, WeaponCatalog, WeaponId,
  WeaponSystem, WindProfilePoint,
} from './ballistics';
import type { FireOrder, MrsiRound } from './ballistics';

export interface TargetSolution {
  found: boolean;
  azimuthDeg: number;
  elevationDeg: number;
  timeOfFlight: number;
  rangeM: number;
}

export interface RangeRing { minRangeM: number; maxRangeM: number; }

/** Callback de terreno: (este, norte) -> altura z ENU en metros. */
export type TerrainFn = (east: number, north: number) => number;

export class BallisticsService {
  readonly atmo = new Atmosphere();
  frame: GeoFrame;
  /** Altura de la boca del arma sobre el suelo (m). */
  muzzleHeightM = 3.0;
  /** Paso de integración para tiro/preview (el validado en tests). */
  dt = 0.005;

  private readonly ringCache = new Map<string, RangeRing>();

  constructor(private readonly viewer: Cesium.Viewer) {
    // Anclaje por defecto: Sierra de Guadarrama (paisaje con relieve).
    this.frame = new GeoFrame(-3.9, 40.75, 0);
  }

  /** Posición ENU de la boca del arma. */
  get muzzleEnu(): Vec3 { return new Vec3(0, 0, this.muzzleHeightM); }

  get batteryLatDeg(): number { return this.frame.latDeg; }

  /**
   * Ancla la batería en (lon, lat): muestrea la altura real del terreno y
   * reconstruye el marco ENU sobre el suelo. La latitud alimenta el Coriolis.
   */
  async setBattery(lonDeg: number, latDeg: number): Promise<void> {
    const h = await this.sampleHeight(Cesium.Cartographic.fromDegrees(lonDeg, latDeg));
    this.frame = new GeoFrame(lonDeg, latDeg, h);
    this.ringCache.clear();
  }

  weapon(id: WeaponId): Weapon { return WeaponCatalog.get(id); }

  // -- Meteorología (en vivo; el preview se recalcula al cambiar) -----------
  setSteadyWind(speedMS: number, fromBearingDeg: number): void {
    // Ganancia suave con la altitud (tipo Ekman), saturada a 2x — igual que
    // hacía la capa Unreal.
    this.atmo.windField = (pos) => {
      const gain = Math.min(2.0, Math.max(1.0, 1.0 + pos.z / 8000.0));
      return Atmosphere.steadyWind(speedMS * gain, fromBearingDeg);
    };
  }

  setWindProfile(points: WindProfilePoint[]): void {
    this.atmo.setWindProfile(points);
  }

  setSeaLevelConditions(temperatureK: number, pressurePa: number): void {
    this.atmo.seaLevelTemperatureK = temperatureK;
    this.atmo.seaLevelPressurePa = pressurePa;
  }

  /** Velocidad del sonido a una altitud ENU (para el retardo del boom). */
  soundSpeedAt(altitudeM: number): number {
    return this.atmo.sample(Math.max(0, altitudeM + this.frame.heightM)).soundSpeed;
  }

  // -- Configuración del solver ---------------------------------------------
  makeConfig(terrain?: TerrainFn, overrides: Partial<SolverConfig> = {}): SolverConfig {
    const cfg = SolverConfig.with({
      dt: this.dt,
      latitudeDeg: this.frame.latDeg,
      anchorLonDeg: this.frame.lonDeg,
      enableCoriolis: true,
      groundZ: 0.0, // el marco está anclado en el suelo de la batería
      ...overrides,
    });
    if (terrain) cfg.terrainHeight = terrain;
    return cfg;
  }

  // -- Muestreo del corredor de tiro ----------------------------------------
  /**
   * Muestrea la altura del terreno a lo largo del rumbo `azimuthDeg` hasta
   * `maxRangeM` y devuelve un callback (este, norte) -> z ENU que interpola
   * por distancia proyectada sobre el rayo. La deriva lateral de un tiro es
   * pequeña frente al paso de muestreo, así que un perfil 1D basta (y evita
   * miles de raycasts).
   */
  async sampleCorridor(azimuthDeg: number, maxRangeM: number, stepM = 400): Promise<TerrainFn> {
    const az = (azimuthDeg * Math.PI) / 180.0;
    const dir = { e: Math.sin(az), n: Math.cos(az) };
    const count = Math.max(2, Math.ceil((maxRangeM * 1.15) / stepM) + 1);
    const cartos: Cesium.Cartographic[] = [];
    for (let i = 0; i < count; i++) {
      const s = i * stepM;
      cartos.push(this.frame.cartographicOfEnu(new Vec3(dir.e * s, dir.n * s, 0)));
    }
    const heights = await this.sampleHeights(cartos);
    const anchorH = this.frame.heightM;
    const profile = heights.map((h) => h - anchorH); // alturas en z ENU

    return (east: number, north: number) => {
      const s = east * dir.e + north * dir.n; // distancia proyectada
      if (s <= 0) return profile[0];
      const k = s / stepM;
      const i = Math.floor(k);
      if (i >= profile.length - 1) return profile[profile.length - 1];
      const f = k - i;
      return profile[i] + f * (profile[i + 1] - profile[i]);
    };
  }

  // -- Tiro y dirección de fuego ---------------------------------------------
  /** Alcance máximo aproximado de un arma+carga (para corredor y anillos). */
  approxMaxRange(id: WeaponId, chargeIndex: number): RangeRing {
    const key = `${id}:${chargeIndex}`;
    const cached = this.ringCache.get(key);
    if (cached) return cached;

    const w = this.weapon(id);
    const cfg = this.makeConfig(undefined, { dt: 0.02, maxFlight: 700 });
    const fc = new WeaponSystem(this.atmo, cfg);
    const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex });
    let maxR = 0;
    let minR = Number.POSITIVE_INFINITY;
    for (let el = w.minElevationDeg; el <= w.maxElevationDeg; el += 5.0) {
      const r = fc.rangeForElevation(w, this.muzzleEnu, 0, v0, el);
      maxR = Math.max(maxR, r);
      minR = Math.min(minR, r);
    }
    const ring = { minRangeM: minR, maxRangeM: maxR };
    this.ringCache.set(key, ring);
    return ring;
  }

  /**
   * Vuela un tiro completo contra el relieve real. `targetEnu` activa el
   * guiado Pro-Nav en municiones guiadas (GMLRS/misil).
   */
  async solveTrajectory(
    id: WeaponId,
    order: FireOrder,
    targetEnu?: Vec3,
    overrides: Partial<SolverConfig> = {},
  ): Promise<FlightResult> {
    const w = this.weapon(id);
    const ring = this.approxMaxRange(id, order.chargeIndex);
    const terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM);
    // Misil de largo alcance: integra sobre Tierra esférica (P1.4, >50 km).
    const spherical = ring.maxRangeM > 50_000;
    const cfg = this.makeConfig(terrain, { sphericalEarth: spherical, maxFlight: 700, ...overrides });
    const fc = new WeaponSystem(this.atmo, cfg);
    return fc.fire(w, this.muzzleEnu, order, targetEnu);
  }

  /**
   * Dirección de tiro inversa hacia un punto ENU (clic en el globo):
   * calcula azimut + elevación (rama alta/baja) contra el relieve real.
   */
  async solveForTarget(
    id: WeaponId,
    targetEnu: Vec3,
    chargeIndex: number,
    preferHighAngle: boolean,
  ): Promise<TargetSolution> {
    const dE = targetEnu.x - this.muzzleEnu.x;
    const dN = targetEnu.y - this.muzzleEnu.y;
    const azimuthDeg = (Math.atan2(dE, dN) * 180.0) / Math.PI;
    const rangeM = Math.hypot(dE, dN);

    const w = this.weapon(id);
    const terrain = await this.sampleCorridor(azimuthDeg, Math.max(rangeM * 1.3, 2000));
    const spherical = rangeM > 50_000;
    const cfg = this.makeConfig(terrain, { sphericalEarth: spherical, maxFlight: 700 });
    const fc = new WeaponSystem(this.atmo, cfg);
    const sr = fc.solveForRange(w, this.muzzleEnu, rangeM, azimuthDeg, chargeIndex, preferHighAngle);
    return {
      found: sr.found,
      azimuthDeg,
      elevationDeg: sr.elevationDeg,
      timeOfFlight: sr.timeOfFlight,
      rangeM,
    };
  }

  /** P2.2 — resuelve una salva MRSI hacia un alcance dado. */
  async solveMRSI(
    id: WeaponId,
    azimuthDeg: number,
    rangeM: number,
    nRounds: number,
  ): Promise<MrsiRound[]> {
    const w = this.weapon(id);
    const terrain = await this.sampleCorridor(azimuthDeg, rangeM * 1.3);
    const cfg = this.makeConfig(terrain, { dt: 0.01 });
    const fc = new WeaponSystem(this.atmo, cfg);
    return fc.solveMRSI(w, this.muzzleEnu, rangeM, azimuthDeg, nRounds);
  }

  /**
   * P4.2 — modo comparación didáctico: el mismo tiro con físicas acumulativas.
   * Devuelve las 4 trayectorias etiquetadas (vacío, +arrastre, +Coriolis,
   * +viento).
   */
  async compareTrajectories(
    id: WeaponId,
    order: FireOrder,
  ): Promise<{ label: string; cssColor: string; result: FlightResult }[]> {
    const w = this.weapon(id);
    const ring = this.approxMaxRange(id, order.chargeIndex);
    const terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM * 1.6);

    const calm = this.atmo.clone();
    calm.windField = () => new Vec3(0, 0, 0);

    const run = (atmo: Atmosphere, overrides: Partial<SolverConfig>): FlightResult => {
      const cfg = this.makeConfig(terrain, { maxFlight: 700, ...overrides });
      const fc = new WeaponSystem(atmo, cfg);
      return fc.fire(w, this.muzzleEnu, order);
    };

    return [
      {
        label: 'Vacío (sin atmósfera)', cssColor: '#9aa4ad',
        result: run(calm, { enableDrag: false, enableCoriolis: false }),
      },
      {
        label: 'Con arrastre', cssColor: '#4dc3ff',
        result: run(calm, { enableCoriolis: false }),
      },
      {
        label: 'Arrastre + Coriolis', cssColor: '#ffb545',
        result: run(calm, {}),
      },
      {
        label: 'Todo + viento', cssColor: '#ff5d5d',
        result: run(this.atmo, {}),
      },
    ];
  }

  // -- Terreno ---------------------------------------------------------------
  private async sampleHeights(cartos: Cesium.Cartographic[]): Promise<number[]> {
    const provider = this.viewer.terrainProvider;
    // Sin terreno real (elipsoide, p.ej. sin token de ion) todo es altura 0.
    if (provider instanceof Cesium.EllipsoidTerrainProvider) {
      return cartos.map(() => 0);
    }
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(
        provider,
        cartos.map((c) => c.clone()),
      );
      return sampled.map((c) => (Number.isFinite(c.height) ? c.height : 0));
    } catch {
      return cartos.map(() => 0);
    }
  }

  private async sampleHeight(carto: Cesium.Cartographic): Promise<number> {
    return (await this.sampleHeights([carto]))[0];
  }
}
