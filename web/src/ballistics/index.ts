// Barrel del núcleo balístico (porte TS validado del /core C++).
export { Vec3 } from './Vec3';
export { Atmosphere } from './Atmosphere';
export type { AtmoSample, WindProfilePoint, WindField, AtmosphereModel } from './Atmosphere';
export { Munition, RocketMotor, GuidanceSpec } from './Munition';
export type { DragPoint, DragModel } from './Munition';
export { G1_TABLE, G7_TABLE, sampleDragTable, sectionalDensityLbIn2 } from './DragTables';
export { BallisticsSolver, SolverConfig } from './BallisticsSolver';
export type { FlightResult, TrajectorySample } from './BallisticsSolver';
export { WGS84, EnuFrame, geodeticToEcef, somiglianaGravity } from './Geodesy';
export { Weapon, WeaponCatalog } from './WeaponCatalog';
export type { WeaponId, CatalogVariant, ChargeZone } from './WeaponCatalog';
export { WeaponSystem, defaultFireOrder, v0Factor, V0_TEMP_COEFF_PER_C } from './WeaponSystem';
export type {
  FireOrder, SolveResult, DispersionErrors, DispersionResult, DispersionPrediction, MrsiRound,
  FuzeMode, FuzeSpec, V0Correction,
} from './WeaponSystem';
export { DeterministicRng } from './random';
export { generateFiringTable, firingTableCSV } from './FiringTables';
export type { FiringTable, FiringTableRow, FiringTableOptions } from './FiringTables';
