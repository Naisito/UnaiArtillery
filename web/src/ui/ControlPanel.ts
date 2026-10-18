// ============================================================================
//  ControlPanel.ts — Dock izquierdo "MISIÓN DE FUEGO".  [V2/UI, antes P-WEB.4]
//
//  El flujo de una misión de fuego real, en cinco pasos numerados:
//    1 · SISTEMA DE ARMAS — tarjeta del arma + galería Arsenal.
//    2 · MUNICIÓN — proyectil, ESPOLETA (impacto/retardo/tiempo/proximidad),
//        carga y, plegado, condiciones de la carga (temperatura del
//        propelente y desgaste del tubo → FireOrder.v0Correction).
//    3 · OBJETIVO — designar en el mapa / mover la batería, datos del
//        objetivo (distancia, demora, Δcota, MGRS) y rama alta/baja.
//    4 · SOLUCIÓN DE TIRO — azimut y QE grandes (mil + grados), carga, TOF,
//        ápice, alcance, estado en/fuera de alcance y puntería fina
//        (instrumentos del cockpit + deslizadores con campo numérico).
//    5 · FUEGO — pie fijo: consola de estado, botón FUEGO (clic; MANTENER en
//        automáticas) y modos secundarios (MRSI ×3, salva ×6, comparar,
//        limpiar cráteres).
//
//  La clase conserva la API pública histórica (weaponId, chargeIndex,
//  roundIndex, azimuthDeg, elevationDeg, preferHighAngle, weapon(), setAim,
//  setStatus, setFiring, setPick*, setArcChecked, applyShared…) para que
//  ArtilleryPiece, los retos, la tabla de tiro y `window.__ua.panel` sigan
//  funcionando sin cambios. El estado interno SIEMPRE va en grados; las
//  milésimas son solo presentación (settings.angleUnit).
// ============================================================================
import { Weapon, WeaponCatalog, WeaponId } from '../ballistics';
import type { FuzeMode, FuzeSpec, V0Correction } from '../ballistics';
import { ArsenalModal, maxMuzzleVelocity } from './Arsenal';
import {
  Collapsible, Readout, SegOption, Segmented, SelectField, SliderField, button, chip,
  eyebrow, iconButton, kbd, setChip,
} from './components';
import { h, setText } from './dom';
import { IconName, icon, silhouette } from './icons';
import { settings } from './settings';
import {
  AngleUnit, UNIT_DECIMALS, UNIT_SUFFIX, bearingDegOf, distanceParts, fmtAngle, fmtAngleValue,
  fmtCoord, fmtNum, fmtSeconds, fromUnit, toUnit,
} from './units';
import { WEAPON_INFO } from './weaponInfo';

/** Modos de selección sobre el mapa (contrato §3.4 del plan V2). */
export type PickMode = 'none' | 'target' | 'battery' | 'measure';

export interface ControlCallbacks {
  onAimChanged(): void;
  onWeaponChanged(): void;
  /** P-PRO.4 — cambio de munición (índice en Weapon.rounds). */
  onRoundChanged(index: number): void;
  /** P-PRO.5 — cambio de carga (la tabla de tiro depende de ella). */
  onChargeChanged(): void;
  /** V2 — espoleta o condiciones de la carga cambiaron (re-preview). */
  onAmmoChanged(): void;
  /** V2 — rama alta/baja: con objetivo, re-resuelve la solución. */
  onBranchChanged(high: boolean): void;
  onFire(): void;
  /** P-VIVO.2 — armas automáticas: MANTENER pulsa/suelta la ráfaga. */
  onBurstStart(): void;
  onBurstEnd(): void;
  onMRSI(rounds: number): void;
  onCompare(): void;
  /** P-NEXT.7 — salva dispersa (zona batida) y limpieza de cráteres. */
  onDisperse(rounds: number): void;
  onClearCraters(): void;
  /** V2 — botones "Designar en mapa" / "Mover batería" (modo de picking). */
  onPickMode(mode: PickMode): void;
  /** V2 — quitar el objetivo designado. */
  onClearTarget(): void;
  /** Ocultar la parábola de preview (modo inmersión: solo el proyectil). */
  onToggleArc(visible: boolean): void;
}

/** Datos del preview vigente (ArtilleryPiece → paso 4). */
export interface PreviewInfo {
  rangeM: number;
  tofS: number;
  apexM: number;
  impactSpeedMS: number;
  angleOfFallDeg: number;
  maxRangeM: number;
  minRangeM: number;
  detonation: 'ground' | 'air' | 'buried';
}

/** Objetivo designado (ArtilleryPiece → paso 3). */
export interface TargetInfo {
  rangeM: number;
  bearingDeg: number;
  dzM: number;
  latDeg: number;
  lonDeg: number;
}

export type SolveState = 'manual' | 'solving' | 'ok' | 'out' | 'adjusted';

// ---------------------------------------------------------------------------
//  Presentación de cargas y municiones del catálogo (nombres en inglés).
// ---------------------------------------------------------------------------
export function chargeShort(name: string): string {
  const m = /Charge\s+(\d+)/i.exec(name);
  if (m) return `C${m[1]}`;
  const map: Record<string, string> = { reducida: 'Red.', intermedia: 'Int.', plena: 'Plena' };
  const key = Object.keys(map).find((k) => name.toLowerCase().includes(k));
  return key ? map[key] : name.slice(0, 5);
}

export function chargeLong(name: string): string {
  return name.replace(/Charge/i, 'Carga').replace(/\(max\)/i, '(máx.)');
}

const FUZE_LABEL: Record<FuzeMode, string> = {
  impact: 'Impacto',
  delay: 'Retardo',
  time: 'Tiempo',
  proximity: 'Proximidad',
};

const FUZE_HINT: Record<FuzeMode, string> = {
  impact: 'Detona al tocar el suelo (instantánea).',
  delay: 'Detona tras penetrar: mismo punto de impacto, explosión enterrada.',
  time: 'Estallido aéreo a los segundos fijados desde el disparo.',
  proximity: 'Estallido aéreo a la altura fijada sobre el suelo en la rama descendente.',
};

interface StepRefs {
  root: HTMLElement;
  head: HTMLButtonElement;
  num: HTMLElement;
  summary: HTMLElement;
  body: HTMLElement;
  aside: HTMLElement;
}

export class ControlPanel {
  weaponId: WeaponId = 'm777';
  chargeIndex = 3;
  /** P-PRO.4 — índice de munición en Weapon.rounds (0 = estándar). */
  roundIndex = 0;
  azimuthDeg = 90;
  elevationDeg = 45;
  preferHighAngle = false;

  // V2 — espoleta y condiciones de la carga.
  fuzeMode: FuzeMode = 'impact';
  fuzeTimeS = 20;
  fuzeHeightM = 7;
  propellantTempC = 21;
  tubeWearPct = 0;

