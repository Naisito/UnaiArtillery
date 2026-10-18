// ============================================================================
//  parts/trucks.ts — Piezas reutilizables de vehículos de ruedas.  [V2]
//  DUEÑO: agente 3D-WHEELED (ver docs/PLAN_V2.md).
//
//  Todo en el espacio de modelado de rig.ts (metros, X derecha, Y adelante,
//  Z arriba). Las piezas devuelven Mesh/Group ya colocados; los materiales
//  salen SIEMPRE de los presets del kit (paint/steel/rubber/glass/…) para
//  heredar la mejora PBR del dueño del kit.
//
//  Contenido:
//    * tireGeometry / buildWheel — neumático militar con tacos reales
//      (geometría única por rueda), llanta de disco con tornillería y cubo
//      con CTIS (inflado central), cara exterior configurable.
//    * ladderFrame / beamAxle / leafSpring — chasis de largueros, ejes
//      rígidos con diferencial y ballestas.
//    * fuelTank / stepLadder / mirror / lampRound / lampRect / mudflap /
//      jerrycan / whipAntenna / stowBox / grabHandle / boltRow — atrezo.
//    * hull / hullSym / cbox — sólidos facetados (envolvente convexa, caja
//      achaflanada barata) para blindajes y cabinas.
//    * consolidate — fusiona por material todas las mallas estáticas de un
//      sub-árbol (menos draw calls en Cesium; respeta los nodos articulados).
// ============================================================================
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAINT, type ModelKit, type PlaceOpts, type V3 } from '../kit';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
//  Geometría: normalización y fusión
// ---------------------------------------------------------------------------

/**
 * Copia "no indexada" con exactamente position/normal/uv (requisito de
 * mergeGeometries), opcionalmente transformada.
 */
export function normalizedGeometry(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    const n = g.getAttribute('position').count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

/** Fusiona geometrías (ya normalizadas o no) en una sola. */
export function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = geos.map((g) => normalizedGeometry(g));
  const merged = mergeGeometries(norm, false);
  for (const g of norm) g.dispose();
  return merged;
}

/**
 * Fusiona por material todas las mallas del sub-árbol `root` (horneando sus
 * transformaciones relativas a `root`). Los nodos de `keep` (y todo lo que
 * cuelga de ellos) se dejan intactos: ruedas que giran, pivotes articulados,
 * nodos animados. Los grupos que quedan vacíos se eliminan.
 */
export function consolidate(kit: ModelKit, root: THREE.Object3D, keep: THREE.Object3D[] = []): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const keepSet = new Set<THREE.Object3D>(keep);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  const rel = new THREE.Matrix4();

  const visit = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (keepSet.has(c)) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        rel.multiplyMatrices(inv, m.matrixWorld);
        const list = buckets.get(m.material) ?? [];
        list.push(normalizedGeometry(m.geometry, rel));
        buckets.set(m.material, list);
        victims.push(m);
      }
      visit(c);
    }
  };
  visit(root);
  if (victims.length < 2) {
    for (const list of buckets.values()) for (const g of list) g.dispose();
    return;
  }

  for (const v of victims) {
    v.parent?.remove(v);
    // Los hijos de una malla (raro) se re-cuelgan del padre: ya están horneados
    // si eran mallas; si eran nodos keep, se conservan con su transformación.
    v.geometry.dispose();
  }
  pruneEmpty(root, keepSet);

  for (const [mat, list] of buckets) {
    const geo = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    const mesh = kit.mesh(geo, mat);
    mesh.name = `${root.name || 'merged'}:${mat.name || 'mat'}`;
    root.add(mesh);
  }
}

// ---------------------------------------------------------------------------
//  Sólidos facetados (blindajes): envolvente convexa y caja achaflanada
// ---------------------------------------------------------------------------

/**
 * UV por proyección cúbica (1 m = 1 unidad): cada triángulo se proyecta en
 * el plano de su eje dominante. Para geometrías sin UV propias (envolventes).
 */
