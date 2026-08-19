import { describe, it, expect } from "vitest";
import { AUGMENT_POOL, newAugmentState, augmentMul, augmentBonus, pickAugment, rollChoices } from "../src/augments";

describe("augments", () => {
  it("pool has 12 distinct entries", () => {
    expect(AUGMENT_POOL.length).toBe(12);
    expect(new Set(AUGMENT_POOL.map(d => d.id)).size).toBe(12);
  });

  it("augmentMul and augmentBonus reflect picked defs", () => {
    const s = newAugmentState(1);
    expect(augmentMul(s, "speed")).toBe(1);
    expect(augmentBonus(s, "smashRadius")).toBe(0);
    pickAugment(s, "aug_momentum");
    pickAugment(s, "aug_blast");
    expect(augmentMul(s, "speed")).toBeCloseTo(1.2);
    expect(augmentBonus(s, "smashRadius")).toBe(1);
  });

  it("pickAugment is a no-op on duplicate or unknown id", () => {
    const s = newAugmentState(1);
    pickAugment(s, "aug_momentum");
    pickAugment(s, "aug_momentum");
    expect(s.picked).toEqual(["aug_momentum"]);
    pickAugment(s, "not_a_real_id");
    expect(s.picked).toEqual(["aug_momentum"]);
  });

  it("rollChoices is deterministic for the same starting state", () => {
    const a = newAugmentState(42);
    const b = newAugmentState(42);
    expect(rollChoices(a, 3)).toEqual(rollChoices(b, 3));
  });

  it("rollChoices never returns already-picked or duplicate defs", () => {
    const s = newAugmentState(7);
    const choices = rollChoices(s, 3);
    expect(choices.length).toBe(3);
    const ids = choices.map(c => c.id);
    expect(new Set(ids).size).toBe(3);
    for (const c of choices) expect(s.picked).not.toContain(c.id);
  });

  it("rollChoices returns fewer than requested when the pool is small, and empty when exhausted", () => {
    const s = newAugmentState(7);
    for (const def of AUGMENT_POOL.slice(2)) pickAugment(s, def.id);
    const partial = rollChoices(s, 3);
    expect(partial.length).toBe(2);
    for (const def of partial) pickAugment(s, def.id);
    expect(rollChoices(s, 3)).toEqual([]);
  });
});
