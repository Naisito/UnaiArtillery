// ============================================================================
//  parts/tracks.ts — Tren de rodaje de cadenas reutilizable.  [V2 · 3D-TRACKED]
//
//  Construye los DOS lados de un tren de rodaje completo en el espacio de
//  modelado de rig.ts (X derecha, Y adelante, Z arriba, suelo z = 0):
//    * rueda motriz con dos coronas dentadas y reductor final,
//    * rueda tensora (idler) dual,
//    * N ruedas de rodaje duales con bandaje de goma, plato embutido, buje y
//      tornillería, más brazos de suspensión hacia el casco,
//    * rodillos de retorno (simples, o solo sobre la mitad interior de la
//      cadena como en los chasis soviéticos),
//    * la CADENA: eslabones (zapata, bulones dobles, conectores laterales,
//      guía central y tacos de goma o garras de acero) colocados a paso
//      constante sobre la trayectoria real rueda motriz → rodillos →
//      tensora → ruedas, con flecha (catenaria aproximada) en el ramal
//      superior que se apoya en las ruedas si no hay rodillos (M109).
//  Toda la cadena de un lado sale FUSIONADA en 1-2 mallas.
//
//  Trayectoria: envolvente convexa de las circunferencias de apoyo (motriz,
//  tensora, ruedas y rodillos) muestreadas; los vanos largos del ramal
//  superior se combinan con una flecha S·sin²(πu) (tangente en los extremos)
//  acotada por debajo por las ruedas/rodillos. La línea calculada es la cara
//  INTERIOR de la cadena (la que pisa la rueda): la zapata crece hacia fuera.
// ============================================================================
import * as THREE from 'three';
import type { ModelKit } from '../kit';
import { boltCircle, latheCrisp, toothedRingGeometry } from './tracked-geo';

export type TrackStyle = 'bradley' | 'soviet';

export interface RunningGearSpec {
  /** Vía: distancia entre los centros de ambas cadenas (m). */
  tread: number;
  /** Anchura de la cadena (m). */
  trackWidth: number;
  /** Paso del eslabón (m). */
  pitch: number;
  /** Grosor de la zapata (sin tacos) (m). */
  shoeT: number;
  /** Altura de tacos de goma / garras exteriores (m). */
  padT: number;
  /** Hueco central entre los dos discos de cada rueda (paso de las guías). */
  guideGap: number;
  sprocket: { y: number; z: number; r: number; teeth: number };
  idler: { y: number; z: number; r: number };
  /** Ruedas de rodaje: posiciones Y (de atrás adelante o al revés), radio. */
  roadWheels: { ys: number[]; r: number };
  /**
   * Rodillos de retorno. Si se omite `z`, se colocan con su parte alta 1 cm
   * por encima de la tangente motriz–tensora (así la cadena se apoya).
   * `inner`: apoyan solo la mitad interior de la cadena (chasis soviéticos).
   */
  returnRollers?: { ys: number[]; r: number; z?: number; inner?: boolean; dual?: boolean };
  /** Flecha máxima de los vanos del ramal superior (m). */
  sag?: number;
  style: TrackStyle;
  /** Pintura del vehículo (platos de ruedas, bujes). */
  paint: THREE.Material;
  /** Semiancho del casco inferior: arranque de brazos y ejes (m). */
  hullHalfW: number;
}

export interface RunningGear {
  group: THREE.Group;
  /** Altura del centro de las ruedas de rodaje para que la cadena pise z = 0. */
  wheelZ: number;
  perimeterM: number;
  linkCount: number;
}

/** Altura del eje de una rueda de radio r para que la cadena apoye en z = 0. */
export function groundedWheelZ(spec: Pick<RunningGearSpec, 'shoeT' | 'padT'>, r: number): number {
  return r + spec.shoeT + spec.padT;
}

interface Circle { y: number; z: number; r: number; kind: 'sprocket' | 'idler' | 'road' | 'roller' }

// ---------------------------------------------------------------------------
//  Trayectoria de la cadena
// ---------------------------------------------------------------------------

