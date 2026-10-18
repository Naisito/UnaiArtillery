// ============================================================================
//  geom.ts — Utilidades de geometría del runtime de modelos.  [V2 — 3D-CORE]
//
//  * projectUvMeters: UV en METROS por proyección de caja POR TRIÁNGULO
//    (eje dominante de la normal de cara). Los vértices que comparten dos
//    proyecciones se duplican, así no hay triángulos "estirados" en las
//    transiciones (cilindros a 45°): solo una costura limpia, invisible con
//    texturas de ruido. Conserva normales suaves y el índice.
//  * ensureIndexed / stripAttributes: normaliza geometrías para fusionarlas.
// ============================================================================
import * as THREE from 'three';

/** Marca de geometría con UV propias en metros (no reproyectar). */
export const UV_LOCKED = 'uaUvLocked';

/** Garantiza índice (secuencial si la geometría no lo tenía). */
export function ensureIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo;
  const n = geo.attributes.position.count;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/**
 * Reproyecta las UV en metros (1 unidad UV = 1 m) en el espacio local de la
 * geometría. Caras ±Z → (x, y); ±X → (y, z); ±Y → (x, z): en las caras
 * laterales v = altura, así los chorretones de las texturas caen en vertical.
 * Devuelve una geometría NUEVA (indexada, con position/normal/uv).
 */
export function projectUvMeters(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = ensureIndexed(src.index ? src : src.clone());
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const index = geo.index!;
  const nv = pos.count;
  const ntri = index.count / 3;

  // Arrays de salida crecientes: como mucho 3 copias por vértice.
  const outPos: number[] = [];
  const outNor: number[] = [];
  const outUv: number[] = [];
  const outIdx = new Uint32Array(index.count);
  const table = new Int32Array(nv * 3).fill(-1);

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();

  for (let t = 0; t < ntri; t++) {
    const i0 = index.getX(t * 3), i1 = index.getX(t * 3 + 1), i2 = index.getX(t * 3 + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    const axis = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
    const corners = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const v = corners[k];
      const key = v * 3 + axis;
      let ni = table[key];
      if (ni < 0) {
        ni = outPos.length / 3;
        table[key] = ni;
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        outPos.push(x, y, z);
        outNor.push(nor.getX(v), nor.getY(v), nor.getZ(v));
        if (axis === 2) outUv.push(x, y);
        else if (axis === 0) outUv.push(y, z);
        else outUv.push(x, z);
      }
      outIdx[t * 3 + k] = ni;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(outNor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  const nOut = outPos.length / 3;
  out.setIndex(new THREE.BufferAttribute(nOut > 65535 ? outIdx : new Uint16Array(outIdx), 1));
  out.userData[UV_LOCKED] = true;
  return out;
}

/** UV cilíndricas en metros alrededor de un eje (u = arco, v = posición axial). */
export function cylindricalUvMeters(geo: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', radius: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let ang: number, ax: number;
    if (axis === 'x') { ang = Math.atan2(z, y); ax = x; }
    else if (axis === 'y') { ang = Math.atan2(x, z); ax = y; }
    else { ang = Math.atan2(y, x); ax = z; }
    uv[i * 2] = (ang + Math.PI) * radius;
    uv[i * 2 + 1] = ax;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.userData[UV_LOCKED] = true;
}
