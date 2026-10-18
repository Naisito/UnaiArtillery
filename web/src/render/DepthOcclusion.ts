// ============================================================================
//  DepthOcclusion.ts — Oclusión del contenido Three tras el relieve.  [V2 VFX]
//
//  PROBLEMA: Three pinta en un canvas aparte, sin el z-buffer de Cesium: un
//  proyectil, una explosión o una estela DETRÁS de una cresta se dibujaban
//  encima de la montaña.
//
//  SOLUCIÓN (exacta contra lo que Cesium HA PINTADO — relieve a su LOD
//  real, edificios 3D de Google y el propio modelo del arma):
//   1. En postRender, un pase de Cesium (DrawCommand de cuadro completo, API
//      de su propio Context: no se rompe su caché de estado) reduce la
//      textura de profundidad de picking (PickDepth, log-depth empaquetada
//      RGBA8) a ~480 px de ancho tomando el MÁXIMO (lo más lejano) de cada
//      bloque k×k — conservador: un objeto solo se oculta si TODO el bloque
//      está delante de él (siluetas finas y bordes de cresta no lo tapan).
//   2. Lectura ASÍNCRONA (WebGL2: PIXEL_PACK_BUFFER + fenceSync): sin parón
//      del pipeline; los datos llegan 1-2 frames después y se evalúan con la
//      cámara instantánea del frame en que se pidieron. WebGL1: readPixels
//      síncrono del buffer reducido (pequeño).
//   3. test(x,y,z,r) proyecta un punto ENU, decodifica la log-depth a
//      distancia de vista y compara con margen (radio + 0.4 % de distancia):
//      1 visible, 0 tapado, -1 sin dato. Los sistemas de partículas y los
//      proyectiles suavizan ese 0/1 en el tiempo (fundido sin parpadeos).
//
//  COSTE: un pase de ~480×270 píxeles con k² lecturas cada N frames (N por
//  calidad) + ~0.5 MB de copia asíncrona. Sin coste si no hay contenido
//  Three que probar (el overlay no lo pide).
//
//  LIMITACIONES: usa el frustum 0 de Cesium (con log-depth casi siempre hay
//  uno solo; si hubiera más, lo de frustums lejanos no ocluye); la oclusión
//  es por partícula/objeto (centro + cima), no por píxel.
// ============================================================================
import * as Cesium from 'cesium';

/** Clases del renderer de Cesium exportadas en runtime pero sin tipos públicos. */
interface FramebufferManagerLike {
  update(context: unknown, width: number, height: number): void;
  readonly framebuffer: unknown;
  destroy(): void;
}
const CesiumPrivate = Cesium as unknown as {
  FramebufferManager: new (o?: Record<string, unknown>) => FramebufferManagerLike;
  RenderState: { fromCache(o?: Record<string, unknown>): unknown };
};

/** Cámara instantánea en ENU (la escribe el overlay cada frame). */
export interface CameraSnapshotEnu {
  cx: number; cy: number; cz: number;
  /** Base ortonormal en ENU: derecha, arriba, adelante (dirección de vista). */
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  fx: number; fy: number; fz: number;
  /** Proyección de Cesium (columna mayor): elementos usados. */
  m0: number; m4: number; m8: number; m12: number;
  m1: number; m5: number; m9: number; m13: number;
}

interface Snap extends CameraSnapshotEnu {
  near: number;
  /** log2(far - near + 1) del frustum 0. */
  L: number;
}

interface CesiumInternals {
  context: {
    _gl: WebGL2RenderingContext | WebGLRenderingContext;
    webgl2: boolean;
    drawingBufferWidth: number;
    drawingBufferHeight: number;
    createViewportQuadCommand(fs: string, o: Record<string, unknown>): {
      execute(ctx: unknown): void;
      framebuffer: unknown;
      renderState: unknown;
      shaderProgram?: { destroy(): void };
    };
  };
  view: {
    pickDepths: { _framebuffer?: { getColorTexture(i: number): unknown }; framebuffer?: unknown }[];
    frustumCommandsList: { near: number; far: number }[];
  };
}

