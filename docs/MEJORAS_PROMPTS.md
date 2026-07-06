# Backlog de mejoras — prompts listos para Fable (3ª ola)

Las dos primeras olas están completadas: la 1ª (2026-07-05) hizo el pivote web
(CesiumJS + Three.js, núcleo C++ portado a TS validado) y la fidelidad P1; la 2ª
(2026-07-06, P-NEXT.1–7) añadió atmósfera ISA-76 hasta 86 km, solves en Web
Worker, arsenal de 10 armas calibradas, cockpit de puntería + cámara de cabina,
Google Photorealistic 3D Tiles opcional, cráteres persistentes con salva
dispersa, y el smoke E2E de Playwright — 55 tests de Vitest en verde + `npm run
e2e`. Extra post-ola: cámara 1ª persona (WASD + pointer lock) y Seguir orbitable.

Este es el backlog vigente. Cada entrada es un **prompt autónomo**: pégalo tal
cual en una sesión nueva de Fable dentro de este repo y lo ejecuta, ampliando la
suite de Vitest (y ahora también la de Playwright) como criterio de aceptación.

Convención: **Objetivo** · **Prompt para Fable** · **Archivos** · **Aceptación**.

> Orden recomendado: **P-PRO.3 → P-PRO.4 → P-PRO.1 → P-PRO.5 → P-PRO.6 →
> P-PRO.2 → P-PRO.7 → P-PRO.8 → P-PRO.9** (el terreno 2D corrige la física de
> todo lo que se aparta del rumbo, antes de apilar nada encima; base-bleed/RAP
> tocan solver y catálogo, mejor pronto; el cañón 3D es independiente y el mayor
> salto visual; la tabla de tiro y la elipse PER son la capa didáctica de
> dirección de tiro; la meteo real es independiente; el reto usa todo lo
> anterior; el rendimiento se optimiza cuando ya existe la carga que lo estresa;
> el E2E se amplía al final y blinda todo). Para hacerlas todas de una vez:
> *"Haz P-PRO.1 a P-PRO.9 de docs/MEJORAS_PROMPTS.md en el orden recomendado"*.

---

## P-PRO.1 · Cañón 3D procedural que apunta (la pieza por fin se VE)

- **Objetivo:** hoy la batería es un punto invisible: el fogonazo nace del
  suelo y la cámara Cabina flota en el aire. Un modelo procedural del arma
  (tubo + cuna + chasis según categoría), que gira y eleva EN VIVO con la
  puntería, da presencia física, ancla la cabina a algo real y hace legible la
  puntería desde cualquier cámara. Cero assets binarios: todo geometría Three.
- **Prompt para Fable:**
  > En `web/`, crea `src/GunModel.ts` (Three.js): geometría procedural por
  > `Weapon.category` — **Mortar**: placa base circular + bípode + tubo corto
  > muy empinado; **Howitzer**: chasis bajo con mazas/ruedas + cuna + tubo
  > largo (longitud = 39·calibre para L39) con freno de boca (cilindro con
  > ranuras); **Rocket**: camión esquemático + caja lanzadora rectangular con
  > 6 bocas visibles; **Missile**: TEL con canister único grande que se eleva.
  > Materiales `MeshStandardMaterial` verde oliva/gris (metalness moderado).
  > El grupo vive en `overlay.enuRoot` en el origen ENU (la batería). El TUBO
  > es un subgrupo pivotado en la cuna: cada frame se orienta con el
  > `aimProvider` que ya usa `CameraDirector` — el chasis/torreta gira en
  > azimut (si `traverseDeg < 360`, gira el chasis entero: los morteros no
  > tienen torreta) y el tubo se eleva en su pivote. Expón
  > `muzzleWorldEnu(): Vec3` (punta del tubo) y úsalo en
  > `ProjectilePresenter.handleLaunch` y `VfxManager.launchSignature` para que
  > el fogonazo y el humo salgan EXACTAMENTE de la boca, y en la cámara
  > Cabina para montarla justo detrás de la boca real. Al cambiar de arma,
  > reconstruye el modelo (dispose limpio de geometrías/materiales); al mover
  > la batería no hay que hacer nada (enuRoot ya se re-ancla). Extra de sabor:
  > al disparar, retroceso del tubo 0.3–0.5 m con retorno amortiguado ~0.4 s
  > (solo visual, la física no se toca).
