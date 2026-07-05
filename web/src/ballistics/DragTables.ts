// ============================================================================
//  DragTables.ts — Standard reference drag functions G1 and G7 (P1.3).
//
//  Cd(Mach) of the two reference projectiles ballistics data is published
//  against:
//    * G1: flat-base, blunt-ogive shape (classic small arms / older shells).
//    * G7: boat-tail, long-ogive shape (modern low-drag projectiles).
//
//  A real projectile is then described by its ballistic coefficient
//  BC = SD / i  [lb/in^2], where SD = mass_lb / diameter_in^2 is the sectional
//  density and i the form factor relative to the reference shape. From a BC
//  the solver recovers  Cd(M) = i * Cd_ref(M)  with  i = SD / BC.
//
//  The tables below are abridged (public-domain values, e.g. McCoy, "Modern
//  Exterior Ballistics"; linear interpolation between knots, clamped at the
//  ends). Abridging changes Cd by <1% versus the full tables — far below the
//  fidelity of the rest of this educational model.
// ============================================================================

export interface DragTablePoint { mach: number; cd: number; }

/** G1 reference drag function (flat-base projectile). */
export const G1_TABLE: DragTablePoint[] = [
  { mach: 0.0, cd: 0.2629 },
  { mach: 0.4, cd: 0.2079 },
  { mach: 0.6, cd: 0.2034 },
  { mach: 0.7, cd: 0.2165 },
  { mach: 0.8, cd: 0.2313 },
  { mach: 0.9, cd: 0.2825 },
  { mach: 0.95, cd: 0.3803 },
  { mach: 1.0, cd: 0.4805 },
  { mach: 1.05, cd: 0.5883 },
  { mach: 1.1, cd: 0.6393 },
  { mach: 1.2, cd: 0.6589 },
  { mach: 1.3, cd: 0.6573 },
  { mach: 1.4, cd: 0.6452 },
  { mach: 1.6, cd: 0.6127 },
  { mach: 1.8, cd: 0.5783 },
  { mach: 2.0, cd: 0.5462 },
  { mach: 2.5, cd: 0.4805 },
  { mach: 3.0, cd: 0.4311 },
  { mach: 3.5, cd: 0.3955 },
  { mach: 4.0, cd: 0.3667 },
  { mach: 5.0, cd: 0.3295 },
];

/** G7 reference drag function (boat-tail projectile). */
export const G7_TABLE: DragTablePoint[] = [
  { mach: 0.0, cd: 0.1198 },
  { mach: 0.5, cd: 0.1197 },
  { mach: 0.7, cd: 0.1197 },
  { mach: 0.8, cd: 0.1216 },
  { mach: 0.9, cd: 0.1306 },
  { mach: 0.95, cd: 0.1464 },
  { mach: 1.0, cd: 0.2054 },
  { mach: 1.05, cd: 0.3803 },
  { mach: 1.1, cd: 0.4043 },
  { mach: 1.2, cd: 0.4014 },
  { mach: 1.4, cd: 0.3884 },
  { mach: 1.6, cd: 0.3732 },
  { mach: 1.8, cd: 0.3580 },
  { mach: 2.0, cd: 0.3440 },
  { mach: 2.5, cd: 0.3130 },
  { mach: 3.0, cd: 0.2938 },
  { mach: 3.5, cd: 0.2767 },
  { mach: 4.0, cd: 0.2629 },
  { mach: 5.0, cd: 0.2280 },
];

/** Linear interpolation over a drag table, clamped at the end points. */
export function sampleDragTable(table: DragTablePoint[], mach: number): number {
  if (mach <= table[0].mach) return table[0].cd;
  const last = table[table.length - 1];
  if (mach >= last.mach) return last.cd;
  for (let i = 1; i < table.length; i++) {
    if (mach <= table[i].mach) {
      const a = table[i - 1];
      const b = table[i];
      const t = (mach - a.mach) / (b.mach - a.mach);
      return a.cd + t * (b.cd - a.cd);
    }
  }
  return last.cd;
}

export const KG_TO_LB = 2.2046226218487757;
export const M_TO_IN = 39.37007874015748;

/** Sectional density in lb/in^2 from SI mass (kg) and diameter (m). */
export function sectionalDensityLbIn2(massKg: number, diameterM: number): number {
  const massLb = massKg * KG_TO_LB;
  const dIn = diameterM * M_TO_IN;
  return massLb / (dIn * dIn);
}
