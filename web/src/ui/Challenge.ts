// ============================================================================
//  Challenge.ts — Modo instrucción: reto de puntería puntuado.  [P-PRO.7]
//
//  "🏅 Reto" planta una diana aleatoria en el anillo [0.4, 0.9]·alcanceMáx del
//  arma/carga actual, A LA ALTURA real del suelo, y desactiva la solución
//  automática (🎯 Objetivo). Se apunta a mano: sliders, cockpit o tabla de
//  tiro. El PRIMER impacto puntúa por fallo radial (3★ <25 m · 2★ <75 m ·
//  1★ <150 m, ver challengeCore) y el récord por arma persiste en
//  localStorage ('unai-artillery/challenge/v1'). "Rendirse" revela la
//  solución vía solveForTarget y no puntúa.
//
//  La lógica pura (anillo, estrellas, récords) vive en challengeCore.ts con
//  RNG inyectado; la semilla del reloj entra SOLO aquí.
// ============================================================================
import { Vec3 } from '../ballistics';
import { buildTerrain } from '../ballistics/WorkerProtocol';
import { BallisticsService } from '../BallisticsService';
import { ControlPanel } from './ControlPanel';
import {
  ChallengeRecord, improveRecord, pickTargetInRing, starBar, starsForMiss,
} from './challengeCore';
import { loadRecords, saveRecords } from './recordStore';
import { toast } from './toast';

const STORE_KEY = 'unai-artillery/challenge/v1';
const MOVING_STORE_KEY = 'unai-artillery/challenge-moving/v1';
const GHOST_PREF_KEY = 'unai-artillery/moving-ghost/v1';

export interface ChallengeHooks {
  /** Pinta/borra la diana del reto (distinta del objetivo normal). */
  marker(enu: Vec3 | null): void;
  /** Bloquea/desbloquea la solución automática (🎯 Objetivo). */
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

export class Challenge {
  private target: Vec3 | null = null;
  private surrendered = false;
  private scored = false;
  /** P-VIVO.7 — 'moving' puntúa contra la posición del blanco al impactar. */
  private mode: 'static' | 'moving' = 'static';
  private startBtn!: HTMLButtonElement;
  private movingBtn!: HTMLButtonElement;
  private surrenderBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private ghostCheckbox!: HTMLInputElement;

  constructor(
    private readonly service: BallisticsService,
    private readonly panel: ControlPanel,
    private readonly hooks: ChallengeHooks,
  ) {
    const host = document.getElementById('controlPanel')!;
    const h3 = document.createElement('h3');
    h3.textContent = 'Instrucción';
    host.appendChild(h3);

    const row = document.createElement('div');
    row.className = 'btn-grid';
    this.startBtn = document.createElement('button');
    this.startBtn.id = 'challengeBtn'; // ancla del tutorial (P-VIVO.11)
    this.startBtn.textContent = '🏅 Reto';
    this.startBtn.title =
      'Objetivo aleatorio dentro de la envolvente: apunta a mano (sin 🎯) y puntúa tu PRIMER impacto';
    this.startBtn.onclick = () => void this.start();
    this.movingBtn = document.createElement('button');
    this.movingBtn.textContent = '🚚 Reto móvil';
    this.movingBtn.title =
      'Blanco en movimiento (20-60 km/h): apunta al FUTURO — el impacto se puntúa contra dónde está el camión cuando el tiro CAE';
    this.movingBtn.onclick = () => void this.start(true);
    this.surrenderBtn = document.createElement('button');
    this.surrenderBtn.textContent = 'Rendirse';
    this.surrenderBtn.title = 'Revela la solución (no puntúa)';
    this.surrenderBtn.style.display = 'none';
    this.surrenderBtn.onclick = () => void this.surrender();
    row.append(this.startBtn, this.movingBtn, this.surrenderBtn);
    host.appendChild(row);

    // P-VIVO.7 — ayuda didáctica: fantasma del blanco extrapolado al TOF.
    const ghostRow = document.createElement('div');
    ghostRow.className = 'row';
    const ghostLab = document.createElement('label');
    ghostLab.textContent = 'Adelanto sugerido';
    ghostLab.title =
      'Pinta un fantasma del blanco en su posición extrapolada al TOF del preview. ' +
      'Apunta al fantasma y aciertas… si el TOF no cambia al re-apuntar: re-apunta 2-3 veces ' +
      'y verás converger la solución — esa es exactamente la lección del tiro predicho.';
    this.ghostCheckbox = document.createElement('input');
    this.ghostCheckbox.type = 'checkbox';
    this.ghostCheckbox.checked = this.loadGhostPref();
    this.ghostCheckbox.onchange = () => this.saveGhostPref(this.ghostCheckbox.checked);
    ghostRow.append(ghostLab, this.ghostCheckbox);
    host.appendChild(ghostRow);

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'hint';
    host.appendChild(this.statusEl);
    this.showRecord();
  }

  get active(): boolean { return this.target !== null && !this.scored && !this.surrendered; }

