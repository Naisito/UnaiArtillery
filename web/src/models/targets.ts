// ============================================================================
//  targets.ts — Blancos de ruedas: camión hostil Ural-4320 (reto móvil) y
//  transporte blindado BTR-82A (8×8).
//  DUEÑO: agente 3D-WHEELED (ver docs/PLAN_V2.md).
//
//  Contrato (rig.ts → TargetModel): metros, X derecha, Y adelante, Z arriba,
//  origen en el suelo bajo el CENTRO del vehículo. `wheels` = ruedas que
//  giran sobre su X local (cada una es un Group centrado en su eje, sin
//  rotación propia). Presupuesto ≤ 40k triángulos por blanco.
//
//  Medidas públicas:
//    * Ural-4320: 7.366 × 2.50 × 2.715 m (3.005 con toldo), batalla
//      3.525 + 1.40 m, vía 2.00 m, neumáticos 14.00-20 (OI-25), caja de
//      3.9 m con laterales abatibles y toldo de lona sobre arcos.
//    * BTR-82A: 7.65 × 2.90 × 2.80 m, 4 ejes (≈ 1.40 + 1.80 + 1.40 m),
//      vía 2.41 m, neumáticos 13.00-18 (KI-80), torre MB2-03 con cañón
//      2A72 de 30 mm, PKTM coaxial, 6 lanzafumígenos 902V.
//  Referencias visuales: fotos públicas (Wikimedia Commons) de ambos.
// ============================================================================
import * as THREE from 'three';
import { PAINT, type ModelKit, type V3 } from './kit';
import {
  beamAxle, boltRow, buildWheel, cbox, consolidate, fenderArc, grabHandle, hull, hullSym, jerrycan,
  ladderFrame, lampRect, lampRound, leafSpring, mudflap, prismY, propShaft, roundRectRing, stepLadder,
  stowBox, whipAntenna,
} from './parts/trucks';
import type { TargetModel } from './rig';

const DEG = Math.PI / 180;

// ============================================================================
//  Ural-4320
// ============================================================================

const U_HALF_L = 3.683;
const U_R = 0.57;
const U_TW = 0.37;
const U_RIM = 0.254;
const U_AXLE_Z = 0.555;
const U_TRACK = 2.0;
const U_YF = 2.433;
const U_YR1 = -1.092;
const U_YR2 = -2.492;
const U_FRAME_TOP = 1.12;
const U_CAB_F = 1.68;   // base del parabrisas
const U_CAB_R = 0.56;   // pared trasera
const U_CAB_HW = 1.15;
const U_ROOF = 2.715;
const U_BED_F = 0.12;
const U_BED_R = -U_HALF_L;
const U_BED_HW = 1.25;
const U_FLOOR = 1.5;
const U_SIDE_TOP = 2.05;
const U_TENT_TOP = 3.005;

interface UralMats {
  body: THREE.MeshStandardMaterial;
  bodyDark: THREE.MeshStandardMaterial;
  chassis: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  canvas: THREE.MeshStandardMaterial;
  canvasDark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
}

function uralMats(kit: ModelKit): UralMats {
  return {
    body: kit.paint(PAINT.russianGreen, { wear: 0.35 }),
    bodyDark: kit.paint(0x434d30, { wear: 0.5, roughness: 0.8 }),
    chassis: kit.paint(0x22241d, { wear: 0.6, roughness: 0.85, metalness: 0.3 }),
    dark: kit.paint(0x15160f, { roughness: 0.9, metalness: 0.1 }),
    canvas: kit.canvas(0x575a3d),
    canvasDark: kit.canvas(0x3f4230),
    steel: kit.steel(),
    glass: kit.glass(),
    rubber: kit.rubber(),
    amber: kit.emissive(0xd88412, 0.3),
    red: kit.emissive(0xb01a10, 0.35),
    white: kit.paint(0xd9d8cc, { roughness: 0.7, metalness: 0.05 }),
  };
}

/** Camión Ural-4320 con caja y toldo (blanco móvil del reto). */
export function buildTargetTruck(kit: ModelKit): TargetModel {
  const M = uralMats(kit);
  const root = new THREE.Group();
  root.name = 'ural-4320';
  const body = kit.group({ name: 'ural-body' });
  root.add(body);

  uralChassis(kit, M, body);
  uralFront(kit, M, body);
  uralCab(kit, M, body);
  uralBed(kit, M, body);
  consolidate(kit, body);

  const wheels: THREE.Object3D[] = [];
  for (const y of [U_YF, U_YR1, U_YR2]) {
    for (const s of [-1, 1] as const) {
      const w = buildWheel(kit, {
        radius: U_R, width: U_TW, rimRadius: U_RIM, tread: 'ural', style: 'ural', rimColor: 0x2a2e22,
        side: s, at: [s * U_TRACK / 2, y, U_AXLE_Z], ctis: true,
        name: `wheel-${y === U_YF ? 'f' : y === U_YR1 ? 'm' : 'r'}${s > 0 ? 'r' : 'l'}`,
      });
      root.add(w);
      wheels.push(w);
    }
  }
  return { root, wheels, wheelRadiusM: U_R, footprintM: Math.hypot(1.26, U_HALF_L) };
}

