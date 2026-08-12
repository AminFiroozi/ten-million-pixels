import { valueNoise2D } from "./rng";

export type Biome = "verdant" | "crystal" | "molten" | "ruins";

export const MOLTEN_DESTROY_CHANCE = 0.15;

export function biomeAt(x: number, y: number, seed: number): Biome {
  const n = valueNoise2D(x, y, seed + 5, 320);
  if (n < 0.45) return "verdant";
  if (n < 0.65) return "crystal";
  if (n < 0.85) return "molten";
  return "ruins";
}

export function biomeValueMul(b: Biome): number {
  switch (b) {
    case "verdant": return 1;
    case "crystal": return 2;
    case "molten": return 3;
    case "ruins": return 1;
  }
}

export function biomeHardnessShift(b: Biome): number {
  switch (b) {
    case "crystal": return 1;
    default: return 0;
  }
}
