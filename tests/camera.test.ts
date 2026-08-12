import { describe, it, expect } from "vitest";
import { worldToScreen, screenToWorld } from "../src/render";

describe("camera transforms", () => {
  const cam = { x: 640, y: 400, zoom: 4 };
  it("center maps to screen center", () => {
    expect(worldToScreen(cam, 800, 600, 640, 400)).toEqual([400, 300]);
  });
  it("roundtrip", () => {
    const [sx, sy] = worldToScreen(cam, 800, 600, 100, 200);
    const [wx, wy] = screenToWorld(cam, 800, 600, sx, sy);
    expect(wx).toBeCloseTo(100);
    expect(wy).toBeCloseTo(200);
  });
});
