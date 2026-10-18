// ============================================================================
//  GunModel.ts — El arma que apunta EN VIVO, pintada DENTRO de Cesium.
//  [P-PRO.1 → V2 / 3D-CORE]
//
//  V2: el modelo sale del registro de plataformas (models/platforms: M777A2,
//  M109A7, 2S7, M120, M270, HIMARS, armas ligeras) como rig Three articulado
//  (contrato models/rig.ts) y el runtime (models/runtime) lo hornea a GLB y
//  lo carga como Cesium.Model: luz solar real, sombras sobre el terreno y
//  oclusión con el relieve. Mientras carga —o si Cesium falla, o con
//  `?models=three`— se ve la copia horneada en el overlay Three (nunca hay
//  hueco sin arma). Se suma el atrezo de batería (dotación, munición,
//  cargas, red de camuflaje) en las piezas de tubo.
//
//  API pública (la de siempre + extras):
//    new GunModel(parent, weapon, opts?)   parent = overlay.enuRoot
//    setWeapon(weapon, weaponId?)          (weaponId se infiere del nombre)
//    update(dt, azDeg, elDeg)              puntería + retroceso + animación
//    fireRecoil()                          culatazo (~60 ms) + recuperación
//    muzzleWorldEnu()                      boca EXACTA (de las matrices del rig)
//    setFrame(frame) · setPropsVisible(b) · muzzleHeightM(el?) · dispose()
// ============================================================================
import * as THREE from 'three';
import { Vec3, Weapon, WeaponCatalog } from './ballistics';
import type { WeaponId } from './ballistics';
import type { GeoFrame } from './frame';
import { ModelKit } from './models/kit';
import { PLATFORM_BUILDERS, PLATFORM_OF } from './models/platforms';
import { placeholderRig } from './models/platforms/_placeholder';
import { buildBatteryProps } from './models/props';
import { DEG, type PlatformKey, type PlatformRig } from './models/rig';
import { ArticulatedModel, type RenderPath } from './models/runtime/ArticulatedModel';
import { frameProvider, groundSampler, type ModelRenderMode } from './models/runtime/context';

/** Versión del contenido de los modelos (invalida la caché de GLB). */
const MODEL_REV = 1;

export interface GunModelOptions {
  /** Arma (si no, se infiere de weapon.name). */
  weaponId?: WeaponId;
  /** Atrezo de batería visible (defecto true). */
  props?: boolean;
  /** 'three' fuerza el overlay; 'auto' usa Cesium si está configurado. */
  mode?: ModelRenderMode;
}

/** Envolvente del culatazo y del cabeceo por familia de plataforma. */
export interface RecoilProfile {
  /** Carrera hacia atrás (s). */
  strokeS: number;
  /** Pausa en retroceso máximo (s). */
  holdS: number;
  /** Recuperación hidroneumática (s). */
  returnS: number;
  /** Cabeceo de la suspensión/afuste (grados, pico). */
  rockDeg: number;
  rockHz: number;
  /** Hundimiento vertical (m, pico). */
  squatM: number;
}

export const RECOIL_PROFILES: Record<'towed' | 'sp' | 'mortar' | 'launcher' | 'small', RecoilProfile> = {
  towed: { strokeS: 0.06, holdS: 0.05, returnS: 0.85, rockDeg: 0.35, rockHz: 2.4, squatM: 0.03 },
  sp: { strokeS: 0.06, holdS: 0.04, returnS: 0.7, rockDeg: 0.6, rockHz: 1.7, squatM: 0.04 },
  mortar: { strokeS: 0.03, holdS: 0.0, returnS: 0.25, rockDeg: 0.25, rockHz: 4.0, squatM: 0.025 },
  launcher: { strokeS: 0.05, holdS: 0.0, returnS: 0.3, rockDeg: 0.45, rockHz: 1.5, squatM: 0.03 },
  small: { strokeS: 0.012, holdS: 0.0, returnS: 0.06, rockDeg: 0.0, rockHz: 0, squatM: 0 },
};

/**
 * Envolvente del retroceso 0..1 a `t` s del disparo: carrera rápida
 * (seno, ~60 ms), pausa breve y recuperación con frenado al final (coseno).
 */
