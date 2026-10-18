// ============================================================================
//  soldier.ts — Soldado de dotación low-poly pero bien proporcionado, con
//  esqueleto FK y poses (jefe de pieza, apuntador, sirvientes con proyectil
//  o atacador, municionero de rodillas).  [V2 — 3D-CORE]
//
//  Espacio de modelado (rig.ts): Z arriba, mira a +Y, origen en el suelo
//  entre los pies. Estatura ~1.78 m (percentil 50 masculino) con casco,
//  chaleco portaplacas, uniforme con camuflaje tipo OCP, guantes y botas
//  coyote. Al final se APOYA en el suelo: el punto más bajo (bota o rodilla)
//  queda en z = 0 sea cual sea la pose.
// ============================================================================
import * as THREE from 'three';
import type { BoxOpts, ModelKit } from '../kit';

const D = Math.PI / 180;

/** Ángulos en grados. flex > 0 = hacia delante; abd > 0 = hacia fuera. */
export interface SoldierPose {
  /** Inclinación de la pelvis hacia delante. */
  pelvisPitch?: number;
  spinePitch?: number;
  spineYaw?: number;
  headPitch?: number;
  headYaw?: number;
  lHip?: [number, number]; lKnee?: number;
  rHip?: [number, number]; rKnee?: number;
  /** [flex, abd, giro] */
  lShoulder?: [number, number, number]; lElbow?: number;
  rShoulder?: [number, number, number]; rElbow?: number;
  /** Desplaza el peso: z extra de la pelvis tras apoyar (negativo = agacharse). */
  drop?: number;
}

export interface SoldierOpts {
  skin?: number;
  /** Factor de estatura (0.94–1.06). */
  scale?: number;
  pose: SoldierPose;
  /** Objeto que sujeta la mano derecha / izquierda (en el espacio de la mano). */
  rightHandItem?: THREE.Object3D;
  leftHandItem?: THREE.Object3D;
  /** Objeto sostenido con ambos antebrazos (en el espacio del pecho). */
  chestItem?: THREE.Object3D;
}

/** Huesos expuestos para colocar objetos en manos. */
export interface Soldier {
  root: THREE.Group;
  rightHand: THREE.Object3D;
  leftHand: THREE.Object3D;
  chest: THREE.Object3D;
}