export function boxProjectUV(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    nrm.subVectors(c, b).cross(b.clone().sub(a)).set(Math.abs(nrm.x), Math.abs(nrm.y), Math.abs(nrm.z));
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number, v: number;
      if (nrm.x >= nrm.y && nrm.x >= nrm.z) { u = p.y; v = p.z; }
      else if (nrm.y >= nrm.z) { u = p.x; v = p.z; }
      else { u = p.x; v = p.y; }
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

export interface HullOpts extends PlaceOpts {
  /**
   * Ángulo de pliegue (grados): las aristas más suaves que esto se
   * sombrean redondeadas (techos, capós, lonas); 0/undefined = facetado.
   */
  smoothDeg?: number;
}

/** Envolvente convexa de los puntos dados (caras planas, sombreado facetado). */
export function hull(kit: ModelKit, mat: THREE.Material, pts: V3[], opts: HullOpts = {}): THREE.Mesh {
  let geo: THREE.BufferGeometry = new ConvexGeometry(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  boxProjectUV(geo);
  if (opts.smoothDeg) {
    const sm = toCreasedNormals(geo, opts.smoothDeg * DEG);
    if (sm !== geo) geo.dispose();
    geo = sm;
  }
  return kit.place(kit.mesh(geo, mat), opts);
}

/** Envolvente convexa simétrica en X: `half` lleva los puntos con x ≥ 0. */
export function hullSym(kit: ModelKit, mat: THREE.Material, half: V3[], opts: HullOpts = {}): THREE.Mesh {
  const pts: V3[] = [];
  for (const [x, y, z] of half) {
    pts.push([x, y, z]);
    if (Math.abs(x) > 1e-6) pts.push([-x, y, z]);
  }
  return hull(kit, mat, pts, opts);
}

/**
 * Anillo de puntos de un rectángulo redondeado en planta (para envolventes
 * de cabinas con esquinas verticales redondeadas): centro (cx, cy), semi-
 * anchos (hx, hy), radio r, cota z, `n` puntos por esquina.
 */
export function roundRectRing(cx: number, cy: number, hx: number, hy: number, r: number, z: number, n = 3): V3[] {
  const out: V3[] = [];
  const rr = Math.min(r, hx - 1e-3, hy - 1e-3);
  const corners: Array<[number, number, number]> = [
    [cx + hx - rr, cy + hy - rr, 0], [cx - hx + rr, cy + hy - rr, 90],
    [cx - hx + rr, cy - hy + rr, 180], [cx + hx - rr, cy - hy + rr, 270],
  ];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = (a0 + (90 * i) / n) * DEG;
      out.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr, z]);
    }
  }
  return out;
}

/**
 * Prisma a lo largo de Y: sección `section` = [[x, z], …] (polígono
 * cerrado) extruida de y0 a y1. Con `smoothDeg` las aristas de la sección
 * más suaves que ese ángulo se sombrean redondeadas (capós, lonas).
 */
export function prismY(
  kit: ModelKit, mat: THREE.Material, section: Array<[number, number]>, y0: number, y1: number,
  opts: HullOpts = {},
): THREE.Mesh {
  const shape = new THREE.Shape(section.map(([x, z]) => new THREE.Vector2(x, z)));
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: Math.abs(y1 - y0), bevelEnabled: false });
  // (u, v, w) → (x = u, y = y1 − w, z = v): determinante +1, no invierte caras.
  geo.applyMatrix4(new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, -1, Math.max(y0, y1),
    0, 1, 0, 0,
    0, 0, 0, 1,
  ));
  geo.computeVertexNormals();
  if (opts.smoothDeg) {
    const sm = toCreasedNormals(geo, opts.smoothDeg * DEG);
    if (sm !== geo) geo.dispose();
    geo = sm;
  }
  return kit.place(kit.mesh(geo, mat), opts);
}

/**
 * Caja con aristas achaflanadas a 45° (≈ 68 triángulos frente a los ~300 de
 * una RoundedBox): los chaflanes planos recogen la luz como en un blindaje.
 */
export function cbox(
  kit: ModelKit, mat: THREE.Material, w: number, d: number, h: number, c: number, opts: PlaceOpts = {},
): THREE.Mesh {
  const k = Math.max(1e-4, Math.min(c, w / 2 - 1e-4, d / 2 - 1e-4, h / 2 - 1e-4));
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x = (sx * w) / 2, y = (sy * d) / 2, z = (sz * h) / 2;
    pts.push([x - sx * k, y, z], [x, y - sy * k, z], [x, y, z - sz * k]);
  }
  return hull(kit, mat, pts, opts);
}

function pruneEmpty(o: THREE.Object3D, keep: Set<THREE.Object3D>): void {
  for (const c of [...o.children]) {
    if (keep.has(c)) continue;
    pruneEmpty(c, keep);
    if (!(c as THREE.Mesh).isMesh && c.children.length === 0) o.remove(c);
  }
}

