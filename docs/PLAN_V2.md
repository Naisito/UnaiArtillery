# Unai Artillery V2 — Plan maestro del rediseño

> Rama de integración: `v2/rediseno` (sale de `main` @ 314584a).
> Ejecución multiagente en paralelo; cada agente trabaja en su propio git
> worktree y rama, y la integración final la hace el orquestador.

## 0. Visión

Convertir el simulador en un producto que parezca y se sienta de **100 000 $**:
una *estación de dirección de tiro* moderna sobre la Tierra real, fiel a la
realidad en física, simbología, terminología y modelos, y **comprensible** para
alguien que la abre por primera vez.

Cuatro ejes (los pedidos por el cliente):

1. **Rendimiento y realismo** — física a estándar OTAN (STANAG 4355,
   punto-masa modificado), datos de armas auditados, solver más rápido (sin
   asignaciones en el bucle caliente, paso adaptativo, pool de workers),
   render más eficiente y escena de Cesium de calidad cinematográfica.
2. **Interfaz** — rediseño completo: flujo de *misión de fuego* guiado
   (Arma → Objetivo → Solución → Fuego), jerarquía visual clara, sistema de
   diseño propio (tokens, iconos SVG, tipografías), sin emojis, unidades
   reales (milésimas OTAN 6400 + grados), ayuda contextual.
3. **Modelos 3D** — plataformas detalladas a escala real (M777, M109A7, 2S7,
   M120, M270, HIMARS, armas ligeras), proyectiles reconocibles y blancos;
   renderizados **dentro de Cesium** (glTF generado en runtime): iluminación
   solar real, sombras sobre el terreno y oclusión correcta con el relieve.
4. **Interacción con el mapa** — lectura de coordenadas (lat/lon, MGRS,
   cota, demora y distancia) bajo el cursor, menú contextual, simbología
   APP-6, abanico de tiro, herramienta de medición con perfil y línea de
   visión, capas base (satélite/topográfico/oscuro), rejilla MGRS, brújula y
   controles de navegación, atajos de teclado.

## 1. Diagnóstico de partida (resumen)

- Cesium (globo) + overlay Three.js en un **canvas aparte**: los objetos
  Three no se ocultan tras el relieve, no reciben la luz del sol de Cesium ni
  proyectan sombras. El arma se ve como cajas y cilindros.
- UI: paneles genéricos con emojis, sin flujo ni jerarquía; tutorial que tapa
  media pantalla; la cámara inicial no enseña el arma; azimut/elevación solo
  en grados; sin coordenadas, sin simbología, sin menú contextual.
- Física muy completa (RK4, G1/G7 + BC, ISA-76, Coriolis, deriva por giro,
  Magnus simplificado, Tierra esférica, guiado PN, base bleed, RAP, espoletas,
  dispersión, rebotes, tablas de tiro, meteo real), pero: modelo de deriva
  simplificado (no MPM), σ de dispersión fijas (no dependen del alcance),
  `Vec3` inmutable que asigna en cada operación del bucle RK4, un único worker.
- Base sana: 143 tests verdes, `tsc` limpio, E2E Playwright.

## 2. Organización

### Fases

| Fase | Quién | Qué |
|---|---|---|
| 0 | Orquestador | Rama, contratos compartidos (este doc, `src/models/rig.ts` + `kit.ts` + registro + stubs, `src/theme/tokens.css`, `src/render/quality.ts`), Model Lab, `tools/shot.mjs`, `window.__ua`, `E2E_PORT`, dependencias (fuentes, `mgrs`). |
| 1 | 8 agentes en paralelo | Ver §4. Cada uno en su worktree/rama, con propiedad de archivos exclusiva. |
| 2 | Orquestador | Merge de las 8 ramas en `v2/rediseno`, cableado en `main.ts`, tests + E2E + capturas. |
| 3 | Agentes de QA | Revisión visual/UX con capturas, revisión de código (bugs), arreglos, documentación. |

### Propiedad de archivos (fase 1)

Un archivo = un dueño. Si necesitas cambiar algo que no es tuyo, **no lo
cambies**: anótalo en tu informe (sección *Integración*) y el orquestador lo
hará en la fase 2. Excepción: `src/main.ts`, donde los agentes no-UI pueden
hacer cambios **mínimos y delimitados** con marcas
`// === V2:<AGENTE> ... === fin V2:<AGENTE>` para facilitar el merge.