- **Archivos:** nuevo `web/src/GunModel.ts`, `main.ts`,
  `ProjectilePresenter.ts`, `vfx/effects.ts`, `CameraDirector.ts`.
- **Aceptación:** el arma se ve desde todas las cámaras y sigue en vivo a
  sliders/cockpit; cada categoría tiene silueta distinta; el fogonazo nace en
  la punta del tubo (no en el suelo); la Cabina queda pegada al tubo y el
  retroceso se ve al disparar; cambiar de arma no filtra memoria (dispose).

---

## P-PRO.2 · Meteorología real de hoy (Open-Meteo, gratis y sin clave)

- **Objetivo:** el panel meteo es manual. Open-Meteo da GRATIS y sin API key
  viento/temperatura por **niveles de presión** (1000→100 hPa ≈ 0–16 km) en
  cualquier lat/lon: un clic y disparas con la atmósfera real de tu batería,
  ahora mismo. Es la demo educativa definitiva del perfil por altitud (P1.7).
- **Prompt para Fable:**
  > Crea `web/src/ui/openMeteo.ts` con: (1) `parseOpenMeteo(json)` PURA que
  > convierte la respuesta de `api.open-meteo.com/v1/forecast` (campos hourly
  > `temperature_2m`, `surface_pressure` y `wind_speed_{P}hPa` /
  > `wind_direction_{P}hPa` para P ∈ {1000, 925, 850, 700, 500, 300, 200} —
  > pide `wind_speed_unit=ms` y usa solo los niveles presentes) en
  > `{ profile: WindProfilePoint[], seaLevelTempK, seaLevelPressurePa }`;
  > (2) el fetch con la lat/lon de la batería y caché de 15 min. Para pasar
  > de nivel de presión a altitud geométrica añade
  > `Atmosphere.altitudeForPressure(pPa): number` (bisección sobre
  > `sample().pressure` del modelo ISA-76, 0–86 km) con test. Corrige a nivel
  > del mar desde la altura h de la batería: `T_msl = T_2m + 0.0065·h` y
  > `P_msl = P_surf·exp(g·h/(R·T_media))`. En `Weather.ts`, botón "🌍 Meteo
  > real (aquí y ahora)": instala el perfil con `service.setWindProfile` +
  > `setSeaLevelConditions`, muestra resumen en el panel (niveles cargados,
  > p.ej. "850 hPa: 12 m/s desde 240º") y se re-consulta al mover la batería
  > SOLO si el modo real sigue activo. Sin red o JSON inválido: toast y se
  > conserva el modo manual. Test de Vitest para `parseOpenMeteo` con un
  > fixture JSON guardado y para `altitudeForPressure` (error <10 m en
  > 0–25 km invirtiendo el propio modelo).
- **Archivos:** nuevo `web/src/ui/openMeteo.ts` (+ test con fixture),
  `web/src/ui/Weather.ts`, `web/src/ballistics/Atmosphere.ts` (+ test),
  `web/README.md`.
- **Aceptación:** con red, el botón carga un perfil real de ≥5 niveles y el
  preview se recalcula; los dos tests nuevos PASS; sin red degrada con toast y
  el modo manual sigue funcionando.

---

## P-PRO.3 · Terreno 2D: banda del corredor (lo que curva cae donde debe)

- **Objetivo:** el terreno viaja al worker como perfil 1D proyectado sobre el
  rumbo (P-NEXT.5). Todo lo que se APARTA del rayo — guiados hacia objetivos
  desplazados, salvas dispersas, deriva con viento fuerte — se resuelve contra
  alturas de otro sitio: en ladera lateral el error de impacto puede ser de
  decenas de metros. Muestrear una BANDA 2D lo corrige sin disparar el coste.
