// ============================================================================
//  ProjectileModel.ts — Silueta y animación del proyectil en vuelo. [P-ANI.2]
//
//  Antes el proyectil era un cilindro con un cono pegado. Ahora cada familia
//  tiene su forma real, generada por revolución (cero assets):
//
//    shell      — granada de artillería: ojiva TANGENTE calculada de verdad,
//                 cuerpo cilíndrico, banda de forzamiento de cobre y culote
//                 en barco (boat tail). Espoleta en punta.
//    mortarBomb — bomba lagrimal con vástago de cola y seis aletas.
//    rocket     — cohete: cuerpo esbelto, tobera, cuatro aletas de cola
//                 PLEGADAS que se abren al salir del tubo, y canards.
//    missile    — misil táctico: igual pero mayor, con aletas de gobierno.
//    bullet     — bala spitzer con culote troncocónico, latón y punta gris.
//
//  Y lo que hace en vuelo:
//
//   * GIRO REAL — la velocidad de giro sale del paso del estriado:
//     ω = 2πv/(twist·d). Un 155 mm a 684 m/s gira a ~220 rev/s, que a 60 fps
//     es puro aliasing (se vería quieto o girando al revés), así que se pinta
//     comprimida logarítmicamente: se ve girar y sigue siendo proporcional al
//     giro real. Los proyectiles de aletas (mortero) no giran.
//   * YAW OF REPOSE — al salir del tubo el proyectil cabecea y la oscilación
//     se amortigua en el primer par de segundos, como en la realidad.
//   * ALETAS QUE SE DESPLIEGAN — los cohetes salen con las aletas envolviendo
//     el cuerpo y las abren en ~0.25 s.
//   * TOBERA ENCENDIDA — mientras el motor quema, la tobera brilla y proyecta
//     luz; se apaga al agotarse el propulsante.
//   * NARIZ INCANDESCENTE — por encima de Mach 4 el morro se pone al rojo y
//     luego al blanco: el calentamiento aerodinámico de la reentrada.
//   * ESCALA DE LECTURA — un proyectil de 0.86 m a 10 km es medio píxel. La
//     malla se agranda con la distancia a la cámara (nunca por debajo del
//     tamaño real) para que se lea; el trazador hace el resto.
// ============================================================================
import * as THREE from 'three';
import type { Weapon } from '../ballistics';
import { makeGlowSprite } from './PostFX';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Estado de vuelo que el presentador pasa cada frame. */
export interface ProjectileVisualState {
  /** Segundos desde que salió del tubo (tiempo de simulación). */
  elapsed: number;
  /** Módulo de la velocidad (m/s). */
  speed: number;
  mach: number;
  /** El motor está empujando ahora mismo. */
  thrusting: boolean;
  /** Distancia a la cámara (m): fija la escala de lectura. */
  camDistance: number;
}

export class ProjectileModel {
  /** Nodo que el presentador coloca y orienta (nariz a +Z local). */
  readonly group = new THREE.Group();

  /** Halo del trazador: hace legible el proyectil a kilómetros. */
  readonly tracer: THREE.Sprite;

  private readonly scaler = new THREE.Group();   // escala de lectura
  private readonly precess = new THREE.Group();  // yaw of repose
  private readonly spinner = new THREE.Group();  // giro sobre el eje
  private readonly fins: THREE.Object3D[] = [];
  private readonly noseMat: THREE.MeshStandardMaterial | null = null;
  private readonly exhaust: THREE.Sprite | null = null;
  private readonly exhaustLight: THREE.PointLight | null = null;

  private readonly disposables: { dispose(): void }[] = [];
  private readonly spinRateRad: number;       // giro REAL (rad/s) a v0
  private readonly finsDeploy: boolean;
  private readonly lengthM: number;
  private spinAngle = 0;

