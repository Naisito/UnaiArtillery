// ============================================================================
//  wheeled.test.ts — Contrato de los modelos de ruedas (3D-WHEELED):
//  presupuestos de triángulos, jerarquía articulada en identidad, boca del
//  contenedor en la cara de los tubos en todas las elevaciones, ruedas como
//  grupos centrados en su eje, solo MeshStandardMaterial, sin escalas
//  negativas ni InstancedMesh.
// ============================================================================
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WeaponCatalog, type WeaponId } from '../../ballistics';
import { ModelKit } from '../kit';
import { buildHimars } from '../platforms/himars';
import { DEG, type PlatformRig, type TargetModel } from '../rig';
import { buildTargetApc, buildTargetTruck } from '../targets';
import { countTriangles } from './trucks';

function checkMaterialsAndScales(root: THREE.Object3D): void {
  root.traverse((o) => {
    expect((o as THREE.InstancedMesh).isInstancedMesh ?? false).toBe(false);
    expect(o.scale.x > 0 && o.scale.y > 0 && o.scale.z > 0).toBe(true);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) expect((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect((m as unknown as THREE.Line).isLine ?? false).toBe(false);
  });
}

function buildRig(weaponId: WeaponId): PlatformRig {
  const kit = new ModelKit();
  return buildHimars({ kit, weaponId, weapon: WeaponCatalog.get(weaponId) });
}

describe('M142 HIMARS', () => {
  for (const wid of ['gmlrs', 'ergmlrs', 'prsm'] as WeaponId[]) {
    it(`${wid}: contrato del rig y presupuesto`, () => {
      const rig = buildRig(wid);
      expect(countTriangles(rig.root)).toBeLessThanOrEqual(80_000);
      checkMaterialsAndScales(rig.root);
      // Jerarquía root ⊇ traverse ⊇ elevation ⊇ recoil, en identidad.
      expect(rig.traverse.parent).toBe(rig.root);
      expect(rig.elevation.parent).toBe(rig.traverse);
      expect(rig.recoil.parent).toBe(rig.elevation);
      for (const n of [rig.traverse, rig.elevation, rig.recoil]) {
        expect(n.rotation.x).toBe(0);
        expect(n.rotation.y).toBe(0);
        expect(n.rotation.z).toBe(0);
      }
      expect(rig.traverse.position.length()).toBe(0);
      expect(rig.recoil.position.length()).toBe(0);
      expect(rig.recoilStrokeM).toBe(0);
      expect(rig.extraAnimated?.length).toBe(4);
      // Huella y altura coherentes con el modelo (antenas aparte).
      expect(rig.footprintM).toBeGreaterThan(5);
      expect(rig.heightM).toBeCloseTo(3.18, 1);
    });

    it(`${wid}: la boca está en la cara frontal del contenedor a 0/30/60°`, () => {
      const rig = buildRig(wid);
      // La cara frontal del contenedor = máximo Y local del sub-árbol recoil.
      rig.root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(rig.recoil.matrixWorld).invert();
      const box = new THREE.Box3();
      rig.recoil.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        box.union(b);
      });
      expect(Math.abs(rig.muzzleLocal.y - box.max.y)).toBeLessThan(0.03);
      expect(rig.muzzleLocal.x).toBeLessThan(0); // tubo/celda 1 = izquierda
      for (const el of [0, 30, 60]) {
        rig.elevation.rotation.x = el * DEG;
        rig.animate?.({ t: 0, dt: 0, azimuthDeg: 0, elevationDeg: el, recoil01: 0, sinceFireS: Infinity });
        rig.root.updateMatrixWorld(true);
        const w = rig.recoil.localToWorld(rig.muzzleLocal.clone());
        const piv = rig.elevation.getWorldPosition(new THREE.Vector3());
        // La boca sube con la elevación siguiendo el brazo desde el muñón.
        const arm = w.clone().sub(piv);
        const ang = Math.atan2(arm.z, arm.y) / DEG;
        const ang0 = Math.atan2(rig.muzzleLocal.z, rig.muzzleLocal.y) / DEG;
        expect(ang - ang0).toBeCloseTo(el, 3);
      }
    });
  }

  it('los gatos de elevación unen base y caja en toda la carrera', () => {
    const rig = buildRig('gmlrs');
    const [bl, , rl] = rig.extraAnimated!;
    for (const el of [0, 25, 45, 60]) {
      rig.elevation.rotation.x = el * DEG;
      rig.animate!({ t: 0, dt: 0, azimuthDeg: 0, elevationDeg: el, recoil01: 0, sinceFireS: Infinity });
      rig.root.updateMatrixWorld(true);
      const a = bl.getWorldPosition(new THREE.Vector3());
      const b = rl.getWorldPosition(new THREE.Vector3());
      // El eje +Y del cilindro apunta al anclaje del vástago y viceversa.
      const dirBarrel = new THREE.Vector3(0, 1, 0).transformDirection(bl.matrixWorld);
      const dirRod = new THREE.Vector3(0, 1, 0).transformDirection(rl.matrixWorld);
      const ab = b.clone().sub(a).normalize();
      expect(dirBarrel.dot(ab)).toBeGreaterThan(0.9999);
      expect(dirRod.dot(ab)).toBeLessThan(-0.9999);
      // Solape cilindro/vástago positivo (no se separan) y sin hundirse.
      const len = a.distanceTo(b);
      expect(len).toBeLessThan(1.4 + 1.2 - 0.05);
      expect(len).toBeGreaterThan(1.4 * 0.95);
    }
  });
});

function checkTarget(t: TargetModel, nWheels: number, maxLen: number): void {
  expect(countTriangles(t.root)).toBeLessThanOrEqual(40_000);
  checkMaterialsAndScales(t.root);
  expect(t.wheels.length).toBe(nWheels);
  t.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(t.root);
  expect(box.min.z).toBeGreaterThan(-0.04);
  expect(Math.abs((box.min.x + box.max.x) / 2)).toBeLessThan(0.1);
  expect(box.max.y - box.min.y).toBeLessThan(maxLen);
  for (const w of t.wheels) {
    expect(w.parent).toBe(t.root);
    expect(w.rotation.x).toBe(0);
    expect(w.rotation.y).toBe(0);
    expect(w.rotation.z).toBe(0);
    expect(w.position.z).toBeCloseTo(t.wheelRadiusM, 1);
    // Girar la rueda sobre su X no la desplaza: está centrada en su eje.
    const b0 = new THREE.Box3().setFromObject(w);
    const c0 = b0.getCenter(new THREE.Vector3());
    w.rotation.x = 1.1;
    w.updateMatrixWorld(true);
    const c1 = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
    w.rotation.x = 0;
    w.updateMatrixWorld(true);
    expect(c0.distanceTo(c1)).toBeLessThan(0.03);
    const size = b0.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(t.wheelRadiusM * 2, 1);
  }
}

describe('Blancos de ruedas', () => {
  it('Ural-4320: 6 ruedas, ≤ 40k triángulos, origen bajo el centro', () => {
    const t = buildTargetTruck(new ModelKit());
    checkTarget(t, 6, 7.5);
    expect(t.wheelRadiusM).toBeCloseTo(0.57, 2);
  });

  it('BTR-82A: 8 ruedas, ≤ 40k triángulos, origen bajo el centro', () => {
    const t = buildTargetApc(new ModelKit());
    checkTarget(t, 8, 7.8);
  });
});
