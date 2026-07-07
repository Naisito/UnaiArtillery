// ============================================================================
//  BuildingHit.ts — Impactar contra los edificios 3D.  [P-VIVO.5]
//
//  FISICA_WEB.md lo reconocía: "un tiro rasante atraviesa un rascacielos".
//  Con los Photorealistic 3D Tiles activos, este módulo PRE-muestrea la cola
//  de la trayectoria (últimos ~2 km en 2D, cada ~15 m) contra el suelo VISUAL
//  con `scene.sampleHeightMostDetailed` en UN lote, en cuanto empieza el
//  vuelo — el TOF de decenas de segundos esconde de sobra la latencia. El
//  primer punto cuya altitud de vuelo queda POR DEBAJO de la altura visual es
//  el impacto estructural: si esa altura visual supera en >3 m la del terreno
//  del corredor, es EDIFICIO (fachada o tejado) y la REPRODUCCIÓN se recorta
//  ahí; si no, es simplemente el suelo visual y no cambia nada.
//
//  LA FÍSICA NO SE TOCA: los edificios siguen sin existir para la
//  integración — esto es un recorte de PRESENTACIÓN (documentado así). El
//  fallo radial del reto y el hook onImpact usan el punto recortado. Si el
//  muestreo no ha terminado (o falla) cuando el proyectil llega, se ignora:
//  comportamiento clásico.
//
//  La lógica pura (cola submuestreada, primer cruce, umbral edificio/suelo)
//  vive en funciones exportadas testeables en node con alturas sintéticas.
// ============================================================================
import * as Cesium from 'cesium';
import { FlightResult, Vec3 } from './ballistics';
import { BallisticsService } from './BallisticsService';
import type { PresenterOptions } from './ProjectilePresenter';

// ---------------------------------------------------------------------------
//  Lógica pura.
// ---------------------------------------------------------------------------

export interface TailPoint {
  t: number;
  x: number;
  y: number;
  z: number;
}

export const TAIL_2D_M = 2000;
export const TAIL_STEP_M = 15;
export const BUILDING_THRESHOLD_M = 3;

/**
 * Submuestrea la COLA de la trayectoria: los últimos `tail2dM` metros en 2D,
 * un punto cada ~`stepM` (más el último punto SIEMPRE: el impacto físico).
 */
export function tailSamples(
  points: TailPoint[],
  tail2dM = TAIL_2D_M,
  stepM = TAIL_STEP_M,
): TailPoint[] {
  if (points.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const startAt = Math.max(0, total - tail2dM);
  const out: TailPoint[] = [];
  let nextAt = startAt;
  for (let i = 0; i < points.length; i++) {
    if (cum[i] >= nextAt) {
      out.push(points[i]);
      nextAt = cum[i] + stepM;
    }
  }
  if (out.length === 0 || out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

/**
 * Primer cruce estructural: índice del primer punto cuya altitud de vuelo
 * queda por debajo de la altura VISUAL muestreada, SI esa altura visual
 * supera en >`thresholdM` la del terreno del corredor (edificio). Si el
 * primer cruce es contra el suelo visual (≤ umbral) no hay recorte, y un
 * muestreo INCOMPLETO (algún null/NaN) tampoco recorta nunca.
 */
export function firstStructuralCrossing(
  flightZ: number[],
  visualZ: (number | null)[],
  terrainZ: number[],
  thresholdM = BUILDING_THRESHOLD_M,
): number | null {
  const n = Math.min(flightZ.length, visualZ.length, terrainZ.length);
  for (let i = 0; i < n; i++) {
    const v = visualZ[i];
    if (v === null || !Number.isFinite(v)) return null; // incompleto: sin recorte
    if (flightZ[i] < v) {
      return v - terrainZ[i] > thresholdM ? i : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Capa Cesium: muestreo batched y recorte consultable por el presentador.
// ---------------------------------------------------------------------------

/** Resultado consultable: null hasta que el muestreo termina (o si no hay). */
export class StructuralClip {
  result: { t: number; point: Vec3; missM: number } | null = null;
}

export class BuildingHit {
  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly service: BallisticsService,
    /** ¿Tileset 3D activo AHORA? (sin él, ni se muestrea: fallback total). */
    private readonly tilesetActive: () => boolean,
  ) {}

  /**
   * Lanza el pre-muestreo del tramo final de un vuelo y devuelve el recorte
   * consultable (null = este tiro no participa). En ráfaga solo se muestrean
   * las TRAZADORAS (1 de cada 5): muestrear 9 balas/s contra las teselas
   * sería castigar la GPU para un recorte que nadie distingue.
   */
  prepare(flight: FlightResult, opts: PresenterOptions = {}): StructuralClip | null {
    if (!this.tilesetActive() || !this.viewer.scene.sampleHeightSupported) return null;
    if (opts.midair) return null; // tramo de rebote: ya es rasante y barato
    if (opts.silentLaunch && !opts.tracer) return null;
    const clip = new StructuralClip();
    void this.compute(flight, clip);
    return clip;
  }

  private async compute(flight: FlightResult, clip: StructuralClip): Promise<void> {
    try {
      const pts = tailSamples(
        flight.path.map((s) => ({ t: s.t, x: s.position.x, y: s.position.y, z: s.position.z })),
      );
      if (pts.length < 2) return;
      const frame = this.service.frame;

      // UN lote contra el suelo visual (misma técnica que el anclaje de la
      // batería) + UN lote de terreno del corredor relativo a la batería.
      const cartos = pts.map((p) => frame.cartographicOfEnu(new Vec3(p.x, p.y, 0)));
      const [sampled, terrainZ] = await Promise.all([
        this.viewer.scene.sampleHeightMostDetailed(cartos),
        this.service.terrainZRelative(pts.map((p) => new Vec3(p.x, p.y, 0))),
      ]);
      const visualZ = sampled.map((c) =>
        c && Number.isFinite(c.height) ? c.height - frame.heightM : null,
      );

      const idx = firstStructuralCrossing(pts.map((p) => p.z), visualZ, terrainZ);
      if (idx === null) return;
      const hit = pts[idx];
      const missM = Math.hypot(hit.x - flight.impactPoint.x, hit.y - flight.impactPoint.y);
      clip.result = { t: hit.t, point: new Vec3(hit.x, hit.y, hit.z), missM };
    } catch {
      // Muestreo fallido/cancelado: sin recorte (comportamiento clásico).
    }
  }
}
