// ============================================================================
//  _placeholder.ts — Rig provisional (caja + tubo) para plataformas aún sin
//  modelar. Cumple el contrato de rig.ts; cada builder lo sustituye.
// ============================================================================
import * as THREE from 'three';
import { PAINT } from '../kit';
import type { PlatformRig, RigBuildContext } from '../rig';

export function placeholderRig(
  ctx: RigBuildContext,
  dims: { hullW: number; hullL: number; hullH: number; pivotY: number; pivotZ: number; barrelL: number; barrelR: number },
): PlatformRig {
  const { kit } = ctx;
  const root = new THREE.Group();
  const paint = kit.paint(PAINT.carcGreen);
  const steel = kit.steel();

  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  traverse.add(kit.box(dims.hullW, dims.hullL, dims.hullH, paint, {
    at: [0, 0, dims.hullH / 2 + 0.3], bevel: 0.05,
  }));

  const elevation = kit.group({ name: 'elevation', at: [0, dims.pivotY, dims.pivotZ] });
  traverse.add(elevation);
  const recoil = kit.group({ name: 'recoil' });
  elevation.add(recoil);
  recoil.add(kit.cyl(dims.barrelR * 1.3, dims.barrelR, dims.barrelL, steel, {
    at: [0, dims.barrelL / 2 - dims.barrelL * 0.1, 0],
  }));

  return {
    root, traverse, elevation, recoil,
    muzzleLocal: new THREE.Vector3(0, dims.barrelL * 0.9, 0),
    recoilStrokeM: 0.5,
    footprintM: Math.hypot(dims.hullW, dims.hullL) / 2,
    heightM: dims.pivotZ + 0.5,
  };
}
