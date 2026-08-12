import { describe, it, expect } from "vitest";
import { newEconomy, ballCost, buyBall, buyUpgrade, isUnlocked, statMul, pixelValue, UPGRADE_TREE, nextBallCost, abilityLevel, NODE_LAYOUT } from "../src/economy";
import { CELL } from "../src/world";

describe("economy", () => {
  it("cost curve", () => {
    expect(ballCost("white", 0)).toBe(10);
    expect(ballCost("white", 1)).toBe(Math.ceil(10 * 1.15));
    expect(ballCost("purple", 0)).toBe(1000);
  });
  it("buyBall spends and increments", () => {
    const s = newEconomy();
    s.currency = 10;
    expect(buyBall(s, "white")).toBe(true);
    expect(s.ballsOwned.white).toBe(2);
    expect(s.currency).toBe(0);
    expect(buyBall(s, "white")).toBe(false);
  });
  it("nextBallCost matches what buyBall actually charges, including the white starter-ball case", () => {
    const s = newEconomy();
    expect(nextBallCost(s, "white")).toBe(10);
    s.currency = 10;
    const before = s.currency;
    buyBall(s, "white");
    expect(before - s.currency).toBe(10);

    expect(nextBallCost(s, "white")).toBe(Math.ceil(10 * 1.15));
    s.currency = nextBallCost(s, "white");
    const before2 = s.currency;
    buyBall(s, "white");
    expect(before2 - s.currency).toBe(Math.ceil(10 * 1.15));
  });
  it("locked ball not buyable until unlock node bought", () => {
    const s = newEconomy();
    s.currency = 100000;
    expect(isUnlocked(s, "blue")).toBe(false);
    expect(buyBall(s, "blue")).toBe(false);
    s.upgradePoints = 100;
    expect(buyUpgrade(s, "unlock_blue")).toBe(true);
    expect(buyBall(s, "blue")).toBe(true);
  });
  it("upgrade prerequisites and max levels", () => {
    const s = newEconomy();
    s.upgradePoints = 1000;
    const speed = UPGRADE_TREE.find(n => n.id === "speed_1")!;
    for (let i = 0; i < speed.max; i++) expect(buyUpgrade(s, "speed_1")).toBe(true);
    expect(buyUpgrade(s, "speed_1")).toBe(false);
    expect(statMul(s, "speed")).toBeCloseTo(1 + speed.max * speed.amount!);
  });
  it("pixelValue by hardness", () => {
    expect(pixelValue(CELL.SOFT)).toBe(1);
    expect(pixelValue(CELL.MED)).toBe(2);
    expect(pixelValue(CELL.HARD)).toBe(4);
  });
});

describe("depths tree nodes", () => {
  it("new nodes exist with prereq chains", () => {
    const s = newEconomy();
    s.upgradePoints = 100;
    expect(buyUpgrade(s, "reveal_radius_2")).toBe(false);
    expect(buyUpgrade(s, "reveal_radius_1")).toBe(true);
    expect(buyUpgrade(s, "reveal_radius_2")).toBe(true);
    expect(abilityLevel(s, "revealRadius")).toBe(2);
    expect(buyUpgrade(s, "launch_wave")).toBe(true);
    expect(abilityLevel(s, "launchWave")).toBe(1);
    expect(buyUpgrade(s, "launch_speed")).toBe(true);
    expect(statMul(s, "launchSpeed")).toBeCloseTo(1.1);
    expect(buyUpgrade(s, "molten_immunity")).toBe(true);
    expect(abilityLevel(s, "moltenImmunity")).toBe(1);
    expect(buyUpgrade(s, "molten_immunity")).toBe(false);
    expect(buyUpgrade(s, "dark_speed")).toBe(true);
    expect(statMul(s, "darkSpeed")).toBeCloseTo(1.15);
  });
  it("every tree node has a layout entry", () => {
    for (const n of UPGRADE_TREE) expect(NODE_LAYOUT[n.id]).toBeDefined();
  });
});
