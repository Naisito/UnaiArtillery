// ============================================================================
//  particles.ts — Sistema de partículas GPU instanciado.  [V2 VFX]
//
//  Sustituye al pool de THREE.Sprite (1 draw call y 1 material POR bocanada:
//  ~150-600 draw calls en una salva) por TRES draw calls fijos:
//    * ParticleSystem 'smoke' — humo, polvo, vapor, espray: mezcla alfa,
//      ordenado de atrás adelante, ILUMINADO (normal esférica falsa del
//      billboard × sol/luna + hemisférica + hasta 4 luces puntuales de
//      fogonazos/bolas de fuego: el humo se enciende de naranja por dentro),
//      calor incandescente que se apaga y calima de distancia igual que el
//      terreno de Cesium.
//    * ParticleSystem 'glow' — fogonazos, bolas de fuego, chispas, metralla
//      incandescente, trazadoras y penachos: aditivo, sin luz, con estirado
//      a lo largo de la velocidad (estelas de chispa).
//    * DebrisSystem — terrones y fragmentos (InstancedMesh PBR) con
//      trayectoria balística, rebote amortiguado y reposo en el suelo.
//
//  Datos en un Float32Array con stride fijo (cero objetos por partícula);
//  muerte por swap-remove; emisión con una plantilla mutable reutilizada
//  (EMIT.reset()) — cero asignaciones en el bucle caliente. El viento se
//  muestrea por franjas de altura cacheadas (WindCache) en vez de una
//  llamada (con su Vec3 nuevo) por partícula y frame.
//
//  Oclusión: cada N frames el overlay entrega DepthOcclusion; cada partícula
//  prueba centro y cima contra la profundidad de Cesium y su visibilidad se
//  funde suavemente hacia el resultado (alfa × vis en el shader).
// ============================================================================
import * as THREE from 'three';
import type { DepthOcclusion } from '../render/DepthOcclusion';
import type { LightingState } from '../render/SceneLighting';

// ---------------------------------------------------------------------------
//  Viento cacheado por franjas de altura (el campo del servicio es función
//  de la altura; la variación horizontal a escala de un efecto es nula).
// ---------------------------------------------------------------------------
export type WindLookup = (z: number) => { x: number; y: number; z: number };

export class WindCache {
  private static readonly BAND = 100;   // m
  private static readonly ZMIN = -1500;
  private static readonly N = 260;      // hasta ~24.5 km
  private readonly wx = new Float32Array(WindCache.N);
  private readonly wy = new Float32Array(WindCache.N);
  private readonly wz = new Float32Array(WindCache.N);
  private readonly stamp = new Float64Array(WindCache.N).fill(-1e9);
  private now = 0;

  constructor(private readonly source: WindLookup) {}

  /** Avanza el reloj interno: las franjas caducan a los 0.5 s. */
  tick(dt: number): void { this.now += dt; }

  private band(z: number): number {
    const i = Math.floor((z - WindCache.ZMIN) / WindCache.BAND);
    return i < 0 ? 0 : i >= WindCache.N ? WindCache.N - 1 : i;
  }

  /** Escribe el viento a la altura z en out[0..2]. */
  sample(z: number, out: Float32Array): void {
    const i = this.band(z);
    if (this.now - this.stamp[i] > 0.5) {
      const w = this.source(WindCache.ZMIN + (i + 0.5) * WindCache.BAND);
      this.wx[i] = w.x;
      this.wy[i] = w.y;
      this.wz[i] = w.z;
      this.stamp[i] = this.now;
    }
    out[0] = this.wx[i];
    out[1] = this.wy[i];
    out[2] = this.wz[i];
  }
}

