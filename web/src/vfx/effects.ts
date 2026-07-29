// ============================================================================
//  effects.ts — Suite VFX del "efecto guau" en Three.js.  [P-WEB.5 + P-VFX.2]
//
//  Equivalentes web de los sistemas Niagara previstos en la fase Unreal:
//    MuzzleFlashFX      — fogonazo en tres fases: destello primario cegador,
//                         PLUMA DIRECCIONAL de gases por el ánima (con los dos
//                         lóbulos laterales del freno de boca) y fogonazo
//                         secundario naranja al quemarse los gases al aire.
//    BlastWaveFX        — frente de sobrepresión: esfera que se expande a la
//                         velocidad del sonido y se desvanece con 1/r².
//    MuzzleSmokeFX      — humo volumétrico que DERIVA CON EL VIENTO real del
//                         servicio y escala con la densidad del aire.
//    TrailFX            — estela: condensación en la banda transónica
//                         (lee Mach/altitud) + exhausto brillante del cohete.
//    ShockConeFX        — cono de sobrepresión aditivo, escala con Mach.
//    ImpactExplosionFX  — flash + bola de fuego que asciende y se enfría de
//                         blanco a rojo + hongo de humo + falda de polvo,
//                         todo escalado por yield^(1/3)  (P0.1 bien hecho).
//    DebrisFX           — escombros y chispas con parábola REAL (g = 9.81) y
//                         rebote en el suelo; el número escala con el yield.
//    GroundShockwaveFX  — anillo de polvo en el suelo.
//
//  Todo procedural (texturas por canvas): cero assets binarios.
// ============================================================================
import * as THREE from 'three';
import { Vec3 } from '../ballistics/Vec3';
import type { Weapon } from '../ballistics';
import { getPuffTexture, makeGlowSprite } from '../render/PostFX';

/** Un efecto vivo. update() devuelve false cuando ha muerto. */
export interface Effect {
  update(dt: number, camEnu: THREE.Vector3): boolean;
  dispose(): void;
}

type WindFn = (posEnu: Vec3) => Vec3;

const G = 9.80665;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
//  P-PRO.8 — Pool global de sprites para PuffCloud.
//
//  Antes cada bocanada creaba y destruía Sprite+SpriteMaterial (presión de GC
//  con salvas y sesiones largas). Ahora un pool con cap global los presta y
//  recupera: adquirir configura color/opacidad/rotación del material YA
//  existente; al agotarse el cap se ROBA el más viejo (su dueño lo suelta al
//  instante). Los contadores de info.memory quedan planos tras calentar.
//
//  P-VFX.2 — hay DOS pools: uno normal (humo, polvo) y otro aditivo (chispas,
//  brasas). Separarlos evita recompilar shaders al cambiar el blending de un
//  material reutilizado, que era el coste oculto de mezclarlos.
// ---------------------------------------------------------------------------
const PUFF_POOL_CAP = 520;

interface PuffLease { sprite: THREE.Sprite; evict: () => void; }

class PuffPool {
  private free: THREE.Sprite[] = [];
  private live: PuffLease[] = []; // en orden de adquisición (el [0] es el más viejo)
  private created = 0;

  constructor(
    private readonly cap: number,
    private readonly blending: THREE.Blending,
  ) {}

