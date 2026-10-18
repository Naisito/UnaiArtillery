// ============================================================================
//  projectiles.ts — Modelos de proyectil por arma Y por munición.  [V2]
//  DUEÑO: agente 3D-SMALL (ver docs/PLAN_V2.md).
//
//  Convención (rig.ts): eje +Y, nariz en +Y, origen ≈ centro de masas, metros
//  reales (el presentador puede escalar para que se vea; aquí no se finge).
//  Se pintan en el overlay Three (no se exportan a glTF): pueden llevar
//  rotulado estarcido en CanvasTexture.
//
//  Código de colores de munición de EE. UU. (MIL-STD-709):
//    * HE ............ verde oliva con rotulado amarillo (+ banda amarilla),
//    * ILLUM ......... blanco con rotulado negro,
//    * humo (WP) ..... verde claro con rotulado rojo claro,
//    * banda marrón .. carga de baja explosividad (expulsora, motor cohete,
//                      generador base bleed),
//    * balas: M855 punta verde, trazadoras punta naranja (M856/M62) o roja
//      (M17 .50); bola sin color (M80, M33).
//  Soviético/ruso (3OF43): gris con rotulado negro, dos bandas de cobre.
//
//  Modelos: M107 (espoleta M739), M795, M795E-BB (generador base bleed),
//  M549A1 RAP (tobera del motor en el culote), M485 ILLUM y M825 humo
//  (culote eyectable, espoleta M762), M982 Excalibur (canards y aletas de
//  base giratoria), 3OF43 203 mm, bomba de mortero 120 mm M934 (aletas M31,
//  cargas M230 en herradura, espoleta M734) + ILLUM/humo, cohetes M26 (aletas
//  envolventes), M31 GMLRS (canards + aletas envolventes), ER GMLRS (aletas
//  de control de cola), ATACMS MGM-140, PrSM, y balas 9 mm, M855/M856,
//  M80/M62 y M33/M17.
// ============================================================================
import * as THREE from 'three';
import type { Weapon, WeaponId } from '../ballistics';
import { WeaponCatalog } from '../ballistics';
import { ModelKit } from './kit';
import type { ProjectileModel } from './rig';
import { mergeStatic, revolve, stencilMaterial, type Profile } from './parts/small-util';

const DEG = Math.PI / 180;

/** Variante de presentación (no cambia la física). */
export interface ProjectileVariant {
  /** Bala trazadora (punta pintada + compuesto trazador encendido). */
  tracer?: boolean;
}

// ============================================================================
//  Colores (sRGB aprox.)
// ============================================================================
const C = {
  od: '#4f5634',
  odDark: '#3f4529',
  yellow: '#e2bf36',
  white: '#e6e3d8',
  black: '#1b1b1a',
  lightGreen: '#93ab84',
  lightRed: '#c9483b',
  brown: '#6a4a2c',
  sovGray: '#7c817e',
  rocketOd: '#545b3a',
  prsm: '#d9dbd6',
};

// ============================================================================
//  Utilidades de perfil
// ============================================================================

/**
 * Ojiva tangente desde (R, y0) hasta (rTip, y0 + len), truncada en una
 * meseta de radio rTip (asiento de espoleta, punta de bala…).
 */
function ogive(R: number, rTip: number, y0: number, len: number, n = 12): Profile {
  // Ojiva tangente apuntada de longitud Lp (x medido desde la BASE de la
  // ojiva: r(0) = R, r(Lp) = 0); se busca Lp para que la sección en x = len
  // valga rTip (bisección: r(len) crece con Lp).
  const rAt = (Lp: number, x: number) => {
    const rho = (R * R + Lp * Lp) / (2 * R);
    return Math.sqrt(Math.max(0, rho * rho - x * x)) + R - rho;
  };
  let lo = len, hi = len * 6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rAt(mid, len) < rTip) lo = mid; else hi = mid;
  }
  const Lp = (lo + hi) / 2;
  const out: Profile = [];
  for (let i = 0; i <= n; i++) {
    const x = (len * i) / n;
    out.push([Math.max(rTip, rAt(Lp, x)), y0 + x]);
  }
  out[out.length - 1] = [rTip, y0 + len];
  return out;
}

type Zone = [number, number, THREE.Material];

/**
 * Revoluciona `profile` repartiéndolo en zonas de material por posición en
 * el eje [y0, y1) (pintura, bandas, rotulado…): superficies contiguas sin
 * solapes (nada de z-fighting).
 */
function zoned(kit: ModelKit, g: THREE.Group, profile: Profile, zones: Zone[], segments = 32): void {
  zones.forEach(([y0, y1, mat], zi) => {
    const last = zi === zones.length - 1;
    const pts: Profile = [];
    const push = (p: [number, number]) => {
      const q = pts[pts.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) pts.push(p);
    };
    for (let k = 0; k + 1 < profile.length; k++) {
      const [ra, ya] = profile[k];
      const [rb, yb] = profile[k + 1];
      if (Math.abs(yb - ya) < 1e-12) {
        const inZone = ya >= y0 && (ya < y1 || (last && ya <= y1));
        if (inZone) { push([ra, ya]); push([rb, yb]); }
        continue;
      }
      const t0 = (y0 - ya) / (yb - ya), t1 = (y1 - ya) / (yb - ya);
      const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
      if (hi <= lo) continue;
      const at = (t: number): [number, number] => [ra + (rb - ra) * t, ya + (yb - ya) * t];
      push(at(lo));
      push(at(hi));
    }
    if (pts.length >= 2) g.add(revolve(kit, pts, mat, { segments }));
  });
}

