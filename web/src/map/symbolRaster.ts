// ============================================================================
//  map/symbolRaster.ts — SVG → canvas HiDPI para billboards.  [V2:MAP]
//
//  Cada símbolo se rasteriza UNA vez por clave (afiliación/icono/color/
//  tamaño) a una densidad ≥ 2× y se cachea: los billboards de Cesium lo
//  pintan reducido (nítido en pantallas normales y en HiDPI). Las claves
//  estables permiten `billboard.setImage(key, canvas)`: el atlas de
//  texturas de Cesium deduplica por clave y no crece con cada actualización.
// ============================================================================

/** Densidad de rasterizado: al menos 2× (supermuestreo), como mucho 3×. */
export function rasterRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(3, Math.max(2, Math.ceil(dpr)));
}

const cache = new Map<string, Promise<HTMLCanvasElement>>();
const ready = new Map<string, HTMLCanvasElement>();

/**
 * Rasteriza `svgFor(pxSize)` a un canvas de `cssSize × ratio` píxeles.
 * Devuelve la promesa cacheada por `key` (la clave debe incluir colores y
 * tamaño). `peek(key)` da el canvas si ya está listo (síncrono).
 */
export function rasterize(
  key: string, svgFor: (pxSize: number) => string, cssSize: number,
): Promise<HTMLCanvasElement> {
  const hit = cache.get(key);
  if (hit) return hit;
  const ratio = rasterRatio();
  const px = Math.round(cssSize * ratio);
  const p = new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('sin contexto 2D'));
        return;
      }
      ctx.drawImage(img, 0, 0, px, px);
      ready.set(key, canvas);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error(`SVG inválido (${key})`));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(px))}`;
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

export function peek(key: string): HTMLCanvasElement | undefined {
  return ready.get(key);
}
