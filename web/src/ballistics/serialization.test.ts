// ============================================================================
//  serialization.test.ts — Protocolo del Web Worker (P-NEXT.5).
//
//  El worker no puede recibir funciones ni clases: arma por id, atmósfera
//  como knobs + WindSpec, terreno como perfil muestreado. Estos tests prueban
//  que la ida y vuelta por structured clone (lo que hace postMessage)
//  reproduce EXACTAMENTE el mismo FlightResult que llamar al núcleo directo,
//  y que la decimación de vuelos largos no degrada la interpolación del
//  presentador.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { SolverConfig } from './BallisticsSolver';
import type { FlightResult } from './BallisticsSolver';
import { Vec3 } from './Vec3';
import { WeaponCatalog } from './WeaponCatalog';
import { FireOrder, WeaponSystem } from './WeaponSystem';
import {
  AtmoSpec, DECIMATE_EVERY, RangeRing, TerrainSpec, WorkerRequest,
  buildAtmosphere, buildTerrain, executeRequest, hydrateFlightResult, windFieldOf,
} from './WorkerProtocol';

// Una loma suave de prueba: el impacto no cae en el plano z=0.
const TERRAIN: TerrainSpec = {
  dirE: 1,
  dirN: 0,
  stepM: 400,
  profile: Array.from({ length: 80 }, (_, i) => 120 * Math.sin(i / 9) ** 2),
};

const ATMO: AtmoSpec = {
  model: 'isa76',
  seaLevelTemperatureK: 291.15, // knobs no estándar a propósito
  seaLevelPressurePa: 100800,
  wind: { kind: 'steady', speedMS: 6, fromBearingDeg: 210, ekman: true },
};

const ORDER: FireOrder = { azimuthDeg: 90, elevationDeg: 44, chargeIndex: 3 };

function directFlight(dt: number): FlightResult {
  const atmo = buildAtmosphere(ATMO);
  const cfg = SolverConfig.with({
    dt, latitudeDeg: 40.75, anchorLonDeg: -3.9, enableCoriolis: true, groundZ: 0, maxFlight: 700,
  });
  cfg.terrainHeight = buildTerrain(TERRAIN);
  const fc = new WeaponSystem(atmo, cfg);
  return fc.fire(WeaponCatalog.m777(), new Vec3(0, 0, 3), ORDER);
}