// ---------------------------------------------------------------------------
//  Plantilla de emisión (mutable, reutilizada: EMIT.reset() antes de cada uso).
// ---------------------------------------------------------------------------
export class EmitParams {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  life = 1;
  size = 1;
  /** Crecimiento inicial (m/s) y constante de saturación (s, 0 = lineal). */
  grow = 0;
  growTau = 0;
  r = 1; g = 1; b = 1;
  /** Color final (NaN = igual al inicial) y tiempo para alcanzarlo. */
  r1 = NaN; g1 = NaN; b1 = NaN;
  colorTau = 0;
  alpha = 1;
  fadeIn = 0.04;
  /** Fracción de vida a partir de la cual se desvanece. */
  fadeOut = 0.35;
  /** m/s² (+ cae, − flota). */
  gravity = 0;
  /** 1/s de relajación de la velocidad hacia el viento. */
  drag = 0.8;
  /** Fracción del viento local que sigue (0..1). */
  wind = 1;
  rot = NaN;
  spin = 0;
  /** Celda del atlas (0..3); NaN = aleatoria. */
  variant = NaN;
  /** Brillo incandescente inicial (humo recién salido del fuego). */
  heat = 0;
  heatTau = 0.25;
  /** Cota del suelo (NaN = sin colisión). */
  ground = NaN;
  /** Estirado por velocidad (s); solo el sistema aditivo. */
  stretch = 0;
  /** 0..1: cuánto le afecta la luz (humo 1, espray 0.7). */
  lit = 1;
  sticky = false;

  reset(): this {
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.life = 1; this.size = 1; this.grow = 0; this.growTau = 0;
    this.r = this.g = this.b = 1;
    this.r1 = this.g1 = this.b1 = NaN; this.colorTau = 0;
    this.alpha = 1; this.fadeIn = 0.04; this.fadeOut = 0.35;
    this.gravity = 0; this.drag = 0.8; this.wind = 1;
    this.rot = NaN; this.spin = 0; this.variant = NaN;
    this.heat = 0; this.heatTau = 0.25; this.ground = NaN; this.stretch = 0;
    this.lit = 1; this.sticky = false;
    return this;
  }

  color(hex: number): this {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }

  colorEnd(hex: number, tau: number): this {
    this.r1 = ((hex >> 16) & 255) / 255;
    this.g1 = ((hex >> 8) & 255) / 255;
    this.b1 = (hex & 255) / 255;
    this.colorTau = tau;
    return this;
  }
}

/** Plantilla compartida por todos los emisores. */
export const EMIT = new EmitParams();

// Campos del registro por partícula.
const F = {
  PX: 0, PY: 1, PZ: 2, VX: 3, VY: 4, VZ: 5, AGE: 6, LIFE: 7,
  SIZE: 8, GROW: 9, GTAU: 10, R0: 11, G0: 12, B0: 13, R1: 14, G1: 15, B1: 16,
  CTAU: 17, ALPHA: 18, FIN: 19, FOUT: 20, GRAV: 21, DRAG: 22, WIND: 23,
  ROT: 24, SPIN: 25, VAR: 26, HEAT: 27, HTAU: 28, GROUND: 29, STRETCH: 30,
  VIS: 31, VIST: 32, LIT: 33, STICKY: 34, CURSIZE: 35,
} as const;
const STRIDE = 36;

