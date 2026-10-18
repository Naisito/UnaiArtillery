// Barrel del núcleo balístico (porte TS validado del /core C++).
export { Vec3 } from './Vec3';
export {
  Atmosphere, CALM_WIND, offsetWind, saturationVaporPressurePa, virtualTemperatureK,
} from './Atmosphere';
export type {
  AtmoSample, WindProfilePoint, WindField, WindInto, AtmosphereModel, MetProfilePoint,
} from './Atmosphere';
export { Munition, RocketMotor, GuidanceSpec } from './Munition';
export type { DragPoint, DragModel, SpinAero } from './Munition';
export {
  G1_TABLE, G7_TABLE, TableLookup, lookupOf, sampleDragTable, sectionalDensityLbIn2,
} from './DragTables';
export { BallisticsSolver, SolverConfig, gyroscopicStability } from './BallisticsSolver';
export type {
  FlightResult, TrajectorySample, IntegratorKind, SpinModel,
} from './BallisticsSolver';
export { WGS84, EnuFrame, geodeticToEcef, somiglianaGravity } from './Geodesy';
export { Weapon, WeaponCatalog } from './WeaponCatalog';
export type { WeaponId, CatalogVariant, ChargeZone } from './WeaponCatalog';
export { WeaponSystem, defaultFireOrder, perturbRound, v0Factor, V0_TEMP_COEFF_PER_C } from './WeaponSystem';
export { dispersionModel, probableError } from './Dispersion';
export type { DispersionModel } from './Dispersion';
export type {
  FireOrder, SolveResult, DispersionErrors, DispersionResult, DispersionPrediction, MrsiRound,
  FuzeMode, FuzeSpec, V0Correction,
} from './WeaponSystem';
export { DeterministicRng } from './random';
export {
  BURST_JITTER_SIGMA_MILS, MAX_LIVE_PROJECTILES, fireJitterS, isTracer, perturbedLay, shotTimeS,
} from './burst';
export type { BurstLay } from './burst';
export {
  MAX_RICOCHETS, RICOCHET_MAX_ANGLE_DEG, grazingAngleDeg, normalFromHeights,
  reflectVelocity, ricochetProbability, shouldRicochet,
} from './ricochet';
export { generateFiringTable, firingTableCSV } from './FiringTables';
export type { FiringTable, FiringTableRow, FiringTableOptions } from './FiringTables';
