// ============================================================================
//  m109a7.ts — Obús autopropulsado M109A7 Paladin 155 mm L39.  [V2 · 3D-TRACKED]
//
//  Referencias públicas (BAE Systems / US Army): longitud total con el tubo
//  al frente 9.7 m, anchura 3.9 m (con estiba de torre), altura 3.3 m (con
//  la M2); chasis de componentes Bradley: 7 ruedas de rodaje duales por
//  lado (Ø 0.61 m), rueda motriz delantera, tensora trasera, cadena T161 de
//  0.533 m y paso 152 mm; cañón M284 155 mm L39 (tubo de 6.05 m) con
//  evacuador de humos y freno de boca de doble deflector; elevación −3…+75°;
//  torre de 360°; retroceso ~0.8 m.
//
//  Espacio de modelado (rig.ts): origen en el suelo bajo el eje de la torre,
//  +Y al frente del casco. Jerarquía: root ⊇ [casco + tren de rodaje]
//  + traverse (torre) ⊇ elevation (muñones) ⊇ recoil (tubo, culata, freno).
// ============================================================================
import * as THREE from 'three';
import { PAINT } from '../kit';
import type { PlatformBuilder } from '../rig';
import { buildRunningGear } from '../parts/tracks';
import { bakeStatic, extrudeSideExact, keep, latheCrisp, loft, rod, type Ring } from '../parts/tracked-geo';
import * as D from '../parts/tracked-details';

// --- Cotas principales (m) ---------------------------------------------------
const HULL = {
  rear: -2.6, glacisTop: 3.05, nose: 4.18, noseZ: 1.12, lowNoseY: 3.55,
  deck: 1.7, belly: 0.45, halfLower: 1.0, halfUpper: 1.62, sponsonZ: 1.28,
};
const TRUNNION = { y: 1.1, z: 2.25 };
/** Boca del freno (cara delantera) medida desde los muñones a lo largo del tubo. */
const MUZZLE = 5.7;
const RECOIL_STROKE = 0.8;

/** Anillo de 8 vértices (sección XZ achaflanada) para la torre. */
function ring8(y: number, hx: number, z0: number, z1: number, cTop: number, cBot: number): Ring {
  return [
    [-hx + cBot, y, z0], [hx - cBot, y, z0], [hx, y, z0 + cBot], [hx, y, z1 - cTop],
    [hx - cTop, y, z1], [-hx + cTop, y, z1], [-hx, y, z1 - cTop], [-hx, y, z0 + cBot],
  ];
}

