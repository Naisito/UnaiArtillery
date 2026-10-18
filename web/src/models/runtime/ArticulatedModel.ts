// ============================================================================
//  ArticulatedModel.ts — Un modelo Three articulado, pintado por Cesium (GLB
//  generado en runtime) con red de seguridad en el overlay Three.
//  [V2 — 3D-CORE]
//
//  Ciclo de vida:
//    1. Hornea el grafo fuente (bake.ts) → grafo compacto con nombres únicos.
//    2. Muestra YA ese grafo en el overlay Three (nunca hay hueco sin arma).
//    3. Si hay contexto Cesium: exporta/cachea el GLB (glb.ts) y lo carga
//       como Cesium.Model; al estar listo, articula y cambia de camino
//       (oculta la copia Three). Si falla, se queda en Three.
//    4. sync() cada frame: matrices locales de los nodos animados → Cesium
//       (solo las que cambian) o → copia Three; vigila el marco ENU.
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import { bakeModel, type BakedModel, type BakedNode } from './bake';
import { CesiumModelView } from './CesiumModelView';
import { modelRuntime, type ModelRenderMode, type ModelRuntimeContext } from './context';
import { cachedGlb, type GlbAsset } from './glb';
import type { GeoFrame } from '../../frame';

export interface ArticulatedModelOptions {
  /** Clave de caché del GLB (misma clave ⇒ mismo grafo fuente). */
  key: string;
  root: THREE.Object3D;
  animated?: THREE.Object3D[];
  keep?: THREE.Object3D[];
  /** Padre del camino Three (overlay.enuRoot). */
  threeParent: THREE.Object3D;
  grime?: boolean;
  shadows?: boolean;
  /** Color/alfa de Cesium (fantasma translúcido). */
  cesiumColor?: Cesium.Color;
  /** Opacidad del camino Three (fantasma). */
  threeOpacity?: number;
  mode?: ModelRenderMode;
  /** Contexto explícito (si no, el global de configureModelRuntime). */
  context?: ModelRuntimeContext | null;
  /** Marco ENU propio (si devuelve null, el del contexto). */
  frame?: () => GeoFrame | null;
}

export type RenderPath = 'three' | 'cesium-loading' | 'cesium';

export class ArticulatedModel {
  readonly baked: BakedModel;
  /** Soporte de la pose ENU en el camino Three. */
  readonly holder = new THREE.Group();
  readonly ready: Promise<RenderPath>;
  private view: CesiumModelView | null = null;
  private _path: RenderPath = 'three';
  private disposed = false;
  private visible = true;
  private readonly ctx: ModelRuntimeContext | null;
  private readonly tmp = new THREE.Matrix4();
  private readonly pose = new THREE.Matrix4();
  private readonly hidden = new Set<BakedNode>();
  private ownedMats: THREE.Material[] = [];
  asset: GlbAsset | null = null;

  constructor(private readonly opts: ArticulatedModelOptions) {
    this.baked = bakeModel({
      root: opts.root, animated: opts.animated, keep: opts.keep, grime: opts.grime,
    });
    this.holder.name = `holder:${opts.key}`;
    this.holder.matrixAutoUpdate = false;
    this.holder.add(this.baked.root);
    if (opts.threeOpacity !== undefined && opts.threeOpacity < 1) this.makeTranslucent(opts.threeOpacity);
    opts.threeParent.add(this.holder);
    this.syncThree(true);

    const mode = opts.mode ?? 'auto';
    this.ctx = mode === 'three' ? null : (opts.context !== undefined ? opts.context : modelRuntime());
    this.ready = this.ctx ? this.startCesium(this.ctx) : Promise.resolve('three' as RenderPath);
  }

  get path(): RenderPath { return this._path; }

