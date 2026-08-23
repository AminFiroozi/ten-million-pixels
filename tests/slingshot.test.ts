import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BALL_ORDER, BallType } from "../src/economy";
import { clampPull, launchSpeedMul, nextBallType, shouldLaunch } from "../src/slingshot";

describe("slingshot math", () => {
  it("clamps pull length without changing its direction", () => {
    expect(clampPull({ x: 0, y: 0 }, { x: 240, y: 0 }, 120)).toEqual({ x: 120, y: 0 });
  });

  it("maps minimum and maximum pull to bounded launch speed", () => {
    expect(launchSpeedMul(0, 120, 0.55, 1.55)).toBe(0.55);
    expect(launchSpeedMul(120, 120, 0.55, 1.55)).toBe(1.55);
  });

  it("requires the minimum pull before release fires", () => {
    expect(shouldLaunch(7, 8)).toBe(false);
    expect(shouldLaunch(8, 8)).toBe(true);
  });
});

describe("slingshot ball queue", () => {
  it("selects the first available ball in BALL_ORDER", () => {
    const owned = Object.fromEntries(BALL_ORDER.map(type => [type, 0])) as Record<BallType, number>;
    const spawned = Object.fromEntries(BALL_ORDER.map(type => [type, 0])) as Record<BallType, number>;
    owned.blue = 2;
    owned.red = 1;
    spawned.blue = 1;

    expect(nextBallType(owned, spawned)).toBe("blue");
  });

  it("returns null when every owned ball has been spawned", () => {
    const owned = Object.fromEntries(BALL_ORDER.map(type => [type, 1])) as Record<BallType, number>;
    const spawned = Object.fromEntries(BALL_ORDER.map(type => [type, 1])) as Record<BallType, number>;

    expect(nextBallType(owned, spawned)).toBeNull();
  });

  it("does not mutate owned or spawned inventory", () => {
    const owned = Object.fromEntries(BALL_ORDER.map(type => [type, 0])) as Record<BallType, number>;
    const spawned = Object.fromEntries(BALL_ORDER.map(type => [type, 0])) as Record<BallType, number>;
    owned.white = 1;
    const ownedBefore = { ...owned };
    const spawnedBefore = { ...spawned };

    expect(nextBallType(owned, spawned)).toBe("white");
    expect(owned).toEqual(ownedBefore);
    expect(spawned).toEqual(spawnedBefore);
  });
});

describe("slingshot launch anchors", () => {
  it("accepts and preserves an exact arbitrary world-space press anchor", () => {
    const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

    expect(mainSource).not.toContain("LAUNCH_ZONE_RADIUS");
    expect(mainSource).toContain("anchor: Point");
    expect(mainSource).toContain("physics.spawn(ballType, anchor.x, anchor.y");
    expect(mainSource).toContain("buildAimPreview(pull, aimState.ballType, aimState.anchor)");
  });
});
