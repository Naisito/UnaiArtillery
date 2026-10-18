// ============================================================================
//  map/fanGeometry.ts — Geometría del abanico de tiro y figuras ENU.  [V2:MAP]
//
//  Todo en el plano ENU de la batería (x Este, y Norte, metros):
//    * anillos intermedios con paso redondo según el alcance del arma,
//    * sector de tiro limitado por el traverse: se centra en el AZIMUT DE
//      TIRO (AOF). Como en una batería real, mientras la puntería se mueve
//      dentro del sector las colas/afustes no se mueven (el sector queda
//      fijo); solo si la puntería sale del sector se "re-emplaza" la pieza y
//      el sector se recentra en la nueva puntería. Eso además evita
//      reconstruir primitivas de suelo a cada píxel de deslizador.
//    * arcos, sectores-corona y elipses de error como polilíneas ENU,
//    * caída por curvatura (z) para que un punto a r metros quede sobre la
//      superficie al convertirlo a ECEF (alcances de 300–500 km).
//  Módulo PURO.
// ============================================================================
import { EARTH_MEAN_RADIUS_M } from './geodesy';
import { deltaDeg, normDeg } from './units';

export interface P2 { x: number; y: number }

const RAD = Math.PI / 180;

/** Paso de los anillos intermedios: 3–8 anillos dentro del alcance máx. */
export function ringStepM(maxRangeM: number): number {
  const steps = [100, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  for (const s of steps) if (maxRangeM / s <= 8) return s;
  return 100000;
}

/**
 * Radios de los anillos intermedios (múltiplos del paso) estrictamente
 * entre mín y máx, sin pegarse a ninguno de los dos (margen 4 % del máx).
 */
export function intermediateRings(minRangeM: number, maxRangeM: number): number[] {
  if (!(maxRangeM > 0)) return [];
  const step = ringStepM(maxRangeM);
  const margin = 0.04 * maxRangeM;
  const out: number[] = [];
  for (let r = step; r < maxRangeM - margin; r += step) {
    if (r > minRangeM + margin) out.push(r);
  }
  return out;
}

/** El arma tiene sector limitado (no gira 360º sin re-emplazarse). */
export function isSectorLimited(traverseDeg: number): boolean {
  return Number.isFinite(traverseDeg) && traverseDeg > 0 && traverseDeg < 359.5;
}

/**
 * Azimut de tiro (centro del sector) tras un cambio de puntería. Sin
 * centro previo, o si la puntería sale del sector (con 0.5º de holgura),
 * se recentra en la puntería; si no, se conserva.
 */
export function updateSectorCenter(
  currentCenterDeg: number | null, layAzDeg: number, traverseDeg: number,
): number {
  if (!isSectorLimited(traverseDeg)) return normDeg(layAzDeg);
  if (currentCenterDeg === null || !Number.isFinite(currentCenterDeg)) return normDeg(layAzDeg);
  const half = traverseDeg / 2;
  if (Math.abs(deltaDeg(currentCenterDeg, layAzDeg)) > half + 0.5) return normDeg(layAzDeg);
  return normDeg(currentCenterDeg);
}

/** Punto ENU a distancia r por el azimut az (grados, horario desde el N). */
export function polar(r: number, azDeg: number): P2 {
  return { x: r * Math.sin(azDeg * RAD), y: r * Math.cos(azDeg * RAD) };
}

/**
 * Arco de radio r desde `fromAz` hasta `toAz` en sentido horario. Con
 * fromAz == toAz (o un barrido ≥ 360) devuelve el círculo completo cerrado.
 * El número de segmentos crece con el barrido (≈ 2.5º por segmento).
 */
export function arcPoints(r: number, fromAzDeg: number, toAzDeg: number, maxStepDeg = 2.5): P2[] {
  let sweep = normDeg(toAzDeg - fromAzDeg);
  if (sweep === 0) sweep = 360;
  const n = Math.max(2, Math.ceil(sweep / maxStepDeg));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push(polar(r, fromAzDeg + (sweep * i) / n));
  return out;
}

export interface FanShape {
  full: boolean;
  /** Contorno exterior (alcance máx): arco del sector o círculo cerrado. */
  outer: P2[];
  /** Contorno interior (alcance mín) o null si no hay mínimo útil. */
  inner: P2[] | null;
  /** Polígono de relleno de la corona/sector (sentido horario exterior). */
  fill: P2[];
  /** Agujero del relleno (solo círculo completo con mínimo). */
  fillHole: P2[] | null;
  /** Radiales de los límites de traverse (izquierda y derecha) o null. */
  limits: [P2[], P2[]] | null;
  leftAzDeg: number;
  rightAzDeg: number;
}

/** Abanico mín/máx con traverse centrado en `centerAzDeg`. */
export function fanShape(
  minRangeM: number, maxRangeM: number, traverseDeg: number, centerAzDeg: number,
): FanShape {
  const hasMin = Number.isFinite(minRangeM) && minRangeM > 50 && minRangeM < maxRangeM * 0.98;
  const rMin = hasMin ? minRangeM : 0;
  if (!isSectorLimited(traverseDeg)) {
    const outer = arcPoints(maxRangeM, 0, 0);
    const inner = hasMin ? arcPoints(rMin, 0, 0) : null;
    return {
      full: true, outer, inner, fill: outer, fillHole: inner, limits: null,
      leftAzDeg: 0, rightAzDeg: 360,
    };
  }
  const left = normDeg(centerAzDeg - traverseDeg / 2);
  const right = normDeg(centerAzDeg + traverseDeg / 2);
  const outer = arcPoints(maxRangeM, left, right);
  const inner = hasMin ? arcPoints(rMin, left, right) : null;
  const innerOrApex = inner ? [...inner].reverse() : [{ x: 0, y: 0 }];
  const fill = [...outer, ...innerOrApex];
  const r0 = hasMin ? rMin : 0;
  const limits: [P2[], P2[]] = [
    [polar(r0, left), polar(maxRangeM, left)],
    [polar(r0, right), polar(maxRangeM, right)],
  ];
  return { full: false, outer, inner, fill, fillHole: null, limits, leftAzDeg: left, rightAzDeg: right };
}

/**
 * Caída de la superficie terrestre bajo el plano tangente ENU a la
 * distancia horizontal r (z negativo): a 30 km son −71 m; a 300 km, −7 km.
 */
export function curvatureDropZ(r: number, radiusM = EARTH_MEAN_RADIUS_M): number {
  return -(r * r) / (2 * radiusM);
}

/**
 * Elipse de error en ENU: semieje `semiRangeM` a lo largo del rumbo
 * `bearingDeg` (alcance) y `semiCrossM` perpendicular (deriva). Cerrada.
 */
export function ellipsePoints(
  center: P2, bearingDeg: number, semiRangeM: number, semiCrossM: number, n = 72,
): P2[] {
  const b = bearingDeg * RAD;
  const ux = Math.sin(b), uy = Math.cos(b);     // eje de alcance
  const vx = Math.cos(b), vy = -Math.sin(b);    // eje de deriva (a la derecha)
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const a = semiRangeM * Math.cos(t);
    const c = semiCrossM * Math.sin(t);
    out.push({ x: center.x + a * ux + c * vx, y: center.y + a * uy + c * vy });
  }
  return out;
}

/** Círculo cerrado de radio r alrededor de `center` (ENU). */
export function circlePoints(center: P2, r: number, n = 64): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push({ x: center.x + r * Math.sin(t), y: center.y + r * Math.cos(t) });
  }
  return out;
}

/** Diezma una polilínea a ≤ maxPoints conservando primero y último. */
export function decimate<T>(pts: T[], maxPoints: number): T[] {
  if (pts.length <= maxPoints) return pts.slice();
  const step = (pts.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints - 1; i++) out.push(pts[Math.round(i * step)]);
  out.push(pts[pts.length - 1]);
  return out;
}
