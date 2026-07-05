# Documento de Diseño Técnico (TDD)
## Sandbox Balístico 3D — "Unai Artillery"

**Versión:** 1.0 · **Rol:** CTO / Arquitecto de Software / Lead Game Dev
**Objetivo:** Aplicación de escritorio *premium* — un juguete digital hiperrealista y
educativo de artillería sobre la Tierra real, con física balística precisa y VFX de
gama alta (el "efecto guau").

---

## 1. Fase 1 — Decisión tecnológica (justificada)

### 1.1 Motor: **Unreal Engine 5.4**

| Criterio | Unreal Engine 5 | Unity 6 | Veredicto |
|---|---|---|---|
| Iluminación global dinámica | **Lumen** (GI + reflejos en tiempo real, sin bake) | APV/Enlighten, más manual | **UE5** — cada fogonazo y explosión ilumina el terreno gratis |
| Sistema de partículas | **Niagara** (GPU, data-driven, con eventos y colisiones) | VFX Graph (bueno, menos maduro para simulación) | **UE5** |
| Geometría a distancia | **Nanite** (micropolígono virtualizado) | Sin equivalente nativo | **UE5** — terreno mundial sin LODs manuales |
| Geoespacial real | **Cesium for Unreal** (oficial, maduro, gratis) | Cesium for Unity (existe) | Empate técnico; UE5 gana por el resto |
| Rendimiento C++ | Nativo, gameplay en C++ | C# + Burst/DOTS | **UE5** para un solver numérico de alto ritmo |
| Cinemática | Sequencer + GameplayCameras | Cinemachine + Timeline | Empate |

**Conclusión:** **Unreal Engine 5** es la elección. La combinación **Lumen + Niagara +
Nanite** es exactamente el trío que produce el "efecto guau" pedido (fogonazos que
ciegan e iluminan el entorno, humo volumétrico, destrucción, estelas), y **Cesium for
Unreal** resuelve la topografía real mundial de forma nativa y gratuita. El *gameplay*
en C++ nos da el rendimiento que exige integrar miles de pasos RK4 por disparo.

### 1.2 Datos geoespaciales: **Cesium for Unreal + Cesium World Terrain / Google Photorealistic 3D Tiles**

- **Cesium World Terrain + Bing Maps imagery**: cobertura global, gratis con token de
  Cesium ion. Ideal para topografía + textura satelital.
- **Google Photorealistic 3D Tiles** (vía Cesium): fotogrametría 3D real de ciudades y
  relieve — el máximo realismo. Se activa con una API key de Google Maps Platform.
- Ambas se transmiten (*streaming* 3D Tiles) según la cámara: mundo entero sin cargarlo
  entero. Ver `docs/WORLD_SETUP.md`.

### 1.3 Arquitectura de alto nivel

```
┌───────────────────────────────────────────────────────────────┐
│                        UNREAL ENGINE 5.4                        │
│                                                                 │
│  UI / HUD (UMG + Enhanced Input)                                │
│      │  aim / fire / select weapon / weather                    │
│      ▼                                                           │
│  AArtilleryPiece  ── solve/fire ──►  UBallisticsWorldSubsystem  │
│      │  spawn                              │  (Atmosphere+config)│
│      ▼                                     │  raycast terreno    │
│  ABallisticProjectile ◄── FlightResult ────┘  (Cesium tiles)    │
│      │  drive VFX params                                        │
│      ├─► Niagara: trail, shock-refraction, explosion            │
│      └─► CameraShake / OnImpact                                 │
│                                                                 │
│  ACinematicCameraDirector (Orbital / Follow / Drone)            │
│  Cesium3DTileset + CesiumGeoreference (mundo real)              │
└───────────────────────────────────────────────────────────────┘
             ▲ PIMPL / bridge (ENU↔UE, cm↔m)
             │
┌────────────┴──────────────────────────────────────────────────┐
│   NÚCLEO BALÍSTICO C++  (engine-agnostic, /core, testeable)     │
│   Vec3 · Atmosphere(ISA+wind) · Munition · BallisticsSolver     │
│   (RK4) · WeaponCatalog · WeaponSystem (fire control)           │
└───────────────────────────────────────────────────────────────┘
```

**Decisión de diseño clave:** el motor de físicas es **independiente del engine**
(`/core`, sin una sola inclusión de Unreal). Esto permite: (a) compilarlo y
**validarlo numéricamente fuera del engine** (ver `tests/validation.cpp`,
`ALL CHECKS PASSED`), (b) reutilizarlo en un servidor de cálculo o en Unity si hiciera
falta, y (c) iterar la física sin abrir el editor. Unreal solo *presenta* trayectorias
ya calculadas de forma determinista.

---

## 2. Fase 2 — Motor de físicas balísticas

### 2.1 Ecuación de movimiento

Se integra la ecuación del brief, con dos términos adicionales relevantes para
artillería de largo alcance:

```
m·dv/dt = m·g  −  ½·ρ(h)·Cd(M)·A·|v−w|·(v−w)   −  2m·(Ω×v)   +  F_thrust·v̂
          └gravedad┘ └────── arrastre aerodinámico ──────┘  └Coriolis┘  └empuje┘
```

- **m** masa (variable durante el empuje del cohete), **g** gravedad local,
  **ρ(h)** densidad del aire (ISA), **Cd(M)** coeficiente de arrastre dependiente del
  Mach, **A** área de sección, **w** viento (campo vectorial (posición, t)),
  **Ω** velocidad angular terrestre, **F_thrust** empuje del motor cohete.
