// ============================================================================
//  kit.ts — Caja de herramientas de modelado procedural.  [V2]
//
//  API ESTABLE compartida por todos los builders de plataformas/proyectiles/
//  blancos (ver rig.ts para la convención de espacio: metros, X derecha,
//  Y adelante, Z arriba). El dueño (agente 3D-CORE) puede MEJORAR la
//  implementación (texturas PBR procedurales, desgaste, normal maps…) y
//  AÑADIR funciones, pero nunca cambiar firmas existentes: los builders se
//  escriben en paralelo contra esta API.
//
//  Todas las mallas salen con castShadow/receiveShadow y con su geometría y
//  material registrados para dispose(). Materiales cacheados por clave.
//
//  V2 (3D-CORE):
//   * Materiales con texturas PBR procedurales (runtime/texgen.ts): pintura
//     CARC con moteado, desconchones y arañazos; acero fosfatado con grano;
//     goma; banda de rodadura; antideslizante; lona; madera; camuflaje.
//     Solo map/normalMap/roughnessMap/metalnessMap → sobreviven al glTF.
//   * UV en METROS: kit.mesh() reproyecta las UV (caja por triángulo) de
//     toda malla con material texturizado → densidad de texel uniforme.
//   * El "wear" (0..1) se guarda en el material; el horneado (runtime/
//     bake.ts) lo traduce a polvo/barro por altura en colores de vértice.
//   * Ayudantes nuevos: boltRow, handle, hydraulic, stencil, nonSlip, wood,
//     chrome, uniform, camoNet.
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { projectUvMeters, UV_LOCKED } from './runtime/geom';
import {
  camoNetTexture, canvasTextures, nonSlipTextures, paintTextures, rubberTextures,
  steelTextures, stencilTexture, treadTextures, TREAD_TILE_U_M, uniformCamoTextures, woodTextures,
  type PbrSet,
} from './runtime/texgen';

export type Axis = 'x' | 'y' | 'z';
export type V3 = [number, number, number];

export interface PlaceOpts {
  /** Posición (x, y, z) del CENTRO de la pieza en el padre. */
  at?: V3;
  /** Rotación Euler XYZ en GRADOS. */
  rotDeg?: V3;
  /** Nombre del nodo (útil para depurar y para articular). */
  name?: string;
}

export interface BoxOpts extends PlaceOpts {
  /** Radio de chaflán/redondeo de aristas (m). 0 = arista viva. */
  bevel?: number;
  /** Segmentos del redondeo (defecto 2 ≈ 300 tri; 1 ≈ 108 tri para atrezo). */
  bevelSegments?: number;
}

export interface CylOpts extends PlaceOpts {
  /** Eje del cilindro (defecto 'y'). r0 queda en el extremo NEGATIVO del eje. */
  axis?: Axis;
  segments?: number;
  /** Sin tapas. */
  open?: boolean;
}

export interface LatheOpts extends PlaceOpts {
  axis?: Axis;
  segments?: number;
}

export interface ExtrudeOpts extends PlaceOpts {
  /** Chaflán de las aristas de la extrusión (m). */
  bevel?: number;
}

export interface MaterialOpts {
  roughness?: number;
  metalness?: number;
  /** 0..1 — suciedad/desgaste (el dueño del kit lo traduce a texturas). */
  wear?: number;
}

/** Colores de referencia (pinturas militares reales, aprox. sRGB). */
export const PAINT = {
  /** Verde OTAN CARC 383 (US Army). */
  carcGreen: 0x4b5320,
  /** Verde oliva (OD) clásico. */
  olive: 0x4a5236,
  /** Arena CARC 686A (desierto). */
  carcTan: 0xb59a6a,
  /** Verde ruso 4BO. */
  russianGreen: 0x4f5b3a,
  /** Negro de camuflaje OTAN tricolor. */
  camoBlack: 0x23241f,
  /** Marrón de camuflaje OTAN tricolor. */
  camoBrown: 0x4e3b2a,
  gunmetal: 0x2f3236,
  darkSteel: 0x3a3d40,
  rubber: 0x1b1c1d,
} as const;