  private make(): THREE.Sprite {
    this.created++;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getPuffTexture(),
      transparent: true,
      depthWrite: false,
      blending: this.blending,
    }));
    s.frustumCulled = false;
    return s;
  }

  acquire(evict: () => void): THREE.Sprite {
    let sprite = this.free.pop();
    if (!sprite) {
      if (this.created < this.cap) {
        sprite = this.make();
      } else {
        // Cap agotado: el puff más viejo cede el sitio (su dueño lo libera).
        const oldest = this.live.shift();
        oldest?.evict();
        sprite = this.free.pop() ?? this.make();
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

const puffPool = new PuffPool(PUFF_POOL_CAP, THREE.NormalBlending);
const emberPool = new PuffPool(220, THREE.AdditiveBlending);

/** P-PRO.8 — contadores del pool para el overlay ?stats=1. */
export function puffPoolStats(): { created: number; live: number; free: number } {
  const a = puffPool.stats, b = emberPool.stats;
  return {
    created: a.created + b.created,
    live: a.live + b.live,
    free: a.free + b.free,
  };
}

// ---------------------------------------------------------------------------
//  Nube de partículas genérica (humo, polvo, condensación, escombros, brasas).
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
  /** Rebota en z=0 en vez de atravesar el suelo (escombros). */
  bounce: number;
  /** Enfriamiento: el color va de caliente a frío durante la vida. */
  cool: { from: THREE.Color; to: THREE.Color } | null;
}

class PuffCloud implements Effect {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly wind: WindFn,
    private readonly color: THREE.ColorRepresentation,
    /** Brasas y chispas usan el pool aditivo. */
    private readonly additive = false,
  ) {
    parent.add(this.group);
  }

  private get pool(): PuffPool { return this.additive ? emberPool : puffPool; }

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
    bounce?: number;
    coolTo?: THREE.ColorRepresentation;
  }): void {
    // P-PRO.8 — sprite prestado del pool: se CONFIGURA, no se crea.
    const sprite = this.pool.acquire(() => this.evict(sprite));
    const mat = sprite.material;
    const base = new THREE.Color(opts.color ?? this.color);
    mat.color.copy(base);
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
      bounce: opts.bounce ?? 0,
      cool: opts.coolTo ? { from: base, to: new THREE.Color(opts.coolTo) } : null,
    });
  }

  get alive(): boolean { return this.puffs.length > 0; }

  /** El pool reclama este sprite (cap agotado): soltarlo YA. */
  private evict(sprite: THREE.Sprite): void {
    const i = this.puffs.findIndex((p) => p.sprite === sprite);
    if (i >= 0) {
      this.puffs.splice(i, 1);
      this.pool.release(sprite);
    }
  }

  update(dt: number): boolean {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.pool.release(p.sprite); // vuelve al pool, nada se destruye
        this.puffs.splice(i, 1);
        continue;
      }
      // Relajación exponencial de la velocidad propia hacia el viento local.
      const w = this.wind(new Vec3(p.sprite.position.x, p.sprite.position.y, p.sprite.position.z));
      const k = 1 - Math.exp(-p.windDrag * dt);
      p.vel.x += (w.x - p.vel.x) * k;
      p.vel.y += (w.y - p.vel.y) * k;
      p.vel.z += (w.z - p.vel.z) * k - p.gravity * G * dt;
      p.sprite.position.addScaledVector(p.vel, dt);

      // Escombros: rebotan en el plano del suelo en vez de hundirse.
      if (p.bounce > 0 && p.sprite.position.z < 0 && p.vel.z < 0) {
        p.sprite.position.z = 0;
        p.vel.z = -p.vel.z * p.bounce;
        p.vel.x *= 0.55;
        p.vel.y *= 0.55;
      }

      const t = p.age / p.life;
      p.sprite.scale.setScalar(p.size0 + p.grow * p.age);
      p.sprite.material.opacity = p.opacity0 * (1 - t) * (1 - t);
      // Enfriamiento cromático (brasas: blanco -> naranja -> rojo apagado).
      if (p.cool) p.sprite.material.color.lerpColors(p.cool.from, p.cool.to, t);
    }
    return this.alive;
  }

  dispose(): void {
    for (const p of this.puffs) this.pool.release(p.sprite);
    this.puffs = [];
    this.parent.remove(this.group);
  }
}

// ---------------------------------------------------------------------------
//  Fogonazo de boca — tres fases con pluma direccional.
// ---------------------------------------------------------------------------
class MuzzleFlashFX implements Effect {
  private readonly core: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly plume: THREE.Mesh;
  private readonly lobes: THREE.Mesh[] = [];
  private readonly plumeMat: THREE.MeshBasicMaterial;
  private readonly light: THREE.PointLight;
  private age = 0;
  private readonly life = 0.26;
  private readonly peakIntensity: number;

