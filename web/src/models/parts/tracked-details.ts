// ============================================================================
//  parts/tracked-details.ts — Accesorios de vehículo blindado reutilizables
//  (agente 3D-TRACKED): faros con protector, pilotos, ganchos de remolque,
//  argollas, asideros, escotillas, periscopios, rejillas, lanzagranadas
//  fumígenos, antenas, bidones, petates, ametralladora M2, herramientas…
//
//  Convención: todas las funciones AÑADEN mallas a `parent` en coordenadas
//  del padre (X derecha, Y adelante, Z arriba). Las piezas son pequeñas: el
//  builder llama a bakeStatic() al final para fusionarlas por material.
// ============================================================================
import * as THREE from 'three';
import type { ModelKit, V3 } from '../kit';
import { PAINT } from '../kit';
import { latheCrisp, lowTorus, rod } from './tracked-geo';

type Obj = THREE.Object3D;

/** Grupo orientado: `yawDeg` gira sobre Z (0 = mirando a +Y). */
function frame(kit: ModelKit, parent: Obj, at: V3, yawDeg = 0, pitchDeg = 0): THREE.Group {
  const g = kit.group({ at, rotDeg: [0, 0, yawDeg] });
  parent.add(g);
  if (pitchDeg === 0) return g;
  // Cabeceo sobre el X YA girado (grupo anidado: sin ambigüedad de Euler).
  const p = kit.group({ rotDeg: [pitchDeg, 0, 0] });
  g.add(p);
  return p;
}

/**
 * Faro doble con carcasa y protector de varillas, mirando a +Y (o girado
 * con yawDeg). `at` = centro trasero de la carcasa.
 */
export function headlight(kit: ModelKit, parent: Obj, at: V3, paint: THREE.Material, yawDeg = 0): void {
  const g = frame(kit, parent, at, yawDeg);
  const dark = kit.steel(PAINT.gunmetal, { roughness: 0.6 });
  g.add(kit.box(0.30, 0.12, 0.16, paint, { at: [0, 0.06, 0.08], bevel: 0.015 }));
  for (const x of [-0.07, 0.07]) {
    g.add(kit.cyl(0.055, 0.055, 0.03, dark, { at: [x, 0.13, 0.085], segments: 16 }));
    g.add(kit.cyl(0.046, 0.046, 0.012, kit.glass(), { at: [x, 0.148, 0.085], segments: 16 }));
  }
  // Piloto de posición (ámbar) encima.
  g.add(kit.box(0.07, 0.03, 0.035, kit.emissive(0xffa020, 0.35), { at: [0, 0.125, 0.185] }));
  // Protector: dos arcos de varilla.
  for (const x of [-0.16, 0.16]) {
    g.add(rod(kit, [x, 0.0, 0.0], [x, 0.22, 0.05], 0.012, paint));
    g.add(rod(kit, [x, 0.22, 0.05], [x, 0.22, 0.22], 0.012, paint));
    g.add(rod(kit, [x, 0.22, 0.22], [x, 0.0, 0.25], 0.012, paint));
  }
  g.add(rod(kit, [-0.16, 0.22, 0.14], [0.16, 0.22, 0.14], 0.01, paint));
  g.add(rod(kit, [-0.16, 0.22, 0.22], [0.16, 0.22, 0.22], 0.01, paint));
}

/** Grupo de pilotos traseros (rojo + ámbar) con protector, mirando a −Y. */
export function tailLight(kit: ModelKit, parent: Obj, at: V3, paint: THREE.Material): void {
  const g = frame(kit, parent, at, 180);
  g.add(kit.box(0.2, 0.08, 0.14, paint, { at: [0, 0.04, 0.07], bevel: 0.01 }));
  g.add(kit.box(0.07, 0.02, 0.05, kit.emissive(0xff1a10, 0.5), { at: [-0.045, 0.085, 0.085] }));
  g.add(kit.box(0.07, 0.02, 0.05, kit.emissive(0xffa020, 0.35), { at: [0.045, 0.085, 0.085] }));
  for (const x of [-0.11, 0.11]) {
    g.add(rod(kit, [x, 0, 0], [x, 0.15, 0.03], 0.009, paint));
    g.add(rod(kit, [x, 0.15, 0.03], [x, 0.15, 0.15], 0.009, paint));
    g.add(rod(kit, [x, 0.15, 0.15], [x, 0, 0.17], 0.009, paint));
  }
}

