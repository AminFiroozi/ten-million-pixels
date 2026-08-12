# Ten Million Pixels Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web clone of "10 Million Pixels": balls bounce in a 1280x800 procedurally generated pixel world, breaking pixels for currency, buying/upgrading 7 ball types, until the player finds the one Golden Pixel.

**Architecture:** Vite + TypeScript, Canvas 2D. World is a `Uint8Array` grid; rendering is chunked offscreen canvases with dirty tracking; physics is fixed-timestep grid collision; UI is DOM overlays. Save = seed + diff vs regenerated baseline in localStorage.

**Tech Stack:** Vite, TypeScript, vitest, Canvas 2D. No runtime dependencies.

## Global Constraints

- Project root: `D:\programming\Games\ten-million-pixels`
- World size: exactly `WORLD_W = 1280`, `WORLD_H = 800` (1,024,000 cells)
- No runtime npm dependencies (devDependencies only: vite, typescript, vitest)
- No code comments, no emojis in code
- 60 fps target with thousands of balls; only dirty chunks re-rasterized
- All randomness in worldgen/logic must flow through the seeded RNG (determinism-testable). `Math.random` allowed only for cosmetic particles.
- Spec: `docs/superpowers/specs/2026-08-12-ten-million-pixels-design.md`
- Commit after each task with conventional commit messages

---

### Task 1: Scaffold + seeded RNG + value noise

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- Create: `src/rng.ts`
- Test: `tests/rng.test.ts`

**Interfaces:**
- Produces:
  - `mulberry32(seed: number): () => number` — deterministic PRNG, returns floats in [0,1)
  - `hashCoords(x: number, y: number, seed: number): number` — stateless hash → [0,1)
  - `valueNoise2D(x: number, y: number, seed: number, scale: number): number` — smooth interpolated noise → [0,1)

- [ ] **Step 1: Scaffold project**

`package.json`:

```json
{
  "name": "ten-million-pixels",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, include `src` and `tests`.

`index.html`: minimal — `<canvas id="game"></canvas>`, `<div id="ui"></div>`, `<script type="module" src="/src/main.ts">`. Dark background via inline style `html,body{margin:0;background:#050a06;overflow:hidden}`.

`.gitignore`: `node_modules`, `dist`.

Run `npm install`.

- [ ] **Step 2: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mulberry32, hashCoords, valueNoise2D } from "../src/rng";

