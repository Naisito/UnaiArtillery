// ============================================================================
//  parts/small-util.ts — Utilidades de modelado del agente 3D-SMALL.  [V2]
//
//  Complementan a ModelKit (no lo sustituyen) con lo que las armas ligeras y
//  los proyectiles necesitan y el kit no da:
//    * revolve(): sólido de revolución con ARISTAS VIVAS donde el perfil
//      quiebra (LatheGeometry suaviza todas las juntas: un zuncho o una banda
//      de forzamiento salen "derretidos"),
//    * sideShape(): silueta lateral extruida CON AGUJEROS (guardamontes,
//      asas, horquillas),
//    * mergeStatic(): fusión por material de las mallas estáticas de un nodo
//      (decenas de piezas -> un puñado de draw calls; Cesium lo agradece),
//    * picatinny(): raíl MIL-STD-1913 con sus ranuras,
//    * hexBolt(), knob(): tornillería y pomos,
//    * stencilMaterial(): material con rotulado estarcido (texto pintado en un
//      CanvasTexture; sin DOM se degrada a color liso),
//    * beltAlong(): cinta de cartuchos eslabonados siguiendo una curva.
//
//  Mismo espacio que rig.ts: metros, X derecha, Y adelante, Z arriba.
// ============================================================================
import * as THREE from 'three';
import type { Axis, ModelKit, PlaceOpts, V3 } from '../kit';

/** Perfil de revolución: [[radio, posiciónEnEje], …] de − a + del eje. */
export type Profile = Array<[number, number]>;

export interface RevolveOpts extends PlaceOpts {
  axis?: Axis;
  segments?: number;
  /** Quiebro del perfil (grados) a partir del cual la junta es arista viva. */
  creaseDeg?: number;
  /** Arco barrido (grados); 360 por defecto. */
  arcDeg?: number;
  /** Inicio del arco (grados, desde +Z hacia +X). */
  arcStartDeg?: number;
}

const DEG = Math.PI / 180;

/**
 * Geometría de revolución alrededor de +Y con normales partidas en los
 * quiebros del perfil (convención de LatheGeometry: x = r·sinφ, z = r·cosφ,
 * u crece con φ, v con la longitud de arco del perfil).
 */
