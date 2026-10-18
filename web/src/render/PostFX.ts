// ============================================================================
//  PostFX.ts — Texturas procedurales de los VFX y bloom opcional.  [P-WEB.5]
//
//  El tone mapping ACES va en el renderer (ThreeOverlay). Para el "cegador"
//  hay dos vías:
//
//   1. (defecto) GLOW POR SPRITES/PARTÍCULAS ADITIVAS: halos radiales
//      compuestos en aditivo. Sobre un canvas transparente encima de Cesium
//      es la vía robusta: el bloom de framebuffer clásico opera sobre el
//      buffer propio y no puede "sangrar" luz sobre píxeles con alfa 0, así
//      que el halo alrededor de un punto brillante se perdería.
//
//   2. UnrealBloomPass real (?bloom=1 en la URL): bloom global de framebuffer
//      para quien quiera experimentar, con esa limitación conocida sobre
//      fondo transparente.
//
//  V2 VFX — atlas procedurales (cero assets binarios):
//    * getSmokeAtlas(): 2×2 bocanadas de humo "coliflor" (ruido de valor
//      fractal + caída radial irregular), con canal alfa para el humo y el
//      polvo iluminados.
//    * getGlowAtlas(): 2×2 para el aditivo: halo suave, llama turbulenta,
//      chispa alargada (estelas/trazadoras/metralla) y estrella de fogonazo.
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ThreeOverlay } from './ThreeOverlay';

let glowTexture: THREE.Texture | null = null;

/** Textura radial blanca->transparente compartida por todos los halos. */
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/** Sprite de halo aditivo (no escribe depth: nunca "tapa" el mundo). */
export function makeGlowSprite(color: THREE.ColorRepresentation, scaleM: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(scaleM);
  return sprite;
}

/** Textura difusa suave para partículas de humo/polvo (compatibilidad). */
let puffTexture: THREE.Texture | null = null;
export function getPuffTexture(): THREE.Texture {
  if (puffTexture) return puffTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  puffTexture = new THREE.CanvasTexture(canvas);
  return puffTexture;
}

// ---------------------------------------------------------------------------
//  Ruido de valor 2D periódico (determinista por semilla) para los atlas.
// ---------------------------------------------------------------------------
function makeValueNoise(seed: number, period: number): (x: number, y: number) => number {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (ix: number, iy: number) =>
    grid[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
  return (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, oct: number): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * noise(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/** Celda de bocanada: densidad "coliflor" con borde irregular. */
function drawSmokeCell(img: ImageData, ox: number, oy: number, cell: number, seed: number): void {
  const noise = makeValueNoise(seed, 64);
  const warp = makeValueNoise(seed * 7 + 3, 64);
  const lobes = 3 + (seed % 3);
  const ph = (seed * 1.618) % (Math.PI * 2);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const u = (x + 0.5) / cell * 2 - 1;
      const v = (y + 0.5) / cell * 2 - 1;
      const r = Math.hypot(u, v);
      const th = Math.atan2(v, u);
      // Borde lobulado + ruido: la silueta deja de ser un círculo.
      const edge = 0.78 + 0.08 * Math.sin(lobes * th + ph) + 0.06 * Math.sin((lobes + 2) * th - ph * 2);
      const wx = (warp(u * 3 + 11, v * 3 + 5) - 0.5) * 0.9;
      const n = fbm(noise, (u + wx) * 4 + 20, (v + wx) * 4 + 20, 5);
      const radial = 1 - smooth(edge * 0.35, edge, r + (n - 0.5) * 0.35);
      let a = radial * (0.55 + 0.9 * (n - 0.35));
      a = Math.max(0, Math.min(1, a));
      // Luminancia: grumos algo más claros (la iluminación la pone el shader).
      const lum = 0.78 + 0.22 * n;
      const i = ((oy + y) * img.width + (ox + x)) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * lum);
      img.data[i + 3] = Math.round(255 * a);
    }
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

let smokeAtlas: THREE.Texture | null = null;
/** Atlas 2×2 de bocanadas de humo (alfa = densidad). */
export function getSmokeAtlas(): THREE.Texture {
  if (smokeAtlas) return smokeAtlas;
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * 2;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cell * 2, cell * 2);
  for (let k = 0; k < 4; k++) drawSmokeCell(img, (k % 2) * cell, Math.floor(k / 2) * cell, cell, 17 + k * 101);
  ctx.putImageData(img, 0, 0);
  smokeAtlas = new THREE.CanvasTexture(canvas);
  smokeAtlas.generateMipmaps = true;
  smokeAtlas.minFilter = THREE.LinearMipmapLinearFilter;
  smokeAtlas.magFilter = THREE.LinearFilter;
  return smokeAtlas;
}

let glowAtlas: THREE.Texture | null = null;
/**
 * Atlas 2×2 aditivo: [0] halo suave, [1] llama turbulenta, [2] chispa
 * alargada (eje V), [3] estrella de fogonazo.
 */
export function getGlowAtlas(): THREE.Texture {
  if (glowAtlas) return glowAtlas;
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * 2;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cell * 2, cell * 2);
  const flameNoise = makeValueNoise(4242, 64);
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * cell;
    const oy = Math.floor(k / 2) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell * 2 - 1;
        const v = (y + 0.5) / cell * 2 - 1;
        const r = Math.hypot(u, v);
        let a = 0;
        if (k === 0) {
          // Halo: núcleo duro + falda exponencial (lee como luz, no disco).
          a = Math.exp(-r * r * 9) * 0.9 + Math.exp(-r * 3.2) * 0.35 * (1 - smooth(0.7, 1, r));
        } else if (k === 1) {
          const n = fbm(flameNoise, u * 3 + 7, v * 3 + 3, 5);
          a = (1 - smooth(0.25, 0.95, r + (n - 0.5) * 0.6)) * (0.5 + 0.8 * n);
        } else if (k === 2) {
          // Chispa: gaussiana estrecha en U, larga en V, cabeza brillante.
          const core = Math.exp(-u * u * 60);
          const along = 1 - smooth(0.55, 1, Math.abs(v));
          a = core * along * (0.6 + 0.4 * smooth(-1, 0.6, -v));
        } else {
          // Estrella de fogonazo: núcleo + 6 rayos finos irregulares.
          const th = Math.atan2(v, u);
          const rays = Math.pow(Math.abs(Math.cos(th * 3 + 0.3)), 18) * 0.8 +
            Math.pow(Math.abs(Math.cos(th * 2 - 0.9)), 30) * 0.5;
          a = Math.exp(-r * r * 14) + rays * Math.exp(-r * 2.6) * (1 - smooth(0.6, 1, r));
        }
        a = Math.max(0, Math.min(1, a));
        const i = ((oy + y) * img.width + (ox + x)) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * a);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  glowAtlas = new THREE.CanvasTexture(canvas);
  glowAtlas.generateMipmaps = true;
  glowAtlas.minFilter = THREE.LinearMipmapLinearFilter;
  return glowAtlas;
}

