// ============================================================================
//  texgen.ts — Texturas PBR procedurales (canvas) para el kit de modelado.
//  [V2 — 3D-CORE]
//
//  Todo se genera UNA vez por sesión (caché de módulo) a partir de ruido de
//  valor TILEABLE (periódico) y se comparte entre kits, modelos y exportes.
//  Solo produce lo que sobrevive a GLTFExporter → Cesium:
//    * map         albedo sRGB (multiplica el color base del material),
//    * normalMap   espacio tangente estilo OpenGL (+Y = +v), igual que glTF,
//    * orm         R = 1 (oclusión no usada), G = rugosidad, B = metalicidad
//                  ABSOLUTAS (el material va con roughness = metalness = 1):
//                  GLTFExporter la escribe tal cual como metallicRoughness.
//
//  CONVENCIÓN DE UV: las UV del kit van en METROS (proyección por caras en
//  bake/kit); cada textura declara su tamaño de tesela en metros y fija
//  `repeat = 1/tileM` (se exporta como KHR_texture_transform, que Cesium
//  entiende). Así una chapa de 6 m y un perno de 3 cm tienen la misma
//  densidad de texel y nada se estira distinto.
//
//  En node (vitest) no hay `document`: todas las funciones devuelven null y
//  los materiales caen a factores planos.
// ============================================================================
import * as THREE from 'three';

/** Juego de texturas PBR de una superficie. */
export interface PbrSet {
  map: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
  /** Escala recomendada del normal map. */
  normalScale: number;
}

const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

