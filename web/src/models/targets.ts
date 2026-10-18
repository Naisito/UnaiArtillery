// ============================================================================
//  targets.ts — Blancos: camión hostil (Ural-4320) del reto móvil y otros
//  vehículos objetivo.
//  DUEÑO: agente 3D-WHEELED (ver docs/PLAN_V2.md). Provisional.
// ============================================================================
import * as THREE from 'three';
import { PAINT, type ModelKit } from './kit';
import type { TargetModel } from './rig';

export function buildTargetTruck(kit: ModelKit): TargetModel {
  const root = new THREE.Group();
  root.add(kit.box(2.5, 7.4, 1.6, kit.paint(PAINT.russianGreen), { at: [0, 0, 1.9], bevel: 0.05 }));
  const wheels: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    for (const wy of [-2.2, -0.8, 2.6]) {
      const w = kit.wheel(0.62, 0.4, { at: [sx * 1.0, wy, 0.62], side: sx });
      root.add(w);
      wheels.push(w);
    }
  }
  return { root, wheels, wheelRadiusM: 0.62, footprintM: 3.8 };
}

export function buildTargetApc(kit: ModelKit): TargetModel {
  return buildTargetTruck(kit);
}
