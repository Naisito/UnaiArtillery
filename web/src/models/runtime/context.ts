// ============================================================================
//  context.ts — Configuración global del runtime de modelos.  [V2 — 3D-CORE]
//
//  main.ts llama UNA vez a configureModelRuntime({ viewer, frame }) tras
//  crear el visor: desde ese momento GunModel y MovingTargetActor pintan sus
//  modelos DENTRO de Cesium (Cesium.Model) sin cambiar sus constructores.
//  Sin configurar (tests, Model Lab) o con `?models=three` en la URL, todo
//  cae al overlay Three de siempre.
// ============================================================================
import type * as Cesium from 'cesium';
import type { GeoFrame } from '../../frame';

export type ModelRenderMode = 'auto' | 'three' | 'cesium';

export interface ModelRuntimeContext {
  viewer: Cesium.Viewer;
  /** Marco ENU vigente de la batería (cambia al re-anclar o al cambiar el suelo). */
  frame: () => GeoFrame;
  /** Sombras de los modelos (ShadowMode.ENABLED). */
  shadows: boolean;
  /** Fallos de carga en Cesium: tras 3 seguidos todo va por Three. */
  failures: number;
  /**
   * z ENU del suelo VISUAL en (x, y) (null si no hay fuente mejor): el arma
   * se asienta en la pendiente real y el camión cabecea con el relieve.
   */
  groundZ?: (x: number, y: number) => Promise<number | null>;
}

let ctx: ModelRuntimeContext | null = null;
let frameFn: (() => GeoFrame) | null = null;
let groundFn: ((x: number, y: number) => Promise<number | null>) | null = null;

/** Marco ENU configurado (también con `?models=three`). */
export function frameProvider(): (() => GeoFrame) | null {
  return frameFn;
}

function urlMode(): ModelRenderMode {
  try {
    const m = new URLSearchParams(window.location.search).get('models');
    return m === 'three' || m === 'cesium' ? m : 'auto';
  } catch {
    return 'auto';
  }
}

export interface ConfigureOptions {
  viewer: Cesium.Viewer;
  frame: () => GeoFrame;
  /** Sombras de los modelos (defecto true). */
  shadows?: boolean;
  /** Muestreo del suelo visual (ver ModelRuntimeContext.groundZ). */
  groundZ?: (x: number, y: number) => Promise<number | null>;
  /**
   * Enciende viewer.shadows si estaba apagado (defecto false: los preajustes
   * de calidad del agente VFX son los dueños de las sombras de la escena).
   */
  enableSceneShadows?: boolean;
}

/** Activa el camino Cesium para los modelos (salvo `?models=three`). */
export function configureModelRuntime(opts: ConfigureOptions): void {
  groundFn = opts.groundZ ?? null;
  frameFn = opts.frame;
  if (urlMode() === 'three') {
    ctx = null;
    console.info('[models] ?models=three — modelos en el overlay Three');
    return;
  }
  ctx = {
    viewer: opts.viewer, frame: opts.frame, shadows: opts.shadows ?? true, failures: 0, groundZ: opts.groundZ,
  };
  if (opts.enableSceneShadows && !opts.viewer.shadows) {
    opts.viewer.shadows = true;
    const sm = opts.viewer.shadowMap;
    sm.softShadows = true;
    sm.darkness = 0.35;
    sm.maximumDistance = 2500;
  }
}

/** Muestreo de suelo configurado (también con `?models=three`). */
export function groundSampler(): ((x: number, y: number) => Promise<number | null>) | null {
  return groundFn;
}

/** Contexto vigente (null → camino Three). */
export function modelRuntime(): ModelRuntimeContext | null {
  if (ctx && ctx.failures >= 3) return null;
  return ctx;
}

/** Olvida la configuración (tests). */
export function resetModelRuntime(): void {
  ctx = null;
  groundFn = null;
  frameFn = null;
}