/** Aletas planas (silueta trapecial) repartidas alrededor del eje Y. */
function planarFins(
  kit: ModelKit, g: THREE.Group, n: number, mat: THREE.Material,
  f: { r0: number; rootY0: number; rootY1: number; tipY0: number; tipY1: number; span: number; t: number; rollDeg?: number },
): void {
  for (let i = 0; i < n; i++) {
    const holder = kit.group({ rotDeg: [0, (f.rollDeg ?? 0) + (360 * i) / n, 0] });
    holder.add(kit.extrudeSide([
      [f.rootY0, f.r0 - 0.002], [f.rootY1, f.r0 - 0.002], [f.tipY1, f.r0 + f.span], [f.tipY0, f.r0 + f.span],
    ], f.t, mat, { bevel: Math.min(f.t * 0.3, 0.002) }));
    g.add(holder);
  }
}

/**
 * Aletas envolventes desplegadas (cohetes MLRS): chapas curvas de radio R
 * (el del cuerpo) articuladas en la superficie, abiertas hacia fuera.
 */
function wrapFins(kit: ModelKit, g: THREE.Group, n: number, mat: THREE.Material, R: number, y0: number, chord: number, t: number, sweepDeg = 90): void {
  const pts: THREE.Vector2[] = [];
  const N = 10;
  // Plano de la sección: (u, v) = (z, x) => extrusión en Y sin invertir caras.
  const cx = R, cz = R; // centro del arco (bisagra en x = 0, z = R)
  for (let i = 0; i <= N; i++) {
    const a = (sweepDeg * DEG * i) / N;
    const ro = R + t / 2;
    pts.push(new THREE.Vector2(cz + ro * Math.sin(a), cx - ro * Math.cos(a)));
  }
  for (let i = N; i >= 0; i--) {
    const a = (sweepDeg * DEG * i) / N;
    const ri = R - t / 2;
    pts.push(new THREE.Vector2(cz + ri * Math.sin(a), cx - ri * Math.cos(a)));
  }
  const shape = new THREE.Shape(pts);
  for (let i = 0; i < n; i++) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: chord, bevelEnabled: false, curveSegments: 4 });
    geo.applyMatrix4(new THREE.Matrix4().set(
      0, 1, 0, 0,
      0, 0, 1, y0,
      1, 0, 0, 0,
      0, 0, 0, 1,
    ));
    geo.computeVertexNormals();
    const holder = kit.group({ rotDeg: [0, (360 * i) / n + 45, 0] });
    holder.add(kit.mesh(geo, mat));
    g.add(holder);
  }
}

/** Material con rotulado para la zona cilíndrica (r, longitud de zona). */
function stencil(
  kit: ModelKit, bg: string, ink: string, lines: string[], r: number, zoneLen: number,
  opts: { repeat?: number; scale?: number; roughness?: number; metalness?: number } = {},
): THREE.MeshStandardMaterial {
  const circ = 2 * Math.PI * r;
  const W = 1024;
  const H = Math.max(64, Math.min(1024, Math.round((W * zoneLen) / circ)));
  return stencilMaterial(kit, { bg, ink, lines, repeat: opts.repeat ?? 2, scale: opts.scale ?? 0.6 },
    { roughness: opts.roughness ?? 0.62, metalness: opts.metalness ?? 0.25 }, [W, H]);
}

function paint(kit: ModelKit, hex: string, roughness = 0.62, metalness = 0.25): THREE.MeshStandardMaterial {
  return kit.paint(new THREE.Color(hex).getHex(), { roughness, metalness });
}

/** Cierra el modelo: origen en el CdM (fracción desde el culote) y fusión. */
function finish(kit: ModelKit, inner: THREE.Group, L: number, cgFrac: number, exhaustY: number | null): ProjectileModel {
  inner.position.y = -cgFrac * L;
  const root = new THREE.Group();
  root.name = 'projectile';
  root.add(inner);
  mergeStatic(kit, inner);
  return {
    root,
    lengthM: L,
    exhaustLocal: exhaustY === null ? null : new THREE.Vector3(0, exhaustY - cgFrac * L, 0),
  };
}

// ============================================================================
//  Espoletas
// ============================================================================

/** M739 PD (155): cuerpo de acero, anillo de reglaje y punta. Base en y0. */
function fuzeM739(kit: ModelKit, g: THREE.Group, rSeat: number, y0: number, L = 0.105): void {
  const steel = kit.steel(0x83888c, { roughness: 0.34 });
  const dark = kit.steel(0x4a4e51, { roughness: 0.5 });
  const prof: Profile = [
    [rSeat, y0], [rSeat * 1.0, y0 + L * 0.06],
    ...ogive(rSeat, rSeat * 0.32, y0 + L * 0.06, L * 0.9, 10).slice(1),
    [rSeat * 0.18, y0 + L * 0.985], [0, y0 + L],
  ];
  zoned(kit, g, prof, [[y0, y0 + L * 0.22, dark], [y0 + L * 0.22, y0 + L * 0.3, steel], [y0 + L * 0.3, y0 + L * 0.34, dark], [y0 + L * 0.34, y0 + L + 1e-6, steel]], 28);
}

/** M762 ET (ILLUM/humo): ojiva de aluminio con cono de plástico negro. */
function fuzeM762(kit: ModelKit, g: THREE.Group, rSeat: number, y0: number, L = 0.11): void {
  const alu = kit.steel(0xa3a7a9, { roughness: 0.35 });
  const plastic = kit.polymer(0x1d1e1f);
  const prof: Profile = [
    [rSeat, y0], ...ogive(rSeat, rSeat * 0.2, y0 + 0.002, L * 0.97, 10).slice(0), [0, y0 + L],
  ];
  zoned(kit, g, prof, [[y0, y0 + L * 0.45, alu], [y0 + L * 0.45, y0 + L + 1e-6, plastic]], 28);
}

// ============================================================================
//  155 mm: M107 / M795 / M795E-BB / M549A1 RAP / M485 ILLUM / M825 humo
// ============================================================================
type Shell155Kind = 'M107' | 'M795' | 'M795BB' | 'M549' | 'M485' | 'M825';

