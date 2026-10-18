// ============================================================================
//  parts/small-mounts.ts — Montajes de las armas ligeras (agente 3D-SMALL).
//
//    * Banco de pruebas de pedestal + máquina de tiro (rest tipo Ransom) para
//      la pistola: columna de acero con pies niveladores, plato giratorio
//      (azimut) y balancín con insertos de empuñadura (elevación).
//    * Trípode de tiro para el fusil: patas de aluminio, columna, rótula
//      panorámica (azimut) y cuna basculante con abrazaderas (elevación).
//    * Trípode M192 (M240B) y M3 (M2HB) con su mecanismo de puntería T&E.
//    * Cajas de munición (M2A1 .50 y caja de 100 cartuchos 7.62).
//
//  Espacio de rig.ts (metros, X dcha, Y adelante, Z arriba, suelo z = 0).
// ============================================================================
import * as THREE from 'three';
import type { ModelKit, V3 } from '../kit';
import { hexBolt, knob, revolve, sbox } from './small-util';

const DEG = Math.PI / 180;

/** Palo/tubo recto entre dos puntos (cilindro orientado). */
export function strut(kit: ModelKit, a: V3, b: V3, r0: number, r1: number, mat: THREE.Material, segments = 12): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = kit.cyl(r0, r1, len, mat, { segments });
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

/** Caja orientada entre dos puntos (perfil w×h perpendicular a a→b). */
export function beam(kit: ModelKit, a: V3, b: V3, w: number, h: number, mat: THREE.Material, bevel = 0): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = sbox(kit, w, len, h, mat, { bevel });
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

