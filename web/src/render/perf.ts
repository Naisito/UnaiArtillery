// ============================================================================
//  perf.ts — Estadísticas de rendimiento y overlay ?stats=1.  [V2 VFX]
//
//  getPerfStats() — API mínima para la UI (Ajustes) y la depuración:
//    fps y frame-time suavizados (intervalos entre postRender de Cesium),
//    p95 de la última ventana, draw calls REALES de cada contexto WebGL
//    (Cesium y overlay Three: se envuelven drawElements/drawArrays con un
//    contador, coste despreciable), triángulos y partículas vivas.
//
//  installPerfOverlay() pinta ese resumen en #statsOverlay cuatro veces por
//  segundo cuando la URL lleva ?stats=1 (sustituye al overlay de P-PRO.8).
// ============================================================================
import type * as Cesium from 'cesium';
import { getAdaptiveScale, getQuality, isAdaptive } from './quality';

export interface PerfStats {
  fps: number;
  frameMs: number;
  p95Ms: number;
  cesiumDrawCalls: number;
  threeDrawCalls: number;
  threeTriangles: number;
  particles: number;
  effects: number;
  quality: string;
  adaptive: boolean;
  resolutionScale: number;
  /** Frames en los que el overlay Three se saltó (nada visible). */
  overlaySkipped: number;
}

interface CountedGl {
  __uaDraws?: number;
  __uaWrapped?: boolean;
}

/** Envuelve las llamadas de dibujo de un contexto para contarlas. */
function wrapGl(gl: (WebGLRenderingContext | WebGL2RenderingContext) & CountedGl): void {
  if (gl.__uaWrapped) return;
  gl.__uaWrapped = true;
  gl.__uaDraws = 0;
  const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = g[fn];
    if (typeof orig !== 'function') continue;
    g[fn] = function (this: unknown, ...a: unknown[]) {
      gl.__uaDraws!++;
      return orig.apply(this, a);
    };
  }
}

/** Fuentes que el resto de la app conecta (overlay, VFX). */
export interface PerfSources {
  viewer: Cesium.Viewer;
  threeGl?: WebGLRenderingContext | WebGL2RenderingContext;
  threeInfo?: () => { calls: number; triangles: number };
  particles?: () => number;
  effects?: () => number;
  overlaySkipped?: () => number;
}

const WINDOW = 90;
const samples = new Float32Array(WINDOW);
const sorted = new Float32Array(WINDOW);
let sampleN = 0;
let sampleHead = 0;
let lastFrameT = 0;
let emaMs = 16.7;
let cesiumDrawsLastFrame = 0;
let threeDrawsLastFrame = 0;
let sources: PerfSources | null = null;

/** Engancha el medidor (una vez, tras crear viewer y overlay). */
export function installPerf(src: PerfSources): void {
  sources = src;
  const cgl = (src.viewer.scene as unknown as { context: { _gl: WebGL2RenderingContext & CountedGl } }).context._gl;
  wrapGl(cgl);
  const tgl = src.threeGl as (WebGL2RenderingContext & CountedGl) | undefined;
  if (tgl) wrapGl(tgl);
  src.viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (lastFrameT > 0) {
      const ms = now - lastFrameT;
      if (ms < 1000) {
        samples[sampleHead] = ms;
        sampleHead = (sampleHead + 1) % WINDOW;
        sampleN = Math.min(WINDOW, sampleN + 1);
        emaMs += (ms - emaMs) * 0.1;
      }
    }
    lastFrameT = now;
    // Los draws del overlay se cuentan en el postRender ANTERIOR (Three
    // pinta dentro de postRender): leer y poner a cero aquí da el último
    // frame completo de ambos contextos.
    cesiumDrawsLastFrame = cgl.__uaDraws ?? 0;
    cgl.__uaDraws = 0;
    if (tgl) {
      threeDrawsLastFrame = tgl.__uaDraws ?? 0;
      tgl.__uaDraws = 0;
    }
  });
}

export function getPerfStats(): PerfStats {
  let p95 = emaMs;
  if (sampleN > 4) {
    sorted.set(samples.subarray(0, sampleN));
    const view = sorted.subarray(0, sampleN);
    view.sort();
    p95 = view[Math.min(sampleN - 1, Math.floor(sampleN * 0.95))];
  }
  const info = sources?.threeInfo?.() ?? { calls: 0, triangles: 0 };
  return {
    fps: emaMs > 0 ? 1000 / emaMs : 0,
    frameMs: emaMs,
    p95Ms: p95,
    cesiumDrawCalls: cesiumDrawsLastFrame,
    threeDrawCalls: sources?.threeGl ? threeDrawsLastFrame : info.calls,
    threeTriangles: info.triangles,
    particles: sources?.particles?.() ?? 0,
    effects: sources?.effects?.() ?? 0,
    quality: getQuality(),
    adaptive: isAdaptive(),
    resolutionScale: sources ? sources.viewer.resolutionScale : 1,
    overlaySkipped: sources?.overlaySkipped?.() ?? 0,
  };
}

/** Overlay de depuración (?stats=1): texto plano, 4 Hz, sin dependencias. */
export function installPerfOverlay(extra?: () => string): void {
  if (new URLSearchParams(window.location.search).get('stats') !== '1') return;
  let el = document.getElementById('statsOverlay') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'statsOverlay';
    document.body.appendChild(el);
  }
  const target = el;
  window.setInterval(() => {
    const s = getPerfStats();
    target.textContent =
      `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms (p95 ${s.p95Ms.toFixed(1)}) · ` +
      `cesium ${s.cesiumDrawCalls} draws · three ${s.threeDrawCalls} draws / ${s.threeTriangles} tris · ` +
      `partículas ${s.particles} · efectos ${s.effects} · ` +
      `calidad ${s.quality}${s.adaptive ? ` (adapt ×${getAdaptiveScale().toFixed(2)})` : ''} · ` +
      `res ${s.resolutionScale.toFixed(2)}` +
      (extra ? ` · ${extra()}` : '');
  }, 250);
}
