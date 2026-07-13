// ============================================================================
//  panelTabs.ts — Paneles como pestañas en pantallas estrechas.  [P-VIVO.11]
//
//  Bajo 900 px de ancho los tres paneles (consola, meteo, cockpit) no caben a
//  la vez: una barra de pestañas abajo muestra UNO cada vez (tocar la pestaña
//  activa lo pliega). El CSS (media query) esconde la barra en escritorio y
//  los paneles no abiertos en estrecho — aquí solo vive el estado.
// ============================================================================

const TABS: { id: string; label: string }[] = [
  { id: 'controlPanel', label: '🎛 Consola' },
  { id: 'weatherPanel', label: '🌦 Meteo' },
  { id: 'cockpit', label: '🧭 Cockpit' },
];

export interface PanelTabsController {
  /** Abre el panel indicado (y pliega los demás) — p. ej. para que el
   *  tutorial pueda señalar controles de un panel plegado en móvil. */
  open(id: string): void;
}

export function installPanelTabs(): PanelTabsController {
  const bar = document.createElement('div');
  bar.id = 'panelTabs';
  const buttons = new Map<string, HTMLButtonElement>();

  const openPanel = (id: string): void => {
    const panel = document.getElementById(id);
    if (!panel) return;
    for (const other of TABS) {
      document.getElementById(other.id)?.classList.remove('open');
      buttons.get(other.id)?.classList.remove('toggled');
    }
    panel.classList.add('open');
    buttons.get(id)?.classList.add('toggled');
  };

  for (const t of TABS) {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    btn.setAttribute('aria-label', `Mostrar panel ${t.label}`);
    btn.onclick = () => {
      const panel = document.getElementById(t.id);
      if (!panel) return;
      const wasOpen = panel.classList.contains('open');
      if (wasOpen) {
        panel.classList.remove('open');
        btn.classList.remove('toggled');
      } else {
        openPanel(t.id);
      }
    };
    buttons.set(t.id, btn);
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);

  // Arranque en estrecho: la consola abierta (lo esencial primero).
  if (window.matchMedia('(max-width: 900px)').matches) {
    openPanel('controlPanel');
  }

  return { open: openPanel };
}
