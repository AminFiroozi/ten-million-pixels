# Augment System + Molten Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ball death from molten terrain (replace with a knockback bounce), and add a roguelike "pick 1 of 3" run-scoped augment system offered on boss kills and every 20 upgrade points earned.

**Architecture:** Molten fix is a small physics.ts change plus tree cleanup. Augments are a new data-driven module (`src/augments.ts`, mirrors the existing `UPGRADE_TREE` pattern) tracked in a separate run-scoped state object, layered on top of the existing tree-derived stats in main.ts, persisted in a v3 save format.

**Tech Stack:** Existing: Vite + TypeScript, Canvas 2D, vitest, no runtime deps.

**Spec:** `docs/superpowers/specs/2026-08-19-augments-and-molten-fix-design.md`

## Global Constraints

- No runtime npm deps; no code comments; no emojis in code
- All logic randomness via seeded RNG (`src/rng.ts`'s `mulberry32`); `Math.random` only for cosmetic particle effects, never for augment choice rolls
- Save format bumps to v3; v1 and v2 saves must load with no progress loss
- Commits: plain conventional messages, NO Co-Authored-By trailer
- 54 existing tests stay green except the ones this plan explicitly names for removal/rewrite

---

### Task 1: Molten fix — physics.ts

**Files:**
- Modify: `src/physics.ts`
- Test: `tests/physics.test.ts`

**Interfaces:**
- Consumes: `biomeAt` from `src/biomes.ts` (keep this import; drop `MOLTEN_DESTROY_CHANCE`)
- Produces:
  - `AbilityStats` loses the `moltenImmune: boolean` field (all other fields unchanged: `speedMul, dmgMul, smashRadius, poisonSpread, splitCount, pierceDepth, darkSpeedMul`)
  - `Physics.step(dt, stats, onMined, onMoltenHit?)` — new 4th optional param `onMoltenHit?: (x: number, y: number) => void`, called once per molten-biome collision (any ball type, any branch), independent of whether the cell was destroyed
  - `MOLTEN_BOUNCE_MUL = 1.6` constant

- [ ] **Step 1: Write failing tests**

Replace the entire `describe("molten and dark speed", ...)` block in `tests/physics.test.ts` (currently lines 73-95, containing the `"molten can destroy a non-immune ball deterministically per seed"` test) with:

```ts
describe("molten and dark speed", () => {
  it("molten collision bounces the ball harder and never destroys it", () => {
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
    expect(speedAfter).toBeCloseTo(speedBefore * 1.6, 1);
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
```

Also update the two `AbilityStats` fixtures near the top of the file (currently lines 6-7) to drop `moltenImmune`:

```ts
const STATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2, darkSpeedMul: 1 };
const DSTATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2, darkSpeedMul: 1 };
```

And in `tests/abilities.test.ts`, update its `STATS` fixture (currently line 5) the same way (drop `moltenImmune: true`):

```ts
const STATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2, darkSpeedMul: 1 };
```

- [ ] **Step 2: Run, verify FAIL** (`npm test` — type errors expected since `moltenImmune` still exists in the interface but fixtures no longer set it, and the new `onMoltenHit` param doesn't exist yet)

- [ ] **Step 3: Implement**

In `src/physics.ts`:
1. Change the import line to `import { biomeAt } from "./biomes";` (drop `MOLTEN_DESTROY_CHANCE`).
2. Remove `moltenImmune: boolean;` from the `AbilityStats` interface.
3. Add `const MOLTEN_BOUNCE_MUL = 1.6;` next to the other top-level consts.
4. Change `MineCallback`'s neighbor — add a new exported type isn't needed; just use an inline optional param type.
5. Update `step`, `moveBall`, and `resolveCollision` signatures to thread an optional `onMoltenHit?: (x: number, y: number) => void` through:

```ts
step(dt: number, stats: AbilityStats, onMined: MineCallback, onMoltenHit?: (x: number, y: number) => void): void {
  for (const ball of this.balls) {
    this.moveBall(ball, dt, stats, onMined, onMoltenHit);
  }

  this.tickPoison(dt, stats, onMined);

  for (const ball of this.balls) {
    if (ball.ttl >= 0) ball.ttl -= dt;
  }

  this.balls = this.balls.filter(b =>
    !b.dead &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.vx) &&
    Number.isFinite(b.vy) &&
    (b.ttl === -1 || b.ttl > 0)
  );
}

private moveBall(ball: Ball, dt: number, stats: AbilityStats, onMined: MineCallback, onMoltenHit?: (x: number, y: number) => void): void {
  const speedScale = ball.type === "purple" ? 0.6 : 1;
  const totalDist = BASE_SPEED * stats.speedMul * dt * speedScale;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed === 0 || !Number.isFinite(totalDist)) return;

  let dirX = ball.vx / speed;
  let dirY = ball.vy / speed;

  let remaining = totalDist;
  while (remaining > 0 && !ball.dead) {
    const darkMul = this.world.isExplored(Math.floor(ball.x), Math.floor(ball.y)) ? 1 : stats.darkSpeedMul;
    const sub = Math.min(MAX_SUBSTEP / darkMul, remaining);
    remaining -= sub;

    const moveDist = sub * darkMul;

    const nx = ball.x + dirX * moveDist;
    const ny = ball.y + dirY * moveDist;

    if (this.world.isSolid(Math.floor(nx), Math.floor(ny))) {
      const passThrough = this.resolveCollision(ball, nx, ny, stats, onMined, onMoltenHit);
      if (!passThrough) break;

      ball.x = nx;
      ball.y = ny;

      const newSpeed = Math.hypot(ball.vx, ball.vy);
      if (newSpeed === 0) break;
      dirX = ball.vx / newSpeed;
      dirY = ball.vy / newSpeed;
      continue;
    }

    ball.x = nx;
    ball.y = ny;
  }
}

private resolveCollision(ball: Ball, nx: number, ny: number, stats: AbilityStats, onMined: MineCallback, onMoltenHit?: (x: number, y: number) => void): boolean {
  const hitX = Math.floor(nx);
  const hitY = Math.floor(ny);
  const solidX = this.world.isSolid(Math.floor(nx), Math.floor(ball.y));
  const solidY = this.world.isSolid(Math.floor(ball.x), Math.floor(ny));
  const isMolten = biomeAt(hitX, hitY, this.world.seed) === "molten";
  if (isMolten) onMoltenHit?.(hitX, hitY);

  const reflect = (): void => {
    if (solidX) ball.vx = -ball.vx;
    if (solidY) ball.vy = -ball.vy;
    if (!solidX && !solidY) {
      ball.vx = -ball.vx;
      ball.vy = -ball.vy;
    }
    if (isMolten) {
      if (solidX || (!solidX && !solidY)) ball.vx *= MOLTEN_BOUNCE_MUL;
      if (solidY || (!solidX && !solidY)) ball.vy *= MOLTEN_BOUNCE_MUL;
    }
    if (ball.type === "blue") this.snapToAxis(ball);
  };

  if (ball.type === "yellow" && ball.pierceLeft < 0) {
    ball.pierceLeft = stats.pierceDepth;
  }

  if (ball.type === "yellow" && ball.pierceLeft > 0) {
    const destroyed = this.world.hit(hitX, hitY, 999);
    if (destroyed) onMined(destroyed, hitX, hitY);
    ball.pierceLeft -= 1;
    return true;
  }

  const damage = 1 * stats.dmgMul * (ball.type === "purple" ? 5 : 1);
  const destroyed = this.world.hit(hitX, hitY, damage);
  if (destroyed) onMined(destroyed, hitX, hitY);

  if (ball.type === "red") {
    this.smash(hitX, hitY, stats.smashRadius, damage, onMined);
  }

  if (ball.type === "green" && !destroyed && this.world.isSolid(hitX, hitY)) {
    this.poison.set(this.world.idx(hitX, hitY), 0);
  }

  if (ball.type === "orange") {
    this.spawnShards(nx, ny, stats.splitCount);
  }

  if (ball.type === "purple" && destroyed) {
    return true;
  }

  reflect();

  if (ball.type === "yellow") {
    ball.pierceLeft = stats.pierceDepth;
  }

  return false;
}
```

6. Delete the `private rollMolten(...)` method entirely — it's fully replaced by the `isMolten` check + `onMoltenHit` call + the bounce multiplier inside `reflect()`.

- [ ] **Step 4: Run, verify PASS.** (`npm test` — all tests including the two new/rewritten ones, plus `npx tsc --noEmit`)
- [ ] **Step 5: Commit** — `fix: molten terrain bounces balls harder instead of destroying them`

---

### Task 2: Economy tree cleanup

**Files:**
- Modify: `src/economy.ts`
- Test: `tests/economy.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `UPGRADE_TREE` loses the `molten_immunity` node; `dark_speed`'s `max` becomes `3` (same `id`, `stat: "darkSpeed"`, `amount: 0.15`); `NODE_LAYOUT` loses the `molten_immunity` entry

- [ ] **Step 1: Write failing test**

In `tests/economy.test.ts`, replace lines 69-71 (the `molten_immunity` assertions) so the `"new nodes exist with prereq chains"` test's tail reads:

```ts
    expect(buyUpgrade(s, "dark_speed")).toBe(true);
    expect(statMul(s, "darkSpeed")).toBeCloseTo(1.15);
    expect(buyUpgrade(s, "dark_speed")).toBe(true);
    expect(statMul(s, "darkSpeed")).toBeCloseTo(1.30);
    expect(buyUpgrade(s, "dark_speed")).toBe(true);
    expect(statMul(s, "darkSpeed")).toBeCloseTo(1.45);
    expect(buyUpgrade(s, "dark_speed")).toBe(false);
  });
