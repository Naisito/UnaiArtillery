// ============================================================================
//  ProjectilePresenter.ts — Actor visual de un tiro ya volado.  [P-WEB.3]
//
//  La física es autoritativa y se calculó de una vez (FlightResult); este
//  presentador solo REPRODUCE el camino muestreado en el tiempo (búsqueda
//  binaria + lerp, como el EvaluatePath de la capa Unreal), mueve la malla
//  con la nariz al vector velocidad, alimenta la estela/cono de choque y al
//  final orquesta explosión + boom + sacudida. Soporta timeDilation (para el
//  bullet-time) y startDelay (para salvas MRSI).
// ============================================================================
import * as THREE from 'three';
import { FlightResult, Vec3, Weapon } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ThreeOverlay } from './render/ThreeOverlay';
import { makeGlowSprite } from './render/PostFX';
import { ShockConeFX, TrailFX, VfxManager } from './vfx/effects';
import { AudioBoom } from './vfx/AudioBoom';

export interface Telemetry {
  t: number;
  mach: number;
  altitudeM: number;
  speedMS: number;
  dragN: number;
  kineticMJ: number;
  downrangeM: number;
  totalRangeM: number;
  flightAlpha: number; // 0..1
}

export class ProjectilePresenter {
  /** 1 = tiempo real; el director de cámara lo baja para el bullet-time. */
  timeDilation = 1.0;
  onImpact?: (impactEnu: Vec3, yieldScale: number, impactSpeed: number) => void;

  readonly yieldScale: number;

  private elapsed: number;
  private launched = false;
  private impacted = false;
  private disposeAt = Number.POSITIVE_INFINITY;
  private crackDone = false;

  private readonly mesh: THREE.Group;
  private readonly tracerGlow: THREE.Sprite;
  private readonly trail: TrailFX;
  private readonly shock: ShockConeFX;
  private readonly flightDuration: number;

