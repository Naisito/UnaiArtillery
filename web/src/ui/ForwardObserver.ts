// ============================================================================
//  ForwardObserver.ts — Reto de Observador Avanzado.  [P-VIVO.6 · V2]
//
//  La esencia de la artillería: NO ves el objetivo desde el arma — lo ve un
//  observador (FO) que canta correcciones ("derecha 50, largo 100"). El reto:
//    * objetivo aleatorio como el reto clásico (anillo [0.4, 0.9]·alcanceMáx);
//    * puesto de observación (OP) a 2-4 km del objetivo, perpendicular ± al
//      rumbo batería→objetivo, con LÍNEA DE VISIÓN validada muestreando el
//      perfil OP→objetivo (si el relieve bloquea, reintenta acercándose);
//    * cámara CLAVADA en el OP a 1.7 m del suelo (modo 'op': girar/zoom, sin
//      moverse), parábola forzada OFF, elipse PER y marcador de impacto
//      previsto OCULTOS, designación desactivada — nada de chivatos;
//    * correcciones ±25/±50/±100 m en los ejes de LA LÍNEA OP→OBJETIVO
//      (foCore, pura y testeada) que trasladan el punto de puntería y
//      re-resuelven la dirección de tiro;
//    * puntúa por RONDAS gastadas hasta impactar a <50 m (1=★★★, 2-3=★★,
//      4-6=★); récord por arma en localStorage 'unai-artillery/challenge-fo/v1'.
//
//  V2: tarjeta de misión en la pestaña INSTRUCCIÓN y panel de corrección
//  flotante (#foPanel) en el mismo lenguaje visual.
// ============================================================================
import { Vec3 } from '../ballistics';
import { buildTerrain } from '../ballistics/WorkerProtocol';
import { BallisticsService } from '../BallisticsService';
import { button, setButtonLabel } from './components';
import { pickTargetInRing } from './challengeCore';
import { ControlPanel } from './ControlPanel';
import { h, setText } from './dom';
import {
  FO_HIT_RADIUS_M, FoRecord, applyObserverCorrection, foStars, hasLineOfSight,
  improveFoRecord, opCandidates,
} from './foCore';
import { icon } from './icons';
import { MissionCard, missionCard } from './missionCard';
import { loadRecords, saveRecords } from './recordStore';
import { settings } from './settings';
import { toast } from './toast';
import { fmtAngle, fmtNum } from './units';
import { WEAPON_INFO } from './weaponInfo';

const STORE_KEY = 'unai-artillery/challenge-fo/v1';

export interface ForwardObserverHooks {
  /** Marca la diana (reutiliza el marcador dorado del reto clásico). */
  marker(enu: Vec3 | null): void;
  /** Bloquea/desbloquea la designación en el mapa. */
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

  private readonly card: MissionCard;
  private readonly startBtn: HTMLButtonElement;
  private readonly surrenderBtn: HTMLButtonElement;
  private corrPanel!: HTMLElement;
  private corrStatus!: HTMLElement;
  private roundsEl!: HTMLElement;

  constructor(
    private readonly service: BallisticsService,
    private readonly panel: ControlPanel,
    private readonly hooks: ForwardObserverHooks,
    host: HTMLElement = document.getElementById('instructionHost') ?? document.body,
  ) {
    this.card = missionCard({
      icon: 'binoculars', tag: 'Observación', title: 'Observador avanzado', testid: 'mission-fo', gloss: 'fo',
      desc: 'Solo ves el mundo desde un cerro con línea de visión al objetivo. Corrige como se hace de verdad: derecha/izquierda y largo/corto sobre TU línea de visión. Puntúan las rondas gastadas.',
    });
    this.startBtn = button({
      label: 'Iniciar reto FO', icon: 'play', variant: 'primary', size: 's', testid: 'fo-start',
      onClick: () => void this.start(),
    });
    this.surrenderBtn = button({
      label: 'Rendirse', size: 's', variant: 'ghost', testid: 'fo-surrender',
      title: 'Revela el objetivo y la solución (no puntúa)', onClick: () => void this.surrender(),
    });
    this.surrenderBtn.hidden = true;
    this.card.actions.append(this.startBtn, this.surrenderBtn);
    host.appendChild(this.card.el);
    this.showRecord();
    this.buildCorrectionPanel();
  }

