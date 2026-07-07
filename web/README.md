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
presión; **🌍 Meteo real (aquí y ahora)** instala la atmósfera de verdad de la
posición de la batería vía [Open-Meteo](https://open-meteo.com) (gratis, sin
clave): perfil de viento por niveles de presión 1000→200 hPa pasado a altitud
con el modelo ISA-76 y T/P de superficie reducidas al nivel del mar; se
re-consulta al mover la batería mientras el modo real siga activo (caché de
15 min), y tocar cualquier control manual lo desactiva. Sin red, un toast avisa
y el modo manual sigue intacto. El botón **📋 Tabla de tiro** (abajo-derecha)
despliega la tabla del arma/carga/meteo vigentes — alcance → QE↓/QE↑, TOF y
deriva —; clic en una fila apunta ahí y CSV la descarga. Con objetivo marcado
se pinta la **elipse de error predicha** (1σ/2σ, leyenda PER): la salva
dispersa debe caer mayoritariamente dentro. El **cockpit** (abajo-izquierda) afina la puntería con la rueda del ratón
sobre la rosa de azimut o el cuadrante de elevación: paso 0.5º, Shift 0.05º (fino),
Ctrl 5º (grueso); arrastrar también apunta. Cámaras: Libre / Orbital / **Seguir**
(persigue el proyectil con bullet-time al impactar; arrastra para orbitar a su
alrededor y usa la rueda para el zoom) / Dron / **Cabina** (en la boca del arma,
gira con la rueda: pulsa Fuego y ve salir el tiro) / **1ª persona** (clic captura
el ratón; WASD mueve, Espacio/C sube/baja, Shift esprinta, la rueda ajusta la
velocidad de vuelo, Esc suelta el ratón). `?bloom=1` en la URL activa el
UnrealBloomPass experimental.

### La 4ª ola: el mundo responde (P-VIVO)

- **Audio 2.0** — control 🔊 (volumen + mute, persiste), pan estéreo que gira
  con la cámara, silbido del proyectil subsónico al caer cerca (un GMLRS
  supersónico NO silba) y crack de armas ligeras. Todo síntesis, cero assets.
- **El mar responde** — un tiro al océano levanta columna de agua + anillos +
  spray (sin cráter flotante) con boom ahogado; el waterMask de World Terrain
  pinta el mar especular. Las balas (solo munición inerte) REBOTAN rasantes
  sobre el agua: ángulo < 12°, probabilidad 1−α/12, reflexión con restitución
  y ±3° de desvío, re-integradas en el worker hasta 2 rebotes — trazadoras
  saltando, reproducible por semilla. Lagos/ríos interiores no se detectan
  (limitación documentada).
- **🏢 Edificios que paran tiros** — con los 3D Tiles activos, la cola de cada
  vuelo se pre-muestrea contra el suelo visual: un tiro tenso contra un
  rascacielos explota EN la fachada (sin cráter fantasma detrás) con toast de
  distancia al objetivo; un tiro por elevación lo sobrevuela sin recorte. La
  física no se toca: es un recorte de presentación (documentado).
- **Ráfagas** — con la M240/M2 el botón FUEGO pasa a **MANTENER**: cadencia
  real (750/550 rpm), rebufo determinista por ráfaga, 1 trazadora cada 5
  balas (la línea rojo-anaranjada curvándose ES la balística), tope de 24
  proyectiles en vuelo. Soltar corta la ráfaga al instante.
- **🌙 Noche + ILLUM + SMOKE** — el toggle Noche pone la medianoche solar
  local de la batería (y ☀️ Día la deshace); el mortero y el M777 ganan
  munición de **iluminación** (bengala bajo paracaídas que deriva con el
  viento real ~50 s, con espoleta de tiempo automática) y de **humo**
  (cortina ~90 s perpendicular al rumbo que deriva con el viento).
- **🔭 Reto FO** — el juego serio: solo ves el mundo desde un puesto de
  observación con línea de visión validada contra el relieve; corriges con
  "derecha/izquierda 25/50/100" y "largo/corto" SOBRE TU LÍNEA DE VISIÓN
  (así se corrige de verdad), el boom llega tarde según la distancia y
  puntúas por rondas gastadas (récord por arma).
- **🚚 Reto móvil** — un camión a 20-60 km/h pegado al relieve con estela:
  el impacto se puntúa contra dónde está el blanco CUANDO EL TIRO CAE. El
  toggle "adelanto sugerido" pinta un fantasma extrapolado al TOF del
  preview: apúntale, re-apunta 2-3 veces y verás converger la solución
  (lead = v·TOF). El minimapa del artillero pinta el blanco con su vector.
- **🔗 Compartir** — la URL (`#s=…`) lleva el escenario completo (batería,
  arma/munición/carga, puntería, objetivo, meteo, toggles); abrirla lo
  reconstruye. La última configuración también persiste en localStorage y
  se restaura al abrir sin hash ("Restablecer" la borra). **↺ Repetir** en
  el HUD re-reproduce el último vuelo sin re-integrar (cámara a elegir,
  ×0.25 opcional, sin cráter duplicado).
- **Tutorial** — la primera visita lanza 6 coach-marks que avanzan AL HACER
  (elegir arma → apuntar → fuego → objetivo → salva → reto); "Saltar"
  siempre visible y "❓" lo relanza. En tablet: el cockpit apunta con el
  dedo (dos dedos = ajuste fino), los targets crecen a ≥40 px y bajo 900 px
  los paneles se pliegan en pestañas.

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

### E2E (Playwright, local)

`npm run e2e` construye la app y corre EN SERIE los specs con chromium
headless contra `vite preview` (arnés común en `e2e/utils.ts`); cualquier error
de consola no esperado hace fallar el spec (se ignoran los avisos de token de
Cesium y teselas caprichosas):

- `smoke.spec.ts` — arranque: globo + overlay vivos, arsenal poblado, preview
  resuelto y **Fuego** activa el HUD con el TOF avanzando.
- `cockpit.spec.ts` — la rueda sobre la rosa de azimut mueve el rumbo ±0.5º
  (±0.05º con Shift) y mover el slider de elevación repinta el cuadrante
  (sincronía bidireccional panel ⇄ cockpit).
- `salvo.spec.ts` — mortero a carga corta, **Salva dispersa ×6** hasta el toast
  "Zona batida: CEP … m" y **Limpiar cráteres** (InstancedMesh de P-PRO.8).
- `cameras.spec.ts` — todos los modos de cámara entran sin errores (1ª persona
  sin forzar pointer lock: solo su toast) y **Libre** restaura el control.
- `share.spec.ts` — P-VIVO.10: fija arma/azimut/carga, pulsa 🔗 Compartir,
  recarga con el hash `#s=…` y comprueba que el panel los reconstruye.
- `tutorial.spec.ts` — P-VIVO.11: con localStorage limpio el paso 1/6 aparece,
  elegir un arma avanza al 2/6, "Saltar" lo cierra, tras recargar no vuelve
  y "❓" lo relanza.

Corre sin token de ion (modo OSM). La primera vez: `npx playwright install
chromium`. Sin workflow de CI a propósito: este proyecto no usa GitHub Actions.

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