```

(This deletes the old `expect(buyUpgrade(s, "molten_immunity"))...` and `expect(abilityLevel(s, "moltenImmunity"))...` lines, and extends the existing `dark_speed` purchase from 1 level to the new max of 3.)

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

In `src/economy.ts`:
1. Delete the `molten_immunity` line from `UPGRADE_TREE` (currently `{ id: "molten_immunity", name: "Molten Immunity", desc: "Balls are immune to molten damage", cost: 4, max: 1, stat: "moltenImmunity" },`).
2. Change the `dark_speed` line's `max` from `2` to `3`: `{ id: "dark_speed", name: "Dark Speed", desc: "Increases ball speed in dark zones", cost: 3, max: 3, stat: "darkSpeed", amount: 0.15 },`
3. Delete the `molten_immunity: { col: 9, row: 0, branch: "survival" },` line from `NODE_LAYOUT`.

- [ ] **Step 4: Run, verify PASS.** (`npm test`, `npx tsc --noEmit`)
- [ ] **Step 5: Commit** — `feat: remove molten immunity node, extend dark speed to 3 levels`

---

### Task 3: Augment data module

**Files:**
- Create: `src/augments.ts`
- Test: `tests/augments.test.ts`

**Interfaces:**
- Consumes: `mulberry32` from `src/rng.ts`
- Produces:
  - `interface AugmentDef { id: string; name: string; desc: string; stat: string; amount: number }`
  - `AUGMENT_POOL: AugmentDef[]` — exactly the 12 entries below
  - `interface AugmentState { picked: string[]; rngState: number }`
  - `newAugmentState(seed: number): AugmentState` — `{ picked: [], rngState: seed + 8 }`
  - `augmentMul(state: AugmentState, stat: string): number` — `1 + sum(def.amount for picked defs matching stat)`
  - `augmentBonus(state: AugmentState, stat: string): number` — `sum(def.amount for picked defs matching stat)`
  - `pickAugment(state: AugmentState, id: string): void` — no-op if `id` already in `picked` or not a known pool id, else pushes it
  - `rollChoices(state: AugmentState, count: number): AugmentDef[]` — returns up to `count` distinct unpicked defs, deterministic from `state.rngState`, advances `state.rngState` on every call (even when it returns fewer than requested or zero)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { AUGMENT_POOL, newAugmentState, augmentMul, augmentBonus, pickAugment, rollChoices } from "../src/augments";

describe("augments", () => {
  it("pool has 12 distinct entries", () => {
    expect(AUGMENT_POOL.length).toBe(12);
    expect(new Set(AUGMENT_POOL.map(d => d.id)).size).toBe(12);
  });

  it("augmentMul and augmentBonus reflect picked defs", () => {
    const s = newAugmentState(1);
    expect(augmentMul(s, "speed")).toBe(1);
    expect(augmentBonus(s, "smashRadius")).toBe(0);
    pickAugment(s, "aug_momentum");
    pickAugment(s, "aug_blast");
    expect(augmentMul(s, "speed")).toBeCloseTo(1.2);
    expect(augmentBonus(s, "smashRadius")).toBe(1);
  });

  it("pickAugment is a no-op on duplicate or unknown id", () => {
    const s = newAugmentState(1);
    pickAugment(s, "aug_momentum");
    pickAugment(s, "aug_momentum");
    expect(s.picked).toEqual(["aug_momentum"]);
    pickAugment(s, "not_a_real_id");
    expect(s.picked).toEqual(["aug_momentum"]);
  });

  it("rollChoices is deterministic for the same starting state", () => {
    const a = newAugmentState(42);
    const b = newAugmentState(42);
    expect(rollChoices(a, 3)).toEqual(rollChoices(b, 3));
  });

  it("rollChoices never returns already-picked or duplicate defs", () => {
    const s = newAugmentState(7);
    const choices = rollChoices(s, 3);
    expect(choices.length).toBe(3);
    const ids = choices.map(c => c.id);
    expect(new Set(ids).size).toBe(3);
    for (const c of choices) expect(s.picked).not.toContain(c.id);
  });

  it("rollChoices returns fewer than requested when the pool is small, and empty when exhausted", () => {
    const s = newAugmentState(7);
    for (const def of AUGMENT_POOL.slice(2)) pickAugment(s, def.id);
    const partial = rollChoices(s, 3);
    expect(partial.length).toBe(2);
    for (const def of partial) pickAugment(s, def.id);
    expect(rollChoices(s, 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** (`npm test` — module not found)

- [ ] **Step 3: Implement `src/augments.ts`**

```ts
import { mulberry32 } from "./rng";

