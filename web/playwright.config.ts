// Playwright — smoke E2E local (P-NEXT.6). Corre contra el BUILD servido por
// `vite preview` (el webServer se levanta solo). Sin workflow de CI a
// propósito: este proyecto no usa GitHub Actions; se corre con `npm run e2e`.
//
// E2E_PORT (opcional, defecto 4173) permite correr varias suites a la vez en
// worktrees distintos sin que una reutilice el servidor de otra.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  // El globo es un solo estado global: nada de paralelizar contra el mismo server.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Pantalla de escritorio real (1280×960): los docks laterales y la
    // telemetría caben sin solaparse.
    viewport: { width: 1280, height: 960 },
    // WebGL por software en chromium headless (Cesium lo necesita).
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
