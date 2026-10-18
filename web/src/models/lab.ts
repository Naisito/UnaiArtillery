// ============================================================================
//  lab.ts — Model Lab: banco de pruebas de los modelos 3D (solo desarrollo).
//
//  Abre /model-lab.html en el dev server de Vite. Parámetros de URL:
//    ?model=<PlatformKey>      plataforma (m777, m109a7, m142-himars, …)
//    ?weapon=<WeaponId>        alternativa: el arma (elige su plataforma/variante)
//    ?projectile=<WeaponId>    muestra el proyectil de ese arma (escala ×N auto)
//    ?target=truck             muestra el blanco móvil
//    &az=30&el=25&recoil=0     pose (grados; recoil 0..1)
//    &view=34|side|front|rear|top|close|muzzle   encuadre
//    &sheet=1                  hoja de contacto 3×2 con seis vistas
//    &muzzle=1                 esfera roja en la boca calculada (verifica muzzleLocal)
//    &bg=sky|white|dark
//  V2 (3D-CORE):
//    &raw=1                    rig SIN hornear (por defecto se ve horneado, como en la app)
//    &glb=1                    ida y vuelta: horneado → GLB → GLTFLoader (caza fallos del exportador)
//    &props=0|1                atrezo de batería (defecto 1 en plataformas)
//    &lay=<grados>             azimut de asentamiento del afuste (M777: silla ±23°)
//    &spin=1                   plato giratorio · &ui=0 sin panel
//  Arrastrar orbita (OrbitControls). window.__labReady = true tras pintar
//  (para tools/shot.mjs --ready __labReady). Panel con medidas, triángulos,
//  draw calls (crudo vs horneado), materiales, nodos y tamaño del GLB.
//  window.__lab expone { gun, setPose(az, el, recoil01), render() }.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WeaponCatalog } from '../ballistics';
import type { WeaponId } from '../ballistics';
import { GunModel } from '../GunModel';
import { ModelKit } from './kit';
import { PLATFORM_OF, weaponForPlatform } from './platforms';
import { buildProjectile } from './projectiles';
import type { PlatformKey } from './rig';
import { ArticulatedModel } from './runtime/ArticulatedModel';
import { exportGlb } from './runtime/glb';
import { buildTargetTruck } from './targets';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const flag = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== '0' : d);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const bg = q.get('bg') ?? 'sky';
scene.background = new THREE.Color(bg === 'white' ? 0xf2f2f2 : bg === 'dark' ? 0x111418 : 0x9fb6c8);

// Luz: sol cálido con sombras + cielo/suelo.
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// Suelo: tierra neutra + rejilla de 1 m (referencia de escala).
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 }),
);
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x3d3a30, 0x55513f);
grid.rotation.x = Math.PI / 2;
grid.position.z = 0.002;
scene.add(grid);

const kit = new ModelKit();
const subject = new THREE.Group();
scene.add(subject);

let gun: GunModel | null = null;
let other: ArticulatedModel | null = null;
let label = '';
let az = num('az', 0);
let el = num('el', 15);
let recoil01 = num('recoil', 0);
const raw = q.get('raw') === '1';
const glbMode = q.get('glb') === '1';
const lay = q.has('lay') ? num('lay', 0) : null;

/** Nodos del GLB re-cargado (ida y vuelta), por nombre. */
let glbNodes: Map<string, THREE.Object3D> | null = null;
let glbInfo = '';

function articulated(): ArticulatedModel | null {
  return other ?? gun?.articulated ?? null;
}

