// ============================================================================
//  ProjectilePresenter.ts — Actor visual de un tiro ya volado.  [P-WEB.3]
//
//  La física es autoritativa y se calculó de una vez (FlightResult); este
//  presentador solo REPRODUCE el camino muestreado en el tiempo (búsqueda
//  binaria + lerp, como el EvaluatePath de la capa Unreal), mueve la malla
//  con la nariz al vector velocidad, alimenta la estela/cono de choque y al
//  final orquesta explosión + boom + sacudida. Soporta timeDilation (para el
//  bullet-time) y startDelay (para salvas MRSI).
//
//  V2 VFX: firma de boca y estela SEGÚN EL ARMA (obús con freno de boca,
//  2S7, mortero, cohete/misil con rebufo y penacho, armas ligeras con
//  trazadora), detonación según la espoleta (suelo / aérea / retardo),
//  rugido de motor y chasquido supersónico por punto de máximo acercamiento
//  a la cámara, oclusión tras el relieve (RenderHook del overlay) y cero
//  asignaciones en update() (muestreo del camino en estructuras reutilizadas).
//
//  NOTA DE INTEGRACIÓN: el bloque "Malla: cuerpo cilíndrico + ojiva" del
//  constructor es de 3D-SMALL (lo sustituye por buildProjectile()); VFX no
//  lo toca para que el merge sea trivial.
// ============================================================================
import * as THREE from 'three';
import { FlightResult, Vec3, Weapon } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ThreeOverlay, type RenderHook } from './render/ThreeOverlay';
import { makeGlowSprite } from './render/PostFX';
import { CraterLayer } from './vfx/CraterLayer';
import { ShockConeFX, TrailFX, VfxManager, type LaunchKind, type TrailKind } from './vfx/effects';
import type { RenderCtx } from './vfx/particles';
import { AudioBoom } from './vfx/AudioBoom';
import { azimuthDegOf } from './vfx/audioMath';
import { toast } from './ui/toast';

/** Muestra reutilizable del camino (sin objetos nuevos por frame). */
interface PathSample {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  mach: number; drag: number; mass: number;
}

/** V2 — firma de boca y estela según la categoría y el calibre del arma. */
export function visualKindsFor(weapon: Weapon): {
  launch: LaunchKind; launchScale: number; trail: TrailKind; trailScale: number;
} {
  const r = weapon.round;
  const d = r.diameter;
  switch (weapon.category) {
    case 'Mortar':
      return { launch: 'mortar', launchScale: Math.cbrt(d / 0.12), trail: 'shell', trailScale: 0.8 };
    case 'Rocket':
      return { launch: 'rocket', launchScale: Math.max(0.7, d / 0.227), trail: 'rocket', trailScale: Math.max(0.7, d / 0.227) };
    case 'Missile':
      return { launch: 'missile', launchScale: Math.max(1, d / 0.45), trail: 'missile', trailScale: Math.max(1.2, d / 0.36) };
    case 'SmallArms':
      return {
        launch: 'smallArms', launchScale: Math.max(0.6, Math.pow(d / 0.0078, 0.8)),
        trail: 'bullet', trailScale: Math.max(0.7, Math.pow(d / 0.0078, 0.6)),
      };
    default: {
      const heavy = d >= 0.19;
      const trail: TrailKind = r.motor.enabled ? 'rap' : r.baseBleed?.enabled ? 'baseBleed' : 'shell';
      return { launch: heavy ? 'heavy' : 'howitzer', launchScale: Math.max(0.6, Math.cbrt(d / 0.155)), trail, trailScale: 1 };
    }
  }
}

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

export class ProjectilePresenter implements RenderHook {
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

  private readonly mesh: THREE.Group;
  private readonly tracerGlow: THREE.Sprite;
  private readonly trail: TrailFX;
  private readonly shock: ShockConeFX;
  private readonly flightDuration: number;
  /** P-PRO.1 — boca real - inicio físico: el tiro SALE del tubo y se funde
   *  con la trayectoria física en ~1 s (solo visual). */
  private launchOffset = new Vec3(0, 0, 0);

