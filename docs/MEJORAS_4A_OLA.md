# Backlog de mejoras — 4ª ola: EL MUNDO RESPONDE (prompts listos para Fable)

Estado de partida (tras la 3ª ola + extras de 2026-07-06): **87 tests de Vitest
en verde + 4 specs de Playwright**, 14 armas (10 piezas de artillería/cohetes +
4 armas de mano y ametralladoras con BC publicados), cabina de artillero con
GunnerHud (compás + goniómetro + minimapa), cañón 3D procedural, banda 2D del
corredor con DEM Copernicus y máscara de cresta, meteo real, tabla de tiro,
elipse PER, reto puntuado, cráteres instanciados y audio sintetizado básico
(3 voces mono con retardo físico).

El tema de esta ola: hasta ahora el mundo era **decorado** — todo impacto es
tierra seca, todo es de día, nada se mueve, el sonido no tiene dirección y las
ametralladoras disparan como obuses. La 4ª ola hace que el mundo **responda**:
superficies distintas, noche, blancos móviles, espoletas, ráfagas con
trazadoras, sonido posicional — y cierra los dos huecos de satisfacción más
grandes (compartir un escenario por URL y poder usar la app sin manual ni
ratón). Cada entrada está etiquetada **[Realismo]**, **[Satisfacción]** o
**[Ambos]**.

Cada entrada es un **prompt autónomo**: pégalo tal cual en una sesión nueva de
Fable dentro de este repo y lo ejecuta. Reglas de la casa que TODOS los prompts
heredan (no se repiten en cada uno):

- **Cero assets binarios**: todo procedural (geometría Three, síntesis WebAudio,
  CSS). Nada de .mp3/.png/.glb.
- **Paridad C++ intacta**: cualquier knob nuevo del solver tiene default
  neutro que deja `validation.test.ts` bit a bit idéntico.
- **La suite crece**: la lógica nueva se separa en funciones puras testeables
  con Vitest (el entorno es node, sin DOM); las superficies de UI nuevas que
  aporten valor se blindan en Playwright. Nada de CI (a propósito).
- **Degradación amable**: sin red, sin token, sin clave de Google o sin
  WebAudio, la app sigue funcionando y avisa con toast.
- **Documentar aproximaciones**: todo modelo físico nuevo se documenta en
  `docs/FISICA_WEB.md` con sus límites, como los existentes.

Convención: **Objetivo** · **Prompt para Fable** · **Archivos** · **Aceptación**.

> Orden recomendado: **P-VIVO.3 → P-VIVO.9 → P-VIVO.1 → P-VIVO.2 → P-VIVO.4 →
> P-VIVO.5 → P-VIVO.8 → P-VIVO.6 → P-VIVO.7 → P-VIVO.10 → P-VIVO.11**.
> Razón: primero la física barata y con paridad (espoletas y V0 efectivo:
> muchas entradas posteriores cuelgan de ellas); después el salto sensorial
> (audio posicional, que las ráfagas consumen); luego las superficies del
> mundo (agua, edificios) y la noche (que usa las espoletas de tiempo); los
> dos modos de juego serios (observador avanzado y blanco móvil) cuando ya
> existe todo lo que los hace vivos; y compartir + tutorial al final, porque
> deben serializar y enseñar el estado FINAL de la ola.

---

## P-VIVO.1 · Audio 2.0: paisaje sonoro posicional **[Ambos]**

- **Objetivo:** `vfx/AudioBoom.ts` ya sintetiza 3 voces con retardo físico
  real, pero es MONO, va directo a `destination`, no hay control de volumen y
  el proyectil vuela en silencio. Panorama estéreo según dónde está el evento
  respecto a la cámara, silbido doppler del proyectil al caer, y un master con
  volumen persistido convierten el audio de "aviso" en "presencia". Sigue
  siendo 100% síntesis, cero assets.
