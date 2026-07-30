// ============================================================================
//  capture.mjs — Exporta fotos (PNG) y vídeos (MP4) de los modelos y sus
//  animaciones desde la sala de armas (/armory.html).
//
//  Uso:  npm run capture            (build + preview + captura en ../capturas/)
//        node tools/capture.mjs --only=video
//
//  Cómo se graban los MP4 sin ffmpeg: el propio Chromium codifica H.264 con
//  MediaRecorder sobre `canvas.captureStream()`. El ffmpeg que trae Playwright
//  está compilado solo con VP8/WebM, así que esta vía es la única que da MP4
//  sin dependencias externas. El blob vuelve a Node en base64.
//
//  La sala de armas expone `window.armory` (ver src/armory.ts) para guionizar
//  arma, puntería, cámara, disparo y detonación sin tocar la interfaz.
// ============================================================================
import { chromium } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../capturas');
const BASE = process.env.CAPTURE_URL ?? 'http://localhost:4173';
const VIEW = { width: 1280, height: 720 };

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? 'all';
const wantPng = only === 'all' || only === 'png';
const wantVideo = only === 'all' || only === 'video';

// ---------------------------------------------------------------------------
//  Fotos: cada arma en tres cuartos + planos de detalle del ciclo mecánico.
// ---------------------------------------------------------------------------
const WEAPONS = [
  ['mortar120', 'mortero-120mm', { az: 35, dist: 6, height: 2.6, targetZ: 1.0, aim: [20, 70] }],
  ['m777', 'obus-m777-155mm', { az: 40, dist: 13, height: 4.2, targetZ: 1.6, aim: [30, 25] }],
  ['m109', 'm109a7-paladin', { az: 45, dist: 16, height: 5.5, targetZ: 2.0, aim: [40, 20] }],
  ['pion2s7', '2s7-pion-203mm', { az: 42, dist: 26, height: 8.0, targetZ: 2.6, aim: [25, 35] }],
  ['excalibur', 'excalibur-155mm', { az: 40, dist: 13, height: 4.2, targetZ: 1.6, aim: [30, 35] }],
  ['gmlrs', 'himars-gmlrs', { az: 50, dist: 18, height: 6.0, targetZ: 2.2, aim: [35, 45] }],
  ['m26', 'm270-mlrs', { az: 50, dist: 18, height: 6.0, targetZ: 2.2, aim: [35, 50] }],
  ['ergmlrs', 'er-gmlrs', { az: 50, dist: 18, height: 6.0, targetZ: 2.2, aim: [35, 45] }],
  ['tacticalMissile', 'misil-tactico', { az: 55, dist: 22, height: 7.0, targetZ: 2.5, aim: [30, 60] }],
  ['prsm', 'prsm-500km', { az: 55, dist: 22, height: 7.0, targetZ: 2.5, aim: [30, 60] }],
  ['pistol9', 'pistola-9mm', { az: 40, dist: 3.6, height: 1.7, targetZ: 1.15, aim: [25, 8] }],
  ['rifle556', 'fusil-556', { az: 40, dist: 3.6, height: 1.6, targetZ: 1.0, aim: [25, 8] }],
  ['mg762', 'm240-762', { az: 40, dist: 2.6, height: 1.0, targetZ: 0.4, aim: [25, 8] }],
  ['m2browning', 'm2-browning-50', { az: 40, dist: 4.0, height: 1.7, targetZ: 1.0, aim: [25, 15] }],
];

/** Primeros planos del proyectil de cada familia, a escala aumentada. */
const ROUNDS = [
  // [arma, fichero, escala del modelo, distancia de camara]
  ['m777', 'proyectil-155mm-he', 2.2, 4.2],
  ['mortar120', 'proyectil-bomba-mortero', 2.6, 4.2],
  ['gmlrs', 'proyectil-cohete-gmlrs', 1.0, 6.5],
  ['tacticalMissile', 'proyectil-misil', 0.7, 6.5],
  ['m2browning', 'proyectil-bala-50bmg', 34, 4.2],
];