  /** Raíz del dock (para el riel plegado y el tutorial). */
  readonly root: HTMLElement;
  /** Anfitrión de los instrumentos de puntería (lo rellena Cockpit). */
  readonly instrumentsHost: HTMLElement;

  private arcOn = true;
  private bursting = false; // P-VIVO.2 — botón FUEGO mantenido
  private firing = false;
  private pickMode: PickMode = 'none';
  private pickEnabled = true;
  private solveState: SolveState = 'manual';
  private preview: PreviewInfo | null = null;
  private target: TargetInfo | null = null;
  /** Puntería de la última solución (detecta el ajuste manual posterior). */
  private solvedLay: { az: number; el: number } | null = null;

  private readonly arsenal: ArsenalModal;
  private readonly steps: StepRefs[] = [];

  // Paso 1
  private wcardSil!: HTMLElement;
  private wcardName!: HTMLElement;
  private wcardRole!: HTMLElement;
  private wcardCal!: HTMLElement;
  private wcardRange!: Readout;
  private wcardV0!: Readout;
  private wcardRof!: Readout;
  // Paso 2
  private roundField!: SelectField;
  private roundStatic!: HTMLElement;
  private fuzeSeg!: Segmented<FuzeMode>;
  private fuzeRow!: HTMLElement;
  private fuzeNote!: HTMLElement;
  private fuzeParam!: SliderField;
  private chargeSeg!: Segmented<string>;
  private chargeStatic!: HTMLElement;
  private advanced!: Collapsible;
  private tempField!: SliderField;
  private wearField!: SliderField;
  private v0Readout!: Readout;
  // Paso 3
  private pickBtn!: HTMLButtonElement;
  private batteryBtn!: HTMLButtonElement;
  private pickHint!: HTMLElement;
  private targetBox!: HTMLElement;
  private targetEmpty!: HTMLElement;
  private tRange!: Readout;
  private tBearing!: Readout;
  private tDz!: Readout;
  private tGrid!: HTMLElement;
  private branchSeg!: Segmented<'low' | 'high'>;
  // Paso 4
  private solChip!: HTMLElement;
  private azReadout!: Readout;
  private elReadout!: Readout;
  private rCharge!: Readout;
  private rTof!: Readout;
  private rApex!: Readout;
  private rRange!: Readout;
  private rMax!: Readout;
  private rFall!: Readout;
  private azField!: SliderField;
  private elField!: SliderField;
  // Pie
  private statusEl!: HTMLElement;
  private fdAz!: HTMLElement;
  private fdEl!: HTMLElement;
  private fdRange!: HTMLElement;
  private fdTof!: HTMLElement;
  private fdChip!: HTMLElement;
  private fireBtn!: HTMLButtonElement;
  private fireSub!: HTMLElement;
  private modeBtns: HTMLButtonElement[] = [];

  constructor(private readonly cb: ControlCallbacks) {
    this.root = document.getElementById('leftDock')!;
    this.root.textContent = '';
    this.arsenal = new ArsenalModal(this.weaponId, (id) => this.selectWeapon(id));
    this.instrumentsHost = h('div', { id: 'cockpit', class: 'instruments' });

    const body = h('div', { class: 'dock-body', attrs: { tabindex: -1 } });
    body.append(
      this.buildWeaponStep(),
      this.buildAmmoStep(),
      this.buildTargetStep(),
      this.buildSolutionStep(),
    );

    this.root.append(
      h('header', { class: 'dock-head' },
        h('div', { class: 'dock-head__titles' },
          eyebrow('Misión de fuego'),
          h('span', { class: 'dock-head__sub', text: 'Arma · Munición · Objetivo · Solución · Fuego' }),
        ),
        iconButton({
          icon: 'panelLeft', label: 'Plegar el panel de misión', testid: 'left-collapse',
          onClick: () => settings.set({ leftCollapsed: !settings.get().leftCollapsed }),
        }),
      ),
      body,
      this.buildFireFooter(),
      this.buildRail(),
    );

    // Unidades / plegados persistidos.
    settings.subscribe((_s, changed) => {
      if (changed.includes('angleUnit')) this.refreshUnits();
    });

    this.rebuildRounds();
    this.rebuildCharges();
    this.applyWeaponLimits();
    this.refreshWeaponCard();
    this.refreshFuze();
    this.refreshUnits();
    this.refreshTarget();
    this.refreshSolution();
    this.setStatus('Listo. Designa un objetivo en el mapa o apunta a mano y pulsa FUEGO.');
  }

  // =========================================================================
  //  Construcción
  // =========================================================================
  private step(n: number, title: string, iconName: IconName, testid: string, ...content: HTMLElement[]): HTMLElement {
    const folded = settings.get().foldedSteps.includes(n);
    const num = h('span', { class: 'step__num num', text: String(n) });
    const summary = h('span', { class: 'step__summary' });
    const aside = h('span', { class: 'step__aside' });
    const head = h('button', {
      class: 'step__head',
      testid: `${testid}-head`,
      attrs: { type: 'button', 'aria-expanded': String(!folded) },
    },
      num,
      h('span', { class: 'step__titles' },
        h('span', { class: 'step__title' }, icon(iconName, 14), title),
        summary,
      ),
      aside,
      icon('chevronDown', 16, 'step__chev'),
    );
    const bodyEl = h('div', { class: 'step__body' }, ...content);
    bodyEl.hidden = folded;
    const root = h('section', { class: `step ${folded ? '' : 'is-open'}`, testid, dataset: { step: String(n) } }, head, bodyEl);
    head.addEventListener('click', () => {
      const open = bodyEl.hidden;
      bodyEl.hidden = !open;
      root.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', String(open));
      const f = new Set(settings.get().foldedSteps);
      if (open) f.delete(n);
      else f.add(n);
      settings.set({ foldedSteps: [...f].sort() });
    });
    this.steps[n] = { root, head, num, summary, body: bodyEl, aside };
    return root;
  }

  private buildWeaponStep(): HTMLElement {
    this.wcardSil = h('div', { class: 'wcard__sil' });
    this.wcardName = h('span', { class: 'wcard__name', testid: 'weapon-name' });
    this.wcardRole = h('span', { class: 'wcard__role' });
    this.wcardCal = h('span', { class: 'wcard__cal num' });
    this.wcardRange = new Readout('Alcance', { size: 's', gloss: 'alcance' });
    this.wcardV0 = new Readout('V0 máx.', { size: 's', gloss: 'v0' });
    this.wcardRof = new Readout('Cadencia', { size: 's' });
    const arsenalBtn = button({
      label: 'Arsenal', icon: 'grid', size: 's', variant: 'secondary', testid: 'arsenal-open',
      id: 'weaponSelect', title: 'Cambiar de sistema de armas (14 sistemas)',
      onClick: () => this.arsenal.open(),
    });
    const card = h('div', { class: 'wcard' },
      h('button', {
        class: 'wcard__hit', attrs: { type: 'button', 'aria-label': 'Abrir el Arsenal' },
        on: { click: () => this.arsenal.open() },
      }),
      h('div', { class: 'wcard__media' }, this.wcardSil, arsenalBtn),
      h('div', { class: 'wcard__id' },
        h('div', { class: 'wcard__names' },
          h('div', { class: 'wcard__nameline' }, this.wcardName, this.wcardCal),
          this.wcardRole,
        ),
        h('div', { class: 'wcard__stats' }, this.wcardRange.el, this.wcardV0.el, this.wcardRof.el),
      ),
    );
    return this.step(1, 'Sistema de armas', 'cannon', 'step-weapon', card);
  }