export function recoilEnvelope(t: number, p: RecoilProfile): number {
  if (!(t >= 0) || !Number.isFinite(t)) return 0;
  if (t < p.strokeS) return Math.sin((t / p.strokeS) * (Math.PI / 2));
  t -= p.strokeS;
  if (t < p.holdS) return 1;
  t -= p.holdS;
  if (t < p.returnS) return 0.5 * (1 + Math.cos(Math.PI * (t / p.returnS)));
  return 0;
}

/** Familia de retroceso de cada plataforma. */
export function recoilFamily(key: PlatformKey): keyof typeof RECOIL_PROFILES {
  switch (key) {
    case 'm777': return 'towed';
    case 'm109a7': case '2s7-pion': return 'sp';
    case 'mortar-m120': return 'mortar';
    case 'm270-mlrs': case 'm142-himars': return 'launcher';
    default: return 'small';
  }
}

/**
 * Carrera máxima (m) de una masa de silueta `hull` (y, z en el espacio de
 * recoil) con los muñones a `trunnionZ` sobre el suelo, a `elevationDeg`.
 */
export function strokeLimitFor(hull: Array<[number, number]>, trunnionZ: number, elevationDeg: number,
  clearance = 0.06): number {
  const el = elevationDeg * DEG;
  const s = Math.sin(el), c = Math.cos(el);
  if (s < 0.05 || hull.length === 0) return Number.POSITIVE_INFINITY;
  let lim = Number.POSITIVE_INFINITY;
  for (const [y, z] of hull) lim = Math.min(lim, (trunnionZ - clearance + y * s + z * c) / s);
  return Math.max(0, lim);
}

/** Envolvente convexa (cadena monótona) de la silueta (y, z) de recoil. */
function recoilHull(rig: PlatformRig): Array<[number, number]> {
  const inv = new THREE.Matrix4().copy(rig.recoil.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pts: Array<[number, number]> = [];
  rig.recoil.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry?.attributes?.position : undefined;
    if (!pos) return;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      pts.push([v.y, v.z]);
    }
  });
  if (pts.length < 3) return pts;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lowerH: Array<[number, number]> = [];
  for (const p of pts) {
    while (lowerH.length >= 2 && cross(lowerH[lowerH.length - 2], lowerH[lowerH.length - 1], p) <= 0) lowerH.pop();
    lowerH.push(p);
  }
  const upperH: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upperH.length >= 2 && cross(upperH[upperH.length - 2], upperH[upperH.length - 1], p) <= 0) upperH.pop();
    upperH.push(p);
  }
  return lowerH.slice(0, -1).concat(upperH.slice(0, -1));
}

/** Plano z = a·x + b·y + c por mínimos cuadrados (ignora muestras null). */
export function fitPlane(pts: Array<[number, number]>, zs: Array<number | null>): { a: number; b: number; c: number } | null {
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  pts.forEach(([x, y], i) => {
    const z = zs[i];
    if (z === null || z === undefined || !Number.isFinite(z)) return;
    n++; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
  });
  if (n < 3) return null;
  // Sistema normal 3×3 (Cramer).
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const r = [sxz, syz, sz];
  const det3 = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det3(m);
  if (Math.abs(D) < 1e-9) return null;
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)));
  return { a: det3(col(0)) / D, b: det3(col(1)) / D, c: det3(col(2)) / D };
}

let idByName: Map<string, WeaponId> | null = null;
/** WeaponId de un Weapon por su nombre (los Weapon no llevan id). */
export function weaponIdOf(weapon: Weapon): WeaponId {
  if (!idByName) {
    idByName = new Map();
    for (const id of WeaponCatalog.ids()) idByName.set(WeaponCatalog.get(id).name, id);
  }
  const hit = idByName.get(weapon.name);
  if (hit) return hit;
  // Arma fuera de catálogo: la plataforma más parecida por categoría.
  switch (weapon.category) {
    case 'Mortar': return 'mortar120';
    case 'Rocket': return 'gmlrs';
    case 'Missile': return 'tacticalMissile';
    case 'SmallArms': return weapon.round.diameter > 0.01 ? 'm2browning' : 'rifle556';
    default: return 'm777';
  }
}

