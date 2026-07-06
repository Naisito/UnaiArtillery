// ============================================================================
//  salvo.spec.ts — P-PRO.9: la salva dispersa completa, de punta a punta.
//
//  Mortero con carga corta (TOF ~15 s por tiro, salva escalonada 0.5 s):
//  "Salva dispersa ×6" debe terminar en el toast "Zona batida: CEP … m"
//  (timeout generoso: física en worker + 6 vuelos animados), y "Limpiar
//  cráteres" debe pasar sin errores con los InstancedMesh de P-PRO.8.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, waitForPreview } from './utils';

test('salva dispersa ×6 del mortero: toast de CEP y limpiar cráteres', async ({ page }) => {
  // Con WebGL por software (swiftshader) los 6 vuelos animan a ~0.2× del
  // tiempo real (el dt del bucle satura a 0.1 s/tick): los ~18 s de salva
  // tardan ~100 s de reloj. Timeout acorde, medido en máquina de desarrollo.
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await bootApp(page);
  await waitForPreview(page);

  // Mortero + carga más corta (Charge 0, 110 m/s): TOF corto, salva rápida.
  await page.locator(SEL.weaponSelect).selectOption('mortar120');
  await page.locator(SEL.chargeSelect).selectOption('0');

  await page.getByRole('button', { name: /Salva dispersa/ }).click();
  await expect(page.locator(SEL.toast)).toContainText(/Zona batida: CEP \d+ m/, {
    timeout: 240_000,
  });

  await page.getByRole('button', { name: 'Limpiar cráteres', exact: true }).click();
  await expect(page.locator(SEL.toast)).toContainText('Cráteres limpiados');

  expect(errors).toEqual([]);
});
