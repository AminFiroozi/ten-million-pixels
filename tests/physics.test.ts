import { describe, it, expect } from "vitest";
import { World, CELL, WORLD_W, WORLD_H } from "../src/world";
import { Physics, AbilityStats } from "../src/physics";
import { biomeAt } from "../src/biomes";

const STATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2, darkSpeedMul: 1 };
const DSTATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2, darkSpeedMul: 1 };

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
  it("catches a fast diagonal wall crossing at a grid corner", () => {
    const w = emptyWorld();
    w.cells[w.idx(101, 100)] = CELL.SOFT;
    const p = new Physics(w);
    p.spawn("white", 100.5, 100.5, Math.PI / 4);
    const mined: number[] = [];
    p.step(0.03, STATS, cell => mined.push(cell));
    expect(mined).toContain(CELL.SOFT);
    expect(p.balls[0].vx).toBeLessThan(0);
  });
  it("reports direct impact context while preserving the mined callback", () => {
    const w = emptyWorld();
    w.cells[w.idx(110, 100)] = CELL.SOFT;
    for (let y = 0; y < WORLD_H; y++) if (y !== 100) w.cells[w.idx(110, y)] = CELL.HARD;
    const p = new Physics(w);
    p.spawn("purple", 105, 100, 0);
    const mined: number[] = [];
    const impacts: Array<{ x: number; y: number; cell: number; ballType: string; destroyed: boolean }> = [];
    p.step(
      0.2,
      STATS,
      c => mined.push(c),
      undefined,
      context => impacts.push(context)
    );
    expect(mined).toContain(CELL.SOFT);
    expect(impacts).toContainEqual({ x: 110, y: 100, cell: CELL.SOFT, ballType: "purple", destroyed: true });
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

describe("molten and dark speed", () => {
  it("molten collision gives a controlled hard bounce and fires onMoltenHit", () => {
    const seed = 3;
    const w = World.generate(seed);
    let mx = -1, my = -1;
    outer: for (let y = 100; y < WORLD_H; y++) for (let x = 100; x < WORLD_W; x++)
      if (biomeAt(x, y, w.seed) === "molten") { mx = x; my = y; break outer; }
    w.cells.fill(CELL.EMPTY);
    for (let y = 0; y < WORLD_H; y++) w.cells[w.idx(mx, y)] = CELL.HARD;
    const p = new Physics(w);
    p.spawn("white", mx - 1, my, 0);
    const speedBefore = Math.hypot(p.balls[0].vx, p.balls[0].vy);
    let moltenHitAt: [number, number] | null = null;
    p.step(0.2, DSTATS, () => {}, (x, y) => { moltenHitAt = [x, y]; });
    expect(p.balls.length).toBe(1);
    expect(p.balls[0].vx).toBeLessThan(0);
    const speedAfter = Math.hypot(p.balls[0].vx, p.balls[0].vy);
    expect(speedAfter).toBeCloseTo(90, 1);
    expect(moltenHitAt).toEqual([mx, my]);
  });
  it("ball survives many consecutive molten bounces without dying", () => {
    const seed = 3;
    const w = World.generate(seed);
    let mx = -1, my = -1;
    outer: for (let y = 100; y < WORLD_H; y++) for (let x = 100; x < WORLD_W; x++)
      if (biomeAt(x, y, w.seed) === "molten" && biomeAt(x + 2, y, w.seed) === "molten") { mx = x; my = y; break outer; }
    w.cells.fill(CELL.EMPTY);
    for (let y = 0; y < WORLD_H; y++) {
      w.cells[w.idx(mx, y)] = CELL.HARD;
      w.cells[w.idx(mx + 2, y)] = CELL.HARD;
    }
    const p = new Physics(w);
    p.spawn("white", mx + 1.5, my, 0);
    for (let i = 0; i < 400; i++) p.step(1 / 60, DSTATS, () => {});
    expect(p.balls.length).toBe(1);
  });
  it("ball survives 3000+ consecutive molten bounces with velocity staying bounded and finite", () => {
    const seed = 3;
    const w = World.generate(seed);
    let mx = -1, my = -1;
    outer: for (let y = 100; y < WORLD_H; y++) for (let x = 100; x < WORLD_W; x++)
      if (biomeAt(x, y, w.seed) === "molten" && biomeAt(x + 2, y, w.seed) === "molten") { mx = x; my = y; break outer; }
    w.cells.fill(CELL.EMPTY);
    for (let y = 0; y < WORLD_H; y++) {
      w.cells[w.idx(mx, y)] = CELL.HARD;
      w.cells[w.idx(mx + 2, y)] = CELL.HARD;
    }
    const p = new Physics(w);
    p.spawn("white", mx + 1.5, my, 0);
    for (let i = 0; i < 3000; i++) p.step(1 / 60, DSTATS, () => {});
    expect(p.balls.length).toBe(1);
    expect(Number.isFinite(p.balls[0].vx) && Number.isFinite(p.balls[0].vy)).toBe(true);
    expect(Math.hypot(p.balls[0].vx, p.balls[0].vy)).toBeLessThan(1000);
  });
  it("dark speed multiplier applies in unexplored cells", () => {
    const w = World.generate(3);
    w.cells.fill(CELL.EMPTY);
    w.explored.fill(0);
    const p = new Physics(w);
    p.spawn("white", 100, 100, 0);
    p.step(0.5, { ...DSTATS, darkSpeedMul: 2 }, () => {});
    expect(p.balls[0].x).toBeCloseTo(100 + 90 * 0.5 * 2, 0);
  });
  it("dark speed can't tunnel a ball through a 1-cell-thick wall", () => {
    const w = World.generate(3);
    w.cells.fill(CELL.EMPTY);
    w.explored.fill(0);
    for (let y = 0; y < WORLD_H; y++) w.cells[w.idx(110, y)] = CELL.HARD;
    const p = new Physics(w);
    p.spawn("white", 100, 100, 0);
    p.step(0.5, { ...DSTATS, darkSpeedMul: 2 }, () => {});
    expect(p.balls[0].vx).toBeLessThan(0);
    expect(p.balls[0].x).toBeLessThan(110);
  });
});
