// ============================================================================
//  icons.ts — Juego de iconos SVG propio de Unai Artillery V2.
//
//  * Iconos de interfaz: rejilla de 20 px, trazo de 1.5 px, extremos y
//    uniones redondeados, sin relleno (salvo puntos/marcas): una sola voz
//    visual en toda la app. Se pintan con `currentColor`.
//  * Siluetas de armas: perfil lateral a escala de lectura (viewBox 96×40,
//    suelo en y≈36), rellenas con `currentColor` — reconocibles de un
//    vistazo en la tarjeta de arma y el Arsenal.
//  * La marca (logo) tiene su propio dibujo.
//
//  CERO emojis en la UI: todo símbolo sale de aquí.
// ============================================================================

const ICONS = {
  // --- Navegación y acciones genéricas ---------------------------------------
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  chevronDown: '<path d="M5.5 7.5l4.5 4.5 4.5-4.5"/>',
  chevronUp: '<path d="M5.5 12.5L10 8l4.5 4.5"/>',
  chevronRight: '<path d="M7.5 5.5l4.5 4.5-4.5 4.5"/>',
  chevronLeft: '<path d="M12.5 5.5L8 10l4.5 4.5"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  minus: '<path d="M4.5 10h11"/>',
  info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><circle cx="10" cy="6.4" r=".6" fill="currentColor"/>',
  warning: '<path d="M10 2.8l7.8 13.7H2.2z"/><path d="M10 8v4"/><circle cx="10" cy="14.3" r=".6" fill="currentColor"/>',
  error: '<circle cx="10" cy="10" r="7.5"/><path d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6"/>',
  success: '<circle cx="10" cy="10" r="7.5"/><path d="M6.6 10.3l2.3 2.3 4.6-4.9"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.9a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.3"/><circle cx="10" cy="14.4" r=".6" fill="currentColor"/>',
  settings:
    '<path d="M8.32 2.08h3.36l.17 2.21.87.36 1.69-1.44 2.38 2.38-1.44 1.69.36.87 2.21.17v3.36l-2.21.17-.36.87 1.44 1.69-2.38 2.38-1.69-1.44-.87.36-.17 2.21H8.32l-.17-2.21-.87-.36-1.69 1.44-2.38-2.38 1.44-1.69-.36-.87-2.21-.17V8.32l2.21-.17.36-.87-1.44-1.69 2.38-2.38 1.69 1.44.87-.36z"/>' +
    '<circle cx="10" cy="10" r="2.6"/>',
  keyboard:
    '<rect x="2.2" y="5" width="15.6" height="10" rx="1.6"/>' +
    '<path d="M5.2 8.2h.6M8.2 8.2h.6M11.2 8.2h.6M14.2 8.2h.6M5.2 11.8h.6M14.2 11.8h.6M7.8 11.8h4.4"/>',
  share: '<path d="M8.4 11.6l3.2-3.2"/><path d="M7.2 9.4l-1.9 1.9a2.6 2.6 0 0 0 3.7 3.7l1.9-1.9M12.8 10.6l1.9-1.9a2.6 2.6 0 0 0-3.7-3.7l-1.9 1.9"/>',
  reset: '<path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.6"/><path d="M3.4 3.4v3.4h3.4"/>',
  replay: '<path d="M16.4 10a6.4 6.4 0 1 1-1.9-4.6"/><path d="M16.6 3.4v3.4h-3.4"/><path d="M8.6 7.6v4.8l3.8-2.4z" fill="currentColor" stroke-width="1"/>',
  trash: '<path d="M4 6h12M8 6V4.4h4V6M5.6 6l.8 10.4h7.2L14.4 6M8.4 9v4.6M11.6 9v4.6"/>',
  download: '<path d="M10 3v9.6M6 8.8l4 4 4-4M3.6 16.4h12.8"/>',
  play: '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke-width="1"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.6"/><path d="M7 9V6.6a3 3 0 0 1 6 0V9"/>',
  eye: '<path d="M2 10s3-5.4 8-5.4S18 10 18 10s-3 5.4-8 5.4S2 10 2 10z"/><circle cx="10" cy="10" r="2.3"/>',
  panelLeft: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.6"/><path d="M7.5 3.5v13"/>',
  panelRight: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.6"/><path d="M12.5 3.5v13"/>',
  spinner: '<path d="M10 2.5a7.5 7.5 0 1 1-7.5 7.5" />',
  dot: '<circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/>',
  star: '<path d="M10 3l1.88 4.91 5.25.27-4.09 3.31 1.37 5.08L10 13.7l-4.41 2.87 1.37-5.08-4.09-3.31 5.25-.27z"/>',
  starFill: '<path fill="currentColor" d="M10 3l1.88 4.91 5.25.27-4.09 3.31 1.37 5.08L10 13.7l-4.41 2.87 1.37-5.08-4.09-3.31 5.25-.27z"/>',
  clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.6V10l3 2"/>',
  grid: '<rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/>',
  layers: '<path d="M10 3l7.5 4L10 11 2.5 7z"/><path d="M2.5 10.5L10 14.5l7.5-4M2.5 13.8L10 17.8l7.5-4"/>',

  // --- Dirección de tiro -------------------------------------------------------
  target:
    '<circle cx="10" cy="10" r="6.2"/><circle cx="10" cy="10" r="1.8"/>' +
    '<path d="M10 1.8v3.4M10 14.8v3.4M1.8 10h3.4M14.8 10h3.4"/>',
  battery: '<rect x="2.5" y="5" width="15" height="10" rx="1.2"/><circle cx="10" cy="10" r="2.1" fill="currentColor"/>',
  pin: '<path d="M10 17.8s5.4-5.1 5.4-9.4a5.4 5.4 0 0 0-10.8 0c0 4.3 5.4 9.4 5.4 9.4z"/><circle cx="10" cy="8.4" r="2"/>',
  move: '<path d="M10 2.5v15M2.5 10h15M7.8 4.7L10 2.5l2.2 2.2M7.8 15.3l2.2 2.2 2.2-2.2M4.7 7.8L2.5 10l2.2 2.2M15.3 7.8l2.2 2.2-2.2 2.2"/>',
  fire: '<path d="M10 2l1.3 4.86L15.66 4.34 13.14 8.7 18 10l-4.86 1.3 2.52 4.36-4.36-2.52L10 18l-1.3-4.86-4.36 2.52L6.86 11.3 2 10l4.86-1.3L4.34 4.34 8.7 6.86z"/>',
  cannon: '<path d="M6.5 12.4L17.2 5.8M8.3 13.6l-5.6 2.6"/><circle cx="7.6" cy="13.9" r="2.6"/>',
  ammo: '<path d="M8 17V8.6C8 5.6 10 3 10 3s2 2.6 2 5.6V17z"/><path d="M6.8 17h6.4M8 12.4h4"/>',
  angle: '<path d="M3 16.5h14M3 16.5L13.6 5"/><path d="M8.2 16.5a5.2 5.2 0 0 0-1.6-3.8"/>',
  mrsi: '<path d="M2.5 16.8C4 6.2 12.4 4.2 17.2 15.6"/><path d="M2.5 16.8C5 10.4 12 9.6 17.2 15.6"/><path d="M2.5 16.8c3.4-3.2 9.4-3.6 14.7-1.2"/><circle cx="17.2" cy="15.6" r="1.3" fill="currentColor"/>',
  salvo:
    '<ellipse cx="10" cy="11" rx="7.5" ry="4.6" stroke-dasharray="2.2 2.2"/>' +
    '<g fill="currentColor" stroke="none"><circle cx="7" cy="10" r="1.1"/><circle cx="11.2" cy="9.3" r="1.1"/>' +
    '<circle cx="13.8" cy="11.8" r="1.1"/><circle cx="9.2" cy="12.8" r="1.1"/><circle cx="5.6" cy="12.4" r="1.1"/><circle cx="15" cy="9.4" r="1.1"/></g>',
  compare: '<path d="M2.5 16.8C5 5.2 12.2 4.4 17.5 16.8"/><path d="M2.5 16.8C4.8 9 9.6 8.2 12.6 16.8" stroke-dasharray="2 2.2"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7.5" ry="4.6" stroke-dasharray="2.2 2"/><path d="M10 7.6v4.8M7.6 10h4.8"/>',
  impact: '<path d="M2.5 15.8h15"/><path d="M5.2 15.8a4.8 2.2 0 0 1 9.6 0"/><path d="M10 12V6.4M6.6 12.6L4.6 9M13.4 12.6l2-3.6"/>',
  range: '<path d="M3 14.5h14M3 11.5v6M17 11.5v6"/><path d="M5.5 9.2C7.6 4 12.4 4 14.5 9.2"/>',
  apex: '<path d="M2.5 16.5C5 4.5 15 4.5 17.5 16.5"/><path d="M10 4.4v12.1" stroke-dasharray="1.6 1.8"/><circle cx="10" cy="7.4" r="1.2" fill="currentColor"/>',
  timer: '<circle cx="10" cy="11" r="6.4"/><path d="M10 7.4V11l2.4 1.6M8 2.6h4"/>',
  fuze: '<path d="M10 2.8v3M7 5.8h6l-.8 3H7.8z"/><path d="M7.8 8.8c-1.6 1-2.6 2.6-2.6 4.6a4.8 4.8 0 0 0 9.6 0c0-2-1-3.6-2.6-4.6"/>',
  charge: '<rect x="4" y="6" width="12" height="9" rx="1.6"/><path d="M7 6V4.5h6V6M7.5 10.5h5"/>',
  sigma: '<path d="M14.5 4.5h-9l5 5.5-5 5.5h9"/>',

  // --- Meteorología --------------------------------------------------------------
  wind: '<path d="M2.5 7.5h9a2.5 2.5 0 1 0-2.5-2.5M2.5 11h12.4a2.5 2.5 0 1 1-2.5 2.5M2.5 14.5h6"/>',
  arrowUp: '<path d="M10 16.5v-13M5.5 8L10 3.5 14.5 8"/>',
  thermometer: '<path d="M8 11.6V4.2a2 2 0 0 1 4 0v7.4a3.6 3.6 0 1 1-4 0z"/><path d="M10 8.2v5.6"/>',
  gauge: '<path d="M3.2 14.4a6.8 6.8 0 1 1 13.6 0"/><path d="M10 14.4l3.2-4.4"/><circle cx="10" cy="14.4" r="1.2" fill="currentColor"/>',
  globe: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.1 2.2 3.2 4.7 3.2 7.5s-1.1 5.3-3.2 7.5c-2.1-2.2-3.2-4.7-3.2-7.5S7.9 4.7 10 2.5z"/>',
  cloud: '<path d="M6.2 15.6h8.2a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 5.1 9.5a3.1 3.1 0 0 0 1.1 6.1z"/>',
  shear: '<path d="M3 17.5V2.5"/><path d="M3 15.5h4M3 11.5h7.5M3 7.5h10.5M3 3.5h13"/><path d="M5.6 14l1.4 1.5-1.4 1.5M8.6 10l1.4 1.5-1.4 1.5M12.1 6l1.4 1.5-1.4 1.5"/>',
  sun: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/>',
  moon: '<path d="M16 12.4A6.6 6.6 0 1 1 7.6 4a5.3 5.3 0 0 0 8.4 8.4z"/>',
  volume: '<path d="M3 7.6h3l4-3.4v11.6l-4-3.4H3z"/><path d="M13.2 7.6a3.4 3.4 0 0 1 0 4.8M15.4 5.4a6.5 6.5 0 0 1 0 9.2"/>',
  volumeOff: '<path d="M3 7.6h3l4-3.4v11.6l-4-3.4H3z"/><path d="M13.4 7.8l4 4.4M17.4 7.8l-4 4.4"/>',

  // --- Pestañas del dock derecho -------------------------------------------------
  table: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.6"/><path d="M2.5 7.6h15M2.5 11.6h15M8 7.6v8.9"/>',
  chart: '<path d="M3 3v14h14"/><path d="M5.8 13.4l3.2-4 3 2.4 4.4-5.6"/>',
  medal: '<circle cx="10" cy="12.4" r="4.6"/><path d="M7.2 3l1.8 5M12.8 3L11 8"/><path d="M10 10.2l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z" fill="currentColor" stroke-width=".8"/>',
  binoculars: '<circle cx="6" cy="13" r="3.4"/><circle cx="14" cy="13" r="3.4"/><path d="M6 9.6V5h2.6v5M14 9.6V5h-2.6v5M8.6 11.4h2.8"/>',
  truck: '<path d="M2 5.5h9.5v8.2H2zM11.5 8.4h3.6l2.9 3v2.3h-6.5"/><circle cx="5.4" cy="15" r="1.7"/><circle cx="14.6" cy="15" r="1.7"/>',

  // --- Cámaras ------------------------------------------------------------------------
  camFree: '<path d="M10 2.6l5.4 14.6L10 13.8l-5.4 3.4z"/>',
  camOrbit: '<ellipse cx="10" cy="10.6" rx="7.6" ry="3.6"/><circle cx="10" cy="10.6" r="1.9"/><path d="M13.4 5.6l2.6 1.4-1.6 2.4"/>',
  camFollow: '<path d="M12.6 4.2l3.2 3.2-6.2 6.2-3.2-3.2z"/><path d="M15.8 4.2l1.6-1.6M6.2 12.8l-3.4 3.4M8.6 15l-2 2M4.4 10.6l-2 2"/>',
  camDrone: '<rect x="8.4" y="8.4" width="3.2" height="3.2" rx=".6"/><path d="M8.4 8.4L6 6M11.6 8.4L14 6M8.4 11.6L6 14M11.6 11.6L14 14"/><circle cx="5" cy="5" r="2.2"/><circle cx="15" cy="5" r="2.2"/><circle cx="5" cy="15" r="2.2"/><circle cx="15" cy="15" r="2.2"/>',
  camCabin: '<path d="M3 6.6V3.4h3.2M13.8 3.4H17v3.2M17 13.4v3.2h-3.2M6.2 16.6H3v-3.2"/><circle cx="10" cy="10" r="3"/><path d="M10 5.4v1.8M10 12.8v1.8M5.4 10h1.8M12.8 10h1.8"/>',
  camFps: '<circle cx="10" cy="6.4" r="3"/><path d="M4 17.6a6 6 0 0 1 12 0"/>',
  fov: '<path d="M3 10l14-6M3 10l14 6"/><path d="M12.6 5.9a8.6 8.6 0 0 1 0 8.2"/><circle cx="3" cy="10" r="1.2" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** Marcado SVG de un icono de interfaz (20 px por defecto). */
export function iconSvg(name: IconName, size = 20, extraClass = ''): string {
  return (
    `<svg class="ua-icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 20 20" ` +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`
  );
}

/** Icono como nodo (span contenedor; el SVG hereda el color del texto). */
export function icon(name: IconName, size = 20, extraClass = ''): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'ua-icon-wrap';
  span.innerHTML = iconSvg(name, size, extraClass);
  return span;
}

// ---------------------------------------------------------------------------
//  Siluetas de armas (perfil lateral, viewBox 96×40, morro a la derecha).
// ---------------------------------------------------------------------------

/** Rueda con buje hueco (evenodd): cx, cy, radio exterior, radio del buje. */
const wheel = (cx: number, cy: number, r: number, hub: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z` +
  `M${cx - hub} ${cy}a${hub} ${hub} 0 1 0 ${2 * hub} 0a${hub} ${hub} 0 1 0 ${-2 * hub} 0z`;

/** Tren de rodaje de cadenas: banda (trazo) + ruedas de apoyo. */
const tracks = (x0: number, x1: number, wheelsX: number[]): string =>
  `<rect x="${x0}" y="27.6" width="${x1 - x0}" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
  wheelsX.map((x) => `<circle cx="${x}" cy="31.6" r="2.5"/>`).join('');

const GROUND = '<path d="M2 36.6h92" fill="none" stroke="currentColor" stroke-width="1" opacity=".28"/>';

const SILHOUETTES = {
  /** Mortero pesado de 120 mm sobre placa base con bípode. */
  mortar:
    GROUND +
    '<path d="M15 32.6h25l3 3.4H12z"/>' +
    '<path d="M29.7 33.9L26.3 32 44.3 1.9 47.7 3.8z"/>' +
    '<path d="M43.6 3.3l4.8 2.7 1.1-1.9-4.8-2.7z"/>' +
    '<rect x="31" y="17.6" width="3.6" height="3" rx=".6" transform="rotate(-60 32.8 19.1)"/>' +
    '<path d="M37 17.4L48.2 36M37 17.4L54.4 36M42.2 26.4h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M35.6 15.6l3.8 2.2 1-1.7-3.8-2.2z"/>',
  /** Obús remolcado (M777A2) en posición de fuego: colas abiertas al suelo. */
  towed:
    GROUND +
    '<path d="M39.6 20.45L89.67 7.74 90.33 10.26 40.4 23.55z"/>' +
    '<path d="M92.51 10.72L91.36 6.27 87.49 7.28 88.64 11.73z"/>' +
    '<path d="M35.33 19.91L58.54 13.89 60.14 20.07 36.93 26.09z"/>' +
    '<path d="M34 25.5L52 21l4 9.5-23 1z"/>' +
    '<path d="M37 29L6 34.5 5 36l32-4.5z"/>' +
    '<path d="M3.5 32.5l5 1L7 37l-4-.5z"/>' +
    '<path d="M40 31h7l1 4.6h-9z"/>' +
    `<path fill-rule="evenodd" d="${wheel(50, 30.4, 5.2, 1.9)}"/>`,
  /** Obús autopropulsado de cadenas (M109A7 Paladin). */
  sp:
    GROUND +
    tracks(6, 72, [13, 21.5, 30, 38.5, 47, 55.5, 64]) +
    '<path d="M8 20h58l8 4-4 3H8l-4-4z"/>' +
    '<path d="M20 20l4-9h32l6 4v5z"/>' +
    '<rect x="28" y="7.6" width="8" height="3.6" rx="1"/>' +
    '<path d="M59.69 13.14L92.73 5.83 93.27 8.17 60.31 15.87z"/>' +
    '<path d="M80.96 11.99L79.99 7.7 74.14 9.03 75.11 13.32z"/>' +
    '<path d="M95.15 8.77L94.17 4.48 90.85 5.23 91.83 9.52z"/>',
  /** Cañón autopropulsado pesado de 203 mm (2S7 Pion) con reja de apoyo. */
  spgun:
    GROUND +
    tracks(5, 78, [11.5, 20, 28.5, 37, 45.5, 54, 62.5, 71]) +
    '<path d="M5 22h59l14 3-2 2.4H6l-4-3z"/>' +
    '<path d="M60 22l2-6.5h12l5 6.5z"/>' +
    '<path d="M18 22l6-9 16-3 4 6-4 6z"/>' +
    '<path d="M35.64 12.03L92.71 1.93 93.29 5.07 36.36 15.97z"/>' +
    '<path d="M2 23.6h4.6l-2.4 11.2-3.8-.9z"/>',
  /** Proyectil guiado de 155 mm (M982 Excalibur) con canards y aletas. */
  guidedShell:
    '<path d="M16 14h50c12 0 20 3 25 6-5 3-13 6-25 6H16z"/>' +
    '<path d="M16 14l-6 2v8l6 2z"/>' +
    '<rect x="21" y="13.3" width="3" height="13.4" rx=".6"/>' +
    '<path d="M69 14.5l6 .7-2.5-5.4zM69 25.5l6-.7-2.5 5.4z"/>' +
    '<path d="M12 15l8-1L11 5.5 8.5 6zM12 25l8 1-9 8.5-2.5-.5z"/>',
  /** Lanzacohetes múltiple de cadenas (M270 MLRS) con el LLM elevado. */
  mlrs:
    GROUND +
    tracks(4, 74, [11, 20, 29, 38, 47, 56, 65]) +
    '<path d="M5 22h65l6 3-3 2.4H6l-3-3z"/>' +
    '<path fill-rule="evenodd" d="M52 22l2-10h14l6 6v4zM56 14h10.5l3.5 3.5H56z"/>' +
    '<path d="M8 22l36.05-12.02-2.53-7.59L5.47 14.41z"/>' +
    '<path d="M36 22l-4-8.6" fill="none" stroke="currentColor" stroke-width="2"/>',
  /** Lanzador de ruedas 6×6 (M142 HIMARS) con el pod elevado. */
  himars:
    GROUND +
    '<rect x="8" y="24.4" width="80" height="4.2" rx="1"/>' +
    '<path fill-rule="evenodd" d="M66 28.6V14q0-2 2-2h12l7 7v9.6zM69 14.6h10l4.4 4.4H69z"/>' +
    '<rect x="14" y="21" width="40" height="3.6" rx=".8"/>' +
    '<path d="M12 24l34.24-11.12-2.78-8.56L9.22 15.44z"/>' +
    `<path fill-rule="evenodd" d="${wheel(24, 31, 5.2, 1.9)}${wheel(36.4, 31, 5.2, 1.9)}${wheel(78, 31, 5.2, 1.9)}"/>`,
  /** Misil balístico táctico (clase ATACMS). */
  missile:
    '<rect x="12" y="16" width="67" height="8" rx="1"/>' +
    '<path d="M78 16c8 0 13 2.5 16 4-3 1.5-8 4-16 4z"/>' +
    '<path d="M13 16h12l-8-6.5h-5zM13 24h12l-8 6.5h-5z"/>' +
    '<path d="M12 17l-4 1v4l4 1z"/>',
  /** Misil de precisión de largo alcance (clase PrSM), más esbelto. */
  missileSlim:
    '<rect x="8" y="17.5" width="73" height="5" rx=".8"/>' +
    '<path d="M80 17.5c8 0 12 1.5 15 2.5-3 1-7 2.5-15 2.5z"/>' +
    '<path d="M9 17.5h9l-6-5H8.5zM9 22.5h9l-6 5H8.5z"/>' +
    '<path d="M44 17.5h10l-2-1.7h-6zM44 22.5h10l-2 1.7h-6z"/>' +
    '<path d="M8 18.5l-3 .5v2l3 .5z"/>',
  /** Pistola semiautomática de 9 mm. */
  pistol:
    '<path d="M30 10h36l1 1v6H30z"/>' +
    '<rect x="32" y="17" width="32" height="3"/>' +
    '<path d="M32 17h12l-4 17H29l-1-3z"/>' +
    '<path d="M44 20q0 6 6 6h4v-6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<rect x="46" y="20" width="1.6" height="4"/>' +
    '<rect x="31" y="8.6" width="3" height="1.6"/><rect x="63" y="8.8" width="1.6" height="1.4"/>',
  /** Fusil de asalto de 5.56 mm (tipo M4). */
  rifle:
    '<path d="M4 15l16-2h2v9h-3L6 25H4z"/>' +
    '<rect x="18" y="14" width="10" height="4"/>' +
    '<path d="M26 12h26v8H26z"/>' +
    '<rect x="28" y="9.4" width="20" height="2.8" rx=".6"/>' +
    '<path d="M34 20h5l-2 10h-5z"/>' +
    '<path d="M42 20h6l2 12q-3 1.5-5.5 1z"/>' +
    '<rect x="52" y="12.5" width="20" height="6.5" rx="1"/>' +
    '<rect x="72" y="14.5" width="16" height="2"/>' +
    '<path d="M69.6 12.5h2.4V8.4h-1.2z"/>' +
    '<rect x="88" y="14" width="4" height="3"/>',
  /** Ametralladora media de 7.62 mm (M240) sobre trípode M192. */
  mg:
    '<path d="M6 13l12-1h2v7h-4l-9 1z"/>' +
    '<rect x="20" y="11" width="26" height="7.5" rx=".8"/>' +
    '<path d="M24 11h18l-2-2.5H26z"/>' +
    '<rect x="46" y="13" width="36" height="2.5"/>' +
    '<rect x="46" y="15.5" width="20" height="1.8"/>' +
    '<rect x="82" y="12.5" width="6" height="3.5" rx=".6"/>' +
    '<path d="M50 13q4-6 8 0" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M28 18.5h5l-2 7.5h-4.5z"/>' +
    '<rect x="38" y="18.5" width="4" height="3.5"/>' +
    '<path d="M40 21.6L22 36M40 21.6L62 36M40 21.6L44 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  /** Ametralladora pesada .50 (M2HB) sobre trípode M3. */
  hmg:
    '<rect x="5" y="11" width="6" height="2" rx=".6"/><rect x="5" y="16.4" width="6" height="2" rx=".6"/>' +
    '<rect x="10" y="10" width="3" height="10"/>' +
    '<rect x="13" y="9" width="27" height="11" rx=".8"/>' +
    '<path d="M16 9h18l-2-2.2H18z"/>' +
    '<path fill-rule="evenodd" d="M40 11.5h12v6H40zM43 14.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM47 14.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0z"/>' +
    '<rect x="52" y="13" width="32" height="3"/>' +
    '<rect x="84" y="12.5" width="3" height="4" rx=".5"/>' +
    '<path d="M60 13V9.6h6V13" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="20" y="20" width="12" height="7" rx=".8"/>' +
    '<rect x="24" y="20" width="4" height="4"/>' +
    '<path d="M26 23.4L8 36M26 23.4L58 36M26 23.4L34 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
} as const;

export type SilhouetteName = keyof typeof SILHOUETTES;

/** Silueta de arma como marcado SVG (ancho en px; alto proporcional 96:40). */
export function silhouetteSvg(name: SilhouetteName, width = 96, extraClass = ''): string {
  const height = Math.round((width * 40) / 96);
  return (
    `<svg class="ua-silhouette ${extraClass}" width="${width}" height="${height}" viewBox="0 0 96 40" ` +
    `fill="currentColor" aria-hidden="true" focusable="false">${SILHOUETTES[name]}</svg>`
  );
}

export function silhouette(name: SilhouetteName, width = 96, extraClass = ''): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'ua-silhouette-wrap';
  span.innerHTML = silhouetteSvg(name, width, extraClass);
  return span;
}

// ---------------------------------------------------------------------------
//  Marca de producto: hexágono táctico + arco balístico + retícula de impacto.
// ---------------------------------------------------------------------------
export function logoSvg(size = 28): string {
  return (
    `<svg class="ua-logo" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" ` +
    'aria-hidden="true" focusable="false">' +
    '<path d="M16 2.2l12 6.9v13.8l-12 6.9-12-6.9V9.1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M16 5.6l9 5.2v10.4l-9 5.2-9-5.2V10.8z" fill="currentColor" opacity=".08"/>' +
    '<path d="M8.6 21.4C10.4 11 18.4 9.4 22.6 19.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 2.6"/>' +
    '<circle cx="22.9" cy="20.4" r="2.4" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M22.9 16.6v1.4M22.9 22.8v1.4M19.1 20.4h1.4M25.3 20.4h1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '<circle cx="8.6" cy="21.4" r="1.5" fill="currentColor"/>' +
    '</svg>'
  );
}
