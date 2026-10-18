// ============================================================================
//  SceneLighting.ts — Sol, luna y luz de escena coherentes.  [V2 VFX]
//
//  Una sola fuente de verdad para la iluminación de AMBOS mundos:
//   * Posiciones del sol y la luna (Simon 1994, ICRF→ECEF como hace Cesium
//     internamente) para el instante del reloj de Cesium, en el marco ENU de
//     la batería. Fase lunar = fracción iluminada (1 − cos ψ)/2.
//   * Cesium: scene.light es una DirectionalLight PROPIA. De día apunta como
//     el sol con color dorado al atardecer; de noche (sol < −4°) pasa a ser
//     la LUNA (azulada, intensidad según fase y altura) o, sin luna, un
//     resplandor cenital tenue: el relieve se lee de noche sin parecer de día.
//     La atmósfera sigue al SOL (viewer.ts: dynamicAtmosphereLightingFromSun)
//     y el cielo nocturno queda oscuro.
//   * Three: dirección/color/intensidad de la luz clave, hemisférica
//     (cielo/suelo), color de la calima y densidad de niebla equivalente a la
//     de Cesium (para que el humo lejano se funda con el paisaje igual que el
//     terreno). El overlay lo aplica a sus luces, al entorno PMREM y a los
//     uniforms de las partículas.
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import type { GeoFrame } from '../frame';

const DEG = 180 / Math.PI;

export interface LightingState {
  /** Unitario HACIA el sol / la luna, en ENU. */
  readonly sunEnu: THREE.Vector3;
  readonly moonEnu: THREE.Vector3;
  sunElevationDeg: number;
  moonElevationDeg: number;
  /** Fracción iluminada de la luna (0 nueva … 1 llena). */
  moonIllumination: number;
  /** 0 = pleno día … 1 = noche cerrada. */
  night: number;
  /** Luz clave (sol o luna) HACIA la fuente, en ENU. */
  readonly keyEnu: THREE.Vector3;
  readonly keyColor: THREE.Color;
  keyIntensity: number;
  readonly skyColor: THREE.Color;
  readonly groundColor: THREE.Color;
  ambientIntensity: number;
  /** Color de la bruma/calima a media distancia. */
  readonly hazeColor: THREE.Color;
  /** Densidad de niebla visual (equivalente a la de Cesium, 1/m). */
  fogDensity: number;
  /** Se incrementa cuando cambia apreciablemente (para el PMREM). */
  version: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Color clave del sol según su altura (blanco cálido → dorado → rojizo). */
export function sunColorForElevation(elevDeg: number, out: THREE.Color): THREE.Color {
  // Tres anclas: 0° rojo-anaranjado, 8° dorado, 30° blanco cálido.
  const lo = { r: 1.0, g: 0.46, b: 0.2 };
  const mid = { r: 1.0, g: 0.74, b: 0.48 };
  const hi = { r: 1.0, g: 0.96, b: 0.9 };
  if (elevDeg <= 8) {
    const t = smoothstep(-1, 8, elevDeg);
    return out.setRGB(lo.r + (mid.r - lo.r) * t, lo.g + (mid.g - lo.g) * t, lo.b + (mid.b - lo.b) * t);
  }
  const t = smoothstep(8, 30, elevDeg);
  return out.setRGB(mid.r + (hi.r - mid.r) * t, mid.g + (hi.g - mid.g) * t, mid.b + (hi.b - mid.b) * t);
}

export class SceneLighting {
  readonly state: LightingState = {
    sunEnu: new THREE.Vector3(0.4, 0.3, 0.85).normalize(),
    moonEnu: new THREE.Vector3(0, 0, 1),
    sunElevationDeg: 45,
    moonElevationDeg: -10,
    moonIllumination: 0.5,
    night: 0,
    keyEnu: new THREE.Vector3(0.4, 0.3, 0.85).normalize(),
    keyColor: new THREE.Color(1, 0.96, 0.9),
    keyIntensity: 3,
    skyColor: new THREE.Color(0.62, 0.74, 0.95),
    groundColor: new THREE.Color(0.42, 0.37, 0.3),
    ambientIntensity: 1,
    hazeColor: new THREE.Color(0.7, 0.76, 0.84),
    fogDensity: 2e-5,
    version: 0,
  };

