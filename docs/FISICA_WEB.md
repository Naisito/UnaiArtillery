# Física del núcleo TS — modelos y aproximaciones

El núcleo (`web/src/ballistics/`) es un porte 1:1 del `/core` C++ ampliado con los
puntos P1 del backlog. Este documento fija **qué se modela, cómo y con qué
aproximaciones**, para que cada término sea auditable. Todos los modelos tienen test
en `validation.test.ts` (paridad C++) o `fidelity.test.ts` (fidelidad).

## Ecuación de movimiento

```
m·dv/dt = m·g + F_drag + F_coriolis + F_thrust + F_spin + F_magnus + F_pronav
```

Integrada con RK4 clásico de paso fijo (`SolverConfig.dt`, 5 ms en tests, 2-10 ms en
app) sobre el estado `[posición, velocidad, masa]`. La masa decrece linealmente
durante el quemado del motor cohete.

## Arrastre — tablas estándar G1/G7 + coeficiente balístico (P1.3)

- `DragTables.ts` contiene las funciones de arrastre de los proyectiles de
  referencia **G1** (culote plano) y **G7** (boat-tail), tabuladas Mach→Cd con
  interpolación lineal (versión abreviada de dominio público; el error de
  abreviar es <1 %).
- Una munición se define por `{dragModel: 'G7', ballisticCoefficient: BC}` con BC en
  lb/in² (las unidades en que se publican). El solver recupera
  `Cd(M) = i·Cd_ref(M)` con el factor de forma `i = SD/BC` y la densidad seccional
  `SD = masa_lb / d_in²`.
- **Los BC del catálogo están calibrados contra este solver** para reproducir el
  alcance máximo publicado de cada arma (`web/tools/calibrate_bc.ts`, ISA-76).
  Tabla vigente (P-NEXT.4):

  | Arma | Modelo | BC (lb/in²) | Alcance calibrado |
  |---|---|---|---|
  | Mortero 120 mm | G1 | 1.65 | ~6.4 km |
  | M777 (M107) | G7 | 3.69 | ~20.8 km |
  | M109A7 Paladin (M107/L39) | G7 | 5.13 | ~24 km |
  | 2S7 Pion 203 mm | G7 | 4.58 | ~37.5 km |
  | M982 Excalibur | G7 | 25.0 | ~40 km |
  | GMLRS M31 | G7 | 7.67 | ~68 km |
  | M26 MLRS | G7 | 9.94 | ~32 km |
  | ER GMLRS | G7 | 12.53 | ~150 km (esférico) |
  | Misil táctico (ATACMS) | G7 | 11.56 | ~300 km (esférico) |
  | PrSM (clase) | G7 | 14.02 | ~500 km (esférico) |

  Los factores de forma quedan en 0.3–1.5 (test de plausibilidad) salvo el
  Excalibur (i ≈ 0.11): su BC absorbe el planeo con canards, que el solver no
  modela — es un ajuste de ingeniería consciente.
- La curva explícita `Cd(Mach)` original sigue disponible (`dragModel:'explicit'` y
  variante `'legacy'` del catálogo), que es la configuración de paridad con C++.

## Atmósfera (P-NEXT.2) y viento (P1.7)

El modelo por defecto es la **US Standard Atmosphere 1976 completa hasta 86 km**
geométricos: 7 capas definidas en altitud geopotencial `H = r₀·Z/(r₀+Z)`
(r₀ = 6 356 766 m) — 0-11 km (−6.5 K/km), 11-20 (isoterma), 20-32 (+1.0),
32-47 (+2.8), 47-51 (isoterma), 51-71 (−2.8), 71-84.85 (−2.0 K/km) — con la
fórmula barométrica de gradiente o de capa isoterma según el caso, y una **cola
exponencial isoterma** por encima. Verificada contra la tabla publicada
(20/30/32/40/47/50/71/86 km, error <0.1%; test con banda ±2% en
`fidelity.test.ts`). Los knobs `seaLevelTemperatureK/PressurePa` desplazan toda
la columna: ΔT mueve la base de cada capa y la escalera de presiones se
reconstruye desde el P0 real.