  constructor(weapon: Weapon) {
    const r = weapon.round;
    const d = r.diameter;

    this.group.add(this.scaler);
    this.scaler.add(this.precess);
    this.precess.add(this.spinner);

    // Giro real del estriado: ω = 2π·v / paso, paso = twist·calibre.
    this.spinRateRad =
      r.spinStabilized && r.twistCalibers > 0
        ? (2 * Math.PI * r.muzzleVelocity) / (r.twistCalibers * d)
        : 0;

    // Esbeltez por familia (calibres de longitud) y forma.
    let length: number;
    let nose: THREE.MeshStandardMaterial | null = null;
    let deploy = false;
    switch (weapon.category) {
      case 'Mortar':
        length = d * 4.6;
        this.buildMortarBomb(d, length);
        break;
      case 'Rocket':
        length = d * 17;
        nose = this.buildRocket(d, length, true);
        deploy = true;
        break;
      case 'Missile':
        length = d * 11;
        nose = this.buildRocket(d, length, false);
        deploy = true;
        break;
      case 'SmallArms':
        length = d * 4.2;
        this.buildBullet(d, length);
        break;
      default:
        length = d * 5.4;
        nose = this.buildShell(d, length);
        break;
    }
    this.lengthM = length;
    this.noseMat = nose;
    this.finsDeploy = deploy;

    // Motor: resplandor de tobera + luz (solo si el arma tiene motor).
    if (r.motor.enabled) {
      this.exhaust = makeGlowSprite(0xffc27a, Math.max(3, d * 26));
      this.exhaust.position.z = -this.lengthM * 0.55;
      this.exhaust.visible = false;
      this.spinner.add(this.exhaust);
      // Luz de tobera: candelas moderadas y alcance corto. Con valores
      // grandes, en cabina o en la sala de armas el cohete blanquea la escena.
      this.exhaustLight = new THREE.PointLight(0xffa04a, 0, Math.max(45, d * 220), 2);
      this.exhaustLight.position.z = -this.lengthM * 0.6;
      this.exhaustLight.visible = false;
      this.spinner.add(this.exhaustLight);
    }

    // Trazador: no gira ni se escala con el cuerpo (es un billboard).
    this.tracer = makeGlowSprite(
      weapon.category === 'SmallArms' ? 0xffd88a : 0xfff1cf, 2,
    );
    this.group.add(this.tracer);
  }

  /** Avanza giro, precesión, aletas, motor y escala de lectura. */
  update(dt: number, s: ProjectileVisualState): void {
    // --- Giro sobre el eje ---------------------------------------------------
    if (this.spinRateRad > 0) {
      // Comprensión logarítmica: proporcional al giro real pero visible.
      // (Sin ella, 220 rev/s a 60 fps es aliasing puro.)
      const visual = clamp(3.2 * Math.log10(1 + this.spinRateRad), 0, 26);
      this.spinAngle = (this.spinAngle + visual * dt) % (Math.PI * 2);
      this.spinner.rotation.z = this.spinAngle;
    }

    // --- Yaw of repose: cabeceo inicial que se amortigua ---------------------
    // Sale del tubo con unos grados de guiñada y la estabilidad giroscópica
    // la reduce con constante de tiempo ~1.2 s, precesando a ~4 Hz.
    const decay = Math.exp(-s.elapsed / 1.2);
    if (decay > 0.01) {
      const amp = (this.spinRateRad > 0 ? 3.2 : 5.5) * Math.PI / 180 * decay;
      const phase = s.elapsed * 25;
      this.precess.rotation.x = amp * Math.sin(phase);
      this.precess.rotation.y = amp * Math.cos(phase) * (this.spinRateRad > 0 ? 1 : 0.3);
    } else if (this.precess.rotation.x !== 0) {
      this.precess.rotation.set(0, 0, 0);
    }

    // --- Aletas: plegadas al salir, abiertas en 0.25 s ------------------------
    if (this.finsDeploy && this.fins.length) {
      const open = clamp(s.elapsed / 0.25, 0, 1);
      const smooth = open * open * (3 - 2 * open); // suavizado sin rebote
      const angle = (1 - smooth) * (80 * Math.PI / 180);
      for (const f of this.fins) f.rotation.x = angle;
    }

    // --- Motor: tobera y luz mientras quema ----------------------------------
    if (this.exhaust && this.exhaustLight) {
      this.exhaust.visible = s.thrusting;
      this.exhaustLight.visible = s.thrusting;
      if (s.thrusting) {
        const flicker = 0.82 + 0.18 * Math.sin(s.elapsed * 63) * Math.cos(s.elapsed * 37);
        this.exhaust.scale.setScalar(Math.max(3, this.lengthM * 1.6) * flicker);
        (this.exhaust.material as THREE.SpriteMaterial).opacity = 0.9 * flicker;
        this.exhaustLight.intensity = 550 * flicker;
      }
    }

    // --- Nariz incandescente por calentamiento aerodinámico ------------------
    if (this.noseMat) {
      const heat = clamp((s.mach - 3.5) / 4.5, 0, 1);
      if (heat > 0) {
        // Rojo cereza -> naranja -> blanco, como una barra de acero al fuego.
        this.noseMat.emissive.setRGB(heat, heat * heat * 0.55, heat * heat * heat * 0.25);
        this.noseMat.emissiveIntensity = 1.6 * heat;
      } else if (this.noseMat.emissiveIntensity !== 0) {
        this.noseMat.emissiveIntensity = 0;
      }
    }

    // --- Escala de lectura ---------------------------------------------------
    // A 250 m se ve a tamaño real; más lejos crece linealmente para no
    // desaparecer. Nunca encoge por debajo de 1 (no se falsea "más pequeño").
    const readScale = clamp(s.camDistance / 250, 1, 45);
    this.scaler.scale.setScalar(readScale);
    this.tracer.scale.setScalar(clamp(s.camDistance * 0.006, 1.2, 42));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.tracer.material.dispose();
    this.exhaust?.material.dispose();
    this.group.removeFromParent();
  }