// ---------------------------------------------------------------------------
//  Ruido de valor periódico (determinista, sin dependencias).
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ruido de valor en [0,1) periódico de periodo (px, py) celdas. s,t ∈ [0,1). */
function vnoise(s: number, t: number, px: number, py: number, seed: number): number {
  const x = s * px, y = t * py;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fbm periódico: `base` celdas en la octava 0, doblando por octava. */
function fbm(s: number, t: number, base: number, octaves: number, seed: number, aniso = 1): number {
  let sum = 0, amp = 0.5, norm = 0, p = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(s, t, p, Math.max(1, Math.round(p * aniso)), seed + o * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
//  Lienzos → texturas.
// ---------------------------------------------------------------------------

interface Fields {
  size: number;
  /** Albedo lineal-ish 0..1 por canal (se escribe como sRGB 8 bits). */
  r: Float32Array; g: Float32Array; b: Float32Array;
  rough: Float32Array; metal: Float32Array;
  height: Float32Array;
}

function fields(size: number): Fields {
  const n = size * size;
  return {
    size,
    r: new Float32Array(n).fill(1), g: new Float32Array(n).fill(1), b: new Float32Array(n).fill(1),
    rough: new Float32Array(n).fill(0.7), metal: new Float32Array(n),
    height: new Float32Array(n),
  };
}

function canvasOf(size: number, write: (img: ImageData) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  write(img);
  ctx.putImageData(img, 0, 0);
  return c;
}

function texOf(canvas: HTMLCanvasElement, tileM: number, srgb: boolean, name: string, png = false): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileM, 1 / tileM);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // JPEG: 5-10× más ligero que PNG en el GLB y codifica más rápido; las
  // texturas de ruido no muestran artefactos a calidad 0.92.
  t.userData.mimeType = png ? 'image/png' : 'image/jpeg';
  t.needsUpdate = true;
  return t;
}

interface PartialSet { map?: THREE.Texture; orm?: THREE.Texture; normal?: THREE.Texture }

/** Genera solo los canales pedidos (albedo/normal compartidos, ORM por variante). */
function toParts(f: Fields, tileM: number, name: string, normalStrength: number,
  want: { map?: boolean; orm?: boolean; normal?: boolean }): PartialSet {
  const all = toSetImpl(f, tileM, name, normalStrength, 1, want);
  return all;
}

function toSet(f: Fields, tileM: number, name: string, normalStrength: number, normalScale: number): PbrSet {
  return toSetImpl(f, tileM, name, normalStrength, normalScale, { map: true, orm: true, normal: true }) as PbrSet;
}

function toSetImpl(f: Fields, tileM: number, name: string, normalStrength: number, normalScale: number,
  want: { map?: boolean; orm?: boolean; normal?: boolean }): PartialSet & { normalScale: number } {
  const { size } = f;
  const map = !want.map ? null : canvasOf(size, (img) => {
    const d = img.data;
    for (let i = 0; i < size * size; i++) {
      d[i * 4] = Math.round(clamp01(f.r[i]) * 255);
      d[i * 4 + 1] = Math.round(clamp01(f.g[i]) * 255);
      d[i * 4 + 2] = Math.round(clamp01(f.b[i]) * 255);
      d[i * 4 + 3] = 255;
    }
  });
  const orm = !want.orm ? null : canvasOf(size, (img) => {
    const d = img.data;
    for (let i = 0; i < size * size; i++) {
      d[i * 4] = 255;
      d[i * 4 + 1] = Math.round(clamp01(f.rough[i]) * 255);
      d[i * 4 + 2] = Math.round(clamp01(f.metal[i]) * 255);
      d[i * 4 + 3] = 255;
    }
  });
  const normal = !want.normal ? null : canvasOf(size, (img) => {
    const d = img.data;
    const h = f.height;
    // Pendiente en unidades de texel → normal; strength absorbe la escala.
    for (let y = 0; y < size; y++) {
      const yu = (y - 1 + size) % size, yd = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xl = (x - 1 + size) % size, xr = (x + 1) % size;
        const dhdu = (h[y * size + xr] - h[y * size + xl]) * 0.5;
        // La fila 0 del lienzo es v = 1 (flipY): +v es "hacia arriba" (y−1).
        const dhdv = (h[yu * size + x] - h[yd * size + x]) * 0.5;
        let nx = -dhdu * normalStrength, ny = -dhdv * normalStrength;
        const nz = 1;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv; ny *= inv;
        const i = (y * size + x) * 4;
        d[i] = Math.round((nx * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
  });
  return {
    map: map ? texOf(map, tileM, true, `${name}_albedo`) : undefined,
    orm: orm ? texOf(orm, tileM, false, `${name}_orm`) : undefined,
    normal: normal ? texOf(normal, tileM, false, `${name}_normal`) : undefined,
    normalScale,
  };
}

/** Raya fina (arañazo) rasterizada sobre los campos, con envoltura toroidal. */
function scratch(f: Fields, x0: number, y0: number, len: number, ang: number, w: number,
  apply: (i: number, k: number) => void): void {
  const { size } = f;
  const steps = Math.ceil(len);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  for (let s = 0; s < steps; s++) {
    const cx = x0 + dx * s, cy = y0 + dy * s;
    for (let o = -w; o <= w; o++) {
      const px = Math.round(cx - dy * o), py = Math.round(cy + dx * o);
      const i = (((py % size) + size) % size) * size + (((px % size) + size) % size);
      apply(i, 1 - Math.abs(o) / (w + 1));
    }
  }
}

// ---------------------------------------------------------------------------
//  Superficies.
// ---------------------------------------------------------------------------

const cache = new Map<string, PbrSet | null>();

function cached(key: string, make: () => PbrSet): PbrSet | null {
  if (!HAS_DOM) return null;
  let s = cache.get(key);
  if (s === undefined) {
    try {
      s = make();
    } catch (err) {
      console.warn('[texgen] sin texturas procedurales', err);
      s = null;
    }
    cache.set(key, s);
  }
  return s;
}

/** Cuantiza para que variantes casi iguales compartan textura. */
const q = (x: number, step = 0.05) => Math.round(x / step) * step;

const partCache = new Map<string, PartialSet | null>();
function cachedPart(key: string, make: () => PartialSet): PartialSet | null {
  if (!HAS_DOM) return null;
  let s = partCache.get(key);
  if (s === undefined) {
    try {
      s = make();
    } catch (err) {
      console.warn('[texgen] sin texturas procedurales', err);
      s = null;
    }
    partCache.set(key, s);
  }
  return s;
}

/** Campos de la pintura a cualquier resolución (mismo ruido en UV → alineados). */
function paintFields(size: number, r0: number, m0: number, w0: number): Fields {
  const f = fields(size);
  // Desconchones PEQUEÑOS (~1 cm) y escasos: la pintura CARC aguanta; el
  // desgaste visible lo pone sobre todo el polvo/barro del horneado.
  const chipT = 0.835 - 0.03 * w0;
  for (let y = 0; y < size; y++) {
    const t = y / size;
    for (let x = 0; x < size; x++) {
      const s = x / size;
      const i = y * size + x;
      const mottle = fbm(s, t, 3, 4, 11);
      const fine = vnoise(s, t, 320, 320, 5);
      // Chorretones: ruido estirado en vertical (v = altura en caras laterales).
      const streak = fbm(s, t, 40, 2, 23, 0.08);
      const chipN = fbm(s, t, 96, 2, 41);
      const chip = smooth(chipT, chipT + 0.012, chipN) * (0.5 + 0.5 * w0);
      const primer = smooth(chipT - 0.012, chipT, chipN) * (1 - chip);
      const st = smooth(0.6, 0.85, streak) * w0;
      const a = 0.95 + 0.07 * (mottle - 0.5) + 0.015 * (fine - 0.5) - 0.045 * st;
      f.r[i] = a * (1 - 0.1 * primer) * (1 - chip) + chip * 0.86;
      f.g[i] = a * (1 - 0.12 * primer) * (1 - chip) + chip * 0.84;
      f.b[i] = a * (1 - 0.16 * primer) * (1 - chip) + chip * 0.86;
      f.rough[i] = (r0 * (0.95 + 0.1 * (mottle - 0.5) + 0.04 * (fine - 0.5)) + 0.04 * st) * (1 - chip) + chip * 0.42;
      f.metal[i] = m0 * (1 - chip) + chip * 0.7;
      f.height[i] = 0.5 * mottle + 0.35 * fine - 0.6 * primer - 0.9 * chip;
    }
  }
  // Arañazos finos (herramientas, botas, roces de carga), en coordenadas UV.
  let seed = 1234;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = Math.round(6 + 22 * w0);
  const k = size / 1024;
  for (let j = 0; j < n; j++) {
    scratch(f, rnd() * size, rnd() * size, (15 + rnd() * 90) * k, rnd() * Math.PI * 2, 0,
      (i, kk) => {
        const a = 0.35 * kk;
        f.r[i] = f.r[i] * (1 - a) + 0.9 * a;
        f.g[i] = f.g[i] * (1 - a) + 0.88 * a;
        f.b[i] = f.b[i] * (1 - a) + 0.88 * a;
        f.rough[i] = Math.min(f.rough[i], 0.5);
        f.metal[i] = Math.max(f.metal[i], 0.4 * kk);
        f.height[i] -= 0.4 * kk;
      });
  }
  return f;
}

/**
 * Pintura militar mate (CARC) sobre acero: moteado de baja frecuencia,
 * piel de naranja, chorretones verticales, desconchones con imprimación y
 * metal debajo y arañazos. El color lo pone el material (map ≈ 1).
 * Albedo + normal (1024²) se comparten por nivel de desgaste (3 niveles);
 * la ORM (512²) va por rugosidad/metal: pocas texturas en el GLB.
 */
export function paintTextures(roughness: number, metalness: number, wear: number): PbrSet | null {
  const r0 = q(roughness, 0.1), m0 = q(metalness, 0.1), w0 = q(wear, 0.5);
  const base = cachedPart(`paint-base:${w0}`, () =>
    toParts(paintFields(1024, 0.7, 0, w0), 1.6, `paint_w${w0}`, 1.2, { map: true, normal: true }));
  const orm = cachedPart(`paint-orm:${r0}:${m0}:${w0}`, () =>
    toParts(paintFields(512, r0, m0, w0), 1.6, `paint_r${r0}_m${m0}_w${w0}`, 1, { orm: true }));
  if (!base?.map || !base.normal || !orm?.orm) return null;
  return { map: base.map, normal: base.normal, orm: orm.orm, normalScale: 0.35 };
}

function steelFields(size: number, r0: number, m0: number): Fields {
  const f = fields(size);
  for (let y = 0; y < size; y++) {
    const t = y / size;
    for (let x = 0; x < size; x++) {
      const s = x / size;
      const i = y * size + x;
      const blot = fbm(s, t, 3, 4, 71);
      // Grano de torneado: ruido muy anisótropo.
      const lathe = vnoise(s, t, 4, 512, 3) * 0.6 + vnoise(s, t, 8, 256, 9) * 0.4;
      const pit = smooth(0.82, 0.86, fbm(s, t, 64, 2, 13));
      const a = 0.9 + 0.12 * (blot - 0.5) + 0.06 * (lathe - 0.5) - 0.1 * pit;
      f.r[i] = a; f.g[i] = a; f.b[i] = a * 1.01;
      f.rough[i] = r0 * (0.85 + 0.3 * (blot - 0.5)) + 0.12 * (lathe - 0.5) + 0.2 * pit;
      f.metal[i] = m0 * (1 - 0.25 * pit);
      f.height[i] = 0.4 * lathe + 0.2 * blot - 0.8 * pit;
    }
  }
  return f;
}

/** Acero desnudo / fosfatado (parkerizado): grano de mecanizado y manchas. */
export function steelTextures(roughness: number, metalness: number): PbrSet | null {
  const r0 = q(roughness, 0.1), m0 = q(metalness, 0.1);
  const base = cachedPart('steel-base', () =>
    toParts(steelFields(512, 0.5, 1), 0.8, 'steel', 1.4, { map: true, normal: true }));
  const orm = cachedPart(`steel-orm:${r0}:${m0}`, () =>
    toParts(steelFields(256, r0, m0), 0.8, `steel_r${r0}_m${m0}`, 1, { orm: true }));
  if (!base?.map || !base.normal || !orm?.orm) return null;
  return { map: base.map, normal: base.normal, orm: orm.orm, normalScale: 0.35 };
}

/** Goma genérica: grano fino, desgaste leve. */
export function rubberTextures(): PbrSet | null {
  return cached('rubber', () => {
    const size = 512, f = fields(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = x / size, t = y / size, i = y * size + x;
        const g = fbm(s, t, 32, 3, 91);
        const blot = fbm(s, t, 4, 3, 7);
        const a = 0.9 + 0.12 * (blot - 0.5) + 0.06 * (g - 0.5);
        f.r[i] = a; f.g[i] = a; f.b[i] = a;
        f.rough[i] = 0.86 + 0.1 * (g - 0.5);
        f.metal[i] = 0;
        f.height[i] = g;
      }
    }
    return toSet(f, 0.6, 'rubber', 1.2, 0.5);
  });
}

/**
 * Banda de rodadura de neumático todoterreno (UV cilíndricas en metros:
 * u = perímetro, v = a lo ancho). La tesela mide 1 m en v: la franja
 * v ∈ [0, 0.5) lleva tacos en chevron centrados en v = 0.25; v ∈ [0.5, 1)
 * es flanco liso con nervios finos.
 */
export const TREAD_TILE_U_M = 0.32;
export function treadTextures(): PbrSet | null {
  return cached('tread', () => {
    const size = 512, f = fields(size);
    for (let y = 0; y < size; y++) {
      // Fila 0 = v alto (flipY): v = 1 - y/size.
      const v = 1 - (y + 0.5) / size;
      for (let x = 0; x < size; x++) {
        const s = (x + 0.5) / size, i = y * size + x;
        const g = vnoise(s, v, 64, 64, 33);
        let h = 0.5;
        let rough = 0.84;
        if (v < 0.5) {
          const across = (v - 0.25) / 0.25; // −1..1 a lo ancho
          // Chevron: dos tacos por tesela, desplazados por lado.
          const phase = s * 2 + Math.abs(across) * 0.55;
          const lug = smooth(0.08, 0.14, (phase % 1)) * (1 - smooth(0.52, 0.58, (phase % 1)));
          const centerGroove = smooth(0.04, 0.09, Math.abs(across));
          h = Math.abs(across) < 0.97 ? lug * centerGroove : 0.2;
          rough = 0.8 + 0.12 * (1 - h);
        } else {
          const rib = 0.5 + 0.5 * Math.sin((v - 0.5) * Math.PI * 2 * 18);
          h = 0.45 + 0.05 * rib;
        }
        const a = (0.78 + 0.26 * h) * (0.95 + 0.1 * (g - 0.5));
        f.r[i] = a; f.g[i] = a; f.b[i] = a;
        f.rough[i] = rough + 0.06 * (g - 0.5);
        f.metal[i] = 0;
        f.height[i] = h * 6 + g * 0.3;
      }
    }
    const set = toSet(f, 1, 'tread', 1.6, 1.0);
    // u escala aparte: TREAD_TILE_U_M en el perímetro, 1 m a lo ancho.
    for (const t of [set.map, set.orm, set.normal]) t.repeat.set(1 / TREAD_TILE_U_M, 1);
    return set;
  });
}

/** Chapa antideslizante (pintura con árido): grano áspero. */
export function nonSlipTextures(): PbrSet | null {
  return cached('nonslip', () => {
    const size = 512, f = fields(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = x / size, t = y / size, i = y * size + x;
        const grit = vnoise(s, t, 200, 200, 3) * 0.7 + vnoise(s, t, 100, 100, 8) * 0.3;
        const wearN = fbm(s, t, 3, 4, 19);
        const worn = smooth(0.6, 0.75, wearN);
        const a = 0.86 + 0.14 * grit - 0.12 * worn;
        f.r[i] = a; f.g[i] = a; f.b[i] = a;
        f.rough[i] = 0.95 - 0.25 * worn;
        f.metal[i] = 0.05 + 0.3 * worn;
        f.height[i] = grit * (1 - worn * 0.7) * 2.5;
      }
    }
    return toSet(f, 0.5, 'nonslip', 1.5, 0.9);
  });
}

/** Lona: trama tejida + manchas. */
export function canvasTextures(): PbrSet | null {
  return cached('canvas', () => {
    const size = 512, f = fields(size);
    const threads = 96;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = x / size, t = y / size, i = y * size + x;
        const wx = Math.sin(s * Math.PI * 2 * threads), wy = Math.sin(t * Math.PI * 2 * threads);
        const over = ((Math.floor(s * threads) + Math.floor(t * threads)) & 1) === 0;
        const weave = over ? 0.5 + 0.5 * Math.abs(wx) : 0.5 + 0.5 * Math.abs(wy);
        const blot = fbm(s, t, 4, 4, 51);
        const a = 0.86 + 0.1 * weave + 0.12 * (blot - 0.5);
        f.r[i] = a; f.g[i] = a; f.b[i] = a * 0.98;
        f.rough[i] = 0.92 + 0.06 * (weave - 0.5);
        f.metal[i] = 0;
        f.height[i] = weave * 1.2 + blot * 0.4;
      }
    }
    return toSet(f, 0.4, 'canvas', 1.2, 0.8);
  });
}

