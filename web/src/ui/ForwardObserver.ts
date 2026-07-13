// ============================================================================
//  ForwardObserver.ts — Reto de Observador Avanzado.  [P-VIVO.6]
//
//  La esencia de la artillería: NO ves el objetivo desde el arma — lo ve un
//  observador (FO) que canta correcciones ("derecha 50, largo 100"). El reto:
//    * objetivo aleatorio como el reto clásico (anillo [0.4, 0.9]·alcanceMáx);
//    * puesto de observación (OP) a 2-4 km del objetivo, perpendicular ± al
//      rumbo batería→objetivo, con LÍNEA DE VISIÓN validada muestreando el
//      perfil OP→objetivo (si el relieve bloquea, reintenta acercándose);
//    * cámara CLAVADA en el OP a 1.7 m del suelo (modo 'op': girar/zoom, sin
//      moverse), parábola forzada OFF, elipse PER y marcador de impacto
//      previsto OCULTOS, 🎯 desactivado — nada de chivatos;
//    * correcciones ±25/±50/±100 m en los ejes de LA LÍNEA OP→OBJETIVO
//      (foCore, pura y testeada) que trasladan el punto de puntería y
//      re-resuelven la dirección de tiro;
//    * puntúa por RONDAS gastadas hasta impactar a <50 m (1=★★★, 2-3=★★,
//      4-6=★); récord por arma en localStorage 'unai-artillery/challenge-fo/v1'.
//
//  El boom que llega tarde de verdad ya lo regala AudioBoom: la distancia
//  cámara(OP)→impacto manda el retardo físico.
// ============================================================================
import { Vec3 } from '../ballistics';
import { buildTerrain } from '../ballistics/WorkerProtocol';
import { BallisticsService } from '../BallisticsService';
import { pickTargetInRing } from './challengeCore';
import { ControlPanel } from './ControlPanel';
import {
  FO_HIT_RADIUS_M, FoRecord, applyObserverCorrection, foStars, hasLineOfSight,
  improveFoRecord, opCandidates,
} from './foCore';
import { loadRecords, saveRecords } from './recordStore';
import { toast } from './toast';

const STORE_KEY = 'unai-artillery/challenge-fo/v1';

export interface ForwardObserverHooks {
  /** Marca la diana (reutiliza el marcador dorado del reto clásico). */
  marker(enu: Vec3 | null): void;
  /** Bloquea/desbloquea 🎯 Objetivo. */
  lockPick(locked: boolean): void;
  schedulePreview(): void;
  /** Fuerza la parábola de preview ON/OFF (se restaura al salir). */
  setArc(visible: boolean): void;
  /** Cámara al puesto de observación / de vuelta a libre. */
  enterOpCamera(posEnu: Vec3, lookAzimuthDeg: number): void;
  exitOpCamera(): void;
  /** Un reto FO arranca: cancela el reto clásico si estaba vivo. */
  onStart?(): void;
}

export class ForwardObserver {
  private target: Vec3 | null = null;
  private opPos: Vec3 | null = null;
  private aimPoint: Vec3 | null = null;
  private rounds = 0;
  private scored = false;
  /** Estado de la parábola ANTES del reto (para restaurarla de verdad). */
  private savedArc: boolean | null = null;

  private startBtn!: HTMLButtonElement;
  private surrenderBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private corrPanel!: HTMLElement;
  private corrStatus!: HTMLElement;

  constructor(
    private readonly service: BallisticsService,
    private readonly panel: ControlPanel,
    private readonly hooks: ForwardObserverHooks,
  ) {
    // Botonera dentro de la sección "Instrucción" (creada por Challenge).
    const host =
      document.getElementById('instructionHost') ?? document.getElementById('controlPanel')!;
    const row = document.createElement('div');
    row.className = 'btn-grid';
    this.startBtn = document.createElement('button');
    this.startBtn.textContent = '🔭 Reto FO';
    this.startBtn.title =
      'Observador avanzado: solo ves el mundo desde un cerro y corriges el tiro como se hace de verdad';
    this.startBtn.onclick = () => void this.start();
    this.surrenderBtn = document.createElement('button');
    this.surrenderBtn.textContent = 'Rendirse';
    this.surrenderBtn.title = 'Revela el objetivo y la solución (no puntúa)';
    this.surrenderBtn.style.display = 'none';
    this.surrenderBtn.onclick = () => void this.surrender();
    row.append(this.startBtn, this.surrenderBtn);
    host.appendChild(row);

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'hint';
    host.appendChild(this.statusEl);
    this.showRecord();

    this.buildCorrectionPanel();
  }

