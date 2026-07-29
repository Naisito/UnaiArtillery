// ============================================================================
//  WorkerProtocol.ts — Serialización y despacho de solves fuera del hilo UI.
//  [P-NEXT.5]
//
//  El núcleo balístico es TS puro sin DOM, así que puede correr en un Web
//  Worker — pero armas, atmósfera y terreno viajan por postMessage como DATOS
//  PLANOS, nunca como funciones:
//    * el arma se reconstruye en el worker por id de catálogo;
//    * la atmósfera viaja como knobs + WindSpec serializable (constante con
//      ganancia Ekman, o perfil por altitud);
//    * el terreno viaja como la banda del corredor YA muestreada en el hilo
//      principal (malla de alturas + pasos + rumbo) — muestrear necesita
//      Cesium.
//
//  `executeRequest` es el despachador real: lo usa el worker
//  (src/ballistics.worker.ts), el fallback síncrono del servicio cuando no
//  hay Worker disponible, y el test de ida y vuelta del protocolo
//  (serialization.test.ts) — mismo código en los tres sitios.
// ============================================================================
import { Atmosphere, AtmosphereModel, WindField, WindProfilePoint } from './Atmosphere';
import { FlightResult, SolverConfig } from './BallisticsSolver';
import { FiringTable, generateFiringTable } from './FiringTables';
import { Vec3 } from './Vec3';
import { WeaponCatalog, WeaponId } from './WeaponCatalog';
import {
  DispersionErrors, DispersionPrediction, DispersionResult, FireOrder, MrsiRound, SolveResult,
  V0Correction, WeaponSystem, v0Factor,
} from './WeaponSystem';

export interface PlainVec3 { x: number; y: number; z: number }

// ---------------------------------------------------------------------------
//  Atmósfera como datos planos.
// ---------------------------------------------------------------------------
export type WindSpec =
  | { kind: 'none' }
  /** Viento constante; `ekman` aplica la ganancia suave con la altitud (×2 máx). */
  | { kind: 'steady'; speedMS: number; fromBearingDeg: number; ekman: boolean }
  | { kind: 'profile'; points: WindProfilePoint[] };

export interface AtmoSpec {
  model: AtmosphereModel;
  seaLevelTemperatureK: number;
  seaLevelPressurePa: number;
  wind: WindSpec;
}

/** Campo de viento equivalente a un WindSpec (mismo código en app y worker). */
export function windFieldOf(spec: WindSpec): WindField {
  switch (spec.kind) {
    case 'none':
      return () => new Vec3(0, 0, 0);
    case 'steady': {
      const { speedMS, fromBearingDeg, ekman } = spec;
      if (!ekman) return () => Atmosphere.steadyWind(speedMS, fromBearingDeg);
      return (pos) => {
        const gain = Math.min(2.0, Math.max(1.0, 1.0 + pos.z / 8000.0));
        return Atmosphere.steadyWind(speedMS * gain, fromBearingDeg);
      };
    }
    case 'profile': {
      const a = new Atmosphere();
      a.setWindProfile(spec.points);
      return a.windField;
    }
  }
}

export function buildAtmosphere(spec: AtmoSpec): Atmosphere {
  const a = new Atmosphere();
  a.model = spec.model;
  a.seaLevelTemperatureK = spec.seaLevelTemperatureK;
  a.seaLevelPressurePa = spec.seaLevelPressurePa;
  a.windField = windFieldOf(spec.wind);
  return a;
}

// ---------------------------------------------------------------------------
//  Terreno como banda 2D curvilínea del corredor de tiro (P-PRO.3).
//
//  Malla con eje `s` a lo largo del rumbo y eje `t` perpendicular (positivo a
//  la derecha del rumbo), t ∈ [-halfWidthM, +halfWidthM] en `rows` filas.
//  `profile` es row-major: profile[j*cols + i] con j la fila transversal
//  (j = 0 → t = -halfWidthM) e i la columna a lo largo (s = i·stepAlongM).
//  rows = 1 degenera EXACTAMENTE al perfil 1D de P-NEXT.5.
// ---------------------------------------------------------------------------
export interface TerrainSpec {
  dirE: number;         // rumbo del corredor (unitario)
  dirN: number;
  /** Paso a lo largo del rumbo. */
  stepAlongM?: number;
  /** Alias legado de stepAlongM (specs 1D de P-NEXT.5). */
  stepM?: number;
  /** Paso transversal entre filas (solo rows > 1). */
  stepCrossM?: number;
  /** Semiancho de la banda: t de la fila 0 es -halfWidthM (solo rows > 1). */
  halfWidthM?: number;
  /** Filas transversales; 1 (o ausente) = perfil 1D clásico. */
  rows?: number;
  profile: number[];    // alturas z ENU, row-major rows × cols
}

