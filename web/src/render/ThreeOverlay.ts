// ============================================================================
//  ThreeOverlay.ts — Escena Three.js superpuesta al globo Cesium.  [P-WEB.3]
//
//  Patrón: dos contextos WebGL apilados. Cesium pinta el mundo; Three pinta
//  proyectiles y VFX en un canvas transparente encima, compartiendo cámara.
//
//  Precisión: las coordenadas ECEF (~6.4e6 m) desbordan float32 en la GPU.
//  Se usa render RELATIVO A CÁMARA: la cámara Three vive en el origen con la
//  orientación ECEF de la de Cesium, y un grupo raíz orientado al marco ENU
//  de la batería se recoloca cada frame en (batería - cámara), calculado en
//  float64 de JS. Dentro del grupo todo trabaja en metros ENU locales, donde
//  float32 sobra (0.04 m de resolución a 300 km).
//
//  V2 VFX:
//   * Luz = la de Cesium: SceneLighting calcula sol/luna para el reloj de
//     Cesium; aquí se aplican a la DirectionalLight clave, la hemisférica y
//     un entorno PMREM procedural (cielo/horizonte/suelo + disco solar) para
//     reflejos PBR plausibles en los proyectiles. La noche se ve de noche.
//   * Oclusión tras el relieve: DepthOcclusion (profundidad de Cesium
//     reducida en GPU y leída en asíncrono) → los ganchos de render
//     (partículas, proyectiles, cráteres) atenúan lo que queda detrás.
//   * Frame-time: cero asignaciones por frame (matrices/vectores de trabajo
//     reutilizados), luces dinámicas en un POOL fijo (añadir/quitar luces
//     recompila todos los materiales: tirón garantizado con cada fogonazo),
//     y si no hay nada visible el overlay se limpia UNA vez y deja de pintar.
//   * Pixel ratio fijado por render/quality.ts (setPixelRatio).
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import { GeoFrame } from '../frame';
import type { QualityOverlayTarget } from './quality';
import { getQualityProfile } from './quality';
import { DepthOcclusion, type CameraSnapshotEnu } from './DepthOcclusion';
import { SceneLighting } from './SceneLighting';
import type { DynLight, RenderCtx } from '../vfx/particles';

/** Algo que se prepara (y quizá pinta) cada frame del overlay. */
export interface RenderHook {
  /** Devuelve true si tiene contenido visible este frame. */
  prepare(ctx: RenderCtx): boolean;
  /** Luces dinámicas que aporta (opcional). */
  collectLights?(out: DynLight[]): void;
}

let activeOverlay: ThreeOverlay | null = null;
/** El overlay vivo (hay uno por app): los VFX se registran solos en él. */
export function getActiveOverlay(): ThreeOverlay | null {
  return activeOverlay;
}

const MAX_POINT_LIGHTS = 2;

