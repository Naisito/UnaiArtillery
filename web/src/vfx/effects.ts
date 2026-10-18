// ============================================================================
//  effects.ts — Suite VFX realista sobre partículas GPU.  [P-WEB.5 → V2]
//
//  Todo escala FÍSICAMENTE: el calibre/arma fija la firma de boca y el
//  rendimiento de la carga (kg TNT eq.) la detonación vía yield^(1/3)
//  (s = 1 para la granada de 155 mm de 6.6 kg). Tiempos y tamaños
//  plausibles: un fogonazo dura decenas de ms, la bola de fuego de 155 mm
//  ~0.3 s y ~6-8 m, el penacho de tierra sube 30-50 m y la columna de humo
//  oscuro asciende y DERIVA con el viento real del servicio durante 10-20 s.
//
//  Firmas de lanzamiento (launchSignature, por tipo):
//    howitzer  — freno de boca de doble deflector: chorros de llama y humo
//                LATERALES, fogonazo secundario, anillo de polvo en el suelo
//                y nube de humo de propulsante que tapa la pieza.
//    heavy     — 2S7 (203 mm, sin freno): bola de fuego frontal enorme.
//    mortar    — bocanada vertical y polvo en la placa base.
//    rocket /  — destello de ignición, rebufo que levanta una nube enorme de
//    missile     polvo/humo alrededor del lanzador (y luego el penacho y la
//                estela persistente en TrailFX).
//    smallArms — fogonazo diminuto en estrella y un hilo de humo.
//  Detonaciones (impactExplosion): flash → bola de fuego → humo oscuro con
//  calor incandescente que asciende → penacho de tierra (eyección) → falda
//  de polvo color tierra → terrones balísticos instanciados → metralla
//  incandescente → anillo de choque; nube de Wilson solo con rendimientos
//  grandes (≥ ~100 kg). Espoleta aérea: bocanada negra en altura + cono de
//  metralla hacia ABAJO + salpicaduras de polvo en el suelo, sin cráter.
//  Espoleta de retardo: géiser de tierra oscuro, fogonazo ahogado.
//  Agua, bengala ILLUM (luz real + charco de luz en el suelo) y cortina SMOKE
//  densa y persistente.
//
//  Rendimiento: 4 draw calls para todos los VFX (humo, aditivo, planos,
//  terrones) sin importar cuántas explosiones haya; luces dinámicas en el
//  pool fijo del overlay; cero asignaciones en el bucle por frame.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from '../ballistics/Vec3';
import { getGlowAtlas, getGlowTexture, getRingAtlas, getSmokeAtlas, makeGlowSprite } from '../render/PostFX';
import { getActiveOverlay, type RenderHook } from '../render/ThreeOverlay';
import { getQualityProfile } from '../render/quality';
import { FlareKinematics } from './flare';
import {
  DebrisSystem, EMIT, ParticleSystem, WindCache, type DynLight, type RenderCtx,
} from './particles';

/** Un efecto vivo. update() devuelve false cuando ha muerto. */
export interface Effect {
  update(dt: number, camEnu: THREE.Vector3): boolean;
  dispose(): void;
  /** Luces dinámicas que aporta este frame (opcional). */
  collectLights?(out: DynLight[]): void;
  /** Preparación de render (oclusión de sprites propios, opcional). */
  prepare?(ctx: RenderCtx): void;
}

type WindFn = (posEnu: Vec3) => Vec3;

export type LaunchKind = 'howitzer' | 'heavy' | 'mortar' | 'rocket' | 'missile' | 'smallArms';
export type TrailKind = 'shell' | 'baseBleed' | 'rap' | 'rocket' | 'missile' | 'bullet' | 'none';
export type Detonation = 'ground' | 'air' | 'buried';

export interface ExplosionOptions {
  detonation?: Detonation;
  /** Altura de la detonación sobre el suelo (espoleta aérea). */
  burstHeightM?: number;
  /** Sin suelo debajo (fachada de un edificio). */
  noGround?: boolean;
}

/** Sistemas compartidos por todos los efectos. */
interface Fx {
  smoke: ParticleSystem;
  glow: ParticleSystem;
  flat: ParticleSystem;
  flatGlow: ParticleSystem;
  debris: DebrisSystem;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/** Nº de partículas escalado por la calidad (mínimo 1 si count > 0). */
function n(count: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.round(count * getQualityProfile().particleDensity));
}

// ---------------------------------------------------------------------------
//  Luz pulsada (fogonazo / bola de fuego): ataque instantáneo, caída rápida.
// ---------------------------------------------------------------------------
class LightPulse implements Effect {
  private readonly light: DynLight;
  private age = 0;

  constructor(
    x: number, y: number, z: number, color: number,
    private readonly peak: number,
    radius: number,
    private readonly decayS: number,
    private readonly delayS = 0,
  ) {
    this.light = {
      x, y, z,
      r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255,
      intensity: 0, radius,
    };
  }

  update(dt: number): boolean {
    this.age += dt;
    const t = this.age - this.delayS;
    if (t < 0) return true;
    const k = Math.exp(-t / this.decayS);
    // Parpadeo leve: el fuego no es una bombilla.
    this.light.intensity = this.peak * k * (0.85 + 0.15 * Math.random());
    return k > 0.02;
  }

  collectLights(out: DynLight[]): void {
    if (this.light.intensity > 0.01) out.push(this.light);
  }

  dispose(): void { /* nada propio */ }
}

// ---------------------------------------------------------------------------
//  Línea de tiempo: emisiones diferidas de una explosión (sin asignar por frame).
// ---------------------------------------------------------------------------
class Timeline implements Effect {
  private age = 0;
  private idx = 0;
  constructor(private readonly steps: { t: number; fn: () => void }[]) {
    steps.sort((a, b) => a.t - b.t);
  }
  update(dt: number): boolean {
    this.age += dt;
    while (this.idx < this.steps.length && this.steps[this.idx].t <= this.age) {
      this.steps[this.idx].fn();
      this.idx++;
    }
    return this.idx < this.steps.length;
  }
  dispose(): void { /* nada propio */ }
}

// ---------------------------------------------------------------------------
//  Estela del proyectil: vapor transónico, base bleed, RAP, penacho y humo
//  persistente de cohetes/misiles, trazadoras de armas ligeras.
// ---------------------------------------------------------------------------
export class TrailFX implements Effect {
  /** P-VIVO.2 — duración del trazador: la composición pirotécnica se consume. */
  static readonly TRACER_BURNOUT_S = 3.5;

  private kind: TrailKind = 'shell';
  private scale = 1;
  private dead = false;
  private tracer = false;
  private tracerAge = 0;
  private thrusting = false;
  private readonly last = new THREE.Vector3();
  private hasLast = false;
  private distAcc = 0;
  private rateAcc = 0;
  private time = 0;
  private readonly light: DynLight = { x: 0, y: 0, z: 0, r: 1, g: 0.62, b: 0.3, intensity: 0, radius: 60 };
  private readonly dir = new THREE.Vector3(0, 0, 1);
  private speed = 0;

  constructor(private readonly fx: Fx) {}

  /** V2 — tipo de estela y escala (diámetro relativo a 227 mm para cohetes). */
  configure(kind: TrailKind, scale = 1): void {
    this.kind = kind;
    this.scale = scale;
  }

  /** P-VIVO.2 — variante trazadora: línea aditiva rojo-anaranjada SIEMPRE
   *  visible (no depende de Mach) hasta consumirse a los ~3.5 s.
   *  P-VIVO.4 — `initialAgeS`: en un tramo de rebote el trazador ya llevaba
   *  ardiendo el tiempo del tramo anterior. */
  setTracer(on: boolean, initialAgeS = 0): void {
    this.tracer = on;
    this.tracerAge = initialAgeS;
    if (on) this.kind = 'bullet';
  }

