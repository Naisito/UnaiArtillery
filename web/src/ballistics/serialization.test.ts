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
import { FiringTable, generateFiringTable } from './FiringTables';
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

  it('P-PRO.5 — generateFiringTable vía protocolo == núcleo directo', () => {
    const req: WorkerRequest = {
      id: 3,
      op: 'generateFiringTable',
      weaponId: 'm777',
      chargeIndex: 3,
      stepM: 5000,
      muzzle: { x: 0, y: 0, z: 3 },
      atmo: ATMO,
      cfg: { dt: 0.02, latitudeDeg: 40.75, enableCoriolis: true, groundZ: 0, maxFlight: 700 },
    };
    const viaOp = executeRequest(structuredClone(req)) as FiringTable;
    const direct = generateFiringTable(WeaponCatalog.m777(), 3, {
      stepM: 5000, dt: 0.02, latitudeDeg: 40.75, atmosphere: buildAtmosphere(ATMO),
    });
    expect(viaOp).toEqual(direct); // misma tabla, fila a fila y bit a bit
    expect(viaOp.rows.length).toBeGreaterThan(2);
  });
});

// ============================================================================
//  P-PRO.3 — banda 2D del corredor: lo que se aparta del eje se resuelve
//  contra las alturas de SU ladera, no las del eje.
// ============================================================================
describe('P-PRO.3 — banda 2D del corredor', () => {
  /** Malla sintética z = slope·t (plano inclinado lateral), rumbo este. */
  function lateralPlane(slope: number, rows: number, cols: number, stepCross: number): TerrainSpec {
    const halfW = ((rows - 1) / 2) * stepCross;
    const profile: number[] = [];
    for (let j = 0; j < rows; j++) {
      const t = -halfW + j * stepCross;
      for (let i = 0; i < cols; i++) profile.push(slope * t);
    }
    return {
      dirE: 1, dirN: 0,
      stepAlongM: 400, stepCrossM: stepCross, halfWidthM: halfW, rows,
      profile,
    };
  }

  it('(a) bilineal exacta sobre el plano lateral z = 0.1·t', () => {
    // Rumbo este: t = -north (positivo a la derecha del rumbo, o sea al sur).
    const h = buildTerrain(structuredClone(lateralPlane(0.1, 5, 11, 500)));
    expect(h(2000, -500)).toBeCloseTo(50, 9);   // t = +500 -> z = 50
    expect(h(2000, 500)).toBeCloseTo(-50, 9);   // t = -500 -> z = -50
    expect(h(2000, -250)).toBeCloseTo(25, 9);   // media celda: bilineal exacta
    expect(h(3141, -777)).toBeCloseTo(77.7, 9); // punto arbitrario dentro
    expect(h(2000, -5000)).toBeCloseTo(100, 9); // clamp lateral en el borde
    expect(h(-999, -500)).toBeCloseTo(50, 9);   // clamp en s < 0
    expect(h(99999, 500)).toBeCloseTo(-50, 9);  // clamp en s > largo
  });

  it('(b) el guiado hacia un objetivo desplazado 800 m impacta en SU ladera', () => {
    // GMLRS guiado, rumbo este, sin viento ni Coriolis para aislar el efecto.
    const cols = 200; // cubre ~80 km
    const band = lateralPlane(0.1, 5, cols, 500);
    const cfg = {
      dt: 0.01, latitudeDeg: 40.75, anchorLonDeg: -3.9,
      enableCoriolis: false, groundZ: 0, maxFlight: 700,
    };
    const base = {
      weaponId: 'gmlrs' as const,
      muzzle: { x: 0, y: 0, z: 3 },
      atmo: { ...ATMO, wind: { kind: 'none' } as const },
      cfg,
    };
    const order: FireOrder = { azimuthDeg: 90, elevationDeg: 35, chargeIndex: -1 };

    // Tiro natural sin objetivo: fija el alcance al que colocar el objetivo.
    const natural = executeRequest(structuredClone({
      ...base, id: 10, op: 'solveTrajectory' as const, order, targetEnu: null, terrain: band,
    })) as FlightResult;
    expect(natural.impacted).toBe(true);

    // Objetivo desplazado 800 m al NORTE del eje (t = -800 -> ladera a -80 m).
    const target = { x: natural.impactPoint.x, y: 800, z: -80 };
    const guided = executeRequest(structuredClone({
      ...base, id: 11, op: 'solveTrajectory' as const, order, targetEnu: target, terrain: band,
    })) as FlightResult;
    expect(guided.impacted).toBe(true);
    // Llega lateralmente a su objetivo...
    expect(Math.abs(guided.impactPoint.y - 800)).toBeLessThan(150);
    // ...y cae a la altura de SU ladera (no a la del eje, que es 0):
    expect(guided.impactPoint.z).toBeLessThan(-40);
    expect(guided.impactPoint.z).toBeCloseTo(0.1 * -guided.impactPoint.y, 0);

    // Contraste: el perfil 1D del eje (todo ceros) lo clavaba a z = 0.
    const flat1d: TerrainSpec = {
      dirE: 1, dirN: 0, stepAlongM: 400, rows: 1,
      profile: Array.from({ length: cols }, () => 0),
    };
    const guided1d = executeRequest(structuredClone({
      ...base, id: 12, op: 'solveTrajectory' as const, order, targetEnu: target, terrain: flat1d,
    })) as FlightResult;
    expect(Math.abs(guided1d.impactPoint.z)).toBeLessThan(1);
  });

  it('(c) rows = 1 reproduce bit a bit el resultado del perfil 1D actual', () => {
    // El mismo perfil de la loma, una vez como spec legado (stepM) y otra como
    // banda degenerada (stepAlongM + rows: 1).
    const spec1d: TerrainSpec = {
      dirE: TERRAIN.dirE, dirN: TERRAIN.dirN,
      stepAlongM: TERRAIN.stepM, rows: 1, profile: [...TERRAIN.profile],
    };
    const hLegacy = buildTerrain(structuredClone(TERRAIN));
    const hNew = buildTerrain(structuredClone(spec1d));
    for (const [e, n] of [[0, 0], [-100, 50], [1234, -321], [15000, 400], [99999, 0]]) {
      expect(hNew(e, n)).toBe(hLegacy(e, n));
    }

    const run = (terrain: TerrainSpec): FlightResult =>
      executeRequest(structuredClone({
        id: 13, op: 'solveTrajectory' as const, weaponId: 'm777' as const,
        order: ORDER, targetEnu: null, muzzle: { x: 0, y: 0, z: 3 },
        atmo: ATMO,
        cfg: {
          dt: 0.01, latitudeDeg: 40.75, anchorLonDeg: -3.9,
          enableCoriolis: true, groundZ: 0, maxFlight: 700,
        },
        terrain,
      })) as FlightResult;
    const a = run(TERRAIN);
    const b = run(spec1d);
    expect(b.downrange).toBe(a.downrange);
    expect(b.timeOfFlight).toBe(a.timeOfFlight);
    expect(b.impactPoint.x).toBe(a.impactPoint.x);
    expect(b.impactPoint.y).toBe(a.impactPoint.y);
    expect(b.impactPoint.z).toBe(a.impactPoint.z);
    expect(b.apex).toBe(a.apex);
  });
});