function shell155(kit: ModelKit, kind: Shell155Kind, name: string): ProjectileModel {
  const g = new THREE.Group();
  const R = 0.0775;
  const copper = kit.steel(0xb8734a, { roughness: 0.32, metalness: 1.0 });
  // Geometría por tipo (m): culote, banda, inicio de ojiva, longitud sin espoleta.
  const spec = {
    M107: { L: 0.605, bt: 0.046, rb: 0.068, band: 0.058, ogS: 0.335, seat: 0.026, flat: false },
    M795: { L: 0.735, bt: 0.060, rb: 0.064, band: 0.072, ogS: 0.36, seat: 0.026, flat: false },
    M795BB: { L: 0.735, bt: 0.050, rb: 0.069, band: 0.096, ogS: 0.36, seat: 0.026, flat: false },
    M549: { L: 0.766, bt: 0.070, rb: 0.061, band: 0.078, ogS: 0.34, seat: 0.026, flat: false },
    M485: { L: 0.600, bt: 0.0, rb: 0.075, band: 0.050, ogS: 0.345, seat: 0.026, flat: true },
    M825: { L: 0.745, bt: 0.0, rb: 0.075, band: 0.052, ogS: 0.45, seat: 0.026, flat: true },
  }[kind];
  const L = spec.L;
  const bandW = 0.026;
  const bodyR = R - 0.0008; // el cuerpo es algo menor que el calibre (la banda fuerza)
  const prof: Profile = [];
  const yB = kind === 'M795BB' ? 0.042 : 0; // el generador BB ocupa el culote
  prof.push([0, yB]);
  prof.push([spec.rb, yB]);
  if (spec.bt > 0) prof.push([bodyR - 0.0015, yB + spec.bt]);
  else prof.push([bodyR - 0.002, yB + 0.004], [bodyR, yB + 0.008]);
  prof.push([bodyR, spec.band - 0.004]);
  // Asiento de la banda (rebaje) — la banda va como pieza aparte.
  prof.push([bodyR - 0.002, spec.band - 0.004], [bodyR - 0.002, spec.band + bandW + 0.004], [bodyR, spec.band + bandW + 0.004]);
  prof.push([bodyR, spec.ogS]);
  prof.push(...ogive(bodyR, spec.seat, spec.ogS, L - spec.ogS, 14).slice(1));
  prof.push([0, L]);

  // Pintura y rotulado por tipo.
  const isIllum = kind === 'M485', isSmoke = kind === 'M825';
  const base = isIllum ? C.white : isSmoke ? C.lightGreen : C.od;
  const ink = isIllum ? C.black : isSmoke ? C.lightRed : C.yellow;
  const label = kind === 'M795BB' ? 'M795' : kind === 'M549' ? 'M549A1' : kind === 'M485' ? 'M485A2' : kind === 'M825' ? 'M825A1' : kind;
  const fill = isIllum ? 'ILLUM' : isSmoke ? 'WP SMK' : kind === 'M107' ? 'COMP B' : 'TNT';
  const role = isIllum ? 'ILLUM' : isSmoke ? 'SMOKE' : 'HE';
  const zS0 = spec.band + bandW + 0.02, zS1 = spec.ogS + 0.01;
  const bodyMat = paint(kit, base);
  const stMat = stencil(kit, base, ink, ['155MM', `${label} ${role}`, fill, 'LOT ADY24G001-012'], bodyR, zS1 - zS0, { scale: 0.58 });
  const bandColor = isIllum || isSmoke ? C.brown : C.yellow;
  const bandMat = paint(kit, bandColor);
  const zones: Zone[] = [
    [-1, zS0, bodyMat],
    [zS0, zS1, stMat],
    [zS1, spec.ogS + 0.05, bodyMat],
    [spec.ogS + 0.05, spec.ogS + 0.075, bandMat],
  ];
  // Segunda banda: HE con motor/BB lleva además banda marrón.
  if (kind === 'M549' || kind === 'M795BB') {
    zones.push([spec.ogS + 0.075, spec.ogS + 0.085, bodyMat], [spec.ogS + 0.085, spec.ogS + 0.100, paint(kit, C.brown)], [spec.ogS + 0.100, L + 1e-6, bodyMat]);
  } else {
    zones.push([spec.ogS + 0.075, L + 1e-6, bodyMat]);
  }
  zoned(kit, g, prof, zones, 36);

  // Banda de forzamiento de cobre (con resalte y estrías de rayado grabadas).
  g.add(revolve(kit, [
    [bodyR - 0.002, spec.band - 0.004], [R + 0.0012, spec.band - 0.001], [R + 0.0016, spec.band + bandW * 0.45],
    [R + 0.0006, spec.band + bandW * 0.55], [R + 0.0012, spec.band + bandW], [bodyR - 0.002, spec.band + bandW + 0.004],
  ], copper, { segments: 36 }));
  // Obturador de nailon blanco tras la banda (M795/M549 modernos).
  if (kind !== 'M107' && !spec.flat) {
    g.add(revolve(kit, [[bodyR - 0.001, spec.band + bandW + 0.004], [bodyR + 0.0006, spec.band + bandW + 0.006], [bodyR + 0.0006, spec.band + bandW + 0.014], [bodyR - 0.001, spec.band + bandW + 0.016]], kit.polymer(0xd8d4c8), { segments: 32 }));
  }

  // Culote: generador base bleed, tobera RAP o tapón eyectable.
  const dark = kit.steel(0x2b2d2f, { roughness: 0.6 });
  if (kind === 'M795BB') {
    const bb = paint(kit, C.odDark, 0.7, 0.3);
    g.add(revolve(kit, [[0, 0.004], [0.052, 0.004], [0.06, 0.0], [0.066, 0.0], [0.066, 0.044], [0.069, 0.046]], bb, { segments: 32 }));
    g.add(revolve(kit, [[0.022, 0.0035], [0.022, 0.012], [0.0, 0.012]], dark, { segments: 20 }));
    g.add(revolve(kit, [[0.0, -0.0006], [0.034, -0.0006], [0.034, 0.0]], dark, { segments: 24 }));
  } else if (kind === 'M549') {
    g.add(revolve(kit, [[0.0, 0.03], [0.026, 0.03], [0.031, 0.0005], [0.0, 0.0005]], dark, { segments: 24 }));
    g.add(revolve(kit, [[0.031, 0.0006], [0.040, 0.0006], [0.040, 0.0]], kit.steel(0x8a8f93, { roughness: 0.4 }), { segments: 24 }));
  } else if (spec.flat) {
    // Tapón de culote con pasadores de cizalla y ranura.
    g.add(revolve(kit, [[0, -0.0008], [0.062, -0.0008], [0.062, 0.0]], kit.steel(0x6e7276, { roughness: 0.45 }), { segments: 32 }));
    for (let i = 0; i < 6; i++) {
      const a = (i * 60) * DEG;
      g.add(kit.cyl(0.004, 0.004, 0.0012, dark, { at: [Math.sin(a) * 0.05, -0.0012, Math.cos(a) * 0.05], segments: 8 }));
    }
  } else {
    g.add(revolve(kit, [[0, -0.0006], [0.045, -0.0006], [0.045, 0.0]], kit.steel(0x6e7276, { roughness: 0.45 }), { segments: 28 }));
  }
  // Espoleta.
  let fuzeL = 0.105;
  if (isIllum || isSmoke) { fuzeL = 0.112; fuzeM762(kit, g, spec.seat, L, fuzeL); }
  else fuzeM739(kit, g, spec.seat, L, fuzeL);
  g.name = name;
  const total = L + fuzeL;
  return finish(kit, g, total, 0.40, kind === 'M549' ? 0 : null);
}

