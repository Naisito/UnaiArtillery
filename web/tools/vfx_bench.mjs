// ============================================================================
//  tools/vfx_bench.mjs — Escenas de VFX + medición de frame-time.  [V2 VFX]
//
//  Uso:
//    node tools/vfx_bench.mjs --url http://localhost:5204/ --outdir <dir>
//         [--scenes arranque,muzzle,rocket,explosion,night,smoke,illum,small]
//         [--perf 1]          mide frame-time en reposo y durante una salva ×6
//         [--w 1600 --h 900]  viewport
//         [--query "quality=ultra"]  parámetros extra de URL
//
//  Las escenas colocan la cámara con window.__ua (marco ENU de la batería) y
//  capturan varios fotogramas cronometrados. La medición de rendimiento
//  cuenta intervalos entre postRender de Cesium, draw calls reales de
//  WebGL (envolviendo drawElements/drawArrays de AMBOS contextos) y el
//  tiempo de JS de los bucles de la app. SwiftShader: compara, no absolutos.
// ============================================================================
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const base = opt('url', 'http://localhost:5204/');
const outdir = opt('outdir', 'bench-out');
const scenes = opt('scenes', '').split(',').filter(Boolean);
const perf = opt('perf', '0') === '1';
const w = Number(opt('w', '1600'));
const h = Number(opt('h', '900'));
const query = opt('query', '');
const settle = Number(opt('settle', '15000'));
fs.mkdirSync(outdir, { recursive: true });

const url = base + (base.includes('?') ? '&' : '?') + (query || 'bench=1');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

// Tutorial ya visto (no tapa la escena).
await page.addInitScript(() => {
  try { localStorage.setItem('unai-artillery/tutorial/v1', 'done'); } catch { /* */ }
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__uaReady), null, { timeout: 180_000 });
// Hora solar local fija (comparable entre ejecuciones) y UI oculta.
await page.evaluate(({ hour, ui }) => {
  const ua = window.__ua;
  const C = ua.Cesium;
  if (hour >= 0) {
    const now = new Date();
    const utcH = (((hour - ua.service.frame.lonDeg / 15) % 24) + 24) % 24;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      Math.floor(utcH), Math.round((utcH % 1) * 60), 0));
    ua.viewer.clock.currentTime = C.JulianDate.fromDate(d);
  }
  if (!ui) {
    const st = document.createElement('style');
    st.textContent = 'body > *:not(#cesiumContainer) { display: none !important; }';
    document.head.appendChild(st);
  }
}, { hour: Number(opt('hour', '10.5')), ui: opt('ui', '0') === '1' });
await page.waitForTimeout(settle);

