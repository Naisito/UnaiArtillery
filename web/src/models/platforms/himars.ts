// ============================================================================
//  himars.ts — M142 HIMARS: camión FMTV 6×6 de 5 t con cabina blindada de 3
//  plazas (ICP, casco facetado de sección hexagonal) y módulo lanzador (LM)
//  trasero con UN contenedor.
//  DUEÑO: agente 3D-WHEELED (ver docs/PLAN_V2.md).
//
//  Variantes por ctx.weaponId:
//    * gmlrs   → LPC de 6 tubos (2 × 3) M31 GMLRS, banda amarilla (HE).
//    * ergmlrs → mismo LPC, banda amarilla + banda marrón inferior + bloque
//                de estarcido blanco (marcado distintivo del ER GMLRS).
//    * prsm    → contenedor de 2 celdas cuadradas PrSM, tapas con nervios.
//
//  Medidas reales (públicas): 7.0 × 2.44 × 3.18 m, 16.25 t; chasis FMTV
//  (batalla 4.10 m al centro del tándem, tándem 1.40 m, vía ≈ 2.0 m),
//  neumáticos 395/85R20 (Ø ≈ 1.18 m) con CTIS; contenedor LPC 4.17 × 1.05 ×
//  0.84 m. Sin estabilizadores: el M142 dispara sobre su suspensión.
//  Referencias visuales: fotos públicas (DVIDS / Wikimedia Commons) del M142
//  con cabina ICP: lunas pequeñas en marcos blindados, barra de gálibos
//  ámbar en el borde del techo, toma de aire con prefiltro tras la cabina
//  (lado izquierdo), eje delantero bajo la mitad trasera de la cabina.
//
//  Rig: el camión es estático (hijo de root). `traverse` = base giratoria del
//  LM sobre el aro de rodadura (eje de azimut sobre el tándem, 2.0 m por
//  detrás del centro del vehículo). `elevation` = caja/jaula del LM (2.1 m
//  de ancho, contenedor en la bahía central), pivota en su extremo TRASERO-
//  inferior. `recoil` = contenedor (carrera 0). En reposo el contenedor
//  apunta a +Y (cara de tubos hacia la cabina), como en la posición de
//  marcha real.
//
//  muzzleLocal = cara de la tapa del TUBO 1 = fila superior, columna
//  izquierda (−X) del LPC; en PrSM, la celda izquierda (−X). Los gatos de
//  elevación (cilindro en la base + vástago en la caja) se animan en
//  `animate` y van en `extraAnimated`.
// ============================================================================
import * as THREE from 'three';
import { PAINT, type ModelKit, type V3 } from '../kit';
import {
  beamAxle, boltRow, buildWheel, cbox, consolidate, fenderArc, fuelTank, grabHandle, hullSym,
  jerrycan, ladderFrame, lampRect, lampRound, leafSpring, mudflap, propShaft, stepLadder, stowBox,
  whipAntenna,
} from '../parts/trucks';
import { DEG, type PlatformBuilder, type PlatformRig } from '../rig';

// ---------------------------------------------------------------------------
//  Cotas del camión (coordenadas de VEHÍCULO: y = 0 en el centro de la
//  longitud, frente del parachoques en +3.50; root desplaza el camión).
// ---------------------------------------------------------------------------
/** Eje de azimut del LM en coordenadas de vehículo. */
const AXIS_Y = -2.0;
const WHEEL_R = 0.59;
const WHEEL_W = 0.4;
const RIM_R = 0.265;
const AXLE_Z = 0.575;
const TRACK = 2.0;
const Y_AX_F = 2.0;
const Y_AX_R1 = -1.4;
const Y_AX_R2 = -2.8;
const FRAME_TOP = 1.08;
const DECK_Z = 1.18;

// Cabina facetada: anillo trasero y frontal (semi-anchos por cota).
const CAB_R = 1.25;
const CAB_F = 3.3;
const CAB_ZB = 1.24;   // fondo
const CAB_ZC = 1.98;   // arista de máxima anchura
const CAB_ZT = 2.98;   // techo
const CAB_HB = 1.02;
const CAB_HC = 1.2;
const CAB_HT = 0.97;
/** Plano del parabrisas: arista inferior (y, z) y superior. */
const WS_B: [number, number] = [3.28, CAB_ZC];
const WS_T: [number, number] = [3.04, CAB_ZT];
const WS_RAKE = Math.atan2(WS_B[0] - WS_T[0], WS_T[1] - WS_B[1]);
const WS_LEN = Math.hypot(WS_B[0] - WS_T[0], WS_T[1] - WS_B[1]);
const UP_TILT = Math.atan2(CAB_HC - CAB_HT, CAB_ZT - CAB_ZC);
const LO_TILT = Math.atan2(CAB_HC - CAB_HB, CAB_ZC - CAB_ZB);
const UP_LEN = Math.hypot(CAB_HC - CAB_HT, CAB_ZT - CAB_ZC);
const LO_LEN = Math.hypot(CAB_HC - CAB_HB, CAB_ZC - CAB_ZB);

// Lanzador (coordenadas de TRAVERSE: origen en el suelo bajo el eje).
const RING_Z = 1.26;
const BASE_TOP = 1.5;
const PIV_Y = -1.45;
const PIV_Z = 1.5;
// Caja del LM y contenedor (coordenadas de ELEVATION: origen en el muñón).
const BOX_Y0 = -0.1;
const BOX_Y1 = 4.3;
const BOX_HW = 1.05;
const BOX_Z0 = 0.05;
const BOX_Z1 = 1.1;
const BAY_HW = 0.59;
const POD_Y0 = 0.03;
const POD_Y1 = 4.2;
const POD_HW = 0.525;
const POD_Z0 = 0.2;
const POD_Z1 = 1.04;
const POD_ZC = (POD_Z0 + POD_Z1) / 2;
// Gatos de elevación.
const JACK_X = 0.42;
const JACK_BASE: [number, number] = [-0.6, 1.22];   // (y, z) en traverse
const JACK_BOX: [number, number] = [2.4, 0.0];      // (y, z) en elevation
const JACK_BARREL_L = 1.4;
const JACK_ROD_L = 1.2;

type Variant = 'gmlrs' | 'ergmlrs' | 'prsm';

