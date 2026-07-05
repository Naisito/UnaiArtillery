# Backlog de mejoras — prompts listos para Fable

Cada entrada es un **prompt autónomo**: puedes pegarlo tal cual en una sesión nueva de
Fable (Claude Code) dentro de este repo y lo ejecuta. Están ordenados por prioridad. Los
**criterios de aceptación** son verificables (la mayoría amplían `tests/validation.cpp`,
que ya compila con `g++ -std=c++17 -O2 -I core tests/validation.cpp`).

Convención para cada tarea:
- **Objetivo** — qué problema resuelve y por qué importa.
- **Prompt para Fable** — el texto a pegar.
- **Archivos** — dónde tocar.
- **Aceptación** — cómo saber que está bien.

> **DECISIÓN DE PLATAFORMA (vigente):** se abandona Unreal Engine 5 por su tamaño
> (50–115 GB). La capa de presentación se rehace en **web con CesiumJS** (Tierra real
> global, gratis, sin instalar nada) + **Three.js** (proyectiles y VFX), empaquetable
> como app de escritorio *premium* con **Tauri** (unos MB). El **núcleo de física
> (`/core`) se reutiliza al 100 %**: solo cambia la cáscara visual. La sección
> **P-WEB** de abajo es ahora la prioridad; las tareas P0–P4 que mencionan clases de
> Unreal se reinterpretan sobre su equivalente web (ver tabla de mapeo en P-WEB.0).

---

## P-WEB — Pivote de plataforma: Web + CesiumJS (SUSTITUYE a Unreal Engine 5)

> Esta es la ruta principal. Reemplaza toda la carpeta `Source/UnaiArtillery` (capa
> Unreal) por una app web. El `/core` C++ **no se toca**: se porta a TypeScript y se
> revalida con los mismos números, de modo que la física sigue siendo verificable.

**Mapeo de la capa Unreal → equivalente web (referencia para todas las tareas):**

| Clase Unreal actual | Equivalente web propuesto |
|---|---|
| `UBallisticsWorldSubsystem` | `BallisticsService.ts` (singleton: atmósfera, config, solve) |
| `AArtilleryPiece` | `ArtilleryPiece.ts` (estado de puntería + fire control + UI) |
| `ABallisticProjectile` | `ProjectilePresenter.ts` (reproduce la trayectoria, mueve la malla/VFX) |
| `ACinematicCameraDirector` | `CameraDirector.ts` (usa la cámara de Cesium `Camera`/`scene`) |
| `UnaiBallisticsBridge.h` (ENU↔UE, cm↔m) | `frame.ts` (ENU↔ECEF vía `Cesium.Transforms.eastNorthUpToFixedFrame`) |
| Niagara (flash/humo/estela/explosión) | Three.js: shaders + `Points`/instancing + `UnrealBloomPass` |
| Cesium for Unreal (3D Tiles) | **CesiumJS** (mismo dato real, en navegador) |

### P-WEB.0 · Andamiaje del proyecto web (Vite + TypeScript + CesiumJS + Three.js)
- **Objetivo:** crear la base del proyecto web ligero que sustituye a Unreal.
- **Prompt para Fable:**
  > Crea en `web/` un proyecto Vite + TypeScript. Añade dependencias `cesium` y `three`
  > (con `vite-plugin-cesium` para servir los assets de Cesium). Configura un `index.html`
  > con un `CesiumWidget`/`Viewer` a pantalla completa y un token de Cesium ion leído de
  > `.env` (`VITE_CESIUM_TOKEN`). Deja un botón "disparar" de prueba que loguee en consola.
  > NO toques `/core`. Documenta `npm install && npm run dev` en `web/README.md`.
- **Archivos:** `web/` (nuevo: `package.json`, `vite.config.ts`, `index.html`, `src/main.ts`).
- **Aceptación:** `npm run dev` abre el globo de Cesium con la Tierra real navegable.

### P-WEB.1 · Portar el núcleo `/core` a TypeScript y REVALIDAR (mismos números)
- **Objetivo:** llevar la física validada a JS/TS sin perder fidelidad. El core es pequeño
  y de matemática pura → porte directo. Debe dar **los mismos resultados** que el C++.