  constructor(
    private readonly service: BallisticsService,
    private readonly overlay: ThreeOverlay,
    private readonly vfx: VfxManager,
    private readonly audio: AudioBoom,
    readonly weapon: Weapon,
    readonly flight: FlightResult,
    startDelay = 0.0,
  ) {
    this.elapsed = -startDelay;
    this.flightDuration =
      flight.timeOfFlight > 0
        ? flight.timeOfFlight
        : flight.path.length
          ? flight.path[flight.path.length - 1].t
          : 0;
    // P0.1 hecho bien de nacimiento: el yield viaja con el FlightResult.
    this.yieldScale = Math.cbrt(flight.warheadTNTeq / 6.6);

    // Malla: cuerpo cilíndrico + ojiva, orientada a +Z local.
    const d = weapon.round.diameter;
    const len = d * 6.5;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(d / 2, d / 2, len * 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x4c5157, metalness: 0.65, roughness: 0.35 }),
    );
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(d / 2, len * 0.3, 16),
      new THREE.MeshStandardMaterial({ color: 0x394047, metalness: 0.6, roughness: 0.4 }),
    );
    body.rotation.x = Math.PI / 2; // eje del cilindro -> Z
    nose.rotation.x = Math.PI / 2;
    nose.position.z = len * 0.5;
    this.mesh = new THREE.Group();
    this.mesh.add(body, nose);
    this.mesh.visible = false;

    // Trazador: halo pequeño para que el proyectil se lea a kilómetros.
    this.tracerGlow = makeGlowSprite(0xfff1cf, 2);
    this.tracerGlow.visible = false;
    this.mesh.add(this.tracerGlow);

    overlay.enuRoot.add(this.mesh);
    this.trail = vfx.makeTrail();
    this.shock = new ShockConeFX(overlay.enuRoot);
  }

  get flightAlpha(): number {
    return this.flightDuration > 0
      ? Math.min(1, Math.max(0, this.elapsed) / this.flightDuration)
      : 0;
  }

  get isImpacted(): boolean { return this.impacted; }

  /** Muestra del camino en el instante t (búsqueda binaria + lerp). */
  private evaluate(t: number): { pos: Vec3; vel: Vec3; mach: number; drag: number; mass: number } {
    const path = this.flight.path;
    const n = path.length;
    const at = (i: number) => ({
      pos: path[i].position, vel: path[i].velocity,
      mach: path[i].mach, drag: path[i].drag, mass: path[i].mass,
    });
    if (n === 0) return { pos: new Vec3(), vel: new Vec3(), mach: 0, drag: 0, mass: 0 };
    if (t <= path[0].t) return at(0);
    if (t >= path[n - 1].t) return at(n - 1);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (path[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = path[lo], b = path[hi];
    const f = (t - a.t) / Math.max(b.t - a.t, 1e-9);
    const lerpV = (p: Vec3, q: Vec3) => new Vec3(
      p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f,
    );
    return {
      pos: lerpV(a.position, b.position),
      vel: lerpV(a.velocity, b.velocity),
      mach: a.mach + (b.mach - a.mach) * f,
      drag: a.drag + (b.drag - a.drag) * f,
      mass: a.mass + (b.mass - a.mass) * f,
    };
  }

  /** Telemetría en vivo para el HUD (P4.1). Null si aún no ha salido. */
  telemetry(): Telemetry | null {
    if (!this.launched || this.flight.path.length === 0) return null;
    const t = Math.min(this.elapsed, this.flightDuration);
    const s = this.evaluate(t);
    const speed = s.vel.length();
    return {
      t,
      mach: s.mach,
      altitudeM: s.pos.z,
      speedMS: speed,
      dragN: s.drag,
      kineticMJ: 0.5 * s.mass * speed * speed * 1e-6,
      downrangeM: Math.hypot(s.pos.x, s.pos.y),
      totalRangeM: this.flight.downrange,
      flightAlpha: this.flightAlpha,
    };
  }

  /** Posición ENU actual (cámara/HUD). */
  positionEnu(): Vec3 {
    const t = Math.min(Math.max(0, this.elapsed), this.flightDuration);
    return this.evaluate(t).pos;
  }

  velocityEnu(): Vec3 {
    const t = Math.min(Math.max(0, this.elapsed), this.flightDuration);
    return this.evaluate(t).vel;
  }

  /** Avanza la reproducción. Devuelve false cuando puede eliminarse. */
  update(dtWall: number): boolean {
    const now = performance.now() / 1000;
    if (now > this.disposeAt) {
      this.dispose();
      return false;
    }
    if (this.impacted) return true;

    this.elapsed += dtWall * this.timeDilation;
    if (this.elapsed < 0) return true; // esperando su turno (MRSI)

    if (!this.launched) {
      this.launched = true;
      this.mesh.visible = true;
      this.tracerGlow.visible = true;
      this.handleLaunch();
    }

    if (this.elapsed >= this.flightDuration) {
      this.handleImpact();
      return true;
    }

    const s = this.evaluate(this.elapsed);
    this.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    const speed = s.vel.length();
    if (speed > 1e-6) {
      const dir = new THREE.Vector3(s.vel.x / speed, s.vel.y / speed, s.vel.z / speed);
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      // Cono de choque: aparece por encima de ~Mach 0.9 (como en Unreal).
      const shockStrength = Math.min(1, Math.max(0, (s.mach - 0.9) / 0.6));
      this.shock.set(this.mesh.position, dir, shockStrength);
    }

    // Trazador legible a cualquier distancia (escala con la distancia).
    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(this.mesh.position);
    this.tracerGlow.scale.setScalar(Math.min(40, Math.max(1.2, dist * 0.006)));

    // Estela: condensación transónica / exhausto del motor (P-WEB.5).
    const thrusting =
      this.weapon.round.motor.enabled && this.elapsed < this.weapon.round.motor.burnTime;
    this.trail.feed(dtWall * this.timeDilation, this.mesh.position, s.mach, s.pos.z, thrusting);

    // Chasquido supersónico al pasar cerca de la cámara (P3.2).
    if (!this.crackDone && s.mach > 1.05 && dist < 700) {
      this.crackDone = true;
      this.audio.boom('crack', dist, this.service.soundSpeedAt(camEnu.z), 0.8);
    }
    return true;
  }

  private handleLaunch(): void {
    const muzzle = this.service.muzzleEnu;
    const v0 = this.flight.path.length ? this.flight.path[0].velocity : new Vec3(0, 0, 1);
    const rho = this.service.atmo.densityAt(muzzle.z + this.service.frame.heightM);
    const scale = Math.max(0.6, Math.cbrt(this.weapon.round.diameter / 0.155));
    this.vfx.launchSignature(muzzle, v0, rho, scale);

    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z));
    this.audio.boom('muzzle', dist, this.service.soundSpeedAt(camEnu.z), scale);
  }

  private handleImpact(): void {
    this.impacted = true;
    const impact = this.flight.impactPoint;
    this.mesh.visible = false;
    this.shock.set(this.mesh.position, new THREE.Vector3(0, 0, -1), 0);
    this.trail.finish();

    this.vfx.impactExplosion(impact, this.yieldScale);

    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(new THREE.Vector3(impact.x, impact.y, impact.z));
    this.audio.boom('impact', dist, this.service.soundSpeedAt(impact.z), this.yieldScale);

    this.onImpact?.(impact, this.yieldScale, this.flight.impactSpeed);
    this.disposeAt = performance.now() / 1000 + 6.0; // deja asentarse humo/cámara
  }

  dispose(): void {
    this.overlay.enuRoot.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.tracerGlow.material.dispose();
    this.shock.dispose();
  }
}
