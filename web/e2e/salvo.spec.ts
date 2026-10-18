// ============================================================================
//  salvo.spec.ts — P-PRO.9: la salva dispersa completa, de punta a punta.
//
//  Mortero (Arsenal) con la carga más corta (C0, 110 m/s, TOF ~15 s por
//  tiro): "Salva ×6" debe terminar en el aviso "Zona batida: CEP … m" y la
//  pestaña ANÁLISIS debe medir la salva; "Cráteres" limpia sin errores.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, selectWeapon, tid, waitForPreview } from './utils';

test('salva dispersa ×6 del mortero: aviso de CEP, análisis y limpiar cráteres', async ({ page }) => {
  // Con WebGL por software los 6 vuelos animan a ~0.2× del tiempo real (el
  // dt del bucle satura a 0.1 s/tick): timeout acorde.
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('unai-artillery/tutorial/v1', 'done'));
  await bootApp(page);
  await waitForPreview(page);

  await selectWeapon(page, 'mortar120');
  await expect(page.locator(SEL.weaponName)).toHaveText('M120');
  await page.locator(tid('charge-0')).click();
  await expect(page.locator(tid('charge-0'))).toHaveAttribute('aria-checked', 'true');

  await page.locator(tid('salvo')).click();
  await expect(page.locator(SEL.toast)).toContainText(/Zona batida: CEP \d+ m/, { timeout: 240_000 });

  // ANÁLISIS: la salva queda medida (6 impactos y CEP).
  await page.locator(tid('tab-analysis')).click();
  await expect(page.locator(tid('panel-analysis'))).toContainText('CEP medido');

  await page.locator(tid('clear-craters')).click();
  await expect(page.locator(SEL.toast)).toContainText('Cráteres limpiados');

  expect(errors).toEqual([]);
});
