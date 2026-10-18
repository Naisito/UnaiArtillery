// ============================================================================
//  Dispersion.ts — Presupuesto de errores ronda a ronda por arma.  [V2 · PHYS]
//
//  Sustituye las σ fijas de antes (0.3 % de V0, 1 mil, 0.6 m/s para TODO el
//  arsenal) por un presupuesto físico por clase de arma. Las σ son de las
//  CAUSAS (V0, puntería, arrastre, impulso, viento no medido); el error en
//  alcance y deriva sale de la física, así que la dependencia con el alcance
//  y la carga es la real, no una fórmula. Calibración contra los errores
//  probables (EP = 0.6745·σ) publicados en tablas de tiro:
//
//    * 155 mm: EP alcance ≈ 0.2-0.4 % del alcance (FT 155-AM-2: 15 m a 6 km
//      carga 5GB; 29 m a 12.1 km 7WB; M795 a Z4 y 14 km ≈ 27 m), EP deriva
//      ≈ 1/4-1/8 del de alcance.
//    * Mortero: EP mayores en proporción (cargas por incrementos, tubo liso).
//    * Cohete no guiado (M26): EP alcance ≈ 1-2 % (impulso del motor y
//      tip-off dominan).
//    * Guiados: CEP de navegación GPS/INS: Excalibur 2-4 m, GMLRS < 5 m
//      (medido 2.1-2.7 m), ATACMS ~9 m, PrSM ~5 m (no publicado).
//    * Armas ligeras: por MOA (M855 ~4 MOA; ametralladora en trípode, el
//      cono de fuego de ~2 mils).
//
//  Pura y determinista: la usan la salva dispersa (Monte-Carlo) y la elipse
//  predicha (linealización) con las MISMAS σ, así que siguen solapándose.
// ============================================================================
import type { Weapon } from './WeaponCatalog';
import { WeaponSystem } from './WeaponSystem';
import type { DispersionErrors, FireOrder } from './WeaponSystem';

export interface DispersionModel extends DispersionErrors {
  /** CEP (m) de la navegación de una munición guiada con objetivo marcado. */
  guidedCepM?: number;
  /** Texto corto para la UI ("tubo 155 mm", "cohete no guiado"…). */
  label: string;
}

/** 1 MOA en milésimas OTAN. */
const MOA_MILS = 6400 / (360 * 60);

/** σ angular por eje (mils) a partir de la dispersión en MOA (grupo de 5). */
const moaToSigmaMils = (moa: number): number => (moa * MOA_MILS) / 3;

export function dispersionModel(weapon: Weapon, order: FireOrder): DispersionModel {
  const v0 = WeaponSystem.muzzleVelocity(weapon, order);
  const r = weapon.round;
  const guided = r.guidance.enabled;

  switch (weapon.category) {
    case 'Howitzer':
      return {
        label: guided ? 'munición guiada 155 mm' : `tubo ${Math.round(r.diameter * 1000)} mm`,
        muzzleVelocityStd: Math.max(0.5, 0.0017 * v0), // lote homogéneo
        azimuthStdMils: 0.4,
        elevationStdMils: 0.4,
        windStd: 0.5,
        dragStd: 0.004,
        impulseStd: r.motor.enabled ? 0.01 : 0, // RAP
        guidedCepM: guided ? 3 : undefined,
      };
    case 'Mortar':
      return {
        label: 'mortero',
        muzzleVelocityStd: Math.max(0.4, 0.004 * v0),
        azimuthStdMils: 1.0,
        elevationStdMils: 1.0,
        windStd: 0.7,
        dragStd: 0.008,
      };
    case 'Rocket':
      return {
        label: guided ? 'cohete guiado' : 'cohete no guiado',
        muzzleVelocityStd: 0,
        azimuthStdMils: 5,    // tip-off + desalineación de empuje
        elevationStdMils: 5,
        windStd: 1.0,
        dragStd: 0.01,
        impulseStd: 0.008,
        guidedCepM: guided ? (/ER/i.test(r.name) ? 5 : 3) : undefined,
      };
    case 'Missile':
      return {
        label: 'misil balístico',
        muzzleVelocityStd: 0,
        azimuthStdMils: 1.5,
        elevationStdMils: 1.5,
        windStd: 1.0,
        dragStd: 0.01,
        impulseStd: 0.005,
        guidedCepM: guided ? (r.diameter > 0.5 ? 9 : 5) : undefined,
      };
    case 'SmallArms': {
      // Ametralladoras en trípode (cadencia definida): cono de fuego.
      const mg = weapon.rateOfFireRpm !== undefined;
      const moa = mg ? (r.diameter > 0.01 ? 5 : 6) : r.diameter < 0.0065 ? 4 : 5;
      const s = moaToSigmaMils(moa);
      return {
        label: mg ? 'ametralladora en trípode' : 'arma ligera',
        muzzleVelocityStd: 0.004 * v0,
        azimuthStdMils: s,
        elevationStdMils: s,
        windStd: 0.5,
        dragStd: 0.005,
      };
    }
  }
  return { label: 'genérico', muzzleVelocityStd: 0.003 * v0, azimuthStdMils: 1, elevationStdMils: 1, windStd: 0.6 };
}

/** Error probable (EP) a partir de una σ: EP = 0.6745·σ. */
export const probableError = (sigma: number): number => 0.6745 * sigma;