// ---------------------------------------------------------------------------
//  Shaders.
// ---------------------------------------------------------------------------
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec3 iPos;
attribute vec4 iSR;   // tamaño, rotación, estirado (s), celda
attribute vec4 iCol;  // rgb, alfa
attribute vec3 iVel;
attribute vec2 iMisc; // calor, iluminado
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vMisc;
varying vec3 vViewPos;
varying vec2 vCorner;
void main() {
  float s = iSR.x;
  vec2 c = position.xy;
  if (iSR.z < 0.0) {
    // Plano sobre el suelo ENU (anillos de choque, charcos de luz).
    float cs = cos(iSR.y), sn = sin(iSR.y);
    vec2 rc = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
    vec4 mvf = modelViewMatrix * vec4(iPos + vec3(rc * s, 0.0), 1.0);
    vViewPos = mvf.xyz;
    gl_Position = projectionMatrix * mvf;
    vCorner = rc * 2.0;
    float cellf = iSR.w;
    vUv = (uv + vec2(mod(cellf, 2.0), 1.0 - floor(cellf / 2.0))) * 0.5;
    vCol = iCol;
    vMisc = iMisc;
    return;
  }
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 offs;
  if (iSR.z > 0.0) {
    vec3 vv = mat3(modelViewMatrix) * iVel;
    // Estirado en pantalla: proyección de la velocidad sobre el plano de vista.
    vec2 dir = vv.xy;
    float len = length(dir);
    vec2 ax = len > 1e-4 ? dir / len : vec2(0.0, 1.0);
    vec2 px = vec2(-ax.y, ax.x);
    float L = max(s, len * iSR.z);
    offs = px * c.x * s + ax * c.y * L;
    vCorner = vec2(c.x * 2.0, 0.0);
  } else {
    float cs = cos(iSR.y), sn = sin(iSR.y);
    vec2 rc = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
    offs = rc * s;
    vCorner = rc * 2.0;
  }
  mv.xy += offs;
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  float cell = iSR.w;
  // Celda k del atlas: fila 0 ARRIBA en el canvas (flipY: v=1 arriba).
  vec2 o = vec2(mod(cell, 2.0), 1.0 - floor(cell / 2.0));
  vUv = (uv + o) * 0.5;
  vCol = iCol;
  vMisc = iMisc;
}
`;

const FRAG_SMOKE = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform vec3 uKeyDirV;
uniform vec3 uKeyCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform vec3 uUpV;
uniform vec3 uHaze;
uniform float uFogDensity;
uniform vec4 uPL[4];
uniform vec3 uPLc[4];
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vMisc;
varying vec3 vViewPos;
varying vec2 vCorner;
void main() {
  vec4 tex = texture2D(map, vUv);
  float a = tex.a * vCol.a;
  if (a < 0.003) discard;
  vec2 q = vCorner;
  float r2 = min(dot(q, q), 1.0);
  // Normal de una esfera aplastada: volumen sin geometría.
  vec3 n = normalize(vec3(q * 0.85, sqrt(1.0 - r2) + 0.3));
  float lit = vMisc.y;
  float ndl = dot(n, uKeyDirV);
  // Dispersión: envoltura suave + algo de luz trasera en los bordes finos.
  float wrap = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
  vec3 viewDir = normalize(-vViewPos);
  float back = pow(clamp(dot(-viewDir, uKeyDirV), 0.0, 1.0), 6.0) * (1.0 - tex.a) * 0.8;
  float hemi = dot(n, uUpV) * 0.5 + 0.5;
  vec3 amb = mix(uGroundCol, uSkyCol, hemi);
  vec3 lightCol = uKeyCol * (wrap + back) + amb;
  vec3 base = vCol.rgb * (0.82 + 0.18 * tex.r);
  vec3 col = base * mix(vec3(1.0), lightCol, lit);
  for (int i = 0; i < 4; i++) {
    vec3 d = uPL[i].xyz - vViewPos;
    float dist = length(d);
    float att = clamp(1.0 - dist / max(uPL[i].w, 1e-3), 0.0, 1.0);
    att *= att;
    col += base * uPLc[i] * att * (0.45 + 0.55 * max(dot(n, d / max(dist, 1e-3)), 0.0));
  }
  float heat = vMisc.x;
  col += vec3(1.0, 0.42, 0.1) * heat * (1.0 - r2 * 0.7);
  float f = uFogDensity * length(vViewPos);
  float fog = 1.0 - exp(-f * f);
  col = mix(col, uHaze, fog * 0.9);
  gl_FragColor = vec4(col, a * (1.0 - fog * 0.35));
}
`;

