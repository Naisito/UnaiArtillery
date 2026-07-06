// Playwright — smoke E2E local (P-NEXT.6). Corre contra el BUILD servido por
// `vite preview` (el webServer se levanta solo). Sin workflow de CI a
// propósito: este proyecto no usa GitHub Actions; se corre con `npm run e2e`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  // El globo es un solo estado global: nada de paralelizar contra el mismo server.
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    // WebGL por software en chromium headless (Cesium lo necesita).
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