export function revolveGeometry(
  profile: Profile,
  segments = 32,
  creaseDeg = 35,
  arcDeg = 360,
  arcStartDeg = 0,
): THREE.BufferGeometry {
  // Segmentos válidos del perfil (descarta los nulos y los que yacen en el eje).
  type Seg = { r0: number; y0: number; r1: number; y1: number; nr: number; ny: number; s0: number; s1: number };
  const segs: Seg[] = [];
  let total = 0;
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, y0] = profile[k];
    const [r1, y1] = profile[k + 1];
    const dr = r1 - r0, dy = y1 - y0;
    const len = Math.hypot(dr, dy);
    if (len < 1e-9 || (r0 < 1e-9 && r1 < 1e-9)) continue;
    segs.push({ r0: Math.max(0, r0), y0, r1: Math.max(0, r1), y1, nr: dy / len, ny: -dr / len, s0: total, s1: total + len });
    total += len;
  }
  const cosCrease = Math.cos(creaseDeg * DEG);
  const ring = segments + 1;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const phi0 = arcStartDeg * DEG, dphi = (arcDeg * DEG) / segments;

  segs.forEach((s, m) => {
    // Normal en cada extremo: media con el vecino si la junta es suave.
    const endN = (other: Seg | undefined): [number, number] => {
      if (!other) return [s.nr, s.ny];
      const dot = other.nr * s.nr + other.ny * s.ny;
      if (dot < cosCrease) return [s.nr, s.ny];
      const a = s.nr + other.nr, b = s.ny + other.ny;
      const l = Math.hypot(a, b) || 1;
      return [a / l, b / l];
    };
    const prev = m > 0 && segs[m - 1].s1 === s.s0 ? segs[m - 1] : undefined;
    const next = m + 1 < segs.length && segs[m + 1].s0 === s.s1 ? segs[m + 1] : undefined;
    const ends: Array<[number, number, number, [number, number]]> = [
      [s.r0, s.y0, s.s0, endN(prev)],
      [s.r1, s.y1, s.s1, endN(next)],
    ];
    const base = pos.length / 3;
    for (const [r, y, sv, [nr, ny]] of ends) {
      for (let i = 0; i <= segments; i++) {
        const phi = phi0 + i * dphi;
        const sn = Math.sin(phi), cs = Math.cos(phi);
        pos.push(r * sn, y, r * cs);
        nor.push(nr * sn, ny, nr * cs);
        uv.push(i / segments, total > 0 ? sv / total : 0);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i, b = base + i + 1, c = base + ring + i + 1, d = base + ring + i;
      idx.push(a, b, d, c, d, b);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** Reorienta una geometría axial en +Y al eje pedido (como kit.ts). */
export function orientAxis(geo: THREE.BufferGeometry, axis: Axis): void {
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  else if (axis === 'x') geo.rotateZ(-Math.PI / 2);
}

/** Sólido de revolución con aristas vivas, colocado según PlaceOpts. */
export function revolve(kit: ModelKit, profile: Profile, mat: THREE.Material, opts: RevolveOpts = {}): THREE.Mesh {
  const geo = revolveGeometry(profile, opts.segments ?? 32, opts.creaseDeg ?? 35, opts.arcDeg ?? 360, opts.arcStartDeg ?? 0);
  orientAxis(geo, opts.axis ?? 'y');
  return kit.place(kit.mesh(geo, mat), opts);
}

/**
 * Silueta LATERAL (plano Y-Z) con agujeros, extruida simétrica en X con
 * anchura `width` (como kit.extrudeSide, pero admite huecos).
 */
export function sideShape(
  kit: ModelKit,
  outer: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
  width: number,
  mat: THREE.Material,
  opts: PlaceOpts & { bevel?: number; curveSegments?: number } = {},
): THREE.Mesh {
  const shape = new THREE.Shape(outer.map(([y, z]) => new THREE.Vector2(y, z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([y, z]) => new THREE.Vector2(y, z))));
  const bevel = opts.bevel ?? 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, width - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: opts.curveSegments ?? 8,
  });
  const d = width - 2 * bevel;
  // (u, v, w) -> (x = w − d/2, y = u, z = v): permutación cíclica (det +1).
  geo.applyMatrix4(new THREE.Matrix4().set(
    0, 0, 1, -d / 2,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ));
  geo.computeVertexNormals();
  return kit.place(kit.mesh(geo, mat), opts);
}

/**
 * Planta (plano X-Y) extruida en Z con agujeros, desde z = 0 local.
 */
export function planShape(
  kit: ModelKit,
  outer: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
  height: number,
  mat: THREE.Material,
  opts: PlaceOpts & { bevel?: number; curveSegments?: number } = {},
): THREE.Mesh {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const bevel = opts.bevel ?? 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, height - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: opts.curveSegments ?? 8,
  });
  if (bevel > 0) geo.translate(0, 0, bevel);
  geo.computeVertexNormals();
  return kit.place(kit.mesh(geo, mat), opts);
}

/** Puntos de un arco (centro cy,cz; radio; ángulos en grados) en el plano Y-Z. */
export function arcPts(cy: number, cz: number, r: number, a0: number, a1: number, n = 8): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    out.push([cy + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return out;
}

/** Rectángulo de esquinas redondeadas (polígono) centrado en (cy, cz). */
export function roundRect(cy: number, cz: number, w: number, h: number, r: number, n = 3): Array<[number, number]> {
  const rr = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5);
  const hw = w / 2 - rr, hh = h / 2 - rr;
  return [
    ...arcPts(cy + hw, cz - hh, rr, -90, 0, n),
    ...arcPts(cy + hw, cz + hh, rr, 0, 90, n),
    ...arcPts(cy - hw, cz + hh, rr, 90, 180, n),
    ...arcPts(cy - hw, cz - hh, rr, 180, 270, n),
  ];
}