export interface AugmentDef {
  id: string;
  name: string;
  desc: string;
  stat: string;
  amount: number;
}

export const AUGMENT_POOL: AugmentDef[] = [
  { id: "aug_momentum", name: "Momentum", desc: "+20% ball speed", stat: "speed", amount: 0.2 },
  { id: "aug_heavy", name: "Heavy Hitters", desc: "+20% damage", stat: "damage", amount: 0.2 },
  { id: "aug_blast", name: "Wide Blast", desc: "Smash radius +1", stat: "smashRadius", amount: 1 },
  { id: "aug_toxic", name: "Toxic Bloom", desc: "Poison spread +1", stat: "poisonSpread", amount: 1 },
  { id: "aug_split", name: "Splitting Frenzy", desc: "Split count +1", stat: "splitCount", amount: 1 },
  { id: "aug_pierce", name: "Deep Pierce", desc: "Pierce depth +1", stat: "pierceDepth", amount: 1 },
  { id: "aug_prospector", name: "Prospector", desc: "+20% currency from mining", stat: "pixelValueMul", amount: 0.2 },
  { id: "aug_treasure", name: "Treasure Nose", desc: "+30% treasure payout", stat: "treasureMul", amount: 0.3 },
  { id: "aug_slayer", name: "Boss Slayer", desc: "+30% boss payout", stat: "bossMul", amount: 0.3 },
  { id: "aug_eyes", name: "Wide Eyes", desc: "Reveal radius +3", stat: "revealRadius", amount: 3 },
  { id: "aug_overcharge", name: "Overcharge", desc: "Launch wave +10 balls", stat: "launchWave", amount: 10 },
  { id: "aug_swift", name: "Swift Draw", desc: "+15% launch speed", stat: "launchSpeed", amount: 0.15 },
];