/** Gancho de remolque abierto (mirando a +Y por defecto) sobre su soporte. */
export function towHook(kit: ModelKit, parent: Obj, at: V3, paint: THREE.Material, yawDeg = 0): void {
  const g = frame(kit, parent, at, yawDeg);
  const steel = kit.steel(PAINT.darkSteel, { roughness: 0.5 });
  g.add(kit.box(0.16, 0.08, 0.16, paint, { at: [0, 0.04, 0], bevel: 0.015 }));
  const hook = lowTorus(kit, 0.07, 0.022, steel, { axis: 'x', at: [0, 0.14, 0.0], segments: 12, sides: 6 });
  g.add(hook);
  g.add(kit.box(0.04, 0.08, 0.04, steel, { at: [0, 0.09, -0.05] }));
}

/** Argolla de izado/amarre (toro vertical) con su orejeta. */
export function liftEye(kit: ModelKit, parent: Obj, at: V3, mat: THREE.Material, yawDeg = 0, r = 0.045): void {
  const g = frame(kit, parent, at, yawDeg);
  g.add(kit.box(r * 1.6, 0.025, r * 0.9, mat, { at: [0, 0, r * 0.45] }));
  g.add(lowTorus(kit, r, r * 0.28, mat, { axis: 'y', at: [0, 0, r * 1.1], segments: 10 }));
}

/** Asidero en U entre dos puntos sobre una cara (normal `n`, saliente `h`). */
export function grabHandle(kit: ModelKit, parent: Obj, a: V3, b: V3, n: V3, mat: THREE.Material, h = 0.07, r = 0.012): void {
  const A2: V3 = [a[0] + n[0] * h, a[1] + n[1] * h, a[2] + n[2] * h];
  const B2: V3 = [b[0] + n[0] * h, b[1] + n[1] * h, b[2] + n[2] * h];
  parent.add(rod(kit, a, A2, r, mat), rod(kit, A2, B2, r, mat), rod(kit, B2, b, r, mat));
}

/** Bisagra de escotilla (cilindro con nudillos) a lo largo de X. */
export function hinge(kit: ModelKit, parent: Obj, at: V3, len: number, mat: THREE.Material, axis: 'x' | 'y' = 'x'): void {
  parent.add(kit.cyl(0.028, 0.028, len, mat, { axis, at, segments: 10 }));
  const n = 3;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * len * 0.8;
    const p: V3 = axis === 'x' ? [at[0] + t, at[1], at[2]] : [at[0], at[1] + t, at[2]];
    parent.add(kit.cyl(0.036, 0.036, len * 0.12, mat, { axis, at: p, segments: 10 }));
  }
}

/**
 * Escotilla circular (tapa con refuerzo y bisagra) sobre un plano
 * horizontal en `at` (z = superficie). Radio r.
 */
export function roundHatch(kit: ModelKit, parent: Obj, at: V3, r: number, paint: THREE.Material, hingeYaw = 0): void {
  const g = frame(kit, parent, at, hingeYaw);
  g.add(latheCrisp(kit, [
    [0, 0], [r * 1.12, 0], [r * 1.12, 0.035], [r * 1.0, 0.05], [r * 0.98, 0.07], [r * 0.6, 0.085], [0, 0.085],
  ], paint, { axis: 'z', segments: 28 }));
  g.add(kit.box(r * 1.2, 0.05, 0.03, paint, { at: [0, 0, 0.095], bevel: 0.01 }));
  hinge(kit, g, [0, -r * 1.05, 0.06], r * 0.9, paint);
  g.add(rod(kit, [-0.06, r * 0.55, 0.09], [0.06, r * 0.55, 0.09], 0.01, kit.steel()));
}