// ---------------------------------------------------------------------------
//  Neumáticos y ruedas
// ---------------------------------------------------------------------------

export type TreadPattern =
  /** Michelin XZL/XML (FMTV, HIMARS): tacos grandes en chevron alterno. */
  | 'xzl'
  /** OI-25 / ID-P284 (Ural): espiga direccional de tacos largos. */
  | 'ural'
  /** KI-80 (BTR-80/82): espiga cerrada que cruza el centro. */
  | 'btr';

export interface TireSpec {
  /** Radio exterior (sobre tacos), m. */
  radius: number;
  /** Ancho de sección, m. */
  width: number;
  /** Radio de la llanta (asiento del talón), m. */
  rimRadius: number;
  tread?: TreadPattern;
  /** Tacos por fila (defecto: paso ~0.16 m). */
  lugs?: number;
}

/**
 * Neumático completo (carcasa + tacos) en una sola geometría, eje X,
 * centrado en el eje de la rueda.
 */
export function tireGeometry(spec: TireSpec): THREE.BufferGeometry {
  const R = spec.radius;
  const W = spec.width;
  const rr = spec.rimRadius;
  const hw = W / 2;
  const depth = Math.min(0.034, R * 0.058);
  const rb = R - depth; // radio de la base de la banda
  const sw = rb - rr;   // altura de flanco

  // Perfil (radio, eje) de talón a talón: flanco abombado, hombro redondeado.
  const half: Array<[number, number]> = [
    [rr - 0.012, -hw * 0.8],
    [rr + sw * 0.18, -hw * 0.98],
    [rr + sw * 0.5, -hw * 1.03],
    [rr + sw * 0.82, -hw * 0.99],
    [rb - 0.02, -hw * 0.92],
    [rb, -hw * 0.78],
  ];
  const prof = [...half, ...half.slice().reverse().map(([r, a]) => [r, -a] as [number, number])];
  const carcass = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), 36);
  carcass.rotateZ(-Math.PI / 2); // eje +Y → +X
  const parts: THREE.BufferGeometry[] = [carcass];

  const pattern = spec.tread ?? 'xzl';
  const n = spec.lugs ?? Math.max(16, Math.round((2 * Math.PI * R) / 0.16));
  const pitch = (2 * Math.PI * R) / n;
  const lug = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const addLug = (theta: number, x: number, w: number, l: number, angDeg: number, d = depth): void => {
    const box = new THREE.BoxGeometry(w, l, d + 0.01);
    lug.makeRotationX(theta)
      .multiply(tmp.makeTranslation(x, 0, rb + d / 2 - 0.005))
      .multiply(tmp.makeRotationZ(angDeg * DEG));
    box.applyMatrix4(lug);
    parts.push(box);
  };

  for (let i = 0; i < n; i++) {
    const th = (i * 2 * Math.PI) / n;
    const thHalf = th + Math.PI / n;
    if (pattern === 'xzl') {
      // Tacos de hombro largos y alternos + bloque central partido.
      addLug(th, -W * 0.27, W * 0.44, pitch * 0.5, 24);
      addLug(thHalf, W * 0.27, W * 0.44, pitch * 0.5, -24);
      // Taco de hombro que envuelve el flanco (lectura de perfil).
      addLug(th, -hw * 0.96, W * 0.08, pitch * 0.45, 0, depth * 0.8);
      addLug(thHalf, hw * 0.96, W * 0.08, pitch * 0.45, 0, depth * 0.8);
    } else if (pattern === 'ural') {
      // Espiga direccional: dos tacos inclinados que casi se tocan.
      addLug(th, -W * 0.24, W * 0.5, pitch * 0.42, 34);
      addLug(th, W * 0.24, W * 0.5, pitch * 0.42, -34);
    } else {
      // KI-80: chevron continuo que cruza el centro, más bajo.
      addLug(th, -W * 0.22, W * 0.52, pitch * 0.4, 40, depth * 0.85);
      addLug(th, W * 0.22, W * 0.52, pitch * 0.4, -40, depth * 0.85);
      addLug(thHalf, 0, W * 0.16, pitch * 0.35, 0, depth * 0.7);
    }
  }
  const merged = mergeAll(parts);
  for (const p of parts) p.dispose();
  return merged;
}

export type RimStyle =
  /** FMTV: llanta de dos piezas 20" con aro de pernos y 10 tuercas. */
  | 'fmtv'
  /** Ural: disco con aro de cierre, 8 tuercas y grandes orificios. */
  | 'ural'
  /** BTR: disco plano con 10 tuercas y gran tapa del inflado. */
  | 'btr';

