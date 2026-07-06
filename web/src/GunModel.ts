// ============================================================================
//  GunModel.ts — Modelo 3D procedural del arma que apunta EN VIVO.  [P-PRO.1]
//
//  La batería deja de ser un punto invisible: geometría Three.js por
//  categoría (mortero/obús/cohete/misil), cero assets binarios. El grupo vive
//  en overlay.enuRoot en el origen ENU. Convención local: +y = adelante
//  (norte con azimut 0), +z = arriba; el azimut gira la parte móvil sobre z
//  (si traverseDeg < 360 gira el arma ENTERA: los morteros no tienen torreta)
//  y el tubo se eleva en su pivote (rotación sobre x local).
//
//  La boca REAL del tubo se expone con muzzleWorldEnu() (analítica, sin pasar
//  por matrices de Three): de ahí nacen fogonazo, humo y cámara de cabina.
//  Al disparar, fireRecoil() retrocede el tubo 0.3-0.5 m con retorno
//  amortiguado ~0.4 s (solo visual, la física no se toca).
// ============================================================================
import * as THREE from 'three';
import { Vec3, Weapon } from './ballistics';

const DEG = Math.PI / 180;

export class GunModel {
  /** Raíz del modelo (hijo de enuRoot, en el origen ENU de la batería). */
  readonly group = new THREE.Group();

  /** Parte que gira en azimut (torreta, o el arma entera si no hay torreta). */
  private turret = new THREE.Group();
  /** Pivote de elevación (cuna); su rotation.x es la elevación. */
  private cradle = new THREE.Group();
  /** Malla(s) del tubo: retroceden juntas a lo largo de -y local. */
  private recoiling = new THREE.Group();

  // Geometría de puntería (para muzzleWorldEnu analítica).
  private pivotY = 0;         // pivote de la cuna, adelante del eje de giro (m)
  private pivotZ = 0;         // altura del pivote (m)
  private muzzleY = 0;        // boca: distancia desde el pivote a lo largo del tubo

  // Retroceso visual.
  private recoilAmpM = 0.4;
  private recoilAge = Number.POSITIVE_INFINITY;
  private recoilNow = 0;

  private azimuthDeg = 0;
  private elevationDeg = 0;
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

  /** Puntería en vivo + retorno amortiguado del retroceso. */
  update(dt: number, azimuthDeg: number, elevationDeg: number): void {
    this.azimuthDeg = azimuthDeg;
    this.elevationDeg = elevationDeg;

    // Retroceso: culatazo casi instantáneo (60 ms) y retorno exponencial
    // (~0.4 s hasta asentarse), como el freno hidroneumático real.
    this.recoilAge += dt;
    const t0 = 0.06, tau = 0.12;
    const a = this.recoilAge;
    this.recoilNow =
      a < t0 ? this.recoilAmpM * (a / t0)
      : a < t0 + 5 * tau ? this.recoilAmpM * Math.exp(-(a - t0) / tau)
      : 0;
    this.recoiling.position.y = -this.recoilNow;

    // La energía que el freno no absorbe la come la suspensión: el arma se
    // encoge unos cm y cabecea medio grado mientras dura el culatazo.
    const env = this.recoilAmpM > 0 ? this.recoilNow / this.recoilAmpM : 0;
    this.turret.rotation.z = -azimuthDeg * DEG;
    this.cradle.rotation.x = elevationDeg * DEG - 0.6 * DEG * env;
    this.group.position.z = -0.05 * env;
  }

  /** Dispara el retroceso visual del tubo. */
  fireRecoil(): void { this.recoilAge = 0; }

  /** Punta del tubo en coordenadas ENU (analítica: az/el actuales + retroceso). */
  muzzleWorldEnu(): Vec3 {
    const az = this.azimuthDeg * DEG;
    const el = this.elevationDeg * DEG;
    const sinAz = Math.sin(az), cosAz = Math.cos(az);
    const dir = new Vec3(sinAz * Math.cos(el), cosAz * Math.cos(el), Math.sin(el));
    const pivot = new Vec3(this.pivotY * sinAz, this.pivotY * cosAz, this.pivotZ);
    return pivot.add(dir.mul(this.muzzleY - this.recoilNow));
  }

  dispose(): void {
    this.clear();
    this.parent.remove(this.group);
  }