- **Prompt para Fable:**
  > Amplía `web/src/vfx/AudioBoom.ts`: (1) grafo con `masterGain` +
  > `DynamicsCompressorNode` antes de `destination`; control 🔊 en
  > `ControlPanel.ts` (slider 0–100 + mute) persistido en localStorage
  > `unai-artillery/audio/v1`. (2) Panorama: cada voz pasa por un
  > `StereoPannerNode`; el pan se calcula con el acimut del EVENTO respecto al
  > heading de la cámara de Cesium (`viewer.camera.heading`) — un impacto a tu
  > derecha suena a la derecha, y al orbitar con la cámara Seguir el paisaje
  > gira contigo. (3) Silbido de proyectil: voz nueva `whistle` — ruido
  > bandpass estrecho + oscilador cuya frecuencia central cae de ~1200 a
  > ~600 Hz — que suena mientras el proyectil está SUBSÓNICO y a <500 m de la
  > cámara (el silbido de las bombas es la fase terminal subsónica: los
  > morteros silban, un GMLRS supersónico NO), con ganancia que crece al
  > acercarse; engánchalo al tick de `ProjectilePresenter` (posición del
  > proyectil y de la cámara ya disponibles por frame). (4) Voz `rifle` para
  > `SmallArms`: crack corto highpass + golpe seco breve, escala pequeña —
  > P-VIVO.2 la disparará en cadencia. (5) TODO el cálculo escalar — pan
  > desde acimuts, ganancia por distancia, retardo, frecuencia del silbido
  > según Mach/distancia — vive en un `web/src/vfx/audioMath.ts` PURO (sin
  > AudioContext) con test de Vitest: pan ±1 en los costados y 0 de frente,
  > retardo = distancia/a, el silbido se anula por encima de Mach 1.
  > `AudioBoom` solo aplica los números. Si `AudioContext` no está disponible
  > todo degrada en silencio como hoy.
- **Archivos:** `vfx/AudioBoom.ts`, nuevo `vfx/audioMath.ts` (+ test),
  `ControlPanel.ts`, `ProjectilePresenter.ts`, `main.ts`, `style.css`.
- **Aceptación:** con la cámara Seguir orbitando alrededor del proyectil el
  boom del impacto cambia de lado de forma audible; un tiro de mortero silba
  al caer cerca y un GMLRS no; el slider y el mute sobreviven a recargar;
  tests de `audioMath` PASS y los 87 existentes en verde.

---

## P-VIVO.2 · Ametralladoras de verdad: ráfagas, cadencia y trazadoras **[Ambos]**

- **Objetivo:** las armas de mano nuevas disparan tiro a tiro con el botón
  FUEGO, como un obús. Una M2 real escupe ~9 disparos/s con una trazadora cada
  5 balas — y esa línea de luz curvándose es la MEJOR lección de balística del
  proyecto (ves la caída de verdad, sin parábola pintada: encaja con el modo
  inmersión). Cadencia, jitter de rebufo y trazadoras lo hacen real.
- **Prompt para Fable:**
  > Añade a `Weapon` (WeaponCatalog.ts) los opcionales `rateOfFireRpm` (M240:
  > 750, M2: 550; el resto sin definir) y `tracerEvery = 5`. En
  > `ControlPanel.ts`, para armas con cadencia el botón FUEGO pasa a
  > MANTENER: mientras esté pulsado (pointerdown→pointerup) `ArtilleryPiece`
  > dispara cada `60/rpm` s. Cada bala de la ráfaga perturba la puntería con
  > σ = 2.5 mils (rebufo) usando el MISMO RNG determinista de la dispersión
  > (mulberry32 con semilla por ráfaga: reproducible). Los solves van al
  > worker como hoy — son baratos a esta escala — pero pon un tope de ~24
  > proyectiles simultáneos en vuelo (FIFO: el más viejo se descarta en
  > silencio). Trazadora: cada `tracerEvery`-ésima bala lleva flag `tracer` →
  > `TrailFX` variante aditiva rojo-anaranjada SIEMPRE visible (no depende de
  > Mach como la condensación) que se apaga a los ~3.5 s de vuelo (el
  > trazador se consume); las balas no trazadoras en ráfaga simplifican VFX
  > (fogonazo compartido: 1 muzzle flash + 1 puff por cada 3 disparos, nada
  > de humo individual). El `GunModel` de trípode vibra con la cadencia
  > (retroceso rápido de 3 cm ya existente, re-disparado por bala) y
  > `AudioBoom` encadena la voz `rifle` a la cadencia real con jitter de
  > ±5 ms. La lógica pura de la ráfaga — timestamps de disparo desde rpm,
  > selección de trazadoras, jitter con RNG inyectado — va en una función
  > exportada (p.ej. en `ballistics/WeaponSystem.ts` o un `burst.ts`) con
  > test: cadencia exacta, 1 trazadora de cada 5, jitter reproducible por
  > semilla.
- **Archivos:** `WeaponCatalog.ts`, `ArtilleryPiece.ts`, `ControlPanel.ts`,
  `ProjectilePresenter.ts`, `vfx/effects.ts`, `GunModel.ts`,
  `vfx/AudioBoom.ts`, test nuevo.
- **Aceptación:** mantener FUEGO con la M2 sostiene ~9 disparos/s con
  trazadoras cada 5 que se ven curvarse hacia el suelo; los impactos agrupan
  con dispersión creíble; el frame-time se mantiene plano (verificar con
  `?stats=1`); soltar el botón corta la ráfaga al instante; tests de la
  lógica de ráfaga PASS.