export const buildHimars: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const variant: Variant = ctx.weaponId === 'prsm' ? 'prsm' : ctx.weaponId === 'ergmlrs' ? 'ergmlrs' : 'gmlrs';

  const M = materials(kit);
  const root = new THREE.Group();
  root.name = 'm142-himars';

  // ---- Camión (estático) -------------------------------------------------
  const truck = kit.group({ name: 'truck', at: [0, -AXIS_Y, 0] });
  root.add(truck);
  buildChassis(kit, M, truck);
  buildCab(kit, M, truck);
  buildRearBody(kit, M, truck);
  consolidate(kit, truck);

  // ---- Módulo lanzador ---------------------------------------------------
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  const base = kit.group({ name: 'lm-base' });
  traverse.add(base);
  buildLauncherBase(kit, M, base);
  consolidate(kit, base);

  const elevation = kit.group({ name: 'elevation', at: [0, PIV_Y, PIV_Z] });
  traverse.add(elevation);
  const box = kit.group({ name: 'lm-box' });
  elevation.add(box);
  buildLauncherBox(kit, M, box);
  consolidate(kit, box);

  const recoil = kit.group({ name: 'recoil' });
  elevation.add(recoil);
  const pod = kit.group({ name: 'pod' });
  recoil.add(pod);
  const muzzle = buildPod(kit, M, pod, variant);
  consolidate(kit, pod);

  // ---- Gatos de elevación (animados) -------------------------------------
  const jacks = buildJacks(kit, M, traverse, elevation);
  jacks.update(0);

  const rig: PlatformRig = {
    root, traverse, elevation, recoil,
    muzzleLocal: muzzle,
    recoilStrokeM: 0,
    // Esquina delantera del parachoques respecto al eje de azimut.
    footprintM: Math.hypot(1.22, 3.5 - AXIS_Y),
    heightM: 3.18,
    extraAnimated: jacks.nodes,
    animate(state) {
      jacks.update(state.elevationDeg);
    },
  };
  return rig;
};

// ---------------------------------------------------------------------------
//  Materiales
// ---------------------------------------------------------------------------

interface Mats {
  body: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  pod: THREE.MeshStandardMaterial;
  podCover: THREE.MeshStandardMaterial;
  podPrsm: THREE.MeshStandardMaterial;
  chassis: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  bright: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  brown: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  stencil: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  lensClear: THREE.MeshStandardMaterial;
}

function materials(kit: ModelKit): Mats {
  return {
    body: kit.paint(PAINT.carcGreen, { wear: 0.25 }),
    panel: kit.paint(0x464d1e, { wear: 0.4, roughness: 0.78 }),
    pod: kit.paint(0x4d5528, { wear: 0.3, roughness: 0.7 }),
    podCover: kit.paint(0x5a6638, { wear: 0.2, roughness: 0.62 }),
    podPrsm: kit.paint(0x575d38, { wear: 0.2, roughness: 0.64 }),
    chassis: kit.paint(0x363c1f, { wear: 0.65, roughness: 0.85, metalness: 0.25 }),
    dark: kit.paint(0x15160f, { roughness: 0.9, metalness: 0.1 }),
    steel: kit.steel(),
    bright: kit.steel(0x8a8d8c, { roughness: 0.35 }),
    polymer: kit.polymer(0x1c1d1b),
    glass: kit.glass(),
    yellow: kit.paint(0xc9a92c, { roughness: 0.6, metalness: 0.1 }),
    brown: kit.paint(0x6a4526, { roughness: 0.65, metalness: 0.1 }),
    white: kit.paint(0xb9b8aa, { roughness: 0.8, metalness: 0.05 }),
    stencil: kit.paint(0x2e3226, { roughness: 0.85, metalness: 0.05 }),
    red: kit.emissive(0xb01a10, 0.35),
    amber: kit.emissive(0xd88412, 0.3),
    lensClear: kit.steel(0xdfe4e6, { roughness: 0.12, metalness: 0.6 }),
  };
}

// ---------------------------------------------------------------------------
//  Chasis FMTV: largueros, ejes, ballestas, ruedas, transmisión
// ---------------------------------------------------------------------------

function buildChassis(kit: ModelKit, M: Mats, g: THREE.Group): void {
  g.add(ladderFrame(kit, M.chassis, {
    yFront: 3.25, yRear: -3.42, width: 0.9, zTop: FRAME_TOP, railH: 0.28,
    cross: [3.1, 1.3, 0.1, -2.1, -3.3],
  }));
  // Motor + caja bajo la cabina (se ve por los pasos de rueda).
  g.add(cbox(kit, M.dark, 0.85, 1.7, 0.55, 0.05, { at: [0, 2.2, 1.0] }));
  g.add(cbox(kit, M.chassis, 0.6, 0.7, 0.42, 0.04, { at: [0, 0.95, 0.86] }));   // caja de transferencia
  // Radiador / cárter visibles bajo el mentón.
  g.add(kit.box(1.2, 0.08, 0.32, M.dark, { at: [0, 2.9, 0.92] }));

  // Ejes: delantero direccional + tándem.
  g.add(beamAxle(kit, M.chassis, { y: Y_AX_F, z: AXLE_Z, track: TRACK, steer: true, diffX: 0.12 }));
  g.add(beamAxle(kit, M.chassis, { y: Y_AX_R1, z: AXLE_Z, track: TRACK, diffX: 0.1 }));
  g.add(beamAxle(kit, M.chassis, { y: Y_AX_R2, z: AXLE_Z, track: TRACK, diffX: 0.1 }));
  for (const s of [-1, 1] as const) {
    // Ballesta parabólica delantera y ballesta del tándem (balancín central).
    g.add(leafSpring(kit, M.chassis, { at: [s * 0.4, Y_AX_F, AXLE_Z + 0.1], len: 1.45, leaves: 4, arch: 0.07 }));
    g.add(leafSpring(kit, M.chassis, { at: [s * 0.4, (Y_AX_R1 + Y_AX_R2) / 2, AXLE_Z + 0.1], len: 1.7, leaves: 7, arch: 0.09 }));
    g.add(kit.box(0.14, 0.32, 0.3, M.chassis, { at: [s * 0.4, (Y_AX_R1 + Y_AX_R2) / 2, AXLE_Z + 0.32] }));
  }
  g.add(propShaft(kit, M.steel, [0.1, 0.95, 0.8], [0.12, Y_AX_F - 0.25, AXLE_Z + 0.05]));
  g.add(propShaft(kit, M.steel, [0.08, 0.7, 0.78], [0.1, Y_AX_R1 + 0.25, AXLE_Z + 0.08]));
  g.add(propShaft(kit, M.steel, [0.1, Y_AX_R1 - 0.25, AXLE_Z + 0.1], [0.1, Y_AX_R2 + 0.25, AXLE_Z + 0.08]));

  for (const y of [Y_AX_F, Y_AX_R1, Y_AX_R2]) {
    for (const s of [-1, 1] as const) {
      g.add(buildWheel(kit, {
        radius: WHEEL_R, width: WHEEL_W, rimRadius: RIM_R, tread: 'xzl', style: 'fmtv',
        rimColor: 0x2c3120, side: s, at: [s * TRACK / 2, y, AXLE_Z], ctis: true, merge: false,
      }));
    }
  }

  // Escape: silencioso bajo el lado derecho y salida horizontal.
  g.add(kit.cyl(0.13, 0.13, 0.7, M.chassis, { at: [0.6, 0.3, 0.82], segments: 14 }));
  g.add(kit.cyl(0.05, 0.05, 0.5, M.dark, { axis: 'x', at: [0.86, 0.0, 0.8], segments: 10 }));
  // Calderines de aire (frenos/CTIS) entre largueros.
  for (const x of [-0.22, 0.22]) {
    g.add(kit.cyl(0.11, 0.11, 0.85, M.chassis, { at: [x, -0.4, 0.74], segments: 14 }));
  }
}

// ---------------------------------------------------------------------------
//  Cabina blindada (cab-over) facetada de 3 plazas
// ---------------------------------------------------------------------------

/** Grupo alineado con una faceta lateral: +Z local sube por la faceta,
 *  la normal exterior es s·(+X local), Y igual que el vehículo. */
