// ============================================================================
//  PostFX.ts — Postproceso y utilidades de brillo.  [P-WEB.5]
//
//  El tone mapping ACES va en el renderer (ThreeOverlay). Para el "cegador"
//  hay dos vías:
//
//   1. (defecto) GLOW POR SPRITES ADITIVOS: halos radiales generados por
//      canvas, compuestos en aditivo. Sobre un canvas transparente encima de
//      Cesium es la vía robusta: el bloom de framebuffer clásico opera sobre
//      el buffer propio y no puede "sangrar" luz sobre píxeles con alfa 0,
//      así que el halo alrededor de un punto brillante se perdería.
//
//   2. UnrealBloomPass real (?bloom=1 en la URL): bloom global de framebuffer
//      para quien quiera experimentar, con esa limitación conocida sobre
//      fondo transparente.
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

/** Textura difusa suave para partículas de humo/polvo. */
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
