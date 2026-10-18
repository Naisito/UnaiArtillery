// ============================================================================
//  weaponInfo.ts — Metadatos de PRESENTACIÓN del arsenal (tarjeta y Arsenal).
//
//  La física vive en ballistics/WeaponCatalog.ts (BC calibrados, cargas,
//  envolventes); aquí solo lo que el operador lee: designación, papel,
//  calibre, datos públicos (alcance publicado, cadencia, dotación, país) y
//  la silueta. Los alcances y cadencias son cifras de fuentes abiertas
//  (fichas de fabricante / manuales de campo públicos) redondeadas; la V0
//  que se muestra es la de la carga máxima DEL SIMULADOR, para que lo que
//  se lee sea lo que se dispara.
// ============================================================================
import type { WeaponId } from '../ballistics';
import type { SilhouetteName } from './icons';

export type WeaponCategoryKey = 'mortar' | 'tube' | 'rocket' | 'missile' | 'small';

export interface WeaponInfo {
  id: WeaponId;
  /** Designación corta (tarjeta, barra superior). */
  designation: string;
  /** Nombre completo. */
  name: string;
  /** Papel táctico en una línea. */
  role: string;
  category: WeaponCategoryKey;
  caliber: string;
  /** Alcance publicado (texto: puede tener varias municiones). */
  publishedRange: string;
  /** Cadencia de fuego publicada. */
  rateOfFire: string;
  crew?: string;
  origin: string;
  silhouette: SilhouetteName;
  /** Una frase de contexto para el Arsenal. */
  blurb: string;
}

export const CATEGORY_LABELS: Record<WeaponCategoryKey, string> = {
  mortar: 'Morteros',
  tube: 'Artillería de tubo',
  rocket: 'Lanzacohetes',
  missile: 'Misiles tácticos',
  small: 'Armas ligeras',
};

export const CATEGORY_ORDER: WeaponCategoryKey[] = ['mortar', 'tube', 'rocket', 'missile', 'small'];