// ============================================================================
//  Banco de pruebas de pedestal (estático, va en root)
// ============================================================================
export function testStandBase(kit: ModelKit, topZ: number): THREE.Group {
  const g = kit.group({ name: 'test-stand' });
  const paint = kit.paint(0x3a4650, { roughness: 0.55, metalness: 0.35 });
  const steel = kit.steel(0x6d7378, { roughness: 0.35 });
  const zinc = kit.steel(0xa7abad, { roughness: 0.3 });
  const rubber = kit.rubber();
  const plateZ = 0.046;
  // Placa base con chaflán y pies niveladores.
  g.add(sbox(kit, 0.56, 0.56, 0.022, paint, { at: [0, 0, plateZ], bevel: 0.004 }));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = sx * 0.235, y = sy * 0.235;
    g.add(kit.cyl(0.032, 0.03, 0.012, rubber, { axis: 'z', at: [x, y, 0.006], segments: 18 }));
    g.add(kit.cyl(0.022, 0.022, 0.008, zinc, { axis: 'z', at: [x, y, 0.016], segments: 16 }));
    g.add(kit.cyl(0.008, 0.008, 0.07, zinc, { axis: 'z', at: [x, y, 0.045], segments: 10 }));
    g.add(hexBolt(kit, 0.014, 0.008, zinc, { at: [x, y, plateZ + 0.015] }));
    g.add(hexBolt(kit, 0.014, 0.008, zinc, { at: [x, y, plateZ - 0.015] }));
  }
  // Columna de tubo cuadrado 120 mm con cartelas.
  const colB = plateZ + 0.011, colT = topZ - 0.02;
  g.add(sbox(kit, 0.12, 0.12, colT - colB, paint, { at: [0, 0, (colB + colT) / 2], bevel: 0.006 }));
  for (let k = 0; k < 4; k++) {
    const gus = kit.extrudeSide([[0.06, 0], [0.24, 0], [0.06, 0.22]], 0.012, paint, { bevel: 0.0015 });
    const holder = kit.group({ rotDeg: [0, 0, k * 90], at: [0, 0, colB] });
    holder.add(gus);
    g.add(holder);
    const top = kit.extrudeSide([[0.06, 0], [0.13, 0], [0.06, -0.09]], 0.01, paint, { bevel: 0.001 });
    const th = kit.group({ rotDeg: [0, 0, 45 + k * 90], at: [0, 0, colT] });
    th.add(top);
    g.add(th);
  }
  // Brida superior atornillada.
  g.add(sbox(kit, 0.27, 0.27, 0.02, paint, { at: [0, 0, topZ - 0.01], bevel: 0.003 }));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    g.add(hexBolt(kit, 0.009, 0.007, steel, { at: [sx * 0.11, sy * 0.11, topZ + 0.0035] }));
    g.add(hexBolt(kit, 0.012, 0.008, steel, { at: [sx * 0.2, sy * 0.2, plateZ + 0.015] }));
  }
  // Placa de características remachada en la columna.
  g.add(sbox(kit, 0.08, 0.002, 0.05, zinc, { at: [0, -0.061, 0.62] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(kit.cyl(0.0025, 0.0025, 0.002, steel, { axis: 'y', at: [sx * 0.034, -0.0625, 0.62 + sz * 0.019], segments: 8 }));
  }
  return g;
}

/**
 * Plato giratorio + bancada de la máquina de tiro (va en traverse). Devuelve
 * también la posición del eje del balancín (origen del nodo de elevación).
 */
export function machineRestBase(kit: ModelKit, z0: number): { group: THREE.Group; pivot: V3 } {
  const g = kit.group({ name: 'rest-base' });
  const cast = kit.paint(0x56606a, { roughness: 0.5, metalness: 0.45 });
  const steel = kit.steel(0x6d7378, { roughness: 0.35 });
  const dark = kit.steel(0x26282a, { roughness: 0.5 });
  const scale = kit.paint(0xe8e4d6, { roughness: 0.5, metalness: 0.1 });
  // Plato giratorio con escala de grados.
  g.add(kit.cyl(0.115, 0.115, 0.018, steel, { axis: 'z', at: [0, 0, z0 + 0.009], segments: 48 }));
  g.add(kit.cyl(0.118, 0.118, 0.004, dark, { axis: 'z', at: [0, 0, z0 + 0.002], segments: 48 }));
  for (let i = 0; i < 36; i++) {
    const a = (i * 10) * DEG;
    const long = i % 3 === 0;
    const m = sbox(kit, 0.0012, long ? 0.012 : 0.007, 0.0006, scale, {
      at: [Math.sin(a) * (0.108 - (long ? 0.004 : 0.0015)), Math.cos(a) * (0.108 - (long ? 0.004 : 0.0015)), z0 + 0.0183],
      rotDeg: [0, 0, -i * 10],
    });
    g.add(m);
  }
  // Palanca de bloqueo del plato.
  g.add(kit.cyl(0.006, 0.006, 0.07, steel, { axis: 'x', at: [0.145, -0.03, z0 + 0.009] }));
  g.add(kit.sphere(0.012, kit.polymer(), { at: [0.18, -0.03, z0 + 0.009] }));
  // Bancada fundida de la máquina de tiro.
  const bz = z0 + 0.018;
  g.add(sbox(kit, 0.17, 0.32, 0.02, cast, { at: [0, 0.01, bz + 0.01], bevel: 0.004 }));
  // Soportes del eje del balancín (atrás) con su eje pasante.
  const pivot: V3 = [0, -0.10, bz + 0.055];
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([
      [-0.135, bz + 0.02], [-0.06, bz + 0.02], [-0.075, bz + 0.07], [-0.125, bz + 0.07],
    ], 0.014, cast, { at: [s * 0.062, 0, 0], bevel: 0.002 }));
    g.add(kit.cyl(0.011, 0.011, 0.012, steel, { axis: 'x', at: [s * 0.072, pivot[1], pivot[2]], segments: 16 }));
    g.add(hexBolt(kit, 0.008, 0.006, steel, { axis: 'x', at: [s * 0.081, pivot[1], pivot[2]] }));
  }
  // Tornillo de reglaje en elevación (apoyo del balancín, delante).
  g.add(kit.cyl(0.006, 0.006, 0.05, steel, { axis: 'z', at: [0, 0.12, bz + 0.045], segments: 12 }));
  g.add(knob(kit, 0.016, 0.012, kit.polymer(), { at: [0, 0.12, bz + 0.026] }));
  // Tornillos de la bancada.
  for (const sx of [-1, 1]) for (const sy of [-0.12, 0.14]) {
    g.add(hexBolt(kit, 0.007, 0.005, steel, { at: [sx * 0.065, sy, bz + 0.0225] }));
  }
  return { group: g, pivot };
}

/**
 * Balancín de la máquina de tiro (va en elevation; origen = eje). `grip`
 * describe dónde queda la empuñadura del arma en coordenadas de elevación.
 */