describe("rng", () => {
  it("mulberry32 is deterministic per seed", () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it("hashCoords stateless and seed-sensitive", () => {
    expect(hashCoords(5, 9, 1)).toBe(hashCoords(5, 9, 1));
    expect(hashCoords(5, 9, 1)).not.toBe(hashCoords(5, 9, 2));
    expect(hashCoords(5, 9, 1)).not.toBe(hashCoords(9, 5, 1));
  });
  it("valueNoise2D smooth-ish and bounded", () => {
    for (let i = 0; i < 100; i++) {
      const v = valueNoise2D(i * 3.7, i * 1.3, 7, 32);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const d = Math.abs(valueNoise2D(10, 10, 7, 32) - valueNoise2D(11, 10, 7, 32));
    expect(d).toBeLessThan(0.2);
  });
});
```

- [ ] **Step 3: Run tests, verify FAIL** — `npm test` → module not found.

- [ ] **Step 4: Implement `src/rng.ts`**

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashCoords(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(x: number, y: number, seed: number, scale: number): number {
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = smooth(gx - x0), fy = smooth(gy - y0);
  const v00 = hashCoords(x0, y0, seed), v10 = hashCoords(x0 + 1, y0, seed);
  const v01 = hashCoords(x0, y0 + 1, seed), v11 = hashCoords(x0 + 1, y0 + 1, seed);
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}
```

- [ ] **Step 5: Run tests, verify PASS.**
- [ ] **Step 6: Commit** — `feat: scaffold project with seeded rng and value noise`

---

### Task 2: World generation + mining API

**Files:**
- Create: `src/world.ts`, `src/stamps.ts`
- Test: `tests/world.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `hashCoords`, `valueNoise2D` from `src/rng`
- Produces:
  - `WORLD_W = 1280`, `WORLD_H = 800`, `CELL = { EMPTY:0, SOFT:1, MED:2, HARD:3, UPGRADE:4, GOLD:5, OBJECT:6 }`, `CELL_HP: number[]` = `[0,1,3,8,1,1,2]`
  - `class World { seed: number; cells: Uint8Array; goldenIndex: number; }`
    - `World.generate(seed: number): World`
    - `idx(x: number, y: number): number` — `y * WORLD_W + x`
    - `get(x: number, y: number): number` — out of bounds returns `-1`
    - `isSolid(x: number, y: number): boolean` — out of bounds → `true`
    - `hit(x: number, y: number, dmg: number): number` — applies damage; returns destroyed cell value, or `0` if not destroyed / empty. Destroyed cell set to `EMPTY`, damage entry cleared.
    - `onCellChanged?: (x: number, y: number) => void` — assignable callback, called whenever a cell value changes (renderer subscribes later)
  - `src/stamps.ts`: `STAMPS: number[][][]` — at least 5 hand-drawn bitmap stamps (skull, sword, heart, key, diamond), each a 2D array of 0/1, roughly 9x9 to 15x15

- [ ] **Step 1: Write failing tests**

```ts
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
    let fx = -1;
    outer: for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++)
      if (w.get(x, y) === CELL.MED) { fx = x; var fy = y; break outer; }
    expect(w.hit(fx, fy!, 1)).toBe(0);
    expect(w.hit(fx, fy!, 1)).toBe(0);
    expect(w.hit(fx, fy!, 1)).toBe(CELL.MED);
    expect(w.get(fx, fy!)).toBe(CELL.EMPTY);
    expect(w.hit(fx, fy!, 1)).toBe(0);
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
```

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement `src/stamps.ts` and `src/world.ts`**

Stamps: hand-write 5+ small 0/1 bitmaps (skull, sword, heart, key, diamond). Example heart:

```ts
export const STAMPS: number[][][] = [
  [
    [0,1,1,0,1,1,0],
    [1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1],
    [0,1,1,1,1,1,0],
    [0,0,1,1,1,0,0],
    [0,0,0,1,0,0,0],
  ],
];
```

(Write the other stamps by hand in the same style — any recognizable shapes.)

`World.generate(seed)` algorithm, in order:
1. Fill terrain: for each cell, `d = valueNoise2D(x, y, seed, 48)` (density) and `h = valueNoise2D(x, y, seed + 1, 96)` (hardness field). If `d < 0.12` → EMPTY (natural caves), else hardness: compute `edge = max(|x - W/2| / (W/2), |y - H/2| / (H/2))` (0 center → 1 edge); `hard = h * 0.5 + edge * 0.5`; `hard < 0.45` → SOFT, `< 0.72` → MED, else HARD.
2. Stamp objects: `rng = mulberry32(seed + 2)`; place 40 stamps at random positions (skip if any overlap with cavity area); stamp cells with value 1 in bitmap → OBJECT.
3. Upgrade pixels: `rng2 = mulberry32(seed + 3)`; iterate 400 attempts, pick random x,y; if cell is terrain (1-3) and `edge > 0.15`, set UPGRADE. (Yields >50 comfortably.)
4. Carve spawn cavity: circle radius 22 at (W/2, H/2) → EMPTY.
5. Golden pixel: `rng3 = mulberry32(seed + 4)`; loop: random x,y until `edge > 0.8` and cell is terrain; set GOLD; store `goldenIndex`.

`hit`: if `get(x,y) <= 0` return 0. `hp = CELL_HP[cell]`; damage map keyed by index; `dmg accum >= hp` → set EMPTY, delete damage entry, call `onCellChanged?.(x, y)`, return cell value.

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add world generation and mining`

---

### Task 3: Save/load (diff serialization + localStorage)

**Files:**
- Create: `src/save.ts`
- Test: `tests/save.test.ts`

**Interfaces:**
- Consumes: `World`, `World.generate`
- Produces:
  - `interface SaveData { version: 1; seed: number; changes: number[]; currency: number; upgradePoints: number; upgrades: Record<string, number>; ballsOwned: Record<string, number>; stats: { pixelsMined: number; startedAt: number; won: boolean } }`
  - `diffWorld(world: World): number[]` — flat pairs `[idx, val, idx, val, ...]` vs regenerated baseline, idx delta-encoded (each idx stored as difference from previous idx)
  - `applyDiff(world: World, changes: number[]): void`
  - `saveGame(data: SaveData): void` / `loadGame(): SaveData | null` — localStorage key `tmp-save`, JSON; `loadGame` returns null on missing/corrupt/version-mismatch (wrap JSON.parse in try/catch)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { World, CELL, WORLD_W } from "../src/world";
import { diffWorld, applyDiff } from "../src/save";

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
});
```

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement `src/save.ts`**

`diffWorld`: regenerate `World.generate(world.seed)`, walk both arrays, collect `[idx - prevIdx, val]` pairs where different. `applyDiff`: walk pairs accumulating idx, set values. `saveGame`/`loadGame` straightforward JSON + try/catch + version check.

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add save serialization with baseline diff`

