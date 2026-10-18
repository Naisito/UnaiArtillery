// ============================================================================
//  Weather.ts — Pestaña METEO.  [P-WEB.7 / P1.7 / P-PRO.2 · rediseño V2]
//
//  Fuente activa explícita (segmentado): VIENTO CONSTANTE (con ganancia de
//  altura tipo Ekman, ×2 máx.) · PERFIL CON CIZALLADURA (CSV de ejemplo) ·
//  METEO REAL (Open-Meteo: viento por niveles de presión 1000→200 hPa + T/P
//  reducidas al nivel del mar). Rosa de viento con la línea de tiro vigente
//  y sus componentes (cara/cola, cruzado), deslizadores de viento, dirección
//  (en la unidad angular del usuario), temperatura y presión, y el perfil
//  vertical REAL que integra el solver (muestreado de la atmósfera activa).
//
//  Tocar el viento manual sale del perfil/meteo real (antes, con el perfil
//  activo, los deslizadores eran no-ops silenciosos). Tocar T/P sale del
//  modo real y suelta su perfil de viento.
// ============================================================================
import { Atmosphere, Vec3 } from '../ballistics';
import { BallisticsService } from '../BallisticsService';
import { Segmented, SliderField, chip, setChip } from './components';
import { h, setText } from './dom';
import { fetchOpenMeteo } from './openMeteo';
import { RightDock } from './RightDock';
import { settings } from './settings';
import { toast } from './toast';
import type { MetSummary } from './TopBar';
import { AngleUnit, UNIT_SUFFIX, fmtAngle, fromUnit, toUnit } from './units';

type Source = 'steady' | 'profile' | 'real';

const SOURCE_TEXT: Record<Source, string> = {
  steady: 'Viento constante en superficie, con ganancia suave con la altitud (×2 máx.).',
  profile: 'Perfil de ejemplo: el viento rota y arrecia con la altitud.',
  real: 'Open-Meteo, aquí y ahora: viento por niveles de presión y T/P reales.',
};

const DPR = 2;
const COL = {
  text: '#e8edf2', dim: '#6b7785', dim2: '#a3afbb', grid: 'rgba(148,163,184,0.14)',
  info: '#38bdf8', accent: '#f5a524', well: 'rgba(5,8,12,0.85)', edge: 'rgba(148,163,184,0.22)',
};
const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, Consolas, monospace';
const FONT_DISPLAY = '"Barlow Condensed", "Inter Variable", sans-serif';

export class WeatherPanel {
  /** Notifica cambios (la pieza re-previsualiza). */
  onChange?: () => void;

  private windSpeed = 0;
  private windBearing = 270;
  private tempC = 15;
  private pressureHPa = 1013.25;
  private source: Source = 'steady';
  private profilePoints = 0;
  private realInfo: { levels: number; surfaceSpeed: number; surfaceFrom: number; stationT: number; stationP: number } | null = null;
  private busy = false;

  private readonly root: HTMLElement;
  private readonly srcChip: HTMLElement;
  private readonly srcSeg: Segmented<Source>;
  private readonly srcNote: HTMLElement;
  private readonly rose: HTMLCanvasElement;
  private readonly compHead: HTMLElement;
  private readonly compCross: HTMLElement;
  private readonly fWind: SliderField;
  private readonly fDir: SliderField;
  private readonly fTemp: SliderField;
  private readonly fPres: SliderField;
  private readonly chart: HTMLCanvasElement;
  private readonly chartNote: HTMLElement;
  private drawKey = '';

