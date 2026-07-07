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
import { CraterLayer } from './vfx/CraterLayer';
import { ShockConeFX, TrailFX, VfxManager } from './vfx/effects';
import { AudioBoom } from './vfx/AudioBoom';
import { azimuthDegOf } from './vfx/audioMath';
import { toast } from './ui/toast';

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

/** Opciones de presentación de un tiro (la física no cambia). */
export interface PresenterOptions {
  /** P-VIVO.2 — bala trazadora: línea aditiva rojo-anaranjada ~3.5 s. */
  tracer?: boolean;
  /** P-VIVO.2 — bala de ráfaga: sin firma de boca propia (VFX/audio los
   *  comparte la ráfaga a 1 de cada 3 disparos). */
  silentLaunch?: boolean;
  /** P-VIVO.10 — repetición: VFX sí, cráter NO (no duplicar la huella). */
  noCrater?: boolean;
  /**
   * P-VIVO.10 — dilatación FIJA para toda la reproducción (repetición a
   * ×0.25): se re-afirma cada frame para que el bullet-time del director no
   * la pise.
   */
  fixedDilation?: number;
  /**
   * P-VIVO.4 — tramo de rebote: el trazador ya llevaba ardiendo este tiempo
   * (la composición se consume desde el DISPARO, no desde el rebote).
   */
  tracerAgeOffsetS?: number;
  /** P-VIVO.4 — tramo intermedio de rebote: su impacto no puntúa retos. */
  suppressScoring?: boolean;
  /** P-VIVO.4 — el tramo NACE EN EL AIRE (rebote): nada de boca del arma. */
  midair?: boolean;
}

export class ProjectilePresenter {
  /** 1 = tiempo real; el director de cámara lo baja para el bullet-time. */
  timeDilation = 1.0;
  onImpact?: (impactEnu: Vec3, yieldScale: number, impactSpeed: number) => void;
  /** P-PRO.1 — boca REAL del arma (punta del tubo); fija fogonazo y humo ahí. */
  muzzleProvider?: () => Vec3;
  /** P-PRO.1 — se dispara al salir el tiro (retroceso visual del tubo). */
  onLaunch?: () => void;
  /**
   * P-VIVO.5 — recorte estructural contra los edificios 3D: si el muestreo
   * visual (async, BuildingHit) encuentra una fachada/tejado en la cola de la
   * trayectoria, la reproducción se corta ahí. Null = sin tileset/sin dato.
   */
  structuralClip: import('./BuildingHit').StructuralClip | null = null;

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
  /** P-PRO.1 — boca real - inicio físico: el tiro SALE del tubo y se funde
   *  con la trayectoria física en ~1 s (solo visual). */
  private launchOffset = new Vec3(0, 0, 0);

  constructor(
    private readonly service: BallisticsService,
    private readonly overlay: ThreeOverlay,
    private readonly vfx: VfxManager,
    private readonly audio: AudioBoom,
    /** P-NEXT.7 — capa de cráteres persistentes (null = sin marca). */
    private readonly craters: CraterLayer | null,
    readonly weapon: Weapon,
    readonly flight: FlightResult,
    startDelay = 0.0,
    private readonly opts: PresenterOptions = {},
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
    // P-VIVO.2 — la bala trazadora arde rojo-anaranjado; la de ráfaga sin
    // trazador es invisible en vuelo (como las reales).
    this.tracerGlow = makeGlowSprite(opts.tracer ? 0xff8040 : 0xfff1cf, 2);
    this.tracerGlow.visible = false;
    this.mesh.add(this.tracerGlow);

    overlay.enuRoot.add(this.mesh);
    this.trail = vfx.makeTrail();
    if (opts.tracer) this.trail.setTracer(true, opts.tracerAgeOffsetS ?? 0);
    this.shock = new ShockConeFX(overlay.enuRoot);

    // P-VIVO.4 — clasifica la superficie del impacto EN CUANTO nace el tiro
    // (async, 1 muestra cacheada): al caer ya se sabe si es agua o tierra.
    void this.service
      .isLikelyWater(flight.impactPoint)
      .then((w) => { if (w) this.impactSurface = 'water'; })
      .catch(() => { /* sin clasificación: tierra */ });
  }

  /** P-VIVO.4 — superficie del punto de impacto ('land' salvo agua probada). */
  private impactSurface: 'land' | 'water' = 'land';

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

    if (this.opts.fixedDilation !== undefined) this.timeDilation = this.opts.fixedDilation;
    this.elapsed += dtWall * this.timeDilation;
    if (this.elapsed < 0) return true; // esperando su turno (MRSI)

