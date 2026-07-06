// ============================================================================
//  cameras.spec.ts — P-PRO.9: todos los modos de cámara entran sin errores.
//
//  Recorre los botones de cámara. Para "Seguir" sin proyectil basta el aviso;
//  para "1ª persona" NO se fuerza pointer lock (headless no lo da de forma
//  fiable): se verifica solo el toast de instrucciones. "Libre" restaura el
//  control y queda marcado.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, waitForPreview } from './utils';

test('cámaras: Orbital/Dron/Cabina/Seguir/1ª persona/Libre sin errores', async ({ page }) => {
  const errors = collectErrors(page);
  await bootApp(page);
  await waitForPreview(page);

  const cameraBtn = (label: string) => page.getByRole('button', { name: label, exact: true });

  // Modos automáticos: entran, se marcan y el director mueve la cámara.
  for (const label of ['Orbital', 'Dron', 'Cabina']) {
    await cameraBtn(label).click();
    await expect(cameraBtn(label)).toHaveClass(/toggled/);
    await page.waitForTimeout(500); // unos frames del director en ese modo
  }

  // Seguir sin proyectil vivo: avisa y no rompe nada.
  await cameraBtn('Seguir').click();
  await expect(page.locator(SEL.toast)).toContainText('No hay proyectil');

  // 1ª persona: solo el toast de instrucciones (sin pointer lock en headless).
  await cameraBtn('1ª persona').click();
  await expect(page.locator(SEL.toast)).toContainText('1ª persona');

  // Libre restaura el control del ratón sobre el globo.
  await cameraBtn('Libre').click();
  await expect(cameraBtn('Libre')).toHaveClass(/toggled/);
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
