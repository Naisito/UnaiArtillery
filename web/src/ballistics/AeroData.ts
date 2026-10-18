// ============================================================================
//  AeroData.ts — Datos aerodinámicos públicos para el punto-masa modificado
//  (STANAG 4355) de los proyectiles estabilizados por giro.  [V2 · PHYS]
//
//  ¡OJO CON LA NORMALIZACIÓN! SPIN-73 (Hudgins), PRODAS y ARFDAS normalizan
//  los términos de giro con pd/(2V); BRL spark-range, McCoy y STANAG 4355
//  con pd/V. Por eso:  C_spin(STANAG) = CLP/2,  C_mag-f = CYPA/2.
//  De ejes cuerpo a ejes viento (ángulo pequeño):
//      C_Lα  = C_Nα − C_X0
//      C_Dδ² = C_X2 + C_Nα − C_X0/2
//
//  Fuentes (espejos públicos de DTIC en archive.org):
//    * Hudgins 1977, "Aerodynamics, Dimensions, Inertial Properties, and
//      Performance of Artillery Projectiles" (ADB022223): tablas B-18 (M107),
//      B-37 (M106 8"), A-11 (deriva FT 155-AM-1).
//    * Karpov & Schmidt, BRL-MR-1582 (spark range M101/M107).
//    * Odom, BRL-MR-1167 (función de arrastre de tablas M101/M107).
//    * Lieske, BRL-MR-3870 (1990): C_mag-f = −0.75 de la base de datos de
//      tablas de tiro para el M107 (ajustado al tiempo de vuelo).
//    * Lieske, ADA209510 (M864, Q_D = 1.2 "normalmente usado en artillería").
//    * Whyte, BRL-CR-659 (spark range M483A1: casco largo 5.8 cal, base del
//      M864/M795-clase); C_mag-f de tablas −0.50 (M483A1 / M549A1).
//
//  Ninguna tabla de McCoy (libro con copyright) se copia aquí: son los datos
//  BRL públicos de los que salen.
// ============================================================================
import type { DragPoint, SpinAero } from './Munition';

/**
 * 155 mm M107 HE — SPIN-73 tabla B-18 convertida a forma STANAG, con la
 * fuerza Magnus de la base de datos de tablas (−0.75, Lieske 1990).
 * d = 154.74 mm, m = 43.09 kg, L = 4.524 cal, CG a 2.974 cal de la ojiva,
 * I_x = 455.2 lb·in² = 0.1332 kg·m², I_y = 4311 lb·in² = 1.262 kg·m².
 */
export const M107_AERO: SpinAero = {
  ixKgM2: 0.1332,
  iyKgM2: 1.262,
  mach: [0.6, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.35, 1.5, 1.75, 2.0, 2.5],
  cla: [1.626, 1.644, 1.678, 1.819, 1.829, 1.850, 1.899, 1.983, 2.111, 2.246, 2.374, 2.477, 2.636],
  cma: [3.390, 3.585, 3.927, 4.000, 3.810, 3.582, 3.548, 3.557, 3.468, 3.416, 3.243, 3.116, 2.876],
  cnpa: [-0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75],
  clp: [-0.0150, -0.0140, -0.0120, -0.0105, -0.0100, -0.0100, -0.0095, -0.0095, -0.0095,
    -0.0095, -0.0090, -0.0090, -0.0085],
  cda2: [4.06, 4.58, 5.13, 5.66, 6.18, 6.71, 7.24, 7.82, 7.41, 6.97, 6.52, 6.08, 5.56],
  fL: 1.0,
  qD: 1.2,
  qM: 1.0,
  maxYawRad: 0.6, // tope de las tablas de tiro (34.4°): limita el QE útil
  source: 'SPIN-73 B-18 (Hudgins 1977) en forma STANAG; C_mag-f −0.75 (Lieske BRL-MR-3870)',
};

/**
 * Función de arrastre de las TABLAS DE TIRO del M101/M107 (Odom, BRL-MR-1167):
 * C_D = (8/π)·K_D. Factor de forma de tablas i = 0.9853 (cargas 1–3; en
 * 5–7 es función lineal del ángulo de salida). Alternativa "sin calibrar" al
 * G7+BC: con ella el alcance del M107 sale de datos medidos.
 */
export const M107_FT_DRAG: DragPoint[] = [
  { mach: 0.5, cd: 0.1475 }, { mach: 0.8, cd: 0.1475 }, { mach: 0.9, cd: 0.1475 },
  { mach: 0.95, cd: 0.1918 }, { mach: 1.0, cd: 0.3381 }, { mach: 1.05, cd: 0.3833 },
  { mach: 1.1, cd: 0.3879 }, { mach: 1.2, cd: 0.3795 }, { mach: 1.35, cd: 0.3575 },
  { mach: 1.5, cd: 0.3405 }, { mach: 1.75, cd: 0.3140 }, { mach: 2.0, cd: 0.2907 },
  { mach: 2.5, cd: 0.2531 },
];
export const M107_FT_FORM_FACTOR = 0.9853;

