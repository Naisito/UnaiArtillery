// ============================================================================
//  CraterLayer.ts — Cráteres persistentes y zona batida.  [P-NEXT.7 / P-PRO.8]
//
//  Cada impacto deja una marca que sobrevive minutos: un decal de cráter
//  (textura procedural: hoyo oscuro, labio de tierra fresca, rayos de
//  eyección y halo de hollín) más un anillo de tierra levantada, ambos
//  escalados por yield^(1/3) — mortero ~4.5 m, M777 ~6 m, GMLRS ~11 m de
//  radio. Tras una salva dispersa, los cráteres DIBUJAN la elipse de
//  dispersión sobre el terreno: la zona batida.
//
//  P-PRO.8 — RENDIMIENTO: los 200 cráteres viven en DOS InstancedMesh
//  (disco + anillo) => 2 draw calls totales en vez de ~400 (visible en
//  ?stats=1). Posición/rotación/escala por instancia vía setMatrixAt; el
//  FIFO es un índice circular que SOBRESCRIBE la instancia más vieja (cero
//  allocaciones por impacto) y "Limpiar" es count = 0.
//
//  V2 VFX:
//   * Textura nueva (512 px): pozo con gradiente de profundidad, labio de
//     tierra clara irregular, 26 rayos de eyección, terrones y halo de hollín.
//     Espoleta de retardo (`buried`) = cráter más profundo y ancho.
//   * Oclusión: el overlay entrega la profundidad de Cesium y cada cráter
//     detrás de una cresta se oculta (escala 0) — antes se veían a través de
//     las montañas. Solo se resube la matriz si cambia la visibilidad.
//
//  DECISIÓN (variantes de textura): UNA textura + rotación aleatoria,
//  estirado y TINTE por instancia (instanceColor) en vez de un atlas: a
//  distancia de juego es indistinguible y no exige parchear shaders.
//
//  LIMITACIÓN CONSCIENTE: sobre teselas de Cesium no se puede deformar la
//  malla del terreno, así que el cráter es un DECAL visual plano en el plano
//  ENU del impacto (depthWrite:false, ligeramente sobre el suelo para no
//  pelear en z). En ladera pronunciada el disco puede asomar por un lado.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from '../ballistics/Vec3';
import { getActiveOverlay, type RenderHook } from '../render/ThreeOverlay';
import type { RenderCtx } from './particles';