  /** Alimentar cada frame desde el presentador (P4.1: parámetros físicos). */
  feed(
    dt: number,
    pos: THREE.Vector3,
    mach: number,
    altitudeM: number,
    thrusting: boolean,
    vel?: THREE.Vector3,
  ): void {
    if (this.dead || dt <= 0) return;
    this.time += dt;
    this.thrusting = thrusting;
    if (vel) {
      this.speed = vel.length();
      if (this.speed > 1e-3) this.dir.copy(vel).multiplyScalar(1 / this.speed);
    }
    const fromX = this.hasLast ? this.last.x : pos.x;
    const fromY = this.hasLast ? this.last.y : pos.y;
    const fromZ = this.hasLast ? this.last.z : pos.z;
    const seg = this.hasLast ? Math.hypot(pos.x - fromX, pos.y - fromY, pos.z - fromZ) : 0;
    this.last.copy(pos);
    this.hasLast = true;

    switch (this.kind) {
      case 'bullet': this.feedTracer(dt, pos, vel); break;
      case 'rocket':
      case 'missile':
      case 'rap':
        if (thrusting) this.feedMotor(dt, pos, fromX, fromY, fromZ, seg, altitudeM);
        else this.light.intensity = 0;
        break;
      case 'baseBleed':
        if (thrusting) this.feedSmokeLine(pos, fromX, fromY, fromZ, seg, 6, 0.55, 0x9c9a95, 0.28, 10);
        this.feedVapor(dt, pos, mach, altitudeM);
        break;
      case 'shell': this.feedVapor(dt, pos, mach, altitudeM); break;
      default: break;
    }
  }

  /** Trazadora: un trazo aditivo estirado por la velocidad cada frame. */
  private feedTracer(dt: number, pos: THREE.Vector3, vel?: THREE.Vector3): void {
    if (!this.tracer) return;
    this.tracerAge += dt;
    if (this.tracerAge > TrailFX.TRACER_BURNOUT_S) return; // consumida
    const fade = 1 - Math.max(0, (this.tracerAge - TrailFX.TRACER_BURNOUT_S + 0.6) / 0.6);
    const e = EMIT.reset();
    e.x = pos.x; e.y = pos.y; e.z = pos.z;
    if (vel) { e.vx = vel.x; e.vy = vel.y; e.vz = vel.z; }
    e.life = Math.max(0.035, dt * 1.6);
    e.size = 0.55 * this.scale;
    e.stretch = Math.max(0.018, dt * 1.1);
    e.variant = 2;
    e.color(0xff7030);
    e.alpha = 0.95 * fade;
    e.fadeIn = 0.001;
    e.fadeOut = 0.5;
    e.drag = 0; e.wind = 0;
    e.heat = 0.8;
    this.fx.glow.emit(e);
    // Halo blando alrededor de la cabeza (se lee a distancia).
    const h = EMIT.reset();
    h.x = pos.x; h.y = pos.y; h.z = pos.z;
    h.life = Math.max(0.03, dt * 1.2);
    h.size = 1.6 * this.scale;
    h.variant = 0;
    h.color(0xff5a20);
    h.alpha = 0.5 * fade;
    h.fadeIn = 0.001;
    h.drag = 0; h.wind = 0;
    this.fx.glow.emit(h);
  }

  /** Motor encendido: penacho parpadeante + humo persistente + luz. */
  private feedMotor(
    dt: number, pos: THREE.Vector3, fx0: number, fy0: number, fz0: number, seg: number, alt: number,
  ): void {
    const s = this.scale;
    const missile = this.kind === 'missile';
    const rap = this.kind === 'rap';
    const plume = rap ? 0.45 : missile ? 1.5 : 1.0;
    const d = this.dir;
    const v = this.speed;
    // Penacho: llamas que viajan casi con el cohete (estiradas).
    const nFlame = rap ? 1 : 3;
    for (let i = 0; i < nFlame; i++) {
      const e = EMIT.reset();
      const back = (0.6 + i * 1.1) * s * plume;
      e.x = pos.x - d.x * back; e.y = pos.y - d.y * back; e.z = pos.z - d.z * back;
      const k = 0.82 - i * 0.06;
      e.vx = d.x * v * k; e.vy = d.y * v * k; e.vz = d.z * v * k;
      e.life = rnd(0.05, 0.09);
      e.size = rnd(1.0, 1.8) * s * plume;
      e.stretch = v > 30 ? 0.012 : 0;
      e.variant = 1;
      e.color(0xfff0c0).colorEnd(0xff5a10, 0.07);
      e.alpha = 0.95;
      e.fadeIn = 0.005;
      e.fadeOut = 0.2;
      e.drag = 0; e.wind = 0;
      e.heat = 1;
      this.fx.glow.emit(e);
    }
    // Núcleo cegador en la tobera.
    const c = EMIT.reset();
    c.x = pos.x - d.x * 0.3 * s; c.y = pos.y - d.y * 0.3 * s; c.z = pos.z - d.z * 0.3 * s;
    c.vx = d.x * v; c.vy = d.y * v; c.vz = d.z * v;
    c.life = 0.04;
    c.size = 2.6 * s * plume * (0.85 + 0.3 * Math.random());
    c.variant = 0;
    c.color(0xfff6e0);
    c.alpha = 1;
    c.fadeIn = 0.002;
    c.drag = 0; c.wind = 0;
    c.heat = 1;
    this.fx.glow.emit(c);

    // Luz del penacho (ilumina humo y terreno Three cercano).
    this.light.x = pos.x; this.light.y = pos.y; this.light.z = pos.z;
    this.light.intensity = (rap ? 3 : missile ? 9 : 6) * (0.8 + 0.4 * Math.random());
    this.light.radius = (rap ? 30 : missile ? 140 : 90) * s;

    // Humo blanco-grisáceo, denso, que PERSISTE y deriva con el viento real.
    const thin = Math.max(0.25, 1 - alt / 16000); // aire fino = estela menos densa
    if (rap) {
      this.feedSmokeLine(pos, fx0, fy0, fz0, seg, 5, 0.7, 0xb5b3ae, 0.35 * thin, 8);
    } else {
      const spacing = (missile ? 3.5 : 3) * s + v * 0.018;
      this.feedSmokeLine(pos, fx0, fy0, fz0, seg, spacing, (missile ? 2.4 : 1.7) * s, 0xe4e3df, 0.62 * thin,
        missile ? 40 : 30);
    }
    void dt;
  }

  /** Emisión por DISTANCIA a lo largo del segmento recorrido (sin huecos). */
  private feedSmokeLine(
    pos: THREE.Vector3, fx0: number, fy0: number, fz0: number, seg: number,
    spacing: number, size: number, color: number, alpha: number, life: number,
  ): void {
    if (seg <= 0) return;
    const sys = this.fx.smoke;
    // Si el sistema va lleno, la estela se espacia (degradación suave).
    const fill = sys.count / sys.capacity;
    const sp = spacing * (fill > 0.6 ? 1 + (fill - 0.6) * 6 : 1) / Math.max(0.3, getQualityProfile().particleDensity);
    this.distAcc += seg;
    let emitted = 0;
    while (this.distAcc >= sp && emitted < 48) {
      this.distAcc -= sp;
      const f = 1 - this.distAcc / Math.max(seg, 1e-6);
      const e = EMIT.reset();
      e.x = fx0 + (pos.x - fx0) * f + rnd(-0.3, 0.3) * size;
      e.y = fy0 + (pos.y - fy0) * f + rnd(-0.3, 0.3) * size;
      e.z = fz0 + (pos.z - fz0) * f + rnd(-0.3, 0.3) * size;
      // El gas sale hacia atrás y se frena enseguida: casi en reposo.
      e.vx = -this.dir.x * 6 + rnd(-1.5, 1.5);
      e.vy = -this.dir.y * 6 + rnd(-1.5, 1.5);
      e.vz = -this.dir.z * 6 + rnd(-1.5, 1.5);
      e.life = life * rnd(0.8, 1.2);
      e.size = Math.max(size, sp * 0.9);
      e.grow = size * 1.1;
      e.growTau = life * 0.35;
      e.color(color);
      e.alpha = alpha;
      e.fadeIn = 0.15;
      e.fadeOut = 0.3;
      e.gravity = -0.05;
      e.drag = 0.5;
      e.heat = this.thrusting && this.kind !== 'baseBleed' ? 0.35 : 0;
      e.heatTau = 0.12;
      sys.emit(e);
      emitted++;
    }
    if (emitted >= 48) this.distAcc = 0;
  }

  /** Vapor de condensación tenue en la banda transónica. */
  private feedVapor(dt: number, pos: THREE.Vector3, mach: number, altitudeM: number): void {
    const transonic = Math.max(0, 1 - Math.abs(mach - 1.0) / 0.3);
    if (transonic <= 0) return;
    const densityFade = Math.max(0.15, Math.exp(-altitudeM / 9000));
    this.rateAcc += 26 * transonic * densityFade * dt;
    while (this.rateAcc >= 1) {
      this.rateAcc -= 1;
      const e = EMIT.reset();
      e.x = pos.x; e.y = pos.y; e.z = pos.z;
      e.vx = rnd(-1, 1); e.vy = rnd(-1, 1); e.vz = rnd(-1, 1);
      e.life = 1.6;
      e.size = 1.4 * this.scale;
      e.grow = 2.2;
      e.growTau = 1.2;
      e.color(0xf2f5fa);
      e.alpha = 0.16 * transonic * densityFade + 0.04;
      e.fadeIn = 0.05;
      e.drag = 1.2;
      e.lit = 0.6;
      this.fx.smoke.emit(e);
    }
  }