function uralChassis(kit: ModelKit, M: UralMats, g: THREE.Group): void {
  g.add(ladderFrame(kit, M.chassis, {
    yFront: 3.45, yRear: -3.6, width: 0.88, zTop: U_FRAME_TOP, railH: 0.26,
    cross: [3.3, 1.6, -0.2, -1.8, -3.5],
  }));
  g.add(beamAxle(kit, M.chassis, { y: U_YF, z: U_AXLE_Z, track: U_TRACK, steer: true, diffX: 0.18 }));
  g.add(beamAxle(kit, M.chassis, { y: U_YR1, z: U_AXLE_Z, track: U_TRACK, diffX: 0.1 }));
  g.add(beamAxle(kit, M.chassis, { y: U_YR2, z: U_AXLE_Z, track: U_TRACK, diffX: 0.1 }));
  for (const s of [-1, 1] as const) {
    g.add(leafSpring(kit, M.chassis, { at: [s * 0.4, U_YF, U_AXLE_Z + 0.1], len: 1.5, leaves: 6, arch: 0.08 }));
    g.add(leafSpring(kit, M.chassis, { at: [s * 0.4, (U_YR1 + U_YR2) / 2, U_AXLE_Z + 0.1], len: 1.55, leaves: 8, arch: 0.07 }));
  }
  // Motor y caja bajo el capó, transferencia y árboles.
  g.add(cbox(kit, M.dark, 0.8, 1.3, 0.55, 0.05, { at: [0, 2.6, 1.1] }));
  g.add(cbox(kit, M.chassis, 0.55, 0.6, 0.4, 0.04, { at: [0, 0.55, 0.85] }));
  g.add(propShaft(kit, M.steel, [0.12, 0.8, 0.82], [0.18, U_YF - 0.25, U_AXLE_Z + 0.05]));
  g.add(propShaft(kit, M.steel, [0.08, 0.3, 0.8], [0.1, U_YR1 + 0.25, U_AXLE_Z + 0.08]));
  g.add(propShaft(kit, M.steel, [0.1, U_YR1 - 0.25, U_AXLE_Z + 0.1], [0.1, U_YR2 + 0.25, U_AXLE_Z + 0.08]));

  // Depósito de combustible (izq.) y caja de baterías (der.), escapes.
  g.add(kit.cyl(0.27, 0.27, 1.05, M.body, { at: [-0.86, -0.05, 0.82], segments: 18 }));
  for (const f of [-0.35, 0.35]) g.add(kit.cyl(0.285, 0.285, 0.04, M.chassis, { at: [-0.86, -0.05 + f, 0.82], segments: 18 }));
  g.add(kit.cyl(0.06, 0.06, 0.06, M.dark, { axis: 'z', at: [-0.86, 0.2, 1.1], segments: 10 }));
  g.add(stowBox(kit, M.body, M.dark, { at: [0.86, 0.15, 0.85], w: 0.42, d: 0.62, h: 0.42, side: 1 }));
  g.add(kit.cyl(0.12, 0.12, 0.8, M.chassis, { at: [0.58, -0.4, 0.86], segments: 12 }));
  g.add(kit.cyl(0.045, 0.045, 0.4, M.dark, { axis: 'x', at: [0.86, -0.75, 0.86], segments: 8 }));

  // Parachoques de perfil en U con meseta, ganchos y matrícula militar.
  g.add(cbox(kit, M.body, 2.38, 0.18, 0.26, 0.02, { at: [0, 3.59, 0.82] }));
  g.add(kit.box(2.38, 0.34, 0.03, M.body, { at: [0, 3.51, 0.965] }));
  for (const s of [-1, 1] as const) {
    g.add(kit.torus(0.06, 0.02, M.chassis, { axis: 'x', at: [s * 0.5, 3.69, 0.72], segments: 12 }));
    g.add(kit.box(0.1, 0.12, 0.14, M.chassis, { at: [s * 0.5, 3.66, 0.78] }));
    g.add(kit.box(0.08, 0.3, 0.12, M.chassis, { at: [s * 0.44, 3.4, 0.82] }));
  }
  g.add(kit.box(0.52, 0.01, 0.12, M.dark, { at: [0.55, 3.685, 0.82] }));
  for (let i = 0; i < 5; i++) g.add(kit.box(0.05, 0.004, 0.07, M.white, { at: [0.36 + i * 0.09, 3.691, 0.82] }));

  // Faldones traseros + pilotos traseros en ménsulas.
  for (const s of [-1, 1] as const) {
    g.add(mudflap(kit, { at: [s * 1.0, U_YR2 - 0.68, 0.85], w: 0.42, h: 0.6 }));
    g.add(kit.box(0.04, 0.04, 0.35, M.chassis, { at: [s * 0.95, -3.55, 1.25] }));
    g.add(lampRect(kit, M.dark, M.red, { at: [s * 0.95, -3.6, 1.1], w: 0.16, h: 0.08, rotDeg: [0, 0, 180] }));
  }
  g.add(kit.box(0.24, 0.2, 0.16, M.chassis, { at: [0, -3.6, 0.95] }));
  g.add(kit.torus(0.06, 0.02, M.steel, { axis: 'z', at: [0, -3.74, 0.92], segments: 12 }));
}