  get active(): boolean { return this.target !== null && !this.scored; }

  // -- Panel de correcciones (flota abajo-centro solo durante el reto) --------
  private buildCorrectionPanel(): void {
    this.corrPanel = document.createElement('div');
    this.corrPanel.id = 'foPanel';
    this.corrPanel.className = 'panel';
    this.corrPanel.style.display = 'none';

    const title = document.createElement('h2');
    title.textContent = '🔭 Corrección del observador';
    this.corrPanel.appendChild(title);

    const mkRow = (
      label: string, negLabel: string, posLabel: string,
      apply: (m: number) => void,
    ) => {
      const row = document.createElement('div');
      row.className = 'row fo-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      row.appendChild(lab);
      for (const m of [-100, -50, -25]) {
        row.appendChild(this.corrButton(`${negLabel} ${-m}`, () => apply(m)));
      }
      for (const m of [25, 50, 100]) {
        row.appendChild(this.corrButton(`${posLabel} ${m}`, () => apply(m)));
      }
      return row;
    };
    // "Derecha/izquierda" y "largo/corto" SIEMPRE sobre la línea OP→objetivo.
    this.corrPanel.appendChild(mkRow('Deriva', '◀', '▶', (m) => void this.correct(m, 0)));
    this.corrPanel.appendChild(mkRow('Alcance', '−', '+', (m) => void this.correct(0, m)));

    this.corrStatus = document.createElement('p');
    this.corrStatus.className = 'hint';
    this.corrStatus.textContent =
      'Dispara, observa el impacto desde el OP y corrige. El boom tarda lo que tarda el sonido.';
    this.corrPanel.appendChild(this.corrStatus);

    document.body.appendChild(this.corrPanel);
  }

