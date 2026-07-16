// ============================================================================
//  viewer.ts — Arranque del globo CesiumJS.
//
//  Con token de Cesium ion (VITE_CESIUM_TOKEN en .env) carga Cesium World
//  Terrain + imaginería ion (relieve real). Sin token degrada con elegancia a
//  imaginería OpenStreetMap sobre el elipsoide, para que `npm run dev`
//  funcione sin registrarse.
//
//  P-NEXT.3 — Google Photorealistic 3D Tiles (opcional): con
//  VITE_GOOGLE_MAPS_KEY (Map Tiles API) carga las ciudades/edificios reales
//  de Google Earth; sin ella pero con token de ion, intenta el asset 2275207
//  (el mismo tileset servido vía ion). IMPORTANTE: los edificios son SOLO
//  visuales — la física sigue muestreando el terrainProvider (el impacto se
//  calcula contra el terreno, no contra los tejados). Clave inválida o cuota
//  agotada degradan con un aviso al modo actual. La atribución de Google
//  llega dentro de los créditos del tileset y Cesium la muestra en el pie.
// ============================================================================
import * as Cesium from 'cesium';

export async function createViewer(containerId: string): Promise<Cesium.Viewer> {
  const token = (import.meta.env.VITE_CESIUM_TOKEN ?? '').trim();
  const hasToken = token.length > 0;
  if (hasToken) Cesium.Ion.defaultAccessToken = token;

  // El provider de CWT se espera AQUÍ: `Cesium.Terrain.fromWorldTerrain()`
  // lo instala async y la batería se anclaba a h=0 (elipsoide) antes de que
  // llegara — el cañón y todo lo ENU quedaban ~1 km bajo el relieve visual.
  let worldTerrain: Cesium.CesiumTerrainProvider | null = null;
  if (hasToken) {
    try {
      worldTerrain = await Cesium.createWorldTerrainAsync({ requestWaterMask: true });
    } catch (err) {
      console.warn('[UnaiArtillery] Cesium World Terrain no disponible — sigo sin relieve', err);
    }
  }

  const viewer = new Cesium.Viewer(containerId, {
    // Sin token, el Viewer por defecto pediría imaginería ion y fallaría:
    // damos una capa base explícita de OSM en ese caso.
    // P-VIVO.4 — waterMask: el mar SE VE como agua (especular animado) y de
    // paso delata visualmente dónde el splash sustituye al cráter.
    ...(worldTerrain
      ? { terrainProvider: worldTerrain }
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

// ---------------------------------------------------------------------------
//  P-NEXT.3 — Google Photorealistic 3D Tiles con toggle en caliente.
// ---------------------------------------------------------------------------
export class GoogleTiles {
  private tileset: Cesium.Cesium3DTileset | null = null;
  private loading: Promise<Cesium.Cesium3DTileset | null> | null = null;
  private failWarned = false;
  /** Secuencia de setEnabled: la ÚLTIMA llamada decide el estado final. */
  private reqSeq = 0;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly onWarning: (msg: string) => void = (m) => console.warn(m),
  ) {}

  /**
   * Tileset visible ahora mismo (null si está apagado). El servicio balístico
   * lo usa para anclar la batería al SUELO VISUAL de Google: su terreno viene
   * horneado en las teselas y NO coincide con el terrainProvider (sin token de
   * ion, el elipsoide está cientos de metros por debajo de la ciudad visible).
   */
  get groundTileset(): Cesium.Cesium3DTileset | null {
    return this.tileset && this.tileset.show ? this.tileset : null;
  }

  /** Hay alguna vía configurada (clave de Google o token de ion). */
  static available(): boolean {
    return GoogleTiles.googleKey().length > 0 || GoogleTiles.ionToken().length > 0;
  }

  private static googleKey(): string {
    return (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '').trim();
  }

  private static ionToken(): string {
    return (import.meta.env.VITE_CESIUM_TOKEN ?? '').trim();
  }

  /**
   * Enciende/apaga los edificios 3D. Devuelve el estado real conseguido:
   * false si la carga falló (clave inválida, cuota, sin red) — la app queda
   * exactamente como estaba.
   */
  async setEnabled(on: boolean): Promise<boolean> {
    const scene = this.viewer.scene;
    const seq = ++this.reqSeq;
    if (!on) {
      if (this.tileset) this.tileset.show = false;
      scene.globe.show = true;
      return false;
    }

    if (!this.tileset) {
      this.loading ??= this.load();
      this.tileset = await this.loading;
      this.loading = null;
      if (!this.tileset) return false;
    }
    // Carrera ON→OFF: si el usuario apagó el toggle mientras el tileset
    // cargaba, el OFF (más nuevo) manda — no re-enciendas por encima.
    if (seq !== this.reqSeq) {
      this.tileset.show = false;
      return false;
    }
    this.tileset.show = true;
    // Aparta el globo base: las teselas fotorrealistas YA traen su terreno y
    // pelearían en z con el relieve/imaginería de debajo.
    scene.globe.show = false;
    return true;
  }

  private async load(): Promise<Cesium.Cesium3DTileset | null> {
    const key = GoogleTiles.googleKey();
    const ion = GoogleTiles.ionToken();
    if (!key && !ion) {
      this.onWarning('Edificios 3D: falta VITE_GOOGLE_MAPS_KEY (o token de ion).');
      return null;
    }

    // 1) Clave directa de Google. OJO: desde 2025-07-08 la Map Tiles API
    // devuelve 403 a las cuentas con facturación en el EEA (3D/satélite
    // prohibidos, sin excepciones) — por eso el fallo aquí NO es terminal:
    // se reintenta por Cesium ion, cuya cuenta no está sujeta al bloqueo.
    if (key) {
      try {
        Cesium.GoogleMaps.defaultApiKey = key;
        return this.adopt(await Cesium.createGooglePhotorealistic3DTileset());
      } catch (err) {
        console.warn('[GoogleTiles] clave directa rechazada', err);
        if (ion) {
          this.onWarning('Google rechazó la clave (¿cuenta EEA o cuota?) — probando vía Cesium ion…');
        }
      }
    }

    // 2) Mismo tileset, servido a través de Cesium ion (asset 2275207).
    if (ion) {
      try {
        return this.adopt(await Cesium.Cesium3DTileset.fromIonAssetId(2275207));
      } catch (err) {
        console.warn('[GoogleTiles] vía ion fallida', err);
      }
    }

    this.onWarning(
      'Edificios 3D no disponibles (clave inválida, bloqueo EEA o cuota agotada) — sigo sin ellos.',
    );
    return null;
  }

  /** Cablea el aviso de teselas fallidas y cuelga el tileset de la escena. */
  private adopt(tileset: Cesium.Cesium3DTileset): Cesium.Cesium3DTileset {
    tileset.tileFailed.addEventListener(() => {
      if (this.failWarned) return;
      this.failWarned = true;
      this.onWarning('Edificios 3D: fallos cargando teselas (¿cuota agotada?).');
    });
    this.viewer.scene.primitives.add(tileset);
    return tileset;
  }
}