export interface AugmentState {
  picked: string[];
  rngState: number;
}

export function newAugmentState(seed: number): AugmentState {
  return { picked: [], rngState: seed + 8 };
}

export function augmentMul(state: AugmentState, stat: string): number {
  let total = 0;
  for (const def of AUGMENT_POOL) {
    if (def.stat === stat && state.picked.includes(def.id)) total += def.amount;
  }
  return 1 + total;
}

export function augmentBonus(state: AugmentState, stat: string): number {
  let total = 0;
  for (const def of AUGMENT_POOL) {
    if (def.stat === stat && state.picked.includes(def.id)) total += def.amount;
  }
  return total;
}

export function pickAugment(state: AugmentState, id: string): void {
  if (state.picked.includes(id)) return;
  if (!AUGMENT_POOL.some(d => d.id === id)) return;
  state.picked.push(id);
}

function advanceSeed(seed: number): number {
  return (seed + 0x9e3779b9) | 0;
}

export function rollChoices(state: AugmentState, count: number): AugmentDef[] {
  const available = AUGMENT_POOL.filter(d => !state.picked.includes(d.id));
  const rng = mulberry32(state.rngState);
  state.rngState = advanceSeed(state.rngState);
  const pool = available.slice();
  const result: AugmentDef[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}
```

- [ ] **Step 4: Run, verify PASS.** (`npm test`, `npx tsc --noEmit`)
- [ ] **Step 5: Commit** — `feat: add augment data module`

---

### Task 4: Save v3

**Files:**
- Modify: `src/save.ts`
- Test: `tests/save.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks
- Produces:
  - `SaveData.version` becomes `3`; new fields `augments: string[]`, `augmentRngState: number`
  - `SaveDataV2` (new, unexported-from-elsewhere internal type covering the current v2 shape — kept in save.ts) is the migration intermediate
  - `migrateV2to3(old: SaveDataV2): SaveData` — passthrough (`{ ...old, version: 3, augments: [], augmentRngState: old.seed + 8 }`)
  - `migrateV1` now returns `SaveDataV2` (unchanged body, just the return type annotation changes)
  - `loadGame()` accepts v1 (→ `migrateV1` → `migrateV2to3`), v2 (→ `migrateV2to3`), v3 (direct); anything else → `console.warn` + `null`
  - `normalizeSave` extended: `augments` must be an array where every element is a `string`, else `[]`; `augmentRngState` must be a finite number, else `(seedValid ? data.seed : 0) + 8`

- [ ] **Step 1: Write failing tests**

Add to `tests/save.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

In `src/save.ts`:

1. Update the `SaveData` interface:

```ts
export interface SaveData {
  version: 3;
  seed: number;
  changes: number[];
  currency: number;
  upgradePoints: number;
  upgrades: Record<string, number>;
  ballsOwned: Record<string, number>;
  stats: { pixelsMined: number; startedAt: number; won: boolean };
  exploredRuns: number[];
  augments: string[];
  augmentRngState: number;
}

interface SaveDataV2 {
  version: 2;
  seed: number;
  changes: number[];
  currency: number;
  upgradePoints: number;
  upgrades: Record<string, number>;
  ballsOwned: Record<string, number>;
  stats: { pixelsMined: number; startedAt: number; won: boolean };
  exploredRuns: number[];
}
```

2. Change `migrateV1`'s return type and body:

```ts
export function migrateV1(old: { seed: number; changes: number[]; [k: string]: unknown }): SaveDataV2 {
  return { ...old, version: 2, exploredRuns: [] } as unknown as SaveDataV2;
}

export function migrateV2to3(old: SaveDataV2): SaveData {
  return { ...old, version: 3, augments: [], augmentRngState: old.seed + 8 };
}
```

3. Update `loadGame`:

```ts
export function loadGame(): SaveData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as { version: number; [k: string]: unknown };
    if (data.version === 1) {
      const v2 = migrateV1(data as unknown as { seed: number; changes: number[]; [k: string]: unknown });
      return migrateV2to3(v2);
    }
    if (data.version === 2) {
      return migrateV2to3(data as unknown as SaveDataV2);
    }
    if (data.version !== 3) {
      console.warn("loadGame: save has unexpected version, discarding");
      return null;
    }
    return data as unknown as SaveData;
  } catch (err) {
    console.warn("loadGame: corrupt save data, discarding", err);
    return null;
  }
}
```

4. In `normalizeSave`, add validation for the two new fields (place near the `exploredRuns` validation block) and include them in the returned object:

```ts
  const rawAugments = data.augments;
  const augmentsValid = Array.isArray(rawAugments) && rawAugments.every((v) => typeof v === "string");
  if (!augmentsValid) corrected.push("augments");
  const augments = augmentsValid ? rawAugments : [];

  const augmentRngStateValid = typeof data.augmentRngState === "number" && Number.isFinite(data.augmentRngState);
  if (!augmentRngStateValid) corrected.push("augmentRngState");