  // -------------------------------------------------------------------------
  //  Construcción por categoría.
  // -------------------------------------------------------------------------
  private clear(): void {
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private build(weapon: Weapon): void {
    this.turret = new THREE.Group();
    this.cradle = new THREE.Group();
    this.recoiling = new THREE.Group();
    this.cradle.add(this.recoiling);
    this.group.add(this.turret);

    const d = weapon.round.diameter;
    switch (weapon.category) {
      case 'Mortar': this.buildMortar(d); break;
      case 'Howitzer': this.buildHowitzer(d, weapon.traverseDeg >= 360); break;
      case 'Rocket': this.buildRocket(d); break;
      case 'Missile': this.buildMissile(d); break;
      case 'SmallArms': this.buildSmallArm(d); break;
    }
    this.recoilAmpM =
      weapon.category === 'SmallArms' ? 0.03
      : weapon.category === 'Mortar' ? 0.12
      : Math.min(0.5, Math.max(0.3, d * 2.2));
    this.recoilAge = Number.POSITIVE_INFINITY;
    this.update(0, this.azimuthDeg, this.elevationDeg);
  }

  // -- Materiales/geometrías con registro para dispose ------------------------
  private mat(color: number, metalness = 0.45, roughness = 0.55): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    this.disposables.push(m);
    return m;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    this.disposables.push(geo);
    return new THREE.Mesh(geo, mat);
  }

  private box(w: number, dpt: number, h: number, mat: THREE.Material): THREE.Mesh {
    // (ancho x, fondo y, alto z)
    return this.mesh(new THREE.BoxGeometry(w, dpt, h), mat);
  }

