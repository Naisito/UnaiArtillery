// ============================================================================
//  ammo.ts — Atrezo de batería: proyectiles de 155 en palé, cargas modulares
//  (MACS), cajas, sacos terreros, red de camuflaje con mástiles, atacador y
//  goniómetro (aiming circle).  [V2 — 3D-CORE]
//  Espacio de modelado de rig.ts (Z arriba, metros reales).
// ============================================================================
import * as THREE from 'three';
import type { ModelKit, V3 } from '../kit';

/** Proyectil de 155 mm HE (M795) con tapón de izado, eje +Y, base en y=0. */
export function shell155(kit: ModelKit, opts: { segments?: number; fuzed?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const od = kit.paint(0x5d6236, { roughness: 0.6, metalness: 0.15, wear: 0.3 });
  const r = 0.0775;
  const seg = opts.segments ?? 16;
  // Cuerpo: culote boat-tail, banda de forzamiento (cobre), ojiva.
  g.add(kit.lathe([
    [0, 0], [r * 0.86, 0], [r * 0.95, 0.04], [r, 0.08], [r, 0.47],
    [r * 0.94, 0.53], [r * 0.8, 0.6], [r * 0.58, 0.66], [r * 0.36, 0.7], [r * 0.3, 0.71], [0, 0.71],
  ], od, { segments: seg }));
  g.add(kit.cyl(r * 1.015, r * 1.015, 0.03, kit.brass(), { at: [0, 0.095, 0], segments: seg }));
  // Franja amarilla de explosivo (HE) bajo la ojiva.
  g.add(kit.cyl(r * 1.005, r * 0.99, 0.035, kit.paint(0xc9a227, { roughness: 0.6, wear: 0.3 }), {
    at: [0, 0.5, 0], segments: seg,
  }));
  if (opts.fuzed) {
    g.add(kit.lathe([[0.024, 0], [0.024, 0.03], [0.016, 0.1], [0.004, 0.13], [0, 0.13]],
      kit.steel(0x6a6b5a, { roughness: 0.5 }), { at: [0, 0.71, 0], segments: 14 }));
  } else {
    // Tapón de izado (lifting plug) con argolla.
    g.add(kit.cyl(0.026, 0.026, 0.035, kit.steel(0x4a4c46), { at: [0, 0.725, 0], segments: 12 }));
    g.add(kit.torus(0.022, 0.006, kit.steel(0x4a4c46), { axis: 'x', at: [0, 0.762, 0], segments: 12 }));
  }
  return g;
}

/** Palé de 8 proyectiles verticales con adaptadores de madera y flejes. */
export function shellPallet(kit: ModelKit, opts: { at?: V3; rotDeg?: V3; count?: number } = {}): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const wood = kit.wood(0x8c7350);
  const strap = kit.steel(0x3d3f3a, { roughness: 0.6 });
  const pitch = 0.2;
  // Base y tapa de madera con alojamientos.
  g.add(kit.box(0.84, 0.44, 0.1, wood, { at: [0, 0, 0.05], bevel: 0.01 }));
  for (const x of [-0.36, 0, 0.36]) g.add(kit.box(0.08, 0.44, 0.08, wood, { at: [x, 0, -0.0] }));
  g.add(kit.box(0.84, 0.44, 0.05, wood, { at: [0, 0, 0.62], bevel: 0.008 }));
  const n = opts.count ?? 8;
  for (let i = 0; i < 8; i++) {
    if (i >= n) continue;
    const s = shell155(kit, { segments: 12 });
    s.rotation.x = Math.PI / 2; // eje +Y → +Z (de pie)
    s.position.set(-0.3 + (i % 4) * pitch, (i < 4 ? -1 : 1) * 0.1, 0.1);
    g.add(s);
  }
  // Flejes y postes de esquina.
  for (const x of [-0.42, 0.42]) {
    for (const y of [-0.22, 0.22]) g.add(kit.box(0.04, 0.04, 0.62, wood, { at: [x, y, 0.37] }));
  }
  for (const z of [0.2, 0.55]) {
    g.add(kit.box(0.86, 0.006, 0.025, strap, { at: [0, 0.225, z] }));
    g.add(kit.box(0.86, 0.006, 0.025, strap, { at: [0, -0.225, z] }));
    g.add(kit.box(0.006, 0.46, 0.025, strap, { at: [0.43, 0, z] }));
    g.add(kit.box(0.006, 0.46, 0.025, strap, { at: [-0.43, 0, z] }));
  }
  g.add(kit.stencil('155MM HE M795', 0.05, { at: [0, -0.226, 0.05], color: '#e9e4c9' }));
  return g;
}

