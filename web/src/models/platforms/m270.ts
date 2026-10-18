// ============================================================================
//  m270.ts — Lanzacohetes múltiple M270A1 MLRS (2 contenedores: LPC de M26 o pods ATACMS).
//  DUEÑO: agente 3D-TRACKED (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

export const buildM270: PlatformBuilder = (ctx) =>
  placeholderRig(ctx, {
    hullW: 3, hullL: 6.9, hullH: 1.8, pivotY: -1.2, pivotZ: 2.4, barrelL: 4.2, barrelR: 0.6,
  });