- **Prompt para Fable:**
  > Porta `core/Vec3.h`, `Atmosphere.h`, `Munition.h`, `BallisticsSolver.h` (RK4),
  > `WeaponCatalog.h` y `WeaponSystem.h` a TypeScript en `web/src/ballistics/`,
  > respetando la convención ENU (x=Este, y=Norte, z=Arriba) y la API. Traduce
  > `tests/validation.cpp` a un test TS (Vitest) y verifica los MISMOS umbrales:
  > vacío == analítico, convergencia RK4 (~16× al halvar dt en problema con arrastre),
  > alcances mortero/M777/GMLRS en banda, deriva por viento, fire-control inverso a <2 m.
  > No cambies las constantes físicas ni las curvas de arrastre ya afinadas.
- **Archivos:** `web/src/ballistics/*.ts`, `web/src/ballistics/validation.test.ts`.
- **Aceptación:** `npm run test` sale en verde con los mismos criterios que el C++
  (`ALL CHECKS PASSED` equivalente). Los alcances coinciden con los del `/core` (±0.1 %).

### P-WEB.2 · Georreferencia ENU↔ECEF y muestreo de terreno real
- **Objetivo:** anclar el marco ENU del core en un punto real de la Tierra y detectar el
  impacto contra la **topografía real** de Cesium.
- **Prompt para Fable:**
  > En `web/src/frame.ts` implementa la conversión ENU(metros)↔ECEF usando
  > `Cesium.Transforms.eastNorthUpToFixedFrame` anclada en la posición de la batería
  > (lat/lon). En `BallisticsService`, provee el callback de altura de terreno del solver
  > con `Cesium.sampleTerrainMostDetailed` (o `viewer.scene.globe.getHeight`) muestreando
  > el corredor de tiro antes de integrar (async), para que el impacto caiga sobre el
  > relieve real. Ajusta `latitudeDeg` (Coriolis) a la latitud de la batería.
- **Archivos:** `web/src/frame.ts`, `web/src/BallisticsService.ts`.
- **Aceptación:** un tiro hacia una montaña impacta en la ladera real, no en un plano.

### P-WEB.3 · Presentador de proyectil + trayectoria (Three.js sobre Cesium)
- **Objetivo:** equivalente de `ABallisticProjectile`: reproducir la trayectoria calculada
  con una malla PBR cuya nariz sigue la velocidad, e interpolación en el tiempo.
- **Prompt para Fable:**
  > Crea `ProjectilePresenter.ts` que reciba el `FlightResult` (path muestreado) y lo
  > reproduzca por interpolación en el tiempo (búsqueda binaria + lerp, igual que el
  > `EvaluatePath` de Unreal). Renderiza el proyectil con Three.js sincronizado a la cámara
  > de Cesium (patrón de escena Three superpuesta a Cesium, compartiendo matriz de vista/
  > proyección), o con una primitiva de Cesium si es más simple. Dibuja también la
  > polilínea de la trayectoria y marcadores de ápice/impacto. Soporta `timeDilation`.
- **Archivos:** `web/src/ProjectilePresenter.ts`, `web/src/render/ThreeOverlay.ts`.
- **Aceptación:** el proyectil vuela el arco real sobre el terreno, la nariz apunta al
  vector velocidad, y la trayectoria se ve dibujada.

### P-WEB.4 · Controlador del arma + dirección de fuego + UI
- **Objetivo:** equivalente de `AArtilleryPiece`: seleccionar arma/carga, apuntar por
  azimut/elevación o hacia un objetivo (fire-control inverso), previsualizar y disparar.
- **Prompt para Fable:**
  > Crea `ArtilleryPiece.ts` y un panel de UI (HTML/CSS o un framework ligero) para:
  > elegir arma (mortero/M777/GMLRS/misil) y carga, fijar azimut/elevación, o hacer
  > clic en el globo para elegir objetivo y resolver la elevación (rama alta/baja) con
  > `WeaponSystem.solveForRange`. Botones "Previsualizar" y "Fuego". Muestra alcance, TOF
  > y QE resultante.
- **Archivos:** `web/src/ArtilleryPiece.ts`, `web/src/ui/`.
- **Aceptación:** clic en un punto del mapa → calcula elevación → dispara y el proyectil
  cae en ese punto (±unos metros, según terreno).

### P-WEB.5 · VFX web — el "efecto guau" (Fase 3 en el navegador)
- **Objetivo:** recrear fogonazo, humo, estela de condensación, refracción, explosión y
  onda de choque sin Niagara, con Three.js + postproceso. El presentador ya conoce
  `Mach`, `altitude`, `speed`, `shockStrength`, `yieldScale`.
