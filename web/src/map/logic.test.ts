// Tests del abanico, QE, atajos, símbolos y cámaras.  [V2:MAP]
import { describe, expect, it } from 'vitest';
import {
  arcPoints, curvatureDropZ, decimate, ellipsePoints, fanShape, intermediateRings,
  isSectorLimited, polar, ringStepM, updateSectorCenter,
} from './fanGeometry';
import { interpolateQe } from './qe';
import { RateGate, actionForKey, isEditableTarget, isStillClick } from './input';
import {
  aimpointSymbolSvg, framePath, symbolSpecForWeapon, unitSymbolSvg,
} from './symbols';
import {
  batteryFramingPose, impactOrbitPose, impactViewDistanceM, smoothAngleDeg,
  subjectSizeForCategory, viewAngles,
} from './cameraMath';
import type { FiringTableRow } from '../ballistics';

describe('abanico de tiro', () => {
  it('paso de anillos redondo y 3–8 anillos', () => {
    expect(ringStepM(7200)).toBe(1000);
    expect(ringStepM(30000)).toBe(5000);
    expect(ringStepM(300000)).toBe(50000);
    const rings = intermediateRings(3000, 30000);
    expect(rings).toEqual([5000, 10000, 15000, 20000, 25000]);
    expect(intermediateRings(0, 0)).toEqual([]);
  });

  it('el sector se mantiene mientras la puntería no sale de él', () => {
    expect(isSectorLimited(45)).toBe(true);
    expect(isSectorLimited(360)).toBe(false);
    let c = updateSectorCenter(null, 90, 45);
    expect(c).toBe(90);
    c = updateSectorCenter(c, 105, 45); // dentro (±22.5º)
    expect(c).toBe(90);
    c = updateSectorCenter(c, 120, 45); // fuera → re-emplazar
    expect(c).toBe(120);
    expect(updateSectorCenter(350, 5, 45)).toBe(350); // cruza el norte, dentro
    expect(updateSectorCenter(10, 200, 360)).toBe(200); // 360º sigue la puntería
  });

  it('arcos y sectores', () => {
    const a = arcPoints(1000, 80, 100);
    expect(a[0].x).toBeCloseTo(polar(1000, 80).x, 6);
    expect(a[a.length - 1].y).toBeCloseTo(polar(1000, 100).y, 6);
    const circle = arcPoints(500, 0, 0);
    expect(circle[0].x).toBeCloseTo(circle[circle.length - 1].x, 6);
    expect(circle.length).toBeGreaterThan(100);

    const sector = fanShape(2000, 20000, 45, 90);
    expect(sector.full).toBe(false);
    expect(sector.leftAzDeg).toBeCloseTo(67.5);
    expect(sector.rightAzDeg).toBeCloseTo(112.5);
    expect(sector.limits).not.toBeNull();
    // Relleno = arco exterior + arco interior invertido.
    expect(sector.fill.length).toBe(sector.outer.length + sector.inner!.length);

    const full = fanShape(0, 30000, 360, 0);
    expect(full.full).toBe(true);
    expect(full.inner).toBeNull();
  });

  it('caída por curvatura', () => {
    expect(curvatureDropZ(30_000)).toBeCloseTo(-70.6, 0);
  });

  it('elipse orientada por el rumbo', () => {
    const e = ellipsePoints({ x: 0, y: 1000 }, 90, 100, 20);
    // t=0 → semieje de alcance por el rumbo 90º (Este).
    expect(e[0].x).toBeCloseTo(100, 6);
    expect(e[0].y).toBeCloseTo(1000, 6);
    expect(e.length).toBe(73);
  });

  it('diezmado conserva extremos', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const d = decimate(pts, 50);
    expect(d.length).toBe(50);
    expect(d[0]).toBe(0);
    expect(d[49]).toBe(999);
  });
});

