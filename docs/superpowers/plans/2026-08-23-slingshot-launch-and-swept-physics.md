# Slingshot Launch and Swept Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace immediate wave firing with one-ball pull-back slingshot aiming and make real shots plus trajectory previews use deterministic swept-grid collision.

**Architecture:** Add pure helpers for slingshot math and grid segment traversal. Keep `Physics` authoritative for real collisions and `main.ts` authoritative for input/queue state. Keep preview simulation render-only while sharing the same collision helper and reflection rules.

**Tech Stack:** TypeScript, Vite, Canvas 2D, Vitest, existing fixed-step custom physics.

---

## File map

- Create: `src/grid-collision.ts` — deterministic grid segment traversal and hit normals.
- Create: `tests/grid-collision.test.ts` — traversal and tie-break tests.
- Create: `src/slingshot.ts` — pure pull clamping, speed mapping, queue selection, and aim threshold helpers.
- Create: `tests/slingshot.test.ts` — pure slingshot and queue tests.
- Modify: `src/physics.ts` — replace point/substep collision lookup with swept-grid collision while preserving existing ball abilities and callbacks.
- Modify: `tests/physics.test.ts` — add fast-ball anti-tunneling and reflection regressions.
- Modify: `src/main.ts` — desktop/touch slingshot state, one-ball queue, preview calculation, and pointer lifecycle.
- Modify: `src/render.ts` — trajectory dots, pull line, launcher marker, and predicted impact accents.
- Do not modify: `src/ui.ts` or `src/style.css`; active ball and empty-launcher feedback are rendered on the canvas.

### Task 1: Add slingshot math and queue helpers with TDD

**Files:**
- Create: `src/slingshot.ts`
- Create: `tests/slingshot.test.ts`

- [ ] **Step 1: Write failing tests for pull clamping and speed mapping.**

```ts
import { describe, expect, it } from "vitest";
import { clampPull, launchSpeedMul, shouldLaunch } from "../src/slingshot";

describe("slingshot math", () => {
  it("clamps pull length without changing its direction", () => {
    expect(clampPull({ x: 0, y: 0 }, { x: 240, y: 0 }, 120)).toEqual({ x: 120, y: 0 });
  });

  it("maps minimum and maximum pull to bounded launch speed", () => {
    expect(launchSpeedMul(0, 120, 0.55, 1.55)).toBe(0.55);
    expect(launchSpeedMul(120, 120, 0.55, 1.55)).toBe(1.55);
  });

  it("requires the minimum pull before release fires", () => {
    expect(shouldLaunch(7, 8)).toBe(false);
    expect(shouldLaunch(8, 8)).toBe(true);
  });
});
```

- [ ] **Step 2: Run `npm test -- tests/slingshot.test.ts` and verify it fails because the module is missing.**

- [ ] **Step 3: Implement the minimal pure helpers.**

```ts
export interface Point { x: number; y: number; }

export function clampPull(anchor: Point, pointer: Point, maxPull: number): Point {
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length <= maxPull || length === 0) return { x: dx, y: dy };
  const scale = maxPull / length;
  return { x: dx * scale, y: dy * scale };
}

export function launchSpeedMul(length: number, maxPull: number, minSpeed: number, maxSpeed: number): number {
  const t = Math.max(0, Math.min(1, length / maxPull));
  return minSpeed + (maxSpeed - minSpeed) * t;
}

export function shouldLaunch(length: number, minPull: number): boolean {
  return length >= minPull;
}
```

- [ ] **Step 4: Run the focused tests and verify they pass.**

- [ ] **Step 5: Add failing tests for deterministic next-ball selection.**

Test that selection returns the first type in `BALL_ORDER` with positive `owned - spawned`, returns `null` when none are available, and does not mutate the inventory.

- [ ] **Step 6: Implement and test `nextBallType(owned, spawned)` using the existing `BALL_ORDER`; run `npm test -- tests/slingshot.test.ts`.**

### Task 2: Implement swept-grid traversal with TDD

**Files:**
- Create: `src/grid-collision.ts`
- Create: `tests/grid-collision.test.ts`

- [ ] **Step 1: Write failing tests for first solid hit, no hit, boundary hit, and deterministic diagonal ties.**

```ts
import { describe, expect, it } from "vitest";
import { sweepGrid } from "../src/grid-collision";

describe("sweepGrid", () => {
  it("returns the first solid cell crossed by a horizontal segment", () => {
    const hit = sweepGrid(1.2, 2.5, 8.8, 2.5, (x, y) => x === 4 && y === 2, 10, 10);
    expect(hit).toMatchObject({ x: 4, y: 2, normalX: -1, normalY: 0 });
  });

  it("returns null when the segment crosses only empty cells", () => {
    expect(sweepGrid(1.2, 2.5, 8.8, 2.5, () => false, 10, 10)).toBeNull();
  });

  it("treats leaving the grid as a solid boundary", () => {
    expect(sweepGrid(1.5, 1.5, -2, 1.5, () => false, 10, 10)).toMatchObject({ normalX: 1, normalY: 0 });
  });
});
```