- **Prompt para Fable:**
  > Implementa en `web/src/vfx/` con Three.js: (a) **fogonazo** = flash de esfera emisiva
  > + luz puntual breve + `UnrealBloomPass` para el "cegador"; (b) **humo** con partículas
  > (`Points`/instancing) que derivan con el vector viento del servicio; (c) **estela de
  > condensación** que aparece en la banda transónica leyendo `Mach`; (d) **refracción**
  > con un shader de distorsión escalado por `shockStrength`; (e) **explosión** volumétrica
  > (billboards animados + flash de luz) escalada por `yieldScale`; (f) **onda de choque**
  > = anillo en el suelo. Añade bloom global y tone mapping ACES.
- **Archivos:** `web/src/vfx/*.ts`, `web/src/render/PostFX.ts`.
- **Aceptación:** un disparo muestra destello que ilumina (bloom), humo que deriva con el
  viento, estela en transónico y explosión luminosa en el impacto.

### P-WEB.6 · Cámaras cinemáticas (Orbital / Follow / Drone) en Cesium
- **Objetivo:** equivalente de `ACinematicCameraDirector` con la cámara de Cesium.
- **Prompt para Fable:**
  > Crea `CameraDirector.ts` con tres modos usando `viewer.camera`/`scene`: Orbital
  > (órbita suave sobre un foco), Follow (persigue el proyectil, encuadrando por delante
  > para hipersónicos) y Drone (vista cenital sobre la zona de impacto). Interpolación
  > críticamente amortiguada (`alpha = 1 − e^{−k·dt}`) para que todo deslice sin cortes.
- **Archivos:** `web/src/CameraDirector.ts`.
- **Aceptación:** los tres modos funcionan y son suaves; Follow mantiene centrado un GMLRS.

### P-WEB.7 · HUD de telemetría + meteorología en vivo
- **Objetivo:** valor educativo: Mach, altitud, velocidad, energía, arrastre, TOF, alcance;
  y controles de viento/atmósfera.
- **Prompt para Fable:**
  > Añade un HUD (overlay HTML) que lea del proyectil activo cada frame Mach/altitud/
  > velocidad/arrastre/TOF/alcance, y un panel de meteorología que ajuste
  > `Atmosphere.windField` (velocidad + rumbo) y temperatura/presión a nivel del mar,
  > recalculando en vivo. Añade el modo comparación (vacío vs arrastre vs Coriolis).
- **Archivos:** `web/src/ui/HUD.ts`, `web/src/ui/Weather.ts`.
- **Aceptación:** el HUD se actualiza durante el vuelo; cambiar el viento altera la deriva.

### P-WEB.8 · Empaquetado como app de escritorio *premium* con Tauri
- **Objetivo:** el objetivo original era una "app de escritorio premium". Tauri produce un
  ejecutable nativo de **unos MB** (frente a los 50+ GB de Unreal) envolviendo la web.
- **Prompt para Fable:**
  > Añade Tauri al proyecto `web/`: `tauri init`, configura el `distDir` al build de Vite,
  > icono y título de la app. Verifica que `npm run tauri dev` abre la app nativa con el
  > globo de Cesium y que `npm run tauri build` genera un instalador Windows pequeño.
  > Documenta el modo offline (tileset local de una región) para equipos sin internet.
- **Archivos:** `web/src-tauri/`, `web/README.md`.
- **Aceptación:** existe un `.exe`/instalador nativo ligero que arranca la simulación.

---

## P0 — Correcciones y cimientos (limitaciones ya presentes en el código)

### P0.1 · Yield de la ojiva por munición (bug de datos)
- **Objetivo:** `AArtilleryPiece::Fire()` pasa `WarheadTNTeq = 6.6f` *hardcodeado*; toda
  arma escala su explosión/shake como un M777. Debe leer el valor real de la munición.
- **Prompt para Fable:**
  > En `ArtilleryPiece.cpp`, el `WarheadTNTeq` está hardcodeado a 6.6. Expón el yield real
  > de cada munición: añade a `UBallisticsWorldSubsystem` un método
  > `float GetWarheadTNTeq(EUnaiWeaponId) const` que devuelva `round.warheadMassTNTeq` del
  > `WeaponCatalog`, y úsalo en `Fire()` al llamar a `Launch()`. Añade también el yield al
  > `FUnaiFlightResult` para no consultar dos veces.