  constructor(
    private readonly service: BallisticsService,
    host: HTMLElement,
    /** Azimut de tiro vigente (componentes cara/cola y cruzado). */
    private readonly aimAzimuthDeg: () => number = () => 0,
  ) {
    this.root = host;
    host.textContent = '';

    this.srcChip = chip('Manual', 'muted', 'met-source');
    this.srcSeg = new Segmented<Source>([
      { value: 'steady', label: 'Constante', testid: 'met-steady', title: SOURCE_TEXT.steady },
      { value: 'profile', label: 'Cizalladura', testid: 'met-profile', title: SOURCE_TEXT.profile },
      { value: 'real', label: 'Meteo real', testid: 'met-real', title: SOURCE_TEXT.real },
    ], 'steady', { ariaLabel: 'Fuente meteorológica', testid: 'met-source-seg' });
    this.srcSeg.onChange = (s) => void this.selectSource(s);
    this.srcNote = h('p', { class: 'met-note' });

    this.rose = this.canvas(300, 168, 'wind-rose');
    this.compHead = h('span', { class: 'num' });
    this.compCross = h('span', { class: 'num' });

    this.fWind = new SliderField({ label: 'Viento', min: 0, max: 30, step: 0.5, value: this.windSpeed, unit: 'm/s', decimals: 1, testid: 'wx-wind', icon: 'wind' });
    this.fDir = new SliderField({ label: 'Dirección (desde)', min: 0, max: 6400, step: 10, value: 0, unit: 'mil', decimals: 0, testid: 'wx-dir', icon: 'arrowUp', wrap: true });
    this.fTemp = new SliderField({ label: 'Temperatura', min: -30, max: 45, step: 1, value: this.tempC, unit: '°C', testid: 'wx-temp', icon: 'thermometer' });
    this.fPres = new SliderField({ label: 'Presión (QNH)', min: 950, max: 1050, step: 0.5, value: this.pressureHPa, unit: 'hPa', decimals: 1, testid: 'wx-pres', icon: 'gauge' });
    for (const f of [this.fWind, this.fDir, this.fTemp, this.fPres]) f.el.classList.add('ua-slider--info');
    this.fWind.onInput = (v) => { this.windSpeed = v; this.applyWind(); };
    this.fDir.onInput = (v) => {
      this.windBearing = ((fromUnit(v, settings.angleUnit) % 360) + 360) % 360;
      this.applyWind();
    };
    this.fTemp.onInput = (v) => { this.tempC = v; this.applyAtmo(); };
    this.fPres.onInput = (v) => { this.pressureHPa = v; this.applyAtmo(); };

    this.chart = this.canvas(300, 150, 'wind-profile');
    this.chartNote = h('p', { class: 'met-note' });

    host.append(
      RightDock.header('Meteorología', this.srcChip),
      h('div', { class: 'rpanel-body' },
        h('div', { class: 'ua-field' }, h('span', { class: 'ua-field__label', text: 'Fuente MET', dataset: { gloss: 'met' } }), this.srcSeg.el, this.srcNote),
        h('div', { class: 'met-rose' },
          this.rose,
          h('div', { class: 'met-comp' },
            h('div', { class: 'met-comp__item' }, h('span', { class: 'ua-eyebrow', text: 'Cara / cola' }), this.compHead),
            h('div', { class: 'met-comp__item' }, h('span', { class: 'ua-eyebrow', text: 'Cruzado' }), this.compCross),
          ),
        ),
        h('div', { class: 'rpanel-group' }, this.fWind.el, this.fDir.el),
        h('div', { class: 'rpanel-group' }, this.fTemp.el, this.fPres.el),
        h('div', { class: 'rpanel-section' },
          h('div', { class: 'rpanel-section__head' }, h('span', { class: 'ua-eyebrow', text: 'Perfil vertical del viento', dataset: { gloss: 'cizalladura' } })),
          this.chart,
          this.chartNote,
        ),
      ),
    );

    settings.subscribe((_s, changed) => {
      if (changed.includes('angleUnit')) {
        this.configureDir();
        this.drawKey = '';
        this.render();
      }
    });
    this.configureDir();
    this.service.setSteadyWind(this.windSpeed, this.windBearing);
    this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
    this.reflectSource();
    this.render();
  }

