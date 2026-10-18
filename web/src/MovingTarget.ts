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
//  * `MovingTargetActor` — la capa visual: camión (models/targets.ts) pintado
//    DENTRO de Cesium por el runtime de modelos (GLB articulado: ruedas que
//    giran, cabeceo con el relieve, sombras) + estela punteada de los
//    últimos 30 s + FANTASMA translúcido de adelanto sugerido. Pre-muestrea
//    la altura del camino POR DELANTE en lotes (cascada DEM/terreno del
//    servicio) e interpola entre muestras.  [V2 — 3D-CORE]
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import { Vec3 } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ModelKit } from './models/kit';
import type { TargetModel } from './models/rig';
import { ArticulatedModel } from './models/runtime/ArticulatedModel';
import { buildTargetTruck } from './models/targets';

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
//  Capa visual (runtime de modelos + muestreo de terreno del servicio).
// ---------------------------------------------------------------------------

const TRAIL_SECONDS = 30;
const TRAIL_DOT_EVERY_S = 1.0;
const BATCH_AHEAD_M = 3000;
/** Semibase para el cabeceo con el relieve (m delante/detrás del centro). */
const PITCH_HALF_BASE_M = 3.0;
/** Versión del modelo del camión (invalida la caché de GLB). */
const TRUCK_REV = 1;

/** Camión del blanco: rig de models/targets.ts + su modelo articulado. */
interface TruckView {
  kit: ModelKit;
  target: TargetModel;
  model: ArticulatedModel;
  wheelRot0: number[];
}

export class MovingTargetActor {
  readonly motion: TargetMotion;

  private readonly group = new THREE.Group();
  private readonly truck: TruckView;
  private readonly ghost: TruckView;
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

  // Escratch de pose (cero asignaciones por frame).
  private readonly pose = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

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
    parent.add(this.group);
    this.truck = this.buildTruck(1.0);
    this.ghost = this.buildTruck(0.35); // P-VIVO.7 — fantasma de adelanto
    this.ghost.model.setVisible(false);
    this.trailGeo = new THREE.SphereGeometry(1.1, 8, 8);
    this.trailMat = new THREE.MeshBasicMaterial({
      color: 0x9fe7b0, transparent: true, opacity: 0.8, depthWrite: false,
    });
    this.disposables.push(this.trailGeo, this.trailMat);
    void this.sampleAhead();
  }

  /**
   * Camión (models/targets.ts) pintado por Cesium vía el runtime de modelos
   * (con copia Three de respaldo). El fantasma comparte GLB, translúcido.
   */
  private buildTruck(opacity: number): TruckView {
    const kit = new ModelKit();
    const target = buildTargetTruck(kit);
    const ghost = opacity < 1;
    const model = new ArticulatedModel({
      key: `target:truck:r${TRUCK_REV}`,
      root: target.root,
      animated: target.wheels,
      threeParent: this.group,
      shadows: !ghost,
      cesiumColor: ghost ? Cesium.Color.WHITE.withAlpha(opacity) : undefined,
      threeOpacity: ghost ? opacity : undefined,
    });
    return { kit, target, model, wheelRot0: target.wheels.map((w) => w.rotation.x) };
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

  /** Cabeceo (rad) del relieve en `distM`: alturas delante/detrás. */
  private groundPitch(distM: number): number {
    if (this.roadSamples.length < 2) return 0;
    const zf = this.groundZ(distM + PITCH_HALF_BASE_M);
    const zb = this.groundZ(distM - PITCH_HALF_BASE_M);
    return Math.atan2(zf - zb, 2 * PITCH_HALF_BASE_M);
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

  /** Pose ENU del camión: posición, rumbo y cabeceo con el relieve. */
  private placeTruck(view: TruckView, x: number, y: number, dist: number, headingDeg: number): void {
    const z = this.groundZ(dist);
    this.e.set(this.groundPitch(dist), 0, (-headingDeg * Math.PI) / 180, 'ZXY');
    this.q.setFromEuler(this.e);
    this.pose.compose(this.p.set(x, y, z), this.q, this.one);
    view.model.setPose(this.pose);
    // Ruedas: giro = distancia / radio (rodando hacia +Y local).
    const ang = dist / Math.max(0.1, view.target.wheelRadiusM);
    view.target.wheels.forEach((w, i) => { w.rotation.x = view.wheelRot0[i] - ang; });
    view.model.sync();
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
        const heading = r > this.ring.maxM
          ? toCenter + (this.rng() - 0.5) * 80
          : toCenter + 180 + (this.rng() - 0.5) * 80; // demasiado cerca: aléjate
        this.motion.rebase(this.clock, ((heading % 360) + 360) % 360);
        void this.sampleAhead();
      }
    }

    // Lote siguiente del camino cuando queda <500 m muestreado.
    const sampledEnd = this.roadStartDist + (this.roadSamples.length - 1) * this.roadStepM;
    if (this.roadSamples.length > 0 && sampledEnd - dist < 500) void this.sampleAhead();

    // Camión: posición + rumbo + cabeceo (el modelo mira a +y local).
    const p = this.motion.positionAt(this.clock);
    this.placeTruck(this.truck, p.x, p.y, dist, this.motion.headingDeg);
    const z = this.groundZ(dist);

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
      this.ghost.model.setVisible(true);
      this.placeTruck(this.ghost, gp.x, gp.y, gd, this.motion.headingDeg);
    } else {
      this.ghost.model.setVisible(false);
    }
  }

  dispose(): void {
    for (const d of this.trailDots) this.group.remove(d.mesh);
    this.trailDots.length = 0;
    for (const v of [this.truck, this.ghost]) {
      v.model.dispose();
      v.kit.dispose();
    }
    this.parent.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