- **Archivos:** `BallisticsWorldSubsystem.*`, `ArtilleryPiece.cpp`, `UnaiBallisticsBridge.h`.
- **Aceptación:** disparar cada arma escala la explosión de forma distinta; el GMLRS
  (40 kg TNTeq) produce un shake claramente mayor que el mortero a igual distancia.

### P0.2 · Camera shake real (bug de VFX)
- **Objetivo:** `HandleImpact()` llama a `ClientStartCameraShake(nullptr, amp)` — con
  `nullptr` no ocurre nada. Falta una clase de shake.
- **Prompt para Fable:**
  > Crea `UUnaiImpactCameraShake : UCameraShakeBase` (o `ULegacyCameraShake`) con un
  > perfil de oscilación amortiguada (perlin en location + rotación, duración ~0.6 s).
  > Expón una propiedad `TSubclassOf<UCameraShakeBase> ImpactShakeClass` en
  > `ABallisticProjectile` y úsala en `HandleImpact()` en vez de `nullptr`. El parámetro
  > `amp` debe escalar la intensidad (`Scale`).
- **Archivos:** nuevo `UnaiImpactCameraShake.*`, `BallisticProjectile.*`.
- **Aceptación:** el impacto sacude la cámara; la sacudida crece al acercarse y con el
  yield, y se satura (ya está clampeada a 12).

### P0.3 · Build del núcleo con CMake + CTest (CI reproducible)
- **Objetivo:** hoy la validación se compila a mano. Falta un build portable para CI.
- **Prompt para Fable:**
  > Añade un `CMakeLists.txt` en la raíz que compile `tests/validation.cpp` como
  > ejecutable `unai_validate` (C++17, `-O2`), lo registre con `add_test`/CTest, y
  > exponga el directorio `core` como include. Añade un workflow de GitHub Actions
  > (`.github/workflows/ci.yml`) que haga `cmake -B build && cmake --build build &&
  > ctest --test-dir build --output-on-failure` en ubuntu-latest y windows-latest.
- **Archivos:** `CMakeLists.txt`, `.github/workflows/ci.yml`.
- **Aceptación:** `ctest` sale en verde local y en CI en Linux y Windows.

### P0.4 · Solve asíncrono para salvas (rendimiento)
- **Objetivo:** `SolveTrajectory` es síncrono; una salva de N cañones haría *hitch* del
  hilo de juego. El núcleo es puro → paralelizable.
- **Prompt para Fable:**
  > Añade `SolveTrajectoryAsync` al subsistema usando `UE::Tasks` (o `AsyncTask`) que
  > ejecute la integración en un worker y devuelva el `FUnaiFlightResult` por un delegate
  > `FOnTrajectorySolved`. Cuidado: el raycast de terreno (`QueryTerrainHeightMeters`)
  > usa `LineTrace` que debe correr en el hilo de juego — precalcula un muestreo de alturas
  > del corredor de tiro antes de lanzar el worker, o marca el trace como thread-safe.
- **Archivos:** `BallisticsWorldSubsystem.*`.
- **Aceptación:** disparar 32 piezas en el mismo frame no baja de 60 fps; la trayectoria
  coincide con la versión síncrona.

---

## P1 — Fidelidad física (mayor realismo del núcleo)

### P1.1 · Integrador adaptativo (RK45 Dormand-Prince)
- **Objetivo:** el paso fijo de 2 ms malgasta cálculo en la fase balística lenta y puede
  ser justo durante el empuje del cohete. Un integrador embebido con control de error da
  precisión garantizada y menos pasos.
- **Prompt para Fable:**
  > Implementa un integrador Runge-Kutta-Fehlberg / Dormand-Prince (RK45) en
  > `BallisticsSolver.h` como alternativa seleccionable (`SolverConfig::adaptive=true`),
  > con tolerancia relativa/absoluta configurable y paso mínimo/máximo. Mantén el RK4 de
  > paso fijo como opción. Añade un test que verifique que RK45 alcanza la misma solución
  > analítica en vacío y usa menos evaluaciones que el RK4 fijo para igual error.
- **Archivos:** `core/BallisticsSolver.h`, `tests/validation.cpp`.
- **Aceptación:** nuevo test PASS; contador de evaluaciones del RHS menor en RK45 a igual
  error de alcance.

