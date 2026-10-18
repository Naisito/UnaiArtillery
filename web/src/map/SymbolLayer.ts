// ============================================================================
//  map/SymbolLayer.ts — Símbolos APP-6 de la situación táctica.  [V2:MAP]
//
//  Batería propia (variante por arma: artillería de campaña, cohetes, misil,
//  mortero, infantería; movilidad remolcada/cadenas/ruedas; escalón de
//  batería), puesto de observación, impactos reales (estallido que se
//  desvanece con el tiempo; el último lleva la corrección de observador
//  respecto al objetivo: LARGO/CORTO y DCHA/IZDA) y el "fantasma" que sigue
//  al cursor en los modos de designación. Todo con primitivas reutilizadas:
//  cero churn de entidades por movimiento de ratón.
// ============================================================================
import * as Cesium from 'cesium';
import { SYM, SymbolDef, applySymbol, warmSymbols } from './mapSymbols';
import { WeaponSymbolSpec } from './symbols';
import { FONT_DATA_SMALL, FONT_TAG, tagLabel, tokenColor } from './theme';

interface ImpactMark {
  bb: Cesium.Billboard;
  label: Cesium.Label | null;
  born: number;
}

/** Vida de una marca de impacto (s): plena, desvanecido y retirada. */
const IMPACT_FULL_S = 25;
const IMPACT_FADE_S = 150;
const IMPACT_MAX = 60;

export class SymbolLayer {
  private readonly bbs: Cesium.BillboardCollection;
  private readonly lbs: Cesium.LabelCollection;
  private readonly battery: Cesium.Billboard;
  private readonly batteryName: Cesium.Label;
  private readonly batteryInfo: Cesium.Label;
  private readonly observer: Cesium.Billboard;
  private readonly observerLabel: Cesium.Label;
  private readonly ghost: Cesium.Billboard;
  private impacts: ImpactMark[] = [];
  private ghostKey = '';

