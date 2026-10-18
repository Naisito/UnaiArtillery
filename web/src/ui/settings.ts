// ============================================================================
//  settings.ts — Preferencias de la interfaz (persisten en localStorage).
//
//  Almacén diminuto con suscripción: unidades angulares (mil/grados),
//  formato de coordenadas, estado de los docks y pasos plegados. Tolerante a
//  almacenamiento bloqueado/corrupto: la app arranca con los valores de
//  fábrica y simplemente no persiste. (El MODAL de ajustes vive en
//  SettingsModal.ts: Windows no distingue mayúsculas en los nombres.)
// ============================================================================
import type { AngleUnit, CoordFormat } from './units';

export type RightTab = 'met' | 'table' | 'analysis' | 'training';

export interface UiSettings {
  /** Unidad principal de azimut/elevación (la otra se muestra secundaria). */
  angleUnit: AngleUnit;
  coordFormat: CoordFormat;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  rightTab: RightTab;
  /** Pasos de la misión de fuego plegados por el usuario. */
  foldedSteps: number[];
  /** Pliegue "avanzado" de la munición abierto. */
  advancedAmmo: boolean;
}

const KEY = 'unai-artillery/ui/v2';

const DEFAULTS: UiSettings = {
  angleUnit: 'mil',
  coordFormat: 'mgrs',
  leftCollapsed: false,
  rightCollapsed: false,
  rightTab: 'met',
  foldedSteps: [],
  advancedAmmo: false,
};

type Listener = (s: UiSettings, changed: (keyof UiSettings)[]) => void;

function sanitize(s: UiSettings): UiSettings {
  return {
    angleUnit: s.angleUnit === 'deg' ? 'deg' : 'mil',
    coordFormat: s.coordFormat === 'dd' || s.coordFormat === 'dms' ? s.coordFormat : 'mgrs',
    leftCollapsed: !!s.leftCollapsed,
    rightCollapsed: !!s.rightCollapsed,
    rightTab: (['met', 'table', 'analysis', 'training'] as RightTab[]).includes(s.rightTab)
      ? s.rightTab
      : 'met',
    foldedSteps: Array.isArray(s.foldedSteps) ? s.foldedSteps.filter((n) => Number.isInteger(n)) : [],
    advancedAmmo: !!s.advancedAmmo,
  };
}

class SettingsStore {
  private state: UiSettings = { ...DEFAULTS };
  private readonly listeners = new Set<Listener>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.state = sanitize({ ...DEFAULTS, ...(parsed as Partial<UiSettings>) });
        }
      }
    } catch {
      // sin almacenamiento o JSON corrupto: valores de fábrica
    }
  }

  get(): Readonly<UiSettings> {
    return this.state;
  }

  get angleUnit(): AngleUnit { return this.state.angleUnit; }
  get coordFormat(): CoordFormat { return this.state.coordFormat; }

  set(patch: Partial<UiSettings>): void {
    const changed = (Object.keys(patch) as (keyof UiSettings)[]).filter(
      (k) => JSON.stringify(this.state[k]) !== JSON.stringify(patch[k]),
    );
    if (changed.length === 0) return;
    this.state = sanitize({ ...this.state, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // sin persistencia
    }
    for (const fn of this.listeners) fn(this.state, changed);
  }

  /** Suscribe; devuelve la función para darse de baja. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Vuelve a los valores de fábrica (Restablecer sesión). */
  reset(): void {
    this.set({ ...DEFAULTS });
    try {
      localStorage.removeItem(KEY);
    } catch {
      // sin almacenamiento
    }
  }
}

/** Instancia única de la app. */
export const settings = new SettingsStore();