function uralFront(kit: ModelKit, M: UralMats, g: THREE.Group): void {
  // Capó largo de sección redondeada.
  const hood: Array<[number, number]> = [
    [-0.66, 1.06], [0.66, 1.06], [0.66, 1.6], [0.63, 1.72], [0.55, 1.81], [0.42, 1.87], [0.22, 1.905],
    [0, 1.915], [-0.22, 1.905], [-0.42, 1.87], [-0.55, 1.81], [-0.63, 1.72], [-0.66, 1.6],
  ];
  g.add(prismY(kit, M.body, hood, U_CAB_F - 0.02, 3.34, { smoothDeg: 30 }));
  // Junta del capó y bisagra central.
  g.add(kit.box(0.012, 1.6, 0.01, M.dark, { at: [0, 2.5, 1.918] }));
  for (const s of [-1, 1] as const) {
    g.add(kit.box(0.01, 1.6, 0.012, M.dark, { at: [s * 0.6, 2.5, 1.76], rotDeg: [0, s * 40, 0] }));
    // Emblema en rombo en el lateral del capó.
    g.add(kit.box(0.004, 0.08, 0.08, M.bodyDark, { at: [s * 0.664, 3.0, 1.5], rotDeg: [45, 0, 0] }));
  }

  // Calandra: marco redondeado + 8 lamas verticales sobre fondo oscuro.
  g.add(kit.box(1.0, 0.02, 0.62, M.dark, { at: [0, 3.345, 1.42] }));
  g.add(cbox(kit, M.body, 1.12, 0.05, 0.08, 0.02, { at: [0, 3.36, 1.75] }));
  g.add(cbox(kit, M.body, 1.12, 0.05, 0.08, 0.02, { at: [0, 3.36, 1.1] }));
  for (const s of [-1, 1] as const) g.add(cbox(kit, M.body, 0.08, 0.05, 0.72, 0.02, { at: [s * 0.54, 3.36, 1.42] }));
  for (let i = 0; i < 8; i++) {
    const x = -0.44 + (i * 0.88) / 7;
    g.add(cbox(kit, M.body, 0.05, 0.07, 0.56, 0.012, { at: [x, 3.37, 1.42] }));
  }
  g.add(kit.box(1.0, 0.06, 0.03, M.body, { at: [0, 3.37, 1.2] }));

  // Aletas planas delanteras (perfil lateral extruido) con faro y piloto.
  const archR = 0.72;
  const a0 = Math.asin((0.95 - U_AXLE_Z) / archR) / DEG;
  const arch: Array<[number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const a = (a0 + ((180 - 2 * a0) * i) / 12) * DEG;
    arch.push([U_YF + Math.cos(a) * archR, U_AXLE_Z + Math.sin(a) * archR]);
  }
  const fender: Array<[number, number]> = [
    [U_CAB_F - 0.02, 0.78], [U_CAB_F - 0.02, 1.43], [3.26, 1.43], [3.34, 1.38], [3.34, 1.04], [3.2, 0.95],
    ...arch,
    [1.76, 0.84],
  ];
  for (const s of [-1, 1] as const) {
    const fx = s * 0.975;
    g.add(kit.extrudeSide(fender, 0.52, M.body, { at: [fx, 0, 0], bevel: 0.03 }));
    g.add(lampRound(kit, M.dark, { at: [s * 0.95, 3.345, 1.22], r: 0.095 }));
    g.add(lampRound(kit, M.dark, { at: [s * 1.13, 3.345, 1.34], r: 0.035, lens: M.amber }));
    g.add(kit.box(0.06, 0.04, 0.035, M.amber, { at: [s * 1.12, 3.22, 1.45] }));
    // Guardabarros interior oscuro bajo la aleta.
    g.add(fenderArc(kit, M.dark, { x: fx, cy: U_YF, cz: U_AXLE_Z, r: 0.69, t: 0.025, w: 0.48, a0: 30, a1: 150 }));
  }

  // Filtro de aire sobre la aleta izquierda: cilindro + codo + seta.
  g.add(kit.cyl(0.17, 0.17, 0.6, M.dark, { at: [-0.95, 2.05, 1.63], segments: 16 }));
  for (const f of [-0.2, 0.2]) g.add(kit.cyl(0.178, 0.178, 0.03, M.steel, { at: [-0.95, 2.05 + f, 1.63], segments: 16 }));
  g.add(kit.tube([[-0.95, 2.35, 1.62], [-0.88, 2.55, 1.6], [-0.72, 2.6, 1.55]], 0.08, M.dark));
  g.add(kit.cyl(0.07, 0.07, 0.42, M.dark, { axis: 'z', at: [-0.95, 1.85, 1.95], segments: 12 }));
  g.add(kit.lathe([[0.13, 0], [0.13, 0.05], [0.09, 0.1], [0, 0.12]], M.dark, { axis: 'z', at: [-0.95, 1.85, 2.14], segments: 14 }));
}

