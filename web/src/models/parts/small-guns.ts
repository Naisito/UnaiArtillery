// ============================================================================
//  parts/small-guns.ts — Cuerpos de las armas ligeras (agente 3D-SMALL). [V2]
//
//  Cada builder devuelve el arma en SUS coordenadas de arma: eje del ánima a
//  lo largo de +Y en z = 0, x = 0 (metros reales). Se separa en dos grupos:
//    fixed  — lo que NO retrocede respecto al montaje (armazón, cajón…),
//    moving — lo que retrocede (corredera, cañón, o el arma entera),
//  más los puntos de referencia que el montaje necesita (boca, muñón…).
//  smallArms.ts los cuelga de la jerarquía del rig.
//
//  Referencias (medidas publicadas):
//    * Pistola clase Glock 17 / M17: 202-204 mm, corredera 186 mm, cañón
//      114 mm, ancho 25.4 mm, alto 139 mm, ángulo de empuñadura ~22°.
//    * M4A1: 840 mm (culata extendida), cañón 14.5" (368 mm), raíl RIS.
//    * M240B: 1245 mm, cañón 627 mm.
//    * M2HB: 1654 mm, cañón 45" (1143 mm).
// ============================================================================
import * as THREE from 'three';
import type { ModelKit } from '../kit';
import { knob, picatinny, revolve, sbox, sideShape, type Profile } from './small-util';

export interface GunBody {
  fixed: THREE.Group;
  moving: THREE.Group;
  /** Boca (coordenadas de arma). */
  muzzle: THREE.Vector3;
}

/** Paleta común de las armas ligeras. */
export function smallPalette(kit: ModelKit) {
  return {
    nitride: kit.steel(0x232527, { roughness: 0.48, metalness: 0.7 }),
    park: kit.steel(0x2b2d2e, { roughness: 0.62, metalness: 0.6 }),
    parkGreen: kit.steel(0x2e312c, { roughness: 0.66, metalness: 0.55 }),
    barrel: kit.steel(0x34373a, { roughness: 0.4, metalness: 0.8 }),
    bright: kit.steel(0x8d9196, { roughness: 0.28, metalness: 0.95 }),
    anod: kit.paint(0x1f2022, { roughness: 0.55, metalness: 0.35 }),
    blackPoly: kit.polymer(0x1c1d1e),
    fde: kit.polymer(0x9c8463),
    coyote: kit.polymer(0x8a7655),
    hole: kit.paint(0x070707, { roughness: 0.95, metalness: 0.0 }),
    groove: kit.paint(0x0e0e0f, { roughness: 0.8, metalness: 0.2 }),
    tritium: kit.emissive(0x7dff6a, 1.2),
    glass: kit.glass(),
    brass: kit.brass(),
    copper: kit.steel(0xb8734a, { roughness: 0.32, metalness: 1.0 }),
    white: kit.paint(0xd9d6cc, { roughness: 0.6, metalness: 0.1 }),
  };
}
export type SmallPalette = ReturnType<typeof smallPalette>;

