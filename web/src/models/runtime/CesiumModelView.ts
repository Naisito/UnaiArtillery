// ============================================================================
//  CesiumModelView.ts — Un GLB horneado pintado por Cesium (Cesium.Model):
//  iluminación solar real, sombras sobre el terreno, oclusión con el relieve
//  y precisión de doble (RTC) sin trucos.  [V2 — 3D-CORE]
//
//  * modelMatrix = marco ENU de la batería (GeoFrame.enuToEcefMatrix) × pose
//    local ENU opcional (camión que avanza, cabeceo/alabeo del terreno).
//  * Articulación: cada frame se escriben las matrices locales de los nodos
//    animados en model.getNode(name).matrix — SOLO las que cambiaron.
//  * Visibilidad por nodo (atrezo) con ModelNode.show.
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import type { GeoFrame } from '../../frame';

export interface CesiumModelViewOptions {
  viewer: Cesium.Viewer;
  url: string;
  /** Nombres de nodo que se articularán (se resuelven al estar listo). */
  nodeNames: string[];
  shadows?: boolean;
  /** Color multiplicador (alfa < 1 → translúcido, p. ej. el fantasma). */
  color?: Cesium.Color;
}

export class CesiumModelView {
  readonly ready: Promise<void>;
  private model: Cesium.Model | null = null;
  private disposed = false;
  private readonly nodes = new Map<string, Cesium.ModelNode>();
  private readonly lastMats = new Map<string, Float64Array>();
  private readonly scratch = new Cesium.Matrix4();
  private readonly enu = new Cesium.Matrix4();
  private readonly pose = new Cesium.Matrix4();
  private readonly modelMatrix = new Cesium.Matrix4();
  private frame: GeoFrame | null = null;
  private poseDirty = true;
  private pendingShow = new Map<string, boolean>();
  private visible = false;

  constructor(private readonly opts: CesiumModelViewOptions) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const model = await Cesium.Model.fromGltfAsync({
      url: this.opts.url,
      upAxis: Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.X,
      shadows: this.opts.shadows === false ? Cesium.ShadowMode.DISABLED : Cesium.ShadowMode.ENABLED,
      incrementallyLoadTextures: false,
      allowPicking: false,
      color: this.opts.color,
      colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
      show: false,
    });
    if (this.disposed) {
      model.destroy();
      return;
    }
    this.model = model;
    this.applyModelMatrix();
    this.opts.viewer.scene.primitives.add(model);
    await new Promise<void>((resolve, reject) => {
      if (model.ready) { resolve(); return; }
      const off = model.readyEvent.addEventListener(() => { off(); offErr(); resolve(); });
      const offErr = model.errorEvent.addEventListener((e: unknown) => { off(); offErr(); reject(e); });
    });
    if (this.disposed) return;
    for (const name of this.opts.nodeNames) {
      const n = model.getNode(name);
      if (n) this.nodes.set(name, n);
    }
    if (this.nodes.size < this.opts.nodeNames.length) {
      const missing = this.opts.nodeNames.filter((n) => !this.nodes.has(n));
      console.warn('[CesiumModelView] nodos no encontrados en el GLB', missing.slice(0, 8));
    }
    for (const [name, show] of this.pendingShow) this.setNodeShow(name, show);
    this.pendingShow.clear();
  }

  get isReady(): boolean { return !!this.model && this.model.ready && !this.disposed; }

  /** Marco ENU de la batería (re-anclaje / cambio de suelo). */
  setFrame(frame: GeoFrame): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.poseDirty = true;
    this.applyModelMatrix();
  }

  /** Pose local ENU del modelo (traslación/rotación sobre el marco). */
  setPose(m: THREE.Matrix4): void {
    Cesium.Matrix4.fromColumnMajorArray(m.elements as unknown as number[], this.pose);
    this.poseDirty = true;
    this.applyModelMatrix();
  }

  private applyModelMatrix(): void {
    if (!this.model || !this.frame || !this.poseDirty) return;
    Cesium.Matrix4.clone(this.frame.enuToEcefMatrix, this.enu);
    if (this.isIdentityPose()) Cesium.Matrix4.clone(this.enu, this.modelMatrix);
    else Cesium.Matrix4.multiplyTransformation(this.enu, this.pose, this.modelMatrix);
    this.model.modelMatrix = this.modelMatrix;
    this.poseDirty = false;
  }

  private isIdentityPose(): boolean {
    return Cesium.Matrix4.equals(this.pose, Cesium.Matrix4.IDENTITY);
  }

  /** Escribe la matriz local de un nodo si cambió (umbral 1e-7). */
  setNodeMatrix(name: string, m: THREE.Matrix4): void {
    const node = this.nodes.get(name);
    if (!node) return;
    const e = m.elements;
    let last = this.lastMats.get(name);
    if (last) {
      let same = true;
      for (let i = 0; i < 16; i++) {
        if (Math.abs(last[i] - e[i]) > 1e-7) { same = false; break; }
      }
      if (same) return;
    } else {
      last = new Float64Array(16);
      this.lastMats.set(name, last);
    }
    for (let i = 0; i < 16; i++) last[i] = e[i];
    node.matrix = Cesium.Matrix4.fromColumnMajorArray(e as unknown as number[], this.scratch);
  }

  setNodeShow(name: string, show: boolean): void {
    if (!this.isReady) { this.pendingShow.set(name, show); return; }
    const n = this.model!.getNode(name);
    if (n) n.show = show;
  }

  /** Muestra/oculta el modelo entero. */
  setVisible(v: boolean): void {
    this.visible = v;
    if (this.model) this.model.show = v;
  }

  get shown(): boolean { return this.visible; }

  setColor(c: Cesium.Color | undefined): void {
    if (this.model) this.model.color = c as Cesium.Color;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.model) {
      const prims = this.opts.viewer.scene?.primitives;
      if (prims && !prims.isDestroyed() && prims.contains(this.model)) prims.remove(this.model);
      else if (!this.model.isDestroyed()) this.model.destroy();
      this.model = null;
    }
    this.nodes.clear();
  }
}