El modelo antiguo de 2 capas (troposfera + isoterma 11-20 km extrapolada), que es
el del núcleo C++ validado, sigue disponible como `model: 'isa2'` /
`Atmosphere.legacyTwoLayer()` y es el que corren los tests de paridad
(`validation.test.ts`). Por encima de ~20 km divergen (a 70 km el legacy era
~2.5× demasiado tenue — relevante para el misil táctico, que pasa medio vuelo a
30-80 km). La recalibración de BCs bajo ISA-76 (`tools/calibrate_bc.ts`) confirmó
los valores existentes dentro de 0.3%: casi todo el arrastre ocurre por debajo de
20 km, donde ambos modelos son idénticos.

El viento es un campo `(posición, t) → vector`; además del viento constante con
ganancia por altitud, se acepta un **perfil por altitud**
`{altitud → (velocidad, rumbo)}` interpolado (velocidad lineal, rumbo por el arco
más corto), cargable de CSV (`altitude_m,speed_ms,from_bearing_deg`). Ejemplo con
cizalladura en `web/public/data/wind_shear_example.csv`.

## Coriolis

`a = −2·Ω×v` con `Ω` en el marco ENU según la latitud real de la batería. Firma
comprobable en las tablas de tiro: un tiro casi vertical deriva al Oeste, la deriva
gira a Este al bajar la elevación.

## Deriva por rotación y Magnus (P1.2) — aproximación asumida

Para proyectiles estriados (`spinStabilized`):

- **Spin**: `p₀ = 2π·v₀/(twist_calibres·d)`, decaimiento exponencial `τ = 80 s`
  (los proyectiles conservan casi todo el giro en vuelo).
- **Deriva giroscópica (yaw of repose)**: un proyectil estabilizado por giro se
  asienta con una pequeña guiñada de equilibrio que genera sustentación lateral
  hacia el lado del estriado. En vez del tratamiento 6-DOF completo (inercias,
  C_Mα, C_Lα…), se modela la aceleración lateral como
  `a_sd = k_sd · g · (p·d/|v_rel|)` en la dirección `v̂ × ẑ` (derecha del tiro para
  estriado dextrógiro), con **k_sd = 0.008 calibrado** para dar la deriva típica de
  tablas de tiro de 155 mm (~30-70 m a 20 km, test con banda 10-150 m).
- **Magnus**: `a_m = C_mag · ρ·A·d/(2m) · (ω_spin × v_rel)` con `ω_spin = ±p·v̂` y
  `C_mag = 0.25`. Término pequeño; aporta la respuesta correcta en signo ante viento
  cruzado.

Limitación consciente: no hay dinámica de guiñada real (precesión/nutación); ambos
términos son fuerzas medias equivalentes.

## Tierra esférica ECEF (P1.4) — cuándo activarla

`SolverConfig.sphericalEarth = true` integra en coordenadas **ECEF** ancladas al
elipsoide WGS84 en la batería:

- Gravedad puntual `μ/r²` hacia el geocentro (sin J2: error ~0.2 % en g, muy por
  debajo de la incertidumbre del arrastre).
- Rotación terrestre como términos explícitos: Coriolis `−2Ω×v` y centrífugo
  `−Ω×(Ω×r)`.
- Salida convertida a ENU; `downrange` pasa a ser **arco de círculo máximo**.

**Activar por encima de ~50 km de alcance.** El plano tangente sobreestima poco a
50 km y diverge de forma creciente: medido con el misil táctico, ~0.4 km a 160 km,
~2.5 km a 250 km y ~6 km a 295 km (test de divergencia monótona). El servicio web lo
activa automáticamente cuando el alcance del arma supera 50 km.