/** Textura del cráter: pozo, labio, rayos de eyección, terrones y hollín. */
function makeBurnTexture(): THREE.CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const c = S / 2;
  const R = S * 0.48;

  // 1) Halo de hollín: mancha irregular muy suave hasta el borde.
  const soot = ctx.createRadialGradient(c, c, R * 0.2, c, c, R);
  soot.addColorStop(0, 'rgba(22, 19, 16, 0.75)');
  soot.addColorStop(0.55, 'rgba(30, 26, 21, 0.42)');
  soot.addColorStop(0.85, 'rgba(38, 33, 27, 0.12)');
  soot.addColorStop(1, 'rgba(40, 35, 28, 0)');
  ctx.fillStyle = soot;
  ctx.beginPath();
  const N = 72;
  const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const k = 0.86 + 0.08 * Math.sin(3 * th + p1) + 0.06 * Math.sin(7 * th + p2);
    const x = c + R * k * Math.cos(th), y = c + R * k * Math.sin(th);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.fill();

  // 2) Rayos de eyección: lenguas de tierra que salen del labio.
  for (let k = 0; k < 26; k++) {
    const th = Math.random() * Math.PI * 2;
    const r0 = R * (0.3 + Math.random() * 0.08);
    const r1 = R * (0.55 + Math.random() * 0.4);
    const w = 3 + Math.random() * 9;
    const g = ctx.createLinearGradient(
      c + r0 * Math.cos(th), c + r0 * Math.sin(th), c + r1 * Math.cos(th), c + r1 * Math.sin(th),
    );
    const tone = 70 + Math.floor(Math.random() * 40);
    g.addColorStop(0, `rgba(${tone + 20}, ${tone + 8}, ${tone - 10}, 0.7)`);
    g.addColorStop(1, `rgba(${tone}, ${tone - 6}, ${tone - 20}, 0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c + r0 * Math.cos(th), c + r0 * Math.sin(th));
    const bend = (Math.random() - 0.5) * 0.25;
    ctx.quadraticCurveTo(
      c + (r0 + r1) * 0.5 * Math.cos(th + bend), c + (r0 + r1) * 0.5 * Math.sin(th + bend),
      c + r1 * Math.cos(th + bend * 1.5), c + r1 * Math.sin(th + bend * 1.5),
    );
    ctx.stroke();
  }

  // 3) Labio de tierra fresca (más clara) con borde roto.
  ctx.lineWidth = R * 0.11;
  for (let pass = 0; pass < 3; pass++) {
    ctx.strokeStyle = `rgba(${118 - pass * 12}, ${100 - pass * 10}, ${78 - pass * 8}, ${0.55 - pass * 0.12})`;
    ctx.beginPath();
    const ph = Math.random() * 6.28;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const rr = R * (0.36 + 0.025 * Math.sin(5 * th + ph) + 0.015 * Math.sin(11 * th - ph) + pass * 0.02);
      const x = c + rr * Math.cos(th), y = c + rr * Math.sin(th);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 4) Pozo: oscuro en el centro, con un lado más iluminado (profundidad).
  const pit = ctx.createRadialGradient(c - R * 0.05, c - R * 0.06, 0, c, c, R * 0.36);
  pit.addColorStop(0, 'rgba(14, 11, 9, 0.97)');
  pit.addColorStop(0.55, 'rgba(26, 20, 15, 0.94)');
  pit.addColorStop(0.85, 'rgba(48, 38, 28, 0.85)');
  pit.addColorStop(1, 'rgba(70, 58, 44, 0.0)');
  ctx.fillStyle = pit;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.36, 0, Math.PI * 2);
  ctx.fill();

  // 5) Terrones sueltos alrededor.
  for (let k = 0; k < 160; k++) {
    const th = Math.random() * Math.PI * 2;
    const rr = R * (0.32 + Math.pow(Math.random(), 0.7) * 0.6);
    const sz = 1 + Math.random() * 4 * (1 - rr / R);
    const tone = 50 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${tone + 12}, ${tone + 4}, ${tone - 8}, ${0.5 + Math.random() * 0.4})`;
    ctx.fillRect(c + rr * Math.cos(th), c + rr * Math.sin(th), sz, sz);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CraterLayer implements RenderHook {
  private readonly burn: THREE.InstancedMesh;
  private readonly ring: THREE.InstancedMesh;
  private readonly disposables: { dispose(): void }[] = [];

  /** Índice circular: al llenarse, la instancia más vieja se sobrescribe. */
  private head = 0;
  private live = 0;

  // Reutilizados en cada add(): cero allocaciones por impacto.
  private readonly m4 = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);
  private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // V2 — oclusión: centro/radio por instancia + matrices base para restaurar.
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;
  private readonly cz: Float32Array;
  private readonly cr: Float32Array;
  private readonly shown: Uint8Array;
  private readonly baseBurn: Float32Array;
  private readonly baseRing: Float32Array;

  constructor(
    private readonly parent: THREE.Object3D,
    /** Capacidad de los InstancedMesh: al superarla se recicla la más vieja. */
    readonly maxCraters = 200,
  ) {
    const tex = makeBurnTexture();
    const burnGeo = new THREE.CircleGeometry(1, 40); // radio 1: escala por instancia
    const burnMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false, // decal: no ensucia el z-buffer del overlay
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.82, 1.14, 40, 1);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x5d4b37,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(tex, burnGeo, burnMat, ringGeo, ringMat);

    this.burn = new THREE.InstancedMesh(burnGeo, burnMat, maxCraters);
    this.ring = new THREE.InstancedMesh(ringGeo, ringMat, maxCraters);
    for (const mesh of [this.burn, this.ring]) {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Las instancias se reparten por kilómetros: el culling por la esfera
      // de la geometría base (radio 1 en el origen) las cortaría mal.
      mesh.frustumCulled = false;
    }
    this.cx = new Float32Array(maxCraters);
    this.cy = new Float32Array(maxCraters);
    this.cz = new Float32Array(maxCraters);
    this.cr = new Float32Array(maxCraters);
    this.shown = new Uint8Array(maxCraters).fill(1);
    this.baseBurn = new Float32Array(maxCraters * 16);
    this.baseRing = new Float32Array(maxCraters * 16);
    parent.add(this.burn, this.ring);
    getActiveOverlay()?.addRenderHook(this);
  }

  get count(): number { return this.live; }

  /**
   * Deja un cráter en el punto de impacto, escalado por el yield (kg TNTeq).
   * V2: `buried` (espoleta de retardo) = cráter ~35 % más ancho.
   */
  add(impactEnu: Vec3, warheadTNTeq: number, buried = false): void {
    // Misma convención que el resto de VFX: escala por (yield/6.6)^(1/3),
    // con radio 6 m para el M777 -> mortero ~4.5 m, GMLRS ~11 m.
    const radius = 6.0 * Math.cbrt(Math.max(0.05, warheadTNTeq) / 6.6) * (buried ? 1.35 : 1);
    const i = this.head;
    this.head = (this.head + 1) % this.maxCraters;
    this.live = Math.min(this.live + 1, this.maxCraters);

    // Disco: rotación y escala aleatorias + tinte por instancia.
    this.quat.setFromAxisAngle(CraterLayer.Z_AXIS, Math.random() * Math.PI * 2);
    const stretch = 0.92 + Math.random() * 0.16; // ligera elipse aleatoria
    this.pos.set(impactEnu.x, impactEnu.y, impactEnu.z + 0.18);
    this.scl.set(radius * stretch, radius / stretch, 1);
    this.m4.compose(this.pos, this.quat, this.scl);
    this.m4.toArray(this.baseBurn, i * 16);
    this.burn.setMatrixAt(i, this.m4);
    const shade = 0.85 + Math.random() * 0.3; // quemadura más/menos profunda
    this.burn.setColorAt(i, this.tint.setScalar(shade));

    // Anillo de tierra levantada alrededor del labio.
    this.pos.set(impactEnu.x, impactEnu.y, impactEnu.z + 0.24);
    this.scl.set(radius * 0.4, radius * 0.4, 1);
    this.m4.compose(this.pos, this.quat, this.scl);
    this.m4.toArray(this.baseRing, i * 16);
    this.ring.setMatrixAt(i, this.m4);
    const earth = 0.85 + Math.random() * 0.3; // tono de tierra variable
    this.ring.setColorAt(i, this.tint.setScalar(earth));

    this.cx[i] = impactEnu.x;
    this.cy[i] = impactEnu.y;
    this.cz[i] = impactEnu.z;
    this.cr[i] = radius;
    this.shown[i] = 1;

    this.burn.count = this.live;
    this.ring.count = this.live;
    this.burn.instanceMatrix.needsUpdate = true;
    this.ring.instanceMatrix.needsUpdate = true;
    if (this.burn.instanceColor) this.burn.instanceColor.needsUpdate = true;
    if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
  }

  /** V2 — oclusión tras el relieve: oculta los cráteres tapados. */
  prepare(ctx: RenderCtx): boolean {
    if (this.live === 0) return false;
    const occ = ctx.occlusion;
    if (!ctx.occlusionFresh || !occ) return true;
    let changed = false;
    for (let i = 0; i < this.live; i++) {
      const v = occ.test(this.cx[i], this.cy[i], this.cz[i] + 0.5, this.cr[i] * 0.8);
      if (v < 0) continue;
      const want = v === 1 ? 1 : 0;
      if (want === this.shown[i]) continue;
      this.shown[i] = want;
      changed = true;
      if (want) {
        this.m4.fromArray(this.baseBurn, i * 16);
        this.burn.setMatrixAt(i, this.m4);
        this.m4.fromArray(this.baseRing, i * 16);
        this.ring.setMatrixAt(i, this.m4);
      } else {
        this.burn.setMatrixAt(i, CraterLayer.ZERO);
        this.ring.setMatrixAt(i, CraterLayer.ZERO);
      }
    }
    if (changed) {
      this.burn.instanceMatrix.needsUpdate = true;
      this.ring.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  /** Botón "Limpiar cráteres": count = 0 (las instancias quedan para reciclar). */
  clear(): void {
    this.live = 0;
    this.head = 0;
    this.burn.count = 0;
    this.ring.count = 0;
  }

  dispose(): void {
    this.clear();
    getActiveOverlay()?.removeRenderHook(this);
    this.parent.remove(this.burn, this.ring);
    this.burn.dispose(); // libera los buffers de instancias
    this.ring.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
