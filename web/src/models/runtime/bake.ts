// ============================================================================
//  bake.ts — Horneado de un modelo Three (rig de plataforma, blanco…) a una
//  jerarquía compacta lista para glTF/Cesium.  [V2 — 3D-CORE]
//
//  Entrada: la raíz del modelo y los nodos que deben conservar identidad
//  (articulados: traverse/elevation/recoil/extraAnimated…, y estáticos
//  conmutables como el atrezo). Salida: un grafo NUEVO donde
//    * cada nodo conservado es un Object3D con nombre ÚNICO (Cesium los
//      busca con model.getNode(name)) y matriz local = prefijo estático ×
//      matriz local del nodo fuente (los grupos intermedios desaparecen);
//    * toda la geometría estática bajo cada nodo se FUNDE por material en
//      una sola malla (cientos de piezas → un puñado de draw calls);
//    * los colores de vértice llevan el color del material + polvo/barro
//      por altura sobre el suelo, polvo en caras superiores y una oclusión
//      barata en caras hacia abajo (el "desgaste" del kit, MAT_WEAR). El
//      material horneado va en blanco con vertexColors (glTF COLOR_0).
//  El grafo fuente sigue siendo la verdad de la animación: cada frame
//  `localMatrix(node)` compone prefijo × matriz actual del nodo fuente.
// ============================================================================
import * as THREE from 'three';
import { MAT_KIND, MAT_UV_METERS, MAT_WEAR } from '../kit';
import { ensureIndexed, projectUvMeters, UV_LOCKED } from './geom';

export interface BakeInput {
  root: THREE.Object3D;
  /** Nodos articulados (se sincronizan cada frame). */
  animated?: THREE.Object3D[];
  /** Nodos con identidad propia pero estáticos (p. ej. atrezo conmutable). */
  keep?: THREE.Object3D[];
  /** Polvo/barro por altura en colores de vértice (defecto true). */
  grime?: boolean;
  /** Prefijo de nombres de nodo (defecto 'ua'). */
  namePrefix?: string;
}

export interface BakedNode {
  /** Nodo fuente (su matriz local manda en la animación). */
  readonly src: THREE.Object3D;
  /** Nodo horneado (hijo del nodo conservado más cercano). */
  readonly dst: THREE.Object3D;
  /** Nombre único (Cesium: model.getNode(name)). */
  readonly name: string;
  /** Prefijo estático: espacio del padre conservado ← espacio del padre de src. */
  readonly prefix: THREE.Matrix4;
  readonly animated: boolean;
}

export interface BakeStats {
  triangles: number;
  vertices: number;
  drawCalls: number;
  materials: number;
  nodes: number;
  sourceMeshes: number;
}

export interface BakedModel {
  readonly root: THREE.Object3D;
  readonly nodes: BakedNode[];
  readonly animatedNodes: BakedNode[];
  readonly stats: BakeStats;
  /** Nodo horneado de un nodo fuente conservado. */
  nodeOf(src: THREE.Object3D): BakedNode | undefined;
  /** Matriz local ACTUAL de un nodo conservado (prefijo × matriz fuente). */
  localMatrix(node: BakedNode, out: THREE.Matrix4): THREE.Matrix4;
  dispose(): void;
}

// Colores de suciedad (sRGB → lineal al construir el Color).
const DUST = new THREE.Color(0xa08e70);
const MUD = new THREE.Color(0x4a3c2b);