---

## P-VIVO.3 · Espoletas: impacto, tiempo (airburst), proximidad y retardo **[Realismo]**

- **Objetivo:** hoy toda munición explota al tocar el suelo. La espoleta es LA
  decisión táctica de la artillería real: el airburst bate mucha más zona
  contra área descubierta, la proximidad (VT) lo hace sin calcular el tiempo,
  el retardo entierra la explosión. Es física barata — la integración ya
  existe, solo cambia la condición de corte — y P-VIVO.8 (bengalas) la
  necesita.
- **Prompt para Fable:**
  > Añade al orden de tiro (en `ballistics/WeaponSystem.ts` y su serialización
  > en `WorkerProtocol.ts`) un
  > `fuze: { mode: 'impact'|'time'|'proximity'|'delay', timeS?, heightM? }`
  > con default `'impact'` que deja la integración BIT A BIT idéntica
  > (paridad intacta). `'time'`: la integración termina en `t = timeS`
  > (detonación en el aire, esté donde esté). `'proximity'`: termina cuando la
  > altura sobre el suelo del corredor baja de `heightM` (default 7 m) en fase
  > DESCENDENTE — el solver ya muestrea el terreno por paso, es una
  > comparación más. `'delay'`: el punto de impacto es el mismo pero el
  > resultado se marca `buried: true`. En `ControlPanel.ts`, selector
  > "Espoleta" visible solo para municiones con `explosiveTntEqKg > 0.05`;
  > para `'time'` autocompleta `timeS` con el TOF del preview vigente − 0.5 s
  > (editable, paso 0.1 s). VFX en `ProjectilePresenter`/`vfx/effects.ts`:
  > detonación aérea = `ImpactExplosionFX` sin falda de polvo NI cráter, más
  > `GroundShockwaveFX` proyectado en el suelo bajo el punto, más el patrón de
  > fragmentación: 10–16 polvaredas (sprites del pool) sembradas con RNG
  > determinista en una elipse orientada al rumbo (semiejes ≈ 2:1, escala con
  > el yield) — la huella en mariposa de un airburst real. `'delay'` = flash
  > mínimo, columna de tierra más alta y estrecha, cráter algo mayor. Tests en
  > `fidelity.test.ts`: (a) `'time'` corta en `timeS` exacto (±dt); (b)
  > `'proximity'` corta a `heightM ± 1 m` sobre el suelo en descenso, también
  > con terreno inclinado sintético; (c) default `'impact'` no mueve NADA
  > (comparación con resultado de referencia). Documenta el modelo (y que la
  > letalidad no se simula, solo la huella) en `docs/FISICA_WEB.md`.
- **Archivos:** `ballistics/WeaponSystem.ts`, `ballistics/BallisticsSolver.ts`
  (condición de corte), `WorkerProtocol.ts`, `ControlPanel.ts`,
  `ArtilleryPiece.ts`, `ProjectilePresenter.ts`, `vfx/effects.ts`,
  `fidelity.test.ts`, `docs/FISICA_WEB.md`.
- **Aceptación:** un M777 con espoleta de tiempo revienta EN EL AIRE a la
  altura esperada con huella elíptica de polvaredas en el suelo; proximidad a
  7 m funciona sin conocer el TOF; tests (a)(b)(c) PASS y paridad C++
  intacta.

---

## P-VIVO.4 · El mundo tiene superficies: agua y rebotes rasantes **[Realismo]**

- **Objetivo:** dispara al mar y sale un cráter de tierra quemada flotando.
  Clasificar el impacto (agua/tierra) da el splash que falta, y el rebote
  rasante — las balas del .50 rebotan de verdad sobre el agua a ángulos
  bajos — es física real y espectáculo gratis con las trazadoras de P-VIVO.2.