  // -------------------------------------------------------------------------
  //  Utilidades
  // -------------------------------------------------------------------------
  private mat(
    color: number, metalness: number, roughness: number,
  ): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    this.disposables.push(m);
    return m;
  }

  /** Revolución del perfil [radio, y] con la nariz llevada a +Z. */
  private lathe(profile: [number, number][], mat: THREE.Material, seg = 20): THREE.Mesh {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-5, r), y));
    const geo = new THREE.LatheGeometry(pts, seg);
    geo.rotateX(Math.PI / 2); // eje del lathe (+y) -> eje del proyectil (+z)
    this.disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    this.spinner.add(mesh);
    return mesh;
  }

  /**
   * Perfil de ojiva TANGENTE de radio ρ = (R² + L²)/(2R): el arco que empalma
   * sin quiebro con el cuerpo cilíndrico. Es la forma real de una granada.
   */
  private ogive(radius: number, len: number, y0: number, steps = 9): [number, number][] {
    const rho = (radius * radius + len * len) / (2 * radius);
    const pts: [number, number][] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const y = len * t;
      const r = Math.sqrt(Math.max(0, rho * rho - (len - y) * (len - y))) + radius - rho;
      pts.push([Math.max(0, r), y0 + y]);
    }
    return pts;
  }

  /** Añade n aletas repartidas; devuelve los pivotes para el despliegue. */
  private addFins(opts: {
    count: number; z: number; rootR: number; span: number;
    chord: number; thickness: number; mat: THREE.Material; deployable: boolean;
  }): void {
    for (let i = 0; i < opts.count; i++) {
      const hinge = new THREE.Group();
      hinge.rotation.z = (i / opts.count) * Math.PI * 2;
      const arm = new THREE.Group();       // pivota sobre el eje radial (X)
      arm.position.set(opts.rootR, 0, opts.z);
      const geo = new THREE.BoxGeometry(opts.span, opts.thickness, opts.chord);
      this.disposables.push(geo);
      const blade = new THREE.Mesh(geo, opts.mat);
      blade.position.x = opts.span * 0.5;
      arm.add(blade);
      hinge.add(arm);
      this.spinner.add(hinge);
      if (opts.deployable) this.fins.push(arm);
    }
  }

  // -------------------------------------------------------------------------
  //  Familias
  // -------------------------------------------------------------------------

  /** Granada de artillería: ojiva tangente + banda de cobre + boat tail. */
  private buildShell(d: number, L: number): THREE.MeshStandardMaterial {
    const steel = this.mat(0x4e545b, 0.55, 0.45);
    const noseMat = this.mat(0x3a4148, 0.6, 0.4);
    const copper = this.mat(0xb3722e, 0.9, 0.3);
    const R = d * 0.5;

    // Culote + boat tail + cuerpo cilíndrico hasta el arranque de la ojiva.
    const bodyTop = L * 0.58;
    this.lathe([
      [0, 0], [R * 0.78, 0], [R, L * 0.13], [R, bodyTop],
    ], steel, 22);
    // Ojiva tangente + espoleta, en el material que se calienta.
    this.lathe([
      [R, bodyTop],
      ...this.ogive(R, L * 0.38, bodyTop),
      [R * 0.2, L * 0.985], [R * 0.13, L * 1.02], [0, L * 1.03],
    ], noseMat, 22);

    // Banda de forzamiento: el aro de cobre que muerde el estriado.
    const bandGeo = new THREE.TorusGeometry(R * 1.01, R * 0.075, 6, 22);
    bandGeo.rotateX(Math.PI / 2);
    this.disposables.push(bandGeo);
    const band = new THREE.Mesh(bandGeo, copper);
    band.position.z = L * 0.2;
    this.spinner.add(band);

    return noseMat;
  }

  /** Bomba de mortero: cuerpo lagrimal + vástago + seis aletas fijas. */
  private buildMortarBomb(d: number, L: number): void {
    const body = this.mat(0x3f4a3a, 0.45, 0.55);
    const dark = this.mat(0x24282a, 0.5, 0.5);
    const R = d * 0.5;

    // Lagrimal: máximo espesor al 50% y estrechamiento hacia la ojiva.
    this.lathe([
      [0, 0], [R * 0.28, 0], [R * 0.42, L * 0.1],
      [R * 0.9, L * 0.32], [R, L * 0.52], [R * 0.96, L * 0.66],
      ...this.ogive(R * 0.96, L * 0.3, L * 0.66),
      [R * 0.16, L * 0.99], [0, L * 1.02],
    ], body, 20);
    // Vástago de cola (donde va la carga propulsora).
    this.lathe([
      [0, -L * 0.28], [R * 0.3, -L * 0.28], [R * 0.3, 0],
    ], dark, 14);

    this.addFins({
      count: 6, z: -L * 0.16, rootR: R * 0.28, span: R * 0.55,
      chord: L * 0.2, thickness: d * 0.02, mat: dark, deployable: false,
    });
  }

  /** Cohete/misil: cuerpo esbelto, tobera, aletas plegables y canards. */
  private buildRocket(d: number, L: number, canards: boolean): THREE.MeshStandardMaterial {
    const skin = this.mat(0x8d9285, 0.5, 0.45);
    const noseMat = this.mat(0x6b3025, 0.35, 0.6);
    const dark = this.mat(0x2a2d2f, 0.6, 0.4);
    const R = d * 0.5;
    const noseLen = L * 0.16;
    const bodyTop = L - noseLen;

    // Cuerpo cilíndrico esbelto.
    this.lathe([
      [0, 0], [R * 0.86, 0], [R, L * 0.04], [R, bodyTop],
    ], skin, 22);
    // Ojiva larga: es la que se pone al rojo en la reentrada.
    this.lathe([
      [R, bodyTop], ...this.ogive(R, noseLen, bodyTop),
    ], noseMat, 22);

    // Tobera: campana truncada saliendo del culote.
    this.lathe([
      [R * 0.3, -L * 0.06], [R * 0.62, -L * 0.02], [R * 0.86, 0],
    ], dark, 18);
    // Juntas de sección visibles a lo largo del cuerpo.
    for (const f of [0.3, 0.55]) {
      const geo = new THREE.TorusGeometry(R * 1.02, R * 0.045, 5, 20);
      geo.rotateX(Math.PI / 2);
      this.disposables.push(geo);
      const ring = new THREE.Mesh(geo, dark);
      ring.position.z = L * f;
      this.spinner.add(ring);
    }

    // Cuatro aletas de cola: salen plegadas sobre el cuerpo.
    this.addFins({
      count: 4, z: L * 0.07, rootR: R * 0.95, span: R * 1.5,
      chord: L * 0.14, thickness: d * 0.03, mat: dark, deployable: true,
    });
    if (canards) {
      // Canards de gobierno junto a la ojiva (GMLRS y Excalibur los llevan).
      this.addFins({
        count: 4, z: bodyTop - L * 0.05, rootR: R * 0.95, span: R * 0.85,
        chord: L * 0.07, thickness: d * 0.025, mat: dark, deployable: false,
      });
    }
    return noseMat;
  }

  /** Bala: ojiva spitzer, cuerpo de latón y culote troncocónico. */
  private buildBullet(d: number, L: number): void {
    const jacket = this.mat(0xa8843c, 0.85, 0.28);
    const tip = this.mat(0x6a6f74, 0.7, 0.35);
    const R = d * 0.5;
    const bodyTop = L * 0.42;

    this.lathe([
      [0, 0], [R * 0.82, 0], [R, L * 0.14],   // boat tail
      [R, bodyTop],
      ...this.ogive(R, L * 0.5, bodyTop),
    ], jacket, 18);
    // Puntita gris (núcleo de acero asomando, como el M855).
    this.lathe([
      [R * 0.22, L * 0.92], [R * 0.12, L * 0.98], [0, L],
    ], tip, 12);
  }
}
