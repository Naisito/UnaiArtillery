# Guía de configuración — Importar el mundo real a Unreal Engine 5

Pasos exactos para transmitir topografía real mundial al motor usando **Cesium for
Unreal**. Dos rutas de datos: (A) **Cesium World Terrain + imagen satelital** (relieve
global gratis) y (B) **Google Photorealistic 3D Tiles** (fotogrametría 3D, máximo
realismo). Puedes usar ambas.

---

## 0. Requisitos previos

- **Unreal Engine 5.4** instalado (Epic Games Launcher).
- Cuenta gratuita en **Cesium ion** → https://ion.cesium.com  (da un *access token*).
- (Opcional, ruta B) **Google Maps Platform API key** con "Map Tiles API" habilitada.
- El proyecto de este repo (`UnaiArtillery.uproject`) ya declara el plugin
  `CesiumForUnreal` en su lista de plugins.

---

## 1. Instalar el plugin Cesium for Unreal

1. Epic Games Launcher → **Marketplace** → busca **"Cesium for Unreal"** → *Install to
   Engine* (5.4). Es **gratis**.
2. Abre `UnaiArtillery.uproject`. Si pregunta por recompilar módulos, acepta.
3. `Edit → Plugins` → verifica que **Cesium for Unreal**, **Niagara** y
   **Enhanced Input** están habilitados (ya lo están en el `.uproject`). Reinicia si se
   pide.

---

## 2. Conectar tu token de Cesium ion

1. Menú superior: **Cesium** → abre el panel *Cesium*.
2. `Cesium → Sign in to Cesium ion` (o pega el token en
   `Project Settings → Plugins → Cesium → Default ion Access Token`).
3. Deja el token en Project Settings para que las builds empaquetadas lo lleven.

---

## 3. Ruta A — Cesium World Terrain + imagen satelital (relieve global)

En el panel **Cesium** (*Quick Add Cesium ion Assets*):

1. Pulsa **"Cesium World Terrain + Bing Maps Aerial imagery"** → *Add*.
   - Esto crea en el nivel un actor **`Cesium3DTileset`** (el globo) y un
     **`CesiumGeoreference`** (ancla geográfica).
2. Selecciona el `CesiumGeoreference` y fija tu **zona de operaciones** (Origin):
   - `Origin Latitude`, `Origin Longitude`, `Origin Height` = coordenadas de tu campo
     de tiro (p. ej. lat 40.0, lon −3.7 para Madrid).
   - `Origin Placement = Cartographic Origin`. Esto sitúa el **origen ENU** del mundo
     Unreal en ese punto: casa **exactamente** con la convención del núcleo balístico
     (x=Este, y=Norte, z=Arriba, en metros → cm).
3. Añade una **`DirectionalLight`** (sol), **`SkyAtmosphere`** y **`SkyLight`** para que
   **Lumen** ilumine el terreno de forma realista.

> Colisión: el `Cesium3DTileset` genere colisión de malla para que el raycast de
> impacto funcione. En el detalle del tileset:
> `Create Physics Meshes = true` y `Collision Preset = BlockAll` (canal `WorldStatic`).
> Es lo que consulta `UBallisticsWorldSubsystem::QueryTerrainHeightMeters`.

---

## 4. Ruta B — Google Photorealistic 3D Tiles (fotogrametría real)

Para el máximo "efecto guau" (ciudades y relieve fotogramétricos):

1. Panel **Cesium** → **"Blank 3D Tiles Tileset"** → *Add* (o reutiliza el tileset).
2. En el `Cesium3DTileset`:
   - `Source = From Cesium ion` **o** `From Url`.
   - Para Google directo: `Source = From Url`,
     `Url = https://tile.googleapis.com/v1/3dtiles/root.json?key=TU_API_KEY`.
   - (Alternativa: añade Google Photorealistic 3D Tiles como *asset* dentro de tu cuenta
     Cesium ion y selecciónalo por `ion Asset ID`.)
3. Mantén el **mismo `CesiumGeoreference`** que en la ruta A para que todo comparta el
   origen ENU.

> Nota de licencia: el uso de Google Photorealistic 3D Tiles requiere cumplir los
> términos de Google Maps Platform (atribución en pantalla incluida).

---

## 5. Alinear el núcleo balístico con el georreferenciado

El núcleo trabaja en **ENU metros** anclado en el origen de `CesiumGeoreference`. El
*bridge* (`UnaiBallisticsBridge.h`) convierte:

- `EnuToUE(Este, Norte, Arriba)` = `FVector(E, N, U) * 100`  (m → cm)
- Ejes: **Este→X, Norte→Y, Arriba→Z**.

Por tanto **el origen del `CesiumGeoreference` debe ser la posición de la batería** (o
un punto de referencia cercano). Si la batería está lejos del origen, sigue funcionando:
el subsistema usa la posición *world* real de la boca del cañón (`MuzzlePoint`) y de los
objetivos; el origen ENU solo debe estar en la región para minimizar el error de la
proyección tangente-plana en alcances muy grandes (>100 km).

Ajusta la latitud para **Coriolis**:
`UBallisticsWorldSubsystem → BatteryLatitudeDeg = Origin Latitude`.

---

## 6. Escena mínima jugable (checklist)

1. `Cesium3DTileset` (terreno) + `CesiumGeoreference` (origen = batería) ✔
2. `DirectionalLight` + `SkyAtmosphere` + `SkyLight` + **Exponential Height Fog** ✔
3. `PostProcessVolume` (Unbound) con **Lumen GI + Reflections** y **Bloom** alto (para
   fogonazos cegadores) ✔
4. Coloca un **`AArtilleryPiece`** (Blueprint derivado) sobre el terreno; asigna
   `ProjectileClass`, y en el Blueprint del proyectil los sistemas Niagara
   (`ImpactExplosionFX`, `TrailFX`, `ShockRefractionFX`). ✔
5. Coloca un **`ACinematicCameraDirector`** y ponlo como *view target*. ✔
6. En el `GameMode`/nivel: al iniciar, llama a
   `UBallisticsWorldSubsystem::SetSteadyWind()` y `SetSeaLevelConditions()` con la
   meteorología deseada. ✔

---

## 7. Rendimiento y calidad

- **Nanite** está activo por defecto para la geometría estática; las teselas de Cesium
  se benefician del *virtualized geometry*.
- Sube `Maximum Screen Space Error` del tileset para más detalle (más VRAM) o bájalo
  para más rendimiento.
- Para las capturas/tráilers: **Movie Render Queue** + Sequencer, con el
  `ACinematicCameraDirector` en modo *FollowShell* y `TimeDilation < 1` en el proyectil
  para la cámara lenta.

---

## 8. Empaquetado (build de escritorio premium)

1. `Project Settings → Packaging`: incluye el token de Cesium ion (paso 2).
2. Plataforma **Windows**, configuración **Shipping**.
3. `Platforms → Windows → Package Project`.
4. Verifica conexión a internet en el equipo destino: los 3D Tiles se **transmiten**;
   para escenarios sin conexión, usa `Cesium → Export` / *tileset offline* de la región.
