import { describe, it, expect } from "vitest";
import { World, WORLD_W, WORLD_H, CELL } from "../src/world";

function hash(cells: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < cells.length; i++) h = Math.imul(h ^ cells[i], 16777619);
  return h >>> 0;
}

describe("world generation", () => {
  const w = World.generate(1234);
  it("deterministic per seed", () => {
    expect(hash(World.generate(1234).cells)).toBe(hash(w.cells));
    expect(hash(World.generate(99).cells)).not.toBe(hash(w.cells));
  });
  it("exactly one golden pixel, in outer ring", () => {
    let count = 0, gi = -1;
    for (let i = 0; i < w.cells.length; i++) if (w.cells[i] === CELL.GOLD) { count++; gi = i; }
    expect(count).toBe(1);
    expect(gi).toBe(w.goldenIndex);
    const gx = gi % WORLD_W, gy = Math.floor(gi / WORLD_W);
    const dx = (gx - WORLD_W / 2) / (WORLD_W / 2), dy = (gy - WORLD_H / 2) / (WORLD_H / 2);
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeGreaterThan(0.8);
  });
  it("spawn cavity empty at center", () => {
    expect(w.get(WORLD_W / 2, WORLD_H / 2)).toBe(CELL.EMPTY);
  });
  it("contains upgrade pixels and object pixels", () => {
    const counts = new Map<number, number>();
    for (const c of w.cells) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.get(CELL.UPGRADE) ?? 0).toBeGreaterThan(50);
    expect(counts.get(CELL.OBJECT) ?? 0).toBeGreaterThan(100);
  });
  it("out of bounds is solid, in-cavity is not", () => {
    expect(w.isSolid(-1, 0)).toBe(true);
    expect(w.isSolid(0, WORLD_H)).toBe(true);
    expect(w.isSolid(WORLD_W / 2, WORLD_H / 2)).toBe(false);
  });
});

describe("mining", () => {
  it("hit accumulates damage then destroys", () => {
    const w = World.generate(1);
    let fx = -1, fy = -1;
    outer: for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++)
      if (w.get(x, y) === CELL.MED) { fx = x; fy = y; break outer; }
    expect(w.hit(fx, fy, 1)).toBe(0);
    expect(w.hit(fx, fy, 1)).toBe(0);
    expect(w.hit(fx, fy, 1)).toBe(CELL.MED);
    expect(w.get(fx, fy)).toBe(CELL.EMPTY);
    expect(w.hit(fx, fy, 1)).toBe(0);
  });
  it("fires onCellChanged on destroy", () => {
    const w = World.generate(1);
    const calls: Array<[number, number]> = [];
    w.onCellChanged = (x, y) => calls.push([x, y]);
    outer: for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++)
      if (w.get(x, y) === CELL.SOFT) { w.hit(x, y, 1); break outer; }
    expect(calls.length).toBe(1);
  });
});