/** Envolvente convexa (cadena monótona) de puntos 2D (y, z), CCW. */
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Polilínea cerrada (CCW en el plano y–z) de la cara interior de la cadena. */
function trackPath(circles: Circle[], sag: number): Array<[number, number]> {
  const samples: Array<[number, number]> = [];
  for (const c of circles) {
    const n = 72;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      samples.push([c.y + c.r * Math.cos(t), c.z + c.r * Math.sin(t)]);
    }
  }
  const hull = convexHull(samples);

  const roads = circles.filter((c) => c.kind === 'road').sort((a, b) => a.y - b.y);
  const tops = circles.filter((c) => c.kind === 'road' || c.kind === 'roller');
  const roadTop = Math.max(...roads.map((c) => c.z + c.r));
  const yMin = roads[0].y, yMax = roads[roads.length - 1].y;
  // Apoyo inferior del ramal superior: cima de ruedas/rodillos y, entre
  // ruedas consecutivas, la recta que une sus cimas con una leve flecha.
  const support = (y: number): number => {
    let s = -Infinity;
    for (const c of tops) {
      const dy = y - c.y;
      if (Math.abs(dy) < c.r) s = Math.max(s, c.z + Math.sqrt(c.r * c.r - dy * dy));
    }
    if (y > yMin && y < yMax) {
      for (let i = 0; i + 1 < roads.length; i++) {
        const a = roads[i], b = roads[i + 1];
        if (y >= a.y && y <= b.y) {
          const u = (y - a.y) / (b.y - a.y);
          const line = (a.z + a.r) * (1 - u) + (b.z + b.r) * u;
          const dip = 0.012 * (b.y - a.y) * Math.sin(Math.PI * u) ** 2;
          s = Math.max(s, line - dip);
        }
      }
    }
    return s;
  };

  const out: Array<[number, number]> = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    out.push(a);
    const dy = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dy, dz);
    const isTopSpan = len > 0.12 && dy < 0 && Math.abs(dz) / len < 0.5 && (a[1] + b[1]) / 2 > roadTop - 0.02;
    if (!isTopSpan || sag <= 0) continue;
    const S = Math.min(sag, 0.045 * len + (sag > 0.2 ? sag : 0));
    const k = Math.max(2, Math.ceil(len / 0.03));
    for (let j = 1; j < k; j++) {
      const u = j / k;
      const y = a[0] + dy * u;
      const zLine = a[1] + dz * u;
      const z = Math.max(zLine - S * Math.sin(Math.PI * u) ** 2, support(y));
      out.push([y, Math.min(z, zLine)]);
    }
  }
  return out;
}

