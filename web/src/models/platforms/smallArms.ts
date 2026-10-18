// ============================================================================
//  smallArms.ts — Armas ligeras: pistola 9 mm, fusil 5.56, M240 (trípode
//  M192) y M2 Browning (trípode M3).
//  DUEÑO: agente 3D-SMALL (ver docs/PLAN_V2.md). Provisional: placeholder.
// ============================================================================
import type { PlatformBuilder } from '../rig';
import { placeholderRig } from './_placeholder';

const tiny = { hullW: 0.3, hullL: 0.6, hullH: 0.1, pivotY: 0.1, pivotZ: 1.0, barrelR: 0.012 };

export const buildPistol: PlatformBuilder = (ctx) => placeholderRig(ctx, { ...tiny, barrelL: 0.2 });
export const buildRifle: PlatformBuilder = (ctx) => placeholderRig(ctx, { ...tiny, barrelL: 0.6 });
export const buildM240: PlatformBuilder = (ctx) => placeholderRig(ctx, { ...tiny, barrelL: 1.0 });
export const buildM2: PlatformBuilder = (ctx) => placeholderRig(ctx, { ...tiny, barrelL: 1.4 });