// ============================================================================
//  Pistola 9 mm de percutor lanzado (clase Glock 17 / M17)
//  Coordenadas: y = 0 en la cara trasera de la corredera, ánima en z = 0.
// ============================================================================
export function buildPistolBody(kit: ModelKit, P: SmallPalette): GunBody {
  const fixed = kit.group({ name: 'pistol-frame' });
  const moving = kit.group({ name: 'pistol-slide' });
  const SL = 0.186;           // longitud de corredera
  const ZT = 0.0150, ZB = -0.0135; // techo / suelo de la corredera
  const W = 0.0254;           // ancho de corredera

  // ---- Corredera (nitrurada negra) -------------------------------------------
  moving.add(kit.extrudeSide([
    [0, ZB], [0, ZT - 0.0025], [0.002, ZT], [SL - 0.010, ZT], [SL - 0.002, ZT - 0.0045],
    [SL, ZT - 0.0065], [SL, ZB + 0.002], [SL - 0.003, ZB],
  ], W, P.nitride, { bevel: 0.0016 }));
  // Estrías de amartillado traseras y delanteras (ranuras oscuras).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      moving.add(sbox(kit, 0.0004, 0.0011, 0.0175, P.groove, {
        at: [side * (W / 2 + 0.00005), 0.009 + i * 0.0032, 0.0012],
      }));
    }
    for (let i = 0; i < 6; i++) {
      moving.add(sbox(kit, 0.0004, 0.0011, 0.0150, P.groove, {
        at: [side * (W / 2 + 0.00005), 0.150 + i * 0.0032, 0.0005],
      }));
    }
  }
  // Ventana de expulsión (lado derecho + techo) con el capuchón del cañón.
  moving.add(sbox(kit, 0.0150, 0.0440, 0.0012, P.groove, { at: [0.0052, 0.093, ZT + 0.0001] }));
  moving.add(sbox(kit, 0.0013, 0.0440, 0.0110, P.groove, { at: [W / 2 + 0.0001, 0.093, ZT - 0.0055] }));
  moving.add(sbox(kit, 0.0138, 0.0410, 0.0012, P.barrel, { at: [0.0050, 0.093, ZT + 0.0003] }));
  moving.add(sbox(kit, 0.0011, 0.0410, 0.0096, P.barrel, { at: [W / 2 + 0.0003, 0.093, ZT - 0.0055] }));
  // Extractor (resalte a la derecha tras la ventana).
  moving.add(sbox(kit, 0.0012, 0.012, 0.004, P.nitride, { at: [W / 2 + 0.0004, 0.066, ZT - 0.006] }));
  // Miras: delantera (poste con punto de tritio) y trasera (escotadura con 2 puntos).
  moving.add(sbox(kit, 0.0034, 0.0050, 0.0050, P.nitride, { at: [0, SL - 0.012, ZT + 0.0025], bevel: 0.0005 }));
  moving.add(kit.cyl(0.0009, 0.0009, 0.0006, P.tritium, { at: [0, SL - 0.0147, ZT + 0.0034], segments: 10 }));
  for (const s of [-1, 1]) {
    moving.add(sbox(kit, 0.0085, 0.0075, 0.0058, P.nitride, { at: [s * 0.0068, 0.012, ZT + 0.0029], bevel: 0.0006 }));
    moving.add(kit.cyl(0.0009, 0.0009, 0.0006, P.tritium, { at: [s * 0.0058, 0.0081, ZT + 0.0036], segments: 10 }));
  }
  moving.add(sbox(kit, 0.022, 0.0075, 0.0018, P.nitride, { at: [0, 0.012, ZT + 0.0009] }));
  // Boca: corona del cañón con ánima negra + tapón de la guía del muelle.
  moving.add(revolve(kit, [[0.0066, SL - 0.004], [0.0066, SL + 0.0004], [0.0050, SL + 0.0006], [0.0050, SL - 0.001]], P.barrel, { segments: 20 }));
  moving.add(kit.cyl(0.0046, 0.0046, 0.0006, P.hole, { at: [0, SL + 0.0004, 0], segments: 16 }));
  moving.add(kit.cyl(0.0034, 0.0034, 0.003, P.blackPoly, { at: [0, SL - 0.0005, -0.0092], segments: 14 }));

  // ---- Armazón de polímero (coyote, como el M17) ---------------------------------
  // Empuñadura con lomo en cola de castor (ángulo ~22°).
  fixed.add(kit.extrudeSide([
    [-0.003, ZB], [0.108, ZB], [0.108, -0.0245], [0.081, -0.0245], [0.077, -0.034],
    [0.070, -0.052], [0.062, -0.075], [0.053, -0.098], [0.047, -0.112], [0.046, -0.117],
    [-0.004, -0.117], [-0.002, -0.106], [0.008, -0.080], [0.017, -0.058], [0.026, -0.042],
    [0.022, -0.034], [0.010, -0.028], [-0.004, -0.0255], [-0.010, -0.0215], [-0.0105, -0.0165],
  ], 0.0300, P.coyote, { bevel: 0.0038 }));
  // Guardapolvo con raíl de accesorios (3 ranuras).
  fixed.add(kit.extrudeSide([
    [0.100, ZB], [SL - 0.003, ZB], [SL - 0.001, -0.017], [SL - 0.004, -0.0300],
    [0.112, -0.0300], [0.104, -0.0245], [0.100, -0.0245],
  ], 0.0246, P.coyote, { bevel: 0.0014 }));
  fixed.add(picatinny(kit, 0.032, P.coyote, { at: [0, 0.160, -0.0300], rotDeg: [0, 180, 0] }));
  // Guardamonte de frente recto con su hueco.
  fixed.add(sideShape(kit,
    [[0.075, -0.0245], [0.112, -0.0245], [0.1195, -0.0300], [0.1205, -0.0500], [0.1145, -0.0565], [0.084, -0.0565], [0.072, -0.0500], [0.072, -0.030]],
    [[[0.080, -0.0290], [0.1105, -0.0290], [0.1155, -0.0330], [0.1160, -0.0475], [0.1115, -0.0515], [0.0860, -0.0515], [0.0785, -0.0460], [0.0775, -0.0320]]],
    0.0095, P.coyote, { bevel: 0.0012 }));
  // Gatillo (hoja curva con seguro de lengüeta) y su ventana.
  fixed.add(kit.extrudeSide([
    [0.0935, -0.0262], [0.0995, -0.0262], [0.0985, -0.0360], [0.0952, -0.0455], [0.0915, -0.0482],
    [0.0893, -0.0465], [0.0925, -0.0362],
  ], 0.0060, P.blackPoly, { bevel: 0.0008 }));
  // Base del cargador (asoma bajo la empuñadura) y su arandela de agarre.
  fixed.add(kit.extrudeSide([
    [-0.0055, -0.1168], [0.0470, -0.1168], [0.0490, -0.1215], [0.0455, -0.1250], [-0.0040, -0.1250], [-0.0070, -0.1215],
  ], 0.0318, P.blackPoly, { bevel: 0.0015 }));
  // Mandos: retén de corredera, palanca de desmontaje, retén del cargador.
  fixed.add(sbox(kit, 0.0016, 0.020, 0.0040, P.nitride, { at: [-0.0155, 0.083, -0.0165], bevel: 0.0006 }));
  for (const s of [-1, 1]) {
    fixed.add(sbox(kit, 0.0012, 0.0055, 0.0045, P.nitride, { at: [s * 0.0128, 0.112, -0.0172], bevel: 0.0004 }));
    // Pasadores del armazón (cabezas de acero).
    fixed.add(kit.cyl(0.0016, 0.0016, 0.0006, P.bright, { axis: 'x', at: [s * 0.0153, 0.067, -0.0205], segments: 10 }));
    fixed.add(kit.cyl(0.0016, 0.0016, 0.0006, P.bright, { axis: 'x', at: [s * 0.0153, 0.0035, -0.0195], segments: 10 }));
  }
  fixed.add(sbox(kit, 0.0030, 0.0065, 0.0080, P.blackPoly, { at: [-0.0151, 0.0745, -0.0310], bevel: 0.0008 }));
  // Paneles texturados de la empuñadura (tono algo más oscuro).
  const grip = kit.polymer(0x7f6c4d);
  for (const s of [-1, 1]) {
    fixed.add(kit.extrudeSide([
      [0.010, -0.050], [0.060, -0.050], [0.052, -0.098], [0.002, -0.098],
    ], 0.0004, grip, { at: [s * 0.0151, 0, 0] }));
  }
  return { fixed, moving, muzzle: new THREE.Vector3(0, SL + 0.0004, 0) };
}

