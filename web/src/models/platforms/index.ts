// ============================================================================
//  platforms/index.ts — Registro arma → plataforma → builder.  [V2]
//  Cada builder vive en su propio archivo (un dueño por archivo, ver
//  docs/PLAN_V2.md); este registro no debería necesitar cambios.
// ============================================================================
import type { WeaponId } from '../../ballistics';
import type { PlatformBuilder, PlatformKey } from '../rig';
import { buildHimars } from './himars';
import { buildM109A7 } from './m109a7';
import { buildM270 } from './m270';
import { buildM777 } from './m777';
import { buildMortarM120 } from './mortarM120';
import { buildPion2S7 } from './pion2s7';
import { buildM2, buildM240, buildPistol, buildRifle } from './smallArms';

export const PLATFORM_OF: Record<WeaponId, PlatformKey> = {
  mortar120: 'mortar-m120',
  m777: 'm777',
  excalibur: 'm777',
  m109: 'm109a7',
  pion2s7: '2s7-pion',
  m26: 'm270-mlrs',
  gmlrs: 'm142-himars',
  ergmlrs: 'm142-himars',
  prsm: 'm142-himars',
  tacticalMissile: 'm270-mlrs', // ATACMS (MGM-140): 610 mm, 1670 kg — sale de M270A1/HIMARS
  pistol9: 'pistol',
  rifle556: 'rifle',
  mg762: 'm240',
  m2browning: 'm2',
};

export const PLATFORM_BUILDERS: Record<PlatformKey, PlatformBuilder> = {
  'mortar-m120': buildMortarM120,
  'm777': buildM777,
  'm109a7': buildM109A7,
  '2s7-pion': buildPion2S7,
  'm270-mlrs': buildM270,
  'm142-himars': buildHimars,
  'pistol': buildPistol,
  'rifle': buildRifle,
  'm240': buildM240,
  'm2': buildM2,
};

/** Primer arma que usa cada plataforma (para el Model Lab). */
export function weaponForPlatform(key: PlatformKey): WeaponId {
  return (Object.keys(PLATFORM_OF) as WeaponId[]).find((w) => PLATFORM_OF[w] === key) ?? 'm777';
}