// ---------------------------------------------------------------------------
describe('Fix 3D — relieve real en el corredor (parábolas honestas)', () => {
  const CFG = {
    dt: 0.01, latitudeDeg: 40.75, anchorLonDeg: -3.9,
    enableCoriolis: true, groundZ: 0, maxFlight: 700,
  };
  const fire = (terrain: TerrainSpec | undefined, elevationDeg: number): FlightResult =>
    executeRequest(structuredClone({
      id: 21, op: 'solveTrajectory' as const, weaponId: 'm777' as const,
      order: { azimuthDeg: 90, elevationDeg, chargeIndex: 3 },
      targetEnu: null, muzzle: { x: 0, y: 0, z: 3 },
      atmo: { ...ATMO, wind: { kind: 'none' as const } },
      cfg: CFG,
      terrain,
    })) as FlightResult;

  it('cuesta abajo: el arco se ALARGA y el impacto cae bajo la cota de la batería', () => {
    // Valle: el suelo baja 40 m por km hasta -800 m ENU (tipo monte->ría).
    const downhill: TerrainSpec = {
      dirE: 1, dirN: 0, stepAlongM: 400, rows: 1,
      profile: Array.from({ length: 90 }, (_, i) => Math.max(-800, -40 * (i * 0.4))),
    };
    const flat: TerrainSpec = {
      dirE: 1, dirN: 0, stepAlongM: 400, rows: 1,
      profile: Array.from({ length: 90 }, () => 0),
    };
    const valle = fire(downhill, 45);
    const plano = fire(flat, 45);
    expect(valle.impacted).toBe(true);
    expect(valle.impactPoint.z).toBeLessThan(-300); // aterriza en el valle real
    expect(valle.downrange).toBeGreaterThan(plano.downrange + 200); // parábola extendida
  });

  it('máscara de cresta: un tiro tenso choca con la ladera aunque vaya SUBIENDO', () => {
    // Muro de 400 m entre s=1.6 y s=2.4 km; a QE 8º el proyectil pasa por ahí
    // a ~250 m y todavía ascendiendo: sin la puerta nueva lo atravesaba.
    const ridgeAt = (i: number) => (i >= 4 && i <= 6 ? 400 : 0);
    const ridge: TerrainSpec = {
      dirE: 1, dirN: 0, stepAlongM: 400, rows: 1,
      profile: Array.from({ length: 70 }, (_, i) => ridgeAt(i)),
    };
    const conCresta = fire(ridge, 8);
    const sinTerreno = fire(undefined, 8);
    expect(sinTerreno.downrange).toBeGreaterThan(8000); // referencia: vuela lejos
    expect(conCresta.impacted).toBe(true);
    expect(conCresta.downrange).toBeGreaterThan(1200);
    expect(conCresta.downrange).toBeLessThan(2500); // se estrella en el muro
    // El impacto queda en la cara de la ladera, por encima del plano base.
    expect(conCresta.impactPoint.z).toBeGreaterThan(50);
  });

  it('en plano (modo OSM) nada cambia: terreno a 0 == sin terreno, bit a bit', () => {
    const zeros: TerrainSpec = {
      dirE: 1, dirN: 0, stepAlongM: 400, rows: 1,
      profile: Array.from({ length: 90 }, () => 0),
    };
    const a = fire(zeros, 45);
    const b = fire(undefined, 45);
    expect(a.downrange).toBe(b.downrange);
    expect(a.timeOfFlight).toBe(b.timeOfFlight);
    expect(a.impactPoint.z).toBe(b.impactPoint.z);
  });
});