// ============================================================================
//  Carabina M4A1 (SOPMOD): cañón 14.5", raíl KAC RIS, M68 CCO, PEQ-15,
//  linterna, culata con tubos de baterías, cargador de polímero.
//  Coordenadas: y = 0 en la cara trasera del cajón superior, ánima z = 0.
//  Boca (bocacha A2) en y ≈ 0.525; cantonera en y ≈ −0.315 => 840 mm.
// ============================================================================
export function buildM4Body(kit: ModelKit, P: SmallPalette): GunBody & { railBottomZ: number } {
  const fixed = kit.group({ name: 'm4-fixed' });
  const g = kit.group({ name: 'm4' });
  const A = P.anod, F = P.fde, B = P.blackPoly;

  // ---- Cajón superior (flat-top) ----------------------------------------------
  g.add(kit.extrudeSide([
    [0, -0.0155], [0, 0.0185], [0.183, 0.0185], [0.183, -0.004], [0.178, -0.0155],
  ], 0.0235, A, { bevel: 0.0018 }));
  g.add(picatinny(kit, 0.178, A, { at: [0, 0.0915, 0.0185] }));
  // Ventana de expulsión con tapa guardapolvo, deflector de vainas y asistente.
  g.add(sbox(kit, 0.0012, 0.052, 0.0135, P.park, { at: [0.0124, 0.098, 0.0015], bevel: 0.0004 }));
  g.add(kit.cyl(0.0012, 0.0012, 0.056, P.bright, { at: [0.0127, 0.098, -0.0065], segments: 8 }));
  g.add(kit.extrudeSide([[0.060, 0.000], [0.074, 0.000], [0.074, 0.016], [0.066, 0.016]], 0.006, A, { at: [0.0135, 0, 0], bevel: 0.001 }));
  const fa = kit.group({ at: [0.0165, 0.040, 0.007], rotDeg: [10, 0, -12] });
  fa.add(kit.cyl(0.0078, 0.0078, 0.034, A, { segments: 18 }));
  fa.add(kit.cyl(0.0068, 0.0068, 0.008, P.park, { at: [0, -0.019, 0], segments: 18 }));
  g.add(fa);
  // Maneta de carga en T.
  g.add(sbox(kit, 0.010, 0.020, 0.008, A, { at: [0, -0.004, 0.0155], bevel: 0.0015 }));
  g.add(sbox(kit, 0.036, 0.008, 0.008, A, { at: [0, -0.012, 0.0155], bevel: 0.002 }));
  // Alza abatible (KAC) plegada sobre el raíl trasero.
  g.add(sbox(kit, 0.024, 0.032, 0.010, B, { at: [0, 0.018, 0.0335], bevel: 0.002 }));

  // ---- Cajón inferior, brocal, guardamonte, gatillo y mandos ---------------
  g.add(kit.extrudeSide([
    [-0.013, -0.0155], [0.186, -0.0155], [0.189, -0.022], [0.189, -0.060], [0.184, -0.067],
    [0.114, -0.067], [0.112, -0.040], [0.036, -0.039], [0.024, -0.046], [0.0, -0.046], [-0.013, -0.034],
  ], 0.0225, A, { bevel: 0.0016 }));
  g.add(sbox(kit, 0.0255, 0.010, 0.006, A, { at: [0, 0.183, -0.063], bevel: 0.002 }));
  g.add(sideShape(kit,
    [[0.044, -0.038], [0.113, -0.038], [0.113, -0.059], [0.106, -0.064], [0.050, -0.064], [0.042, -0.058]],
    [[[0.052, -0.0415], [0.108, -0.0415], [0.108, -0.057], [0.103, -0.0595], [0.054, -0.0595], [0.050, -0.055]]],
    0.008, A, { bevel: 0.001 }));
  g.add(kit.extrudeSide([[0.068, -0.040], [0.073, -0.040], [0.073, -0.047], [0.069, -0.055], [0.066, -0.054], [0.068, -0.047]], 0.004, P.park));
  g.add(sbox(kit, 0.003, 0.016, 0.004, P.park, { at: [-0.0128, 0.034, -0.027], rotDeg: [-30, 0, 0], bevel: 0.0008 }));
  g.add(kit.cyl(0.0035, 0.0035, 0.003, P.park, { axis: 'x', at: [-0.0125, 0.034, -0.027], segments: 12 }));
  g.add(kit.cyl(0.0042, 0.0042, 0.003, P.park, { axis: 'x', at: [0.0125, 0.103, -0.034], segments: 12 }));
  g.add(sbox(kit, 0.003, 0.012, 0.016, P.park, { at: [-0.0125, 0.118, -0.026], bevel: 0.001 }));
  for (const s of [-1, 1]) {
    g.add(kit.cyl(0.0026, 0.0026, 0.0015, P.bright, { axis: 'x', at: [s * 0.0118, 0.001, -0.022], segments: 10 }));
    g.add(kit.cyl(0.0026, 0.0026, 0.0015, P.bright, { axis: 'x', at: [s * 0.0118, 0.181, -0.022], segments: 10 }));
    g.add(kit.cyl(0.0018, 0.0018, 0.0015, P.bright, { axis: 'x', at: [s * 0.0118, 0.054, -0.030], segments: 8 }));
    g.add(kit.cyl(0.0018, 0.0018, 0.0015, P.bright, { axis: 'x', at: [s * 0.0118, 0.074, -0.030], segments: 8 }));
  }
  // Empuñadura A2 (FDE) con resalte para el dedo.
  g.add(kit.extrudeSide([
    [0.000, -0.044], [0.036, -0.044], [0.029, -0.062], [0.032, -0.071], [0.025, -0.084], [0.012, -0.122],
    [0.010, -0.141], [0.004, -0.146], [-0.020, -0.143], [-0.024, -0.136], [-0.008, -0.086], [-0.002, -0.058],
  ], 0.0265, F, { bevel: 0.0045 }));
  g.add(kit.extrudeSide([[0.012, -0.141], [-0.022, -0.139], [-0.023, -0.143], [0.010, -0.146]], 0.022, F, { bevel: 0.001 }));

  // ---- Tubo del amortiguador y culata SOPMOD extendida ----------------------
  g.add(kit.cyl(0.0146, 0.0146, 0.19, A, { at: [0, -0.108, -0.004], segments: 20 }));
  g.add(revolve(kit, [[0, -0.022], [0.0185, -0.022], [0.0185, -0.014], [0, -0.014]], P.park, { at: [0, 0, -0.004], segments: 16 }));
  g.add(sbox(kit, 0.034, 0.004, 0.032, P.park, { at: [0, -0.0115, -0.014], bevel: 0.001 }));
  g.add(kit.extrudeSide([
    [-0.118, -0.024], [-0.118, 0.014], [-0.128, 0.0215], [-0.300, 0.024], [-0.309, 0.019],
    [-0.309, -0.103], [-0.296, -0.110], [-0.250, -0.086], [-0.165, -0.040], [-0.132, -0.028],
  ], 0.040, F, { bevel: 0.006 }));
  for (const s of [-1, 1]) {
    g.add(revolve(kit, [[0, -0.268], [0.0105, -0.266], [0.0115, -0.258], [0.0115, -0.140], [0.0095, -0.132], [0, -0.132]], F, { at: [s * 0.0225, 0, 0.003], segments: 16 }));
  }
  g.add(sbox(kit, 0.044, 0.008, 0.124, kit.rubber(), { at: [0, -0.312, -0.042], bevel: 0.003 }));
  g.add(sbox(kit, 0.006, 0.026, 0.008, B, { at: [0, -0.142, -0.031], bevel: 0.002 }));
  g.add(kit.torus(0.008, 0.0018, P.park, { axis: 'x', at: [0, -0.285, -0.104], segments: 12 }));

  // ---- Tuerca del cañón, anillo delta y guardamanos RIS ----------------------
  g.add(revolve(kit, [[0.0, 0.181], [0.0215, 0.181], [0.0215, 0.186], [0.0265, 0.188], [0.0265, 0.196], [0.0, 0.196]], A, { segments: 28 }));
  const HG0 = 0.197, HG1 = 0.372, HL = HG1 - HG0, HC = (HG0 + HG1) / 2;
  g.add(sbox(kit, 0.037, HL, 0.037, A, { at: [0, HC, 0], bevel: 0.0065 }));
  g.add(picatinny(kit, HL - 0.004, A, { at: [0, HC, 0.0185] }));
  g.add(picatinny(kit, HL - 0.004, A, { at: [0, HC, -0.0185], rotDeg: [0, 180, 0] }));
  g.add(picatinny(kit, HL - 0.004, A, { at: [0.0185, HC, 0], rotDeg: [0, 90, 0] }));
  g.add(picatinny(kit, HL - 0.004, A, { at: [-0.0185, HC, 0], rotDeg: [0, -90, 0] }));
  // Cubre-raíles de escalera (FDE) en el lateral izquierdo y debajo.
  const ladder = (len: number, at: [number, number, number], rotDeg: [number, number, number]) => {
    const lg = kit.group({ at, rotDeg });
    lg.add(sbox(kit, 0.019, len, 0.0035, F, { at: [0, 0, 0.0018], bevel: 0.0008 }));
    for (let i = 0; i < Math.floor(len / 0.01); i++) {
      lg.add(sbox(kit, 0.021, 0.0035, 0.0022, F, { at: [0, -len / 2 + 0.005 + i * 0.01, 0.0045] }));
    }
    g.add(lg);
  };
  ladder(0.12, [-0.0256, HC - 0.02, 0], [0, -90, 0]);
  ladder(0.15, [0, HC - 0.005, -0.0256], [0, 180, 0]);
  ladder(0.07, [0.0256, HG0 + 0.045, 0], [0, 90, 0]);

  // ---- Cañón M4 (perfil con escalón tras la base de la mira) -----------------
  const barrelProf: Profile = [
    [0.0, 0.180], [0.0098, 0.180], [0.0098, 0.378], [0.0090, 0.379], [0.0090, 0.405], [0.0085, 0.407],
    [0.0085, 0.466], [0.0076, 0.468], [0.0076, 0.476], [0.0, 0.476],
  ];
  g.add(revolve(kit, barrelProf, P.park, { segments: 20 }));
  // Base de mira delantera "A-frame" (bloque de gases) con orejas y poste.
  g.add(revolve(kit, [[0, 0.379], [0.0145, 0.379], [0.0150, 0.383], [0.0150, 0.401], [0.0145, 0.404], [0, 0.404]], P.park, { segments: 20 }));
  g.add(kit.extrudeSide([[0.380, 0.008], [0.403, 0.008], [0.399, 0.046], [0.394, 0.050], [0.389, 0.050], [0.384, 0.046]], 0.013, P.park, { bevel: 0.0012 }));
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([[0.384, 0.040], [0.398, 0.040], [0.398, 0.057], [0.394, 0.062], [0.388, 0.062], [0.384, 0.057]], 0.0028, P.park, { at: [s * 0.0083, 0, 0], bevel: 0.0005 }));
  }
  g.add(kit.cyl(0.0013, 0.0013, 0.012, P.park, { axis: 'z', at: [0, 0.391, 0.054], segments: 8 }));
  g.add(sbox(kit, 0.007, 0.022, 0.009, P.park, { at: [0, 0.392, -0.019], bevel: 0.001 }));
  g.add(sbox(kit, 0.004, 0.012, 0.014, P.park, { at: [0, 0.392, -0.029], bevel: 0.001 }));
  g.add(kit.torus(0.0065, 0.0016, P.park, { axis: 'x', at: [0, 0.392, -0.040], segments: 12 }));
  // Bocacha A2 "birdcage" con 5 ranuras (cerrada por abajo).
  g.add(revolve(kit, [[0.0076, 0.469], [0.0098, 0.471], [0.0108, 0.474], [0.0108, 0.521], [0.0100, 0.525], [0.0056, 0.525], [0.0056, 0.519], [0, 0.519]], P.park, { segments: 22 }));
  for (const a of [0, 60, -60, 120, -120]) {
    const sg = kit.group({ rotDeg: [0, a, 0], at: [0, 0.499, 0] });
    sg.add(sbox(kit, 0.0032, 0.030, 0.0026, P.hole, { at: [0, 0, 0.0099] }));
    g.add(sg);
  }
  g.add(kit.cyl(0.0050, 0.0050, 0.001, P.hole, { at: [0, 0.5245, 0], segments: 14 }));

  // ---- Óptica M68 CCO (Aimpoint CompM4) sobre montura QRP2 -------------------
  const OZ = 0.0675, OY0 = 0.055, OY1 = 0.170;
  g.add(sbox(kit, 0.030, 0.042, 0.011, B, { at: [0, 0.112, 0.0335], bevel: 0.002 }));
  g.add(sbox(kit, 0.014, 0.040, 0.024, B, { at: [0, 0.112, 0.046], bevel: 0.002 }));
  g.add(kit.cyl(0.0055, 0.0055, 0.014, B, { axis: 'x', at: [0.020, 0.112, 0.0315], segments: 10 }));
  g.add(knob(kit, 0.008, 0.006, B, { axis: 'x', at: [0.029, 0.112, 0.0315] }));
  g.add(revolve(kit, [
    [0.0, OY0], [0.0175, OY0], [0.0198, OY0 + 0.004], [0.0198, OY0 + 0.022], [0.0172, OY0 + 0.030],
    [0.0172, OY1 - 0.030], [0.0205, OY1 - 0.022], [0.0215, OY1 - 0.004], [0.0185, OY1], [0.0, OY1],
  ], B, { at: [0, 0, OZ], segments: 28 }));
  g.add(kit.cyl(0.0155, 0.0155, 0.0012, P.glass, { at: [0, OY0 - 0.0004, OZ], segments: 24 }));
  g.add(kit.cyl(0.0175, 0.0175, 0.0012, P.glass, { at: [0, OY1 + 0.0004, OZ], segments: 24 }));
  g.add(sbox(kit, 0.032, 0.040, 0.026, B, { at: [0, 0.112, OZ - 0.004], bevel: 0.005 }));
  g.add(kit.cyl(0.0085, 0.0085, 0.014, B, { axis: 'z', at: [0, 0.112, OZ + 0.022], segments: 16 }));
  g.add(kit.cyl(0.0085, 0.0085, 0.014, B, { axis: 'x', at: [0.021, 0.112, OZ], segments: 16 }));
  g.add(kit.cyl(0.0095, 0.0095, 0.036, B, { axis: 'x', at: [-0.016, 0.100, OZ - 0.006], segments: 16 }));
  g.add(knob(kit, 0.0105, 0.006, B, { axis: 'x', at: [-0.036, 0.100, OZ - 0.006] }));
  // Tapas de lente abatidas (abiertas) delante y detrás.
  g.add(sbox(kit, 0.034, 0.003, 0.030, B, { at: [0, OY0 - 0.006, OZ + 0.034], rotDeg: [-20, 0, 0], bevel: 0.001 }));
  g.add(sbox(kit, 0.038, 0.003, 0.032, B, { at: [0, OY1 + 0.006, OZ + 0.035], rotDeg: [20, 0, 0], bevel: 0.001 }));

  // ---- PEQ-15 (ATPIAL, FDE) sobre el raíl superior del guardamanos -----------
  g.add(sbox(kit, 0.020, 0.034, 0.006, B, { at: [0, 0.318, 0.031], bevel: 0.001 }));
  g.add(sbox(kit, 0.060, 0.098, 0.032, F, { at: [0.008, 0.322, 0.050], bevel: 0.006 }));
  for (const [dx, dz, r] of [[-0.012, 0.004, 0.0075], [0.010, 0.006, 0.006], [0.026, -0.004, 0.0045]] as const) {
    g.add(kit.cyl(r + 0.0015, r + 0.0015, 0.004, B, { at: [0.008 + dx, 0.372, 0.050 + dz], segments: 16 }));
    g.add(kit.cyl(r, r, 0.001, P.glass, { at: [0.008 + dx, 0.3742, 0.050 + dz], segments: 16 }));
  }
  g.add(sbox(kit, 0.014, 0.012, 0.004, B, { at: [-0.004, 0.296, 0.067], bevel: 0.0015 }));
  g.add(sbox(kit, 0.014, 0.012, 0.004, B, { at: [0.016, 0.296, 0.067], bevel: 0.0015 }));
  g.add(kit.cyl(0.006, 0.006, 0.006, B, { axis: 'z', at: [0.022, 0.338, 0.068], segments: 14 }));

  // ---- Linterna M600 en el raíl derecho ---------------------------------------
  g.add(sbox(kit, 0.010, 0.032, 0.020, B, { at: [0.031, 0.340, 0], bevel: 0.002 }));
  g.add(revolve(kit, [
    [0.0, 0.262], [0.0105, 0.262], [0.0125, 0.268], [0.0125, 0.350], [0.0158, 0.360],
    [0.0158, 0.388], [0.0140, 0.390], [0.0, 0.390],
  ], B, { at: [0.0475, 0, 0], segments: 22 }));
  g.add(kit.cyl(0.0135, 0.0135, 0.001, P.glass, { at: [0.0475, 0.3905, 0], segments: 22 }));

  // ---- Cargador de polímero (FDE) curvo con nervios ---------------------------
  g.add(kit.extrudeSide([
    [0.117, -0.040], [0.186, -0.040], [0.187, -0.100], [0.192, -0.150], [0.203, -0.196],
    [0.213, -0.218], [0.143, -0.222], [0.133, -0.200], [0.124, -0.152], [0.118, -0.100],
  ], 0.0235, F, { bevel: 0.0022 }));
  g.add(kit.extrudeSide([[0.140, -0.217], [0.216, -0.213], [0.217, -0.226], [0.141, -0.231]], 0.0275, F, { bevel: 0.002 }));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -0.08 - i * 0.03;
      const yf = 0.187 + (i * i) * 0.002, yr = 0.118 + (i * i) * 0.002;
      g.add(sbox(kit, 0.0012, (yf - yr) * 0.7, 0.004, F, { at: [s * 0.0122, (yf + yr) / 2 + 0.002, z] }));
    }
  }

  const moving = g;
  return { fixed, moving, muzzle: new THREE.Vector3(0, 0.525, 0), railBottomZ: -0.0185 - 0.0094 };
}