interface Built {
  key: PlatformKey;
  weaponId: WeaponId;
  kit: ModelKit;
  rig: PlatformRig;
  model: ArticulatedModel;
  props: THREE.Object3D[];
  profile: RecoilProfile;
  rootPos: THREE.Vector3;
  rootQuat: THREE.Quaternion;
  /** Envolvente convexa (y, z) de la masa que retrocede (local de recoil). */
  hull: Array<[number, number]>;
  /** Altura del eje de muñones sobre el suelo (m, en reposo). */
  trunnionZ: number;
}

export class GunModel {
  /** Contenedor en el overlay (copia Three del modelo). */
  readonly group = new THREE.Group();

  private built: Built | null = null;
  private azimuthDeg = 0;
  private elevationDeg = 0;
  private sinceFire = Number.POSITIVE_INFINITY;
  private clock = 0;
  private recoilNow = 0;
  private propsOn: boolean;
  private frameOverride: GeoFrame | null = null;
  private recoilOverride: number | null = null;
  /** Asiento en el terreno: inclinación del plano ajustado + desnivel. */
  private readonly tilt = new THREE.Quaternion();
  private readonly tiltInv = new THREE.Quaternion();
  private groundOffset = 0;
  private groundToken = 0;
  private groundFrame: GeoFrame | null = null;
  /** Puntería en el marco del rig (tras compensar la inclinación). */
  private rigAzDeg = 0;
  private rigElDeg = 0;
  private readonly mode: ModelRenderMode;

  // Escratch (cero asignaciones por frame).
  private readonly m4 = new THREE.Matrix4();
  private readonly v3 = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly qRock = new THREE.Quaternion();

  constructor(private readonly parent: THREE.Object3D, weapon: Weapon, opts: GunModelOptions = {}) {
    this.group.name = 'GunModel';
    parent.add(this.group);
    this.propsOn = opts.props ?? true;
    this.mode = opts.mode ?? 'auto';
    this.build(weapon, opts.weaponId ?? weaponIdOf(weapon));
  }

  /** Reconstruye el modelo al cambiar de arma (dispose limpio). */
  setWeapon(weapon: Weapon, weaponId?: WeaponId): void {
    const id = weaponId ?? weaponIdOf(weapon);
    if (this.built && this.built.weaponId === id) return;
    this.clear();
    this.build(weapon, id);
  }

  /** Plataforma vigente. */
  get platform(): PlatformKey { return this.built?.key ?? 'm777'; }

  /** Camino de render vigente ('cesium' cuando ya pinta Cesium). */
  get renderPath(): RenderPath { return this.built?.model.path ?? 'three'; }

  /** Promesa del modelo vigente listo (camino final). */
  get ready(): Promise<RenderPath> { return this.built?.model.ready ?? Promise.resolve('three'); }

  /** Rig vigente (Model Lab / depuración). */
  get rig(): PlatformRig | null { return this.built?.rig ?? null; }

  /** Modelo articulado vigente (horneado + vista Cesium/Three). */
  get articulated(): ArticulatedModel | null { return this.built?.model ?? null; }

  /** Fija la envolvente de retroceso 0..1 (Model Lab); null = la del disparo. */
  previewRecoil(r01: number | null): void {
    this.recoilOverride = r01 === null ? null : Math.max(0, Math.min(1, r01));
  }

  /** Puntería en vivo + retroceso + animación secundaria + sincronía. */
  update(dt: number, azimuthDeg: number, elevationDeg: number): void {
    const b = this.built;
    if (!b) return;
    this.azimuthDeg = azimuthDeg;
    this.elevationDeg = elevationDeg;
    this.clock += dt;
    this.sinceFire += dt;

    this.watchGround();

    // Puntería ordenada (ENU real) → ángulos en el marco del rig inclinado:
    // como el apuntador real, que nivela y compensa el desnivel del afuste,
    // el tubo queda EXACTAMENTE en la dirección ordenada.
    const az = azimuthDeg * DEG, el = elevationDeg * DEG;
    const d = this.dir.set(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el))
      .applyQuaternion(this.tiltInv);
    this.rigAzDeg = Math.atan2(d.x, d.y) / DEG;
    this.rigElDeg = Math.asin(Math.max(-1, Math.min(1, d.z))) / DEG;

    const env = this.recoilOverride ?? recoilEnvelope(this.sinceFire, b.profile);
    this.recoilNow = env * Math.min(b.rig.recoilStrokeM, this.strokeLimit(b, this.rigElDeg));