  private canvas(w: number, hgt: number, testid: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w * DPR;
    c.height = hgt * DPR;
    c.style.width = '100%';
    c.style.maxWidth = `${w}px`;
    c.style.aspectRatio = `${w} / ${hgt}`;
    c.dataset.testid = testid;
    return c;
  }

  private configureDir(): void {
    const u: AngleUnit = settings.angleUnit;
    this.fDir.configure({ min: 0, max: u === 'mil' ? 6400 : 360, step: u === 'mil' ? 10 : 1, unit: UNIT_SUFFIX[u], decimals: 0 });
    this.fDir.set(toUnit(this.windBearing, u));
  }

  // -- Fuentes ------------------------------------------------------------------
  private async selectSource(s: Source): Promise<void> {
    if (s === 'steady') {
      this.source = 'steady';
      this.service.setSteadyWind(this.windSpeed, this.windBearing);
      this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
      this.reflectSource();
      this.onChange?.();
    } else if (s === 'profile') {
      await this.loadShearProfile();
    } else {
      await this.loadRealWeather(false);
    }
  }

  /** P-PRO.2 — la batería se movió: re-consulta SOLO si el modo real sigue activo. */
  onBatteryMoved(): void {
    if (this.source === 'real') void this.loadRealWeather(true);
  }

  /** Devuelve si la meteo real quedó instalada (false = seguimos como antes). */
  private async loadRealWeather(silent: boolean): Promise<boolean> {
    const frame = this.service.frame;
    const prev = this.source;
    this.setBusy(true);
    try {
      const wx = await fetchOpenMeteo(frame.lonDeg, frame.latDeg, frame.heightM);
      this.service.setWindProfile(wx.profile);
      this.service.setSeaLevelConditions(wx.seaLevelTempK, wx.seaLevelPressurePa);
      this.source = 'real';
      const surface = wx.levels[0];
      this.realInfo = {
        levels: wx.levels.length,
        surfaceSpeed: surface?.speedMS ?? 0,
        surfaceFrom: surface?.fromBearingDeg ?? 0,
        stationT: wx.stationTempC,
        stationP: wx.stationPressureHPa,
      };
      // Los controles enseñan lo instalado (sin aplicarlo: tocarlos sale del real).
      this.windSpeed = Math.round((surface?.speedMS ?? 0) * 2) / 2;
      this.windBearing = surface?.fromBearingDeg ?? this.windBearing;
      this.tempC = Math.round(wx.seaLevelTempK - 273.15);
      this.pressureHPa = Math.round((wx.seaLevelPressurePa / 100) * 2) / 2;
      this.fWind.set(this.windSpeed);
      this.fDir.set(toUnit(this.windBearing, settings.angleUnit));
      this.fTemp.set(this.tempC);
      this.fPres.set(this.pressureHPa);
      this.reflectSource();
      if (!silent) {
        toast(`Meteo real instalada: ${wx.levels.length} niveles de viento (${wx.levels.map((l) => l.hPa).join('/')} hPa)`, { level: 'success' });
      }
      this.onChange?.();
      return true;
    } catch (err) {
      console.error('[open-meteo]', err);
      toast('Sin meteo real (¿red?) — se mantiene la fuente anterior', { level: 'error' });
      this.source = prev;
      this.reflectSource();
      return false;
    } finally {
      this.setBusy(false);
    }
  }

  private async loadShearProfile(): Promise<void> {
    const prev = this.source;
    try {
      const res = await fetch('/data/wind_shear_example.csv');
      const points = Atmosphere.windProfileFromCSV(await res.text());
      if (points.length === 0) throw new Error('CSV vacío');
      this.service.setWindProfile(points);
      this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
      this.source = 'profile';
      this.profilePoints = points.length;
      this.reflectSource();
      this.onChange?.();
    } catch (err) {
      console.error(err);
      toast('No se pudo cargar el perfil de viento de ejemplo', { level: 'error' });
      this.source = prev;
      this.reflectSource();
    }
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.srcSeg.setDisabled(b);
    if (b) {
      setChip(this.srcChip, 'Consultando', 'info');
      setText(this.srcNote, 'Consultando Open-Meteo para la posición de la batería…');
    }
  }

