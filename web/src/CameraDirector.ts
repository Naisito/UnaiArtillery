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

//    * op      — P-VIVO.6: puesto de observación FIJO (reto FO): girar con
//                arrastre, zoom de prismáticos con la rueda (FOV), sin
//                desplazamiento. Se entra con enterOp().
export type CameraMode = 'free' | 'orbital' | 'follow' | 'drone' | 'cabin' | 'fps' | 'op';

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

  // -- Puesto de observación (P-VIVO.6) ----------------------------------------
  private opPos: Vec3 | null = null;
  private opYawDeg = 0;
  private opPitchDeg = 0;
  private opSavedFovDeg: number | null = null;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly service: BallisticsService,
  ) {
    this.installInputs();
  }

  setMode(mode: CameraMode): void {
    // P-VIVO.6 — al salir del OP se restauran los prismáticos (FOV).
    if (this.mode === 'op' && mode !== 'op' && this.opSavedFovDeg !== null) {
      const f = this.viewer.camera.frustum;
      if (f instanceof Cesium.PerspectiveFrustum) {
        f.fov = Cesium.Math.toRadians(this.opSavedFovDeg);
      }
      this.opSavedFovDeg = null;
    }
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

  /**
   * P-VIVO.6 — planta la cámara en el puesto de observación: posición FIJA,
   * mirando por `lookAzimuthDeg`; arrastrar gira, la rueda es zoom óptico.
   */
  enterOp(posEnu: Vec3, lookAzimuthDeg: number): void {
    this.opPos = posEnu.clone();
    this.opYawDeg = lookAzimuthDeg;
    this.opPitchDeg = 0;
    const f = this.viewer.camera.frustum;
    this.opSavedFovDeg =
      f instanceof Cesium.PerspectiveFrustum && f.fov ? Cesium.Math.toDegrees(f.fov) : null;
    this.setMode('op');
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

    // Rueda: zoom del seguimiento / velocidad de vuelo en 1ª persona /
    // prismáticos del puesto de observación (P-VIVO.6).
    canvas.addEventListener(
      'wheel',
      (ev) => {
        if (this.mode === 'follow') {
          ev.preventDefault();
          this.followZoom = clamp(this.followZoom * (ev.deltaY > 0 ? 1.12 : 1 / 1.12), 0.15, 10);
        } else if (this.mode === 'fps') {
          ev.preventDefault();
          this.fpsSpeed = clamp(this.fpsSpeed * (ev.deltaY < 0 ? 1.25 : 0.8), 2, 1000);
        } else if (this.mode === 'op') {
          ev.preventDefault();
          const f = this.viewer.camera.frustum;
          if (f instanceof Cesium.PerspectiveFrustum && f.fov) {
            const deg = clamp(
              Cesium.Math.toDegrees(f.fov) * (ev.deltaY > 0 ? 1.15 : 1 / 1.15), 8, 80,
            );
            f.fov = Cesium.Math.toRadians(deg);
          }
        }
      },
      { passive: false },
    );

    // Arrastre: orbita el proyectil (seguir) o gira la cabeza (OP).
    canvas.addEventListener('pointerdown', (ev) => {
      if ((this.mode !== 'follow' && this.mode !== 'op') || ev.button !== 0) return;
      this.dragging = true;
      this.lastDragX = ev.clientX;
      this.lastDragY = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.dragging) return;
      const dx = ev.clientX - this.lastDragX;
      const dy = ev.clientY - this.lastDragY;
      this.lastDragX = ev.clientX;
      this.lastDragY = ev.clientY;
      if (this.mode === 'follow') {
        this.followYawDeg = (this.followYawDeg + dx * 0.35) % 360;
        this.followPitchDeg = clamp(this.followPitchDeg + dy * 0.25, -70, 62);
      } else if (this.mode === 'op') {
        // El observador gira la cabeza: sensibilidad baja con el zoom óptico.
        const f = this.viewer.camera.frustum;
        const zoomK =
          f instanceof Cesium.PerspectiveFrustum && f.fov
            ? Cesium.Math.toDegrees(f.fov) / 60
            : 1;
        this.opYawDeg = (this.opYawDeg + dx * 0.12 * zoomK) % 360;
        this.opPitchDeg = clamp(this.opPitchDeg - dy * 0.1 * zoomK, -40, 45);
      }
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

  update(dt: number): void {
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
      case 'op': {
        // P-VIVO.6 — clavado en el puesto de observación: solo gira la vista.
        if (!this.opPos) return;
        const yaw = (this.opYawDeg * Math.PI) / 180;
        const pitch = (this.opPitchDeg * Math.PI) / 180;
        desired = this.opPos;
        aim = this.opPos.add(new Vec3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.cos(yaw) * Math.cos(pitch),
          Math.sin(pitch),
        ).mul(1000));
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
        const eye = new Vec3(-fwd.x * 7.5, -fwd.y * 7.5, 3.4);
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

    // La cabina y el OP siguen a la mano: rigidez extra para no flotar.
    const stiff =
      this.mode === 'cabin' || this.mode === 'op' ? this.stiffness * 3.5 : this.stiffness;
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
    // Hasta ~1.5 m de desplazamiento con amp=12: contundente sin marear.
    const offset = new Cesium.Cartesian3(nx, ny, nz);
    Cesium.Cartesian3.multiplyByScalar(offset, a * 0.12, offset);
    this.viewer.camera.move(this.viewer.camera.right, offset.x);
    this.viewer.camera.move(this.viewer.camera.up, offset.y);
    this.viewer.camera.move(this.viewer.camera.direction, offset.z * 0.4);
  }
}
