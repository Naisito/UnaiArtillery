// ============================================================================
//  map/symbols.ts — Simbología OTAN APP-6 / MIL-STD-2525 en SVG.  [V2:MAP]
//
//  Genera el SVG (cadena pura, testeable) de cada símbolo; la rasterización a
//  canvas HiDPI y los billboards de Cesium viven en symbolRaster/SymbolLayer.
//  Geometría en el espacio de 200×200 de la norma (marco amigo 150×100
//  centrado; hostil = rombo; neutral = cuadrado; desconocido = trébol):
//
//    * Unidad propia de artillería de campaña: marco azul + punto central.
//      Variantes por categoría: cohete (punto + chevrón), misil superficie-
//      superficie (silueta de misil), mortero (flecha sobre círculo),
//      infantería (aspa) para armas ligeras.
//    * Indicador de movilidad bajo el marco: remolcado (barra con ruedas en
//      los extremos), cadenas (óvalo), ruedas todoterreno (3 ruedas).
//    * Escalón sobre el marco: batería/compañía = "I".
//    * Objetivo hostil: rombo rojo. Puesto de observación: triángulo con
//      punto. Punto de impacto previsto (retícula), impacto real (estallido),
//      diana de reto y ápice de la trayectoria.
//
//  Estilo de legibilidad sobre imagen satélite: halo claro exterior, relleno
//  del color de afiliación (tokens --ua-friendly / --ua-hostile) y marco/
//  icono casi negros, como la norma.
// ============================================================================

export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown';
export type UnitIcon = 'fieldArtillery' | 'rocket' | 'missile' | 'mortar' | 'infantry' | 'none';
export type Mobility = 'none' | 'towed' | 'tracked' | 'wheeled';

export interface SymbolColors {
  fill: string;
  frame: string;
  halo: string;
}

export interface UnitSymbolOptions {
  affiliation: Affiliation;
  icon: UnitIcon;
  mobility?: Mobility;
  echelonBattery?: boolean;
  colors: SymbolColors;
  /** Opacidad global (fantasmas de hover). */
  opacity?: number;
}

export interface WeaponSymbolSpec {
  icon: UnitIcon;
  mobility: Mobility;
  /** Designación corta de la plataforma para el rótulo. */
  platform: string;
}

/** Plataforma/símbolo por arma del catálogo (PLAN §3.2). */
export function symbolSpecForWeapon(weaponId: string, category: string): WeaponSymbolSpec {
  switch (weaponId) {
    case 'mortar120': return { icon: 'mortar', mobility: 'towed', platform: 'M120' };
    case 'm777':
    case 'excalibur': return { icon: 'fieldArtillery', mobility: 'towed', platform: 'M777A2' };
    case 'm109': return { icon: 'fieldArtillery', mobility: 'tracked', platform: 'M109A7' };
    case 'pion2s7': return { icon: 'fieldArtillery', mobility: 'tracked', platform: '2S7' };
    case 'm26': return { icon: 'rocket', mobility: 'tracked', platform: 'M270A1' };
    case 'tacticalMissile': return { icon: 'missile', mobility: 'tracked', platform: 'M270A1' };
    case 'gmlrs':
    case 'ergmlrs': return { icon: 'rocket', mobility: 'wheeled', platform: 'M142' };
    case 'prsm': return { icon: 'missile', mobility: 'wheeled', platform: 'M142' };
    case 'pistol9':
    case 'rifle556':
    case 'mg762':
    case 'm2browning': return { icon: 'infantry', mobility: 'none', platform: 'INF' };
    default:
      break;
  }
  switch (category) {
    case 'Mortar': return { icon: 'mortar', mobility: 'none', platform: 'MORT' };
    case 'Rocket': return { icon: 'rocket', mobility: 'none', platform: 'MLRS' };
    case 'Missile': return { icon: 'missile', mobility: 'none', platform: 'SSM' };
    case 'SmallArms': return { icon: 'infantry', mobility: 'none', platform: 'INF' };
    default: return { icon: 'fieldArtillery', mobility: 'none', platform: 'FA' };
  }
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

function svgDoc(pxW: number, pxH: number, viewBox: string, body: string, opacity = 1): string {
  const op = opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" ` +
    `viewBox="${viewBox}"><g${op}>${body}</g></svg>`
  );
}