const FRAG_GLOW = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vMisc;
varying vec3 vViewPos;
varying vec2 vCorner;
void main() {
  vec4 tex = texture2D(map, vUv);
  float a = tex.a * vCol.a;
  if (a < 0.002) discard;
  float f = uFogDensity * length(vViewPos);
  float fog = 1.0 - exp(-f * f);
  // Núcleo más blanco que la falda (temperatura de color del fuego).
  vec3 col = mix(vCol.rgb, vec3(1.0, 0.97, 0.9), clamp(tex.a * tex.a * vMisc.x, 0.0, 1.0));
  gl_FragColor = vec4(col, a * (1.0 - 0.75 * fog));
}
`;

/** Contexto de render que el overlay entrega a los sistemas cada frame. */
export interface RenderCtx {
  /** Cámara en ENU. */
  camEnu: THREE.Vector3;
  /** Dirección de vista unitaria en ENU. */
  camDirEnu: THREE.Vector3;
  /** ENU → espacio de vista (camera.matrixWorldInverse · enuRoot.matrixWorld). */
  viewFromEnu: THREE.Matrix4;
  /** Profundidad de Cesium (null = sin oclusión). */
  occlusion: DepthOcclusion | null;
  /** true si la oclusión trae datos NUEVOS este frame. */
  occlusionFresh: boolean;
  lighting: LightingState;
  /** dt de pared desde el render anterior (s). */
  dt: number;
  /** Luces dinámicas del frame, ordenadas por fuerza aparente. */
  lights: readonly DynLight[];
}

/** Luz puntual transitoria (fogonazo, bola de fuego, bengala…), en ENU. */
export interface DynLight {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  intensity: number;
  radius: number;
}

export type ParticleKind = 'smoke' | 'glow';

const scratchWind = new Float32Array(3);
const tmpV = new THREE.Vector3();

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.RawShaderMaterial;
  private readonly data: Float32Array;
  private live = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aSR: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aVel: THREE.InstancedBufferAttribute;
  private readonly aMisc: THREE.InstancedBufferAttribute;
  private readonly keys: Uint32Array;
  private readonly depth: Float32Array;
  /** Hueco reservado a los préstamos "sticky" (cortinas de humo). */
  private readonly reserve: number;

  constructor(
    parent: THREE.Object3D,
    readonly kind: ParticleKind,
    readonly capacity: number,
    texture: THREE.Texture,
    private readonly wind: WindCache,
  ) {
    this.data = new Float32Array(capacity * STRIDE);
    this.keys = new Uint32Array(capacity);
    this.depth = new Float32Array(capacity);
    this.reserve = Math.floor(capacity * 0.15);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3,
    ));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3);
    this.aSR = mk(4);
    this.aCol = mk(4);
    this.aVel = mk(3);
    this.aMisc = mk(2);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSR', this.aSR);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iMisc', this.aMisc);
    geo.instanceCount = 0;
    this.geo = geo;

    const smoke = kind === 'smoke';
    const plPos: THREE.Vector4[] = [];
    const plCol: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      plPos.push(new THREE.Vector4(0, 0, 0, 1));
      plCol.push(new THREE.Vector3(0, 0, 0));
    }
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: smoke ? FRAG_SMOKE : FRAG_GLOW,
      uniforms: {
        map: { value: texture },
        uKeyDirV: { value: new THREE.Vector3(0, 0, 1) },
        uKeyCol: { value: new THREE.Vector3(1, 1, 1) },
        uSkyCol: { value: new THREE.Vector3(0.5, 0.6, 0.8) },
        uGroundCol: { value: new THREE.Vector3(0.3, 0.28, 0.24) },
        uUpV: { value: new THREE.Vector3(0, 1, 0) },
        uHaze: { value: new THREE.Vector3(0.7, 0.75, 0.82) },
        uFogDensity: { value: 0 },
        uPL: { value: plPos },
        uPLc: { value: plCol },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // instancias repartidas por kilómetros
    this.mesh.renderOrder = smoke ? 10 : 20; // humo antes, aditivo encima
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  get count(): number { return this.live; }

  /** Emite una partícula con la plantilla dada. Devuelve false si no cabe. */
  emit(p: EmitParams): boolean {
    const limit = p.sticky ? this.capacity : this.capacity - this.reserve;
    if (this.live >= limit) return false;
    const o = this.live * STRIDE;
    const d = this.data;
    d[o + F.PX] = p.x; d[o + F.PY] = p.y; d[o + F.PZ] = p.z;
    d[o + F.VX] = p.vx; d[o + F.VY] = p.vy; d[o + F.VZ] = p.vz;
    d[o + F.AGE] = 0;
    d[o + F.LIFE] = Math.max(0.01, p.life);
    d[o + F.SIZE] = p.size;
    d[o + F.GROW] = p.grow;
    d[o + F.GTAU] = p.growTau;
    d[o + F.R0] = p.r; d[o + F.G0] = p.g; d[o + F.B0] = p.b;
    const hasEnd = !Number.isNaN(p.r1);
    d[o + F.R1] = hasEnd ? p.r1 : p.r;
    d[o + F.G1] = hasEnd ? p.g1 : p.g;
    d[o + F.B1] = hasEnd ? p.b1 : p.b;
    d[o + F.CTAU] = hasEnd ? Math.max(0.01, p.colorTau) : 1;
    d[o + F.ALPHA] = p.alpha;
    d[o + F.FIN] = Math.max(0.001, p.fadeIn);
    d[o + F.FOUT] = Math.min(0.99, Math.max(0, p.fadeOut));
    d[o + F.GRAV] = p.gravity;
    d[o + F.DRAG] = p.drag;
    d[o + F.WIND] = p.wind;
    d[o + F.ROT] = Number.isNaN(p.rot) ? Math.random() * Math.PI * 2 : p.rot;
    d[o + F.SPIN] = p.spin;
    d[o + F.VAR] = Number.isNaN(p.variant) ? Math.floor(Math.random() * 4) : p.variant;
    d[o + F.HEAT] = p.heat;
    d[o + F.HTAU] = Math.max(0.01, p.heatTau);
    d[o + F.GROUND] = p.ground;
    d[o + F.STRETCH] = p.stretch;
    d[o + F.VIS] = 1;
    d[o + F.VIST] = 1;
    d[o + F.LIT] = p.lit;
    d[o + F.STICKY] = p.sticky ? 1 : 0;
    d[o + F.CURSIZE] = p.size;
    this.live++;
    return true;
  }

  /** Simulación (llamar desde el tick de la app). */
  update(dt: number): void {
    const d = this.data;
    let i = 0;
    while (i < this.live) {
      const o = i * STRIDE;
      const age = d[o + F.AGE] + dt;
      if (age >= d[o + F.LIFE]) {
        this.kill(i);
        continue;
      }
      d[o + F.AGE] = age;
      const windMul = d[o + F.WIND];
      let wx = 0, wy = 0, wz = 0;
      if (windMul > 0) {
        this.wind.sample(d[o + F.PZ], scratchWind);
        wx = scratchWind[0] * windMul;
        wy = scratchWind[1] * windMul;
        wz = scratchWind[2] * windMul;
      }
      const drag = d[o + F.DRAG];
      const k = drag > 0 ? 1 - Math.exp(-drag * dt) : 0;
      let vx = d[o + F.VX], vy = d[o + F.VY], vz = d[o + F.VZ];
      vx += (wx - vx) * k;
      vy += (wy - vy) * k;
      vz += (wz - vz) * k - d[o + F.GRAV] * dt;
      let px = d[o + F.PX] + vx * dt;
      let py = d[o + F.PY] + vy * dt;
      let pz = d[o + F.PZ] + vz * dt;
      const ground = d[o + F.GROUND];
      if (pz < ground) {
        pz = ground;
        if (vz < 0) vz = 0;
        vx *= 0.85;
        vy *= 0.85;
      }
      d[o + F.PX] = px; d[o + F.PY] = py; d[o + F.PZ] = pz;
      d[o + F.VX] = vx; d[o + F.VY] = vy; d[o + F.VZ] = vz;
      d[o + F.ROT] += d[o + F.SPIN] * dt;
      i++;
    }
  }

  private kill(i: number): void {
    const last = this.live - 1;
    if (i !== last) {
      this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
    }
    this.live = last;
  }

  /** Vacía el sistema (cambio de batería, limpieza). */
  clear(): void {
    this.live = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  /**
   * Prepara el dibujo del frame: tamaño/color/alfa actuales, oclusión,
   * orden (humo) y subida de atributos. Devuelve true si hay algo visible.
   */
  prepare(ctx: RenderCtx): boolean {
    const n = this.live;
    if (n === 0) {
      this.geo.instanceCount = 0;
      this.mesh.visible = false;
      return false;
    }
    const d = this.data;
    const occ = ctx.occlusionFresh ? ctx.occlusion : null;
    const visRate = 1 - Math.exp(-ctx.dt * 9);
    const cx = ctx.camEnu.x, cy = ctx.camEnu.y, cz = ctx.camEnu.z;
    const fx = ctx.camDirEnu.x, fy = ctx.camDirEnu.y, fz = ctx.camDirEnu.z;
    const smoke = this.kind === 'smoke';
    let maxDepth = 1;

    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const age = d[o + F.AGE];
      const gtau = d[o + F.GTAU];
      const grow = d[o + F.GROW];
      const size = d[o + F.SIZE] + (gtau > 0 ? grow * gtau * (1 - Math.exp(-age / gtau)) : grow * age);
      d[o + F.CURSIZE] = size;
      if (occ) {
        const px = d[o + F.PX], py = d[o + F.PY], pz = d[o + F.PZ];
        const r = size * 0.45;
        let v = occ.test(px, py, pz, r);
        if (v !== 1) {
          // La cima de la bocanada asoma por encima de la cresta.
          const top = occ.test(px, py, pz + size * 0.4, r * 0.6);
          if (top === 1) v = 0.65;
          else if (v === -1) v = top;
        }
        if (v >= 0) d[o + F.VIST] = v;
      }
      d[o + F.VIS] += (d[o + F.VIST] - d[o + F.VIS]) * visRate;
      if (smoke) {
        const dep = (d[o + F.PX] - cx) * fx + (d[o + F.PY] - cy) * fy + (d[o + F.PZ] - cz) * fz;
        this.depth[i] = dep;
        if (dep > maxDepth) maxDepth = dep;
      }
    }

    // Orden de atrás adelante (solo el humo): clave = profundidad cuantizada
    // en 20 bits | índice en 12 bits → sort numérico nativo, sin comparador
    // ni asignaciones.
    let order: Uint32Array | null = null;
    if (smoke) {
      const q = 1048575 / maxDepth;
      for (let i = 0; i < n; i++) {
        const dep = this.depth[i];
        const qd = dep <= 0 ? 0 : Math.min(1048575, Math.floor(dep * q));
        this.keys[i] = ((1048575 - qd) << 12 | i) >>> 0; // lejano primero
      }
      order = this.keys.subarray(0, n);
      order.sort();
    }

    const P = this.aPos.array as Float32Array;
    const SR = this.aSR.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    let w = 0;
    for (let j = 0; j < n; j++) {
      const i = order ? (order[j] & 4095) : j;
      const o = i * STRIDE;
      const age = d[o + F.AGE];
      const life = d[o + F.LIFE];
      const t = age / life;
      const fin = Math.min(1, age / d[o + F.FIN]);
      const fo = d[o + F.FOUT];
      const fadeT = t <= fo ? 0 : (t - fo) / (1 - fo);
      const fade = 1 - fadeT * fadeT * (3 - 2 * fadeT);
      const a = d[o + F.ALPHA] * fin * fade * d[o + F.VIS];
      if (a < 0.002) continue;
      const ck = Math.min(1, age / d[o + F.CTAU]);
      P[w * 3] = d[o + F.PX];
      P[w * 3 + 1] = d[o + F.PY];
      P[w * 3 + 2] = d[o + F.PZ];
      SR[w * 4] = d[o + F.CURSIZE];
      SR[w * 4 + 1] = d[o + F.ROT];
      SR[w * 4 + 2] = d[o + F.STRETCH];
      SR[w * 4 + 3] = d[o + F.VAR];
      C[w * 4] = d[o + F.R0] + (d[o + F.R1] - d[o + F.R0]) * ck;
      C[w * 4 + 1] = d[o + F.G0] + (d[o + F.G1] - d[o + F.G0]) * ck;
      C[w * 4 + 2] = d[o + F.B0] + (d[o + F.B1] - d[o + F.B0]) * ck;
      C[w * 4 + 3] = a;
      V[w * 3] = d[o + F.VX];
      V[w * 3 + 1] = d[o + F.VY];
      V[w * 3 + 2] = d[o + F.VZ];
      const heat = d[o + F.HEAT];
      M[w * 2] = heat > 0 ? heat * Math.exp(-age / d[o + F.HTAU]) : (smoke ? 0 : 0.6);
      M[w * 2 + 1] = d[o + F.LIT];
      w++;
    }
    this.geo.instanceCount = w;
    this.mesh.visible = w > 0;
    if (w === 0) return false;
    for (const a of [this.aPos, this.aSR, this.aCol, this.aVel, this.aMisc]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, w * a.itemSize);
      a.needsUpdate = true;
    }
    this.updateUniforms(ctx);
    return true;
  }

  private updateUniforms(ctx: RenderCtx): void {
    const lights = ctx.lights;
    const nLights = Math.min(4, lights.length);
    const u = this.material.uniforms;
    const L = ctx.lighting;
    u.uFogDensity.value = L.fogDensity;
    if (this.kind !== 'smoke') return;
    const view = ctx.viewFromEnu;
    (u.uKeyDirV.value as THREE.Vector3).copy(L.keyEnu).transformDirection(view);
    (u.uUpV.value as THREE.Vector3).set(0, 0, 1).transformDirection(view);
    const k = L.keyIntensity / 3; // 3 = sol pleno
    (u.uKeyCol.value as THREE.Vector3).set(L.keyColor.r * k * 0.95, L.keyColor.g * k * 0.95, L.keyColor.b * k * 0.95);
    const amb = L.ambientIntensity * 0.42;
    (u.uSkyCol.value as THREE.Vector3).set(L.skyColor.r * amb, L.skyColor.g * amb, L.skyColor.b * amb);
    (u.uGroundCol.value as THREE.Vector3).set(L.groundColor.r * amb, L.groundColor.g * amb, L.groundColor.b * amb);
    (u.uHaze.value as THREE.Vector3).set(L.hazeColor.r, L.hazeColor.g, L.hazeColor.b);
    const pl = u.uPL.value as THREE.Vector4[];
    const plc = u.uPLc.value as THREE.Vector3[];
    for (let i = 0; i < 4; i++) {
      if (i < nLights) {
        const l = lights[i];
        tmpV.set(l.x, l.y, l.z).applyMatrix4(view);
        pl[i].set(tmpV.x, tmpV.y, tmpV.z, l.radius);
        plc[i].set(l.r * l.intensity, l.g * l.intensity, l.b * l.intensity);
      } else {
        plc[i].set(0, 0, 0);
      }
    }
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
//  Escombros: terrones/fragmentos PBR instanciados con balística simple.
// ---------------------------------------------------------------------------
const DF = {
  PX: 0, PY: 1, PZ: 2, VX: 3, VY: 4, VZ: 5, AGE: 6, LIFE: 7, SIZE: 8,
  AX: 9, AY: 10, AZ: 11, ANG: 12, SPIN: 13, GROUND: 14, REST: 15, VIS: 16, VIST: 17,
} as const;
const DSTRIDE = 18;

export class DebrisSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly data: Float32Array;
  private live = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly tint = new THREE.Color();

  constructor(parent: THREE.Object3D, readonly capacity: number) {
    this.data = new Float32Array(capacity * DSTRIDE);
    // Terrón: icosaedro deformado (irregular, pocos triángulos).
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.7 + ((i * 7919) % 13) / 13 * 0.6;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * (0.6 + 0.4 * k), pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 0.95, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  get count(): number { return this.live; }

  /** Lanza un fragmento. `ground` = cota del suelo donde reposará. */
  emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    size: number, life: number, ground: number, shade = 1,
  ): boolean {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const o = i * DSTRIDE;
    const d = this.data;
    d[o + DF.PX] = x; d[o + DF.PY] = y; d[o + DF.PZ] = z;
    d[o + DF.VX] = vx; d[o + DF.VY] = vy; d[o + DF.VZ] = vz;
    d[o + DF.AGE] = 0; d[o + DF.LIFE] = life; d[o + DF.SIZE] = size;
    const ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5;
    const l = Math.hypot(ax, ay, az) || 1;
    d[o + DF.AX] = ax / l; d[o + DF.AY] = ay / l; d[o + DF.AZ] = az / l;
    d[o + DF.ANG] = Math.random() * 6.28;
    d[o + DF.SPIN] = (Math.random() - 0.5) * 18;
    d[o + DF.GROUND] = ground;
    d[o + DF.REST] = 0;
    d[o + DF.VIS] = 1;
    d[o + DF.VIST] = 1;
    if (this.mesh.instanceColor || shade !== 1) {
      this.mesh.setColorAt(i, this.tint.setScalar(shade));
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    return true;
  }

  update(dt: number): void {
    const d = this.data;
    const g = 9.80665;
    let i = 0;
    while (i < this.live) {
      const o = i * DSTRIDE;
      const age = d[o + DF.AGE] + dt;
      if (age >= d[o + DF.LIFE]) {
        const last = this.live - 1;
        if (i !== last) d.copyWithin(o, last * DSTRIDE, last * DSTRIDE + DSTRIDE);
        this.live = last;
        continue;
      }
      d[o + DF.AGE] = age;
      if (d[o + DF.REST] < 0.5) {
        // Arrastre cuadrático suave (los terrones grandes frenan menos).
        const vx = d[o + DF.VX], vy = d[o + DF.VY], vz = d[o + DF.VZ];
        const sp = Math.hypot(vx, vy, vz);
        const kd = Math.min(0.5, (0.012 / Math.max(0.05, d[o + DF.SIZE])) * sp * dt);
        d[o + DF.VX] = vx * (1 - kd);
        d[o + DF.VY] = vy * (1 - kd);
        d[o + DF.VZ] = vz * (1 - kd) - g * dt;
        d[o + DF.PX] += d[o + DF.VX] * dt;
        d[o + DF.PY] += d[o + DF.VY] * dt;
        d[o + DF.PZ] += d[o + DF.VZ] * dt;
        d[o + DF.ANG] += d[o + DF.SPIN] * dt;
        if (d[o + DF.PZ] < d[o + DF.GROUND]) {
          d[o + DF.PZ] = d[o + DF.GROUND];
          if (Math.abs(d[o + DF.VZ]) < 4) {
            d[o + DF.REST] = 1; // reposa
          } else {
            d[o + DF.VZ] = -d[o + DF.VZ] * 0.25;
            d[o + DF.VX] *= 0.45;
            d[o + DF.VY] *= 0.45;
            d[o + DF.SPIN] *= 0.5;
          }
        }
      }
      i++;
    }
  }

  clear(): void {
    this.live = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  prepare(ctx: RenderCtx): boolean {
    const n = this.live;
    if (n === 0) {
      this.mesh.count = 0;
      this.mesh.visible = false;
      return false;
    }
    const d = this.data;
    const occ = ctx.occlusionFresh ? ctx.occlusion : null;
    const visRate = 1 - Math.exp(-ctx.dt * 9);
    for (let i = 0; i < n; i++) {
      const o = i * DSTRIDE;
      if (occ) {
        const v = occ.test(d[o + DF.PX], d[o + DF.PY], d[o + DF.PZ], d[o + DF.SIZE]);
        if (v >= 0) d[o + DF.VIST] = v;
      }
      d[o + DF.VIS] += (d[o + DF.VIST] - d[o + DF.VIS]) * visRate;
      const t = d[o + DF.AGE] / d[o + DF.LIFE];
      // Se hunden/encogen al final (asentados entre el polvo).
      const shrink = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      const sc = d[o + DF.SIZE] * shrink * (d[o + DF.VIS] > 0.5 ? 1 : 0);
      this.axis.set(d[o + DF.AX], d[o + DF.AY], d[o + DF.AZ]);
      this.q.setFromAxisAngle(this.axis, d[o + DF.ANG]);
      this.p.set(d[o + DF.PX], d[o + DF.PY], d[o + DF.PZ]);
      this.s.set(sc, sc, sc);
      this.m4.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
    return true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
