// ============================================================================
//  main.ts — Ensamblaje de la aplicación (raíz de composición).
//
//  Globo Cesium + overlay Three + servicio balístico (core TS validado) +
//  pieza de artillería + cámaras + estación de tiro V2 (barra superior, dock
//  de misión de fuego, dock de datos, telemetría, HUD de artillero). El
//  bucle: la física de un tiro se resuelve UNA vez (async, muestreando el
//  terreno) y los presentadores solo reproducen; cada frame actualiza
//  presentadores, VFX y cámara; la interfaz se refresca a ≤ 4 Hz.
// ============================================================================
import * as Cesium from 'cesium';
import { createViewer, GoogleTiles } from './viewer';
import { BallisticsService } from './BallisticsService';
import { ThreeOverlay } from './render/ThreeOverlay';
import { maybeAttachBloom } from './render/PostFX';
import { VfxManager, puffPoolStats } from './vfx/effects';
import { AudioBoom } from './vfx/AudioBoom';
import { CraterLayer } from './vfx/CraterLayer';
import { TrajectoryPreview } from './TrajectoryPreview';
import { CameraDirector } from './CameraDirector';
import type { CameraMode } from './CameraDirector';
import { GunModel } from './GunModel';
import { ArtilleryPiece } from './ArtilleryPiece';
import { MovingTargetActor } from './MovingTarget';
import { BuildingHit } from './BuildingHit';
import { ControlPanel, PickMode } from './ui/ControlPanel';
import { Challenge } from './ui/Challenge';
import { ForwardObserver } from './ui/ForwardObserver';
import { Cockpit } from './ui/Cockpit';
import { FiringTablePanel } from './ui/FiringTablePanel';
import { GunnerHud } from './ui/GunnerHud';
import { WeatherPanel } from './ui/Weather';
import { HUD } from './ui/HUD';
import { Tutorial } from './ui/Tutorial';
import { installPanelTabs } from './ui/panelTabs';
import { toast } from './ui/toast';
import { ShareState, decodeState, encodeState } from './ui/shareState';
import { installTooltips } from './ui/components';
import { installLayout, isNarrow } from './ui/layout';
import { Splash } from './ui/Splash';
import { TopBar } from './ui/TopBar';
import { RightDock } from './ui/RightDock';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { CameraSwitcher, UiCameraMode } from './ui/CameraSwitcher';
import { SettingsModal } from './ui/SettingsModal';
import { HelpModal } from './ui/HelpModal';
import { installShortcuts } from './ui/Shortcuts';
import { missionStatus } from './ui/missionStatus';
import { settings } from './ui/settings';
import { h } from './ui/dom';
import { layStepDeg, fmtAngle } from './ui/units';
import { WEAPON_INFO } from './ui/weaponInfo';
import { Vec3 } from './ballistics';
import type { FlightResult, WeaponId } from './ballistics';
import type { RangeRing } from './BallisticsService';

const splash = new Splash();