if (q.has('projectile')) {
  const wid = q.get('projectile') as WeaponId;
  const w = WeaponCatalog.get(wid);
  const p = buildProjectile(kit, wid, w);
  const s = Math.max(1, 1.2 / p.lengthM); // escala para verlo: ~1.2 m en pantalla
  p.root.scale.setScalar(s);
  p.root.position.z = 0.6;
  if (raw) subject.add(p.root);
  else other = new ArticulatedModel({ key: `lab:proj:${wid}`, root: p.root, threeParent: subject, grime: false, mode: 'three' });
  label = `proyectil ${wid} · L=${p.lengthM.toFixed(3)} m · escala ×${s.toFixed(1)}`;
} else if (q.has('target')) {
  const t = buildTargetTruck(kit);
  if (raw) subject.add(t.root);
  else other = new ArticulatedModel({ key: 'lab:truck', root: t.root, animated: t.wheels, threeParent: subject, mode: 'three' });
  label = 'blanco: camión';
} else {
  const key = (q.get('model') as PlatformKey | null)
    ?? PLATFORM_OF[(q.get('weapon') as WeaponId | null) ?? 'm777'];
  const wid = (q.get('weapon') as WeaponId | null) ?? weaponForPlatform(key);
  const weapon = WeaponCatalog.get(wid);
  gun = new GunModel(subject, weapon, { weaponId: wid, props: flag('props', true), mode: 'three' });
  if (raw) {
    // Vista cruda: el rig fuente tal cual (sin hornear ni atrezo).
    const rig = gun.rig!;
    subject.remove(gun.group);
    subject.add(rig.root);
  }
  label = `${key} (${wid})`;
}

/** Aplica la pose (az, el, recoil) al rig + sincroniza la vista. */
function setPose(a: number, e: number, r: number): void {
  az = a; el = e; recoil01 = r;
  if (gun) {
    if (lay !== null) gun.update(0, lay, e); // asienta el afuste antes de dirigir
    gun.previewRecoil(r);
    gun.update(0, a, e);
    if (raw) gun.rig!.root.updateMatrixWorld(true);
  }
  syncGlb();
}

function syncGlb(): void {
  const am = articulated();
  if (!glbNodes || !am) return;
  const m = new THREE.Matrix4();
  for (const n of am.baked.animatedNodes) {
    const node = glbNodes.get(n.name);
    if (!node) continue;
    node.matrixAutoUpdate = false;
    node.matrix.copy(am.baked.localMatrix(n, m));
    node.matrixWorldNeedsUpdate = true;
  }
}

setPose(az, el, recoil01);

async function roundTrip(): Promise<void> {
  const am = articulated();
  if (!am) return;
  const t0 = performance.now();
  const glb = await exportGlb(am.baked);
  const t1 = performance.now();
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const wrap = new THREE.Group();
  wrap.rotation.x = Math.PI / 2; // glTF Y-up → espacio de modelado Z-up
  wrap.add(gltf.scene);
  glbNodes = new Map();
  gltf.scene.traverse((o) => {
    if (o.name) glbNodes!.set(o.name, o);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  am.holder.visible = false;
  if (gun) gun.group.visible = false;
  subject.add(wrap);
  syncGlb();
  glbInfo = ` · GLB ${(glb.byteLength / 1048576).toFixed(2)} MB (export ${(t1 - t0).toFixed(0)} ms)`;
}

// ---------------------------------------------------------------------------
//  Encuadre, luz y estadísticas.
// ---------------------------------------------------------------------------
const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
let radius = 1;
function measure(): void {
  subject.updateMatrixWorld(true);
  // Encuadre sobre el arma (sin el atrezo lejano, si lo hay).
  box.makeEmpty();
  const am = articulated();
  const target = gun && !raw && am ? am.baked.root : subject;
  const props = new Set<THREE.Object3D>();
  if (gun && am) for (const n of am.baked.nodes) if (n.name.includes('props')) props.add(n.dst);
  target.traverse((o) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (props.has(p)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) box.expandByObject(m);
  });
  if (box.isEmpty()) box.setFromObject(subject);
  box.getSize(size);
  box.getCenter(center);
  radius = Math.max(0.3, size.length() / 2);
}
measure();

const muzzleDot = new THREE.Mesh(
  new THREE.SphereGeometry(Math.max(0.03, radius * 0.015), 16, 8),
  new THREE.MeshBasicMaterial({ color: 0xff2020 }),
);
muzzleDot.visible = !!gun && q.get('muzzle') === '1';
scene.add(muzzleDot);
function placeMuzzle(): void {
  if (!gun) return;
  const m = gun.muzzleWorldEnu();
  muzzleDot.position.set(m.x, m.y, m.z);
}
placeMuzzle();

function placeSun(): void {
  const r = Math.max(radius, 6);
  sun.position.set(center.x + r * 1.6, center.y - r * 1.2, center.z + r * 2.6);
  sun.target.position.copy(center);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -r * 2.2;
  sc.right = sc.top = r * 2.2;
  sc.near = 0.1;
  sc.far = r * 12;
  sc.updateProjectionMatrix();
}
placeSun();

function stats(): string {
  let tris = 0, meshes = 0;
  const mats = new Set<THREE.Material>();
  const root = gun && raw ? gun.rig!.root : subject;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    let vis = true;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) return;
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
  });
  const am = articulated();
  const bs = am?.baked.stats;
  const bakedTxt = bs && !raw
    ? ` · horneado: ${bs.drawCalls} draw calls (de ${bs.sourceMeshes} piezas), ${bs.nodes} nodos`
    : '';
  return `${label} · az ${az.toFixed(1)}° el ${el.toFixed(1)}° rec ${recoil01.toFixed(2)} · ` +
    `${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m · ` +
    `${Math.round(tris).toLocaleString()} tris · ${meshes} mallas · ${mats.size} materiales${bakedTxt}${glbInfo}`;
}