/** Madera de embalaje (palés, cajas): vetas a lo largo de u. */
export function woodTextures(): PbrSet | null {
  return cached('wood', () => {
    const size = 512, f = fields(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = x / size, t = y / size, i = y * size + x;
        const warp = fbm(s, t, 4, 3, 61);
        const grain = 0.5 + 0.5 * Math.sin((t * 40 + warp * 6) * Math.PI * 2);
        const knot = smooth(0.8, 0.9, fbm(s, t, 6, 3, 77));
        const a = 0.82 + 0.14 * grain - 0.25 * knot + 0.06 * (vnoise(s, t, 128, 16, 4) - 0.5);
        f.r[i] = a; f.g[i] = a * 0.97; f.b[i] = a * 0.93;
        f.rough[i] = 0.82 + 0.08 * grain;
        f.metal[i] = 0;
        f.height[i] = grain * 0.8 - knot;
      }
    }
    return toSet(f, 1.0, 'wood', 1.2, 0.5);
  });
}

/**
 * Camuflaje de uniforme tipo OCP/multicam (manchas tostado/marrón/verde
 * sobre base arena). El material lleva color blanco: el color está aquí.
 */
export function uniformCamoTextures(): PbrSet | null {
  return cached('ocp', () => {
    const size = 512, f = fields(size);
    const base: [number, number, number] = [0.6, 0.55, 0.43];
    const pal: Array<[number, number, number]> = [
      [0.5, 0.46, 0.34],  // tostado
      [0.42, 0.43, 0.3],  // verde oliva
      [0.38, 0.32, 0.23], // marrón
      [0.66, 0.62, 0.5],  // crema
    ];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = x / size, t = y / size, i = y * size + x;
        let c = base;
        for (let k = 0; k < pal.length; k++) {
          const n = fbm(s, t, 3 + k, 4, 100 + k * 13, 1.4);
          if (n > 0.6 + k * 0.015) c = pal[k];
        }
        const weave = vnoise(s, t, 256, 256, 2);
        const a = 0.95 + 0.08 * (weave - 0.5);
        f.r[i] = c[0] * a; f.g[i] = c[1] * a; f.b[i] = c[2] * a;
        f.rough[i] = 0.9;
        f.metal[i] = 0;
        f.height[i] = weave;
      }
    }
    return toSet(f, 0.45, 'ocp', 0.8, 0.5);
  });
}

