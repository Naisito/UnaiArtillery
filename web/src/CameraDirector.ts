// ============================================================================
//  CameraDirector.ts — Cámaras cinemáticas sobre la cámara de Cesium.
//  [P-WEB.6, + bullet-time (P3.3) y sacudida por yield/distancia (P0.2)]
//
//  Modos:
//    * free    — el usuario maneja Cesium con el ratón; no tocamos nada.
//    * orbital — órbita perezosa alrededor de un foco (batería u objetivo).
//    * follow  — persigue el proyectil con adelanto para hipersónicos.
//                ORBITABLE: arrastrar cambia la perspectiva alrededor del
//                proyectil y la rueda ajusta el zoom (distancia).
//    * drone   — vista cenital de recon sobre la zona de impacto.
//    * cabin   — P-NEXT.1: cámara en la boca del arma, orientada según el
//                azimut/elevación ACTUALES (se mueve en vivo con la rueda del
//                cockpit); al pulsar Fuego ves el fogonazo y el tiro salir.
//    * fps     — 1ª persona: clic captura el ratón (pointer lock), WASD
//                mueve, Espacio/C sube/baja, Shift esprinta, la rueda ajusta
//                la velocidad. Esc suelta el ratón.
//
//  Todo el movimiento (salvo fps, que es directo) es críticamente amortiguado
//  (alpha = 1 - e^(-k dt)): nada corta, todo desliza. El bullet-time baja el
//  timeDilation del proyectil seguido cuando falta <1 s para el impacto y lo
//  restaura después.
// ============================================================================
import * as Cesium from 'cesium';
import { Vec3, WeaponSystem } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ProjectilePresenter } from './ProjectilePresenter';