/** Escotilla rectangular plana con marco, bisagra trasera y asa. */
export function rectHatch(kit: ModelKit, parent: Obj, at: V3, w: number, d: number, paint: THREE.Material): void {
  parent.add(kit.box(w + 0.06, d + 0.06, 0.03, paint, { at: [at[0], at[1], at[2] + 0.015], bevel: 0.008 }));
  parent.add(kit.box(w, d, 0.05, paint, { at: [at[0], at[1], at[2] + 0.045], bevel: 0.012 }));
  hinge(kit, parent, [at[0], at[1] - d / 2 - 0.01, at[2] + 0.05], w * 0.8, paint);
  parent.add(rod(kit, [at[0] - 0.08, at[1] + d * 0.3, at[2] + 0.075], [at[0] + 0.08, at[1] + d * 0.3, at[2] + 0.075], 0.01, kit.steel()));
}

/** Periscopio de bloque (cabeza blindada + cristal) mirando según yawDeg. */
export function periscope(kit: ModelKit, parent: Obj, at: V3, paint: THREE.Material, yawDeg = 0, w = 0.2): void {
  const g = frame(kit, parent, at, yawDeg);
  g.add(kit.box(w, 0.12, 0.09, paint, { at: [0, 0, 0.045], bevel: 0.01 }));
  g.add(kit.box(w * 0.82, 0.01, 0.05, kit.glass(), { at: [0, 0.062, 0.05] }));
  g.add(kit.box(w * 1.08, 0.05, 0.015, paint, { at: [0, 0.045, 0.097] }));
}

/**
 * Rejilla de lamas inclinadas (ventilación/escape) en un plano: `at`
 * centro, normal hacia `yawDeg` (0 = +Y), w × h, n lamas. `up` para
 * rejillas horizontales (sobre cubierta: normal +Z).
 */
export function louverPanel(kit: ModelKit, parent: Obj, at: V3, w: number, h: number, n: number, paint: THREE.Material, opts: { yawDeg?: number; horizontal?: boolean } = {}): void {
  const g = frame(kit, parent, at, opts.yawDeg ?? 0, opts.horizontal ? -90 : 0);
  const dark = kit.polymer(0x101112);
  g.add(kit.box(w, 0.02, h, dark, { at: [0, -0.01, 0] }));
  // Marco.
  g.add(kit.box(w + 0.06, 0.04, 0.03, paint, { at: [0, 0.01, h / 2 + 0.015] }));
  g.add(kit.box(w + 0.06, 0.04, 0.03, paint, { at: [0, 0.01, -h / 2 - 0.015] }));
  g.add(kit.box(0.03, 0.04, h, paint, { at: [w / 2 + 0.015, 0.01, 0] }));
  g.add(kit.box(0.03, 0.04, h, paint, { at: [-w / 2 - 0.015, 0.01, 0] }));
  for (let i = 0; i < n; i++) {
    const z = -h / 2 + (i + 0.5) * (h / n);
    g.add(kit.box(w, 0.012, (h / n) * 1.05, paint, { at: [0, 0.012, z], rotDeg: [38, 0, 0] }));
  }
}

/**
 * Lanzagranadas fumígenos: banco de `n` tubos en abanico sobre una base,
 * mirando según yawDeg (0 = +Y) y elevados `elevDeg`.
 */
export function smokeLauncher(kit: ModelKit, parent: Obj, at: V3, yawDeg: number, paint: THREE.Material, n = 4, elevDeg = 35): void {
  const g = frame(kit, parent, at, yawDeg);
  const dark = kit.steel(PAINT.gunmetal, { roughness: 0.55 });
  g.add(kit.box(0.08 + n * 0.1, 0.16, 0.1, paint, { at: [0, 0, 0.05], bevel: 0.012 }));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.1;
    const yaw = (i - (n - 1) / 2) * 7;
    const t = kit.group({ at: [x, 0.02, 0.1], rotDeg: [elevDeg, 0, -yaw] });
    t.add(latheCrisp(kit, [[0, -0.02], [0.042, -0.02], [0.042, 0.2], [0.034, 0.2], [0.034, 0.17], [0, 0.17]], dark, { segments: 12, at: [0, 0, 0] }));
    t.add(kit.cyl(0.035, 0.035, 0.01, kit.polymer(0x2a2a20), { at: [0, 0.17, 0], segments: 12 }));
    g.add(t);
  }
}