function facet(kit: ModelKit, g: THREE.Group, s: 1 | -1, which: 'up' | 'lo'): THREE.Group {
  const f = which === 'up'
    ? kit.group({ at: [s * CAB_HC, 0, CAB_ZC] })
    : kit.group({ at: [s * CAB_HB, 0, CAB_ZB] });
  f.rotation.y = which === 'up' ? -s * UP_TILT : s * LO_TILT;
  g.add(f);
  return f;
}

/** Punto (en coords de vehículo) sobre una faceta lateral, separado `off`. */
function facetPt(s: 1 | -1, which: 'up' | 'lo', y: number, u: number, off = 0): V3 {
  if (which === 'up') {
    const t = UP_TILT;
    return [s * (CAB_HC - Math.sin(t) * u + Math.cos(t) * off), y, CAB_ZC + Math.cos(t) * u + Math.sin(t) * off];
  }
  const t = LO_TILT;
  return [s * (CAB_HB + Math.sin(t) * u + Math.cos(t) * off), y, CAB_ZB + Math.cos(t) * u - Math.sin(t) * off];
}

function buildCab(kit: ModelKit, M: Mats, g: THREE.Group): void {
  // --- Casco: envolvente convexa de sección hexagonal con frente quebrado.
  g.add(hullSym(kit, M.body, [
    [CAB_HB, CAB_R, CAB_ZB], [CAB_HC, CAB_R, CAB_ZC], [CAB_HT, CAB_R, CAB_ZT],
    [CAB_HB - 0.1, CAB_F, CAB_ZB], [CAB_HB, CAB_F - 0.18, CAB_ZB],
    [CAB_HC - 0.12, WS_B[0], CAB_ZC], [CAB_HC, WS_B[0] - 0.18, CAB_ZC],
    [CAB_HT - 0.05, WS_T[0], CAB_ZT], [CAB_HT, WS_T[0] - 0.1, CAB_ZT],
  ]));
  // Mentón (bajo el frente, por delante de las ruedas) con chaflán inferior.
  g.add(hullSym(kit, M.body, [
    [0.92, CAB_F, CAB_ZB + 0.01], [0.95, 2.72, CAB_ZB + 0.01],
    [0.8, 3.14, 0.93], [0.85, 2.78, 0.93],
  ]));

  // --- Frente superior: dos lunas blindadas en marcos atornillados.
  const ws = kit.group({ name: 'windshield', at: [0, WS_B[0], WS_B[1]] });
  ws.rotation.x = WS_RAKE;
  g.add(ws);
  for (const s of [-1, 1] as const) {
    const cx = s * 0.47;
    const sc = 0.6; // centro del marco a lo largo de la cara
    ws.add(cbox(kit, M.body, 0.8, 0.05, 0.56, 0.02, { at: [cx, 0.02, sc] }));
    ws.add(kit.box(0.6, 0.012, 0.3, M.glass, { at: [cx, 0.048, sc + 0.03] }));
    ws.add(kit.box(0.64, 0.01, 0.024, M.dark, { at: [cx, 0.047, sc + 0.195] }));
    ws.add(kit.box(0.64, 0.01, 0.024, M.dark, { at: [cx, 0.047, sc - 0.135] }));
    for (const dx of [-0.37, 0.37]) {
      ws.add(boltRow(kit, M.steel, [cx + dx, 0.047, sc - 0.24], [cx + dx, 0.047, sc + 0.24], 4, 'y', 0.011, 0.012));
    }
    ws.add(boltRow(kit, M.steel, [cx - 0.25, 0.047, sc + 0.25], [cx + 0.25, 0.047, sc + 0.25], 3, 'y', 0.011, 0.012));
    // Limpiaparabrisas con pivote superior (aparcado en diagonal).
    ws.add(kit.cyl(0.018, 0.018, 0.03, M.dark, { axis: 'y', at: [cx - s * 0.12, 0.06, sc + 0.31], segments: 8 }));
    ws.add(kit.box(0.015, 0.012, 0.36, M.dark, { at: [cx - s * 0.02, 0.062, sc + 0.12], rotDeg: [0, s * 38, 0] }));
    // Placas de nombre bajo cada luna.
    ws.add(kit.box(0.42, 0.006, 0.07, M.stencil, { at: [cx, 0.003, 0.18] }));
  }
  void WS_LEN;

  // --- Frente inferior: rejillas, estarcidos, mentón ranurado.
  const fy = CAB_F + 0.003;
  g.add(cbox(kit, M.body, 0.84, 0.04, 0.3, 0.01, { at: [0, fy + 0.01, 1.6] }));
  for (const s of [-1, 1] as const) {
    g.add(kit.box(0.36, 0.01, 0.22, M.dark, { at: [s * 0.2, fy + 0.03, 1.6] }));
    for (let i = 0; i < 5; i++) {
      g.add(kit.box(0.36, 0.014, 0.012, M.body, { at: [s * 0.2, fy + 0.034, 1.51 + i * 0.045] }));
    }
  }
  g.add(kit.cyl(0.1, 0.1, 0.02, M.body, { axis: 'y', at: [0.6, fy + 0.01, 1.62], segments: 16 }));
  g.add(kit.box(0.5, 0.004, 0.08, M.stencil, { at: [-0.55, fy + 0.001, 1.86] }));
  g.add(kit.box(0.2, 0.004, 0.08, M.stencil, { at: [0.55, fy + 0.001, 1.86] }));
  g.add(kit.box(0.05, 0.004, 0.05, M.stencil, { at: [0.02, fy + 0.001, 1.88], rotDeg: [0, 45, 0] }));
  boltRowFront(kit, M, g, fy);
  const chin = kit.group({ at: [0, 3.22, 1.09] });
  chin.rotation.x = -Math.atan2(CAB_F - 3.14, CAB_ZB - 0.93);
  g.add(chin);
  chin.add(kit.box(1.0, 0.01, 0.24, M.dark, { at: [0, 0.006, 0] }));
  for (let i = 0; i < 4; i++) chin.add(kit.box(1.0, 0.02, 0.018, M.body, { at: [0, 0.012, -0.09 + i * 0.06] }));

  // Barra de gálibos ámbar en el borde delantero del techo + foco.
  for (const x of [-0.85, -0.12, 0.05, 0.22, 0.85]) {
    g.add(lampRect(kit, M.dark, M.amber, { at: [x, WS_T[0] - 0.02, CAB_ZT + 0.035], w: 0.1, h: 0.04 }));
  }
  g.add(kit.cyl(0.05, 0.055, 0.07, M.dark, { axis: 'y', at: [-0.35, WS_T[0] - 0.03, CAB_ZT + 0.05], segments: 12 }));

  // --- Parachoques de cajón: faros, intermitentes, grilletes, cubrecárter.
  g.add(cbox(kit, M.body, 2.44, 0.3, 0.3, 0.03, { at: [0, 3.35, 0.77] }));
  g.add(cbox(kit, M.body, 1.6, 0.36, 0.1, 0.02, { at: [0, 3.2, 0.57] }));
  for (let i = 0; i < 3; i++) g.add(kit.box(1.1, 0.012, 0.025, M.dark, { at: [0, 3.385, 0.55 + i * 0.03 - 0.03] }));
  for (const s of [-1, 1] as const) {
    g.add(lampRound(kit, M.dark, { at: [s * 0.9, 3.5, 0.79], r: 0.08 }));
    g.add(lampRound(kit, M.dark, { at: [s * 1.1, 3.5, 0.79], r: 0.055, lens: M.amber }));
    g.add(kit.box(0.05, 0.004, 0.04, M.amber, { at: [s * 1.2, 3.47, 0.86] }));
    // Grillete de remolque colgando de su horquilla.
    g.add(kit.box(0.12, 0.08, 0.1, M.body, { at: [s * 0.44, 3.53, 0.82] }));
    g.add(kit.torus(0.055, 0.018, M.body, { axis: 'y', at: [s * 0.44, 3.56, 0.72], segments: 14 }));
    g.add(kit.cyl(0.02, 0.02, 0.16, M.steel, { axis: 'x', at: [s * 0.44, 3.56, 0.79], segments: 8 }));
    // Escalón en la esquina delantera, por delante de la rueda.
    g.add(stepLadder(kit, M.chassis, { at: [s * 1.06, 2.82, 1.0], w: 0.3, steps: 2, rise: 0.32, depth: 0.18 }));
    // Guardabarros interior sobre la rueda delantera + faldón trasero.
    g.add(fenderArc(kit, M.polymer, { x: s * 1.0, cy: Y_AX_F, cz: AXLE_Z, r: 0.63, t: 0.035, w: 0.42, a0: 25, a1: 155 }));
    g.add(mudflap(kit, { at: [s * 1.0, Y_AX_F - 0.68, 0.72], w: 0.42, h: 0.5 }));
  }
  g.add(kit.box(0.3, 0.004, 0.07, M.white, { at: [-0.45, 3.502, 0.86] }));
  g.add(kit.box(0.24, 0.004, 0.07, M.white, { at: [0.5, 3.502, 0.86] }));

  // --- Laterales: puerta en las dos facetas, lunas, pasamanos, espejos.
  for (const s of [-1, 1] as const) {
    const up = facet(kit, g, s, 'up');
    const lo = facet(kit, g, s, 'lo');
    const o = (d: number) => s * d; // desplazamiento hacia fuera en X local
    const dy0 = 1.72, dy1 = 2.92;
    // Juntas de la puerta.
    for (const y of [dy0, dy1]) {
      up.add(kit.box(0.008, 0.012, UP_LEN * 0.9, M.dark, { at: [o(0.003), y, UP_LEN * 0.45] }));
      lo.add(kit.box(0.008, 0.012, LO_LEN * 0.96, M.dark, { at: [o(0.003), y, LO_LEN * 0.5] }));
    }
    up.add(kit.box(0.008, dy1 - dy0, 0.012, M.dark, { at: [o(0.003), (dy0 + dy1) / 2, UP_LEN * 0.9] }));
    lo.add(kit.box(0.008, dy1 - dy0, 0.012, M.dark, { at: [o(0.003), (dy0 + dy1) / 2, 0.03] }));
    // Luna de la puerta (alta y adelantada) en marco blindado.
    up.add(cbox(kit, M.body, 0.04, 0.46, 0.42, 0.012, { at: [o(0.016), 2.62, 0.52] }));
    up.add(kit.box(0.012, 0.32, 0.27, M.glass, { at: [o(0.037), 2.62, 0.53] }));
    up.add(boltRow(kit, M.steel, [o(0.037), 2.42, 0.72], [o(0.037), 2.82, 0.72], 4, 'x', 0.01, 0.012));
    // Ventanuco trasero vertical.
    up.add(cbox(kit, M.body, 0.035, 0.2, 0.5, 0.01, { at: [o(0.014), 1.48, 0.42] }));
    up.add(kit.box(0.012, 0.1, 0.38, M.glass, { at: [o(0.033), 1.48, 0.42] }));
    // Bisagras delanteras, manilla y cerradura.
    for (const u of [0.25, 0.6]) {
      lo.add(kit.box(0.03, 0.08, 0.1, M.body, { at: [o(0.015), dy1 - 0.05, u] }));
    }
    up.add(kit.box(0.03, 0.08, 0.1, M.body, { at: [o(0.015), dy1 - 0.05, 0.35] }));
    lo.add(kit.box(0.035, 0.16, 0.04, M.dark, { at: [o(0.02), dy0 + 0.16, LO_LEN * 0.82] }));
    up.add(kit.box(0.025, 0.06, 0.06, M.body, { at: [o(0.012), dy0 + 0.16, 0.12] }));
    // Remaches del blindaje en las facetas.
    lo.add(boltRow(kit, M.steel, [o(0.004), dy0 - 0.25, 0.1], [o(0.004), dy0 - 0.25, LO_LEN - 0.08], 4, 'x', 0.012, 0.012));
    up.add(boltRow(kit, M.steel, [o(0.004), dy0 - 0.25, 0.1], [o(0.004), dy0 - 0.25, UP_LEN - 0.12], 5, 'x', 0.012, 0.012));
    lo.add(boltRow(kit, M.steel, [o(0.004), 3.1, 0.1], [o(0.004), 3.1, LO_LEN - 0.08], 3, 'x', 0.012, 0.012));
    // Pasamanos curvo de la puerta (por las dos facetas).
    g.add(kit.tube([
      facetPt(s, 'lo', 2.45, 0.12, 0.05),
      facetPt(s, 'lo', 2.5, LO_LEN * 0.75, 0.06),
      facetPt(s, 'up', 2.42, 0.25, 0.06),
      facetPt(s, 'up', 2.2, UP_LEN * 0.55, 0.06),
      facetPt(s, 'up', 2.05, UP_LEN * 0.62, 0.05),
    ], 0.014, M.dark, { segments: 24 }));
    // Pasamanos de esquina desde el techo + brazo del espejo.
    g.add(grabHandle(kit, M.dark, [s * (CAB_HT - 0.08), WS_T[0] - 0.12, CAB_ZT + 0.01],
      [s * (CAB_HC + 0.02), WS_B[0] - 0.22, CAB_ZC + 0.05], [s * 0.1, 0.06, 0.08], 0.016));
    g.add(kit.tube([
      [s * (CAB_HC - 0.02), WS_B[0] - 0.2, CAB_ZC + 0.4],
      [s * (CAB_HC + 0.14), WS_B[0] - 0.16, CAB_ZC + 0.42],
      [s * (CAB_HC + 0.24), WS_B[0] - 0.2, CAB_ZC + 0.3],
    ], 0.016, M.dark, { segments: 12 }));
    g.add(kit.tube([
      [s * (CAB_HC - 0.01), WS_B[0] - 0.2, CAB_ZC - 0.1],
      [s * (CAB_HC + 0.16), WS_B[0] - 0.17, CAB_ZC - 0.08],
      [s * (CAB_HC + 0.24), WS_B[0] - 0.2, CAB_ZC + 0.02],
    ], 0.016, M.dark, { segments: 12 }));
    g.add(cbox(kit, M.dark, 0.06, 0.2, 0.42, 0.015, { at: [s * (CAB_HC + 0.27), WS_B[0] - 0.2, CAB_ZC + 0.16] }));
    g.add(kit.box(0.008, 0.17, 0.38, M.glass, { at: [s * (CAB_HC + 0.27), WS_B[0] - 0.305, CAB_ZC + 0.16], rotDeg: [0, 0, 90] }));
    // Faldón negro bajo la faceta (tapa el paso de rueda por fuera).
    g.add(kit.box(0.05, 0.9, 0.12, M.polymer, { at: [s * (CAB_HB - 0.03), 1.62, CAB_ZB - 0.04] }));
  }

  // --- Techo: escotilla, antenas, GPS.
  g.add(kit.cyl(0.46, 0.48, 0.07, M.body, { axis: 'z', at: [0.3, 2.05, CAB_ZT + 0.035], segments: 24 }));
  g.add(kit.cyl(0.38, 0.4, 0.05, M.body, { axis: 'z', at: [0.3, 2.05, CAB_ZT + 0.095], segments: 24 }));
  g.add(kit.box(0.16, 0.1, 0.08, M.dark, { at: [0.3, 1.6, CAB_ZT + 0.1] }));
  g.add(kit.cyl(0.06, 0.06, 0.03, M.white, { axis: 'z', at: [-0.4, 1.6, CAB_ZT + 0.015], segments: 12 }));
  for (const s of [-1, 1] as const) {
    g.add(whipAntenna(kit, { at: [s * 0.86, CAB_R + 0.12, CAB_ZT], len: 1.75, bendDeg: s > 0 ? 34 : 18 }));
  }

  // --- Tras la cabina: toma de aire con prefiltro (izq.), filtro de aire,
  //     armario de equipos (der.).
  g.add(kit.cyl(0.1, 0.1, 1.5, M.body, { axis: 'z', at: [-1.02, CAB_R - 0.16, 2.28], segments: 16 }));
  g.add(cbox(kit, M.body, 0.26, 0.34, 0.24, 0.03, { at: [-1.02, CAB_R - 0.1, 3.08] }));
  g.add(kit.box(0.2, 0.01, 0.16, M.dark, { at: [-1.02, CAB_R + 0.072, 3.08] }));
  g.add(kit.cyl(0.22, 0.22, 0.5, M.body, { axis: 'x', at: [-0.84, CAB_R - 0.25, 1.6], segments: 20 }));
  g.add(kit.cyl(0.2, 0.2, 0.04, M.chassis, { axis: 'x', at: [-1.11, CAB_R - 0.25, 1.6], segments: 20 }));
  g.add(kit.tube([[-0.84, CAB_R - 0.25, 1.82], [-0.95, CAB_R - 0.2, 1.95], [-1.02, CAB_R - 0.16, 1.6]], 0.07, M.chassis));
  g.add(cbox(kit, M.body, 0.7, 0.3, 1.1, 0.03, { at: [0.72, CAB_R - 0.2, 1.75] }));
  g.add(kit.box(0.6, 0.01, 0.9, M.panel, { at: [0.72, CAB_R - 0.355, 1.75] }));
  g.add(kit.box(0.04, 0.03, 0.12, M.dark, { at: [0.48, CAB_R - 0.36, 1.75] }));
}

