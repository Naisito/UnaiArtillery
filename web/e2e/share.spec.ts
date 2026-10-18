// ============================================================================
//  share.spec.ts — P-VIVO.10 · V2: compartir el escenario por URL.
//
//  Fija estado (arma por el Arsenal + azimut tecleado en milésimas + carga),
//  pulsa Ajustes → Compartir escenario, lee el hash #s=… generado, recarga la
//  app CON ese hash y comprueba que arma, azimut y carga se reconstruyen.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, azimuthDeg, bootApp, collectErrors, selectWeapon, tid, waitForPreview } from './utils';

test('share: la URL con #s=… reconstruye arma, azimut y carga', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('unai-artillery/tutorial/v1', 'done'));
  await bootApp(page);
  await waitForPreview(page);

  // 1) Estado: M109A7, azimut 2195.6 mil (≈ 123.5°), carga índice 1.
  await selectWeapon(page, 'm109');
  await expect(page.locator(SEL.weaponName)).toHaveText('M109A7');
  await waitForPreview(page);
  const az = page.locator(SEL.azInput);
  await az.scrollIntoViewIfNeeded();
  await az.fill('2195.6');
  await az.press('Enter');
  await expect.poll(() => azimuthDeg(page)).toBeCloseTo(123.506, 2);
  await page.locator(tid('charge-1')).click();
  await waitForPreview(page);

  // 2) Comparte desde Ajustes: el hash #s=… aparece en la URL.
  await page.locator(tid('settings-open')).click();
  await page.locator(tid('share')).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#s=');
  const hash = await page.evaluate(() => window.location.hash);

  // 3) Recarga con el hash en una "pestaña nueva" (about:blank fuerza una
  // carga completa: ir de '/#s=…' a '/#s=…' sería navegación same-document).
  await page.goto('about:blank');
  await bootApp(page, `/${hash}`);
  await waitForPreview(page);

  // 4) La estación reconstruye lo compartido.
  await expect(page.locator(SEL.weaponName)).toHaveText('M109A7');
  await expect(page.locator(tid('charge-1'))).toHaveAttribute('aria-checked', 'true');
  expect(await azimuthDeg(page)).toBeCloseTo(123.5, 1);

  expect(errors).toEqual([]);
});