async function boot(): Promise<void> {
  installTooltips();
  installLayout();

  splash.step('globe');
  const viewer = await createViewer('cesiumContainer');
  splash.step('battery');
  const service = new BallisticsService(viewer);
  await service.setBattery(-3.9, 40.75); // Sierra de Guadarrama
  splash.step('core');

  const overlay = new ThreeOverlay(viewer, service.frame);
  maybeAttachBloom(overlay);
  const vfx = new VfxManager(overlay.enuRoot, (pos) => service.atmo.windAt(pos, 0));
  const audio = new AudioBoom();
  // P-VIVO.1 — el pan estéreo gira con la cámara: heading real de Cesium.
  audio.headingProvider = () => Cesium.Math.toDegrees(viewer.camera.heading);
  const craters = new CraterLayer(overlay.enuRoot); // P-NEXT.7
  const preview = new TrajectoryPreview(viewer, () => service.frame);
  const director = new CameraDirector(viewer, service);
  splash.step('scene');
  const hud = new HUD();

  let piece: ArtilleryPiece;
  let gun: GunModel;
  /** Barra superior: se crea cuando ya existen pieza y meteo (lee de ellas). */
  let topBar: TopBar | null = null;

  // P-NEXT.3 — edificios 3D fotorrealistas (opcional, solo visual).
  const googleTiles = new GoogleTiles(viewer, (msg) => toast(msg, { level: 'warn' }));
  let googleOn = false;
  let nightOn = false;

  // P-VIVO.11 — el tutorial se crea al final (necesita los anclajes del DOM);
  // los callbacks lo notifican con optional chaining mientras tanto.
  let tutorial: Tutorial | null = null;

  // ---------------------------------------------------------------------------
  //  Dock de datos (derecha) — antes que el panel: aloja meteo/tabla/retos.
  // ---------------------------------------------------------------------------
  const rightDock = new RightDock();

  const panel = new ControlPanel({
    onAimChanged: () => {
      piece.schedulePreview();
      tutorial?.notify('aim-changed');
    },
    onWeaponChanged: () => {
      service.roundIndex = 0; // P-PRO.4 — arma nueva, munición estándar
      gun.setWeapon(panel.weapon()); // P-PRO.1 — nueva silueta (dispose limpio)
      piece.clearTarget();
      piece.schedulePreview(0);
      firingTable.notifyChanged();
      refreshRing(); // el minimapa del artillero escala con el arma
      challenge.cancel(); // P-PRO.7 — arma nueva, reto viejo fuera
      fo.cancel(); // P-VIVO.6 — ídem para el reto FO
      tutorial?.notify('weapon-changed');
      toast(`${WEAPON_INFO[panel.weaponId].name} en posición`, { level: 'info' });
    },
    onRoundChanged: (index) => {
      service.roundIndex = index; // P-PRO.4 — el worker integra ESTA munición
      reaimOrPreview();
      firingTable.notifyChanged();
      refreshRing();
    },
    onChargeChanged: () => {
      reaimOrPreview();
      firingTable.notifyChanged();
      refreshRing();
    },
    onAmmoChanged: () => reaimOrPreview(250),
    onBranchChanged: () => {
      firingTable.onBranchChanged();
      reaimOrPreview();
    },
    onFire: () => void piece.fire(),
    // P-VIVO.2 — ráfaga automática: mantener/soltar FUEGO.
    onBurstStart: () => piece.startBurst(),
    onBurstEnd: () => piece.endBurst(),
    onMRSI: (n) => void piece.fireMRSI(n),
    onCompare: () => {
      void piece.compare();
      rightDock.open('analysis');
    },
    onDisperse: (n) => {
      void piece.fireDispersedSalvo(n);
      tutorial?.notify('salvo-fired');
    },
    onClearCraters: () => {
      craters.clear();
      toast('Cráteres limpiados', { level: 'success' });
    },
    onPickMode: (mode) => setPickMode(mode),
    onClearTarget: () => {
      piece.clearTarget();
      piece.schedulePreview(0);
    },
    onToggleArc: (visible) => {
      preview.setArcVisible(visible);
      if (visible) piece.schedulePreview(0); // re-pinta el arco al volver
    },
  });

  /** Con objetivo designado, un cambio de munición/carga/rama re-resuelve. */
  function reaimOrPreview(delay = 0): void {
    if (piece.targetEnu && !challenge.active && !fo.active) void piece.aimAt(piece.targetEnu);
    else piece.schedulePreview(delay);
  }

  // P-VIVO.8 — día/noche en vivo. La medianoche SOLAR local es 00:00 - lon/15
  // en UTC (aproximación de tiempo solar medio: de sobra para que sea noche
  // cerrada). Al volver al día se restaura el instante que hubiera.
  let dayTime: Cesium.JulianDate | null = null;
  function applyNight(active: boolean, quiet = false): void {
    if (active === nightOn) return;
    nightOn = active;
    const scene = viewer.scene;
    if (active) {
      dayTime = viewer.clock.currentTime.clone();
      const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      const midnightUtcH = (((24 - service.frame.lonDeg / 15) % 24) + 24) % 24;
      const d = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
        Math.floor(midnightUtcH), Math.round((midnightUtcH % 1) * 60), 0,
      ));
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
      scene.globe.enableLighting = true;
      if (scene.moon) scene.moon.show = true;
      // Exposición ligeramente arriba: que la noche se lea, no que ciegue.
      scene.globe.atmosphereBrightnessShift = 0.15;
      if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = 0.15;
      if (!quiet) {
        toast(new URLSearchParams(window.location.search).get('bloom') !== '1'
          ? 'Noche cerrada sobre la batería — prueba ?bloom=1 para fogonazos con resplandor'
          : 'Noche cerrada sobre la batería', { title: 'Noche' });
      }
    } else {
      if (dayTime) viewer.clock.currentTime = dayTime;
      if (scene.moon) scene.moon.show = false;
      scene.globe.atmosphereBrightnessShift = 0.0;
      if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = 0.0;
      if (!quiet) toast('Día restaurado', { level: 'info' });
    }
    topBar?.refresh(true);
  }

  // Los edificios 3D NUNCA entran solos: siempre a golpe de toggle (cuota).

  // P-NEXT.3 fix — encender/apagar los edificios cambia el SUELO VISUAL (el
  // terreno de Google viene horneado en las teselas y no coincide con el
  // terrainProvider): hay que re-anclar la batería a la cota nueva o el
  // cañón y todo lo ENU quedan enterrados/flotando y "resbalan" por paralaje.
  async function applyGoogleTiles(active: boolean): Promise<void> {
    const on = await googleTiles.setEnabled(active);
    googleOn = on;
    service.setTilesetGround(on ? googleTiles.groundTileset : null);
    const hBefore = service.frame.heightM;
    await reanchorBattery(service.frame.lonDeg, service.frame.latDeg);
    // Si la cota cambió de verdad (Google vs proveedor), la cámara estaba
    // referida al suelo antiguo: recolócala sobre la batería nueva.
    if (Math.abs(service.frame.heightM - hBefore) > 20) flyToBattery(true);
    if (active && on) toast('Edificios 3D activos: los tiros tensos se detienen en las fachadas', { level: 'success' });
  }

  /** Re-ancla el marco ENU en (lon, lat) y refresca todo lo que depende de él. */
  async function reanchorBattery(lonDeg: number, latDeg: number): Promise<void> {
    // TODO lo que vive en coordenadas del marco VIEJO se desmonta antes de
    // reorientar el grupo ENU: proyectiles en vuelo, VFX persistentes
    // (cortinas de humo, bengalas), cráteres e impactos del minimapa
    // aparecerían teletransportados alrededor del ancla nueva.
    piece.disposeAllFlights();
    vfx.dispose();
    craters.clear();
    gunnerHud.clearImpacts();
    await service.setBattery(lonDeg, latDeg);
    overlay.setFrame(service.frame);
    preview.clearAll();
    piece.clearTarget();
    piece.schedulePreview(0);
    firingTable.notifyChanged(); // la latitud (Coriolis) cambia la tabla
    refreshRing();
    gunnerHud.invalidateMap(); // teselas del minimapa de la posición nueva
    challenge.cancel(); // la diana era de la posición/cota anterior
    fo.cancel(); // P-VIVO.6 — el OP también era del relieve anterior
    topBar?.refresh(true);
  }

  // P-PRO.1 — la pieza por fin se VE: modelo procedural que apunta en vivo.
  gun = new GunModel(overlay.enuRoot, panel.weapon());
  piece = new ArtilleryPiece(
    service, overlay, vfx, audio, preview, director, panel, hud, craters, gun,
  );
  // P-VIVO.5 — con los edificios 3D activos, la cola de cada vuelo se
  // pre-muestrea contra el suelo visual y la reproducción se recorta en la
  // fachada (la física no se toca; sin tileset no hace nada).
  piece.buildingHit = new BuildingHit(viewer, service, () => !!googleTiles.groundTileset);

  // ---------------------------------------------------------------------------
  //  Pestañas del dock derecho.
  // ---------------------------------------------------------------------------
  const weather = new WeatherPanel(service, rightDock.panels.met, () => panel.azimuthDeg);
  // P-PRO.5 — tabla de tiro interactiva (arma/carga/meteo actuales).
  const firingTable = new FiringTablePanel(service, panel, () => piece.schedulePreview(0), rightDock.panels.table);
  const analysis = new AnalysisPanel(rightDock.panels.analysis);
  piece.onShotReport = (r) => analysis.setShot(r);
  piece.onSalvoReport = (r) => analysis.setSalvo(r);
  piece.onPrediction = (r) => analysis.setPrediction(r);
  piece.onCompareReport = (r) => analysis.setCompare(r);
  rightDock.onTabChanged = (tab, visible) => {
    firingTable.setVisible(visible && tab === 'table' && (!isNarrow() || document.getElementById('rightDock')!.classList.contains('sheet-open')));
  };
  // Instrucción: cabecera + anfitrión de las tarjetas de misión.
  const trainingHost = h('div', { class: 'rpanel-body mcards', id: 'instructionHost' });
  rightDock.panels.training.append(
    RightDock.header('Instrucción'),
    h('p', { class: 'rpanel-intro', text: 'Misiones puntuadas con récord por arma. Durante un reto la designación automática se bloquea: la puntería es tuya.' }),
    trainingHost,
  );

  // HUD de artillero (cámara Artillero): compás, goniómetro, retícula y
  // minimapa de dron. Estado ligero alimentado por los hooks de preview.
  let lastPreview: FlightResult | null = null;
  let lastRing: RangeRing | null = null;
  let ringToken = 0; // gana el último PEDIDO, no el último en resolver
  const refreshRing = () => {
    const token = ++ringToken;
    void service
      .approxMaxRange(panel.weaponId, panel.chargeIndex)
      .then((r) => { if (token === ringToken) lastRing = r; })
      .catch(() => { if (token === ringToken) lastRing = null; });
  };
  refreshRing();
  const gunnerHud = new GunnerHud({
    aim: () => {
      const w = panel.weapon();
      return {
        azimuthDeg: panel.azimuthDeg,
        elevationDeg: panel.elevationDeg,
        minElevationDeg: w.minElevationDeg,
        maxElevationDeg: w.maxElevationDeg,
      };
    },
    weaponLabel: () => WEAPON_INFO[panel.weaponId].designation,
    battery: () => ({ latDeg: service.frame.latDeg, lonDeg: service.frame.lonDeg }),
    targetEnu: () => piece.targetEnu,
    // P-VIVO.6 — en el reto FO el impacto previsto es un chivato: oculto.
    previewImpactEnu: () => (fo.active ? null : lastPreview?.impactPoint ?? null),
    solutionText: () =>
      lastPreview
        ? `${(lastPreview.downrange / 1000).toFixed(2)} km · TOF ${lastPreview.timeOfFlight.toFixed(1)} s`
        : '',
    ring: () => lastRing,
    // P-VIVO.7 — el camión con su vector de velocidad en el minimapa.
    movingTarget: () => {
      if (!movingActor) return null;
      const p = movingActor.positionEnu();
      const v = movingActor.velocity2D();
      return { x: p.x, y: p.y, vx: v.x, vy: v.y };
    },
  });

  piece.onPreview = (fr) => {
    firingTable.setPreviewRange(fr.downrange);
    lastPreview = fr;
  };

  weather.onChange = () => {
    reaimOrPreview(250);
    firingTable.notifyChanged();
    refreshRing(); // la meteo cambia el alcance máximo (anillos/minimapa)
    topBar?.refresh();
  };

  // P-VIVO.7 — blanco móvil: el actor vive aquí (Three + muestreo de camino).
  let movingActor: MovingTargetActor | null = null;

  // P-PRO.7 — modo instrucción: reto de puntería puntuado.
  const challenge = new Challenge(service, panel, {
    marker: (enu) => preview.showChallengeTarget(enu),
    lockPick: (locked) => {
      if (locked) setPickMode('none'); // por si designar estaba armado
      panel.setPickEnabled(!locked);
    },
    schedulePreview: () => piece.schedulePreview(0),
    onStart: () => {
      fo.cancel(); // P-VIVO.6 — un reto a la vez
      piece.clearTarget(); // el objetivo libre no pinta encima de la diana
      tutorial?.notify('challenge-opened');
    },
    // P-VIVO.7 — ciclo de vida del camión.
    spawnMoving: (startEnu, headingDeg, speedMS, ring) => {
      movingActor?.dispose();
      movingActor = new MovingTargetActor(
        overlay.enuRoot, service, { x: startEnu.x, y: startEnu.y }, headingDeg, speedMS,
        ring, Math.random,
      );
    },
    clearMoving: () => {
      movingActor?.dispose();
      movingActor = null;
    },
    movingPosition: () => movingActor?.positionEnu() ?? null,
  }, trainingHost);

  // P-VIVO.6 — reto de Observador Avanzado: corriges desde un OP real.
  const fo = new ForwardObserver(service, panel, {
    marker: (enu) => preview.showChallengeTarget(enu),
    lockPick: (locked) => {
      if (locked) setPickMode('none');
      panel.setPickEnabled(!locked);
    },
    schedulePreview: () => piece.schedulePreview(0),
    setArc: (visible) => panel.setArcChecked(visible),
    enterOpCamera: (posEnu, lookAz) => {
      director.enterOp(posEnu, lookAz);
      cameraSwitcher.mark('op'); // ningún botón de cámara representa el OP
      toast('En el puesto de observación: arrastra para mirar · rueda = prismáticos', { title: 'Observador' });
    },
    exitOpCamera: () => {
      director.setMode('free');
      cameraSwitcher.mark('free');
      flyToBattery(true);
    },
    onStart: () => {
      challenge.cancel();
      piece.clearTarget(); // sin objetivo viejo: ni marcador ni elipse PER
      tutorial?.notify('challenge-opened');
    },
  }, trainingHost);

  piece.onAnyImpact = (enu) => {
    challenge.notifyImpact(enu);
    fo.notifyImpact(enu); // P-VIVO.6 — cuenta rondas y puntúa el reto FO
    gunnerHud.addImpact(enu); // punto en el minimapa del artillero
    tutorial?.notify('impact'); // P-VIVO.11 — paso 3: FUEGO e impacto
  };

  // P-NEXT.1 — instrumentos de puntería fina (paso 4) + cámara de cabina.
  const cockpit = new Cockpit(panel, () => piece.schedulePreview(), panel.instrumentsHost, () =>
    piece.targetEnu ? ControlPanel.bearingOf(piece.targetEnu.x, piece.targetEnu.y) : null,
  );
  director.aimProvider = () => ({
    azimuthDeg: panel.azimuthDeg,
    elevationDeg: panel.elevationDeg,
  });
  director.muzzleProvider = () => gun.muzzleWorldEnu(); // cabina pegada al tubo

  // ---------------------------------------------------------------------------
  //  Cámaras: selector flotante + toasts de ayuda (seguir / 1ª persona).
  // ---------------------------------------------------------------------------
  const fovGet = (): number => {
    const f = viewer.camera.frustum;
    return f instanceof Cesium.PerspectiveFrustum && f.fov ? Cesium.Math.toDegrees(f.fov) : 60;
  };
  // El overlay Three copia la proyección de Cesium cada frame: basta con el
  // frustum del globo.
  const fovSet = (deg: number): void => {
    const f = viewer.camera.frustum;
    if (f instanceof Cesium.PerspectiveFrustum) f.fov = Cesium.Math.toRadians(deg);
  };
  function setCameraMode(mode: UiCameraMode): void {
    if (mode === 'follow') {
      if (!piece.followLatest()) {
        toast('No hay proyectil que seguir todavía — dispara primero', { level: 'warn' });
        cameraSwitcher.mark(director.mode === 'follow' ? 'free' : director.mode);
        return;
      }
      cameraSwitcher.mark('follow');
      toast('Seguir: arrastra para orbitar · rueda para zoom', { level: 'info' });
      return;
    }
    director.setMode(mode);
    cameraSwitcher.mark(mode);
    if (mode === 'fps') {
      toast('1ª persona: clic en el globo para capturar el ratón · WASD mover · Espacio/C subir/bajar · Shift esprintar · rueda velocidad · Esc suelta', { level: 'info', ms: 7000 });
    }
    if (mode === 'orbital') director.setFocus(new Vec3(0, 0, 60));
    if (mode === 'free') flyToBattery(false);
  }
  const cameraSwitcher = new CameraSwitcher(setCameraMode, { get: fovGet, set: fovSet });

  // ---------------------------------------------------------------------------
  //  Selección en el globo — encapsulada tras setPickMode(mode): cuando el
  //  agente MAP integre src/map/MapInteraction, esta función delega en
  //  mapInteraction.setPickMode() y el manejador de clic desaparece.
  // ---------------------------------------------------------------------------
  let pickMode: PickMode = 'none';
  function setPickMode(mode: PickMode): void {
    if (mode === 'target' && !panel.pickAllowed) {
      toast('Designación bloqueada durante el reto: apunta a mano', { level: 'warn' });
      mode = 'none';
    }
    if (mode === pickMode) {
      panel.reflectPickMode(mode);
      return;
    }
    pickMode = mode;
    panel.reflectPickMode(mode);
    missionStatus.setAiming(mode !== 'none');
    viewer.scene.canvas.style.cursor = mode === 'none' ? '' : 'crosshair';
    document.body.classList.toggle('is-picking', mode !== 'none');
  }

  const pickEcef = (windowPos: Cesium.Cartesian2): Cesium.Cartesian3 | undefined => {
    const scene = viewer.scene;
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(windowPos);
      if (Cesium.defined(p)) return p;
    }
    const ray = viewer.camera.getPickRay(windowPos);
    return ray ? scene.globe.pick(ray, scene) : undefined;
  };

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (pickMode === 'none') return;
    const ecef = pickEcef(ev.position);
    if (!ecef) {
      toast('Ahí no hay terreno que designar', { level: 'warn' });
      return;
    }
    if (pickMode === 'target') {
      setPickMode('none');
      void piece.aimAt(service.frame.ecefToEnu(ecef));
      tutorial?.notify('target-marked'); // P-VIVO.11 — paso 4
    } else if (pickMode === 'battery') {
      setPickMode('none');
      const carto = Cesium.Cartographic.fromCartesian(ecef);
      void (async () => {
        await reanchorBattery(
          Cesium.Math.toDegrees(carto.longitude),
          Cesium.Math.toDegrees(carto.latitude),
        );
        weather.onBatteryMoved(); // P-PRO.2 — re-consulta si la meteo real manda
        flyToBattery(true);
        toast(`Batería desplegada en ${fmtAngle(Cesium.Math.toDegrees(carto.latitude), 'deg', 3)} N`, { level: 'success' });
      })();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------------------------------------------------------------------------
  //  P-VIVO.10 — compartir por URL (#s=…) + sesión persistida.
  // ---------------------------------------------------------------------------
  const SESSION_KEY = 'unai-artillery/session/v1';
  let sessionAutosave = true;

  function collectState(): ShareState {
    const wx = weather.getState();
    return {
      v: 1,
      bat: { lat: service.frame.latDeg, lon: service.frame.lonDeg },
      w: panel.weaponId,
      ri: panel.roundIndex,
      ci: panel.chargeIndex,
      az: panel.azimuthDeg,
      el: panel.elevationDeg,
      high: panel.preferHighAngle || undefined,
      tgt: piece.targetEnu ? { e: piece.targetEnu.x, n: piece.targetEnu.y } : undefined,
      wx: wx.real
        ? { real: true }
        : { real: false, ws: wx.ws, wb: wx.wb, t: wx.t, p: wx.p },
      tog: { b: googleOn, arc: panel.arcChecked, night: nightOn },
    };
  }

  /** Restaura en el ORDEN correcto: batería → arma/munición/carga → meteo →
   *  toggles → puntería → objetivo (con su solve). */
  async function restoreState(s: ShareState): Promise<void> {
    await reanchorBattery(s.bat.lon, s.bat.lat);
    flyToBattery(true);

    panel.applyShared(s.w as WeaponId, s.ri, s.ci);
    service.roundIndex = panel.roundIndex;
    gun.setWeapon(panel.weapon());
    firingTable.notifyChanged();
    refreshRing();

    if (s.wx) {
      if (s.wx.real) {
        await weather.applyReal().catch(() => toast('Sin meteo real — sigo en manual', { level: 'warn' }));
      } else {
        weather.applyManual(s.wx.ws ?? 0, s.wx.wb ?? 270, s.wx.t ?? 15, s.wx.p ?? 1013.25);
      }
    }

    if (s.tog) {
      if (s.tog.night !== undefined && s.tog.night !== nightOn) applyNight(s.tog.night, true);
      if (s.tog.arc !== undefined) panel.setArcChecked(s.tog.arc);
      if (s.tog.b) await applyGoogleTiles(true);
    }

    panel.setHighAngle(s.high === true);
    panel.setAim(s.az, s.el);

    if (s.tgt) {
      // Altura real del suelo bajo el objetivo, y su solución de tiro.
      const profile = await service.sampleLineProfile(
        new Vec3(0, 0, 0), new Vec3(s.tgt.e, s.tgt.n, 0), 200,
      );
      const z = profile.length ? profile[profile.length - 1] : 0;
      await piece.aimAt(new Vec3(s.tgt.e, s.tgt.n, z));
    } else {
      piece.schedulePreview(0);
    }
  }

  /** Quita el #s=… de la barra sin recargar (el hash clavado haría que
   *  cualquier F5 posterior revirtiera al escenario del enlace). */
  function clearShareHash(): void {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function shareScenario(): void {
    try {
      const enc = encodeState(collectState());
      const hash = `#s=${enc}`;
      history.replaceState(null, '', hash);
      const url = window.location.href;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => {
            toast('Enlace copiado: el escenario completo viaja en la URL', { level: 'success', title: 'Compartir' });
            clearShareHash(); // ya está en el portapapeles: que F5 siga tu sesión
          },
          () => toast('Enlace listo en la barra de direcciones — cópialo', { level: 'info', title: 'Compartir' }),
        );
      } else {
        toast('Enlace listo en la barra de direcciones — cópialo', { level: 'info', title: 'Compartir' });
      }
    } catch (err) {
      console.error('[share]', err);
      toast('No se pudo generar el enlace', { level: 'error' });
    }
  }

  function resetSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // sin almacenamiento
    }
    settings.reset(); // preferencias de interfaz de fábrica
    sessionAutosave = false; // que no se re-guarde sola tras el borrado
    clearShareHash(); // si no, el hash restauraría el escenario igualmente
    toast('Sesión borrada — recarga para arrancar de fábrica', { level: 'success' });
  }

  // Autosave: cada 5 s, si el estado cambió, la sesión completa va a
  // localStorage con el MISMO encoder que el enlace compartible.
  let lastSavedSession = '';
  window.setInterval(() => {
    if (!sessionAutosave) return;
    try {
      const enc = encodeState(collectState());
      if (enc !== lastSavedSession) {
        localStorage.setItem(SESSION_KEY, enc);
        lastSavedSession = enc;
      }
    } catch {
      // sin almacenamiento: la app sigue
    }
  }, 5000);

  // -- Cámara inicial ----------------------------------------------------------
  // V2 — plano "de batería": por detrás y a la izquierda de la pieza, mirando
  // a lo largo del azimut de tiro (la pieza en primer término y el arco
  // saliendo hacia el objetivo). Se eleva si el relieve taparía la cámara.
  function flyToBattery(fast: boolean): void {
    const f = service.frame;
    const az = (panel.azimuthDeg * Math.PI) / 180;
    const fx = Math.sin(az);
    const fy = Math.cos(az);
    const rx = Math.cos(az);
    const ry = -Math.sin(az);
    const pos = new Vec3(-980 * fx - 420 * rx, -980 * fy - 420 * ry, 520);
    const look = new Vec3(900 * fx, 900 * fy, 0);
    const fly = (p: Vec3) => {
      const d = new Vec3(look.x - p.x, look.y - p.y, look.z - p.z);
      const dl = Math.hypot(d.x, d.y, d.z) || 1;
      const dir = new Vec3(d.x / dl, d.y / dl, d.z / dl);
      // up = (dir × Z) × dir, normalizado.
      const cx = dir.y;
      const cy = -dir.x;
      const up = new Vec3(cy * dir.z, -cx * dir.z, cx * dir.y - cy * dir.x);
      const ul = Math.hypot(up.x, up.y, up.z) || 1;
      viewer.camera.flyTo({
        destination: f.enuToEcef(p),
        orientation: {
          direction: Cesium.Cartesian3.normalize(f.enuVectorToEcef(dir), new Cesium.Cartesian3()),
          up: Cesium.Cartesian3.normalize(
            f.enuVectorToEcef(new Vec3(up.x / ul, up.y / ul, up.z / ul)), new Cesium.Cartesian3(),
          ),
        },
        duration: fast ? 1.2 : 2.8,
      });
    };
    fly(pos);
    // El relieve entre la cámara y la pieza no debe tapar el plano: se
    // muestrea (async) y, si hace falta, la cámara se eleva por encima.
    const probes = [0.0, 0.25, 0.5, 0.75].map((k) => new Vec3(pos.x * (1 - k), pos.y * (1 - k), 0));
    service.terrainZRelative(probes).then(
      (zs) => {
        const top = Math.max(0, ...zs.filter((z) => Number.isFinite(z)));
        if (top + 120 > pos.z) fly(new Vec3(pos.x, pos.y, top + 120));
      },
      () => { /* sin muestras: se queda la pose por defecto */ },
    );
  }
  flyToBattery(false);

  // ---------------------------------------------------------------------------
  //  Barra superior, ajustes, ayuda y atajos.
  // ---------------------------------------------------------------------------
  splash.step('ui');
  const setVolume = (v: number) => { audio.setVolume(v); topBar?.reflectAudio(); };
  const setMuted = (m: boolean) => { audio.setMuted(m); topBar?.reflectAudio(); };
  topBar = new TopBar({
    battery: () => ({ latDeg: service.frame.latDeg, lonDeg: service.frame.lonDeg, heightM: service.frame.heightM }),
    target: () => (piece.targetEnu
      ? { rangeM: Math.hypot(piece.targetEnu.x, piece.targetEnu.y), bearingDeg: ControlPanel.bearingOf(piece.targetEnu.x, piece.targetEnu.y) }
      : null),
    met: () => weather.summary(),
    sceneDate: () => Cesium.JulianDate.toDate(viewer.clock.currentTime),
    night: () => nightOn,
    audio: () => ({ volume: audio.volume, muted: audio.muted }),
    toggleNight: () => applyNight(!nightOn),
    setVolume,
    setMuted,
    openSettings: () => settingsModal.open(),
    openHelp: () => helpModal.open(),
    openMet: () => {
      rightDock.open('met');
      panelTabs.open('met');
    },
  });
  piece.onTargetChanged = () => topBar?.refresh();

  const settingsModal = new SettingsModal({
    arc: () => panel.arcChecked,
    setArc: (on) => panel.setArcChecked(on),
    google: () => googleOn,
    googleAvailable: () => GoogleTiles.available(),
    setGoogle: (on) => void applyGoogleTiles(on),
    night: () => nightOn,
    setNight: (on) => applyNight(on),
    audio: () => ({ volume: audio.volume, muted: audio.muted }),
    setVolume,
    setMuted,
    fov: fovGet,
    setFov: fovSet,
    share: () => shareScenario(),
    resetSession: () => resetSession(),
    restartTutorial: () => tutorial?.start(),
  });
  const helpModal = new HelpModal(() => tutorial?.start());

  installShortcuts({
    fire: (down) => panel.triggerFire(down),
    toggleBranch: () => panel.toggleHighAngle(),
    nudge: (dAz, dEl, mods) => {
      const step = layStepDeg(settings.angleUnit, mods, 'key');
      panel.nudge(dAz * step, dEl * step);
    },
    help: () => helpModal.open('keys'),
    escape: () => {
      if (pickMode !== 'none') setPickMode('none');
      else if (tutorial?.isActive) tutorial.finish();
    },
    pickTarget: () => setPickMode(pickMode === 'target' ? 'none' : 'target'),
    moveBattery: () => setPickMode(pickMode === 'battery' ? 'none' : 'battery'),
    flyHome: () => flyToBattery(true),
    camera: (i) => {
      const modes: UiCameraMode[] = ['free', 'orbital', 'follow', 'drone', 'cabin', 'fps'];
      const m = modes[i - 1];
      if (m) setCameraMode(m);
    },
    fpsLocked: () => director.mode === 'fps' && document.pointerLockElement === viewer.scene.canvas,
  }, { mapKeys: true });

  // P-PRO.8 — overlay de depuración de rendimiento (?stats=1): draw calls,
  // memoria de geometrías/texturas y sprites vivos del pool. Sin dependencias.
  let statsEl: HTMLDivElement | null = null;
  let statsAcc = 0;
  if (new URLSearchParams(window.location.search).get('stats') === '1') {
    statsEl = document.createElement('div');
    statsEl.id = 'statsOverlay';
    document.body.appendChild(statsEl);
  }

  // -- Bucle -------------------------------------------------------------------
  let last = performance.now();
  let uiAcc = 0;
  viewer.clock.onTick.addEventListener(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    piece.update(dt);
    gun.update(dt, panel.azimuthDeg, panel.elevationDeg); // P-PRO.1 — apunta en vivo
    // P-VIVO.7 — el camión avanza pegado al relieve; el fantasma de adelanto
    // se extrapola al TOF del preview vigente (si la ayuda está activada).
    if (movingActor) {
      movingActor.setGhostTof(
        challenge.ghostEnabled && lastPreview ? lastPreview.timeOfFlight : null,
      );
      movingActor.update(dt);
    }
    const cabin = director.mode === 'cabin';
    gunnerHud.setVisible(cabin);
    document.body.classList.toggle('cam-cabin', cabin);
    gunnerHud.render(dt);
    vfx.update(dt, overlay.cameraEnu());
    director.update(dt);
    cockpit.render(); // solo repinta si la puntería cambió
    // Interfaz a ≤ 4 Hz (solo escribe lo que cambia).
    if ((uiAcc += dt) > 0.25) {
      uiAcc = 0;
      topBar?.refresh();
      weather.render();
      if (director.mode !== 'op' && director.mode !== 'follow') cameraSwitcher.mark(director.mode);
    }
    if (statsEl && (statsAcc += dt) > 0.25) {
      statsAcc = 0;
      const info = overlay.renderer.info;
      const pool = puffPoolStats();
      statsEl.textContent =
        `three ${info.render.calls} calls · ${info.render.triangles} tris · ` +
        `geo ${info.memory.geometries} · tex ${info.memory.textures} · ` +
        `sprites ${pool.live} vivos / pool ${pool.created} (${pool.free} libres) · ` +
        `cráteres ${craters.count}`;
    }
  });
  viewer.scene.postRender.addEventListener(() => overlay.render());

  // P-VIVO.11 — hojas inferiores en pantallas estrechas + tutorial guiado.
  const panelTabs = installPanelTabs(rightDock, panel);
  const TUTORIAL_ANCHORS = [
    'weaponSelect', 'cockpit', 'fireBtn', 'pickTargetBtn', 'disperseBtn', 'tab-training',
  ];
  tutorial = new Tutorial((step) => {
    let el = document.getElementById(TUTORIAL_ANCHORS[step] ?? '');
    if (!el) return null;
    // En móvil el ancla puede vivir en una hoja plegada (display:none →
    // rect 0×0): se abre antes de resaltar.
    if (isNarrow()) {
      if (step === 5) {
        el = document.querySelector<HTMLElement>('[data-testid="sheet-training"]') ?? el;
      } else if (el.offsetParent === null || !document.getElementById('leftDock')!.classList.contains('sheet-open')) {
        if (el.closest('#leftDock')) panelTabs.open('mission');
      }
    } else if (el.closest('#leftDock') && settings.get().leftCollapsed) {
      settings.set({ leftCollapsed: false });
    }
    // El paso 4 (instrumentos) puede estar plegado: el ancla es el pliegue.
    if (el.offsetParent === null) {
      el = el.closest<HTMLElement>('.ua-collapse')?.querySelector<HTMLElement>('.ua-collapse__head') ?? el;
    }
    return el;
  });
  tutorial.onFinish = (completed) => {
    if (completed) toast('Tutorial completado. La ayuda (?) tiene atajos y glosario.', { level: 'success' });
  };

  // P-VIVO.10 — repetición del último vuelo desde la telemetría.
  hud.onReplay = (camera, slow) => {
    if (piece.replayLast(camera, slow)) {
      cameraSwitcher.mark(camera as CameraMode);
      toast(`Repitiendo el último vuelo${slow ? ' a ×0.25' : ''}`, { level: 'info' });
    } else {
      toast('Aún no hay vuelo que repetir — dispara primero', { level: 'warn' });
    }
  };

  // P-VIVO.10 — arranque: el hash #s=… manda; si no hay, la última sesión.
  splash.step('solution');
  const rawHash = window.location.hash;
  if (rawHash.startsWith('#s=')) {
    try {
      await restoreState(decodeState(rawHash));
      toast('Escenario restaurado del enlace', { level: 'success' });
    } catch (err) {
      console.warn('[share] hash inválido', err);
      toast(`Enlace inválido (${(err as Error).message}) — arranco normal`, { level: 'warn' });
      piece.schedulePreview(400);
    }
    // Consumido (bien o mal): si se quedara clavado, cada F5 posterior
    // revertiría silenciosamente al escenario del enlace en vez de a tu
    // sesión autosalvada.
    clearShareHash();
  } else {
    // Decodificar y restaurar por separado: solo una sesión CORRUPTA se
    // borra; un fallo transitorio al restaurar (red, terreno) la conserva.
    let decoded: ShareState | null = null;
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) decoded = decodeState(saved);
    } catch (err) {
      console.warn('[session] sesión corrupta — borrada', err);
      try { localStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
    }
    let restored = false;
    if (decoded) {
      try {
        await restoreState(decoded);
        restored = true;
      } catch (err) {
        console.warn('[session] fallo restaurando — la sesión guardada se conserva', err);
      }
    }
    if (!restored) piece.schedulePreview(400); // primer arco al arrancar
  }
  topBar.refresh(true);
  rightDock.onTabChanged?.(rightDock.active, rightDock.visible);
  splash.done();

  // V2 — asa de automatización/depuración: las capturas headless
  // (tools/shot.mjs --ready __uaReady) y la consola manejan la app con ella.
  Object.assign(window as unknown as Record<string, unknown>, {
    __ua: {
      Cesium, viewer, service, overlay, piece, gun, panel, director, preview, vfx, craters, weather, hud, audio,
      // V2/UI — controles de la estación para guiones y capturas.
      ui: { topBar, rightDock, analysis, firingTable, cameraSwitcher, settingsModal, helpModal, tutorial, challenge, fo, gunnerHud, settings },
      setPickMode, setCameraMode, applyNight, flyToBattery,
    },
    __uaReady: true,
  });
  console.log('[UnaiArtillery] listo — física validada, globo real, fuego a discreción');
}

boot().catch((err) => {
  console.error('[UnaiArtillery] fallo de arranque', err);
  splash.fail(`Fallo de arranque: ${(err as Error)?.message ?? err}. Revisa la consola y la conexión.`);
  toast('Fallo de arranque — mira la consola', { level: 'error' });
});
