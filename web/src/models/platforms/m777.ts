// ============================================================================
//  m777.ts — Obús remolcado M777A2 155 mm L39 (BAE Systems), en posición de
//  fuego.  DUEÑO: agente 3D-CORE (ver docs/PLAN_V2.md).
//
//  Medidas de referencia (publicadas): longitud en batería 10.7 m (boca a
//  rejas), anchura en batería ~4.3 m, altura en batería ~1.4 m (eje del
//  ánima ~1.22 m), tubo M776 L39 de 6.045 m con freno de boca de doble
//  deflector, elevación −3°…+71.7°, dirección ±23° (±400 mil) sobre el
//  afuste inferior, ruedas Ø ~0.95 m levantadas en batería, peso 4.2 t.
//
//  Conjuntos modelados:
//    * afuste inferior (cuerpo de titanio en U con la plataforma de tiro
//      circular delantera, dos estabilizadores delanteros con zapatas, dos
//      mazas abiertas con rejas autoexcavables y amortiguadores, ruedas con
//      suspensión hidroneumática levantadas, bomba manual, caja PDU y
//      baterías del DFCS);
//    * afuste superior (silla: aro de giro, gualderas con muñoneras,
//      volantes de dirección y elevación, pantallas del apuntador y del
//      ayudante, dos equilibradores neumáticos articulados);
//    * masa elevable (cuna de cuatro tubos de titanio con yugos delantero y
//      trasero, dos cilindros de freno/recuperador, acumulador, unidad
//      inercial INU con antena GPS, alza panorámica y anteojo de tiro
//      directo, sector dentado de elevación);
//    * masa que retrocede (tubo M776 con zuncho y rosca, freno de boca de
//      doble deflector con ventanas, argolla de remolque abatida, anillo de
//      cierre con cierre de tornillo, palanca, mecanismo de alimentación de
//      estopines y vástagos del freno).
//
//  RIG (contrato rig.ts): `traverse` = el arma entera (remolcada: sin
//  torreta) y DENTRO un nodo `lowerCarriage` (extraAnimated) contra-girado
//  por `animate`: el afuste inferior se queda en su azimut de asentamiento
//  y la silla dirige ±23° sobre él como el real; si la puntería se sale de
//  ese margen, el afuste "se arrastra" (los sirvientes moverían las mazas)
//  quedando siempre en el tope de ±23°.
// ============================================================================
import * as THREE from 'three';
import { HydraulicRam, PAINT, type ModelKit, type V3 } from '../kit';
import { DEG, type PlatformBuilder } from '../rig';

/** Eje de muñones (espacio traverse): detrás del centro de giro y bajo. */
const TRUNNION: V3 = [0, -0.75, 1.22];
/** Margen de dirección de la silla sobre el afuste inferior (grados). */
const TRAVERSE_LIMIT = 23;
/** Longitud de la masa que retrocede delante de los muñones (boca). */
const MUZZLE_Y = 5.095;
/** Cara trasera del anillo de cierre (detrás de los muñones). */
const BREECH_Y = -0.95;

export const buildM777: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const root = new THREE.Group();
  root.name = 'm777';

  const green = kit.paint(PAINT.carcGreen, { wear: 0.55 });
  const greenWorn = kit.paint(PAINT.carcGreen, { wear: 0.85 });
  const greenTube = kit.paint(0x495120, { wear: 0.45, roughness: 0.7 });
  const steel = kit.steel(PAINT.darkSteel);
  const darkSteel = kit.steel(0x26282a, { roughness: 0.5 });
  const black = kit.polymer(0x1c1d1b);
  const rubberBlack = kit.rubber();

  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);
  const lower = kit.group({ name: 'lowerCarriage' });
  traverse.add(lower);

  buildLowerCarriage(kit, lower, { green, greenWorn, steel, darkSteel, black, rubberBlack });
  const upper = kit.group({ name: 'upperCarriage' });
  traverse.add(upper);
  buildSaddle(kit, upper, { green, steel, darkSteel, black });

  // -- Masa elevable --------------------------------------------------------
  const elevation = kit.group({ name: 'elevation', at: TRUNNION });
  traverse.add(elevation);
  buildCradle(kit, elevation, { green, steel, darkSteel, black });

  const recoil = kit.group({ name: 'recoil' });
  elevation.add(recoil);
  buildTube(kit, recoil, { green: greenTube, steel, darkSteel, black });

  // -- Equilibradores neumáticos (silla ↔ cuna), articulados ----------------
  const eqRams: Array<{ ram: HydraulicRam; s: THREE.Vector3; c: THREE.Vector3 }> = [];
  for (const sx of [-1, 1]) {
    const ram = new HydraulicRam(kit, 0.068, 0.034, green, { bodyLen: 0.78, rodLen: 0.86 });
    ram.root.name = `equilibrator_${sx < 0 ? 'L' : 'R'}`;
    ram.rod.name = `equilibratorRod_${sx < 0 ? 'L' : 'R'}`;
    upper.add(ram.root);
    eqRams.push({
      ram,
      s: new THREE.Vector3(sx * 0.5, 0.6, 0.72),
      c: new THREE.Vector3(sx * 0.5, 0.65, -0.02), // en el espacio de la cuna
    });
  }

  // -- Animación: afuste inferior asentado + equilibradores -----------------
  let layAz: number | null = null;
  const tmp = new THREE.Vector3();
  const trunnion = new THREE.Vector3(...TRUNNION);
  const updateEquilibrators = (elDeg: number) => {
    const el = elDeg * DEG, c = Math.cos(el), s = Math.sin(el);
    for (const e of eqRams) {
      tmp.set(e.c.x, e.c.y * c - e.c.z * s, e.c.y * s + e.c.z * c).add(trunnion);
      e.ram.update(e.s, tmp);
    }
  };
  updateEquilibrators(0);

  return {
    root, traverse, elevation, recoil,
    muzzleLocal: new THREE.Vector3(0, MUZZLE_Y, 0),
    recoilStrokeM: 1.4,
    footprintM: 6.4,
    heightM: 1.55,
    extraAnimated: [lower, ...eqRams.flatMap((e) => [e.ram.root, e.ram.rod])],
    animate(st) {
      if (layAz === null) layAz = st.azimuthDeg;
      const d = wrap180(st.azimuthDeg - layAz);
      if (d > TRAVERSE_LIMIT) layAz = st.azimuthDeg - TRAVERSE_LIMIT;
      else if (d < -TRAVERSE_LIMIT) layAz = st.azimuthDeg + TRAVERSE_LIMIT;
      layAz = ((layAz % 360) + 360) % 360;
      // traverse gira −az; el afuste inferior deshace la diferencia.
      lower.rotation.z = wrap180(st.azimuthDeg - layAz) * DEG;
      updateEquilibrators(st.elevationDeg);
    },
  };
};

