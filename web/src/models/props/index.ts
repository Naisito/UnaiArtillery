// ============================================================================
//  props/index.ts — Atrezo de la posición de batería por plataforma.
//  [V2 — 3D-CORE]
//
//  Devuelve los nodos RAÍZ del atrezo ya colgados del rig (el runtime los
//  conserva como nodos propios para mostrarlos/ocultarlos con
//  GunModel.setPropsVisible). Criterio:
//    * piezas de tubo y morteros: dotación completa en sus puestos + punto
//      de munición (palés, cargas, cajas, sacos terreros, red de camuflaje);
//    * lanzacohetes: un par de tripulantes junto a la cabina;
//    * armas ligeras: nada.
//  La dotación que trabaja en la pieza gira con ella (traverse); el punto
//  de munición queda fijo respecto al afuste/casco.
// ============================================================================
import * as THREE from 'three';
import type { Weapon, WeaponId } from '../../ballistics';
import type { ModelKit } from '../kit';
import type { PlatformKey, PlatformRig } from '../rig';
import {
  aimingCircle, ammoCrate, camoNet, chargeStack, looseCharges, rammerStaff, sandbagArc, shell155, shellPallet,
} from './ammo';
import { buildSoldier, POSES, type SoldierPose } from './soldier';

export interface PropsContext {
  kit: ModelKit;
  key: PlatformKey;
  rig: PlatformRig;
  weapon: Weapon;
  weaponId: WeaponId;
}

const SKINS = [0xc39a78, 0x8d5f43, 0xe2b996, 0xa97a55, 0x6f4a33, 0xd4a884];

/** Fusil M4 terciado a la espalda (en el espacio del pecho). */
function slungRifle(kit: ModelKit): THREE.Group {
  const g = new THREE.Group();
  const black = kit.polymer(0x1d1e1c);
  const steel = kit.steel(0x2a2b2a, { roughness: 0.5 });
  g.add(kit.box(0.04, 0.42, 0.07, black, { bevel: 0.01 }));
  g.add(kit.box(0.035, 0.2, 0.08, black, { at: [0, -0.3, -0.01], bevel: 0.012 }));
  g.add(kit.cyl(0.008, 0.008, 0.34, steel, { at: [0, 0.37, 0.01], segments: 8 }));
  g.add(kit.box(0.025, 0.06, 0.12, black, { at: [0, 0.05, -0.08], rotDeg: [-12, 0, 0], bevel: 0.006 }));
  // Cruzado sobre la espalda: cañón hacia arriba-izquierda.
  g.rotation.set(0, 0, 0);
  g.rotation.order = 'YXZ';
  g.rotation.set(Math.PI / 2 - 0.5, 0, 0);
  g.position.set(0, -0.3, 0.02);
  const holder = new THREE.Group();
  holder.add(g);
  holder.rotation.y = 0.7;
  return holder;
}

function soldier(kit: ModelKit, pose: SoldierPose, i: number, at: [number, number], headingDeg: number,
  extra: { right?: THREE.Object3D; left?: THREE.Object3D; chest?: THREE.Object3D; rifle?: boolean } = {}): THREE.Group {
  const s = buildSoldier(kit, {
    pose, skin: SKINS[i % SKINS.length], scale: 0.96 + ((i * 37) % 9) * 0.01,
    rightHandItem: extra.right, leftHandItem: extra.left, chestItem: extra.chest,
  });
  if (extra.rifle) {
    const r = slungRifle(kit);
    r.position.set(0, -0.32, -0.02);
    s.chest.add(r);
  }
  s.root.position.set(at[0], at[1], 0);
  // Rumbo: 0 = mira a +Y; positivo horario (como el azimut).
  s.root.rotation.z = -headingDeg * (Math.PI / 180);
  return s.root;
}

function named<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

/** Punto de munición con palés, cargas, cajas, sacos y red. */
function ammoPoint(kit: ModelKit, opts: { net: boolean; bearer: boolean; seed: number }): THREE.Group {
  const g = new THREE.Group();
  g.add(shellPallet(kit, { at: [0, 0, 0], rotDeg: [0, 0, 8] }));
  g.add(shellPallet(kit, { at: [0.15, 0.62, 0], rotDeg: [0, 0, -4], count: 5 }));
  g.add(chargeStack(kit, { at: [-1.35, 0.25, 0], rotDeg: [0, 0, 84] }));
  g.add(looseCharges(kit, { at: [1.25, -0.25, 0], rotDeg: [0, 0, 20], n: 5 }));
  g.add(ammoCrate(kit, { at: [1.15, 0.75, 0], rotDeg: [0, 0, -12], label: 'FUZE M739A1' }));
  g.add(ammoCrate(kit, { at: [1.2, 0.75, 0.31], rotDeg: [0, 0, -6], size: [0.6, 0.32, 0.24] }));
  g.add(ammoCrate(kit, { at: [-0.5, 1.35, 0], rotDeg: [0, 0, 30], wood: true, label: 'PRIMER M82' }));
  // Proyectil suelto tumbado, ya espoletado (eje +Y del proyectil → horizontal).
  g.add(kit.place(shell155(kit, { fuzed: true }), { at: [0.05, -0.95, 0.078], rotDeg: [0, 0, -72] }));
  g.add(sandbagArc(kit, { center: [0, 0.2, 0], radius: 2.35, a0: 200, a1: 340, layers: 3 }));
  if (opts.bearer) {
    // Municionero de rodillas espoletando un proyectil.
    g.add(soldier(kit, POSES.kneel, opts.seed + 5, [0.45, -1.35], 10));
  }
  if (opts.net) {
    g.add(camoNet(kit, {
      at: [0, 0.3, 0], w: 6.2, d: 5.2, height: 2.2,
      poles: [[-1.4, -0.8], [1.4, -0.8], [-1.3, 1.1], [1.5, 1.0]],
    }));
  }
  return g;
}