/** Contenedores de carga propulsora (tubos con tapas) apilados en pirámide. */
export function chargeStack(kit: ModelKit, opts: { at?: V3; rotDeg?: V3 } = {}): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const body = kit.paint(0x5a5f3b, { roughness: 0.55, metalness: 0.1, wear: 0.35 });
  const cap = kit.polymer(0x2a2b27);
  const r = 0.1, len = 0.82;
  const rows = [4, 3, 2];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * (2 * r + 0.01);
      const z = r + row * (r * 1.75);
      const c = kit.group({ at: [x, 0, z] });
      c.add(kit.cyl(r, r, len, body, { segments: 18 }));
      c.add(kit.cyl(r * 1.04, r * 1.04, 0.05, cap, { at: [0, len / 2, 0], segments: 18 }));
      c.add(kit.cyl(r * 1.04, r * 1.04, 0.05, cap, { at: [0, -len / 2, 0], segments: 18 }));
      g.add(c);
    }
  });
  // Calzos de madera.
  const wood = kit.wood(0x7d6646);
  for (const y of [-0.3, 0.3]) g.add(kit.box(0.92, 0.07, 0.05, wood, { at: [0, y, 0.025] }));
  return g;
}

/** Incrementos sueltos de carga modular (MACS M232) en una lona. */
export function looseCharges(kit: ModelKit, opts: { at?: V3; rotDeg?: V3; n?: number } = {}): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const tan = kit.paint(0x9c8a5f, { roughness: 0.8, metalness: 0, wear: 0.4 });
  const band = kit.paint(0x6c4a2c, { roughness: 0.8, metalness: 0, wear: 0.3 });
  g.add(kit.box(1.2, 0.9, 0.01, kit.canvas(0x4f5236), { at: [0, 0, 0.005] }));
  const n = opts.n ?? 6;
  for (let i = 0; i < n; i++) {
    const x = -0.4 + (i % 3) * 0.32, y = i < 3 ? -0.18 : 0.18;
    const c = kit.group({ at: [x, y, 0.08], rotDeg: [0, 90, (i * 37) % 20 - 10] });
    c.add(kit.cyl(0.077, 0.077, 0.152, tan, { segments: 16 }));
    c.add(kit.cyl(0.0775, 0.0775, 0.02, band, { segments: 16, at: [0, 0.04, 0] }));
    g.add(c);
  }
  return g;
}

/** Caja de munición metálica / de madera con asas y rótulo. */
export function ammoCrate(kit: ModelKit, opts: { at?: V3; rotDeg?: V3; wood?: boolean; size?: V3; label?: string } = {}): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const [w, d, h] = opts.size ?? [0.72, 0.36, 0.3];
  const mat = opts.wood ? kit.wood(0x8a6e4a) : kit.paint(0x4d5330, { roughness: 0.6, metalness: 0.2, wear: 0.5 });
  g.add(kit.box(w, d, h, mat, { at: [0, 0, h / 2], bevel: opts.wood ? 0.008 : 0.015 }));
  g.add(kit.box(w + 0.01, d + 0.01, 0.03, mat, { at: [0, 0, h - 0.02], bevel: 0.006 }));
  const steel = kit.steel(0x3a3c38, { roughness: 0.55 });
  for (const s of [-1, 1]) {
    g.add(kit.handle(0.12, 0.04, 0.008, steel, { at: [s * (w / 2 + 0.002), 0, h * 0.6], rotDeg: [0, s * 90, 0] }));
  }
  if (opts.label) g.add(kit.stencil(opts.label, h * 0.18, { at: [0, -d / 2 - 0.003, h * 0.5] }));
  return g;
}

/**
 * Muro de sacos terreros en arco (planta): `radius`, de `a0` a `a1` grados
 * (0 = +Y, horario), `layers` hiladas.
 */
export function sandbagArc(kit: ModelKit, opts: { center: V3; radius: number; a0: number; a1: number; layers?: number }): THREE.Group {
  const g = kit.group({ at: opts.center });
  const mat = kit.canvas(0x8b7b57);
  const mat2 = kit.canvas(0x7c6d4c);
  const bagL = 0.48, bagW = 0.3, bagH = 0.13;
  const layers = opts.layers ?? 3;
  const D = Math.PI / 180;
  for (let l = 0; l < layers; l++) {
    const arcLen = Math.abs(opts.a1 - opts.a0) * D * opts.radius;
    const n = Math.max(1, Math.floor(arcLen / (bagL * 0.96)));
    for (let i = 0; i < n; i++) {
      const f = (i + (l % 2 ? 0.5 : 0) + 0.5) / (n + 0.5);
      const a = (opts.a0 + (opts.a1 - opts.a0) * f) * D;
      const x = Math.sin(a) * opts.radius, y = Math.cos(a) * opts.radius;
      const b = kit.box(bagL, bagW, bagH, (i + l) % 3 ? mat : mat2, {
        at: [x, y, bagH / 2 + l * bagH * 0.92], bevel: 0.055, bevelSegments: 1,
        rotDeg: [((i * 13) % 5) - 2, ((i * 7) % 5) - 2, -a / D + 90 + ((i * 11) % 9) - 4],
      });
      b.scale.set(1, 1, 0.9 + ((i * 17) % 7) * 0.02);
      g.add(b);
    }
  }
  return g;
}

