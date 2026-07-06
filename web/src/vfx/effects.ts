// ============================================================================
//  effects.ts — Suite VFX del "efecto guau" en Three.js.  [P-WEB.5]
//
//  Equivalentes web de los sistemas Niagara previstos en la fase Unreal:
//    MuzzleFlashFX      — destello cegador + luz puntual transitoria.
//    MuzzleSmokeFX      — humo volumétrico que DERIVA CON EL VIENTO real del
//                         servicio y escala con la densidad del aire.
//    TrailFX            — estela: condensación en la banda transónica
//                         (lee Mach/altitud) + exhausto brillante del cohete.
//    ShockConeFX        — cono de sobrepresión aditivo, escala con Mach.
//    ImpactExplosionFX  — flash + bola de fuego + columna de humo + chispas,
//                         todo escalado por yield^(1/3)  (P0.1 bien hecho).
//    GroundShockwaveFX  — anillo de polvo en el suelo.
//
//  Todo procedural (texturas por canvas): cero assets binarios.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from '../ballistics/Vec3';
import { getPuffTexture, makeGlowSprite } from '../render/PostFX';

/** Un efecto vivo. update() devuelve false cuando ha muerto. */
export interface Effect {
  update(dt: number, camEnu: THREE.Vector3): boolean;
  dispose(): void;
}

type WindFn = (posEnu: Vec3) => Vec3;

// ---------------------------------------------------------------------------
//  P-PRO.8 — Pool global de sprites para PuffCloud.
//
//  Antes cada bocanada creaba y destruía Sprite+SpriteMaterial (presión de GC
//  con salvas y sesiones largas). Ahora un pool con cap global ~600 los
//  presta y recupera: adquirir configura color/opacidad/rotación del material
//  YA existente; al agotarse el cap se ROBA el más viejo (su dueño lo suelta
//  al instante). Los contadores de info.memory quedan planos tras calentar.
// ---------------------------------------------------------------------------
const PUFF_POOL_CAP = 600;

interface PuffLease { sprite: THREE.Sprite; evict: () => void; }

class PuffPool {
  private free: THREE.Sprite[] = [];
  private live: PuffLease[] = []; // en orden de adquisición (el [0] es el más viejo)
  private created = 0;

  acquire(evict: () => void): THREE.Sprite {
    let sprite = this.free.pop();
    if (!sprite) {
      if (this.created < PUFF_POOL_CAP) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getPuffTexture(),
          transparent: true,
          depthWrite: false,
        }));
        this.created++;
      } else {
        // Cap agotado: el puff más viejo cede el sitio (su dueño lo libera).
        const oldest = this.live.shift();
        oldest?.evict();
        sprite = this.free.pop();
        if (!sprite) {
          // El dueño no liberó (no debería pasar): crea uno fuera de cap.
          sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getPuffTexture(), transparent: true, depthWrite: false,
          }));
          this.created++;
        }
      }
    }
    sprite.visible = true;
    this.live.push({ sprite, evict });
    return sprite;
  }

  release(sprite: THREE.Sprite): void {
    const idx = this.live.findIndex((l) => l.sprite === sprite);
    if (idx >= 0) this.live.splice(idx, 1);
    sprite.visible = false;
    sprite.parent?.remove(sprite);
    this.free.push(sprite);
  }

  get stats(): { created: number; live: number; free: number } {
    return { created: this.created, live: this.live.length, free: this.free.length };
  }
}

const puffPool = new PuffPool();

/** P-PRO.8 — contadores del pool para el overlay ?stats=1. */
export function puffPoolStats(): { created: number; live: number; free: number } {
  return puffPool.stats;
}

// ---------------------------------------------------------------------------
//  Nube de partículas genérica (humo, polvo, condensación, escombros).
// ---------------------------------------------------------------------------
interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size0: number;
  grow: number;      // m/s de crecimiento
  gravity: number;   // fracción de g aplicada (escombros ~1, humo ~-0.05 flota)
  windDrag: number;  // 1/s: velocidad relajándose hacia el viento
  opacity0: number;
}