const DOWNSAMPLE_FS = `
uniform highp sampler2D u_depth;
uniform vec3 u_params; // (k, srcW, srcH)
in vec2 v_textureCoordinates;
void main() {
  int k = int(u_params.x);
  ivec2 maxc = ivec2(int(u_params.y) - 1, int(u_params.z) - 1);
  ivec2 base = ivec2(gl_FragCoord.xy) * k;
  float farD = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= k) break;
    for (int i = 0; i < 8; i++) {
      if (i >= k) break;
      ivec2 c = min(base + ivec2(i, j), maxc);
      float d = czm_unpackDepth(texelFetch(u_depth, c, 0));
      // Cielo / nada pintado = infinitamente lejos.
      d = (d <= 0.0 || d >= 1.0) ? 1.0 : d;
      farD = max(farD, d);
    }
  }
  out_FragColor = farD >= 1.0 ? vec4(0.0) : czm_packDepth(farD);
}
`;

export class DepthOcclusion {
  private readonly gl: WebGL2RenderingContext | WebGLRenderingContext;
  private readonly webgl2: boolean;
  private fbm: FramebufferManagerLike | null = null;
  private cmd: ReturnType<CesiumInternals['context']['createViewportQuadCommand']> | null = null;
  private srcTexture: unknown = null;
  private params = new Cesium.Cartesian3();
  private w = 0;
  private h = 0;
  private k = 4;

  private pbo: WebGLBuffer | null = null;
  private pboBytes = 0;
  private sync: WebGLSync | null = null;
  private pendingSnap: Snap | null = null;
  private pendingW = 0;
  private pendingH = 0;

  /** Datos vigentes (los de la última lectura completada). */
  private buf = new Uint8Array(0);
  private cur: Snap | null = null;
  private curW = 0;
  private curH = 0;
  private failed = false;
  /** Frames desde la última lectura completada (para caducar datos viejos). */
  private ageFrames = 1e9;

  constructor(private readonly viewer: Cesium.Viewer) {
    const internals = viewer.scene as unknown as CesiumInternals;
    this.gl = internals.context._gl;
    this.webgl2 = !!internals.context.webgl2;
  }

  /** ¿Hay datos de profundidad razonablemente frescos? */
  get hasData(): boolean {
    return this.cur !== null && this.ageFrames < 30;
  }

  /**
   * Llamar en postRender (tras pintar Cesium). Recoge una lectura pendiente
   * si ya llegó y, si `issue`, lanza otra. Devuelve true si hay datos nuevos.
   */
  update(snap: CameraSnapshotEnu, issue: boolean): boolean {
    if (this.failed) return false;
    this.ageFrames++;
    let fresh = false;
    try {
      fresh = this.collect();
      if (issue && this.sync === null) this.issue(snap);
    } catch (err) {
      // Cualquier sorpresa de internals de Cesium: se desactiva limpio (sin
      // oclusión, como antes) en vez de romper el render.
      console.warn('[DepthOcclusion] desactivada', err);
      this.failed = true;
      this.cur = null;
    }
    return fresh;
  }