### P1.2 · Deriva por rotación (spin drift) y efecto Magnus
- **Objetivo:** los proyectiles estabilizados por rotación tienen **deriva lateral**
  significativa (a 20 km, decenas de metros) que hoy no se modela. Solo hay Coriolis.
- **Prompt para Fable:**
  > Añade al `Munition` un flag `spinStabilized` con paso de estriado (twist) y sentido, y
  > modela (a) la **deriva giroscópica** aproximada y (b) la fuerza de **Magnus** como
  > término lateral proporcional a la velocidad angular × velocidad relativa del aire.
  > Documenta las aproximaciones. Añade un test que muestre deriva a la derecha para
  > estriado dextrógiro a 20 km, del orden de decenas de metros.
- **Archivos:** `core/Munition.h`, `core/BallisticsSolver.h`, `tests/validation.cpp`.
- **Aceptación:** test PASS con deriva de signo correcto y magnitud plausible.

### P1.3 · Modelo de arrastre estándar G1/G7 + coeficiente balístico
- **Objetivo:** las curvas `Cd(Mach)` están afinadas a mano. Lo profesional es una **tabla
  de arrastre estándar (G1 o G7)** escalada por el **coeficiente balístico (BC)** de cada
  proyectil, que es como se publican los datos reales.
- **Prompt para Fable:**
  > Añade tablas de arrastre estándar G1 y G7 (arrays Mach→Cd de dominio público) en
  > `core/DragTables.h`. Permite definir una munición por `{modelo: G7, BC: x}` de forma
  > que `dragCoefficient(mach)` derive el Cd real a partir de la tabla y el BC. Mantén la
  > curva explícita como alternativa. Reafina M777/mortero/GMLRS con BCs realistas y
  > actualiza los tests de alcance.
- **Archivos:** nuevo `core/DragTables.h`, `core/Munition.h`, `core/WeaponCatalog.h`.
- **Aceptación:** los alcances validados siguen en banda con munición definida por BC.

### P1.4 · Tierra esférica (ECEF) para largo alcance
- **Objetivo:** el mundo usa un plano tangente ENU; **falla más allá de ~100 km** (el
  misil táctico de ~300 km del catálogo no está validado por esto). Para largo alcance hay
  que integrar sobre una Tierra esférica/WGS84.
- **Prompt para Fable:**
  > Añade un modo `SolverConfig::sphericalEarth` que integre en coordenadas ECEF con
  > gravedad radial (fórmula WGS84, variación con latitud y altitud) y convierta a ENU
  > para la salida. Documenta cuándo activarlo (>50 km). Añade un test del misil táctico
  > que valide un alcance de clase ~300 km y compare plano vs esférico mostrando la
  > divergencia creciente con la distancia.
- **Archivos:** `core/BallisticsSolver.h`, nuevo `core/Geodesy.h`, `tests/validation.cpp`.
- **Aceptación:** misil táctico alcanza ~300 km en modo esférico; el test documenta la
  diferencia plano/esférico a 50/150/300 km.

### P1.5 · Guiado terminal (navegación proporcional) para GMLRS/misil
- **Objetivo:** GMLRS y misiles son **guiados**; hoy vuelan balísticos puros. Añadir un
  guiado sencillo los hace impactar en el punto objetivo con precisión.
- **Prompt para Fable:**
  > Modela guiado por **navegación proporcional (Pro-Nav)** para municiones marcadas como
  > `guided`: durante la fase controlada, aplica una aceleración lateral limitada
  > (límite de "g") que anula la tasa de rotación de la línea de visión al objetivo.
  > Añade parámetro de objetivo a `integrate()`/`fire()` para guiadas. Test: el GMLRS cae
  > a <5 m de un objetivo desplazado lateralmente que un tiro balístico erraría por >100 m.
- **Archivos:** `core/Munition.h`, `core/BallisticsSolver.h`, `core/WeaponSystem.h`, tests.
- **Aceptación:** CEP guiado << CEP balístico en el test.

### P1.6 · Dispersión Monte-Carlo y elipse de impacto (CEP)
- **Objetivo:** valor educativo alto — mostrar que el tiro real tiene **dispersión**
  (error probable en V₀, viento, densidad) y sale una elipse de impacto.