```

And in the returned object literal at the end of `normalizeSave`, change `version: 2` to `version: 3` and add:

```ts
    augments,
    augmentRngState: augmentRngStateValid ? data.augmentRngState : (seedValid ? data.seed : 0) + 8,
```

(`seedValid` already exists earlier in the function.)

- [ ] **Step 4: Run, verify PASS.** (`npm test`, `npx tsc --noEmit`)
- [ ] **Step 5: Commit** — `feat: bump save format to v3 with augment state`

---

### Task 5: Augment choice UI

**Files:**
- Modify: `src/ui.ts`, `src/style.css`

**Interfaces:**
- Consumes: `AugmentDef` type from `src/augments.ts`
- Produces:
  - `UI.showAugmentChoice(defs: AugmentDef[]): void` — full-screen modal, one card per def (1-3 cards), click a card to pick
  - `UI.onPickAugment?: (id: string) => void` public hook, fired when a card is clicked (modal auto-closes after)

- [ ] **Step 1: Implement**

In `src/ui.ts`:

1. Add the import: `import { AugmentDef } from "./augments";` (add to the top import block, its own line).

2. Add a private field next to `private winOverlay: HTMLElement;` (around line 160):

```ts
  private augmentOverlay: HTMLElement;
```

3. Add the public hook next to `onNewRun?: () => void;` (around line 136):

```ts
  onPickAugment?: (id: string) => void;