  get active(): boolean { return this.target !== null && !this.scored; }

  // -- Panel de correcciones (flota abajo-centro solo durante el reto) --------
  private buildCorrectionPanel(): void {
    this.roundsEl = h('span', { class: 'fo-rounds num' });
    this.corrStatus = h('p', { class: 'fo-status', attrs: { role: 'status' } });
    const row = (label: string, gloss: string, neg: string, pos: string, apply: (m: number) => void) => {
      const r = h('div', { class: 'fo-row' },
        h('span', { class: 'fo-row__label', text: label, dataset: { gloss } }),
      );
      const negGroup = h('div', { class: 'fo-group fo-group--neg' });
      for (const m of [100, 50, 25]) negGroup.appendChild(this.corrButton(`${neg} ${m}`, `fo-${neg.toLowerCase()}-${m}`, () => apply(-m)));
      const posGroup = h('div', { class: 'fo-group fo-group--pos' });
      for (const m of [25, 50, 100]) posGroup.appendChild(this.corrButton(`${pos} ${m}`, `fo-${pos.toLowerCase()}-${m}`, () => apply(m)));
      r.append(negGroup, h('span', { class: 'fo-row__axis' }), posGroup);
      return r;
    };
    this.corrPanel = h('div', { id: 'foPanel', testid: 'fo-panel', attrs: { role: 'region', 'aria-label': 'Corrección del observador' } },
      h('header', { class: 'fo-head' },
        h('span', { class: 'fo-head__icon' }, icon('binoculars', 18)),
        h('div', { class: 'fo-head__titles' },
          h('span', { class: 'ua-eyebrow', text: 'Observador avanzado' }),
          h('span', { class: 'fo-head__title', text: 'Corrección del tiro' }),
        ),
        h('div', { class: 'fo-head__rounds' }, h('span', { class: 'ua-eyebrow', text: 'Rondas' }), this.roundsEl),
      ),
      // "Derecha/izquierda" y "largo/corto" SIEMPRE sobre la línea OP→objetivo.
      row('Dirección', 'fo', 'Izq', 'Der', (m) => void this.correct(m, 0)),
      row('Alcance', 'fo', 'Corto', 'Largo', (m) => void this.correct(0, m)),
      this.corrStatus,
    );
    this.corrPanel.hidden = true;
    document.body.appendChild(this.corrPanel);
  }

