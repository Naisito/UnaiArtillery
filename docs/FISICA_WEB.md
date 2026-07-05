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
  alcance máximo publicado de cada arma (`web/tools/calibrate_bc.ts`):
  mortero G1 BC 1.65 · M107/M777 G7 BC 3.69 · GMLRS G7 BC 7.67 · misil G7 BC 11.56.
  Los factores de forma resultantes quedan en 0.3–1.5 (test de plausibilidad).
- La curva explícita `Cd(Mach)` original sigue disponible (`dragModel:'explicit'` y
  variante `'legacy'` del catálogo), que es la configuración de paridad con C++.

## Atmósfera y viento (P1.7)

ISA de dos capas (troposfera con gradiente 6.5 K/km + capa isoterma 11-20 km) con
temperatura y presión a nivel del mar ajustables. El viento es un campo
`(posición, t) → vector`; además del viento constante con ganancia por altitud, se
acepta un **perfil por altitud** `{altitud → (velocidad, rumbo)}` interpolado
(velocidad lineal, rumbo por el arco más corto), cargable de CSV
(`altitude_m,speed_ms,from_bearing_deg`). Ejemplo con cizalladura en
`web/public/data/wind_shear_example.csv`.

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

## Paridad con el núcleo C++ (P-WEB.1)

Con las funciones nuevas desactivadas (su valor por defecto) la integración TS es
aritméticamente idéntica a la C++ (los `number` de JS son IEEE-754 double). La suite
`validation.test.ts` replica el arnés C++ con los mismos umbrales y añade
comparación directa contra valores de referencia impresos por el C++ con 10 cifras
(vacío, alcances, viento, dirección de tiro, muestras ISA) con tolerancia ±0.1 % —
en la práctica coincide a ~1e-12.