/** Tornillería perimetral del frente inferior. */
function boltRowFront(kit: ModelKit, M: Mats, g: THREE.Group, fy: number): void {
  for (const s of [-1, 1] as const) {
    g.add(boltRow(kit, M.steel, [s * 1.0, fy + 0.002, 1.35], [s * 1.0, fy + 0.002, 1.9], 4, 'y', 0.012, 0.012));
  }
  g.add(boltRow(kit, M.steel, [-0.7, fy + 0.002, 1.32], [0.7, fy + 0.002, 1.32], 6, 'y', 0.012, 0.012));
}

// ---------------------------------------------------------------------------
//  Parte trasera fija: plataforma, aro fijo, guardabarros, depósitos, luces
// ---------------------------------------------------------------------------

function buildRearBody(kit: ModelKit, M: Mats, g: THREE.Group): void {
  // Bastidor del LM ("pallet") sobre los largueros: dos vigas cajón con
  // travesaños, placa de asiento del aro y pasarelas de rejilla.
  const dy0 = CAB_R - 0.05, dy1 = -3.46;
  for (const s of [-1, 1] as const) {
    g.add(cbox(kit, M.body, 0.16, dy0 - dy1, 0.1, 0.012, { at: [s * 0.45, (dy0 + dy1) / 2, DECK_Z - 0.05] }));
  }
  for (const y of [0.95, 0.2, -0.55, -3.3]) {
    g.add(kit.box(1.5, 0.1, 0.08, M.body, { at: [0, y, DECK_Z - 0.06] }));
  }
  g.add(cbox(kit, M.body, 2.06, 2.3, 0.06, 0.02, { at: [0, AXIS_Y, DECK_Z - 0.03] }));
  for (const s of [-1, 1] as const) {
    // Pasarela de rejilla entre la cabina y el aro (lado exterior).
    g.add(kit.box(0.4, 1.3, 0.03, M.chassis, { at: [s * 0.62, 0.35, DECK_Z - 0.02] }));
    for (let i = 0; i < 6; i++) g.add(kit.box(0.4, 0.015, 0.012, M.body, { at: [s * 0.62, -0.2 + i * 0.22, DECK_Z + 0.002] }));
  }
  // Aro de rodadura fijo con tornillería.
  const ay = AXIS_Y;
  g.add(kit.cyl(0.97, 0.97, RING_Z - DECK_Z, M.chassis, { axis: 'z', at: [0, ay, (RING_Z + DECK_Z) / 2], segments: 40 }));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    g.add(kit.cyl(0.014, 0.014, 0.02, M.steel, {
      axis: 'z', at: [Math.cos(a) * 0.93, ay + Math.sin(a) * 0.93, RING_Z + 0.008], segments: 5,
    }));
  }
  // Calzo delantero de la caja en marcha (dos caballetes + almohadilla).
  for (const s of [-1, 1] as const) {
    g.add(kit.extrudeSide([[0.42, DECK_Z], [0.78, DECK_Z], [0.66, 1.5], [0.54, 1.5]], 0.08, M.body,
      { at: [s * 0.45, 0, 0] }));
  }
  g.add(kit.box(1.0, 0.18, 0.04, M.body, { at: [0, 0.6, 1.5] }));
  g.add(kit.box(0.9, 0.14, 0.02, M.polymer, { at: [0, 0.6, 1.53] }));

  // Guardabarros del tándem con faldones.
  const fy0 = -0.6, fy1 = -3.42;
  for (const s of [-1, 1] as const) {
    const fx = s * 1.02;
    g.add(kit.box(0.46, fy0 - fy1, 0.035, M.body, { at: [fx, (fy0 + fy1) / 2, 1.3] }));
    g.add(kit.extrudeSide([[fy0, 1.3], [fy0 + 0.28, 1.3], [fy0, 1.05]], 0.46, M.body, { at: [fx, 0, 0] }));
    g.add(kit.box(0.03, fy0 - fy1, 0.12, M.body, { at: [s * 1.24, (fy0 + fy1) / 2, 1.26] }));
    g.add(mudflap(kit, { at: [fx, fy1 + 0.02, 0.8], w: 0.44, h: 0.6 }));
    g.add(mudflap(kit, { at: [fx, (Y_AX_R1 + Y_AX_R2) / 2, 1.0], w: 0.4, h: 0.22 }));
  }

  // Lado izquierdo: depósito de combustible + caja de baterías con
  // acumuladores, escalón de acceso al LM.
  g.add(fuelTank(kit, M.body, M.chassis, { at: [-0.9, 0.85, 0.76], len: 0.85, w: 0.46, h: 0.5, side: -1 }));
  g.add(stowBox(kit, M.body, M.dark, { at: [-0.92, -0.2, 0.86], w: 0.46, d: 0.95, h: 0.42, side: -1 }));
  for (let i = 0; i < 4; i++) {
    g.add(kit.cyl(0.07, 0.07, 0.16, M.body, { axis: 'x', at: [-1.02, -0.5 + i * 0.2, 0.56], segments: 12 }));
  }
  g.add(stepLadder(kit, M.chassis, { at: [-1.12, -0.82, 1.0], w: 0.28, steps: 2, rise: 0.3, depth: 0.16 }));
  // Lado derecho: rueda de repuesto vertical en su soporte + caja.
  g.add(buildWheel(kit, {
    radius: WHEEL_R, width: WHEEL_W, rimRadius: RIM_R, tread: 'xzl', style: 'fmtv', rimColor: 0x2c3120,
    side: 1, at: [0.9, -0.18, 0.68], ctis: false, merge: false,
  }));
  g.add(kit.box(0.08, 0.9, 0.08, M.chassis, { at: [0.64, -0.18, 0.68] }));
  g.add(kit.box(0.08, 0.08, 0.5, M.chassis, { at: [0.64, -0.18, 0.9] }));
  g.add(stowBox(kit, M.body, M.dark, { at: [0.92, 0.85, 0.84], w: 0.44, d: 0.7, h: 0.46, side: 1 }));

  // Parachoques trasero, grupos ópticos, enganche, reflectantes.
  g.add(cbox(kit, M.body, 2.36, 0.14, 0.22, 0.02, { at: [0, -3.44, 0.8] }));
  for (const s of [-1, 1] as const) {
    const lx = s * 0.92;
    g.add(kit.box(0.36, 0.06, 0.14, M.dark, { at: [lx, -3.53, 0.82] }));
    g.add(lampRound(kit, M.dark, { at: [lx - s * 0.1, -3.56, 0.82], r: 0.04, lens: M.red, rotDeg: [0, 0, 180] }));
    g.add(lampRound(kit, M.dark, { at: [lx, -3.56, 0.82], r: 0.04, lens: M.amber, rotDeg: [0, 0, 180] }));
    g.add(lampRound(kit, M.dark, { at: [lx + s * 0.1, -3.56, 0.82], r: 0.04, lens: M.red, rotDeg: [0, 0, 180] }));
    g.add(kit.box(0.07, 0.005, 0.07, M.red, { at: [s * 1.12, -3.513, 0.76] }));
  }
  g.add(kit.box(0.22, 0.2, 0.16, M.chassis, { at: [0, -3.5, 0.66] }));
  g.add(kit.torus(0.06, 0.02, M.bright, { axis: 'z', at: [0, -3.64, 0.64], segments: 14 }));
  // Bidones en soporte trasero (bajo la caja, lado izquierdo).
  g.add(jerrycan(kit, M.body, { at: [-0.5, -3.3, 1.05], rotDeg: [0, 90, 0] }));
  g.add(kit.box(0.5, 0.04, 0.04, M.chassis, { at: [-0.5, -3.16, 1.0] }));
}