| Agente | Rama | Puertos (dev / e2e) | Archivos propios |
|---|---|---|---|
| **UI** | `v2/ui` | 5201 / 4201 | `index.html`, `src/style.css`, `src/theme/**`, `src/ui/**`, `src/main.ts` (dueño), `e2e/**`, `README.md` (sección de uso) |
| **MAP** | `v2/map` | 5202 / 4202 | `src/map/**` (nuevo), `src/TrajectoryPreview.ts`, `src/CameraDirector.ts` |
| **PHYS** | `v2/phys` | 5203 / 4203 | `src/ballistics/**`, `src/BallisticsService.ts`, `src/ballistics.worker.ts`, `src/dem.ts`, `src/frame.ts`, `src/BuildingHit.ts`, `tools/calibrate_bc.ts`, `tools/firing_table.ts`, `docs/FISICA_WEB.md` |
| **VFX** | `v2/vfx` | 5204 / 4204 | `src/vfx/**`, `src/render/**`, `src/viewer.ts`, `src/ProjectilePresenter.ts` (salvo la creación de la malla del proyectil) |
| **3D-CORE** | `v2/3d-core` | 5205 / 4205 | `src/GunModel.ts`, `src/MovingTarget.ts`, `src/models/kit.ts`, `src/models/rig.ts`, `src/models/lab.ts`, `src/models/runtime/**`, `src/models/props/**`, `src/models/platforms/m777.ts`, `src/models/platforms/_placeholder.ts`, `src/models/platforms/index.ts`, `model-lab.html` |
| **3D-TRACKED** | `v2/3d-tracked` | 5206 / 4206 | `src/models/platforms/{mortarM120,m109a7,pion2s7,m270}.ts`, `src/models/parts/tracks.ts` (+ otros `parts/*` que cree) |
| **3D-WHEELED** | `v2/3d-wheeled` | 5207 / 4207 | `src/models/platforms/himars.ts`, `src/models/targets.ts`, `src/models/parts/trucks.ts` (+ otros `parts/*` que cree) |
| **3D-SMALL** | `v2/3d-small` | 5208 / 4208 | `src/models/platforms/smallArms.ts`, `src/models/projectiles.ts`, la función de creación de malla en `src/ProjectilePresenter.ts` (solo ese hunk) |

Nombres de `parts/*`: prefijo por agente si hay riesgo de choque
(`parts/tracks.ts` es de 3D-TRACKED, `parts/trucks.ts` de 3D-WHEELED; otros
nuevos: `parts/<agente>-<nombre>.ts`).

### Reglas comunes

1. **Arranque del worktree**: `cd web && npm ci` (o `npm install` si falla) y
   `cp C:/Users/Unai/Documents/UnaiArtillery/web/.env web/.env` (tokens de
   Cesium ion/Google; NUNCA se commitea).
2. **Puertos**: usa SOLO los tuyos. Dev: `npx vite --port <dev> --strictPort`.
   E2E: `E2E_PORT=<e2e> npx playwright test` (tras `npm run build`).
3. **Verificación visual obligatoria**: `node tools/shot.mjs --url ... --out ...`
   (Cesium tarda ~20 s en swiftshader; usa `--ready __uaReady --wait 15000`).
   `window.__ua` expone `viewer, service, piece, gun, panel, director, ...`
   para preparar escenas con `--eval`. Model Lab: `/model-lab.html?model=m777&sheet=1&muzzle=1`
   con `--ready __labReady --wait 500`. MIRA tus capturas (Read) y itera.
4. **Calidad**: `npx tsc --noEmit` limpio y `npx vitest run` verde antes de
   cada commit relevante. No borres tests; si un test documenta un
   comportamiento que cambias a propósito, actualízalo y justifícalo.
5. **Idioma**: textos de UI y comentarios en **español** (como el código
   existente); identificadores en inglés/español como el código vecino.
6. **Commits** frecuentes en TU rama (`git add -A && git commit`), mensajes en
   español. No hagas push, no toques `main` ni otras ramas.
7. **Informe final** en `docs/v2/REPORT_<AGENTE>.md`: qué se hizo, decisiones,
   API nueva/cambiada, **cambios de integración pendientes** (exactos), riesgos
   conocidos. Hasta 6 capturas finales en `docs/v2/shots/<agente>/` (PNG).
8. **Sin dependencias nuevas** salvo necesidad real (y entonces dilo en el
   informe): ya están instaladas `@fontsource-variable/inter`,
   `@fontsource-variable/jetbrains-mono`, `@fontsource/barlow-condensed`,
   `mgrs`.
9. **Nada de GitHub Actions/CI** (decisión del proyecto). Verificación local.

## 3. Contratos compartidos

### 3.1 Tokens de diseño — `src/theme/tokens.css`
Variables `--ua-*` (colores, tipografía, espaciado, radios, sombras, capas,
distribución). La UI ajusta valores, nadie renombra. Fuentes: Inter (UI),
JetBrains Mono (números), Barlow Condensed (rótulos/display).

