// ============================================================================
//  m777.ts — Obús remolcado M777A2 155 mm L39.
//  DUEÑO: agente 3D-CORE (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

export const buildM777: PlatformBuilder = (ctx) =>
  placeholderRig(ctx, {
    hullW: 2.8, hullL: 7.5, hullH: 0.6, pivotY: 0.4, pivotZ: 1.3, barrelL: 6, barrelR: 0.1,
  });