// ---------------------------------------------------------------------------
//  Fusión por material
// ---------------------------------------------------------------------------

/**
 * Hornea y fusiona POR MATERIAL todas las mallas que cuelgan de `node` sin
 * pasar por un nodo de `keep` (pivotes articulados: se fusionan aparte). Las
 * mallas resultantes quedan como hijas directas de `node` con transformación
 * identidad. Los grupos vacíos que quedan se podan.
 */
export function mergeStatic(kit: ModelKit, node: THREE.Object3D, keep: Iterable<THREE.Object3D> = []): void {
  const keepSet = new Set(keep);
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  const rel = new THREE.Matrix4();

  const visit = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (keepSet.has(c)) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && !m.userData.noMerge) {
        const g = m.geometry.clone();
        rel.multiplyMatrices(inv, m.matrixWorld);
        g.applyMatrix4(rel);
        const list = buckets.get(m.material) ?? [];
        list.push(g);
        buckets.set(m.material, list);
        victims.push(m);
      }
      visit(c);
    }
  };
  visit(node);
  for (const v of victims) {
    // Hijos de una malla fusionada (raro): súbelos al padre conservando pose.
    for (const ch of [...v.children]) {
      if (victims.includes(ch as THREE.Mesh)) continue;
      v.parent?.attach(ch);
    }
    v.parent?.remove(v);
    v.geometry.dispose();
  }
  prune(node, keepSet);
  for (const [mat, geos] of buckets) {
    const merged = concatGeometries(geos);
    geos.forEach((g) => g.dispose());
    node.add(kit.mesh(merged, mat));
  }
}

function prune(o: THREE.Object3D, keep: Set<THREE.Object3D>): void {
  for (const c of [...o.children]) {
    if (keep.has(c)) continue;
    prune(c, keep);
    if (c.children.length === 0 && !(c as THREE.Mesh).isMesh && c.type === 'Group') o.remove(c);
  }
}

