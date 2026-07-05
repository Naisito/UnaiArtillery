// ============================================================================
//  ControlPanel.ts — Consola de tiro.  [P-WEB.4]
//
//  Selección de arma/carga, puntería por azimut/elevación o por clic en el
//  globo (rama alta/baja), previsualización, FUEGO, salva MRSI (P2.2), modo
//  comparación (P4.2), reubicación de la batería y modos de cámara.
// ============================================================================
import { Weapon, WeaponCatalog, WeaponId } from '../ballistics';
import type { CameraMode } from '../CameraDirector';

export interface ControlCallbacks {
  onAimChanged(): void;
  onWeaponChanged(): void;
  onFire(): void;
  onMRSI(rounds: number): void;
  onCompare(): void;
  onCameraMode(mode: CameraMode): void;
  onPickTarget(active: boolean): void;
  onMoveBattery(active: boolean): void;
}

const WEAPON_LABELS: Record<WeaponId, string> = {
  mortar120: '120 mm Mortero pesado',
  m777: 'M777 · Obús 155 mm',
  gmlrs: 'HIMARS / GMLRS 227 mm',
  tacticalMissile: 'Misil balístico táctico',
};

export class ControlPanel {
  weaponId: WeaponId = 'm777';
  chargeIndex = 3;
  azimuthDeg = 90;
  elevationDeg = 45;
  preferHighAngle = false;

  private chargeSelect!: HTMLSelectElement;
  private azInput!: HTMLInputElement;
  private azOut!: HTMLOutputElement;
  private elInput!: HTMLInputElement;
  private elOut!: HTMLOutputElement;
  private solutionEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private fireBtn!: HTMLButtonElement;
  private pickBtn!: HTMLButtonElement;
  private batteryBtn!: HTMLButtonElement;
  private cameraBtns = new Map<CameraMode, HTMLButtonElement>();

  constructor(private readonly cb: ControlCallbacks) {
    const el = document.getElementById('controlPanel')!;
    el.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = 'Unai Artillery';
    el.appendChild(title);

    // -- Arma y carga --------------------------------------------------------
    const weaponSel = document.createElement('select');
    for (const id of WeaponCatalog.ids()) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = WEAPON_LABELS[id];
      weaponSel.appendChild(opt);
    }
    weaponSel.value = this.weaponId;
    weaponSel.onchange = () => {
      this.weaponId = weaponSel.value as WeaponId;
      this.rebuildCharges();
      this.applyWeaponLimits();
      this.cb.onWeaponChanged();
    };
    el.appendChild(weaponSel);

    this.chargeSelect = document.createElement('select');
    this.chargeSelect.onchange = () => {
      this.chargeIndex = Number(this.chargeSelect.value);
      this.cb.onAimChanged();
    };
    el.appendChild(this.chargeSelect);

    // -- Puntería ------------------------------------------------------------
    const h3 = document.createElement('h3');
    h3.textContent = 'Puntería';
    el.appendChild(h3);

    const azRow = document.createElement('div');
    azRow.className = 'row';
    const azLab = document.createElement('label');
    azLab.textContent = 'Azimut';
    this.azInput = document.createElement('input');
    this.azInput.type = 'range';
    this.azInput.min = '0';
    this.azInput.max = '359';
    this.azInput.step = '0.5';
    this.azInput.value = String(this.azimuthDeg);
    this.azOut = document.createElement('output');
    this.azInput.oninput = () => {
      this.azimuthDeg = Number(this.azInput.value);
      this.azOut.textContent = `${this.azimuthDeg.toFixed(1)}º`;
      this.cb.onAimChanged();
    };
    azRow.append(azLab, this.azInput, this.azOut);
    el.appendChild(azRow);

    const elRow = document.createElement('div');
    elRow.className = 'row';
    const elLab = document.createElement('label');
    elLab.textContent = 'Elevación';
    this.elInput = document.createElement('input');
    this.elInput.type = 'range';
    this.elInput.step = '0.1';
    this.elOut = document.createElement('output');
    this.elInput.oninput = () => {
      this.elevationDeg = Number(this.elInput.value);
      this.elOut.textContent = `${this.elevationDeg.toFixed(1)}º`;
      this.cb.onAimChanged();
    };
    elRow.append(elLab, this.elInput, this.elOut);
    el.appendChild(elRow);

    const highRow = document.createElement('div');
    highRow.className = 'row';
    const highLab = document.createElement('label');
    highLab.textContent = 'Rama alta (morterazo)';
    const high = document.createElement('input');
    high.type = 'checkbox';
    high.onchange = () => {
      this.preferHighAngle = high.checked;
      this.cb.onAimChanged();
    };
    highRow.append(highLab, high);
    el.appendChild(highRow);

    // -- Acciones ------------------------------------------------------------
    const grid = document.createElement('div');
    grid.className = 'btn-grid';

