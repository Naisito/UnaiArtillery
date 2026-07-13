// ============================================================================
//  Weather.ts — Panel de meteorología en vivo.  [P-WEB.7 / P1.7 / P-PRO.2]
//
//  Viento (velocidad + rumbo), temperatura y presión a nivel del mar. Todo
//  recalcula la física en vivo (el arco de preview se rehace al soltar).
//  El botón de cizalladura carga el perfil por altitud de ejemplo (P1.7) y
//  "🌍 Meteo real" instala la atmósfera de Open-Meteo aquí y ahora (P-PRO.2):
//  perfil de viento por niveles de presión + T/P reducidas al nivel del mar.
//  Tocar cualquier control manual desactiva el modo real.
// ============================================================================
import { Atmosphere } from '../ballistics';
import { BallisticsService } from '../BallisticsService';
import { fetchOpenMeteo } from './openMeteo';
import { toast } from './toast';

export class WeatherPanel {
  /** Notifica cambios (la pieza re-previsualiza). */
  onChange?: () => void;

  private windSpeed = 0;
  private windBearing = 270;
  private tempC = 15;
  private pressureHPa = 1013.25;
  private profileActive = false;
  /** P-PRO.2 — la meteo real manda hasta que el usuario toque algo manual. */
  private realActive = false;
  private realBtn!: HTMLButtonElement;
  private modeLabel!: HTMLElement;
  private root!: HTMLElement;
  /** P-VIVO.10 — refs de los sliders para poder restaurar un estado. */
  private readonly inputs = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; unit: string }>();

  constructor(private readonly service: BallisticsService) {
    const el = document.getElementById('weatherPanel')!;
    this.root = el;
    el.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = 'Meteorología';
    el.appendChild(h);

    this.modeLabel = document.createElement('p');
    this.modeLabel.className = 'hint';
    el.appendChild(this.modeLabel);

    el.appendChild(this.slider('Viento', 0, 30, 1, this.windSpeed, 'm/s', (v) => {
      this.windSpeed = v;
      this.applyWind();
    }, 'wind'));
    el.appendChild(this.slider('Rumbo (desde)', 0, 355, 5, this.windBearing, 'º', (v) => {
      this.windBearing = v;
      this.applyWind();
    }, 'bearing'));
    el.appendChild(this.slider('Temperatura', -20, 40, 1, this.tempC, 'ºC', (v) => {
      this.tempC = v;
      this.applyAtmo();
    }, 'temp'));
    el.appendChild(this.slider('Presión', 950, 1050, 1, this.pressureHPa, 'hPa', (v) => {
      this.pressureHPa = v;
      this.applyAtmo();
    }, 'pressure'));

    const btns = document.createElement('div');
    btns.className = 'btn-grid';
    const shear = document.createElement('button');
    shear.textContent = 'Perfil con cizalladura';
    shear.title = 'Carga el perfil por altitud de ejemplo (viento que rota y arrecia)';
    shear.onclick = () => {
      this.realActive = false;
      this.realBtn.classList.remove('toggled');
      void this.loadShearProfile();
    };
    const steady = document.createElement('button');
    steady.textContent = 'Viento constante';
    steady.onclick = () => {
      this.realActive = false;
      this.realBtn.classList.remove('toggled');
      this.profileActive = false;
      this.applyWind();
    };
    btns.append(shear, steady);

    // P-PRO.2 — atmósfera real de la posición de la batería, ahora mismo.
    this.realBtn = document.createElement('button');
    this.realBtn.className = 'wide';
    this.realBtn.textContent = '🌍 Meteo real (aquí y ahora)';
    this.realBtn.title =
      'Open-Meteo: viento por niveles de presión (1000→200 hPa) + T/P reales de la batería';
    this.realBtn.onclick = () => void this.loadRealWeather(false);
    btns.appendChild(this.realBtn);
    el.appendChild(btns);

    this.applyWind();
    this.applyAtmo();
  }

  /** P-PRO.2 — la batería se movió: re-consulta SOLO si el modo real sigue activo. */
  onBatteryMoved(): void {
    if (this.realActive) void this.loadRealWeather(true);
  }

  /**
   * Barra de FOV bajo la meteorología. La cámara es de Cesium (no asunto de
   * la meteo), así que main.ts inyecta los accesores; tocarla NO desactiva el
   * modo de meteo real — es puramente visual.
   */
  addFovControl(getDeg: () => number, setDeg: (deg: number) => void): void {
    const h = document.createElement('h3');
    h.textContent = 'Vista';
    this.root.appendChild(h);
    this.root.appendChild(
      this.slider('FOV', 20, 120, 1, Math.round(getDeg()), 'º', (v) => setDeg(v)),
    );
  }

  /** Devuelve si la meteo real quedó instalada (false = seguimos en manual). */
  private async loadRealWeather(silent: boolean): Promise<boolean> {
    const frame = this.service.frame;
    this.realBtn.disabled = true;
    try {
      const wx = await fetchOpenMeteo(frame.lonDeg, frame.latDeg, frame.heightM);
      this.service.setWindProfile(wx.profile);
      this.service.setSeaLevelConditions(wx.seaLevelTempK, wx.seaLevelPressurePa);
      this.profileActive = true;
      this.realActive = true;
      this.realBtn.classList.add('toggled');

      // Resumen: niveles cargados + condiciones de la estación.
      const mid = wx.levels.find((l) => l.hPa === 850) ?? wx.levels[0];
      this.modeLabel.textContent =
        `Meteo real: ${wx.levels.length} niveles (${wx.levels.map((l) => l.hPa).join('/')} hPa) · ` +
        `${mid.hPa} hPa: ${mid.speedMS.toFixed(0)} m/s desde ${mid.fromBearingDeg.toFixed(0)}º · ` +
        `estación ${wx.stationTempC.toFixed(1)}ºC / ${wx.stationPressureHPa.toFixed(0)} hPa`;
      if (!silent) {
        toast(`Meteo real instalada: ${wx.levels.length} niveles de viento`);
      }
      this.onChange?.();
      return true;
    } catch (err) {
      console.error('[open-meteo]', err);
      toast('Sin meteo real (¿red?) — sigue el modo manual');
      return false;
    } finally {
      this.realBtn.disabled = false;
    }
  }

  private static sliderSeq = 0;

  private slider(
    label: string, min: number, max: number, step: number, value: number,
    unit: string, onInput: (v: number) => void, refKey?: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `wxSlider-${refKey ?? WeatherPanel.sliderSeq++}`;
    lab.htmlFor = input.id; // nombre accesible + el label responde al clic
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('output');
    out.textContent = `${value} ${unit}`;
    input.oninput = () => {
      out.textContent = `${input.value} ${unit}`;
      onInput(Number(input.value));
    };
    row.append(lab, input, out);
    if (refKey) this.inputs.set(refKey, { input, out, unit }); // P-VIVO.10
    return row;
  }

  // -- P-VIVO.10 — estado serializable (compartir por URL + sesión) ----------
  getState(): { real: boolean; ws: number; wb: number; t: number; p: number } {
    return {
      real: this.realActive,
      ws: this.windSpeed,
      wb: this.windBearing,
      t: this.tempC,
      p: this.pressureHPa,
    };
  }

  /** Restaura meteo manual (mueve sliders y aplica la física de una vez).
   *  Los valores llegan de un enlace externo: se acotan a los rangos de los
   *  sliders (una presión negativa haría NaN toda la atmósfera). */
  applyManual(ws: number, wb: number, t: number, p: number): void {
    const clamp = (v: number, lo: number, hi: number) =>
      Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
    ws = clamp(ws, 0, 30);
    wb = ((clamp(wb, -360, 720) % 360) + 360) % 360;
    t = clamp(t, -20, 40);
    p = clamp(p, 950, 1050);
    this.realActive = false;
    this.profileActive = false;
    this.realBtn.classList.remove('toggled');
    this.windSpeed = ws;
    this.windBearing = wb;
    this.tempC = t;
    this.pressureHPa = p;
    for (const [key, val] of [['wind', ws], ['bearing', wb], ['temp', t], ['pressure', p]] as const) {
      const ref = this.inputs.get(key);
      if (ref) {
        ref.input.value = String(val);
        ref.out.textContent = `${val} ${ref.unit}`;
      }
    }
    this.service.setSteadyWind(ws, wb);
    this.service.setSeaLevelConditions(t + 273.15, p * 100);
    this.modeLabel.textContent = 'Meteo restaurada del enlace/sesión (manual).';
    this.onChange?.();
  }

  /** Restaura el modo de meteo REAL (re-consulta Open-Meteo aquí y ahora).
   *  Rechaza si no se pudo (antes tragaba el error y el llamador de la
   *  restauración nunca se enteraba de que seguía en meteo por defecto). */
  async applyReal(): Promise<void> {
    const ok = await this.loadRealWeather(true);
    if (!ok) throw new Error('open-meteo no disponible');
  }

  private applyWind(): void {
    if (this.profileActive && !this.realActive) return; // el perfil de ejemplo manda
    if (this.realActive) {
      // El usuario retoma el control manual: fuera modo real.
      this.realActive = false;
      this.profileActive = false;
      this.realBtn.classList.remove('toggled');
    }
    this.service.setSteadyWind(this.windSpeed, this.windBearing);
    this.modeLabel.textContent = 'Viento constante (gana con la altitud, ×2 máx).';
    this.onChange?.();
  }

  private applyAtmo(): void {
    if (this.realActive) {
      // Salir del modo real por T/P también debe soltar SU perfil de viento:
      // si quedara instalado, los sliders de viento serían no-op silenciosos
      // (la UI enseñaría "25 m/s" mientras el solver usa el perfil real).
      this.realActive = false;
      this.profileActive = false;
      this.realBtn.classList.remove('toggled');
      this.service.setSteadyWind(this.windSpeed, this.windBearing);
      this.modeLabel.textContent = 'Manual (meteo real desactivada).';
    }
    this.service.setSeaLevelConditions(this.tempC + 273.15, this.pressureHPa * 100);
    this.onChange?.();
  }

  private async loadShearProfile(): Promise<void> {
    try {
      const res = await fetch('/data/wind_shear_example.csv');
      const points = Atmosphere.windProfileFromCSV(await res.text());
      if (points.length === 0) throw new Error('CSV vacío');
      this.service.setWindProfile(points);
      this.profileActive = true;
      this.modeLabel.textContent =
        `Perfil por altitud activo (${points.length} niveles, ` +
        `${points[0].speedMS}→${points[points.length - 1].speedMS} m/s).`;
      this.onChange?.();
    } catch (err) {
      console.error(err);
      toast('No se pudo cargar el perfil de viento de ejemplo');
    }
  }
}