/**
 * Callback (este, norte) -> z ENU. Con rows = 1 interpola el perfil por
 * distancia proyectada (idéntico bit a bit al 1D de P-NEXT.5); con rows > 1
 * interpola BILINEAL sobre la malla curvilínea, con clamp en los 4 bordes.
 */
export function buildTerrain(spec: TerrainSpec): (east: number, north: number) => number {
  const { dirE, dirN, profile } = spec;
  const stepAlong = spec.stepAlongM ?? spec.stepM;
  if (stepAlong === undefined) throw new Error('TerrainSpec sin stepAlongM/stepM');
  const rows = spec.rows ?? 1;

  if (rows <= 1) {
    return (east: number, north: number) => {
      const s = east * dirE + north * dirN; // distancia proyectada sobre el rayo
      if (s <= 0) return profile[0];
      const k = s / stepAlong;
      const i = Math.floor(k);
      if (i >= profile.length - 1) return profile[profile.length - 1];
      const f = k - i;
      return profile[i] + f * (profile[i + 1] - profile[i]);
    };
  }

  const stepCross = spec.stepCrossM ?? stepAlong;
  const halfWidth = spec.halfWidthM ?? ((rows - 1) / 2) * stepCross;
  const cols = Math.floor(profile.length / rows);
  return (east: number, north: number) => {
    const s = east * dirE + north * dirN;
    const t = east * dirN - north * dirE; // positivo a la derecha del rumbo
    let u = s / stepAlong;
    if (u < 0) u = 0; else if (u > cols - 1) u = cols - 1;
    let v = (t + halfWidth) / stepCross;
    if (v < 0) v = 0; else if (v > rows - 1) v = rows - 1;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const i1 = Math.min(i0 + 1, cols - 1);
    const j1 = Math.min(j0 + 1, rows - 1);
    const fi = u - i0;
    const fj = v - j0;
    const z00 = profile[j0 * cols + i0];
    const z10 = profile[j0 * cols + i1];
    const z01 = profile[j1 * cols + i0];
    const z11 = profile[j1 * cols + i1];
    const za = z00 + fi * (z10 - z00);
    const zb = z01 + fi * (z11 - z01);
    return za + fj * (zb - za);
  };
}

// ---------------------------------------------------------------------------
//  Config del solver como campos escalares (sin funciones ni Vec3).
// ---------------------------------------------------------------------------
export type SolverConfigSpec = Partial<
  Pick<
    SolverConfig,
    | 'dt' | 'maxFlight' | 'groundZ' | 'enableCoriolis' | 'latitudeDeg'
    | 'sampleEvery' | 'enableDrag' | 'sphericalEarth' | 'anchorLonDeg'
  >
>;

// ---------------------------------------------------------------------------
//  Protocolo request/response.
// ---------------------------------------------------------------------------
interface BaseRequest {
  id: number;
  weaponId: WeaponId;
  /** P-PRO.4 — índice en Weapon.rounds (municiones alternativas); 0/ausente = estándar. */
  roundIndex?: number;
  muzzle: PlainVec3;
  atmo: AtmoSpec;
  cfg: SolverConfigSpec;
  terrain?: TerrainSpec;
}

