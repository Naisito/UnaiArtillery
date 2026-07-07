// ============================================================================
//  ArtilleryPiece.ts — La pieza: puntería, dirección de tiro y disparo.
//  [P-WEB.4, orquesta P2.2 (MRSI), P2.3 (preview), P4.2 (comparación)]
//
//  Equivalente web de AArtilleryPiece: mantiene el estado de puntería del
//  panel, resuelve elevación al hacer clic en el globo (rama alta/baja),
//  previsualiza el arco en vivo y al disparar crea presentadores de
//  proyectil (con retardos para la salva MRSI).
// ============================================================================
import {
  DeterministicRng, FireOrder, MAX_LIVE_PROJECTILES, Vec3, WeaponSystem,
  fireJitterS, isTracer, perturbedLay, shotTimeS,
} from './ballistics';
import type { DispersionErrors, FlightResult } from './ballistics';
import { azimuthDegOf } from './vfx/audioMath';
import { BallisticsService } from './BallisticsService';
import type { TerrainSpec } from './BallisticsService';
import { CameraDirector } from './CameraDirector';
import { GunModel } from './GunModel';
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
  /** P-PRO.5/6 — el preview vigente cambió (tabla de tiro, elipse PER…). */
  onPreview?: (fr: FlightResult) => void;
  /** P-PRO.7 — cualquier impacto real (el reto puntúa el PRIMERO). */
  onAnyImpact?: (impactEnu: Vec3) => void;
  /** P-VIVO.5 — recorte contra edificios 3D (main lo enchufa si hay tileset). */
  buildingHit: import('./BuildingHit').BuildingHit | null = null;

  private presenters: ProjectilePresenter[] = [];
  private previewToken = 0;
  private previewTimer: number | undefined;

  // P-VIVO.10 — último vuelo real (para "↺ Repetir" sin re-integrar).
  private lastFlightCache: {
    flight: FlightResult;
    weapon: import('./ballistics').Weapon;
  } | null = null;

  // P-VIVO.2 — estado de la ráfaga automática (armas con rateOfFireRpm).
  private burst: {
    rng: DeterministicRng;
    shotIndex: number;
    clock: number;
    rpm: number;
    tracerEvery: number;
    terrain: TerrainSpec | null; // corredor muestreado UNA vez por ráfaga
    ready: boolean;
  } | null = null;

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
    /** P-PRO.1 — modelo del arma: boca real + retroceso al disparar. */
    private readonly gun: GunModel | null = null,
  ) {}

  /** TOF del último preview (P-VIVO.8: autocompleta la espoleta de la ILLUM). */
  private lastPreviewTofS: number | null = null;

  order(): FireOrder {
    const base: FireOrder = {
      azimuthDeg: this.panel.azimuthDeg,
      elevationDeg: this.panel.elevationDeg,
      chargeIndex: this.panel.chargeIndex,
    };
    // P-VIVO.8 — la ILLUM SIEMPRE lleva espoleta de tiempo: revienta 0.5 s
    // antes del impacto previsto para desplegar la bengala en alto. Sin
    // preview aún, cae a 'impact' (la bengala se abre a ras: degradación).
    if (this.panel.weapon().round.payload === 'illum' && this.lastPreviewTofS !== null) {
      base.fuze = { mode: 'time', timeS: Math.max(1, this.lastPreviewTofS - 0.5) };
    }
    return base;
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
      // El preview vuela SIN espoleta: mide el TOF balístico completo (la
      // espoleta de tiempo de la ILLUM se autocompleta con ESTE TOF - 0.5 s;
      // si el preview ya recortara en el aire se realimentaría a sí mismo).
      const { fuze: _fuze, ...bareOrder } = this.order();
      const result = await this.service.solveTrajectory(
        this.panel.weaponId, bareOrder, undefined, { dt: 0.01 }, 'preview',
      );
      if (token !== this.previewToken) return; // llegó otro preview más nuevo
      this.lastPreviewTofS = result.timeOfFlight;
      this.preview.showFlight(result);
      this.preview.showRings(ring.minRangeM, ring.maxRangeM);
      this.onPreview?.(result);
      // P-PRO.6 — con objetivo marcado, elipse 1σ/2σ predicha sobre el
      // impacto previsto (mismas σ que la salva dispersa: deben solaparse).
      if (this.targetEnu) void this.refreshErrorEllipse(result, token);
      else this.preview.showErrorEllipse(null);
      this.panel.setSolution(
        `QE ${this.panel.elevationDeg.toFixed(1)}º → ${(result.downrange / 1000).toFixed(2)} km · ` +
          `TOF ${result.timeOfFlight.toFixed(1)} s · ápice ${(result.apex / 1000).toFixed(1)} km`,
      );
    } catch (err) {
      if ((err as Error)?.name === 'SupersededError') return; // preview obsoleto
      console.error('[preview]', err);
    }
  }

  /** σ realistas de la batería — las MISMAS para la salva dispersa (a
   *  posteriori) y la elipse predicha (a priori): así se superponen. */
  private dispersionErrors(): DispersionErrors {
    const weapon = this.service.weapon(this.panel.weaponId);
    const v0 = WeaponSystem.muzzleVelocity(weapon, this.order());
    return {
      muzzleVelocityStd: 0.003 * v0, // ~0.3% lote a lote
      azimuthStdMils: 1.0,
      elevationStdMils: 1.0,
      windStd: 0.6,
    };
  }

  /** P-PRO.6 — recalcula y pinta la elipse de error predicha. */
  private async refreshErrorEllipse(previewFlight: FlightResult, token: number): Promise<void> {
    try {
      const pred = await this.service.predictDispersion(
        this.panel.weaponId, this.order(), this.dispersionErrors(),
      );
      if (token !== this.previewToken) return;
      this.preview.showErrorEllipse({
        centerEnu: previewFlight.impactPoint,
        bearingDeg: this.panel.azimuthDeg,
        sigmaRangeM: pred.sigmaRangeM,
        sigmaCrossM: pred.sigmaCrossM,
      });
    } catch (err) {
      if ((err as Error)?.name === 'SupersededError') return;
      console.error('[predict-dispersion]', err);
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

  /** FUEGO (P-WEB.4). El objetivo marcado activa el guiado en municiones guiadas.
   *  P-VIVO.4: las armas ligeras vuelan con rebotes rasantes encadenados. */
  async fire(): Promise<void> {
    this.audio.unlock();
    this.panel.setFiring(true);
    try {
      const weapon = this.service.weapon(this.panel.weaponId);
      if (weapon.category === 'SmallArms') {
        // La semilla del reloj SOLO aquí (la geometría del rebote es pura).
        const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
        const segments = await this.service.solveWithRicochets(
          this.panel.weaponId, this.order(), seed,
        );
        this.spawnSegments(segments, {});
        this.hud.show(segments[0]);
        this.panel.setStatus(
          `En vuelo: ${(segments[0].downrange / 1000).toFixed(2)} km, ` +
            `TOF ${segments[0].timeOfFlight.toFixed(1)} s` +
            (segments.length > 1 ? ` · ¡${segments.length - 1} rebote(s) rasante(s)!` : ''),
        );
        return;
      }
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

  /**
   * P-VIVO.4 — encadena los tramos de un tiro con rebotes SIN COSTURA: cada
   * tramo arranca exactamente cuando termina el anterior (startDelay), los
   * tramos de rebote no repiten firma de boca, el trazador arrastra su edad
   * y SOLO el impacto final puntúa retos.
   */
  private spawnSegments(
    segments: FlightResult[],
    base: import('./ProjectilePresenter').PresenterOptions,
  ): void {
    let delay = 0;
    segments.forEach((flight, i) => {
      const last = i === segments.length - 1;
      this.spawn(flight.warheadTNTeq, flight, delay, undefined, {
        ...base,
        silentLaunch: i > 0 || base.silentLaunch,
        midair: i > 0, // el rebote nace en el aire, no en la boca del arma
        tracerAgeOffsetS: base.tracer && i > 0 ? delay : base.tracerAgeOffsetS,
        suppressScoring: !last,
      });
      delay += flight.timeOfFlight;
    });
  }

  // ---------------------------------------------------------------------------
  //  P-VIVO.2 — Ráfaga automática: MANTENER el botón FUEGO dispara a la
  //  cadencia real del arma con rebufo determinista (semilla por ráfaga) y
  //  trazadora cada `tracerEvery` balas. Soltar corta al instante.
  // ---------------------------------------------------------------------------
  startBurst(): void {
    const weapon = this.panel.weapon();
    const rpm = weapon.rateOfFireRpm;
    if (!rpm) {
      void this.fire(); // sin cadencia definida: tiro único clásico
      return;
    }
    if (this.burst) return; // ya hay una ráfaga viva
    this.audio.unlock();
    // La semilla del reloj SOLO aquí (nunca en tests): ráfaga reproducible.
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const burst = {
      rng: new DeterministicRng(seed),
      shotIndex: 0,
      clock: 0,
      rpm,
      tracerEvery: weapon.tracerEvery,
      terrain: null as TerrainSpec | null,
      ready: false,
    };
    this.burst = burst;
    // El corredor se muestrea UNA vez; las balas lo comparten (el rebufo de
    // ±2.5 mils queda dentro de la banda 2D de ±1 km).
    void (async () => {
      try {
        const ring = await this.service.approxMaxRange(this.panel.weaponId, this.panel.chargeIndex);
        burst.terrain = await this.service.sampleCorridor(
          this.panel.azimuthDeg, ring.maxRangeM, 400, 1000,
        );
      } catch (err) {
        console.error('[burst]', err);
      } finally {
        burst.ready = true; // sin corredor: cada solve muestreará el suyo
      }
    })();
  }

  /** Soltar el botón: la ráfaga muere YA (las balas en vuelo siguen). */
  endBurst(): void {
    this.burst = null;
  }

  /** Un disparo de la ráfaga: solve perturbado + presentación aligerada. */
  private fireBurstShot(index: number): void {
    const burst = this.burst;
    if (!burst) return;
    const weapon = this.service.weapon(this.panel.weaponId);
    const lay = perturbedLay(this.panel.azimuthDeg, this.panel.elevationDeg, burst.rng);
    const order: FireOrder = {
      azimuthDeg: lay.azimuthDeg,
      elevationDeg: WeaponSystem.clampElevation(weapon, lay.elevationDeg),
      chargeIndex: this.panel.chargeIndex,
    };
    const tracer = isTracer(index, burst.tracerEvery);
    const jitter = fireJitterS(burst.rng); // consumir SIEMPRE: reproducibilidad

    // Firma compartida: 1 fogonazo + 1 bocanada por cada 3 disparos; el
    // crack del arma suena en TODAS las balas, a la cadencia real ±5 ms.
    this.gun?.fireRecoil();
    const muzzle = this.gun?.muzzleWorldEnu() ?? this.service.muzzleEnu;
    const camEnu = this.overlay.cameraEnu();
    const distCam = Math.hypot(muzzle.x - camEnu.x, muzzle.y - camEnu.y, muzzle.z - camEnu.z);
    this.audio.boom(
      'rifle', distCam, this.service.soundSpeedAt(camEnu.z), 0.5,
      azimuthDegOf(muzzle.x - camEnu.x, muzzle.y - camEnu.y), jitter,
    );
    if (index % 3 === 0) {
      const dir = WeaponSystem.launchVelocity(order.azimuthDeg, order.elevationDeg, 1.0);
      this.vfx.burstFlash(muzzle, dir, 0.6);
    }

    // P-VIVO.4 — semilla de rebote derivada del RNG de la ráfaga: consumida
    // SIEMPRE (reproducibilidad bala a bala aunque no haya agua).
    const ricochetSeed = Math.floor(burst.rng.next() * 0xffffffff) >>> 0;
    void (async () => {
      try {
        const segments = await this.service.solveWithRicochets(
          this.panel.weaponId, order, ricochetSeed, burst.terrain ?? undefined,
        );
        this.spawnSegments(segments, { tracer, silentLaunch: true });
        if (index === 0) this.hud.show(segments[0]);
      } catch (err) {
        console.error('[burst-shot]', err);
      }
    })();
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
      const errors = this.dispersionErrors(); // P-PRO.6: las σ de la elipse
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
    opts: import('./ProjectilePresenter').PresenterOptions = {},
  ): ProjectilePresenter {
    // P-VIVO.2 — tope de proyectiles simultáneos en vuelo: FIFO silencioso
    // (el más viejo desaparece sin VFX de impacto ni cráter).
    const live = this.presenters.filter((q) => !q.isImpacted);
    if (live.length >= MAX_LIVE_PROJECTILES) {
      const oldest = live[0];
      oldest.dispose();
      const i = this.presenters.indexOf(oldest);
      if (i >= 0) this.presenters.splice(i, 1);
    }

    const weapon = this.service.weapon(this.panel.weaponId);
    // P-VIVO.10 — cachea el vuelo INICIAL (con su arma) para "↺ Repetir"
    // (los tramos de rebote y las rondas retrasadas no pisan la caché).
    if (delay === 0) this.lastFlightCache = { flight, weapon };
    const p = new ProjectilePresenter(
      this.service, this.overlay, this.vfx, this.audio, this.craters, weapon, flight, delay, opts,
    );
    // P-VIVO.5 — recorte estructural contra los edificios 3D (si están).
    if (this.buildingHit) p.structuralClip = this.buildingHit.prepare(flight, opts);
    // P-PRO.1 — fogonazo/humo desde la punta REAL del tubo + retroceso.
    // (Un tramo de rebote es `midair`: el propio presentador lo ignora.)
    if (this.gun) {
      p.muzzleProvider = () => this.gun!.muzzleWorldEnu();
      p.onLaunch = () => this.gun!.fireRecoil();
    }
    p.onImpact = (impactEnu) => {
      this.director.shakeFromImpact(impactEnu, warheadTNTeq); // P0.1+P0.2
      this.director.setFocus(impactEnu); // orbital/dron miran al cráter
      if (!opts.suppressScoring) this.onAnyImpact?.(impactEnu); // P-PRO.7/P-VIVO.4
      onImpactExtra?.();
    };
    this.presenters.push(p);
    // Si la cámara está en "seguir", engancha al tiro RECIÉN salido (no a un
    // tramo de rebote futuro, que aún vive en el punto de rebote).
    if (this.director.mode === 'follow' && delay === 0) this.director.follow(p);
    return p;
  }

  /**
   * P-VIVO.10 — "↺ Repetir": RE-REPRODUCE el último vuelo cacheado sin
   * re-integrar. VFX y audio sí; cráter NO (flag replay); tampoco puntúa
   * retos ni pinta impactos en el minimapa (onAnyImpact no se dispara).
   * `slow` aplica ×0.25 constante durante TODA la repetición.
   */
  replayLast(camera: 'follow' | 'cabin' | 'drone', slow: boolean): boolean {
    const cached = this.lastFlightCache;
    if (!cached) return false;
    const p = new ProjectilePresenter(
      this.service, this.overlay, this.vfx, this.audio, this.craters,
      cached.weapon, cached.flight, 0,
      { noCrater: true, fixedDilation: slow ? 0.25 : undefined },
    );
    if (this.gun) {
      p.muzzleProvider = () => this.gun!.muzzleWorldEnu();
      p.onLaunch = () => this.gun!.fireRecoil();
    }
    p.onImpact = (impactEnu) => {
      this.director.shakeFromImpact(impactEnu, cached.flight.warheadTNTeq);
      this.director.setFocus(impactEnu);
    };
    this.presenters.push(p);
    this.hud.show(cached.flight);
    if (camera === 'follow') this.director.follow(p);
    else this.director.setMode(camera);
    return true;
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
    // P-VIVO.2 — la ráfaga dispara a su cadencia mientras el botón siga
    // pulsado (el reloj arranca cuando el corredor está muestreado).
    if (this.burst?.ready) {
      const b = this.burst;
      b.clock += dt;
      while (this.burst === b && shotTimeS(b.shotIndex, b.rpm) <= b.clock) {
        this.fireBurstShot(b.shotIndex);
        b.shotIndex++;
      }
    }

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
    this.preview.showErrorEllipse(null); // P-PRO.6
  }
}
