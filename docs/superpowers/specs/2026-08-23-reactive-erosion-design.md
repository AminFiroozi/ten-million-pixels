# Reactive Erosion and Impact Feedback — Design

Date: 2026-08-23
Status: Approved for spec review

## Goal

Make the clone feel closer to BATTLE LAB's original 10 Million Pixels by making ball impacts, terrain erosion, and chain reactions more tactile while preserving the current expanded systems: biomes, bosses, augments, upgrades, treasure, saves, and the Golden Pixel win condition.

## Design principles

- Preserve the original loop: shoot balls, erode pixels, reinvest mined currency, and explore toward the Golden Pixel.
- Add depth through readable destruction and feedback rather than adding another progression layer.
- Keep the existing dark, colorful pixel-canvas presentation and avoid a full HUD redesign.
- Keep gameplay randomness deterministic. No gameplay-affecting `Math.random` calls.
- Keep renderer work bounded under large ball counts.

## Gameplay behavior

### Damage and cracks

Existing accumulated cell damage remains the source of truth. Ordinary terrain cells render visible crack stages as their accumulated damage approaches their HP. A cell is not considered mined until existing `World.hit` rules destroy it.

### Fracture cascades

When an ordinary terrain cell (`SOFT`, `MED`, or `HARD`) is destroyed by a ball or existing ball ability, the erosion resolver may apply fracture energy to its four orthogonal neighbors.

- Only ordinary terrain cells participate in automatic fracture.
- `GOLD`, `TREASURE`, `UPGRADE`, `BOSS`, `OBJECT`, and `EMPTY` cells are protected from automatic destruction.
- Fracture uses a bounded breadth-first queue.
- Energy is reduced on every hop and cannot continue beyond a small fixed maximum depth.
- A fracture may damage a terrain neighbor, and a neighbor that breaks may enqueue its own eligible neighbors.
- Fracture damage is additional to the original impact and does not replace existing smash, poison, pierce, split, or heavy-ball behavior.
- Every cascade has a deterministic sequence derived from the world seed and simulation event sequence. The same seed and action sequence produce the same cascade.
- A cascade cannot revisit a cell in the same resolution.
- A per-impact cell budget prevents a single collision from destroying an unbounded region.

The exact constants will be centralized in `src/erosion.ts` and covered by tests. They must produce short, readable bursts rather than map-wide collapse.

### Combo

The coordinator tracks a transient mining combo:

- The combo increases for each cell destroyed inside the active cascade window.
- A new direct impact during the active window keeps the combo alive.
- If no cell is destroyed before the timeout, the combo resets to zero.
- Combo state is session state only and is not persisted.
- Combo feedback does not change currency or upgrade-point formulas in this slice.

## Visual feedback

### Impact events

Physics and erosion emit render-only events containing position, ball type, biome, destroyed cell type, and cascade depth. The coordinator maps mining callbacks to these events without coupling renderer code to economy logic.

### Renderer effects

- Cracked cells are represented by existing damage state and patched through the chunk renderer.
- Balls leave short-lived type-colored trails sampled from recent positions.
- Direct impacts create a small burst colored by ball/biome context.
- Cascade impacts create smaller directional fragments and a brief pulse.
- Combo milestones produce restrained floating text or accent flashes.
- Camera impulse is subtle, short-lived, and capped; it must not interfere with camera drag or zoom.
- Particle, trail, and event buffers have hard caps and discard oldest low-priority effects first.

The effect language stays minimalist: the canvas remains dominant, feedback is localized around the mining action, and the existing economy/progression HUD remains in place.

## Code boundaries

### `src/erosion.ts` — new

Owns erosion constants, eligible-cell checks, deterministic cascade resolution, and the small event/result types consumed by the coordinator. It depends on `World`, `CELL`, and the seeded RNG utilities, but not on DOM, renderer, or economy code.

### `src/world.ts`

Exposes only the minimum existing damage/cell APIs needed by the erosion resolver. Special-cell protection must be enforced by the resolver and rechecked before each automatic hit.

### `src/physics.ts`

Reports direct collision and impact context. Existing ball-specific behavior remains unchanged. Physics must not update combo, currency, or UI state.

### `src/render.ts`

Adds bounded trail storage and explicit impact/cascade rendering methods. Existing chunk invalidation and dirty-cell patching remain the path for terrain updates.

### `src/main.ts`

Coordinates direct mining, erosion results, combo lifetime, renderer events, camera impulse, and transient UI feedback. It continues to own economy and progression callbacks.

### Tests

Add focused erosion tests and extend physics/render-adjacent tests only where behavior crosses an existing public boundary. No browser-only test dependency is required for the first slice.

## Data flow

```text
ball collision
  -> World.hit direct damage
  -> direct mined callback
  -> erosion.resolve(seed, impact, world)
  -> bounded cascade hits
  -> mined callbacks for each destroyed cell
  -> economy/reveal/progression updates
  -> impact + cascade render events
  -> combo and transient feedback
```

## Error and safety behavior

- Invalid coordinates, empty cells, and protected cells are ignored by automatic fracture.
- Non-finite physics positions continue to be filtered by the existing ball cleanup.
- Cascade processing stops cleanly at the event/cell budget.
- Renderer methods tolerate missing or stale event positions.
- No new save fields are required because combo and visual effects are intentionally transient.

## Testing and acceptance

Tests must verify:

1. Ordinary terrain is eligible for fracture and special cells are protected.
2. Fracture energy decays and the maximum depth/budget is enforced.
3. A cell cannot be processed twice in one cascade.
4. Identical seed and impact input produce identical cascade results.
5. Cascade results differ when the deterministic seed/input differs.
6. Existing ball damage and special abilities continue to work.
7. Combo increments, remains active within its window, and resets after timeout.
8. Trail and particle caps stay bounded.

The full `npm test` suite and `npm run build` must pass before completion.

## Out of scope

- New ball types, currencies, upgrade branches, or augments.
- Hidden-object discovery as a separate system.
- Sound and music.
- Multiplayer.
- Full HUD replacement.
- Changes to world-generation distribution or save format.
