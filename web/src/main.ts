// ============================================================================
//  main.ts — Ensamblaje de la aplicación.
//
//  Globo Cesium + overlay Three + servicio balístico (core TS validado) +
//  pieza de artillería + cámaras + HUD/meteo. El bucle: la física de un tiro
//  se resuelve UNA vez (async, muestreando el terreno) y los presentadores
//  solo reproducen; cada frame actualiza presentadores, VFX y cámara.
// ============================================================================
import * as Cesium from 'cesium';
import * as THREE from 'three';
import { createViewer, GoogleTiles } from './viewer';
import { BallisticsService } from './BallisticsService';
import { ThreeOverlay } from './render/ThreeOverlay';
import { maybeAttachBloom } from './render/PostFX';
import { VfxManager, puffPoolStats } from './vfx/effects';
import { AudioEngine } from './vfx/AudioEngine';
import { CraterLayer } from './vfx/CraterLayer';
import { TrajectoryPreview } from './TrajectoryPreview';
import { CameraDirector } from './CameraDirector';
import { GunModel } from './GunModel';
import { ArtilleryPiece } from './ArtilleryPiece';
import { ControlPanel } from './ui/ControlPanel';
import { Challenge } from './ui/Challenge';
import { Cockpit } from './ui/Cockpit';
import { FiringTablePanel } from './ui/FiringTablePanel';
import { GunnerHud } from './ui/GunnerHud';
import { WeatherPanel } from './ui/Weather';
import { HUD } from './ui/HUD';
import { toast } from './ui/toast';
import { Vec3 } from './ballistics';
import type { FlightResult } from './ballistics';
import type { RangeRing } from './BallisticsService';

type PickMode = 'none' | 'target' | 'battery';

