import { describe, it, expect, beforeEach } from "vitest";
import { World, CELL, WORLD_W } from "../src/world";
import { diffWorld, applyDiff, clearSave, normalizeSave, SaveData } from "../src/save";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

describe("save diff", () => {
  it("roundtrips mined cells", () => {
    const w = World.generate(7);
    const mined: number[] = [];
    let n = 0;
    for (let i = 0; i < w.cells.length && n < 500; i += 977) {
      if (w.cells[i] >= CELL.SOFT) { w.cells[i] = CELL.EMPTY; mined.push(i); n++; }
    }
    const changes = diffWorld(w);
    const w2 = World.generate(7);
    applyDiff(w2, changes);
    expect(Array.from(w2.cells)).toEqual(Array.from(w.cells));
  });
  it("empty diff for untouched world", () => {
    expect(diffWorld(World.generate(7)).length).toBe(0);
  });
  it("matches a diff computed against a fresh regeneration", () => {
    const w = World.generate(11);
    let n = 0;
    for (let i = 0; i < w.cells.length && n < 500; i += 613) {
      if (w.cells[i] >= CELL.SOFT) { w.cells[i] = CELL.EMPTY; n++; }
    }
    const actual = diffWorld(w);

    const regenerated = World.generate(11);
    const expected: number[] = [];
    let prevIdx = 0;
    for (let i = 0; i < w.cells.length; i++) {
      if (w.cells[i] !== regenerated.cells[i]) {
        expected.push(i - prevIdx, w.cells[i]);
        prevIdx = i;
      }
    }
    expect(actual).toEqual(expected);
  });
});

describe("clearSave", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes only the save key", () => {
    localStorage.setItem("tmp-save", "some-save-data");
    localStorage.setItem("unrelated-key", "keep-me");
    clearSave();
    expect(localStorage.getItem("tmp-save")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
  });
});

describe("normalizeSave", () => {
  it("coerces a malformed save to safe defaults", () => {
    const malformed = {
      version: 1,
      seed: 7,
      changes: [],
      currency: NaN,
      upgradePoints: 3,
      upgrades: { speed_1: 2, bogus: "not-a-number" },
      stats: { pixelsMined: NaN, startedAt: 123, won: false },
    } as unknown as SaveData;

    const normalized = normalizeSave(malformed);

    expect(normalized.currency).toBe(0);
    expect(normalized.upgradePoints).toBe(3);
    expect(normalized.upgrades).toEqual({ speed_1: 2 });
    expect(normalized.ballsOwned).toEqual({
      white: 0,
      blue: 0,
      red: 0,
      green: 0,
      orange: 0,
      yellow: 0,
      purple: 0,
    });
    expect(normalized.stats.pixelsMined).toBe(0);
    expect(normalized.stats.startedAt).toBe(123);
    expect(normalized.stats.won).toBe(false);
  });
});