  constructor(
    private readonly parent: THREE.Object3D,
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    scale: number,
    /** El freno de boca desvía gases a los lados: dos lóbulos extra. */
    sideLobes: boolean,
  ) {
    this.core = makeGlowSprite(0xfff6d8, 7 * scale);
    this.halo = makeGlowSprite(0xffa03a, 18 * scale);
    this.core.position.copy(pos);
    this.halo.position.copy(pos);

    // Pluma: cono de gases saliendo por el ánima, orientado al disparo.
    this.plumeMat = new THREE.MeshBasicMaterial({
      color: 0xffd79a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const len = 11 * scale;
    const geo = new THREE.ConeGeometry(2.6 * scale, len, 14, 1, true);
    geo.translate(0, len * 0.5, 0);   // base en el origen, punta a +y
    geo.rotateX(Math.PI / 2);          // +y -> +z (eje del disparo)
    this.plume = new THREE.Mesh(geo, this.plumeMat);
    this.plume.position.copy(pos);
    this.plume.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    parent.add(this.plume);

    if (sideLobes) {
      // Los deflectores del freno tiran los gases a ±70º: la "T" del fogonazo.
      const right = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      for (const s of [-1, 1]) {
        const lobeLen = 6.5 * scale;
        const lg = new THREE.ConeGeometry(2.0 * scale, lobeLen, 12, 1, true);
        lg.translate(0, lobeLen * 0.5, 0);
        lg.rotateX(Math.PI / 2);
        const lobe = new THREE.Mesh(lg, this.plumeMat);
        const lobeDir = dir.clone().multiplyScalar(0.35)
          .addScaledVector(right, s * 0.94).normalize();
        lobe.position.copy(pos);
        lobe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lobeDir);
        parent.add(lobe);
        this.lobes.push(lobe);
      }
    }

    // Intensidad heredada del fogonazo original (ajustada contra el globo):
    // subirla blanquea la cabina, que está a 7 m de la boca.
    this.peakIntensity = 60000 * scale;
    this.light = new THREE.PointLight(0xffc070, this.peakIntensity, 900 * scale, 2);
    this.light.position.copy(pos);
    parent.add(this.core, this.halo, this.light);
  }

  update(dt: number): boolean {
    this.age += dt;
    const t = Math.min(1, this.age / this.life);

    // Fase 1 (0-25 ms): destello primario blanco, casi un delta.
    const primary = Math.max(0, 1 - t / 0.1);
    // Fase 2 (25-120 ms): la pluma de gases sale y se estira.
    const plumeEnv = t < 0.06 ? t / 0.06 : Math.max(0, 1 - (t - 0.06) / 0.45);
    // Fase 3 (100-260 ms): fogonazo secundario naranja al arder los gases.
    const secondary = Math.max(0, Math.sin(Math.PI * clamp((t - 0.18) / 0.82, 0, 1)));

    (this.core.material as THREE.SpriteMaterial).opacity = primary;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.75 * Math.max(primary * 0.8, secondary * 0.55);
    this.halo.scale.setScalar(this.halo.scale.x * (1 + 0.9 * dt));

    this.plumeMat.opacity = 0.72 * plumeEnv;
    const stretch = 0.35 + 0.9 * Math.min(1, t / 0.12);
    this.plume.scale.set(1 + 0.5 * t, 1 + 0.5 * t, stretch);
    for (const l of this.lobes) l.scale.set(1 + 0.7 * t, 1 + 0.7 * t, stretch * 0.8);

    this.light.intensity = this.peakIntensity * Math.max(primary, secondary * 0.35);
    return t < 1;
  }

  dispose(): void {
    this.parent.remove(this.core, this.halo, this.light, this.plume);
    for (const l of this.lobes) {
      this.parent.remove(l);
      l.geometry.dispose();
    }
    this.plume.geometry.dispose();
    this.plumeMat.dispose();
    this.core.material.dispose();
    this.halo.material.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Frente de sobrepresión: esfera que se expande a la velocidad del sonido.
// ---------------------------------------------------------------------------
class BlastWaveFX implements Effect {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private age = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    pos: THREE.Vector3,
    private readonly maxRadius: number,
    private readonly life: number,
    color = 0xdfe9ff,
  ) {
    this.mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide, // se ve la cara interior: parece una burbuja
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), this.mat);
    this.mesh.position.copy(pos);
    this.mesh.scale.setScalar(0.4);
    parent.add(this.mesh);
  }

  update(dt: number): boolean {
    this.age += dt;
    const t = Math.min(1, this.age / this.life);
    // El frente decelera al expandirse (r ~ t^0.6 tras la fase fuerte).
    const r = this.maxRadius * Math.pow(t, 0.6);
    this.mesh.scale.setScalar(Math.max(0.4, r));
    // La energía se reparte en la superficie: la intensidad cae con 1/r².
    this.mat.opacity = 0.4 * (1 - t) * (1 - t);
    return t < 1;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Estela del proyectil (condensación transónica + exhausto de cohete).
// ---------------------------------------------------------------------------
export class TrailFX implements Effect {
  private readonly cloud: PuffCloud;
  private readonly embers: PuffCloud;
  private readonly exhaustGlow: THREE.Sprite;
  private emitAccum = 0;
  private emberAccum = 0;
  private dead = false;

  constructor(parent: THREE.Object3D, wind: WindFn) {
    this.cloud = new PuffCloud(parent, wind, 0xf4f8ff);
    this.embers = new PuffCloud(parent, wind, 0xffcf8a, true);
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
    const rate = thrusting ? 110 : 60 * transonic * densityFade;

    if (rate > 0) {
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
          life: thrusting ? 2.6 : 2.2,
          size: thrusting ? 5 : 5,
          grow: thrusting ? 8 : 5,
          opacity: thrusting ? 0.5 : 0.4 * transonic * densityFade + 0.08,
          color: thrusting ? 0xb9bec4 : 0xf4f8ff,
          windDrag: 1.2,
        });
      }
    }