/** Contorno del marco por afiliación (espacio 200×200). */
export function framePath(aff: Affiliation): string {
  switch (aff) {
    case 'friend': return 'M25,50 H175 V150 H25 Z';
    case 'hostile': return 'M100,22 L178,100 L100,178 L22,100 Z';
    case 'neutral': return 'M45,45 H155 V155 H45 Z';
    case 'unknown':
      return (
        'M63,63 C63,40 137,40 137,63 C160,63 160,137 137,137 C137,160 63,160 63,137 ' +
        'C40,137 40,63 63,63 Z'
      );
  }
}

/** Icono central (trazos/rellenos en color de marco). */
function iconBody(icon: UnitIcon, ink: string): string {
  switch (icon) {
    case 'fieldArtillery':
      return `<circle cx="100" cy="100" r="17" fill="${ink}"/>`;
    case 'rocket':
      return (
        `<circle cx="100" cy="112" r="14" fill="${ink}"/>` +
        `<path d="M78,91 L100,66 L122,91" fill="none" stroke="${ink}" stroke-width="9" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`
      );
    case 'missile':
      return (
        `<path d="M100,56 L109,71 L109,121 L118,135 L82,135 L91,121 L91,71 Z" fill="${ink}"/>`
      );
    case 'mortar':
      return (
        `<circle cx="100" cy="124" r="10" fill="none" stroke="${ink}" stroke-width="7"/>` +
        `<path d="M100,113 V70 M86,84 L100,66 L114,84" fill="none" stroke="${ink}" ` +
        `stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    case 'infantry':
      return (
        `<path d="M25,50 L175,150 M25,150 L175,50" fill="none" stroke="${ink}" stroke-width="6"/>`
      );
    case 'none':
      return '';
  }
}

/** Indicador de movilidad bajo el marco amigo. */
function mobilityBody(m: Mobility, ink: string, halo: string): string {
  const both = (inner: string, haloW: number) =>
    inner.replace(/__S__/g, halo).replace(/__W__/g, String(haloW)) +
    inner.replace(/__S__/g, ink).replace(/__W__/g, '6');
  switch (m) {
    case 'towed':
      return both(
        `<path d="M60,168 H140" fill="none" stroke="__S__" stroke-width="__W__"/>` +
        `<circle cx="51" cy="168" r="8" fill="none" stroke="__S__" stroke-width="__W__"/>` +
        `<circle cx="149" cy="168" r="8" fill="none" stroke="__S__" stroke-width="__W__"/>`,
        13,
      );
    case 'tracked':
      return both(
        `<rect x="50" y="159" width="100" height="20" rx="10" fill="none" stroke="__S__" stroke-width="__W__"/>`,
        13,
      );
    case 'wheeled':
      return both(
        `<path d="M50,159 H150" fill="none" stroke="__S__" stroke-width="__W__"/>` +
        `<circle cx="68" cy="173" r="8" fill="none" stroke="__S__" stroke-width="__W__"/>` +
        `<circle cx="100" cy="173" r="8" fill="none" stroke="__S__" stroke-width="__W__"/>` +
        `<circle cx="132" cy="173" r="8" fill="none" stroke="__S__" stroke-width="__W__"/>`,
        13,
      );
    case 'none':
      return '';
  }
}

/**
 * Símbolo de unidad. `pxSize` es el lado del lienzo en píxeles REALES (el
 * rasterizador ya multiplica por la densidad de pantalla).
 */
export function unitSymbolSvg(opts: UnitSymbolOptions, pxSize: number): string {
  const { fill, frame, halo } = opts.colors;
  const d = framePath(opts.affiliation);
  let body =
    `<path d="${d}" fill="none" stroke="${halo}" stroke-width="15" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="${fill}" stroke="${frame}" stroke-width="6" stroke-linejoin="round"/>`;
  if (opts.affiliation === 'friend' || opts.affiliation === 'neutral') {
    body += iconBody(opts.icon, frame);
  } else if (opts.icon !== 'none' && opts.icon !== 'infantry') {
    body += iconBody(opts.icon, frame);
  }
  if (opts.affiliation === 'friend') {
    body += mobilityBody(opts.mobility ?? 'none', frame, halo);
    if (opts.echelonBattery) {
      body +=
        `<path d="M100,22 V44" stroke="${halo}" stroke-width="15" stroke-linecap="round"/>` +
        `<path d="M100,24 V42" stroke="${frame}" stroke-width="7" stroke-linecap="butt"/>`;
    }
  }
  return svgDoc(pxSize, pxSize, '0 0 200 200', body, opts.opacity ?? 1);
}

/** Puesto de observación (OP): triángulo con punto central. */
export function observerSymbolSvg(colors: SymbolColors, pxSize: number): string {
  const d = 'M100,36 L166,152 L34,152 Z';
  const body =
    `<path d="${d}" fill="none" stroke="${colors.halo}" stroke-width="15" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="${colors.fill}" stroke="${colors.frame}" stroke-width="6" stroke-linejoin="round"/>` +
    `<circle cx="100" cy="116" r="11" fill="${colors.frame}"/>`;
  return svgDoc(pxSize, pxSize, '0 0 200 200', body);
}

/** Punto de impacto previsto: retícula circular con cruz abierta. */
export function aimpointSymbolSvg(color: string, halo: string, pxSize: number, opacity = 1): string {
  const ring = `<circle cx="100" cy="100" r="44" fill="none" stroke="__S__" stroke-width="__W__"/>`;
  const ticks =
    `<path d="M100,30 V66 M100,134 V170 M30,100 H66 M134,100 H170" fill="none" ` +
    `stroke="__S__" stroke-width="__W__" stroke-linecap="round"/>`;
  const draw = (s: string, w: number) =>
    (ring + ticks).replace(/__S__/g, s).replace(/__W__/g, String(w));
  const body =
    draw(halo, 18) + draw(color, 9) +
    `<circle cx="100" cy="100" r="9" fill="${color}" stroke="${halo}" stroke-width="4"/>`;
  return svgDoc(pxSize, pxSize, '0 0 200 200', body, opacity);
}

/** Estallido (impacto real): estrella de 8 puntas. */
export function burstSymbolSvg(color: string, frame: string, pxSize: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? 78 : 34;
    const a = (Math.PI * 2 * i) / 16 - Math.PI / 2;
    pts.push(`${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`);
  }
  const d = `M${pts.join(' L')} Z`;
  const body =
    `<path d="${d}" fill="${color}" stroke="${frame}" stroke-width="7" stroke-linejoin="round"/>` +
    `<circle cx="100" cy="100" r="13" fill="${frame}"/>`;
  return svgDoc(pxSize, pxSize, '0 0 200 200', body);
}

/** Diana de reto: anillos concéntricos dorados con cruz. */
export function challengeSymbolSvg(color: string, halo: string, pxSize: number): string {
  const g =
    `<circle cx="100" cy="100" r="70" fill="none" stroke="__S__" stroke-width="__W__"/>` +
    `<circle cx="100" cy="100" r="38" fill="none" stroke="__S__" stroke-width="__W__"/>` +
    `<path d="M100,14 V58 M100,142 V186 M14,100 H58 M142,100 H186" stroke="__S__" stroke-width="__W__" stroke-linecap="round"/>`;
  const draw = (s: string, w: number) => g.replace(/__S__/g, s).replace(/__W__/g, String(w));
  const body = draw(halo, 17) + draw(color, 8) + `<circle cx="100" cy="100" r="11" fill="${color}"/>`;
  return svgDoc(pxSize, pxSize, '0 0 200 200', body);
}

/** Marcador de ápice: chevrón hacia arriba sobre una barra. */
export function apexSymbolSvg(color: string, halo: string, pxSize: number): string {
  const g =
    `<path d="M50,128 L100,72 L150,128" fill="none" stroke="__S__" stroke-width="__W__" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`;
  const draw = (s: string, w: number) => g.replace(/__S__/g, s).replace(/__W__/g, String(w));
  return svgDoc(pxSize, pxSize, '0 0 200 200', draw(halo, 30) + draw(color, 16));
}

/** Punto simple con halo (inicio/fin de medición, muestras del perfil). */
export function dotSymbolSvg(color: string, halo: string, pxSize: number, label = ''): string {
  const txt = label
    ? `<text x="100" y="128" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" ` +
      `font-size="86" font-weight="700" fill="${halo}">${esc(label)}</text>`
    : '';
  const body =
    `<circle cx="100" cy="100" r="78" fill="${color}" stroke="${halo}" stroke-width="14"/>` + txt;
  return svgDoc(pxSize, pxSize, '0 0 200 200', body);
}