export function machineRestRocker(kit: ModelKit, grip: { y0: number; y1: number; z0: number; z1: number; halfW: number }): THREE.Group {
  const g = kit.group({ name: 'rest-rocker' });
  const cast = kit.paint(0x56606a, { roughness: 0.5, metalness: 0.45 });
  const steel = kit.steel(0x6d7378, { roughness: 0.35 });
  const insert = kit.rubber();
  const knobMat = kit.polymer(0x202122);
  // Brazos del balancín (se apoyan en el eje) y travesaño delantero.
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([
      [-0.022, -0.012], [0.02, -0.016], [0.20, -0.016], [0.215, -0.006], [0.215, 0.006], [0.02, 0.012], [-0.022, 0.012],
    ], 0.014, cast, { at: [s * 0.047, 0, 0], bevel: 0.002 }));
    g.add(kit.cyl(0.016, 0.016, 0.016, cast, { axis: 'x', at: [s * 0.047, 0, 0], segments: 18 }));
  }
  g.add(kit.cyl(0.0085, 0.0085, 0.13, steel, { axis: 'x', at: [0, 0, 0], segments: 14 }));
  g.add(sbox(kit, 0.108, 0.026, 0.02, cast, { at: [0, 0.200, -0.004], bevel: 0.003 }));
  g.add(sbox(kit, 0.108, 0.026, 0.02, cast, { at: [0, 0.035, -0.004], bevel: 0.003 }));
  // Placas de sujeción a ambos lados de la empuñadura + insertos de goma.
  const yc = (grip.y0 + grip.y1) / 2, zc = (grip.z0 + grip.z1) / 2;
  const L = grip.y1 - grip.y0, H = grip.z1 - grip.z0;
  for (const s of [-1, 1]) {
    g.add(sbox(kit, 0.007, L * 0.95, H * 0.9, insert, { at: [s * (grip.halfW + 0.0035), yc, zc], rotDeg: [-22, 0, 0], bevel: 0.002 }));
    g.add(sbox(kit, 0.009, L * 1.05, H * 0.82, cast, { at: [s * (grip.halfW + 0.0115), yc + 0.004, zc + 0.004], rotDeg: [-22, 0, 0], bevel: 0.002 }));
    // Pies de la placa hasta los brazos.
    g.add(sbox(kit, 0.012, 0.02, Math.abs(zc) + 0.02, cast, { at: [s * (grip.halfW + 0.012), grip.y0 + 0.01, zc / 2 - 0.004] }));
    g.add(sbox(kit, 0.012, 0.02, Math.abs(zc) + 0.02, cast, { at: [s * (grip.halfW + 0.012), grip.y1 - 0.004, zc / 2 - 0.004] }));
  }
  // Tornillos pasantes con pomos (lado derecho) y tuercas (izquierdo).
  for (const [dy, dz] of [[-0.022, 0.02], [0.022, 0.02], [-0.03, -0.022], [0.016, -0.022]] as const) {
    const y = yc + dy, z = zc + dz;
    g.add(kit.cyl(0.0035, 0.0035, 2 * grip.halfW + 0.04, steel, { axis: 'x', at: [0, y, z], segments: 10 }));
    g.add(knob(kit, 0.011, 0.01, knobMat, { axis: 'x', at: [grip.halfW + 0.024, y, z] }));
    g.add(hexBolt(kit, 0.0055, 0.004, steel, { axis: 'x', at: [-(grip.halfW + 0.019), y, z] }));
  }
  return g;
}

// ============================================================================
//  Trípode de tiro para fusil (patas en root, rótula en traverse)
// ============================================================================
export function rifleTripodLegs(kit: ModelKit, hubZ: number): THREE.Group {
  const g = kit.group({ name: 'rifle-tripod' });
  const alu = kit.paint(0x2a2c2f, { roughness: 0.45, metalness: 0.55 });
  const carbon = kit.paint(0x1a1b1d, { roughness: 0.38, metalness: 0.2 });
  const lock = kit.steel(0x7b8186, { roughness: 0.3 });
  const rubber = kit.rubber();
  const accent = kit.paint(0x8a2a22, { roughness: 0.5, metalness: 0.3 });
  // Corona (cabeza) del trípode.
  g.add(kit.cyl(0.055, 0.06, 0.05, alu, { axis: 'z', at: [0, 0, hubZ - 0.025], segments: 24 }));
  g.add(kit.cyl(0.04, 0.04, 0.012, lock, { axis: 'z', at: [0, 0, hubZ + 0.006], segments: 24 }));
  const spread = 23 * DEG;
  for (let k = 0; k < 3; k++) {
    const az = (k * 120 + 180) * DEG; // una pata hacia atrás, dos delante
    const dir = new THREE.Vector3(Math.sin(az) * Math.sin(spread), Math.cos(az) * Math.sin(spread), -Math.cos(spread));
    const top = new THREE.Vector3(Math.sin(az) * 0.055, Math.cos(az) * 0.055, hubZ - 0.03);
    const len = (top.z - 0.012) / Math.cos(spread);
    const p = (f: number): V3 => {
      const v = top.clone().addScaledVector(dir, len * f);
      return [v.x, v.y, v.z];
    };
    // Articulación de la pata en la corona.
    const hinge = sbox(kit, 0.034, 0.03, 0.04, alu, { bevel: 0.004 });
    hinge.position.set(top.x, top.y, top.z);
    hinge.rotation.z = -az;
    g.add(hinge);
    // Tres tramos telescópicos de carbono con bloqueos de rosca.
    const secs: Array<[number, number, number]> = [[0.02, 0.37, 0.0165], [0.37, 0.70, 0.0140], [0.70, 0.985, 0.0115]];
    for (const [f0, f1, r] of secs) {
      g.add(strut(kit, p(f0), p(f1), r, r, carbon, 16));
      g.add(strut(kit, p(f1 - 0.035), p(f1 + 0.005), r * 1.32, r * 1.32, lock, 16));
      g.add(strut(kit, p(f1 - 0.03), p(f1 - 0.024), r * 1.36, r * 1.36, accent, 16));
    }
    // Pie de goma.
    const foot = p(1.0);
    g.add(kit.cyl(0.02, 0.016, 0.026, rubber, { axis: 'z', at: [foot[0], foot[1], 0.013], segments: 16 }));
  }
  // Gancho de lastre bajo la corona.
  g.add(kit.cyl(0.006, 0.006, 0.08, lock, { axis: 'z', at: [0, 0, hubZ - 0.09], segments: 10 }));
  g.add(kit.torus(0.012, 0.0028, lock, { axis: 'x', at: [0, 0, hubZ - 0.14], segments: 14 }));
  return g;
}

