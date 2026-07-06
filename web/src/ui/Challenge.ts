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
import { toast } from './toast';

const STORE_KEY = 'unai-artillery/challenge/v1';

export interface ChallengeHooks {
  /** Pinta/borra la diana del reto (distinta del objetivo normal). */
  marker(enu: Vec3 | null): void;
  /** Bloquea/desbloquea la solución automática (🎯 Objetivo). */
  lockPick(locked: boolean): void;
  schedulePreview(): void;
}

export class Challenge {
  private target: Vec3 | null = null;
  private surrendered = false;
  private scored = false;
  private startBtn!: HTMLButtonElement;
  private surrenderBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;

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
    this.startBtn.textContent = '🏅 Reto';
    this.startBtn.title =
      'Objetivo aleatorio dentro de la envolvente: apunta a mano (sin 🎯) y puntúa tu PRIMER impacto';
    this.startBtn.onclick = () => void this.start();
    this.surrenderBtn = document.createElement('button');
    this.surrenderBtn.textContent = 'Rendirse';
    this.surrenderBtn.title = 'Revela la solución (no puntúa)';
    this.surrenderBtn.style.display = 'none';
    this.surrenderBtn.onclick = () => void this.surrender();
    row.append(this.startBtn, this.surrenderBtn);
    host.appendChild(row);

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'hint';
    host.appendChild(this.statusEl);
    this.showRecord();
  }

  get active(): boolean { return this.target !== null && !this.scored && !this.surrendered; }

  /** Nuevo reto (re-tira si ya había uno vivo, sin puntuar). */
  private async start(): Promise<void> {
    this.startBtn.disabled = true;
    try {
      const id = this.panel.weaponId;
      const ring = await this.service.approxMaxRange(id, this.panel.chargeIndex);
      // La semilla del reloj SOLO aquí — la lógica del anillo es pura.
      const spec = pickTargetInRing(Math.random, ring.maxRangeM, ring.minRangeM);

      // Altura REAL del suelo bajo la diana: perfil 1D del corredor.
      const corridor = await this.service.sampleCorridor(spec.azimuthDeg, spec.rangeM * 1.05, 400, 0);
      const ground = buildTerrain(corridor);
      const az = (spec.azimuthDeg * Math.PI) / 180;
      const e = Math.sin(az) * spec.rangeM;
      const n = Math.cos(az) * spec.rangeM;
      this.target = new Vec3(e, n, ground(e, n));

      this.surrendered = false;
      this.scored = false;
      this.hooks.marker(this.target);
      this.hooks.lockPick(true);
      this.surrenderBtn.style.display = '';
      this.startBtn.textContent = '🏅 Otro reto';
      this.statusEl.textContent =
        `Reto vivo: diana a ${(spec.rangeM / 1000).toFixed(2)} km, azimut ` +
        `${spec.azimuthDeg.toFixed(1)}º. Apunta a mano y dispara: puntúa el PRIMER impacto.`;
      toast('🏅 Reto: apunta con sliders/cockpit/tabla — 🎯 desactivado');
    } catch (err) {
      console.error('[challenge]', err);
      toast('No se pudo plantear el reto');
    } finally {
      this.startBtn.disabled = false;
    }
  }

  /** Hook del onImpact de ArtilleryPiece: el PRIMER impacto puntúa. */
  notifyImpact(impactEnu: Vec3): void {
    if (!this.active || !this.target) return;
    this.scored = true;
    const missM = Math.hypot(impactEnu.x - this.target.x, impactEnu.y - this.target.y);
    const stars = starsForMiss(missM);

    const records = this.loadRecords();
    const { record, improved } = improveRecord(
      records[this.panel.weaponId], missM, new Date().toISOString(),
    );
    records[this.panel.weaponId] = record;
    this.saveRecords(records);

    const bar = starBar(stars);
    toast(`${bar} — fallo ${missM.toFixed(0)} m${improved ? ' · ¡RÉCORD!' : ''}`);
    this.statusEl.textContent =
      `${bar} fallo ${missM.toFixed(0)} m` +
      (improved ? ' · ¡récord nuevo!' : ` · récord ${record.bestMissM.toFixed(0)} m`) +
      ' — 🏅 para otro reto.';
    this.end();
  }

  /** Revela la solución (rama según el panel) y cierra sin puntuar. */
  private async surrender(): Promise<void> {
    if (!this.target) return;
    this.surrendered = true;
    try {
      const sol = await this.service.solveForTarget(
        this.panel.weaponId, this.target, this.panel.chargeIndex, this.panel.preferHighAngle,
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
    this.surrenderBtn.style.display = 'none';
    this.startBtn.textContent = '🏅 Reto';
  }

  private showRecord(): void {
    const rec = this.loadRecords()[this.panel.weaponId];
    this.statusEl.textContent = rec
      ? `Récord con esta arma: ${starBar(rec.stars)} ${rec.bestMissM.toFixed(0)} m.`
      : 'Sin récord con esta arma todavía — pulsa 🏅 Reto.';
  }

  private loadRecords(): Record<string, ChallengeRecord> {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, ChallengeRecord>) : {};
    } catch {
      return {};
    }
  }

  private saveRecords(records: Record<string, ChallengeRecord>): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(records));
    } catch {
      // almacenamiento lleno/bloqueado: el reto sigue, solo no persiste
    }
  }
}