// ============================================================================
//  M982 Excalibur: cuerpo esbelto, ojiva de guiado negra, 4 canards
//  desplegados y 8 aletas de planeo en una base giratoria.
// ============================================================================
function excalibur(kit: ModelKit): ProjectileModel {
  const g = new THREE.Group();
  const L = 1.0, R = 0.0773;
  const od = paint(kit, C.od);
  const black = paint(kit, '#202122', 0.5, 0.3);
  const yellowBand = paint(kit, C.yellow);
  const fins = kit.steel(0x6a6f72, { roughness: 0.45 });
  const copper = kit.steel(0xb8734a, { roughness: 0.32, metalness: 1.0 });
  const prof: Profile = [
    [0, 0], [0.060, 0], [0.066, 0.006], [0.066, 0.115], [0.072, 0.13], [R, 0.135],
    [R, 0.50], ...ogive(R, 0.012, 0.50, 0.49, 16).slice(1), [0.006, 0.995], [0, L],
  ];
  const st = stencil(kit, C.od, C.yellow, ['155MM', 'M982A1 HE', 'PBXN-9'], R, 0.16);
  zoned(kit, g, prof, [
    [-1, 0.20, od], [0.20, 0.36, st], [0.36, 0.43, od], [0.43, 0.452, yellowBand], [0.452, 0.60, od], [0.60, L + 1e-6, black],
  ], 36);
  // Banda obturadora deslizante (detrás del cuerpo principal).
  g.add(revolve(kit, [[R - 0.002, 0.15], [R + 0.0012, 0.153], [R + 0.0012, 0.172], [R - 0.002, 0.175]], copper, { segments: 36 }));
  // Base giratoria con 8 aletas de planeo desplegadas (barridas).
  g.add(revolve(kit, [[0.066, 0.0], [0.0675, 0.004], [0.0675, 0.10], [0.066, 0.104]], kit.steel(0x3a3d40, { roughness: 0.5 }), { segments: 32 }));
  planarFins(kit, g, 8, fins, { r0: 0.066, rootY0: 0.012, rootY1: 0.098, tipY0: 0.002, tipY1: 0.040, span: 0.062, t: 0.003, rollDeg: 22.5 });
  // Canards de guiado (4) desplegados tras la ojiva.
  planarFins(kit, g, 4, fins, { r0: 0.074, rootY0: 0.62, rootY1: 0.675, tipY0: 0.645, tipY1: 0.675, span: 0.055, t: 0.004, rollDeg: 45 });
  // Ranuras de salida de los canards y ventana de la antena GPS.
  for (let i = 0; i < 4; i++) {
    const hg = kit.group({ rotDeg: [0, 45 + i * 90, 0] });
    hg.add(kit.box(0.007, 0.07, 0.003, paint(kit, '#0c0c0c', 0.9, 0), { at: [0, 0.65, 0.0735] }));
    g.add(hg);
  }
  return finish(kit, g, L, 0.45, null);
}

// ============================================================================
//  3OF43 203 mm (2S7 Pion): gris con rotulado negro, dos bandas de cobre,
//  espoleta RGM-2.
// ============================================================================
function of43(kit: ModelKit): ProjectileModel {
  const g = new THREE.Group();
  const R = 0.1015, bodyR = R - 0.001, L = 0.88;
  const gray = paint(kit, C.sovGray, 0.55, 0.3);
  const copper = kit.steel(0xb8734a, { roughness: 0.32, metalness: 1.0 });
  const prof: Profile = [
    [0, 0], [0.086, 0], [bodyR - 0.002, 0.065],
    [bodyR, 0.075], [bodyR, 0.47], ...ogive(bodyR, 0.034, 0.47, L - 0.47, 16).slice(1), [0, L],
  ];
  const st = stencil(kit, C.sovGray, C.black, ['3ОФ43', '203', 'А-IX-20', '5-91-48'], bodyR, 0.22, { scale: 0.56 });
  const blackBand = paint(kit, '#1e1f1f');
  zoned(kit, g, prof, [[-1, 0.20, gray], [0.20, 0.42, st], [0.42, 0.50, gray], [0.50, 0.512, blackBand], [0.512, L + 1e-6, gray]], 40);
  for (const y of [0.088, 0.128]) {
    g.add(revolve(kit, [[bodyR - 0.001, y], [R + 0.0018, y + 0.003], [R + 0.0018, y + 0.019], [bodyR - 0.001, y + 0.022]], copper, { segments: 40 }));
  }
  g.add(revolve(kit, [[0, -0.0008], [0.07, -0.0008], [0.07, 0]], kit.steel(0x6e7276, { roughness: 0.45 }), { segments: 32 }));
  // Espoleta RGM-2 (ojiva de acero con anillo de reglaje).
  const steel = kit.steel(0x7f8386, { roughness: 0.38 });
  const fprof: Profile = [[0.034, L], ...ogive(0.034, 0.008, L + 0.004, 0.09, 10), [0, L + 0.096]];
  zoned(kit, g, fprof, [[L - 1, L + 0.03, kit.steel(0x4d5154, { roughness: 0.5 })], [L + 0.03, L + 0.2, steel]], 28);
  return finish(kit, g, L + 0.096, 0.42, null);
}