export type CameraMode = 'free' | 'orbital' | 'follow' | 'drone' | 'cabin' | 'fps';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class CameraDirector {
  mode: CameraMode = 'free';
  orbitRadiusM = 900.0;
  orbitSpeedDegS = 7.0;
  /** Más alto = seguimiento más pegado; más bajo = más flotante. */
  stiffness = 2.6;
  /** Activa la rampa de cámara lenta cerca del impacto. */
  bulletTime = true;
  /** P-NEXT.1 — puntería actual para el modo cabina (lo fija main.ts). */
  aimProvider: (() => { azimuthDeg: number; elevationDeg: number }) | null = null;
  /** P-PRO.1 — boca REAL del tubo (la cabina se monta pegada a ella). */
  muzzleProvider: (() => Vec3) | null = null;

  private tracked: ProjectilePresenter | null = null;
  private focusEnu = new Vec3(0, 0, 0);
  private orbitAngleDeg = 0;
  private smoothedPos: Vec3 | null = null;
  private smoothedAim: Vec3 | null = null;
  private shakeAmp = 0;
  private shakeAge = 0;
  /** P-CAM.3 — patada de FOV al disparar: el encuadre "respira" con el tiro. */
  private fovKick = 0;
  private fovKickAge = 0;
  private baseFovDeg = 0;
  /** Traslación y rotación de sacudida aplicadas: se deshacen cada frame. */
  private shakeApplied: {
    right: Cesium.Cartesian3; up: Cesium.Cartesian3; dir: Cesium.Cartesian3;
    mx: number; my: number; mz: number;
    pitchAxis: Cesium.Cartesian3; pitch: number;
    rollAxis: Cesium.Cartesian3; roll: number;
  } | null = null;

  // -- Seguir orbitable: offsets que controla el usuario ---------------------
  private followZoom = 1.0;      // rueda: multiplica la distancia automática
  private followYawDeg = 0;      // arrastre horizontal: gira alrededor
  private followPitchDeg = 0;    // arrastre vertical: pica/contrapica
  private dragging = false;
  private lastDragX = 0;
  private lastDragY = 0;

  // -- 1ª persona -------------------------------------------------------------
  private fpsPos: Vec3 | null = null;
  private fpsYawDeg = 0;
  private fpsPitchDeg = 0;
  private fpsSpeed = 30; // m/s; la rueda lo ajusta (2..1000)
  private readonly keys = new Set<string>();

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly service: BallisticsService,
  ) {
    this.installInputs();
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.smoothedPos = null; // re-engancha suave desde la posición actual
    this.smoothedAim = null;
    const ssc = this.viewer.scene.screenSpaceCameraController;
    ssc.enableInputs = mode === 'free';
    if (mode === 'fps') {
      this.enterFps();
    } else {
      if (document.pointerLockElement === this.viewer.scene.canvas) document.exitPointerLock();
      this.keys.clear();
    }
    if (mode === 'follow') {
      // Perspectiva por defecto: detrás del proyectil, zoom automático.
      this.followZoom = 1.0;
      this.followYawDeg = 0;
      this.followPitchDeg = 0;
    }
  }

  /** Velocidad de vuelo actual del modo 1ª persona (para el HUD/toasts). */
  get fpsSpeedMS(): number { return this.fpsSpeed; }

  private enterFps(): void {
    // Arranca donde está la cámara ahora mismo, mirando hacia donde miraba.
    const frame = this.service.frame;
    this.fpsPos = frame.ecefToEnu(this.viewer.camera.positionWC);
    const dir = frame.ecefVectorToEnu(this.viewer.camera.directionWC);
    this.fpsYawDeg = (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
    this.fpsPitchDeg = (Math.asin(clamp(dir.z, -1, 1)) * 180) / Math.PI;
  }

  // -- Entrada de usuario (rueda/arrastre en seguir, ratón+teclado en fps) ----
  private installInputs(): void {
    const canvas = this.viewer.scene.canvas as HTMLCanvasElement;

    // Clic en el globo en modo fps: captura el ratón.
    canvas.addEventListener('click', () => {
      if (this.mode === 'fps' && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (ev) => {
      if (this.mode !== 'fps' || document.pointerLockElement !== canvas) return;
      const sens = 0.15; // grados por pixel
      this.fpsYawDeg += ev.movementX * sens;
      this.fpsPitchDeg = clamp(this.fpsPitchDeg - ev.movementY * sens, -89, 89);
    });

    const isTyping = (ev: KeyboardEvent) =>
      ev.target instanceof HTMLInputElement ||
      ev.target instanceof HTMLSelectElement ||
      ev.target instanceof HTMLTextAreaElement;
    window.addEventListener('keydown', (ev) => {
      if (this.mode !== 'fps' || isTyping(ev)) return;
      this.keys.add(ev.code);
      if (ev.code === 'Space') ev.preventDefault(); // que no "pulse" botones
    });
    window.addEventListener('keyup', (ev) => this.keys.delete(ev.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Rueda: zoom del seguimiento / velocidad de vuelo en 1ª persona.
    canvas.addEventListener(
      'wheel',
      (ev) => {
        if (this.mode === 'follow') {
          ev.preventDefault();
          this.followZoom = clamp(this.followZoom * (ev.deltaY > 0 ? 1.12 : 1 / 1.12), 0.15, 10);
        } else if (this.mode === 'fps') {
          ev.preventDefault();
          this.fpsSpeed = clamp(this.fpsSpeed * (ev.deltaY < 0 ? 1.25 : 0.8), 2, 1000);
        }
      },
      { passive: false },
    );

    // Arrastre en modo seguir: orbita alrededor del proyectil.
    canvas.addEventListener('pointerdown', (ev) => {
      if (this.mode !== 'follow' || ev.button !== 0) return;
      this.dragging = true;
      this.lastDragX = ev.clientX;
      this.lastDragY = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.dragging || this.mode !== 'follow') return;
      const dx = ev.clientX - this.lastDragX;
      const dy = ev.clientY - this.lastDragY;
      this.lastDragX = ev.clientX;
      this.lastDragY = ev.clientY;
      this.followYawDeg = (this.followYawDeg + dx * 0.35) % 360;
      this.followPitchDeg = clamp(this.followPitchDeg + dy * 0.25, -70, 62);
    });
    const endDrag = (ev: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  setFocus(enu: Vec3): void { this.focusEnu = enu.clone(); }

  follow(p: ProjectilePresenter): void {
    this.tracked = p;
    this.setMode('follow');
  }

  /** Sacudida de impacto: amp ya llega saturada (0..12). */
  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeAge = 0;
  }

  /**
   * Sacudida física por yield y distancia (P0.2 bien de nacimiento):
   * amplitud ~ yield^(1/3) / distancia, saturada a 12.
   */
  shakeFromImpact(impactEnu: Vec3, warheadTNTeq: number): void {
    const cam = this.service.frame.ecefToEnu(this.viewer.camera.positionWC);
    const dist = Math.max(20, cam.sub(impactEnu).length());
    const amp = Math.min(12, Math.cbrt(warheadTNTeq) * 800.0 / dist);
    this.shake(amp);
  }

  /**
   * P-CAM.3 — culatazo visto por la cámara: sacudida corta y "patada" de FOV
   * (el frustum se abre unos grados y se cierra en ~0.35 s). Solo se nota si
   * estás cerca del arma: a 2 km un cañonazo no mueve la cámara.
   */
  kickFromMuzzle(muzzleEnu: Vec3, energyScale: number): void {
    const cam = this.service.frame.ecefToEnu(this.viewer.camera.positionWC);
    const dist = Math.max(6, cam.sub(muzzleEnu).length());
    const amp = clamp(energyScale * 260 / dist, 0, 7);
    if (amp < 0.05) return;
    this.shake(amp);
    // La patada de FOV solo tiene sentido de cerca (cabina, 1ª persona).
    const f = this.viewer.camera.frustum;
    if (dist < 120 && f instanceof Cesium.PerspectiveFrustum && f.fov) {
      if (this.fovKick <= 0) this.baseFovDeg = Cesium.Math.toDegrees(f.fov);
      this.fovKick = Math.max(this.fovKick, clamp(amp * 0.9, 0, 6));
      this.fovKickAge = 0;
    }
  }

  /** Relaja la patada de FOV hacia el valor base con muelle amortiguado. */
  private tickFovKick(dt: number): void {
    if (this.fovKick <= 0) return;
    this.fovKickAge += dt;
    const f = this.viewer.camera.frustum;
    if (!(f instanceof Cesium.PerspectiveFrustum) || !f.fov) {
      this.fovKick = 0;
      return;
    }
    // Subida en 40 ms, vuelta exponencial en ~0.35 s.
    const a = this.fovKickAge;
    const env = a < 0.04 ? a / 0.04 : Math.exp(-(a - 0.04) / 0.12);
    f.fov = Cesium.Math.toRadians(this.baseFovDeg + this.fovKick * env);
    if (a > 0.6) {
      f.fov = Cesium.Math.toRadians(this.baseFovDeg);
      this.fovKick = 0;
    }
  }

  update(dt: number): void {
    // P-CAM.3 — la sacudida del frame anterior se DESHACE antes de nada: así
    // no se acumula en modo libre (donde nadie reescribe la orientación) y la
    // cámara del usuario queda exactamente donde la dejó.
    this.revertShake();

    // Bullet-time: rampa suave al acercarse el impacto del proyectil seguido.
    if (this.tracked) {
      if (this.tracked.isImpacted) {
        this.tracked.timeDilation = 1.0;
      } else if (this.bulletTime && this.mode === 'follow') {
        const remaining = (1 - this.tracked.flightAlpha) * this.tracked.flight.timeOfFlight;
        const slow = Math.min(1, Math.max(0, (1.2 - remaining) / 1.2));
        this.tracked.timeDilation = 1.0 - 0.85 * slow * slow; // hasta 0.15x
      }
    }

    if (this.mode === 'fps') this.tickFps(dt);
    else if (this.mode !== 'free') this.tickMode(dt);
    this.tickShake(dt);
    this.tickFovKick(dt);
  }

  /** 1ª persona: integración directa (sin amortiguar — respuesta de juego). */
  private tickFps(dt: number): void {
    if (!this.fpsPos) return;
    const yaw = (this.fpsYawDeg * Math.PI) / 180;
    const pitch = (this.fpsPitchDeg * Math.PI) / 180;
    const look = new Vec3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(pitch),
    );
    const right = new Vec3(Math.cos(yaw), -Math.sin(yaw), 0);

    let move = new Vec3(0, 0, 0);
    if (this.keys.has('KeyW')) move = move.add(look);
    if (this.keys.has('KeyS')) move = move.sub(look);
    if (this.keys.has('KeyD')) move = move.add(right);
    if (this.keys.has('KeyA')) move = move.sub(right);
    if (this.keys.has('Space')) move = move.add(new Vec3(0, 0, 1));
    if (this.keys.has('KeyC')) move = move.sub(new Vec3(0, 0, 1));

    if (move.length() > 1e-6) {
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
      this.fpsPos = this.fpsPos.add(move.normalized().mul(this.fpsSpeed * sprint * dt));
    }
    this.applyView(this.fpsPos, this.fpsPos.add(look));
  }

  private tickMode(dt: number): void {
    let desired: Vec3;
    let aim: Vec3;

    switch (this.mode) {
      case 'orbital': {
        this.orbitAngleDeg += this.orbitSpeedDegS * dt;
        const a = (this.orbitAngleDeg * Math.PI) / 180;
        const r = this.orbitRadiusM;
        desired = new Vec3(
          this.focusEnu.x + r * Math.cos(a),
          this.focusEnu.y + r * Math.sin(a),
          this.focusEnu.z + r * 0.35,
        );
        aim = this.focusEnu;
        break;
      }
      case 'follow': {
        if (!this.tracked) return;
        const p = this.tracked.positionEnu();
        const v = this.tracked.velocityEnu();
        const speed = Math.max(1, v.length());
        const dir = v.div(speed);
        // Órbita esférica alrededor del proyectil: por defecto detrás y algo
        // por encima; el usuario la gira arrastrando y la acerca con la rueda.
        const heading = Math.atan2(dir.x, dir.y); // rumbo del proyectil
        const dist = Math.min(500, 90 + speed * 0.35) * this.followZoom;
        const yaw = heading + Math.PI + (this.followYawDeg * Math.PI) / 180;
        const pitch = ((16 + this.followPitchDeg) * Math.PI) / 180;
        desired = new Vec3(
          p.x + Math.sin(yaw) * Math.cos(pitch) * dist,
          p.y + Math.cos(yaw) * Math.cos(pitch) * dist,
          p.z + Math.sin(pitch) * dist,
        );
        aim = p.add(dir.mul(Math.min(250, speed * 0.25))); // encuadra por delante
        break;
      }
      case 'drone': {
        desired = this.focusEnu.add(new Vec3(120, 120, 1600));
        aim = this.focusEnu;
        break;
      }
      case 'cabin': {
        // Vista de ARTILLERO (estilo videojuego): el ojo va detrás de la
        // culata a altura de mira, y la mirada apunta casi al HORIZONTE por
        // el rumbo actual — no a lo largo del tubo (a QE alta solo se veía
        // cielo). El tubo del GunModel sube dentro del encuadre al elevar,
        // como lo ve un tirador real tras el escudo. El HUD de artillero
        // (GunnerHud) pinta compás, goniómetro y minimapa encima.
        const lay = this.aimProvider?.();
        if (!lay) return;
        const azRad = (lay.azimuthDeg * Math.PI) / 180.0;
        const fwd = new Vec3(Math.sin(azRad), Math.cos(azRad), 0);
        // P-CAM.3 — el ojo va DESPLAZADO A LA IZQUIERDA del tubo, en el puesto
        // del apuntador: mirando por el eje del ánima solo se veía el tubo
        // ocupando la pantalla entera. Así el arma queda encuadrada a la
        // derecha y se ve elevarse, retroceder y soltar el fogonazo.
        const left = new Vec3(-Math.cos(azRad), Math.sin(azRad), 0);
        const eye = new Vec3(
          -fwd.x * 6.5 + left.x * 2.2,
          -fwd.y * 6.5 + left.y * 2.2,
          2.9,
        );
        desired = eye;
        // Cabeceo suave: 2º de base + fracción de la QE, tope 14º — el
        // horizonte queda siempre en pantalla y el arco de salida se ve.
        const lookPitchDeg = clamp(2.0 + lay.elevationDeg * 0.18, 2.0, 14.0);
        const look = WeaponSystem.launchVelocity(lay.azimuthDeg, lookPitchDeg, 1.0);
        aim = eye.add(look.mul(400.0));
        break;
      }
      default:
        return;
    }

    // La cabina sigue a la rueda: rigidez extra para que apunte sin flotar.
    const stiff = this.mode === 'cabin' ? this.stiffness * 3.5 : this.stiffness;
    const k = 1 - Math.exp(-stiff * dt);
    if (!this.smoothedPos) this.smoothedPos = this.service.frame.ecefToEnu(this.viewer.camera.positionWC);
    if (!this.smoothedAim) this.smoothedAim = aim.clone();
    this.smoothedPos = this.smoothedPos.add(desired.sub(this.smoothedPos).mul(k));
    this.smoothedAim = this.smoothedAim.add(aim.sub(this.smoothedAim).mul(k));

    this.applyView(this.smoothedPos, this.smoothedAim);
  }

  private applyView(posEnu: Vec3, aimEnu: Vec3): void {
    const frame = this.service.frame;
    const destination = frame.enuToEcef(posEnu);
    const dirEnu = aimEnu.sub(posEnu).normalized();
    const direction = frame.enuVectorToEcef(dirEnu);
    // Up: el up local, ortogonalizado contra la dirección de vista.
    const upEnu = new Vec3(0, 0, 1);
    const proj = upEnu.sub(dirEnu.mul(upEnu.dot(dirEnu)));
    const upSafe = proj.length() > 1e-6 ? proj.normalized() : new Vec3(0, 1, 0);
    const up = frame.enuVectorToEcef(upSafe);

    this.viewer.camera.setView({
      destination,
      orientation: {
        direction: Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3()),
        up: Cesium.Cartesian3.normalize(up, new Cesium.Cartesian3()),
      },
    });
  }

  /**
   * Sacudida: traslación + ROTACIÓN (cabeceo y alabeo). Un impacto cercano no
   * solo mueve la cámara de sitio; le da un tirón angular, que es lo que se
   * lee de verdad en pantalla. Todo se registra para poder deshacerlo.
   */
  private tickShake(dt: number): void {
    if (this.shakeAmp < 0.02) return;
    this.shakeAge += dt;
    // Oscilación pseudo-perlin (senos inconmensurables) amortiguada ~0.7 s.
    const decay = Math.exp(-4.2 * this.shakeAge);
    const a = this.shakeAmp * decay;
    if (a < 0.02) {
      this.shakeAmp = 0;
      return;
    }
    const t = this.shakeAge;
    const nx = Math.sin(t * 71.0) + 0.5 * Math.sin(t * 47.0 + 1.3);
    const ny = Math.sin(t * 63.0 + 2.1) + 0.5 * Math.sin(t * 41.0 + 0.4);
    const nz = Math.sin(t * 53.0 + 4.2);
    const np = Math.sin(t * 83.0 + 1.1) + 0.4 * Math.sin(t * 37.0);
    const nr = Math.sin(t * 67.0 + 3.4);

    const cam = this.viewer.camera;
    // Ejes clonados: son los que se usarán para deshacer en el frame siguiente.
    const right = Cesium.Cartesian3.clone(cam.right, new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.clone(cam.up, new Cesium.Cartesian3());
    const dir = Cesium.Cartesian3.clone(cam.direction, new Cesium.Cartesian3());

    // Hasta ~1.5 m de desplazamiento con amp=12: contundente sin marear.
    const mx = nx * a * 0.12;
    const my = ny * a * 0.12;
    const mz = nz * a * 0.12 * 0.4;
    cam.move(right, mx);
    cam.move(up, my);
    cam.move(dir, mz);

    // Tirón angular: hasta ~0.6º de cabeceo y ~0.35º de alabeo con amp=12.
    const pitch = Cesium.Math.toRadians(np * a * 0.05);
    const roll = Cesium.Math.toRadians(nr * a * 0.03);
    const pitchAxis = Cesium.Cartesian3.clone(cam.right, new Cesium.Cartesian3());
    cam.look(pitchAxis, pitch);
    const rollAxis = Cesium.Cartesian3.clone(cam.direction, new Cesium.Cartesian3());
    cam.look(rollAxis, roll);

    this.shakeApplied = { right, up, dir, mx, my, mz, pitchAxis, pitch, rollAxis, roll };
  }

  /** Deshace exactamente la sacudida del frame anterior (orden inverso). */
  private revertShake(): void {
    const s = this.shakeApplied;
    if (!s) return;
    this.shakeApplied = null;
    const cam = this.viewer.camera;
    cam.look(s.rollAxis, -s.roll);
    cam.look(s.pitchAxis, -s.pitch);
    cam.move(s.dir, -s.mz);
    cam.move(s.up, -s.my);
    cam.move(s.right, -s.mx);
  }
}
