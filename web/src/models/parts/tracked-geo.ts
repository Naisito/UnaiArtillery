// ============================================================================
//  parts/tracked-geo.ts — Utilidades de geometría para los vehículos de
//  cadenas y el mortero (agente 3D-TRACKED).  [V2]
//
//  Complementan a ModelKit (kit.ts, que no se toca) con lo que hace falta
//  para "chapa soldada" creíble:
//    * loft()        — sólido facetado uniendo secciones (cascos, torres,
//                      cunas, contenedores) con aristas vivas,
//    * latheCrisp()  — revolución con hombros nítidos (tubos escalonados,
//                      ruedas, frenos de boca, bujes),
//    * toothedRing() — corona dentada (ruedas motrices),
//    * bakeStatic()  — fusiona las mallas estáticas de un nodo por material
//                      (pocos draw calls en Cesium: un nodo articulado ⇒
//                      ~1 malla por material).
//  Todo produce BufferGeometry no indexada con normales y UV en metros
//  (proyección por cara dominante: válida para texturas procedurales PBR).
// ============================================================================
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Axis, ModelKit, PlaceOpts, V3 } from '../kit';

/** Anillo (polígono cerrado 3D) para loft. */
export type Ring = V3[];

// ---------------------------------------------------------------------------
//  Construcción de geometría facetada
// ---------------------------------------------------------------------------

/** Acumulador de triángulos con normal de cara y UV por proyección dominante. */
export class TriSoup {
  readonly pos: number[] = [];

  tri(a: V3, b: V3, c: V3): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  /** Cuadrilátero a-b-c-d (CCW visto desde fuera). */
  quad(a: V3, b: V3, c: V3, d: V3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Geometría final: normales planas por cara y UV en metros. */
  build(): THREE.BufferGeometry {
    return facetedGeometry(this.pos);
  }
}

/** Posiciones (tripletas de triángulos) → geometría con normales planas y UV. */
export function facetedGeometry(pos: number[]): THREE.BufferGeometry {
  const n = pos.length / 3;
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), f = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    a.fromArray(pos, t * 3);
    b.fromArray(pos, t * 3 + 3);
    c.fromArray(pos, t * 3 + 6);
    f.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (f.lengthSq() < 1e-20) f.set(0, 0, 1);
    f.normalize();
    const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      nor[i * 3] = f.x; nor[i * 3 + 1] = f.y; nor[i * 3 + 2] = f.z;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      if (ax >= ay && ax >= az) { uv[i * 2] = py; uv[i * 2 + 1] = pz; }
      else if (ay >= az) { uv[i * 2] = px; uv[i * 2 + 1] = pz; }
      else { uv[i * 2] = px; uv[i * 2 + 1] = py; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function newell(ring: Ring): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    n.x += (p[1] - q[1]) * (p[2] + q[2]);
    n.y += (p[2] - q[2]) * (p[0] + q[0]);
    n.z += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return n;
}

function centroid(ring: Ring): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of ring) c.add(new THREE.Vector3(p[0], p[1], p[2]));
  return c.multiplyScalar(1 / ring.length);
}

/** Tapa plana (triangulada) de un anillo, orientada según `outward`. */
function capRing(soup: TriSoup, ring: Ring, outward: THREE.Vector3): void {
  const n = newell(ring).normalize();
  const u = new THREE.Vector3(), v = new THREE.Vector3();
  const helper = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  u.crossVectors(helper, n).normalize();
  v.crossVectors(n, u);
  const pts = ring.map((p) => {
    const w = new THREE.Vector3(p[0], p[1], p[2]);
    return new THREE.Vector2(w.dot(u), w.dot(v));
  });
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const [i, j, k] of tris) {
    const A = ring[i], B = ring[j], C = ring[k];
    e1.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    e2.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
    const fn = e1.cross(e2);
    if (fn.dot(outward) >= 0) soup.tri(A, B, C);
    else soup.tri(A, C, B);
  }
}

/**
 * Loft facetado: une anillos consecutivos (todos con el MISMO nº de
 * vértices, en el mismo orden) con quads planos y tapa los extremos. La
 * orientación se corrige sola (caras hacia fuera). Ideal para cascos con
 * glacis, torres con mejillas inclinadas y contenedores achaflanados.
 */