export type WorkerRequest =
  | (BaseRequest & { op: 'solveTrajectory'; order: FireOrder; targetEnu?: PlainVec3 | null })
  | (BaseRequest & {
      op: 'solveForTarget';
      targetRangeM: number;
      azimuthDeg: number;
      chargeIndex: number;
      preferHighAngle: boolean;
      /** P-VIVO.9 — la solución debe usar la V0 efectiva. */
      v0Correction?: V0Correction;
    })
  | (BaseRequest & {
      op: 'solveMRSI';
      targetRangeM: number;
      azimuthDeg: number;
      nRounds: number;
      v0Correction?: V0Correction;
    })
  | (BaseRequest & { op: 'compareTrajectories'; order: FireOrder })
  | (BaseRequest & {
      op: 'approxMaxRange';
      chargeIndex: number;
      minElStepDeg?: number;
      v0Correction?: V0Correction;
    })
  | (BaseRequest & {
      op: 'fireDispersed';
      order: FireOrder;
      nRounds: number;
      errors: DispersionErrors;
      seed: number;
    })
  | (BaseRequest & {
      op: 'generateFiringTable';
      chargeIndex: number;
      stepM: number;
      v0Correction?: V0Correction;
    })
  | (BaseRequest & { op: 'predictDispersion'; order: FireOrder; errors: DispersionErrors });

/** Petición sin id (el servicio lo asigna). Omit distributivo sobre la unión. */
export type WorkerRequestBody = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, 'id'>
    : never
  : never;

/** Aviso de cancelación: el worker se salta la petición si sigue en cola. */
export interface CancelMessage { cancel: number }

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; cancelled?: boolean };

export interface CompareEntry { label: string; cssColor: string; result: FlightResult }
export interface RangeRing { minRangeM: number; maxRangeM: number }

/** Vuelos largos: 1 de cada N muestras basta para el presentador (lerp). */
export const DECIMATE_ABOVE_TOF_S = 60;
export const DECIMATE_EVERY = 4;

/**
 * Adelgaza el camino conservando SIEMPRE la primera y la última muestra (el
 * punto de impacto interpolado). El presentador interpola linealmente entre
 * muestras, así que con dt 5-10 ms sobran 3 de cada 4 en vuelos de minutos.
 */
export function decimatePath(fr: FlightResult, every: number): FlightResult {
  if (every <= 1 || fr.path.length < 3) return fr;
  const path = [];
  for (let i = 0; i < fr.path.length - 1; i += every) path.push(fr.path[i]);
  path.push(fr.path[fr.path.length - 1]);
  return { ...fr, path };
}