/** Concatena geometrías (posición/normal/uv; indexadas o no) en una sola. */
export function concatGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    nv += n;
    ni += g.index ? g.index.count : n;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, nrm = g.attributes.normal, t = g.attributes.uv;
    const n = p.count;
    for (let i = 0; i < n; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = nrm.getX(i); nor[(vo + i) * 3 + 1] = nrm.getY(i); nor[(vo + i) * 3 + 2] = nrm.getZ(i);
      if (t) { uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i); }
    }
    if (g.index) {
      const gi = g.index;
      for (let k = 0; k < gi.count; k++) idx[io + k] = gi.getX(k) + vo;
      io += gi.count;
    } else {
      for (let k = 0; k < n; k++) idx[io + k] = k + vo;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
//  Caja achaflanada de bajo coste (44 triángulos frente a los 300 de
//  RoundedBoxGeometry): chaflán plano de un segmento, normales planas —
//  aspecto de pieza mecanizada y presupuesto de polígonos bajo control.
// ---------------------------------------------------------------------------

export function chamferBoxGeometry(w: number, d: number, h: number, c: number): THREE.BufferGeometry {
  const hx = w / 2, hy = d / 2, hz = h / 2;
  const cc = Math.max(0, Math.min(c, hx - 1e-5, hy - 1e-5, hz - 1e-5));
  // Tres vértices por esquina: sobre la cara X, la cara Y y la cara Z.
  const V = (sx: number, sy: number, sz: number, f: 0 | 1 | 2): THREE.Vector3 => new THREE.Vector3(
    sx * (f === 0 ? hx : hx - cc), sy * (f === 1 ? hy : hy - cc), sz * (f === 2 ? hz : hz - cc));
  const tris: THREE.Vector3[][] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c2: THREE.Vector3, d2: THREE.Vector3) => { tris.push([a, b, c2], [a, c2, d2]); };
  const S = [-1, 1];
  // Caras principales.
  for (const s of S) {
    quad(V(s, -1, -1, 0), V(s, 1, -1, 0), V(s, 1, 1, 0), V(s, -1, 1, 0));
    quad(V(-1, s, -1, 1), V(1, s, -1, 1), V(1, s, 1, 1), V(-1, s, 1, 1));
    quad(V(-1, -1, s, 2), V(1, -1, s, 2), V(1, 1, s, 2), V(-1, 1, s, 2));
  }
  // Chaflanes de arista (12) y triángulos de esquina (8).
  for (const a of S) for (const b of S) {
    quad(V(-1, a, b, 1), V(1, a, b, 1), V(1, a, b, 2), V(-1, a, b, 2)); // aristas paralelas a X
    quad(V(a, -1, b, 0), V(a, 1, b, 0), V(a, 1, b, 2), V(a, -1, b, 2)); // paralelas a Y
    quad(V(a, b, -1, 0), V(a, b, 1, 0), V(a, b, 1, 1), V(a, b, -1, 1)); // paralelas a Z
  }
  for (const sx of S) for (const sy of S) for (const sz of S) tris.push([V(sx, sy, sz, 0), V(sx, sy, sz, 1), V(sx, sy, sz, 2)]);
  const pos: number[] = [], uv: number[] = [];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cen = new THREE.Vector3();
  for (const t of tris) {
    e1.subVectors(t[1], t[0]);
    e2.subVectors(t[2], t[0]);
    n.crossVectors(e1, e2);
    cen.copy(t[0]).add(t[1]).add(t[2]);
    if (n.lengthSq() < 1e-20) continue;
    const ordered = n.dot(cen) >= 0 ? t : [t[0], t[2], t[1]]; // sólido convexo centrado: normal hacia fuera
    const an = n.dot(cen) >= 0 ? n : n.clone().negate();
    const ax = Math.abs(an.x), ay = Math.abs(an.y), az = Math.abs(an.z);
    for (const p of ordered) {
      pos.push(p.x, p.y, p.z);
      if (ax >= ay && ax >= az) uv.push(p.y, p.z);
      else if (ay >= az) uv.push(p.x, p.z);
      else uv.push(p.x, p.y);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Caja w×d×h (como kit.box) con chaflán barato si `bevel` > 0. */
export function sbox(kit: ModelKit, w: number, d: number, h: number, mat: THREE.Material, opts: PlaceOpts & { bevel?: number } = {}): THREE.Mesh {
  if (!opts.bevel) return kit.box(w, d, h, mat, opts);
  return kit.place(kit.mesh(chamferBoxGeometry(w, d, h, opts.bevel), mat), opts);
}

// ---------------------------------------------------------------------------
//  Piezas pequeñas reutilizables
// ---------------------------------------------------------------------------

/**
 * Raíl Picatinny (MIL-STD-1913) a lo largo de Y, de longitud `len`, con la
 * base en z = 0 local del grupo devuelto (cresta a ~9.5 mm). Paso 10 mm.
 */
export function picatinny(kit: ModelKit, len: number, mat: THREE.Material, opts: PlaceOpts & { up?: Axis | '-x' | '-z' } = {}): THREE.Group {
  const g = kit.group(opts);
  g.add(kit.box(0.0156, len, 0.0045, mat, { at: [0, 0, 0.00225] }));
  const n = Math.max(1, Math.floor((len - 0.002) / 0.01));
  const y0 = -((n - 1) * 0.01) / 2;
  for (let i = 0; i < n; i++) {
    g.add(kit.box(0.0212, 0.0048, 0.0042, mat, { at: [0, y0 + i * 0.01, 0.0066] }));
  }
  // Pestaña de cola de milano continua bajo los dientes (se ve en las ranuras).
  g.add(kit.box(0.0185, len, 0.0016, mat, { at: [0, 0, 0.0049] }));
  return g;
}

/** Cabeza de tornillo hexagonal (eje `axis`), centrada en `at`. */
export function hexBolt(kit: ModelKit, r: number, h: number, mat: THREE.Material, opts: PlaceOpts & { axis?: Axis } = {}): THREE.Mesh {
  return kit.cyl(r, r, h, mat, { ...opts, segments: 6, axis: opts.axis ?? 'z' });
}

/** Pomo de apriete moleteado (cilindro + toro), eje `axis`. */
export function knob(kit: ModelKit, r: number, h: number, mat: THREE.Material, opts: PlaceOpts & { axis?: Axis } = {}): THREE.Group {
  const g = kit.group(opts);
  const axis = opts.axis ?? 'z';
  g.add(kit.cyl(r, r, h, mat, { axis, segments: 14 }));
  g.add(kit.torus(r * 0.92, h * 0.18, mat, { axis, segments: 14 }));
  return g;
}

// ---------------------------------------------------------------------------
//  Rotulado estarcido (texturas de canvas)
// ---------------------------------------------------------------------------

export interface StencilSpec {
  /** Color de fondo (pintura base) CSS. */
  bg: string;
  /** Color de la tinta CSS. */
  ink: string;
  /** Líneas de texto (de arriba a abajo = hacia la nariz arriba). */
  lines: string[];
  /** Repeticiones alrededor de la circunferencia (2 = a ambos lados). */
  repeat?: number;
  /** Altura relativa del texto (0..1 del alto de la textura por línea). */
  scale?: number;
  /** Fuente CSS (sin tamaño). */
  font?: string;
  /** Desgaste: motas más claras/oscuras sobre la pintura (0..1). */
  grime?: number;
}

/**
 * Material con rotulado pintado (texto horizontal alrededor de la
 * circunferencia de un cilindro con UV de `revolve`). Sin DOM (tests en
 * node) devuelve el color liso. Se registra en el kit para dispose().
 */
export function stencilMaterial(
  kit: ModelKit,
  spec: StencilSpec,
  mat: { roughness?: number; metalness?: number } = {},
  px: [number, number] = [1024, 256],
): THREE.MeshStandardMaterial {
  const base = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.bg),
    roughness: mat.roughness ?? 0.6,
    metalness: mat.metalness ?? 0.3,
  });
  kit.own(base);
  if (typeof document === 'undefined') return base;
  const cv = document.createElement('canvas');
  cv.width = px[0];
  cv.height = px[1];
  const ctx = cv.getContext('2d');
  if (!ctx) return base;
  ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, cv.width, cv.height);
  // Desgaste sutil: motas deterministas (sin Math.random: mismo look siempre).
  const grime = spec.grime ?? 0.35;
  if (grime > 0) {
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900 * grime; i++) {
      const x = rnd() * cv.width, y = rnd() * cv.height, r = 0.6 + rnd() * 2.2;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const rep = spec.repeat ?? 2;
  const n = spec.lines.length;
  const lh = (cv.height / Math.max(n, 1)) * (spec.scale ?? 0.62);
  ctx.fillStyle = spec.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(lh)}px ${spec.font ?? "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif"}`;
  for (let k = 0; k < rep; k++) {
    const cx = ((k + 0.5) / rep) * cv.width;
    spec.lines.forEach((line, i) => {
      // v crece hacia +Y (la nariz): la primera línea va ARRIBA de la textura,
      // que en UV es v alto => fila de canvas baja. Canvas y=0 es v=1.
      const cy = ((i + 0.5) / n) * cv.height;
      ctx.fillText(line, cx, cy, cv.width / rep - 8);
    });
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  kit.own(tex);
  base.map = tex;
  base.color.set(0xffffff);
  base.needsUpdate = true;
  return base;
}

// ---------------------------------------------------------------------------
//  Cinta de cartuchos eslabonados
// ---------------------------------------------------------------------------

export interface BeltSpec {
  /** Puntos de la curva que sigue el eje de la cinta (centro de los cartuchos). */
  path: V3[];
  /** Número de cartuchos a lo largo de la curva. */
  count: number;
  /** Longitud total del cartucho (m) y diámetro de la vaina. */
  cartLen: number;
  caseD: number;
  /** Diámetro de la bala. */
  bulletD: number;
  /** Fracción de la longitud que es bala visible. */
  bulletFrac: number;
  /** Dirección "nariz" de los cartuchos (perpendicular a la cinta). */
  noseDir: V3;
  brass: THREE.Material;
  bullet: THREE.Material;
  link: THREE.Material;
  /** Material de la punta (trazadora/perforante) cada `tipEvery` cartuchos. */
  tip?: THREE.Material;
  tipEvery?: number;
}

/**
 * Cinta de cartuchos sobre una curva (eslabones M9/M13 simplificados: dos
 * abrazaderas por cartucho). Devuelve un grupo; conviene fusionarlo después.
 */
export function beltAlong(kit: ModelKit, spec: BeltSpec): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(spec.path.map((p) => new THREE.Vector3(...p)));
  const nose = new THREE.Vector3(...spec.noseDir).normalize();
  const L = spec.cartLen, rc = spec.caseD / 2, rb = spec.bulletD / 2;
  const bl = L * spec.bulletFrac;
  const cl = L - bl;
  // Perfil de cartucho: culote con garganta, cuerpo, gollete, cuello, bala ojival.
  const caseProf: Profile = [
    [0, 0], [rc * 0.98, 0], [rc * 0.98, L * 0.025], [rc * 0.8, L * 0.035], [rc * 0.8, L * 0.06],
    [rc, L * 0.07], [rc * 0.95, cl * 0.82], [rb * 1.1, cl * 0.92], [rb * 1.1, cl], [0, cl],
  ];
  const bulletProf: Profile = [
    [rb, cl - 0.001], [rb, cl + bl * 0.3], [rb * 0.85, cl + bl * 0.6], [rb * 0.5, cl + bl * 0.88], [rb * 0.12, L], [0, L],
  ];
  const tipProf: Profile = [[rb * 0.55, cl + bl * 0.82], [rb * 0.12, L], [0, L + 0.0002]];
  const up = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let i = 0; i < spec.count; i++) {
    const t = spec.count === 1 ? 0 : i / (spec.count - 1);
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    // Eje del cartucho: la nariz proyectada perpendicular a la tangente.
    up.copy(nose).addScaledVector(tan, -nose.dot(tan)).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const cart = new THREE.Group();
    cart.position.copy(p).addScaledVector(up, -L * 0.42);
    cart.quaternion.copy(q);
    cart.add(revolve(kit, caseProf, spec.brass, { segments: 10 }));
    const tipped = spec.tip && spec.tipEvery && i % spec.tipEvery === spec.tipEvery - 1;
    cart.add(revolve(kit, bulletProf, spec.bullet, { segments: 10 }));
    if (tipped) cart.add(revolve(kit, tipProf, spec.tip!, { segments: 10 }));
    // Eslabón: dos abrazaderas (toros aplastados) + puente lateral.
    for (const fy of [0.22, 0.6]) {
      const ring = kit.torus(rc * 1.08, rc * 0.16, spec.link, { segments: 10, at: [0, cl * fy, 0] });
      cart.add(ring);
    }
    const side = new THREE.Vector3().crossVectors(up, tan).normalize();
    m.makeRotationFromQuaternion(q).invert();
    const sideLocal = side.clone().applyMatrix4(m);
    cart.add(kit.box(rc * 0.5, cl * 0.5, rc * 0.5, spec.link, {
      at: [sideLocal.x * rc * 1.2, cl * 0.42, sideLocal.z * rc * 1.2],
    }));
    g.add(cart);
  }
  return g;
}
