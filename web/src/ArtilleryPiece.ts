// ============================================================================
//  ArtilleryPiece.ts — La pieza: puntería, dirección de tiro y disparo.
//  [P-WEB.4, orquesta P2.2 (MRSI), P2.3 (preview), P4.2 (comparación)]
//
//  Equivalente web de AArtilleryPiece: mantiene el estado de puntería del
//  panel, resuelve elevación al hacer clic en el globo (rama alta/baja),
//  previsualiza el arco en vivo y al disparar crea presentadores de
//  proyectil (con retardos para la salva MRSI).
// ============================================================================
import { FireOrder, Vec3, WeaponSystem } from './ballistics';
import { BallisticsService } from './BallisticsService';
import { CameraDirector } from './CameraDirector';
import { ProjectilePresenter } from './ProjectilePresenter';
import { ThreeOverlay } from './render/ThreeOverlay';
import { TrajectoryPreview } from './TrajectoryPreview';
import { AudioBoom } from './vfx/AudioBoom';
import { CraterLayer } from './vfx/CraterLayer';
import { VfxManager } from './vfx/effects';
import { ControlPanel } from './ui/ControlPanel';
import { HUD } from './ui/HUD';
import { toast } from './ui/toast';

export class ArtilleryPiece {
  targetEnu: Vec3 | null = null;

  private presenters: ProjectilePresenter[] = [];
  private previewToken = 0;
  private previewTimer: number | undefined;

  constructor(
    private readonly service: BallisticsService,
    private readonly overlay: ThreeOverlay,
    private readonly vfx: VfxManager,
    private readonly audio: AudioBoom,
    private readonly preview: TrajectoryPreview,
    private readonly director: CameraDirector,
    private readonly panel: ControlPanel,
    private readonly hud: HUD,
    private readonly craters: CraterLayer | null = null,
  ) {}

  order(): FireOrder {
    return {
      azimuthDeg: this.panel.azimuthDeg,
      elevationDeg: this.panel.elevationDeg,
      chargeIndex: this.panel.chargeIndex,
    };
  }