interface Part {
  geo: THREE.BufferGeometry;
  /** Material fuente (color, tipo y desgaste propios de la pieza). */
  mat: THREE.MeshStandardMaterial;
  /** Espacio del nodo conservado ← espacio de la malla. */
  toNode: THREE.Matrix4;
  /** Espacio raíz (suelo z = 0) ← espacio de la malla, en reposo. */
  toRoot: THREE.Matrix4;
  ownsGeo: boolean;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let warnedMat = false;

/** Material estándar equivalente (por si un builder usó otro tipo). */
function asStandard(m: THREE.Material): THREE.MeshStandardMaterial {
  if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m as THREE.MeshStandardMaterial;
  if (!warnedMat) {
    warnedMat = true;
    console.warn(`[bake] material ${m.type} convertido a MeshStandardMaterial (contrato rig.ts)`);
  }
  const src = m as THREE.MeshBasicMaterial;
  const out = new THREE.MeshStandardMaterial({
    color: src.color ?? 0xffffff, map: src.map ?? null, roughness: 0.8, metalness: 0,
    transparent: m.transparent, opacity: m.opacity, side: m.side,
  });
  out.name = m.name;
  return out;
}

const texId = (t: THREE.Texture | null) => (t ? t.uuid : '-');

/** Firma de un material SIN el color (lo que de verdad cambia el shader). */
function signature(m: THREE.MeshStandardMaterial): string {
  return [
    texId(m.map), texId(m.normalMap), texId(m.roughnessMap), texId(m.metalnessMap), texId(m.emissiveMap),
    texId(m.alphaMap), m.roughness.toFixed(3), m.metalness.toFixed(3), m.normalScale.x.toFixed(3),
    m.emissive.getHexString(), m.emissiveIntensity, m.transparent, m.opacity, m.side, m.alphaTest,
    m.userData?.[MAT_KIND] === 'decal' ? 'decal' : '',
  ].join('|');
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'node';
}

export function bakeModel(input: BakeInput): BakedModel {
  const { root } = input;
  const prefix = input.namePrefix ?? 'ua';
  const grime = input.grime ?? true;
  const animatedSet = new Set<THREE.Object3D>([root, ...(input.animated ?? [])]);
  const keepSet = new Set<THREE.Object3D>([...animatedSet, ...(input.keep ?? [])]);

  const nodes: BakedNode[] = [];
  const byStc = new Map<THREE.Object3D, BakedNode>();
  /** Por nodo: firma de material (sin el color) → piezas. */
  const buckets = new Map<BakedNode, Map<string, { proto: THREE.MeshStandardMaterial; parts: Part[] }>>();
  let sourceMeshes = 0;
  const usedNames = new Set<string>();

  const makeNode = (src: THREE.Object3D, parent: BakedNode | null, pre: THREE.Matrix4): BakedNode => {
    let name = `${prefix}${nodes.length}_${sanitize(src.name || src.type)}`;
    while (usedNames.has(name)) name += '_';
    usedNames.add(name);
    const dst = new THREE.Object3D();
    dst.name = name;
    dst.matrixAutoUpdate = false;
    src.updateMatrix();
    dst.matrix.multiplyMatrices(pre, src === root ? new THREE.Matrix4().copy(src.matrix) : src.matrix);
    dst.visible = src.visible;
    if (parent) parent.dst.add(dst);
    const bn: BakedNode = { src, dst, name, prefix: pre.clone(), animated: animatedSet.has(src) };
    nodes.push(bn);
    byStc.set(src, bn);
    buckets.set(bn, new Map());
    return bn;
  };

  const addMesh = (mesh: THREE.Mesh, owner: BakedNode, toNode: THREE.Matrix4, toRoot: THREE.Matrix4) => {
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo?.attributes?.position) return;
    sourceMeshes++;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && geo.groups.length > 0
      ? geo.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0];
      if (!mat || mat.visible === false) continue;
      let g = geo;
      let owns = false;
      if (groups.length > 1) {
        g = subGeometry(geo, grp.start, grp.count);
        owns = true;
      }
      if (mat.userData?.[MAT_UV_METERS] && !g.userData?.[UV_LOCKED]) {
        const p = projectUvMeters(g);
        if (owns) g.dispose();
        g = p;
        owns = true;
      }
      const std = asStandard(mat);
      const sig = signature(std);
      const bucket = buckets.get(owner)!;
      let entry = bucket.get(sig);
      if (!entry) bucket.set(sig, (entry = { proto: std, parts: [] }));
      entry.parts.push({ geo: g, mat: std, toNode: toNode.clone(), toRoot: toRoot.clone(), ownsGeo: owns });
    }
  };

  const isRenderable = (o: THREE.Object3D) => (o as THREE.Mesh).isMesh
    && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh;

  const visit = (obj: THREE.Object3D, owner: BakedNode, acc: THREE.Matrix4, rootAcc: THREE.Matrix4) => {
    for (const child of obj.children) {
      const kept = keepSet.has(child);
      if (!child.visible && !kept) continue;
      child.updateMatrix();
      const childRoot = new THREE.Matrix4().multiplyMatrices(rootAcc, child.matrix);
      if (kept) {
        const bn = makeNode(child, owner, acc);
        if (isRenderable(child)) addMesh(child as THREE.Mesh, bn, new THREE.Matrix4(), childRoot);
        visit(child, bn, new THREE.Matrix4(), childRoot);
      } else {
        const childAcc = new THREE.Matrix4().multiplyMatrices(acc, child.matrix);
        if (isRenderable(child)) addMesh(child as THREE.Mesh, owner, childAcc, childRoot);
        else if ((child as THREE.InstancedMesh).isInstancedMesh) {
          console.warn('[bake] InstancedMesh ignorado (contrato rig.ts)');
        }
        visit(child, owner, childAcc, childRoot);
      }
    }
  };

  const rootNode = makeNode(root, null, new THREE.Matrix4());
  if (isRenderable(root)) addMesh(root as THREE.Mesh, rootNode, new THREE.Matrix4(), new THREE.Matrix4());
  visit(root, rootNode, new THREE.Matrix4(), new THREE.Matrix4());

  // -- Fusión por material ---------------------------------------------------
  // Materiales que solo difieren en el color comparten material horneado:
  // el color ya viaja en los colores de vértice (menos draw calls y menos
  // materiales en el GLB).
  const bakedMats = new Map<string, THREE.MeshStandardMaterial>();
  const ownedGeos: THREE.BufferGeometry[] = [];
  let triangles = 0, vertices = 0, drawCalls = 0;

  for (const bn of nodes) {
    let k = 0;
    for (const [sig, { proto, parts }] of buckets.get(bn)!) {
      let bm = bakedMats.get(sig);
      if (!bm) {
        bm = proto.clone();
        bm.name = String(proto.userData?.[MAT_KIND] ?? proto.name ?? 'mat') + `_${bakedMats.size}`;
        bm.userData = { ...proto.userData };
        bm.vertexColors = true;
        bm.color.setRGB(1, 1, 1);
        bakedMats.set(sig, bm);
      }
      const merged = mergeParts(parts, grime);
      for (const p of parts) if (p.ownsGeo) p.geo.dispose();
      ownedGeos.push(merged);
      const mesh = new THREE.Mesh(merged, bm);
      mesh.name = `${bn.name}~${k++}`;
      mesh.castShadow = (proto.userData?.[MAT_KIND] !== 'decal');
      mesh.receiveShadow = true;
      bn.dst.add(mesh);
      triangles += merged.index!.count / 3;
      vertices += merged.attributes.position.count;
      drawCalls++;
    }
  }

  const animatedNodes = nodes.filter((n) => n.animated);
  return {
    root: rootNode.dst,
    nodes,
    animatedNodes,
    stats: {
      triangles, vertices, drawCalls,
      materials: bakedMats.size,
      nodes: nodes.length,
      sourceMeshes,
    },
    nodeOf: (src) => byStc.get(src),
    localMatrix(node, out) {
      node.src.updateMatrix();
      return out.multiplyMatrices(node.prefix, node.src.matrix);
    },
    dispose() {
      for (const g of ownedGeos) g.dispose();
      for (const m of bakedMats.values()) m.dispose();
    },
  };
}

