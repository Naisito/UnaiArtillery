// ============================================================================
//  tutorial.spec.ts — P-VIVO.11 · V2: en la primera visita el paso 1 aparece
//  (sin bloquear la app), ejecutar la acción real avanza al 2, "Saltar
//  tutorial" lo cierra, tras recargar no vuelve a molestar y Ayuda lo relanza.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, selectWeapon, tid } from './utils';

test('tutorial: primera visita, avance por acción, saltar, no reaparecer y relanzar', async ({ page }) => {
  const errors = collectErrors(page);
  // Primera visita de verdad: el contexto de Playwright arranca con
  // localStorage VACÍO (nada de addInitScript: se re-ejecutaría en el reload).
  await bootApp(page);

  // Paso 1/6 visible con su tarjeta.
  const overlay = page.locator(SEL.tutorial);
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(SEL.tutorialStep)).toHaveText('1/6');

  // No bloquea: la acción REAL (elegir otra arma en el Arsenal) avanza al 2.
  await selectWeapon(page, 'mortar120');
  await expect(page.locator(SEL.tutorialStep)).toHaveText('2/6');

  // "Saltar paso" avanza sin la acción.
  await page.locator(tid('tutorial-next')).click();
  await expect(page.locator(SEL.tutorialStep)).toHaveText('3/6');

  // "Saltar tutorial" lo cierra…
  await page.locator(tid('tutorial-close')).click();
  await expect(overlay).toBeHidden();

  // …y tras recargar NO reaparece (localStorage lo recuerda).
  await page.reload();
  await bootApp(page);
  await expect(overlay).toBeHidden();

  // Ayuda → "Iniciar tutorial guiado" lo relanza desde el paso 1.
  await page.locator(tid('help-open')).click();
  await page.locator(tid('help-start-tutorial')).click();
  await expect(overlay).toBeVisible();
  await expect(page.locator(SEL.tutorialStep)).toHaveText('1/6');
  await page.locator(tid('tutorial-close')).click();
  await expect(overlay).toBeHidden();

  expect(errors).toEqual([]);
});
