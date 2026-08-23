import { describe, expect, it } from "vitest";
import { VisualEffectsState } from "../src/visual-effects";

describe("visual effects state", () => {
  it("keeps only the newest trail samples within its configured cap", () => {
    const effects = new VisualEffectsState({ maxTrails: 2 });

    effects.pushTrail({ x: 1, y: 1, type: "white" });
    effects.pushTrail({ x: 2, y: 2, type: "blue" });
    effects.pushTrail({ x: 3, y: 3, type: "red" });

    expect(effects.trails.map(sample => sample.x)).toEqual([2, 3]);
  });

  it("caps impact events and ignores non-finite visual input", () => {
    const effects = new VisualEffectsState({ maxImpacts: 2 });

    effects.addImpact({ x: 1, y: 1, color: "#fff" });
    effects.addImpact({ x: 2, y: 2, color: "#fff" });
    effects.addImpact({ x: 3, y: 3, color: "#fff" });
    effects.addImpact({ x: Number.NaN, y: 4, color: "#fff" });

    expect(effects.impacts.map(impact => impact.x)).toEqual([2, 3]);
  });

  it("decays camera impulse and remains finite", () => {
    const effects = new VisualEffectsState({ impulseDecay: 4 });
    effects.addImpulse(10, -5);

    effects.advance(0.25);

    expect(effects.impulse.x).toBeCloseTo(10 * Math.exp(-1));
    expect(effects.impulse.y).toBeCloseTo(-5 * Math.exp(-1));
    expect(Number.isFinite(effects.impulse.x)).toBe(true);
    expect(Number.isFinite(effects.impulse.y)).toBe(true);
  });
});
