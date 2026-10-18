// ============================================================================
//  m109a7.ts — Obús autopropulsado M109A7 Paladin 155 mm L39.
//  DUEÑO: agente 3D-TRACKED (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

export const buildM109A7: PlatformBuilder = (ctx) =>
  placeholderRig(ctx, {
    hullW: 3.9, hullL: 6.2, hullH: 1.8, pivotY: 0.9, pivotZ: 2.4, barrelL: 6, barrelR: 0.1,
  });
