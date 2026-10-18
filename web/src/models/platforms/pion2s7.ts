// ============================================================================
//  pion2s7.ts — Cañón autopropulsado 2S7 Pion 203 mm.  [V2 · 3D-TRACKED]
//
//  Referencias públicas (FAS, Wikipedia, armedconflicts): casco 10.5 m,
//  longitud total 13.1 m con el tubo al frente, anchura 3.38 m, altura
//  3.0 m, 46.5 t; chasis propio con componentes T-72/T-80: 7 ruedas de
//  rodaje duales con bandaje de goma por lado, 6 rodillos de retorno que
//  apoyan SOLO la mitad interior de la cadena, motriz delantera, tensora
//  trasera (bajada al suelo para el tiro); cabina blindada delantera (4
//  tripulantes), motor en el centro, montaje abierto del cañón en la popa
//  con gran reja hidráulica trasera. Cañón 2A44 203 mm L/55.3 (tubo de
//  11.2 m) SIN freno de boca ni evacuador; un cilindro de freno/recuperador
//  sobre el tubo y dos debajo; retroceso máximo 1.4 m; elevación 0…60°;
//  traverse ±15° en el montaje; bloqueo de viaje sobre el techo de cabina.
//
//  DECISIÓN DE RIG: el traverse del montaje es solo ±15°: para cualquier
//  azimut el vehículo ENTERO gira (traverse = vehículo completo, hijo de
//  root), como hace la dotación al orientar la pieza; origen = eje del
//  montaje del cañón (popa). Configuración de TIRO: reja bajada, tensoras
//  en el suelo, plataforma de carga desplegada, viseras de cabina abiertas.
// ============================================================================
import * as THREE from 'three';
import { PAINT } from '../kit';
import type { PlatformBuilder, RigAnimState } from '../rig';
import { buildRunningGear } from '../parts/tracks';
import { bakeStatic, chamferRect, extrudeSideExact, keep, latheCrisp, loft, rod } from '../parts/tracked-geo';
import * as D from '../parts/tracked-details';

// --- Cotas (m), origen = eje del montaje del cañón ---------------------------
const HULL = {
  rear: -3.3, front: 7.25, belly: 0.45, halfLower: 1.05, halfUpper: 1.32, fenderZ: 1.28,
  deckEngine: 1.55, deckGun: 1.45, wellZ: 1.1, wellHalf: 0.9, engineY0: 0.9, cabY0: 4.9, cabRoof: 2.2,
};
const TRUNNION = { y: -0.35, z: 2.45 };
/** Cara del cierre (coordenadas del tubo, +Y hacia la boca). */
const BREECH_FACE = -1.05;
/** Boca: 55.3 cal × 203 mm = 11.23 m desde la cara del cierre. */
const MUZZLE = BREECH_FACE + 11.23;
const RECOIL_STROKE = 1.4;
/** Gatos de elevación: base (traverse) y anclaje en la cuna (elevation). */
const JACK = { x: 0.3, baseY: 0.55, baseZ: 1.3, cradleY: 0.9, cradleZ: -0.42 };