async function boot(): Promise<void> {
  const viewer = await createViewer('cesiumContainer');
  const service = new BallisticsService(viewer);
  await service.setBattery(-3.9, 40.75); // Sierra de Guadarrama

  const overlay = new ThreeOverlay(viewer, service.frame);
  maybeAttachBloom(overlay);
  const vfx = new VfxManager(overlay.enuRoot, (pos) => service.atmo.windAt(pos, 0));
  const audio = new AudioEngine();
  const craters = new CraterLayer(overlay.enuRoot); // P-NEXT.7
  const preview = new TrajectoryPreview(viewer, () => service.frame);
  const director = new CameraDirector(viewer, service);
  const hud = new HUD();

  let pickMode: PickMode = 'none';
  let piece: ArtilleryPiece;
  let gun: GunModel;

  // P-NEXT.3 — edificios 3D fotorrealistas (opcional, solo visual).
  const googleTiles = new GoogleTiles(viewer, (msg) => toast(msg));

  const panel = new ControlPanel({
    onAimChanged: () => piece.schedulePreview(),
    onWeaponChanged: () => {
      service.roundIndex = 0; // P-PRO.4 — arma nueva, munición estándar
      gun.setWeapon(panel.weapon()); // P-PRO.1 — nueva silueta (dispose limpio)
      piece.clearTarget();
      piece.schedulePreview(0);
      firingTable.notifyChanged();
      refreshRing(); // el minimapa del artillero escala con el arma
      challenge.cancel(); // P-PRO.7 — arma nueva, reto viejo fuera
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
    onMRSI: (n) => void piece.fireMRSI(n),
    onCompare: () => void piece.compare(),
    onDisperse: (n) => void piece.fireDispersedSalvo(n),
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
    onVolume: (v) => {
      audio.unlock(); // tocar el volumen ES un gesto de usuario: desbloquea
      audio.setVolume(v);
      panel.setAudioState(audio.masterVolume, audio.isMuted);
    },
    onMute: (m) => {
      audio.unlock();
      audio.setMuted(m);
      panel.setAudioState(audio.masterVolume, audio.isMuted);
    },
  });
  panel.setAudioState(audio.masterVolume, audio.isMuted);

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
  }

  // P-PRO.1 — la pieza por fin se VE: modelo procedural que apunta en vivo.
  gun = new GunModel(overlay.enuRoot, panel.weapon());

  // P-ANI.1 / P-AUD.1 — el ciclo mecánico del arma suena donde está el arma:
  // la culata, la bandeja de carga y el casquillo llevan su cue espacial.
  gun.onMech = (event) => {
    const m = gun.muzzleWorldEnu();
    const cue = overlay.audioCueFor(new THREE.Vector3(m.x, m.y, m.z));
    audio.mech(event === 'casing' ? 'casing' : event, {
      distanceM: cue.distanceM,
      soundSpeed: service.soundSpeedAt(0),
      pan: cue.pan,
      behind: cue.behind,
      energy: Math.cbrt(panel.weapon().round.diameter / 0.155),
    });
  };
  // Al abrir la culata sale el humo que quedaba en el ánima.
  gun.onBoreSmoke = (posEnu, dirEnu) => {
    vfx.boreSmoke(posEnu, dirEnu, Math.cbrt(panel.weapon().round.diameter / 0.155));
  };

  piece = new ArtilleryPiece(
    service, overlay, vfx, audio, preview, director, panel, hud, craters, gun,
  );
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
    previewImpactEnu: () => lastPreview?.impactPoint ?? null,
    solutionText: () =>
      lastPreview
        ? `→ ${(lastPreview.downrange / 1000).toFixed(2)} km · TOF ${lastPreview.timeOfFlight.toFixed(1)} s`
        : '',
    ring: () => lastRing,
  });

  piece.onPreview = (fr) => {
    firingTable.setPreviewRange(fr.downrange);
    lastPreview = fr;
  };

  weather.onChange = () => {
    piece.schedulePreview(250);
    firingTable.notifyChanged();
  };

  // P-PRO.7 — modo instrucción: reto de puntería puntuado.
  const challenge = new Challenge(service, panel, {
    marker: (enu) => preview.showChallengeTarget(enu),
    lockPick: (locked) => {
      if (locked) pickMode = 'none'; // por si 🎯 estaba armado
      panel.setPickEnabled(!locked);
    },
    schedulePreview: () => piece.schedulePreview(0),
  });
  piece.onAnyImpact = (enu) => {
    challenge.notifyImpact(enu);
    gunnerHud.addImpact(enu); // punto en el minimapa del artillero
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
    // P-AUD.1 — el motor de puntería zumba mientras el arma gira de verdad,
    // y se calla cuando llega a su sitio. Solo se oye si estás al lado.
    audio.servo(overlay.cameraEnu().length() < 260 ? gun.slewRateDegS : 0);
    gunnerHud.setVisible(director.mode === 'cabin');
    gunnerHud.render(dt);
    vfx.update(dt, overlay.cameraEnu());
    director.update(dt);
    cockpit.render(); // solo repinta si la puntería cambió
    if (statsEl && (statsAcc += dt) > 0.25) {
      statsAcc = 0;
      const info = overlay.renderer.info;
      const pool = puffPoolStats();
      const fr = viewer.camera.frustum;
      const nf = fr instanceof Cesium.PerspectiveFrustum
        ? `near ${fr.near?.toFixed(1)} far ${fr.far?.toFixed(0)} fov ${Cesium.Math.toDegrees(fr.fov ?? 0).toFixed(0)}º · `
        : '';
      statsEl.textContent = nf +
        `three ${info.render.calls} calls · ${info.render.triangles} tris · ` +
        `geo ${info.memory.geometries} · tex ${info.memory.textures} · ` +
        `sprites ${pool.live} vivos / pool ${pool.created} (${pool.free} libres) · ` +
        `cráteres ${craters.count}`;
    }
  });
  viewer.scene.postRender.addEventListener(() => overlay.render());

  // Primer arco al arrancar.
  piece.schedulePreview(400);
  console.log('[UnaiArtillery] listo — física validada, globo real, fuego a discreción');
}

boot().catch((err) => {
  console.error('[UnaiArtillery] fallo de arranque', err);
  toast('Fallo de arranque — mira la consola');
});
