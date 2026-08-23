import { describe, it, expect, beforeEach } from "vitest";
import { World, CELL, WORLD_W } from "../src/world";
import { diffWorld, applyDiff, clearSave, normalizeSave, loadGame, encodeExplored, decodeExplored, SaveData } from "../src/save";

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

describe("explored RLE", () => {
  it("roundtrips", () => {
    const mask = new Uint8Array(1000);
    mask.fill(1, 10, 50);
    mask.fill(1, 500, 501);
    mask.fill(1, 990, 1000);
    const runs = encodeExplored(mask);
    expect(runs).toEqual([10, 40, 500, 1, 990, 10]);
    const out = new Uint8Array(1000);
    decodeExplored(runs, out);
    expect(Array.from(out)).toEqual(Array.from(mask));
  });
  it("empty mask -> empty runs", () => {
    expect(encodeExplored(new Uint8Array(100))).toEqual([]);
  });
});

describe("v1 migration", () => {
  it("v1 save loads as v3 with empty exploredRuns", () => {
    const v1 = { version: 1, seed: 9, changes: [5, 0], currency: 10, upgradePoints: 1, upgrades: {}, ballsOwned: { white: 3 }, stats: { pixelsMined: 4, startedAt: 123, won: false } };
    localStorage.setItem("tmp-save", JSON.stringify(v1));
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(3);
    expect(loaded!.exploredRuns).toEqual([]);
    expect(loaded!.currency).toBe(10);
  });
});

describe("save v3", () => {
  it("v2 save migrates to v3 with empty augments", () => {
    const v2 = { version: 2, seed: 5, changes: [], currency: 1, upgradePoints: 0, upgrades: {}, ballsOwned: { white: 1 }, stats: { pixelsMined: 0, startedAt: 1, won: false }, exploredRuns: [] };
    localStorage.setItem("tmp-save", JSON.stringify(v2));
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(3);
    expect(loaded!.augments).toEqual([]);
    expect(loaded!.augmentRngState).toBe(13);
  });

  it("v1 save migrates all the way to v3", () => {
    const v1 = { version: 1, seed: 9, changes: [], currency: 10, upgradePoints: 1, upgrades: {}, ballsOwned: { white: 3 }, stats: { pixelsMined: 4, startedAt: 123, won: false } };
    localStorage.setItem("tmp-save", JSON.stringify(v1));
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(3);
    expect(loaded!.augments).toEqual([]);
    expect(loaded!.currency).toBe(10);
  });

  it("normalizeSave coerces a malformed augments/augmentRngState", () => {
    const raw = {
      version: 3, seed: 5, changes: [], currency: 0, upgradePoints: 0, upgrades: {},
      ballsOwned: { white: 1 }, stats: { pixelsMined: 0, startedAt: 1, won: false },
      exploredRuns: [], augments: "not-an-array", augmentRngState: "nope",
    } as unknown as SaveData;
    const normalized = normalizeSave(raw);
    expect(normalized.augments).toEqual([]);
    expect(normalized.augmentRngState).toBe(13);
  });

  it("normalizeSave preserves valid augments", () => {
    const raw = {
      version: 3, seed: 5, changes: [], currency: 0, upgradePoints: 0, upgrades: {},
      ballsOwned: { white: 1 }, stats: { pixelsMined: 0, startedAt: 1, won: false },
      exploredRuns: [], augments: ["aug_momentum", "aug_blast"], augmentRngState: 999,
    } as unknown as SaveData;
    const normalized = normalizeSave(raw);
    expect(normalized.augments).toEqual(["aug_momentum", "aug_blast"]);
    expect(normalized.augmentRngState).toBe(999);
  });
});
