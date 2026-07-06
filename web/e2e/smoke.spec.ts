// ============================================================================
//  smoke.spec.ts — E2E de humo (P-NEXT.6).
//
//  Vitest blinda la física; esto verifica que la APP ARRANCA: globo Cesium +
//  overlay Three vivos, panel con arsenal, el arco de preview llega a
//  resolverse (readout "→ … km") y Fuego activa el HUD con el TOF avanzando.
//  Cualquier error de consola no esperado (imports rotos, APIs de Cesium
//  cambiadas, overlay caído) hace fallar el test. Corre sin token de ion
//  (modo OSM) o con él, indistintamente.
// ============================================================================
import { expect, test } from '@playwright/test';

// Ruido benigno que NO debe tumbar el smoke: avisos del token/assets de
// Cesium ion y teselas de imaginería que fallen esporádicamente.
const IGNORED = [
  /cesium ion/i,
  /ion\.cesium\.com/i,
  /api\.cesium\.com/i,
  /Failed to load resource/i, // teselas OSM/ion caprichosas; los fallos reales llegan por pageerror
];

test('smoke: arranca, previsualiza y dispara sin errores de consola', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto('/');

  // (2) El globo Cesium y el overlay Three existen.
  await expect(page.locator('#cesiumContainer canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas.three-overlay')).toHaveCount(1);

  // (3) Selector de armas con 4+ opciones y arco de preview resuelto.
  const weaponOptions = page.locator('#controlPanel select').first().locator('option');
  expect(await weaponOptions.count()).toBeGreaterThanOrEqual(4);
  const readout = page.locator('#controlPanel .readout');
  await expect(readout).toContainText('→', { timeout: 60_000 });
  await expect(readout).toContainText('km');

  // (4) Fuego: el HUD se activa y el TOF avanza.
  await page.getByRole('button', { name: 'Fuego', exact: true }).click();
  const hud = page.locator('#hud.active');
  await expect(hud).toBeVisible({ timeout: 60_000 });
  const tofCell = page.locator('#hud .cell .v').first();
  await expect(tofCell).not.toHaveText('—', { timeout: 20_000 });
  const t1 = parseFloat((await tofCell.innerText()).replace(',', '.'));
  await expect
    .poll(async () => parseFloat((await tofCell.innerText()).replace(',', '.')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(t1);

  // (5) Ningún error de consola inesperado en todo el recorrido.
  expect(errors).toEqual([]);
});
