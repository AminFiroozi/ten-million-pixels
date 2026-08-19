import { describe, it, expect } from "vitest";
import { World, WORLD_W, WORLD_H, CELL } from "../src/world";
import { diffWorld, applyDiff } from "../src/save";

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
    expect(counts.get(CELL.TREASURE) ?? 0).toBeGreaterThan(50);
    expect(counts.get(CELL.BOSS) ?? 0).toBeGreaterThan(100);
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

describe("damage feedback", () => {
  it("fires onCellDamaged on non-destroying hits and exposes damageAt", () => {
    const w = World.generate(1);
    let fx = -1, fy = -1;
    outer: for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++)
      if (w.get(x, y) === CELL.HARD) { fx = x; fy = y; break outer; }
    const dmg: number[] = [];
    w.onCellDamaged = () => dmg.push(1);
    w.hit(fx, fy, 1);
    expect(dmg.length).toBe(1);
    expect(w.damageAt(fx, fy)).toBe(1);
    w.hit(fx, fy, 1);
    expect(w.damageAt(fx, fy)).toBe(2);
  });
});

describe("fog of war", () => {
  it("spawn area revealed, rest dark", () => {
    const w = World.generate(1);
    expect(w.isExplored(640, 400)).toBe(true);
    expect(w.isExplored(660, 400)).toBe(true);
    expect(w.isExplored(100, 100)).toBe(false);
    expect(w.isExplored(-1, 0)).toBe(false);
  });
  it("reveal marks cells and fires onCellChanged only for newly revealed", () => {
    const w = World.generate(1);
    const calls: number[] = [];
    w.onCellChanged = () => calls.push(1);
    w.reveal(100, 100, 2);
    expect(w.isExplored(100, 100)).toBe(true);
    expect(w.isExplored(102, 98)).toBe(true);
    expect(calls.length).toBe(25);
    calls.length = 0;
    w.reveal(100, 100, 2);
    expect(calls.length).toBe(0);
  });
});

describe("treasure and bosses", () => {
  const w = World.generate(1234);
  it("treasure and boss cells exist", () => {
    let t = 0, b = 0;
    for (const c of w.cells) { if (c === CELL.TREASURE) t++; if (c === CELL.BOSS) b++; }
    expect(t).toBeGreaterThan(50);
    expect(b).toBeGreaterThan(100);
    expect(b).toBe(w.bossMap.size);
  });
  it("boss blob completion detection", () => {
    const w2 = World.generate(1234);
    const byId = new Map<number, number[]>();
    for (const [idx, id] of w2.bossMap) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id)!.push(idx);
    }
    const [id, idxs] = [...byId.entries()][0];
    for (let i = 0; i < idxs.length; i++) {
      const x = idxs[i] % WORLD_W, y = Math.floor(idxs[i] / WORLD_W);
      const res = w2.registerBossCellMined(x, y);
      if (i < idxs.length - 1) expect(res).toBe(-1);
      else expect(res).toBe(id);
    }
    expect(w2.registerBossCellMined(0, 0)).toBe(-1);
  });
  it("registerBossCellMined rejects out-of-bounds coords without touching state", () => {
    const w3 = World.generate(1234);
    const sizeBefore = w3.bossMap.size;
    const remainingBefore = w3.bossRemaining.slice();
    expect(w3.registerBossCellMined(WORLD_W, 0)).toBe(-1);
    expect(w3.registerBossCellMined(-1, 0)).toBe(-1);
    expect(w3.registerBossCellMined(0, WORLD_H)).toBe(-1);
    expect(w3.registerBossCellMined(0, -1)).toBe(-1);
    expect(w3.bossMap.size).toBe(sizeBefore);
    expect(w3.bossRemaining).toEqual(remainingBefore);
  });
  it("generation deterministic with new content", () => {
    const a = World.generate(42), b = World.generate(42);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.bossMap.size).toBe(b.bossMap.size);
  });
  it("boss blob survives a save/load round-trip via syncBossMap", () => {
    const seed = 1234;
    const w = World.generate(seed);
    const byId = new Map<number, number[]>();
    for (const [idx, id] of w.bossMap) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id)!.push(idx);
    }
    const [blobId, idxs] = [...byId.entries()][0];
    const originalCount = idxs.length;
    const destroyCount = Math.max(1, Math.floor(originalCount / 2));
    const destroyed = idxs.slice(0, destroyCount);
    const remaining = idxs.slice(destroyCount);
    expect(remaining.length).toBeGreaterThan(0);

    for (const i of destroyed) {
      const x = i % WORLD_W, y = Math.floor(i / WORLD_W);
      expect(w.hit(x, y, 999)).toBe(CELL.BOSS);
    }

    const diff = diffWorld(w);

    const fresh = World.generate(seed);
    applyDiff(fresh, diff);
    fresh.syncBossMap();

    for (const i of destroyed) expect(fresh.bossMap.has(i)).toBe(false);
    expect(fresh.bossRemaining[blobId]).toBe(originalCount - destroyCount);

    let lastResult = -1;
    for (const i of remaining) {
      const x = i % WORLD_W, y = Math.floor(i / WORLD_W);
      expect(fresh.hit(x, y, 999)).toBe(CELL.BOSS);
      lastResult = fresh.registerBossCellMined(x, y);
    }
    expect(lastResult).toBe(blobId);
  });
});
