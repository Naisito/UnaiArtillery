// ============================================================================
//  armory.ts — Sala de armas: banco de pruebas de modelos, animación y audio.
//  [P-ANI.1 / P-ANI.2 / P-AUD.1]
//
//  Página aparte (`/armory.html`) que monta SOLO la capa Three: sin globo, sin
//  física, sin red. Sirve para tres cosas:
//
//    * ver de cerca el GunModel de cada arma y su ciclo mecánico completo
//      (servos de puntería, culatazo, apertura de culata, atacador, casquillo);
//    * comparar las siluetas de los ProjectileModel a escala, girando;
//    * disparar las voces del AudioEngine a mano y a distintas distancias.
//
//  Es la herramienta con la que se ajustan las proporciones: en el globo, un
//  obús a 1.3 km es un palito, y aquí se ve lo que realmente se está pintando.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WeaponCatalog, WeaponId } from './ballistics';
import { GunModel } from './GunModel';
import { ProjectileModel } from './render/ProjectileModel';
import { AudioEngine } from './vfx/AudioEngine';

const WEAPON_LABELS: Record<WeaponId, string> = {
  mortar120: '120 mm Mortero pesado',
  m777: 'M777 · Obús 155 mm',
  m109: 'M109A7 Paladin · 155 mm',
  pion2s7: '2S7 Pion · 203 mm',
  excalibur: 'M982 Excalibur · 155 mm',
  gmlrs: 'HIMARS / GMLRS 227 mm',
  m26: 'M26 MLRS · 227 mm',
  ergmlrs: 'ER GMLRS · 227 mm',
  tacticalMissile: 'Misil balístico táctico',
  prsm: 'PrSM · Misil 500 km',
  pistol9: 'Pistola 9 mm',
  rifle556: 'Fusil 5.56 NATO',
  mg762: 'M240 · 7.62 NATO',
  m2browning: 'M2 Browning · .50 BMG',
};

// -- Escena ------------------------------------------------------------------
const host = document.getElementById('armoryCanvas')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setSize(window.innerWidth, window.innerHeight);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2430);
scene.fog = new THREE.Fog(0x1b2430, 90, 500);

// Convención del proyecto: +z arriba, +y adelante (norte).
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 5000);
camera.up.set(0, 0, 1);
camera.position.set(7.5, -9.5, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 1.6);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.position.set(6, -8, 12);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xa9c2dd, 0.5);
rim.position.set(-8, 6, 3);
scene.add(rim);

// Suelo + rejilla métrica (cada cuadro = 1 m).
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x424a38, roughness: 1 }),
);
ground.position.z = -0.01;
scene.add(ground);
const grid = new THREE.GridHelper(80, 80, 0x6f7d8a, 0x37424c);
grid.rotation.x = Math.PI / 2; // el helper nace en XZ; aquí el suelo es XY
scene.add(grid);

// -- Estado ------------------------------------------------------------------
const gunRoot = new THREE.Group();
scene.add(gunRoot);
const roundRoot = new THREE.Group();
scene.add(roundRoot);

const audio = new AudioEngine();
let weaponId: WeaponId = 'm777';
let weapon = WeaponCatalog.get(weaponId);
let gun = new GunModel(gunRoot, weapon);
let round = new ProjectileModel(weapon);
let azCmd = 45;
let elCmd = 25;
let roundElapsed = 0;
let autoFireTimer = 0;
let autoFire = false;

/** El proyectil se muestra flotando al lado, a tamaño real, girando. */
function mountRound(): void {
  round.dispose();
  round = new ProjectileModel(weapon);
  round.tracer.visible = false;
  round.group.position.set(4.5, 0, 2.2);
  round.group.rotation.x = Math.PI / 2; // tumbado: la nariz mira al norte
  roundRoot.add(round.group);
  roundElapsed = 0;
}
mountRound();

function setWeapon(id: WeaponId): void {
  weaponId = id;
  weapon = WeaponCatalog.get(id);
  gun.setWeapon(weapon);
  azCmd = Math.min(45, weapon.traverseDeg);
  elCmd = Math.min(Math.max(25, weapon.minElevationDeg), weapon.maxElevationDeg);
  mountRound();
  info();
}

gun.onMech = (event) => {
  audio.mech(event === 'casing' ? 'casing' : event, {
    distanceM: camera.position.length(),
    soundSpeed: 340,
    energy: Math.cbrt(weapon.round.diameter / 0.155),
  });
};

function fire(): void {
  audio.unlock();
  gun.fireRecoil();
  roundElapsed = 0;
  audio.boom(weapon.category === 'SmallArms' ? 'muzzleSmall' : 'muzzle', {
    distanceM: Math.max(6, camera.position.length()),
    soundSpeed: 340,
    energy: Math.cbrt(weapon.round.diameter / 0.155),
    caliberM: weapon.round.diameter,
  });
}

// -- Panel -------------------------------------------------------------------
const panel = document.getElementById('armoryPanel')!;
const infoEl = document.getElementById('armoryInfo')!;

