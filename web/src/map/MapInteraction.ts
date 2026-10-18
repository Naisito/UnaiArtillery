// ============================================================================
//  map/MapInteraction.ts — Interacción con el mapa (contrato PLAN §3.4).
//  [V2:MAP]
//
//  Orquesta la estación de mapa: lectura bajo el cursor (franja de estado),
//  modos de designación (objetivo / batería / medición) con chip, cursor en
//  cruz, fantasma e invalidez, menú contextual del botón derecho, doble clic
//  = volar al punto, clúster de navegación, capas base, rejilla MGRS,
//  simbología APP-6 de batería/OP/impactos, abanico de tiro y atajos de
//  teclado. Sustituye al manejador de picking de main.ts.
//
//  Rendimiento: el hover se procesa como mucho una vez por frame y cada
//  ≥ 33 ms (rAF + compuerta), las primitivas se reutilizan (cero churn de
//  entidades por movimiento de ratón) y el abanico/rejilla solo se rehacen
//  cuando cambia algo que les afecta. El estado del host (arma, carga,
//  batería, objetivo, observador) se sondea a 4 Hz: aunque el host olvide
//  llamar a refresh(), el mapa se pone al día solo.
// ============================================================================
import * as Cesium from 'cesium';
import { forward as mgrsForward } from 'mgrs';
import type { BallisticsService, RangeRing } from '../BallisticsService';
import type { CameraDirector } from '../CameraDirector';
import type { FiringTable, Vec3, Weapon } from '../ballistics';
import type { TrajectoryPreview } from '../TrajectoryPreview';
import type { GeoFrame } from '../frame';
import { sampleDem } from '../dem';
import { BaseLayers } from './BaseLayers';
import { ContextMenu, MenuEntry } from './ContextMenu';
import { el, mapRoot, mapViewportRect } from './dom';
import { vincentyInverse } from './geodesy';
import { GridOverlay } from './GridOverlay';
import { HintChip } from './HintChip';
import { ICON } from './icons';
import { CameraKey, RateGate, actionForKey, isEditableTarget, isStillClick } from './input';
import { SYM } from './mapSymbols';
import { GeoPoint, MeasureTool } from './MeasureTool';
import { NavCluster } from './NavCluster';
import { interpolateQe } from './qe';
import { RangeFanLayer } from './RangeFanLayer';
import { computeScaleBar } from './scale';
import { StatusBar, CursorReadout, RangeState } from './StatusBar';
import { SymbolLayer } from './SymbolLayer';
import { symbolSpecForWeapon } from './symbols';
import { spotting } from './tactics';
import {
  formatDistance, formatHeight, formatLat, formatLon, formatMgrs, formatMils, latLonPlain,
} from './units';

export type PickMode = 'none' | 'target' | 'battery' | 'measure';

export interface MapHost {
  viewer: Cesium.Viewer;
  service: BallisticsService;       // frame, approxMaxRange, sampleLineProfile…
  weapon(): Weapon;                 // arma vigente (alcances, traverse)
  chargeIndex(): number;
  aim(): { azimuthDeg: number; elevationDeg: number };
  target(): Vec3 | null;            // ENU
  pickLocked(): boolean;            // reto en curso: sin designación libre
  actions: {
    setTarget(enu: Vec3): void;               // → piece.aimAt
    moveBattery(lonDeg: number, latDeg: number): void;
    flyToBattery(): void;
    flyToTarget(): void;
    /** (Opcional, V2:MAP) atajos 1–6: Libre, Órbita, Seguir, Dron, Artillero, 1ª persona. */
    setCameraMode?(mode: CameraKey): void;
  };
  // --- Extras opcionales (V2:MAP): con ellos el mapa es más rico. ----------
  /** Id del catálogo (variante del símbolo y anillos de alcance propios). */
  weaponId?(): string;
  /** Director de cámaras: vuelos suaves (doble clic, brújula, zoom…). */
  director?: CameraDirector;
  /** Preview: el abanico de tiro sustituye a sus anillos simples. */
  preview?: TrajectoryPreview;
  /** Puesto de observación activo (reto FO), ENU. */
  observer?(): Vec3 | null;
  /** Tabla de tiro vigente (QE instantánea bajo el cursor). */
  firingTable?(): FiringTable | null;
  /** Designación de la batería en el rótulo (por defecto "BTY A"). */
  batteryName?(): string;
}

