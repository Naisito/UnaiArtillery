// ============================================================================
//  Challenge.ts — Instrucción: reto de precisión y blanco móvil.
//  [P-PRO.7 · P-VIVO.7 · tarjetas de misión V2]
//
//  RETO DE PRECISIÓN: diana aleatoria en el anillo [0.4, 0.9]·alcanceMáx del
//  arma/carga actual, A LA ALTURA real del suelo; la designación en el mapa
//  queda bloqueada y se apunta a mano (deslizadores, instrumentos o tabla de
//  tiro). El PRIMER impacto puntúa por fallo radial (3★ <25 m · 2★ <75 m ·
//  1★ <150 m, ver challengeCore) con récord por arma en localStorage
//  ('unai-artillery/challenge/v1'). "Rendirse" revela la solución.
//
//  BLANCO MÓVIL: un camión a 20-60 km/h; el impacto se puntúa contra dónde
//  está el camión CUANDO EL TIRO CAE. El "Adelanto sugerido" pinta un
//  fantasma extrapolado al TOF del preview.
//
//  La lógica pura (anillo, estrellas, récords) vive en challengeCore.ts con
//  RNG inyectado; la semilla del reloj entra SOLO aquí.
// ============================================================================
import { Vec3 } from '../ballistics';
import { buildTerrain } from '../ballistics/WorkerProtocol';
import { BallisticsService } from '../BallisticsService';
import { Toggle, button, setButtonLabel } from './components';
import { ControlPanel } from './ControlPanel';
import {
  ChallengeRecord, improveRecord, pickTargetInRing, starsForMiss,
} from './challengeCore';
import { MissionCard, missionCard } from './missionCard';
import { loadRecords, saveRecords } from './recordStore';
import { settings } from './settings';
import { toast } from './toast';
import { fmtAngle, fmtNum } from './units';
import { WEAPON_INFO } from './weaponInfo';

const STORE_KEY = 'unai-artillery/challenge/v1';
const MOVING_STORE_KEY = 'unai-artillery/challenge-moving/v1';
const GHOST_PREF_KEY = 'unai-artillery/moving-ghost/v1';

export interface ChallengeHooks {
  /** Pinta/borra la diana del reto (distinta del objetivo normal). */
  marker(enu: Vec3 | null): void;
  /** Bloquea/desbloquea la solución automática (designar en el mapa). */
  lockPick(locked: boolean): void;
  schedulePreview(): void;
  /** P-VIVO.6 — un reto arranca: los otros modos (FO…) deben cancelarse. */
  onStart?(): void;
  /** P-VIVO.7 — blanco móvil: lo gestiona main (Three + muestreo de camino). */
  spawnMoving?(startEnu: Vec3, headingDeg: number, speedMS: number,
    ring: { minM: number; maxM: number }): void;
  clearMoving?(): void;
  /** Posición ACTUAL del blanco móvil (puntuar en el instante del impacto). */
  movingPosition?(): Vec3 | null;
}

const starsText = (n: number) => `${n} estrella${n === 1 ? '' : 's'}`;

export class Challenge {
  private target: Vec3 | null = null;
  private surrendered = false;
  private scored = false;
  /** P-VIVO.7 — 'moving' puntúa contra la posición del blanco al impactar. */
  private mode: 'static' | 'moving' = 'static';
  private readonly staticCard: MissionCard;
  private readonly movingCard: MissionCard;
  private readonly startBtn: HTMLButtonElement;
  private readonly movingBtn: HTMLButtonElement;
  private readonly surrenderStatic: HTMLButtonElement;
  private readonly surrenderMoving: HTMLButtonElement;
  private readonly ghost: Toggle;

