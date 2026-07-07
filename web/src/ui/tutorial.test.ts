// ============================================================================
//  tutorial.test.ts — P-VIVO.11: la máquina de pasos avanza SOLO con la
//  acción real que el paso espera, en orden, y termina.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEPS, TutorialMachine } from './Tutorial';

describe('P-VIVO.11 — máquina de pasos del tutorial (pura)', () => {
  it('tiene 6 pasos con la secuencia didáctica completa', () => {
    expect(TUTORIAL_STEPS.length).toBe(6);
    expect(TUTORIAL_STEPS.map((s) => s.event)).toEqual([
      'weapon-changed', 'aim-changed', 'impact',
      'target-marked', 'salvo-fired', 'challenge-opened',
    ]);
  });

  it('avanza solo con el evento del paso actual', () => {
    const m = new TutorialMachine();
    expect(m.stepIndex).toBe(0);
    // Eventos fuera de orden NO avanzan.
    expect(m.advance('impact')).toBe(false);
    expect(m.advance('challenge-opened')).toBe(false);
    expect(m.stepIndex).toBe(0);
    // El correcto sí.
    expect(m.advance('weapon-changed')).toBe(true);
    expect(m.stepIndex).toBe(1);
    expect(m.current!.event).toBe('aim-changed');
    // Repetir el anterior ya no hace nada.
    expect(m.advance('weapon-changed')).toBe(false);
  });

  it('recorre los 6 pasos y queda terminada', () => {
    const m = new TutorialMachine();
    for (const s of TUTORIAL_STEPS) expect(m.advance(s.event)).toBe(true);
    expect(m.done).toBe(true);
    expect(m.current).toBeNull();
    // Terminada: ya no responde a nada.
    expect(m.advance('impact')).toBe(false);
  });

  it('reset la devuelve al paso 1', () => {
    const m = new TutorialMachine();
    m.advance('weapon-changed');
    m.advance('aim-changed');
    m.reset();
    expect(m.stepIndex).toBe(0);
    expect(m.done).toBe(false);
  });
});