  private corrButton(label: string, testid: string, onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'fo-btn num', testid, attrs: { type: 'button' }, on: { click: onClick } }, label);
  }

  private setCorrStatus(text: string): void { setText(this.corrStatus, text); }

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
        const profile = await this.service.sampleLineProfile(new Vec3(c.x, c.y, 0), target, 120);
        if (hasLineOfSight(profile)) {
          op = new Vec3(c.x, c.y, profile[0]);
          break;
        }
        op = new Vec3(c.x, c.y, profile[0]); // fallback: el último candidato
      }
      if (!op) throw new Error('sin candidatos de OP');

      // Si el usuario cambió de arma/carga durante el planteo, este reto es
      // del arma anterior: abortar en silencio.
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
      setText(this.roundsEl, '0');

      // Sin chivatos: parábola OFF, designación bloqueada; el marcador de la
      // diana SÍ se pinta (el FO tiene que VER su objetivo para corregir).
      this.hooks.marker(target);
      this.hooks.lockPick(true);
      this.savedArc = this.panel.arcChecked; // restaurar EXACTAMENTE esto al salir
      this.hooks.setArc(false);
      const lookAz = ((Math.atan2(target.x - op.x, target.y - op.y) * 180) / Math.PI + 360) % 360;
      this.hooks.enterOpCamera(new Vec3(op.x, op.y, op.z + 1.7), lookAz);

      // Primera solución de tiro sobre la estimación (el FDC trabaja: el
      // observador solo corrige lo que ve).
      await this.solveToAim();

      this.surrenderBtn.hidden = false;
      setButtonLabel(this.startBtn, 'Otro objetivo');
      this.card.setLive(true);
      this.corrPanel.hidden = false;
      document.body.classList.add('fo-active');
      const dTO = Math.hypot(target.x - op.x, target.y - op.y);
      this.card.setStatus(
        `Observador a ${(dTO / 1000).toFixed(1)} km del objetivo. Corrige con el panel inferior y dispara: puntúan las rondas.`);
      toast('Observa desde el cerro, corrige y bate el objetivo a menos de 50 m', { title: 'Reto FO' });
    } catch (err) {
      console.error('[fo]', err);
      toast('No se pudo plantear el reto FO', { level: 'error' });
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
    this.setCorrStatus(`Corrección "${dir}" aplicada — resolviendo tiro…`);
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
        this.setCorrStatus('El punto corregido queda FUERA de alcance — corrige en corto o cambia de carga.');
        return;
      }
      this.panel.setAim(sol.azimuthDeg, sol.elevationDeg);
      this.hooks.schedulePreview();
      const u = settings.angleUnit;
      this.setCorrStatus(`Solución lista: AZ ${fmtAngle(sol.azimuthDeg, u)} · QE ${fmtAngle(sol.elevationDeg, u)}. ¡Fuego!`);
    } catch (err) {
      console.error('[fo-solve]', err);
      this.setCorrStatus('Fallo resolviendo el tiro — reintenta la corrección.');
    }
  }

  /** Hook del onImpact global: cada ronda cuenta; <50 m cierra el reto. */
  notifyImpact(impactEnu: Vec3): void {
    if (!this.active || !this.target) return;
    this.rounds++;
    setText(this.roundsEl, String(this.rounds));
    const missM = Math.hypot(impactEnu.x - this.target.x, impactEnu.y - this.target.y);
    if (missM >= FO_HIT_RADIUS_M) {
      this.setCorrStatus(`Ronda ${this.rounds}: fallo de ${fmtNum(missM, 0)} m — observa dónde levantó y corrige.`);
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

    const rondas = `${this.rounds} ronda${this.rounds === 1 ? '' : 's'}`;
    toast(`Objetivo batido en ${rondas} — ${stars} estrella${stars === 1 ? '' : 's'}${improved ? ' · nuevo récord' : ''}`, {
      level: 'success', title: 'Reto FO',
    });
    this.card.setStatus(`Batido en ${rondas}` + (improved ? ' — ¡récord nuevo!' : ` (récord ${record.bestRounds})`));
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
        const u = settings.angleUnit;
        this.card.setStatus(`Solución real: AZ ${fmtAngle(sol.azimuthDeg, u)} · QE ${fmtAngle(sol.elevationDeg, u)}. Sin puntuar.`);
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
    this.corrPanel.hidden = true;
    document.body.classList.remove('fo-active');
    this.surrenderBtn.hidden = true;
    this.card.setLive(false);
    setButtonLabel(this.startBtn, 'Iniciar reto FO');
    if (wasActive) {
      this.hooks.marker(null);
      this.hooks.lockPick(false);
      // Restaura el estado REAL previo al reto: quien jugaba en modo
      // inmersión (parábola OFF) no debe salir con ella forzada a ON.
      this.hooks.setArc(this.savedArc ?? true);
      this.hooks.exitOpCamera();
    }
    this.savedArc = null;
    this.showRecordLine();
  }

  private showRecordLine(): void {
    const name = WEAPON_INFO[this.panel.weaponId].designation;
    const rec = loadRecords<FoRecord>(STORE_KEY)[this.panel.weaponId];
    this.card.setRecord(rec ? rec.stars : null,
      rec ? `${rec.bestRounds} ronda${rec.bestRounds === 1 ? '' : 's'} · ${name}` : `sin récord con ${name}`);
  }

  private showRecord(): void {
    this.showRecordLine();
    this.card.setStatus('');
  }
}