**Distribución de pantalla (escritorio ≥ 1280 px):**
- Barra superior: alto `--ua-topbar-h` (UI).
- Dock izquierdo (misión de fuego): ancho `--ua-left-dock-w` (UI).
- Dock derecho (pestañas: Meteo / Tabla / Análisis / Instrucción): ancho
  `--ua-right-dock-w`, plegable → la UI actualiza la variable (0 o ancho del
  riel) en `:root`.
- Franja inferior del área de mapa, alto `--ua-statusbar-h`: **MAP**
  (coordenadas bajo el cursor, escala, créditos Cesium). La UI no pone nada
  ahí; su telemetría de vuelo va encima.
- Clúster de navegación (brújula, zoom, inclinación, capas, ir a batería/
  objetivo): **MAP**, arriba-derecha del área de mapa
  (`right: calc(var(--ua-right-dock-w) + 2*var(--ua-gutter))`,
  `top: calc(var(--ua-topbar-h) + var(--ua-gutter))`).
- Capas z: `--ua-z-*`.

### 3.2 Modelos 3D — `src/models/rig.ts` + `kit.ts`
Espacio de modelado: metros, **X derecha, Y adelante, Z arriba**, origen en el
suelo bajo el eje de azimut. Jerarquía `root ⊇ traverse ⊇ elevation ⊇ recoil`;
el runtime escribe `traverse.rotation.z = −az`, `elevation.rotation.x = +el`,
`recoil.position.y = −retroceso`. `muzzleLocal` en coordenadas de `recoil`.
Solo `MeshStandardMaterial` (se exporta a glTF y lo pinta Cesium). Sin
escalas negativas, sin `InstancedMesh`, sin líneas/sprites en los rigs.
Presupuesto: plataformas ≤ 80k triángulos, armas ligeras ≤ 30k,
proyectiles ≤ 3k. Registro: `src/models/platforms/index.ts` (no tocar salvo
3D-CORE).

Plataformas: `mortar-m120` (mortar120), `m777` (m777, excalibur),
`m109a7` (m109), `2s7-pion` (pion2s7), `m270-mlrs` (m26 con LPC de cohetes;
tacticalMissile = **ATACMS** con pods de misil), `m142-himars` (gmlrs, ergmlrs
con LPC de 6; prsm con pod de 2 PrSM), `pistol`, `rifle`, `m240`, `m2`.
El builder recibe `ctx.weaponId` para elegir la variante.

### 3.3 Calidad gráfica — `src/render/quality.ts`
`QualityLevel = 'low'|'medium'|'high'|'ultra'`, `applyQuality`, `getQuality`,
`onQualityChanged`. La UI lo expone en Ajustes; VFX lo implementa.

### 3.4 Interacción con el mapa — `src/map/MapInteraction.ts` (MAP)
```ts
export type PickMode = 'none' | 'target' | 'battery' | 'measure';
export interface MapHost {
  viewer: Cesium.Viewer;
  service: BallisticsService;       // frame, approxMaxRange, sampleLineProfile…
  weapon(): Weapon;                 // arma vigente (alcances, traverse)
  chargeIndex(): number;
  aim(): { azimuthDeg: number; elevationDeg: number };
  target(): Vec3 | null;            // ENU
  pickLocked(): boolean;            // reto en curso: sin designación libre
  actions: {
    setTarget(enu: Vec3): void;               // → piece.aimAt
    moveBattery(lonDeg: number, latDeg: number): void;
    flyToBattery(): void;
    flyToTarget(): void;
  };
}
export class MapInteraction {
  constructor(host: MapHost);
  readonly pickMode: PickMode;
  setPickMode(mode: PickMode): void;
  onPickModeChanged?: (mode: PickMode) => void;
  /** Batería/arma/carga/objetivo/meteo cambiaron: redibuja abanico y símbolos. */
  refresh(): void;
  dispose(): void;
}
```
La UI llama a `setPickMode` desde sus botones; mientras MAP no esté
integrado, la UI conserva la lógica de picking actual de `main.ts`
encapsulada en una función `setPickMode(mode)` para que el cambio sea trivial.

### 3.5 Atajos de teclado (globales; ignorados con foco en inputs)
- **UI**: `F` FUEGO (mantener en automáticas) · `H` rama alta/baja ·
  `←/→` azimut ±1 mil (Shift ±0.1, Ctrl ±10) · `↑/↓` elevación ídem ·
  `?` ayuda/atajos · `Esc` cerrar modal.