- [ ] **Step 2: Run `npm test -- tests/grid-collision.test.ts` and verify the expected missing-module failure.**

- [ ] **Step 3: Implement a 2D DDA/Amanatides-Woo traversal that advances to the next x/y cell boundary, returns the first solid cell, and uses fixed x-before-y ordering when `tMaxX === tMaxY`.**

- [ ] **Step 4: Run the focused tests and verify they pass.**

- [ ] **Step 5: Add tests for zero-length segments, negative coordinates, and a solid start cell; implement finite-value guards and run the focused suite again.**

### Task 3: Integrate swept collision into Physics

**Files:**
- Modify: `src/physics.ts`
- Modify: `tests/physics.test.ts`

- [ ] **Step 1: Add a failing regression test with a fast ball crossing a one-cell wall in one physics step; assert it collides, reports the mined cell, and reflects.**

- [ ] **Step 2: Run `npm test -- tests/physics.test.ts` and confirm the regression fails with the current point-sampling implementation.**

- [ ] **Step 3: Add a private physics movement helper that calls `sweepGrid` for each proposed segment and returns the remaining distance plus the hit normal.**

- [ ] **Step 4: Replace only the movement/collision lookup with swept traversal; keep `World.hit`, `onMined`, `onMoltenHit`, `onImpact`, pierce, smash, poison, split, purple pass-through, and molten bounce behavior unchanged.**

- [ ] **Step 5: Add a fixed per-step collision budget of 16 and place balls one small epsilon before the hit to prevent re-colliding with the same boundary.**

- [ ] **Step 6: Run `npm test -- tests/physics.test.ts`, then `npm test`; fix implementation failures without weakening tests.**

### Task 4: Replace click firing with slingshot input and queue

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/slingshot.test.ts` if helper coverage needs extension.

- [ ] **Step 1: Add pure tests for pointer states: press-inside-launch-zone starts aiming, outside press does not, short release cancels, valid release consumes exactly one next ball, and Escape/pointer-cancel clears state.**

- [ ] **Step 2: Run the focused tests and verify the new behavior fails before changing input code.**

- [ ] **Step 3: Replace `spawnWaveAt` with an `aimState` containing active flag, pointer id, pull vector, selected ball type, and preview points.**

- [ ] **Step 4: Implement desktop pointer handlers: left press in the launch zone starts aim, movement updates clamped pull, release fires one ball or cancels, pointer capture/loss clears state, Escape cancels, and right-button camera drag remains intact.**

- [ ] **Step 5: Use `launchSpeedMul` and the pull vector opposite direction to compute the angle and speed; increment only the selected type’s `spawnedCount`.**

- [ ] **Step 6: Update touch handlers so one-finger launch-zone gestures aim and two-finger gestures cancel aim then continue pinch zoom.**

- [ ] **Step 7: Run `npm test` and `npm run build`.**

### Task 5: Add shared trajectory preview rendering

**Files:**
- Modify: `src/main.ts`
- Modify: `src/render.ts`
- Do not modify: `src/ui.ts` or `src/style.css`; keep the launch feedback in the canvas renderer.

- [ ] **Step 1: Add a pure preview test that simulates a trajectory through the same `sweepGrid` helper and confirms it does not mutate a `World` or economy object.**

- [ ] **Step 2: Implement a bounded preview simulator in `main.ts` using copied position/velocity, `PREVIEW_DOTS = 32`, `PREVIEW_SECONDS = 2.5`, and the same reflection rules as Physics.**

- [ ] **Step 3: Add `Renderer.setAimPreview(points, pull, ballType)` and render a dotted line, pull line, launcher marker, and active ball color.**

- [ ] **Step 4: Clear preview state on release, cancel, pause, pointer loss, and when no ball is available.**

- [ ] **Step 5: Run the full test suite, production build, and `git diff --check`.**

### Task 6: Final review, deploy, and smoke verification

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run `npm test` and require all tests to pass.**

- [ ] **Step 2: Run `npm run build` and require a successful Vite production build.**

- [ ] **Step 3: Run `git diff --check` and inspect the complete diff for preservation of existing molten, erosion, combo, save, and augment behavior.**

- [ ] **Step 4: Commit the implementation with `feat: add slingshot launch controls`.**

- [ ] **Step 5: Push `main` and wait for the existing GitHub Pages workflow to pass its test/build/deploy jobs.**

- [ ] **Step 6: Open the deployed game and manually verify aim, cancel, release, one-ball queue progression, wall bounce, touch pinch behavior, and trajectory preview.**
