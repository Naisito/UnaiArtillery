// ============================================================================
//  CraterLayer.ts — Cráteres persistentes y zona batida.  [P-NEXT.7]
//
//  Cada impacto deja una marca que sobrevive minutos: un disco de quemadura
//  (textura radial procedural oscura con borde irregular por ruido) más un
//  anillo de tierra levantada, ambos escalados por yield^(1/3) — mortero
//  ~4.5 m, M777 ~6 m, GMLRS ~11 m de radio. Tras una salva dispersa, los
//  cráteres DIBUJAN la elipse de dispersión sobre el terreno: la zona batida.
//
//  LIMITACIÓN CONSCIENTE: sobre teselas de Cesium no se puede deformar la
//  malla del terreno, así que el cráter es un DECAL visual plano en el plano
//  ENU del impacto (depthWrite:false, ligeramente sobre el suelo para no
//  pelear en z). En ladera pronunciada el disco puede asomar por un lado.
//
//  Gestión: FIFO con máximo ~200 cráteres vivos; "Limpiar cráteres" los borra.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from '../ballistics/Vec3';

interface Crater {
  group: THREE.Group;
  disposables: { dispose(): void }[];
}

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
  private craters: Crater[] = [];
  private textures: THREE.CanvasTexture[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    /** Máximo de cráteres vivos: al superarlo, el más antiguo se recicla (FIFO). */
    readonly maxCraters = 200,
  ) {
    // Unas pocas variantes de textura bastan; cada cráter rota la suya.
    for (let i = 0; i < 4; i++) this.textures.push(makeBurnTexture());
  }

  get count(): number { return this.craters.length; }

  /** Deja un cráter en el punto de impacto, escalado por el yield (kg TNTeq). */
  add(impactEnu: Vec3, warheadTNTeq: number): void {
    // Misma convención que el resto de VFX: escala por (yield/6.6)^(1/3),
    // con radio 6 m para el M777 -> mortero ~4.5 m, GMLRS ~11 m.
    const radius = 6.0 * Math.cbrt(Math.max(0.05, warheadTNTeq) / 6.6);
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];

    // Disco de quemadura.
    const tex = this.textures[(Math.random() * this.textures.length) | 0];
    const burnGeo = new THREE.CircleGeometry(radius, 40);
    const burnMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false, // decal: no ensucia el z-buffer del overlay
      side: THREE.DoubleSide,
    });
    const burn = new THREE.Mesh(burnGeo, burnMat);
    burn.rotation.z = Math.random() * Math.PI * 2;
    burn.position.z = 0.18; // ligeramente sobre el terreno (no z-fight)
    group.add(burn);
    disposables.push(burnGeo, burnMat);

    // Anillo de tierra levantada alrededor del labio del cráter.
    const ringGeo = new THREE.RingGeometry(radius * 0.82, radius * 1.14, 40, 1);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x5d4b37,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = 0.24;
    group.add(ring);
    disposables.push(ringGeo, ringMat);

    group.position.set(impactEnu.x, impactEnu.y, impactEnu.z);
    this.parent.add(group);
    this.craters.push({ group, disposables });

    // FIFO: el más antiguo cede el sitio.
    while (this.craters.length > this.maxCraters) {
      this.disposeCrater(this.craters.shift()!);
    }
  }

  /** Botón "Limpiar cráteres". */
  clear(): void {
    for (const c of this.craters) this.disposeCrater(c);
    this.craters = [];
  }

  private disposeCrater(c: Crater): void {
    this.parent.remove(c.group);
    for (const d of c.disposables) d.dispose();
  }

  dispose(): void {
    this.clear();
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }
}