- **Prompt para Fable:**
  > Añade `WeaponSystem::fireDispersed(n, errores)` que perturbe V₀ (error probable),
  > dirección de boca y viento con muestreo pseudoaleatorio *determinista* (semilla
  > pasada por parámetro; **no** uses `rand()` global) y devuelva N impactos + CEP
  > (radio que contiene el 50%). Test: para M777 a 15 km, el CEP crece con el error de V₀.
- **Archivos:** `core/WeaponSystem.h`, `tests/validation.cpp`.
- **Aceptación:** CEP monotónicamente creciente con la magnitud del error; reproducible
  con la misma semilla.

### P1.7 · Perfil de viento por altitud desde datos reales
- **Objetivo:** el viento estable con ganancia lineal es básico. Cargar un **perfil por
  altitud** (o datos GFS/METAR) da realismo educativo.
- **Prompt para Fable:**
  > Extiende `Atmosphere::windField` para aceptar un perfil `{altitud → (velocidad,
  > rumbo)}` interpolado, cargable desde un CSV/JSON simple. Añade un ejemplo con cizalladura
  > (viento que rota y arrecia con la altura) y un test que muestre que la deriva difiere
  > respecto al viento constante equivalente.
- **Archivos:** `core/Atmosphere.h`, ejemplo de datos, tests.
- **Aceptación:** test PASS mostrando efecto de la cizalladura.

---

## P2 — Gameplay y sistema de fuego

### P2.1 · Catálogo de armas data-driven (DataTable/JSON)
- **Objetivo:** hoy las armas están en C++ (`WeaponCatalog.h`). Sacarlas a datos permite
  que diseñadores las editen sin recompilar.
- **Prompt para Fable:**
  > Define un `FUnaiWeaponRow : FTableRowBase` y carga el catálogo desde una `UDataTable`
  > (importada de CSV/JSON). El subsistema debe resolver un arma por `FName` desde la
  > tabla, con fallback al catálogo C++ embebido. Genera el CSV inicial a partir de los
  > valores actuales del `WeaponCatalog`.
- **Archivos:** `BallisticsWorldSubsystem.*`, nuevo `UnaiWeaponData.h`, CSV de datos.
- **Aceptación:** cambiar una fila del CSV altera el alcance sin recompilar C++.

### P2.2 · MRSI / Time-On-Target (varios impactos simultáneos)
- **Objetivo:** función espectacular y educativa: un solo cañón dispara **varias veces a
  distintas elevaciones** para que **todas las bombas impacten a la vez** (MRSI), o
  coordinar varias piezas para un **TOT**.
- **Prompt para Fable:**
  > Añade `WeaponSystem::solveMRSI(objetivo, nRondas)` que devuelva N pares
  > (elevación, retardo de disparo) de forma que todas impacten en el mismo instante,
  > usando las ramas de ángulo alto y bajo con distintos tiempos de vuelo. Añade en
  > `AArtilleryPiece` una acción `FireMRSI`. Test: los N impactos caen dentro de <0.2 s.
- **Archivos:** `core/WeaponSystem.h`, `ArtilleryPiece.*`, tests.
- **Aceptación:** dispersión temporal de impactos < 0.2 s en el test.

### P2.3 · Preview del arco de tiro (spline) + marcadores y anillos de rango
- **Objetivo:** el HUD debe **dibujar la trayectoria** prevista, el ápice, el impacto y
  anillos de alcance por carga. Hoy `PreviewTrajectory()` existe pero no se dibuja.
- **Prompt para Fable:**
  > Crea un componente `UTrajectoryPreviewComponent` que consuma el `FUnaiFlightResult` de
  > `PreviewTrajectory()` y renderice la trayectoria con `USplineComponent` +
  > `USplineMeshComponent` (o `DrawDebugLine` para prototipo), con marcadores de ápice e
  > impacto y anillos de alcance mín/máx por carga. Se actualiza al mover la puntería.
- **Archivos:** nuevo `TrajectoryPreviewComponent.*`, `ArtilleryPiece.*`.
- **Aceptación:** al apuntar, el arco y los marcadores siguen en vivo a azimut/elevación.

### P2.4 · Cráteres y deformación del terreno en el impacto
- **Objetivo:** "destrucción paramétrica" del brief. Deformar el terreno y sembrar
  escombros/decal al impactar.