export const buildPion2S7: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const root = new THREE.Group();
  root.name = '2s7-pion';

  const paint = kit.paint(PAINT.russianGreen);
  const paintSoft = kit.paint(PAINT.russianGreen, { roughness: 0.84 });
  const steel = kit.steel();
  const black = kit.polymer(0x0b0c0d);
  const grate = kit.steel(0x2f3133, { roughness: 0.7 });

  // Todo el vehículo gira en azimut (ver cabecera).
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);

  // ===========================================================================
  //  CASCO
  // ===========================================================================
  const hull = kit.group({ name: 'hull' });
  traverse.add(hull);
  // Casco inferior: vientre, glacis, cabina (encima), cubierta motor, pozo
  // del cañón (más bajo, para que la culata baje a gran elevación).
  hull.add(extrudeSideExact(kit, [
    [-3.05, HULL.belly], [6.6, HULL.belly], [HULL.front, 1.05], [HULL.front, HULL.fenderZ],
    [HULL.cabY0, HULL.fenderZ], [HULL.cabY0, HULL.deckEngine], [HULL.engineY0, HULL.deckEngine],
    [HULL.engineY0, HULL.wellZ], [HULL.rear, HULL.wellZ], [HULL.rear, 0.75],
  ], HULL.halfLower * 2, paint, { chamfer: 0.025 }));
  // Barcazas laterales (sobre las cadenas, por fuera del pozo).
  for (const s of [-1, 1]) {
    hull.add(extrudeSideExact(kit, [
      [HULL.rear, HULL.fenderZ], [HULL.cabY0, HULL.fenderZ], [HULL.cabY0, HULL.deckEngine],
      [HULL.engineY0, HULL.deckEngine], [HULL.engineY0 - 0.15, HULL.deckGun], [HULL.rear, HULL.deckGun],
    ], HULL.halfUpper - HULL.halfLower + 0.02, paint, { at: [s * (HULL.halfLower + HULL.halfUpper) / 2, 0, 0], chamfer: 0.015 }));
    // Paredes del pozo.
    hull.add(kit.box(0.16, HULL.engineY0 - HULL.rear, HULL.deckGun - HULL.wellZ, paint, {
      at: [s * (HULL.wellHalf + 0.08), (HULL.engineY0 + HULL.rear) / 2, (HULL.deckGun + HULL.wellZ) / 2],
    }));
  }
  // Pared trasera del pozo y piso enrejado.
  hull.add(kit.box(HULL.wellHalf * 2, 0.14, HULL.deckGun - HULL.wellZ, paint, { at: [0, HULL.rear + 0.07, (HULL.deckGun + HULL.wellZ) / 2] }));
  hull.add(kit.box(HULL.wellHalf * 2 - 0.05, 3.0, 0.02, grate, { at: [0, -1.65, HULL.wellZ + 0.01] }));

  // Guardabarros y cajones de estiba laterales (rasgo típico del Pion).
  for (const s of [-1, 1]) {
    const xf = s * (HULL.halfUpper + 0.2);
    hull.add(kit.box(0.42, HULL.cabY0 - HULL.rear, 0.025, paint, { at: [xf, (HULL.cabY0 + HULL.rear) / 2, HULL.fenderZ + 0.012] }));
    hull.add(kit.box(0.42, 0.012, 0.22, kit.rubber(), { at: [xf, HULL.rear - 0.01, HULL.fenderZ - 0.1] }));
    const boxes: Array<[number, number]> = s < 0
      ? [[-3.05, -1.45], [-1.3, 0.7], [0.85, 1.9], [2.7, 4.75]]
      : [[-3.05, -1.45], [-1.3, 0.7], [0.85, 2.75], [2.9, 4.75]];
    for (const [y0, y1] of boxes) {
      const yc = (y0 + y1) / 2, L = y1 - y0;
      const xb = s * (HULL.halfUpper + 0.2);
      hull.add(kit.box(0.37, L, 0.36, paint, { at: [xb, yc, HULL.fenderZ + 0.2], bevel: 0.02 }));
      hull.add(kit.box(0.39, L + 0.02, 0.03, paintSoft, { at: [xb, yc, HULL.fenderZ + 0.385], bevel: 0.008 }));
      for (const t of [-0.3, 0.3]) {
        hull.add(kit.box(0.02, 0.06, 0.08, steel, { at: [xb + s * 0.19, yc + t * L, HULL.fenderZ + 0.32] }));
      }
      hull.add(kit.box(0.012, 0.03, 0.3, paintSoft, { at: [xb + s * 0.186, yc, HULL.fenderZ + 0.2] }));
    }
  }
  // Escape del motor (lado izquierdo, entre cajones) con hollín.
  D.louverPanel(kit, hull, [-(HULL.halfUpper + 0.012), 2.3, 1.42], 0.55, 0.18, 3, paint, { yawDeg: 90 });
  hull.add(kit.box(0.4, 0.75, 0.02, kit.polymer(0x1a1712), { at: [-(HULL.halfUpper + 0.2), 2.3, HULL.fenderZ + 0.03] }));

  // Cubierta del motor: rejillas grandes, escotillas, toma de aire.
  for (const s of [-1, 1]) {
    D.louverPanel(kit, hull, [s * 0.52, 3.1, HULL.deckEngine + 0.012], 0.85, 1.5, 12, paint, { horizontal: true });
  }
  D.rectHatch(kit, hull, [0, 1.6, HULL.deckEngine], 1.2, 0.8, paint);
  D.panel(kit, hull, [0, 4.4, HULL.deckEngine + 0.01], [2.2, 0.6, 0.02], paintSoft);
  hull.add(kit.box(0.5, 0.35, 0.22, paint, { at: [-0.75, 1.45, HULL.deckEngine + 0.11], bevel: 0.03 }));
  D.boltRow(kit, hull, [-1.1, 2.25, HULL.deckEngine + 0.005], [1.1, 2.25, HULL.deckEngine + 0.005], 12, paint, 'z');

  // ---------------------------------------------------------------------------
  //  Cabina blindada delantera
  // ---------------------------------------------------------------------------
  const cab0 = HULL.cabY0, cabF = HULL.front, roof = HULL.cabRoof;
  const slopeTop: [number, number] = [6.85, roof];
  const slopeBot: [number, number] = [cabF, 1.42];
  hull.add(extrudeSideExact(kit, [
    [cab0, HULL.fenderZ], [cabF, HULL.fenderZ], slopeBot, slopeTop, [cab0, roof],
  ], 3.3, paint, { chamfer: 0.04 }));
  {
    const a = new THREE.Vector2(slopeTop[0] - slopeBot[0], slopeTop[1] - slopeBot[1]);
    const ang = Math.atan2(a.y, a.x);
    const nrm = new THREE.Vector2(a.y, -a.x).normalize();
    const at = (t: number, off: number): [number, number] => [slopeBot[0] + a.x * t + nrm.x * off, slopeBot[1] + a.y * t + nrm.y * off];
    for (const x of [-1.05, 0, 1.05]) {
      // Marco (detrás) y cristal (delante) sobre la chapa inclinada.
      const [fy, fz] = at(0.5, 0.004);
      const fr = kit.box(0.84, 0.48, 0.012, paintSoft, { at: [x, fy, fz] });
      fr.rotation.x = ang;
      hull.add(fr);
      const [gy, gz] = at(0.5, 0.014);
      const g = kit.box(0.72, 0.36, 0.01, kit.glass(), { at: [x, gy, gz] });
      g.rotation.x = ang;
      hull.add(g);
      // Visera blindada levantada (bisagra en el borde superior).
      const [hy, hz] = at(0.82, 0.035);
      hull.add(kit.cyl(0.025, 0.025, 0.74, paint, { axis: 'x', at: [x, hy, hz], segments: 10 }));
      const visor = kit.group({ at: [x, hy, hz], rotDeg: [12, 0, 0] });
      visor.add(kit.box(0.82, 0.44, 0.03, paint, { at: [0, 0.22, 0.0], bevel: 0.01 }));
      hull.add(visor);
    }
  }
  // Puertas laterales de la cabina.
  for (const s of [-1, 1]) {
    const x = s * 1.66;
    hull.add(kit.box(0.025, 0.8, 0.75, paintSoft, { at: [x, 5.45, 1.75], bevel: 0.01 }));
    D.seamRect(kit, hull, [x + s * 0.0125, 5.45, 1.75], 0.78, 0.73, 'x', s as 1 | -1);
    hull.add(kit.box(0.02, 0.36, 0.22, kit.glass(), { at: [x + s * 0.008, 5.5, 1.92] }));
    for (const z of [1.5, 1.98]) hull.add(kit.cyl(0.026, 0.026, 0.14, paint, { axis: 'z', at: [x + s * 0.02, 5.08, z], segments: 10 }));
    D.grabHandle(kit, hull, [x, 5.9, 1.6], [x, 5.9, 2.0], [s, 0, 0], steel, 0.05, 0.011);
  }
  // Techo: escotillas, periscopios, foco, antena y bloqueo de viaje plegado.
  D.roundHatch(kit, hull, [-0.75, 5.55, roof], 0.3, paint, 0);
  D.roundHatch(kit, hull, [0.75, 5.55, roof], 0.3, paint, 0);
  for (const s of [-1, 1]) {
    D.periscope(kit, hull, [s * 0.75, 6.05, roof], paint, 0, 0.18);
    D.liftEye(kit, hull, [s * 1.45, 6.4, roof], paint, 0);
    D.liftEye(kit, hull, [s * 1.45, 5.05, roof], paint, 0);
  }
  // Foco (proyector) junto a la escotilla del jefe.
  hull.add(kit.cyl(0.03, 0.03, 0.18, steel, { axis: 'z', at: [1.25, 5.85, roof + 0.09], segments: 8 }));
  hull.add(latheCrisp(kit, [[0, -0.1], [0.11, -0.1], [0.12, 0.06], [0.11, 0.08], [0, 0.08]], paint, { segments: 18, at: [1.25, 5.85, roof + 0.25] }));
  hull.add(kit.cyl(0.1, 0.1, 0.01, kit.glass(), { at: [1.25, 5.94, roof + 0.25], segments: 18 }));
  D.whipAntenna(kit, hull, [-1.35, 5.1, roof], 3.0, paint, [-6, -4]);
  {
    // Bloqueo de viaje: horquilla plegada hacia atrás sobre el techo.
    const y0 = 6.55;
    hull.add(kit.box(0.5, 0.18, 0.1, paint, { at: [0, y0, roof + 0.05], bevel: 0.02 }));
    for (const s of [-1, 1]) hull.add(rod(kit, [s * 0.2, y0, roof + 0.07], [s * 0.18, y0 - 0.9, roof + 0.06], 0.03, paint));
    hull.add(kit.box(0.46, 0.14, 0.08, paint, { at: [0, y0 - 0.95, roof + 0.06], bevel: 0.02 }));
  }
  // Morro: faros redondos con rejilla, ganchos, eslabones de repuesto.
  for (const s of [-1, 1]) {
    const g = kit.group({ at: [s * 1.42, cabF + 0.02, 1.5] });
    g.add(latheCrisp(kit, [[0, -0.06], [0.1, -0.06], [0.11, 0.05], [0.095, 0.07], [0, 0.07]], kit.steel(PAINT.gunmetal, { roughness: 0.6 }), { segments: 16, at: [0, 0.1, 0.08] }));
    g.add(kit.cyl(0.09, 0.09, 0.01, kit.glass(), { at: [0, 0.172, 0.08], segments: 16 }));
    g.add(kit.box(0.04, 0.12, 0.05, paint, { at: [0, 0.03, 0.0] }));
    for (const dz of [0.03, 0.13]) g.add(rod(kit, [-0.12, 0.2, dz], [0.12, 0.2, dz], 0.008, paint));
    hull.add(g);
    D.towHook(kit, hull, [s * 0.75, cabF - 0.05, 0.95], paint, 0);
  }
  // Eslabones de repuesto en el glacis inferior (dos filas).
  for (const x of [-0.62, 0.62]) {
    for (let k = 0; k < 3; k++) {
      const t = 0.25 + k * 0.22;
      const y = 6.6 + (HULL.front - 6.6) * t, z = HULL.belly + (1.05 - HULL.belly) * t;
      hull.add(kit.box(0.56, 0.05, 0.15, grate, { at: [x, y + 0.03, z], rotDeg: [-45, 0, 0], bevel: 0.01 }));
    }
  }

  // ---------------------------------------------------------------------------
  //  Popa: reja hidráulica BAJADA, cilindros, plataforma de carga, pilotos.
  // ---------------------------------------------------------------------------
  hull.add(extrudeSideExact(kit, [
    [-3.32, 1.0], [-3.46, 1.0], [-3.9, 0.35], [-4.14, -0.1], [-3.97, -0.1], [-3.72, 0.3], [-3.32, 0.82],
  ], 2.9, paint, { chamfer: 0.015 }));
  for (const x of [-1.1, -0.38, 0.38, 1.1]) {
    hull.add(extrudeSideExact(kit, [[-3.38, 0.95], [-3.82, 0.35], [-3.72, 0.32], [-3.36, 0.82]], 0.04, paint, { at: [x, 0, 0] }));
  }
  hull.add(kit.cyl(0.07, 0.07, 2.7, steel, { axis: 'x', at: [0, -3.36, 0.93], segments: 14 }));
  for (const s of [-1, 1]) {
    hull.add(rod(kit, [s * 0.95, HULL.rear - 0.05, 1.32], [s * 0.95, -3.6, 0.72], 0.075, paint, 12));
    hull.add(rod(kit, [s * 0.95, -3.55, 0.8], [s * 0.95, -3.78, 0.5], 0.04, kit.steel(0xb8bcc0, { roughness: 0.2 }), 10));
    D.tailLight(kit, hull, [s * 1.45, HULL.rear, 1.3], paint);
  }
  // Plataforma de carga desplegada con barandilla.
  hull.add(kit.box(2.3, 0.7, 0.04, grate, { at: [0, HULL.rear - 0.35, 1.08] }));
  hull.add(kit.box(2.34, 0.06, 0.08, paint, { at: [0, HULL.rear - 0.7, 1.08] }));
  for (const s of [-1, 1]) {
    hull.add(rod(kit, [s * 1.15, HULL.rear - 0.68, 1.1], [s * 1.15, HULL.rear - 0.68, 1.95], 0.02, paint));
    hull.add(rod(kit, [s * 1.15, HULL.rear - 0.68, 1.95], [s * 1.15, HULL.rear - 0.02, 1.95], 0.02, paint));
    hull.add(rod(kit, [s * 1.15, HULL.rear - 0.68, 1.5], [s * 1.15, HULL.rear - 0.02, 1.5], 0.016, paint));
    hull.add(rod(kit, [s * 1.15, HULL.rear - 0.02, 1.95], [s * 1.15, HULL.rear - 0.02, 1.45], 0.02, paint));
  }

  // Tren de rodaje: 7 ruedas Ø0.67 espaciadas, 6 rodillos interiores,
  // motriz delantera y tensora BAJADA (posición de tiro).
  const gear = buildRunningGear(kit, {
    tread: 2.8, trackWidth: 0.58, pitch: 0.16, shoeT: 0.04, padT: 0.03, guideGap: 0.11,
    sprocket: { y: 6.55, z: 0.86, r: 0.33, teeth: 13 },
    idler: { y: -2.85, z: 0.405, r: 0.335 },
    roadWheels: { ys: [5.45, 4.25, 3.05, 1.85, 0.65, -0.55, -1.75], r: 0.335 },
    returnRollers: { ys: [4.85, 3.65, 2.45, 1.25, 0.05, -1.15], r: 0.12, inner: true },
    sag: 0.04, style: 'soviet', paint, hullHalfW: HULL.halfLower,
  });
  hull.add(gear.group);

  // ===========================================================================
  //  MONTAJE DEL CAÑÓN (estático respecto al casco)
  // ===========================================================================
  const mount = kit.group({ name: 'mount' });
  traverse.add(mount);
  for (const s of [-1, 1]) {
    const x = s * 0.65;
    // Flancos del afuste superior.
    mount.add(extrudeSideExact(kit, [
      [-1.2, HULL.wellZ], [0.9, HULL.wellZ], [0.9, 1.45], [0.25, 2.55], [-0.1, 2.8], [-0.62, 2.8], [-0.95, 2.5], [-1.2, 1.8],
    ], 0.12, paint, { at: [x, 0, 0], chamfer: 0.02 }));
    // Cubo del muñón y cojinete.
    const boss: Array<[number, number]> = [[0, -0.1], [0.23, -0.1], [0.23, 0.1], [0.16, 0.14], [0, 0.14]];
    mount.add(latheCrisp(kit, s > 0 ? boss : boss.map(([r, a]) => [r, -a] as [number, number]).reverse(), paint, {
      axis: 'x', segments: 24, at: [x + s * 0.06, TRUNNION.y, TRUNNION.z],
    }));
    // Nervios de refuerzo de los flancos.
    mount.add(kit.box(0.05, 0.08, 1.0, paint, { at: [x + s * 0.08, 0.2, 1.75], rotDeg: [-28, 0, 0] }));
    mount.add(kit.box(0.05, 0.08, 0.9, paint, { at: [x + s * 0.08, -0.85, 1.85], rotDeg: [25, 0, 0] }));
  }
  // Travesaño delantero del afuste con orejetas de los gatos.
  mount.add(kit.box(1.5, 0.3, 0.35, paint, { at: [0, 0.75, HULL.wellZ + 0.175], bevel: 0.03 }));
  for (const s of [-1, 1]) mount.add(kit.box(0.12, 0.14, 0.16, paint, { at: [s * JACK.x, JACK.baseY + 0.03, JACK.baseZ], bevel: 0.015 }));
  // Puesto del apuntador (izquierda): asiento, volantes, visor, escudo.
  mount.add(kit.box(0.4, 0.4, 0.08, kit.canvas(0x3e3d2c), { at: [-1.0, -0.4, 1.86], bevel: 0.03 }));
  mount.add(kit.cyl(0.04, 0.04, 0.4, steel, { axis: 'z', at: [-1.0, -0.4, 1.65], segments: 8 }));
  mount.add(kit.box(0.08, 0.45, 0.62, paint, { at: [-0.92, -0.05, 2.15], bevel: 0.02 }));
  mount.add(kit.torus(0.13, 0.015, steel, { axis: 'x', at: [-1.0, 0.1, 2.0], segments: 18 }));
  mount.add(kit.torus(0.11, 0.015, steel, { axis: 'x', at: [-1.0, -0.15, 2.25], segments: 18 }));
  mount.add(kit.box(0.14, 0.24, 0.2, paint, { at: [-0.92, 0.12, 2.58], bevel: 0.02 }));
  mount.add(kit.box(0.1, 0.012, 0.08, kit.glass(), { at: [-0.92, 0.245, 2.6] }));
  mount.add(kit.box(0.02, 0.9, 0.7, paint, { at: [-1.25, 0.05, 2.25], bevel: 0.008 }));
  // Mecanismo de carga (derecha): grúa y bandeja de atacado + dos proyectiles.
  mount.add(kit.box(0.14, 0.14, 0.9, paint, { at: [1.0, -1.15, 1.9], bevel: 0.02 }));
  mount.add(kit.box(0.14, 1.0, 0.14, paint, { at: [1.0, -1.6, 2.35], bevel: 0.02 }));
  {
    const tray = kit.group({ at: [0.85, -1.9, 2.3] });
    tray.add(kit.box(0.42, 1.3, 0.03, steel, { at: [0, 0, -0.12] }));
    for (const s of [-1, 1]) tray.add(kit.box(0.03, 1.3, 0.15, steel, { at: [s * 0.21, 0, -0.06] }));
    mount.add(tray);
    const shellMat = kit.paint(0x6d6a3e, { roughness: 0.6 });
    for (const [x, z] of [[1.15, HULL.fenderZ + 0.46], [1.15, HULL.fenderZ + 0.68]] as const) {
      mount.add(latheCrisp(kit, [
        [0, -0.5], [0.1, -0.5], [0.1, -0.42], [0.103, -0.4], [0.103, 0.1], [0.08, 0.32], [0.03, 0.47], [0, 0.5],
      ], shellMat, { segments: 16, at: [x + 0.12, -2.3, z] }));
    }
    mount.add(kit.box(0.08, 1.2, 0.08, paint, { at: [1.27, -2.3, HULL.fenderZ + 0.36] }));
  }

  // Gatos hidráulicos de elevación (se orientan en animate()).
  const jacks: Array<{ g: THREE.Group; rodG: THREE.Group }> = [];
  for (const s of [-1, 1]) {
    const g = keep(kit.group({ name: `jack-${s}`, at: [s * JACK.x, JACK.baseY, JACK.baseZ] }));
    g.add(kit.cyl(0.085, 0.085, 0.7, paint, { at: [0, 0.35, 0], segments: 14 }));
    g.add(kit.cyl(0.095, 0.095, 0.06, paint, { at: [0, 0.68, 0], segments: 14 }));
    g.add(kit.cyl(0.06, 0.06, 0.16, steel, { axis: 'x', at: [0, 0, 0], segments: 12 }));
    const rodG = kit.group({ name: `jack-rod-${s}` });
    rodG.add(kit.cyl(0.045, 0.045, 1.05, kit.steel(0xb8bcc0, { roughness: 0.2 }), { at: [0, -0.525, 0], segments: 10 }));
    rodG.add(kit.cyl(0.06, 0.06, 0.16, steel, { axis: 'x', at: [0, 0, 0], segments: 12 }));
    g.add(rodG);
    mount.add(g);
    jacks.push({ g, rodG });
  }

  // ===========================================================================
  //  CUNA (elevation) y TUBO 2A44 (recoil)
  // ===========================================================================
  const elevation = keep(kit.group({ name: 'elevation', at: [0, TRUNNION.y, TRUNNION.z] }));
  traverse.add(elevation);
  // Manguito de la cuna (sección achaflanada).
  elevation.add(loft(kit, [
    chamferRect(0, -0.95, 0, 0.84, 0.72, 0.12),
    chamferRect(0, 2.3, 0, 0.84, 0.72, 0.12),
    chamferRect(0, 2.6, 0, 0.7, 0.6, 0.12),
  ], paint));
  // Muñones.
  for (const s of [-1, 1]) elevation.add(kit.cyl(0.12, 0.12, 0.2, steel, { axis: 'x', at: [s * 0.52, 0, 0], segments: 16 }));
  // Cilindros de freno/recuperador: uno encima, dos debajo.
  const cyl = (x: number, z: number, r: number, y0: number, y1: number) => {
    elevation.add(latheCrisp(kit, [
      [0, y0], [r * 0.9, y0], [r, y0 + 0.04], [r, y1 - 0.06], [r * 1.08, y1 - 0.05], [r * 1.08, y1], [0, y1],
    ], paint, { segments: 20, at: [x, 0, z] }));
    for (const y of [y0 + 0.6, y1 - 0.7]) elevation.add(kit.box(Math.abs(x) > 0 ? 0.12 : 0.18, 0.12, Math.abs(z) - r * 0.6, paint, { at: [x * 0.6, y, z * 0.55] }));
  };
  cyl(0, 0.5, 0.135, -0.75, 2.95);
  cyl(-0.26, -0.47, 0.118, -0.7, 2.75);
  cyl(0.26, -0.47, 0.118, -0.7, 2.75);
  // Anclajes inferiores de los gatos.
  for (const s of [-1, 1]) elevation.add(kit.box(0.12, 0.2, 0.18, paint, { at: [s * JACK.x, JACK.cradleY, JACK.cradleZ + 0.06], bevel: 0.015 }));
  // Visor del apuntador ligado a la cuna (lado izquierdo).
  elevation.add(kit.box(0.12, 0.3, 0.1, paint, { at: [-0.5, 0.35, 0.3], bevel: 0.02 }));

  const recoil = keep(kit.group({ name: 'recoil' }));
  elevation.add(recoil);
  recoil.add(latheCrisp(kit, [
    [0, BREECH_FACE], [0.27, BREECH_FACE], [0.27, 2.0], [0.255, 2.15], [0.212, 2.9], [0.2, 3.3],
    [0.165, 8.6], [0.158, 9.62], [0.168, 9.7], [0.168, MUZZLE - 0.06], [0.16, MUZZLE],
    [0.1015, MUZZLE], [0.1015, MUZZLE - 0.3], [0, MUZZLE - 0.3],
  ], paint, { segments: 32 }));
  recoil.add(kit.cyl(0.1, 0.1, 0.01, black, { at: [0, MUZZLE - 0.29, 0], segments: 20 }));
  // Bloque de cierre (tornillo) y anillo de culata con orejetas.
  recoil.add(kit.box(0.74, 0.42, 0.74, paint, { at: [0, BREECH_FACE - 0.21, 0], bevel: 0.04 }));
  recoil.add(latheCrisp(kit, [[0, -0.06], [0.22, -0.06], [0.24, 0.0], [0.24, 0.05], [0, 0.05]], steel, { segments: 20, at: [0, BREECH_FACE - 0.47, 0] }));
  recoil.add(kit.box(0.08, 0.12, 0.3, steel, { at: [0.3, BREECH_FACE - 0.48, 0] }));
  // Vástagos del freno/recuperador (salen hacia atrás al retroceder).
  for (const [x, z, r] of [[0, 0.5, 0.06], [-0.26, -0.47, 0.055], [0.26, -0.47, 0.055]] as const) {
    recoil.add(kit.cyl(r, r, 2.0, kit.steel(0xb8bcc0, { roughness: 0.2 }), { at: [x, BREECH_FACE + 0.45, z], segments: 12 }));
    recoil.add(kit.box(0.14, 0.1, 0.14, steel, { at: [x, BREECH_FACE - 0.3, z * 0.85], bevel: 0.02 }));
  }

  // ===========================================================================
  //  Animación: gatos de elevación entre afuste y cuna.
  // ===========================================================================
  const tmp = new THREE.Vector3();
  const animate = (state: RigAnimState): void => {
    const el = state.elevationDeg * Math.PI / 180;
    const cy = TRUNNION.y + JACK.cradleY * Math.cos(el) - JACK.cradleZ * Math.sin(el);
    const cz = TRUNNION.z + JACK.cradleY * Math.sin(el) + JACK.cradleZ * Math.cos(el);
    for (const { g, rodG } of jacks) {
      tmp.set(0, cy - g.position.y, cz - g.position.z);
      g.rotation.set(Math.atan2(tmp.z, tmp.y), 0, 0);
      rodG.position.set(0, tmp.length(), 0);
    }
  };
  animate({ t: 0, dt: 0, azimuthDeg: 0, elevationDeg: 0, recoil01: 0, sinceFireS: Infinity });

  bakeStatic(kit, recoil);
  bakeStatic(kit, elevation);
  bakeStatic(kit, mount);
  bakeStatic(kit, hull);

  return {
    root, traverse, elevation, recoil,
    muzzleLocal: new THREE.Vector3(0, MUZZLE, 0),
    recoilStrokeM: RECOIL_STROKE,
    footprintM: TRUNNION.y + MUZZLE,
    heightM: 3.0,
    extraAnimated: jacks.flatMap(({ g, rodG }) => [g, rodG]),
    animate,
  };
};
