# Ten Million Pixels — Web Clone Design

Date: 2026-08-12
Status: Approved

## Overview

Web clone of "10 Million Pixels" by BATTLE LAB (incremental pixel-mining game). Player shoots balls that bounce around a procedurally generated pixel world, breaking pixels. Broken pixels are currency used to buy more balls and upgrades. Goal: find the single Golden Pixel hidden in the world.

## Constraints

- Stack: Vite + TypeScript, Canvas 2D, no runtime dependencies
- Location: `D:\programming\Games\ten-million-pixels`
- World: 1280x800 = 1,024,000 cells
- Performance target: 60 fps with thousands of simultaneous balls
- Persistence: localStorage autosave
- Testing: vitest for deterministic logic; manual play for feel

## Architecture

Modules, each with a single responsibility:

- `src/world.ts` — world grid state, generation, mining API
- `src/physics.ts` — ball simulation, collision, ball abilities
- `src/render.ts` — chunked canvas rendering, camera, particles
- `src/economy.ts` — currency, ball costs, upgrade tree state
- `src/save.ts` — serialization (RLE), localStorage load/save
- `src/ui.ts` — HUD, shop, upgrade tree panel, minimap, win screen
- `src/main.ts` — game loop wiring, input

### World

`Uint8Array` of 1,024,000 cells. Cell values:

| Value | Meaning |
|---|---|
| 0 | empty (mined or cavity) |
| 1 | soft terrain (1 hp) |
| 2 | medium terrain (3 hp) |
| 3 | hard terrain (8 hp) |
| 4 | upgrade-pixel (grants upgrade point when mined) |
| 5 | golden pixel (win condition, exactly one) |
| 6 | handcrafted-object pixel (2 hp, distinct palette) |

Separate sparse map for current damage on partially-mined cells.

Generation: seeded value-noise (custom, deterministic) sets density and hardness bands — harder farther from center. Spawn cavity carved at world center. Handcrafted objects: small hand-drawn bitmap stamps (skull, sword, heart, key, diamond, etc.) buried at seeded random locations. Upgrade-pixels scattered with distance-weighted probability. Golden pixel placed in outer 20% ring at seeded random spot.

### Physics

Balls: struct-of-arrays or object array `{x, y, vx, vy, type, ttl?}`. Fixed timestep (e.g. 120 Hz sim, interpolated render). Collision: step along velocity, sample target cell; on solid hit, reflect off collision axis and apply damage. Pixel destroyed when damage >= hp → currency +1 (+bonus per hardness), particle burst, chunk marked dirty.

Ball types and abilities:

| Ball | Ability |
|---|---|
| White Basic | plain bounce + mine |
| Blue Directional | moves only in straight vertical/horizontal lines; on bounce snaps to axis |
| Red Smash | breaks pixels in radius-2 area on impact |
| Green Poison | poisons impacted pixel; poison erodes over time and spreads to orthogonal neighbors |
| Orange Splitter | on impact spawns 2 short-lived shard balls |
| Yellow Bolt | pierces through up to N pixels in a line before bouncing |
| Purple Heavy | slow, 5x damage, continues through destroyed pixel |

Poison: sparse set of poisoned cells ticked on interval; each tick applies damage and spreads with decaying probability.

### Rendering

World split into 64x64-cell chunks (20x13 grid of chunks), each an offscreen canvas. Only dirty chunks re-rasterized. Main pass: camera transform + `drawImage` of visible chunks, then balls (glow via shadowBlur or pre-rendered sprite), then particles.

Camera: pan (mouse drag with right button or WASD), zoom (wheel, clamped). Minimap in corner rendered from downsampled world, shows mined-out regions and camera viewport rectangle.

Visual style: near-black background; terrain palette neon (soft = bright green/orange/red mix by noise, harder = desaturated/darker); balls glowing colored dots; pixel-art font (press-start style via bundled webfont or canvas bitmap font); particle bursts on break; subtle screen-space glow on golden pixel reveal.

### Economy and progression

- Currency: mined pixels. Counter in HUD.
- Shop: buy balls per unlocked type. Cost geometric: `base * 1.15^owned`.
- Upgrade-pixels grant upgrade points. Upgrade tree (icon grid with hover tooltips, like original): nodes for ball speed +%, damage +%, per-type ability strength (smash radius, poison spread, split count, pierce depth), and unlocking new ball types. Tree layout data-driven from a static config.
- Aiming: left-click/drag sets aim from spawn point; owned balls launch toward cursor (spread fan). Balls persist and bounce indefinitely (shard balls have ttl).

### Win condition

Mining the golden pixel triggers win screen: stats (time, pixels mined, balls owned), replay option. Game continues afterward if player closes screen (sandbox).

### Save

Autosave every 10 s + on visibility change. Format: `{ version, seed, rleDiff, currency, upgradePoints, upgrades, ballsOwned, stats }`. World stored as seed + RLE of cells whose value/damage differs from generated baseline. Load: regenerate from seed, apply diff. Corrupt/missing save → fresh run.

### Testing

- worldgen: same seed → identical grid hash; golden pixel exists exactly once
- RLE: roundtrip identity on random diffs
- collision: reflection math unit cases (axis hits, corner hit)
- economy: cost curve values, upgrade point accounting
- poison: spread/decay determinism with seeded RNG

### Error handling

- Save load failures caught → fresh run, console warning
- Physics NaN guard: balls with non-finite state culled per frame
- rAF loop wrapped; fatal errors show reload overlay

## Out of scope

- Sound (stretch, only if trivial at end)
- Mobile/touch controls
- Steam-specific features, achievements