/**
 * 155 mm de casco largo (M795 / M549A1 / M864 / M485 / M825 — clase 5.6–5.8
 * cal): coeficientes del spark range del M483A1 (Whyte, BRL-CR-659) en forma
 * STANAG (C_spin = Clp/2; C_Dδ² con C_X2 ≈ 2.3 subsónico / 4 supersónico),
 * inercias del M864 (Lieske ADA209510: I_x 0.158, I_y 1.657 kg·m², 46.95 kg)
 * y C_mag-f = −0.50 de las tablas del M483A1/M549A1. ESCALADO documentado:
 * no hay datos públicos del M795 propiamente dicho.
 */
export const LONG155_AERO: SpinAero = {
  ixKgM2: 0.158,
  iyKgM2: 1.657,
  mach: [0.68, 0.76, 0.85, 0.90, 0.93, 0.96, 1.00, 1.24, 1.55, 1.87, 2.07, 2.28],
  cla: [1.704, 1.837, 1.830, 1.687, 1.782, 1.915, 2.111, 2.150, 2.508, 2.071, 2.289, 2.568],
  cma: [4.26, 4.52, 4.75, 4.86, 4.60, 4.45, 4.63, 4.77, 4.88, 4.75, 4.62, 4.54],
  cnpa: [-0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5],
  clp: [-0.01425, -0.01425, -0.01425, -0.01425, -0.01425, -0.0140, -0.01375, -0.013,
    -0.012, -0.0115, -0.0115, -0.0115],
  cda2: [4.08, 4.21, 4.21, 4.08, 4.19, 4.34, 6.28, 6.34, 6.67, 6.22, 6.43, 6.70],
  fL: 1.0,
  qD: 1.2,
  qM: 1.0,
  maxYawRad: 0.6,
  source: 'M483A1 spark range (Whyte BRL-CR-659) + inercias M864 (Lieske ADA209510); escalado',
};

/**
 * 203 mm (OF-43 del 2S7): escalado del 8" M106 (SPIN-73 B-37, escaneo poco
 * legible): C_Nα 1.76 subsónico → 2.80 a M 2; C_Mα 3.4–3.6 subs., ~4.0 a
 * M 0.95, 3.04 a M 2; CLP/2 −0.0145 subs. / −0.009 sup.; C_mag-f −0.38 (FT).
 * Inercias del M106 (90.7 kg: I_x 0.53, I_y 4.25 kg·m²) escaladas por masa a
 * 110 kg. ESTIMACIÓN: el OF-43 real es más largo que el M106.
 */
export const OF43_AERO: SpinAero = {
  ixKgM2: 0.643,
  iyKgM2: 5.15,
  mach: [0.6, 0.9, 0.95, 1.0, 1.1, 1.5, 2.0, 2.5, 3.0],
  cla: [1.63, 1.66, 1.80, 1.84, 1.95, 2.25, 2.49, 2.60, 2.66],
  cma: [3.45, 3.60, 4.00, 3.80, 3.55, 3.30, 3.04, 2.90, 2.80],
  cnpa: [-0.38, -0.38, -0.38, -0.38, -0.38, -0.38, -0.38, -0.38, -0.38],
  clp: [-0.0145, -0.0135, -0.0120, -0.0110, -0.0100, -0.0095, -0.0090, -0.0088, -0.0086],
  cda2: [4.1, 4.6, 5.2, 6.0, 7.0, 6.9, 6.1, 5.6, 5.3],
  fL: 1.0,
  qD: 1.2,
  qM: 1.0,
  maxYawRad: 0.6,
  source: '8" M106 (SPIN-73 B-37) escalado por masa a 110 kg; estimación',
};

/**
 * Deriva publicada FT 155-AM-1 (M107, M557, M109A1 — Hudgins 1977 tabla A-11):
 * corrección a la IZQUIERDA en mils (el proyectil deriva a la derecha).
 * Referencia para validar el MPM.
 */
export const FT155AM1_DRIFT_CH8 = {
  muzzleVelocityMS: 684.3,
  low: [
    { rangeM: 2000, qeMils: 23.6, driftMils: 0.7 },
    { rangeM: 4000, qeMils: 53.1, driftMils: 1.8 },
    { rangeM: 6000, qeMils: 91.1, driftMils: 3.2 },
    { rangeM: 8000, qeMils: 141.4, driftMils: 5.2 },
    { rangeM: 10000, qeMils: 208.2, driftMils: 7.8 },
    { rangeM: 12000, qeMils: 291.5, driftMils: 11.0 },
    { rangeM: 14000, qeMils: 392.2, driftMils: 14.9 },
    { rangeM: 16000, qeMils: 518.6, driftMils: 20.1 },
    { rangeM: 17000, qeMils: 602.2, driftMils: 23.9 },
    { rangeM: 18100, qeMils: 781.5, driftMils: 33.7 },
  ],
  high: [
    { rangeM: 16000, qeMils: 1065.1, driftMils: 63.3 },
    { rangeM: 14000, qeMils: 1156.2, driftMils: 87.4 },
    { rangeM: 12000, qeMils: 1218.4, driftMils: 132.0 },
    { rangeM: 10504, qeMils: 1250.0, driftMils: 198.0 },
  ],
};