function uralCab(kit: ModelKit, M: UralMats, g: THREE.Group): void {
  // Cabina metálica de esquinas redondeadas (envolvente suavizada).
  const cy = (U_CAB_F + U_CAB_R) / 2, hy = (U_CAB_F - U_CAB_R) / 2;
  g.add(hull(kit, M.body, [
    ...roundRectRing(0, cy, U_CAB_HW, hy, 0.1, 1.16),
    ...roundRectRing(0, cy, U_CAB_HW, hy, 0.1, 1.96),
    ...roundRectRing(0, cy - 0.05, U_CAB_HW - 0.03, hy - 0.05, 0.14, 2.6),
    ...roundRectRing(0, cy - 0.03, U_CAB_HW - 0.13, hy - 0.16, 0.1, U_ROOF),
  ], { smoothDeg: 35 }));
  // Visera sobre el parabrisas + gálibos ámbar.
  g.add(cbox(kit, M.body, 2.1, 0.2, 0.05, 0.02, { at: [0, U_CAB_F - 0.02, U_ROOF - 0.05], rotDeg: [-6, 0, 0] }));
  for (const x of [-0.25, 0, 0.25]) g.add(kit.box(0.08, 0.05, 0.04, M.amber, { at: [x, U_CAB_F - 0.04, U_ROOF - 0.005] }));

  // Parabrisas de dos lunas planas (inclinado ~9°) con montante central.
  const rake = Math.atan2(0.1, 0.64);
  const ws = kit.group({ at: [0, U_CAB_F + 0.002, 1.96] });
  ws.rotation.x = rake;
  g.add(ws);
  for (const s of [-1, 1] as const) {
    ws.add(kit.box(0.98, 0.012, 0.52, M.glass, { at: [s * 0.53, 0.004, 0.33] }));
    ws.add(kit.box(0.5, 0.014, 0.014, M.dark, { at: [s * 0.55, 0.012, 0.1], rotDeg: [0, s * -8, 0] }));
  }
  ws.add(kit.box(0.07, 0.03, 0.6, M.body, { at: [0, 0.01, 0.33] }));
  ws.add(kit.box(2.16, 0.03, 0.05, M.body, { at: [0, 0.01, 0.05] }));

  // Puertas, ventanillas, manillas, escalerillas, espejos.
  for (const s of [-1, 1] as const) {
    const sx = s * (U_CAB_HW + 0.002);
    const dy0 = 0.72, dy1 = 1.58;
    g.add(kit.box(0.012, 0.6, 0.48, M.glass, { at: [s * (U_CAB_HW - 0.002), 1.2, 2.24] }));
    g.add(kit.box(0.008, dy1 - dy0, 0.012, M.dark, { at: [sx, (dy0 + dy1) / 2, 2.56] }));
    g.add(kit.box(0.008, dy1 - dy0, 0.012, M.dark, { at: [sx, (dy0 + dy1) / 2, 1.2] }));
    g.add(kit.box(0.008, 0.012, 1.36, M.dark, { at: [sx, dy0, 1.88] }));
    g.add(kit.box(0.008, 0.012, 1.36, M.dark, { at: [sx, dy1, 1.88] }));
    g.add(kit.box(0.03, 0.12, 0.03, M.dark, { at: [s * (U_CAB_HW + 0.015), dy0 + 0.14, 1.92] }));
    g.add(kit.box(0.02, 0.86, 0.02, M.body, { at: [s * (U_CAB_HW + 0.01), (dy0 + dy1) / 2, 1.96] }));
    g.add(stepLadder(kit, M.chassis, { at: [s * 1.08, 1.12, 0.92], w: 0.42, steps: 2, rise: 0.3, depth: 0.22 }));
    g.add(grabHandle(kit, M.dark, [s * (U_CAB_HW + 0.01), 0.62, 1.4], [s * (U_CAB_HW + 0.01), 0.62, 2.2], [s * 0.05, 0, 0]));
    // Espejo en brazo desde el montante delantero.
    g.add(kit.tube([
      [s * (U_CAB_HW - 0.02), U_CAB_F - 0.06, 2.1], [s * (U_CAB_HW + 0.18), U_CAB_F - 0.04, 2.12],
      [s * (U_CAB_HW + 0.3), U_CAB_F - 0.08, 2.2],
    ], 0.014, M.dark, { segments: 10 }));
    g.add(cbox(kit, M.dark, 0.05, 0.16, 0.3, 0.015, { at: [s * (U_CAB_HW + 0.32), U_CAB_F - 0.1, 2.3] }));
    g.add(kit.box(0.008, 0.13, 0.26, M.glass, { at: [s * (U_CAB_HW + 0.32), U_CAB_F - 0.185, 2.3], rotDeg: [0, 0, 90] }));
  }
  // Ventanuco trasero y antena.
  g.add(kit.box(0.6, 0.012, 0.3, M.glass, { at: [0, U_CAB_R - 0.004, 2.25] }));
  g.add(whipAntenna(kit, { at: [0.9, U_CAB_R + 0.15, U_ROOF - 0.04], len: 1.6, bendDeg: 25 }));

  // Rueda de repuesto vertical tras la cabina (izq.) en su soporte tubular.
  g.add(buildWheel(kit, {
    radius: U_R, width: U_TW, rimRadius: U_RIM, tread: 'ural', style: 'ural', rimColor: 0x2a2e22,
    side: -1, at: [-0.76, 0.34, 1.78], ctis: false,
  }));
  g.add(kit.box(0.06, 0.06, 1.0, M.chassis, { at: [-0.5, 0.34, 1.5] }));
  g.add(kit.box(0.5, 0.06, 0.06, M.chassis, { at: [-0.62, 0.34, 1.06] }));
  // Calderín de aire tras la cabina (der.).
  g.add(kit.cyl(0.14, 0.14, 0.9, M.body, { axis: 'x', at: [0.55, 0.36, 1.3], segments: 14 }));
}

