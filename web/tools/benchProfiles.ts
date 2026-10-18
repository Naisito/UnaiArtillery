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

/**
 * 'base' = línea base (antes de V2): RK4 de paso fijo en todo.
 * 'v2'   = lo que corre ahora BallisticsService.makeConfigSpec: RK45 en todas
 *          las peticiones, muestras del camino cada 5·dt.
 */
export function benchProfiles(kind: 'base' | 'v2' = 'v2'): BenchProfiles {
  if (kind === 'v2') {
    const v2 = (dt: number, extra: SolverConfigSpec = {}): SolverConfigSpec => ({
      dt, integrator: 'rk45', outputDt: dt * 5, ...extra,
    });
    return {
      label: 'V2 (RK45 Dormand–Prince, solver sin asignaciones, transporte empaquetado)',
      m777MaxCharge: 3,
      fire: v2(0.005, { maxFlight: 700 }),
      preview: v2(0.01, { maxFlight: 700 }),
      solve: v2(0.005, { maxFlight: 700 }),
      table: v2(0.01),
      predict: v2(0.01, { maxFlight: 700 }),
      mrsi: v2(0.01),
      salvo: v2(0.005, { maxFlight: 700 }),
      ring: v2(0.02, { maxFlight: 700 }),
    };
  }
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
