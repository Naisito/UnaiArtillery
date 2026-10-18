// ============================================================================
//  map/mapSymbols.ts — Catálogo de símbolos listos para billboards.  [V2:MAP]
//
//  Une la geometría APP-6 (symbols.ts) con los tokens de color (theme.ts) y
//  el rasterizador HiDPI (symbolRaster.ts). `applySymbol` asigna la imagen a
//  un Billboard de forma asíncrona y a prueba de carreras (si el símbolo
//  cambió mientras se rasterizaba, gana el último pedido).
// ============================================================================
import * as Cesium from 'cesium';
import { rasterize, peek } from './symbolRaster';
import {
  aimpointSymbolSvg, apexSymbolSvg, burstSymbolSvg, challengeSymbolSvg, dotSymbolSvg,
  observerSymbolSvg, unitSymbolSvg, WeaponSymbolSpec,
} from './symbols';
import { token } from './theme';

export interface SymbolDef {
  key: string;
  svg: (px: number) => string;
  /** Lado en píxeles CSS del billboard. */
  size: number;
}

const HALO = () => 'rgba(255,255,255,0.92)';

export const SYM = {
  battery(spec: WeaponSymbolSpec, opacity = 1, size = 46): SymbolDef {
    const fill = token('--ua-friendly');
    const ink = token('--ua-text-inverse');
    return {
      key: `bat:${spec.icon}:${spec.mobility}:${fill}:${ink}:${opacity}:${size}`,
      size,
      svg: (px) => unitSymbolSvg({
        affiliation: 'friend', icon: spec.icon, mobility: spec.mobility, echelonBattery: true,
        colors: { fill, frame: ink, halo: HALO() }, opacity,
      }, px),
    };
  },
  target(opacity = 1, size = 40): SymbolDef {
    const fill = token('--ua-hostile');
    const ink = token('--ua-text-inverse');
    return {
      key: `tgt:${fill}:${ink}:${opacity}:${size}`,
      size,
      svg: (px) => unitSymbolSvg({
        affiliation: 'hostile', icon: 'none', colors: { fill, frame: ink, halo: HALO() }, opacity,
      }, px),
    };
  },
  observer(size = 38): SymbolDef {
    const fill = token('--ua-friendly');
    const ink = token('--ua-text-inverse');
    return {
      key: `op:${fill}:${ink}:${size}`,
      size,
      svg: (px) => observerSymbolSvg({ fill, frame: ink, halo: HALO() }, px),
    };
  },
  aimpoint(color = token('--ua-accent'), opacity = 1, size = 34): SymbolDef {
    const halo = token('--ua-text-inverse');
    return {
      key: `aim:${color}:${halo}:${opacity}:${size}`,
      size,
      svg: (px) => aimpointSymbolSvg(color, halo, px, opacity),
    };
  },
  burst(size = 22): SymbolDef {
    const color = token('--ua-accent');
    const ink = token('--ua-text-inverse');
    return { key: `burst:${color}:${ink}:${size}`, size, svg: (px) => burstSymbolSvg(color, ink, px) };
  },
  challenge(size = 40): SymbolDef {
    const color = token('--ua-unknown');
    const halo = token('--ua-text-inverse');
    return { key: `chal:${color}:${halo}:${size}`, size, svg: (px) => challengeSymbolSvg(color, halo, px) };
  },
  apex(size = 18): SymbolDef {
    const color = token('--ua-info');
    const halo = token('--ua-text-inverse');
    return { key: `apex:${color}:${halo}:${size}`, size, svg: (px) => apexSymbolSvg(color, halo, px) };
  },
  dot(color: string, label = '', size = 18): SymbolDef {
    const halo = token('--ua-text-inverse');
    return {
      key: `dot:${color}:${halo}:${label}:${size}`,
      size,
      svg: (px) => dotSymbolSvg(color, halo, px, label),
    };
  },
};

const wanted = new WeakMap<Cesium.Billboard, string>();

/** Asigna el símbolo al billboard (síncrono si ya está rasterizado). */
export function applySymbol(bb: Cesium.Billboard, def: SymbolDef): void {
  wanted.set(bb, def.key);
  bb.width = def.size;
  bb.height = def.size;
  const ready = peek(def.key);
  if (ready) {
    bb.setImage(def.key, ready);
    return;
  }
  void rasterize(def.key, def.svg, def.size).then(
    (canvas) => {
      if (wanted.get(bb) !== def.key) return; // otro símbolo pedido después
      try {
        bb.setImage(def.key, canvas);
      } catch {
        // billboard destruido entretanto
      }
    },
    (err) => console.warn('[map] símbolo', err),
  );
}

/** Pre-rasteriza un juego de símbolos (sin parpadeo al usarlos). */
export function warmSymbols(defs: SymbolDef[]): void {
  for (const d of defs) void rasterize(d.key, d.svg, d.size).catch(() => undefined);
}