  /** Lanza la reducción + lectura asíncrona de la profundidad del frame. */
  private issue(snapIn: CameraSnapshotEnu): void {
    const internals = this.viewer.scene as unknown as CesiumInternals;
    const context = internals.context;
    const view = internals.view;
    const pd = view?.pickDepths?.[0];
    const frustum = view?.frustumCommandsList?.[0];
    const tex = pd?._framebuffer?.getColorTexture(0);
    if (!pd || !frustum || !tex) return;

    const srcW = context.drawingBufferWidth;
    const srcH = context.drawingBufferHeight;
    // Bloque k×k: ~480 px de ancho de destino, k en [2, 8].
    const k = Math.min(8, Math.max(2, Math.round(srcW / 480)));
    const w = Math.max(1, Math.ceil(srcW / k));
    const h = Math.max(1, Math.ceil(srcH / k));

    if (!this.fbm) {
      this.fbm = new CesiumPrivate.FramebufferManager({ depthStencil: false });
    }
    this.fbm.update(context, w, h);
    const fb = this.fbm.framebuffer;
    this.k = k;
    this.srcTexture = tex;
    this.params.x = k;
    this.params.y = srcW;
    this.params.z = srcH;

    if (!this.cmd) {
      this.cmd = context.createViewportQuadCommand(DOWNSAMPLE_FS, {
        uniformMap: {
          u_depth: () => this.srcTexture,
          u_params: () => this.params,
        },
        owner: this,
      });
    }
    if (this.w !== w || this.h !== h || !this.cmd.renderState) {
      this.cmd.renderState = CesiumPrivate.RenderState.fromCache({
        viewport: new Cesium.BoundingRectangle(0, 0, w, h),
      });
    }
    this.w = w;
    this.h = h;
    this.cmd.framebuffer = fb;
    this.cmd.execute(context);

    const gl = this.gl;
    const bytes = w * h * 4;
    const near = frustum.near;
    const snap: Snap = { ...snapIn, near, L: Math.log2(Math.max(2, frustum.far - near + 1)) };

    // El framebuffer reducido queda ligado por Cesium (su caché lo sabe):
    // leer de él no desordena nada.
    if (this.webgl2) {
      const gl2 = gl as WebGL2RenderingContext;
      if (!this.pbo) this.pbo = gl2.createBuffer();
      gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, this.pbo);
      if (this.pboBytes !== bytes) {
        gl2.bufferData(gl2.PIXEL_PACK_BUFFER, bytes, gl2.STREAM_READ);
        this.pboBytes = bytes;
      }
      gl2.readPixels(0, 0, w, h, gl2.RGBA, gl2.UNSIGNED_BYTE, 0);
      gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
      this.sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl2.flush();
      this.pendingSnap = snap;
      this.pendingW = w;
      this.pendingH = h;
    } else {
      if (this.buf.length !== bytes) this.buf = new Uint8Array(bytes);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
      this.cur = snap;
      this.curW = w;
      this.curH = h;
      this.ageFrames = 0;
    }
  }

  /** Recoge la lectura asíncrona si la GPU ya terminó. */
  private collect(): boolean {
    if (!this.webgl2 || this.sync === null || !this.pendingSnap) return false;
    const gl2 = this.gl as WebGL2RenderingContext;
    const st = gl2.clientWaitSync(this.sync, 0, 0);
    if (st !== gl2.ALREADY_SIGNALED && st !== gl2.CONDITION_SATISFIED) {
      if (st === gl2.WAIT_FAILED) {
        gl2.deleteSync(this.sync);
        this.sync = null;
      }
      return false;
    }
    gl2.deleteSync(this.sync);
    this.sync = null;
    const bytes = this.pendingW * this.pendingH * 4;
    if (this.buf.length !== bytes) this.buf = new Uint8Array(bytes);
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, this.pbo);
    gl2.getBufferSubData(gl2.PIXEL_PACK_BUFFER, 0, this.buf, 0, bytes);
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
    this.cur = this.pendingSnap;
    this.curW = this.pendingW;
    this.curH = this.pendingH;
    this.pendingSnap = null;
    this.ageFrames = 0;
    return true;
  }

  /**
   * Visibilidad de un punto ENU de radio r contra la profundidad de Cesium:
   * 1 visible, 0 tapado por el relieve/edificios/modelos, -1 sin dato (fuera
   * de pantalla, detrás de la cámara o sin lectura todavía).
   */
  test(x: number, y: number, z: number, r: number): number {
    const s = this.cur;
    if (!s) return -1;
    const dx = x - s.cx;
    const dy = y - s.cy;
    const dz = z - s.cz;
    const zv = dx * s.fx + dy * s.fy + dz * s.fz; // distancia de vista (+ delante)
    if (zv < 0.3) return -1;
    const xv = dx * s.rx + dy * s.ry + dz * s.rz;
    const yv = dx * s.ux + dy * s.uy + dz * s.uz;
    // clip = P · (xv, yv, -zv, 1); w = zv (perspectiva).
    const ndcX = (s.m0 * xv + s.m4 * yv - s.m8 * zv + s.m12) / zv;
    const ndcY = (s.m1 * xv + s.m5 * yv - s.m9 * zv + s.m13) / zv;
    if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return -1;
    const px = Math.min(this.curW - 1, Math.floor((ndcX * 0.5 + 0.5) * this.curW));
    const py = Math.min(this.curH - 1, Math.floor((ndcY * 0.5 + 0.5) * this.curH));
    const i = (py * this.curW + px) * 4;
    const b = this.buf;
    const d = (b[i] + b[i + 1] / 255 + b[i + 2] / 65025 + b[i + 3] / 16581375) / 255;
    if (d <= 0) return 1; // cielo: nada que tape
    const zScene = Math.pow(2, d * s.L) - 1 + s.near;
    const margin = r + 0.004 * zv + 0.5;
    return zv - margin <= zScene ? 1 : 0;
  }

  /** Tamaño del bloque de reducción vigente (para depuración). */
  get blockSize(): number { return this.k; }

  destroy(): void {
    const gl2 = this.gl as WebGL2RenderingContext;
    if (this.sync) gl2.deleteSync(this.sync);
    if (this.pbo) gl2.deleteBuffer(this.pbo);
    this.fbm?.destroy();
    this.cmd?.shaderProgram?.destroy();
  }
}