let ringAtlas: THREE.Texture | null = null;
/**
 * Atlas 2×2 de elementos planos sobre el suelo: [0] anillo de choque fino,
 * [1] anillo de agua ancho, [2] charco de luz suave, [3] anillo de polvo
 * irregular.
 */
export function getRingAtlas(): THREE.Texture {
  if (ringAtlas) return ringAtlas;
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * 2;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cell * 2, cell * 2);
  const noise = makeValueNoise(777, 64);
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * cell;
    const oy = Math.floor(k / 2) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell * 2 - 1;
        const v = (y + 0.5) / cell * 2 - 1;
        const r = Math.hypot(u, v);
        let a = 0;
        if (k === 0) a = Math.exp(-((r - 0.9) ** 2) * 900) + Math.exp(-((r - 0.82) ** 2) * 300) * 0.35;
        else if (k === 1) a = Math.exp(-((r - 0.85) ** 2) * 160) * 0.9;
        else if (k === 2) a = Math.exp(-r * r * 3.2) * (1 - smooth(0.8, 1, r));
        else {
          const th = Math.atan2(v, u);
          const n = fbm(noise, Math.cos(th) * 3 + 9, Math.sin(th) * 3 + 9, 4);
          a = Math.exp(-((r - 0.78 - (n - 0.5) * 0.18) ** 2) * 120) * (0.4 + 0.8 * n);
        }
        a = Math.max(0, Math.min(1, a));
        const i = ((oy + y) * img.width + (ox + x)) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * a);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  ringAtlas = new THREE.CanvasTexture(canvas);
  ringAtlas.generateMipmaps = true;
  ringAtlas.minFilter = THREE.LinearMipmapLinearFilter;
  return ringAtlas;
}

/** Activa UnrealBloomPass global si la URL lleva ?bloom=1. */
export function maybeAttachBloom(overlay: ThreeOverlay): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('bloom') !== '1') return;

  const size = new THREE.Vector2();
  overlay.renderer.getSize(size);
  const composer = new EffectComposer(overlay.renderer);
  composer.addPass(new RenderPass(overlay.scene, overlay.camera));
  composer.addPass(new UnrealBloomPass(size, /*strength*/ 0.9, /*radius*/ 0.5, /*threshold*/ 0.85));
  composer.addPass(new OutputPass());
  overlay.composer = composer;
  console.log('[UnaiArtillery] UnrealBloomPass activo (?bloom=1)');
}
