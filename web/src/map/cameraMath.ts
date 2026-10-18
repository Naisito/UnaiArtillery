// ============================================================================
//  map/cameraMath.ts — Matemática pura de las cámaras.  [V2:MAP]
//
//  Encuadres del CameraDirector sin Cesium (testeables):
//    * encuadre de batería: el arma cerca en primer plano (tercio inferior
//      izquierdo), vista oblicua baja mirando aguas abajo del tiro para que
//      el arco y la zona de impacto entren en plano,
//    * vista de impacto cinematográfica: distancia de seguridad según la
//      carga explosiva, órbita lenta y ligera picada,
//    * suavizados exponenciales de vectores y ángulos (sin saltos al cruzar
//      0º/360º).
//  Ejes ENU: x Este, y Norte, z Arriba (m, relativos a la batería).
// ============================================================================

export interface P3 { x: number; y: number; z: number }

export interface Pose {
  eye: P3;
  aim: P3;
}

const RAD = Math.PI / 180;

/** Tamaño característico (m) del sujeto a encuadrar por categoría de arma. */
export function subjectSizeForCategory(category: string): number {
  switch (category) {
    case 'SmallArms': return 1.4;
    case 'Mortar': return 3.0;
    case 'Rocket':
    case 'Missile': return 8.0;
    default: return 10.0; // obuses: M777 ~10 m con las colas abiertas
  }
}

/**
 * Encuadre de batería: ojo detrás y a la derecha del arma, a poca altura;
 * mirada por el azimut de tiro con 4.5º de picado (horizonte en el tercio
 * superior, el arma en el inferior izquierdo, la línea de tiro hacia el
 * centro).
 */
export function batteryFramingPose(layAzDeg: number, sizeM: number): Pose {
  const s = Math.max(0.5, sizeM);
  const az = layAzDeg * RAD;
  const fwd = { x: Math.sin(az), y: Math.cos(az) };
  const right = { x: Math.cos(az), y: -Math.sin(az) };
  const back = 3.4 * s + 6;
  const side = 1.1 * s;
  const up = 0.75 * s + 2;
  const eye: P3 = {
    x: -fwd.x * back + right.x * side,
    y: -fwd.y * back + right.y * side,
    z: up,
  };
  const ahead = 60 * s;
  const pitchDown = 4.5 * RAD;
  const dist = ahead + back;
  const aim: P3 = {
    x: fwd.x * ahead,
    y: fwd.y * ahead,
    z: eye.z - Math.tan(pitchDown) * dist,
  };
  return { eye, aim };
}

/** Distancia de seguridad (m) para mirar un impacto de `tntKg` kg de TNT eq. */
export function impactViewDistanceM(tntKg: number): number {
  const k = Math.cbrt(Math.max(0, tntKg));
  return Math.min(1300, Math.max(260, 230 + 120 * k));
}

/**
 * Pose de la órbita de impacto: a `distanceM` del punto, con `elevDeg` de
 * elevación sobre él y azimut de órbita `orbitAzDeg` (desde el impacto
 * hacia la cámara). Se mira a la columna de humo, algo por encima del suelo.
 */
export function impactOrbitPose(
  impact: P3, orbitAzDeg: number, distanceM: number, elevDeg = 14, lookUpM = 30,
): Pose {
  const a = orbitAzDeg * RAD;
  const e = elevDeg * RAD;
  const h = Math.cos(e) * distanceM;
  return {
    eye: {
      x: impact.x + Math.sin(a) * h,
      y: impact.y + Math.cos(a) * h,
      z: impact.z + Math.sin(e) * distanceM,
    },
    aim: { x: impact.x, y: impact.y, z: impact.z + lookUpM },
  };
}

/** Azimut (grados) de `from` hacia `to` en el plano ENU. */
export function azimuthDeg(from: P3, to: P3): number {
  const d = (Math.atan2(to.x - from.x, to.y - from.y) / RAD + 360) % 360;
  return d;
}

/** Factor de suavizado exponencial independiente del frame-rate. */
export function smoothK(stiffness: number, dt: number): number {
  return 1 - Math.exp(-stiffness * Math.max(0, dt));
}

/** Mezcla `cur` hacia `target` con factor k (escribe en `out`). */
export function lerp3(cur: P3, target: P3, k: number, out: P3 = { x: 0, y: 0, z: 0 }): P3 {
  out.x = cur.x + (target.x - cur.x) * k;
  out.y = cur.y + (target.y - cur.y) * k;
  out.z = cur.z + (target.z - cur.z) * k;
  return out;
}

/** Suavizado de ángulo por el camino corto (grados). */
export function smoothAngleDeg(curDeg: number, targetDeg: number, k: number): number {
  let d = (((targetDeg - curDeg) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return curDeg + d * k;
}

/**
 * Proyección angular de un punto en la vista (grados): positivo = a la
 * derecha / por encima del eje de mirada. Para validar encuadres.
 */
export function viewAngles(pose: Pose, p: P3): { rightDeg: number; upDeg: number } {
  const dx = pose.aim.x - pose.eye.x;
  const dy = pose.aim.y - pose.eye.y;
  const dz = pose.aim.z - pose.eye.z;
  const viewAz = Math.atan2(dx, dy);
  const viewEl = Math.atan2(dz, Math.hypot(dx, dy));
  const px = p.x - pose.eye.x;
  const py = p.y - pose.eye.y;
  const pz = p.z - pose.eye.z;
  const pAz = Math.atan2(px, py);
  const pEl = Math.atan2(pz, Math.hypot(px, py));
  let dAz = (pAz - viewAz) / RAD;
  dAz = ((dAz + 540) % 360) - 180;
  return { rightDeg: dAz, upDeg: (pEl - viewEl) / RAD };
}
