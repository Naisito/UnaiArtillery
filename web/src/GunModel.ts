// ============================================================================
//  GunModel.ts — Modelo 3D procedural del arma, animado como maquinaria real.
//  [P-PRO.1 + P-ANI.1]
//
//  La batería no es un punto invisible: geometría Three.js por categoría
//  (mortero / obús remolcado / obús de torreta / cohete / misil / arma ligera),
//  cero assets binarios. El grupo vive en overlay.enuRoot en el origen ENU.
//  Convención local: +y = adelante (norte con azimut 0), +z = arriba; el
//  azimut gira la parte móvil sobre z (si traverseDeg < 360 gira el arma
//  ENTERA: los morteros no tienen torreta) y el tubo se eleva en su pivote.
//
//  Lo que se ANIMA (todo visual: la física no se toca):
//
//   1. SERVOS DE PUNTERÍA — el arma ya no se teletransporta a la orden del
//      panel: gira a su velocidad real (una torreta de M109 hace 12 º/s; un
//      2S7 a manivela, 3 º/s) con rampa de aceleración y frenada. `slewRate`
//      alimenta el zumbido del motor de puntería en el audio.
//   2. RETROCESO EN DOS FASES — culatazo casi instantáneo (~70 ms) y
//      contra-retroceso lento del recuperador (~0.5 s) que termina con el
//      golpe de llegada a batería. La suspensión se hunde y cabecea.
//   3. CICLO DE CARGA — la cuña de culata baja, la bandeja/atacador mete el
//      proyectil, la culata cierra. Los tiempos escalan con `reloadTime` y
//      cada paso emite un evento para el audio mecánico.
//   4. CASQUILLO EYECTADO — en armas ligeras sale volando con física y rebota.
//   5. MUNICIÓN VISIBLE — los cohetes se ven en las bocas del pod y
//      desaparecen al salir; la tapa del canister del misil se abre.
//
//  La boca REAL del tubo se expone con muzzleWorldEnu() (analítica, sin pasar
//  por matrices de Three): de ahí nacen fogonazo, humo y cámara de cabina.
// ============================================================================
import * as THREE from 'three';
import { Vec3, Weapon } from './ballistics';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pasos del ciclo mecánico que el audio sonoriza. */
export type GunMechEvent = 'breechOpen' | 'load' | 'breechClose' | 'casing';

/** Velocidades de los servos por categoría (º/s) y tiempos del ciclo. */
interface ServoSpec {
  traverse: number;   // º/s en azimut
  elevation: number;  // º/s en elevación
  accel: number;      // º/s² de rampa (arranque y frenada del motor)
}

export class GunModel {
  /** Raíz del modelo (hijo de enuRoot, en el origen ENU de la batería). */
  readonly group = new THREE.Group();

  /** Evento del ciclo mecánico (culata, carga, casquillo) — lo oye el audio. */
  onMech?: (event: GunMechEvent) => void;
  /** Humo residual que sale del ánima al abrir la culata (lo pinta el VFX). */
  onBoreSmoke?: (posEnu: Vec3, dirEnu: Vec3) => void;

  // -- Jerarquía ------------------------------------------------------------
  /** Parte que gira en azimut (torreta, o el arma entera si no hay torreta). */
  private turret = new THREE.Group();
  /** Pivote de elevación (cuna); su rotation.x es la elevación. */
  private cradle = new THREE.Group();
  /** Malla(s) del tubo: retroceden juntas a lo largo de -y local. */
  private recoiling = new THREE.Group();
  /** Cuña de culata: baja para abrir (solo cañones de tiro rápido). */
  private breechWedge: THREE.Object3D | null = null;
  /** Bandeja de carga / atacador: entra por detrás durante la recarga. */
  private rammer: THREE.Object3D | null = null;
  private rammerOut = -2;
  private rammerIn = -1;
  /** Bípode del mortero: el collar sigue al tubo y las patas lo persiguen. */
  private bipod: {
    collar: THREE.Object3D;
    legs: { mesh: THREE.Mesh; foot: THREE.Vector3 }[];
    reach: number;
  } | null = null;
  /** Munición visible en el lanzador (cohetes en las bocas, misil, tapa). */
  private ammoVisuals: THREE.Object3D[] = [];

  // -- Geometría de puntería (para muzzleWorldEnu analítica) ----------------
  private pivotY = 0;         // pivote de la cuna, adelante del eje de giro (m)
  private pivotZ = 0;         // altura del pivote (m)
  private muzzleY = 0;        // boca: distancia desde el pivote a lo largo del tubo

  // -- Puntería servo-animada -----------------------------------------------
  private azimuthDeg = 0;      // real (lo que se ve)
  private elevationDeg = 0;
  private cmdAzimuthDeg = 0;   // ordenada (lo que pide el panel)
  private cmdElevationDeg = 0;
  private azVel = 0;           // º/s actuales del servo de azimut
  private elVel = 0;
  private servo: ServoSpec = { traverse: 6, elevation: 5, accel: 26 };
  private firstAim = true;

  // -- Retroceso / ciclo de carga --------------------------------------------
  private recoilAmpM = 0.4;
  private recoilStrokeS = 0.07;   // tiempo hasta el tope del culatazo
  private recoilReturnS = 0.5;    // contra-retroceso del recuperador
  private recoilAge = Number.POSITIVE_INFINITY;
  private recoilNow = 0;
  private slamDone = true;

  private cycleAge = Number.POSITIVE_INFINITY;
  private cycleTimes = { open: 0.28, load: 0.9, close: 1.5, done: 1.9 };
  private cycleFlags = { open: false, load: false, close: false };
  private hasBreechCycle = false;
  private breechTravel = 0;

  // -- Chasis: la suspensión come lo que el freno no absorbe ------------------
  private hullSink = 0;
  private hullPitch = 0;