    if (!this.launched) {
      this.launched = true;
      this.mesh.visible = true;
      this.tracerGlow.visible = true;
      this.handleLaunch();
    }

    // P-VIVO.5 — el edificio corta la reproducción ANTES del impacto físico
    // (si el muestreo visual llegó a tiempo; si no, comportamiento clásico).
    const clip = this.structuralClip?.result;
    if (clip && this.elapsed >= clip.t) {
      this.handleStructuralImpact(clip.point, clip.missM);
      return true;
    }

    if (this.elapsed >= this.flightDuration) {
      this.handleImpact();
      return true;
    }

    const s = this.evaluate(this.elapsed);
    const blend = Math.max(0, 1 - this.elapsed / 1.0); // funde boca -> física
    this.mesh.position.set(
      s.pos.x + this.launchOffset.x * blend,
      s.pos.y + this.launchOffset.y * blend,
      s.pos.z + this.launchOffset.z * blend,
    );
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
    // P-VIVO.2 — la ráfaga: la trazadora se consume a los ~3.5 s; la bala sin
    // trazadora vuela a oscuras (el mesh diminuto apenas se ve: correcto).
    // P-VIVO.4 — en un tramo de rebote el trazador arrastra su edad previa.
    if (this.opts.silentLaunch) {
      this.tracerGlow.visible =
        (this.opts.tracer ?? false) &&
        this.elapsed + (this.opts.tracerAgeOffsetS ?? 0) < 3.5;
    }

    // Estela: condensación transónica / exhausto del motor (P-WEB.5).
    const thrusting =
      this.weapon.round.motor.enabled && this.elapsed < this.weapon.round.motor.burnTime;
    this.trail.feed(dtWall * this.timeDilation, this.mesh.position, s.mach, s.pos.z, thrusting);

    // P-VIVO.1 — acimut del proyectil respecto a la cámara (pan estéreo).
    const azFromCam = azimuthDegOf(
      this.mesh.position.x - camEnu.x, this.mesh.position.y - camEnu.y,
    );

    // Chasquido supersónico al pasar cerca de la cámara (P3.2).
    if (!this.crackDone && s.mach > 1.05 && dist < 700) {
      this.crackDone = true;
      this.audio.boom('crack', dist, this.service.soundSpeedAt(camEnu.z), 0.8, azFromCam);
    }