// Utilidades en la página: cámara por ENU, selección de arma, disparo.
await page.evaluate(() => {
  const ua = window.__ua;
  const C = ua.Cesium;
  const f = () => ua.service.frame;
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  window.__bench = {
    look(eye, target) {
      const d = norm({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
      const right = norm(cross(d, { x: 0, y: 0, z: 1 }));
      const up = norm(cross(right, d));
      const fr = f();
      ua.director.setMode?.('free');
      ua.viewer.camera.cancelFlight?.();
      // Las teselas gruesas recién pedidas pueden quedar POR ENCIMA del
      // suelo real en ladera y la colisión empujaría la cámara cientos de m.
      ua.viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      ua.viewer.camera.setView({
        destination: fr.enuToEcef(eye),
        orientation: {
          direction: C.Cartesian3.normalize(fr.enuVectorToEcef(d), new C.Cartesian3()),
          up: C.Cartesian3.normalize(fr.enuVectorToEcef(up), new C.Cartesian3()),
        },
      });
    },
    weapon(id) {
      const sel = document.getElementById('weaponSelect');
      if (sel) {
        sel.value = id;
        sel.dispatchEvent(new Event('change'));
      }
    },
    aim(az, el) { ua.panel.setAim(az, el); ua.piece.schedulePreview(0); },
    async groundZ(x, y) {
      try {
        const z = await ua.service.visualGroundZ({ x, y, z: 0 });
        return z ?? 0;
      } catch { return 0; }
    },
  };
});

async function shot(name) {
  const p = path.join(outdir, `${name}.png`);
  await page.screenshot({ path: p });
  const cam = await page.evaluate(() => {
    const ua = window.__ua;
    const e = ua.service.frame.ecefToEnu(ua.viewer.camera.positionWC);
    return `${e.x.toFixed(0)},${e.y.toFixed(0)},${e.z.toFixed(0)}`;
  });
  console.log(`saved ${p} (cam ENU ${cam})`);
}

async function run(js) {
  try {
    return await page.evaluate(`(async () => { ${js} })()`);
  } catch (e) {
    logs.push(`eval failed: ${e.message}`);
    console.log(`eval failed: ${e.message.slice(0, 300)}`);
    return null;
  }
}

/** Espera a que el globo termine de cargar teselas (cámara recién movida). */
async function tiles(maxMs = 60000) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__ua.viewer.scene.globe.tilesLoaded, null, { timeout: maxMs }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Tras disparar, espera al lanzamiento real (el presentador sale en el tick). */
async function waitMs(ms) { await page.waitForTimeout(ms); }

// --- Congelado determinista de los VFX (build V2: vfx.pauseAt) -------------
const canFreeze = (await run(`return 'pauseAt' in __ua.vfx;`)) === true;

/** Engancha los spawners: el primer evento de `kinds` marca t0 (y congela). */
async function armEvent(firstRel, kinds) {
  await run(`const v = __ua.vfx; window.__evT = undefined; window.__firstRel = ${firstRel};
    window.__evKinds = ${JSON.stringify(kinds)};
    if (!window.__hooked) { window.__hooked = true;
      for (const k of ['launchSignature','impactExplosion','waterSplash','flare','smokeScreen','structureExplosion','burstFlash']) {
        if (typeof v[k] !== 'function') continue;
        const o = v[k].bind(v);
        v[k] = (...a) => {
          const r = o(...a);
          if (window.__evT === undefined && window.__evKinds.includes(k)) {
            window.__evT = v.simTime ?? 0; window.__evWall = performance.now();
            if ('pauseAt' in v) v.pauseAt = v.simTime + window.__firstRel;
          }
          return r;
        };
      } }`);
}

async function waitEvent(timeout = 150000) {
  await page.waitForFunction(() => window.__evT !== undefined, null, { timeout });
}

async function waitFrozen() {
  await page.waitForFunction(() => window.__ua.vfx.timeScale === 0, null, { timeout: 240000 }).catch(() => {});
  await page.waitForTimeout(350);
}

/** Avanza los VFX hasta t0 + rel (avance rápido ×3 si el salto es largo). */
async function freezeAt(rel) {
  if (!canFreeze) {
    const wall = await run(`return performance.now() - window.__evWall;`);
    const left = rel * 1000 - (wall ?? 0);
    if (left > 0) await page.waitForTimeout(left);
    return;
  }
  await run(`const v = __ua.vfx; const target = window.__evT + ${rel};
    if (v.simTime < target) { v.pauseAt = target; v.timeScale = (target - v.simTime) > 3 ? 3 : 1; }`);
  await waitFrozen();
}

async function sequence(prefix, rels) {
  await waitEvent();
  if (canFreeze) await waitFrozen();
  else await freezeAt(rels[0]);
  await shot(`${prefix}_0`);
  for (let i = 1; i < rels.length; i++) {
    await freezeAt(rels[i]);
    await shot(`${prefix}_${i}`);
  }
  if (canFreeze) await run(`__ua.vfx.timeScale = 1;`);
}

for (const scene of scenes) {
  if (scene === 'arranque') {
    await tiles(40000);
    await shot('arranque');
  } else if (scene === 'muzzle') {
    await run(`__bench.weapon('m777'); __bench.aim(45, 30);`);
    await waitMs(3000);
    await run(`__bench.look({x:-34,y:-4,z:5+await __bench.groundZ(-34,-4)}, {x:4,y:6,z:4+await __bench.groundZ(0,0)});`);
    await tiles();
    await armEvent(0.025, ['launchSignature']);
    await run(`void __ua.piece.fire();`);
    await sequence('muzzle', [0.025, 0.12, 0.8, 3.0]);
  } else if (scene === 'rocket') {
    await run(`__bench.weapon('gmlrs'); __bench.aim(30, 40);`);
    await waitMs(3000);
    await run(`__bench.look({x:-80,y:-45,z:10+await __bench.groundZ(-80,-45)}, {x:10,y:25,z:25+await __bench.groundZ(0,0)});`);
    await tiles();
    await armEvent(0.06, ['launchSignature']);
    await run(`void __ua.piece.fire();`);
    await sequence('rocket', [0.06, 0.7, 2.2, 6.0]);
  } else if (scene === 'explosion') {
    await run(`__bench.weapon('m777'); __bench.aim(135, 5);`);
    await waitMs(4000);
    await run(`
      const fr = await __ua.service.solveTrajectory(__ua.panel.weaponId, __ua.piece.order());
      window.__impact = fr.impactPoint; return fr.timeOfFlight;`);
    await run(`const p = window.__impact; const a = Math.atan2(p.y, p.x);
      const ex = p.x - Math.cos(a) * 650 + Math.sin(a) * 260, ey = p.y - Math.sin(a) * 650 - Math.cos(a) * 260;
      const gz = await __bench.groundZ(ex, ey); __bench.look({x:ex, y:ey, z:Math.max(p.z+160, gz+60)}, {x:p.x, y:p.y, z:p.z+30});`);
    await tiles();
    await armEvent(0.03, ['impactExplosion', 'structureExplosion', 'waterSplash']);
    await run(`void __ua.piece.fire();`);
    await sequence('explosion', [0.03, 0.25, 1.2, 4.0, 10.0]);
  } else if (scene === 'night') {
    await run(`__ua.panel.setNight(true, true);`);
    await run(`__bench.weapon('m777'); __bench.aim(45, 30);`);
    await waitMs(4000);
    await run(`__bench.look({x:-60,y:-20,z:14+await __bench.groundZ(-60,-20)}, {x:4,y:10,z:6+await __bench.groundZ(0,0)});`);
    await tiles();
    await shot('night_0');
    await armEvent(0.03, ['launchSignature']);
    await run(`void __ua.piece.fire();`);
    await sequence('night_fire', [0.03, 0.5]);
    await run(`__ua.panel.setNight(false, true);`);
  } else if (scene === 'smoke' || scene === 'illum') {
    const ri = scene === 'smoke' ? 'smoke' : 'illum';
    await run(`__bench.weapon('m777');
      const sel = document.querySelectorAll('#controlPanel select')[1];
      if (sel) { const o = [...sel.options].find((o) => /${ri === 'smoke' ? 'smoke|humo' : 'illum|ilum'}/i.test(o.textContent)); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change')); } }
      __bench.aim(60, 10);`);
    await waitMs(4000);
    if (ri === 'illum') await run(`__ua.panel.setNight(true, true);`);
    await run(`
      const fr = await __ua.service.solveTrajectory(__ua.panel.weaponId, {azimuthDeg:60, elevationDeg:10, chargeIndex: __ua.panel.chargeIndex});
      window.__impact = fr.impactPoint; return fr.timeOfFlight;`);
    await run(`const p = window.__impact; const a = Math.atan2(p.y, p.x);
      const ex = p.x - Math.cos(a) * 700 + Math.sin(a) * 300, ey = p.y - Math.sin(a) * 700 - Math.cos(a) * 300;
      const gz = await __bench.groundZ(ex, ey); __bench.look({x:ex, y:ey, z:Math.max(gz+60, p.z+${ri === 'illum' ? 260 : 120})}, {x:p.x, y:p.y, z:p.z+${ri === 'illum' ? 200 : 20}});`);
    await tiles();
    await armEvent(ri === 'smoke' ? 6 : 3, [ri === 'smoke' ? 'smokeScreen' : 'flare']);
    await run(`void __ua.piece.fire();`);
    await sequence(scene, ri === 'smoke' ? [6, 25] : [3, 15]);
    if (ri === 'illum') await run(`__ua.panel.setNight(false, true);`);
  } else if (scene === 'small') {
    await run(`__bench.weapon('m2browning'); __bench.aim(45, 2);`);
    await waitMs(3000);
    await run(`__bench.look({x:-6,y:-3,z:2.5+await __bench.groundZ(-6,-3)}, {x:20,y:25,z:1.5+await __bench.groundZ(0,0)});`);
    await tiles();
    await run(`__ua.piece.startBurst();`);
    await waitMs(2500);
    await shot('small_0');
    await run(`__ua.piece.endBurst();`);
  } else if (scene === 'salvo') {
    await run(`__bench.weapon('m777'); __bench.aim(45, 10);`);
    await waitMs(3000);
    await run(`__bench.look({x:-900,y:-900,z:500+await __bench.groundZ(0,0)}, {x:0,y:0,z:0});`);
    await tiles();
    await run(`void __ua.piece.fireDispersedSalvo(6);`);
    await waitMs(4000);
    await shot('salvo_0');
  }
}


if (perf) {
  // Instrumentación: intervalos de postRender, draw calls GL (Cesium + Three)
  // y tiempo de JS de los bucles de la app.
  await page.evaluate(() => {
    const ua = window.__ua;
    const st = (window.__perfBench = {
      frames: [], drawCesium: 0, drawThree: 0, jsMs: 0, samples: [], last: performance.now(),
    });
    const wrapGl = (gl, key) => {
      if (!gl || gl.__wrapped) return;
      gl.__wrapped = true;
      for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const orig = gl[fn];
        if (typeof orig !== 'function') continue;
        gl[fn] = function (...a) { st[key]++; return orig.apply(this, a); };
      }
    };
    wrapGl(ua.viewer.scene.context._gl, 'drawCesium');
    wrapGl(ua.overlay.renderer.getContext(), 'drawThree');
    const time = (obj, name) => {
      const orig = obj[name].bind(obj);
      obj[name] = (...a) => { const t = performance.now(); const r = orig(...a); st.jsMs += performance.now() - t; return r; };
    };
    time(ua.piece, 'update');
    time(ua.vfx, 'update');
    time(ua.overlay, 'render');
    let dc0 = 0, dt0 = 0, js0 = 0;
    ua.viewer.scene.postRender.addEventListener(() => {
      const now = performance.now();
      if (st.recording) {
        st.samples.push({
          ms: now - st.last,
          cesium: st.drawCesium - dc0,
          three: st.drawThree - dt0,
          js: st.jsMs - js0,
        });
      }
      dc0 = st.drawCesium; dt0 = st.drawThree; js0 = st.jsMs;
      st.last = now;
    });
  });
  const measure = async (label, ms, prep) => {
    if (prep) await run(prep);
    await page.evaluate(() => { window.__perfBench.samples = []; window.__perfBench.recording = true; });
    await waitMs(ms);
    const r = await page.evaluate(() => {
      const s = window.__perfBench.samples;
      window.__perfBench.recording = false;
      const n = s.length || 1;
      const sorted = [...s].map((x) => x.ms).sort((a, b) => a - b);
      const avg = (k) => s.reduce((a, x) => a + x[k], 0) / n;
      return {
        frames: s.length,
        avgMs: avg('ms'), p50: sorted[Math.floor(n * 0.5)] ?? 0, p95: sorted[Math.floor(n * 0.95)] ?? 0,
        cesiumDraws: avg('cesium'), threeDraws: avg('three'), jsMs: avg('js'),
        heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0,
      };
    });
    console.log(`PERF ${label}: ${JSON.stringify(r)}`);
    return r;
  };
  await run(`__bench.weapon('m777'); __bench.aim(45, 10);`);
  await waitMs(3000);
  await run(`__bench.look({x:-900,y:-900,z:500+await __bench.groundZ(0,0)}, {x:0,y:0,z:0});`);
  await waitMs(4000);
  const idle = await measure('idle', 8000);
  const salvo = await measure('salvo6', 24000, `void __ua.piece.fireDispersedSalvo(6);`);
  fs.writeFileSync(path.join(outdir, 'perf.json'), JSON.stringify({ url, w, h, idle, salvo }, null, 2));
}

if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
