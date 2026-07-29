# Audio y animación — modelos, aproximaciones y límites

Este documento cubre la capa de **presentación sonora y mecánica**, igual que
[`FISICA_WEB.md`](FISICA_WEB.md) cubre la balística. Nada de lo que hay aquí
toca la trayectoria: la física sigue siendo autoritativa y se resuelve una sola
vez por tiro. Todo es procedural — cero assets binarios (síntesis WebAudio y
geometría Three generada en código).

Archivos: [`web/src/vfx/AudioEngine.ts`](../web/src/vfx/AudioEngine.ts),
[`web/src/GunModel.ts`](../web/src/GunModel.ts),
[`web/src/render/ProjectileModel.ts`](../web/src/render/ProjectileModel.ts),
[`web/src/vfx/effects.ts`](../web/src/vfx/effects.ts).

---

## 1. Audio — propagación

### 1.1 Retardo acústico

`t = d / a(h)`, con `a(h)` la velocidad del sonido de la atmósfera del servicio
(no una constante). Ves el fogonazo y el estampido llega después: a 3 km, ~9 s.
Ya estaba en la versión anterior y se conserva tal cual.

### 1.2 Absorción atmosférica (nuevo)

El aire se come los agudos mucho antes que los graves. Se usa la aproximación
cuadrática clásica

```
α(f) ≈ 1e-9 · f²   [dB/m]
```

(a 20 °C y ~50 % HR: ~1.6 dB/100 m a 4 kHz, ~0.1 dB/100 m a 1 kHz; el orden de
magnitud es correcto para las frecuencias que importan aquí). El motor coloca un
lowpass de un polo en la frecuencia donde la absorción acumulada llega a 12 dB:

```
f_c = √(12 / (1e-9 · d)) = √(1.2e10 / d)
```

| distancia | f_c |
|---|---|
| 100 m | 11 kHz |
| 1 km | 3.5 kHz |
| 5 km | 1.5 kHz |
| 20 km | 775 Hz |

**Por eso lo lejano retumba y lo cercano restalla.** Es la diferencia audible
más grande respecto de la versión anterior, que aplicaba un lowpass fijo por
tipo de sonido.

**Límites:** un polo, no la curva ISO 9613-2 completa; no depende de humedad ni
temperatura (la ISO sí); ignora la refracción por gradiente térmico y viento,
que en la realidad crea zonas de sombra acústica.

### 1.3 Atenuación geométrica

Un frente esférico cae como `1/d`, pero con `1/d` puro una detonación de 200 kg
de TNT a 10 km sería inaudible, y no lo es. Se usa

```
gain = (260 / max(35, d))^0.75 · energía
```

El exponente 0.75 en vez de 1 es una **licencia deliberada** que comprime el
rango dinámico (equivale a un compresor de programa): sin él, el 95 % de los
disparos del simulador serían inaudibles o ensordecedores.

### 1.4 Reverberación

Dos convoluciones con impulsos sintéticos generados en el arranque:

- **cerca** — 0.9 s, decaimiento rápido, poco oscurecida: reflexión inmediata.
- **lejos** — 4.5 s, cola larga y oscura: el eco rodando por el valle.

La mezcla se interpola con la distancia (`far = d / 4000`, saturado): de cerca
domina el impacto seco; a 4 km o más, la cola. Los impulsos son ruido con
envolvente `(1-t)^decay` filtrado por un polo que se cierra a lo largo de la
cola y modulado por huecos aleatorios (reflexiones discretas, no una pared).

**Límites:** no hay trazado de rayos ni geometría del terreno; el valle es
genérico. Un impacto en llanura suena igual que en un desfiladero.

### 1.5 Panorámica

`pan = clamp(dot(û_fuente, derecha_cámara), -1, 1) · 0.85`, con los ejes de la
cámara de Cesium pasados a ENU (`ThreeOverlay.audioCueFor`). Si la fuente queda
a la espalda (`dot(û, adelante) < -0.1`) se aplica un high-shelf de −7 dB a
2.2 kHz: la aproximación más barata al filtrado de la cabeza.

**Límites:** panorámica estéreo, no HRTF; sin elevación (una explosión encima
suena como una a ras de suelo).

### 1.6 Limitador

`DynamicsCompressorNode` a −8 dB, ratio 16:1, ataque 2 ms. Una salva MRSI de 12
rondas no satura ni produce el chasquido de recorte digital.

---

## 2. Audio — voces

Todas se construyen con tres bloques: ráfagas de ruido filtrado con envolvente
percusiva (`burst`), osciladores con caída de tono (`thump`) y bancos de ruido
pregenerados en tres colores (blanco, rosa −3 dB/oct, marrón −6 dB/oct).

