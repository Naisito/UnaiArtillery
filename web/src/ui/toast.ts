// Aviso efímero centrado arriba (errores de picking, fuera de alcance, etc.).
let timer: number | undefined;

export function toast(message: string, ms = 2600): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.setAttribute('role', 'status'); // P-VIVO.11 — los lectores lo anuncian
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('show'), ms);
}
