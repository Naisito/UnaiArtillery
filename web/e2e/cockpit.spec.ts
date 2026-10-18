// ============================================================================
//  cockpit.spec.ts — P-PRO.9 · V2: puntería fina con la rueda, el teclado y
//  sincronía bidireccional instrumentos ⇄ campos.
//
//  Unidad por defecto: milésimas OTAN. Rueda sobre la rosa de azimut: ±10 mil
//  (Shift ±1 mil); flechas del teclado ±1 mil (Ctrl ±10). La fuente de verdad
//  es el estado de la pieza (grados). Mover la elevación repinta el cuadrante.
// ============================================================================
import { expect, test } from '@playwright/test';
import { SEL, azimuthDeg, bootApp, collectErrors, waitForPreview } from './utils';

const MIL = 360 / 6400;

test('instrumentos: rueda ±10 mil (Shift ±1), flechas ±1 mil y repintado del cuadrante', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('unai-artillery/tutorial/v1', 'done'));
  await bootApp(page);
  await waitForPreview(page);

  const azCanvas = page.locator(SEL.cockpitAz);
  await azCanvas.scrollIntoViewIfNeeded();
  await expect(azCanvas).toBeVisible();
  const az0 = await azimuthDeg(page);

  // Rueda hacia arriba: +10 mil.
  await azCanvas.dispatchEvent('wheel', { deltaY: -100 });
  await expect.poll(() => azimuthDeg(page)).toBeCloseTo(az0 + 10 * MIL, 6);

  // Con Shift: paso fino de 1 mil (10 pasos = +10 mil más).
  for (let i = 0; i < 10; i++) {
    await azCanvas.dispatchEvent('wheel', { deltaY: -100, shiftKey: true });
  }
  await expect.poll(() => azimuthDeg(page)).toBeCloseTo(az0 + 20 * MIL, 6);

  // Rueda hacia abajo deshace un paso normal.
  await azCanvas.dispatchEvent('wheel', { deltaY: 100 });
  await expect.poll(() => azimuthDeg(page)).toBeCloseTo(az0 + 10 * MIL, 6);

  // El campo numérico refleja la milésima exacta.
  await expect.poll(async () => parseFloat(await page.locator(SEL.azInput).inputValue()))
    .toBeCloseTo((az0 + 10 * MIL) / MIL, 1);

  // Teclado: → +1 mil; Ctrl+← −10 mil (foco fuera de los campos).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => azimuthDeg(page)).toBeCloseTo(az0 + 11 * MIL, 6);
  await page.keyboard.press('Control+ArrowLeft');
  await expect.poll(() => azimuthDeg(page)).toBeCloseTo(az0 + 1 * MIL, 6);

  // Sincronía campos → instrumentos: escribir la QE repinta el cuadrante.
  const elCanvas = page.locator(SEL.cockpitEl);
  const before = await elCanvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const el = page.locator(SEL.elInput);
  const cur = parseFloat(await el.inputValue());
  await el.fill(String(cur > 700 ? 400 : 1000));
  await el.press('Enter');
  await expect
    .poll(async () => elCanvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()), { timeout: 10_000 })
    .not.toBe(before);

  expect(errors).toEqual([]);
});
