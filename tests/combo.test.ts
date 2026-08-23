import { describe, expect, it } from "vitest";
import { advanceCombo, type ComboState } from "../src/combo";

describe("mining combo timing", () => {
  it("increments the combo for mined cells", () => {
    const state: ComboState = { count: 0, lastMinedAt: null };

    const next = advanceCombo(state, 3, 1000);

    expect(next).toEqual({ count: 3, lastMinedAt: 1000 });
  });

  it("retains an active combo inside the combo window", () => {
    const state: ComboState = { count: 2, lastMinedAt: 1000 };

    expect(advanceCombo(state, 1, 1500)).toEqual({ count: 3, lastMinedAt: 1500 });
  });

  it("resets an expired combo before counting new mines", () => {
    const state: ComboState = { count: 4, lastMinedAt: 1000 };

    expect(advanceCombo(state, 1, 1000 + 2001)).toEqual({ count: 1, lastMinedAt: 3001 });
  });

  it("expires a combo when no cells are mined after the window", () => {
    const state: ComboState = { count: 4, lastMinedAt: 1000 };

    expect(advanceCombo(state, 0, 1000 + 2001)).toEqual({ count: 0, lastMinedAt: null });
  });
});
