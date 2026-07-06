// ============================================================================
//  CraterLayer.ts — Cráteres persistentes y zona batida.  [P-NEXT.7 / P-PRO.8]
//
//  Cada impacto deja una marca que sobrevive minutos: un disco de quemadura
//  (textura radial procedural oscura con borde irregular por ruido) más un
//  anillo de tierra levantada, ambos escalados por yield^(1/3) — mortero
//  ~4.5 m, M777 ~6 m, GMLRS ~11 m de radio. Tras una salva dispersa, los
//  cráteres DIBUJAN la elipse de dispersión sobre el terreno: la zona batida.
//
//  P-PRO.8 — RENDIMIENTO: los 200 cráteres viven en DOS InstancedMesh
//  (disco + anillo) => 2 draw calls totales en vez de ~400 (visible en
//  ?stats=1). Posición/rotación/escala por instancia vía setMatrixAt; el
//  FIFO es un índice circular que SOBRESCRIBE la instancia más vieja (cero
//  allocaciones por impacto) y "Limpiar" es count = 0.
//
//  DECISIÓN (variantes de textura): las 4 texturas variantes originales
//  exigirían un atlas 2×2 con offset UV por instancia — un attribute
//  instanciado + parche de shader en MeshBasicMaterial. No compensa: se usa
//  UNA textura de quemadura y se compensa con rotación aleatoria, escala y
//  un TINTE por instancia (instanceColor, que MeshBasicMaterial ya soporta
//  sin tocar shaders). A distancia de juego el resultado es indistinguible.
//
//  LIMITACIÓN CONSCIENTE: sobre teselas de Cesium no se puede deformar la
//  malla del terreno, así que el cráter es un DECAL visual plano en el plano
//  ENU del impacto (depthWrite:false, ligeramente sobre el suelo para no
//  pelear en z). En ladera pronunciada el disco puede asomar por un lado.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from '../ballistics/Vec3';

/** Textura de quemadura: gradiente radial oscuro con borde roto por ruido. */
function makeBurnTexture(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const cx = S / 2;

  // Borde irregular: polígono con radio modulado por ruido armónico.
  const N = 64;
  const p1 = Math.random() * Math.PI * 2;
  const p2 = Math.random() * Math.PI * 2;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const noise =
      0.78 +
      0.12 * Math.sin(3 * th + p1) +
      0.07 * Math.sin(7 * th + p2) +
      0.05 * Math.sin(13 * th + p1 * 2);
    const r = S * 0.48 * noise;
    const x = cx + r * Math.cos(th);
    const y = cx + r * Math.sin(th);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, S * 0.48);
  grad.addColorStop(0.0, 'rgba(10, 8, 6, 0.95)');
  grad.addColorStop(0.45, 'rgba(22, 17, 12, 0.88)');
  grad.addColorStop(0.75, 'rgba(38, 30, 22, 0.55)');
  grad.addColorStop(1.0, 'rgba(46, 36, 26, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Rayos de chamuscado hacia fuera (rompen la simetría radial).
  ctx.strokeStyle = 'rgba(14, 11, 8, 0.5)';
  for (let k = 0; k < 14; k++) {
    const th = Math.random() * Math.PI * 2;
    const r0 = S * (0.18 + Math.random() * 0.12);
    const r1 = S * (0.34 + Math.random() * 0.14);
    ctx.lineWidth = 2 + Math.random() * 5;
    ctx.beginPath();
    ctx.moveTo(cx + r0 * Math.cos(th), cx + r0 * Math.sin(th));
    ctx.lineTo(cx + r1 * Math.cos(th), cx + r1 * Math.sin(th));
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

export class CraterLayer {
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
      opacity: 0.5,
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
    parent.add(this.burn, this.ring);
  }

  get count(): number { return this.live; }

  /** Deja un cráter en el punto de impacto, escalado por el yield (kg TNTeq). */
  add(impactEnu: Vec3, warheadTNTeq: number): void {
    // Misma convención que el resto de VFX: escala por (yield/6.6)^(1/3),
    // con radio 6 m para el M777 -> mortero ~4.5 m, GMLRS ~11 m.
    const radius = 6.0 * Math.cbrt(Math.max(0.05, warheadTNTeq) / 6.6);
    const i = this.head;
    this.head = (this.head + 1) % this.maxCraters;
    this.live = Math.min(this.live + 1, this.maxCraters);

    // Disco de quemadura: rotación y escala aleatorias + tinte por instancia
    // (sustituyen a las 4 texturas variantes, ver header).
    this.quat.setFromAxisAngle(CraterLayer.Z_AXIS, Math.random() * Math.PI * 2);
    const stretch = 0.92 + Math.random() * 0.16; // ligera elipse aleatoria
    this.pos.set(impactEnu.x, impactEnu.y, impactEnu.z + 0.18);
    this.scl.set(radius * stretch, radius / stretch, 1);
    this.m4.compose(this.pos, this.quat, this.scl);
    this.burn.setMatrixAt(i, this.m4);
    const shade = 0.85 + Math.random() * 0.3; // quemadura más/menos profunda
    this.burn.setColorAt(i, this.tint.setScalar(shade));

    // Anillo de tierra levantada alrededor del labio.
    this.pos.set(impactEnu.x, impactEnu.y, impactEnu.z + 0.24);
    this.scl.set(radius, radius, 1);
    this.m4.compose(this.pos, this.quat, this.scl);
    this.ring.setMatrixAt(i, this.m4);
    const earth = 0.85 + Math.random() * 0.3; // tono de tierra variable
    this.ring.setColorAt(i, this.tint.setScalar(earth));

    this.burn.count = this.live;
    this.ring.count = this.live;
    this.burn.instanceMatrix.needsUpdate = true;
    this.ring.instanceMatrix.needsUpdate = true;
    if (this.burn.instanceColor) this.burn.instanceColor.needsUpdate = true;
    if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
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
    this.parent.remove(this.burn, this.ring);
    this.burn.dispose(); // libera los buffers de instancias
    this.ring.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