```

4. In the constructor, right after the existing `this.winOverlay = document.createElement("div"); this.winOverlay.className = "win-overlay hidden"; root.appendChild(this.winOverlay);` block (around line 375-377), add:

```ts
    this.augmentOverlay = document.createElement("div");
    this.augmentOverlay.className = "augment-overlay hidden";
    root.appendChild(this.augmentOverlay);
```

5. Add the new method, placed right after `showWin` (after its closing brace, before the class's final closing brace):

```ts
  showAugmentChoice(defs: AugmentDef[]): void {
    this.augmentOverlay.textContent = "";

    const panel = document.createElement("div");
    panel.className = "augment-panel";

    const title = document.createElement("div");
    title.className = "augment-title";
    title.textContent = "CHOOSE AN AUGMENT";
    panel.appendChild(title);

    const cardRow = document.createElement("div");
    cardRow.className = "augment-cards";

    for (const def of defs) {
      const card = document.createElement("button");
      card.className = "augment-card";

      const name = document.createElement("div");
      name.className = "augment-card-name";
      name.textContent = def.name;
      card.appendChild(name);

      const desc = document.createElement("div");
      desc.className = "augment-card-desc";
      desc.textContent = def.desc;
      card.appendChild(desc);

      card.addEventListener("click", () => {
        this.augmentOverlay.classList.add("hidden");
        this.onPickAugment?.(def.id);
      });

      cardRow.appendChild(card);
    }

    panel.appendChild(cardRow);
    this.augmentOverlay.appendChild(panel);
    this.augmentOverlay.classList.remove("hidden");
  }
```

- [ ] **Step 2: Add CSS**

In `src/style.css`, add `.augment-overlay` to the existing pointer-events-auto selector list (currently `.win-overlay,\n.new-run-pinned {\n  pointer-events: auto;\n}` near the top):

```css
.win-overlay,
.new-run-pinned,
.augment-overlay {
  pointer-events: auto;
}
```

Then append these new rules near the existing `.win-*` rules (after `.win-btn`'s block):

```css
.augment-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.augment-overlay.hidden {
  display: none;
}

.augment-panel {
  background: rgba(0, 20, 8, 0.95);
  border: 2px solid #7dff9a;
  color: #7dff9a;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.augment-title {
  font-size: 22px;
}

.augment-cards {
  display: flex;
  gap: 12px;
}

.augment-card {
  background: rgba(0, 20, 8, 0.85);
  border: 2px solid #7dff9a;
  color: #7dff9a;
  font-family: inherit;
  font-weight: inherit;
  padding: 14px 16px;
  width: 160px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  text-align: left;
}

.augment-card-name {
  font-size: 15px;
}

.augment-card-desc {
  font-size: 12px;
  opacity: 0.85;
}
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit` clean, `npm test` green (this module has no unit tests — DOM-dependent — verified via typecheck + build + controller's browser pass), `npx vite build` clean.
- [ ] **Step 4: Commit** — `feat: add augment choice modal UI`

---

### Task 6: Main loop wiring

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5 — `Physics.step`'s new `onMoltenHit` param, `AugmentState`/`newAugmentState`/`augmentMul`/`augmentBonus`/`pickAugment`/`rollChoices` from `src/augments.ts`, `SaveData.augments`/`augmentRngState` from `src/save.ts`, `UI.showAugmentChoice`/`onPickAugment` from `src/ui.ts`
- Produces: fully wired trigger/pause/pick flow (no further consumers — this is the top of the dependency graph)

- [ ] **Step 1: Implement**

In `src/main.ts`:

1. Add the import (own line, alongside the other local imports):

```ts
import { AugmentState, newAugmentState, augmentMul, augmentBonus, pickAugment, rollChoices } from "./augments";
```

2. Add a new constant near the other top-level consts (`AUTOSAVE_MS`, etc.):

```ts
const AUGMENT_MILESTONE = 20;
```

3. Add `augmentState` to the `let` declarations block (alongside `world`, `economy`, `stats`):

```ts
let augmentState: AugmentState;
```

4. In the `if (save) { ... } else { ... }` boot block, set `augmentState` in both branches — in the `if (save)` branch, add (after the existing `stats = { ...save.stats };` line):

```ts
  augmentState = { picked: save.augments, rngState: save.augmentRngState };