/** Remuestrea una polilínea cerrada a paso constante: posiciones y tangentes. */
function resample(path: Array<[number, number]>, pitch: number): { pts: Array<[number, number]>; tan: Array<[number, number]>; L: number } {
  const n = path.length;
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = path[i], b = path[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = cum[n];
  const count = Math.max(8, Math.round(L / pitch));
  const step = L / count;
  const at = (s: number): [number, number] => {
    s = ((s % L) + L) % L;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const a = path[lo], b = path[(lo + 1) % n];
    const seg = cum[lo + 1] - cum[lo];
    const u = seg > 1e-12 ? (s - cum[lo]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const pts: Array<[number, number]> = [], tan: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const s = i * step;
    const p = at(s), p0 = at(s - step * 0.5), p1 = at(s + step * 0.5);
    let ty = p1[0] - p0[0], tz = p1[1] - p0[1];
    const l = Math.hypot(ty, tz) || 1;
    ty /= l; tz /= l;
    pts.push(p);
    tan.push([ty, tz]);
  }
  return { pts, tan, L };
}

// ---------------------------------------------------------------------------
//  Eslabón (plantilla en coordenadas locales: x a lo ancho, y a lo largo
//  de la cadena, z hacia FUERA; z = 0 es la cara interior que pisa la rueda)
// ---------------------------------------------------------------------------

interface LinkTemplate { steel: THREE.BufferGeometry; pad: THREE.BufferGeometry | null }

function linkTemplate(spec: RunningGearSpec): LinkTemplate {
  const W = spec.trackWidth, P = spec.pitch, T = spec.shoeT, H = spec.padT;
  const steel: THREE.BufferGeometry[] = [];
  const pad: THREE.BufferGeometry[] = [];
  const box = (w: number, d: number, h: number, x: number, y: number, z: number, list: THREE.BufferGeometry[]) => {
    const g = new THREE.BoxGeometry(w, d, h).toNonIndexed();
    g.translate(x, y, z);
    list.push(g);
  };
  const pin = (y: number, r: number, len: number, x = 0) => {
    const g = new THREE.CylinderGeometry(r, r, len, 6, 1, true).toNonIndexed();
    g.rotateZ(-Math.PI / 2);
    g.translate(x, y, T * 0.5);
    steel.push(g);
  };
  // Zapata: cuerpo central.
  box(W * 0.92, P * 0.72, T, 0, 0, T / 2, steel);
  // Alojamientos de bulón (doble bulón) en ambos extremos del eslabón.
  pin(-P * 0.34, T * 0.52, W * 0.9);
  pin(P * 0.34, T * 0.52, W * 0.9);
  // Conectores laterales (unen los bulones de eslabones contiguos).
  for (const s of [-1, 1]) {
    box(0.034, P * 0.42, T * 1.15, s * (W / 2 - 0.006), P * 0.5, T * 0.55, steel);
  }
  // Guía central (hacia dentro: pasa entre los discos de las ruedas).
  const gh = spec.style === 'soviet' ? 0.085 : 0.075;
  {
    const g = new THREE.BoxGeometry(spec.guideGap * 0.55, P * 0.42, gh).toNonIndexed();
    // Afilada hacia la punta: estrecha la cara interior.
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < 0) { pos.setX(i, pos.getX(i) * 0.55); pos.setY(i, pos.getY(i) * 0.7); }
    }
    g.translate(0, 0, -gh / 2 + 0.004);
    g.computeVertexNormals();
    steel.push(g);
  }
  if (spec.style === 'bradley') {
    // Tacos de goma atornillados (dos por zapata, uno a cada lado).
    for (const s of [-1, 1]) box(W * 0.41, P * 0.6, H, s * W * 0.235, 0, T + H / 2, pad);
  } else {
    // Garra de acero en V suave (dos barras inclinadas).
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(W * 0.46, P * 0.22, H).toNonIndexed();
      g.rotateZ(s * 0.18);
      g.translate(s * W * 0.22, 0, T + H / 2);
      steel.push(g);
    }
  }
  return { steel: concat(steel), pad: pad.length ? concat(pad) : null };
}

function concat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv');
    for (let i = 0; i < P.count; i++, o++) {
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], o * 3);
      nor.set([N.getX(i), N.getY(i), N.getZ(i)], o * 3);
      uv.set(U ? [U.getX(i), U.getY(i)] : [0, 0], o * 2);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** Replica la plantilla en cada muestra (x fijo) y fusiona en una geometría. */