  private reflectSource(): void {
    this.srcSeg.set(this.source);
    if (this.busy) return;
    const s = this.source;
    if (s === 'real' && this.realInfo) {
      setChip(this.srcChip, 'Real', 'ok');
      setText(this.srcNote, `Open-Meteo · ${this.realInfo.levels} niveles · estación ${this.realInfo.stationT.toFixed(1)} °C / ${this.realInfo.stationP.toFixed(0)} hPa. Mover un control vuelve a manual.`);
    } else if (s === 'profile') {
      setChip(this.srcChip, 'Perfil', 'accent');
      setText(this.srcNote, `${SOURCE_TEXT.profile} ${this.profilePoints} niveles. Mover el viento vuelve a constante.`);
    } else {
      setChip(this.srcChip, 'Manual', 'muted');
      setText(this.srcNote, SOURCE_TEXT.steady);
    }
    this.root.dataset.source = s;
    this.drawKey = '';
    this.render();
  }

  // -- Manual ---------------------------------------------------------------------
  private applyWind(): void {
    // El usuario retoma el viento manual: fuera perfil/meteo real.
    this.source = 'steady';
    this.realInfo = null;
    this.service.setSteadyWind(this.windSpeed, this.windBearing);
    this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
    this.reflectSource();
    this.onChange?.();
  }

  private applyAtmo(): void {
    if (this.source === 'real') {
      // Salir del real por T/P también suelta SU perfil de viento: si quedara
      // instalado, el viento manual sería un no-op silencioso.
      this.source = 'steady';
      this.realInfo = null;
      this.service.setSteadyWind(this.windSpeed, this.windBearing);
      this.reflectSource();
    }
    this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
    this.drawKey = '';
    this.onChange?.();
  }

  // -- P-VIVO.10 — estado serializable (compartir por URL + sesión) ----------
  getState(): { real: boolean; ws: number; wb: number; t: number; p: number } {
    return {
      real: this.source === 'real',
      ws: this.windSpeed,
      wb: this.windBearing,
      t: this.tempC,
      p: this.pressureHPa,
    };
  }

  /** Restaura meteo manual. Los valores llegan de un enlace externo: se
   *  acotan a los rangos de los controles (una presión negativa haría NaN
   *  toda la atmósfera). */
  applyManual(ws: number, wb: number, t: number, p: number): void {
    const clamp = (v: number, lo: number, hi: number) =>
      Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
    this.windSpeed = clamp(ws, 0, 30);
    this.windBearing = ((clamp(wb, -360, 720) % 360) + 360) % 360;
    this.tempC = clamp(t, -30, 45);
    this.pressureHPa = clamp(p, 950, 1050);
    this.fWind.set(this.windSpeed);
    this.fDir.set(toUnit(this.windBearing, settings.angleUnit));
    this.fTemp.set(this.tempC);
    this.fPres.set(this.pressureHPa);
    this.source = 'steady';
    this.realInfo = null;
    this.service.setSteadyWind(this.windSpeed, this.windBearing);
    this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
    this.reflectSource();
    this.onChange?.();
  }

  /** Restaura el modo de meteo REAL (re-consulta Open-Meteo aquí y ahora).
   *  Rechaza si no se pudo. */
  async applyReal(): Promise<void> {
    const ok = await this.loadRealWeather(true);
    if (!ok) throw new Error('open-meteo no disponible');
  }

