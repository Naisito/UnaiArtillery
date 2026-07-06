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
import { VfxManager } from './vfx/effects';
import { AudioBoom } from './vfx/AudioBoom';
import { CraterLayer } from './vfx/CraterLayer';
import { TrajectoryPreview } from './TrajectoryPreview';
import { CameraDirector } from './CameraDirector';
import { GunModel } from './GunModel';
import { ArtilleryPiece } from './ArtilleryPiece';
import { ControlPanel } from './ui/ControlPanel';
import { Cockpit } from './ui/Cockpit';
import { FiringTablePanel } from './ui/FiringTablePanel';
import { WeatherPanel } from './ui/Weather';
import { HUD } from './ui/HUD';
import { toast } from './ui/toast';
import { Vec3 } from './ballistics';

type PickMode = 'none' | 'target' | 'battery';

async function boot(): Promise<void> {
  const viewer = await createViewer('cesiumContainer');
  const service = new BallisticsService(viewer);
  await service.setBattery(-3.9, 40.75); // Sierra de Guadarrama

  const overlay = new ThreeOverlay(viewer, service.frame);
  maybeAttachBloom(overlay);
  const vfx = new VfxManager(overlay.enuRoot, (pos) => service.atmo.windAt(pos, 0));
  const audio = new AudioBoom();
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
    },
    onRoundChanged: (index) => {
      service.roundIndex = index; // P-PRO.4 — el worker integra ESTA munición
      piece.schedulePreview(0);
      firingTable.notifyChanged();
    },
    onChargeChanged: () => {
      piece.schedulePreview();
      firingTable.notifyChanged();
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
    onGoogleTiles: (active) => {
      void googleTiles.setEnabled(active).then((on) => panel.setGoogleTiles(on));
    },
  });

  // Con clave de Google presente, los edificios entran encendidos de serie.
  if (GoogleTiles.preferredOn()) {
    void googleTiles.setEnabled(true).then((on) => panel.setGoogleTiles(on));
  }

  // P-PRO.1 — la pieza por fin se VE: modelo procedural que apunta en vivo.
  gun = new GunModel(overlay.enuRoot, panel.weapon());
  piece = new ArtilleryPiece(
    service, overlay, vfx, audio, preview, director, panel, hud, craters, gun,
  );
  const weather = new WeatherPanel(service);

  // P-PRO.5 — tabla de tiro interactiva (arma/carga/meteo actuales).
  const firingTable = new FiringTablePanel(service, panel, () => piece.schedulePreview(0));
  piece.onPreview = (fr) => firingTable.setPreviewRange(fr.downrange);

  weather.onChange = () => {
    piece.schedulePreview(250);
    firingTable.notifyChanged();
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
        await service.setBattery(
          Cesium.Math.toDegrees(carto.longitude),
          Cesium.Math.toDegrees(carto.latitude),
        );
        overlay.setFrame(service.frame);
        preview.clearAll();
        piece.clearTarget();
        piece.schedulePreview(0);
        firingTable.notifyChanged(); // la latitud (Coriolis) cambia la tabla
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

  // -- Bucle -------------------------------------------------------------------
  let last = performance.now();
  viewer.clock.onTick.addEventListener(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    piece.update(dt);
    gun.update(dt, panel.azimuthDeg, panel.elevationDeg); // P-PRO.1 — apunta en vivo
    vfx.update(dt, overlay.cameraEnu());
    director.update(dt);
    cockpit.render(); // solo repinta si la puntería cambió
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