/** Subgeometría de un grupo (multi-material). */
function subGeometry(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const src = ensureIndexed(geo.index ? geo : geo.clone());
  const idx = src.index!;
  const end = Math.min(idx.count, start + count);
  const out = src.clone();
  const arr = new Uint32Array(end - start);
  for (let i = start; i < end; i++) arr[i - start] = idx.getX(i);
  out.setIndex(new THREE.BufferAttribute(arr, 1));
  out.clearGroups();
  if (src !== geo) src.dispose();
  return out;
}

/**
 * Concatena las piezas (transformadas al espacio del nodo) en una geometría
 * con position/normal/uv/color e índice. El color de vértice = color del
 * material + suciedad según altura/orientación EN EL ESPACIO RAÍZ.
 */
function mergeParts(parts: Part[], grime: boolean): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const p of parts) {
    nv += p.geo.attributes.position.count;
    ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  // Color lineal en Uint16 normalizado: 6 B/vértice (vs 12 en float) sin
  // bandas en los verdes oscuros (8 bits lineales sí las darían).
  const col = new Uint16Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);

  const v = new THREE.Vector3(), n = new THREE.Vector3(), r = new THREE.Vector3(), rn = new THREE.Vector3();
  const nm = new THREE.Matrix3(), rnm = new THREE.Matrix3();
  const c = new THREE.Color();
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geo;
    const base = p.mat.color; // lineal
    const kind = String(p.mat.userData?.[MAT_KIND] ?? '');
    const wear = Number(p.mat.userData?.[MAT_WEAR] ?? 0.4);
    const dirty = grime && kind !== 'emissive' && kind !== 'glass';
    const mudK = kind === 'decal' || kind === 'net' ? 0.3 : 1;
    const P = g.attributes.position as THREE.BufferAttribute;
    const N = g.attributes.normal as THREE.BufferAttribute | undefined;
    const U = g.attributes.uv as THREE.BufferAttribute | undefined;
    nm.getNormalMatrix(p.toNode);
    rnm.getNormalMatrix(p.toRoot);
    const flip = p.toNode.determinant() < 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      r.copy(v).applyMatrix4(p.toRoot);
      v.applyMatrix4(p.toNode);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (N) {
        n.fromBufferAttribute(N, i);
        rn.copy(n).applyMatrix3(rnm).normalize();
        n.applyMatrix3(nm);
        if (n.lengthSq() < 1e-12) n.set(0, 0, 1); else n.normalize();
      } else {
        n.set(0, 0, 1);
        rn.set(0, 0, 1);
      }
      nor[(vo + i) * 3] = n.x; nor[(vo + i) * 3 + 1] = n.y; nor[(vo + i) * 3 + 2] = n.z;
      if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      c.copy(base);
      if (dirty) {
        const z = r.z, nz = rn.z;
        const dust = wear * (0.45 * (1 - smooth(0.0, 1.0, z)) + 0.2 * smooth(0.6, 0.95, nz));
        const mud = wear * mudK * (1 - smooth(-0.05, 0.25, z)) * 0.9;
        c.lerp(DUST, Math.min(0.5, dust * 0.45));
        c.lerp(MUD, Math.min(0.9, mud));
        const ao = (1 - 0.3 * smooth(-0.15, -0.85, nz)) * (1 - 0.22 * (1 - smooth(0.0, 0.3, z)));
        c.multiplyScalar(ao);
      }
      col[(vo + i) * 3] = Math.round(Math.min(1, c.r) * 65535);
      col[(vo + i) * 3 + 1] = Math.round(Math.min(1, c.g) * 65535);
      col[(vo + i) * 3 + 2] = Math.round(Math.min(1, c.b) * 65535);
    }
    if (g.index) {
      const I = g.index;
      for (let t = 0; t < I.count; t += 3) {
        const a = I.getX(t) + vo, b = I.getX(t + 1) + vo, d = I.getX(t + 2) + vo;
        idx[io + t] = a;
        idx[io + t + 1] = flip ? d : b;
        idx[io + t + 2] = flip ? b : d;
      }
      io += I.count;
    } else {
      for (let t = 0; t < P.count; t += 3) {
        idx[io + t] = vo + t;
        idx[io + t + 1] = vo + (flip ? t + 2 : t + 1);
        idx[io + t + 2] = vo + (flip ? t + 1 : t + 2);
      }
      io += P.count;
    }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
