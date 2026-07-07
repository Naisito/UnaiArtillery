// ============================================================================
//  MovingTarget.ts — Blanco móvil pegado al suelo real.  [P-VIVO.7]
//
//  Un convoy a 40 km/h con un TOF de 40 s se ha movido 440 m cuando llega el
//  tiro: el ADELANTO (lead = v·TOF) es la lección de tiro predicho.
//
//  * `TargetMotion` — propagación PURA: rumbo y velocidad constantes, con
//    `rebase()` para re-anclar (rebotar dentro del anillo jugable). Sin Three
//    ni Cesium: testeable en node.
//  * `heightAlong` — interpolación PURA de altura sobre muestras del camino.
//  * `MovingTargetActor` — la capa visual: camión esquemático (~8 m, verde
//    oscuro) + estela punteada de los últimos 30 s + FANTASMA translúcido de
//    adelanto sugerido. Pre-muestrea la altura del camino POR DELANTE en
//    lotes (cascada DEM/terreno del servicio) e interpola entre muestras.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from './ballistics';
import { BallisticsService } from './BallisticsService';

// ---------------------------------------------------------------------------
//  Lógica pura.
// ---------------------------------------------------------------------------

export interface Pos2 { x: number; y: number }

/** Altura interpolada a `distM` sobre muestras equiespaciadas `stepM`. */
export function heightAlong(samples: number[], stepM: number, distM: number): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1 || distM <= 0) return samples[0];
  const k = distM / stepM;
  const i = Math.floor(k);
  if (i >= samples.length - 1) return samples[samples.length - 1];
  const f = k - i;
  return samples[i] + f * (samples[i + 1] - samples[i]);
}

/**
 * Propagación del blanco: rumbo y velocidad constantes desde una base;
 * `rebase()` re-ancla la base en la posición actual con rumbo nuevo (el
 * blanco "rebota" dentro del anillo jugable sin teleportarse).
 */
export class TargetMotion {
  private baseX: number;
  private baseY: number;
  private baseT: number;
  private dirX: number;
  private dirY: number;
  /** Distancia recorrida acumulada ANTES de la base actual (para el suelo). */
  private distAtBase = 0;

  constructor(
    start: Pos2,
    public headingDeg: number,
    public readonly speedMS: number,
  ) {
    this.baseX = start.x;
    this.baseY = start.y;
    this.baseT = 0;
    const az = (headingDeg * Math.PI) / 180;
    this.dirX = Math.sin(az);
    this.dirY = Math.cos(az);
  }

  /** Posición en el instante t (s desde el arranque del reto). */
  positionAt(tS: number): Pos2 {
    const d = this.speedMS * Math.max(0, tS - this.baseT);
    return { x: this.baseX + this.dirX * d, y: this.baseY + this.dirY * d };
  }

  /** Distancia total recorrida en t (monótona: alimenta la altura del camino). */
  distanceAt(tS: number): number {
    return this.distAtBase + this.speedMS * Math.max(0, tS - this.baseT);
  }

  /** Velocidad ENU horizontal (constante entre rebases). */
  velocity(): Pos2 {
    return { x: this.dirX * this.speedMS, y: this.dirY * this.speedMS };
  }

  /** Re-ancla en la posición de `tS` con rumbo nuevo (determinista). */
  rebase(tS: number, newHeadingDeg: number): void {
    const p = this.positionAt(tS);
    this.distAtBase = this.distanceAt(tS);
    this.baseX = p.x;
    this.baseY = p.y;
    this.baseT = tS;
    this.headingDeg = newHeadingDeg;
    const az = (newHeadingDeg * Math.PI) / 180;
    this.dirX = Math.sin(az);
    this.dirY = Math.cos(az);
  }
}

// ---------------------------------------------------------------------------
//  Capa visual (Three + muestreo de terreno del servicio).
// ---------------------------------------------------------------------------

