// ============================================================================
//  ProjectilePresenter.ts — Actor visual de un tiro ya volado.  [P-WEB.3]
//
//  La física es autoritativa y se calculó de una vez (FlightResult); este
//  presentador solo REPRODUCE el camino muestreado en el tiempo (búsqueda
//  binaria + lerp, como el EvaluatePath de la capa Unreal), mueve el modelo
//  con la nariz al vector velocidad, alimenta la estela/cono de choque y al
//  final orquesta explosión + boom + sacudida. Soporta timeDilation (para el
//  bullet-time) y startDelay (para salvas MRSI).
//
//  P-ANI.2 — la malla ya no es un cilindro con un cono: es un ProjectileModel
//  con la silueta real de su familia, que gira sobre su eje según el estriado,
//  despliega aletas, enciende la tobera mientras el motor quema y se pone al
//  rojo si reentra hipersónico.
//
//  P-AUD.1 — cada evento sonoro lleva su cue espacial (distancia, panorámica
//  y si suena a la espalda) y el silbido del proyectil entrante se programa
//  para terminar exactamente cuando llega el estampido del impacto.
// ============================================================================
import * as THREE from 'three';
import { FlightResult, Vec3, Weapon } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ThreeOverlay } from './render/ThreeOverlay';
import { ProjectileModel } from './render/ProjectileModel';
import { CraterLayer } from './vfx/CraterLayer';
import { ShockConeFX, TrailFX, VfxManager } from './vfx/effects';
import { AudioEngine } from './vfx/AudioEngine';

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
  /** P-PRO.1 — boca REAL del arma (punta del tubo); fija fogonazo y humo ahí. */
  muzzleProvider?: () => Vec3;
  /** P-PRO.1 — se dispara al salir el tiro (retroceso visual del tubo). */
  onLaunch?: () => void;

  readonly yieldScale: number;

  private elapsed: number;
  private launched = false;
  private impacted = false;
  private disposeAt = Number.POSITIVE_INFINITY;
  private crackDone = false;
  private whistleDone = false;

  private readonly model: ProjectileModel;
  private readonly trail: TrailFX;
  private readonly shock: ShockConeFX;
  private readonly flightDuration: number;
  /** P-PRO.1 — boca real - inicio físico: el tiro SALE del tubo y se funde
   *  con la trayectoria física en ~1 s (solo visual). */
  private launchOffset = new Vec3(0, 0, 0);

  constructor(
    private readonly service: BallisticsService,
    private readonly overlay: ThreeOverlay,
    private readonly vfx: VfxManager,
    private readonly audio: AudioEngine,
    /** P-NEXT.7 — capa de cráteres persistentes (null = sin marca). */
    private readonly craters: CraterLayer | null,
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

    // P-ANI.2 — silueta real de la familia, con toda su animación dentro.
    this.model = new ProjectileModel(weapon);
    this.model.group.visible = false;
    overlay.enuRoot.add(this.model.group);

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

    const dtSim = dtWall * this.timeDilation;
    this.elapsed += dtSim;
    if (this.elapsed < 0) return true; // esperando su turno (MRSI)

    if (!this.launched) {
      this.launched = true;
      this.model.group.visible = true;
      this.handleLaunch();
    }

    if (this.elapsed >= this.flightDuration) {
      this.handleImpact();
      return true;
    }

    const s = this.evaluate(this.elapsed);
    const blend = Math.max(0, 1 - this.elapsed / 1.0); // funde boca -> física
    const pos = this.model.group.position;
    pos.set(
      s.pos.x + this.launchOffset.x * blend,
      s.pos.y + this.launchOffset.y * blend,
      s.pos.z + this.launchOffset.z * blend,
    );
    const speed = s.vel.length();
    if (speed > 1e-6) {
      const dir = new THREE.Vector3(s.vel.x / speed, s.vel.y / speed, s.vel.z / speed);
      this.model.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      // Cono de choque: aparece por encima de ~Mach 0.9 (como en Unreal).
      const shockStrength = Math.min(1, Math.max(0, (s.mach - 0.9) / 0.6));
      this.shock.set(pos, dir, shockStrength);
    }

    // Animación del proyectil: giro, precesión, aletas, tobera, escala.
    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(pos);
    const thrusting = this.isThrusting(this.elapsed);
    this.model.update(dtSim, {
      elapsed: this.elapsed,
      speed,
      mach: s.mach,
      thrusting,
      camDistance: dist,
    });

    // Estela: condensación transónica / exhausto del motor (P-WEB.5).
    this.trail.feed(dtSim, pos, s.mach, s.pos.z, thrusting);

    this.tickIncomingAudio(s.mach, dist, camEnu);
    return true;
  }

  /** El motor empuja ahora (respeta el retardo de ignición de los RAP). */
  private isThrusting(t: number): boolean {
    const m = this.weapon.round.motor;
    if (!m.enabled) return false;
    const t0 = m.ignitionDelayS;
    return t >= t0 && t < t0 + m.burnTime;
  }

  /**
   * Audio de proximidad: el chasquido supersónico al pasar cerca y el silbido
   * del proyectil entrante, programado para morir cuando llega el estampido.
   */
  private tickIncomingAudio(mach: number, dist: number, camEnu: THREE.Vector3): void {
    const cue = this.overlay.audioCueFor(this.model.group.position);
    const cal = this.weapon.round.diameter;

    if (!this.crackDone && mach > 1.05 && dist < 700) {
      this.crackDone = true;
      this.audio.boom('crack', {
        distanceM: dist,
        soundSpeed: this.service.soundSpeedAt(camEnu.z),
        energy: 0.85,
        pan: cue.pan,
        behind: cue.behind,
        caliberM: cal,
      });
    }

    // Silbido: solo si el oyente está en la zona del impacto (es lo que oye
    // quien lo recibe, no quien lo dispara).
    if (this.whistleDone) return;
    const remaining = this.flightDuration - this.elapsed;
    const impact = this.flight.impactPoint;
    const listenerToImpact = camEnu.distanceTo(
      new THREE.Vector3(impact.x, impact.y, impact.z),
    );
    if (listenerToImpact > 1200 || remaining > 4.5) return;

    this.whistleDone = true;
    const c = this.service.soundSpeedAt(camEnu.z);
    const dur = Math.min(2.6, Math.max(0.6, remaining));
    // El silbido debe acabar cuando el estampido del impacto llega al oyente.
    const arrival = remaining + listenerToImpact / c;
    this.audio.whistle({
      delayS: Math.max(0.01, arrival - dur),
      durS: dur,
      closingSpeed: Math.max(0, this.flight.impactSpeed),
      soundSpeed: c,
      distanceM: Math.max(60, listenerToImpact),
      pan: cue.pan,
      energy: Math.min(1.3, this.yieldScale),
      caliberM: cal,
    });
  }

  private handleLaunch(): void {
    // P-PRO.1 — el fogonazo nace EXACTAMENTE en la punta del tubo del modelo.
    const muzzle = this.muzzleProvider?.() ?? this.service.muzzleEnu;
    if (this.flight.path.length) {
      const p0 = this.flight.path[0].position;
      this.launchOffset = new Vec3(muzzle.x - p0.x, muzzle.y - p0.y, muzzle.z - p0.z);
    }
    const v0 = this.flight.path.length ? this.flight.path[0].velocity : new Vec3(0, 0, 1);
    const rho = this.service.atmo.densityAt(muzzle.z + this.service.frame.heightM);
    const scale = Math.max(0.6, Math.cbrt(this.weapon.round.diameter / 0.155));
    this.vfx.launchSignature(muzzle, v0, rho, scale, this.weapon.category);
    this.onLaunch?.();

    const cue = this.overlay.audioCueFor(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z));
    const camEnu = this.overlay.cameraEnu();
    this.audio.boom(this.weapon.category === 'SmallArms' ? 'muzzleSmall' : 'muzzle', {
      distanceM: cue.distanceM,
      soundSpeed: this.service.soundSpeedAt(camEnu.z),
      energy: scale,
      pan: cue.pan,
      behind: cue.behind,
      caliberM: this.weapon.round.diameter,
    });
  }

  private handleImpact(): void {
    this.impacted = true;
    const impact = this.flight.impactPoint;
    this.model.group.visible = false;
    this.shock.set(this.model.group.position, new THREE.Vector3(0, 0, -1), 0);
    this.trail.finish();

    this.vfx.impactExplosion(impact, this.yieldScale, this.flight.impactSpeed);
    // P-NEXT.7 — huella persistente: quemadura + labio de tierra. El decal se
    // clava al SUELO VISUAL (teselas 3D / terreno real): la z de física puede
    // diferir de lo que se ve (corredor interpolado, edificios de Google).
    // Las balas (sin carga explosiva) no dejan cráter: solo polvareda.
    if (this.craters && this.flight.warheadTNTeq >= 0.05) {
      const craters = this.craters;
      const yieldEq = this.flight.warheadTNTeq;
      this.service
        .visualGroundZ(impact)
        .then((z) => craters.add(z !== null ? new Vec3(impact.x, impact.y, z) : impact, yieldEq))
        .catch(() => craters.add(impact, yieldEq));
    }

    const cue = this.overlay.audioCueFor(new THREE.Vector3(impact.x, impact.y, impact.z));
    this.audio.boom('impact', {
      distanceM: cue.distanceM,
      soundSpeed: this.service.soundSpeedAt(impact.z),
      energy: this.yieldScale,
      pan: cue.pan,
      behind: cue.behind,
      caliberM: this.weapon.round.diameter,
    });

    this.onImpact?.(impact, this.yieldScale, this.flight.impactSpeed);
    this.disposeAt = performance.now() / 1000 + 6.0; // deja asentarse humo/cámara
  }

  dispose(): void {
    this.model.dispose();
    this.shock.dispose();
  }
}
