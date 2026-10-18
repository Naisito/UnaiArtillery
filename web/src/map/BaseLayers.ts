// ============================================================================
//  map/BaseLayers.ts — Capas base del globo y rótulos.  [V2:MAP]
//
//  Satélite (la capa de arranque del visor: Bing vía Cesium ion), Topográfico
//  (OpenTopoMap), Callejero (OpenStreetMap) y Oscuro (Esri Dark Gray Canvas),
//  más una capa opcional de rótulos (Esri Reference) que cambia de variante
//  con la base. (CARTO se descartó: desde 2025 sus teselas sin clave salen
//  con la marca "API KEY REQUIRED".) Cada proveedor lleva su
//  atribución en pantalla (Credit con showOnScreen). Las capas se crean
//  perezosamente y solo una está visible; la elección persiste en
//  localStorage. Con los Edificios 3D activos el globo se oculta: la capa
//  base no se ve, pero la elección se conserva para cuando vuelva.
//  Nota comercial: los servidores públicos de OSM/OpenTopoMap tienen
//  políticas de uso justo y los de Esri exigen cuenta ArcGIS para uso
//  comercial; un despliegue de pago debe usar un proveedor con contrato
//  (mismo esquema de URL: basta cambiar la plantilla).
// ============================================================================
import * as Cesium from 'cesium';

export type BaseLayerId = 'satellite' | 'topo' | 'streets' | 'dark';

export interface BaseLayerInfo {
  id: BaseLayerId;
  name: string;
  short: string;
  /** Tono del mapa: decide el color de la rejilla y de los rótulos. */
  tone: 'dark' | 'light';
}

export const BASE_LAYERS: BaseLayerInfo[] = [
  { id: 'satellite', name: 'Satélite', short: 'Bing · ion', tone: 'dark' },
  { id: 'topo', name: 'Topográfico', short: 'OpenTopoMap', tone: 'light' },
  { id: 'streets', name: 'Callejero', short: 'OSM', tone: 'light' },
  { id: 'dark', name: 'Oscuro', short: 'Esri', tone: 'dark' },
];

const KEY_BASE = 'ua.map.baseLayer';
const KEY_LABELS = 'ua.map.labels';

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ESRI_ATTR = '© <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, HERE, Garmin';
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/';

function provider(id: Exclude<BaseLayerId, 'satellite'>): Cesium.ImageryProvider {
  switch (id) {
    case 'topo':
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        subdomains: 'abc',
        maximumLevel: 17,
        credit: new Cesium.Credit(
          `${OSM_ATTR} · SRTM · © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)`,
          true,
        ),
      });
    case 'streets':
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 19,
        credit: new Cesium.Credit(OSM_ATTR, true),
      });
    case 'dark':
      return new Cesium.UrlTemplateImageryProvider({
        url: `${ESRI}Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        maximumLevel: 16,
        credit: new Cesium.Credit(`${ESRI_ATTR} · ${OSM_ATTR}`, true),
      });
  }
}

/** Rótulos superpuestos: variante clara sobre satélite, gris sobre "oscuro". */
function labelsProvider(base: BaseLayerId): Cesium.ImageryProvider {
  const service = base === 'dark'
    ? 'Canvas/World_Dark_Gray_Reference'
    : 'Reference/World_Boundaries_and_Places';
  return new Cesium.UrlTemplateImageryProvider({
    url: `${ESRI}${service}/MapServer/tile/{z}/{y}/{x}`,
    maximumLevel: base === 'dark' ? 16 : 19,
    credit: new Cesium.Credit(`Rótulos ${ESRI_ATTR}`, true),
  });
}

/** Lee la capa persistida (valor inválido → null). Pura para tests. */
export function parseStoredLayer(v: string | null): BaseLayerId | null {
  return v === 'satellite' || v === 'topo' || v === 'streets' || v === 'dark' ? v : null;
}

export class BaseLayers {
  private readonly layers = new Map<BaseLayerId, Cesium.ImageryLayer>();
  private labels: Cesium.ImageryLayer | null = null;
  private labelsVariant: BaseLayerId | null = null;
  private _current: BaseLayerId;
  private _labelsOn = false;
  /** El visor arrancó con imaginería satélite real (token de ion). */
  readonly satelliteAvailable: boolean;
  onChange?: (id: BaseLayerId) => void;

  constructor(private readonly viewer: Cesium.Viewer, hasIonToken: boolean) {
    const initial = viewer.imageryLayers.length > 0 ? viewer.imageryLayers.get(0) : null;
    this.satelliteAvailable = hasIonToken && !!initial;
    // La capa de arranque es la satélite (ion) o, sin token, OSM (callejero).
    if (initial) this.layers.set(this.satelliteAvailable ? 'satellite' : 'streets', initial);
    this._current = this.satelliteAvailable ? 'satellite' : 'streets';

    let stored: BaseLayerId | null = null;
    try {
      stored = parseStoredLayer(localStorage.getItem(KEY_BASE));
      this._labelsOn = localStorage.getItem(KEY_LABELS) === '1';
    } catch { /* sin almacenamiento */ }
    if (stored && (stored !== 'satellite' || this.satelliteAvailable)) this.set(stored, false);
    if (this._labelsOn) this.setLabels(true, false);
  }

  get current(): BaseLayerId {
    return this._current;
  }

  get labelsOn(): boolean {
    return this._labelsOn;
  }

  get tone(): 'dark' | 'light' {
    return BASE_LAYERS.find((l) => l.id === this._current)?.tone ?? 'dark';
  }

  isAvailable(id: BaseLayerId): boolean {
    return id !== 'satellite' || this.satelliteAvailable;
  }

  set(id: BaseLayerId, persist = true): void {
    if (!this.isAvailable(id)) return;
    let layer = this.layers.get(id);
    if (!layer && id !== 'satellite') {
      layer = new Cesium.ImageryLayer(provider(id));
      // Justo encima de la base de arranque: por debajo de cualquier capa
      // que otros módulos añadan después (y de los rótulos).
      this.viewer.imageryLayers.add(layer, Math.min(1, this.viewer.imageryLayers.length));
      this.layers.set(id, layer);
    }
    if (!layer) return;
    for (const [lid, l] of this.layers) l.show = lid === id;
    this._current = id;
    if (this._labelsOn) this.setLabels(true, false); // variante según la base
    else if (this.labels) this.viewer.imageryLayers.raiseToTop(this.labels);
    if (persist) {
      try { localStorage.setItem(KEY_BASE, id); } catch { /* idem */ }
    }
    this.onChange?.(id);
  }

  setLabels(on: boolean, persist = true): void {
    this._labelsOn = on;
    const variant: BaseLayerId = this._current === 'dark' ? 'dark' : 'satellite';
    if (on && this.labels && this.labelsVariant !== variant) {
      this.viewer.imageryLayers.remove(this.labels, true);
      this.labels = null;
    }
    if (on && !this.labels) {
      this.labels = this.viewer.imageryLayers.addImageryProvider(labelsProvider(variant));
      this.labelsVariant = variant;
    }
    if (this.labels) {
      this.labels.show = on;
      if (on) this.viewer.imageryLayers.raiseToTop(this.labels);
    }
    if (persist) {
      try { localStorage.setItem(KEY_LABELS, on ? '1' : '0'); } catch { /* idem */ }
    }
  }
}