/** Rótula panorámica (azimut) sobre la corona del trípode (va en traverse). */
export function rifleTripodPan(kit: ModelKit, hubZ: number, tiltZ: number): THREE.Group {
  const g = kit.group({ name: 'rifle-pan' });
  const alu = kit.paint(0x2a2c2f, { roughness: 0.45, metalness: 0.55 });
  const lock = kit.steel(0x7b8186, { roughness: 0.3 });
  const accent = kit.paint(0x8a2a22, { roughness: 0.5, metalness: 0.3 });
  const z0 = hubZ + 0.012;
  g.add(kit.cyl(0.042, 0.042, 0.016, alu, { axis: 'z', at: [0, 0, z0 + 0.008], segments: 28 }));
  g.add(kit.cyl(0.043, 0.043, 0.003, accent, { axis: 'z', at: [0, 0, z0 + 0.0175], segments: 28 }));
  g.add(kit.cyl(0.034, 0.03, 0.03, alu, { axis: 'z', at: [0, 0, z0 + 0.034], segments: 24 }));
  // Horquilla del eje de basculación.
  const fz = tiltZ;
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([
      [-0.03, z0 + 0.045], [0.03, z0 + 0.045], [0.022, fz + 0.012], [-0.022, fz + 0.012],
    ], 0.012, alu, { at: [s * 0.046, 0, 0], bevel: 0.002 }));
  }
  g.add(sbox(kit, 0.104, 0.06, 0.012, alu, { at: [0, 0, z0 + 0.051], bevel: 0.003 }));
  // Pomos de bloqueo: panorámica y basculación.
  g.add(kit.cyl(0.005, 0.005, 0.04, lock, { axis: 'y', at: [0, -0.05, z0 + 0.01] }));
  g.add(knob(kit, 0.012, 0.012, kit.polymer(), { axis: 'y', at: [0, -0.072, z0 + 0.01] }));
  g.add(knob(kit, 0.016, 0.014, kit.polymer(), { axis: 'x', at: [0.064, 0, fz] }));
  g.add(kit.cyl(0.006, 0.006, 0.01, lock, { axis: 'x', at: [-0.056, 0, fz] }));
  return g;
}

/**
 * Cuna basculante con abrazadera Picatinny y horquilla acolchada (va en
 * elevation; origen = eje de basculación). `railZ` = cresta del raíl
 * inferior del guardamanos en coordenadas de elevación; `boreZ` = ánima.
 */
export function rifleSaddle(kit: ModelKit, railZ: number, boreZ: number, halfW: number): THREE.Group {
  const g = kit.group({ name: 'rifle-saddle' });
  const alu = kit.paint(0x2a2c2f, { roughness: 0.45, metalness: 0.55 });
  const lock = kit.steel(0x7b8186, { roughness: 0.3 });
  const pad = kit.rubber();
  const accent = kit.paint(0x8a2a22, { roughness: 0.5, metalness: 0.3 });
  // Cubo del eje de basculación entre los brazos de la horquilla.
  g.add(kit.cyl(0.017, 0.017, 0.078, alu, { axis: 'x', segments: 22 }));
  g.add(kit.cyl(0.0175, 0.0175, 0.004, accent, { axis: 'x', at: [0.026, 0, 0], segments: 22 }));
  // Columna hasta la mordaza y mordaza de raíl.
  g.add(sbox(kit, 0.030, 0.034, railZ - 0.02, alu, { at: [0, 0, (railZ + 0.012) / 2], bevel: 0.003 }));
  g.add(sbox(kit, 0.044, 0.070, 0.012, alu, { at: [0, 0, railZ - 0.006], bevel: 0.002 }));
  g.add(sbox(kit, 0.008, 0.070, 0.009, alu, { at: [0.0145, 0, railZ + 0.002], bevel: 0.0015 }));
  g.add(sbox(kit, 0.008, 0.070, 0.009, alu, { at: [-0.0145, 0, railZ + 0.002], bevel: 0.0015 }));
  g.add(kit.cyl(0.004, 0.004, 0.05, lock, { axis: 'x', at: [0, 0.018, railZ - 0.002], segments: 10 }));
  g.add(kit.cyl(0.004, 0.004, 0.05, lock, { axis: 'x', at: [0, -0.018, railZ - 0.002], segments: 10 }));
  g.add(knob(kit, 0.009, 0.008, kit.polymer(), { axis: 'x', at: [0.029, 0.018, railZ - 0.002] }));
  g.add(knob(kit, 0.009, 0.008, kit.polymer(), { axis: 'x', at: [0.029, -0.018, railZ - 0.002] }));
  // Horquilla en V con almohadillas a ambos lados del guardamanos.
  for (const s of [-1, 1]) {
    g.add(kit.extrudeSide([
      [-0.022, railZ - 0.012], [0.022, railZ - 0.012], [0.016, boreZ + 0.006], [-0.016, boreZ + 0.006],
    ], 0.006, alu, { at: [s * (halfW + 0.010), 0, 0], bevel: 0.0015 }));
    g.add(sbox(kit, 0.005, 0.030, boreZ - railZ, pad, { at: [s * (halfW + 0.0045), 0, (boreZ + railZ) / 2 + 0.004], bevel: 0.0015 }));
    g.add(sbox(kit, halfW * 0.4, 0.040, 0.008, alu, { at: [s * (halfW + 0.005), 0, railZ - 0.012], bevel: 0.002 }));
  }
  return g;
}