/** Antena de látigo con base de muelle. Altura total `h`. */
export function whipAntenna(kit: ModelKit, parent: Obj, at: V3, h: number, paint: THREE.Material, tiltDeg: [number, number] = [0, 0]): void {
  const g = kit.group({ at, rotDeg: [tiltDeg[0], tiltDeg[1], 0] });
  parent.add(g);
  g.add(kit.cyl(0.06, 0.05, 0.08, paint, { axis: 'z', at: [0, 0, 0.04], segments: 12 }));
  g.add(kit.cyl(0.028, 0.028, 0.16, kit.polymer(), { axis: 'z', at: [0, 0, 0.16], segments: 10 }));
  g.add(kit.cyl(0.009, 0.004, h - 0.24, kit.polymer(0x202020), { axis: 'z', at: [0, 0, 0.24 + (h - 0.24) / 2], segments: 5 }));
}

/** Bidón (jerrycan) de 20 L de pie, frente hacia +Y salvo yawDeg. */
export function jerrycan(kit: ModelKit, parent: Obj, at: V3, mat: THREE.Material, yawDeg = 0): void {
  const g = frame(kit, parent, at, yawDeg);
  g.add(kit.box(0.165, 0.345, 0.47, mat, { at: [0, 0, 0.235], bevel: 0.02 }));
  // Estampado en X característico (dos diagonales en relieve).
  for (const s of [-1, 1]) {
    g.add(kit.box(0.17, 0.02, 0.36, mat, { at: [0, 0, 0.22], rotDeg: [s * 36, 0, 0] }));
  }
  g.add(kit.box(0.05, 0.16, 0.035, mat, { at: [0, -0.04, 0.485] }));
  g.add(kit.cyl(0.024, 0.024, 0.04, mat, { axis: 'z', at: [0, 0.12, 0.49], segments: 10 }));
}

/** Petate / saco de lona redondeado tumbado a lo largo de X. */
export function duffel(kit: ModelKit, parent: Obj, at: V3, len: number, r: number, mat: THREE.Material, yawDeg = 0): void {
  const g = frame(kit, parent, at, yawDeg);
  g.add(latheCrisp(kit, [
    [0, -len / 2], [r * 0.7, -len / 2], [r * 0.95, -len / 2 + r * 0.25], [r, -len / 2 + r * 0.6],
    [r, len / 2 - r * 0.6], [r * 0.95, len / 2 - r * 0.25], [r * 0.7, len / 2], [0, len / 2],
  ], mat, { axis: 'x', segments: 14 }));
  // Correas.
  const strap = kit.polymer(0x2d2b22);
  for (const x of [-len * 0.28, len * 0.28]) {
    g.add(kit.cyl(r * 1.02, r * 1.02, 0.022, strap, { axis: 'x', at: [x, 0, 0], segments: 14, open: true }));
  }
}

/** Caja de munición/estiba metálica con asa y cierres. */
export function ammoCan(kit: ModelKit, parent: Obj, at: V3, mat: THREE.Material, size: V3 = [0.15, 0.3, 0.19], yawDeg = 0): void {
  const g = frame(kit, parent, at, yawDeg);
  const [w, d, h] = size;
  g.add(kit.box(w, d, h, mat, { at: [0, 0, h / 2], bevel: 0.008 }));
  g.add(kit.box(w + 0.01, d + 0.01, 0.025, mat, { at: [0, 0, h - 0.0125], bevel: 0.006 }));
  g.add(rod(kit, [0, -d * 0.25, h], [0, -d * 0.25, h + 0.03], 0.006, mat));
  g.add(rod(kit, [0, d * 0.25, h], [0, d * 0.25, h + 0.03], 0.006, mat));
  g.add(rod(kit, [0, -d * 0.25, h + 0.03], [0, d * 0.25, h + 0.03], 0.008, mat));
}

