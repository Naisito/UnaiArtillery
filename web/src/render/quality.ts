// ============================================================================
//  quality.ts — Preajustes de calidad gráfica + rendimiento adaptativo.  [V2]
//
//  CONTRATO (lo consume la UI de Ajustes; lo implementa VFX):
//    applyQuality(level) reconfigura Cesium (resolución, MSAA/FXAA, HDR,
//    error de pantalla del terreno, sombras, oclusión ambiental) y el overlay
//    Three (pixel ratio, densidad de partículas) y persiste la elección.
//    getQuality() devuelve el nivel vigente; onQualityChanged notifica.
//
//  AMPLIACIÓN V2-VFX (API nueva, compatible con el contrato):
//    installQuality({ viewer, overlay })  engancha los destinos y aplica el
//                                         nivel vigente (llamar UNA vez al
//                                         arrancar, tras crear el overlay).
//    getQualityProfile()                  parámetros efectivos del nivel.
//    setAdaptive(on) / isAdaptive()       escalado dinámico de resolución.
//    getAdaptiveScale()                   factor dinámico vigente (0.55..1).
//
//  ADAPTATIVO: si el frame-time suavizado (EMA de los intervalos entre
//  postRender) supera el presupuesto ~2.5 s seguidos, baja la escala de
//  resolución un 10 %; si sobra margen ~6 s, la sube. Guarda anti-oscilación:
//  si una subida provoca una bajada en <8 s, se bloquean las subidas 60 s.
//  En renderizado por SOFTWARE (SwiftShader/llvmpipe: CI, capturas headless)
//  arranca DESACTIVADO: nunca llegaría a 60 fps y solo degradaría la imagen.
//
//  URL: ?quality=low|medium|high|ultra fuerza un nivel (sin persistir) y
//  ?adaptive=0|1 fuerza el adaptativo.
// ============================================================================
import * as Cesium from 'cesium';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  ultra: 'Ultra',
};

/** Parámetros efectivos de un nivel (Cesium + overlay + VFX). */
export interface QualityProfile {
  /** Escala de resolución base sobre (CSS px × dpr acotado). */
  resolutionScale: number;
  /** Tope de devicePixelRatio respetado (pantallas HiDPI). */
  maxDpr: number;
  /** MSAA de Cesium (1 = apagado; solo WebGL2). */
  msaaSamples: number;
  fxaa: boolean;
  /** HDR de Cesium + tone mapping PBR neutro. */
  hdr: boolean;
  /** Error máximo de pantalla del terreno (menor = más detalle). */
  terrainSSE: number;
  tileCacheSize: number;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  /** Distancia máxima de las cascadas de sombra (m): menor = más nítidas. */
  shadowDistanceM: number;
  ambientOcclusion: boolean;
  /** Pixel ratio del overlay Three relativo al de Cesium (≤ 1). */
  overlayScale: number;
  /** Multiplicador de partículas emitidas por los VFX. */
  particleDensity: number;
  /** Cada cuántos frames se relee la profundidad para la oclusión Three. */
  occlusionEveryNFrames: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    resolutionScale: 0.8, maxDpr: 1, msaaSamples: 1, fxaa: true, hdr: false,
    terrainSSE: 4, tileCacheSize: 100, shadows: false, shadowMapSize: 1024,
    softShadows: false, shadowDistanceM: 1200, ambientOcclusion: false,
    overlayScale: 0.75, particleDensity: 0.45, occlusionEveryNFrames: 6,
  },
  medium: {
    resolutionScale: 1, maxDpr: 1.25, msaaSamples: 2, fxaa: true, hdr: true,
    terrainSSE: 2.5, tileCacheSize: 200, shadows: false, shadowMapSize: 1024,
    softShadows: false, shadowDistanceM: 1500, ambientOcclusion: false,
    overlayScale: 1, particleDensity: 0.7, occlusionEveryNFrames: 4,
  },
  high: {
    resolutionScale: 1, maxDpr: 2, msaaSamples: 4, fxaa: false, hdr: true,
    terrainSSE: 1.75, tileCacheSize: 320, shadows: true, shadowMapSize: 2048,
    softShadows: true, shadowDistanceM: 1500, ambientOcclusion: false,
    overlayScale: 1, particleDensity: 1, occlusionEveryNFrames: 3,
  },
  ultra: {
    resolutionScale: 1, maxDpr: 3, msaaSamples: 8, fxaa: false, hdr: true,
    terrainSSE: 1.25, tileCacheSize: 500, shadows: true, shadowMapSize: 4096,
    softShadows: true, shadowDistanceM: 2500, ambientOcclusion: true,
    overlayScale: 1, particleDensity: 1.3, occlusionEveryNFrames: 2,
  },
};

/** Lo que el overlay Three expone al sistema de calidad. */
export interface QualityOverlayTarget {
  setPixelRatio(pr: number): void;
}