Nota de catálogo: el motor del misil del C++ original tenía velocidad de escape
efectiva de 7000 m/s (nunca se validó); el catálogo BC usa Isp ≈ 265 s
(`ΔV ≈ 2.1 km/s`) y queda calibrado a **300 km** de alcance máximo esférico.

## Terreno del corredor de tiro (P-WEB.2 / P-PRO.3 / fix 3D)

La integración es pura: el solver recibe un callback `(este, norte) → z` que
interpola **bilinealmente una banda 2D** muestreada a lo largo del rumbo (paso
adaptativo ≤161 columnas × 5 filas de ±1 km; mayor semiancho para salvas y
guiados desplazados). La FUENTE de alturas es una cascada según lo que se ve:

1. **Terreno real de ion (CWT)** — `sampleTerrainMostDetailed` (con o sin
   edificios 3D: el relieve de Google coincide con CWT a pocos metros).
2. **Edificios 3D sin ion** — el suelo visual de Google trae el relieve
   horneado en las teselas; el corredor se muestrea contra el **DEM Copernicus
   GLO-90** (Open-Meteo Elevation: gratis, sin clave, CORS, ≤100 puntos por
   petición, caché por coordenada cuantizada a ~11 m). Sin red, degrada a
   plano a la cota del ancla.
3. **Modo plano (OSM/elipsoide)** — suelo a 0 m, como el suelo visual.

Dos detalles que hacen esto consistente:

- **Perfil relativo**: el perfil viaja como `h(s,t) − h(batería)`, referido a
  la muestra de la PROPIA batería (fila central, s=0). Así el dátum de cada
  fuente se cancela (el DEM da alturas MSL, las teselas y CWT elipsoidales;
  la ondulación del geoide ~50 m en Iberia varía <1 m en 70 km) y el z=0 ENU
  es siempre el suelo del ancla — que con edificios 3D se muestrea contra el
  propio tileset (`sampleHeightMostDetailed`) para clavar lo visual.
- **Máscara de cresta**: con terreno, el cruce por debajo del suelo cuenta
  como impacto también en fase ASCENDENTE (un tiro tenso puede comerse una
  ladera que sube más deprisa que él — *crest clearance*, la preocupación real
  de toda dirección de tiro). Sin terreno (plano analítico, la configuración
  de paridad C++) se mantiene la puerta descendente clásica, así que la
  paridad no se mueve. Tests: cuesta abajo el arco se ALARGA y aterriza bajo
  la cota de la batería; una cresta de 400 m detiene un tiro a QE 8º que sin
  terreno vuela >8 km; con terreno plano a 0 el resultado es bit a bit el del
  plano analítico.

Limitación consciente: el DEM es *terreno desnudo* a 90 m — los edificios de
Google siguen siendo visuales (un tiro rasante "atraviesa" un rascacielos, y
el cráter se clava al suelo visual muestreado por punto de impacto).

## Base bleed y cohete auxiliar RAP (P-PRO.4)

Dos mecanismos reales de alcance extendido, seleccionables como munición en los
obuses L39 (M777 y M109A7):

- **Base bleed (M795E-BB)** — un generador de gas rellena la depresión del
  culote mientras quema. Se modela como un único factor sobre el arrastre:
  `Cd_efectivo = dragFactor·Cd` mientras `t < durationS` (25 s). El
  `dragFactor = 0.5` es un **fit agregado**, no el reparto físico exacto: el
  base drag es ~25-35% del Cd total en supersónico, y el resto del factor
  absorbe la mejora de forma del casco BB frente al mismo casco sin BB. Con él,
  el MISMO proyectil gana ~24% de alcance al activar el BB (banda publicada:
  M795 22.5 km → M795E-BB 28.5 km ≈ +27%). Límites: el factor no depende de
  Mach ni de la altitud (el quemado real se degrada con el spin y la presión),
  y el corte a los 25 s es seco en vez de progresivo.