// ---------------------------------------------------------------------------
//  Despachador: reconstruye el mundo desde datos planos y corre el núcleo.
// ---------------------------------------------------------------------------
export function executeRequest(req: WorkerRequest): unknown {
  const atmo = buildAtmosphere(req.atmo);
  const weapon = WeaponCatalog.get(req.weaponId);
  // P-PRO.4 — munición alternativa seleccionada (base bleed / RAP).
  const altRound = req.roundIndex !== undefined ? weapon.rounds?.[req.roundIndex] : undefined;
  if (altRound) weapon.round = altRound;
  const cfg = SolverConfig.with({ ...req.cfg });
  if (req.terrain) cfg.terrainHeight = buildTerrain(req.terrain);
  const fc = new WeaponSystem(atmo, cfg);
  const muzzle = new Vec3(req.muzzle.x, req.muzzle.y, req.muzzle.z);

  switch (req.op) {
    case 'solveTrajectory': {
      const target = req.targetEnu
        ? new Vec3(req.targetEnu.x, req.targetEnu.y, req.targetEnu.z)
        : undefined;
      const fr = fc.fire(weapon, muzzle, req.order, target);
      const every = fr.timeOfFlight > DECIMATE_ABOVE_TOF_S ? DECIMATE_EVERY : 1;
      return decimatePath(fr, every);
    }

    case 'solveForTarget': {
      const sr: SolveResult = fc.solveForRange(
        weapon, muzzle, req.targetRangeM, req.azimuthDeg, req.chargeIndex, req.preferHighAngle,
        req.v0Correction,
      );
      return sr;
    }

    case 'solveMRSI': {
      const rounds: MrsiRound[] = fc.solveMRSI(
        weapon, muzzle, req.targetRangeM, req.azimuthDeg, req.nRounds, undefined,
        req.v0Correction,
      );
      return rounds;
    }

    case 'compareTrajectories': {
      const calm: AtmoSpec = { ...req.atmo, wind: { kind: 'none' } };
      const run = (spec: AtmoSpec, over: SolverConfigSpec): FlightResult => {
        const cfg2 = SolverConfig.with({ ...req.cfg, ...over });
        if (req.terrain) cfg2.terrainHeight = buildTerrain(req.terrain);
        const fc2 = new WeaponSystem(buildAtmosphere(spec), cfg2);
        return fc2.fire(weapon, muzzle, req.order);
      };
      const out: CompareEntry[] = [
        {
          label: 'Vacío (sin atmósfera)', cssColor: '#9aa4ad',
          result: run(calm, { enableDrag: false, enableCoriolis: false }),
        },
        { label: 'Con arrastre', cssColor: '#4dc3ff', result: run(calm, { enableCoriolis: false }) },
        { label: 'Arrastre + Coriolis', cssColor: '#ffb545', result: run(calm, {}) },
        { label: 'Todo + viento', cssColor: '#ff5d5d', result: run(req.atmo, {}) },
      ];
      return out;
    }

    case 'fireDispersed': {
      // P-NEXT.7 — salva dispersa: los 6 vuelos reales viajan de vuelta
      // (decimados si son largos) para animarse y dejar cráteres.
      const res = fc.fireDispersed(
        weapon, muzzle, req.order, req.nRounds, req.errors, req.seed, true,
      );
      res.flights = res.flights?.map((fr) =>
        decimatePath(fr, fr.timeOfFlight > DECIMATE_ABOVE_TOF_S ? DECIMATE_EVERY : 1),
      );
      return res;
    }

    case 'predictDispersion': {
      // P-PRO.6 — elipse 1σ a priori (7 integraciones, misma serialización
      // que fireDispersed: order + errors).
      const pred: DispersionPrediction = fc.predictDispersion(
        weapon, muzzle, req.order, req.errors,
      );
      return pred;
    }

    case 'generateFiringTable': {
      // P-PRO.5 — tabla de tiro con la meteo actual (el atmo trae el viento:
      // la columna de deriva lo refleja). FiringTable ya es un objeto plano.
      const table: FiringTable = generateFiringTable(weapon, req.chargeIndex, {
        stepM: req.stepM,
        dt: req.cfg.dt,
        latitudeDeg: req.cfg.latitudeDeg,
        atmosphere: atmo,
        v0Scale: v0Factor(req.v0Correction),
      });
      return table;
    }

    case 'approxMaxRange': {
      const v0 = WeaponSystem.muzzleVelocity(weapon, {
        azimuthDeg: 0, elevationDeg: 45, chargeIndex: req.chargeIndex,
        v0Correction: req.v0Correction,
      });
      const step = req.minElStepDeg ?? 5.0;
      let maxR = 0;
      let minR = Number.POSITIVE_INFINITY;
      for (let el = weapon.minElevationDeg; el <= weapon.maxElevationDeg; el += step) {
        const r = fc.rangeForElevation(weapon, muzzle, 0, v0, el);
        maxR = Math.max(maxR, r);
        minR = Math.min(minR, r);
      }
      const ring: RangeRing = { minRangeM: minR, maxRangeM: maxR };
      return ring;
    }
  }
}

// ---------------------------------------------------------------------------
//  Rehidratación: structured clone degrada los Vec3 a {x,y,z} planos; la capa
//  de presentación (cámara, presentador) usa métodos de Vec3, así que se
//  reconstruyen al recibir.
// ---------------------------------------------------------------------------
export function hydrateVec3(v: PlainVec3): Vec3 {
  return new Vec3(v.x, v.y, v.z);
}

export function hydrateFlightResult(raw: FlightResult): FlightResult {
  raw.impactPoint = hydrateVec3(raw.impactPoint);
  for (const s of raw.path) {
    s.position = hydrateVec3(s.position);
    s.velocity = hydrateVec3(s.velocity);
  }
  return raw;
}

export function hydrateCompare(raw: CompareEntry[]): CompareEntry[] {
  for (const e of raw) hydrateFlightResult(e.result);
  return raw;
}

export function hydrateDispersion(raw: DispersionResult): DispersionResult {
  raw.impacts = raw.impacts.map(hydrateVec3);
  raw.meanImpact = hydrateVec3(raw.meanImpact);
  raw.flights?.forEach(hydrateFlightResult);
  return raw;
}