    this.pickBtn = document.createElement('button');
    this.pickBtn.textContent = '🎯 Objetivo (clic)';
    this.pickBtn.onclick = () => {
      const active = !this.pickBtn.classList.contains('toggled');
      this.setPickActive(active);
      if (active) this.setBatteryActive(false);
      this.cb.onPickTarget(active);
    };

    this.batteryBtn = document.createElement('button');
    this.batteryBtn.textContent = '📍 Mover batería';
    this.batteryBtn.onclick = () => {
      const active = !this.batteryBtn.classList.contains('toggled');
      this.setBatteryActive(active);
      if (active) this.setPickActive(false);
      this.cb.onMoveBattery(active);
    };

    const mrsi = document.createElement('button');
    mrsi.textContent = 'Salva MRSI ×3';
    mrsi.title = 'Varias rondas a distinta elevación/carga que impactan a la vez';
    mrsi.onclick = () => this.cb.onMRSI(3);

    const compare = document.createElement('button');
    compare.textContent = 'Comparar físicas';
    compare.title = 'Vacío vs arrastre vs Coriolis vs viento (didáctico)';
    compare.onclick = () => this.cb.onCompare();

    grid.append(this.pickBtn, this.batteryBtn, mrsi, compare);
    el.appendChild(grid);

    this.fireBtn = document.createElement('button');
    this.fireBtn.className = 'fire';
    this.fireBtn.textContent = 'Fuego';
    this.fireBtn.onclick = () => this.cb.onFire();
    el.appendChild(this.fireBtn);

    this.solutionEl = document.createElement('p');
    this.solutionEl.className = 'hint readout';
    el.appendChild(this.solutionEl);

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'hint';
    this.statusEl.textContent = 'Ajusta la puntería o marca un objetivo con 🎯.';
    el.appendChild(this.statusEl);

    // -- Cámara --------------------------------------------------------------
    const camH = document.createElement('h3');
    camH.textContent = 'Cámara';
    el.appendChild(camH);
    const camGrid = document.createElement('div');
    camGrid.className = 'btn-grid';
    const modes: [CameraMode, string][] = [
      ['free', 'Libre'], ['orbital', 'Orbital'], ['follow', 'Seguir'], ['drone', 'Dron'],
    ];
    for (const [mode, label] of modes) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        this.markCamera(mode);
        this.cb.onCameraMode(mode);
      };
      this.cameraBtns.set(mode, b);
      camGrid.appendChild(b);
    }
    el.appendChild(camGrid);
    this.markCamera('free');

    this.rebuildCharges();
    this.applyWeaponLimits();
  }

  weapon(): Weapon { return WeaponCatalog.get(this.weaponId); }

  private rebuildCharges(): void {
    const w = this.weapon();
    this.chargeSelect.innerHTML = '';
    if (w.charges.length === 0) {
      const opt = document.createElement('option');
      opt.value = '-1';
      opt.textContent = w.category === 'Rocket' ? 'Motor cohete (fijo)' : 'Carga única';
      this.chargeSelect.appendChild(opt);
      this.chargeIndex = -1;
    } else {
      w.charges.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${c.name} · ${c.muzzleVelocity} m/s`;
        this.chargeSelect.appendChild(opt);
      });
      this.chargeIndex = w.charges.length - 1;
      this.chargeSelect.value = String(this.chargeIndex);
    }
  }

  private applyWeaponLimits(): void {
    const w = this.weapon();
    this.elInput.min = String(w.minElevationDeg);
    this.elInput.max = String(w.maxElevationDeg);
    this.elevationDeg = Math.min(
      Math.max(this.elevationDeg, w.minElevationDeg), w.maxElevationDeg,
    );
    this.elInput.value = String(this.elevationDeg);
    this.elOut.textContent = `${this.elevationDeg.toFixed(1)}º`;
    this.azOut.textContent = `${this.azimuthDeg.toFixed(1)}º`;
  }

  /** Fija az/el desde una solución de tiro (clic en objetivo). */
  setAim(azimuthDeg: number, elevationDeg: number): void {
    this.azimuthDeg = ((azimuthDeg % 360) + 360) % 360;
    this.elevationDeg = elevationDeg;
    this.azInput.value = String(this.azimuthDeg);
    this.elInput.value = String(this.elevationDeg);
    this.azOut.textContent = `${this.azimuthDeg.toFixed(1)}º`;
    this.elOut.textContent = `${this.elevationDeg.toFixed(1)}º`;
  }

  setSolution(text: string): void { this.solutionEl.textContent = text; }
  setStatus(text: string): void { this.statusEl.textContent = text; }
  setFiring(busy: boolean): void { this.fireBtn.disabled = busy; }
  setPickActive(active: boolean): void { this.pickBtn.classList.toggle('toggled', active); }
  setBatteryActive(active: boolean): void { this.batteryBtn.classList.toggle('toggled', active); }

  markCamera(mode: CameraMode): void {
    for (const [m, b] of this.cameraBtns) b.classList.toggle('toggled', m === mode);
  }
}