class PuffCloud implements Effect {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly wind: WindFn,
    private readonly color: THREE.ColorRepresentation,
  ) {
    parent.add(this.group);
  }

  emit(opts: {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    size: number;
    grow?: number;
    gravity?: number;
    windDrag?: number;
    opacity?: number;
    color?: THREE.ColorRepresentation;
  }): void {
    // P-PRO.8 — sprite prestado del pool: se CONFIGURA, no se crea.
    const sprite = puffPool.acquire(() => this.evict(sprite));
    const mat = sprite.material;
    mat.color.set(opts.color ?? this.color);
    mat.opacity = opts.opacity ?? 0.5;
    mat.rotation = Math.random() * Math.PI * 2; // rompe el patrón radial
    sprite.position.copy(opts.pos);
    sprite.scale.setScalar(opts.size);
    this.group.add(sprite);
    this.puffs.push({
      sprite,
      vel: opts.vel.clone(),
      age: 0,
      life: opts.life,
      size0: opts.size,
      grow: opts.grow ?? opts.size * 0.4,
      gravity: opts.gravity ?? -0.02,
      windDrag: opts.windDrag ?? 0.8,
      opacity0: opts.opacity ?? 0.5,
    });
  }

  get alive(): boolean { return this.puffs.length > 0; }

  /** El pool reclama este sprite (cap agotado): soltarlo YA. */
  private evict(sprite: THREE.Sprite): void {
    const i = this.puffs.findIndex((p) => p.sprite === sprite);
    if (i >= 0) {
      this.puffs.splice(i, 1);
      puffPool.release(sprite);
    }
  }

  update(dt: number): boolean {
    const g = 9.80665;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        puffPool.release(p.sprite); // vuelve al pool, nada se destruye
        this.puffs.splice(i, 1);
        continue;
      }
      // Relajación exponencial de la velocidad propia hacia el viento local.
      const w = this.wind(new Vec3(p.sprite.position.x, p.sprite.position.y, p.sprite.position.z));
      const k = 1 - Math.exp(-p.windDrag * dt);
      p.vel.x += (w.x - p.vel.x) * k;
      p.vel.y += (w.y - p.vel.y) * k;
      p.vel.z += (w.z - p.vel.z) * k - p.gravity * g * dt;
      p.sprite.position.addScaledVector(p.vel, dt);

      const t = p.age / p.life;
      p.sprite.scale.setScalar(p.size0 + p.grow * p.age);
      p.sprite.material.opacity = p.opacity0 * (1 - t) * (1 - t);
    }
    return this.alive;
  }

  dispose(): void {
    for (const p of this.puffs) puffPool.release(p.sprite);
    this.puffs = [];
    this.parent.remove(this.group);
  }
}

// ---------------------------------------------------------------------------
//  Fogonazo de boca.
// ---------------------------------------------------------------------------
class MuzzleFlashFX implements Effect {
  private readonly core: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly light: THREE.PointLight;
  private age = 0;
  private readonly life = 0.22;

  constructor(private readonly parent: THREE.Object3D, pos: THREE.Vector3, scale: number) {
    this.core = makeGlowSprite(0xfff6d8, 7 * scale);
    this.halo = makeGlowSprite(0xffa03a, 16 * scale);
    this.core.position.copy(pos);
    this.halo.position.copy(pos);
    this.light = new THREE.PointLight(0xffc070, 60000 * scale, 900 * scale, 2);
    this.light.position.copy(pos);
    parent.add(this.core, this.halo, this.light);
  }

  update(dt: number): boolean {
    this.age += dt;
    const t = Math.min(1, this.age / this.life);
    const env = (1 - t) * (1 - t); // ataque instantáneo, caída rápida
    (this.core.material as THREE.SpriteMaterial).opacity = env;
    (this.halo.material as THREE.SpriteMaterial).opacity = env * 0.7;
    this.light.intensity = 60000 * env;
    return t < 1;
  }