  private buildAmmoStep(): HTMLElement {
    // Proyectil.
    this.roundField = new SelectField(null, { testid: 'round-select', ariaLabel: 'Proyectil' });
    this.roundField.onChange = (v) => {
      this.roundIndex = Number(v);
      this.refreshFuze();
      this.refreshStepSummaries();
      this.cb.onRoundChanged(this.roundIndex);
    };
    this.roundStatic = h('div', { class: 'field-static' });

    // Espoleta.
    const fuzeOpts: SegOption<FuzeMode>[] = (['impact', 'delay', 'time', 'proximity'] as FuzeMode[]).map((m) => ({
      value: m, label: FUZE_LABEL[m], title: FUZE_HINT[m], testid: `fuze-${m}`,
    }));
    this.fuzeSeg = new Segmented(fuzeOpts, 'impact', { ariaLabel: 'Espoleta', size: 's' });
    this.fuzeSeg.onChange = (m) => {
      this.fuzeMode = m;
      this.refreshFuze();
      this.refreshStepSummaries();
      this.cb.onAmmoChanged();
    };
    this.fuzeParam = new SliderField({
      label: 'Tiempo de espoleta', min: 1, max: 200, step: 0.5, value: this.fuzeTimeS, unit: 's',
      decimals: 1, testid: 'fuze-param', icon: 'timer',
    });
    this.fuzeParam.onInput = (v) => {
      if (this.fuzeMode === 'time') this.fuzeTimeS = v;
      else this.fuzeHeightM = v;
      this.refreshStepSummaries();
      this.cb.onAmmoChanged();
    };
    this.fuzeNote = h('p', { class: 'field-note' });
    const fuzeLabel = h('span', { class: 'ua-field__label', text: 'Espoleta', dataset: { gloss: 'espoleta' } });
    this.fuzeRow = h('div', { class: 'frow' }, fuzeLabel,
      h('div', { class: 'frow__ctl' }, this.fuzeSeg.el, this.fuzeParam.el, this.fuzeNote));

    // Carga.
    this.chargeSeg = new Segmented<string>([], '0', { ariaLabel: 'Carga de proyección', testid: 'charge-seg' });
    this.chargeSeg.onChange = (v) => {
      this.chargeIndex = Number(v);
      this.refreshWeaponCard();
      this.refreshV0();
      this.refreshStepSummaries();
      this.cb.onChargeChanged();
    };
    this.chargeStatic = h('div', { class: 'field-static' });
    const chargeLabel = h('span', { class: 'ua-field__label', text: 'Carga', dataset: { gloss: 'carga' } });

    // Avanzado: condiciones de la carga (V0 efectiva).
    this.tempField = new SliderField({
      label: 'Temperatura del propelente', min: -40, max: 60, step: 1, value: this.propellantTempC,
      unit: '°C', testid: 'prop-temp', gloss: 'temppropelente', icon: 'thermometer',
    });
    this.tempField.onInput = (v) => {
      this.propellantTempC = v;
      this.refreshV0();
      this.cb.onAmmoChanged();
    };
    this.wearField = new SliderField({
      label: 'Desgaste del tubo (pérdida de V0)', min: 0, max: 6, step: 0.1, value: this.tubeWearPct,
      unit: '%', decimals: 1, testid: 'tube-wear', gloss: 'desgaste', icon: 'gauge',
    });
    this.wearField.onInput = (v) => {
      this.tubeWearPct = v;
      this.refreshV0();
      this.cb.onAmmoChanged();
    };
    this.v0Readout = new Readout('V0 efectiva', { size: 's', tone: 'info', gloss: 'v0', testid: 'v0-effective' });
    const resetBtn = button({
      label: 'Estándar', size: 's', variant: 'ghost', icon: 'reset', title: 'Volver a 21 °C y tubo nuevo',
      onClick: () => {
        this.propellantTempC = 21;
        this.tubeWearPct = 0;
        this.tempField.set(21);
        this.wearField.set(0);
        this.refreshV0();
        this.cb.onAmmoChanged();
      },
    });
    this.advanced = new Collapsible('Condiciones de la carga', settings.get().advancedAmmo, {
      testid: 'ammo-advanced', className: 'ammo-adv',
    });
    this.advanced.onToggle = (open) => settings.set({ advancedAmmo: open });
    this.advanced.body.append(
      this.tempField.el,
      this.wearField.el,
      h('div', { class: 'v0-row' }, this.v0Readout.el, resetBtn),
    );

    return this.step(2, 'Munición', 'ammo', 'step-ammo',
      h('div', { class: 'frow' }, h('span', { class: 'ua-field__label', text: 'Proyectil' }), h('div', { class: 'frow__ctl' }, this.roundField.el, this.roundStatic)),
      this.fuzeRow,
      h('div', { class: 'frow' }, chargeLabel, h('div', { class: 'frow__ctl' }, this.chargeSeg.el, this.chargeStatic)),
      this.advanced.el,
    );
  }

