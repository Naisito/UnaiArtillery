// ============================================================================
//  map/theme.ts — Puente entre los tokens CSS (--ua-*) y Cesium.  [V2:MAP]
//
//  Los colores de la simbología y de las geometrías del globo salen de
//  src/theme/tokens.css (dueño: UI): si la UI ajusta un valor, el mapa lo
//  hereda sin tocar código. Las tipografías de las etiquetas de Cesium se
//  precargan ANTES de pintar la primera (Cesium rasteriza los glifos una
//  vez y los cachea: una etiqueta pintada con la fuente aún sin cargar se
//  quedaría con la de reserva para siempre).
// ============================================================================
import * as Cesium from 'cesium';

/** Valores por defecto (= tokens.css) por si el CSS aún no está aplicado. */
const FALLBACK: Record<string, string> = {
  '--ua-friendly': '#4c9aff',
  '--ua-hostile': '#ff4d4f',
  '--ua-neutral': '#6ee7a0',
  '--ua-unknown': '#ffe066',
  '--ua-accent': '#f5a524',
  '--ua-info': '#38bdf8',
  '--ua-ok': '#34d399',
  '--ua-warn': '#fbbf24',
  '--ua-danger': '#f43f5e',
  '--ua-text-1': '#e8edf2',
  '--ua-text-2': '#a3afbb',
  '--ua-text-3': '#6b7785',
  '--ua-text-inverse': '#0b0e12',
  '--ua-bg-0': '#06080b',
  '--ua-surface-solid': '#0d1117',
};

const cache = new Map<string, string>();

/** Valor de un token CSS (cacheado; `refreshTheme()` lo invalida). */
export function token(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  let v = '';
  if (typeof document !== 'undefined') {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  if (!v) v = FALLBACK[name] ?? '#ffffff';
  cache.set(name, v);
  return v;
}

export function refreshTheme(): void {
  cache.clear();
}

/** Color Cesium de un token, con alfa opcional. */
export function tokenColor(name: string, alpha = 1): Cesium.Color {
  const c = Cesium.Color.fromCssColorString(token(name)) ?? Cesium.Color.WHITE.clone();
  return alpha === 1 ? c : c.withAlpha(c.alpha * alpha);
}

/** Paleta semántica del mapa (nombres de contrato → tokens). */
export const C = {
  friendly: () => token('--ua-friendly'),
  hostile: () => token('--ua-hostile'),
  accent: () => token('--ua-accent'),
  info: () => token('--ua-info'),
  ok: () => token('--ua-ok'),
  warn: () => token('--ua-warn'),
  danger: () => token('--ua-danger'),
  text: () => token('--ua-text-1'),
  ink: () => token('--ua-text-inverse'),
  gold: () => token('--ua-unknown'),
};

// Tipografías de las etiquetas del globo (canvas de Cesium).
export const FONT_TAG = '600 13px "Barlow Condensed", "Inter Variable", sans-serif';
export const FONT_TAG_SMALL = '600 12px "Barlow Condensed", "Inter Variable", sans-serif';
export const FONT_DATA = '500 12px "JetBrains Mono Variable", Consolas, monospace';
export const FONT_DATA_SMALL = '500 11px "JetBrains Mono Variable", Consolas, monospace';

let fontsPromise: Promise<void> | null = null;

/** Precarga (idempotente) de las fuentes de las etiquetas. */
export function preloadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  if (typeof document === 'undefined' || !document.fonts?.load) {
    fontsPromise = Promise.resolve();
    return fontsPromise;
  }
  fontsPromise = Promise.all([
    document.fonts.load(FONT_TAG, 'AZ09'),
    document.fonts.load(FONT_DATA, 'AZ09'),
    document.fonts.load('500 12px "Inter Variable"', 'AZ09'),
  ])
    .then(() => undefined)
    .catch(() => undefined);
  return fontsPromise;
}
// Arranque temprano: cuando el visor termina de cargar, ya están.
void preloadFonts();

/** Opciones de etiqueta sin posición (se añade al crearla). */
export type LabelOpts = Omit<Cesium.Label.ConstructorOptions, 'position'>;

/** Opciones comunes de etiqueta "tag" (fondo de cristal oscuro). */
export function tagLabel(
  text: string,
  opts: {
    font?: string;
    color?: Cesium.Color;
    offset?: Cesium.Cartesian2;
    origin?: 'left' | 'center' | 'right';
    vertical?: 'top' | 'center' | 'bottom';
    near?: number;
    far?: number;
  } = {},
): LabelOpts {
  const h = opts.origin === 'left'
    ? Cesium.HorizontalOrigin.LEFT
    : opts.origin === 'right'
      ? Cesium.HorizontalOrigin.RIGHT
      : Cesium.HorizontalOrigin.CENTER;
  const v = opts.vertical === 'top'
    ? Cesium.VerticalOrigin.TOP
    : opts.vertical === 'center'
      ? Cesium.VerticalOrigin.CENTER
      : Cesium.VerticalOrigin.BOTTOM;
  return {
    text,
    font: opts.font ?? FONT_TAG,
    fillColor: opts.color ?? tokenColor('--ua-text-1'),
    showBackground: true,
    backgroundColor: tokenColor('--ua-surface-solid', 0.82),
    backgroundPadding: new Cesium.Cartesian2(7, 4),
    horizontalOrigin: h,
    verticalOrigin: v,
    pixelOffset: opts.offset ?? new Cesium.Cartesian2(0, 0),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    scaleByDistance: new Cesium.NearFarScalar(opts.near ?? 2e3, 1.0, opts.far ?? 6e5, 0.7),
  };
}