function uralBed(kit: ModelKit, M: UralMats, g: THREE.Group): void {
  const L = U_BED_F - U_BED_R;
  const yc = (U_BED_F + U_BED_R) / 2;
  // Bastidor auxiliar y piso de la caja.
  for (const s of [-1, 1] as const) {
    g.add(kit.box(0.12, L, 0.14, M.chassis, { at: [s * 0.44, yc, U_FRAME_TOP + 0.07] }));
  }
  for (let i = 0; i < 7; i++) {
    g.add(kit.box(U_BED_HW * 2 - 0.1, 0.08, 0.1, M.chassis, { at: [0, U_BED_F - 0.2 - i * 0.55, U_FLOOR - 0.12] }));
  }
  g.add(kit.box(U_BED_HW * 2, L, 0.06, M.bodyDark, { at: [0, yc, U_FLOOR - 0.03] }));
  // Laterales abatibles de tablas con teleros y bisagras; frontal y portón.
  const sideH = U_SIDE_TOP - U_FLOOR;
  for (const s of [-1, 1] as const) {
    const x = s * (U_BED_HW - 0.025);
    g.add(kit.box(0.05, L, sideH, M.body, { at: [x, yc, U_FLOOR + sideH / 2] }));
    for (const z of [U_FLOOR + sideH * 0.33, U_FLOOR + sideH * 0.66]) {
      g.add(kit.box(0.008, L - 0.04, 0.012, M.bodyDark, { at: [s * (U_BED_HW + 0.002), yc, z] }));
    }
    g.add(kit.box(0.06, L, 0.05, M.body, { at: [s * (U_BED_HW - 0.01), yc, U_SIDE_TOP - 0.02] }));
    for (let i = 0; i < 6; i++) {
      const y = U_BED_F - 0.25 - i * ((L - 0.5) / 5);
      g.add(kit.box(0.025, 0.07, sideH, M.body, { at: [s * (U_BED_HW + 0.012), y, U_FLOOR + sideH / 2] }));
      g.add(kit.box(0.04, 0.12, 0.04, M.chassis, { at: [s * (U_BED_HW + 0.02), y, U_FLOOR + 0.04] }));
    }
    // Guardabarros del tándem (chapa plana bajo la caja) y estribo.
    g.add(kit.box(0.46, 3.0, 0.03, M.body, { at: [s * 1.0, (U_YR1 + U_YR2) / 2, 1.3] }));
    g.add(kit.box(0.03, 3.0, 0.12, M.body, { at: [s * 1.22, (U_YR1 + U_YR2) / 2, 1.25] }));
  }
  g.add(kit.box(U_BED_HW * 2, 0.05, sideH + 0.25, M.body, { at: [0, U_BED_F - 0.025, U_FLOOR + (sideH + 0.25) / 2] }));
  g.add(kit.box(U_BED_HW * 2, 0.05, sideH, M.body, { at: [0, U_BED_R + 0.025, U_FLOOR + sideH / 2] }));
  for (const x of [-0.8, 0, 0.8]) {
    g.add(kit.box(0.07, 0.025, sideH, M.body, { at: [x, U_BED_R - 0.01, U_FLOOR + sideH / 2] }));
  }

  // Toldo de lona sobre arcos: envolvente suavizada + costillas de los
  // arcos + correas de amarre a la caja.
  const tz0 = U_SIDE_TOP - 0.12;
  const tw = U_BED_HW + 0.02;
  const ty0 = U_BED_F + 0.02, ty1 = U_BED_R - 0.02;
  const sec = (y: number, k = 0): V3[] => [
    [tw + k, y, tz0], [tw + k, y, U_TENT_TOP - 0.3], [tw - 0.06 + k, y, U_TENT_TOP - 0.14],
    [tw - 0.2 + k, y, U_TENT_TOP - 0.04 + k], [tw - 0.42 + k, y, U_TENT_TOP + k],
  ];
  const tentPts: V3[] = [];
  for (const y of [ty0, ty1]) for (const p of sec(y)) tentPts.push(p, [-p[0], p[1], p[2]]);
  g.add(hull(kit, M.canvas, tentPts, { smoothDeg: 40 }));
  const nBows = 5;
  for (let i = 0; i < nBows; i++) {
    const y = ty0 - 0.35 - (i * (ty0 - ty1 - 0.7)) / (nBows - 1);
    const pts: V3[] = [];
    for (const yy of [y - 0.035, y + 0.035]) for (const p of sec(yy, 0.012)) pts.push(p, [-p[0], p[1], p[2]]);
    g.add(hull(kit, M.canvas, pts, { smoothDeg: 40 }));
  }
  // Correas y cuerda de amarre en el borde inferior del toldo.
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < 9; i++) {
      const y = ty0 - 0.2 - (i * (ty0 - ty1 - 0.4)) / 8;
      g.add(kit.box(0.012, 0.04, 0.2, M.canvasDark, { at: [s * (tw + 0.008), y, tz0 + 0.02] }));
    }
    g.add(kit.box(0.014, ty0 - ty1, 0.014, M.canvasDark, { at: [s * (tw + 0.01), (ty0 + ty1) / 2, tz0 + 0.1] }));
  }
  // Faldón trasero con cierres y ventanilla de lona delantera.
  g.add(kit.box(tw * 2 - 0.1, 0.012, 0.75, M.canvasDark, { at: [0, ty1 - 0.006, tz0 + 0.5] }));
  for (const x of [-0.9, -0.3, 0.3, 0.9]) g.add(kit.box(0.04, 0.02, 0.5, M.canvas, { at: [x, ty1 - 0.012, tz0 + 0.4] }));
  g.add(kit.box(0.7, 0.012, 0.3, M.canvasDark, { at: [0, ty0 + 0.006, U_TENT_TOP - 0.45] }));

  // Bidón en el frontal de la caja (der.).
  g.add(jerrycan(kit, M.body, { at: [1.05, U_BED_F + 0.2, 1.35], rotDeg: [0, 0, 90] }));
}

// ============================================================================
//  BTR-82A
// ============================================================================

const B_HALF_L = 3.825;
const B_R = 0.565;
const B_TW = 0.33;
const B_RIM = 0.229;
const B_AXLE_Z = 0.555;
const B_TRACK = 2.41;
const B_AXLES = [2.3, 0.9, -0.9, -2.3];
const B_LEDGE_Z0 = 1.24;
const B_LEDGE_Z1 = 1.32;
const B_ROOF = 1.95;
const B_LEDGE_HW = 1.43;
const B_ROOF_HW = 1.1;
const B_TUR_Y = 0.75;

interface BtrMats {
  body: THREE.MeshStandardMaterial;
  bodyDark: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  bright: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
  canvas: THREE.MeshStandardMaterial;
}

function btrMats(kit: ModelKit): BtrMats {
  return {
    body: kit.paint(PAINT.russianGreen, { wear: 0.3 }),
    bodyDark: kit.paint(0x434d30, { wear: 0.45, roughness: 0.8 }),
    dark: kit.paint(0x15160f, { roughness: 0.9, metalness: 0.1 }),
    steel: kit.steel(),
    bright: kit.steel(0x9a9c98, { roughness: 0.3 }),
    glass: kit.glass(),
    rubber: kit.rubber(),
    red: kit.emissive(0xb01a10, 0.35),
    lens: kit.steel(0xdfe4e6, { roughness: 0.12, metalness: 0.6 }),
    canvas: kit.canvas(0x4f5338),
  };
}

