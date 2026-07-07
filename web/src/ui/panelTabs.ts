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

export function installPanelTabs(): void {
  const bar = document.createElement('div');
  bar.id = 'panelTabs';
  const buttons = new Map<string, HTMLButtonElement>();

  for (const t of TABS) {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    btn.setAttribute('aria-label', `Mostrar panel ${t.label}`);
    btn.onclick = () => {
      const panel = document.getElementById(t.id);
      if (!panel) return;
      const wasOpen = panel.classList.contains('open');
      for (const other of TABS) {
        document.getElementById(other.id)?.classList.remove('open');
        buttons.get(other.id)?.classList.remove('toggled');
      }
      if (!wasOpen) {
        panel.classList.add('open');
        btn.classList.add('toggled');
      }
    };
    buttons.set(t.id, btn);
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);

  // Arranque en estrecho: la consola abierta (lo esencial primero).
  if (window.matchMedia('(max-width: 900px)').matches) {
    document.getElementById('controlPanel')?.classList.add('open');
    buttons.get('controlPanel')?.classList.add('toggled');
  }
}
