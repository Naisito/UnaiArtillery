// ============================================================================
//  shareState.ts — Codificación PURA del escenario a URL.  [P-VIVO.10]
//
//  encodeState/decodeState versionados (v:1): el estado completo del montaje
//  — batería, arma/munición/carga, puntería, objetivo, meteo y toggles — como
//  JSON compacto → base64url para `location.hash` (#s=…). Reglas:
//    * floats redondeados (lat/lon a ~1 m, ángulos a 0.01º): URLs cortas;
//    * campos DESCONOCIDOS se ignoran al decodificar (forward-compat);
//    * hash corrupto o versión FUTURA → Error limpio (el llamador avisa
//      con toast y limpia el hash);
//    * cero DOM: mismas funciones para el hash y para la sesión persistida
//      en localStorage ('unai-artillery/session/v1').
// ============================================================================

export const SHARE_VERSION = 1;

export interface ShareWeather {
  /** true = meteo real de Open-Meteo (se re-consulta al restaurar). */
  real: boolean;
  /** Solo con real=false: viento (m/s), rumbo (º), T (ºC), P (hPa). */
  ws?: number;
  wb?: number;
  t?: number;
  p?: number;
}

export interface ShareToggles {
  /** Edificios 3D de Google. */
  b?: boolean;
  /** Parábola de preview visible. */
  arc?: boolean;
  /** P-VIVO.8 — noche. */
  night?: boolean;
}

export interface ShareState {
  v: number;
  bat: { lat: number; lon: number };
  /** Id de arma del catálogo. */
  w: string;
  /** Índice de munición (Weapon.rounds). */
  ri: number;
  /** Índice de carga. */
  ci: number;
  az: number;
  el: number;
  high?: boolean;
  /** Objetivo marcado (ENU relativo a la batería; z se re-muestrea). */
  tgt?: { e: number; n: number };
  wx?: ShareWeather;
  tog?: ShareToggles;
}

const round = (x: number, decimals: number): number => {
  const k = 10 ** decimals;
  return Math.round(x * k) / k;
};

/** JSON compacto → base64url (sin '=', con '-' y '_'). */
export function encodeState(s: ShareState): string {
  const compact: ShareState = {
    ...s,
    v: SHARE_VERSION,
    bat: { lat: round(s.bat.lat, 5), lon: round(s.bat.lon, 5) }, // ~1 m
    az: round(s.az, 2),
    el: round(s.el, 2),
    tgt: s.tgt ? { e: round(s.tgt.e, 0), n: round(s.tgt.n, 0) } : undefined,
  };
  const json = JSON.stringify(compact);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodifica un hash (con o sin el prefijo '#s='). Lanza Error con mensaje
 * legible si está corrupto o es de una versión futura; los campos que no
 * conoce esta versión simplemente se ignoran.
 */
export function decodeState(hash: string): ShareState {
  let b64 = hash.trim();
  if (b64.startsWith('#')) b64 = b64.slice(1);
  if (b64.startsWith('s=')) b64 = b64.slice(2);
  if (!b64) throw new Error('hash vacío');

  let json: string;
  try {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/');
    json = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  } catch {
    throw new Error('hash corrupto (no es base64url)');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('hash corrupto (no es JSON)');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('hash corrupto');
  const o = raw as Record<string, unknown>;

  if (typeof o.v !== 'number') throw new Error('hash sin versión');
  if (o.v > SHARE_VERSION) {
    throw new Error(`el enlace es de una versión más nueva (v${o.v})`);
  }

  const bat = o.bat as { lat?: unknown; lon?: unknown } | undefined;
  if (
    !bat || typeof bat.lat !== 'number' || typeof bat.lon !== 'number' ||
    !Number.isFinite(bat.lat) || !Number.isFinite(bat.lon) ||
    Math.abs(bat.lat) > 90 || Math.abs(bat.lon) > 180
  ) {
    throw new Error('batería inválida en el enlace');
  }
  if (typeof o.w !== 'string' || o.w.length === 0) throw new Error('arma inválida en el enlace');
  const num = (x: unknown, fallback: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? x : fallback;

  // Se reconstruye SOLO lo que esta versión entiende: lo demás se ignora.
  const out: ShareState = {
    v: o.v,
    bat: { lat: bat.lat, lon: bat.lon },
    w: o.w,
    ri: Math.max(0, Math.floor(num(o.ri, 0))),
    ci: Math.floor(num(o.ci, -1)),
    az: ((num(o.az, 0) % 360) + 360) % 360,
    el: num(o.el, 45),
  };
  if (o.high === true) out.high = true;
  const tgt = o.tgt as { e?: unknown; n?: unknown } | undefined;
  if (tgt && typeof tgt.e === 'number' && typeof tgt.n === 'number' &&
      Number.isFinite(tgt.e) && Number.isFinite(tgt.n)) {
    out.tgt = { e: tgt.e, n: tgt.n };
  }
  const wx = o.wx as Record<string, unknown> | undefined;
  if (wx && typeof wx.real === 'boolean') {
    out.wx = wx.real
      ? { real: true }
      : {
          real: false,
          ws: num(wx.ws, 0), wb: num(wx.wb, 270), t: num(wx.t, 15), p: num(wx.p, 1013.25),
        };
  }
  const tog = o.tog as Record<string, unknown> | undefined;
  if (tog) {
    out.tog = {};
    if (typeof tog.b === 'boolean') out.tog.b = tog.b;
    if (typeof tog.arc === 'boolean') out.tog.arc = tog.arc;
    if (typeof tog.night === 'boolean') out.tog.night = tog.night;
  }
  return out;
}
