# Slingshot Launch and Swept Grid Physics — Design

Date: 2026-08-23
Status: Approved for spec review

## Goal

Give the player direct Angry Birds-style control over launching balls while improving collision reliability and keeping the simulation aligned with the game's destructible pixel grid.

## Physics research decision

Keep the custom grid solver and improve it with swept grid traversal. Box2D provides fixed-step simulation and continuous collision detection, but its FAQ identifies arbitrarily destructible terrain as outside the scope of the rigid-body engine. Matter.js is designed around general bodies, contacts, and sleeping, not a mutable one-cell terrain grid. The current solver already owns ball abilities, cell damage, molten behavior, and seeded gameplay, so a shared swept-grid helper adds the needed anti-tunneling behavior without introducing a second terrain representation.

References:

- https://box2d.org/documentation/md_simulation.html
- https://box2d.org/documentation/md_faq.html
- https://brm.io/matter-js/docs/

## Input behavior

### Desktop

- Left-button press within the launch zone begins aiming.
- The launch zone is centered on the existing spawn cavity at `(SPAWN_CAVITY_X, SPAWN_CAVITY_Y)` with a screen-space radius of 48 pixels.
- Pointer movement computes a pull vector from the pointer back toward the launcher anchor.
- The pull vector is clamped to `MAX_PULL = 120` world units.
- Pull distance maps linearly from `MIN_LAUNCH_SPEED_MUL = 0.55` to `MAX_LAUNCH_SPEED_MUL = 1.55`.
- Releasing after a pull of at least `MIN_PULL = 8` world units fires one ball.
- Releasing below `MIN_PULL`, pressing Escape, or losing the pointer cancels without firing.
- Right-button camera panning remains unchanged.
- A left click outside the launch zone no longer fires a wave or a ball.

### Touch

- A one-finger press in the launch zone begins aiming.
- One-finger movement updates the pull vector.
- A one-finger release fires or cancels using the same thresholds.
- A two-finger gesture cancels aiming and continues to use the existing pinch-zoom behavior.
- Touch camera dragging outside the launch zone remains unchanged.

## Ball queue

- Each release fires exactly one ball.
- The next available ball is selected by existing `BALL_ORDER` order.
- A ball is available when `economy.ballsOwned[type] - spawnedCount[type] > 0`.
- Firing increments only that type's `spawnedCount`.
- The active ball type and color are shown near the launcher while aiming.
- If no ball is available, aiming cannot begin.
- Buying new balls makes them available without changing the save format.

## Aim preview

- While aiming, the renderer draws a capped dotted trajectory from the launcher.
- The preview uses the same `sweepGrid` collision helper and velocity/reflection rules as actual physics.
- It predicts up to `PREVIEW_DOTS = 32` points across `PREVIEW_SECONDS = 2.5` seconds.
- It never calls `World.hit`, mining callbacks, economy, augments, erosion, or reward UI callbacks.
- It is cleared on release, cancel, pause, or pointer loss.
- Preview calculations are capped and run at most once per pointer movement frame.

## Swept grid collision

Create `src/grid-collision.ts` with a deterministic segment traversal function:

```ts
interface GridHit {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  distance: number;
}

function sweepGrid(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  isSolid: (x: number, y: number) => boolean,
  width: number,
  height: number,
): GridHit | null
```

The helper traverses every grid cell intersected by the segment and returns the first solid cell plus the entered face normal. Out-of-bounds cells are solid boundaries. Ties resolve in fixed x-then-y order. A null result means the endpoint is reached without collision.

`Physics.moveBall` will use this helper for each fixed simulation substep. The ball is placed just before the hit, collision resolution runs once, and remaining segment distance continues using reflected velocity. A per-step collision budget prevents corner loops. Existing mining callbacks, ball abilities, molten bounce, and reactive erosion remain the gameplay authorities.

## Code boundaries

- Create `src/grid-collision.ts` and `tests/grid-collision.test.ts` for pure traversal tests.
- Modify `src/physics.ts` to use the helper while preserving `spawn` and `step` contracts.
- Modify `src/main.ts` for slingshot state, pointer handlers, queue selection, and preview updates.
- Modify `src/render.ts` for aim line, dots, active ball marker, and predicted impact accents.
- Modify `src/ui.ts`/`src/style.css` only for active-ball or empty-launcher feedback; do not redesign the HUD.
- Add pure tests for pull clamping, speed mapping, queue selection, and cancel/fire thresholds.

## State and persistence

Aim state, preview points, and the selected queue item are transient. No save-format change is required. `spawnedCount` continues to represent already-launched balls in the current run.

## Acceptance criteria

- The player can pull back from the launcher and release one ball in a chosen direction.
- Pull distance changes launch speed within the configured cap.
- The preview matches actual swept-grid collision behavior.
- A short accidental click cancels without firing.
- The queue follows `BALL_ORDER` and never launches beyond owned/unlaunched inventory.
- Camera panning, pinch zoom, upgrades, ball abilities, molten behavior, erosion, and saves continue to work.
- Fast balls do not tunnel through a one-cell wall in physics tests.
- Preview simulation never mutates world cells or economy state.
- Full tests and production build pass.

## Out of scope

- Replacing the custom solver with Box2D or Matter.js.
- Dynamic ball-to-ball rigid-body collisions.
- Gravity-driven arcs beyond the existing velocity model.
- New ball types, currencies, or a full launcher/shop redesign.
