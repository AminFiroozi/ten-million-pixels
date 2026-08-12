import { describe, it, expect } from "vitest";
import { biomeAt, biomeValueMul, biomeHardnessShift } from "../src/biomes";
import { valueNoise2D } from "../src/rng";

describe("biomes", () => {
  it("deterministic and matches noise bands", () => {
    for (const [x, y] of [[10, 10], [500, 300], [1200, 790], [640, 400]]) {
      const n = valueNoise2D(x, y, 7 + 5, 320);
      const b = biomeAt(x, y, 7);
      if (n < 0.45) expect(b).toBe("verdant");
      else if (n < 0.65) expect(b).toBe("crystal");
      else if (n < 0.85) expect(b).toBe("molten");
      else expect(b).toBe("ruins");
      expect(biomeAt(x, y, 7)).toBe(b);
    }
  });
  it("modifiers", () => {
    expect(biomeValueMul("verdant")).toBe(1);
    expect(biomeValueMul("crystal")).toBe(2);
    expect(biomeValueMul("molten")).toBe(3);
    expect(biomeValueMul("ruins")).toBe(1);
    expect(biomeHardnessShift("crystal")).toBe(1);
    expect(biomeHardnessShift("molten")).toBe(0);
  });
});