const TRAIL_SECONDS = 30;
const TRAIL_DOT_EVERY_S = 1.0;
const BATCH_AHEAD_M = 3000;

export class MovingTargetActor {
  readonly motion: TargetMotion;

  private readonly group = new THREE.Group();
  private readonly truck: THREE.Group;
  private readonly ghost: THREE.Group;
  private readonly trailDots: { mesh: THREE.Mesh; born: number }[] = [];
  private readonly trailMat: THREE.MeshBasicMaterial;
  private readonly trailGeo: THREE.SphereGeometry;
  private disposables: { dispose(): void }[] = [];

  private clock = 0;
  private nextDotAt = 0;
  private ghostTofS: number | null = null;

  // Camino muestreado: alturas desde distStart cada stepM.
  private roadSamples: number[] = [];
  private roadStartDist = 0;
  private readonly roadStepM = 40;
  private sampling = false;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly service: BallisticsService,
    start: Pos2,
    headingDeg: number,
    speedMS: number,
    /** Anillo jugable [minM, maxM] desde la batería; null = sin rebase. */
    private readonly ring: { minM: number; maxM: number } | null,
    private readonly rng: () => number = Math.random,
  ) {
    this.motion = new TargetMotion(start, headingDeg, speedMS);
    this.truck = this.buildTruck(1.0);
    this.ghost = this.buildTruck(0.35); // P-VIVO.7 — fantasma de adelanto
    this.ghost.visible = false;
    this.trailGeo = new THREE.SphereGeometry(1.1, 8, 8);
    this.trailMat = new THREE.MeshBasicMaterial({
      color: 0x9fe7b0, transparent: true, opacity: 0.8, depthWrite: false,
    });
    this.disposables.push(this.trailGeo, this.trailMat);
    this.group.add(this.truck, this.ghost);
    parent.add(this.group);
    void this.sampleAhead();
  }

  /** Caja-camión esquemática de ~8 m (cabina + caja), verde oscuro. */
  private buildTruck(opacity: number): THREE.Group {
    const g = new THREE.Group();
    const mat = (c: number) => {
      const m = new THREE.MeshStandardMaterial({
        color: c, metalness: 0.2, roughness: 0.7,
        transparent: opacity < 1, opacity,
      });
      this.disposables.push(m);
      return m;
    };
    const mk = (w: number, d: number, h: number, m: THREE.Material) => {
      const geo = new THREE.BoxGeometry(w, d, h);
      this.disposables.push(geo);
      return new THREE.Mesh(geo, m);
    };
    const body = mk(2.5, 6.0, 2.2, mat(0x2f4a30)); // caja (verde oscuro)
    body.position.set(0, -0.8, 1.6);
    const cab = mk(2.3, 1.8, 1.7, mat(0x3a5a3b));
    cab.position.set(0, 3.0, 1.3);
    const wheels = mat(0x1d2321);
    for (const [sx, wy] of [[-1, 2.9], [1, 2.9], [-1, 0.2], [1, 0.2], [-1, -2.4], [1, -2.4]] as const) {
      const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.35, 12);
      this.disposables.push(geo);
      const w = new THREE.Mesh(geo, wheels);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 1.3, wy, 0.55);
      g.add(w);
    }
    g.add(body, cab);
    return g;
  }

  /** Posición ENU actual (para puntuar el impacto EN SU instante). */
  positionEnu(): Vec3 {
    const p = this.motion.positionAt(this.clock);
    return new Vec3(p.x, p.y, this.groundZ(this.motion.distanceAt(this.clock)));
  }

  /** Velocidad horizontal (para el vector del minimapa). */
  velocity2D(): Pos2 { return this.motion.velocity(); }

  /** TOF del preview vigente (null apaga el fantasma). */
  setGhostTof(tofS: number | null): void { this.ghostTofS = tofS; }

  private groundZ(distM: number): number {
    if (this.roadSamples.length === 0) return 0;
    return heightAlong(this.roadSamples, this.roadStepM, distM - this.roadStartDist);
  }

  /** Pre-muestrea el camino 3 km por delante (lote batched del servicio). */
  private async sampleAhead(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const from = this.motion.positionAt(this.clock);
      const v = this.motion.velocity();
      const speed = Math.hypot(v.x, v.y) || 1;
      const to = {
        x: from.x + (v.x / speed) * BATCH_AHEAD_M,
        y: from.y + (v.y / speed) * BATCH_AHEAD_M,
      };
      const samples = await this.service.sampleLineProfile(
        new Vec3(from.x, from.y, 0), new Vec3(to.x, to.y, 0), this.roadStepM,
      );
      this.roadSamples = samples;
      this.roadStartDist = this.motion.distanceAt(this.clock);
    } catch (err) {
      console.warn('[moving-target] sin muestreo del camino', err);
    } finally {
      this.sampling = false;
    }
  }

  update(dt: number): void {
    this.clock += dt;
    const dist = this.motion.distanceAt(this.clock);

    // Re-anclaje dentro del anillo jugable: rebota hacia dentro.
    if (this.ring) {
      const p = this.motion.positionAt(this.clock);
      const r = Math.hypot(p.x, p.y);
      if (r < this.ring.minM || r > this.ring.maxM) {
        // Rumbo hacia el centro del anillo, con abanico aleatorio ±40º.
        const toCenter = (Math.atan2(-p.x, -p.y) * 180) / Math.PI;
        const mid = (this.ring.minM + this.ring.maxM) / 2;
        const heading = r > this.ring.maxM
          ? toCenter + (this.rng() - 0.5) * 80
          : toCenter + 180 + (this.rng() - 0.5) * 80; // demasiado cerca: aléjate
        this.motion.rebase(this.clock, ((heading % 360) + 360) % 360);
        void this.sampleAhead();
        void mid;
      }
    }

    // Lote siguiente del camino cuando queda <500 m muestreado.
    const sampledEnd = this.roadStartDist + (this.roadSamples.length - 1) * this.roadStepM;
    if (this.roadSamples.length > 0 && sampledEnd - dist < 500) void this.sampleAhead();

    // Camión: posición + orientación al rumbo (el modelo mira a +y local).
    const p = this.motion.positionAt(this.clock);
    const z = this.groundZ(dist);
    this.truck.position.set(p.x, p.y, z);
    this.truck.rotation.z = (-this.motion.headingDeg * Math.PI) / 180;

    // Estela punteada de los últimos 30 s.
    if (this.clock >= this.nextDotAt) {
      this.nextDotAt = this.clock + TRAIL_DOT_EVERY_S;
      const dot = new THREE.Mesh(this.trailGeo, this.trailMat);
      dot.position.set(p.x, p.y, z + 0.6);
      this.group.add(dot);
      this.trailDots.push({ mesh: dot, born: this.clock });
    }
    for (let i = this.trailDots.length - 1; i >= 0; i--) {
      if (this.clock - this.trailDots[i].born > TRAIL_SECONDS) {
        this.group.remove(this.trailDots[i].mesh);
        this.trailDots.splice(i, 1);
      }
    }

    // Fantasma de adelanto: el blanco extrapolado al TOF del preview.
    if (this.ghostTofS !== null && this.ghostTofS > 0) {
      const gp = this.motion.positionAt(this.clock + this.ghostTofS);
      const gd = this.motion.distanceAt(this.clock + this.ghostTofS);
      this.ghost.visible = true;
      this.ghost.position.set(gp.x, gp.y, this.groundZ(gd));
      this.ghost.rotation.z = this.truck.rotation.z;
    } else {
      this.ghost.visible = false;
    }
  }

  dispose(): void {
    for (const d of this.trailDots) this.group.remove(d.mesh);
    this.trailDots.length = 0;
    this.parent.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