  /** Resumen para el chip MET de la barra superior. */
  summary(): MetSummary {
    if (this.source === 'real' && this.realInfo) {
      return {
        source: 'real',
        windSpeedMS: this.realInfo.surfaceSpeed,
        windFromDeg: this.realInfo.surfaceFrom,
        tempC: this.realInfo.stationT,
        pressureHPa: this.realInfo.stationP,
      };
    }
    const w = this.windAt(10);
    return {
      source: this.source === 'profile' ? 'profile' : 'manual',
      windSpeedMS: w.speed,
      windFromDeg: w.fromDeg,
      tempC: this.tempC,
      pressureHPa: this.pressureHPa,
    };
  }

  /** Viento del solver a una altura ENU (m sobre la batería). */
  private windAt(z: number): { speed: number; fromDeg: number; v: Vec3 } {
    const v = this.service.atmo.windAt(new Vec3(0, 0, z), 0);
    const speed = Math.hypot(v.x, v.y);
    // En calma la dirección no existe: se muestra la configurada.
    const fromDeg = speed < 0.05
      ? this.windBearing
      : (((Math.atan2(-v.x, -v.y) * 180) / Math.PI) + 360) % 360;
    return { speed, fromDeg, v };
  }

  // -- Pintado (llamar ≈4 Hz: solo repinta si algo cambió) ----------------------
  render(): void {
    const az = this.aimAzimuthDeg();
    const key = `${this.source}|${this.windSpeed}|${this.windBearing}|${this.tempC}|${this.pressureHPa}|${az.toFixed(2)}|${settings.angleUnit}|${this.profilePoints}|${this.realInfo?.levels ?? 0}`;
    if (key === this.drawKey) return;
    this.drawKey = key;
    this.drawRose(az);
    this.drawProfile();
  }