---

### Task 4: Economy + upgrade tree

**Files:**
- Create: `src/economy.ts`
- Test: `tests/economy.test.ts`

**Interfaces:**
- Consumes: `CELL` from `src/world`
- Produces:
  - `type BallType = "white" | "blue" | "red" | "green" | "orange" | "yellow" | "purple"`
  - `BALL_ORDER: BallType[]` in that order
  - `interface EconomyState { currency: number; upgradePoints: number; ballsOwned: Record<BallType, number>; upgrades: Record<string, number> }`
  - `newEconomy(): EconomyState` — starts `currency: 0`, `upgradePoints: 0`, `ballsOwned` all 0 except `white: 1`
  - `ballCost(type: BallType, owned: number): number` — `Math.ceil(BASE[type] * 1.15 ** owned)`; `BASE = { white: 10, blue: 50, red: 120, green: 200, orange: 350, yellow: 600, purple: 1000 }`
  - `buyBall(s: EconomyState, t: BallType): boolean` — needs currency and type unlocked (`isUnlocked`)
  - `isUnlocked(s: EconomyState, t: BallType): boolean` — white always; others when upgrade node `unlock_<type>` bought
  - `pixelValue(cell: number): number` — SOFT 1, MED 2, HARD 4, OBJECT 3, UPGRADE 2, GOLD 0
  - `UPGRADE_TREE: UpgradeNode[]` where `interface UpgradeNode { id: string; name: string; desc: string; cost: number; max: number; requires?: string; stat?: string; amount?: number; unlocksBall?: BallType }`
  - `buyUpgrade(s: EconomyState, id: string): boolean` — checks upgradePoints >= cost, level < max, requires bought
  - `statMul(s: EconomyState, stat: "speed" | "damage"): number` — `1 + level * amount` summed over matching nodes
  - `abilityLevel(s: EconomyState, stat: string): number` — raw level for ability stats (smashRadius, poisonSpread, splitCount, pierceDepth)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { newEconomy, ballCost, buyBall, buyUpgrade, isUnlocked, statMul, pixelValue, UPGRADE_TREE } from "../src/economy";
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
```

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement `src/economy.ts`**

`UPGRADE_TREE` must contain at minimum: `unlock_<type>` for the 6 non-white types (cost 2..8 ascending by BALL_ORDER), `speed_1` (max 5, amount 0.08), `speed_2` (max 5, amount 0.08, requires speed_1), `damage_1` (max 5, amount 0.1), `damage_2` (max 5, amount 0.1, requires damage_1), `smashRadius` (max 3, amount 1, requires unlock_red), `poisonSpread` (max 3, amount 1, requires unlock_green), `splitCount` (max 2, amount 1, requires unlock_orange), `pierceDepth` (max 3, amount 1, requires unlock_yellow). Give each a short name/desc.

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add economy and upgrade tree`

---

### Task 5: Physics — ball motion, collision, mining hook

**Files:**
- Create: `src/physics.ts`
- Test: `tests/physics.test.ts`

**Interfaces:**
- Consumes: `World`, `CELL`; `BallType`
- Produces:
  - `interface Ball { x: number; y: number; vx: number; vy: number; type: BallType; ttl: number; pierceLeft: number }` (`ttl` in seconds, `-1` = infinite)
  - `interface AbilityStats { speedMul: number; dmgMul: number; smashRadius: number; poisonSpread: number; splitCount: number; pierceDepth: number }`
  - `type MineCallback = (cell: number, x: number, y: number) => void`
  - `class Physics { balls: Ball[]; poison: Map<number, number>; constructor(world: World); spawn(type: BallType, x: number, y: number, angle: number): void; step(dt: number, stats: AbilityStats, onMined: MineCallback): void }`
  - Base speed 90 px/s (cells/s), scaled by `speedMul`; base damage 1 scaled by `dmgMul` (purple 5x)
  - Movement substeps: advance in increments of at most 0.9 cells so balls never tunnel
  - Collision resolution: on solid target cell, test `(newX, oldY)` and `(oldX, newY)` solidity to pick reflection axis (flip `vx`, `vy`, or both), apply damage to the hit cell
  - Poison tick: every `step`, accumulate time; each 0.5 s, every poisoned cell index takes 1 damage and with probability `0.15 * poisonSpread` infects one random orthogonal solid neighbor (seeded RNG stored on Physics, seed = world.seed)
  - NaN guard: after moving, cull any ball with non-finite x/y/vx/vy; cull ttl-expired balls