function layLinks(tpl: THREE.BufferGeometry, x: number, pts: Array<[number, number]>, tan: Array<[number, number]>): THREE.BufferGeometry {
  const P = tpl.getAttribute('position').array as Float32Array;
  const N = tpl.getAttribute('normal').array as Float32Array;
  const U = tpl.getAttribute('uv').array as Float32Array;
  const nv = P.length / 3;
  const pos = new Float32Array(nv * 3 * pts.length);
  const nor = new Float32Array(nv * 3 * pts.length);
  const uv = new Float32Array(nv * 2 * pts.length);
  for (let k = 0; k < pts.length; k++) {
    const [py, pz] = pts[k];
    const [ty, tz] = tan[k];
    // Normal exterior (trayectoria CCW): giro horario de la tangente.
    const ny = tz, nz = -ty;
    // Base local {X, Y' = n × X, n}: Y' = (0, nz, −ny) (determinante +1).
    const yy = nz, yz = -ny;
    const ob = k * nv;
    for (let i = 0; i < nv; i++) {
      const lx = P[i * 3], ly = P[i * 3 + 1], lz = P[i * 3 + 2];
      const o = (ob + i) * 3;
      pos[o] = x + lx;
      pos[o + 1] = py + ly * yy + lz * ny;
      pos[o + 2] = pz + ly * yz + lz * nz;
      const mx = N[i * 3], my = N[i * 3 + 1], mz = N[i * 3 + 2];
      nor[o] = mx;
      nor[o + 1] = my * yy + mz * ny;
      nor[o + 2] = my * yz + mz * nz;
      uv[(ob + i) * 2] = U[i * 2] + k * 0.37;
      uv[(ob + i) * 2 + 1] = U[i * 2 + 1];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------
//  Ruedas
// ---------------------------------------------------------------------------

/** Refleja un perfil (r, a) → (r, −a) conservando el material a la izquierda. */
function mirror(p: Array<[number, number]>): Array<[number, number]> {
  return p.map(([r, a]) => [r, -a] as [number, number]).reverse();
}

/**
 * Rueda dual (dos discos con bandaje de goma y hueco central para la guía)
 * centrada en (cx, y, z). `side` = +1 lado derecho (cara vista hacia +X).
 */
function dualWheel(
  kit: ModelKit, parent: THREE.Object3D, spec: RunningGearSpec,
  cx: number, y: number, z: number, R: number, side: 1 | -1,
  opts: { steelTyre?: boolean; bolts?: number; style: TrackStyle; segments?: number },
): void {
  const seg = opts.segments ?? 22;
  const gap = spec.guideGap;
  const wd = (spec.trackWidth - gap) / 2 * 0.96;
  const steel = kit.steel(0x34363a, { roughness: 0.55 });
  const tyreMat = opts.steelTyre ? steel : kit.rubber();
  const rr = R * (opts.steelTyre ? 0.9 : 0.8);
  // Bandaje (goma o acero) de un disco centrado en a = 0. El del disco
  // interior (casi oculto) lleva menos tramos.
  const tyreOut: Array<[number, number]> = [
    [rr, -wd / 2], [R * 0.965, -wd / 2], [R, -wd * 0.38], [R, wd * 0.38], [R * 0.965, wd / 2], [rr, wd / 2],
  ];
  const tyreIn: Array<[number, number]> = [[rr, -wd / 2], [R, -wd * 0.4], [R, wd * 0.4], [rr, wd / 2]];
  // Disco exterior (cara vista en +a): plato embutido, buje y tapacubos.
  const soviet = opts.style === 'soviet';
  const dish = wd * (soviet ? 0.36 : 0.18);
  const outer: Array<[number, number]> = [
    [0, -wd * 0.3], [rr, -wd * 0.3],
    [rr, wd * 0.42], [rr - 0.02, wd * 0.5], [rr - 0.05, wd * 0.5],
    [R * (soviet ? 0.6 : 0.56), dish], [R * 0.3, dish], [R * 0.24, wd * 0.5],
    [R * 0.13, wd * 0.62], [0, wd * 0.62],
  ];
  const inner: Array<[number, number]> = [[0, -wd * 0.3], [rr, -wd * 0.3], [rr, wd * 0.45], [0, wd * 0.3]];
  const off = gap / 2 + wd / 2;
  for (const which of ['out', 'in'] as const) {
    const s = which === 'out' ? side : (-side as 1 | -1);
    const x = cx + s * off;
    const prof = which === 'out' ? outer : inner;
    const tyre = which === 'out' ? tyreOut : tyreIn;
    const p = s > 0 ? prof : mirror(prof);
    const t = s > 0 ? tyre : mirror(tyre);
    // Eje 'x': el perfil se define en (r, a) con a = +x local.
    parent.add(latheCrisp(kit, p, spec.paint, { axis: 'x', segments: seg, at: [x, y, z] }));
    parent.add(latheCrisp(kit, t, tyreMat, { axis: 'x', segments: seg, at: [x, y, z] }));
    if (which === 'out' && (opts.bolts ?? 0) > 0) {
      boltCircle(kit, parent, steel, {
        n: opts.bolts!, ring: R * 0.42, x: x + s * dish, side: s, y, z, r: 0.012, h: 0.014,
      });
    }
  }
  // Eje entre discos (visible por el hueco de la guía).
  parent.add(kit.cyl(R * 0.22, R * 0.22, gap + 0.02, steel, { axis: 'x', segments: 8, at: [cx, y, z], open: true }));
}

/** Rueda motriz: dos coronas dentadas, cubo con tornillería y reductor. */
function sprocketWheel(kit: ModelKit, parent: THREE.Object3D, spec: RunningGearSpec, cx: number, side: 1 | -1): void {
  const { y, z, r, teeth } = spec.sprocket;
  const steel = kit.steel(0x3a3b3d, { roughness: 0.5 });
  const ringW = 0.055;
  const gap = spec.guideGap;
  const rRoot = r - 0.012, rTip = r + spec.shoeT * 0.9;
  for (const s of [-1, 1] as const) {
    const x = cx + s * (gap / 2 + ringW / 2 + 0.01);
    const g = toothedRingGeometry(rRoot, rTip, teeth, ringW, r * 0.45);
    parent.add(kit.place(kit.mesh(g, steel), { at: [x, y, z] }));
  }
  // Cubo/plato (pintado) entre y por fuera de las coronas.
  const wOut = gap / 2 + ringW + 0.04;
  const hub: Array<[number, number]> = [
    [0, -wOut], [r * 0.82, -wOut], [r * 0.82, -gap / 2], [r * 0.62, -gap / 2 + 0.02],
    [r * 0.62, gap / 2 - 0.02], [r * 0.82, gap / 2], [r * 0.82, wOut - 0.02], [r * 0.78, wOut],
    [r * 0.45, wOut], [r * 0.4, wOut + 0.04], [r * 0.3, wOut + 0.07], [0, wOut + 0.07],
  ];
  const p = side > 0 ? hub : mirror(hub);
  parent.add(latheCrisp(kit, p, spec.paint, { axis: 'x', segments: 22, at: [cx, y, z] }));
  boltCircle(kit, parent, steel, { n: 8, ring: r * 0.6, x: cx + side * wOut, side, y, z, r: 0.012, h: 0.016 });
  boltCircle(kit, parent, steel, { n: 5, ring: r * 0.22, x: cx + side * (wOut + 0.07), side, y, z, r: 0.01, h: 0.012 });
  // Reductor final: carcasa entre el casco y la rueda.
  const xIn = side * spec.hullHalfW;
  const xHub = cx - side * wOut;
  const len = Math.abs(xHub - xIn);
  parent.add(kit.cyl(r * 0.55, r * 0.5, len, spec.paint, {
    axis: 'x', segments: 20, at: [(xIn + xHub) / 2, y, z],
  }));
}

// ---------------------------------------------------------------------------
//  Constructor público
// ---------------------------------------------------------------------------

export function buildRunningGear(kit: ModelKit, spec: RunningGearSpec): RunningGear {
  const group = kit.group({ name: 'running-gear' });
  const wheelZ = groundedWheelZ(spec, spec.roadWheels.r);
  const R = spec.roadWheels.r;

  const circles: Circle[] = [
    { ...spec.sprocket, kind: 'sprocket' },
    { ...spec.idler, kind: 'idler' },
    ...spec.roadWheels.ys.map((y) => ({ y, z: wheelZ, r: R, kind: 'road' as const })),
  ];
  const rollers = spec.returnRollers;
  const rollerZ: number[] = [];
  if (rollers) {
    // Tangente superior motriz–tensora (radios distintos): la cima de los
    // rodillos queda 1 cm por encima para que la cadena se apoye en ellos.
    const s = spec.sprocket, d = spec.idler;
    const topAt = (y: number) => {
      const u = (y - d.y) / (s.y - d.y);
      return (d.z + d.r) * (1 - u) + (s.z + s.r) * u;
    };
    for (const y of rollers.ys) {
      const z = rollers.z ?? topAt(y) - rollers.r + 0.01;
      rollerZ.push(z);
      circles.push({ y, z, r: rollers.r, kind: 'roller' });
    }
  }

  const path = trackPath(circles, spec.sag ?? 0.03);
  const { pts, tan, L } = resample(path, spec.pitch);
  const tpl = linkTemplate(spec);
  const trackSteel = kit.steel(0x3b3a37, { roughness: 0.78, metalness: 0.7 });

  for (const side of [-1, 1] as const) {
    const cx = side * spec.tread / 2;
    const sideG = kit.group({ name: side > 0 ? 'gear-R' : 'gear-L' });
    group.add(sideG);

    // Cadena (fusionada).
    sideG.add(kit.mesh(layLinks(tpl.steel, cx, pts, tan), trackSteel));
    if (tpl.pad) sideG.add(kit.mesh(layLinks(tpl.pad, cx, pts, tan), kit.rubber()));

    // Ruedas de rodaje + brazos de suspensión (pivote delante de la rueda).
    for (const y of spec.roadWheels.ys) {
      dualWheel(kit, sideG, spec, cx, y, wheelZ, R, side, { bolts: 6, style: spec.style, segments: 22 });
      const xIn = side * spec.hullHalfW;
      const xArm = cx - side * (spec.trackWidth / 2 - 0.02);
      const armL = R * 1.15;
      const arm = kit.box(Math.abs(xArm - xIn) + 0.04, armL, 0.09, spec.paint, {
        at: [(xIn + xArm) / 2, y + armL * 0.45, wheelZ + 0.07], rotDeg: [-18, 0, 0], bevel: 0.015,
      });
      sideG.add(arm);
    }
    // Tensora (dual) y su brazo de ajuste.
    dualWheel(kit, sideG, spec, cx, spec.idler.y, spec.idler.z, spec.idler.r, side, {
      bolts: 6, style: spec.style, segments: 22, steelTyre: spec.style === 'soviet',
    });
    // Motriz.
    sprocketWheel(kit, sideG, spec, cx, side);

    // Rodillos de retorno con su soporte desde el casco.
    if (rollers) {
      rollers.ys.forEach((y, i) => {
        const z = rollerZ[i];
        const rr = rollers.r;
        const dual = rollers.dual ?? false;
        const wOne = rollers.inner ? spec.trackWidth * 0.36 : (spec.trackWidth - spec.guideGap) / 2 * 0.85;
        const xs = rollers.inner
          ? [cx - side * (spec.guideGap / 2 + wOne / 2 + 0.01)]
          : dual
            ? [cx - spec.guideGap / 2 - wOne / 2 - 0.01, cx + spec.guideGap / 2 + wOne / 2 + 0.01]
            : [cx - side * (spec.guideGap / 2 + wOne / 2 + 0.01)];
        for (const x of xs) {
          const prof: Array<[number, number]> = [
            [0, -wOne / 2], [rr * 0.9, -wOne / 2], [rr, -wOne * 0.35], [rr, wOne * 0.35], [rr * 0.9, wOne / 2],
            [rr * 0.55, wOne / 2], [rr * 0.45, wOne / 2 + 0.02], [0, wOne / 2 + 0.02],
          ];
          const outward = x * side > cx * side ? side : side; // tapacubos siempre hacia fuera
          sideG.add(latheCrisp(kit, outward > 0 ? prof : mirror(prof), kit.rubber(), {
            axis: 'x', segments: 18, at: [x, y, z],
          }));
        }
        const xIn = side * spec.hullHalfW;
        const xEnd = Math.min(...xs.map((x) => x * side)) * side;
        sideG.add(kit.cyl(0.035, 0.035, Math.abs(xEnd - xIn) + 0.05, kit.steel(), {
          axis: 'x', segments: 10, at: [(xIn + xEnd) / 2, y, z],
        }));
      });
    }
  }
  tpl.steel.dispose();
  tpl.pad?.dispose();
  return { group, wheelZ, perimeterM: L, linkCount: pts.length };
}