  private buildTargetStep(): HTMLElement {
    this.pickBtn = button({
      label: 'Designar en mapa', icon: 'target', size: 'm', testid: 'pick-target', id: 'pickTargetBtn',
      title: 'Clic en el mapa para fijar el objetivo: la dirección de tiro resuelve sola (T)',
      onClick: () => this.cb.onPickMode(this.pickMode === 'target' ? 'none' : 'target'),
    });
    this.batteryBtn = button({
      label: 'Mover batería', icon: 'battery', size: 'm', testid: 'move-battery',
      title: 'Clic en el mapa para desplegar la batería en otro asentamiento (B)',
      onClick: () => this.cb.onPickMode(this.pickMode === 'battery' ? 'none' : 'battery'),
    });
    this.pickHint = h('div', { class: 'pick-hint', attrs: { role: 'status' } });
    this.pickHint.hidden = true;

    this.tRange = new Readout('Distancia', { size: 'm', gloss: 'alcance', testid: 'target-range' });
    this.tBearing = new Readout('Demora', { size: 'm', gloss: 'azimut' });
    this.tDz = new Readout('Δ Cota', { size: 'm', gloss: 'cota' });
    this.tGrid = h('span', { class: 'target-grid num', testid: 'target-grid' });
    const clearBtn = iconButton({
      icon: 'close', label: 'Quitar objetivo', size: 's', testid: 'clear-target',
      onClick: () => this.cb.onClearTarget(),
    });
    this.targetBox = h('div', { class: 'target-box' },
      h('div', { class: 'target-box__head' },
        h('span', { class: 'target-box__sym' }),
        h('span', { class: 'target-box__title', text: 'Objetivo designado' }),
        clearBtn,
      ),
      h('div', { class: 'target-box__grid' }, this.tRange.el, this.tBearing.el, this.tDz.el),
      h('div', { class: 'target-box__coord' }, h('span', { class: 'ua-eyebrow', text: 'Coord.', dataset: { gloss: 'mgrs' } }), this.tGrid),
    );
    this.targetEmpty = h('div', { class: 'target-empty' },
      icon('target', 18),
      h('span', { text: 'Sin objetivo: designa uno en el mapa o apunta a mano en el paso 4.' }),
    );

    this.branchSeg = new Segmented<'low' | 'high'>([
      { value: 'low', label: 'Rama baja', testid: 'branch-low', title: 'Tiro rasante: menor tiempo de vuelo' },
      { value: 'high', label: 'Rama alta', testid: 'branch-high', title: 'Tiro por elevación (> 800 mil): bate detrás de crestas (H)' },
    ], 'low', { ariaLabel: 'Rama de la trayectoria', size: 's', testid: 'branch' });
    this.branchSeg.onChange = (v) => {
      this.preferHighAngle = v === 'high';
      this.cb.onBranchChanged(this.preferHighAngle);
      this.refreshStepSummaries();
    };
    const branchLabel = h('span', { class: 'ua-field__label', text: 'Rama', dataset: { gloss: 'rama' } });

    return this.step(3, 'Objetivo', 'target', 'step-target',
      h('div', { class: 'btn-pair' }, this.pickBtn, this.batteryBtn),
      this.pickHint,
      this.targetBox,
      this.targetEmpty,
      h('div', { class: 'frow' }, branchLabel, h('div', { class: 'frow__ctl' }, this.branchSeg.el)),
    );
  }

  private buildSolutionStep(): HTMLElement {
    this.solChip = chip('Puntería manual', 'muted', 'solution-state');
    this.azReadout = new Readout('Azimut', { size: 'xl', gloss: 'azimut', testid: 'sol-az' });
    this.elReadout = new Readout('Elevación (QE)', { size: 'xl', gloss: 'qe', testid: 'sol-el' });
    this.rCharge = new Readout('Carga', { size: 's', gloss: 'carga' });
    this.rTof = new Readout('Tiempo de vuelo', { size: 's', gloss: 'tof', testid: 'sol-tof' });
    this.rApex = new Readout('Ápice', { size: 's', gloss: 'apice' });
    this.rRange = new Readout('Alcance', { size: 's', gloss: 'alcance', testid: 'solution-range', tone: 'info' });
    this.rMax = new Readout('Alcance máx.', { size: 's', gloss: 'alcance' });
    this.rFall = new Readout('Ángulo de caída', { size: 's', gloss: 'caida' });

    this.azField = new SliderField({
      label: 'Azimut', min: 0, max: 6400, step: 1, value: 0, unit: 'mil', decimals: 1,
      testid: 'az', gloss: 'azimut', wrap: true,
    });
    this.azField.range.id = 'azimuthInput';
    this.azField.onInput = (v) => {
      const unit = settings.angleUnit;
      this.azimuthDeg = ((fromUnit(v, unit) % 360) + 360) % 360;
      this.afterManualLay();
    };
    this.elField = new SliderField({
      label: 'Elevación (QE)', min: 0, max: 1600, step: 1, value: 0, unit: 'mil', decimals: 1,
      testid: 'el', gloss: 'qe',
    });
    this.elField.range.id = 'elevationInput';
    this.elField.onInput = (v) => {
      const w = this.weapon();
      const deg = fromUnit(v, settings.angleUnit);
      this.elevationDeg = Math.min(Math.max(deg, w.minElevationDeg), w.maxElevationDeg);
      this.afterManualLay();
    };

    const fine = new Collapsible(
      h('span', null, 'Puntería fina ', kbd('←'), kbd('→'), kbd('↑'), kbd('↓')),
      !settings.get().foldedSteps.includes(41),
      { testid: 'fine-lay', className: 'fine-lay' },
    );
    fine.onToggle = (open) => {
      const f = new Set(settings.get().foldedSteps);
      if (open) f.delete(41);
      else f.add(41);
      settings.set({ foldedSteps: [...f].sort() });
    };
    fine.body.append(this.instrumentsHost, this.azField.el, this.elField.el);

    const s = this.step(4, 'Solución de tiro', 'angle', 'step-solution',
      h('div', { class: 'sol-main', testid: 'solution' }, this.azReadout.el, this.elReadout.el),
      h('div', { class: 'sol-grid' },
        this.rRange.el, this.rTof.el, this.rApex.el, this.rCharge.el, this.rMax.el, this.rFall.el,
      ),
      fine.el,
    );
    this.steps[4].aside.appendChild(this.solChip);
    return s;
  }

