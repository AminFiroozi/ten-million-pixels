export function formatCombo(combo: number, cascadeCount: number): string | null {
  const safeCombo = Math.max(0, Math.floor(combo));
  const safeCascade = Math.max(0, Math.floor(cascadeCount));
  if (safeCombo === 0 && safeCascade === 0) return null;
  if (safeCombo === 0) return `CASCADE ${safeCascade}`;
  if (safeCascade === 0) return `COMBO x${safeCombo}`;
  return `COMBO x${safeCombo}  |  CASCADE ${safeCascade}`;
}