  private async startCesium(ctx: ModelRuntimeContext): Promise<RenderPath> {
    this._path = 'cesium-loading';
    try {
      // El fantasma (materiales translúcidos en Three) exporta un horneado
      // limpio; el resto exporta su propio grafo horneado (mismo contenido).
      const translucent = this.opts.threeOpacity !== undefined && this.opts.threeOpacity < 1;
      const asset = await cachedGlb(this.opts.key, () => (translucent
        ? bakeModel({ root: this.opts.root, animated: this.opts.animated, keep: this.opts.keep, grime: this.opts.grime })
        : this.baked), translucent);
      if (this.disposed) return this._path;
      this.asset = asset;
      const view = new CesiumModelView({
        viewer: ctx.viewer,
        url: asset.url,
        nodeNames: this.baked.nodes.map((n) => n.name),
        shadows: this.opts.shadows ?? ctx.shadows,
        color: this.opts.cesiumColor,
      });
      this.view = view;
      view.setFrame(this.currentFrame(ctx));
      view.setPose(this.pose);
      await view.ready;
      if (this.disposed) { view.dispose(); return this._path; }
      for (const n of this.hidden) view.setNodeShow(n.name, false);
      this.syncCesium();
      view.setVisible(this.visible);
      this.holder.visible = false;
      this._path = 'cesium';
      ctx.failures = 0;
    } catch (err) {
      console.warn(`[models] ${this.opts.key}: Cesium no disponible — sigo en Three`, err);
      ctx.failures++;
      this.view?.dispose();
      this.view = null;
      this._path = 'three';
      this.holder.visible = this.visible;
    }
    return this._path;
  }

  /** Pose local en el marco ENU (traslación + orientación del modelo). */
  setPose(m: THREE.Matrix4): void {
    this.pose.copy(m);
    this.holder.matrix.copy(m);
    this.holder.matrixWorldNeedsUpdate = true;
    this.view?.setPose(m);
  }

  /** Sincroniza nodos animados (llamar cada frame tras mover el grafo fuente). */
  sync(): void {
    if (this.disposed) return;
    if (this._path === 'cesium' && this.view) {
      if (this.ctx) this.view.setFrame(this.currentFrame(this.ctx));
      this.syncCesium();
    } else {
      this.syncThree(false);
      if (this.view && this.ctx) this.view.setFrame(this.currentFrame(this.ctx));
    }
  }

  private currentFrame(ctx: ModelRuntimeContext): GeoFrame {
    return this.opts.frame?.() ?? ctx.frame();
  }

  private syncCesium(): void {
    const view = this.view!;
    for (const n of this.baked.animatedNodes) {
      view.setNodeMatrix(n.name, this.baked.localMatrix(n, this.tmp));
    }
  }

  private syncThree(force: boolean): void {
    for (const n of this.baked.animatedNodes) {
      this.baked.localMatrix(n, this.tmp);
      if (force || !n.dst.matrix.equals(this.tmp)) {
        n.dst.matrix.copy(this.tmp);
        n.dst.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /** Muestra/oculta un nodo conservado (p. ej. el atrezo). */
  setNodeVisible(src: THREE.Object3D, v: boolean): void {
    const n = this.baked.nodeOf(src);
    if (!n) return;
    n.dst.visible = v;
    if (v) this.hidden.delete(n); else this.hidden.add(n);
    this.view?.setNodeShow(n.name, v);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (this._path === 'cesium') this.view?.setVisible(v);
    else this.holder.visible = v;
  }

  /** Fantasma en el camino Three: materiales translúcidos propios. */
  private makeTranslucent(opacity: number): void {
    const swap = new Map<THREE.Material, THREE.Material>();
    this.baked.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.Material;
      let t = swap.get(src);
      if (!t) {
        t = src.clone();
        t.transparent = true;
        t.opacity = opacity;
        t.depthWrite = false;
        swap.set(src, t);
        this.ownedMats.push(t);
      }
      m.material = t;
      m.castShadow = false;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.view?.dispose();
    this.view = null;
    this.holder.parent?.remove(this.holder);
    this.baked.dispose();
    for (const m of this.ownedMats) m.dispose();
    this.ownedMats = [];
  }
}