export function loftGeometry(rings: Ring[], opts: { capStart?: boolean; capEnd?: boolean } = {}): THREE.BufferGeometry {
  const soup = new TriSoup();
  const n = rings[0].length;
  const d = centroid(rings[rings.length - 1]).sub(centroid(rings[0]));
  const rs = newell(rings[0]).dot(d) < 0 ? rings.map((r) => [...r].reverse()) : rings;
  for (let k = 0; k + 1 < rs.length; k++) {
    const A = rs[k], B = rs[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      soup.quad(A[i], A[j], B[j], B[i]);
    }
  }
  if (opts.capStart !== false) capRing(soup, rs[0], d.clone().negate());
  if (opts.capEnd !== false) capRing(soup, rs[rs.length - 1], d.clone());
  return soup.build();
}

/** Malla loft ya registrada en el kit y colocada. */
export function loft(kit: ModelKit, rings: Ring[], mat: THREE.Material, opts: PlaceOpts & { capStart?: boolean; capEnd?: boolean } = {}): THREE.Mesh {
  return kit.place(kit.mesh(loftGeometry(rings, opts), mat), opts);
}

/**
 * Desplaza un polígono 2D hacia DENTRO una distancia `d` (inglete). Válido
 * para d pequeño frente a la longitud de los lados.
 */
export function insetPolygon(poly: Array<[number, number]>, d: number): Array<[number, number]> {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    area += x0 * y1 - x1 * y0;
  }
  const ccw = area > 0 ? 1 : -1;
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const e0 = [p[0] - a[0], p[1] - a[1]], e1 = [b[0] - p[0], b[1] - p[1]];
    const l0 = Math.hypot(e0[0], e0[1]) || 1, l1 = Math.hypot(e1[0], e1[1]) || 1;
    // Normal interior (a la izquierda en CCW).
    const n0 = [(-e0[1] / l0) * ccw, (e0[0] / l0) * ccw], n1 = [(-e1[1] / l1) * ccw, (e1[0] / l1) * ccw];
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    const s = k > 0.2 ? d / k : d / 0.2;
    return [p[0] + (n0[0] + n1[0]) * s, p[1] + (n0[1] + n1[1]) * s] as [number, number];
  });
}

/**
 * Silueta LATERAL extruida a lo ancho (como kit.extrudeSide) pero con el
 * contorno EXACTO: los chaflanes de las aristas de los costados se tallan
 * hacia dentro (kit.extrudeSide con bevel engorda la silueta). `side` =
 * [[y, z], …]; anchura total `width` centrada en x = 0 (o en `at`).
 */
export function extrudeSideExact(
  kit: ModelKit, side: Array<[number, number]>, width: number, mat: THREE.Material,
  opts: PlaceOpts & { chamfer?: number } = {},
): THREE.Mesh {
  const c = Math.min(opts.chamfer ?? 0, width / 2 - 1e-3);
  const ring = (x: number, poly: Array<[number, number]>): Ring => poly.map(([y, z]) => [x, y, z]);
  const h = width / 2;
  const rings: Ring[] = c > 0
    ? (() => {
      const inner = insetPolygon(side, c);
      return [ring(-h, inner), ring(-h + c, side), ring(h - c, side), ring(h, inner)];
    })()
    : [ring(-h, side), ring(h, side)];
  return loft(kit, rings, mat, opts);
}

/**
 * Prisma de sección constante en el plano XZ (perfil frontal) extruido a lo
 * largo de Y entre y0 e y1. `xz` = [[x, z], …].
 */
export function prismY(kit: ModelKit, xz: Array<[number, number]>, y0: number, y1: number, mat: THREE.Material, opts: PlaceOpts = {}): THREE.Mesh {
  const r0: Ring = xz.map(([x, z]) => [x, y0, z]);
  const r1: Ring = xz.map(([x, z]) => [x, y1, z]);
  return loft(kit, [r0, r1], mat, opts);
}

/**
 * Sección rectangular achaflanada (8 vértices) en el plano XZ centrada en
 * (cx, cz): utilidad para anillos de loft de cascos/contenedores.
 */
export function chamferRect(cx: number, y: number, cz: number, w: number, h: number, c: number): Ring {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - h / 2, z1 = cz + h / 2;
  return [
    [x0 + c, y, z0], [x1 - c, y, z0], [x1, y, z0 + c], [x1, y, z1 - c],
    [x1 - c, y, z1], [x0 + c, y, z1], [x0, y, z1 - c], [x0, y, z0 + c],
  ];
}

// ---------------------------------------------------------------------------
//  Revolución con hombros nítidos
// ---------------------------------------------------------------------------

function orient(geo: THREE.BufferGeometry, axis: Axis): void {
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  else if (axis === 'x') geo.rotateZ(-Math.PI / 2);
}