describe('P-NEXT.5 — protocolo de serialización del worker', () => {
  const request: WorkerRequest = {
    id: 1,
    op: 'solveTrajectory',
    weaponId: 'm777',
    order: ORDER,
    targetEnu: null,
    muzzle: new Vec3(0, 0, 3), // clase a propósito: el clone la degrada a {x,y,z}
    atmo: ATMO,
    cfg: {
      dt: 0.01, latitudeDeg: 40.75, anchorLonDeg: -3.9,
      enableCoriolis: true, groundZ: 0, maxFlight: 700,
    },
    terrain: TERRAIN,
  };

  // structuredClone == la semántica de postMessage (pierde prototipos).
  const viaWorker = executeRequest(structuredClone(request)) as FlightResult;
  const direct = directFlight(0.01);

  it('la ida y vuelta produce el MISMO FlightResult que el núcleo directo', () => {
    expect(viaWorker.downrange).toBe(direct.downrange);
    expect(viaWorker.timeOfFlight).toBe(direct.timeOfFlight);
    expect(viaWorker.impactSpeed).toBe(direct.impactSpeed);
    expect(viaWorker.apex).toBe(direct.apex);
    expect(viaWorker.impactPoint.x).toBe(direct.impactPoint.x);
    expect(viaWorker.impactPoint.y).toBe(direct.impactPoint.y);
    expect(viaWorker.impactPoint.z).toBe(direct.impactPoint.z);
    expect(viaWorker.warheadTNTeq).toBe(direct.warheadTNTeq);
  });

  it('decima vuelos >60 s (1 de cada 4) conservando extremos e impacto', () => {
    expect(direct.timeOfFlight).toBeGreaterThan(60); // el caso largo de verdad
    const expected = Math.ceil((direct.path.length - 1) / DECIMATE_EVERY) + 1;
    expect(viaWorker.path.length).toBe(expected);
    expect(viaWorker.path[0].t).toBe(direct.path[0].t);
    const lastW = viaWorker.path[viaWorker.path.length - 1];
    const lastD = direct.path[direct.path.length - 1];
    expect(lastW.t).toBe(lastD.t);
    expect(lastW.position.z).toBe(lastD.position.z);
  });

  it('el presentador interpola igual de suave sobre el camino decimado', () => {
    // Lerp por tiempo sobre ambos caminos y compara posiciones.
    const lerpAt = (path: FlightResult['path'], t: number) => {
      let lo = 0, hi = path.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (path[mid].t <= t) lo = mid;
        else hi = mid;
      }
      const a = path[lo], b = path[hi];
      const f = (t - a.t) / Math.max(b.t - a.t, 1e-9);
      return {
        x: a.position.x + (b.position.x - a.position.x) * f,
        y: a.position.y + (b.position.y - a.position.y) * f,
        z: a.position.z + (b.position.z - a.position.z) * f,
      };
    };
    for (let i = 1; i < 20; i++) {
      const t = (direct.timeOfFlight * i) / 20;
      const a = lerpAt(direct.path, t);
      const b = lerpAt(viaWorker.path, t);
      const err = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      expect(err).toBeLessThan(0.5); // sub-métrico a lo largo de todo el vuelo
    }
  });

  it('hydrateFlightResult devuelve Vec3 reales tras el clone', () => {
    const cloned = structuredClone(viaWorker);
    expect(cloned.impactPoint).not.toBeInstanceOf(Vec3);
    const hydrated = hydrateFlightResult(cloned);
    expect(hydrated.impactPoint).toBeInstanceOf(Vec3);
    expect(hydrated.path[0].position).toBeInstanceOf(Vec3);
    expect(hydrated.impactPoint.length()).toBeCloseTo(
      Math.hypot(direct.impactPoint.x, direct.impactPoint.y, direct.impactPoint.z), 9,
    );
  });

  it('WindSpec reproduce el perfil por altitud punto a punto', () => {
    const points = [
      { altitudeM: 0, speedMS: 4, fromBearingDeg: 270 },
      { altitudeM: 3000, speedMS: 12, fromBearingDeg: 210 },
      { altitudeM: 6000, speedMS: 18, fromBearingDeg: 180 },
    ];
    const viaSpec = windFieldOf(structuredClone({ kind: 'profile' as const, points }));
    const directAtmo = new Atmosphere();
    directAtmo.setWindProfile(points);
    for (const h of [0, 500, 1500, 3000, 4500, 6000, 9000]) {
      const a = viaSpec(new Vec3(0, 0, h), 0);
      const b = directAtmo.windAt(new Vec3(0, 0, h), 0);
      expect(a.x).toBeCloseTo(b.x, 12);
      expect(a.y).toBeCloseTo(b.y, 12);
    }
  });

  it('approxMaxRange vía protocolo == barrido directo', () => {
    const req: WorkerRequest = {
      id: 2,
      op: 'approxMaxRange',
      weaponId: 'mortar120',
      chargeIndex: 3,
      muzzle: { x: 0, y: 0, z: 3 },
      atmo: { ...ATMO, wind: { kind: 'none' } },
      cfg: { dt: 0.02, latitudeDeg: 40.75, enableCoriolis: true, groundZ: 0, maxFlight: 700 },
    };
    const ring = executeRequest(structuredClone(req)) as RangeRing;

    const w = WeaponCatalog.mortar120();
    const atmo = buildAtmosphere({ ...ATMO, wind: { kind: 'none' } });
    const cfg = SolverConfig.with({
      dt: 0.02, latitudeDeg: 40.75, enableCoriolis: true, groundZ: 0, maxFlight: 700,
    });
    const fc = new WeaponSystem(atmo, cfg);
    const v0 = WeaponSystem.muzzleVelocity(w, { azimuthDeg: 0, elevationDeg: 45, chargeIndex: 3 });
    let maxR = 0;
    let minR = Number.POSITIVE_INFINITY;
    for (let el = w.minElevationDeg; el <= w.maxElevationDeg; el += 5.0) {
      const r = fc.rangeForElevation(w, new Vec3(0, 0, 3), 0, v0, el);
      maxR = Math.max(maxR, r);
      minR = Math.min(minR, r);
    }
    expect(ring.maxRangeM).toBe(maxR);
    expect(ring.minRangeM).toBe(minR);
  });
});