/**
 * Ametralladora M2HB .50 sobre afuste de pedestal/anillo: `at` = base del
 * pivote; apunta a +Y girada yawDeg. Longitud ~1.65 m, cañón 1.14 m.
 */
export function m2Browning(kit: ModelKit, parent: Obj, at: V3, yawDeg = 0, elevDeg = 4): void {
  const g = frame(kit, parent, at, yawDeg);
  const black = kit.steel(0x26282a, { roughness: 0.5 });
  const od = kit.paint(PAINT.olive, { roughness: 0.7 });
  // Pivote y cuna.
  g.add(kit.cyl(0.035, 0.035, 0.22, black, { axis: 'z', at: [0, 0, 0.11], segments: 10 }));
  const gun = kit.group({ at: [0, 0, 0.27], rotDeg: [elevDeg, 0, 0] });
  g.add(gun);
  gun.add(kit.box(0.12, 0.3, 0.08, black, { at: [0, 0, -0.06] }));
  // Cajón de mecanismos (receptor).
  gun.add(kit.box(0.17, 0.74, 0.2, black, { at: [0, -0.02, 0.02], bevel: 0.01 }));
  gun.add(kit.box(0.17, 0.3, 0.05, black, { at: [0, -0.2, 0.145] }));
  // Empuñaduras de pala y palanca.
  gun.add(kit.box(0.22, 0.05, 0.12, black, { at: [0, -0.43, 0.02] }));
  for (const x of [-0.085, 0.085]) gun.add(kit.cyl(0.018, 0.018, 0.12, kit.polymer(), { axis: 'y', at: [x, -0.5, 0.0], segments: 8 }));
  // Manguito perforado + cañón con apagallamas.
  gun.add(kit.cyl(0.04, 0.04, 0.32, black, { at: [0, 0.5, 0.02], segments: 12 }));
  gun.add(kit.cyl(0.024, 0.024, 1.0, black, { at: [0, 1.0, 0.02], segments: 10 }));
  gun.add(kit.cyl(0.03, 0.028, 0.08, black, { at: [0, 1.5, 0.02], segments: 10 }));
  // Alza y punto de mira.
  gun.add(kit.box(0.02, 0.04, 0.05, black, { at: [0, 0.32, 0.14] }));
  // Caja de munición .50 en el costado izquierdo y cinta.
  gun.add(kit.box(0.16, 0.3, 0.2, od, { at: [-0.2, -0.02, -0.06], bevel: 0.008 }));
  gun.add(kit.box(0.1, 0.08, 0.03, kit.brass(), { at: [-0.12, 0.0, 0.07], rotDeg: [0, 30, 0] }));
}

/**
 * Pico/pala/palanca (herramientas de zapador) sujetas sobre una cubierta,
 * a lo largo de Y. `at` = centro en la cubierta.
 */
export function pioneerTools(kit: ModelKit, parent: Obj, at: V3, paint: THREE.Material, yawDeg = 0): void {
  const g = frame(kit, parent, at, yawDeg);
  const wood = kit.canvas(0x6b5236);
  const steel = kit.steel(0x2e3033, { roughness: 0.6 });
  // Pala.
  g.add(kit.cyl(0.017, 0.017, 0.8, wood, { at: [-0.12, -0.15, 0.04], segments: 8 }));
  g.add(kit.box(0.2, 0.28, 0.02, steel, { at: [-0.12, 0.38, 0.04], bevel: 0.006 }));
  // Pico.
  g.add(kit.cyl(0.02, 0.02, 0.85, wood, { at: [0.08, -0.05, 0.04], segments: 8 }));
  g.add(kit.box(0.5, 0.05, 0.035, steel, { at: [0.08, 0.38, 0.045], rotDeg: [0, 0, 90] }));
  // Palanca/barra.
  g.add(kit.cyl(0.016, 0.016, 1.2, steel, { at: [0.24, 0.0, 0.035], segments: 8 }));
  // Abrazaderas.
  for (const y of [-0.3, 0.2]) g.add(kit.box(0.5, 0.04, 0.03, paint, { at: [0.06, y, 0.07] }));
}