/**
 * Sólido de revolución con aristas vivas entre tramos. `profile` =
 * [[radio, posiciónEnEje], …] recorrido con el MATERIAL A LA IZQUIERDA
 * (contorno cerrado en sentido antihorario en el plano (r, a)): así las
 * normales salen hacia fuera. Cada tramo tiene su propia normal (hombros y
 * caras planas nítidas) y es liso alrededor del eje.
 *   Ej. tubo macizo de la culata a la boca: [[0,a0],[R,a0],[R,a1],[0,a1]].
 */
export function latheCrispGeometry(profile: Array<[number, number]>, segments = 32, axis: Axis = 'y', closed = false): THREE.BufferGeometry {
  const pts = closed ? [...profile, profile[0]] : profile;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  let vAcc = 0;
  for (let j = 0; j + 1 < pts.length; j++) {
    const [r0, a0] = pts[j], [r1, a1] = pts[j + 1];
    const dr = r1 - r0, da = a1 - a0;
    const len = Math.hypot(dr, da);
    if (len < 1e-9) continue;
    // Normal en el plano (r, a): giro horario de la dirección del tramo.
    const nr = da / len, na = -dr / len;
    for (let s = 0; s < segments; s++) {
      const t0 = (s / segments) * Math.PI * 2, t1 = ((s + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      // Eje = Y; radial = (sin θ, 0, cos θ) (mismo convenio que LatheGeometry).
      const P = (r: number, a: number, si: number, co: number): V3 => [r * si, a, r * co];
      const A = P(r0, a0, s0, c0), B = P(r1, a1, s0, c0), C = P(r1, a1, s1, c1), D = P(r0, a0, s1, c1);
      const NA: V3 = [nr * s0, na, nr * c0], NC: V3 = [nr * s1, na, nr * c1];
      const ra = Math.max(Math.max(r0, r1), 0.02);
      const u0 = t0 * ra, u1 = t1 * ra;
      // Triángulos A-D-C y A-C-B: con el material a la izquierda del perfil
      // la normal geométrica coincide con (nr, na) ⇒ cara frontal hacia fuera.
      const push = (p: V3, nn: V3, u: number, v: number) => {
        pos.push(p[0], p[1], p[2]); nor.push(nn[0], nn[1], nn[2]); uv.push(u, v);
      };
      push(A, NA, u0, vAcc); push(D, NC, u1, vAcc); push(C, NC, u1, vAcc + len);
      push(A, NA, u0, vAcc); push(C, NC, u1, vAcc + len); push(B, NA, u0, vAcc + len);
    }
    vAcc += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  orient(g, axis);
  return g;
}

export function latheCrisp(
  kit: ModelKit, profile: Array<[number, number]>, mat: THREE.Material,
  opts: PlaceOpts & { axis?: Axis; segments?: number; closed?: boolean } = {},
): THREE.Mesh {
  return kit.place(kit.mesh(latheCrispGeometry(profile, opts.segments ?? 32, opts.axis ?? 'y', opts.closed ?? false), mat), opts);
}

/**
 * Toro de pocos polígonos (sección poligonal de `sides` lados) para argollas,
 * ganchos y ojales pequeños: ~1/3 de los triángulos de kit.torus.
 */
export function lowTorus(
  kit: ModelKit, R: number, r: number, mat: THREE.Material,
  opts: PlaceOpts & { axis?: Axis; sides?: number; segments?: number } = {},
): THREE.Mesh {
  const n = opts.sides ?? 5;
  // Contorno CCW en el plano (radio, eje) centrado en (R, 0).
  const prof: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
    prof.push([R + r * Math.cos(t), r * Math.sin(t)]);
  }
  return latheCrisp(kit, prof, mat, { ...opts, closed: true, segments: opts.segments ?? 12 });
}

// ---------------------------------------------------------------------------
//  Corona dentada (rueda motriz)
// ---------------------------------------------------------------------------

/**
 * Corona dentada extruida a lo largo de X (eje de la rueda), centrada en el
 * origen: `teeth` dientes trapezoidales entre rRoot y rTip, agujero central
 * de radio rHole, grosor `width`.
 */
export function toothedRingGeometry(rRoot: number, rTip: number, teeth: number, width: number, rHole: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    // Raíz (valle) → flanco → punta → flanco.
    const pts: Array<[number, number]> = [
      [rRoot, a - step * 0.5], [rRoot, a - step * 0.24],
      [rTip, a - step * 0.12], [rTip, a + step * 0.12],
      [rRoot, a + step * 0.24],
    ];
    pts.forEach(([r, t], k) => {
      const x = r * Math.cos(t), y = r * Math.sin(t);
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 16 });
  // (u, v, w) → (x = w − width/2, y = u, z = v): permutación cíclica (det +1).
  geo.applyMatrix4(new THREE.Matrix4().set(
    0, 0, 1, -width / 2,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
//  Repetición y fusión
// ---------------------------------------------------------------------------

/**
 * Corona de N tornillos (cabeza hexagonal) sobre una circunferencia de
 * radio `ring` en el plano perpendicular a X (normal hacia `side`·X).
 */
export function boltCircle(kit: ModelKit, parent: THREE.Object3D, mat: THREE.Material, opts: {
  n: number; ring: number; x: number; side: 1 | -1; r?: number; h?: number; phase?: number; y?: number; z?: number;
}): void {
  const r = opts.r ?? 0.012, h = opts.h ?? 0.012;
  for (let i = 0; i < opts.n; i++) {
    const t = (opts.phase ?? 0) + (i / opts.n) * Math.PI * 2;
    parent.add(kit.cyl(r, r, h, mat, {
      axis: 'x', segments: 6,
      at: [opts.x + opts.side * h / 2, (opts.y ?? 0) + opts.ring * Math.cos(t), (opts.z ?? 0) + opts.ring * Math.sin(t)],
    }));
  }
}

/**
 * Fusiona TODAS las mallas descendientes de `group` en una malla por
 * material, con sus transformaciones horneadas relativas a `group`.
 * Respeta los hijos DIRECTOS marcados con `userData.keep = true` (pivotes
 * articulados, nodos animados): ni se fusionan ni se eliminan.
 * Úsalo al final del builder, sobre grupos estáticos (casco, torre, cuna,
 * tubo): reduce cientos de mallas a ~5-10 draw calls por nodo.
 */
export function bakeStatic(kit: ModelKit, group: THREE.Object3D): void {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const order: THREE.Material[] = [];
  const rel = new THREE.Matrix4();

  const collect = (o: THREE.Object3D): void => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) {
      rel.multiplyMatrices(inv, m.matrixWorld);
      const src = m.geometry;
      const g = src.index ? src.toNonIndexed() : src.clone();
      g.applyMatrix4(rel);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      }
      for (const k of Object.keys(g.attributes)) {
        if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      }
      g.clearGroups();
      const mat = m.material as THREE.Material;
      if (!buckets.has(mat)) { buckets.set(mat, []); order.push(mat); }
      buckets.get(mat)!.push(g);
      src.dispose();
    }
    for (const c of o.children) collect(c);
  };

  const keep: THREE.Object3D[] = [];
  for (const c of [...group.children]) {
    if (c.userData.keep) { keep.push(c); continue; }
    collect(c);
    group.remove(c);
  }
  // Mallas propias del grupo (si el propio grupo es una malla) no se tocan.
  for (const mat of order) {
    const parts = buckets.get(mat)!;
    const merged = concatGeometries(parts);
    for (const p of parts) p.dispose();
    const welded = mergeVertices(merged, 1e-5);
    merged.dispose();
    const mesh = kit.mesh(welded, mat);
    mesh.name = `baked:${mat.name || 'mat'}`;
    group.add(mesh);
  }
  // Los nodos conservados al final (orden estable para depurar).
  for (const k of keep) { group.remove(k); group.add(k); }
}

/** Concatena geometrías NO indexadas con position/normal/uv. */
function concatGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const P = p.getAttribute('position'), N = p.getAttribute('normal'), U = p.getAttribute('uv');
    for (let i = 0; i < P.count; i++, o++) {
      pos[o * 3] = P.getX(i); pos[o * 3 + 1] = P.getY(i); pos[o * 3 + 2] = P.getZ(i);
      nor[o * 3] = N.getX(i); nor[o * 3 + 1] = N.getY(i); nor[o * 3 + 2] = N.getZ(i);
      uv[o * 2] = U.getX(i); uv[o * 2 + 1] = U.getY(i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Marca un nodo para que bakeStatic() lo respete (pivote/animado). */
export function keep<T extends THREE.Object3D>(o: T): T {
  o.userData.keep = true;
  return o;
}

/** Copia una geometría con una matriz aplicada (para repetir piezas). */
export function transformed(geo: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(m);
  return g;
}

/** Tubo recto entre dos puntos (barandillas, vástagos, cables tensos). */
export function rod(kit: ModelKit, a: V3, b: V3, r: number, mat: THREE.Material, segments = 8): THREE.Mesh {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = kit.cyl(r, r, len, mat, { segments });
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
  return m;
}