export const buildM109A7: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const root = new THREE.Group();
  root.name = 'm109a7';

  const paint = kit.paint(PAINT.carcGreen);
  const paintSoft = kit.paint(PAINT.carcGreen, { roughness: 0.82 });
  const steel = kit.steel();
  const black = kit.polymer(0x0b0c0d);
  const canvas = kit.canvas(0x5d5b40);

  // ===========================================================================
  //  CASCO (estático)
  // ===========================================================================
  const hull = kit.group({ name: 'hull' });
  root.add(hull);

  // Casco inferior entre cadenas: vientre, placa frontal baja, nariz, glacis.
  hull.add(extrudeSideExact(kit, [
    [-2.4, HULL.belly], [HULL.lowNoseY, HULL.belly], [4.1, 1.05], [HULL.nose, HULL.noseZ],
    [HULL.glacisTop, HULL.deck], [HULL.rear, HULL.deck], [HULL.rear, 0.62],
  ], HULL.halfLower * 2, paint, { chamfer: 0.025 }));
  // Casco superior (barcazas sobre las cadenas), siguiendo el glacis.
  const slope = (HULL.deck - HULL.noseZ) / (HULL.nose - HULL.glacisTop);
  const yAtZ = (z: number) => HULL.glacisTop + (HULL.deck - z) / slope;
  hull.add(extrudeSideExact(kit, [
    [HULL.rear, HULL.sponsonZ], [yAtZ(HULL.sponsonZ + 0.08) + 0.04, HULL.sponsonZ],
    [yAtZ(HULL.sponsonZ + 0.08), HULL.sponsonZ + 0.08], [HULL.glacisTop, HULL.deck], [HULL.rear, HULL.deck],
  ], HULL.halfUpper * 2, paint, { chamfer: 0.03 }));

  // Guardabarros delanteros sobre la motriz + faldón de goma.
  const yFender0 = yAtZ(HULL.sponsonZ + 0.08);
  for (const s of [-1, 1]) {
    const x = s * 1.335;
    hull.add(kit.box(0.64, 0.32, 0.025, paint, { at: [x, yFender0 + 0.14, HULL.sponsonZ + 0.02], rotDeg: [-6, 0, 0], bevel: 0.008 }));
    hull.add(kit.box(0.6, 0.03, 0.06, paint, { at: [x, yFender0 + 0.29, HULL.sponsonZ - 0.01], bevel: 0.01 }));
    hull.add(kit.box(0.56, 0.012, 0.14, kit.rubber(), { at: [x, yFender0 + 0.3, HULL.sponsonZ - 0.1] }));
    // Faldón trasero.
    hull.add(kit.box(0.52, 0.012, 0.18, kit.rubber(), { at: [x, HULL.rear - 0.01, HULL.sponsonZ - 0.09] }));
    // Canto del guardabarros lateral (pestaña).
    hull.add(kit.box(0.03, HULL.rear * -1 + yFender0, 0.05, paint, {
      at: [s * (HULL.halfUpper + 0.005), (HULL.rear + yFender0) / 2, HULL.sponsonZ + 0.02],
    }));
  }

  // Placa trasera: puerta de municionamiento con bisagras y cierre.
  hull.add(kit.box(1.12, 0.04, 0.92, paintSoft, { at: [0, HULL.rear - 0.02, 1.16], bevel: 0.012 }));
  D.seamRect(kit, hull, [0, HULL.rear - 0.04, 1.16], 1.08, 0.88, 'y', -1);
  // Estribo bajo la puerta y asideros laterales.
  hull.add(kit.box(0.8, 0.22, 0.03, steel, { at: [0, HULL.rear - 0.12, 0.66] }));
  for (const s of [-1, 1]) D.grabHandle(kit, hull, [s * 0.68, HULL.rear - 0.02, 0.95], [s * 0.68, HULL.rear - 0.02, 1.4], [0, -1, 0], steel, 0.06, 0.012);
  // Cable de remolque en el costado izquierdo.
  D.towCable(kit, hull, [-(HULL.halfUpper + 0.02), -2.3, 1.45], [-(HULL.halfUpper + 0.02), 1.7, 1.45], -1);
  for (const z of [0.85, 1.45]) hull.add(kit.cyl(0.03, 0.03, 0.2, paint, { axis: 'z', at: [0.6, HULL.rear - 0.04, z], segments: 10 }));
  hull.add(kit.box(0.08, 0.05, 0.22, steel, { at: [-0.42, HULL.rear - 0.05, 1.18] }));
  hull.add(kit.box(0.12, 0.05, 0.04, steel, { at: [-0.42, HULL.rear - 0.08, 1.18] }));
  // Pivote de remolque, argollas y estribos traseros.
  hull.add(kit.box(0.2, 0.14, 0.16, paint, { at: [0, HULL.rear - 0.07, 0.7], bevel: 0.015 }));
  hull.add(kit.torus(0.06, 0.02, steel, { axis: 'z', at: [0, HULL.rear - 0.2, 0.72], segments: 14 }));
  for (const s of [-1, 1]) {
    D.towHook(kit, hull, [s * 0.75, HULL.rear, 0.72], paint, 180);
    D.tailLight(kit, hull, [s * 1.32, HULL.rear, 1.42], paint);
    hull.add(kit.box(0.3, 0.16, 0.025, steel, { at: [s * 0.85, HULL.rear - 0.08, 0.95] }));
  }

  // Nariz: ganchos de remolque, faros con protector.
  for (const s of [-1, 1]) {
    D.towHook(kit, hull, [s * 0.68, 3.95, 0.86], paint, 0);
    D.headlight(kit, hull, [s * 1.3, yFender0 + 0.06, HULL.sponsonZ + 0.03], paint);
  }

  // Bloqueo de viaje del tubo, plegado sobre el glacis (posición de tiro).
  {
    const along = new THREE.Vector2(HULL.glacisTop - HULL.nose, HULL.deck - HULL.noseZ).normalize();
    const p0: [number, number] = [4.02, 1.2];
    const p1: [number, number] = [p0[0] + along.x * 0.95, p0[1] + along.y * 0.95];
    for (const s of [-1, 1]) {
      hull.add(rod(kit, [s * 0.26, p0[0], p0[1] + 0.05], [s * 0.2, p1[0], p1[1] + 0.06], 0.035, paint));
      hull.add(kit.box(0.12, 0.12, 0.1, paint, { at: [s * 0.28, p0[0], p0[1] + 0.03], bevel: 0.015 }));
    }
    hull.add(rod(kit, [-0.22, p1[0], p1[1] + 0.07], [0.22, p1[0], p1[1] + 0.07], 0.04, paint));
    hull.add(kit.box(0.34, 0.16, 0.08, paint, { at: [0, p1[0] - 0.05, p1[1] + 0.12], bevel: 0.02 }));
  }

  // Cubierta delantera: escotilla del conductor + periscopios, rejillas del
  // motor (lado derecho), herramientas, salida de escape lateral.
  D.roundHatch(kit, hull, [-0.62, 2.48, HULL.deck], 0.3, paint, 0);
  for (const dx of [-0.22, 0, 0.22]) D.periscope(kit, hull, [-0.62 + dx, 2.86, HULL.deck], paint, -dx * 60, 0.17);
  D.louverPanel(kit, hull, [0.5, 2.35, HULL.deck + 0.012], 0.85, 0.75, 9, paint, { horizontal: true });
  D.panel(kit, hull, [0.5, 1.75, HULL.deck + 0.008], [0.95, 0.45, 0.016], paintSoft);
  D.seamRect(kit, hull, [0.5, 1.75, HULL.deck + 0.016], 0.95, 0.45, 'z', 1);
  D.seamRect(kit, hull, [0.5, 2.35, HULL.deck + 0.004], 1.0, 0.92, 'z', 1);
  D.louverPanel(kit, hull, [HULL.halfUpper + 0.012, 2.75, 1.5], 0.55, 0.26, 4, paint, { yawDeg: -90 });
  hull.add(kit.box(0.02, 0.6, 0.3, kit.polymer(0x17150f), { at: [HULL.halfUpper + 0.005, 2.75, 1.5] }));
  D.pioneerTools(kit, hull, [-1.28, 2.25, HULL.deck], paint);
  D.boltRow(kit, hull, [-0.9, 3.0, HULL.deck + 0.005], [0.9, 3.0, HULL.deck + 0.005], 12, paint, 'z');

  // Asideros y argollas laterales de las barcazas.
  for (const s of [-1, 1]) {
    for (const y of [-2.2, 0.0, 2.0]) {
      D.liftEye(kit, hull, [s * (HULL.halfUpper + 0.01), y, HULL.deck - 0.06], paint, s * -90, 0.04);
    }
    D.grabHandle(kit, hull, [s * HULL.halfUpper, 2.9, 1.42], [s * HULL.halfUpper, 3.25, 1.42], [s, 0, 0], paint, 0.06);
  }

  // Anillo de la torre (faldón oscuro bajo la torre).
  hull.add(kit.cyl(1.18, 1.18, 0.05, kit.steel(PAINT.gunmetal, { roughness: 0.7 }), { axis: 'z', at: [0, 0, HULL.deck + 0.02], segments: 40 }));

  // Tren de rodaje Bradley: 7 ruedas Ø0.61, motriz delantera, sin rodillos
  // de retorno (la cadena descansa sobre las ruedas, como en toda la familia M109).
  const gear = buildRunningGear(kit, {
    tread: 2.67, trackWidth: 0.533, pitch: 0.152, shoeT: 0.034, padT: 0.03, guideGap: 0.085,
    sprocket: { y: 3.42, z: 0.86, r: 0.33, teeth: 11 },
    idler: { y: -2.03, z: 0.56, r: 0.28 },
    roadWheels: { ys: [-1.38, -0.68, 0.02, 0.72, 1.42, 2.12, 2.82], r: 0.305 },
    sag: 0.9, style: 'bradley', paint, hullHalfW: HULL.halfLower,
  });
  hull.add(gear.group);

  // ===========================================================================
  //  TORRE (traverse)
  // ===========================================================================
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  const tz0 = HULL.deck + 0.02, tzRoof = 2.85;
  traverse.add(loft(kit, [
    ring8(-2.45, 1.5, tz0, tzRoof - 0.03, 0.09, 0.03),
    ring8(0.95, 1.55, tz0, tzRoof, 0.09, 0.03),
    ring8(1.55, 1.18, tz0, 2.45, 0.05, 0.03),
  ], paint));
  const sideX = (y: number) => 1.5 + 0.05 * (y + 2.45) / 3.4;

  // Ranura del tubo (frente + chapa inclinada) donde asoma la funda.
  {
    const upAlong = new THREE.Vector3(0, -0.6, 0.4).normalize();
    const n = new THREE.Vector3(0, 0.4, 0.6).normalize();
    traverse.add(kit.box(0.62, 0.012, 0.5, black, { at: [0, 1.556, 2.2] }));
    const c = new THREE.Vector3(0, 1.55, 2.45).addScaledVector(upAlong, 0.24).addScaledVector(n, 0.006);
    const slot = kit.box(0.62, 0.48, 0.012, black, { at: [c.x, c.y, c.z] });
    slot.rotation.x = -Math.atan2(0.4, 0.6);
    traverse.add(slot);
    // Labios de la ranura (marco en U de chapa gruesa) en frente y glacis.
    for (const s of [-1, 1]) {
      traverse.add(kit.box(0.07, 0.06, 0.56, paint, { at: [s * 0.345, 1.575, 2.18], bevel: 0.015 }));
      const lip = kit.box(0.07, 0.5, 0.05, paint, { at: [s * 0.345, c.y, c.z + 0.012], bevel: 0.015 });
      lip.rotation.x = -Math.atan2(0.4, 0.6);
      traverse.add(lip);
    }
    traverse.add(kit.box(0.76, 0.06, 0.07, paint, { at: [0, 1.575, 1.93], bevel: 0.015 }));
    // Costuras de soldadura / juntas de placas en los costados de la torre.
    for (const s of [-1, 1]) {
      traverse.add(kit.box(0.012, 3.3, 0.03, paintSoft, { at: [s * (sideX(-0.8) + 0.004), -0.8, 2.66] }));
      traverse.add(kit.box(0.012, 0.03, 0.85, paintSoft, { at: [s * (sideX(0.55) + 0.004), 0.55, 2.2] }));
    }
  }

  // Puertas laterales grandes (ambos lados) con bisagras y asa.
  for (const s of [-1, 1]) {
    const x = s * (sideX(-0.7) + 0.012);
    traverse.add(kit.box(0.024, 1.0, 0.78, paintSoft, { at: [x, -0.7, 2.24], bevel: 0.008 }));
    D.seamRect(kit, traverse, [x + s * 0.012, -0.7, 2.24], 0.98, 0.76, 'x', s as 1 | -1);
    for (const z of [1.98, 2.5]) traverse.add(kit.cyl(0.028, 0.028, 0.16, paint, { axis: 'z', at: [x + s * 0.02, -1.2, z], segments: 10 }));
    D.grabHandle(kit, traverse, [x, -0.32, 2.3], [x, -0.32, 2.1], [s, 0, 0], steel, 0.05, 0.01);
  }
  // Rejilla lateral izquierda (extracción de gases del cañón) y caja de estiba.
  D.louverPanel(kit, traverse, [-(sideX(0.4) + 0.012), 0.4, 2.35], 0.62, 0.42, 6, paint, { yawDeg: 90 });
  for (const s of [-1, 1]) {
    traverse.add(kit.box(0.3, 1.1, 0.5, paint, { at: [s * (sideX(-1.85) + 0.15), -1.85, 2.08], bevel: 0.03 }));
    traverse.add(kit.box(0.31, 1.0, 0.025, paintSoft, { at: [s * (sideX(-1.85) + 0.15), -1.85, 2.34] }));
    for (const y of [-2.2, -1.5]) traverse.add(kit.box(0.05, 0.05, 0.06, steel, { at: [s * (sideX(-1.85) + 0.31), y, 2.22] }));
  }

  // Cesta/depósito trasero (estiba en la parte de atrás de la torre).
  traverse.add(kit.box(2.6, 0.42, 0.66, paint, { at: [0, -2.66, 2.2], bevel: 0.04 }));
  traverse.add(kit.box(2.5, 0.02, 0.5, paintSoft, { at: [0, -2.875, 2.2] }));
  {
    // Barandilla de la cesta sobre el depósito.
    const y0 = -2.45, y1 = -2.9, z0 = 2.53, z1 = 2.8;
    for (const x of [-1.3, -0.45, 0.45, 1.3]) traverse.add(rod(kit, [x, y1, z0], [x, y1, z1], 0.016, paint));
    traverse.add(rod(kit, [-1.3, y1, z1], [1.3, y1, z1], 0.018, paint));
    for (const s of [-1, 1]) traverse.add(rod(kit, [s * 1.3, y0, z1], [s * 1.3, y1, z1], 0.018, paint));
    // Petates y bidones estibados.
    D.duffel(kit, traverse, [-0.6, -2.67, 2.68], 1.0, 0.14, canvas);
    D.duffel(kit, traverse, [0.45, -2.66, 2.66], 0.8, 0.12, kit.canvas(0x4f5038));
    D.jerrycan(kit, traverse, [1.08, -2.62, 2.53], paint, 90);
    D.jerrycan(kit, traverse, [-1.12, -2.64, 2.53], paint, 90);
  }

  // Techo: cúpula del jefe con M2, escotilla del cargador, visor, GPS,
  // ventilación, antenas, argollas de izado, paneles.
  {
    const cx = 0.74, cy = 0.2;
    traverse.add(latheCrisp(kit, [
      [0, 0], [0.47, 0], [0.47, 0.06], [0.44, 0.17], [0.0, 0.17],
    ], paint, { axis: 'z', segments: 32, at: [cx, cy, tzRoof] }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      D.periscope(kit, traverse, [cx + Math.sin(a) * 0.45, cy + Math.cos(a) * 0.45, tzRoof + 0.06], paint, -a * 180 / Math.PI, 0.14);
    }
    D.roundHatch(kit, traverse, [cx, cy - 0.05, tzRoof + 0.17], 0.31, paint, 180);
    // Afuste de la M2 en el anillo de la cúpula.
    traverse.add(kit.box(0.14, 0.14, 0.1, paint, { at: [cx, cy + 0.42, tzRoof + 0.2], bevel: 0.015 }));
    D.m2Browning(kit, traverse, [cx, cy + 0.42, tzRoof + 0.18], 0, 3);
    D.rectHatch(kit, traverse, [-0.7, 0.05, tzRoof], 0.62, 0.66, paint);
    // Visor panorámico (cabeza blindada) delante del cargador.
    traverse.add(kit.box(0.3, 0.34, 0.28, paint, { at: [-1.05, 0.62, tzRoof + 0.14], bevel: 0.03 }));
    traverse.add(kit.box(0.2, 0.012, 0.11, kit.glass(), { at: [-1.05, 0.795, tzRoof + 0.17] }));
    traverse.add(kit.box(0.34, 0.12, 0.02, paint, { at: [-1.05, 0.78, tzRoof + 0.28] }));
    // GPS / antena de navegación y seta de ventilación NBQ.
    traverse.add(latheCrisp(kit, [[0, 0], [0.1, 0], [0.1, 0.04], [0.07, 0.08], [0, 0.09]], kit.polymer(0x3a3a33), { axis: 'z', segments: 16, at: [-0.35, -1.25, tzRoof - 0.02] }));
    traverse.add(latheCrisp(kit, [[0, 0], [0.07, 0], [0.07, 0.1], [0.16, 0.1], [0.16, 0.15], [0, 0.17]], paint, { axis: 'z', segments: 18, at: [0.3, -0.95, tzRoof - 0.01] }));
    for (const s of [-1, 1]) {
      D.whipAntenna(kit, traverse, [s * 1.18, -2.15, tzRoof - 0.03], 2.7, paint, [-8, s * 4]);
      D.liftEye(kit, traverse, [s * 1.32, 0.78, tzRoof], paint, 0);
      D.liftEye(kit, traverse, [s * 1.28, -2.2, tzRoof - 0.03], paint, 0);
    }
    D.panel(kit, traverse, [0.05, -1.55, tzRoof - 0.015], [1.4, 1.05, 0.02], paintSoft);
    D.boltRow(kit, traverse, [-0.62, -1.02, tzRoof], [0.72, -1.02, tzRoof], 10, paint, 'z');
    D.boltRow(kit, traverse, [-0.62, -2.08, tzRoof - 0.03], [0.72, -2.08, tzRoof - 0.03], 10, paint, 'z');
    // Asideros del techo y laterales.
    for (const s of [-1, 1]) {
      D.grabHandle(kit, traverse, [s * 1.0, -0.7, tzRoof], [s * 1.0, -0.3, tzRoof], [0, 0, 1], paint, 0.06);
    }
  }

  // Lanzagranadas fumígenos en las mejillas frontales.
  for (const s of [-1, 1]) {
    D.smokeLauncher(kit, traverse, [s * 1.37, 1.26, 2.5], s * -58, paint, 4, 30);
  }

  // ===========================================================================
  //  CAÑÓN: elevación (funda, tambor de muñones) + retroceso (tubo M284)
  // ===========================================================================
  const elevation = keep(kit.group({ name: 'elevation', at: [0, TRUNNION.y, TRUNNION.z] }));
  traverse.add(elevation);
  // Funda de lona (fuelle) entre la cuna y el tubo.
  elevation.add(latheCrisp(kit, [
    [0.2, 0.3], [0.27, 0.36], [0.26, 0.47], [0.23, 0.52], [0.24, 0.6], [0.205, 0.66], [0.2, 0.72], [0.18, 0.8], [0.0, 0.8],
  ], canvas, { segments: 24 }));
  // Manguito de la cuna que asoma delante de la funda.
  elevation.add(kit.cyl(0.19, 0.19, 0.2, paint, { at: [0, 0.86, 0], segments: 24 }));

  const recoil = keep(kit.group({ name: 'recoil' }));
  elevation.add(recoil);
  // Tubo escalonado + evacuador de humos (perfil de revolución, material a la izquierda).
  recoil.add(latheCrisp(kit, [
    [0, -0.55], [0.17, -0.55], [0.17, 0.9], [0.158, 1.0], [0.148, 1.5], [0.128, 2.6], [0.121, 3.0],
    [0.152, 3.12], [0.157, 3.2], [0.157, 3.82], [0.152, 3.9], [0.121, 4.02], [0.113, 5.05],
    [0.128, 5.07], [0.128, 5.15], [0.0, 5.15],
  ], paint, { segments: 32 }));
  // Bridas del evacuador.
  for (const y of [3.18, 3.84]) recoil.add(kit.torus(0.158, 0.012, paint, { at: [0, y, 0], segments: 28 }));
  // Culata (bloque de cierre) dentro de la torre.
  recoil.add(kit.box(0.52, 0.5, 0.5, steel, { at: [0, -0.8, 0], bevel: 0.03 }));
  // Freno de boca de doble deflector: tres placas unidas por arriba y abajo.
  {
    const y0 = 5.13, y1 = MUZZLE;
    const L = y1 - y0;
    for (const s of [-1, 1]) {
      recoil.add(kit.box(0.3, L, 0.07, paint, { at: [0, (y0 + y1) / 2, s * 0.14], bevel: 0.03 }));
    }
    for (const [y, t] of [[y0 + 0.045, 0.09], [y0 + L * 0.52, 0.075], [y1 - 0.04, 0.08]] as const) {
      recoil.add(kit.box(0.46, t, 0.34, paint, { at: [0, y, 0], bevel: 0.035 }));
    }
    // Ánima (oscura) vista desde la boca y casquillo interior.
    recoil.add(kit.cyl(0.08, 0.08, L + 0.004, black, { at: [0, (y0 + y1) / 2, 0], segments: 24 }));
    recoil.add(kit.cyl(0.115, 0.115, L - 0.05, paint, { at: [0, (y0 + y1) / 2, 0], segments: 24, open: true }));
  }

  // ===========================================================================
  //  Horneado: una malla por material en cada nodo (pocos draw calls).
  // ===========================================================================
  bakeStatic(kit, recoil);
  bakeStatic(kit, elevation);
  keep(traverse);
  bakeStatic(kit, traverse);
  bakeStatic(kit, root);

  return {
    root, traverse, elevation, recoil,
    muzzleLocal: new THREE.Vector3(0, MUZZLE, 0),
    recoilStrokeM: RECOIL_STROKE,
    footprintM: TRUNNION.y + MUZZLE,
    heightM: 3.3,
  };
};