/** Fila de tornillos/remaches a lo largo de un segmento (cabezas hexagonales). */
export function boltRow(kit: ModelKit, parent: Obj, a: V3, b: V3, n: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', r = 0.011, h = 0.01): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    parent.add(kit.cyl(r, r, h, mat, {
      axis, segments: 6,
      at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    }));
  }
}

/**
 * Junta perimetral oscura (rendija de puerta/trampilla) de w × h alrededor de
 * `at`, sobre una cara cuya normal es ±`axis` (`sign` = lado hacia el que
 * mira la cara). Lee a 10-30 m mucho mejor que un relieve del mismo color.
 */
export function seamRect(kit: ModelKit, parent: Obj, at: V3, w: number, h: number, axis: 'x' | 'y' | 'z', sign: 1 | -1, gap = 0.014): void {
  const dark = kit.polymer(0x121310);
  const d = 0.006;
  const o = sign * 0.002;
  if (axis === 'x') {
    // Cara en el plano YZ: w a lo largo de Y, h a lo largo de Z.
    parent.add(kit.box(d, w + gap, gap, dark, { at: [at[0] + o, at[1], at[2] + h / 2] }));
    parent.add(kit.box(d, w + gap, gap, dark, { at: [at[0] + o, at[1], at[2] - h / 2] }));
    parent.add(kit.box(d, gap, h, dark, { at: [at[0] + o, at[1] + w / 2, at[2]] }));
    parent.add(kit.box(d, gap, h, dark, { at: [at[0] + o, at[1] - w / 2, at[2]] }));
  } else if (axis === 'y') {
    // Cara en el plano XZ: w a lo largo de X, h a lo largo de Z.
    parent.add(kit.box(w + gap, d, gap, dark, { at: [at[0], at[1] + o, at[2] + h / 2] }));
    parent.add(kit.box(w + gap, d, gap, dark, { at: [at[0], at[1] + o, at[2] - h / 2] }));
    parent.add(kit.box(gap, d, h, dark, { at: [at[0] + w / 2, at[1] + o, at[2]] }));
    parent.add(kit.box(gap, d, h, dark, { at: [at[0] - w / 2, at[1] + o, at[2]] }));
  } else {
    // Cara horizontal: w a lo largo de X, h a lo largo de Y.
    parent.add(kit.box(w + gap, gap, d, dark, { at: [at[0], at[1] + h / 2, at[2] + o] }));
    parent.add(kit.box(w + gap, gap, d, dark, { at: [at[0], at[1] - h / 2, at[2] + o] }));
    parent.add(kit.box(gap, h, d, dark, { at: [at[0] + w / 2, at[1], at[2] + o] }));
    parent.add(kit.box(gap, h, d, dark, { at: [at[0] - w / 2, at[1], at[2] + o] }));
  }
}

/** Cable de remolque enrollado a lo largo de un costado (con ojales). */
export function towCable(kit: ModelKit, parent: Obj, a: V3, b: V3, side: 1 | -1): void {
  const steel = kit.steel(0x3c3a36, { roughness: 0.75, metalness: 0.6 });
  const n = 6;
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t + side * 0.012 * Math.sin(t * Math.PI), a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 0.02 * Math.sin(t * Math.PI)]);
  }
  parent.add(kit.tube(pts, 0.016, steel, { segments: 24 }));
  for (const p of [a, b]) {
    parent.add(lowTorus(kit, 0.05, 0.016, steel, { axis: 'x', at: [p[0], p[1], p[2]], segments: 10 }));
  }
  // Abrazaderas.
  for (const t of [0.33, 0.66]) {
    parent.add(kit.box(0.04, 0.05, 0.06, steel, { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] }));
  }
}

/** Placa de chapa en relieve (paneles de acceso): caja muy fina con chaflán. */
export function panel(kit: ModelKit, parent: Obj, at: V3, size: V3, mat: THREE.Material, rotDeg: V3 = [0, 0, 0]): void {
  parent.add(kit.box(size[0], size[1], size[2], mat, { at, rotDeg, bevel: Math.min(size[0], size[1], size[2]) * 0.45 }));
}