// ---------------------------------------------------------------------------
//  Base giratoria del LM (traverse)
// ---------------------------------------------------------------------------

function buildLauncherBase(kit: ModelKit, M: Mats, g: THREE.Group): void {
  // Aro móvil con tornillería.
  g.add(kit.cyl(0.92, 0.92, 0.08, M.body, { axis: 'z', at: [0, 0, RING_Z + 0.04], segments: 40 }));
  const z0 = RING_Z + 0.08;
  const h = BASE_TOP - z0;
  // Plataforma en tres franjas (los gatos asoman por dos ranuras), testera
  // trasera baja (libra el giro de la caja) y morro achaflanado delante.
  g.add(cbox(kit, M.body, 1.92, 0.6, h - 0.06, 0.03, { at: [0, -1.18, z0 + (h - 0.06) / 2] }));
  g.add(cbox(kit, M.body, 0.62, 1.75, h, 0.06, { at: [0, -0.05, z0 + h / 2] }));
  g.add(kit.box(0.5, 1.2, 0.012, M.panel, { at: [0, -0.15, z0 + h + 0.006] }));
  g.add(kit.cyl(0.11, 0.11, 0.06, M.chassis, { axis: 'z', at: [0, 0.35, z0 + h + 0.03], segments: 14 }));
  for (const s of [-1, 1] as const) {
    g.add(cbox(kit, M.body, 0.38, 1.75, h, 0.06, { at: [s * 0.71, -0.05, z0 + h / 2] }));
    // Mangueras hidráulicas de los gatos.
    g.add(kit.tube([[s * 0.32, -0.55, z0 + h], [s * 0.4, -0.7, z0 + h + 0.04], [s * 0.5, -0.9, z0 + h + 0.02]], 0.018, M.dark));
    // Orejas de los muñones con tapa de cojinete.
    g.add(kit.extrudeSide([
      [PIV_Y - 0.22, BASE_TOP - 0.02], [PIV_Y + 0.22, BASE_TOP - 0.02], [PIV_Y + 0.1, PIV_Z + 0.1], [PIV_Y - 0.1, PIV_Z + 0.1],
    ], 0.06, M.body, { at: [s * 0.66, 0, 0] }));
    g.add(kit.cyl(0.075, 0.075, 0.04, M.steel, { axis: 'x', at: [s * 0.7, PIV_Y, PIV_Z], segments: 14 }));
    // Cajas de electrónica a los costados de la base (bajo la caja).
    g.add(stowBox(kit, M.panel, M.dark, { at: [s * 0.86, -0.45, z0 + 0.06], w: 0.22, d: 0.55, h: 0.1, side: s }));
  }
  // Motor del giro y cubiertas.
  g.add(kit.cyl(0.12, 0.12, 0.2, M.chassis, { axis: 'z', at: [0.62, -1.5, BASE_TOP - 0.02], segments: 14 }));
  g.add(kit.box(1.3, 0.01, 0.1, M.dark, { at: [0, -1.6, z0 + h / 2] }));
  g.add(boltRow(kit, M.steel, [-0.8, -1.6, BASE_TOP - 0.03], [0.8, -1.6, BASE_TOP - 0.03], 10, 'y', 0.01, 0.012));
}

