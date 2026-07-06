// ============================================================================
//  BallisticsService.ts — Servicio central de balística.  [P-WEB.2 / P-NEXT.5]
//
//  Equivalente web de UBallisticsWorldSubsystem: posee la atmósfera, la
//  configuración del solver y la dirección de tiro, ancla el marco ENU en la
//  posición real de la batería y muestrea el relieve de Cesium a lo largo del
//  corredor de tiro (async) antes de integrar.
//
//  P-NEXT.5: la ejecución del núcleo vive en un Web Worker
//  (src/ballistics.worker.ts) para que apuntar un misil a 300 km no congele
//  el globo. Este servicio conserva su API async: serializa arma (por id),
//  atmósfera (knobs + WindSpec) y terreno (perfil del corredor ya muestreado,
//  Cesium no entra al worker) como datos planos, y rehidrata los Vec3 de los
//  resultados. Los previews van por un "carril" que cancela solves obsoletos.
//  Sin Worker disponible (p. ej. tests), cae a ejecutar en línea.
// ============================================================================
import * as Cesium from 'cesium';
import { GeoFrame } from './frame';
import { Atmosphere, Vec3, Weapon, WeaponCatalog, WeaponId, WindProfilePoint } from './ballistics';
import type {
  DispersionErrors, DispersionResult, FireOrder, FlightResult, MrsiRound, SolveResult,
  SolverConfig,
} from './ballistics';
import {
  AtmoSpec, CancelMessage, CompareEntry, RangeRing, SolverConfigSpec, TerrainSpec,
  WindSpec, WorkerRequest, WorkerRequestBody, WorkerResponse, executeRequest, hydrateCompare,
  hydrateDispersion, hydrateFlightResult, windFieldOf,
} from './ballistics/WorkerProtocol';

export type { RangeRing } from './ballistics/WorkerProtocol';

export interface TargetSolution {
  found: boolean;
  azimuthDeg: number;
  elevationDeg: number;
  timeOfFlight: number;
  rangeM: number;
}

/** Un solve de carril (preview) fue reemplazado por otro más nuevo. */
export class SupersededError extends Error {
  constructor() {
    super('solve superseded by a newer request');
    this.name = 'SupersededError';
  }
}

export class BallisticsService {
  /** Atmósfera local: muestreo síncrono para VFX/audio (el worker usa su copia). */
  readonly atmo = new Atmosphere();
  frame: GeoFrame;
  /** Altura de la boca del arma sobre el suelo (m). */
  muzzleHeightM = 3.0;
  /** Paso de integración para tiro/preview (el validado en tests). */
  dt = 0.005;
  /** P-PRO.4 — munición seleccionada (índice en Weapon.rounds; 0 = estándar). */
  roundIndex = 0;

  private windSpec: WindSpec = { kind: 'none' };
  private readonly ringCache = new Map<string, RangeRing>();
  private readonly ringInFlight = new Map<string, Promise<RangeRing>>();

  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private readonly laneLatest = new Map<string, number>();