// ============================================================================
//  Bomba de mortero 120 mm (M934 HE / ILLUM / humo WP): cuerpo en lágrima,
//  banda obturadora, botalón con aletas M31, cargas M230 en herradura,
//  cartucho de ignición M981 y espoleta M734 (MOF).
// ============================================================================
function mortar120(kit: ModelKit, payload: 'he' | 'illum' | 'smoke'): ProjectileModel {
  const g = new THREE.Group();
  const R = 0.0595;
  // Ejes (m desde el extremo del botalón): botalón 0–0.20, cuerpo 0.18–0.60,
  // espoleta hasta 0.70.
  const boomR = 0.0215;
  const base = payload === 'illum' ? C.white : payload === 'smoke' ? C.lightGreen : C.od;
  const ink = payload === 'illum' ? C.black : payload === 'smoke' ? C.lightRed : C.yellow;
  const label = payload === 'illum' ? ['120MM', 'M930 ILLUM'] : payload === 'smoke' ? ['120MM', 'M929 WP SMK'] : ['120MM', 'M934A1 HE'];
  const body: Profile = [
    [boomR + 0.003, 0.17], [0.032, 0.185], [0.046, 0.215], [0.056, 0.26], [R, 0.33], [R, 0.37],
    [0.0585, 0.40], ...ogive(0.0585, 0.0245, 0.40, 0.205, 14).slice(1), [0, 0.605],
  ];
  const bodyMat = paint(kit, base);
  const st = stencil(kit, base, ink, label, R, 0.06, { scale: 0.6 });
  const band = payload === 'he' ? paint(kit, C.yellow) : payload === 'illum' ? paint(kit, C.brown) : paint(kit, C.yellow);
  zoned(kit, g, body, [
    [0, 0.268, bodyMat], [0.268, 0.33, st], [0.33, 0.37, bodyMat], [0.37, 0.39, kit.polymer(0x2a2b2a)],
    [0.39, 0.47, bodyMat], [0.47, 0.485, band], [0.485, 0.7, bodyMat],
  ], 36);
  // Banda obturadora de plástico en el diámetro máximo.
  g.add(revolve(kit, [[R - 0.001, 0.37], [R + 0.0008, 0.373], [R + 0.0008, 0.387], [R - 0.001, 0.39]], kit.polymer(0x1f2020), { segments: 36 }));
  // Botalón (tubo de la carga) con perforaciones y cartucho de ignición.
  const steel = kit.steel(0x7b8084, { roughness: 0.42 });
  const dark = kit.steel(0x2e3133, { roughness: 0.6 });
  g.add(revolve(kit, [[0, 0.0], [boomR, 0.0], [boomR, 0.18], [boomR + 0.003, 0.18]], steel, { segments: 24 }));
  for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) {
    const hg = kit.group({ rotDeg: [0, i * 60 + (r % 2) * 30, 0] });
    hg.add(kit.cyl(0.0032, 0.0032, 0.0012, kit.paint(0x0b0b0b, { roughness: 0.9, metalness: 0 }), { axis: 'z', at: [0, 0.065 + r * 0.022, boomR + 0.0001], segments: 8 }));
    g.add(hg);
  }
  g.add(kit.cyl(0.0105, 0.0105, 0.002, kit.brass(), { at: [0, -0.0005, 0], segments: 16 }));
  g.add(kit.cyl(0.0035, 0.0035, 0.002, dark, { at: [0, -0.0012, 0], segments: 10 }));
  // Aletas M31 (8) en el extremo del botalón.
  g.add(revolve(kit, [[boomR - 0.001, 0.0], [boomR + 0.004, 0.003], [boomR + 0.004, 0.058], [boomR - 0.001, 0.062]], steel, { segments: 24 }));
  planarFins(kit, g, 8, steel, { r0: boomR + 0.003, rootY0: 0.004, rootY1: 0.062, tipY0: 0.004, tipY1: 0.040, span: R - boomR - 0.004, t: 0.0018 });
  // Cargas M230 en herradura alrededor del botalón (4 incrementos).
  const charge = kit.polymer(0xc8b88a);
  for (let k = 0; k < 4; k++) {
    const y0 = 0.072 + k * 0.024, a0 = 20 + k * 40;
    g.add(revolve(kit, [[boomR, y0], [0.040, y0], [0.040, y0 + 0.019], [boomR, y0 + 0.019]], charge, {
      segments: 20, arcDeg: 320, arcStartDeg: a0, creaseDeg: 50,
    }));
    // Tapas de los extremos de la herradura.
    for (const a of [a0, a0 + 320]) {
      const hg = kit.group({ rotDeg: [0, a, 0] });
      hg.add(kit.box(0.0008, 0.019, 0.040 - boomR, charge, { at: [0, y0 + 0.0095, (0.040 + boomR) / 2] }));
      g.add(hg);
    }
  }
  // Espoleta M734 (MOF): cuerpo oliva oscuro con nariz de plástico negro.
  const fz = kit.paint(0x3a4030, { roughness: 0.6, metalness: 0.3 });
  const nose = kit.polymer(0x1a1a1a);
  const fprof: Profile = [[0.0245, 0.605], [0.0245, 0.63], ...ogive(0.0245, 0.006, 0.63, 0.068, 10), [0, 0.7]];
  zoned(kit, g, fprof, [[0.5, 0.64, fz], [0.64, 0.8, nose]], 28);
  return finish(kit, g, 0.70, 0.55, null);
}

