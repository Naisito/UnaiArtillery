# Unai Artillery — Sandbox Balístico 3D

Simulador de artillería hiperrealista y educativo sobre la **Tierra real**. Física
balística precisa (RK4 + atmósfera ISA + arrastre G1/G7 por coeficiente balístico +
viento con cizalladura + Coriolis + spin drift + fase de empuje + guiado Pro-Nav +
Tierra esférica ECEF) presentada en el **navegador** con **CesiumJS** (globo real) y
**Three.js** (proyectiles y VFX), empaquetable como app de escritorio ligera con
**Tauri**.

> **Pivote de plataforma (2026-07):** se abandonó la capa Unreal Engine 5 por su
> tamaño (50–115 GB). La app principal vive en [`web/`](web/); el núcleo C++ original
> se conserva en [`core/`](core/) como referencia validada y la física se portó 1:1 a
> TypeScript (misma numérica, revalidada con paridad ±0.1 %). La carpeta
> `Source/UnaiArtillery` (Unreal) queda como legado y ya no se mantiene.
> Backlog y decisiones en [`docs/MEJORAS_PROMPTS.md`](docs/MEJORAS_PROMPTS.md).

---

## Arranque rápido

```bash
cd web
npm install
cp .env.example .env       # pega tu token gratuito de https://ion.cesium.com/tokens
npm run dev                # abre el globo con terreno real y la consola de tiro
```

Sin token también funciona (imaginería OpenStreetMap sobre elipsoide, sin relieve).

```bash
npm test                   # 38 tests: validación física + paridad con el C++
npm run build              # typecheck estricto + bundle de producción
npm run firing-table -- m777 3 1000 > m777.csv   # tablas de tiro (P4.3)
npm run tauri dev          # app de escritorio nativa (requiere Rust)
```

---

## Estructura del repositorio

```
UnaiArtillery/
├── web/                        ← APP PRINCIPAL (Vite + TypeScript)
│   ├── src/ballistics/         ★ núcleo de física TS (porte 1:1 del /core C++)
│   │   ├── BallisticsSolver.ts   RK4 + spin/Magnus + Pro-Nav + ECEF esférico
│   │   ├── DragTables.ts         funciones de arrastre estándar G1/G7 + BC
│   │   ├── Atmosphere.ts         ISA + viento (constante o perfil por altitud CSV)
│   │   ├── WeaponCatalog.ts      mortero 120 · M777 · GMLRS · misil táctico
│   │   ├── WeaponSystem.ts       dirección de tiro + dispersión/CEP + MRSI
│   │   ├── FiringTables.ts       generador de tablas de tiro
│   │   └── *.test.ts             suite Vitest (validación + fidelidad)
│   ├── src/
│   │   ├── frame.ts              frontera ENU↔ECEF (Cesium.Transforms)
│   │   ├── BallisticsService.ts  servicio central: terreno real, meteo, solve
│   │   ├── ArtilleryPiece.ts     ★ controlador del arma (aim/solve/fire/MRSI)
│   │   ├── ProjectilePresenter.ts reproduce la trayectoria + telemetría
│   │   ├── GunModel.ts           ★ pieza 3D animada: servos, retroceso, carga
│   │   ├── TrajectoryPreview.ts  arco previsto, ápice/impacto, anillos de alcance
│   │   ├── CameraDirector.ts     cámaras Orbital/Follow/Drone + bullet-time + shake
│   │   ├── armory.ts             sala de armas (/armory.html): banco de pruebas
│   │   ├── render/               overlay Three.js + ProjectileModel + glow
│   │   ├── vfx/                  fogonazo, humo, estela, explosión, AudioEngine
│   │   └── ui/                   consola de tiro, meteorología, HUD de telemetría
│   ├── tools/                    firing_table.ts (CLI) · calibrate_bc.ts
│   └── src-tauri/                empaquetado de escritorio (Tauri v2)
│
├── core/                       ← núcleo C++ original (referencia validada, se conserva)
├── tests/validation.cpp        arnés C++ (sigue corriendo en CI)
├── Source/UnaiArtillery/       ← capa Unreal LEGADO (sustituida por web/)
└── docs/                       TDD · ARCHITECTURE · FISICA_WEB · AUDIO_Y_ANIMACION
                                MEJORAS_PROMPTS · MEJORAS_4A_OLA
```

---