- **Prompt para Fable:**
  > (1) Clasificación de superficie en `BallisticsService`: un impacto es AGUA
  > si la altura muestreada del terreno en el punto (la que ya calcula el
  > corredor, tras la reducción de dátum) es < 0.5 m — el océano es 0 exacto
  > tanto en CWT como en el DEM Copernicus. Documenta la limitación honesta:
  > lagos y ríos interiores NO se detectan (están por encima de 0). De paso,
  > activa `requestWaterMask: true` al crear el World Terrain en `viewer.ts`
  > (el mar se VE como agua con especular — bonus visual gratis). (2) VFX
  > `WaterSplashFX` en `vfx/effects.ts`: columna blanca vertical (sprites del
  > pool apilados, tinte azul-blanco) + 2–3 anillos concéntricos expansivos a
  > ras de agua + spray que cae; SIN cráter, SIN quemadura, SIN falda de
  > polvo; escala con el yield como la explosión. `AudioBoom` gana la
  > variante `impactWater` (lowpass más cerrado, ataque más blando). (3)
  > Rebote rasante: solo municiones SIN explosivo (`SmallArms`). Si el ángulo
  > de caída respecto al plano local del terreno es < 12°, la bala rebota con
  > probabilidad `p = 1 − ángulo/12°` (RNG determinista sembrado por
  > disparo): velocidad reflejada especularmente con restitución 0.55
  > tangencial / 0.3 normal y desvío aleatorio ±3°, y el vuelo restante se
  > RE-INTEGRA en el worker (nueva solveTrajectory con estado inicial en el
  > punto de rebote) hasta el impacto final; `ProjectilePresenter` encadena
  > los dos tramos sin costura y la trazadora sigue el rebote. Máximo 2
  > rebotes. La geometría de reflexión (normal del terreno desde el perfil,
  > ángulo de caída, velocidad de salida) va en funciones puras con test:
  > reflexión correcta sobre plano inclinado sintético, energía siempre
  > decreciente, reproducibilidad por semilla. Documenta el modelo (umbrales
  > elegidos y por qué solo munición inerte) en `docs/FISICA_WEB.md`.
- **Archivos:** `viewer.ts`, `BallisticsService.ts`, `ArtilleryPiece.ts`,
  `ProjectilePresenter.ts`, `vfx/effects.ts`, `vfx/AudioBoom.ts`, test nuevo
  (geometría del rebote), `fidelity.test.ts` o propio, `docs/FISICA_WEB.md`.
- **Aceptación:** un tiro del M777 al mar levanta columna de agua y anillos —
  y NO deja cráter; una ráfaga rasante del .50 sobre el agua rebota
  visiblemente (trazadoras saltando) de forma reproducible con semilla; en
  tierra nada cambia; tests de la reflexión PASS.

---

## P-VIVO.5 · Impactar contra los edificios 3D (cerrar la limitación documentada) **[Realismo]**

- **Objetivo:** FISICA_WEB.md lo reconoce: "un tiro rasante atraviesa un
  rascacielos". Con los Photorealistic 3D Tiles activos, detectar dónde la
  trayectoria se mete DENTRO del volumen visual y recortar la reproducción ahí
  — explosión en la fachada, no un cráter fantasma detrás del edificio.
- **Prompt para Fable:**
  > Crea `web/src/BuildingHit.ts`. Cuando el tileset 3D está activo y el
  > resultado del solve ya existe, PRE-muestrea la cola de la trayectoria
  > (los últimos ~2 km en 2D, submuestreados cada ~15 m) contra el suelo
  > visual con `scene.sampleHeightMostDetailed` en UN lote (la misma técnica
  > que ya usa el anclaje de la batería) — hazlo en cuanto empieza el vuelo:
  > el TOF de decenas de segundos esconde de sobra la latencia; si el
  > muestreo no ha terminado cuando el proyectil llega, se ignora (fallback =
  > comportamiento actual). El primer punto de la polilínea cuya altitud de
  > vuelo queda POR DEBAJO de la altura visual muestreada es el impacto
  > estructural: si la altura visual en ese punto supera en >3 m la del
  > terreno del corredor, es EDIFICIO (fachada o tejado) — recorta la
  > reproducción de `ProjectilePresenter` ahí, dispara `ImpactExplosionFX`
  > SIN cráter (nada de quemadura pegada a una fachada vertical: solo bola de
  > fuego + humo + audio) y toast "🏢 Impacto en estructura a X m del
  > objetivo"; si no supera el umbral es simplemente el suelo visual y no
  > cambia nada. La física del solver NO se toca (los edificios siguen sin
  > existir para la integración: es un recorte de presentación y se documenta
  > así); el fallo radial del reto y el hook `onImpact` usan el punto
  > recortado. La lógica pura — primer cruce polilínea vs alturas
  > muestreadas, umbral edificio/suelo — va en funciones exportadas con test
  > de Vitest sobre alturas sintéticas (torre que intercepta un tiro tenso;
  > tiro alto que la sobrevuela y no se recorta; muestreo incompleto =
  > sin recorte).
- **Archivos:** nuevo `src/BuildingHit.ts` (+ test), `ProjectilePresenter.ts`,
  `ArtilleryPiece.ts`, `main.ts`, `web/README.md`, `docs/FISICA_WEB.md`.
- **Aceptación:** con edificios 3D en una ciudad, un tiro tenso contra un
  rascacielos explota EN la fachada y el cráter no aparece detrás; un tiro
  por elevación sobre el mismo edificio no se recorta; sin tileset activo el
  comportamiento es idéntico al actual; tests de la lógica de cruce PASS.