    // P-VIVO.1 — silbido terminal: solo subsónico y a <500 m (audioMath
    // decide; aquí solo alimentamos Mach/distancia/acimut cada frame).
    this.audio.whistleTick(this, s.mach, dist, azFromCam);
    return true;
  }

  private handleLaunch(): void {
    // P-VIVO.4 — un tramo de rebote nace EN EL AIRE, en el punto del rebote:
    // ni fusión con la boca, ni retroceso, ni firma de lanzamiento.
    if (this.opts.midair) return;
    // P-PRO.1 — el fogonazo nace EXACTAMENTE en la punta del tubo del modelo.
    const muzzle = this.muzzleProvider?.() ?? this.service.muzzleEnu;
    if (this.flight.path.length) {
      const p0 = this.flight.path[0].position;
      this.launchOffset = new Vec3(muzzle.x - p0.x, muzzle.y - p0.y, muzzle.z - p0.z);
    }
    this.onLaunch?.();
    // P-VIVO.2 — bala de ráfaga: la firma de boca (VFX + audio) la comparte
    // la ráfaga (1 de cada 3 disparos, gestionado por ArtilleryPiece).
    if (this.opts.silentLaunch) return;

    const v0 = this.flight.path.length ? this.flight.path[0].velocity : new Vec3(0, 0, 1);
    const rho = this.service.atmo.densityAt(muzzle.z + this.service.frame.heightM);
    const scale = Math.max(0.6, Math.cbrt(this.weapon.round.diameter / 0.155));
    this.vfx.launchSignature(muzzle, v0, rho, scale);

    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z));
    this.audio.boom(
      'muzzle', dist, this.service.soundSpeedAt(camEnu.z), scale,
      azimuthDegOf(muzzle.x - camEnu.x, muzzle.y - camEnu.y),
    );
  }

  /**
   * P-VIVO.5 — impacto ESTRUCTURAL: explosión en la fachada/tejado (bola de
   * fuego + humo + audio, SIN cráter ni quemadura pegada a una pared
   * vertical) y recorte de la reproducción. El fallo del reto y onImpact
   * usan el punto recortado. La física nunca se enteró: es presentación.
   */
  private handleStructuralImpact(point: Vec3, missM: number): void {
    this.impacted = true;
    this.mesh.visible = false;
    this.shock.set(this.mesh.position, new THREE.Vector3(0, 0, -1), 0);
    this.trail.finish();
    this.audio.whistleStop(this);

    this.vfx.structureExplosion(point, this.yieldScale);
    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(new THREE.Vector3(point.x, point.y, point.z));
    this.audio.boom(
      'impact', dist, this.service.soundSpeedAt(point.z), this.yieldScale,
      azimuthDegOf(point.x - camEnu.x, point.y - camEnu.y),
    );
    if (this.flight.warheadTNTeq >= 0.05) {
      toast(`🏢 Impacto en estructura a ${missM.toFixed(0)} m del objetivo`);
    }

    const impactSpeed = this.evaluate(Math.min(this.elapsed, this.flightDuration)).vel.length();
    this.onImpact?.(point, this.yieldScale, impactSpeed);
    this.disposeAt = performance.now() / 1000 + 6.0;
  }

  private handleImpact(): void {
    this.impacted = true;
    const impact = this.flight.impactPoint;
    this.mesh.visible = false;
    this.shock.set(this.mesh.position, new THREE.Vector3(0, 0, -1), 0);
    this.trail.finish();
    this.audio.whistleStop(this); // P-VIVO.1 — el silbido muere con el impacto

    const camEnu = this.overlay.cameraEnu();
    const dist = camEnu.distanceTo(new THREE.Vector3(impact.x, impact.y, impact.z));
    const azFromCam = azimuthDegOf(impact.x - camEnu.x, impact.y - camEnu.y);
    const payload = this.weapon.round.payload;

    if (payload === 'illum') {
      // P-VIVO.8 — ILLUM: NADA explota. La carga expulsora despliega la
      // bengala en el punto de detonación (espoleta de tiempo) y cuelga del
      // viento real. El suelo bajo la bengala = detonación - altura de burst.
      const groundZ = impact.z - (this.flight.burstHeightM ?? 0);
      this.vfx.flare(impact, groundZ);
      this.audio.boom('rifle', dist, this.service.soundSpeedAt(impact.z), 0.4, azFromCam);
    } else if (payload === 'smoke') {
      // P-VIVO.8 — SMOKE: sin explosión ni cráter; cortina perpendicular al
      // rumbo de llegada que deriva con el viento de superficie.
      const vel = this.velocityEnu();
      const bearing = azimuthDegOf(vel.x, vel.y);
      this.vfx.smokeScreen(impact, bearing, Math.max(0.8, this.weapon.round.diameter / 0.155));
      this.audio.boom('impact', dist, this.service.soundSpeedAt(impact.z), 0.15, azFromCam);
    } else if (this.impactSurface === 'water' && this.flight.detonation === 'ground') {
      // P-VIVO.4 — el mar responde COMO MAR: columna de agua + anillos +
      // spray, boom ahogado, y NI cráter NI quemadura flotando en el agua.
      this.vfx.waterSplash(impact, Math.max(0.25, this.yieldScale));
      this.audio.boom(
        'impactWater', dist, this.service.soundSpeedAt(impact.z),
        Math.max(0.2, this.yieldScale), azFromCam,
      );
    } else {
      this.vfx.impactExplosion(impact, this.yieldScale);
      // P-NEXT.7 — huella persistente: quemadura + labio de tierra. El decal
      // se clava al SUELO VISUAL (teselas 3D / terreno real): la z de física
      // puede diferir de lo que se ve. Las balas (sin carga explosiva) no
      // dejan cráter, y una detonación AÉREA (espoleta de tiempo/proximidad,
      // P-VIVO.3) tampoco: la huella del airburst es de fragmentos, no hoyo.
      const buriesCrater =
        this.craters && !this.opts.noCrater &&
        this.flight.warheadTNTeq >= 0.05 && this.flight.detonation !== 'air';
      if (buriesCrater) {
        const craters = this.craters!;
        const yieldEq = this.flight.warheadTNTeq;
        this.service
          .visualGroundZ(impact)
          .then((z) => craters.add(z !== null ? new Vec3(impact.x, impact.y, z) : impact, yieldEq))
          .catch(() => craters.add(impact, yieldEq));
      }
      this.audio.boom(
        'impact', dist, this.service.soundSpeedAt(impact.z), this.yieldScale, azFromCam,
      );
    }

    this.onImpact?.(impact, this.yieldScale, this.flight.impactSpeed);
    this.disposeAt = performance.now() / 1000 + 6.0; // deja asentarse humo/cámara
  }

  dispose(): void {
    this.audio.whistleStop(this);
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