  private buildFireFooter(): HTMLElement {
    this.statusEl = h('div', { class: 'fire-status', testid: 'status-line', attrs: { role: 'status', 'aria-live': 'polite' } });
    const fd = (label: string, gloss: string) => {
      const v = h('span', { class: 'fd__v num' });
      return { el: h('div', { class: 'fd' }, h('span', { class: 'fd__k', text: label, dataset: { gloss } }), v), v };
    };
    // (los valores llevan la unidad en un <small> para que no se trunquen)
    const fAz = fd('AZ', 'azimut');
    const fEl = fd('QE', 'qe');
    const fRange = fd('ALC', 'alcance');
    const fTof = fd('TOF', 'tof');
    this.fdAz = fAz.v;
    this.fdEl = fEl.v;
    this.fdRange = fRange.v;
    this.fdTof = fTof.v;
    this.fdRange.dataset.testid = 'fire-data-range';
    this.fdChip = chip('Manual', 'muted');
    this.fireSub = h('span', { class: 'fire-sub' });
    this.fireBtn = button({ label: 'Fuego', icon: 'fire', variant: 'fire', kbd: 'F', id: 'fireBtn', testid: 'fire' });
    this.fireBtn.appendChild(this.fireSub);
    // P-VIVO.2 — con cadencia definida el botón pasa a MANTENER: pointerdown
    // abre la ráfaga y pointerup/cancel la corta al instante. El click de las
    // armas clásicas sigue siendo tiro a tiro.
    this.fireBtn.onclick = () => {
      if (!this.weapon().rateOfFireRpm) this.cb.onFire();
    };
    this.fireBtn.addEventListener('pointerdown', (ev) => {
      if (!this.weapon().rateOfFireRpm) return;
      this.fireBtn.setPointerCapture(ev.pointerId);
      this.bursting = true;
      this.fireBtn.classList.add('is-holding');
      this.cb.onBurstStart();
    });
    const stopBurst = (ev: PointerEvent) => {
      if (!this.bursting) return;
      this.bursting = false;
      this.fireBtn.classList.remove('is-holding');
      if (this.fireBtn.hasPointerCapture(ev.pointerId)) {
        this.fireBtn.releasePointerCapture(ev.pointerId);
      }
      this.cb.onBurstEnd();
    };
    this.fireBtn.addEventListener('pointerup', stopBurst);
    this.fireBtn.addEventListener('pointercancel', stopBurst);

    const mode = (label: string, iconName: IconName, testid: string, title: string, fn: () => void, id?: string) => {
      const b = h('button', {
        class: 'fire-mode', testid, id, attrs: { type: 'button' }, dataset: { tip: title },
        on: { click: fn },
      }, icon(iconName, 18), h('span', { text: label }));
      this.modeBtns.push(b);
      return b;
    };
    const modes = h('div', { class: 'fire-modes' },
      mode('MRSI ×3', 'mrsi', 'mrsi', 'Varias rondas a distinta elevación y carga que impactan a la vez', () => this.cb.onMRSI(3)),
      mode('Salva ×6', 'salvo', 'salvo', 'Seis tiros con errores realistas (σ V0, puntería, viento): los cráteres dibujan la dispersión', () => this.cb.onDisperse(6), 'disperseBtn'),
      mode('Comparar', 'compare', 'compare', 'Comparar físicas: vacío, arrastre, Coriolis y viento sobre el mismo tiro', () => this.cb.onCompare()),
      mode('Cráteres', 'trash', 'clear-craters', 'Limpiar todas las huellas de impacto del terreno', () => this.cb.onClearCraters()),
    );
    return h('footer', { class: 'dock-foot fire-console', testid: 'step-fire' },
      h('div', { class: 'fire-console__head' },
        h('span', { class: 'step__num num', text: '5' }),
        eyebrow('Datos de tiro'),
        h('span', { class: 'fire-console__grow' }),
        this.fdChip,
      ),
      h('div', { class: 'fire-data', testid: 'fire-data' }, fAz.el, fEl.el, fRange.el, fTof.el),
      this.fireBtn,
      modes,
      this.statusEl,
    );
  }

  /** Riel del dock plegado: pasos como iconos + FUEGO. */
  private buildRail(): HTMLElement {
    const go = (n: number) => () => {
      settings.set({ leftCollapsed: false });
      requestAnimationFrame(() => this.steps[n]?.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    };
    const item = (n: number, ic: IconName, label: string) =>
      iconButton({ icon: ic, label: `${n} · ${label}`, onClick: go(n) });
    const fire = iconButton({
      icon: 'fire', label: 'Fuego (F)', className: 'rail__fire', variant: 'primary',
      onClick: () => { if (!this.weapon().rateOfFireRpm) this.cb.onFire(); },
    });
    return h('nav', { class: 'dock-rail', attrs: { 'aria-label': 'Misión de fuego (plegada)' } },
      iconButton({
        icon: 'panelLeft', label: 'Desplegar el panel de misión', testid: 'left-expand',
        onClick: () => settings.set({ leftCollapsed: false }),
      }),
      h('span', { class: 'rail__sep' }),
      item(1, 'cannon', 'Sistema de armas'),
      item(2, 'ammo', 'Munición'),
      item(3, 'target', 'Objetivo'),
      item(4, 'angle', 'Solución de tiro'),
      h('span', { class: 'rail__grow' }),
      fire,
    );
  }

  // =========================================================================
  //  Arma / munición / carga
  // =========================================================================
  /** Selección desde el Arsenal (equivalente al antiguo onchange del select). */
  selectWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.rebuildRounds();
    this.rebuildCharges();
    this.applyWeaponLimits();
    this.arsenal.mark(id);
    this.refreshWeaponCard();
    this.refreshFuze();
    this.refreshV0();
    this.refreshStepSummaries();
    this.cb.onWeaponChanged();
  }

  openArsenal(): void { this.arsenal.open(); }

  /** Arma con la munición seleccionada aplicada (P-PRO.4). */
  weapon(): Weapon {
    const w = WeaponCatalog.get(this.weaponId);
    const alt = w.rounds?.[this.roundIndex];
    if (alt) w.round = alt;
    return w;
  }

  /** P-PRO.4 — repuebla el selector de munición (oculto si no hay opciones). */
  private rebuildRounds(): void {
    const w = WeaponCatalog.get(this.weaponId);
    this.roundIndex = 0;
    const rounds = w.rounds ?? [];
    const many = rounds.length > 1;
    this.roundField.el.hidden = !many;
    this.roundStatic.hidden = many;
    if (many) {
      this.roundField.setOptions(
        rounds.map((r, i) => ({ value: String(i), label: `${r.name} · ${r.mass.toFixed(1)} kg` })),
        '0',
      );
    } else {
      const r = w.round;
      this.roundStatic.textContent = '';
      this.roundStatic.append(
        h('span', { class: 'ua-field__label', text: 'Proyectil' }),
        h('span', { class: 'field-static__v' },
          h('span', { text: r.name }),
          h('span', { class: 'num ua-muted', text: r.mass >= 1 ? `${r.mass.toFixed(1)} kg` : `${(r.mass * 1000).toFixed(1)} g` }),
        ),
      );
    }
  }

  private rebuildCharges(): void {
    const w = this.weapon();
    if (w.charges.length === 0) {
      this.chargeIndex = -1;
      this.chargeSeg.el.hidden = true;
      this.chargeStatic.hidden = false;
      const txt =
        w.category === 'Rocket' || w.category === 'Missile' ? 'Motor cohete (impulso fijo)'
        : w.category === 'SmallArms' ? 'Cartucho único'
        : 'Carga única';
      this.chargeStatic.textContent = '';
      this.chargeStatic.append(
        h('span', { text: txt }),
        h('span', { class: 'num ua-muted', text: `V0 ${w.round.muzzleVelocity.toFixed(0)} m/s` }),
      );
      return;
    }
    this.chargeSeg.el.hidden = false;
    this.chargeStatic.hidden = true;
    this.chargeIndex = w.charges.length - 1;
    this.chargeSeg.setOptions(
      w.charges.map((c, i) => ({
        value: String(i),
        label: chargeShort(c.name),
        sub: `${c.muzzleVelocity.toFixed(0)}`,
        title: `${chargeLong(c.name)} · V0 ${c.muzzleVelocity.toFixed(0)} m/s`,
        testid: `charge-${i}`,
      })),
      String(this.chargeIndex),
    );
  }

  private applyWeaponLimits(): void {
    const w = this.weapon();
    this.elevationDeg = Math.min(Math.max(this.elevationDeg, w.minElevationDeg), w.maxElevationDeg);
    this.configureLayFields();
    this.reflectLay();
  }