  /** El proyectil impactó: deja de emitir (lo emitido sigue su vida). */
  finish(): void {
    this.dead = true;
    this.light.intensity = 0;
  }

  update(): boolean {
    return !this.dead;
  }

  collectLights(out: DynLight[]): void {
    if (!this.dead && this.thrusting && this.light.intensity > 0.01) out.push(this.light);
  }

  dispose(): void { this.dead = true; }
}

// ---------------------------------------------------------------------------
//  Cono de choque: apenas un brillo de refracción cerca de la cámara (en la
//  realidad no se ve; el cono marcado de antes parecía de dibujos animados).
// ---------------------------------------------------------------------------
export class ShockConeFX {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private static readonly AXIS = new THREE.Vector3(0, 0, -1);

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.ConeGeometry(1.6, 7, 20, 1, true);
    geo.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xbfe4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** shock 0..1 (mapeado de Mach 0.9..1.5). `camDist` atenúa a distancia. */
  set(pos: THREE.Vector3, velDir: THREE.Vector3, shock: number, camDist = 0): void {
    this.mesh.position.copy(pos);
    if (velDir.lengthSq() > 1e-9) this.mesh.quaternion.setFromUnitVectors(ShockConeFX.AXIS, velDir);
    const near = camDist > 0 ? Math.max(0, 1 - camDist / 350) : 1;
    this.mat.opacity = 0.06 * shock * near;
    this.mesh.visible = this.mat.opacity > 0.004;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
//  P-VIVO.8 — Bengala ILLUM bajo paracaídas (cinemática pura en flare.ts).
//  V2: luz del POOL dinámico (antes una PointLight propia que recompilaba
//  materiales), charco de luz PLANO sobre el suelo y hilo de humo blanco.
// ---------------------------------------------------------------------------
export class FlareFX implements Effect {
  private readonly kin: FlareKinematics;
  private readonly glow: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly light: DynLight = { x: 0, y: 0, z: 0, r: 1, g: 0.93, b: 0.78, intensity: 0, radius: 900 };
  private age = 0;
  private smokeAcc = 0;
  private vis = 1;
  private visT = 1;
  private intensity = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    startEnu: Vec3,
    private readonly groundZ: number,
    wind: WindFn,
    private readonly fx: Fx,
  ) {
    this.kin = new FlareKinematics(
      { x: startEnu.x, y: startEnu.y, z: startEnu.z },
      (z) => {
        const w = wind(new Vec3(startEnu.x, startEnu.y, z));
        return { x: w.x, y: w.y };
      },
    );
    this.glow = makeGlowSprite(0xfff4dc, 14);
    this.halo = makeGlowSprite(0xffe2a8, 70);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: getGlowTexture(),
      color: 0xffe9c2,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.poolMat);
    parent.add(this.glow, this.halo, this.pool);
  }

  update(dt: number): boolean {
    this.age += dt;
    const p = this.kin.at(this.age);
    if (!p.alive) return false;
    const flicker =
      0.82 + 0.12 * Math.sin(this.age * 23.0) + 0.06 * Math.sin(this.age * 7.7) +
      0.05 * (Math.random() - 0.5);
    const k = p.intensity * flicker;
    this.intensity = k;
    this.glow.position.set(p.x, p.y, p.z);
    this.halo.position.set(p.x, p.y, p.z);
    this.light.x = p.x; this.light.y = p.y; this.light.z = p.z;
    this.light.intensity = 5 * k;
    // Charco de luz: radio ~ altura (cono de iluminación útil de la bengala).
    const height = Math.max(10, p.z - this.groundZ);
    this.pool.position.set(p.x, p.y, this.groundZ + 1.0);
    this.pool.scale.setScalar(Math.min(1100, Math.max(120, height * 1.6)));
    this.poolMat.opacity = 0.2 * k * Math.min(1, 900 / height);

    // Hilo de humo de la composición iluminante (sube y deriva).
    this.smokeAcc += dt * 5;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const e = EMIT.reset();
      e.x = p.x; e.y = p.y; e.z = p.z + 1;
      e.vz = 1.5;
      e.life = 9;
      e.size = 1.5;
      e.grow = 2.5;
      e.growTau = 4;
      e.color(0xe8e6e0);
      e.alpha = 0.32 * p.intensity;
      e.drag = 0.7;
      e.heat = 1.2;
      e.heatTau = 0.15;
      this.fx.smoke.emit(e);
    }
    return true;
  }

  prepare(ctx: RenderCtx): void {
    if (ctx.occlusionFresh && ctx.occlusion) {
      const v = ctx.occlusion.test(this.glow.position.x, this.glow.position.y, this.glow.position.z, 3);
      if (v >= 0) this.visT = v;
    }
    this.vis += (this.visT - this.vis) * (1 - Math.exp(-ctx.dt * 8));
    (this.glow.material as THREE.SpriteMaterial).opacity = this.intensity * this.vis;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.32 * this.intensity * this.vis;
  }

  collectLights(out: DynLight[]): void {
    if (this.light.intensity > 0.01) out.push(this.light);
  }

  dispose(): void {
    this.parent.remove(this.glow, this.halo, this.pool);
    this.glow.material.dispose();
    this.halo.material.dispose();
    this.pool.geometry.dispose();
    this.poolMat.dispose();
  }
}

// ---------------------------------------------------------------------------
//  P-VIVO.8 — Cortina de humo SMOKE: fuentes en línea perpendicular al rumbo
//  (cuñas de fieltro ardiendo en el suelo) que emiten sin parar ~90 s;
//  préstamos sticky (una ráfaga no puede robar la cortina).
// ---------------------------------------------------------------------------
export class SmokeScreenFX implements Effect {
  static readonly LIFE_S = 90;

  private readonly anchors: { x: number; y: number; z: number; phase: number }[] = [];
  private age = 0;
  private acc = 0;

  constructor(
    centerEnu: Vec3,
    bearingDeg: number,
    private readonly fx: Fx,
    yieldScale = 1,
  ) {
    const az = (bearingDeg * Math.PI) / 180;
    const perp = { x: Math.cos(az), y: -Math.sin(az) };
    const along = { x: Math.sin(az), y: Math.cos(az) };
    const nSrc = 7;
    for (let i = 0; i < nSrc; i++) {
      const t = (i - (nSrc - 1) / 2) * 17 * Math.max(0.7, yieldScale);
      const a = rnd(-12, 12); // dispersión de las cuñas a lo largo del rumbo
      this.anchors.push({
        x: centerEnu.x + perp.x * t + along.x * a,
        y: centerEnu.y + perp.y * t + along.y * a,
        z: centerEnu.z,
        phase: Math.random(),
      });
    }
    // Estallido inicial: la carga expulsora siembra la cortina de golpe.
    for (const a of this.anchors) for (let k = 0; k < n(3); k++) this.puff(a, true);
  }

  private puff(a: { x: number; y: number; z: number }, burst: boolean): void {
    const e = EMIT.reset();
    e.x = a.x + rnd(-4, 4); e.y = a.y + rnd(-4, 4); e.z = a.z + rnd(0.5, 3);
    e.vx = rnd(-1, 1) * (burst ? 4 : 1);
    e.vy = rnd(-1, 1) * (burst ? 4 : 1);
    e.vz = rnd(0.8, 2.2);
    e.life = rnd(22, 30);
    e.size = rnd(5, 8);
    e.grow = 4.5;
    e.growTau = 9;
    e.color(0xdedfdd);
    e.alpha = rnd(0.55, 0.75);
    e.fadeIn = 1.2;
    e.fadeOut = 0.45;
    e.gravity = -0.08;
    e.drag = 0.6;
    e.sticky = true;
    this.fx.smoke.emit(e);
  }

  update(dt: number): boolean {
    this.age += dt;
    if (this.age < SmokeScreenFX.LIFE_S) {
      // Cada fuente ~1.1 bocanadas/s; se agotan al final (la cuña se apaga).
      const strength = this.age > SmokeScreenFX.LIFE_S - 15 ? (SmokeScreenFX.LIFE_S - this.age) / 15 : 1;
      this.acc += dt * 1.1 * strength * getQualityProfile().particleDensity;
      while (this.acc >= 1) {
        this.acc -= 1;
        for (const a of this.anchors) this.puff(a, false);
      }
    }
    return this.age < SmokeScreenFX.LIFE_S;
  }