| voz | composición |
|---|---|
| `muzzle` | transitorio blanco HP 1.4 kHz (6 ms) + cuerpo rosa con barrido LP 1.1 kHz→120 Hz (550 ms) + sub 72→28 Hz + retumbo marrón de 0.8–4.2 s según distancia |
| `muzzleSmall` | casi todo transitorio: crack blanco de 35 ms + formante rosa + sub corto. Un fusil **no** es un cañón pequeño |
| `impact` | fractura brillante + bola de fuego (barrido más lento cuanto mayor el yield) + sub 58/∛y → 18 Hz + escombros granulares + cola de 1.4–6.5 s |
| `crack` | **onda N** real: dos frentes separados por `L/v` (≈2 ms para un 155 mm, ≈0.3 ms para una bala), no un chasquido genérico |
| `whistle` | silbido del proyectil entrante: ruido por dos bandpass resonantes con **Doppler** `f = f₀·c/(c−v)` que se desploma al pasar; se programa para morir justo cuando llega el estampido del impacto |
| `servo` | motor de puntería: sierra + cuadrada + ruido por un lowpass resonante; tono y ganancia siguen la velocidad angular REAL del arma |
| `mech` | culata abriendo (chirrido + tope), culata cerrando (golpe + campana de acero), bandeja de carga (raspado + tope), casquillo (3–5 tintineos que decaen), clic |

El tono de cada voz escala con el calibre (`∛(0.155/d)`): el 203 mm del 2S7 baja
casi una octava respecto del 155 mm, y una .50 sube.

El silbido solo se programa si **el oyente está en la zona de impacto**
(<1200 m del punto de caída): es lo que oye quien lo recibe, no quien dispara.

**Volumen y silencio** se guardan en `localStorage` y se restauran al recargar;
`M` silencia. El contexto se desbloquea con cualquier gesto (Fuego o el propio
control de volumen).

---

## 3. Animación del arma (`GunModel`)

### 3.1 Servos de puntería

El arma ya no se teletransporta a la orden del panel. Cada categoría tiene
velocidades propias y una rampa de aceleración/frenada; el controlador frena a
tiempo usando la distancia de parada `v²/2a`:

| arma | traverse | elevación |
|---|---|---|
| Torreta motorizada (M109) | 13 º/s | 6 º/s |
| Cureña a manivela (M777, 2S7) | 5 º/s | 4 º/s |
| Mortero | 4 º/s | 5 º/s |
| Lanzacohetes / TEL | 6–10 º/s | 4–7 º/s |
| Arma ligera (a pulso) | 120 º/s | 90 º/s |

Al disparar, `fireRecoil()` **encaja** la puntería en la orden: la física ya voló
desde ahí, así que el modelo no puede quedarse a mitad de camino.

`slewRateDegS` alimenta el zumbido del servo en el audio.

### 3.2 Retroceso en dos fases

- **Culatazo** (~75 ms): `1-(1-x)²` — aceleración brusca que frena contra el
  freno hidroneumático.
- **Contra-retroceso** (~0.45 s + 0.9·calibre): coseno suavizado; el recuperador
  devuelve el tubo mucho más despacio de lo que se fue.
- **Llegada a batería**: rebote amortiguado de 160 ms contra el tope, con su
  golpe metálico.

El recorrido escala con el calibre (`3.6·d`, saturado en 0.35–0.85 m); un 155 mm
retrocede ~0.56 m en pantalla. La suspensión se hunde ~5.5 cm y el casco cabecea
~0.9º mientras dura.

### 3.3 Ciclo de carga

Escalado al `reloadTime` real del arma (8 s en el M777, 0.12 s en una M240):

```
0.08·T  culata abre  → sale el humo del ánima, salta el casquillo
0.45·T  atacador mete el proyectil en la recámara
0.78·T  culata cierra
```

Cada paso emite un evento (`onMech`) que el audio sonoriza con su cue espacial.
La cuña de culata baja de verdad, la bandeja de carga entra con su proyectil y
se retira.

### 3.4 Otros

- **Casquillos** (armas ligeras): parábola con `g` real, rebote con restitución
  0.35, giro propio y vida de 6 s. Geometría y material compartidos.
- **Munición visible**: los 6 cohetes del pod se ven asomar por las bocas y
  desaparecen al dispararse; la tapa del canister del misil salta. Ambos vuelven
  cuando pasa el tiempo de recarga.
- **Bípode del mortero**: el collar abraza el tubo y sube con la elevación; las
  patas, con el pie clavado, se reorientan y se estiran solas (cilindro unitario
  + cuaternión + escala: sin recrear geometría por frame).

---

## 4. Animación del proyectil (`ProjectileModel`)

### 4.1 Siluetas

Generadas por revolución, con la forma real de su familia:

- **shell** — ojiva **tangente** calculada de verdad (radio `ρ = (R²+L²)/2R`, el
  arco que empalma sin quiebro con el cuerpo), cuerpo cilíndrico, banda de
  forzamiento de cobre y culote en barco. Espoleta en punta.
- **mortarBomb** — cuerpo lagrimal, vástago de cola y seis aletas.
- **rocket / missile** — cuerpo esbelto, tobera acampanada, cuatro aletas de
  cola plegadas sobre el cuerpo y canards de gobierno.
- **bullet** — spitzer con culote troncocónico, camisa de latón y punta gris.

### 4.2 Giro

La velocidad de giro sale del paso del estriado: `ω = 2πv/(twist·d)`. Un 155 mm
a 684 m/s con estriado 1/20 gira a **221 rev/s**.