  private drawRose(azDeg: number): void {
    const ctx = this.rose.getContext('2d')!;
    const Wc = this.rose.width;
    const Hc = this.rose.height;
    ctx.clearRect(0, 0, Wc, Hc);
    const cx = Wc / 2;
    const cy = Hc / 2;
    const R = Hc / 2 - 8 * DPR;
    const surf = this.windAt(10);

    // Pozo + anillos.
    ctx.fillStyle = COL.well;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.edge;
    ctx.lineWidth = DPR;
    ctx.stroke();
    ctx.strokeStyle = COL.grid;
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let a = 0; a < 360; a += 10) {
      const rad = ((a - 90) * Math.PI) / 180;
      const major = a % 90 === 0;
      const len = (major ? 8 : a % 30 === 0 ? 5 : 3) * DPR;
      ctx.strokeStyle = major ? 'rgba(163,175,187,0.7)' : COL.grid;
      ctx.beginPath();
      ctx.moveTo(cx + (R - len) * Math.cos(rad), cy + (R - len) * Math.sin(rad));
      ctx.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
      ctx.stroke();
    }
    ctx.font = `600 ${10 * DPR}px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [l, a] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]] as const) {
      const rad = ((a - 90) * Math.PI) / 180;
      const r = R + (a === 90 || a === 270 ? 9 : 0) * DPR;
      ctx.fillStyle = l === 'N' ? COL.info : COL.dim2;
      if (a === 0) ctx.fillText(l, cx, cy - R - 0.5 * DPR + 9 * DPR);
      else if (a === 180) ctx.fillText(l, cx, cy + R - 9 * DPR);
      else ctx.fillText(l, cx + r * Math.cos(rad), cy + r * Math.sin(rad));
    }

    // Línea de tiro (ámbar, punteada).
    const azRad = ((azDeg - 90) * Math.PI) / 180;
    ctx.setLineDash([4 * DPR, 4 * DPR]);
    ctx.strokeStyle = 'rgba(245,165,36,0.7)';
    ctx.lineWidth = 1.5 * DPR;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (R - 2 * DPR) * Math.cos(azRad), cy + (R - 2 * DPR) * Math.sin(azRad));
    ctx.stroke();
    ctx.setLineDash([]);

    // Flecha del viento: entra DESDE la dirección de origen y apunta hacia
    // donde sopla. Longitud ∝ velocidad (satura a 25 m/s).
    if (surf.speed > 0.05) {
      const toRad = (((surf.fromDeg + 180) % 360) - 90) * Math.PI / 180;
      const len = Math.min(1, surf.speed / 25) * (R * 0.9) + R * 0.1;
      const x0 = cx - Math.cos(toRad) * len * 0.5;
      const y0 = cy - Math.sin(toRad) * len * 0.5;
      const x1 = cx + Math.cos(toRad) * len * 0.5;
      const y1 = cy + Math.sin(toRad) * len * 0.5;
      ctx.strokeStyle = COL.info;
      ctx.fillStyle = COL.info;
      ctx.lineWidth = 2.4 * DPR;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ah = 8 * DPR;
      ctx.beginPath();
      ctx.moveTo(x1 + Math.cos(toRad) * 2 * DPR, y1 + Math.sin(toRad) * 2 * DPR);
      ctx.lineTo(x1 - Math.cos(toRad - 0.45) * ah, y1 - Math.sin(toRad - 0.45) * ah);
      ctx.lineTo(x1 - Math.cos(toRad + 0.45) * ah, y1 - Math.sin(toRad + 0.45) * ah);
      ctx.closePath();
      ctx.fill();
    }

    // Lecturas a los lados.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COL.dim;
    ctx.font = `600 ${9 * DPR}px ${FONT_DISPLAY}`;
    ctx.fillText('VIENTO · 10 m', 6 * DPR, 18 * DPR);
    ctx.fillStyle = COL.text;
    ctx.font = `500 ${18 * DPR}px ${FONT_MONO}`;
    ctx.fillText(surf.speed.toFixed(1), 6 * DPR, 40 * DPR);
    ctx.fillStyle = COL.dim;
    ctx.font = `500 ${10 * DPR}px ${FONT_MONO}`;
    ctx.fillText('m/s', 6 * DPR, 54 * DPR);
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.dim;
    ctx.font = `600 ${9 * DPR}px ${FONT_DISPLAY}`;
    ctx.fillText('DESDE', Wc - 6 * DPR, 18 * DPR);
    ctx.fillStyle = COL.text;
    ctx.font = `500 ${15 * DPR}px ${FONT_MONO}`;
    ctx.fillText(fmtAngle(surf.fromDeg, settings.angleUnit, 0).replace(' mil', '').replace(' ', ''), Wc - 6 * DPR, 38 * DPR);
    ctx.fillStyle = COL.dim;
    ctx.font = `500 ${10 * DPR}px ${FONT_MONO}`;
    ctx.fillText(settings.angleUnit === 'mil' ? 'mil' : 'grados', Wc - 6 * DPR, 52 * DPR);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(245,165,36,0.85)';
    ctx.font = `600 ${9 * DPR}px ${FONT_DISPLAY}`;
    ctx.fillText('— LÍNEA DE TIRO', 6 * DPR, Hc - 8 * DPR);

    // Componentes respecto a la línea de tiro.
    const ux = Math.sin((azDeg * Math.PI) / 180);
    const uy = Math.cos((azDeg * Math.PI) / 180);
    const tail = surf.v.x * ux + surf.v.y * uy;
    const cross = surf.v.x * uy - surf.v.y * ux; // + = empuja a la derecha
    setText(this.compHead, surf.speed < 0.05 ? 'En calma' : `${Math.abs(tail).toFixed(1)} m/s ${tail >= 0 ? 'a favor (cola)' : 'en contra (cara)'}`);
    setText(this.compCross, surf.speed < 0.05 ? '—' : `${Math.abs(cross).toFixed(1)} m/s hacia la ${cross >= 0 ? 'derecha' : 'izquierda'}`);
  }

  private drawProfile(): void {
    const ctx = this.chart.getContext('2d')!;
    const Wc = this.chart.width;
    const Hc = this.chart.height;
    ctx.clearRect(0, 0, Wc, Hc);
    const padL = 34 * DPR;
    const padR = 10 * DPR;
    const padT = 8 * DPR;
    const padB = 20 * DPR;
    const zMax = 12000;
    const samples: { z: number; speed: number; from: number }[] = [];
    for (let z = 0; z <= zMax; z += 250) {
      const w = this.windAt(z);
      samples.push({ z, speed: w.speed, from: w.fromDeg });
    }
    const sMax = Math.max(10, Math.ceil(Math.max(...samples.map((s) => s.speed)) / 5) * 5);
    const X = (s: number) => padL + (s / sMax) * (Wc - padL - padR);
    const Y = (z: number) => Hc - padB - (z / zMax) * (Hc - padT - padB);

    // Rejilla.
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = DPR;
    ctx.font = `500 ${9 * DPR}px ${FONT_MONO}`;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let z = 0; z <= zMax; z += 3000) {
      ctx.beginPath();
      ctx.moveTo(padL, Y(z));
      ctx.lineTo(Wc - padR, Y(z));
      ctx.stroke();
      ctx.fillText(`${z / 1000} km`, padL - 6 * DPR, Y(z));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= sMax; s += sMax / 4) {
      ctx.beginPath();
      ctx.moveTo(X(s), padT);
      ctx.lineTo(X(s), Hc - padB);
      ctx.stroke();
      ctx.fillText(s.toFixed(0), X(s), Hc - padB + 5 * DPR);
    }
    ctx.textAlign = 'right';
    ctx.fillText('m/s', Wc - padR, Hc - padB + 5 * DPR);

    // Curva de velocidad (área + línea).
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (const s of samples) ctx.lineTo(X(s.speed), Y(s.z));
    ctx.lineTo(X(0), Y(zMax));
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.12)';
    ctx.fill();
    ctx.beginPath();
    samples.forEach((s, i) => (i === 0 ? ctx.moveTo(X(s.speed), Y(s.z)) : ctx.lineTo(X(s.speed), Y(s.z))));
    ctx.strokeStyle = COL.info;
    ctx.lineWidth = 1.8 * DPR;
    ctx.stroke();

    // Flechas de dirección cada 2 km (hacia donde sopla).
    for (let z = 1000; z <= zMax; z += 2000) {
      const w = this.windAt(z);
      if (w.speed < 0.2) continue;
      const toRad = ((((w.fromDeg + 180) % 360) - 90) * Math.PI) / 180;
      const x = X(w.speed);
      const y = Y(z);
      const l = 7 * DPR;
      ctx.strokeStyle = COL.text;
      ctx.lineWidth = 1.4 * DPR;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(toRad) * l, y - Math.sin(toRad) * l);
      ctx.lineTo(x + Math.cos(toRad) * l, y + Math.sin(toRad) * l);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(toRad) * l, y + Math.sin(toRad) * l);
      ctx.lineTo(x + Math.cos(toRad) * l - Math.cos(toRad - 0.5) * 4 * DPR, y + Math.sin(toRad) * l - Math.sin(toRad - 0.5) * 4 * DPR);
      ctx.moveTo(x + Math.cos(toRad) * l, y + Math.sin(toRad) * l);
      ctx.lineTo(x + Math.cos(toRad) * l - Math.cos(toRad + 0.5) * 4 * DPR, y + Math.sin(toRad) * l - Math.sin(toRad + 0.5) * 4 * DPR);
      ctx.stroke();
    }
    const top = samples[samples.length - 1];
    setText(this.chartNote, `Lo que integra el solver: ${samples[0].speed.toFixed(1)} m/s en superficie → ${top.speed.toFixed(1)} m/s a 12 km (desde ${fmtAngle(top.from, settings.angleUnit, 0)}).`);
  }
}