  dispose(): void { /* las partículas viven en el sistema */ }
}

/** Último gestor creado (para puffPoolStats, compatibilidad P-PRO.8). */
let lastManager: VfxManager | null = null;

// ---------------------------------------------------------------------------
//  Gestor: sistemas compartidos, efectos vivos y "spawners".
// ---------------------------------------------------------------------------
export class VfxManager implements RenderHook {
  private effects: Effect[] = [];
  private readonly fx: Fx;
  private readonly wind: WindCache;
  private readonly tmpLight: DynLight[] = [];

  constructor(
    readonly root: THREE.Object3D,
    private readonly windFn: WindFn,
  ) {
    const probe = new Vec3(0, 0, 0);
    this.wind = new WindCache((z) => {
      const w = windFn(new Vec3(probe.x, probe.y, z));
      return { x: w.x, y: w.y, z: w.z };
    });
    this.fx = {
      smoke: new ParticleSystem(root, 'smoke', 4096, getSmokeAtlas(), this.wind),
      glow: new ParticleSystem(root, 'glow', 3072, getGlowAtlas(), this.wind),
      flat: new ParticleSystem(root, 'smoke', 128, getRingAtlas(), this.wind),
      flatGlow: new ParticleSystem(root, 'glow', 64, getRingAtlas(), this.wind),
      debris: new DebrisSystem(root, 900),
    };
    // Se registra solo en el overlay vivo (oclusión, luces, subida a GPU).
    getActiveOverlay()?.addRenderHook(this);
    lastManager = this;
  }

  /** Partículas vivas (para estadísticas). */
  get particleCount(): number {
    const f = this.fx;
    return f.smoke.count + f.glow.count + f.flat.count + f.flatGlow.count + f.debris.count;
  }

  get effectCount(): number { return this.effects.length; }

  /** Escala de tiempo de los VFX (0 = congelados: inspección/capturas). */
  timeScale = 1;
  /** Tiempo simulado acumulado de los VFX (s). */
  simTime = 0;
  /** Congela los VFX al alcanzar este tiempo simulado (capturas deterministas). */
  pauseAt = Number.POSITIVE_INFINITY;

