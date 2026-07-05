// ============================================================================
//  CameraDirector.ts — Cámaras cinemáticas sobre la cámara de Cesium.
//  [P-WEB.6, + bullet-time (P3.3) y sacudida por yield/distancia (P0.2)]
//
//  Modos:
//    * free    — el usuario maneja Cesium con el ratón; no tocamos nada.
//    * orbital — órbita perezosa alrededor de un foco (batería u objetivo).
//    * follow  — persigue el proyectil con adelanto para hipersónicos.
//    * drone   — vista cenital de recon sobre la zona de impacto.
//
//  Todo el movimiento es críticamente amortiguado (alpha = 1 - e^(-k dt)):
//  nada corta, todo desliza. El bullet-time baja el timeDilation del
//  proyectil seguido cuando falta <1 s para el impacto y lo restaura después.
// ============================================================================
import * as Cesium from 'cesium';
import { Vec3 } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ProjectilePresenter } from './ProjectilePresenter';

export type CameraMode = 'free' | 'orbital' | 'follow' | 'drone';

export class CameraDirector {
  mode: CameraMode = 'free';
  orbitRadiusM = 900.0;
  orbitSpeedDegS = 7.0;
  /** Más alto = seguimiento más pegado; más bajo = más flotante. */
  stiffness = 2.6;
  /** Activa la rampa de cámara lenta cerca del impacto. */
  bulletTime = true;

  private tracked: ProjectilePresenter | null = null;
  private focusEnu = new Vec3(0, 0, 0);
  private orbitAngleDeg = 0;
  private smoothedPos: Vec3 | null = null;
  private smoothedAim: Vec3 | null = null;
  private shakeAmp = 0;
  private shakeAge = 0;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly service: BallisticsService,
  ) {}

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.smoothedPos = null; // re-engancha suave desde la posición actual
    this.smoothedAim = null;
    const ssc = this.viewer.scene.screenSpaceCameraController;
    ssc.enableInputs = mode === 'free';
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

    if (this.mode !== 'free') this.tickMode(dt);
    this.tickShake(dt);
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
        const lead = Math.min(500, 90 + speed * 0.35);
        desired = p.sub(dir.mul(lead)).add(new Vec3(0, 0, 40 + lead * 0.3));
        aim = p.add(dir.mul(speed * 0.4)); // encuadra por delante
        break;
      }
      case 'drone': {
        desired = this.focusEnu.add(new Vec3(120, 120, 1600));
        aim = this.focusEnu;
        break;
      }
      default:
        return;
    }

    const k = 1 - Math.exp(-this.stiffness * dt);
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
