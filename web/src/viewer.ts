// ============================================================================
//  viewer.ts — Arranque del globo CesiumJS.
//
//  Con token de Cesium ion (VITE_CESIUM_TOKEN en .env) carga Cesium World
//  Terrain + imaginería ion (relieve real). Sin token degrada con elegancia a
//  imaginería OpenStreetMap sobre el elipsoide, para que `npm run dev`
//  funcione sin registrarse.
// ============================================================================
import * as Cesium from 'cesium';

export async function createViewer(containerId: string): Promise<Cesium.Viewer> {
  const token = (import.meta.env.VITE_CESIUM_TOKEN ?? '').trim();
  const hasToken = token.length > 0;
  if (hasToken) Cesium.Ion.defaultAccessToken = token;

  const viewer = new Cesium.Viewer(containerId, {
    // Sin token, el Viewer por defecto pediría imaginería ion y fallaría:
    // damos una capa base explícita de OSM en ese caso.
    ...(hasToken
      ? { terrain: Cesium.Terrain.fromWorldTerrain() }
      : {
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
          ),
        }),
    // Consola de tiro limpia: fuera widgets de stock.
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });

  // Que los marcadores/trayectorias se oculten detrás del relieve.
  viewer.scene.globe.depthTestAgainstTerrain = true;
  // El sol ilumina el terreno según la hora real: más drama en los tiros.
  viewer.scene.globe.enableLighting = true;

  if (!hasToken) {
    console.warn(
      '[UnaiArtillery] Sin VITE_CESIUM_TOKEN: usando OpenStreetMap sin relieve. ' +
        'Crea web/.env con tu token de https://ion.cesium.com/tokens para terreno real.',
    );
  }
  return viewer;
}