  // -- Casquillos eyectados (armas ligeras) -----------------------------------
  private casings: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; age: number }[] = [];
  private ejectsCasing = false;
  private casingSize = 0.05;
  private casingGeo: THREE.BufferGeometry | null = null;
  private casingMat: THREE.Material | null = null;

  // -- Recarga del lanzador (cohetes que se ven salir) ------------------------
  private tubesLoaded = 0;
  private reloadTimer = 0;
  private reloadTime = 6;

  private disposables: { dispose(): void }[] = [];

  constructor(private readonly parent: THREE.Object3D, weapon: Weapon) {
    parent.add(this.group);
    this.build(weapon);
  }

  /** Reconstruye el modelo al cambiar de arma (dispose limpio). */
  setWeapon(weapon: Weapon): void {
    this.clear();
    this.build(weapon);
  }

  // -------------------------------------------------------------------------
  //  Estado que consumen audio, VFX y cámara
  // -------------------------------------------------------------------------

  /** Velocidad angular total del arma (º/s): alimenta el servo del audio. */
  get slewRateDegS(): number {
    return Math.abs(this.azVel) + Math.abs(this.elVel);
  }

  /** 0..1 — cuánto queda de culatazo (1 = tubo en el tope de retroceso). */
  get recoilEnvelope(): number {
    return this.recoilAmpM > 0 ? clamp(this.recoilNow / this.recoilAmpM, 0, 1) : 0;
  }

  /** ¿Sigue el arma persiguiendo la orden de puntería? */
  get isSlewing(): boolean { return this.slewRateDegS > 0.05; }

  /** Punta del tubo en coordenadas ENU (analítica: az/el reales + retroceso). */
  muzzleWorldEnu(): Vec3 {
    const az = this.azimuthDeg * DEG;
    const el = this.elevationDeg * DEG;
    const sinAz = Math.sin(az), cosAz = Math.cos(az);
    const dir = new Vec3(sinAz * Math.cos(el), cosAz * Math.cos(el), Math.sin(el));
    const pivot = new Vec3(this.pivotY * sinAz, this.pivotY * cosAz, this.pivotZ - this.hullSink);
    return pivot.add(dir.mul(this.muzzleY - this.recoilNow));
  }

  /** Dirección del ánima en ENU (unitaria): el fogonazo sale por aquí. */
  muzzleDirEnu(): Vec3 {
    const az = this.azimuthDeg * DEG;
    const el = this.elevationDeg * DEG;
    return new Vec3(
      Math.sin(az) * Math.cos(el),
      Math.cos(az) * Math.cos(el),
      Math.sin(el),
    );
  }

  // -------------------------------------------------------------------------
  //  Actualización por frame
  // -------------------------------------------------------------------------

  /** Puntería servo-animada + retroceso + ciclo de carga + casquillos. */
  update(dt: number, azimuthDeg: number, elevationDeg: number): void {
    this.cmdAzimuthDeg = azimuthDeg;
    this.cmdElevationDeg = elevationDeg;

    if (this.firstAim) {
      // Al nacer o cambiar de arma no hay que "viajar": ya se apunta ahí.
      this.firstAim = false;
      this.azimuthDeg = azimuthDeg;
      this.elevationDeg = elevationDeg;
    } else if (dt > 0) {
      this.tickServos(dt);
    }

    this.tickRecoil(dt);
    this.tickCycle(dt);
    this.tickCasings(dt);
    this.tickLauncherReload(dt);
    this.applyTransforms();
  }

  /**
   * Servo con rampa: acelera hasta su velocidad máxima y FRENA a tiempo para
   * no pasarse (distancia de frenada v²/2a), como un accionamiento real.
   */
  private tickServos(dt: number): void {
    const wrap = (d: number) => ((d + 540) % 360) - 180; // camino más corto
    this.azVel = this.servoStep(
      dt, wrap(this.cmdAzimuthDeg - this.azimuthDeg), this.azVel, this.servo.traverse,
    );
    this.elVel = this.servoStep(
      dt, this.cmdElevationDeg - this.elevationDeg, this.elVel, this.servo.elevation,
    );
    this.azimuthDeg = ((this.azimuthDeg + this.azVel * dt) % 360 + 360) % 360;
    this.elevationDeg += this.elVel * dt;

    // Cierre fino: cuando falta menos que un paso, se asienta y para.
    if (Math.abs(wrap(this.cmdAzimuthDeg - this.azimuthDeg)) < 0.02 && Math.abs(this.azVel) < 0.6) {
      this.azimuthDeg = this.cmdAzimuthDeg;
      this.azVel = 0;
    }
    if (Math.abs(this.cmdElevationDeg - this.elevationDeg) < 0.02 && Math.abs(this.elVel) < 0.6) {
      this.elevationDeg = this.cmdElevationDeg;
      this.elVel = 0;
    }
  }

  private servoStep(dt: number, error: number, vel: number, vMax: number): number {
    const a = this.servo.accel;
    const dir = Math.sign(error);
    const dist = Math.abs(error);
    // Velocidad que aún permite frenar a tiempo en la distancia que queda.
    const vBrake = Math.sqrt(2 * a * dist);
    const target = dir * Math.min(vMax, vBrake);
    const dv = target - vel;
    const step = a * dt;
    return vel + clamp(dv, -step, step);
  }

  /**
   * Retroceso en dos fases. El freno hidroneumático absorbe el culatazo en
   * ~70 ms y el recuperador devuelve el tubo mucho más despacio; el final del
   * recorrido es el golpe de llegada a batería.
   */
  private tickRecoil(dt: number): void {
    this.recoilAge += dt;
    const a = this.recoilAge;
    const t0 = this.recoilStrokeS;
    const tr = this.recoilReturnS;

    if (a < 0) {
      this.recoilNow = 0;
    } else if (a < t0) {
      // Culatazo: aceleración brusca frenada al final (1 - (1-x)²).
      const x = a / t0;
      this.recoilNow = this.recoilAmpM * (1 - (1 - x) * (1 - x));
    } else if (a < t0 + tr) {
      // Contra-retroceso: coseno suavizado, más lento que la ida.
      const x = (a - t0) / tr;
      this.recoilNow = this.recoilAmpM * 0.5 * (1 + Math.cos(Math.PI * x));
    } else if (a < t0 + tr + 0.16) {
      // Llegada a batería: rebote amortiguado contra el tope.
      const x = (a - t0 - tr) / 0.16;
      this.recoilNow = this.recoilAmpM * 0.055 * Math.sin(Math.PI * 3 * x) * (1 - x);
      if (!this.slamDone) {
        this.slamDone = true;
        this.onMech?.('breechClose'); // el "clonk" del tubo asentándose
      }
    } else {
      this.recoilNow = 0;
    }

    // Suspensión: se hunde con el culatazo y vuelve con su propio muelle.
    const env = this.recoilEnvelope;
    const sinkTarget = 0.055 * env;
    const k = 1 - Math.exp(-9 * dt);
    this.hullSink += (sinkTarget - this.hullSink) * k;
    this.hullPitch += (0.9 * DEG * env - this.hullPitch) * k;
  }

  /** Ciclo de carga: culata abre → atacador mete → culata cierra. */
  private tickCycle(dt: number): void {
    if (!this.hasBreechCycle) return;
    this.cycleAge += dt;
    const c = this.cycleTimes;
    const a = this.cycleAge;
    if (a > c.done + 0.5) return;

    if (!this.cycleFlags.open && a >= c.open) {
      this.cycleFlags.open = true;
      this.onMech?.('breechOpen');
      // Al abrir sale el humo que quedaba en el ánima.
      const m = this.muzzleWorldEnu();
      this.onBoreSmoke?.(m, this.muzzleDirEnu());
      if (this.ejectsCasing) this.ejectCasing();
    }
    if (!this.cycleFlags.load && a >= c.load) {
      this.cycleFlags.load = true;
      this.onMech?.('load');
    }
    if (!this.cycleFlags.close && a >= c.close) {
      this.cycleFlags.close = true;
      this.onMech?.('breechClose');
    }

    // Cuña de culata: 0 = cerrada, 1 = abajo del todo.
    const openAmt =
      a < c.open ? clamp((a - c.open + 0.22) / 0.22, 0, 1)
      : a < c.close ? 1
      : clamp(1 - (a - c.close) / 0.18, 0, 1);
    if (this.breechWedge) this.breechWedge.position.z = -this.breechTravel * openAmt;

    // Atacador: entra entre `load` y `close`, luego se retira.
    if (this.rammer) {
      const inAmt =
        a < c.load - 0.5 ? 0
        : a < c.load ? (a - (c.load - 0.5)) / 0.5
        : a < c.load + 0.35 ? 1
        : clamp(1 - (a - c.load - 0.35) / 0.35, 0, 1);
      this.rammer.visible = inAmt > 0.02;
      this.rammer.position.y = this.rammerOut + (this.rammerIn - this.rammerOut) * inAmt;
    }
  }

  /** Casquillos: parábola con gravedad y rebote, con giro. */
  private tickCasings(dt: number): void {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.age += dt;
      c.vel.z -= 9.80665 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.z < this.casingSize * 0.5 && c.vel.z < 0) {
        c.mesh.position.z = this.casingSize * 0.5;
        c.vel.z = -c.vel.z * 0.35;
        c.vel.x *= 0.6;
        c.vel.y *= 0.6;
        c.spin.multiplyScalar(0.5);
        if (Math.abs(c.vel.z) < 0.4) c.vel.set(0, 0, 0);
      }
      if (c.age > 6) {
        this.group.remove(c.mesh);
        this.casings.splice(i, 1);
      }
    }
  }

  /** Lanzadores: los tubos vacíos vuelven a "cargarse" tras el tiempo real. */
  private tickLauncherReload(dt: number): void {
    if (this.ammoVisuals.length === 0) return;
    if (this.tubesLoaded >= this.ammoVisuals.length) return;
    this.reloadTimer -= dt;
    if (this.reloadTimer > 0) return;
    this.ammoVisuals[this.tubesLoaded].visible = true;
    this.tubesLoaded++;
    this.reloadTimer = this.reloadTime;
    this.onMech?.('load');
  }

  /**
   * Bípode del mortero: el collar viaja por el tubo (que se eleva) y cada
   * pata, con el pie clavado en el suelo, se reorienta y se estira hasta él.
   * Cilindro unitario + quaternion + escala: sin recrear geometría por frame.
   */
  private tickBipod(): void {
    const b = this.bipod;
    if (!b) return;
    const el = this.elevationDeg * DEG;
    // En el marco del turret (el azimut ya lo aplica el padre) el tubo vive en
    // el plano YZ: dir = (0, cos el, sin el) desde el pivote.
    const apex = new THREE.Vector3(
      0,
      Math.cos(el) * b.reach,
      this.pivotZ + Math.sin(el) * b.reach,
    );
    b.collar.position.copy(apex);
    b.collar.rotation.x = el; // el cilindro (eje +y) se alinea con el tubo

    for (const leg of b.legs) {
      const dir = apex.clone().sub(leg.foot);
      const len = Math.max(0.05, dir.length());
      leg.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.divideScalar(len),
      );
      leg.mesh.scale.set(1, len, 1);
    }
  }

  /** Aplica el estado animado a la jerarquía Three. */
  private applyTransforms(): void {
    this.tickBipod();
    this.turret.rotation.z = -this.azimuthDeg * DEG;
    this.cradle.rotation.x = this.elevationDeg * DEG - this.hullPitch;
    this.recoiling.position.y = -this.recoilNow;
    this.group.position.z = -this.hullSink;
    // El casco cabecea contra el culatazo (la torreta va montada encima).
    this.group.rotation.x = -this.hullPitch * 0.55;
  }

  // -------------------------------------------------------------------------
  //  Disparo
  // -------------------------------------------------------------------------

  /** Dispara el retroceso visual y arranca el ciclo de carga. */
  fireRecoil(): void {
    // El tubo debe estar donde manda la orden: la física ya voló desde ahí.
    this.azimuthDeg = this.cmdAzimuthDeg;
    this.elevationDeg = this.cmdElevationDeg;
    this.azVel = 0;
    this.elVel = 0;

    this.recoilAge = 0;
    this.slamDone = false;
    this.cycleAge = 0;
    this.cycleFlags = { open: false, load: false, close: false };

    // Lanzador: se va un cohete del pod.
    if (this.tubesLoaded > 0) {
      this.tubesLoaded--;
      const v = this.ammoVisuals[this.tubesLoaded];
      if (v) v.visible = false;
      this.reloadTimer = this.reloadTime;
    }
  }

  private ejectCasing(): void {
    // Geometría y material COMPARTIDOS: una ametralladora escupe cientos de
    // casquillos y crear uno nuevo por disparo era fuga pura.
    if (!this.casingGeo || !this.casingMat) return;
    const mesh = new THREE.Mesh(this.casingGeo, this.casingMat);
    const az = this.azimuthDeg * DEG;
    // Sale por el lado derecho del arma, a la altura del cajón de mecanismos.
    const right = new THREE.Vector3(Math.cos(az), -Math.sin(az), 0);
    mesh.position.set(
      right.x * 0.2, right.y * 0.2, Math.max(0.3, this.pivotZ - 0.1),
    );
    this.group.add(mesh);
    this.casings.push({
      mesh,
      vel: new THREE.Vector3(
        right.x * (2.2 + Math.random()), right.y * (2.2 + Math.random()), 1.6 + Math.random(),
      ),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26,
      ),
      age: 0,
    });
    this.onMech?.('casing');
  }

  dispose(): void {
    this.clear();
    this.parent.remove(this.group);
  }

  // =========================================================================
  //  Construcción
  // =========================================================================
  private clear(): void {
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.casings = [];
    this.ammoVisuals = [];
    this.breechWedge = null;
    this.rammer = null;
    this.casingGeo = null;
    this.casingMat = null;
    this.bipod = null;
  }

  private build(weapon: Weapon): void {
    this.turret = new THREE.Group();
    this.cradle = new THREE.Group();
    this.recoiling = new THREE.Group();
    this.cradle.add(this.recoiling);
    this.group.add(this.turret);
    this.hasBreechCycle = false;
    this.ejectsCasing = false;
    this.tubesLoaded = 0;
    this.reloadTime = Math.max(1.5, weapon.reloadTime);
    this.firstAim = true;

    // La silueta la elige el MONTAJE, no la categoría: dentro de una misma
    // categoría no se parecen en nada un M270 de cadenas y un HIMARS de
    // ruedas, ni una pistola y una M2 sobre trípode.
    const d = weapon.round.diameter;
    switch (weapon.mount) {
      case 'baseplate': this.buildMortar(d); break;
      case 'towed': this.buildTowedHowitzer(d); break;
      case 'trackedTurret': this.buildTurretHowitzer(d); break;
      case 'trackedOpen': this.buildOpenTrackedGun(d); break;
      case 'wheeledLauncher': this.buildRocketTruck(d, weapon.launcherPods); break;
      case 'trackedLauncher': this.buildRocketTracked(d, weapon.launcherPods); break;
      case 'tel': this.buildMissileTel(d, weapon.launcherPods); break;
      case 'handheld': this.buildHandheld(d, weapon.round.muzzleVelocity < 500); break;
      case 'bipod': this.buildBipodMg(d); break;
      case 'tripod': this.buildTripodMg(d); break;
    }

    // Recorrido de retroceso: proporcional al calibre, como el real (un 155
    // retrocede ~1 m en el tubo; aquí se comprime para que se lea en pantalla).
    this.recoilAmpM =
      weapon.category === 'SmallArms' ? 0.03
      : weapon.category === 'Mortar' ? 0.1
      : weapon.category === 'Rocket' || weapon.category === 'Missile' ? 0.06
      : clamp(d * 3.6, 0.35, 0.85);
    this.recoilStrokeS = weapon.category === 'SmallArms' ? 0.02 : 0.075;
    this.recoilReturnS = weapon.category === 'SmallArms' ? 0.05 : 0.45 + d * 0.9;

    // Servos: cada arma se mueve a su ritmo (torreta motorizada vs manivela).
    this.servo = GunModel.servoFor(weapon);

    // Tiempos del ciclo de carga, escalados al recargar real del arma.
    const rl = this.reloadTime;
    this.cycleTimes = {
      open: Math.min(0.35, rl * 0.08),
      load: rl * 0.45,
      close: rl * 0.78,
      done: rl,
    };
    this.cycleAge = Number.POSITIVE_INFINITY;
    this.recoilAge = Number.POSITIVE_INFINITY;
    this.slamDone = true;
    this.recoilNow = 0;
    this.hullSink = 0;
    this.hullPitch = 0;
    this.update(0, this.cmdAzimuthDeg, this.cmdElevationDeg);
  }

  private static servoFor(w: Weapon): ServoSpec {
    switch (w.category) {
      case 'SmallArms': return { traverse: 120, elevation: 90, accel: 600 };
      case 'Mortar': return { traverse: 4, elevation: 5, accel: 14 };
      case 'Rocket': return { traverse: 10, elevation: 7, accel: 22 };
      case 'Missile': return { traverse: 6, elevation: 4, accel: 12 };
      default:
        // Torreta motorizada (M109) vs cureña a manivela (M777, 2S7).
        return w.traverseDeg >= 360
          ? { traverse: 13, elevation: 6, accel: 34 }
          : { traverse: 5, elevation: 4, accel: 18 };
    }
  }

  // -------------------------------------------------------------------------
  //  Utilidades de geometría (todas registran para dispose)
  // -------------------------------------------------------------------------
  private mat(color: number, metalness = 0.45, roughness = 0.55, flat = false): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: flat });
    this.disposables.push(m);
    return m;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    this.disposables.push(geo);
    return new THREE.Mesh(geo, mat);
  }

  /** (ancho x, fondo y, alto z) */
  private box(w: number, dpt: number, h: number, mat: THREE.Material): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(w, dpt, h), mat);
  }

  /** Cilindro a lo largo de +y (CylinderGeometry ya es axial en y). */
  private tubeMesh(rTop: number, rBottom: number, len: number, mat: THREE.Material, seg = 20): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rTop, rBottom, len, seg), mat);
  }

  /**
   * Sólido de revolución sobre el eje +y local (el eje de los tubos) a partir
   * de un perfil [radio, y]. Para piezas HORIZONTALES (placas, escotillas)
   * hay que girarlas después con rotation.x = π/2, que lleva +y local a +z.
   */
  private lathe(profile: [number, number][], mat: THREE.Material, seg = 24): THREE.Mesh {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
    return this.mesh(new THREE.LatheGeometry(pts, seg), mat);
  }

  /** Disco/plato horizontal: lathe ya tumbado sobre el plano del suelo. */
  private disc(profile: [number, number][], mat: THREE.Material, seg = 24): THREE.Mesh {
    const m = this.lathe(profile, mat, seg);
    m.rotation.x = Math.PI / 2; // eje del lathe (+y) -> vertical (+z)
    return m;
  }

  /** Barra cilíndrica entre dos puntos: patas de bípode/trípode, tirantes. */
  private strut(
    from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material,
  ): THREE.Mesh {
    const dir = to.clone().sub(from);
    const len = Math.max(1e-3, dir.length());
    const m = this.tubeMesh(radius, radius * 1.2, len, mat, 10);
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  /**
   * Rueda completa: neumático (toro), llanta y disco. Eje en x (lateral).
   */
  private wheel(r: number, width: number, tire: THREE.Material, rim: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const t = this.mesh(new THREE.TorusGeometry(r * 0.82, r * 0.2, 8, 20), tire);
    t.rotation.y = Math.PI / 2;
    const hub = this.tubeMesh(r * 0.62, r * 0.62, width * 0.9, rim, 14);
    hub.rotation.z = Math.PI / 2;
    g.add(t, hub);
    return g;
  }

  /** Tren de rodaje de oruga: motriz, tensora, ruedas y banda. */
  private trackAssembly(len: number, r: number, mat: THREE.Material, rim: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    // Banda de eslabones: algo más clara que el resto para que el tren de
    // rodaje se lea y no sea un bloque negro bajo el faldón.
    const band = this.box(0.42, len, r * 2.05, mat);
    g.add(band);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const w = this.tubeMesh(r * 0.78, r * 0.78, 0.34, rim, 12);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, -len / 2 + (len / (n - 1)) * i, -r * 0.55);
      g.add(w);
    }
    // Motriz y tensora, algo mayores y más altas.
    for (const y of [-len / 2, len / 2]) {
      const s = this.tubeMesh(r * 0.95, r * 0.95, 0.36, rim, 14);
      s.rotation.z = Math.PI / 2;
      s.position.set(0, y, r * 0.2);
      g.add(s);
    }
    return g;
  }

  /**
   * Tubo con perfil torneado real + culata, freno de boca de dos cámaras y
   * cilindros del freno/recuperador. Deja pivote y boca registrados.
   */
  private installBarrel(opts: {
    pivotY: number; pivotZ: number; length: number;
    rMuzzle: number; rBreech: number; backLen?: number;
    mat: THREE.Material; darkMat: THREE.Material;
    muzzleBrake?: boolean;
    /** Evacuador de ánima: bulto a ~60% del tubo (obuses de torreta). */
    boreEvacuator?: boolean;
    /** Bloque de culata con cuña deslizante animada. */
    breechBlock?: boolean;
    /** Bandeja de carga / atacador que entra por detrás. */
    rammer?: boolean;
    /** Cilindros del freno hidráulico sobre/bajo la cuna. */
    recuperators?: boolean;
  }): void {
    const L = opts.length;
    const rM = opts.rMuzzle;
    const rB = opts.rBreech;
    const back = opts.backLen ?? L * 0.1;

    // Perfil: culata gruesa → cono de refuerzo → tubo casi cilíndrico → boca
    // con reborde. El hueco final es el ánima (se ve el agujero de verdad).
    const profile: [number, number][] = [
      [0, -back],
      [rB * 1.16, -back],
      [rB * 1.16, -back * 0.25],
      [rB * 1.02, 0],
      [rB * 0.94, L * 0.1],
      [rM * 1.3, L * 0.42],
      [rM * 1.06, L * 0.78],
      [rM * 1.12, L * 0.985],   // reborde de boca
      [rM * 1.12, L],
      [rM * 0.55, L],           // labio: entra al ánima
      [rM * 0.55, L * 0.965],
    ];
    const tube = this.lathe(profile, opts.mat, 28);
    this.recoiling.add(tube);

    // Muñones (los ejes sobre los que bascula el tubo): se ven a los lados.
    for (const side of [-1, 1]) {
      const trunnion = this.tubeMesh(rB * 0.36, rB * 0.36, rB * 0.9, opts.darkMat, 12);
      trunnion.rotation.z = Math.PI / 2;
      trunnion.position.set(side * rB * 1.35, 0, 0);
      this.recoiling.add(trunnion);
    }

    if (opts.breechBlock) {
      // Recámara: bloque cuadrado con la cuña deslizante que se abre hacia
      // abajo (Krupp/Rheinmetall). La cuña es lo que anima el ciclo de carga.
      const housing = this.box(rB * 3.1, back * 1.5, rB * 3.0, opts.mat);
      housing.position.y = -back * 0.55;
      this.recoiling.add(housing);

      this.breechTravel = rB * 2.2;
      const wedge = this.box(rB * 2.5, back * 0.7, rB * 2.4, opts.darkMat);
      const wedgeHolder = new THREE.Group();
      wedgeHolder.position.y = -back * 0.75;
      wedgeHolder.add(wedge);
      this.recoiling.add(wedgeHolder);
      this.breechWedge = wedgeHolder;
      this.hasBreechCycle = true;

      // Volante de apertura manual, a un lado.
      const wheelHandle = this.mesh(new THREE.TorusGeometry(rB * 0.55, rB * 0.09, 6, 14), opts.darkMat);
      wheelHandle.rotation.y = Math.PI / 2;
      wheelHandle.position.set(rB * 1.8, -back * 0.55, 0);
      this.recoiling.add(wheelHandle);
    }

    if (opts.rammer) {
      // Bandeja de carga: canal en U con el proyectil dentro, alineado con el
      // eje del ánima. Entra por detrás de la culata y se retira.
      const tray = new THREE.Group();
      const channel = this.box(rB * 1.9, 1.3, rB * 0.35, opts.darkMat);
      channel.position.z = -rB * 0.7;
      const shell = this.lathe([
        [0, 0], [rB * 0.6, 0], [rB * 0.68, rB * 1.2], [rB * 0.68, rB * 3.4],
        [rB * 0.42, rB * 4.4], [0, rB * 4.7],
      ], this.mat(0x6f7454, 0.5, 0.5), 14);
      shell.position.y = -rB * 1.6;
      const band = this.mesh(new THREE.TorusGeometry(rB * 0.7, rB * 0.07, 5, 16), this.mat(0xb3722e, 0.9, 0.3));
      band.rotation.x = Math.PI / 2;
      band.position.y = -rB * 0.9;
      tray.add(channel, shell, band);
      tray.visible = false;
      this.cradle.add(tray);
      this.rammerOut = -(back + 1.55);   // fuera, detrás del arma
      this.rammerIn = -(back + 0.35);    // metiendo el proyectil en la recámara
      this.rammer = tray;
    }

    if (opts.boreEvacuator) {
      const ev = this.lathe([
        [rM * 1.05, L * 0.5], [rM * 1.75, L * 0.55],
        [rM * 1.75, L * 0.68], [rM * 1.05, L * 0.73],
      ], opts.mat, 20);
      this.recoiling.add(ev);
    }

    if (opts.muzzleBrake) {
      // Freno de boca de dos cámaras: cuerpo + dos pares de deflectores
      // laterales con las ventanas de escape entre ellos.
      const bodyLen = rM * 6.4;
      const y0 = L - bodyLen * 0.55;
      const body = this.lathe([
        [rM * 1.15, y0], [rM * 2.0, y0 + rM * 0.4],
        [rM * 2.0, y0 + bodyLen - rM * 0.4], [rM * 1.5, y0 + bodyLen],
        [rM * 0.55, y0 + bodyLen], [rM * 0.55, y0],
      ], opts.darkMat, 20);
      this.recoiling.add(body);
      for (let i = 0; i < 2; i++) {
        const baffle = this.mesh(
          new THREE.CylinderGeometry(rM * 2.55, rM * 2.55, rM * 0.55, 18),
          opts.darkMat,
        );
        baffle.position.y = y0 + bodyLen * (0.22 + 0.5 * i);
        this.recoiling.add(baffle);
        // Las "ventanas" laterales por las que escapan los gases.
        const port = this.box(rM * 5.4, rM * 1.5, rM * 1.5, opts.darkMat);
        port.position.y = baffle.position.y + rM * 0.9;
        this.recoiling.add(port);
      }
    }

    if (opts.recuperators !== false) {
      // Cilindros del freno hidráulico y del recuperador: NO retroceden (son
      // los que frenan al conjunto que sí lo hace).
      for (const [sx, sz] of [[-1, -1], [1, -1], [0, 1]] as const) {
        const cyl = this.lathe([
          [rM * 0.62, 0], [rM * 0.62, L * 0.34], [rM * 0.45, L * 0.36],
        ], opts.darkMat, 14);
        cyl.position.set(sx * rB * 1.25, L * 0.02, sz * rB * 1.1);
        this.cradle.add(cyl);
      }
      // Cuna: el canal en U que abraza el tubo.
      const cradleBody = this.box(rB * 2.9, L * 0.3, rB * 0.5, opts.mat);
      cradleBody.position.set(0, L * 0.13, -rB * 1.35);
      this.cradle.add(cradleBody);
    }

    this.cradle.position.set(0, opts.pivotY, opts.pivotZ);
    this.turret.add(this.cradle);
    this.pivotY = opts.pivotY;
    this.pivotZ = opts.pivotZ;
    this.muzzleY = L;
  }

  // -------------------------------------------------------------------------
  //  Morteros
  // -------------------------------------------------------------------------
  private buildMortar(d: number): void {
    const steel = this.mat(0x4a5240, 0.4, 0.6);
    const dark = this.mat(0x33383a, 0.55, 0.45);
    const brass = this.mat(0x8a7340, 0.7, 0.4);

    // Placa base circular con nervios radiales (la que clava el retroceso).
    const plate = this.disc([
      [0, 0], [0.6, 0], [0.64, 0.05], [0.6, 0.09], [0.18, 0.11], [0, 0.13],
    ], dark, 28);
    this.turret.add(plate);
    for (let i = 0; i < 6; i++) {
      const rib = this.box(0.06, 1.1, 0.05, dark);
      rib.position.z = 0.02;
      rib.rotation.z = (i / 6) * Math.PI;
      this.turret.add(rib);
    }
    // Rótula de la placa (el tubo pivota aquí).
    const ball = this.mesh(new THREE.SphereGeometry(0.11, 14, 10), dark);
    ball.position.z = 0.15;
    this.turret.add(ball);

    this.installBarrel({
      pivotY: 0, pivotZ: 0.16,
      length: d * 14.5,           // 120 mm -> ~1.75 m
      rMuzzle: d * 0.6, rBreech: d * 0.78, backLen: 0.12,
      mat: steel, darkMat: dark,
      recuperators: false,        // el mortero no tiene freno: se lo come la placa
    });

    // Bípode: el collar ABRAZA el tubo, así que sube y baja con la elevación;
    // las patas siguen clavadas en el suelo y se reorientan solas (ver
    // tickBipod). Es el gesto que delata a un mortero de verdad.
    const collar = this.tubeMesh(d * 1.05, d * 1.05, 0.16, dark, 14);
    this.turret.add(collar);
    const legs: { mesh: THREE.Mesh; foot: THREE.Vector3 }[] = [];
    for (const side of [-1, 1]) {
      const foot = new THREE.Vector3(side * 0.62, 0.86, 0.02);
      // Cilindro unitario con la base en el origen: se orienta y estira solo.
      const geo = new THREE.CylinderGeometry(0.026, 0.032, 1, 10);
      geo.translate(0, 0.5, 0);
      this.disposables.push(geo);
      const leg = new THREE.Mesh(geo, steel);
      leg.position.copy(foot);
      this.turret.add(leg);
      legs.push({ mesh: leg, foot });
      const shoe = this.box(0.17, 0.24, 0.05, dark);
      shoe.position.copy(foot);
      this.turret.add(shoe);
    }
    // Husillos de puntería (dorados) entre las patas.
    const traverseScrew = this.strut(
      new THREE.Vector3(-0.32, 0.72, 0.42), new THREE.Vector3(0.32, 0.72, 0.42), 0.019, brass,
    );
    this.turret.add(traverseScrew);
    // Alza a un lado de la boca.
    const sight = this.box(0.07, 0.05, 0.16, dark);
    sight.position.set(-0.26, 0.5, 0.72);
    this.turret.add(sight);

    // El collar agarra el tubo al 55% de su longitud (como el real).
    this.bipod = { collar, legs, reach: d * 14.5 * 0.55 };
    // Tapón de culata bulboso (la aguja percutora vive dentro).
    const cap = this.lathe([
      [0, -0.12], [d * 0.8, -0.12], [d * 0.86, -0.05], [d * 0.8, 0.02], [0, 0.03],
    ], dark, 18);
    this.recoiling.add(cap);
  }

  // -------------------------------------------------------------------------
  //  Armas ligeras — cuatro siluetas distintas, no una ametralladora repetida
  // -------------------------------------------------------------------------

  /**
   * Tirador esquemático a escala humana (1.75 m). Da la referencia de tamaño
   * que le falta a un arma de mano suelta en mitad del campo, y la sostiene:
   * sin él, un fusil flotando parecía una maqueta sin escala.
   * `crouch` lo pone en rodilla en tierra (fusil) o de pie (pistola).
   */
  private buildShooter(pistolGrip: boolean): { handZ: number } {
    const cloth = this.mat(0x4c5340, 0.1, 0.9);
    const gear = this.mat(0x33372c, 0.15, 0.85);
    const skin = this.mat(0x9c7856, 0.05, 0.9);
    const boot = this.mat(0x241f1b, 0.2, 0.8);

    const backY = -0.34;               // el tirador va DETRAS del arma
    const hipZ = 0.92;
    const chestZ = 1.34;
    const handZ = chestZ;              // el arma, a la altura del hombro

    // Piernas de pie, una adelantada: postura de tiro, no una zancada.
    for (const sx of [-1, 1]) {
      const hip = new THREE.Vector3(sx * 0.13, backY, hipZ);
      const foot = new THREE.Vector3(sx * 0.19, backY + (sx > 0 ? 0.16 : -0.2), 0.1);
      this.turret.add(this.strut(hip, foot, 0.085, cloth));
      const shoe = this.box(0.13, 0.28, 0.09, boot);
      shoe.position.set(foot.x, foot.y + 0.05, 0.045);
      shoe.rotation.z = -sx * 10 * DEG;
      this.turret.add(shoe);
    }

    // Torso ligeramente inclinado hacia el arma + chaleco.
    const hips = this.box(0.33, 0.22, 0.2, cloth);
    hips.position.set(0, backY, hipZ);
    const chest = this.box(0.4, 0.25, 0.42, cloth);
    chest.position.set(0, backY + 0.03, hipZ + 0.28);
    chest.rotation.x = -6 * DEG;
    const vest = this.box(0.44, 0.29, 0.28, gear);
    vest.position.set(0, backY + 0.03, hipZ + 0.28);
    vest.rotation.x = -6 * DEG;
    this.turret.add(hips, chest, vest);

    // Cabeza y casco, mirando por encima del arma.
    const head = this.mesh(new THREE.SphereGeometry(0.1, 12, 10), skin);
    head.position.set(0, backY + 0.04, chestZ + 0.2);
    const helmet = this.mesh(
      new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), gear,
    );
    helmet.rotation.x = -Math.PI / 2;
    helmet.position.set(head.position.x, head.position.y, head.position.z + 0.025);
    this.turret.add(head, helmet);

    // Brazos hasta donde AGARRAN de verdad: con fusil, una mano en la
    // empuñadura y otra adelante en el guardamanos; con pistola, las dos
    // juntas al frente y los brazos extendidos.
    const grips: [number, number, number][] = pistolGrip
      ? [[0.05, -0.03, handZ], [-0.05, -0.05, handZ]]
      : [[0.06, -0.09, handZ - 0.06], [-0.05, 0.3, handZ - 0.02]];
    grips.forEach(([hx, hy, hz], i) => {
      const sx = i === 0 ? 1 : -1;
      const shoulder = new THREE.Vector3(sx * 0.2, backY + 0.03, chestZ + 0.08);
      const hand = new THREE.Vector3(hx, hy, hz);
      // Codo: el brazo se dobla, así que se pinta en dos tramos.
      const elbow = new THREE.Vector3(
        (shoulder.x + hand.x) / 2 + sx * 0.09,
        (shoulder.y + hand.y) / 2 - 0.06,
        (shoulder.z + hand.z) / 2 - 0.11,
      );
      this.turret.add(this.strut(shoulder, elbow, 0.058, cloth));
      this.turret.add(this.strut(elbow, hand, 0.05, cloth));
      const glove = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), gear);
      glove.position.copy(hand);
      this.turret.add(glove);
    });
    return { handZ };
  }

  /** Registra el casquillo compartido (todas las armas ligeras lo eyectan). */
  private setupCasings(d: number, scale = 4.2): void {
    this.ejectsCasing = true;
    this.hasBreechCycle = true;
    this.casingSize = Math.max(0.02, d * scale);
    const cs = this.casingSize;
    this.casingGeo = new THREE.CylinderGeometry(cs * 0.34, cs * 0.4, cs, 10);
    this.casingMat = this.mat(0xb98b3c, 0.9, 0.3);
    this.disposables.push(this.casingGeo);
  }

  /**
   * Arma de mano sostenida por un tirador: PISTOLA (corredera que retrocede,
   * cañón corto, empuñadura con cargador) o FUSIL (cajón, guardamanos con
   * raíles, cargador curvo, culata y pistol grip). Nada que ver con una
   * ametralladora de trípode.
   */
  private buildHandheld(d: number, isPistol: boolean): void {
    const dark = this.mat(0x232629, 0.5, 0.5);
    const steel = this.mat(0x4a5054, 0.75, 0.3);
    const poly = this.mat(0x2f3a2c, 0.05, 0.85);   // polímero del armazón

    const { handZ } = this.buildShooter(isPistol);
    const barrelLen = isPistol ? Math.max(0.1, d * 12) : Math.max(0.4, d * 65);

    if (isPistol) {
      // Corredera (retrocede al disparar) sobre el armazón fijo.
      const slide = this.box(0.032, 0.19, 0.038, steel);
      slide.position.set(0, 0.02, 0.012);
      const ejection = this.box(0.034, 0.05, 0.012, dark);
      ejection.position.set(0.006, 0.06, 0.03);
      this.recoiling.add(slide, ejection);
      const frame = this.box(0.03, 0.15, 0.03, poly);
      frame.position.set(0, -0.01, -0.022);
      const grip = this.box(0.03, 0.05, 0.11, poly);
      grip.position.set(0, -0.07, -0.075);
      grip.rotation.x = 14 * DEG;
      const magBase = this.box(0.032, 0.052, 0.012, dark);
      magBase.position.set(0, -0.078, -0.132);
      const trigger = this.box(0.012, 0.02, 0.03, dark);
      trigger.position.set(0, -0.035, -0.048);
      this.cradle.add(frame, grip, magBase, trigger);
      // Alza y punto de mira sobre la corredera.
      for (const [y, w] of [[-0.06, 0.022], [0.085, 0.008]] as const) {
        const sight = this.box(w, 0.008, 0.012, dark);
        sight.position.set(0, y, 0.034);
        this.recoiling.add(sight);
      }
      this.installBarrel({
        pivotY: 0.0, pivotZ: handZ,
        length: barrelLen, rMuzzle: d * 0.72, rBreech: d * 0.95, backLen: 0.02,
        mat: steel, darkMat: dark, recuperators: false,
      });
      this.setupCasings(d, 2.6);
      return;
    }

    // --- Fusil ---------------------------------------------------------------
    const receiver = this.box(0.048, 0.3, 0.075, poly);
    receiver.position.set(0, 0.02, 0);
    const upper = this.box(0.05, 0.26, 0.045, dark);
    upper.position.set(0, 0.05, 0.05);
    const handguard = this.box(0.052, 0.26, 0.06, dark);
    handguard.position.set(0, 0.3, 0.006);
    this.recoiling.add(receiver, upper, handguard);
    for (const sx of [-1, 1]) {
      const rail = this.box(0.008, 0.24, 0.012, steel);
      rail.position.set(sx * 0.03, 0.3, 0.02);
      this.recoiling.add(rail);
    }
    // Cargador curvo, empuñadura, tubo de recuperación y culata retráctil.
    const mag = this.box(0.03, 0.055, 0.17, dark);
    mag.position.set(0, 0.02, -0.115);
    mag.rotation.x = -10 * DEG;
    const grip = this.box(0.034, 0.06, 0.12, poly);
    grip.position.set(0, -0.09, -0.085);
    grip.rotation.x = 18 * DEG;
    const buffer = this.tubeMesh(0.024, 0.024, 0.12, dark, 10);
    buffer.position.set(0, -0.2, 0.012);
    const stock = this.box(0.05, 0.16, 0.075, poly);
    stock.position.set(0, -0.26, 0.0);
    const butt = this.box(0.055, 0.03, 0.11, dark);
    butt.position.set(0, -0.335, -0.005);
    this.cradle.add(mag, grip, buffer, stock, butt);
    const optic = this.box(0.04, 0.11, 0.05, dark);
    optic.position.set(0, 0.06, 0.095);
    this.recoiling.add(optic);

    this.installBarrel({
      pivotY: 0.0, pivotZ: handZ,
      length: barrelLen, rMuzzle: d * 1.1, rBreech: d * 1.9, backLen: 0.05,
      mat: steel, darkMat: dark, recuperators: false,
    });
    // Apagallamas en la boca.
    const flash = this.tubeMesh(d * 2.2, d * 1.6, 0.06, dark, 12);
    flash.position.y = barrelLen - 0.03;
    this.recoiling.add(flash);
    this.setupCasings(d, 3.4);
  }

  /**
   * Ametralladora media (M240): bípode plegable bajo el cañón, cinta que entra
   * por el lado, culata de madera y asa de cambio rápido de cañón. Va tumbada,
   * a la altura de un codo — no sobre un trípode de metro y medio.
   */
  private buildBipodMg(d: number): void {
    const dark = this.mat(0x2b2f31, 0.55, 0.45);
    const steel = this.mat(0x40464a, 0.7, 0.35);
    const wood = this.mat(0x4a3a28, 0.15, 0.8);
    const brass = this.mat(0x9a7a3a, 0.85, 0.3);

    const hubZ = 0.42;
    for (const sx of [-1, 1]) {
      this.turret.add(this.strut(
        new THREE.Vector3(sx * 0.02, 0.34, hubZ - 0.02),
        new THREE.Vector3(sx * 0.26, 0.42, 0.02), 0.012, dark,
      ));
      const shoe = this.box(0.05, 0.09, 0.03, dark);
      shoe.position.set(sx * 0.26, 0.42, 0.02);
      this.turret.add(shoe);
    }
    const receiver = this.box(0.1, 0.5, 0.12, steel);
    receiver.position.set(0, -0.08, 0);
    const feedCover = this.box(0.11, 0.28, 0.04, dark);
    feedCover.position.set(0, 0.02, 0.08);
    const stock = this.box(0.075, 0.3, 0.11, wood);
    stock.position.set(0, -0.44, -0.005);
    const grip = this.box(0.05, 0.07, 0.13, dark);
    grip.position.set(0, -0.26, -0.1);
    grip.rotation.x = 16 * DEG;
    this.cradle.add(receiver, feedCover, stock, grip);

    const ammoBox = this.box(0.13, 0.2, 0.14, this.mat(0x3f4a35, 0.3, 0.7));
    ammoBox.position.set(-0.13, -0.06, -0.09);
    this.cradle.add(ammoBox);
    for (let i = 0; i < 5; i++) {
      const link = this.box(0.016, 0.014, 0.03, brass);
      link.position.set(-0.11 + i * 0.02, -0.02, 0.02 + i * 0.005);
      this.cradle.add(link);
    }

    const barrelLen = Math.max(0.42, d * 68);
    this.installBarrel({
      pivotY: 0.2, pivotZ: hubZ,
      length: barrelLen, rMuzzle: d * 0.95, rBreech: d * 1.5, backLen: 0.05,
      mat: steel, darkMat: dark, recuperators: false,
    });
    const handle = this.box(0.018, 0.12, 0.05, dark);
    handle.position.set(0.035, barrelLen * 0.3, d * 2.2);
    const flash = this.tubeMesh(d * 2.4, d * 1.4, 0.07, dark, 12);
    flash.position.y = barrelLen - 0.035;
    this.recoiling.add(handle, flash);
    this.setupCasings(d, 3.6);
  }

  /**
   * Ametralladora pesada (M2 Browning): trípode alto y arriostrado, receptor
   * macizo, cañón pesado con manguito perforado y empuñaduras de pala con la
   * mariposa del disparador entre ellas. Esta sí necesita trípode.
   */
  private buildTripodMg(d: number): void {
    const dark = this.mat(0x2b2f31, 0.55, 0.45);
    const steel = this.mat(0x40464a, 0.7, 0.35);
    const brass = this.mat(0x9a7a3a, 0.85, 0.3);

    const hubZ = 1.0;
    const hubPos = new THREE.Vector3(0, 0, hubZ);
    for (const [fx, fy] of [[0, 0.72], [0.62, -0.5], [-0.62, -0.5]] as const) {
      const foot = new THREE.Vector3(fx, fy, 0.02);
      this.turret.add(this.strut(hubPos, foot, 0.022, dark));
      const shoe = this.box(0.1, 0.14, 0.045, dark);
      shoe.position.copy(foot);
      this.turret.add(shoe);
      // Arriostrado a media altura: el trípode del .50 es aparatoso.
      this.turret.add(this.strut(
        new THREE.Vector3(0, 0, hubZ * 0.45),
        new THREE.Vector3(fx * 0.45, fy * 0.45, hubZ * 0.16), 0.012, dark,
      ));
    }
    const hub = this.tubeMesh(0.075, 0.095, 0.12, dark, 12);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = hubZ;
    const pintle = this.tubeMesh(0.05, 0.05, 0.16, steel, 10);
    pintle.rotation.x = Math.PI / 2;
    pintle.position.z = hubZ + 0.08;
    this.turret.add(hub, pintle);

    const receiver = this.box(0.16, 0.72, 0.19, steel);
    receiver.position.set(0, -0.14, 0);
    const cover = this.box(0.17, 0.42, 0.05, dark);
    cover.position.set(0, -0.04, 0.12);
    this.cradle.add(receiver, cover);

    for (const sx of [-1, 1]) {
      const spade = this.box(0.035, 0.05, 0.19, dark);
      spade.position.set(sx * 0.11, -0.52, -0.04);
      spade.rotation.x = 10 * DEG;
      this.cradle.add(spade);
    }
    const butterfly = this.box(0.12, 0.03, 0.045, steel);
    butterfly.position.set(0, -0.53, 0.0);
    const backplate = this.box(0.2, 0.04, 0.2, dark);
    backplate.position.set(0, -0.49, -0.01);
    this.cradle.add(butterfly, backplate);

    const ammoBox = this.box(0.18, 0.3, 0.19, this.mat(0x3f4a35, 0.3, 0.7));
    ammoBox.position.set(0.2, -0.12, -0.12);
    this.cradle.add(ammoBox);
    for (let i = 0; i < 6; i++) {
      const link = this.box(0.022, 0.018, 0.045, brass);
      link.position.set(0.16 - i * 0.022, -0.06, -0.02 + i * 0.012);
      this.cradle.add(link);
    }

    const barrelLen = Math.max(0.5, d * 85);
    this.installBarrel({
      pivotY: 0.2, pivotZ: hubZ,
      length: barrelLen,
      rMuzzle: Math.max(0.011, d * 0.85), rBreech: Math.max(0.016, d * 1.25),
      backLen: 0.06, mat: steel, darkMat: dark, recuperators: false,
    });
    const shroud = this.tubeMesh(d * 1.5, d * 1.6, barrelLen * 0.42, dark, 14);
    shroud.position.y = barrelLen * 0.26;
    this.recoiling.add(shroud);
    for (let i = 0; i < 5; i++) {
      const hole = this.tubeMesh(d * 0.55, d * 0.55, d * 3.4, this.mat(0x101214, 0.3, 0.9), 8);
      hole.rotation.z = Math.PI / 2;
      hole.position.y = barrelLen * (0.12 + 0.07 * i);
      this.recoiling.add(hole);
    }
    const front = this.box(0.012, 0.012, 0.05, dark);
    front.position.set(0, barrelLen * 0.92, d * 1.6);
    this.recoiling.add(front);
    this.setupCasings(d, 4.2);
  }

  // -------------------------------------------------------------------------
  //  Obuses y cañones pesados
  // -------------------------------------------------------------------------

  /** Tubo L39 común a los obuses de 155: freno de boca, culata y atacador. */
  private installHowitzerBarrel(
    d: number, pivotY: number, pivotZ: number, gray: THREE.Material, dark: THREE.Material,
    opts: { boreEvacuator?: boolean; calibers?: number } = {},
  ): number {
    const L = d * (opts.calibers ?? 39);
    this.installBarrel({
      pivotY, pivotZ, length: L,
      rMuzzle: d * 0.56, rBreech: d * 0.92, backLen: L * 0.11,
      mat: gray, darkMat: dark,
      muzzleBrake: true,
      boreEvacuator: opts.boreEvacuator,
      breechBlock: true,
      rammer: true,
    });
    // Visor panorámico junto a la cuna (por donde apunta el artillero).
    const sight = this.box(0.14, 0.2, 0.3, dark);
    sight.position.set(-d * 2.6, L * 0.06, d * 1.4);
    this.cradle.add(sight);
    return L;
  }

  /**
   * Tren de rodaje completo de un vehículo de cadenas: orugas, faldones y
   * glacis. Lo comparten el M109 (torreta) y el 2S7 (cañón al descubierto).
   */
  private buildTrackedHull(opts: {
    hull: THREE.Object3D; width: number; length: number; deckZ: number;
    olive: THREE.Material; dark: THREE.Material; gray: THREE.Material;
    glacis?: boolean;
  }): void {
    const chassis = this.box(opts.width, opts.length, 0.95, opts.olive);
    chassis.position.set(0, 0, opts.deckZ);
    opts.hull.add(chassis);
    if (opts.glacis !== false) {
      const glacis = this.box(opts.width, 1.5, 0.7, opts.olive);
      glacis.position.set(0, opts.length / 2 - 0.05, opts.deckZ + 0.1);
      glacis.rotation.x = -28 * DEG;
      opts.hull.add(glacis);
    }
    for (const sx of [-1, 1]) {
      const track = this.trackAssembly(
        opts.length * 0.95, 0.5, this.mat(0x3a3f42, 0.4, 0.7), opts.gray,
      );
      track.position.set(sx * (opts.width / 2 + 0.05), 0, 0.6);
      opts.hull.add(track);
      const skirt = this.box(0.08, opts.length * 0.9, 0.45, opts.olive);
      skirt.position.set(sx * (opts.width / 2 + 0.17), 0, opts.deckZ + 0.23);
      opts.hull.add(skirt);
    }
  }

  /** Obús remolcado de mazas (M777): ruedas, plataforma y rejas clavadas. */
  private buildTowedHowitzer(d: number): void {
    const gray = this.mat(0x565b58, 0.5, 0.5);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const rubber = this.mat(0x1c1e20, 0.1, 0.95);

    const chassis = this.box(1.5, 2.4, 0.5, gray);
    chassis.position.set(0, 0.3, 0.95);
    this.turret.add(chassis);
    for (const sx of [-1, 1]) {
      const w = this.wheel(0.62, 0.34, rubber, gray);
      w.position.set(sx * 1.15, 0.55, 0.62);
      this.turret.add(w);
    }
    // Mazas traseras abiertas + rejas clavadas + plataforma de tiro.
    for (const side of [-1, 1]) {
      const trail = this.box(0.2, 3.4, 0.26, gray);
      trail.position.set(side * 0.85, -1.75, 0.55);
      trail.rotation.z = side * -15 * DEG;
      this.turret.add(trail);
      const spade = this.box(0.4, 0.22, 0.62, dark);
      spade.position.set(side * 1.28, -3.35, 0.3);
      spade.rotation.x = 12 * DEG;
      this.turret.add(spade);
      const jack = this.tubeMesh(0.05, 0.05, 0.5, dark, 8);
      jack.rotation.x = Math.PI / 2;
      jack.position.set(side * 1.1, -2.6, 0.25);
      this.turret.add(jack);
    }
    const platform = this.disc([
      [0, 0], [0.78, 0], [0.82, 0.1], [0.6, 0.18], [0, 0.2],
    ], dark, 24);
    this.turret.add(platform);
    // Asiento del apuntador y volantes (el M777 no lleva escudo).
    for (const sx of [-1, 1]) {
      const handwheel = this.mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 16), dark);
      handwheel.rotation.y = Math.PI / 2;
      handwheel.position.set(sx * 0.95, 0.1, 1.25);
      this.turret.add(handwheel);
    }
    const seat = this.box(0.34, 0.32, 0.08, dark);
    seat.position.set(-0.95, -0.5, 1.0);
    this.turret.add(seat);

    this.installHowitzerBarrel(d, 0.35, 1.35, gray, dark);
  }

  /** Autopropulsado de torreta cerrada (M109A7 Paladin). */
  private buildTurretHowitzer(d: number): void {
    const olive = this.mat(0x4a5240, 0.4, 0.6);
    const gray = this.mat(0x565b58, 0.5, 0.5);
    const dark = this.mat(0x2e3133, 0.5, 0.55);

    // El casco NO gira con el azimut: solo la torreta.
    this.buildTrackedHull({
      hull: this.group, width: 2.9, length: 6.1, deckZ: 1.05,
      olive, dark, gray,
    });

    const turretBox = this.box(2.5, 3.0, 1.0, olive);
    turretBox.position.set(0, -0.5, 2.0);
    const turretTop = this.box(1.9, 2.2, 0.55, olive);
    turretTop.position.set(0, -0.6, 2.75);
    const bustle = this.box(2.2, 1.0, 0.8, olive); // cesta trasera de munición
    bustle.position.set(0, -2.2, 2.1);
    const hatch = this.disc([
      [0, 0], [0.34, 0], [0.36, 0.06], [0.3, 0.1], [0, 0.11],
    ], dark, 16);
    hatch.position.set(-0.6, -1.0, 3.0);
    const cupola = this.tubeMesh(0.42, 0.45, 0.3, olive, 16);
    cupola.rotation.x = Math.PI / 2;
    cupola.position.set(0.62, -1.0, 3.15);
    const mg = this.tubeMesh(0.03, 0.04, 0.9, dark, 10);
    mg.position.set(0.62, -0.6, 3.4);
    mg.rotation.x = -8 * DEG;
    this.turret.add(turretBox, turretTop, bustle, hatch, cupola, mg);
    const periscope = this.box(0.16, 0.1, 0.14, dark);
    periscope.position.set(-0.6, -0.1, 3.06);
    const antenna = this.tubeMesh(0.012, 0.018, 2.2, dark, 6);
    antenna.rotation.x = Math.PI / 2 + 6 * DEG;
    antenna.position.set(-1.0, -2.0, 3.6);
    this.turret.add(periscope, antenna);

    this.installHowitzerBarrel(d, 0.55, 2.25, gray, dark, { boreEvacuator: true });
  }

  /**
   * Cañón pesado sobre cadenas y AL DESCUBIERTO (2S7 Pion): el tubo de 203 mm
   * va montado sobre la cubierta trasera, sin torreta, y una pala hidráulica
   * enorme se clava en el suelo detrás para aguantar el retroceso. La
   * dotación viaja en la caseta delantera.
   */
  private buildOpenTrackedGun(d: number): void {
    const olive = this.mat(0x53573f, 0.4, 0.65);
    const gray = this.mat(0x5c605c, 0.5, 0.5);
    const dark = this.mat(0x2b2e30, 0.5, 0.55);

    this.buildTrackedHull({
      hull: this.group, width: 3.2, length: 10.5, deckZ: 1.1,
      olive, dark, gray, glacis: false,
    });

    // Caseta delantera de la dotación, con ventanillas.
    const cab = this.box(3.0, 3.0, 1.15, olive);
    cab.position.set(0, 3.4, 2.15);
    const roof = this.box(2.4, 2.4, 0.25, olive);
    roof.position.set(0, 3.4, 2.85);
    this.group.add(cab, roof);
    for (const sx of [-1, 1]) {
      const win = this.box(0.06, 0.7, 0.42, this.mat(0x16323c, 0.2, 0.15));
      win.position.set(sx * 1.52, 4.1, 2.35);
      this.group.add(win);
    }
    // Cubierta trasera despejada donde se asienta la cureña.
    const deck = this.box(2.6, 3.6, 0.3, gray);
    deck.position.set(0, -2.6, 1.7);
    this.group.add(deck);

    // Pala hidráulica trasera clavada (lo que de verdad frena a un 203 mm).
    const spade = this.box(2.6, 1.5, 0.28, dark);
    spade.position.set(0, -5.55, 0.42);
    spade.rotation.x = 42 * DEG;   // hoja mordiendo el suelo, no una pantalla
    this.group.add(spade);
    const spadeLip = this.box(2.6, 0.5, 0.22, dark);
    spadeLip.position.set(0, -6.0, 0.03);
    this.group.add(spadeLip);
    for (const sx of [-1, 1]) {
      this.group.add(this.strut(
        new THREE.Vector3(sx * 1.0, -4.0, 1.7),
        new THREE.Vector3(sx * 0.85, -5.3, 0.62), 0.13, dark,
      ));
    }

    // Cureña abierta: dos montantes que sujetan los muñones, sin blindaje.
    for (const sx of [-1, 1]) {
      const post = this.box(0.3, 0.9, 1.3, gray);
      post.position.set(sx * 0.95, -2.3, 2.5);
      this.turret.add(post);
    }
    const ringMount = this.disc([
      [0, 0], [1.35, 0], [1.4, 0.16], [1.1, 0.24], [0, 0.26],
    ], gray, 24);
    ringMount.position.set(0, -2.3, 1.85);
    this.turret.add(ringMount);
    // Asientos de los sirvientes a ambos lados del tubo.
    for (const sx of [-1, 1]) {
      const seat = this.box(0.34, 0.34, 0.08, dark);
      seat.position.set(sx * 1.35, -2.9, 2.35);
      this.turret.add(seat);
    }

    // L56 en 203 mm: el tubo es descomunal (~11 m), y sin freno de boca.
    const L = d * 56;
    this.installBarrel({
      pivotY: -2.3, pivotZ: 3.15, length: L,
      rMuzzle: d * 0.5, rBreech: d * 0.85, backLen: L * 0.1,
      mat: gray, darkMat: dark,
      muzzleBrake: false,
      breechBlock: true,
      rammer: true,
    });
  }

  // -------------------------------------------------------------------------
  //  Lanzacohetes
  // -------------------------------------------------------------------------

  /**
   * Pod de 6 tubos con los cohetes VISIBLES asomando (desaparecen al salir).
   * `slot` desplaza el pod a un lado para montar dos, como en el M270.
   */
  private buildRocketPod(d: number, podLen: number, slotX: number): void {
    const olive = this.mat(0x49523f, 0.35, 0.65);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const nose = this.mat(0x6b3025, 0.3, 0.7);
    const skin = this.mat(0x8d9285, 0.5, 0.5);

    // Marco ABIERTO (cuatro largueros + dos cuadernas): una caja maciza tapaba
    // los tubos y el pod parecía un ladrillo.
    for (const [ex, ez] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const rail = this.box(0.1, podLen * 0.92, 0.1, olive);
      rail.position.set(slotX + ex * 0.56, podLen / 2 - 0.8, ez * 0.88);
      this.recoiling.add(rail);
    }
    for (const fy of [0.06, 0.92]) {
      const frame = this.box(1.16, 0.12, 1.82, olive);
      frame.position.set(slotX, podLen * fy - 0.8, 0);
      this.recoiling.add(frame);
    }
    for (let i = 0; i < 6; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const x = slotX + (col - 0.5) * 0.52, z = (row - 1) * 0.58;
      const tube = this.tubeMesh(d * 1.25, d * 1.25, podLen * 0.95, dark, 14);
      tube.position.set(x, podLen / 2 - 0.8, z);
      this.recoiling.add(tube);
      const rk = new THREE.Group();
      const bodyMesh = this.tubeMesh(d * 0.95, d * 0.95, 0.55, skin, 12);
      const tip = this.mesh(new THREE.ConeGeometry(d * 0.95, 0.45, 12), nose);
      tip.position.y = 0.5;
      rk.add(bodyMesh, tip);
      rk.position.set(x, podLen - 1.1, z);
      this.recoiling.add(rk);
      this.ammoVisuals.push(rk);
    }
  }

  /**
   * HIMARS: camión 6×6 de cabina blindada con UN solo pod. Es la mitad de un
   * M270 sobre ruedas — más ligero y aerotransportable, y así se ve.
   * Con `pods = 2` monta contenedores en vez de tubos (ER GMLRS / PrSM).
   */
  private buildRocketTruck(d: number, pods: number): void {
    const olive = this.mat(0x49523f, 0.35, 0.65);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const rubber = this.mat(0x1a1c1e, 0.1, 0.95);
    const glass = this.mat(0x16323c, 0.2, 0.15);
    const cabMat = this.mat(0x3c4437, 0.35, 0.6);

    const bed = this.box(2.5, 7.0, 0.7, olive);
    bed.position.set(0, 0, 1.15);
    this.group.add(bed);
    const cab = this.box(2.3, 1.9, 1.6, cabMat);
    cab.position.set(0, 2.9, 2.2);
    const windshield = this.box(2.0, 0.08, 0.7, glass);
    windshield.position.set(0, 3.85, 2.5);
    windshield.rotation.x = -14 * DEG;
    const bumper = this.box(2.4, 0.25, 0.3, dark);
    bumper.position.set(0, 4.05, 1.35);
    this.group.add(cab, windshield, bumper);
    // Ruedas 6×6 (tres ejes: es lo que distingue al HIMARS del M270).
    for (const sx of [-1, 1]) {
      for (const wy of [-2.6, -1.3, 2.9]) {
        const w = this.wheel(0.62, 0.42, rubber, dark);
        w.position.set(sx * 1.3, wy, 0.62);
        this.group.add(w);
      }
    }
    for (const sx of [-1, 1]) {
      const jack = this.tubeMesh(0.09, 0.09, 1.1, dark, 10);
      jack.rotation.x = Math.PI / 2;
      jack.position.set(sx * 1.15, -3.1, 0.55);
      const foot = this.box(0.5, 0.5, 0.1, dark);
      foot.position.set(sx * 1.15, -3.1, 0.05);
      this.group.add(jack, foot);
    }

    const podLen = Math.max(4.2, d * 18);
    if (pods >= 2) this.buildContainerPods(d, podLen, 2);
    else this.buildRocketPod(d, podLen, 0);
    this.tubesLoaded = this.ammoVisuals.length;
    this.installBarrelless({ pivotY: -1.4, pivotZ: 1.95, muzzleY: podLen - 0.8 });
  }

  /**
   * M270 MLRS: casco de CADENAS (derivado del Bradley) con DOS pods de seis.
   * Doce cohetes en el aire frente a los seis del HIMARS.
   */
  private buildRocketTracked(d: number, pods: number): void {
    const olive = this.mat(0x49523f, 0.35, 0.65);
    const gray = this.mat(0x565b58, 0.5, 0.5);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const glass = this.mat(0x16323c, 0.2, 0.15);

    this.buildTrackedHull({
      hull: this.group, width: 2.9, length: 6.6, deckZ: 1.0,
      olive, dark, gray, glacis: false,
    });
    // Cabina blindada delantera con parabrisas de rejilla.
    const cab = this.box(2.7, 2.1, 1.35, olive);
    cab.position.set(0, 2.3, 2.15);
    const slope = this.box(2.7, 0.9, 0.7, olive);
    slope.position.set(0, 3.35, 2.0);
    slope.rotation.x = -32 * DEG;
    const windshield = this.box(2.2, 0.08, 0.55, glass);
    windshield.position.set(0, 3.3, 2.35);
    windshield.rotation.x = -32 * DEG;
    this.group.add(cab, slope, windshield);

    // Estructura basculante que sostiene los dos pods.
    const cage = this.box(2.9, 0.45, 2.0, gray);
    cage.position.set(0, -0.55, 0);
    this.recoiling.add(cage);

    const podLen = Math.max(4.2, d * 18);
    const n = Math.max(1, pods);
    for (let i = 0; i < n; i++) {
      this.buildRocketPod(d, podLen, (i - (n - 1) / 2) * 1.32);
    }
    this.tubesLoaded = this.ammoVisuals.length;
    this.installBarrelless({ pivotY: -2.0, pivotZ: 2.1, muzzleY: podLen - 0.8 });
  }

  /** Contenedores sellados (ER GMLRS / PrSM): no se ven tubos, solo cajas. */
  private buildContainerPods(d: number, podLen: number, count: number): void {
    const olive = this.mat(0x4d5346, 0.35, 0.65);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const w = Math.max(0.9, d * 4.6);   // el contenedor abraza al cohete
    const h = Math.max(1.3, d * 6.2);
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * (w * 1.1);
      const shell = this.box(w, podLen * 0.95, h, olive);
      shell.position.set(x, podLen / 2 - 0.8, 0);
      this.recoiling.add(shell);
      // Nervios de refuerzo del contenedor.
      for (let k = 0; k < 4; k++) {
        const rib = this.box(w * 1.07, 0.1, h * 1.04, dark);
        rib.position.set(x, podLen * (0.12 + 0.24 * k) - 0.6, 0);
        this.recoiling.add(rib);
      }
      // Tapa frangible que salta al disparar.
      const lid = this.box(w * 0.95, 0.08, h * 0.96, dark);
      lid.position.set(x, podLen - 0.85, 0);
      this.recoiling.add(lid);
      this.ammoVisuals.push(lid);
    }
  }

  /**
   * TEL de misiles: camión 10×10 con uno o DOS canisters. El ATACMS va solo;
   * el PrSM es más esbelto y caben dos por pod, que es justo su argumento.
   */
  private buildMissileTel(d: number, pods: number): void {
    const olive = this.mat(0x4d5346, 0.35, 0.65);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const rubber = this.mat(0x1a1c1e, 0.1, 0.95);
    const cabMat = this.mat(0x3c4437, 0.35, 0.6);
    const glass = this.mat(0x16323c, 0.2, 0.15);

    const bed = this.box(2.7, 8.2, 0.75, olive);
    bed.position.set(0, 0, 1.2);
    const cab = this.box(2.5, 2.0, 1.65, cabMat);
    cab.position.set(0, 3.6, 2.3);
    const windshield = this.box(2.2, 0.08, 0.75, glass);
    windshield.position.set(0, 4.6, 2.6);
    windshield.rotation.x = -14 * DEG;
    this.group.add(bed, cab, windshield);

    for (const sx of [-1, 1]) {
      for (const wy of [-3.2, -1.9, -0.6, 2.1, 3.4]) {
        const w = this.wheel(0.66, 0.44, rubber, dark);
        w.position.set(sx * 1.42, wy, 0.66);
        this.group.add(w);
      }
    }
    for (const sx of [-1, 1]) {
      const jack = this.tubeMesh(0.1, 0.1, 1.15, dark, 10);
      jack.rotation.x = Math.PI / 2;
      jack.position.set(sx * 1.25, -3.7, 0.57);
      const foot = this.box(0.55, 0.55, 0.1, dark);
      foot.position.set(sx * 1.25, -3.7, 0.05);
      this.group.add(jack, foot);
    }

    const canLen = Math.max(6.5, d * 11);
    const n = Math.max(1, pods);
    const r = Math.max(0.42, d * 0.95);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (r * 2.3);
      const canister = this.tubeMesh(r, r, canLen, olive, 20);
      canister.position.set(x, canLen / 2 - 1.2, 0);
      this.recoiling.add(canister);
      for (let k = 0; k < 4; k++) {
        const band = this.mesh(new THREE.TorusGeometry(r * 1.02, r * 0.07, 6, 20), dark);
        band.rotation.x = Math.PI / 2;
        band.position.set(x, -1.2 + canLen * (0.15 + 0.23 * k), 0);
        this.recoiling.add(band);
      }
      const lid = this.lathe([
        [0, 0], [r * 1.05, 0], [r * 1.05, 0.12], [r * 0.6, 0.2], [0, 0.22],
      ], dark, 20);
      lid.position.set(x, canLen - 1.2, 0);
      this.recoiling.add(lid);
      this.ammoVisuals.push(lid);
    }
    // Bastidor que abraza los canisters y cilindro de elevación.
    const cradleFrame = this.box(r * 2.5 * n, 1.0, r * 0.5, dark);
    cradleFrame.position.set(0, canLen * 0.2, -r * 1.15);
    const ram = this.tubeMesh(0.16, 0.2, canLen * 0.4, dark, 12);
    ram.position.set(0, canLen * 0.1, -r * 1.5);
    this.cradle.add(cradleFrame, ram);

    this.tubesLoaded = this.ammoVisuals.length;
    this.installBarrelless({ pivotY: -2.2, pivotZ: 2.0, muzzleY: canLen - 1.2 });
  }

  /** Variante de installBarrel para lanzadores (la geometría ya está puesta). */
  private installBarrelless(opts: { pivotY: number; pivotZ: number; muzzleY: number }): void {
    this.cradle.position.set(0, opts.pivotY, opts.pivotZ);
    this.turret.add(this.cradle);
    this.pivotY = opts.pivotY;
    this.pivotZ = opts.pivotZ;
    this.muzzleY = opts.muzzleY;
  }
}