/**
 * Red de camuflaje tendida sobre mástiles: malla desplazada (picos en los
 * mástiles, catenaria entre ellos) con material recortado por alfa.
 */
export function camoNet(kit: ModelKit, opts: { at?: V3; rotDeg?: V3; w: number; d: number; height: number; poles: Array<[number, number]> }): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const nx = 30, ny = 26;
  const geo = new THREE.PlaneGeometry(opts.w, opts.d, nx, ny);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const sig2 = 2 * 1.15 * 1.15;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // Toldo: suma de "tiendas" gaussianas en los mástiles con saturación
    // suave (tanh) → picos en los mástiles y catenaria entre ellos.
    let sum = 0;
    for (const [px, py] of opts.poles) sum += Math.exp(-((x - px) ** 2 + (y - py) ** 2) / sig2);
    let z = opts.height * Math.tanh(sum * 1.05);
    // Faldón hasta las estacas del borde.
    const ex = Math.min(1, (opts.w / 2 - Math.abs(x)) / 1.1), ey = Math.min(1, (opts.d / 2 - Math.abs(y)) / 1.1);
    const e = Math.max(0, Math.min(ex, ey));
    z = 0.08 + (z - 0.08) * (e * e * (3 - 2 * e));
    // Arrugas de la tela.
    z += 0.05 * Math.sin(x * 3.1 + y * 1.7) * Math.cos(y * 2.3 - x * 0.7);
    pos.setZ(i, Math.max(0.03, z));
  }
  geo.computeVertexNormals();
  const net = kit.mesh(geo, kit.camoNet());
  g.add(net);
  const pole = kit.steel(0x3e4133, { roughness: 0.7, metalness: 0.4 });
  for (const [px, py] of opts.poles) {
    let sum = 0;
    for (const [qx, qy] of opts.poles) sum += Math.exp(-((px - qx) ** 2 + (py - qy) ** 2) / sig2);
    const h = opts.height * Math.tanh(sum * 1.05) - 0.03;
    g.add(kit.cyl(0.02, 0.02, h, pole, { axis: 'z', at: [px, py, h / 2], segments: 8 }));
    g.add(kit.cyl(0.14, 0.14, 0.02, pole, { axis: 'z', at: [px, py, h], segments: 10 })); // separador
  }
  return g;
}

/** Atacador (palo de cargar) tendido o apoyado. */
export function rammerStaff(kit: ModelKit, opts: { at?: V3; rotDeg?: V3; len?: number } = {}): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const len = opts.len ?? 2.6;
  g.add(kit.cyl(0.02, 0.02, len, kit.wood(0x8a7550), { segments: 10 }));
  g.add(kit.cyl(0.075, 0.075, 0.1, kit.polymer(0x2b2c28), { at: [0, len / 2, 0], segments: 18 }));
  g.add(kit.cyl(0.03, 0.03, 0.2, kit.polymer(0x2b2c28), { at: [0, -len / 2 + 0.1, 0], segments: 10 }));
  return g;
}

/** Goniómetro M2A2 (aiming circle) sobre trípode. */
export function aimingCircle(kit: ModelKit, opts: { at?: V3; rotDeg?: V3 } = {}): THREE.Group {
  const g = kit.group({ at: opts.at, rotDeg: opts.rotDeg });
  const wood = kit.wood(0x7a6343);
  const black = kit.polymer(0x1f201e);
  const olive = kit.paint(0x4f5532, { roughness: 0.6, wear: 0.3 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const foot: V3 = [Math.sin(a) * 0.42, Math.cos(a) * 0.42, 0.0];
    g.add(kit.tube([foot, [Math.sin(a) * 0.05, Math.cos(a) * 0.05, 1.1]], 0.016, wood, { segments: 2 }));
  }
  g.add(kit.cyl(0.07, 0.07, 0.05, black, { axis: 'z', at: [0, 0, 1.12], segments: 16 }));
  g.add(kit.cyl(0.055, 0.06, 0.1, olive, { axis: 'z', at: [0, 0, 1.2], segments: 16 }));
  g.add(kit.box(0.06, 0.24, 0.06, olive, { at: [0, 0.02, 1.29], bevel: 0.01 }));
  g.add(kit.cyl(0.022, 0.022, 0.06, kit.glass(), { at: [0, 0.15, 1.29], segments: 10 }));
  return g;
}
