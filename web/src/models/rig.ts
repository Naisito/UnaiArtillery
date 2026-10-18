// ============================================================================
//  rig.ts — Contrato de los modelos 3D articulados (plataformas de armas,
//  proyectiles y blancos).  [V2 — ver docs/PLAN_V2.md §3D]
//
//  CONVENCIÓN DE ESPACIO DE MODELADO (obligatoria para todos los builders):
//    * metros reales (escala 1:1 — usa medidas publicadas del sistema real),
//    * +X = derecha, +Y = adelante (hacia donde apunta el tubo en reposo),
//      +Z = arriba,
//    * origen = punto del SUELO bajo el eje de giro en azimut (el centro de
//      traverse); el suelo es el plano z = 0.
//
//  JERARQUÍA ARTICULADA: root ⊇ traverse ⊇ elevation ⊇ recoil.
//    * traverse.rotation.z = −azimutDeg·DEG  (el runtime la fija; en reposo 0
//      ⇒ tubo hacia +Y). En armas SIN torreta (remolcadas, morteros, TEL) el
//      traverse es el arma/vehículo entero (hijo directo de root).
//    * elevation.rotation.x = +elevaciónDeg·DEG; su origen local ES el eje de
//      muñones (trunnion). En reposo (0°) el eje del tubo es +Y local.
//    * recoil.position.y = −retroceso (m) a lo largo del tubo; 0 en reposo.
//  El runtime es el ÚNICO que escribe esas tres transformaciones: los
//  builders las dejan en identidad (salvo la posición de sus orígenes).
//
//  MATERIALES: solo MeshStandardMaterial (map / normalMap / roughnessMap /
//  metalnessMap / emissive / vertexColors). Nada de onBeforeCompile, shaders
//  propios ni MeshPhysicalMaterial: el modelo se exporta a glTF y lo pinta
//  Cesium (iluminación solar real, sombras, oclusión con el relieve).
// ============================================================================
import type * as THREE from 'three';
import type { Weapon, WeaponId } from '../ballistics';
import type { ModelKit } from './kit';

export const DEG = Math.PI / 180;

/** Plataformas de lanzamiento modeladas (varias armas comparten plataforma). */
export type PlatformKey =
  | 'mortar-m120'
  | 'm777'
  | 'm109a7'
  | '2s7-pion'
  | 'm270-mlrs'
  | 'm142-himars'
  | 'pistol'
  | 'rifle'
  | 'm240'
  | 'm2';

export interface RigBuildContext {
  kit: ModelKit;
  weaponId: WeaponId;
  weapon: Weapon;
}

/** Estado que el runtime pasa cada frame al hook opcional `animate`. */
export interface RigAnimState {
  /** Segundos desde que se construyó el modelo. */
  t: number;
  dt: number;
  azimuthDeg: number;
  elevationDeg: number;
  /** 0 en batería, 1 en retroceso máximo (envolvente del culatazo). */
  recoil01: number;
  /** Segundos desde el último disparo (Infinity si no ha disparado). */
  sinceFireS: number;
}

export interface PlatformRig {
  /** Raíz del modelo (espacio de modelado Z-up descrito arriba). */
  root: THREE.Group;
  /** Gira en azimut sobre su +Z local. */
  traverse: THREE.Object3D;
  /** Gira en elevación sobre su +X local; origen = eje de muñones. */
  elevation: THREE.Object3D;
  /** Se traslada en −Y local al retroceder. */
  recoil: THREE.Object3D;
  /** Boca del tubo / salida del contenedor, en coordenadas LOCALES de `recoil`. */
  muzzleLocal: THREE.Vector3;
  /** Carrera de retroceso a plena carga (m). 0 en lanzadores. */
  recoilStrokeM: number;
  /** Radio de la huella en planta (m): encuadre de cámaras y etiquetas. */
  footprintM: number;
  /** Altura total del modelo en reposo (m). */
  heightM: number;
  /**
   * Nodos que el hook `animate` modifica (además de traverse/elevation/
   * recoil). El runtime sincroniza SOLO estos con el modelo de Cesium.
   */
  extraAnimated?: THREE.Object3D[];
  /** Animación secundaria opcional (bípode que sigue al tubo, antena, …). */
  animate?(state: RigAnimState): void;
}

export type PlatformBuilder = (ctx: RigBuildContext) => PlatformRig;

/** Proyectil: eje +Y, nariz en +Y, origen en el centro de masas aprox. */
export interface ProjectileModel {
  root: THREE.Group;
  /** Longitud total (m). */
  lengthM: number;
  /** Punto de salida del chorro (cohetes/misiles), local; null si no tiene. */
  exhaustLocal: THREE.Vector3 | null;
}

/** Blanco (camión, carro, posición): mismo espacio que las plataformas. */
export interface TargetModel {
  root: THREE.Group;
  /** Ruedas/rodillos que giran al avanzar (eje local X). */
  wheels: THREE.Object3D[];
  /** Radio de rueda (m) para convertir velocidad en giro. */
  wheelRadiusM: number;
  footprintM: number;
}