describe('QE desde la tabla de tiro', () => {
  const row = (r: number, lo: number | null, hi: number | null): FiringTableRow => ({
    rangeM: r, qeLowDeg: lo, tofLowS: lo === null ? null : r / 300, vImpactLowMS: null, driftLowM: null,
    qeHighDeg: hi, tofHighS: hi === null ? null : r / 150, vImpactHighMS: null, driftHighM: null,
  });
  const rows = [row(1000, 2, 80), row(2000, 4, 76), row(3000, 7, null)];

  it('interpola ambas ramas', () => {
    const q = interpolateQe(rows, 1500)!;
    expect(q.lowDeg).toBeCloseTo(3);
    expect(q.highDeg).toBeCloseTo(78);
    expect(q.tofLowS).toBeCloseTo(5);
  });

  it('una rama ausente se queda en null; fuera de tabla no se extrapola', () => {
    const q = interpolateQe(rows, 2500)!;
    expect(q.lowDeg).toBeCloseTo(5.5);
    expect(q.highDeg).toBeNull();
    expect(interpolateQe(rows, 500)).toBeNull();
    expect(interpolateQe(rows, 3500)).toBeNull();
    expect(interpolateQe([], 100)).toBeNull();
  });
});

describe('atajos y gestos', () => {
  it('letras del PLAN §3.5', () => {
    expect(actionForKey({ key: 't' })).toEqual({ kind: 'designate' });
    expect(actionForKey({ key: 'B' })).toEqual({ kind: 'battery' });
    expect(actionForKey({ key: 'm' })).toEqual({ kind: 'measure' });
    expect(actionForKey({ key: 'g' })).toEqual({ kind: 'grid' });
    expect(actionForKey({ key: 'l' })).toEqual({ kind: 'layers' });
    expect(actionForKey({ key: 'n' })).toEqual({ kind: 'northUp' });
    expect(actionForKey({ key: 'Home' })).toEqual({ kind: 'flyBattery' });
    expect(actionForKey({ key: 'Escape' })).toEqual({ kind: 'escape' });
    expect(actionForKey({ key: 'f' })).toBeNull(); // FUEGO es de la UI
  });

  it('cámaras 1–6 por código físico y sin modificadores', () => {
    expect(actionForKey({ key: '&', code: 'Digit1' })).toEqual({ kind: 'camera', mode: 'free' });
    expect(actionForKey({ key: '6', code: 'Numpad6' })).toEqual({ kind: 'camera', mode: 'fps' });
    expect(actionForKey({ key: '5' })).toEqual({ kind: 'camera', mode: 'cabin' });
    expect(actionForKey({ key: '7', code: 'Digit7' })).toBeNull();
    expect(actionForKey({ key: 't', ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: 't', repeat: true })).toBeNull();
  });

  it('campos editables', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableTarget({ tagName: 'select' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('clic derecho quieto frente a arrastre de zoom', () => {
    expect(isStillClick({ x: 10, y: 10, t: 0 }, { x: 13, y: 12, t: 200 })).toBe(true);
    expect(isStillClick({ x: 10, y: 10, t: 0 }, { x: 40, y: 10, t: 200 })).toBe(false);
    expect(isStillClick({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 1200 })).toBe(false);
  });

  it('compuerta de cadencia', () => {
    const g = new RateGate(30);
    expect(g.tryPass(0)).toBe(true);
    expect(g.tryPass(10)).toBe(false);
    expect(g.tryPass(31)).toBe(true);
  });
});

describe('simbología APP-6', () => {
  it('plataforma y movilidad por arma', () => {
    expect(symbolSpecForWeapon('m777', 'Howitzer')).toEqual({ icon: 'fieldArtillery', mobility: 'towed', platform: 'M777A2' });
    expect(symbolSpecForWeapon('m109', 'Howitzer').mobility).toBe('tracked');
    expect(symbolSpecForWeapon('gmlrs', 'Rocket')).toMatchObject({ icon: 'rocket', mobility: 'wheeled' });
    expect(symbolSpecForWeapon('tacticalMissile', 'Missile')).toMatchObject({ icon: 'missile', platform: 'M270A1' });
    expect(symbolSpecForWeapon('mortar120', 'Mortar').icon).toBe('mortar');
    expect(symbolSpecForWeapon('rifle556', 'SmallArms').icon).toBe('infantry');
    expect(symbolSpecForWeapon('desconocida', 'Rocket').icon).toBe('rocket');
  });

  it('marcos por afiliación', () => {
    expect(framePath('friend')).toBe('M25,50 H175 V150 H25 Z'); // rectángulo 3:2
    expect(framePath('hostile')).toContain('L178,100'); // rombo
  });

  it('SVG bien formado con tamaño real, punto de artillería y escalón', () => {
    const svg = unitSymbolSvg({
      affiliation: 'friend', icon: 'fieldArtillery', mobility: 'towed', echelonBattery: true,
      colors: { fill: '#4c9aff', frame: '#0b0e12', halo: '#ffffff' },
    }, 112);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"')).toBe(true);
    expect(svg).toContain('<circle cx="100" cy="100" r="17"');
    expect(svg).toContain('M100,24 V42');
    expect(svg).toContain('fill="#4c9aff"');
    expect(aimpointSymbolSvg('#f5a524', '#000', 64, 0.5)).toContain('opacity="0.500"');
  });
});

describe('cámaras', () => {
  it('tamaño de sujeto por categoría', () => {
    expect(subjectSizeForCategory('Howitzer')).toBe(10);
    expect(subjectSizeForCategory('SmallArms')).toBeLessThan(2);
  });

  it('encuadre de batería: arma en el tercio inferior izquierdo, horizonte arriba', () => {
    for (const az of [0, 90, 237]) {
      const pose = batteryFramingPose(az, 10);
      // El ojo está DETRÁS del arma (respecto al azimut de tiro) y alto.
      const rad = (az * Math.PI) / 180;
      const along = pose.eye.x * Math.sin(rad) + pose.eye.y * Math.cos(rad);
      expect(along).toBeLessThan(-30);
      expect(pose.eye.z).toBeGreaterThan(5);
      const gun = viewAngles(pose, { x: 0, y: 0, z: 1.5 });
      expect(gun.rightDeg).toBeLessThan(-8); // a la izquierda
      expect(gun.rightDeg).toBeGreaterThan(-25); // pero dentro de un FOV de 60º
      expect(gun.upDeg).toBeLessThan(-3); // por debajo del centro
      expect(gun.upDeg).toBeGreaterThan(-16); // dentro del FOV vertical
      // Un punto lejano por el azimut de tiro queda casi centrado, sobre el centro.
      const far = viewAngles(pose, { x: 20000 * Math.sin(rad), y: 20000 * Math.cos(rad), z: 0 });
      expect(Math.abs(far.rightDeg)).toBeLessThan(3);
      expect(far.upDeg).toBeGreaterThan(2);
    }
  });

  it('vista de impacto a distancia de seguridad', () => {
    expect(impactViewDistanceM(0)).toBe(260);
    expect(impactViewDistanceM(8)).toBeCloseTo(470, 0);
    expect(impactViewDistanceM(1e6)).toBe(1300);
    const p = impactOrbitPose({ x: 100, y: 200, z: 50 }, 90, 400, 14, 30);
    expect(Math.hypot(p.eye.x - 100, p.eye.y - 200, p.eye.z - 50)).toBeCloseTo(400, 6);
    expect(p.eye.x).toBeGreaterThan(100); // azimut de órbita 90º → al Este
    expect(p.aim.z).toBe(80);
  });

  it('suavizado angular por el camino corto', () => {
    expect(smoothAngleDeg(350, 10, 0.5)).toBeCloseTo(360);
    expect(smoothAngleDeg(10, 350, 0.5)).toBeCloseTo(0);
    expect(smoothAngleDeg(0, 180, 1)).toBeCloseTo(180);
  });
});