  update(dtWall: number, camEnu: THREE.Vector3): void {
    let dt = dtWall * this.timeScale;
    if (this.simTime + dt >= this.pauseAt) {
      dt = Math.max(0, this.pauseAt - this.simTime);
      this.timeScale = 0;
      this.pauseAt = Number.POSITIVE_INFINITY;
    }
    this.simTime += dt;
    if (dt <= 0) return;
    this.wind.tick(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(dt, camEnu)) {
        this.effects[i].dispose();
        this.effects.splice(i, 1);
      }
    }
    const f = this.fx;
    f.smoke.update(dt);
    f.glow.update(dt);
    f.flat.update(dt);
    f.flatGlow.update(dt);
    f.debris.update(dt);
  }

  // --- RenderHook ------------------------------------------------------------
  collectLights(out: DynLight[]): void {
    for (let i = 0; i < this.effects.length; i++) this.effects[i].collectLights?.(out);
  }

  prepare(ctx: RenderCtx): boolean {
    for (let i = 0; i < this.effects.length; i++) this.effects[i].prepare?.(ctx);
    const f = this.fx;
    let v = f.smoke.prepare(ctx);
    v = f.glow.prepare(ctx) || v;
    v = f.flat.prepare(ctx) || v;
    v = f.flatGlow.prepare(ctx) || v;
    v = f.debris.prepare(ctx) || v;
    void this.tmpLight;
    return v;
  }

  // ---------------------------------------------------------------------------
  //  Firmas de lanzamiento.
  // ---------------------------------------------------------------------------
  /**
   * Fogonazo + humo + polvo del disparo. `kind` (V2) elige la firma física;
   * sin él se deduce de `scale` (compatibilidad: obús).
   */
  launchSignature(
    muzzleEnu: Vec3, dirEnu: Vec3, airDensity: number, scale = 1, kind: LaunchKind = 'howitzer',
  ): void {
    const len = Math.hypot(dirEnu.x, dirEnu.y, dirEnu.z) || 1;
    const dx = dirEnu.x / len, dy = dirEnu.y / len, dz = dirEnu.z / len;
    const rho = airDensity / 1.225;
    switch (kind) {
      case 'mortar': this.mortarBlast(muzzleEnu, dx, dy, dz, rho, scale); break;
      case 'rocket':
      case 'missile': this.rocketLaunch(muzzleEnu, dx, dy, dz, scale, kind === 'missile'); break;
      case 'smallArms': this.smallArmsFlash(muzzleEnu, dx, dy, dz, scale); break;
      default: this.gunBlast(muzzleEnu, dx, dy, dz, rho, scale, kind === 'heavy'); break;
    }
  }

  /** Obús con freno de boca (o 2S7 sin freno: `heavy`). */
  private gunBlast(m: Vec3, dx: number, dy: number, dz: number, rho: number, s: number, heavy: boolean): void {
    const fx = this.fx;
    // Lateral horizontal del tubo (para los chorros del freno de boca).
    let rx = dy, ry = -dx;
    const rl = Math.hypot(rx, ry) || 1;
    rx /= rl; ry /= rl;
    const big = heavy ? 1.7 : 1;

    // 1) Destello primario en estrella (decenas de ms).
    let e = EMIT.reset();
    e.x = m.x + dx * 1.2 * s; e.y = m.y + dy * 1.2 * s; e.z = m.z + dz * 1.2 * s;
    e.life = 0.07; e.size = 5.5 * s * big; e.variant = 3; e.rot = Math.random() * TAU;
    e.color(0xfff4d8); e.alpha = 1; e.fadeIn = 0.001; e.fadeOut = 0.1; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    // 2) Fogonazo secundario: gases del propulsante ardiendo al mezclarse
    //    con el aire, delante de la boca (más grande y anaranjado).
    const nF = heavy ? 7 : 4;
    for (let i = 0; i < nF; i++) {
      const along = (1.5 + i * (heavy ? 2.2 : 1.4)) * s;
      e = EMIT.reset();
      e.x = m.x + dx * along + rnd(-0.5, 0.5) * s;
      e.y = m.y + dy * along + rnd(-0.5, 0.5) * s;
      e.z = m.z + dz * along + rnd(-0.5, 0.5) * s;
      e.vx = dx * 30 * s; e.vy = dy * 30 * s; e.vz = dz * 30 * s;
      e.life = rnd(0.09, 0.16) * big;
      e.size = rnd(2.6, 4.2) * s * big * (1 - i * 0.06);
      e.grow = 14 * s; e.growTau = 0.06;
      e.variant = 1;
      e.color(0xffd890).colorEnd(0xff4a0c, 0.1);
      e.alpha = 0.9; e.fadeIn = 0.004; e.fadeOut = 0.15; e.drag = 6; e.wind = 0; e.heat = 1;
      fx.glow.emit(e);
    }
    // 3) Chorros laterales del freno de boca (doble deflector): llama + humo.
    if (!heavy) {
      for (const side of [1, -1]) {
        const sx = rx * side * 0.92 - dx * 0.3, sy = ry * side * 0.92 - dy * 0.3, sz = 0.1 - dz * 0.3;
        for (let i = 0; i < 3; i++) {
          e = EMIT.reset();
          const r = (0.8 + i * 1.1) * s;
          e.x = m.x + sx * r; e.y = m.y + sy * r; e.z = m.z + sz * r;
          e.vx = sx * 25; e.vy = sy * 25; e.vz = sz * 25;
          e.life = rnd(0.06, 0.11);
          e.size = rnd(1.8, 2.8) * s;
          e.grow = 10 * s; e.growTau = 0.05;
          e.variant = 1;
          e.color(0xffe0a0).colorEnd(0xff5010, 0.08);
          e.alpha = 0.85; e.fadeIn = 0.003; e.drag = 8; e.wind = 0; e.heat = 1;
          fx.glow.emit(e);
        }
        for (let i = 0; i < n(7); i++) {
          e = EMIT.reset();
          e.x = m.x + sx * 1.2 * s; e.y = m.y + sy * 1.2 * s; e.z = m.z + sz * 1.2 * s;
          const sp = rnd(18, 36);
          e.vx = sx * sp + rnd(-3, 3); e.vy = sy * sp + rnd(-3, 3); e.vz = sz * sp + rnd(-1, 3);
          e.life = rnd(4, 7);
          e.size = rnd(1.6, 2.6) * s;
          e.grow = 3.5 * s; e.growTau = 1.4;
          e.color(0xcac7c0);
          e.alpha = 0.5 * Math.min(1.3, rho);
          e.fadeIn = 0.03; e.fadeOut = 0.25; e.gravity = -0.3; e.drag = 1.7;
          e.heat = 0.9; e.heatTau = 0.08;
          fx.smoke.emit(e);
        }
      }
    }
    // 4) Nube de humo de propulsante hacia delante (tapa la pieza un rato).
    const nSmoke = n((heavy ? 32 : 22) * Math.min(1.4, rho));
    for (let i = 0; i < nSmoke; i++) {
      e = EMIT.reset();
      const along = rnd(1.5, 4) * s;
      e.x = m.x + dx * along; e.y = m.y + dy * along; e.z = m.z + dz * along;
      const sp = rnd(14, heavy ? 55 : 40);
      e.vx = dx * sp + rnd(-4, 4); e.vy = dy * sp + rnd(-4, 4); e.vz = dz * sp + rnd(-2, 4);
      e.life = rnd(8, 13);
      e.size = rnd(3, 4.5) * s * big;
      e.grow = 6 * s * big; e.growTau = 2.2;
      e.color(0xc9c6bf);
      e.alpha = 0.62;
      e.fadeIn = 0.03; e.fadeOut = 0.3; e.gravity = -0.3; e.drag = 1.6;
      e.heat = 0.7; e.heatTau = 0.07;
      fx.smoke.emit(e);
    }
    // 5) Anillo de polvo levantado por la onda en el suelo bajo la boca.
    const gz = 0.3; // el arma está anclada al suelo del marco ENU
    const cx = m.x - dx * 1.5, cy = m.y - dy * 1.5;
    const nDust = n((heavy ? 30 : 20) * s);
    for (let i = 0; i < nDust; i++) {
      const a = (i / nDust) * TAU + rnd(-0.15, 0.15);
      // La onda sale sobre todo hacia delante y a los lados de la boca.
      const fwd = Math.max(0, Math.cos(a) * dx + Math.sin(a) * dy);
      const sp = rnd(10, 18) * (0.6 + 0.8 * fwd) * big;
      e = EMIT.reset();
      e.x = cx + Math.cos(a) * 2 * s; e.y = cy + Math.sin(a) * 2 * s; e.z = gz + rnd(0, 1);
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.vz = rnd(0.5, 2.5);
      e.life = rnd(3, 5);
      e.size = rnd(1.8, 3) * s;
      e.grow = 3.5 * s; e.growTau = 2;
      e.color(0xa99a80);
      e.alpha = 0.52;
      e.fadeIn = 0.04; e.fadeOut = 0.3; e.gravity = 0.4; e.drag = 1.5; e.ground = gz;
      fx.smoke.emit(e);
    }
    this.ring(cx, cy, gz + 0.2, 22 * s * big, 0.22, 0.3, 0xd6c8aa, 0);
    // 6) Chispas de propulsante sin quemar.
    for (let i = 0; i < n(8 * big); i++) {
      e = EMIT.reset();
      e.x = m.x + dx * s; e.y = m.y + dy * s; e.z = m.z + dz * s;
      const sp = rnd(70, 160);
      e.vx = dx * sp + rnd(-15, 15); e.vy = dy * sp + rnd(-15, 15); e.vz = dz * sp + rnd(-10, 15);
      e.life = rnd(0.15, 0.35);
      e.size = 0.25; e.stretch = 0.03; e.variant = 2;
      e.color(0xffb050); e.alpha = 0.9; e.fadeIn = 0.001; e.gravity = 9.8; e.drag = 0.6; e.wind = 0; e.heat = 0.8;
      fx.glow.emit(e);
    }
    this.effects.push(new LightPulse(m.x + dx * 3 * s, m.y + dy * 3 * s, m.z + dz * 3 * s,
      0xffc070, heavy ? 16 : 10, (heavy ? 110 : 70) * s, 0.06));
  }

  /** Mortero: bocanada vertical, fogonazo pequeño, polvo de placa base. */
  private mortarBlast(m: Vec3, dx: number, dy: number, dz: number, rho: number, s: number): void {
    const fx = this.fx;
    let e = EMIT.reset();
    e.x = m.x + dx * 0.6; e.y = m.y + dy * 0.6; e.z = m.z + dz * 0.6;
    e.life = 0.05; e.size = 2.4 * s; e.variant = 3;
    e.color(0xfff0d0); e.alpha = 0.95; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    for (let i = 0; i < 2; i++) {
      e = EMIT.reset();
      const a = 1 + i * 1.1;
      e.x = m.x + dx * a; e.y = m.y + dy * a; e.z = m.z + dz * a;
      e.vx = dx * 20; e.vy = dy * 20; e.vz = dz * 20;
      e.life = 0.08; e.size = 1.6 * s; e.grow = 8; e.growTau = 0.05; e.variant = 1;
      e.color(0xffd080).colorEnd(0xff5010, 0.06); e.alpha = 0.85; e.fadeIn = 0.003; e.drag = 6; e.wind = 0; e.heat = 1;
      fx.glow.emit(e);
    }
    for (let i = 0; i < n(9 * Math.min(1.3, rho)); i++) {
      e = EMIT.reset();
      e.x = m.x + dx * 0.8; e.y = m.y + dy * 0.8; e.z = m.z + dz * 0.8;
      const sp = rnd(8, 24);
      e.vx = dx * sp + rnd(-2, 2); e.vy = dy * sp + rnd(-2, 2); e.vz = dz * sp + rnd(-1, 2);
      e.life = rnd(4, 6.5);
      e.size = rnd(1.0, 1.6) * s; e.grow = 2.2; e.growTau = 1.6;
      e.color(0xbdbab3); e.alpha = 0.5; e.fadeIn = 0.03; e.gravity = -0.3; e.drag = 1.5;
      e.heat = 0.8; e.heatTau = 0.06;
      fx.smoke.emit(e);
    }
    // Polvo de la placa base (el retroceso va contra el suelo).
    for (let i = 0; i < n(10); i++) {
      const a = Math.random() * TAU;
      const sp = rnd(3, 8);
      e = EMIT.reset();
      e.x = Math.cos(a) * 0.6; e.y = Math.sin(a) * 0.6; e.z = 0.3;
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.vz = rnd(0.5, 2);
      e.life = rnd(2, 3.5); e.size = rnd(0.8, 1.4); e.grow = 1.6; e.growTau = 1.5;
      e.color(0xa59680); e.alpha = 0.4; e.gravity = 0.5; e.drag = 1.8; e.ground = 0.3;
      fx.smoke.emit(e);
    }
    this.ring(0, 0, 0.4, 8 * s, 0.2, 0.2, 0xd6c8aa, 0);
    this.effects.push(new LightPulse(m.x, m.y, m.z, 0xffc070, 5, 30 * s, 0.05));
  }

  /** Cohete/misil: ignición + rebufo que envuelve el lanzador en polvo. */
  private rocketLaunch(m: Vec3, dx: number, dy: number, dz: number, s: number, missile: boolean): void {
    const fx = this.fx;
    const big = missile ? 1.6 : 1;
    let e = EMIT.reset();
    e.x = m.x; e.y = m.y; e.z = m.z;
    e.life = 0.12; e.size = 7 * s * big; e.variant = 0;
    e.color(0xfff4dc); e.alpha = 1; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    // Rebufo: gases hacia atrás que chocan con el suelo y se expanden.
    const bx = -dx, by = -dy, bz = -dz;
    const nBack = n(40 * big);
    for (let i = 0; i < nBack; i++) {
      e = EMIT.reset();
      const r = rnd(1, 4) * s;
      e.x = m.x + bx * r + rnd(-1, 1); e.y = m.y + by * r + rnd(-1, 1); e.z = Math.max(0.5, m.z + bz * r);
      const sp = rnd(25, 60) * big;
      e.vx = bx * sp + rnd(-12, 12); e.vy = by * sp + rnd(-12, 12); e.vz = bz * sp + rnd(-2, 6);
      e.life = rnd(9, 15);
      e.size = rnd(2.5, 4.5) * s * big;
      e.grow = 5.5 * s * big; e.growTau = 2.6;
      // Mezcla de gases blancos del motor y polvo levantado.
      if (i % 3 === 0) e.color(0xa89878); else e.color(0xdcdad4);
      e.alpha = 0.6;
      e.fadeIn = 0.05; e.fadeOut = 0.35; e.gravity = -0.25; e.drag = 0.9; e.ground = 0.5;
      e.heat = i % 3 === 0 ? 0 : 1.2; e.heatTau = 0.12;
      fx.smoke.emit(e);
    }
    // Polvo radial a ras de suelo alrededor del lanzador.
    const nDust = n(26 * big);
    for (let i = 0; i < nDust; i++) {
      const a = (i / nDust) * TAU;
      const sp = rnd(12, 26) * big;
      e = EMIT.reset();
      e.x = Math.cos(a) * 3; e.y = Math.sin(a) * 3; e.z = 0.6;
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.vz = rnd(0.5, 3);
      e.life = rnd(6, 10); e.size = rnd(2.5, 4) * big; e.grow = 4 * big; e.growTau = 2.5;
      e.color(0xae9e82); e.alpha = 0.45; e.gravity = 0.25; e.drag = 1.2; e.ground = 0.5;
      fx.smoke.emit(e);
    }
    this.ring(0, 0, 0.5, 34 * big, 0.5, 0.3, 0xd8cab0, 3);
    this.effects.push(new LightPulse(m.x, m.y, m.z, 0xffd090, missile ? 18 : 12, (missile ? 160 : 110) * s, 0.35));
  }

  /** Armas ligeras: estrella diminuta y un hilo de humo. */
  private smallArmsFlash(m: Vec3, dx: number, dy: number, dz: number, s: number): void {
    const fx = this.fx;
    let e = EMIT.reset();
    e.x = m.x + dx * 0.15 * s; e.y = m.y + dy * 0.15 * s; e.z = m.z + dz * 0.15 * s;
    e.life = 0.035; e.size = 0.55 * s; e.variant = 3; e.rot = Math.random() * TAU;
    e.color(0xffe0a0); e.alpha = 1; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    e = EMIT.reset();
    e.x = m.x + dx * 0.4 * s; e.y = m.y + dy * 0.4 * s; e.z = m.z + dz * 0.4 * s;
    e.life = 0.04; e.size = 0.45 * s; e.variant = 1;
    e.color(0xffa040); e.alpha = 0.85; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    e = EMIT.reset();
    e.x = m.x + dx * 0.3; e.y = m.y + dy * 0.3; e.z = m.z + dz * 0.3;
    e.vx = dx * 4; e.vy = dy * 4; e.vz = dz * 4 + 0.4;
    e.life = 1.6; e.size = 0.25 * s; e.grow = 0.5; e.growTau = 1;
    e.color(0xcfccc6); e.alpha = 0.22; e.drag = 1.5;
    fx.smoke.emit(e);
    this.effects.push(new LightPulse(m.x, m.y, m.z, 0xffb060, 1.2, 6 * s, 0.03));
  }

  /**
   * P-VIVO.2 — firma de ráfaga compartida: 1 fogonazo + 1 bocanada por cada
   * 3 disparos (nada de humo individual: a 9 disparos/s saturaría).
   */
  burstFlash(muzzleEnu: Vec3, dirEnu: Vec3, scale = 0.6): void {
    const len = Math.hypot(dirEnu.x, dirEnu.y, dirEnu.z) || 1;
    this.smallArmsFlash(muzzleEnu, dirEnu.x / len, dirEnu.y / len, dirEnu.z / len, Math.max(1, scale * 2.2));
  }

  // ---------------------------------------------------------------------------
  //  Detonaciones.
  // ---------------------------------------------------------------------------
  /** Explosión de impacto escalada por yield^(1/3) (V2: según la espoleta). */
  impactExplosion(impactEnu: Vec3, yieldScale: number, opts: ExplosionOptions = {}): void {
    const det = opts.detonation ?? 'ground';
    if (det === 'air') this.airburst(impactEnu, yieldScale, opts.burstHeightM ?? 8);
    else this.groundBurst(impactEnu, yieldScale, det === 'buried', opts.noGround === true);
  }

  /** Explosión en superficie (o enterrada: géiser de tierra). */
  private groundBurst(p: Vec3, y: number, buried: boolean, noGround: boolean): void {
    const fx = this.fx;
    const s = Math.max(0.12, y);
    const sc = Math.min(3, s); // los recuentos no crecen sin límite
    const gz = p.z;
    const ground = noGround ? Number.NaN : gz;
    const flashK = buried ? 0.35 : 1;
    let e = EMIT.reset();

    // 1) Flash (más pequeño si va enterrada).
    e.x = p.x; e.y = p.y; e.z = p.z + 1.5 * s;
    e.life = 0.09; e.size = 26 * s * flashK; e.variant = 0;
    e.color(0xfffbf0); e.alpha = 1; e.fadeIn = 0.001; e.fadeOut = 0.05; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    e = EMIT.reset();
    e.x = p.x; e.y = p.y; e.z = p.z + 1.5 * s;
    e.life = 0.06; e.size = 16 * s * flashK; e.variant = 3; e.rot = Math.random() * TAU;
    e.color(0xffffff); e.alpha = 1; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);

    // 2) Bola de fuego: breve (0.2-0.45 s), ~6-8 m para 155 mm.
    const nFire = buried ? 3 : n(9 * Math.sqrt(sc));
    for (let i = 0; i < nFire; i++) {
      e = EMIT.reset();
      const a = Math.random() * TAU, r = rnd(0, 1.8) * s;
      e.x = p.x + Math.cos(a) * r; e.y = p.y + Math.sin(a) * r; e.z = p.z + rnd(0.5, 3) * s;
      e.vx = Math.cos(a) * rnd(4, 12) * s; e.vy = Math.sin(a) * rnd(4, 12) * s; e.vz = rnd(5, 16) * s;
      e.life = rnd(0.22, 0.45) * Math.sqrt(s);
      e.size = rnd(2.5, 4) * s; e.grow = 30 * s; e.growTau = 0.1;
      e.variant = 1;
      e.color(0xffe6a8).colorEnd(0xb8300a, 0.3);
      e.alpha = 0.95; e.fadeIn = 0.005; e.fadeOut = 0.25; e.drag = 3; e.wind = 0; e.heat = 1;
      fx.glow.emit(e);
    }
    this.effects.push(new LightPulse(p.x, p.y, p.z + 3 * s, 0xffc078, 30 * flashK, 160 * s, 0.09));
    this.effects.push(new LightPulse(p.x, p.y, p.z + 4 * s, 0xff8a3a, 9 * flashK, 90 * s, 0.35, 0.06));

    // 3) Humo oscuro con brasas dentro: sube (flotabilidad) y deriva.
    const nSmoke = n((buried ? 8 : 16) * sc);
    for (let i = 0; i < nSmoke; i++) {
      e = EMIT.reset();
      const a = Math.random() * TAU, r = rnd(0, 3) * s;
      e.x = p.x + Math.cos(a) * r; e.y = p.y + Math.sin(a) * r; e.z = p.z + rnd(1, 5) * s;
      e.vx = Math.cos(a) * rnd(2, 6) * s; e.vy = Math.sin(a) * rnd(2, 6) * s;
      e.vz = rnd(6, 16) * Math.sqrt(s);
      e.life = rnd(11, 18) * Math.sqrt(sc);
      e.size = rnd(4, 6.5) * s; e.grow = 7 * s; e.growTau = 2.2;
      e.color(i % 4 === 0 ? 0x4a4038 : 0x2c2825).colorEnd(0x4d4a46, 6);
      e.alpha = rnd(0.7, 0.88);
      e.fadeIn = 0.05; e.fadeOut = 0.3; e.gravity = -1.1; e.drag = 0.55;
      e.heat = buried ? 0.5 : 1.6; e.heatTau = 0.28;
      fx.smoke.emit(e);
    }

    // 4) Eyección de tierra: penacho que sube 25-50 m y vuelve a caer.
    const nEj = n((buried ? 26 : 14) * sc);
    const ejSpeed = buried ? 1.35 : 1;
    for (let i = 0; i < nEj; i++) {
      e = EMIT.reset();
      const a = Math.random() * TAU;
      const lat = rnd(2, buried ? 6 : 11) * Math.sqrt(s);
      e.x = p.x + rnd(-1, 1) * s; e.y = p.y + rnd(-1, 1) * s; e.z = p.z + rnd(0.5, 2) * s;
      e.vx = Math.cos(a) * lat; e.vy = Math.sin(a) * lat;
      e.vz = rnd(22, 42) * Math.sqrt(s) * ejSpeed;
      e.life = rnd(4.5, 7.5) * Math.sqrt(sc);
      e.size = rnd(2.4, 4) * s; e.grow = 4.2 * s; e.growTau = 2.2;
      e.color(i % 2 ? 0x6e5c48 : 0x5a4a3a).colorEnd(0x8d7d68, 3);
      e.alpha = rnd(0.65, 0.85);
      e.fadeIn = 0.02; e.fadeOut = 0.35; e.gravity = 7.5; e.drag = 0.7; e.ground = ground;
      fx.smoke.emit(e);
    }

    // 5) Falda de polvo (onda a ras de suelo), color tierra claro.
    if (!noGround) {
      const nSk = n(22 * sc);
      for (let i = 0; i < nSk; i++) {
        const a = (i / nSk) * TAU + rnd(-0.1, 0.1);
        const sp = rnd(18, 30) * s;
        e = EMIT.reset();
        e.x = p.x + Math.cos(a) * 1.5 * s; e.y = p.y + Math.sin(a) * 1.5 * s; e.z = gz + rnd(0.3, 1.5) * s;
        e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.vz = rnd(1, 4);
        e.life = rnd(6, 9) * Math.sqrt(sc);
        e.size = rnd(3.5, 5.5) * s; e.grow = 5 * s; e.growTau = 2.8;
        e.color(0x9c8c72); e.alpha = 0.5;
        e.fadeIn = 0.03; e.fadeOut = 0.3; e.gravity = 0.4; e.drag = 1.7; e.ground = gz;
        fx.smoke.emit(e);
      }
      this.ring(p.x, p.y, gz + 0.3, 45 * s, 0.28, 0.38, 0xd5c6a8, 0);
      this.ring(p.x, p.y, gz + 0.25, 30 * s, 1.4, 0.3, 0x8a7a62, 3);
    }

    // 6) Terrones balísticos (o cascotes si es fachada).
    const nDeb = n((buried ? 40 : 26) * sc);
    for (let i = 0; i < nDeb; i++) {
      const a = Math.random() * TAU;
      const el = rnd(0.5, 1.35); // rad sobre la horizontal
      const sp = rnd(14, 45) * Math.sqrt(s) * (buried ? 0.8 : 1);
      fx.debris.emit(
        p.x + rnd(-1, 1) * s, p.y + rnd(-1, 1) * s, p.z + rnd(0.3, 1.5) * s,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(a) * Math.cos(el) * sp, Math.sin(el) * sp,
        rnd(0.12, 0.45) * Math.sqrt(s), rnd(7, 11), noGround ? gz - 25 : gz,
      );
    }

    // 7) Metralla incandescente (se ve sobre todo de noche).
    if (!buried) {
      const nSp = n(26 * Math.sqrt(sc));
      for (let i = 0; i < nSp; i++) {
        const a = Math.random() * TAU;
        const el = rnd(-0.1, 1.2);
        const sp = rnd(90, 260);
        e = EMIT.reset();
        e.x = p.x; e.y = p.y; e.z = p.z + 1.2 * s;
        e.vx = Math.cos(a) * Math.cos(el) * sp; e.vy = Math.sin(a) * Math.cos(el) * sp; e.vz = Math.sin(el) * sp;
        e.life = rnd(0.25, 0.6);
        e.size = rnd(0.25, 0.45); e.stretch = 0.025; e.variant = 2;
        e.color(0xffc070).colorEnd(0xff5010, 0.4);
        e.alpha = 0.95; e.fadeIn = 0.001; e.gravity = 9.8; e.drag = 0.8; e.wind = 0; e.heat = 0.9;
        fx.glow.emit(e);
      }
    }

    // 8) Nube de condensación (Wilson) solo con rendimientos grandes.
    if (y >= 2.4 && !buried) {
      const R = 13 * s;
      const nW = n(18);
      for (let i = 0; i < nW; i++) {
        const a = (i / nW) * TAU;
        const el = rnd(0.15, 1.2);
        e = EMIT.reset();
        e.x = p.x + Math.cos(a) * Math.cos(el) * R;
        e.y = p.y + Math.sin(a) * Math.cos(el) * R;
        e.z = p.z + Math.sin(el) * R;
        e.vx = Math.cos(a) * 8; e.vy = Math.sin(a) * 8; e.vz = 2;
        e.life = rnd(0.6, 0.9);
        e.size = 9 * s; e.grow = 18 * s; e.growTau = 0.3;
        e.color(0xf4f6f8); e.alpha = 0.55;
        e.fadeIn = 0.06; e.fadeOut = 0.2; e.drag = 2; e.lit = 0.7;
        fx.smoke.emit(e);
      }
    }

    // Humo tardío: la columna se sigue alimentando del cráter caliente.
    this.effects.push(new Timeline([
      { t: 0.35, fn: () => this.lateSmoke(p, s, sc, 0.7) },
      { t: 0.9, fn: () => this.lateSmoke(p, s, sc, 0.5) },
      { t: 1.8, fn: () => this.lateSmoke(p, s, sc, 0.3) },
    ]));
  }

  private lateSmoke(p: Vec3, s: number, sc: number, k: number): void {
    const nS = n(6 * sc * k);
    for (let i = 0; i < nS; i++) {
      const e = EMIT.reset();
      e.x = p.x + rnd(-2, 2) * s; e.y = p.y + rnd(-2, 2) * s; e.z = p.z + rnd(0.5, 2) * s;
      e.vz = rnd(3, 7) * Math.sqrt(s);
      e.life = rnd(9, 14) * Math.sqrt(sc);
      e.size = rnd(3, 5) * s; e.grow = 4.5 * s; e.growTau = 3;
      e.color(0x3a3530).colorEnd(0x56524d, 5);
      e.alpha = 0.6 * k + 0.2;
      e.fadeIn = 0.3; e.fadeOut = 0.3; e.gravity = -0.8; e.drag = 0.6;
      this.fx.smoke.emit(e);
    }
  }

  /** Espoleta aérea: bocanada negra + cono de metralla hacia abajo. */
  private airburst(p: Vec3, y: number, h: number): void {
    const fx = this.fx;
    const s = Math.max(0.12, y);
    const sc = Math.min(3, s);
    const gz = p.z - h;
    let e = EMIT.reset();
    e.x = p.x; e.y = p.y; e.z = p.z;
    e.life = 0.08; e.size = 22 * s; e.variant = 0;
    e.color(0xfffbf0); e.alpha = 1; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 1;
    fx.glow.emit(e);
    for (let i = 0; i < n(6); i++) {
      e = EMIT.reset();
      e.x = p.x + rnd(-1, 1) * s; e.y = p.y + rnd(-1, 1) * s; e.z = p.z + rnd(-1, 1) * s;
      e.life = rnd(0.15, 0.3); e.size = rnd(2.5, 4) * s; e.grow = 22 * s; e.growTau = 0.08; e.variant = 1;
      e.color(0xffe0a0).colorEnd(0xc0400c, 0.2); e.alpha = 0.9; e.fadeIn = 0.004; e.drag = 4; e.wind = 0; e.heat = 1;
      fx.glow.emit(e);
    }
    this.effects.push(new LightPulse(p.x, p.y, p.z, 0xffc078, 26, 170 * s, 0.1));
    // Bocanada negra-gris esférica que apenas sube y deriva.
    for (let i = 0; i < n(12 * Math.sqrt(sc)); i++) {
      e = EMIT.reset();
      const a = Math.random() * TAU, el = rnd(-1, 1);
      const sp = rnd(4, 10) * s;
      e.x = p.x; e.y = p.y; e.z = p.z;
      e.vx = Math.cos(a) * Math.cos(el) * sp; e.vy = Math.sin(a) * Math.cos(el) * sp; e.vz = Math.sin(el) * sp;
      e.life = rnd(10, 16);
      e.size = rnd(3, 5) * s; e.grow = 5 * s; e.growTau = 1.6;
      e.color(0x232120).colorEnd(0x4a4845, 7);
      e.alpha = rnd(0.75, 0.9); e.fadeIn = 0.03; e.fadeOut = 0.35; e.gravity = -0.25; e.drag = 1.1;
      e.heat = 1.3; e.heatTau = 0.2;
      fx.smoke.emit(e);
    }
    // Cono de fragmentos hacia ABAJO (patrón de una espoleta de proximidad).
    for (let i = 0; i < n(50 * Math.sqrt(sc)); i++) {
      const a = Math.random() * TAU;
      const off = rnd(0.15, 1.25); // ángulo desde la vertical descendente
      const sp = rnd(160, 340);
      e = EMIT.reset();
      e.x = p.x; e.y = p.y; e.z = p.z;
      e.vx = Math.cos(a) * Math.sin(off) * sp; e.vy = Math.sin(a) * Math.sin(off) * sp; e.vz = -Math.cos(off) * sp;
      e.life = Math.min(0.5, (h / Math.max(1, Math.cos(off) * sp)) * 1.1 + 0.05);
      e.size = rnd(0.2, 0.4); e.stretch = 0.02; e.variant = 2;
      e.color(0xffc878); e.alpha = 0.9; e.fadeIn = 0.001; e.drag = 0; e.wind = 0; e.heat = 0.9;
      fx.glow.emit(e);
    }
    // Salpicaduras de polvo donde caen los fragmentos (aparecen con retardo).
    const R = Math.max(10, h * 1.6) * Math.sqrt(s);
    for (let i = 0; i < n(22 * Math.sqrt(sc)); i++) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * R;
      e = EMIT.reset();
      e.x = p.x + Math.cos(a) * r; e.y = p.y + Math.sin(a) * r; e.z = gz + 0.4;
      e.vz = rnd(1.5, 4);
      e.life = rnd(2.5, 4);
      e.size = rnd(0.8, 1.6); e.grow = 2.2; e.growTau = 1.5;
      e.color(0x9a8a70); e.alpha = 0.55;
      e.fadeIn = 0.03 + Math.hypot(r, h) / 300; e.fadeOut = 0.3; e.gravity = 0.6; e.drag = 1.5; e.ground = gz;
      fx.smoke.emit(e);
    }
  }

  /** P-VIVO.4 — splash de agua: columna + corona + anillos + bruma, SIN cráter. */
  waterSplash(impactEnu: Vec3, yieldScale: number): void {
    const fx = this.fx;
    const p = impactEnu;
    const s = Math.max(0.25, yieldScale);
    const sc = Math.min(3, s);
    let e: typeof EMIT;
    // Columna vertical blanca que se derrumba.
    for (let i = 0; i < n(26 * sc); i++) {
      e = EMIT.reset();
      e.x = p.x + rnd(-1.5, 1.5) * s; e.y = p.y + rnd(-1.5, 1.5) * s; e.z = p.z + rnd(0.5, 3);
      e.vx = rnd(-3, 3) * s; e.vy = rnd(-3, 3) * s; e.vz = rnd(22, 52) * Math.sqrt(s);
      e.life = rnd(2.4, 3.6) * Math.sqrt(sc);
      e.size = rnd(2, 3.4) * s; e.grow = 3 * s; e.growTau = 2;
      e.color(0xeef3f6); e.alpha = rnd(0.7, 0.9);
      e.fadeIn = 0.02; e.fadeOut = 0.4; e.gravity = 9.0; e.drag = 0.35; e.ground = p.z; e.lit = 0.85;
      fx.smoke.emit(e);
    }
    // Corona/base surge a ras de agua.
    const nC = n(18 * sc);
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * TAU;
      const sp = rnd(10, 20) * s;
      e = EMIT.reset();
      e.x = p.x; e.y = p.y; e.z = p.z + 1;
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.vz = rnd(4, 9);
      e.life = rnd(3, 4.5); e.size = rnd(2.5, 4) * s; e.grow = 4 * s; e.growTau = 2;
      e.color(0xe4ecf0); e.alpha = 0.55; e.gravity = 3; e.drag = 1.2; e.ground = p.z + 0.5; e.lit = 0.85;
      fx.smoke.emit(e);
    }
    // Bruma fina que queda flotando.
    for (let i = 0; i < n(8 * sc); i++) {
      e = EMIT.reset();
      e.x = p.x + rnd(-4, 4) * s; e.y = p.y + rnd(-4, 4) * s; e.z = p.z + rnd(4, 18) * s;
      e.vz = rnd(0.5, 2);
      e.life = rnd(5, 8); e.size = rnd(6, 10) * s; e.grow = 3 * s; e.growTau = 3;
      e.color(0xf2f6f8); e.alpha = 0.3; e.fadeIn = 0.4; e.drag = 0.8; e.lit = 0.7;
      fx.smoke.emit(e);
    }
    for (let i = 0; i < 3; i++) this.ring(p.x, p.y, p.z + 0.3, (40 + i * 18) * s, 2.2, 0.5, 0xdcecf6, 1, i * 0.25);
    this.effects.push(new LightPulse(p.x, p.y, p.z + 2, 0xffd0a0, 4, 40 * s, 0.05));
  }

  /** V2 — impacto de bala (sin carga): polvo del suelo y alguna chispa. */
  bulletImpact(impactEnu: Vec3, caliberM: number): void {
    const fx = this.fx;
    const p = impactEnu;
    const k = Math.max(0.6, Math.pow(caliberM / 0.0078, 0.8));
    let e: typeof EMIT;
    for (let i = 0; i < 3; i++) {
      e = EMIT.reset();
      e.x = p.x + rnd(-0.2, 0.2); e.y = p.y + rnd(-0.2, 0.2); e.z = p.z + 0.2;
      e.vx = rnd(-1.5, 1.5) * k; e.vy = rnd(-1.5, 1.5) * k; e.vz = rnd(2, 6) * k;
      e.life = rnd(1.2, 2.2); e.size = rnd(0.3, 0.6) * k; e.grow = 0.8 * k; e.growTau = 0.8;
      e.color(0x9a8a72); e.alpha = 0.55; e.gravity = 3; e.drag = 1.6; e.ground = p.z;
      fx.smoke.emit(e);
    }
    for (let i = 0; i < 2; i++) {
      e = EMIT.reset();
      e.x = p.x; e.y = p.y; e.z = p.z + 0.1;
      e.vx = rnd(-20, 20); e.vy = rnd(-20, 20); e.vz = rnd(5, 25);
      e.life = rnd(0.08, 0.18); e.size = 0.12 * k; e.stretch = 0.02; e.variant = 2;
      e.color(0xffc070); e.alpha = 0.9; e.fadeIn = 0.001; e.gravity = 9.8; e.drag = 0; e.wind = 0;
      fx.glow.emit(e);
    }
  }

  /** P-VIVO.5 — explosión EN una fachada/tejado: sin falda ni anillo. */
  structureExplosion(impactEnu: Vec3, yieldScale: number): void {
    this.groundBurst(impactEnu, yieldScale, false, true);
  }

  /** P-VIVO.8 — bengala ILLUM colgada del viento real (~50 s de luz). */
  flare(startEnu: Vec3, groundZ: number): void {
    this.effects.push(new FlareFX(this.root, startEnu, groundZ, this.windFn, this.fx));
  }

  /** P-VIVO.8 — cortina de humo perpendicular al rumbo (~90 s, deriva). */
  smokeScreen(centerEnu: Vec3, bearingDeg: number, yieldScale = 1): void {
    this.effects.push(new SmokeScreenFX(centerEnu, bearingDeg, this.fx, yieldScale));
    this.effects.push(new LightPulse(centerEnu.x, centerEnu.y, centerEnu.z + 2, 0xffd0a0, 3, 30, 0.05));
  }

  /** Estela persistente para un proyectil (el presentador la alimenta). */
  makeTrail(kind: TrailKind = 'shell', scale = 1): TrailFX {
    const trail = new TrailFX(this.fx);
    trail.configure(kind, scale);
    this.effects.push(trail);
    return trail;
  }

  /** Anillo plano expansivo (onda de choque, agua, polvo). */
  private ring(
    x: number, y: number, z: number, diameter: number, life: number, alpha: number,
    color: number, cell: number, delay = 0,
  ): void {
    const e = EMIT.reset();
    e.x = x; e.y = y; e.z = z;
    e.life = life + delay;
    e.size = 2;
    // Frente que decelera: tamaño → diámetro con saturación exponencial.
    const tau = life * 0.35;
    e.grow = diameter / tau;
    e.growTau = tau;
    e.stretch = -1; // plano sobre el suelo
    e.variant = cell;
    e.color(color);
    e.alpha = alpha;
    e.fadeIn = 0.01 + delay;
    e.fadeOut = 0.15;
    e.drag = 0; e.wind = 0; e.lit = 0;
    this.fx.flat.emit(e);
  }

  dispose(): void {
    for (const e of this.effects) e.dispose();
    this.effects = [];
    const f = this.fx;
    f.smoke.clear();
    f.glow.clear();
    f.flat.clear();
    f.flatGlow.clear();
    f.debris.clear();
  }
}

/** P-PRO.8 — contadores para el overlay ?stats=1 (compatibilidad). */
export function puffPoolStats(): { created: number; live: number; free: number } {
  const live = lastManager?.particleCount ?? 0;
  const cap = 4096 + 3072 + 128 + 64 + 900;
  return { created: cap, live, free: cap - live };
}
