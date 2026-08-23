# Reactive Erosion and Impact Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic terrain fracture cascades, mining combos, and bounded ball-impact feedback while preserving the existing expanded game systems.

**Architecture:** Keep `World` as the cell/damage authority and `Physics` as the collision authority. Add a pure, testable `src/erosion.ts` resolver for bounded cascades, then let `main.ts` coordinate economy/combo state and `Renderer` own trails and visual event buffers. No save-format changes are needed.

**Tech Stack:** TypeScript, Vite, Canvas 2D, Vitest, existing seeded RNG utilities.

---

## File map

- Create: `src/erosion.ts` — deterministic bounded fracture resolver and result types.
- Create: `tests/erosion.test.ts` — unit tests for eligibility, decay, protection, determinism, and budgets.
- Modify: `src/world.ts` — expose/retain damage state needed for crack rendering; do not move economy logic here.
- Modify: `src/physics.ts` — report direct impact context and allow the coordinator to resolve erosion after direct mining.
- Modify: `src/render.ts` — add bounded trails, impact/cascade event rendering, and camera impulse state.
- Modify: `src/main.ts` — coordinate erosion, combo lifetime, render events, and transient feedback.
- Modify: `src/ui.ts` and `src/style.css` — add a small transient combo/cascade indicator without replacing the current HUD.
- Modify: `tests/physics.test.ts` — add regression coverage for direct mining callback/context compatibility.
- Modify: `tests/camera.test.ts` when camera impulse math is extracted; otherwise create `tests/visual-effects.test.ts` for the renderer-independent effects helper.

### Task 1: Define the erosion model with failing tests

**Files:**
- Create: `tests/erosion.test.ts`
- Create: `src/erosion.ts`

- [ ] **Step 1: Write the failing tests for protected cells and ordinary terrain.**

```ts
import { describe, expect, it } from "vitest";
import { CELL, World } from "../src/world";
import { resolveFracture } from "../src/erosion";

function emptyWorld(): World {
  const world = World.generate(7);
  world.cells.fill(CELL.EMPTY);
  return world;
}

describe("fracture erosion", () => {
  it("damages connected ordinary terrain but never auto-mines protected cells", () => {
    const world = emptyWorld();
    world.cells[world.idx(10, 10)] = CELL.HARD;
    world.cells[world.idx(11, 10)] = CELL.SOFT;
    world.cells[world.idx(12, 10)] = CELL.GOLD;

    const result = resolveFracture(world, 10, 10, 1, 123);

    expect(result.processed).toContainEqual({ x: 11, y: 10, depth: 1 });
    expect(world.get(12, 10)).toBe(CELL.GOLD);
  });

  it("does not process empty cells or special cells", () => {
    const world = emptyWorld();
    world.cells[world.idx(10, 10)] = CELL.TREASURE;
    world.cells[world.idx(11, 10)] = CELL.UPGRADE;

    const result = resolveFracture(world, 10, 10, 1, 123);

    expect(result.processed).toEqual([]);
    expect(world.get(11, 10)).toBe(CELL.UPGRADE);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because `src/erosion.ts` is missing.**

Run: `npm test -- tests/erosion.test.ts`

Expected: FAIL with a module-not-found error for `../src/erosion`.

- [ ] **Step 3: Write the minimal public types and resolver contract.**

```ts
import { CELL, World } from "./world";

export const FRACTURE_MAX_DEPTH = 2;
export const FRACTURE_MAX_CELLS = 24;
export const FRACTURE_DAMAGE = 1;

export interface FractureCell {
  x: number;
  y: number;
  depth: number;
}

export interface FractureResult {
  processed: FractureCell[];
}

function isFracturable(cell: number): boolean {
  return cell === CELL.SOFT || cell === CELL.MED || cell === CELL.HARD;
}

