// ============================================================================
//  utils.ts — Arnés común de los specs E2E (P-PRO.9 · interfaz V2).
//
//  Filtro de ruido benigno de consola, recolector de errores, arranque de la
//  app (globo + overlay + estación lista) y localizadores estables por
//  data-testid. Todos los specs corren en serie contra el mismo webServer
//  (`npm run e2e`), sin CI a propósito.
// ============================================================================
import { Page, expect } from '@playwright/test';

/** Ruido benigno que NO debe tumbar un spec: token/assets de Cesium ion y
 *  teselas de imaginería caprichosas (los fallos reales llegan por pageerror). */
export const IGNORED = [
  /cesium ion/i,
  /ion\.cesium\.com/i,
  /api\.cesium\.com/i,
  /Failed to load resource/i,
  /virtualearth\.net/i,
  /CORS policy/i,
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

/** Localizador por data-testid. */
export const tid = (id: string) => `[data-testid="${id}"]`;

export const SEL = {
  toast: tid('toast-stack'),
  arsenalOpen: tid('arsenal-open'),
  fire: tid('fire'),
  telemetry: tid('telemetry'),
  telTof: tid('tel-tof'),
  azInput: tid('az-input'),
  elInput: tid('el-input'),
  elSlider: tid('el-slider'),
  cockpitAz: tid('cockpit-az'),
  cockpitEl: tid('cockpit-el'),
  fireDataRange: tid('fire-data-range'),
  weaponName: tid('weapon-name'),
  tutorial: tid('tutorial'),
  tutorialStep: tid('tutorial-step'),
} as const;

/** Arranca la app y espera globo Cesium + overlay Three + estación lista. */
export async function bootApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#cesiumContainer canvas').first()).toBeVisible({ timeout: 60_000 });
  // El overlay Three nace tras anclar la batería (muestreo del terreno): bajo
  // carga puede tardar; se espera a la estación lista y luego se comprueba.
  await page.waitForFunction(() => (window as unknown as { __uaReady?: boolean }).__uaReady === true, null, {
    timeout: 150_000,
  });
  await expect(page.locator('canvas.three-overlay')).toHaveCount(1);
  // La pantalla de arranque se desvanece y se retira del DOM.
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 10_000 });
}

/** Espera a que el preview esté resuelto (tira de datos de tiro con alcance). */
export async function waitForPreview(page: Page): Promise<void> {
  await expect(page.locator(SEL.fireDataRange)).toContainText(/\d/, { timeout: 90_000 });
}

/** Cambia de arma por el Arsenal (la vía de la interfaz V2). */
export async function selectWeapon(page: Page, id: string): Promise<void> {
  await page.locator(SEL.arsenalOpen).click();
  await expect(page.locator(tid('arsenal'))).toBeVisible();
  await page.locator(tid(`arsenal-item-${id}`)).click();
  await expect(page.locator(tid('arsenal'))).toBeHidden();
}

/** Valor numérico de un campo de la interfaz (admite coma decimal). */
export async function numValue(page: Page, selector: string): Promise<number> {
  return parseFloat((await page.locator(selector).inputValue()).replace(',', '.'));
}

/** Azimut del estado de la pieza (grados), la fuente de verdad. */
export async function azimuthDeg(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __ua: { panel: { azimuthDeg: number } } }).__ua.panel.azimuthDeg);
}