// ============================================================================
//  Cohetes 227 mm (M26, M31 GMLRS, ER GMLRS) y misiles (ATACMS, PrSM)
// ============================================================================
type RocketKind = 'M26' | 'M31' | 'ER';

function rocket227(kit: ModelKit, kind: RocketKind): ProjectileModel {
  const g = new THREE.Group();
  const L = 3.94, R = 0.1135;
  const od = paint(kit, C.rocketOd, 0.6, 0.25);
  const noseLen = kind === 'ER' ? 0.78 : kind === 'M31' ? 0.62 : 0.52;
  const yN = L - noseLen;
  const tip = kind === 'M26' ? 0.03 : 0.012;
  const prof: Profile = [
    [0, 0.0], [0.082, 0.0], [0.098, 0.03], [R - 0.004, 0.05], [R, 0.06], [R, yN],
    ...ogive(R, tip, yN, noseLen - (kind === 'M26' ? 0.03 : 0.012), 16).slice(1),
    [0, L],
  ];
  const label = kind === 'M26' ? ['ROCKET HE DPICM', 'M26 227MM'] : kind === 'M31' ? ['ROCKET HE GUIDED', 'M31A1 GMLRS'] : ['ROCKET HE GUIDED', 'ER GMLRS XM403'];
  const st = stencil(kit, C.rocketOd, C.yellow, label, R, 0.30, { scale: 0.5 });
  const yellow = paint(kit, C.yellow);
  const brown = paint(kit, C.brown);
  const black = paint(kit, '#1d1e1e', 0.55, 0.3);
  zoned(kit, g, prof, [
    [-1, 0.9, od], [0.9, 0.93, brown], [0.93, yN - 0.75, od], [yN - 0.75, yN - 0.45, st],
    [yN - 0.45, yN - 0.10, od], [yN - 0.10, yN - 0.07, yellow], [yN - 0.07, L - (kind === 'M26' ? 0.09 : 0.22), od],
    [L - (kind === 'M26' ? 0.09 : 0.22), L + 1e-6, kind === 'M26' ? kit.steel(0x83888c, { roughness: 0.35 }) : black],
  ], 40);
  // Anillos de unión de secciones.
  for (const y of [0.42, yN - 0.02]) {
    g.add(revolve(kit, [[R - 0.0005, y], [R + 0.0018, y + 0.004], [R + 0.0018, y + 0.022], [R - 0.0005, y + 0.026]], kit.steel(0x4a4e51, { roughness: 0.5 }), { segments: 40 }));
  }
  // Tobera del motor.
  const nozzle = kit.steel(0x2a2b2c, { roughness: 0.55 });
  g.add(revolve(kit, [[0.068, -0.05], [0.072, -0.05], [0.064, 0.0], [0.05, 0.03], [0.045, 0.03]], nozzle, { segments: 32, creaseDeg: 60 }));
  g.add(revolve(kit, [[0.045, 0.03], [0.0, 0.03]], kit.paint(0x0a0a0a, { roughness: 0.9, metalness: 0 }), { segments: 24 }));
  // Aletas de cola.
  const finMat = kit.steel(0x50554f, { roughness: 0.5 });
  if (kind === 'ER') {
    planarFins(kit, g, 4, finMat, { r0: R, rootY0: 0.07, rootY1: 0.36, tipY0: 0.07, tipY1: 0.22, span: 0.17, t: 0.008, rollDeg: 45 });
  } else {
    // Collar de las aletas envolventes (gira libre sobre rodamientos).
    g.add(revolve(kit, [[R, 0.06], [R + 0.004, 0.065], [R + 0.004, 0.28], [R, 0.285]], kit.steel(0x3e423f, { roughness: 0.5 }), { segments: 40 }));
    wrapFins(kit, g, 4, finMat, R + 0.004, 0.075, 0.2, 0.004, 80);
  }
  // Canards de guiado del M31 (4) tras la ojiva.
  if (kind === 'M31') {
    planarFins(kit, g, 4, finMat, { r0: R, rootY0: yN - 0.30, rootY1: yN - 0.17, tipY0: yN - 0.24, tipY1: yN - 0.17, span: 0.085, t: 0.006, rollDeg: 45 });
  }
  return finish(kit, g, L, 0.48, -0.05);
}

function atacms(kit: ModelKit): ProjectileModel {
  const g = new THREE.Group();
  const L = 3.98, R = 0.305;
  const od = paint(kit, C.rocketOd, 0.58, 0.25);
  const noseLen = 1.05;
  const yN = L - noseLen;
  const prof: Profile = [
    [0, 0], [0.22, 0], [0.27, 0.06], [R, 0.12], [R, yN], ...ogive(R, 0.03, yN, noseLen - 0.02, 18).slice(1), [0.02, L - 0.004], [0, L],
  ];
  const st = stencil(kit, C.rocketOd, C.yellow, ['GUIDED MISSILE', 'MGM-140B ATACMS', 'HE'], R, 0.45, { scale: 0.5 });
  zoned(kit, g, prof, [
    [-1, 1.30, od], [1.30, 1.34, paint(kit, C.brown)], [1.34, yN - 0.6, od], [yN - 0.6, yN - 0.15, st], [yN - 0.15, yN - 0.06, od],
    [yN - 0.06, yN - 0.02, paint(kit, C.yellow)], [yN - 0.02, L - 0.25, od], [L - 0.25, L + 1e-6, paint(kit, '#2a2b2b', 0.5, 0.3)],
  ], 44);
  for (const y of [1.30 - 0.04, yN - 0.01]) {
    g.add(revolve(kit, [[R - 0.0005, y], [R + 0.003, y + 0.006], [R + 0.003, y + 0.03], [R - 0.0005, y + 0.036]], kit.steel(0x4a4e51, { roughness: 0.5 }), { segments: 44 }));
  }
  g.add(revolve(kit, [[0.17, -0.12], [0.18, -0.12], [0.16, 0.0], [0.12, 0.04], [0.11, 0.04]], kit.steel(0x2a2b2c, { roughness: 0.55 }), { segments: 36, creaseDeg: 60 }));
  g.add(revolve(kit, [[0.11, 0.04], [0, 0.04]], kit.paint(0x0a0a0a, { roughness: 0.9, metalness: 0 }), { segments: 28 }));
  // Cuatro aletas de control en flecha recortada.
  const finMat = kit.steel(0x4f544e, { roughness: 0.5 });
  planarFins(kit, g, 4, finMat, { r0: R, rootY0: 0.10, rootY1: 0.68, tipY0: 0.10, tipY1: 0.30, span: 0.30, t: 0.022, rollDeg: 45 });
  // Carenados de los actuadores en la raíz.
  for (let i = 0; i < 4; i++) {
    const hg = kit.group({ rotDeg: [0, 45 + i * 90, 0] });
    hg.add(kit.box(0.06, 0.62, 0.03, od, { at: [0, 0.40, R + 0.006] }));
    g.add(hg);
  }
  return finish(kit, g, L, 0.47, -0.12);
}

