// ============================================================================
//  mortarM120.ts — Mortero M120/M121 120 mm (placa base, bípode, tubo, visor M67).
//  DUEÑO: agente 3D-TRACKED (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

export const buildMortarM120: PlatformBuilder = (ctx) =>
  placeholderRig(ctx, {
    hullW: 0.8, hullL: 0.8, hullH: 0.1, pivotY: 0, pivotZ: 0.25, barrelL: 1.76, barrelR: 0.07,
  });
