// ============================================================================
//  benchProfiles.ts — Configs del solver que el servicio usa por tipo de
//  petición, para que tools/bench.ts mida EXACTAMENTE lo que corre la app.
// ============================================================================
import type { SolverConfigSpec } from '../src/ballistics/WorkerProtocol';

export interface BenchProfiles {
  label: string;
  m777MaxCharge: number;
  fire: SolverConfigSpec;
  preview: SolverConfigSpec;
  solve: SolverConfigSpec;
  table: SolverConfigSpec;
  predict: SolverConfigSpec;
  mrsi: SolverConfigSpec;
  salvo: SolverConfigSpec;
  ring: SolverConfigSpec;
}

/** Línea base (antes de V2): RK4 de paso fijo en todo. */
export function benchProfiles(): BenchProfiles {
  return {
    label: 'base (RK4 paso fijo, Vec3 inmutable)',
    m777MaxCharge: 3,
    fire: { dt: 0.005, maxFlight: 700 },
    preview: { dt: 0.01, maxFlight: 700 },
    solve: { dt: 0.005, maxFlight: 700 },
    table: { dt: 0.01 },
    predict: { dt: 0.01, maxFlight: 700 },
    mrsi: { dt: 0.01 },
    salvo: { dt: 0.005, maxFlight: 700 },
    ring: { dt: 0.02, maxFlight: 700 },
  };
}