export interface WheelSpec extends TireSpec {
  /** +1: la cara exterior mira a +X (lado derecho); −1: a −X. */
  side: 1 | -1;
  style?: RimStyle;
  rimColor?: number;
  /** Cubo con junta rotativa y manguera del inflado central. */
  ctis?: boolean;
  at?: V3;
  name?: string;
  /** Fusiona las mallas internas por material (defecto true). */
  merge?: boolean;
}

/**
 * Rueda completa centrada en su eje (eje X local). Devuelve un grupo SIN
 * rotación propia (el runtime puede girarlo en X libremente); la cara
 * exterior se orienta con un sub-grupo interno girado 180° en Z si side = −1
 * (nada de escalas negativas).
 */
export function buildWheel(kit: ModelKit, spec: WheelSpec): THREE.Group {
  const wheel = kit.group({ at: spec.at, name: spec.name ?? 'wheel' });
  const body = kit.group({ name: 'wheel-body' });
  if (spec.side < 0) body.rotation.z = Math.PI;
  wheel.add(body);

  const W = spec.width, rr = spec.rimRadius;
  const style = spec.style ?? 'fmtv';
  const rimMat = kit.paint(spec.rimColor ?? PAINT.carcGreen, { metalness: 0.35, roughness: 0.6, wear: 0.45 });
  const dark = kit.paint(0x1a1c17, { roughness: 0.9, metalness: 0.1 });
  const steel = kit.steel(0x50524f, { roughness: 0.5 });

  body.add(kit.mesh(tireGeometry(spec), kit.rubber()));

  // Barril de la llanta (visto por dentro) y pestaña interior.
  body.add(kit.cyl(rr, rr, W * 0.84, rimMat, { axis: 'x', open: true, segments: 28 }));
  body.add(kit.lathe([[rr - 0.004, -W * 0.435], [rr + 0.02, -W * 0.43], [rr + 0.02, -W * 0.36]], rimMat,
    { axis: 'x', segments: 24 }));

  // Pestaña exterior + disco embutido en un solo perfil de revolución
  // (cara hacia +X: radios decrecientes ⇒ normales hacia fuera).
  const discX = style === 'btr' ? W * 0.3 : W * 0.22;
  const hubR = rr * 0.34;
  body.add(kit.lathe([
    [rr + 0.022, W * 0.36],
    [rr + 0.022, W * 0.43],
    [rr - 0.004, W * 0.435],
    [rr * 0.97, W * 0.4],
    [rr * 0.88, W * 0.37],
    [rr * 0.8, discX + 0.012],
    [rr * 0.74, discX],
    [hubR, discX],
    [hubR * 0.98, discX - 0.01],
  ], rimMat, { axis: 'x', segments: 32 }));

  // Orificios de manejo (discos oscuros enrasados) y tuercas.
  const holes = style === 'ural' ? 8 : style === 'fmtv' ? 6 : 0;
  for (let i = 0; i < holes; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / holes;
    const r = rr * 0.56;
    const hr = style === 'ural' ? rr * 0.15 : rr * 0.1;
    body.add(kit.cyl(hr, hr, 0.006, dark, {
      axis: 'x', at: [discX + 0.003, Math.cos(a) * r, Math.sin(a) * r], segments: 10,
    }));
  }
  const nuts = style === 'ural' ? 8 : 10;
  const nutCircle = hubR * 1.25;
  for (let i = 0; i < nuts; i++) {
    const a = (i * 2 * Math.PI) / nuts;
    body.add(kit.cyl(0.017, 0.015, 0.035, steel, {
      axis: 'x', at: [discX + 0.015, Math.cos(a) * nutCircle, Math.sin(a) * nutCircle], segments: 6,
    }));
  }
  if (style === 'fmtv' || style === 'ural') {
    // Aro de pernos de la llanta partida (lectura típica de rueda militar).
    const ring = style === 'fmtv' ? 18 : 12;
    const rRing = rr * 0.9;
    for (let i = 0; i < ring; i++) {
      const a = (i * 2 * Math.PI) / ring;
      body.add(kit.cyl(0.012, 0.012, 0.024, steel, {
        axis: 'x', at: [W * 0.38, Math.cos(a) * rRing, Math.sin(a) * rRing], segments: 5,
      }));
    }
  }

  // Cubo + tapa (+ CTIS: junta rotativa y manguera hasta la válvula).
  const hubLen = style === 'btr' ? 0.07 : 0.11;
  body.add(kit.cyl(hubR * 0.95, hubR * 0.78, hubLen, rimMat, {
    axis: 'x', at: [discX + hubLen / 2, 0, 0], segments: 20,
  }));
  const capX = discX + hubLen;
  body.add(kit.cyl(hubR * 0.55, hubR * 0.45, 0.04, steel, { axis: 'x', at: [capX + 0.02, 0, 0], segments: 16 }));
  if (spec.ctis ?? true) {
    body.add(kit.cyl(0.028, 0.028, 0.05, dark, { axis: 'x', at: [capX + 0.06, 0, 0], segments: 10 }));
    const vR = rr * 0.8;
    body.add(kit.tube([
      [capX + 0.07, 0, 0.02],
      [capX + 0.05, 0, 0.09],
      [discX + 0.05, 0.02, vR * 0.6],
      [discX + 0.02, 0.03, vR],
    ], 0.009, dark, { segments: 8 }));
  }

  if (spec.merge ?? true) consolidate(kit, body);
  return wheel;
}