  private corrButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  // -- Ciclo del reto -----------------------------------------------------------
  private async start(): Promise<void> {
    this.startBtn.disabled = true;
    this.hooks.onStart?.(); // el reto clásico muere si estaba vivo
    const weaponAtStart = this.panel.weaponId;
    const chargeAtStart = this.panel.chargeIndex;
    try {
      const id = weaponAtStart;
      const ring = await this.service.approxMaxRange(id, chargeAtStart);
      // La semilla del reloj SOLO aquí — la lógica del anillo/OP es pura.
      const spec = pickTargetInRing(Math.random, ring.maxRangeM, ring.minRangeM);

      // Diana a la altura real del suelo (perfil 1D como el reto clásico).
      const corridor = await this.service.sampleCorridor(spec.azimuthDeg, spec.rangeM * 1.05, 400, 0);
      const ground = buildTerrain(corridor);
      const az = (spec.azimuthDeg * Math.PI) / 180;
      const e = Math.sin(az) * spec.rangeM;
      const n = Math.cos(az) * spec.rangeM;
      const target = new Vec3(e, n, ground(e, n));

      // OP con línea de visión: hasta 8 candidatos, acercándose si el
      // relieve bloquea; si ninguno ve, el último (el más cercano) vale.
      const candidates = opCandidates(Math.random, { x: target.x, y: target.y });
      let op: Vec3 | null = null;
      for (const c of candidates) {
        const profile = await this.service.sampleLineProfile(
          new Vec3(c.x, c.y, 0), target, 120,
        );
        if (hasLineOfSight(profile)) {
          op = new Vec3(c.x, c.y, profile[0]);
          break;
        }
        op = new Vec3(c.x, c.y, profile[0]); // fallback: el último candidato
      }
      if (!op) throw new Error('sin candidatos de OP');

      // Si el usuario cambió de arma/carga durante el planteo (awaits de
      // terreno/LOS), este reto es del arma anterior: abortar en silencio.
      if (this.panel.weaponId !== weaponAtStart || this.panel.chargeIndex !== chargeAtStart) {
        return;
      }

      // Estimación inicial del FO: el objetivo con un error de 100-350 m
      // (la llamada de fuego inicial nunca es exacta: por eso se corrige).
      const errAng = Math.random() * Math.PI * 2;
      const errR = 100 + Math.random() * 250;
      this.aimPoint = new Vec3(
        target.x + Math.sin(errAng) * errR,
        target.y + Math.cos(errAng) * errR,
        target.z,
      );

      this.target = target;
      this.opPos = op;
      this.rounds = 0;
      this.scored = false;

      // Sin chivatos: parábola OFF, 🎯 bloqueado; el marcador de la diana SÍ
      // se pinta (el FO tiene que VER su objetivo para corregir).
      this.hooks.marker(target);
      this.hooks.lockPick(true);
      this.savedArc = this.panel.arcChecked; // restaurar EXACTAMENTE esto al salir
      this.hooks.setArc(false);
      const lookAz = ((Math.atan2(target.x - op.x, target.y - op.y) * 180) / Math.PI + 360) % 360;
      this.hooks.enterOpCamera(new Vec3(op.x, op.y, op.z + 1.7), lookAz);

      // Primera solución de tiro sobre la estimación (el FDC trabaja: el
      // observador solo corrige lo que ve).
      await this.solveToAim();

      this.surrenderBtn.style.display = '';
      this.startBtn.textContent = '🔭 Otro reto FO';
      this.corrPanel.style.display = '';
      const dTO = Math.hypot(target.x - op.x, target.y - op.y);
      this.statusEl.textContent =
        `FO desplegado a ${(dTO / 1000).toFixed(1)} km del objetivo. ` +
        'Corrige con el panel 🔭 y dispara: puntúan las rondas gastadas.';
      toast('🔭 Reto FO: observa desde el cerro, corrige y bate el objetivo (<50 m)');
    } catch (err) {
      console.error('[fo]', err);
      toast('No se pudo plantear el reto FO');
      this.endInternal();
    } finally {
      this.startBtn.disabled = false;
    }
  }

  /** Corrección cantada: traslada el punto de puntería sobre los ejes OT. */
  private async correct(rightM: number, addM: number): Promise<void> {
    if (!this.active || !this.aimPoint || !this.opPos || !this.target) return;
    const moved = applyObserverCorrection(
      { x: this.aimPoint.x, y: this.aimPoint.y },
      { x: this.opPos.x, y: this.opPos.y },
      { x: this.target.x, y: this.target.y },
      rightM, addM,
    );
    this.aimPoint = new Vec3(moved.x, moved.y, this.aimPoint.z);
    const dir = rightM !== 0
      ? (rightM > 0 ? `derecha ${rightM}` : `izquierda ${-rightM}`)
      : (addM > 0 ? `largo ${addM}` : `corto ${-addM}`);
    this.corrStatus.textContent = `Corrección "${dir}" aplicada — resolviendo tiro…`;
    await this.solveToAim();
  }

  /** Re-resuelve la dirección de tiro hacia el punto de puntería vigente. */
  private async solveToAim(): Promise<void> {
    if (!this.aimPoint) return;
    try {
      const sol = await this.service.solveForTarget(
        this.panel.weaponId, this.aimPoint, this.panel.chargeIndex, this.panel.preferHighAngle,
      );
      if (!sol.found) {
        this.corrStatus.textContent =
          'El punto corregido queda FUERA de alcance — corrige en corto o cambia de carga.';
        return;
      }
      this.panel.setAim(sol.azimuthDeg, sol.elevationDeg);
      this.hooks.schedulePreview();
      this.corrStatus.textContent =
        `Solución lista (az ${sol.azimuthDeg.toFixed(1)}º · QE ${sol.elevationDeg.toFixed(2)}º). ¡Fuego!`;
    } catch (err) {
      console.error('[fo-solve]', err);
      this.corrStatus.textContent = 'Fallo resolviendo el tiro — reintenta la corrección.';
    }
  }