- **RAP (M549A1)** — cohete auxiliar como el motor existente pero con
  `motor.ignitionDelayS`: el empuje va de `ignitionDelay` a
  `ignitionDelay + burnTime` (7 s + 3 s con ~12 kN·s), encendiendo en la fase
  ascendente como el M549 real. El guiado que arranca "tras burnout" usa el fin
  REAL del quemado (`ignitionDelay + burnTime`). Con `ignitionDelay = 0` la
  integración es **bit a bit** la del motor clásico (paridad C++ intacta).

BCs calibrados con `tools/calibrate_bc.ts --only m795bb m549rap` (ambos desde
el L39 del M109): M795E-BB → 4.67 (~28.5 km), M549A1 → 3.43 (~30 km). Tests en
`fidelity.test.ts`: ganancia BB on/off en 20-35%, paridad exacta con delay 0 y
efecto medible con delay 7 s, bandas ±20% de ambas variantes.

## Guiado terminal Pro-Nav (P1.5)

Municiones con `guidance.enabled` y objetivo asignado aplican **navegación
proporcional**: `a = N·(Ω_los × v)` con `Ω_los = (r × v_rel)/|r|²`, solo componente
lateral, saturada a `maxLateralG`. Se activa **tras el burnout** (más retardo
opcional) y, por defecto, **solo en fase descendente** (`terminalOnly`): un Pro-Nav
apuntado a un objetivo en tierra durante el ascenso picaría antes de tiempo y
arruinaría el arco (los GMLRS reales vuelan un midcourse conformado). Test: GMLRS a
40 km corrige un error de puntería de 200 m a <5 m donde el tiro balístico falla por
>100 m.

## Dispersión Monte-Carlo y CEP (P1.6)

`WeaponSystem.fireDispersed(n, errores, semilla)` perturba V₀ (σ en m/s), la puntería
(σ en milésimas NATO, 6400/circunferencia) y un viento no reportado (σ por eje), con
RNG **determinista** (mulberry32 + Marsaglia polar; nunca `Math.random`). Devuelve
los n impactos, su centro y el **CEP** (mediana del fallo radial respecto al centro).
Tests: CEP monótono con σ_V₀ y reproducibilidad exacta por semilla.

## Elipse de error predicha (P-PRO.6)

La artillería real publica errores probables *a priori*; el simulador los
predice **linealizando sensibilidades medidas**, no con constantes:

- `WeaponSystem.predictDispersion` re-integra con ±δV₀ y ±δQE (diferencias
  centradas: cancelan el término cuadrático cerca del alcance máximo) y dos
  veces más con viento unitario longitudinal/transversal — 7 integraciones en
  total, cabe en el worker a dt 0.01.
- Composición en cuadratura:
  `σ_alcance = √((∂R/∂V₀·σ_V₀)² + (∂R/∂QE·σ_QE)² + (S_wₗ·σ_w)²)` y
  `σ_deriva = √((R·σ_az)² + (S_wₜ·σ_w)²)`.
- En la app, al marcar objetivo se pinta la elipse 1σ (y 2σ más tenue)
  centrada en el impacto previsto y orientada al rumbo, con leyenda
  "PER ±X m / ±Y m". Usa las MISMAS σ que la salva dispersa (0.3% V₀, 1 mil,
  viento 0.6 m/s), así los cráteres de la salva caen mayoritariamente dentro
  de la 2σ pintada.
- Validación honesta: test que compara la predicción contra las desviaciones
  muestrales de `fireDispersed` con n = 200 y semilla fija — coincide a ±30%
  en ambos ejes. Límite: la linealización ignora términos cruzados y la
  asimetría corto/largo del alcance (visible con σ mucho mayores).

## MRSI (P2.2)

`solveMRSI` recorre cargas (de mayor a menor v₀) y ramas alta/baja, valida que cada
rama realmente encierra el alcance pedido (el C++ original bisecaba sin comprobar el
cruce y podía devolver soluciones falsas), descarta TOFs a <0.5 s de otro ya elegido
y devuelve `(carga, elevación, TOF, retardo)` con retardos que igualan el instante de
impacto. Test: 3 rondas del M777 a 8 km impactan dentro de 0.2 s.

