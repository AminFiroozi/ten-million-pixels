import { describe, expect, it } from "vitest";
import { sweepGrid } from "../src/grid-collision";

describe("sweepGrid", () => {
  it("returns the first solid cell crossed by a horizontal segment", () => {
    const hit = sweepGrid(1.2, 2.5, 8.8, 2.5, (x, y) => x === 4 && y === 2, 10, 10);

    expect(hit).toMatchObject({ x: 4, y: 2, normalX: -1, normalY: 0 });
    expect(hit?.t).toBeCloseTo((4 - 1.2) / (8.8 - 1.2));
  });

  it("returns null when the segment crosses only empty cells", () => {
    expect(sweepGrid(1.2, 2.5, 8.8, 2.5, () => false, 10, 10)).toBeNull();
  });

  it("treats leaving the grid as a solid boundary", () => {
    expect(sweepGrid(1.5, 1.5, -2, 1.5, () => false, 10, 10)).toMatchObject({
      normalX: 1,
      normalY: 0,
    });
  });

  it("uses x-before-y ordering for diagonal ties", () => {
    const hit = sweepGrid(0.5, 0.5, 3.5, 3.5, (x, y) => x === 1 && y === 0, 10, 10);

    expect(hit).toMatchObject({ x: 1, y: 0, normalX: -1, normalY: 0 });
  });

  it("returns null for a zero-length segment in an empty cell", () => {
    expect(sweepGrid(2.5, 3.5, 2.5, 3.5, () => false, 10, 10)).toBeNull();
  });

  it("handles a segment that starts outside at negative coordinates", () => {
    const hit = sweepGrid(-2.5, 1.5, 3.5, 1.5, (x, y) => x === 2 && y === 1, 10, 10);

    expect(hit).toMatchObject({ x: 2, y: 1, normalX: -1, normalY: 0 });
  });

  it("reports a solid starting cell without inventing a normal", () => {
    expect(sweepGrid(2.25, 3.75, 8.5, 3.75, (x, y) => x === 2 && y === 3, 10, 10)).toMatchObject({
      x: 2,
      y: 3,
      normalX: 0,
      normalY: 0,
      t: 0,
    });
  });

  it("ignores non-finite segments", () => {
    expect(sweepGrid(Number.NaN, 0, 1, 1, () => true, 10, 10)).toBeNull();
  });
});
