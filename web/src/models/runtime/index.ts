// ============================================================================
//  runtime/index.ts — Punto de entrada del runtime de modelos.  [V2 — 3D-CORE]
//  Three (rig) → horneado → GLB → Cesium.Model articulado por nodos, con
//  red de seguridad en el overlay Three. Ver docs/v2/REPORT_3D-CORE.md.
// ============================================================================
export { configureModelRuntime, frameProvider, groundSampler, modelRuntime, resetModelRuntime } from './context';
export type { ConfigureOptions, ModelRenderMode, ModelRuntimeContext } from './context';
export { ArticulatedModel } from './ArticulatedModel';
export type { ArticulatedModelOptions, RenderPath } from './ArticulatedModel';
export { bakeModel } from './bake';
export type { BakedModel, BakedNode, BakeInput, BakeStats } from './bake';
export { cachedGlb, clearGlbCache, exportGlb, YUP_WRAPPER } from './glb';
export type { GlbAsset } from './glb';
export { CesiumModelView } from './CesiumModelView';
