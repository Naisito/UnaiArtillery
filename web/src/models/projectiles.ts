// ============================================================================
//  projectiles.ts — Modelos de proyectil por arma (granada 155 con banda de
//  forzamiento y espoleta, Excalibur con canards, bomba de mortero con
//  aletas, cohete 227 mm, misil, bala…).
//  DUEÑO: agente 3D-SMALL (ver docs/PLAN_V2.md). Provisional.
// ============================================================================
import * as THREE from 'three';
import type { Weapon, WeaponId } from '../ballistics';
import { PAINT, type ModelKit } from './kit';
import type { ProjectileModel } from './rig';

export function buildProjectile(kit: ModelKit, _weaponId: WeaponId, weapon: Weapon): ProjectileModel {
  const d = weapon.round.diameter;
  const len = Math.max(d * 4.5, 0.03);
  const root = new THREE.Group();
  root.add(kit.cyl(d / 2, d / 2, len * 0.7, kit.paint(PAINT.olive), { at: [0, -len * 0.15, 0] }));
  root.add(kit.cyl(d / 2, 0.001, len * 0.3, kit.steel(), { at: [0, len * 0.35, 0] }));
  const motor = weapon.category === 'Rocket' || weapon.category === 'Missile';
  return { root, lengthM: len, exhaustLocal: motor ? new THREE.Vector3(0, -len / 2, 0) : null };
}