function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

interface Mats {
  green: THREE.Material;
  greenWorn?: THREE.Material;
  steel: THREE.Material;
  darkSteel: THREE.Material;
  black: THREE.Material;
  rubberBlack?: THREE.Material;
}

// ===========================================================================
//  Afuste inferior
// ===========================================================================
function buildLowerCarriage(kit: ModelKit, g: THREE.Group, m: Mats): void {
  const { green, darkSteel, black } = m;
  const worn = m.greenWorn ?? green;

  // Cuerpo delantero (planta achaflanada) — cajón soldado de titanio.
  g.add(kit.extrudePlan([
    [-0.5, -0.45], [0.5, -0.45], [0.5, 1.05], [0.32, 1.5], [-0.32, 1.5], [-0.5, 1.05],
  ], 0.42, green, { at: [0, 0, 0.22], bevel: 0.03 }));
  // Largueros laterales de la U (el anillo de cierre baja entre ellos a QE alta).
  for (const sx of [-1, 1]) {
    g.add(kit.extrudeSide([
      [-0.45, 0.66], [-1.62, 0.6], [-1.62, 0.28], [-0.45, 0.22],
    ], 0.2, green, { at: [sx * 0.39, 0, 0], bevel: 0.025 }));
    // Nervio superior y tapa de inspección.
    g.add(kit.box(0.22, 1.05, 0.03, worn, { at: [sx * 0.39, -1.0, 0.655], bevel: 0.008 }));
    g.add(kit.boltRow([sx * 0.33, -0.55, 0.675], [sx * 0.33, -1.5, 0.66], 8, 0.012, darkSteel));
    g.add(kit.boltRow([sx * 0.45, -0.55, 0.675], [sx * 0.45, -1.5, 0.66], 8, 0.012, darkSteel));
  }
  // Travesaño trasero bajo (deja libre el paso de la culata por arriba).
  g.add(kit.box(0.6, 0.18, 0.16, green, { at: [0, -1.5, 0.3], bevel: 0.02 }));

  // Aro de giro de la silla.
  g.add(kit.cyl(0.4, 0.4, 0.05, darkSteel, { axis: 'z', at: [0, 0, 0.655], segments: 40 }));
  g.add(kit.boltRow([-0.43, 0.08, 0.66], [0.43, 0.08, 0.66], 2, 0.014, darkSteel));

  // Plataforma de tiro circular (apoyo principal en batería) bajo el frente.
  const baseG = kit.group({ at: [0, 0.55, 0] });
  g.add(baseG);
  baseG.add(kit.lathe([[0, 0], [0.55, 0], [0.58, 0.03], [0.56, 0.08], [0.2, 0.12], [0, 0.12]], green, {
    axis: 'z', segments: 40,
  }));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    baseG.add(kit.box(0.04, 0.34, 0.07, green, {
      at: [Math.sin(a) * 0.36, Math.cos(a) * 0.36, 0.1], rotDeg: [0, 0, -a / DEG],
    }));
  }
  baseG.add(kit.cyl(0.16, 0.2, 0.14, darkSteel, { axis: 'z', at: [0, 0, 0.18], segments: 20 }));

  // Estabilizadores delanteros: brazo en cajón, gato vertical y zapata.
  for (const sx of [-1, 1]) {
    const arm = kit.group({ at: [sx * 0.42, 1.25, 0.42], rotDeg: [0, 0, -sx * 38] });
    g.add(arm);
    arm.add(kit.extrudeSide([[0, 0.08], [1.12, 0.05], [1.12, -0.07], [0, -0.1]], 0.14, green, {
      at: [0, 0, 0], bevel: 0.015,
    }));
    arm.add(kit.cyl(0.05, 0.05, 0.22, darkSteel, { axis: 'z', at: [0, 0.02, 0], segments: 14 })); // bisagra
    arm.add(kit.cyl(0.075, 0.075, 0.34, green, { axis: 'z', at: [0, 1.12, -0.08], segments: 16 }));
    arm.add(kit.cyl(0.05, 0.05, 0.22, kit.chrome(), { axis: 'z', at: [0, 1.12, -0.3], segments: 12 }));
    arm.add(kit.lathe([[0, 0], [0.22, 0], [0.22, 0.03], [0.08, 0.07], [0, 0.07]], worn, {
      axis: 'z', at: [0, 1.12, -0.42], segments: 28,
    }));
    arm.add(kit.handle(0.18, 0.06, 0.012, darkSteel, { at: [0, 0.6, 0.08] }));
  }

  // Mazas (split trails) con rejas, amortiguadores y asas.
  const spread = 17;
  for (const sx of [-1, 1]) {
    // Bisagra (pivote vertical) en la esquina trasera del cuerpo.
    g.add(kit.cyl(0.07, 0.07, 0.42, darkSteel, { axis: 'z', at: [sx * 0.4, -1.55, 0.45], segments: 16 }));
    const trail = kit.group({ at: [sx * 0.4, -1.58, 0.45], rotDeg: [1.6, 0, sx * spread] });
    trail.name = `trail_${sx < 0 ? 'L' : 'R'}`;
    g.add(trail);
    const L = 4.55;
    // Cajón de sección decreciente (alto 0.32 → 0.2).
    trail.add(kit.extrudeSide([[0, 0.17], [-L, 0.1], [-L, -0.1], [0, -0.16]], 0.23, worn, { bevel: 0.02 }));
    // Nervios laterales y tapas de aligeramiento.
    for (const y of [-0.9, -1.9, -2.9, -3.8]) {
      trail.add(kit.box(0.25, 0.05, 0.02, worn, { at: [0, y, 0.15 + y * 0.015], bevel: 0.006 }));
      trail.add(kit.cyl(0.05, 0.05, 0.012, darkSteel, { axis: 'x', at: [sx * 0.118, y + 0.4, 0.0], segments: 12 }));
    }
    trail.add(kit.boltRow([sx * 0.1, -0.2, 0.165], [sx * 0.1, -L + 0.2, 0.1], 14, 0.01, darkSteel));
    // Asas de transporte (palancas de mano).
    for (const y of [-1.4, -3.3]) {
      trail.add(kit.handle(0.22, 0.07, 0.014, darkSteel, { at: [0, y, 0.15 + y * 0.015], rotDeg: [0, 0, 90] }));
    }
    trail.add(kit.stencil('NO STEP', 0.06, { at: [sx * 0.118, -2.4, 0.02], rotDeg: [0, 0, sx * 90] }));
    // Remate y reja autoexcavable (inclinada, clavada en el suelo).
    const spadeG = kit.group({ at: [0, -L, 0] });
    trail.add(spadeG);
    spadeG.add(kit.box(0.27, 0.18, 0.24, worn, { at: [0, -0.06, 0], bevel: 0.02 }));
    // Hacia abajo y atrás (≈62° con el suelo): el retroceso la clava más.
    const spade = kit.group({ at: [0, -0.16, -0.1], rotDeg: [-118, 0, 0] });
    spadeG.add(spade);
    spade.add(kit.extrudeSide([[0, 0.012], [0.62, 0.012], [0.7, -0.012], [0, -0.012]], 0.64, worn, {
      at: [0, 0, 0], rotDeg: [0, 0, 0],
    }));
    for (const x of [-0.24, 0, 0.24]) spade.add(kit.box(0.025, 0.55, 0.07, worn, { at: [x, 0.3, 0.035] }));
    spade.add(kit.box(0.64, 0.04, 0.06, worn, { at: [0, 0.02, 0.03] }));
    // Amortiguador de la reja.
    spadeG.add(kit.hydraulic([0, 0.2, 0.12], [0, -0.24, -0.22], 0.035, green, { bodyFrac: 0.55 }));
    // Asa del extremo de maza.
    spadeG.add(kit.handle(0.24, 0.12, 0.016, darkSteel, { at: [0, -0.1, 0.12], rotDeg: [-90, 0, 0] }));
  }
  // Soporte del bloqueo de viaje del tubo sobre la maza izquierda.
  const lock = kit.group({ at: [-0.9, -3.4, 0.62], rotDeg: [0, 0, 17] });
  g.add(lock);
  lock.add(kit.box(0.08, 0.1, 0.3, green, { at: [-0.13, 0, 0], bevel: 0.01 }));
  lock.add(kit.box(0.08, 0.1, 0.3, green, { at: [0.13, 0, 0], bevel: 0.01 }));
  lock.add(kit.box(0.34, 0.1, 0.05, green, { at: [0, 0, -0.14], bevel: 0.01 }));

  // Ruedas levantadas (posición de fuego) con brazo y suspensión hidroneumática.
  for (const sx of [-1, 1] as const) {
    const wheel = kit.wheel(0.475, 0.31, { at: [sx * 1.02, -1.02, 0.6], side: sx, rimColor: PAINT.carcGreen });
    g.add(wheel);
    // Brazo oscilante desde el larguero hasta la mangueta.
    g.add(kit.box(0.34, 0.16, 0.14, green, { at: [sx * 0.66, -1.02, 0.52], bevel: 0.03 }));
    g.add(kit.cyl(0.07, 0.07, 0.2, darkSteel, { axis: 'x', at: [sx * 0.8, -1.02, 0.6], segments: 16 }));
    g.add(kit.hydraulic([sx * 0.52, -0.55, 0.62], [sx * 0.72, -0.95, 0.66], 0.05, green, { bodyFrac: 0.6 }));
    // Bomba manual de elevación de ruedas.
    g.add(kit.box(0.12, 0.16, 0.14, green, { at: [sx * 0.55, -0.62, 0.42], bevel: 0.02 }));
    g.add(kit.cyl(0.012, 0.012, 0.3, darkSteel, {
      at: [sx * 0.55, -0.48, 0.55], rotDeg: [50, 0, 0], segments: 8,
    }));
    // Guardabarros ligero.
    g.add(kit.extrudeSide(arcProfile(0.56, 0.6, 30, 150), 0.34, green, { at: [sx * 1.02, -1.02, 0.6] }));
  }

  // DFCS: unidad de distribución de potencia (PDU) y baterías en el frente.
  const pdu = kit.group({ at: [0.28, 0.95, 0.66] });
  g.add(pdu);
  pdu.add(kit.box(0.3, 0.34, 0.2, green, { at: [0, 0, 0.1], bevel: 0.02 }));
  pdu.add(kit.box(0.26, 0.02, 0.12, black, { at: [0, -0.175, 0.11], bevel: 0.005 }));
  for (const x of [-0.08, 0, 0.08]) pdu.add(kit.cyl(0.018, 0.018, 0.03, black, { at: [x, -0.19, 0.08], segments: 10 }));
  pdu.add(kit.stencil('PDU', 0.05, { at: [0, -0.187, 0.16] }));
  const batt = kit.group({ at: [-0.28, 0.95, 0.66] });
  g.add(batt);
  batt.add(kit.box(0.3, 0.38, 0.22, kit.paint(0x3d4320, { wear: 0.6 }), { at: [0, 0, 0.11], bevel: 0.015 }));
  batt.add(kit.handle(0.16, 0.05, 0.01, darkSteel, { at: [0, 0, 0.22] }));
  batt.add(kit.stencil('BATT 24V', 0.04, { at: [0, -0.193, 0.14] }));
  // Cableado blindado del DFCS por el cuerpo.
  g.add(kit.tube([[0.28, 0.78, 0.74], [0.25, 0.45, 0.72], [0.36, 0.2, 0.75], [0.42, -0.2, 0.8]], 0.015, black));
  g.add(kit.tube([[-0.28, 0.76, 0.74], [-0.2, 0.5, 0.7], [0.18, 0.62, 0.72]], 0.013, black));

  // Gancho/argolla de izado y número táctico genérico.
  g.add(kit.torus(0.06, 0.014, darkSteel, { axis: 'x', at: [0, 1.45, 0.66] }));
  g.add(kit.stencil('B-12', 0.08, { at: [0, 1.505, 0.42], rotDeg: [0, 0, 180] }));
}