  constructor(
    private readonly service: BallisticsService,
    private readonly panel: ControlPanel,
    private readonly hooks: ChallengeHooks,
    host: HTMLElement = document.getElementById('instructionHost') ?? document.body,
  ) {
    // -- Reto de precisión -------------------------------------------------------
    this.staticCard = missionCard({
      icon: 'target', tag: 'Puntería', title: 'Reto de precisión', testid: 'mission-static',
      desc: 'Diana aleatoria dentro de tu envolvente. Sin designación automática: apunta a mano y puntúa el PRIMER impacto (3 estrellas < 25 m).',
    });
    this.startBtn = button({
      label: 'Iniciar reto', icon: 'play', variant: 'primary', size: 's', id: 'challengeBtn', testid: 'challenge-start',
      onClick: () => void this.start(),
    });
    this.surrenderStatic = button({
      label: 'Rendirse', size: 's', variant: 'ghost', testid: 'challenge-surrender',
      title: 'Revela la solución (no puntúa)', onClick: () => void this.surrender(),
    });
    this.surrenderStatic.hidden = true;
    this.staticCard.actions.append(this.startBtn, this.surrenderStatic);

    // -- Blanco móvil ------------------------------------------------------------------
    this.movingCard = missionCard({
      icon: 'truck', tag: 'Tiro predicho', title: 'Blanco móvil', testid: 'mission-moving', gloss: 'adelanto',
      desc: 'Un camión a 20–60 km/h. El impacto se puntúa contra dónde esté CUANDO EL TIRO CAE: adelanto = velocidad × TOF.',
    });
    this.ghost = new Toggle('Adelanto sugerido', this.loadGhostPref(), {
      testid: 'ghost-toggle',
      hint: 'Fantasma del camión extrapolado al TOF del preview. Re-apunta 2–3 veces y verás converger la solución.',
    });
    this.ghost.onChange = (on) => this.saveGhostPref(on);
    this.movingCard.extra.appendChild(this.ghost.el);
    this.movingBtn = button({
      label: 'Iniciar reto móvil', icon: 'play', variant: 'primary', size: 's', testid: 'challenge-moving',
      onClick: () => void this.start(true),
    });
    this.surrenderMoving = button({
      label: 'Rendirse', size: 's', variant: 'ghost', testid: 'moving-surrender',
      title: 'Revela la solución hacia donde está AHORA (no puntúa)', onClick: () => void this.surrender(),
    });
    this.surrenderMoving.hidden = true;
    this.movingCard.actions.append(this.movingBtn, this.surrenderMoving);

    host.append(this.staticCard.el, this.movingCard.el);
    this.showRecord();
  }

  get active(): boolean { return this.target !== null && !this.scored && !this.surrendered; }

  /** P-VIVO.7 — ¿reto móvil vivo? (main pinta el blanco en el minimapa). */
  get movingActive(): boolean { return this.active && this.mode === 'moving'; }

  /** P-VIVO.7 — ¿fantasma de adelanto activado? (main lo alimenta con el TOF). */
  get ghostEnabled(): boolean { return this.ghost.value; }

  private loadGhostPref(): boolean {
    try {
      const raw = localStorage.getItem(GHOST_PREF_KEY);
      return raw === null ? true : raw === '1'; // ON por defecto el primer día
    } catch {
      return true;
    }
  }

  private saveGhostPref(on: boolean): void {
    try {
      localStorage.setItem(GHOST_PREF_KEY, on ? '1' : '0');
    } catch {
      // sin persistencia
    }
  }