/** Claves de userData que el horneado (runtime/bake.ts) entiende. */
export const MAT_UV_METERS = 'uaUvMeters';
export const MAT_WEAR = 'uaWear';
export const MAT_KIND = 'uaKind';

export class ModelKit {
  private readonly owned = new Set<{ dispose(): void }>();
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();

  // ---------------------------------------------------------------------------
  //  Materiales
  // ---------------------------------------------------------------------------

  /** Acero pintado (carrocería, cuna, mazas…). */
  paint(color: number, opts: MaterialOpts = {}): THREE.MeshStandardMaterial {
    const r = opts.roughness ?? 0.74;
    const m = opts.metalness ?? 0.1;
    const w = opts.wear ?? 0.5;
    return this.cachedMat(`paint:${color}:${opts.roughness}:${opts.metalness}:${opts.wear}`, () =>
      textured(new THREE.MeshStandardMaterial({ color }), paintTextures(r, m, w), r, m, 'paint', w),
    );
  }

  /** Acero desnudo/pavonado (tubos, mecanismos). */
  steel(color: number = PAINT.darkSteel, opts: MaterialOpts = {}): THREE.MeshStandardMaterial {
    const r = opts.roughness ?? 0.42;
    const m = opts.metalness ?? 0.85;
    return this.cachedMat(`steel:${color}:${opts.roughness}:${opts.metalness}`, () =>
      textured(new THREE.MeshStandardMaterial({ color }), steelTextures(r, m), r, m, 'steel', opts.wear ?? 0.3),
    );
  }

  rubber(): THREE.MeshStandardMaterial {
    return this.cachedMat('rubber', () =>
      textured(new THREE.MeshStandardMaterial({ color: PAINT.rubber }), rubberTextures(), 0.92, 0, 'rubber', 0.6),
    );
  }

  glass(): THREE.MeshStandardMaterial {
    return this.cachedMat('glass', () =>
      new THREE.MeshStandardMaterial({
        color: 0x1d2a33, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.85,
      }),
    );
  }

  /** Lona / tela (fundas, redes, asientos). */
  canvas(color: number = 0x5b5a3e): THREE.MeshStandardMaterial {
    return this.cachedMat(`canvas:${color}`, () =>
      textured(new THREE.MeshStandardMaterial({ color }), canvasTextures(), 0.95, 0, 'canvas', 0.5),
    );
  }

  brass(): THREE.MeshStandardMaterial {
    return this.cachedMat('brass', () =>
      textured(new THREE.MeshStandardMaterial({ color: 0xb08d3c }), steelTextures(0.35, 1.0), 0.35, 1.0, 'brass', 0.1),
    );
  }

  /** Polímero negro mate (culatas, guardamanos, empuñaduras). */
  polymer(color: number = 0x1e1f20): THREE.MeshStandardMaterial {
    return this.cachedMat(`polymer:${color}`, () =>
      textured(new THREE.MeshStandardMaterial({ color }), rubberTextures(), 0.78, 0.05, 'polymer', 0.2),
    );
  }