/** Perfil (y, z) de un arco (guardabarros), radios r0..r1, ángulos en grados. */
function arcProfile(r0: number, r1: number, a0: number, a1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * (i / n)) * DEG;
    pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
  }
  for (let i = n; i >= 0; i--) {
    const a = (a0 + (a1 - a0) * (i / n)) * DEG;
    pts.push([Math.cos(a) * r0, Math.sin(a) * r0]);
  }
  return pts;
}

// ===========================================================================
//  Afuste superior (silla)
// ===========================================================================
function buildSaddle(kit: ModelKit, g: THREE.Group, m: Mats): void {
  const { green, steel, darkSteel, black } = m;
  const [, ty, tz] = TRUNNION;
  // Plato giratorio.
  g.add(kit.cyl(0.42, 0.42, 0.07, green, { axis: 'z', at: [0, 0, 0.715], segments: 40 }));
  g.add(kit.torus(0.42, 0.012, darkSteel, { axis: 'z', at: [0, 0, 0.75], segments: 40 }));
  // Gualderas: chapa lateral que sube hacia atrás hasta las muñoneras.
  for (const sx of [-1, 1]) {
    g.add(kit.extrudeSide([
      [0.42, 0.74], [0.3, 0.92], [ty + 0.32, tz - 0.06], [ty + 0.12, tz + 0.12], [ty - 0.16, tz + 0.1],
      [ty - 0.26, tz - 0.12], [ty - 0.1, 0.74],
    ], 0.06, green, { at: [sx * 0.41, 0, 0], bevel: 0.012 }));
    // Muñonera.
    g.add(kit.cyl(0.15, 0.15, 0.12, green, { axis: 'x', at: [sx * 0.44, ty, tz], segments: 28 }));
    g.add(kit.cyl(0.09, 0.09, 0.03, darkSteel, { axis: 'x', at: [sx * 0.515, ty, tz], segments: 20 }));
    g.add(kit.boltRow([sx * 0.52, ty + 0.11, tz], [sx * 0.52, ty - 0.11, tz], 2, 0.014, darkSteel, { normal: 'x' }));
    // Refuerzo diagonal.
    g.add(kit.box(0.05, 0.6, 0.1, green, { at: [sx * 0.46, -0.2, 0.92], rotDeg: [-38, 0, 0], bevel: 0.012 }));
    // Latiguillo hidráulico por la gualdera.
    g.add(kit.tube([[sx * 0.45, 0.25, 0.76], [sx * 0.47, -0.1, 0.95], [sx * 0.46, ty + 0.1, tz - 0.12]], 0.011, black));
  }
  // Travesaños entre gualderas (por debajo del paso de la cuna).
  g.add(kit.box(0.78, 0.14, 0.12, green, { at: [0, 0.22, 0.83], bevel: 0.02 }));
  g.add(kit.box(0.78, 0.1, 0.1, green, { at: [0, -0.3, 0.78], bevel: 0.02 }));
  // Piñón de elevación (engrana con el sector de la cuna) — lado derecho.
  g.add(kit.cyl(0.05, 0.05, 0.06, darkSteel, { axis: 'x', at: [0.33, ty - 0.05, tz - 0.43], segments: 14 }));
  g.add(kit.box(0.07, 0.16, 0.12, green, { at: [0.35, ty - 0.05, tz - 0.5], bevel: 0.012 }));

  // Volantes: dirección (izquierda, apuntador) y elevación (derecha).
  for (const sx of [-1, 1]) {
    const hw = kit.group({ at: [sx * 0.66, 0.42, 0.98] });
    g.add(hw);
    hw.add(kit.box(0.16, 0.2, 0.22, green, { at: [-sx * 0.12, 0, -0.04], bevel: 0.025 })); // caja reductora
    hw.add(kit.cyl(0.02, 0.02, 0.12, steel, { axis: 'x', at: [0, 0, 0], segments: 10 }));
    hw.add(kit.torus(0.14, 0.014, darkSteel, { axis: 'x', at: [sx * 0.05, 0, 0], segments: 32 }));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      hw.add(kit.box(0.014, 0.012, 0.13, darkSteel, {
        at: [sx * 0.05, Math.sin(a) * 0.065, Math.cos(a) * 0.065], rotDeg: [-a / DEG, 0, 0],
      }));
    }
    hw.add(kit.cyl(0.016, 0.016, 0.09, black, { axis: 'x', at: [sx * 0.1, 0.14, 0], segments: 10 })); // manivela
    // Soporte desde la gualdera.
    hw.add(kit.box(0.2, 0.06, 0.06, green, { at: [-sx * 0.1, 0, -0.16], bevel: 0.01 }));
  }

  // DFCS: pantalla del apuntador (GDU, izq.) y del ayudante (AGDU, dcha.).
  for (const sx of [-1, 1]) {
    const big = sx < 0;
    const scr = kit.group({ at: [sx * 0.66, 0.05, 1.26], rotDeg: [0, 0, sx * 90] });
    g.add(scr);
    const w = big ? 0.3 : 0.22, h = big ? 0.24 : 0.18;
    scr.add(kit.box(w, 0.07, h, green, { bevel: 0.015 }));
    scr.add(kit.box(w - 0.06, 0.005, h - 0.06, kit.glass(), { at: [0, -0.036, 0.0] }));
    scr.add(kit.box(w - 0.075, 0.003, h - 0.075, kit.emissive(0x2f7a4a, 0.55), { at: [0, -0.039, 0.0] }));
    for (const x of [-1, 1]) scr.add(kit.box(0.025, 0.06, h * 0.9, black, { at: [x * (w / 2 + 0.012), -0.02, 0], bevel: 0.006 }));
    // Brazo articulado de la pantalla hacia la gualdera.
    g.add(kit.tube([[sx * 0.62, 0.05, 1.13], [sx * 0.55, 0.0, 1.0], [sx * 0.46, -0.1, 0.98]], 0.018, darkSteel));
  }
  g.add(kit.stencil('M777A2', 0.07, { at: [-0.442, 0.05, 0.86], rotDeg: [0, 0, -90] }));
}