// ============================================================================
//  Ametralladora M240B (7.62×51): cajón remachado, tapa del alimentador con
//  raíl y visor M145, culata con amortiguador, cañón con asa, regulador de
//  gases, bípode plegado, apagallamas cónico, caja de 100 y cinta M13.
//  Coordenadas: y = 0 en la cara delantera del cajón, ánima z = 0.
//  Cantonera en y = −0.665, boca en y = +0.580 => 1245 mm.
// ============================================================================
export interface MgBody extends GunBody {
  /** Muñón delantero (pasador del montaje), coordenadas de arma. */
  frontMount: THREE.Vector3;
  /** Pasador trasero donde engancha el T&E. */
  rearMount: THREE.Vector3;
}

export function buildM240Body(kit: ModelKit, P: SmallPalette): MgBody {
  const fixed = kit.group({ name: 'm240-fixed' });
  const g = kit.group({ name: 'm240' });
  const S = P.park, B = P.blackPoly;
  const RX = 0.033; // semiancho del cajón

  // ---- Cajón (chapa estampada remachada) -----------------------------------------
  g.add(kit.extrudeSide([
    [-0.335, -0.046], [-0.335, 0.034], [-0.329, 0.040], [-0.006, 0.040], [0.0, 0.033],
    [0.0, -0.040], [-0.010, -0.050], [-0.205, -0.050], [-0.215, -0.046],
  ], 2 * RX, S, { bevel: 0.0025 }));
  // Placas laterales con remaches (dos filas).
  for (const s of [-1, 1]) {
    g.add(sbox(kit, 0.002, 0.30, 0.050, S, { at: [s * (RX + 0.0008), -0.168, -0.012], bevel: 0.0008 }));
    for (let i = 0; i < 7; i++) {
      for (const z of [0.008, -0.032]) {
        g.add(kit.cyl(0.0028, 0.0024, 0.0016, P.parkGreen, { axis: 'x', at: [s * (RX + 0.0022), -0.300 + i * 0.044, z], segments: 8 }));
      }
    }
  }
  // Tapa del alimentador con raíl, cierre y bandeja de alimentación a la izquierda.
  g.add(kit.extrudeSide([
    [-0.218, 0.040], [-0.218, 0.062], [-0.208, 0.068], [-0.030, 0.068], [-0.006, 0.054], [-0.004, 0.040],
  ], 2 * RX - 0.002, S, { bevel: 0.002 }));
  g.add(picatinny(kit, 0.165, S, { at: [0, -0.115, 0.068] }));
  g.add(sbox(kit, 0.040, 0.014, 0.014, S, { at: [0, -0.222, 0.056], bevel: 0.003 }));
  g.add(sbox(kit, 0.030, 0.090, 0.024, S, { at: [-(RX + 0.014), -0.105, 0.026], bevel: 0.002 }));
  g.add(sbox(kit, 0.004, 0.090, 0.016, P.bright, { at: [-(RX + 0.028), -0.105, 0.030] }));
  // Ventana de expulsión de eslabones (derecha) con su tapa.
  g.add(sbox(kit, 0.002, 0.070, 0.016, P.groove, { at: [RX + 0.0012, -0.105, 0.025] }));
  // Palanca de carga (derecha, delante) en su guía.
  g.add(sbox(kit, 0.002, 0.15, 0.007, P.groove, { at: [RX + 0.0013, -0.115, -0.006] }));
  g.add(sbox(kit, 0.030, 0.014, 0.010, S, { at: [RX + 0.015, -0.050, -0.006], bevel: 0.002 }));
  g.add(kit.cyl(0.0065, 0.0065, 0.026, B, { axis: 'z', at: [RX + 0.028, -0.050, -0.006], segments: 14 }));
  // Alza abatible tras la tapa.
  g.add(sbox(kit, 0.034, 0.030, 0.008, S, { at: [0, -0.265, 0.044], bevel: 0.002 }));
  g.add(sbox(kit, 0.026, 0.050, 0.004, S, { at: [0, -0.255, 0.050], bevel: 0.001 }));
  // Caja del mecanismo de disparo, empuñadura y guardamonte abierto.
  g.add(kit.extrudeSide([
    [-0.300, -0.046], [-0.205, -0.046], [-0.205, -0.066], [-0.300, -0.066]], 0.046, S, { bevel: 0.002 }));
  g.add(kit.extrudeSide([
    [-0.285, -0.064], [-0.252, -0.064], [-0.258, -0.090], [-0.272, -0.150], [-0.278, -0.168],
    [-0.306, -0.168], [-0.310, -0.158], [-0.300, -0.112], [-0.292, -0.080],
  ], 0.032, B, { bevel: 0.0045 }));
  g.add(sideShape(kit,
    [[-0.252, -0.060], [-0.180, -0.060], [-0.180, -0.070], [-0.200, -0.098], [-0.250, -0.098], [-0.256, -0.088]],
    [[[-0.246, -0.066], [-0.188, -0.066], [-0.205, -0.091], [-0.246, -0.091], [-0.250, -0.084]]],
    0.010, S, { bevel: 0.001 }));
  g.add(kit.extrudeSide([[-0.228, -0.064], [-0.221, -0.064], [-0.222, -0.074], [-0.227, -0.085], [-0.232, -0.084], [-0.228, -0.074]], 0.006, S));

  // ---- Culata con amortiguador (polímero) ------------------------------------
  g.add(kit.extrudeSide([
    [-0.335, -0.040], [-0.335, 0.030], [-0.350, 0.034], [-0.640, 0.036], [-0.658, 0.030],
    [-0.665, 0.018], [-0.665, -0.105], [-0.656, -0.116], [-0.610, -0.108], [-0.420, -0.064],
    [-0.352, -0.046],
  ], 0.050, B, { bevel: 0.006 }));
  g.add(sbox(kit, 0.054, 0.010, 0.140, kit.rubber(), { at: [0, -0.662, -0.038], bevel: 0.004 }));
  g.add(sbox(kit, 0.046, 0.030, 0.012, S, { at: [0, -0.640, 0.040], bevel: 0.003 }));
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([[-0.400, -0.030], [-0.600, -0.026], [-0.600, 0.012], [-0.400, 0.014]], 0.001, P.groove, { at: [s * 0.0251, 0, 0] }));
  }
  g.add(kit.torus(0.009, 0.0022, S, { axis: 'x', at: [0, -0.62, -0.118], segments: 12 }));

  // ---- Cañón, guardamanos, escudo térmico, gases, mira y apagallamas --------
  g.add(revolve(kit, [
    [0, -0.02], [0.0172, -0.02], [0.0172, 0.055], [0.0145, 0.062], [0.0136, 0.30], [0.0118, 0.31],
    [0.0118, 0.505], [0, 0.505],
  ], P.barrel, { segments: 22 }));
  // Bloqueo del cañón + asa de transporte (desplegada arriba-izquierda).
  g.add(revolve(kit, [[0, 0.012], [0.021, 0.012], [0.022, 0.016], [0.022, 0.050], [0.019, 0.055], [0, 0.055]], S, { segments: 22 }));
  g.add(sbox(kit, 0.012, 0.030, 0.024, S, { at: [-0.018, 0.034, 0.024], rotDeg: [0, -30, 0], bevel: 0.002 }));
  g.add(kit.tube([[-0.024, 0.020, 0.036], [-0.034, 0.030, 0.090], [-0.034, 0.090, 0.110], [-0.034, 0.170, 0.092], [-0.026, 0.190, 0.040]], 0.0062, B, { segments: 28 }));
  g.add(sbox(kit, 0.012, 0.022, 0.018, S, { at: [-0.020, 0.190, 0.026], rotDeg: [0, -30, 0], bevel: 0.002 }));
  g.add(kit.cyl(0.0105, 0.0105, 0.012, S, { at: [0, 0.190, 0], segments: 18 }));
  // Cilindro de gases bajo el cañón y regulador.
  g.add(kit.cyl(0.0092, 0.0092, 0.43, S, { at: [0, 0.225, -0.031], segments: 16 }));
  g.add(kit.extrudeSide([[0.425, 0.012], [0.470, 0.012], [0.470, -0.044], [0.425, -0.044]], 0.026, S, { bevel: 0.003 }));
  g.add(revolve(kit, [[0, 0.470], [0.0125, 0.470], [0.0125, 0.484], [0.0095, 0.488], [0, 0.488]], S, { at: [0, 0, -0.031], segments: 16 }));
  g.add(sbox(kit, 0.006, 0.012, 0.030, S, { at: [0.012, 0.479, -0.031], bevel: 0.001 }));
  // Guardamanos de polímero alrededor del cilindro de gases.
  g.add(kit.extrudeSide([[0.004, -0.014], [0.215, -0.014], [0.222, -0.024], [0.222, -0.046], [0.212, -0.054], [0.004, -0.054]], 0.052, B, { bevel: 0.004 }));
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      g.add(sbox(kit, 0.0016, 0.020, 0.024, P.groove, { at: [s * 0.0262, 0.030 + i * 0.031, -0.034] }));
    }
  }
  // Escudo térmico perforado sobre el cañón.
  g.add(revolve(kit, [[0.0225, 0.060], [0.0225, 0.300]], S, { arcDeg: 150, arcStartDeg: -75, segments: 12, axis: 'y', creaseDeg: 80 }));
  g.add(revolve(kit, [[0.0215, 0.300], [0.0215, 0.060]], S, { arcDeg: 150, arcStartDeg: -75, segments: 12, axis: 'y', creaseDeg: 80 }));
  for (let i = 0; i < 9; i++) {
    for (const a of [-40, 0, 40]) {
      const hg = kit.group({ rotDeg: [0, a, 0], at: [0, 0.080 + i * 0.026, 0] });
      hg.add(kit.cyl(0.0042, 0.0042, 0.0012, P.hole, { axis: 'z', at: [0, 0, 0.0229], segments: 10 }));
      g.add(hg);
    }
  }
  // Mira delantera alta sobre el bloque de gases.
  g.add(kit.extrudeSide([[0.438, 0.010], [0.462, 0.010], [0.458, 0.052], [0.442, 0.052]], 0.012, S, { bevel: 0.0015 }));
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([[0.440, 0.040], [0.460, 0.040], [0.460, 0.074], [0.455, 0.080], [0.445, 0.080], [0.440, 0.074]], 0.003, S, { at: [s * 0.009, 0, 0], bevel: 0.0005 }));
  }
  g.add(kit.cyl(0.0014, 0.0014, 0.022, S, { axis: 'z', at: [0, 0.450, 0.064], segments: 8 }));
  // Apagallamas cónico ranurado.
  g.add(revolve(kit, [[0.0118, 0.500], [0.0125, 0.505], [0.0160, 0.578], [0.0150, 0.580], [0.0085, 0.580], [0.0085, 0.575], [0, 0.575]], S, { segments: 22 }));
  for (let k = 0; k < 6; k++) {
    const sg = kit.group({ rotDeg: [0, k * 60 + 30, 0], at: [0, 0.548, 0] });
    sg.add(sbox(kit, 0.0034, 0.050, 0.004, P.hole, { at: [0, 0, 0.0128], rotDeg: [-2.6, 0, 0] }));
    g.add(sg);
  }
  // Bípode plegado hacia atrás bajo el cilindro de gases.
  g.add(sbox(kit, 0.034, 0.020, 0.014, S, { at: [0, 0.440, -0.050], bevel: 0.003 }));
  for (const s of [-1, 1]) {
    g.add(kit.tube([[s * 0.012, 0.436, -0.052], [s * 0.016, 0.300, -0.050], [s * 0.017, 0.140, -0.048]], 0.0055, S, { segments: 10 }));
    g.add(sbox(kit, 0.010, 0.024, 0.010, S, { at: [s * 0.017, 0.130, -0.048], bevel: 0.002 }));
  }

  // ---- Visor M145 (MGO) sobre el raíl de la tapa ------------------------------
  const OZ = 0.118;
  g.add(sbox(kit, 0.032, 0.090, 0.016, B, { at: [0, -0.115, 0.084], bevel: 0.003 }));
  g.add(sbox(kit, 0.018, 0.070, 0.020, B, { at: [0, -0.115, 0.098], bevel: 0.003 }));
  for (const yy of [-0.140, -0.090]) {
    g.add(sbox(kit, 0.012, 0.010, 0.016, S, { at: [0.022, yy, 0.084], bevel: 0.002 }));
  }
  g.add(revolve(kit, [
    [0.0, -0.215], [0.0175, -0.215], [0.0185, -0.205], [0.0170, -0.190], [0.0185, -0.150],
    [0.0215, -0.110], [0.0215, -0.060], [0.0230, -0.050], [0.0230, -0.010], [0.0, -0.010],
  ], B, { at: [0, 0, OZ], segments: 26 }));
  g.add(revolve(kit, [[0.016, -0.235], [0.0195, -0.233], [0.0195, -0.212], [0.016, -0.212]], kit.rubber(), { at: [0, 0, OZ], segments: 22 }));
  g.add(kit.cyl(0.0185, 0.0185, 0.001, P.glass, { at: [0, -0.0095, OZ], segments: 22 }));
  g.add(sbox(kit, 0.046, 0.050, 0.036, B, { at: [0, -0.110, OZ], bevel: 0.006 }));
  g.add(kit.cyl(0.009, 0.009, 0.012, B, { axis: 'z', at: [0, -0.110, OZ + 0.022], segments: 14 }));
  g.add(kit.cyl(0.009, 0.009, 0.012, B, { axis: 'x', at: [0.028, -0.110, OZ], segments: 14 }));

  const moving = g;
  return {
    fixed, moving,
    muzzle: new THREE.Vector3(0, 0.580, 0),
    frontMount: new THREE.Vector3(0, -0.030, -0.058),
    rearMount: new THREE.Vector3(0, -0.300, -0.070),
  };
}