  constructor(private readonly viewer: Cesium.Viewer) {
    // Anclaje por defecto: Sierra de Guadarrama (paisaje con relieve).
    this.frame = new GeoFrame(-3.9, 40.75, 0);
    try {
      this.worker = new Worker(new URL('./ballistics.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorkerMessage(ev.data);
      this.worker.onerror = (ev) => console.error('[ballistics.worker]', ev.message ?? ev);
    } catch {
      console.warn('[BallisticsService] Sin Web Worker: los solves corren en el hilo principal.');
      this.worker = null;
    }
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
    this.ringInFlight.clear();
  }

  /** Arma con la munición seleccionada ya aplicada (P-PRO.4). */
  weapon(id: WeaponId): Weapon {
    const w = WeaponCatalog.get(id);
    const alt = w.rounds?.[this.roundIndex];
    if (alt) w.round = alt;
    return w;
  }

  // -- Meteorología (en vivo; el preview se recalcula al cambiar) -----------
  setSteadyWind(speedMS: number, fromBearingDeg: number): void {
    // Ganancia suave con la altitud (tipo Ekman), saturada a 2x — igual que
    // hacía la capa Unreal. El spec serializable mantiene al worker en sync.
    this.windSpec = { kind: 'steady', speedMS, fromBearingDeg, ekman: true };
    this.atmo.windField = windFieldOf(this.windSpec);
  }

  setWindProfile(points: WindProfilePoint[]): void {
    this.windSpec = { kind: 'profile', points };
    this.atmo.windField = windFieldOf(this.windSpec);
  }

  setSeaLevelConditions(temperatureK: number, pressurePa: number): void {
    this.atmo.seaLevelTemperatureK = temperatureK;
    this.atmo.seaLevelPressurePa = pressurePa;
  }

  /** Velocidad del sonido a una altitud ENU (para el retardo del boom). */
  soundSpeedAt(altitudeM: number): number {
    return this.atmo.sample(Math.max(0, altitudeM + this.frame.heightM)).soundSpeed;
  }

  // -- Serialización hacia el worker -----------------------------------------
  private atmoSpec(): AtmoSpec {
    return {
      model: this.atmo.model,
      seaLevelTemperatureK: this.atmo.seaLevelTemperatureK,
      seaLevelPressurePa: this.atmo.seaLevelPressurePa,
      wind: this.windSpec,
    };
  }

  private makeConfigSpec(overrides: SolverConfigSpec = {}): SolverConfigSpec {
    return {
      dt: this.dt,
      latitudeDeg: this.frame.latDeg,
      anchorLonDeg: this.frame.lonDeg,
      enableCoriolis: true,
      groundZ: 0.0, // el marco está anclado en el suelo de la batería
      ...overrides,
    };
  }

  private call<T>(req: WorkerRequestBody, lane?: string): Promise<T> {
    const id = this.nextId++;
    if (lane) {
      const prev = this.laneLatest.get(lane);
      if (prev !== undefined && this.pending.has(prev) && this.worker) {
        const cancel: CancelMessage = { cancel: prev };
        this.worker.postMessage(cancel);
      }
      this.laneLatest.set(lane, id);
    }
    const request = { ...req, id } as WorkerRequest;
    if (!this.worker) {
      try {
        return Promise.resolve(executeRequest(request) as T);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage(request);
    });
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else if (msg.cancelled) p.reject(new SupersededError());
    else p.reject(new Error(msg.error));
  }

  // -- Muestreo del corredor de tiro ----------------------------------------
  /**
   * P-PRO.3 — muestrea la BANDA del corredor: malla curvilínea con eje `s` a
   * lo largo del rumbo `azimuthDeg` hasta `maxRangeM` y eje `t` perpendicular
   * (±halfWidthM en filas cada stepCrossM), en UNA llamada batched a Cesium.
   * Lo que se aparta del eje — guiados desplazados, salvas, deriva — se
   * resuelve contra las alturas de SU ladera, no las del eje. Con
   * `halfWidthM = 0` degenera al perfil 1D de P-NEXT.5.
   */
  async sampleCorridor(
    azimuthDeg: number,
    maxRangeM: number,
    stepM = 400,
    halfWidthM = 1000,
    stepCrossM = 500,
  ): Promise<TerrainSpec> {
    const az = (azimuthDeg * Math.PI) / 180.0;
    const dir = { e: Math.sin(az), n: Math.cos(az) };
    const right = { e: dir.n, n: -dir.e }; // t positivo a la derecha del rumbo
    const cols = Math.max(2, Math.ceil((maxRangeM * 1.15) / stepM) + 1);
    const rows = halfWidthM > 0 ? 2 * Math.max(1, Math.round(halfWidthM / stepCrossM)) + 1 : 1;
    const halfW = ((rows - 1) / 2) * stepCrossM; // semiancho real de la malla
    const cartos: Cesium.Cartographic[] = [];
    for (let j = 0; j < rows; j++) {
      const t = -halfW + j * stepCrossM;
      for (let i = 0; i < cols; i++) {
        const s = i * stepM;
        cartos.push(this.frame.cartographicOfEnu(
          new Vec3(dir.e * s + right.e * t, dir.n * s + right.n * t, 0),
        ));
      }
    }
    const heights = await this.sampleHeights(cartos);
    const anchorH = this.frame.heightM;
    return {
      dirE: dir.e,
      dirN: dir.n,
      stepAlongM: stepM,
      stepCrossM,
      halfWidthM: halfW,
      rows,
      profile: heights.map((h) => h - anchorH), // alturas en z ENU, row-major
    };
  }

  // -- Tiro y dirección de fuego ---------------------------------------------
  /** Alcance máximo aproximado de un arma+carga (para corredor y anillos). */
  approxMaxRange(id: WeaponId, chargeIndex: number): Promise<RangeRing> {
    const key = `${id}:${this.roundIndex}:${chargeIndex}`;
    const cached = this.ringCache.get(key);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.ringInFlight.get(key);
    if (inFlight) return inFlight;

    const p = this.call<RangeRing>({
      op: 'approxMaxRange',
      weaponId: id,
      roundIndex: this.roundIndex,
      chargeIndex,
      muzzle: this.muzzleEnu,
      atmo: this.atmoSpec(),
      cfg: this.makeConfigSpec({ dt: 0.02, maxFlight: 700 }),
    }).then((ring) => {
      this.ringCache.set(key, ring);
      this.ringInFlight.delete(key);
      return ring;
    });
    this.ringInFlight.set(key, p);
    return p;
  }

  /**
   * Vuela un tiro completo contra el relieve real. `targetEnu` activa el
   * guiado Pro-Nav en municiones guiadas (GMLRS/misil). `lane` agrupa solves
   * reemplazables (preview): uno nuevo cancela al anterior pendiente.
   */
  async solveTrajectory(
    id: WeaponId,
    order: FireOrder,
    targetEnu?: Vec3,
    overrides: Partial<SolverConfig> = {},
    lane?: string,
  ): Promise<FlightResult> {
    const ring = await this.approxMaxRange(id, order.chargeIndex);
    // Objetivo guiado desplazado del eje: ensancha la banda hasta cubrirlo.
    let halfWidthM = 1000;
    if (targetEnu) {
      const az = (order.azimuthDeg * Math.PI) / 180.0;
      const dE = targetEnu.x - this.muzzleEnu.x;
      const dN = targetEnu.y - this.muzzleEnu.y;
      const lateral = Math.abs(dE * Math.cos(az) - dN * Math.sin(az));
      halfWidthM = Math.max(2000, lateral * 1.25);
    }
    const terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM, 400, halfWidthM);
    // Misil de largo alcance: integra sobre Tierra esférica (P1.4, >50 km).
    const spherical = ring.maxRangeM > 50_000;
    const { terrainHeight: _t, gravity: _g, ...plainOverrides } = overrides;
    const raw = await this.call<FlightResult>(
      {
        op: 'solveTrajectory',
        weaponId: id,
        roundIndex: this.roundIndex,
        order,
        targetEnu: targetEnu ?? null,
        muzzle: this.muzzleEnu,
        atmo: this.atmoSpec(),
        cfg: this.makeConfigSpec({ sphericalEarth: spherical, maxFlight: 700, ...plainOverrides }),
        terrain,
      },
      lane,
    );
    return hydrateFlightResult(raw);
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

    const terrain = await this.sampleCorridor(azimuthDeg, Math.max(rangeM * 1.3, 2000));
    const spherical = rangeM > 50_000;
    const sr = await this.call<SolveResult>({
      op: 'solveForTarget',
      weaponId: id,
      roundIndex: this.roundIndex,
      targetRangeM: rangeM,
      azimuthDeg,
      chargeIndex,
      preferHighAngle,
      muzzle: this.muzzleEnu,
      atmo: this.atmoSpec(),
      cfg: this.makeConfigSpec({ sphericalEarth: spherical, maxFlight: 700 }),
      terrain,
    });
    return {
      found: sr.found,
      azimuthDeg,
      elevationDeg: sr.elevationDeg,
      timeOfFlight: sr.timeOfFlight,
      rangeM,
    };
  }

  /**
   * P-NEXT.7 — salva dispersa: n tiros con errores realistas de V0/puntería/
   * viento (RNG determinista por semilla). Devuelve impactos, CEP y los
   * vuelos completos para animarlos y dejar cráteres.
   */
  async fireDispersed(
    id: WeaponId,
    order: FireOrder,
    nRounds: number,
    errors: DispersionErrors,
    seed: number,
  ): Promise<DispersionResult> {
    const ring = await this.approxMaxRange(id, order.chargeIndex);
    // Salva dispersa: banda ancha (±2 km) para que cada tiro desviado
    // encuentre la altura de su ladera, no la del eje.
    const terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM, 400, 2000);
    const raw = await this.call<DispersionResult>({
      op: 'fireDispersed',
      weaponId: id,
      roundIndex: this.roundIndex,
      order,
      nRounds,
      errors,
      seed,
      muzzle: this.muzzleEnu,
      atmo: this.atmoSpec(),
      cfg: this.makeConfigSpec({ sphericalEarth: ring.maxRangeM > 50_000, maxFlight: 700 }),
      terrain,
    });
    return hydrateDispersion(raw);
  }