  /** P-VIVO.7 — ¿reto móvil vivo? (main pinta el blanco en el minimapa). */
  get movingActive(): boolean { return this.active && this.mode === 'moving'; }

  /** P-VIVO.7 — ¿fantasma de adelanto activado? (main lo alimenta con el TOF). */
  get ghostEnabled(): boolean { return this.ghostCheckbox.checked; }

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
    try {
      const id = this.panel.weaponId;
      const ring = await this.service.approxMaxRange(id, this.panel.chargeIndex);
      // La semilla del reloj SOLO aquí — la lógica del anillo es pura.
      // El reto móvil usa el anillo [0.3, 0.95] (el camión pasea dentro).
      const spec = moving
        ? {
            azimuthDeg: 360 * Math.random(),
            rangeM: (0.3 + 0.65 * Math.random()) * ring.maxRangeM,
          }
        : pickTargetInRing(Math.random, ring.maxRangeM, ring.minRangeM);

      // Altura REAL del suelo bajo la diana: perfil 1D del corredor.
      const corridor = await this.service.sampleCorridor(spec.azimuthDeg, spec.rangeM * 1.05, 400, 0);
      const ground = buildTerrain(corridor);
      const az = (spec.azimuthDeg * Math.PI) / 180;
      const e = Math.sin(az) * spec.rangeM;
      const n = Math.cos(az) * spec.rangeM;
      this.target = new Vec3(e, n, ground(e, n));
      this.mode = moving ? 'moving' : 'static';

      this.surrendered = false;
      this.scored = false;
      this.hooks.lockPick(true);
      this.surrenderBtn.style.display = '';
      if (moving) {
        // El camión ES el marcador: v aleatoria 20-60 km/h, rumbo aleatorio.
        this.hooks.marker(null);
        const speedMS = (20 + Math.random() * 40) / 3.6;
        const headingDeg = 360 * Math.random();
        this.hooks.spawnMoving?.(this.target, headingDeg, speedMS, {
          minM: 0.3 * ring.maxRangeM,
          maxM: 0.95 * ring.maxRangeM,
        });
        this.startBtn.textContent = '🏅 Reto';
        this.movingBtn.textContent = '🚚 Otro móvil';
        this.statusEl.textContent =
          `Blanco móvil a ${(spec.rangeM / 1000).toFixed(2)} km, ${(speedMS * 3.6).toFixed(0)} km/h. ` +
          'Apunta al FUTURO: puntúa contra dónde esté el camión cuando el tiro CAIGA.';
        toast('🚚 Reto móvil: lead = v·TOF — usa el fantasma de adelanto');
      } else {
        this.hooks.marker(this.target);
        this.startBtn.textContent = '🏅 Otro reto';
        this.movingBtn.textContent = '🚚 Reto móvil';
        this.statusEl.textContent =
          `Reto vivo: diana a ${(spec.rangeM / 1000).toFixed(2)} km, azimut ` +
          `${spec.azimuthDeg.toFixed(1)}º. Apunta a mano y dispara: puntúa el PRIMER impacto.`;
        toast('🏅 Reto: apunta con sliders/cockpit/tabla — 🎯 desactivado');
      }
    } catch (err) {
      console.error('[challenge]', err);
      toast('No se pudo plantear el reto');
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

    const bar = starBar(stars);
    const tag = this.mode === 'moving' ? ' (móvil)' : '';
    toast(`${bar} — fallo ${missM.toFixed(0)} m${tag}${improved ? ' · ¡RÉCORD!' : ''}`);
    this.statusEl.textContent =
      `${bar} fallo ${missM.toFixed(0)} m${tag}` +
      (improved ? ' · ¡récord nuevo!' : ` · récord ${record.bestMissM.toFixed(0)} m`) +
      ' — 🏅/🚚 para otro reto.';
    this.end();
  }

  /** Revela la solución (rama según el panel) y cierra sin puntuar.
   *  P-VIVO.7: en el reto móvil revela la solución hacia DONDE ESTÁ AHORA
   *  (cuando llegue el tiro ya no estará: esa es la gracia). */
  private async surrender(): Promise<void> {
    if (!this.target) return;
    this.surrendered = true;
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
        this.statusEl.textContent =
          `Solución: az ${sol.azimuthDeg.toFixed(1)}º · QE ${sol.elevationDeg.toFixed(2)}º · ` +
          `TOF ${sol.timeOfFlight.toFixed(1)} s. Sin puntuar — 🏅 para otro reto.`;
      } else {
        this.statusEl.textContent = 'Ni la dirección de tiro le llega con esta carga…';
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
    this.surrenderBtn.style.display = 'none';
    this.startBtn.textContent = '🏅 Reto';
    this.movingBtn.textContent = '🚚 Reto móvil';
  }

  private showRecord(): void {
    const rec = loadRecords<ChallengeRecord>(STORE_KEY)[this.panel.weaponId];
    this.statusEl.textContent = rec
      ? `Récord con esta arma: ${starBar(rec.stars)} ${rec.bestMissM.toFixed(0)} m.`
      : 'Sin récord con esta arma todavía — pulsa 🏅 Reto.';
  }
}