- **Prompt para Fable:**
  > Amplía `TerrainSpec` en `web/src/ballistics/WorkerProtocol.ts` a malla 2D
  > curvilínea: `{dirE, dirN, stepAlongM, stepCrossM, halfWidthM, rows,
  > profile}` con eje `s` a lo largo del rumbo y eje `t` perpendicular
  > (t ∈ [−halfWidth, +halfWidth], `rows` filas transversales), y
  > `buildTerrain` con interpolación **bilineal** (clamp en los bordes).
  > `rows = 1` debe degenerar EXACTAMENTE al comportamiento 1D actual (el test
  > de serialización existente sigue verde sin tocarlo). En
  > `BallisticsService.sampleCorridor`, muestrea toda la malla en UNA llamada
  > batched a `sampleTerrainMostDetailed` (p.ej. paso 400 m a lo largo × 5
  > filas con paso 500 m ⇒ banda de ±1 km, ~5× puntos que hoy); parametriza
  > `halfWidthM` y usa un ancho mayor (≈2 km) en `fireDispersed` y en solves
  > con objetivo desplazado lateralmente. Añade a `serialization.test.ts`:
  > (a) plano inclinado lateral sintético z = 0.1·t → `buildTerrain` devuelve
  > z = 50 en t = 500 (bilineal exacta); (b) un `solveTrajectory` guiado hacia
  > un objetivo desplazado 800 m del eje impacta a la altura de SU ladera (no
  > a la del eje); (c) `rows=1` reproduce bit a bit el resultado actual.
- **Archivos:** `WorkerProtocol.ts`, `BallisticsService.ts`,
  `serialization.test.ts`.
- **Aceptación:** tests (a)(b)(c) PASS y los 55 existentes siguen en verde; el
  muestreo de terreno sigue siendo una única llamada batched (~5-6× puntos).

---

## P-PRO.4 · Base bleed y cohete auxiliar (RAP): el porqué del alcance extra

- **Objetivo:** las municiones reales estiran alcance con *base bleed* (M982,
  ERFB-BB) y cohete auxiliar RAP (M549A1). Hoy solo hay BC fijo o motor
  completo. Modelar el BB como reducción temporal del arrastre de culote y el
  RAP como motor con ignición retardada añade variantes reales al catálogo y
  enseña POR QUÉ ganan un 25–50% de alcance.
- **Prompt para Fable:**
  > En `web/src/ballistics/Munition.ts` añade
  > `baseBleed = { enabled: false, durationS: 25, dragFactor: 0.75 }` —
  > mientras `t < durationS`, el solver usa `Cd_efectivo = dragFactor·Cd` (el
  > BB rellena la depresión del culote: un único factor 0.75 es un fit
  > razonable) — y consúmelo en `BallisticsSolver.derivative`. Añade también
  > `motor.ignitionDelayS = 0`: el empuje va de `ignitionDelay` a
  > `ignitionDelay + burnTime` (¡y el guiado que arranca "tras burnout" debe
  > usar el fin REAL del quemado!). PARIDAD: ambos defaults en off/0 dejan la
  > integración bit a bit idéntica — `validation.test.ts` no debe moverse ni
  > 1e-12. Con esto, añade al catálogo dos variantes 155 mm seleccionables en
  > M777 y M109 (nuevo `Weapon.rounds: Munition[]` opcional + segundo select
  > "Munición" en el panel que solo aparece si hay >1):
  > **M795E-BB** (46.7 kg, BB 25 s, BC calibrado a ~28.5 km desde L39) y
  > **M549A1 RAP** (43.5 kg, motor ~12 kN·s con ignición a los 7 s, BC
  > calibrado a ~30 km). Recalibra con `calibrate_bc.ts --only` y añade a
  > `fidelity.test.ts`: (a) el MISMO proyectil con BB on/off gana 20–35% de
  > alcance; (b) `ignitionDelay = 0` reproduce exactamente el resultado del
  > motor actual y un delay >0 cambia alcance/ápice de forma medible; (c)
  > bandas ±20% de las dos variantes nuevas. Documenta el modelo y sus límites
  > en `docs/FISICA_WEB.md`.