---

## P-VIVO.6 · Observador avanzado: corrige el tiro como se hace de verdad **[Ambos]**

- **Objetivo:** la esencia de la artillería es que NO ves el objetivo desde el
  arma: lo ve un observador que canta correcciones ("derecha 50, largo 100").
  Un modo reto donde solo ves el mundo desde el puesto de observación — con el
  boom llegando tarde de verdad gracias al audio con retardo físico — es el
  juego serio definitivo de este simulador y la lección número 1 de dirección
  de tiro.
- **Prompt para Fable:**
  > Crea `web/src/ui/ForwardObserver.ts` y un botón "🔭 Reto FO" junto al
  > reto actual. (1) Generación: elige objetivo como el reto normal (anillo
  > [0.4, 0.9]·maxRange) y un puesto de observación (OP) a 2–4 km del
  > objetivo, perpendicular ± al rumbo batería→objetivo; valida LÍNEA DE
  > VISIÓN muestreando el perfil OP→objetivo con la cascada de terreno
  > existente (si el relieve bloquea, reintenta hasta 8 posiciones; si
  > ninguna ve, acorta la distancia); el OP se planta a 1.7 m sobre el suelo.
  > (2) Cámara: modo `op` en `CameraDirector` — posición FIJA en el OP,
  > girar/zoom con las convenciones de la Cabina (rueda + arrastre), sin
  > desplazamiento; al entrar en el reto FO la cámara se bloquea ahí, el
  > toggle de parábola se fuerza OFF, la elipse PER y el marcador de impacto
  > previsto del minimapa se OCULTAN (nada de chivatos), y "🎯 Objetivo
  > (clic)" queda desactivado. (3) Corrección: panel compacto con botones
  > ±25/±50/±100 en dos ejes SOBRE LA LÍNEA OP→OBJETIVO (así se corrige de
  > verdad: "derecha/izquierda" y "largo/corto" son relativos a lo que VE el
  > observador) que trasladan el punto de puntería vigente — conversión
  > OT→ENU en función pura con test — y recalculan el solve; el usuario
  > dispara, ve el impacto desde el OP (fogonazo lejano en la batería, boom
  > que llega segundos tarde: ya lo hace AudioBoom), estima el error y
  > corrige. (4) Puntuación: rondas gastadas hasta impactar a <50 m del
  > objetivo (1 ronda = ★★★, 2–3 = ★★, 4–6 = ★); récord por arma en
  > localStorage `unai-artillery/challenge-fo/v1`; "Rendirse" revela el
  > objetivo y la solución. Reutiliza los hooks de impacto y la
  > infraestructura de `Challenge.ts`/`challengeCore.ts` — extrae lo común en
  > vez de duplicar. Tests (sin DOM): conversión OT→ENU (casos cardinales),
  > validación de LOS con perfiles sintéticos (cresta que bloquea / valle que
  > deja ver), escala de estrellas por rondas.
- **Archivos:** nuevo `src/ui/ForwardObserver.ts` (+ test),
  `ui/Challenge.ts`, `ui/challengeCore.ts`, `CameraDirector.ts`,
  `ui/GunnerHud.ts`, `main.ts`, `style.css`, `web/README.md`.
- **Aceptación:** el reto FO te planta en un cerro viendo el objetivo y NO la
  solución; "derecha 50" mueve el punto perpendicular a TU línea de visión
  (no a la del arma); el boom del impacto llega tarde según la distancia al
  OP; se puntúa por rondas y el récord persiste; tests PASS.

---

## P-VIVO.7 · Blancos que se mueven: apunta al futuro **[Ambos]**

- **Objetivo:** todo en el sim está clavado al suelo. Un convoy a 40 km/h con
  un TOF de 40 s se ha movido 440 m cuando llega el tiro: el ADELANTO
  (lead = v·TOF) es la lección de tiro predicho que falta, y el nivel 2
  natural del reto.
