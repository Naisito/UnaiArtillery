// ============================================================================
//  map/icons.ts — Iconos SVG de trazo para el clúster y los menús.  [V2:MAP]
//
//  Rejilla de 24, trazo 1.75 en currentColor (heredan el color del botón).
//  Sin emojis: iconografía técnica propia.
// ============================================================================

const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ` +
  `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  /** Vista de planeamiento (cenital): cuadrícula vista desde arriba. */
  plan: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>'),
  /** Batería propia: marco APP-6 con punto de artillería. */
  battery: svg('<rect x="3" y="7" width="18" height="11" rx="1"/><circle cx="12" cy="12.5" r="2.4" fill="currentColor" stroke="none"/><path d="M12 3.5v3"/>'),
  /** Objetivo hostil: rombo. */
  target: svg('<path d="M12 3l9 9-9 9-9-9z"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".55"/>'),
  grid: svg('<path d="M4 4h16v16H4z"/><path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16"/>'),
  ruler: svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  crosshair: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  center: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" opacity=".5"/>'),
  profile: svg('<path d="M3 19l5-7 4 4 3-5 6 8"/><path d="M3 21h18"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  origin: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  labels: svg('<path d="M4 7V5h16v2M12 5v14M9 19h6"/>'),
};
