import { describe, expect, it } from "vitest";
import { capAimPreviewPoints } from "../src/render";

describe("aim preview rendering data", () => {
  it("keeps finite trajectory points bounded to the renderer cap", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ x: i, y: i * 2 }));

    expect(capAimPreviewPoints(points)).toHaveLength(32);
    expect(capAimPreviewPoints(points).at(-1)).toEqual({ x: 31, y: 62 });
  });

  it("drops non-finite points without mutating the caller array", () => {
    const points = [{ x: 1, y: 2 }, { x: Number.NaN, y: 3 }, { x: 4, y: Infinity }];

    expect(capAimPreviewPoints(points)).toEqual([{ x: 1, y: 2 }]);
    expect(points).toHaveLength(3);
  });
});