- **Prompt para Fable:**
  > Crea `web/src/MovingTarget.ts`: un blanco móvil — grupo Three esquemático
  > (caja-camión de ~8 m, verde oscuro, con estela punteada de los últimos
  > 30 s) — que avanza con rumbo y velocidad constantes PEGADO al suelo real:
  > pre-muestrea la altura del camino por delante en lotes (la cascada
  > DEM/terreno de `dem.ts`/`BallisticsService` con su caché) e interpola
  > entre muestras; la propagación `posición(t)` es una clase pura con test
  > (avance correcto, altura interpolada, determinista). Modo "🚚 Reto móvil"
  > en `Challenge.ts`: objetivo móvil con v aleatoria 20–60 km/h y rumbo
  > aleatorio (RNG inyectado como en el reto actual), re-anclado si se sale
  > del anillo [0.3, 0.95]·maxRange; el impacto se puntúa contra la posición
  > del blanco EN EL INSTANTE del impacto (el hook `onImpact` ya da el punto
  > y el presentador el tiempo — mide la distancia 2D al blanco en ese t) con
  > los umbrales de estrellas del reto clásico; récords en clave
  > `unai-artillery/challenge-moving/v1`. Ayuda didáctica: toggle "adelanto
  > sugerido" (activado por defecto en el primer intento) que pinta un
  > FANTASMA translúcido del blanco en su posición extrapolada al TOF del
  > preview vigente — apunta al fantasma y aciertas… si el TOF no cambia al
  > re-apuntar: esa es exactamente la lección (itera 2–3 veces y lo ves
  > converger; explica esto en un tooltip). En el minimapa del GunnerHud el
  > blanco móvil se pinta con su vector de velocidad. Tests: propagación
  > pura, extrapolación del fantasma, puntuación en t de impacto con blanco
  > sintético.
- **Archivos:** nuevo `src/MovingTarget.ts` (+ test), `ui/Challenge.ts`,
  `ui/challengeCore.ts`, `ArtilleryPiece.ts`, `TrajectoryPreview.ts`,
  `ui/GunnerHud.ts`, `main.ts`.
- **Aceptación:** el camión avanza pegado al relieve dejando estela; sin
  adelanto fallas por ≈ v·TOF detrás del blanco; apuntando al fantasma (tras
  converger) impactas; los récords móviles son independientes; tests PASS.

---

## P-VIVO.8 · La noche, las bengalas y el humo **[Ambos]**

- **Objetivo:** siempre es mediodía. La noche real de Cesium + dos municiones
  reales de misión — iluminación (ILLUM: bengala con paracaídas) y humo
  (SMOKE: cortina que dura y deriva) — son espectáculo puro, usan las
  espoletas de P-VIVO.3 y le dan al reto FO (P-VIVO.6) su variante más bonita:
  iluminar el objetivo para poder corregir.
- **Prompt para Fable:**
  > (1) Toggle "🌙 Noche" en `ControlPanel.ts`: activa
  > `viewer.scene.globe.enableLighting`, fija `viewer.clock.currentTime` a la
  > medianoche local de la batería (y "☀️ Día" restaura), enciende
  > `scene.moon` y sube ligeramente la exposición; recomienda `?bloom=1` en
  > el toast si no está activo. (2) Munición **ILLUM** (rondas seleccionables
  > del mortero y el M777 — el selector de munición de P-PRO.4 ya existe):
  > espoleta de tiempo forzada; al detonar NO hay explosión — se despliega
  > una bengala: sprite aditivo blanco-cálido parpadeante + `THREE.PointLight`
  > de ~800 m de radio que desciende a 4.5 m/s COLGADA del viento real
  > (muestrea el perfil de `Atmosphere` a su altitud y deriva con él) durante
  > ~50 s antes de apagarse con fundido. La luz de Three NO ilumina el globo
  > de Cesium (materiales aparte): compénsalo con un disco de luz falso en el
  > suelo — decal aditivo suave bajo la bengala que la sigue — y documenta el
  > truco en el header. Los objetos Three (cañón, blanco, cráteres, camión de
  > P-VIVO.7) SÍ reciben la PointLight. (3) Munición **SMOKE** (mortero y
  > M777): al impactar, sin explosión ni cráter: 8–12 nubes del pool de
  > sprites, GRANDES y persistentes (~90 s, re-alimentadas), formando una
  > cortina lineal perpendicular al rumbo que deriva con el viento de
  > superficie — en el reto FO bloquea la línea de visión de verdad (visual;
  > no hace falta lógica de oclusión). La cinemática pura de la bengala
  > (altura(t), deriva con perfil de viento inyectado, vida útil) va en
  > funciones exportadas con test. Cuida el pool: las nubes de humo
  > persistentes usan una prioridad que impide que la ráfaga de P-VIVO.2 se
  > las robe.
- **Archivos:** `ControlPanel.ts`, `viewer.ts`, `WeaponCatalog.ts`,
  `ProjectilePresenter.ts`, `vfx/effects.ts` (FlareFX + SmokeScreenFX),
  `main.ts`, test nuevo (cinemática de bengala), `web/README.md`.