  private refreshWeaponCard(): void {
    const info = WEAPON_INFO[this.weaponId];
    this.wcardSil.textContent = '';
    this.wcardSil.appendChild(silhouette(info.silhouette, 104));
    setText(this.wcardName, info.designation);
    setText(this.wcardRole, info.role);
    setText(this.wcardCal, info.caliber);
    this.wcardRange.set(info.publishedRange.split('·')[0].replace(/\s*\(.*\)/, '').replace(/\s+(HE|eficaz.*)$/, '').trim());
    this.wcardRange.el.title = info.publishedRange;
    this.wcardV0.set(fmtNum(maxMuzzleVelocity(this.weaponId), 0), 'm/s');
    this.wcardRof.set(info.rateOfFire.split('·')[0].replace(/\s*\(.*\)/, '').replace(/\s+máx\.?/, '').trim());
    this.wcardRof.el.title = info.rateOfFire;
    const rpm = WeaponCatalog.get(this.weaponId).rateOfFireRpm;
    setText(this.fireSub, rpm ? `Mantener · ráfaga ${rpm} dpm` : '');
    this.fireBtn.classList.toggle('is-auto', !!rpm);
    this.refreshStepSummaries();
  }

  // =========================================================================
  //  Espoleta y condiciones de la carga
  // =========================================================================
  private refreshFuze(): void {
    const w = this.weapon();
    const small = w.category === 'SmallArms';
    const illum = w.round.payload === 'illum';
    this.fuzeRow.hidden = small;
    this.fuzeSeg.setDisabled(illum);
    if (illum) {
      this.fuzeSeg.set('time');
      this.fuzeParam.el.hidden = true;
      setText(this.fuzeNote, 'Iluminación: espoleta de tiempo automática (TOF previsto − 0.5 s) para abrir la bengala en altura.');
      this.fuzeNote.hidden = false;
      return;
    }
    this.fuzeSeg.set(this.fuzeMode);
    const m = this.fuzeMode;
    if (m === 'time') {
      this.fuzeParam.configure({ label: 'Tiempo de espoleta', min: 1, max: 300, step: 0.5, unit: 's', decimals: 1 });
      this.fuzeParam.set(this.fuzeTimeS);
      this.fuzeParam.el.hidden = false;
    } else if (m === 'proximity') {
      this.fuzeParam.configure({ label: 'Altura de estallido', min: 1, max: 30, step: 1, unit: 'm', decimals: 0 });
      this.fuzeParam.set(this.fuzeHeightM);
      this.fuzeParam.el.hidden = false;
    } else {
      this.fuzeParam.el.hidden = true;
    }
    setText(this.fuzeNote, FUZE_HINT[m]);
    this.fuzeNote.hidden = m === 'impact' || m === 'delay';
  }

  /** Espoleta elegida por el operador (undefined = impacto clásico). La
   *  ILLUM la decide ArtilleryPiece (tiempo automático). */
  fuzeSpec(): FuzeSpec | undefined {
    const w = this.weapon();
    if (w.category === 'SmallArms' || w.round.payload === 'illum') return undefined;
    switch (this.fuzeMode) {
      case 'delay': return { mode: 'delay' };
      case 'time': return { mode: 'time', timeS: this.fuzeTimeS };
      case 'proximity': return { mode: 'proximity', heightM: this.fuzeHeightM };
      default: return undefined;
    }
  }

  /** Corrección de V0; undefined con las condiciones estándar (paridad). */
  v0Correction(): V0Correction | undefined {
    if (this.propellantTempC === 21 && this.tubeWearPct === 0) return undefined;
    return { chargeTempC: this.propellantTempC, wearFraction: this.tubeWearPct / 100 };
  }

  /** Factor de V0 vigente (para la lectura de V0 efectiva). */
  private v0FactorNow(): number {
    return (1 + 0.0006 * (this.propellantTempC - 21)) * (1 - this.tubeWearPct / 100);
  }

  private baseV0(): number {
    const w = this.weapon();
    return this.chargeIndex >= 0 && this.chargeIndex < w.charges.length
      ? w.charges[this.chargeIndex].muzzleVelocity
      : w.round.muzzleVelocity;
  }

  private refreshV0(): void {
    const f = this.v0FactorNow();
    const v0 = this.baseV0() * f;
    const pct = (f - 1) * 100;
    this.v0Readout.set(fmtNum(v0, 1), 'm/s', `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)} % sobre tabla`);
    this.v0Readout.setState(Math.abs(pct) < 0.005 ? '' : 'warn');
    this.advanced.head.classList.toggle('has-dot', Math.abs(pct) >= 0.005);
  }

  // =========================================================================
  //  Puntería
  // =========================================================================
  private configureLayFields(): void {
    const unit = settings.angleUnit;
    const w = this.weapon();
    const dec = UNIT_DECIMALS[unit];
    this.azField.configure({ min: 0, max: unit === 'mil' ? 6400 : 360, step: unit === 'mil' ? 1 : 0.05, unit: UNIT_SUFFIX[unit], decimals: dec });
    this.elField.configure({
      min: toUnit(w.minElevationDeg, unit),
      max: toUnit(w.maxElevationDeg, unit),
      step: unit === 'mil' ? 1 : 0.05,
      unit: UNIT_SUFFIX[unit],
      decimals: dec,
    });
  }

  /** Refleja el estado de puntería en campos y lecturas grandes. */
  private reflectLay(): void {
    const unit = settings.angleUnit;
    this.azField.set(toUnit(this.azimuthDeg, unit));
    this.elField.set(toUnit(this.elevationDeg, unit));
    const other: AngleUnit = unit === 'mil' ? 'deg' : 'mil';
    this.azReadout.set(fmtAngleValue(this.azimuthDeg, unit), UNIT_SUFFIX[unit], fmtAngle(this.azimuthDeg, other));
    this.elReadout.set(fmtAngleValue(this.elevationDeg, unit), UNIT_SUFFIX[unit], fmtAngle(this.elevationDeg, other));
    this.setFd(this.fdAz, fmtAngleValue(this.azimuthDeg, unit), UNIT_SUFFIX[unit]);
    this.setFd(this.fdEl, fmtAngleValue(this.elevationDeg, unit), UNIT_SUFFIX[unit]);
    this.refreshStepSummaries();
  }

  private afterManualLay(): void {
    this.reflectLay();
    this.checkAdjusted();
    this.cb.onAimChanged();
  }

  /** Fija az/el desde una solución de tiro (clic en objetivo) o un enlace.
   *  La elevación se acota a la envolvente del arma: un enlace manipulado
   *  (el:9999) no puede desincronizar el deslizador del estado. */
  setAim(azimuthDeg: number, elevationDeg: number): void {
    const w = this.weapon();
    this.azimuthDeg = ((azimuthDeg % 360) + 360) % 360;
    this.elevationDeg = Math.min(Math.max(elevationDeg, w.minElevationDeg), w.maxElevationDeg);
    this.reflectLay();
    this.checkAdjusted();
  }