const info = document.createElement('div');
info.style.cssText =
  'position:fixed;left:8px;top:8px;font:12px/1.5 Consolas,monospace;color:#fff;max-width:calc(100vw - 300px);' +
  'background:rgba(0,0,0,.6);padding:6px 10px;border-radius:6px;pointer-events:none;z-index:2';
document.body.appendChild(info);

// Vistas: dirección DESDE la que mira la cámara (unitaria aprox.) por preset.
const VIEWS: Record<string, [number, number, number, number]> = {
  // [dx, dy, dz, distancia×radio]
  '34': [-1.1, 1.3, 0.75, 1.9],
  side: [-1, 0, 0.12, 2.0],
  front: [0, 1, 0.15, 2.0],
  rear: [0.6, -1, 0.45, 2.0],
  top: [0.0001, -0.0001, 1, 2.1],
  close: [-0.7, 0.9, 0.35, 1.0],
  muzzle: [-0.3, 1, 0.1, 0.9],
};

function cameraFor(view: string, aspect: number): THREE.PerspectiveCamera {
  const [dx, dy, dz, k] = VIEWS[view] ?? VIEWS['34'];
  const cam = new THREE.PerspectiveCamera(35, aspect, 0.01, 5000);
  cam.up.set(0, 0, 1);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  let target = center.clone();
  if (view === 'muzzle' && gun) {
    const m = gun.muzzleWorldEnu();
    target = new THREE.Vector3(m.x, m.y, m.z);
  }
  cam.position.copy(target).addScaledVector(dir, radius * k * 1.6);
  cam.lookAt(target);
  return cam;
}

const sheet = q.get('sheet') === '1';
const mainCam = cameraFor(q.get('view') ?? '34', innerWidth / innerHeight);
const controls = new OrbitControls(mainCam, renderer.domElement);
controls.target.copy(q.get('view') === 'muzzle' && gun ? muzzleDot.position : center);
controls.autoRotate = q.get('spin') === '1';
controls.autoRotateSpeed = 1.2;
controls.update();