  /** Nuevo reto (re-tira si ya había uno vivo, sin puntuar).
   *  P-VIVO.7: con `moving` el objetivo es un camión a 20-60 km/h. */
  private async start(moving = false): Promise<void> {
    this.startBtn.disabled = true;
    this.movingBtn.disabled = true;
    this.hooks.onStart?.(); // P-VIVO.6 — cancela el reto FO si estaba vivo
    this.hooks.clearMoving?.(); // reto anterior fuera
    const weaponAtStart = this.panel.weaponId;
    const chargeAtStart = this.panel.chargeIndex;
    try {
      const id = weaponAtStart;
      const ring = await this.service.approxMaxRange(id, chargeAtStart);
      // La semilla del reloj SOLO aquí — la lógica del anillo es pura.
      // El reto móvil pasea el camión en [max(0.3·máx, mín), 0.95·máx]:
      // respetar el alcance MÍNIMO evita zonas muertas inalcanzables.
      const movingLo = Math.max(0.3 * ring.maxRangeM, ring.minRangeM);
      const movingHi = 0.95 * ring.maxRangeM;
      const spec = moving
        ? {
            azimuthDeg: 360 * Math.random(),
            rangeM: movingLo + (movingHi - movingLo) * Math.random(),
          }
        : pickTargetInRing(Math.random, ring.maxRangeM, ring.minRangeM);

      // Altura REAL del suelo bajo la diana: perfil 1D del corredor.
      const corridor = await this.service.sampleCorridor(spec.azimuthDeg, spec.rangeM * 1.05, 400, 0);
      const ground = buildTerrain(corridor);
      // Si el usuario cambió de arma/carga durante el planteo, este reto es
      // del arma ANTERIOR: abortar en silencio.
      if (this.panel.weaponId !== weaponAtStart || this.panel.chargeIndex !== chargeAtStart) {
        return;
      }
      const az = (spec.azimuthDeg * Math.PI) / 180;
      const e = Math.sin(az) * spec.rangeM;
      const n = Math.cos(az) * spec.rangeM;
      this.target = new Vec3(e, n, ground(e, n));
      this.mode = moving ? 'moving' : 'static';

      this.surrendered = false;
      this.scored = false;
      this.hooks.lockPick(true);
      const unit = settings.angleUnit;
      if (moving) {
        // El camión ES el marcador: v aleatoria 20-60 km/h, rumbo aleatorio.
        this.hooks.marker(null);
        const speedMS = (20 + Math.random() * 40) / 3.6;
        const headingDeg = 360 * Math.random();
        this.hooks.spawnMoving?.(this.target, headingDeg, speedMS, { minM: movingLo, maxM: movingHi });
        this.movingCard.setLive(true);
        this.staticCard.setLive(false);
        this.surrenderMoving.hidden = false;
        this.surrenderStatic.hidden = true;
        setButtonLabel(this.movingBtn, 'Otro blanco');
        setButtonLabel(this.startBtn, 'Iniciar reto');
        this.movingCard.setStatus(
          `Blanco a ${(spec.rangeM / 1000).toFixed(2)} km, ${(speedMS * 3.6).toFixed(0)} km/h. ` +
          'Apunta al FUTURO: puntúa donde esté el camión cuando el tiro caiga.');
        toast('Reto móvil: adelanto = velocidad × TOF — usa el fantasma de adelanto', { title: 'Blanco móvil' });
      } else {
        this.hooks.marker(this.target);
        this.staticCard.setLive(true);
        this.movingCard.setLive(false);
        this.surrenderStatic.hidden = false;
        this.surrenderMoving.hidden = true;
        setButtonLabel(this.startBtn, 'Otra diana');
        setButtonLabel(this.movingBtn, 'Iniciar reto móvil');
        this.staticCard.setStatus(
          `Diana a ${(spec.rangeM / 1000).toFixed(2)} km, azimut ${fmtAngle(spec.azimuthDeg, unit, unit === 'mil' ? 0 : 1)}. ` +
          'Apunta a mano y dispara: puntúa el PRIMER impacto.');
        toast('Apunta con los deslizadores, los instrumentos o la tabla de tiro — designación bloqueada', { title: 'Reto de precisión' });
      }
    } catch (err) {
      console.error('[challenge]', err);
      toast('No se pudo plantear el reto', { level: 'error' });
    } finally {
      this.startBtn.disabled = false;
      this.movingBtn.disabled = false;
    }
  }

