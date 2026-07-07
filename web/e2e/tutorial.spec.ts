// ============================================================================
//  tutorial.spec.ts — P-VIVO.11: en la primera visita el paso 1 aparece,
//  ejecutar la acción real avanza al 2, "Saltar" lo cierra y tras recargar
//  no vuelve a molestar.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors } from './utils';

test('tutorial: primera visita, avance por acción, saltar y no reaparecer', async ({ page }) => {
  const errors = collectErrors(page);
  // Primera visita de verdad: el contexto de Playwright arranca con
  // localStorage VACÍO (nada de addInitScript: se re-ejecutaría en el reload
  // del paso final y borraría la marca "visto" que precisamente se verifica).

  await bootApp(page);

  // Paso 1/6 visible con su globo.
  const overlay = page.locator('#tutorialOverlay');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  await expect(overlay.locator('.tut-step')).toHaveText('1/6');

  // Ejecutar la acción REAL (elegir otra arma) avanza al paso 2 — nada de
  // botón "siguiente".
  await page.locator(SEL.weaponSelect).selectOption('mortar120');
  await expect(overlay.locator('.tut-step')).toHaveText('2/6');

  // "Saltar" lo cierra…
  await overlay.getByRole('button', { name: 'Saltar' }).click();
  await expect(overlay).toBeHidden();

  // …y tras recargar NO reaparece (localStorage lo recuerda).
  await page.reload();
  await bootApp(page);
  await expect(overlay).toBeHidden();

  // El botón ❓ lo relanza cuando se quiere.
  await page.locator('#tutorialHelpBtn').click();
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.tut-step')).toHaveText('1/6');
  await overlay.getByRole('button', { name: 'Saltar' }).click();

  expect(errors).toEqual([]);
});