// ---------------------------------------------------------------------------
//  Chasis
// ---------------------------------------------------------------------------

export interface FrameOpts {
  yFront: number;
  yRear: number;
  /** Distancia entre las caras exteriores de los largueros. */
  width: number;
  /** Cota de la cara superior de los largueros. */
  zTop: number;
  railH?: number;
  railW?: number;
  /** Posiciones Y de los travesaños. */
  cross?: number[];
}

/** Chasis de largueros en C con travesaños. */
export function ladderFrame(kit: ModelKit, mat: THREE.Material, o: FrameOpts): THREE.Group {
  const g = kit.group({ name: 'frame' });
  const h = o.railH ?? 0.28;
  const t = o.railW ?? 0.08;
  const len = o.yFront - o.yRear;
  const yc = (o.yFront + o.yRear) / 2;
  const zc = o.zTop - h / 2;
  for (const s of [-1, 1]) {
    const x = s * (o.width / 2 - t / 2);
    // Alma + alas (C abierta hacia dentro).
    g.add(kit.box(0.012, len, h, mat, { at: [x + s * (t / 2 - 0.006), yc, zc] }));
    g.add(kit.box(t, len, 0.014, mat, { at: [x, yc, o.zTop - 0.007] }));
    g.add(kit.box(t, len, 0.014, mat, { at: [x, yc, o.zTop - h + 0.007] }));
  }
  for (const y of o.cross ?? []) {
    g.add(kit.box(o.width - 2 * t, 0.09, h * 0.7, mat, { at: [0, y, zc] }));
  }
  return g;
}

export interface AxleOpts {
  y: number;
  /** Cota del eje de ruedas. */
  z: number;
  /** Vía (centro a centro de neumáticos). */
  track: number;
  /** Desplazamiento lateral del diferencial (defecto 0). */
  diffX?: number;
  diffR?: number;
  /** Eje delantero direccional (dibuja manguetas y barra de dirección). */
  steer?: boolean;
}

/** Eje rígido con puente, diferencial y manguetas. */
export function beamAxle(kit: ModelKit, mat: THREE.Material, o: AxleOpts): THREE.Group {
  const g = kit.group({ name: 'axle', at: [0, o.y, o.z] });
  const half = o.track / 2 - 0.2;
  const dr = o.diffR ?? 0.2;
  const dx = o.diffX ?? 0;
  g.add(kit.cyl(0.075, 0.075, half * 2, mat, { axis: 'x', segments: 14 }));
  // "Calabaza" del diferencial (revolución sobre Y) + tapa trasera.
  g.add(kit.lathe([
    [0.0, -dr * 0.95],
    [dr * 0.55, -dr * 0.9],
    [dr * 0.95, -dr * 0.45],
    [dr, 0.0],
    [dr * 0.8, dr * 0.55],
    [0.09, dr * 1.05],
    [0.07, dr * 1.4],
    [0.0, dr * 1.4],
  ], mat, { axis: 'y', at: [dx, 0, 0], segments: 18 }));
  for (const s of [-1, 1]) {
    // Carcasa de buje/reductora.
    g.add(kit.cyl(0.13, 0.15, 0.16, mat, { axis: 'x', at: [s * (half + 0.03), 0, 0], segments: 16 }));
    if (o.steer) {
      g.add(kit.cyl(0.05, 0.05, 0.3, mat, { axis: 'z', at: [s * (half - 0.04), 0, 0], segments: 10 }));
    }
  }
  if (o.steer) {
    g.add(kit.cyl(0.025, 0.025, half * 2 - 0.1, mat, { axis: 'x', at: [0, -0.22, -0.05], segments: 8 }));
  }
  return g;
}