/**
 * Red de camuflaje (malla con "hojas" recortadas): albedo con alfa para
 * alphaTest (→ glTF alphaMode MASK). PNG obligatorio por el canal alfa.
 */
export function camoNetTexture(): THREE.Texture | null {
  if (!HAS_DOM) return null;
  const key = 'camonet';
  const hit = cache.get(key);
  if (hit !== undefined) return hit?.map ?? null;
  const size = 512;
  const cols: Array<[number, number, number]> = [[66, 72, 44], [92, 88, 58], [52, 50, 36], [78, 84, 52]];
  const c = canvasOf(size, (img) => {
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = x / size, t = y / size, i = (y * size + x) * 4;
        const leaf = fbm(s, t, 16, 3, 201);
        const hole = fbm(s, t, 32, 2, 203);
        const mesh = (x % 16 < 1 || y % 16 < 1) ? 1 : 0;
        const pick = Math.floor(fbm(s, t, 4, 2, 207) * 4 * 0.999 * 1.6) % 4;
        const [r, g, b] = cols[pick];
        const k = 0.85 + 0.3 * (leaf - 0.5);
        d[i] = r * k; d[i + 1] = g * k; d[i + 2] = b * k;
        d[i + 3] = (leaf > 0.5 && hole < 0.6) || mesh ? 255 : 0;
      }
    }
  });
  const tex = texOf(c, 2.0, true, 'camonet', true);
  cache.set(key, { map: tex, orm: tex, normal: tex, normalScale: 0 });
  return tex;
}

