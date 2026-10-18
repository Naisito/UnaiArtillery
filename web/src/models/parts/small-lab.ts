// ============================================================================
//  parts/small-lab.ts — Banco de pruebas propio del agente 3D-SMALL (solo
//  desarrollo; complementa al Model Lab sin tocarlo).  Abre /small-lab.html.
//
//    ?model=pistol|rifle|m240|m2|<PlatformKey>   plataforma
//      &focus=gun|all|muzzle      encuadre: el subárbol de elevación (arma),
//                                 todo el modelo o la boca
//      &az=20&el=10&recoil=0      pose
//    ?projectile=<WeaponId>&round=<i>&tracer=1   un proyectil (escala real ×N)
//    ?lineup=howitzer|rockets|mortar|bullets|all alineación de proyectiles de
//                                 pie, a escala relativa real
//    &view=34|side|front|rear|top|close|muzzle|dx,dy,dz   &dist=1.0
//    &sheet=1  (6 vistas)  &muzzle=1  &bg=sky|white|dark
//  window.__labReady = true tras pintar (tools/shot.mjs --ready __labReady).
// ============================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WeaponCatalog, type WeaponId } from '../../ballistics';
import { ModelKit } from '../kit';
import { PLATFORM_BUILDERS, PLATFORM_OF, weaponForPlatform } from '../platforms';
import { buildProjectile } from '../projectiles';
import { DEG, type PlatformKey, type PlatformRig } from '../rig';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

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
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.002;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: bg === 'white' ? 0xe9e9e9 : 0x6f6a55, roughness: 1 }),
);
ground.receiveShadow = true;
scene.add(ground);

const kit = new ModelKit();
const subject = new THREE.Group();
scene.add(subject);
let rig: PlatformRig | null = null;
let focusObj: THREE.Object3D = subject;
let label = '';

if (q.has('lineup')) {
  const set = q.get('lineup')!;
  type Item = [WeaponId, number, boolean];
  const sets: Record<string, Item[]> = {
    howitzer: [['m777', 0, false], ['m777', 1, false], ['m777', 2, false], ['m777', 3, false], ['m777', 4, false], ['excalibur', 0, false], ['pion2s7', 0, false]],
    mortar: [['mortar120', 0, false], ['mortar120', 1, false], ['mortar120', 2, false]],
    rockets: [['m26', 0, false], ['gmlrs', 0, false], ['ergmlrs', 0, false], ['prsm', 0, false], ['tacticalMissile', 0, false]],
    bullets: [['pistol9', 0, false], ['rifle556', 0, false], ['rifle556', 0, true], ['mg762', 0, false], ['mg762', 0, true], ['m2browning', 0, false], ['m2browning', 0, true]],
  };
  const items = set === 'all' ? [...sets.howitzer, ...sets.mortar] : sets[set] ?? sets.howitzer;
  let x = 0;
  const names: string[] = [];
  for (const [wid, ri, tracer] of items) {
    const w = WeaponCatalog.get(wid);
    const r = w.rounds?.[ri];
    if (r) w.round = r;
    const p = buildProjectile(kit, wid, w, { tracer });
    const holder = new THREE.Group();
    holder.add(p.root);
    holder.rotation.x = Math.PI / 2; // +Y (nariz) -> +Z (arriba)
    const box = new THREE.Box3().setFromObject(holder);
    const wdt = box.max.x - box.min.x;
    holder.position.set(x + wdt / 2, 0, -box.min.z + 0.0005);
    x += wdt * 1.6 + 0.01;
    subject.add(holder);
    names.push(`${wid}${ri ? '#' + ri : ''}${tracer ? 'T' : ''}`);
  }
  subject.position.x = -x / 2;
  label = `lineup ${set}: ${names.join(' · ')}`;
} else if (q.has('projectile')) {
  const wid = q.get('projectile') as WeaponId;
  const w = WeaponCatalog.get(wid);
  const r = w.rounds?.[num('round', 0)];
  if (r) w.round = r;
  const p = buildProjectile(kit, wid, w, { tracer: q.get('tracer') === '1' });
  const s = Math.max(1, 1.2 / p.lengthM);
  p.root.scale.setScalar(s);
  p.root.position.z = 0.6;
  subject.add(p.root);
  if (p.exhaustLocal) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    dot.position.copy(p.exhaustLocal).multiplyScalar(s);
    p.root.add(dot);
    dot.scale.setScalar(1 / s);
  }
  label = `proyectil ${wid} «${w.round.name}» · L=${p.lengthM.toFixed(3)} m · ×${s.toFixed(1)}`;
} else {
  const key = (q.get('model') as PlatformKey | null) ?? PLATFORM_OF[(q.get('weapon') as WeaponId | null) ?? 'm2browning'];
  const wid = (q.get('weapon') as WeaponId | null) ?? weaponForPlatform(key);
  const weapon = WeaponCatalog.get(wid);
  rig = PLATFORM_BUILDERS[key]({ kit, weaponId: wid, weapon });
  subject.add(rig.root);
  const az = num('az', 0), el = num('el', 10), rc = num('recoil', 0);
  rig.traverse.rotation.z = -az * DEG;
  rig.elevation.rotation.x = el * DEG;
  rig.recoil.position.y = -rc * rig.recoilStrokeM;
  rig.animate?.({ t: 0, dt: 0, azimuthDeg: az, elevationDeg: el, recoil01: rc, sinceFireS: Infinity });
  const f = q.get('focus') ?? 'gun';
  if (f === 'gun') focusObj = rig.elevation;
  label = `${key} (${wid}) · az ${az}° · el ${el}° · recoil ${rc}`;
}