/** BTR-82A (8×8) con torre MB2-03: blanco blindado adicional. */
export function buildTargetApc(kit: ModelKit): TargetModel {
  const M = btrMats(kit);
  const root = new THREE.Group();
  root.name = 'btr-82a';
  const body = kit.group({ name: 'btr-body' });
  root.add(body);

  btrHull(kit, M, body);
  btrHullDetails(kit, M, body);
  btrTurret(kit, M, body);
  consolidate(kit, body);

  const wheels: THREE.Object3D[] = [];
  B_AXLES.forEach((y, i) => {
    for (const s of [-1, 1] as const) {
      const w = buildWheel(kit, {
        radius: B_R, width: B_TW, rimRadius: B_RIM, tread: 'btr', style: 'btr', rimColor: 0x4a5536,
        side: s, at: [s * B_TRACK / 2, y, B_AXLE_Z], ctis: true, name: `wheel-${i + 1}${s > 0 ? 'r' : 'l'}`,
      });
      root.add(w);
      wheels.push(w);
    }
  });
  return { root, wheels, wheelRadiusM: B_R, footprintM: Math.hypot(B_LEDGE_HW, B_HALF_L) };
}

/** Casco en "barca": parte alta facetada sobre la repisa y casco bajo estrecho. */
function btrHull(kit: ModelKit, M: BtrMats, g: THREE.Group): void {
  const N = B_HALF_L;
  // Casco alto: repisa (z 1.24-1.32) → techo, con glacis superior y popa.
  g.add(hullSym(kit, M.body, [
    [0.8, N, B_LEDGE_Z0], [B_LEDGE_HW, 2.95, B_LEDGE_Z0], [B_LEDGE_HW, -3.05, B_LEDGE_Z0], [1.28, -N, B_LEDGE_Z0],
    [0.8, N, B_LEDGE_Z1], [B_LEDGE_HW, 2.95, B_LEDGE_Z1], [B_LEDGE_HW, -3.05, B_LEDGE_Z1], [1.28, -N, B_LEDGE_Z1],
    [0.9, 2.55, B_ROOF], [B_ROOF_HW, 2.3, B_ROOF], [B_ROOF_HW, -3.3, B_ROOF], [0.98, -3.55, B_ROOF],
  ]));
  // Casco bajo: proa en cuña (glacis inferior) y popa inclinada.
  g.add(hullSym(kit, M.body, [
    [0.78, N - 0.03, B_LEDGE_Z0 + 0.01], [1.05, 3.1, B_LEDGE_Z0 + 0.01], [1.05, -3.1, B_LEDGE_Z0 + 0.01],
    [1.05, -N + 0.03, B_LEDGE_Z0 + 0.01],
    [0.72, 3.05, 0.48], [0.88, 2.7, 0.48], [0.88, -2.9, 0.48], [0.75, -3.3, 0.48],
  ]));
  // Brazos de suspensión y reductoras de rueda (se ven bajo la repisa).
  for (const y of B_AXLES) {
    for (const s of [-1, 1] as const) {
      g.add(kit.cyl(0.13, 0.15, 0.14, M.bodyDark, { axis: 'x', at: [s * 0.98, y, B_AXLE_Z], segments: 14 }));
      g.add(kit.box(0.2, 0.12, 0.08, M.bodyDark, { at: [s * 0.9, y + 0.12, B_AXLE_Z + 0.16], rotDeg: [-25, 0, 0] }));
      g.add(kit.cyl(0.03, 0.03, 0.55, M.bodyDark, { axis: 'z', at: [s * 1.0, y - 0.25, 0.95], segments: 8 }));
    }
  }
}

/** Plano del costado alto: +Z sube por la faceta, normal exterior s·X. */
function btrSide(kit: ModelKit, g: THREE.Group, s: 1 | -1): THREE.Group {
  const t = Math.atan2(B_LEDGE_HW - B_ROOF_HW, B_ROOF - B_LEDGE_Z1);
  const f = kit.group({ at: [s * B_LEDGE_HW, 0, B_LEDGE_Z1] });
  f.rotation.y = -s * t;
  g.add(f);
  return f;
}