  /** P2.2 — resuelve una salva MRSI hacia un alcance dado. */
  async solveMRSI(
    id: WeaponId,
    azimuthDeg: number,
    rangeM: number,
    nRounds: number,
  ): Promise<MrsiRound[]> {
    const terrain = await this.sampleCorridor(azimuthDeg, rangeM * 1.3);
    return this.call<MrsiRound[]>({
      op: 'solveMRSI',
      weaponId: id,
      roundIndex: this.roundIndex,
      targetRangeM: rangeM,
      azimuthDeg,
      nRounds,
      muzzle: this.muzzleEnu,
      atmo: this.atmoSpec(),
      cfg: this.makeConfigSpec({ dt: 0.01 }),
      terrain,
    });
  }

  /**
   * P4.2 — modo comparación didáctico: el mismo tiro con físicas acumulativas.
   * Devuelve las 4 trayectorias etiquetadas (vacío, +arrastre, +Coriolis,
   * +viento).
   */
  async compareTrajectories(
    id: WeaponId,
    order: FireOrder,
  ): Promise<CompareEntry[]> {
    const ring = await this.approxMaxRange(id, order.chargeIndex);
    const terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM * 1.6);
    const raw = await this.call<CompareEntry[]>({
      op: 'compareTrajectories',
      weaponId: id,
      roundIndex: this.roundIndex,
      order,
      muzzle: this.muzzleEnu,
      atmo: this.atmoSpec(),
      cfg: this.makeConfigSpec({ maxFlight: 700 }),
      terrain,
    });
    return hydrateCompare(raw);
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