  /** Preview con debounce: recalcular arcos a cada pixel de slider satura. */
  schedulePreview(delayMs = 180): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => void this.refreshPreview(), delayMs);
  }

  async refreshPreview(): Promise<void> {
    const token = ++this.previewToken;
    try {
      const ring = await this.service.approxMaxRange(this.panel.weaponId, this.panel.chargeIndex);
      // dt más grueso para la interactividad; el disparo real usa el dt fino.
      // El carril 'preview' cancela en el worker los solves ya obsoletos.
      const result = await this.service.solveTrajectory(
        this.panel.weaponId, this.order(), undefined, { dt: 0.01 }, 'preview',
      );
      if (token !== this.previewToken) return; // llegó otro preview más nuevo
      this.preview.showFlight(result);
      this.preview.showRings(ring.minRangeM, ring.maxRangeM);
      this.panel.setSolution(
        `QE ${this.panel.elevationDeg.toFixed(1)}º → ${(result.downrange / 1000).toFixed(2)} km · ` +
          `TOF ${result.timeOfFlight.toFixed(1)} s · ápice ${(result.apex / 1000).toFixed(1)} km`,
      );
    } catch (err) {
      if ((err as Error)?.name === 'SupersededError') return; // preview obsoleto
      console.error('[preview]', err);
    }
  }

  /** Clic en el globo: dirección de tiro inversa hacia ese punto (P-WEB.4). */
  async aimAt(targetEnu: Vec3): Promise<void> {
    this.targetEnu = targetEnu;
    this.preview.showTarget(targetEnu);
    this.panel.setStatus('Resolviendo dirección de tiro…');
    const sol = await this.service.solveForTarget(
      this.panel.weaponId, targetEnu, this.panel.chargeIndex, this.panel.preferHighAngle,
    );
    if (!sol.found) {
      this.panel.setStatus(
        `Fuera de alcance con esta carga (${(sol.rangeM / 1000).toFixed(1)} km). ` +
          'Prueba otra carga u otra rama.',
      );
      toast('Objetivo fuera de alcance');
      return;
    }
    this.panel.setAim(sol.azimuthDeg, sol.elevationDeg);
    this.panel.setStatus(
      `Solución ${this.panel.preferHighAngle ? 'rama alta' : 'rama baja'}: ` +
        `az ${sol.azimuthDeg.toFixed(1)}º · QE ${sol.elevationDeg.toFixed(2)}º · ` +
        `TOF ${sol.timeOfFlight.toFixed(1)} s`,
    );
    this.schedulePreview(0);
  }

  /** FUEGO (P-WEB.4). El objetivo marcado activa el guiado en municiones guiadas. */
  async fire(): Promise<void> {
    this.audio.unlock();
    this.panel.setFiring(true);
    try {
      const weapon = this.service.weapon(this.panel.weaponId);
      const guided = weapon.round.guidance.enabled && this.targetEnu ? this.targetEnu : undefined;
      const flight = await this.service.solveTrajectory(this.panel.weaponId, this.order(), guided);
      this.spawn(flight.warheadTNTeq, flight, 0);
      this.hud.show(flight);
      this.panel.setStatus(
        `En vuelo: ${(flight.downrange / 1000).toFixed(2)} km, TOF ${flight.timeOfFlight.toFixed(1)} s` +
          (guided ? ' · guiado terminal activo' : ''),
      );
    } catch (err) {
      console.error('[fire]', err);
      toast('No se pudo resolver el tiro');
    } finally {
      this.panel.setFiring(false);
    }
  }

  /** P2.2 — salva MRSI: N rondas que impactan a la vez. */
  async fireMRSI(nRounds: number): Promise<void> {
    this.audio.unlock();
    this.panel.setFiring(true);
    this.panel.setStatus('Calculando salva MRSI…');
    try {
      // El alcance objetivo: el del objetivo marcado o el del arco actual.
      let azimuth = this.panel.azimuthDeg;
      let rangeM: number;
      if (this.targetEnu) {
        azimuth = (Math.atan2(this.targetEnu.x, this.targetEnu.y) * 180) / Math.PI;
        rangeM = Math.hypot(this.targetEnu.x, this.targetEnu.y);
      } else {
        const probe = await this.service.solveTrajectory(this.panel.weaponId, this.order(), undefined, { dt: 0.01 });
        rangeM = probe.downrange;
      }

      const rounds = await this.service.solveMRSI(this.panel.weaponId, azimuth, rangeM, nRounds);
      if (rounds.length < 2) {
        toast('MRSI imposible aquí: hacen falta ≥2 soluciones con TOF distinto');
        this.panel.setStatus('MRSI: sin suficientes soluciones (prueba otro alcance).');
        return;
      }

      let lastFlight = null;
      for (const r of rounds) {
        const flight = await this.service.solveTrajectory(this.panel.weaponId, {
          azimuthDeg: azimuth, elevationDeg: r.elevationDeg, chargeIndex: r.chargeIndex,
        });
        this.spawn(flight.warheadTNTeq, flight, r.fireDelay);
        lastFlight = flight;
      }
      if (lastFlight) this.hud.show(lastFlight);
      this.panel.setStatus(
        `Salva MRSI: ${rounds.length} rondas → impacto simultáneo en ` +
          `${(rangeM / 1000).toFixed(2)} km (QE ${rounds
            .map((r) => r.elevationDeg.toFixed(1))
            .join('º / ')}º).`,
      );
    } catch (err) {
      console.error('[mrsi]', err);
      toast('Fallo calculando la salva MRSI');
    } finally {
      this.panel.setFiring(false);
    }
  }

  /**
   * P-NEXT.7 — salva dispersa ×n: los tiros reales con errores realistas
   * (σ_V0 ~0.3%, σ_puntería ~1 mil, viento no reportado). Al caer, los
   * cráteres dibujan la elipse de dispersión y un toast reporta el CEP.
   * La semilla sale del reloj SOLO aquí, en la app — nunca en tests.
   */
  async fireDispersedSalvo(nRounds = 6): Promise<void> {
    this.audio.unlock();
    this.panel.setFiring(true);
    this.panel.setStatus(`Calculando salva dispersa ×${nRounds}…`);
    try {
      const weapon = this.service.weapon(this.panel.weaponId);
      const v0 = WeaponSystem.muzzleVelocity(weapon, this.order());
      const errors = {
        muzzleVelocityStd: 0.003 * v0, // ~0.3% lote a lote
        azimuthStdMils: 1.0,
        elevationStdMils: 1.0,
        windStd: 0.6,
      };
      const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      const res = await this.service.fireDispersed(
        this.panel.weaponId, this.order(), nRounds, errors, seed,
      );
      const flights = res.flights ?? [];
      if (flights.length === 0) {
        toast('La salva no devolvió tiros — mira la consola');
        return;
      }

      let landed = 0;
      flights.forEach((flight, i) => {
        this.spawn(flight.warheadTNTeq, flight, i * 0.5, () => {
          landed++;
          if (landed === flights.length) {
            toast(`Zona batida: CEP ${res.cep.toFixed(0)} m (${flights.length} impactos)`);
          }
        });
      });
      this.hud.show(flights[0]);
      this.panel.setStatus(
        `Salva dispersa ×${flights.length} en el aire · CEP previsto ${res.cep.toFixed(0)} m — ` +
          'los cráteres dibujarán la elipse.',
      );
    } catch (err) {
      console.error('[disperse]', err);
      toast('Fallo calculando la salva dispersa');
    } finally {
      this.panel.setFiring(false);
    }
  }

  /** P4.2 — modo comparación: vacío / arrastre / Coriolis / viento. */
  async compare(): Promise<void> {
    this.panel.setStatus('Calculando comparación de físicas…');
    try {
      const list = await this.service.compareTrajectories(this.panel.weaponId, this.order());
      this.preview.showCompare(list);
      const vacio = list[0].result.downrange;
      const todo = list[list.length - 1].result.downrange;
      this.panel.setStatus(
        `Comparación: vacío ${(vacio / 1000).toFixed(2)} km vs real ${(todo / 1000).toFixed(2)} km ` +
          `(el arrastre roba ${((1 - todo / vacio) * 100).toFixed(0)}%).`,
      );
    } catch (err) {
      console.error('[compare]', err);
      toast('Fallo en el modo comparación');
    }
  }

  private spawn(
    warheadTNTeq: number,
    flight: import('./ballistics').FlightResult,
    delay: number,
    onImpactExtra?: () => void,
  ): ProjectilePresenter {
    const weapon = this.service.weapon(this.panel.weaponId);
    const p = new ProjectilePresenter(
      this.service, this.overlay, this.vfx, this.audio, this.craters, weapon, flight, delay,
    );
    p.onImpact = (impactEnu) => {
      this.director.shakeFromImpact(impactEnu, warheadTNTeq); // P0.1+P0.2
      this.director.setFocus(impactEnu); // orbital/dron miran al cráter
      onImpactExtra?.();
    };
    this.presenters.push(p);
    // Si la cámara está en "seguir", engancha al último proyectil disparado.
    if (this.director.mode === 'follow') this.director.follow(p);
    return p;
  }

  /** Enganchar la cámara de seguimiento al proyectil más reciente. */
  followLatest(): boolean {
    const live = this.presenters.filter((p) => !p.isImpacted);
    const target = live[live.length - 1] ?? this.presenters[this.presenters.length - 1];
    if (!target) return false;
    this.director.follow(target);
    return true;
  }

  update(dt: number): void {
    for (let i = this.presenters.length - 1; i >= 0; i--) {
      if (!this.presenters[i].update(dt)) this.presenters.splice(i, 1);
    }
    // HUD: telemetría del proyectil vivo más reciente.
    const live = [...this.presenters].reverse().find((p) => !p.isImpacted);
    if (live) this.hud.update(live.telemetry());
    else if (this.presenters.length === 0) this.hud.hide();
  }

  clearTarget(): void {
    this.targetEnu = null;
    this.preview.showTarget(null);
  }
}