- **Archivos:** `Munition.ts`, `BallisticsSolver.ts`, `WeaponCatalog.ts`,
  `ControlPanel.ts`, `calibrate_bc.ts`, `fidelity.test.ts`,
  `docs/FISICA_WEB.md`.
- **Aceptación:** paridad C++ intacta; tests (a)(b)(c) PASS; en la app,
  cambiar la munición del M777 cambia el alcance del preview al vuelo.

---

## P-PRO.5 · Tabla de tiro interactiva (la clase de dirección de tiro)

- **Objetivo:** `FiringTables.ts` genera tablas por CLI que nadie ve en la
  app. Un panel plegable con la tabla del arma/carga/meteo actuales — alcance
  → QE baja/alta, TOF, deriva — convierte el simulador en una lección de
  dirección de tiro. Clic en una fila = apuntar ahí.
- **Prompt para Fable:**
  > Añade la op `generateFiringTable` al protocolo del worker
  > (`WorkerProtocol.ts` → llama al `generateFiringTable(weapon, charge,
  > {stepM})` que ya existe en el core; `FiringTable` ya es un objeto plano
  > serializable) y un método async con caché en `BallisticsService`
  > (invalida la caché al cambiar viento/temperatura/presión/batería). Crea
  > `src/ui/FiringTablePanel.ts`: botón "📋 Tabla de tiro" que despliega una
  > tabla scrollable (estética consola de `style.css`) con columnas
  > alcance / QE↓ / QE↑ / TOF / deriva; paso `max(500 m, maxRange/25)`. Filas
  > clicables → `panel.setAim(azimut actual, QE de la fila)` +
  > `schedulePreview()`; resalta la fila más próxima al alcance del preview
  > vigente. Mientras el worker calcula, "calculando…" y el globo NO se
  > congela. Botón "CSV" que descarga `firingTableCSV(...)` como blob. Añade
  > a `serialization.test.ts` la ida y vuelta de la op (== core directo).
- **Archivos:** `WorkerProtocol.ts`, `BallisticsService.ts`, nuevo
  `src/ui/FiringTablePanel.ts`, `main.ts`, `style.css`,
  `serialization.test.ts`.
- **Aceptación:** la tabla del M777 C8 llega hasta ~21 km; clicar la fila de
  15 km fija QE ≈ 19.1º y el preview cae a 15 km ± 0.1 km; cambiar carga o
  viento regenera; test de la op PASS; la cámara sigue fluida durante el
  cálculo.

---

## P-PRO.6 · Elipse de error PREDICHA antes de disparar (validada vs Monte-Carlo)

- **Objetivo:** la salva dispersa muestra el patrón *a posteriori*; la
  artillería real publica errores probables *a priori*. Predecir la elipse 1σ
  linealizando sensibilidades, pintarla sobre el objetivo y DEMOSTRAR con test
  que coincide con el Monte-Carlo es la lección más honesta del simulador.
