// ============================================================================
//  smallArms.ts — Armas ligeras en su montaje de galería de tiro.  [V2]
//  DUEÑO: agente 3D-SMALL (ver docs/PLAN_V2.md).
//
//    * pistol — pistola 9 mm clase Glock 17/M17 sujeta en una máquina de
//      tiro (rest tipo Ransom) sobre un banco de pedestal (boca a ~1.10 m).
//    * rifle  — carabina M4A1 (cañón 14.5", raíl RIS, M68 CCO, PEQ-15,
//      linterna) en la cuna de un trípode de tiro (boca a ~1.23 m).
//    * m240   — M240B sobre trípode M192 con mecanismo T&E, caja de 100
//      cartuchos y cinta eslabonada.
//    * m2     — M2HB sobre trípode M3 con T&E, asideros de pala y caja M2A1.
//
//  Rig (rig.ts): traverse = lo que gira en azimut (plato, rótula o pivote del
//  trípode), elevation = balancín/cuna/muñón, recoil = lo que retrocede
//  (corredera de la pistola, el arma entera en fusil y M240, el cañón en la
//  M2). Los trípodes de ametralladora se "re-asientan": su `animate` gira las
//  patas para que el arma nunca quede más de ±22° fuera del eje del trípode
//  (como la dotación al cambiar de sector) y mueve el husillo del T&E.
// ============================================================================
import * as THREE from 'three';
import type { PlatformBuilder, PlatformRig } from '../rig';
import { DEG } from '../rig';
import { buildM240Body, buildM4Body, buildPistolBody, smallPalette } from '../parts/small-guns';
import {
  ammoBox100, machineRestBase, machineRestRocker, makeTripodFollower, mgTripod, rifleSaddle,
  rifleTripodLegs, rifleTripodPan, testStandBase,
} from '../parts/small-mounts';
import { beltAlong, mergeStatic } from '../parts/small-util';
import { placeholderRig } from './_placeholder';

const tiny = { hullW: 0.3, hullL: 0.6, hullH: 0.1, pivotY: 0.1, pivotZ: 1.0, barrelR: 0.012 };

/** Fusiona por material cada nodo del rig por separado (sin cruzar pivotes). */
function bake(kit: Parameters<PlatformBuilder>[0]['kit'], nodes: THREE.Object3D[]): void {
  for (const n of nodes) mergeStatic(kit, n, nodes.filter((o) => o !== n));
}

// ============================================================================
//  Pistola en máquina de tiro sobre banco de pedestal
// ============================================================================
export const buildPistol: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const P = smallPalette(kit);
  const root = new THREE.Group();
  root.name = 'pistol-rig';
  const topZ = 0.94;
  root.add(testStandBase(kit, topZ));

  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  const rest = machineRestBase(kit, topZ);
  traverse.add(rest.group);

  const elevation = kit.group({ name: 'elevation', at: rest.pivot });
  traverse.add(elevation);
  // Arma en coordenadas de elevación: ánima 85 mm sobre el eje del balancín,
  // cara trasera de la corredera 60 mm por delante.
  const gunAt = new THREE.Vector3(0, 0.06, 0.085);
  const body = buildPistolBody(kit, P);
  body.fixed.position.copy(gunAt);
  elevation.add(body.fixed);
  elevation.add(machineRestRocker(kit, {
    y0: gunAt.y - 0.004, y1: gunAt.y + 0.07, z0: gunAt.z - 0.112, z1: gunAt.z - 0.03, halfW: 0.015,
  }));

  const recoil = kit.group({ name: 'recoil' });
  elevation.add(recoil);
  body.moving.position.copy(gunAt);
  recoil.add(body.moving);

  bake(kit, [root, traverse, elevation, recoil]);
  const rig: PlatformRig = {
    root, traverse, elevation, recoil,
    muzzleLocal: body.muzzle.clone().add(gunAt),
    recoilStrokeM: 0.024,
    footprintM: 0.42,
    heightM: rest.pivot[2] + gunAt.z + 0.025,
  };
  return rig;
};

