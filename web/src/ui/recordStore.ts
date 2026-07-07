// ============================================================================
//  recordStore.ts — Persistencia de récords en localStorage.  [P-VIVO.6]
//
//  Extraído de Challenge.ts para que los tres retos (clásico, FO y móvil)
//  compartan la misma carga/guardado tolerante a fallos: almacenamiento
//  lleno, bloqueado o JSON corrupto NUNCA rompen el juego — solo dejan de
//  persistir.
// ============================================================================

export function loadRecords<T>(storeKey: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(storeKey);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export function saveRecords<T>(storeKey: string, records: Record<string, T>): void {
  try {
    localStorage.setItem(storeKey, JSON.stringify(records));
  } catch {
    // almacenamiento lleno/bloqueado: el reto sigue, solo no persiste
  }
}
