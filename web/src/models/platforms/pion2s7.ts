// ============================================================================
//  pion2s7.ts — Cañón autopropulsado 2S7 Pion 203 mm L55.
//  DUEÑO: agente 3D-TRACKED (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

export const buildPion2S7: PlatformBuilder = (ctx) =>
  placeholderRig(ctx, {
    hullW: 3.4, hullL: 7.6, hullH: 1.6, pivotY: 0, pivotZ: 2.5, barrelL: 11.2, barrelR: 0.13,
  });
