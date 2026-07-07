// ============================================================================
//  main.ts — Ensamblaje de la aplicación.
//
//  Globo Cesium + overlay Three + servicio balístico (core TS validado) +
//  pieza de artillería + cámaras + HUD/meteo. El bucle: la física de un tiro
//  se resuelve UNA vez (async, muestreando el terreno) y los presentadores
//  solo reproducen; cada frame actualiza presentadores, VFX y cámara.
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
import { GunModel } from './GunModel';
import { ArtilleryPiece } from './ArtilleryPiece';
import { MovingTargetActor } from './MovingTarget';
import { BuildingHit } from './BuildingHit';
import { ControlPanel } from './ui/ControlPanel';
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
import { Vec3 } from './ballistics';
import type { FlightResult, WeaponId } from './ballistics';
import type { RangeRing } from './BallisticsService';

type PickMode = 'none' | 'target' | 'battery';

async function boot(): Promise<void> {
  const viewer = await createViewer('cesiumContainer');
  const service = new BallisticsService(viewer);
  await service.setBattery(-3.9, 40.75); // Sierra de Guadarrama

  const overlay = new ThreeOverlay(viewer, service.frame);
  maybeAttachBloom(overlay);
  const vfx = new VfxManager(overlay.enuRoot, (pos) => service.atmo.windAt(pos, 0));
  const audio = new AudioBoom();
  // P-VIVO.1 — el pan estéreo gira con la cámara: heading real de Cesium.
  audio.headingProvider = () => Cesium.Math.toDegrees(viewer.camera.heading);
  const craters = new CraterLayer(overlay.enuRoot); // P-NEXT.7
  const preview = new TrajectoryPreview(viewer, () => service.frame);
  const director = new CameraDirector(viewer, service);
  const hud = new HUD();

  let pickMode: PickMode = 'none';
  let piece: ArtilleryPiece;
  let gun: GunModel;

  // P-NEXT.3 — edificios 3D fotorrealistas (opcional, solo visual).
  const googleTiles = new GoogleTiles(viewer, (msg) => toast(msg));

  // P-VIVO.11 — el tutorial se crea al final (necesita los anclajes del DOM);
  // los callbacks lo notifican con optional chaining mientras tanto.
  let tutorial: Tutorial | null = null;

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
    },
    onRoundChanged: (index) => {
      service.roundIndex = index; // P-PRO.4 — el worker integra ESTA munición
      piece.schedulePreview(0);
      firingTable.notifyChanged();
      refreshRing();
    },
    onChargeChanged: () => {
      piece.schedulePreview();
      firingTable.notifyChanged();
      refreshRing();
    },
    onFire: () => void piece.fire(),
    // P-VIVO.2 — ráfaga automática: mantener/soltar FUEGO.
    onBurstStart: () => piece.startBurst(),
    onBurstEnd: () => piece.endBurst(),
    onMRSI: (n) => void piece.fireMRSI(n),
    onCompare: () => void piece.compare(),
    onDisperse: (n) => {
      void piece.fireDispersedSalvo(n);
      tutorial?.notify('salvo-fired');
    },
    onClearCraters: () => {
      craters.clear();
      toast('Cráteres limpiados');
    },
    onCameraMode: (mode) => {
      if (mode === 'follow') {
        if (!piece.followLatest()) {
          toast('No hay proyectil que seguir todavía — dispara primero');
          panel.markCamera(director.mode === 'follow' ? 'free' : director.mode);
          return;
        }
        toast('Seguir: arrastra para orbitar · rueda para zoom');
      } else {
        director.setMode(mode);
      }
      if (mode === 'fps') {
        toast('1ª persona: clic en el globo para capturar el ratón · WASD mover · Espacio/C subir/bajar · Shift esprintar · rueda velocidad · Esc suelta');
      }
      if (mode === 'orbital') director.setFocus(new Vec3(0, 0, 60));
      if (mode === 'free') flyToBattery(false);
    },
    onPickTarget: (active) => {
      pickMode = active ? 'target' : 'none';
      if (active) toast('Clic en el globo para marcar el objetivo');
    },
    onMoveBattery: (active) => {
      pickMode = active ? 'battery' : 'none';
      if (active) toast('Clic en el globo para desplegar la batería ahí');
    },
    onGoogleTiles: (active) => void applyGoogleTiles(active),
    onToggleArc: (visible) => {
      preview.setArcVisible(visible);
      if (visible) piece.schedulePreview(0); // re-pinta el arco al volver
    },
    // P-VIVO.1 — control 🔊: AudioBoom posee el estado y lo persiste.
    onVolumeChanged: (v) => audio.setVolume(v),
    onMuteChanged: (m) => audio.setMuted(m),
    // P-VIVO.8 — noche real: medianoche solar local de la batería.
    onNight: (active) => applyNight(active),
    // P-VIVO.10 — compartir el escenario / borrar la sesión persistida.
    onShare: () => shareScenario(),
    onResetSession: () => resetSession(),
  });
  panel.setAudioState(audio.volume, audio.muted);

  // P-VIVO.8 — día/noche en vivo. La medianoche SOLAR local es 00:00 - lon/15
  // en UTC (aproximación de tiempo solar medio: de sobra para que sea noche
  // cerrada). Al volver al día se restaura el instante que hubiera.
  let dayTime: Cesium.JulianDate | null = null;
  function applyNight(active: boolean): void {
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
      if (new URLSearchParams(window.location.search).get('bloom') !== '1') {
        toast('🌙 Noche cerrada — prueba ?bloom=1 para fogonazos gloriosos');
      } else {
        toast('🌙 Noche cerrada sobre la batería');
      }
    } else {
      if (dayTime) viewer.clock.currentTime = dayTime;
      if (scene.moon) scene.moon.show = false;
      scene.globe.atmosphereBrightnessShift = 0.0;
      if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = 0.0;
      toast('☀️ Día restaurado');
    }
  }

  // Los edificios 3D NUNCA entran solos: siempre a golpe de toggle (cuota).

  // P-NEXT.3 fix — encender/apagar los edificios cambia el SUELO VISUAL (el
  // terreno de Google viene horneado en las teselas y no coincide con el
  // terrainProvider): hay que re-anclar la batería a la cota nueva o el
  // cañón y todo lo ENU quedan enterrados/flotando y "resbalan" por paralaje.
  async function applyGoogleTiles(active: boolean): Promise<void> {
    const on = await googleTiles.setEnabled(active);
    panel.setGoogleTiles(on);
    service.setTilesetGround(on ? googleTiles.groundTileset : null);
    const hBefore = service.frame.heightM;
    await reanchorBattery(service.frame.lonDeg, service.frame.latDeg);
    // Si la cota cambió de verdad (Google vs proveedor), la cámara estaba
    // referida al suelo antiguo: recolócala sobre la batería nueva.
    if (Math.abs(service.frame.heightM - hBefore) > 20) flyToBattery(true);
  }

  /** Re-ancla el marco ENU en (lon, lat) y refresca todo lo que depende de él. */
  async function reanchorBattery(lonDeg: number, latDeg: number): Promise<void> {
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
  const weather = new WeatherPanel(service);

  // Barra de FOV (bajo la meteo): el overlay Three copia la proyección de
  // Cesium cada frame, así que basta con tocar el frustum del globo.
  weather.addFovControl(
    () => {
      const f = viewer.camera.frustum;
      return f instanceof Cesium.PerspectiveFrustum && f.fov
        ? Cesium.Math.toDegrees(f.fov)
        : 60;
    },
    (deg) => {
      const f = viewer.camera.frustum;
      if (f instanceof Cesium.PerspectiveFrustum) f.fov = Cesium.Math.toRadians(deg);
    },
  );

  // P-PRO.5 — tabla de tiro interactiva (arma/carga/meteo actuales).
  const firingTable = new FiringTablePanel(service, panel, () => piece.schedulePreview(0));

  // HUD de artillero (modo Cabina): compás, goniómetro, retícula y minimapa
  // de dron. Estado ligero alimentado por los hooks de preview/anillos.
  let lastPreview: FlightResult | null = null;
  let lastRing: RangeRing | null = null;
  const refreshRing = () => {
    void service
      .approxMaxRange(panel.weaponId, panel.chargeIndex)
      .then((r) => { lastRing = r; })
      .catch(() => { lastRing = null; });
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
    weaponLabel: () => panel.weapon().name,
    battery: () => ({ latDeg: service.frame.latDeg, lonDeg: service.frame.lonDeg }),
    targetEnu: () => piece.targetEnu,
    // P-VIVO.6 — en el reto FO el impacto previsto es un chivato: oculto.
    previewImpactEnu: () => (fo.active ? null : lastPreview?.impactPoint ?? null),
    solutionText: () =>
      lastPreview
        ? `→ ${(lastPreview.downrange / 1000).toFixed(2)} km · TOF ${lastPreview.timeOfFlight.toFixed(1)} s`
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
    piece.schedulePreview(250);
    firingTable.notifyChanged();
  };

  // P-VIVO.7 — blanco móvil: el actor vive aquí (Three + muestreo de camino).
  let movingActor: MovingTargetActor | null = null;

  // P-PRO.7 — modo instrucción: reto de puntería puntuado.
  const challenge = new Challenge(service, panel, {
    marker: (enu) => preview.showChallengeTarget(enu),
    lockPick: (locked) => {
      if (locked) pickMode = 'none'; // por si 🎯 estaba armado
      panel.setPickEnabled(!locked);
    },
    schedulePreview: () => piece.schedulePreview(0),
    onStart: () => {
      fo.cancel(); // P-VIVO.6 — un reto a la vez
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
  });

  // P-VIVO.6 — reto de Observador Avanzado: corriges desde un OP real.
  const fo = new ForwardObserver(service, panel, {
    marker: (enu) => preview.showChallengeTarget(enu),
    lockPick: (locked) => {
      if (locked) pickMode = 'none';
      panel.setPickEnabled(!locked);
    },
    schedulePreview: () => piece.schedulePreview(0),
    setArc: (visible) => panel.setArcChecked(visible),
    enterOpCamera: (posEnu, lookAz) => {
      director.enterOp(posEnu, lookAz);
      panel.markCamera('free'); // ningún botón de cámara representa el OP
      toast('🔭 En el OP: arrastra para mirar · rueda = prismáticos');
    },
    exitOpCamera: () => {
      director.setMode('free');
      panel.markCamera('free');
      flyToBattery(true);
    },
    onStart: () => {
      challenge.cancel();
      piece.clearTarget(); // sin objetivo viejo: ni marcador ni elipse PER
    },
  });

  piece.onAnyImpact = (enu) => {
    challenge.notifyImpact(enu);
    fo.notifyImpact(enu); // P-VIVO.6 — cuenta rondas y puntúa el reto FO
    gunnerHud.addImpact(enu); // punto en el minimapa del artillero
    tutorial?.notify('impact'); // P-VIVO.11 — paso ③: FUEGO e impacto
  };

  // P-NEXT.1 — cockpit de puntería fina + cámara de cabina.
  const cockpit = new Cockpit(panel, () => piece.schedulePreview());
  director.aimProvider = () => ({
    azimuthDeg: panel.azimuthDeg,
    elevationDeg: panel.elevationDeg,
  });
  director.muzzleProvider = () => gun.muzzleWorldEnu(); // cabina pegada al tubo

  // -- Picking sobre el globo ------------------------------------------------
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
      toast('Ahí no hay globo que picar');
      return;
    }
    if (pickMode === 'target') {
      pickMode = 'none';
      panel.setPickActive(false);
      void piece.aimAt(service.frame.ecefToEnu(ecef));
      tutorial?.notify('target-marked'); // P-VIVO.11 — paso ④
    } else {
      pickMode = 'none';
      panel.setBatteryActive(false);
      const carto = Cesium.Cartographic.fromCartesian(ecef);
      void (async () => {
        await reanchorBattery(
          Cesium.Math.toDegrees(carto.longitude),
          Cesium.Math.toDegrees(carto.latitude),
        );
        weather.onBatteryMoved(); // P-PRO.2 — re-consulta si la meteo real manda
        flyToBattery(true);
        toast(`Batería desplegada (lat ${Cesium.Math.toDegrees(carto.latitude).toFixed(3)}º)`);
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
      tog: { b: panel.googleActive, arc: panel.arcChecked, night: panel.nightActive },
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
        await weather.applyReal().catch(() => toast('Sin meteo real — sigo en manual'));
      } else {
        weather.applyManual(s.wx.ws ?? 0, s.wx.wb ?? 270, s.wx.t ?? 15, s.wx.p ?? 1013.25);
      }
    }

    if (s.tog) {
      if (s.tog.night !== undefined && s.tog.night !== panel.nightActive) {
        panel.setNight(s.tog.night, true);
      }
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

  function shareScenario(): void {
    try {
      const enc = encodeState(collectState());
      const hash = `#s=${enc}`;
      history.replaceState(null, '', hash);
      const url = window.location.href;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => toast('🔗 URL copiada — este escenario viaja entero en el enlace'),
          () => toast('🔗 URL lista en la barra de direcciones — cópiala'),
        );
      } else {
        toast('🔗 URL lista en la barra de direcciones — cópiala');
      }
    } catch (err) {
      console.error('[share]', err);
      toast('No se pudo generar el enlace');
    }
  }

  function resetSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // sin almacenamiento
    }
    sessionAutosave = false; // que no se re-guarde sola tras el borrado
    toast('Sesión borrada — recarga para arrancar de fábrica');
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
  function flyToBattery(fast: boolean): void {
    const f = service.frame;
    viewer.camera.flyTo({
      destination: f.enuToEcef(new Vec3(-900, -900, 500)),
      orientation: {
        direction: Cesium.Cartesian3.normalize(
          f.enuVectorToEcef(new Vec3(0.62, 0.62, -0.28)), new Cesium.Cartesian3(),
        ),
        up: Cesium.Cartesian3.normalize(
          f.enuVectorToEcef(new Vec3(0.2, 0.2, 0.96)), new Cesium.Cartesian3(),
        ),
      },
      duration: fast ? 1.2 : 2.8,
    });
  }
  flyToBattery(false);

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
    gunnerHud.setVisible(director.mode === 'cabin');
    gunnerHud.render(dt);
    vfx.update(dt, overlay.cameraEnu());
    director.update(dt);
    cockpit.render(); // solo repinta si la puntería cambió
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

  // P-VIVO.11 — pestañas de paneles en pantallas estrechas + tutorial guiado.
  installPanelTabs();
  const TUTORIAL_ANCHORS = [
    'weaponSelect', 'cockpit', 'fireBtn', 'pickTargetBtn', 'disperseBtn', 'challengeBtn',
  ];
  tutorial = new Tutorial((step) =>
    document.getElementById(TUTORIAL_ANCHORS[step] ?? '') ?? null,
  );

  // P-VIVO.10 — repetición del último vuelo desde el HUD.
  hud.onReplay = (camera, slow) => {
    if (piece.replayLast(camera, slow)) {
      panel.markCamera(camera);
      toast(`↺ Repitiendo el último vuelo${slow ? ' a ×0.25' : ''}`);
    } else {
      toast('Aún no hay vuelo que repetir — dispara primero');
    }
  };

  // P-VIVO.10 — arranque: el hash #s=… manda; si no hay, la última sesión.
  const rawHash = window.location.hash;
  if (rawHash.startsWith('#s=')) {
    try {
      await restoreState(decodeState(rawHash));
      toast('🔗 Escenario restaurado del enlace');
    } catch (err) {
      console.warn('[share] hash inválido', err);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      toast(`Enlace inválido (${(err as Error).message}) — arranco normal`);
      piece.schedulePreview(400);
    }
  } else {
    let restored = false;
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        await restoreState(decodeState(saved));
        restored = true;
      }
    } catch (err) {
      console.warn('[session] sesión corrupta — borrada', err);
      try { localStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
    }
    if (!restored) piece.schedulePreview(400); // primer arco al arrancar
  }
  console.log('[UnaiArtillery] listo — física validada, globo real, fuego a discreción');
}

boot().catch((err) => {
  console.error('[UnaiArtillery] fallo de arranque', err);
  toast('Fallo de arranque — mira la consola');
});