- [ ] **Step 1: Write failing tests**

```ts
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
});
```

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement `src/physics.ts`**

`spawn`: push ball with `vx = cos(angle) * 90`, `vy = sin(angle) * 90`, `ttl: -1` (shards get ttl 3 in Task 6), `pierceLeft: 0`.

`step(dt, stats, onMined)`:
1. For each ball: total distance `= 90 * stats.speedMul * dt * (type === "purple" ? 0.6 : 1)`; loop substeps of ≤0.9 cells: candidate `nx = x + vx_norm * sub`, `ny = y + vy_norm * sub`; if `world.isSolid(floor(nx), floor(ny))` → resolve collision (Task 6 hooks abilities here), else commit position.
2. Collision resolve (base): `hitX = floor(nx)`, `hitY = floor(ny)`; solidX = `world.isSolid(floor(nx), floor(y))`; solidY = `world.isSolid(floor(x), floor(ny))`; flip `vx` if solidX, flip `vy` if solidY, flip both if neither (corner). Damage = `1 * stats.dmgMul * (type === "purple" ? 5 : 1)`; `const destroyed = world.hit(hitX, hitY, damage)`; if destroyed → `onMined(destroyed, hitX, hitY)`.
3. Out-of-bounds cells are solid via `isSolid`, so world edges reflect automatically.
4. Poison tick per spec above; destroyed-by-poison cells also call `onMined`.
5. Cull non-finite and expired (`ttl` decremented by dt when >= 0).

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add ball physics with grid collision`

---

### Task 6: Ball abilities

**Files:**
- Modify: `src/physics.ts`
- Test: `tests/abilities.test.ts`

**Interfaces:**
- Consumes: everything from Task 5
- Produces: ability behavior on collision, switched by `ball.type`:
  - `blue`: on spawn and after every reflection, snap velocity to dominant axis (pure horizontal or vertical, keep speed)
  - `red`: on impact, additionally `world.hit` every solid cell within Chebyshev radius `stats.smashRadius` of impact at same damage
  - `green`: on impact, add hit cell index to `poison` map (if still solid after hit)
  - `orange`: on impact, spawn `stats.splitCount` shard balls at impact point with random angles (`this.rng`), `ttl: 3`, type `"white"` behavior but keep type tag `"orange-shard"` excluded — instead: shards are type `"white"` balls with `ttl: 3`
  - `yellow`: on impact, if `pierceLeft > 0` → destroy cell outright (`world.hit(x, y, 999)`), decrement `pierceLeft`, do NOT reflect, continue moving; when `pierceLeft === 0` reflect normally; `pierceLeft` reset to `stats.pierceDepth` after each reflection
  - `purple`: 0.6x speed, 5x damage (already in Task 5); on destroying a cell, does not reflect — continues through

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run tests, verify FAIL.**
- [ ] **Step 3: Implement abilities in collision-resolve switch per interface list above.** Shards: `spawn` internally, then set `ttl = 3` on the spawned ball. Yellow: initialize `pierceLeft = stats.pierceDepth` at spawn.
- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add unique ball abilities`

---

### Task 7: Renderer — chunks, camera, palette, particles

**Files:**
- Create: `src/render.ts`
- Test: `tests/camera.test.ts` (camera math only; visual output verified in Task 9)