// ---------------------------------------------------------------------------
//  Caja del LM (elevation): bahía central del contenedor + compartimentos
//  laterales cerrados + pluma de recarga plegada encima.
// ---------------------------------------------------------------------------

function buildLauncherBox(kit: ModelKit, M: Mats, g: THREE.Group): void {
  const L = BOX_Y1 - BOX_Y0;
  const yc = (BOX_Y0 + BOX_Y1) / 2;
  const H = BOX_Z1 - BOX_Z0;
  const sw = BOX_HW - BAY_HW;
  // Compartimentos laterales (cajas cerradas con chaflán).
  for (const s of [-1, 1] as const) {
    const cx = s * (BAY_HW + sw / 2);
    g.add(cbox(kit, M.body, sw, L, H, 0.035, { at: [cx, yc, BOX_Z0 + H / 2] }));
    const xo = s * (BOX_HW + 0.004);
    // Paneles de acceso atornillados (resalte fino) en el costado.
    for (let i = 0; i < 5; i++) {
      const y = BOX_Y0 + 0.5 + i * 0.82;
      g.add(kit.box(0.012, 0.74, 0.62, M.panel, { at: [xo, y, BOX_Z0 + H * 0.56] }));
      g.add(kit.box(0.02, 0.04, 0.06, M.dark, { at: [s * (BOX_HW + 0.012), y + 0.3, BOX_Z0 + H * 0.56] }));
    }
    // Arista inferior y estarcido del nombre del lanzador.
    g.add(kit.box(0.02, L - 0.1, 0.03, M.body, { at: [s * (BOX_HW + 0.008), yc, BOX_Z0 + 0.14] }));
    g.add(kit.box(0.004, 0.62, 0.09, M.stencil, { at: [s * (BOX_HW + 0.011), 2.05, BOX_Z0 + 0.25] }));
    // Frente de los compartimentos: tapas de acceso.
    g.add(kit.box(sw * 0.7, 0.012, H * 0.6, M.panel, { at: [cx, BOX_Y1 + 0.004, BOX_Z0 + H * 0.5] }));
    g.add(kit.box(sw * 0.7, 0.012, H * 0.6, M.panel, { at: [cx, BOX_Y0 - 0.004, BOX_Z0 + H * 0.5] }));
  }
  // Bahía central: suelo, tapa superior, dintel/umbral delanteros, trasera.
  g.add(kit.box(BAY_HW * 2, L, 0.08, M.body, { at: [0, yc, BOX_Z0 + 0.04] }));
  g.add(kit.box(BAY_HW * 2, L - 0.12, 0.05, M.body, { at: [0, yc - 0.06, BOX_Z1 - 0.025] }));
  g.add(cbox(kit, M.body, BAY_HW * 2, 0.1, 0.08, 0.015, { at: [0, BOX_Y1 - 0.05, BOX_Z1 - 0.04] }));
  g.add(cbox(kit, M.body, BAY_HW * 2, 0.1, POD_Z0 - BOX_Z0, 0.015, { at: [0, BOX_Y1 - 0.05, (BOX_Z0 + POD_Z0) / 2] }));
  g.add(kit.box(BAY_HW * 2, 0.04, H, M.body, { at: [0, BOX_Y0 + 0.02, BOX_Z0 + H / 2] }));
  g.add(kit.box(0.7, 0.01, 0.6, M.panel, { at: [0, BOX_Y0 - 0.005, BOX_Z0 + H / 2] }));
  // Orejetas del muñón y eje.
  for (const s of [-1, 1] as const) {
    g.add(kit.extrudeSide([[-0.12, BOX_Z0 + 0.02], [0.3, BOX_Z0 + 0.02], [0.1, -0.08], [-0.1, -0.08]], 0.08, M.body,
      { at: [s * 0.58, 0, 0] }));
  }
  g.add(kit.cyl(0.05, 0.05, 1.42, M.steel, { axis: 'x', segments: 14 }));
  // Herrajes inferiores de los gatos y nervios bajo el suelo.
  for (const s of [-1, 1] as const) {
    g.add(kit.box(0.16, 0.24, 0.08, M.body, { at: [s * JACK_X, JACK_BOX[0], BOX_Z0 - 0.02] }));
    g.add(kit.box(0.08, L - 0.4, 0.05, M.body, { at: [s * 0.72, yc + 0.1, BOX_Z0 - 0.02] }));
    g.add(kit.box(0.06, L - 0.6, 0.04, M.body, { at: [s * 0.25, yc + 0.2, BOX_Z0 - 0.015] }));
  }
  for (let i = 0; i < 6; i++) {
    g.add(kit.box(BOX_HW * 2 - 0.1, 0.06, 0.04, M.body, { at: [0, 0.35 + i * 0.75, BOX_Z0 - 0.015] }));
  }
  g.add(cbox(kit, M.panel, 0.5, 0.7, 0.1, 0.02, { at: [0, 3.4, BOX_Z0 - 0.04] }));
  g.add(kit.tube([[-0.6, 0.3, BOX_Z0 - 0.03], [-0.62, 1.8, BOX_Z0 - 0.04], [-0.55, 3.2, BOX_Z0 - 0.03]], 0.02, M.dark));

  // Pluma de recarga plegada: dos brazos en U cerrada por delante, con
  // carro del polipasto, cilindros de despliegue y bisagras traseras.
  const armZ = BOX_Z1 + 0.07;
  for (const s of [-1, 1] as const) {
    const ax = s * 0.82;
    g.add(cbox(kit, M.body, 0.13, 3.95, 0.14, 0.02, { at: [ax, 2.18, armZ] }));
    g.add(cbox(kit, M.body, 0.2, 0.26, 0.2, 0.02, { at: [ax, 0.28, armZ + 0.02] }));
    g.add(kit.cyl(0.05, 0.05, 0.26, M.steel, { axis: 'x', at: [ax, 0.28, armZ + 0.04], segments: 12 }));
    g.add(kit.cyl(0.045, 0.045, 1.6, M.chassis, { at: [s * 0.6, 3.2, BOX_Z1 + 0.05], segments: 12 }));
    g.add(kit.cyl(0.025, 0.025, 0.7, M.bright, { at: [s * 0.6, 2.05, BOX_Z1 + 0.05], segments: 10 }));
  }
  g.add(cbox(kit, M.body, 1.8, 0.16, 0.16, 0.02, { at: [0, BOX_Y1 - 0.12, armZ] }));
  g.add(cbox(kit, M.chassis, 0.42, 0.24, 0.16, 0.02, { at: [0, BOX_Y1 - 0.32, armZ - 0.01] }));
  g.add(kit.cyl(0.06, 0.06, 0.34, M.chassis, { axis: 'x', at: [0, BOX_Y1 - 0.32, armZ + 0.09], segments: 12 }));
  // Luces y antena de posición en la caja.
  g.add(kit.box(0.06, 0.005, 0.04, M.red, { at: [-0.95, BOX_Y0 - 0.006, BOX_Z1 - 0.1] }));
  g.add(kit.box(0.06, 0.005, 0.04, M.red, { at: [0.95, BOX_Y0 - 0.006, BOX_Z1 - 0.1] }));
}