- **MAP**: `T` designar objetivo · `B` mover batería · `M` medir ·
  `G` rejilla MGRS · `L` capas · `N` norte arriba · `Inicio` ir a la batería ·
  `1`–`6` cámaras (Libre, Órbita, Seguir, Dron, Artillero, 1ª persona) ·
  `Esc` cancelar modo/menú.
- En 1ª persona (pointer lock) WASD/Espacio/C son del modo FPS.

### 3.6 Unidades
Milésimas OTAN (6400 ‹mil› = 360°) como unidad principal de azimut/
elevación, con grados como secundaria (ajuste de usuario para invertirlo).
Distancias en m/km, coordenadas lat/lon + MGRS.

## 4. Encargos por agente (resumen; el detalle va en su prompt)

- **UI** — Sistema de diseño completo y nueva distribución: barra superior
  (marca, estado de misión, coordenadas MGRS de la batería, resumen meteo,
  reloj, día/noche, audio, ajustes, ayuda), dock izquierdo de *Misión de
  fuego* por pasos (arma con tarjeta y galería "Arsenal", munición/espoleta/
  carga, objetivo, solución con números grandes en mil y grados, FUEGO y
  acciones de salva), dock derecho con pestañas (Meteo, Tabla de tiro,
  Análisis, Instrucción), telemetría de vuelo rediseñada, instrumentos de
  puntería, HUD de artillero, toasts, tutorial nuevo, pantalla de carga,
  modal de ajustes (unidades, calidad, audio, sesión), atajos, responsive.
  Conservar TODAS las funciones existentes. E2E actualizados y verdes.
- **MAP** — Contrato §3.4: lectura bajo cursor, menú contextual, simbología
  APP-6 (batería propia, objetivo hostil, observador, impactos), abanico de
  tiro (mín/máx + límites de traverse), arco de trayectoria y marcadores
  rediseñados, medición con perfil del terreno y línea de visión, capas base,
  rejilla MGRS, clúster de navegación, créditos, atajos, mejoras de cámaras
  (vuelos suaves, colisión con el terreno, cámara de impacto cinematográfica).
- **PHYS** — Auditoría de datos de armas con fuentes, modelo STANAG 4355
  (MPM) para proyectiles estabilizados por giro, humedad, peso de proyectil,
  dispersión dependiente del alcance (EP de tablas), rendimiento del solver
  (sin asignaciones, paso adaptativo, pool de workers, cachés) con benchmark
  antes/después; API nueva en `BallisticsService` con defaults compatibles.
- **VFX** — Calidad de escena Cesium (HDR, MSAA/FXAA, SSE del terreno,
  niebla, atmósfera, sombras), preajustes de calidad + rendimiento adaptativo,
  luz de Three sincronizada con el sol de Cesium (y la noche), oclusión de
  los objetos Three tras el relieve, VFX realistas (rebufo de boca con polvo,
  lanzamiento de cohete con estela persistente, explosión con bola de fuego →
  columna de humo, polvo del color del terreno, onda de choque, metralla),
  audio más realista, cero asignaciones por frame.
- **3D-CORE** — Pipeline Three → glTF → `Cesium.Model` con articulación por
  nodos, `GunModel` sobre el nuevo runtime (misma API pública + `setFrame`),
  camión del reto móvil vía el mismo runtime, kit con texturas PBR
  procedurales (pintura con desgaste, metal, goma, lona), M777A2 de detalle,
  atrezo de batería (dotación, munición, cargas, red de camuflaje opcional),
  Model Lab mejorado.
- **3D-TRACKED** — Mortero M120, M109A7 Paladin, 2S7 Pion, M270A1 (pods M26
  y ATACMS), tren de rodaje de cadenas reutilizable.
- **3D-WHEELED** — M142 HIMARS (FMTV 6×6, módulo lanzador, pods GMLRS/ER/
  PrSM), camión hostil Ural-4320 (reto móvil) y blanco BTR-82A.
- **3D-SMALL** — Pistola, fusil, M240 con trípode M192, M2 con trípode M3, y
  todos los proyectiles (M107/M795, Excalibur, OF-43, bomba de mortero,
  M31/M26, ATACMS, PrSM, balas) + enganche en `ProjectilePresenter`.

## 5. Criterios de aceptación globales

- `npx tsc --noEmit` limpio, `npx vitest run` verde, E2E verdes.
- Ninguna función existente perdida (lista en el prompt de la UI).
- La app arranca sin errores de consola nuevos, con y sin token de ion.
- Capturas finales que demuestren cada eje.
- Rendimiento: frame-time igual o mejor que la base en la escena de arranque
  y durante una salva (medido con `?stats=1`).
