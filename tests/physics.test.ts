import { describe, it, expect } from "vitest";
import { World, CELL, WORLD_W, WORLD_H } from "../src/world";
import { Physics, AbilityStats } from "../src/physics";

const STATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2 };

function emptyWorld(): World {
  const w = World.generate(1);
  w.cells.fill(CELL.EMPTY);
  return w;
}

describe("physics", () => {
  it("ball moves by velocity", () => {
    const w = emptyWorld();
    const p = new Physics(w);
    p.spawn("white", 100, 100, 0);
    p.step(0.5, STATS, () => {});
    expect(p.balls[0].x).toBeCloseTo(100 + 90 * 0.5, 0);
    expect(p.balls[0].y).toBeCloseTo(100, 0);
  });
  it("reflects off vertical wall and damages it", () => {
    const w = emptyWorld();
    for (let y = 0; y < WORLD_H; y++) w.cells[w.idx(110, y)] = CELL.HARD;
    const p = new Physics(w);
    p.spawn("white", 100, 100, 0);
    p.step(0.5, STATS, () => {});
    expect(p.balls[0].vx).toBeLessThan(0);
    expect(p.balls[0].x).toBeLessThan(110);
  });
  it("mines soft pixel and reports via callback", () => {
    const w = emptyWorld();
    w.cells[w.idx(110, 100)] = CELL.SOFT;
    for (let y = 0; y < WORLD_H; y++) if (y !== 100) w.cells[w.idx(110, y)] = CELL.HARD;
    const p = new Physics(w);
    p.spawn("white", 105, 100, 0);
    const mined: number[] = [];
    p.step(0.2, STATS, c => mined.push(c));
    expect(mined).toContain(CELL.SOFT);
    expect(w.get(110, 100)).toBe(CELL.EMPTY);
  });
  it("culls non-finite balls", () => {
    const p = new Physics(emptyWorld());
    p.spawn("white", 100, 100, 0);
    p.balls[0].vx = NaN;
    p.step(0.016, STATS, () => {});
    expect(p.balls.length).toBe(0);
  });
  it("world bounds reflect", () => {
    const p = new Physics(emptyWorld());
    p.spawn("white", 2, 100, Math.PI);
    p.step(0.5, STATS, () => {});
    expect(p.balls[0].vx).toBeGreaterThan(0);
  });
  it("culls a finite-ttl ball once ttl runs out even when dt overshoots zero", () => {
    const p = new Physics(emptyWorld());
    p.spawn("white", 100, 100, 0);
    p.balls[0].ttl = 0.05;
    for (let i = 0; i < 5; i++) p.step(0.016, STATS, () => {});
    expect(p.balls.length).toBe(0);
  });
  it("keeps an infinite-ttl ball alive across the same steps", () => {
    const p = new Physics(emptyWorld());
    p.spawn("white", 100, 100, 0);
    for (let i = 0; i < 5; i++) p.step(0.016, STATS, () => {});
    expect(p.balls.length).toBe(1);
    expect(p.balls[0].ttl).toBe(-1);
  });
});
