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
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

export class ModelKit {
  private readonly owned = new Set<{ dispose(): void }>();
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();

  // ---------------------------------------------------------------------------
  //  Materiales
  // ---------------------------------------------------------------------------

  /** Acero pintado (carrocería, cuna, mazas…). */
  paint(color: number, opts: MaterialOpts = {}): THREE.MeshStandardMaterial {
    return this.cachedMat(`paint:${color}:${opts.roughness}:${opts.metalness}:${opts.wear}`, () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.72,
        metalness: opts.metalness ?? 0.25,
      }),
    );
  }

  /** Acero desnudo/pavonado (tubos, mecanismos). */
  steel(color: number = PAINT.darkSteel, opts: MaterialOpts = {}): THREE.MeshStandardMaterial {
    return this.cachedMat(`steel:${color}:${opts.roughness}:${opts.metalness}`, () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.42,
        metalness: opts.metalness ?? 0.85,
      }),
    );
  }

  rubber(): THREE.MeshStandardMaterial {
    return this.cachedMat('rubber', () =>
      new THREE.MeshStandardMaterial({ color: PAINT.rubber, roughness: 0.92, metalness: 0.0 }),
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
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0 }),
    );
  }

  brass(): THREE.MeshStandardMaterial {
    return this.cachedMat('brass', () =>
      new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.35, metalness: 1.0 }),
    );
  }

  /** Polímero negro mate (culatas, guardamanos, empuñaduras). */
  polymer(color: number = 0x1e1f20): THREE.MeshStandardMaterial {
    return this.cachedMat(`polymer:${color}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.05 }),
    );
  }

  /** Material emisivo (pilotos, ópticas, marcas). */
  emissive(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
    return this.cachedMat(`emissive:${color}:${intensity}`, () =>
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.5,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  //  Geometría (todas devuelven una Mesh ya colocada según PlaceOpts)
  // ---------------------------------------------------------------------------

  /** Caja w (X) × d (Y) × h (Z), centrada en `at`. */
  box(w: number, d: number, h: number, mat: THREE.Material, opts: BoxOpts = {}): THREE.Mesh {
    const bevel = Math.min(opts.bevel ?? 0, w / 2 - 1e-4, d / 2 - 1e-4, h / 2 - 1e-4);
    const geo = bevel > 0
      ? new RoundedBoxGeometry(w, d, h, 2, bevel)
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
    const tire = this.lathe(
      [
        [radius * 0.62, -width / 2],
        [radius * 0.93, -width / 2],
        [radius, -width * 0.38],
        [radius, width * 0.38],
        [radius * 0.93, width / 2],
        [radius * 0.62, width / 2],
      ],
      this.rubber(),
      { axis: 'x', segments: 36 },
    );
    const rimMat = this.paint(opts.rimColor ?? PAINT.carcGreen, { metalness: 0.4 });
    const rim = this.cyl(radius * 0.62, radius * 0.62, width * 0.8, rimMat, { axis: 'x', segments: 24 });
    const side = opts.side ?? 1;
    const hub = this.cyl(radius * 0.22, radius * 0.16, width * 0.25, this.steel(), {
      axis: 'x', at: [side * width * 0.5, 0, 0],
    });
    g.add(tire, rim, hub);
    return this.place(g, opts);
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
    this.owned.add(geo);
    const m = new THREE.Mesh(geo, mat);
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
}

const DEG2 = Math.PI / 180;

/** Las primitivas de Three son axiales en +Y: reorienta a X o Z. */
function orientY(geo: THREE.BufferGeometry, axis: Axis): void {
  if (axis === 'z') geo.rotateX(Math.PI / 2);       // +Y → +Z
  else if (axis === 'x') geo.rotateZ(-Math.PI / 2); // +Y → +X
}
