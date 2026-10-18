// ============================================================================
//  m270.ts — Lanzacohetes múltiple M270A1 MLRS.  [V2 · 3D-TRACKED]
//
//  Referencias públicas (TM / afvdatabase / Lockheed Martin): vehículo
//  6.97 × 2.97 × 2.59 m (lanzador replegado), vía 2.40 m, cadena de 0.533 m
//  y paso 152 mm (88-89 zapatas), contacto con el suelo 4.33 m; portador
//  M993 (derivado del Bradley): 6 ruedas duales agrupadas en tres parejas,
//  rueda motriz delantera de 11 dientes, tensora trasera, 2 rodillos de
//  retorno dobles + 2 simples; cabina blindada de 3 plazas con ventanas
//  protegidas por persianas blindadas (cerradas para el lanzamiento).
//  Módulo lanzador-cargador M269 (LLM) con DOS contenedores de
//  4.01 × 1.05 × 0.71 m: traverse ±194° (aquí 360°), elevación hasta +60°,
//  bisagra de elevación en el extremo TRASERO de la jaula.
//
//  Variantes por ctx.weaponId:
//    · 'm26' (y por defecto): dos LPC M77 de 6 tubos (3 × 2) con tapas
//      frangibles; muzzleLocal = boca del tubo superior-izquierdo del
//      contenedor DERECHO (el primero de la secuencia en este modelo).
//    · 'tacticalMissile' (ATACMS): dos pods de misil (misma envolvente) con
//      una única tapa grande Ø 0.66 m; muzzleLocal = centro de la tapa del
//      pod derecho.
//
//  Espacio de modelado: origen en el suelo bajo el eje de giro del LLM
//  (≈ tercio trasero del casco). Jerarquía: root ⊇ [casco, cabina, tren]
//  + traverse (base giratoria) ⊇ elevation (bisagra trasera de la jaula)
//  ⊇ recoil (contenedores; carrera 0). Los dos cilindros de elevación
//  (base → jaula) se orientan cada frame en animate().
// ============================================================================
import * as THREE from 'three';
import { PAINT } from '../kit';
import type { PlatformBuilder, RigAnimState } from '../rig';
import { buildRunningGear } from '../parts/tracks';
import { bakeStatic, extrudeSideExact, keep, latheCrisp, rod } from '../parts/tracked-geo';
import * as D from '../parts/tracked-details';

// --- Cotas (m), origen = eje de giro del LLM -------------------------------
const HULL = { rear: -0.8, nose: 6.17, deck: 1.45, belly: 0.43, halfLower: 0.875, halfUpper: 1.48, sponsonZ: 1.16 };
const CAB = { y0: 3.95, y1: 5.98, z1: 2.56, half: 1.31 };
/** Bisagra de elevación de la jaula (extremo trasero, abajo). */
const HINGE = { y: -0.38, z: 1.72 };
/** Jaula y contenedores en coordenadas de `elevation`. */
const CAGE = { len: 4.3, half: 1.17, z0: -0.06, z1: 0.78 };
const POD = { w: 1.05, h: 0.71, len: 4.01, y0: 0.17, z0: 0.03, xc: 0.555 };
/** Puntos de anclaje de los cilindros de elevación. */
const ACT = { baseY: 0.5, baseZ: 1.53, cageY: 2.6, cageZ: -0.2, x: 1.06 };