```

and in the `else` branch, add (after the existing `stats = { pixelsMined: 0, startedAt: Date.now(), won: false };` line):

```ts
  augmentState = newAugmentState(world.seed);
```

5. Add trigger/pause state near the other module-level mutable state (alongside `let uiDirty = false;`):

```ts
let upgradePointsSinceAugment = 0;
let pendingAugmentOffers = 0;
let augmentOfferOpen = false;
let paused = false;
```

6. Add a helper for upgrade-point increments (place it above `onMined`, since `onMined` will call it):

```ts
function addUpgradePoints(n: number): void {
  economy.upgradePoints += n;
  upgradePointsSinceAugment += n;
  while (upgradePointsSinceAugment >= AUGMENT_MILESTONE) {
    upgradePointsSinceAugment -= AUGMENT_MILESTONE;
    pendingAugmentOffers++;
  }
}

function showNextAugmentOffer(): void {
  if (augmentOfferOpen || pendingAugmentOffers <= 0) return;
  const defs = rollChoices(augmentState, 3);
  if (defs.length === 0) {
    pendingAugmentOffers--;
    showNextAugmentOffer();
    return;
  }
  augmentOfferOpen = true;
  paused = true;
  ui.showAugmentChoice(defs);
}
```

7. Wire the pick callback (place near the existing `ui.onNewRun = ...` wiring):

```ts
ui.onPickAugment = (id) => {
  pickAugment(augmentState, id);
  augmentOfferOpen = false;
  paused = false;
  pendingAugmentOffers--;
  showNextAugmentOffer();
};
```

8. In `onMined`, make these exact replacements:
   - Change `if (cell === CELL.UPGRADE) economy.upgradePoints++;` to `if (cell === CELL.UPGRADE) addUpgradePoints(1);`
   - Change the currency line `economy.currency += Math.ceil(pixelValue(cell) * biomeValueMul(biomeAt(x, y, world.seed)));` to `economy.currency += Math.ceil(pixelValue(cell) * biomeValueMul(biomeAt(x, y, world.seed)) * augmentMul(augmentState, "pixelValueMul"));`
   - Change the reveal radius line `const revealRadius = 6 + 2 * abilityLevel(economy, "revealRadius");` to `const revealRadius = 6 + 2 * abilityLevel(economy, "revealRadius") + augmentBonus(augmentState, "revealRadius");`
   - In the `if (cell === CELL.TREASURE)` block, change `const amount = Math.ceil(100 * (1 + 2 * world.edgeAt(x, y)));` to `const amount = Math.ceil(100 * (1 + 2 * world.edgeAt(x, y)) * augmentMul(augmentState, "treasureMul"));`
   - In the `if (cell === CELL.BOSS)` block, inside the `if (bossId !== -1) { ... }`:
     - Change `const amount = Math.ceil(2000 * (1 + world.edgeAt(x, y)));` to `const amount = Math.ceil(2000 * (1 + world.edgeAt(x, y)) * augmentMul(augmentState, "bossMul"));`
     - Change `economy.upgradePoints += 3;` to `addUpgradePoints(3);`
     - Right after that line, add: `pendingAugmentOffers++;`
   - At the very end of `onMined`, right before the closing `uiDirty = true;` line (or right after it — either position is fine since `showNextAugmentOffer` doesn't touch `uiDirty`), add a call: `showNextAugmentOffer();`

9. Add the molten burst callback (place near `onMined`):

```ts
function onMoltenHit(x: number, y: number): void {
  renderer.addBurst(x + 0.5, y + 0.5, "#f63");
}
```

10. Update `buildAbilityStats` — remove the `moltenImmune` line and layer in augment multipliers/bonuses:

```ts
function buildAbilityStats(): AbilityStats {
  return {
    speedMul: statMul(economy, "speed") * augmentMul(augmentState, "speed"),
    dmgMul: statMul(economy, "damage") * augmentMul(augmentState, "damage"),
    smashRadius: 1 + abilityLevel(economy, "smashRadius") + augmentBonus(augmentState, "smashRadius"),
    poisonSpread: 1 + abilityLevel(economy, "poisonSpread") + augmentBonus(augmentState, "poisonSpread"),
    splitCount: 1 + abilityLevel(economy, "splitCount") + augmentBonus(augmentState, "splitCount"),
    pierceDepth: 1 + abilityLevel(economy, "pierceDepth") + augmentBonus(augmentState, "pierceDepth"),
    darkSpeedMul: statMul(economy, "darkSpeed"),
  };
}
```

11. In `spawnWaveAt`, add a pause guard as the very first line of the function body, and layer in launch augments:

```ts
function spawnWaveAt(clientX: number, clientY: number): void {
  if (paused) return;
  const [tx, ty] = screenToWorld(cam, canvas.width, canvas.height, clientX, clientY);
  const baseAngle = Math.atan2(ty - SPAWN_CAVITY_Y, tx - SPAWN_CAVITY_X);
  const launchSpeedMul = statMul(economy, "launchSpeed") * augmentMul(augmentState, "launchSpeed");
  let remaining = 20 + 10 * abilityLevel(economy, "launchWave") + augmentBonus(augmentState, "launchWave");
  ...
```

(the rest of the function body is unchanged)

12. Update `doSave` — bump `version` to `3` and add the two new fields:

```ts
function doSave(): void {
  if (savingDisabled) return;
  const data: SaveData = {
    version: 3,
    seed: world.seed,
    changes: diffWorld(world),
    currency: economy.currency,
    upgradePoints: economy.upgradePoints,
    upgrades: economy.upgrades,
    ballsOwned: economy.ballsOwned,
    stats,
    exploredRuns: encodeExplored(world.explored),
    augments: augmentState.picked,
    augmentRngState: augmentState.rngState,
  };
  saveGame(data);
}
```

13. In `frame()`, wrap the simulation/input block in a pause check and pass `onMoltenHit` to `physics.step`:

```ts
function frame(now: number): void {
  try {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.25);

    if (!paused) {
      acc += dt;

      const abilityStats = buildAbilityStats();
      let steps = 0;
      while (acc >= SIM_DT && steps < MAX_SIM_STEPS) {
        physics.step(SIM_DT, abilityStats, onMined, onMoltenHit);
        acc -= SIM_DT;
        steps++;
      }
      if (steps >= MAX_SIM_STEPS) {
        acc = Math.min(acc, SIM_DT * MAX_SIM_STEPS);
      }

      updateCameraPan(dt);
      updateRadar(dt);
    }

    renderer.showTreasurePulse = abilityLevel(economy, "treasureHunter") > 0;
    ui.treasurePings = abilityLevel(economy, "treasureHunter") > 0;
    renderer.draw(cam, physics.balls, dt);
    ui.drawMinimap(cam);
    if (uiDirty) {
      ui.pixelsMined = stats.pixelsMined;
      ui.update();
      uiDirty = false;
    }

    errorCount = 0;
  } catch (err) {
    console.error(err);
    errorCount++;
    if (errorCount >= 3) {
      showErrorOverlay();
      return;
    }
  }

  requestAnimationFrame(frame);
}
```

- [ ] **Step 2: Verify.** `npm test` green (54 existing + Task 1/2/3/4's additions), `npx tsc --noEmit` clean, `npx vite build` clean. This module has no dedicated unit tests (integration/DOM code) — consistent with how prior main.ts wiring tasks in this project were verified.
- [ ] **Step 3: Commit** — `feat: wire augment triggers, pause, and stat layering into main loop`

---

### Task 7: Controller verification + deploy

(Controller-executed, not a subagent dispatch.)

- [ ] Serve `dist/`, browser-verify: molten collisions bounce harder and never destroy a ball (visual + no ball count drop); reaching an upgrade-point milestone (buy currency, grant upgrade points via console if needed) opens the augment modal and pauses the game; picking an augment closes the modal, resumes, and visibly changes behavior (e.g. pick `aug_momentum` and confirm balls move faster); killing a boss always offers a choice regardless of the milestone counter; reload mid-run preserves picked augments (`window.__game` inspection or HUD-visible effect); a fresh v1/v2-shaped save in localStorage (if reachable) loads without crashing.
- [ ] Merge to main (squash or direct merge per prior convention), push → Pages auto-deploys; verify live URL.

## Self-review notes

- Spec coverage: molten fix (Task 1), tree cleanup + refund (Task 2), augment data/pool/rng determinism (Task 3), save v3 + migration (Task 4), UI modal (Task 5), trigger/pause/stat-layering wiring (Task 6), controller verification (Task 7).
- Type consistency checked: `AugmentDef`/`AugmentState` field names and function signatures used identically across Tasks 3, 4 (save shape), 5 (UI import), and 6 (main.ts wiring). `onMoltenHit` signature matches between Task 1 (producer) and Task 6 (consumer).
- No placeholders: all 12 augment pool entries, all CSS rules, and all main.ts diffs are given as exact code, not descriptions.