export function buildSoldier(kit: ModelKit, opts: SoldierOpts): Soldier {
  const p = opts.pose;
  const cloth = kit.uniform();
  const vest = kit.canvas(0x5f5a43);
  const pouch = kit.canvas(0x6a6249);
  const skin = kit.paint(opts.skin ?? 0xc39a78, { roughness: 0.6, metalness: 0, wear: 0 });
  const glove = kit.canvas(0x6e5d45);
  const boot = kit.paint(0x75604a, { roughness: 0.85, metalness: 0, wear: 0.9 });
  const helmetMat = kit.paint(0x6b6550, { roughness: 0.8, metalness: 0, wear: 0.6 });
  const dark = kit.polymer(0x232421);
  const s = opts.scale ?? 1;
  // Atrezo: redondeo de 1 segmento (108 tri por caja en vez de 300).
  const box = (w: number, d: number, h: number, mat: THREE.Material, o: BoxOpts = {}) =>
    kit.box(w, d, h, mat, { ...o, bevelSegments: 1 });

  const root = new THREE.Group();
  root.name = 'soldier';
  const body = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);

  // -- Pelvis -----------------------------------------------------------------
  const pelvis = kit.group({ name: 'pelvis', at: [0, 0, 0.94] });
  pelvis.rotation.x = -(p.pelvisPitch ?? 0) * D;
  body.add(pelvis);
  pelvis.add(box(0.34, 0.21, 0.2, cloth, { at: [0, 0, 0.02], bevel: 0.06 }));
  // Cinturón táctico con bolsas.
  pelvis.add(box(0.36, 0.23, 0.06, vest, { at: [0, 0, 0.1], bevel: 0.02 }));
  pelvis.add(box(0.09, 0.07, 0.1, pouch, { at: [-0.17, -0.04, 0.06], bevel: 0.02 }));
  pelvis.add(box(0.09, 0.07, 0.1, pouch, { at: [0.17, -0.06, 0.06], bevel: 0.02 }));

  // -- Piernas ----------------------------------------------------------------
  const leg = (side: 1 | -1, hip: [number, number] = [0, 0], knee = 0) => {
    const h = kit.group({ at: [side * 0.1, 0, -0.04] });
    h.rotation.order = 'XYZ';
    h.rotation.set(hip[0] * D, -side * hip[1] * D, 0);
    pelvis.add(h);
    h.add(capsule(kit, 0.085, 0.43, cloth, 0.065));
    h.add(box(0.1, 0.06, 0.13, pouch, { at: [side * 0.08, 0, -0.2], bevel: 0.02 })); // bolsillo de muslo
    const k = kit.group({ at: [0, 0, -0.44] });
    k.rotation.x = -knee * D;
    h.add(k);
    k.add(box(0.11, 0.06, 0.12, dark, { at: [0, 0.05, -0.02], bevel: 0.03 })); // rodillera
    k.add(capsule(kit, 0.065, 0.43, cloth, 0.05));
    const a = kit.group({ at: [0, 0, -0.43] });
    k.add(a);
    a.add(box(0.11, 0.28, 0.1, boot, { at: [0, 0.06, -0.04], bevel: 0.035 }));
    a.add(box(0.1, 0.12, 0.13, boot, { at: [0, -0.02, 0.02], bevel: 0.035 }));
    return { hip: h, knee: k, ankle: a };
  };
  const L = leg(-1, p.lHip, p.lKnee);
  const R = leg(1, p.rHip, p.rKnee);

  // -- Tronco -----------------------------------------------------------------
  const spine = kit.group({ name: 'spine', at: [0, 0, 0.1] });
  spine.rotation.order = 'ZXY';
  spine.rotation.set(-(p.spinePitch ?? 0) * D, 0, -(p.spineYaw ?? 0) * D);
  pelvis.add(spine);
  spine.add(box(0.36, 0.22, 0.42, cloth, { at: [0, 0, 0.22], bevel: 0.08 }));
  // Chaleco portaplacas + cargadores + radio a la espalda.
  spine.add(box(0.38, 0.27, 0.34, vest, { at: [0, 0.005, 0.25], bevel: 0.05 }));
  for (const x of [-0.1, 0, 0.1]) spine.add(box(0.085, 0.05, 0.13, pouch, { at: [x, 0.16, 0.19], bevel: 0.015 }));
  spine.add(box(0.2, 0.08, 0.24, pouch, { at: [0.02, -0.17, 0.26], bevel: 0.03 }));
  spine.add(kit.cyl(0.006, 0.006, 0.3, dark, { at: [0.08, -0.2, 0.5], segments: 4, axis: 'z' })); // antena
  const chest = kit.group({ name: 'chest', at: [0, 0.16, 0.24] });
  spine.add(chest);

  // -- Cabeza -----------------------------------------------------------------
  const neck = kit.group({ at: [0, 0, 0.47] });
  neck.rotation.order = 'ZXY';
  neck.rotation.set(-(p.headPitch ?? 0) * D, 0, -(p.headYaw ?? 0) * D);
  spine.add(neck);
  neck.add(kit.cyl(0.05, 0.05, 0.1, skin, { axis: 'z', at: [0, 0, 0.03], segments: 10 }));
  const head = kit.sphere(0.1, skin, { at: [0, 0.01, 0.15], segments: 12 });
  head.scale.set(0.92, 1.05, 1.15);
  neck.add(head);
  neck.add(box(0.05, 0.05, 0.05, skin, { at: [0, 0.1, 0.13], bevel: 0.02 })); // nariz/rasgos
  neck.add(box(0.17, 0.04, 0.035, dark, { at: [0, 0.088, 0.17], bevel: 0.012 })); // gafas balísticas
  // Casco (ACH/ECH): casquete + borde + soporte NVG + cubierta.
  const helmetGeo = new THREE.SphereGeometry(0.135, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.56);
  helmetGeo.rotateX(Math.PI / 2); // polo +Y → +Z
  const helmet = kit.place(kit.mesh(helmetGeo, helmetMat), { at: [0, -0.005, 0.15] });
  helmet.scale.set(1, 1.08, 0.95);
  neck.add(helmet);
  neck.add(box(0.05, 0.03, 0.04, dark, { at: [0, 0.135, 0.24], bevel: 0.01 }));
  neck.add(box(0.27, 0.02, 0.03, dark, { at: [0, 0.0, 0.11], bevel: 0.01 })); // barboquejo/borde
  // -- Brazos -----------------------------------------------------------------
  const arm = (side: 1 | -1, sh: [number, number, number] = [0, 8, 0], elbow = 10) => {
    const shoulder = kit.group({ at: [side * 0.21, 0, 0.4] });
    shoulder.rotation.order = 'XYZ';
    shoulder.rotation.set(sh[0] * D, -side * sh[1] * D, side * sh[2] * D);
    spine.add(shoulder);
    shoulder.add(kit.sphere(0.07, cloth, { segments: 8 }));
    shoulder.add(capsule(kit, 0.058, 0.3, cloth, 0.05));
    const e = kit.group({ at: [0, 0, -0.3] });
    e.rotation.x = elbow * D;
    shoulder.add(e);
    e.add(capsule(kit, 0.048, 0.26, cloth, 0.042));
    const hand = kit.group({ at: [0, 0, -0.29] });
    e.add(hand);
    hand.add(box(0.06, 0.1, 0.11, glove, { at: [0, 0.01, -0.03], bevel: 0.025 }));
    return { shoulder, elbow: e, hand };
  };
  const LA = arm(-1, p.lShoulder, p.lElbow);
  const RA = arm(1, p.rShoulder, p.rElbow);

  if (opts.rightHandItem) RA.hand.add(opts.rightHandItem);
  if (opts.leftHandItem) LA.hand.add(opts.leftHandItem);
  if (opts.chestItem) chest.add(opts.chestItem);

  // -- Apoyo en el suelo -------------------------------------------------------
  root.updateMatrixWorld(true);
  const tmp = new THREE.Vector3();
  let minZ = Infinity;
  for (const leg of [L, R]) {
    for (const [obj, off] of [[leg.ankle, -0.09], [leg.knee, -0.07]] as const) {
      obj.getWorldPosition(tmp);
      minZ = Math.min(minZ, tmp.z + off * s);
    }
  }
  body.position.z = -minZ + (p.drop ?? 0);
  void L; void R;
  return { root, rightHand: RA.hand, leftHand: LA.hand, chest };
}