export const buildM270: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const atacms = ctx.weaponId === 'tacticalMissile';
  const root = new THREE.Group();
  root.name = atacms ? 'm270a1-atacms' : 'm270a1';

  const paint = kit.paint(PAINT.carcGreen);
  const paintSoft = kit.paint(PAINT.carcGreen, { roughness: 0.82 });
  const podPaint = kit.paint(0x56592f, { roughness: 0.78 });
  const steel = kit.steel();

  // ===========================================================================
  //  CASCO M993 + CABINA (estáticos)
  // ===========================================================================
  const hull = kit.group({ name: 'hull' });
  root.add(hull);
  hull.add(extrudeSideExact(kit, [
    [-0.55, HULL.belly], [5.45, HULL.belly], [HULL.nose, 1.08], [HULL.nose, 1.24], [6.02, HULL.deck],
    [HULL.rear, HULL.deck], [HULL.rear, 0.62],
  ], HULL.halfLower * 2, paint, { chamfer: 0.025 }));
  hull.add(extrudeSideExact(kit, [
    [HULL.rear, HULL.sponsonZ], [5.98, HULL.sponsonZ], [6.06, 1.3], [6.02, HULL.deck], [HULL.rear, HULL.deck],
  ], HULL.halfUpper * 2, paint, { chamfer: 0.03 }));
  // Pestañas de guardabarros y faldones.
  for (const s of [-1, 1]) {
    hull.add(kit.box(0.03, HULL.nose - HULL.rear - 0.3, 0.05, paint, { at: [s * (HULL.halfUpper + 0.005), (HULL.rear + 5.9) / 2, HULL.sponsonZ + 0.02] }));
    hull.add(kit.box(0.56, 0.012, 0.16, kit.rubber(), { at: [s * 1.2, 6.03, HULL.sponsonZ - 0.08] }));
    hull.add(kit.box(0.56, 0.012, 0.22, kit.rubber(), { at: [s * 1.2, HULL.rear - 0.01, HULL.sponsonZ - 0.11] }));
  }

  // Cabina blindada: perfil lateral con parabrisas inclinado.
  const cabSide: Array<[number, number]> = [
    [CAB.y0, HULL.deck], [CAB.y1, HULL.deck], [CAB.y1, 1.66], [5.66, 2.48], [5.55, CAB.z1], [CAB.y0, CAB.z1],
  ];
  hull.add(extrudeSideExact(kit, cabSide, CAB.half * 2, paint, { chamfer: 0.045 }));
  // Ventanas frontales (cristal) bajo persianas blindadas de lamas cerradas.
  {
    const a = new THREE.Vector2(5.66 - CAB.y1, 2.48 - 1.66);
    const L = a.length();
    const ang = Math.atan2(a.y, a.x); // ángulo del parabrisas respecto a +Y
    const nrm = new THREE.Vector2(a.y, -a.x).normalize(); // normal exterior (adelante-arriba)
    const mid = (t: number, off: number): [number, number] => [CAB.y1 + a.x * t + nrm.x * off, 1.66 + a.y * t + nrm.y * off];
    for (const s of [-1, 1]) {
      const [y, z] = mid(0.5, 0.012);
      // Tras las persianas cerradas el cristal se ve oscuro (sin reflejo del cielo).
      const glass = kit.box(1.02, L * 0.7, 0.01, kit.polymer(0x101418), { at: [s * 0.6, y, z] });
      glass.rotation.x = ang;
      hull.add(glass);
      // Marco de la persiana.
      const [fy, fz] = mid(0.5, 0.03);
      const frameTop = kit.box(1.12, 0.05, 0.04, paint, { at: [s * 0.6, fy, fz] });
      frameTop.rotation.x = ang;
      // Lamas.
      for (let i = 0; i < 7; i++) {
        const t = 0.18 + i * 0.105;
        const [ly, lz] = mid(t, 0.045);
        const slat = kit.box(1.06, 0.07, 0.012, paint, { at: [s * 0.6, ly, lz] });
        slat.rotation.x = ang - 0.55;
        hull.add(slat);
      }
      for (const dx of [-0.54, 0.54]) {
        const [py, pz] = mid(0.5, 0.03);
        const post = kit.box(0.04, L * 0.78, 0.05, paint, { at: [s * 0.6 + dx, py, pz] });
        post.rotation.x = ang;
        hull.add(post);
      }
      // Bisagras superiores de la persiana.
      const [hy, hz] = mid(0.9, 0.04);
      hull.add(kit.cyl(0.025, 0.025, 1.0, paint, { axis: 'x', at: [s * 0.6, hy, hz], segments: 10 }));
    }
    // Montante central.
    const [cy, cz] = mid(0.5, 0.02);
    const mull = kit.box(0.1, L, 0.04, paint, { at: [0, cy, cz] });
    mull.rotation.x = ang;
    hull.add(mull);
  }
  // Puertas laterales con ventanilla, bisagras, asas y estribos.
  for (const s of [-1, 1]) {
    const x = s * (CAB.half + 0.01);
    hull.add(kit.box(0.025, 0.95, 0.95, paintSoft, { at: [x, 4.95, 1.98], bevel: 0.01 }));
    D.seamRect(kit, hull, [x + s * 0.0125, 4.95, 1.98], 0.93, 0.93, 'x', s as 1 | -1);
    hull.add(kit.box(0.02, 0.5, 0.34, kit.glass(), { at: [x + s * 0.008, 5.05, 2.22] }));
    hull.add(kit.box(0.03, 0.56, 0.04, paint, { at: [x + s * 0.01, 5.05, 2.41] }));
    hull.add(kit.box(0.03, 0.56, 0.04, paint, { at: [x + s * 0.01, 5.05, 2.03] }));
    for (const z of [1.7, 2.25]) hull.add(kit.cyl(0.028, 0.028, 0.16, paint, { axis: 'z', at: [x + s * 0.02, 5.43, z], segments: 10 }));
    hull.add(kit.box(0.04, 0.12, 0.035, steel, { at: [x + s * 0.03, 4.55, 1.95] }));
    // Estribo y asidero.
    hull.add(kit.box(0.3, 0.36, 0.025, steel, { at: [s * (HULL.halfUpper - 0.1), 4.95, HULL.deck + 0.012] }));
    D.grabHandle(kit, hull, [x, 4.38, 1.75], [x, 4.38, 2.3], [s, 0, 0], steel, 0.06, 0.012);
    // Rejilla de ventilación lateral de la cabina (bajo la puerta, a popa).
    D.louverPanel(kit, hull, [x + s * 0.004, 4.25, 2.2], 0.36, 0.4, 5, paint, { yawDeg: s > 0 ? -90 : 90 });
  }
  // Ventana trasera de la cabina y techo: escotilla, antenas, luces de gálibo.
  hull.add(kit.box(0.9, 0.02, 0.3, kit.glass(), { at: [0, CAB.y0 - 0.01, 2.28] }));
  D.roundHatch(kit, hull, [0.62, 4.65, CAB.z1], 0.3, paint, 180);
  D.panel(kit, hull, [-0.45, 4.75, CAB.z1 + 0.008], [0.9, 0.9, 0.016], paintSoft);
  for (const s of [-1, 1]) {
    D.whipAntenna(kit, hull, [s * 1.12, 4.15, CAB.z1], 2.6, paint, [-6, s * 5]);
    hull.add(kit.box(0.08, 0.04, 0.05, kit.emissive(0xffa020, 0.35), { at: [s * 1.15, 5.56, CAB.z1 + 0.02] }));
    D.liftEye(kit, hull, [s * 1.2, 5.3, CAB.z1], paint, 0);
  }
  hull.add(latheCrisp(kit, [[0, 0], [0.09, 0], [0.09, 0.05], [0.06, 0.09], [0, 0.1]], kit.polymer(0x3a3a33), { axis: 'z', segments: 16, at: [-0.2, 4.35, CAB.z1] }));

  // Morro: faros con protector, ganchos, luces, placa frontal con pernos.
  for (const s of [-1, 1]) {
    D.headlight(kit, hull, [s * 1.12, CAB.y1, 1.47], paint);
    D.towHook(kit, hull, [s * 0.6, 6.05, 0.98], paint, 0);
    D.boltRow(kit, hull, [s * 0.15, 6.12, 1.17], [s * 0.85, 6.12, 1.17], 6, paint, 'y');
  }
  D.panel(kit, hull, [0, 5.75, 0.8], [1.2, 0.02, 0.4], paintSoft, [-43, 0, 0]);

  // Popa: pilotos, gancho, placa trasera con trampilla de acceso.
  for (const s of [-1, 1]) {
    D.tailLight(kit, hull, [s * 1.25, HULL.rear, 1.3], paint);
    D.towHook(kit, hull, [s * 0.7, HULL.rear, 0.75], paint, 180);
  }
  hull.add(kit.box(1.0, 0.03, 0.55, paintSoft, { at: [0, HULL.rear - 0.015, 1.05], bevel: 0.01 }));
  D.seamRect(kit, hull, [0, HULL.rear - 0.03, 1.05], 0.98, 0.53, 'y', -1);
  D.towCable(kit, hull, [-(HULL.halfUpper + 0.02), -0.4, 1.33], [-(HULL.halfUpper + 0.02), 3.6, 1.33], -1);
  hull.add(kit.box(0.2, 0.14, 0.16, paint, { at: [0, HULL.rear - 0.07, 0.68], bevel: 0.015 }));
  // Cubierta trasera: rejillas del sistema de refrigeración y cajones bajos.
  D.louverPanel(kit, hull, [0.0, 3.25, HULL.deck + 0.012], 1.3, 0.8, 9, paint, { horizontal: true });
  for (const s of [-1, 1]) {
    D.rectHatch(kit, hull, [s * 1.18, 2.6, HULL.deck], 0.42, 0.7, paint);
    for (const y of [0.3, 1.5, 3.7]) D.liftEye(kit, hull, [s * (HULL.halfUpper + 0.01), y, HULL.deck - 0.06], paint, s * -90, 0.04);
  }

  // Tren de rodaje M993: 6 ruedas en tres parejas, motriz delantera alta.
  const gear = buildRunningGear(kit, {
    tread: 2.4, trackWidth: 0.533, pitch: 0.152, shoeT: 0.034, padT: 0.03, guideGap: 0.085,
    sprocket: { y: 5.4, z: 0.74, r: 0.33, teeth: 11 },
    idler: { y: -0.2, z: 0.6, r: 0.28 },
    roadWheels: { ys: [0.55, 1.21, 2.25, 2.91, 3.96, 4.62], r: 0.305 },
    returnRollers: { ys: [0.75, 1.73, 3.43, 4.55], r: 0.11 },
    sag: 0.03, style: 'bradley', paint: kit.paint(PAINT.carcGreen, { wear: 0.6 }), hullHalfW: HULL.halfLower,
  });
  hull.add(gear.group);

  // ===========================================================================
  //  BASE GIRATORIA DEL LLM (traverse)
  // ===========================================================================
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  traverse.add(kit.cyl(0.95, 0.95, 0.07, kit.steel(PAINT.gunmetal, { roughness: 0.7 }), { axis: 'z', at: [0, 0, HULL.deck + 0.035], segments: 40 }));
  traverse.add(kit.box(2.0, 1.85, 0.15, paint, { at: [0, 0.2, HULL.deck + 0.075 + 0.04], bevel: 0.03 }));
  // Soportes de la bisagra trasera.
  for (const s of [-1, 1]) {
    traverse.add(kit.box(0.16, 0.32, 0.32, paint, { at: [s * 0.9, HINGE.y + 0.1, HINGE.z - 0.12], bevel: 0.02 }));
    // Orejetas de anclaje de los cilindros (por fuera de la base).
    traverse.add(kit.box(0.12, 0.2, 0.14, paint, { at: [s * (ACT.x - 0.04), ACT.baseY, ACT.baseZ], bevel: 0.015 }));
  }
  // Caja de control y depósito hidráulico en la trasera de la base.
  traverse.add(kit.box(0.9, 0.35, 0.18, paint, { at: [0, -0.62, HULL.deck + 0.2], bevel: 0.03 }));
  traverse.add(kit.cyl(0.08, 0.08, 0.6, paint, { axis: 'x', at: [0, 0.75, HULL.deck + 0.24], segments: 16 }));

  // Cilindros hidráulicos de elevación (se orientan en animate()).
  const actuators: Array<{ g: THREE.Group; rodG: THREE.Group }> = [];
  for (const s of [-1, 1]) {
    const g = keep(kit.group({ name: `act-${s}`, at: [s * ACT.x, ACT.baseY, ACT.baseZ] }));
    g.add(kit.cyl(0.07, 0.07, 1.0, paint, { at: [0, 0.5, 0], segments: 14 }));
    g.add(kit.cyl(0.08, 0.08, 0.07, paint, { at: [0, 0.98, 0], segments: 14 }));
    g.add(kit.cyl(0.06, 0.06, 0.12, steel, { axis: 'x', at: [0, 0, 0], segments: 12 }));
    const rodG = kit.group({ name: `act-rod-${s}` });
    // Vástago de 1.8 m: cubre de 0° hasta 80° (el catálogo ATACMS llega a 80°).
    rodG.add(kit.cyl(0.038, 0.038, 1.8, kit.steel(0xb8bcc0, { roughness: 0.2 }), { at: [0, -0.9, 0], segments: 10 }));
    rodG.add(kit.cyl(0.06, 0.06, 0.12, steel, { axis: 'x', at: [0, 0, 0], segments: 12 }));
    g.add(rodG);
    traverse.add(g);
    actuators.push({ g, rodG });
  }

  // ===========================================================================
  //  JAULA (elevation) + CONTENEDORES (recoil)
  // ===========================================================================
  const elevation = keep(kit.group({ name: 'elevation', at: [0, HINGE.y, HINGE.z] }));
  traverse.add(elevation);
  // Tubo de bisagra.
  elevation.add(kit.cyl(0.08, 0.08, 2.0, steel, { axis: 'x', at: [0, 0.05, 0], segments: 16 }));
  // Bandeja inferior y largueros.
  elevation.add(kit.box(CAGE.half * 2, CAGE.len, 0.07, paint, { at: [0, CAGE.len / 2, CAGE.z0 + 0.035], bevel: 0.015 }));
  for (const s of [-1, 1]) {
    const x = s * (CAGE.half - 0.05);
    for (const z of [CAGE.z0 + 0.06, CAGE.z1 - 0.05]) {
      elevation.add(kit.box(0.1, CAGE.len, 0.1, paint, { at: [x, CAGE.len / 2, z], bevel: 0.015 }));
    }
    // Montantes y diagonales laterales.
    for (const y of [0.08, 1.45, 2.85, CAGE.len - 0.08]) {
      elevation.add(kit.box(0.09, 0.09, CAGE.z1 - CAGE.z0 - 0.1, paint, { at: [x, y, (CAGE.z0 + CAGE.z1) / 2], bevel: 0.01 }));
    }
    for (const [ya, yb] of [[0.08, 1.45], [1.45, 2.85], [2.85, CAGE.len - 0.08]]) {
      elevation.add(rod(kit, [x + s * 0.01, ya, CAGE.z0 + 0.1], [x + s * 0.01, yb, CAGE.z1 - 0.1], 0.03, paint));
    }
    // Ménsula del cilindro bajo la bandeja.
    elevation.add(kit.box(0.12, 0.24, 0.2, paint, { at: [s * (ACT.x - 0.04), ACT.cageY, (CAGE.z0 + ACT.cageZ) / 2], bevel: 0.015 }));
  }
  // Mamparo trasero (placa) y marco delantero alrededor de las bocas.
  elevation.add(kit.box(CAGE.half * 2, 0.12, CAGE.z1 - CAGE.z0, paint, { at: [0, 0.06, (CAGE.z0 + CAGE.z1) / 2], bevel: 0.02 }));
  for (const z of [CAGE.z0 + 0.04, CAGE.z1 - 0.04]) {
    elevation.add(kit.box(CAGE.half * 2, 0.08, 0.08, paint, { at: [0, CAGE.len - 0.06, z], bevel: 0.015 }));
  }
  elevation.add(kit.box(0.08, 0.08, CAGE.z1 - CAGE.z0, paint, { at: [0, CAGE.len - 0.06, (CAGE.z0 + CAGE.z1) / 2] }));
  // Grúa de recarga (dos plumas sobre la jaula, plegadas) y torno.
  for (const s of [-1, 1]) {
    const x = s * 0.56;
    elevation.add(kit.box(0.16, 2.2, 0.12, paint, { at: [x, 1.25, CAGE.z1 + 0.06], bevel: 0.02 }));
    elevation.add(kit.box(0.2, 0.3, 0.16, paint, { at: [x, 0.25, CAGE.z1 + 0.08], bevel: 0.02 }));
    elevation.add(kit.cyl(0.07, 0.07, 0.22, steel, { axis: 'x', at: [x, 0.25, CAGE.z1 + 0.2], segments: 14 }));
    elevation.add(kit.box(0.12, 0.14, 0.1, paint, { at: [x, 2.3, CAGE.z1 + 0.05] }));
    elevation.add(kit.torus(0.05, 0.012, steel, { axis: 'x', at: [x, 2.42, CAGE.z1 + 0.02], segments: 12 }));
  }
  elevation.add(kit.box(1.3, 0.1, 0.08, paint, { at: [0, 0.42, CAGE.z1 + 0.05] }));
  // Faros de trabajo en la parte trasera de la jaula.
  for (const s of [-1, 1]) {
    elevation.add(kit.box(0.12, 0.08, 0.1, paint, { at: [s * 0.95, -0.02, CAGE.z1 - 0.05] }));
    elevation.add(kit.cyl(0.04, 0.04, 0.01, kit.glass(), { at: [s * 0.95, -0.065, CAGE.z1 - 0.05], segments: 12 }));
  }

  const recoil = keep(kit.group({ name: 'recoil' }));
  elevation.add(recoil);
  const faceY = POD.y0 + POD.len;
  for (const s of [-1, 1]) {
    const xc = s * POD.xc;
    const zc = POD.z0 + POD.h / 2;
    // Cuerpo del contenedor con largueros de esquina y cinchos.
    recoil.add(kit.box(POD.w, POD.len, POD.h, podPaint, { at: [xc, POD.y0 + POD.len / 2, zc], bevel: 0.025 }));
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      recoil.add(kit.box(0.06, POD.len - 0.04, 0.06, podPaint, {
        at: [xc + dx * (POD.w / 2 - 0.02), POD.y0 + POD.len / 2, zc + dz * (POD.h / 2 - 0.02)], bevel: 0.012,
      }));
    }
    for (const y of [0.5, 1.6, 2.6, 3.6]) {
      recoil.add(kit.box(POD.w + 0.02, 0.07, POD.h + 0.02, podPaint, { at: [xc, POD.y0 + y, zc], bevel: 0.012 }));
    }
    // Puntos de izado en el techo del contenedor.
    for (const y of [0.35, POD.len - 0.35]) {
      for (const dx of [-0.36, 0.36]) D.liftEye(kit, recoil, [xc + dx, POD.y0 + y, POD.z0 + POD.h], steel, 0, 0.035);
    }
    // Cara frontal.
    recoil.add(kit.box(POD.w - 0.02, 0.03, POD.h - 0.02, kit.paint(0x45482a, { roughness: 0.8 }), { at: [xc, faceY + 0.005, zc] }));
    if (!atacms) {
      // LPC M77: 6 tubos (3 columnas × 2 filas) con tapa frangible.
      for (const dx of [-0.33, 0, 0.33]) for (const dz of [-0.17, 0.17]) {
        const p: [number, number, number] = [xc + dx, faceY + 0.02, zc + dz];
        recoil.add(latheCrisp(kit, [
          [0.118, -0.02], [0.148, -0.02], [0.148, 0.018], [0.128, 0.028], [0.118, 0.028],
        ], podPaint, { segments: 20, at: p }));
        recoil.add(kit.cyl(0.118, 0.118, 0.03, kit.polymer(0x24251f), { at: [p[0], p[1] - 0.004, p[2]], segments: 20 }));
        recoil.add(kit.cyl(0.03, 0.03, 0.012, kit.polymer(0x3a3b30), { at: [p[0], p[1] + 0.016, p[2]], segments: 8 }));
      }
    } else {
      // Pod ATACMS: una sola tapa frangible grande y placa ciega reforzada.
      const p: [number, number, number] = [xc, faceY + 0.02, zc];
      recoil.add(latheCrisp(kit, [
        [0.3, -0.02], [0.345, -0.02], [0.345, 0.025], [0.32, 0.04], [0.3, 0.04],
      ], podPaint, { segments: 40, at: p }));
      recoil.add(latheCrisp(kit, [[0, 0.0], [0.3, 0.0], [0.3, 0.012], [0.08, 0.03], [0, 0.03]], kit.polymer(0x2c2d26), { segments: 40, at: [p[0], p[1] - 0.005, p[2]] }));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        recoil.add(kit.cyl(0.012, 0.012, 0.015, steel, { at: [p[0] + Math.cos(a) * 0.325, p[1] + 0.028, p[2] + Math.sin(a) * 0.325], segments: 6 }));
      }
      for (const dz of [-1, 1]) {
        recoil.add(kit.box(POD.w - 0.1, 0.02, 0.03, podPaint, { at: [xc, faceY + 0.025, zc + dz * 0.33] }));
      }
      // Banda de identificación (munición de misil: franja marrón/amarilla).
      recoil.add(kit.box(POD.w + 0.025, 0.12, POD.h + 0.025, kit.paint(0x6a5a2a, { roughness: 0.8 }), { at: [xc, faceY - 0.3, zc] }));
    }
  }

  // ===========================================================================
  //  Animación: los cilindros de elevación unen base y jaula.
  // ===========================================================================
  const tmp = new THREE.Vector3();
  const animate = (state: RigAnimState): void => {
    const el = state.elevationDeg * Math.PI / 180;
    // Punto de anclaje en la jaula, en coordenadas de traverse.
    const cy = HINGE.y + ACT.cageY * Math.cos(el) - ACT.cageZ * Math.sin(el);
    const cz = HINGE.z + ACT.cageY * Math.sin(el) + ACT.cageZ * Math.cos(el);
    for (const { g, rodG } of actuators) {
      tmp.set(0, cy - g.position.y, cz - g.position.z);
      const d = tmp.length();
      g.rotation.set(Math.atan2(tmp.z, tmp.y), 0, 0);
      rodG.position.set(0, d, 0);
    }
  };
  animate({ t: 0, dt: 0, azimuthDeg: 0, elevationDeg: 0, recoil01: 0, sinceFireS: Infinity });

  bakeStatic(kit, recoil);
  bakeStatic(kit, elevation);
  bakeStatic(kit, traverse);
  keep(traverse);
  bakeStatic(kit, root);

  const muzzleLocal = atacms
    ? new THREE.Vector3(POD.xc, faceY + 0.02, POD.z0 + POD.h / 2)
    : new THREE.Vector3(POD.xc - 0.33, faceY + 0.02, POD.z0 + POD.h / 2 + 0.17);

  return {
    root, traverse, elevation, recoil,
    muzzleLocal,
    recoilStrokeM: 0,
    footprintM: HULL.nose,
    heightM: 2.59,
    extraAnimated: actuators.flatMap(({ g, rodG }) => [g, rodG]),
    animate,
  };
};