// ============================================================================
//  Trípodes de ametralladora (M192 / M3) con mecanismo T&E
// ============================================================================
export interface MgTripodSpec {
  style: 'm192' | 'm3';
  /** Altura de la cabeza (casquillo del pivote). */
  headZ: number;
  /** Altura del muñón (eje de elevación) sobre el suelo. */
  trunnionZ: number;
  /** Pie delantero y pie trasero DERECHO (el izquierdo es simétrico). */
  frontFoot: V3;
  rearFoot: V3;
  /** Pasador trasero del arma respecto al muñón (coordenadas de elevación). */
  rearPin: { y: number; z: number };
  /** Límites del T&E (grados); fuera de ellos el arma va "libre". */
  teMinDeg: number;
  teMaxDeg: number;
}

export interface MgTripod {
  /** Patas, cabeza y barra de puntería: hijo de root, rota con `animate`. */
  mount: THREE.Group;
  /** Pivote y cuna: va en traverse. */
  pintle: THREE.Group;
  /** Carro + husillo inferior del T&E: va en traverse. */
  teLower: THREE.Group;
  /** Husillo superior + horquilla: va en traverse; se anima en z. */
  teUpper: THREE.Group;
  /** Coloca el husillo superior para la elevación dada. */
  updateTE(elDeg: number): void;
  footprintM: number;
}

