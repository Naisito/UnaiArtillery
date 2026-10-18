// ============================================================================
//  tools/shot.mjs — Captura de pantalla headless de la app (o del Model Lab).
//
//  Uso:
//    node tools/shot.mjs --url http://localhost:5173/ --out C:/tmp/a.png
//         [--wait 20000]            ms extra tras cargar (Cesium tarda ~15-25 s)
//         [--ready __uaReady]       espera a que window[ready] sea truthy
//         [--w 1600 --h 900]        viewport
//         [--eval "js"]             JS a ejecutar en la página antes de capturar
//                                   (puede ser async; p. ej. usar window.__ua)
//         [--after 3000]            ms a esperar tras --eval
//         [--click "css"]           clic en un selector antes de capturar
//
//  WebGL por software (swiftshader): lento pero determinista. Imprime los
//  errores de consola/página al final (útil para detectar regresiones).
// ============================================================================
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const url = opt('url', 'http://localhost:5173/');
const out = opt('out', 'shot.png');
const wait = Number(opt('wait', '20000'));
const ready = opt('ready', '');
const w = Number(opt('w', '1600'));
const h = Number(opt('h', '900'));
const evalJs = opt('eval', '');
const after = Number(opt('after', '2500'));
const click = opt('click', '');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(url);
if (ready) {
  await page.waitForFunction((k) => Boolean(window[k]), ready, { timeout: 120_000 });
}
await page.waitForTimeout(wait);
if (click) {
  await page.click(click, { timeout: 5000 }).catch((e) => logs.push(`click failed: ${e.message}`));
  await page.waitForTimeout(after);
}
if (evalJs) {
  try {
    await page.evaluate(`(async () => { ${evalJs} })()`);
  } catch (e) {
    logs.push(`eval failed: ${e.message}`);
  }
  await page.waitForTimeout(after);
}
await page.screenshot({ path: out });
console.log(`saved ${out}`);
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
