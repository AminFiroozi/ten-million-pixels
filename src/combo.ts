export const COMBO_WINDOW_MS = 2000;

export interface ComboState {
  count: number;
  lastMinedAt: number | null;
}

export function advanceCombo(state: ComboState, minedCount: number, now: number): ComboState {
  const expired = state.lastMinedAt === null || now - state.lastMinedAt > COMBO_WINDOW_MS;
  const count = expired ? Math.max(0, minedCount) : state.count + Math.max(0, minedCount);
  return { count, lastMinedAt: count > 0 ? now : null };
}