- **Prompt para Fable:**
  > Añade a `WeaponSystem` un `predictDispersion(w, muzzle, order, errors):
  > {sigmaRangeM, sigmaCrossM}` por diferencias finitas: re-integra con ±δV0 y
  > ±δQE para medir ∂R/∂V0 y ∂R/∂QE, y OTRAS dos integraciones con viento
  > unitario longitudinal/transversal para medir las sensibilidades de viento
  > (nada de constantes mágicas). Compón σ_alcance = √((∂R/∂V0·σ_V0)² +
  > (∂R/∂QE·σ_QE)² + (S_wₗ·σ_w)²) y σ_deriva = √((R·σ_az_rad)² +
  > (S_wₜ·σ_w)²). Total ≤ 7 integraciones con dt = 0.01: cabe en el worker
  > como op `predictDispersion` (misma serialización que fireDispersed).
  > Test en `fidelity.test.ts`: para el M777 a 15 km con σ dadas, comparar
  > contra las desviaciones muestrales de `fireDispersed` con n = 200 y
  > semilla fija — la predicción debe quedar dentro de ±30% en ambos ejes
  > (n grande para que el muestreo no domine). En la app: al marcar objetivo,
  > `TrajectoryPreview` pinta una elipse 1σ (y 2σ más tenue) centrada en el
  > impacto previsto y orientada al rumbo (semiejes σ_alcance/σ_deriva),
  > actualizada con arma/carga/meteo, con leyenda "PER ±X m / ±Y m". Usa los
  > mismos σ de la salva dispersa (0.3% V0, 1 mil, viento) para que la elipse
  > predicha y los cráteres reales se superpongan.
- **Archivos:** `WeaponSystem.ts`, `WorkerProtocol.ts`,
  `BallisticsService.ts`, `TrajectoryPreview.ts`, `ArtilleryPiece.ts`,
  `fidelity.test.ts`, `docs/FISICA_WEB.md`.
- **Aceptación:** test predicho-vs-Monte-Carlo PASS (±30%); la elipse aparece
  al marcar objetivo y cambia con carga/viento; tras una salva dispersa los
  cráteres caen mayoritariamente dentro de la elipse 2σ pintada.

---

## P-PRO.7 · Modo instrucción: reto de puntería puntuado

- **Objetivo:** todas las piezas para JUGAR a aprender están — falta el bucle
  de reto: objetivo aleatorio dentro de la envolvente, apuntas sin solución
  automática (sliders, cockpit, tabla de tiro), y se puntúa tu primer
  impacto. Con récords locales por arma.
- **Prompt para Fable:**
  > Crea `src/ui/Challenge.ts` con un botón "🏅 Reto": (1) elige un punto
  > aleatorio en el anillo [0.4, 0.9]·maxRange del arma/carga actual con
  > azimut aleatorio (usa `approxMaxRange` + `sampleCorridor` para colocar el
  > marcador A LA ALTURA real del suelo); (2) lo marca con una diana
  > distinta y, mientras el reto vive, DESACTIVA "🎯 Objetivo (clic)" (nada de
  > solución automática); (3) al PRIMER impacto (hook en el onImpact de
  > `ArtilleryPiece`) mide el fallo radial y puntúa: 3★ < 25 m, 2★ < 75 m,
  > 1★ < 150 m (documenta la escala; si prefieres, escálala con el CEP del
  > arma); toast + panel con distancia, estrellas y récord; (4) persiste
  > mejores marcas por arma en localStorage (clave
  > `unai-artillery/challenge/v1`); (5) "Rendirse" revela la solución vía
  > `solveForTarget` y no puntúa. La semilla del objetivo sale del reloj SOLO
  > en la app: separa la lógica pura — elección del punto (con RNG inyectado)
  > y puntuación — en funciones exportadas y testéalas en
  > `src/ui/challenge.test.ts` (sin DOM: el entorno de Vitest es node; el
  > punto cae siempre en el anillo, umbrales de estrellas exactos, récord
  > solo mejora).
- **Archivos:** nuevo `src/ui/Challenge.ts` (+ `challenge.test.ts`),
  `ArtilleryPiece.ts`, `ControlPanel.ts` o `main.ts`, `style.css`.
- **Aceptación:** el reto genera objetivos alcanzables, puntúa el primer
  impacto con la distancia real, los récords sobreviven a recargar la página,
  "Rendirse" muestra la solución; tests de la lógica pura PASS.

---

## P-PRO.8 · Rendimiento VFX: cráteres instanciados y pool de sprites

