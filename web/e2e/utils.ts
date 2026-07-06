// ============================================================================
//  utils.ts — Arnés común de los specs E2E (P-PRO.9).
//
//  Filtro de ruido benigno de consola, recolector de errores, arranque de la
//  app y localizadores compartidos del panel. Todos los specs corren en serie
//  contra el mismo webServer (`npm run e2e`), sin CI a propósito.
// ============================================================================
import { Page, expect } from '@playwright/test';

/** Ruido benigno que NO debe tumbar un spec: token/assets de Cesium ion y
 *  teselas de imaginería caprichosas (los fallos reales llegan por pageerror). */
export const IGNORED = [
  /cesium ion/i,
  /ion\.cesium\.com/i,
  /api\.cesium\.com/i,
  /Failed to load resource/i,
];

/** Acumula errores de consola no ignorados + pageerrors del spec. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Arranca la app y espera globo Cesium + overlay Three vivos. */
export async function bootApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#cesiumContainer canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas.three-overlay')).toHaveCount(1);
}

/** Espera a que el arco de preview esté resuelto (readout "→ … km"). */
export async function waitForPreview(page: Page): Promise<void> {
  const readout = page.locator('#controlPanel .readout');
  await expect(readout).toContainText('→', { timeout: 60_000 });
  await expect(readout).toContainText('km');
}

/** Localizadores del panel: los <select> son [arma, munición, carga]. */
export const SEL = {
  weaponSelect: '#controlPanel select >> nth=0',
  roundSelect: '#controlPanel select >> nth=1',
  chargeSelect: '#controlPanel select >> nth=2',
  azSlider: '#controlPanel input[type="range"] >> nth=0',
  elSlider: '#controlPanel input[type="range"] >> nth=1',
  toast: '#toast',
} as const;