**Interfaces:**
- Consumes: `World`, `CELL`, `hashCoords`; `Ball`
- Produces:
  - `interface Camera { x: number; y: number; zoom: number }` (world coords of viewport center; zoom = screen px per world cell, clamp 0.5..24)
  - `worldToScreen(cam: Camera, w: number, h: number, x: number, y: number): [number, number]`
  - `screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number): [number, number]`
  - `class Renderer { constructor(world: World, canvas: HTMLCanvasElement); markDirty(x: number, y: number): void; addBurst(x: number, y: number, color: string): void; draw(cam: Camera, balls: Ball[], dt: number): void }`
  - `CHUNK = 64`; chunk canvases created lazily; `markDirty` flags chunk containing (x,y); wired to `world.onCellChanged` by caller
  - `cellColor(cell: number, x: number, y: number, seed: number): string` — palette: SOFT bright neon mix (green/orange/red picked by `hashCoords`), MED same hues darker, HARD desaturated gray-green, UPGRADE pulsing yellow-white, GOLD gold, OBJECT white; EMPTY not drawn (background shows)
  - Balls drawn as 3px glowing dots in their type color (`BALL_COLORS: Record<BallType, string>`: white #fff, blue #4af, red #f44, green #5f5, orange #fa4, yellow #ff5, purple #b4f)
  - Particles: simple array `{x,y,vx,vy,life,color}`, spawned by `addBurst` (6 particles), updated/drawn in `draw`, `Math.random` allowed

- [ ] **Step 1: Write failing camera tests**

```ts
import { describe, it, expect } from "vitest";
import { worldToScreen, screenToWorld } from "../src/render";

describe("camera transforms", () => {
  const cam = { x: 640, y: 400, zoom: 4 };
  it("center maps to screen center", () => {
    expect(worldToScreen(cam, 800, 600, 640, 400)).toEqual([400, 300]);
  });
  it("roundtrip", () => {
    const [sx, sy] = worldToScreen(cam, 800, 600, 100, 200);
    const [wx, wy] = screenToWorld(cam, 800, 600, sx, sy);
    expect(wx).toBeCloseTo(100);
    expect(wy).toBeCloseTo(200);
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement `src/render.ts`**

Transforms: `sx = (x - cam.x) * cam.zoom + w / 2`, inverse accordingly — keep these pure functions (no DOM) so vitest runs without a browser.

Renderer: chunk grid `ceil(1280/64) x ceil(800/64)`; each chunk an `OffscreenCanvas` (fallback `document.createElement("canvas")`) of 64x64 px, 1px per cell, rasterized with `cellColor`; dirty set of chunk ids. `draw`: clear main canvas with `#050a06`; compute visible chunk range from camera; re-rasterize dirty visible chunks; `imageSmoothingEnabled = false`; `drawImage` each visible chunk scaled by zoom; draw balls (screen-space circles with `shadowBlur = 8`, `shadowColor` = ball color); update+draw particles; UPGRADE/GOLD pulse via time-based alpha overlay on those cells (track their coords per chunk at raster time in a small list).

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add chunked renderer with camera and particles`

---

### Task 8: UI — HUD, shop, upgrade tree, minimap, win screen

**Files:**
- Create: `src/ui.ts`, `src/style.css` (imported from main in Task 9; for this task import in ui.ts)
- Test: manual (DOM UI); logic it drives is already tested

**Interfaces:**
- Consumes: `EconomyState`, `BALL_ORDER`, `ballCost`, `buyBall`, `buyUpgrade`, `isUnlocked`, `UPGRADE_TREE`, `statMul`; `World`, `CELL`; `Camera`
- Produces:
  - `class UI { constructor(root: HTMLElement, economy: EconomyState, world: World); update(): void; drawMinimap(cam: Camera): void; showWin(stats: { pixelsMined: number; seconds: number; ballCount: number }): void; onBuyBall?: (t: BallType) => void }`
- Layout (all DOM in `#ui`, absolutely positioned over canvas, `pointer-events: none` on container, `auto` on panels):
  - Top-left HUD: currency count (big), upgrade points, pixels mined
  - Bottom bar shop: one button per ball type in `BALL_ORDER` — shows color dot, owned count, next cost; disabled when locked/unaffordable; locked types show lock glyph
  - Right panel (toggle with `U` key or button): upgrade tree — grid of square icon buttons colored by related ball, tooltip on hover via `title` + custom div showing name/desc/cost/level, click buys
  - Bottom-right minimap: 160x100 canvas; every frame draw downsampled world (sample every 8th cell) + white viewport rectangle; cache the downsample and refresh at most every 500 ms
  - Win overlay: fullscreen dark overlay, "GOLDEN PIXEL FOUND", stats lines, Continue + New Run buttons (`New Run` clears localStorage and reloads)
- Style: `style.css` — monospace/pixel look (`font-family: "Courier New", monospace; font-weight: bold`), dark panels `rgba(0,20,8,0.85)`, neon green text `#7dff9a`, buttons with 2px solid borders in ball colors
- `update()` refreshes all text/disabled states; call it only when economy changes (dirty flag set by main), not per frame

- [ ] **Step 1: Implement `src/ui.ts` + `src/style.css` per interface above.** Build DOM with `document.createElement`, no framework.
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` passes.
- [ ] **Step 3: Commit** — `feat: add hud shop upgrade tree minimap and win screen`

---

### Task 9: Main loop, input, autosave — playable game

**Files:**
- Create: `src/main.ts`
- Modify: `index.html` (if canvas sizing needs it)
- Test: manual playtest via `npm run dev` + all unit tests green

**Interfaces:**
- Consumes: everything above
- Produces: complete game wiring:

1. Boot: `loadGame()`; if save → `World.generate(save.seed)` + `applyDiff` + restore economy/stats; else new seed `(Date.now() >>> 0)`, `newEconomy()`.
2. Canvas sized to window, resize handler; `Renderer`; `world.onCellChanged = (x, y) => { renderer.markDirty(x, y); }`.
3. `Physics`; respawn owned balls at spawn cavity center with random angles (balls are not individually persisted — count restored from `ballsOwned`).
4. Fixed timestep: accumulator, `SIM_DT = 1/120`, max 5 sim steps per frame; render each rAF.
5. `onMined(cell, x, y)`: `economy.currency += pixelValue(cell) ; stats.pixelsMined++`; `renderer.addBurst`; if `cell === CELL.UPGRADE` → `upgradePoints++`; if `cell === CELL.GOLD` → `stats.won = true; ui.showWin(...)`; mark UI dirty.
6. Input:
   - Left click: launch one wave — every owned ball not yet in flight this run spawns from cavity center aimed at `screenToWorld(cursor)` with ±0.15 rad random spread; if all already spawned, click re-aims nothing (balls persist). Simplest model: track `spawnedCount`; each click spawns `min(20, ownedTotal - spawnedCount)` balls toward cursor.
   - Right-drag or WASD/arrows: pan camera; wheel: zoom toward cursor; `U`: toggle upgrade panel.
   - Buying a ball (shop) increments owned; next click spawns it.
7. `AbilityStats` built each frame from economy: `speedMul = statMul(s,"speed")`, `dmgMul = statMul(s,"damage")`, `smashRadius = 1 + abilityLevel("smashRadius")`, `poisonSpread = 1 + abilityLevel("poisonSpread")`, `splitCount = 1 + abilityLevel("splitCount")`, `pierceDepth = 1 + abilityLevel("pierceDepth")`.
8. Autosave: `setInterval` 10 s + `visibilitychange` → `saveGame({ version:1, seed, changes: diffWorld(world), ...economy, stats })`.
9. rAF callback wrapped in try/catch → on repeated fatal error, overlay "Error — reload" and stop loop.

- [ ] **Step 1: Implement `src/main.ts` per wiring list.**
- [ ] **Step 2: Run `npm test`** — all green.
- [ ] **Step 3: Run `npx tsc --noEmit`** — clean.
- [ ] **Step 4: Manual playtest with `npm run dev`:** balls spawn on click and mine; currency rises; buy ball works; upgrade panel opens, unlock blue works; pan/zoom works; minimap shows viewport; reload restores state.
- [ ] **Step 5: Commit** — `feat: wire game loop input and autosave`

---

### Task 10: Performance + polish pass

**Files:**
- Modify: `src/render.ts`, `src/physics.ts` as profiling dictates
- Test: manual perf check + unit tests stay green

- [ ] **Step 1: Stress test** — dev console: grant currency (`window.__game.economy.currency = 1e6` — expose `window.__game = { economy, physics, world }` in main for dev), buy ~2000 white balls, spawn all. Check fps in devtools performance tab.
- [ ] **Step 2: If below ~55 fps:** pre-render ball sprites per type to small offscreen canvases (glow baked in) and `drawImage` instead of `arc + shadowBlur` (shadowBlur is the usual killer); cap particles at 500.
- [ ] **Step 3: Run `npm test`** — still green.
- [ ] **Step 4: Commit** — `perf: optimize ball rendering for thousands of balls`

---

## Self-review notes

- Spec coverage: worldgen/mining (T2), save (T3), economy/tree (T4), physics (T5), 7 abilities (T6), chunked render+camera+particles (T7), HUD/shop/tree-UI/minimap/win (T8), loop/input/autosave/NaN-guard/error overlay (T9), perf target (T10). Sound and touch: out of scope per spec.
- Type names cross-checked: `World.hit` returns destroyed cell value (number), used by `Physics` and `onMined`. `AbilityStats` field names match economy-derived construction in T9.
- Blue directional per press kit "only vertical/horizontal" → axis snap on spawn/reflect (T6).