  // --- V2 VFX: trabajo reutilizado + estado de oclusión/audio ---
  private readonly kinds: ReturnType<typeof visualKindsFor>;
  private readonly sample: PathSample = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, mach: 0, drag: 0, mass: 0 };
  private readonly camV = new THREE.Vector3();
  private readonly dirV = new THREE.Vector3();
  private readonly velV = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);
  private static readonly DOWN = new THREE.Vector3(0, 0, -1);
  /** Visibilidad tras el relieve (0..1, suavizada) y objetivo de la prueba. */
  private vis = 1;
  private visT = 1;
  private tracerBaseOpacity = 1;
  /** Distancia a la cámara del frame anterior (chasquido por acercamiento). */
  private prevCamDist = Number.POSITIVE_INFINITY;
  private minCamDist = Number.POSITIVE_INFINITY;
  private approaching = false;
  private hooked = false;

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
    this.kinds = visualKindsFor(weapon); // V2 — firma/estela según el arma
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
    this.trail = vfx.makeTrail(this.kinds.trail, this.kinds.trailScale);
    if (opts.tracer) this.trail.setTracer(true, opts.tracerAgeOffsetS ?? 0);
    this.shock = new ShockConeFX(overlay.enuRoot);
    // V2 — oclusión tras el relieve: el overlay nos prepara cada frame.
    this.tracerBaseOpacity = (this.tracerGlow.material as THREE.SpriteMaterial).opacity;
    overlay.addRenderHook(this);
    this.hooked = true;

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

  /** Índice de la última búsqueda (el tiempo avanza: búsqueda local O(1)). */
  private searchHint = 0;

  /**
   * Muestra del camino en el instante t (búsqueda con pista + binaria, lerp)
   * escrita en `out`: cero asignaciones.
   */
  private evaluateInto(t: number, out: PathSample): PathSample {
    const path = this.flight.path;
    const n = path.length;
    if (n === 0) {
      out.px = out.py = out.pz = out.vx = out.vy = out.vz = 0;
      out.mach = out.drag = out.mass = 0;
      return out;
    }
    let lo: number, hi: number, f: number;
    if (t <= path[0].t) {
      lo = hi = 0; f = 0;
    } else if (t >= path[n - 1].t) {
      lo = hi = n - 1; f = 0;
    } else {
      // Pista: casi siempre el tramo es el mismo o el siguiente.
      let i = Math.min(Math.max(0, this.searchHint), n - 2);
      if (path[i].t <= t && t < path[i + 1].t) {
        lo = i;
      } else if (i + 2 < n && path[i + 1].t <= t && t < path[i + 2].t) {
        lo = i + 1;
      } else {
        let a = 0, b = n - 1;
        while (b - a > 1) {
          const mid = (a + b) >> 1;
          if (path[mid].t <= t) a = mid;
          else b = mid;
        }
        lo = a;
      }
      hi = lo + 1;
      this.searchHint = lo;
      const pa = path[lo], pb = path[hi];
      f = (t - pa.t) / Math.max(pb.t - pa.t, 1e-9);
    }
    const a = path[lo], b = path[hi];
    const ap = a.position, bp = b.position, av = a.velocity, bv = b.velocity;
    out.px = ap.x + (bp.x - ap.x) * f;
    out.py = ap.y + (bp.y - ap.y) * f;
    out.pz = ap.z + (bp.z - ap.z) * f;
    out.vx = av.x + (bv.x - av.x) * f;
    out.vy = av.y + (bv.y - av.y) * f;
    out.vz = av.z + (bv.z - av.z) * f;
    out.mach = a.mach + (b.mach - a.mach) * f;
    out.drag = a.drag + (b.drag - a.drag) * f;
    out.mass = a.mass + (b.mass - a.mass) * f;
    return out;
  }

  /** Telemetría en vivo para el HUD (P4.1). Null si aún no ha salido. */
  telemetry(): Telemetry | null {
    if (!this.launched || this.flight.path.length === 0) return null;
    const t = Math.min(this.elapsed, this.flightDuration);
    const s = this.evaluateInto(t, this.sample);
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    return {
      t,
      mach: s.mach,
      altitudeM: s.pz,
      speedMS: speed,
      dragN: s.drag,
      kineticMJ: 0.5 * s.mass * speed * speed * 1e-6,
      downrangeM: Math.hypot(s.px, s.py),
      totalRangeM: this.flight.downrange,
      flightAlpha: this.flightAlpha,
    };
  }

  /** Posición ENU actual (cámara/HUD). */
  positionEnu(): Vec3 {
    const t = Math.min(Math.max(0, this.elapsed), this.flightDuration);
    const s = this.evaluateInto(t, this.sample);
    return new Vec3(s.px, s.py, s.pz);
  }

  velocityEnu(): Vec3 {
    const t = Math.min(Math.max(0, this.elapsed), this.flightDuration);
    const s = this.evaluateInto(t, this.sample);
    return new Vec3(s.vx, s.vy, s.vz);
  }

  // --- RenderHook (oclusión tras el relieve) ---------------------------------
  prepare(ctx: RenderCtx): boolean {
    if (!this.launched || this.impacted) return false;
    if (ctx.occlusionFresh && ctx.occlusion) {
      const p = this.mesh.position;
      const v = ctx.occlusion.test(p.x, p.y, p.z, 2);
      if (v >= 0) this.visT = v;
    }
    this.vis += (this.visT - this.vis) * (1 - Math.exp(-ctx.dt * 10));
    // La malla aparece/desaparece con la oclusión; el halo se funde.
    this.mesh.visible = this.vis > 0.5;
    (this.tracerGlow.material as THREE.SpriteMaterial).opacity = this.tracerBaseOpacity * this.vis;
    return this.mesh.visible;
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

    const s = this.evaluateInto(this.elapsed, this.sample);
    const blend = Math.max(0, 1 - this.elapsed / 1.0); // funde boca -> física
    this.mesh.position.set(
      s.px + this.launchOffset.x * blend,
      s.py + this.launchOffset.y * blend,
      s.pz + this.launchOffset.z * blend,
    );
    const camEnu = this.overlay.cameraEnu(this.camV);
    const dist = camEnu.distanceTo(this.mesh.position);
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    this.velV.set(s.vx, s.vy, s.vz);
    if (speed > 1e-6) {
      this.dirV.set(s.vx / speed, s.vy / speed, s.vz / speed);
      this.mesh.quaternion.setFromUnitVectors(ProjectilePresenter.Z_AXIS, this.dirV);
      // Cono de choque: apenas un brillo por encima de ~Mach 0.9 y cerca.
      const shockStrength = Math.min(1, Math.max(0, (s.mach - 0.9) / 0.6));
      this.shock.set(this.mesh.position, this.dirV, shockStrength * this.vis, dist);
    }

    // Trazador legible a cualquier distancia (escala con la distancia).
    this.tracerGlow.scale.setScalar(Math.min(40, Math.max(1.2, dist * 0.006)));
    // P-VIVO.2 — la ráfaga: la trazadora se consume a los ~3.5 s; la bala sin
    // trazadora vuela a oscuras (el mesh diminuto apenas se ve: correcto).
    // P-VIVO.4 — en un tramo de rebote el trazador arrastra su edad previa.
    if (this.opts.silentLaunch) {
      this.tracerGlow.visible =
        (this.opts.tracer ?? false) &&
        this.elapsed + (this.opts.tracerAgeOffsetS ?? 0) < 3.5;
    }

    // Estela: según el arma (P-WEB.5 → V2). El base bleed "empuja" mientras
    // arde su generador de gas; RAP/cohetes mientras arde el motor.
    const round = this.weapon.round;
    const thrusting =
      (round.motor.enabled && this.elapsed < round.motor.burnTime) ||
      (this.kinds.trail === 'baseBleed' && this.elapsed < (round.baseBleed?.durationS ?? 0));
    this.trail.feed(dtWall * this.timeDilation, this.mesh.position, s.mach, s.pz, thrusting, this.velV);

    // P-VIVO.1 — acimut del proyectil respecto a la cámara (pan estéreo).
    const azFromCam = azimuthDegOf(
      this.mesh.position.x - camEnu.x, this.mesh.position.y - camEnu.y,
    );

    // V2 — chasquido supersónico (onda N): se dispara al pasar el punto de
    // MÁXIMO ACERCAMIENTO a la cámara si la distancia de paso es corta para
    // su calibre (una bala chasquea a <~120 m; una granada a <~700 m).
    if (dist < this.prevCamDist) {
      this.approaching = true;
      this.minCamDist = Math.min(this.minCamDist, dist);
    } else if (this.approaching && s.mach > 1.02) {
      this.approaching = false;
      const d = this.weapon.round.diameter;
      const reach = d < 0.02 ? 140 : 450 + 1600 * Math.min(0.4, d);
      // Solo de pasada: lejos del arma (su boom ya tapa el chasquido).
      if (this.minCamDist < reach && this.elapsed > 0.25) {
        this.audio.supersonicCrack(
          this.minCamDist, this.service.soundSpeedAt(camEnu.z), d, s.mach, azFromCam,
        );
      }
      this.minCamDist = Number.POSITIVE_INFINITY;
    }
    this.prevCamDist = dist;

    // P-VIVO.1 — silbido TERMINAL: solo en rama descendente (un mortero
    // subsónico saliendo junto a la cámara no debe silbar en la salida),
    // subsónico y a <500 m (audioMath decide ganancia/frecuencia).
    if (s.vz < 0) this.audio.whistleTick(this, s.mach, dist, azFromCam);
    else this.audio.whistleStop(this);
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
    const k = this.kinds;
    this.vfx.launchSignature(muzzle, v0, rho, k.launchScale, k.launch);

    const camEnu = this.overlay.cameraEnu(this.camV);
    const dist = camEnu.distanceTo(this.tmpV.set(muzzle.x, muzzle.y, muzzle.z));
    const c = this.service.soundSpeedAt(camEnu.z);
    const az = azimuthDegOf(muzzle.x - camEnu.x, muzzle.y - camEnu.y);
    if (k.launch === 'rocket' || k.launch === 'missile') {
      // Ignición seca + rugido largo del motor que se aleja.
      this.audio.boom('muzzle', dist, c, 0.7 * k.launchScale, az);
      this.audio.launchRoar(dist, c, this.weapon.round.motor.burnTime, k.launchScale, az, k.launch === 'missile');
    } else if (k.launch === 'smallArms') {
      this.audio.boom('rifle', dist, c, 0.5 * k.launchScale, az);
    } else {
      this.audio.boom('muzzle', dist, c, k.launch === 'mortar' ? 0.7 * k.launchScale : k.launchScale * (k.launch === 'heavy' ? 1.25 : 1), az);
    }
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
    this.shock.set(this.mesh.position, ProjectilePresenter.DOWN, 0);
    this.trail.finish();
    this.audio.whistleStop(this);

    this.vfx.structureExplosion(point, this.yieldScale);
    const camEnu = this.overlay.cameraEnu(this.camV);
    const dist = camEnu.distanceTo(this.tmpV.set(point.x, point.y, point.z));
    this.audio.boom(
      'impact', dist, this.service.soundSpeedAt(point.z), this.yieldScale,
      azimuthDegOf(point.x - camEnu.x, point.y - camEnu.y),
    );
    if (this.flight.warheadTNTeq >= 0.05) {
      toast(`🏢 Impacto en estructura a ${missM.toFixed(0)} m del objetivo`);
    }

    const s = this.evaluateInto(Math.min(this.elapsed, this.flightDuration), this.sample);
    const impactSpeed = Math.hypot(s.vx, s.vy, s.vz);
    this.onImpact?.(point, this.yieldScale, impactSpeed);
    this.disposeAt = performance.now() / 1000 + 6.0;
  }

  private handleImpact(): void {
    this.impacted = true;
    const impact = this.flight.impactPoint;
    this.mesh.visible = false;
    this.shock.set(this.mesh.position, ProjectilePresenter.DOWN, 0);
    this.trail.finish();
    this.audio.whistleStop(this); // P-VIVO.1 — el silbido muere con el impacto

    const camEnu = this.overlay.cameraEnu(this.camV);
    const dist = camEnu.distanceTo(this.tmpV.set(impact.x, impact.y, impact.z));
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
      // V2 — la espoleta decide la forma: suelo, aérea (cono de metralla
      // hacia abajo, sin cráter) o retardo (géiser de tierra).
      if (this.weapon.category === 'SmallArms' || this.flight.warheadTNTeq < 0.05) {
        // Bala: chispa/polvo de impacto mínimo (sin carga explosiva).
        this.vfx.bulletImpact(impact, this.weapon.round.diameter);
      } else {
        this.vfx.impactExplosion(impact, this.yieldScale, {
          detonation: this.flight.detonation,
          burstHeightM: this.flight.burstHeightM,
        });
      }
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
        const buried = this.flight.detonation === 'buried';
        this.service
          .visualGroundZ(impact)
          .then((z) => craters.add(z !== null ? new Vec3(impact.x, impact.y, z) : impact, yieldEq, buried))
          .catch(() => craters.add(impact, yieldEq, buried));
      }
      if (this.weapon.category === 'SmallArms') {
        this.audio.boom('rifle', dist, this.service.soundSpeedAt(impact.z), 0.12, azFromCam);
      } else {
        this.audio.boom(
          'impact', dist, this.service.soundSpeedAt(impact.z),
          this.flight.detonation === 'buried' ? this.yieldScale * 0.7 : this.yieldScale, azFromCam,
        );
      }
    }

    this.onImpact?.(impact, this.yieldScale, this.flight.impactSpeed);
    this.disposeAt = performance.now() / 1000 + 6.0; // deja asentarse humo/cámara
  }

  dispose(): void {
    // Sin esto la estela queda ZOMBI: TrailFX.update devuelve true mientras
    // no esté "dead", así que una evicción FIFO en ráfagas largas acumulaba
    // efectos inmortales (y el glow del motor colgado en el aire).
    this.trail.finish();
    this.audio.whistleStop(this);
    if (this.hooked) {
      this.overlay.removeRenderHook(this);
      this.hooked = false;
    }
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