- **Prompt para Fable:**
  > En `HandleImpact()`, además de la explosión Niagara: proyecta un **decal de cráter**
  > escalado por yield, dispara un Niagara de escombros con colisión, y (si el terreno es
  > un `Landscape` editable en runtime) aplica una depresión con `LandscapeEditLayers` o
  > un Render Target de desplazamiento. Para teselas Cesium (no editables), limítate a
  > decal + malla de cráter instanciada.
- **Archivos:** `BallisticProjectile.*`, assets de decal/mesh.
- **Aceptación:** cada impacto deja cráter visible cuyo tamaño escala con el yield.

---

## P3 — Espectáculo visual (Fase 3, autoría de VFX real)

### P3.1 · Suite de sistemas Niagara del "efecto guau"
- **Objetivo:** el código ya **envía** los parámetros (`Mach`, `Altitude`, `Speed`,
  `ShockStrength`, `YieldScale`, `AirDensity`) pero **los sistemas Niagara no existen**.
  Hay que autorarlos.
- **Prompt para Fable:**
  > Genera scripts/instrucciones reproducibles (y, donde sea posible, assets vía Python
  > del editor) para crear los sistemas Niagara que el código ya alimenta:
  > `MuzzleFlashFX` (con luz transitoria brillante para Lumen), `MuzzleSmokeFX`
  > (volumétrico, lee `AirDensity` y viento), `TrailFX` (condensación que aparece en la
  > banda transónica leyendo `Mach`/`Altitude`), `ShockRefractionFX` (material de
  > distorsión escalado por `ShockStrength`), `ImpactExplosionFX` (volumétrica con luz,
  > escalada por `YieldScale`) y `GroundShockwaveFX` (anillo de polvo). Lista cada
  > parámetro de usuario esperado por nombre para que casen con el C++.
- **Archivos:** `docs/VFX_NIAGARA.md` + assets/scripts.
- **Aceptación:** un disparo muestra fogonazo que ilumina, humo que deriva con el viento,
  estela de condensación y explosión que ilumina el entorno.

### P3.2 · Boom sónico con retardo por distancia (audio)
- **Objetivo:** inmersión enorme y educativa: **ves el impacto y oyes el estampido
  después**, según la velocidad del sonido y la distancia.
- **Prompt para Fable:**
  > En `HandleImpact()` (y en el fogonazo de boca), reproduce el sonido con un **retardo
  > = distancia_cámara / a(h)** usando la velocidad del sonido del subsistema
  > (`Atmosphere::sample`). Aplícalo también al *crack* del proyectil supersónico al pasar
  > cerca de la cámara. Atenúa por distancia.
- **Archivos:** `BallisticProjectile.*`, `ArtilleryPiece.*`, `BallisticsWorldSubsystem`.
- **Aceptación:** a 3 km el estampido llega ~9 s después del destello.

### P3.3 · Cámara "bullet-time" y Movie Render Queue
- **Objetivo:** el "money shot". Automatizar cámara lenta en el momento del impacto.
- **Prompt para Fable:**
  > Añade a `ACinematicCameraDirector` un modo que, al acercarse el impacto (usa
  > `GetFlightAlpha()` del proyectil), baje `TimeDilation` global de forma suave (rampa) y
  > la restaure tras el impacto. Documenta cómo grabarlo con Movie Render Queue + Sequencer.
- **Archivos:** `CinematicCameraDirector.*`, `docs/WORLD_SETUP.md`.
- **Aceptación:** el impacto se reproduce en cámara lenta y vuelve a tiempo real.

---

## P4 — Educación, herramientas y calidad

### P4.1 · HUD de telemetría en vivo
- **Objetivo:** valor educativo: mostrar Mach, altitud, velocidad, energía cinética,
  arrastre instantáneo, tiempo de vuelo y alcance durante el disparo.
- **Prompt para Fable:**
  > El `FUnaiTrajectoryPoint` ya lleva tiempo, posición, velocidad y Mach; añade también
  > arrastre instantáneo (ya está en el core `TrajectorySample::drag`). Expón un
  > `UUnaiTelemetryComponent` que el HUD (UMG) lea cada frame desde el proyectil activo y
  > pinte una tabla y gráficas simples.
- **Archivos:** `UnaiBallisticsBridge.h`, `BallisticsWorldSubsystem.cpp` (propaga `drag`),
  nuevo componente + widget.
- **Aceptación:** durante el vuelo se ven Mach/altitud/velocidad/arrastre actualizándose.

