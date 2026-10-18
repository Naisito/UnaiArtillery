// ============================================================================
//  himars.ts — M142 HIMARS (camión FMTV 6x6, 1 contenedor; variantes GMLRS/ER/PrSM).
//  DUEÑO: agente 3D-WHEELED (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

export const buildHimars: PlatformBuilder = (ctx) =>
  placeholderRig(ctx, {
    hullW: 2.4, hullL: 7, hullH: 1.6, pivotY: -1.6, pivotZ: 2.3, barrelL: 4.2, barrelR: 0.6,
  });
