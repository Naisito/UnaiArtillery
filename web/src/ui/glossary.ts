// ============================================================================
//  glossary.ts — Glosario de dirección de tiro (tooltips de la jerga).
//
//  Cada término técnico de la interfaz lleva `data-gloss="<clave>"`: el
//  gestor de tooltips muestra aquí su definición. Español militar, breve y
//  exacto — la lección cabe en dos líneas.
// ============================================================================

export interface GlossEntry {
  term: string;
  text: string;
}

export const GLOSSARY: Record<string, GlossEntry> = {
  azimut: {
    term: 'Azimut de tiro',
    text: 'Dirección horizontal del tubo medida desde el norte geográfico en sentido horario. En la pieza se materializa como deriva sobre el goniómetro.',
  },
  deriva: {
    term: 'Deriva',
    text: 'Ángulo de puntería en dirección que se marca en el goniómetro de la pieza respecto a su punto de referencia. Aquí trabajamos directamente con el azimut.',
  },
  qe: {
    term: 'Elevación (QE)',
    text: 'Ángulo de cuadrante: inclinación del tubo sobre la horizontal. Junto con la carga decide el alcance.',
  },
  mil: {
    term: 'Milésima OTAN',
    text: '6400 mil = 360°. A 1 km, 1 mil ≈ 1 m de desvío lateral: por eso la artillería corrige en milésimas.',
  },
  carga: {
    term: 'Carga de proyección',
    text: 'Cantidad de propelente. Más carga = más velocidad inicial (V0) y alcance; menos carga permite trayectorias más curvas a corta distancia.',
  },
  v0: {
    term: 'Velocidad inicial (V0)',
    text: 'Velocidad del proyectil en la boca del tubo. Varía con la temperatura del propelente y el desgaste del ánima.',
  },
  espoleta: {
    term: 'Espoleta',
    text: 'Mecanismo que inicia la carga. Impacto: al tocar. Retardo: tras penetrar. Tiempo: a los segundos fijados (estallido aéreo). Proximidad: a una altura sobre el suelo.',
  },
  alcance: {
    term: 'Alcance',
    text: 'Distancia horizontal entre la pieza y el punto de impacto.',
  },
  tof: {
    term: 'Tiempo de vuelo (TOF)',
    text: 'Segundos desde el disparo hasta el impacto o la detonación.',
  },
  apice: {
    term: 'Ápice',
    text: 'Altura máxima de la trayectoria sobre la pieza. Importa para el espacio aéreo y la cobertura de crestas.',
  },
  caida: {
    term: 'Ángulo de caída',
    text: 'Inclinación de la trayectoria en el impacto. Cuanto más vertical, mejor alcanza contrapendientes y zanjas.',
  },
  rama: {
    term: 'Rama alta / baja',
    text: 'Para un mismo alcance hay dos elevaciones: la baja (tiro rasante, menor TOF) y la alta (por encima de 800 mil, para batir detrás de obstáculos).',
  },
  mrsi: {
    term: 'MRSI',
    text: 'Multiple Round Simultaneous Impact: varias rondas de la misma pieza con distintas elevaciones y cargas que llegan a la vez al objetivo.',
  },
  per: {
    term: 'Error probable (EP / PER)',
    text: 'La mitad de los disparos cae dentro de ±1 EP del punto medio en alcance (y en dirección). EP = 0.6745·σ.',
  },
  cep: {
    term: 'CEP',
    text: 'Círculo de error probable: radio que contiene el 50 % de los impactos alrededor del punto medio.',
  },
  mgrs: {
    term: 'MGRS',
    text: 'Military Grid Reference System: cuadrícula OTAN. Zona, cuadrado de 100 km y coordenadas este/norte (5+5 cifras = 1 m).',
  },
  cota: {
    term: 'Diferencia de cota',
    text: 'Altura del objetivo respecto a la pieza. Un objetivo más alto acorta el alcance efectivo para la misma elevación.',
  },
  mach: {
    term: 'Número de Mach',
    text: 'Velocidad respecto a la del sonido local. Al cruzar Mach 1 el arrastre se dispara (onda de choque).',
  },
  arrastre: {
    term: 'Arrastre',
    text: 'Fuerza aerodinámica que frena el proyectil: ½·ρ·v²·Cd·A. Domina el alcance real frente al vacío.',
  },
  coriolis: {
    term: 'Coriolis',
    text: 'Desvío aparente por la rotación terrestre: decenas de metros a 20 km, centenares en tiros de misil.',
  },
  temppropelente: {
    term: 'Temperatura del propelente',
    text: 'La pólvora caliente quema más rápido: ≈ +0.06 % de V0 por °C sobre la referencia de tabla (21 °C).',
  },
  desgaste: {
    term: 'Desgaste del tubo',
    text: 'La erosión del ánima reduce la V0 a lo largo de la vida del tubo; la dirección de tiro la compensa con datos de radar de boca.',
  },
  met: {
    term: 'Mensaje meteorológico (MET)',
    text: 'Viento, temperatura y presión por capas de altitud. El tiro de precisión exige una MET reciente.',
  },
  cizalladura: {
    term: 'Cizalladura del viento',
    text: 'Cambio de dirección o intensidad del viento con la altitud: el proyectil atraviesa capas que lo empujan distinto.',
  },
  fo: {
    term: 'Observador avanzado (FO)',
    text: 'Ve el objetivo que la pieza no ve y corrige el tiro sobre SU línea de visión: "derecha 50, largo 100".',
  },
  adelanto: {
    term: 'Adelanto',
    text: 'Contra blancos en movimiento se apunta al punto futuro: velocidad × tiempo de vuelo.',
  },
  ilum: {
    term: 'Iluminación (ILLUM)',
    text: 'Proyectil con bengala y paracaídas; la espoleta de tiempo lo abre en altura. Se calcula sola con el TOF previsto.',
  },
};