function btrHullDetails(kit: ModelKit, M: BtrMats, g: THREE.Group): void {
  const N = B_HALF_L;
  const glacisLen = Math.hypot(N - 2.55, B_ROOF - B_LEDGE_Z1);
  const glacisAng = Math.atan2(B_ROOF - B_LEDGE_Z1, N - 2.55);
  // Grupo en el plano del glacis superior: −Y local sube por el glacis
  // desde la proa, +Z local es la normal exterior.
  const gl = kit.group({ at: [0, N, B_LEDGE_Z1] });
  gl.rotation.x = -glacisAng;
  g.add(gl);
  // Rompeolas plegado sobre el glacis (placa nervada con bisagras).
  gl.add(cbox(kit, M.body, 1.42, 0.86, 0.04, 0.015, { at: [0, -0.6, 0.03] }));
  for (const x of [-0.45, 0, 0.45]) gl.add(kit.box(0.04, 0.8, 0.03, M.body, { at: [x, -0.6, 0.065] }));
  for (const x of [-0.6, 0.6]) gl.add(kit.box(0.1, 0.1, 0.06, M.bodyDark, { at: [x, -0.1, 0.03] }));
  // Bloques de visión del conductor/jefe en lo alto del glacis.
  for (const x of [-0.62, -0.38, 0.38, 0.62]) {
    gl.add(kit.box(0.14, 0.05, 0.06, M.bodyDark, { at: [x, -glacisLen + 0.1, 0.03] }));
    gl.add(kit.box(0.11, 0.004, 0.045, M.glass, { at: [x, -glacisLen + 0.074, 0.035] }));
  }
  // Cable de remolque en lazo por delante y ganchos en la proa.
  g.add(kit.tube([
    [-0.75, N - 0.25, 1.48], [-0.35, N + 0.02, 1.25], [0.0, N + 0.04, 1.12], [0.35, N + 0.02, 1.25], [0.75, N - 0.25, 1.48],
  ], 0.014, M.bright, { segments: 30 }));
  for (const s of [-1, 1] as const) {
    g.add(kit.box(0.1, 0.1, 0.12, M.bodyDark, { at: [s * 0.45, N - 0.12, 1.05] }));
    g.add(kit.torus(0.05, 0.016, M.dark, { axis: 'x', at: [s * 0.45, N - 0.08, 0.95], segments: 12 }));
    // Faros con rejilla en las esquinas altas del glacis.
    g.add(kit.cyl(0.03, 0.03, 0.12, M.bodyDark, { axis: 'z', at: [s * 0.95, 2.85, 1.9], segments: 8 }));
    g.add(lampRound(kit, M.dark, { at: [s * 0.95, 2.92, 2.02], r: 0.085 }));
  }

  // Techo: escotillas de conductor/jefe, escotillas de tropa, rejillas
  // del motor, silenciadores largos, antenas.
  for (const s of [-1, 1] as const) {
    g.add(kit.cyl(0.26, 0.27, 0.05, M.body, { axis: 'z', at: [s * 0.45, 2.15, B_ROOF + 0.025], segments: 18 }));
    g.add(kit.box(0.12, 0.08, 0.05, M.bodyDark, { at: [s * 0.45, 1.88, B_ROOF + 0.04] }));
    g.add(cbox(kit, M.body, 0.62, 0.7, 0.05, 0.02, { at: [s * 0.5, -0.55, B_ROOF + 0.025] }));
    g.add(kit.box(0.08, 0.1, 0.04, M.bodyDark, { at: [s * 0.5, -0.94, B_ROOF + 0.04] }));
    // Rejillas del compartimento motor (lamas sobre fondo oscuro).
    g.add(kit.box(0.62, 1.2, 0.02, M.dark, { at: [s * 0.5, -2.45, B_ROOF + 0.01] }));
    for (let i = 0; i < 8; i++) {
      g.add(kit.box(0.6, 0.04, 0.03, M.body, { at: [s * 0.5, -1.93 - i * 0.15, B_ROOF + 0.025] }));
    }
    // Silenciador largo nervado en el borde trasero del techo.
    g.add(kit.lathe([
      [0, -0.85], [0.1, -0.85], [0.115, -0.75], [0.115, 0.7], [0.08, 0.85], [0.05, 0.95], [0, 0.95],
    ], M.bodyDark, { axis: 'y', at: [s * 1.02, -2.55, B_ROOF + 0.06], segments: 16 }));
    for (const f of [-0.5, -0.1, 0.3]) {
      g.add(kit.cyl(0.125, 0.125, 0.05, M.bodyDark, { at: [s * 1.02, -2.55 + f, B_ROOF + 0.06], segments: 16 }));
    }
    g.add(whipAntenna(kit, { at: [s * 0.85, -3.25, B_ROOF], len: 1.6, bendDeg: 20 }));
  }
  g.add(kit.box(0.2, 1.2, 0.06, M.bodyDark, { at: [0, -2.45, B_ROOF + 0.03] }));

  // Costados: puerta de tropa (entre ejes 2 y 3), troneras con rótula,
  // cajones de estiba traseros, asideros.
  for (const s of [-1, 1] as const) {
    const sd = btrSide(kit, g, s);
    const o = (d: number) => s * d;
    const sideLen = Math.hypot(B_LEDGE_HW - B_ROOF_HW, B_ROOF - B_LEDGE_Z1);
    // Puerta superior (contorno + bisagras + manilla).
    const py0 = -0.5, py1 = 0.3;
    for (const y of [py0, py1]) sd.add(kit.box(0.008, 0.014, sideLen * 0.92, M.dark, { at: [o(0.003), y, sideLen * 0.48] }));
    sd.add(kit.box(0.008, py1 - py0, 0.014, M.dark, { at: [o(0.003), (py0 + py1) / 2, sideLen * 0.94] }));
    sd.add(kit.box(0.03, 0.1, 0.05, M.bodyDark, { at: [o(0.015), py0 + 0.12, sideLen * 0.5] }));
    for (const u of [0.2, 0.55]) sd.add(kit.box(0.03, 0.06, 0.09, M.body, { at: [o(0.015), py1 - 0.03, u] }));
    // Troneras: placa + rótula semiesférica.
    for (const y of [1.6, -1.55]) {
      sd.add(cbox(kit, M.body, 0.03, 0.2, 0.18, 0.01, { at: [o(0.015), y, sideLen * 0.55] }));
      sd.add(kit.sphere(0.055, M.bodyDark, { at: [o(0.03), y, sideLen * 0.55], segments: 10 }));
    }
    sd.add(cbox(kit, M.body, 0.03, 0.2, 0.18, 0.01, { at: [o(0.015), -0.1, sideLen * 0.62] }));
    sd.add(kit.sphere(0.05, M.bodyDark, { at: [o(0.03), -0.1, sideLen * 0.62], segments: 10 }));
    // Cajones de estiba en el costado trasero.
    sd.add(cbox(kit, M.body, 0.16, 0.95, 0.42, 0.03, { at: [o(0.08), -2.55, sideLen * 0.45] }));
    sd.add(kit.box(0.02, 0.5, 0.04, M.bodyDark, { at: [o(0.165), -2.55, sideLen * 0.55] }));
    // Asidero largo bajo el techo.
    sd.add(kit.box(0.04, 1.8, 0.03, M.body, { at: [o(0.03), 1.0, sideLen * 0.88] }));
    // Peldaño de la puerta inferior (abatible, plegado) sobre la repisa.
    g.add(cbox(kit, M.body, 0.08, 0.7, 0.3, 0.015, { at: [s * (B_LEDGE_HW - 0.38), -0.1, 1.08] }));
    // Remaches en la repisa.
    g.add(boltRow(kit, M.bodyDark, [s * (B_LEDGE_HW - 0.03), 2.6, B_LEDGE_Z1 + 0.004], [s * (B_LEDGE_HW - 0.03), -2.8, B_LEDGE_Z1 + 0.004], 14, 'z', 0.012, 0.01));
  }

  // Popa: tapa del hidrojet, pilotos, ganchos, portón de acceso al motor.
  g.add(cbox(kit, M.body, 0.62, 0.05, 0.42, 0.02, { at: [0, -N - 0.01, 1.0] }));
  g.add(kit.cyl(0.16, 0.16, 0.04, M.bodyDark, { axis: 'y', at: [0, -N - 0.03, 1.0], segments: 18 }));
  for (const s of [-1, 1] as const) {
    g.add(lampRect(kit, M.dark, M.red, { at: [s * 0.95, -N - 0.01, 1.4], w: 0.12, h: 0.07, rotDeg: [0, 0, 180] }));
    g.add(kit.torus(0.05, 0.016, M.dark, { axis: 'x', at: [s * 0.55, -N + 0.02, 0.78], segments: 12 }));
    g.add(jerrycan(kit, M.body, { at: [s * 0.75, -3.62, 1.65], rotDeg: [0, 90, 0] }));
  }
}