## Qué se puede hacer en la app

- **Disparar sobre el mundo real**: clic en el globo → dirección de tiro inversa
  (rama alta o baja) contra el relieve real muestreado de Cesium.
- **4 armas reales**: mortero 120 mm, obús M777 (cargas 3-8), HIMARS/GMLRS guiado,
  misil balístico táctico de ~300 km (integrado en ECEF sobre Tierra esférica).
- **Salva MRSI**: varias rondas con carga/elevación distintas que impactan a la vez.
- **Modo comparación didáctico**: vacío vs arrastre vs Coriolis vs viento, arcos
  superpuestos etiquetados.
- **Meteorología en vivo**: viento (constante o perfil con cizalladura desde CSV),
  temperatura y presión; el arco de preview se recalcula al momento.
- **Telemetría en vivo**: Mach, altitud, velocidad, energía, arrastre, TOF, alcance
  y perfil del tiro en el HUD.
- **Espectáculo**: fogonazo en tres fases con pluma direccional por el ánima,
  humo que deriva con el viento, estela de condensación transónica, explosión
  escalada por el yield real con escombros de parábola verdadera, sacudida y
  patada de FOV por distancia, y bullet-time automático al llegar el impacto en
  la cámara de seguimiento.
- **Maquinaria animada**: la pieza gira a la velocidad de sus servos reales
  (13 º/s la torreta del M109, 5 º/s la cureña del M777), el tubo retrocede en
  dos fases y vuelve a batería, la culata se abre, el atacador mete el proyectil
  y el casquillo salta con física. Los proyectiles tienen ojiva tangente
  calculada, banda de forzamiento, aletas que se despliegan y giro derivado del
  paso del estriado.
- **Una silueta por sistema**: cada arma se modela por su MONTAJE real, no por
  su categoría — un tirador a escala sostiene la pistola y el fusil, la M240 va
  sobre bípode y la M2 sobre trípode; el M270 es de cadenas con dos pods y el
  HIMARS un camión 6×6 con uno; el 2S7 lleva su cañón de 203 mm al descubierto
  sobre cadenas con la pala clavada detrás.
- **Audio con propagación física**: el estampido llega tarde
  (distancia/velocidad del sonido), el aire se come los agudos con la distancia
  (`α ≈ 1e-9·f²` dB/m: 11 kHz a 100 m, 775 Hz a 20 km), hay cola de eco de
  valle, panorámica estéreo, onda N supersónica de dos frentes, silbido Doppler
  del proyectil entrante y toda la mecánica del arma sonorizada.

---

## Ecuación integrada (núcleo)

```
m·dv/dt = m·g − ½·ρ(h)·Cd(M)·A·|v−w|·(v−w) − 2m·(Ω×v) + F_thrust·v̂ + F_spin + F_guiado
```

Con `Cd(M)` derivado de las tablas estándar **G1/G7** escaladas por el coeficiente
balístico de cada munición, `ρ(h)` por ISA, Coriolis por latitud real de la batería,
deriva giroscópica + Magnus para proyectiles estriados y navegación proporcional en
fase terminal para municiones guiadas. Integrado con **RK4** de paso fijo; en modo
largo alcance (>50 km) la integración pasa a **ECEF** con gravedad radial y términos
de rotación explícitos. Detalles y aproximaciones en
[`docs/FISICA_WEB.md`](docs/FISICA_WEB.md).

---

## Validación

- **TS (principal):** `cd web && npm test` — 38 comprobaciones: vacío vs analítico,
  orden de convergencia RK4, alcances publicados por arma, deriva por viento,
  dirección de tiro inversa, spin drift, CEP determinista, misil a ~300 km esférico,
  guiado <5 m, MRSI <0.2 s, tablas de tiro coherentes, **paridad C++ ±0.1 %**.
- **C++ (referencia):** `g++ -std=c++17 -O2 -I core tests/validation.cpp -o build/validate && ./build/validate`
  → `ALL CHECKS PASSED`.

---

## Alcance y notas

- Datos de armamento de **fuentes públicas no clasificadas**; los coeficientes
  balísticos están **calibrados contra este solver** para reproducir los alcances
  publicados (ver `web/tools/calibrate_bc.ts`).
- Proyecto **educativo / de simulación**: modela balística exterior y espectáculo
  visual con modelos simplificados documentados; no es una herramienta de tiro real.