- **Aceptación:** de noche el fogonazo deslumbra y la trazadora de la M2 se
  ve gloriosa; una ILLUM sobre el objetivo lo hace visible (disco de luz +
  objetos iluminados) mientras baja derivando con el viento ~50 s; la
  cortina SMOKE tapa el objetivo ~90 s y se desplaza con el viento; día/noche
  conmuta en vivo sin recargar; tests PASS.

---

## P-VIVO.9 · La V0 no es un número de catálogo: temperatura de carga, desgaste y radar de boca **[Realismo]**

- **Objetivo:** la velocidad de boca real varía con la temperatura del
  propelente y el desgaste del tubo, y la dirección de tiro real la CORRIGE
  midiéndola con radar de boca. Son factores escalares sobre V0 — física
  baratísima — y es la lección de dirección de tiro que cierra el círculo con
  la tabla y la elipse PER.
- **Prompt para Fable:**
  > En `ballistics/WeaponSystem.ts` añade al orden de tiro un
  > `v0Correction = { chargeTempC: 21, wearFraction: 0 }` con
  > `V0_efectiva = V0·(1 + 0.0006·(chargeTempC − 21))·(1 − wearFraction)` —
  > k_T ≈ 0.06%/°C es el orden de magnitud de las tablas de 155 mm
  > (documenta la aproximación y su fuente cualitativa en FISICA_WEB.md);
  > default = neutro, paridad intacta. Propágalo por `WorkerProtocol` a
  > preview, solves, tabla de tiro y elipse PER (todo debe usar la V0
  > efectiva). UI: (1) en `Weather.ts`, campo "T. carga" que arranca acoplado
  > a la temperatura ambiente (editable −40…+50 °C; la meteo real de
  > Open-Meteo lo actualiza salvo que el usuario lo haya tocado); (2)
  > contador de **EFC** por arma y sesión: cada disparo a carga máxima suma
  > 1.0, cargas menores suman `(carga/carga_max)²`; el desgaste real es
  > imperceptible en una sesión, así que añade el toggle didáctico "desgaste
  > ×200" (honesto: la etiqueta dice que está acelerado) con
  > `wearFraction = min(0.03, EFC_equivalente·2e-5·200)`; (3) botón "📡 Radar
  > de boca" tras cada disparo: muestra la V0 REAL de esa ronda (la V0
  > perturbada que ya genera el RNG de dispersión) frente a la nominal, y
  > "Aplicar corrección" ajusta un sesgo persistente de sesión que se suma a
  > la corrección — tras aplicarlo, la σ_V0 usada por la elipse PER baja de
  > 0.3% a 0.15% (calibración reduce incertidumbre: documentado). Tests en
  > `fidelity.test.ts`: (a) +30 °C de carga alarga el alcance del M777 entre
  > +1% y +4%; (b) el desgaste acorta monótonamente; (c) neutro = bit a bit
  > el resultado actual; (d) con semilla fija, aplicar la corrección del
  > radar reduce el error medio de la salva siguiente.
- **Archivos:** `ballistics/WeaponSystem.ts`, `WorkerProtocol.ts`,
  `BallisticsService.ts`, `ui/Weather.ts`, `ControlPanel.ts`,
  `ArtilleryPiece.ts`, `fidelity.test.ts`, `docs/FISICA_WEB.md`.
- **Aceptación:** mover "T. carga" mueve el alcance del preview y la tabla de
  tiro EN VIVO; con desgaste ×200 una sesión de tiro sostenido acorta
  visiblemente el alcance; el radar de boca hace la salva siguiente
  medidamente más precisa; tests (a)–(d) PASS y paridad intacta.

---

## P-VIVO.10 · Compartir el escenario por URL y repetir el tiro **[Satisfacción]**

- **Objetivo:** nada sobrevive a un reload (salvo récords) y un escenario
  montado con mimo — batería en un valle concreto, meteo, arma, objetivo — no
  se puede enseñar a nadie. URL con estado + botón de repetición del último
  vuelo, aprovechando que `ProjectilePresenter` reproduce `FlightResult`s
  grabados.