/** Torre MB2-03: cono facetado, manto con 2A72 + PKTM, visores y 902V. */
function btrTurret(kit: ModelKit, M: BtrMats, g: THREE.Group): void {
  const ty = B_TUR_Y;
  const z0 = B_ROOF;
  // Anillo de la torre.
  g.add(kit.cyl(0.84, 0.86, 0.06, M.body, { axis: 'z', at: [0, ty, z0 + 0.03], segments: 28 }));
  // Cuerpo: octógono inferior → techo menor desplazado atrás, frente plano.
  const pts: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    pts.push([Math.cos(a) * 0.8, ty + Math.sin(a) * 0.8 * 0.95, z0 + 0.06]);
    pts.push([Math.cos(a) * 0.56, ty - 0.08 + Math.sin(a) * 0.52, z0 + 0.46]);
  }
  pts.push([0.3, ty + 0.8, z0 + 0.08], [-0.3, ty + 0.8, z0 + 0.08], [0.3, ty + 0.62, z0 + 0.4], [-0.3, ty + 0.62, z0 + 0.4]);
  g.add(hull(kit, M.body, pts, { smoothDeg: 28 }));
  // Escotilla del tirador y visor TKN (caja con capuchón) + 1PZ-10.
  g.add(kit.cyl(0.24, 0.25, 0.05, M.body, { axis: 'z', at: [0.12, ty - 0.2, z0 + 0.485], segments: 18 }));
  g.add(cbox(kit, M.body, 0.22, 0.28, 0.2, 0.02, { at: [-0.3, ty + 0.25, z0 + 0.55] }));
  g.add(kit.box(0.16, 0.006, 0.1, M.glass, { at: [-0.3, ty + 0.392, z0 + 0.57] }));
  g.add(cbox(kit, M.body, 0.16, 0.2, 0.14, 0.02, { at: [0.28, ty + 0.3, z0 + 0.52] }));
  g.add(kit.box(0.1, 0.006, 0.07, M.glass, { at: [0.28, ty + 0.402, z0 + 0.53] }));
  // Proyector IR OU-3GA2M en el costado izquierdo.
  g.add(kit.cyl(0.11, 0.12, 0.2, M.bodyDark, { axis: 'y', at: [-0.62, ty + 0.3, z0 + 0.4], segments: 16 }));
  g.add(kit.cyl(0.095, 0.095, 0.01, M.lens, { axis: 'y', at: [-0.62, ty + 0.405, z0 + 0.4], segments: 16 }));
  g.add(kit.box(0.06, 0.12, 0.1, M.body, { at: [-0.55, ty + 0.28, z0 + 0.3] }));

  // Manto y armamento: 2A72 (30 mm) con camisa y freno, PKTM coaxial.
  const gz = z0 + 0.26;
  const gy = ty + 0.78;
  g.add(cbox(kit, M.body, 0.44, 0.22, 0.28, 0.03, { at: [0, gy, gz] }));
  g.add(kit.cyl(0.075, 0.07, 0.5, M.body, { at: [-0.04, gy + 0.35, gz], segments: 14 }));
  g.add(kit.cyl(0.042, 0.04, 1.85, M.steel, { at: [-0.04, gy + 1.5, gz], segments: 12 }));
  g.add(kit.lathe([[0.04, 0], [0.055, 0.02], [0.055, 0.14], [0.045, 0.16], [0.03, 0.16]], M.steel,
    { axis: 'y', at: [-0.04, gy + 2.42, gz], segments: 12 }));
  g.add(kit.cyl(0.018, 0.016, 0.55, M.dark, { at: [0.16, gy + 0.36, gz - 0.02], segments: 8 }));
  // Lanzafumígenos 902V: 3 por lado en el frente de la torre, hacia arriba.
  for (const s of [-1, 1] as const) {
    g.add(kit.box(0.26, 0.08, 0.08, M.body, { at: [s * 0.42, ty + 0.62, z0 + 0.42] }));
    for (let i = 0; i < 3; i++) {
      g.add(kit.cyl(0.042, 0.042, 0.24, M.bodyDark, {
        at: [s * (0.33 + i * 0.09), ty + 0.7, z0 + 0.5], rotDeg: [35, 0, -s * 12], segments: 10,
      }));
    }
  }
  // Funda de lona trasera y antena de la torre.
  g.add(cbox(kit, M.canvas, 0.6, 0.3, 0.25, 0.06, { at: [0.0, ty - 0.66, z0 + 0.35] }));
  g.add(whipAntenna(kit, { at: [-0.4, ty - 0.45, z0 + 0.46], len: 1.4, bendDeg: 15 }));
}

// Aliases para quien importe los blancos por nombre de vehículo.
export { buildTargetTruck as buildUral4320, buildTargetApc as buildBtr82a };