export const WEAPON_INFO: Record<WeaponId, WeaponInfo> = {
  mortar120: {
    id: 'mortar120',
    designation: 'M120',
    name: 'Mortero pesado M120 de 120 mm',
    role: 'Mortero pesado de ánima lisa',
    category: 'mortar',
    caliber: '120 mm',
    publishedRange: '7.2 km (M934A1 HE)',
    rateOfFire: '16 dpm (1 min) · 4 dpm sostenido',
    crew: '4–5',
    origin: 'EE. UU. / Israel',
    silhouette: 'mortar',
    blurb: 'Fuego curvo inmediato del batallón: solo rama alta, cuatro cargas y munición de iluminación y humo.',
  },
  m777: {
    id: 'm777',
    designation: 'M777A2',
    name: 'Obús remolcado M777A2 155 mm/L39',
    role: 'Obús ligero remolcado',
    category: 'tube',
    caliber: '155 mm',
    publishedRange: '24.7 km HE · 30 km RAP',
    rateOfFire: '5 dpm máx. · 2 dpm sostenido',
    crew: '7–8',
    origin: 'Reino Unido / EE. UU.',
    silhouette: 'towed',
    blurb: 'El estándar OTAN de 155 mm aerotransportable: titanio, 4.2 t y munición base bleed, RAP, ILLUM y humo.',
  },
  m109: {
    id: 'm109',
    designation: 'M109A7',
    name: 'Obús autopropulsado M109A7 Paladin',
    role: 'Obús autopropulsado de cadenas',
    category: 'tube',
    caliber: '155 mm',
    publishedRange: '24 km HE · 30 km RAP',
    rateOfFire: '4 dpm máx. · 1 dpm sostenido',
    crew: '4',
    origin: 'EE. UU.',
    silhouette: 'sp',
    blurb: 'Torre blindada con 360° de giro: dispara y cambia de asentamiento antes de la contrabatería.',
  },
  pion2s7: {
    id: 'pion2s7',
    designation: '2S7 Pion',
    name: 'Cañón autopropulsado 2S7 Pion 203 mm',
    role: 'Cañón autopropulsado pesado',
    category: 'tube',
    caliber: '203 mm',
    publishedRange: '37.5 km HE · 47.5 km RAP',
    rateOfFire: '1.5–2 dpm',
    crew: '7',
    origin: 'URSS',
    silhouette: 'spgun',
    blurb: 'El mayor calibre de tubo en servicio: proyectiles de 110 kg a 960 m/s con reja de apoyo trasera.',
  },
  excalibur: {
    id: 'excalibur',
    designation: 'M982 Excalibur',
    name: 'Proyectil guiado M982 Excalibur 155 mm',
    role: 'Proyectil guiado GPS/INS',
    category: 'tube',
    caliber: '155 mm',
    publishedRange: '~38 km (L39) · 40 km (L52)',
    rateOfFire: 'Según la pieza (M777A2)',
    origin: 'EE. UU. / Suecia',
    silhouette: 'guidedShell',
    blurb: 'Despliega canards y planea hacia el objetivo marcado: CEP inferior a 4 m a cualquier alcance.',
  },
  gmlrs: {
    id: 'gmlrs',
    designation: 'HIMARS · GMLRS',
    name: 'M142 HIMARS con cohete M31 GMLRS',
    role: 'Lanzacohetes guiados sobre ruedas',
    category: 'rocket',
    caliber: '227 mm',
    publishedRange: '15–70+ km',
    rateOfFire: '6 cohetes en < 1 min',
    crew: '3',
    origin: 'EE. UU.',
    silhouette: 'himars',
    blurb: 'Cohete guiado de cabeza unitaria: precisión de misil con la logística de un camión 6×6.',
  },
  m26: {
    id: 'm26',
    designation: 'M270 · M26',
    name: 'M270 MLRS con cohete M26',
    role: 'Lanzacohetes múltiple de cadenas',
    category: 'rocket',
    caliber: '227 mm',
    publishedRange: '32 km',
    rateOfFire: '12 cohetes en < 1 min',
    crew: '3',
    origin: 'EE. UU.',
    silhouette: 'mlrs',
    blurb: 'Fuego de saturación no guiado: cada cohete cubre una zona con submuniciones (la salva dispersa lo enseña).',
  },
  ergmlrs: {
    id: 'ergmlrs',
    designation: 'HIMARS · ER GMLRS',
    name: 'M142 HIMARS con ER GMLRS',
    role: 'Cohete guiado de alcance extendido',
    category: 'rocket',
    caliber: '227 mm',
    publishedRange: '150 km',
    rateOfFire: '6 cohetes en < 1 min',
    crew: '3',
    origin: 'EE. UU.',
    silhouette: 'himars',
    blurb: 'Motor más largo y cola aerodinámica: dobla el alcance del GMLRS con la misma huella de lanzamiento.',
  },
  tacticalMissile: {
    id: 'tacticalMissile',
    designation: 'ATACMS',
    name: 'Misil balístico táctico MGM-140 ATACMS (clase)',
    role: 'Misil balístico táctico',
    category: 'missile',
    caliber: '610 mm',
    publishedRange: '165–300 km',
    rateOfFire: '1 misil por contenedor',
    origin: 'EE. UU.',
    silhouette: 'missile',
    blurb: 'Trayectoria balística sobre Tierra esférica con guiado terminal: el simulador integra Coriolis y curvatura.',
  },
  prsm: {
    id: 'prsm',
    designation: 'PrSM',
    name: 'Precision Strike Missile (clase 500 km)',
    role: 'Misil de precisión de largo alcance',
    category: 'missile',
    caliber: '430 mm',
    publishedRange: '60–500 km',
    rateOfFire: '2 misiles por contenedor',
    origin: 'EE. UU.',
    silhouette: 'missileSlim',
    blurb: 'Sustituto del ATACMS: dos por contenedor y alcance de teatro con ápice en la estratosfera.',
  },
  pistol9: {
    id: 'pistol9',
    designation: 'Pistola 9 mm',
    name: 'Pistola semiautomática 9×19 mm Parabellum',
    role: 'Arma corta reglamentaria',
    category: 'small',
    caliber: '9×19 mm',
    publishedRange: '50 m eficaz',
    rateOfFire: 'Semiautomática',
    origin: 'OTAN',
    silhouette: 'pistol',
    blurb: 'Bala subsónica lenta: su caída a 100 m enseña por qué las miras se regulan a distancia corta.',
  },
  rifle556: {
    id: 'rifle556',
    designation: 'Fusil 5.56',
    name: 'Fusil de asalto 5.56×45 mm OTAN',
    role: 'Fusil de dotación',
    category: 'small',
    caliber: '5.56×45 mm',
    publishedRange: '500 m eficaz (punto)',
    rateOfFire: 'Tiro a tiro en el simulador',
    origin: 'OTAN',
    silhouette: 'rifle',
    blurb: 'Supersónico rasante con rebote sobre el agua: rebotes reales re-integrados en el núcleo balístico.',
  },
  mg762: {
    id: 'mg762',
    designation: 'M240',
    name: 'Ametralladora media M240 7.62×51 mm',
    role: 'Ametralladora media',
    category: 'small',
    caliber: '7.62×51 mm',
    publishedRange: '1 100 m (trípode)',
    rateOfFire: '650–950 dpm cíclica · 750 en el sim.',
    crew: '2–3',
    origin: 'Bélgica / EE. UU.',
    silhouette: 'mg',
    blurb: 'Mantén FUEGO para la ráfaga: 1 trazadora de cada 5 dibuja la balística en el cielo.',
  },
  m2browning: {
    id: 'm2browning',
    designation: 'M2HB .50',
    name: 'Ametralladora pesada M2HB .50 BMG',
    role: 'Ametralladora pesada',
    category: 'small',
    caliber: '12.7×99 mm',
    publishedRange: '1 830 m eficaz · 6.8 km máx.',
    rateOfFire: '450–600 dpm cíclica · 550 en el sim.',
    crew: '2–3',
    origin: 'EE. UU.',
    silhouette: 'hmg',
    blurb: 'La "Ma Deuce": en servicio desde 1933. Ráfagas largas a 9 disparos por segundo.',
  },
};

/** Armas de cada categoría en el orden del Arsenal. */
export function weaponsByCategory(): { key: WeaponCategoryKey; label: string; ids: WeaponId[] }[] {
  return CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    ids: (Object.values(WEAPON_INFO) as WeaponInfo[]).filter((w) => w.category === key).map((w) => w.id),
  }));
}