// ---------------------------------------------------------------------------
//  Vídeos: cada uno es un guion (setup + acciones cronometradas).
// ---------------------------------------------------------------------------
const VIDEOS = [
  {
    name: 'm777-ciclo-completo',
    seconds: 14,
    setup: (a) => {
      a.setWeapon('m777');
      a.snapAim(0, 15);
      a.camera({ azDeg: 35, dist: 14, height: 4.5, targetZ: 1.8 });
      a.orbit(4);
      a.showRound(false);
    },
    steps: [
      [0.5, (a) => a.aim(55, 45)],   // servos: la cureña viaja a 5 º/s
      [7.0, (a) => a.fire()],        // culatazo + fogonazo + ciclo de carga
    ],
  },
  {
    name: 'm109-torreta',
    seconds: 13,
    setup: (a) => {
      a.setWeapon('m109');
      a.snapAim(0, 12);
      a.camera({ azDeg: 40, dist: 17, height: 5.5, targetZ: 2.2 });
      a.orbit(3);
      a.showRound(false);
    },
    steps: [
      [0.5, (a) => a.aim(90, 40)],   // torreta motorizada: 13 º/s
      [8.0, (a) => a.fire()],
    ],
  },
  {
    name: 'mortero-bipode',
    seconds: 11,
    setup: (a) => {
      a.setWeapon('mortar120');
      a.snapAim(10, 45);
      a.camera({ azDeg: 30, dist: 5.5, height: 2.2, targetZ: 1.0 });
      a.orbit(6);
      a.showRound(false);
    },
    steps: [
      [0.5, (a) => a.aim(10, 82)],   // el collar sube y las patas se estiran
      [6.0, (a) => a.fire()],
    ],
  },
  {
    name: 'mlrs-salva',
    seconds: 12,
    setup: (a) => {
      a.setWeapon('m26');
      a.snapAim(20, 45);
      a.camera({ azDeg: 55, dist: 17, height: 6, targetZ: 2.5 });
      a.orbit(4);
      a.showRound(false);
    },
    steps: [
      [1.0, (a) => a.fire()],        // los cohetes se van del pod de uno en uno
      [2.6, (a) => a.fire()],
      [4.2, (a) => a.fire()],
      [5.8, (a) => a.fire()],
    ],
  },
  {
    name: 'm2-rafaga-casquillos',
    seconds: 10,
    setup: (a) => {
      a.setWeapon('m2browning');
      a.snapAim(0, 12);
      a.camera({ azDeg: 45, dist: 3.2, height: 1.5, targetZ: 0.95 });
      a.orbit(9);
      a.showRound(false);
    },
    steps: [
      [1.0, (a) => a.autoFire(true)],
      [7.5, (a) => a.autoFire(false)],
    ],
  },
  {
    name: 'explosion-de-impacto',
    seconds: 12,
    setup: (a) => {
      a.setWeapon('m777');
      a.snapAim(0, 10);
      a.camera({ azDeg: 22, dist: 55, height: 14, targetZ: 6 });
      a.orbit(2);
      a.showRound(false);
    },
    steps: [
      [1.0, (a) => a.detonate(40, 1.5)],
      [6.0, (a) => a.detonate(55, 2.6)],
    ],
  },
  {
    name: 'proyectil-giro-y-aletas',
    seconds: 10,
    setup: (a) => {
      a.setWeapon('gmlrs');
      a.soloRound(true);           // solo el proyectil en escena
      a.camera({ azDeg: 0, dist: 6.5, height: 2.6, targetZ: 2.2 });
      a.orbit(14);
      a.roundAt(0, 0, 2.2, 1);
      a.restartRound();            // aletas plegadas: se abren en 0.25 s
    },
    steps: [
      [3.0, (a) => { a.setWeapon('m777'); a.soloRound(true); a.roundAt(0, 0, 2.2, 2.2); a.restartRound(); }],
      [6.5, (a) => { a.setWeapon('mortar120'); a.soloRound(true); a.roundAt(0, 0, 2.2, 2.6); a.restartRound(); }],
    ],
  },
];

// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(page, { cine }) {
  await page.goto(`${BASE}/armory.html${cine ? '?cine=1' : ''}`);
  await page.waitForSelector('#armoryCanvas canvas', { timeout: 30_000 });
  await page.waitForFunction(() => !!window.armory?.ready(), null, { timeout: 30_000 });
  await sleep(600);
}

/** Ejecuta una arrow `(a) => ...` en la página con `a` = window.armory. */
async function run(page, fn) {
  await page.evaluate((src) => { new Function('a', `(${src})(a)`)(window.armory); }, fn.toString());
}