/** Atrezo para la plataforma; devuelve las raíces conservables. */
export function buildBatteryProps(ctx: PropsContext): THREE.Object3D[] {
  const { kit, key, rig } = ctx;
  const out: THREE.Object3D[] = [];
  const attach = (parent: THREE.Object3D, obj: THREE.Object3D, name: string) => {
    parent.add(named(obj, name));
    out.push(obj);
  };

  switch (key) {
    case 'm777': {
      const lower = rig.traverse.getObjectByName('lowerCarriage') ?? rig.root;
      // Dotación en la pieza (gira con el afuste superior).
      const crewGun = new THREE.Group();
      crewGun.add(soldier(kit, POSES.gunner, 0, [-1.12, 0.62], 95));         // apuntador (volante de dirección)
      crewGun.add(soldier(kit, POSES.gunner, 1, [1.12, 0.6], -95));          // ayudante (volante de elevación)
      attach(rig.traverse, crewGun, 'props_crew_gun');
      // Sirvientes detrás de la culata y jefe de pieza (respecto al afuste).
      const crewRear = new THREE.Group();
      const shell = shell155(kit);
      shell.rotation.z = Math.PI / 2; // de lado sobre los antebrazos
      shell.position.set(0.32, 0.14, -0.06);
      crewRear.add(soldier(kit, POSES.carryShell, 2, [-0.22, -2.75], 4, { chest: shell }));
      crewRear.add(soldier(kit, POSES.ram, 3, [0.3, -3.55], -6));
      // Atacador sujeto a dos manos, apuntando a la recámara.
      crewRear.add(rammerStaff(kit, { len: 2.4, at: [0.27, -2.55, 1.08], rotDeg: [-9, 0, 4] }));
      crewRear.add(soldier(kit, POSES.chief, 4, [-2.5, -3.0], 35, { rifle: true }));
      attach(lower, crewRear, 'props_crew_rear');
      const ap = ammoPoint(kit, { net: true, bearer: true, seed: 0 });
      ap.position.set(-5.6, -5.4, 0);
      ap.rotation.z = 0.35;
      attach(lower, ap, 'props_ammo');
      attach(lower, aimingCircle(kit, { at: [-7.5, 3.5, 0] }), 'props_aiming');
      break;
    }
    case 'm109a7':
    case '2s7-pion': {
      const box = restBox(rig);
      const back = box.min.y;
      const crew = new THREE.Group();
      const shell = shell155(kit);
      shell.rotation.z = Math.PI / 2;
      shell.position.set(0.32, 0.14, -0.06);
      crew.add(soldier(kit, POSES.carryShell, 2, [0.6, back - 1.6], 0, { chest: shell }));
      crew.add(soldier(kit, POSES.stand, 4, [-box.max.x - 1.0, back + 1.2], 70, { rifle: true }));
      attach(rig.root, crew, 'props_crew');
      const ap = ammoPoint(kit, { net: false, bearer: true, seed: 1 });
      ap.position.set(1.8, back - 4.2, 0);
      ap.rotation.z = -0.2;
      attach(rig.root, ap, 'props_ammo');
      break;
    }
    case 'mortar-m120': {
      const crew = new THREE.Group();
      crew.add(soldier(kit, POSES.kneel, 0, [-0.85, 0.25], 80));
      crew.add(soldier(kit, POSES.kneel, 1, [0.75, 0.45], -100));
      crew.add(soldier(kit, POSES.kneel, 2, [0.2, -1.6], 0));
      crew.add(soldier(kit, POSES.chief, 3, [-2.2, -2.2], 30, { rifle: true }));
      attach(rig.traverse, crew, 'props_crew');
      const ammo = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        ammo.add(ammoCrate(kit, { at: [0.9 + (i % 2) * 0.5, -2.3 - Math.floor(i / 2) * 0.3, 0], rotDeg: [0, 0, 8 * i], size: [0.42, 0.26, 0.2], label: i === 0 ? '120MM' : undefined }));
      }
      ammo.add(sandbagArc(kit, { center: [0, 0, 0], radius: 3.2, a0: 120, a1: 240, layers: 2 }));
      attach(rig.traverse, ammo, 'props_ammo');
      break;
    }
    case 'm270-mlrs':
    case 'm142-himars': {
      const box = restBox(rig);
      const crew = new THREE.Group();
      crew.add(soldier(kit, POSES.stand, 0, [box.max.x + 1.4, box.max.y - 0.8], -110, { rifle: true }));
      crew.add(soldier(kit, POSES.chief, 1, [box.max.x + 2.1, box.max.y - 1.8], -80, { rifle: true }));
      attach(rig.root, crew, 'props_crew');
      break;
    }
    default:
      break;
  }
  return out;
}

/** Caja envolvente del rig en reposo (espacio raíz). */
function restBox(rig: PlatformRig): THREE.Box3 {
  rig.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const m = new THREE.Matrix4();
  rig.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    box.union(tmp);
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, -2, 0), new THREE.Vector3(1, 2, 2));
  return box;
}
