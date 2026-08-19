# Augment System + Molten Fix — Design

Date: 2026-08-19
Status: Approved

## Overview

Two changes:

1. **Molten fix (bounded):** molten terrain currently has a 15% chance per collision to destroy the ball outright. Player feedback: remove ball death entirely. Replace with a punchy knockback bounce — molten stays dangerous-feeling (extra particles, harder bounce) without ever destroying a ball.
2. **Augment system (architectural):** a roguelike "pick 1 of 3" run-scoped power-up system, offered on every boss kill and every 20 upgrade points earned, layered on top of the existing permanent upgrade tree.

## Constraints

- Existing stack unchanged: Vite + TS, Canvas 2D, no runtime deps, no code comments/emojis
- All logic randomness through seeded RNG (never `Math.random` for anything gameplay-affecting, including augment choice rolls)
- Save format bumps to v3 with v2→v3 migration (no progress loss)
- 54 existing tests stay green except tests directly covering removed molten-destroy behavior

## Part 1: Molten fix

- `src/physics.ts`: remove `rollMolten` and its call sites entirely. On a collision where the hit cell's biome is `"molten"`, apply an extra bounce impulse: after the normal axis reflection (whichever of vx/vy was flipped — same axis logic as today, unaffected by ball type), multiply the reflected component(s) by `MOLTEN_BOUNCE_MUL = 1.6`. Applies to every ball type on top of that type's existing per-type collision behavior. Ball never dies from this.
- Extra visual punch: when a molten collision occurs, the caller (main.ts, via `onMined`/collision reporting — reuse the existing `onMined` cell-report path) triggers one extra `renderer.addBurst` call at the impact point. Simplest hook: `Physics.step`'s existing damage/onMined flow already reports the destroyed cell; for the *molten collision* signal (which fires whether or not the cell is destroyed), add a new optional callback `onMoltenHit?: (x: number, y: number) => void` on `Physics.step`, wired in main.ts to call `renderer.addBurst(x, y, "#f63")`.
- Remove `moltenImmune` from `AbilityStats` and every reference (physics.ts, main.ts's `buildAbilityStats`, test fixtures in physics.test.ts/abilities.test.ts).
- Remove `molten_immunity` node from `UPGRADE_TREE` and its `NODE_LAYOUT` entry in `src/economy.ts`.
- Refund: bump `dark_speed`'s `max` from 2 to 3 (same `amount: 0.15` per level, same stat) — same survival branch, same "move safely through danger" theme.
- Remove/adjust now-invalid tests: the molten-destroy differential test in physics.test.ts is replaced with a test asserting the ball survives and bounces harder (velocity magnitude increases) on molten impact; economy.test.ts's `molten_immunity` references removed, `dark_speed` max-level test updated to 3.

## Part 2: Augment system

### Data model — `src/augments.ts` (new)

```
interface AugmentDef {
  id: string;
  name: string;
  desc: string;
  stat: string;
  amount: number;
}

const AUGMENT_POOL: AugmentDef[] = [ /* 12 entries — exact contents in the Pool table below */ ]

interface AugmentState {
  picked: string[];
  rngState: number;
}

function newAugmentState(seed: number): AugmentState
function augmentMul(state: AugmentState, stat: string): number   // 1 + sum(amount for picked defs with matching stat)
function augmentBonus(state: AugmentState, stat: string): number // sum(amount for picked defs with matching stat)
function rollChoices(state: AugmentState, count: number): AugmentDef[]  // up to `count` unpicked defs, deterministic via state's own seeded rng (mulberry32), consumes rng state
function pickAugment(state: AugmentState, id: string): void      // pushes id into picked; no-op if already picked or unknown id
```

`rollChoices` seeds its own `mulberry32` from `state.rngState` on each call and persists the advanced state back into `state.rngState`, so choice rolls are deterministic and reproducible from a saved seed — never `Math.random`.

### Pool (12 entries, final)

| id | name | desc | stat | amount |
|---|---|---|---|---|
| aug_momentum | Momentum | +20% ball speed | speed | 0.20 |
| aug_heavy | Heavy Hitters | +20% damage | damage | 0.20 |
| aug_blast | Wide Blast | Smash radius +1 | smashRadius | 1 |
| aug_toxic | Toxic Bloom | Poison spread +1 | poisonSpread | 1 |
| aug_split | Splitting Frenzy | Split count +1 | splitCount | 1 |
| aug_pierce | Deep Pierce | Pierce depth +1 | pierceDepth | 1 |
| aug_prospector | Prospector | +20% currency from mining | pixelValueMul | 0.20 |
| aug_treasure | Treasure Nose | +30% treasure payout | treasureMul | 0.30 |
| aug_slayer | Boss Slayer | +30% boss payout | bossMul | 0.30 |
| aug_eyes | Wide Eyes | Reveal radius +3 | revealRadius | 3 |
| aug_overcharge | Overcharge | Launch wave +10 balls | launchWave | 10 |
| aug_swift | Swift Draw | +15% launch speed | launchSpeed | 0.15 |

Multiplicative stats (`speed`, `damage`, `pixelValueMul`, `treasureMul`, `bossMul`, `launchSpeed`) combine via `augmentMul` (returns a multiplier, `1 + sum`), applied multiplicatively alongside the existing tree-derived `statMul`. Additive stats (`smashRadius`, `poisonSpread`, `splitCount`, `pierceDepth`, `revealRadius`, `launchWave`) combine via `augmentBonus` (raw sum), added on top of the existing tree-derived formulas in main.ts (e.g. `1 + abilityLevel(economy, "smashRadius") + augmentBonus(augments, "smashRadius")`).

### Trigger logic (main.ts)

- `upgradePointsSinceAugment: number`, incremented by the same delta whenever `economy.upgradePoints` increases (wherever it's currently incremented: UPGRADE cell mined, boss kill). After each increment: `while (upgradePointsSinceAugment >= AUGMENT_MILESTONE) { upgradePointsSinceAugment -= AUGMENT_MILESTONE; pendingAugmentOffers++; }` where `AUGMENT_MILESTONE = 20` — handles any single delta size (a lone UPGRADE pixel is +1, a boss kill is +3, neither can single-handedly cross 20, but the loop is correct for any future value) without losing remainder or under/over-queueing.
- Boss kill (`registerBossCellMined` blob completion) always queues an augment offer, independent of the milestone counter.
- `pendingAugmentOffers: number` queue depth. `showNextAugmentOffer()`: if `pendingAugmentOffers > 0` and no offer currently shown, `rollChoices(augmentState, 3)`; if the roll returns 0 defs (pool exhausted), silently decrement the queue and try the next one (or stop if queue empty) instead of showing an empty modal; otherwise call `ui.showAugmentChoice(defs)` and pause.
- `paused: boolean` — when true, `frame()` skips the physics accumulator/step loop and `updateCameraPan`/click-to-launch input, but still calls `renderer.draw` so the frozen state renders.
- On pick: `pickAugment(augmentState, id)`, `paused = false`, `pendingAugmentOffers--`, then call `showNextAugmentOffer()` again in case another is queued.

### UI — `src/ui.ts`

- `showAugmentChoice(defs: AugmentDef[]): void` — full-screen modal (same visual family as `.win-overlay`), title "CHOOSE AN AUGMENT", up to 3 cards (name + desc), click a card to pick.
- `onPickAugment?: (id: string) => void` hook, wired in main.ts.
- Card layout scales down to however many defs are passed (1–3) for the pool-exhaustion tail case.

### Save (v3)

```
SaveData.version = 3
SaveData.augments: string[]   // AugmentState.picked
SaveData.augmentRngState: number
```

- `migrateV2to3(old): SaveData` — passthrough (`{ ...old, version: 3, augments: [], augmentRngState: old.seed + 8 }`), same pattern as the existing v1→v2 migration. `newAugmentState(seed)` (fresh-run path) uses the same `seed + 8` convention, consistent with the existing per-purpose seed offsets used elsewhere in worldgen (biomes `+5`, treasure `+6`, bosses `+7`).
- `loadGame()` accepts v1 (→v2 migrate →v3 migrate), v2 (→v3 migrate), v3 directly.
- `normalizeSave` extended: `augments` must be an array of strings (else `[]`), `augmentRngState` must be a finite number (else a fresh default).
- Pending-choice-at-save-time is NOT persisted — if the page reloads while an augment choice modal is open, the choice is lost and the modal does not reopen; the player keeps whatever `picked` list was saved, and the queue simply starts empty on load. This is an intentional, documented simplification, not a bug.

### Testing

- `augments.ts`: `augmentMul`/`augmentBonus` correctness for both empty and populated `picked`; `rollChoices` determinism (same seed + same picked-so-far → same choices) and pool-exhaustion behavior (returns fewer than requested, then zero); `pickAugment` no-op on duplicate/unknown id.
- Save: v3 roundtrip (augments + augmentRngState survive diff/apply — note these are NOT part of the world diff, they're plain SaveData fields alongside currency/upgradePoints, so no special diff logic needed, just normal JSON persistence); v1→v3 and v2→v3 migration produce `augments: []`.
- Trigger logic and pause/modal flow are integration-level (main.ts), verified by the controller's browser pass, consistent with how prior main.ts wiring tasks were tested in this project.

## Out of scope

- Stacking duplicate augments, wild/build-defining effects, augment re-rolling/banking, sound, persisting a pending choice across reload.
