import { describe, expect, it } from "vitest";
import { formatCombo } from "../src/ui-format";

describe("combo feedback formatting", () => {
  it("formats an active combo with its cascade count", () => {
    expect(formatCombo(4, 2)).toBe("COMBO x4  |  CASCADE 2");
  });

  it("returns no feedback when combo and cascade are both zero", () => {
    expect(formatCombo(0, 0)).toBeNull();
  });
});