const PICK_TEXT: Record<Exclude<PickMode, 'none'>, string> = {
  target: 'Clic para designar el objetivo',
  battery: 'Clic para desplegar la batería',
  measure: 'Clic para medir desde la batería',
};

export class MapInteraction {
  private _pickMode: PickMode = 'none';
  onPickModeChanged?: (mode: PickMode) => void;

  private readonly viewer: Cesium.Viewer;
  private readonly root: HTMLDivElement;
  private readonly status: StatusBar;
  private readonly nav: NavCluster;
  private readonly hint: HintChip;
  private readonly menu: ContextMenu;
  private readonly layers: BaseLayers;
  private readonly fan: RangeFanLayer;
  private readonly grid: GridOverlay;
  private readonly measure: MeasureTool;
  private readonly symbols: SymbolLayer;
  private readonly handler: Cesium.ScreenSpaceEventHandler;
  private readonly creditsHome: { parent: Element | null; next: Element | null };

  // Estado sondeado del host.
  private lastFrame: GeoFrame | null = null;
  private weaponKey = '';
  private weaponName = '';
  private chargeName = '';
  private ring: RangeRing | null = null;
  private ringToken = 0;
  private lastAz = NaN;
  private lastPoll = 0;
  private hadTarget = false;
  private geoidN: number | null = null;
  private geoidToken = 0;

  // Hover.
  private mouse: Cesium.Cartesian2 | null = null;
  private hoverQueued = false;
  private readonly hoverGate = new RateGate(33);
  private lastViewKey = '';
  private lastScaleAt = 0;
  private rightDown: { x: number; y: number; t: number } | null = null;
  private pendingMeasureOrigin: GeoPoint | null | undefined = undefined;
  private readonly offs: (() => void)[] = [];
  private readonly scratchCarto = new Cesium.Cartographic();