## Tablas de tiro (P4.3)

`FiringTables.ts` barre la envolvente una sola vez, biseca cada fila dentro de su
tramo (≈40× menos integraciones que resolver fila a fila) y emite CSV:
alcance → QE baja/alta, TOF, velocidad de impacto y deriva (spin+Coriolis+viento).
CLI: `npm run firing-table -- <arma> <carga> <paso_m>`.

## Audio posicional y silbido terminal (P-VIVO.1)

Todo el cálculo escalar del paisaje sonoro vive en `vfx/audioMath.ts` (puro, con
test); `AudioBoom` solo aplica los números a su grafo WebAudio (voces →
`StereoPannerNode` → `masterGain` → `DynamicsCompressorNode` → salida):

- **Retardo físico**: `t = distancia / a(h)` con la velocidad del sonido real de
  la atmósfera del servicio (suelo de 200 m/s y mínimo de 10 ms para el
  scheduler). A 3 km el boom llega ~9 s tarde.
- **Pan estéreo**: `pan = sin(acimut_evento − heading_cámara)`. Un impacto a tu
  derecha suena a la derecha y al orbitar la cámara el paisaje gira contigo.
  *Límite honesto*: con dos altavoces no hay delante/detrás — un evento a la
  espalda panea igual que uno de frente (pan 0).
- **Silbido terminal**: el silbido de las bombas es la fase terminal
  SUBSÓNICA — el modelo lo anula por encima de Mach 1 (un GMLRS supersónico
  no silba; los morteros sí) y más allá de 500 m de la cámara; la ganancia
  crece cuadrática al acercarse y la frecuencia central cae de ~1200 Hz
  (M≈1) a ~600 Hz (M≈0.3), el "descenso" clásico. Es un modelo perceptual,
  no aeroacústica: la frecuencia real depende de la geometría del proyectil.

## Ráfagas de armas automáticas (P-VIVO.2)

`ballistics/burst.ts` (puro, con test): timestamps `tᵢ = i·60/rpm` (M240 750 rpm,
M2 550 rpm ≈ 9 disparos/s), 1 trazadora cada `tracerEvery = 5` balas y **rebufo**
por bala como gaussiana de σ = 2.5 mils en acimut y elevación con el MISMO
mulberry32 determinista de la dispersión (semilla por ráfaga: ráfaga
reproducible). Cada bala se integra completa en el worker contra el corredor
muestreado UNA vez por ráfaga (el rebufo mueve el rumbo ±0.15°, dentro de la
banda 2D). Tope de 24 proyectiles simultáneos en vuelo (FIFO silencioso). La
trazadora es solo VFX (línea aditiva que se consume a los ~3.5 s); la letalidad
no se simula.

## Superficies: agua y rebotes rasantes (P-VIVO.4)

- **Clasificación de superficie**: un impacto es AGUA si la altura muestreada
  del terreno en el punto es **< 0.5 m** — el océano es 0 exacto tanto en
  Cesium World Terrain como en el DEM Copernicus GLO-90. LIMITACIÓN HONESTA:
  **lagos y ríos interiores NO se detectan** (están por encima de 0 m), y sin
  fuente real de alturas (modo OSM sin edificios) no se clasifica nada. El
  agua responde como agua: columna + anillos + spray, boom ahogado
  (lowpass ~110 Hz, ataque blando) y NI cráter NI quemadura.