function prsm(kit: ModelKit): ProjectileModel {
  const g = new THREE.Group();
  const L = 3.96, R = 0.216;
  const body = paint(kit, C.prsm, 0.5, 0.2);
  const noseLen = 0.95;
  const yN = L - noseLen;
  const prof: Profile = [
    [0, 0], [0.15, 0], [0.19, 0.05], [R, 0.09], [R, yN], ...ogive(R, 0.014, yN, noseLen - 0.01, 18).slice(1), [0, L],
  ];
  const st = stencil(kit, C.prsm, C.black, ['PRECISION STRIKE MISSILE', 'PrSM INC 1', 'U.S. ARMY'], R, 0.40, { scale: 0.46 });
  zoned(kit, g, prof, [
    [-1, 1.10, body], [1.10, 1.13, paint(kit, C.brown)], [1.13, yN - 0.55, body], [yN - 0.55, yN - 0.15, st],
    [yN - 0.15, yN - 0.12, paint(kit, C.yellow)], [yN - 0.12, L - 0.30, body], [L - 0.30, L + 1e-6, paint(kit, '#2b2c2c', 0.45, 0.3)],
  ], 40);
  g.add(revolve(kit, [[0.12, -0.08], [0.13, -0.08], [0.115, 0.0], [0.09, 0.03], [0.08, 0.03]], kit.steel(0x2a2b2c, { roughness: 0.55 }), { segments: 32, creaseDeg: 60 }));
  g.add(revolve(kit, [[0.08, 0.03], [0, 0.03]], kit.paint(0x0a0a0a, { roughness: 0.9, metalness: 0 }), { segments: 24 }));
  // Cuatro aletas de control pequeñas en cola.
  planarFins(kit, g, 4, kit.steel(0x3f4346, { roughness: 0.45 }), { r0: R, rootY0: 0.06, rootY1: 0.40, tipY0: 0.10, tipY1: 0.24, span: 0.14, t: 0.012, rollDeg: 45 });
  // Canal de cables (raceway) a lo largo del cuerpo.
  g.add(kit.box(0.04, 1.9, 0.016, body, { at: [0, 1.4, R + 0.004] }));
  return finish(kit, g, L, 0.47, -0.08);
}

// ============================================================================
//  Balas: 9 mm FMJ, 5.56 M855/M856, 7.62 M80/M62, .50 M33/M17
// ============================================================================
function bullet(
  kit: ModelKit,
  s: { d: number; L: number; ogive: number; bt: number; btR: number; meplat: number; tip?: string; tipLen?: number; cannelure?: number; tracer?: boolean; round?: boolean },
): ProjectileModel {
  const g = new THREE.Group();
  const r = s.d / 2;
  const copper = kit.steel(0xc27a4c, { roughness: 0.28, metalness: 1.0 });
  const lead = kit.steel(0x6b6e72, { roughness: 0.5, metalness: 0.7 });
  const yO = s.L - s.ogive;
  const prof: Profile = [[0, 0], [s.btR, 0]];
  if (s.bt > 0) prof.push([r, s.bt]);
  else prof.push([r * 0.97, 0.0], [r, s.L * 0.03]);
  if (s.cannelure) {
    const c = s.cannelure;
    prof.push([r, c - s.L * 0.03], [r * 0.975, c - s.L * 0.015], [r * 0.975, c + s.L * 0.015], [r, c + s.L * 0.03]);
  }
  prof.push([r, yO]);
  prof.push(...ogive(r, s.meplat, yO, s.ogive, 12).slice(1));
  prof.push([0, s.L]);
  const zones: Zone[] = [[-1, s.L + 1e-6, copper]];
  if (s.tip) {
    zones[0] = [-1, s.L - (s.tipLen ?? s.L * 0.18), copper];
    zones.push([s.L - (s.tipLen ?? s.L * 0.18), s.L + 1e-6, paint(kit, s.tip, 0.5, 0.15)]);
  }
  zoned(kit, g, prof, zones, 20);
  // Culote: plomo visible (FMJ) o compuesto trazador.
  if (s.tracer) {
    g.add(kit.cyl(s.btR * 0.82, s.btR * 0.82, s.L * 0.01, kit.emissive(0xff6a1e, 3.0), { at: [0, -s.L * 0.004, 0], segments: 16 }));
  } else {
    g.add(kit.cyl(s.btR * 0.75, s.btR * 0.75, s.L * 0.006, lead, { at: [0, -s.L * 0.002, 0], segments: 16 }));
  }
  return finish(kit, g, s.L, 0.42, null);
}

// ============================================================================
//  API pública
// ============================================================================

