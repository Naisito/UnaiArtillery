// ============================================================================
//  parts/wheeled-preview.ts — Banco de pruebas de los BLANCOS de ruedas
//  (solo desarrollo; complementa al Model Lab, que solo conoce target=truck).
//  DUEÑO: agente 3D-WHEELED.
//
//  Abre /wheeled-preview.html?target=truck|apc&sheet=1&view=34&spin=30
//    target  truck (Ural-4320) | apc (BTR-82A)
//    weapon  gmlrs|ergmlrs|prsm → muestra el HIMARS (con az/el)
//    spin    grados de giro aplicados a las ruedas (verifica el eje X local)
//    cam=dx,dy,dz,k  cámara libre (dirección desde la que mira y distancia
//                    en radios); look=x,y,z punto mirado (defecto: centro)
//    fov     campo de visión (defecto 35)
//    view / sheet / bg   como el Model Lab
//  window.__labReady = true tras pintar (tools/shot.mjs --ready __labReady).
// ============================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { WeaponId } from '../../ballistics';
import { WeaponCatalog } from '../../ballistics';
import { ModelKit } from '../kit';
import { buildHimars } from '../platforms/himars';
import { DEG, type TargetModel } from '../rig';
import { buildTargetApc, buildTargetTruck } from '../targets';
import { countTriangles } from './trucks';

const q = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const bg = q.get('bg') ?? 'sky';
scene.background = new THREE.Color(bg === 'white' ? 0xf2f2f2 : bg === 'dark' ? 0x111418 : 0x9fb6c8);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.7));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
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
const which = q.get('weapon') ? `himars:${q.get('weapon')}` : q.get('target') ?? 'truck';
let t: TargetModel;
if (q.get('weapon')) {
  const wid = q.get('weapon') as WeaponId;
  const rig = buildHimars({ kit, weaponId: wid, weapon: WeaponCatalog.get(wid) });
  const az = Number(q.get('az') ?? 0), el = Number(q.get('el') ?? 0);
  rig.traverse.rotation.z = -az * DEG;
  rig.elevation.rotation.x = el * DEG;
  rig.animate?.({ t: 0, dt: 0, azimuthDeg: az, elevationDeg: el, recoil01: 0, sinceFireS: Infinity });
  t = { root: rig.root, wheels: [], wheelRadiusM: 0, footprintM: rig.footprintM };
} else {
  t = which === 'apc' ? buildTargetApc(kit) : buildTargetTruck(kit);
}
const spin = Number(q.get('spin') ?? 0) * (Math.PI / 180);
for (const w of t.wheels) w.rotation.x = spin;
scene.add(t.root);
t.root.updateMatrixWorld(true);

const box = new THREE.Box3().setFromObject(t.root);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
const radius = Math.max(0.3, size.length() / 2);
sun.position.set(center.x + radius * 2, center.y - radius * 1.5, center.z + radius * 3);
sun.target.position.copy(center);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = sc.bottom = -radius * 1.6;
sc.right = sc.top = radius * 1.6;
sc.far = radius * 10;
sc.updateProjectionMatrix();

let meshes = 0;
const mats = new Set<THREE.Material>();
t.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  meshes++;
  (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
});
const info = document.createElement('div');
info.style.cssText =
  'position:fixed;left:8px;top:8px;font:12px/1.5 Consolas,monospace;color:#fff;' +
  'background:rgba(0,0,0,.6);padding:6px 10px;border-radius:6px;pointer-events:none;z-index:2';
info.textContent =
  `blanco ${which} · ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m · ` +
  `${countTriangles(t.root).toLocaleString()} tris · ${meshes} mallas · ${mats.size} materiales · ` +
  `${t.wheels.length} ruedas r=${t.wheelRadiusM} · huella ${t.footprintM}`;
document.body.appendChild(info);

const VIEWS: Record<string, [number, number, number, number]> = {
  '34': [-1.1, 1.3, 0.75, 1.9],
  side: [-1, 0, 0.12, 2.0],
  front: [0, 1, 0.15, 2.0],
  rear: [0.6, -1, 0.45, 2.0],
  top: [0.0001, -0.0001, 1, 2.1],
  close: [-0.7, 0.9, 0.35, 1.0],
  right: [1, 0.15, 0.2, 2.0],
  low: [-1.2, 0.9, 0.12, 1.5],
};
const nums = (k: string): number[] | null => (q.has(k) ? q.get(k)!.split(',').map(Number) : null);
function cameraFor(view: string, aspect: number): THREE.PerspectiveCamera {
  const [dx, dy, dz, k] = (view === 'custom' ? nums('cam') : null) ?? VIEWS[view] ?? VIEWS['34'];
  const cam = new THREE.PerspectiveCamera(Number(q.get('fov') ?? 35), aspect, 0.01, 5000);
  cam.up.set(0, 0, 1);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const look = nums('look');
  const target = look ? new THREE.Vector3(look[0], look[1], look[2]) : center;
  cam.position.copy(target).addScaledVector(dir, radius * k * 1.6);
  cam.lookAt(target);
  return cam;
}

function render(): void {
  const W = innerWidth, H = innerHeight;
  if (q.get('sheet') !== '1') {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, cameraFor(q.has('cam') ? 'custom' : q.get('view') ?? '34', W / H));
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
render();
requestAnimationFrame(() => {
  render();
  (window as unknown as { __labReady: boolean }).__labReady = true;
});
