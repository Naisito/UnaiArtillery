// Vite + Vitest config. vite-plugin-cesium copia los assets estáticos de Cesium
// (workers, glTF del globo, CSS) y define CESIUM_BASE_URL, sin lo cual el globo
// no arranca en un bundler.
import { defineConfig } from 'vitest/config';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [cesium()],
  build: {
    chunkSizeWarningLimit: 6000, // cesium.js es grande; es esperado
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Los tests de validación integran miles de trayectorias RK4: dales margen.
    testTimeout: 120_000,
  },
});
