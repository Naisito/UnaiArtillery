// ============================================================================
//  bench.ts — Benchmark del núcleo balístico (V2 · PHYS, tarea E).
//
//  Mide, SIN Cesium, exactamente las peticiones que el servicio manda al
//  worker (mismo `executeRequest`, mismas configs que BallisticsService,
//  corredor de terreno sintético con el tamaño real: 161 columnas × 5 filas):
//
//    fire-m777        tiro M777 carga máx. al QE de alcance máximo, dt 0.005
//    preview-m777     el mismo tiro como preview (dt 0.01)
//    preview-prsm     PrSM esférico ~500 km (preview)
//    solve-target     dirección de tiro inversa M777 a 15 km
//    firing-table     tabla de tiro M777 carga máx., paso 1000 m
//    predict-disp     elipse predicha M777 a 15 km
//    mrsi             plan MRSI ×3 M777 a 8 km
//    salvo-6          salva dispersa ×6 M777
//    ring-prsm        anillo de alcance (approxMaxRange) del PrSM
//
//  y el tamaño de los mensajes del worker (v8.serialize ≈ structured clone).
//
//      npx tsx tools/bench.ts                 # tabla markdown
//      npx tsx tools/bench.ts --json out.json # además, vuelca JSON
//      npx tsx tools/bench.ts --only preview  # filtra casos por subcadena
//
//  Las máquinas compartidas meten ruido: se reporta la MEDIANA y el MÍNIMO de
//  varias repeticiones (≥3, hasta ~1.5 s por caso) tras un calentamiento.
// ============================================================================
import { serialize } from 'node:v8';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  AtmoSpec, SolverConfigSpec, TerrainSpec, WorkerRequest, executeRequest,
} from '../src/ballistics/WorkerProtocol';
import { benchProfiles } from './benchProfiles';

// ---------------------------------------------------------------------------
//  Escenario común (Guadarrama, meteo no trivial, corredor con relieve).
// ---------------------------------------------------------------------------
const ATMO: AtmoSpec = {
  model: 'isa76',
  seaLevelTemperatureK: 291.15,
  seaLevelPressurePa: 100800,
  wind: { kind: 'steady', speedMS: 6, fromBearingDeg: 210, ekman: true },
};

/** Corredor sintético del tamaño que muestrea el servicio (≤161 × 5). */
function corridor(azDeg: number, maxRangeM: number, halfWidthM = 1000): TerrainSpec {
  const az = (azDeg * Math.PI) / 180;
  const step = Math.max(400, (maxRangeM * 1.15) / 160);
  const cols = Math.max(2, Math.ceil((maxRangeM * 1.15) / step) + 1);
  const stepCross = 500;
  const rows = 2 * Math.max(1, Math.round(halfWidthM / stepCross)) + 1;
  const halfW = ((rows - 1) / 2) * stepCross;
  const profile: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const s = i * step;
      profile.push(80 * Math.sin(s / 3500) ** 2 + 20 * Math.sin((j - 2) * 0.7) - 0.004 * s);
    }
  }
  return {
    dirE: Math.sin(az), dirN: Math.cos(az),
    stepAlongM: step, stepCrossM: stepCross, halfWidthM: halfW, rows, profile,
  };
}

const BASE_CFG: SolverConfigSpec = {
  latitudeDeg: 40.75, anchorLonDeg: -3.9, enableCoriolis: true, groundZ: 0,
  anchorAltitudeM: 1200,
};
const MUZZLE = { x: 0, y: 0, z: 3 };

interface Case {
  name: string;
  build: () => WorkerRequest;
}

let reqId = 1;
function req(body: Record<string, unknown>): WorkerRequest {
  return { id: reqId++, muzzle: MUZZLE, atmo: ATMO, ...body } as unknown as WorkerRequest;
}

const P = benchProfiles(process.argv.includes('--base') ? 'base' : 'v2');