export class ThreeOverlay implements QualityOverlayTarget {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 1e9);
  /** Raíz en coordenadas ENU de la batería: añade aquí proyectiles y VFX. */
  readonly enuRoot = new THREE.Group();
  /** Postproceso opcional (ver PostFX.maybeAttachBloom). */
  composer?: { render(): void; setSize(w: number, h: number): void };

  /** Sol/luna/ambiente compartidos con Cesium. */
  readonly lighting: SceneLighting;
  /** Oclusión contra la profundidad de Cesium. */
  readonly occlusion: DepthOcclusion;
  readonly keyLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;

  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: RenderHook[] = [];
  private readonly pointLights: THREE.PointLight[] = [];
  private readonly dynLights: DynLight[] = [];
  private pixelRatio = 1;

  // --- trabajo reutilizado (cero asignaciones por frame) ---
  private readonly basis = new THREE.Matrix4();
  private readonly vR = new THREE.Vector3();
  private readonly vU = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly camEnuV = new THREE.Vector3();
  private readonly camDirEnuV = new THREE.Vector3();
  private readonly viewFromEnu = new THREE.Matrix4();
  private readonly tmpC3 = new Cesium.Cartesian3();
  private readonly tmpV = new THREE.Vector3();
  private readonly snap: CameraSnapshotEnu = {
    cx: 0, cy: 0, cz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 0, uz: 1, fx: 0, fy: 1, fz: 0,
    m0: 1, m4: 0, m8: 0, m12: 0, m1: 0, m5: 1, m9: 0, m13: 0,
  };
  private readonly ctx: RenderCtx;

  // --- estado de frames ---
  private frameIndex = 0;
  private lastRenderT = 0;
  private renderedLastFrame = false;
  /** Frames en los que no se pintó nada (overlay limpio y en reposo). */
  skippedFrames = 0;

  // --- entorno PMREM ---
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene: THREE.Scene | null = null;
  private envMat: THREE.ShaderMaterial | null = null;
  private envSky: THREE.Mesh | null = null;
  private envVersion = -1;
  private envLastBuild = -1e9;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private frame: GeoFrame,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'three-overlay';
    this.viewer.container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // P-WEB.5
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 0);

    this.camera.matrixAutoUpdate = true;
    this.scene.add(this.enuRoot);

    // Luces: clave (sol/luna) + hemisférica; orientadas cada frame.
    this.keyLight = new THREE.DirectionalLight(0xfff2dd, 3.0);
    this.hemiLight = new THREE.HemisphereLight(0x9fbce8, 0x5a4e40, 1.0);
    this.scene.add(this.keyLight, this.keyLight.target, this.hemiLight);
    // Pool FIJO de luces puntuales (fogonazos/explosiones/bengalas): siempre
    // presentes (intensidad 0 si no hay fuente) → nunca se recompilan los
    // materiales al disparar.
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const pl = new THREE.PointLight(0xffb060, 0, 100, 2);
      this.pointLights.push(pl);
      this.enuRoot.add(pl);
    }

    this.lighting = new SceneLighting(viewer, frame);
    this.occlusion = new DepthOcclusion(viewer);
    this.ctx = {
      camEnu: this.camEnuV,
      camDirEnu: this.camDirEnuV,
      viewFromEnu: this.viewFromEnu,
      occlusion: this.occlusion,
      occlusionFresh: false,
      lighting: this.lighting.state,
      dt: 0,
      lights: this.dynLights,
    };

    this.setFrame(frame);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    activeOverlay = this;
  }

  /** Reancla el grupo ENU (al mover la batería). */
  setFrame(frame: GeoFrame): void {
    this.frame = frame;
    // Rotación ENU->ECEF del marco (traslación aparte, relativa a cámara).
    const m = frame.enuToEcefMatrix;
    this.basis.set(
      m[0], m[4], m[8], 0,
      m[1], m[5], m[9], 0,
      m[2], m[6], m[10], 0,
      0, 0, 0, 1,
    );
    this.enuRoot.quaternion.setFromRotationMatrix(this.basis);
    this.lighting?.setFrame(frame);
    this.envVersion = -1; // el "arriba" del entorno cambia con el marco
  }

  /** Pixel ratio del overlay (lo fija quality.ts por nivel/adaptativo). */
  setPixelRatio(pr: number): void {
    const v = Math.max(0.5, Math.min(3, pr));
    if (Math.abs(v - this.pixelRatio) < 1e-3) return;
    this.pixelRatio = v;
    this.renderer.setPixelRatio(v);
    this.resize();
  }

  /** Registra un gancho de render (partículas, proyectiles, cráteres…). */
  addRenderHook(h: RenderHook): void {
    if (!this.hooks.includes(h)) this.hooks.push(h);
  }

  removeRenderHook(h: RenderHook): void {
    const i = this.hooks.indexOf(h);
    if (i >= 0) this.hooks.splice(i, 1);
  }

  private resize(): void {
    const w = this.viewer.container.clientWidth;
    const h = this.viewer.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  /**
   * Posición de la cámara en ENU (para VFX dependientes de distancia).
   * Con `out` no asigna nada; sin él devuelve un vector nuevo (API antigua).
   */
  cameraEnu(out?: THREE.Vector3): THREE.Vector3 {
    const r = Cesium.Matrix4.multiplyByPoint(
      this.frame.ecefToEnuMatrix, this.viewer.camera.positionWC, this.tmpC3,
    );
    return (out ?? new THREE.Vector3()).set(r.x, r.y, r.z);
  }

  /** Cámara ENU del último frame pintado (solo lectura; no guardar). */
  get cameraEnuShared(): THREE.Vector3 {
    return this.camEnuV;
  }

  /** Sincroniza la cámara Three con la de Cesium (y la instantánea ENU). */
  private syncCamera(): void {
    const cam = this.viewer.camera;

    // Orientación: base {right, up, -dir} de Cesium (ECEF) -> cámara Three.
    const d = cam.directionWC, u = cam.upWC, r = cam.rightWC;
    this.basis.makeBasis(
      this.vR.set(r.x, r.y, r.z),
      this.vU.set(u.x, u.y, u.z),
      this.vB.set(-d.x, -d.y, -d.z),
    );
    this.camera.quaternion.setFromRotationMatrix(this.basis);
    this.camera.position.set(0, 0, 0);

    // Proyección: copia directa del frustum de Cesium (column-major ambos).
    const p = cam.frustum.projectionMatrix as unknown as ArrayLike<number>;
    const e = this.camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) e[i] = p[i];
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // Traslación relativa a cámara, en doble precisión.
    const o = this.frame.origin;
    const c = cam.positionWC;
    this.enuRoot.position.set(o.x - c.x, o.y - c.y, o.z - c.z);

    // Instantánea ENU (cámara + base + proyección) para la oclusión/partículas.
    const em = this.frame.ecefToEnuMatrix;
    const pe = Cesium.Matrix4.multiplyByPoint(em, c, this.tmpC3);
    this.camEnuV.set(pe.x, pe.y, pe.z);
    const s = this.snap;
    s.cx = pe.x; s.cy = pe.y; s.cz = pe.z;
    let v = Cesium.Matrix4.multiplyByPointAsVector(em, r, this.tmpC3);
    s.rx = v.x; s.ry = v.y; s.rz = v.z;
    v = Cesium.Matrix4.multiplyByPointAsVector(em, u, this.tmpC3);
    s.ux = v.x; s.uy = v.y; s.uz = v.z;
    v = Cesium.Matrix4.multiplyByPointAsVector(em, d, this.tmpC3);
    s.fx = v.x; s.fy = v.y; s.fz = v.z;
    this.camDirEnuV.set(v.x, v.y, v.z);
    s.m0 = p[0]; s.m4 = p[4]; s.m8 = p[8]; s.m12 = p[12];
    s.m1 = p[1]; s.m5 = p[5]; s.m9 = p[9]; s.m13 = p[13];

    this.enuRoot.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.viewFromEnu.multiplyMatrices(this.camera.matrixWorldInverse, this.enuRoot.matrixWorld);
  }

  /** Luz clave/hemisférica/entorno desde SceneLighting. */
  private applyLighting(): void {
    const L = this.lighting.state;
    // Dirección clave: ENU → mundo (orientación ECEF del grupo).
    this.tmpV.copy(L.keyEnu).applyQuaternion(this.enuRoot.quaternion);
    this.keyLight.position.copy(this.tmpV).multiplyScalar(1000);
    this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.color.copy(L.keyColor);
    this.keyLight.intensity = L.keyIntensity;
    this.hemiLight.color.copy(L.skyColor);
    this.hemiLight.groundColor.copy(L.groundColor);
    this.hemiLight.intensity = L.ambientIntensity;
    this.tmpV.set(0, 0, 1).applyQuaternion(this.enuRoot.quaternion);
    this.hemiLight.position.copy(this.tmpV);

    // Entorno PMREM: se regenera al cambiar el sol de forma apreciable
    // (como mucho cada 2 s: el PMREM cuesta unos ms de GPU).
    const now = performance.now();
    if (L.version !== this.envVersion && now - this.envLastBuild > 2000) {
      this.envVersion = L.version;
      this.envLastBuild = now;
      this.buildEnvironment();
    }
  }

  /** Cielo procedural → PMREM (reflejos plausibles sin texturas). */
  private buildEnvironment(): void {
    const L = this.lighting.state;
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envScene = new THREE.Scene();
      this.envMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uGround: { value: new THREE.Color() },
          uSun: { value: new THREE.Vector3(0, 0, 1) },
          uSunCol: { value: new THREE.Color() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
          uniform vec3 uSun; uniform vec3 uSunCol;
          varying vec3 vDir;
          void main() {
            float h = vDir.z;
            vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
            vec3 col = h >= 0.0 ? sky : mix(uHorizon * 0.6, uGround, clamp(-h * 4.0, 0.0, 1.0));
            float sd = max(dot(vDir, uSun), 0.0);
            col += uSunCol * (pow(sd, 900.0) * 40.0 + pow(sd, 12.0) * 0.6);
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      // La esfera se orienta con el marco ENU: el "arriba" del cielo es la
      // vertical de la batería en el mundo (ECEF) de Three.
      this.envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.envMat);
      this.envScene.add(this.envSky);
    }
    const u = this.envMat!.uniforms;
    const day = 1 - L.night;
    (u.uZenith.value as THREE.Color).setRGB(0.12 + 0.18 * day, 0.16 + 0.32 * day, 0.28 + 0.62 * day).multiplyScalar(0.25 + 0.75 * day);
    (u.uHorizon.value as THREE.Color).copy(L.hazeColor).multiplyScalar(0.3 + 0.9 * day);
    (u.uGround.value as THREE.Color).copy(L.groundColor).multiplyScalar(0.5 + 0.5 * day);
    (u.uSun.value as THREE.Vector3).copy(L.keyEnu);
    (u.uSunCol.value as THREE.Color).copy(L.keyColor).multiplyScalar(L.keyIntensity / 3);
    this.envSky!.quaternion.copy(this.enuRoot.quaternion);
    const rt = this.pmrem.fromScene(this.envScene!, 0, 0.1, 100);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  /** Reparte las luces dinámicas más fuertes entre el pool fijo. */
  private assignPointLights(): void {
    const lights = this.dynLights;
    // Orden por intensidad aparente (intensidad / distancia²), sin asignar.
    const cx = this.camEnuV.x, cy = this.camEnuV.y, cz = this.camEnuV.z;
    for (let i = 1; i < lights.length; i++) {
      const li = lights[i];
      const wi = li.intensity / (1 + ((li.x - cx) ** 2 + (li.y - cy) ** 2 + (li.z - cz) ** 2) * 1e-6);
      let j = i - 1;
      while (j >= 0) {
        const lj = lights[j];
        const wj = lj.intensity / (1 + ((lj.x - cx) ** 2 + (lj.y - cy) ** 2 + (lj.z - cz) ** 2) * 1e-6);
        if (wj >= wi) break;
        lights[j + 1] = lj;
        j--;
      }
      lights[j + 1] = li;
    }
    for (let i = 0; i < this.pointLights.length; i++) {
      const pl = this.pointLights[i];
      const l = lights[i];
      if (l) {
        pl.position.set(l.x, l.y, l.z);
        pl.color.setRGB(l.r, l.g, l.b);
        // Unidades físicas de Three (candelas): un fogonazo de varios m.
        pl.intensity = l.intensity * l.radius * l.radius * 0.5;
        pl.distance = l.radius * 2.5;
      } else {
        pl.intensity = 0;
      }
    }
  }

  /** ¿Hay algo visible en el grupo ENU (aparte de luces)? */
  private enuHasVisibleContent(): boolean {
    const ch = this.enuRoot.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (!o.visible || (o as THREE.Light).isLight) continue;
      if ((o as THREE.InstancedMesh).isInstancedMesh) {
        if ((o as THREE.InstancedMesh).count > 0) return true;
        continue;
      }
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) {
        // Las mallas de partículas se ocultan solas cuando están vacías.
        return true;
      }
      if (o.children.length > 0) return true;
    }
    return false;
  }

  /** Sincroniza cámara con Cesium y pinta. Llamar en scene.postRender. */
  render(): void {
    const now = performance.now();
    const dt = this.lastRenderT > 0 ? Math.min(0.1, (now - this.lastRenderT) / 1000) : 0.016;
    this.lastRenderT = now;
    this.frameIndex++;

    this.syncCamera();

    // Oclusión: datos frescos si llegaron; nueva lectura cada N frames si
    // hay contenido que probar (hooks registrados con algo vivo).
    const every = getQualityProfile().occlusionEveryNFrames;
    const wantOcc = this.hooks.length > 0 && this.renderedLastFrame;
    this.ctx.occlusionFresh = this.occlusion.update(this.snap, wantOcc && this.frameIndex % every === 0);
    this.ctx.dt = dt;

    this.dynLights.length = 0;
    let visible = false;
    for (let i = 0; i < this.hooks.length; i++) {
      const h = this.hooks[i];
      h.collectLights?.(this.dynLights);
    }
    // Las luces se ordenan antes de preparar (el humo usa las 4 primeras).
    this.assignPointLights();
    for (let i = 0; i < this.hooks.length; i++) {
      if (this.hooks[i].prepare(this.ctx)) visible = true;
    }
    if (!visible) visible = this.enuHasVisibleContent();

    if (!visible) {
      // Nada que pintar: limpia UNA vez (el canvas conservaría el último
      // frame) y deja el overlay en reposo.
      if (this.renderedLastFrame) {
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
        this.renderedLastFrame = false;
      }
      this.skippedFrames++;
      return;
    }

    this.applyLighting();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.renderedLastFrame = true;
  }

  /** Luces dinámicas del frame (las usa el humo; ordenadas por fuerza). */
  get frameLights(): readonly DynLight[] {
    return this.dynLights;
  }
}