// ===========================================================================
//  Cuna (masa elevable, origen en muñones, +Y a lo largo del ánima)
// ===========================================================================
function buildCradle(kit: ModelKit, g: THREE.Group, m: Mats): void {
  const { green, steel, darkSteel, black } = m;
  const chrome = kit.chrome();
  // Muñones.
  g.add(kit.cyl(0.085, 0.085, 0.94, darkSteel, { axis: 'x', segments: 24 }));
  // Yugo trasero (abraza el tubo en los muñones).
  g.add(kit.box(0.62, 0.42, 0.1, green, { at: [0, 0.02, 0.235], bevel: 0.03 }));
  g.add(kit.box(0.62, 0.42, 0.12, green, { at: [0, 0.02, -0.235], bevel: 0.03 }));
  for (const sx of [-1, 1]) g.add(kit.box(0.12, 0.42, 0.52, green, { at: [sx * 0.27, 0.02, 0], bevel: 0.03 }));
  // Cuatro tubos estructurales de titanio extruido.
  const tubes: Array<[number, number, number]> = [[-0.22, -0.16, 0.045], [0.22, -0.16, 0.045], [-0.25, 0.07, 0.04], [0.25, 0.07, 0.04]];
  for (const [x, z, r] of tubes) {
    g.add(kit.cyl(r, r, 2.9, green, { at: [x, 1.55, z], segments: 16 }));
  }
  // Cilindros de freno/recuperador (arriba) con culatas.
  for (const sx of [-1, 1]) {
    g.add(kit.cyl(0.075, 0.075, 2.5, green, { at: [sx * 0.115, 1.45, 0.215], segments: 22 }));
    g.add(kit.cyl(0.085, 0.085, 0.1, green, { at: [sx * 0.115, 2.72, 0.215], segments: 22 }));
    g.add(kit.cyl(0.085, 0.085, 0.1, green, { at: [sx * 0.115, 0.22, 0.215], segments: 22 }));
    g.add(kit.cyl(0.05, 0.05, 0.03, darkSteel, { at: [sx * 0.115, 2.785, 0.215], segments: 16 }));
  }
  // Abrazaderas intermedias (anillos de unión de los tubos).
  for (const y of [0.9, 1.75]) {
    g.add(kit.box(0.6, 0.06, 0.06, green, { at: [0, y, -0.19], bevel: 0.01 }));
    g.add(kit.box(0.62, 0.06, 0.06, green, { at: [0, y, 0.185], bevel: 0.01 }));
    for (const sx of [-1, 1]) g.add(kit.box(0.05, 0.06, 0.3, green, { at: [sx * 0.24, y, -0.04], bevel: 0.01 }));
  }
  // Yugo delantero con cojinete del tubo.
  const fy = 2.9;
  g.add(kit.box(0.6, 0.3, 0.12, green, { at: [0, fy, -0.19], bevel: 0.025 }));
  g.add(kit.box(0.4, 0.3, 0.14, green, { at: [0, fy, 0.21], bevel: 0.03 }));
  for (const sx of [-1, 1]) g.add(kit.box(0.12, 0.3, 0.36, green, { at: [sx * 0.24, fy, 0.0], bevel: 0.025 }));
  g.add(kit.cyl(0.15, 0.15, 0.32, green, { at: [0, fy, 0], segments: 28, open: true }));
  g.add(kit.torus(0.135, 0.02, darkSteel, { at: [0, fy + 0.165, 0], segments: 28 }));
  g.add(kit.boltRow([-0.18, fy - 0.12, 0.285], [0.18, fy - 0.12, 0.285], 4, 0.013, darkSteel));
  g.add(kit.boltRow([-0.18, fy + 0.12, 0.285], [0.18, fy + 0.12, 0.285], 4, 0.013, darkSteel));
  // Acumulador del sistema de retroceso + tubería.
  g.add(kit.cyl(0.07, 0.07, 0.62, green, { at: [0, 1.1, -0.29], segments: 18 }));
  g.add(kit.sphere(0.07, green, { at: [0, 1.41, -0.29], segments: 14 }));
  g.add(kit.sphere(0.07, green, { at: [0, 0.79, -0.29], segments: 14 }));
  g.add(kit.tube([[0, 0.8, -0.24], [0.08, 0.5, -0.2], [0.12, 0.25, 0.12], [0.115, 0.2, 0.17]], 0.012, black));
  g.add(kit.tube([[0, 1.4, -0.24], [-0.06, 1.7, -0.2], [-0.12, 2.0, 0.12], [-0.115, 2.1, 0.15]], 0.012, black));

  // DFCS: unidad inercial (INU) con antena GPS, lado del apuntador.
  const inu = kit.group({ at: [-0.42, 0.4, 0.12] });
  g.add(inu);
  inu.add(kit.box(0.2, 0.36, 0.26, green, { bevel: 0.025 }));
  inu.add(kit.box(0.04, 0.3, 0.04, green, { at: [0.12, 0, -0.09] }));
  inu.add(kit.box(0.205, 0.04, 0.2, black, { at: [0, -0.16, 0], bevel: 0.006 }));
  inu.add(kit.cyl(0.02, 0.02, 0.03, black, { axis: 'x', at: [-0.105, 0.08, 0.05], segments: 10 }));
  inu.add(kit.cyl(0.02, 0.02, 0.03, black, { axis: 'x', at: [-0.105, 0.0, 0.05], segments: 10 }));
  inu.add(kit.stencil('INU', 0.04, { at: [-0.102, 0.06, -0.06], rotDeg: [0, 0, -90] }));
  inu.add(kit.cyl(0.012, 0.012, 0.16, darkSteel, { axis: 'z', at: [0, 0.1, 0.2], segments: 8 }));
  inu.add(kit.lathe([[0, 0], [0.055, 0], [0.05, 0.02], [0.03, 0.035], [0, 0.04]], kit.polymer(0x3a3c36), {
    axis: 'z', at: [0, 0.1, 0.28], segments: 18,
  }));
  g.add(kit.tube([[-0.42, 0.22, 0.05], [-0.36, 0.05, -0.05], [-0.3, -0.12, -0.15]], 0.013, black));

  // Miras: alza panorámica (M137) y anteojo de tiro directo, lado izquierdo.
  const sight = kit.group({ at: [-0.42, -0.12, 0.2] });
  g.add(sight);
  sight.add(kit.box(0.1, 0.16, 0.12, green, { at: [0, 0, 0], bevel: 0.015 }));
  sight.add(kit.cyl(0.035, 0.035, 0.26, black, { axis: 'z', at: [0, 0, 0.18], segments: 14 }));
  sight.add(kit.box(0.11, 0.13, 0.1, black, { at: [0, 0.02, 0.34], bevel: 0.02 }));
  sight.add(kit.cyl(0.03, 0.03, 0.09, kit.glass(), { at: [0, 0.1, 0.34], segments: 12 }));
  sight.add(kit.cyl(0.028, 0.024, 0.14, black, { axis: 'x', at: [-0.1, -0.04, 0.32], segments: 12 }));
  const dfs = kit.group({ at: [-0.36, 0.55, -0.02] });
  g.add(dfs);
  dfs.add(kit.cyl(0.04, 0.035, 0.42, black, { at: [0, 0, 0], segments: 14 }));
  dfs.add(kit.cyl(0.026, 0.026, 0.02, kit.glass(), { at: [0, 0.22, 0], segments: 12 }));
  dfs.add(kit.box(0.06, 0.12, 0.08, green, { at: [0.05, -0.05, 0], bevel: 0.01 }));

  // Sector dentado de elevación (lado derecho, bajo los muñones).
  const sector = kit.group({ at: [0.33, 0, 0] });
  g.add(sector);
  sector.add(kit.extrudeSide(sectorProfile(0.22, 0.355, -178, -96), 0.03, green, { bevel: 0.004 }));
  for (let k = 0; k <= 20; k++) {
    const a = (-176 + (k / 20) * 78) * DEG;
    sector.add(kit.box(0.034, 0.02, 0.03, darkSteel, {
      at: [0, Math.cos(a) * 0.365, Math.sin(a) * 0.365], rotDeg: [a / DEG - 90, 0, 0],
    }));
  }
  void chrome; void steel;
  g.add(kit.stencil('155MM', 0.06, { at: [0.302, 1.3, -0.04], rotDeg: [0, 0, 90] }));
}