const KEY = 'unai-artillery/quality/v1';
const ADAPTIVE_KEY = 'unai-artillery/quality-adaptive/v1';

function isLevel(v: unknown): v is QualityLevel {
  return typeof v === 'string' && v in QUALITY_LABELS;
}

function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

let current: QualityLevel = 'high';
let explicitChoice = false; // el usuario (o la URL) eligió: no auto-detectar
const listeners = new Set<(level: QualityLevel) => void>();

try {
  const saved = localStorage.getItem(KEY);
  if (isLevel(saved)) {
    current = saved;
    explicitChoice = true;
  }
} catch {
  // sin almacenamiento
}
{
  const forced = urlParam('quality');
  if (isLevel(forced)) {
    current = forced;
    explicitChoice = true;
  }
}

export function getQuality(): QualityLevel {
  return current;
}

export function getQualityProfile(level: QualityLevel = current): QualityProfile {
  return QUALITY_PROFILES[level];
}

export function applyQuality(level: QualityLevel): void {
  current = level;
  explicitChoice = true;
  try {
    localStorage.setItem(KEY, level);
  } catch {
    // sin almacenamiento
  }
  // Nivel nuevo = presupuesto nuevo: el adaptativo vuelve a empezar arriba.
  adaptive.scale = 1;
  adaptive.upLockUntil = 0;
  applyToTargets();
  for (const fn of listeners) fn(level);
}

export function onQualityChanged(fn: (level: QualityLevel) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
//  Destinos (Cesium + overlay) y aplicación.
// ---------------------------------------------------------------------------
interface Targets {
  viewer: Cesium.Viewer;
  overlay?: QualityOverlayTarget;
  software: boolean;
}
let targets: Targets | null = null;

/** ¿El contexto WebGL es un rasterizador por software? */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(r));
  } catch {
    return false;
  }
}

/** Nivel por defecto según el equipo (solo si el usuario nunca eligió). */
function autoDetect(software: boolean): QualityLevel {
  if (software) return 'medium';
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.screen.width, window.screen.height) < 820;
    if (coarse && small) return 'medium';
  } catch {
    // sin matchMedia
  }
  return 'high';
}

/**
 * Engancha Cesium (+ overlay Three) y aplica el nivel vigente. Llamar una
 * vez en el arranque; applyQuality() reaplica en caliente después.
 */
export function installQuality(t: { viewer: Cesium.Viewer; overlay?: QualityOverlayTarget }): void {
  const gl = (t.viewer.scene as unknown as { context: { _gl: WebGL2RenderingContext } }).context._gl;
  const software = isSoftwareRenderer(gl);
  targets = { viewer: t.viewer, overlay: t.overlay, software };
  if (!explicitChoice) current = autoDetect(software);

  // Adaptativo: URL > preferencia guardada > por defecto (off en software).
  const forced = urlParam('adaptive');
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(ADAPTIVE_KEY);
  } catch {
    // sin almacenamiento
  }
  adaptive.enabled =
    forced === '0' ? false : forced === '1' ? true : saved !== null ? saved === '1' : !software;

  applyToTargets();
  t.viewer.scene.postRender.addEventListener(() => adaptiveTick(performance.now()));
  window.addEventListener('resize', () => applyToTargets());
}

/** Pixel ratio efectivo (dpr acotado × escala del nivel × adaptativo). */
export function effectivePixelRatio(): number {
  const p = QUALITY_PROFILES[current];
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, p.maxDpr) * p.resolutionScale * adaptive.scale;
}

function applyToTargets(): void {
  if (!targets) return;
  const { viewer, overlay } = targets;
  const p = QUALITY_PROFILES[current];
  const scene = viewer.scene;
  const dpr = window.devicePixelRatio || 1;

  // Resolución nítida en HiDPI: Cesium usa dpr × resolutionScale.
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = effectivePixelRatio() / dpr;

  try {
    scene.msaaSamples = p.msaaSamples;
  } catch {
    // WebGL1: sin MSAA de Cesium
  }
  scene.postProcessStages.fxaa.enabled = p.fxaa;
  if (scene.highDynamicRangeSupported) {
    scene.highDynamicRange = p.hdr;
  }

  const globe = scene.globe;
  globe.maximumScreenSpaceError = p.terrainSSE;
  globe.tileCacheSize = p.tileCacheSize;

  // Sombras: el arma (Cesium.Model) las proyecta; el terreno SOLO las recibe
  // (que el relieve se auto-sombree a varios km no compensa su coste).
  viewer.shadows = p.shadows;
  viewer.terrainShadows = p.shadows ? Cesium.ShadowMode.RECEIVE_ONLY : Cesium.ShadowMode.DISABLED;
  if (p.shadows) {
    const sm = scene.shadowMap;
    sm.size = p.shadowMapSize;
    sm.softShadows = p.softShadows;
    sm.darkness = 0.38;
    sm.maximumDistance = p.shadowDistanceM;
    sm.fadingEnabled = true;
    sm.normalOffset = true;
  }

  const ao = scene.postProcessStages.ambientOcclusion;
  ao.enabled = p.ambientOcclusion;
  if (p.ambientOcclusion) {
    // HBAO suave: solo contacto (arma/edificios contra el suelo), sin
    // ensuciar el terreno lejano.
    ao.uniforms.intensity = 2.2;
    ao.uniforms.bias = 0.25;
    ao.uniforms.lengthCap = 0.12;
    ao.uniforms.stepSize = 1.6;
    ao.uniforms.frustumLength = 600.0;
    ao.uniforms.blurStepSize = 0.86;
  }

  overlay?.setPixelRatio(effectivePixelRatio() * p.overlayScale);
  scene.requestRender();
}

