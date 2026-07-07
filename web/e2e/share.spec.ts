// ============================================================================
//  share.spec.ts — P-VIVO.10: compartir el escenario por URL.
//
//  Fija estado (arma + azimut + carga), pulsa 🔗 Compartir, lee el hash #s=…
//  generado, recarga la app CON ese hash y comprueba que arma, azimut y carga
//  del panel coinciden con lo compartido.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, waitForPreview } from './utils';

test('share: la URL con #s=… reconstruye arma, azimut y carga', async ({ page }) => {
  const errors = collectErrors(page);
  // El contexto de Playwright arranca con localStorage vacío (sin sesión que
  // contamine) y el hash #s=… tiene prioridad sobre la sesión de todos modos.

  await bootApp(page);
  await waitForPreview(page);

  // 1) Fija el estado: M109, azimut 123.5º, carga índice 1.
  await page.locator(SEL.weaponSelect).selectOption('m109');
  await waitForPreview(page);
  await page.locator(SEL.azSlider).evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '123.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator(SEL.chargeSelect).selectOption('1');
  await waitForPreview(page);

  // 2) Comparte: el hash #s=… aparece en la URL.
  await page.getByRole('button', { name: '🔗 Compartir' }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#s=');
  const hash = await page.evaluate(() => window.location.hash);

  // 3) Recarga con el hash en una "pestaña nueva". OJO: no usar bootApp aquí
  // (su goto('/') borraría el hash); y pasar por about:blank fuerza una carga
  // completa (ir de '/#s=…' a '/#s=…' sería navegación same-document).
  await page.goto('about:blank');
  await page.goto(`/${hash}`);
  await expect(page.locator('#cesiumContainer canvas').first()).toBeVisible({ timeout: 30_000 });
  await waitForPreview(page);

  // 4) El panel reconstruye lo compartido.
  await expect(page.locator(SEL.weaponSelect)).toHaveValue('m109');
  await expect(page.locator(SEL.chargeSelect)).toHaveValue('1');
  const az = parseFloat(await page.locator(SEL.azSlider).inputValue());
  expect(az).toBeCloseTo(123.5, 1);

  expect(errors).toEqual([]);
});