### P4.2 · Modo comparación (didáctico): vacío vs. arrastre vs. Coriolis
- **Objetivo:** enseñar el efecto de cada término disparando trayectorias superpuestas.
- **Prompt para Fable:**
  > Añade una acción que dispare simultáneamente 3-4 trayectorias del mismo tiro con
  > distintas físicas: (1) vacío, (2) solo arrastre, (3) arrastre+Coriolis, (4) todo +
  > viento; cada una con color distinto y su alcance etiquetado. Reutiliza `SolverConfig`
  > (flags ya existentes) y el preview de arco (P2.3).
- **Archivos:** `ArtilleryPiece.*`, `TrajectoryPreviewComponent.*`.
- **Aceptación:** se ven 3-4 arcos separados con sus alcances; el de vacío es el más largo.

### P4.3 · Generador de tablas de tiro (firing tables)
- **Objetivo:** salida educativa clásica: para un arma y carga, generar la tabla
  alcance→elevación→tiempo de vuelo→velocidad de impacto.
- **Prompt para Fable:**
  > Añade una utilidad (en `core`, sin engine) que barra rangos y produzca un CSV de tabla
  > de tiro por arma y carga (QE alto y bajo, TOF, V_impacto, deriva). Añade un pequeño
  > `main` en `tools/firing_table.cpp` compilable con g++. Valida contra los alcances ya
  > testados.
- **Archivos:** nuevo `tools/firing_table.cpp`, `core/WeaponSystem.h`.
- **Aceptación:** genera un CSV coherente con los tests de alcance existentes.

### P4.4 · Ampliar el banco de pruebas y benchmark
- **Objetivo:** blindar la física con más casos y medir rendimiento del solver.
- **Prompt para Fable:**
  > Añade a `tests/validation.cpp` (o divide en varios): conservación de energía en vacío,
  > simetría de alcance para elevaciones complementarias (θ y 90−θ) en vacío, monotonía de
  > la rama baja alcance-vs-elevación, y un micro-benchmark que reporte pasos/seg del RK4.
  > Mantén `ALL CHECKS PASSED`.
- **Archivos:** `tests/`.
- **Aceptación:** todos los tests nuevos PASS; el benchmark imprime pasos/seg.

---

## Cómo priorizaría (ruta recomendada — con el pivote web)

1. **P-WEB.0 → P-WEB.1** — andamiaje web y **portar/revalidar el core en TypeScript**.
   Hasta que la física dé los mismos números en JS, no construyas nada encima.
2. **P-WEB.2 → P-WEB.4** — Tierra real + impacto sobre terreno + presentar el proyectil +
   controlador del arma con fire-control. Con esto ya "juega": clic en el mapa y dispara.
3. **P-WEB.5 (VFX web)** — el "efecto guau" en el navegador; alto impacto visible.
4. **P-WEB.6 → P-WEB.7** — cámaras cinemáticas + HUD/meteorología (cierra lo educativo).
5. **P-WEB.8 (Tauri)** — empaquetar como app de escritorio *premium* ligera.
6. **Fidelidad física (reutilizable, cero cambios por ser web):** **P1.3 (G1/G7 + BC)**,
   **P1.2 (spin drift)**, **P1.6 (dispersión/CEP)**, **P1.4 (Tierra esférica)** y
   **P1.5 (guiado)** — se implementan en el core TS y se revalidan con Vitest.
7. **Gameplay/educación:** **P2.2 (MRSI)**, **P2.3 (preview de arco)**, **P4.2/P4.3**
   (comparación y tablas de tiro).

> Nota: P0.1/P0.2 (yield hardcodeado, camera shake) eran bugs de la capa **Unreal**, que
> se retira. Al reescribir la presentación en web, impleméntalos bien de nacimiento
> (yield real por munición desde el `WeaponCatalog`; sacudida de cámara por distancia y
> carga en `CameraDirector`). P0.3 (CMake/CI) se sustituye por **Vitest + un workflow de
> CI que corra `npm run test`** sobre el core portado.

> Sugerencia de uso: pega un solo prompt por sesión y deja que Fable amplíe la suite de
> **Vitest** (`web/src/ballistics/validation.test.ts`) como criterio de aceptación antes
> de tocar la capa visual. Así cada mejora queda verificada fuera del render, igual que
> hoy el núcleo C++ se valida fuera del engine.