async function capturePngs(browser) {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await boot(page, { cine: true });

  console.log('· fotos de las armas');
  for (const [id, file, shot] of WEAPONS) {
    await run(page, (a) => a.showRound(false));
    await page.evaluate(([id, shot]) => {
      window.armory.setWeapon(id);
      window.armory.snapAim(shot.aim[0], shot.aim[1]);
      window.armory.camera({
        azDeg: shot.az, dist: shot.dist, height: shot.height, targetZ: shot.targetZ,
      });
    }, [id, shot]);
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'armas', `${file}.png`) });
  }

  console.log('· primeros planos de los proyectiles');
  for (const [id, file, scale, dist] of ROUNDS) {
    await page.evaluate(([id, scale, dist]) => {
      window.armory.setWeapon(id);
      window.armory.showRound(true);
      window.armory.soloRound(true);         // el arma, fuera de la escena
      window.armory.roundAt(0, 0, 2.0, scale);
      window.armory.camera({ azDeg: -35, dist, height: 2.9, targetZ: 2.0 });
      window.armory.restartRound();
    }, [id, scale, dist]);
    await sleep(1200);                       // deja que se abran las aletas
    await page.screenshot({ path: path.join(OUT, 'proyectiles', `${file}.png`) });
  }
  await run(page, (a) => a.soloRound(false));

  console.log('· secuencia del ciclo mecánico del M777');
  const CYCLE = [
    [0, 'ciclo-0-reposo'],
    [70, 'ciclo-1-culatazo'],          // tubo en el tope de retroceso
    [900, 'ciclo-2-culata-abierta'],
    [3700, 'ciclo-3-atacador-dentro'],
    [6400, 'ciclo-4-culata-cerrada'],
  ];
  await page.evaluate(() => {
    window.armory.setWeapon('m777');
    window.armory.snapAim(35, 20);
    window.armory.showRound(false);
    // Tres cuartos TRASERA: el arma apunta a 35º, así que la culata (y el
    // atacador, que entra por detrás) quedan de frente a la cámara.
    window.armory.camera({ azDeg: -25, dist: 5.0, height: 2.2, targetZ: 1.5 });
  });
  await sleep(600);
  let last = 0;
  for (const [ms, file] of CYCLE) {
    if (ms === 0) {
      await page.screenshot({ path: path.join(OUT, 'ciclo', `${file}.png`) });
      await run(page, (a) => a.fire());
      last = 0;
      continue;
    }
    await sleep(ms - last);
    last = ms;
    await page.screenshot({ path: path.join(OUT, 'ciclo', `${file}.png`) });
  }

  console.log('· fogonazo y explosión');
  await page.evaluate(() => {
    window.armory.setWeapon('m777');
    window.armory.snapAim(0, 20);
    window.armory.camera({ azDeg: 40, dist: 16, height: 4.5, targetZ: 3.5 });
  });
  await sleep(500);
  await run(page, (a) => a.fire());
  await sleep(90);
  await page.screenshot({ path: path.join(OUT, 'vfx', 'fogonazo-primario.png') });
  await sleep(180);
  await page.screenshot({ path: path.join(OUT, 'vfx', 'fogonazo-pluma.png') });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'vfx', 'humo-de-boca.png') });

  await page.evaluate(() => {
    window.armory.camera({ azDeg: 20, dist: 70, height: 18, targetZ: 8 });
  });
  await sleep(400);
  await run(page, (a) => a.detonate(45, 2.2));
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'vfx', 'explosion-flash.png') });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'vfx', 'explosion-bola-de-fuego.png') });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'vfx', 'explosion-hongo.png') });

  await page.close();
}

/**
 * Graba el canvas con MediaRecorder (H.264/MP4 nativo de Chromium) mientras
 * el guion ejecuta sus pasos, y devuelve el fichero en base64.
 */
async function captureVideo(browser, spec) {
  const page = await browser.newPage({ viewport: VIEW });
  await boot(page, { cine: true });

  await page.evaluate((src) => new Function('a', `(${src})(a)`)(window.armory), spec.setup.toString());
  await sleep(700); // deja asentar el primer frame

  const mime = await page.evaluate(() => {
    for (const t of ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9']) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  });
  if (!mime) throw new Error('este Chromium no puede grabar vídeo');

  await page.evaluate((mime) => {
    const canvas = document.querySelector('#armoryCanvas canvas');
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    window.__rec = { rec, chunks, mime };
    rec.start(200);
  }, mime);

  const t0 = Date.now();
  for (const [at, fn] of spec.steps) {
    const wait = at * 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await page.evaluate((src) => new Function('a', `(${src})(a)`)(window.armory), fn.toString());
  }
  const rest = spec.seconds * 1000 - (Date.now() - t0);
  if (rest > 0) await sleep(rest);

  const b64 = await page.evaluate(() => new Promise((res) => {
    const { rec, chunks, mime } = window.__rec;
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: mime });
      const buf = await blob.arrayBuffer();
      let s = '';
      const bytes = new Uint8Array(buf);
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      res(btoa(s));
    };
    rec.stop();
  }));

  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const file = path.join(OUT, 'videos', `${spec.name}.${ext}`);
  await writeFile(file, Buffer.from(b64, 'base64'));
  await page.close();
  return file;
}

// ---------------------------------------------------------------------------
(async () => {
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  for (const d of ['armas', 'proyectiles', 'ciclo', 'vfx', 'videos']) {
    await mkdir(path.join(OUT, d), { recursive: true });
  }

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  if (wantPng) await capturePngs(browser);

  if (wantVideo) {
    for (const spec of VIDEOS) {
      process.stdout.write(`· vídeo ${spec.name} (${spec.seconds}s)… `);
      const f = await captureVideo(browser, spec);
      console.log(path.basename(f));
    }
  }

  await browser.close();
  console.log(`\nListo → ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