const CASES: Case[] = [
  {
    name: 'fire-m777',
    build: () => req({
      op: 'solveTrajectory', weaponId: 'm777',
      order: { azimuthDeg: 60, elevationDeg: 50, chargeIndex: P.m777MaxCharge },
      targetEnu: null, cfg: { ...BASE_CFG, ...P.fire }, terrain: corridor(60, 24000),
    }),
  },
  {
    name: 'preview-m777',
    build: () => req({
      op: 'solveTrajectory', weaponId: 'm777',
      order: { azimuthDeg: 60, elevationDeg: 50, chargeIndex: P.m777MaxCharge },
      targetEnu: null, cfg: { ...BASE_CFG, ...P.preview }, terrain: corridor(60, 24000),
    }),
  },
  {
    name: 'preview-prsm',
    build: () => req({
      op: 'solveTrajectory', weaponId: 'prsm',
      order: { azimuthDeg: 60, elevationDeg: 62, chargeIndex: -1 },
      targetEnu: null, cfg: { ...BASE_CFG, ...P.preview, sphericalEarth: true, ...(P.preview.integrator === 'rk45' ? { outputDt: 0.25 } : {}) },
      terrain: corridor(60, 520000),
    }),
  },
  {
    name: 'solve-target',
    build: () => req({
      op: 'solveForTarget', weaponId: 'm777', targetRangeM: 15000, azimuthDeg: 60,
      chargeIndex: P.m777MaxCharge, preferHighAngle: false,
      cfg: { ...BASE_CFG, ...P.solve }, terrain: corridor(60, 19500),
    }),
  },
  {
    name: 'firing-table',
    build: () => req({
      op: 'generateFiringTable', weaponId: 'm777', chargeIndex: P.m777MaxCharge, stepM: 1000,
      cfg: { ...BASE_CFG, ...P.table },
    }),
  },
  {
    name: 'predict-disp',
    build: () => req({
      op: 'predictDispersion', weaponId: 'm777',
      order: { azimuthDeg: 60, elevationDeg: 25, chargeIndex: P.m777MaxCharge },
      errors: { muzzleVelocityStd: 2, azimuthStdMils: 1, elevationStdMils: 1, windStd: 0.6 },
      cfg: { ...BASE_CFG, ...P.predict }, terrain: corridor(60, 24000, 2000),
    }),
  },
  {
    name: 'mrsi',
    build: () => req({
      op: 'solveMRSI', weaponId: 'm777', targetRangeM: 8000, azimuthDeg: 60, nRounds: 3,
      cfg: { ...BASE_CFG, ...P.mrsi }, terrain: corridor(60, 10400),
    }),
  },
  {
    name: 'salvo-6',
    build: () => req({
      op: 'fireDispersed', weaponId: 'm777',
      order: { azimuthDeg: 60, elevationDeg: 25, chargeIndex: P.m777MaxCharge },
      nRounds: 6, seed: 1234,
      errors: { muzzleVelocityStd: 2, azimuthStdMils: 1, elevationStdMils: 1, windStd: 0.6 },
      cfg: { ...BASE_CFG, ...P.salvo }, terrain: corridor(60, 24000, 2000),
    }),
  },
  {
    name: 'ring-prsm',
    build: () => req({
      op: 'approxMaxRange', weaponId: 'prsm', chargeIndex: -1,
      cfg: { ...BASE_CFG, ...P.ring },
    }),
  },
];

// ---------------------------------------------------------------------------
function timeCase(c: Case): { medianMs: number; minMs: number; reps: number; bytes: number } {
  // Calentamiento (JIT) + tamaño del mensaje de respuesta.
  const warm = executeRequest(structuredClone(c.build()));
  const bytes = serialize(warm).length;
  const times: number[] = [];
  const t0 = performance.now();
  while (times.length < 3 || (performance.now() - t0 < 1500 && times.length < 25)) {
    const r = structuredClone(c.build());
    const a = performance.now();
    executeRequest(r);
    times.push(performance.now() - a);
  }
  times.sort((x, y) => x - y);
  return {
    medianMs: times[Math.floor(times.length / 2)],
    minMs: times[0],
    reps: times.length,
    bytes,
  };
}

const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const jsonIdx = process.argv.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null;

const results: Record<string, { medianMs: number; minMs: number; reps: number; bytes: number }> = {};
console.log(`perfil: ${P.label}`);
console.log('| caso | mediana (ms) | mínimo (ms) | reps | respuesta (KB) |');
console.log('|---|---:|---:|---:|---:|');
for (const c of CASES) {
  if (only && !c.name.includes(only)) continue;
  const r = timeCase(c);
  results[c.name] = r;
  console.log(
    `| ${c.name} | ${r.medianMs.toFixed(1)} | ${r.minMs.toFixed(1)} | ${r.reps} | ` +
      `${(r.bytes / 1024).toFixed(1)} |`,
  );
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ profile: P.label, results }, null, 2));