  /** Material emisivo (pilotos, ópticas, marcas). */
  emissive(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
    return this.cachedMat(`emissive:${color}:${intensity}`, () => {
      const m = new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.5,
      });
      m.userData[MAT_KIND] = 'emissive';
      return m;
    });
  }

  // -- V2: materiales nuevos ---------------------------------------------------

  /** Chapa antideslizante (pasarelas, plataformas de servicio). */
  nonSlip(color: number = 0x3b3f2c): THREE.MeshStandardMaterial {
    return this.cachedMat(`nonslip:${color}`, () =>
      textured(new THREE.MeshStandardMaterial({ color }), nonSlipTextures(), 0.95, 0.05, 'nonslip', 0.7),
    );
  }

  /** Madera de embalaje (palés, cajas de munición antiguas, mangos). */
  wood(color: number = 0x9a7a52): THREE.MeshStandardMaterial {
    return this.cachedMat(`wood:${color}`, () =>
      textured(new THREE.MeshStandardMaterial({ color }), woodTextures(), 0.85, 0, 'wood', 0.4),
    );
  }

  /** Cromo duro de vástagos hidráulicos (muy pulido). */
  chrome(): THREE.MeshStandardMaterial {
    return this.cachedMat('chrome', () =>
      textured(new THREE.MeshStandardMaterial({ color: 0xd6d8da }), steelTextures(0.18, 1.0), 0.18, 1.0, 'chrome', 0.05),
    );
  }

  /** Tela de uniforme con camuflaje tipo OCP (el color va en la textura). */
  uniform(): THREE.MeshStandardMaterial {
    return this.cachedMat('uniform', () => {
      const set = uniformCamoTextures();
      return textured(new THREE.MeshStandardMaterial({ color: set ? 0xffffff : 0x8a8064 }), set, 0.9, 0, 'cloth', 0.35);
    });
  }

  /** Red de camuflaje con recorte por alfa (glTF alphaMode MASK). */
  camoNet(): THREE.MeshStandardMaterial {
    return this.cachedMat('camonet', () => {
      const tex = camoNetTexture();
      const m = new THREE.MeshStandardMaterial({
        color: tex ? 0xffffff : 0x4e5534, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
      });
      if (tex) {
        m.map = tex;
        m.alphaTest = 0.5;
      }
      m.userData[MAT_UV_METERS] = !!tex;
      m.userData[MAT_KIND] = 'net';
      m.userData[MAT_WEAR] = 0.2;
      return m;
    });
  }

  // ---------------------------------------------------------------------------
  //  Geometría (todas devuelven una Mesh ya colocada según PlaceOpts)
  // ---------------------------------------------------------------------------

  /** Caja w (X) × d (Y) × h (Z), centrada en `at`. */
  box(w: number, d: number, h: number, mat: THREE.Material, opts: BoxOpts = {}): THREE.Mesh {
    const bevel = Math.min(opts.bevel ?? 0, w / 2 - 1e-4, d / 2 - 1e-4, h / 2 - 1e-4);
    const geo = bevel > 0
      // Redondeo de 2 segmentos solo donde se ve (piezas grandes con chaflán
      // generoso); en piezas pequeñas 1 segmento basta (108 tri vs 300).
      ? new RoundedBoxGeometry(w, d, h, opts.bevelSegments ?? (bevel >= 0.025 && Math.min(w, d, h) > 0.15 ? 2 : 1), bevel)
      : new THREE.BoxGeometry(w, d, h);
    return this.place(this.mesh(geo, mat), opts);
  }

  /**
   * Cilindro/cono a lo largo de `axis`: r0 en el extremo negativo, r1 en el
   * positivo, longitud `len`, centrado en `at`.
   */
  cyl(r0: number, r1: number, len: number, mat: THREE.Material, opts: CylOpts = {}): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(r1, r0, len, opts.segments ?? 24, 1, opts.open ?? false);
    orientY(geo, opts.axis ?? 'y');
    return this.place(this.mesh(geo, mat), opts);
  }

  /**
   * Sólido de revolución. `profile` = [[radio, posiciónEnEje], …] desde el
   * extremo negativo al positivo (cierra con radio 0 en los extremos si
   * quieres tapas). Ideal para tubos con zunchos, frenos de boca, proyectiles.
   */
  lathe(profile: Array<[number, number]>, mat: THREE.Material, opts: LatheOpts = {}): THREE.Mesh {
    const pts = profile.map(([r, a]) => new THREE.Vector2(Math.max(0, r), a));
    const geo = new THREE.LatheGeometry(pts, opts.segments ?? 32);
    orientY(geo, opts.axis ?? 'y');
    return this.place(this.mesh(geo, mat), opts);
  }

  /**
   * Silueta LATERAL extruida a lo ancho: `side` = [[y, z], …] en el plano
   * adelante-arriba (polígono cerrado, sentido indiferente), extruida
   * simétrica en X con anchura `width`. La herramienta para cascos, cunas,
   * mazas y chapas con perfil.
   */
  extrudeSide(side: Array<[number, number]>, width: number, mat: THREE.Material, opts: ExtrudeOpts = {}): THREE.Mesh {
    const shape = new THREE.Shape(side.map(([y, z]) => new THREE.Vector2(y, z)));
    const bevel = opts.bevel ?? 0;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(1e-4, width - 2 * bevel),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 12,
    });
    // (u, v, w) → (x = w − width/2 + bevel, y = u, z = v). Permutación
    // cíclica: determinante +1, no invierte caras.
    const d = width - 2 * bevel;
    geo.applyMatrix4(new THREE.Matrix4().set(
      0, 0, 1, -d / 2,
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ));
    geo.computeVertexNormals();
    return this.place(this.mesh(geo, mat), opts);
  }

  /**
   * Planta extruida hacia arriba: `plan` = [[x, y], …], altura `height`
   * desde z = 0 local (luego se coloca con `at`).
   */
  extrudePlan(plan: Array<[number, number]>, height: number, mat: THREE.Material, opts: ExtrudeOpts = {}): THREE.Mesh {
    const shape = new THREE.Shape(plan.map(([x, y]) => new THREE.Vector2(x, y)));
    const bevel = opts.bevel ?? 0;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(1e-4, height - 2 * bevel),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 12,
    });
    if (bevel > 0) geo.translate(0, 0, bevel);
    geo.computeVertexNormals();
    return this.place(this.mesh(geo, mat), opts);
  }

  /** Tubo que sigue una curva por puntos (mangueras, asas, barandillas). */
  tube(points: V3[], radius: number, mat: THREE.Material, opts: PlaceOpts & { segments?: number } = {}): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, opts.segments ?? Math.max(8, points.length * 6), radius, 10, false);
    return this.place(this.mesh(geo, mat), opts);
  }

  /** Toro (zunchos, aros, volantes). Eje del toro según `axis` (defecto 'y'). */
  torus(radius: number, tube: number, mat: THREE.Material, opts: CylOpts = {}): THREE.Mesh {
    const geo = new THREE.TorusGeometry(radius, tube, 12, opts.segments ?? 32);
    // TorusGeometry yace en XY con eje Z: llévalo al eje pedido.
    if ((opts.axis ?? 'y') === 'y') geo.rotateX(-Math.PI / 2);
    else if (opts.axis === 'x') geo.rotateY(Math.PI / 2);
    return this.place(this.mesh(geo, mat), opts);
  }

  /** Esfera (o casquete con thetaLength). */
  sphere(r: number, mat: THREE.Material, opts: PlaceOpts & { segments?: number } = {}): THREE.Mesh {
    const s = opts.segments ?? 20;
    return this.place(this.mesh(new THREE.SphereGeometry(r, s, Math.max(8, s / 2)), mat), opts);
  }

  /**
   * Rueda completa con eje en X: neumático (con banda de rodadura), llanta y
   * cubo. Devuelve un grupo centrado en el eje de la rueda.
   */
  wheel(radius: number, width: number, opts: PlaceOpts & { rimColor?: number; side?: 1 | -1 } = {}): THREE.Group {
    const g = new THREE.Group();
    g.add(this.tire(radius, width));
    const rimMat = this.paint(opts.rimColor ?? PAINT.carcGreen, { metalness: 0.3, wear: 0.6 });
    const side = opts.side ?? 1;
    const rr = radius * 0.6;
    // Llanta: disco con pestañas, rehundido hacia el exterior (+X si side=1).
    // El perfil recorre el contorno en sentido antihorario (caras hacia
    // fuera); el lado −1 se obtiene girando 180° en Z (no espejando).
    const rim = this.lathe(
      [
        [0, -width * 0.3], [rr * 0.95, -width * 0.3], [rr, -width * 0.42], [rr * 1.05, -width * 0.42],
        [rr * 1.05, width * 0.42], [rr, width * 0.42], [rr * 0.95, width * 0.2], [0, width * 0.2],
      ],
      rimMat, { axis: 'x', segments: 32 },
    );
    if (side < 0) rim.rotation.z = Math.PI;
    g.add(rim);
    // Cubo con tuercas.
    const hubR = radius * 0.2;
    g.add(this.cyl(hubR * 1.15, hubR, width * 0.16, rimMat, {
      axis: 'x', at: [side * width * 0.38, 0, 0], segments: 20,
    }));
    g.add(this.cyl(hubR * 0.55, hubR * 0.45, width * 0.1, this.steel(), {
      axis: 'x', at: [side * width * 0.5, 0, 0], segments: 14,
    }));
    const nuts = 8;
    for (let k = 0; k < nuts; k++) {
      const a = (k / nuts) * Math.PI * 2;
      g.add(this.cyl(hubR * 0.13, hubR * 0.13, width * 0.06, this.steel(), {
        axis: 'x', segments: 6,
        at: [side * width * 0.46, Math.cos(a) * hubR * 0.75, Math.sin(a) * hubR * 0.75],
      }));
    }
    return this.place(g, opts);
  }

  /**
   * Neumático todoterreno con banda de rodadura (UV cilíndricas en metros,
   * textura de tacos) y hombros redondeados, eje en X, centrado.
   */
  tire(radius: number, width: number, opts: PlaceOpts = {}): THREE.Mesh {
    const hw = width / 2;
    const rIn = radius * 0.6;
    const sh = Math.min(radius * 0.12, hw * 0.45); // radio del hombro
    const prof: Array<[number, number]> = [[rIn, -hw * 0.92], [radius * 0.8, -hw]];
    const steps = 4;
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * (Math.PI / 2);
      prof.push([radius - sh + Math.sin(a) * sh, -hw + sh - Math.cos(a) * sh]);
    }
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * (Math.PI / 2);
      prof.push([radius - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh]);
    }
    prof.push([radius * 0.8, hw], [rIn, hw * 0.92]);
    const segs = 56;
    const pts = prof.map(([r, a]) => new THREE.Vector2(r, a));
    const geo = new THREE.LatheGeometry(pts, segs);
    // UV propias: u = arco (m, escalado para cerrar en número entero de
    // tacos), v = banda de rodadura o flanco según la normal.
    const nLugs = Math.max(8, Math.round((2 * Math.PI * radius) / TREAD_TILE_U_M));
    const uScale = (nLugs * TREAD_TILE_U_M) / (2 * Math.PI);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    geo.computeVertexNormals();
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // LatheGeometry gira alrededor de Y: u de la lathe = fracción angular.
      const u = uv.getX(i) * 2 * Math.PI * uScale;
      const radial = Math.abs(nor.getY(i)) < 0.6;
      const v = radial ? 0.25 + (y / hw) * 0.24 : 0.5 + Math.min(0.48, (radius - r) * 1.5);
      uv.setXY(i, u, v);
    }
    geo.userData[UV_LOCKED] = true;
    orientY(geo, 'x');
    const mesh = this.mesh(geo, this.treadRubber());
    return this.place(mesh, opts);
  }

  // ---------------------------------------------------------------------------
  //  V2: ayudantes de detalle (opcionales, para quien quiera adoptarlos)
  // ---------------------------------------------------------------------------

  /**
   * Fila de pernos hexagonales de `from` a `to` (centros), cabezas mirando
   * a lo largo de `normal` ('x'|'y'|'z', sentido +; usa rotDeg en el grupo
   * para otros). Devuelve un grupo (el horneado los funde en una malla).
   */
  boltRow(from: V3, to: V3, count: number, headR: number, mat: THREE.Material,
    opts: PlaceOpts & { normal?: Axis; headH?: number } = {}): THREE.Group {
    const g = new THREE.Group();
    const n = Math.max(1, count);
    const hh = opts.headH ?? headR * 0.7;
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0.5 : k / (n - 1);
      const p: V3 = [
        from[0] + (to[0] - from[0]) * f,
        from[1] + (to[1] - from[1]) * f,
        from[2] + (to[2] - from[2]) * f,
      ];
      g.add(this.cyl(headR, headR, hh, mat, { axis: opts.normal ?? 'z', segments: 6, at: p }));
    }
    return this.place(g, opts);
  }

  /**
   * Asa en U de barra redonda: vano `span` a lo largo de X, separada `depth`
   * de la superficie hacia +Z (patas hacia −Z). Rota con rotDeg.
   */
  handle(span: number, depth: number, r: number, mat: THREE.Material, opts: PlaceOpts = {}): THREE.Mesh {
    const s = span / 2, b = Math.min(r * 2.5, depth * 0.45);
    return this.place(this.tube([
      [-s, 0, 0], [-s, 0, depth - b], [-s + b * 0.3, 0, depth - b * 0.3], [-s + b, 0, depth],
      [s - b, 0, depth], [s - b * 0.3, 0, depth - b * 0.3], [s, 0, depth - b], [s, 0, 0],
    ], r, mat, { segments: 48 }), opts);
  }

  /**
   * Cilindro hidráulico entre dos puntos del MISMO padre: camisa pintada
   * desde `p0` y vástago cromado hasta `p1`, con ojos de anclaje. Estático;
   * para uno articulado usa `HydraulicRam`.
   */
  hydraulic(p0: V3, p1: V3, rBody: number, mat: THREE.Material, opts: { rodR?: number; bodyFrac?: number; name?: string } = {}): THREE.Group {
    const ram = new HydraulicRam(this, rBody, (opts.rodR ?? rBody * 0.55), mat, {
      bodyLen: Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) * (opts.bodyFrac ?? 0.6),
    });
    ram.update(new THREE.Vector3(...p0), new THREE.Vector3(...p1));
    if (opts.name) ram.root.name = opts.name;
    return ram.root;
  }

  /**
   * Rótulo de plantilla (texto militar genérico: "NO STEP", "155MM", …) en
   * un plano de altura `heightM`; el plano mira a −Y (se lee desde −Y, texto
   * a lo largo de +X). Usa `at` un par de mm fuera de la superficie.
   */
  stencil(text: string, heightM: number, opts: PlaceOpts & { color?: string } = {}): THREE.Mesh {
    const st = stencilTexture(text, opts.color);
    const aspect = st?.aspect ?? Math.max(1, text.length * 0.6);
    const geo = new THREE.PlaneGeometry(heightM * aspect, heightM);
    geo.rotateX(Math.PI / 2); // plano XY (normal +Z) → plano XZ con normal −Y
    geo.userData[UV_LOCKED] = true;
    const key = `stencil:${text}:${opts.color ?? ''}`;
    const mat = this.cachedMat(key, () => {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.8, metalness: 0,
        transparent: false, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2,
      });
      if (st) m.map = st.tex;
      else m.visible = false;
      m.userData[MAT_KIND] = 'decal';
      m.userData[MAT_WEAR] = 0.4;
      return m;
    });
    const mesh = this.mesh(geo, mat);
    mesh.castShadow = false;
    return this.place(mesh, opts);
  }

  // ---------------------------------------------------------------------------
  //  Grupos y utilidades
  // ---------------------------------------------------------------------------

  /** Grupo vacío colocado (para pivotes y sub-ensamblajes). */
  group(opts: PlaceOpts = {}): THREE.Group {
    return this.place(new THREE.Group(), opts);
  }

  /** Coloca/rota/nombra cualquier objeto. */
  place<T extends THREE.Object3D>(obj: T, opts: PlaceOpts = {}): T {
    if (opts.at) obj.position.set(...opts.at);
    if (opts.rotDeg) {
      obj.rotation.set(opts.rotDeg[0] * DEG2, opts.rotDeg[1] * DEG2, opts.rotDeg[2] * DEG2);
    }
    if (opts.name) obj.name = opts.name;
    return obj;
  }

  /** Registra algo para dispose() (geometrías/texturas creadas a mano). */
  own<T extends { dispose(): void }>(thing: T): T {
    this.owned.add(thing);
    return thing;
  }

  /** Malla con sombras y geometría registrada. */
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    let g = geo;
    // UV en metros para todo material con textura de tesela (ver texgen.ts).
    if (mat.userData?.[MAT_UV_METERS] && !geo.userData?.[UV_LOCKED]) {
      g = projectUvMeters(geo);
      geo.dispose();
    }
    this.owned.add(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Libera todo lo creado por este kit. */
  dispose(): void {
    for (const d of this.owned) d.dispose();
    this.owned.clear();
    for (const m of this.matCache.values()) m.dispose();
    this.matCache.clear();
  }

  protected cachedMat(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    let m = this.matCache.get(key);
    if (!m) {
      m = make();
      m.name = key;
      this.matCache.set(key, m);
    }
    return m;
  }

  /** Goma de banda de rodadura (UV cilíndricas propias). */
  private treadRubber(): THREE.MeshStandardMaterial {
    return this.cachedMat('rubber:tread', () => {
      const m = textured(new THREE.MeshStandardMaterial({ color: PAINT.rubber }), treadTextures(), 0.9, 0, 'rubber', 0.7);
      return m;
    });
  }
}