export function mgTripod(kit: ModelKit, spec: MgTripodSpec): MgTripod {
  const m3 = spec.style === 'm3';
  const paint = m3 ? kit.paint(0x4a5232, { roughness: 0.66, metalness: 0.35 }) : kit.paint(0x2c2e2c, { roughness: 0.5, metalness: 0.5 });
  const steel = kit.steel(0x3c3f41, { roughness: 0.45 });
  const bright = kit.steel(0x8d9196, { roughness: 0.28 });
  const bronze = kit.steel(0xa8823e, { roughness: 0.35, metalness: 1.0 });
  const rubber = kit.rubber();
  const mount = kit.group({ name: `${spec.style}-tripod` });
  const pintle = kit.group({ name: `${spec.style}-pintle` });
  const teLower = kit.group({ name: 'te-lower' });
  const teUpper = kit.group({ name: 'te-upper' });

  const hz = spec.headZ;
  // ---- Cabeza: fundición con casquillo del pivote --------------------------
  if (m3) {
    mount.add(kit.extrudePlan([[-0.07, -0.07], [0.07, -0.07], [0.045, 0.06], [-0.045, 0.06]], 0.055, paint, { at: [0, 0, hz - 0.06], bevel: 0.006 }));
    mount.add(kit.cyl(0.032, 0.036, 0.07, paint, { axis: 'z', at: [0, 0, hz - 0.03], segments: 20 }));
    mount.add(kit.cyl(0.026, 0.026, 0.008, bronze, { axis: 'z', at: [0, 0, hz + 0.004], segments: 20 }));
    // Pestillo del casquillo.
    mount.add(sbox(kit, 0.02, 0.03, 0.02, steel, { at: [0.04, 0.0, hz - 0.012], bevel: 0.003 }));
  } else {
    mount.add(kit.extrudePlan([[-0.05, -0.055], [0.05, -0.055], [0.034, 0.05], [-0.034, 0.05]], 0.045, paint, { at: [0, 0, hz - 0.05], bevel: 0.005 }));
    mount.add(kit.cyl(0.024, 0.027, 0.06, paint, { axis: 'z', at: [0, 0, hz - 0.026], segments: 20 }));
    mount.add(kit.cyl(0.02, 0.02, 0.006, steel, { axis: 'z', at: [0, 0, hz + 0.003], segments: 20 }));
  }

  // ---- Patas ------------------------------------------------------------------
  const legR = m3 ? 0.016 : 0.0135;
  const legFrom = (dir: THREE.Vector3): V3 => [dir.x * 0.05, dir.y * 0.05, hz - 0.035];
  const legs: Array<{ foot: V3; front: boolean }> = [
    { foot: spec.frontFoot, front: true },
    { foot: spec.rearFoot, front: false },
    { foot: [-spec.rearFoot[0], spec.rearFoot[1], spec.rearFoot[2]], front: false },
  ];
  const lerp3 = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  for (const { foot, front } of legs) {
    const dir = new THREE.Vector3(foot[0], foot[1], 0).normalize();
    const top = legFrom(dir);
    const ft: V3 = [foot[0], foot[1], 0.03];
    // Bisagra en la cabeza.
    const hinge = sbox(kit, 0.038, 0.04, 0.034, paint, { bevel: 0.004 });
    hinge.position.set(top[0], top[1], top[2]);
    hinge.rotation.z = Math.atan2(-dir.x, dir.y);
    mount.add(hinge);
    // Tubo exterior + tramo telescópico + abrazadera.
    const split = front ? 0.52 : 0.58;
    mount.add(strut(kit, top, lerp3(top, ft, split + 0.02), legR, legR, paint, 14));
    mount.add(strut(kit, lerp3(top, ft, split), ft, legR * 0.8, legR * 0.8, m3 ? paint : steel, 14));
    mount.add(strut(kit, lerp3(top, ft, split - 0.03), lerp3(top, ft, split + 0.03), legR * 1.35, legR * 1.35, steel, 14));
    const clampAt = lerp3(top, ft, split);
    mount.add(knob(kit, 0.011, 0.012, steel, { axis: 'x', at: [clampAt[0] + 0.024, clampAt[1], clampAt[2]] }));
    // Pie: zapata con espolón (M3) o pie de pala (M192).
    if (m3) {
      mount.add(sbox(kit, 0.07, 0.11, 0.012, paint, { at: [foot[0], foot[1], 0.012], rotDeg: [0, 0, Math.atan2(-dir.x, dir.y) / DEG], bevel: 0.003 }));
      mount.add(kit.cyl(0.004, 0.012, 0.05, steel, { axis: 'z', at: [foot[0], foot[1], -0.01], segments: 8 }));
      mount.add(strut(kit, lerp3(top, ft, 0.95), [foot[0], foot[1], 0.018], legR * 0.85, legR * 0.85, paint, 12));
    } else {
      mount.add(kit.cyl(0.03, 0.026, 0.014, rubber, { axis: 'z', at: [foot[0], foot[1], 0.012], segments: 16 }));
      mount.add(strut(kit, lerp3(top, ft, 0.95), [foot[0], foot[1], 0.02], legR * 0.7, legR * 0.7, steel, 12));
    }
  }

  // ---- Barra de puntería (arco centrado en el pivote) entre las patas traseras
  const barR = -spec.rearPin.y;
  const rf = spec.rearFoot;
  const rearLen = Math.hypot(rf[0], rf[1]);
  const barZ = (hz - 0.035) * (1 - (barR - 0.05) / (rearLen - 0.05)) + 0.03 * ((barR - 0.05) / (rearLen - 0.05));
  const legAng = Math.atan2(rf[0], -rf[1]); // ángulo de la pata trasera desde −Y
  const pts: V3[] = [];
  const nArc = 12;
  for (let i = 0; i <= nArc; i++) {
    const a = -legAng + (2 * legAng * i) / nArc;
    pts.push([Math.sin(a) * barR, -Math.cos(a) * barR, barZ]);
  }
  mount.add(kit.tube(pts, m3 ? 0.012 : 0.010, paint, { segments: 36 }));
  // Escala de milésimas sobre la barra.
  const scaleMat = kit.paint(0xd9d6cc, { roughness: 0.6, metalness: 0.1 });
  for (let i = -8; i <= 8; i++) {
    const a = (i * 2.5) * DEG;
    mount.add(sbox(kit, 0.0012, i % 4 === 0 ? 0.014 : 0.008, 0.001, scaleMat, {
      at: [Math.sin(a) * barR, -Math.cos(a) * barR, barZ + (m3 ? 0.0122 : 0.0102)], rotDeg: [0, 0, -i * 2.5],
    }));
  }
  for (const s of [-1, 1]) {
    mount.add(sbox(kit, 0.04, 0.04, 0.04, paint, { at: [s * Math.sin(legAng) * barR, -Math.cos(legAng) * barR, barZ], rotDeg: [0, 0, -s * legAng / DEG], bevel: 0.004 }));
  }

  // ---- Pivote y cuna (traverse) ----------------------------------------------
  const tz = spec.trunnionZ;
  pintle.add(kit.cyl(0.018, 0.018, 0.09, bright, { axis: 'z', at: [0, 0, hz - 0.03], segments: 16 }));
  pintle.add(kit.cyl(0.03, 0.03, 0.012, steel, { axis: 'z', at: [0, 0, hz + 0.014], segments: 20 }));
  if (m3) {
    // Cuna en T del M3 con orejetas del muñón y pasador.
    pintle.add(kit.extrudeSide([[-0.05, hz + 0.02], [0.06, hz + 0.02], [0.05, tz - 0.012], [-0.03, tz - 0.012]], 0.05, steel, { bevel: 0.004 }));
    for (const s of [-1, 1]) {
      pintle.add(kit.extrudeSide([[-0.025, tz - 0.03], [0.025, tz - 0.03], [0.02, tz + 0.02], [-0.02, tz + 0.02]], 0.012, steel, { at: [s * 0.042, 0, 0], bevel: 0.002 }));
    }
    pintle.add(kit.cyl(0.0085, 0.0085, 0.11, bright, { axis: 'x', at: [0, 0, tz], segments: 14 }));
    pintle.add(kit.sphere(0.012, bright, { at: [0.058, 0, tz] }));
  } else {
    pintle.add(kit.extrudeSide([[-0.04, hz + 0.02], [0.045, hz + 0.02], [0.035, tz - 0.012], [-0.025, tz - 0.012]], 0.04, paint, { bevel: 0.004 }));
    for (const s of [-1, 1]) {
      pintle.add(kit.extrudeSide([[-0.02, tz - 0.025], [0.02, tz - 0.025], [0.016, tz + 0.016], [-0.016, tz + 0.016]], 0.01, paint, { at: [s * 0.04, 0, 0], bevel: 0.002 }));
    }
    pintle.add(kit.cyl(0.007, 0.007, 0.1, bright, { axis: 'x', at: [0, 0, tz], segments: 12 }));
    pintle.add(sbox(kit, 0.012, 0.012, 0.03, steel, { at: [0.054, 0, tz - 0.012], bevel: 0.002 }));
  }

  // ---- Mecanismo T&E (traverse) ---------------------------------------------
  const ty = -barR;
  const pinZ0 = tz + spec.rearPin.z;
  // Carro sobre la barra con volante de dirección.
  teLower.add(sbox(kit, 0.07, 0.05, 0.05, steel, { at: [0, ty, barZ], bevel: 0.006 }));
  teLower.add(kit.cyl(0.006, 0.006, 0.05, bright, { axis: 'x', at: [0.055, ty, barZ] }));
  teLower.add(kit.torus(0.026, 0.004, steel, { axis: 'x', at: [0.08, ty, barZ], segments: 20 }));
  for (let k = 0; k < 3; k++) {
    const sp = sbox(kit, 0.004, 0.05, 0.005, steel, { at: [0.08, ty, barZ], rotDeg: [k * 60, 0, 0] });
    teLower.add(sp);
  }
  teLower.add(kit.cyl(0.004, 0.004, 0.02, kit.polymer(), { axis: 'x', at: [0.09, ty, barZ + 0.022] }));
  // Husillo exterior (fijo al carro) con volante de elevación.
  const hTop = pinZ0 - 0.07;
  teLower.add(kit.cyl(0.017, 0.017, hTop - (barZ + 0.02), steel, { axis: 'z', at: [0, ty, (hTop + barZ + 0.02) / 2], segments: 18 }));
  teLower.add(kit.cyl(0.021, 0.021, 0.014, steel, { axis: 'z', at: [0, ty, hTop - 0.004], segments: 18 }));
  const wz = (hTop + barZ) / 2 + 0.01;
  teLower.add(kit.torus(0.046, 0.0045, steel, { axis: 'z', at: [0, ty, wz], segments: 28 }));
  for (let k = 0; k < 3; k++) {
    const a = k * 120 * DEG;
    teLower.add(strut(kit, [0, ty, wz], [Math.sin(a) * 0.045, ty + Math.cos(a) * 0.045, wz], 0.003, 0.003, steel, 6));
  }
  teLower.add(kit.cyl(0.004, 0.004, 0.026, kit.polymer(), { axis: 'z', at: [0.032, ty + 0.032, wz + 0.014] }));
  // Husillo superior + horquilla del pasador trasero (se mueve en z).
  teUpper.add(kit.cyl(0.010, 0.010, 0.12, bright, { axis: 'z', at: [0, ty, pinZ0 - 0.08], segments: 14 }));
  teUpper.add(sbox(kit, 0.05, 0.026, 0.014, steel, { at: [0, ty, pinZ0 - 0.022], bevel: 0.003 }));
  for (const s of [-1, 1]) {
    teUpper.add(sbox(kit, 0.008, 0.026, 0.03, steel, { at: [s * 0.024, ty, pinZ0 - 0.004], bevel: 0.002 }));
  }
  teUpper.add(kit.cyl(0.0055, 0.0055, 0.064, bright, { axis: 'x', at: [0, ty, pinZ0], segments: 10 }));

  const updateTE = (elDeg: number): void => {
    const e = Math.min(spec.teMaxDeg, Math.max(spec.teMinDeg, elDeg)) * DEG;
    const z = tz + spec.rearPin.y * Math.sin(e) + spec.rearPin.z * Math.cos(e);
    teUpper.position.z = z - pinZ0;
  };

  const footprintM = Math.max(Math.hypot(...spec.frontFoot.slice(0, 2) as [number, number]), Math.hypot(rf[0], rf[1]));
  return { mount, pintle, teLower, teUpper, updateTE, footprintM };
}