/**
 * Construye el proyectil del arma `weaponId` para la munición vigente en
 * `weapon.round` (base bleed, RAP, ILLUM, humo… se deducen de sus
 * propiedades). `variant.tracer` elige la trazadora en armas ligeras.
 */
export function buildProjectile(kit: ModelKit, weaponId: WeaponId, weapon: Weapon, variant: ProjectileVariant = {}): ProjectileModel {
  const r = weapon.round;
  const tracer = variant.tracer ?? false;
  switch (weaponId) {
    case 'm777':
    case 'm109': {
      const n = r.name.toUpperCase();
      const kind: Shell155Kind =
        r.payload === 'illum' ? 'M485'
        : r.payload === 'smoke' ? 'M825'
        : r.baseBleed.enabled ? 'M795BB'
        : r.motor.enabled ? 'M549'
        : n.includes('M795') ? 'M795'
        : 'M107';
      return shell155(kit, kind, r.name);
    }
    case 'excalibur': return excalibur(kit);
    case 'pion2s7': return of43(kit);
    case 'mortar120': return mortar120(kit, r.payload);
    case 'm26': return rocket227(kit, 'M26');
    case 'gmlrs': return rocket227(kit, 'M31');
    case 'ergmlrs': return rocket227(kit, 'ER');
    case 'tacticalMissile': return atacms(kit);
    case 'prsm': return prsm(kit);
    case 'pistol9':
      return bullet(kit, { d: 0.00901, L: 0.0155, ogive: 0.0085, bt: 0, btR: 0.0043, meplat: 0.0012 });
    case 'rifle556':
      return bullet(kit, {
        d: 0.0057, L: 0.0232, ogive: 0.0128, bt: 0.0022, btR: 0.0024, meplat: 0.00035, cannelure: 0.0062,
        tip: tracer ? '#e2731f' : '#3f8a3a', tipLen: tracer ? 0.0055 : 0.0045, tracer,
      });
    case 'mg762':
      return bullet(kit, {
        d: 0.00782, L: 0.0287, ogive: 0.0158, bt: 0.0035, btR: 0.0032, meplat: 0.0004, cannelure: 0.0075,
        tip: tracer ? '#e2731f' : undefined, tipLen: 0.0065, tracer,
      });
    case 'm2browning':
      return bullet(kit, {
        d: 0.01295, L: 0.0580, ogive: 0.0300, bt: 0.0075, btR: 0.0050, meplat: 0.0008, cannelure: 0.017,
        tip: tracer ? '#c32a20' : undefined, tipLen: 0.010, tracer,
      });
  }
  // Fallback genérico (arma no catalogada).
  return shell155(kit, 'M107', r.name);
}

// ============================================================================
//  Instancias para el presentador (caché de prototipos)
// ============================================================================

/** Identifica el arma del catálogo a partir del objeto Weapon (sin id). */
export function weaponIdOf(weapon: Weapon): WeaponId {
  const ids = WeaponCatalog.ids();
  for (const id of ids) {
    if (catalogName(id) === weapon.name) return id;
  }
  // Heurística por propiedades (si el catálogo cambió de nombres).
  const r = weapon.round;
  const d = r.diameter;
  switch (weapon.category) {
    case 'SmallArms':
      return d < 0.0065 ? 'rifle556' : d < 0.0085 ? 'mg762' : d < 0.011 ? 'pistol9' : 'm2browning';
    case 'Mortar': return 'mortar120';
    case 'Howitzer':
      return d > 0.18 ? 'pion2s7' : r.guidance.enabled ? 'excalibur' : 'm777';
    case 'Rocket':
      return !r.guidance.enabled ? 'm26' : /ER/i.test(r.name) || /ER/i.test(weapon.name) ? 'ergmlrs' : 'gmlrs';
    case 'Missile':
      return d > 0.5 ? 'tacticalMissile' : 'prsm';
  }
  return 'm777';
}

const nameCache = new Map<WeaponId, string>();
function catalogName(id: WeaponId): string {
  let n = nameCache.get(id);
  if (n === undefined) {
    n = WeaponCatalog.get(id).name;
    nameCache.set(id, n);
  }
  return n;
}

let sharedKit: ModelKit | null = null;
const protoCache = new Map<string, ProjectileModel>();

/**
 * Proyectil listo para el presentador: clona un prototipo cacheado por
 * (arma, munición, trazadora). Las geometrías y texturas son COMPARTIDAS y
 * quedan "fijadas" (su dispose() no hace nada: viven lo que la app, son
 * pocas); los materiales se clonan por instancia para que quien los toque
 * (fundidos, opacidad) no afecte a los demás y su dispose() sea legítimo.
 */
export function instantiateProjectile(weapon: Weapon, variant: ProjectileVariant = {}): ProjectileModel {
  const id = weaponIdOf(weapon);
  const smallArm = weapon.category === 'SmallArms';
  const key = `${id}|${weapon.round.name}|${smallArm && variant.tracer ? 'T' : ''}`;
  let proto = protoCache.get(key);
  if (!proto) {
    sharedKit ??= new ModelKit();
    proto = buildProjectile(sharedKit, id, weapon, variant);
    proto.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose = () => { /* fijada en la caché */ };
    });
    protoCache.set(key, proto);
  }
  const root = proto.root.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) m.material = m.material.clone();
  });
  return { root, lengthM: proto.lengthM, exhaustLocal: proto.exhaustLocal?.clone() ?? null };
}

/**
 * Igual que instantiateProjectile pero ya envuelto con la NARIZ EN +Z (la
 * convención del ProjectilePresenter, que orienta +Z al vector velocidad).
 */
export function projectileMeshNoseZ(weapon: Weapon, variant: ProjectileVariant = {}): THREE.Group {
  const p = instantiateProjectile(weapon, variant);
  const wrap = new THREE.Group();
  wrap.name = 'projectile-noseZ';
  wrap.rotation.x = Math.PI / 2; // +Y (nariz) -> +Z
  wrap.add(p.root);
  return wrap;
}
