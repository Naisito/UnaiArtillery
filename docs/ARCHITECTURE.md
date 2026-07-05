# Arquitectura y estructura de clases

Cómo se comunican los sistemas (UI, Físicas, Cámara, Efectos). El sistema está
dividido en dos capas: un **núcleo de física independiente del motor** (`/core`) y una
**capa de presentación Unreal** (`/Source/UnaiArtillery`). Solo el archivo *bridge*
conoce ambas.

---

## 1. Capas y frontera

```
UI (UMG/Enhanced Input)
        │  llamadas Blueprint
        ▼
CAPA UNREAL  ── habla FVector, cm, world-space ────────────────┐
   AArtilleryPiece, ABallisticProjectile,                       │
   ACinematicCameraDirector, UBallisticsWorldSubsystem          │
        │                                                       │
   UnaiBallisticsBridge.h  (ENU↔UE, m↔cm, USTRUCT mirrors)  ◄───┘  ÚNICA frontera
        ▼
NÚCLEO C++  ── habla Vec3, metros, ENU, sin Unreal ────────────┐
   BallisticsSolver (RK4), Atmosphere, Munition,                │
   WeaponCatalog, WeaponSystem                                  │
        └─ compilable y testeable en aislamiento ───────────────┘
```

**Regla de oro:** los headers de `/core` **nunca** incluyen Unreal, y solo
`BallisticsWorldSubsystem.cpp` incluye `/core` (tras un PIMPL). Así el núcleo se
compila y valida sin el editor.

---

## 2. Módulos del núcleo (`/core`)

| Archivo | Responsabilidad | Puntos clave |
|---|---|---|
| `Vec3.h` | Vector 3D doble precisión | Convención ENU: x=Este, y=Norte, z=Arriba |
| `Atmosphere.h` | ISA + velocidad del sonido + campo de viento | `sample(h)→{ρ,T,P,a}`; `windField(pos,t)` |
| `Munition.h` | Descripción física de un proyectil | Curva `Cd(Mach)` interpolada; motor cohete opcional |
| `BallisticsSolver.h` | **Integrador RK4** de la ecuación de movimiento | Estado `[pos,vel,masa]`; gravedad, arrastre, Coriolis, empuje; detección de impacto con terreno |
| `WeaponCatalog.h` | Datos de armas reales | Mortero 120, M777, HIMARS/GMLRS, misil táctico; zonas de carga |
| `WeaponSystem.h` | **Dirección de fuego** | `launchVelocity()`, `fire()`, `solveForRange()` (bisección sobre el solver) |

### Flujo de un disparo dentro del núcleo
```
FireOrder(azimut, elevación, carga)
   → WeaponSystem::muzzleVelocity()  (elige V₀ según carga)
   → WeaponSystem::launchVelocity()  (vector velocidad ENU)
   → BallisticsSolver::integrate()   (RK4 hasta impacto)
   → FlightResult { path[], impactPoint, TOF, apex, downrange, ... }
```

### Dirección de fuego inversa (problema no cerrado con arrastre)
`WeaponSystem::solveForRange()` barre la elevación para trazar la curva
alcance-vs-elevación, localiza el máximo (~45°) y **bisecta** la rama pedida
(ángulo bajo = tiro tenso, ángulo alto = tiro curvo tipo mortero) hasta caer a <0.5 m
del objetivo. Verificado: error 0.4 m a 15 km.

---

## 3. Módulos de la capa Unreal (`/Source/UnaiArtillery`)

### `UBallisticsWorldSubsystem` (servicio global)
`UWorldSubsystem` — vive lo que vive el mundo, accesible desde cualquier actor.
Posee la `Atmosphere`, la configuración del solver y el **raycast al terreno Cesium**.

- `SolveTrajectory(arma, muzzle, azimut, elevación, carga) → FUnaiFlightResult`
- `SolveElevationForTarget(...)` — dirección de fuego inversa
- `SetSteadyWind()`, `SetSeaLevelConditions()` — meteorología en vivo
- `QueryTerrainHeightMeters()` — `LineTraceSingleByChannel` hacia abajo contra las
  teselas de Cesium (topografía real).

### `AArtilleryPiece` (controlador del arma en el mundo)
Un actor = un cañón. Estado de puntería + firma de lanzamiento.
- `AimAtTarget(objetivo, altoÁngulo)` → pide elevación al subsistema
- `PreviewTrajectory()` → arco de puntería para el HUD
- `Fire()` → resuelve trayectoria, **spawnea** `ABallisticProjectile`, reproduce
  `PlayLaunchFX()` (fogonazo + humo volumétrico + onda de choque).

### `ABallisticProjectile` (presentador de una trayectoria)
Recibe una `FUnaiFlightResult` ya calculada y la **reproduce por interpolación** en el
tiempo (independiente del frame-rate; soporta cámara lenta).
- Cada tick: `EvaluatePath(t)` (búsqueda binaria + lerp) → posición/velocidad/Mach
- Empuja parámetros a Niagara: `TrailFX(Mach, Altitude, Speed)`,
  `ShockRefractionFX(ShockStrength)`
- Al impactar: explosión escalada por carga, **camera shake atenuado por distancia**,
  delegado `OnImpact`.

### `ACinematicCameraDirector` (cámaras)
Tres modos con interpolación **críticamente amortiguada** (`alpha = 1−e^{−k·dt}`,
estable e independiente del frame-rate):
- **Orbital** — órbita perezosa alrededor de un foco
- **FollowShell** — persigue el proyectil, encuadra por delante para hipersónicos
- **TacticalDrone** — vista de reconocimiento cenital sobre la zona de impacto

---

## 4. Diagrama de secuencia — "disparar a un objetivo"

```
Usuario        AArtilleryPiece      UBallisticsWorldSubsystem     ABallisticProjectile     Niagara/Camera
  │  click objetivo  │                        │                          │                     │
  ├─ AimAtTarget ───►│                        │                          │                     │
  │                  ├─ SolveElevationForTarget►│  (RK4 + bisección)      │                     │
  │                  │◄──── elevación ─────────┤                          │                     │
  │  click fuego     │                        │                          │                     │
  ├─ Fire ──────────►│                        │                          │                     │
  │                  ├─ SolveTrajectory ──────►│  (RK4 → FlightResult)    │                     │
  │                  │◄──── FUnaiFlightResult ─┤                          │                     │
  │                  ├─ SpawnActor + Launch ───┼─────────────────────────►│                     │
  │                  ├─ PlayLaunchFX ──────────┼──────────────────────────┼───► flash/smoke/shock
  │                  │                        │        cada tick:         ├─► TrailFX/Refraction►│
  │                  │                        │                          ├─ HandleImpact ──────►│ explosión + shake
  │                  │◄───────────────────────┴──── OnImpact ────────────┤                     │
```

---

## 5. Extensibilidad

- **Nueva arma:** añadir un método en `WeaponCatalog` y una entrada en `EUnaiWeaponId`.
- **Nueva meteorología:** sustituir `Atmosphere::windField` (p. ej. datos GFS reales).
- **Cálculo asíncrono:** el núcleo es puro y ligero en asignaciones → `SolveTrajectory`
  puede moverse a un `AsyncTask` para ráfagas de muchos disparos simultáneos.
- **Terreno real:** cualquier fuente con colisión de mundo (Cesium, Landscape) funciona
  con el mismo `QueryTerrainHeightMeters`.