    // Brasas del motor: partículas incandescentes que se enfrían tras salir.
    if (thrusting) {
      this.emberAccum += 55 * dt;
      while (this.emberAccum >= 1) {
        this.emberAccum -= 1;
        this.embers.emit({
          pos,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 14,
            (Math.random() - 0.5) * 14,
            (Math.random() - 0.5) * 14,
          ),
          life: 0.35 + Math.random() * 0.4,
          size: 2.4,
          grow: 3,
          opacity: 0.85,
          color: 0xfff0c0,
          coolTo: 0xff4a12,
          windDrag: 2.5,
        });
      }
    }
  }

  /** El proyectil impactó: deja de emitir y disipa lo que queda. */
  finish(): void { this.dead = true; this.exhaustGlow.visible = false; }

  update(dt: number): boolean {
    const a = this.cloud.update(dt);
    const b = this.embers.update(dt);
    return !this.dead || a || b;
  }

  dispose(): void {
    this.cloud.dispose();
    this.embers.dispose();
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
  private readonly fireMat: THREE.SpriteMaterial;
  private readonly light: THREE.PointLight;
  private readonly smoke: PuffCloud;
  private readonly dust: PuffCloud;
  private readonly embers: PuffCloud;
  private age = 0;
  private seeded = false;
  private readonly hot = new THREE.Color(0xfff3d0);
  private readonly cold = new THREE.Color(0x8a1e06);

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly pos: THREE.Vector3,
    private readonly yieldScale: number,
    wind: WindFn,
    /** Velocidad de impacto (m/s): un tiro rasante levanta más escombros. */
    private readonly impactSpeed: number,
  ) {
    const y = yieldScale;
    this.flash = makeGlowSprite(0xffffff, 60 * y);
    this.fire = makeGlowSprite(0xfff3d0, 26 * y);
    this.fireMat = this.fire.material as THREE.SpriteMaterial;
    this.flash.position.copy(pos);
    this.fire.position.copy(pos);
    this.light = new THREE.PointLight(0xffb060, 2.2e5 * y, 2500 * y, 2);
    this.light.position.copy(pos);
    this.smoke = new PuffCloud(parent, wind, 0x2c2c2e);
    this.dust = new PuffCloud(parent, wind, 0x8a7a63);
    this.embers = new PuffCloud(parent, wind, 0xffe0a0, true);
    parent.add(this.flash, this.fire, this.light);
  }

  update(dt: number): boolean {
    const y = this.yieldScale;
    this.age += dt;
    const t = this.age;

    if (!this.seeded) {
      this.seeded = true;
      this.seedSmoke(y);
      this.seedDust(y);
      this.seedEmbers(y);
    }

    // Envolventes: flash (90 ms), bola de fuego (~1 s), luz (~1.5 s).
    const flashEnv = Math.max(0, 1 - t / 0.09);
    const fireLife = 0.9 + 0.3 * y;
    const fireEnv = Math.max(0, 1 - t / fireLife);
    (this.flash.material as THREE.SpriteMaterial).opacity = flashEnv;
    this.fireMat.opacity = fireEnv * 0.95;
    // La bola de fuego crece, ASCIENDE (flotabilidad) y se enfría de blanco
    // incandescente a rojo sucio: el ciclo real de una deflagración.
    this.fire.scale.setScalar(26 * y * (1 + 1.6 * Math.min(1, t / 0.5)));
    this.fire.position.z = this.pos.z + Math.min(1, t / fireLife) * 12 * y;
    this.fireMat.color.lerpColors(this.hot, this.cold, Math.min(1, t / fireLife));
    this.light.intensity = 2.2e5 * y * Math.max(flashEnv, fireEnv * 0.35);

    const cloudsAlive = [
      this.smoke.update(dt), this.dust.update(dt), this.embers.update(dt),
    ].some(Boolean);
    return t < 1.6 || cloudsAlive;
  }

  /** Columna/hongo de humo: bocanadas ascendentes desde el punto de impacto. */
  private seedSmoke(y: number): void {
    const nSmoke = Math.round(28 * Math.min(3, y));
    for (let i = 0; i < nSmoke; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 6 * y;
      // Las primeras bocanadas suben más rápido: forman el "sombrero".
      const lead = 1 - i / nSmoke;
      this.smoke.emit({
        pos: this.pos.clone().add(new THREE.Vector3(
          Math.cos(ang) * r, Math.sin(ang) * r, Math.random() * 4 * y,
        )),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 6,
          9 + (8 + Math.random() * 12) * y * (0.5 + lead),
        ),
        life: 6 + Math.random() * 5,
        size: 9 * y,
        grow: 4 * y,
        gravity: -0.06,
        opacity: 0.62,
        windDrag: 0.5,
      });
    }
  }

  /** Falda de polvo lateral: marca la sobrepresión rasante en el suelo. */
  private seedDust(y: number): void {
    const nDust = Math.round(22 * Math.min(3, y));
    for (let i = 0; i < nDust; i++) {
      const ang = (i / nDust) * Math.PI * 2 + Math.random() * 0.3;
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

  /**
   * Escombros y chispas: parábola REAL (gravedad plena, sin arrastre de
   * viento) y rebote en el suelo. La velocidad de eyección escala con el
   * yield y con la velocidad de impacto (un tiro rasante los reparte más).
   */
  private seedEmbers(y: number): void {
    const n = Math.round(clamp(26 * y, 10, 70));
    const v0 = 28 * Math.cbrt(y) + clamp(this.impactSpeed * 0.05, 0, 22);
    for (let i = 0; i < n; i++) {
      // Cono de eyección: casi todo entre 25º y 80º sobre la horizontal.
      const az = Math.random() * Math.PI * 2;
      const el = (25 + Math.random() * 55) * Math.PI / 180;
      const sp = v0 * (0.45 + Math.random() * 0.9);
      this.embers.emit({
        pos: this.pos.clone().add(new THREE.Vector3(0, 0, 0.6)),
        vel: new THREE.Vector3(
          Math.cos(az) * Math.cos(el) * sp,
          Math.sin(az) * Math.cos(el) * sp,
          Math.sin(el) * sp,
        ),
        life: 1.1 + Math.random() * 2.0,
        size: 1.4 + Math.random() * 1.8 * y,
        grow: 0.2,
        gravity: 1,          // parábola de verdad
        windDrag: 0.02,      // un fragmento no lo lleva el viento
        opacity: 0.95,
        color: 0xfff0c8,
        coolTo: 0x8c2a08,    // se enfría a rojo oscuro por el camino
        bounce: 0.32,
      });
    }
  }

  dispose(): void {
    this.parent.remove(this.flash, this.fire, this.light);
    this.flash.material.dispose();
    this.fire.material.dispose();
    this.smoke.dispose();
    this.dust.dispose();
    this.embers.dispose();
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

  /** Cuántos efectos hay vivos (overlay ?stats=1). */
  get liveEffects(): number { return this.effects.length; }

  /** Fogonazo + pluma + onda + humo de boca + polvo (firma de lanzamiento). */
  launchSignature(
    muzzleEnu: Vec3,
    dirEnu: Vec3,
    airDensity: number,
    scale = 1,
    category: Weapon['category'] = 'Howitzer',
  ): void {
    const pos = new THREE.Vector3(muzzleEnu.x, muzzleEnu.y, muzzleEnu.z);
    const dir = new THREE.Vector3(dirEnu.x, dirEnu.y, dirEnu.z).normalize();
    const small = category === 'SmallArms';
    const rocket = category === 'Rocket' || category === 'Missile';

    // El freno de boca (obuses y cañones) reparte gases a los lados.
    const brake = category === 'Howitzer';
    this.effects.push(new MuzzleFlashFX(this.root, pos, dir, scale, brake));

    if (!small) {
      // Frente de sobrepresión visible: la burbuja que sale de la boca.
      this.effects.push(new BlastWaveFX(this.root, pos, 34 * scale, 0.42));
      this.effects.push(new GroundShockwaveFX(this.root, pos.clone().setZ(0.4), 26 * scale, 0.9));
    }

    // Humo de boca: más denso cuanto más denso es el aire (lee AirDensity).
    // Dos poblaciones, como en la realidad: el CHORRO que sale disparado por
    // el ánima y la BOLA que se queda envolviendo la boca y tarda en irse.
    // Gris medio, no blanco: sobre cielo claro un humo casi blanco con poca
    // opacidad simplemente no se ve, y el cañonazo se quedaba sin firma.
    const smoke = new PuffCloud(this.root, this.wind, rocket ? 0xb9bcb8 : 0x6f757c);
    const n = Math.round((small ? 6 : rocket ? 40 : 26) * (airDensity / 1.225) * scale);
    for (let i = 0; i < n; i++) {
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, Math.random() * 5,
      );
      smoke.emit({
        pos: pos.clone().addScaledVector(dir, 2 + Math.random() * 3),
        vel: dir.clone().multiplyScalar(14 + Math.random() * 22).add(spread),
        life: (rocket ? 7 : 4) + Math.random() * 3,
        size: 3.2 * scale,
        grow: rocket ? 5 : 3.0,
        opacity: 0.62,
        windDrag: 1.1,
      });
    }
    if (!small) {
      const nBall = Math.round(14 * (airDensity / 1.225) * scale);
      for (let i = 0; i < nBall; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 2.5 * scale;
        smoke.emit({
          pos: pos.clone().addScaledVector(dir, Math.random() * 2).add(
            new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, (Math.random() - 0.3) * r),
          ),
          vel: dir.clone().multiplyScalar(1 + Math.random() * 5).add(
            new THREE.Vector3(Math.cos(ang) * 4, Math.sin(ang) * 4, 1 + Math.random() * 2),
          ),
          life: 5 + Math.random() * 4,
          size: 4 * scale,
          grow: 2.0,
          gravity: -0.05, // flota y se disipa
          opacity: 0.6,
          windDrag: 0.7,
        });
      }
    }
    this.effects.push(smoke);

    if (!small) {
      // Polvo levantado del suelo por la onda que rebota bajo la boca.
      const dust = new PuffCloud(this.root, this.wind, 0x9c8b70);
      const nd = Math.round(14 * scale);
      for (let i = 0; i < nd; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 10 + Math.random() * 16;
        dust.emit({
          pos: new THREE.Vector3(pos.x, pos.y, 0.3).add(
            new THREE.Vector3(Math.cos(ang) * 2, Math.sin(ang) * 2, 0),
          ),
          vel: new THREE.Vector3(Math.cos(ang) * sp, Math.sin(ang) * sp, 2 + Math.random() * 4),
          life: 2.2 + Math.random() * 1.6,
          size: 4 * scale,
          grow: 5,
          gravity: 0.1,
          opacity: 0.42,
          windDrag: 1.3,
        });
      }
      this.effects.push(dust);
    }
  }

  /**
   * P-ANI.1 — humo residual del ánima: sale despacio por la boca cuando se
   * abre la culata, unos segundos después del disparo.
   */
  boreSmoke(muzzleEnu: Vec3, dirEnu: Vec3, scale = 1): void {
    const pos = new THREE.Vector3(muzzleEnu.x, muzzleEnu.y, muzzleEnu.z);
    const dir = new THREE.Vector3(dirEnu.x, dirEnu.y, dirEnu.z).normalize();
    const smoke = new PuffCloud(this.root, this.wind, 0xc9ccd0);
    const n = Math.round(7 * scale);
    for (let i = 0; i < n; i++) {
      smoke.emit({
        pos: pos.clone().addScaledVector(dir, Math.random() * 1.5),
        vel: dir.clone().multiplyScalar(1.2 + Math.random() * 2.2)
          .add(new THREE.Vector3(0, 0, 0.8 + Math.random())),
        life: 4 + Math.random() * 3,
        size: 1.6 * scale,
        grow: 1.6,
        gravity: -0.09, // flota
        opacity: 0.34,
        windDrag: 1.0,
      });
    }
    this.effects.push(smoke);
  }

  /** Explosión de impacto escalada por yield^(1/3) + onda + anillo de polvo. */
  impactExplosion(impactEnu: Vec3, yieldScale: number, impactSpeed = 0): void {
    const pos = new THREE.Vector3(impactEnu.x, impactEnu.y, impactEnu.z);
    this.effects.push(new ImpactExplosionFX(this.root, pos, yieldScale, this.wind, impactSpeed));
    this.effects.push(new BlastWaveFX(this.root, pos, 120 * yieldScale, 0.9, 0xffe6c0));
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