/**
 * Cilindro hidráulico ARTICULABLE: `root` (camisa, eje +Y local) y `rod`
 * (vástago, hijo de root). `update(p0, p1)` (puntos en el espacio del padre
 * de root) reorienta ambos; añade `root` y `rod` a `extraAnimated` del rig.
 */
export class HydraulicRam {
  readonly root = new THREE.Group();
  readonly rod = new THREE.Group();
  private readonly bodyLen: number;
  private readonly tmp = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(kit: ModelKit, rBody: number, rRod: number, bodyMat: THREE.Material,
    opts: { bodyLen: number; rodLen?: number }) {
    this.bodyLen = opts.bodyLen;
    const rodLen = opts.rodLen ?? opts.bodyLen * 1.05;
    // Camisa: ojo trasero + cilindro + culata delantera (prensaestopas).
    this.root.add(kit.cyl(rBody * 0.9, rBody * 0.9, rBody * 1.6, bodyMat, { axis: 'x', segments: 16 }));
    this.root.add(kit.cyl(rBody, rBody, this.bodyLen, bodyMat, { at: [0, this.bodyLen / 2, 0], segments: 20 }));
    this.root.add(kit.cyl(rBody * 1.12, rBody * 1.12, rBody * 0.6, bodyMat, {
      at: [0, this.bodyLen - rBody * 0.3, 0], segments: 20,
    }));
    this.root.add(kit.cyl(rBody * 1.12, rBody * 1.12, rBody * 0.5, bodyMat, { at: [0, rBody * 0.6, 0], segments: 20 }));
    // Vástago: de su ojo (origen, en p1) hacia −Y, dentro de la camisa.
    this.rod.add(kit.cyl(rRod, rRod, rodLen, kit.chrome(), { at: [0, -rodLen / 2, 0], segments: 16 }));
    this.rod.add(kit.cyl(rRod * 1.5, rRod * 1.5, rRod * 2.6, bodyMat, { axis: 'x', segments: 14 }));
    this.root.add(this.rod);
  }

