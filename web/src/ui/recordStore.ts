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
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // "null", "3" o "[1]" son JSON válidos pero NO son un mapa de récords:
    // indexarlos rompería el arranque (violando la garantía del módulo).
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, T>;
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
