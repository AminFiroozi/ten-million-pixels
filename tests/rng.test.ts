import { describe, it, expect } from "vitest";
import { mulberry32, hashCoords, valueNoise2D } from "../src/rng";

describe("rng", () => {
  it("mulberry32 is deterministic per seed", () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it("hashCoords stateless and seed-sensitive", () => {
    expect(hashCoords(5, 9, 1)).toBe(hashCoords(5, 9, 1));
    expect(hashCoords(5, 9, 1)).not.toBe(hashCoords(5, 9, 2));
    expect(hashCoords(5, 9, 1)).not.toBe(hashCoords(9, 5, 1));
  });
  it("valueNoise2D smooth-ish and bounded", () => {
    for (let i = 0; i < 100; i++) {
      const v = valueNoise2D(i * 3.7, i * 1.3, 7, 32);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const d = Math.abs(valueNoise2D(10, 10, 7, 32) - valueNoise2D(11, 10, 7, 32));
    expect(d).toBeLessThan(0.2);
  });
});