/** Ballesta de hojas (arco hacia arriba), a lo largo de Y. */
export function leafSpring(
  kit: ModelKit, mat: THREE.Material,
  o: { at: V3; len: number; leaves?: number; arch?: number; width?: number; thick?: number },
): THREE.Group {
  const g = kit.group({ name: 'leaf-spring', at: o.at });
  const leaves = o.leaves ?? 6;
  const arch = o.arch ?? 0.06;
  const t = o.thick ?? 0.018;
  for (let k = 0; k < leaves; k++) {
    const L = o.len * (1 - k * (0.75 / leaves));
    const up: Array<[number, number]> = [];
    const lo: Array<[number, number]> = [];
    for (let i = 0; i <= 8; i++) {
      const u = -1 + (2 * i) / 8;
      const y = (u * L) / 2;
      const z = arch * (1 - ((y * 2) / o.len) ** 2) - k * t;
      up.push([y, z]);
      lo.push([y, z - t * 0.92]);
    }
    g.add(kit.extrudeSide([...up, ...lo.reverse()], o.width ?? 0.09, mat));
  }
  // Abarcones (U-bolts) en el centro.
  for (const s of [-1, 1]) {
    g.add(kit.box(0.02, 0.025, leaves * t + 0.06, mat, {
      at: [s * ((o.width ?? 0.09) / 2 + 0.012), 0, arch - (leaves * t) / 2],
    }));
  }
  return g;
}

/** Árbol de transmisión con crucetas. */
export function propShaft(kit: ModelKit, mat: THREE.Material, from: V3, to: V3, r = 0.045): THREE.Group {
  const g = kit.group({ name: 'propshaft' });
  g.add(kit.tube([from, to], r, mat, { segments: 2 }));
  for (const p of [from, to]) g.add(kit.sphere(r * 1.6, mat, { at: p, segments: 10 }));
  return g;
}

// ---------------------------------------------------------------------------
//  Atrezo de carrocería
// ---------------------------------------------------------------------------

/** Depósito de combustible en D (eje Y) con flejes y tapón. */
export function fuelTank(
  kit: ModelKit, mat: THREE.Material, strapMat: THREE.Material,
  o: { at: V3; len: number; w: number; h: number; side: 1 | -1 },
): THREE.Group {
  const g = kit.group({ name: 'fuel-tank', at: o.at });
  g.add(kit.box(o.w, o.len, o.h, mat, { bevel: Math.min(o.w, o.h) * 0.28 }));
  for (const f of [-0.32, 0.32]) {
    g.add(kit.box(o.w + 0.016, 0.05, o.h + 0.016, strapMat, { at: [0, f * o.len, 0], bevel: 0.006 }));
  }
  g.add(kit.cyl(0.05, 0.05, 0.05, strapMat, { axis: 'z', at: [o.side * o.w * 0.2, o.len * 0.12, o.h / 2 + 0.02], segments: 12 }));
  return g;
}

/** Escalerilla de 2-3 peldaños de rejilla con soportes laterales. */
export function stepLadder(
  kit: ModelKit, mat: THREE.Material,
  o: { at: V3; w: number; steps: number; rise: number; depth?: number },
): THREE.Group {
  const g = kit.group({ name: 'steps', at: o.at });
  const d = o.depth ?? 0.2;
  for (let i = 0; i < o.steps; i++) {
    const z = -i * o.rise;
    g.add(kit.box(d, o.w, 0.025, mat, { at: [0, 0, z] }));
    // Barras antideslizantes.
    for (let b = -2; b <= 2; b++) {
      g.add(kit.box(0.012, o.w * 0.94, 0.012, mat, { at: [(b * d) / 5.5, 0, z + 0.018] }));
    }
  }
  for (const s of [-1, 1]) {
    g.add(kit.box(d * 0.9, 0.02, o.rise * (o.steps - 1) + 0.1, mat, {
      at: [0, (s * o.w) / 2, (-o.rise * (o.steps - 1)) / 2],
    }));
  }
  return g;
}

