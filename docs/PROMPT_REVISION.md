# Prompt de revisión — física, coherencia y usabilidad

> Pégalo tal cual en una sesión nueva dentro de este repo. Está escrito para
> ejecutarse de una vez, pero cada bloque (A–E) es independiente: si prefieres
> ir por partes, di **"solo el bloque A"** y el resto se ignora.

---

Eres un ingeniero de simulación con experiencia en balística exterior y en
herramientas de instrucción. Este repo es **Unai Artillery**, un simulador de
artillería educativo sobre la Tierra real: núcleo de física en TypeScript
(`web/src/ballistics/`, porte 1:1 de un núcleo C++ validado en `core/`),
presentación con CesiumJS (globo) + Three.js (proyectiles y VFX).

**Antes de tocar nada**, ponte al día leyendo, en este orden:
`README.md` · `docs/FISICA_WEB.md` · `docs/AUDIO_Y_ANIMACION.md` ·
`docs/MEJORAS_4A_OLA.md` (backlog vigente) · `web/README.md`.

Arranque y verificación:

```bash
cd web
npm install
npm test          # 87 tests de Vitest: validación física + paridad C++ ±0.1 %
npm run build     # tsc --noEmit estricto + bundle
npm run e2e       # 4 specs de Playwright contra el build (chromium headless)
npm run dev       # app en :5173 · /armory.html es el banco de pruebas de modelos
npm run capture   # exporta PNG + MP4 de los modelos a ../capturas/
```

## Reglas de la casa (heredadas por todo lo que hagas)

1. **Cero assets binarios.** Todo procedural: geometría Three, síntesis
   WebAudio, canvas, CSS. Nada de `.mp3` / `.png` / `.glb`.
2. **Paridad C++ intacta.** Cualquier parámetro nuevo del solver lleva un
   default neutro que deja `validation.test.ts` bit a bit idéntico. Si un
   cambio altera un número validado, se justifica y se actualiza el test **en
   el mismo commit**, explicando por qué el valor nuevo es el correcto.
3. **La suite crece con el código.** La lógica nueva va en funciones puras
   testeables con Vitest (entorno node, sin DOM); las superficies de UI que
   aporten valor se blindan en Playwright. Sin CI, a propósito.
4. **Degradación amable.** Sin red, sin token de Cesium, sin clave de Google y
   sin WebAudio la app sigue funcionando y avisa con un toast.
5. **Documentar aproximaciones.** Todo modelo físico nuevo o revisado se
   documenta en `docs/FISICA_WEB.md` **con sus límites**, como los existentes.
6. **Honestidad por encima de la estética.** Si un número no se puede
   defender, se dice en la documentación y en la UI, no se maquilla.

---

# BLOQUE A — Auditoría de la física

El objetivo **no** es "que salgan los alcances publicados": eso ya pasa por
construcción y ahí está el problema. Los coeficientes balísticos se
**calibraron contra este mismo solver** (`web/tools/calibrate_bc.ts`) para
reproducir el alcance máximo de catálogo, así que el alcance no es evidencia
independiente de nada. Lo que hay que auditar es si el **resto** de la solución
es coherente.

## A.1 · Factores de forma: dos hallazgos que hay que resolver

`Munition.formFactor()` devuelve `i = SD / BC`, la relación entre el arrastre
del proyectil y el del cuerpo de referencia G1/G7. Un `i` sano ronda 0.6–1.2.
Estado actual del catálogo (calculado con el propio código):

| arma | modelo | BC | **i** | veredicto |
|---|---|---|---|---|
| mortar120 | G1 | 1.65 | 0.778 | ok |
| **m777** | G7 | 3.69 | **0.693** | ok |
| **m109** | G7 | 5.13 | **0.499** | ⚠ mismo proyectil que el M777 |
| pion2s7 | G7 | 4.58 | 0.829 | ok |
| **excalibur** | G7 | 25.00 | **0.114** | ⚠⚠ imposible |
| gmlrs | G7 | 7.67 | 1.105 | ok |
| m26 | G7 | 9.94 | 0.850 | ok |
| ergmlrs | G7 | 12.53 | 0.727 | ok |
| tacticalMissile | G7 | 11.56 | 0.552 | límite |
| prsm | G7 | 14.02 | 0.768 | ok |
| pistol9 / rifle556 / mg762 / m2browning | — | publicados | 0.97–1.17 | ok |

Que las cuatro armas ligeras salgan en 1.0 ± 0.17 **valida el método**: cuando
el BC está medido de verdad, `i` sale donde debe. Los dos casos marcados no.

1. **M777 vs M109 disparan el MISMO proyectil M107** (43.2 kg, 155 mm, misma
   v0 de 684 m/s, ambos L39) y sin embargo llevan BC 3.69 y 5.13: un 39 % de
   diferencia de arrastre para el mismo cuerpo volando en el mismo aire. Uno de
   los dos está compensando otra cosa. Averigua cuál y por qué (mira el
   histórico y los rangos objetivo de la calibración), y **unifica el
   proyectil**: si el M109 alcanza más, que sea por el arma (elevación máxima
   75° vs 71.7°, cargas), no por un proyectil clonado con menos arrastre.