  /** Cilindro a lo largo de +y (CylinderGeometry ya es axial en y). */
  private tubeMesh(rMuzzle: number, rBreech: number, len: number, mat: THREE.Material): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rMuzzle, rBreech, len, 20), mat);
  }

  /** Rueda con el eje en x (lateral). */
  private wheel(r: number, width: number, mat: THREE.Material): THREE.Mesh {
    const m = this.mesh(new THREE.CylinderGeometry(r, r, width, 18), mat);
    m.rotation.z = Math.PI / 2;
    return m;
  }

  /** Tubo + boca en la cuna; deja pivote/boca registrados para la puntería. */
  private installBarrel(opts: {
    pivotY: number; pivotZ: number; length: number;
    rMuzzle: number; rBreech: number; backLen?: number;
    mat: THREE.Material; muzzleBrake?: boolean; brakeMat?: THREE.Material;
    /** Evacuador de ánima: bulto a ~60% del tubo (obuses de torreta). */
    boreEvacuator?: boolean;
    /** Bloque de culata visible que retrocede con el tubo. */
    breechBlock?: boolean;
  }): void {
    const back = opts.backLen ?? opts.length * 0.12; // culata por detrás del pivote
    const tube = this.tubeMesh(opts.rMuzzle, opts.rBreech, opts.length + back, opts.mat);
    tube.position.y = (opts.length - back) / 2;
    this.recoiling.add(tube);

    if (opts.breechBlock) {
      const block = this.box(opts.rBreech * 3.4, opts.rBreech * 2.6, opts.rBreech * 3.0, opts.mat);
      block.position.y = -back;
      this.recoiling.add(block);
    }

    if (opts.boreEvacuator) {
      const ev = this.tubeMesh(opts.rMuzzle * 1.65, opts.rMuzzle * 1.65, opts.length * 0.14, opts.mat);
      ev.position.y = opts.length * 0.62;
      this.recoiling.add(ev);
    }

    if (opts.muzzleBrake) {
      // Freno de boca: cilindro más ancho con dos deflectores (las "ranuras"
      // se leen por el contraste de los bloques laterales oscuros).
      const brakeMat = opts.brakeMat ?? opts.mat;
      const brake = this.tubeMesh(opts.rMuzzle * 1.9, opts.rMuzzle * 1.9, opts.rMuzzle * 5.2, brakeMat);
      brake.position.y = opts.length - opts.rMuzzle * 2.4;
      const slot = this.box(opts.rMuzzle * 5.2, opts.rMuzzle * 3.4, opts.rMuzzle * 1.4, brakeMat);
      slot.position.y = brake.position.y;
      this.recoiling.add(brake, slot);
    }

    // Cuna con los cilindros del freno/recuperador bajo el tubo (no retroceden:
    // son los que FRENAN al conjunto que sí retrocede).
    for (const side of [-1, 1]) {
      const recup = this.tubeMesh(opts.rMuzzle * 0.5, opts.rMuzzle * 0.5, opts.length * 0.3, opts.mat);
      recup.position.set(side * opts.rBreech * 1.15, opts.length * 0.12, -opts.rBreech * 1.15);
      this.cradle.add(recup);
    }

    this.cradle.position.set(0, opts.pivotY, opts.pivotZ);
    this.turret.add(this.cradle);
    this.pivotY = opts.pivotY;
    this.pivotZ = opts.pivotZ;
    this.muzzleY = opts.length;
  }

  /** Mortero: placa base circular + bípode + tubo corto muy empinado. */
  private buildMortar(d: number): void {
    const steel = this.mat(0x4a5240, 0.4, 0.6);      // verde oliva
    const dark = this.mat(0x33383a, 0.55, 0.45);

    const plate = this.mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.09, 24), dark);
    plate.rotation.x = Math.PI / 2; // eje y -> z: placa tumbada en el suelo
    plate.position.z = 0.05;
    this.turret.add(plate);

    // Bípode: dos patas delante del tubo.
    for (const side of [-1, 1]) {
      const leg = this.mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.15, 10), steel);
      leg.position.set(side * 0.32, 0.55, 0.55);
      leg.rotation.x = -35 * DEG;
      leg.rotation.z = side * 14 * DEG;
      this.turret.add(leg);
    }

    this.installBarrel({
      pivotY: 0, pivotZ: 0.16,
      length: d * 14.5,           // 120 mm -> ~1.75 m
      rMuzzle: d * 0.62, rBreech: d * 0.72, backLen: 0.1,
      mat: steel,
    });
  }

  /** Arma ligera: trípode + cajón de mecanismos + cañón fino a escala real.
   *  El modelo es pequeño de verdad (una M2 mide ~1.7 m): la Cabina queda
   *  encima como un tirador de pie y las demás cámaras la ven diminuta —
   *  correcto, es la escala del arma. */
  private buildSmallArm(d: number): void {
    const dark = this.mat(0x33383a, 0.55, 0.45);
    const steel = this.mat(0x454b47, 0.6, 0.4);

    // Trípode: tres patas hacia atrás/lados, rótula a ~1 m.
    const hubZ = 1.0;
    for (const [ang, lean] of [[0, 34], [130, 30], [-130, 30]] as const) {
      const leg = this.mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.25, 8), dark);
      const a = ang * DEG;
      leg.position.set(Math.sin(a) * 0.34, -Math.abs(Math.cos(a)) * 0.1 + Math.cos(a) * 0.34, hubZ / 2);
      leg.rotation.x = Math.cos(a) * lean * DEG;
      leg.rotation.y = 0;
      leg.rotation.z = -Math.sin(a) * lean * DEG;
      this.turret.add(leg);
    }

    // Cajón de mecanismos (receiver) sobre la rótula, solidario a la cuna.
    const receiver = this.box(0.16, 0.62, 0.18, steel);
    receiver.position.set(0, -0.1, 0);
    this.cradle.add(receiver);
    // Culata/gatillo esquemático atrás.
    const grip = this.box(0.1, 0.16, 0.12, dark);
    grip.position.set(0, -0.42, -0.05);
    this.cradle.add(grip);

    this.installBarrel({
      pivotY: 0.15, pivotZ: hubZ,
      length: Math.max(0.5, d * 85),   // 12.7 mm -> ~1.1 m de cañón
      rMuzzle: Math.max(0.012, d * 0.9),
      rBreech: Math.max(0.016, d * 1.2),
      backLen: 0.05,
      mat: steel,
    });
  }

  /** Obús: chasis bajo con mazas/ruedas + cuna + tubo largo L39 con freno. */
  private buildHowitzer(d: number, hasTurret: boolean): void {
    const olive = this.mat(0x4a5240, 0.4, 0.6);
    const gray = this.mat(0x565b58, 0.5, 0.5);
    const dark = this.mat(0x2e3133, 0.5, 0.55);

    // Chasis (autopropulsado si hay torreta; remolcado si no).
    const hull = hasTurret ? this.group : this.turret; // torreta: el casco NO gira
    const chassis = this.box(2.6, 4.6, 0.85, olive);
    chassis.position.set(0, 0, 0.85);
    hull.add(chassis);
    for (const sx of [-1, 1]) {
      for (const wy of hasTurret ? [-1.6, -0.55, 0.55, 1.6] : [0.25]) {
        const w = this.wheel(0.52, 0.32, dark);
        w.position.set(sx * 1.35, wy, 0.52);
        hull.add(w);
      }
    }
    if (!hasTurret) {
      // Mazas del M777: dos patas traseras abiertas + plataforma de tiro
      // central (el arma real dispara asentada sobre ella, no sobre las ruedas).
      for (const side of [-1, 1]) {
        const trail = this.box(0.22, 3.1, 0.22, gray);
        trail.position.set(side * 0.75, -1.7, 0.5);
        trail.rotation.z = side * -16 * DEG;
        this.turret.add(trail);
        const spade = this.box(0.34, 0.3, 0.5, dark); // reja clavada al suelo
        spade.position.set(side * 1.15, -3.15, 0.25);
        this.turret.add(spade);
      }
      const platform = this.mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.18, 20), dark);
      platform.rotation.x = Math.PI / 2;
      platform.position.z = 0.1;
      this.turret.add(platform);
    } else {
      // Torreta del M109: casco inclinado en dos alturas + escotilla.
      const turretBox = this.box(2.3, 2.6, 0.95, olive);
      turretBox.position.set(0, -0.3, 1.95);
      const turretTop = this.box(1.7, 1.9, 0.5, olive);
      turretTop.position.set(0, -0.45, 2.65);
      const hatch = this.mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 14), dark);
      hatch.rotation.x = Math.PI / 2;
      hatch.position.set(-0.55, -0.8, 2.95);
      this.turret.add(turretBox, turretTop, hatch);
    }

    this.installBarrel({
      pivotY: hasTurret ? 0.8 : 0.35,
      pivotZ: hasTurret ? 2.15 : 1.25,
      length: d * 39,             // L39: 155 mm -> ~6.05 m
      rMuzzle: d * 0.58, rBreech: d * 0.95,
      mat: gray, muzzleBrake: true, brakeMat: dark,
      boreEvacuator: hasTurret, breechBlock: true,
    });
  }

  /** Cohete: camión esquemático + caja lanzadora con 6 bocas visibles. */
  private buildRocket(d: number): void {
    const olive = this.mat(0x49523f, 0.35, 0.65);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const cabMat = this.mat(0x3c4437, 0.35, 0.6);

    const bed = this.box(2.5, 7.0, 0.7, olive);
    bed.position.set(0, 0, 1.15);
    this.group.add(bed);
    const cab = this.box(2.3, 1.7, 1.5, cabMat);
    cab.position.set(0, 2.9, 2.15);
    this.group.add(cab);
    for (const sx of [-1, 1]) {
      for (const wy of [-2.6, -1.4, 1.6, 2.9]) {
        const w = this.wheel(0.58, 0.4, dark);
        w.position.set(sx * 1.3, wy, 0.58);
        this.group.add(w);
      }
    }

    // Gatos estabilizadores traseros: el camión no dispara sobre la suspensión.
    for (const sx of [-1, 1]) {
      const jack = this.mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 10), dark);
      jack.rotation.x = Math.PI / 2; // vertical
      jack.position.set(sx * 1.15, -3.1, 0.55);
      const foot = this.box(0.5, 0.5, 0.1, dark);
      foot.position.set(sx * 1.15, -3.1, 0.05);
      this.group.add(jack, foot);
    }

    // Caja lanzadora (pivote trasero) con 6 bocas en la cara delantera.
    const podLen = Math.max(4.2, d * 18);
    const pod = this.box(2.3, podLen, 1.7, olive);
    pod.position.y = podLen / 2 - 0.8;
    this.recoiling.add(pod);
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3);
      const hole = this.mesh(new THREE.CylinderGeometry(d * 1.15, d * 1.15, 0.12, 16), dark);
      hole.position.set((col - 1) * 0.72, podLen - 0.82, (row - 0.5) * 0.8);
      this.recoiling.add(hole);
    }
    this.installBarrelless({ pivotY: -1.4, pivotZ: 1.95, muzzleY: podLen - 0.8 });
  }

  /** Misil: TEL con canister único grande que se eleva. */
  private buildMissile(d: number): void {
    const olive = this.mat(0x4d5346, 0.35, 0.65);
    const dark = this.mat(0x2e3133, 0.5, 0.55);
    const cabMat = this.mat(0x3c4437, 0.35, 0.6);

    const bed = this.box(2.7, 8.2, 0.75, olive);
    bed.position.set(0, 0, 1.2);
    this.group.add(bed);
    const cab = this.box(2.5, 1.8, 1.55, cabMat);
    cab.position.set(0, 3.6, 2.25);
    this.group.add(cab);
    for (const sx of [-1, 1]) {
      for (const wy of [-3.2, -1.9, -0.6, 2.1, 3.4]) {
        const w = this.wheel(0.62, 0.42, dark);
        w.position.set(sx * 1.42, wy, 0.62);
        this.group.add(w);
      }
    }

    for (const sx of [-1, 1]) {
      const jack = this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.15, 10), dark);
      jack.rotation.x = Math.PI / 2;
      jack.position.set(sx * 1.25, -3.7, 0.57);
      const foot = this.box(0.55, 0.55, 0.1, dark);
      foot.position.set(sx * 1.25, -3.7, 0.05);
      this.group.add(jack, foot);
    }

    const canLen = Math.max(6.5, d * 11);
    const canister = this.mesh(
      new THREE.CylinderGeometry(Math.max(0.55, d * 0.95), Math.max(0.55, d * 0.95), canLen, 18),
      olive,
    );
    canister.position.y = canLen / 2 - 1.2;
    this.recoiling.add(canister);
    const lid = this.mesh(
      new THREE.CylinderGeometry(Math.max(0.58, d), Math.max(0.58, d), 0.16, 18), dark,
    );
    lid.position.y = canLen - 1.2;
    this.recoiling.add(lid);
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