// ---------------------------------------------------------------------------
//  Contenedor (recoil): LPC GMLRS/ER o pod PrSM. Devuelve muzzleLocal.
// ---------------------------------------------------------------------------

function buildPod(kit: ModelKit, M: Mats, g: THREE.Group, variant: Variant): THREE.Vector3 {
  const podMat = variant === 'prsm' ? M.podPrsm : M.pod;
  const L = POD_Y1 - POD_Y0;
  const yc = (POD_Y0 + POD_Y1) / 2;
  const H = POD_Z1 - POD_Z0;
  // Cuerpo (oculto casi entero por la caja) + marco frontal resaltado.
  g.add(kit.box(POD_HW * 2, L - 0.08, H, podMat, { at: [0, yc - 0.04, POD_ZC] }));
  g.add(cbox(kit, podMat, POD_HW * 2, 0.08, H, 0.012, { at: [0, POD_Y1 - 0.04, POD_ZC] }));
  const fy = POD_Y1; // cara frontal
  let muzzle: THREE.Vector3;

  if (variant === 'prsm') {
    // Dos celdas cuadradas con tapa frágil nervada (X + aro + botón).
    const cell = 0.46;
    g.add(kit.box(POD_HW * 2 - 0.04, 0.012, H - 0.04, M.dark, { at: [0, fy + 0.002, POD_ZC] }));
    for (const s of [-1, 1] as const) {
      const cx = s * 0.262;
      g.add(cbox(kit, M.podCover, cell, 0.035, cell, 0.03, { at: [cx, fy + 0.012, POD_ZC] }));
      for (const a of [45, -45]) {
        g.add(kit.box(cell * 1.15, 0.02, 0.028, podMat, { at: [cx, fy + 0.034, POD_ZC], rotDeg: [0, a, 0] }));
      }
      g.add(kit.lathe([[0.15, 0.0], [0.15, 0.018], [0.125, 0.018], [0.125, 0.0]], podMat,
        { axis: 'y', at: [cx, fy + 0.03, POD_ZC], segments: 24 }));
      g.add(kit.cyl(0.05, 0.05, 0.03, M.dark, { axis: 'y', at: [cx, fy + 0.04, POD_ZC], segments: 12 }));
      g.add(kit.box(0.16, 0.004, 0.05, M.white, { at: [cx, fy + 0.031, POD_ZC + 0.16] }));
    }
    // Bandas: amarilla (HE) arriba, blanca (misil guiado) abajo.
    g.add(kit.box(POD_HW * 2 - 0.05, 0.006, 0.035, M.yellow, { at: [0, fy + 0.009, POD_Z1 - 0.04] }));
    g.add(kit.box(POD_HW * 2 - 0.05, 0.006, 0.035, M.white, { at: [0, fy + 0.009, POD_Z0 + 0.04] }));
    muzzle = new THREE.Vector3(-0.262, fy + 0.03, POD_ZC);
  } else {
    // LPC: 6 tapas frágiles en "lata" casi tangentes (2 filas × 3).
    const xs = [-0.32, 0, 0.32];
    const zs = [POD_ZC + 0.16, POD_ZC - 0.16];
    g.add(kit.box(POD_HW * 2 - 0.03, 0.012, H - 0.03, M.dark, { at: [0, fy + 0.002, POD_ZC] }));
    for (const z of zs) {
      for (const x of xs) {
        g.add(kit.lathe([
          [0.15, 0.0], [0.15, 0.045], [0.142, 0.058], [0.11, 0.064], [0.0, 0.066],
        ], M.podCover, { axis: 'y', at: [x, fy, z], segments: 24 }));
        // Botón frágil central + estarcido.
        g.add(kit.cyl(0.03, 0.03, 0.006, podMat, { axis: 'y', at: [x, fy + 0.068, z], segments: 10 }));
        g.add(kit.box(0.12, 0.004, 0.03, M.stencil, { at: [x, fy + 0.066, z + 0.07] }));
      }
    }
    // Banda de marcado: GMLRS amarilla; ER añade una banda marrón (motor de
    // largo alcance) bajo la amarilla y bloques blancos en las tapas.
    g.add(kit.box(POD_HW * 2 - 0.04, 0.006, 0.036, M.yellow, { at: [0, fy + 0.009, POD_Z1 - 0.045] }));
    if (variant === 'ergmlrs') {
      g.add(kit.box(POD_HW * 2 - 0.04, 0.006, 0.03, M.brown, { at: [0, fy + 0.009, POD_Z1 - 0.082] }));
      for (const x of xs) {
        for (const z of zs) g.add(kit.box(0.1, 0.004, 0.045, M.white, { at: [x, fy + 0.066, z - 0.07] }));
      }
    }
    muzzle = new THREE.Vector3(xs[0], fy + 0.066, zs[0]);
  }
  return muzzle;
}