  constructor(private readonly viewer: Cesium.Viewer) {
    const scene = viewer.scene;
    this.bbs = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.lbs = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    // El símbolo de la batería se funde al acercarse: de cerca manda el
    // modelo 3D; de lejos, la simbología.
    const fadeNear = new Cesium.NearFarScalar(350, 0.0, 1100, 1.0);
    this.battery = this.bbs.add({
      position: Cesium.Cartesian3.ZERO,
      show: false,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: fadeNear,
      scaleByDistance: new Cesium.NearFarScalar(2e3, 1.0, 4e5, 0.65),
    });
    this.batteryName = this.lbs.add({
      ...tagLabel('', { font: FONT_TAG, color: tokenColor('--ua-friendly'), origin: 'left', vertical: 'bottom', offset: new Cesium.Cartesian2(27, -1) }),
      position: Cesium.Cartesian3.ZERO,
      show: false,
      translucencyByDistance: fadeNear,
    });
    this.batteryInfo = this.lbs.add({
      ...tagLabel('', { font: FONT_DATA_SMALL, origin: 'left', vertical: 'top', offset: new Cesium.Cartesian2(27, 2) }),
      position: Cesium.Cartesian3.ZERO,
      show: false,
      translucencyByDistance: fadeNear,
    });
    this.observer = this.bbs.add({
      position: Cesium.Cartesian3.ZERO,
      show: false,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(60, 0.0, 300, 1.0),
    });
    applySymbol(this.observer, SYM.observer());
    this.observerLabel = this.lbs.add({
      ...tagLabel('OP', { font: FONT_TAG, color: tokenColor('--ua-friendly'), origin: 'left', vertical: 'center', offset: new Cesium.Cartesian2(22, 0) }),
      position: Cesium.Cartesian3.ZERO,
      show: false,
      translucencyByDistance: new Cesium.NearFarScalar(60, 0.0, 300, 1.0),
    });
    this.ghost = this.bbs.add({
      position: Cesium.Cartesian3.ZERO,
      show: false,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    warmSymbols([SYM.burst(), SYM.target(0.65), SYM.observer()]);
  }

  // -- Batería -------------------------------------------------------------------
  setBattery(position: Cesium.Cartesian3, spec: WeaponSymbolSpec, name: string, info: string): void {
    this.battery.position = position;
    applySymbol(this.battery, SYM.battery(spec));
    this.battery.show = true;
    this.batteryName.position = position;
    this.batteryName.text = name;
    this.batteryName.show = true;
    this.batteryInfo.position = position;
    this.batteryInfo.text = info;
    this.batteryInfo.show = true;
  }

  setBatteryVisible(on: boolean): void {
    this.battery.show = on;
    this.batteryName.show = on;
    this.batteryInfo.show = on;
  }

  // -- Observador ----------------------------------------------------------------
  setObserver(position: Cesium.Cartesian3 | null): void {
    const on = !!position;
    this.observer.show = on;
    this.observerLabel.show = on;
    if (position) {
      this.observer.position = position;
      this.observerLabel.position = position;
    }
  }

  // -- Fantasma del cursor -------------------------------------------------------
  setGhost(def: SymbolDef | null, position?: Cesium.Cartesian3): void {
    if (!def || !position) {
      this.ghost.show = false;
      return;
    }
    if (def.key !== this.ghostKey) {
      this.ghostKey = def.key;
      applySymbol(this.ghost, def);
    }
    this.ghost.position = position;
    this.ghost.show = true;
  }

  // -- Impactos ------------------------------------------------------------------
  /**
   * Marca un impacto real. `spot` (opcional) es la corrección de observador
   * del último disparo respecto al objetivo (se muestra solo en el último).
   */
  addImpact(position: Cesium.Cartesian3, spot: string | null): void {
    // Solo el último impacto lleva rótulo de corrección.
    for (const m of this.impacts) {
      if (m.label) {
        this.lbs.remove(m.label);
        m.label = null;
      }
    }
    const bb = this.bbs.add({
      position,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(1.5e3, 1.0, 2e5, 0.55),
    });
    applySymbol(bb, SYM.burst());
    const label = spot
      ? this.lbs.add({
          ...tagLabel(spot, { font: FONT_DATA_SMALL, color: tokenColor('--ua-accent'), origin: 'left', vertical: 'center', offset: new Cesium.Cartesian2(14, 0) }),
          position,
        })
      : null;
    this.impacts.push({ bb, label, born: performance.now() });
    while (this.impacts.length > IMPACT_MAX) this.removeImpact(0);
  }

  /** Desvanece/retira los impactos viejos (llamar a baja frecuencia). */
  tickImpacts(now = performance.now()): void {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const m = this.impacts[i];
      const age = (now - m.born) / 1000;
      if (age > IMPACT_FADE_S) {
        this.removeImpact(i);
        continue;
      }
      const a = age <= IMPACT_FULL_S
        ? 1
        : Math.max(0.2, 1 - (0.8 * (age - IMPACT_FULL_S)) / (IMPACT_FADE_S - IMPACT_FULL_S));
      if (Math.abs(m.bb.color.alpha - a) > 0.02) {
        m.bb.color = Cesium.Color.WHITE.withAlpha(a);
        if (m.label) {
          m.label.fillColor = m.label.fillColor.withAlpha(a);
          m.label.backgroundColor = m.label.backgroundColor.withAlpha(0.82 * a);
        }
      }
    }
  }

  private removeImpact(i: number): void {
    const m = this.impacts[i];
    this.bbs.remove(m.bb);
    if (m.label) this.lbs.remove(m.label);
    this.impacts.splice(i, 1);
  }

  clearImpacts(): void {
    while (this.impacts.length) this.removeImpact(this.impacts.length - 1);
  }

  get impactCount(): number {
    return this.impacts.length;
  }

  dispose(): void {
    this.viewer.scene.primitives.remove(this.bbs);
    this.viewer.scene.primitives.remove(this.lbs);
  }
}