2. **Excalibur con `i = 0.114`** significa "nueve veces menos arrastre que el
   cuerpo de referencia". Está documentado como que el BC absorbe el planeo con
   canards, pero un número así envenena todo lo demás: el ángulo de caída, la
   velocidad de impacto y el TOF salen mal aunque el alcance cuadre. Evalúa las
   opciones y ejecuta la que defiendas: (a) modelar una sustentación explícita
   (L/D pequeño durante el planeo) con su knob por defecto apagado y recalibrar
   el BC a un `i` plausible; (b) dejar el fit pero **acotarlo y avisarlo** en la
   UI y en la doc; (c) reclasificar el arma. Justifica la elección.

Añade a `fidelity.test.ts` un test que recorra el catálogo y **falle si algún
`i` sale fuera de una banda defendible**, con las excepciones explícitas y
comentadas. Así este problema no vuelve a colarse.

## A.2 · Validar por lo que NO se calibró

Elige 2–3 armas y compáralas con tablas de tiro públicas en magnitudes que la
calibración no tocó: **TOF, ángulo de caída, velocidad de impacto y deriva**
para 3–4 alcances intermedios (no solo el máximo). Si algo se desvía mucho,
diagnostica: ¿es el modelo de arrastre, la atmósfera, el spin drift? Documenta
el resultado con números, aunque salga mal — un desvío conocido y medido vale
más que un ajuste a ojo.

## A.3 · El salto plano ↔ esférico

`BallisticsService` conmuta a integración ECEF esférica cuando el alcance
supera **50 km** (`ring.maxRangeM > 50_000`, cuatro sitios distintos). Eso hace
que un tiro de 49.9 km y otro de 50.1 km usen modelos diferentes.

Mide la **discontinuidad**: mismo tiro resuelto en los dos modos justo en el
umbral, y cuánto saltan alcance, TOF y punto de impacto. Si el salto es
apreciable, arréglalo (histéresis, umbral más bajo, o siempre esférico si el
coste lo permite — mídelo). Test que fije el criterio, y unifica el umbral en
**una sola constante** en vez de cuatro literales repartidos.

## A.4 · Repasa los términos uno por uno

Para cada uno: ¿está bien implementado, se documenta su límite y hay test?

- **Coriolis** — ¿usa la latitud real de la batería y se actualiza al moverla?
  ¿Está también en modo esférico, y sin doble contabilidad con los términos de
  rotación explícitos? ¿Se modela el término centrífugo o se declara omitido?
- **Spin drift y Magnus** — `spinDriftCoeff = 0.008` es un coeficiente agregado
  sin dinámica de guiñada real (declarado en la doc). Comprueba el signo con
  ambos sentidos de estriado y que la deriva escale como debe con TOF.
- **Base bleed** — un único factor `dragFactor = 0.5` sobre Cd durante 25 s que
  además absorbe la mejora de forma del casco. ¿Sobrevive fuera del punto de
  calibración (cargas bajas, ángulos altos)?
- **Motor cohete y RAP** — masa expulsada linealmente durante el quemado,
  empuje a lo largo de la velocidad. ¿Y el retardo de ignición del M549A1?
- **Pro-Nav** — `terminalOnly` y `activationDelay`. ¿Satura bien en
  `maxLateralG`? ¿Qué pasa si el blanco es inalcanzable: diverge o se rinde?
- **Atmósfera** — ISA-76 más viento por niveles de presión de Open-Meteo. ¿La
  interpolación entre niveles y la extrapolación por encima del último nivel
  son sanas?
- **Integrador** — RK4 de paso fijo. ¿El orden de convergencia sigue saliendo 4
  en el test? ¿`maxFlight: 700` corta silenciosamente algún tiro largo, y si
  pasa se avisa en la UI o se traga?

---

# BLOQUE B — Coherencia entre lo que se ve y lo que pasa

El preview integra con `dt = 0.01` y el disparo real con el paso fino. Si el
arco pintado y el impacto real no coinciden, el usuario aprende algo falso.

- **Mide la diferencia** preview vs disparo real (alcance, TOF, punto de
  impacto) en varias armas y ángulos, incluidas trayectorias largas donde el
  error se acumula. Si es apreciable a la vista, corrígelo: mismo `dt` en
  ambos, o Richardson, o lo que defiendas. Con test.
- **`ProjectilePresenter` funde la boca real del arma con el inicio de la
  trayectoria física durante el primer segundo** (`launchOffset` con `blend`).
  Comprueba que ese apaño no desplace visiblemente el tiro ni cambie el punto
  de impacto, y que a QE alta no haga que el proyectil salga "de lado".
- **La sacudida de cámara ya se deshace cada frame** — verifica que no queda
  deriva acumulada tras 20 disparos en modo Libre.

---

# BLOQUE C — Legibilidad y usabilidad (aquí está lo más flojo)