// ---------------------------------------------------------------------------
//  Rendimiento adaptativo (escala de resolución dinámica).
// ---------------------------------------------------------------------------
const adaptive = {
  enabled: true,
  scale: 1,
  emaMs: 16.7,
  lastT: 0,
  overS: 0,
  underS: 0,
  lastUpAt: -1e9,
  upLockUntil: 0,
  settleUntil: 0,
};

/** Constantes del gobernador (exportadas para los tests). */
export const ADAPTIVE = {
  budgetMs: 1000 / 48,   // por debajo de ~48 fps sostenidos: bajar
  headroomMs: 1000 / 57, // a ~57+ fps (vsync): hay margen para subir
  downAfterS: 2.5,
  upAfterS: 6,
  step: 0.1,
  minScale: 0.55,
  gapMs: 150,            // intervalos mayores = pausa/idle, no lentitud
} as const;

export function setAdaptive(on: boolean): void {
  adaptive.enabled = on;
  try {
    localStorage.setItem(ADAPTIVE_KEY, on ? '1' : '0');
  } catch {
    // sin almacenamiento
  }
  if (!on && adaptive.scale !== 1) {
    adaptive.scale = 1;
    applyToTargets();
  }
}

export function isAdaptive(): boolean {
  return adaptive.enabled;
}

export function getAdaptiveScale(): number {
  return adaptive.scale;
}

/**
 * Paso del gobernador (puro salvo applyToTargets): exportado para test.
 * Devuelve el nuevo factor si cambió, o null.
 */
export function adaptiveStep(
  state: typeof adaptive,
  frameMs: number,
  nowMs: number,
): number | null {
  if (frameMs > ADAPTIVE.gapMs) return null; // pausa: no cuenta
  const dt = frameMs / 1000;
  state.emaMs += (frameMs - state.emaMs) * 0.08;
  if (nowMs < state.settleUntil) return null; // dejando asentar el cambio
  if (state.emaMs > ADAPTIVE.budgetMs) {
    state.overS += dt;
    state.underS = 0;
    if (state.overS >= ADAPTIVE.downAfterS && state.scale > ADAPTIVE.minScale + 1e-6) {
      state.overS = 0;
      // Bajada justo tras una subida: oscilación — bloquea subidas un rato.
      if (nowMs - state.lastUpAt < 8000) state.upLockUntil = nowMs + 60000;
      state.scale = Math.max(ADAPTIVE.minScale, +(state.scale - ADAPTIVE.step).toFixed(3));
      state.settleUntil = nowMs + 1500;
      return state.scale;
    }
  } else if (state.emaMs < ADAPTIVE.headroomMs) {
    state.underS += dt;
    state.overS = 0;
    if (state.underS >= ADAPTIVE.upAfterS && state.scale < 1 - 1e-6 && nowMs >= state.upLockUntil) {
      state.underS = 0;
      state.lastUpAt = nowMs;
      state.scale = Math.min(1, +(state.scale + ADAPTIVE.step).toFixed(3));
      state.settleUntil = nowMs + 1500;
      return state.scale;
    }
  } else {
    state.overS = Math.max(0, state.overS - dt);
    state.underS = 0;
  }
  return null;
}

/** Estado nuevo del gobernador (para tests). */
export function newAdaptiveState(): typeof adaptive {
  return { ...adaptive, enabled: true, scale: 1, emaMs: 16.7, lastT: 0, overS: 0, underS: 0, lastUpAt: -1e9, upLockUntil: 0, settleUntil: 0 };
}

function adaptiveTick(nowMs: number): void {
  const frameMs = adaptive.lastT > 0 ? nowMs - adaptive.lastT : 0;
  adaptive.lastT = nowMs;
  if (!adaptive.enabled || frameMs <= 0) return;
  if (adaptiveStep(adaptive, frameMs, nowMs) !== null) applyToTargets();
}