- **Objetivo:** 200 cráteres = ~400 draw calls (2 meshes por cráter) y cada
  bocanada de humo crea y destruye sprite+material (presión de GC). Con
  salvas y sesiones largas el frame-time se resiente. Instancing y pooling lo
  dejan plano sin cambiar el aspecto.
- **Prompt para Fable:**
  > (1) Reescribe `vfx/CraterLayer.ts` sobre DOS `THREE.InstancedMesh` (disco
  > de quemadura y anillo de tierra, capacidad `maxCraters`): posición,
  > rotación y escala por instancia vía `setMatrixAt` +
  > `instanceMatrix.needsUpdate`; el FIFO pasa a índice circular
  > (sobrescribe la instancia más vieja); "Limpiar" = `count = 0`. Las 4
  > texturas variantes pasan a un atlas 2×2 con offset UV por instancia — si
  > el atlas complica el shader, usa UNA textura y compensa variando la
  > rotación/escala por instancia (documenta la decisión en el header).
  > (2) En `vfx/effects.ts`, añade un pool de `THREE.Sprite`+material para
  > `PuffCloud`: adquirir/liberar en vez de crear/dispose por puff, cap
  > global ~600 (al agotarse, roba el más viejo). API pública intacta:
  > `ProjectilePresenter`/`ArtilleryPiece` no se tocan. (3) Overlay de debug
  > `?stats=1` que pinta `renderer.info.render.calls`,
  > `info.memory.geometries/textures` y sprites vivos en texto (sin
  > dependencias nuevas).
- **Archivos:** `vfx/CraterLayer.ts`, `vfx/effects.ts`,
  `render/ThreeOverlay.ts` o `main.ts` (stats).
- **Aceptación:** con 200 cráteres vivos, los draw calls atribuibles a
  cráteres son 2 (antes ~400, visible en `?stats=1`); una salva dispersa
  completa no crea materiales nuevos tras calentar el pool (contadores de
  `info.memory` estables); el aspecto de quemadura+anillo es indistinguible
  del actual.

---

## P-PRO.9 · E2E ampliado: cockpit, salva, cámaras y tabla (blindar lo nuevo)

- **Objetivo:** el smoke cubre arranque+preview+Fuego. Las superficies nuevas
  (cockpit, salva dispersa con toast de CEP, modos de cámara, tabla de tiro)
  solo se verifican a mano. Ampliar la suite local de Playwright las blinda
  en ~1 min, sin CI.
- **Prompt para Fable:**
  > Extrae el filtro `IGNORED` y helpers comunes de `e2e/smoke.spec.ts` a
  > `e2e/utils.ts` y añade tres specs: **cockpit.spec.ts** — dispara eventos
  > `wheel` sobre el canvas de azimut del cockpit y comprueba que el rumbo
  > del panel cambia ±0.5º (y ±0.05º con `shiftKey`), y que mover el slider
  > de elevación repinta el cockpit (sincronía bidireccional);
  > **salvo.spec.ts** — selecciona el mortero con carga corta (TOF corto),
  > pulsa "Salva dispersa ×6" y espera el toast "Zona batida: CEP … m"
  > (timeout generoso ~90 s), luego "Limpiar cráteres" sin errores;
  > **cameras.spec.ts** — recorre todos los botones de cámara comprobando que
  > cada modo entra sin errores de consola (para 1ª persona NO fuerces
  > pointer lock — headless no lo da de forma fiable: verifica solo el toast
  > de instrucciones) y que "Libre" restaura el control. Todos reutilizan el
  > webServer existente y `npm run e2e` los corre en serie. NO añadas CI.
- **Archivos:** `web/e2e/utils.ts`, `web/e2e/cockpit.spec.ts`,
  `web/e2e/salvo.spec.ts`, `web/e2e/cameras.spec.ts`, `web/README.md`.
- **Aceptación:** `npm run e2e` corre 4 specs en verde en local; romper
  adrede el paso de la rueda del cockpit o el texto del toast de CEP hace
  fallar exactamente el spec correspondiente.