Estas son carencias detectadas, no hipótesis. Arréglalas por impacto:

1. **No hay control de velocidad de simulación, y hace mucha falta.** Un M777 a
   QE 45° tiene un TOF de **72 s**: disparas y te quedas mirando el cielo más de
   un minuto sin poder hacer nada. Lo único que existe es el bullet-time
   automático, que lo hace *más* lento. Añade un control de escala de tiempo
   (×1 / ×4 / ×16 y "saltar al impacto") que acelere **la reproducción**, nunca
   la integración: la física ya está resuelta antes de que el proyectil salga,
   así que es solo el reloj del presentador. Cuidado con el retardo acústico y
   con el bullet-time, que deben seguir siendo coherentes.
2. **Seis paneles fijos se comen la pantalla.** `controlPanel` (izq-arriba),
   `cockpit` (izq-abajo), `weatherPanel` (der-arriba), `firingTable`
   (der-abajo), `hud` (centro-abajo) y `gunnerHud`. En 1280×720 apenas queda
   globo, y de hecho el spec de Playwright usa 1280×**960** porque a 720 el
   cockpit se solapaba con el panel e interceptaba clics. Haz los paneles
   plegables (con estado recordado), o un modo "solo globo" con una tecla.
   Que sea usable en un portátil normal.
3. **No hay onboarding.** Alguien que abre la app por primera vez ve catorce
   armas, cinco sliders y seis botones de cámara sin saber por dónde empezar.
   Está especificado como **P-VIVO.11** en el backlog.
4. **Los errores no enseñan.** "Objetivo fuera de alcance" es un toast seco:
   di *cuánto* falta y *qué* lo arreglaría ("faltan 3.2 km — prueba carga 8 o
   rama alta"). El simulador es educativo; cada fallo es una oportunidad.
5. **Repasa la app entera con ojos nuevos** y arregla lo que encuentres:
   contraste, tamaños de acierto táctil, teclado, textos que se cortan,
   unidades, números sin unidad, tooltips que mienten. En 1280×720 y en tablet.

---

# BLOQUE D — Objetivo móvil (ojo: **todavía no existe**)

No hay ningún blanco móvil en el código: `MovingTarget.ts` no existe y no hay
nada de convoyes ni de adelanto. Está **especificado** como **P-VIVO.7** en
`docs/MEJORAS_4A_OLA.md`, con el diseño ya pensado. Impleméntalo siguiendo esa
especificación, y presta atención a lo que la hace valiosa:

- El blanco avanza **pegado al relieve real** (pre-muestreo por lotes de la
  cascada DEM/terreno con su caché), y `posición(t)` es una **clase pura con
  test**: avance correcto, altura interpolada, determinista.
- La puntuación se mide contra la posición del blanco **en el instante del
  impacto**, no contra donde estaba al disparar.
- La ayuda didáctica es el **fantasma de adelanto**: el blanco extrapolado al
  TOF del preview vigente. Apuntas al fantasma, el TOF cambia, el fantasma se
  mueve, iteras dos o tres veces y converge — **esa iteración es la lección**.
  Explícalo en un tooltip; sin eso es solo un blanco que se mueve.
- RNG inyectado como en el reto actual (determinista y testeable), récords en
  clave propia, y el vector de velocidad pintado en el minimapa del artillero.

---

# BLOQUE E — Trabajo a medias que hay que cerrar o revertir

En `web/src/ballistics/` hay dos features **funcionando en el solver pero sin
UI ni tests**, commiteadas como WIP (`git log --grep="WIP 4a ola"`):

- **Espoletas (P-VIVO.3)** — `FuzeSpec` con modos `impact` / `time` /
  `proximity` / `delay`; `FlightResult` ya trae `detonation` y `burstHeightM`.
- **V0 efectiva (P-VIVO.9)** — `V0Correction`: temperatura de la carga
  (~0.06 %/°C), desgaste del tubo y sesgo de radar de boca.

Nadie las usa. **Ciérralas**: exponlas en la consola de tiro (la espoleta debe
cambiar de verdad el VFX y el cráter de un airburst; la corrección de V0 debe
verse en la tabla de tiro), con tests de Vitest para ambas, o bien revierte lo
que no vayas a terminar. No las dejes a medias otra vez.

---

# Cómo entregar

1. **Empieza auditando, no tocando.** Antes de cambiar código, entrega un
   **informe** con lo que has medido: números concretos, dónde está el
   problema, cuánto se desvía y qué propones. Si algo que sospecho en este
   prompt resulta estar bien, **dilo y demuéstralo** — no inventes un problema
   para justificar un cambio.
2. Luego ejecuta, **por bloques y en commits separados** con mensaje que
   explique el *por qué*. Rama nueva desde `main`; no commitees en `main`.
3. Cada bloque termina con `npm test`, `npm run build` y `npm run e2e` en
   verde, y con `docs/FISICA_WEB.md` actualizado si tocaste física.
4. Al final, **di explícitamente qué has dejado fuera y por qué**. Un problema
   conocido y documentado vale más que uno tapado.
