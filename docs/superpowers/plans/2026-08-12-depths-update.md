# Depths Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fog of war, biomes, treasure/boss pixels, golden-pixel radar, a visual tiered skill tree, and an always-available New Run button to the existing game.

**Architecture:** Fog is an `explored` mask painted inside the existing chunk raster/patch pipeline. Biomes are derived (not stored) from low-frequency noise via a new pure module. New cell types TREASURE(7)/BOSS(8) extend the existing Uint8 grid. Save bumps to v2 (explored RLE + v1 migration). Skill tree v2 is DOM nodes + SVG connector lines in the existing panel.

**Tech Stack:** Existing: Vite + TypeScript, Canvas 2D, vitest, no runtime deps.

## Global Constraints

- No runtime npm deps; no code comments; no emojis in code
- All logic randomness via seeded RNG (`src/rng.ts`); `Math.random` only cosmetic (particles, launch spread)
- Worldgen deterministic per seed; WORLD_W=1280, WORLD_H=800
- Perf: fog/biome painting must go through the existing dirty-cell patch path; ≥55 fps @ 2000 balls
- Save v2 must load v1 saves via migration (no progress loss); corrupt fields → safe defaults + console.warn
- Commits: plain conventional messages, NO Co-Authored-By trailer
- All existing 36 tests stay green except the two worldgen content assertions explicitly amended in Task 2

---

### Task 1: Biome module

**Files:**
- Create: `src/biomes.ts`
- Test: `tests/biomes.test.ts`

**Interfaces:**
- Consumes: `valueNoise2D(x, y, seed, scale)` from `src/rng.ts`
- Produces:
  - `type Biome = "verdant" | "crystal" | "molten" | "ruins"`
  - `biomeAt(x: number, y: number, seed: number): Biome` — `n = valueNoise2D(x, y, seed + 5, 320)`; bands: n < 0.45 verdant, < 0.65 crystal, < 0.85 molten, else ruins
  - `biomeValueMul(b: Biome): number` — verdant 1, crystal 2, molten 3, ruins 1
  - `biomeHardnessShift(b: Biome): number` — crystal 1, others 0
  - `MOLTEN_DESTROY_CHANCE = 0.15`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { biomeAt, biomeValueMul, biomeHardnessShift } from "../src/biomes";
import { valueNoise2D } from "../src/rng";