// ============================================================================
//  Ametralladora pesada M2HB / M2A1 (.50 BMG): cajón remachado con tapa del
//  alimentador, soporte del cañón perforado, cañón pesado QCB con asa,
//  apagallamas, alza de hoja, palanca de carga derecha, placa trasera con
//  asideros de pala y disparador de mariposa.
//  Coordenadas: y = 0 en la cara delantera del cajón, ánima z = 0.
//  Asideros en y ≈ −0.585, boca en y ≈ +1.070 => 1655 mm. Cañón 1143 mm.
// ============================================================================
export function buildM2Body(kit: ModelKit, P: SmallPalette): MgBody & { feedLeft: THREE.Vector3 } {
  const fixed = kit.group({ name: 'm2-fixed' });
  const moving = kit.group({ name: 'm2-barrel' });
  const S = P.parkGreen, D = P.park;
  const HW = 0.070;              // semiancho del cajón
  const ZB = -0.095, ZT = 0.055; // suelo / techo de las placas laterales
  const RY = -0.445;             // cara trasera del cajón

  // ---- Cajón ------------------------------------------------------------------
  fixed.add(kit.extrudeSide([
    [RY, ZB + 0.01], [RY, ZT], [-0.004, ZT], [0, ZT - 0.006], [0, ZB + 0.012], [-0.012, ZB], [RY + 0.012, ZB],
  ], 2 * HW, S, { bevel: 0.003 }));
  // Bloque del muñón (delante, abajo) y placa inferior.
  fixed.add(sbox(kit, 2 * HW + 0.006, 0.075, 0.07, S, { at: [0, -0.042, ZB + 0.032], bevel: 0.004 }));
  fixed.add(sbox(kit, 0.05, 0.05, 0.022, D, { at: [0, -0.06, ZB - 0.009], bevel: 0.003 }));
  fixed.add(sbox(kit, 0.05, 0.05, 0.022, D, { at: [0, RY + 0.03, ZB - 0.009], bevel: 0.003 }));
  // Remaches de las placas laterales.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      for (const z of [ZB + 0.012, ZT - 0.01]) {
        fixed.add(kit.cyl(0.0042, 0.0036, 0.003, D, { axis: 'x', at: [s * (HW + 0.0012), RY + 0.025 + i * 0.049, z], segments: 8 }));
      }
    }
    for (const [y, z] of [[-0.025, -0.02], [-0.06, -0.02], [-0.025, -0.06], [-0.06, -0.06], [-0.30, -0.035], [-0.36, -0.035]] as const) {
      fixed.add(kit.cyl(0.0055, 0.0048, 0.0035, D, { axis: 'x', at: [s * (HW + 0.0015), y, z], segments: 10 }));
    }
  }
  // Tapa del alimentador (abisagrada delante) con su pestillo.
  fixed.add(kit.extrudeSide([
    [-0.300, ZT], [-0.300, ZT + 0.022], [-0.290, ZT + 0.030], [-0.050, ZT + 0.030], [-0.030, ZT + 0.018], [-0.030, ZT],
  ], 2 * HW - 0.01, S, { bevel: 0.003 }));
  fixed.add(sbox(kit, 2 * HW - 0.03, 0.18, 0.004, D, { at: [0, -0.175, ZT + 0.031], bevel: 0.0015 }));
  fixed.add(kit.cyl(0.008, 0.008, 2 * HW, D, { axis: 'x', at: [0, -0.04, ZT + 0.012], segments: 12 }));
  fixed.add(sbox(kit, 0.03, 0.02, 0.02, D, { at: [0, -0.31, ZT + 0.016], bevel: 0.003 }));
  // Ventana de alimentación (izquierda) con guía de cinta y retén.
  fixed.add(sbox(kit, 0.004, 0.10, 0.04, P.hole, { at: [-(HW + 0.001), -0.165, 0.018] }));
  fixed.add(sbox(kit, 0.03, 0.11, 0.008, D, { at: [-(HW + 0.014), -0.165, -0.006], bevel: 0.002 }));
  fixed.add(sbox(kit, 0.03, 0.11, 0.006, D, { at: [-(HW + 0.014), -0.165, 0.042], bevel: 0.002 }));
  fixed.add(sbox(kit, 0.004, 0.10, 0.04, P.hole, { at: [HW + 0.001, -0.165, 0.018] }));
  // Palanca de carga (corredera de retroceso) a la derecha.
  fixed.add(sbox(kit, 0.012, 0.30, 0.03, D, { at: [HW + 0.008, -0.20, -0.025], bevel: 0.003 }));
  fixed.add(sbox(kit, 0.016, 0.03, 0.04, D, { at: [HW + 0.02, -0.33, -0.025], bevel: 0.004 }));
  fixed.add(revolve(kit, [[0, 0.0], [0.009, 0.0], [0.011, 0.012], [0.011, 0.07], [0.013, 0.08], [0, 0.08]], P.blackPoly, { axis: 'x', at: [HW + 0.024, -0.33, -0.025], segments: 14 }));
  // Alza de hoja (levantada) sobre el cajón, atrás.
  fixed.add(sbox(kit, 0.05, 0.05, 0.012, D, { at: [0, -0.395, ZT + 0.006], bevel: 0.002 }));
  for (const s of [-1, 1]) fixed.add(sbox(kit, 0.004, 0.012, 0.085, D, { at: [s * 0.012, -0.40, ZT + 0.05], rotDeg: [-8, 0, 0], bevel: 0.001 }));
  fixed.add(sbox(kit, 0.03, 0.01, 0.012, D, { at: [0, -0.403, ZT + 0.06], rotDeg: [-8, 0, 0], bevel: 0.002 }));
  fixed.add(sbox(kit, 0.028, 0.008, 0.006, D, { at: [0, -0.408, ZT + 0.094], rotDeg: [-8, 0, 0], bevel: 0.001 }));

  // ---- Placa trasera, asideros de pala y disparador de mariposa ---------------
  fixed.add(sbox(kit, 2 * HW + 0.004, 0.028, ZT - ZB + 0.004, S, { at: [0, RY - 0.014, (ZT + ZB) / 2], bevel: 0.005 }));
  const grip = kit.polymer(0x2b2620);
  for (const s of [-1, 1]) {
    fixed.add(kit.extrudeSide([
      [RY - 0.02, -0.005], [RY - 0.10, -0.005], [RY - 0.12, -0.02], [RY - 0.12, -0.075], [RY - 0.10, -0.09],
      [RY - 0.02, -0.09], [RY - 0.02, -0.075], [RY - 0.095, -0.075], [RY - 0.105, -0.07], [RY - 0.105, -0.025],
      [RY - 0.095, -0.02], [RY - 0.02, -0.02],
    ], 0.016, S, { at: [s * 0.052, 0, 0], bevel: 0.002 }));
    fixed.add(revolve(kit, [[0, -0.088], [0.012, -0.086], [0.0135, -0.075], [0.0135, -0.022], [0.012, -0.009], [0, -0.007]], grip, { axis: 'z', at: [s * 0.052, RY - 0.112, 0], segments: 16 }));
  }
  fixed.add(sbox(kit, 0.07, 0.012, 0.03, D, { at: [0, RY - 0.035, -0.045], bevel: 0.004 }));
  fixed.add(sbox(kit, 0.012, 0.03, 0.012, D, { at: [0, RY - 0.04, ZT - 0.005], bevel: 0.002 }));

  // ---- Soporte del cañón perforado (manguito delantero) ------------------------
  fixed.add(revolve(kit, [
    [0.0, -0.004], [0.050, -0.004], [0.050, 0.012], [0.045, 0.018], [0.045, 0.150], [0.036, 0.165], [0.026, 0.165], [0.026, 0.150],
  ], S, { segments: 28 }));
  for (const a of [90, 270, 30, 150, 210, 330]) {
    for (const y of [0.045, 0.085, 0.125]) {
      if ((a === 30 || a === 150 || a === 210 || a === 330) && y === 0.085) continue;
      const hg = kit.group({ rotDeg: [0, a, 0], at: [0, y, 0] });
      hg.add(kit.cyl(0.0125, 0.0125, 0.003, P.hole, { axis: 'z', at: [0, 0, 0.0445], segments: 16 }));
      hg.add(kit.torus(0.0128, 0.0018, S, { axis: 'z', at: [0, 0, 0.0452], segments: 16 }));
      fixed.add(hg);
    }
  }
  // Mira delantera sobre el soporte.
  fixed.add(kit.extrudeSide([[0.100, 0.040], [0.150, 0.040], [0.146, 0.058], [0.106, 0.058]], 0.03, D, { bevel: 0.002 }));
  for (const s of [-1, 1]) fixed.add(kit.extrudeSide([[0.115, 0.055], [0.140, 0.055], [0.138, 0.084], [0.117, 0.084]], 0.004, D, { at: [s * 0.012, 0, 0], bevel: 0.001 }));
  fixed.add(sbox(kit, 0.003, 0.012, 0.03, D, { at: [0, 0.128, 0.072] }));

  // ---- Cañón pesado (retrocede), asa QCB y apagallamas ------------------------
  moving.add(revolve(kit, [
    [0.0, -0.12], [0.026, -0.12], [0.026, 0.150], [0.0235, 0.160], [0.0228, 0.30], [0.0215, 0.70],
    [0.0205, 1.00], [0.0198, 1.012], [0, 1.012],
  ], D, { segments: 24 }));
  // Abrazadera del asa y asa de transporte (izquierda, inclinada).
  moving.add(revolve(kit, [[0, 0.245], [0.029, 0.245], [0.031, 0.25], [0.031, 0.29], [0.029, 0.295], [0, 0.295]], S, { segments: 22 }));
  moving.add(sbox(kit, 0.02, 0.04, 0.03, S, { at: [-0.028, 0.27, 0.02], rotDeg: [0, -35, 0], bevel: 0.003 }));
  moving.add(kit.tube([[-0.04, 0.27, 0.035], [-0.075, 0.27, 0.08], [-0.085, 0.27, 0.13], [-0.075, 0.27, 0.15]], 0.006, S, { segments: 18 }));
  moving.add(revolve(kit, [[0, 0.0], [0.012, 0.0], [0.014, 0.012], [0.014, 0.105], [0.012, 0.117], [0, 0.117]], P.blackPoly, {
    at: [-0.081, 0.27 - 0.058, 0.15], segments: 14,
  }));
  moving.add(kit.cyl(0.006, 0.006, 0.12, S, { at: [-0.081, 0.27, 0.15], segments: 10 }));
  // Apagallamas cónico (M2A1).
  moving.add(revolve(kit, [
    [0.0198, 1.000], [0.024, 1.004], [0.024, 1.016], [0.031, 1.064], [0.031, 1.070], [0.0225, 1.070], [0.0225, 1.064], [0, 1.064],
  ], D, { segments: 24 }));
  moving.add(kit.cyl(0.0068, 0.0068, 0.001, P.hole, { at: [0, 1.0645, 0], segments: 14 }));

  return {
    fixed, moving,
    muzzle: new THREE.Vector3(0, 1.070, 0),
    frontMount: new THREE.Vector3(0, -0.060, -0.108),
    rearMount: new THREE.Vector3(0, RY + 0.03, -0.108),
    feedLeft: new THREE.Vector3(-(HW + 0.004), -0.165, 0.018),
  };
}