/** Retrovisor de camión: brazo tubular + cabeza con cristal (mira a −Y). */
export function mirror(
  kit: ModelKit, armMat: THREE.Material, headMat: THREE.Material,
  o: { base: V3; head: V3; w?: number; h?: number },
): THREE.Group {
  const g = kit.group({ name: 'mirror' });
  const [bx, by, bz] = o.base;
  const [hx, hy, hz] = o.head;
  const w = o.w ?? 0.2, h = o.h ?? 0.36;
  g.add(kit.tube([
    [bx, by, bz + h * 0.4], [hx * 0.97 + bx * 0.03, (by + hy) / 2, hz + h * 0.42], [hx, hy, hz + h * 0.42],
  ], 0.014, armMat));
  g.add(kit.tube([
    [bx, by, bz - h * 0.3], [hx * 0.97 + bx * 0.03, (by + hy) / 2, hz - h * 0.42], [hx, hy, hz - h * 0.42],
  ], 0.014, armMat));
  g.add(kit.box(w, 0.06, h, headMat, { at: [hx, hy + 0.01, hz], bevel: 0.015 }));
  g.add(kit.box(w * 0.86, 0.006, h * 0.88, kit.glass(), { at: [hx, hy - 0.022, hz] }));
  return g;
}

/** Faro redondo con cuerpo, aro cromado y lente (mira a +Y por defecto). */
export function lampRound(
  kit: ModelKit, bodyMat: THREE.Material,
  o: { at: V3; r: number; depth?: number; rotDeg?: V3; lens?: THREE.Material },
): THREE.Group {
  const g = kit.group({ name: 'lamp', at: o.at, rotDeg: o.rotDeg });
  const d = o.depth ?? o.r * 0.9;
  g.add(kit.cyl(o.r * 0.8, o.r * 1.05, d, bodyMat, { at: [0, -d / 2, 0], segments: 18 }));
  g.add(kit.lathe([[o.r * 1.1, -0.01], [o.r * 1.1, 0.012], [o.r * 0.9, 0.016]],
    kit.steel(0xb8bcbf, { roughness: 0.25 }), { segments: 18 }));
  // Domo de la lente: de fuera a dentro (normales hacia +Y).
  g.add(kit.lathe([[o.r * 0.95, -0.002], [o.r * 0.7, 0.012], [0, o.r * 0.18]], o.lens ?? lensMat(kit), { segments: 18 }));
  return g;
}

/** Piloto rectangular (cuerpo + lente), mira a ±Y según rotDeg. */
export function lampRect(
  kit: ModelKit, bodyMat: THREE.Material, lens: THREE.Material,
  o: { at: V3; w: number; h: number; rotDeg?: V3 },
): THREE.Group {
  const g = kit.group({ name: 'lamp-rect', at: o.at, rotDeg: o.rotDeg });
  g.add(kit.box(o.w + 0.03, 0.06, o.h + 0.03, bodyMat, { at: [0, -0.03, 0], bevel: 0.008 }));
  g.add(kit.box(o.w, 0.012, o.h, lens, { at: [0, 0.004, 0], bevel: 0.003 }));
  return g;
}

/** Lente clara de faro (vidrio con reflector). */
export function lensMat(kit: ModelKit): THREE.MeshStandardMaterial {
  return kit.steel(0xdfe4e6, { roughness: 0.12, metalness: 0.6 });
}

/** Faldón de goma colgado (plano XZ, espesor en Y). */
export function mudflap(kit: ModelKit, o: { at: V3; w: number; h: number }): THREE.Mesh {
  return kit.box(o.w, 0.012, o.h, kit.rubber(), { at: o.at });
}

/** Bidón OTAN de 20 l (eje largo Z), con asas y relieve en X. */
export function jerrycan(kit: ModelKit, mat: THREE.Material, o: { at: V3; rotDeg?: V3 }): THREE.Group {
  const g = kit.group({ name: 'jerrycan', at: o.at, rotDeg: o.rotDeg });
  g.add(kit.box(0.165, 0.345, 0.47, mat, { bevel: 0.02 }));
  // Relieve en X (dos diagonales por cara, se leen a distancia).
  for (const s of [-1, 1]) {
    for (const a of [-1, 1]) {
      g.add(kit.box(0.006, 0.36, 0.022, mat, { at: [s * 0.084, 0, 0], rotDeg: [a * 52, 0, 0] }));
    }
  }
  for (const y of [-0.1, 0, 0.1]) g.add(kit.box(0.03, 0.025, 0.05, mat, { at: [0, y, 0.255] }));
  g.add(kit.cyl(0.022, 0.022, 0.04, mat, { axis: 'z', at: [0, 0.13, 0.25], segments: 10 }));
  return g;
}