describe("biomes", () => {
  it("deterministic and matches noise bands", () => {
    for (const [x, y] of [[10, 10], [500, 300], [1200, 790], [640, 400]]) {
      const n = valueNoise2D(x, y, 7 + 5, 320);
      const b = biomeAt(x, y, 7);
      if (n < 0.45) expect(b).toBe("verdant");
      else if (n < 0.65) expect(b).toBe("crystal");
      else if (n < 0.85) expect(b).toBe("molten");
      else expect(b).toBe("ruins");
      expect(biomeAt(x, y, 7)).toBe(b);
    }
  });
  it("modifiers", () => {
    expect(biomeValueMul("verdant")).toBe(1);
    expect(biomeValueMul("crystal")).toBe(2);
    expect(biomeValueMul("molten")).toBe(3);
    expect(biomeValueMul("ruins")).toBe(1);
    expect(biomeHardnessShift("crystal")).toBe(1);
    expect(biomeHardnessShift("molten")).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`npm test`)
- [ ] **Step 3: Implement `src/biomes.ts` per interface list.**
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat: add biome module`

---

### Task 2: World — explored mask, reveal, biome hardness, treasure and boss generation

**Files:**
- Modify: `src/world.ts`
- Test: `tests/world.test.ts` (extend; amend two existing assertions)

**Interfaces:**
- Consumes: `biomeAt`, `biomeHardnessShift` from Task 1; existing `mulberry32`, `hashCoords`, `valueNoise2D`
- Produces (additions to `World`):
  - `CELL.TREASURE = 7`, `CELL.BOSS = 8`; `CELL_HP = [0,1,3,8,1,1,2,2,40]`
  - `explored: Uint8Array` (same length as cells; 1 = revealed). After generation: disc radius 30 around (640,400) revealed.
  - `reveal(x: number, y: number, radius: number): void` — Chebyshev disc; for each newly revealed in-bounds cell set explored=1 and call `onCellChanged?.(cx, cy)`
  - `isExplored(x: number, y: number): boolean` — OOB false
  - `onCellDamaged?: (x: number, y: number) => void` — fired by `hit()` when damage is applied but the cell survives (renderer repaints damage tint)
  - `damageAt(x: number, y: number): number` — accumulated damage for the cell (0 if none)
  - `bossMap: Map<number, number>` (cellIndex → bossId), `bossRemaining: number[]` (count per bossId)
  - `registerBossCellMined(x: number, y: number): number` — removes index from bossMap, decrements bossRemaining[bossId]; returns bossId if that blob just reached 0, else -1 (also -1 if cell not in map)
  - Generation changes, in existing order, all seeded:
    - fillTerrain: after computing tier, `tier = Math.min(3, tier + biomeHardnessShift(biomeAt(x, y, seed)))`
    - stampObjects: attempts stay 40 but each stamp position re-rolled up to 3 times preferring ruins biome (accept non-ruins on last roll)
    - upgrade pixels: 400 attempts, positions preferring ruins the same way
    - treasure: `rngT = mulberry32(seed + 6)`; 250 attempts; terrain cell with edge > 0.15 → TREASURE
    - bosses: `rngB = mulberry32(seed + 7)`; 6 blobs; blob b starts at random terrain cell with edge > 0.3; random walk 40 steps (4-dir), each visited in-bounds terrain cell becomes BOSS and joins bossMap with id b
- Two existing tests amended (content changed intentionally): the worldgen determinism hash test (recompute — still asserts same-seed equality and different-seed inequality, no hardcoded hash) and the counts test (add TREASURE > 50, BOSS > 100 expectations)

- [ ] **Step 1: Write failing tests (add to tests/world.test.ts)**

```ts
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
  it("generation deterministic with new content", () => {
    const a = World.generate(42), b = World.generate(42);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.bossMap.size).toBe(b.bossMap.size);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement per interface list.** Reveal disc: loop dy/dx in [-r, r]. Boss walk: `x += [1,-1,0,0][d]; y += [0,0,1,-1][d]` with `d = floor(rngB() * 4)`, skip OOB/non-terrain visits without consuming blob cells (walk length fixed 40 steps regardless).
- [ ] **Step 4: Run full suite; amend the two named existing assertions if they fail on new content (no other test edits). PASS.**
- [ ] **Step 5: Commit** — `feat: add fog of war, biomes, treasure and boss generation`

---

### Task 3: Save v2 — explored RLE + migration

**Files:**
- Modify: `src/save.ts`
- Test: `tests/save.test.ts` (extend)

**Interfaces:**
- Consumes: `World` (now with `explored`, `reveal`)
- Produces:
  - `SaveData` version field becomes `2`; new field `exploredRuns: number[]` (pairs `[start, length, ...]` of explored=1 runs over the flat mask)
  - `encodeExplored(explored: Uint8Array): number[]` / `decodeExplored(runs: number[], out: Uint8Array): void` (out zeroed first)
  - `loadGame(): SaveData | null` — accepts version 1 (migrates) and 2; else console.warn + null
  - `migrateV1(old: { seed: number; changes: number[]; [k: string]: unknown }): SaveData` — carries fields over, `exploredRuns: []` sentinel meaning "derive on boot"; main derives by revealing radius 6 around every diffed cell + the spawn disc (Task 7 wires this; migrateV1 just tags `version: 2` with empty runs)
  - `normalizeSave` extended: exploredRuns must be an array of finite numbers, else `[]`
  - `clearSave`, `saveGame`, `diffWorld`, `applyDiff` unchanged

- [ ] **Step 1: Write failing tests**

```ts
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
  it("v1 save loads as v2 with empty exploredRuns", () => {
    const v1 = { version: 1, seed: 9, changes: [5, 0], currency: 10, upgradePoints: 1, upgrades: {}, ballsOwned: { white: 3 }, stats: { pixelsMined: 4, startedAt: 123, won: false } };
    localStorage.setItem("tmp-save", JSON.stringify(v1));
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(2);
    expect(loaded!.exploredRuns).toEqual([]);
    expect(loaded!.currency).toBe(10);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run full suite PASS.**
- [ ] **Step 5: Commit** — `feat: bump save format to v2 with explored mask and migration`

---

### Task 4: Economy — new tree nodes and stat plumbing

**Files:**
- Modify: `src/economy.ts`
- Test: `tests/economy.test.ts` (extend)

**Interfaces:**
- Produces (additions):
  - New `UPGRADE_TREE` nodes (ids exact; NO pixel-value nodes — tree is ball-centric per user direction): `launch_wave` {cost 3, max 3, amount 10, stat "launchWave"}, `launch_speed` {cost 2, max 3, amount 0.1, stat "launchSpeed"}, `treasure_hunter` {cost 3, max 1, stat "treasureHunter"}, `reveal_radius_1` {cost 2, max 3, amount 2, stat "revealRadius"}, `reveal_radius_2` {cost 3, max 3, amount 2, stat "revealRadius", requires "reveal_radius_1"}, `radar` {cost 4, max 1, stat "radar"}, `molten_immunity` {cost 4, max 1, stat "moltenImmunity"}, `dark_speed` {cost 3, max 2, amount 0.15, stat "darkSpeed"}. Existing node ids untouched.
  - `statMul(s, stat)` already generic over matching `stat` nodes — must work for "launchSpeed" and "darkSpeed" (1 + level*amount summed)
  - `abilityLevel(s, stat)` must SUM levels across all nodes sharing a stat (reveal_radius_1 + reveal_radius_2)
  - `abilityLevel(s, stat)` works for the new stats (raw level; for max-1 flags 0/1)
  - Every node gets `name` and `desc` strings (short, no emoji)
  - `NODE_LAYOUT: Record<string, { col: number; row: number; branch: "ball" | "launcher" | "discovery" | "survival" }>` — layout position for EVERY node id in UPGRADE_TREE (per-ball nodes cols 0-6 rows by chain depth; launcher col 7, discovery col 8, survival col 9; rows 0..n). Exported for the UI.

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run full suite PASS + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat: add depths upgrade nodes and tree layout data`

---

### Task 5: Physics — molten destruction and dark speed

**Files:**
- Modify: `src/physics.ts`
- Test: `tests/physics.test.ts` (extend)

**Interfaces:**
- Consumes: `biomeAt`, `MOLTEN_DESTROY_CHANCE` from `src/biomes.ts`; `world.isExplored`
- Produces:
  - `AbilityStats` gains `moltenImmune: boolean` and `darkSpeedMul: number` (1 = no bonus)
  - `spawn(type, x, y, angle, speedMul = 1)` — optional 5th param multiplying initial velocity (launch_speed upgrade; test: spawn with speedMul 2 → vx doubled)
  - On collision damage application: if `biomeAt(hitX, hitY, world.seed) === "molten"` and `!stats.moltenImmune` and `this.rng() < MOLTEN_DESTROY_CHANCE` → mark ball destroyed (culled this step; the hit still applies its damage first)
  - Ball speed: per-substep speed factor `world.isExplored(floor(x), floor(y)) ? 1 : stats.darkSpeedMul`
  - All existing tests must keep passing: update the shared `STATS` fixture in existing test files to include `moltenImmune: true, darkSpeedMul: 1` (immune-by-default in old fixtures so molten rolls never fire there)

- [ ] **Step 1: Write failing tests**

```ts
const DSTATS: AbilityStats = { speedMul: 1, dmgMul: 1, smashRadius: 2, poisonSpread: 1, splitCount: 2, pierceDepth: 2, moltenImmune: false, darkSpeedMul: 1 };

describe("molten and dark speed", () => {
  it("molten can destroy a non-immune ball deterministically per seed", () => {
    const w = World.generate(3);
    w.cells.fill(CELL.EMPTY);
    let mx = -1, my = -1;
    outer: for (let y = 100; y < WORLD_H; y++) for (let x = 100; x < WORLD_W; x++)
      if (biomeAt(x, y, w.seed) === "molten") { mx = x; my = y; break outer; }
    for (let y = 0; y < WORLD_H; y++) w.cells[w.idx(mx, y)] = CELL.HARD;
    const run = (immune: boolean) => {
      const p = new Physics(w2());
      p.spawn("white", mx - 5, my, 0);
      let alive = true;
      for (let i = 0; i < 400 && alive; i++) { p.step(1 / 60, { ...DSTATS, moltenImmune: immune }, () => {}); alive = p.balls.length > 0; }
      return alive;
    };
    function w2(): World {
      const v = World.generate(3);
      v.cells.fill(CELL.EMPTY);
      for (let y = 0; y < WORLD_H; y++) v.cells[v.idx(mx, y)] = CELL.HARD;
      return v;
    }
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false);
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
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement; update existing STATS fixtures (physics.test.ts, abilities.test.ts) with `moltenImmune: true, darkSpeedMul: 1`.**
- [ ] **Step 4: Full suite PASS + tsc clean.**
- [ ] **Step 5: Commit** — `feat: add molten hazard and dark speed to physics`

---

### Task 6: Renderer — fog paint, biome palettes, new cell colors

**Files:**
- Modify: `src/render.ts`
- Test: existing camera tests only (visual verified by controller)

**Interfaces:**
- Consumes: `biomeAt` from Task 1; `world.isExplored`, `world.explored`
- Produces:
  - `FOG_COLOR = "#070b08"`. In both `rasterChunk` and `patchChunk`: if cell unexplored → paint FOG_COLOR (opaque fillRect, even for EMPTY cells) and skip pulse-list membership; explored EMPTY stays transparent clearRect as now.
  - **Damage tint:** explored, solid, partially damaged cells (`world.damageAt(x, y) > 0`) render their `cellColor` darkened by `min(0.65, 0.65 * damage / CELL_HP[cell])` (multiply each RGB channel; implement one small `darken(hex, f)` helper). Renderer subscribes nothing itself — main wires `world.onCellDamaged` → `renderer.markDirty` (Task 7).
  - `cellColor(cell, x, y, seed)` biome-aware for terrain tiers (SOFT/MED/HARD): verdant = current palette; crystal = cyan/blue family (bright #7ff/#4cd/#2a9-style ramp with hashCoords variation); molten = ember family (#f63/#c32/#821 on dark); ruins = sandstone/gray family (#cba/#987/#665). Non-terrain cells: TREASURE `#ffd75e`, BOSS `#c13bff`, others unchanged.
  - Pulse list additionally includes TREASURE cells only when `treasureHunterActive` — skip: pulse list gains TREASURE cells always at raster time but `drawPulseOverlay` draws TREASURE pulses only when `this.showTreasurePulse` (public boolean, default false, set by main when treasure_hunter bought).
  - `Renderer` needs no new public methods besides `showTreasurePulse`.

- [ ] **Step 1: Implement per interface list.**
- [ ] **Step 2: `npm test` green (camera tests untouched), `npx tsc --noEmit` clean, `npx vite build` clean.**
- [ ] **Step 3: Commit** — `feat: render fog of war and biome palettes`

---

### Task 7: Main wiring — reveal, biome value, treasure/boss flow, migration, stats

**Files:**
- Modify: `src/main.ts`
- Test: full suite + typecheck + build (behavioral verification by controller in browser)

**Interfaces:**
- Consumes everything above. Produces a fully wired game:
  1. Boot: `loadGame()` → normalize → if `exploredRuns.length > 0` → `decodeExplored(runs, world.explored)`; if v1-migrated (empty runs but non-empty changes) → for each diffed cell index reveal radius 6, plus spawn disc already from generate.
  2. `AbilityStats` build gains: `moltenImmune: abilityLevel(s, "moltenImmunity") > 0`, `darkSpeedMul: statMul(s, "darkSpeed")`. Click wave size becomes `20 + 10 * abilityLevel(s, "launchWave")`; spawns pass `statMul(s, "launchSpeed")` as the new spawn speedMul param. Wire `world.onCellDamaged = (x, y) => renderer.markDirty(x, y)`.
  3. `onMined(cell, x, y)`:
     - reveal: `world.reveal(x, y, 6 + 2 * (abilityLevel(s,"revealRadius" via both nodes)))` — precompute `revealRadius = 6 + upgrades reveal_radius_1*2 + reveal_radius_2*2` each frame from `abilityLevel` on the two node stats (both share stat "revealRadius", `abilityLevel` sums? NO — `abilityLevel` scans nodes by stat and must SUM matching nodes' levels; verify Task 4 implemented sum, else fix here via two lookups). Use `revealRadius = 6 + 2 * summedLevels`.
     - currency: `Math.ceil(pixelValue(cell) * biomeValueMul(biomeAt(x, y, world.seed)))` (no pixel-value upgrade — removed per user direction).
     - TREASURE: payout `Math.ceil(100 * (1 + 2 * edge(x, y)) )` where `edge` = same formula as world (extract tiny local helper), popup `+N` via `ui.showPopup`.
     - BOSS: `const bossId = world.registerBossCellMined(x, y)`; if completed → currency += `Math.ceil(2000 * (1 + edge))`, upgradePoints += 3, shockwave: `world.hit(cx, cy, 999)` for all cells in radius 6 (reporting through the same onMined), `renderer.addBurst` x6, popup "BOSS DOWN +N".
     - GOLD unchanged (win).
  4. Radar: if `abilityLevel(s, "radar") > 0` → every 2 s compute golden pixel coords (from `world.goldenIndex`), pass `ui.updateRadar(angle, distancePx)` (angle from camera center, distance in world px).
  5. `renderer.showTreasurePulse = abilityLevel(s, "treasureHunter") > 0` each frame (cheap boolean).
  6. Save: v2 payload with `exploredRuns: encodeExplored(world.explored)`.
  7. New Run pinned button handled entirely by UI (Task 8) via existing `onNewRun`.
  8. **Touch input** (main.ts) + `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">` in index.html:
     - `touchstart` (1 finger): record start pos/time. `touchmove` past 12px: pan camera by delta/zoom (drag mode, no launch). `touchend` with no drag: launch wave toward `screenToWorld(touch point)`.
     - 2 fingers: pinch zoom toward pinch midpoint, clamp 0.5..24 (reuse wheel-zoom math); pinch cancels pending tap.
     - `e.preventDefault()` on canvas touch events (passive: false) so the page never scrolls/zooms natively.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Full suite green, tsc clean, vite build clean.**
- [ ] **Step 3: Commit** — `feat: wire depths mechanics into main loop`

---

### Task 8: UI — skill tree v2, radar compass, popups, minimap fog and pings, pinned New Run

**Files:**
- Modify: `src/ui.ts`, `src/style.css`
- Test: typecheck + suite green; visuals verified by controller

**Interfaces:**
- Consumes: `NODE_LAYOUT`, `UPGRADE_TREE` (Task 4); existing UI class contract; `world.explored` for minimap fog
- Produces:
  - **Tree v2:** upgrade panel becomes a positioned node graph: container div (relative, scrollable, ~640x480), each node an absolutely positioned 44px button at `(col * 60 + 12, row * 64 + 12)`; one `<svg>` layer underneath drawing a line per `requires` edge (parent center → child center), `stroke #2a4` when parent bought else `#123`. Node ring color: ball branch = that ball's BALL_COLORS entry; economy `#ffd75e`; discovery `#6ec6ff`; survival `#ff8a5c`. Affordable+buyable nodes get CSS class `affordable` (box-shadow pulse animation). Level pips (`level/max`) below icon text (node short name, first 6 chars). Existing tooltip behavior (hover div with name/desc/cost/level) reused.
  - `updateRadar(angle: number, distance: number): void` — compass widget top-center (hidden until first call): rotating arrow (CSS transform rotate), color by distance (>600 `#6ec6ff`, 300-600 `#ffd75e`, <300 `#ff5c5c`), brief ping scale animation per update.
  - `showPopup(text: string, sx: number, sy: number): void` — floating div at screen coords, floats up 40px and fades over 1.2 s, then removed. Max 20 concurrent (oldest removed).
  - **Minimap:** unexplored → black; explored uses existing downsample. If `showTreasurePings` (public boolean set by main… keep symmetry: UI reads a public field `ui.treasurePings: boolean` set by main each economy change) → TREASURE cells in explored areas drawn as 2px `#ffd75e` dots.
  - **Pinned New Run:** small button bottom-left above shop bar, label "NEW RUN"; click → swaps to "SURE? YES / NO" inline for 5 s (timeout reverts); YES → `this.onNewRun?.()`; NO reverts. Same styling family as shop panels.
  - **Mobile responsive (style.css `@media (max-width: 700px)` + touch-friendly behavior):** shop bar horizontally scrollable (`overflow-x: auto`, `-webkit-overflow-scrolling: touch`), buttons min 44px touch targets; upgrade panel becomes full-screen overlay with a visible close button (X, top-right); HUD font scales down; minimap 120x75; pinned New Run stays visible above the shop bar. Tree tooltips on touch: first tap on a node shows the tooltip, second tap within 3 s buys (detect via `("ontouchstart" in window)`; desktop hover behavior unchanged).
  - Minimap fog needs `world.explored` — UI already holds `world`.

- [ ] **Step 1: Implement UI + CSS.**
- [ ] **Step 2: Suite green, tsc clean, build clean.**
- [ ] **Step 3: Commit** — `feat: add skill tree graph, radar, popups, fog minimap and pinned new run`

---

### Task 9: Controller verification + deploy

(Controller-executed, not a subagent dispatch.)

- [ ] Serve `dist/`, browser-verify: fog reveals on mining; biome palettes visible; damaged pixels visibly darken before breaking; treasure payout popup; boss kill reward + shockwave; tree v2 renders with lines/tooltips/buy; radar after buying node; pinned New Run works incl. cancel; v1 save migration doesn't crash; fps ≥55 @ 2000 balls; mobile viewport (narrow window): shop scrolls, tree full-screen, touch handlers registered.
- [ ] Merge to main (squash), push → Pages auto-deploys; verify live URL.

## Self-review notes

- Spec coverage: fog (T2/T3/T6/T7), biomes (T1/T2/T5/T6/T7), treasure/boss (T2/T7/T6), radar (T4/T7/T8), tree v2 (T4/T8), New Run pinned (T8), save v2+migration (T3/T7), perf constraint (T6 patch path + T9 check).
- abilityLevel summing across same-stat nodes: Task 4 test asserts chained pixel_value math via statMul; Task 7 explicitly warns implementer to verify sum semantics for revealRadius (two nodes share stat).
- Type consistency: `AbilityStats` extension named identically in T5 (producer) and T7 (consumer); `NODE_LAYOUT` in T4 (producer) and T8 (consumer); `encodeExplored`/`decodeExplored` in T3 (producer) and T7 (consumer); `showTreasurePulse` renderer field in T6 (producer) and T7 (consumer).
