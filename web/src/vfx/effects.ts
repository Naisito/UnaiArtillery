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
import { FlareKinematics } from './flare';

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

interface PuffLease { sprite: THREE.Sprite; evict: () => void; sticky: boolean; }

class PuffPool {
  private free: THREE.Sprite[] = [];
  private live: PuffLease[] = []; // en orden de adquisición (el [0] es el más viejo)
  private created = 0;

  /** P-VIVO.8 — `sticky`: préstamo prioritario (cortinas de humo persistentes)
   *  que el robo por cap NUNCA toca: al agotarse se desaloja el más viejo NO
   *  sticky (una ráfaga de P-VIVO.2 no puede comerse la cortina). */
  acquire(evict: () => void, sticky = false): THREE.Sprite {
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
        // Cap agotado: el puff más viejo NO prioritario cede el sitio.
        const idx = this.live.findIndex((l) => !l.sticky);
        if (idx >= 0) {
          const [oldest] = this.live.splice(idx, 1);
          oldest.evict();
          sprite = this.free.pop();
        }
        if (!sprite) {
          // Todo sticky (o el dueño no liberó): crea uno fuera de cap.
          sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getPuffTexture(), transparent: true, depthWrite: false,
          }));
          this.created++;
        }
      }
    }
    sprite.visible = true;
    this.live.push({ sprite, evict, sticky });
    return sprite;
  }

  release(sprite: THREE.Sprite): void {
    const idx = this.live.findIndex((l) => l.sprite === sprite);
    if (idx >= 0) this.live.splice(idx, 1);
    sprite.visible = false;
    sprite.parent?.remove(sprite);
    sprite.material.blending = THREE.NormalBlending; // deshace la trazadora aditiva
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
    /** P-VIVO.2 — blending aditivo (trazadoras); el pool lo deshace al soltar. */
    additive?: boolean;
    /** P-VIVO.8 — préstamo prioritario del pool (humo persistente). */
    sticky?: boolean;
  }): void {
    // P-PRO.8 — sprite prestado del pool: se CONFIGURA, no se crea.
    const sprite = puffPool.acquire(() => this.evict(sprite), opts.sticky ?? false);
    const mat = sprite.material;
    mat.color.set(opts.color ?? this.color);
    mat.opacity = opts.opacity ?? 0.5;
    mat.rotation = Math.random() * Math.PI * 2; // rompe el patrón radial
    mat.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
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

  constructor(
    private readonly parent: THREE.Object3D,
    pos: THREE.Vector3,
    private readonly scale: number,
  ) {
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
    this.light.intensity = 60000 * this.scale * env; // la escala del arma se mantiene
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
  /** P-VIVO.2 — duración del trazador: la composición pirotécnica se consume. */
  static readonly TRACER_BURNOUT_S = 3.5;

  private readonly cloud: PuffCloud;
  private readonly exhaustGlow: THREE.Sprite;
  private emitAccum = 0;
  private dead = false;
  private tracer = false;
  private tracerAge = 0;

  constructor(parent: THREE.Object3D, wind: WindFn) {
    this.cloud = new PuffCloud(parent, wind, 0xf4f8ff);
    this.exhaustGlow = makeGlowSprite(0xffc27a, 10);
    this.exhaustGlow.visible = false;
    parent.add(this.exhaustGlow);
  }

  /** P-VIVO.2 — variante trazadora: línea aditiva rojo-anaranjada SIEMPRE
   *  visible (no depende de Mach) hasta consumirse a los ~3.5 s.
   *  P-VIVO.4 — `initialAgeS`: en un tramo de rebote el trazador ya llevaba
   *  ardiendo el tiempo del tramo anterior. */
  setTracer(on: boolean, initialAgeS = 0): void {
    this.tracer = on;
    this.tracerAge = initialAgeS;
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

    // P-VIVO.2 — trazadora: emisión aditiva continua, independiente del Mach.
    if (this.tracer) {
      this.tracerAge += dt;
      if (this.tracerAge > TrailFX.TRACER_BURNOUT_S) return; // consumida
      this.emitAccum += 110 * dt;
      while (this.emitAccum >= 1) {
        this.emitAccum -= 1;
        this.cloud.emit({
          pos,
          vel: new THREE.Vector3(0, 0, 0),
          life: 0.3,
          size: 1.6,
          grow: 0.4,
          gravity: 0,
          opacity: 0.95,
          color: 0xff7a34, // rojo-anaranjado pirotécnico
          additive: true,
          windDrag: 0,
        });
      }
      return;
    }

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
    /** P-VIVO.5 — sin falda de polvo (explosión EN una fachada: no hay suelo). */
    private readonly withDust = true,
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
      const nDust = this.withDust ? Math.round(20 * Math.min(3, y)) : 0;
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
//  P-VIVO.4 — Splash de agua: columna blanca + anillos concéntricos + spray.
//
//  SIN cráter, SIN quemadura, SIN falda de polvo: el agua se traga el tiro y
//  devuelve una columna vertical (sprites del pool apilados, tinte
//  azul-blanco), 3 anillos expansivos a ras de agua y spray que CAE (gravedad
//  positiva, al revés que el humo). Escala con yield^(1/3) como la explosión.
// ---------------------------------------------------------------------------
class WaterSplashFX implements Effect {
  private readonly column: PuffCloud;
  private readonly spray: PuffCloud;
  private readonly rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; delay: number }[] = [];
  private age = 0;
  private seeded = false;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly pos: THREE.Vector3,
    private readonly yieldScale: number,
    wind: WindFn,
  ) {
    this.column = new PuffCloud(parent, wind, 0xe8f4ff);
    this.spray = new PuffCloud(parent, wind, 0xd0e8f8);
    // 3 anillos concéntricos escalonados a ras de agua.
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd6ecff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 48), mat);
      mesh.position.copy(pos).add(new THREE.Vector3(0, 0, 0.3));
      parent.add(mesh);
      this.rings.push({ mesh, mat, delay: i * 0.22 });
    }
  }

  update(dt: number): boolean {
    const y = this.yieldScale;
    this.age += dt;

    if (!this.seeded) {
      this.seeded = true;
      // Columna vertical: bocanadas casi sin dispersión lateral, muy rápidas.
      const nCol = Math.round(16 * Math.min(3, y));
      for (let i = 0; i < nCol; i++) {
        this.column.emit({
          pos: this.pos.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 2 * y, (Math.random() - 0.5) * 2 * y, 1 + Math.random() * 3,
          )),
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (22 + Math.random() * 18) * y,
          ),
          life: 1.6 + Math.random() * 0.8,
          size: 5 * y,
          grow: 4 * y,
          gravity: 0.55, // el agua CAE — no flota como el humo
          opacity: 0.7,
          windDrag: 0.4,
        });
      }
      // Spray lateral bajo que cae enseguida.
      const nSpray = Math.round(12 * Math.min(3, y));
      for (let i = 0; i < nSpray; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = (10 + Math.random() * 8) * y;
        this.spray.emit({
          pos: this.pos.clone(),
          vel: new THREE.Vector3(Math.cos(ang) * speed, Math.sin(ang) * speed, 6 + Math.random() * 6),
          life: 1.1 + Math.random() * 0.6,
          size: 3 * y,
          grow: 3 * y,
          gravity: 0.8,
          opacity: 0.55,
          windDrag: 0.8,
        });
      }
    }

    // Anillos expansivos escalonados (~2 s de vida cada uno).
    for (const r of this.rings) {
      const t = Math.min(1, Math.max(0, (this.age - r.delay) / 2.0));
      const radius = 1 + 55 * this.yieldScale * Math.sqrt(t);
      r.mesh.scale.setScalar(radius);
      r.mat.opacity = t <= 0 || t >= 1 ? 0 : 0.5 * (1 - t);
    }

    const cloudsAlive = [this.column.update(dt), this.spray.update(dt)].some(Boolean);
    return this.age < 2.8 || cloudsAlive;
  }

  dispose(): void {
    this.column.dispose();
    this.spray.dispose();
    for (const r of this.rings) {
      this.parent.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
//  P-VIVO.8 — Bengala ILLUM bajo paracaídas.
//
//  Sprite aditivo blanco-cálido parpadeante + THREE.PointLight de ~800 m que
//  desciende a 4.5 m/s DERIVANDO con el viento real (FlareKinematics, perfil
//  inyectado) durante ~50 s. TRUCO DOCUMENTADO: la PointLight de Three NO
//  ilumina el globo de Cesium (pipelines de materiales separados) — solo los
//  objetos Three (cañón, camión, cráteres, proyectiles). Se compensa con un
//  "disco de luz" falso: un sprite aditivo suave proyectado en el suelo que
//  sigue a la bengala y vende la iluminación del terreno.
// ---------------------------------------------------------------------------
export class FlareFX implements Effect {
  private readonly kin: FlareKinematics;
  private readonly glow: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly light: THREE.PointLight;
  private readonly groundDisc: THREE.Sprite;
  private age = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    startEnu: Vec3,
    private readonly groundZ: number,
    wind: WindFn,
  ) {
    // El perfil que inyectamos muestrea el viento REAL a la altitud de la
    // bengala (la deriva cambia al cruzar capas: es la gracia).
    this.kin = new FlareKinematics(
      { x: startEnu.x, y: startEnu.y, z: startEnu.z },
      (z) => {
        const w = wind(new Vec3(startEnu.x, startEnu.y, z));
        return { x: w.x, y: w.y };
      },
    );
    this.glow = makeGlowSprite(0xfff2d0, 22);
    this.halo = makeGlowSprite(0xffe9b0, 60);
    this.light = new THREE.PointLight(0xfff0c8, 2.6e5, 800, 2);
    this.groundDisc = makeGlowSprite(0xffedbe, 240);
    (this.groundDisc.material as THREE.SpriteMaterial).opacity = 0.16;
    parent.add(this.glow, this.halo, this.light, this.groundDisc);
  }

  update(dt: number): boolean {
    this.age += dt;
    const p = this.kin.at(this.age);
    if (!p.alive) return false;
    // Parpadeo pirotécnico: dos senos inconmensurables + algo de ruido.
    const flicker =
      0.82 + 0.12 * Math.sin(this.age * 23.0) + 0.06 * Math.sin(this.age * 7.7) +
      0.05 * (Math.random() - 0.5);
    const k = p.intensity * flicker;
    this.glow.position.set(p.x, p.y, p.z);
    this.halo.position.set(p.x, p.y, p.z);
    this.light.position.set(p.x, p.y, p.z);
    (this.glow.material as THREE.SpriteMaterial).opacity = k;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.35 * k;
    this.light.intensity = 2.6e5 * k;
    // Disco de luz falso a ras de suelo, bajo la bengala; encoge al bajar.
    const height = Math.max(10, p.z - this.groundZ);
    this.groundDisc.position.set(p.x, p.y, this.groundZ + 1.5);
    this.groundDisc.scale.setScalar(Math.max(60, height * 0.9));
    (this.groundDisc.material as THREE.SpriteMaterial).opacity = 0.16 * p.intensity;
    return true;
  }

  dispose(): void {
    this.parent.remove(this.glow, this.halo, this.light, this.groundDisc);
    this.glow.material.dispose();
    this.halo.material.dispose();
    this.groundDisc.material.dispose();
  }
}

// ---------------------------------------------------------------------------
//  P-VIVO.8 — Cortina de humo SMOKE.
//
//  8-12 nubes GRANDES y persistentes (~90 s, re-alimentadas cada pocos
//  segundos) formando una línea perpendicular al rumbo de llegada, que
//  derivan con el viento de superficie (PuffCloud ya relaja su velocidad
//  hacia el viento local). Préstamos `sticky` del pool: una ráfaga de
//  P-VIVO.2 no puede robarle los sprites a la cortina.
// ---------------------------------------------------------------------------
export class SmokeScreenFX implements Effect {
  static readonly LIFE_S = 90;

  private readonly cloud: PuffCloud;
  private readonly anchors: THREE.Vector3[] = [];
  private age = 0;
  private nextFeed = 0;

  constructor(
    parent: THREE.Object3D,
    centerEnu: Vec3,
    bearingDeg: number,
    wind: WindFn,
    yieldScale = 1,
  ) {
    this.cloud = new PuffCloud(parent, wind, 0xdadfe2);
    // Línea perpendicular al rumbo: 5 anclas separadas ~22 m (~90 m de frente).
    const az = (bearingDeg * Math.PI) / 180;
    const perp = { x: Math.cos(az), y: -Math.sin(az) };
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 22 * Math.max(0.7, yieldScale);
      this.anchors.push(new THREE.Vector3(
        centerEnu.x + perp.x * t, centerEnu.y + perp.y * t, centerEnu.z + 2,
      ));
    }
  }

  /** Cada ancla mantiene 2-3 nubes vivas: re-alimenta cada ~7 s. */
  private feed(initial: boolean): void {
    for (const a of this.anchors) {
      const count = initial ? 2 : 1;
      for (let i = 0; i < count; i++) {
        this.cloud.emit({
          pos: a.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, Math.random() * 6,
          )),
          vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 1.2),
          life: 16 + Math.random() * 6,
          size: 16,
          grow: 1.6,
          gravity: -0.015, // el humo blanco flota despacio
          opacity: 0.55,
          windDrag: 0.6,
          sticky: true, // prioridad en el pool: la cortina no se desmonta
        });
      }
    }
  }

  update(dt: number): boolean {
    this.age += dt;
    if (this.age >= this.nextFeed && this.age < SmokeScreenFX.LIFE_S) {
      this.feed(this.nextFeed === 0);
      this.nextFeed = this.age + 7;
    }
    const alive = this.cloud.update(dt);
    return this.age < SmokeScreenFX.LIFE_S || alive;
  }

  dispose(): void {
    this.cloud.dispose();
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

  /**
   * P-VIVO.2 — firma de ráfaga compartida: 1 fogonazo + 1 bocanada por cada
   * 3 disparos (nada de humo individual: a 9 disparos/s saturaría el pool).
   */
  burstFlash(muzzleEnu: Vec3, dirEnu: Vec3, scale = 0.6): void {
    const pos = new THREE.Vector3(muzzleEnu.x, muzzleEnu.y, muzzleEnu.z);
    this.effects.push(new MuzzleFlashFX(this.root, pos, scale));
    const puff = new PuffCloud(this.root, this.wind, 0xb9bdc2);
    const dir = new THREE.Vector3(dirEnu.x, dirEnu.y, dirEnu.z).normalize();
    puff.emit({
      pos: pos.clone().addScaledVector(dir, 1.2),
      vel: dir.clone().multiplyScalar(9).add(new THREE.Vector3(0, 0, 1.5)),
      life: 2.2,
      size: 1.6 * scale,
      grow: 2.4,
      opacity: 0.4,
      windDrag: 1.3,
    });
    this.effects.push(puff);
  }

  /** Explosión de impacto escalada por yield^(1/3) + anillo de polvo. */
  impactExplosion(impactEnu: Vec3, yieldScale: number): void {
    const pos = new THREE.Vector3(impactEnu.x, impactEnu.y, impactEnu.z);
    this.effects.push(new ImpactExplosionFX(this.root, pos, yieldScale, this.wind));
    this.effects.push(new GroundShockwaveFX(this.root, pos, 90 * yieldScale, 1.6));
  }

  /** P-VIVO.4 — splash de agua: columna + anillos + spray, SIN cráter. */
  waterSplash(impactEnu: Vec3, yieldScale: number): void {
    const pos = new THREE.Vector3(impactEnu.x, impactEnu.y, impactEnu.z);
    this.effects.push(new WaterSplashFX(this.root, pos, yieldScale, this.wind));
  }

  /** P-VIVO.5 — explosión EN una fachada/tejado: bola de fuego + humo, sin
   *  falda de polvo, sin anillo de suelo y sin cráter. */
  structureExplosion(impactEnu: Vec3, yieldScale: number): void {
    const pos = new THREE.Vector3(impactEnu.x, impactEnu.y, impactEnu.z);
    this.effects.push(new ImpactExplosionFX(this.root, pos, yieldScale, this.wind, false));
  }

  /** P-VIVO.8 — bengala ILLUM colgada del viento real (~50 s de luz). */
  flare(startEnu: Vec3, groundZ: number): void {
    this.effects.push(new FlareFX(this.root, startEnu, groundZ, this.wind));
  }

  /** P-VIVO.8 — cortina de humo perpendicular al rumbo (~90 s, deriva). */
  smokeScreen(centerEnu: Vec3, bearingDeg: number, yieldScale = 1): void {
    this.effects.push(new SmokeScreenFX(this.root, centerEnu, bearingDeg, this.wind, yieldScale));
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
