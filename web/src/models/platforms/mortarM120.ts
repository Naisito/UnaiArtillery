// ============================================================================
//  mortarM120.ts — Mortero M120/M121 120 mm (sistema remolcado/en tierra).
//  [V2 · 3D-TRACKED]
//
//  Referencias públicas (TM 9-1015-250-10, GlobalSecurity, Soltam K6):
//  tubo M298 de 1.758 m (50 kg) con dispositivo atenuador de rebufo (BAD) en
//  la boca y tapón de culata con rótula; placa base M9 circular (62 kg) con
//  alojamiento giratorio 360°; bípode M191 (32 kg): dos patas con cable de
//  separación, mecanismo de nivelación lateral en la pata izquierda,
//  columna de elevación con manivela, mecanismo de dirección (husillo
//  horizontal con volante), dos amortiguadores paralelos al tubo unidos por
//  la abrazadera; aparato de puntería M67 en el soporte izquierdo del yugo.
//  Elevación 45…85° (800-1511 mil); traverse del bípode ±5° (aquí: el arma
//  ENTERA gira sobre la placa base para cualquier azimut).
//
//  Rig: root ⊇ [placa base (fija) + munición a pie de pieza] + traverse
//  (tubo + bípode, gira sobre el alojamiento de la placa) ⊇ elevation (rótula
//  del tubo) ⊇ recoil (tubo, culata, BAD; carrera 3 cm). El BÍPODE sigue al
//  tubo en animate(): todo el bípode se desplaza en Y bajo el yugo (la
//  dotación lo recoloca al cambiar de banda de elevación) y la columna de
//  elevación se extiende en Z — la columna queda siempre vertical.
// ============================================================================
import * as THREE from 'three';
import { PAINT } from '../kit';
import type { PlatformBuilder, RigAnimState } from '../rig';
import { bakeStatic, keep, latheCrisp, rod } from '../parts/tracked-geo';

/** Altura del centro de la rótula del tubo sobre el suelo. */
const BALL_Z = 0.14;
/** Distancia (a lo largo del tubo) de la rótula a la abrazadera. */
const CLAMP_D = 1.05;
/** Yugo (pivote del bípode) en coordenadas del tubo: detrás y debajo de la abrazadera. */
const YOKE = { y: CLAMP_D - 0.12, z: -0.15 };
/** Altura de la articulación de las patas y separación de los pies. */
const LEG = { hingeZ: 0.42, footX: 0.46, footY: 0.22 };
/** Boca del BAD (cara delantera), en coordenadas del tubo. */
const MUZZLE = 1.84;