  /** Reorienta: camisa anclada en p0, vástago llegando a p1. */
  update(p0: THREE.Vector3, p1: THREE.Vector3): void {
    this.root.position.copy(p0);
    const d = this.tmp.subVectors(p1, p0);
    const len = d.length();
    if (len < 1e-6) return;
    this.root.quaternion.setFromUnitVectors(this.yAxis, d.multiplyScalar(1 / len));
    this.rod.position.set(0, len, 0);
  }

  /** Longitud de la camisa (m). */
  get length(): number { return this.bodyLen; }
}

const DEG2 = Math.PI / 180;

/** Aplica un juego PBR (o factores planos si no hay DOM). */
function textured(m: THREE.MeshStandardMaterial, set: PbrSet | null, roughness: number, metalness: number,
  kind: string, wear: number): THREE.MeshStandardMaterial {
  if (set) {
    m.map = set.map;
    m.normalMap = set.normal;
    m.normalScale.set(set.normalScale, set.normalScale);
    // ORM con valores ABSOLUTOS (G rugosidad, B metal): factores a 1.
    m.roughnessMap = set.orm;
    m.metalnessMap = set.orm;
    m.roughness = 1;
    m.metalness = 1;
    m.userData[MAT_UV_METERS] = true;
  } else {
    m.roughness = roughness;
    m.metalness = metalness;
  }
  m.userData[MAT_KIND] = kind;
  m.userData[MAT_WEAR] = wear;
  return m;
}

/** Las primitivas de Three son axiales en +Y: reorienta a X o Z. */
function orientY(geo: THREE.BufferGeometry, axis: Axis): void {
  if (axis === 'z') geo.rotateX(Math.PI / 2);       // +Y → +Z
  else if (axis === 'x') geo.rotateZ(-Math.PI / 2); // +Y → +X
}