/**
 * Rótulo de plantilla (stencil) sobre fondo transparente, con los puentes
 * típicos de plantilla militar. Devuelve la textura y su relación de aspecto.
 */
export function stencilTexture(text: string, color = '#e8e2c8'): { tex: THREE.Texture; aspect: number } | null {
  if (!HAS_DOM) return null;
  const key = `stencil:${text}:${color}`;
  const hit = cache.get(key);
  if (hit) return { tex: hit.map, aspect: hit.normalScale };
  const H = 128;
  const probe = document.createElement('canvas').getContext('2d')!;
  const font = `700 ${Math.round(H * 0.78)}px "Arial Narrow", "Barlow Condensed", Arial, sans-serif`;
  probe.font = font;
  const w = Math.max(H, Math.ceil(probe.measureText(text).width + H * 0.3));
  const W = 2 ** Math.ceil(Math.log2(w));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, H * 0.54);
  // Puentes de plantilla: cortes verticales finos que interrumpen los trazos.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, H * 0.47, W, H * 0.045);
  // Desgaste: motas borradas.
  for (let k = 0; k < W / 6; k++) {
    const x = (Math.sin(k * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(k * 78.233) * 12543.123) % 1;
    ctx.beginPath();
    ctx.arc(Math.abs(x) * W, Math.abs(y) * H, 1 + (k % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.name = `stencil_${text.replace(/[^A-Za-z0-9]/g, '_')}`;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.mimeType = 'image/png';
  tex.anisotropy = 8;
  const aspect = W / H;
  cache.set(key, { map: tex, orm: tex, normal: tex, normalScale: aspect });
  return { tex, aspect };
}
