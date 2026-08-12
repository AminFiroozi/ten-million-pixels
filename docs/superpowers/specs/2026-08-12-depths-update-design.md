# Depths Update — Design

Date: 2026-08-12
Status: Approved

## Overview

Second major update to the Ten Million Pixels clone: discovery/mystery mechanics (fog of war, golden-pixel radar), world content (biomes, treasure, boss pixels), a redesigned visual skill tree, and an always-available New Run control.

## Constraints

- Existing stack unchanged: Vite + TypeScript, Canvas 2D, no runtime deps, no code comments/emojis
- Perf budget holds: ≥55 fps at 2000 balls (fog must reuse the per-cell dirty patching pipeline)
- Worldgen stays deterministic per seed (tests)
- Save format bumps to version 2 with migration from v1 (no progress loss)

## Features

### Fog of war

- `world.explored: Uint8Array` (1 = revealed). Spawn cavity + small ring starts revealed; everything else dark.
- Destroying a pixel reveals a disc of radius 6 (Chebyshev) around it. Reveal writes mark affected cells dirty via the existing per-cell patch path.
- Rendering: unexplored cells paint `#070b08` regardless of content (terrain, treasure, bosses invisible). Balls/particles still visible everywhere. Pulse overlay (UPGRADE/GOLD) only when revealed.
- Minimap: unexplored area black.
- Save: explored mask stored as RLE runs (`[start, length, ...]` of revealed spans). v1 migration: after applying the cell diff, reveal radius 6 around every cell whose value differs from baseline, plus the spawn ring.

### Biomes

Low-frequency value noise (`scale 320`, seed offset +5) partitions the world into 4 biomes; `biomeAt(x, y)` derived, not stored.

| Biome | Noise band | Palette | Behavior |
|---|---|---|---|
| Verdant | [0, 0.45) | current green/orange | baseline |
| Crystal | [0.45, 0.65) | cyan/blue glitter | pixelValue x2, hardness tier +1 (soft→med, med→hard) |
| Molten | [0.65, 0.85) | red/ember on near-black | pixelValue x3; ball hitting a molten cell has 15% chance (seeded rng) to be destroyed — molten immunity upgrade negates |
| Ruins | [0.85, 1] | gray/sandstone | 3x stamp placement attempts, 2x upgrade-pixel attempts land here |

Hardness/value modifiers applied at generation (hardness) and at mining time (value). Biome palettes implemented in `cellColor` via biome lookup.

### Treasure and bosses

- `CELL.TREASURE = 7` (hp 2): single cells scattered like upgrade pixels (seeded, distance-weighted, ~120 per world). Payout `100 * (1 + 2 * edge)` currency, big particle burst, floating "+N" popup at screen position.
- `CELL.BOSS = 8`: 6 boss blobs per world (seeded random walk of ~40 cells each, deeper = bigger). Per-cell hp 40; destroying a blob's last cell triggers: reward `2000 * (1 + edge)` currency + 3 upgrade points, shockwave destroying all terrain in radius 6 (reported via onMined), screen-space flash.
- Blob membership tracked in a `Map<cellIndex, bossId>` built at generation; save v2 rebuilds it from seed then removes destroyed cells via diff.

### Golden-pixel radar

- Upgrade-unlocked. When bought: HUD compass widget — arrow pointing toward golden pixel from camera center + heat color by distance (blue >600px, yellow 300-600, red <300). Updates every 2 s with a ping animation.

### Skill tree v2

- Panel redesign: tiered node graph (DOM nodes absolutely positioned + SVG `<line>` connectors). Lines dim when locked, lit when prerequisite bought. Nodes: colored ring per branch, glow-pulse when affordable, level pips.
- Branches (all existing nodes preserved, ids unchanged):
  - Per-ball branches (existing unlock + ability nodes, laid out as 7 columns)
  - Economy: `pixel_value_1/2` (+10% per level, max 5, chained), `treasure_hunter` (treasure cells ping on minimap, max 1)
  - Discovery: `reveal_radius_1/2` (+2 per level, max 3, chained), `radar` (golden-pixel compass, max 1), 
  - Survival: `molten_immunity` (max 1), `dark_speed` (+15% ball speed in unexplored cells per level, max 2)
- Upgrade points economy: existing sources + bosses (+3) keep the bigger tree affordable.

### Always-available New Run

- Small "NEW RUN" button pinned bottom-left above the shop bar (styled like shop panels). Click → inline confirm state ("SURE? [YES] [NO]", 5 s timeout back to normal). YES → existing onNewRun flow (savingDisabled, clearSave, reload).
- Win overlay keeps its own New Run button (same handler).

## Save format v2

```
{ version: 2, seed, changes, exploredRuns: number[], currency, upgradePoints, upgrades, ballsOwned, stats }
```
- `loadGame` accepts v1 and v2. v1 → migrate: explored = reveal-around-mined-cells + spawn ring; everything else carried over.
- normalizeSave extended: exploredRuns must be finite-number array else empty (fresh fog).

## Architecture / files

- `src/world.ts`: explored mask + reveal(), biome hooks in generation, TREASURE/BOSS placement, boss blob map
- `src/biomes.ts` (new): biomeAt, biome palettes, value/hardness modifiers (pure, testable)
- `src/physics.ts`: molten ball-destruction roll (seeded), dark_speed modifier hook
- `src/economy.ts`: new tree nodes + stat plumbing (pixel value mult, reveal radius, flags)
- `src/render.ts`: fog paint in cellColor path, treasure/boss palettes
- `src/ui.ts`: tree v2 panel (DOM+SVG), radar compass, floating popups, minimap fog + treasure pings, NEW RUN button
- `src/save.ts`: v2 schema, explored RLE encode/decode, v1 migration
- `src/main.ts`: wiring (reveal on mine, boss kill flow, popup calls, AbilityStats extension)

## Testing

- explored RLE roundtrip; v1→v2 migration reveals mined surroundings
- biomeAt determinism + band boundaries; hardness/value modifiers
- boss blob generation determinism, blob-completion reward trigger
- molten destruction uses seeded rng (deterministic with fixed seed)
- new economy nodes: costs, prereq chains, statMul/abilityLevel plumbing
- all existing 36 tests stay green (worldgen hash test updated once for new generation — intentional, new content changes the world)

## Error handling

- v2 load with corrupt exploredRuns → fresh fog, console.warn
- Boss map desync guard: destroying a BOSS cell not in the map → treat as plain mined cell

## Out of scope

- Prestige, offline earnings, daily seeds, sound, lore text