  /** Puntería fina por teclado/rueda: incrementos en grados. */
  nudge(dAzDeg: number, dElDeg: number): void {
    this.setAim(this.azimuthDeg + dAzDeg, this.elevationDeg + dElDeg);
    this.cb.onAimChanged();
  }

  private refreshUnits(): void {
    this.configureLayFields();
    this.reflectLay();
    this.refreshTarget();
    this.refreshSolution();
  }

  /** P-VIVO.10 — restaura la rama alta sin desincronizar el control. */
  setHighAngle(on: boolean): void {
    this.preferHighAngle = on;
    this.branchSeg.set(on ? 'high' : 'low');
    this.refreshStepSummaries();
  }

  /** Atajo H: alterna la rama y notifica (re-solución si hay objetivo). */
  toggleHighAngle(): void {
    this.setHighAngle(!this.preferHighAngle);
    this.cb.onBranchChanged(this.preferHighAngle);
  }

  // =========================================================================
  //  Objetivo y solución (los alimenta ArtilleryPiece)
  // =========================================================================
  setTargetInfo(t: TargetInfo | null): void {
    const fresh = !!t && !this.target;
    this.target = t;
    if (!t) this.solvedLay = null;
    this.refreshTarget();
    this.refreshSolution();
    // Recién designado: que se vean sus datos (y la solución) sin buscarla.
    if (fresh && !this.steps[3].body.hidden) {
      requestAnimationFrame(() => this.targetBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }

  get hasTarget(): boolean { return this.target !== null; }

  private refreshTarget(): void {
    const t = this.target;
    this.targetBox.hidden = !t;
    this.targetEmpty.hidden = !!t;
    const st = this.steps[3];
    if (st) st.root.dataset.state = t ? 'done' : 'optional';
    if (!t) {
      this.refreshStepSummaries();
      return;
    }
    const unit = settings.angleUnit;
    const d = distanceParts(t.rangeM);
    this.tRange.set(d.value, d.unit);
    this.tBearing.set(fmtAngleValue(t.bearingDeg, unit, unit === 'mil' ? 0 : 1), UNIT_SUFFIX[unit]);
    this.tDz.set(`${t.dzM >= 0 ? '+' : '−'}${fmtNum(Math.abs(t.dzM), 0)}`, 'm');
    setText(this.tGrid, fmtCoord(t.latDeg, t.lonDeg, settings.coordFormat));
    this.refreshStepSummaries();
  }

  /** Estado de la solución: manual, calculando, en alcance, fuera de alcance. */
  setSolveState(state: SolveState): void {
    this.solveState = state;
    if (state === 'ok') this.solvedLay = { az: this.azimuthDeg, el: this.elevationDeg };
    if (state === 'manual' || state === 'out') this.solvedLay = null;
    this.refreshSolution();
  }

  private checkAdjusted(): void {
    if (!this.solvedLay || this.solveState === 'solving') return;
    const moved =
      Math.abs(this.solvedLay.az - this.azimuthDeg) > 1e-6 ||
      Math.abs(this.solvedLay.el - this.elevationDeg) > 1e-6;
    const next: SolveState = moved ? 'adjusted' : 'ok';
    if (next !== this.solveState) {
      this.solveState = next;
      this.refreshSolution();
    }
  }

  /** Datos del preview vigente (lecturas del paso 4). */
  setPreview(p: PreviewInfo): void {
    this.preview = p;
    this.refreshSolution();
  }

  private refreshSolution(): void {
    const s = this.solveState;
    const labels: Record<SolveState, [string, 'muted' | 'info' | 'ok' | 'danger' | 'warn']> = {
      manual: ['Puntería manual', 'muted'],
      solving: ['Calculando', 'info'],
      ok: ['En alcance', 'ok'],
      out: ['Fuera de alcance', 'danger'],
      adjusted: ['Corregida a mano', 'warn'],
    };
    const [txt, tone] = labels[s];
    setChip(this.solChip, txt, tone);
    setChip(this.fdChip, txt, tone);
    const st4 = this.steps[4];
    if (st4) st4.root.dataset.state = s === 'ok' || s === 'adjusted' ? 'done' : s === 'out' ? 'error' : 'active';

    const p = this.preview;
    const w = this.weapon();
    const charge = this.chargeIndex >= 0 && this.chargeIndex < w.charges.length ? w.charges[this.chargeIndex] : null;
    this.rCharge.set(charge ? chargeShort(charge.name) : 'Fija', '', `${fmtNum(this.baseV0() * this.v0FactorNow(), 0)} m/s`);
    if (!p) {
      for (const r of [this.rTof, this.rApex, this.rRange, this.rMax, this.rFall]) r.set('—');
      this.setFd(this.fdRange, '—', '');
      this.setFd(this.fdTof, '—', '');
      this.root.dataset.solution = 'pending';
      return;
    }
    this.setFd(this.fdRange, distanceParts(p.rangeM).value, distanceParts(p.rangeM).unit);
    this.setFd(this.fdTof, p.tofS.toFixed(1), 's');
    const range = distanceParts(p.rangeM);
    this.rRange.set(range.value, range.unit, p.detonation === 'air' ? 'estallido aéreo' : '');
    this.rTof.set(p.tofS < 100 ? p.tofS.toFixed(1) : fmtSeconds(p.tofS), p.tofS < 100 ? 's' : '');
    const apex = distanceParts(p.apexM);
    this.rApex.set(apex.value, apex.unit);
    const max = distanceParts(p.maxRangeM);
    this.rMax.set(max.value, max.unit, p.minRangeM > 1 ? `mín. ${distanceParts(p.minRangeM).value} ${distanceParts(p.minRangeM).unit}` : '');
    const unit = settings.angleUnit;
    this.rFall.set(fmtAngleValue(p.angleOfFallDeg, unit, unit === 'mil' ? 0 : 1), UNIT_SUFFIX[unit]);
    this.rRange.setState(s === 'out' ? 'danger' : '');
    this.root.dataset.solution = 'ready';
  }

  /** Valor + unidad pequeña en la tira de datos de tiro (solo si cambió). */
  private setFd(el: HTMLElement, value: string, unit: string): void {
    const key = `${value}|${unit}`;
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.textContent = value;
    if (unit) el.appendChild(h('small', { text: unit === '°' ? '°' : ` ${unit}` }));
  }

  // =========================================================================
  //  Resúmenes de los pasos (cabeceras, también plegadas)
  // =========================================================================
  private refreshStepSummaries(): void {
    if (!this.steps[1]) return;
    const info = WEAPON_INFO[this.weaponId];
    const w = this.weapon();
    setText(this.steps[1].summary, `${info.designation} · ${info.caliber}`);
    this.steps[1].root.dataset.state = 'done';

    const charge = this.chargeIndex >= 0 && this.chargeIndex < w.charges.length ? chargeShort(w.charges[this.chargeIndex].name) : 'fija';
    const fuze = w.category === 'SmallArms' ? 'bala'
      : w.round.payload === 'illum' ? 'tiempo auto'
      : this.fuzeMode === 'time' ? `tiempo ${this.fuzeTimeS.toFixed(1)} s`
      : this.fuzeMode === 'proximity' ? `prox. ${this.fuzeHeightM.toFixed(0)} m`
      : FUZE_LABEL[this.fuzeMode].toLowerCase();
    const roundShort = w.round.name.replace(/\s*\(.*\)\s*/, '').replace(/155mm|120mm|203mm|227mm/i, '').trim();
    setText(this.steps[2].summary, `${roundShort} · ${fuze} · ${charge}`);
    this.steps[2].root.dataset.state = 'done';

    const unit = settings.angleUnit;
    if (this.target) {
      const d = distanceParts(this.target.rangeM);
      setText(this.steps[3].summary, `${d.value} ${d.unit} · ${fmtAngle(this.target.bearingDeg, unit, unit === 'mil' ? 0 : 1)} · ${this.preferHighAngle ? 'alta' : 'baja'}`);
    } else {
      setText(this.steps[3].summary, `Sin designar · rama ${this.preferHighAngle ? 'alta' : 'baja'}`);
    }
    setText(this.steps[4].summary, `AZ ${fmtAngleValue(this.azimuthDeg, unit)} · QE ${fmtAngleValue(this.elevationDeg, unit)} ${UNIT_SUFFIX[unit]}`);
  }

  // =========================================================================
  //  Estado general (API histórica)
  // =========================================================================
  /** Compat: el texto de solución antiguo va a la consola de estado. */
  setSolution(text: string): void { this.setStatus(text); }

  setStatus(text: string): void { setText(this.statusEl, text); }

  setFiring(busy: boolean): void {
    this.firing = busy;
    this.fireBtn.disabled = busy;
    this.fireBtn.classList.toggle('is-busy', busy);
    const lab = this.fireBtn.querySelector('.ua-btn__label');
    if (lab) setText(lab, busy ? 'Calculando' : 'Fuego');
    for (const b of this.modeBtns) {
      if (b.dataset.testid !== 'clear-craters') b.disabled = busy;
    }
  }

  get isFiring(): boolean { return this.firing; }

  /** Atajo F (teclado): pulsar/soltar con la misma semántica que el botón. */
  triggerFire(down: boolean): void {
    const auto = !!this.weapon().rateOfFireRpm;
    if (auto) {
      if (down && !this.bursting) {
        this.bursting = true;
        this.fireBtn.classList.add('is-holding');
        this.cb.onBurstStart();
      } else if (!down && this.bursting) {
        this.bursting = false;
        this.fireBtn.classList.remove('is-holding');
        this.cb.onBurstEnd();
      }
      return;
    }
    if (down && !this.fireBtn.disabled) {
      this.fireBtn.classList.add('is-holding');
      window.setTimeout(() => this.fireBtn.classList.remove('is-holding'), 140);
      this.cb.onFire();
    }
  }

  /** Refleja el modo de picking vigente en los botones del paso 3. */
  reflectPickMode(mode: PickMode): void {
    this.pickMode = mode;
    this.pickBtn.setAttribute('aria-pressed', String(mode === 'target'));
    this.batteryBtn.setAttribute('aria-pressed', String(mode === 'battery'));
    this.pickBtn.classList.toggle('is-active', mode === 'target');
    this.batteryBtn.classList.toggle('is-active', mode === 'battery');
    this.pickHint.hidden = mode === 'none';
    this.pickHint.textContent = '';
    if (mode === 'target') {
      this.pickHint.append(icon('target', 16), h('span', { text: 'Haz clic en el mapa sobre el objetivo.' }), kbd('Esc'));
    } else if (mode === 'battery') {
      this.pickHint.append(icon('battery', 16), h('span', { text: 'Haz clic en el mapa en el nuevo asentamiento.' }), kbd('Esc'));
    }
    this.root.classList.toggle('is-picking', mode !== 'none');
  }

  setPickActive(active: boolean): void {
    if (active) this.reflectPickMode('target');
    else if (this.pickMode === 'target') this.reflectPickMode('none');
  }

  setBatteryActive(active: boolean): void {
    if (active) this.reflectPickMode('battery');
    else if (this.pickMode === 'battery') this.reflectPickMode('none');
  }

  /** P-PRO.7 — el reto bloquea la solución automática (designar). */
  setPickEnabled(enabled: boolean): void {
    this.pickEnabled = enabled;
    this.pickBtn.disabled = !enabled;
    this.pickBtn.dataset.tip = enabled
      ? 'Clic en el mapa para fijar el objetivo: la dirección de tiro resuelve sola (T)'
      : 'Bloqueado durante el reto: apunta a mano';
    if (!enabled) this.setPickActive(false);
  }

  get pickAllowed(): boolean { return this.pickEnabled; }

  /** P-VIVO.6 — el reto FO fuerza la parábola OFF (y la restaura al salir). */
  setArcChecked(on: boolean): void {
    if (this.arcOn === on) return;
    this.arcOn = on;
    this.cb.onToggleArc(on);
  }

  /** ¿Parábola de preview visible? (la serializa shareState, P-VIVO.10). */
  get arcChecked(): boolean { return this.arcOn; }

  /**
   * P-VIVO.10 — restaura arma/munición/carga desde un enlace o la sesión,
   * SIN disparar los callbacks de usuario: el llamador (main) aplica los
   * efectos laterales (silueta del arma, worker, tabla, anillos) en el orden
   * correcto de la restauración.
   */
  applyShared(weaponId: WeaponId, roundIndex: number, chargeIndex: number): void {
    if (!WeaponCatalog.ids().includes(weaponId)) return;
    this.weaponId = weaponId;
    this.rebuildRounds();
    this.rebuildCharges();
    const rounds = WeaponCatalog.get(this.weaponId).rounds ?? [];
    if (roundIndex > 0 && roundIndex < rounds.length) {
      this.roundIndex = roundIndex;
      this.roundField.set(String(roundIndex));
    }
    const w = this.weapon();
    if (chargeIndex >= 0 && chargeIndex < w.charges.length) {
      this.chargeIndex = chargeIndex;
      this.chargeSeg.set(String(chargeIndex));
    }
    this.arsenal.mark(weaponId);
    this.applyWeaponLimits();
    this.refreshWeaponCard();
    this.refreshFuze();
    this.refreshV0();
  }

  /** Selecciona una carga por índice (atajos, retos, E2E). */
  selectCharge(index: number): void {
    const w = this.weapon();
    if (index < 0 || index >= w.charges.length || index === this.chargeIndex) return;
    this.chargeSeg.set(String(index), false);
  }

  /** Bearing del objetivo (útil para la cinta del HUD de artillero). */
  static bearingOf(x: number, y: number): number { return bearingDegOf(x, y); }
}
