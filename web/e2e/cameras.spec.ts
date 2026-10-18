// ============================================================================
//  cameras.spec.ts — P-PRO.9 · V2: todos los modos de cámara entran sin
//  errores desde el selector flotante.
//
//  Órbita/Dron/Artillero se marcan (y Artillero muestra el HUD de puntería);
//  "Seguir" sin proyectil avisa; "1ª persona" NO fuerza pointer lock
//  (headless no lo da de forma fiable): basta el aviso de instrucciones.
//  "Libre" restaura el control y queda marcado.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, tid, waitForPreview } from './utils';

test('cámaras: Órbita/Dron/Artillero/Seguir/1ª persona/Libre sin errores', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('unai-artillery/tutorial/v1', 'done'));
  await bootApp(page);
  await waitForPreview(page);

  const cam = (mode: string) => page.locator(tid(`camera-${mode}`));

  for (const mode of ['orbital', 'drone', 'cabin']) {
    await cam(mode).click();
    await expect(cam(mode)).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(500); // unos frames del director en ese modo
  }
  // La cámara Artillero muestra el HUD de puntería.
  await expect(page.locator('#gunnerHud')).toHaveClass(/active/);

  // Seguir sin proyectil vivo: avisa y no rompe nada.
  await cam('follow').click();
  await expect(page.locator(SEL.toast)).toContainText('No hay proyectil');

  // 1ª persona: solo el aviso de instrucciones (sin pointer lock en headless).
  await cam('fps').click();
  await expect(page.locator(SEL.toast)).toContainText('1ª persona');

  // Libre restaura el control del ratón sobre el globo.
  await cam('free').click();
  await expect(cam('free')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#gunnerHud')).not.toHaveClass(/active/);
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
