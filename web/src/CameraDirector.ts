// ============================================================================
//  CameraDirector.ts — Cámaras cinemáticas sobre la cámara de Cesium.
//  [P-WEB.6, + bullet-time (P3.3), sacudida por yield/distancia (P0.2) y
//   rediseño V2:MAP: encuadres, vuelos suaves, colisión con el terreno y
//   vista de impacto cinematográfica]
//
//  Modos:
//    * free    — el usuario maneja Cesium con el ratón (colisión con el
//                terreno activada). Los vuelos (ir a batería/objetivo,
//                doble clic, norte arriba, planeamiento, zoom) son suaves.
//    * orbital — órbita perezosa alrededor de un foco (batería u objetivo).
//    * follow  — persigue el proyectil SIN retraso: se suaviza el OFFSET
//                respecto al proyectil (no su posición absoluta), así ni
//                los hipersónicos se escapan ni hay temblor. Arrastrar
//                orbita, la rueda acerca. Al impactar pasa a la VISTA DE
//                IMPACTO: distancia de seguridad según la carga explosiva,
//                ligera picada y órbita lenta alrededor del estallido.
//    * drone   — vista cenital de recon sobre la zona de impacto.
//    * cabin   — P-NEXT.1: cámara de artillero tras la culata, orientada
//                según el azimut/elevación ACTUALES.
//    * fps     — 1ª persona: clic captura el ratón (pointer lock), WASD
//                mueve, Espacio/C sube/baja, Shift esprinta, la rueda ajusta
//                la velocidad. Esc suelta el ratón.
//    * op      — P-VIVO.6: puesto de observación FIJO (reto FO).
//
//  Ninguna cámara del director baja del terreno: cada pose se valida con
//  globe.getHeight (margen por modo). Todo el movimiento (salvo fps) es
//  críticamente amortiguado (alpha = 1 - e^(-k dt)): nada corta, todo desliza.
// ============================================================================
import * as Cesium from 'cesium';
import { Vec3, WeaponSystem } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { ProjectilePresenter } from './ProjectilePresenter';
import {
  FRAMING_OFFSETS_DEG, P3, azimuthDeg, batteryFramingPose, impactOrbitPose, impactViewDistanceM,
  lerp3, smoothAngleDeg, smoothK,
} from './map/cameraMath';
import { mapViewportRect } from './map/dom';

export type CameraMode = 'free' | 'orbital' | 'follow' | 'drone' | 'cabin' | 'fps' | 'op';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const EASE = Cesium.EasingFunction.QUADRATIC_IN_OUT;

/** Margen mínimo sobre el terreno por modo (m). */
const TERRAIN_MARGIN: Record<CameraMode, number> = {
  free: 2, orbital: 25, follow: 6, drone: 60, cabin: 1.2, fps: 1.7, op: 0.5,
};

export class CameraDirector {
  mode: CameraMode = 'free';
  orbitRadiusM = 900.0;
  orbitSpeedDegS = 7.0;
  /** Más alto = seguimiento más pegado; más bajo = más flotante. */
  stiffness = 2.6;
  /** Activa la rampa de cámara lenta cerca del impacto. */
  bulletTime = true;
  /** Activa la vista de impacto cinematográfica al caer el proyectil seguido. */
  impactCinematic = true;
  /** P-NEXT.1 — puntería actual para el modo cabina (lo fija main.ts). */
  aimProvider: (() => { azimuthDeg: number; elevationDeg: number }) | null = null;
  /** P-PRO.1 — boca REAL del tubo (la cabina se monta pegada a ella). */
  muzzleProvider: (() => Vec3) | null = null;
  /** V2 — tamaño (m) del arma vigente para el encuadre de batería. */
  subjectSizeProvider: (() => number) | null = null;
  /** V2 — el modo cambió (p. ej. un vuelo de navegación volvió a 'free'). */
  onModeChanged?: (mode: CameraMode) => void;

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
  // Estado suavizado del seguimiento (offset relativo, sin retraso).
  private fHeadingDeg: number | null = null;
  private fOffset: P3 | null = null;
  private fLead: P3 | null = null;
  // Vista de impacto.
  private impactView: { center: Vec3; dist: number; az: number } | null = null;

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