/** Cápsula colgando de su articulación hacia −Z (longitud total `len`). */
function capsule(kit: ModelKit, r0: number, len: number, mat: THREE.Material, r1 = r0): THREE.Mesh {
  // Tronco de cono con remates esféricos: más natural que una cápsula recta.
  const prof: Array<[number, number]> = [];
  const n = 3;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([Math.sin(a) * r1, -len + r1 - Math.cos(a) * r1]);
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([Math.cos(a) * r0, -r0 * 0.3 + Math.sin(a) * r0 * 0.6]);
  }
  prof.push([0, r0 * 0.3]);
  return kit.lathe(prof, mat, { axis: 'z', segments: 8 });
}

// ---------------------------------------------------------------------------
//  Poses de dotación.
// ---------------------------------------------------------------------------

export const POSES = {
  /** De pie, relajado, brazos caídos. */
  stand: {
    lHip: [2, 3], rHip: [-2, 3], lKnee: 4, rKnee: 4,
    lShoulder: [4, 8, 0], rShoulder: [-4, 8, 0], lElbow: 12, rElbow: 10,
  },
  /** Jefe de pieza: auricular de radio a la oreja, mirando a la pieza. */
  chief: {
    lHip: [6, 6], rHip: [-4, 4], lKnee: 4, rKnee: 8, spineYaw: -8, headYaw: -10, headPitch: -4,
    lShoulder: [35, 42, -30], lElbow: 128, rShoulder: [12, 10, 0], rElbow: 70,
  },
  /** Apuntador: inclinado, ambas manos al volante. */
  gunner: {
    pelvisPitch: 8, spinePitch: 18, headPitch: 6, lHip: [16, 5], rHip: [4, 5], lKnee: 22, rKnee: 14,
    lShoulder: [58, 14, 0], rShoulder: [64, 10, 0], lElbow: 48, rElbow: 42,
  },
  /** Sirviente con proyectil de 155 en brazos. */
  carryShell: {
    pelvisPitch: -4, spinePitch: -6, headPitch: 10, lHip: [14, 4], rHip: [-10, 4], lKnee: 10, rKnee: 16,
    lShoulder: [42, 16, 0], rShoulder: [42, 16, 0], lElbow: 88, rElbow: 88,
  },
  /** Atacador: el palo hacia la recámara. */
  ram: {
    pelvisPitch: 10, spinePitch: 14, lHip: [24, 6], rHip: [-16, 6], lKnee: 26, rKnee: 8,
    lShoulder: [70, 8, 0], rShoulder: [40, 12, 0], lElbow: 30, rElbow: 70,
  },
  /** Municionero de rodilla (rodilla derecha al suelo), manos al frente. */
  kneel: {
    lHip: [82, 6], lKnee: 88, rHip: [-12, 8], rKnee: 100, spinePitch: 16, headPitch: 12,
    lShoulder: [48, 12, 0], rShoulder: [54, 10, 0], lElbow: 60, rElbow: 56,
  },
} satisfies Record<string, SoldierPose>;
