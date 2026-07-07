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
import { sampleDem } from './dem';
import { GeoFrame } from './frame';
import {
  Atmosphere, DeterministicRng, MAX_RICOCHETS, Vec3, Weapon, WeaponCatalog, WeaponId,
  WindProfilePoint, grazingAngleDeg, normalFromHeights, reflectVelocity, shouldRicochet,
} from './ballistics';
import type {
  DispersionErrors, DispersionPrediction, DispersionResult, FireOrder, FiringTable,
  FlightResult, MrsiRound, SolveResult, SolverConfig,
} from './ballistics';
import {
  AtmoSpec, CancelMessage, CompareEntry, RangeRing, SolverConfigSpec, TerrainSpec,
  WindSpec, WorkerRequest, WorkerRequestBody, WorkerResponse, executeRequest, hydrateCompare,
  hydrateDispersion, hydrateFlightResult, windFieldOf,
} from './ballistics/WorkerProtocol';

export type { RangeRing, TerrainSpec } from './ballistics/WorkerProtocol';

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
  /** P-PRO.5 — tablas de tiro por clave (arma+munición+carga+meteo+latitud). */
  private readonly tableCache = new Map<string, FiringTable>();

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

  // -- Suelo visual (Edificios 3D) --------------------------------------------
  /**
   * P-NEXT.3 fix — con los Photorealistic 3D Tiles activos, el suelo VISUAL
   * es el de Google (viene horneado en las teselas) y no coincide con el
   * terrainProvider: sin token de ion (elipsoide) la diferencia son cientos
   * de metros y todo lo ENU quedaba enterrado. Cuando main.ts fija este
   * tileset, el anclaje de la batería y los decals muestrean contra él.
   */
  private tilesetGround: Cesium.Cesium3DTileset | null = null;

  setTilesetGround(tileset: Cesium.Cesium3DTileset | null): void {
    this.tilesetGround = tileset;
  }

  /** Altura elipsoidal del suelo visual en las teselas 3D, o null si no hay. */
  private async tilesetHeight(carto: Cesium.Cartographic): Promise<number | null> {
    const scene = this.viewer.scene;
    if (!this.tilesetGround?.show || !scene.sampleHeightSupported) return null;
    try {
      const [s] = await scene.sampleHeightMostDetailed([carto.clone()]);
      return s && Number.isFinite(s.height) ? s.height : null;
    } catch {
      return null;
    }
  }

  /**
   * z ENU del suelo VISUAL en un punto (teselas 3D si están activas; si no,
   * el proveedor de terreno real). Devuelve null si no hay fuente mejor que
   * la física (elipsoide sin teselas): el llamador conserva su z.
   */
  async visualGroundZ(enu: Vec3): Promise<number | null> {
    const carto = this.frame.cartographicOfEnu(new Vec3(enu.x, enu.y, 0));
    const fromTiles = await this.tilesetHeight(carto);
    if (fromTiles !== null) return fromTiles - this.frame.heightM;
    if (this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) return null;
    const [h] = await this.sampleHeights([carto]);
    return h - this.frame.heightM;
  }

  /**
   * Ancla la batería en (lon, lat): muestrea la altura real del terreno —
   * contra las teselas 3D si están activas — y reconstruye el marco ENU
   * sobre el suelo. La latitud alimenta el Coriolis.
   */
  async setBattery(lonDeg: number, latDeg: number): Promise<void> {
    const carto = Cesium.Cartographic.fromDegrees(lonDeg, latDeg);
    let h = await this.tilesetHeight(carto);
    if (h === null) h = await this.sampleHeight(carto);
    this.frame = new GeoFrame(lonDeg, latDeg, h);
    this.ringCache.clear();
    this.ringInFlight.clear();
    this.waterCache.clear(); // P-VIVO.4 — las celdas eran ENU de la posición vieja
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
    // Paso adaptativo: a 500 km no hacen falta muestras cada 400 m (y el DEM
    // iría a ~9 peticiones en vez de ~70). Cota: ≤161 columnas por fila.
    const step = Math.max(stepM, (maxRangeM * 1.15) / 160);
    const cols = Math.max(2, Math.ceil((maxRangeM * 1.15) / step) + 1);
    const rows = halfWidthM > 0 ? 2 * Math.max(1, Math.round(halfWidthM / stepCrossM)) + 1 : 1;
    const halfW = ((rows - 1) / 2) * stepCrossM; // semiancho real de la malla
    const cartos: Cesium.Cartographic[] = [];
    for (let j = 0; j < rows; j++) {
      const t = -halfW + j * stepCrossM;
      for (let i = 0; i < cols; i++) {
        const s = i * step;
        cartos.push(this.frame.cartographicOfEnu(
          new Vec3(dir.e * s + right.e * t, dir.n * s + right.n * t, 0),
        ));
      }
    }
    const heights = await this.sampleHeights(cartos);
    // Perfil RELATIVO a la muestra de la propia batería (fila central, s=0):
    // z ENU = 0 es el suelo del ancla. Inmune al dátum de la fuente (DEM MSL
    // vs teselas/terreno elipsoidales) y alinea CWT con el ancla del tileset.
    const ref = heights[((rows - 1) / 2) * cols];
    return {
      dirE: dir.e,
      dirN: dir.n,
      stepAlongM: step,
      stepCrossM,
      halfWidthM: halfW,
      rows,
      profile: heights.map((h) => h - ref), // alturas en z ENU, row-major
    };
  }

  // -- P-VIVO.4 — superficies: agua y rebotes rasantes -------------------------

  /** ¿Hay una fuente REAL de alturas? (elipsoide pelado = no se clasifica). */
  hasRealTerrain(): boolean {
    return (
      !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) ||
      !!this.tilesetGround?.show
    );
  }

  private readonly waterCache = new Map<string, boolean>();

  /**
   * P-VIVO.4 — clasificación de superficie: un impacto es AGUA si la altura
   * muestreada del terreno en el punto es < 0.5 m — el océano es 0 exacto
   * tanto en Cesium World Terrain como en el DEM Copernicus. LIMITACIÓN
   * HONESTA (documentada): lagos y ríos interiores NO se detectan (están por
   * encima de 0 m). Sin fuente real de terreno devuelve false. Caché por
   * celda de 50 m: una ráfaga sobre el mar no re-muestrea por bala.
   */
  async isLikelyWater(enu: Vec3): Promise<boolean> {
    if (!this.hasRealTerrain()) return false;
    const key = `${Math.round(enu.x / 50)}:${Math.round(enu.y / 50)}`;
    const hit = this.waterCache.get(key);
    if (hit !== undefined) return hit;
    try {
      const carto = this.frame.cartographicOfEnu(new Vec3(enu.x, enu.y, 0));
      const [h] = await this.sampleHeights([carto]);
      const water = h < 0.5;
      if (this.waterCache.size > 256) this.waterCache.clear();
      this.waterCache.set(key, water);
      return water;
    } catch {
      return false;
    }
  }

  /**
   * P-VIVO.5 — alturas del TERRENO (sin edificios) en varios puntos ENU,
   * RELATIVAS a la muestra de la propia batería: el dátum de la fuente (DEM
   * MSL vs terreno/teselas elipsoidales) se cancela, igual que en el
   * corredor de tiro. Comparable 1:1 con las alturas visuales del tileset
   * (cuyo marco también ancla la batería en z=0).
   */
  async terrainZRelative(pts: Vec3[]): Promise<number[]> {
    const cartos = [
      this.frame.cartographicOfEnu(new Vec3(0, 0, 0)),
      ...pts.map((p) => this.frame.cartographicOfEnu(new Vec3(p.x, p.y, 0))),
    ];
    const heights = await this.sampleHeights(cartos);
    const ref = heights[0];
    return pts.map((_, i) => heights[i + 1] - ref);
  }

  /** Tres alturas z ENU alrededor de un punto (para la normal del terreno). */
  private async groundPatch(
    enu: Vec3, epsM: number,
  ): Promise<{ z0: number; zx: number; zy: number }> {
    const cartos = [
      this.frame.cartographicOfEnu(new Vec3(enu.x, enu.y, 0)),
      this.frame.cartographicOfEnu(new Vec3(enu.x + epsM, enu.y, 0)),
      this.frame.cartographicOfEnu(new Vec3(enu.x, enu.y + epsM, 0)),
    ];
    const [h0, hx, hy] = await this.sampleHeights(cartos);
    return { z0: h0 - this.frame.heightM, zx: hx - this.frame.heightM, zy: hy - this.frame.heightM };
  }

  /** P-VIVO.4 — re-integra la munición desde un estado arbitrario (rebote). */
  async solveFromState(
    id: WeaponId,
    startPos: Vec3,
    startVel: Vec3,
    terrain: TerrainSpec,
  ): Promise<FlightResult> {
    const raw = await this.call<FlightResult>({
      op: 'solveFromState',
      weaponId: id,
      roundIndex: this.roundIndex,
      startPos,
      startVel,
      muzzle: this.muzzleEnu,
      atmo: this.atmoSpec(),
      cfg: this.makeConfigSpec({ maxFlight: 120 }),
      terrain,
    });
    return hydrateFlightResult(raw);
  }

  /**
   * P-VIVO.4 — tiro de arma ligera con rebotes rasantes encadenados: resuelve
   * el tramo balístico y, si el impacto es AGUA con ángulo de caída < 12º,
   * refleja la velocidad (ricochet.ts, RNG determinista sembrado por disparo)
   * y RE-INTEGRA el tramo siguiente en el worker. Máximo 2 rebotes. Devuelve
   * los tramos en orden; el presentador los encadena sin costura.
   * En tierra (o sin fuente real de terreno) el resultado es EXACTAMENTE el
   * de solveTrajectory: un solo tramo.
   */
  async solveWithRicochets(
    id: WeaponId,
    order: FireOrder,
    seed: number,
    presampledTerrain?: TerrainSpec,
  ): Promise<FlightResult[]> {
    const weapon = this.weapon(id);
    let terrain = presampledTerrain ?? null;
    if (!terrain && weapon.category === 'SmallArms' && this.hasRealTerrain()) {
      // Un corredor para TODOS los tramos (los rebotes se quedan en la banda).
      const ring = await this.approxMaxRange(id, order.chargeIndex);
      terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM, 400, 1000);
    }
    const first = await this.solveTrajectory(
      id, order, undefined, {}, undefined, terrain ?? undefined,
    );
    const segments: FlightResult[] = [first];
    if (weapon.category !== 'SmallArms' || !this.hasRealTerrain() || !terrain) return segments;

    const rng = new DeterministicRng(seed);
    let current = first;
    for (let n = 0; n < MAX_RICOCHETS; n++) {
      if (!current.impacted || current.detonation !== 'ground' || current.path.length < 2) break;
      const impact = current.impactPoint;
      if (!(await this.isLikelyWater(impact))) break; // en tierra nada cambia
      const patch = await this.groundPatch(impact, 12);
      const normal = normalFromHeights(patch.z0, patch.zx, patch.zy, 12);
      const vIn = current.path[current.path.length - 1].velocity;
      const angle = grazingAngleDeg(vIn, normal);
      if (!shouldRicochet(angle, rng)) break;
      const vOut = reflectVelocity(vIn, normal, rng);
      current = await this.solveFromState(
        id,
        new Vec3(impact.x, impact.y, impact.z + 0.05), // despegado del plano
        new Vec3(vOut.x, vOut.y, vOut.z),
        terrain,
      );
      segments.push(current);
    }
    return segments;
  }

  /**
   * P-VIVO.6 — perfil de alturas z ENU a lo largo de la recta A→B (ambos en
   * ENU), equiespaciado. Para validar LÍNEA DE VISIÓN del puesto de
   * observación y para pegar blancos móviles al suelo (P-VIVO.7). Usa la
   * misma cascada de terreno que el corredor (CWT → DEM → plano), y como el
   * dátum desplaza TODAS las muestras por igual, la forma relativa — lo único
   * que la LOS necesita — es invariante.
   */
  async sampleLineProfile(aEnu: Vec3, bEnu: Vec3, stepM = 120): Promise<number[]> {
    const dx = bEnu.x - aEnu.x;
    const dy = bEnu.y - aEnu.y;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.min(96, Math.ceil(len / Math.max(30, stepM)) + 1));
    const cartos: Cesium.Cartographic[] = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      cartos.push(this.frame.cartographicOfEnu(new Vec3(aEnu.x + dx * f, aEnu.y + dy * f, 0)));
    }
    const heights = await this.sampleHeights(cartos);
    return heights.map((h) => h - this.frame.heightM);
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
   * `presampledTerrain` (P-VIVO.2) reutiliza un corredor ya muestreado: una
   * ráfaga de 9 disparos/s no debe re-muestrear el DEM por bala (el rebufo
   * mueve el rumbo ±0.15º y la banda 2D resuelve el desvío lateral igual).
   */
  async solveTrajectory(
    id: WeaponId,
    order: FireOrder,
    targetEnu?: Vec3,
    overrides: Partial<SolverConfig> = {},
    lane?: string,
    presampledTerrain?: TerrainSpec,
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
    const terrain =
      presampledTerrain ??
      (await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM, 400, halfWidthM));
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

  /**
   * P-PRO.6 — elipse de error 1σ PREDICHA (a priori): sensibilidades por
   * diferencias finitas en el worker (7 integraciones, carril cancelable).
   */
  async predictDispersion(
    id: WeaponId,
    order: FireOrder,
    errors: DispersionErrors,
  ): Promise<DispersionPrediction> {
    const ring = await this.approxMaxRange(id, order.chargeIndex);
    const terrain = await this.sampleCorridor(order.azimuthDeg, ring.maxRangeM, 400, 2000);
    return this.call<DispersionPrediction>(
      {
        op: 'predictDispersion',
        weaponId: id,
        roundIndex: this.roundIndex,
        order,
        errors,
        muzzle: this.muzzleEnu,
        atmo: this.atmoSpec(),
        cfg: this.makeConfigSpec({
          dt: 0.01, sphericalEarth: ring.maxRangeM > 50_000, maxFlight: 700,
        }),
        terrain,
      },
      'predict-dispersion',
    );
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

  /**
   * P-PRO.5 — tabla de tiro del arma/carga con la meteo ACTUAL (la columna de
   * deriva incluye el viento). Cachea por clave completa: cambiar viento,
   * temperatura, presión, munición o batería invalida sola la entrada. Corre
   * en el worker (carril propio): el globo no se congela.
   */
  async generateFiringTable(
    id: WeaponId,
    chargeIndex: number,
    stepM: number,
  ): Promise<FiringTable> {
    const key = JSON.stringify({
      id, round: this.roundIndex, chargeIndex, stepM,
      atmo: this.atmoSpec(), lat: this.frame.latDeg,
    });
    const hit = this.tableCache.get(key);
    if (hit) return hit;
    const table = await this.call<FiringTable>(
      {
        op: 'generateFiringTable',
        weaponId: id,
        roundIndex: this.roundIndex,
        chargeIndex,
        stepM,
        muzzle: this.muzzleEnu,
        atmo: this.atmoSpec(),
        cfg: this.makeConfigSpec({ dt: 0.01 }), // ±0.1%: de sobra para la lección
      },
      'firing-table',
    );
    if (this.tableCache.size >= 8) {
      this.tableCache.delete(this.tableCache.keys().next().value!); // FIFO
    }
    this.tableCache.set(key, table);
    return table;
  }

  // -- Terreno ---------------------------------------------------------------
  private async sampleHeights(cartos: Cesium.Cartographic[]): Promise<number[]> {
    const provider = this.viewer.terrainProvider;
    if (provider instanceof Cesium.EllipsoidTerrainProvider) {
      // Modo plano (OSM): el suelo visual ES el elipsoide → 0 m, como siempre.
      if (!this.tilesetGround?.show) return cartos.map(() => 0);
      // Edificios 3D activos: el suelo visual de Google trae el relieve REAL
      // horneado en las teselas — la física debe verlo o las parábolas acaban
      // flotando sobre el valle / atravesando crestas. Se muestrea el DEM
      // Copernicus GLO-90 (Open-Meteo, sin clave); da alturas MSL, pero el
      // corredor usa el perfil RELATIVO a su primer punto y el dátum se
      // cancela. Sin red: plano a la cota del ancla (el arreglo anterior).
      const dem = await sampleDem(
        cartos.map((c) => ({
          latDeg: Cesium.Math.toDegrees(c.latitude),
          lonDeg: Cesium.Math.toDegrees(c.longitude),
        })),
      );
      return dem ?? cartos.map(() => this.frame.heightM);
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