export const buildMortarM120: PlatformBuilder = (ctx) => {
  const { kit } = ctx;
  const root = new THREE.Group();
  root.name = 'mortar-m120';

  const paint = kit.paint(PAINT.carcGreen);
  const paintDark = kit.paint(0x3c4220, { roughness: 0.6 });
  const steel = kit.steel();
  const black = kit.polymer(0x0b0c0d);
  const alu = kit.paint(PAINT.olive, { roughness: 0.68, metalness: 0.35 });

  // ===========================================================================
  //  PLACA BASE M9 (fija en el suelo, no gira con el arma)
  // ===========================================================================
  const base = kit.group({ name: 'baseplate' });
  root.add(base);
  base.add(latheCrisp(kit, [
    [0, -0.02], [0.43, -0.02], [0.44, 0.0], [0.44, 0.03], [0.42, 0.045], [0.33, 0.06],
    [0.15, 0.1], [0.13, 0.13], [0.09, 0.135], [0.07, 0.12], [0, 0.12],
  ], alu, { axis: 'z', segments: 48 }));
  // Nervios radiales sobre el cono.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const g = kit.group({ rotDeg: [0, 0, a * 180 / Math.PI] });
    g.add(kit.box(0.03, 0.27, 0.04, alu, { at: [0, 0.27, 0.085], rotDeg: [-12, 0, 0], bevel: 0.008 }));
    base.add(g);
  }
  // Anillo de bloqueo del alojamiento (gira con la pieza en la realidad).
  base.add(latheCrisp(kit, [[0.055, 0.12], [0.1, 0.12], [0.1, 0.16], [0.085, 0.17], [0.055, 0.17]], steel, { axis: 'z', segments: 28 }));
  // Asas de transporte (cuatro).
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a), s = Math.sin(a);
    const p0: [number, number, number] = [c * 0.36 - s * 0.08, s * 0.36 + c * 0.08, 0.06];
    const p1: [number, number, number] = [c * 0.36 + s * 0.08, s * 0.36 - c * 0.08, 0.06];
    const m0: [number, number, number] = [c * 0.47 - s * 0.08, s * 0.47 + c * 0.08, 0.08];
    const m1: [number, number, number] = [c * 0.47 + s * 0.08, s * 0.47 - c * 0.08, 0.08];
    base.add(rod(kit, p0, m0, 0.012, steel), rod(kit, m0, m1, 0.012, steel), rod(kit, m1, p1, 0.012, steel));
  }
  // Tierra removida alrededor (asentamiento de la placa).
  base.add(latheCrisp(kit, [[0.4, -0.02], [0.64, -0.02], [0.6, 0.004], [0.5, 0.022], [0.42, 0.028], [0.4, 0.028]], kit.canvas(0x5a5140), { axis: 'z', segments: 40 }));

  // Munición a pie de pieza: caja con contenedores y dos granadas listas.
  {
    const ammo = kit.group({ at: [0.95, -0.55, 0], rotDeg: [0, 0, 12] });
    root.add(ammo);
    const crate = kit.paint(0x4d5232, { roughness: 0.85 });
    ammo.add(kit.box(0.55, 0.95, 0.26, crate, { at: [0, 0, 0.13], bevel: 0.015 }));
    ammo.add(kit.box(0.57, 0.97, 0.03, crate, { at: [0, 0, 0.255], bevel: 0.008 }));
    for (const y of [-0.3, 0.3]) ammo.add(kit.box(0.6, 0.05, 0.05, crate, { at: [0, y, 0.2] }));
    const tubeMat = kit.polymer(0x2e3324);
    for (const x of [-0.17, 0, 0.17]) {
      ammo.add(kit.cyl(0.075, 0.075, 0.86, tubeMat, { at: [x, 0, 0.35], segments: 16 }));
      ammo.add(kit.cyl(0.08, 0.08, 0.05, black, { at: [x, 0.44, 0.35], segments: 16 }));
    }
    // Granadas M934A1 (verde oliva con banda amarilla, espoleta, cola).
    const od = kit.paint(0x4a5236, { roughness: 0.5 });
    const yellow = kit.paint(0xc9a227, { roughness: 0.5 });
    const fuze = kit.steel(0x55585a, { roughness: 0.4 });
    for (const [x, yaw] of [[-0.12, 85], [0.14, 95]] as const) {
      const r = kit.group({ at: [x - 0.75, 0.1, 0.06], rotDeg: [0, 0, yaw] });
      r.add(latheCrisp(kit, [
        [0, -0.3], [0.028, -0.3], [0.028, -0.05], [0.04, -0.02], [0.06, 0.04], [0.06, 0.2], [0.045, 0.3], [0.0, 0.3],
      ], od, { segments: 18 }));
      r.add(kit.cyl(0.061, 0.061, 0.03, yellow, { at: [0, 0.12, 0], segments: 18 }));
      r.add(latheCrisp(kit, [[0, 0.29], [0.045, 0.29], [0.03, 0.38], [0.012, 0.42], [0, 0.42]], fuze, { segments: 14 }));
      for (let k = 0; k < 4; k++) {
        const f = kit.group({ rotDeg: [0, k * 90 + 45, 0] });
        f.add(kit.box(0.004, 0.09, 0.05, od, { at: [0, -0.27, 0.05] }));
        r.add(f);
      }
      // Cargas propulsoras (incrementos) alrededor del tubo de cola.
      r.add(kit.cyl(0.045, 0.045, 0.12, kit.canvas(0x9a8a5a), { at: [0, -0.14, 0], segments: 14 }));
      ammo.add(r);
    }
  }

  // ===========================================================================
  //  ARMA (traverse): tubo + bípode
  // ===========================================================================
  const traverse = kit.group({ name: 'traverse' });
  root.add(traverse);

  const elevation = keep(kit.group({ name: 'elevation', at: [0, 0, BALL_Z] }));
  traverse.add(elevation);
  // Abrazadera del tubo (collar) + amortiguadores + bloque del yugo: giran
  // con el tubo pero no retroceden (el tubo desliza en la abrazadera).
  elevation.add(latheCrisp(kit, [
    [0.077, CLAMP_D - 0.06], [0.1, CLAMP_D - 0.06], [0.106, CLAMP_D - 0.04], [0.106, CLAMP_D + 0.04],
    [0.1, CLAMP_D + 0.06], [0.077, CLAMP_D + 0.06],
  ], paintDark, { segments: 28 }));
  elevation.add(kit.box(0.05, 0.08, 0.06, paintDark, { at: [0.12, CLAMP_D, 0.04], bevel: 0.01 }));
  elevation.add(rod(kit, [0.13, CLAMP_D, 0.07], [0.2, CLAMP_D, 0.13], 0.012, steel));
  for (const s of [-1, 1]) {
    const x = s * 0.085;
    // Cuerpo del amortiguador, muelle visible y vástago.
    elevation.add(kit.cyl(0.032, 0.032, 0.24, paintDark, { at: [x, CLAMP_D - 0.2, -0.095], segments: 14 }));
    for (let k = 0; k < 5; k++) elevation.add(kit.torus(0.036, 0.006, steel, { at: [x, CLAMP_D - 0.06 + k * 0.022, -0.095], segments: 12 }));
    elevation.add(kit.cyl(0.014, 0.014, 0.14, steel, { at: [x, CLAMP_D - 0.03, -0.095], segments: 8 }));
    // Orejeta que une el amortiguador con la abrazadera.
    elevation.add(kit.box(0.03, 0.05, 0.08, paintDark, { at: [x, CLAMP_D + 0.03, -0.06] }));
  }
  // Bloque del yugo (une los amortiguadores con el husillo de dirección).
  elevation.add(kit.box(0.22, 0.09, 0.08, paintDark, { at: [0, YOKE.y - 0.02, YOKE.z + 0.04], bevel: 0.012 }));
  elevation.add(kit.cyl(0.03, 0.03, 0.26, steel, { axis: 'x', at: [0, YOKE.y, YOKE.z], segments: 12 }));

  const recoil = keep(kit.group({ name: 'recoil' }));
  elevation.add(recoil);
  // Tubo M298 con tapón de culata y rótula.
  recoil.add(latheCrisp(kit, [
    [0, -0.05], [0.026, -0.045], [0.042, -0.028], [0.05, 0.0], [0.046, 0.018], [0.07, 0.02],
    [0.088, 0.04], [0.088, 0.15], [0.083, 0.165], [0.083, 0.6], [0.075, 0.75], [0.075, 1.6], [0.0, 1.6],
  ], paint, { segments: 32 }));
  // Moleteado/anillo del tapón de culata.
  recoil.add(kit.torus(0.089, 0.008, paint, { at: [0, 0.09, 0], segments: 28 }));
  // Marcas de anillo (franjas de referencia) del tubo.
  for (const y of [0.62, 1.3]) recoil.add(kit.torus(0.076, 0.004, paintDark, { at: [0, y, 0], segments: 28 }));
  // Dispositivo atenuador de rebufo (BAD) en la boca.
  recoil.add(latheCrisp(kit, [
    [0.075, 1.58], [0.099, 1.6], [0.099, 1.69], [0.094, 1.7], [0.094, 1.74], [0.099, 1.75],
    [0.099, 1.8], [0.105, 1.81], [0.105, MUZZLE], [0.062, MUZZLE], [0.062, 1.66], [0, 1.66],
  ], paintDark, { segments: 32 }));
  recoil.add(kit.cyl(0.06, 0.06, 0.01, black, { at: [0, 1.67, 0], segments: 20 }));
  // Tornillos de fijación del BAD.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    recoil.add(kit.cyl(0.011, 0.011, 0.016, steel, { axis: 'x', at: [Math.cos(a) * 0.1, 1.645, Math.sin(a) * 0.1], rotDeg: [0, 0, 0], segments: 6 }));
  }

  // ---------------------------------------------------------------------------
  //  Bípode M191 (se recoloca en animate())
  // ---------------------------------------------------------------------------
  const bipod = keep(kit.group({ name: 'bipod' }));
  traverse.add(bipod);
  const H: [number, number, number] = [0, 0, LEG.hingeZ];
  // Patas tubulares con pies de pica.
  for (const s of [-1, 1]) {
    const foot: [number, number, number] = [s * LEG.footX, LEG.footY, 0.03];
    bipod.add(rod(kit, [s * 0.05, 0, LEG.hingeZ], foot, 0.028, paint, 10));
    bipod.add(kit.box(0.09, 0.12, 0.02, paint, { at: [foot[0], foot[1], 0.012], bevel: 0.005 }));
    bipod.add(kit.cyl(0.012, 0.004, 0.08, steel, { axis: 'z', at: [foot[0], foot[1], -0.02], segments: 6 }));
    // Collar de la articulación.
    bipod.add(kit.cyl(0.032, 0.032, 0.07, paintDark, { axis: 'x', at: [s * 0.06, 0, LEG.hingeZ], segments: 12 }));
  }
  // Cable/cadena de separación entre patas (a media altura).
  {
    const t = 0.55;
    const a: [number, number, number] = [-0.05 + (-LEG.footX + 0.05) * t, LEG.footY * t, LEG.hingeZ + (0.03 - LEG.hingeZ) * t];
    const b: [number, number, number] = [-a[0], a[1], a[2]];
    bipod.add(rod(kit, a, b, 0.006, steel, 6));
  }
  // Mecanismo de nivelación lateral (pata izquierda): manguito y pomo.
  {
    const t = 0.25;
    const p: [number, number, number] = [-0.05 + (-LEG.footX + 0.05) * t, LEG.footY * t, LEG.hingeZ + (0.03 - LEG.hingeZ) * t];
    bipod.add(kit.cyl(0.035, 0.035, 0.12, paintDark, { at: p, segments: 12, rotDeg: [0, 0, 0] }));
    bipod.add(rod(kit, p, [p[0] - 0.12, p[1] - 0.02, p[2]], 0.01, steel));
    bipod.add(kit.sphere(0.022, black, { at: [p[0] - 0.13, p[1] - 0.02, p[2]], segments: 10 }));
  }
  // Caja de engranajes de elevación con manivela (lado derecho).
  bipod.add(kit.box(0.12, 0.11, 0.13, paintDark, { at: [H[0], H[1], LEG.hingeZ - 0.04], bevel: 0.015 }));
  bipod.add(rod(kit, [0.06, 0, LEG.hingeZ - 0.06], [0.16, 0, LEG.hingeZ - 0.06], 0.01, steel));
  bipod.add(rod(kit, [0.16, 0, LEG.hingeZ - 0.06], [0.16, -0.1, LEG.hingeZ - 0.06], 0.01, steel));
  bipod.add(kit.cyl(0.014, 0.014, 0.07, black, { axis: 'x', at: [0.19, -0.1, LEG.hingeZ - 0.06], segments: 8 }));
  // Cuerpo de la columna de elevación (fijo) — el husillo sale por arriba.
  bipod.add(kit.cyl(0.05, 0.05, 0.3, paint, { axis: 'z', at: [0, 0, LEG.hingeZ + 0.15], segments: 16 }));
  bipod.add(kit.cyl(0.057, 0.057, 0.035, paintDark, { axis: 'z', at: [0, 0, LEG.hingeZ + 0.3], segments: 16 }));

  // Parte alta (sube con el husillo): husillo, yugo, dirección, visor M67.
  const top = keep(kit.group({ name: 'bipod-top' }));
  bipod.add(top);
  top.add(kit.cyl(0.032, 0.032, 0.5, steel, { axis: 'z', at: [0, 0, -0.25], segments: 12 }));
  // Husillo de dirección (horizontal, a lo largo de X) con su carcasa.
  top.add(kit.cyl(0.042, 0.042, 0.46, paint, { axis: 'x', at: [0, 0, 0], segments: 14 }));
  top.add(kit.box(0.12, 0.11, 0.1, paintDark, { at: [0, 0, -0.035], bevel: 0.014 }));
  // Volante de dirección (derecha).
  top.add(kit.torus(0.075, 0.009, black, { axis: 'x', at: [0.27, 0, 0], segments: 20 }));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    top.add(rod(kit, [0.27, 0, 0], [0.27, Math.cos(a) * 0.072, Math.sin(a) * 0.072], 0.006, steel, 6));
  }
  top.add(rod(kit, [0.21, 0, 0], [0.27, 0, 0], 0.012, steel));
  top.add(kit.cyl(0.01, 0.01, 0.05, black, { axis: 'x', at: [0.3, 0, 0.07], segments: 6 }));
  // Soporte del visor (izquierda) y aparato de puntería M67.
  top.add(kit.box(0.06, 0.08, 0.12, paintDark, { at: [-0.24, 0, 0.04], bevel: 0.01 }));
  {
    const sight = kit.group({ at: [-0.28, -0.02, 0.12] });
    const sm = kit.paint(0x2f3420, { roughness: 0.55 });
    sight.add(kit.box(0.07, 0.12, 0.1, sm, { at: [0, 0, 0], bevel: 0.012 }));
    sight.add(kit.cyl(0.025, 0.025, 0.2, sm, { at: [0, 0.05, 0.08], segments: 12, rotDeg: [10, 0, 0] }));
    sight.add(kit.cyl(0.02, 0.02, 0.12, sm, { at: [-0.01, -0.11, 0.03], segments: 10, rotDeg: [-25, 0, 0] }));
    sight.add(kit.cyl(0.026, 0.026, 0.04, black, { at: [-0.01, -0.18, 0.0], segments: 10, rotDeg: [-25, 0, 0] }));
    sight.add(kit.cyl(0.02, 0.02, 0.008, kit.glass(), { at: [0, 0.155, 0.098], segments: 10, rotDeg: [10, 0, 0] }));
    // Luz de retícula (tritio, verde tenue).
    sight.add(kit.box(0.015, 0.015, 0.015, kit.emissive(0x66ff88, 0.4), { at: [0.04, -0.03, 0.03] }));
    top.add(sight);
  }

  // ===========================================================================
  //  Animación: el bípode sigue al tubo.
  // ===========================================================================
  const animate = (state: RigAnimState): void => {
    const el = THREE.MathUtils.clamp(state.elevationDeg, 0, 89) * Math.PI / 180;
    const c = Math.cos(el), s = Math.sin(el);
    // Yugo en coordenadas de traverse.
    const yy = YOKE.y * c - YOKE.z * s;
    const yz = BALL_Z + YOKE.y * s + YOKE.z * c;
    bipod.position.set(0, yy, 0);
    // Extensión de la columna, limitada a la carrera del husillo.
    top.position.set(0, 0, THREE.MathUtils.clamp(yz, LEG.hingeZ + 0.2, LEG.hingeZ + 0.8));
  };
  animate({ t: 0, dt: 0, azimuthDeg: 0, elevationDeg: 65, recoil01: 0, sinceFireS: Infinity });

  bakeStatic(kit, recoil);
  bakeStatic(kit, elevation);
  bakeStatic(kit, top);
  bakeStatic(kit, bipod);
  bakeStatic(kit, base);
  const ammo = root.children.find((o) => o !== base && o !== traverse);
  if (ammo) bakeStatic(kit, ammo);

  return {
    root, traverse, elevation, recoil,
    muzzleLocal: new THREE.Vector3(0, MUZZLE, 0),
    recoilStrokeM: 0.03,
    footprintM: 1.4,
    heightM: 1.85,
    extraAnimated: [bipod, top],
    animate,
  };
};