function row(label: string, node: HTMLElement): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  r.append(l, node);
  return r;
}

const title = document.createElement('h2');
title.textContent = 'Sala de armas';
panel.appendChild(title);

const sel = document.createElement('select');
for (const id of WeaponCatalog.ids()) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = WEAPON_LABELS[id];
  sel.appendChild(o);
}
sel.value = weaponId;
sel.onchange = () => setWeapon(sel.value as WeaponId);
panel.appendChild(sel);

const azIn = document.createElement('input');
azIn.type = 'range'; azIn.min = '0'; azIn.max = '359'; azIn.value = String(azCmd);
azIn.oninput = () => { azCmd = Number(azIn.value); };
panel.appendChild(row('Azimut', azIn));

const elIn = document.createElement('input');
elIn.type = 'range'; elIn.min = '-5'; elIn.max = '85'; elIn.value = String(elCmd);
elIn.oninput = () => { elCmd = Number(elIn.value); };
panel.appendChild(row('Elevación', elIn));

const grid2 = document.createElement('div');
grid2.className = 'btn-grid';
const autoBtn = document.createElement('button');
autoBtn.textContent = 'Fuego automático';
autoBtn.onclick = () => {
  autoFire = !autoFire;
  autoBtn.classList.toggle('toggled', autoFire);
  if (autoFire) audio.unlock();
};
const impactBtn = document.createElement('button');
impactBtn.textContent = 'Probar impacto';
impactBtn.onclick = () => {
  audio.unlock();
  audio.boom('impact', { distanceM: 400, soundSpeed: 340, energy: 1.4, caliberM: 0.155 });
};
const farBtn = document.createElement('button');
farBtn.textContent = 'Impacto a 6 km';
farBtn.title = 'Se oye 18 s después, sin agudos y con la cola de eco del valle';
farBtn.onclick = () => {
  audio.unlock();
  audio.boom('impact', { distanceM: 6000, soundSpeed: 340, energy: 2.2, caliberM: 0.203 });
};
const whistleBtn = document.createElement('button');
whistleBtn.textContent = 'Silbido entrante';
whistleBtn.onclick = () => {
  audio.unlock();
  audio.whistle({
    delayS: 0.1, durS: 2.4, closingSpeed: 260, soundSpeed: 340,
    distanceM: 300, energy: 1.2, caliberM: 0.155,
  });
  window.setTimeout(
    () => audio.boom('impact', { distanceM: 300, soundSpeed: 340, energy: 1.4 }), 2500,
  );
};
grid2.append(autoBtn, impactBtn, farBtn, whistleBtn);
panel.appendChild(grid2);

const fireBtn = document.createElement('button');
fireBtn.className = 'fire';
fireBtn.textContent = 'Fuego';
fireBtn.onclick = fire;
panel.appendChild(fireBtn);

const hint = document.createElement('p');
hint.className = 'hint';
hint.textContent =
  'Arrastra para orbitar · rueda para acercarte · F dispara. La rejilla es de 1 m.';
panel.appendChild(hint);

window.addEventListener('keydown', (ev) => {
  if (ev.code === 'KeyF' && !(ev.target instanceof HTMLInputElement)) fire();
});

function info(): void {
  const r = weapon.round;
  // Vueltas por segundo al salir del tubo: v0 / (paso), paso = twist·calibre.
  const revS = r.spinStabilized && r.twistCalibers > 0
    ? r.muzzleVelocity / (r.twistCalibers * r.diameter)
    : 0;
  infoEl.innerHTML =
    `<h2>${weapon.name}</h2>` +
    `<p class="hint readout">${r.name}</p>` +
    `<p class="hint">Calibre ${(r.diameter * 1000).toFixed(1)} mm · ` +
    `${r.mass.toFixed(2)} kg · v₀ ${r.muzzleVelocity} m/s</p>` +
    `<p class="hint">Estriado: ${
      r.spinStabilized ? `1/${r.twistCalibers} calibres → ${revS.toFixed(0)} rev/s` : 'aletas (sin giro)'
    }</p>` +
    `<p class="hint">Elevación ${weapon.minElevationDeg}º…${weapon.maxElevationDeg}º · ` +
    `campo ${weapon.traverseDeg}º · recarga ${weapon.reloadTime} s</p>`;
}

// -- Bucle -------------------------------------------------------------------
let last = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  gun.update(dt, azCmd, elCmd);
  audio.servo(gun.slewRateDegS);

  roundElapsed += dt;
  round.update(dt, {
    elapsed: roundElapsed,
    speed: weapon.round.muzzleVelocity,
    mach: 2.0,
    thrusting: weapon.round.motor.enabled && roundElapsed < 3,
    camDistance: 250, // escala 1: se ve a TAMAÑO REAL junto al arma
  });

  if (autoFire) {
    autoFireTimer -= dt;
    if (autoFireTimer <= 0) {
      fire();
      autoFireTimer = Math.max(0.8, weapon.reloadTime);
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();
info();
frame();