/**
 * Estado de "re-asentado" del trípode: el rumbo de las patas sigue al arma
 * con una zona muerta de ±`limitDeg` (la dotación re-asienta el trípode al
 * cambiar de sector). Devuelve el rumbo de las patas (grados).
 */
export function makeTripodFollower(limitDeg: number): (azDeg: number) => number {
  let heading: number | null = null;
  return (az: number) => {
    if (heading === null) heading = az;
    let d = ((az - heading + 540) % 360) - 180;
    if (d > limitDeg) heading += d - limitDeg;
    else if (d < -limitDeg) heading += d + limitDeg;
    d = ((heading % 360) + 360) % 360;
    heading = d;
    return heading;
  };
}

// ============================================================================
//  Cajas de munición
// ============================================================================

/** Caja M2A1 (.50 cal): 305 × 155 × 190 mm; tapa con asa y cierre. Base en z=0. */
export function ammoCanM2A1(kit: ModelKit, opts: { at?: V3; rotDeg?: V3 } = {}): THREE.Group {
  const g = kit.group({ name: 'ammo-can', ...opts });
  const od = kit.paint(0x4a5232, { roughness: 0.62, metalness: 0.3 });
  const steel = kit.steel(0x5b6064, { roughness: 0.45 });
  const yellow = kit.paint(0xd8b640, { roughness: 0.6, metalness: 0.1 });
  const L = 0.305, W = 0.155, H = 0.19;
  g.add(sbox(kit, W, L, H - 0.02, od, { at: [0, 0, (H - 0.02) / 2], bevel: 0.006 }));
  // Nervios estampados en los costados.
  for (const s of [-1, 1]) {
    g.add(sbox(kit, 0.004, L * 0.78, 0.12, od, { at: [s * (W / 2 + 0.001), 0, 0.085], bevel: 0.0015 }));
  }
  // Tapa con reborde y asa abatible.
  g.add(sbox(kit, W + 0.008, L + 0.008, 0.024, od, { at: [0, 0, H - 0.01], bevel: 0.004 }));
  g.add(kit.tube([[-0.0, -0.06, H + 0.004], [0, -0.06, H + 0.022], [0, 0.06, H + 0.022], [0, 0.06, H + 0.004]], 0.004, steel, { segments: 16 }));
  // Cierre de palanca en el frente.
  g.add(sbox(kit, 0.05, 0.012, 0.07, od, { at: [0, L / 2 + 0.008, H - 0.04], bevel: 0.003 }));
  g.add(kit.cyl(0.004, 0.004, 0.056, steel, { axis: 'x', at: [0, L / 2 + 0.012, H - 0.005] }));
  // Rotulado amarillo (franja de lote).
  g.add(sbox(kit, 0.0015, 0.17, 0.012, yellow, { at: [W / 2 + 0.0035, 0, 0.13] }));
  g.add(sbox(kit, 0.0015, 0.11, 0.008, yellow, { at: [W / 2 + 0.0035, -0.03, 0.11] }));
  return g;
}

/** Caja rígida de 100 cartuchos 7.62 (M240): 0.19 × 0.08 × 0.15 m. Base z=0. */
export function ammoBox100(kit: ModelKit, opts: { at?: V3; rotDeg?: V3 } = {}): THREE.Group {
  const g = kit.group({ name: 'ammo-box-100', ...opts });
  const tan = kit.polymer(0x6c6248);
  const dark = kit.polymer(0x2a2b28);
  const L = 0.19, W = 0.085, H = 0.15;
  g.add(sbox(kit, W, L, H, tan, { at: [0, 0, H / 2], bevel: 0.008 }));
  for (let i = 0; i < 4; i++) {
    g.add(sbox(kit, W + 0.003, 0.008, H * 0.82, tan, { at: [0, -0.06 + i * 0.04, H * 0.45], bevel: 0.002 }));
  }
  g.add(sbox(kit, W * 0.6, L * 0.4, 0.01, dark, { at: [0, -0.02, H + 0.002], bevel: 0.003 }));
  g.add(revolve(kit, [[0.01, 0], [0.01, 0.012], [0, 0.012]], dark, { axis: 'z', at: [0, 0.06, H], segments: 12 }));
  return g;
}
