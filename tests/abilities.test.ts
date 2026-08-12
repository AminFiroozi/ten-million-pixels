import { describe, it, expect } from "vitest";
import { World, CELL, WORLD_H } from "../src/world";
import { Physics, AbilityStats } from "../src/physics";

const STATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2 };

function wallWorld(): World {
  const w = World.generate(1);
  w.cells.fill(CELL.EMPTY);
  for (let y = 0; y < WORLD_H; y++) w.cells[w.idx(110, y)] = CELL.SOFT;
  return w;
}

describe("abilities", () => {
  it("blue snaps to axis", () => {
    const p = new Physics(wallWorld());
    p.spawn("blue", 100, 100, 0.3);
    expect(p.balls[0].vy).toBe(0);
    expect(Math.abs(p.balls[0].vx)).toBeGreaterThan(0);
  });
  it("red smashes area", () => {
    const w = wallWorld();
    const p = new Physics(w);
    p.spawn("red", 105, 100, 0);
    p.step(0.2, STATS, () => {});
    expect(w.get(110, 99)).toBe(CELL.EMPTY);
    expect(w.get(110, 101)).toBe(CELL.EMPTY);
  });
  it("green poisons, poison erodes over time", () => {
    const w = World.generate(1);
    w.cells.fill(CELL.EMPTY);
    for (let y = 0; y < WORLD_H; y++) w.cells[w.idx(110, y)] = CELL.HARD;
    const p = new Physics(w);
    p.spawn("green", 105, 100, 0);
    p.step(0.2, STATS, () => {});
    expect(p.poison.size).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) p.step(0.5, STATS, () => {});
    expect(w.get(110, 100)).toBe(CELL.EMPTY);
  });
  it("orange splits into ttl shards", () => {
    const p = new Physics(wallWorld());
    p.spawn("orange", 105, 100, 0);
    p.step(0.2, STATS, () => {});
    expect(p.balls.length).toBe(1 + STATS.splitCount);
    expect(p.balls.some(b => b.ttl > 0)).toBe(true);
  });
  it("yellow pierces through pierceDepth cells", () => {
    const w = wallWorld();
    for (let y = 0; y < WORLD_H; y++) { w.cells[w.idx(111, y)] = CELL.SOFT; w.cells[w.idx(112, y)] = CELL.SOFT; }
    const p = new Physics(w);
    p.spawn("yellow", 105, 100, 0);
    p.step(0.15, STATS, () => {});
    expect(w.get(110, 100)).toBe(CELL.EMPTY);
    expect(w.get(111, 100)).toBe(CELL.EMPTY);
    expect(p.balls[0].vx).toBeLessThan(0);
  });
  it("purple continues through destroyed cell", () => {
    const w = wallWorld();
    const p = new Physics(w);
    p.spawn("purple", 105, 100, 0);
    p.step(0.6, STATS, () => {});
    expect(w.get(110, 100)).toBe(CELL.EMPTY);
    expect(p.balls[0].x).toBeGreaterThan(110);
  });
});
