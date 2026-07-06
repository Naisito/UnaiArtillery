// ============================================================================
//  cockpit.spec.ts — P-PRO.9: puntería fina con la rueda y sincronía
//  bidireccional cockpit ⇄ panel.
//
//  La rueda sobre la rosa de azimut mueve el rumbo ±0.5º (±0.05º con Shift) —
//  se lee en el SLIDER del panel (valor exacto, sin redondeo de etiqueta) — y
//  mover el slider de elevación repinta el cuadrante del cockpit.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, bootApp, collectErrors, waitForPreview } from './utils';

test('cockpit: rueda ±0.5º (±0.05º con Shift) y repintado al mover el slider', async ({ page }) => {
  const errors = collectErrors(page);
  await bootApp(page);
  await waitForPreview(page);

  const azCanvas = page.locator('#cockpit canvas').nth(0);
  await expect(azCanvas).toBeVisible();
  const azSlider = page.locator(SEL.azSlider);
  const az0 = parseFloat(await azSlider.inputValue());

  // Rueda hacia arriba: +0.5º.
  await azCanvas.dispatchEvent('wheel', { deltaY: -100 });
  await expect
    .poll(async () => parseFloat(await azSlider.inputValue()))
    .toBeCloseTo(az0 + 0.5, 6);

  // Con Shift: paso fino 0.05º. OJO: el slider tiene step=0.5 y SNAPEA los
  // intermedios, así que se dan 10 pasos finos — si el paso fuera el normal
  // el rumbo acabaría en +5.5º, con el fino acaba exactamente en +1.0º.
  for (let i = 0; i < 10; i++) {
    await azCanvas.dispatchEvent('wheel', { deltaY: -100, shiftKey: true });
  }
  await expect
    .poll(async () => parseFloat(await azSlider.inputValue()))
    .toBeCloseTo(az0 + 1.0, 6);

  // Rueda hacia abajo deshace el paso normal.
  await azCanvas.dispatchEvent('wheel', { deltaY: 100 });
  await expect
    .poll(async () => parseFloat(await azSlider.inputValue()))
    .toBeCloseTo(az0 + 0.5, 6);

  // Sincronía panel → cockpit: mover el slider de elevación repinta el
  // cuadrante (el canvas cambia de píxeles).
  const elCanvas = page.locator('#cockpit canvas').nth(1);
  const before = await elCanvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.locator(SEL.elSlider).evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = String(Number(input.value) > 40 ? 20 : 60);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => elCanvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()), {
      timeout: 10_000,
    })
    .not.toBe(before);

  expect(errors).toEqual([]);
});