function render(): void {
  info.textContent = stats();
  const W = innerWidth, H = innerHeight;
  if (!sheet) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, mainCam);
    return;
  }
  const views = ['34', 'side', 'front', 'rear', 'top', 'close'];
  const cw = Math.floor(W / 3), ch = Math.floor(H / 2);
  renderer.setScissorTest(true);
  views.forEach((v, i) => {
    const x = (i % 3) * cw, y = H - (Math.floor(i / 3) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.render(scene, cameraFor(v, cw / ch));
  });
}

// ---------------------------------------------------------------------------
//  Panel de pose (sliders) y conmutadores.
// ---------------------------------------------------------------------------
if (gun && flag('ui', !sheet)) {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;right:8px;top:8px;width:260px;font:12px/1.6 Consolas,monospace;color:#fff;' +
    'background:rgba(0,0,0,.65);padding:8px 12px;border-radius:6px;z-index:3';
  const slider = (name: string, min: number, max: number, step: number, val: number, on: (v: number) => void) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:block';
    const span = document.createElement('span');
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
    inp.style.cssText = 'width:100%';
    const upd = () => { span.textContent = `${name}: ${Number(inp.value).toFixed(step < 1 ? 2 : 0)}`; };
    inp.addEventListener('input', () => { upd(); on(Number(inp.value)); });
    upd();
    row.append(span, inp);
    panel.append(row);
  };
  const check = (name: string, val: boolean, on: (v: boolean) => void) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;cursor:pointer';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = val;
    inp.addEventListener('change', () => on(inp.checked));
    row.append(inp, document.createTextNode(` ${name}`));
    panel.append(row);
  };
  const repose = () => { setPose(az, el, recoil01); placeMuzzle(); render(); };
  slider('azimut °', -180, 180, 1, az, (v) => { az = v; repose(); });
  slider('elevación °', -5, 85, 0.5, el, (v) => { el = v; repose(); });
  slider('retroceso 0..1', 0, 1, 0.01, recoil01, (v) => { recoil01 = v; repose(); });
  check('atrezo de batería', flag('props', true), (v) => { gun!.setPropsVisible(v); render(); });
  check('esfera de boca', muzzleDot.visible, (v) => { muzzleDot.visible = v; render(); });
  check('plato giratorio', controls.autoRotate, (v) => { controls.autoRotate = v; });
  const btn = document.createElement('button');
  btn.textContent = 'Disparar (animación de retroceso)';
  btn.style.cssText = 'margin-top:6px;width:100%';
  btn.addEventListener('click', () => { gun!.previewRecoil(null); gun!.fireRecoil(); firing = 2.5; });
  panel.append(btn);
  const link = document.createElement('div');
  link.style.cssText = 'margin-top:6px;opacity:.75';
  link.textContent = glbMode ? 'Vista: GLB ida y vuelta' : raw ? 'Vista: rig crudo' : 'Vista: horneado (como en la app)';
  panel.append(link);
  document.body.appendChild(panel);
}

let firing = 0;
let last = performance.now();
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (firing > 0 && gun) {
    firing -= dt;
    gun.update(dt, az, el);
    syncGlb();
    placeMuzzle();
    render();
  } else if (controls.autoRotate) {
    controls.update();
    render();
  }
  requestAnimationFrame(loop);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  mainCam.aspect = innerWidth / innerHeight;
  mainCam.updateProjectionMatrix();
  render();
});
controls.addEventListener('change', render);

Object.assign(window as unknown as Record<string, unknown>, {
  __lab: {
    gun, setPose: (a: number, e: number, r: number) => { setPose(a, e, r); placeMuzzle(); render(); }, render,
  },
});

(async () => {
  if (glbMode) {
    try {
      await roundTrip();
    } catch (err) {
      console.error('[lab] ida y vuelta GLB falló', err);
      glbInfo = ` · GLB FALLÓ: ${(err as Error).message}`;
    }
  }
  render();
  requestAnimationFrame(() => {
    render();
    (window as unknown as { __labReady: boolean }).__labReady = true;
    requestAnimationFrame(loop);
  });
})();