- **Rebote rasante** (`ballistics/ricochet.ts`, puro y testeado): SOLO
  municiones sin explosivo (armas ligeras) y SOLO sobre agua — en tierra nada
  cambia. Si el ángulo de caída respecto al PLANO LOCAL (normal por
  diferencias finitas sobre 3 muestras) es < 12°, la bala rebota con
  `p = 1 − ángulo/12°` (RNG determinista mulberry32 sembrado por disparo):
  reflexión especular con restitución 0.55 tangencial / 0.3 normal (la
  energía SIEMPRE decrece) y desvío aleatorio ±3° girando alrededor de la
  normal. El tramo restante se **RE-INTEGRA en el worker** (op
  `solveFromState`) contra el mismo corredor, hasta 2 rebotes. Umbrales
  elegidos del orden de los datos empíricos clásicos de rebote sobre agua
  (ángulo crítico ~7-15° según forma y velocidad); es un modelo de una sola
  constante, no hidrodinámica.

## Impacto contra los edificios 3D (P-VIVO.5)

Los Photorealistic 3D Tiles siguen SIN existir para la integración — esto es
un **recorte de presentación** (`BuildingHit.ts`): al empezar cada vuelo se
pre-muestrea la cola de la trayectoria (últimos ~2 km, cada ~15 m) contra el
suelo VISUAL (`scene.sampleHeightMostDetailed`, un lote) y contra el terreno
del corredor (alturas RELATIVAS a la batería: el dátum DEM-MSL vs
teselas-elipsoidales se cancela). El primer punto de vuelo por debajo del
visual con `visual − terreno > 3 m` es EDIFICIO: la reproducción se corta ahí
(bola de fuego + humo, sin cráter) y el fallo del reto usa el punto recortado.
Muestreo incompleto o sin tileset = comportamiento clásico. En ráfaga solo se
muestrean las trazadoras (1/5): coste GPU.

## Bengala ILLUM y cortina SMOKE (P-VIVO.8)

- **ILLUM**: espoleta de tiempo forzada (TOF del preview − 0.5 s); al detonar no
  hay explosión — se despliega una bengala cuya cinemática es PURA y testeada
  (`vfx/flare.ts`): desciende bajo paracaídas a **4.5 m/s** y deriva integrando
  el viento REAL de la altitud que va cruzando (perfil inyectado, paso 0.25 s),
  con ~50 s de vida y fundido final. *Truco documentado*: la `PointLight` de
  Three NO ilumina el globo de Cesium (pipelines de materiales separados) —
  ilumina los objetos Three (cañón, camión, cráteres) y el suelo se "vende"
  con un disco de luz falso (sprite aditivo suave que sigue a la bengala).
- **SMOKE**: al impactar, sin explosión ni cráter: cortina de nubes persistentes
  (~90 s, re-alimentadas cada ~7 s) en línea perpendicular al rumbo de llegada
  que deriva con el viento de superficie (la relajación exponencial del
  PuffCloud hacia el viento local). El bloqueo de visión es VISUAL — no hay
  lógica de oclusión para la IA porque no hay IA.
- Ambas municiones vuelan con la aerodinámica de su clase (BC G7/G1 similares a
  la HE del calibre); el `payload` solo cambia la presentación al detonar.

## Blanco móvil y tiro predicho (P-VIVO.7)

`MovingTarget.ts`: propagación PURA con rumbo y velocidad constantes
(`positionAt(t)`, testeada), re-anclaje sin teleporte al salirse del anillo
jugable y altura del camino interpolada sobre muestras pre-consultadas por
delante (cascada DEM/terreno, lotes de 3 km cada 40 m). El **fantasma de
adelanto** es la posición extrapolada al TOF del preview vigente: apuntarle
acierta si el TOF no cambia al re-apuntar — iterar 2-3 veces converge, que es
exactamente la lección del tiro predicho (`lead = v·TOF`).

## Paridad con el núcleo C++ (P-WEB.1)

Con las funciones nuevas desactivadas (su valor por defecto) la integración TS es
aritméticamente idéntica a la C++ (los `number` de JS son IEEE-754 double). La suite
`validation.test.ts` replica el arnés C++ con los mismos umbrales y añade
comparación directa contra valores de referencia impresos por el C++ con 10 cifras
(vacío, alcances, viento, dirección de tiro, muestras ISA) con tolerancia ±0.1 % —
en la práctica coincide a ~1e-12.