// ============================================================================
//  Carabina M4A1 en la cuna de un trípode de tiro
// ============================================================================
export const buildRifle: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const P = smallPalette(kit);
  const root = new THREE.Group();
  root.name = 'rifle-rig';
  const hubZ = 1.055, tiltZ = 1.155;
  root.add(rifleTripodLegs(kit, hubZ));
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  traverse.add(rifleTripodPan(kit, hubZ, tiltZ));
  const elevation = kit.group({ name: 'elevation', at: [0, 0, tiltZ] });
  traverse.add(elevation);
  // El eje de basculación queda bajo el guardamanos, 235 mm por delante de
  // la cara trasera del cajón y 72 mm bajo el ánima.
  const body = buildM4Body(kit, P);
  const gunAt = new THREE.Vector3(0, -0.235, 0.072);
  elevation.add(rifleSaddle(kit, gunAt.z + body.railBottomZ, gunAt.z, 0.0275));
  const recoil = kit.group({ name: 'recoil' });
  elevation.add(recoil);
  body.moving.position.copy(gunAt);
  recoil.add(body.moving);

  bake(kit, [root, traverse, elevation, recoil]);
  return {
    root, traverse, elevation, recoil,
    muzzleLocal: body.muzzle.clone().add(gunAt),
    recoilStrokeM: 0.014,
    footprintM: 0.62,
    heightM: tiltZ + gunAt.z + 0.09,
  };
};
// ============================================================================
//  M240B sobre trípode M192 (LWGM) con T&E, caja de 100 y cinta M13
// ============================================================================
export const buildM240: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const P = smallPalette(kit);
  const root = new THREE.Group();
  root.name = 'm240-rig';
  const body = buildM240Body(kit, P);
  const fm = body.frontMount, rm = body.rearMount;
  const trunnionZ = 0.50;
  const tri = mgTripod(kit, {
    style: 'm192', headZ: 0.405, trunnionZ,
    frontFoot: [0, 0.74, 0], rearFoot: [0.42, -0.64, 0],
    rearPin: { y: rm.y - fm.y, z: rm.z - fm.z }, teMinDeg: -12, teMaxDeg: 12,
  });
  root.add(tri.mount);
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  traverse.add(tri.pintle, tri.teLower, tri.teUpper);
  const elevation = kit.group({ name: 'elevation', at: [0, 0, trunnionZ] });
  traverse.add(elevation);
  const recoil = kit.group({ name: 'recoil' });
  elevation.add(recoil);

  // Caja de 100 colgada a la izquierda y cinta entrando en la bandeja.
  body.moving.add(ammoBox100(kit, { at: [-0.081, -0.105, -0.128] }));
  body.moving.add(beltAlong(kit, {
    path: [[-0.098, -0.10, 0.018], [-0.092, -0.10, 0.042], [-0.076, -0.10, 0.056], [-0.058, -0.10, 0.050], [-0.040, -0.10, 0.032]],
    count: 7, cartLen: 0.0712, caseD: 0.0119, bulletD: 0.0078, bulletFrac: 0.29,
    noseDir: [0, 1, 0], brass: P.brass, bullet: P.copper, link: P.park,
    tip: kit.paint(0xd2501e, { roughness: 0.55, metalness: 0.1 }), tipEvery: 5,
  }));
  const gunAt = fm.clone().negate();
  body.moving.position.copy(gunAt);
  recoil.add(body.moving);

  bake(kit, [root, tri.mount, traverse, tri.teUpper, elevation, recoil]);
  const follow = makeTripodFollower(22);
  return {
    root, traverse, elevation, recoil,
    muzzleLocal: body.muzzle.clone().add(gunAt),
    recoilStrokeM: 0.012,
    footprintM: tri.footprintM,
    heightM: trunnionZ + gunAt.z + 0.16,
    extraAnimated: [tri.mount, tri.teUpper],
    animate(s) {
      tri.mount.rotation.z = -follow(s.azimuthDeg) * DEG;
      tri.updateTE(s.elevationDeg);
    },
  };
};
export const buildM2: PlatformBuilder = (ctx) => placeholderRig(ctx, { ...tiny, barrelL: 1.4 });
