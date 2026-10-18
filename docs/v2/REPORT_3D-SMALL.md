# REPORT 3D-SMALL — armas ligeras y proyectiles

> Redactado por el orquestador a partir del informe del agente: a mitad de su
> sesión el control de seguridad del modo automático le bloqueó la shell, así
> que el último tramo (M2, proyectiles, enganche del presentador) quedó sin
> compilar ni commitear. El orquestador lo revisó: `tsc` limpio y capturas de
> los proyectiles en `small-lab.html` correctas (ver `shots/`).

## Archivos
- `src/models/parts/small-util.ts` — `revolve` (perfil con aristas vivas),
  `sideShape`/`planShape` con agujeros, `mergeStatic` (fusiona por material
  sin cruzar pivotes: ~22-24 mallas por arma), `sbox` (caja achaflanada de 44
  tris), `picatinny`, `hexBolt`, `knob`, `stencilMaterial` (rotulado
  CanvasTexture), `beltAlong` (cinta eslabonada).
- `src/models/parts/small-guns.ts` — cuerpos de pistola, M4A1, M240B, M2HB.
- `src/models/parts/small-mounts.ts` — banco + máquina de tiro, trípode de
  fusil, trípode paramétrico M192/M3 con T&E, `makeTripodFollower`, cajas.
- `src/models/platforms/smallArms.ts` — los 4 builders.
- `src/models/projectiles.ts` — `buildProjectile(kit, id, weapon, variant?)`
  (firma original + 4.º parámetro opcional `{ tracer }`), `weaponIdOf`,
  `instantiateProjectile` (caché de prototipos), `projectileMeshNoseZ`.
- `src/models/parts/small-lab.ts` + `web/small-lab.html` — laboratorio propio
  de desarrollo (`?lineup=howitzer|rockets|mortar|bullets|all`); no entra en
  el build.

## Armas ligeras
| Plataforma | Montaje | Triángulos |
|---|---|---|
| pistol | Clase G17/M17 en máquina de tiro tipo Ransom sobre banco (boca ≈1.10 m) | ≈12.7k |
| rifle | M4A1 SOPMOD (M68, PEQ-15, M600) en cuna de trípode (boca ≈1.23 m) | ≈24.5k |
| m240 | M240B + M145, caja de 100 y cinta M13, sobre trípode M192 con T&E | 18.9k |
| m2 | M2HB/M2A1 con asideros de pala y caja M2A1 + cinta M9, sobre trípode M3 con T&E | 23.3k |

Trípodes M192/M3: las patas viven en un nodo `mount` (hijo de `root`) que
sigue al arma con zona muerta ±22° desde `animate`; `updateTE` mueve el
husillo del T&E dentro de sus límites. `extraAnimated = [mount, teUpper]`.
**Requiere que el runtime llame a `animate`** (si no, las patas se quedan
fijas y el arma gira libre).

## Proyectiles (eje +Y, nariz +Y, escala real, código de colores de EE. UU.)
M107 (M739), M795, M795 base bleed, M549A1 RAP, M485 ILLUM, M825 SMOKE,
M982 Excalibur (canards + aletas de base), 3OF43 203 mm, bomba de mortero
120 (HE/ILLUM/WP, aletas, cargas M230, espoleta M734), M26, M31 GMLRS,
ER GMLRS, ATACMS, PrSM, balas 9 mm / M855 / M856 / M80 / M62 / M33 / M17
(trazadoras con culote emisivo). `exhaustLocal` en la tobera de cohetes,
misiles y RAP.

Caché del presentador: un prototipo por (arma, munición, trazadora); las
geometrías quedan fijadas (dispose no-op) y los materiales se clonan por
instancia → las ráfagas no crean geometría por disparo y el dispose del
presentador sigue siendo seguro.

## Hunk de `ProjectilePresenter.ts`
Import `projectileMeshNoseZ` y sustitución del bloque body/nose por
`this.mesh.add(projectileMeshNoseZ(weapon, { tracer: opts.tracer }))`
(envoltorio +90° en X: nariz +Y → +Z). Resto del archivo intacto.

## Problemas conocidos
- A escala real los proyectiles se ven pequeños en la cámara de seguimiento:
  si se quiere, que VFX los escale con la distancia.
- Por encima de ~45° de elevación la culata de la M240 y los asideros de la
  M2 pueden rozar el suelo (los trípodes reales no pasan de ~16°; el
  catálogo permite 60°).
- Pendiente de verificar en la app el enganche (M777, GMLRS, bala M2).
