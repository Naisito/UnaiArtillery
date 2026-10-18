// ============================================================================
//  smoke.spec.ts — E2E de humo (P-NEXT.6 · interfaz V2).
//
//  Vitest blinda la física; esto verifica que la APP ARRANCA: globo Cesium +
//  overlay Three vivos, estación de tiro montada (barra superior, misión de
//  fuego, dock de datos), Arsenal con las 14 armas, el preview resuelto en la
//  tira de datos de tiro y FUEGO activando la telemetría con el TOF
//  avanzando. Cualquier error de consola no esperado hace fallar el test.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, tid, waitForPreview } from './utils';

test('smoke: arranca, previsualiza y dispara sin errores de consola', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('unai-artillery/tutorial/v1', 'done'));

  await bootApp(page);

  // Estación montada: estado de misión, batería en MGRS, pasos y pestañas.
  await expect(page.locator(tid('mission-status'))).toContainText(/Listo/i);
  await expect(page.locator(tid('battery-coord'))).toHaveText(/^\d{1,2}[C-X] [A-Z]{2} \d{5} \d{5}$/);
  for (const step of ['step-weapon', 'step-ammo', 'step-target', 'step-solution', 'step-fire']) {
    await expect(page.locator(tid(step))).toBeVisible();
  }

  // Arsenal: 14 sistemas en 5 categorías.
  await page.locator(SEL.arsenalOpen).click();
  await expect(page.locator('[data-testid^="arsenal-item-"]')).toHaveCount(14);
  await page.keyboard.press('Escape');
  await expect(page.locator(tid('arsenal'))).toBeHidden();

  // Preview resuelto (alcance en la tira de datos de tiro).
  await waitForPreview(page);

  // Fuego: la telemetría se activa y el TOF avanza.
  await page.locator(SEL.fire).click();
  const tel = page.locator(`${SEL.telemetry}[data-state="active"]`);
  await expect(tel).toBeVisible({ timeout: 90_000 });
  const tof = page.locator(SEL.telTof);
  await expect(tof).not.toHaveText('—', { timeout: 30_000 });
  const t1 = parseFloat(await tof.innerText());
  await expect.poll(async () => parseFloat(await tof.innerText()), { timeout: 20_000 }).toBeGreaterThan(t1);
  await expect(page.locator(tid('mission-status'))).toContainText(/En vuelo/i);

  // Ningún error de consola inesperado en todo el recorrido.
  expect(errors).toEqual([]);
});