A 60 fps eso es 23 radianes por frame: aliasing puro — se vería quieto o girando
al revés. Se pinta con **compresión logarítmica**:

```
ω_visual = clamp(3.2 · log₁₀(1 + ω_real), 0, 26)   [rad/s]
```

Sigue siendo monótona en `ω_real` (un proyectil que gira más rápido se ve girar
más rápido) pero cabe en el ancho de banda del monitor. **Es una licencia
declarada, no una medida.** Los proyectiles de aletas no giran.

### 4.3 Yaw of repose

El proyectil sale del tubo con unos grados de guiñada que la estabilidad
giroscópica amortigua. Se pinta como una precesión cónica de 3.2º (spin) o 5.5º
(aletas) con decaimiento `e^(-t/1.2 s)` a ~4 Hz. **Cualitativa**: no sale de la
integración 6-DOF (que no se hace), pero el gesto y los tiempos son los reales.

### 4.4 Otros

- **Aletas** de cohete: envolviendo el cuerpo al salir, abiertas en 0.25 s con
  suavizado sin rebote.
- **Tobera**: brilla y proyecta luz mientras el motor quema, respetando el
  retardo de ignición de los RAP.
- **Nariz incandescente**: por encima de Mach 3.5 el morro pasa de rojo cereza a
  blanco (`heat = (M−3.5)/4.5`). Es una **rampa cromática arbitraria**, no un
  cálculo de calentamiento aerodinámico.
- **Escala de lectura**: un proyectil de 0.86 m a 10 km es medio píxel. La malla
  se agranda linealmente con la distancia (`d/250`, entre ×1 y ×45). **Nunca
  encoge por debajo del tamaño real**: de cerca se ve a escala.

---

## 5. VFX

- **Fogonazo en tres fases**: destello primario blanco (~25 ms), **pluma
  direccional** de gases por el ánima —con los dos lóbulos laterales del freno
  de boca cuando el arma lo tiene— y fogonazo secundario naranja al arder los
  gases al aire (~100–260 ms).
- **Frente de sobrepresión**: esfera que se expande como `t^0.6` (el frente
  decelera tras la fase fuerte) con intensidad cayendo como `(1-t)²`.
- **Escombros y chispas**: parábola con `g = 9.80665` plena, sin arrastre de
  viento (un fragmento no lo lleva la brisa), rebote en el suelo con restitución
  0.32 y **enfriamiento cromático** de blanco incandescente a rojo oscuro. El
  número y la velocidad de eyección escalan con `yield^(1/3)` y con la velocidad
  de impacto.
- **Bola de fuego** que asciende por flotabilidad y se enfría de blanco a rojo
  sucio mientras crece.
- **Humo de boca** en dos poblaciones: el chorro que sale disparado por el ánima
  y la bola que envuelve la boca y tarda en irse. Ambas derivan con el viento
  real del servicio y escalan con la densidad del aire.
- **Polvo del suelo** levantado por la onda que rebota bajo la boca.
- **Humo del ánima** que sale despacio al abrir la culata, segundos después.

Los sprites salen de **dos pools** (normal para humo/polvo, aditivo para
chispas/brasas). Separarlos evita recompilar shaders al cambiar el blending de
un material reutilizado, que era el coste oculto de mezclarlos en uno solo.

### Nota de calibración visual

El humo de boca se pintaba antes en gris casi blanco con opacidad baja: sobre
cielo claro era **literalmente invisible** aunque el sistema de partículas
funcionase (se verificó con el overlay `?stats=1`, que contaba decenas de
sprites vivos, y pintándolos de rojo). Los valores actuales (gris medio
`0x6f757c`, opacidad 0.6) son los que se leen sobre cielo y sobre terreno sin
tapar la vista en cámara de cabina.

---

## 6. Cámara

- **Patada de disparo**: sacudida proporcional a `energía·260/distancia` (nula
  a más de unos cientos de metros) y, si estás a menos de 120 m, una apertura de
  FOV de hasta 6º que se cierra en ~0.35 s.
- **Sacudida con rotación**: además de trasladar, ahora da un tirón angular
  (hasta ~0.6º de cabeceo y ~0.35º de alabeo). Todo lo aplicado se **deshace al
  principio del frame siguiente** con los ejes exactos que se usaron, así que en
  modo Libre la cámara del usuario queda donde la dejó: antes la sacudida se
  acumulaba.
- **Cabina reencuadrada**: el ojo va desplazado a la izquierda del tubo, en el
  puesto del apuntador. Mirando por el eje del ánima solo se veía el tubo
  ocupando la pantalla entera.

---

## 7. Sala de armas (`/armory.html`)

Página aparte que monta **solo la capa Three**: sin globo, sin física, sin red.
Sirve para ver de cerca cada arma y su ciclo mecánico completo, comparar las
siluetas de los proyectiles a escala (la rejilla es de 1 m) y disparar las voces
del audio a mano y a distintas distancias. Es la herramienta con la que se
ajustan las proporciones: en el globo, un obús a 1.3 km es un palito.