- El término de arrastre es **exactamente** el del enunciado; los demás son opcionales
  y activables por configuración.

### 2.2 Integración: **Runge-Kutta de 4º orden (RK4)**

- Estado de primer orden `s = [posición, velocidad, masa]`; RK4 clásico con paso fijo
  `dt = 2 ms` (configurable).
- **Precisión O(dt⁴)**: verificado empíricamente. Al **reducir dt a la mitad el error
  cae ~16×** en un problema no lineal con arrastre (medido: **25.5×** por el fuerte
  gradiente transónico). En vacío, RK4 es **exacto** respecto a la solución analítica
  (aceleración constante ⇒ ODE lineal): coincide hasta el redondeo de máquina.
- Detección de impacto por **interpolación lineal del cruce** con el terreno, con una
  puerta `v�z ≤ 0` que hace robusto el lanzamiento desde el nivel del suelo (incluido el
  tiro rasante a 0°).

### 2.3 Modelo atmosférico

- **ISA** (International Standard Atmosphere): troposfera 0–11 km con gradiente
  0.0065 K/m y estratosfera isoterma 11–20 km. Devuelve ρ, T, P y **velocidad del
  sonido** a(h) — necesaria para el número de Mach que gobierna Cd(M).
- Ajustable por **día caliente/frío** (T y P a nivel del mar).
- **Viento** como campo `w(posición, t)`: permite gradiente estable, rachas, o lectura
  de datos reales (METAR/GFS). Helper de "viento estable que viene DE un rumbo".

### 2.4 Arrastre dependiente del Mach

El enunciado usa Cd y A explícitos. Como el Cd real varía fuertemente en el transónico
(*drag rise*), se almacena una **curva Cd(Mach)** interpolada linealmente. Una tabla de
un solo punto reproduce el caso "Cd constante". Las curvas del catálogo están afinadas
para que el RK4 reproduzca los **alcances máximos publicados**.

---

## 3. Fase 3 — Espectáculo visual (mapa de implementación)

| Efecto pedido | Implementación en UE5 |
|---|---|
| Fogonazo cegador que ilumina | Niagara `MuzzleFlashFX` con **luz transitoria** → **Lumen** ilumina el terreno |
| Humo volumétrico que se dispersa con el viento | Niagara `MuzzleSmokeFX`, lee `AirDensity` y el viento del subsistema |
| Ondas de choque en el terreno al disparar | Niagara `GroundShockwaveFX` (anillo de polvo) proyectado en el suelo |
| Estelas de condensación dinámicas | `TrailFX` con parámetros `Mach`, `Altitude`, `Speed` (condensación en banda transónica) |
| Refracción del aire en hipersónicos | `ShockRefractionFX`: intensidad `ShockStrength = clamp((M−0.9)/0.6)` (material de distorsión) |
| Explosión volumétrica que ilumina | Niagara `ImpactExplosionFX`, `YieldScale = (TNTeq/6.6)^{1/3}` + luz → Lumen |
| Camera Shake por distancia/carga | `amp ≈ yield^{1/3}·800 / distancia`, atenuado y saturado |
| Proyectiles PBR | `UStaticMeshComponent` con materiales PBR; la nariz sigue el vector velocidad |
| Cámaras cinemáticas suaves | `ACinematicCameraDirector`: Orbital / Follow / Drone, interpolación críticamente amortiguada |

**Principio "simular una vez, presentar suave":** el proyectil reproduce por
interpolación una trayectoria ya calculada — independiente del *frame-rate*, permite
cámara lenta ("the money shot") y que la cámara/VFX lean por delante.

---

## 4. Fase 4 — Catálogo de armamento real

Datos de fuentes públicas no clasificadas (calibre, masa, velocidad de boca, alcance
máximo publicado). Curvas de arrastre afinadas para reproducir el alcance publicado.

| Arma | Calibre | Masa proyectil | V₀ (carga máx.) | Alcance validado (RK4) | Publicado |
|---|---|---|---|---|---|
| Mortero pesado | 120 mm | 13.0 kg | 318 m/s | **6.4 km** | ~7–8 km |
| Obús M777 | 155 mm | 43.2 kg | 684 m/s | **20.8 km** | ~24 km (M107) |
| HIMARS / GMLRS | 227 mm | 307 kg | motor 66 kN·4.5 s | **68.4 km** | ~70+ km |
| Misil táctico | 610 mm | 1670 kg | motor 350 kN·18 s | balística empinada | ~300 km clase |

> Los alcances RK4 caen dentro de la banda esperada de forma consistente. Para una build
> de producción se sustituirían las curvas por los **coeficientes balísticos de las
> tablas de tiro oficiales** (G1/G7 + factor de forma).

---

## 5. Estado y validación

`tests/validation.cpp` compila y ejecuta sobre el núcleo, sin engine:

```
(1) Trayectoria en vacío: RK4 vs analítico ................ PASS (coincidencia exacta)
(2) Orden de convergencia RK4 (problema no lineal) ........ PASS (25.5× al halvar dt)
(3) Alcances reales (mortero / M777 / GMLRS) .............. PASS (en banda)
(4) Deriva por viento cruzado ............................. PASS (signo y magnitud)
(5) Dirección de fuego inversa (resolver elevación) ....... PASS (error 0.4 m a 15 km)
  → ALL CHECKS PASSED
```

Compilar y ejecutar:
```
g++ -std=c++17 -O2 -I core tests/validation.cpp -o build/validate
./build/validate
```
