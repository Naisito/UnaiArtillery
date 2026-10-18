// ============================================================================
//  glb.ts — Exporta un modelo horneado a GLB (binario) en el navegador y lo
//  cachea por clave (plataforma + variante).  [V2 — 3D-CORE]
//
//  Envoltura de ejes: el espacio de modelado es Z-up (X derecha, Y adelante);
//  glTF es Y-up. El GLB lleva un nodo raíz `ua_yup` con rotación −90° en X
//  ((x, y, z) → (x, z, −y)), así es un glTF estándar que abre bien en
//  cualquier visor. Cesium lo carga con upAxis = Y (deshace la envoltura) y
//  forwardAxis = X (sin el giro Z→X de la convención glTF): el resultado es
//  IDENTIDAD → x = Este, y = Norte, z = Arriba con el modelMatrix ENU.
//  (Verificado empíricamente: az 0/90/180/270 → tubo N/E/S/O; ver informe.)
// ============================================================================
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { BakedModel } from './bake';

export const YUP_WRAPPER = 'ua_yup';

export interface GlbAsset {
  /** Clave de caché (plataforma:arma:…). */
  key: string;
  /** GLB binario. */
  glb: ArrayBuffer;
  /** Blob URL (vive mientras viva la entrada de caché). */
  url: string;
  bytes: number;
  /** ms empleados en exportar. */
  exportMs: number;
}

/** Exporta el grafo horneado (en reposo) a GLB. */
export async function exportGlb(baked: BakedModel): Promise<ArrayBuffer> {
  const wrapper = new THREE.Group();
  wrapper.name = YUP_WRAPPER;
  wrapper.rotation.x = -Math.PI / 2;
  wrapper.updateMatrix();
  // Copia superficial (comparte geometrías/materiales) con TODO visible: el
  // exportador descarta lo invisible y la visibilidad se gobierna luego con
  // ModelNode.show.
  const copy = baked.root.clone(true);
  copy.traverse((o) => { o.visible = true; });
  wrapper.add(copy);
  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(wrapper, {
    binary: true,
    onlyVisible: true,
    trs: false,
    maxTextureSize: 1024,
  });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLTFExporter no devolvió binario');
  return out;
}

const cache = new Map<string, Promise<GlbAsset>>();

/**
 * GLB cacheado por clave. `make` hornea/construye solo si no está en caché
 * (devuelve el modelo horneado a exportar). Un fallo no se cachea.
 */
export function cachedGlb(key: string, make: () => BakedModel, disposeAfter = false): Promise<GlbAsset> {
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      const baked = make();
      let glb: ArrayBuffer;
      try {
        glb = await exportGlb(baked);
      } finally {
        if (disposeAfter) baked.dispose();
      }
      const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      return { key, glb, url, bytes: glb.byteLength, exportMs: performance.now() - t0 };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Vacía la caché (libera las Blob URLs). */
export async function clearGlbCache(): Promise<void> {
  const all = [...cache.values()];
  cache.clear();
  for (const p of all) {
    try {
      URL.revokeObjectURL((await p).url);
    } catch { /* fallo ya descartado */ }
  }
}
