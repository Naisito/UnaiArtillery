// ============================================================================
//  Weather.ts — Panel de meteorología en vivo.  [P-WEB.7 / P1.7]
//
//  Viento (velocidad + rumbo), temperatura y presión a nivel del mar. Todo
//  recalcula la física en vivo (el arco de preview se rehace al soltar).
//  El botón de cizalladura carga el perfil por altitud de ejemplo (P1.7).
// ============================================================================
import { Atmosphere } from '../ballistics';
import { BallisticsService } from '../BallisticsService';
import { toast } from './toast';

export class WeatherPanel {
  /** Notifica cambios (la pieza re-previsualiza). */
  onChange?: () => void;

  private windSpeed = 0;
  private windBearing = 270;
  private tempC = 15;
  private pressureHPa = 1013.25;
  private profileActive = false;
  private modeLabel!: HTMLElement;

  constructor(private readonly service: BallisticsService) {
    const el = document.getElementById('weatherPanel')!;
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
    }));
    el.appendChild(this.slider('Rumbo (desde)', 0, 355, 5, this.windBearing, 'º', (v) => {
      this.windBearing = v;
      this.applyWind();
    }));
    el.appendChild(this.slider('Temperatura', -20, 40, 1, this.tempC, 'ºC', (v) => {
      this.tempC = v;
      this.applyAtmo();
    }));
    el.appendChild(this.slider('Presión', 950, 1050, 1, this.pressureHPa, 'hPa', (v) => {
      this.pressureHPa = v;
      this.applyAtmo();
    }));

    const btns = document.createElement('div');
    btns.className = 'btn-grid';
    const shear = document.createElement('button');
    shear.textContent = 'Perfil con cizalladura';
    shear.title = 'Carga el perfil por altitud de ejemplo (viento que rota y arrecia)';
    shear.onclick = () => void this.loadShearProfile();
    const steady = document.createElement('button');
    steady.textContent = 'Viento constante';
    steady.onclick = () => {
      this.profileActive = false;
      this.applyWind();
    };
    btns.append(shear, steady);
    el.appendChild(btns);

    this.applyWind();
    this.applyAtmo();
  }

  private slider(
    label: string, min: number, max: number, step: number, value: number,
    unit: string, onInput: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
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
    return row;
  }

  private applyWind(): void {
    if (this.profileActive) return; // el perfil manda hasta volver a constante
    this.service.setSteadyWind(this.windSpeed, this.windBearing);
    this.modeLabel.textContent = 'Viento constante (gana con la altitud, ×2 máx).';
    this.onChange?.();
  }

  private applyAtmo(): void {
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