  constructor(private readonly host: MapHost) {
    this.viewer = host.viewer;
    const viewer = this.viewer;
    this.root = mapRoot();

    this.status = new StatusBar(this.root);
    const credits = viewer.cesiumWidget.creditContainer;
    this.creditsHome = { parent: credits.parentElement, next: credits.nextElementSibling };
    this.status.adoptCredits(credits);

    this.hint = new HintChip(this.root);
    this.hint.onCancel = () => this.cancelAll();
    this.menu = new ContextMenu(this.root);

    const hasIon = (import.meta.env.VITE_CESIUM_TOKEN ?? '').trim().length > 0;
    this.layers = new BaseLayers(viewer, hasIon);
    this.fan = new RangeFanLayer(viewer, () => host.service.frame);
    host.preview?.setRingRenderer(this.fan);
    this.grid = new GridOverlay(viewer, this.root, () => host.service.frame.heightM);
    this.grid.setTone(this.layers.tone);
    this.symbols = new SymbolLayer(viewer);
    this.measure = new MeasureTool(viewer, host.service, () => host.service.frame, this.root, this.hint, () => this.geoidN);
    this.measure.onPhaseChanged = (phase) => {
      this.nav.setMeasure(phase !== 'idle');
      if ((phase === 'done' || phase === 'idle') && this._pickMode === 'measure') this.applyPickMode('none');
    };

    this.nav = new NavCluster(this.root, {
      northUp: () => this.northUp(),
      zoom: (f) => this.zoom(f),
      planView: () => this.director()?.planView(),
      flyToBattery: () => host.actions.flyToBattery(),
      flyToTarget: () => this.flyToTarget(),
      toggleGrid: () => this.toggleGrid(),
      toggleMeasure: () => {
        if (this.measure.active) {
          this.measure.clear();
          if (this._pickMode === 'measure') this.applyPickMode('none');
        } else {
          this.setPickMode('measure');
        }
      },
      setBaseLayer: (id) => this.layers.set(id),
      setLabels: (on) => {
        this.layers.setLabels(on);
        this.nav.setBaseLayer(this.layers.current, this.layers.labelsOn);
      },
      isLayerAvailable: (id) => this.layers.isAvailable(id),
    });
    this.layers.onChange = (id) => {
      this.nav.setBaseLayer(id, this.layers.labelsOn);
      this.grid.setTone(this.layers.tone);
    };
    this.nav.setBaseLayer(this.layers.current, this.layers.labelsOn);
    this.nav.setTargetAvailable(false);

    // -- Entrada sobre el globo ---------------------------------------------
    const canvas = viewer.scene.canvas as HTMLCanvasElement;
    this.handler = new Cesium.ScreenSpaceEventHandler(canvas);
    this.handler.setInputAction(
      (ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onLeftClick(ev.position),
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
    this.handler.setInputAction(
      (ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onDoubleClick(ev.position),
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
    const onMove = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = new Cesium.Cartesian2(ev.clientX - r.left, ev.clientY - r.top);
      this.queueHover();
    };
    const onLeave = () => {
      this.mouse = null;
      this.status.update(null);
      this.symbols.setGhost(null);
      this.measure.hover(null);
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button === 2) this.rightDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 2 || !this.rightDown) return;
      const down = this.rightDown;
      this.rightDown = null;
      if (isStillClick(down, { x: ev.clientX, y: ev.clientY, t: performance.now() })) {
        this.openContextMenu(ev.clientX, ev.clientY);
      }
    };
    const onCtx = (ev: Event) => ev.preventDefault();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onCtx);
    const onKey = (ev: KeyboardEvent) => this.onKeyDown(ev);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKey);
    });

    // -- Bucle de sincronía (barato; lo caro va con compuertas) ---------------
    this.offs.push(viewer.scene.preRender.addEventListener(() => this.sync()));
    this.refresh();
  }

  // ===========================================================================
  //  Contrato
  // ===========================================================================
  get pickMode(): PickMode {
    return this._pickMode;
  }

  setPickMode(mode: PickMode): void {
    if (mode === 'target' && this.host.pickLocked()) {
      this.hint.flash('Designación bloqueada: hay un reto en curso', 'error', 2200);
      if (this._pickMode === 'target') this.applyPickMode('none');
      else this.onPickModeChanged?.(this._pickMode);
      return;
    }
    if (mode === 'measure') {
      const origin = this.pendingMeasureOrigin;
      this.pendingMeasureOrigin = undefined;
      this.applyPickMode('measure');
      this.measure.begin(origin === undefined ? null : origin);
      return;
    }
    this.applyPickMode(mode);
  }

  /** Batería/arma/carga/objetivo/meteo cambiaron: redibuja abanico y símbolos. */
  refresh(): void {
    this.weaponKey = ''; // fuerza el re-sondeo del arma y los alcances
    this.lastPoll = 0;
    this.sync(true);
  }

  /** Impacto real (main.ts lo llama desde piece.onAnyImpact). */
  notifyImpact(enu: Vec3): void {
    const frame = this.host.service.frame;
    const tgt = this.host.target();
    const spot = tgt ? spotting(enu, tgt).text : null;
    this.symbols.addImpact(frame.enuToEcef(enu), spot);
  }

  /** Borra las marcas de impacto (p. ej. con "Limpiar cráteres"). */
  clearImpacts(): void {
    this.symbols.clearImpacts();
  }

  /** Abanico de tiro visible (p. ej. oculto en modo inmersión). */
  setFanVisible(on: boolean): void {
    this.fan.setVisible(on);
  }

  get gridEnabled(): boolean {
    return this.grid.isEnabled;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.handler.destroy();
    this.menu.close();
    this.host.preview?.setRingRenderer(null);
    this.fan.dispose();
    this.grid.dispose();
    this.measure.dispose();
    this.symbols.dispose();
    const credits = this.viewer.cesiumWidget.creditContainer;
    if (this.creditsHome.parent) this.creditsHome.parent.insertBefore(credits, this.creditsHome.next);
    this.viewer.container.classList.remove('ua-picking', 'ua-picking-invalid');
    this.root.innerHTML = '';
  }

  // ===========================================================================
  //  Modos de designación
  // ===========================================================================
  private applyPickMode(mode: PickMode): void {
    const prev = this._pickMode;
    if (prev === 'measure' && mode !== 'measure') this.measure.cancelPicking();
    this._pickMode = mode;
    const c = this.viewer.container;
    c.classList.toggle('ua-picking', mode !== 'none');
    c.classList.remove('ua-picking-invalid');
    if (mode === 'none') {
      this.hint.hideMode();
      this.symbols.setGhost(null);
    } else if (mode !== 'measure') {
      this.hint.showMode(mode, PICK_TEXT[mode]);
    }
    if (mode !== 'none') this.menu.close();
    if (mode !== prev) this.onPickModeChanged?.(mode);
    this.queueHover();
  }

  private cancelAll(): boolean {
    let did = false;
    if (this.menu.isOpen) {
      this.menu.close();
      did = true;
    }
    if (this.nav.layersOpen) {
      this.nav.setLayersOpen(false);
      did = true;
    }
    if (this._pickMode !== 'none') {
      const wasMeasure = this._pickMode === 'measure';
      this.applyPickMode('none');
      if (wasMeasure && !this.measure.hasResult) this.measure.clear();
      did = true;
    } else if (this.measure.active) {
      this.measure.clear();
      did = true;
    }
    return did;
  }

  // ===========================================================================
  //  Picking y lectura
  // ===========================================================================
  /** Punto del suelo bajo una posición de ventana (globo o teselas 3D). */
  private pickGround(pos: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
    const scene = this.viewer.scene;
    if (scene.globe.show) {
      const ray = this.viewer.camera.getPickRay(pos);
      if (ray) {
        const p = scene.globe.pick(ray, scene);
        if (p) return p;
      }
      return undefined;
    }
    // Edificios 3D (globo oculto): profundidad de la escena.
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(pos);
      if (Cesium.defined(p)) return p;
    }
    return undefined;
  }

  private geoPoint(ecef: Cesium.Cartesian3): GeoPoint | null {
    const c = Cesium.Cartographic.fromCartesian(ecef, undefined, this.scratchCarto);
    if (!c) return null;
    return {
      ecef: ecef.clone(),
      latDeg: Cesium.Math.toDegrees(c.latitude),
      lonDeg: Cesium.Math.toDegrees(c.longitude),
      heightM: c.height,
    };
  }

  private mgrsOf(latDeg: number, lonDeg: number): string {
    try {
      return mgrsForward([lonDeg, latDeg], 5);
    } catch {
      return ''; // fuera de UTM (polos)
    }
  }

  private rangeStateOf(rangeM: number): RangeState {
    const r = this.ring;
    if (!r || !(r.maxRangeM > 0)) return 'unknown';
    if (rangeM > r.maxRangeM) return 'out';
    if (Number.isFinite(r.minRangeM) && r.minRangeM > 0 && rangeM < r.minRangeM) return 'min';
    return 'in';
  }

  private readout(p: GeoPoint): CursorReadout {
    const f = this.host.service.frame;
    const g = vincentyInverse(f.latDeg, f.lonDeg, p.latDeg, p.lonDeg);
    const state = this.rangeStateOf(g.distanceM);
    let qe = null;
    const table = this.host.firingTable?.();
    if (table && state === 'in' && table.weaponName === this.weaponName && table.chargeName === this.chargeName) {
      qe = interpolateQe(table.rows, g.distanceM);
    }
    const n = this.geoidN;
    return {
      latDeg: p.latDeg,
      lonDeg: p.lonDeg,
      heightM: Number.isFinite(p.heightM) ? p.heightM - (n ?? 0) : null,
      heightIsMsl: n !== null,
      mgrs: this.mgrsOf(p.latDeg, p.lonDeg),
      rangeM: g.distanceM,
      bearingDeg: g.initialBearingDeg,
      rangeState: state,
      qe,
    };
  }

  private queueHover(): void {
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => this.processHover());
  }

  private processHover(): void {
    this.hoverQueued = false;
    if (!this.mouse) return;
    if (!this.hoverGate.tryPass(performance.now())) {
      this.queueHover(); // aún no toca: el siguiente frame
      return;
    }
    const ecef = this.pickGround(this.mouse);
    const p = ecef ? this.geoPoint(ecef) : null;
    const c = this.viewer.container;
    if (!p) {
      this.status.update(null);
      this.symbols.setGhost(null);
      this.measure.hover(null);
      if (this._pickMode !== 'none') {
        this.hint.setSub('Sin terreno bajo el cursor', true);
        c.classList.add('ua-picking-invalid');
      }
      return;
    }
    const r = this.readout(p);
    this.status.update(r);
    c.classList.remove('ua-picking-invalid');
    switch (this._pickMode) {
      case 'target': {
        const out = r.rangeState === 'out' || r.rangeState === 'min';
        this.symbols.setGhost(SYM.target(0.6), p.ecef);
        const ring = this.ring;
        const why = r.rangeState === 'out' && ring
          ? `Fuera de alcance (máx ${formatDistance(ring.maxRangeM)})`
          : r.rangeState === 'min' && ring
            ? `Bajo el alcance mínimo (${formatDistance(ring.minRangeM)})`
            : '';
        this.hint.setSub(
          why || `${formatDistance(r.rangeM)} · ${formatMils(r.bearingDeg)} mil`,
          out,
        );
        c.classList.toggle('ua-picking-invalid', out);
        break;
      }
      case 'battery': {
        const w = this.host.weapon();
        this.symbols.setGhost(SYM.battery(symbolSpecForWeapon(this.host.weaponId?.() ?? '', w.category), 0.6), p.ecef);
        this.hint.setSub(`${formatMgrs(r.mgrs)} · ${r.heightM === null ? '' : formatHeight(r.heightM)}`);
        break;
      }
      case 'measure':
        this.symbols.setGhost(null);
        this.measure.hover(p);
        break;
      default:
        this.symbols.setGhost(null);
    }
  }

  private onLeftClick(pos: Cesium.Cartesian2): void {
    if (this._pickMode === 'none') return;
    const ecef = this.pickGround(pos);
    const p = ecef ? this.geoPoint(ecef) : null;
    if (!p) {
      this.hint.flash('Ahí no hay terreno que designar', 'error', 1600);
      return;
    }
    const frame = this.host.service.frame;
    switch (this._pickMode) {
      case 'target':
        if (this.host.pickLocked()) {
          this.applyPickMode('none');
          this.hint.flash('Designación bloqueada: hay un reto en curso', 'error', 2200);
          return;
        }
        this.applyPickMode('none');
        this.host.actions.setTarget(frame.ecefToEnu(p.ecef));
        break;
      case 'battery':
        this.applyPickMode('none');
        this.host.actions.moveBattery(p.lonDeg, p.latDeg);
        break;
      case 'measure':
        this.measure.click(p);
        break;
    }
  }

  private onDoubleClick(pos: Cesium.Cartesian2): void {
    if (this._pickMode !== 'none') return;
    const d = this.director();
    if (d && d.mode !== 'free') return; // los modos automáticos mandan
    const ecef = this.pickGround(pos);
    if (!ecef) return;
    if (d) d.flyToPoint(ecef, 0.45);
    else {
      const cam = this.viewer.camera;
      cam.flyToBoundingSphere(new Cesium.BoundingSphere(ecef, 0), {
        offset: new Cesium.HeadingPitchRange(cam.heading, Math.min(cam.pitch, -0.6),
          Cesium.Cartesian3.distance(cam.positionWC, ecef) * 0.45),
        duration: 1.0,
      });
    }
  }

  // ===========================================================================
  //  Menú contextual
  // ===========================================================================
  private openContextMenu(clientX: number, clientY: number): void {
    const canvas = this.viewer.scene.canvas as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const ecef = this.pickGround(new Cesium.Cartesian2(clientX - r.left, clientY - r.top));
    const p = ecef ? this.geoPoint(ecef) : null;
    if (!p) {
      this.hint.flash('Sin terreno bajo el cursor', 'error', 1400);
      return;
    }
    if (this._pickMode !== 'none') this.applyPickMode('none');
    const ro = this.readout(p);
    const mgrsTxt = ro.mgrs ? formatMgrs(ro.mgrs) : `${formatLat(p.latDeg)} ${formatLon(p.lonDeg)}`;
    const locked = this.host.pickLocked();
    const frame = this.host.service.frame;
    const entries: MenuEntry[] = [
      {
        id: 'target', label: 'Designar objetivo aquí', icon: ICON.target, kbd: 'T', tone: 'accent',
        disabledReason: locked ? 'Bloqueado: hay un reto en curso' : null,
        run: () => this.host.actions.setTarget(frame.ecefToEnu(p.ecef)),
      },
      {
        id: 'battery', label: 'Desplegar batería aquí', icon: ICON.battery, kbd: 'B', tone: 'friendly',
        run: () => this.host.actions.moveBattery(p.lonDeg, p.latDeg),
      },
      'sep',
      {
        id: 'measure', label: 'Medir desde aquí', icon: ICON.ruler, kbd: 'M',
        run: () => {
          this.pendingMeasureOrigin = p;
          this.setPickMode('measure');
        },
      },
      {
        id: 'profile', label: 'Perfil y LOS desde la batería', icon: ICON.profile,
        run: () => {
          this.applyPickMode('none');
          this.measure.measure(p, null);
        },
      },
      'sep',
      {
        id: 'copy-mgrs', label: 'Copiar MGRS', icon: ICON.copy,
        disabledReason: ro.mgrs ? null : 'Fuera de la cuadrícula UTM',
        run: () => this.copy(formatMgrs(ro.mgrs), 'MGRS copiado'),
      },
      {
        id: 'copy-ll', label: 'Copiar lat / lon', icon: ICON.copy,
        run: () => this.copy(latLonPlain(p.latDeg, p.lonDeg), 'Lat/lon copiadas'),
      },
      'sep',
      {
        id: 'center', label: 'Centrar cámara aquí', icon: ICON.center,
        run: () => {
          const d = this.director();
          if (d) d.flyToPoint(p.ecef, 1.0, 0.9);
          else this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(p.ecef, 0), { duration: 0.9 });
        },
      },
    ];
    const meta = [
      `<b>${ro.heightM === null ? '—' : formatHeight(ro.heightM)}</b> ${ro.heightIsMsl ? 'MSL' : 'elip.'}`,
      `<b>${formatDistance(ro.rangeM)}</b> · <b>${formatMils(ro.bearingDeg)}</b> mil`,
    ];
    this.menu.open(clientX, clientY, { title: mgrsTxt, meta }, entries);
  }

  private copy(text: string, okMsg: string): void {
    const done = () => this.hint.flash(`${okMsg}: ${text}`, 'ok', 2200);
    const fallback = () => {
      const ta = el('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      if (ok) done();
      else this.hint.flash(`No se pudo copiar — ${text}`, 'error', 3200);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // ===========================================================================
  //  Navegación
  // ===========================================================================
  private director(): CameraDirector | undefined {
    return this.host.director;
  }

  private northUp(): void {
    const d = this.director();
    if (d) d.northUp();
    else {
      const cam = this.viewer.camera;
      cam.flyTo({ destination: cam.positionWC.clone(), orientation: { heading: 0, pitch: cam.pitch, roll: 0 }, duration: 0.6 });
    }
  }

  private zoom(factor: number): void {
    const d = this.director();
    if (d) d.zoomBy(factor);
    else {
      const cam = this.viewer.camera;
      const h = cam.positionCartographic.height;
      if (factor < 1) cam.zoomIn(h * (1 - factor));
      else cam.zoomOut(h * (factor - 1));
    }
  }

  private flyToTarget(): void {
    if (!this.host.target()) {
      this.hint.flash('No hay objetivo designado — pulsa T', 'error', 1800);
      return;
    }
    this.host.actions.flyToTarget();
  }

  private toggleGrid(): void {
    const on = !this.grid.isEnabled;
    this.grid.setEnabled(on);
    this.nav.setGrid(on);
    this.hint.flash(on ? 'Rejilla MGRS activada' : 'Rejilla MGRS desactivada', 'flash', 1200);
  }

  // ===========================================================================
  //  Teclado (PLAN §3.5, parte MAP)
  // ===========================================================================
  private onKeyDown(ev: KeyboardEvent): void {
    if (ev.defaultPrevented) return;
    if (document.pointerLockElement) return; // 1ª persona: WASD/Espacio/C son del FPS
    if (isEditableTarget(ev.target as HTMLElement | null)) return;
    const act = actionForKey(ev);
    if (!act) return;
    switch (act.kind) {
      case 'escape':
        if (this.cancelAll()) ev.preventDefault();
        return;
      case 'designate':
        this.setPickMode(this._pickMode === 'target' ? 'none' : 'target');
        break;
      case 'battery':
        this.setPickMode(this._pickMode === 'battery' ? 'none' : 'battery');
        break;
      case 'measure':
        this.setPickMode(this._pickMode === 'measure' ? 'none' : 'measure');
        break;
      case 'grid':
        this.toggleGrid();
        break;
      case 'layers':
        this.nav.setLayersOpen(!this.nav.layersOpen);
        break;
      case 'northUp':
        this.northUp();
        break;
      case 'flyBattery':
        this.host.actions.flyToBattery();
        break;
      case 'camera':
        if (!this.host.actions.setCameraMode) return;
        this.host.actions.setCameraMode(act.mode);
        break;
    }
    ev.preventDefault();
  }

  // ===========================================================================
  //  Sincronía con el host y la cámara
  // ===========================================================================
  private sync(force = false): void {
    const host = this.host;
    const cam = this.viewer.camera;
    this.nav.setHeading(Cesium.Math.toDegrees(cam.heading));
    this.fan.setRingLabelsVisible(cam.pitch < Cesium.Math.toRadians(-18));

    const frame = host.service.frame;
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      this.onFrameChanged(frame);
    }

    const az = host.aim().azimuthDeg;
    if (force || Math.abs(az - this.lastAz) > 0.005) {
      this.lastAz = az;
      this.fan.setLay(az);
    }

    const now = performance.now();
    if (force || now - this.lastPoll > 250) {
      this.lastPoll = now;
      this.pollHost();
      this.symbols.tickImpacts(now);
    }

    // Escala y re-lectura del cursor si la cámara se movió (≤ 7 Hz).
    const p = cam.positionWC;
    const d = cam.directionWC;
    const viewKey = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)},${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)}`;
    if (viewKey !== this.lastViewKey && now - this.lastScaleAt > 150) {
      this.lastViewKey = viewKey;
      this.lastScaleAt = now;
      this.updateScale();
      if (this.mouse) this.queueHover();
    }
  }

  private pollHost(): void {
    const host = this.host;
    const w = host.weapon();
    const ci = host.chargeIndex();
    const id = host.weaponId?.() ?? '';
    const key = `${id}|${w.name}|${w.round.name}|${ci}|${w.traverseDeg}`;
    if (key !== this.weaponKey) {
      this.weaponKey = key;
      this.weaponName = w.name;
      this.chargeName = w.charges[ci]?.name ?? '';
      this.fan.setTraverse(w.traverseDeg);
      this.updateBatterySymbol(w, id);
      if (id) {
        const token = ++this.ringToken;
        host.service
          .approxMaxRange(id as Parameters<BallisticsService['approxMaxRange']>[0], ci)
          .then((ring) => {
            if (token !== this.ringToken) return;
            this.ring = ring;
            this.fan.setRange(ring.minRangeM, ring.maxRangeM);
          })
          .catch(() => { /* el preview traerá los anillos */ });
      }
    }
    // Sin id, los alcances llegan por el preview (RingRenderer → fan).
    if (!id && this.fan.maxRangeM > 0) {
      this.ring = { minRangeM: this.fan.minRangeM, maxRangeM: this.fan.maxRangeM };
    }

    const hasTarget = !!host.target();
    if (hasTarget !== this.hadTarget) {
      this.hadTarget = hasTarget;
      this.nav.setTargetAvailable(hasTarget);
    }

    const op = host.observer?.() ?? null;
    this.symbols.setObserver(op ? host.service.frame.enuToEcef(op) : null);
  }

  private updateBatterySymbol(w: Weapon, id: string): void {
    const frame = this.host.service.frame;
    const spec = symbolSpecForWeapon(id, w.category);
    const name = `${this.host.batteryName?.() ?? 'BTY A'} · ${spec.platform}`;
    const mgrs = this.mgrsOf(frame.latDeg, frame.lonDeg);
    this.symbols.setBattery(frame.origin, spec, name, mgrs ? formatMgrs(mgrs) : `${formatLat(frame.latDeg)} ${formatLon(frame.lonDeg)}`);
  }

  private onFrameChanged(frame: GeoFrame): void {
    this.fan.invalidate();
    this.measure.invalidate();
    this.symbols.clearImpacts();
    this.weaponKey = ''; // re-pinta el símbolo en la posición nueva
    void frame;
    void this.estimateGeoid();
  }

  /**
   * Ondulación del geoide N bajo la batería: el terreno de Cesium da alturas
   * ELIPSOIDALES; el DEM Copernicus (Open-Meteo) da cotas MSL. La mediana de
   * h − H en 9 puntos alrededor de la batería estima N (varía < 1 m en
   * decenas de km). Sin terreno real o sin red: se muestra la altura
   * elipsoidal rotulada como tal (nunca una cota falsa).
   */
  private async estimateGeoid(): Promise<void> {
    const token = ++this.geoidToken;
    this.geoidN = null;
    const provider = this.viewer.terrainProvider;
    if (provider instanceof Cesium.EllipsoidTerrainProvider) return;
    const f = this.host.service.frame;
    const pts: { latDeg: number; lonDeg: number }[] = [];
    for (const dy of [-700, 0, 700]) {
      for (const dx of [-700, 0, 700]) {
        pts.push({
          latDeg: f.latDeg + dy / 111_320,
          lonDeg: f.lonDeg + dx / (111_320 * Math.cos((f.latDeg * Math.PI) / 180)),
        });
      }
    }
    try {
      const [dem, terr] = await Promise.all([
        sampleDem(pts),
        Cesium.sampleTerrainMostDetailed(provider, pts.map((p) => Cesium.Cartographic.fromDegrees(p.lonDeg, p.latDeg))),
      ]);
      if (token !== this.geoidToken || !dem) return;
      const diffs = terr
        .map((c, i) => c.height - dem[i])
        .filter((d) => Number.isFinite(d))
        .sort((a, b) => a - b);
      if (diffs.length < 5) return;
      const n = diffs[Math.floor(diffs.length / 2)];
      if (Math.abs(n) < 120) this.geoidN = n; // el geoide real va de −106 a +85 m
    } catch {
      /* sin red / sin terreno: altura elipsoidal */
    }
  }

  private updateScale(): void {
    const r = mapViewportRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const a = this.pickGround(new Cesium.Cartesian2(cx - 50, cy));
    const b = this.pickGround(new Cesium.Cartesian2(cx + 50, cy));
    if (!a || !b) {
      this.status.updateScale(null);
      return;
    }
    this.status.updateScale(computeScaleBar(Cesium.Cartesian3.distance(a, b) / 100, 84));
  }
}