  /** Hook del onImpact global: cada ronda cuenta; <50 m cierra el reto. */
  notifyImpact(impactEnu: Vec3): void {
    if (!this.active || !this.target) return;
    this.rounds++;
    const missM = Math.hypot(impactEnu.x - this.target.x, impactEnu.y - this.target.y);
    if (missM >= FO_HIT_RADIUS_M) {
      this.corrStatus.textContent =
        `Ronda ${this.rounds}: fallo de ${missM.toFixed(0)} m — observa dónde levantó y corrige.`;
      return;
    }

    // Objetivo batido.
    this.scored = true;
    const stars = foStars(this.rounds);
    const records = loadRecords<FoRecord>(STORE_KEY);
    const { record, improved } = improveFoRecord(
      records[this.panel.weaponId], this.rounds, new Date().toISOString(),
    );
    records[this.panel.weaponId] = record;
    saveRecords(STORE_KEY, records);

    const bar = '★★★'.slice(0, stars).padEnd(3, '☆');
    toast(`${bar} — objetivo batido en ${this.rounds} ronda${this.rounds === 1 ? '' : 's'}` +
      (improved ? ' · ¡RÉCORD!' : ''));
    this.statusEl.textContent =
      `${bar} batido en ${this.rounds} ronda${this.rounds === 1 ? '' : 's'}` +
      (improved ? ' · ¡récord nuevo!' : ` · récord ${record.bestRounds}`) +
      ' — 🔭 para otro reto.';
    this.endInternal();
  }

  private async surrender(): Promise<void> {
    if (!this.target) return;
    this.scored = true;
    try {
      const sol = await this.service.solveForTarget(
        this.panel.weaponId, this.target, this.panel.chargeIndex, this.panel.preferHighAngle,
      );
      if (sol.found) {
        this.panel.setAim(sol.azimuthDeg, sol.elevationDeg);
        this.statusEl.textContent =
          `Solución real: az ${sol.azimuthDeg.toFixed(1)}º · QE ${sol.elevationDeg.toFixed(2)}º. ` +
          'Sin puntuar — 🔭 para otro reto.';
      }
    } catch (err) {
      console.error('[fo]', err);
    }
    this.endInternal();
    this.hooks.schedulePreview();
  }

  /** Cancela el reto vivo (cambio de arma, mover batería, reto clásico). */
  cancel(): void {
    if (this.target) this.endInternal();
    this.showRecord();
  }

  private endInternal(): void {
    const wasActive = this.target !== null;
    this.target = null;
    this.opPos = null;
    this.aimPoint = null;
    this.corrPanel.style.display = 'none';
    this.surrenderBtn.style.display = 'none';
    this.startBtn.textContent = '🔭 Reto FO';
    if (wasActive) {
      this.hooks.marker(null);
      this.hooks.lockPick(false);
      // Restaura el estado REAL previo al reto: quien jugaba en modo
      // inmersión (parábola OFF) no debe salir con ella forzada a ON.
      this.hooks.setArc(this.savedArc ?? true);
      this.hooks.exitOpCamera();
    }
    this.savedArc = null;
  }

  private showRecord(): void {
    const rec = loadRecords<FoRecord>(STORE_KEY)[this.panel.weaponId];
    if (rec) {
      const bar = '★★★'.slice(0, rec.stars).padEnd(3, '☆');
      this.statusEl.textContent =
        `Récord FO con esta arma: ${bar} en ${rec.bestRounds} ronda${rec.bestRounds === 1 ? '' : 's'}.`;
    } else {
      this.statusEl.textContent = 'Reto FO: corrige el tiro desde un puesto de observación.';
    }
  }
}