- **Prompt para Fable:**
  > (1) Crea `web/src/ui/shareState.ts` con `encodeState`/`decodeState`
  > PUROS y versionados (`v:1`): {lat/lon de la batería, id de arma, índice
  > de munición, carga, azimut, elevación, objetivo (si hay), meteo manual
  > (viento/T/P o flag de meteo real), toggles relevantes (edificios,
  > parábola, noche…)} → JSON compacto → base64url en `location.hash`
  > (`#s=…`). Botón "🔗 Compartir" en `ControlPanel.ts`:
  > `navigator.clipboard.writeText` + toast. Al arrancar con hash: restaurar
  > en el ORDEN correcto — mover batería (re-anclaje) → arma/munición/carga →
  > meteo → puntería → objetivo con su solve — y limpiar el hash si algo
  > falla (toast). Campos desconocidos se ignoran (forward-compat). Test de
  > Vitest: round-trip exacto (con tolerancia float en lat/lon), rechazo
  > limpio de hash corrupto y de versión futura. (2) Botón "↺ Repetir" en el
  > HUD al terminar cada vuelo: cachea el último `FlightResult` + metadatos y
  > lo RE-REPRODUCE sin re-integrar, con selector rápido de cámara
  > (Seguir/Cabina/Dron) y toggle "×0.25" que usa la dilatación de tiempo del
  > bullet-time existente durante toda la repetición. Los cráteres de la
  > repetición no se duplican (flag replay: VFX sí, cráter no). (3) Persiste
  > la última configuración completa en localStorage
  > (`unai-artillery/session/v1`, mismo encoder) y restáurala al abrir sin
  > hash; botón discreto "restablecer" que la borra. Amplía un spec de
  > Playwright existente o añade `share.spec.ts`: fija estado, lee el hash
  > generado, recarga con él y comprueba que arma/azimut/carga del panel
  > coinciden.
- **Archivos:** nuevo `src/ui/shareState.ts` (+ test), `main.ts`,
  `ControlPanel.ts`, `ui/HUD.ts`, `ProjectilePresenter.ts`,
  `e2e/share.spec.ts`, `web/README.md`.
- **Aceptación:** copiar la URL y abrirla en una pestaña nueva reconstruye
  batería, arma, meteo, puntería y objetivo con el mismo preview; "↺
  Repetir" reproduce el MISMO vuelo (misma traza, sin cráter nuevo) a ×1 y
  ×0.25; recargar sin hash restaura la última sesión; tests + spec PASS.

---

## P-VIVO.11 · Primer contacto: tutorial guiado y usable en tablet **[Satisfacción]**

- **Objetivo:** la consola intimida al que llega nuevo y en una tablet la app
  es inservible (todo es rueda de ratón y pointer lock). Un tutorial de 6
  pasos que avanza al hacer — no al leer — y entrada táctil en lo esencial
  bajan la barrera de entrada a cero. Cierra la ola porque debe enseñar el
  estado FINAL (espoletas, retos nuevos, compartir).
- **Prompt para Fable:**
  > (1) Crea `web/src/ui/Tutorial.ts`: coach-marks — overlay oscuro con
  > recorte alrededor del elemento activo + globo con flecha, texto y paso
  > "N/6" — que avanzan al DETECTAR la acción real (suscríbete a los eventos
  > y callbacks existentes, nada de botón "siguiente" ciego): ① elige un
  > arma distinta → ② apunta (slider o cockpit) → ③ FUEGO y espera el
  > impacto → ④ marca un objetivo con clic y mira la elipse → ⑤ lanza una
  > salva dispersa → ⑥ abre el reto. "Saltar" siempre visible; se ofrece
  > solo la primera vez (`unai-artillery/tutorial/v1`) y se relanza desde un
  > botón "❓". (2) Táctil mínimo viable (objetivo: usable en tablet, no
  > paridad móvil): migra los handlers de `Cockpit.ts` a Pointer Events con
  > `setPointerCapture` y `touch-action: none` (el arrastre ya apunta: que
  > funcione con el dedo), añade a la rosa y al cuadrante el gesto de
  > arrastre fino con dos dedos (equivalente al Shift), agranda los targets
  > táctiles de botones/selects a ≥40 px vía media query `(pointer: coarse)`,
  > haz los tres paneles colapsables en pestañas bajo 900 px de ancho, y
  > oculta el botón de cámara "1ª persona" cuando no hay pointer lock
  > disponible. (3) De paso, `aria-label` en todos los botones de icono y
  > `role="status"` en los toasts (barato y correcto). El estado del tutorial
  > (máquina de pasos, condiciones de avance) es una clase pura con test de
  > Vitest; añade `e2e/tutorial.spec.ts`: con localStorage limpio el paso 1
  > aparece, ejecutar la acción avanza al 2, "Saltar" lo cierra y tras
  > recargar no reaparece.
- **Archivos:** nuevo `src/ui/Tutorial.ts` (+ test), `ui/Cockpit.ts`,
  `ControlPanel.ts`, `style.css`, `e2e/tutorial.spec.ts`, `main.ts`,
  `web/README.md`.
- **Aceptación:** en la primera visita el tutorial guía los 6 pasos
  avanzando solo con acciones reales y no vuelve a molestar; en emulación
  táctil de DevTools (o tablet real) se puede elegir arma, apuntar con el
  dedo en el cockpit y disparar; los paneles caben en 900 px; spec del
  tutorial y tests PASS.