    const { rig } = b;
    rig.traverse.rotation.z = -this.rigAzDeg * DEG;
    rig.elevation.rotation.x = this.rigElDeg * DEG;
    rig.recoil.position.y = -this.recoilNow;

    // Lo que el freno no absorbe lo come el afuste/suspensión: hundimiento
    // y cabeceo amortiguado alrededor del eje transversal al tiro.
    const t = this.sinceFire;
    const p = b.profile;
    let rock = 0, squat = 0;
    if (t < 3 && p.rockDeg > 0) {
      rock = p.rockDeg * DEG * Math.exp(-t / 0.35) * Math.sin(2 * Math.PI * p.rockHz * t);
      squat = -p.squatM * (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.25));
    }
    rig.root.position.set(b.rootPos.x, b.rootPos.y, b.rootPos.z + squat + this.groundOffset);
    rig.root.quaternion.copy(this.tilt).multiply(b.rootQuat);
    if (rock !== 0) {
      this.axis.set(Math.cos(az), -Math.sin(az), 0);
      rig.root.quaternion.premultiply(this.qRock.setFromAxisAngle(this.axis, rock));
    }

    rig.animate?.({
      t: this.clock, dt, azimuthDeg: this.rigAzDeg, elevationDeg: this.rigElDeg,
      recoil01: env, sinceFireS: this.sinceFire,
    });
    b.model.sync();
  }

  /** Dispara el retroceso visual del tubo. */
  fireRecoil(): void { this.sinceFire = 0; }

  /**
   * Punta del tubo en coordenadas ENU, EXACTA respecto al tubo pintado: se
   * compone la cadena de matrices del rig (puntería, retroceso, cabeceo).
   */
  muzzleWorldEnu(): Vec3 {
    const b = this.built;
    if (!b) return new Vec3(0, 0, 3);
    this.worldOf(b.rig.recoil, this.m4);
    const v = this.v3.copy(b.rig.muzzleLocal).applyMatrix4(this.m4);
    return new Vec3(v.x, v.y, v.z);
  }

  /**
   * Altura de la boca sobre el suelo (m) en reposo para una elevación —
   * para lanzar el proyectil físico desde la boca real:
   * `service.muzzleHeightM = gun.muzzleHeightM(panel.elevationDeg)`.
   */
  muzzleHeightM(elevationDeg = this.elevationDeg): number {
    const b = this.built;
    if (!b) return 3;
    const pivot = this.v3;
    this.worldOf(b.rig.elevation, this.m4);
    pivot.setFromMatrixPosition(this.m4);
    const ml = b.rig.muzzleLocal;
    const el = elevationDeg * DEG;
    const elevZ = pivot.z;
    return elevZ + ml.y * Math.sin(el) + ml.z * Math.cos(el);
  }

  /** Fija el marco ENU explícitamente (si no, el del runtime/servicio). */
  setFrame(frame: GeoFrame): void {
    this.frameOverride = frame;
  }

  /** Inclinación actual del asiento en el terreno (grados, 0 = llano). */
  get groundTiltDeg(): number {
    return (2 * Math.acos(Math.min(1, Math.abs(this.tilt.w)))) / DEG;
  }

  /** Re-asienta si el marco ENU cambió (re-anclaje, edificios 3D…). */
  private watchGround(): void {
    const f = this.frameOverride ?? frameProvider()?.() ?? null;
    if (f !== this.groundFrame) {
      this.groundFrame = f;
      void this.fitGround();
    }
  }

  /**
   * Asienta el arma en el relieve: muestrea el suelo visual en un anillo de
   * la huella, ajusta un plano por mínimos cuadrados (z = a·x + b·y + c) e
   * inclina el rig sobre él (tope 15°); c corrige el desnivel entre el suelo
   * de la física y el visual (teselas 3D).
   */
  async fitGround(): Promise<void> {
    const sample = groundSampler();
    const b = this.built;
    if (!sample || !b) return;
    const token = ++this.groundToken;
    const R = Math.max(2, Math.min(5, b.rig.footprintM * 0.6));
    const pts: Array<[number, number]> = [[0, 0]];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      pts.push([Math.sin(a) * R, Math.cos(a) * R]);
    }
    let zs: Array<number | null>;
    try {
      zs = await Promise.all(pts.map(([x, y]) => sample(x, y)));
    } catch {
      return;
    }
    if (token !== this.groundToken) return;
    const fit = fitPlane(pts, zs);
    if (!fit) return;
    const n = new THREE.Vector3(-fit.a, -fit.b, 1).normalize();
    const maxTilt = 15 * DEG;
    const ang = Math.acos(n.z);
    if (ang > maxTilt) {
      const h = Math.hypot(n.x, n.y);
      n.set((n.x / h) * Math.sin(maxTilt), (n.y / h) * Math.sin(maxTilt), Math.cos(maxTilt));
    }
    this.tilt.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.tiltInv.copy(this.tilt).invert();
    this.groundOffset = Math.max(-3, Math.min(3, fit.c));
    this.update(0, this.azimuthDeg, this.elevationDeg);
  }

  /** Atrezo de batería (dotación, munición, red) visible u oculto. */
  setPropsVisible(v: boolean): void {
    this.propsOn = v;
    const b = this.built;
    if (!b) return;
    for (const p of b.props) b.model.setNodeVisible(p, v);
  }

  get propsVisible(): boolean { return this.propsOn; }

  dispose(): void {
    this.clear();
    this.parent.remove(this.group);
  }

  // -------------------------------------------------------------------------

  private clear(): void {
    if (!this.built) return;
    this.built.model.dispose();
    this.built.kit.dispose();
    this.built = null;
  }

  private build(weapon: Weapon, weaponId: WeaponId): void {
    const key: PlatformKey = PLATFORM_OF[weaponId] ?? 'm777';
    const kit = new ModelKit();
    let rig: PlatformRig;
    try {
      rig = PLATFORM_BUILDERS[key]({ kit, weaponId, weapon });
    } catch (err) {
      // Un builder roto nunca deja la batería sin arma.
      console.error(`[GunModel] builder de ${key} falló — uso el provisional`, err);
      rig = placeholderRig({ kit, weaponId, weapon }, {
        hullW: 2.4, hullL: 5, hullH: 0.8, pivotY: 0.3, pivotZ: 1.5, barrelL: 5, barrelR: 0.08,
      });
    }

    // Silueta (y, z) de la masa que retrocede: límite de carrera con la QE.
    rig.root.updateMatrixWorld(true);
    const hull = recoilHull(rig);
    const trunnionZ = new THREE.Vector3().setFromMatrixPosition(rig.elevation.matrixWorld).z;

    let props: THREE.Object3D[] = [];
    try {
      props = buildBatteryProps({ kit, key, rig, weapon, weaponId });
    } catch (err) {
      console.warn('[GunModel] atrezo no disponible', err);
    }

    const animated: THREE.Object3D[] = [rig.traverse, rig.elevation, rig.recoil, ...(rig.extraAnimated ?? [])];
    const model = new ArticulatedModel({
      key: `gun:${key}:${weaponId}:r${MODEL_REV}:p${props.length}`,
      root: rig.root,
      animated,
      keep: props,
      threeParent: this.group,
      mode: this.mode,
      frame: () => this.frameOverride,
    });

    this.built = {
      key, weaponId, kit, rig, model, props,
      profile: RECOIL_PROFILES[recoilFamily(key)],
      rootPos: rig.root.position.clone(),
      rootQuat: rig.root.quaternion.clone(),
      hull,
      trunnionZ,
    };
    if (!this.propsOn) this.setPropsVisible(false);
    this.sinceFire = Number.POSITIVE_INFINITY;
    this.update(0, this.azimuthDeg, this.elevationDeg);
  }

  /**
   * Carrera máxima sin que la culata atraviese el suelo a esta elevación:
   * para cada vértice (y, z) de la envolvente de la masa que retrocede,
   * zMuñones + (y − s)·sin(el) + z·cos(el) ≥ holgura.
   */
  private strokeLimit(b: Built, elevationDeg: number): number {
    return strokeLimitFor(b.hull, b.trunnionZ, elevationDeg);
  }

  /** Matriz "mundo" (ENU) de un nodo del rig: cadena de matrices locales. */
  private worldOf(node: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    node.updateMatrix();
    out.copy(node.matrix);
    for (let p = node.parent; p; p = p.parent) {
      p.updateMatrix();
      out.premultiply(p.matrix);
    }
    return out;
  }
}