subject.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(focusObj);
const all = new THREE.Box3().setFromObject(subject);
const size = all.getSize(new THREE.Vector3());
let center = box.getCenter(new THREE.Vector3());
let radius = Math.max(0.02, box.getSize(new THREE.Vector3()).length() / 2);
const muzzleW = rig ? rig.recoil.localToWorld(rig.muzzleLocal.clone()) : null;
if (rig && q.get('focus') === 'muzzle' && muzzleW) {
  center = muzzleW.clone();
  radius = 0.12;
}
if (muzzleW && q.get('muzzle') === '1') {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.004, radius * 0.012), 16, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  dot.position.copy(muzzleW);
  scene.add(dot);
}
const allR = all.getSize(new THREE.Vector3()).length() / 2;
const allC = all.getCenter(new THREE.Vector3());
sun.position.set(allC.x + allR * 2, allC.y - allR * 1.5, allC.z + allR * 3);
sun.target.position.copy(allC);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = sc.bottom = -allR * 1.6;
sc.right = sc.top = allR * 1.6;
sc.near = 0.01;
sc.far = allR * 10;
sc.updateProjectionMatrix();

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
info.style.cssText = 'position:fixed;left:8px;top:8px;font:12px/1.5 Consolas,monospace;color:#fff;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:6px;z-index:2;max-width:96vw';
info.textContent = `${label} · ${size.x.toFixed(3)}×${size.y.toFixed(3)}×${size.z.toFixed(3)} m · ${Math.round(tris).toLocaleString()} tris · ${meshes} mallas · ${mats.size} mat`;
document.body.appendChild(info);

const VIEWS: Record<string, [number, number, number, number]> = {
  '34': [-1.1, 1.3, 0.75, 1.9],
  side: [-1, 0, 0.12, 2.0],
  right: [1, 0, 0.12, 2.0],
  front: [0, 1, 0.15, 2.0],
  rear: [0.6, -1, 0.45, 2.0],
  top: [0.0001, -0.0001, 1, 2.1],
  close: [-0.7, 0.9, 0.35, 1.0],
  low: [-1, 0.6, -0.15, 1.6],
};
const dist = num('dist', 1);
function cameraFor(view: string, aspect: number): THREE.PerspectiveCamera {
  let v = VIEWS[view];
  if (!v && view.includes(',')) {
    const [a, b, c] = view.split(',').map(Number);
    v = [a, b, c, 1.9];
  }
  v = v ?? VIEWS['34'];
  const cam = new THREE.PerspectiveCamera(30, aspect, 0.002, 5000);
  cam.up.set(0, 0, 1);
  const dir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  cam.position.copy(center).addScaledVector(dir, radius * v[3] * 1.7 * dist);
  cam.lookAt(center);
  return cam;
}

const sheet = q.get('sheet') === '1';
function render(): void {
  const W = innerWidth, H = innerHeight;
  if (!sheet) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, cameraFor(q.get('view') ?? '34', W / H));
    return;
  }
  // Vistas separadas por '|' (admite direcciones "dx,dy,dz").
  const views = (q.get('views') ?? '34|side|front|rear|top|close').split('|');
  const cw = Math.floor(W / 3), ch = Math.floor(H / 2);
  renderer.setScissorTest(true);
  views.slice(0, 6).forEach((v, i) => {
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