// ---------------------------------------------------------------------------
//  Gatos de elevación: cilindro (traverse) + vástago (elevation)
// ---------------------------------------------------------------------------

function buildJacks(
  kit: ModelKit, M: Mats, traverse: THREE.Object3D, elevation: THREE.Object3D,
): { nodes: THREE.Object3D[]; update(elDeg: number): void } {
  const barrels: THREE.Group[] = [];
  const rods: THREE.Group[] = [];
  for (const s of [-1, 1] as const) {
    const barrel = kit.group({ name: `jack-barrel-${s > 0 ? 'r' : 'l'}`, at: [s * JACK_X, JACK_BASE[0], JACK_BASE[1]] });
    barrel.add(kit.cyl(0.075, 0.075, JACK_BARREL_L, M.body, { at: [0, JACK_BARREL_L / 2, 0], segments: 16 }));
    barrel.add(kit.cyl(0.09, 0.09, 0.08, M.body, { at: [0, JACK_BARREL_L - 0.04, 0], segments: 16 }));
    barrel.add(kit.cyl(0.065, 0.065, 0.14, M.steel, { axis: 'x', segments: 12 }));
    barrel.add(kit.tube([[s * 0.07, 0.15, 0.03], [s * 0.1, 0.6, 0.06], [s * 0.08, 1.1, 0.07]], 0.014, M.dark));
    consolidate(kit, barrel);
    traverse.add(barrel);
    barrels.push(barrel);

    const rod = kit.group({ name: `jack-rod-${s > 0 ? 'r' : 'l'}`, at: [s * JACK_X, JACK_BOX[0], JACK_BOX[1]] });
    rod.add(kit.cyl(0.045, 0.045, JACK_ROD_L, M.bright, { at: [0, JACK_ROD_L / 2, 0], segments: 12 }));
    rod.add(kit.cyl(0.055, 0.055, 0.12, M.steel, { axis: 'x', segments: 12 }));
    consolidate(kit, rod);
    elevation.add(rod);
    rods.push(rod);
  }
  const update = (elDeg: number): void => {
    const el = elDeg * DEG;
    const c = Math.cos(el), s = Math.sin(el);
    // Anclaje en la caja, en coordenadas de traverse.
    const cy = PIV_Y + JACK_BOX[0] * c - JACK_BOX[1] * s;
    const cz = PIV_Z + JACK_BOX[0] * s + JACK_BOX[1] * c;
    const a = Math.atan2(cz - JACK_BASE[1], cy - JACK_BASE[0]);
    for (const b of barrels) b.rotation.x = a;
    // El vástago apunta de la caja a la base: ángulo absoluto a + π.
    for (const r of rods) r.rotation.x = a + Math.PI - el;
  };
  return { nodes: [...barrels, ...rods], update };
}