/** Antena de látigo con base y muelle; `bendDeg` la inclina hacia −Y. */
export function whipAntenna(
  kit: ModelKit, o: { at: V3; len: number; bendDeg?: number },
): THREE.Group {
  const g = kit.group({ name: 'antenna', at: o.at });
  const base = kit.paint(0x2a2c25, { roughness: 0.8 });
  const whip = kit.polymer(0x2b2b28);
  g.add(kit.cyl(0.05, 0.04, 0.08, base, { axis: 'z', at: [0, 0, 0.04], segments: 12 }));
  g.add(kit.cyl(0.018, 0.018, 0.16, kit.steel(), { axis: 'z', at: [0, 0, 0.16], segments: 8 }));
  const b = (o.bendDeg ?? 0) * DEG;
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const s = (i / 6) * o.len;
    const a = b * (i / 6) ** 1.5;
    pts.push([0, -Math.sin(a) * s * 0.6, 0.24 + Math.cos(a * 0.6) * s]);
  }
  g.add(kit.tube(pts, 0.006, whip, { segments: 18 }));
  return g;
}

/** Caja de estiba con tapa, bisagras y cierres (frente hacia ±X). */
export function stowBox(
  kit: ModelKit, mat: THREE.Material, hw: THREE.Material,
  o: { at: V3; w: number; d: number; h: number; side: 1 | -1 },
): THREE.Group {
  const g = kit.group({ name: 'stow-box', at: o.at });
  g.add(kit.box(o.w, o.d, o.h, mat, { bevel: 0.012 }));
  const fx = (o.side * o.w) / 2;
  // Junta de tapa y cierres de palanca.
  g.add(kit.box(0.01, o.d * 0.98, 0.012, hw, { at: [fx, 0, o.h * 0.3] }));
  for (const f of [-0.3, 0.3]) {
    g.add(kit.box(0.025, 0.05, 0.08, hw, { at: [fx + o.side * 0.012, f * o.d, o.h * 0.2], bevel: 0.004 }));
  }
  return g;
}

/** Asidero tubular entre dos puntos (separado de la chapa). */
export function grabHandle(kit: ModelKit, mat: THREE.Material, a: V3, b: V3, standoff: V3, r = 0.013): THREE.Mesh {
  const mid = (i: number, f: number) => a[i] + (b[i] - a[i]) * f;
  return kit.tube([
    a,
    [mid(0, 0.08) + standoff[0], mid(1, 0.08) + standoff[1], mid(2, 0.08) + standoff[2]],
    [mid(0, 0.92) + standoff[0], mid(1, 0.92) + standoff[1], mid(2, 0.92) + standoff[2]],
    b,
  ], r, mat, { segments: 14 });
}

/** Fila de tornillos/remaches (cabezas cilíndricas) de `a` a `b`, eje `axis`. */
export function boltRow(
  kit: ModelKit, mat: THREE.Material, a: V3, b: V3, n: number,
  axis: 'x' | 'y' | 'z', r = 0.012, h = 0.012,
): THREE.Group {
  const g = kit.group({ name: 'bolts' });
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    g.add(kit.cyl(r, r * 0.85, h, mat, {
      axis, segments: 6,
      at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
    }));
  }
  return g;
}

/** Polígono de un arco (y, z) de centro c y radio r entre a0 y a1 (grados). */
export function arcPts(cy: number, cz: number, r: number, a0: number, a1: number, n = 10): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    out.push([cy + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Guardabarros en arco (banda curva extruida en X) sobre una rueda de
 * centro (cy, cz): de `a0` a `a1` grados, radio interior `r`, espesor `t`.
 */
export function fenderArc(
  kit: ModelKit, mat: THREE.Material,
  o: { x: number; cy: number; cz: number; r: number; t: number; w: number; a0?: number; a1?: number },
): THREE.Mesh {
  const a0 = o.a0 ?? 10, a1 = o.a1 ?? 170;
  const outer = arcPts(o.cy, o.cz, o.r + o.t, a0, a1, 14);
  const inner = arcPts(o.cy, o.cz, o.r, a1, a0, 14);
  return kit.extrudeSide([...outer, ...inner], o.w, mat, { at: [o.x, 0, 0] });
}

/** Total de triángulos de un sub-árbol (para informes y tests). */
export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(tris);
}