  private readonly cesiumLight: Cesium.DirectionalLight;
  private readonly icrf = new Cesium.Matrix3();
  private readonly sunEcef = new Cesium.Cartesian3();
  private readonly moonEcef = new Cesium.Cartesian3();
  private readonly tmp = new Cesium.Cartesian3();
  private readonly tmpCarto = new Cesium.Cartographic();
  private readonly lightDirEcef = new Cesium.Cartesian3();
  private lastTime = new Cesium.JulianDate(0, 0);
  private lastWall = -1e9;
  private lastKeyElev = 999;
  private lastNight = -1;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private frame: GeoFrame,
  ) {
    this.cesiumLight = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0, 0, -1),
      color: Cesium.Color.WHITE,
      intensity: 2.0,
    });
    viewer.scene.light = this.cesiumLight;
    this.update(true);
    // ANTES de pintar: scene.light de este frame ya orientada.
    viewer.scene.preRender.addEventListener(() => this.update(false));
  }

  setFrame(frame: GeoFrame): void {
    this.frame = frame;
    this.update(true);
  }

  /** Recalcula astros (cada ~1 s de reloj real o si el reloj salta). */
  update(force: boolean): void {
    const time = this.viewer.clock.currentTime;
    const now = performance.now();
    const jumped = Math.abs(Cesium.JulianDate.secondsDifference(time, this.lastTime)) > 20;
    if (!force && !jumped && now - this.lastWall < 1000) {
      this.updateFog(); // la niebla depende de la altura de la cámara: siempre
      return;
    }
    this.lastWall = now;
    Cesium.JulianDate.clone(time, this.lastTime);

    // Sol y luna en ECEF (mismo camino que UniformState de Cesium).
    if (!Cesium.defined(Cesium.Transforms.computeIcrfToFixedMatrix(time, this.icrf))) {
      Cesium.Transforms.computeTemeToPseudoFixedMatrix(time, this.icrf);
    }
    Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time, this.tmp);
    Cesium.Matrix3.multiplyByVector(this.icrf, this.tmp, this.sunEcef);
    Cesium.Cartesian3.normalize(this.sunEcef, this.sunEcef);
    Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, this.tmp);
    Cesium.Matrix3.multiplyByVector(this.icrf, this.tmp, this.moonEcef);
    Cesium.Cartesian3.normalize(this.moonEcef, this.moonEcef);

    const s = this.state;
    this.toEnu(this.sunEcef, s.sunEnu);
    this.toEnu(this.moonEcef, s.moonEnu);
    s.sunElevationDeg = Math.asin(Math.max(-1, Math.min(1, s.sunEnu.z))) * DEG;
    s.moonElevationDeg = Math.asin(Math.max(-1, Math.min(1, s.moonEnu.z))) * DEG;
    const cosPsi = Cesium.Cartesian3.dot(this.sunEcef, this.moonEcef);
    s.moonIllumination = (1 - cosPsi) / 2;

    this.computeLights();
    this.applyCesium();
    this.updateFog();

    if (Math.abs(s.sunElevationDeg - this.lastKeyElev) > 1.5 || Math.abs(s.night - this.lastNight) > 0.05) {
      this.lastKeyElev = s.sunElevationDeg;
      this.lastNight = s.night;
      s.version++;
    }
  }

  private toEnu(ecef: Cesium.Cartesian3, out: THREE.Vector3): void {
    const r = Cesium.Matrix4.multiplyByPointAsVector(this.frame.ecefToEnuMatrix, ecef, this.tmp);
    out.set(r.x, r.y, r.z).normalize();
  }

  /** Luz clave + ambiente a partir de las alturas del sol y la luna. */
  private computeLights(): void {
    const s = this.state;
    const e = s.sunElevationDeg;
    // Día pleno por encima de ~6°, noche cerrada por debajo de −8°.
    s.night = 1 - smoothstep(-8, 6, e);
    const day = 1 - s.night;

    if (e > -4) {
      // Sol: dorado al atardecer, se apaga al cruzar el horizonte.
      sunColorForElevation(e, s.keyColor);
      s.keyEnu.copy(s.sunEnu);
      if (s.keyEnu.z < 0.02) s.keyEnu.z = 0.02; // rasante, nunca desde abajo
      s.keyEnu.normalize();
      s.keyIntensity = 3.0 * smoothstep(-4, 12, e) + 0.05;
    } else {
      // Luna (o resplandor cenital si no hay luna sobre el horizonte).
      const moonUp = smoothstep(-2, 6, s.moonElevationDeg);
      const phase = 0.25 + 0.75 * s.moonIllumination;
      s.keyColor.setRGB(0.6, 0.7, 1.0);
      if (moonUp > 0.01) {
        s.keyEnu.copy(s.moonEnu);
        if (s.keyEnu.z < 0.05) s.keyEnu.z = 0.05;
        s.keyEnu.normalize();
      } else {
        s.keyEnu.set(0.15, 0.1, 1).normalize();
      }
      s.keyIntensity = 0.12 + 0.55 * moonUp * phase;
    }

    // Cielo/suelo del ambiente: azul de día, violáceo al ocaso, azul noche.
    const dusk = smoothstep(-6, 2, e) * (1 - smoothstep(4, 16, e));
    s.skyColor.setRGB(
      0.1 + 0.52 * day + 0.25 * dusk,
      0.13 + 0.61 * day + 0.08 * dusk,
      0.24 + 0.71 * day - 0.05 * dusk,
    );
    s.groundColor.setRGB(0.05 + 0.37 * day, 0.05 + 0.32 * day, 0.06 + 0.24 * day);
    s.ambientIntensity = 0.32 + 0.68 * day;

    // Calima: blanco-azulada de día, anaranjada al ocaso, casi negra de noche.
    s.hazeColor.setRGB(
      0.06 + 0.66 * day + 0.3 * dusk,
      0.07 + 0.72 * day + 0.12 * dusk,
      0.1 + 0.78 * day - 0.08 * dusk,
    );
  }

  /** Orienta y tiñe la DirectionalLight de Cesium (globo, modelos, sombras). */
  private applyCesium(): void {
    const s = this.state;
    // Dirección de propagación (desde la fuente hacia la escena) en ECEF.
    const k = s.keyEnu;
    const v = Cesium.Matrix4.multiplyByPointAsVector(
      this.frame.enuToEcefMatrix, Cesium.Cartesian3.fromElements(-k.x, -k.y, -k.z, this.tmp), this.lightDirEcef,
    );
    Cesium.Cartesian3.normalize(v, this.cesiumLight.direction);
    const c = this.cesiumLight.color;
    if (s.sunElevationDeg > -4) {
      c.red = s.keyColor.r;
      c.green = s.keyColor.g;
      c.blue = s.keyColor.b;
      // Cesium normaliza color×intensidad a 1 para el globo: por debajo de
      // 1 atenúa (crepúsculo), por encima solo sirve a los modelos PBR (HDR).
      this.cesiumLight.intensity = 0.35 + 1.65 * smoothstep(-4, 10, s.sunElevationDeg);
    } else {
      c.red = 0.55;
      c.green = 0.64;
      c.blue = 0.92;
      this.cesiumLight.intensity = 0.32 + 0.4 * (s.keyIntensity - 0.12) / 0.55;
    }
    this.viewer.scene.requestRender();
  }

  /** Densidad de niebla visual equivalente a la de Cesium (Fog.update). */
  private updateFog(): void {
    const fog = this.viewer.scene.fog;
    const carto = Cesium.Cartographic.fromCartesian(this.viewer.camera.positionWC, undefined, this.tmpCarto);
    const height = carto ? carto.height : 1000;
    const f = fog as unknown as { heightFalloff?: number };
    const falloff = f.heightFalloff ?? 0.59;
    const t = Math.max(height / fog.maxHeight, Cesium.Math.EPSILON4);
    const density = fog.density * fog.heightScalar * Math.pow(t, -falloff);
    this.state.fogDensity = fog.enabled ? density * fog.visualDensityScalar : 0;
  }

  /** Dirección de la luz de Cesium en ECEF (para depuración). */
  get cesiumLightDirection(): Cesium.Cartesian3 {
    return this.cesiumLight.direction;
  }
}