/** Perfil (y, z) de un sector anular (radios r0..r1, ángulos en grados). */
function sectorProfile(r0: number, r1: number, a0: number, a1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * (i / n)) * DEG;
    pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
  }
  for (let i = n; i >= 0; i--) {
    const a = (a0 + (a1 - a0) * (i / n)) * DEG;
    pts.push([Math.cos(a) * r0, Math.sin(a) * r0]);
  }
  return pts;
}

// ===========================================================================
//  Masa que retrocede: tubo M776 + freno de boca + anillo de cierre
// ===========================================================================
function buildTube(kit: ModelKit, g: THREE.Group, m: Mats): void {
  const { green, steel, darkSteel, black } = m;
  const bore = 0.0775;
  // Tubo (perfil exterior, del anillo de cierre a la rosca del freno).
  g.add(kit.lathe([
    [0, -0.5], [0.168, -0.5], [0.168, 0.35], [0.158, 0.45], [0.152, 0.9], [0.14, 1.3], [0.128, 1.9],
    [0.118, 2.8], [0.11, 3.6], [0.105, 4.15], [0.112, 4.18], [0.118, 4.2], [0.118, 4.36], [0.09, 4.36], [0, 4.36],
  ], green, { segments: 48 }));
  // Zuncho de fijación del cojinete y banda de desgaste (metal visto).
  g.add(kit.cyl(0.155, 0.155, 0.06, darkSteel, { at: [0, 0.38, 0], segments: 40 }));

  // -- Freno de boca de doble deflector (4.35 → 5.095) ----------------------
  const by0 = 4.35;
  const brake = kit.group({ name: 'muzzleBrake', at: [0, by0, 0] });
  g.add(brake);
  // Collarín trasero (rosca sobre el tubo).
  brake.add(kit.lathe([[0.122, 0], [0.155, 0.01], [0.16, 0.05], [0.16, 0.17], [0.15, 0.18], [0.1, 0.18], [bore, 0.18]],
    green, { segments: 40 }));
  // Placas superior/inferior que unen los deflectores.
  for (const sz of [-1, 1]) {
    brake.add(kit.box(0.3, 0.58, 0.05, green, { at: [0, 0.455, sz * 0.118], bevel: 0.015 }));
  }
  // Deflectores con taladro central (ventanas laterales entre ellos).
  brake.add(baffle(kit, green, 0.42, 0.3, bore + 0.006, 0.085, [0, 0.395, 0]));
  brake.add(baffle(kit, green, 0.44, 0.31, bore + 0.006, 0.11, [0, 0.69, 0]));
  // Interior oscuro visible por las ventanas y la boca.
  const soot = kit.paint(0x141412, { roughness: 0.95, metalness: 0.1, wear: 0 });
  brake.add(kit.cyl(bore, bore, 0.012, soot, { at: [0, 0.172, 0], segments: 20 }));
  brake.add(kit.cyl(bore, bore, 0.6, soot, { at: [0, -0.1, 0], segments: 20, open: true }));
  brake.add(kit.cyl(bore - 0.005, bore - 0.005, 0.1, soot, { at: [0, 0.69, 0], segments: 20, open: true }));
  // Argolla de remolque abatida bajo el freno (el M777 se remolca por la boca).
  const tow = kit.group({ at: [0, 0.32, -0.17] });
  brake.add(tow);
  for (const sx of [-1, 1]) tow.add(kit.box(0.025, 0.2, 0.08, darkSteel, { at: [sx * 0.06, 0, 0.02], bevel: 0.006 }));
  tow.add(kit.cyl(0.02, 0.02, 0.16, steel, { axis: 'x', at: [0, -0.06, 0.03], segments: 10 }));
  tow.add(kit.torus(0.075, 0.02, darkSteel, { axis: 'z', at: [0, 0.07, -0.005], segments: 24 }));

  // -- Anillo de cierre, cierre de tornillo y mecanismos --------------------
  const ring = kit.group({ name: 'breech', at: [0, -0.72, 0] });
  g.add(ring);
  ring.add(kit.box(0.4, 0.44, 0.4, green, { bevel: 0.05 }));
  ring.add(kit.box(0.44, 0.3, 0.12, green, { at: [0, 0.03, 0.2], bevel: 0.03 })); // orejetas de los vástagos
  // Cara del cierre: tornillo escalonado (acero visto) y portacierre.
  ring.add(kit.cyl(0.15, 0.15, 0.04, steel, { at: [0, -0.235, 0], segments: 32 }));
  ring.add(kit.cyl(0.1, 0.11, 0.05, darkSteel, { at: [0, -0.275, 0], segments: 28 }));
  ring.add(kit.cyl(0.02, 0.02, 0.04, black, { at: [0, -0.31, 0], segments: 10 })); // mecanismo de disparo
  // Mecanismo de alimentación de estopines (caja trasera superior).
  ring.add(kit.box(0.12, 0.1, 0.1, darkSteel, { at: [0.0, -0.27, 0.13], bevel: 0.015 }));
  ring.add(kit.box(0.05, 0.05, 0.12, black, { at: [0.07, -0.3, 0.13], bevel: 0.01 }));
  // Palanca del cierre (lado derecho) y asidero.
  ring.add(kit.box(0.04, 0.05, 0.3, darkSteel, { at: [0.235, -0.18, -0.06], rotDeg: [18, 0, 0], bevel: 0.01 }));
  ring.add(kit.cyl(0.022, 0.022, 0.1, black, { axis: 'x', at: [0.28, -0.22, -0.2], segments: 10 }));
  ring.add(kit.cyl(0.05, 0.05, 0.06, darkSteel, { axis: 'x', at: [0.22, -0.15, 0.08], segments: 16 }));
  // Bandeja de carga abatida (derecha), argolla del tirafrictor.
  ring.add(kit.extrudeSide([[0, 0], [-0.42, -0.02], [-0.42, -0.07], [0, -0.05]], 0.18, darkSteel, {
    at: [0.12, -0.22, -0.2],
  }));
  ring.add(kit.torus(0.025, 0.006, darkSteel, { axis: 'x', at: [-0.21, -0.2, -0.08], segments: 12 }));
  // Vástagos del freno/recuperador (salen de los cilindros al retroceder).
  for (const sx of [-1, 1]) {
    g.add(kit.cyl(0.032, 0.032, 2.2, kit.chrome(), { at: [sx * 0.115, 0.5, 0.215], segments: 14 }));
    g.add(kit.cyl(0.05, 0.05, 0.08, darkSteel, { axis: 'x', at: [sx * 0.115, -0.58, 0.215], segments: 14 }));
  }
  ring.add(kit.stencil('M776', 0.045, { at: [-0.202, 0.05, 0.04], rotDeg: [0, 0, -90] }));
  void BREECH_Y;
}

/** Deflector del freno de boca: placa redondeada con taladro, eje Y. */
function baffle(kit: ModelKit, mat: THREE.Material, w: number, h: number, holeR: number, thick: number, at: V3): THREE.Mesh {
  const r = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -r);
  shape.lineTo(w / 2 - r, -r);
  shape.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-w / 2 + r, r);
  shape.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick - 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 16,
  });
  geo.translate(0, 0, -(thick - 0.02) / 2);
  geo.rotateX(-Math.PI / 2); // extrusión Z → Y (forma en el plano XZ)
  geo.computeVertexNormals();
  return kit.place(kit.mesh(geo, mat), { at });
}