  dispose(): void {
    this.parent.remove(this.core, this.halo, this.light);
    this.core.material.dispose();
    this.halo.material.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Estela del proyectil (condensación transónica + exhausto de cohete).
// ---------------------------------------------------------------------------
export class TrailFX implements Effect {
  private readonly cloud: PuffCloud;
  private readonly exhaustGlow: THREE.Sprite;
  private emitAccum = 0;
  private dead = false;

  constructor(parent: THREE.Object3D, wind: WindFn) {
    this.cloud = new PuffCloud(parent, wind, 0xf4f8ff);
    this.exhaustGlow = makeGlowSprite(0xffc27a, 10);
    this.exhaustGlow.visible = false;
    parent.add(this.exhaustGlow);
  }

  /** Alimentar cada frame desde el presentador (P4.1: parámetros físicos). */
  feed(
    dt: number,
    pos: THREE.Vector3,
    mach: number,
    altitudeM: number,
    thrusting: boolean,
  ): void {
    if (this.dead) return;
    this.exhaustGlow.visible = thrusting;
    if (thrusting) this.exhaustGlow.position.copy(pos);

    // Banda de condensación: máxima en transónico, se desvanece con la
    // densidad (aire fino a gran altitud = estela más tenue).
    const transonic = Math.max(0, 1 - Math.abs(mach - 1.0) / 0.35);
    const densityFade = Math.max(0.15, Math.exp(-altitudeM / 9000));
    const rate = thrusting ? 90 : 60 * transonic * densityFade;
    if (rate <= 0) return;

    this.emitAccum += rate * dt;
    while (this.emitAccum >= 1) {
      this.emitAccum -= 1;
      this.cloud.emit({
        pos,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        ),
        life: thrusting ? 1.2 : 2.2,
        size: thrusting ? 4 : 5,
        grow: 5,
        opacity: thrusting ? 0.55 : 0.4 * transonic * densityFade + 0.08,
        color: thrusting ? 0xcfd6dd : 0xf4f8ff,
        windDrag: 1.2,
      });
    }
  }

  /** El proyectil impactó: deja de emitir y disipa lo que queda. */
  finish(): void { this.dead = true; this.exhaustGlow.visible = false; }

  update(dt: number): boolean {
    const alive = this.cloud.update(dt);
    return !this.dead || alive;
  }

  dispose(): void {
    this.cloud.dispose();
    this.exhaustGlow.parent?.remove(this.exhaustGlow);
    this.exhaustGlow.material.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Cono de choque (refracción aproximada: brillo aditivo, no distorsión real).
// ---------------------------------------------------------------------------
export class ShockConeFX {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.ConeGeometry(1.6, 7, 20, 1, true);
    geo.rotateX(Math.PI / 2); // apunta a -Z local... se orienta con quaternion
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xbfe4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    parent.add(this.mesh);
  }

  /** shock 0..1 (mapeado de Mach 0.9..1.5, como la capa Unreal). */
  set(pos: THREE.Vector3, velDir: THREE.Vector3, shock: number): void {
    this.mesh.position.copy(pos);
    if (velDir.lengthSq() > 1e-9) {
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), velDir);
    }
    this.mat.opacity = 0.16 * shock;
    this.mesh.visible = shock > 0.01;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Explosión de impacto.
// ---------------------------------------------------------------------------
class ImpactExplosionFX implements Effect {
  private readonly flash: THREE.Sprite;
  private readonly fire: THREE.Sprite;
  private readonly light: THREE.PointLight;
  private readonly smoke: PuffCloud;
  private readonly dust: PuffCloud;
  private age = 0;
  private seeded = false;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly pos: THREE.Vector3,
    private readonly yieldScale: number,
    wind: WindFn,
  ) {
    const y = yieldScale;
    this.flash = makeGlowSprite(0xffffff, 60 * y);
    this.fire = makeGlowSprite(0xff8c2a, 26 * y);
    this.flash.position.copy(pos);
    this.fire.position.copy(pos);
    this.light = new THREE.PointLight(0xffb060, 2.2e5 * y, 2500 * y, 2);
    this.light.position.copy(pos);
    this.smoke = new PuffCloud(parent, wind, 0x2c2c2e);
    this.dust = new PuffCloud(parent, wind, 0x8a7a63);
    parent.add(this.flash, this.fire, this.light);
  }

  update(dt: number): boolean {
    const y = this.yieldScale;
    this.age += dt;
    const t = this.age;

    if (!this.seeded) {
      this.seeded = true;
      // Columna de humo: bocanadas ascendentes desde el punto de impacto.
      const nSmoke = Math.round(26 * Math.min(3, y));
      for (let i = 0; i < nSmoke; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 6 * y;
        this.smoke.emit({
          pos: this.pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, Math.random() * 4 * y)),
          vel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 9 + Math.random() * 14 * y),
          life: 6 + Math.random() * 5,
          size: 9 * y,
          grow: 4 * y,
          gravity: -0.06,
          opacity: 0.62,
          windDrag: 0.5,
        });
      }
      // Falda de polvo lateral (marca la sobrepresión en el suelo).
      const nDust = Math.round(20 * Math.min(3, y));
      for (let i = 0; i < nDust; i++) {
        const ang = (i / nDust) * Math.PI * 2;
        const speed = 26 * y * (0.75 + Math.random() * 0.5);
        this.dust.emit({
          pos: this.pos.clone(),
          vel: new THREE.Vector3(Math.cos(ang) * speed, Math.sin(ang) * speed, 3 + Math.random() * 3),
          life: 2.4 + Math.random() * 1.4,
          size: 6 * y,
          grow: 8 * y,
          gravity: 0.12,
          opacity: 0.5,
          windDrag: 1.4,
        });
      }
    }

    // Envolventes: flash (80 ms), bola de fuego (~1 s), luz (~1.5 s).
    const flashEnv = Math.max(0, 1 - t / 0.09);
    const fireEnv = Math.max(0, 1 - t / (0.9 + 0.3 * y));
    (this.flash.material as THREE.SpriteMaterial).opacity = flashEnv;
    (this.fire.material as THREE.SpriteMaterial).opacity = fireEnv * 0.95;
    this.fire.scale.setScalar(26 * this.yieldScale * (1 + 1.6 * Math.min(1, t / 0.5)));
    this.light.intensity = 2.2e5 * this.yieldScale * Math.max(flashEnv, fireEnv * 0.35);

    const cloudsAlive = [this.smoke.update(dt), this.dust.update(dt)].some(Boolean);
    return t < 1.6 || cloudsAlive;
  }

  dispose(): void {
    this.parent.remove(this.flash, this.fire, this.light);
    this.flash.material.dispose();
    this.fire.material.dispose();
    this.smoke.dispose();
    this.dust.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Anillo de choque en el suelo (boca del arma e impactos).
// ---------------------------------------------------------------------------
class GroundShockwaveFX implements Effect {
  private readonly ring: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private age = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    pos: THREE.Vector3,
    private readonly maxRadius: number,
    private readonly life = 1.1,
  ) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xd8c9a8,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 48), this.mat);
    this.ring.position.copy(pos).add(new THREE.Vector3(0, 0, 0.4));
    // El anillo vive en el plano del suelo ENU (XY): sin rotación extra.
    parent.add(this.ring);
  }

  update(dt: number): boolean {
    this.age += dt;
    const t = Math.min(1, this.age / this.life);
    const r = 1 + (this.maxRadius - 1) * Math.sqrt(t); // frente que decelera
    this.ring.scale.setScalar(r);
    this.mat.opacity = 0.55 * (1 - t);
    return t < 1;
  }

  dispose(): void {
    this.parent.remove(this.ring);
    this.ring.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Gestor: agrega efectos, los actualiza y expone los "spawners".
// ---------------------------------------------------------------------------
export class VfxManager {
  private effects: Effect[] = [];

  constructor(
    readonly root: THREE.Object3D,
    private readonly wind: WindFn,
  ) {}

  update(dt: number, camEnu: THREE.Vector3): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(dt, camEnu)) {
        this.effects[i].dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  /** Fogonazo + humo de boca + anillo de polvo (firma de lanzamiento). */
  launchSignature(muzzleEnu: Vec3, dirEnu: Vec3, airDensity: number, scale = 1): void {
    const pos = new THREE.Vector3(muzzleEnu.x, muzzleEnu.y, muzzleEnu.z);
    this.effects.push(new MuzzleFlashFX(this.root, pos, scale));
    this.effects.push(new GroundShockwaveFX(this.root, pos.clone().setZ(0.4), 26 * scale, 0.9));

    // Humo de boca: más denso cuanto más denso es el aire (lee AirDensity).
    const smoke = new PuffCloud(this.root, this.wind, 0xb9bdc2);
    const dir = new THREE.Vector3(dirEnu.x, dirEnu.y, dirEnu.z).normalize();
    const n = Math.round(26 * (airDensity / 1.225) * scale);
    for (let i = 0; i < n; i++) {
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, Math.random() * 5,
      );
      smoke.emit({
        pos: pos.clone().addScaledVector(dir, 2 + Math.random() * 3),
        vel: dir.clone().multiplyScalar(14 + Math.random() * 22).add(spread),
        life: 5 + Math.random() * 4,
        size: 3.5 * scale,
        grow: 3.2,
        opacity: 0.5,
        windDrag: 1.1,
      });
    }
    this.effects.push(smoke);
  }

  /** Explosión de impacto escalada por yield^(1/3) + anillo de polvo. */
  impactExplosion(impactEnu: Vec3, yieldScale: number): void {
    const pos = new THREE.Vector3(impactEnu.x, impactEnu.y, impactEnu.z);
    this.effects.push(new ImpactExplosionFX(this.root, pos, yieldScale, this.wind));
    this.effects.push(new GroundShockwaveFX(this.root, pos, 90 * yieldScale, 1.6));
  }

  /** Estela persistente para un proyectil (el presentador la alimenta). */
  makeTrail(): TrailFX {
    const trail = new TrailFX(this.root, this.wind);
    this.effects.push(trail);
    return trail;
  }

  dispose(): void {
    for (const e of this.effects) e.dispose();
    this.effects = [];
  }
}
