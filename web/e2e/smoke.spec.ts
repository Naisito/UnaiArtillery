// ============================================================================
//  smoke.spec.ts — E2E de humo (P-NEXT.6, arnés común en utils.ts).
//
//  Vitest blinda la física; esto verifica que la APP ARRANCA: globo Cesium +
//  overlay Three vivos, panel con arsenal, el arco de preview llega a
//  resolverse (readout "→ … km") y Fuego activa el HUD con el TOF avanzando.
//  Cualquier error de consola no esperado (imports rotos, APIs de Cesium
//  cambiadas, overlay caído) hace fallar el test. Corre sin token de ion
//  (modo OSM) o con él, indistintamente.
// ============================================================================
import { expect, test } from '@playwright/test';
import { bootApp, collectErrors, waitForPreview } from './utils';

test('smoke: arranca, previsualiza y dispara sin errores de consola', async ({ page }) => {
  const errors = collectErrors(page);

  await bootApp(page);

  // Selector de armas con 4+ opciones y arco de preview resuelto.
  const weaponOptions = page.locator('#controlPanel select').first().locator('option');
  expect(await weaponOptions.count()).toBeGreaterThanOrEqual(4);
  await waitForPreview(page);

  // Fuego: el HUD se activa y el TOF avanza.
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

  // Ningún error de consola inesperado en todo el recorrido.
  expect(errors).toEqual([]);
});
