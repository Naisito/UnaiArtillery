# Unai Artillery — app web (CesiumJS + Three.js)

Capa de presentación principal del simulador. El núcleo de física vive en
`src/ballistics/` y es un **porte 1:1 del `/core` C++ validado** (misma numérica;
la suite de tests verifica paridad ±0.1 % contra valores de referencia del C++).

## Requisitos

- Node 20+ (desarrollado con Node 22).
- Opcional: token gratuito de [Cesium ion](https://ion.cesium.com/tokens) para
  terreno e imaginería reales. Sin token, la app arranca igualmente con
  OpenStreetMap sobre el elipsoide (sin relieve).
- Opcional: [Rust](https://rustup.rs) para el empaquetado de escritorio con Tauri.

## Uso

```bash
npm install
cp .env.example .env        # y pega tu VITE_CESIUM_TOKEN
npm run dev                 # http://localhost:5173
```

En la app: elige arma y carga, ajusta azimut/elevación o pulsa **🎯 Objetivo** y haz
clic en el globo (la dirección de tiro resuelve la elevación contra el relieve real).
**Fuego** dispara; **Salva MRSI ×3** hace impactar varias rondas a la vez;
**Comparar físicas** superpone vacío/arrastre/Coriolis/viento. El panel derecho
controla viento (incluido un perfil con cizalladura de ejemplo), temperatura y
presión. El **cockpit** (abajo-izquierda) afina la puntería con la rueda del ratón
sobre la rosa de azimut o el cuadrante de elevación: paso 0.5º, Shift 0.05º (fino),
Ctrl 5º (grueso); arrastrar también apunta. Cámaras: Libre / Orbital / **Seguir**
(persigue el proyectil con bullet-time al impactar; arrastra para orbitar a su
alrededor y usa la rueda para el zoom) / Dron / **Cabina** (en la boca del arma,
gira con la rueda: pulsa Fuego y ve salir el tiro) / **1ª persona** (clic captura
el ratón; WASD mueve, Espacio/C sube/baja, Shift esprinta, la rueda ajusta la
velocidad de vuelo, Esc suelta el ratón). `?bloom=1` en la URL activa el
UnrealBloomPass experimental.

### Edificios 3D fotorrealistas (Google Earth) — opcional

Con una clave de **Google Maps Platform** en `.env` (`VITE_GOOGLE_MAPS_KEY`), el
toggle **🏙 Edificios 3D** carga los *Photorealistic 3D Tiles* (los datos de
Google Earth: ciudades y edificios reales). Cómo sacarla:

1. [Google Cloud Console](https://console.cloud.google.com/) → crea un proyecto.
2. *APIs & Services* → habilita **Map Tiles API**.
3. *Credentials* → *Create credentials* → *API key* y pégala en `.env`.

La Map Tiles API tiene **cuota gratuita mensual** (miles de sesiones de render de
tiles 3D al mes; consulta la [página de precios](https://developers.google.com/maps/documentation/tile/usage-and-billing)).
Alternativa sin clave de Google: con token de ion, el toggle intenta el asset
**2275207** (el mismo tileset servido por Cesium ion, si lo has añadido a tu
cuenta). Clave inválida o cuota agotada → aviso y la app sigue como siempre.

> Los edificios son **solo visuales**: la física sigue muestreando el
> `terrainProvider` (el impacto se calcula contra el terreno, no contra los
> tejados). La atribución de Google se muestra automáticamente en el pie del
> globo (créditos del tileset); no la ocultes.

## Tests y herramientas

```bash
npm test                              # suite completa (validación + fidelidad)
npm run e2e                           # smoke E2E: build + Playwright (ver abajo)
npm run firing-table -- m777 3 1000   # tabla de tiro CSV por stdout (P4.3)
npx tsx tools/calibrate_bc.ts         # recalibra los BC del catálogo
```

### Smoke E2E (Playwright, local)

`npm run e2e` construye la app y lanza `e2e/smoke.spec.ts` con chromium headless
contra `vite preview`: comprueba que el globo y el overlay arrancan, que el
selector de armas está poblado, que el arco de preview se resuelve, que **Fuego**
activa el HUD con el TOF avanzando, y falla ante cualquier error de consola no
esperado (se ignoran los avisos de token de Cesium y teselas caprichosas). Corre
sin token de ion (modo OSM). La primera vez: `npx playwright install chromium`.
Sin workflow de CI a propósito: este proyecto no usa GitHub Actions.

`validation.test.ts` replica el arnés C++ (`tests/validation.cpp`) con los MISMOS
umbrales y añade la paridad numérica; `fidelity.test.ts` cubre G1/G7+BC, spin
drift/Magnus, perfil de viento, dispersión/CEP, Tierra esférica (misil ~300 km),
guiado Pro-Nav, MRSI y el generador de tablas. Física documentada en
[`../docs/FISICA_WEB.md`](../docs/FISICA_WEB.md).

## Build y escritorio (Tauri)

```bash
npm run build               # typecheck estricto + dist/
npm run preview             # sirve dist/ en local

npm run tauri dev           # app nativa en desarrollo (requiere Rust)
npm run tauri build         # instalador Windows (NSIS), decenas de MB
```

### Modo offline (equipos sin internet)

CesiumJS pide teselas por red. Para una demo sin conexión:

1. Descarga una región como tileset local (p. ej. terreno cuantizado + imaginería
   TMS con [ctb-tile](https://github.com/geo-data/cesium-terrain-builder) o QGIS).
2. Sírvela desde `public/tiles/` y crea el viewer con
   `CesiumTerrainProvider.fromUrl('/tiles/terrain')` y un
   `UrlTemplateImageryProvider` local en `src/viewer.ts`.
3. Empaqueta con Tauri: los assets locales viajan dentro del instalador.

Sin tileset local, el modo sin token (elipsoide + OSM cacheado por el navegador)
sigue permitiendo demostrar toda la física.

## Arquitectura (mapa rápido)

| Pieza | Rol |
|---|---|
| `src/ballistics/` | Núcleo puro (sin DOM/Cesium): solver, catálogo, dirección de tiro |
| `src/frame.ts` | Única frontera ENU↔ECEF (como el bridge de la era Unreal) |
| `src/BallisticsService.ts` | Terreno real muestreado + meteo + solves async |
| `src/ProjectilePresenter.ts` | Reproduce el `FlightResult`; física y render desacoplados |
| `src/render/ThreeOverlay.ts` | Cámara Three esclava de Cesium, render relativo a cámara |
| `src/vfx/` · `src/ui/` | Efectos procedurales y consola de tiro / HUD / meteo |
