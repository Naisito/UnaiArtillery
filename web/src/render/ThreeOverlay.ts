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
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import { GeoFrame } from '../frame';

export class ThreeOverlay {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 1e9);
  /** Raíz en coordenadas ENU de la batería: añade aquí proyectiles y VFX. */
  readonly enuRoot = new THREE.Group();
  /** Postproceso opcional (ver PostFX.maybeAttachBloom). */
  composer?: { render(): void; setSize(w: number, h: number): void };

  private readonly canvas: HTMLCanvasElement;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // P-WEB.5
    this.renderer.toneMappingExposure = 1.0;

    this.camera.matrixAutoUpdate = true;
    this.scene.add(this.enuRoot);
    this.setFrame(frame);

    // Luz ambiente tenue + sol direccional aproximado (el shading fino lo dan
    // los materiales emisivos de los VFX).
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
    sun.position.set(0.4, 0.3, 0.85);
    this.scene.add(sun);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Reancla el grupo ENU (al mover la batería). */
  setFrame(frame: GeoFrame): void {
    this.frame = frame;
    // Rotación ENU->ECEF del marco (traslación aparte, relativa a cámara).
    const m = frame.enuToEcefMatrix;
    const rot = new THREE.Matrix4().set(
      m[0], m[4], m[8], 0,
      m[1], m[5], m[9], 0,
      m[2], m[6], m[10], 0,
      0, 0, 0, 1,
    );
    this.enuRoot.quaternion.setFromRotationMatrix(rot);
  }

  private resize(): void {
    const w = this.viewer.container.clientWidth;
    const h = this.viewer.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  /** Posición de la cámara en ENU (para VFX dependientes de distancia). */
  cameraEnu(): THREE.Vector3 {
    const camEcef = this.viewer.camera.positionWC;
    const enu = this.frame.ecefToEnu(camEcef);
    return new THREE.Vector3(enu.x, enu.y, enu.z);
  }

  /** Sincroniza cámara con Cesium y pinta. Llamar en scene.postRender. */
  render(): void {
    const cam = this.viewer.camera;

    // Orientación: base {right, up, -dir} de Cesium (ECEF) -> cámara Three.
    const d = cam.directionWC, u = cam.upWC, r = cam.rightWC;
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(r.x, r.y, r.z),
      new THREE.Vector3(u.x, u.y, u.z),
      new THREE.Vector3(-d.x, -d.y, -d.z),
    );
    this.camera.quaternion.setFromRotationMatrix(basis);
    this.camera.position.set(0, 0, 0);

    // Proyección: copia directa del frustum de Cesium (column-major ambos).
    const p = cam.frustum.projectionMatrix;
    this.camera.projectionMatrix.fromArray(p as unknown as number[]);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // Traslación relativa a cámara, en doble precisión.
    const o = this.frame.origin;
    const c = cam.positionWC;
    this.enuRoot.position.set(o.x - c.x, o.y - c.y, o.z - c.z);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