export function resolveFracture(world: World, originX: number, originY: number, energy: number, seed: number): FractureResult {
  void seed;
  const processed: FractureCell[] = [];
  const queue: FractureCell[] = [{ x: originX, y: originY, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && processed.length < FRACTURE_MAX_CELLS) {
    const current = queue.shift() as FractureCell;
    if (current.depth === 0) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        queue.push({ x: current.x + dx, y: current.y + dy, depth: 1 });
      }
      continue;
    }
    const key = `${current.x},${current.y}`;
    if (visited.has(key) || current.depth > FRACTURE_MAX_DEPTH || energy <= 0) continue;
    visited.add(key);
    if (!isFracturable(world.get(current.x, current.y))) continue;
    const destroyed = world.hit(current.x, current.y, Math.max(1, energy));
    processed.push(current);
    if (destroyed && current.depth < FRACTURE_MAX_DEPTH) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        queue.push({ x: current.x + dx, y: current.y + dy, depth: current.depth + 1 });
      }
    }
  }
  return { processed };
}
```

- [ ] **Step 4: Run the focused tests and adjust the minimal resolver until they pass.**

Run: `npm test -- tests/erosion.test.ts`

Expected: PASS for the two tests.

- [ ] **Step 5: Add tests for decay, duplicate prevention, max depth/budget, and deterministic output before refining the implementation.**

The tests must compare `processed` coordinates/depths for two worlds with the same seed and input, assert no result depth exceeds `FRACTURE_MAX_DEPTH`, assert `processed.length <= FRACTURE_MAX_CELLS`, and assert that a branched layout never contains the same coordinate twice.

- [ ] **Step 6: Run the new tests, confirm the new cases fail for the expected missing behavior, then implement seeded neighbor selection/energy decay with `mulberry32(seed)` and keep all constants in `src/erosion.ts`.**

Run: `npm test -- tests/erosion.test.ts`

Expected: RED before the refinement and GREEN after the refinement.

- [ ] **Step 7: Run the full unit suite.**

Run: `npm test`

Expected: Existing tests and all erosion tests pass.

### Task 2: Integrate cascades with mining callbacks

**Files:**
- Modify: `src/physics.ts`
- Modify: `src/main.ts`
- Modify: `tests/physics.test.ts`

- [ ] **Step 1: Add a failing physics test proving direct mining can provide impact context without changing existing callback behavior.**

Add an optional `onImpact` callback to `Physics.step` after `onMoltenHit`; the test should place a soft cell in the ball path, run one step, and assert the callback receives the cell coordinates and ball type while the existing `onMined` callback still receives the mined cell.

- [ ] **Step 2: Run `npm test -- tests/physics.test.ts` and confirm the new test fails on the missing callback.**

- [ ] **Step 3: Implement the optional impact callback at the direct collision site, preserving all existing ball-specific collision behavior and callback order.**

- [ ] **Step 4: Run the focused physics tests and verify they pass.**

- [ ] **Step 5: In `main.ts`, call `resolveFracture` only after a direct ordinary terrain cell is destroyed, route each cascade-destroyed cell through the same `onMined` economy/reveal/progression path, and emit a separate cascade render event for each processed cell.**

- [ ] **Step 6: Add a testable pure combo helper in `src/erosion.ts` or `src/combo.ts` with `advanceCombo(state, minedCount, now)` and tests for increment, active-window retention, and timeout reset.**

- [ ] **Step 7: Run `npm test` and commit the integration slice.**

### Task 3: Add ball trails and bounded impact effects

**Files:**
- Modify: `src/render.ts`
- Modify: `src/main.ts`
- Modify: `tests/camera.test.ts` only if camera impulse math is extracted.

- [ ] **Step 1: Add a failing pure test for the trail buffer cap and camera impulse decay.**

Keep the test independent of DOM/Canvas by extracting a small `VisualEffectsState` helper with `pushTrail`, `addImpulse`, and `advance` methods.

- [ ] **Step 2: Run the focused test and confirm it fails because the helper/state does not exist.**

- [ ] **Step 3: Implement bounded trail history, event caps, and exponentially or linearly decaying camera impulse with finite-value guards.**

- [ ] **Step 4: Wire `Renderer.draw` to render trails behind balls, use existing `BALL_COLORS`, and render direct/cascade impact bursts without changing chunk rasterization.**

- [ ] **Step 5: Wire `main.ts` impact/cascade events to the renderer and reset per-frame event counters alongside the existing molten burst cap.**

- [ ] **Step 6: Run `npm test` and `npm run build`.**

### Task 4: Add restrained combo/cascade UI feedback

**Files:**
- Modify: `src/ui.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`

- [ ] **Step 1: Add a failing DOM-independent test for formatting combo labels and hiding feedback at zero.**

Extract `formatCombo(combo: number, cascadeCount: number): string | null` into a small module or exported pure helper.

- [ ] **Step 2: Run the focused test and verify the missing helper failure.**

- [ ] **Step 3: Implement the pure formatter and then add `UI.showCombo(combo, cascadeCount)` with a single capped transient element.**

- [ ] **Step 4: Add CSS with `font: 12px monospace`, `background: rgba(5, 10, 6, 0.82)`, `pointer-events: none`, and a fixed position centered below the top-left HUD so the indicator is readable without covering the shop or upgrade controls.**

- [ ] **Step 5: Call the UI method only on combo changes or cascade milestones, not every simulation tick.**

- [ ] **Step 6: Run `npm test` and `npm run build`.**

### Task 5: Integration review and regression verification

**Files:**
- Modify only files required by failing regression tests.

- [ ] **Step 1: Run `npm test` and require exit code 0 with every test passing.**

- [ ] **Step 2: Run `npm run build` and require exit code 0 with Vite producing the `dist` output.**

- [ ] **Step 3: Inspect `git diff --check` and confirm no whitespace errors.**

- [ ] **Step 4: Verify protected cells, boss completion, Golden Pixel win flow, augments, saves, and molten behavior through the existing tests plus a browser smoke pass.**

- [ ] **Step 5: Review the diff for accidental changes to the user’s pre-existing `src/physics.ts` and `tests/physics.test.ts` work.**

- [ ] **Step 6: Run the final verification commands again after any review fixes.**

- [ ] **Step 7: Commit the implementation in small task commits, excluding unrelated working-tree changes.**
