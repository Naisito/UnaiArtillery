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
//  Arrastrar orbita (OrbitControls). window.__labReady = true tras pintar
//  (para tools/shot.mjs --ready __labReady). Panel con medidas, triángulos,
//  draw calls y materiales.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WeaponCatalog } from '../ballistics';
import type { WeaponId } from '../ballistics';
import { ModelKit } from './kit';
import { PLATFORM_BUILDERS, PLATFORM_OF, weaponForPlatform } from './platforms';
import { buildProjectile } from './projectiles';
import { DEG, type PlatformKey, type PlatformRig } from './rig';
import { buildTargetTruck } from './targets';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

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
const bg = q.get('bg') ?? 'sky';
scene.background = new THREE.Color(bg === 'white' ? 0xf2f2f2 : bg === 'dark' ? 0x111418 : 0x9fb6c8);

// Luz: sol cálido con sombras + cielo/suelo.
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.7));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// Suelo: hierba/tierra neutra + rejilla de 1 m (referencia de escala).
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

let rig: PlatformRig | null = null;
let label = '';
const az = num('az', 0);
const el = num('el', 15);
const recoil01 = num('recoil', 0);

if (q.has('projectile')) {
  const wid = q.get('projectile') as WeaponId;
  const w = WeaponCatalog.get(wid);
  const p = buildProjectile(kit, wid, w);
  const s = Math.max(1, 1.2 / p.lengthM); // escala para verlo: ~1.2 m en pantalla
  p.root.scale.setScalar(s);
  p.root.position.z = 0.6;
  subject.add(p.root);
  label = `proyectil ${wid} · L=${p.lengthM.toFixed(3)} m · escala ×${s.toFixed(1)}`;
} else if (q.has('target')) {
  const t = buildTargetTruck(kit);
  subject.add(t.root);
  label = 'blanco: camión';
} else {
  const key = (q.get('model') as PlatformKey | null)
    ?? PLATFORM_OF[(q.get('weapon') as WeaponId | null) ?? 'm777'];
  const wid = (q.get('weapon') as WeaponId | null) ?? weaponForPlatform(key);
  const weapon = WeaponCatalog.get(wid);
  rig = PLATFORM_BUILDERS[key]({ kit, weaponId: wid, weapon });
  subject.add(rig.root);
  rig.traverse.rotation.z = -az * DEG;
  rig.elevation.rotation.x = el * DEG;
  rig.recoil.position.y = -recoil01 * rig.recoilStrokeM;
  rig.animate?.({ t: 0, dt: 0, azimuthDeg: az, elevationDeg: el, recoil01, sinceFireS: Infinity });
  label = `${key} (${wid}) · az ${az}° · el ${el}°`;
}

subject.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(subject);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
const radius = Math.max(0.3, size.length() / 2);

if (rig && q.get('muzzle') === '1') {
  const m = rig.recoil.localToWorld(rig.muzzleLocal.clone());
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.03, radius * 0.015), 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  );
  dot.position.copy(m);
  scene.add(dot);
}

sun.position.set(center.x + radius * 2, center.y - radius * 1.5, center.z + radius * 3);
sun.target.position.copy(center);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = sc.bottom = -radius * 1.6;
sc.right = sc.top = radius * 1.6;
sc.near = 0.1;
sc.far = radius * 10;
sc.updateProjectionMatrix();

// Estadísticas del modelo.
let tris = 0, meshes = 0;
const mats = new Set<THREE.Material>();
subject.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  meshes++;
  const g = m.geometry;
  tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
});

const info = document.createElement('div');
info.style.cssText =
  'position:fixed;left:8px;top:8px;font:12px/1.5 Consolas,monospace;color:#fff;' +
  'background:rgba(0,0,0,.6);padding:6px 10px;border-radius:6px;pointer-events:none;z-index:2';
info.textContent =
  `${label} · ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m (X×Y×Z) · ` +
  `${Math.round(tris).toLocaleString()} tris · ${meshes} mallas · ${mats.size} materiales`;
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
  if (view === 'muzzle' && rig) target = rig.recoil.localToWorld(rig.muzzleLocal.clone());
  cam.position.copy(target).addScaledVector(dir, radius * k * 1.6);
  cam.lookAt(target);
  return cam;
}

const sheet = q.get('sheet') === '1';
const mainCam = cameraFor(q.get('view') ?? '34', innerWidth / innerHeight);
const controls = new OrbitControls(mainCam, renderer.domElement);
controls.target.copy(q.get('view') === 'muzzle' && rig ? rig.recoil.localToWorld(rig.muzzleLocal.clone()) : center);
controls.update();

function render(): void {
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

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  mainCam.aspect = innerWidth / innerHeight;
  mainCam.updateProjectionMatrix();
  render();
});
controls.addEventListener('change', render);
render();
requestAnimationFrame(() => {
  render();
  (window as unknown as { __labReady: boolean }).__labReady = true;
});