  /** Hook del onImpact de ArtilleryPiece: el PRIMER impacto puntúa.
   *  P-VIVO.7: el reto móvil mide contra la posición del blanco EN ESTE
   *  instante — el presentador reproduce en tiempo real, así que "ahora"
   *  ES el instante físico del impacto. */
  notifyImpact(impactEnu: Vec3): void {
    if (!this.active || !this.target) return;
    const movingNow = this.mode === 'moving' ? this.hooks.movingPosition?.() : null;
    if (this.mode === 'moving' && !movingNow) return; // blanco aún no listo
    this.scored = true;
    const tgt = movingNow ?? this.target;
    const missM = Math.hypot(impactEnu.x - tgt.x, impactEnu.y - tgt.y);
    const stars = starsForMiss(missM);

    const storeKey = this.mode === 'moving' ? MOVING_STORE_KEY : STORE_KEY;
    const records = loadRecords<ChallengeRecord>(storeKey);
    const { record, improved } = improveRecord(
      records[this.panel.weaponId], missM, new Date().toISOString(),
    );
    records[this.panel.weaponId] = record;
    saveRecords(storeKey, records);

    const card = this.mode === 'moving' ? this.movingCard : this.staticCard;
    toast(`${starsText(stars)} — fallo ${fmtNum(missM, 0)} m${improved ? ' · nuevo récord' : ''}`, {
      level: stars >= 2 ? 'success' : stars === 1 ? 'info' : 'warn',
      title: this.mode === 'moving' ? 'Blanco móvil' : 'Reto de precisión',
    });
    card.setStatus(
      `${starsText(stars)}: fallo de ${fmtNum(missM, 0)} m` +
      (improved ? ' — ¡récord nuevo!' : ` (récord ${fmtNum(record.bestMissM, 0)} m)`));
    this.end();
  }

  /** Revela la solución (rama según el panel) y cierra sin puntuar.
   *  P-VIVO.7: en el reto móvil revela la solución hacia DONDE ESTÁ AHORA. */
  private async surrender(): Promise<void> {
    if (!this.target) return;
    this.surrendered = true;
    const card = this.mode === 'moving' ? this.movingCard : this.staticCard;
    const tgt = this.mode === 'moving'
      ? this.hooks.movingPosition?.() ?? this.target
      : this.target;
    try {
      const sol = await this.service.solveForTarget(
        this.panel.weaponId, tgt, this.panel.chargeIndex, this.panel.preferHighAngle,
      );
      if (sol.found) {
        this.panel.setAim(sol.azimuthDeg, sol.elevationDeg);
        this.hooks.schedulePreview();
        const u = settings.angleUnit;
        card.setStatus(
          `Solución: AZ ${fmtAngle(sol.azimuthDeg, u)} · QE ${fmtAngle(sol.elevationDeg, u)} · ` +
          `TOF ${sol.timeOfFlight.toFixed(1)} s. Sin puntuar.`);
      } else {
        card.setStatus('Ni la dirección de tiro le llega con esta carga.');
      }
    } catch (err) {
      console.error('[challenge]', err);
    }
    this.end();
  }

  /** Cancela el reto vivo (cambio de arma, mover batería). */
  cancel(): void {
    if (this.target) this.end();
    this.showRecord();
  }

  private end(): void {
    this.target = null;
    this.hooks.marker(null);
    this.hooks.lockPick(false);
    this.hooks.clearMoving?.(); // P-VIVO.7 — el camión se retira
    this.mode = 'static';
    this.surrenderStatic.hidden = true;
    this.surrenderMoving.hidden = true;
    this.staticCard.setLive(false);
    this.movingCard.setLive(false);
    setButtonLabel(this.startBtn, 'Iniciar reto');
    setButtonLabel(this.movingBtn, 'Iniciar reto móvil');
    this.showRecordLines();
  }

  private showRecordLines(): void {
    const name = WEAPON_INFO[this.panel.weaponId].designation;
    const rec = loadRecords<ChallengeRecord>(STORE_KEY)[this.panel.weaponId];
    this.staticCard.setRecord(rec ? rec.stars : null, rec ? `${fmtNum(rec.bestMissM, 0)} m · ${name}` : `sin récord con ${name}`);
    const mrec = loadRecords<ChallengeRecord>(MOVING_STORE_KEY)[this.panel.weaponId];
    this.movingCard.setRecord(mrec ? mrec.stars : null, mrec ? `${fmtNum(mrec.bestMissM, 0)} m · ${name}` : `sin récord con ${name}`);
  }

  private showRecord(): void {
    this.showRecordLines();
    this.staticCard.setStatus('');
    this.movingCard.setStatus('');
  }
}