  private readonly scratchCarto = new Cesium.Cartographic();
  private readonly scratchC3 = new Cesium.Cartesian3();
  /** Turno de vuelo: un vuelo pedido después anula al que esperaba terreno. */
  private flightSeq = 0;
  private guardAcc = 0;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly service: BallisticsService,
  ) {
    // Colisión con el terreno en modo libre y zoom mínimo sensato (se puede
    // rozar el arma, nunca atravesar el suelo).
    const ssc = viewer.scene.screenSpaceCameraController;
    ssc.enableCollisionDetection = true;
    ssc.minimumZoomDistance = 2.0;
    // El doble clic de Cesium "engancha" la cámara a la entidad pulsada
    // (trackedEntity): fuera — MapInteraction vuela suavemente al punto.
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
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
    const changed = mode !== this.mode;
    this.mode = mode;
    this.smoothedPos = null; // re-engancha suave desde la posición actual
    this.smoothedAim = null;
    const ssc = this.viewer.scene.screenSpaceCameraController;
    ssc.enableInputs = mode === 'free';
    if (mode !== 'free') this.viewer.camera.cancelFlight();
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
      this.fHeadingDeg = null;
      this.fOffset = null;
      this.fLead = null;
      this.impactView = null;
    }
    if (changed) this.onModeChanged?.(mode);
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

  /** Posición del puesto de observación vigente (null fuera del modo OP). */
  get opPositionEnu(): Vec3 | null {
    return this.mode === 'op' ? this.opPos : null;
  }

  /** Último OP usado (aunque la cámara ya no esté en él). */
  get lastOpPositionEnu(): Vec3 | null {
    return this.opPos;
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

  /** El presentador va a destruirse (evicción FIFO / mover batería): si la
   *  cámara lo seguía, suéltalo — perseguir un fantasma congela la vista y
   *  retiene su FlightResult entero en memoria. */
  untrack(p: ProjectilePresenter): void {
    if (this.tracked === p) this.tracked = null;
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

  // ---------------------------------------------------------------------------
  //  V2 — Vuelos de navegación (siempre en modo libre, suaves y seguros).
  // ---------------------------------------------------------------------------

  /** Pasa a modo libre si hace falta (los vuelos son del usuario). */
  ensureFree(): void {
    if (this.mode !== 'free') this.setMode('free');
  }

  /**
   * Encuadre de batería por defecto: el arma cerca en primer plano (tercio
   * inferior izquierdo), vista oblicua baja mirando aguas abajo del tiro,
   * para que el arco y la zona de impacto entren en plano.
   */
  async frameBattery(fast = false): Promise<void> {
    this.ensureFree();
    const seq = ++this.flightSeq;
    const lay = this.aimProvider?.() ?? { azimuthDeg: 0, elevationDeg: 0 };
    const size = this.subjectSizeProvider?.() ?? 10;
    const margin = 1.5 + size * 0.2;
    // El ojo va a ras de suelo, detrás del arma: en una ladera el relieve
    // puede quedar por ENCIMA o tapar el arma. Las teselas de destino aún no
    // están cargadas (getHeight no sabe): se muestrea el terreno de verdad
    // en cada oferta de posición (ojo + punto medio hacia el arma) y se
    // elige la que menos obliga a subir; el cabeceo se recalcula para que
    // el arma siga en plano.
    const offers = FRAMING_OFFSETS_DEG.map((o) => batteryFramingPose(lay.azimuthDeg, size, { offsetDeg: o }));
    const pts: Vec3[] = [];
    for (const p of offers) {
      pts.push(new Vec3(p.eye.x, p.eye.y, 0), new Vec3(p.eye.x * 0.5, p.eye.y * 0.5, 0));
    }
    const ground = await this.sampleGroundZ(pts);
    if (seq !== this.flightSeq) return; // otro vuelo pedido entretanto
    let best = 0;
    let bestNeed = Infinity;
    offers.forEach((p, i) => {
      const gEye = ground[2 * i];
      const gMid = ground[2 * i + 1];
      let need = 0;
      if (gEye !== null) need = Math.max(need, gEye + margin - p.eye.z);
      // Línea de visión al arma: el punto medio del rayo, por encima del suelo.
      if (gMid !== null) need = Math.max(need, 2 * (gMid + 1.5) - 0.15 * size - p.eye.z);
      if (need < bestNeed - 3) {
        bestNeed = need;
        best = i;
      }
    });
    const lift = Number.isFinite(bestNeed) ? Math.max(0, bestNeed) : 0;
    const pose = batteryFramingPose(lay.azimuthDeg, size, {
      offsetDeg: FRAMING_OFFSETS_DEG[best],
      eyeZ: offers[best].eye.z + lift,
    });
    // OJO: nada de globe.getHeight aquí — en el destino solo hay teselas de
    // bajo detalle (desde el espacio pueden errar >1 km). Manda el muestreo.
    this.flyToPose(
      new Vec3(pose.eye.x, pose.eye.y, pose.eye.z), new Vec3(pose.aim.x, pose.aim.y, pose.aim.z),
      fast ? 1.3 : 2.6,
    );
  }

  /**
   * z ENU del terreno bajo cada punto (máximo detalle). null si no se pudo
   * (sin terreno, edificios 3D o más de `timeoutMs`).
   */
  private async sampleGroundZ(points: Vec3[], timeoutMs = 1500): Promise<(number | null)[]> {
    const scene = this.viewer.scene;
    const provider = this.viewer.terrainProvider;
    if (!scene.globe.show || provider instanceof Cesium.EllipsoidTerrainProvider) {
      return points.map(() => null);
    }
    const frame = this.service.frame;
    const cartos = points.map((p) => Cesium.Cartographic.fromCartesian(frame.enuToEcef(p)));
    try {
      const sampled = await Promise.race([
        Cesium.sampleTerrainMostDetailed(provider, cartos),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!sampled) return points.map(() => null);
      return sampled.map((c) =>
        Number.isFinite(c.height)
          ? frame.ecefToEnu(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height)).z
          : null,
      );
    } catch {
      return points.map(() => null);
    }
  }

  /** Vuela a un objetivo: oblicua desde el lado de la batería, mirándolo. */
  async frameTarget(targetEnu: Vec3, fast = false): Promise<void> {
    this.ensureFree();
    const seq = ++this.flightSeq;
    const range = Math.hypot(targetEnu.x, targetEnu.y);
    const azBT = range > 1 ? Math.atan2(targetEnu.x, targetEnu.y) : 0;
    const d = clamp(range * 0.1, 650, 3500);
    const a = azBT + Math.PI + (22 * Math.PI) / 180; // desde la batería, algo de lado
    const elev = (33 * Math.PI) / 180;
    let eye = new Vec3(
      targetEnu.x + Math.sin(a) * Math.cos(elev) * d,
      targetEnu.y + Math.cos(a) * Math.cos(elev) * d,
      targetEnu.z + Math.sin(elev) * d,
    );
    const [g] = await this.sampleGroundZ([eye]);
    if (seq !== this.flightSeq) return;
    if (g !== null && eye.z < g + 40) eye = new Vec3(eye.x, eye.y, g + 40);
    this.flyToPose(eye, targetEnu, fast ? 1.2 : 2.2);
  }

  /**
   * Vuela hacia un punto del globo conservando rumbo (doble clic: se acerca
   * con `rangeFactor` < 1; "centrar aquí": rangeFactor = 1).
   */
  flyToPoint(point: Cesium.Cartesian3, rangeFactor = 0.45, duration = 1.0): void {
    this.ensureFree();
    ++this.flightSeq;
    const cam = this.viewer.camera;
    const range = Math.max(60, Cesium.Cartesian3.distance(cam.positionWC, point) * rangeFactor);
    let pitch = cam.pitch;
    if (pitch > -0.2) pitch = -0.6; // casi horizontal: mejor una oblicua de ~35º
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(point, 0), {
      offset: new Cesium.HeadingPitchRange(cam.heading, pitch, range),
      duration,
      easingFunction: EASE,
      complete: () => this.nudgeAboveTerrain(),
    });
  }

  /** Norte arriba, conservando el punto de mira y la inclinación. */
  northUp(): void {
    this.ensureFree();
    const cam = this.viewer.camera;
    const c = this.viewCenter();
    if (c) {
      cam.flyToBoundingSphere(new Cesium.BoundingSphere(c, 0), {
        offset: new Cesium.HeadingPitchRange(0, cam.pitch, Cesium.Cartesian3.distance(cam.positionWC, c)),
        duration: 0.8,
        easingFunction: EASE,
      });
    } else {
      cam.flyTo({
        destination: cam.positionWC.clone(),
        orientation: { heading: 0, pitch: cam.pitch, roll: 0 },
        duration: 0.6,
        easingFunction: EASE,
      });
    }
  }

  /** Vista de planeamiento: cenital sobre el punto de mira. */
  planView(): void {
    this.ensureFree();
    const cam = this.viewer.camera;
    const c = this.viewCenter() ?? this.service.frame.origin;
    const range = Math.max(400, Cesium.Cartesian3.distance(cam.positionWC, c));
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(c, 0), {
      offset: new Cesium.HeadingPitchRange(cam.heading, -Cesium.Math.PI_OVER_TWO + 1e-3, range),
      duration: 1.0,
      easingFunction: EASE,
    });
  }

  /** Zoom proporcional a la distancia (factor < 1 acerca). */
  zoomBy(factor: number): void {
    this.ensureFree();
    const cam = this.viewer.camera;
    const c = this.viewCenter();
    if (c) {
      const range = Math.max(40, Cesium.Cartesian3.distance(cam.positionWC, c) * factor);
      cam.flyToBoundingSphere(new Cesium.BoundingSphere(c, 0), {
        offset: new Cesium.HeadingPitchRange(cam.heading, cam.pitch, range),
        duration: 0.45,
        easingFunction: EASE,
        complete: () => this.nudgeAboveTerrain(),
      });
    } else {
      const h = cam.positionCartographic.height;
      if (factor < 1) cam.zoomIn(h * (1 - factor));
      else cam.zoomOut(h * (factor - 1));
    }
  }

  /** Punto del globo en el centro del área de mapa (entre docks). */
  private viewCenter(): Cesium.Cartesian3 | undefined {
    const scene = this.viewer.scene;
    const r = mapViewportRect();
    const pos = new Cesium.Cartesian2((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    const ray = this.viewer.camera.getPickRay(pos);
    if (scene.globe.show && ray) {
      const p = scene.globe.pick(ray, scene);
      if (p) return p;
    }
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(pos);
      if (Cesium.defined(p)) return p;
    }
    return this.viewer.camera.pickEllipsoid(pos) ?? undefined;
  }

  private flyToPose(eyeEnu: Vec3, aimEnu: Vec3, duration: number): void {
    const frame = this.service.frame;
    const dirEnu = aimEnu.sub(eyeEnu).normalized();
    const upEnu = new Vec3(0, 0, 1);
    const proj = upEnu.sub(dirEnu.mul(upEnu.dot(dirEnu)));
    const upSafe = proj.length() > 1e-6 ? proj.normalized() : new Vec3(0, 1, 0);
    this.viewer.camera.flyTo({
      destination: frame.enuToEcef(eyeEnu),
      orientation: {
        direction: Cesium.Cartesian3.normalize(frame.enuVectorToEcef(dirEnu), new Cesium.Cartesian3()),
        up: Cesium.Cartesian3.normalize(frame.enuVectorToEcef(upSafe), new Cesium.Cartesian3()),
      },
      duration,
      easingFunction: EASE,
      complete: () => this.nudgeAboveTerrain(),
    });
  }

  /**
   * Si la cámara quedó bajo el relieve, súbela. Solo con las teselas de la
   * vista ya cargadas: con teselas gruesas (recién llegados del espacio)
   * getHeight puede errar más de un kilómetro y la "subiría" al cielo.
   */
  private nudgeAboveTerrain(): void {
    if (this.mode !== 'free') return;
    const globe = this.viewer.scene.globe;
    if (!globe.show || !globe.tilesLoaded) return;
    const cam = this.viewer.camera;
    const carto = Cesium.Cartographic.fromCartesian(cam.positionWC, undefined, this.scratchCarto);
    const h = carto ? globe.getHeight(carto) : undefined;
    if (!carto || h === undefined) return;
    const margin = TERRAIN_MARGIN.free;
    if (carto.height - h < margin) {
      cam.setView({
        destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, h + margin),
        orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
      });
    }
  }

  /** Sube `pos` (ENU) lo justo para quedar `margin` m sobre el terreno. */
  private clampToTerrain(pos: Vec3, margin: number): Vec3 {
    const globe = this.viewer.scene.globe;
    if (!globe.show) return pos; // edificios 3D: el globo no está cargado
    const ecef = this.service.frame.enuToEcef(pos, this.scratchC3);
    const carto = Cesium.Cartographic.fromCartesian(ecef, undefined, this.scratchCarto);
    if (!carto) return pos;
    const h = globe.getHeight(carto);
    if (h === undefined) return pos;
    const above = carto.height - h;
    return above >= margin ? pos : new Vec3(pos.x, pos.y, pos.z + (margin - above));
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
    else if (this.mode === 'follow') this.tickFollow(dt);
    else if (this.mode !== 'free') this.tickMode(dt);
    else {
      // Red de seguridad del modo libre (4 Hz): vuelos/setView ajenos a la
      // colisión de Cesium nunca dejan la cámara bajo el relieve.
      this.guardAcc += dt;
      if (this.guardAcc > 0.25) {
        this.guardAcc = 0;
        this.nudgeAboveTerrain();
      }
    }
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
    this.fpsPos = this.clampToTerrain(this.fpsPos, TERRAIN_MARGIN.fps);
    this.applyView(this.fpsPos, this.fpsPos.add(look));
  }

  /**
   * Seguir: cámara = proyectil + OFFSET suavizado (rumbo y offset se
   * amortiguan; la posición del proyectil no) → cero retraso aun a Mach 5
   * y cero temblor. Al impactar, vista de impacto cinematográfica.
   */
  private tickFollow(dt: number): void {
    const t = this.tracked;
    if (!t) return;
    if (t.isImpacted) {
      this.tickImpactView(dt, t);
      return;
    }
    this.impactView = null;
    const p = t.positionEnu();
    const v = t.velocityEnu();
    const speed = Math.max(1, v.length());
    const dir = v.div(speed);
    const horiz = Math.hypot(v.x, v.y);
    // Rumbo del proyectil (con tiro casi vertical se conserva el anterior).
    const headingTarget = horiz > 2 ? (Math.atan2(v.x, v.y) * 180) / Math.PI : (this.fHeadingDeg ?? 0);
    this.fHeadingDeg = this.fHeadingDeg === null
      ? headingTarget
      : smoothAngleDeg(this.fHeadingDeg, headingTarget, smoothK(3.0, dt));
    const dist = Math.min(500, 90 + speed * 0.35) * this.followZoom;
    const yaw = ((this.fHeadingDeg + 180 + this.followYawDeg) * Math.PI) / 180;
    const pitch = ((16 + this.followPitchDeg) * Math.PI) / 180;
    const desired: P3 = {
      x: Math.sin(yaw) * Math.cos(pitch) * dist,
      y: Math.cos(yaw) * Math.cos(pitch) * dist,
      z: Math.sin(pitch) * dist,
    };
    if (!this.fOffset) {
      // Entra desde donde esté la cámara: barrido suave hasta el offset.
      const cam = this.service.frame.ecefToEnu(this.viewer.camera.positionWC);
      this.fOffset = { x: cam.x - p.x, y: cam.y - p.y, z: cam.z - p.z };
    }
    lerp3(this.fOffset, desired, smoothK(this.stiffness * 1.5, dt), this.fOffset);
    const leadDesired: P3 = {
      x: dir.x * Math.min(250, speed * 0.25),
      y: dir.y * Math.min(250, speed * 0.25),
      z: dir.z * Math.min(250, speed * 0.25),
    };
    if (!this.fLead) this.fLead = { ...leadDesired };
    lerp3(this.fLead, leadDesired, smoothK(this.stiffness * 1.5, dt), this.fLead);

    const eye = this.clampToTerrain(
      new Vec3(p.x + this.fOffset.x, p.y + this.fOffset.y, p.z + this.fOffset.z),
      TERRAIN_MARGIN.follow,
    );
    const aim = new Vec3(p.x + this.fLead.x, p.y + this.fLead.y, p.z + this.fLead.z);
    this.smoothedPos = eye;
    this.smoothedAim = aim;
    this.applyView(eye, aim);
  }

  /** Órbita lenta y segura alrededor del estallido del proyectil seguido. */
  private tickImpactView(dt: number, t: ProjectilePresenter): void {
    if (!this.impactCinematic) return;
    const camEnu = this.service.frame.ecefToEnu(this.viewer.camera.positionWC);
    if (!this.impactView) {
      const center = t.positionEnu();
      this.impactView = {
        center,
        dist: impactViewDistanceM(t.flight.warheadTNTeq),
        az: azimuthDeg(center, camEnu), // empieza desde donde ya está la cámara
      };
      this.smoothedPos = camEnu;
      this.smoothedAim = this.smoothedAim ?? center;
    }
    const iv = this.impactView;
    iv.az = (iv.az + 4.0 * dt) % 360; // órbita lenta
    const pose = impactOrbitPose(
      iv.center, iv.az + this.followYawDeg, iv.dist * this.followZoom,
      clamp(14 + this.followPitchDeg * 0.5, 4, 60), 25 + Math.cbrt(Math.max(1, t.flight.warheadTNTeq)) * 6,
    );
    const desired = this.clampToTerrain(new Vec3(pose.eye.x, pose.eye.y, pose.eye.z), 12);
    const aim = new Vec3(pose.aim.x, pose.aim.y, pose.aim.z);
    const k = smoothK(1.4, dt);
    this.smoothedPos = (this.smoothedPos ?? camEnu).add(desired.sub(this.smoothedPos ?? camEnu).mul(k));
    this.smoothedAim = (this.smoothedAim ?? aim).add(aim.sub(this.smoothedAim ?? aim).mul(k));
    this.applyView(this.clampToTerrain(this.smoothedPos, 10), this.smoothedAim);
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
    desired = this.clampToTerrain(desired, TERRAIN_MARGIN[this.mode]);

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

  /** Offset de sacudida aplicado el frame anterior (ejes de cámara). */
  private appliedShake: { x: number; y: number; z: number } | null = null;

  private tickShake(dt: number): void {
    const cam = this.viewer.camera;
    // Deshacer la muestra del frame anterior ANTES de aplicar la nueva: en
    // modo libre nadie reescribe la posición y las muestras se ACUMULABAN
    // (la cámara acababa desplazada metros tras cada impacto cercano). En
    // los demás modos applyView ya machacó la posición: no hay nada que
    // deshacer.
    if (this.appliedShake && this.mode === 'free') {
      cam.move(cam.right, -this.appliedShake.x);
      cam.move(cam.up, -this.appliedShake.y);
      cam.move(cam.direction, -this.appliedShake.z);
    }
    this.appliedShake = null;

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
    cam.move(cam.right, offset.x);
    cam.move(cam.up, offset.y);
    cam.move(cam.direction, offset.z * 0.4);
    this.appliedShake = { x: offset.x, y: offset.y, z: offset.z * 0.4 };
  }
}
